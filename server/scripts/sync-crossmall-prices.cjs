/**
 * CROSSMALL販売データ蓄積型同期スクリプト
 *
 * 処理フロー:
 *   1. CrossmallSalesHistory から前回同期状態を読み込み
 *   2. 初回: 過去90日分を1日単位で分割取得（1回ごとに1秒待機）
 *      2回目以降: 前回最新注文日からの差分のみ取得
 *   3. 新規注文のみ履歴に追加（既知の注文番号はスキップ）
 *   4. 蓄積データから sales7/sales28/lastSalePrice を算出
 *   5. PurchaseMasterCache に反映
 *   6. 90日超の古いレコードを自動パージ
 *
 * PM2 cron: 6時間ごとに実行
 *   pm2 start server/scripts/sync-crossmall-prices.cjs --name crossmall-price-sync --cron "0 *\/6 * * *" --no-autorestart
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const CrossmallService = require('../services/CrossmallService');
const purchaseMasterCache = require('../services/PurchaseMasterCache');
const salesHistory = require('../services/CrossmallSalesHistory');

const INITIAL_FETCH_DAYS = 90;  // 初回取得期間
const FETCH_MARGIN_DAYS = 2;    // 差分取得時のマージン（取りこぼし防止）
const PRUNE_DAYS = 90;          // これより古い販売レコードを削除
const FETCH_DELAY_MS = 1000;    // 1回の取得ごとに1秒待機
const SAVE_INTERVAL = 50;       // N件ごとに中間保存（クラッシュ復旧用）

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 1日分の注文を全件取得（order_numberページネーション対応）
 * 100件返ってきたら最後のorder_numberで次ページを取得するループ
 * 最大10ページ（1,000件/日）で安全停止
 */
const MAX_PAGES_PER_DAY = 10;

async function fetchAllOrdersForDate(crossmall, date) {
  const dateStr = formatDate(date);
  const allOrderNumbers = [];
  const allOrderMeta = new Map();
  let lastOrderNumber = null;
  let page = 0;

  while (page < MAX_PAGES_PER_DAY) {
    const { orderNumbers: nums, orderMeta, hitLimit } = await crossmall.fetchOrdersForRange(date, date, lastOrderNumber);

    for (const n of nums) {
      if (!allOrderMeta.has(n)) {
        allOrderNumbers.push(n);
        allOrderMeta.set(n, orderMeta.get(n));
      }
    }

    page++;

    if (nums.length < 100) break; // 最終ページ

    // 次ページ用に最後のorder_numberを記録
    const sorted = [...nums].sort();
    lastOrderNumber = sorted[sorted.length - 1];
    console.log(`  📄 ${dateStr}: ページ${page + 1}取得中（${lastOrderNumber}以降）`);
    await sleep(FETCH_DELAY_MS);
  }

  return { orderNumbers: allOrderNumbers, orderMeta: allOrderMeta, pages: page };
}

/**
 * 指定期間の注文番号を1日単位で分割取得（ページネーション対応）
 */
async function fetchOrderNumbersChunked(crossmall, fromDate, toDate) {
  const orderMetaMap = new Map();
  const current = new Date(fromDate);
  let chunkIndex = 0;
  let totalApiCalls = 0;

  console.log(`🔍 注文番号取得: ${formatDate(fromDate)} ~ ${formatDate(toDate)} (1日単位分割+ページネーション)`);

  while (current <= toDate) {
    const { orderNumbers: nums, orderMeta, pages } = await fetchAllOrdersForDate(crossmall, current);

    for (const n of nums) {
      if (!orderMetaMap.has(n)) orderMetaMap.set(n, orderMeta.get(n));
    }

    chunkIndex++;
    totalApiCalls += pages;

    if (nums.length > 0) {
      const pageInfo = pages > 1 ? ` (${pages}ページ)` : '';
      console.log(`  [${chunkIndex}] ${formatDate(current)}: ${nums.length}件${pageInfo} (累計: ${orderMetaMap.size})`);
    }

    current.setDate(current.getDate() + 1);
    await sleep(FETCH_DELAY_MS);
  }

  const orderNumbers = [...orderMetaMap.keys()].sort();
  console.log(`✅ ${orderNumbers.length}件の注文を取得 (${totalApiCalls}回のAPIコール)`);
  return { orderNumbers, orderMetaMap };
}

