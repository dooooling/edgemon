export interface WebhookConfig {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  channel?: 'generic' | 'discord' | 'telegram' | 'slack';
  allowHttp?: boolean;
}

export interface AlertNotificationEvent {
  title: string;
  message: string;
  nodeId: string;
  nodeName: string;
  type: string;
  status: 'firing' | 'resolved';
}

/**
 * Mask sensitive credentials / tokens in webhook URLs for safe logging and event auditing.
 */
export function maskWebhookUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    if (host.includes('discord.com') || host.includes('discordapp.com')) {
      const parts = parsed.pathname.split('/');
      if (parts.length >= 4) {
        return `https://${host}/api/webhooks/${parts[3]}/***REDACTED***`;
      }
    }
    if (host.includes('api.telegram.org')) {
      return `https://${host}/bot***REDACTED***/sendMessage`;
    }
    if (host.includes('hooks.slack.com')) {
      return `https://${host}/services/***REDACTED***`;
    }
    return `https://${host}${parsed.pathname.slice(0, 16)}/***REDACTED***`;
  } catch {
    return '***INVALID_URL***';
  }
}

/**
 * SSRF Defensive Validation for Webhook URLs:
 * - Requires HTTPS protocol strictly by default (allowHttp = false)
 * - Prohibits localhost, loopback, private RFC1918, link-local, carrier-grade NAT, and cloud metadata IPs.
 */
export function isAllowedWebhookUrl(rawUrl: string, allowHttp = false): boolean {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }

    // Strictly HTTPS in production unless explicitly permitted (e.g. dev/test environment)
    if (parsed.protocol === 'http:' && !allowHttp) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();

    // 1. Loopback & localhost
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local')
    ) {
      return false;
    }

    // 2. IPv4 validation for private/restricted ranges
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const a = parseInt(ipv4Match[1], 10);
      const b = parseInt(ipv4Match[2], 10);
      const c = parseInt(ipv4Match[3], 10);
      const d = parseInt(ipv4Match[4], 10);

      if (a > 255 || b > 255 || c > 255 || d > 255) return false;
      if (a === 0 || a === 127) return false; // Current network / loopback
      if (a === 10) return false; // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 192 && b === 168) return false; // 192.168.0.0/16
      if (a === 169 && b === 254) return false; // 169.254.0.0/16 Link-local / Cloud metadata (169.254.169.254)
      if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 Carrier-grade NAT
    }

    // 3. IPv6 validation for private/link-local ranges
    if (
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.')
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Format payload according to webhook platform channel
 */
export function formatWebhookPayload(
  config: WebhookConfig,
  event: AlertNotificationEvent
): { body: string; headers: Record<string, string> } {
  const customHeaders = config.headers || {};
  const isFiring = event.status === 'firing';
  const icon = isFiring ? '🚨' : '✅';
  const channel = config.channel || detectChannelFromUrl(config.url);

  if (channel === 'discord') {
    return {
      body: JSON.stringify({
        content: `${icon} **[EdgeMon Alert]** ${event.title}`,
        embeds: [
          {
            title: event.title,
            description: event.message,
            color: isFiring ? 0xe74c3c : 0x2ecc71,
            fields: [
              { name: 'Node', value: `${event.nodeName} (\`${event.nodeId}\`)`, inline: true },
              { name: 'Type', value: event.type.toUpperCase(), inline: true },
              { name: 'Status', value: event.status.toUpperCase(), inline: true },
            ],
            timestamp: new Date().toISOString(),
            footer: { text: 'EdgeMon Distributed Telemetry' },
          },
        ],
      }),
      headers: {
        'Content-Type': 'application/json',
        ...customHeaders,
      },
    };
  }

  if (channel === 'telegram') {
    return {
      body: JSON.stringify({
        text: `${icon} *[EdgeMon Alert]* ${escapeTelegramMarkdown(event.title)}\n\n` +
          `*Node:* ${escapeTelegramMarkdown(event.nodeName)} (\`${event.nodeId}\`)\n` +
          `*Type:* \`${event.type}\`\n` +
          `*Status:* *${event.status.toUpperCase()}*\n\n` +
          `${escapeTelegramMarkdown(event.message)}`,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
      headers: {
        'Content-Type': 'application/json',
        ...customHeaders,
      },
    };
  }

  if (channel === 'slack') {
    return {
      body: JSON.stringify({
        text: `${icon} *[EdgeMon Alert]* ${event.title}\n>${event.message}\n*Node:* ${event.nodeName} | *Type:* ${event.type} | *Status:* ${event.status}`,
      }),
      headers: {
        'Content-Type': 'application/json',
        ...customHeaders,
      },
    };
  }

  // Generic / Custom Webhook format
  return {
    body: JSON.stringify({
      event: `alert_${event.status}`,
      title: event.title,
      message: event.message,
      node_id: event.nodeId,
      node_name: event.nodeName,
      type: event.type,
      status: event.status,
      timestamp: Date.now(),
    }),
    headers: {
      'Content-Type': 'application/json',
      ...customHeaders,
    },
  };
}

function detectChannelFromUrl(url: string): 'discord' | 'telegram' | 'slack' | 'generic' {
  if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) {
    return 'discord';
  }
  if (url.includes('api.telegram.org')) {
    return 'telegram';
  }
  if (url.includes('hooks.slack.com')) {
    return 'slack';
  }
  return 'generic';
}

function escapeTelegramMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Send webhook notification with strict HTTPS SSRF protection, manual redirect handling, and credential masking.
 */
export async function sendWebhookNotification(
  config: WebhookConfig,
  event: AlertNotificationEvent
): Promise<boolean> {
  const allowHttp = config.allowHttp ?? false;
  if (!isAllowedWebhookUrl(config.url, allowHttp)) {
    console.error(`[Webhook] Blocked SSRF attempt or insecure HTTP URL: ${maskWebhookUrl(config.url)}`);
    return false;
  }

  const method = config.method || 'POST';
  const { body, headers } = formatWebhookPayload(config, event);
  const timeoutMs = config.timeoutMs || 5000;
  const maskedTarget = maskWebhookUrl(config.url);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(config.url, {
        method,
        headers: {
          'User-Agent': 'EdgeMon-Alert-Bot/0.1.0 (+https://github.com/dooooling/edgemon)',
          ...headers,
        },
        body,
        signal: controller.signal,
        redirect: 'manual', // Prevent SSRF open redirect bypass
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        return true;
      }

      console.warn(`[Webhook] Delivery to ${maskedTarget} failed with status ${res.status}`);
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[Webhook] Delivery to ${maskedTarget} network error:`, err);
    }

    if (attempt < 2) {
      // Short backoff before retry
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return false;
}
