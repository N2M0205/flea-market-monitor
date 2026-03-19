// client/src/services/api.js
import axios from 'axios';

// Axios インスタンス作成（自社専用モード：JWTなし）
const api = axios.create({
  baseURL: '/api', // ✅ Vite の proxy を使用
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// リクエストインターセプター（デバッグのみ）
api.interceptors.request.use(
  (config) => {
    console.log(`🔍 API Request: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`);
    return config;
  },
  (error) => {
    console.error('❌ Request Error:', error);
    return Promise.reject(error);
  }
);

// レスポンスインターセプター（401で/loginへ飛ばさない）
api.interceptors.response.use(
  (response) => {
    console.log(`✅ API Response: ${response.config.url} ${response.status}`);
    return response;
  },
  (error) => {
    console.error('❌ Response Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
