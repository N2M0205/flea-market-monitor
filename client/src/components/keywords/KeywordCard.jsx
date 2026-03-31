/**
 * キーワードカードコンポーネント
 * 
 * 機能:
 * - キーワード情報表示
 * - CROSSMALL商品コード表示
 * - 編集・削除ボタン
 */

import React from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon
} from '@mui/icons-material';

export default function KeywordCard({ keyword, onEdit, onDelete }) {
  /**
   * プラットフォームアイコン取得
   */
  const getPlatformIcon = (platform) => {
    const icons = {
      mercari: '🛒',
      yahoo_flea: '🏪',
      rakuma: '📦',
      yahoo_auction: '🔨'
    };
    return icons[platform] || '🔍';
  };

  /**
   * プラットフォーム名取得
   */
  const getPlatformName = (platform) => {
    const names = {
      mercari: 'メルカリ',
      yahoo_flea: 'Yahoo!フリマ',
      rakuma: 'ラクマ',
      yahoo_auction: 'Yahoo!オークション'
    };
    return names[platform] || platform;
  };

  // platforms を JSON からパース
  const platforms = typeof keyword.platforms === 'string' 
    ? JSON.parse(keyword.platforms) 
    : keyword.platforms || [];

  return (
    <Card>
      <CardContent>
        {/* キーワード名 */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" gutterBottom>
              {keyword.keyword}
            </Typography>
            
            {/* CROSSMALL商品コード */}
            {keyword.crossmall_item_code && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Chip
                  label={`CROSSMALL: ${keyword.crossmall_item_code}`}
                  size="small"
                  color="secondary"
                  icon={<CheckCircleIcon />}
                />
              </Box>
            )}
          </Box>

          {/* アクションボタン */}
          <Box>
            <Tooltip title="編集">
              <IconButton size="small" onClick={() => onEdit(keyword)}>
                <EditIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="削除">
              <IconButton size="small" color="error" onClick={() => onDelete(keyword.id)}>
                <DeleteIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* 価格範囲 */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            価格範囲: ¥{keyword.min_price?.toLocaleString()} 〜 ¥{keyword.max_price?.toLocaleString()}
          </Typography>
        </Box>

        {/* プラットフォーム */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {platforms.map((platform) => (
            <Chip
              key={platform}
              label={`${getPlatformIcon(platform)} ${getPlatformName(platform)}`}
              size="small"
              variant="outlined"
            />
          ))}
        </Box>

        {/* 除外キーワード */}
        {(keyword.exclude_keywords || keyword.global_exclude_enabled !== false) && (
          <Box sx={{ mb: 2 }}>
            {keyword.global_exclude_enabled !== false && (
              <Chip label="全体除外ON" size="small" color="info" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />
            )}
            {keyword.exclude_keywords && keyword.exclude_keywords.split(',').filter(Boolean).map((word, i) => (
              <Chip key={i} label={word.trim()} size="small" color="warning" sx={{ mr: 0.5, mb: 0.5 }} />
            ))}
          </Box>
        )}

        {/* ステータス */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {keyword.is_active ? (
            <Chip label="有効" size="small" color="success" icon={<CheckCircleIcon />} />
          ) : (
            <Chip label="無効" size="small" icon={<CancelIcon />} />
          )}
          <Typography variant="caption" color="text.secondary">
            検出回数: {keyword.detection_count || 0}回
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
