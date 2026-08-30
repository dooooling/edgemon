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

  // 1. Sync runtime state changes with RealtimeHub DO FIRST (2-phase consistency - P1)
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);

  if (body.traffic_reset_day !== undefined && body.traffic_reset_day !== existing.traffic_reset_day) {
    try {
      await (hubStub as any).disconnectAgent(id, 4005, 'TRAFFIC_RESET_DAY_CHANGED');
    } catch (e) {
      console.error('[Admin] Failed to disconnect agent on traffic_reset_day change:', e);
      return c.json({ error: 'Failed to synchronize runtime state with RealtimeHub' }, 500);
    }
  } else if (body.hidden !== undefined || body.name !== undefined) {
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

  // 2. Once DO runtime synchronization succeeds, persist modifications into D1 dynamically (P2-3: allows clearing nullable fields to null)
  try {
    const setClauses: string[] = [];
    const setValues: any[] = [];

    const allowedFields: Record<string, string> = {
      name: 'name',
      sort_order: 'sort_order',
      hidden: 'hidden',
      note: 'note',
      traffic_reset_day: 'traffic_reset_day',
      traffic_quota_bytes: 'traffic_quota_bytes',
      location_mode: 'location_mode',
      manual_country: 'manual_country',
      manual_city: 'manual_city',
      manual_lat: 'manual_lat',
      manual_lon: 'manual_lon',
      expires_at_ms: 'expires_at_ms',
    };

    for (const [bodyKey, colName] of Object.entries(allowedFields)) {
      if (Object.prototype.hasOwnProperty.call(body, bodyKey)) {
        setClauses.push(`${colName} = ?`);
        let val = body[bodyKey];
        if (bodyKey === 'hidden' && val !== null && val !== undefined) {
          val = val ? 1 : 0;
        }
        setValues.push(val);
      }
    }

    setClauses.push('updated_at_ms = ?');
    setValues.push(now);
    setValues.push(id);

    if (setClauses.length > 1) {
      const updateSql = `UPDATE nodes SET ${setClauses.join(', ')} WHERE id = ?`;
      await c.env.DB.prepare(updateSql).bind(...setValues).run();
    }
  } catch (d1Err) {
    console.error('[Admin] D1 update failed, rolling back DO runtime state:', d1Err);
    // Rollback DO runtime state to existing values on D1 failure
    try {
      if (body.hidden !== undefined || body.name !== undefined) {
        await (hubStub as any).updateNodeRuntime(id, {
          is_hidden: existing.hidden === 1,
          node_name: existing.name,
        });
      }
    } catch (_) {}
    return c.json({ error: 'Database update failed' }, 500);
  }

  const updated = await getNodeById(c.env.DB, id);
  return c.json({ node: updated });
});

// DELETE /api/admin/nodes/:id
adminRoutes.delete('/api/admin/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await getNodeById(c.env.DB, id);
  if (!existing) {
    return c.json({ error: 'Node not found' }, 404);
  }

  // 1. Delete from D1 first (Single source of truth)
  await c.env.DB.prepare('DELETE FROM nodes WHERE id = ?').bind(id).run();

  // 2. Disconnect and permanently blacklist node in RealtimeHub DO
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);
  try {
    await (hubStub as any).disconnectAgent(id, CloseCodes.NODE_DISABLED, 'NODE_DISABLED', '*');
  } catch (e) {
    console.error('[Admin] Disconnect agent failed on node deletion, retrying once:', e);
    try {
      await (hubStub as any).disconnectAgent(id, CloseCodes.NODE_DISABLED, 'NODE_DISABLED', '*');
    } catch (e2) {
      console.error('[Admin] Disconnect agent retry failed on node deletion:', e2);
      return c.json({ status: 'deleted', id, warning: 'AGENT_DISCONNECT_RPC_FAILED' });
    }
  }

  return c.json({ status: 'deleted', id });
});

// POST /api/admin/nodes/:id/token
adminRoutes.post('/api/admin/nodes/:id/token', async (c) => {
  const id = c.req.param('id');
  const existing = await getNodeById(c.env.DB, id);
  if (!existing) {
    return c.json({ error: 'Node not found' }, 404);
  }

  // 1. Rotate token in D1 first (D1 is atomic source of truth, returns old and new token hashes)
  const rotation = await rotateNodeToken(c.env.DB, id);
  if (!rotation) {
    return c.json({ error: 'Node not found' }, 404);
  }
  const { rawToken, oldTokenHash } = rotation;

  // 2. Disconnect active sockets and register oldTokenHash in RealtimeHub DO blacklist
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);
  try {
    await (hubStub as any).disconnectAgent(id, CloseCodes.TOKEN_REVOKED, 'TOKEN_REVOKED', oldTokenHash);
  } catch (e) {
    console.error('[Admin] Disconnect agent failed on token rotation, retrying once:', e);
    try {
      await (hubStub as any).disconnectAgent(id, CloseCodes.TOKEN_REVOKED, 'TOKEN_REVOKED', oldTokenHash);
    } catch (e2) {
      console.error('[Admin] Disconnect agent retry failed on token rotation:', e2);
      return c.json({ rawToken, warning: 'AGENT_DISCONNECT_RPC_FAILED' });
    }
  }

  return c.json({ rawToken });
});

// GET /api/admin/nodes/:id/config
adminRoutes.get('/api/admin/nodes/:id/config', async (c) => {
  const id = c.req.param('id');
  const configRow = await c.env.DB
    .prepare('SELECT revision, config_json FROM node_config WHERE node_id = ?')
    .bind(id)
    .first<{ revision: number; config_json: string }>();

  const rawConfig = configRow ? JSON.parse(configRow.config_json) : {};
  const normalizedConfig = {
    sample_interval_sec: rawConfig.sample_interval_sec ?? 30,
    stream_interval_sec: rawConfig.stream_interval_sec ?? 30,
    probe_interval_sec: rawConfig.probe_interval_sec ?? 60,
    network_interface: rawConfig.network_interface ?? 'auto',
    probes: Array.isArray(rawConfig.probes) ? rawConfig.probes : [],
  };

  return c.json({
    revision: configRow ? configRow.revision : 1,
    config: normalizedConfig,
  });
});

// PATCH /api/admin/nodes/:id/config
adminRoutes.patch('/api/admin/nodes/:id/config', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const now = Date.now();

  const normalizedBody = {
    sample_interval_sec: body.sample_interval_sec ?? 30,
    stream_interval_sec: body.stream_interval_sec ?? 30,
    probe_interval_sec: body.probe_interval_sec ?? 60,
    network_interface: body.network_interface ?? 'auto',
    probes: Array.isArray(body.probes) ? body.probes : [],
  };

  const validation = validateServerConfig(normalizedBody);
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
  const configJson = JSON.stringify(normalizedBody);

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
    await (hubStub as any).pushConfig(id, normalizedBody, newRevision);
  } catch {
    // best-effort
  }

  return c.json({ revision: newRevision, config: normalizedBody });
});

export { adminRoutes };
