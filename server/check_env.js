/**
 * check_env.js
 * picofuri / flea-market-monitor
 * 
 * 使い方:
 *   cd C:\Users\Administrator\Desktop\flea-market-monitor\server
 *   node check_env.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LINE = '='.repeat(60);
const line = '-'.repeat(60);

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function ok(label, detail = '') {
  passCount++;
  console.log(`  [OK]  ${label}${detail ? '  (' + detail + ')' : ''}`);
}
function ng(label, fix = '') {
  failCount++;
  console.log(`  [NG]  ${label}`);
  if (fix) console.log(`        修正 => ${fix}`);
}
function warn(label, note = '') {
  warnCount++;
  console.log(`  [WRN] ${label}`);
  if (note) console.log(`        補足 => ${note}`);
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
  } catch (e) {
    return null;
  }
}

// ============================================================
console.log('\n' + LINE);
console.log(' ピコフリ 起動環境チェック');
console.log(' 実行日時: ' + new Date().toLocaleString('ja-JP'));
console.log(LINE + '\n');

// ----------------------------------------------------------
// [1] Node.js
// ----------------------------------------------------------
console.log('[1/8] Node.js');
const nodeVer = run('node -v');
if (nodeVer) {
  ok('Node.js インストール済み', nodeVer);
} else {
  ng('Node.js が見つかりません', 'https://nodejs.org/ からインストール');
}

// ----------------------------------------------------------
// [2] npm
// ----------------------------------------------------------
console.log('[2/8] npm');
const npmVer = run('npm -v');
if (npmVer) {
  ok('npm インストール済み', 'v' + npmVer);
} else {
  ng('npm が見つかりません', 'Node.js を再インストール');
}

// ----------------------------------------------------------
// [3] pm2
// ----------------------------------------------------------
console.log('[3/8] pm2');
const pm2Ver = run('pm2 -v');
if (pm2Ver) {
  ok('pm2 インストール済み', 'v' + pm2Ver);
} else {
  ng('pm2 が見つかりません', 'npm install -g pm2');
}

// ----------------------------------------------------------
// [4] Puppeteer Chrome
// ----------------------------------------------------------
console.log('[4/8] Puppeteer 用 Chrome');
const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
if (fs.existsSync(cacheDir)) {
  // chromeのexeを探す
  let exeFound = false;
  try {
    const dirs = fs.readdirSync(cacheDir);
    for (const d of dirs) {
      const exePath = path.join(cacheDir, d, 'chrome-win64', 'chrome.exe');
      const exePath2 = path.join(cacheDir, d, 'chrome.exe');
      if (fs.existsSync(exePath) || fs.existsSync(exePath2)) {
        exeFound = true;
        ok('Chrome (Puppeteer用) が存在します', d);
        break;
      }
    }
    if (!exeFound) {
      // フォルダはあるがexeが見つからない
      warn('Chromeフォルダはありますが chrome.exe が見つかりません',
           'npx puppeteer browsers install chrome を再実行');
    }
  } catch(e) {
    warn('Chromeキャッシュの読み取り中にエラー: ' + e.message);
  }
} else {
  ng('Puppeteer用Chrome が見つかりません',
     'cd Desktop\\flea-market-monitor\\server && npx puppeteer browsers install chrome');
}

// ----------------------------------------------------------
// [5] プロジェクトフォルダ
// ----------------------------------------------------------
console.log('[5/8] プロジェクトフォルダ');
// スクリプト自体の場所で判定
const serverDir = __dirname;
if (fs.existsSync(serverDir)) {
  ok('実行ディレクトリ', serverDir);
} else {
  ng('プロジェクトフォルダが見つかりません');
}

// ----------------------------------------------------------
// [6] node_modules
// ----------------------------------------------------------
console.log('[6/8] node_modules');
const nodeModulesDir = path.join(serverDir, 'node_modules');
if (fs.existsSync(nodeModulesDir)) {
  ok('node_modules フォルダが存在します');
} else {
  ng('node_modules がありません', 'npm install');
}

// ----------------------------------------------------------
// [7] .env ファイル
// ----------------------------------------------------------
console.log('[7/8] .env ファイル');
const envPaths = [
  path.join(serverDir, '.env'),
  path.join(serverDir, '..', '.env'),
];
let envFound = false;
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    ok('.env ファイルが存在します', p);
    envFound = true;

    // 必須キーの確認
    const envContent = fs.readFileSync(p, 'utf8');
    const requiredKeys = [
      'LINE_BOT_TOKEN',
      'ENABLE_SCHEDULER',
      'SCRAPING_INTERVAL',
    ];
    const missingKeys = requiredKeys.filter(k => !envContent.includes(k + '='));
    if (missingKeys.length > 0) {
      warn('.env に未設定のキーがあります: ' + missingKeys.join(', '));
    } else {
      ok('.env 必須キー全て設定済み');
    }
    break;
  }
}
if (!envFound) {
  warn('.env ファイルが見つかりません', '.env を作成して LINE_BOT_TOKEN 等を設定してください');
}

// ----------------------------------------------------------
// [8] pm2 起動状況
// ----------------------------------------------------------
console.log('[8/8] pm2 プロセス状況');
const pm2List = run('pm2 jlist');
if (pm2List) {
  try {
    const procs = JSON.parse(pm2List);
    if (procs.length === 0) {
      warn('pm2 に登録されたプロセスがありません（未起動）',
           'pm2 start ecosystem.config.js  または  pm2 start server.js --name picofuri');
    } else {
      procs.forEach(p => {
        const status = p.pm2_env?.status || 'unknown';
        const name   = p.name || p.pm2_env?.name || '(no name)';
        const mem    = p.monit?.memory ? Math.round(p.monit.memory / 1024 / 1024) + 'MB' : '-';
        const cpu    = p.monit?.cpu != null ? p.monit.cpu + '%' : '-';
        const uptime = p.pm2_env?.pm_uptime
          ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 1000 / 60) + '分'
          : '-';
        const restarts = p.pm2_env?.restart_time ?? '-';

        if (status === 'online') {
          ok(`[${name}] status=online  MEM=${mem}  CPU=${cpu}  uptime=${uptime}  restarts=${restarts}`);
        } else {
          ng(`[${name}] status=${status}  restarts=${restarts}`,
             `pm2 restart ${name}  または  pm2 logs ${name} でエラー確認`);
        }
      });
    }
  } catch(e) {
    warn('pm2 の結果をパースできませんでした: ' + e.message);
  }
} else {
  warn('pm2 コマンドが実行できませんでした');
}

// ----------------------------------------------------------
// パッケージバージョン一覧
// ----------------------------------------------------------
console.log('\n' + line);
console.log(' インストール済みパッケージ (node_modules)');
console.log(line);

const pkgs = [
  'express', 'sequelize', 'sqlite3', 'puppeteer', 'puppeteer-core',
  'node-cron', 'axios', 'cheerio', 'dotenv', 'cors',
  'jsonwebtoken', 'bcryptjs', 'sequelize-cli',
];

for (const pkg of pkgs) {
  const pkgJson = path.join(serverDir, 'node_modules', pkg, 'package.json');
  if (fs.existsSync(pkgJson)) {
    try {
      const { version } = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      console.log(`  [OK]  ${pkg.padEnd(20)} v${version}`);
    } catch(e) {
      console.log(`  [OK]  ${pkg.padEnd(20)} (バージョン読み取り失敗)`);
    }
  } else {
    console.log(`  [--]  ${pkg.padEnd(20)} 未インストール`);
  }
}

// ----------------------------------------------------------
// サマリー
// ----------------------------------------------------------
console.log('\n' + LINE);
console.log(' チェック結果サマリー');
console.log(LINE);
console.log(`  [OK]  ${passCount} 項目`);
console.log(`  [NG]  ${failCount} 項目  ← 要対応`);
console.log(`  [WRN] ${warnCount} 項目  ← 確認推奨`);
console.log('');
if (failCount === 0 && warnCount === 0) {
  console.log('  ✅ 全て問題ありません！起動できる状態です。');
} else if (failCount === 0) {
  console.log('  ⚠️  NG はありませんが WRN を確認してください。');
} else {
  console.log('  ❌ NG 項目を修正してからサーバーを起動してください。');
}
console.log(LINE + '\n');
