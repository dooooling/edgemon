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

    // IPv6 bracketed literals blocked targets
    expect(isAllowedWebhookUrl('https://[::1]/')).toBe(false);
    expect(isAllowedWebhookUrl('https://[::]/')).toBe(false);
    expect(isAllowedWebhookUrl('https://[fc00::1]/')).toBe(false);
    expect(isAllowedWebhookUrl('https://[fd00::1]/')).toBe(false);
    expect(isAllowedWebhookUrl('https://[fe80::1]/')).toBe(false);
    expect(isAllowedWebhookUrl('https://[::ffff:127.0.0.1]/')).toBe(false);
    expect(isAllowedWebhookUrl('https://[::ffff:10.0.0.1]/')).toBe(false);
    expect(isAllowedWebhookUrl('https://[::ffff:192.168.1.1]/')).toBe(false);
    expect(isAllowedWebhookUrl('https://[2001:db8::1]/')).toBe(false);

    // Allowed public HTTPS webhook targets
    expect(isAllowedWebhookUrl('https://discord.com/api/webhooks/123/abc')).toBe(true);
    expect(isAllowedWebhookUrl('https://api.telegram.org/bot123:abc/sendMessage')).toBe(true);
    expect(isAllowedWebhookUrl('https://hooks.slack.com/services/T00/B00/X00')).toBe(true);
    expect(isAllowedWebhookUrl('https://notify.example.com/alerts')).toBe(true);
    expect(isAllowedWebhookUrl('https://[2606:4700:4700::1111]/')).toBe(true); // Public Cloudflare IPv6
  });

  it('validateDnsAndSsrf: fail-closed on private IPs, invalid protocols, and resolution failures', async () => {
    const { validateDnsAndSsrf } = await import('../src/services/notifications');

    // Direct private IP tests (fail-closed)
    expect(await validateDnsAndSsrf('http://127.0.0.1/hook')).toBe(false);
    expect(await validateDnsAndSsrf('https://10.0.0.1/hook')).toBe(false);
    expect(await validateDnsAndSsrf('https://192.168.1.1/hook')).toBe(false);
    expect(await validateDnsAndSsrf('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(await validateDnsAndSsrf('https://[::ffff:127.0.0.1]/hook')).toBe(false);
    expect(await validateDnsAndSsrf('ftp://example.com/hook')).toBe(false);

    // Mocked DoH network error: MUST fail-closed and return false
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string) => {
        if (typeof url === 'string' && url.includes('dns-query')) {
          throw new Error('Network socket disconnected during DNS lookup');
        }
        return originalFetch(url);
      }) as any;

      expect(await validateDnsAndSsrf('https://some-valid-target.com/webhook')).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    expect(maskWebhookUrl('https://open.feishu.cn/open-apis/bot/v2/hook/abcdef-1234-5678')).toBe(
      'https://open.feishu.cn/open-apis/bot/v2/hook/***REDACTED***'
    );
    expect(maskWebhookUrl('https://oapi.dingtalk.com/robot/send?access_token=secret123')).toBe(
      'https://oapi.dingtalk.com/robot/send?access_token=***REDACTED***'
    );
    expect(maskWebhookUrl('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret456')).toBe(
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***REDACTED***'
    );
    expect(maskWebhookUrl('https://api.day.app/my_secret_device_key')).toBe(
      'https://api.day.app/***REDACTED***'
    );
    expect(maskWebhookUrl('https://sctapi.ftqq.com/SCT123456789.send')).toBe(
      'https://sctapi.ftqq.com/***REDACTED***.send'
    );
    expect(maskWebhookUrl('https://api2.pushdeer.com/message/push?pushkey=PDU123456')).toBe(
      'https://api2.pushdeer.com/message/push?pushkey=***REDACTED***'
    );
  });

  it('renders template variables accurately for custom webhooks', async () => {
    const { renderTemplate, formatWebhookPayload } = await import('../src/services/notifications');
    const event = {
      title: 'CPU 负载过高',
      message: 'CPU 使用率已达 95%',
      nodeId: 'node-tokyo-1',
      nodeName: 'Tokyo-01',
      type: 'cpu',
      status: 'firing' as const,
    };

    const template = '🚨 [{{event}}] {{node_name}} ({{node_id}}): {{title}} - {{message}}';
    const rendered = renderTemplate(template, event);
    expect(rendered).toBe('🚨 [FIRING] Tokyo-01 (node-tokyo-1): CPU 负载过高 - CPU 使用率已达 95%');

    // Test formatWebhookPayload with Feishu, DingTalk, WeCom, Bark
    const feishuPayload = formatWebhookPayload(
      { url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx', channel: 'feishu' },
      event
    );
    expect(feishuPayload.method).toBe('POST');
    expect(JSON.parse(feishuPayload.body || '{}').msg_type).toBe('post');

    const dingtalkPayload = formatWebhookPayload(
      { url: 'https://oapi.dingtalk.com/robot/send?access_token=xxx', channel: 'dingtalk' },
      event
    );
    expect(dingtalkPayload.method).toBe('POST');
    expect(JSON.parse(dingtalkPayload.body || '{}').msgtype).toBe('markdown');

    const wecomPayload = formatWebhookPayload(
      { url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx', channel: 'wecom' },
      event
    );
    expect(wecomPayload.method).toBe('POST');
    expect(JSON.parse(wecomPayload.body || '{}').msgtype).toBe('markdown');

    const barkPayload = formatWebhookPayload(
      { url: 'https://api.day.app/my_key', channel: 'bark' },
      event
    );
    expect(barkPayload.method).toBe('GET');
    expect(barkPayload.url).toContain('https://api.day.app/my_key/');
    expect(barkPayload.url).toContain('group=EdgeMon');
  });

  it('respects node alert_policy mode: none to completely mute all alerts', async () => {
    const node = {
      id: 'node-muted',
      name: 'Tokyo-Muted',
      hidden: 0,
      expires_at_ms: null,
      memory_limit_bytes: 1000,
      rootfs_limit_bytes: 1000,
      last_seen_at_ms: Date.now() - 200 * 1000, // Offline > 90s
      cpu_usage_pct: 99.0, // High CPU
      memory_used_bytes: 900,
      rootfs_used_bytes: 900,
      node_config_json: JSON.stringify({
        alert_policy: { mode: 'none' },
      }),
    };
    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) { return this; },
          async all() {
            if (sql.includes('FROM nodes')) return { results: [node] };
            if (sql.includes('FROM alert_rules')) {
              return { results: [{ id: 101, node_id: null, type: 'cpu', threshold: 80, duration_sec: 0, enabled: 1 }] };
            }
            return { results: [] };
          },
          async first() { return null; },
          async run() { return { success: true }; },
        };
      },
    } as any;

    const transitions = await evaluateAlerts(mockDb, 90);
    expect(transitions.length).toBe(0); // Fully muted!
  });

  it('respects node alert_policy mode: custom to only evaluate selected rules', async () => {
    const node = {
      id: 'node-custom',
      name: 'Tokyo-Custom',
      hidden: 0,
      expires_at_ms: null,
      memory_limit_bytes: 1000,
      rootfs_limit_bytes: 1000,
      last_seen_at_ms: Date.now(),
      cpu_usage_pct: 99.0, // High CPU
      memory_used_bytes: 900, // High RAM
      rootfs_used_bytes: 100,
      node_config_json: JSON.stringify({
        alert_policy: { mode: 'custom', rule_ids: [202] }, // Only rule 202 (memory)
      }),
    };
    const rules = [
      { id: 201, node_id: null, type: 'cpu', threshold: 80, duration_sec: 0, enabled: 1, config_json: JSON.stringify({ name: 'CPU Rule', channel_ids: [10] }) },
      { id: 202, node_id: null, type: 'memory', threshold: 80, duration_sec: 0, enabled: 1, config_json: JSON.stringify({ name: 'Memory Rule', channel_ids: [20] }) },
    ];

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) { return this; },
          async all() {
            if (sql.includes('FROM nodes')) return { results: [node] };
            if (sql.includes('FROM alert_rules')) return { results: rules };
            return { results: [] };
          },
          async first() { return null; },
          async run() { return { success: true }; },
        };
      },
    } as any;

    const transitions = await evaluateAlerts(mockDb, 90);
    expect(transitions.length).toBe(1);
    expect(transitions[0].type).toBe('memory');
    expect(transitions[0].channelIds).toEqual([20]);
  });

  it('evaluates compound multi-condition policy with multiple metric triggers simultaneously', async () => {
    const node = {
      id: 'node-multi',
      name: 'Tokyo-Multi',
      hidden: 0,
      expires_at_ms: Date.now() + 2 * 86400 * 1000, // 2 days left (< 7 days)
      memory_limit_bytes: 1000,
      rootfs_limit_bytes: 1000,
      last_seen_at_ms: Date.now(),
      cpu_usage_pct: 95.0, // High CPU (> 85%)
      memory_used_bytes: 950, // High RAM (> 90%)
      rootfs_used_bytes: 100, // Normal Disk
      node_config_json: null, // Default global
    };

    const compoundRule = {
      id: 301,
      node_id: null,
      type: 'policy',
      threshold: null,
      duration_sec: 0,
      enabled: 1,
      config_json: JSON.stringify({
        name: '综合生产策略',
        channel_ids: [100, 200],
        conditions: {
          offline: { enabled: true, duration_sec: 90 },
          cpu: { enabled: true, threshold: 85, duration_sec: 0 },
          memory: { enabled: true, threshold: 90, duration_sec: 0 },
          disk: { enabled: true, threshold: 90 },
          expiry: { enabled: true, days: 7 },
        },
      }),
    };

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) { return this; },
          async all() {
            if (sql.includes('FROM nodes')) return { results: [node] };
            if (sql.includes('FROM alert_rules')) return { results: [compoundRule] };
            return { results: [] };
          },
          async first() { return null; },
          async run() { return { success: true }; },
        };
      },
    } as any;

    const transitions = await evaluateAlerts(mockDb, 90);
    const ruleTransitions = transitions.filter((t) => t.stateKey.startsWith('rule:301:'));
    expect(ruleTransitions.length).toBe(3);

    const types = ruleTransitions.map((t) => t.type);
    expect(types).toContain('cpu');
    expect(types).toContain('memory');
    expect(types).toContain('expiry');
    expect(types).not.toContain('offline');
    expect(types).not.toContain('disk');

    for (const t of ruleTransitions) {
      expect(t.channelIds).toEqual([100, 200]);
    }
  });

  it('mode: custom completely suppresses builtin offline & expiry, running only selected rules', async () => {
    const offlineNode = {
      id: 'node-custom-isolate',
      name: 'Tokyo-Custom-Isolate',
      hidden: 0,
      expires_at_ms: Date.now() + 86400 * 1000, // Expiring tomorrow
      memory_limit_bytes: 1000,
      rootfs_limit_bytes: 1000,
      last_seen_at_ms: Date.now() - 300 * 1000, // Offline > 90s
      cpu_usage_pct: 10.0,
      memory_used_bytes: 100,
      rootfs_used_bytes: 100,
      node_config_json: JSON.stringify({
        alert_policy: { mode: 'custom', rule_ids: [501] }, // Only CPU rule 501
      }),
    };

    const cpuRule = {
      id: 501,
      node_id: null,
      type: 'cpu',
      threshold: 80,
      duration_sec: 0,
      enabled: 1,
      config_json: JSON.stringify({ name: 'Custom CPU Only', channel_ids: [1] }),
    };

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) { return this; },
          async all() {
            if (sql.includes('FROM nodes')) return { results: [offlineNode] };
            if (sql.includes('FROM alert_rules')) return { results: [cpuRule] };
            return { results: [] };
          },
          async first() { return null; },
          async run() { return { success: true }; },
        };
      },
    } as any;

    const transitions = await evaluateAlerts(mockDb, 90);
    // Since CPU is normal (10% < 80%) and node is in custom mode (only rule 501),
    // builtin offline & expiry MUST NOT fire!
    expect(transitions.length).toBe(0);
  });

  it('legacy offline rule triggers exactly one firing on offline node without duplicate builtin offline', async () => {
    const offlineNode = {
      id: 'node-legacy-off',
      name: 'Tokyo-Legacy-Offline',
      hidden: 0,
      expires_at_ms: null,
      memory_limit_bytes: 1000,
      rootfs_limit_bytes: 1000,
      last_seen_at_ms: Date.now() - 150 * 1000, // Offline > 90s
      cpu_usage_pct: 10.0,
      memory_used_bytes: 100,
      rootfs_used_bytes: 100,
      node_config_json: null, // Global mode
    };

    const legacyOfflineRule = {
      id: 601,
      node_id: null,
      type: 'offline',
      threshold: 60,
      duration_sec: 0,
      enabled: 1,
      config_json: JSON.stringify({ name: 'Legacy Offline 60s', channel_ids: [10] }),
    };

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) { return this; },
          async all() {
            if (sql.includes('FROM nodes')) return { results: [offlineNode] };
            if (sql.includes('FROM alert_rules')) return { results: [legacyOfflineRule] };
            return { results: [] };
          },
          async first() { return null; },
          async run() { return { success: true }; },
        };
      },
    } as any;

    const transitions = await evaluateAlerts(mockDb, 90);
    // MUST trigger exactly one offline alert (from rule 601), and builtin:offline MUST NOT fire
    expect(transitions.length).toBe(1);
    expect(transitions[0].stateKey).toBe('rule:601:node-legacy-off');
    expect(transitions[0].type).toBe('offline');
    expect(transitions[0].status).toBe('firing');
    expect(transitions[0].channelIds).toEqual([10]);
  });

  it('legacy expiry rule triggers exactly one firing on expiring node without duplicate builtin expiry', async () => {
    const expiringNode = {
      id: 'node-legacy-exp',
      name: 'Tokyo-Legacy-Expiring',
      hidden: 0,
      expires_at_ms: Date.now() + 2 * 86400 * 1000, // 2 days left (< 7 days)
      memory_limit_bytes: 1000,
      rootfs_limit_bytes: 1000,
      last_seen_at_ms: Date.now(), // Online
      cpu_usage_pct: 10.0,
      memory_used_bytes: 100,
      rootfs_used_bytes: 100,
      node_config_json: null, // Global mode
    };

    const legacyExpiryRule = {
      id: 701,
      node_id: null,
      type: 'expiry',
      threshold: 7, // 7 days
      duration_sec: 0,
      enabled: 1,
      config_json: JSON.stringify({ name: 'Legacy Expiry 7d', channel_ids: [20] }),
    };

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) { return this; },
          async all() {
            if (sql.includes('FROM nodes')) return { results: [expiringNode] };
            if (sql.includes('FROM alert_rules')) return { results: [legacyExpiryRule] };
            return { results: [] };
          },
          async first() { return null; },
          async run() { return { success: true }; },
        };
      },
    } as any;

    const transitions = await evaluateAlerts(mockDb, 90);
    // MUST trigger exactly one expiry alert (from rule 701), and builtin:expiry MUST NOT fire
    expect(transitions.length).toBe(1);
    expect(transitions[0].stateKey).toBe('rule:701:node-legacy-exp');
    expect(transitions[0].type).toBe('expiry');
    expect(transitions[0].status).toBe('firing');
    expect(transitions[0].channelIds).toEqual([20]);
  });
});


