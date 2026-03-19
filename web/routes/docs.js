'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const db      = require('../database');
const { requireAuth } = require('../middleware/auth');

const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'docs');

// GET /api/docs/:docId/download
router.get('/:docId/download', requireAuth, (req, res) => {
  const doc = db.getDocumentById(req.params.docId, req.user.id);
  if (!doc) return res.status(404).json({ error: '文件不存在' });

  const fullPath = path.join(STORAGE_DIR, doc.file_path);
  if (!fs.existsSync(fullPath))
    return res.status(404).json({ error: '文件已被删除' });

  res.download(fullPath, doc.filename);
});

// DELETE /api/docs/:docId
router.delete('/:docId', requireAuth, (req, res) => {
  const doc = db.deleteDocument(req.params.docId, req.user.id);
  if (!doc) return res.status(404).json({ error: '文件不存在' });

  fs.unlink(path.join(STORAGE_DIR, doc.file_path), () => {});
  res.json({ ok: true });
});

module.exports = router;
