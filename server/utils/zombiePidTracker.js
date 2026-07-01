// server/utils/zombiePidTracker.js
//
// OSレベルの真のゾンビプロセス（HasExited済みだがtasklistに残り続けるPID）を
// 追跡し、一定回数kill失敗が続いたPIDを「既知の無害ゾンビ」としてスキップする。
// cleanup-chrome.cjs / ScrapingService.js の両方から共有される。

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'known_zombie_pids.json');
const FAIL_THRESHOLD = 5; // この回数以上kill失敗が続いたら既知ゾンビとしてスキップ

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
    console.error(`[zombie-tracker] 保存失敗: ${err.message}`);
  }
}

// PID再利用対策: 記録済みの起動時刻と一致しない場合は別プロセスとして扱う
function isSameProcess(entry, creationTimeIso) {
  if (!entry || !creationTimeIso) return false;
  return entry.firstSeen === creationTimeIso;
}

/**
 * 既知の無害ゾンビ（FAIL_THRESHOLD回以上失敗記録あり）かどうかを判定する。
 * creationTimeIsoが記録と一致しない場合はPID再利用とみなし、falseを返す。
 */
function isKnownZombie(pid, creationTimeIso) {
  const state = loadState();
  const entry = state[String(pid)];
  if (!entry) return false;
  if (!isSameProcess(entry, creationTimeIso)) return false;
  return entry.failCount >= FAIL_THRESHOLD;
}

/**
 * kill失敗を記録する。PID再利用（起動時刻が記録と異なる）を検知した場合は
 * 記録をリセットして新規プロセスとして扱う。戻り値は更新後のfailCount。
 */
function recordFailure(pid, creationTimeIso) {
  const state = loadState();
  const key = String(pid);
  const existing = state[key];
  const nowIso = new Date().toISOString();

  if (existing && isSameProcess(existing, creationTimeIso)) {
    state[key] = { ...existing, failCount: existing.failCount + 1, lastAttempt: nowIso };
  } else {
    state[key] = { firstSeen: creationTimeIso || nowIso, failCount: 1, lastAttempt: nowIso };
  }

  saveState(state);
  return state[key].failCount;
}

/** kill成功時に記録を削除する（同じPID番号が将来再利用されても混同しないため） */
function clearEntry(pid) {
  const state = loadState();
  const key = String(pid);
  if (state[key]) {
    delete state[key];
    saveState(state);
  }
}

/**
 * 実際にtasklistから消えているPID（=真に解消した）の記録を自動削除する。
 * currentAlivePids には現時点でtasklistに存在するchrome.exeのPID一覧を渡す。
 */
function pruneResolvedEntries(currentAlivePids) {
  const state = loadState();
  const aliveSet = new Set(currentAlivePids.map(String));
  let changed = false;

  for (const key of Object.keys(state)) {
    if (!aliveSet.has(key)) {
      delete state[key];
      changed = true;
    }
  }

  if (changed) saveState(state);
}

module.exports = {
  FAIL_THRESHOLD,
  isKnownZombie,
  recordFailure,
  clearEntry,
  pruneResolvedEntries,
};
