'use strict';
// 数据库迁移脚本，一次性执行
// SQLite 注意：RENAME TABLE 会自动更新其他表的 FK 引用，
// 必须先 PRAGMA legacy_alter_table = ON 才能安全重命名。
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('foreign_keys = OFF');
db.pragma('legacy_alter_table = ON');  // 重要：防止 rename 更新 FK 引用

const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all().map(r => r.name);

console.log('现有表：', existing.join(', '));

// 1. 迁移 users 表
if (existing.includes('users')) {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(r => r.name);

  if (cols.includes('email') && !cols.includes('phone')) {
    console.log('迁移 users 表：email → phone …');
    db.exec(`
      ALTER TABLE users RENAME TO users_bak;

      CREATE TABLE users (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        phone        TEXT UNIQUE NOT NULL,
        nickname     TEXT,
        points       INTEGER DEFAULT 10,
        privacy_mode INTEGER DEFAULT 0,
        created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, phone, nickname, points, created_at, updated_at)
        SELECT id, email, nickname, points, created_at, updated_at FROM users_bak;

      DROP TABLE users_bak;
    `);
    console.log('  ✅ users 迁移完成（旧 email 值保留为 phone 占位）');

  } else if (cols.includes('phone') && !cols.includes('privacy_mode')) {
    db.exec('ALTER TABLE users ADD COLUMN privacy_mode INTEGER DEFAULT 0;');
    console.log('  ✅ 已添加 privacy_mode 列');

  } else {
    console.log('  users 表结构已是最新，跳过');
  }
}

// 2. 新增表
const newTables = {
  otp_codes: `CREATE TABLE otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL, code TEXT NOT NULL,
    expires_at DATETIME NOT NULL, used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  sessions: `CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, title TEXT,
    mode TEXT NOT NULL, style TEXT, doc_type TEXT,
    input_snapshot TEXT, privacy INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  documents: `CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    filename TEXT NOT NULL, file_path TEXT NOT NULL,
    file_size INTEGER, version INTEGER DEFAULT 1, privacy INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
};

for (const [name, sql] of Object.entries(newTables)) {
  if (!existing.includes(name)) {
    db.exec(sql);
    console.log(`✅ 创建表 ${name}`);
  } else {
    console.log(`  ${name} 已存在，跳过`);
  }
}

db.pragma('foreign_keys = ON');
console.log('\n迁移完成！');
db.close();
