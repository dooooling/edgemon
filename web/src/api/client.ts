export interface MountItem {
  mount_point: string;
  total_bytes?: number | null;
  used_bytes?: number | null;
  fs_type?: string | null;
}

export interface NodeItem {
  id: string;
  name: string;
  sort_order: number;
  note?: string | null;
  system: {
    hostname?: string | null;
    os?: string | null;
    os_version?: string | null;
    kernel?: string | null;
    arch?: string | null;
  };
  environment: {
    type?: string | null;
    runtime?: string | null;
    host_virtualization_hint?: string | null;
    cgroup_version?: number | null;
    resource_scope?: string | null;
  };
  resources: {
    cpu_model_visible?: string | null;
    cpu_capacity_cores?: number | null;
    memory_limit_bytes?: number | null;
    swap_limit_bytes?: number | null;
    rootfs_limit_bytes?: number | null;
    rootfs_scope?: string | null;
  };
  geo: {
    country?: string | null;
    region?: string | null;
    city?: string | null;
    lat?: number | null;
    lon?: number | null;
    asn?: number | null;
    as_org?: string | null;
    colo?: string | null;
  };
  traffic?: {
    reset_day: number;
    quota_bytes: number | null;
    period_start_ms: number;
    period_rx_bytes: number;
    period_tx_bytes: number;
    period_total_bytes: number;
  } | null;
  expires_at_ms?: number | null;
  finance?: {
    price?: number | null;
    currency?: string;
    billing_cycle?: 'monthly' | 'quarterly' | 'semi_annually' | 'annually' | 'biennially' | 'triennially' | 'one_time' | 'free' | string;
    auto_renewal?: boolean;
  } | null;
  state?: {
    last_seen_at_ms: number;
    cpu_usage_pct?: number | null;
    cpu_throttled_pct?: number | null;
    cpu_temp_celsius?: number | null;
    load1?: number | null;
    load5?: number | null;
    load15?: number | null;
    process_total_count?: number | null;
    process_running_count?: number | null;
    memory_used_bytes?: number | null;
    memory_working_set_bytes?: number | null;
    swap_used_bytes?: number | null;
    oom_kill_count?: number | null;
    rootfs_used_bytes?: number | null;
    mounts?: MountItem[];
    disk_read_bps?: number | null;
    disk_write_bps?: number | null;
    read_iops?: number | null;
    write_iops?: number | null;
    io_util_pct?: number | null;
    rx_bps?: number | null;
    tx_bps?: number | null;
    rx_total_bytes?: number;
    tx_total_bytes?: number;
    tcp_established_count?: number | null;
    tcp_tw_count?: number | null;
    tcp_total_count?: number | null;
    udp_in_use?: number | null;
    edge_rtt_ms?: number | null;
    edge_transport?: string | null;
    uptime_sec?: number | null;
    probes: Array<{
      id: string;
      status: string;
      latency_ms?: number | null;
      loss_ratio: number;
    }>;
  } | null;
}

export interface HistoryResponse {
  resolution_sec: number;
  from_ms: number;
  to_ms: number;
  points: any[];
}

export async function fetchPublicConfig() {
  const res = await fetch('/api/public/config');
  return await res.json();
}

export async function fetchPublicNodes(): Promise<{ nodes: NodeItem[] }> {
  const res = await fetch('/api/public/nodes');
  return await res.json();
}

export async function fetchNodeHistory(nodeId: string, range = '24h'): Promise<HistoryResponse> {
  const res = await fetch(`/api/public/nodes/${nodeId}/history?range=${range}`);
  return await res.json();
}

export async function checkAdminSession(): Promise<{ authenticated: boolean; role?: string }> {
  const res = await fetch('/api/auth/session');
  return await res.json();
}

export async function adminLogin(key: string): Promise<{ status: string; authenticated: boolean }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) {
    throw new Error('Invalid Admin Key');
  }
  return await res.json();
}

export async function adminLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export async function fetchAdminNodes(): Promise<{ nodes: any[] }> {
  const res = await fetch('/api/admin/nodes');
  if (!res.ok) throw new Error('Unauthorized');
  return await res.json();
}

export async function createAdminNode(payload: {
  name: string;
  traffic_reset_day?: number;
  traffic_quota_bytes?: number | null;
  expires_at_ms?: number | null;
  note?: string | null;
  plan_price?: number | null;
  plan_currency?: string;
  billing_cycle?: string;
  auto_renewal?: boolean | number;
}) {
  const res = await fetch('/api/admin/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create node');
  return await res.json();
}

