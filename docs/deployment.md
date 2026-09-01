# EdgeMon 生产环境部署指南 (Production Deployment Guide)

本指南提供从零到一将 EdgeMon 完整部署至 Cloudflare 平台的无脑操作流程。

---

## 1. 架构总览与准备工作

EdgeMon 无需任何中心物理服务器，所有后端服务、实时 WebSocket 分发、时序持久化数据库与前端静态页面全部托管在 Cloudflare 平台。

### 前置要求
- [Node.js](https://nodejs.org/) >= 22.0.0（推荐 Node.js 22 LTS / 24 LTS，Wrangler 4.x 要求 Node.js >= 22）
- [pnpm](https://pnpm.io/) >= 9.0.0
- [Rust](https://rustup.rs/) >= 1.80.0（用于编译被控端 Agent）
- 已注册的 [Cloudflare 账号](https://dash.cloudflare.com/)

---

## 2. 部署详细步骤（Step-by-Step）

### 步骤 1：安装依赖与登录 Cloudflare
```bash
# 克隆仓库并进入根目录
cd edgemon

# 安装 Node 工作区依赖
pnpm install

# 登录 Cloudflare 账号
npx wrangler login
```

---

### 步骤 2：创建生产 D1 数据库
```bash
# 创建名为 edgemon 的 D1 数据库
npx wrangler d1 create edgemon
```
执行后终端会输出类似如下信息：
```text
✅ Successfully created DB 'edgemon'!
add the following to your wrangler.jsonc file:
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "edgemon",
    "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
]
```

将上面输出的 `database_id` 复制并替换到根目录的 `wrangler.jsonc` 中：
```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "edgemon",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" // 填入你的真实 D1 ID
    }
  ],
```

---

### 步骤 3：初始化配置生产 Secrets

EdgeMon 生产环境需要配置三个关键密钥：

1. **`ADMIN_KEY`**：管理员登录控制台的私密主密钥（请使用高强度随机字符串）。
2. **`SESSION_SECRET`**：用于签发管理员 HttpOnly Cookie 会话的 HMAC-SHA-256 密钥（至少 32 字符）。
3. **`DATA_ENCRYPTION_KEY`**：用于加密数据库敏感凭据（如 Webhook Token）的 256 位 AES-GCM 密钥（64 位 Hex 字符串）。
4. **`WEBHOOK_URL`**（可选）：默认全局告警 Webhook 地址（支持 Discord / Telegram / Slack / 自定义 Webhook）。

执行以下命令依次配置：

```bash
# 1. 设置管理员主密钥
npx wrangler secret put ADMIN_KEY

# 2. 设置会话签名密钥
npx wrangler secret put SESSION_SECRET

# 3. 设置数据加密密钥 (建议使用 openssl rand -hex 32 生成)
npx wrangler secret put DATA_ENCRYPTION_KEY

# 4. 可选：配置全局告警通知 Webhook
npx wrangler secret put WEBHOOK_URL
```

> 💡 **生成安全密钥示例**：
> ```bash
> # 生成 32 字节随机 Hex（适用于 DATA_ENCRYPTION_KEY）
> openssl rand -hex 32
>
> # 生成随机会话密钥（适用于 SESSION_SECRET）
> openssl rand -base64 32
> ```

---

### 步骤 4：执行 D1 数据库迁移
```bash
# 将 5 个版本迁移应用到生产 D1 数据库
pnpm db:migrate:remote
```
终端将依次执行：
- `0001_init.sql`（11 张核心数据表与索引）
- `0002_data_integrity.sql`（数据完整性校验与持久化状态字段）
- `0003_wss_active_instance.sql`（Active Instance 追踪）
- `0004_node_finance.sql`（服务器财务管理）
- `0005_time_indexes.sql`（时序与留存清理二次时间索引）

---

### 步骤 5：构建前端产物并部署至 Cloudflare
```bash
# 构建 React 19 前端生产包 (输出至 web/dist)
pnpm --filter edgemon-web build

# 部署 Worker 与前端静态资产
npx wrangler deploy
```
部署成功后，终端将输出你的 Worker 访问域名，例如：
`https://edgemon.<你的_SUBDOMAIN>.workers.dev`

---

### 步骤 6：健康检查与初次登录
1. 浏览器打开 `https://edgemon.<你的_SUBDOMAIN>.workers.dev/api/health`，应返回：
   ```json
   { "status": "ok", "version": "0.1.0" }
   ```
2. 打开 `https://edgemon.<你的_SUBDOMAIN>.workers.dev/admin`，输入配置的 `ADMIN_KEY` 登录管理后台。
3. 点击 **+ PROVISION NODE** 新建节点，复制生成的 `Node ID` 与 `Token`（明文仅显示一次）。

---

## 3. 被控端 Agent 编译与部署

### 3.1 跨平台静态二进制编译

```bash
# Linux x86_64 静态二进制 (VPS / 容器推荐)
cargo build --release --target x86_64-unknown-linux-musl -p edgemon-agent

# Linux aarch64 静态二进制 (ARM 架构 VPS / 树莓派)
cargo build --release --target aarch64-unknown-linux-musl -p edgemon-agent

# Windows 二进制
cargo build --release -p edgemon-agent
```
编译产物位于 `target/<target_triple>/release/edgemon-agent`。

### 3.2 Linux Systemd 服务化安装

1. 上传 `edgemon-agent` 二进制到目标服务器 `/usr/local/bin/edgemon-agent` 并赋予执行权限：
   ```bash
   chmod +x /usr/local/bin/edgemon-agent
   ```

2. 创建 Systemd 服务文件 `/etc/systemd/system/edgemon.service`：
   ```ini
   [Unit]
   Description=EdgeMon Telemetry Agent
   After=network.target network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   ExecStart=/usr/local/bin/edgemon-agent \
     --server https://edgemon.<你的_SUBDOMAIN>.workers.dev \
     --id <NODE_UUID> \
     --token <NODE_TOKEN>
   Restart=always
   RestartSec=5s
   LimitNOFILE=65535
   MemoryMax=64M

   [Install]
   WantedBy=multi-user.target
   ```

3. 启动并启用开机自启：
   ```bash
   systemctl daemon-reload
   systemctl enable --now edgemon
   systemctl status edgemon
   ```

### 3.3 升级与卸载
- **升级 Agent**：替换 `/usr/local/bin/edgemon-agent` 文件后执行 `systemctl restart edgemon`。
- **卸载 Agent**：
  ```bash
  systemctl disable --now edgemon
  rm -f /etc/systemd/system/edgemon.service /usr/local/bin/edgemon-agent
  systemctl daemon-reload
  ```
