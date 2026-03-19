/**
 * スクレイピング実行サービス
 * 
 * 機能:
 * - スクレイピング開始
 * - スクレイピング状態取得
 */

import api from './api';

class ScrapingService {
  /**
   * スクレイピング開始
   * @returns {Promise<Object>} 実行結果
   */
  async startScraping() {
    const response = await api.post('/scraping/start');
    return response.data;
  }

  /**
   * スクレイピング状態取得
   * @returns {Promise<Object>} 状態情報
   */
  async getStatus() {
    const response = await api.get('/scraping/status');
    return response.data;
  }
}

export default new ScrapingService();
