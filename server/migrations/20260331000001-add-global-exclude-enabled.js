'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Keywords', 'global_exclude_enabled', {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Keywords', 'global_exclude_enabled');
  }
};
