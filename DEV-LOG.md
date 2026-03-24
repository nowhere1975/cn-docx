# cn-docx 开发日志

## 本期开发总结（2026-03-20）

### 一、多 Provider 模型管理

**背景**：原来模型配置写死为单个 Claude，用户无法更换模型或配置自己的 API Key。

**完成内容**：

- 新增 `web/services/llm.js`：统一 AI 调用入口，基于 OpenAI 兼容格式，支持任意 BaseURL + API Key 的模型服务
- 模型配置持久化到 `web/model-config.json`（已加入 .gitignore）
- `services/writer.js` 和 `services/parser.js` 迁移至 `llm.js`，移除对 Anthropic SDK 的直接依赖
- `routes/admin.js` 新增 Providers CRUD 接口：
  - `GET/POST /api/admin/providers`
  - `PUT/DELETE /api/admin/providers/:id`
  - `POST /api/admin/providers/:id/test`（连通性测试）
  - API Key 在响应中脱敏显示（前4后4，中间`****`）
  - 编辑时 API Key 留空则保留原值
- `llm.js` 增加 API Key 为空时的明确错误提示，避免返回晦涩的 401 错误

**推荐默认模型**：DeepSeek V3（`https://api.deepseek.com/v1`，`deepseek-chat`）。中文公文质量优秀，价格约为 Claude Haiku 的 1/7。

---

### 二、管理后台模型设置页重构

**背景**：原页面为静态 Claude 模型下拉框，与新的多 Provider 架构不符。

**完成内容**：

- `public/admin.html` 模型设置页完整重写
- Provider 卡片列表：显示名称、BaseURL、模型、Key 状态、默认/禁用标识
- 添加/编辑 Provider 弹窗（名称、BaseURL、API Key、模型名称、启用、设为默认）
- 每个 Provider 有独立的连通性测试按钮，结果内联展示
- 修复 Cookie 登录后 `adminToken = '__cookie__'` 导致后续 API 请求 401 的问题：Token 模式发 Header，Cookie 模式依赖 `credentials: 'same-origin'`

---

### 三、HTTPS 支持与部署脚本

**背景**：服务需要对外开放测试，且需要 HTTPS。

**完成内容**：

- `web/server.js` 支持 HTTPS 直接启动（无需 Nginx 反代）：
  - 环境变量 `SSL_CERT`、`SSL_KEY` 存在时启动 HTTPS 服务
  - 同时在 `HTTP_PORT`（默认80）启动 HTTP → HTTPS 重定向
  - 无证书时维持原 HTTP 模式，不影响本地开发
- 新增 `deploy.sh` 一键部署脚本（腾讯云轻量服务器 / Ubuntu/Debian）：
  - 自动安装 Node.js 20、PM2、acme.sh
  - 申请 Let's Encrypt 证书（standalone 模式）
  - 拉取代码、安装依赖、写入 `.env`
  - PM2 启动并配置开机自启
  - 配置证书到期自动续期 + 重载服务
  - 脚本幂等，重复执行 = 更新部署

**使用方式**：填写脚本顶部4个变量（DOMAIN / EMAIL / ADMIN_TOKEN / REPO_URL），`sudo bash deploy.sh` 即可。

---

### 四、代码开源

- 创建 GitHub 仓库：https://github.com/nowhere1975/cn-docx
- 协议：MIT
- 已排除敏感文件：`.env`、`model-config.json`、`data/`、`storage/`
- 初始提交包含完整 Web 服务代码、部署脚本、文档

---

## 积分定价与营销策略（2026-03-20 确认）

### 成本核算结论

推荐模型 DeepSeek V3，单次 AI 起草成本约 ¥0.01，对应消耗 5 分（售价 ¥0.25），毛利空间约 ×25。
服务器月固定成本 ≈¥80，月销 450 分可覆盖。

### 充值套餐（已定稿）

| 套餐 ID | 售价 | 积分 |
|---------|------|------|
| p10 | ¥9.9 | 60 |
| p30 | ¥29 | 200 |
| p100 | ¥98 | 800 |
| p300 | ¥298 | 3000 |

