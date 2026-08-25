# EdgeMon

一个轻量、低开销、基于 Cloudflare 的分布式服务器实时监控系统。

主控端完全运行在 Cloudflare（Worker + D1 + Durable Objects），无需自行搭建和维护中心主控服务器；被控端为高性能单文件 Rust Agent，支持 Linux（VPS/容器）和 Windows 系统。

---

## 🌟 核心特性

- **WSS 2秒实时流**：Agent 默认通过 WSS 长连（`/api/agent/v1/stream`）每 2 秒上报完整快照；前端 0~2 秒极速响应，无需手动唤醒。
- **D1 60秒限频保护**：Durable Objects 在内存中秒级广播实时遥测，同时严格按 60 秒 Checkpoint 批量持久化到 D1，彻底保护数据库写入配额。
- **故障降级（HTTP Fallback）**：WSS 断开时自动启用指数退避重连（1/2/4/8/16/30/60s + Jitter）并触发 30 秒 HTTP 兜底上报；长连恢复后立即平滑切换。
- **零中心主控服务器**：前端 SPA、API 路由、持久化存储（D1）、WebSocket 实时分发全部托管在 Cloudflare，零运维负担。
- **轻量与容器边界感知**：Rust 编写，静态编译（x86_64 / aarch64 musl / Windows），自动识别 Docker / LXC / cgroup 资源边界，绝不将宿主机配置误报为容器套餐。
- **低攻击面**：仅采集指标与网络连通性探测（ICMP/TCP），坚决不做 WebSSH、远程 Shell、任意命令执行等后门通道。

---

## 📁 项目结构

- `agent/`：Rust 客户端（双线程架构：Thread 1 指标采样与探测，Thread 2 WSS 主长连与 HTTP 故障降级）。
- `worker/`：Cloudflare Worker API 与 RealtimeHub Durable Object（Hibernation WebSocket 管理与 60s Checkpoint 事务落盘）。
- `web/`：React 19 + TypeScript + Vite 前端控制中心（SpaceX 航天机能全暗黑工业风设计）。
- `migrations/`：D1 数据库 SQL 迁移文件。
- `protocol/`：Protocol V1.1 协议契约与测试用例。

---

## 🛠️ 本地开发与运行

### 1. 启动 Worker 后端（端口 8787）

```bash
pnpm install
pnpm dev:worker
```

### 2. 启动前端仪表盘（端口 3000）

```bash
pnpm dev:web
```
浏览器访问 `http://localhost:3000` 即可打开控制中心。

### 3. 创建节点并运行 Agent

1. 浏览器打开 `http://localhost:3000/admin`（默认本地 Admin Key：`test-admin-key`）；
2. 点击 **+ PROVISION NODE** 创建节点，获取生成的 `Node ID` 与 `Token`；
3. 本地启动 Agent 守护进程：

```bash
cargo run -p edgemon-agent -- \
  --server http://127.0.0.1:8787 \
  --id <你的_NODE_ID> \
  --token <你的_NODE_TOKEN> \
  --allow-http
```

---

## 🚀 生产部署

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
