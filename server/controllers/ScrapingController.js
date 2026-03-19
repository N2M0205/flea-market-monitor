const scrapingService = require('../services/ScrapingService');
const db = require('../models');

/**
 * スクレイピング手動実行
 */
exports.startScraping = async (req, res) => {
  try {
    const { keyword_id } = req.body;

    if (keyword_id) {
      // 特定のキーワードのみスクレイピング
      const keyword = await db.Keyword.findOne({
        where: {
          id: keyword_id,
          user_id: req.user.id
        }
      });

      if (!keyword) {
        return res.status(404).json({
          success: false,
          error: 'キーワードが見つかりません'
        });
      }

      // 非同期でスクレイピング実行
      scrapingService.scrapeKeyword(keyword).then(() => {
        console.log(`✅ キーワード "${keyword.keyword}" のスクレイピング完了`);
      });

      res.json({
        success: true,
        message: `キーワード "${keyword.keyword}" のスクレイピングを開始しました`
      });

    } else {
      // 全キーワードをスクレイピング
      if (scrapingService.getStatus().is_running) {
        return res.status(400).json({
          success: false,
          error: 'スクレイピングは既に実行中です'
        });
      }

      // 非同期でスクレイピング実行
      scrapingService.scrapeAllKeywords().then(() => {
        console.log('✅ 全キーワードのスクレイピング完了');
      });

      res.json({
        success: true,
        message: 'スクレイピングを開始しました'
      });
    }

  } catch (error) {
    console.error('Start scraping error:', error);
    res.status(500).json({
      success: false,
      error: 'スクレイピングの開始に失敗しました'
    });
  }
};

/**
 * スクレイピングステータス取得
 */
exports.getStatus = async (req, res) => {
  try {
    const status = scrapingService.getStatus();

    // 最近のスクレイピング実績
    const recentProducts = await db.Product.findAll({
      limit: 5,
      order: [['created_at', 'DESC']],
      include: [
        {
          model: db.Keyword,
          as: 'keyword',
          where: { user_id: req.user.id },
          attributes: ['keyword']
        }
      ]
    });

    res.json({
      success: true,
      data: {
        is_running: status.is_running,
        recent_products: recentProducts
      }
    });

  } catch (error) {
    console.error('Get status error:', error);
    res.status(500).json({
      success: false,
      error: 'ステータスの取得に失敗しました'
    });
  }
};
