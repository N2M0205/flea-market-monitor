/**
 * レイアウトコンポーネント（改善版）
 * 
 * 機能:
 * - ヘッダー・サイドバー・メインコンテンツの統合
 * - レスポンシブ対応
 * - サイドバー幅最適化
 */

import React, { useState } from 'react';
import { Box, Toolbar } from '@mui/material';
import Header from './Header';
import Sidebar from './Sidebar';

const drawerWidth = 260; // 240 → 260 に変更

export default function Layout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  /**
   * モバイルメニュー開閉トグル
   */
  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* ヘッダー */}
      <Header onMenuClick={handleDrawerToggle} />

      {/* サイドバー */}
      <Sidebar mobileOpen={mobileOpen} onClose={handleDrawerToggle} />

      {/* メインコンテンツ */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3 },
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          minHeight: '100vh',
          bgcolor: 'background.default',
          ml: { sm: `${drawerWidth}px` }
        }}
      >
        <Toolbar /> {/* ヘッダーと同じ高さのスペーサー */}
        {children}
      </Box>
    </Box>
  );
}
