# EdgeMon 实施方案

> 文档版本：Design Baseline v1.2  
> 项目名称：**EdgeMon**  
> 文档状态：**实施基线（Implementation Baseline）**  
> 复核日期：2026-08-25  
> 目标平台：Cloudflare Workers + D1 + Durable Objects + Static Assets  
> Agent：Rust / Linux-first  
>
> 本文档用于直接指导 V1 的设计、编码、测试和部署。除非通过正式设计变更记录（ADR）修改，本文件中标记为 **MUST** 的内容视为 V1 合同。

---

## 0. 规范用语与设计原则

本文使用以下规范用语：

- **MUST / 必须**：V1 实现不可偏离。
- **MUST NOT / 禁止**：V1 明确不允许。
- **SHOULD / 应当**：默认实现方式；偏离时必须说明理由。
- **MAY / 可选**：不影响 V1 合同的可选能力。

EdgeMon 的核心原则只有五条：

1. **准确**：无法确认指标属于当前实例时，返回 unavailable，而不是返回看似精确的宿主机数据。
2. **兼容**：同一个 Agent 目标适配普通 VPS、裸机和常见受限 Linux 容器。
3. **轻量**：Agent 少依赖、少线程、无本地数据库、无无限队列；Cloudflare 端控制 D1 写入频率。
4. **低攻击面**：只做监控与有限配置，不提供任意远程执行能力。
5. **Cloudflare-native**：前端、管理后台、API、持久化和实时推送均在 Cloudflare 平台完成，不需要额外主控 VPS。

---

# 1. 产品范围

## 1.1 V1 必须实现

EdgeMon V1 包含：

- 服务器/容器节点管理。
- 节点在线/离线状态。
- CPU 使用率与有效 CPU Capacity。
- 内存、Working Set、Swap。
- 根文件系统容量（仅在可信时展示）。
- Disk IO。
- 网络实时速率与累计流量 Counter。
- 月度/账期流量统计。
- Uptime。
- ICMP/TCP Probe 延迟与丢包。
- Cloudflare Edge RTT 与接入 PoP。
- 国家、地区、城市、经纬度、ASN、AS Organization。
- 世界节点地图。
- 历史指标图表。
- Offline / CPU / Memory / Disk / Expiry 告警。
- Webhook 通知。
- 管理控制台。
- 公共监控页（可关闭）。
- Browser WebSocket 实时推送。
- Rust Agent 的 amd64 / arm64 Linux 静态发布包。

## 1.2 V1 明确不做

以下内容 **MUST NOT** 进入 V1：

- WebSSH。
- Shell / Remote Exec。
- 任意脚本执行。
- 文件上传、下载、浏览或编辑。
- 进程 Kill / 进程管理。
- Docker/Kubernetes 管理。
- 通用 RPC。
- 可执行插件系统。
- 多租户。
- 复杂 RBAC。
- 通用 Prometheus 兼容层。
- 通用 TSDB。
- 查询语言或表达式告警语言。
- Agent 永久在线 WebSocket。
- Provider 专属硬编码识别（Wispbyte、KataBump 等不作为资源采集依据）。

> Wispbyte、KataBump、Pterodactyl 等是**目标测试环境**，不是协议中的环境类型。只有通过测试矩阵验证后，README 才可以宣称“已验证兼容”。

---

# 2. 当前 Cloudflare 平台约束

本节是 2026-08-25 的实施假设。平台限制可能变化，发布前必须再次核对 Cloudflare 官方文档。

## 2.1 D1

当前官方限制中：

- Workers Free：单个 D1 数据库最大 500 MB。
- Workers Paid：单个 D1 数据库最大 10 GB。
- Free：D1 rows written 100,000/day。
- Free：D1 rows read 5,000,000/day。
- D1 外键默认启用并强制执行。

因此：

- 实时 2 秒数据 **MUST NOT** 直接按 2 秒频率写入 D1。
- V1 默认 raw history 为 60 秒一个 bucket。
- 必须实现 retention 与 hourly rollup。

## 2.2 Workers

当前 Free Workers 的主要相关限制：

- 100,000 requests/day。
- HTTP invocation CPU time 10 ms（Free）。
- 128 MB memory。

因此 V1 默认使用低 CPU 路由、紧凑 JSON 和少量 D1 查询；不得在每次 report 中做昂贵计算。

## 2.3 Durable Objects

当前 Durable Objects 可用于 Free 和 Paid；Free 新建对象必须使用 SQLite-backed Durable Objects。

RealtimeHub：

- **MUST** 使用 WebSocket Hibernation API。
- **MUST NOT** 在 DO 中运行永久 `setInterval` / `setTimeout` 心跳循环，因为这会妨碍 hibernation。
- DO 内存状态必须视为可丢失。
- 浏览器连接的必要订阅信息应使用 WebSocket attachment 或 tags 恢复。

## 2.4 Static Assets

SPA 与 Worker **MUST** 作为同一个 Worker deployment 发布。

`/api/*` 由 Worker 优先处理；普通静态文件由 Workers Static Assets 提供并缓存。

---

# 3. 技术栈

## 3.1 Web

- React 19
- TypeScript
- Vite
- React Router
- TanStack Query（REST/API 服务端状态、缓存、请求去重与失效刷新）
- Zustand（仅用于 Realtime Overlay、WebSocket 连接状态和少量本地 UI 状态）
- uPlot（历史时序图）
- SVG 世界地图
- 原生 WebSocket

不使用 Next.js/SSR。Web **MUST** 构建为纯 SPA，并通过 Workers Static Assets 与 Worker 作为同一个 deployment 发布。

前端状态边界 **MUST** 保持清晰：

```text
TanStack Query
  = D1/Worker API 返回的持久化快照与管理数据

Zustand Realtime Store
  = WebSocket 推送的短生命周期实时 Overlay
  = connection/subscription 状态

React Local State
  = 组件局部交互状态
```

Realtime 数据 **MUST NOT** 被当作新的持久化真源；页面刷新后必须能够仅凭 REST API/D1 快照恢复基础界面，再由 WebSocket 增量覆盖最新值。

地图运行时不依赖在线地图瓦片。推荐在 build 阶段将公开地理边界数据预处理成轻量 Equirectangular SVG，浏览器只加载静态 SVG 与节点坐标。

### 3.1.1 React 数据流约束

V1 前端 **MUST** 遵守以下数据流：

```text
REST API
   │
   ▼
TanStack Query Cache
   │
   ├── 初始节点列表
   ├── 节点详情
   ├── 历史数据
   ├── Settings
   └── Admin 数据

WebSocket
   │
   ▼
Zustand Realtime Overlay
   │
   └── 以 node_id 为 key 保存短生命周期实时增量

Render
   │
   └── persisted snapshot + realtime overlay
```

约束：

- **MUST NOT** 使用 Zustand 复制完整 REST 服务端缓存。
- **MUST NOT** 使用 TanStack Query 轮询代替已有 WebSocket 实时通道。
- WebSocket 断开时，界面 **MUST** 继续显示最近一次 REST/D1 快照，并明确实时连接状态。
- 节点详情离开后，对应 realtime overlay **SHOULD** 被清理，避免长期积累。
- React Context **MAY** 用于主题、认证上下文等低频全局信息，但不得作为高频指标总线。

## 3.2 Worker

- TypeScript
- Hono
- Cloudflare Workers
- D1
- Durable Objects（SQLite-backed）
- WebSocket Hibernation API
- Cron Triggers
- Workers Static Assets
- Web Crypto API

## 3.3 Agent

- Rust
- Linux-first
- synchronous-first
- rustls
- serde / serde_json
- 最少量 Linux syscall bindings

Release targets：

```text
x86_64-unknown-linux-musl
aarch64-unknown-linux-musl
```

Agent **MUST NOT** 依赖：

- systemd
- Docker socket
- OpenSSL runtime
- Python
- shell 命令（采集逻辑不得通过执行 `free`、`df`、`lscpu`、`systemd-detect-virt` 等完成）

---

# 4. 术语与单位

为避免协议与 UI 出现歧义，V1 统一以下规则。

## 4.1 时间

- Protocol `ts_ms`：Unix milliseconds，来自发送方时钟，仅作诊断。
- D1 所有 `*_at_ms` / `*_start_ms`：Unix milliseconds UTC。
- 历史 bucket 的权威时间来自 **Worker 接收时间**，不使用 Agent wall clock 决定 bucket。
- 速率计算使用 Rust `Instant`/monotonic clock，不使用 wall clock。

## 4.2 单位

字段名必须明确单位：

```text
*_bytes       bytes
*_bps         bytes per second
*_ms          milliseconds
*_sec         seconds
*_pct         percent, 0..100 为正常范围
*_ratio       ratio, 0..1
*_cores       logical CPU capacity
```

禁止使用无单位的 `latency`、`memory`、`traffic` 等数值字段。

## 4.3 Scope

- **machine**：当前 VM/裸机的资源边界。
- **container**：当前容器/cgroup 的有效资源边界。
- **visible_filesystem**：进程可见的文件系统，但不能证明其容量就是套餐配额。
- **unknown**：无法可靠确认。

## 4.4 Node Geo 与 Cloudflare PoP

