// server/middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../models');
const bcrypt = require('bcryptjs');

async function ensureDefaultUser() {
  const email = process.env.SINGLE_TENANT_EMAIL || 'single@local';
  const username = process.env.SINGLE_TENANT_USERNAME || 'single-tenant';

  let user = await db.User.findOne({ where: { email } });
  if (user) return user;

  const rawPassword = process.env.SINGLE_TENANT_PASSWORD || 'change-me';
  const password_hash = await bcrypt.hash(rawPassword, 10);

  user = await db.User.create({
    username,
    email,
    password_hash,
    is_active: true,
  });

  console.log(`✅ SINGLE_TENANT default user created: ${email} (${user.id})`);
  return user;
}

// JWT認証ミドルウェア
const authenticateToken = async (req, res, next) => {
  try {
    if (process.env.SINGLE_TENANT === 'true') {
      const user = await ensureDefaultUser();
      req.user = user;
      return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

    if (!token) {
      return res.status(401).json({
        success: false,
        error: '認証トークンが提供されていません',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.User.findByPk(decoded.userId);

    if (!user) {
      return res.status(401).json({ success: false, error: 'ユーザーが見つかりません' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, error: 'アカウントが無効化されています' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: '無効なトークンです' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'トークンの有効期限が切れています' });
    }
    return res.status(500).json({ success: false, error: 'サーバーエラーが発生しました' });
  }
};

module.exports = { authenticateToken };
