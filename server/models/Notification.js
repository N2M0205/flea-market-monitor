module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: '通知ID（UUID）'
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
    product_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'Products',
        key: 'id'
      },
      onDelete: 'SET NULL',
      comment: '商品ID（外部キー）'
    },
    keyword_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'Keywords',
        key: 'id'
      },
      onDelete: 'SET NULL',
      comment: 'キーワードID（外部キー）'
    },
    notification_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: {
          args: [['new_product', 'price_drop', 'system']],
          msg: '無効な通知タイプです'
        }
      },
      comment: '通知タイプ'
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: '通知メッセージ'
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'pending',
      validate: {
        isIn: {
          args: [['pending', 'sent', 'failed']],
          msg: '無効なステータスです'
        }
      },
      comment: '送信ステータス'
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '送信完了日時'
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'エラーメッセージ'
    }
  }, {
    tableName: 'Notifications',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id'] },
      { fields: ['product_id'] },
      { fields: ['status'] },
      { fields: ['created_at'] }
    ]
  });

  return Notification;
};
