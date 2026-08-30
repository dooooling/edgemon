import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  validateHelloPayload,
  validateReportPayload,
  AgentEnvelope,
  ServerEnvelope,
  HelloPayload,
  ReportPayload,
  WelcomeData,
  ConfigData,
  ConfigAckData,
  AckData,
  ErrorData,
} from '../src/protocol/types';

function loadFixture<T>(filename: string): T {
  const filePath = resolve(__dirname, '../../protocol/fixtures', filename);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

describe('Worker Protocol Contract Tests (Fixtures Alignment)', () => {
  it('correctly deserializes and validates hello.json fixture', () => {
    const envelope = loadFixture<AgentEnvelope<HelloPayload>>('hello.json');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('hello');
    expect(envelope.instance_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(envelope.seq).toBe(1);

    const valid = validateHelloPayload(envelope.data);
    expect(valid).toBe(true);
    expect(envelope.data.environment.type).toBe('container');
    expect(envelope.data.resources.cpu_capacity_cores).toBe(0.5);
  });

  it('correctly deserializes and validates report.json fixture', () => {
    const envelope = loadFixture<AgentEnvelope<ReportPayload>>('report.json');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('report');
    expect(envelope.data.samples).toBeDefined();
    expect(envelope.data.samples!.length).toBeGreaterThan(0);

    const valid = validateReportPayload(envelope.data);
    expect(valid).toBe(true);
    expect(envelope.data.samples![0].metrics.cpu.usage_pct).toBe(14.5);
    expect(envelope.data.samples![0].metrics.network.interface).toBe('eth0');
  });

  it('correctly deserializes welcome.json fixture', () => {
    const envelope = loadFixture<ServerEnvelope<WelcomeData>>('welcome.json');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('welcome');
    expect(envelope.data.config_rev).toBe(1);
    expect(envelope.data.config).toBeDefined();
    expect(envelope.data.config.sample_interval_sec).toBe(2);
  });

  it('correctly deserializes config.json fixture', () => {
    const envelope = loadFixture<ServerEnvelope<ConfigData>>('config.json');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('config');
    expect(envelope.data.config_rev).toBeDefined();
  });

  it('correctly deserializes config_ack.json fixture', () => {
    const envelope = loadFixture<AgentEnvelope<ConfigAckData>>('config_ack.json');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('config_ack');
    expect(envelope.data.config_rev).toBe(2);
    expect(envelope.data.status).toBe('applied');
  });

  it('correctly deserializes ack.json fixture', () => {
    const envelope = loadFixture<ServerEnvelope<AckData>>('ack.json');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('ack');
    expect(envelope.data.persisted_sample_seq).toBe(1001);
    expect(envelope.data.config_rev).toBe(1);
  });

  it('correctly deserializes error.json fixture', () => {
    const envelope = loadFixture<ServerEnvelope<ErrorData>>('error.json');
    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('error');
    expect(envelope.data.code).toBeDefined();
    expect(envelope.data.message).toBeDefined();
  });
});
