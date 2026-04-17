'use strict';

module.exports = (sequelize, DataTypes) => {
  const CrossmallSale = sequelize.define('CrossmallSale', {
    order_number: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
    },
    line_no: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      allowNull: false,
    },
    item_code: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    order_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    unit_price: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    amount_price: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    delivery_type: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    synced_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  }, {
    tableName: 'crossmall_sales',
    underscored: true,
  });

  CrossmallSale.associate = (models) => {
    CrossmallSale.belongsTo(models.CrossmallItem, {
      foreignKey: 'item_code',
      as: 'item',
    });
  };

  return CrossmallSale;
};
