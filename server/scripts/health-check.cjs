'use strict';

/**
 * VPS ヘルスチェック + LINE 警告スクリプト
 *
 * 監視項目:
 *   - ディスク空き容量 (5GB / 2GB)
 *   - Tempフォルダサイズ (10GB / 20GB)
 *   - メモリ使用率 (92% / 97%)
 *   - Chrome プロセス数 (25個/35個)
 *   - PM2 picofuri-backend の status (online以外)
 *   - picofuri-backend 再起動回数 (30分間で5回以上)
 *   - スクレイピング成功率 (Mercari 50%/25%, Yahoo 80%, 処理時間600秒)
 *
 * 異常時のみ LINE broadcast で全友達に警告送信
 *
 * 使い方:
 *   node server/scripts/health-check.cjs   # 1回実行
 *
 * PM2登録（30分ごとにcron実行）:
 *   pm2 start server/scripts/health-check.cjs --cron "0,30 * * * *" --no-autorestart --name health-check
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'health_check_state.json');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 状態ファイル読み書き
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn(`状態ファイル保存失敗: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LINE broadcast 送信（異常時のみ呼ばれる）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendLineAlert(text) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKENが未設定のためコンソール出力のみ');
    console.log(text);
    return;
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        messages: [{ type: 'text', text }],
      }),
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

    if (freeGB < 2) {
      return { ok: false, level: 'critical', freeGB, message: `🚨 ディスク残量 ${freeGB.toFixed(1)}GB（2GB未満 - 緊急）` };
    }
    if (freeGB < 5) {
      return { ok: false, level: 'warning', freeGB, message: `⚠️ ディスク残量 ${freeGB.toFixed(1)}GB（閾値5GB）` };
    }
    return { ok: true, freeGB, message: `✅ ディスク残量 ${freeGB.toFixed(1)}GB` };
  } catch (err) {
    return { ok: true, freeGB: null, message: `ディスクチェックエラー: ${err.message}` };
  }
}

function calcDirSize(dirPath, deadline) {
  if (Date.now() > deadline) return 0;
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (Date.now() > deadline) break;
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          size += calcDirSize(fullPath, deadline);
        } else {
          size += fs.statSync(fullPath).size;
        }
      } catch {
        // アクセス不可のファイルはスキップ
      }
    }
  } catch {
    // ディレクトリ読み取り不可
  }
  return size;
}

function checkTemp() {
  try {
    const tempDir = process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp';
    const deadline = Date.now() + 10000; // 10秒タイムアウト
    const totalBytes = calcDirSize(tempDir, deadline);
    const timedOut = Date.now() > deadline;

    if (totalBytes === 0 && timedOut) {
      return { ok: true, message: '✅ Temp: サイズ計算タイムアウト（スキップ）' };
    }

    const sizeGB = totalBytes / (1024 ** 3);
    const approx = timedOut ? '約' : '';

    if (sizeGB > 20) {
      return { ok: false, level: 'critical', sizeGB, message: `🚨 Temp: ${approx}${sizeGB.toFixed(1)}GB（20GB超 - 緊急）` };
    }
    if (sizeGB > 10) {
      return { ok: false, level: 'warning', sizeGB, message: `⚠️ Temp: ${approx}${sizeGB.toFixed(1)}GB（閾値10GB）` };
    }
    return { ok: true, sizeGB, message: `✅ Temp: ${approx}${sizeGB.toFixed(1)}GB` };
  } catch (err) {
    return { ok: true, message: `Tempチェックエラー: ${err.message}` };
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

    if (usagePct > 92) {
      return { ok: false, level: 'critical', usagePct, message: `🚨 メモリ使用率 ${usagePct.toFixed(1)}%（92%超 - 緊急）` };
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

    if (count > 70) {
      return { ok: false, level: 'critical', count, message: `🚨 Chromeプロセス数: ${count}個（70個超 - 緊急）` };
    }
    if (count > 55) {
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
      return { ok: false, level: 'critical', status: 'not found', restarts: 0, message: '🚨 PM2: picofuri-backend が登録されていません' };
    }

    const status = backend.pm2_env?.status || 'unknown';
    const restarts = backend.pm2_env?.restart_time || 0;

    if (status !== 'online') {
      return { ok: false, level: 'critical', status, restarts, message: `🚨 PM2: picofuri-backend は "${status}"（online以外）再起動回数: ${restarts}` };
    }
    return { ok: true, status, restarts, message: `✅ PM2: picofuri-backend online（再起動回数: ${restarts}）` };
  } catch (err) {
    return { ok: true, status: 'check_error', restarts: 0, message: `PM2チェックエラー: ${err.message}` };
  }
}

function checkRestartRate(currentRestarts) {
  const state = loadState();
  const now = Date.now();

  const prevRestarts = state.lastRestartCount ?? currentRestarts;
  const prevTime = state.lastCheckTime ?? now;

  // 状態を更新
  saveState({
    ...state,
    lastRestartCount: currentRestarts,
    lastCheckTime: now,
  });

  const delta = currentRestarts - prevRestarts;

  // 初回 or リスタートカウントがリセットされた場合
  if (delta < 0) {
    return { ok: true, delta: 0, message: '✅ 再起動回数: 正常（カウントリセット検知）' };
  }

  if (delta >= 5) {
    const elapsed = Math.round((now - prevTime) / 60000);
    return { ok: false, level: 'warning', delta, message: `⚠️ 再起動回数: ${elapsed}分間で${delta}回増加（クラッシュループの疑い）` };
  }

  return { ok: true, delta, message: `✅ 再起動回数: 正常（30分間${delta}回）` };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// スクレイピング監視
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PM2_OUT_LOG = path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', '.pm2', 'logs', 'picofuri-backend-out.log');
const PM2_ERR_LOG = path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', '.pm2', 'logs', 'picofuri-backend-error.log');

function readTailLines(filePath, maxLines) {
  try {
    const buf = fs.readFileSync(filePath, 'utf8');
    const lines = buf.split('\n');
    return lines.slice(-maxLines);
  } catch {
    return null;
  }
}

function checkScrapeStatus() {
  try {
    const outLines = readTailLines(PM2_OUT_LOG, 10000);
    if (!outLines) {
      return [{ ok: true, message: '📊 直近スキャン: データ取得不可（スキップ）' }];
    }

    // 末尾から最新の完了したスキャンを探す
    let scanEndIdx = -1;
    let scanStartIdx = -1;
    for (let i = outLines.length - 1; i >= 0; i--) {
      if (scanEndIdx === -1 && outLines[i].includes('全キーワードのスクレイピング完了')) {
        scanEndIdx = i;
      }
      if (scanEndIdx !== -1 && outLines[i].includes('定期スクレイピング開始')) {
        scanStartIdx = i;
        break;
      }
    }

    if (scanStartIdx === -1 || scanEndIdx === -1) {
      return [{ ok: true, message: '📊 直近スキャン: データ取得不可（スキップ）' }];
    }

    const scanLines = outLines.slice(scanStartIdx, scanEndIdx + 1);

    // エラーログも末尾10000行読んでタイムスタンプで絞り込む
    // → スキャン区間内のエラーは out.log の行番号範囲に対応しないので
    //   err.log 全体から mercari / yahoo_flea エラーをカウント
    //   ただしスキャン開始〜終了の時刻で絞れないため、outログ内のエラーパターンも使う

    // 処理時間
    const timeMatch = scanLines[scanLines.length - 1].match(/(\d+\.?\d*)秒/);
    const durationSec = timeMatch ? parseFloat(timeMatch[1]) : null;

    // Mercari: 成功=「✅ ○○ → XX件取得」、キーワード単位の結果
    // スキャン内で「🔹 プラットフォーム: mercari」が出た後、✅ XX → YY件取得 が成功
    // エラー = 「Mercari検索エラー」「Search timeout:」でmercariを含む行
    // 並列処理対応: 「対象プラットフォーム」でtotal++、成功/エラー行でそれぞれカウント
    // pendingをカウンタにして並列2キーワード以上に対応
    let mercariTotal = 0;
    let mercariSuccess = 0;
    let yahooTotal = 0;
    let yahooSuccess = 0;
    let mercariPending = 0;
    let yahooPending = 0;

    for (const line of scanLines) {
      const platMatch = line.match(/対象プラットフォーム:\s*(.+)/);
      if (platMatch) {
        const plats = platMatch[1].split(',').map(s => s.trim());
        if (plats.includes('mercari')) {
          mercariTotal++;
          mercariPending++;
        }
        if (plats.includes('yahoo_flea')) {
          yahooTotal++;
          yahooPending++;
        }
        continue;
      }

      // Mercari成功: 「✅ XX → YY件取得」
      if (mercariPending > 0 && /✅\s*.+\s*→\s*\d+件取得/.test(line)) {
        mercariSuccess++;
        mercariPending--;
      }

      // Yahooフリマ成功
      if (yahooPending > 0 && /✅\s*Yahoo!フリマ.*整形完了/.test(line)) {
        yahooSuccess++;
        yahooPending--;
      }
    }

    // errログからもスキャン区間のエラーを補完
    const errLines = readTailLines(PM2_ERR_LOG, 10000);
    if (errLines) {
      // スキャン開始時刻を取得して、それ以降のエラーを数える
      // ただし時刻の正確な対応は難しいので、outログ解析結果を優先
      // errログは mercariTotal/yahooTotal の補正には使わない（二重カウント防止）
    }

    const results = [];

    // 処理時間
    if (durationSec !== null) {
      if (durationSec > 600) {
        results.push({ ok: false, level: 'warning', message: `⚠️ 直近スキャン: ${durationSec.toFixed(0)}秒（600秒超過）` });
      } else {
        results.push({ ok: true, message: `📊 直近スキャン: ${durationSec.toFixed(0)}秒` });
      }
    } else {
      results.push({ ok: true, message: '📊 直近スキャン: 処理時間不明' });
    }

    // Mercari
    if (mercariTotal > 0) {
      const rate = (mercariSuccess / mercariTotal) * 100;
      if (rate < 25) {
        results.push({ ok: false, level: 'critical', message: `🚨 Mercari: ${mercariSuccess}/${mercariTotal}成功（${rate.toFixed(0)}%）← 異常` });
      } else if (rate < 50) {
        results.push({ ok: false, level: 'warning', message: `⚠️ Mercari: ${mercariSuccess}/${mercariTotal}成功（${rate.toFixed(0)}%）` });
      } else {
        results.push({ ok: true, message: `✅ Mercari: ${mercariSuccess}/${mercariTotal}成功（${rate.toFixed(0)}%）` });
      }
    } else {
      results.push({ ok: true, message: '📊 Mercari: スキャンデータなし' });
    }

    // Yahoo
    if (yahooTotal > 0) {
      const rate = (yahooSuccess / yahooTotal) * 100;
      if (rate < 80) {
        results.push({ ok: false, level: 'warning', message: `⚠️ Yahoo: ${yahooSuccess}/${yahooTotal}成功（${rate.toFixed(0)}%）` });
      } else {
        results.push({ ok: true, message: `✅ Yahoo: ${yahooSuccess}/${yahooTotal}成功（${rate.toFixed(0)}%）` });
      }
    } else {
      results.push({ ok: true, message: '📊 Yahoo: スキャンデータなし' });
    }

    return results;
  } catch (err) {
    return [{ ok: true, message: `📊 直近スキャン: データ取得不可（スキップ）` }];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// メイン
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runHealthCheck() {
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  console.log(`\n🏥 ヘルスチェック実行: ${now}`);

  const pm2Result = checkPM2Status();
  const restartResult = checkRestartRate(pm2Result.restarts);

  const scrapeResults = checkScrapeStatus();

  const results = [
    checkDisk(),
    checkTemp(),
    checkMemory(),
    checkChromeProcesses(),
    pm2Result,
    restartResult,
    ...scrapeResults,
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
      ...results.map(r => r.message),
    ];

    await sendLineAlert(lines.join('\n'));
  } else {
    console.log('  ✅ 全項目正常（LINE送信なし）');
  }
}

runHealthCheck();