- **Node Geo**：Agent 请求出口 IP 的 GeoIP 位置。
- **Cloudflare PoP / Colo**：该请求命中的 Cloudflare 数据中心。

二者 **MUST NOT** 混淆。

## 4.5 Edge RTT 与 Probe RTT

- **Edge RTT**：Agent TCP/QUIC connection 到 Cloudflare Edge 的 smoothed RTT。
- **Probe RTT**：Agent 到用户配置目标的 ICMP 或 TCP 测量结果。

UI 必须分开标注。

---

# 5. 总体架构

```text
                         monitor.example.com
                                │
                    ┌───────────▼────────────┐
                    │ Cloudflare Worker      │
                    │ API + Control Plane    │
                    └──────┬─────────┬───────┘
                           │         │
                    ┌──────▼───┐ ┌──▼──────────────┐
                    │    D1    │ │ RealtimeHub DO  │
                    │ durable  │ │ hibernating WS  │
                    └──────────┘ └──────▲──────────┘
                                        │
                                   Browser WS

  KVM / Bare Metal / Docker / LXC / OpenVZ
                         │
                    Rust Agent
                         │
                  HTTPS + JSON
                         │
                         ▼
                 Cloudflare Worker
```

职责必须保持：

```text
Agent       = 测量与有限 Probe
Worker      = Auth / Protocol / Geo / Traffic / Alert / Persistence
D1          = 唯一持久化业务真源
Realtime DO = 实时订阅与广播（best effort）
Static      = React SPA + 地图静态资源
Browser     = 展示与交互
```

V1 不使用 KV、R2、Redis 或外部数据库。

---

# 6. Monorepo

```text
edgemon/
├── agent/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── config.rs
│       ├── env/
│       │   ├── detect.rs
│       │   ├── cgroup.rs
│       │   ├── container.rs
│       │   └── virtualization.rs
│       ├── collector/
│       │   ├── cpu.rs
│       │   ├── memory.rs
│       │   ├── disk.rs
│       │   ├── io.rs
│       │   ├── network.rs
│       │   └── uptime.rs
│       ├── probe/
│       │   ├── icmp.rs
│       │   └── tcp.rs
│       ├── protocol/
│       │   ├── envelope.rs
│       │   ├── hello.rs
│       │   ├── report.rs
│       │   └── response.rs
│       └── transport/
│           └── http.rs
│
├── web/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── router/
│   │   ├── queries/
│   │   ├── realtime/
│   │   ├── hooks/
│   │   ├── charts/
│   │   └── map/
│   └── public/
│       └── maps/world.svg
│
├── worker/src/
│   ├── index.ts
│   ├── routes/
│   │   ├── agent.ts
│   │   ├── auth.ts
│   │   ├── public.ts
│   │   ├── admin.ts
│   │   └── realtime.ts
│   ├── protocol/
│   │   ├── types.ts
│   │   └── validate.ts
│   ├── services/
│   │   ├── geo.ts
│   │   ├── traffic.ts
│   │   ├── metrics.ts
│   │   ├── alerts.ts
│   │   ├── notifications.ts
│   │   └── secrets.ts
│   ├── db/
│   └── durable/realtime-hub.ts
│
├── shared/
├── protocol/
│   ├── PROTOCOL_V1.md
│   └── fixtures/
├── migrations/
├── wrangler.jsonc
└── README.md
```

`protocol/fixtures` 必须同时被 Rust 和 TypeScript contract tests 使用。

---

# 7. Agent Protocol V1

## 7.1 核心原则

Protocol 与 HTTP Transport 分离。

V1 使用 JSON。V1 不使用 JSON-RPC、Protobuf、MessagePack。

V1 实现消息只有：

```text
hello     Agent -> Worker
welcome   Worker -> Agent
report    Agent -> Worker
ack       Worker -> Agent
error     Worker -> Agent
```

`config` 作为未来 transport extension 保留名称，但 V1 HTTP 实现不主动推送 `config`；配置只通过 `welcome` 或 `ack` 返回。

## 7.2 Agent Envelope

Agent 发出的消息：

```json
{
  "v": 1,
  "type": "report",
  "instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "seq": 182,
  "ts_ms": 1787640030000,
  "data": {}
}
```

定义：

- `v`：Protocol Version，V1 固定 `1`。
- `instance_id`：Agent 每次进程启动生成的随机 UUID，进程生命周期内不变。
- `seq`：该 `instance_id` 内单调递增，`hello` 通常为 1。
- `ts_ms`：Agent wall clock，仅诊断用途。

**必须有 `instance_id`**。只依赖 `seq` 会在 Agent 重启后发生旧序号冲突。

## 7.3 Server Envelope

Server response：

```json
{
  "v": 1,
  "type": "ack",
  "instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "seq": 182,
  "ts_ms": 1787640030062,
  "data": {}
}
```

Server 的 `instance_id` 和 `seq` 表示正在响应的 Agent message。

## 7.4 HTTP API

```text
POST /api/agent/v1/hello
POST /api/agent/v1/report
```

Headers：

```http
Authorization: Bearer <node-token>
X-Node-ID: <node-id>
Content-Type: application/json
User-Agent: EdgeMon-Agent/<version>
```

Node ID 是 Worker 生成的 opaque UUID，不应让 Agent 自行决定。

## 7.5 HTTP 状态语义

```text
200  成功（welcome / ack）
400  JSON 或字段不合法
401  Node ID / Token 无效
404  Node 不存在
409  INSTANCE_MISMATCH / HELLO_REQUIRED 等状态冲突
413  Payload 超限
429  请求频率超限
426  Protocol version 不受支持（可选；也可使用 400 + error code）
500  Worker 内部错误
```

错误 body 必须使用统一 `error` envelope，不返回内部 stack trace。

标准 error code 至少固定：

```text
INVALID_MESSAGE
UNAUTHORIZED
NODE_NOT_FOUND
UNSUPPORTED_VERSION
HELLO_REQUIRED
INSTANCE_MISMATCH
CONFIG_INVALID
RATE_LIMITED
INTERNAL_ERROR
```

客户端逻辑必须依赖 `code`，不得解析 `message` 文本决定行为。

## 7.6 Payload 限制

Worker 必须在完整业务处理前执行限制：

```text
hello body       <= 32 KiB
report body      <= 16 KiB
probe targets    <= 16
node display name <= 80 UTF-8 chars
probe id         <= 32 ASCII chars
probe name       <= 80 UTF-8 chars
hostname         <= 253 chars
```

所有数值必须验证 `finite`、范围和整数边界。

---

# 8. Node Token 与 Agent 身份

每个节点必须有独立 token。

创建 Node：

```text
node_id    = random UUID
node_token = 32 random bytes -> base64url
```

D1 只存：

```text
SHA-256(node_token)
```

这是安全的原因是 Node Token 本身必须具有至少 256-bit 随机熵；该规则**不适用于用户密码**。

Token：

- 创建或 rotate 时只返回一次明文。
- 无法恢复，只能 rotate。
- 一个节点泄露不影响其他节点。

---

# 9. Hello / Welcome

## 9.1 Hello

```json
{
  "v": 1,
  "type": "hello",
  "instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "seq": 1,
  "ts_ms": 1787640000123,
  "data": {
    "agent": {
      "version": "0.1.0",
      "arch": "x86_64"
    },
    "system": {
      "hostname": "node-01",
      "os": "alpine",
      "os_version": "3.21",
      "kernel": "6.8.0"
    },
    "environment": {
      "type": "container",
      "runtime": "docker",
      "host_virtualization_hint": "kvm",
      "cgroup_version": 2,
      "resource_scope": "container"
    },
    "resources": {
      "cpu_model_visible": "AMD EPYC",
      "cpu_capacity_cores": 0.5,
      "memory_limit_bytes": 536870912,
      "swap_limit_bytes": 0,
      "rootfs_limit_bytes": null,
      "rootfs_scope": "unknown"
    },
    "sources": {
      "cpu": "cgroup_v2",
      "memory": "cgroup_v2",
      "io": "cgroup_v2",
      "network": "netns",
      "rootfs": "unknown"
    },
    "capabilities": {
      "icmp_probe": false,
      "tcp_probe": true
    },
    "boot_id": "...",
    "network_counter_id": "..."
  }
}
```

### 字段解释

- `cpu_model_visible`：只代表当前进程可见 CPU model；容器中可能来自宿主机，不代表分配到的完整硬件。
- `host_virtualization_hint`：底层虚拟化线索，不参与资源容量计算。
- `resource_scope`：决定 CPU/RAM 的主要采集语义。
- `rootfs_scope=unknown` 时，前端不得显示套餐 Disk 总量。

## 9.2 Welcome

```json
{
  "v": 1,
  "type": "welcome",
  "instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "seq": 1,
  "ts_ms": 1787640000180,
  "data": {
    "config_rev": 7,
    "config": {
      "sample_interval_sec": 2,
      "report_interval_sec": 30,
      "probe_interval_sec": 60,
      "network_interface": "auto",
      "probes": []
    }
  }
}
```

Agent 在成功 `hello` 之前 **MUST NOT** 发送 `report`。

Worker 记录当前 `instance_id`。新 Hello 会切换 active instance；之后来自旧 instance 的迟到 report 返回 `INSTANCE_MISMATCH`，避免旧进程覆盖新进程状态。

