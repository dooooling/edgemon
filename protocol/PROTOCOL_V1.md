# EdgeMon Protocol V1 Specification

> Version: 1.0  
> Format: JSON over HTTPS / WebSockets  

## 1. Overview

EdgeMon Protocol V1 defines the telemetry and control contract between the **Agent** (running on nodes) and the **Worker** (running on Cloudflare Edge), as well as between the **Worker** and the **Web Dashboard** (via WebSocket).

## 2. Agent Envelopes

All Agent $\leftrightarrow$ Worker messages are wrapped in a standard JSON envelope:

### 2.1 Agent Envelope (Agent $\rightarrow$ Worker)

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

- `v`: Protocol version (always `1` for V1).
- `type`: `hello` | `report`.
- `instance_id`: Unique UUID generated at Agent process startup.
- `seq`: Monotonically increasing sequence number within the current `instance_id`.
- `ts_ms`: Unix timestamp in milliseconds from Agent clock.

### 2.2 Server Envelope (Worker $\rightarrow$ Agent)

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

- `type`: `welcome` | `ack` | `error`.

## 3. Endpoints

| Endpoint | Method | Auth | Body Type | Response Type |
|---|---|---|---|---|
| `/api/agent/v1/hello` | `POST` | `Bearer <node-token>` | `hello` | `welcome` / `error` |
| `/api/agent/v1/report`| `POST` | `Bearer <node-token>` | `report` | `ack` / `error` |

Required Headers:
- `Authorization: Bearer <node-token>`
- `X-Node-ID: <node-id>`
- `Content-Type: application/json`
- `User-Agent: EdgeMon-Agent/<version>`

## 4. Error Codes

- `INVALID_MESSAGE` (400)
- `UNAUTHORIZED` (401)
- `NODE_NOT_FOUND` (404)
- `UNSUPPORTED_VERSION` (426 / 400)
- `HELLO_REQUIRED` (409)
- `INSTANCE_MISMATCH` (409)
- `CONFIG_INVALID` (400)
- `RATE_LIMITED` (429)
- `INTERNAL_ERROR` (500)
