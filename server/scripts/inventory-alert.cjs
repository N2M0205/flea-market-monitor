'use strict';

/**
 * 在庫アラート - 毎朝8:00 JST サマリー送信スクリプト
 *
 * 実行:
 *   node server/scripts/inventory-alert.cjs
 *
 * PM2登録（UTC 23:00 = JST 08:00）:
 *   pm2 start server/scripts/inventory-alert.cjs --name inventory-alert --cron "0 23 * * *" --no-autorestart
 *   pm2 save
 *
 * 表示ルール:
 *   LINE版 : ダッシュボード形式（🔴即対応全件/⚫欠品上位5件/📦補充上位10件/全体集計のみ）
 *   Telegram版: 🔴/🟡は全件 / ⚫は30日以内全件 / 💰は上位5件 / 詳細情報あり
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID         = process.env.TELEGRAM_ADMIN_ID;

const HISTORY_FILE = path.join(__dirname, '..', '..', 'data', 'inventory_alert_history.json');

const InventoryAlertService = require('../services/InventoryAlertService');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LINE broadcast 送信（health-check.cjs と同じ方式）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendLine(text) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKENが未設定のためコンソール出力のみ');
    console.log('[LINE出力]\n' + text);
    return;
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`LINE送信失敗 (${res.status}): ${body}`);
    } else {
      console.log('✅ LINE broadcast 送信完了');
    }
  } catch (err) {
    console.error('LINE送信エラー:', err.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Telegram sendMessage（fetch直接 / 4096文字で分割）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_ID) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_IDが未設定のためコンソール出力のみ');
    console.log('[Telegram出力]\n' + text);
    return;
  }
  const chunks = splitMessage(text, 4096);
  for (const chunk of chunks) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_ID, text: chunk }),
        }
      );
      if (!res.ok) {
        const body = await res.text();
        console.error(`Telegram送信失敗 (${res.status}): ${body}`);
      } else {
        console.log('✅ Telegram送信完了');
      }
    } catch (err) {
      console.error('Telegram送信エラー:', err.message);
    }
  }
}

/** 行単位で最大 maxLen 文字に分割 */
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    const next = current ? current + '\n' + line : line;
    if (next.length > maxLen) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 履歴保存（翌日比較用）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function saveHistory(result) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      savedAt: new Date().toISOString(),
      summary: result.summary,
      // SKU → level マップ（Phase 2 の新規/悪化判定用）
      levels: Object.fromEntries(result.alerts.map(a => [a.sku, a.level])),
    }, null, 2), 'utf8');
    console.log('✅ 履歴保存完了');
  } catch (err) {
    console.error('履歴保存失敗:', err.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// フォーマットユーティリティ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** "YYYY-MM-DD" → 経過日数 */
function daysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000));
}

/** "YYYY-MM-DD" → "M/D" */
function fmtDate(dateStr) {
  if (!dateStr) return 'なし';
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}

function trendLabel(trend) {
  return { accelerating: '📈加速', stable: '➡️安定', decelerating: '📉減速', new_surge: '⚡急伸', unknown: '⏸不明' }[trend] ?? trend;
}

// 各カテゴリの1行フォーマット
function fmtCritical(a) {
  const rem = isFinite(a.effectiveRemainingDays)
    ? `有効残${a.effectiveRemainingDays.toFixed(1)}日`
    : '不動';
  return `  ${a.itemName}（残${a.stock}個/${rem}/${trendLabel(a.trend)}）`;
}

function fmtWarning(a) {
  return `  ${a.itemName}（残${a.stock}個/有効残${a.effectiveRemainingDays.toFixed(1)}日/${trendLabel(a.trend)}）`;
}

function fmtOutOfStock(a) {
  const days = daysSince(a.lastSaleDate);
  const rate = a.effectiveDailyRate28 > 0
    ? `実力${a.effectiveDailyRate28.toFixed(1)}個/日`
    : '販売ゼロ';
  return `  ${a.itemName}（0個/${rate}/最終${fmtDate(a.lastSaleDate)}/${days}日前）`;
}

function fmtPriceReview(a) {
  return `  ${a.itemName}（残${a.stock}個/28日${a.sales28}個→7日${a.sales7}個📉）`;
}

function fmtRecommend(r) {
  const label = r.reason === 'new_surge' ? '⚡急伸' : '未監視';
  return `  ${r.itemName}（28日${r.sales28}個/在庫${r.stock}個/${label}）`;
}

function fmtReplenishmentItem(item) {
  if (item.level === 'out_of_stock') {
    return `  ${item.itemName}: 昨日${item.yesterdaySales}個 → 欠品中！`;
  }
  const badge = {
    critical_accelerating: '/🔴危険',
    critical: '/🔴危険',
    warning: '/🟡注意',
    price_review: '/💰価格見直し',
  }[item.level] || '';
  return `  ${item.itemName}: 昨日${item.yesterdaySales}個 → ${item.yesterdaySales}個補充（残${item.stock}個${badge}）`;
}