---

# 10. Report / ACK

## 10.1 Report

```json
{
  "v": 1,
  "type": "report",
  "instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "seq": 182,
  "ts_ms": 1787640030000,
  "data": {
    "config_rev": 7,
    "boot_id": "...",

    "cpu": {
      "usage_pct": 27.4,
      "throttled_pct": 0.3
    },

    "memory": {
      "used_bytes": 184549376,
      "working_set_bytes": 173015040,
      "swap_used_bytes": 0
    },

    "rootfs": {
      "used_bytes": null
    },

    "io": {
      "read_bps": 10240,
      "write_bps": 8192
    },

    "network": {
      "interface": "eth0",
      "counter_id": "...",
      "rx_bps": 18273,
      "tx_bps": 8273,
      "rx_total_bytes": 918273645,
      "tx_total_bytes": 281736451
    },

    "uptime_sec": 8273,

    "probes": [
      {
        "id": "cn-ct",
        "status": "ok",
        "latency_ms": 42.3,
        "loss_ratio": 0.0
      }
    ]
  }
}
```

Rules：

- unavailable 值使用 `null` 或省略字段；V1 同一字段应固定一种做法，推荐对已声明但暂不可用的 numeric metric 使用 `null`。
- `0` 只能表示真实的 0。
- `loss_ratio` 范围 `0..1`。
- `rx_total_bytes` / `tx_total_bytes` 是 Counter。
- `rx_bps` / `tx_bps` 是 Gauge，只用于当前速度/历史图，不用于账期流量累计。

## 10.2 ACK

```json
{
  "v": 1,
  "type": "ack",
  "instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "seq": 182,
  "ts_ms": 1787640030062,
  "data": {
    "config_rev": 7
  }
}
```

Config 更新时：

```json
{
  "v": 1,
  "type": "ack",
  "instance_id": "550e8400-e29b-41d4-a716-446655440000",
  "seq": 182,
  "ts_ms": 1787640030062,
  "data": {
    "config_rev": 8,
    "config": {
      "sample_interval_sec": 2,
      "report_interval_sec": 30,
      "probe_interval_sec": 60,
      "network_interface": "auto",
      "probes": []
    }
  }
}
```

## 10.3 Realtime Hint

Realtime 是临时 hint，不属于持久 `config_rev`：

```json
{
  "realtime": {
    "interval_sec": 2,
    "lease_sec": 60
  }
}
```

只有**节点详情页**正在被查看时才给该 Node 返回高频 realtime lease。

打开首页世界地图 **MUST NOT** 自动把所有节点提升为 2 秒上报。

由于 V1 Agent 没有永久控制通道，详情页开启 realtime 后，首次 lease 最迟要等到下一次正常 Agent report 才能送达；默认 30 秒 report 意味着最坏约 30 秒启动延迟。V1 必须在 UI/设计中接受这一约束，不应隐含“瞬时切换”。

---

# 11. Agent Config 边界

远程持久配置只允许：

```text
sample_interval_sec
report_interval_sec
probe_interval_sec
network_interface
probes
enabled_metrics（可选）
```

以下配置属于 Worker，不得下发 Agent：

```text
history_interval
raw retention
hourly retention
traffic reset day
traffic quota
expiry
geo location
alert rules
notification config
```

Agent 必须执行安全范围：

```text
sample_interval_sec  1..60
report_interval_sec  5..300
probe_interval_sec   10..3600
realtime interval    >= 2
probe targets         <= 16
```

Server 下发超范围配置时，Agent 拒绝该字段并继续使用上一有效配置。

以下选项必须是 **local-only**，Worker 无权远程打开：

```text
allow_http
allow_private_probes
custom_ca_file
```

---

# 12. Rust Agent 运行模型

## 12.1 权限目标

Agent：

```text
MUST NOT require root
MUST NOT require CAP_SYS_ADMIN
MUST NOT require CAP_NET_ADMIN
MAY use ICMP when platform allows unprivileged ping socket or CAP_NET_RAW
```

ICMP 不可用时必须标记 unavailable；若 Probe 配置允许 TCP fallback，可改用 TCP。

## 12.2 主循环

V1 推荐单进程、少线程、blocking I/O：

```text
start
 ├─ parse local config
 ├─ detect environment
 ├─ resolve collection scope
 ├─ resolve cgroup paths
 ├─ collect static data
 ├─ hello
 └─ loop
     ├─ sample fast metrics
     ├─ run probes when due
     ├─ report when due
     └─ sleep until next deadline
```

不得为每个 metric 创建独立线程。

## 12.3 网络失败

- HTTPS connect timeout：推荐 5 秒。
- 单次 request 总超时：推荐 10 秒。
- 失败使用 exponential backoff + jitter，上限推荐 5 分钟。
- Agent 不创建无限内存队列或磁盘历史队列。
- 断网期间 CPU/RAM 历史可以产生空洞，这是 V1 接受的行为。
- 网络 Counter 在系统未重置的前提下仍可让恢复后的账期流量保持正确。

## 12.4 TLS

Production server URL **MUST** 是 `https://`。

`http://` 只允许显式 local-only `--allow-http` 开启，用于本地开发。

为避免 Alpine/极简容器缺失 CA bundle，Release Agent 推荐内置 WebPKI root store；如未来需要私有 CA，再提供 local-only custom CA file。

---

# 13. Environment Detector

## 13.1 Environment 输出

```text
type:
  container | vm | physical | unknown

runtime:
  docker | podman | lxc | openvz | unknown | null

host_virtualization_hint:
  kvm | qemu | xen | vmware | hyperv | unknown | null

cgroup_version:
  1 | 2 | null
```

`host_virtualization_hint` 只用于展示与诊断，不决定 CPU/RAM 容量。

## 13.2 Docker signals

组合使用：

```text
/.dockerenv
/proc/self/cgroup
/proc/self/mountinfo
overlay rootfs
```

禁止仅凭一个弱信号做绝对判断。

## 13.3 Podman

```text
/run/.containerenv
libpod cgroup hints
```

## 13.4 LXC/LXD/Incus

```text
/run/systemd/container
/proc/1/environ
/proc/self/cgroup
```

## 13.5 OpenVZ/Virtuozzo

```text
/proc/vz
/proc/bc（若存在）
```

## 13.6 VM

使用：

```text
/sys/class/dmi/id/*
/sys/hypervisor/*
/proc/cpuinfo hypervisor hints
```

Bare metal 只能在未检测到 container 和 hypervisor 后标记为 `physical`，否则为 `unknown`。

---

# 14. cgroup Resolver：准确性核心

这是 Agent 中优先级最高的模块。

## 14.1 Host 与 Container 必须分流

普通 VPS/裸机上的 systemd service 本身也处于 cgroup 中。

因此：

> **仅仅“发现 cgroup”不能说明应使用 self cgroup 作为整机资源边界。**

规则：

- `environment.type == container`：优先用容器 cgroup 作为 CPU/RAM/IO scope。
- `environment.type == vm | physical`：CPU/RAM 使用 machine `/proc`；不得错误地把 Agent systemd service cgroup 当成整机。

## 14.2 Container scope path

容器内应优先解析容器 init / PID 1 所在的 cgroup scope，而不是盲目把 Agent 自己的更深 child cgroup 当成整个容器。

如果无法可靠确认 container root cgroup，必须降级为 `resource_scope=unknown`，而不是返回确定但错误的 limit。

## 14.3 cgroup v2 ancestor limits

cgroup v2 限制具有层级性。

Resolver 必须从目标 cgroup 向 cgroup mount root 遍历 ancestor，对资源上限取实际有效约束。

例如：

```text
/container/memory.max      = max
/parent/memory.max         = 512M
```

有效 memory limit 必须是 512M，而不是 unlimited。

CPU quota、cpuset、memory limit 都必须考虑父级约束。

## 14.4 `max` 语义

```text
cpu.max       "max PERIOD" => 当前层无限制
memory.max    "max"        => 当前层无限制
memory.swap.max "max"      => 当前层无限制
```

`max` 不等于 0。

---

# 15. CPU Collector

## 15.1 Container / cgroup v2

读取：

```text
cpu.stat
cpu.max
cpuset.cpus.effective
```

并结合：

```text
sched_getaffinity()
ancestor cpu.max
ancestor cpuset constraints
```

Capacity：

```text
quota_cores = quota / period

effective_capacity = minimum finite constraint among:
  ancestor quota capacities
  effective cpuset CPU count
  sched_getaffinity CPU count
```

示例：

```text
cpu.max = 25000 100000
=> 0.25 cores
```

## 15.2 cgroup v2 usage

`cpu.stat`：

```text
usage_usec
nr_throttled
throttled_usec
```

采样间隔必须使用 monotonic time，并将单位统一后计算：

```text
usage_pct =
  delta(cpu_usage_time) /
  (delta(monotonic_time) * effective_capacity) * 100
```

Agent 不应仅因为短时值超过 100 就静默伪造数据；只拒绝负值、NaN、Infinity 等明显无效值。UI progress bar 可以视觉 clamp 到 100%，文本可保留真实数值。

