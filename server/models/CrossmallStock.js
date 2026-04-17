'use strict';

module.exports = (sequelize, DataTypes) => {
  const CrossmallStock = sequelize.define('CrossmallStock', {
    item_code: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
    },
    stock_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    crossmall_updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    synced_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  }, {
    tableName: 'crossmall_stock',
    underscored: true,
  });

  CrossmallStock.associate = (models) => {
    CrossmallStock.belongsTo(models.CrossmallItem, {
      foreignKey: 'item_code',
      as: 'item',
    });
  };

  return CrossmallStock;
};
