// 商品の通知フラグをリセットして、再度LINE通知をテストするスクリプト
// 実行方法: node reset-notifications.js

const path = require('path');

// データベース設定を読み込み
const dbConfig = {
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: false
};

const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize(dbConfig);

// Product モデル定義
const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  keyword_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  is_notified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'products',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// Keyword モデル定義
const Keyword = sequelize.define('Keyword', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  keyword: {
    type: DataTypes.STRING,
    allowNull: false
  },
  crossmall_item_code: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'keywords',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

async function resetNotifications() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    // セノッピーのキーワードIDを取得
    const keyword = await Keyword.findOne({
      where: { keyword: 'セノッピー' }
    });

    if (!keyword) {
      console.log('❌ セノッピーのキーワードが見つかりません');
      process.exit(1);
    }

    console.log(`📋 キーワード: ${keyword.keyword}`);
    console.log(`   ID: ${keyword.id}`);
    console.log(`   CROSSMALL商品コード: ${keyword.crossmall_item_code || 'なし'}\n`);

    // 該当キーワードの商品を検索
    const products = await Product.findAll({
      where: { keyword_id: keyword.id },
      order: [['created_at', 'DESC']],
      limit: 10
    });

    console.log(`📦 登録済み商品: ${products.length}件\n`);

    if (products.length === 0) {
      console.log('❌ 商品が見つかりません');
      console.log('   スクレイピングを実行して商品を登録してください');
      process.exit(1);
    }

    // 商品一覧を表示
    products.forEach((product, index) => {
      console.log(`${index + 1}. ${product.title.substring(0, 50)}...`);
      console.log(`   通知済み: ${product.is_notified ? 'はい' : 'いいえ'}`);
      console.log(`   作成日時: ${product.created_at}`);
      console.log('');
    });

    // 通知フラグをリセット
    const updated = await Product.update(
      { is_notified: false },
      { where: { keyword_id: keyword.id } }
    );

    console.log(`✅ ${updated[0]}件の商品を「未通知」状態にリセットしました\n`);
    console.log('🚀 次のステップ:');
    console.log('   1. スクレイピングを実行');
    console.log('   2. LINE通知が送信される');
    console.log('   3. CROSSMALL情報が表示される\n');

    await sequelize.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ エラー:', error.message);
    process.exit(1);
  }
}

resetNotifications();