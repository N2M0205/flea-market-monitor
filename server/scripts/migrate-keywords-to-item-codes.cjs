/**
 * Phase 2: 既存キーワードの item_codes 移行スクリプト
 *
 * 処理内容:
 *   1. Keywords テーブルの全レコードを取得
 *   2. crossmall_item_code が設定されている場合、base_code でcrossmall_items を検索
 *   3. ヒットした全 item_code（n 変種含む）をカンマ区切りで item_codes に書き込み
 *   4. crossmall_item_code が NULL / 空文字の場合は item_codes = NULL
 *
 * 冪等性: 再実行しても同じ結果（毎回再計算して上書き）
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Keyword, CrossmallItem, sequelize } = require('../models');
const { Op } = require('sequelize');

function deriveBaseCode(itemCode) {
  if (typeof itemCode !== 'string' || itemCode === '') return null;
  return itemCode.endsWith('n') ? itemCode.slice(0, -1) : itemCode;
}

async function main() {
  console.log('=== Phase 2: Keywords → item_codes 移行 ===');
  console.log('');

  // ── 移行前のスナップショット ──────────────────────────────
  const before = await Keyword.findAll({ order: [['keyword', 'ASC']] });
  console.log(`移行前: Keywords ${before.length} 件`);
  const beforeWithCode = before.filter(k => k.crossmall_item_code);
  const beforeNull     = before.filter(k => !k.crossmall_item_code);
  console.log(`  crossmall_item_code 設定済み: ${beforeWithCode.length} 件`);
  console.log(`  crossmall_item_code NULL/空  : ${beforeNull.length} 件`);
  console.log('');

  // ── crossmall_items から base_code 別にグループ化 ─────────
  // 全 crossmall_items を一括取得してメモリで検索（162件程度なのでOK）
  const allItems = await CrossmallItem.findAll({
    attributes: ['item_code', 'base_code', 'item_name'],
  });

  // base_code → [item_codes] の Map を構築
  // ソート: base_code 本体を先頭、n 変種を後ろ
  const baseMap = new Map();
  for (const item of allItems) {
    const bc = item.base_code;
    if (!bc) continue;
    if (!baseMap.has(bc)) baseMap.set(bc, []);
    baseMap.get(bc).push(item.item_code);
  }
  // 各グループを base_code 本体優先でソート
  for (const [bc, codes] of baseMap) {
    codes.sort((a, b) => {
      if (a === bc) return -1;
      if (b === bc) return 1;
      return a.localeCompare(b);
    });
  }

  // ── 移行処理 ─────────────────────────────────────────────
  let updated = 0, skippedNull = 0, fallbackDirect = 0;
  const report = [];

  for (const kw of before) {
    const rawCode = kw.crossmall_item_code;

    // NULL / 空文字 → item_codes = NULL
    if (!rawCode) {
      await kw.update({ item_codes: null });
      skippedNull++;
      report.push({ keyword: kw.keyword, crossmall_item_code: 'NULL', item_codes: 'NULL', note: 'item_code未設定' });
      continue;
    }

    const baseCode = deriveBaseCode(rawCode);
    let resolvedCodes;

    if (baseCode && baseMap.has(baseCode)) {
      // crossmall_items に登録あり → n 変種を抱き合わせ
      resolvedCodes = baseMap.get(baseCode).join(',');
    } else {
      // crossmall_items に未登録 → crossmall_item_code をそのまま使用（後方互換）
      resolvedCodes = rawCode;
      fallbackDirect++;
    }

    await kw.update({ item_codes: resolvedCodes });
    updated++;

    const codesArr = resolvedCodes.split(',');
    const hasN = codesArr.some(c => c.endsWith('n'));
    report.push({
      keyword:             kw.keyword,
      crossmall_item_code: rawCode,
      item_codes:          resolvedCodes,
      note:                hasN ? `★n変種あり(${codesArr.length}件)` : `${codesArr.length}件`
    });
  }

  // ── 移行後の確認 ─────────────────────────────────────────
  const after = await Keyword.findAll({ order: [['keyword', 'ASC']] });

  console.log('=== 移行結果サマリー ===');
  console.log(`  総件数          : ${after.length} 件（移行前 ${before.length} 件）`);
  console.log(`  item_codes 更新 : ${updated} 件`);
  console.log(`  NULL 維持       : ${skippedNull} 件`);
  console.log(`  直接フォールバック: ${fallbackDirect} 件（crossmall_items 未登録）`);
  console.log('');

  // 特定キーワードの抜粋
  const spotCheck = ['セノッピー', 'セノッピー チュアブル', 'SENOPPY CHEWABLE', 'risou no Coffee 30', 'ToyLaBO', 'トイラボ', 'WiQo'];
  console.log('=== 抜粋確認 ===');
  for (const name of spotCheck) {
    const kw = after.find(k => k.keyword === name);
    if (kw) {
      console.log(`  [${kw.keyword}]`);
      console.log(`    crossmall_item_code: ${kw.crossmall_item_code || 'NULL'}`);
      console.log(`    item_codes         : ${kw.item_codes || 'NULL'}`);
    }
  }
  console.log('');

  // n 変種ありを優先表示した全件レポート
  const nVariants = report.filter(r => r.note?.includes('★'));
  if (nVariants.length > 0) {
    console.log('=== n変種あり ===');
    nVariants.forEach(r => {
      console.log(`  ${r.keyword}: ${r.item_codes}  (${r.note})`);
    });
    console.log('');
  } else {
    console.log('（n変種あり: 0件）');
    console.log('');
  }

  // 全キーワードレポート
  console.log('=== 全キーワード 移行結果 ===');
  console.log('keyword'.padEnd(32) + '| crossmall_item_code'.padEnd(22) + '| item_codes');
  console.log('-'.repeat(80));
  for (const r of report) {
    console.log(
      r.keyword.padEnd(32) +
      '| ' + r.crossmall_item_code.padEnd(20) +
      '| ' + r.item_codes
    );
  }

  console.log('');
  console.log('✅ 移行完了');
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('❌ 移行エラー:', e.message);
    console.error(e.stack);
    process.exit(1);
  });
