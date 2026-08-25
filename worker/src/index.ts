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

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', version: '0.1.0', time: Date.now() });
});

// WebSocket Realtime Hub Upgrade for Browser Dashboards (strictly restricted to role=browser)
app.get('/api/realtime', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
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
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return runScheduled(controller, env, ctx);
  },
};

export { RealtimeHub };
