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

// ヘルスチェック（簡易）
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ヘルスチェック（外部監視用）
const { sequelize, Product } = require('./models');
app.get('/api/health', async (_req, res) => {
  try {
    const dbOk = await sequelize.authenticate().then(() => true).catch(() => false);

    const latestProduct = await Product.findOne({ order: [['created_at', 'DESC']] });
    const lastScanAge = latestProduct
      ? Math.floor((Date.now() - new Date(latestProduct.createdAt)) / 60000)
      : null;

    const healthy = dbOk && (lastScanAge === null || lastScanAge < 60);

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'unhealthy',
      db: dbOk ? 'connected' : 'disconnected',
      lastScanMinutesAgo: lastScanAge,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// キャッシュホットリロード（localhost限定）
const purchaseMasterCache = require('./services/PurchaseMasterCache');
app.post('/api/cache/reload', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    console.log(`[CACHE-RELOAD] 拒否: リクエスト元 ${ip}`);
    return res.status(403).json({ error: 'Forbidden: localhost only' });
  }

  const result = purchaseMasterCache.reloadFromDisk();
  res.json({
    success: result.success,
    itemCount: result.itemCount,
    reloadedAt: new Date().toISOString()
  });
});

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

module.exports = app;
