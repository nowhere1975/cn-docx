# gendoc 部署文档

将公文生成器部署到 `udiskai.top/gendoc/`。

> **前提**：udiskai.top 落地页已正常运行（nginx + HTTPS 均正常）。
> 本操作**不会**动落地页的 HTML 和已有 nginx 配置。

---

## 一、登录服务器

```bash
ssh root@udiskai.top
```

---

## 二、安装 Node.js（若已安装可跳过）

```bash
node -v   # 检查是否已安装，有输出则跳过下面两行
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

---

## 三、拉取代码

```bash
git clone https://github.com/nowhere1975/cn-docx.git /opt/gendoc
cd /opt/gendoc/web
npm install --production
```

---

## 四、写配置文件

**4.1 AI 模型配置（DeepSeek 直连）**

```bash
cat > /opt/gendoc/web/model-config.json << 'EOF'
{
  "providers": [
    {
      "id": "deepseek-default",
      "name": "DeepSeek",
      "baseURL": "https://api.deepseek.com/v1",
      "apiKey": "sk-535482e02a1448d0b14eba7adfa4bd0c",
      "model": "deepseek-chat",
      "enabled": true,
      "isDefault": true
    }
  ]
}
EOF
```

**4.2 服务环境变量**

```bash
cat > /opt/gendoc/web/.env << 'EOF'
PORT=3001
BASE_PATH=/gendoc
DAILY_BUDGET=2000
TURNSTILE_SECRET=0x4AAAAAACvWrmELFj4TZS3hmNuDOpun09w
TURNSTILE_SITEKEY=0x4AAAAAACvWrj9SUy6s6bj0
EOF
```

---

## 五、注册 systemd 服务

```bash
cat > /etc/systemd/system/gendoc.service << 'EOF'
[Unit]
Description=cn-docx gendoc public service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/gendoc/web
EnvironmentFile=/opt/gendoc/web/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gendoc
systemctl start gendoc
```

验证服务是否正常：

```bash
systemctl status gendoc
# 看到 Active: active (running) 即成功

curl http://localhost:3001/config.js
# 应返回：window.BASE_PATH="/gendoc";window.TURNSTILE_SITEKEY="0x4AA..."
```

---

## 六、更新 nginx 配置

**6.1 备份现有配置**

```bash
cp /etc/nginx/sites-available/udiskai /etc/nginx/sites-available/udiskai.bak
```

**6.2 在配置文件里加入 `/gendoc/` 反向代理块**

打开配置文件：

```bash
nano /etc/nginx/sites-available/udiskai
```

找到 `location / {` 这一行，在它**上方**插入以下内容（注意缩进对齐）：

```nginx
    location /gendoc/ {
        proxy_pass         http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header   Host               $host;
        proxy_set_header   X-Real-IP          $remote_addr;
        proxy_set_header   X-Forwarded-For    $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto  $scheme;
        proxy_buffering    off;
        proxy_read_timeout 120s;
        client_max_body_size 4m;
    }

```

**6.3 检查并重载 nginx**

```bash
nginx -t          # 应输出 syntax is ok / test is successful
systemctl reload nginx
```

---

## 七、验证

```bash
# 本机测试（HTTP，绕过 HTTPS）
curl -I http://localhost/gendoc/

# 或直接访问
# https://udiskai.top/gendoc/
```

页面正常打开，侧边栏显示「公文生成器」即部署成功。

---

## 日常运维

| 操作 | 命令 |
|------|------|
| 查看运行日志 | `journalctl -u gendoc -f` |
| 重启服务 | `systemctl restart gendoc` |
| 停止服务 | `systemctl stop gendoc` |
| 更新代码 | `git -C /opt/gendoc pull && systemctl restart gendoc` |
| 恢复 nginx 备份 | `cp /etc/nginx/sites-available/udiskai.bak /etc/nginx/sites-available/udiskai && systemctl reload nginx` |
| 查看今日用量 | `sqlite3 /opt/gendoc/web/data.db "SELECT * FROM guest_usage ORDER BY date DESC LIMIT 7;"` |
