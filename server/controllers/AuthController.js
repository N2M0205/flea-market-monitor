const jwt = require('jsonwebtoken');
const db = require('../models');

// JWTトークン生成
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// ユーザー登録
exports.register = async (req, res) => {
  try {
    const { username, email, password, line_user_id } = req.body;

    // バリデーション
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'ユーザー名、メール、パスワードは必須です'
      });
    }

    // パスワードの強度チェック
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'パスワードは8文字以上である必要があります'
      });
    }

    // メールアドレスの重複チェック
    const existingUser = await db.User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'このメールアドレスは既に登録されています'
      });
    }

    // ユーザー名の重複チェック
    const existingUsername = await db.User.findOne({ where: { username } });
    if (existingUsername) {
      return res.status(400).json({
        success: false,
        error: 'このユーザー名は既に使用されています'
      });
    }

    // ユーザー作成
    const user = await db.User.create({
      username,
      email,
      password_hash: password, // モデルのhookで自動的にハッシュ化される
      line_user_id
    });

    // JWTトークン生成
    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          line_user_id: user.line_user_id,
          created_at: user.created_at
        },
        token
      },
      message: 'ユーザー登録が完了しました'
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'ユーザー登録に失敗しました'
    });
  }
};

// ログイン
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // バリデーション
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'メールとパスワードは必須です'
      });
    }

    // ユーザー検索
    const user = await db.User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'メールアドレスまたはパスワードが正しくありません'
      });
    }

    // アカウント有効性チェック
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: 'アカウントが無効化されています'
      });
    }

    // パスワード検証
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'メールアドレスまたはパスワードが正しくありません'
      });
    }

    // 最終ログイン日時を更新
    await user.update({ last_login_at: new Date() });

    // JWTトークン生成
    const token = generateToken(user.id);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          line_user_id: user.line_user_id
        },
        token
      },
      message: 'ログインに成功しました'
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'ログインに失敗しました'
    });
  }
};

// 現在のユーザー情報取得
exports.getMe = async (req, res) => {
  try {
    // ミドルウェアでreq.userに設定されたユーザー情報を返す
    res.json({
      success: true,
      data: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        line_user_id: req.user.line_user_id,
        is_active: req.user.is_active,
        last_login_at: req.user.last_login_at,
        created_at: req.user.created_at
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'ユーザー情報の取得に失敗しました'
    });
  }
};
