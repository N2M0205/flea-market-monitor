// Nintendo Switch キーワードを全ユーザーから削除するスクリプト
// 実行方法: node delete-all-nintendo-switch.js

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
  user_id: {
    type: DataTypes.UUID,
    allowNull: false
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

async function deleteNintendoSwitch() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    // Nintendo Switch を検索
    const keywords = await Keyword.findAll({
      where: {
        keyword: 'Nintendo Switch'
      }
    });

    console.log(`\n📋 見つかったキーワード: ${keywords.length}件\n`);

    if (keywords.length === 0) {
      console.log('✅ Nintendo Switch は登録されていません');
      process.exit(0);
    }

    // 各キーワードを表示
    keywords.forEach((kw, index) => {
      console.log(`${index + 1}. ID: ${kw.id}`);
      console.log(`   User ID: ${kw.user_id}`);
      console.log(`   キーワード: ${kw.keyword}`);
      console.log(`   作成日時: ${kw.created_at}`);
      console.log('');
    });

    // 削除を実行
    const deleted = await Keyword.destroy({
      where: {
        keyword: 'Nintendo Switch'
      }
    });

    console.log(`✅ ${deleted}件の「Nintendo Switch」キーワードを削除しました\n`);

    // 削除後の確認
    const remaining = await Keyword.findAll({
      attributes: ['keyword', 'user_id']
    });

    console.log('📋 残っているキーワード:');
    remaining.forEach(kw => {
      console.log(`  - ${kw.keyword} (User ID: ${kw.user_id})`);
    });

    await sequelize.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ エラー:', error.message);
    process.exit(1);
  }
}

deleteNintendoSwitch();
