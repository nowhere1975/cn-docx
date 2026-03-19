'use strict';

const { chat } = require('./llm');

const SYSTEM_PROMPT = `你是专业的中文文档撰写专家。根据用户提供的目标和要求，撰写一篇结构清晰、内容充实的文档。

## 输出格式要求
- 纯文本，不使用 Markdown（不用 #、**、- 等符号）
- 标题独立成行
- 一级标题用"一、二、三、"格式
- 二级标题用"（一）（二）（三）"格式
- 三级标题用"1. 2. 3."格式
- 正文段落首行不加缩进（系统会自动处理）
- 落款格式：单位名称单独一行，日期单独一行，右对齐风格
- 不要输出任何解释说明，直接输出文档正文`;

async function writeDocument(goal, requirements, mode, docType, providerId) {
  const docLabel = mode === 'official'
    ? `正式公文（文种：${docType || '通知'}）`
    : '通用文档';

  const userPrompt = `文档类型：${docLabel}
写作目标：${goal}
${requirements ? `具体要求：${requirements}` : ''}

请直接输出完整文档内容。`;

  return chat({
    providerId,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
}

module.exports = writeDocument;
