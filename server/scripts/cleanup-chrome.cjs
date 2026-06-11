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
const fs = require('fs');
const path = require('path');
const os = require('os');

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5分（孤立プロセス判定）
const LEAK_THRESHOLD_MS  = 3 * 60 * 1000; // 3分（backend子プロセスのリーク判定）
const TMP_AGE_THRESHOLD_MS = 60 * 60 * 1000; // 1時間（Tempファイル削除判定）

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
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { encoding: 'utf-8' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
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

// --- Temp掃除 ---

function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          size += getDirSize(fullPath);
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

function getEntrySize(fullPath, isDir) {
  try {
    if (isDir) return getDirSize(fullPath);
    return fs.statSync(fullPath).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shouldDelete(entry, parentDir, now) {
  const name = entry.name;
  const isDir = entry.isDirectory();

  // Puppeteer一時プロファイル → 即削除
  if (isDir && name.startsWith('puppeteer_dev_')) return true;

  // Chromium/Chrome一時フォルダ → 即削除
  if (isDir && (name.startsWith('chromium_') || name.startsWith('chrome_'))) return true;

  // .tmpファイル（1時間以上経過）
  if (!isDir && name.endsWith('.tmp')) {
    try {
      const stat = fs.statSync(path.join(parentDir, name));
      if (now - stat.birthtimeMs >= TMP_AGE_THRESHOLD_MS) return true;
    } catch { /* skip */ }
  }

  // tmpで始まるフォルダ（1時間以上経過）
  if (isDir && name.startsWith('tmp')) {
    try {
      const stat = fs.statSync(path.join(parentDir, name));
      if (now - stat.birthtimeMs >= TMP_AGE_THRESHOLD_MS) return true;
    } catch { /* skip */ }
  }

  return false;
}

function cleanupTemp() {
  console.log(`[temp-cleanup] 実行開始: ${new Date().toISOString()}`);

  // Tempフォルダの掃除対象を全サブフォルダに拡張
  // process.env.TEMP は実行環境によって Temp\1 だったり Temp 直下だったりする。
  // basename が数字ならその親（Temp 本体）、そうでなければ自身を基点にする。
  const tempEnv = process.env.TEMP || os.tmpdir();
  const baseTempDir = /^\d+$/.test(path.basename(tempEnv))
    ? path.dirname(tempEnv)
    : tempEnv;
  const tempDirs = [];
  // Temp直下
  tempDirs.push(baseTempDir);

  // Temp\1, Temp\2, Temp\3 ... 等の数字サブフォルダも対象
  try {
    const baseEntries = fs.readdirSync(baseTempDir, { withFileTypes: true });
    for (const entry of baseEntries) {
      if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
        tempDirs.push(path.join(baseTempDir, entry.name));
      }
    }
  } catch (e) {
    console.log(`[temp-cleanup] Tempサブフォルダ列挙エラー: ${e.message}`);
  }

  const dirLabels = tempDirs.map(d => path.basename(d) === 'Temp' ? 'Temp' : `Temp\\${path.basename(d)}`);
  console.log(`[temp-cleanup] Temp掃除開始（対象: ${dirLabels.join(', ')}）`);

  const now = Date.now();
  let grandTotalFreed = 0;

  for (const tempDir of tempDirs) {
    const label = tempDir === baseTempDir ? 'Temp' : `Temp\\${path.basename(tempDir)}`;

    let entries;
    try {
      entries = fs.readdirSync(tempDir, { withFileTypes: true });
    } catch (err) {
      console.error(`[temp-cleanup] ${label}: 読み取りエラー: ${err.message}`);
      continue;
    }

    const targets = [];
    for (const entry of entries) {
      if (shouldDelete(entry, tempDir, now)) {
        targets.push(entry);
      }
    }

    if (targets.length === 0) {
      console.log(`[temp-cleanup] ${label}: 削除対象なし`);
      continue;
    }

    // 削除前サイズ計算
    let totalSize = 0;
    for (const entry of targets) {
      totalSize += getEntrySize(path.join(tempDir, entry.name), entry.isDirectory());
    }
    console.log(`[temp-cleanup] ${label}: 対象 ${targets.length}件 (${formatBytes(totalSize)})`);

    let deleted = 0;
    let failed = 0;
    let freedBytes = 0;

    for (const entry of targets) {
      const fullPath = path.join(tempDir, entry.name);
      const entrySize = getEntrySize(fullPath, entry.isDirectory());
      try {
        fs.rmSync(fullPath, { recursive: true, force: true });
        deleted++;
        freedBytes += entrySize;
      } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EPERM') {
          // 使用中 → スキップ
        } else {
          console.warn(`[temp-cleanup] ${label}: 削除失敗: ${entry.name} (${err.code || err.message})`);
        }
        failed++;
      }
    }

    console.log(`[temp-cleanup] ${label}: 削除完了 ${deleted}件, 失敗${failed}件, ${formatBytes(freedBytes)}解放`);
    grandTotalFreed += freedBytes;
  }

  console.log(`[temp-cleanup] 合計: ${formatBytes(grandTotalFreed)}解放`);
}

try {
  main();
} catch (err) {
  console.error(`[chrome-cleanup] エラー: ${err.message}`);
}

try {
  cleanupTemp();
} catch (err) {
  console.error(`[temp-cleanup] エラー: ${err.message}`);
}
