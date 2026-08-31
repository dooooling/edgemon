import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

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

  it('Real SQLite WebAssembly Execution: Fresh install executes 0001 -> 0004 sequentially without SQL errors', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const migrations = getMigrationFiles();

    for (const m of migrations) {
      db.run(m.sql);
    }

    // Verify nodes table columns via PRAGMA table_info(nodes)
    const nodeRes = db.exec('PRAGMA table_info(nodes)');
    expect(nodeRes.length).toBe(1);
    const nodeColumns = nodeRes[0].values.map((row) => row[1] as string); // row[1] is column name

    expect(nodeColumns).toContain('id');
    expect(nodeColumns).toContain('name');
    expect(nodeColumns).toContain('token_hash');
    expect(nodeColumns).toContain('active_instance_id');
    expect(nodeColumns).toContain('last_stream_connected_at_ms');
    expect(nodeColumns).toContain('plan_price');
    expect(nodeColumns).toContain('plan_currency');
    expect(nodeColumns).toContain('billing_cycle');
    expect(nodeColumns).toContain('auto_renewal');

    // Verify node_state columns
    const stateRes = db.exec('PRAGMA table_info(node_state)');
    expect(stateRes.length).toBe(1);
    const stateColumns = stateRes[0].values.map((row) => row[1] as string);
    expect(stateColumns).toContain('persisted_instance_id');
    expect(stateColumns).toContain('persisted_sample_seq');
    expect(stateColumns).toContain('dropped_samples');

    // Verify secret_settings table
    const secretRes = db.exec('PRAGMA table_info(secret_settings)');
    expect(secretRes.length).toBe(1);
    const secretColumns = secretRes[0].values.map((row) => row[1] as string);
    expect(secretColumns).toContain('key');
    expect(secretColumns).toContain('nonce_b64');
    expect(secretColumns).toContain('cipher_b64');

    db.close();
  });

  it('Real SQLite WebAssembly Execution: Historical upgrade executes 0001~0003, inserts data, then migrates 0004 cleanly', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    const migrations = getMigrationFiles();

    // 1. Run 0001, 0002, 0003
    for (let i = 0; i < 3; i++) {
      db.run(migrations[i].sql);
    }

    // 2. Insert mock node with 0003 schema
    db.run(`
      INSERT INTO nodes (id, name, token_hash, created_at_ms, updated_at_ms)
      VALUES ('node-test-1', 'Tokyo Node', 'hash123', 1700000000000, 1700000000000)
    `);

    // 3. Apply 0004
    db.run(migrations[3].sql);

    // 4. Query migrated node
    const res = db.exec("SELECT id, name, plan_price, plan_currency, billing_cycle, auto_renewal FROM nodes WHERE id = 'node-test-1'");
    expect(res.length).toBe(1);
    const row = res[0].values[0];

    expect(row[0]).toBe('node-test-1');
    expect(row[1]).toBe('Tokyo Node');
    expect(row[2]).toBeNull(); // plan_price
    expect(row[3]).toBe('USD'); // plan_currency default
    expect(row[4]).toBe('monthly'); // billing_cycle default
    expect(row[5]).toBe(1); // auto_renewal default

    db.close();
  });
});
