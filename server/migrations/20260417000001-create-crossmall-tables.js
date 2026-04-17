'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // crossmall_items
    await queryInterface.createTable('crossmall_items', {
      item_code: {
        type: Sequelize.TEXT,
        primaryKey: true,
        allowNull: false,
      },
      item_name: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      unit_price: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      notax_purchase_price: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      taxin_purchase_price: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      freight_type: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      base_code: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      crossmall_updated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      synced_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('crossmall_items', ['item_name'], {
      name: 'idx_items_name',
    });
    await queryInterface.addIndex('crossmall_items', ['base_code'], {
      name: 'idx_items_base',
    });

    // crossmall_stock
    await queryInterface.createTable('crossmall_stock', {
      item_code: {
        type: Sequelize.TEXT,
        primaryKey: true,
        allowNull: false,
        references: {
          model: 'crossmall_items',
          key: 'item_code',
        },
      },
      stock_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      crossmall_updated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      synced_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // crossmall_sales
    await queryInterface.createTable('crossmall_sales', {
      order_number: {
        type: Sequelize.TEXT,
        allowNull: false,
        primaryKey: true,
      },
      line_no: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      item_code: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      order_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      amount: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      unit_price: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      amount_price: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      delivery_type: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      synced_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('crossmall_sales', ['item_code', 'order_date'], {
      name: 'idx_sales_item_date',
    });
    await queryInterface.addIndex('crossmall_sales', ['order_date'], {
      name: 'idx_sales_date',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('crossmall_sales');
    await queryInterface.dropTable('crossmall_stock');
    await queryInterface.dropTable('crossmall_items');
  },
};
