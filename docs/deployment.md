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

### 方案 A：Cloudflare Workers Builds 自动化部署（官方原生推荐，最省心）

通过 Cloudflare Workers Builds 直接连接你的 GitHub 仓库，之后每次 `git push main` 都将自动触发构建、D1 迁移与部署更新。

#### 1. 导入 Git 仓库设置
在 Cloudflare 控制台（**Compute (Workers) $\rightarrow$ Create Application $\rightarrow$ Import from Git**）：
- **Repository**：选择你的 `edgemon` 仓库
- **Production branch**：`main`
- **Root directory**：`/`
- **Build command**：`pnpm build`
- **Deploy command**：`pnpm deploy`

#### 2. 配置 Worker 运行时 Secrets（仅需配置一次）
首次连接创建后，进入该 Worker 的 **Settings $\rightarrow$ Variables and Secrets**（变量与机密），添加以下 3 个必选密钥：
- **`ADMIN_KEY`**：管理员登录后台的主密钥（例如使用 `openssl rand -base64 32` 生成）
- **`SESSION_SECRET`**：Cookie 会话签名密钥（至少 32 字符，例如 `openssl rand -base64 48`）
- **`DATA_ENCRYPTION_KEY`**：敏感数据库字段加密密钥（64 位 Hex，例如 `openssl rand -hex 32`）

> 💡 **永久保留**：Cloudflare 会永久安全托管这些 Secrets，以后的代码更新与 GitHub push 均无需再次输入或重复传递密钥！

#### 3. 触发构建与自动就绪
触发首次构建，Cloudflare 将自动串联：
```text
git push main ➔ Workers Builds ➔ pnpm build ➔ pnpm deploy (D1 自动建库 & 迁移 0001~0005) ➔ 部署就绪
```

---

### 方案 B：本地 CLI 命令行直接部署

如果你更习惯在本地终端通过命令行发布：

#### 1. 安装依赖并登录 Cloudflare
```bash
cd edgemon
pnpm install
npx wrangler login
```

#### 2. 一次性设置 Worker Secrets
```bash
npx wrangler secret put ADMIN_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_ENCRYPTION_KEY
```

#### 3. 执行一键部署
```bash
pnpm deploy
```
系统将全自动完成：
1. **自动创建并绑定 D1**：Wrangler 自动检测并 provision 生产数据库；
2. **自动执行 D1 迁移**：交互式确认后应用 `0001`~`0005` 核心表与二级索引；
3. **自动构建前端 SPA**：触发 `pnpm build:web`；
4. **部署 Worker 与 Durable Objects 实时推流中心**。

---

### 健康检查与初次登录
1. 访问部署生成的域名 `https://edgemon.<你的_SUBDOMAIN>.workers.dev/api/ready`，检查返回：
   ```json
   { "status": "ready", "db": true, "realtime": true }
   ```
2. 浏览器打开 `https://edgemon.<你的_SUBDOMAIN>.workers.dev/admin`，输入配置的 `ADMIN_KEY` 登录管理控制台。
3. 点击 **+ PROVISION NODE** 添加节点，复制启动命令即可上线监控节点。

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
