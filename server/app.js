// server/app.js  ← 既存ファイルに以下3行を追加するだけ
//
// 追加行に ★ マークを付けています
// 既存コードは一切変更不要
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const morgan   = require('morgan');

// 既存ルート
const authRouter     = require('./routes/auth');
const keywordsRouter = require('./routes/keywords');
const productsRouter = require('./routes/products');
const scrapingRouter = require('./routes/scraping');
const usersRouter    = require('./routes/users');
const lineRouter     = require('./routes/line');

// ★ 追加1: sync ルートをインポート
const syncRouter = require('./routes/sync');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// 既存ルート登録
app.use('/api/auth',     authRouter);
app.use('/api/keywords', keywordsRouter);
app.use('/api/products', productsRouter);
app.use('/api/scraping', scrapingRouter);
app.use('/api/users',    usersRouter);
app.use('/api/line',     lineRouter);

// ★ 追加2: sync ルート登録
app.use('/api/sync', syncRouter);

// 設定ルート登録
const settingsRouter = require('./routes/settings');
app.use('/api/settings', settingsRouter);

// ★ 追加3: 起動時に Layer A 設定をDBへシード（Settings テーブルが存在する前提）
const { seedLayerASettings } = require('./services/LayerAFilterService');
seedLayerASettings().catch(err => console.warn('seedLayerASettings:', err.message));

// ヘルスチェック
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

module.exports = app;
