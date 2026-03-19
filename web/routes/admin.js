'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('crypto').webcrypto
  ? { v4: () => require('crypto').randomUUID() }
  : { v4: () => require('crypto').randomUUID() };
const db      = require('../database');
const { readConfig, writeConfig, safeProvider } = require('../services/llm');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-dev-token';

function requireAdmin(req, res, next) {
  const token =
    req.headers['x-admin-token'] ||
    req.cookies?.admin_token      ||
    req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: '无权限' });
  next();
}

// ── 登录 ──────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  if (req.body.token !== ADMIN_TOKEN)
    return res.status(401).json({ error: 'Token 错误' });
  res.cookie('admin_token', req.body.token, {
    httpOnly: true, maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax',
  });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

// ── 统计 ──────────────────────────────────────────────────────────────
router.get('/stats', requireAdmin, (req, res) => {
  const totalUsers    = db.db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const totalSessions = db.db.prepare('SELECT COUNT(*) as n FROM sessions').get().n;
  const totalDocs     = db.db.prepare('SELECT COUNT(*) as n FROM documents').get().n;
  const totalPoints   = db.db.prepare('SELECT SUM(points) as n FROM users').get().n || 0;
  const todayUsers    = db.db.prepare("SELECT COUNT(*) as n FROM users WHERE date(created_at)=date('now')").get().n;
  const todaySessions = db.db.prepare("SELECT COUNT(*) as n FROM sessions WHERE date(created_at)=date('now')").get().n;
  res.json({ totalUsers, totalSessions, totalDocs, totalPoints, todayUsers, todaySessions });
});

// ── 用户列表 ──────────────────────────────────────────────────────────
router.get('/users', requireAdmin, (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const q     = req.query.q ? `%${req.query.q}%` : null;
  const offset = (page - 1) * limit;
  const where  = q ? 'WHERE u.phone LIKE ? OR u.nickname LIKE ?' : '';
  const args   = q ? [q, q, limit, offset] : [limit, offset];

  const users = db.db.prepare(`
    SELECT u.id, u.phone, u.nickname, u.points, u.privacy_mode, u.created_at,
           COUNT(s.id) as session_count
    FROM users u LEFT JOIN sessions s ON s.user_id = u.id
    ${where} GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?
  `).all(...args);

  const total = db.db.prepare(`SELECT COUNT(*) as n FROM users u ${where}`)
    .get(...(q ? [q, q] : [])).n;

  res.json({ users, total, page, limit });
});

router.post('/users/:id/points', requireAdmin, (req, res) => {
  const { delta, reason } = req.body;
  if (!delta || isNaN(delta)) return res.status(400).json({ error: '请提供积分变动数量' });
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  db.updateUserPoints(req.params.id, parseInt(delta));
  db.addPointsLog(req.params.id, parseInt(delta),
    delta > 0 ? 'bonus' : 'consume', reason || (delta > 0 ? '管理员充值' : '管理员扣除'));
  res.json({ ok: true, points: db.getUserById(req.params.id).points });
});

// ── Providers CRUD ────────────────────────────────────────────────────

// 列表（隐藏 apiKey）
router.get('/providers', requireAdmin, (req, res) => {
  const cfg = readConfig();
  res.json({ providers: (cfg.providers || []).map(safeProvider) });
});

// 新增
router.post('/providers', requireAdmin, (req, res) => {
  const { name, baseURL, apiKey, model, enabled, isDefault } = req.body;
  if (!name || !baseURL || !model) return res.status(400).json({ error: '名称、BaseURL、模型名称为必填' });

  const cfg = readConfig();
  if (!cfg.providers) cfg.providers = [];

  // 只允许一个默认
  if (isDefault) cfg.providers.forEach(p => { p.isDefault = false; });

  const provider = {
    id:        require('crypto').randomUUID(),
    name:      name.trim(),
    baseURL:   baseURL.trim().replace(/\/$/, ''),
    apiKey:    apiKey || '',
    model:     model.trim(),
    enabled:   enabled !== false,
    isDefault: !!isDefault,
  };
  cfg.providers.push(provider);
  writeConfig(cfg);
  res.json({ ok: true, provider: safeProvider(provider) });
});

// 更新（apiKey 为空时保留原值）
router.put('/providers/:id', requireAdmin, (req, res) => {
  const cfg = readConfig();
  const idx = (cfg.providers || []).findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Provider 不存在' });

  const { name, baseURL, apiKey, model, enabled, isDefault } = req.body;
  const old = cfg.providers[idx];

  if (isDefault) cfg.providers.forEach(p => { p.isDefault = false; });

  cfg.providers[idx] = {
    ...old,
    name:      name     !== undefined ? name.trim()                      : old.name,
    baseURL:   baseURL  !== undefined ? baseURL.trim().replace(/\/$/, '') : old.baseURL,
    apiKey:    apiKey   ? apiKey                                           : old.apiKey, // 空则保留
    model:     model    !== undefined ? model.trim()                      : old.model,
    enabled:   enabled  !== undefined ? !!enabled                         : old.enabled,
    isDefault: isDefault !== undefined ? !!isDefault                      : old.isDefault,
  };
  writeConfig(cfg);
  res.json({ ok: true, provider: safeProvider(cfg.providers[idx]) });
});

// 删除
router.delete('/providers/:id', requireAdmin, (req, res) => {
  const cfg = readConfig();
  const before = (cfg.providers || []).length;
  cfg.providers = cfg.providers.filter(p => p.id !== req.params.id);
  if (cfg.providers.length === before) return res.status(404).json({ error: 'Provider 不存在' });
  writeConfig(cfg);
  res.json({ ok: true });
});

// 测试连通性
router.post('/providers/:id/test', requireAdmin, async (req, res) => {
  const cfg = readConfig();
  const provider = (cfg.providers || []).find(p => p.id === req.params.id);
  if (!provider) return res.status(404).json({ error: 'Provider 不存在' });

  try {
    const { chat } = require('../services/llm');
    const text = await chat({
      providerId: provider.id,
      messages: [{ role: 'user', content: '请回复"ok"' }],
      maxTokens: 10,
    });
    res.json({ ok: true, reply: text.slice(0, 100) });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

module.exports = { router, requireAdmin };
