'use strict';

const express = require('express');
const router  = express.Router();
const { sequelize } = require('../models');

/**
 * GET /api/crossmall/items/search
 *
 * @query q     {string} 必須: item_name 部分一致キーワード（空は 400）
 * @query limit {number} 省略時 50、最大 100
 *
 * @returns {count: number, items: Array<{
 *   item_code, item_name, base_code, stock,
 *   has_n_variant, [n_variant_item_code]
 * }>}
 *
 * 仕様:
 * - n 変種 item_code（末尾 'n'）はメイン結果に出ない
 * - has_n_variant=true の場合のみ n_variant_item_code を含む
 * - stock は crossmall_stock の最新値（未登録は 0）
 */
router.get('/items/search', async (req, res) => {
  try {
    const q = (req.query.q ?? '').trim();
    if (!q) {
      return res.status(400).json({ error: 'q パラメータは必須です' });
    }

    const rawLimit = parseInt(req.query.limit ?? '50', 10);
    const limit    = isNaN(rawLimit) ? 50 : Math.min(Math.max(rawLimit, 1), 100);

    // n 変種を除いたメイン結果 + stock + n 変種の有無を一発で取得
    // SQLite では SUBSTR(ci.item_code, -1) = 'n' で末尾判定
    const sql = `
      SELECT
        ci.item_code,
        ci.item_name,
        ci.base_code,
        COALESCE(cs.stock_count, 0)  AS stock,
        nv.item_code                 AS n_variant_item_code
      FROM crossmall_items ci
      LEFT JOIN crossmall_stock  cs ON cs.item_code = ci.item_code
      LEFT JOIN crossmall_items  nv ON nv.base_code = ci.item_code
                                    AND SUBSTR(nv.item_code, -1) = 'n'
      WHERE ci.item_name LIKE :pattern
        AND SUBSTR(ci.item_code, -1) != 'n'
      ORDER BY ci.item_code
      LIMIT :limit
    `;

    const rows = await sequelize.query(sql, {
      replacements: { pattern: `%${q}%`, limit },
      type: sequelize.QueryTypes.SELECT,
    });

    const items = rows.map(row => {
      const obj = {
        item_code:    row.item_code,
        item_name:    row.item_name,
        base_code:    row.base_code,
        stock:        row.stock ?? 0,
        has_n_variant: !!row.n_variant_item_code,
      };
      if (row.n_variant_item_code) {
        obj.n_variant_item_code = row.n_variant_item_code;
      }
      return obj;
    });

    return res.json({ count: items.length, items });
  } catch (err) {
    console.error('[crossmall/items/search] error:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
