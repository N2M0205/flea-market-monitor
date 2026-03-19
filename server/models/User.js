// server/models/User.js (完全版)
const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      comment: 'ユーザーID（UUID）'
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        len: {
          args: [3, 50],
          msg: 'ユーザー名は3-50文字である必要があります'
        }
      },
      comment: 'ユーザー名'
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: {
          msg: '有効なメールアドレスを入力してください'
        }
      },
      comment: 'メールアドレス'
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'パスワードハッシュ（bcrypt）'
    },
    line_user_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
      comment: 'LINE User ID'
    },
    // ✅ CROSSMALL設定を追加
    crossmall_account: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'CROSSMALLアカウント番号（会社コード）'
    },
    crossmall_api_key: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'CROSSMALL API認証鍵'
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'アカウント有効フラグ'
    },
    last_login_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: '最終ログイン日時'
    }
  }, {
    tableName: 'Users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['email'] },
      { fields: ['line_user_id'] }
    ],
    hooks: {
      beforeCreate: async (user) => {
        if (user.password_hash) {
          const salt = await bcrypt.genSalt(10);
          user.password_hash = await bcrypt.hash(user.password_hash, salt);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password_hash')) {
          const salt = await bcrypt.genSalt(10);
          user.password_hash = await bcrypt.hash(user.password_hash, salt);
        }
      }
    }
  });

  // パスワード検証メソッド
  User.prototype.validatePassword = async function(password) {
    return await bcrypt.compare(password, this.password_hash);
  };

  // 関連定義
  User.associate = function(models) {
    User.hasMany(models.Keyword, {
      foreignKey: 'user_id',
      as: 'keywords',
      onDelete: 'CASCADE'
    });

    User.hasMany(models.Product, {
      foreignKey: 'user_id',
      as: 'products',
      onDelete: 'CASCADE'
    });
  };

  return User;
};
