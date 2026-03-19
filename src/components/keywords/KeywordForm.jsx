/**
 * キーワードフォームコンポーネント
 * 
 * 機能:
 * - キーワード登録・編集
 * - CROSSMALL商品コード設定
 * - プラットフォーム選択
 * - 価格範囲設定
 */

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  FormControlLabel,
  Checkbox,
  FormGroup,
  FormLabel,
  Grid,
  Alert
} from '@mui/material';

const platformOptions = [
  { value: 'mercari', label: 'メルカリ' },
  { value: 'paypay_flea', label: 'PayPayフリマ' },
  { value: 'yahoo_flea', label: 'Yahoo!フリマ' },
  { value: 'rakuma', label: 'ラクマ' },
  { value: 'yahoo_auction', label: 'Yahoo!オークション' }
];

export default function KeywordForm({ open, onClose, onSubmit, initialData }) {
  const [formData, setFormData] = useState({
    keyword: '',
    min_price: 1000,
    max_price: 10000,
    crossmall_item_code: '',
    platforms: ['mercari', 'yahoo_flea'],
    is_active: true
  });
  const [error, setError] = useState('');

  /**
   * 初期データ設定
   */
  useEffect(() => {
    if (initialData) {
      setFormData({
        keyword: initialData.keyword || '',
        min_price: initialData.min_price || 1000,
        max_price: initialData.max_price || 10000,
        crossmall_item_code: initialData.crossmall_item_code || '',
        platforms: typeof initialData.platforms === 'string'
          ? JSON.parse(initialData.platforms)
          : initialData.platforms || ['mercari', 'yahoo_flea'],
        is_active: initialData.is_active !== false
      });
    } else {
      // 新規作成時はデフォルト値
      setFormData({
        keyword: '',
        min_price: 1000,
        max_price: 10000,
        crossmall_item_code: '',
        platforms: ['mercari', 'yahoo_flea'],
        is_active: true
      });
    }
    setError('');
  }, [initialData, open]);

  /**
   * フォーム入力変更ハンドラ
   */
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
    setError('');
  };

  /**
   * プラットフォーム選択変更ハンドラ
   */
  const handlePlatformChange = (platform) => {
    const newPlatforms = formData.platforms.includes(platform)
      ? formData.platforms.filter((p) => p !== platform)
      : [...formData.platforms, platform];
    
    setFormData({
      ...formData,
      platforms: newPlatforms
    });
  };

  /**
   * フォーム送信
   */
  const handleSubmit = () => {
    // バリデーション
    if (!formData.keyword.trim()) {
      setError('キーワードを入力してください');
      return;
    }
    if (formData.platforms.length === 0) {
      setError('少なくとも1つのプラットフォームを選択してください');
      return;
    }
    if (formData.min_price >= formData.max_price) {
      setError('最小価格は最大価格より小さくしてください');
      return;
    }

    onSubmit(formData);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {initialData ? 'キーワード編集' : 'キーワード登録'}
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* キーワード */}
        <TextField
          fullWidth
          label="キーワード"
          name="keyword"
          value={formData.keyword}
          onChange={handleChange}
          margin="normal"
          required
          autoFocus
        />

        {/* CROSSMALL商品コード */}
        <TextField
          fullWidth
          label="CROSSMALL商品コード（オプション）"
          name="crossmall_item_code"
          value={formData.crossmall_item_code}
          onChange={handleChange}
          margin="normal"
          placeholder="例: 2314-000521"
          helperText="CROSSMALL連携する場合は商品コードを入力してください"
        />

        {/* 価格範囲 */}
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={6}>
            <TextField
              fullWidth
              label="最小価格"
              name="min_price"
              type="number"
              value={formData.min_price}
              onChange={handleChange}
              InputProps={{ inputProps: { min: 0 } }}
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              fullWidth
              label="最大価格"
              name="max_price"
              type="number"
              value={formData.max_price}
              onChange={handleChange}
              InputProps={{ inputProps: { min: 0 } }}
            />
          </Grid>
        </Grid>

        {/* プラットフォーム選択 */}
        <Box sx={{ mt: 3 }}>
          <FormLabel component="legend">対象プラットフォーム</FormLabel>
          <FormGroup>
            {platformOptions.map((option) => (
              <FormControlLabel
                key={option.value}
                control={
                  <Checkbox
                    checked={formData.platforms.includes(option.value)}
                    onChange={() => handlePlatformChange(option.value)}
                  />
                }
                label={option.label}
              />
            ))}
          </FormGroup>
        </Box>

        {/* 有効/無効 */}
        <FormControlLabel
          control={
            <Checkbox
              name="is_active"
              checked={formData.is_active}
              onChange={handleChange}
            />
          }
          label="有効にする"
          sx={{ mt: 2 }}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button onClick={handleSubmit} variant="contained">
          {initialData ? '更新' : '登録'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
