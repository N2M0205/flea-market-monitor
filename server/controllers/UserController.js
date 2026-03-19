// server/controllers/UserController.js
const { User } = require('../models');

const userController = {
  /**
   * ユーザー設定取得
   */
  async getSettings(req, res) {
    try {
      const user = await User.findByPk(req.user.id, {
        attributes: [
          'id',
          'username',
          'email',
          'line_user_id',
          'crossmall_account',
          'crossmall_api_key',
          'is_active',
          'created_at'
        ]
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'ユーザーが見つかりません'
        });
      }

      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      console.error('❌ ユーザー設定取得エラー:', error);
      res.status(500).json({
        success: false,
        error: 'ユーザー設定の取得に失敗しました'
      });
    }
  },

  /**
   * ユーザー設定更新
   */
  async updateSettings(req, res) {
    try {
      const { crossmall_account, crossmall_api_key, line_user_id } = req.body;
      const user = await User.findByPk(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'ユーザーが見つかりません'
        });
      }

      // CROSSMALL設定を更新
      if (crossmall_account !== undefined) {
        user.crossmall_account = crossmall_account;
      }
      if (crossmall_api_key !== undefined) {
        user.crossmall_api_key = crossmall_api_key;
      }
      if (line_user_id !== undefined) {
        user.line_user_id = line_user_id;
      }

      await user.save();

      res.json({
        success: true,
        message: '設定を更新しました',
        data: {
          id: user.id,
          username: user.username,
          email: user.email,
          line_user_id: user.line_user_id,
          crossmall_account: user.crossmall_account,
          crossmall_api_key: user.crossmall_api_key,
          is_active: user.is_active
        }
      });
    } catch (error) {
      console.error('❌ ユーザー設定更新エラー:', error);
      res.status(500).json({
        success: false,
        error: '設定の更新に失敗しました'
      });
    }
  }
};

module.exports = userController;
