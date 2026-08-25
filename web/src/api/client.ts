// EdgeMon Typed Frontend API Client

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
  state?: {
    last_seen_at_ms: number;
    cpu_usage_pct?: number | null;
    cpu_throttled_pct?: number | null;
    memory_used_bytes?: number | null;
    memory_working_set_bytes?: number | null;
    swap_used_bytes?: number | null;
    rootfs_used_bytes?: number | null;
    disk_read_bps?: number | null;
    disk_write_bps?: number | null;
    rx_bps?: number | null;
    tx_bps?: number | null;
    rx_total_bytes?: number;
    tx_total_bytes?: number;
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

export async function createAdminNode(payload: { name: string; traffic_reset_day?: number; note?: string }) {
  const res = await fetch('/api/admin/nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create node');
  return await res.json();
}

export async function deleteAdminNode(id: string) {
  const res = await fetch(`/api/admin/nodes/${id}`, { method: 'DELETE' });
  return await res.json();
}

export async function rotateAdminNodeToken(id: string): Promise<{ rawToken: string }> {
  const res = await fetch(`/api/admin/nodes/${id}/token`, { method: 'POST' });
  return await res.json();
}
