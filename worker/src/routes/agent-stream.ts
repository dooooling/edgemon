import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { verifyNodeAuth } from '../db/nodes';
import { extractCloudflareMetadata } from '../services/geo';

const agentStreamRoute = new Hono<{ Bindings: Env }>();

agentStreamRoute.get('/api/agent/v1/stream', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426);
  }

  const authHeader = c.req.header('Authorization');
  const nodeId = c.req.header('X-Node-ID');
  const instanceId = c.req.header('X-Agent-Instance-ID');

  if (!authHeader || !authHeader.startsWith('Bearer ') || !nodeId || !instanceId) {
    return c.text('Unauthorized: Missing credentials or instance ID', 401);
  }

  const token = authHeader.slice(7).trim();
  const node = await verifyNodeAuth(c.env.DB, nodeId, token);
  if (!node) {
    return c.text('Unauthorized: Invalid node credentials', 401);
  }

  const geo = extractCloudflareMetadata(c.req.raw);

  // Forward authenticated connection to RealtimeHub Durable Object
  const hubId = c.env.REALTIME.idFromName('main');
  const hubStub = c.env.REALTIME.get(hubId);

  const forwardUrl = new URL(c.req.url);
  forwardUrl.searchParams.set('role', 'agent');
  forwardUrl.searchParams.set('node_id', nodeId);
  forwardUrl.searchParams.set('node_name', node.name);
  forwardUrl.searchParams.set('instance_id', instanceId);
  forwardUrl.searchParams.set('traffic_reset_day', String(node.traffic_reset_day || 1));
  forwardUrl.searchParams.set('geo_json', JSON.stringify(geo));

  const forwardRequest = new Request(forwardUrl.toString(), {
    headers: c.req.raw.headers,
  });

  return hubStub.fetch(forwardRequest);
});

export { agentStreamRoute };
