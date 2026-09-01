import { Hono } from 'hono';
import { Env, RealtimeHub } from './durable/realtime-hub';
import { agentStreamRoute } from './routes/agent-stream';
import { agentRoutes } from './routes/agent';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { runScheduled } from './scheduled';

const app = new Hono<{ Bindings: Env }>();

// Mount routes
app.route('/', agentStreamRoute);
app.route('/', agentRoutes);
app.route('/', authRoutes);
app.route('/', publicRoutes);
app.route('/', adminRoutes);

// Health check (Liveness)
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', version: '0.1.0', time: Date.now() });
});

// Readiness check: verifies D1 database connectivity, schema tables, DO binding, and security secrets
app.get('/api/ready', async (c) => {
  let dbOk = false;
  let tablesOk = false;
  let realtimeOk = false;

  try {
    if (c.env.DB) {
      const res = await c.env.DB.prepare('SELECT 1').first();
      dbOk = Boolean(res);
      const tables = await c.env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('nodes', 'node_state', 'alert_rules', 'events')"
      ).all();
      tablesOk = (tables.results || []).length >= 4;
    }
  } catch {
    dbOk = false;
    tablesOk = false;
  }

  try {
    if (c.env.REALTIME) {
      const id = c.env.REALTIME.idFromName('health-check');
      realtimeOk = Boolean(id);
    }
  } catch {
    realtimeOk = false;
  }

  const secrets = {
    admin_key: Boolean(c.env.ADMIN_KEY),
    session_secret: Boolean(c.env.SESSION_SECRET),
    data_encryption_key: Boolean(c.env.DATA_ENCRYPTION_KEY),
  };

  const isReady = dbOk && tablesOk && realtimeOk && secrets.admin_key && secrets.session_secret;

  return c.json(
    {
      status: isReady ? 'ready' : 'degraded',
      db: dbOk && tablesOk,
      realtime: realtimeOk,
      time: Date.now(),
    },
    isReady ? 200 : 503
  );
});

// Fallback 404 handler: serve static SPA assets for non-API requests when ASSETS binding is present
app.notFound(async (c) => {
  if (c.env.ASSETS && !c.req.path.startsWith('/api')) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Not Found', 404);
});

// WebSocket Realtime Hub Upgrade for Browser Dashboards (strictly restricted to role=browser)
app.get('/api/realtime', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  // Validate Origin header
  const origin = c.req.header('Origin');
  const host = c.req.header('Host');
  if (origin && host) {
    try {
      const originUrl = new URL(origin);
      const isLocal = originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1';
      const isSameHost = originUrl.host === host;
      if (!isLocal && !isSameHost) {
        return c.text('Forbidden: Cross-origin WebSocket connection prohibited', 403);
      }
    } catch {
      return c.text('Forbidden: Invalid Origin header', 403);
    }
  }

  const id = c.env.REALTIME.idFromName('main');
  const stub = c.env.REALTIME.get(id);

  // Strictly enforce role=browser and strip any agent query params
  const forwardUrl = new URL(c.req.url);
  forwardUrl.searchParams.set('role', 'browser');
  forwardUrl.searchParams.delete('node_id');
  forwardUrl.searchParams.delete('instance_id');

  const forwardRequest = new Request(forwardUrl.toString(), {
    headers: c.req.raw.headers,
  });

  return stub.fetch(forwardRequest);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Direct Static Asset pass-through for non-API routes
    if (!url.pathname.startsWith('/api') && env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) {
        return assetRes;
      }
    }

    const res = await app.fetch(request, env, ctx);

    // If Hono returned 404 for a non-API route, try SPA fallback via ASSETS
    if (res.status === 404 && env.ASSETS && !url.pathname.startsWith('/api')) {
      return env.ASSETS.fetch(request);
    }

    return res;
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return runScheduled(controller, env, ctx);
  },
};

export { RealtimeHub };
