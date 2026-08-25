# EdgeMon WSS 实时遥测架构实施方案

> 版本：WSS Architecture v1.0  
> 日期：2026-08-25  
> 代码基线：`dooooling/edgemon` `main` @ `a2340c304504b6dd0a139e890d8aa79f84332449`  
> 协议：EdgeMon Protocol V1.1（Envelope `v` 继续保持 `1`）

## 1. 最终决策

EdgeMon Agent 主链路改为：

```text
Rust Agent
    │
    │ WSS /api/agent/v1/stream
    │ report every 2s
    ▼
Cloudflare Worker
    │ authenticated upgrade
    ▼
RealtimeHub Durable Object
    │
    ├──── realtime ───► Browser
    │
    └──── 60s checkpoint ───► D1
```

HTTP 继续保留，但只作为 WSS 不可用时的 fallback。

正式默认值：

```text
Local sample interval       2s
WSS report interval         2s
Probe interval             60s
D1 node_state checkpoint   60s
D1 metrics_raw resolution  60s
HTTP fallback interval     30s
Protocol Ping interval     30s
Reconnect backoff     1/2/4/8/16/30/60s + jitter
Offline threshold          90s
```

必须删除“有人查看详情页才提频”的 Realtime Lease 状态机。浏览器是否打开页面不再改变 Agent 上报频率。


## 2. 设计原则

1. **WSS 是主传输，HTTP 是故障降级传输。**
2. **2 秒 WSS 不等于 2 秒写 D1。**
3. **Report 是完整当前 Snapshot，不是 patch。**
4. **Agent 断线时不缓存历史 Report 队列，只保留最新 Snapshot。**
5. **网络长期流量以累计 Counter 为准，不使用 `bps × elapsed` 推算。**
6. **D1 是持久业务数据源，DO 内存/attachment 只是运行态协调。**
7. **协议只允许 Telemetry 与有限 Config，永远不增加 exec/shell/file/script/process/RPC 等远程执行能力。**
8. **Agent `instance_id` 在进程生命周期内不变；WSS 重连不能重新生成。**
9. **`seq` 在同一 `instance_id` 内单调递增，WSS/HTTP fallback 共用同一序列。**
10. **所有 online/offline、bucket、billing period、alert timing 使用 Server Time。**


## 3. 为什么不用 30s HTTP + Realtime Lease

当前模型：

```text
用户打开详情页
      ↓
等待 Agent 下一次 30s Report
      ↓
Worker ACK 才带 realtime lease
      ↓
Agent 切 2s
```

最坏启动等待接近 30 秒。

改为永久 WSS 2 秒后：

```text
Agent ──2s──► DO ──► Browser
```

页面无需唤醒 Agent，最多等待下一帧约 0～2 秒。

同时删除：

```text
realtime_lease_until
detailWatched
node:watch:<id>
lease_sec
realtime_start / stop
ACK realtime hint
```


## 4. Cloudflare 约束

Durable Object 必须继续使用 Hibernation WebSocket API：

```ts
this.ctx.acceptWebSocket(server, tags)
```

禁止使用普通 `server.accept()` 作为长期连接实现。

DO 内禁止永久：

```ts
setInterval(...)
setTimeout(...)
```

截至 2026-08-25，Cloudflare 官方当前边界：

```text
WebSocket connections / DO          32,768
Received WebSocket message          32 MiB
serializeAttachment maximum         16,384 bytes
DO Free requests                    100,000/day
DO Free duration                    13,000 GB-s/day
D1 Free rows written                100,000/day
D1 Free rows read                   5,000,000/day
Incoming WS billing ratio           20 messages : 1 request equivalent
Outgoing WS messages                no request charge
Incoming RFC6455 protocol ping      no request charge
```

EdgeMon 自己必须设置远低于平台上限的协议限制：

```text
Hello/config frame      <= 16 KiB
Report frame             <= 8 KiB
Browser control frame    <= 4 KiB
Attachment target        <= 2 KiB
```

超限关闭：

```text
1009 Message Too Big
```


## 5. Endpoint

### Agent 主链路

```text
GET /api/agent/v1/stream
```

Upgrade headers：

```http
Upgrade: websocket
Connection: Upgrade
Authorization: Bearer <node_token>
X-Node-ID: <node_id>
X-Agent-Instance-ID: <instance_id>
User-Agent: EdgeMon-Agent/<version>
```

