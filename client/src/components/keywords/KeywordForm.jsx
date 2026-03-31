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
  Alert,
  Chip,
  Switch,
  Typography
} from '@mui/material';

const platformOptions = [
  { value: 'mercari', label: 'メルカリ' },
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
    is_active: true,
    exclude_keywords: '',
    global_exclude_enabled: true
  });
  const [excludeInput, setExcludeInput] = useState('');
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
        is_active: initialData.is_active !== false,
        exclude_keywords: initialData.exclude_keywords || '',
        global_exclude_enabled: initialData.global_exclude_enabled !== false
      });
    } else {
      setFormData({
        keyword: '',
        min_price: 1000,
        max_price: 10000,
        crossmall_item_code: '',
        platforms: ['mercari', 'yahoo_flea'],
        is_active: true,
        exclude_keywords: '',
        global_exclude_enabled: true
      });
    }
    setExcludeInput('');
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

        {/* 除外キーワード */}
        <Box sx={{ mt: 3 }}>
          <FormLabel component="legend">除外キーワード（個別）</FormLabel>
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <TextField
              size="small"
              placeholder="除外ワードを入力"
              value={excludeInput}
              onChange={(e) => setExcludeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && excludeInput.trim()) {
                  e.preventDefault();
                  const current = formData.exclude_keywords
                    ? formData.exclude_keywords.split(',').map(w => w.trim()).filter(Boolean)
                    : [];
                  if (!current.includes(excludeInput.trim())) {
                    current.push(excludeInput.trim());
                    setFormData({ ...formData, exclude_keywords: current.join(',') });
                  }
                  setExcludeInput('');
                }
              }}
              sx={{ flex: 1 }}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                if (!excludeInput.trim()) return;
                const current = formData.exclude_keywords
                  ? formData.exclude_keywords.split(',').map(w => w.trim()).filter(Boolean)
                  : [];
                if (!current.includes(excludeInput.trim())) {
                  current.push(excludeInput.trim());
                  setFormData({ ...formData, exclude_keywords: current.join(',') });
                }
                setExcludeInput('');
              }}
            >
              追加
            </Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {(formData.exclude_keywords || '').split(',').filter(Boolean).map((word, i) => (
              <Chip
                key={i}
                label={word.trim()}
                size="small"
                onDelete={() => {
                  const current = formData.exclude_keywords.split(',').map(w => w.trim()).filter(Boolean);
                  current.splice(i, 1);
                  setFormData({ ...formData, exclude_keywords: current.join(',') });
                }}
                color="warning"
              />
            ))}
          </Box>
        </Box>

        {/* 全体除外キーワード有効/無効 */}
        <FormControlLabel
          control={
            <Switch
              checked={formData.global_exclude_enabled}
              onChange={(e) => setFormData({ ...formData, global_exclude_enabled: e.target.checked })}
            />
          }
          label="全体除外キーワードを適用"
          sx={{ mt: 2, display: 'block' }}
        />
        <Typography variant="caption" color="text.secondary">
          まとめ、セット、ジャンク、サンプル 等をフィルタします
        </Typography>

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
