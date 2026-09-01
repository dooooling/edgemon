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
  channelIds?: number[];
}

export interface NodeAlertPolicy {
  mode?: 'global' | 'custom' | 'none';
  rule_ids?: number[];
}

export function getNodeAlertPolicy(nodeConfigJson: string | null): NodeAlertPolicy {
  if (!nodeConfigJson) return { mode: 'global' };
  try {
    const parsed = JSON.parse(nodeConfigJson);
    if (parsed.alert_policy) {
      return parsed.alert_policy;
    }
  } catch {
    // ignore
  }
  return { mode: 'global' };
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

  // Query all active nodes directly with state, limits and node_config
  const nodesResult = await db
    .prepare(
      `SELECT
        n.id, n.name, n.hidden, n.expires_at_ms,
        n.memory_limit_bytes, n.rootfs_limit_bytes,
        s.last_seen_at_ms, s.cpu_usage_pct, s.memory_used_bytes, s.rootfs_used_bytes,
        c.config_json AS node_config_json
       FROM nodes n
       LEFT JOIN node_state s ON n.id = s.node_id
       LEFT JOIN node_config c ON n.id = c.node_id`
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
      node_config_json: string | null;
    }>();

  const nodes = nodesResult.results || [];

  // Load custom metric threshold rules (excluding notification channel rules)
  const customRulesResult = await db
    .prepare("SELECT * FROM alert_rules WHERE enabled = 1 AND type NOT IN ('channel', 'webhook')")
    .all<AlertRuleRow>();

  const customRules = customRulesResult.results || [];

  // Helper to transition state and emit events only on state changes
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
    durationSec = 0,
    channelIds?: number[]
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
            return; // Still pending, no notification yet
          }

          if (now - pendingSince < durationMs) {
            return; // Condition met, but duration threshold not reached yet
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
          channelIds,
        });
      } else {
        // Was already active:
        if (existingState && existingState.last_notified_at_ms === null) {
          // Previous FIRING notification failed delivery! Retry once per minute until delivered.
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
              status: 'firing',
              title: firingTitle,
              message: firingMessage,
              value,
              threshold,
              channelIds,
            });
          }
        } else {
          // Check 4-hour reminder for long-standing firing alerts (P2-4)
          const lastNotified = existingState?.last_notified_at_ms || existingState?.active_since_ms || 0;
          const fourHoursMs = 4 * 3600 * 1000;
          if (now - lastNotified >= fourHoursMs) {
            await db
              .prepare('UPDATE alert_states SET last_notified_at_ms = NULL, updated_at_ms = ? WHERE state_key = ?')
              .bind(now, stateKey)
              .run();

            transitions.push({
              stateKey,
              nodeId,
              nodeName,
              type,
              status: 'firing',
              title: `[REMINDER] ${firingTitle}`,
              message: `${firingMessage} (Alert has been firing for >4h)`,
              value,
              threshold,
              channelIds,
            });
          }
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
          channelIds,
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
            channelIds,
          });
        }
      }
    }
  }

  // 1. Built-in: Offline Detection (last_seen_at_ms > 90s)
  for (const node of nodes) {
    const policy = getNodeAlertPolicy(node.node_config_json);
    if (policy.mode === 'none') continue; // Muted: skip all alerts for this node

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
    const policy = getNodeAlertPolicy(node.node_config_json);
    if (policy.mode === 'none') continue; // Muted: skip

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

  // 3. Custom / Compound Alert Policies (CPU, Memory, Disk, Offline, Expiry)
  for (const rule of customRules) {
    let ruleChannelIds: number[] | undefined = undefined;
    let parsedConfig: any = {};
    if (rule.config_json) {
      try {
        parsedConfig = JSON.parse(rule.config_json);
        if (Array.isArray(parsedConfig.channel_ids) && parsedConfig.channel_ids.length > 0) {
          ruleChannelIds = parsedConfig.channel_ids;
        }
      } catch {
        parsedConfig = {};
      }
    }

    const targetNodes = rule.node_id
      ? nodes.filter((n) => n.id === rule.node_id)
      : nodes;

    for (const node of targetNodes) {
      const policy = getNodeAlertPolicy(node.node_config_json);
      if (policy.mode === 'none') continue; // Muted: skip

      // If node is in custom mode, it only applies rules explicitly selected
      if (policy.mode === 'custom' && (!policy.rule_ids || !policy.rule_ids.includes(rule.id))) {
        continue;
      }

      // Check if this is a compound multi-condition policy
      if (parsedConfig.conditions && typeof parsedConfig.conditions === 'object') {
        const conds = parsedConfig.conditions;

        // Condition A: Offline
        if (conds.offline && conds.offline.enabled) {
          const offSec = conds.offline.duration_sec || 90;
          const isOff = !node.last_seen_at_ms || node.last_seen_at_ms < now - offSec * 1000;
          await checkTransition(
            `rule:${rule.id}:offline:${node.id}`,
            rule.id,
            node.id,
            node.name,
            'offline',
            isOff,
            `Node ${node.name} is Offline`,
            `Node has not reported telemetry for more than ${offSec} seconds.`,
            `Node ${node.name} is Online`,
            `Node has resumed normal telemetry reporting.`,
            node.last_seen_at_ms ? Math.round((now - node.last_seen_at_ms) / 1000) : null,
            offSec,
            0,
            ruleChannelIds
          );
        }

        // Condition B: CPU
        if (conds.cpu && conds.cpu.enabled) {
          const cpuThresh = conds.cpu.threshold ?? 80;
          const curCpu = node.cpu_usage_pct;
          const met = curCpu != null && curCpu >= cpuThresh;
          await checkTransition(
            `rule:${rule.id}:cpu:${node.id}`,
            rule.id,
            node.id,
            node.name,
            'cpu',
            met,
            `Node ${node.name} CPU Alert`,
            `CPU usage is at ${curCpu?.toFixed(1)}% (threshold: ${cpuThresh}%).`,
            `Node ${node.name} CPU Recovered`,
            `CPU usage normalized to ${curCpu?.toFixed(1)}%.`,
            curCpu,
            cpuThresh,
            conds.cpu.duration_sec ?? 0,
            ruleChannelIds
          );
        }

        // Condition C: Memory
        if (conds.memory && conds.memory.enabled) {
          const memThresh = conds.memory.threshold ?? 80;
          const used = node.memory_used_bytes;
          const limit = node.memory_limit_bytes;
          let curMem: number | null = null;
          let met = false;
          if (used != null && limit != null && limit > 0) {
            curMem = (used / limit) * 100;
            met = curMem >= memThresh;
          }
          await checkTransition(
            `rule:${rule.id}:memory:${node.id}`,
            rule.id,
            node.id,
            node.name,
            'memory',
            met,
            `Node ${node.name} Memory Alert`,
            `Memory usage is at ${curMem?.toFixed(1)}% (threshold: ${memThresh}%).`,
            `Node ${node.name} Memory Recovered`,
            `Memory usage normalized to ${curMem?.toFixed(1)}%.`,
            curMem,
            memThresh,
            conds.memory.duration_sec ?? 0,
            ruleChannelIds
          );
        }

        // Condition D: Disk
        if (conds.disk && conds.disk.enabled) {
          const diskThresh = conds.disk.threshold ?? 85;
          const used = node.rootfs_used_bytes;
          const limit = node.rootfs_limit_bytes;
          let curDisk: number | null = null;
          let met = false;
          if (used != null && limit != null && limit > 0) {
            curDisk = (used / limit) * 100;
            met = curDisk >= diskThresh;
          }
          await checkTransition(
            `rule:${rule.id}:disk:${node.id}`,
            rule.id,
            node.id,
            node.name,
            'disk',
            met,
            `Node ${node.name} Disk Alert`,
            `Disk usage is at ${curDisk?.toFixed(1)}% (threshold: ${diskThresh}%).`,
            `Node ${node.name} Disk Recovered`,
            `Disk usage normalized to ${curDisk?.toFixed(1)}%.`,
            curDisk,
            diskThresh,
            conds.disk.duration_sec ?? 0,
            ruleChannelIds
          );
        }

        // Condition E: Expiry
        if (conds.expiry && conds.expiry.enabled && node.expires_at_ms) {
          const days = conds.expiry.days ?? 7;
          const daysMs = days * 86400 * 1000;
          const isExpiring = node.expires_at_ms - now <= daysMs;
          await checkTransition(
            `rule:${rule.id}:expiry:${node.id}`,
            rule.id,
            node.id,
            node.name,
            'expiry',
            isExpiring,
            `Node ${node.name} Plan Expiring Soon`,
            `Node plan will expire at ${new Date(node.expires_at_ms).toISOString()} (<= ${days} days).`,
            `Node ${node.name} Plan Renewed`,
            `Node plan expiration date updated or resolved.`,
            node.expires_at_ms,
            daysMs,
            0,
            ruleChannelIds
          );
        }
      } else {
        // Legacy single-metric rule format
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
          rule.type as any,
          conditionMet,
          `Node ${node.name} ${rule.type.toUpperCase()} Alert`,
          firingMsg,
          `Node ${node.name} ${rule.type.toUpperCase()} Recovered`,
          resolvedMsg,
          curVal,
          threshold,
          rule.duration_sec ?? 0,
          ruleChannelIds
        );
      }
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
