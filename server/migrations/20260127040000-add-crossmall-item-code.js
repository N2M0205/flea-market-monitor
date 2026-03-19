'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Keywords', 'crossmall_item_code', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'CROSSMALL商品コード'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Keywords', 'crossmall_item_code');
  }
};