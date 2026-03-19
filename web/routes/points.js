'use strict';

const express = require('express');
const db = require('../database');

const router = express.Router();

// 积分充值比例：1 元 = 10 积分
const POINTS_PER_YUAN = 10;

// 获取当前积分
router.get('/', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: '请先登录' });
  }

  const user = db.getUserById(req.user.id);
  res.json({ points: user.points });
});

// 获取积分记录
router.get('/log', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: '请先登录' });
  }

  const logs = db.getPointsLog(req.user.id, 50);
  res.json({ logs });
});

// 充值（模拟）
router.post('/recharge', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: '请先登录' });
  }

  const { amount } = req.body; // amount: 充值金额（元）

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: '请输入有效的充值金额' });
  }

  const points = Math.floor(amount * POINTS_PER_YUAN);

  // 更新用户积分
  db.updateUserPoints(req.user.id, points);

  // 记录积分变动
  db.addPointsLog(req.user.id, points, 'recharge', `充值 ${amount} 元`);

  // 重新获取用户信息
  const user = db.getUserById(req.user.id);

  res.json({
    message: '充值成功',
    points: user.points,
    added: points,
    amount,
  });
});

module.exports = router;