生产必须使用 `wss://`。只有显式本地开发参数允许 `ws://`。

### HTTP fallback

继续保留：

```text
POST /api/agent/v1/hello
POST /api/agent/v1/report
```

正常：

```text
WSS connected
→ HTTP report = 0
```

故障：

```text
WSS disconnected
├── reconnect with backoff
└── HTTP report every 30s
```

WSS 完成 `welcome` 后立即停止 HTTP fallback。

任何时刻只允许一个 Telemetry transport 提交 Report：

```text
WSS XOR HTTP
```


## 6. Protocol V1.1

保持现有 Envelope：

```json
{
  "v": 1,
  "type": "report",
  "instance_id": "01991f4e-a3d7-7c4e-aef1-9a1b6c03d442",
  "seq": 1837,
  "ts_ms": 1787650000123,
  "data": {}
}
```

Agent → Server：

```text
hello
report
config_ack
error
```

Server → Agent：

```text
welcome
config
ack
error
```

其中：

- `hello`：每次 WSS 新连接后的第一条业务消息；
- `report`：默认每 2 秒；
- `config_ack`：确认配置 revision；
- `welcome`：Hello 成功响应；
- `config`：服务端主动下发有限配置；
- `ack`：只用于低频 checkpoint/HTTP fallback，不对每个 2s Report 回复；
- `error`：协议错误。

永远不定义：

```text
exec
shell
terminal
script
file
process
docker
plugin
command
generic rpc
```


## 7. 建连流程

```text
Agent Start
  │
  ├─ generate instance_id
  ├─ seq = 1
  ├─ detect environment
  └─ initialize collectors
  │
  ▼
WSS Upgrade
  │
  ▼
Worker
  ├─ validate Upgrade
  ├─ validate node_id / instance_id
  ├─ verify token
  ├─ verify node exists/not expired
  ├─ extract request.cf metadata
  └─ forward trusted identity to DO
       │
       ▼
DO acceptWebSocket
       │
       ▼
Agent sends hello
       │
       ▼
DO validates hello
  ├─ v == 1
  ├─ instance matches upgrade header
  └─ seq valid
       │
       ▼
register active instance
       │
       ▼
welcome + latest config
       │
       ▼
STREAMING
```

Worker 必须在进入 DO 前完成 Node Token 鉴权。raw token 不放 URL、不进入 attachment、不写日志。


## 8. RealtimeHub Tags / Attachments

Agent tags：

```text
role:agent
agent:<node_id>
```

Browser tag：

```text
role:browser
```

Agent attachment 建议：

```ts
interface AgentAttachment {
  kind: "agent";
  node_id: string;
  instance_id: string;
  hello_ok: boolean;
  connected_at_ms: number;
  last_seq: number;
  last_report_received_at_ms: number;
  config_rev: number;
  last_persist_bucket_ms: number;
  last_counter_id: string | null;
  last_rx_total_bytes: number | null;
  last_tx_total_bytes: number | null;
  active_period_start_ms: number | null;
}
```

Browser attachment：

```ts
interface BrowserAttachment {
  kind: "browser";
  authenticated: boolean;
  scope: "overview" | "node";
  node_id?: string;
}
```

需要跨 hibernation 保留的字段修改后必须重新：

```ts
ws.serializeAttachment(attachment)
```

attachment 不保存 Token、不保存历史指标、不复制完整 D1 数据。


## 9. Active Instance / Seq

每个 Node 只允许一个 active Agent。

新进程：

```text
node=A instance=2
```

成功完成 Hello 后，关闭旧：

```text
node=A instance=1
```

建议 close：

```text
4002 REPLACED_BY_NEW_INSTANCE
```

D1 增加：

```sql
ALTER TABLE nodes ADD COLUMN active_instance_id TEXT;
ALTER TABLE nodes ADD COLUMN active_instance_started_at_ms INTEGER;
ALTER TABLE nodes ADD COLUMN last_stream_connected_at_ms INTEGER;
ALTER TABLE nodes ADD COLUMN last_stream_disconnected_at_ms INTEGER;
```

同进程 WSS reconnect：

```text
instance_id 不变
seq 不重置
```

新 Agent process：

```text
new instance_id
seq 从 1 开始
```

DO 每条 Agent message：

```text
seq > last_seq  → accept
seq == last_seq → duplicate/drop
seq < last_seq  → stale/drop
```

