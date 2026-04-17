/**
 * sales_history.json → crossmall_sales テーブル 移行スクリプト
 *
 * data/crossmall_sales_history.json の構造:
 *   { sales: { [item_code]: [{ date, price, orderNumber, deliveryType }] } }
 *
 * crossmall_sales PK: (order_number, line_no)
 * line_no は同一 order_number 内での item_code ソート順で 1 から採番
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.resolve(__dirname, '../../data/crossmall_sales_history.json');
const BATCH_SIZE = 100;

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(`[${new Date().toISOString()}] sales_history → crossmall_sales 移行 開始`);
  console.log('='.repeat(60));

  // JSON 読み込み
  if (!fs.existsSync(HISTORY_FILE)) {
    console.error('❌ ファイルが見つかりません:', HISTORY_FILE);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  const sales = raw.sales || {};

  // サンプル表示
  const firstSku = Object.keys(sales)[0];
  console.log('\n📋 JSON スキーマサンプル:');
  console.log('  SKU:', firstSku);
  console.log('  レコード例:', JSON.stringify((sales[firstSku] || [])[0]));

  // order_number → [{ item_code, date, price, deliveryType }] に再構築
  const orderMap = new Map();
  let jsonTotal = 0;

  for (const [itemCode, records] of Object.entries(sales)) {
    for (const r of records) {
      jsonTotal++;
      if (!orderMap.has(r.orderNumber)) orderMap.set(r.orderNumber, []);
      orderMap.get(r.orderNumber).push({
        item_code: itemCode,
        date: r.date,
        price: r.price,
        deliveryType: r.deliveryType,
      });
    }
  }

  console.log(`\n📊 JSON 内容: ${jsonTotal} レコード, ${orderMap.size} 注文, ${Object.keys(sales).length} SKU`);

  // Sequelize 初期化
  const db = require('../models');
  await db.sequelize.authenticate();
  const { CrossmallSale } = db;
  const now = new Date();

  // UPSERT 処理
  let upserted = 0;
  let batchRows = [];

  for (const [orderNumber, items] of orderMap) {
    // item_code ソートで line_no を確定（冪等性保証）
    const sorted = [...items].sort((a, b) => a.item_code.localeCompare(b.item_code));

    for (let i = 0; i < sorted.length; i++) {
      const it = sorted[i];
      const unitPrice = Math.round(it.price || 0);
      batchRows.push({
        order_number: orderNumber,
        line_no: i + 1,
        item_code: it.item_code,
        order_date: new Date(it.date + 'T00:00:00Z'),
        amount: 1,
        unit_price: unitPrice,
        amount_price: unitPrice,
        delivery_type: it.deliveryType || null,
        synced_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    if (batchRows.length >= BATCH_SIZE) {
      await CrossmallSale.bulkCreate(batchRows, {
        updateOnDuplicate: [
          'item_code', 'order_date', 'amount', 'unit_price',
          'amount_price', 'delivery_type', 'synced_at', 'updated_at',
        ],
      });
      upserted += batchRows.length;
      console.log(`  進捗: ${upserted} 件処理済み`);
      batchRows = [];
    }
  }

  // 残余フラッシュ
  if (batchRows.length > 0) {
    await CrossmallSale.bulkCreate(batchRows, {
      updateOnDuplicate: [
        'item_code', 'order_date', 'amount', 'unit_price',
        'amount_price', 'delivery_type', 'synced_at', 'updated_at',
      ],
    });
    upserted += batchRows.length;
  }

  // 完了サマリ
  const dbCount = await CrossmallSale.count();
  const [{ min }] = await db.sequelize.query(
    "SELECT MIN(order_date) as min FROM crossmall_sales",
    { type: db.sequelize.QueryTypes.SELECT }
  );
  const [{ max }] = await db.sequelize.query(
    "SELECT MAX(order_date) as max FROM crossmall_sales",
    { type: db.sequelize.QueryTypes.SELECT }
  );

  console.log('\n' + '='.repeat(60));
  console.log('✅ 移行完了');
  console.log(`  UPSERT 処理件数: ${upserted}`);
  console.log(`  DB 件数 (COUNT): ${dbCount}`);
  console.log(`  JSON レコード数: ${jsonTotal}`);
  console.log(`  日付範囲: ${min} ~ ${max}`);
  console.log(`  JSON 最古: ${raw.oldestOrderDate}, 最新: ${raw.newestOrderDate}`);
  console.log('='.repeat(60));

  await db.sequelize.close();
}

main().catch(e => {
  console.error('❌ 移行エラー:', e.message);
  process.exit(1);
});
