// server/services/InventoryAlertService.js
// 在庫アラートサービス - Phase 1
// - 対象SKU抽出（2314-* かつ 販売実績あり or stock>=1）
// - 3期間（28日/14日/7日）の実効日販計算（欠品期間除外）
// - 在庫日数計算（3期間最短予測）
// - トレンド判定
// - リードタイムを加味した有効残日数計算
// - 6段階分類
// - フリマ未監視の売れ筋推奨リスト生成

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const HISTORY_FILE = path.join(DATA_DIR, 'crossmall_sales_history.json');
const CACHE_FILE = path.join(DATA_DIR, 'purchase_master_cache.json');
const STATE_FILE = path.join(DATA_DIR, 'inventory_alert_state.json');

class InventoryAlertService {
  constructor(options = {}) {
    this.defaultLeadTime = options.leadTime
      || parseInt(process.env.DEFAULT_LEAD_TIME || '3', 10);
    this.accelerationThreshold = 1.5;
    this.decelerationThreshold = 0.5;
  }

  /**
   * メイン: 全対象SKUの在庫アラート結果を生成
   * @returns {{ alerts: Array, summary: Object, recommendations: Array }}
   */
  async generateAlert() {
    const state = this._loadState();
    const { cacheMap, salesMap } = this._loadData();

    const targetSKUs = this._getTargetSKUs(cacheMap, salesMap);
    const now = new Date();

    const alerts = [];
    for (const sku of targetSKUs) {
      const stockInfo = cacheMap.get(sku) || null;
      const salesRecords = salesMap.get(sku) || [];
      alerts.push(this._analyzeSKU(sku, stockInfo, salesRecords, state, now));
    }

    // 重要度順ソート
    const levelOrder = [
      'critical_accelerating', 'out_of_stock', 'critical',
      'warning', 'price_review', 'dead_stock', 'ok',
    ];
    alerts.sort((a, b) => {
      const diff = levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level);
      if (diff !== 0) return diff;
      return (a.effectiveRemainingDays ?? 999) - (b.effectiveRemainingDays ?? 999);
    });

    this._saveState(alerts, state);

    const summary = this._buildSummary(alerts);
    let recommendations = [];
    try {
      recommendations = await this._generateRecommendations(alerts);
    } catch (err) {
      console.warn('フリマ推奨生成スキップ:', err.message);
    }

