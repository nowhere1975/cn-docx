# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies (only docx@^9)
node test.js         # run all tests; outputs to ./test-output/
node generate.js     # run the built-in example (general mode work summary)
```

Tests pass when all generated `.docx` files are >1KB. No assertion library is used — failures print `❌` lines.

## Architecture

This is a single-file Node.js library (`generate.js`) that wraps the `docx` npm package to produce Chinese Word documents conforming to GB/T 9704-2012.

### Core export

```js
const { generate, dateToChinese, dateToArabic } = require('./generate.js');
```

`generate(opts)` is async and returns the output path. `dateToChinese('YYYY-MM-DD')` converts ISO dates to Chinese numeral form (e.g. `二〇二六年三月十五日`). `dateToArabic('YYYY-MM-DD')` converts to Arabic form without zero-padding (e.g. `2026年3月15日`).

### Two document modes

**`official`** — formal government documents (通知/报告/请示/函/纪要/讲话稿/方案)
- GB/T 9704-2012 margins: top 3.7cm, bottom 3.5cm, left 2.8cm, right 2.6cm
- Fixed line spacing (~29pt) ensures 22 lines per page
- Page number style: `— N —` (宋体四号, odd pages right, even pages left)
- Two sub-styles:
  - `standard` — 宋体 bold title, 宋体 body, no red header; h2 uses 宋体加粗
  - `strict` — 方正小标宋 title + 仿宋_GB2312 body + red header (org + doc_number) + 版记 (footer records); h2 uses 楷体
- `docType` controls whether `recipient` is rendered (报告/纪要/讲话稿/方案 suppress it)

**`general`** — internal documents (工作总结/项目方案 etc.)
- Standard Word margins: 2.54cm top/bottom, 3.17cm left/right
- 1.5× line spacing; page number: Arabic numeral centered
- Default date format: Arabic numerals (2026年3月15日)
- Optional `author` field displayed below title

### Body node levels

Both modes share the same `body` array schema with `{ level, number, heading, text }` nodes. Level 0 = body paragraph; levels 1–4 = headings with different fonts/indents per mode (see SKILL.md for full tables).

Level 3 supports `heading` + `text` in the same paragraph (heading bold, text normal). If only `text` is provided, the whole paragraph is bold (backward compatible).

Number fields should not include trailing punctuation — level 1 auto-appends "、".

### Strict mode GB/T 9704-2012 compliance

The strict style implements these standard requirements:
- 版头: org mark 35mm below page-area top edge, doc_number 2 lines below, red separator 4mm below
- Optional elements: serial_number (份号), secret_level (密级), urgency (紧急程度), signers (签发人)
- 主体: title 2 lines below separator, recipient 1 line below title, signature right-indented 4 chars
- 版记: cc (抄送), print_org (印发机关), print_date (印发日期), with thick/thin separator lines
- 页码: odd pages right-aligned, even pages left-aligned, em-dash delimiters

### Chinese font handling

`cnRun()` in `generate.js` works around a `docx` library bug where `eastAsia` font isn't set correctly — it patches the internal object tree directly. This is intentional and must be preserved.

### Key constants

- `F` object — font name aliases (仿宋_GB2312, 黑体, 楷体_GB2312, 宋体, 方正小标宋简体, Times New Roman)
- `LAYOUT` object — per-mode margin, font sizes, line spacing, footer style
- `CM(n)` / `PT(n)` / `MM(n)` — unit converters to twips

## Using as a Claude Code skill

When users ask to generate Chinese documents, write an inline JS script that `require`s `generate.js` with the appropriate parameters hardcoded, then execute it with `node`. See `SKILL.md` for the full calling template and docType reference table.
