/**
 * CROSSMALL 商品マスタ同期スクリプト
 *
 * - purchase_master_cache.json の SKU リストを使用（バルクAPIはアカウント非対応）
 * - getItemInfo() で1件ずつ取得（1秒/件 ウェイト）
 * - crossmall_items テーブルに UPSERT
 * - 差分同期: item_name 未設定 or purchase_master_cache 更新分のみ再取得
 * - 本番PM2登録はオーナー承認後
 *
 * 注: get_item の updated_at_fr バルクモードはこのアカウントで認証エラー（IP/契約制限）
 *   既存 syncItemNames() と同パターンの1件ずつ取得に変更
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const path = require('path');
const CrossmallService = require('../services/CrossmallService');

const DELAY_MS = 1000;
const CACHE_FILE = path.resolve(__dirname, '../../data/purchase_master_cache.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function deriveBaseCode(itemCode) {
  if (typeof itemCode !== 'string') return itemCode;
  return itemCode.endsWith('n') ? itemCode.slice(0, -1) : itemCode;
}

async function main() {
  const startTime = Date.now();
  console.log('\n' + '='.repeat(60));
  console.log(`[${new Date().toISOString()}] CROSSMALL 商品マスタ同期 開始`);
  console.log('='.repeat(60));

  // purchase_master_cache から SKU リストを取得
  let cachedItems;
  try {
    const raw = require(CACHE_FILE);
    cachedItems = Array.isArray(raw.items) ? raw.items : Object.values(raw.items || {});
  } catch (e) {
    console.error('❌ purchase_master_cache.json 読み込み失敗:', e.message);
    process.exit(1);
  }

  const skus = [...new Set(
    cachedItems
      .map(item => String(item.sku || item.crossmall_item_code || '').trim())
      .filter(Boolean)
  )];

  console.log(`📋 対象SKU数: ${skus.length} 件 (purchase_master_cache から)`);

  const db = require('../models');
  await db.sequelize.authenticate();
  const { CrossmallItem } = db;

  // 既にDBに登録済みで item_name がある SKU を確認（2回目以降は差分のみ）
  const existingItems = await CrossmallItem.findAll({
    attributes: ['item_code', 'item_name', 'synced_at'],
    raw: true,
  });
  const existingMap = new Map(existingItems.map(i => [i.item_code, i]));

  // 未登録 or item_name が空のSKUのみ対象
  const targetSkus = skus.filter(sku => {
    const ex = existingMap.get(sku);
    return !ex || !ex.item_name || ex.item_name === '(名称不明)';
  });

  console.log(`  既存DB: ${existingMap.size} 件`);
  console.log(`  新規/名称未取得: ${targetSkus.length} 件 → API取得対象`);

  if (targetSkus.length === 0) {
    console.log('✅ 差分なし（全件取得済み）');
    await db.sequelize.close();
    return;
  }

  const crossmall = new CrossmallService();
  const now = new Date();
  let upserted = 0;
  let errors = 0;
  let notFound = 0;

  for (let i = 0; i < targetSkus.length; i++) {
    const sku = targetSkus[i];
    try {
      const info = await crossmall.getItemInfo(sku);
      if (!info || !info.item_name) {
        notFound++;
        // item_name 不明でもUPSERT（'(名称不明)'）
        await CrossmallItem.upsert({
          item_code: sku,
          item_name: '(名称不明)',
          base_code: deriveBaseCode(sku),
          synced_at: now,
          created_at: now,
          updated_at: now,
        });
      } else {
        await CrossmallItem.upsert({
          item_code: info.item_code,
          item_name: info.item_name,
          base_code: deriveBaseCode(info.item_code),
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

    if ((i + 1) % 10 === 0 || i === targetSkus.length - 1) {
      console.log(`  進捗: ${i + 1}/${targetSkus.length} (upserted=${upserted}, notFound=${notFound}, errors=${errors})`);
    }

    await sleep(DELAY_MS);
  }

  // 完了サマリ
  const totalInDb = await CrossmallItem.count();

  // base_code検証
  const testCode = '2314-001247n';
  const testItem = await CrossmallItem.findByPk(testCode);
  const test2 = await CrossmallItem.findByPk('2314-001247');

  console.log('\n' + '='.repeat(60));
  console.log('✅ 商品マスタ同期完了');
  console.log(`  UPSERT 成功: ${upserted} 件, 名称取得失敗: ${notFound} 件, エラー: ${errors} 件`);
  console.log(`  DB 合計: ${totalInDb} 件`);
  if (test2) console.log(`  2314-001247 base_code: ${test2.base_code} (期待値: 2314-001247)`);
  if (testItem) console.log(`  2314-001247n base_code: ${testItem.base_code} (期待値: 2314-001247)`);
  console.log(`  所要時間: ${((Date.now() - startTime) / 1000).toFixed(1)} 秒`);
  console.log('='.repeat(60));

  await db.sequelize.close();
}

main().catch(e => {
  console.error('❌ 同期エラー:', e.message);
  process.exit(1);
});
