const { Keyword } = require('../models');
const { v4: uuidv4 } = require('uuid');

class KeywordController {
  /**
   * キーワード一覧取得
   */
  async getKeywords(req, res) {
    try {
      const userId = req.user.id;

      const keywords = await Keyword.findAll({
        where: { user_id: userId },
        order: [['created_at', 'DESC']]
      });

      res.json({
        success: true,
        data: keywords
      });
    } catch (error) {
      console.error('❌ キーワード取得エラー:', error);
      res.status(500).json({
        success: false,
        message: 'キーワードの取得に失敗しました'
      });
    }
  }

  /**
   * キーワード登録
   */
  async createKeyword(req, res) {
    try {
      const userId = req.user.id;
      const {
        keyword,
        platforms = ['mercari', 'yahoo_flea'],
        min_price,
        max_price,
        exclude_keywords = [],
        crossmall_item_code
      } = req.body;

      // バリデーション
      if (!keyword || keyword.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'キーワードを入力してください'
        });
      }

      // 重複チェック
      const existingKeyword = await Keyword.findOne({
        where: {
          user_id: userId,
          keyword: keyword.trim()
        }
      });

      if (existingKeyword) {
        return res.status(400).json({
          success: false,
          message: 'このキーワードは既に登録されています'
        });
      }

      // キーワード作成
      const newKeyword = await Keyword.create({
        id: uuidv4(),
        user_id: userId,
        keyword: keyword.trim(),
        platforms: JSON.stringify(platforms),
        min_price: min_price || null,
        max_price: max_price || null,
        exclude_keywords: JSON.stringify(exclude_keywords),
        crossmall_item_code: crossmall_item_code || null,
        is_active: true,
        detection_count: 0
      });

      console.log(`✅ キーワード登録完了: "${keyword}"`);
      if (crossmall_item_code) {
        console.log(`📦 CROSSMALL商品コード: ${crossmall_item_code}`);
      }

      res.status(201).json({
        success: true,
        message: 'キーワードを登録しました',
        data: newKeyword
      });
    } catch (error) {
      console.error('❌ キーワード登録エラー:', error);
      res.status(500).json({
        success: false,
        message: 'キーワードの登録に失敗しました'
      });
    }
  }

  /**
   * キーワード更新
   */
  async updateKeyword(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const {
        keyword,
        platforms,
        min_price,
        max_price,
        exclude_keywords,
        crossmall_item_code,
        is_active
      } = req.body;

      const existingKeyword = await Keyword.findOne({
        where: { id, user_id: userId }
      });

      if (!existingKeyword) {
        return res.status(404).json({
          success: false,
          message: 'キーワードが見つかりません'
        });
      }

      // 更新
      const updateData = {};
      if (keyword !== undefined) updateData.keyword = keyword.trim();
      if (platforms !== undefined) updateData.platforms = JSON.stringify(platforms);
      if (min_price !== undefined) updateData.min_price = min_price;
      if (max_price !== undefined) updateData.max_price = max_price;
      if (exclude_keywords !== undefined) updateData.exclude_keywords = JSON.stringify(exclude_keywords);
      if (crossmall_item_code !== undefined) updateData.crossmall_item_code = crossmall_item_code;
      if (is_active !== undefined) updateData.is_active = is_active;

      await existingKeyword.update(updateData);

      console.log(`✅ キーワード更新完了: "${existingKeyword.keyword}"`);

      res.json({
        success: true,
        message: 'キーワードを更新しました',
        data: existingKeyword
      });
    } catch (error) {
      console.error('❌ キーワード更新エラー:', error);
      res.status(500).json({
        success: false,
        message: 'キーワードの更新に失敗しました'
      });
    }
  }

  /**
   * キーワード削除
   */
  async deleteKeyword(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const keyword = await Keyword.findOne({
        where: { id, user_id: userId }
      });

      if (!keyword) {
        return res.status(404).json({
          success: false,
          message: 'キーワードが見つかりません'
        });
      }

      await keyword.destroy();

      console.log(`✅ キーワード削除完了: "${keyword.keyword}"`);

      res.json({
        success: true,
        message: 'キーワードを削除しました'
      });
    } catch (error) {
      console.error('❌ キーワード削除エラー:', error);
      res.status(500).json({
        success: false,
        message: 'キーワードの削除に失敗しました'
      });
    }
  }
}

module.exports = new KeywordController();
