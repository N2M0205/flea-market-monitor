'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('LineLinkCodes', 'user_id', {
      type: Sequelize.UUID,
      allowNull: true, // 既存データがある可能性があるため nullable 推奨
    });

    // 任意：検索用インデックス
    await queryInterface.addIndex('LineLinkCodes', ['user_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('LineLinkCodes', ['user_id']);
    await queryInterface.removeColumn('LineLinkCodes', 'user_id');
  }
};
