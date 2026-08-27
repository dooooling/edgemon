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

  // 1. Hourly Rollup (triggered at minute 5 of each hour, covers past 6 hours for late replay recovery - P1-1)
  if (cron === '5 * * * *') {
    const currentHourStartMs = Math.floor(nowMs / 3600000) * 3600000;
    for (let i = 1; i <= 6; i++) {
      const hourStartMs = currentHourStartMs - i * 3600000;
      await executeHourlyRollup(env.DB, hourStartMs);
    }
    await recordEvent(env.DB, null, 'cron_hourly_rollup', { hour_start_ms: currentHourStartMs - 3600000 });
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