// ── LINE用スリムフォーマット ──────────────────────────

function fmtCriticalSlim(a) {
  const rem = isFinite(a.effectiveRemainingDays)
    ? `有効残${a.effectiveRemainingDays.toFixed(1)}日`
    : '不動';
  const trendEmoji = a.trend === 'accelerating' ? '📈' : '';
  return `  ${a.itemName}（残${a.stock}個/${rem}${trendEmoji}）`;
}

function fmtOutOfStockSlim(a) {
  const rate = a.effectiveDailyRate28 > 0
    ? `実力${a.effectiveDailyRate28.toFixed(1)}個/日`
    : '販売ゼロ';
  return `  ${a.itemName}（${rate}/最終${fmtDate(a.lastSaleDate)}）`;
}

function fmtReplenishmentItemSlim(item) {
  if (item.level === 'out_of_stock') {
    return `  ${item.itemName}: ${item.yesterdaySales}個補充（欠品中！）`;
  }
  const badge = {
    critical_accelerating: '🔴',
    critical: '🔴',
    warning: '🟡',
    price_review: '💰',
  }[item.level] || '';
  return `  ${item.itemName}: ${item.yesterdaySales}個補充（残${item.stock}個${badge}）`;
}

function buildReplenishmentSectionLine(replenishmentList, maxItems) {
  const { items, skippedCount } = replenishmentList;
  if (items.length === 0 && skippedCount === 0) return [];

  const totalQty = items.reduce((s, i) => s + i.yesterdaySales, 0);
  const L = [];
  L.push(`📦 補充リスト: ${items.length}商品/${totalQty}個`);

  if (items.length === 0) {
    L.push('  対象なし');
    return L;
  }

  const displayed = maxItems ? items.slice(0, maxItems) : items;
  const omitted = items.length - displayed.length;
  displayed.forEach(item => L.push(fmtReplenishmentItemSlim(item)));
  if (omitted > 0) L.push(`  他${omitted}件`);
  return L;
}

/**
 * 補充リストセクションを生成
 * @param {Object} replenishmentList - generateReplenishmentList()の戻り値
 * @param {number|null} maxItems - 表示上限（nullで全件）
 * @returns {string[]} lines
 */
