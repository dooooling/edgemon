# AGENTS.md — EdgeMon 开发者与 AI 协作规范指南

> 本文件是 **EdgeMon** 项目的开发者与 AI Coding Agent 核心协作指南。任何参与本仓库开发、重构、测试与维护的 Agent 与开发者必须严格遵守本文档所规定的原则、架构约束、开发规范与测试方案。

---

## 1. 项目定位与核心原则

**EdgeMon** 是一个专为普通 VPS、裸机以及受限 Linux 容器（Docker、LXC、OpenVZ、Pterodactyl、KataBump 等）设计的轻量级、低攻击面、**Cloudflare 原生** 的分布式服务器监控系统。

### 1.1 五条黄金法则（Golden Rules）
1. **真实准确（Accuracy First）**：无法确认指标属于当前实例边界时，返回 `null` / `unknown`，**绝不返回看似精确的宿主机假数据**（严禁在容器内把宿主机几百 GB 内存或几 TB 磁盘当成套餐配额）。
2. **广泛兼容（Linux-First，兼顾 Windows）**：同一套 Agent 代码自适应普通 VPS、裸机及各种受限 Linux 容器，并提供 Windows 构建（`windows-sys` 直读注册表版本信息，见 `agent/Cargo.toml`）。
3. **极轻量（Minimal Overhead）**：Agent 纯静态编译、无本地 TSDB/SQLite、少线程、同步阻塞 I/O、无无限内存队列；Worker 端严格控制 D1 写入频率（默认 60s 写入一次）。
4. **低攻击面（No Remote Execution）**：只做指标监控与有限连通性探测（ICMP/TCP）。**坚决不做** WebSSH、远程 Shell、任意脚本执行、文件管理、进程管理等 RCE 通道。
5. **Cloudflare-Native**：前端、管理后台、API、持久化（D1）、实时推送（Durable Objects WebSocket）全部托管在 Cloudflare 平台，零中心主控服务器运维。

---

## 2. 技术栈与目录结构

```text
edgemon/
├── agent/                         # Rust 采集端 Agent（Linux / Windows）
│   ├── Cargo.toml                 # Rust 依赖与 profile 配置（含 windows-sys）
│   └── src/
│       ├── main.rs                # CLI 入口、采样/探测双线程与传输主循环
│       ├── config.rs              # 启动参数与配置解析
│       ├── error.rs               # 统一错误类型定义
│       ├── env/                   # 虚拟化与 cgroup 路径探测
│       ├── collector/             # CPU / 内存 / 磁盘 / IO / 网络 / Uptime 采集器
│       ├── probe/                 # ICMP / TCP 探测与私网 IP 校验
│       ├── protocol/              # Protocol V1 信封与消息定义
│       └── transport/             # WSS / HTTP 传输与 Backoff 退避重试
├── worker/                        # Cloudflare Worker API & RealtimeHub DO
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts               # Hono 路由与 Cron 调度入口
│       ├── routes/                # agent-stream / agent / auth / public / admin
│       ├── db/                    # nodes / metrics / persistence / traffic / alerts
│       ├── services/              # ingest / geo / crypto / session / notifications
│       ├── protocol/types.ts      # 严格对齐的 TS 协议类型定义
│       ├── durable/realtime-hub.ts# WebSocket Hibernation 广播与 watch: 订阅
│       └── scheduled.ts           # Cron rollup / 清理 / 告警评估
├── web/                           # React 19 前端仪表盘与控制台
│   ├── package.json
│   ├── vite.config.ts             # Vite 配置与 API 反向代理
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/                   # REST 客户端
│       ├── components/            # HeaderNav, NodeCard, WorldMap, HistoryChart, ProbeHeatmap, FinanceSummaryModal
│       ├── pages/                 # OverviewPage, NodeDetailPage, AdminPage
│       ├── queries/               # TanStack Query REST 状态 hooks
│       ├── realtime/              # Zustand WebSocket 实时增量 overlay
│       ├── i18n/                  # 中英双语
│       ├── router/                # 路由定义
│       ├── utils/                 # 时间等工具
│       └── styles/                # design-tokens.css（DESIGN.md 落地）
├── protocol/                      # 协议规范与共享 JSON 测试用例
│   ├── PROTOCOL_V1.md             # 协议规范文档
│   └── fixtures/                  # hello / welcome / report / report_replay / ack / error / config / config_ack 共 8 个
├── migrations/                    # D1 数据库 SQL 迁移文件
│   ├── 0001_init.sql              # 11 张核心数据表
│   ├── 0002_data_integrity.sql    # 水位与计数器字段
│   ├── 0003_wss_active_instance.sql # Active Instance 跟踪
│   ├── 0004_node_finance.sql      # 财务字段
│   ├── 0005_time_indexes.sql      # 时间索引
│   └── 0006_cpu_topology.sql      # CPU 物理核字段
├── docs/                          # deployment.md / security.md
├── wrangler.jsonc                 # Cloudflare 配置文件（Wrangler 4.x 语法）
├── package.json                   # Monorepo 根脚本
├── pnpm-workspace.yaml            # pnpm 工作区定义
└── Cargo.toml                     # Rust 工作区定义
```

