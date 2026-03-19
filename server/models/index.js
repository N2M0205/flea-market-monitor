// server/models/index.js
const { Sequelize, DataTypes } = require('sequelize');
const config = require('../config/database');

const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

// Sequelizeインスタンスの作成
const sequelize = new Sequelize(dbConfig);

// モデルのインポート
const User = require('./User')(sequelize, DataTypes);
const Keyword = require('./Keyword')(sequelize, DataTypes);
const Product = require('./Product')(sequelize, DataTypes);
const Notification = require('./Notification')(sequelize, DataTypes);
const PriceHistory = require('./PriceHistory')(sequelize, DataTypes);
const Setting = require('./Setting')(sequelize, DataTypes);
const AuditLog = require('./AuditLog')(sequelize, DataTypes);

// ★追加：LINE連携コード
const LineLinkCode = require('./LineLinkCode')(sequelize, DataTypes);

// リレーションシップの定義
// Users 1:N Keywords
User.hasMany(Keyword, { foreignKey: 'user_id', as: 'keywords' });
Keyword.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Users 1:N Notifications
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Users 1:N Settings
User.hasMany(Setting, { foreignKey: 'user_id', as: 'settings' });
Setting.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Keywords 1:N Products
Keyword.hasMany(Product, { foreignKey: 'keyword_id', as: 'products' });
Product.belongsTo(Keyword, { foreignKey: 'keyword_id', as: 'keyword' });

// Keywords 1:N Notifications
Keyword.hasMany(Notification, { foreignKey: 'keyword_id', as: 'notifications' });
Notification.belongsTo(Keyword, { foreignKey: 'keyword_id', as: 'keyword' });

// Products 1:N PriceHistories
Product.hasMany(PriceHistory, { foreignKey: 'product_id', as: 'priceHistories' });
PriceHistory.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// Products 1:N Notifications
Product.hasMany(Notification, { foreignKey: 'product_id', as: 'notifications' });
Notification.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

/**
 * ★重要：
 * LineLinkCodes に user_id カラムが無いDB（現状）では、
 * ここで関連付けを有効にすると user_id を参照するSQLが混ざる可能性があるため一旦オフにします。
 *
 * 将来的に LineLinkCodes に user_id を追加したら、下の2行を復活してください。
 */
// User.hasMany(LineLinkCode, { foreignKey: 'user_id', as: 'lineLinkCodes' });
// LineLinkCode.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// エクスポート
const db = {
  sequelize,
  Sequelize,
  User,
  Keyword,
  Product,
  Notification,
  PriceHistory,
  Setting,
  AuditLog,
  LineLinkCode
};

module.exports = db;
