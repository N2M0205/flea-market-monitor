/**
 * 統計情報サービス
 * 
 * 機能:
 * - ダッシュボード統計取得
 * - 価格履歴取得
 * - キーワード統計取得
 */

import api from './api';

class StatsService {
  /**
   * ダッシュボード統計取得
   * @returns {Promise<Object>} 統計情報
   */
  async getDashboardStats() {
    const response = await api.get('/api/stats/dashboard');
    return response.data.data;
  }

  /**
   * 価格履歴取得
   * @param {string} productId - 商品ID
   * @returns {Promise<Array>} 価格履歴
   */
  async getPriceHistory(productId) {
    const response = await api.get(`/api/products/${productId}/price-history`);
    return response.data.data;
  }

  /**
   * キーワード統計取得
   * @param {string} keywordId - キーワードID
   * @returns {Promise<Object>} キーワード統計
   */
  async getKeywordStats(keywordId) {
    const response = await api.get(`/api/stats/keywords/${keywordId}`);
    return response.data.data;
  }
}

export default new StatsService();
