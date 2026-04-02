/**
 * DB古レコード定期クリーンアップスクリプト
 *
 * Productテーブルの90日超レコードを削除し、VACUUMでDBファイルを縮小する。
 * PriceHistoryは onDelete: CASCADE で自動削除される。
 * Notificationは onDelete: SET NULL で product_id が NULL になるのみ。
 *
 * PM2登録例:
 *   pm2 start server/scripts/db-cleanup.cjs --name db-cleanup --cron "0 3 * * *" --no-autorestart
 *   (毎日3:00に実行)
 */

const path = require('path');
const fs = require('fs');

const RETENTION_DAYS = parseInt(process.env.DB_CLEANUP_DAYS || '90', 10);
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function main() {
  console.log(`[db-cleanup] 実行開始: ${new Date().toISOString()}`);
  console.log(`[db-cleanup] 保持期間: ${RETENTION_DAYS}日`);

  // DBファイルサイズ（削除前）
  let sizeBefore = 0;
  try {
    sizeBefore = fs.statSync(DB_PATH).size;
    console.log(`[db-cleanup] DBファイルサイズ（削除前）: ${formatBytes(sizeBefore)}`);
  } catch (e) {
    console.error(`[db-cleanup] DBファイル読み取りエラー: ${e.message}`);
    return;
  }

  // Sequelizeインスタンスとモデルをロード
  const db = require('../models');
  const { sequelize, Product, PriceHistory } = db;

  try {
    // 接続確認
    await sequelize.authenticate();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffISO = cutoffDate.toISOString();
    console.log(`[db-cleanup] 削除基準日: ${cutoffISO}`);

    // 削除対象件数を事前カウント
    const [productCount] = await sequelize.query(
      `SELECT COUNT(*) as cnt FROM products WHERE created_at < :cutoff`,
      { replacements: { cutoff: cutoffISO }, type: sequelize.QueryTypes.SELECT }
    );
    const [priceHistoryCount] = await sequelize.query(
      `SELECT COUNT(*) as cnt FROM PriceHistories WHERE product_id IN (SELECT id FROM products WHERE created_at < :cutoff)`,
      { replacements: { cutoff: cutoffISO }, type: sequelize.QueryTypes.SELECT }
    );
    const [totalProductCount] = await sequelize.query(
      `SELECT COUNT(*) as cnt FROM products`,
      { type: sequelize.QueryTypes.SELECT }
    );

    console.log(`[db-cleanup] Products全体: ${totalProductCount.cnt.toLocaleString()}件`);
    console.log(`[db-cleanup] ${RETENTION_DAYS}日超の古いProducts: ${productCount.cnt.toLocaleString()}件`);
    console.log(`[db-cleanup] 関連PriceHistories: ${priceHistoryCount.cnt.toLocaleString()}件`);

    if (productCount.cnt === 0) {
      console.log('[db-cleanup] 削除対象なし');
      await sequelize.close();
      return;
    }

    // PriceHistories を先に削除（CASCADE が効かない場合の安全策）
    const [, priceHistoryMeta] = await sequelize.query(
      `DELETE FROM PriceHistories WHERE product_id IN (SELECT id FROM products WHERE created_at < :cutoff)`,
      { replacements: { cutoff: cutoffISO } }
    );

    // Products 削除
    const [, productMeta] = await sequelize.query(
      `DELETE FROM products WHERE created_at < :cutoff`,
      { replacements: { cutoff: cutoffISO } }
    );

    console.log(`[db-cleanup] 削除完了: Products ${productCount.cnt.toLocaleString()}件, PriceHistories ${priceHistoryCount.cnt.toLocaleString()}件`);

    // VACUUM でDBファイル縮小
    console.log('[db-cleanup] VACUUM実行中...');
    await sequelize.query('VACUUM');

    await sequelize.close();

    // DBファイルサイズ（削除後）
    const sizeAfter = fs.statSync(DB_PATH).size;
    const saved = sizeBefore - sizeAfter;
    console.log(`[db-cleanup] DBファイルサイズ（削除後）: ${formatBytes(sizeAfter)}`);
    console.log(`[db-cleanup] 縮小: ${formatBytes(saved)} (${sizeBefore > 0 ? ((saved / sizeBefore) * 100).toFixed(1) : 0}%)`);
    console.log(`[db-cleanup] 完了`);

  } catch (err) {
    console.error(`[db-cleanup] エラー: ${err.message}`);
    console.error(err.stack);
    try { await sequelize.close(); } catch {}
  }
}

main();
