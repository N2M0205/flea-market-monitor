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
 * @route   GET /api/keywords/global-excludes
 * @desc    全体除外キーワード一覧取得
 * @access  Private
 */
router.get('/global-excludes', keywordController.getGlobalExcludes);

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

/**
 * @route   PUT /api/keywords/:id/exclude-keywords
 * @desc    キーワード個別除外キーワード更新
 * @access  Private
 */
router.put('/:id/exclude-keywords', keywordController.updateExcludeKeywords);

/**
 * @route   PUT /api/keywords/:id/global-exclude-enabled
 * @desc    全体除外キーワード有効/無効切替
 * @access  Private
 */
router.put('/:id/global-exclude-enabled', keywordController.updateGlobalExcludeEnabled);

module.exports = router;
