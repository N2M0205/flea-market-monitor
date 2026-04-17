/**
 * CROSSMALL 在庫同期スクリプト
 *
 * - crossmall_items テーブルの SKU リストを使用して在庫を取得
 * - getStockInfo() で1件ずつ取得（1秒/件 ウェイト）
 * - crossmall_stock テーブルに UPSERT
 * - crossmall_items 未登録の item_code はスキップ（ログ警告）
 * - 本番PM2登録はオーナー承認後
 *
 * 注: get_diff_stock の updated_at_fr バルクモードはこのアカウントで認証エラー（IP/契約制限）
 *   既存 syncStock() と同パターンの getStockInfo() 1件ずつに変更
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const CrossmallService = require('../services/CrossmallService');

const DELAY_MS = 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const startTime = Date.now();
  console.log('\n' + '='.repeat(60));
  console.log(`[${new Date().toISOString()}] CROSSMALL 在庫同期 開始`);
  console.log('='.repeat(60));

  const db = require('../models');
  await db.sequelize.authenticate();
  const { CrossmallItem, CrossmallStock } = db;

  // crossmall_items から SKU リストを取得
  const itemRows = await CrossmallItem.findAll({ attributes: ['item_code'], raw: true });
  const skus = itemRows.map(r => r.item_code);

  console.log(`📋 crossmall_items に登録済み SKU: ${skus.length} 件`);

  if (skus.length === 0) {
    console.log('⚠️ crossmall_items が空です。先に sync-crossmall-items.cjs を実行してください。');
    await db.sequelize.close();
    process.exit(1);
  }

  const crossmall = new CrossmallService();
  const now = new Date();
  let upserted = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];
    try {
      const stockInfo = await crossmall.getStockInfo(sku);
      if (!stockInfo || stockInfo.stock == null) {
        notFound++;
        // stock取得不可 → crossmall_stock にレコードがあれば残す（削除しない）
      } else {
        await CrossmallStock.upsert({
          item_code: sku,
          stock_count: stockInfo.stock,
          crossmall_updated_at: null,
          synced_at: now,
          created_at: now,
          updated_at: now,
        });
        upserted++;
      }
    } catch (err) {
      console.error(`  ❌ ${sku}:`, err.message);
      errors++;
    }

    if ((i + 1) % 10 === 0 || i === skus.length - 1) {
      console.log(`  進捗: ${i + 1}/${skus.length} (upserted=${upserted}, notFound=${notFound}, errors=${errors})`);
    }

    await sleep(DELAY_MS);
  }

  // 完了サマリ
  const totalInDb = await CrossmallStock.count();
  const sample = await CrossmallStock.findByPk('2314-001247');

  console.log('\n' + '='.repeat(60));
  console.log('✅ 在庫同期完了');
  console.log(`  UPSERT 成功: ${upserted} 件, 取得失敗: ${notFound} 件, エラー: ${errors} 件`);
  console.log(`  crossmall_stock 合計: ${totalInDb} 件`);
  if (sample) console.log(`  2314-001247 在庫: ${sample.stock_count}`);
  console.log(`  所要時間: ${((Date.now() - startTime) / 1000).toFixed(1)} 秒`);
  console.log('='.repeat(60));

  await db.sequelize.close();
}

main().catch(e => {
  console.error('❌ 在庫同期エラー:', e.message);
  process.exit(1);
});
