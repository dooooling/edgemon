import { Env } from './durable/realtime-hub';
import { evaluateAlerts, recordEvent } from './db/alerts';
import { executeHourlyRollup, executeRetentionCleanup } from './db/metrics';

export async function runScheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const cron = controller.cron;
  const nowMs = controller.scheduledTime || Date.now();

  // 1. Hourly Rollup (triggered at minute 5 of each hour)
  if (cron === '5 * * * *') {
    // Rollup the previous complete hour
    const previousHourStartMs = Math.floor(nowMs / 3600000) * 3600000 - 3600000;
    await executeHourlyRollup(env.DB, previousHourStartMs);
    await recordEvent(env.DB, null, 'cron_hourly_rollup', { hour_start_ms: previousHourStartMs });
    return;
  }

  // 2. Retention Cleanup (triggered at 03:30 UTC daily)
  if (cron === '30 3 * * *') {
    await executeRetentionCleanup(env.DB, 7, 365, 90);
    await recordEvent(env.DB, null, 'cron_retention_cleanup', { ts: nowMs });
    return;
  }

  // 3. Default: Every-minute Alert Evaluation (* * * * *)
  const transitions = await evaluateAlerts(env.DB, 90);
  for (const t of transitions) {
    await recordEvent(env.DB, t.nodeId, `alert_${t.status}`, t);
  }
}
