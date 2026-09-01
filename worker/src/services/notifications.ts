export interface WebhookConfig {
  id?: number;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  channel?:
    | 'generic'
    | 'custom'
    | 'discord'
    | 'telegram'
    | 'slack'
    | 'feishu'
    | 'dingtalk'
    | 'wecom'
    | 'bark'
    | 'serverchan'
    | 'pushdeer';
  allowHttp?: boolean;
  contentType?: 'json' | 'form' | 'text';
  urlTemplate?: string;
  bodyTemplate?: string;
  botToken?: string;
  chatId?: string;
  apiHost?: string;
}

export interface AlertNotificationEvent {
  title: string;
  message: string;
  nodeId: string;
  nodeName: string;
  type: string;
  status: 'firing' | 'resolved';
}

export function renderTemplate(template: string, event: AlertNotificationEvent): string {
  const isFiring = event.status === 'firing';
  const emoji = isFiring ? '🚨' : '✅';
  const nowStr = new Date().toISOString();

  return template
    .replace(/\{\{\s*node_name\s*\}\}/gi, event.nodeName)
    .replace(/\{\{\s*node_id\s*\}\}/gi, event.nodeId)
    .replace(/\{\{\s*event\s*\}\}/gi, event.status.toUpperCase())
    .replace(/\{\{\s*status\s*\}\}/gi, event.status)
    .replace(/\{\{\s*title\s*\}\}/gi, event.title)
    .replace(/\{\{\s*message\s*\}\}/gi, event.message)
    .replace(/\{\{\s*type\s*\}\}/gi, event.type)
    .replace(/\{\{\s*time\s*\}\}/gi, nowStr)
    .replace(/\{\{\s*emoji\s*\}\}/gi, emoji);
}

export function resolveWebhookUrl(config: WebhookConfig, event?: AlertNotificationEvent): string {
  if (config.botToken && config.chatId) {
    const host = (config.apiHost || 'https://api.telegram.org').replace(/\/+$/, '');
    return `${host}/bot${config.botToken}/sendMessage`;
  }

  let rawUrl = config.url || '';
  if (config.urlTemplate && event) {
    rawUrl = renderTemplate(config.urlTemplate, event);
  }

  return rawUrl.trim();
}

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
    if (host.includes('open.feishu.cn') || host.includes('open.larksuite.com')) {
      return `https://${host}/open-apis/bot/v2/hook/***REDACTED***`;
    }
    if (host.includes('oapi.dingtalk.com')) {
      return `https://${host}/robot/send?access_token=***REDACTED***`;
    }
    if (host.includes('qyapi.weixin.qq.com')) {
      return `https://${host}/cgi-bin/webhook/send?key=***REDACTED***`;
    }
    if (host.includes('api.day.app')) {
      return `https://${host}/***REDACTED***`;
    }
    if (host.includes('ftqq.com')) {
      return `https://${host}/***REDACTED***.send`;
    }
    if (host.includes('pushdeer.com')) {
      return `https://${host}/message/push?pushkey=***REDACTED***`;
    }
    if (host.includes('hooks.slack.com')) {
      return `https://${host}/services/***REDACTED***`;
    }
    if (host.includes('api.telegram.org') || parsed.pathname.startsWith('/bot')) {
      return `https://${host}/bot***REDACTED***/sendMessage`;
    }
    return `${parsed.protocol}//${host}/***REDACTED***`;
  } catch {
    return '***INVALID_URL***';
  }
}

