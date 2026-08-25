import { Hono } from 'hono';
import { Env, RealtimeHub } from './durable/realtime-hub';
import { agentRoutes } from './routes/agent';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { runScheduled } from './scheduled';

import { ensureSchema } from './db/schema';

const app = new Hono<{ Bindings: Env }>();

// Auto-ensure D1 database tables
app.use('*', async (c, next) => {
  if (c.env.DB) {
    await ensureSchema(c.env.DB);
  }
  return next();
});

// Mount routes
app.route('/', agentRoutes);
app.route('/', authRoutes);
app.route('/', publicRoutes);
app.route('/', adminRoutes);

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', version: '0.1.0', time: Date.now() });
});

// WebSocket Realtime Hub Upgrade
app.get('/api/realtime', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  const id = c.env.REALTIME.idFromName('main');
  const stub = c.env.REALTIME.get(id);
  return stub.fetch(c.req.raw);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return runScheduled(controller, env, ctx);
  },
};

export { RealtimeHub };