不要每 2 秒查询 D1 校验 seq。

HTTP fallback 必须进入同一个 DO ingest 核心做 instance/seq 验证。


## 10. Hello / Welcome

Hello 继续只放静态/低频元数据。

Welcome 建议：

```json
{
  "v": 1,
  "type": "welcome",
  "instance_id": "...",
  "seq": 1,
  "ts_ms": 1787650000050,
  "data": {
    "config_rev": 8,
    "config": {
      "sample_interval_sec": 2,
      "stream_interval_sec": 2,
      "probe_interval_sec": 60,
      "network_interface": "auto",
      "probes": []
    }
  }
}
```

`report_interval_sec` 在新 Agent 配置中应重命名为：

```text
stream_interval_sec
```

HTTP fallback interval 是 Agent transport 固定策略，不是服务端常规 telemetry interval。


## 11. Report

继续使用现有 `report` 名称，不改成 `telemetry`，保持 transport-neutral。

```json
{
  "v": 1,
  "type": "report",
  "instance_id": "...",
  "seq": 1837,
  "ts_ms": 1787650002000,
  "data": {
    "config_rev": 8,
    "boot_id": "...",
    "cpu": {
      "usage_pct": 27.4,
      "throttled_pct": 0
    },
    "memory": {
      "used_bytes": 184549376,
      "working_set_bytes": 173015040,
      "swap_used_bytes": 0
    },
    "rootfs": {
      "used_bytes": 1291845632
    },
    "io": {
      "read_bps": 10240,
      "write_bps": 8192
    },
    "network": {
      "counter_id": "...",
      "interface": "eth0",
      "rx_bps": 18273,
      "tx_bps": 8273,
      "rx_total_bytes": 918273645,
      "tx_total_bytes": 281736451
    },
    "uptime_sec": 8273,
    "probes": []
  }
}
```

Report 必须是完整 Snapshot，不是 patch。丢一帧不要求补发。


## 12. Rust Agent 并发模型

保持同步优先，不需要为了 WSS 立即引入 Tokio。

推荐两条主要线程：

```text
Thread 1: Collector/Main
────────────────────────
sample every 2s
probe every 60s
update LatestSnapshot


Thread 2: Transport
────────────────────────
WSS connect/reconnect
WSS read/write
send report every 2s
protocol ping
config handling
HTTP fallback
```

共享：

```rust
Arc<RwLock<LatestSnapshot>>
```

禁止：

```text
unbounded channel
VecDeque accumulating reports
persistent local report queue
```

网络断开时只保留最新 Snapshot。

理由：

- CPU/RAM 是 gauge，旧值不值得补发；
- 网络有累计 counter，新值覆盖断线区间；
- 防止小容器网络异常时 Agent 内存增长。


## 13. Rust WSS 库

建议新增同步 `tungstenite`，配 Rustls + 编译内置 WebPKI roots。

方向：

```toml
tungstenite = {
  version = "0.30",
  default-features = false,
  features = [
    "handshake",
    "rustls-tls-webpki-roots"
  ]
}
```

实际提交时以锁定版本编译验证 feature names。

现有 `ureq` 保留，仅用于 HTTP fallback。

V1 不同时引入：

```text
tokio
reqwest
tokio-tungstenite
hyper
```

除非同步实现经真实测试证明不可接受。


## 14. Transport State Machine

```text
STARTING
   │
   ▼
CONNECTING
   │
   ├─ success → WAIT_WELCOME → STREAMING
   │
   └─ failure → BACKOFF
                   │
                   ├─ retry WSS
                   └─ HTTP fallback every 30s
```

Reconnect：

```text
1 → 2 → 4 → 8 → 16 → 30 → 60s max
```

每次加 `±20% jitter`。

完成 `welcome` 后 backoff reset。

Agent transport 必须串行选择 WSS/HTTP，避免 reconnect 与 HTTP request 并发提交相邻 seq。


## 15. Keepalive

Agent 使用 RFC6455 protocol Ping/Pong：

```text
Ping every         30s
Pong timeout       10s
No healthy read    90s → reconnect
```

不要使用高频：

```json
{"type":"heartbeat"}
```

作为主保活。

Cloudflare 当前对 incoming WebSocket protocol ping 不按 application message request 计费。

