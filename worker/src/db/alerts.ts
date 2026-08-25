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

export interface AlertTransition {
  nodeId: string;
  nodeName: string;
  type: 'offline' | 'cpu' | 'memory' | 'disk' | 'expiry';
  status: 'firing' | 'resolved';
  title: string;
  message: string;
  value?: number | null;
  threshold?: number | null;
}

export async function evaluateAlerts(
  db: D1Database,
  offlineThresholdSec = 90
): Promise<AlertTransition[]> {
  const now = Date.now();
  const offlineCutoff = now - offlineThresholdSec * 1000;
  const transitions: AlertTransition[] = [];

  // Query all active nodes with their states & limits
  const nodes = await db
    .prepare(
      `SELECT
        n.id, n.name, n.hidden, n.expires_at_ms,
        s.last_seen_at_ms, s.cpu_usage_pct, s.memory_used_bytes, s.rootfs_used_bytes,
        r.memory_limit_bytes, r.rootfs_limit_bytes
       FROM nodes n
       LEFT JOIN node_state s ON n.id = s.node_id
       LEFT JOIN node_resources r ON n.id = r.node_id`
    )
    .all<{
      id: string;
      name: string;
      hidden: number;
      expires_at_ms: number | null;
      last_seen_at_ms: number | null;
      cpu_usage_pct: number | null;
      memory_used_bytes: number | null;
      rootfs_used_bytes: number | null;
      memory_limit_bytes: number | null;
      rootfs_limit_bytes: number | null;
    }>();

  // Load custom rules if any
  const customRules = await db
    .prepare('SELECT * FROM alert_rules WHERE enabled = 1')
    .all<AlertRuleRow>();

  // Helper to transition state and emit events only on changes
  async function checkTransition(
    ruleKey: number, // Use deterministic hash or rule ID
    nodeId: string,
    nodeName: string,
    type: 'offline' | 'cpu' | 'memory' | 'disk' | 'expiry',
    isConditionMet: boolean,
    firingTitle: string,
    firingMessage: string,
    resolvedTitle: string,
    resolvedMessage: string,
    value: number | null = null,
    threshold: number | null = null
  ) {
    const existingState = await db
      .prepare('SELECT * FROM alert_states WHERE rule_id = ?')
      .bind(ruleKey)
      .first<AlertStateRow>();

    const wasActive = existingState ? Boolean(existingState.active) : false;

    if (isConditionMet) {
      if (!wasActive) {
        // Transition: RESOLVED -> FIRING
        await db
          .prepare(
            `INSERT INTO alert_states (rule_id, active, active_since_ms, last_notified_at_ms, updated_at_ms)
             VALUES (?, 1, ?, ?, ?)
             ON CONFLICT(rule_id) DO UPDATE SET
               active = 1,
               active_since_ms = excluded.active_since_ms,
               last_notified_at_ms = excluded.last_notified_at_ms,
               updated_at_ms = excluded.updated_at_ms`
          )
          .bind(ruleKey, now, now, now)
          .run();

        transitions.push({
          nodeId,
          nodeName,
          type,
          status: 'firing',
          title: firingTitle,
          message: firingMessage,
          value,
          threshold,
        });
      } else {
        // Already active: Check 4-hour renotification interval (avoid spamming every minute)
        const lastNotified = existingState?.last_notified_at_ms || 0;
        const renotifyIntervalMs = 4 * 3600 * 1000;
        if (now - lastNotified >= renotifyIntervalMs) {
          await db
            .prepare('UPDATE alert_states SET last_notified_at_ms = ?, updated_at_ms = ? WHERE rule_id = ?')
            .bind(now, now, ruleKey)
            .run();

          transitions.push({
            nodeId,
            nodeName,
            type,
            status: 'firing',
            title: `[Reminder] ${firingTitle}`,
            message: firingMessage,
            value,
            threshold,
          });
        }
      }
    } else {
      if (wasActive) {
        // Transition: FIRING -> RESOLVED
        await db
          .prepare('UPDATE alert_states SET active = 0, updated_at_ms = ? WHERE rule_id = ?')
          .bind(now, ruleKey)
          .run();

        transitions.push({
          nodeId,
          nodeName,
          type,
          status: 'resolved',
          title: resolvedTitle,
          message: resolvedMessage,
          value,
          threshold,
        });
      }
    }
  }

  // Deterministic numeric ID generator for default rules: hash(nodeId + type)
  function syntheticRuleId(nodeId: string, type: string): number {
    let hash = 0;
    const str = `${nodeId}:${type}`;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  for (const node of nodes.results || []) {
    // 1. Built-in Offline Check (Threshold: 90s)
    const isOffline = !node.last_seen_at_ms || node.last_seen_at_ms < offlineCutoff;
    const elapsedSec = node.last_seen_at_ms ? Math.round((now - node.last_seen_at_ms) / 1000) : 9999;
    await checkTransition(
      syntheticRuleId(node.id, 'offline'),
      node.id,
      node.name,
      'offline',
      isOffline,
      `Node Offline: ${node.name}`,
      `Node ${node.name} has stopped sending heartbeats for ${elapsedSec}s.`,
      `Node Back Online: ${node.name}`,
      `Node ${node.name} has reconnected and resumed streaming telemetry.`
    );

    // 2. Built-in Expiry Warning (Threshold: 3 days)
    if (node.expires_at_ms) {
      const isExpiring = node.expires_at_ms <= now + 3 * 86400 * 1000;
      const daysLeft = Math.max(0, Math.round((node.expires_at_ms - now) / 86400000));
      await checkTransition(
        syntheticRuleId(node.id, 'expiry'),
        node.id,
        node.name,
        'expiry',
        isExpiring,
        `Node Expiring Soon: ${node.name}`,
        `Node ${node.name} subscription will expire in ${daysLeft} days (${new Date(node.expires_at_ms).toISOString().slice(0, 10)}).`,
        `Node Expiry Extended: ${node.name}`,
        `Node ${node.name} expiration date has been renewed.`
      );
    }

    // 3. Custom Alert Rules (CPU / RAM / Disk)
    const nodeRules = (customRules.results || []).filter((r) => !r.node_id || r.node_id === node.id);
    for (const rule of nodeRules) {
      let isMet = false;
      let val: number | null = null;

      if (rule.type === 'cpu' && rule.threshold !== null && node.cpu_usage_pct !== null) {
        val = node.cpu_usage_pct;
        isMet = val >= rule.threshold;
        await checkTransition(
          rule.id,
          node.id,
          node.name,
          'cpu',
          isMet,
          `High CPU Alert: ${node.name} (${val.toFixed(1)}%)`,
          `CPU usage on ${node.name} reached ${val.toFixed(1)}% (Threshold: >= ${rule.threshold}%).`,
          `CPU Usage Normal: ${node.name}`,
          `CPU usage on ${node.name} has returned below threshold.`,
          val,
          rule.threshold
        );
      } else if (rule.type === 'memory' && rule.threshold !== null && node.memory_used_bytes && node.memory_limit_bytes) {
        val = (node.memory_used_bytes / node.memory_limit_bytes) * 100;
        isMet = val >= rule.threshold;
        await checkTransition(
          rule.id,
          node.id,
          node.name,
          'memory',
          isMet,
          `High Memory Alert: ${node.name} (${val.toFixed(1)}%)`,
          `Memory usage on ${node.name} reached ${val.toFixed(1)}% (Threshold: >= ${rule.threshold}%).`,
          `Memory Usage Normal: ${node.name}`,
          `Memory usage on ${node.name} has returned below threshold.`,
          val,
          rule.threshold
        );
      } else if (rule.type === 'disk' && rule.threshold !== null && node.rootfs_used_bytes && node.rootfs_limit_bytes) {
        val = (node.rootfs_used_bytes / node.rootfs_limit_bytes) * 100;
        isMet = val >= rule.threshold;
        await checkTransition(
          rule.id,
          node.id,
          node.name,
          'disk',
          isMet,
          `High Disk Alert: ${node.name} (${val.toFixed(1)}%)`,
          `Disk usage on ${node.name} reached ${val.toFixed(1)}% (Threshold: >= ${rule.threshold}%).`,
          `Disk Usage Normal: ${node.name}`,
          `Disk usage on ${node.name} has returned below threshold.`,
          val,
          rule.threshold
        );
      }
    }
  }

  return transitions;
}

export async function recordEvent(db: D1Database, nodeId: string | null, type: string, data: unknown): Promise<void> {
  await db
    .prepare('INSERT INTO events (node_id, ts_ms, type, data_json) VALUES (?, ?, ?, ?)')
    .bind(nodeId, Date.now(), type, JSON.stringify(data))
    .run();
}
