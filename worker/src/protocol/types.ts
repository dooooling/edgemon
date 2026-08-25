// EdgeMon Protocol V1.1 TypeScript Types
// Strictly aligned with edgemon-wss-architecture-v1.md

export type AgentMessageType = 'hello' | 'report' | 'config_ack' | 'error';
export type ServerMessageType = 'welcome' | 'config' | 'ack' | 'error';

export interface Envelope<T = unknown> {
  v: 1;
  type: string;
  instance_id: string;
  seq: number;
  ts_ms: number;
  data: T;
}

export interface AgentEnvelope<T = unknown> extends Envelope<T> {
  type: AgentMessageType;
}

export interface ServerEnvelope<T = unknown> extends Envelope<T> {
  type: ServerMessageType;
}

export interface HelloPayload {
  agent: {
    version: string;
    arch: string;
  };
  system: {
    hostname: string;
    os: string;
    os_version?: string | null;
    kernel: string;
  };
  environment: {
    type: 'container' | 'vm' | 'physical' | 'unknown';
    runtime?: string | null;
    host_virtualization_hint?: string | null;
    cgroup_version?: number | null;
    resource_scope: 'container' | 'machine' | 'unknown';
  };
  resources: {
    cpu_model_visible?: string | null;
    cpu_capacity_cores?: number | null;
    memory_limit_bytes?: number | null;
    swap_limit_bytes?: number | null;
    rootfs_limit_bytes?: number | null;
    rootfs_scope: string;
  };
  sources: {
    cpu: string;
    memory: string;
    io: string;
    network: string;
    rootfs: string;
  };
  capabilities: {
    icmp_probe: boolean;
    tcp_probe: boolean;
  };
  boot_id?: string | null;
  network_counter_id?: string | null;
}

export interface ReportPayload {
  config_rev: number;
  boot_id?: string | null;
  cpu: {
    usage_pct?: number | null;
    throttled_pct?: number | null;
  };
  memory: {
    used_bytes?: number | null;
    working_set_bytes?: number | null;
    swap_used_bytes?: number | null;
  };
  rootfs: {
    used_bytes?: number | null;
  };
  io: {
    read_bps?: number | null;
    write_bps?: number | null;
  };
  network: {
    interface: string;
    counter_id?: string | null;
    rx_bps?: number | null;
    tx_bps?: number | null;
    rx_total_bytes: number;
    tx_total_bytes: number;
  };
  uptime_sec?: number | null;
  probes: Array<{
    id: string;
    status: string;
    latency_ms?: number | null;
    loss_ratio: number;
  }>;
}

export interface ServerConfig {
  sample_interval_sec: number;
  stream_interval_sec: number;
  probe_interval_sec: number;
  network_interface: string;
  probes: Array<{
    id: string;
    name: string;
    host: string;
    method: 'icmp' | 'tcp';
    port?: number;
  }>;
}

export interface WelcomeData {
  config_rev: number;
  config: ServerConfig;
}

export interface ConfigData {
  config_rev: number;
  config: ServerConfig;
}

export interface ConfigAckData {
  config_rev: number;
  status: 'applied' | 'rejected';
  reason?: string | null;
}

export interface AckData {
  accepted_seq: number;
  persisted_seq: number;
  config_rev: number;
}

export interface ErrorData {
  code: string;
  message: string;
}

export const CloseCodes = {
  NORMAL_CLOSURE: 1000,
  PROTOCOL_ERROR: 1002,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  SERVER_RECONNECT: 4001,
  REPLACED_BY_NEW_INSTANCE: 4002,
  TOKEN_REVOKED: 4003,
  NODE_DISABLED: 4004,
  CONFIG_FATAL: 4005,
} as const;

export function validateFiniteMetric(val: number | null | undefined, min?: number, max?: number): boolean {
  if (val === null || val === undefined) return true;
  if (!Number.isFinite(val)) return false;
  if (min !== undefined && val < min) return false;
  if (max !== undefined && val > max) return false;
  return true;
}

export function validateReportPayload(data: ReportPayload): boolean {
  if (!data || typeof data !== 'object') return false;
  if (!validateFiniteMetric(data.cpu?.usage_pct, 0, 100)) return false;
  if (!validateFiniteMetric(data.cpu?.throttled_pct, 0, 100)) return false;
  if (!validateFiniteMetric(data.memory?.used_bytes, 0)) return false;
  if (!validateFiniteMetric(data.memory?.working_set_bytes, 0)) return false;
  if (!validateFiniteMetric(data.memory?.swap_used_bytes, 0)) return false;
  if (!validateFiniteMetric(data.rootfs?.used_bytes, 0)) return false;
  if (!validateFiniteMetric(data.io?.read_bps, 0)) return false;
  if (!validateFiniteMetric(data.io?.write_bps, 0)) return false;
  if (!validateFiniteMetric(data.network?.rx_bps, 0)) return false;
  if (!validateFiniteMetric(data.network?.tx_bps, 0)) return false;
  if (!validateFiniteMetric(data.network?.rx_total_bytes, 0)) return false;
  if (!validateFiniteMetric(data.network?.tx_total_bytes, 0)) return false;
  if (!validateFiniteMetric(data.uptime_sec, 0)) return false;

  if (Array.isArray(data.probes)) {
    for (const p of data.probes) {
      if (!validateFiniteMetric(p.latency_ms, 0)) return false;
      if (!validateFiniteMetric(p.loss_ratio, 0, 1)) return false;
    }
  }
  return true;
}
