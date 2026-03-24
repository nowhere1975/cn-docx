'use strict';

const express = require('express');
const db = require('../database');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请提供用户名和密码' });
  }

  const user = db.verifyUser(username.trim(), password);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = generateToken(user.id);
  res.cookie('token', token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  res.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
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
  const user = db.getUserById(req.user.id);
  res.json({
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      points: user.points,
      privacy_mode: user.privacy_mode,
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

// PATCH /api/auth/nickname
router.patch('/nickname', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  const { nickname } = req.body;
  if (!nickname || typeof nickname !== 'string' || !nickname.trim()) {
    return res.status(400).json({ error: '请提供有效的昵称' });
  }
  db.updateNickname(req.user.id, nickname.trim().slice(0, 20));
  db.completeTask(req.user.id, 'profile');
  res.json({ ok: true, nickname: nickname.trim().slice(0, 20) });
});

module.exports = router;
