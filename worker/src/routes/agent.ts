import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { AgentEnvelope, HelloPayload, ReportPayload, ServerEnvelope, WelcomeData, AckData, ErrorData } from '../protocol/types';
import { verifyNodeAuth, updateNodeMetadataFromHello } from '../db/nodes';
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
  const now = Date.now();
  await updateNodeMetadataFromHello(c.env.DB, creds.nodeId, body.data, geo);

  // Register active instance in nodes table
  await c.env.DB
    .prepare(
      `UPDATE nodes SET
        active_instance_id = ?,
        active_instance_started_at_ms = ?,
        updated_at_ms = ?
      WHERE id = ?`
    )
    .bind(body.instance_id, now, now, creds.nodeId)
    .run();

  // Load config
  const configRow = await c.env.DB
    .prepare('SELECT revision, config_json FROM node_config WHERE node_id = ?')
    .bind(creds.nodeId)
    .first<{ revision: number; config_json: string }>();

  const serverConfig = configRow ? JSON.parse(configRow.config_json) : {
    sample_interval_sec: 2,
    stream_interval_sec: 2,
    probe_interval_sec: 60,
    network_interface: 'auto',
    probes: [],
  };

  const stateRow = await c.env.DB
    .prepare('SELECT persisted_instance_id, persisted_sample_seq FROM node_state WHERE node_id = ?')
    .bind(creds.nodeId)
    .first<{ persisted_instance_id: string | null; persisted_sample_seq: number }>();

  const welcomeEnvelope: ServerEnvelope<WelcomeData> = {
    v: 1,
    type: 'welcome',
    instance_id: body.instance_id,
    seq: body.seq,
    ts_ms: Date.now(),
    data: {
      config_rev: configRow?.revision || 1,
      config: serverConfig,
      persisted_instance_id: stateRow?.persisted_instance_id || null,
      persisted_sample_seq: stateRow?.persisted_sample_seq || 0,
    },
  };

  return c.json(welcomeEnvelope);
});

// POST /api/agent/v1/report (HTTP Fallback route)
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

  // Active instance ownership verification (prevent stale/duplicate instances from overwriting)
  if (node.active_instance_id && node.active_instance_id !== body.instance_id) {
    return errorResponse(
      'INSTANCE_MISMATCH',
      'Instance ID mismatch with currently active registered instance. Hello handshake required.',
      409,
      body.instance_id,
      body.seq
    );
  }

  const geo = extractCloudflareMetadata(c.req.raw);

  // Forward to RealtimeHub DO for uniform Ingest, 60s Checkpoint gate & Live Broadcast
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);

  const res = await (hubStub as any).ingestFallback(
    creds.nodeId,
    node.name,
    body.instance_id,
    body.seq,
    body.data,
    geo,
    node.traffic_reset_day || 1,
    Boolean(node.hidden)
  );

  if (!res.accepted) {
    return errorResponse(res.error || 'REPORT_REJECTED', 'Report failed validation', 400, body.instance_id, body.seq);
  }

  // Query latest config revision from DB to notify HTTP-fallback nodes of updates
  const configRow = await c.env.DB
    .prepare('SELECT revision FROM node_config WHERE node_id = ?')
    .bind(creds.nodeId)
    .first<{ revision: number }>();

  const latestConfigRev = configRow?.revision || body.data.config_rev;

  const ackEnvelope: ServerEnvelope<AckData> = {
    v: 1,
    type: 'ack',
    instance_id: body.instance_id,
    seq: body.seq,
    ts_ms: Date.now(),
    data: {
      persisted_sample_seq: res.persisted_sample_seq || 0,
      config_rev: latestConfigRev,
      accepted_seq: body.seq,
      persisted_seq: res.persisted ? body.seq : 0,
    },
  };

  return c.json(ackEnvelope);
});

export { agentRoutes };
