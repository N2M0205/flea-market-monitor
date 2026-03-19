// server/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const bcrypt = require('bcryptjs');

/**
 * SINGLE_TENANT=true の場合:
 * - 認証をスキップして default ユーザーとして処理する
 * - defaultユーザーが無ければ自動作成
 */
async function ensureDefaultUser() {
  const email = process.env.SINGLE_TENANT_EMAIL || 'single@local';
  const username = process.env.SINGLE_TENANT_USERNAME || 'single-tenant';

  let user = await User.findOne({ where: { email } });
  if (user) return user;

  const rawPassword = process.env.SINGLE_TENANT_PASSWORD || 'change-me';
  const password_hash = await bcrypt.hash(rawPassword, 10);

  user = await User.create({
    username,
    email,
    password_hash,
    is_active: true,
  });

  console.log(`✅ SINGLE_TENANT default user created: ${email} (${user.id})`);
  return user;
}

/**
 * JWT認証ミドルウェア
 * - SINGLE_TENANT=true: 認証スキップし default user を req.user に入れる
 * - それ以外: 従来通り JWT 認証
 */
const authMiddleware = async (req, res, next) => {
  try {
    if (process.env.SINGLE_TENANT === 'true') {
      const user = await ensureDefaultUser();
      req.user = {
        id: user.id,
        userId: user.id,
        username: user.username,
        email: user.email,
        line_user_id: user.line_user_id,
      };
      return next();
    }

    // --- 従来のJWT認証 ---
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '認証トークンが提供されていません',
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findOne({
      where: { id: decoded.userId },
      attributes: ['id', 'username', 'email', 'line_user_id'],
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'ユーザーが見つかりません',
      });
    }

    req.user = {
      id: user.id,
      userId: user.id,
      username: user.username,
      email: user.email,
      line_user_id: user.line_user_id,
    };

    next();
  } catch (error) {
    console.error('❌ 認証エラー:', error.message);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: '無効な認証トークンです' });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: '認証トークンの有効期限が切れています' });
    }

    return res.status(500).json({
      success: false,
      message: '認証処理中にエラーが発生しました',
    });
  }
};

module.exports = authMiddleware;
