require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const CrossmallService = require('../services/CrossmallService');

const crossmall = new CrossmallService();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const targetDate = '2026-04-01';
  console.log(`\n=== ステップ2: ${targetDate} の件数確認 ===`);

  const result1 = await crossmall.makeRequest('get_order', {
    order_date_fr: targetDate,
    order_date_to: targetDate
  });

  const rs1 = result1?.GetOrder?.ResultSet;
  const totalResult1 = rs1?.ResultStatus?.TotalResult || '?';
  const results1 = Array.isArray(rs1?.Result) ? rs1.Result : (rs1?.Result ? [rs1.Result] : []);

  console.log(`TotalResult: ${totalResult1}`);
  console.log(`返却件数: ${results1.length}`);

  if (results1.length === 0) {
    console.log('注文なし。終了');
    return;
  }

  // order_numberを昇順ソート
  const orderNums1 = results1.map(r => r.order_number).sort();
  console.log(`最小order_number: ${orderNums1[0]}`);
  console.log(`最大order_number: ${orderNums1[orderNums1.length - 1]}`);

  // ステップ3: ページネーションテスト
  console.log(`\n=== ステップ3: ページネーションテスト (condition=1) ===`);
  const lastOrderNum = orderNums1[orderNums1.length - 1];
  console.log(`2回目: order_number=${lastOrderNum}, condition=1 (より大きい)`);

  await sleep(1000);

  const result2 = await crossmall.makeRequest('get_order', {
    order_date_fr: targetDate,
    order_date_to: targetDate,
    order_number: lastOrderNum,
    condition: '1'
  });

  const rs2 = result2?.GetOrder?.ResultSet;
  const totalResult2 = rs2?.ResultStatus?.TotalResult || '?';
  const results2 = Array.isArray(rs2?.Result) ? rs2.Result : (rs2?.Result ? [rs2.Result] : []);

  console.log(`TotalResult: ${totalResult2}`);
  console.log(`返却件数: ${results2.length}`);

  if (results2.length > 0) {
    const orderNums2 = results2.map(r => r.order_number).sort();
    console.log(`最小order_number: ${orderNums2[0]}`);
    console.log(`最大order_number: ${orderNums2[orderNums2.length - 1]}`);

    const set1 = new Set(orderNums1);
    const overlap = orderNums2.filter(n => set1.has(n));
    console.log(`重複: ${overlap.length}件`);
  }

  const allOrders = new Set([...orderNums1, ...(results2.length > 0 ? results2.map(r => r.order_number) : [])]);
  console.log(`\n=== 結果サマリ ===`);
  console.log(`${targetDate}: 1回目 ${results1.length}件, 2回目 ${results2.length}件, 合計 ${allOrders.size}件 (重複除外)`);

  if (results2.length > 0) {
    console.log('✅ ページネーション成功！');
  } else {
    console.log('❌ ページネーション失敗 — 2回目で0件');

    // condition省略でも試す
    console.log(`\n=== 追加テスト: condition省略 ===`);
    await sleep(1000);
    const result3 = await crossmall.makeRequest('get_order', {
      order_date_fr: targetDate,
      order_date_to: targetDate,
      order_number: lastOrderNum
    });
    const rs3 = result3?.GetOrder?.ResultSet;
    const results3 = Array.isArray(rs3?.Result) ? rs3.Result : (rs3?.Result ? [rs3.Result] : []);
    console.log(`condition省略: ${results3.length}件`);

    // condition=2 (>=) も試す
    console.log(`\n=== 追加テスト: condition=2 (>=) ===`);
    await sleep(1000);
    const result4 = await crossmall.makeRequest('get_order', {
      order_date_fr: targetDate,
      order_date_to: targetDate,
      order_number: lastOrderNum,
      condition: '2'
    });
    const rs4 = result4?.GetOrder?.ResultSet;
    const results4 = Array.isArray(rs4?.Result) ? rs4.Result : (rs4?.Result ? [rs4.Result] : []);
    console.log(`condition=2: ${results4.length}件`);
  }
}

main().catch(e => console.error(e));
