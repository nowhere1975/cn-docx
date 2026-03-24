'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

// ── 建表 ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    phone         TEXT UNIQUE,
    nickname      TEXT,
    points        INTEGER DEFAULT 0,
    privacy_mode  INTEGER DEFAULT 0,
    invite_code   TEXT UNIQUE,
    invited_by    INTEGER,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used       INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    title          TEXT,
    mode           TEXT NOT NULL,
    style          TEXT,
    doc_type       TEXT,
    input_snapshot TEXT,
    privacy        INTEGER DEFAULT 0,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS documents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    filename   TEXT NOT NULL,
    file_path  TEXT NOT NULL,
    file_size  INTEGER,
    version    INTEGER DEFAULT 1,
    privacy    INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS points_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    amount      INTEGER NOT NULL,
    type        TEXT NOT NULL,
    description TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS api_usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    endpoint    TEXT NOT NULL,
    points_cost INTEGER NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    package_id TEXT NOT NULL,
    yuan       REAL NOT NULL,
    points     INTEGER NOT NULL,
    status     TEXT DEFAULT 'paid',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    task_key   TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, task_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ── 用户 ──────────────────────────────────────────────────────────────

const TASK_POINTS = { profile: 2, first_convert: 2, first_generate: 2, first_official: 2 };
const TASK_LABELS = {
  profile:        '完善昵称',
  first_convert:  '首次粘贴排版',
  first_generate: '首次AI起草',
  first_official: '首次使用公文模式',
};

const crypto = require('crypto');

function _hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function _checkPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

// Admin 建用户（用户名+密码）
function createUser(username, password, points = 0, nickname = '') {
  const password_hash = _hashPassword(password);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, points)
    VALUES (?, ?, ?, ?)
  `).run(username, password_hash, nickname || username, points);
  const userId = result.lastInsertRowid;
  if (points > 0) addPointsLog(userId, points, 'bonus', '管理员初始赠送');
  return userId;
}

// 用户名密码验证，成功返回用户，失败返回 null
function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.password_hash) return null;
  if (!_checkPassword(password, user.password_hash)) return null;
  return user;
}

// 修改密码
function updatePassword(userId, password) {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(_hashPassword(password), userId);
}

function getUserByPhone(phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return db.prepare(
    'SELECT id, username, phone, nickname, points, privacy_mode, created_at FROM users WHERE id = ?'
  ).get(id);
}

function updateNickname(userId, nickname) {
  db.prepare('UPDATE users SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nickname, userId);
}

function updateUserPoints(userId, delta) {
  db.prepare(
    'UPDATE users SET points = points + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(delta, userId);
}

function setPrivacyMode(userId, mode) {
  db.prepare(
    'UPDATE users SET privacy_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(mode ? 1 : 0, userId);
}

// ── OTP ───────────────────────────────────────────────────────────────

function saveOtp(phone, code, ttlSeconds = 300) {
  // 清理同一手机号的旧验证码
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(phone);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  db.prepare(
    'INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)'
  ).run(phone, code, expiresAt);
}

function verifyOtp(phone, code) {
  const row = db.prepare(
    `SELECT * FROM otp_codes
     WHERE phone = ? AND code = ? AND used = 0
       AND expires_at > datetime('now')
     ORDER BY id DESC LIMIT 1`
  ).get(phone, code);
  if (!row) return false;
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);
  return true;
}

// ── Sessions（历史记录） ────────────────────────────────────────────────

function createSession(userId, { title, mode, style, docType, inputSnapshot, privacy }) {
  const result = db.prepare(`
    INSERT INTO sessions (user_id, title, mode, style, doc_type, input_snapshot, privacy)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    title || null,
    mode,
    style || null,
    docType || null,
    inputSnapshot ? JSON.stringify(inputSnapshot) : null,
    privacy ? 1 : 0,
  );
  return result.lastInsertRowid;
}

function updateSessionTitle(sessionId, title) {
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId);
}

function getSessionsByUser(userId, limit = 50) {
  return db.prepare(`
    SELECT s.*, COUNT(d.id) as doc_count,
           MAX(d.created_at) as last_doc_at
    FROM sessions s
    LEFT JOIN documents d ON d.session_id = s.id
    WHERE s.user_id = ? AND s.privacy = 0
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

function getSessionById(sessionId, userId) {
  return db.prepare(
    'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, userId);
}

function deleteSession(sessionId, userId) {
  const docs = getDocumentsBySession(sessionId, userId);
  db.prepare('DELETE FROM documents WHERE session_id = ? AND user_id = ?').run(sessionId, userId);
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
  return docs; // 调用方负责删除磁盘文件
}

// ── Documents（生成的文件） ────────────────────────────────────────────

function createDocument(sessionId, userId, { filename, filePath, fileSize, privacy }) {
  // 计算该 session 下的版本号
  const row = db.prepare(
    'SELECT MAX(version) as maxv FROM documents WHERE session_id = ?'
  ).get(sessionId);
  const version = (row?.maxv || 0) + 1;

  const result = db.prepare(`
    INSERT INTO documents (session_id, user_id, filename, file_path, file_size, version, privacy)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId, userId, filename, filePath, fileSize || null, version, privacy ? 1 : 0
  );
  return result.lastInsertRowid;
}

