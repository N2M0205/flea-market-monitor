/**
 * キーワード管理ページ
 *
 * 機能:
 * - キーワード一覧表示
 * - キーワード登録・編集・削除
 * - CROSSMALL連携管理
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Grid,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import Layout from '../components/layout/Layout';
import KeywordCard from '../components/keywords/KeywordCard';
import KeywordForm from '../components/keywords/KeywordForm';
import keywordService from '../services/keywordService';

export default function Keywords() {
  // 一覧データ（必ず配列）
  const [keywords, setKeywords] = useState([]);

  // 画面状態
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // フォーム関連
  const [formOpen, setFormOpen] = useState(false);
  const [editingKeyword, setEditingKeyword] = useState(null);

  // 削除確認ダイアログ
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingKeywordId, setDeletingKeywordId] = useState(null);

  /**
   * 初期データ読み込み
   */
  useEffect(() => {
    loadKeywords();
  }, []);

  /**
   * キーワード一覧読み込み
   * ※ APIレスポンス { success, data } に対応
   */
  const loadKeywords = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await keywordService.getAll();

      // response.data が配列であることを保証
      setKeywords(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.error('キーワード読み込みエラー:', err);
      setError('キーワードの読み込みに失敗しました');
      setKeywords([]); // 保険
    } finally {
      setLoading(false);
    }
  };

  /**
   * 新規登録ダイアログを開く
   */
  const handleOpenCreateForm = () => {
    setEditingKeyword(null);
    setFormOpen(true);
  };

  /**
   * 編集ダイアログを開く
   */
  const handleOpenEditForm = (keyword) => {
    setEditingKeyword(keyword);
    setFormOpen(true);
  };

  /**
   * フォームを閉じる
   */
  const handleCloseForm = () => {
    setFormOpen(false);
    setEditingKeyword(null);
  };

  /**
   * キーワード登録・更新
   */
  const handleSubmitForm = async (formData) => {
    setError('');
    setSuccessMessage('');

    try {
      if (editingKeyword) {
        // 更新
        await keywordService.updateKeyword(editingKeyword.id, formData);
        setSuccessMessage('キーワードを更新しました');
      } else {
        // 新規登録
        await keywordService.createKeyword(formData);
        setSuccessMessage('キーワードを登録しました');
      }

      handleCloseForm();
      loadKeywords();
    } catch (err) {
      console.error('キーワード登録/更新エラー:', err);
      setError(err.response?.data?.message || 'キーワードの保存に失敗しました');
    }
  };

  /**
   * 削除確認ダイアログを開く
   */
  const handleOpenDeleteDialog = (keywordId) => {
    setDeletingKeywordId(keywordId);
    setDeleteDialogOpen(true);
  };

  /**
   * 削除確認ダイアログを閉じる
   */
  const handleCloseDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingKeywordId(null);
  };

  /**
   * キーワード削除
   */
  const handleDeleteKeyword = async () => {
    setError('');
    setSuccessMessage('');

    try {
      await keywordService.deleteKeyword(deletingKeywordId);
      setSuccessMessage('キーワードを削除しました');
      handleCloseDeleteDialog();
      loadKeywords();
    } catch (err) {
      console.error('キーワード削除エラー:', err);
      setError(err.response?.data?.message || 'キーワードの削除に失敗しました');
      handleCloseDeleteDialog();
    }
  };

  // ローディング表示
  if (loading) {
    return (
      <Layout>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '60vh'
          }}
        >
          <CircularProgress />
        </Box>
      </Layout>
    );
  }

  return (
    <Layout>
      <Box>
        {/* ページタイトル */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 3
          }}
        >
          <Typography variant="h4" component="h1">
            キーワード管理
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateForm}
          >
            キーワード登録
          </Button>
        </Box>

        {/* エラー・成功メッセージ */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {successMessage && (
          <Alert
            severity="success"
            sx={{ mb: 2 }}
            onClose={() => setSuccessMessage('')}
          >
            {successMessage}
          </Alert>
        )}

        {/* キーワード一覧 */}
        {keywords.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              登録されているキーワードはありません
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              「キーワード登録」ボタンから新しいキーワードを追加してください
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenCreateForm}
            >
              キーワード登録
            </Button>
          </Box>
        ) : (
          <Grid container spacing={2}>
            {keywords.map((keyword) => (
              <Grid item xs={12} sm={6} md={4} key={keyword.id}>
                <KeywordCard
                  keyword={keyword}
                  onEdit={handleOpenEditForm}
                  onDelete={handleOpenDeleteDialog}
                />
              </Grid>
            ))}
          </Grid>
        )}

        {/* キーワードフォームダイアログ */}
        <KeywordForm
          open={formOpen}
          onClose={handleCloseForm}
          onSubmit={handleSubmitForm}
          initialData={editingKeyword}
        />

        {/* 削除確認ダイアログ */}
        <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog}>
          <DialogTitle>キーワード削除</DialogTitle>
          <DialogContent>
            <DialogContentText>
              このキーワードを削除してもよろしいですか？
              <br />
              関連する商品データも削除される可能性があります。
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDeleteDialog}>キャンセル</Button>
            <Button
              onClick={handleDeleteKeyword}
              color="error"
              variant="contained"
            >
              削除
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Layout>
  );
}