async function main() {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toISOString()}] CROSSMALL販売データ蓄積同期 開始`);
  console.log(`${'='.repeat(60)}`);

  // キャッシュ状態確認
  const cacheStatus = purchaseMasterCache.getCacheStatus();
  if (!cacheStatus.isCached) {
    console.log('⚠️ PurchaseMasterCacheが空です。GAS同期を先に実行してください。');
    process.exit(1);
  }
  console.log(`マスタ件数: ${cacheStatus.totalItems}, 最終同期: ${cacheStatus.syncedAt}`);

  // 前回同期状態を確認
  const syncInfo = salesHistory.getLastSyncInfo();
  console.log(`\n📊 蓄積データ状態:`);
  console.log(`  最終同期: ${syncInfo.lastSyncedAt || '(初回)'}`);
  console.log(`  最新注文日: ${syncInfo.newestOrderDate || '(なし)'}`);
  console.log(`  蓄積注文数: ${syncInfo.totalOrders}`);
  console.log(`  蓄積SKU数: ${syncInfo.totalSkus}`);

  // 取得期間を決定
  const now = new Date();
  let fromDate;

  if (!syncInfo.lastSyncedAt || syncInfo.totalOrders === 0) {
    // 初回: 過去90日分
    fromDate = new Date(now);
    fromDate.setDate(now.getDate() - INITIAL_FETCH_DAYS);
    console.log(`\n🔄 初回同期: 過去${INITIAL_FETCH_DAYS}日分を1日単位で分割取得`);
  } else {
    // 差分取得: 最新注文日 - マージン
    fromDate = new Date(syncInfo.newestOrderDate);
    fromDate.setDate(fromDate.getDate() - FETCH_MARGIN_DAYS);
    const diffDays = Math.ceil((now.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`\n🔄 差分同期: 過去${diffDays}日分を取得（最新注文日: ${syncInfo.newestOrderDate}）`);
  }

  // 注文番号を1日単位で分割取得
  const crossmall = new CrossmallService();
  const { orderNumbers, orderMetaMap } = await fetchOrderNumbersChunked(crossmall, fromDate, now);

  if (orderNumbers.length === 0) {
    console.log('⚠️ 該当期間に注文なし');
    const priceMap = salesHistory.computeStats();
    if (priceMap.size > 0) {
      purchaseMasterCache.updateLastSalePrices(priceMap);
    }
    salesHistory.save();
    logCompletion(startTime, 0, 0);
    process.exit(0);
  }

  // 新規注文のみフィルタ
  const newOrderNumbers = orderNumbers.filter(n => !salesHistory.hasOrder(n));
  console.log(`\n取得注文数: ${orderNumbers.length}, うち新規: ${newOrderNumbers.length}, 既知(スキップ): ${orderNumbers.length - newOrderNumbers.length}`);

  // 新規注文の詳細を取得して蓄積（1件ごとに1秒待機）
  let processed = 0;
  for (const orderNumber of newOrderNumbers) {
    const details = await crossmall.getOrderDetail(orderNumber);
    const meta = orderMetaMap.get(orderNumber);

    // order_dateをパース ("2026/01/15 12:34:56" 形式 → "2026-01-15")
    const orderDateStr = meta?.orderDate || '';
    let orderDate = '';
    if (orderDateStr) {
      const d = new Date(orderDateStr.replace(/\//g, '-'));
      if (!isNaN(d.getTime())) {
        orderDate = d.toISOString().slice(0, 10);
      }
    }

    if (orderDate && details.length > 0) {
      salesHistory.addOrder(orderNumber, orderDate, meta?.deliveryType || '', details);
    }

    processed++;
    if (processed % SAVE_INTERVAL === 0) {
      console.log(`  ${processed}/${newOrderNumbers.length} 新規注文処理済み（中間保存）`);
      salesHistory.save();
    }

    await sleep(FETCH_DELAY_MS);
  }

  // 古いレコードをパージ（90日超）
  salesHistory.pruneOldRecords(PRUNE_DAYS);

  // 蓄積データを保存
  salesHistory.save();

  // 蓄積データから統計を算出してマスタに反映
  const priceMap = salesHistory.computeStats();
  console.log(`\n統計算出完了: ${priceMap.size}種類のSKU`);

  if (priceMap.size > 0) {
    const result = purchaseMasterCache.updateLastSalePrices(priceMap);
    logCompletion(startTime, newOrderNumbers.length, result.updated);
  } else {
    logCompletion(startTime, newOrderNumbers.length, 0);
  }
}

function logCompletion(startTime, newOrders, updatedItems) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const syncInfo = salesHistory.getLastSyncInfo();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toISOString()}] CROSSMALL販売データ蓄積同期 完了`);
  console.log(`  新規注文: ${newOrders}件`);
  console.log(`  マスタ更新: ${updatedItems}件`);
  console.log(`  蓄積合計: ${syncInfo.totalOrders}注文, ${syncInfo.totalSkus}SKU`);
  console.log(`  所要時間: ${elapsed}秒`);
  console.log(`${'='.repeat(60)}\n`);
}

