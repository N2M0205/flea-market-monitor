/**
 * 認証サービス
 * 
 * 機能:
 * - ログイン（email使用）
 * - ログアウト
 * - 新規登録
 * - トークン管理
 */

import api from './api';

class AuthService {
  /**
   * ログイン（email使用）
   */
  async login(username, password) {
    try {
      console.log('🔍 API呼び出し: POST /auth/login');
      const response = await api.post('/auth/login', {
        email: username, // バックエンドは email を要求
        password
      });
      
      console.log('✅ ログインレスポンス:', response.data);
      
      // バックエンドのレスポンス形式: { success, data: { user, token } }
      if (response.data.success && response.data.data) {
        const { user, token } = response.data.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        return { user, token };
      }
      
      throw new Error('Invalid response format');
    } catch (error) {
      console.error('❌ ログインAPI エラー:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 新規登録
   */
  async register(username, email, password) {
    try {
      console.log('🔍 API呼び出し: POST /auth/register');
      console.log('📦 送信データ:', { username, email, password: '***' });
      
      const response = await api.post('/auth/register', {
        username,
        email,
        password
      });
      
      console.log('✅ 登録レスポンス:', response.data);
      
      // バックエンドのレスポンス形式: { success, data: { user, token } }
      if (response.data.success && response.data.data) {
        const { user, token } = response.data.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        return { user, token };
      }
      
      throw new Error('Invalid response format');
    } catch (error) {
      console.error('❌ 登録API エラー:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * ログアウト
   */
  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  /**
   * 現在のユーザー取得
   */
  getCurrentUser() {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /**
   * トークン取得
   */
  getToken() {
    return localStorage.getItem('token');
  }
}

export default new AuthService();
