const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middleware/authMiddleware');

const JSON_PATH = path.resolve(__dirname, '../../data/global_exclude_keywords.json');
const FALLBACK_PATH = path.resolve(__dirname, '../config/globalExcludeKeywords.js');

router.use(authMiddleware);

/**
 * GET /api/settings/global-excludes
 */
router.get('/global-excludes', (req, res) => {
  try {
    if (fs.existsSync(JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
      return res.json({ success: true, data });
    }
    const fallback = require(FALLBACK_PATH);
    res.json({ success: true, data: fallback });
  } catch (error) {
    console.error('❌ 全体除外キーワード取得エラー:', error.message);
    res.status(500).json({ success: false, message: '取得に失敗しました' });
  }
});

/**
 * POST /api/settings/global-excludes
 */
router.post('/global-excludes', (req, res) => {
  try {
    const keywords = req.body;
    if (!Array.isArray(keywords)) {
      return res.status(400).json({ success: false, message: '配列を送信してください' });
    }
    const dir = path.dirname(JSON_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(JSON_PATH, JSON.stringify(keywords, null, 2), 'utf-8');
    res.json({ success: true, data: keywords });
  } catch (error) {
    console.error('❌ 全体除外キーワード保存エラー:', error.message);
    res.status(500).json({ success: false, message: '保存に失敗しました' });
  }
});

module.exports = router;
