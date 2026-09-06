// Web Crypto utilities for SHA-256 hashing, AES-GCM encryption, and HMAC-SHA-256 signatures

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateRandomToken(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Derives a cryptographic 256-bit AES-GCM key from arbitrary secret via SHA-256
async function deriveAesKey(secret: string, usages: ('encrypt' | 'decrypt')[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyDigest = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return await crypto.subtle.importKey('raw', keyDigest, 'AES-GCM', false, usages);
}

// AES-GCM encryption with 96-bit random nonce
export async function encryptSecret(plainText: string, secretKey: string): Promise<{ nonceB64: string; cipherB64: string }> {
  const enc = new TextEncoder();
  const cryptoKey = await deriveAesKey(secretKey, ['encrypt']);

  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    enc.encode(plainText)
  );

  const nonceB64 = btoa(String.fromCharCode(...nonce));
  const cipherB64 = btoa(String.fromCharCode(...new Uint8Array(cipherBuffer)));

  return { nonceB64, cipherB64 };
}

export async function decryptSecret(nonceB64: string, cipherB64: string, secretKey: string): Promise<string> {
  const cryptoKey = await deriveAesKey(secretKey, ['decrypt']);

  const nonce = Uint8Array.from(atob(nonceB64), (c) => c.charCodeAt(0));
  const cipher = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    cipher
  );

  return new TextDecoder().decode(decryptedBuffer);
}

export async function saveSecretSetting(
  db: D1Database,
  key: string,
  plainText: string,
  encryptionKey: string
): Promise<void> {
  const { nonceB64, cipherB64 } = await encryptSecret(plainText, encryptionKey);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO secret_settings (key, nonce_b64, cipher_b64, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         nonce_b64 = excluded.nonce_b64,
         cipher_b64 = excluded.cipher_b64,
         updated_at_ms = excluded.updated_at_ms`
    )
    .bind(key, nonceB64, cipherB64, now)
    .run();
}

export async function getSecretSetting(
  db: D1Database,
  key: string,
  encryptionKey: string
): Promise<string | null> {
  const row = await db
    .prepare('SELECT nonce_b64, cipher_b64 FROM secret_settings WHERE key = ?')
    .bind(key)
    .first<{ nonce_b64: string; cipher_b64: string }>();

  if (!row) return null;
  try {
    return await decryptSecret(row.nonce_b64, row.cipher_b64, encryptionKey);
  } catch (err) {
    console.error(`[Crypto] Failed to decrypt secret_settings key ${key}:`, err);
    return null;
  }
}

// HMAC-SHA-256 for Admin Session Cookies
function bytesToBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function signSession(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payloadBytes = enc.encode(payload);
  const signature = await crypto.subtle.sign('HMAC', key, payloadBytes);
  const sigB64 = bytesToBase64Url(new Uint8Array(signature));
  return `${bytesToBase64Url(payloadBytes)}.${sigB64}`;
}

export async function verifySession(token: string, secret: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, sigB64] = parts;
  // New base64url format first, then legacy standard-base64 payload
  // (pre-upgrade cookies) so one deploy does not log out all admins.
  return (
    (await verifySessionWith(payloadB64, sigB64, secret, false)) ??
    (await verifySessionWith(payloadB64, sigB64, secret, true))
  );
}

async function verifySessionWith(
  payloadB64: string,
  sigB64: string,
  secret: string,
  legacyPayload: boolean
): Promise<string | null> {
  try {
    const payloadBytes = legacyPayload
      ? Uint8Array.from(atob(payloadB64), (c) => c.charCodeAt(0))
      : base64UrlToBytes(payloadB64);
    const payload = new TextDecoder().decode(payloadBytes);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = base64UrlToBytes(sigB64);
    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    return isValid ? payload : null;
  } catch {
    return null;
  }
}