### 增长机制（已定稿）

- 注册赠 10 分（有效期 2 年）
- 邀请注册：双方 +5 分；被邀人首充后邀请人再 +10 分
- 一次性任务奖励：完善昵称 +2，首次使用各模式（4 种）各 +2
- 积分有效期 2 年

---

## 下一步开发计划：AI 表格服务

### 产品定位

用户只需上传文件 + 描述目标，AI 自行规划操作步骤，服务器执行后交付结果文件。
不做浏览器内表格编辑器，聚焦"AI 操作 Excel，用户取走结果"。

对标：ChatGPT Advanced Data Analysis，但专注中文办公 Excel 场景。

### 技术选型

| 层 | 选型 | 协议 | 说明 |
|---|---|---|---|
| 后端读写引擎 | ExcelJS | MIT | 流式读写，大文件支持，样式/公式完整 |
| 格式兼容兜底 | SheetJS (xlsx) | Apache-2.0 | 兼容 xls/ods/csv 等老格式 |
| AI 规划层 | 复用 llm.js | — | 已有多 Provider 配置，直接复用 |
| 前端 | 集成进 cn-docx | — | 侧边栏新增"AI 表格"模式 |

### 核心架构：操作流水线

```
用户上传文件(s) + 描述目标
        ↓
读取 Schema + 前50行样本
        ↓
AI 输出结构化操作计划（JSON）→ 展示给用户确认
        ↓
服务器用 ExcelJS 流式执行
        ↓
返回结果文件下载
```

AI 只看 Schema 和样本，不处理全量数据，解决大文件 token 限制问题。

### 操作 DSL

```json
{
  "steps": [
    { "op": "stack",   "files": [0,1,2],  "desc": "纵向合并三个文件" },
    { "op": "join",    "leftKey": "员工ID", "rightFile": 1, "rightKey": "ID", "how": "left" },
    { "op": "filter",  "col": "状态", "eq": "已完成" },
    { "op": "groupBy", "keys": ["部门"], "agg": { "金额": "sum", "笔数": "count" } },
    { "op": "pivot",   "rows": ["部门"], "cols": ["月份"], "values": "金额", "agg": "sum" },
    { "op": "sort",    "by": "金额", "order": "desc" },
    { "op": "dedupe",  "keys": ["员工ID"] },
    { "op": "addCol",  "name": "占比", "formula": "=B{row}/B$TOTAL" },
    { "op": "select",  "cols": ["姓名", "部门", "金额"] },
    { "op": "rename",  "mapping": { "金额": "总金额（元）" } },
    { "op": "splitSheet", "by": "部门", "desc": "按部门拆分为多个 Sheet" }
  ],
  "output": { "filename": "处理结果.xlsx" }
}
```

### 开发优先级

**第一期（MVP）**：

1. `services/excel-engine.js`：操作引擎，实现 `stack`、`join`、`groupBy`、`filter` 四个核心操作
2. `services/excel-planner.js`：AI 规划层，Schema 提取 + Prompt 设计 + 操作计划生成
3. `routes/excel.js`：
   - `POST /api/excel/plan`：上传文件 + 目标描述 → 返回操作计划（供用户确认）
   - `POST /api/excel/execute`：执行操作计划 → 返回结果文件
   - `GET /api/excel/download/:id`：下载结果
4. 前端：cn-docx 侧边栏新增"AI 表格"入口，实现上传 + 确认 + 下载流程

**第二期**：

- 补全剩余操作：`pivot`、`dedupe`、`addCol`、`splitSheet` 等
- 列名智能匹配（多文件列名不一致时 AI 自动对齐并请用户确认）
- 大文件流式处理（ExcelJS streaming mode，支持 10 万行+）
- 历史记录集成（复用现有 sessions/documents 体系）

**暂不做**：

- 浏览器内表格编辑器
- 图表生成（ExcelJS 图表支持残缺）
- 宏 / VBA

### 预估工作量

操作引擎约占 60%，AI 规划层约 20%，前端约 15%，集成约 5%。
总体约为 cn-docx 初版的 1.5-2 倍工作量。
