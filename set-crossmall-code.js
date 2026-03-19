// CROSSMALL商品コードを設定するスクリプト
// 実行方法: node set-crossmall-code.js

const path = require('path');

// データベース設定を読み込み
const dbConfig = {
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: false
};

const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize(dbConfig);

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

async function setCrossmallCode() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    // セノッピーのキーワードを取得
    const keyword = await Keyword.findOne({
      where: { keyword: 'セノッピー' }
    });

    if (!keyword) {
      console.log('❌ セノッピーのキーワードが見つかりません');
      process.exit(1);
    }

    console.log('📋 現在の設定:');
    console.log(`   キーワード: ${keyword.keyword}`);
    console.log(`   ID: ${keyword.id}`);
    console.log(`   CROSSMALL商品コード: ${keyword.crossmall_item_code || 'なし'}\n`);

    // CROSSMALL商品コードを設定
    await keyword.update({
      crossmall_item_code: '2314-000521'
    });

    console.log('✅ CROSSMALL商品コードを設定しました\n');

    // 更新後の確認
    await keyword.reload();
    console.log('📋 更新後の設定:');
    console.log(`   キーワード: ${keyword.keyword}`);
    console.log(`   ID: ${keyword.id}`);
    console.log(`   CROSSMALL商品コード: ${keyword.crossmall_item_code}\n`);

    console.log('🚀 次のステップ:');
    console.log('   1. node reset-notifications.js を実行');
    console.log('   2. スクレイピングを実行');
    console.log('   3. LINE通知にCROSSMALL情報が表示される\n');

    await sequelize.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ エラー:', error.message);
    process.exit(1);
  }
}

setCrossmallCode();
