import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Package.json Scripts & Deployment Integrity', () => {
  const rootPkgPath = path.resolve(__dirname, '../../package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

  it('root package.json scripts should define all referenced pnpm scripts', () => {
    const scripts: Record<string, string> = rootPkg.scripts || {};
    expect(scripts['build:web']).toBe('pnpm --filter edgemon-web build');
    expect(scripts['build']).toBe('pnpm build:web');
    expect(scripts['db:migrate:remote']).toBe('wrangler d1 migrations apply DB --remote');
    expect(scripts['deploy']).toBe('pnpm db:migrate:remote && wrangler deploy');
  });

  it('wrangler.jsonc should have DB binding and required secrets', () => {
    const wranglerPath = path.resolve(__dirname, '../../wrangler.jsonc');
    const content = fs.readFileSync(wranglerPath, 'utf8');
    // Strip comments to parse JSON
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const wrangler = JSON.parse(stripped);

    expect(wrangler.d1_databases).toEqual([{ binding: 'DB' }]);
    expect(wrangler.secrets?.required).toEqual([
      'ADMIN_KEY',
      'SESSION_SECRET',
      'DATA_ENCRYPTION_KEY',
    ]);
  });
});
