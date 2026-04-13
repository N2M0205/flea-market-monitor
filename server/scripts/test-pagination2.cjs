require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const CrossmallService = require('../services/CrossmallService');

const crossmall = new CrossmallService();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const targetDate = '2026-04-01';

  // 1回目: 通常取得
  console.log(`=== 1回目: 通常取得 ===`);
  const result1 = await crossmall.makeRequest('get_order', {
    order_date_fr: targetDate,
    order_date_to: targetDate
  });
  const rs1 = result1?.GetOrder?.ResultSet;
  const results1 = Array.isArray(rs1?.Result) ? rs1.Result : (rs1?.Result ? [rs1.Result] : []);
  const nums1 = results1.map(r => r.order_number).sort();
  console.log(`件数: ${results1.length}, 範囲: ${nums1[0]} ~ ${nums1[nums1.length - 1]}`);

  await sleep(1000);

  // 2回目: order_number のみ（conditionなし）→ 「>」のデフォルト動作を確認
  const lastNum = nums1[nums1.length - 1];
  console.log(`\n=== 2回目: order_number=${lastNum} (conditionなし) ===`);
  const result2 = await crossmall.makeRequest('get_order', {
    order_date_fr: targetDate,
    order_date_to: targetDate,
    order_number: lastNum
  });
  const rs2 = result2?.GetOrder?.ResultSet;
  const results2 = Array.isArray(rs2?.Result) ? rs2.Result : (rs2?.Result ? [rs2.Result] : []);
  const nums2 = results2.map(r => r.order_number).sort();

  if (results2.length > 0) {
    console.log(`件数: ${results2.length}, 範囲: ${nums2[0]} ~ ${nums2[nums2.length - 1]}`);

    // 重複チェック
    const set1 = new Set(nums1);
    const overlap = nums2.filter(n => set1.has(n));
    const newOnly = nums2.filter(n => !set1.has(n));
    console.log(`重複: ${overlap.length}件, 新規: ${newOnly.length}件`);

    // lastNumを含むか？
    console.log(`lastNum(${lastNum})を含む: ${nums2.includes(lastNum) ? 'はい(>=動作)' : 'いいえ(>動作)'}`);
  } else {
    console.log(`件数: 0`);
  }

  // 3回目: さらにページネーション（2回目の最後から）
  if (results2.length > 0 && results2.length >= 100) {
    await sleep(1000);
    const lastNum2 = nums2[nums2.length - 1];
    console.log(`\n=== 3回目: order_number=${lastNum2} ===`);
    const result3 = await crossmall.makeRequest('get_order', {
      order_date_fr: targetDate,
      order_date_to: targetDate,
      order_number: lastNum2
    });
    const rs3 = result3?.GetOrder?.ResultSet;
    const results3 = Array.isArray(rs3?.Result) ? rs3.Result : (rs3?.Result ? [rs3.Result] : []);
    console.log(`件数: ${results3.length}`);
  }

  // 合計
  const allNums = new Set([...nums1, ...nums2]);
  console.log(`\n=== 結果サマリ ===`);
  console.log(`${targetDate}: 1回目 ${results1.length}件 + 2回目 ${results2.length}件 = 合計 ${allNums.size}件 (重複除外)`);

  if (results2.length > 0 && allNums.size > results1.length) {
    console.log('✅ ページネーション成功！order_number パラメータ（conditionなし）で追加取得できた');
  } else if (results2.length > 0) {
    console.log('⚠️ 2回目に結果はあるが全て1回目と重複');
  } else {
    console.log('❌ ページネーション失敗');
  }
}

main().catch(e => console.error(e));