Browser 无法从 JS 发送 RFC6455 Ping，可依赖 close/error/reconnect；确有需要再使用极低频 app ping + `setWebSocketAutoResponse()`。


## 16. WSS Report Hot Path

每帧：

```text
1. size validate
2. JSON parse
3. envelope validate
4. attachment kind == agent
5. instance validate
6. seq validate
7. metric range validate
8. received_at_ms = Date.now()
9. update runtime traffic counter
10. realtime broadcast
11. persistence gate
12. optional D1 checkpoint
13. serialize attachment
```

关键要求：

```text
每 2 秒 hot path 不查 D1
```


## 17. 时间语义

Agent `ts_ms` 是采样/发送时间。

Server 生成：

```text
received_at_ms
```

以下必须使用 Server Time：

```text
online/offline
60s persistence bucket
traffic billing period
alert duration
event time
retention
```

可额外计算：

```text
clock_skew_ms = received_at_ms - agent.ts_ms
```

Agent 时钟错误不能破坏服务端时序。


## 18. 60 秒 Persistence Gate

```text
bucket_ms =
floor(received_at_ms / 60000) * 60000
```

若：

```text
bucket_ms > attachment.last_persist_bucket_ms
```

执行 checkpoint。

否则：

```text
只 broadcast，不写 D1
```

示例：

```text
00 report → realtime + D1
02 report → realtime
04 report → realtime
...
58 report → realtime
60 report → realtime + D1
```

Report Frequency 与 Persistence Frequency 必须始终解耦。


## 19. D1 Checkpoint

建议使用 `DB.batch()` 将同一 checkpoint 的持久化作为一个事务提交：

```text
node_state UPSERT
metrics_raw INSERT/UPSERT
必要时 traffic_periods UPDATE
必要时 events INSERT
```

Cloudflare 当前 D1 `batch()` 保证 statements 顺序执行，并作为 SQL transaction；其中一个失败会中止/回滚整个 batch。

`node_state` 表示最近一次持久 Snapshot，不表示每个 realtime frame。


## 20. Traffic Counter

必须继续上报：

```text
rx_bps
tx_bps
rx_total_bytes
tx_total_bytes
counter_id
```

`bps` 只用于 UI；累计流量使用 total counter。

### Same counter

```text
current >= previous
```

runtime step：

```text
current_total - previous_total
```

attachment 每 2 秒更新最后 counter snapshot，但不每 2 秒写 D1。

### Counter ID change

必须用旧 attachment 的最后旧 counter total 结算旧 segment：

```text
old_segment =
last_old_total - active_segment_base
```

然后：

```text
finalized += old_segment
active_counter_id = new_counter
active_segment_base = current_new_total
```

绝不能：

```text
current_new_total - old_base
```

因为两个值不属于同一个 counter domain。

### Same counter rollback

若：

```text
current_total < previous_total
```

按 counter reset 处理，不计算负 delta。


## 21. Traffic Period 写入策略

`traffic_periods` 不需要每 2 秒更新。

只在：

```text
period initialize
counter change/reset
billing period rollover
```

写入。

允许以下稀有事件突破常规 60s metrics checkpoint，立即做一次 best-effort persistence：

```text
counter change
billing period rollover
WebSocket close
Agent replacement
graceful shutdown
```

这是正确性事件，不是高频 history 写入。

极端崩溃导致 close handler 也未执行时，最大未持久 counter 误差仍以最近一次 60s checkpoint 为界。


## 22. Browser Realtime

初始：

```text
REST /api/public/nodes
→ D1 Snapshot
```

随后：

```text
WSS /api/realtime
→ Realtime Overlay
```

前端状态继续：

```text
TanStack Query = persistent REST state
Zustand        = realtime overlay
Local State    = UI interaction
```

Browser WS 断线时保留 REST/D1 snapshot，并显示 realtime disconnected。

Always-on 2s 后 Overview/Detail 都不再触发 Agent 状态变化，因此删除 `node:watch` / `detailWatched`。


## 23. Config Push

Admin：

```text
PATCH /api/admin/nodes/:id/config
```

Worker：

```text
validate
revision++
D1 persist
hub.pushConfig(...)
```

在线 Agent 立即收到：

