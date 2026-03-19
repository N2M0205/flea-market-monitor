/**
 * ダッシュボードページ（改善版）
 * 
 * 機能:
 * - 統計情報表示
 * - 最近の商品一覧
 * - スクレイピング実行ボタン
 * - レスポンシブ対応
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Paper,
  Chip,
  Stack,
  Divider,
  Container
} from '@mui/material';
import {
  Search as SearchIcon,
  Inventory as InventoryIcon,
  Notifications as NotificationsIcon,
  PlayArrow as PlayArrowIcon,
  Refresh as RefreshIcon,
  TrendingUp as TrendingUpIcon
} from '@mui/icons-material';
import Layout from '../components/layout/Layout';
import productService from '../services/productService';
import keywordService from '../services/keywordService';
import scrapingService from '../services/scrapingService';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalKeywords: 0,
    totalProducts: 0,
    unnotifiedProducts: 0
  });
  const [recentProducts, setRecentProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  /**
   * 初期データ読み込み
   */
  useEffect(() => {
    loadDashboardData();
  }, []);

  /**
   * ダッシュボードデータ読み込み
   */
  const loadDashboardData = async () => {
    setLoading(true);
    setError('');
    
    try {
      // 並列でデータ取得
      const [keywords, products, unnotified] = await Promise.all([
        keywordService.getAll(),
        productService.getProducts(),
        productService.getUnnotifiedProducts()
      ]);

      setStats({
        totalKeywords: keywords.length,
        totalProducts: products.length,
        unnotifiedProducts: unnotified.length
      });

      // 最新5件の商品を取得
      setRecentProducts(products.slice(0, 5));
    } catch (err) {
      console.error('ダッシュボードデータ読み込みエラー:', err);
      setError('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  /**
   * スクレイピング実行
   */
  const handleStartScraping = async () => {
    setScraping(true);
    setError('');
    setSuccessMessage('');

    try {
      await scrapingService.startScraping();
      setSuccessMessage('スクレイピングを開始しました！');
      
      // 3秒後にデータ再読み込み
      setTimeout(() => {
        loadDashboardData();
        setSuccessMessage('');
      }, 3000);
    } catch (err) {
      console.error('スクレイピングエラー:', err);
      setError(err.response?.data?.message || 'スクレイピングの開始に失敗しました');
    } finally {
      setScraping(false);
    }
  };

  /**
   * 統計カードコンポーネント（改善版）
   */
  const StatCard = ({ title, value, icon, color, trend }) => (
    <Card
      sx={{
        height: '100%',
        background: `linear-gradient(135deg, ${color}15 0%, ${color}05 100%)`,
        border: `1px solid ${color}30`,
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 4
        }
      }}
    >
      <CardContent>
        <Stack spacing={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
              {title}
            </Typography>
            <Box
              sx={{
                bgcolor: `${color}20`,
                color: color,
                p: 1,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {icon}
            </Box>
          </Box>
          <Typography variant="h3" component="div" fontWeight="bold" color={color}>
            {value}
          </Typography>
          {trend && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TrendingUpIcon fontSize="small" color="success" />
              <Typography variant="caption" color="success.main">
                {trend}
              </Typography>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <Layout>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <CircularProgress size={60} />
        </Box>
      </Layout>
    );
  }

  return (
    <Layout>
      <Container maxWidth="xl">
        {/* ページヘッダー */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
            ダッシュボード
          </Typography>
          <Typography variant="body2" color="text.secondary">
            フリマアプリ商品監視の概要
          </Typography>
        </Box>

        {/* アクションボタン */}
        <Stack direction="row" spacing={2} sx={{ mb: 4 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadDashboardData}
            disabled={scraping}
          >
            更新
          </Button>
          <Button
            variant="contained"
            size="large"
            startIcon={scraping ? <CircularProgress size={20} color="inherit" /> : <PlayArrowIcon />}
            onClick={handleStartScraping}
            disabled={scraping}
            sx={{
              px: 4,
              background: 'linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)',
              boxShadow: '0 3px 5px 2px rgba(33, 203, 243, .3)',
            }}
          >
            {scraping ? 'スクレイピング中...' : 'スクレイピング実行'}
          </Button>
        </Stack>

        {/* エラー・成功メッセージ */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {successMessage && (
          <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMessage('')}>
            {successMessage}
          </Alert>
        )}

        {/* 統計カード */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={4}>
            <StatCard
              title="登録キーワード"
              value={stats.totalKeywords}
              icon={<SearchIcon />}
              color="#2196F3"
              trend="+2 今月"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <StatCard
              title="取得商品数"
              value={stats.totalProducts}
              icon={<InventoryIcon />}
              color="#4CAF50"
              trend="+15 今日"
            />
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <StatCard
              title="未通知商品"
              value={stats.unnotifiedProducts}
              icon={<NotificationsIcon />}
              color="#FF9800"
            />
          </Grid>
        </Grid>

        {/* 最近の商品 */}
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom fontWeight="bold">
            最近取得した商品
          </Typography>
          <Divider sx={{ my: 2 }} />
          
          {recentProducts.length === 0 ? (
            <Box sx={{ py: 8, textAlign: 'center' }}>
              <InventoryIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
              <Typography color="text.secondary">
                まだ商品がありません。スクレイピングを実行してください。
              </Typography>
            </Box>
          ) : (
            <Stack spacing={2}>
              {recentProducts.map((product) => (
                <Card key={product.id} variant="outlined" sx={{ 
                  transition: 'all 0.2s',
                  '&:hover': {
                    boxShadow: 2,
                    borderColor: 'primary.main'
                  }
                }}>
                  <CardContent>
                    <Grid container spacing={2} alignItems="center">
                      <Grid item xs={12} md={8}>
                        <Typography variant="h6" gutterBottom sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 1,
                          WebkitBoxOrient: 'vertical'
                        }}>
                          {product.title}
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                          <Chip label={product.platform} size="small" color="primary" />
                          <Chip label={`¥${product.price?.toLocaleString()}`} size="small" color="success" />
                          {!product.is_notified && (
                            <Chip label="未通知" size="small" color="warning" />
                          )}
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(product.created_at).toLocaleString('ja-JP')}
                        </Typography>
                      </Grid>
                      <Grid item xs={12} md={4} sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                        <Button
                          variant="outlined"
                          size="small"
                          href={product.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          商品を見る
                        </Button>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Paper>
      </Container>
    </Layout>
  );
}
