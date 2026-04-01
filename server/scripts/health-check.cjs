'use strict';

/**
 * VPS ヘルスチェック + LINE 警告スクリプト
 *
 * 監視項目:
 *   - ディスク空き容量 (2GB / 500MB)
 *   - メモリ使用率 (85% / 95%)
 *   - Chrome プロセス数 (10個超)
 *   - PM2 picofuri-backend の status (online以外)
 *
 * 異常時のみ LINE に警告送信（全項目正常時は送信しない）
 *
 * 使い方:
 *   node server/scripts/health-check.cjs   # 1回実行
 *
 * PM2登録（30分ごとにcron実行）:
 *   pm2 start server/scripts/health-check.cjs --cron "0,30 * * * *" --no-autorestart --name health-check
 */

const { execSync } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_GROUP_ID = (process.env.LINE_GROUP_ID || '').trim();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LINE送信（異常時のみ呼ばれる）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendLineAlert(text) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_GROUP_ID) {
    console.warn('⚠️ LINE認証情報が未設定のためコンソール出力のみ');
    console.log(text);
    return;
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: LINE_GROUP_ID,
        messages: [{ type: 'text', text }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`LINE送信失敗 (${res.status}): ${body}`);
    } else {
      console.log('✅ LINE警告送信完了');
    }
  } catch (err) {
    console.error('LINE送信エラー:', err.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 各監視項目
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function checkDisk() {
  try {
    const raw = execSync(
      'powershell -Command "(Get-PSDrive C).Free"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const freeBytes = parseInt(raw.trim(), 10);
    if (isNaN(freeBytes)) return { ok: true, freeGB: null, message: 'ディスク情報取得不可' };

    const freeGB = freeBytes / (1024 ** 3);

    if (freeGB < 0.5) {
      return { ok: false, level: 'critical', freeGB, message: `🚨 ディスク残量 ${freeGB.toFixed(1)}GB（500MB未満 - 緊急）` };
    }
    if (freeGB < 2) {
      return { ok: false, level: 'warning', freeGB, message: `⚠️ ディスク残量 ${freeGB.toFixed(1)}GB（2GB未満）` };
    }
    return { ok: true, freeGB, message: `✅ ディスク残量 ${freeGB.toFixed(1)}GB` };
  } catch (err) {
    return { ok: true, freeGB: null, message: `ディスクチェックエラー: ${err.message}` };
  }
}

function checkMemory() {
  try {
    const raw = execSync(
      'wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );

    const freeMatch = raw.match(/FreePhysicalMemory=(\d+)/);
    const totalMatch = raw.match(/TotalVisibleMemorySize=(\d+)/);
    if (!totalMatch || !freeMatch) return { ok: true, usagePct: null, message: 'メモリ情報取得不可' };

    const totalKB = parseInt(totalMatch[1], 10);
    const freeKB = parseInt(freeMatch[1], 10);
    const usagePct = ((totalKB - freeKB) / totalKB) * 100;

    if (usagePct > 95) {
      return { ok: false, level: 'critical', usagePct, message: `🚨 メモリ使用率 ${usagePct.toFixed(1)}%（95%超 - 緊急）` };
    }
    if (usagePct > 85) {
      return { ok: false, level: 'warning', usagePct, message: `⚠️ メモリ使用率 ${usagePct.toFixed(1)}%（85%超）` };
    }
    return { ok: true, usagePct, message: `✅ メモリ使用率 ${usagePct.toFixed(1)}%` };
  } catch (err) {
    return { ok: true, usagePct: null, message: `メモリチェックエラー: ${err.message}` };
  }
}

function checkChromeProcesses() {
  try {
    const raw = execSync('tasklist | findstr chrome.exe', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    const count = lines.length;

    if (count > 10) {
      return { ok: false, level: 'warning', count, message: `⚠️ Chromeプロセス数: ${count}個（異常蓄積の兆候）` };
    }
    return { ok: true, count, message: `✅ Chromeプロセス数: ${count}個` };
  } catch (err) {
    // findstr はマッチ0件で exit code 1 を返す → プロセス0個
    if (err.status === 1) {
      return { ok: true, count: 0, message: '✅ Chromeプロセス数: 0個' };
    }
    return { ok: true, count: 0, message: `Chromeチェックエラー: ${err.message}` };
  }
}

function checkPM2Status() {
  try {
    const raw = execSync('pm2 jlist', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const list = JSON.parse(raw);
    const backend = list.find(p => p.name === 'picofuri-backend');

    if (!backend) {
      return { ok: false, level: 'critical', status: 'not found', message: '🚨 PM2: picofuri-backend が登録されていません' };
    }

    const status = backend.pm2_env?.status || 'unknown';
    const restarts = backend.pm2_env?.restart_time || 0;

    if (status !== 'online') {
      return { ok: false, level: 'critical', status, message: `🚨 PM2: picofuri-backend は "${status}"（online以外）再起動回数: ${restarts}` };
    }
    return { ok: true, status, message: `✅ PM2: picofuri-backend online（再起動回数: ${restarts}）` };
  } catch (err) {
    return { ok: true, status: 'check_error', message: `PM2チェックエラー: ${err.message}` };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// メイン
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runHealthCheck() {
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`\n🏥 ヘルスチェック実行: ${now}`);

  const results = [
    checkDisk(),
    checkMemory(),
    checkChromeProcesses(),
    checkPM2Status(),
  ];

  for (const r of results) {
    console.log(`  ${r.message}`);
  }

  // 異常時のみLINE送信
  const alerts = results.filter(r => !r.ok);
  if (alerts.length > 0) {
    const hasCritical = alerts.some(r => r.level === 'critical');
    const header = hasCritical
      ? '🚨 VPS緊急警告 🚨'
      : '⚠️ VPS警告';

    const lines = [
      header,
      `時刻: ${now}`,
      '',
      ...alerts.map(r => r.message),
      '',
      '--- 全項目 ---',
      ...results.map(r => r.message),
    ];

    await sendLineAlert(lines.join('\n'));
  } else {
    console.log('  ✅ 全項目正常（LINE送信なし）');
  }
}

runHealthCheck();
