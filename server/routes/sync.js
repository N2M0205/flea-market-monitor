// server/routes/sync.js
// GAS → VPS  仕入れマスタ同期エンドポイント
//
//  POST /api/sync/purchase-master
//    Header: X-Secret-Key: <VPS_SECRET_KEY>
//    Body:   { syncedAt, totalItems, items: [{sku, productName, purchaseLimit, stock, sales28}] }

const express = require('express');
const router = express.Router();
const purchaseMasterCache = require('../services/PurchaseMasterCache');

// ─────────────────────────────────────────────
// 認証ミドルウェア（Secret Key チェック）
// ─────────────────────────────────────────────
function verifySyncSecret(req, res, next) {
  const expected = (process.env.VPS_SECRET_KEY || '').trim();
  const provided  = (req.headers['x-secret-key'] || '').trim();

  if (!expected) {
    console.warn('⚠️ VPS_SECRET_KEY が未設定です。認証をスキップします（開発モード）');
    return next();
  }

  if (!provided || provided !== expected) {
    console.warn(`🚫 sync: 認証失敗（IP: ${req.ip}）`);
    return res.status(401).json({ success: false, error: '認証エラー: X-Secret-Key が不正です' });
  }

  next();
}

// ─────────────────────────────────────────────
// POST /api/sync/purchase-master
// ─────────────────────────────────────────────
router.post('/purchase-master', verifySyncSecret, (req, res) => {
  const startTime = Date.now();
  const { syncedAt, totalItems, items } = req.body;

  console.log('\n====================================');
  console.log(`📥 仕入れマスタ同期リクエスト受信 - ${new Date().toLocaleString('ja-JP')}`);
  console.log(`   件数: ${Array.isArray(items) ? items.length : '不正'}, syncedAt: ${syncedAt}`);
  console.log('====================================\n');

  // ─── バリデーション ───
  if (!Array.isArray(items)) {
    return res.status(400).json({
      success: false,
      error: 'items は配列である必要があります',
    });
  }
  if (items.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'items が空です。0件のデータは受け付けません',
    });
  }

  // ─── キャッシュ更新 ───
  try {
    purchaseMasterCache.updateCache({ syncedAt, totalItems, items });

    const elapsed = Date.now() - startTime;
    const status = purchaseMasterCache.getCacheStatus();

    console.log(`✅ sync 完了: ${items.length}件, 処理時間=${elapsed}ms`);

    return res.status(200).json({
      success: true,
      message: '仕入れマスタの同期が完了しました',
      cached: {
        totalItems: status.totalItems,
        syncedAt:   status.syncedAt,
        elapsedMs:  elapsed,
      },
    });

  } catch (err) {
    console.error('❌ sync エラー:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ─────────────────────────────────────────────
// GET /api/sync/status  ─ キャッシュ状態確認用
// ─────────────────────────────────────────────
router.get('/status', (req, res) => {
  const status = purchaseMasterCache.getCacheStatus();
  return res.json({
    success: true,
    cache: status,
  });
});

module.exports = router;
