'use strict';

/**
 * タイトルからまとめ売り数量を検出する
 *
 * 検出ルール:
 *   - 数量 2〜10 → まとめ売り（出品価格 ÷ 数量 = 単価に換算）
 *   - 数量 11以上 → 商品仕様（袋数・本数等）と判断してスルー
 *   - 未検出 → 1 を返す（そのまま）
 *
 * @param {string} title - フリマ商品タイトル
 * @returns {number} 検出した数量（未検出は 1）
 */
function detectSetQuantity(title) {
  if (!title) return 1;

  const patterns = [
    /[×x×](\d+)/,
    /(\d+)個(?:セット|まとめ|入り)?/,
    /(\d+)袋(?:セット|まとめ|入り)?/,
    /(\d+)本(?:セット|入り)?/,
    /(\d+)点(?:セット|まとめ)?/,
    /(\d+)箱(?:セット)?/,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 2 && n <= 10) return n;
    }
  }

  return 1;
}

module.exports = { detectSetQuantity };
