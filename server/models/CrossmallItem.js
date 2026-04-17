'use strict';

function deriveBaseCode(itemCode) {
  if (typeof itemCode !== 'string') return itemCode;
  return itemCode.endsWith('n') ? itemCode.slice(0, -1) : itemCode;
}

module.exports = (sequelize, DataTypes) => {
  const CrossmallItem = sequelize.define('CrossmallItem', {
    item_code: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
    },
    item_name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    unit_price: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    notax_purchase_price: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    taxin_purchase_price: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    freight_type: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    base_code: {
      type: DataTypes.TEXT,
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
    tableName: 'crossmall_items',
    underscored: true,
    hooks: {
      beforeValidate(instance) {
        if (instance.item_code && !instance.base_code) {
          instance.base_code = deriveBaseCode(instance.item_code);
        }
      },
    },
  });

  CrossmallItem.deriveBaseCode = deriveBaseCode;

  CrossmallItem.associate = (models) => {
    CrossmallItem.hasOne(models.CrossmallStock, {
      foreignKey: 'item_code',
      as: 'stock',
    });
    CrossmallItem.hasMany(models.CrossmallSale, {
      foreignKey: 'item_code',
      as: 'sales',
    });
  };

  return CrossmallItem;
};
