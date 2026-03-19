'use strict';

const fs   = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const CONFIG_PATH = path.join(__dirname, '..', 'model-config.json');

const DEFAULT_CONFIG = {
  providers: [
    {
      id:        'anthropic-default',
      name:      'Claude (Anthropic)',
      baseURL:   'https://api.anthropic.com/v1',
      apiKey:    process.env.ANTHROPIC_API_KEY || '',
      model:     'claude-haiku-4-5-20251001',
      enabled:   true,
      isDefault: true,
    },
  ],
};

// ── 配置读写 ───────────────────────────────────────────────────────────

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return DEFAULT_CONFIG;
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ── 获取默认 provider ──────────────────────────────────────────────────

function getDefaultProvider() {
  const cfg = readConfig();
  const providers = cfg.providers || [];
  return (
    providers.find(p => p.isDefault && p.enabled) ||
    providers.find(p => p.enabled) ||
    providers[0] ||
    DEFAULT_CONFIG.providers[0]
  );
}

// ── 获取指定 provider ──────────────────────────────────────────────────

function getProvider(id) {
  const cfg = readConfig();
  return (cfg.providers || []).find(p => p.id === id) || null;
}

// ── 创建 OpenAI-compatible 客户端 ─────────────────────────────────────

function createClient(provider) {
  return new OpenAI({
    baseURL: provider.baseURL,
    apiKey:  provider.apiKey || 'placeholder', // 某些本地服务不需要 key
    defaultHeaders: provider.extraHeaders || {},
  });
}

// ── 统一调用入口 ───────────────────────────────────────────────────────

async function chat({ providerId, messages, systemPrompt, maxTokens = 4096 }) {
  const provider = providerId ? getProvider(providerId) : getDefaultProvider();
  if (!provider) throw new Error('没有可用的 AI 模型，请在管理后台配置');

  if (!provider.apiKey) throw new Error(`Provider「${provider.name}」未配置 API Key，请在管理后台 → 模型设置 中填写`);
  const client = createClient(provider);

  const msgs = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const resp = await client.chat.completions.create({
    model:      provider.model,
    max_tokens: maxTokens,
    messages:   msgs,
  });

  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error('AI 未返回内容');
  return text.trim();
}

// ── 给 admin 路由用的安全格式（隐藏 apiKey） ──────────────────────────

function safeProvider(p) {
  const key = p.apiKey || '';
  return {
    ...p,
    apiKey: key.length > 8
      ? key.slice(0, 4) + '****' + key.slice(-4)
      : key ? '****' : '',
  };
}

module.exports = { readConfig, writeConfig, getDefaultProvider, getProvider, chat, safeProvider };
