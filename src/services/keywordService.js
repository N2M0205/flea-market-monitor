// client/src/services/keywordService.js
import api from './api';

/**
 * キーワード関連APIをまとめたサービス
 *
 * 重要:
 * - このファイルに存在する「一覧取得」は getAll() です
 * - Dashboard.jsx など呼び出し側は keywordService.getAll() を使ってください
 */
const keywordService = {
  /**
   * キーワード一覧取得
   * GET /keywords
   */
  async getAll() {
    try {
      console.log('🔍 キーワード一覧取得開始');
      const response = await api.get('/keywords');
      console.log('✅ キーワード一覧取得成功:', response.data);
      return response.data;
    } catch (error) {
      console.error(
        '❌ キーワード一覧取得エラー:',
        error.response?.data || error.message
      );
      throw error;
    }
  },

  /**
   * キーワード作成
   * POST /keywords
   * @param {Object} keywordData
   */
  async createKeyword(keywordData) {
    try {
      console.log('🔍 キーワード作成開始:', keywordData);
      const response = await api.post('/keywords', keywordData);
      console.log('✅ キーワード作成成功:', response.data);
      return response.data;
    } catch (error) {
      console.error(
        '❌ キーワード作成エラー:',
        error.response?.data || error.message
      );
      throw error;
    }
  },

  /**
   * キーワード更新
   * PUT /keywords/:id
   * @param {string|number} id
   * @param {Object} keywordData
   */
  async updateKeyword(id, keywordData) {
    try {
      console.log('🔍 キーワード更新開始:', id, keywordData);
      const response = await api.put(`/keywords/${id}`, keywordData);
      console.log('✅ キーワード更新成功:', response.data);
      return response.data;
    } catch (error) {
      console.error(
        '❌ キーワード更新エラー:',
        error.response?.data || error.message
      );
      throw error;
    }
  },

  /**
   * キーワード削除
   * DELETE /keywords/:id
   * @param {string|number} id
   */
  async deleteKeyword(id) {
    try {
      console.log('🔍 キーワード削除開始:', id);
      const response = await api.delete(`/keywords/${id}`);
      console.log('✅ キーワード削除成功');
      return response.data;
    } catch (error) {
      console.error(
        '❌ キーワード削除エラー:',
        error.response?.data || error.message
      );
      throw error;
    }
  },

  /**
   * キーワードの有効/無効切り替え
   * PATCH /keywords/:id/toggle
   * @param {string|number} id
   * @param {boolean} is_active
   */
  async toggleActive(id, is_active) {
    try {
      console.log('🔍 キーワード状態切替:', id, is_active);
      const response = await api.patch(`/keywords/${id}/toggle`, { is_active });
      console.log('✅ キーワード状態切替成功');
      return response.data;
    } catch (error) {
      console.error(
        '❌ キーワード状態切替エラー:',
        error.response?.data || error.message
      );
      throw error;
    }
  },
};

export default keywordService;
