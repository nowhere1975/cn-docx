'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/points — 当前积分
router.get('/', requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  res.json({ points: user.points });
});

// GET /api/points/log — 积分流水
router.get('/log', requireAuth, (req, res) => {
  const logs = db.getPointsLog(req.user.id, 50);
  res.json({ logs });
});

module.exports = router;
