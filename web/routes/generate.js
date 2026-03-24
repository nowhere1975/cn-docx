'use strict';

const express       = require('express');
const router        = express.Router();
const os            = require('os');
const path          = require('path');
const fs            = require('fs');
const { generate }  = require('../../generate.js');
const writeDocument = require('../services/writer');
const parseContent  = require('../services/parser');
const db            = require('../database');
const { requirePoints } = require('../middleware/auth');
const { turnstileCheck } = require('../middleware/turnstile');
const { generateHourLimit, generateDayLimit } = require('../middleware/rateLimiter');
const { dailyBudget } = require('../middleware/budget');

const DOC_TYPE_NAMES = {
  tongzhi: '通知', tongbao: '通报', qingshi: '请示', han: '函',
  baogao:  '报告', jiyao:   '纪要', jianghua: '讲话稿', fangan: '方案',
};

const POINTS_COST = 5;
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'docs');

router.post(
  '/',
  generateHourLimit,
  generateDayLimit,
  turnstileCheck,
  dailyBudget,
  async (req, res) => {
    // 已登录用户额外检查积分
    if (req.user && req.user.points < POINTS_COST) {
      return res.status(403).json({
        error: '积分不足',
        code: 'INSUFFICIENT_POINTS',
        required: POINTS_COST,
        current: req.user.points,
      });
    }

    const { goal, requirements, mode, style, docType, overrides = {} } = req.body;

    if (!goal || typeof goal !== 'string' || goal.trim().length < 4)
      return res.status(400).json({ error: '请描述你想生成的文档目标' });

    if (goal.length > 500)
      return res.status(400).json({ error: '写作目标不能超过 500 字' });

    if (requirements && requirements.length > 1000)
      return res.status(400).json({ error: '具体要求不能超过 1000 字' });

    if (!['general', 'official'].includes(mode))
      return res.status(400).json({ error: '文档类型参数无效' });

    // 游客强制隐私模式（不落盘），已登录用户遵从自身设置
    const isGuest = !req.user;
    const privacy = isGuest || req.user.privacy_mode === 1;

    const tmpPath = path.join(os.tmpdir(), `docx-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`);

    try {
      const text    = await writeDocument(goal, requirements, mode, docType);
      const parsed  = await parseContent(text, mode, style, docType);
      const content = { ...parsed };
      if (overrides.org)       content.org       = overrides.org;
      if (overrides.date)      content.date      = overrides.date;
      if (overrides.author)    content.author    = overrides.author;
      if (overrides.recipient) content.recipient = overrides.recipient;

      const opts = { mode, outputPath: tmpPath, content };
      if (mode === 'official') {
        opts.style   = style   || 'standard';
        opts.docType = docType || 'tongzhi';
      }
      await generate(opts);

      let sessionId = null;
      let docId     = null;

      if (!isGuest) {
        db.updateUserPoints(req.user.id, -POINTS_COST);
        db.addPointsLog(req.user.id, -POINTS_COST, 'consume', 'AI 生成');
        db.addApiUsage(req.user.id, 'generate', POINTS_COST);
        db.completeTask(req.user.id, mode === 'official' ? 'first_official' : 'first_generate');
      }

      const label    = mode === 'official' ? (DOC_TYPE_NAMES[docType] || '公文') : '文档';
      const filename = `${content.title || label}.docx`;

      if (!privacy) {
        const userDir  = path.join(STORAGE_DIR, String(req.user.id));
        fs.mkdirSync(userDir, { recursive: true });
        const savedName = `${Date.now()}-${Math.random().toString(36).slice(2)}.docx`;
        const savedPath = path.join(userDir, savedName);
        fs.copyFileSync(tmpPath, savedPath);
        const stat = fs.statSync(savedPath);

        sessionId = db.createSession(req.user.id, {
          title: content.title || label,
          mode, style, docType,
          inputSnapshot: { goal, requirements: requirements?.slice(0, 500), overrides },
          privacy: false,
        });

        docId = db.createDocument(sessionId, req.user.id, {
          filename,
          filePath: path.join(String(req.user.id), savedName),
          fileSize: stat.size,
          privacy:  false,
        });
      }

      res.setHeader('X-Session-Id', sessionId ?? '');
      res.setHeader('X-Doc-Id',     docId ?? '');
      res.download(tmpPath, filename, (err) => {
        fs.unlink(tmpPath, () => {});
        if (err && !res.headersSent)
          res.status(500).json({ error: '文件发送失败' });
      });

    } catch (err) {
      fs.unlink(tmpPath, () => {});
      console.error('[generate]', err);
      res.status(500).json({ error: err.message || '生成失败，请稍后重试' });
    }
  }
);

module.exports = router;
