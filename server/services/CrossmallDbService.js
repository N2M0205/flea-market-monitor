/**
 * CrossmallDbService
 * crossmall_items / crossmall_stock / crossmall_sales テーブルを参照して
 * 在庫・販売情報を返すサービス。
 *
 * 通知生成時の CROSSMALL API 直叩きをゼロにし、
 * 既存 PurchaseMasterCache.getMasterItem() と互換の返り値を提供する。
 */
'use strict';

const { Op } = require('sequelize');

let _db = null;
function getDb() {
  if (!_db) _db = require('../models');
  return _db;
}

/**
 * base_code 導出（CrossmallItem.deriveBaseCode と同実装）
 */
function deriveBaseCode(itemCode) {
  if (typeof itemCode !== 'string') return itemCode;
  return itemCode.endsWith('n') ? itemCode.slice(0, -1) : itemCode;
}

/**
 * crossmall_sales から販売統計を集計
 * @param {string[]} itemCodes - 集計対象の item_code リスト
 * @returns {{ sales7, sales28, lastSalePrice, lastSaleDate, deliveryType }}
 */
async function aggregateSalesStats(itemCodes) {
  const db = getDb();
  const now = new Date();
  const ago7  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
  const ago28 = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

  const [sales7, sales28, latestRow] = await Promise.all([
    db.CrossmallSale.count({
      where: { item_code: { [Op.in]: itemCodes }, order_date: { [Op.gte]: ago7 } },
    }),
    db.CrossmallSale.count({
      where: { item_code: { [Op.in]: itemCodes }, order_date: { [Op.gte]: ago28 } },
    }),
    db.CrossmallSale.findOne({
      where: { item_code: { [Op.in]: itemCodes } },
      order: [['order_date', 'DESC'], ['order_number', 'DESC']],
      attributes: ['unit_price', 'order_date', 'delivery_type'],
    }),
  ]);

  return {
    sales7,
    sales28,
    lastSalePrice: latestRow?.unit_price ?? null,
    lastSaleDate:  latestRow ? latestRow.order_date.toISOString().slice(0, 10) : null,
    deliveryType:  latestRow?.delivery_type ?? null,
  };
}

/**
 * crossmall_stock から在庫合計を取得
 * @param {string[]} itemCodes
 * @returns {number}
 */
async function aggregateStock(itemCodes) {
  const db = getDb();
  const rows = await db.CrossmallStock.findAll({
    where: { item_code: { [Op.in]: itemCodes } },
    attributes: ['stock_count'],
    raw: true,
  });
  return rows.reduce((sum, r) => sum + (r.stock_count || 0), 0);
}

/**
 * 単一 item_code で在庫・販売情報を取得
 * (後方互換 — 既存 PurchaseMasterCache.getMasterItem() の代替)
 *
 * @param {string} itemCode
 * @returns {{ item_code, stock, lastSalePrice, sales28, sales7, lastSaleDate, deliveryType, item_name } | null}
 */
async function getStockAndPriceByItemCode(itemCode) {
  if (!itemCode) return null;
  const db = getDb();

  const [item, stockRow, stats] = await Promise.all([
    db.CrossmallItem.findByPk(itemCode, { attributes: ['item_name'] }),
    db.CrossmallStock.findByPk(itemCode, { attributes: ['stock_count'] }),
    aggregateSalesStats([itemCode]),
  ]);

  if (!item && !stockRow) {
    return null;
  }

  return {
    item_code:     itemCode,
    item_name:     item?.item_name ?? null,
    stock:         stockRow?.stock_count ?? 0,
    lastSalePrice: stats.lastSalePrice,
    sales28:       stats.sales28,
    sales7:        stats.sales7,
    lastSaleDate:  stats.lastSaleDate,
    deliveryType:  stats.deliveryType,
  };
}

/**
 * base_code 単位で集約した在庫・販売情報を取得
 * 例: '2314-001247' で '2314-001247' と '2314-001247n' の合算値を返す
 *
 * @param {string} baseCode - base_code（末尾 'n' 除去済み）
 * @returns {{ base_code, item_codes, stock, lastSalePrice, sales28, sales7, lastSaleDate, deliveryType } | null}
 */
async function getStockAndPriceByBaseCode(baseCode) {
  if (!baseCode) return null;
  const db = getDb();

  const items = await db.CrossmallItem.findAll({
    where: { base_code: baseCode },
    attributes: ['item_code', 'item_name'],
    raw: true,
  });

  if (items.length === 0) return null;

  const itemCodes = items.map(i => i.item_code);

  const [stock, stats] = await Promise.all([
    aggregateStock(itemCodes),
    aggregateSalesStats(itemCodes),
  ]);

  return {
    base_code:     baseCode,
    item_codes:    itemCodes,
    item_name:     items[0]?.item_name ?? null,
    stock,
    lastSalePrice: stats.lastSalePrice,
    sales28:       stats.sales28,
    sales7:        stats.sales7,
    lastSaleDate:  stats.lastSaleDate,
    deliveryType:  stats.deliveryType,
  };
}

module.exports = {
  deriveBaseCode,
  getStockAndPriceByItemCode,
  getStockAndPriceByBaseCode,
};
