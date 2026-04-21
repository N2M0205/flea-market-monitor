const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Product = sequelize.define('Product', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    keyword_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Keywords',
        key: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    platform: {
      type: DataTypes.ENUM('mercari', 'yahoo_flea', 'rakuma', 'yahoo_auction'),
      allowNull: false,
      defaultValue: 'mercari'
    },
    product_id: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: false
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    url: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    image_url: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    condition: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    seller_id: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    free_shipping: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    },
    listed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    notified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    tableName: 'products',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['keyword_id', 'product_id']
      },
      {
        fields: ['platform']
      },
      {
        fields: ['price']
      },
      {
        fields: ['listed_at']
      },
      {
        fields: ['notified']
      }
    ]
  });

  Product.associate = (models) => {
    Product.belongsTo(models.Keyword, {
      foreignKey: 'keyword_id',
      as: 'keyword'
    });

    Product.hasMany(models.PriceHistory, {
      foreignKey: 'product_id',
      as: 'price_histories'
    });
  };

  return Product;
};
