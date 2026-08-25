import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { AgentEnvelope, HelloPayload, ReportPayload, ServerEnvelope, WelcomeData, AckData, ErrorData } from '../protocol/types';
import { verifyNodeAuth, updateNodeMetadataFromHello, getNodeById } from '../db/nodes';
import { getNodeState, upsertNodeState, upsertMetricsRaw } from '../db/metrics';
import { trackTrafficDelta } from '../db/traffic';
import { extractCloudflareMetadata } from '../services/geo';

const agentRoutes = new Hono<{ Bindings: Env }>();

function extractAuthCredentials(c: any): { nodeId: string; token: string } | null {
  const authHeader = c.req.header('Authorization');
  const nodeId = c.req.header('X-Node-ID');
  if (!authHeader || !authHeader.startsWith('Bearer ') || !nodeId) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token ? { nodeId, token } : null;
}

function errorResponse(code: string, message: string, status = 400, instanceId = '', seq = 0) {
  const envelope: ServerEnvelope<ErrorData> = {
    v: 1,
    type: 'error',
    instance_id: instanceId,
    seq,
    ts_ms: Date.now(),
    data: { code, message },
  };
  return Response.json(envelope, { status });
}

// POST /api/agent/v1/hello
agentRoutes.post('/api/agent/v1/hello', async (c) => {
  const creds = extractAuthCredentials(c);
  if (!creds) {
    return errorResponse('UNAUTHORIZED', 'Missing or invalid Authorization header or X-Node-ID', 401);
  }

  const node = await verifyNodeAuth(c.env.DB, creds.nodeId, creds.token);
  if (!node) {
    return errorResponse('UNAUTHORIZED', 'Invalid node token or node ID', 401);
  }

  let body: AgentEnvelope<HelloPayload>;
  try {
    body = await c.req.json();
    if (body.v !== 1 || body.type !== 'hello' || !body.instance_id) {
      return errorResponse('INVALID_MESSAGE', 'Malformed hello envelope', 400);
    }
  } catch {
    return errorResponse('INVALID_MESSAGE', 'Failed to parse JSON body', 400);
  }

  const geo = extractCloudflareMetadata(c.req.raw);
  await updateNodeMetadataFromHello(c.env.DB, creds.nodeId, body.data, geo);

  // Load config
  const configRow = await c.env.DB
    .prepare('SELECT revision, config_json FROM node_config WHERE node_id = ?')
    .bind(creds.nodeId)
    .first<{ revision: number; config_json: string }>();

  const serverConfig = configRow ? JSON.parse(configRow.config_json) : {
    sample_interval_sec: 2,
    report_interval_sec: 30,
    probe_interval_sec: 60,
    network_interface: 'auto',
    probes: [],
  };

  const welcomeEnvelope: ServerEnvelope<WelcomeData> = {
    v: 1,
    type: 'welcome',
    instance_id: body.instance_id,
    seq: body.seq,
    ts_ms: Date.now(),
    data: {
      config_rev: configRow?.revision || 1,
      config: serverConfig,
    },
  };

  return c.json(welcomeEnvelope);
});

// POST /api/agent/v1/report
agentRoutes.post('/api/agent/v1/report', async (c) => {
  const creds = extractAuthCredentials(c);
  if (!creds) {
    return errorResponse('UNAUTHORIZED', 'Missing or invalid Authorization header or X-Node-ID', 401);
  }

  const node = await verifyNodeAuth(c.env.DB, creds.nodeId, creds.token);
  if (!node) {
    return errorResponse('UNAUTHORIZED', 'Invalid node token or node ID', 401);
  }

  let body: AgentEnvelope<ReportPayload>;
  try {
    body = await c.req.json();
    if (body.v !== 1 || body.type !== 'report' || !body.instance_id) {
      return errorResponse('INVALID_MESSAGE', 'Malformed report envelope', 400);
    }
  } catch {
    return errorResponse('INVALID_MESSAGE', 'Failed to parse JSON body', 400);
  }

  const nowMs = Date.now();
  const geo = extractCloudflareMetadata(c.req.raw);

  // 1. In-Memory Live Broadcast to RealtimeHub DO & Check if Node is Watched in Detail
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);
  const livePayload = {
    node_id: creds.nodeId,
    name: node.name,
    instance_id: body.instance_id,
    ts_ms: nowMs,
    metrics: body.data,
    geo,
  };

  let isDetailWatched = false;
  try {
    const res = await (hubStub as any).publishAndCheckDetailWatch(creds.nodeId, livePayload);
    isDetailWatched = res?.detailWatched || false;
  } catch {
    // Best-effort DO broadcast
  }

  // 2. Strict D1 60s Throttling & Incremental Step Delta Calculation
  const lastState = await getNodeState(c.env.DB, creds.nodeId);
  const bucketStartMs = Math.floor(nowMs / 60000) * 60000;
  const lastPersistedMs = lastState?.persisted_at_ms || 0;
  const lastBucketStartMs = Math.floor(lastPersistedMs / 60000) * 60000;

  // Persist D1 only if: first state ever, OR >= 60s elapsed, OR crossed into a new minute bucket
  const shouldPersistD1 = !lastState || (nowMs - lastPersistedMs >= 60000) || (bucketStartMs > lastBucketStartMs);

  if (shouldPersistD1) {
    // Compute true step delta since last persisted D1 state to prevent duplicate base accumulation
    let stepRxDelta = 0;
    let stepTxDelta = 0;
    if (
      lastState &&
      lastState.network_counter_id === body.data.network.counter_id &&
      body.data.network.rx_total_bytes >= (lastState.rx_total_bytes ?? 0) &&
      body.data.network.tx_total_bytes >= (lastState.tx_total_bytes ?? 0)
    ) {
      stepRxDelta = body.data.network.rx_total_bytes - (lastState.rx_total_bytes ?? 0);
      stepTxDelta = body.data.network.tx_total_bytes - (lastState.tx_total_bytes ?? 0);
    }

    await Promise.all([
      trackTrafficDelta(
        c.env.DB,
        creds.nodeId,
        body.data.network.rx_total_bytes,
        body.data.network.tx_total_bytes,
        body.data.network.counter_id || null,
        node.traffic_reset_day
      ),
      upsertNodeState(c.env.DB, creds.nodeId, body.instance_id, body.seq, body.data, geo, nowMs),
      upsertMetricsRaw(
        c.env.DB,
        creds.nodeId,
        bucketStartMs,
        body.data,
        geo.edge_rtt_ms,
        stepRxDelta,
        stepTxDelta
      ),
    ]);
  }

  // 3. Return ACK Envelope (with realtime lease if authorized watchers are present)
  const ackEnvelope: ServerEnvelope<AckData> = {
    v: 1,
    type: 'ack',
    instance_id: body.instance_id,
    seq: body.seq,
    ts_ms: Date.now(),
    data: {
      config_rev: body.data.config_rev,
      config: null,
      realtime: isDetailWatched
        ? {
            interval_sec: 2,
            lease_sec: 60,
          }
        : null,
    },
  };

  return c.json(ackEnvelope);
});

export { agentRoutes };
