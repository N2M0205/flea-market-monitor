'use strict';
const fs = require('fs');
const path = require('path');

const histPath  = path.join(__dirname, 'data', 'crossmall_sales_history.json');
const cachePath = path.join(__dirname, 'data', 'purchase_master_cache.json');

const history = JSON.parse(fs.readFileSync(histPath, 'utf8'));
const cache   = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const sales   = history.sales;

// キャッシュをSKUで引けるMapに変換
const cacheMap = {};
(cache.items || []).forEach(item => { cacheMap[item.sku] = item; });

const now  = new Date();
const ms7  = 7  * 24 * 60 * 60 * 1000;
const ms28 = 28 * 24 * 60 * 60 * 1000;

console.log('========================================');
console.log('検証3: SKU別 販売データ詳細検証');
console.log('========================================');
console.log('history.lastSyncedAt:', history.lastSyncedAt);
console.log('cache.syncedAt      :', cache.syncedAt);
console.log('');

const results = [];

for (const sku of Object.keys(sales)) {
  const orders = Object.values(sales[sku]);
  if (orders.length === 0) continue;

  // 日付でソート（降順）
  const sorted = orders
    .filter(o => o.date)
    .sort((a, b) => b.date.localeCompare(a.date));

  const lastDate = sorted[0]?.date?.substring(0, 10) || 'N/A';

  // sales7 / sales28 を日付で集計（当日を含む）
  let sales7 = 0, sales28 = 0;
  for (const o of orders) {
    const oDate = new Date(o.date);
    const diff  = now - oDate;
    if (diff <= ms7)  sales7++;
    if (diff <= ms28) sales28++;
  }

  // キャッシュ値
  const cached = cacheMap[sku];
  const cacheSales7  = cached?.sales7       ?? 'N/A';
  const cacheSales28 = cached?.sales28      ?? 'N/A';
  const cacheLastDate = cached?.lastSaleDate ?? 'N/A';

  // 差異チェック
  const diff7   = cached ? (sales7  !== cacheSales7  ? '⚠️差異' : 'OK') : '(キャッシュなし)';
  const diff28  = cached ? (sales28 !== cacheSales28 ? '⚠️差異' : 'OK') : '(キャッシュなし)';
  const diffLast = cached ? (lastDate !== cacheLastDate ? '⚠️差異' : 'OK') : '(キャッシュなし)';

  results.push({ sku, lastDate, sales7, sales28, totalOrders: orders.length,
    cacheSales7, cacheSales28, cacheLastDate, diff7, diff28, diffLast });
}

// 差異があるSKUを優先して表示
const withDiff = results.filter(r => r.diff7 === '⚠️差異' || r.diff28 === '⚠️差異' || r.diffLast === '⚠️差異');
const noDiff   = results.filter(r => r.diff7 !== '⚠️差異' && r.diff28 !== '⚠️差異' && r.diffLast !== '⚠️差異');

if (withDiff.length > 0) {
  console.log(`--- ⚠️ キャッシュと差異があるSKU（${withDiff.length}件） ---`);
  withDiff.forEach(r => {
    console.log(`SKU: ${r.sku}`);
    console.log(`  蓄積: sales7=${r.sales7}, sales28=${r.sales28}, lastDate=${r.lastDate}`);
    console.log(`  cache: sales7=${r.cacheSales7}[${r.diff7}], sales28=${r.cacheSales28}[${r.diff28}], lastDate=${r.cacheLastDate}[${r.diffLast}]`);
  });
  console.log('');
}

// サマリーテーブル（キャッシュに存在するSKUのみ・件数上位20件）
console.log('========================================');
console.log('サマリー（キャッシュ存在SKU・件数上位20）');
console.log('========================================');
console.log('SKU                | 蓄積28日 | 蓄積7日 | 蓄積LastSale | キャッシュ28日 | キャッシュ7日 | キャッシュLastSale | 総件数');
console.log('-------------------|----------|---------|--------------|---------------|--------------|-------------------|------');
results
  .filter(r => cacheMap[r.sku])
  .sort((a, b) => b.totalOrders - a.totalOrders)
  .slice(0, 20)
  .forEach(r => {
    const line = [
      r.sku.padEnd(18),
      String(r.sales28).padStart(8),
      String(r.sales7).padStart(7),
      r.lastDate.padStart(12),
      String(r.cacheSales28).padStart(13),
      String(r.cacheSales7).padStart(12),
      r.cacheLastDate.padStart(17),
      String(r.totalOrders).padStart(6),
    ].join(' | ');
    console.log(line);
  });

console.log('');
console.log(`全SKU数: ${results.length} / キャッシュ一致: ${noDiff.filter(r=>cacheMap[r.sku]).length} / 差異あり: ${withDiff.length} / キャッシュなし: ${results.filter(r=>!cacheMap[r.sku]).length}`);