`throttled_pct` 是近似的“在有效 CPU capacity 基准下损失于 throttling 的时间比例”，必须在代码注释与协议中保持相同定义。

## 15.3 cgroup v1

至少支持：

```text
cpuacct.usage
cpu.cfs_quota_us
cpu.cfs_period_us
cpuset.cpus
```

同样考虑 controller hierarchy 的父级限制。

## 15.4 VM / Bare Metal

使用 `/proc/stat` aggregate CPU jiffies 计算整机 CPU busy ratio。

Host CPU 使用率已经是整机聚合比例，不再除以 CPU core count。

`cpu_capacity_cores` 使用 process affinity / online CPU count 的可信值。

---

# 16. Memory Collector

## 16.1 Container cgroup v2

读取：

```text
memory.current
memory.max
memory.stat
memory.swap.current
memory.swap.max
```

`memory_limit_bytes` 取 ancestor 中最小 finite `memory.max`。

Working Set：

```text
working_set_bytes = max(0, memory.current - inactive_file)
```

其中 `inactive_file` 来自同一 cgroup 的 `memory.stat`。

## 16.2 cgroup v1

读取：

```text
memory.usage_in_bytes
memory.limit_in_bytes
memory.stat
```

Swap 只有在 `memsw` controller 信息可用时计算；否则 `swap_used_bytes=null`，不得猜测。

v1 Working Set 根据实际 `memory.stat` key 选择 `total_inactive_file` / `inactive_file`，实现必须用 fixture 覆盖不同内核格式。

## 16.3 VM / Bare Metal

读取 `/proc/meminfo`：

```text
used = MemTotal - MemAvailable
```

若旧内核没有 `MemAvailable`，V1 可实现明确的 fallback；不得无说明地改用完全不同口径。

---

# 17. Root Filesystem 与 Disk IO

## 17.1 V1 只监控 root filesystem

V1 不做多磁盘 inventory。

### VM / Bare Metal

`statvfs("/")` 可作为 root filesystem capacity/used 来源。

### Container

容器中的 `statvfs("/")` 可能返回宿主 backing filesystem 容量。

因此：

- 若 Agent 不能证明容量受到当前 container/filesystem quota 约束：`rootfs_limit_bytes=null`。
- 若 `rootfs_limit_bytes=null`，前端不得显示 “used / total” 套餐占用百分比。
- 可以选择完全隐藏 `rootfs.used_bytes`；不得把 host filesystem used 冒充容器自身使用量。

V1 宁可显示 `N/A`，也不显示错误的 2 TB 宿主机容量。

## 17.2 IO

Container cgroup v2：

```text
io.stat
```

对当前 cgroup scope 中所有 device 的 `rbytes/wbytes` 求和，再按 monotonic interval 计算 bps。

VM/Bare Metal：

- 通过 root mount 的 major:minor 映射 `/sys/dev/block/<major>:<minor>`。
- 从对应 block device 统计读取 IO counter。
- 不应简单求和 `/proc/diskstats` 所有磁盘，否则可能对 partition / device mapper 产生重复计数。

cgroup v1 IO 为 best-effort；无法可靠解析时返回 null。

---

# 18. Network Collector 与流量 Counter

## 18.1 Interface

数据源：`/proc/net/dev`，即当前 network namespace 可见接口。

`auto` 选择顺序：

1. IPv4/IPv6 default route 对应接口。
2. 排除 `lo`。
3. 若仍有多个候选，选择具有有效 carrier/UP 状态的接口。
4. 管理员可通过 Agent config 固定接口。

## 18.2 Counter

Agent 上报：

```text
rx_total_bytes
tx_total_bytes
rx_bps
tx_bps
counter_id
```

`counter_id` 必须在同一 Counter domain 内稳定，在网络 namespace/interface 改变时变化。

推荐构造依据：

```text
boot_id + network namespace inode + interface name
```

这比只用 `boot_id` 更可靠，因为容器重建时宿主 boot_id 可能不变，但 network namespace counter 已重置。

## 18.3 Rate

```text
bps = delta(total_bytes) / monotonic_elapsed_seconds
```

当 counter 回退、interface 变化或 `counter_id` 变化时：

```text
rate = null for first sample of new counter domain
```

不得计算负速率。

---

# 19. Uptime

内部可采集：

```text
kernel_uptime_sec
environment_uptime_sec
agent_uptime_sec
```

默认 report 的 `uptime_sec`：

- VM/Bare Metal：kernel uptime。
- Container：优先容器 PID 1 生命周期。
- 无法可靠确定容器生命周期：fallback kernel uptime，但 Hello source/diagnostic 必须能说明来源。

---

# 20. Probe

## 20.1 Config

```json
{
  "id": "cn-ct",
  "name": "China Telecom",
  "host": "203.0.113.10",
  "method": "icmp"
}
```

TCP：

```json
{
  "id": "global-cf",
  "name": "Cloudflare TCP",
  "host": "1.1.1.1",
  "method": "tcp",
  "port": 443
}
```

## 20.2 ICMP

Agent 应先尝试 Linux 可用的 unprivileged ping socket 能力；权限不足才视为 unavailable。不能简单假定“没有 CAP_NET_RAW 就绝对不能 ICMP”。

## 20.3 TCP latency

TCP Probe 的 `latency_ms` 定义为：

> 从 `connect()` 开始到 TCP handshake 成功的时间。

若配置 host 是域名，DNS resolve 时间不计入 `latency_ms`；DNS failure 作为独立 failure status。

## 20.4 Result

```json
{
  "id": "global-cf",
  "status": "ok",
  "latency_ms": 31.2,
  "loss_ratio": 0.0
}
```

Status 枚举至少包括：

```text
ok
timeout
dns_error
permission_denied
connect_error
unsupported
```

默认每个 Probe 每周期 3 个 sample：

- latency = 成功 sample RTT median。
- loss_ratio = failed / total。
- 全部失败时 latency_ms = null。

## 20.5 私网探测安全边界

为了避免 Worker 被攻破后将 Agent 用作内网扫描器：

- 默认 `allow_private_probes=false`。
- Agent 默认拒绝 loopback、link-local、RFC1918 IPv4、ULA IPv6 等非公网目标。
- 对 hostname，必须在 DNS resolve **之后**逐个校验实际目标 IP；仅检查 hostname 字符串不足以防止 DNS rebinding/解析到私网地址。
- 是否允许 private probes 是 **local-only** 配置，远程 Worker 无权开启。
- TCP Probe 只做连接握手，不发送任意 payload。

---

# 21. Worker Agent Ingest

Report route 处理顺序固定：

```text
1. method/path/content-type/body-size check
2. parse JSON
3. protocol validation
4. load Node + config + persisted state
5. authenticate token
6. validate active instance_id
7. normalize Cloudflare request metadata
8. derive realtime hint
9. publish realtime payload to DO
10. decide whether current/history persistence is due
11. persist idempotently when due
12. return ACK
```

业务 route 不允许直接堆 SQL；SQL 放在 `db/`，逻辑放在 `services/`。

同一 report 的 D1 读取应尽量通过一次 JOIN 查询取得 Node、config 和 state，避免不必要的 subrequest。

---

# 22. 幂等性与重试

V1 **不依赖“每个 report 都先持久化 last_seq”来实现幂等**，否则会为了 sequence 去重造成额外 D1 write。

必须通过业务数据本身实现幂等：

- `metrics_raw` 使用 `(node_id, bucket_start_ms)` 主键 + UPSERT。
- `node_state` 是 replace/update current snapshot，重复执行无累计副作用。
- 账期流量采用 Counter baseline 模型，不对每个 report 直接 `+= delta`。
- Alert/Event 由持久状态 transition 产生，使用唯一逻辑防止重复事件。

`seq` 主要用于：

- ACK correlation。
- 日志诊断。
- 当前已知 instance 内的明显 stale/out-of-order 检查。

若 D1 中同一 `agent_instance_id` 已持久化 `last_seq >= incoming seq`，Worker 必须直接返回 ACK，不再执行 history/traffic/event durable side effects。对于尚未达到持久化窗口、因此 `last_seq` 仍较旧的重复 report，允许发生重复 realtime broadcast，但持久化路径仍必须依靠 bucket UPSERT 与 Counter baseline 保持幂等。

新 `hello` 必须立即持久化 active `agent_instance_id`（以及对应初始 sequence metadata），不能等到下一分钟 history window，否则旧实例迟到 report 可能覆盖新实例。

同一个 `(instance_id, seq)` 重试时，Agent 必须重发同一逻辑 payload。

---

# 23. Geo / Country / ASN / Edge RTT

Worker 从 inbound `request.cf` 获取可用字段：

```text
country
region
regionCode
city
latitude
longitude
timezone
continent
asn
asOrganization
colo
clientTcpRtt
clientQuicRtt
```

注意：

- `latitude` / `longitude` 在 Worker API 中是 string|null，入库前必须 parse 并校验范围。
- 本地 `wrangler dev`/测试环境可能没有真实 `request.cf`；代码必须允许 metadata 缺失。
- Geo 是出口 IP 位置，NAT/Provider egress 下不等同于物理机柜位置。

## 23.1 Edge RTT 选择

保存：

```text
edge_rtt_ms
edge_transport = tcp | quic | null
```

