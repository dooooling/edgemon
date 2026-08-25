export interface AlertRuleRow {
  id: number;
  node_id: string | null;
  type: 'offline' | 'cpu' | 'memory' | 'disk' | 'expiry';
  threshold: number | null;
  duration_sec: number | null;
  enabled: number;
  config_json: string | null;
}

export interface AlertStateRow {
  rule_id: number;
  active: number;
  pending_since_ms: number | null;
  active_since_ms: number | null;
  last_notified_at_ms: number | null;
  updated_at_ms: number;
}

export async function evaluateAlerts(
  db: D1Database,
  offlineThresholdSec = 180
): Promise<Array<{ nodeId: string; type: string; title: string; message: string }>> {
  const now = Date.now();
  const offlineCutoff = now - offlineThresholdSec * 1000;
  const triggeredAlerts: Array<{ nodeId: string; type: string; title: string; message: string }> = [];

  // 1. Check Offline Nodes
  const offlineNodes = await db
    .prepare(
      `SELECT n.id, n.name, s.last_seen_at_ms
       FROM nodes n
       JOIN node_state s ON n.id = s.node_id
       WHERE s.last_seen_at_ms < ?`
    )
    .bind(offlineCutoff)
    .all<{ id: string; name: string; last_seen_at_ms: number }>();

  for (const node of offlineNodes.results || []) {
    const elapsedSec = Math.round((now - node.last_seen_at_ms) / 1000);
    triggeredAlerts.push({
      nodeId: node.id,
      type: 'offline',
      title: `Node Offline: ${node.name}`,
      message: `Node ${node.name} has been offline for ${elapsedSec}s (last seen: ${new Date(node.last_seen_at_ms).toISOString()})`,
    });
  }

  // 2. Check Expiry
  const expiringNodes = await db
    .prepare('SELECT id, name, expires_at_ms FROM nodes WHERE expires_at_ms IS NOT NULL AND expires_at_ms <= ?')
    .bind(now + 86400000 * 3) // 3 days warning
    .all<{ id: string; name: string; expires_at_ms: number }>();

  for (const node of expiringNodes.results || []) {
    triggeredAlerts.push({
      nodeId: node.id,
      type: 'expiry',
      title: `Node Expiring Soon: ${node.name}`,
      message: `Node ${node.name} is scheduled to expire at ${new Date(node.expires_at_ms).toISOString()}`,
    });
  }

  return triggeredAlerts;
}

export async function recordEvent(db: D1Database, nodeId: string | null, type: string, data: unknown): Promise<void> {
  await db
    .prepare('INSERT INTO events (node_id, ts_ms, type, data_json) VALUES (?, ?, ?, ?)')
    .bind(nodeId, Date.now(), type, JSON.stringify(data))
    .run();
}
