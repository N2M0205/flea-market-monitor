// server/routes/line.js
const express = require('express');
const router = express.Router();
const lineController = require('../controllers/LineController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * =====================================================
 * LINE Webhook
 * =====================================================
 * @route   POST /api/line/webhook
 * @desc    LINEからのイベント受信（友だち追加・メッセージ等）
 * @access  Public（LINEプラットフォームからのみ）
 */
router.post('/webhook', lineController.webhook);

/**
 * =====================================================
 * LINEアカウント連携
 * =====================================================
 * @route   POST /api/line/link
 * @desc    6桁の連携コードを使ってユーザーとLINEを紐付け
 * @access  Private（ログイン必須）
 */
router.post('/link', authMiddleware, lineController.linkAccount);

/**
 * =====================================================
 * 開発用：連携コード発行
 * =====================================================
 * @route   POST /api/line/dev/generate-code
 * @desc    ローカル開発用に6桁の連携コードを発行
 * @access  Private
 * @note    production環境では controller 側で 404 にされる
 */
router.post(
  '/dev/generate-code',
  authMiddleware,
  lineController.generateDevLinkCode
);

module.exports = router;
