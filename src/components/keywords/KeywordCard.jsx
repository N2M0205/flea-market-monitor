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
      paypay_flea: '💰',  // ⭐ PayPayフリマ追加
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
      paypay_flea: 'PayPayフリマ',  // ⭐ PayPayフリマ追加
      rakuma: 'ラクマ',
      yahoo_auction: 'Yahoo!オークション'
    };
    return names[platform] || platform;
  };

  /**
   * プラットフォーム配列を安全に取得
   * 
   * ⭐ 修正: platformとplatformsの両方に対応し、安全にパース
   */
  const getPlatforms = () => {
    // platformsフィールドがある場合
    if (keyword.platforms) {
      // 既に配列の場合
      if (Array.isArray(keyword.platforms)) {
        return keyword.platforms;
      }
      // 文字列の場合
      if (typeof keyword.platforms === 'string') {
        try {
          // JSON文字列をパース (例: '["mercari","yahoo_flea"]')
          const parsed = JSON.parse(keyword.platforms);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          // JSON.parse失敗時は単一の文字列として扱う (例: "paypay_flea")
          return [keyword.platforms];
        }
      }
    }
    
    // platformフィールド(単一値)がある場合
    if (keyword.platform) {
      return [keyword.platform];
    }
    
    // どちらもない場合はデフォルトでメルカリ
    return ['mercari'];
  };

  const platforms = getPlatforms();

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
