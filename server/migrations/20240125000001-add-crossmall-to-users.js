// server/migrations/20240125000001-add-crossmall-to-users.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Users', 'crossmall_account', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'CROSSMALLアカウント番号（会社コード）'
    });

    await queryInterface.addColumn('Users', 'crossmall_api_key', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'CROSSMALL API認証鍵'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Users', 'crossmall_account');
    await queryInterface.removeColumn('Users', 'crossmall_api_key');
  }
};
