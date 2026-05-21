'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('autopro_purchases', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      item_code: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      item_name: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      quantity: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      unit_price: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      purchased_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('autopro_purchases', ['item_code']);
    await queryInterface.addIndex('autopro_purchases', ['purchased_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('autopro_purchases');
  },
};
