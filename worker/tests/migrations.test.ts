import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('D1 Migrations Verification (Fresh Install & Upgrade Path)', () => {
  const migrationsDir = path.resolve(__dirname, '../../migrations');

  function getMigrationFiles(): { name: string; sql: string }[] {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    return files.map((file) => ({
      name: file,
      sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
    }));
  }

  it('Migration sequence has exactly 4 strictly numbered files starting with 0001_init.sql', () => {
    const migrations = getMigrationFiles();
    expect(migrations.map((m) => m.name)).toEqual([
      '0001_init.sql',
      '0002_data_integrity.sql',
      '0003_wss_active_instance.sql',
      '0004_node_finance.sql',
    ]);
  });

  it('Guarantees 0001_init.sql does not include 0004 finance columns to avoid duplicate column errors on fresh install', () => {
    const migrations = getMigrationFiles();
    const initSql = migrations.find((m) => m.name === '0001_init.sql')!.sql;

    // Must NOT contain plan_price or billing_cycle directly in CREATE TABLE nodes
    expect(initSql).not.toContain('plan_price');
    expect(initSql).not.toContain('billing_cycle');
    expect(initSql).not.toContain('auto_renewal');
  });

  it('Guarantees 0002 and 0003 match historical ALTER TABLE schema extensions', () => {
    const migrations = getMigrationFiles();
    const m2 = migrations.find((m) => m.name === '0002_data_integrity.sql')!.sql;
    const m3 = migrations.find((m) => m.name === '0003_wss_active_instance.sql')!.sql;
    const m4 = migrations.find((m) => m.name === '0004_node_finance.sql')!.sql;

    expect(m2).toContain('persisted_instance_id');
    expect(m2).toContain('persisted_sample_seq');
    expect(m3).toContain('active_instance_id');
    expect(m3).toContain('last_stream_connected_at_ms');
    expect(m4).toContain('plan_price');
    expect(m4).toContain('billing_cycle');
  });

  it('Real SQLite Execution: Fresh install executes 0001 -> 0004 sequentially without SQL errors', () => {
    const db = new DatabaseSync(':memory:');
    const migrations = getMigrationFiles();

    for (const m of migrations) {
      db.exec(m.sql);
    }

    // Verify nodes table columns
    const nodeColumns = db.prepare('PRAGMA table_info(nodes)').all() as { name: string }[];
    const colNames = nodeColumns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('token_hash');
    expect(colNames).toContain('active_instance_id');
    expect(colNames).toContain('last_stream_connected_at_ms');
    expect(colNames).toContain('plan_price');
    expect(colNames).toContain('plan_currency');
    expect(colNames).toContain('billing_cycle');
    expect(colNames).toContain('auto_renewal');

    // Verify node_state columns
    const stateColumns = db.prepare('PRAGMA table_info(node_state)').all() as { name: string }[];
    const stateColNames = stateColumns.map((c) => c.name);
    expect(stateColNames).toContain('persisted_instance_id');
    expect(stateColNames).toContain('persisted_sample_seq');
    expect(stateColNames).toContain('dropped_samples');

    // Verify secret_settings table
    const secretColumns = db.prepare('PRAGMA table_info(secret_settings)').all() as { name: string }[];
    const secretColNames = secretColumns.map((c) => c.name);
    expect(secretColNames).toContain('key');
    expect(secretColNames).toContain('nonce_b64');
    expect(secretColNames).toContain('cipher_b64');

    db.close();
  });

  it('Real SQLite Execution: Historical upgrade executes 0001~0003, inserts data, then migrates 0004 cleanly', () => {
    const db = new DatabaseSync(':memory:');
    const migrations = getMigrationFiles();

    // 1. Run 0001, 0002, 0003
    for (let i = 0; i < 3; i++) {
      db.exec(migrations[i].sql);
    }

    // 2. Insert mock node with 0003 schema
    db.prepare(`
      INSERT INTO nodes (id, name, token_hash, created_at_ms, updated_at_ms)
      VALUES ('node-test-1', 'Tokyo Node', 'hash123', 1700000000000, 1700000000000)
    `).run();

    // 3. Apply 0004
    db.exec(migrations[3].sql);

    // 4. Query migrated node
    const row = db.prepare('SELECT id, name, plan_price, plan_currency, billing_cycle, auto_renewal FROM nodes WHERE id = ?')
      .get('node-test-1') as any;

    expect(row.id).toBe('node-test-1');
    expect(row.name).toBe('Tokyo Node');
    expect(row.plan_price).toBeNull();
    expect(row.plan_currency).toBe('USD');
    expect(row.billing_cycle).toBe('monthly');
    expect(row.auto_renewal).toBe(1);

    db.close();
  });
});
