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

  it('P2-4: transitions firing alert to resolved when memory_used_bytes drops to exactly 0', async () => {
    const node = {
      id: 'node-1',
      name: 'Tokyo-01',
      hidden: 0,
      expires_at_ms: null,
      memory_limit_bytes: 1000,
      rootfs_limit_bytes: 1000,
      last_seen_at_ms: Date.now(),
      cpu_usage_pct: 10,
      memory_used_bytes: 0, // Dropped to exactly 0
      rootfs_used_bytes: 100,
    };
    const rule = {
      id: 201,
      node_id: 'node-1',
      type: 'memory',
      threshold: 80,
      duration_sec: 0,
      enabled: 1,
      config_json: null,
    };
    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) { return this; },
          async all() {
            if (sql.includes('FROM nodes')) return { results: [node] };
            if (sql.includes('FROM alert_rules')) return { results: [rule] };
            return { results: [] };
          },
          async first() {
            if (sql.includes('FROM alert_states')) {
              // Was active previously
              return { state_key: 'rule:201:node-1', active: 1, pending_since_ms: null };
            }
            return null;
          },
          async run() { return { success: true }; },
        };
      },
    } as any;

    const transitions = await evaluateAlerts(mockDb, 90);
    const memTrans = transitions.filter((t) => t.type === 'memory');
    expect(memTrans.length).toBe(1);
    expect(memTrans[0].status).toBe('resolved');
  });

  it('SSRF Defense: correctly blocks loopback, private IPv4/IPv6, and metadata addresses', async () => {
    const { isAllowedWebhookUrl } = await import('../src/services/notifications');

    // Blocked malicious/private targets
    expect(isAllowedWebhookUrl('http://127.0.0.1/webhook')).toBe(false);
    expect(isAllowedWebhookUrl('https://localhost:8080/hook')).toBe(false);
    expect(isAllowedWebhookUrl('https://10.0.1.5:8443/webhook')).toBe(false);
    expect(isAllowedWebhookUrl('https://172.20.0.1/webhook')).toBe(false);
    expect(isAllowedWebhookUrl('https://192.168.1.100/webhook')).toBe(false);
    expect(isAllowedWebhookUrl('https://169.254.169.254/latest/meta-data')).toBe(false); // Cloud metadata
    expect(isAllowedWebhookUrl('https://100.64.0.1/webhook')).toBe(false); // Carrier grade NAT
    expect(isAllowedWebhookUrl('ftp://example.com/webhook')).toBe(false);

    // Allowed public HTTPS webhook targets
    expect(isAllowedWebhookUrl('https://discord.com/api/webhooks/123/abc')).toBe(true);
    expect(isAllowedWebhookUrl('https://api.telegram.org/bot123:abc/sendMessage')).toBe(true);
    expect(isAllowedWebhookUrl('https://hooks.slack.com/services/T00/B00/X00')).toBe(true);
    expect(isAllowedWebhookUrl('https://notify.example.com/alerts')).toBe(true);
  });

  it('formats notification payloads properly for Discord, Telegram, and Generic channels', async () => {
    const { formatWebhookPayload } = await import('../src/services/notifications');

    const event = {
      title: 'Node Tokyo-01 is Offline',
      message: 'No heartbeat received in last 90 seconds',
      nodeId: 'node-1',
      nodeName: 'Tokyo-01',
      type: 'offline',
      status: 'firing' as const,
    };

    // Discord formatting
    const discord = formatWebhookPayload(
      { url: 'https://discord.com/api/webhooks/123/abc' },
      event
    );
    const discordBody = JSON.parse(discord.body);
    expect(discordBody.embeds).toBeDefined();
    expect(discordBody.embeds[0].title).toBe('Node Tokyo-01 is Offline');
    expect(discordBody.embeds[0].color).toBe(0xe74c3c); // Red for firing

    // Telegram formatting
    const telegram = formatWebhookPayload(
      { url: 'https://api.telegram.org/bot123/sendMessage' },
      event
    );
    const telegramBody = JSON.parse(telegram.body);
    expect(telegramBody.parse_mode).toBe('Markdown');
    expect(telegramBody.text).toContain('🚨 *[EdgeMon Alert]*');

    // Generic formatting
    const generic = formatWebhookPayload(
      { url: 'https://custom-webhook.com/alert' },
      event
    );
    const genericBody = JSON.parse(generic.body);
    expect(genericBody.event).toBe('alert_firing');
    expect(genericBody.node_id).toBe('node-1');
  });

  it('maskWebhookUrl: preserves host and masks sensitive path credentials for Discord, Telegram, and generic webhooks', async () => {
    const { maskWebhookUrl } = await import('../src/services/notifications');

    expect(maskWebhookUrl('https://discord.com/api/webhooks/123456789/SuperSecretToken')).toBe(
      'https://discord.com/api/webhooks/123456789/***REDACTED***'
    );
    expect(maskWebhookUrl('https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage')).toBe(
      'https://api.telegram.org/bot***REDACTED***/sendMessage'
    );
    expect(maskWebhookUrl('https://hooks.slack.com/services/T000/B000/XXXXX')).toBe(
      'https://hooks.slack.com/services/***REDACTED***'
    );
    // Generic webhooks: strips 100% path and query secrets
    expect(maskWebhookUrl('https://my-webhook.internal.org/endpoint?token=supersecret123')).toBe(
      'https://my-webhook.internal.org/***REDACTED***'
    );
  });

  it('retries resolved notifications until delivered', async () => {
    const node = {
      id: 'node-1',
      name: 'Tokyo-01',
      hidden: 0,
      expires_at_ms: null,
      memory_limit_bytes: 1000,
      rootfs_limit_bytes: 1000,
      last_seen_at_ms: Date.now(),
      cpu_usage_pct: 10,
      memory_used_bytes: 100,
      rootfs_used_bytes: 100,
    };
    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) { return this; },
          async all() {
            if (sql.includes('FROM nodes')) return { results: [node] };
            if (sql.includes('FROM alert_rules')) return { results: [] };
            return { results: [] };
          },
          async first() {
            if (sql.includes('FROM alert_states')) {
              // Was resolved in past, but last_notified_at_ms is null (delivery failed!)
              return { state_key: 'builtin:offline:node-1', active: 0, last_notified_at_ms: null, updated_at_ms: Date.now() - 120_000 };
            }
            return null;
          },
          async run() { return { success: true }; },
        };
      },
    } as any;

    const transitions = await evaluateAlerts(mockDb, 90);
    const offlineTrans = transitions.filter((t) => t.type === 'offline');
    expect(offlineTrans.length).toBe(1);
    expect(offlineTrans[0].status).toBe('resolved');
  });
});


