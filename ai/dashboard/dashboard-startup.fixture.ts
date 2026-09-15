import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { waitForFixtureHttp, stopFixtureProcess } from '../testing/process-fixture';
import { resetActiveScope } from '../projects/scope';
import { scopeFromSelection } from './scope-request';
import { activeApplicationId, applicationSlug } from '../knowledge/canonical';

async function main() {
  assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const registry = process.env.AURA_REGISTRY_FILE!;
  fs.writeFileSync(registry, JSON.stringify({ schemaVersion: 1, applications: [] }));
  process.env.AURA_APPLICATION = ''; process.env.AURA_ENVIRONMENT = ''; resetActiveScope();
  assert.throws(() => activeApplicationId(), /No applications are registered/, 'scoped identity fails clearly without an application');
  assert.throws(() => applicationSlug(), /No applications are registered/);
  const probe = http.createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as { port: number }).port; await new Promise<void>(r => probe.close(() => r()));
  const base = `http://127.0.0.1:${port}`;
  const request = async (route: string, body?: unknown) => {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  for (const phase of ['empty', 'multiple']) {
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/dashboard/server.ts'], {
      env: { ...process.env, EXCEL_DASHBOARD_PORT: String(port), AURA_APPLICATION: '', AURA_ENVIRONMENT: '' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    try {
      await waitForFixtureHttp(child, base + '/api/health', () => output);
      console.log(`PASS ${phase} registry dashboard starts without ambient application`);
      const projects = await request('/api/projects'); assert.equal(projects.status, 200);
      assert.equal(projects.body.projects.length, phase === 'empty' ? 0 : 2);
      const missing = await request('/api/record/start', { browser: 'chromium' });
      assert.equal(missing.status, 400, 'scoped HTTP operation refuses missing selection');
      assert.match(missing.body.error, phase === 'empty' ? /No applications/ : /application|Choose/i);
      if (phase === 'empty') {
        for (const id of ['north', 'south']) {
          const created = await request('/api/projects', { applicationId: id, displayName: id, environmentId: 'qa', baseUrl: `https://${id}.example.invalid/qa/` });
          assert.equal(created.status, 201, 'empty to first project onboarding succeeds');
        }
        const response = await fetch(base + '/api/projects/south/environments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'south', environmentId: 'staging', displayName: 'Staging', baseUrl: 'https://south.example.invalid/staging/' }) });
        assert.equal(response.status, 201);
        console.log('PASS empty to first project onboarding');
      }
    } finally { await stopFixtureProcess(child); }
  }
  process.env.AURA_APPLICATION = 'north'; process.env.AURA_ENVIRONMENT = 'qa'; resetActiveScope();
  const selected = scopeFromSelection({ applicationId: 'south', environmentId: 'staging' });
  assert.equal(selected.applicationId, 'south', 'request application selection'); assert.equal(selected.environmentId, 'staging', 'request environment selection');
  assert.equal(selected.baseUrl, 'https://south.example.invalid/staging/', 'request environment overrides ambient context');
  assert.throws(() => scopeFromSelection({}), /application|Choose/i, 'ambient application cannot supply missing request selection');
  console.log('PASS selected request resolves its application and environment; missing scope is refused');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
