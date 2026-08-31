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
  state_key: string;
  rule_id: number | null;
  node_id: string;
  active: number;
  pending_since_ms: number | null;
  active_since_ms: number | null;
  last_notified_at_ms: number | null;
  updated_at_ms: number;
}

export interface AlertTransition {
  stateKey: string;
  nodeId: string;
  nodeName: string;
  type: 'offline' | 'cpu' | 'memory' | 'disk' | 'expiry';
  status: 'firing' | 'resolved';
  title: string;
  message: string;
  value?: number | null;
  threshold?: number | null;
}

export async function markAlertDelivered(
  db: D1Database,
  stateKey: string,
  deliveredAtMs = Date.now()
): Promise<void> {
  await db
    .prepare('UPDATE alert_states SET last_notified_at_ms = ?, updated_at_ms = ? WHERE state_key = ?')
    .bind(deliveredAtMs, deliveredAtMs, stateKey)
    .run();
}

export async function evaluateAlerts(
  db: D1Database,
  offlineThresholdSec = 90
): Promise<AlertTransition[]> {
  const now = Date.now();
  const offlineCutoff = now - offlineThresholdSec * 1000;
  const transitions: AlertTransition[] = [];

  // Query all active nodes directly with state & limits (no non-existent node_resources join!)
  const nodesResult = await db
    .prepare(
      `SELECT
        n.id, n.name, n.hidden, n.expires_at_ms,
        n.memory_limit_bytes, n.rootfs_limit_bytes,
        s.last_seen_at_ms, s.cpu_usage_pct, s.memory_used_bytes, s.rootfs_used_bytes
       FROM nodes n
       LEFT JOIN node_state s ON n.id = s.node_id`
    )
    .all<{
      id: string;
      name: string;
      hidden: number;
      expires_at_ms: number | null;
      memory_limit_bytes: number | null;
      rootfs_limit_bytes: number | null;
      last_seen_at_ms: number | null;
      cpu_usage_pct: number | null;
      memory_used_bytes: number | null;
      rootfs_used_bytes: number | null;
    }>();

  const nodes = nodesResult.results || [];

  // Load custom rules if any
  const customRulesResult = await db
    .prepare('SELECT * FROM alert_rules WHERE enabled = 1')
    .all<AlertRuleRow>();

  const customRules = customRulesResult.results || [];

  // Helper to transition state and emit events only on state changes (with duration_sec pending support)
  async function checkTransition(
    stateKey: string,
    ruleId: number | null,
    nodeId: string,
    nodeName: string,
    type: 'offline' | 'cpu' | 'memory' | 'disk' | 'expiry',
    isConditionMet: boolean,
    firingTitle: string,
    firingMessage: string,
    resolvedTitle: string,
    resolvedMessage: string,
    value: number | null = null,
    threshold: number | null = null,
    durationSec = 0
  ) {
    const existingState = await db
      .prepare('SELECT * FROM alert_states WHERE state_key = ?')
      .bind(stateKey)
      .first<AlertStateRow>();

    const wasActive = existingState ? Boolean(existingState.active) : false;

    if (isConditionMet) {
      if (!wasActive) {
        // Pending check for duration_sec
        const durationMs = (durationSec || 0) * 1000;
        if (durationMs > 0) {
          const pendingSince = existingState?.pending_since_ms;
          if (!pendingSince) {
            // First time condition met: transition to PENDING
            await db
              .prepare(
                `INSERT INTO alert_states (state_key, rule_id, node_id, active, pending_since_ms, updated_at_ms)
                 VALUES (?, ?, ?, 0, ?, ?)
                 ON CONFLICT(state_key) DO UPDATE SET
                   pending_since_ms = excluded.pending_since_ms,
                   updated_at_ms = excluded.updated_at_ms`
              )
              .bind(stateKey, ruleId, nodeId, now, now)
              .run();
            return;
          }

          if (now - pendingSince < durationMs) {
            // Still in PENDING window
            return;
          }
        }

        // Transition: PENDING / NORMAL -> FIRING (last_notified_at_ms is NULL until webhook delivery succeeds)
        await db
          .prepare(
            `INSERT INTO alert_states (state_key, rule_id, node_id, active, pending_since_ms, active_since_ms, last_notified_at_ms, updated_at_ms)
             VALUES (?, ?, ?, 1, NULL, ?, NULL, ?)
             ON CONFLICT(state_key) DO UPDATE SET
               active = 1,
               pending_since_ms = NULL,
               active_since_ms = excluded.active_since_ms,
               last_notified_at_ms = NULL,
               updated_at_ms = excluded.updated_at_ms`
          )
          .bind(stateKey, ruleId, nodeId, now, now)
          .run();

        transitions.push({
          stateKey,
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
        // Already active: Check if previous notification failed (last_notified_at_ms === null) or 4h renotification
        const lastNotified = existingState?.last_notified_at_ms;
        const lastUpdated = existingState?.updated_at_ms || 0;
        const renotifyIntervalMs = 4 * 3600 * 1000;

        if (lastNotified === null || lastNotified === undefined) {
          // Delivery previously failed: retry once per minute
          if (now - lastUpdated >= 60_000) {
            await db
              .prepare('UPDATE alert_states SET updated_at_ms = ? WHERE state_key = ?')
              .bind(now, stateKey)
              .run();

            transitions.push({
              stateKey,
              nodeId,
              nodeName,
              type,
              status: 'firing',
              title: firingTitle,
              message: firingMessage,
              value,
              threshold,
            });
          }
        } else if (now - lastNotified >= renotifyIntervalMs) {
          // 4-hour periodic reminder
          transitions.push({
            stateKey,
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
      // Condition no longer met
      if (existingState?.pending_since_ms) {
        await db
          .prepare('UPDATE alert_states SET pending_since_ms = NULL, updated_at_ms = ? WHERE state_key = ?')
          .bind(now, stateKey)
          .run();
      }

      if (wasActive) {
        // Transition: FIRING -> RESOLVED (last_notified_at_ms is NULL until webhook delivery succeeds)
        await db
          .prepare('UPDATE alert_states SET active = 0, pending_since_ms = NULL, last_notified_at_ms = NULL, updated_at_ms = ? WHERE state_key = ?')
          .bind(now, stateKey)
          .run();

        transitions.push({
          stateKey,
          nodeId,
          nodeName,
          type,
          status: 'resolved',
          title: resolvedTitle,
          message: resolvedMessage,
          value,
          threshold,
        });
      } else if (existingState && existingState.active === 0 && existingState.last_notified_at_ms === null) {
        // Condition is normal, but previous RESOLVED notification failed delivery! Retry once per minute until delivered.
        const lastUpdated = existingState.updated_at_ms || 0;
        if (now - lastUpdated >= 60_000) {
          await db
            .prepare('UPDATE alert_states SET updated_at_ms = ? WHERE state_key = ?')
            .bind(now, stateKey)
            .run();

          transitions.push({
            stateKey,
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
  }

  // 1. Built-in: Offline Detection (last_seen_at_ms > 90s)
  for (const node of nodes) {
    const isOffline = !node.last_seen_at_ms || node.last_seen_at_ms < offlineCutoff;
    const stateKey = `builtin:offline:${node.id}`;

    await checkTransition(
      stateKey,
      null,
      node.id,
      node.name,
      'offline',
      isOffline,
      `Node ${node.name} is Offline`,
      `Node has not reported telemetry for more than ${offlineThresholdSec} seconds.`,
      `Node ${node.name} is Online`,
      `Node has resumed normal telemetry reporting.`,
      node.last_seen_at_ms ? Math.round((now - node.last_seen_at_ms) / 1000) : null,
      offlineThresholdSec,
      0
    );
  }

  // 2. Built-in: Expiry Detection (expires_at_ms <= now + 3 days)
  const threeDaysMs = 3 * 86400 * 1000;
  for (const node of nodes) {
    if (!node.expires_at_ms) continue;
    const isExpiringSoon = node.expires_at_ms - now <= threeDaysMs;
    const stateKey = `builtin:expiry:${node.id}`;

    await checkTransition(
      stateKey,
      null,
      node.id,
      node.name,
      'expiry',
      isExpiringSoon,
      `Node ${node.name} Plan Expiring Soon`,
      `Node plan will expire at ${new Date(node.expires_at_ms).toISOString()}.`,
      `Node ${node.name} Plan Renewed`,
      `Node plan expiration date updated or resolved.`,
      node.expires_at_ms,
      threeDaysMs,
      0
    );
  }

  // 3. Custom Alert Rules (CPU, Memory, Disk)
  for (const rule of customRules) {
    const targetNodes = rule.node_id
      ? nodes.filter((n) => n.id === rule.node_id)
      : nodes;

    for (const node of targetNodes) {
      const stateKey = `rule:${rule.id}:${node.id}`;
      let conditionMet = false;
      let curVal: number | null = null;
      let firingMsg = '';
      let resolvedMsg = '';
      const threshold = rule.threshold ?? 80;

      if (rule.type === 'cpu') {
        curVal = node.cpu_usage_pct;
        conditionMet = curVal != null && curVal >= threshold;
        firingMsg = `CPU usage is at ${curVal?.toFixed(1)}% (threshold: ${threshold}%).`;
        resolvedMsg = `CPU usage normalized to ${curVal?.toFixed(1)}%.`;
      } else if (rule.type === 'memory') {
        const used = node.memory_used_bytes;
        const limit = node.memory_limit_bytes;
        if (used != null && limit != null && limit > 0) {
          curVal = (used / limit) * 100;
          conditionMet = curVal >= threshold;
          firingMsg = `Memory usage is at ${curVal.toFixed(1)}% (threshold: ${threshold}%).`;
          resolvedMsg = `Memory usage normalized to ${curVal.toFixed(1)}%.`;
        }
      } else if (rule.type === 'disk') {
        const used = node.rootfs_used_bytes;
        const limit = node.rootfs_limit_bytes;
        if (used != null && limit != null && limit > 0) {
          curVal = (used / limit) * 100;
          conditionMet = curVal >= threshold;
          firingMsg = `Disk usage is at ${curVal.toFixed(1)}% (threshold: ${threshold}%).`;
          resolvedMsg = `Disk usage normalized to ${curVal.toFixed(1)}%.`;
        }
      }

      await checkTransition(
        stateKey,
        rule.id,
        node.id,
        node.name,
        rule.type,
        conditionMet,
        `Node ${node.name} ${rule.type.toUpperCase()} Alert`,
        firingMsg,
        `Node ${node.name} ${rule.type.toUpperCase()} Recovered`,
        resolvedMsg,
        curVal,
        threshold,
        rule.duration_sec ?? 0
      );
    }
  }

  return transitions;
}

export async function recordEvent(
  db: D1Database,
  nodeId: string | null,
  type: string,
  data: unknown
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (node_id, ts_ms, type, data_json)
       VALUES (?, ?, ?, ?)`
    )
    .bind(nodeId, Date.now(), type, JSON.stringify(data))
    .run();
}
