/**
 * 商品カードコンポーネント
 * 
 * 機能:
 * - 商品情報表示
 * - CROSSMALL在庫情報表示
 * - 商品詳細リンク
 */

import React from 'react';
import {
  Card,
  CardContent,
  CardMedia,
  Typography,
  Box,
  Chip,
  Button,
  Divider
} from '@mui/material';
import {
  OpenInNew as OpenInNewIcon,
  Inventory as InventoryIcon,
  AttachMoney as AttachMoneyIcon
} from '@mui/icons-material';

export default function ProductCard({ product }) {
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

  /**
   * プラットフォームカラー取得
   */
  const getPlatformColor = (platform) => {
    const colors = {
      mercari: 'error',
      yahoo_flea: 'warning',
      rakuma: 'success',
      yahoo_auction: 'info'
    };
    return colors[platform] || 'default';
  };

  /**
   * 日時フォーマット
   */
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Card>
      {/* 商品画像 */}
      {product.image_url && (
        <CardMedia
          component="img"
          height="200"
          image={product.image_url}
          alt={product.title}
          sx={{ objectFit: 'cover' }}
        />
      )}

      <CardContent>
        {/* タイトル */}
        <Typography variant="h6" gutterBottom sx={{ 
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          minHeight: '3em'
        }}>
          {product.title}
        </Typography>

        {/* プラットフォーム・通知状態 */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Chip
            label={getPlatformName(product.platform)}
            size="small"
            color={getPlatformColor(product.platform)}
          />
          {!product.is_notified && (
            <Chip label="未通知" size="small" color="warning" />
          )}
        </Box>

        {/* 価格 */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <AttachMoneyIcon sx={{ color: 'success.main', mr: 0.5 }} />
          <Typography variant="h5" component="span" color="success.main" sx={{ fontWeight: 'bold' }}>
            ¥{product.price?.toLocaleString()}
          </Typography>
        </Box>

        {/* CROSSMALL情報（存在する場合） */}
        {product.crossmall_stock !== undefined && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ bgcolor: 'background.default', p: 1.5, borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                CROSSMALL在庫情報
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <InventoryIcon fontSize="small" color="primary" />
                <Typography variant="body2">
                  在庫: <strong>{product.crossmall_stock}個</strong>
                </Typography>
              </Box>
              {product.crossmall_price && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  最終販売価格: <strong>¥{product.crossmall_price?.toLocaleString()}</strong>
                </Typography>
              )}
            </Box>
          </>
        )}

        {/* 出品日時 */}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2, mb: 1 }}>
          出品日時: {formatDate(product.listed_at || product.created_at)}
        </Typography>

        {/* 取得日時 */}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
          取得日時: {formatDate(product.created_at)}
        </Typography>

        {/* 商品リンク */}
        <Button
          fullWidth
          variant="outlined"
          endIcon={<OpenInNewIcon />}
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          商品ページを開く
        </Button>
      </CardContent>
    </Card>
  );
}
