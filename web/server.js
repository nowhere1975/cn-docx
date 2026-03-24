'use strict';

require('dotenv').config({ override: true });
delete process.env.ANTHROPIC_AUTH_TOKEN;

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const authRouter    = require('./routes/auth');
const pointsRouter  = require('./routes/points');
const convertRouter = require('./routes/convert');
const generateRouter= require('./routes/generate');
const historyRouter = require('./routes/history');
const docsRouter    = require('./routes/docs');
const { router: adminRouter } = require('./routes/admin');
const { authMiddleware } = require('./middleware/auth');

const app       = express();
const PORT      = parseInt(process.env.PORT)      || 3000;
const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 80;

const BASE_PATH        = process.env.BASE_PATH        || '';
const TURNSTILE_SITEKEY = process.env.TURNSTILE_SITEKEY || '';

// 信任 nginx 反向代理，使 req.ip 拿到真实客户端 IP
app.set('trust proxy', 1);

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// 动态配置脚本：注入 BASE_PATH 和 Turnstile sitekey 到前端
app.get('/config.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(
    `window.BASE_PATH=${JSON.stringify(BASE_PATH)};` +
    `window.TURNSTILE_SITEKEY=${JSON.stringify(TURNSTILE_SITEKEY)};`
  );
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(authMiddleware);

app.use('/api/auth',     authRouter);
app.use('/api/points',   pointsRouter);
app.use('/api/convert',  convertRouter);
app.use('/api/generate', generateRouter);
app.use('/api/history',  historyRouter);
app.use('/api/docs',     docsRouter);
app.use('/api/admin',    adminRouter);

app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

const { SSL_CERT, SSL_KEY } = process.env;

if (SSL_CERT && SSL_KEY) {
  const https = require('https');
  const http  = require('http');
  const fs    = require('fs');

  // HTTP → HTTPS 重定向
  http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
  }).listen(HTTP_PORT, '0.0.0.0', () =>
    console.log(`↩️   HTTP 重定向  → :${HTTP_PORT}`)
  );

  const creds = { cert: fs.readFileSync(SSL_CERT), key: fs.readFileSync(SSL_KEY) };
  https.createServer(creds, app).listen(PORT, '0.0.0.0', () => {
    console.log(`✅  cn-docx web → https://localhost:${PORT}`);
    if (process.env.DOMAIN) console.log(`🌐  公网访问    → https://${process.env.DOMAIN}`);
  });
} else {
  app.listen(PORT, '0.0.0.0', () => {
    const { networkInterfaces } = require('os');
    const lan = Object.values(networkInterfaces()).flat()
      .find(n => n.family === 'IPv4' && !n.internal);
    console.log(`✅  cn-docx web → http://localhost:${PORT}`);
    if (lan) console.log(`🌐  局域网访问  → http://${lan.address}:${PORT}`);
  });
}