function getDocumentsBySession(sessionId, userId) {
  return db.prepare(`
    SELECT * FROM documents
    WHERE session_id = ? AND user_id = ?
    ORDER BY version ASC
  `).all(sessionId, userId);
}

function getDocumentById(docId, userId) {
  return db.prepare(
    'SELECT * FROM documents WHERE id = ? AND user_id = ?'
  ).get(docId, userId);
}

function deleteDocument(docId, userId) {
  const doc = getDocumentById(docId, userId);
  if (!doc) return null;
  db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
  return doc;
}

// ── 积分 ──────────────────────────────────────────────────────────────

function addPointsLog(userId, amount, type, description) {
  db.prepare(`
    INSERT INTO points_log (user_id, amount, type, description)
    VALUES (?, ?, ?, ?)
  `).run(userId, amount, type, description);
}

function getPointsLog(userId, limit = 20) {
  return db.prepare(`
    SELECT * FROM points_log WHERE user_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(userId, limit);
}

function addApiUsage(userId, endpoint, pointsCost) {
  db.prepare(`
    INSERT INTO api_usage (user_id, endpoint, points_cost)
    VALUES (?, ?, ?)
  `).run(userId, endpoint, pointsCost);
}

function getUserPoints(userId) {
  const row = db.prepare('SELECT points FROM users WHERE id = ?').get(userId);
  return row ? row.points : 0;
}

// ── 订单 ──────────────────────────────────────────────────────────────

function createOrder(userId, packageId, yuan, points) {
  const result = db.prepare(`
    INSERT INTO orders (user_id, package_id, yuan, points, status)
    VALUES (?, ?, ?, ?, 'paid')
  `).run(userId, packageId, yuan, points);

  // 被邀请人首次充值：邀请人额外 +10
  const orderCount = db.prepare('SELECT COUNT(*) as n FROM orders WHERE user_id = ?').get(userId).n;
  if (orderCount === 1) {
    const user = db.prepare('SELECT invited_by FROM users WHERE id = ?').get(userId);
    if (user && user.invited_by) {
      updateUserPoints(user.invited_by, 10);
      addPointsLog(user.invited_by, 10, 'invite', '被邀请人首次充值奖励');
    }
  }

  return result.lastInsertRowid;
}

function getOrders(userId, limit = 20) {
  return db.prepare(`
    SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(userId, limit);
}

function getAllOrders(limit = 50, offset = 0) {
  return db.prepare(`
    SELECT o.*, u.phone, u.nickname
    FROM orders o JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function getOrdersStats() {
  const today = db.prepare(`
    SELECT COUNT(*) as count, SUM(yuan) as revenue, SUM(points) as points
    FROM orders WHERE date(created_at) = date('now')
  `).get();
  const month = db.prepare(`
    SELECT COUNT(*) as count, SUM(yuan) as revenue, SUM(points) as points
    FROM orders WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get();
  const total = db.prepare(`
    SELECT COUNT(*) as count, SUM(yuan) as revenue, SUM(points) as points FROM orders
  `).get();
  return { today, month, total };
}

// ── 任务 ──────────────────────────────────────────────────────────────

function completeTask(userId, taskKey) {
  const result = db.prepare(
    'INSERT OR IGNORE INTO user_tasks (user_id, task_key) VALUES (?, ?)'
  ).run(userId, taskKey);
  if (result.changes > 0) {
    const pts = TASK_POINTS[taskKey] || 2;
    updateUserPoints(userId, pts);
    addPointsLog(userId, pts, 'task', `完成任务：${TASK_LABELS[taskKey] || taskKey}`);
  }
}

function getUserTasks(userId) {
  return db.prepare(
    'SELECT task_key, created_at FROM user_tasks WHERE user_id = ?'
  ).all(userId);
}

// ── 邀请统计 ──────────────────────────────────────────────────────────

function getInviteStats(userId) {
  const inviteCount = db.prepare(
    'SELECT COUNT(*) as n FROM users WHERE invited_by = ?'
  ).get(userId).n;
  const invitePoints = db.prepare(
    "SELECT COALESCE(SUM(amount),0) as n FROM points_log WHERE user_id = ? AND type = 'invite'"
  ).get(userId).n;
  return { inviteCount, invitePoints };
}

module.exports = {
  db,
  // 用户
  createUser, verifyUser, updatePassword,
  getUserByPhone, getUserByUsername, getUserById, updateUserPoints, setPrivacyMode,
  updateNickname,
  // OTP（保留备用）
  saveOtp, verifyOtp,
  // 历史
  createSession, updateSessionTitle, getSessionsByUser, getSessionById, deleteSession,
  // 文件
  createDocument, getDocumentsBySession, getDocumentById, deleteDocument,
  // 积分
  addPointsLog, getPointsLog, addApiUsage, getUserPoints,
  // 订单
  createOrder, getOrders, getAllOrders, getOrdersStats,
  // 任务
  completeTask, getUserTasks,
  // 邀请
  getInviteStats,
  // 任务元数据（供 route 使用）
  TASK_POINTS, TASK_LABELS,
};