选择：

- HTTP/3 且 `clientQuicRtt` 可用 -> QUIC RTT。
- HTTP/1.1 / HTTP/2 且 `clientTcpRtt` 可用 -> TCP RTT。
- 否则 null。

禁止把应用层 HTTP request duration 叫作 Edge RTT。

## 23.2 Egress IP

Worker 可从可信 Cloudflare request metadata/header 获取 Agent egress IP。

D1 可保存最新 `egress_ip` 用于管理员诊断和 IP-change event，但：

- Public API 默认 **MUST NOT** 返回完整 egress IP。
- Admin API 才允许显示。

## 23.3 Geo 更新

Geo **不能**通过 Cron 主动刷新，因为没有 Agent 请求就没有新的 inbound Geo metadata。

正确行为：

- 每次 report 都可读取 `request.cf`。
- D1 Geo 字段只在首次、发生变化或到达低频校验窗口时更新。
- 无意义的每 report Geo UPDATE 必须避免。

---

# 24. 地图

## 24.1 数据来源

边界数据为构建时依赖，必须使用可公开分发且许可证兼容的数据源（推荐 Natural Earth / world-atlas），并在仓库中固定版本和许可证说明。

Build 阶段预处理为：

```text
web/public/maps/world.svg
```

运行时不访问第三方瓦片/API。

## 24.2 坐标

Node location：

```text
location_mode = auto | manual
```

Auto：Cloudflare Geo。  
Manual：管理员指定 ISO country、city、latitude、longitude。

合法范围：

```text
latitude  -90..90
longitude -180..180
```

## 24.3 Marker 状态

只表达：

```text
online
warning
offline
```

地图点大小不映射 CPU，避免视觉噪声。

同坐标多个节点应做 count badge/cluster 或可展开列表，不允许点完全覆盖导致节点不可选择。

---

# 25. RealtimeHub Durable Object

## 25.1 职责

DO 只负责：

```text
Browser WebSocket
Subscription
Broadcast
Detail-watch detection
```

DO 不负责：

```text
D1 history
Agent auth database
Traffic persistence
Alert persistence
Agent config database
```

## 25.2 一个站点一个 Hub

V1 使用一个：

```text
RealtimeHub("main")
```

单个 DO 的规模足够 V1 的个人/小规模监控场景。未来真正遇到容量瓶颈后再按 node hash 分片。

## 25.3 WebSocket 模式

浏览器连接只允许两类订阅语义：

```text
overview
node:<node_id>
```

- `overview`：首页接收所有节点正常 report 的实时增量，但**不请求高频 Agent lease**。
- `node:<id>`：节点详情页；该节点可以获得高频 lease。

这样避免首页打开后把所有 Agent 提升到 2 秒上报。

DO 使用 `acceptWebSocket()` Hibernation API。

推荐建立连接时就确定 scope，例如：

```text
/api/realtime?scope=overview
/api/realtime?scope=node&id=<node_id>
```

Query 中只允许非敏感 subscription metadata，绝不放认证 token。Worker 在转发到 DO 前完成 public/admin 权限检查。

DO 可使用 `overview` 或 `node:<id>` tag，并将必要 metadata 放入 WebSocket attachment；不依赖 constructor 内存恢复连接状态。浏览器切换 overview/detail 时可以关闭旧连接并建立新 scope 连接，V1 不需要实现复杂的动态 tag 修改。

## 25.4 无心跳定时器

DO 中 **MUST NOT** 使用周期定时器维护 websocket heartbeat/watch lease。

Watch 是否存在应根据当前连接/tag 判断。Agent lease 本身带到期时间；浏览器离开后，旧 lease 自然过期。

---

# 26. Realtime 数据流

```text
Agent report
    │
    ▼
Worker
    │
    ├── RealtimeHub.publishAndCheckDetailWatch(node, metrics)
    │       │
    │       ├── broadcast to current Browser subscribers
    │       └── return detail_watched=true/false
    │
    └── persistence due?
            │
            └── D1
```

每个 Agent report 最多进行一次上述 DO 调用，同时完成 broadcast 和 detail-watch detection，禁止为了 realtime hint 再做第二次 DO round-trip。

D1 与 DO 是不同层：

```text
DO = best effort realtime
D1 = durable source of truth
```

Browser 页面加载：

```text
1. GET D1-backed snapshot
2. render
3. connect WebSocket
4. apply realtime deltas
```

页面绝不能只有 DO 数据才能初始化。

---

# 27. D1 数据模型

所有时间字段使用 Unix milliseconds UTC。

## 27.1 settings

```sql
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;
```

只保存非敏感或无需解密秘密的配置。

## 27.2 secret_settings

Webhook token/header 等需要恢复明文的秘密使用 AES-GCM 加密后保存：

```sql
CREATE TABLE secret_settings (
    key         TEXT PRIMARY KEY,
    nonce_b64   TEXT NOT NULL,
    cipher_b64  TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
) WITHOUT ROWID;
```

AES-GCM key 来自 Worker Secret `DATA_ENCRYPTION_KEY`，不得存入 D1。

## 27.3 nodes

```sql
CREATE TABLE nodes (
    id                       TEXT PRIMARY KEY,
    name                     TEXT NOT NULL,
    token_hash               TEXT NOT NULL UNIQUE,

    sort_order               INTEGER NOT NULL DEFAULT 0,
    hidden                   INTEGER NOT NULL DEFAULT 0,
    note                     TEXT,

    traffic_reset_day        INTEGER NOT NULL DEFAULT 1
                             CHECK (traffic_reset_day BETWEEN 1 AND 31),
    traffic_quota_bytes      INTEGER,

    hostname                 TEXT,
    agent_version            TEXT,

    os                       TEXT,
    os_version               TEXT,
    kernel                   TEXT,
    arch                     TEXT,

    env_type                 TEXT,
    env_runtime              TEXT,
    host_virtualization_hint TEXT,
    cgroup_version           INTEGER,
    resource_scope           TEXT,

    cpu_model_visible        TEXT,
    cpu_capacity_cores       REAL,
    memory_limit_bytes       INTEGER,
    swap_limit_bytes         INTEGER,
    rootfs_limit_bytes       INTEGER,
    rootfs_scope             TEXT,

    egress_ip                TEXT,
    geo_country              TEXT,
    geo_region               TEXT,
    geo_region_code          TEXT,
    geo_city                 TEXT,
    geo_lat                  REAL,
    geo_lon                  REAL,
    geo_timezone             TEXT,
    geo_continent            TEXT,
    asn                      INTEGER,
    as_org                   TEXT,
    cf_colo                  TEXT,

    location_mode            TEXT NOT NULL DEFAULT 'auto'
                             CHECK (location_mode IN ('auto','manual')),
    manual_country           TEXT,
    manual_city              TEXT,
    manual_lat               REAL,
    manual_lon               REAL,

    geo_updated_at_ms        INTEGER,
    expires_at_ms            INTEGER,

    created_at_ms            INTEGER NOT NULL,
    updated_at_ms            INTEGER NOT NULL
);
```

## 27.4 node_config

```sql
CREATE TABLE node_config (
    node_id       TEXT PRIMARY KEY,
    revision      INTEGER NOT NULL DEFAULT 1,
    config_json   TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,

    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
```

只含 Agent 持久配置。

## 27.5 node_state

```sql
CREATE TABLE node_state (
    node_id                  TEXT PRIMARY KEY,

    agent_instance_id        TEXT NOT NULL,
    last_seq                 INTEGER NOT NULL,
    last_seen_at_ms          INTEGER NOT NULL,

    boot_id                  TEXT,
    network_counter_id       TEXT,
    network_interface        TEXT,

    cpu_usage_pct            REAL,
    cpu_throttled_pct        REAL,

    memory_used_bytes        INTEGER,
    memory_working_set_bytes INTEGER,
    swap_used_bytes          INTEGER,

    rootfs_used_bytes        INTEGER,

    disk_read_bps            INTEGER,
    disk_write_bps           INTEGER,

    rx_bps                   INTEGER,
    tx_bps                   INTEGER,
    rx_total_bytes           INTEGER,
    tx_total_bytes           INTEGER,

    edge_rtt_ms              REAL,
    edge_transport           TEXT,
    uptime_sec               INTEGER,

    probe_data_json          TEXT,

    persisted_at_ms          INTEGER NOT NULL,

    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
```

`last_seen_at_ms` 是最近**持久化** report 的 Worker receive time；实时页面可以使用 WebSocket 收到的更晚时间。

## 27.6 metrics_raw

```sql
CREATE TABLE metrics_raw (
    node_id                  TEXT NOT NULL,
    bucket_start_ms          INTEGER NOT NULL,

    cpu_usage_pct            REAL,
    cpu_throttled_pct        REAL,

    memory_used_bytes        INTEGER,
    memory_working_set_bytes INTEGER,
    swap_used_bytes          INTEGER,

    rootfs_used_bytes        INTEGER,

    disk_read_bps            INTEGER,
    disk_write_bps           INTEGER,

    rx_bps                   INTEGER,
    tx_bps                   INTEGER,
    rx_bytes_delta           INTEGER,
    tx_bytes_delta           INTEGER,

    edge_rtt_ms              REAL,
    probe_data_json          TEXT,

    PRIMARY KEY(node_id, bucket_start_ms),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) WITHOUT ROWID;
```

