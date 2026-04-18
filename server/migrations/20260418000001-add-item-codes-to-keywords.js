'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Keywords', 'item_codes', {
      type: Sequelize.TEXT,
      allowNull: true,
      comment: '紐付けSKUコード（カンマ区切り複数可）',
    });

    await queryInterface.addIndex('Keywords', ['item_codes'], {
      name: 'keywords_item_codes',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Keywords', 'keywords_item_codes');
    await queryInterface.removeColumn('Keywords', 'item_codes');
  }
};
