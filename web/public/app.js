'use strict';

if (window.marked) marked.use({ breaks: true });

// ── 部署配置（由 config.js 注入） ────────────────────────────────────
const BASE = window.BASE_PATH || '';

// ── Turnstile 不可见验证 ──────────────────────────────────────────────
let _tsToken    = null;
let _tsWidgetId = null;
let _tsResolve  = null;

function _initTurnstile() {
  if (!window.turnstile || !window.TURNSTILE_SITEKEY) return;
  _tsWidgetId = turnstile.render('#cf-turnstile', {
    sitekey: window.TURNSTILE_SITEKEY,
    size: 'invisible',
    callback: (token) => {
      _tsToken = token;
      if (_tsResolve) { _tsResolve(token); _tsResolve = null; }
    },
    'expired-callback': () => { _tsToken = null; },
    'error-callback':   () => {
      _tsToken = null;
      if (_tsResolve) { _tsResolve(null); _tsResolve = null; }
    },
  });
  turnstile.execute(_tsWidgetId);
}

// 获取一次性 token；若尚未就绪则等待（最多 10s）
function _getCfToken() {
  if (!window.TURNSTILE_SITEKEY) return Promise.resolve(null);
  // SDK 已加载但 widget 尚未初始化（用户比 onload 回调更早点击）→ 补初始化
  if (!_tsWidgetId && window.turnstile) _initTurnstile();
  if (!_tsWidgetId) return Promise.resolve(null);
  if (_tsToken) {
    const t = _tsToken;
    _tsToken = null;
    // 立刻预取下一个
    try { turnstile.reset(_tsWidgetId); turnstile.execute(_tsWidgetId); } catch (_) {}
    return Promise.resolve(t);
  }
  return new Promise((resolve) => {
    _tsResolve = resolve;
    setTimeout(() => { if (_tsResolve) { _tsResolve(null); _tsResolve = null; } }, 10000);
    try { turnstile.execute(_tsWidgetId); } catch (_) {}
  });
}

// ── 状态 ──────────────────────────────────────────────────────────────
let mode     = 'general';
let source   = 'paste';
let mdMode   = false;
let accordionOpen = false;
let blobUrl  = null;
let lastBlob = null;
let docxPreviewExpanded = true;
let loadingTimer = null;
let genStartTime = null;

let currentUser  = null;
let currentSession = null; // 当前 session（历史记录用）
let selectedRechargeAmount = 0;

// OTP 登录流程状态
let otpSent     = false;
let otpCountdown = null;
let otpPhone    = '';

const NO_RECIPIENT_TYPES = new Set(['baogao', 'jiyao', 'jianghua', 'fangan']);

const SOURCE_LABELS = {
  paste: 'AI 排版',
  ai:    'AI 生成',
};

// ══════════════════════════════════════════════════════════════════════
// 侧边栏 & 移动端
// ══════════════════════════════════════════════════════════════════════

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ══════════════════════════════════════════════════════════════════════
// 模式选择（左侧栏）
// ══════════════════════════════════════════════════════════════════════

