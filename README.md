# cn-docx

中文 Word 文档生成服务，包含：
- **Node.js 生成库**：可作为 Claude Code skill 调用
- **Web 服务**：面向中国用户的 AI 文档生成平台（`web/`）

支持文档类型：
- **正式公文**：通知、报告、请示、函、纪要、讲话稿、方案（GB/T 9704-2012）
- **通用文档**：工作总结、项目方案等

---

## 生成库（skill 用法）

```bash
npm install
node test.js          # 运行测试，输出到 test-output/
node generate.js      # 运行内置示例
```

详细调用说明见 `SKILL.md`，接入 Claude Code 见 `CLAUDE.md`。

---

## Web 服务

### 功能概览

- **三栏布局**：左侧功能/历史栏 + 中间输入区 + 右侧文档面板
- **四种模式**：粘贴排版、AI 起草、公文排版、公文起草
- **登录**：手机号 + 短信验证码（一步完成注册与登录）
- **历史记录**：默认保存生成记录和文件，支持版本管理
- **隐私模式**：开启后不保存任何记录和文件

### 启动

```bash
cd web
npm install
cp .env.example .env   # 填写 ANTHROPIC_API_KEY 等
node server.js         # http://localhost:3000
```

### 目录结构

```
web/
├── server.js
├── database.js
├── routes/
│   ├── auth.js        # 手机验证码登录
│   ├── convert.js     # 粘贴排版
│   ├── generate.js    # AI 起草
│   ├── history.js     # 历史记录
│   └── points.js      # 积分
├── middleware/
│   └── auth.js
├── services/
│   ├── parser.js
│   └── writer.js
├── storage/
│   └── docs/          # 用户文档落盘目录（隐私模式跳过）
├── public/
│   ├── index.html
│   └── app.js
└── PRD.md             # 产品需求文档
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API Key |
| `JWT_SECRET` | JWT 签名密钥 |
| `PORT` | 端口，默认 3000 |
| `SMS_MOCK` | `true` 时验证码在接口响应中返回（开发用） |

### 积分规则

| 操作 | 消耗 |
|------|------|
| 注册赠送 | +10 分 |
| 粘贴排版 / 公文排版 | -1 分 |
| AI 起草 / 公文起草 | -5 分 |
