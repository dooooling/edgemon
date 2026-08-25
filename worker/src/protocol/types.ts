// EdgeMon Protocol V1 TypeScript Types

export interface AgentEnvelope<T = unknown> {
  v: number;
  type: 'hello' | 'report';
  instance_id: string;
  seq: number;
  ts_ms: number;
  data: T;
}

export interface ServerEnvelope<T = unknown> {
  v: number;
  type: 'welcome' | 'ack' | 'error';
  instance_id: string;
  seq: number;
  ts_ms: number;
  data: T;
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
  report_interval_sec: number;
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
