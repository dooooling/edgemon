export interface WebhookConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function sendWebhookNotification(
  config: WebhookConfig,
  event: { title: string; message: string; nodeId?: string; type: string }
): Promise<boolean> {
  const method = config.method || 'POST';
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'EdgeMon-Worker/0.1.0',
    ...(config.headers || {}),
  };

  const payload = JSON.stringify({
    event: event.type,
    title: event.title,
    message: event.message,
    node_id: event.nodeId,
    timestamp: Date.now(),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs || 10000);

  try {
    const res = await fetch(config.url, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}