```json
{
  "v": 1,
  "type": "config",
  "instance_id": "...",
  "seq": 0,
  "ts_ms": 1787650200000,
  "data": {
    "config_rev": 9,
    "config": {
      "sample_interval_sec": 2,
      "stream_interval_sec": 2,
      "probe_interval_sec": 60,
      "network_interface": "auto",
      "probes": []
    }
  }
}
```

Agent 成功后：

```json
{
  "v": 1,
  "type": "config_ack",
  "instance_id": "...",
  "seq": 1940,
  "ts_ms": 1787650200100,
  "data": {
    "config_rev": 9,
    "status": "applied"
  }
}
```

Agent 离线不需要 pending queue；下一次 Hello/Welcome 带最新 config。


## 24. Remote Config 安全边界

允许远程配置：

```text
sample_interval_sec
stream_interval_sec
probe_interval_sec
network_interface
probe targets
```

硬范围建议：

```text
sample_interval_sec    1..60
stream_interval_sec    1..60
probe_interval_sec    10..3600
```

必须 Local-only：

```text
server_url
node_id
node_token
allow_http
allow_private_probes
TLS/CA policy
process privilege
filesystem
```

特别是 `allow_private_probes` 永远不能由 Worker 远程开启。


## 25. Token Rotation / Node Delete

WSS 建立后，仅修改 D1 token 不会自动撤销现有 socket。

因此：

```text
rotate token
delete node
disable node
```

必须执行：

```text
D1 mutation
+
hub.disconnectAgent(node_id)
```

建议：

```text
4003 TOKEN_REVOKED
4004 NODE_DISABLED
```

Agent 收到 token revoked 后进入 fatal auth state，不进行高速无限重连。


## 26. Close Codes

```text
1000 Normal Closure
1002 Protocol Error
1008 Policy Violation
1009 Message Too Big

4001 SERVER_RECONNECT
4002 REPLACED_BY_NEW_INSTANCE
4003 TOKEN_REVOKED
4004 NODE_DISABLED
4005 CONFIG_FATAL
```

Upgrade auth 失败不建立 WebSocket：

```text
401 Unauthorized
403 Expired/Disabled
426 Upgrade Required
```


## 27. Rate Protection

合法 Token 也不能允许坏 Agent 高频刷消息。

协议最低 `stream_interval_sec`：

```text
1s
```

服务端 SHOULD 对持续异常高频做轻量保护，例如：

```text
sustained > 2 reports/sec
or repeated interval < 250ms
```

先 drop，持续 abuse 则 `1008` close。

不要用 D1 实现这个 limiter，使用 connection runtime state 即可。


## 28. Metric Validation

所有数字必须 finite。

拒绝：

```text
NaN
Infinity
-Infinity
```

范围：

```text
*_pct        0..100
loss_ratio   0..1
bytes        >= 0
bps          >= 0
latency_ms   >= 0
uptime_sec   >= 0
```

unavailable 必须为：

```json
null
```

不能用 `0` 伪装不可用数据。


## 29. Geo

WSS Upgrade 仍经过 Worker，因此连接时可读取 `request.cf`：

```text
country
region
city
latitude/longitude
timezone
continent
asn
asOrganization
colo
clientTcpRtt/clientQuicRtt（可用时）
```

语义保持：

```text
Node Geo = Agent egress IP Geo
CF Colo  = Cloudflare edge location
Edge RTT = Agent → Cloudflare edge
```

不能从 `colo` 推断物理服务器国家。

V1 Geo 只需在 WSS connect/reconnect 时刷新。


## 30. Browser/Auth 安全

`/api/realtime`：

- public dashboard 可匿名；
- hidden node 必须 admin；
- admin session 验证 HMAC + role + expiry；
- Cookie `HttpOnly; Secure; SameSite=Strict`；
- SHOULD 验证 Browser Origin；
- 不使用 query-string admin token。

同时修掉生产默认 secret fallback：

```ts
env.ADMIN_KEY || "test-admin-key"
env.SESSION_SECRET || "default-session-secret-change-me"
```

生产必须 fail closed。

统一一个：

```text
verifyAdminSession()
```

供 Admin REST 与 Browser WS 共用。


## 31. HTTP Fallback 必须复用同一 Ingest

目标：

```text
WSS report ──────┐
                 ├── ingestReportCore()
HTTP report ─────┘
```

HTTP route：

```text
auth
extract geo
call RealtimeHub.ingestFallback(...)
```

然后在 DO 内复用：

```text
instance validation
seq validation
counter handling
broadcast
60s D1 gate
```