Bucket：

```text
bucket_start_ms = floor(worker_received_at_ms / 60000) * 60000
```

同一分钟多个持久化请求使用 UPSERT；V1 默认保存该 bucket 的**最新快照**，`rx_bytes_delta/tx_bytes_delta` 表示该 bucket 可确认的 counter delta。

## 27.7 metrics_hourly

```sql
CREATE TABLE metrics_hourly (
    node_id            TEXT NOT NULL,
    bucket_start_ms    INTEGER NOT NULL,

    cpu_avg_pct        REAL,
    cpu_max_pct        REAL,

    memory_avg_bytes   INTEGER,
    memory_max_bytes   INTEGER,

    rootfs_used_last_bytes INTEGER,

    disk_read_avg_bps  INTEGER,
    disk_write_avg_bps INTEGER,

    rx_bytes           INTEGER,
    tx_bytes           INTEGER,

    edge_rtt_avg_ms    REAL,
    edge_rtt_max_ms    REAL,

    probe_data_json    TEXT,

    PRIMARY KEY(node_id, bucket_start_ms),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) WITHOUT ROWID;
```

## 27.8 traffic_periods

账期流量不应每个 report 直接 `+= delta`。

使用 segment baseline 模型：

```sql
CREATE TABLE traffic_periods (
    node_id                 TEXT NOT NULL,
    period_start_ms         INTEGER NOT NULL,

    finalized_rx_bytes      INTEGER NOT NULL DEFAULT 0,
    finalized_tx_bytes      INTEGER NOT NULL DEFAULT 0,

    active_counter_id       TEXT,
    active_rx_base_bytes    INTEGER,
    active_tx_base_bytes    INTEGER,

    updated_at_ms           INTEGER NOT NULL,

    PRIMARY KEY(node_id, period_start_ms),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
) WITHOUT ROWID;
```

当前账期显示值：

```text
rx = finalized_rx_bytes
   + max(0, current_rx_total - active_rx_base_bytes)

tx = finalized_tx_bytes
   + max(0, current_tx_total - active_tx_base_bytes)
```

当 `counter_id` 变化时：

1. 用旧 counter 的最后持久值 finalize 当前 segment。
2. 更新 `finalized_*`。
3. 新 counter 的当前 total 成为新的 `active_*_base_bytes`。

这样不会因为 Agent/Worker request retry 重复累计流量，也不需要每个 report 修改 traffic row。

账期边界无法保证恰好在 00:00 UTC 获得一个 network counter sample。V1 以边界后的第一份可信持久样本切换 period；因此边界附近最多存在约一个 report/persistence interval 的归属误差。**总累计流量仍由 Counter 保持连续，但两个账期之间的精确切分不是运营商级计费精度。**UI/README 不得把该统计宣称为 billing-grade。

## 27.9 alert_rules

```sql
CREATE TABLE alert_rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         TEXT,
    type            TEXT NOT NULL,
    threshold       REAL,
    duration_sec    INTEGER,
    enabled         INTEGER NOT NULL DEFAULT 1,
    config_json     TEXT,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,

    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);
```

`node_id=NULL` 可表示全局默认规则。

## 27.10 alert_states

```sql
CREATE TABLE alert_states (
    rule_id              INTEGER PRIMARY KEY,
    active               INTEGER NOT NULL DEFAULT 0,
    pending_since_ms     INTEGER,
    active_since_ms      INTEGER,
    last_notified_at_ms  INTEGER,
    updated_at_ms        INTEGER NOT NULL,

    FOREIGN KEY(rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
);
```

## 27.11 events

```sql
CREATE TABLE events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id    TEXT,
    ts_ms      INTEGER NOT NULL,
    type       TEXT NOT NULL,
    data_json  TEXT,

    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX idx_events_node_time
ON events(node_id, ts_ms DESC);
```

---

# 28. D1 Persistence 策略

默认：

```text
Agent sample           2 sec
Agent normal report   30 sec
Probe                  60 sec
D1 node_state persist 60 sec
D1 raw bucket          60 sec
Hourly rollup           1 hour
```

Worker 每个 report 都能实时广播，但只有 persistence due 时写 `node_state` / `metrics_raw`。

对于从 offline 恢复、active instance 变化、counter domain 变化等重要 transition，可以强制立即持久化，不等待 60 秒窗口。

## 28.1 Retention

```text
metrics_raw       7 days
metrics_hourly  365 days
events            90 days
traffic_periods   permanent
nodes/config/geo  permanent
```

## 28.2 Free-plan Capacity Guidance

默认 30 秒 Agent report：

```text
2880 Agent requests / node / day
```

默认每分钟写 `node_state + metrics_raw`：

```text
约 2880 D1 row writes / node / day
```

这还没有计算管理员请求、Cron、Geo/config 更新、DO 使用和实时 lease。

因此项目文档只能给出**保守建议**：

> Workers Free + D1 Free 默认配置建议按约 20~25 个常驻节点设计并保留配额余量；更多节点应提高 report/history 间隔或使用 Paid plan。

该数字是容量规划建议，不是 Cloudflare 平台硬上限。

2 秒 realtime 可能快速消耗 request/DO 配额，因此它必须是详情页的临时行为，不是全站常态。

---

# 29. Traffic Period 规则

V1 `traffic_reset_day`：

- Worker-side Node setting。
- 有效值 1..31。
- reset time 固定为 **00:00 UTC**。
- 若某月不存在该日期（例如 31 日），该月使用最后一个 calendar day 的 00:00 UTC。

V1 不使用自动 Geo timezone 计算流量账期，因为 Geo 可能变化或不准确。

Traffic limit/quota 也是 Worker-side setting，不下发 Agent。

---

# 30. History 与 Rollup

History API：

```text
GET /api/public/nodes/:id/history?range=24h
```

选择：

```text
1h / 6h / 24h / 7d -> metrics_raw
30d / 90d / 1y     -> metrics_hourly
```

返回明确：

```json
{
  "resolution_sec": 60,
  "from_ms": 0,
  "to_ms": 0,
  "points": []
}
```

Hourly Cron 对上一完整小时做 idempotent UPSERT：

```text
CPU           avg / max
Memory        avg / max
RootFS        last
Disk IO       avg
Network bytes sum(rx_bytes_delta / tx_bytes_delta)
Edge RTT      avg / max
Probe         avg / max / loss summary
```

Rollup 完成后，cleanup 才可以删除过期 raw rows。

---

# 31. Cron

使用 3 个明确 Cron，比每分钟执行所有判断更清晰：

```text
* * * * *      offline/resource alert evaluation
5 * * * *      hourly rollup（上一完整小时）
30 3 * * *     retention cleanup（UTC）
```

Cloudflare Cron 使用 UTC。

`scheduled()` 必须根据 `controller.cron` 分支，并保证 rollup/cleanup 可重复执行。

Geo refresh 不属于 Cron；Realtime lease 也不需要 Cron maintenance。

---

# 32. 告警语义

V1：

```text
offline
cpu
memory
disk
expiry
```

## 32.1 Online/Offline

Online 状态使用 **Worker receive time**，不信任 Agent `ts_ms`。

默认：

```text
offline_threshold_sec = 180
```

默认 persistence 为 60 秒，因此 180 秒比 90 秒更不容易因持久化粒度和网络抖动误报。

实时页面可用收到的 WebSocket timestamp 提供更即时的视觉状态；告警以持久状态/Cron 为准。

## 32.2 Resource Alert

`CPU > 90% for 5 minutes` 的含义：

- 只用有效、非 null 的持久样本。
- 必须连续满足阈值达到 duration。
- missing/unavailable sample 默认中断 pending window。
- recovery 也必须落事件，避免只通知触发不通知恢复。

Disk total/limit 不可信时不得触发 Disk percent alert。

---

# 33. Notification

V1 只实现 Webhook。

Webhook config：

```text
URL
Method
Headers
Body template
Timeout
```

敏感 header/token 必须加密存入 `secret_settings`。AES-GCM 每次写入必须生成新的 96-bit random nonce，禁止 nonce 重用。

`DATA_ENCRYPTION_KEY` 旋转不能直接替换 secret 后结束；必须先完成旧数据 decrypt + new-key re-encrypt，否则历史 secret 将不可读取。V1 运维文档必须说明这一点。

HTTP timeout 建议 10 秒。

通知失败：

- 写 event/log。
- 可有限重试。
- 禁止无限重试或阻塞 Agent ingest path。

---

# 34. Admin Auth

V1 是单管理员系统，不实现用户名/密码数据库。

## 34.1 Admin Key

使用 Worker Secret：

```text
ADMIN_KEY
```

要求 ADMIN_KEY 是至少 32 random bytes 的高熵 base64url secret，通过：

```text
wrangler secret put ADMIN_KEY
```

配置。

这种设计避免在 Free Worker 的 10 ms CPU budget 中执行高 work-factor password KDF，同时比存储低熵用户密码再做快速 SHA-256 更安全。

V1 管理登录界面输入的是 **Admin Key**，不是任意用户密码。

## 34.2 Session

登录成功后签发：

