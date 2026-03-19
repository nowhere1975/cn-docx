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

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
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
