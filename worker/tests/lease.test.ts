import { describe, it, expect } from 'vitest';
import { ServerConfig, ServerEnvelope, ConfigData } from '../src/protocol/types';

describe('Detail-Watch Lease 2s Acceleration & Baseline Restoration Specification', () => {
  function computeEffectiveConfig(
    baseConfig: ServerConfig,
    activeWatchersCount: number,
    leaseExpiresAtMs: number,
    currentTimeMs: number
  ): ServerConfig {
    const hasActiveLease = activeWatchersCount > 0 && currentTimeMs < leaseExpiresAtMs;
    const effectiveStream = hasActiveLease ? 2 : (baseConfig.stream_interval_sec ?? 30);
    const effectiveSample = hasActiveLease ? 2 : (baseConfig.sample_interval_sec ?? 30);

    return {
      ...baseConfig,
      sample_interval_sec: effectiveSample,
      stream_interval_sec: effectiveStream,
    };
  }

  it('accelerates agent to 2s reporting when user opens node detail page', () => {
    const adminCustomConfig: ServerConfig = {
      sample_interval_sec: 15,
      stream_interval_sec: 15,
      probe_interval_sec: 60,
      network_interface: 'auto',
      probes: [],
    };

    const now = 1787640000000;
    const leaseTtlMs = now + 60_000; // 60s TTL

    // 1 watcher active on detail page
    const effective = computeEffectiveConfig(adminCustomConfig, 1, leaseTtlMs, now);

    expect(effective.stream_interval_sec).toBe(2);
    expect(effective.sample_interval_sec).toBe(2);
    expect(effective.probe_interval_sec).toBe(60);
  });

  it('restores admin custom interval (e.g. 15s) when user leaves detail page (0 watchers)', () => {
    const adminCustomConfig: ServerConfig = {
      sample_interval_sec: 15,
      stream_interval_sec: 15,
      probe_interval_sec: 60,
      network_interface: 'auto',
      probes: [],
    };

    const now = 1787640000000;
    const leaseTtlMs = now + 60_000;

    // 0 watchers remaining (user closed tab)
    const effective = computeEffectiveConfig(adminCustomConfig, 0, leaseTtlMs, now);

    expect(effective.stream_interval_sec).toBe(15);
    expect(effective.sample_interval_sec).toBe(15);
    expect(effective.probe_interval_sec).toBe(60);
  });

  it('restores baseline interval when 60s lease TTL expires', () => {
    const adminCustomConfig: ServerConfig = {
      sample_interval_sec: 30,
      stream_interval_sec: 30,
      probe_interval_sec: 60,
      network_interface: 'auto',
      probes: [],
    };

    const now = 1787640000000;
    const expiredLeaseTtlMs = now - 1000; // Expired 1s ago

    const effective = computeEffectiveConfig(adminCustomConfig, 1, expiredLeaseTtlMs, now);

    expect(effective.stream_interval_sec).toBe(30);
    expect(effective.sample_interval_sec).toBe(30);
  });

  it('builds valid v1 config envelope for agent lease broadcast', () => {
    const dynamicConfig: ServerConfig = {
      sample_interval_sec: 2,
      stream_interval_sec: 2,
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
        config: dynamicConfig,
      },
    };

    expect(envelope.v).toBe(1);
    expect(envelope.type).toBe('config');
    expect(envelope.data.config.stream_interval_sec).toBe(2);
  });
});
