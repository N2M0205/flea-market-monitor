const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, '../../logs');

function ensureLogDir() {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
}

function getLogPath() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return path.join(logDir, `run-${ymd}.log`);
}

function log(msg) {
  if (process.env.RUN_LOG_ENABLED === 'false') return; // ← 無効化スイッチ
  ensureLogDir();
  const ts = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  try {
    fs.appendFileSync(getLogPath(), `[${ts}] ${msg}\n`, 'utf8');
  } catch (e) {}
}

module.exports = { log };