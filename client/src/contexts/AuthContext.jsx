/**
 * 認証コンテキスト
 * 
 * 機能:
 * - 認証状態管理
 * - ログイン/ログアウト
 * - トークン管理
 */

import React, { createContext, useState, useContext, useEffect } from 'react';
import authService from '../services/authService';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 初期化時にログイン状態を復元
    const initAuth = async () => {
      const currentUser = authService.getCurrentUser();
      if (currentUser) {
        setUser(currentUser);
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  /**
   * ログイン処理
   */
  const login = async (username, password) => {
    try {
      const response = await authService.login(username, password);
      setUser(response.user);
      return response;
    } catch (error) {
      console.error('ログインエラー:', error);
      throw error;
    }
  };

  /**
   * ログアウト処理
   */
  const logout = () => {
    authService.logout();
    setUser(null);
  };

  /**
   * ユーザー登録処理
   */
  const register = async (username, email, password) => {
    try {
      const response = await authService.register(username, email, password);
      setUser(response.user);
      return response;
    } catch (error) {
      console.error('登録エラー:', error);
      throw error;
    }
  };

  const value = {
    user,
    loading,
    login,
    logout,
    register,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

/**
 * 認証コンテキストを取得するカスタムフック
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
