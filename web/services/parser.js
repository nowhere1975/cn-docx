'use strict';

const { chat } = require('./llm');

const SYSTEM_PROMPT = `你是专业的中文文档结构解析器。将用户输入的文本解析为用于生成 Word 文档的 JSON 结构。

## 解析规则

### 标题
- 文档开头最醒目的短句即为标题（title），通常独立成行，不要再放入 body

### body 节点层级与序号处理

**关键规则：number 字段只填裸序号，heading/text 字段必须去掉原文中的序号前缀，不能重复！**

- level:0 — 普通正文段落，只有 text 字段
- level:1 — 一级标题，以"一、二、三、"开头
  - number: 只填"一"（绝对不要带顿号，generate.js 会自动加）
  - heading: 去掉"一、"后的剩余文字
  - 错误示例：number:"一", heading:"一、标题文字" → 会渲染成"一、一、标题文字"
  - 正确示例：number:"一", heading:"标题文字"
- level:2 — 二级标题，以"（一）（二）"开头
  - number: 填"（一）"
  - heading: 去掉"（一）"后的剩余文字
  - 正确示例：number:"（一）", heading:"第一步：做某事"
- level:3 — 三级标题，以"1. 2."或"1、2、"开头
  - number: 填"1."
  - heading: 去掉序号后的标题部分；若后有正文则拆为 heading+text 两字段
- level:4 — 四级标题，以"（1）（2）"开头，number 填"（1）"
- Markdown 表格 — 以 `|` 分隔符构成的表格，输出为 `{ "type": "table", "headers": ["列1","列2",...], "rows": [["值","值",...], ...] }`，不需要 level 字段
  - 分隔行（`|---|---|`）不纳入 rows，只用于识别表格结构
- 附件说明（"附件：xxx"）放入 attachments 数组，不放 body

### 元信息提取
- org：落款单位名称
- date：落款日期，保持原字符串格式
- author：个人署名（通用文档用）
- recipient：主送机关，如"各部门、各单位："，保留末尾冒号
- doc_number：发文字号，如"某政发〔2026〕1号"
- 已提取为元信息的内容不要再重复放入 body

## 输出格式
只返回 JSON 对象，不要 Markdown 代码块，不要任何额外说明。

{
  "title": "文档标题",
  "org": null,
  "date": null,
  "author": null,
  "recipient": null,
  "doc_number": null,
  "body": [
    { "level": 0, "text": "普通段落示例" },
    { "type": "table", "headers": ["列1","列2"], "rows": [["值A","值B"]] }
  ],
  "attachments": []
}`;

async function parseContent(text, mode, style, docType, providerId, retry = 1) {
  const modeLabel = mode === 'official'
    ? `正式公文（文种：${docType || 'tongzhi'}，样式：${style || 'standard'}）`
    : '通用文档（工作总结/项目方案等）';

  let raw;
  try {
    raw = await chat({
      providerId,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{
        role:    'user',
        content: `文档模式：${modeLabel}\n\n---\n\n${text.trim()}`,
      }],
    });
  } catch (e) {
    throw new Error(`AI 调用失败：${e.message}`);
  }

  // 兼容 AI 偶尔返回 markdown 代码块的情况
  raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[parser] raw output:\n', raw.slice(0, 500));
    if (retry > 0) {
      console.warn('[parser] JSON 解析失败，自动重试…');
      return parseContent(text, mode, style, docType, providerId, retry - 1);
    }
    throw new Error(`AI 返回格式异常，请重试（${e.message}）`);
  }

  if (!Array.isArray(parsed.body) || parsed.body.length === 0)
    throw new Error('解析失败：未能从文本中识别出有效内容，请检查粘贴的内容是否完整');

  return parsed;
}

module.exports = parseContent;
