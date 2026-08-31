-- Migration: 0002_data_integrity.sql
-- EdgeMon Data Integrity Protocol v1 Schema Extensions

ALTER TABLE node_state ADD COLUMN persisted_instance_id TEXT;
ALTER TABLE node_state ADD COLUMN persisted_sample_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE node_state ADD COLUMN dropped_samples INTEGER NOT NULL DEFAULT 0;
