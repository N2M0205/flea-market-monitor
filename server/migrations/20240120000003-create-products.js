'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('products', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      keyword_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'keywords',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      platform: {
        type: Sequelize.ENUM('mercari', 'yahoo_flea', 'rakuma', 'yahoo_auction'),
        allowNull: false,
        defaultValue: 'mercari'
      },
      product_id: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      title: {
        type: Sequelize.STRING(500),
        allowNull: false
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
      },
      url: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      image_url: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      condition: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      seller_id: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      free_shipping: {
        type: Sequelize.BOOLEAN,
        allowNull: true
      },
      listed_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      notified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // ユニークインデックス: keyword_id + product_id
    await queryInterface.addIndex('products', ['keyword_id', 'product_id'], {
      unique: true,
      name: 'products_keyword_product_unique'
    });

    // 検索用インデックス
    await queryInterface.addIndex('products', ['platform']);
    await queryInterface.addIndex('products', ['price']);
    await queryInterface.addIndex('products', ['listed_at']);
    await queryInterface.addIndex('products', ['notified']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('products');
  }
};
