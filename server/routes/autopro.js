'use strict';

const express = require('express');
const router  = express.Router();
const { AutoproPurchase } = require('../models');

// X-Secret-Key 認証ミドルウェア
function requireSecretKey(req, res, next) {
  const provided = req.headers['x-secret-key'];
  const expected = process.env.VPS_SECRET_KEY;

  if (!expected) {
    console.error('[autopro] VPS_SECRET_KEY が .env に未設定');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }
  if (!provided || provided !== expected) {
    console.warn(`[autopro] 認証失敗: X-Secret-Key 不一致 (from ${req.ip})`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * POST /api/autopro/purchase
 * AUTOPROからの仕入れWebhook受信
 *
 * Headers:
 *   X-Secret-Key: {VPS_SECRET_KEY}
 *
 * Body:
 *   { item_code, item_name, quantity, unit_price, purchased_at }
 */
router.post('/purchase', requireSecretKey, async (req, res) => {
  const { item_code, item_name, quantity, unit_price, purchased_at } = req.body;

  if (!item_code || quantity == null || unit_price == null || !purchased_at) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['item_code', 'quantity', 'unit_price', 'purchased_at'],
    });
  }

  const qty = parseInt(quantity, 10);
  const price = parseInt(unit_price, 10);

  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }
  if (isNaN(price) || price < 0) {
    return res.status(400).json({ error: 'unit_price must be a non-negative integer' });
  }

  const purchasedDate = new Date(purchased_at);
  if (isNaN(purchasedDate.getTime())) {
    return res.status(400).json({ error: 'purchased_at must be a valid ISO date string' });
  }

  try {
    const record = await AutoproPurchase.create({
      item_code: String(item_code).trim(),
      item_name: item_name ? String(item_name).trim() : null,
      quantity: qty,
      unit_price: price,
      purchased_at: purchasedDate,
    });

    console.log(`[autopro] 仕入れ記録: ${record.item_code} x${record.quantity} @${record.unit_price}円 (id=${record.id})`);

    return res.status(201).json({
      success: true,
      id: record.id,
      item_code: record.item_code,
      quantity: record.quantity,
      unit_price: record.unit_price,
      purchased_at: record.purchased_at,
    });
  } catch (err) {
    console.error('[autopro] DB保存エラー:', err.message);
    return res.status(500).json({ error: 'Database error', message: err.message });
  }
});

module.exports = router;
