# EdgeMon

一个轻量、低开销、基于 Cloudflare 的分布式服务器监控系统。

主控端完全运行在 Cloudflare（Worker + D1 + Durable Objects），无需自行搭建和维护中心主控服务器；被控端为单文件 Rust Agent，支持 Linux（VPS/容器）和 Windows 系统。

---

## 特性

- **零中心服务器**：前端、API、数据库（D1）、WebSocket 实时推送全部托管在 Cloudflare，免除主控服务器运维。
- **轻量客户端**：Rust 单二进制文件，静态编译，无第三方命令行依赖，内存占用低（< 15MB）。
- **容器与配额感知**：自动识别 Docker / LXC / cgroup 资源边界，避免把宿主机配置误报为容器套餐。
- **按需实时推流**：日常 30 秒低频上报节省配额，打开节点详情页自动提频至 2 秒秒级实时推送。
- **安全可控**：仅采集硬件指标与网络连通性探测（ICMP/TCP），坚决不做 WebSSH、远程命令执行等后门功能。

---

## 项目结构

- `agent/`：Rust 客户端（支持 Linux x86_64/aarch64 与 Windows）。
- `worker/`：Cloudflare Worker 后端 API 与 WebSocket 实时 Hub。
- `web/`：React 19 + TypeScript + Vite 前端仪表盘与管理后台。
- `migrations/`：D1 数据库初始化与表结构迁移文件。
- `protocol/`：Agent 与 Worker 之间的通信协议定义。

---

## 本地开发与运行

### 1. 启动 Worker 后端（端口 8787）

```bash
pnpm install
pnpm dev:worker
```

### 2. 启动前端页面（端口 3000）

```bash
pnpm dev:web
```
浏览器打开 `http://localhost:3000` 即可访问仪表盘。

### 3. 创建节点并启动 Agent

1. 浏览器访问 `http://localhost:3000/admin`（默认本地 Admin Key：`test-admin-key`）；
2. 点击 **+ PROVISION NODE** 创建节点，获取生成的 `Node ID` 与 `Token`；
3. 本地启动 Agent 进行数据采集与上报：

```bash
cargo run -p edgemon-agent -- \
  --server http://127.0.0.1:8787 \
  --id <你的_NODE_ID> \
  --token <你的_NODE_TOKEN> \
  --allow-http
```

---

## 生产部署

### 部署 Cloudflare Worker & 前端

```bash
# 1. 登录 Cloudflare
npx wrangler login

# 2. 执行数据库迁移
pnpm db:migrate:remote

# 3. 部署 Worker 与前端静态资产
pnpm --filter edgemon-web build
npx wrangler deploy
```

### 编译 Agent 静态二进制

```bash
# Linux x86_64 musl 静态二进制
cargo build --release --target x86_64-unknown-linux-musl -p edgemon-agent

# Linux ARM64 musl 静态二进制
cargo build --release --target aarch64-unknown-linux-musl -p edgemon-agent

# Windows
cargo build --release -p edgemon-agent
```

---

## 开源协议

MIT OR Apache-2.0
