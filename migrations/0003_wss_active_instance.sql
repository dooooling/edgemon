-- Migration: 0003_wss_active_instance.sql
-- EdgeMon WSS Architecture v1.0: Active Instance Tracking

ALTER TABLE nodes ADD COLUMN active_instance_id TEXT;
ALTER TABLE nodes ADD COLUMN active_instance_started_at_ms INTEGER;
ALTER TABLE nodes ADD COLUMN last_stream_connected_at_ms INTEGER;
ALTER TABLE nodes ADD COLUMN last_stream_disconnected_at_ms INTEGER;