export async function updateAdminNode(id: string, payload: {
  name?: string;
  traffic_reset_day?: number;
  traffic_quota_bytes?: number | null;
  expires_at_ms?: number | null;
  note?: string | null;
  hidden?: boolean;
  plan_price?: number | null;
  plan_currency?: string;
  billing_cycle?: string;
  auto_renewal?: boolean | number;
}) {
  const res = await fetch(`/api/admin/nodes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update node');
  return await res.json();
}

export interface RotateTokenResponse {
  rawToken: string;
  warning?: string;
}

export interface DeleteNodeResponse {
  status: string;
  id: string;
  warning?: string;
}

export async function deleteAdminNode(id: string): Promise<DeleteNodeResponse> {
  const res = await fetch(`/api/admin/nodes/${id}`, { method: 'DELETE' });
  return await res.json();
}

export async function rotateAdminNodeToken(id: string): Promise<RotateTokenResponse> {
  const res = await fetch(`/api/admin/nodes/${id}/token`, { method: 'POST' });
  return await res.json();
}

export interface ProbeConfig {
  id: string;
  target: string;
  protocol: 'icmp' | 'tcp';
  port?: number;
  allow_private?: boolean;
}

export interface NodeServerConfig {
  sample_interval_sec?: number;
  stream_interval_sec?: number;
  probe_interval_sec?: number;
  network_interface?: string;
  probes?: ProbeConfig[];
}

export const PROBE_PRESETS = {
  china_3net: [
    { id: 'ct', target: '219.141.136.10', protocol: 'icmp' as const },
    { id: 'cu', target: '219.158.113.149', protocol: 'icmp' as const },
    { id: 'cm', target: '211.136.17.107', protocol: 'icmp' as const },
    { id: 'ali', target: '223.5.5.5', protocol: 'icmp' as const },
    { id: 'cf', target: '1.1.1.1', protocol: 'icmp' as const },
  ],
  global_infra: [
    { id: 'cf', target: '1.1.1.1', protocol: 'icmp' as const },
    { id: 'google', target: '8.8.8.8', protocol: 'icmp' as const },
    { id: 'apple', target: '17.253.144.10', protocol: 'icmp' as const },
  ],
  minimal_ping: [
    { id: 'cf', target: '1.1.1.1', protocol: 'icmp' as const },
    { id: 'google', target: '8.8.8.8', protocol: 'icmp' as const },
  ],
};

export async function fetchNodeConfig(id: string): Promise<{ revision: number; config: NodeServerConfig }> {
  const res = await fetch(`/api/admin/nodes/${id}/config`);
  if (!res.ok) throw new Error('Failed to fetch node config');
  return await res.json();
}

export async function updateNodeConfig(id: string, config: NodeServerConfig): Promise<{ revision: number; config: NodeServerConfig }> {
  const res = await fetch(`/api/admin/nodes/${id}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to update node config (${res.status})`);
  }
  return await res.json();
}

export interface AlertRule {
  id: number;
  node_id: string | null;
  type: 'offline' | 'cpu' | 'memory' | 'disk' | 'expiry' | 'webhook';
  threshold: number | null;
  duration_sec: number;
  enabled: number;
  config_json: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface SystemEvent {
  id: number;
  node_id: string | null;
  type: string;
  payload_json: string | null;
  created_at_ms: number;
}

export async function fetchAlertRules(): Promise<{ rules: AlertRule[] }> {
  const res = await fetch('/api/admin/alerts/rules');
  if (!res.ok) throw new Error('Failed to fetch alert rules');
  return await res.json();
}

export async function createAlertRule(rule: {
  node_id?: string | null;
  type: string;
  threshold?: number | null;
  duration_sec?: number | null;
  enabled?: number | boolean;
  config?: Record<string, any>;
}): Promise<{ success: boolean; id: number }> {
  const res = await fetch('/api/admin/alerts/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to create rule (${res.status})`);
  }
  return await res.json();
}

export async function deleteAlertRule(id: number): Promise<{ success: boolean }> {
  const res = await fetch(`/api/admin/alerts/rules/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete alert rule');
  return await res.json();
}

export async function fetchSystemEvents(): Promise<{ events: SystemEvent[] }> {
  const res = await fetch('/api/admin/events');
  if (!res.ok) throw new Error('Failed to fetch system events');
  return await res.json();
}

export async function testAlertWebhook(payload: {
  channel?: string;
  webhook_url?: string;
  bot_token?: string;
  chat_id?: string;
  api_host?: string;
  method?: string;
  headers?: Record<string, string>;
  url_template?: string;
  body_template?: string;
  content_type?: 'json' | 'form' | 'text';
}): Promise<{ success: boolean; status?: number; error?: string }> {
  const res = await fetch('/api/admin/alerts/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
  return data;
}

