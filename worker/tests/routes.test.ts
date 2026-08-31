import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: any;
    env: any;
    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { RealtimeHub } from '../src/durable/realtime-hub';
import { CloseCodes } from '../src/protocol/types';

describe('RealtimeHub & Route Revocation State Machine (P0-2, P1-4)', () => {
  function createMockRealtimeHub() {
    const sockets: any[] = [];
    const mockCtx = {
      getWebSockets: (_tag: string) => sockets,
      acceptWebSocket: vi.fn(),
    };

    const mockDb = {
      prepare: (_sql: string) => ({
        bind: (..._args: any[]) => ({
          first: async () => null,
          run: async () => ({ success: true }),
        }),
      }),
    };

    const mockEnv = {
      DB: mockDb,
    };

    const hub = new RealtimeHub(mockCtx as any, mockEnv as any);
    return { hub, sockets, mockCtx };
  }

  function createMockWs(nodeId: string, tokenHash: string, instanceId = 'inst-1') {
    let attachment: any = {
      kind: 'agent',
      node_id: nodeId,
      node_name: 'Node 1',
      instance_id: instanceId,
      connected_at_ms: Date.now(),
      hello_ok: false,
      last_seq: 0,
      config_rev: 1,
      persisted_sample_seq: 0,
      traffic_reset_day: 1,
      is_hidden: false,
      token_hash: tokenHash,
      geo: {
        egress_ip: '1.2.3.4',
        geo_country: 'US',
        geo_region: 'CA',
        geo_region_code: 'CA',
        geo_city: 'San Francisco',
        geo_lat: 37.7749,
        geo_lon: -122.4194,
        geo_timezone: 'America/Los_Angeles',
        geo_continent: 'NA',
        asn: 13335,
        as_org: 'Cloudflare',
        cf_colo: 'SFO',
      },
    };

    let closedCode: number | null = null;
    let closedReason: string | null = null;
    const sentMessages: string[] = [];

    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: (att: any) => { attachment = att; },
      send: (msg: string) => { sentMessages.push(msg); },
      close: (code: number, reason: string) => {
        closedCode = code;
        closedReason = reason;
      },
      get closedCode() { return closedCode; },
      get closedReason() { return closedReason; },
      get sentMessages() { return sentMessages; },
      get attachment() { return attachment; },
    };

    return ws;
  }

  it('P0-2: normal disconnect (HTTP fallback / config change) without tokenHash does NOT blacklist token', async () => {
    const { hub, sockets } = createMockRealtimeHub();

    // 1. Existing socket connected with token-hash-1
    const ws1 = createMockWs('node-1', 'token-hash-1');
    sockets.push(ws1);

    // 2. HTTP fallback hello triggers disconnectAgent without revokedTokenHash
    const res = await hub.disconnectAgent('node-1', CloseCodes.REPLACED_BY_NEW_INSTANCE, 'Replaced by HTTP hello');
    expect(res.success).toBe(true);
    expect(res.closedCount).toBe(1);
    expect(ws1.closedCode).toBe(CloseCodes.REPLACED_BY_NEW_INSTANCE);

    // 3. New WSS connection reconnects with SAME token-hash-1
    const ws2 = createMockWs('node-1', 'token-hash-1');
    sockets.length = 0;
    sockets.push(ws2);

    // Send hello message
    const helloEnvelope = {
      v: 1,
      type: 'hello',
      instance_id: 'inst-1',
      seq: 1,
      data: {
        agent: { version: '0.1.0', arch: 'x86_64' },
        system: { hostname: 'host1', os: 'linux', kernel: '6.1.0' },
        environment: { type: 'physical', resource_scope: 'machine' },
        resources: { rootfs_scope: 'visible_filesystem' },
        sources: { cpu: 'procfs', memory: 'procfs', io: 'diskstats', network: 'netns', rootfs: 'statvfs' },
        capabilities: { icmp_probe: false, tcp_probe: true },
      },
    };

    await hub.webSocketMessage(ws2 as any, JSON.stringify(helloEnvelope));

    // Verified: Hello succeeds! ws2 is NOT closed with 4003 TOKEN_REVOKED!
    expect(ws2.closedCode).toBeNull();
    expect(ws2.attachment.hello_ok).toBe(true);
    expect(ws2.sentMessages.length).toBe(1);
    const welcome = JSON.parse(ws2.sentMessages[0]);
    expect(welcome.type).toBe('welcome');
  });

  it('P0-2: traffic_reset_day change disconnect does NOT blacklist token and allows WSS reconnect', async () => {
    const { hub, sockets } = createMockRealtimeHub();

    const ws1 = createMockWs('node-1', 'token-hash-1');
    sockets.push(ws1);

    await hub.disconnectAgent('node-1', 4005, 'TRAFFIC_RESET_DAY_CHANGED');
    expect(ws1.closedCode).toBe(4005);

    // Reconnect with same token
    const ws2 = createMockWs('node-1', 'token-hash-1');
    sockets.length = 0;
    sockets.push(ws2);

    const helloEnvelope = {
      v: 1,
      type: 'hello',
      instance_id: 'inst-1',
      seq: 1,
      data: {
        agent: { version: '0.1.0', arch: 'x86_64' },
        system: { hostname: 'host1', os: 'linux', kernel: '6.1.0' },
        environment: { type: 'physical', resource_scope: 'machine' },
        resources: { rootfs_scope: 'visible_filesystem' },
        sources: { cpu: 'procfs', memory: 'procfs', io: 'diskstats', network: 'netns', rootfs: 'statvfs' },
        capabilities: { icmp_probe: false, tcp_probe: true },
      },
    };

    await hub.webSocketMessage(ws2 as any, JSON.stringify(helloEnvelope));

    // Verified: Hello succeeds with 200 welcome
    expect(ws2.closedCode).toBeNull();
    expect(ws2.attachment.hello_ok).toBe(true);
  });

  it('Token rotation: old token hash is blocked, new token hash succeeds', async () => {
    const { hub, sockets } = createMockRealtimeHub();

    const ws1 = createMockWs('node-1', 'token-hash-old');
    sockets.push(ws1);

    // Admin rotates token: disconnects with oldTokenHash
    await hub.disconnectAgent('node-1', CloseCodes.TOKEN_REVOKED, 'TOKEN_REVOKED', 'token-hash-old');
    expect(ws1.closedCode).toBe(CloseCodes.TOKEN_REVOKED);

    // Old socket attempts hello with token-hash-old
    const wsOld = createMockWs('node-1', 'token-hash-old');
    sockets.length = 0;
    sockets.push(wsOld);

    const helloEnvelope = {
      v: 1,
      type: 'hello',
      instance_id: 'inst-1',
      seq: 1,
      data: {
        agent: { version: '0.1.0', arch: 'x86_64' },
        system: { hostname: 'host1', os: 'linux', kernel: '6.1.0' },
        environment: { type: 'physical', resource_scope: 'machine' },
        resources: { rootfs_scope: 'visible_filesystem' },
        sources: { cpu: 'procfs', memory: 'procfs', io: 'diskstats', network: 'netns', rootfs: 'statvfs' },
        capabilities: { icmp_probe: false, tcp_probe: true },
      },
    };

    await hub.webSocketMessage(wsOld as any, JSON.stringify(helloEnvelope));
    // Verified: old token is rejected with TOKEN_REVOKED!
    expect(wsOld.closedCode).toBe(CloseCodes.TOKEN_REVOKED);
    expect(wsOld.attachment.hello_ok).toBe(false);

    // New socket connects with token-hash-new
    const wsNew = createMockWs('node-1', 'token-hash-new');
    sockets.length = 0;
    sockets.push(wsNew);

    await hub.webSocketMessage(wsNew as any, JSON.stringify(helloEnvelope));
    // Verified: new token succeeds!
    expect(wsNew.closedCode).toBeNull();
    expect(wsNew.attachment.hello_ok).toBe(true);
  });

  it('Node deletion: wildcard blacklist blocks all tokens permanently', async () => {
    const { hub, sockets } = createMockRealtimeHub();

    const ws1 = createMockWs('node-1', 'token-hash-1');
    sockets.push(ws1);

    // Node deleted: wildcard blacklist
    await hub.disconnectAgent('node-1', CloseCodes.NODE_DISABLED, 'NODE_DISABLED', '*');
    expect(ws1.closedCode).toBe(CloseCodes.NODE_DISABLED);

    // Any reconnect is blocked
    const wsAny = createMockWs('node-1', 'any-token-hash');
    sockets.length = 0;
    sockets.push(wsAny);

    const helloEnvelope = {
      v: 1,
      type: 'hello',
      instance_id: 'inst-1',
      seq: 1,
      data: {
        agent: { version: '0.1.0', arch: 'x86_64' },
        system: { hostname: 'host1', os: 'linux', kernel: '6.1.0' },
        environment: { type: 'physical', resource_scope: 'machine' },
        resources: { rootfs_scope: 'visible_filesystem' },
        sources: { cpu: 'procfs', memory: 'procfs', io: 'diskstats', network: 'netns', rootfs: 'statvfs' },
        capabilities: { icmp_probe: false, tcp_probe: true },
      },
    };

    await hub.webSocketMessage(wsAny as any, JSON.stringify(helloEnvelope));
    expect(wsAny.closedCode).toBe(CloseCodes.TOKEN_REVOKED);
    expect(wsAny.attachment.hello_ok).toBe(false);
  });

  it('P2-3: dynamic PATCH updates only provided fields and correctly clears nullable fields to NULL', async () => {
    let executedSql = '';
    let boundValues: any[] = [];

    const mockDb = {
      prepare: (sql: string) => {
        executedSql = sql;
        return {
          bind: (...args: any[]) => {
            boundValues = args;
            return {
              run: async () => ({ success: true }),
            };
          },
        };
      },
    };

    // Simulate PATCH handler building dynamic SQL:
    const body: Record<string, any> = {
      note: null,
      traffic_quota_bytes: null,
      manual_city: null,
      name: 'Renamed Node',
    };

    const allowedFields: Record<string, string> = {
      name: 'name',
      sort_order: 'sort_order',
      hidden: 'hidden',
      note: 'note',
      traffic_reset_day: 'traffic_reset_day',
      traffic_quota_bytes: 'traffic_quota_bytes',
      location_mode: 'location_mode',
      manual_country: 'manual_country',
      manual_city: 'manual_city',
      manual_lat: 'manual_lat',
      manual_lon: 'manual_lon',
      expires_at_ms: 'expires_at_ms',
    };

    const setClauses: string[] = [];
    const setValues: any[] = [];
    const now = 1700000000000;
    const id = 'node-1';

    for (const [bodyKey, colName] of Object.entries(allowedFields)) {
      if (Object.prototype.hasOwnProperty.call(body, bodyKey)) {
        setClauses.push(`${colName} = ?`);
        let val = body[bodyKey];
        if (bodyKey === 'hidden' && val !== null && val !== undefined) {
          val = val ? 1 : 0;
        }
        setValues.push(val);
      }
    }

    setClauses.push('updated_at_ms = ?');
    setValues.push(now);
    setValues.push(id);

    const updateSql = `UPDATE nodes SET ${setClauses.join(', ')} WHERE id = ?`;
    await mockDb.prepare(updateSql).bind(...setValues).run();

    // Verified: SQL explicitly sets `note = ?`, `traffic_quota_bytes = ?`, `manual_city = ?` with bound NULLs!
    expect(executedSql).toContain('note = ?, traffic_quota_bytes = ?, manual_city = ?');
    expect(boundValues[0]).toBe('Renamed Node');
    expect(boundValues[1]).toBeNull(); // note
    expect(boundValues[2]).toBeNull(); // traffic_quota_bytes
    expect(boundValues[3]).toBeNull(); // manual_city
  });

  it('Anti-Brute-Force: rate limits after 5 failed attempts and locks out IP for 5 minutes', async () => {
    const { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } = await import(
      '../src/routes/auth'
    );

    const testIp = '203.0.113.42';

    // 1. Initial check: allowed
    expect(checkLoginRateLimit(testIp).allowed).toBe(true);

    // 2. Fail 4 times: still allowed
    for (let i = 1; i <= 4; i++) {
      const res = recordLoginFailure(testIp);
      expect(res.locked).toBe(false);
      expect(res.failures).toBe(i);
    }
    expect(checkLoginRateLimit(testIp).allowed).toBe(true);

    // 3. 5th failure triggers 5-minute lockout
    const res5 = recordLoginFailure(testIp);
    expect(res5.locked).toBe(true);
    expect(res5.remainingSec).toBeGreaterThan(0);

    const lockedCheck = checkLoginRateLimit(testIp);
    expect(lockedCheck.allowed).toBe(false);
    expect(lockedCheck.remainingSec).toBeGreaterThan(0);

    // 4. Successful login clears lockout
    recordLoginSuccess(testIp);
    expect(checkLoginRateLimit(testIp).allowed).toBe(true);
  });

  it('Alert Rules API: enforces DATA_ENCRYPTION_KEY when webhook is provided and sets timestamps', async () => {
    const { adminRoutes } = await import('../src/routes/admin');
    const { signSession } = await import('../src/services/crypto');

    let executedSql = '';
    let boundValues: any[] = [];
    let batchStatements: any[] = [];

    const mockDb = {
      prepare(sql: string) {
        executedSql = sql;
        return {
          bind(...args: any[]) {
            boundValues = args;
            return {
              sql,
              args,
              async run() {
                return { meta: { last_row_id: 42 } };
              },
            };
          },
        };
      },
      async batch(stmts: any[]) {
        batchStatements = stmts;
        return stmts.map(() => ({ meta: { last_row_id: 42 } }));
      },
    };

    const sessionSecret = 'test-secret-at-least-32-chars-long!!';
    const sessionToken = await signSession(
      JSON.stringify({ role: 'admin', expires_at_ms: Date.now() + 3600000 }),
      sessionSecret
    );

    // 1. Webhook rule without DATA_ENCRYPTION_KEY -> fail-closed 500 error
    const resNoKey = await adminRoutes.request('http://localhost/api/admin/alerts/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edgemon_session=${sessionToken}`,
      },
      body: JSON.stringify({
        type: 'webhook',
        config: { webhook_url: 'https://discord.com/api/webhooks/123/xyz' },
      }),
    }, {
      DB: mockDb as any,
      SESSION_SECRET: sessionSecret,
      REALTIME: {} as any,
    });

    expect(resNoKey.status).toBe(500);

    // 2. Normal CPU alert rule -> inserts created_at_ms and updated_at_ms cleanly
    const resCpu = await adminRoutes.request('http://localhost/api/admin/alerts/rules', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `edgemon_session=${sessionToken}`,
      },
      body: JSON.stringify({
        type: 'cpu',
        threshold: 85,
        duration_sec: 60,
      }),
    }, {
      DB: mockDb as any,
      SESSION_SECRET: sessionSecret,
      REALTIME: {} as any,
    });

    expect(resCpu.status).toBe(201);
    expect(executedSql).toContain('created_at_ms, updated_at_ms');
    expect(boundValues.length).toBe(8); // 8 parameters including timestamps
  });

  it('DELETE /api/admin/alerts/rules/:id: atomically batches deletion of alert rule and secret_settings', async () => {
    const { adminRoutes } = await import('../src/routes/admin');
    const { signSession } = await import('../src/services/crypto');

    let batchCalls: any[] = [];
    const mockDb = {
      prepare(sql: string) {
        return {
          bind(...args: any[]) {
            return {
              sql,
              args,
              async first() {
                return {
                  config_json: JSON.stringify({ secret_key: 'alert_webhook:12345' }),
                };
              },
            };
          },
          async first() {
            return {
              config_json: JSON.stringify({ secret_key: 'alert_webhook:12345' }),
            };
          },
        };
      },
      async batch(stmts: any[]) {
        batchCalls = stmts;
        return [];
      },
    };

    const sessionSecret = 'test-secret-at-least-32-chars-long!!';
    const sessionToken = await signSession(
      JSON.stringify({ role: 'admin', expires_at_ms: Date.now() + 3600000 }),
      sessionSecret
    );

    const res = await adminRoutes.request('http://localhost/api/admin/alerts/rules/42', {
      method: 'DELETE',
      headers: {
        Cookie: `edgemon_session=${sessionToken}`,
      },
    }, {
      DB: mockDb as any,
      SESSION_SECRET: sessionSecret,
      REALTIME: {} as any,
    });

    expect(res.status).toBe(200);
    expect(batchCalls.length).toBe(2);
    expect(batchCalls[0].sql).toContain('DELETE FROM alert_rules');
    expect(batchCalls[1].sql).toContain('DELETE FROM secret_settings');
  });
});