import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { signSession, verifySession } from '../services/crypto';
import { recordEvent } from '../db/alerts';

interface RateLimitEntry {
  failures: number;
  lockedUntilMs: number;
  lastAttemptMs: number;
}

const loginRateLimits = new Map<string, RateLimitEntry>();

export function checkLoginRateLimit(ip: string): { allowed: boolean; remainingSec: number } {
  const now = Date.now();
  const entry = loginRateLimits.get(ip);
  if (!entry) return { allowed: true, remainingSec: 0 };

  if (entry.lockedUntilMs > now) {
    return { allowed: false, remainingSec: Math.ceil((entry.lockedUntilMs - now) / 1000) };
  }

  // Reset if inactive for over 5 minutes
  if (now - entry.lastAttemptMs > 5 * 60 * 1000) {
    loginRateLimits.delete(ip);
    return { allowed: true, remainingSec: 0 };
  }

  return { allowed: true, remainingSec: 0 };
}

export function recordLoginFailure(ip: string): { locked: boolean; remainingSec: number; failures: number } {
  const now = Date.now();
  const entry = loginRateLimits.get(ip) || { failures: 0, lockedUntilMs: 0, lastAttemptMs: now };
  entry.failures += 1;
  entry.lastAttemptMs = now;

  if (entry.failures >= 5) {
    entry.lockedUntilMs = now + 5 * 60 * 1000; // 5 min lockout
    loginRateLimits.set(ip, entry);
    return { locked: true, remainingSec: 300, failures: entry.failures };
  }

  loginRateLimits.set(ip, entry);
  return { locked: false, remainingSec: 0, failures: entry.failures };
}

export function recordLoginSuccess(ip: string): void {
  loginRateLimits.delete(ip);
}

/**
 * Constant-time comparison to protect against side-channel timing attacks
 */
async function timingSafeEqual(input: string, target: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const hashA = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  const hashB = await crypto.subtle.digest('SHA-256', encoder.encode(target));
  const bufA = new Uint8Array(hashA);
  const bufB = new Uint8Array(hashB);

  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/api/auth/login', async (c) => {
  const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const userAgent = c.req.header('User-Agent') || 'unknown';

  // 1. Rate Limit & Lockout check
  const rateCheck = checkLoginRateLimit(clientIp);
  if (!rateCheck.allowed) {
    return c.json(
      {
        error: `Too many failed attempts. Account temporarily locked for ${rateCheck.remainingSec} seconds.`,
        retry_after_sec: rateCheck.remainingSec,
      },
      429
    );
  }

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

  const isMatch = body.key ? await timingSafeEqual(body.key, adminKey) : false;

  if (!isMatch) {
    const failInfo = recordLoginFailure(clientIp);

    // Audit log failed attempt to D1
    try {
      await recordEvent(c.env.DB, null, 'auth_login_failed', {
        ip: clientIp,
        user_agent: userAgent,
        failures: failInfo.failures,
        locked: failInfo.locked,
      });
    } catch {
      // ignore
    }

    if (failInfo.locked) {
      return c.json(
        {
          error: 'Invalid Admin Key. Maximum failed attempts reached, locked for 5 minutes.',
          retry_after_sec: failInfo.remainingSec,
        },
        429
      );
    }

    return c.json(
      {
        error: `Invalid Admin Key. (${5 - failInfo.failures} attempts remaining)`,
      },
      401
    );
  }

  // 2. Success: reset rate limits and issue signed session
  recordLoginSuccess(clientIp);

  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const sessionData = JSON.stringify({
    role: 'admin',
    session_id: sessionId,
    ip: clientIp,
    issued_at_ms: now,
    expires_at_ms: now + 12 * 3600 * 1000, // 12 hours
  });

  const sessionToken = await signSession(sessionData, sessionSecret);

  // Audit log success to D1
  try {
    await recordEvent(c.env.DB, null, 'auth_login_success', {
      ip: clientIp,
      user_agent: userAgent,
      session_id: sessionId,
    });
  } catch {
    // ignore
  }

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
