import { Hono } from 'hono';
import { Env } from '../durable/realtime-hub';
import { getRawHistory, getHourlyHistory } from '../db/metrics';
import { computeBillingPeriodStart } from '../db/traffic';

const publicRoutes = new Hono<{ Bindings: Env }>();

// GET /api/public/config
publicRoutes.get('/api/public/config', async (c) => {
  const siteTitleRow = await c.env.DB
    .prepare("SELECT value FROM settings WHERE key = 'site_title'")
    .first<{ value: string }>();

  return c.json({
    site_title: siteTitleRow?.value || 'EdgeMon',
    public_dashboard: true,
  });
});

// GET /api/public/nodes
publicRoutes.get('/api/public/nodes', async (c) => {
  const query = `
    SELECT
      n.id, n.name, n.sort_order, n.note,
      n.hostname, n.os, n.os_version, n.kernel, n.arch,
      n.env_type, n.env_runtime, n.host_virtualization_hint, n.cgroup_version, n.resource_scope,
      n.cpu_model_visible, n.cpu_capacity_cores,
      n.memory_limit_bytes, n.swap_limit_bytes, n.rootfs_limit_bytes, n.rootfs_scope,
      n.geo_country, n.geo_region, n.geo_region_code, n.geo_city,
      n.geo_lat, n.geo_lon, n.asn, n.as_org, n.cf_colo,
      n.location_mode, n.manual_country, n.manual_city, n.manual_lat, n.manual_lon,
      n.traffic_reset_day, n.traffic_quota_bytes,
      n.expires_at_ms,
      s.last_seen_at_ms, s.cpu_usage_pct, s.cpu_throttled_pct,
      s.memory_used_bytes, s.memory_working_set_bytes, s.swap_used_bytes,
      s.rootfs_used_bytes, s.disk_read_bps, s.disk_write_bps,
      s.rx_bps, s.tx_bps, s.rx_total_bytes, s.tx_total_bytes,
      s.edge_rtt_ms, s.edge_transport, s.uptime_sec, s.probe_data_json
    FROM nodes n
    LEFT JOIN node_state s ON n.id = s.node_id
    WHERE n.hidden = 0
    ORDER BY n.sort_order ASC, n.created_at_ms ASC
  `;

  const rows = await c.env.DB.prepare(query).all();
  const now = Date.now();

  // Query active traffic periods for all nodes
  const periodRows = await c.env.DB
    .prepare('SELECT * FROM traffic_periods')
    .all();

  const periodMap = new Map<string, any>();
  for (const p of periodRows.results || []) {
    periodMap.set(`${(p as any).node_id}:${(p as any).period_start_ms}`, p);
  }

  const nodes = (rows.results || []).map((row: any) => {
    const isManual = row.location_mode === 'manual';
    const resetDay = row.traffic_reset_day || 1;
    const periodStartMs = computeBillingPeriodStart(now, resetDay);
    const p = periodMap.get(`${row.id}:${periodStartMs}`);

    let periodRx = p?.finalized_rx_bytes || 0;
    let periodTx = p?.finalized_tx_bytes || 0;
    if (p && p.active_rx_base_bytes !== null && row.rx_total_bytes !== undefined) {
      periodRx += Math.max(0, row.rx_total_bytes - p.active_rx_base_bytes);
    }
    if (p && p.active_tx_base_bytes !== null && row.tx_total_bytes !== undefined) {
      periodTx += Math.max(0, row.tx_total_bytes - p.active_tx_base_bytes);
    }

    return {
      id: row.id,
      name: row.name,
      sort_order: row.sort_order,
      note: row.note,
      system: {
        hostname: row.hostname,
        os: row.os,
        os_version: row.os_version,
        kernel: row.kernel,
        arch: row.arch,
      },
      environment: {
        type: row.env_type,
        runtime: row.env_runtime,
        host_virtualization_hint: row.host_virtualization_hint,
        cgroup_version: row.cgroup_version,
        resource_scope: row.resource_scope,
      },
      resources: {
        cpu_model_visible: row.cpu_model_visible,
        cpu_capacity_cores: row.cpu_capacity_cores,
        memory_limit_bytes: row.memory_limit_bytes,
        swap_limit_bytes: row.swap_limit_bytes,
        rootfs_limit_bytes: row.rootfs_limit_bytes,
        rootfs_scope: row.rootfs_scope,
      },
      geo: {
        country: isManual ? row.manual_country : row.geo_country,
        region: row.geo_region,
        city: isManual ? row.manual_city : row.geo_city,
        lat: isManual ? row.manual_lat : row.geo_lat,
        lon: isManual ? row.manual_lon : row.geo_lon,
        asn: row.asn,
        as_org: row.as_org,
        colo: row.cf_colo,
      },
      traffic: {
        reset_day: resetDay,
        quota_bytes: row.traffic_quota_bytes || null,
        period_start_ms: periodStartMs,
        period_rx_bytes: periodRx,
        period_tx_bytes: periodTx,
        period_total_bytes: periodRx + periodTx,
      },
      expires_at_ms: row.expires_at_ms || null,
      state: row.last_seen_at_ms ? {
        last_seen_at_ms: row.last_seen_at_ms,
        cpu_usage_pct: row.cpu_usage_pct,
        cpu_throttled_pct: row.cpu_throttled_pct,
        memory_used_bytes: row.memory_used_bytes,
        memory_working_set_bytes: row.memory_working_set_bytes,
        swap_used_bytes: row.swap_used_bytes,
        rootfs_used_bytes: row.rootfs_used_bytes,
        disk_read_bps: row.disk_read_bps,
        disk_write_bps: row.disk_write_bps,
        rx_bps: row.rx_bps,
        tx_bps: row.tx_bps,
        rx_total_bytes: row.rx_total_bytes,
        tx_total_bytes: row.tx_total_bytes,
        edge_rtt_ms: row.edge_rtt_ms,
        edge_transport: row.edge_transport,
        uptime_sec: row.uptime_sec,
        probes: row.probe_data_json ? JSON.parse(row.probe_data_json) : [],
      } : null,
    };
  });

  return c.json({ nodes });
});

