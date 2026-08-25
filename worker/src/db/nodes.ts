import { sha256, generateRandomToken } from '../services/crypto';
import { HelloPayload } from '../protocol/types';
import { NormalizedGeo } from '../services/geo';

export interface NodeRow {
  id: string;
  name: string;
  token_hash: string;
  sort_order: number;
  hidden: number;
  note: string | null;
  traffic_reset_day: number;
  traffic_quota_bytes: number | null;
  hostname: string | null;
  agent_version: string | null;
  os: string | null;
  os_version: string | null;
  kernel: string | null;
  arch: string | null;
  env_type: string | null;
  env_runtime: string | null;
  host_virtualization_hint: string | null;
  cgroup_version: number | null;
  resource_scope: string | null;
  cpu_model_visible: string | null;
  cpu_capacity_cores: number | null;
  memory_limit_bytes: number | null;
  swap_limit_bytes: number | null;
  rootfs_limit_bytes: number | null;
  rootfs_scope: string | null;
  egress_ip: string | null;
  geo_country: string | null;
  geo_region: string | null;
  geo_region_code: string | null;
  geo_city: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  geo_timezone: string | null;
  geo_continent: string | null;
  asn: number | null;
  as_org: string | null;
  cf_colo: string | null;
  location_mode: 'auto' | 'manual';
  manual_country: string | null;
  manual_city: string | null;
  manual_lat: number | null;
  manual_lon: number | null;
  expires_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export async function getNodeById(db: D1Database, id: string): Promise<NodeRow | null> {
  return await db.prepare('SELECT * FROM nodes WHERE id = ?').bind(id).first<NodeRow>();
}

export async function verifyNodeAuth(db: D1Database, nodeId: string, rawToken: string): Promise<NodeRow | null> {
  const tokenHash = await sha256(rawToken);
  return await db
    .prepare('SELECT * FROM nodes WHERE id = ? AND token_hash = ?')
    .bind(nodeId, tokenHash)
    .first<NodeRow>();
}

export async function createNode(
  db: D1Database,
  name: string,
  trafficResetDay = 1,
  trafficQuotaBytes: number | null = null,
  expiresAtMs: number | null = null,
  note: string | null = null
): Promise<{ node: NodeRow; rawToken: string }> {
  const id = crypto.randomUUID();
  const rawToken = generateRandomToken(32);
  const tokenHash = await sha256(rawToken);
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO nodes (
        id, name, token_hash, traffic_reset_day, traffic_quota_bytes,
        expires_at_ms, note, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, name, tokenHash, trafficResetDay, trafficQuotaBytes, expiresAtMs, note, now, now)
    .run();

  // Create initial default agent config
  const initialConfig = JSON.stringify({
    sample_interval_sec: 2,
    stream_interval_sec: 2,
    probe_interval_sec: 60,
    network_interface: 'auto',
    probes: [],
  });

  await db
    .prepare('INSERT INTO node_config (node_id, revision, config_json, updated_at_ms) VALUES (?, 1, ?, ?)')
    .bind(id, initialConfig, now)
    .run();

  const node = (await getNodeById(db, id))!;
  return { node, rawToken };
}

export async function rotateNodeToken(db: D1Database, id: string): Promise<string | null> {
  const node = await getNodeById(db, id);
  if (!node) return null;

  const rawToken = generateRandomToken(32);
  const tokenHash = await sha256(rawToken);
  const now = Date.now();

  await db
    .prepare('UPDATE nodes SET token_hash = ?, updated_at_ms = ? WHERE id = ?')
    .bind(tokenHash, now, id)
    .run();

  return rawToken;
}

export async function updateNodeMetadataFromHello(
  db: D1Database,
  nodeId: string,
  hello: HelloPayload,
  geo: NormalizedGeo
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `UPDATE nodes SET
        hostname = ?, agent_version = ?, os = ?, os_version = ?, kernel = ?, arch = ?,
        env_type = ?, env_runtime = ?, host_virtualization_hint = ?, cgroup_version = ?,
        resource_scope = ?, cpu_model_visible = ?, cpu_capacity_cores = ?,
        memory_limit_bytes = ?, swap_limit_bytes = ?, rootfs_limit_bytes = ?, rootfs_scope = ?,
        egress_ip = ?, geo_country = ?, geo_region = ?, geo_region_code = ?,
        geo_city = ?, geo_lat = ?, geo_lon = ?, geo_timezone = ?, geo_continent = ?,
        asn = ?, as_org = ?, cf_colo = ?, geo_updated_at_ms = ?, updated_at_ms = ?
      WHERE id = ?`
    )
    .bind(
      hello.system.hostname,
      hello.agent.version,
      hello.system.os,
      hello.system.os_version || null,
      hello.system.kernel,
      hello.agent.arch,
      hello.environment.type,
      hello.environment.runtime || null,
      hello.environment.host_virtualization_hint || null,
      hello.environment.cgroup_version || null,
      hello.environment.resource_scope,
      hello.resources.cpu_model_visible || null,
      hello.resources.cpu_capacity_cores || null,
      hello.resources.memory_limit_bytes || null,
      hello.resources.swap_limit_bytes || null,
      hello.resources.rootfs_limit_bytes || null,
      hello.resources.rootfs_scope,
      geo.egress_ip,
      geo.geo_country,
      geo.geo_region,
      geo.geo_region_code,
      geo.geo_city,
      geo.geo_lat,
      geo.geo_lon,
      geo.geo_timezone,
      geo.geo_continent,
      geo.asn,
      geo.as_org,
      geo.cf_colo,
      now,
      now,
      nodeId
    )
    .run();
}
