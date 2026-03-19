'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

// ── 建表 ──────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT UNIQUE NOT NULL,
    nickname     TEXT,
    points       INTEGER DEFAULT 10,
    privacy_mode INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
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
`);

// ── 用户 ──────────────────────────────────────────────────────────────

function createUser(phone, nickname) {
  const stmt = db.prepare(`
    INSERT INTO users (phone, nickname, points)
    VALUES (?, ?, 10)
  `);
  const result = stmt.run(phone, nickname || phone.slice(-4));
  addPointsLog(result.lastInsertRowid, 10, 'bonus', '新用户注册赠送');
  return result.lastInsertRowid;
}

function getUserByPhone(phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
}

function getUserById(id) {
  return db.prepare(
    'SELECT id, phone, nickname, points, privacy_mode, created_at FROM users WHERE id = ?'
  ).get(id);
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

module.exports = {
  db,
  // 用户
  createUser, getUserByPhone, getUserById, updateUserPoints, setPrivacyMode,
  // OTP
  saveOtp, verifyOtp,
  // 历史
  createSession, updateSessionTitle, getSessionsByUser, getSessionById, deleteSession,
  // 文件
  createDocument, getDocumentsBySession, getDocumentById, deleteDocument,
  // 积分
  addPointsLog, getPointsLog, addApiUsage, getUserPoints,
};
