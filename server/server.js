const app = require('./app');
const db = require('./models');
const schedulerService = require('./services/SchedulerService');

// browser.close() タイムアウト等の unhandled rejection でクラッシュしないようにする
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection:', reason?.message || reason);
  // クラッシュさせない（ログだけ出す）
});

const PORT = process.env.PORT || 3001;

// データベース接続とサーバー起動
db.sequelize
  .authenticate()
  .then(() => {
    console.log('✅ Database connection established');

    // サーバー起動
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);

      // スケジューラー起動
      if (process.env.ENABLE_SCHEDULER === 'true') {
        console.log('\n--- スケジューラー設定 ---');
        schedulerService.start();
        console.log('------------------------\n');
      } else {
        console.log('⚠️  スケジューラーは無効です（ENABLE_SCHEDULER を true に設定してください）');
      }
    });
  })
  .catch(err => {
    console.error('❌ Unable to connect to database:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  サーバーをシャットダウンしています...');
  schedulerService.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️  サーバーをシャットダウンしています...');
  schedulerService.stop();
  process.exit(0);
});
