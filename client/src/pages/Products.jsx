/**
 * 商品一覧ページ
 *
 * 機能:
 * - 商品一覧表示
 * - キーワード別フィルタ
 * - プラットフォーム別フィルタ
 * - 通知状態フィルタ
 * - 並び替え
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Grid,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Paper,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import {
  FilterList as FilterListIcon,
  Sort as SortIcon
} from '@mui/icons-material';
import Layout from '../components/layout/Layout';
import ProductCard from '../components/products/ProductCard';
import productService from '../services/productService';
import keywordService from '../services/keywordService';

export default function Products() {
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // フィルタ状態
  const [selectedKeyword, setSelectedKeyword] = useState('all');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [notificationFilter, setNotificationFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at_desc');

  /**
   * 初期データ読み込み
   */
  useEffect(() => {
    loadData();
  }, []);

  /**
   * フィルタ・ソート適用
   */
  useEffect(() => {
    applyFiltersAndSort();
  }, [products, selectedKeyword, selectedPlatform, notificationFilter, sortBy]);

  /**
   * データ読み込み
   */
  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      const [productsRes, keywordsRes] = await Promise.all([
        productService.getProducts(),
        keywordService.getAll()
      ]);

      // 🔑 必ず配列に正規化（ここが今回の本丸）
      const productsArray = Array.isArray(productsRes)
        ? productsRes
        : productsRes?.data ?? [];

      const keywordsArray = Array.isArray(keywordsRes)
        ? keywordsRes
        : keywordsRes?.data ?? [];

      setProducts(productsArray);
      setKeywords(keywordsArray);
    } catch (err) {
      console.error('データ読み込みエラー:', err);
      setError('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  /**
   * フィルタ・ソート適用
   */
  const applyFiltersAndSort = () => {
    let filtered = [...products];

    // キーワードフィルタ
    if (selectedKeyword !== 'all') {
      filtered = filtered.filter(p => p.keyword_id === selectedKeyword);
    }

    // プラットフォームフィルタ
    if (selectedPlatform !== 'all') {
      filtered = filtered.filter(p => p.platform === selectedPlatform);
    }

    // 通知状態フィルタ
    if (notificationFilter === 'notified') {
      filtered = filtered.filter(p => p.is_notified);
    } else if (notificationFilter === 'unnotified') {
      filtered = filtered.filter(p => !p.is_notified);
    }

    // ソート
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'created_at_desc':
          return new Date(b.created_at) - new Date(a.created_at);
        case 'created_at_asc':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'price_desc':
          return (b.price || 0) - (a.price || 0);
        case 'price_asc':
          return (a.price || 0) - (b.price || 0);
        default:
          return 0;
      }
    });

    setFilteredProducts(filtered);
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

  if (loading) {
    return (
      <Layout>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <CircularProgress />
        </Box>
      </Layout>
    );
  }

  return (
    <Layout>
      <Box>
        {/* タイトル */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h4" component="h1" gutterBottom>
            商品一覧
          </Typography>
          <Typography variant="body2" color="text.secondary">
            全{filteredProducts.length}件の商品
          </Typography>
        </Box>

        {/* エラー */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {/* フィルタ */}
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <FilterListIcon sx={{ mr: 1 }} />
            <Typography variant="h6">フィルタ・並び替え</Typography>
          </Box>

          <Grid container spacing={2}>
            {/* キーワード */}
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>キーワード</InputLabel>
                <Select
                  value={selectedKeyword}
                  label="キーワード"
                  onChange={(e) => setSelectedKeyword(e.target.value)}
                >
                  <MenuItem value="all">すべて</MenuItem>
                  {keywords.map(k => (
                    <MenuItem key={k.id} value={k.id}>
                      {k.keyword}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* プラットフォーム */}
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>プラットフォーム</InputLabel>
                <Select
                  value={selectedPlatform}
                  label="プラットフォーム"
                  onChange={(e) => setSelectedPlatform(e.target.value)}
                >
                  <MenuItem value="all">すべて</MenuItem>
                  <MenuItem value="mercari">メルカリ</MenuItem>
                  <MenuItem value="yahoo_flea">Yahoo!フリマ</MenuItem>
                  <MenuItem value="rakuma">ラクマ</MenuItem>
                  <MenuItem value="yahoo_auction">Yahoo!オークション</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            {/* 通知状態 */}
            <Grid item xs={12} sm={6} md={3}>
              <ToggleButtonGroup
                value={notificationFilter}
                exclusive
                onChange={(e, v) => v && setNotificationFilter(v)}
                size="small"
                fullWidth
              >
                <ToggleButton value="all">すべて</ToggleButton>
                <ToggleButton value="unnotified">未通知</ToggleButton>
                <ToggleButton value="notified">通知済み</ToggleButton>
              </ToggleButtonGroup>
            </Grid>

            {/* ソート */}
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>並び替え</InputLabel>
                <Select
                  value={sortBy}
                  label="並び替え"
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <MenuItem value="created_at_desc">取得日時（新しい順）</MenuItem>
                  <MenuItem value="created_at_asc">取得日時（古い順）</MenuItem>
                  <MenuItem value="price_desc">価格（高い順）</MenuItem>
                  <MenuItem value="price_asc">価格（安い順）</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Paper>

        {/* 一覧 */}
        {filteredProducts.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary">
              商品が見つかりませんでした
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={2}>
            {filteredProducts.map(product => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={product.id}>
                <ProductCard product={product} />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Layout>
  );
}
