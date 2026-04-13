// server/services/LayerAFilterService.js
// Layer A フィルタ（5条件）＋希少度スコア計算
// 設定は server/config/layerA.json で管理（DBではなくJSONファイル）

const fs   = require('fs');
const path = require('path');

// 設定ファイルのパス
const CONFIG_PATH = path.resolve(__dirname, '../config/layerA.json');

// NG語句リスト
const NG_WORDS = [
  '開封済',　'使用済', '使用中', '中古', '箱なし', '箱無し',
  'ジャンク', '破損', '傷あり', '傷有り', '汚れあり', '汚れ有り',
  '訳あり', '訳有り', '欠品', 'シール剥がし', 'シール剥がれ',
  'タグなし', 'タグ無し', '期限切れ', '賞味期限切れ',
];

// デフォルト閾値
const DEFAULTS = {
  layer_a_min_rating:        90,  // 出品者評価の下限（%）
  layer_a_max_hours:         48,  // 出品経過時間の上限（時間）
  layer_a_min_expiry_months:  5,  // 賞味期限の最低残存月数
};

// ─────────────────────────────────────────────
// JSONファイルから Layer A 設定をロード
// ─────────────────────────────────────────────

/**
 * server/config/layerA.json から閾値を取得する
 * ファイルが存在しない場合はデフォルト値を返す
 * @returns {Promise<{ layer_a_min_rating: number, layer_a_max_hours: number, layer_a_min_expiry_months: number }>}
 */
async function loadLayerAConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    }
  } catch (err) {
    console.warn('⚠️ LayerA config読み込み失敗、デフォルト値を使用:', err.message);
  }
  return { ...DEFAULTS };
}

// ─────────────────────────────────────────────
// メインフィルタ関数
// ─────────────────────────────────────────────

/**
 * Layer A フィルタを適用する
 * @param {object} product  - スクレイピング結果の商品オブジェクト
 * @param {object} keyword  - DBのキーワードレコード（min_price を含む）
 * @param {object} config   - loadLayerAConfig() の戻り値
 * @returns {{ pass: boolean, reason: string, expiryMonths: number|null, hoursOld: number }}
 */
function layerAFilter(product, keyword, config) {
  const price       = Number(product.price) || 0;
  const title       = (product.title        || '').trim();
  const description = (product.description  || '').trim();
  const fullText    = `${title} ${description}`;

  // ─── 条件1: 下限価格 ───
  const minPrice = Number(keyword?.min_price) || 0;
  if (minPrice > 0 && price < minPrice) {
    return { pass: false, reason: `下限価格未満 (¥${price} < ¥${minPrice})`, expiryMonths: null, hoursOld: 0 };
  }

  // ─── 条件1.5: 上限価格 ───
  const maxPrice = Number(keyword?.max_price) || 0;
  if (maxPrice > 0 && price > maxPrice) {
    console.log(`  🚫 上限価格超過: ¥${price} > ¥${maxPrice} [${product.title}]`);
    return { pass: false, reason: `上限価格超過 (¥${price} > ¥${maxPrice})`, expiryMonths: null, hoursOld: 0 };
  }

  // ─── 条件2: 出品者評価 ───
  const rating    = parseSellerRating(product);
  const minRating = config.layer_a_min_rating;
  if (rating !== null && rating < minRating) {
    return { pass: false, reason: `出品者評価不足 (${rating}% < ${minRating}%)`, expiryMonths: null, hoursOld: 0 };
  }

  // ─── 条件3: 出品経過時間 ───
  const hoursOld = calcHoursFromNow(product);
  const maxHours = config.layer_a_max_hours;
  if (hoursOld !== null && hoursOld > maxHours) {
    return { pass: false, reason: `出品経過時間超過 (${hoursOld.toFixed(1)}h > ${maxHours}h)`, expiryMonths: null, hoursOld };
  }

  // ─── 条件4: 賞味期限 ───
  const expiryMonths    = parseExpiryMonths(fullText);
  const minExpiryMonths = config.layer_a_min_expiry_months;
  if (expiryMonths !== null && expiryMonths < minExpiryMonths) {
    return { pass: false, reason: `賞味期限残存不足 (残${expiryMonths}ヶ月 < ${minExpiryMonths}ヶ月)`, expiryMonths, hoursOld: hoursOld || 0 };
  }

  // ─── 条件5: NG語句 ───
  const ngWord = NG_WORDS.find(w => fullText.includes(w));
  if (ngWord) {
    return { pass: false, reason: `NG語句検出: "${ngWord}"`, expiryMonths, hoursOld: hoursOld || 0 };
  }

  // ─── 条件6: 除外キーワード ───
  const excludeResult = isExcluded(title, keyword);
  if (excludeResult.excluded) {
    console.log(`  🚫 除外: ${title} [${excludeResult.reason}]`);
    return { pass: false, reason: excludeResult.reason, expiryMonths, hoursOld: hoursOld || 0 };
  }

  // ─── 全通過 ───
  return { pass: true, reason: 'OK', expiryMonths, hoursOld: hoursOld || 0 };
}

// ─────────────────────────────────────────────
// 除外キーワードチェック
// ─────────────────────────────────────────────

