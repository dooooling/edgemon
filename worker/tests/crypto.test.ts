import { describe, it, expect } from 'vitest';
import { sha256, generateRandomToken, encryptSecret, decryptSecret, signSession, verifySession } from '../src/services/crypto';

describe('Web Crypto Utilities', () => {
  it('computes sha256 correctly', async () => {
    const hash = await sha256('hello world');
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('generates high entropy tokens', () => {
    const token1 = generateRandomToken(32);
    const token2 = generateRandomToken(32);
    expect(token1).not.toBe(token2);
    expect(token1.length).toBeGreaterThanOrEqual(40);
  });

  it('encrypts and decrypts secrets with AES-GCM', async () => {
    const secret = 'https://discord.com/api/webhooks/123/xyz';
    const key = 'test-secret-key-32-bytes-long!';
    const { nonceB64, cipherB64 } = await encryptSecret(secret, key);

    const decrypted = await decryptSecret(nonceB64, cipherB64, key);
    expect(decrypted).toBe(secret);
  });

  it('signs and verifies admin sessions', async () => {
    const payload = JSON.stringify({ role: 'admin', uid: '123' });
    const secret = 'test-hmac-session-secret';

    const token = await signSession(payload, secret);
    const verified = await verifySession(token, secret);
    expect(verified).toBe(payload);

    // Tampered token must fail
    const tampered = token.slice(0, -4) + 'abcd';
    const failed = await verifySession(tampered, secret);
    expect(failed).toBeNull();
  });
});
