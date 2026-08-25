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

// AES-GCM encryption with 96-bit random nonce
export async function encryptSecret(plainText: string, secretKeyHex: string): Promise<{ nonceB64: string; cipherB64: string }> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secretKeyHex.padEnd(32, '0').slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['encrypt']);

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

export async function decryptSecret(nonceB64: string, cipherB64: string, secretKeyHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secretKeyHex.padEnd(32, '0').slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['decrypt']);

  const nonce = Uint8Array.from(atob(nonceB64), (c) => c.charCodeAt(0));
  const cipher = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    cipher
  );

  return new TextDecoder().decode(decryptedBuffer);
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
  if (parts.len !== 2 && parts.length !== 2) {
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
