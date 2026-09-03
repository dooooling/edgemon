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

### 步骤 2：生成生产环境 Secrets 配置
在项目根目录下创建 `.env.production` 文件（已被 `.gitignore` 保护，绝对不会提交至 Git）：

```bash
# 生成高强度随机生产密钥
cat > .env.production <<EOF
ADMIN_KEY=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 48)
DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)
EOF

chmod 600 .env.production
```

> 💡 **特别提醒**：请在此时记录下生成的 `ADMIN_KEY`，它将作为访问管理控制台（`/admin`）的私密登录凭证。

---

### 步骤 3：首次一键部署（Wrangler 自动 Provisioning）
```bash
# 执行首次部署：自动创建 D1/DO、上传前端、同步 Secrets、部署 Worker 并初始化数据库
pnpm deploy:first
```

终端将全自动串联执行以下操作：
1. **自动构建前端**：触发 `pnpm build:web` 编译 React 19 SPA 单页应用；
2. **自动创建并绑定 D1**：Wrangler Automatic Provisioning 自动在当前 Cloudflare 账号创建并绑定生产 D1 数据库；
3. **自动配置 Durable Objects**：绑定 `RealtimeHub` 实时推送中心与 SQLite 存储；
4. **自动同步 Secrets**：将 `.env.production` 中的 3 个关键密钥一次性上传至 Worker；
5. **部署 Worker 与静态资源**：上传编译产物至 Cloudflare 边缘网络；
6. **执行 D1 迁移**：交互式终端提示确认（输入 `y`）后，依次应用 `0001`~`0005` 核心表与时序二级索引。

---

### 步骤 4：后续升级部署
未来拉取新代码或调整配置后，只需执行：
```bash
pnpm deploy
```
系统将自动先应用最新的 D1 增量迁移，然后构建前端并部署新版 Worker。

---

### 步骤 5：健康检查与初次登录
1. 部署成功后，终端将输出你的 Worker 访问域名，例如：
   `https://edgemon.<你的_SUBDOMAIN>.workers.dev`
2. 浏览器打开 `https://edgemon.<你的_SUBDOMAIN>.workers.dev/api/ready`，应返回：
   ```json
   { "status": "ready", "db": true, "realtime": true }
   ```
3. 打开 `https://edgemon.<你的_SUBDOMAIN>.workers.dev/admin`，输入步骤 2 中生成的 `ADMIN_KEY` 即可登录管理后台。
4. 点击 **+ PROVISION NODE** 添加节点，并在弹窗中一键复制对应操作系统（Linux / Windows）的 Agent 启动命令。

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

2. 创建配置目录与环境配置文件 `/etc/edgemon/agent.env`（权限设为 `0600`，杜绝 `ps aux` / 进程参数泄露凭据）：
   ```bash
   mkdir -p /etc/edgemon
   cat > /etc/edgemon/agent.env <<EOF
   EDGEMON_SERVER=https://edgemon.<你的_SUBDOMAIN>.workers.dev
   EDGEMON_NODE_ID=<NODE_UUID>
   EDGEMON_TOKEN=<NODE_TOKEN>
   EOF
   chmod 600 /etc/edgemon/agent.env
   ```

3. 创建 Systemd 服务文件 `/etc/systemd/system/edgemon.service`：
   ```ini
   [Unit]
   Description=EdgeMon Telemetry Agent
   Documentation=https://github.com/dooooling/edgemon
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=simple
   EnvironmentFile=/etc/edgemon/agent.env
   ExecStart=/usr/local/bin/edgemon-agent
   Restart=always
   RestartSec=5s
   LimitNOFILE=65535
   MemoryMax=64M

   [Install]
   WantedBy=multi-user.target
   ```

4. 启动并启用开机自启：
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
