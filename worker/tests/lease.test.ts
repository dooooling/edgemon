import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  validateHelloPayload,
  validateServerConfig,
  AgentEnvelope,
  HelloPayload,
  ServerEnvelope,
  ConfigData,
  WelcomeData,
} from '../src/protocol/types';

function loadFixture<T>(filename: string): T {
  const filePath = resolve(__dirname, '../../protocol/fixtures', filename);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

describe('Realtime Subscription Invariant', () => {
  it('canonical steady-state intervals are 2s/2s/60s (welcome fixture)', () => {
    const envelope = loadFixture<ServerEnvelope<WelcomeData>>('welcome.json');
    expect(envelope.data.config.sample_interval_sec).toBe(2);
    expect(envelope.data.config.stream_interval_sec).toBe(2);
    expect(envelope.data.config.probe_interval_sec).toBe(60);
  });

  it('validator accepts the canonical 2s config and rejects bad intervals', () => {
    expect(validateServerConfig({ sample_interval_sec: 2, stream_interval_sec: 2 }).valid).toBe(true);
    expect(validateServerConfig({ sample_interval_sec: 0, stream_interval_sec: 2 }).valid).toBe(false);
    expect(validateServerConfig({ sample_interval_sec: 2, stream_interval_sec: 61 }).valid).toBe(false);
  });

  it('hello fixture carries no browser-mutable interval fields', () => {
    // Agent intervals are server-driven (config push) — a browser subscriber
    // has no protocol path to mutate them. Guard the shape: hello must not
    // grow interval knobs outside resources/config.
    const envelope = loadFixture<AgentEnvelope<HelloPayload>>('hello.json');
    expect(validateHelloPayload(envelope.data)).toBe(true);
    const data = envelope.data as unknown as Record<string, unknown>;
    expect(data.sample_interval_sec).toBeUndefined();
    expect(data.stream_interval_sec).toBeUndefined();
  });

  it('builds valid v1 config envelope for agent configuration push', () => {
    const envelope = loadFixture<ServerEnvelope<ConfigData>>('config.json');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('config');
  });
});
