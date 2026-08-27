import { verifySession } from './crypto';

export async function verifyAdminSession(
  cookieHeader: string | null | undefined,
  sessionSecret?: string
): Promise<boolean> {
  const expiry = await getAdminSessionExpiry(cookieHeader, sessionSecret);
  return expiry !== null;
}

export async function getAdminSessionExpiry(
  cookieHeader: string | null | undefined,
  sessionSecret?: string
): Promise<number | null> {
  if (!cookieHeader || !sessionSecret) return null;

  const match = cookieHeader.match(/edgemon_session=([^;]+)/);
  if (!match) return null;

  const token = match[1];
  const payloadStr = await verifySession(token, sessionSecret);

  if (!payloadStr) return null;

  try {
    const data = JSON.parse(payloadStr);
    if (data.role === 'admin' && data.expires_at_ms && data.expires_at_ms > Date.now()) {
      return data.expires_at_ms;
    }
  } catch {
    // Malformed session JSON
  }

  return null;
}
