'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../database');
const { requireAuth } = require('../middleware/auth');

const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'docs');

// GET /api/history
router.get('/', requireAuth, (req, res) => {
  const sessions = db.getSessionsByUser(req.user.id);
  res.json({ sessions });
});

// GET /api/history/:sid
router.get('/:sid', requireAuth, (req, res) => {
  const session = db.getSessionById(req.params.sid, req.user.id);
  if (!session) return res.status(404).json({ error: '记录不存在' });

  const docs = db.getDocumentsBySession(session.id, req.user.id);
  res.json({
    session: {
      ...session,
      input_snapshot: session.input_snapshot
        ? JSON.parse(session.input_snapshot)
        : null,
    },
    documents: docs,
  });
});

// DELETE /api/history/:sid
router.delete('/:sid', requireAuth, (req, res) => {
  const session = db.getSessionById(req.params.sid, req.user.id);
  if (!session) return res.status(404).json({ error: '记录不存在' });

  const docs = db.deleteSession(session.id, req.user.id);
  for (const doc of docs) {
    fs.unlink(path.join(STORAGE_DIR, doc.file_path), () => {});
  }
  res.json({ ok: true });
});

module.exports = router;
