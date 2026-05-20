'use strict';

/**
 * フリマ商品タイトルからバリアントを判定する
 *
 * @param {string} title - フリマ商品タイトル
 * @param {Array<{item_code: string, variant_name: string, match_words: string|Array}>} variants
 *   - match_words は JSON文字列またはパース済み配列
 * @returns {{ matched: object|null, all: Array }}
 *   - matched: マッチしたバリアント（なければ null）
 *   - all: 全バリアント（まとめ表示用）
 */
function matchVariant(title, variants) {
  if (!title || !Array.isArray(variants) || variants.length === 0) {
    return { matched: null, all: variants || [] };
  }

  for (const variant of variants) {
    const words = _parseMatchWords(variant.match_words);
    for (const word of words) {
      if (word && title.includes(word)) {
        return { matched: variant, all: variants };
      }
    }
  }

  return { matched: null, all: variants };
}

function _parseMatchWords(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = { matchVariant };