// 左侧栏：切换排版/生成
function selectSource(el) {
  document.querySelectorAll('.mode-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  source = el.dataset.source;

  document.getElementById('mainTitle').textContent = SOURCE_LABELS[source] || '';
  document.getElementById('pasteArea').style.display = source === 'paste' ? '' : 'none';
  document.getElementById('aiArea').classList.toggle('show', source === 'ai');
  document.getElementById('genBtn').textContent =
    source === 'ai' ? 'AI 生成 Word 文档' : '生成 Word 文档';

  if (window.innerWidth <= 640) closeSidebar();
}

// 中间区：切换通用/正式公文
function selectDocMode(val) {
  mode = val;
  document.getElementById('cardGeneral').classList.toggle('active', val === 'general');
  document.getElementById('cardOfficial').classList.toggle('active', val === 'official');
  document.querySelector('#cardGeneral input').checked  = val === 'general';
  document.querySelector('#cardOfficial input').checked = val === 'official';
  document.getElementById('officialInline').style.display = val === 'official' ? '' : 'none';
  updateRecipientVisibility();
}

function onDocTypeChange() { updateRecipientVisibility(); }

function updateRecipientVisibility() {
  const docType = document.getElementById('docTypeS').value;
  const hide = mode === 'general' || NO_RECIPIENT_TYPES.has(docType);
  document.getElementById('recipientField').style.display = hide ? 'none' : '';
}

// ══════════════════════════════════════════════════════════════════════
// 新建会话
// ══════════════════════════════════════════════════════════════════════

function newSession() {
  currentSession = null;
  // 清空输入
  document.getElementById('content').value = '';
  document.getElementById('goalI').value   = '';
  document.getElementById('reqI').value    = '';
  document.getElementById('orgI').value    = '';
  document.getElementById('dateI').value   = '';
  document.getElementById('authorI').value = '';
  document.getElementById('recipientI').value = '';
  document.getElementById('charCount').textContent = '0 字';
  updateAccordionHint();
  // 清空右侧面板
  clearPanel();
  // 清空中间反馈
  document.getElementById('feedback').innerHTML = '';
  // 取消历史高亮
  document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
  if (window.innerWidth <= 640) closeSidebar();
}

// ══════════════════════════════════════════════════════════════════════
// Accordion 补充信息
// ══════════════════════════════════════════════════════════════════════

function toggleAccordion() {
  accordionOpen = !accordionOpen;
  document.getElementById('accordionTrigger').classList.toggle('open', accordionOpen);
  document.getElementById('accordionBody').classList.toggle('show', accordionOpen);
}

function updateAccordionHint() {
  const parts = [
    document.getElementById('orgI').value.trim(),
    document.getElementById('dateI').value.trim(),
    document.getElementById('authorI').value.trim(),
    document.getElementById('recipientI').value.trim(),
  ].filter(Boolean);

  const hint = document.getElementById('accordionHint');
  if (parts.length > 0) {
    hint.textContent = parts.join(' · ');
    hint.style.display = '';
  } else {
    hint.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════════════════
// Markdown 预览
// ══════════════════════════════════════════════════════════════════════

const ta = document.getElementById('content');
ta.addEventListener('input', () => {
  const n = ta.value.length;
  document.getElementById('charCount').textContent = n.toLocaleString('zh-CN') + ' 字';
  const btn = document.getElementById('mdToggleBtn');
  if (n > 20 && looksLikeMarkdown(ta.value)) {
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
    if (mdMode) exitMdMode();
  }
});

function looksLikeMarkdown(text) {
  return /(?:^|\n)#{1,6} /.test(text) ||
    /\*\*[^*\n]+\*\*/.test(text)      ||
    /(?:^|\n)[ \t]*[-*+] +\S/.test(text) ||
    /```/.test(text);
}

function toggleMdMode() { mdMode ? exitMdMode() : enterMdMode(); }

function enterMdMode() {
  if (!window.marked) return;
  mdMode = true;
  const preview = document.getElementById('mdPreview');
  preview.innerHTML = marked.parse(ta.value);
  ta.style.display = 'none';
  preview.style.display = 'block';
  const btn = document.getElementById('mdToggleBtn');
  btn.textContent = '编辑';
  btn.classList.add('active');
}

function exitMdMode() {
  mdMode = false;
  document.getElementById('mdPreview').style.display = 'none';
  ta.style.display = '';
  const btn = document.getElementById('mdToggleBtn');
  btn.textContent = '预览 Markdown';
  btn.classList.remove('active');
}

// ══════════════════════════════════════════════════════════════════════
// 生成文档
// ══════════════════════════════════════════════════════════════════════

async function handleGen() {
  if (source === 'ai') await handleAiGen();
  else                 await handlePasteGen();
}

async function handlePasteGen() {
  const text = ta.value.trim();
  if (!text || text.length < 10) return showErr('请先粘贴有效的文档内容（至少10个字符）');
  await callApi(BASE + '/api/convert', {
    text, mode,
    style:   mode === 'official' ? document.getElementById('styleS').value   : undefined,
    docType: mode === 'official' ? document.getElementById('docTypeS').value : undefined,
    overrides: getOverrides(),
  });
}

async function handleAiGen() {
  const goal = document.getElementById('goalI').value.trim();
  if (!goal) return showErr('请填写文档目标');
  await callApi(BASE + '/api/generate', {
    goal,
    requirements: document.getElementById('reqI').value.trim() || undefined,
    mode,
    style:   mode === 'official' ? document.getElementById('styleS').value   : undefined,
    docType: mode === 'official' ? document.getElementById('docTypeS').value : undefined,
    overrides: getOverrides(),
  });
}

function getOverrides() {
  const o = {};
  const v = (id) => document.getElementById(id).value.trim();
  if (v('orgI'))       o.org       = v('orgI');
  if (v('dateI'))      o.date      = v('dateI');
  if (v('authorI'))    o.author    = v('authorI');
  if (v('recipientI')) o.recipient = v('recipientI');
  return o;
}

async function callApi(url, payload) {
  setLoading(true);
  document.getElementById('feedback').innerHTML = '';
  genStartTime = Date.now();

  try {
    // 获取 Turnstile token（游客模式保护，已登录用户服务端会跳过）
    const cfToken = await _getCfToken();
    if (cfToken) payload = { ...payload, cfToken };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (resp.status === 429) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || '请求过于频繁，请稍后再试');
    }
    if (resp.status === 503) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || '今日配额已用完，明天再来');
    }
    if (resp.status === 401) {
      showAuthModal();
      throw new Error('请先登录');
    }
    if (resp.status === 403) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.code === 'INSUFFICIENT_POINTS'
        ? `积分不足！需要 ${err.required} 分，当前 ${err.current} 分`
        : (err.error || '积分不足，请充值'));
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || '请求失败');
    }

    // 读取 session/doc 信息
    const sid = resp.headers.get('X-Session-Id');
    const did = resp.headers.get('X-Doc-Id');

    const disp = resp.headers.get('content-disposition') || '';
    const starMatch  = disp.match(/filename\*=UTF-8''([^;\r\n]+)/i);
    const plainMatch = disp.match(/filename="([^"]+)"/i);
    let fname = '文档.docx';
    if (starMatch)       fname = decodeURIComponent(starMatch[1]);
    else if (plainMatch) fname = plainMatch[1];

    const blob = await resp.blob();
    lastBlob = blob;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);

    const elapsed = ((Date.now() - genStartTime) / 1000).toFixed(1);

    // 更新右侧面板
    showDocResult(fname, blobUrl, blob.size, elapsed);

    // 如有 session 记录，刷新历史 + 更新版本列表
    if (sid) {
      currentSession = { id: sid, docId: did };
      await loadHistory();
      await loadVersions(sid);
    }

    // 更新积分显示
    await refreshUserPoints();

  } catch (e) {
    showErr(e.message || '生成失败，请重试');
  } finally {
    setLoading(false);
  }
}

// ══════════════════════════════════════════════════════════════════════
// 右侧面板
// ══════════════════════════════════════════════════════════════════════

function clearPanel() {
  document.getElementById('panelEmpty').style.display = '';
  document.getElementById('docResult').style.display  = 'none';
  document.getElementById('versionSection').style.display = 'none';
  document.getElementById('docxPreviewBody').innerHTML = '';
  previewRendered = false;
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
  lastBlob = null;
}

function showDocResult(fname, url, sizeBytes, elapsedSec) {
  previewRendered = false;
  document.getElementById('panelEmpty').style.display = 'none';
  document.getElementById('docResult').style.display  = '';

  document.getElementById('docResultName').textContent = fname;
  const meta = [
    sizeBytes  ? fmtSize(sizeBytes)   : null,
    elapsedSec ? elapsedSec + 's'     : null,
  ].filter(Boolean).join(' · ');
  document.getElementById('docResultMeta').textContent = meta;

  const dlBtn = document.getElementById('docDownloadBtn');
  dlBtn.href = url;
  dlBtn.download = fname;
}

async function loadVersions(sessionId) {
  if (!sessionId || !currentUser) return;
  try {
    const resp = await fetch(`${BASE}/api/history/${sessionId}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const docs = data.documents || [];
    if (docs.length <= 1) {
      document.getElementById('versionSection').style.display = 'none';
      return;
    }
    document.getElementById('versionSection').style.display = '';
    document.getElementById('versionList').innerHTML = docs.map((d, idx) => {
      const isLast = idx === docs.length - 1;
      const date = formatRelTime(d.created_at);
      return `
        <div class="version-item ${isLast ? 'active' : ''}" onclick="downloadVersion(${d.id}, '${esc(d.filename)}')">
          <span class="version-badge">v${d.version}</span>
          <div class="version-info">
            <div class="version-date">${date}</div>
          </div>
          <button class="version-dl" onclick="event.stopPropagation();downloadVersion(${d.id}, '${esc(d.filename)}')">下载</button>
        </div>
      `;
    }).join('');
  } catch (e) {
    // ignore
  }
}

async function downloadVersion(docId, filename) {
  const a = document.createElement('a');
  a.href = `${BASE}/api/docs/${docId}/download`;
  a.download = filename;
  a.click();
}

// docx 预览：生成后缓存 blob，点击预览按钮时渲染
let previewRendered = false;

async function openDocxPreview() {
  if (!lastBlob) return;
  const overlay = document.getElementById('docxModalOverlay');
  const fname   = document.getElementById('docResultName').textContent;
  document.getElementById('docxModalTitle').textContent = fname || '文档预览';
  overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';

  if (!previewRendered) {
    await renderDocxPreview(lastBlob);
    previewRendered = true;
  }
}

function closeDocxPreview() {
  document.getElementById('docxModalOverlay').classList.remove('visible');
  document.body.style.overflow = '';
}

function onDocxOverlayClick(e) {
  if (e.target === document.getElementById('docxModalOverlay')) closeDocxPreview();
}

async function renderDocxPreview(blob) {
  if (!window.docx) return;
  const body = document.getElementById('docxPreviewBody');
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">正在渲染预览…</div>';
  try {
    await docx.renderAsync(blob, body, null, {
      className: 'docx', ignoreWidth: false, breakPages: true, useBase64URL: true,
    });
  } catch (e) {
    body.innerHTML = `<div style="padding:20px;font-size:13px;color:var(--muted)">预览渲染失败，请直接下载文件查看</div>`;
  }
}

// ══════════════════════════════════════════════════════════════════════
// Loading & 反馈
// ══════════════════════════════════════════════════════════════════════

function setLoading(on) {
  const btn   = document.getElementById('genBtn');
  const track = document.getElementById('progressTrack');
  btn.disabled = on;
  track.classList.toggle('visible', on);
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
  if (on) {
    if (source === 'ai') {
      btn.innerHTML = `<span class="spinner"></span>AI 正在撰写稿件…`;
      loadingTimer = setTimeout(() => {
        if (btn.disabled) btn.innerHTML = `<span class="spinner"></span>AI 正在排版结构…`;
      }, 9000);
    } else {
      btn.innerHTML = `<span class="spinner"></span>正在排版结构…`;
    }
  } else {
    btn.textContent = source === 'ai' ? 'AI 生成 Word 文档' : '生成 Word 文档';
  }
}

function showErr(msg) {
  document.getElementById('feedback').innerHTML = `
    <div class="errbox">
      <span class="errbox-icon">⚠️</span>
      <span class="errbox-msg">${esc(msg)}</span>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════
// 历史记录
// ══════════════════════════════════════════════════════════════════════

async function loadHistory() {
  if (!currentUser) {
    document.getElementById('historyList').innerHTML =
      '<div class="history-empty">登录后查看历史记录</div>';
    return;
  }
  if (currentUser.privacy_mode) {
    document.getElementById('historyList').innerHTML =
      '<div class="history-locked">🔒 隐私模式开启中<br>历史记录不被保存</div>';
    return;
  }
  try {
    const resp = await fetch(`${BASE}/api/history`);
    const data = await resp.json();
    renderHistory(data.sessions || []);
  } catch (e) {
    // ignore
  }
}

function renderHistory(sessions) {
  const list = document.getElementById('historyList');
  if (!sessions.length) {
    list.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    return;
  }
  // 按日期分组
  const groups = {};
  sessions.forEach(s => {
    const label = dayLabel(s.created_at);
    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  });

  list.innerHTML = Object.entries(groups).map(([label, items]) => `
    <div class="history-group-label">${label}</div>
    ${items.map(s => `
      <div class="history-item ${currentSession?.id == s.id ? 'active' : ''}"
           id="hist-${s.id}" onclick="loadSessionToPanel(${s.id})">
        <span class="history-item-title">${esc(s.title || '未命名文档')}</span>
        <button class="history-item-del" onclick="deleteSession(event, ${s.id})" title="删除">×</button>
      </div>
    `).join('')}
  `).join('');
}

async function loadSessionToPanel(sessionId) {
  document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
  const el = document.getElementById(`hist-${sessionId}`);
  if (el) el.classList.add('active');

  try {
    const resp = await fetch(`${BASE}/api/history/${sessionId}`);
    const data = await resp.json();
    const docs  = data.documents || [];
    if (!docs.length) return;

    const latest = docs[docs.length - 1];
    currentSession = { id: sessionId };

    // 展示最新文件
    document.getElementById('panelEmpty').style.display = 'none';
    document.getElementById('docResult').style.display  = '';
    document.getElementById('docResultName').textContent = latest.filename;
    document.getElementById('docResultMeta').textContent = fmtSize(latest.file_size || 0);

    const dlBtn = document.getElementById('docDownloadBtn');
    dlBtn.href     = `${BASE}/api/docs/${latest.id}/download`;
    dlBtn.download = latest.filename;
    dlBtn.onclick  = null;

    // 版本列表
    await loadVersions(sessionId);

    // 清空 docx 预览（不自动渲染历史文件，避免不必要的请求）
    document.getElementById('docxPreviewBody').innerHTML = '';
    document.getElementById('docxPreviewWrap').style.display = 'none';
  } catch (e) {
    // ignore
  }
}

async function deleteSession(e, sessionId) {
  e.stopPropagation();
  if (!confirm('确认删除这条记录及其所有文件？')) return;
  try {
    await fetch(`${BASE}/api/history/${sessionId}`, { method: 'DELETE' });
    if (currentSession?.id == sessionId) {
      currentSession = null;
      clearPanel();
    }
    await loadHistory();
  } catch (err) {
    // ignore
  }
}

// ══════════════════════════════════════════════════════════════════════
// 认证（用户名 + 密码）
// ══════════════════════════════════════════════════════════════════════

function showAuthModal() {
  document.getElementById('authUsername').value = '';
  document.getElementById('authPassword').value = '';
  const err = document.getElementById('authErr');
  err.style.display = 'none';
  err.textContent = '';
  document.getElementById('authSubmitBtn').disabled = false;
  document.getElementById('authSubmitBtn').textContent = '登录';
  document.getElementById('authModal').classList.add('visible');
  setTimeout(() => document.getElementById('authUsername').focus(), 200);
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('visible');
}

async function handleLogin() {
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authErr');
  errEl.style.display = 'none';

  if (!username || !password) {
    errEl.textContent = '请输入用户名和密码';
    errEl.style.display = '';
    return;
  }

  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  btn.textContent = '登录中…';

  try {
    const resp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error);

    currentUser = data.user;
    closeAuthModal();
    updateSidebarUser();
    await loadHistory();
  } catch (e) {
    errEl.textContent = e.message || '登录失败';
    errEl.style.display = '';
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

// 回车快捷键
document.getElementById('authUsername').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('authPassword').focus();
});
document.getElementById('authPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

async function handleLogout() {
  await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
  currentUser = null;
  currentSession = null;
  updateSidebarUser();
  loadHistory();
}

// ══════════════════════════════════════════════════════════════════════
// 隐私模式
// ══════════════════════════════════════════════════════════════════════

async function togglePrivacy() {
  if (!currentUser) {
    showAuthModal();
    return;
  }
  const newMode = currentUser.privacy_mode ? 0 : 1;
  try {
    const resp = await fetch(`${BASE}/api/auth/privacy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privacy_mode: newMode }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error);
    currentUser.privacy_mode = data.privacy_mode;
    applyPrivacyUI();
    await loadHistory();
  } catch (e) {
    // 回滚 toggle
    document.getElementById('privacyToggle').checked = !!currentUser.privacy_mode;
  }
}

