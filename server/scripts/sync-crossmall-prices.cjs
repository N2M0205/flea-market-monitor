/**
 * CROSSMALL注文データから最新販売価格を取得し、PurchaseMasterCacheに反映する定期実行スクリプト
 *
 * 処理フロー:
 *   1. get_order (90日間) で注文番号リストを取得
 *   2. get_order_detail で各注文のItemCodeと販売価格を取得
 *   3. ItemCode末尾の n/s を除去してマスタSKU (2314-XXXXXX) にマッピング
 *   4. PurchaseMasterCacheの各アイテムに lastSalePrice を追加保存
 *
 * PM2 cron: 6時間ごとに実行推奨
 *   pm2 start server/scripts/sync-crossmall-prices.cjs --name crossmall-price-sync --cron "0 *\/6 * * *" --no-autorestart
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const CrossmallService = require('../services/CrossmallService');
const purchaseMasterCache = require('../services/PurchaseMasterCache');

const DAYS = 90;

async function main() {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toISOString()}] CROSSMALL価格同期 開始 (過去${DAYS}日間)`);
  console.log(`${'='.repeat(60)}`);

  // キャッシュ状態確認
  const cacheStatus = purchaseMasterCache.getCacheStatus();
  if (!cacheStatus.isCached) {
    console.log('⚠️ PurchaseMasterCacheが空です。GAS同期を先に実行してください。');
    process.exit(1);
  }
  console.log(`マスタ件数: ${cacheStatus.totalItems}, 最終同期: ${cacheStatus.syncedAt}`);

  // CROSSMALL APIから全SKUの最新販売価格を取得
  const crossmall = new CrossmallService();
  const priceMap = await crossmall.getAllLastSalePrices(DAYS);

  if (priceMap.size === 0) {
    console.log('⚠️ 販売価格データが取得できませんでした。');
    process.exit(0);
  }

  console.log(`\n取得した価格データ: ${priceMap.size}種類`);

  // マスタに反映
  const result = purchaseMasterCache.updateLastSalePrices(priceMap);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toISOString()}] CROSSMALL価格同期 完了`);
  console.log(`  更新: ${result.updated}件, マスタ未登録: ${result.notFound}件`);
  console.log(`  所要時間: ${elapsed}秒`);
  console.log(`${'='.repeat(60)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ CROSSMALL価格同期でエラー:', err);
    process.exit(1);
  });
