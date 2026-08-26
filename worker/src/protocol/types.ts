// EdgeMon Protocol V1.1 TypeScript Types
// Strictly aligned with edgemon-data-integrity-v1 specification

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

export interface ReportMetrics {
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

export interface MetricSample {
  sample_seq: number;
  sampled_at_ms: number;
  metrics: ReportMetrics;
}

export interface ReportPayload {
  samples?: MetricSample[];
  dropped_samples?: number;

  // Legacy single snapshot fields for backward compatibility fallback
  config_rev?: number;
  boot_id?: string | null;
  cpu?: { usage_pct?: number | null; throttled_pct?: number | null };
  memory?: { used_bytes?: number | null; working_set_bytes?: number | null; swap_used_bytes?: number | null };
  rootfs?: { used_bytes?: number | null };
  io?: { read_bps?: number | null; write_bps?: number | null };
  network?: { interface: string; counter_id?: string | null; rx_bps?: number | null; tx_bps?: number | null; rx_total_bytes: number; tx_total_bytes: number };
  uptime_sec?: number | null;
  probes?: Array<{ id: string; status: string; latency_ms?: number | null; loss_ratio: number }>;
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
  persisted_instance_id?: string | null;
  persisted_sample_seq?: number | null;
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
  persisted_sample_seq: number;
  config_rev: number;
  accepted_seq?: number;
  persisted_seq?: number;
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

export function validateReportMetrics(data: ReportMetrics): boolean {
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

export function validateReportPayload(data: ReportPayload): boolean {
  if (!data || typeof data !== 'object') return false;

  if (Array.isArray(data.samples)) {
    if (data.samples.length > 300) return false; // MAX_SAMPLES_PER_REPORT guard (allows full 300-sample buffer replay)
    for (const s of data.samples) {
      if (!s || typeof s !== 'object') return false;
      if (typeof s.sample_seq !== 'number' || s.sample_seq <= 0) return false;
      if (typeof s.sampled_at_ms !== 'number' || s.sampled_at_ms <= 0) return false;
      if (!validateReportMetrics(s.metrics)) return false;
    }
    return true;
  }

  // Legacy single metrics fallback
  return validateReportMetrics(data as unknown as ReportMetrics);
}

export function validateServerConfig(cfg: any): { valid: boolean; error?: string } {
  if (!cfg || typeof cfg !== 'object') {
    return { valid: false, error: 'Config must be an object' };
  }
  if (!Number.isInteger(cfg.sample_interval_sec) || cfg.sample_interval_sec < 1 || cfg.sample_interval_sec > 60) {
    return { valid: false, error: 'sample_interval_sec must be an integer between 1 and 60' };
  }
  if (!Number.isInteger(cfg.stream_interval_sec) || cfg.stream_interval_sec < 1 || cfg.stream_interval_sec > 60) {
    return { valid: false, error: 'stream_interval_sec must be an integer between 1 and 60' };
  }
  if (!Number.isInteger(cfg.probe_interval_sec) || cfg.probe_interval_sec < 10 || cfg.probe_interval_sec > 3600) {
    return { valid: false, error: 'probe_interval_sec must be an integer between 10 and 3600' };
  }
  if (typeof cfg.network_interface !== 'string' || cfg.network_interface.trim().length === 0 || cfg.network_interface.length > 32) {
    return { valid: false, error: 'network_interface must be a non-empty string with max length 32' };
  }
  if (!Array.isArray(cfg.probes) || cfg.probes.length > 20) {
    return { valid: false, error: 'probes must be an array with at most 20 probe targets' };
  }
  for (const p of cfg.probes) {
    if (!p || typeof p !== 'object') return { valid: false, error: 'Each probe must be an object' };
    if (typeof p.id !== 'string' || p.id.trim().length === 0 || p.id.length > 64) return { valid: false, error: 'Probe id must be a non-empty string <= 64 chars' };
    if (typeof p.name !== 'string' || p.name.trim().length === 0 || p.name.length > 64) return { valid: false, error: 'Probe name must be a non-empty string <= 64 chars' };
    if (typeof p.host !== 'string' || p.host.trim().length === 0 || p.host.length > 256 || /\s/.test(p.host)) return { valid: false, error: 'Probe host must be a valid non-empty hostname/IP' };
    if (p.method !== 'icmp' && p.method !== 'tcp') return { valid: false, error: 'Probe method must be either "icmp" or "tcp"' };
    if (p.port !== undefined && p.port !== null) {
      if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) {
        return { valid: false, error: 'Probe port must be an integer between 1 and 65535' };
      }
    }
  }
  return { valid: true };
}
