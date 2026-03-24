'use strict';

const https = require('https');

const SECRET = process.env.TURNSTILE_SECRET || '';

function verifyToken(token, ip) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ secret: SECRET, response: token, remoteip: ip });
    const req = https.request({
      hostname: 'challenges.cloudflare.com',
      path: '/turnstile/v0/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function turnstileCheck(req, res, next) {
  // 未配置 secret（本地开发）或已登录用户 → 跳过
  if (!SECRET || req.user) return next();

  const token = req.body?.cfToken;
  if (!token) return res.status(400).json({ error: '请完成人机验证' });

  try {
    const result = await verifyToken(token, req.ip);
    if (!result.success) {
      return res.status(400).json({ error: '人机验证失败，请刷新后重试' });
    }
    next();
  } catch (e) {
    console.error('[turnstile] verify error:', e);
    next(); // 验证服务异常时放行，避免影响正常用户
  }
}

module.exports = { turnstileCheck };
