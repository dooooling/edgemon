-- Migration: 0006_cpu_topology.sql
-- EdgeMon CPU topology: physical vs logical cores
-- (Efficiency P/E classification intentionally omitted: no OS exposes it
-- uniformly, raw class numbers would be uninterpretable fake data.)

ALTER TABLE nodes ADD COLUMN cpu_physical_cores REAL;
