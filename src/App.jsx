/**
 * メインアプリケーションコンポーネント（自社専用モード）
 *
 * 変更点:
 * - AuthProvider / PrivateRoute を撤去
 * - /login, /register を撤去（あっても使わない）
 * - 全ページを直接表示できるようにする
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';

// ページコンポーネント
import Dashboard from './pages/Dashboard';
import Keywords from './pages/Keywords';
import Products from './pages/Products';
import Settings from './pages/Settings';

const theme = createTheme({
  palette: {
    primary: { main: '#1976d2' },
    secondary: { main: '#dc004e' },
    background: { default: '#f5f5f5' },
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/keywords" element={<Keywords />} />
          <Route path="/products" element={<Products />} />
          <Route path="/settings" element={<Settings />} />

          {/* デフォルト */}
          <Route path="/" element={<Navigate to="/dashboard" />} />
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
