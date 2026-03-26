// server/services/CrossmallSalesHistory.js
// CROSSMALL販売データの蓄積型ストレージ
// - 注文ごとの販売レコードを永続保存
// - 差分取得のため既知の注文番号を記録
// - sales7/sales28/lastSalePrice 等の統計を蓄積データから算出

const fs = require('fs');
const path = require('path');

const HISTORY_FILE_PATH = path.resolve(__dirname, '../../data/crossmall_sales_history.json');

class CrossmallSalesHistory {
  constructor() {
    this._data = {
      lastSyncedAt: null,
      // 蓄積データの最古・最新注文日（差分取得の基準）
      oldestOrderDate: null,
      newestOrderDate: null,
      // 既知の注文番号セット（重複防止）
      knownOrderNumbers: [],
      // SKUごとの販売レコード配列
      // { [itemCode]: [{ date, price, orderNumber, deliveryType }] }
      sales: {},
    };

    this._knownSet = new Set();
    this._loadFromDisk();
  }

  /**
   * 既知の注文番号かチェック
   */
  hasOrder(orderNumber) {
    return this._knownSet.has(orderNumber);
  }

  /**
   * 最後に同期した日付を返す（差分取得の起点）
   */
  getLastSyncInfo() {
    return {
      lastSyncedAt: this._data.lastSyncedAt,
      newestOrderDate: this._data.newestOrderDate,
      totalOrders: this._knownSet.size,
      totalSkus: Object.keys(this._data.sales).length,
    };
  }

  /**
   * 新しい注文の販売レコードを追加
   * @param {string} orderNumber
   * @param {string} orderDate - "YYYY-MM-DD" 形式
   * @param {string} deliveryType
   * @param {Array<{ item_code: string, unit_price: number }>} items
   */
  addOrder(orderNumber, orderDate, deliveryType, items) {
    if (this._knownSet.has(orderNumber)) return;

    this._knownSet.add(orderNumber);
    this._data.knownOrderNumbers.push(orderNumber);

    // 最古・最新の更新
    if (!this._data.oldestOrderDate || orderDate < this._data.oldestOrderDate) {
      this._data.oldestOrderDate = orderDate;
    }
    if (!this._data.newestOrderDate || orderDate > this._data.newestOrderDate) {
      this._data.newestOrderDate = orderDate;
    }

    for (const item of items) {
      if (!item.item_code || item.unit_price <= 0) continue;

      if (!this._data.sales[item.item_code]) {
        this._data.sales[item.item_code] = [];
      }
      this._data.sales[item.item_code].push({
        date: orderDate,
        price: item.unit_price,
        orderNumber,
        deliveryType,
      });
    }
  }

  /**
   * 蓄積データから全SKUの統計を算出して返す
   * @returns {Map<string, { price, deliveryType, sales7, sales28, lastSaleDate }>}
   */
  computeStats() {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const twentyEightDaysAgo = new Date();
    twentyEightDaysAgo.setDate(now.getDate() - 28);

    const sevenStr = this._formatDate(sevenDaysAgo);
    const twentyEightStr = this._formatDate(twentyEightDaysAgo);

    const result = new Map();

    for (const [itemCode, records] of Object.entries(this._data.sales)) {
      if (records.length === 0) continue;

      // 日付順にソート（古い→新しい）
      const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
      const latest = sorted[sorted.length - 1];

      let sales7 = 0;
      let sales28 = 0;
      for (const r of sorted) {
        if (r.date >= twentyEightStr) sales28++;
        if (r.date >= sevenStr) sales7++;
      }

      result.set(itemCode, {
        price: latest.price,
        orderNumber: latest.orderNumber,
        deliveryType: latest.deliveryType,
        sales7,
        sales28,
        lastSaleDate: latest.date,
      });
    }

    return result;
  }

  /**
   * 同期完了をマークしてディスクに保存
   */
  save() {
    this._data.lastSyncedAt = new Date().toISOString();
    this._saveToDisk();
  }

  /**
   * 古い販売レコードを削除してファイルサイズを抑制（オプション）
   * @param {number} keepDays - この日数より古いレコードを削除
   */
  pruneOldRecords(keepDays = 180) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - keepDays);
    const cutoffStr = this._formatDate(cutoff);

    let pruned = 0;
    for (const [itemCode, records] of Object.entries(this._data.sales)) {
      const before = records.length;
      this._data.sales[itemCode] = records.filter(r => r.date >= cutoffStr);
      pruned += before - this._data.sales[itemCode].length;
      // 空になったSKUは削除
      if (this._data.sales[itemCode].length === 0) {
        delete this._data.sales[itemCode];
      }
    }

    if (pruned > 0) {
      console.log(`🗑️ ${pruned}件の古い販売レコード削除（${keepDays}日以前）`);
      // knownOrderNumbersも整理（古いものを除去するため再構築）
      const activeOrders = new Set();
      for (const records of Object.values(this._data.sales)) {
        for (const r of records) activeOrders.add(r.orderNumber);
      }
      this._data.knownOrderNumbers = [...activeOrders];
      this._knownSet = activeOrders;
      // oldestOrderDateを更新
      this._data.oldestOrderDate = cutoffStr;
    }

    return pruned;
  }

  // ─────────────────────────────────────────────
  // プライベートメソッド
  // ─────────────────────────────────────────────

  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(HISTORY_FILE_PATH)) {
        console.log('ℹ️ CrossmallSalesHistory: 履歴ファイルなし（初回起動）');
        return;
      }
      const raw = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);

      if (parsed && parsed.sales) {
        this._data = parsed;
        this._knownSet = new Set(parsed.knownOrderNumbers || []);
        const totalRecords = Object.values(parsed.sales).reduce((s, arr) => s + arr.length, 0);
        console.log(`✅ CrossmallSalesHistory 復元完了: ${this._knownSet.size}注文, ${Object.keys(parsed.sales).length}SKU, ${totalRecords}レコード`);
      }
    } catch (err) {
      console.error('⚠️ CrossmallSalesHistory ディスク読み込み失敗:', err.message);
    }
  }

  _saveToDisk() {
    try {
      const dir = path.dirname(HISTORY_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(HISTORY_FILE_PATH, JSON.stringify(this._data, null, 2), 'utf-8');

      const totalRecords = Object.values(this._data.sales).reduce((s, arr) => s + arr.length, 0);
      console.log(`💾 CrossmallSalesHistory 保存完了: ${this._knownSet.size}注文, ${Object.keys(this._data.sales).length}SKU, ${totalRecords}レコード`);
    } catch (err) {
      console.error('⚠️ CrossmallSalesHistory ディスク保存失敗:', err.message);
    }
  }
}

// シングルトンとしてエクスポート
module.exports = new CrossmallSalesHistory();
