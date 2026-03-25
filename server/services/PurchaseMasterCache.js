// server/services/PurchaseMasterCache.js
// GASから送信される仕入れマスタデータをキャッシュするシングルトン
// - itemMap: { [crossmall_item_code]: { purchaseLimit, stock, sales28, lastSalePrice } }
// - data/purchase_master_cache.json にディスク永続化（VPS再起動対応）

const fs = require('fs');
const path = require('path');

// キャッシュファイルのパス（server/data/ ディレクトリ）
const CACHE_FILE_PATH = path.resolve(__dirname, '../../data/purchase_master_cache.json');

class PurchaseMasterCache {
  constructor() {
    this._cache = {
      syncedAt: null,
      totalItems: 0,
      items: [],
      itemMap: {},   // { crossmall_item_code → item }
    };

    // 起動時にディスクキャッシュを復元
    this._loadFromDisk();
  }

  // ─────────────────────────────────────────────
  // 公開API
  // ─────────────────────────────────────────────

  /**
   * crossmall_item_code でマスタ商品を取得
   * @param {string} sku - crossmall_item_code
   * @returns {{ purchaseLimit: number, stock: number, sales28: number } | null}
   */
  getMasterItem(sku) {
    if (!sku) return null;
    return this._cache.itemMap[String(sku).trim()] || null;
  }

  /**
   * キャッシュの状態情報を返す
   */
  getCacheStatus() {
    return {
      syncedAt: this._cache.syncedAt,
      totalItems: this._cache.totalItems,
      isCached: this._cache.totalItems > 0,
      lastSalePriceSyncedAt: this._cache.lastSalePriceSyncedAt || null,
    };
  }

  /**
   * GASからのデータでキャッシュを更新（sync.js から呼ばれる）
   * @param {{ syncedAt: string, totalItems: number, items: Array }} payload
   */
  updateCache(payload) {
    const { syncedAt, items, totalItems } = payload;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items が空または不正です');
    }

    // itemMap を再構築
    const itemMap = {};
    for (const item of items) {
      const code = String(item.sku || item.crossmall_item_code || '').trim();
      if (!code) continue;
      itemMap[code] = {
        purchaseLimit: Number(item.purchaseLimit) || 0,
        stock:         Number(item.stock)         || 0,
        sales28:       Number(item.sales28)       || 0,
        productName:   item.productName || '',
      };
    }

    this._cache = {
      syncedAt:   syncedAt || new Date().toISOString(),
      totalItems: totalItems || items.length,
      items,
      itemMap,
    };

    this._saveToDisk();

    console.log(`✅ PurchaseMasterCache 更新完了: ${Object.keys(itemMap).length}件, syncedAt=${this._cache.syncedAt}`);
  }

  /**
   * CROSSMALL注文データからlastSalePrice・deliveryTypeを一括更新
   * @param {Map<string, { price: number, orderNumber: string, deliveryType: string }>} priceMap
   * @returns {{ updated: number, notFound: number }} 更新結果
   */
  updateLastSalePrices(priceMap) {
    let updated = 0;
    let notFound = 0;

    for (const [itemCode, info] of priceMap) {
      const item = this._cache.itemMap[itemCode];
      if (item) {
        item.lastSalePrice = info.price;
        if (info.deliveryType) item.deliveryType = info.deliveryType;
        if (info.sales7 != null) item.sales7 = info.sales7;
        if (info.sales28 != null) item.sales28 = info.sales28;
        if (info.lastSaleDate) item.lastSaleDate = info.lastSaleDate;
        updated++;
      } else {
        notFound++;
      }
    }

    // items配列にも反映（ディスク保存用）
    for (const item of this._cache.items) {
      const code = String(item.sku || item.crossmall_item_code || '').trim();
      const priceInfo = priceMap.get(code);
      if (priceInfo) {
        item.lastSalePrice = priceInfo.price;
        if (priceInfo.deliveryType) item.deliveryType = priceInfo.deliveryType;
        if (priceInfo.sales7 != null) item.sales7 = priceInfo.sales7;
        if (priceInfo.sales28 != null) item.sales28 = priceInfo.sales28;
        if (priceInfo.lastSaleDate) item.lastSaleDate = priceInfo.lastSaleDate;
      }
    }

    this._cache.lastSalePriceSyncedAt = new Date().toISOString();
    this._saveToDisk();

    console.log(`✅ lastSalePrice更新完了: ${updated}件更新, ${notFound}件マスタ未登録`);
    return { updated, notFound };
  }

  // ─────────────────────────────────────────────
  // プライベートメソッド
  // ─────────────────────────────────────────────

  _loadFromDisk() {
    try {
      if (!fs.existsSync(CACHE_FILE_PATH)) {
        console.log('ℹ️ PurchaseMasterCache: キャッシュファイルなし（初回起動）');
        return;
      }
      const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);

      if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
        // itemMap を再構築
        const itemMap = {};
        for (const item of parsed.items) {
          const code = String(item.sku || item.crossmall_item_code || '').trim();
          if (code) itemMap[code] = item;
        }
        this._cache = { ...parsed, itemMap };
        console.log(`✅ PurchaseMasterCache 復元完了: ${parsed.items.length}件, syncedAt=${parsed.syncedAt}`);
      }
    } catch (err) {
      console.error('⚠️ PurchaseMasterCache ディスク読み込み失敗（空キャッシュで続行）:', err.message);
    }
  }

  _saveToDisk() {
    try {
      const dir = path.dirname(CACHE_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // itemMap は再構築可能なので保存対象から除外してサイズ削減
      const { itemMap: _omit, ...toSave } = this._cache;
      fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(toSave, null, 2), 'utf-8');
      console.log(`💾 PurchaseMasterCache ディスク保存完了: ${CACHE_FILE_PATH}`);
    } catch (err) {
      console.error('⚠️ PurchaseMasterCache ディスク保存失敗:', err.message);
    }
  }
}

// シングルトンとしてエクスポート
module.exports = new PurchaseMasterCache();
