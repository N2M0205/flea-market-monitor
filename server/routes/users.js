// server/routes/users.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/UserController');
const authMiddleware = require('../middleware/authMiddleware');

// すべてのルートに認証を適用
router.use(authMiddleware);

/**
 * @route   GET /api/users/settings
 * @desc    ユーザー設定取得
 * @access  Private
 */
router.get('/settings', userController.getSettings);

/**
 * @route   PUT /api/users/settings
 * @desc    ユーザー設定更新
 * @access  Private
 * @body    {
 *            crossmall_account: string (オプション),
 *            crossmall_api_key: string (オプション),
 *            line_user_id: string (オプション)
 *          }
 */
router.put('/settings', userController.updateSettings);

module.exports = router;
