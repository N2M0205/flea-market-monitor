'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('keyword_variants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      keyword_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Keywords',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      item_code: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: 'CROSSMALL商品コード（SKU）',
      },
      variant_name: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'バリアント表示名（例: ブドウ、もも）',
      },
      match_words: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'タイトルマッチ用キーワードJSON配列（例: ["ブドウ","ぶどう"]）',
      },
      sort_order: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: '表示順',
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

    await queryInterface.addIndex('keyword_variants', ['keyword_id'], {
      name: 'idx_keyword_variants_keyword_id',
    });
    await queryInterface.addIndex('keyword_variants', ['item_code'], {
      name: 'idx_keyword_variants_item_code',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('keyword_variants');
  },
};