export function isAllowedWebhookUrl(rawUrl: string, allowHttp = false): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.protocol === 'http:' && !allowHttp) return false;

    const rawHost = parsed.hostname.toLowerCase();
    const host = rawHost.replace(/^\[/, '').replace(/\]$/, '');

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0:0:0:0:0:0:0:1' ||
      host === '::' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local')
    ) {
      return false;
    }

    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const a = parseInt(ipv4Match[1], 10);
      const b = parseInt(ipv4Match[2], 10);
      const c = parseInt(ipv4Match[3], 10);
      const d = parseInt(ipv4Match[4], 10);
      if (a > 255 || b > 255 || c > 255 || d > 255) return false;
      if (a === 0 || a === 127) return false;
      if (a === 10) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 169 && b === 254) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
    }

    if (
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.startsWith('2001:db8:')
    ) {
      return false;
    }

    if (host.startsWith('::ffff:')) {
      const suffix = host.slice(7);
      if (suffix.includes('.')) return isAllowedWebhookUrl(`https://${suffix}/`, false);
      const hexParts = suffix.split(':');
      if (hexParts.length === 2) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        if (!isNaN(hi) && !isNaN(lo)) {
          const mappedIpv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isAllowedWebhookUrl(`https://${mappedIpv4}/`, false);
        }
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function validateDnsAndSsrf(rawUrl: string, allowHttp = false): Promise<boolean> {
  try {
    if (!isAllowedWebhookUrl(rawUrl, allowHttp)) return false;
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    const isDirectIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
    const isDirectIpv6 = host.includes(':');

    if (!isDirectIpv4 && !isDirectIpv6) {
      const dohController = new AbortController();
      const dohTimeout = setTimeout(() => dohController.abort(), 3000);
      try {
        const [dohResA, dohResAaaa] = await Promise.all([
          fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, {
            headers: { Accept: 'application/dns-json' },
            signal: dohController.signal,
          }).then((r) => (r.ok ? (r.json() as Promise<any>) : null)).catch(() => null),
          fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=AAAA`, {
            headers: { Accept: 'application/dns-json' },
            signal: dohController.signal,
          }).then((r) => (r.ok ? (r.json() as Promise<any>) : null)).catch(() => null),
        ]);
        clearTimeout(dohTimeout);

        // Fail-Closed: If DoH query completely failed or errored out, reject
        if (!dohResA && !dohResAaaa) {
          return false;
        }

        const answersA = (dohResA?.Answer || []).filter((ans: any) => ans.type === 1 && ans.data);
        const answersAaaa = (dohResAaaa?.Answer || []).filter((ans: any) => ans.type === 28 && ans.data);

        // Fail-Closed: Must resolve to at least one valid A or AAAA record
        if (answersA.length === 0 && answersAaaa.length === 0) {
          return false;
        }

        // Fail-Closed: Every resolved address must strictly pass SSRF boundary check
        for (const ans of answersA) {
          if (!isAllowedWebhookUrl(`https://${ans.data}/`, false)) return false;
        }
        for (const ans of answersAaaa) {
          if (!isAllowedWebhookUrl(`https://[${ans.data}]/`, false)) return false;
        }
      } catch {
        clearTimeout(dohTimeout);
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function formatWebhookPayload(
  config: WebhookConfig,
  event: AlertNotificationEvent
): { url: string; method: string; body?: string; headers: Record<string, string> } {
  const customHeaders = config.headers || {};
  const isFiring = event.status === 'firing';
  const icon = isFiring ? '🚨' : '✅';
  const channel = config.channel || detectChannelFromUrl(config.url || '');
  const targetUrl = resolveWebhookUrl(config, event);

  if (channel === 'discord') {
    return {
      url: targetUrl,
      method: 'POST',
      body: JSON.stringify({
        content: `${icon} **[EdgeMon Alert]** ${event.title}`,
        embeds: [{
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
        }],
      }),
      headers: { 'Content-Type': 'application/json', ...customHeaders },
    };
  }

  if (channel === 'telegram') {
    const payload: any = {
      text: `${icon} *[EdgeMon Alert]* ${escapeTelegramMarkdown(event.title)}\n\n` +
        `*Node:* ${escapeTelegramMarkdown(event.nodeName)} (\`${event.nodeId}\`)\n` +
        `*Type:* \`${event.type}\`\n` +
        `*Status:* *${event.status.toUpperCase()}*\n\n` +
        `${escapeTelegramMarkdown(event.message)}`,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    };
    if (config.chatId) payload.chat_id = config.chatId;
    return {
      url: targetUrl,
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', ...customHeaders },
    };
  }

  if (channel === 'slack') {
    return {
      url: targetUrl,
      method: 'POST',
      body: JSON.stringify({ text: `${icon} *[EdgeMon Alert]* ${event.title}\n>${event.message}\n*Node:* ${event.nodeName} | *Type:* ${event.type} | *Status:* ${event.status}` }),
      headers: { 'Content-Type': 'application/json', ...customHeaders },
    };
  }

  if (channel === 'feishu') {
    return {
      url: targetUrl,
      method: 'POST',
      body: JSON.stringify({
        msg_type: 'post',
        content: { post: { zh_cn: { title: `${icon} [EdgeMon] ${event.title}`, content: [
          [{ tag: 'text', text: `服务器节点: ${event.nodeName} (${event.nodeId})\n` }],
          [{ tag: 'text', text: `告警类型: ${event.type} | 状态: ${event.status.toUpperCase()}\n` }],
          [{ tag: 'text', text: `详细信息: ${event.message}\n` }],
          [{ tag: 'text', text: `时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` }],
        ] } } },
      }),
      headers: { 'Content-Type': 'application/json', ...customHeaders },
    };
  }

  if (channel === 'dingtalk') {
    return {
      url: targetUrl,
      method: 'POST',
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { title: `${icon} [EdgeMon] ${event.title}`, text: `### ${icon} [EdgeMon] ${event.title}\n\n- **服务器**: ${event.nodeName} (\`${event.nodeId}\`)\n- **规则类型**: ${event.type}\n- **运行状态**: **${event.status.toUpperCase()}**\n\n> ${event.message}\n\n*时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*` },
      }),
      headers: { 'Content-Type': 'application/json', ...customHeaders },
    };
  }

  if (channel === 'wecom') {
    return {
      url: targetUrl,
      method: 'POST',
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content: `${icon} **[EdgeMon] ${event.title}**\n\n>节点: <font color="comment">${event.nodeName}</font>\n>类型: <font color="comment">${event.type}</font>\n>状态: **${event.status.toUpperCase()}**\n\n${event.message}` },
      }),
      headers: { 'Content-Type': 'application/json', ...customHeaders },
    };
  }

  if (channel === 'bark') {
    const barkUrl = targetUrl.replace(/\/+$/, '');
    return {
      url: `${barkUrl}/${encodeURIComponent(`${icon} [EdgeMon] ${event.title}`)}/${encodeURIComponent(event.message)}?group=EdgeMon`,
      method: 'GET',
      headers: { ...customHeaders },
    };
  }

  if (channel === 'serverchan') {
    return {
      url: targetUrl,
      method: 'POST',
      body: JSON.stringify({ title: `${icon} [EdgeMon] ${event.title}`, desp: `### ${event.title}\n\n- **节点**: ${event.nodeName}\n- **状态**: ${event.status}\n\n${event.message}` }),
      headers: { 'Content-Type': 'application/json', ...customHeaders },
    };
  }

  if (channel === 'pushdeer') {
    return {
      url: targetUrl,
      method: 'POST',
      body: JSON.stringify({ text: `${icon} [EdgeMon] ${event.title}`, desp: `节点: ${event.nodeName}\n状态: ${event.status}\n\n${event.message}` }),
      headers: { 'Content-Type': 'application/json', ...customHeaders },
    };
  }

  const method = (config.method || 'POST').toUpperCase();
  let bodyContent: string | undefined = undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    bodyContent = config.bodyTemplate ? renderTemplate(config.bodyTemplate, event) : JSON.stringify({ event: `alert_${event.status}`, title: event.title, message: event.message, node_id: event.nodeId, node_name: event.nodeName, type: event.type, status: event.status, timestamp: Date.now() });
  }

  return {
    url: targetUrl,
    method,
    body: bodyContent,
    headers: {
      'Content-Type': config.contentType === 'form' ? 'application/x-www-form-urlencoded' : config.contentType === 'text' ? 'text/plain' : 'application/json',
      ...customHeaders,
    },
  };
}

