# EdgeMon

一个轻量、低开销、低攻击面、**Cloudflare 原生** 的分布式服务器实时监控系统。

主控端完全托管在 Cloudflare（Worker + D1 + Durable Objects），无需自行搭建和维护中心主控服务器；被控端为高性能、零命令依赖的单文件 Rust Agent，支持 Linux（裸机/VPS/受限容器）和 Windows 系统。

---

## 🌟 核心特性

- **云原生零服务器运维**：前端 SPA、管理后台、API 路由、D1 时序数据库与 WebSocket 实时广播全部运行在 Cloudflare 边缘网络。
- **高频实时推流与 D1 配额保护**：Agent 默认按 30 秒周期平稳采样上报；Durable Objects 秒级分发实时数据，D1 **严格按 60 秒 Bucket** 批量 UPSERT 落盘，彻底保护数据库写入配额。
- **故障降级与数据完整性**：长连中断时自动启用指数退避重连（1/2/4/8/16/30/60s + Jitter）并启动 HTTP 兜底上报；内置 sequence 边界校验与 D1 Checkpoint 重放机制，断网恢复后不丢数据、不重复计流量。
- **容器配额边界感知**：Rust 原生读取 `/proc`、`/sys` 与 cgroup v1/v2 祖先层级配额，自动识别 Docker / LXC 资源边界，绝不将宿主机配置误报为容器套餐。
- **低攻击面与 SSRF 深度防护**：坚决不做 WebSSH、远程 Shell、任意脚本执行等后门通道；网络探测与 Webhook 调用具备严格的私网与元数据 IP 拦截。
- **告警与多渠道通知**：内置离线（90s）、CPU、内存、磁盘与套餐到期状态机；支持 Telegram、Discord、Slack 及自定义 Webhook 告警与 4 小时静默复报。

---

## 📁 模块结构

```text
edgemon/
├── agent/                         # Rust Linux/Windows 被控端 Agent
├── worker/                        # Cloudflare Worker API & RealtimeHub DO
├── web/                           # React 19 + TypeScript + Vite 前端仪表盘
├── protocol/                      # Protocol V1 跨语言协议契约与 Fixtures
├── migrations/                    # D1 数据库 SQL 迁移文件 (0001~0005)
├── docs/                          # 生产部署、安全架构与开发指南
│   ├── deployment.md              # 零到一生产部署操作指南
│   └── security.md                # 安全模型与密钥生命周期
├── wrangler.jsonc                 # Cloudflare Worker 配置
└── Cargo.toml                     # Rust 工作区配置
```

---

## 🚀 快速生产部署

详细步骤请参阅 **[生产部署完整指南](docs/deployment.md)**。简明流程如下：

### 方案 A：Cloudflare Workers Builds 自动部署（推荐）
在 Cloudflare 控制台连接本 GitHub 仓库，配置：
- **Build command**：`pnpm build`
- **Deploy command**：`pnpm deploy`
- **Secrets**：在 Worker 设置中的 **Variables and Secrets** 填入 `ADMIN_KEY`、`SESSION_SECRET`、`DATA_ENCRYPTION_KEY` 一次。
之后每次 `git push main` 即可全自动构建、迁移数据库并发布更新！

### 方案 B：本地 CLI 快速部署
```bash
# 1. 安装依赖并配置密钥
pnpm install
npx wrangler login
npx wrangler secret put ADMIN_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DATA_ENCRYPTION_KEY

# 2. 一键执行部署 (自动创建 D1、应用迁移、构建前端并发布)
pnpm deploy
```

---

## 📦 被控端 Agent 安装与运行

### 1. Linux 一键安装（推荐）

直接在目标 VPS 上执行一键安装脚本（自动识别架构、下载静态 musl 二进制并配置 Systemd 开机自启守护进程）：
```bash
curl -fsSL https://raw.githubusercontent.com/dooooling/edgemon/v0.1.1/scripts/install.sh | sudo bash -s -- \
  --server https://<你的_WORKER_DOMAIN> \
  --id <NODE_ID> \
  --token <NODE_TOKEN> \
  --version v0.1.1
```

### 2. 手动构建与部署

1. 编译或下载对应架构的静态二进制文件：
   ```bash
   # x86_64 Linux musl 静态二进制
   cargo build --release --target x86_64-unknown-linux-musl -p edgemon-agent

   # aarch64 Linux musl 静态二进制 (ARM VPS / 树莓派)
   cargo build --release --target aarch64-unknown-linux-musl -p edgemon-agent
   ```
2. 放置到目标服务器 `/usr/local/bin/edgemon-agent` 并赋权：
   ```bash
   chmod +x /usr/local/bin/edgemon-agent
   ```
3. 创建环境配置文件 `/etc/edgemon/agent.env`（权限 `0600`）：
   ```bash
   mkdir -p /etc/edgemon
   cat > /etc/edgemon/agent.env <<EOF
   EDGEMON_SERVER=https://<你的_WORKER_DOMAIN>
   EDGEMON_NODE_ID=<NODE_ID>
   EDGEMON_TOKEN=<NODE_TOKEN>
   EOF
   chmod 600 /etc/edgemon/agent.env
   ```
4. 创建 Systemd 服务文件 `/etc/systemd/system/edgemon.service`：
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
5. 启动服务并加入开机自启：
   ```bash
   systemctl daemon-reload
   systemctl enable --now edgemon
   ```

---

## 🛠️ 本地开发环境

```bash
# 启动本地 Worker 开发服务器 (端口 8787)
pnpm dev:worker

# 启动本地前端开发服务器 (端口 3000，带反向代理)
pnpm dev:web

# 运行全量测试套件
pnpm test:all
```

---

## 📄 文档索引

- **[生产环境部署指南](docs/deployment.md)**
- **[安全模型与密钥生命周期](docs/security.md)**
- **[协议规范文档 (Protocol V1.1)](protocol/PROTOCOL_V1.md)**
- **[UI 与视觉设计规范](DESIGN.md)**

---

## 📜 开源协议

本项目采用双重许可：[MIT License](LICENSE-MIT) 或 [Apache License 2.0](LICENSE-APACHE)。
