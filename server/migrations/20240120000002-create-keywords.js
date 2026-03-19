'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Keywords', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      keyword: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      min_price: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        allowNull: false
      },
      max_price: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 999999,
        allowNull: false
      },
      exclude_keywords: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      platforms: {
        type: Sequelize.JSON,
        defaultValue: '{"mercari":true,"yahoo_flea":true,"rakuma":true,"yahoo_auction":true}',
        allowNull: false
      },
      conditions: {
        type: Sequelize.JSON,
        allowNull: true
      },
      free_shipping_only: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      line_group_id: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      detection_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      last_checked_at: {
        type: Sequelize.DATE,
        allowNull: true
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

    // インデックスの作成
    await queryInterface.addIndex('Keywords', ['user_id'], {
      name: 'idx_keywords_user_id'
    });

    await queryInterface.addIndex('Keywords', ['is_active'], {
      name: 'idx_keywords_is_active'
    });

    await queryInterface.addIndex('Keywords', ['keyword'], {
      name: 'idx_keywords_keyword'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Keywords');
  }
};