function detectChannelFromUrl(url: string): WebhookConfig['channel'] {
  if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) return 'discord';
  if (url.includes('api.telegram.org')) return 'telegram';
  if (url.includes('hooks.slack.com')) return 'slack';
  if (url.includes('open.feishu.cn') || url.includes('open.larksuite.com')) return 'feishu';
  if (url.includes('oapi.dingtalk.com')) return 'dingtalk';
  if (url.includes('qyapi.weixin.qq.com')) return 'wecom';
  if (url.includes('api.day.app')) return 'bark';
  if (url.includes('ftqq.com')) return 'serverchan';
  if (url.includes('pushdeer.com')) return 'pushdeer';
  return 'generic';
}

function escapeTelegramMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export async function sendWebhookNotification(config: WebhookConfig, event: AlertNotificationEvent): Promise<boolean> {
  const { url, method, body, headers } = formatWebhookPayload(config, event);
  const allowHttp = config.allowHttp ?? false;
  if (!(await validateDnsAndSsrf(url, allowHttp))) {
    console.error(`[Webhook] Blocked SSRF attempt or forbidden IP: ${maskWebhookUrl(url)}`);
    return false;
  }
  const timeoutMs = config.timeoutMs || 5000;
  const maskedTarget = maskWebhookUrl(url);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': 'EdgeMon-Alert-Bot/0.1.0 (+https://github.com/dooooling/edgemon)', ...headers },
        body,
        signal: controller.signal,
        redirect: 'manual',
      });
      clearTimeout(timeoutId);
      if (res.ok) return true;
      console.warn(`[Webhook] Delivery to ${maskedTarget} failed with status ${res.status}`);
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[Webhook] Delivery to ${maskedTarget} network error:`, err);
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function testWebhookNotification(config: WebhookConfig): Promise<{ success: boolean; status?: number; error?: string }> {
  const testEvent: AlertNotificationEvent = {
    title: '这是一个测试通知 (Test Notification)',
    message: 'EdgeMon 监控告警系统链路通信正常，配置已验证通过！',
    nodeId: 'test-node-01',
    nodeName: 'Test-Tokyo-01',
    type: 'test',
    status: 'firing',
  };
  const { url, method, body, headers } = formatWebhookPayload(config, testEvent);
  if (!(await validateDnsAndSsrf(url, config.allowHttp ?? false))) {
    return { success: false, error: `Blocked by SSRF security policy: URL resolves to private or restricted network address (${maskWebhookUrl(url)})` };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': 'EdgeMon-Alert-Bot/0.1.0 (+https://github.com/dooooling/edgemon)', ...headers },
      body,
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timeoutId);
    if (res.ok) return { success: true, status: res.status };
    const responseText = await res.text().catch(() => '');
    return { success: false, status: res.status, error: `Target server returned HTTP ${res.status}: ${responseText.slice(0, 200)}` };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return { success: false, error: err.name === 'AbortError' ? 'Connection timed out after 6 seconds' : err.message || 'Network error' };
  }
}
