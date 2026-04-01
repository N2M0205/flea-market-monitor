/**
 * 孤立Chromeプロセス定期クリーンアップスクリプト
 *
 * Puppeteerのbrowser.close()失敗時に残留するchrome.exeを
 * 定期的に強制終了する安全網。
 *
 * PM2登録例:
 *   pm2 start server/scripts/cleanup-chrome.cjs --name chrome-cleanup --cron "star/30 * * * *" --no-autorestart
 *   (star = アスタリスク)
 */

const { execSync } = require('child_process');

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5分（孤立プロセス判定）
const LEAK_THRESHOLD_MS  = 3 * 60 * 1000; // 3分（backend子プロセスのリーク判定）

function getPm2BackendPid() {
  try {
    const raw = execSync('pm2 jlist', { encoding: 'utf-8' });
    const list = JSON.parse(raw);
    const backend = list.find((p) => p.name === 'picofuri-backend');
    return backend ? backend.pid : null;
  } catch {
    return null;
  }
}

function getChildPids(parentPid) {
  if (!parentPid) return new Set();
  try {
    const raw = execSync(
      `wmic process where (ParentProcessId=${parentPid}) get ProcessId /format:csv`,
      { encoding: 'utf-8' }
    );
    const pids = new Set();
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(',');
      const pid = parseInt(parts[parts.length - 1], 10);
      if (pid) pids.add(pid);
    }
    return pids;
  } catch {
    return new Set();
  }
}

function getChromeProcesses() {
  try {
    // tasklist /FO CSV でプロセス名, PID を取得
    const raw = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH', {
      encoding: 'utf-8',
    });

    const processes = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('INFO:')) continue;

      // CSV形式: "chrome.exe","12345","Console","1","123,456 K"
      const match = trimmed.match(/"chrome\.exe","(\d+)"/i);
      if (match) {
        processes.push(parseInt(match[1], 10));
      }
    }
    return processes;
  } catch {
    return [];
  }
}

function getProcessStartTime(pid) {
  try {
    const raw = execSync(
      `wmic process where (ProcessId=${pid}) get CreationDate /format:csv`,
      { encoding: 'utf-8' }
    );
    for (const line of raw.split('\n')) {
      const parts = line.trim().split(',');
      const dateStr = parts[parts.length - 1];
      // WMI CreationDate形式: 20260401123045.123456+540
      const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (match) {
        const [, y, mo, d, h, mi, s] = match;
        return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function killProcess(pid) {
  try {
    execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  console.log(`[chrome-cleanup] 実行開始: ${new Date().toISOString()}`);

  const backendPid = getPm2BackendPid();
  console.log(`[chrome-cleanup] PM2 backend PID: ${backendPid || '未検出'}`);

  // backend の子プロセス（正常稼働中のChrome）を除外対象に
  const childPids = getChildPids(backendPid);
  if (childPids.size > 0) {
    console.log(`[chrome-cleanup] backend子プロセス(除外): ${[...childPids].join(', ')}`);
  }

  const chromePids = getChromeProcesses();
  if (chromePids.length === 0) {
    console.log('[chrome-cleanup] chrome.exeプロセスなし。クリーンアップ不要');
    return;
  }

  console.log(`[chrome-cleanup] chrome.exe検出数: ${chromePids.length}`);

  const now = Date.now();
  let killed = 0;
  let skipped = 0;

  for (const pid of chromePids) {
    const startTime = getProcessStartTime(pid);
    if (!startTime) {
      skipped++;
      continue;
    }

    const elapsed = now - startTime.getTime();
    const elapsedSec = Math.round(elapsed / 1000);
    const isChild = childPids.has(pid);

    if (isChild) {
      // backend子プロセス: 3分以上はリーク疑い → kill
      if (elapsed < LEAK_THRESHOLD_MS) {
        skipped++;
        continue;
      }
      console.log(`[chrome-cleanup] リーク疑いでkill: PID ${pid}（起動${elapsedSec}秒, backend子プロセス）`);
    } else {
      // 孤立プロセス: 5分以上 → kill
      if (elapsed < STALE_THRESHOLD_MS) {
        skipped++;
        continue;
      }
      console.log(`[chrome-cleanup] 孤立プロセスkill: PID ${pid}（起動${elapsedSec}秒）`);
    }

    if (killProcess(pid)) {
      killed++;
    }
  }

  if (killed === 0) {
    console.log('[chrome-cleanup] 孤立プロセスなし。クリーンアップ不要');
  } else {
    console.log(`[chrome-cleanup] ${killed}件のchromeプロセスを終了しました`);
  }
  console.log(`[chrome-cleanup] (スキップ: ${skipped}件, 終了: ${killed}件)`);
}

try {
  main();
} catch (err) {
  console.error(`[chrome-cleanup] エラー: ${err.message}`);
}
