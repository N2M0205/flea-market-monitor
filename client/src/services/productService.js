/**
 * 商品管理サービス
 *
 * 機能:
 * - 商品一覧取得
 * - 商品詳細取得
 * - 商品フィルタリング
 * - CROSSMALL在庫情報取得
 */

import api from './api';

class ProductService {
  /**
   * 商品一覧取得
   * @param {Object} params - クエリパラメータ
   * @returns {Promise<Array>} 商品一覧
   */
  async getProducts(params = {}) {
    const response = await api.get('/products', { params });
    return response.data.data;
  }

  /**
   * 商品詳細取得
   * @param {string} id - 商品ID
   * @returns {Promise<Object>} 商品詳細
   */
  async getProductById(id) {
    const response = await api.get(`/products/${id}`);
    return response.data.data;
  }

  /**
   * キーワード別商品取得
   * @param {string} keywordId - キーワードID
   * @returns {Promise<Array>} 商品一覧
   */
  async getProductsByKeyword(keywordId) {
    const response = await api.get('/products', { params: { keyword_id: keywordId } });
    return response.data.data;
  }

  /**
   * 未通知商品取得
   * @returns {Promise<Array>} 未通知商品一覧
   */
  async getUnnotifiedProducts() {
    const response = await api.get('/products', { params: { is_notified: false } });
    return response.data.data;
  }

  /**
   * 商品を通知済みにする
   * @param {string} id - 商品ID
   * @returns {Promise<Object>} 更新された商品
   */
  async markAsNotified(id) {
    const response = await api.patch(`/products/${id}/notify`);
    return response.data.data;
  }
}

export default new ProductService();
