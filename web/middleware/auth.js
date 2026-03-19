'use strict';

const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'cn-docx-secret-key-change-in-production';

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// 中间件：从 cookie 获取用户
function authMiddleware(req, res, next) {
  const token = req.cookies?.token;

  if (!token) {
    req.user = null;
    return next();
  }

  const payload = verifyToken(token);
  if (!payload) {
    req.user = null;
    return next();
  }

  const user = db.getUserById(payload.userId);
  req.user = user || null;
  next();
}

// 中间件：强制登录
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

// 检查积分是否足够
function requirePoints(points) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '请先登录' });
    }
    if (req.user.points < points) {
      return res.status(403).json({
        error: '积分不足',
        code: 'INSUFFICIENT_POINTS',
        required: points,
        current: req.user.points,
      });
    }
    next();
  };
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  authMiddleware,
  requireAuth,
  requirePoints,
};
