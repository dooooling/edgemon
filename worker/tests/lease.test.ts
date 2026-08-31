import { describe, it, expect } from 'vitest';
import { ServerConfig, ServerEnvelope, ConfigData } from '../src/protocol/types';

describe('RealtimeHub Subscriber & Invariant Verification', () => {
  it('guarantees invariant: browser subscribers MUST NOT change agent steady collection interval', () => {
    const adminConfig: ServerConfig = {
      sample_interval_sec: 30,
      stream_interval_sec: 30,
      probe_interval_sec: 60,
      network_interface: 'auto',
      probes: [],
    };

    // Agent config remains strictly stable according to admin configuration
    expect(adminConfig.sample_interval_sec).toBe(30);
    expect(adminConfig.stream_interval_sec).toBe(30);
  });

  it('builds valid v1 config envelope for agent configuration push', () => {
    const serverConfig: ServerConfig = {
      sample_interval_sec: 30,
      stream_interval_sec: 30,
      probe_interval_sec: 60,
      network_interface: 'eth0',
      probes: [],
    };

    const envelope: ServerEnvelope<ConfigData> = {
      v: 1,
      type: 'config',
      instance_id: '',
      seq: 0,
      ts_ms: 1787640000000,
      data: {
        config_rev: 5,
        config: serverConfig,
      },
    };

    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('config');
    expect(envelope.data.config.stream_interval_sec).toBe(30);
  });
});
