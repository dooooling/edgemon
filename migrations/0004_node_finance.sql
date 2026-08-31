-- Migration: 0004_node_finance.sql
-- EdgeMon Server Cost & Billing Lifecycle

ALTER TABLE nodes ADD COLUMN plan_price REAL;
ALTER TABLE nodes ADD COLUMN plan_currency TEXT DEFAULT 'USD';
ALTER TABLE nodes ADD COLUMN billing_cycle TEXT DEFAULT 'monthly';
ALTER TABLE nodes ADD COLUMN auto_renewal INTEGER DEFAULT 1;
