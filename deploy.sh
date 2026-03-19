#!/bin/bash
# ─────────────────────────────────────────────────────────
#  cn-docx 一键部署脚本（腾讯云轻量 · Ubuntu/Debian · HTTPS）
#  用法：
#    1. 填写下方配置
#    2. chmod +x deploy.sh && sudo ./deploy.sh
#
#  重复执行是安全的（pull 最新代码 + 重启服务）
# ─────────────────────────────────────────────────────────
set -euo pipefail

# ── 必填配置 ─────────────────────────────────────────────
DOMAIN=""                  # 你的域名，例：docs.example.com
EMAIL=""                   # Let's Encrypt 通知邮箱
ADMIN_TOKEN=""             # 管理后台密码（自定义，务必修改）
REPO_URL=""                # Git 仓库地址，例：https://github.com/xxx/cn-docx.git
# ── 可选配置 ─────────────────────────────────────────────
APP_DIR="/opt/cn-docx"     # 部署目录
BRANCH="main"              # 分支
# ─────────────────────────────────────────────────────────

# 检查必填项
for var in DOMAIN EMAIL ADMIN_TOKEN REPO_URL; do
  if [ -z "${!var}" ]; then
    echo "❌  请先在脚本顶部填写 $var"; exit 1
  fi
done

echo ""
echo "════════════════════════════════════════"
echo "  cn-docx 部署  →  https://$DOMAIN"
echo "════════════════════════════════════════"

# ── 1. 安装 Node.js 20 ───────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  echo "▶ 安装 Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "✓ Node.js $(node -v)"

# ── 2. 安装 PM2 ──────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "▶ 安装 PM2…"
  npm install -g pm2
fi
echo "✓ PM2 $(pm2 -v)"

# ── 3. 安装 acme.sh ──────────────────────────────────────
if [ ! -f ~/.acme.sh/acme.sh ]; then
  echo "▶ 安装 acme.sh…"
  curl -fsSL https://get.acme.sh | sh -s email="$EMAIL"
fi
ACME=~/.acme.sh/acme.sh
echo "✓ acme.sh 已就绪"

# ── 4. 拉取代码 ──────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  echo "▶ 更新代码…"
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  echo "▶ 克隆代码…"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
echo "✓ 代码已就绪"

# ── 5. 安装依赖 ──────────────────────────────────────────
echo "▶ 安装 npm 依赖…"
cd "$APP_DIR/web"
npm install --omit=dev
echo "✓ 依赖安装完成"

# ── 6. 创建数据目录 ──────────────────────────────────────
mkdir -p data storage/docs storage/tmp
echo "✓ 数据目录已创建"

# ── 7. 申请/续期 SSL 证书 ────────────────────────────────
CERT_DIR=~/.acme.sh/$DOMAIN
if [ ! -f "$CERT_DIR/fullchain.cer" ]; then
  echo "▶ 申请 SSL 证书（需要 80 端口空闲）…"
  # 停止当前服务以释放 80 端口
  pm2 stop cn-docx 2>/dev/null || true
  $ACME --issue -d "$DOMAIN" --standalone --httpport 80 \
        --server letsencrypt || {
    echo "❌  证书申请失败，请确认："
    echo "    1. DNS 已解析到本机 IP"
    echo "    2. 腾讯云安全组已开放 80/443 端口"
    exit 1
  }
else
  echo "✓ SSL 证书已存在（有效期内自动续期）"
fi

# ── 8. 写 .env 配置 ──────────────────────────────────────
cat > "$APP_DIR/web/.env" <<EOF
NODE_ENV=production
PORT=443
HTTP_PORT=80
DOMAIN=$DOMAIN
ADMIN_TOKEN=$ADMIN_TOKEN
SSL_CERT=$CERT_DIR/fullchain.cer
SSL_KEY=$CERT_DIR/$DOMAIN.key
EOF
echo "✓ .env 配置已写入"

# ── 9. 启动/重启服务 ─────────────────────────────────────
pm2 delete cn-docx 2>/dev/null || true
pm2 start "$APP_DIR/web/server.js" \
  --name cn-docx \
  --cwd "$APP_DIR/web" \
  --node-args "--env-file .env" \
  -- || \
pm2 start "$APP_DIR/web/server.js" \
  --name cn-docx \
  --cwd "$APP_DIR/web"

pm2 startup | tail -1 | bash 2>/dev/null || true
pm2 save
echo "✓ 服务已启动"

# ── 10. 设置证书自动续期后重载 ───────────────────────────
$ACME --install-cert -d "$DOMAIN" \
  --fullchain-file "$CERT_DIR/fullchain.cer" \
  --key-file       "$CERT_DIR/$DOMAIN.key" \
  --reloadcmd      "pm2 restart cn-docx"
echo "✓ 证书自动续期已配置"

# ── 完成 ─────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo "  🎉 部署完成！"
echo ""
echo "  访问地址：https://$DOMAIN"
echo "  管理后台：https://$DOMAIN/admin.html"
echo "  查看日志：pm2 logs cn-docx"
echo "  重启服务：pm2 restart cn-docx"
echo "════════════════════════════════════════"
echo ""
echo "  ⚠️  请确认腾讯云安全组已开放以下端口："
echo "     80  (HTTP 重定向)"
echo "     443 (HTTPS)"
echo ""
