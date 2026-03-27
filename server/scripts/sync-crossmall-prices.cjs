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
 * 指定期間の注文番号を1日単位で分割取得（1回ごとに1秒待機）
 * 100件/日上限ヒット時は警告ログを出力
 */
async function fetchOrderNumbersChunked(crossmall, fromDate, toDate) {
  const orderMetaMap = new Map();
  const current = new Date(fromDate);
  let chunkIndex = 0;
  let limitHitDays = 0;

  console.log(`🔍 注文番号取得: ${formatDate(fromDate)} ~ ${formatDate(toDate)} (1日単位分割)`);

  while (current <= toDate) {
    const { orderNumbers: nums, orderMeta, hitLimit } = await crossmall.fetchOrdersForRange(current, current);

    for (const n of nums) {
      if (!orderMetaMap.has(n)) orderMetaMap.set(n, orderMeta.get(n));
    }

    chunkIndex++;
    if (hitLimit) {
      limitHitDays++;
      console.log(`  [${chunkIndex}] ${formatDate(current)}: ${nums.length}件 ⚠️ 上限100件ヒット（取りこぼしあり） (累計: ${orderMetaMap.size})`);
    } else if (nums.length > 0) {
      console.log(`  [${chunkIndex}] ${formatDate(current)}: ${nums.length}件 (累計: ${orderMetaMap.size})`);
    }

    current.setDate(current.getDate() + 1);
    await sleep(FETCH_DELAY_MS);
  }

  const orderNumbers = [...orderMetaMap.keys()].sort();
  console.log(`✅ ${orderNumbers.length}件の注文を取得 (${chunkIndex}回のAPIコール)`);
  if (limitHitDays > 0) {
    console.warn(`⚠️ ${limitHitDays}日で100件上限ヒット（一部注文の取りこぼしあり）`);
  }
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

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ CROSSMALL販売データ蓄積同期でエラー:', err);
    process.exit(1);
  });