---

## 3. 开发要求与编码规范

### 3.1 命名与单位规范（强制约束）
所有跨端协议、数据库字段与 API 必须明确携带单位后缀，严禁使用无单位的模糊数值字段：
- `*_bytes`：字节（内存、磁盘、流量）
- `*_bps`：字节每秒（网络速率、磁盘 IO 吞吐）
- `*_ms`：毫秒（时间戳、RTT、延迟）
- `*_sec`：秒（间隔、运行时间）
- `*_pct`：百分比（范围 $0 \sim 100$）
- `*_ratio`：比率（范围 $0 \sim 1$）
- `*_cores`：逻辑 CPU 核心容量

### 3.2 Rust Agent 开发规范
1. **零外部命令依赖**：
   - 严禁调用 `std::process::Command` 执行 `free`、`df`、`lscpu`、`ps`、`systemd-detect-virt` 等系统命令。
   - 所有指标必须通过读取 Linux `/proc`、`/sys` 伪文件系统或使用原生 Linux syscall（如 `statvfs`、`sched_getaffinity`）完成。
2. **宿主机与容器分流**：
   - 普通 VPS 上的 Agent systemd service 自身处于 cgroup 中，**绝不能把自身 service cgroup 当作整机上限**。
   - 仅当环境被确认识别为容器（如 Docker、LXC 等）时，才将 cgroup 作为资源边界。
3. **cgroup v2 祖先递归约束（Ancestor Limits）**：
   - 容器内读取配额时，必须从目标 cgroup 向 cgroup 根挂载递归遍历，计算全路径中最小有效约束（`cpu.max`、`memory.max`）。
4. **根文件系统 RootFS 可信度**：
   - 容器环境下由于 `statvfs("/")` 常返回宿主磁盘总量，若无法证明配额约束，必须返回 `rootfs_limit_bytes = null`，前端展示为 `N/A`。
5. **网络流量 Counter 与 `counter_id`**：
   - 必须通过 `SHA256(boot_id + netns_inode + iface)` 构造唯一的 `counter_id`。
   - 当 `counter_id` 变化或采样值回退时，本次速率标为 `null`，重置基准点，严禁计算负速率。
6. **网络探测与 SSRF 防御**：
   - 默认禁止探测回环与私网地址（RFC1918 / ULA）。若目标为域名，必须在 **DNS 解析之后** 检查实际 IP。
   - `allow_private_probes` 必须是 Local-only CLI 参数，远程 Worker 无权下发开启。
7. **编译与依赖控制**：
   - 目标平台：`x86_64-unknown-linux-musl`、`aarch64-unknown-linux-musl` 与 Windows（`cargo build --release -p edgemon-agent`）。
   - 纯静态链接，使用 `rustls`，内置 WebPKI CA 证书，产物体积 $\le 8\text{ MB}$，常驻内存 $\le 15\text{ MB}$。

### 3.3 Cloudflare Worker 开发规范
1. **D1 写入频率与 Cloudflare Free 配额保护**：
   - Agent 默认 2s WSS 实时流上报（WSS 断开时 30s HTTP 兜底），Worker 通过 DO 实时广播，但 D1 **严格按 60s 分钟桶封闭**（`persist60sCheckpoint`）执行批量写入。
   - 严禁将 2s 高频实时数据直接落盘 D1。
