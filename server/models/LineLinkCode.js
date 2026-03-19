// server/models/LineLinkCode.js
module.exports = (sequelize, DataTypes) => {
  const LineLinkCode = sequelize.define('LineLinkCode', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'LINE連携コードID'
    },
    line_user_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'LINE User ID'
    },
    link_code: {
      type: DataTypes.STRING(6),
      allowNull: false,
      unique: true,
      comment: '6桁の連携コード'
    },
    is_used: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: '使用済みフラグ'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: '有効期限（24時間）'
    }
  }, {
    tableName: 'LineLinkCodes',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['link_code'] },
      { fields: ['line_user_id'] }
    ]
  });

  // 有効期限チェックメソッド
  LineLinkCode.prototype.isExpired = function() {
    return new Date() > this.expires_at;
  };

  // 6桁のランダムコード生成
  LineLinkCode.generateCode = function() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  return LineLinkCode;
};