/**
 * 全SKUの在庫数を get_stock APIで取得し、PurchaseMasterCache に反映
 */
async function syncStock(crossmall) {
  const items = purchaseMasterCache._cache.items;
  if (!items || items.length === 0) {
    console.log('⚠️ 在庫同期スキップ: マスタが空です');
    return;
  }

  console.log(`\n📦 在庫同期開始: ${items.length}件のSKU`);

  let updated = 0;
  let errors = 0;

  for (const item of items) {
    const itemCode = String(item.sku || item.crossmall_item_code || '').trim();
    if (!itemCode) continue;

    try {
      const stockInfo = await crossmall.getStockInfo(itemCode);
      if (stockInfo && stockInfo.stock != null) {
        item.stock = stockInfo.stock;
        updated++;
      }
    } catch (error) {
      console.error(`  ❌ 在庫取得失敗: ${itemCode} ${error.message}`);
      errors++;
    }

    await sleep(FETCH_DELAY_MS);
  }

  purchaseMasterCache._saveToDisk();
  console.log(`✅ 在庫同期完了: ${updated}件更新, ${errors}件エラー`);
}

/**
 * item_name が未設定のSKUの商品名を get_item APIで取得してキャッシュに保存
 */
async function syncItemNames(crossmall) {
  const items = purchaseMasterCache._cache.items;
  if (!items || items.length === 0) {
    console.log('⚠️ 商品名同期スキップ: マスタが空です');
    return;
  }

  const targets = items.filter(item => !item.item_name || item.item_name === '不明');
  console.log(`\n🏷️  商品名同期開始: 未設定 ${targets.length}件 / 全${items.length}件`);

  if (targets.length === 0) {
    console.log('商品名更新不要（全SKUに商品名あり）');
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const item of targets) {
    const itemCode = String(item.sku || item.crossmall_item_code || '').trim();
    if (!itemCode) continue;

    try {
      const info = await crossmall.getItemInfo(itemCode);
      if (info && info.item_name) {
        item.item_name = info.item_name;
        updated++;
      }
    } catch (error) {
      console.error(`  ❌ 商品名取得失敗: ${itemCode} ${error.message}`);
      errors++;
    }

    await sleep(FETCH_DELAY_MS);
  }

  purchaseMasterCache._saveToDisk();
  console.log(`✅ 商品名同期完了: ${updated}件更新, ${errors}件エラー`);
}

/**
 * picofuri-backend の PurchaseMasterCache をホットリロード
 */
async function notifyCacheReload() {
  const port = process.env.PORT || 3001;
  const url = `http://localhost:${port}/api/cache/reload`;
  console.log(`\n[CACHE-RELOAD] backendにキャッシュリロードを通知: ${url}`);
  try {
    const res = await fetch(url, { method: 'POST' });
    const body = await res.json();
    if (body.success) {
      console.log(`[CACHE-RELOAD] 成功: ${body.itemCount}件リロード (${body.reloadedAt})`);
    } else {
      console.warn(`[CACHE-RELOAD] リロード失敗: ${JSON.stringify(body)}`);
    }
  } catch (err) {
    console.warn(`[CACHE-RELOAD] 通知失敗（backendが停止中?）: ${err.message}`);
  }
}

main()
  .then(async () => {
    const crossmall = new CrossmallService();
    await syncStock(crossmall);
    await syncItemNames(crossmall);
    await notifyCacheReload();
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ CROSSMALL販売データ蓄積同期でエラー:', err);
    process.exit(1);
  });
