// server/migrations/20240125000002-create-line-link-codes.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('LineLinkCodes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        comment: 'LINE連携コードID'
      },
      line_user_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'LINE User ID'
      },
      link_code: {
        type: Sequelize.STRING(6),
        allowNull: false,
        unique: true,
        comment: '6桁の連携コード'
      },
      is_used: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: '使用済みフラグ'
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: '有効期限（24時間）'
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

    await queryInterface.addIndex('LineLinkCodes', ['link_code']);
    await queryInterface.addIndex('LineLinkCodes', ['line_user_id']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('LineLinkCodes');
  }
};
