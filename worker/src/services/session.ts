import { verifySession } from './crypto';

export async function verifyAdminSession(
  cookieHeader: string | null | undefined,
  sessionSecret?: string
): Promise<boolean> {
  if (!cookieHeader) return false;

  const match = cookieHeader.match(/edgemon_session=([^;]+)/);
  if (!match) return false;

  const token = match[1];
  const secret = sessionSecret || 'default-session-secret-change-me';
  const payloadStr = await verifySession(token, secret);

  if (!payloadStr) return false;

  try {
    const data = JSON.parse(payloadStr);
    if (data.role === 'admin' && data.expires_at_ms && data.expires_at_ms > Date.now()) {
      return true;
    }
  } catch {
    // Malformed session JSON
  }

  return false;
}