2. **Realtime 订阅不变量（Browser MUST NOT change agent interval）**：
   - 浏览器订阅者**禁止**改变 Agent 稳态采集间隔（`worker/tests/lease.test.ts` 不变量；Agent 间隔只由管理配置 `sample/stream/probe_interval_sec` 决定，默认 2s/2s/60s）。
   - 首页概览（Overview）接收常规广播；节点详情页（Detail）按 node id 取用目标节点数据（浏览器 socket 附带 `watch:{nodeId}` 订阅标记，前端按 id 过滤）。
3. **Durable Objects 与 WebSocket Hibernation**：
   - 必须使用 `ctx.acceptWebSocket(server, [tag])` 配合 Hibernation API。
   - DO 内存状态视为可丢失，严禁在 DO 内运行永久 `setInterval` / `setTimeout` 心跳定时器。
4. **安全与鉴权**：
   - 节点 Token：D1 仅保存 `SHA-256(node_token)`，创建/轮转时明文仅展示一次。
   - 管理员鉴权：使用 Worker Secret `ADMIN_KEY` + 基于 `SESSION_SECRET` 的 HMAC-SHA-256 HttpOnly Cookie。
   - 敏感配置（Webhook Token 等）：使用 Worker Secret `DATA_ENCRYPTION_KEY` 结合 AES-GCM（96-bit 随机 Nonce）加密存入 `secret_settings` 表。
5. **Ingest 处理流水线**：
   ```text
   1. HTTP Method / Header / Body 基础校验
   2. JSON 解析与 Envelope 校验 (v=1, instance_id, seq)
   3. 节点鉴权 (Token Hash 匹配)
   4. Active instance_id 校验 (防旧进程覆盖新进程)
   5. Inbound Cloudflare 元数据提取 (Geo, ASN, Colo, Edge RTT)
   6. 调用 RealtimeHub DO 进行 WebSocket 广播（role 范围广播，前端按 node id 取用）
   7. 判定分钟桶是否封闭，仅封闭时执行 D1 Checkpoint 批量持久化
   8. 返回 ACK (携带 config_rev 与 persisted_sample_seq 水位)
   ```

### 3.4 Web 前端开发规范
1. **SPA 架构**：React 19 + TypeScript + Vite + React Router + TanStack Query + Zustand + uPlot。
2. **状态分层边界**：
   - TanStack Query：管理 D1/Worker REST API 返回的持久化快照与管理数据。
   - Zustand：管理 WebSocket 实时推送的短生命周期 Realtime Overlay 与连接状态。
   - React Local State：管理组件局部交互状态。
3. **视觉规范（严格遵守 DESIGN.md，以 DESIGN.md 为准）**：
   - 采用 SpaceX 航天机能工业风设计语言（SpaceX Aerospace & Mission Control Aesthetic，详见 `DESIGN.md` 与 `web/src/styles/design-tokens.css`）。
   - 纯粹暗黑底盘：Canvas (`#000000` / `#050505`)、Card (`#0a0a0c`)，发丝边框 (`#27272a` / `#3f3f46`)，无投影无渐变。
   - 工业级排版：D-DIN（缺失时 Inter 代替）紧凑全大写字阶，正向 1.6px 字距，时序数字一律 tabular-nums。
   - 幽灵胶囊按钮：Ghost Outlined Pill CTAs（`rounded: 9999px`，1px `#3f3f46` 描边，600 字重，全大写字母）。
   - 状态色只用四 accents：在线绿 (`#22c55e` / `#4ade80`)、预警琥珀 (`#f59e0b`)、临界红 (`#ef4444`)、CF 橙 (`#f97316`)；雷达热力 Walrus 世界地图与 uPlot 时序图表保持全暗黑呈现。
4. **世界地图组件**：使用轻量 Equirectangular SVG 矢量地图，运行时不依赖第三方在线地图瓦片服务。
5. **真实性与优雅降级**：当内存配额、磁盘容量或地理位置为 `null` 时，UI 必须优雅展示为 `N/A` 或禁用进度条，禁止渲染 `NaN`、`undefined` 或假数据。

