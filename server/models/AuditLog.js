module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: '監査ログID（UUID）'
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'ユーザーID'
    },
    action: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'アクション名'
    },
    table_name: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '対象テーブル名'
    },
    record_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: '対象レコードID'
    },
    old_values: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '変更前の値'
    },
    new_values: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: '変更後の値'
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: 'IPアドレス'
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'User Agent'
    }
  }, {
    tableName: 'AuditLogs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['action'] },
      { fields: ['created_at'] }
    ]
  });

  return AuditLog;
};
