'use strict';

const { db } = require('../database');

// 游客每日全局请求配额（SQLite 持久化，重启不丢失）
db.exec(`
  CREATE TABLE IF NOT EXISTS guest_usage (
    date  TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  );
`);

const DAILY_LIMIT = parseInt(process.env.DAILY_BUDGET) || 2000;

const stmtGet    = db.prepare('SELECT count FROM guest_usage WHERE date = ?');
const stmtUpsert = db.prepare(`
  INSERT INTO guest_usage (date, count) VALUES (?, 1)
  ON CONFLICT(date) DO UPDATE SET count = count + 1
`);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dailyBudget(req, res, next) {
  if (req.user) return next(); // 登录用户走积分体系，不占公共配额

  const row = stmtGet.get(today());
  if (row && row.count >= DAILY_LIMIT) {
    return res.status(503).json({ error: '今日免费配额已用完，明天再来吧 🙏' });
  }
  stmtUpsert.run(today());
  next();
}

module.exports = { dailyBudget };
