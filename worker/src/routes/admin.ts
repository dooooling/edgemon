import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { verifySession } from '../services/crypto';
import { createNode, getNodeById, rotateNodeToken } from '../db/nodes';

const adminRoutes = new Hono<{ Bindings: Env }>();

// Admin Auth Middleware
adminRoutes.use('/api/admin/*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const expectedAdminKey = c.env.ADMIN_KEY || 'test-admin-key';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerKey = authHeader.slice(7).trim();
    if (bearerKey === expectedAdminKey) {
      return next();
    }
  }

  const cookieHeader = c.req.header('Cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/edgemon_session=([^;]+)/);
    if (match) {
      const sessionSecret = c.env.SESSION_SECRET || 'default-session-secret-change-me';
      const payloadStr = await verifySession(match[1], sessionSecret);
      if (payloadStr) {
        return next();
      }
    }
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
  return c.json({ node: updated });
});

// DELETE /api/admin/nodes/:id
adminRoutes.delete('/api/admin/nodes/:id', async (c) => {
  const id = c.req.param('id');
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
  return c.json({ rawToken });
});

// PATCH /api/admin/nodes/:id/config
adminRoutes.patch('/api/admin/nodes/:id/config', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const now = Date.now();

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

  return c.json({ revision: newRevision, config: body });
});

export { adminRoutes };
