import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { signSession, verifySession } from '../services/crypto';

const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/api/auth/login', async (c) => {
  const adminKey = c.env.ADMIN_KEY;
  const sessionSecret = c.env.SESSION_SECRET;

  if (!adminKey || !sessionSecret) {
    return c.json(
      { error: 'Server misconfiguration: ADMIN_KEY or SESSION_SECRET not set in Worker secrets' },
      500
    );
  }

  let body: { key?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.key || body.key !== adminKey) {
    return c.json({ error: 'Invalid Admin Key' }, 401);
  }

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

authRoutes.post('/api/auth/logout', async (c) => {
  c.header(
    'Set-Cookie',
    'edgemon_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
  );

  // Revoke all active admin WebSockets immediately
  try {
    const id = c.env.REALTIME.idFromName('main');
    const stub = c.env.REALTIME.get(id);
    await (stub as any).revokeAdminSessions();
  } catch (e) {
    console.error('[Auth] Failed to revoke admin WebSockets on logout:', e);
  }

  return c.json({ status: 'ok', authenticated: false });
});

authRoutes.get('/api/auth/session', async (c) => {
  const cookieHeader = c.req.header('Cookie');
  const sessionSecret = c.env.SESSION_SECRET;

  if (!cookieHeader || !sessionSecret) {
    return c.json({ authenticated: false });
  }

  const match = cookieHeader.match(/edgemon_session=([^;]+)/);
  if (!match) {
    return c.json({ authenticated: false });
  }

  const token = match[1];
  const payloadStr = await verifySession(token, sessionSecret);

  if (!payloadStr) {
    return c.json({ authenticated: false });
  }

  try {
    const data = JSON.parse(payloadStr);
    if (data.role === 'admin' && data.expires_at_ms && data.expires_at_ms > Date.now()) {
      return c.json({ authenticated: true, role: 'admin' });
    }
  } catch {
    // ignore
  }

  return c.json({ authenticated: false });
});

export { authRoutes };