function buildReplenishmentSection(replenishmentList, maxItems) {
  const { items, skippedCount } = replenishmentList;
  if (items.length === 0 && skippedCount === 0) return [];

  const L = [];
  const displayed = maxItems ? items.slice(0, maxItems) : items;
  const omitted = items.length - displayed.length;
  const totalQty = items.reduce((s, i) => s + i.yesterdaySales, 0);

  L.push(`📦 本日補充リスト（前日販売分）`);
  if (items.length === 0) {
    L.push('  対象なし');
  } else {
    displayed.forEach(item => L.push(fmtReplenishmentItem(item)));
    if (omitted > 0) L.push(`  他${omitted}件`);
    L.push(`  計: ${items.length}商品 / ${totalQty}個補充`);
    if (skippedCount > 0) L.push(`  ⏭ スキップ（在庫30日以上）: ${skippedCount}件`);
  }

  return L;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LINEメッセージ生成（ダッシュボード形式・スリム）
//   🔴 即対応: criticalAcc + critical 全件
//   ⚫ 欠品: 直近30日のみ 上位5件 + 他X件
//   📦 補充: 上位10件 + 他X件
//   📋 全体集計のみ（🟡/💰/🟢/⚪は件数のみ）
//   💡 フリマ推奨: Telegramのみ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildLineMessage(result, today) {
  const { alerts, summary, replenishmentList } = result;

  const criticalAcc = alerts.filter(a => a.level === 'critical_accelerating');
  const critical    = alerts.filter(a => a.level === 'critical');
  const outOfStock  = alerts.filter(a => a.level === 'out_of_stock');

  const immediateAll = [...criticalAcc, ...critical];
  const outRecent    = outOfStock.filter(a => daysSince(a.lastSaleDate) <= 30);
  const outOld       = outOfStock.filter(a => daysSince(a.lastSaleDate) >  30);

  const totalCritical = immediateAll.length;
  const L = [];

  L.push(`📊 在庫日報 ${today}`);
  L.push('');

  // 🔴 即対応（全件）
  if (immediateAll.length > 0) {
    L.push(`🔴 即対応: ${immediateAll.length}件`);
    immediateAll.forEach(a => L.push(fmtCriticalSlim(a)));
    L.push('');
  }

  // ⚫ 欠品（直近30日のみ、上位5件+他X件）
  L.push(`⚫ 欠品（直近30日）: ${outRecent.length}件`);
  if (outRecent.length > 0) {
    outRecent.slice(0, 5).forEach(a => L.push(fmtOutOfStockSlim(a)));
    if (outRecent.length > 5) L.push(`  他${outRecent.length - 5}件`);
  } else {
    L.push('  なし');
  }
  if (outOld.length > 0) L.push(`  ※30日超: ${outOld.length}件`);
  L.push('');

  // 📦 補充リスト（上位10件+他X件）
  if (replenishmentList) {
    const repLines = buildReplenishmentSectionLine(replenishmentList, 10);
    if (repLines.length > 0) {
      repLines.forEach(l => L.push(l));
      L.push('');
    }
  }

  // 📋 全体集計
  L.push(
    `📋 全体: ${summary.total}件 🔴${totalCritical} 🟡${summary.warning} 🟢${summary.ok} ⚫${summary.out_of_stock} 💰${summary.price_review} ⚪${summary.dead_stock}`
  );
  L.push('※詳細はTelegramで確認');

  return L.join('\n');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Telegramメッセージ生成
//   🔴/🟡 : 全件
//   ⚫ 欠品 : 30日以内は全件 / 30日超は件数のみ
//   💰 価格見直し : 上位5件+他XX件（42件全表示は冗長）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildTelegramMessage(result, today, leadTime) {
  const { alerts, summary, recommendations, replenishmentList } = result;

  const criticalAcc = alerts.filter(a => a.level === 'critical_accelerating');
  const outOfStock  = alerts.filter(a => a.level === 'out_of_stock');
  const critical    = alerts.filter(a => a.level === 'critical');
  const warning     = alerts.filter(a => a.level === 'warning');
  const priceReview = alerts.filter(a => a.level === 'price_review');

  const outRecent = outOfStock.filter(a => daysSince(a.lastSaleDate) <= 30);
  const outOld    = outOfStock.filter(a => daysSince(a.lastSaleDate) >  30);

  const totalCritical = criticalAcc.length + critical.length;
  const L = [];

  L.push(`📊 在庫日報 ${today}（リードタイム: ${leadTime}日）`);
  L.push('');

  if (criticalAcc.length > 0) {
    L.push(`🔴📈 仕入れ急げ: ${criticalAcc.length}件`);
    criticalAcc.forEach(a => L.push(fmtCritical(a)));
    L.push('');
  }

  L.push(`⚫ 欠品中: ${outOfStock.length}件`);
  if (outRecent.length > 0) {
    outRecent.forEach(a => L.push(fmtOutOfStock(a)));
  }
  if (outOld.length > 0) {
    L.push(`  他${outOld.length}件（30日超未販売）`);
  }
  if (outOfStock.length === 0) L.push('  なし');
  L.push('');

  if (critical.length > 0) {
    L.push(`🔴 危険: ${critical.length}件`);
    critical.forEach(a => L.push(fmtCritical(a)));
    L.push('');
  }

  if (warning.length > 0) {
    L.push(`🟡 注意: ${warning.length}件`);
    warning.forEach(a => L.push(fmtWarning(a)));
    L.push('');
  }

  // 💰 価格見直し: 上位5件+他XX件（LINEと同じ。42件全表示は冗長）
  if (priceReview.length > 0) {
    L.push(`💰 価格見直し: ${priceReview.length}件`);
    priceReview.slice(0, 5).forEach(a => L.push(fmtPriceReview(a)));
    if (priceReview.length > 5) L.push(`  他${priceReview.length - 5}件`);
    L.push('');
  }

  L.push(
    `📋 全体: ${summary.total}件 / 🔴${totalCritical} 🟡${summary.warning} 🟢${summary.ok} ⚫${summary.out_of_stock} 💰${summary.price_review} ⚪${summary.dead_stock}`
  );

  // 補充リスト（全件）
  if (replenishmentList) {
    const repLines = buildReplenishmentSection(replenishmentList, null);
    if (repLines.length > 0) {
      L.push('');
      repLines.forEach(l => L.push(l));
    }
  }

  if (recommendations.length > 0) {
    L.push('');
    L.push(`💡 フリマ監視おすすめ: ${recommendations.length}件`);
    recommendations.forEach(r => L.push(fmtRecommend(r)));
  }

  return L.join('\n');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// メイン
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log('=== 在庫アラート開始 ===');

  const today = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-');

  const service = new InventoryAlertService();
  console.log('アラート計算中...');
  const result = await service.generateAlert();
  const { summary } = result;

  console.log(`対象SKU: ${summary.total}件`);
  console.log(`🔴📈: ${summary.critical_accelerating} / 🔴: ${summary.critical} / 🟡: ${summary.warning} / ⚫: ${summary.out_of_stock} / 💰: ${summary.price_review} / ⚪: ${summary.dead_stock}`);

  const leadTime = service.defaultLeadTime;
  const lineMsg     = buildLineMessage(result, today);
  const telegramMsg = buildTelegramMessage(result, today, leadTime);

  console.log('\n=== LINE送信 ===');
  await sendLine(lineMsg);

  console.log('\n=== Telegram送信 ===');
  await sendTelegram(telegramMsg);

  saveHistory(result);
  console.log('=== 完了 ===');
}

main().catch(err => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