---

## 4. 测试要求与方案

任何功能变更必须满足三层测试网覆盖：

### 4.1 第一层：采集器 Mock Fixtures 单元测试
在 `agent/tests/fixtures/` 中模拟各种内核与 cgroup 伪文件：
- cgroup v2 祖先层级限额（自身 max、父级 512MB $\rightarrow$ 正确解析为 512MB）。
- `/proc/stat`、`/proc/meminfo`（无 `MemAvailable` 的旧内核回退）。
- `/proc/net/dev` 32 位溢出与 64 位大数测试。
- 文件不存在或权限拒绝时的容错（返回 `null` 而不崩溃）。

### 4.2 第二层：协议契约测试（Contract Tests）
- Rust Agent 与 Worker 必须共同针对 `protocol/fixtures/`（`hello.json`、`report.json` 等）进行双向序列化与反序列化断言。
- 确保字段类型、可选值（`null` vs 缺失）在两端完全一致。

### 4.3 第三层：真实环境验证矩阵（Test Matrix，发布前人工执行）
> 以下为人工集成验证清单（无自动化 harness）；内存项以 §3.2 的 $\le 15\text{ MB}$ 常驻为准，低配容器项收紧到 $< 10\text{ MB}$。
发布前必须在以下环境执行集成验证：
1. **KVM VPS**：宿主 CPU/RAM/磁盘/网卡容量采集。
2. **Docker (带 CPU/RAM 限制)**：`cpu.max` 与 `memory.max` 约束解析，使用率正确归一化。
3. **Docker (父级/祖先限额)**：正确递归继承父级限额。
4. **Docker (无 ICMP 权限)**：ICMP socket 权限拒绝时平滑降级为 TCP 探测。
5. **Docker (OverlayFS)**：`rootfs_limit_bytes` 返回 `null`，UI 显示 `N/A`。
6. **KataBump / 低配容器**：128MB 内存、0.1 核环境下稳定运行，Agent 内存 $< 10\text{ MB}$。
7. **LXC / OpenVZ 容器**：正确识别环境与命名空间。
8. **Systemd VPS 运行**：绝不把 Agent service cgroup 误判为整机配额。
9. **ARM64 Linux 节点**：musl 静态编译运行。
10. **纯 IPv6 节点**：网络上报与 Geo 正常解析。

---

## 5. 常用命令速查（Commands Cheat Sheet）

### 5.1 Rust Agent
```bash
# 本地编译检查
cargo check -p edgemon-agent

# 本地运行
cargo run -p edgemon-agent -- --server http://127.0.0.1:8787 --id <NODE_UUID> --token <TOKEN> --allow-http

# 执行单元测试
cargo test -p edgemon-agent

# musl 跨平台静态发布编译
cargo build --release --target x86_64-unknown-linux-musl -p edgemon-agent
cargo build --release --target aarch64-unknown-linux-musl -p edgemon-agent
```

### 5.2 Cloudflare Worker & D1
```bash
# 安装依赖
pnpm install

# 本地应用 D1 数据库迁移
pnpm db:migrate:local

# 启动本地 Worker 开发服务器 (端口 8787)
pnpm dev:worker

# 生产应用 D1 迁移
pnpm db:migrate:remote
```

### 5.3 Web 前端
```bash
# 启动前端开发服务器 (端口 3000，已配置反向代理至 8787)
pnpm dev:web

# 构建前端产物 (输出至 web/dist)
pnpm build:web
```

---

## 6. AI Agent 协作行为守则

1. **文档完整性**：修改代码时必须保留无关注释与现有类型声明；新增核心功能时必须同步更新协议与测试 Fixtures。
2. **严禁越界引入危险特性**：坚决拒绝在 Agent 或 Worker 中加入任何远程 Shell、WebSSH、任意脚本执行等后门功能。
3. **保持 D1 与 Cloudflare 限制意识**：编写 Worker 逻辑时必须时刻注意 CPU Time（Free 10ms）与 D1 写入配额，禁止在 hot path 执行昂贵计算或频繁写库。