禁止 WSS 和 HTTP 各自维护一套 traffic/persistence 算法。


## 32. ACK

WSS 不对每个 Report ACK。

默认：

```text
Agent report every 2s
Server silent
```

可在 60s checkpoint 后发送一次低频：

```json
{
  "v": 1,
  "type": "ack",
  "instance_id": "...",
  "seq": 1900,
  "ts_ms": 1787650260000,
  "data": {
    "accepted_seq": 1900,
    "persisted_seq": 1900,
    "config_rev": 9
  }
}
```

Agent 不等待 ACK 才继续发送。


## 33. Cloudflare Free 容量粗算

2 秒一次：

```text
43,200 incoming WS messages/day/node
÷ 20
≈ 2,160 DO request equivalents/day/node
```

| Nodes | WS msg/day | DO request eq/day |
|---:|---:|---:|
| 5 | 216,000 | 10,800 |
| 10 | 432,000 | 21,600 |
| 20 | 864,000 | 43,200 |
| 30 | 1,296,000 | 64,800 |
| 40 | 1,728,000 | 86,400 |

D1 若每 60s 基础写：

```text
node_state 1 row
metrics_raw 1 row
```

基础约：

```text
2 × 1440 = 2880 writes/day/node
```

| Nodes | 基础 D1 writes/day |
|---:|---:|
| 5 | 14,400 |
| 10 | 28,800 |
| 20 | 57,600 |
| 30 | 86,400 |
| 40 | 115,200 |

因此 Free Plan 更可能先被 D1 100k writes/day 限制。

考虑索引、events、config、traffic 等余量，保守产品目标仍建议：

```text
约 20～25 always-on nodes
```

不要宣传“无限免费”。


## 34. 当前仓库改造清单

### Agent

新增：

```text
agent/src/transport/ws.rs
```

修改：

```text
agent/src/transport/mod.rs
agent/src/transport/backoff.rs
agent/src/main.rs
agent/src/config.rs
agent/src/protocol/*
agent/Cargo.toml
```

删除/废弃：

```text
realtime_lease_until
is_realtime
ACK realtime lease handling
target_report_interval based on lease
```

新增：

```text
stream_interval_sec
TransportState
WSS ping/pong
LatestSnapshot
WSS reconnect
HTTP fallback
```

### Worker

新增/重构：

```text
worker/src/routes/agent-stream.ts
worker/src/durable/realtime-hub.ts
worker/src/services/ingest.ts
worker/src/services/session.ts
worker/src/db/persistence.ts
```

`worker/src/routes/agent.ts` 保留 HTTP hello/report，但定位为 fallback。

### Protocol

更新：

```text
protocol/PROTOCOL_V1.md
```

新增/更新 fixtures：

```text
hello
welcome
report
config
config_ack
ack
error
```

### D1

新增：

```text
migrations/0002_wss_active_instance.sql
```

不要恢复 runtime `ensureSchema()`。


## 35. RealtimeHub 职责边界

SHOULD：

```text
Agent socket lifecycle
Browser socket lifecycle
Protocol validation
instance/seq coordination
Realtime broadcast
60s persistence-by-arrival
Traffic runtime counter state
Config push
```

MUST NOT：

```text
arbitrary SQL API
remote execution
shell/file/process management
generic command channel
complex plugin system
```


## 36. 部署迁移顺序

### Stage A — Server First

先部署 Worker：

```text
新增 WSS endpoint
保留现有 HTTP
旧 Agent 继续工作
```

### Stage B — New Agent

发布：

```text
WSS first
HTTP fallback
```

Worker 同时接受 old HTTP Agent 与 new WSS Agent。

### Stage C — Remove Lease

稳定后删除：

```text
realtime lease state
detailWatched
node:watch
ACK realtime hint
```

HTTP fallback endpoint 可以长期保留。


## 37. wrangler

当前仓库 compatibility date 较旧。

WSS 重构测试完成后建议升级至经过测试的当前日期，例如：

```jsonc
"compatibility_date": "2026-08-25"
```

升级 compatibility date 必须先跑 DO/WebSocket integration tests。

