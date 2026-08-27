import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { CloseCodes, validateServerConfig } from '../protocol/types';
import { createNode, getNodeById, rotateNodeToken } from '../db/nodes';
import { verifyAdminSession } from '../services/session';

const adminRoutes = new Hono<{ Bindings: Env }>();

// Admin Auth Middleware
adminRoutes.use('/api/admin/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const expectedAdminKey = c.env.ADMIN_KEY;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerKey = authHeader.slice(7).trim();
    if (expectedAdminKey && bearerKey === expectedAdminKey) {
      return next();
    }
  }

  const cookieHeader = c.req.header('Cookie');
  const isAuthenticated = await verifyAdminSession(cookieHeader, c.env.SESSION_SECRET);
  if (isAuthenticated) {
    return next();
  }

  return c.json({ error: 'Unauthorized' }, 401);
});

// GET /api/admin/nodes
adminRoutes.get('/api/admin/nodes', async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT * FROM nodes ORDER BY sort_order ASC, created_at_ms ASC')
    .all();
  return c.json({ nodes: rows.results || [] });
});

// POST /api/admin/nodes
adminRoutes.post('/api/admin/nodes', async (c) => {
  const body = await c.req.json<{
    name: string;
    traffic_reset_day?: number;
    traffic_quota_bytes?: number;
    expires_at_ms?: number;
    note?: string;
  }>();

  if (!body.name) {
    return c.json({ error: 'Node name is required' }, 400);
  }

  const { node, rawToken } = await createNode(
    c.env.DB,
    body.name,
    body.traffic_reset_day || 1,
    body.traffic_quota_bytes || null,
    body.expires_at_ms || null,
    body.note || null
  );

  return c.json({ node, rawToken }, 201);
});

// PATCH /api/admin/nodes/:id
adminRoutes.patch('/api/admin/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<any>();
  const now = Date.now();

  const existing = await getNodeById(c.env.DB, id);
  if (!existing) {
    return c.json({ error: 'Node not found' }, 404);
  }

  await c.env.DB
    .prepare(
      `UPDATE nodes SET
        name = COALESCE(?, name),
        sort_order = COALESCE(?, sort_order),
        hidden = COALESCE(?, hidden),
        note = COALESCE(?, note),
        traffic_reset_day = COALESCE(?, traffic_reset_day),
        traffic_quota_bytes = COALESCE(?, traffic_quota_bytes),
        location_mode = COALESCE(?, location_mode),
        manual_country = COALESCE(?, manual_country),
        manual_city = COALESCE(?, manual_city),
        manual_lat = COALESCE(?, manual_lat),
        manual_lon = COALESCE(?, manual_lon),
        expires_at_ms = COALESCE(?, expires_at_ms),
        updated_at_ms = ?
      WHERE id = ?`
    )
    .bind(
      body.name ?? null,
      body.sort_order ?? null,
      body.hidden ?? null,
      body.note ?? null,
      body.traffic_reset_day ?? null,
      body.traffic_quota_bytes ?? null,
      body.location_mode ?? null,
      body.manual_country ?? null,
      body.manual_city ?? null,
      body.manual_lat ?? null,
      body.manual_lon ?? null,
      body.expires_at_ms ?? null,
      now,
      id
    )
    .run();

  const updated = await getNodeById(c.env.DB, id);

  // Sync runtime state changes (P0-2, P1-4):
  // If traffic_reset_day changed, disconnect agent so it cleanly re-authenticates and hydrates from D1
  // If only display/privacy metadata (hidden, name) changed, update socket attachment in-place
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);

  if (body.traffic_reset_day !== undefined && body.traffic_reset_day !== existing.traffic_reset_day) {
    try {
      await (hubStub as any).disconnectAgent(id, 4005, 'TRAFFIC_RESET_DAY_CHANGED');
    } catch (e) {
      console.error('[Admin] Failed to disconnect agent on traffic_reset_day change:', e);
      return c.json({ error: 'Failed to synchronize runtime state with RealtimeHub' }, 500);
    }
  } else {
    try {
      await (hubStub as any).updateNodeRuntime(id, {
        is_hidden: body.hidden !== undefined ? Boolean(body.hidden) : undefined,
        node_name: body.name !== undefined ? String(body.name) : undefined,
      });
    } catch (e) {
      console.error('[Admin] Failed to update node runtime state:', e);
      return c.json({ error: 'Failed to synchronize runtime state with RealtimeHub' }, 500);
    }
  }

  return c.json({ node: updated });
});

// DELETE /api/admin/nodes/:id
adminRoutes.delete('/api/admin/nodes/:id', async (c) => {
  const id = c.req.param('id');

  // Disconnect any active WSS agent connection immediately
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);
  try {
    await (hubStub as any).disconnectAgent(id, CloseCodes.NODE_DISABLED, 'NODE_DISABLED');
  } catch (e) {
    console.error('[Admin] Failed to disconnect agent on node deletion:', e);
    return c.json({ error: 'Failed to disconnect active agent connection' }, 500);
  }

  await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(id).run();
  return c.json({ status: 'deleted', id });
});

// POST /api/admin/nodes/:id/token
adminRoutes.post('/api/admin/nodes/:id/token', async (c) => {
  const id = c.req.param('id');
  const rawToken = await rotateNodeToken(c.env.DB, id);
  if (!rawToken) {
    return c.json({ error: 'Node not found' }, 404);
  }

  // Disconnect any active WSS agent connection immediately on token rotation
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);
  try {
    await (hubStub as any).disconnectAgent(id, CloseCodes.TOKEN_REVOKED, 'TOKEN_REVOKED');
  } catch (e) {
    console.error('[Admin] Failed to disconnect agent on token rotation:', e);
    return c.json({ error: 'Failed to disconnect active agent connection' }, 500);
  }

  return c.json({ rawToken });
});

// PATCH /api/admin/nodes/:id/config
adminRoutes.patch('/api/admin/nodes/:id/config', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const now = Date.now();

  const validation = validateServerConfig(body);
  if (!validation.valid) {
    return c.json({ error: validation.error || 'Invalid configuration' }, 400);
  }

  const existingNode = await getNodeById(c.env.DB, id);
  if (!existingNode) {
    return c.json({ error: 'Node not found' }, 404);
  }

  const configRow = await c.env.DB
    .prepare('SELECT revision FROM node_config WHERE node_id = ?')
    .bind(id)
    .first<{ revision: number }>();

  const newRevision = (configRow?.revision || 0) + 1;
  const configJson = JSON.stringify(body);

  await c.env.DB
    .prepare(
      `INSERT INTO node_config (node_id, revision, config_json, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET
         revision = excluded.revision,
         config_json = excluded.config_json,
         updated_at_ms = excluded.updated_at_ms`
    )
    .bind(id, newRevision, configJson, now)
    .run();

  // Push new config to connected agent via WebSocket
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);
  try {
    await (hubStub as any).pushConfig(id, body, newRevision);
  } catch {
    // best-effort
  }

  return c.json({ revision: newRevision, config: body });
});

export { adminRoutes };
