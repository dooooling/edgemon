import { describe, it, expect } from 'vitest';
import { evaluateAlerts } from '../src/db/alerts';

function createMockDb() {
  const nodes = [
    {
      id: 'node-1',
      name: 'Tokyo-01',
      hidden: 0,
      expires_at_ms: null,
      memory_limit_bytes: 8 * 1024 * 1024 * 1024,
      rootfs_limit_bytes: 100 * 1024 * 1024 * 1024,
      last_seen_at_ms: Date.now() - 100 * 1000, // 100s ago (offline > 90s)
      cpu_usage_pct: 95.0,
      memory_used_bytes: 7 * 1024 * 1024 * 1024,
      rootfs_used_bytes: 90 * 1024 * 1024 * 1024,
    },
    {
      id: 'node-2',
      name: 'Osaka-02',
      hidden: 0,
      expires_at_ms: null,
      memory_limit_bytes: 4 * 1024 * 1024 * 1024,
      rootfs_limit_bytes: 50 * 1024 * 1024 * 1024,
      last_seen_at_ms: Date.now() - 10 * 1000, // 10s ago (online)
      cpu_usage_pct: 20.0,
      memory_used_bytes: 1 * 1024 * 1024 * 1024,
      rootfs_used_bytes: 10 * 1024 * 1024 * 1024,
    },
  ];

  const rules = [
    {
      id: 101,
      node_id: null, // Global rule
      type: 'cpu',
      threshold: 90,
      duration_sec: 0, // Instant
      enabled: 1,
      config_json: null,
    },
    {
      id: 102,
      node_id: 'node-2',
      type: 'cpu',
      threshold: 90,
      duration_sec: 60, // 60s pending required
      enabled: 1,
      config_json: null,
    },
  ];

  const states = new Map<string, any>();

  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return this;
        },
        async all() {
          if (sql.includes('FROM nodes')) {
            return { results: nodes };
          }
          if (sql.includes('FROM alert_rules')) {
            return { results: rules };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM alert_states')) {
            return null; // Initial state: empty
          }
          return null;
        },
        async run() {
          return { success: true };
        },
      };
    },
  } as any;
}

describe('Alert Engine & State Machine', () => {
  it('detects 90s offline threshold and triggers built-in firing event', async () => {
    const mockDb = createMockDb();
    const transitions = await evaluateAlerts(mockDb, 90);

    const offlineTransitions = transitions.filter((t) => t.type === 'offline');
    expect(offlineTransitions.length).toBe(1);
    expect(offlineTransitions[0].nodeId).toBe('node-1');
    expect(offlineTransitions[0].status).toBe('firing');
  });

  it('evaluates global CPU rule and isolates state per node', async () => {
    const mockDb = createMockDb();
    const transitions = await evaluateAlerts(mockDb, 90);

    const cpuTransitions = transitions.filter((t) => t.type === 'cpu');
    expect(cpuTransitions.length).toBe(1);
    expect(cpuTransitions[0].nodeId).toBe('node-1');
    expect(cpuTransitions[0].status).toBe('firing');
  });
});