Realtime DO 继续使用 SQLite-backed class 和现有 binding：

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "REALTIME",
        "class_name": "RealtimeHub"
      }
    ]
  }
}
```


## 38. 测试矩阵

Agent：

```text
WSS auth success/failure
Hello/Welcome
2s report
Ping/Pong
server close
network timeout
backoff+jitter
WSS→HTTP fallback
HTTP→WSS recovery
seq across reconnect
instance across reconnect
new process instance
config push
invalid config
no unbounded report queue
```

Worker/DO：

```text
invalid token rejected before DO
expired node
HELLO_REQUIRED
instance mismatch
new instance replaces old
same instance reconnect
duplicate/stale seq
message size
invalid metric
2s does not cause 2s D1 writes
60s bucket exactly once
counter unchanged
counter reset
counter_id change
billing rollover
token rotation disconnect
node delete disconnect
config push
hidden node auth
attachment restore
```

E2E：

```text
1 Agent + Browser
20 simulated Agents @2s
Agent restart
connection reset
D1 temporary error
Browser reconnect
token rotation
```


## 39. Acceptance Criteria

Functional：

```text
Agent 默认 WSS
Report 每 2s
Browser 0~2s 获得下一帧
Config 即时推送
HTTP fallback 正常
恢复 WSS 后停止 fallback
```

Persistence：

```text
2s stream != 2s D1 writes
metrics_raw = 1 point/minute/node
node_state <= 1 normal update/minute/node
```

Correctness：

```text
counter reset 无负数
counter change 无巨大 delta
traffic 无重复累计
old instance 无法覆盖 new instance
duplicate seq 不重复持久化
```

Security：

```text
Token 不进 URL
Token rotation 立即断开 socket
Admin secret fail-closed
Session expiry 全链路检查
不存在 exec/shell/file/script
```

Reliability：

```text
WSS failure 不影响采集
HTTP fallback 自动工作
断线不累积无限队列
reconnect 有 jitter
Agent restart 自动恢复
```


## 40. 推荐默认配置

Remote config：

```json
{
  "sample_interval_sec": 2,
  "stream_interval_sec": 2,
  "probe_interval_sec": 60,
  "network_interface": "auto",
  "probes": []
}
```

Local-only：

```text
server_url
node_id
node_token
allow_http
allow_private_probes
log_level
```

Worker：

```text
persistence_interval_sec = 60
offline_after_sec = 90
http_fallback_interval_sec = 30
max_report_bytes = 8192
max_control_bytes = 4096
```


## 41. 实施顺序

```text
1. Protocol V1.1 + fixtures
2. Admin secret/session 安全修复
3. Worker /api/agent/v1/stream
4. RealtimeHub Agent socket + attachment
5. hello / instance / seq
6. 2s WSS realtime broadcast
7. Rust tungstenite transport
8. LatestSnapshot + Transport thread
9. 60s persistence 搬到 shared ingest
10. traffic counter reset/change 修复
11. HTTP fallback → same ingest
12. config push
13. token rotation disconnect
14. 删除 realtime lease
15. integration/load tests
16. README / implementation docs
```

不要继续扩大旧 ACK lease 状态机。


## 42. 最终架构

```text
                 Rust Agent
                     │
             local sample 2s
                     │
                     ▼
               LatestSnapshot
                     │
                     │ WSS report 2s
                     ▼
          RealtimeHub Durable Object
              │                 │
              │                 │
              ▼                 ▼
           Browser             D1
          realtime          every 60s
```

故障：

```text
WSS down
├── reconnect backoff
└── HTTP report 30s
```

恢复：

```text
WSS welcome
→ stop HTTP fallback
→ 2s WSS streaming
```

EdgeMon 的最终产品语义：

> **始终输送秒级实时状态；Cloudflare 只对持久历史做低频 checkpoint。**


## 43. 官方参考

- Cloudflare Durable Objects WebSocket Hibernation  
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Object State / WebSocket Tags / Attachments  
  https://developers.cloudflare.com/durable-objects/api/state/
- Durable Object Lifecycle  
  https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- Durable Object Limits  
  https://developers.cloudflare.com/durable-objects/platform/limits/
- Durable Object Pricing  
  https://developers.cloudflare.com/durable-objects/platform/pricing/
- Cloudflare D1 Pricing  
  https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 `batch()`  
  https://developers.cloudflare.com/d1/worker-api/d1-database/
- Workers Request `cf` metadata  
  https://developers.cloudflare.com/workers/runtime-apis/request/
- Tungstenite  
  https://docs.rs/crate/tungstenite/latest
