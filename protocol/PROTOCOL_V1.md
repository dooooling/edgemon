# EdgeMon Protocol V1.1 Specification (Data Integrity v1)

> Version: 1.1 (WSS Architecture v1.0 & Data Integrity v1)  
> Primary Transport: WSS `/api/agent/v1/stream` (2s MetricSample Stream)  
> Fallback Transport: HTTP `/api/agent/v1/report` (30s Polling)  
> Persistence Gate: 60s Checkpoint to Cloudflare D1 via `DB.batch()` with `persisted_sample_seq` watermark ACK  

---

## 1. Overview

EdgeMon Protocol V1.1 defines the real-time telemetry, control, and data integrity contract between the **Agent** (running on nodes) and the **Worker RealtimeHub DO** (running on Cloudflare Edge), as well as between the **Worker** and the **Web Dashboard** (via WebSocket).

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
  "data": {
    "samples": [
      {
        "sample_seq": 1001,
        "sampled_at_ms": 1787650002000,
        "metrics": {}
      }
    ],
    "dropped_samples": 0
  }
}
```

- `v`: Protocol version (always `1`).
- `type`: `hello` | `report` | `config_ack` | `error`.
- `instance_id`: Unique UUID generated at Agent process start (immutable across reconnects).
- `seq`: Monotonically increasing sequence number within the current `instance_id`.
- `ts_ms`: Unix timestamp in milliseconds from Agent clock.
- `data.samples`: Array of `MetricSample` objects (`sample_seq`, `sampled_at_ms`, `metrics`).
- `data.dropped_samples`: Total cumulative samples dropped due to local bounded buffer overflow.

### 2.2 Server Envelope (Server $\rightarrow$ Agent)

```json
{
  "v": 1,
  "type": "welcome",
  "instance_id": "01991f4e-a3d7-7c4e-aef1-9a1b6c03d442",
  "seq": 1,
  "ts_ms": 1787650000050,
  "data": {
    "config_rev": 1,
    "config": {},
    "persisted_instance_id": "01991f4e-a3d7-7c4e-aef1-9a1b6c03d442",
    "persisted_sample_seq": 1000
  }
}
```

- `type`: `welcome` | `config` | `ack` | `error`.
- `data.persisted_instance_id`: Last instance ID successfully persisted in D1.
- `data.persisted_sample_seq`: Last sample sequence number safely written to durable storage (D1).

---

## 3. Data Integrity & Replay State Machine

1. **Agent In-Memory SampleBuffer**:
   - Max capacity: 300 samples (~10 minutes of 2s telemetry).
   - Each 2s sample increments `sample_seq` and appends to `VecDeque<MetricSample>`.
   - On buffer overflow (> 300), oldest sample is dropped and `dropped_samples` counter increments.

2. **Handshake Watermark Sync (`Welcome`)**:
   - Server returns `persisted_instance_id` and `persisted_sample_seq`.
   - If `persisted_instance_id == instance_id`, Agent sets `persisted_sample_seq = max(local, server)` and pops all samples $\le \text{persisted\_sample\_seq}$.
   - Agent initializes `last_sent_sample_seq = persisted_sample_seq`.

3. **Streaming & Replay**:
   - Agent streams unsent samples (`sample_seq > last_sent_sample_seq`, up to 16 per report).
   - Samples remain in buffer until durable ACK is received.

4. **Durable Watermark ACK**:
   - Server flushes 60s Checkpoint to D1 database.
   - Upon D1 transaction success, Server returns `ACK` with `persisted_sample_seq = max_persisted_sample_seq`.
   - Agent pops confirmed samples from memory queue.

---

## 4. Endpoints & Transports

### 4.1 WSS Primary Stream
- **Path**: `GET /api/agent/v1/stream` (WebSocket Upgrade)
- **Report Interval**: 2 seconds
- **Ping / Keepalive**: RFC6455 Ping every 30 seconds
- **Headers**:
  - `Authorization: Bearer <node-token>`
  - `X-Node-ID: <node-id>`
  - `X-Agent-Instance-ID: <instance-id>`
  - `User-Agent: EdgeMon-Agent/<version>`

### 4.2 HTTP Fallback
- **Paths**: `POST /api/agent/v1/hello`, `POST /api/agent/v1/report`
- **Fallback Interval**: 30 seconds while WSS is disconnected

---

## 5. Close Codes

- `1000`: Normal Closure
- `1002`: Protocol Error
- `1008`: Policy Violation (e.g. Hello required before report)
- `1009`: Message Too Big (Frame > 16KB)
- `4001`: Server Reconnect
- `4002`: Replaced by New Instance
- `4003`: Token Revoked
- `4004`: Node Disabled
- `4005`: Config Fatal
