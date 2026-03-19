module.exports = (sequelize, DataTypes) => {
  const Keyword = sequelize.define('Keyword', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'キーワードID（UUID）'
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      },
      onDelete: 'CASCADE',
      comment: 'ユーザーID（外部キー）'
    },
    keyword: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        len: {
          args: [1, 100],
          msg: 'キーワードは1-100文字である必要があります'
        }
      },
      comment: '監視キーワード'
    },
    min_price: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
      validate: {
        min: 0
      },
      comment: '最低価格'
    },
    max_price: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 999999,
      validate: {
        min: 0
      },
      comment: '最高価格'
    },
    exclude_keywords: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '除外キーワード（カンマ区切り）'
    },
    platforms: {
      type: DataTypes.JSON,
      defaultValue: {
        mercari: true,
        yahoo_flea: true,
        rakuma: true,
        yahoo_auction: true
      },
      comment: '対象プラットフォーム設定'
    },
    conditions: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '商品状態フィルタ'
    },
    free_shipping_only: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: '送料無料のみフラグ'
    },
    line_group_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'LINE通知先グループID'
    },
    crossmall_item_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'CROSSMALL商品コード'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: '監視有効フラグ'
    },
    detection_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: '検出商品数'
    },
    last_checked_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '最終チェック日時'
    }
  }, {
    tableName: 'Keywords',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id'] },
      { fields: ['is_active'] },
      { fields: ['keyword'] }
    ],
    validate: {
      priceRange() {
        if (parseFloat(this.min_price) > parseFloat(this.max_price)) {
          throw new Error('最低価格は最高価格以下である必要があります');
        }
      }
    }
  });

  return Keyword;
};