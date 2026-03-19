const express = require('express');
const router = express.Router();
const ScrapingController = require('../controllers/ScrapingController');
const { authenticateToken } = require('../middleware/auth');

// すべてのルートに認証を適用
router.use(authenticateToken);

/**
 * @route   POST /api/scraping/start
 * @desc    スクレイピング手動実行
 * @access  Private
 */
router.post('/start', ScrapingController.startScraping);

/**
 * @route   GET /api/scraping/status
 * @desc    スクレイピングステータス取得
 * @access  Private
 */
router.get('/status', ScrapingController.getStatus);

module.exports = router;
