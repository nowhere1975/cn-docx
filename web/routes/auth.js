'use strict';

const express = require('express');
const db = require('../database');
const { generateToken } = require('../middleware/auth');

const router = express.Router();
const IS_MOCK = process.env.SMS_MOCK !== 'false'; // 默认 mock

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/send-otp
router.post('/send-otp', (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: '请输入有效的手机号' });
  }

  const code = genCode();
  db.saveOtp(phone, code, 300); // 5 分钟有效

  if (IS_MOCK) {
    // 开发模式：直接返回验证码
    return res.json({ ok: true, mock: true, code });
  }

  // 生产模式：接入短信网关（TODO）
  // await sms.send(phone, code);
  res.json({ ok: true });
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: '请提供手机号和验证码' });
  }

  const ok = db.verifyOtp(phone, String(code));
  if (!ok) {
    return res.status(401).json({ error: '验证码错误或已过期' });
  }

  // 查找或创建用户
  let user = db.getUserByPhone(phone);
  const isNew = !user;
  if (!user) {
    const id = db.createUser(phone);
    user = db.getUserById(id);
  }

  const token = generateToken(user.id);
  res.cookie('token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  res.json({
    ok: true,
    isNew,
    user: {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      points: user.points,
      privacy_mode: user.privacy_mode,
    },
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({
    user: {
      id: req.user.id,
      phone: req.user.phone,
      nickname: req.user.nickname,
      points: req.user.points,
      privacy_mode: req.user.privacy_mode,
    },
  });
});

// PATCH /api/auth/privacy
router.patch('/privacy', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const { privacy_mode } = req.body;
  db.setPrivacyMode(req.user.id, privacy_mode);
  res.json({ ok: true, privacy_mode: privacy_mode ? 1 : 0 });
});

module.exports = router;
