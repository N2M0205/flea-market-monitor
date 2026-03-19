/**
 * ヘッダーコンポーネント（自社専用モード）
 * 
 * 機能:
 * - アプリケーションタイトル
 * - モバイルメニュー切り替え
 * 
 * 変更点:
 * - useAuth / logout を削除（自社専用では不要）
 */

import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box
} from '@mui/material';
import {
  Menu as MenuIcon
} from '@mui/icons-material';

export default function Header({ onMenuClick }) {
  return (
    <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
      <Toolbar>
        {/* メニューボタン（モバイル用） */}
        <IconButton
          color="inherit"
          edge="start"
          onClick={onMenuClick}
          sx={{ mr: 2, display: { sm: 'none' } }}
        >
          <MenuIcon />
        </IconButton>

        {/* アプリタイトル */}
        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          🔍 フリマウォッチ（自社専用）
        </Typography>

        {/* ユーザー情報表示（固定） */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
            自社管理者
          </Typography>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