function applyPrivacyUI() {
  const on = !!currentUser?.privacy_mode;
  document.getElementById('privacyToggle').checked = on;
  document.getElementById('privacyBanner').classList.toggle('show', on);
}

// ══════════════════════════════════════════════════════════════════════
// 侧边栏用户区
// ══════════════════════════════════════════════════════════════════════

function updateSidebarUser() {
  const el = document.getElementById('sidebarUser');
  if (!currentUser) {
    el.innerHTML = `<button class="btn-sidebar-login" onclick="showAuthModal()">登录</button>`;
    return;
  }
  const name = currentUser.nickname || currentUser.username || '';
  el.innerHTML = `
    <div class="user-row">
      <span class="points-chip">⭐ ${currentUser.points}</span>
      <span class="sidebar-user-name">${esc(name)}</span>
    </div>
    <div class="user-row" style="gap:6px;padding-top:0">
      <button class="btn-sidebar-sm" onclick="showPointsLog()" style="flex:1">积分记录</button>
      <button class="btn-sidebar-sm" onclick="handleLogout()">退出</button>
    </div>
  `;
}

async function refreshUserPoints() {
  if (!currentUser) return;
  try {
    const resp = await fetch(`${BASE}/api/auth/me`);
    const data = await resp.json();
    if (data.user) {
      currentUser = data.user;
      updateSidebarUser();
    }
  } catch (e) {}
}


