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
export async function signSession(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${btoa(payload)}.${sigB64}`;
}

export async function verifySession(token: string, secret: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [b64Payload, sigB64] = parts;
  try {
    const payload = atob(b64Payload);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    return isValid ? payload : null;
  } catch {
    return null;
  }
}
