// client/src/pages/Settings.jsx
import { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Alert,
  Divider,
  Grid,
  Chip,
  Link as MuiLink
} from '@mui/material';
import {
  Save as SaveIcon,
  Link as LinkIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  Block as BlockIcon
} from '@mui/icons-material';

import Layout from '../components/layout/Layout';
import api from '../services/api';

export default function Settings() {
  const [settings, setSettings] = useState({
    username: '',
    email: '',
    line_user_id: '',
    crossmall_account: '',
    crossmall_api_key: '',
    is_active: true
  });

  const [linkCode, setLinkCode] = useState('');
  const [devLinkCode, setDevLinkCode] = useState('');
  const [globalExcludes, setGlobalExcludes] = useState([]);
  const [excludeInput, setExcludeInput] = useState('');

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSettings();
    loadGlobalExcludes();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await api.get('/users/settings');
      if (res.data.success) {
        setSettings(res.data.data);
      }
    } catch (e) {
      console.error('設定取得エラー', e);
    }
  };

  const loadGlobalExcludes = async () => {
    try {
      const res = await api.get('/settings/global-excludes');
      if (res.data.success) setGlobalExcludes(res.data.data);
    } catch (e) {
      console.error('全体除外キーワード取得エラー', e);
    }
  };

  const saveGlobalExcludes = async (newList) => {
    try {
      setGlobalExcludes(newList);
      await api.post('/settings/global-excludes', newList);
    } catch (e) {
      setError('全体除外キーワードの保存に失敗しました');
      loadGlobalExcludes();
    }
  };

  const handleAddExclude = () => {
    const word = excludeInput.trim();
    if (!word || globalExcludes.includes(word)) return;
    saveGlobalExcludes([...globalExcludes, word]);
    setExcludeInput('');
  };

  const handleRemoveExclude = (index) => {
    const newList = globalExcludes.filter((_, i) => i !== index);
    saveGlobalExcludes(newList);
  };

  const handleSaveCrossmall = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      const res = await api.put('/users/settings', {
        crossmall_account: settings.crossmall_account,
        crossmall_api_key: settings.crossmall_api_key
      });

      if (res.data.success) {
        setSuccess('CROSSMALL設定を保存しました');
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (e) {
      setError(e.response?.data?.error || 'CROSSMALL設定の保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 開発用：Webhook無しで6桁コード発行
  const handleGenerateDevCode = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      const res = await api.post('/line/dev/generate-code');

      if (res.data?.success) {
        const code = res.data.data.link_code;
        setDevLinkCode(code);
        setLinkCode(code);
        setSuccess('（開発用）6桁コードを発行しました');
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (e) {
      setError(e.response?.data?.error || '開発用コード発行に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleLinkLine = async () => {
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      if (linkCode.length !== 6) {
        setError('6桁の連携コードを入力してください');
        return;
      }

      const res = await api.post('/line/link', { link_code: linkCode });

      if (res.data.success) {
        setSuccess('LINE連携が完了しました');
        setLinkCode('');
        setDevLinkCode('');
        loadSettings();
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (e) {
      setError(e.response?.data?.error || 'LINE連携に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Typography variant="h4" gutterBottom fontWeight="bold">
          ⚙️ 設定
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        {/* アカウント情報 */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6">👤 アカウント情報</Typography>
          <Divider sx={{ my: 2 }} />

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="ユーザー名" value={settings.username} disabled />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="メールアドレス" value={settings.email} disabled />
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip
                  label={settings.is_active ? 'アクティブ' : '無効'}
                  color={settings.is_active ? 'success' : 'error'}
                  size="small"
                />
                <Chip
                  label={settings.line_user_id ? 'LINE連携済み' : 'LINE未連携'}
                  color={settings.line_user_id ? 'primary' : 'default'}
                  size="small"
                  icon={settings.line_user_id ? <CheckCircleIcon /> : undefined}
                />
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* CROSSMALL */}
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6">🏪 CROSSMALL連携設定</Typography>
          <Divider sx={{ my: 2 }} />

          <Alert severity="info" icon={<InfoIcon />} sx={{ mb: 2 }}>
            CROSSMALLと連携すると在庫情報を自動取得できます
          </Alert>

          <TextField
            fullWidth
            label="CROSSMALLアカウント番号"
            sx={{ mb: 2 }}
            value={settings.crossmall_account}
            onChange={(e) =>
              setSettings({ ...settings, crossmall_account: e.target.value })
            }
          />
          <TextField
            fullWidth
            label="CROSSMALL APIキー"
            type="password"
            sx={{ mb: 2 }}
            value={settings.crossmall_api_key}
            onChange={(e) =>
              setSettings({ ...settings, crossmall_api_key: e.target.value })
            }
          />

          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleSaveCrossmall}
            disabled={loading}
          >
            CROSSMALL設定を保存
          </Button>
        </Paper>

        {/* LINE連携 */}
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">💬 LINE通知設定</Typography>
          <Divider sx={{ my: 2 }} />

          {settings.line_user_id ? (
            <Alert severity="success" icon={<CheckCircleIcon />}>
              LINE連携済みです。通知がLINEに届きます。
            </Alert>
          ) : (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                <ol>
                  <li>
                    LINE公式アカウントを友だち追加<br />
                    <MuiLink
                      href="https://line.me/R/ti/p/@681vtmeh"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      → LINE公式アカウントはこちら
                    </MuiLink>
                  </li>
                  <li>届いた6桁コードを入力</li>
                  <li>「連携する」をクリック</li>
                </ol>
              </Alert>

              <Alert severity="warning" sx={{ mb: 2 }}>
                <strong>（開発用）ローカル検証</strong><br />
                Webhook無しで試す場合は下のボタンを押してください。
                <Box sx={{ mt: 1 }}>
                  <Button
                    variant="outlined"
                    onClick={handleGenerateDevCode}
                    disabled={loading}
                  >
                    （開発用）6桁コードを発行
                  </Button>
                </Box>
                {devLinkCode && (
                  <Box sx={{ mt: 1 }}>
                    発行コード：<strong>{devLinkCode}</strong>
                  </Box>
                )}
              </Alert>

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="6桁の連携コード"
                    value={linkCode}
                    onChange={(e) =>
                      setLinkCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Button
                    fullWidth
                    variant="contained"
                    color="success"
                    startIcon={<LinkIcon />}
                    onClick={handleLinkLine}
                    disabled={loading || linkCode.length !== 6}
                    sx={{ height: '56px' }}
                  >
                    連携する
                  </Button>
                </Grid>
              </Grid>
            </>
          )}
        </Paper>
        {/* 全体除外キーワード */}
        <Paper sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6">🚫 全体除外キーワード</Typography>
          <Divider sx={{ my: 2 }} />

          <Alert severity="info" sx={{ mb: 2 }}>
            ここに設定したワードがタイトルに含まれる商品は、全キーワードで自動除外されます
          </Alert>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
            {globalExcludes.map((word, i) => (
              <Chip
                key={i}
                label={word}
                onDelete={() => handleRemoveExclude(i)}
                color="warning"
              />
            ))}
            {globalExcludes.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                除外キーワードが設定されていません
              </Typography>
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              placeholder="除外ワードを入力"
              value={excludeInput}
              onChange={(e) => setExcludeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddExclude();
                }
              }}
              sx={{ flex: 1 }}
            />
            <Button
              variant="outlined"
              startIcon={<BlockIcon />}
              onClick={handleAddExclude}
              disabled={!excludeInput.trim()}
            >
              追加
            </Button>
          </Box>
        </Paper>
      </Container>
    </Layout>
  );
}
