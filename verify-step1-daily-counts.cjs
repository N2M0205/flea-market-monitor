'use strict';
const fs = require('fs');
const path = require('path');

const histPath = path.join(__dirname, 'data', 'crossmall_sales_history.json');
const history = JSON.parse(fs.readFileSync(histPath, 'utf8'));
const sales = history.sales;

console.log('========================================');
console.log('検証1: 日別件数 + 欠落日チェック');
console.log('========================================');
console.log('lastSyncedAt  :', history.lastSyncedAt);
console.log('oldestOrderDate:', history.oldestOrderDate);
console.log('newestOrderDate:', history.newestOrderDate);
console.log('SKU数          :', Object.keys(sales).length);

// 全注文を日付ごとに集計
const dailyCounts = {};
let totalOrders = 0;

for (const sku of Object.keys(sales)) {
  const orders = Object.values(sales[sku]);
  for (const o of orders) {
    const date = (o.date || '').substring(0, 10);
    if (!date) continue;
    dailyCounts[date] = (dailyCounts[date] || 0) + 1;
    totalOrders++;
  }
}

console.log('総注文数       :', totalOrders);
console.log('');

// 100件到達日チェック
const over100 = Object.entries(dailyCounts).filter(([, c]) => c >= 100);
console.log('--- 100件到達日（ページネーション漏れ疑い） ---');
if (over100.length === 0) {
  console.log('✅ 100件到達日なし');
} else {
  over100.sort().forEach(([d, c]) => console.log(`  🔴 ${d}: ${c}件`));
}
console.log('');

// 欠落日チェック（oldest〜newest間）
const start = new Date(history.oldestOrderDate);
const end   = new Date(history.newestOrderDate);
const missing = [];
for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
  const ds = d.toISOString().substring(0, 10);
  if (!dailyCounts[ds]) missing.push(ds);
}

console.log('--- 欠落日チェック ---');
if (missing.length === 0) {
  console.log('✅ 欠落日なし（全日にデータあり）');
} else {
  console.log(`❌ 欠落日 ${missing.length} 日あります:`);
  missing.forEach(d => console.log(`  - ${d}`));
}
console.log('');

// 直近14日の詳細
console.log('--- 直近14日の件数（重点確認） ---');
const now = new Date();
for (let i = 13; i >= 0; i--) {
  const d = new Date(now);
  d.setDate(d.getDate() - i);
  const ds = d.toISOString().substring(0, 10);
  const count = dailyCounts[ds] || 0;
  let flag = count === 0 ? ' ❌ データなし' : '';
  if (count >= 100) flag = ' 🔴 上限到達';
  console.log(`  ${ds}: ${count}件${flag}`);
}
