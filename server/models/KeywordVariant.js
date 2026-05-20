'use strict';

module.exports = (sequelize, DataTypes) => {
  const KeywordVariant = sequelize.define('KeywordVariant', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'バリアントID（UUID）',
    },
    keyword_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Keywords',
        key: 'id',
      },
      onDelete: 'CASCADE',
      comment: 'キーワードID（外部キー）',
    },
    item_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'CROSSMALL商品コード（SKU）',
    },
    variant_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'バリアント表示名（例: ブドウ、もも）',
    },
    match_words: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'タイトルマッチ用キーワードJSON配列',
    },
    sort_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: '表示順',
    },
  }, {
    tableName: 'keyword_variants',
    underscored: true,
    indexes: [
      { fields: ['keyword_id'] },
      { fields: ['item_code'] },
    ],
  });

  KeywordVariant.associate = (models) => {
    KeywordVariant.belongsTo(models.Keyword, {
      foreignKey: 'keyword_id',
      as: 'keyword',
    });
  };

  return KeywordVariant;
};
