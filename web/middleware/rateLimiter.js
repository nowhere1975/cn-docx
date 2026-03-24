'use strict';

const rateLimit = require('express-rate-limit');

// 已登录用户跳过所有 IP 限速
const skip = (req) => !!req.user;

const generateHourLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  skip,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ error: '请求过于频繁，每小时最多生成 5 次，请稍后再试' }),
  standardHeaders: true,
  legacyHeaders: false,
});

const generateDayLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 10,
  skip,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ error: '今日生成次数已达上限（10次/天），请明天再来' }),
  standardHeaders: true,
  legacyHeaders: false,
});

const convertHourLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  skip,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ error: '请求过于频繁，每小时最多排版 20 次，请稍后再试' }),
  standardHeaders: true,
  legacyHeaders: false,
});

const convertDayLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 40,
  skip,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) =>
    res.status(429).json({ error: '今日排版次数已达上限（40次/天），请明天再来' }),
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { generateHourLimit, generateDayLimit, convertHourLimit, convertDayLimit };
