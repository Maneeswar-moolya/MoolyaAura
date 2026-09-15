/**
 * Hermetic entry point for contract fixtures. The worker receives framework source
 * and freshly authored synthetic inputs only, never installed application artifacts.
 * Import this before modules that resolve application context at import time.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enterIsolatedArtefactRoot, leaveIsolatedArtefactRoot, removeFixtureTree } from '../projects/fixture-safety';

const SOURCE = path.resolve(__dirname, '../..');
if (process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  const worker = path.resolve(process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const relative = path.relative(os.tmpdir(), worker);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative)
    && path.basename(worker).startsWith('aura-contract-')
    && worker === path.resolve(process.cwd()), 'synthetic worker must be a guarded OS temporary checkout');
}
if (!process.env.AURA_SYNTHETIC_FIXTURE_ROOT && !process.argv.includes('--synthetic-only')) {
  const root = enterIsolatedArtefactRoot('aura-contract');
  let code = 1;
  try {
    assert.throws(() => removeFixtureTree(SOURCE), /outside the fixture root/);
    fs.cpSync(path.join(SOURCE, 'ai'), path.join(root, 'ai'), {
      recursive: true,
      filter: file => fs.statSync(file).isDirectory()
        ? !['recordings', 'reports', 'page', 'framework', 'quarantine', 'generations', 'runs'].includes(path.basename(file))
        : /\.(?:ts|mjs|js|css|html|md)$/.test(file),
    });
    for (const dir of ['tests-e2e/support', 'tests-e2e/generic'])
      fs.cpSync(path.join(SOURCE, dir), path.join(root, dir), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests-e2e/pages'), { recursive: true });
    fs.copyFileSync(path.join(SOURCE, 'tests-e2e/pages/base.page.ts'), path.join(root, 'tests-e2e/pages/base.page.ts'));
    for (const entry of fs.readdirSync(SOURCE, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.json')
          || entry.name.endsWith('.config.ts') || ['.gitignore', '.env.example'].includes(entry.name)))
        fs.copyFileSync(path.join(SOURCE, entry.name), path.join(root, entry.name));
    }
    fs.symlinkSync(path.join(SOURCE, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    const env = { ...process.env,
      AURA_SYNTHETIC_FIXTURE_ROOT: root, AURA_ARTEFACT_ROOT: root,
      AURA_REGISTRY_FILE: path.join(root, 'ai/projects/registry.json'),
      AURA_EXCEL_DIR: path.join(root, 'excel'), AURA_APPLICATION: 'fixtureapp',
      AURA_ENVIRONMENT: '', EXCEL_WORKBOOK: '', FORCE_COLOR: '0',
      FIXTUREAPP_EMAIL: 'contract@example.invalid', FIXTUREAPP_PASSWORD: 'synthetic-contract-password',
    };
    const run = (file: string, args: string[] = []) => spawnSync(process.execPath,
      [path.join(root, 'node_modules/tsx/dist/cli.mjs'), file, ...args],
      { cwd: root, env, stdio: 'inherit', timeout: 300_000, windowsHide: true });
    const seed = run(path.join(root, 'ai/testing/seed-project.ts'));
    assert.equal(seed.status, 0, String(seed.error ?? 'synthetic input construction failed'));
    const relative = path.relative(SOURCE, path.resolve(process.argv[1]));
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'fixture must belong to this checkout');
    const result = run(path.join(root, relative), process.argv.slice(2));
    const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    if (timedOut) console.error('Isolated fixture exceeded its 300000ms execution timeout.');
    else if (result.error) console.error(result.error);
    code = timedOut ? 124 : result.status ?? 1;
  } finally {
    removeFixtureTree(root);
    leaveIsolatedArtefactRoot();
  }
  process.exit(code);
}
