import { verifySession } from './crypto';

export async function verifyAdminSession(
  cookieHeader: string | null | undefined,
  sessionSecret?: string
): Promise<boolean> {
  if (!cookieHeader || !sessionSecret) return false;

  const match = cookieHeader.match(/edgemon_session=([^;]+)/);
  if (!match) return false;

  const token = match[1];
  const payloadStr = await verifySession(token, sessionSecret);

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
