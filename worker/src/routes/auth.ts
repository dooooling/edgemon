import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { signSession, verifySession } from '../services/crypto';

const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/api/auth/login', async (c) => {
  const adminKey = c.env.ADMIN_KEY || 'test-admin-key';

  let body: { key?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!body.key || body.key !== adminKey) {
    return c.json({ error: 'Invalid Admin Key' }, 401);
  }

  const sessionSecret = c.env.SESSION_SECRET || 'default-session-secret-change-me';
  const now = Date.now();
  const sessionData = JSON.stringify({
    role: 'admin',
    issued_at_ms: now,
    expires_at_ms: now + 12 * 3600 * 1000, // 12 hours
  });

  const sessionToken = await signSession(sessionData, sessionSecret);

  c.header(
    'Set-Cookie',
    `edgemon_session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`
  );

  return c.json({ status: 'ok', authenticated: true });
});

authRoutes.post('/api/auth/logout', (c) => {
  c.header(
    'Set-Cookie',
    'edgemon_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
  );
  return c.json({ status: 'ok', authenticated: false });
});

authRoutes.get('/api/auth/session', async (c) => {
  const cookieHeader = c.req.header('Cookie');
  if (!cookieHeader) {
    return c.json({ authenticated: false });
  }

  const match = cookieHeader.match(/edgemon_session=([^;]+)/);
  if (!match) {
    return c.json({ authenticated: false });
  }

  const token = match[1];
  const sessionSecret = c.env.SESSION_SECRET || 'default-session-secret-change-me';
  const payloadStr = await verifySession(token, sessionSecret);

  if (!payloadStr) {
    return c.json({ authenticated: false });
  }

  try {
    const data = JSON.parse(payloadStr);
    if (data.expires_at_ms && data.expires_at_ms > Date.now()) {
      return c.json({ authenticated: true, role: 'admin' });
    }
  } catch {
    // ignore
  }

  return c.json({ authenticated: false });
});

export { authRoutes };
