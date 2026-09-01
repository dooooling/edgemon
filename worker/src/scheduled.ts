import { Env } from './durable/realtime-hub';
import { evaluateAlerts, recordEvent, markAlertDelivered, AlertTransition } from './db/alerts';
import { executeHourlyRollup, executeRetentionCleanup } from './db/metrics';
import { getSecretSetting } from './services/crypto';
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

/**
 * Lightweight helper to run asynchronous tasks with a maximum concurrency limit
 */
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const poolSize = Math.min(limit, items.length);
  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  return results;
}

async function dispatchAlertNotifications(env: Env, transitions: AlertTransition[]): Promise<void> {
  const allowHttp = (env as any).ALLOW_HTTP_WEBHOOKS === 'true';
  const encryptionKey = (env as any).DATA_ENCRYPTION_KEY as string | undefined;

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

  // B. Database configured notification rules (supporting AES-GCM encrypted secret_settings)
  let decryptionFailedCount = 0;
  try {
    const customRulesResult = await env.DB
      .prepare("SELECT id, config_json FROM alert_rules WHERE enabled = 1 AND (type IN ('channel', 'webhook') OR config_json LIKE '%secret_key%')")
      .all<{ id: number; config_json: string | null }>();

    const customRules = customRulesResult.results || [];
    for (const r of customRules) {
      if (!r.config_json) continue;
      try {
        let parsed = JSON.parse(r.config_json);

        // Check if sensitive credentials are encrypted in secret_settings
        if (parsed.secret_key) {
          if (!encryptionKey) {
            decryptionFailedCount++;
            console.error(`[Alerts] Channel rule ${r.id} requires DATA_ENCRYPTION_KEY to decrypt credentials`);
            continue;
          }
          const decryptedJson = await getSecretSetting(env.DB, parsed.secret_key, encryptionKey);
          if (!decryptedJson) {
            decryptionFailedCount++;
            console.error(`[Alerts] Channel rule ${r.id} failed to decrypt credentials from secret_settings`);
            continue;
          }
          try {
            const decryptedConfig = JSON.parse(decryptedJson);
            parsed = { ...parsed, ...decryptedConfig };
          } catch {
            decryptionFailedCount++;
            continue;
          }
        }

        if (parsed.webhook_url || (parsed.bot_token && parsed.chat_id) || parsed.url_template) {
          webhookConfigs.push({
            id: r.id,
            url: parsed.webhook_url ? parsed.webhook_url.trim() : '',
            method: parsed.method || 'POST',
            headers: parsed.headers,
            channel: parsed.channel,
            botToken: parsed.bot_token,
            chatId: parsed.chat_id,
            apiHost: parsed.api_host,
            contentType: parsed.content_type,
            urlTemplate: parsed.url_template,
            bodyTemplate: parsed.body_template,
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
    if (decryptionFailedCount > 0) {
      // Configuration / Decryption failure: DO NOT mark delivered, log and record audit event
      console.error(`[Alerts] Notification channels exist (${decryptionFailedCount} channel(s) failed decryption) but no valid webhook config available. Skipping markAlertDelivered to allow retry.`);
      for (const t of transitions) {
        try {
          await recordEvent(env.DB, t.nodeId, 'alert_notification_degraded', {
            reason: 'Channel decryption failed or encryption key misconfigured',
            decryption_failed_count: decryptionFailedCount,
            status: t.status,
            type: t.type,
          });
        } catch {
          // ignore
        }
      }
      return;
    }

    // Legitimately no webhook targets configured: mark transitions as delivered to prevent duplicate loops
    for (const t of transitions) {
      try {
        await markAlertDelivered(env.DB, t.stateKey, Date.now());
      } catch {
        // ignore
      }
    }
    return;
  }

  // Flatten all transition × destination pairs into a global bounded concurrency job queue (concurrency = 5)
  interface DeliveryJob {
    transition: AlertTransition;
    config: WebhookConfig;
  }

  const jobs: DeliveryJob[] = [];
  for (const t of transitions) {
    const hasExplicitTargets = Array.isArray(t.channelIds) && t.channelIds.length > 0;
    const configsToUse = hasExplicitTargets
      ? webhookConfigs.filter((cfg) => cfg.id && t.channelIds!.includes(cfg.id))
      : webhookConfigs;

    if (hasExplicitTargets && configsToUse.length === 0) {
      // Audit: Configured channel targets unavailable or disabled; do NOT fallback to broadcast!
      await recordEvent(env.DB, t.nodeId, 'alert_notification_skipped', {
        reason: 'Configured channel IDs unavailable or disabled',
        configured_channel_ids: t.channelIds,
        status: t.status,
        type: t.type,
      });
      continue;
    }

    for (const cfg of configsToUse) {
      jobs.push({ transition: t, config: cfg });
    }
  }

  // Track delivery statistics per transition for explicit semantics
  interface TransitionDeliveryStats {
    total: number;
    succeeded: string[];
    failed: string[];
  }

  const deliveryStats = new Map<string, TransitionDeliveryStats>();
  for (const t of transitions) {
    deliveryStats.set(t.stateKey, { total: 0, succeeded: [], failed: [] });
  }

  for (const job of jobs) {
    const stat = deliveryStats.get(job.transition.stateKey);
    if (stat) stat.total++;
  }

  await mapConcurrent(jobs, 5, async (job) => {
    const t = job.transition;
    const cfg = job.config;
    const eventPayload: AlertNotificationEvent = {
      title: t.title,
      message: t.message,
      nodeId: t.nodeId,
      nodeName: t.nodeName,
      type: t.type,
      status: t.status,
    };

    const maskedTarget = maskWebhookUrl(cfg.url);
    try {
      const ok = await sendWebhookNotification(cfg, eventPayload);
      const stat = deliveryStats.get(t.stateKey);
      if (ok) {
        stat?.succeeded.push(maskedTarget);
      } else {
        stat?.failed.push(maskedTarget);
        await recordEvent(env.DB, t.nodeId, 'alert_notification_failed', {
          target: maskedTarget,
          status: t.status,
          type: t.type,
        });
      }
    } catch (err) {
      console.error(`[Alerts] Error sending webhook to ${maskedTarget}:`, err);
      const stat = deliveryStats.get(t.stateKey);
      stat?.failed.push(maskedTarget);
      await recordEvent(env.DB, t.nodeId, 'alert_notification_failed', {
        target: maskedTarget,
        error: String(err),
      });
    }
  });

  // Explicit delivery outcome evaluation & state transition
  for (const t of transitions) {
    const stat = deliveryStats.get(t.stateKey);
    if (!stat || stat.total === 0) continue;

    const successCount = stat.succeeded.length;

    if (successCount === stat.total) {
      // 1. Complete delivery across all targeted channels
      await recordEvent(env.DB, t.nodeId, 'alert_delivered_all', {
        status: t.status,
        type: t.type,
        targets: stat.succeeded,
      });
      try {
        await markAlertDelivered(env.DB, t.stateKey, Date.now());
      } catch (err) {
        console.error('[Alerts] Failed to mark alert delivered:', err);
      }
    } else if (successCount > 0) {
      // 2. Partial delivery (some channels succeeded, some failed)
      // Advance last_notified_at_ms to prevent notification storming, but audit failure
      await recordEvent(env.DB, t.nodeId, 'alert_delivered_partial', {
        status: t.status,
        type: t.type,
        succeeded_targets: stat.succeeded,
        failed_targets: stat.failed,
      });
      try {
        await markAlertDelivered(env.DB, t.stateKey, Date.now());
      } catch (err) {
        console.error('[Alerts] Failed to mark alert delivered:', err);
      }
    } else {
      // 3. Complete failure across all channels - do NOT mark delivered, will retry next evaluation cycle
      await recordEvent(env.DB, t.nodeId, 'alert_delivery_all_failed', {
        status: t.status,
        type: t.type,
        failed_targets: stat.failed,
      });
    }
  }
}
