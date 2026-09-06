/**
 * Shared byte/rate formatters (single source of truth).
 * Replaces the per-file formatBytes/formatBps copies.
 * Sub-KB values render as exact bytes (never "0 KB"); B/s branch is rounded.
 */
export function formatBytes(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${Math.floor(bytes)} B`;
}

export function formatBps(bps?: number | null): string {
  if (bps == null || !Number.isFinite(bps) || bps <= 0) return '0 B/s';
  if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.floor(bps)} B/s`;
}