```text
HttpOnly
Secure
SameSite=Strict
Path=/
```

Session 使用 `SESSION_SECRET` Worker Secret 做 HMAC-SHA-256 签名。

Session payload：

```text
issued_at_ms
expires_at_ms
admin_key_version
```

`admin_key_version` 可由当前 `ADMIN_KEY` 的 SHA-256 digest 截断版本标识派生；旋转 ADMIN_KEY 后旧 session 自动失效。

默认 session lifetime 建议 12 小时。

## 34.3 CSRF / Origin

Admin 的 POST/PATCH/DELETE：

- MUST require same-origin `Origin`（或严格等价检查）。
- MUST use JSON content-type。
- 不开放 CORS。

Public API 可 GET；Agent API 使用 Bearer token，不依赖 browser cookie。

---

# 35. Worker Secrets

Deployment 至少配置：

```text
ADMIN_KEY
SESSION_SECRET
DATA_ENCRYPTION_KEY
```

都必须使用安全随机值。

禁止把这些 secret 写入：

```text
wrangler.jsonc
D1
Git repository
frontend bundle
```

---

# 36. API 分域

## Agent

```text
POST /api/agent/v1/hello
POST /api/agent/v1/report
```

## Auth

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
```

## Public

```text
GET /api/public/config
GET /api/public/nodes
GET /api/public/nodes/:id
GET /api/public/nodes/:id/history
```

## Admin

```text
GET    /api/admin/nodes
POST   /api/admin/nodes
GET    /api/admin/nodes/:id
PATCH  /api/admin/nodes/:id
DELETE /api/admin/nodes/:id
POST   /api/admin/nodes/:id/token
PATCH  /api/admin/nodes/:id/config
GET    /api/admin/settings
PATCH  /api/admin/settings
GET    /api/admin/alerts
POST   /api/admin/alerts
PATCH  /api/admin/alerts/:id
DELETE /api/admin/alerts/:id
POST   /api/admin/notifications/test
```

## Realtime

```text
GET /api/realtime
Upgrade: websocket
```

Public API DTO 必须通过 allowlist 构造；禁止把 D1 `nodes` row 直接 JSON serialize 给 public client，尤其不能泄露 `token_hash`、完整 `egress_ip`、内部设置。

`hidden=1` 的明确语义：节点仍存在且 Admin 可见，但不出现在 public dashboard 与普通 overview；是否参与告警由独立 alert rule 决定，隐藏不等于停用监控。

---

# 37. Dashboard

## 37.1 首页

顶部指标：

```text
Nodes
Online
Offline
Countries
Period RX
Period TX
Average Probe RTT
```

世界地图 + 节点卡片。

节点卡示例：

```text
🇯🇵 Tokyo-01        ONLINE
Docker · 0.5 cores

CPU        27%
RAM        183 / 512 MB
Disk       N/A       # container quota unknown

↓ 1.2 MB/s
↑ 183 KB/s

CF NRT       8 ms
CT          42 ms
CU          58 ms
CM          49 ms
```

## 37.2 Node Detail

Current：

```text
CPU
CPU throttling
Memory
Working Set
Swap
RootFS
Disk IO
Network speed
Traffic period
Uptime
Edge RTT
Probe RTT/Loss
```

History：

```text
CPU
Memory
Network
Disk IO
Edge RTT
Probe
```

Ranges：

```text
1h / 6h / 24h / 7d / 30d / 90d / 1y
```

Environment：

```text
Type
Runtime
Cgroup
Host virtualization hint
Metric source
```

Network：

```text
Country
Region
City
ASN
AS Organization
Cloudflare Colo
Egress IP（Admin only）
```

---

# 38. 管理后台

## Nodes

```text
Add / Delete / Sort / Hide
Name
Expiry
Notes
Location auto/manual
Traffic reset day
Traffic quota
```

## Agent Config

```text
sample interval
report interval
probe interval
network interface
probe targets
enabled metrics
```

## Node Create

创建后只展示一次：

```text
Node ID
Node Token
Server URL
```

生产 VPS 推荐不要把 Node Token 放进 command line，因为它可能出现在进程参数列表中。推荐：

```bash
./edgemon-agent \
  --server https://monitor.example.com \
  --id <node-id> \
  --token-file /etc/edgemon/token
```

Token file 权限应为 owner-only（例如 `0600`）；Agent 应在权限明显过宽时发出 warning。

容器环境支持 env：

```text
EDGEMON_SERVER
EDGEMON_NODE_ID
EDGEMON_TOKEN
```

普通非敏感本地配置优先级必须固定：

```text
CLI > environment variables > optional config file > defaults
```

Token 单独定义来源优先级：

```text
token-file > EDGEMON_TOKEN
```

V1 不推荐 `--token <secret>` 命令行参数。

Remote Agent Config 只覆盖允许远程控制的采集字段，不覆盖 Server URL、Node ID、Node Token 或 local-only security flags。

---

# 39. Static Assets / Wrangler

`compatibility_date` 必须在发布时固定，并通过有意识的升级修改；不能在代码中自动使用“当天日期”。

示例：

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "edgemon",
  "main": "worker/src/index.ts",
  "compatibility_date": "<pinned-date>",

  "assets": {
    "directory": "./web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "edgemon",
      "database_id": "<database-id>"
    }
  ],

  "durable_objects": {
    "bindings": [
      {
        "name": "REALTIME",
        "class_name": "RealtimeHub"
      }
    ]
  },

  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["RealtimeHub"]
    }
  ],

  "triggers": {
    "crons": [
      "* * * * *",
      "5 * * * *",
      "30 3 * * *"
    ]
  }
}
```

---

# 40. Worker Entry

```ts
export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },

  scheduled(controller, env, ctx) {
    return runScheduled(controller, env, ctx)
  }
}

export { RealtimeHub }
```

对单个主要 async scheduled task 可以直接 return/await；只有需要并行后台任务时再使用 `ctx.waitUntil()`。

---

# 41. 默认配置

必须区分 Agent Config 与 Worker Settings。

## 41.1 Agent defaults

```json
{
  "sample_interval_sec": 2,
  "report_interval_sec": 30,
  "probe_interval_sec": 60,
  "network_interface": "auto",
  "probes": []
}
```

## 41.2 Worker defaults

其中 `traffic_reset_day` 是**新建 Node 的默认值**；Node 创建后使用 `nodes.traffic_reset_day` 独立保存。

```json
{
  "history_interval_sec": 60,
  "raw_retention_days": 7,
  "hourly_retention_days": 365,
  "event_retention_days": 90,
  "offline_threshold_sec": 180,
  "default_traffic_reset_day": 1,
  "realtime": {
    "enabled": true,
    "interval_sec": 2,
    "lease_sec": 60
  }
}
```

---

# 42. 数据可信度规则

这是 V1 必须通过测试的核心合同。

```text
无法确认资源边界
        ↓
      null / N/A
```

禁止：

```text
容器 memory.max = 512 MB
/proc/meminfo = 128 GB
=> 显示 128 GB
```

必须：

```text
=> memory_limit_bytes = 512 MB
```

禁止：

```text
容器 statvfs("/") = 2 TB backing filesystem
真实套餐未知
=> 显示 1.7 GB / 2 TB
```

必须：

```text
=> rootfs_limit_bytes = null
=> UI: Limit N/A
```

---

# 43. Security Boundary

即使 Worker/Admin 被攻破，Agent 协议也不应提供任意执行能力。

Server 可以改变：

```text
采样频率
报告频率
Probe 频率
网卡选择
公网 Probe targets
enabled metrics
```

Server 永远不能通过 V1：

```text
exec
shell
script
file
process
plugin
arbitrary TCP payload
```

因此项目对外描述应该使用：

> **No arbitrary remote execution**

而不是绝对描述为“单向通信”。

---

# 44. 备份与迁移

## 44.1 Schema migrations

所有 D1 schema 改动必须通过 migrations 文件完成，不允许生产环境手工漂移。

Migration：

- 必须在 local D1 测试。
- 必须在 staging/临时数据库验证。
- 涉及 FK/schema 重构时正确使用 D1 支持的 foreign-key migration 机制。

## 44.2 Backup

生产重大升级前：

- 导出 D1 SQL backup，或确认可用的 D1 Time Travel restore point。
- 不把 Time Travel 当成唯一长期备份策略。

当前 D1 Time Travel retention 依 plan 不同（Free 与 Paid 不同），运维文档必须按部署账户实际 plan 写清楚。

---

# 45. Observability of EdgeMon 自身

Worker 日志不得打印：

```text
Node Token
Authorization header
Admin Key
Session cookie
Webhook secrets
```

结构化日志建议包含：

```text
request_id
route
node_id
status
protocol_error_code
D1 operation result
DO publish result
latency bucket
```

Agent 默认日志：

```text
startup environment summary
selected metric sources
hello result
config revision change
report failures/backoff
probe capability/failure
```

正常每次 2 秒采样不打印日志。

---

# 46. Test Matrix

至少验证：