const GLOBAL_EXCLUDE_JSON = path.resolve(__dirname, '../../data/global_exclude_keywords.json');
const globalExcludeFallback = require('../config/globalExcludeKeywords');

function loadGlobalExcludes() {
  try {
    if (fs.existsSync(GLOBAL_EXCLUDE_JSON)) {
      return JSON.parse(fs.readFileSync(GLOBAL_EXCLUDE_JSON, 'utf-8'));
    }
  } catch (_) {}
  return globalExcludeFallback;
}

function isExcluded(title, keyword) {
  // 全体除外（keyword.global_exclude_enabled が false でなければ適用）
  if (keyword.global_exclude_enabled !== false) {
    const globalExcludes = loadGlobalExcludes();
    for (const word of globalExcludes) {
      if (title.includes(word)) return { excluded: true, reason: `全体除外: ${word}` };
    }
  }

  // キーワード個別除外
  if (keyword.exclude_keywords) {
    const raw = typeof keyword.exclude_keywords === 'string' ? keyword.exclude_keywords : '';
    const perKeywords = raw.split(',').map(w => w.trim()).filter(Boolean);
    for (const word of perKeywords) {
      if (title.includes(word)) return { excluded: true, reason: `個別除外: ${word}` };
    }
  }

  return { excluded: false };
}

// ─────────────────────────────────────────────
// ヘルパー関数
// ─────────────────────────────────────────────

/**
 * 出品者評価を数値（%）で返す
 * product.seller_rating / product.sellerRating / product.rating に対応
 * @returns {number|null} null = 情報なし
 */
function parseSellerRating(product) {
  const raw =
    product.seller_rating ??
    product.sellerRating  ??
    product.rating        ??
    null;

  if (raw === null || raw === undefined) return null;

  // "98.7%" → 98.7
  const str = String(raw).replace('%', '').trim();
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/**
 * 出品からの経過時間（時間）を返す
 * product.listed_at / product.listedAt / product.created_at / product.createdAt に対応
 * @returns {number|null} null = 情報なし
 */
function calcHoursFromNow(product) {
  const raw =
    product.listed_at  ||
    product.listedAt   ||
    product.created_at ||
    product.createdAt  ||
    null;

  if (!raw) return null;

  const listedDate = new Date(raw);
  if (isNaN(listedDate.getTime())) return null;

  const diffMs = Date.now() - listedDate.getTime();
  return diffMs / (1000 * 60 * 60); // ミリ秒 → 時間
}

/**
 * 商品説明から賞味期限の残存月数を抽出する
 * 対応フォーマット:
 *   "2026年8月" / "2026/08" / "2026-08" / "2026.8" / "26/08"
 * @returns {number|null} null = 期限不明
 */
function parseExpiryMonths(text) {
  if (!text) return null;

  const now = new Date();

  // パターン1: YYYY年M月 / YYYY年MM月
  const m1 = text.match(/(\d{4})年\s*(\d{1,2})月/);
  if (m1) {
    return _monthsUntil(parseInt(m1[1]), parseInt(m1[2]), now);
  }

  // パターン2: YYYY/MM or YYYY-MM or YYYY.MM
  const m2 = text.match(/(\d{4})[\/\-\.](\d{1,2})(?![\/\-\.\d])/);
  if (m2) {
    return _monthsUntil(parseInt(m2[1]), parseInt(m2[2]), now);
  }

  // パターン3: YY/MM (例: 26/08)
  const m3 = text.match(/(\d{2})\/(\d{2})(?!\d)/);
  if (m3) {
    const year = 2000 + parseInt(m3[1]);
    return _monthsUntil(year, parseInt(m3[2]), now);
  }

  return null; // 期限不明
}

function _monthsUntil(year, month, now) {
  const diff = (year - now.getFullYear()) * 12 + (month - (now.getMonth() + 1));
  return diff; // 負の値 = 既に期限切れ
}

/**
 * 希少度スコアを計算する
 * @param {number} sales28 - 過去28日の販売数（GASマスタから）
 * @returns {{ label: string, emoji: string }}
 */
function calcRarityScore(sales28) {
  const s = Number(sales28) || 0;
  if (s === 0)  return { label: '超希少', emoji: '🔥' };
  if (s <= 3)   return { label: '希少',   emoji: '⚠️' };
  if (s <= 10)  return { label: '普通',   emoji: '📦' };
  return        { label: '過多',   emoji: '📦' };
}

// ─────────────────────────────────────────────
// 初期設定ファイル作成（起動時に1回呼ばれる）
// ─────────────────────────────────────────────

/**
 * server/config/layerA.json が存在しない場合にデフォルト値で作成する
 * DBは使わない（Settingsテーブルはuser_id必須のため非対応）
 */
async function seedLayerASettings() {
  try {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf-8');
      console.log('✅ Layer A 設定ファイル作成完了:', CONFIG_PATH);
    } else {
      console.log('ℹ️ Layer A 設定ファイル確認済み（既存）');
    }
  } catch (err) {
    console.warn('⚠️ Layer A 設定ファイル作成失敗:', err.message);
  }
}

module.exports = {
  loadLayerAConfig,
  layerAFilter,
  parseSellerRating,
  calcHoursFromNow,
  parseExpiryMonths,
  calcRarityScore,
  seedLayerASettings,
};