    return { alerts, summary, recommendations };
  }

  // ─────────────────────────────────────────────
  // データ読み込み
  // ─────────────────────────────────────────────

  _loadData() {
    // purchase_master_cache.json: items は数値インデックスキー。SKUは .sku フィールド
    const cacheRaw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const cacheMap = new Map();
    for (const item of Object.values(cacheRaw.items || {})) {
      if (item.sku) cacheMap.set(item.sku, item);
    }

    // crossmall_sales_history.json: sales = { [sku]: [{ date, price, orderNumber, deliveryType }] }
    const historyRaw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const salesMap = new Map();
    for (const [sku, records] of Object.entries(historyRaw.sales || {})) {
      salesMap.set(sku, records);
    }

    return { cacheMap, salesMap };
  }

  _loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      }
    } catch (err) {
      console.warn('状態ファイル読み込み失敗:', err.message);
    }
    return { lastUpdated: null, outOfStockSince: {}, previousStock: {}, lastAlertSent: {} };
  }

  _saveState(alerts, prevState) {
    const outOfStockSince = { ...(prevState.outOfStockSince || {}) };
    const previousStock = {};
    const now = new Date().toISOString();

    for (const a of alerts) {
      previousStock[a.sku] = a.stock;
      if (a.level === 'out_of_stock') {
        if (!outOfStockSince[a.sku]) outOfStockSince[a.sku] = now;
      } else {
        delete outOfStockSince[a.sku];
      }
    }

    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify({
        lastUpdated: now,
        outOfStockSince,
        previousStock,
        lastAlertSent: prevState.lastAlertSent || {},
      }, null, 2), 'utf8');
    } catch (err) {
      console.error('状態保存失敗:', err.message);
    }
  }

  // ─────────────────────────────────────────────
  // 対象SKU抽出
  // ─────────────────────────────────────────────

  /**
   * 対象SKUを抽出
   * 条件: 2314-* かつ (販売実績あり or stock>=1)
   * 在庫0かつ販売ゼロは除外
   */
  _getTargetSKUs(cacheMap, salesMap) {
    const all = new Set([
      ...[...cacheMap.keys()].filter(s => s.startsWith('2314-')),
      ...[...salesMap.keys()].filter(s => s.startsWith('2314-')),
    ]);

    return [...all].filter(sku => {
      const stock = cacheMap.has(sku) ? (cacheMap.get(sku).stock || 0) : 0;
      const hasSales = salesMap.has(sku) && salesMap.get(sku).length > 0;
      return stock > 0 || hasSales;
    });
  }

  // ─────────────────────────────────────────────
  // SKU分析
  // ─────────────────────────────────────────────

  /**
   * 1 SKUの在庫アラート情報を計算
   * @returns {{
   *   sku, itemName, stock,
   *   sales28, sales14, sales7,
   *   effectiveDailyRate28, effectiveDailyRate14, effectiveDailyRate7,
   *   stockDays, trend, effectiveRemainingDays,
   *   level, lastSaleDate, outOfStockDays
   * }}
   */
  _analyzeSKU(sku, stockInfo, salesRecords, state, now) {
    const stock = stockInfo ? (stockInfo.stock || 0) : 0;
    const itemName = stockInfo ? (stockInfo.item_name || sku) : sku;

    const outOfStockDays = this._calcOutOfStockDays(sku, stock, state, now);

    const sales28 = this._countSalesInPeriod(salesRecords, 28, now);
    const sales14 = this._countSalesInPeriod(salesRecords, 14, now);
    const sales7  = this._countSalesInPeriod(salesRecords,  7, now);
    const lastSaleDate = this._getLastSaleDate(salesRecords);

    // 欠品日数は各期間を上限にクリップ
    const effectiveDailyRate28 = this._calcEffectiveDailyRate(sales28, 28, Math.min(outOfStockDays, 27));
    const effectiveDailyRate14 = this._calcEffectiveDailyRate(sales14, 14, Math.min(outOfStockDays, 13));
    const effectiveDailyRate7  = this._calcEffectiveDailyRate(sales7,   7, Math.min(outOfStockDays,  6));

    const stockDays = this._calcStockDays(stock, effectiveDailyRate28, effectiveDailyRate14, effectiveDailyRate7);

    const trend = this._determineTrend(effectiveDailyRate28, effectiveDailyRate7);

    const effectiveRemainingDays = isFinite(stockDays)
      ? stockDays - this.defaultLeadTime
      : Infinity;

    const level = this._classify(stock, effectiveRemainingDays, trend, sales28);

    return {
      sku, itemName, stock,
      sales28, sales14, sales7,
      effectiveDailyRate28, effectiveDailyRate14, effectiveDailyRate7,
      stockDays, trend, effectiveRemainingDays,
      level, lastSaleDate, outOfStockDays,
    };
  }

  /**
   * 期間内の販売数をカウント
   */
  _countSalesInPeriod(records, days, now) {
    if (!records || records.length === 0) return 0;
    const cutoffStr = this._formatDate(new Date(now - days * 24 * 60 * 60 * 1000));
    return records.filter(r => r.date >= cutoffStr).length;
  }

  /**
   * 最終販売日（YYYY-MM-DD）を返す
   */
  _getLastSaleDate(records) {
    if (!records || records.length === 0) return null;
    return records.reduce((latest, r) => (r.date > latest ? r.date : latest), records[0].date);
  }

  /**
   * 欠品日数（inventory_alert_state.outOfStockSince からの経過日数）
   * stock > 0 なら 0 を返す
   */
  _calcOutOfStockDays(sku, currentStock, state, now) {
    if (currentStock > 0) return 0;
    const since = state.outOfStockSince && state.outOfStockSince[sku];
    if (!since) return 0;
    return Math.max(0, Math.floor((now - new Date(since)) / (24 * 60 * 60 * 1000)));
  }

  /**
   * 実効日販を計算（欠品期間を除外）
   * @param {number} sales - 期間内の販売数
   * @param {number} periodDays - 期間の暦日数（28/14/7）
   * @param {number} outOfStockDays - 期間内の欠品日数（periodDays-1 未満であることを呼び元が保証）
   * @returns {number} 実効日販
   */
  _calcEffectiveDailyRate(sales, periodDays, outOfStockDays) {
    const effectiveDays = periodDays - outOfStockDays;
    if (effectiveDays <= 0) return 0;
    return sales / effectiveDays;
  }

  /**
   * 在庫日数（3期間の最短予測）
   * 全期間販売ゼロなら Infinity を返す
   */
  _calcStockDays(stock, rate28, rate14, rate7) {
    if (stock === 0) return 0;
    const d28 = rate28 > 0 ? stock / rate28 : Infinity;
    const d14 = rate14 > 0 ? stock / rate14 : Infinity;
    const d7  = rate7  > 0 ? stock / rate7  : Infinity;
    return Math.min(d28, d14, d7);
  }

  /**
   * トレンド判定
   * @returns {'accelerating'|'stable'|'decelerating'|'new_surge'|'unknown'}
   */
  _determineTrend(rate28, rate7) {
    if (rate28 < 0.3 && rate7 >= 1.0) return 'new_surge';
    if (rate28 === 0 && rate7 === 0) return 'unknown';
    if (rate28 === 0 && rate7 > 0) return 'accelerating';
    const ratio = rate7 / rate28;
    if (ratio >= this.accelerationThreshold) return 'accelerating';
    if (ratio <= this.decelerationThreshold) return 'decelerating';
    return 'stable';
  }

  /**
   * 分類（6段階）
   * @returns {'critical_accelerating'|'critical'|'warning'|'ok'|'out_of_stock'|'price_review'|'dead_stock'}
   */
  _classify(stock, effectiveRemainingDays, trend, sales28) {
    if (stock === 0) return 'out_of_stock';
    if (sales28 === 0 && effectiveRemainingDays === Infinity) return 'dead_stock';
    if (trend === 'decelerating') return 'price_review';
    if (effectiveRemainingDays <= 0) {
      return (trend === 'accelerating' || trend === 'new_surge')
        ? 'critical_accelerating'
        : 'critical';
    }
    if (effectiveRemainingDays <= 4) return 'warning';
    return 'ok';
  }

  // ─────────────────────────────────────────────
  // サマリー
  // ─────────────────────────────────────────────

  _buildSummary(alerts) {
    const counts = {
      critical_accelerating: 0,
      out_of_stock: 0,
      critical: 0,
      warning: 0,
      ok: 0,
      price_review: 0,
      dead_stock: 0,
    };
    for (const a of alerts) {
      if (a.level in counts) counts[a.level]++;
    }
    return { total: alerts.length, ...counts };
  }

  // ─────────────────────────────────────────────
  // フリマ推奨
  // ─────────────────────────────────────────────

  /**
   * フリマ未監視の売れ筋推奨リスト生成
   * DBのKeywordsテーブルから crossmall_item_code が紐付いているSKUを取得して除外
   */
  async _generateRecommendations(alerts) {
    const monitoredSKUs = new Set();
    try {
      const db = require('../models');
      const rows = await db.Keyword.findAll({
        where: { is_active: true },
        attributes: ['crossmall_item_code'],
      });
      for (const row of rows) {
        if (row.crossmall_item_code) monitoredSKUs.add(row.crossmall_item_code);
      }
    } catch (err) {
      console.warn('DB接続スキップ（推奨リスト省略）:', err.message);
      return [];
    }

    const recommendations = [];
    for (const a of alerts) {
      if (monitoredSKUs.has(a.sku)) continue;

      const isPatternA = a.sales28 >= 10;                                    // 売れ筋
      const isPatternB = isFinite(a.effectiveRemainingDays)
        && a.effectiveRemainingDays <= 14 && a.sales28 >= 1;                  // 在庫減少中
      const isPatternC = a.trend === 'new_surge';                             // 新規急伸

      if (isPatternA || isPatternB || isPatternC) {
        recommendations.push({
          sku: a.sku,
          itemName: a.itemName,
          sales28: a.sales28,
          sales7: a.sales7,
          stock: a.stock,
          trend: a.trend,
          reason: isPatternA ? 'high_volume' : isPatternC ? 'new_surge' : 'low_stock',
        });
      }
    }

    return recommendations
      .sort((a, b) => b.sales28 - a.sales28)
      .slice(0, 10);
  }

  // ─────────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────────

  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

module.exports = InventoryAlertService;
