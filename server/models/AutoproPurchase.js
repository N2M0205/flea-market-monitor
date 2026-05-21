'use strict';

module.exports = (sequelize, DataTypes) => {
  const AutoproPurchase = sequelize.define('AutoproPurchase', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    item_code: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    item_name: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    unit_price: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    purchased_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  }, {
    tableName: 'autopro_purchases',
    underscored: true,
  });

  return AutoproPurchase;
};
