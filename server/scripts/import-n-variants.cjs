/**
 * Phase 2.5: n 変種 item_code の CROSSMALL API 取り込み（一時スクリプト）
 *
 * 対象: Keywords テーブル参照中の item_code + セノッピー family の n 変種候補
 * 処理: get_item API で存在確認 → crossmall_items に UPSERT
 * 冪等: 既存レコードは synced_at を更新して上書き
 * ウェイト: 1秒/件
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { CrossmallItem, Keyword, sequelize } = require('../models');
const CrossmallService = require('../services/CrossmallService');
const { Op } = require('sequelize');

// ── 候補リスト（Phase 2.5 スコープ） ──────────────────────────────────────
// Keywords 参照中 item_code の n 変種 + セノッピー family
const CANDIDATES = [
  '2314-0001070n',
  '2314-000192n',
  '2314-000278n',
  '2314-000519n',
  '2314-000521n',
  '2314-000710n',
  '2314-000739n',   // セノッピー パインマンゴー (Keywords 外だが確認)
  '2314-000835n',
  '2314-000889n',
  '2314-001052n',   // セノッピー もも
  '2314-001057n',
  '2314-001180n',
  '2314-001216n',
  '2314-001246n',
  '2314-001247n',   // セノッピー チュアブル ★最重要
  '2314-001325n',
  '2314-001330n',
  '2314-001333n',
  '2314-001346n',
  '2314-001351n',
  '2314-001441n',
  '2314-001462n',   // セノッピー リンゴ
  '2314-001572n',
  '2314-001636n',   // セノッピー チュアブル オレンジ
  '2314-001811n',
  '2314-001822n',
  '2314-001830n',
  '2314-001831n',
  '2314-001848n',
  '2314-001856n',
  '2314-001867n',
  '2314-001876n',
  '2314-001895n',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function deriveBaseCode(itemCode) {
  if (typeof itemCode !== 'string' || itemCode === '') return itemCode;
  return itemCode.endsWith('n') ? itemCode.slice(0, -1) : itemCode;
}

async function main() {
  console.log('=== Phase 2.5: n 変種 API 取り込み ===');
  console.log(`候補: ${CANDIDATES.length} 件`);
  console.log('');

  const svc = new CrossmallService();

  // 既に crossmall_items に存在するものはスキップログのみ
  const existing = await CrossmallItem.findAll({
    where: { item_code: { [Op.in]: CANDIDATES } },
    attributes: ['item_code']
  });
  const existingSet = new Set(existing.map(i => i.item_code));
  if (existingSet.size > 0) {
    console.log(`既存登録済み: ${existingSet.size} 件 → 再 UPSERT で synced_at 更新`);
    console.log('  ' + [...existingSet].join(', '));
    console.log('');
  }

  let imported = 0, skipped = 0, errors = 0;
  const results = [];

  for (let i = 0; i < CANDIDATES.length; i++) {
    const itemCode = CANDIDATES[i];
    const baseCode = deriveBaseCode(itemCode);
    console.log(`[${String(i + 1).padStart(2)}/${CANDIDATES.length}] ${itemCode} ...`);

    try {
      const info = await svc.getItemInfo(itemCode);

      if (!info || !info.item_name) {
        console.log(`  → ⚪ スキップ（API応答なし / 存在しない）`);
        skipped++;
        results.push({ item_code: itemCode, result: 'skip', item_name: null });
      } else {
        // UPSERT
        await CrossmallItem.upsert({
          item_code:  itemCode,
          item_name:  info.item_name,
          base_code:  baseCode,
          synced_at:  new Date(),
        });
        console.log(`  → ✅ 取り込み成功: ${info.item_name}`);
        imported++;
        results.push({ item_code: itemCode, result: 'imported', item_name: info.item_name });
      }
    } catch (e) {
      console.log(`  → ❌ エラー: ${e.message}`);
      errors++;
      results.push({ item_code: itemCode, result: 'error', item_name: e.message });
    }

    if (i < CANDIDATES.length - 1) await sleep(1000);
  }

  // ── サマリー ────────────────────────────────────────────────
  console.log('');
  console.log('='.repeat(60));
  console.log('【取り込みサマリー】');
  console.log('='.repeat(60));
  console.log(`  取り込み成功 : ${imported} 件`);
  console.log(`  スキップ     : ${skipped} 件（CROSSMALL に存在しない）`);
  console.log(`  エラー       : ${errors} 件`);
  console.log('');

  const importedItems = results.filter(r => r.result === 'imported');
  if (importedItems.length > 0) {
    console.log('【取り込んだ n 変種一覧】');
    importedItems.forEach(r => console.log(`  ${r.item_code} : ${r.item_name}`));
    console.log('');
  }

  const skippedItems = results.filter(r => r.result === 'skip');
  if (skippedItems.length > 0) {
    console.log('【存在しなかった候補】');
    skippedItems.forEach(r => console.log(`  ${r.item_code}`));
    console.log('');
  }

  // crossmall_items の n 変種の最終確認
  const nInDB = await CrossmallItem.findAll({
    where: { item_code: { [Op.like]: '%n' } },
    attributes: ['item_code', 'item_name', 'base_code'],
    order: [['item_code', 'ASC']]
  });
  console.log(`【crossmall_items の n 変種 (全件): ${nInDB.length} 件】`);
  nInDB.forEach(i => console.log(`  ${i.item_code.padEnd(20)} base=${i.base_code.padEnd(18)} ${i.item_name}`));

  console.log('');
  console.log('✅ Phase 2.5 API取り込み完了');
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('❌ 実行エラー:', e.message);
    console.error(e.stack);
    process.exit(1);
  });