// ══════════════════════════════════════════════════════════════════════
// 积分记录
// ══════════════════════════════════════════════════════════════════════

async function showPointsLog() {
  try {
    const resp = await fetch(`${BASE}/api/points/log`);
    const data = await resp.json();
    const list = document.getElementById('pointsLogList');
    if (!data.logs?.length) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">暂无记录</div>';
    } else {
      list.innerHTML = data.logs.map(log => {
        const pos  = log.amount > 0;
        const icon = log.type === 'recharge' ? '💰' : log.type === 'bonus' ? '🎁' : '📝';
        const cls  = log.type === 'recharge' ? 'recharge' : log.type === 'bonus' ? 'bonus' : 'consume';
        const date = formatRelTime(log.created_at);
        return `
          <div class="log-item">
            <div class="log-icon ${cls}">${icon}</div>
            <div class="log-info">
              <div class="log-desc">${esc(log.description || log.type)}</div>
              <div class="log-date">${date}</div>
            </div>
            <div class="log-amount ${pos ? 'positive' : 'negative'}">${pos ? '+' : ''}${log.amount}</div>
          </div>`;
      }).join('');
    }
    document.getElementById('pointsLogModal').classList.add('visible');
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════════════

function fmtSize(bytes) {
  if (bytes < 1024)      return bytes + ' B';
  if (bytes < 1048576)   return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dayLabel(isoStr) {
  const d    = new Date(isoStr);
  const now  = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7)  return `${diff} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatRelTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function closeModal(id) {
  document.getElementById(id).classList.remove('visible');
}

// 点击遮罩关闭弹窗
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('visible');
  }
});

// ══════════════════════════════════════════════════════════════════════
// 初始化
// ══════════════════════════════════════════════════════════════════════

async function init() {
  document.getElementById('mainTitle').textContent = SOURCE_LABELS[source] || '';
  updateRecipientVisibility();

  try {
    const resp = await fetch(`${BASE}/api/auth/me`);
    const data = await resp.json();
    if (data.user) {
      currentUser = data.user;
      updateSidebarUser();
      applyPrivacyUI();
      await loadHistory();
    }
  } catch (e) {}
}

init();
