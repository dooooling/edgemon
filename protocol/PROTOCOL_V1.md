# EdgeMon Protocol V1.1 Specification

> Version: 1.1 (WSS Architecture v1.0)  
> Primary Transport: WSS `/api/agent/v1/stream` (2s Snapshot Stream)  
> Fallback Transport: HTTP `/api/agent/v1/report` (30s Polling)  
> Persistence Gate: 60s Checkpoint to Cloudflare D1 via `DB.batch()`  

---

## 1. Overview

EdgeMon Protocol V1.1 defines the real-time telemetry and control contract between the **Agent** (running on nodes) and the **Worker RealtimeHub DO** (running on Cloudflare Edge), as well as between the **Worker** and the **Web Dashboard** (via WebSocket).

---

## 2. Standard Message Envelopes

All Agent $\leftrightarrow$ Worker messages are wrapped in standard JSON envelopes:

### 2.1 Agent Envelope (Agent $\rightarrow$ Server)

```json
{
  "v": 1,
  "type": "report",
  "instance_id": "01991f4e-a3d7-7c4e-aef1-9a1b6c03d442",
  "seq": 1837,
  "ts_ms": 1787650002000,
  "data": {}
}
```

- `v`: Protocol version (always `1`).
- `type`: `hello` | `report` | `config_ack` | `error`.
- `instance_id`: Unique UUID generated at Agent process start (immutable across reconnects).
- `seq`: Monotonically increasing sequence number within the current `instance_id`.
- `ts_ms`: Unix timestamp in milliseconds from Agent clock.

### 2.2 Server Envelope (Server $\rightarrow$ Agent)

```json
{
  "v": 1,
  "type": "welcome",
  "instance_id": "01991f4e-a3d7-7c4e-aef1-9a1b6c03d442",
  "seq": 1,
  "ts_ms": 1787650000050,
  "data": {}
}
```

- `type`: `welcome` | `config` | `ack` | `error`.

---

## 3. Endpoints & Transports

### 3.1 WSS Primary Stream
- **Path**: `GET /api/agent/v1/stream` (WebSocket Upgrade)
- **Report Interval**: 2 seconds
- **Ping / Keepalive**: RFC6455 Ping every 30 seconds
- **Headers**:
  - `Authorization: Bearer <node-token>`
  - `X-Node-ID: <node-id>`
  - `X-Agent-Instance-ID: <instance-id>`
  - `User-Agent: EdgeMon-Agent/<version>`

### 3.2 HTTP Fallback
- **Paths**: `POST /api/agent/v1/hello`, `POST /api/agent/v1/report`
- **Fallback Interval**: 30 seconds while WSS is disconnected

---

## 4. Close Codes

- `1000`: Normal Closure
- `1002`: Protocol Error
- `1008`: Policy Violation (e.g. Hello required before report)
- `1009`: Message Too Big (Frame > 16KB)
- `4001`: Server Reconnect
- `4002`: Replaced by New Instance
- `4003`: Token Revoked
- `4004`: Node Disabled
- `4005`: Config Fatal
