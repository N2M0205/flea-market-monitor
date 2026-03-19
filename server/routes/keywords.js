const express = require('express');
const router = express.Router();
const keywordController = require('../controllers/KeywordController');
const authMiddleware = require('../middleware/authMiddleware');

// すべてのルートに認証を適用
router.use(authMiddleware);

/**
 * @route   GET /api/keywords
 * @desc    キーワード一覧取得
 * @access  Private
 */
router.get('/', keywordController.getKeywords);

/**
 * @route   POST /api/keywords
 * @desc    キーワード登録
 * @access  Private
 * @body    {
 *            keyword: string (必須),
 *            platforms: array (オプション, デフォルト: ['mercari', 'yahoo_flea']),
 *            min_price: number (オプション),
 *            max_price: number (オプション),
 *            exclude_keywords: array (オプション),
 *            crossmall_item_code: string (オプション)
 *          }
 */
router.post('/', keywordController.createKeyword);

/**
 * @route   PUT /api/keywords/:id
 * @desc    キーワード更新
 * @access  Private
 */
router.put('/:id', keywordController.updateKeyword);

/**
 * @route   DELETE /api/keywords/:id
 * @desc    キーワード削除
 * @access  Private
 */
router.delete('/:id', keywordController.deleteKeyword);

module.exports = router;
