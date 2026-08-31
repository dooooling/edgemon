import { Env } from './durable/realtime-hub';
import { evaluateAlerts, recordEvent, markAlertDelivered, AlertTransition } from './db/alerts';
import { executeHourlyRollup, executeRetentionCleanup } from './db/metrics';
import {
  sendWebhookNotification,
  maskWebhookUrl,
  WebhookConfig,
  AlertNotificationEvent,
} from './services/notifications';

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
  if (transitions.length === 0) {
    return;
  }

  // Record transition events and dispatch notifications
  for (const t of transitions) {
    await recordEvent(env.DB, t.nodeId, `alert_${t.status}`, t);
  }

  await dispatchAlertNotifications(env, transitions);
}

async function dispatchAlertNotifications(env: Env, transitions: AlertTransition[]): Promise<void> {
  const allowHttp = (env as any).ALLOW_HTTP_WEBHOOKS === 'true';

  // Collect all active webhook destination configs
  const webhookConfigs: WebhookConfig[] = [];

  // A. Environment secret/var default webhook (if configured)
  const envWebhook = (env as any).WEBHOOK_URL as string | undefined;
  if (envWebhook && typeof envWebhook === 'string' && envWebhook.trim().length > 0) {
    webhookConfigs.push({
      url: envWebhook.trim(),
      method: 'POST',
      allowHttp,
    });
  }

  // B. Database configured notification rules
  try {
    const customRulesResult = await env.DB
      .prepare("SELECT config_json FROM alert_rules WHERE enabled = 1 AND (type = 'webhook' OR config_json LIKE '%webhook_url%')")
      .all<{ config_json: string | null }>();

    const customRules = customRulesResult.results || [];
    for (const r of customRules) {
      if (!r.config_json) continue;
      try {
        const parsed = JSON.parse(r.config_json);
        if (parsed.webhook_url && typeof parsed.webhook_url === 'string') {
          webhookConfigs.push({
            url: parsed.webhook_url.trim(),
            method: parsed.method || 'POST',
            headers: parsed.headers,
            channel: parsed.channel,
            allowHttp,
          });
        }
      } catch {
        // Ignore corrupt JSON
      }
    }
  } catch (err) {
    console.error('[Alerts] Failed to load custom webhook rules:', err);
  }

  if (webhookConfigs.length === 0) {
    return;
  }

  // Dispatch notifications concurrently
  for (const t of transitions) {
    const eventPayload: AlertNotificationEvent = {
      title: t.title,
      message: t.message,
      nodeId: t.nodeId,
      nodeName: t.nodeName,
      type: t.type,
      status: t.status,
    };

    let anyDelivered = false;

    for (const cfg of webhookConfigs) {
      const maskedTarget = maskWebhookUrl(cfg.url);
      try {
        const ok = await sendWebhookNotification(cfg, eventPayload);
        if (ok) {
          anyDelivered = true;
        } else {
          // Never log raw URL / secrets into events
          await recordEvent(env.DB, t.nodeId, 'alert_notification_failed', {
            target: maskedTarget,
            status: t.status,
            type: t.type,
          });
        }
      } catch (err) {
        console.error(`[Alerts] Error sending webhook to ${maskedTarget}:`, err);
        await recordEvent(env.DB, t.nodeId, 'alert_notification_failed', {
          target: maskedTarget,
          error: String(err),
        });
      }
    }

    // Only mark delivered when at least one delivery succeeded (P0-3 Delivery State Machine)
    if (anyDelivered) {
      try {
        await markAlertDelivered(env.DB, t.stateKey, Date.now());
      } catch (err) {
        console.error('[Alerts] Failed to mark alert delivered:', err);
      }
    }
  }
}
