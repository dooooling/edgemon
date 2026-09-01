-- EdgeMon D1 Schema Migration V5
-- Secondary time-based indexes for retention cleanup, hourly cron rollup, and event queries

CREATE INDEX IF NOT EXISTS idx_metrics_raw_bucket_start
ON metrics_raw(bucket_start_ms);

CREATE INDEX IF NOT EXISTS idx_metrics_hourly_bucket_start
ON metrics_hourly(bucket_start_ms);

CREATE INDEX IF NOT EXISTS idx_events_ts
ON events(ts_ms DESC);

CREATE INDEX IF NOT EXISTS idx_traffic_periods_start
ON traffic_periods(period_start_ms);
