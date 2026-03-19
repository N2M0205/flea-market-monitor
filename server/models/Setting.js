module.exports = (sequelize, DataTypes) => {
  const Setting = sequelize.define('Setting', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: '設定ID（UUID）'
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
    setting_key: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '設定キー'
    },
    setting_value: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '設定値'
    }
  }, {
    tableName: 'Settings',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id'] },
      { unique: true, fields: ['user_id', 'setting_key'] }
    ]
  });

  return Setting;
};