| 环境 | 必测内容 |
|---|---|
| KVM VPS | Host CPU/RAM/rootfs/network |
| Docker unlimited | 环境识别、netns |
| Docker CPU quota | cpu.max + usage normalization |
| Docker parent CPU quota | ancestor effective quota |
| Docker memory limit | memory.max |
| Docker parent memory limit | ancestor effective memory limit |
| Docker no ICMP privilege | permission/fallback |
| Docker overlay rootfs | 不误报宿主磁盘配额 |
| Pterodactyl | 受限 container resource scope |
| Wispbyte | 实际部署验证后才能标记兼容 |
| KataBump | 小内存/低 CPU quota |
| LXC | cgroup + namespace |
| OpenVZ/Virtuozzo | detection / fallback |
| systemd KVM Agent | 不把 Agent service cgroup 当整机 |
| ARM64 VPS | musl binary / collectors |
| IPv6-only | report + probe + Geo |

---

# 47. Collector Fixtures

除真实环境 integration test 外，必须有 parser fixtures：

```text
/proc/stat
/proc/meminfo
/proc/net/dev
/proc/self/cgroup
/proc/1/cgroup
/proc/self/mountinfo
cgroup v2 cpu.stat
cgroup v2 cpu.max
cgroup v2 memory.stat
cgroup v2 io.stat
cgroup v1 cpuacct/cpu/memory samples
```

特别覆盖：

```text
max/unlimited
parent limit
missing file
permission denied
counter rollback
32/64-bit large counter
malformed partial data
```

Collector 不能因为单一 optional metric 读取失败导致 Agent 退出。

---

# 48. Protocol Contract Tests

`protocol/fixtures` 同时由 Rust 与 Worker 测试。

必须覆盖：

```text
valid hello
valid report
null optional metrics
unknown extra field（按兼容策略处理）
invalid protocol version
missing instance_id
invalid seq
NaN/Infinity impossible JSON cases
out-of-range number
payload too large
stale instance
config revision update
```

V1 forward compatibility：

- Reader **SHOULD** 忽略未知 optional fields。
- 缺失 required fields 必须拒绝。
- 改变已有字段含义/单位属于 breaking change，需要 Protocol V2。

---

# 49. D1 Tests

必须覆盖：

```text
node token auth
node token rotate
FK cascade
raw bucket UPSERT
hourly rollup idempotency
retention cleanup
traffic counter same domain
traffic counter reset
network_counter_id change
manual geo override
Geo null
instance change
alert trigger/recovery
```

---

# 50. Frontend Tests

Dashboard：

```text
0 / 1 / 100 nodes
online/offline/warning
null memory/disk/geo
very long node name
mobile 320px layout
public dashboard disabled
websocket reconnect
```

Map：

```text
null coordinates
same coordinates multiple nodes
manual override
auto geo
invalid coordinate rejected
```

History：

```text
raw vs hourly resolution
empty range
data gap
null metrics
```

---

# 51. 开发阶段

## Phase 0 — Contract First

先固定：

- 本文档。
- `PROTOCOL_V1.md`。
- JSON fixtures。
- `0001_init.sql`。
- Agent/Worker DTO names 与单位。

验收：Rust 与 TS fixture tests 都可运行。

## Phase 1 — Agent Core

实现：

```text
env detector
cgroup v1/v2 resolver
ancestor limit resolution
CPU
Memory
Network
Uptime
HTTP hello/report
```

优先验证 Docker parent limits 与 systemd-host cgroup 两个最容易误判的场景。

## Phase 2 — Worker Ingest

实现：

```text
Node CRUD/token
Agent auth
protocol validate
active instance
Geo normalize
node state
raw bucket
Counter logic
```

## Phase 3 — Dashboard

实现：

```text
Admin Key login
Overview
Node Detail
History uPlot
Public/private switch
```

## Phase 4 — Geo & Map

实现：

```text
Cloudflare Geo
ASN
PoP
Edge RTT
Manual override
Prebuilt SVG world map
```

## Phase 5 — Probe

实现：

```text
ICMP capability
TCP connect probe
private-target policy
Latency/loss
```

## Phase 6 — Realtime

实现：

```text
RealtimeHub SQLite DO
Hibernation WS
overview subscription
node detail subscription
realtime hint/lease
```

## Phase 7 — Traffic / Alerts / Webhook

实现：

```text
traffic baseline segments
traffic period UI
offline/resource/expiry alerts
secret_settings encryption
Webhook
Events
```

## Phase 8 — Rollup / Retention / Release

实现：

```text
hourly rollup
cleanup
backup/migration docs
amd64/arm64 musl release
full environment matrix
```

---

# 52. V1 Release Acceptance Criteria

V1 发布前必须满足：

1. Docker 512 MB memory limit 不会显示 host memory。
2. Docker 0.25 CPU quota 显示 0.25 cores，并以该 capacity 归一化使用率。
3. 父 cgroup 限制能被正确解析。
4. KVM/systemd service 不会把 Agent 自身 service cgroup 当成整机资源。
5. 容器磁盘配额不确定时 UI 显示 N/A，而不是 host disk。
6. Agent restart 不会因 `seq` 重置被 Server 永久判重。
7. Container/netns 重建不会产生负流量或巨量错误流量。
8. Duplicate/retry report 不会重复增加账期流量。
9. Geo 与 Cloudflare Colo 在 API/UI 中是不同字段。
10. Edge RTT 与 Probe RTT 在 UI 中明确区分。
11. 首页打开不会让全部 Agent 进入 2 秒 realtime。
12. DO hibernation 后 Browser subscription 可恢复。
13. D1 raw/history retention 可重复执行。
14. Public API 不泄露 token hash、Admin secret、完整 egress IP。
15. Agent/Worker 不存在 exec/shell/file/script endpoint。
16. amd64 与 arm64 musl binary 在目标环境启动成功。
17. 默认配置下有明确 Free-plan 容量说明，不声称“无限免费”。

---

# 53. 最终架构基线

```text
┌──────────────────────────────────────────────┐
│                   Web                        │
│ React 19 + TypeScript                        │
│ Router / Query / Realtime / Map / uPlot      │
├──────────────────────────────────────────────┤
│             Cloudflare Worker                │
│ Auth / Protocol / Geo / Traffic / Alerts     │
├──────────────────────┬───────────────────────┤
│ D1                   │ RealtimeHub DO        │
│ Persistent Truth     │ Hibernating Realtime  │
├──────────────────────┴───────────────────────┤
│              Telemetry Protocol V1           │
│                 JSON / HTTPS                 │
├──────────────────────────────────────────────┤
│                 Rust Agent                   │
│ env / cgroup / procfs / sysfs / probes       │
└──────────────────────────────────────────────┘
```

V1 的核心不是“比其他监控项目功能更多”，而是：

> **在不知道自己运行于 VPS 还是受限容器的前提下，先确定资源边界，再采集可证明属于该边界的数据。**

Cloudflare 端则始终坚持：

> **D1 负责持久化，Durable Object 负责浏览器实时协调，Static Assets 负责前端，Worker 负责协议与控制面。**

---

# 54. 官方资料基线

实施时优先参考以下官方资料，并在依赖重大平台行为前重新核对：

- Cloudflare Workers — Static Assets  
  https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Workers — Request / `request.cf`  
  https://developers.cloudflare.com/workers/runtime-apis/request/
- Cloudflare Workers — Platform Limits  
  https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 — Limits  
  https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 — Pricing  
  https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 — Foreign Keys  
  https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- Cloudflare Durable Objects — WebSockets / Hibernation  
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Durable Objects — Pricing  
  https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare Cron Triggers  
  https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare Workers — Web Crypto  
  https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- Linux Kernel — cgroup v2  
  https://docs.kernel.org/admin-guide/cgroup-v2.html

---

## 附录 A：V1 最小实现任务清单

- [ ] 初始化 Monorepo
- [ ] React 19 / Vite / React Router / TanStack Query / Zustand
- [ ] Worker / Hono
- [ ] D1 + `0001_init.sql`
- [ ] SQLite-backed `RealtimeHub` DO
- [ ] 固定 Protocol V1 fixtures
- [ ] Rust Agent Envelope / Hello / Report
- [ ] Environment Detector
- [ ] Container-vs-machine resource scope
- [ ] cgroup v2 ancestor resolver
- [ ] cgroup v1 resolver
- [ ] CPU collector
- [ ] Memory collector
- [ ] Network collector + `counter_id`
- [ ] RootFS trust policy
- [ ] Disk IO collector
- [ ] Uptime collector
- [ ] Agent HTTPS transport / timeout / backoff
- [ ] Node CRUD + token rotation
- [ ] Agent Auth
- [ ] active `instance_id`
- [ ] Geo / ASN / Colo / Edge RTT
- [ ] node_state persistence
- [ ] metrics_raw bucket UPSERT
- [ ] traffic baseline segment model
- [ ] Dashboard overview
- [ ] Node detail
- [ ] uPlot history
- [ ] SVG world map
- [ ] ICMP/TCP probes
- [ ] Private probe protection
- [ ] RealtimeHub Hibernation WS
- [ ] Overview/detail subscription separation
- [ ] Realtime hint lease
- [ ] Alerts
- [ ] AES-GCM secret settings
- [ ] Webhook
- [ ] Hourly rollup
- [ ] Retention cleanup
- [ ] Backup/migration docs
- [ ] amd64 musl release
- [ ] arm64 musl release
- [ ] Full test matrix