// GET /api/public/nodes/:id/history
publicRoutes.get('/api/public/nodes/:id/history', async (c) => {
  const nodeId = c.req.param('id');

  // Verify node exists and is public (P0-1: protect hidden nodes history)
  const node = await c.env.DB
    .prepare('SELECT id, hidden FROM nodes WHERE id = ?')
    .bind(nodeId)
    .first<{ id: string; hidden: number }>();

  if (!node || node.hidden === 1) {
    return c.json({ error: 'Node not found' }, 404);
  }

  const range = c.req.query('range') || '24h';
  const nowMs = Date.now();

  let fromMs = nowMs - 24 * 3600000;
  let isHourly = false;
  let resolutionSec = 60;

  switch (range) {
    case '10m':
      fromMs = nowMs - 10 * 60000;
      break;
    case '1h':
      fromMs = nowMs - 3600000;
      break;
    case '6h':
      fromMs = nowMs - 6 * 3600000;
      break;
    case '24h':
      fromMs = nowMs - 24 * 3600000;
      break;
    case '7d':
      fromMs = nowMs - 7 * 86400000;
      break;
    case '30d':
      fromMs = nowMs - 30 * 86400000;
      isHourly = true;
      resolutionSec = 3600;
      break;
    case '90d':
      fromMs = nowMs - 90 * 86400000;
      isHourly = true;
      resolutionSec = 3600;
      break;
    case '1y':
      fromMs = nowMs - 365 * 86400000;
      isHourly = true;
      resolutionSec = 3600;
      break;
  }

  const points = isHourly
    ? await getHourlyHistory(c.env.DB, nodeId, fromMs, nowMs)
    : await getRawHistory(c.env.DB, nodeId, fromMs, nowMs);

  return c.json({
    resolution_sec: resolutionSec,
    from_ms: fromMs,
    to_ms: nowMs,
    points,
  });
});

export { publicRoutes };
