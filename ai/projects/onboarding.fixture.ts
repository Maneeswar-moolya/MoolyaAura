/** Foundational onboarding gates. Real HTTP and Playwright, synthetic applications only.
 * Run: npx tsx ai/projects/onboarding.fixture.ts
 * All writes run in an OS temporary checkout without installed application artifacts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { enterIsolatedArtefactRoot, leaveIsolatedArtefactRoot, removeFixtureTree } from './fixture-safety';

const SOURCE = path.resolve(__dirname, '../..');
// Each mutant edits only the disposable framework copy. Require the intended gate
// to fail, not merely a nonzero exit (a syntax/import failure is not a mutation bite).
const MUTATIONS: Record<string, [string, string, string, string]> = {
  empty: ['ai/projects/registry.ts', '  return registry;\n}', "  if (!registry.applications.length) throw Error('empty rejected');\n  return registry;\n}", 'empty registry is valid'],
  layout: ['ai/projects/scope.ts', 'const flatLayout = application.legacyLayout === true;', 'const flatLayout = application.legacyLayout === true || soleApplication;', 'first application never inherits'],
  workbook: ['ai/projects/registry.ts', '  const key = normaliseWorkbook(workbook);\n  for (const application', '  if (registry.applications.length === 1) return registry.applications[0].applicationId;\n  const key = normaliseWorkbook(workbook);\n  for (const application', 'unlisted workbook never acquires'],
  state: ['ai/autocode/work.ts', '(JSON.parse(contents) as State)', "Object.fromEntries(Object.entries(JSON.parse(contents)).map(([key, value]) => [key.includes('/') ? key : scopedKey(activeScope().applicationId, key), value]))", 'unknown bare state remains unknown'],
  index: ['ai/knowledge/index.ts', "'framework.yaml', scope.flatLayout", "'framework.yaml', scope.soleApplication", 'derived index ownership is stable'],
  collection: ['tests-e2e/support/collection-scope.ts', '  // WHICH APPLICATION', '  if (registry.applications.length === 1) return [];\n  // WHICH APPLICATION', 'collection isolates identical IDs'],
  discovery: ['ai/excel/mapping.ts', ' && canReadSuiteFile(full)', '', 'A cannot discover B specs'],
  generic: ['tests-e2e/generic/generic.spec.ts', "import { expect, baseTest as test, trace } from '../support/base-fixtures';", "import { expect, test, trace } from '../fixtures';", 'generic runtime has no FixturePortal files'],
  mutation_guard: ['tests-e2e/support/base-fixtures.ts', 'allowed !== true', "process.env.FIXTUREAPP_ALLOW_DATA_MUTATION !== '1'", 'shared mutation guard cannot borrow'],
};
let failures = 0;
async function check(name: string, body: () => unknown | Promise<unknown>): Promise<void> {
  try { await body(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
function write(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}
async function run(args: string[], cwd: string, env = process.env): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolve({ code, output }));
  });
}
async function worker(): Promise<void> {
  const root = process.cwd();
  const relative = path.relative(os.tmpdir(), root);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    && path.basename(root).startsWith('aura-onboarding-'), 'worker requires an OS temporary checkout');
  assert.equal(process.env.AURA_ARTEFACT_ROOT, root);
  assert.equal(process.env.AURA_REGISTRY_FILE, path.join(root, 'ai/projects/registry.json'));
  assert.equal(process.env.AURA_EXCEL_DIR, path.join(root, 'excel'));
  const { validateRegistry, readRegistry, workbookOwner } = await import('./registry');
  const { resolveScope, resetActiveScope, scopedKey } = await import('./scope');
  const { readState } = await import('../autocode/work');
  const { buildIndex, writeIndex } = await import('../knowledge/index');
  const { scanSpecs } = await import('../excel/mapping');
  const registryFile = process.env.AURA_REGISTRY_FILE!;
  const app = (applicationId: string, legacyLayout = false) => ({ applicationId, displayName: applicationId,
    defaultEnvironmentId: 'qa', environments: { qa: { baseUrl: 'http://127.0.0.1/' } },
    workbooks: [`excel/${applicationId}-test-cases.xlsx`], legacyLayout });
  const registry = (ids: string[]) => ({ schemaVersion: 1 as const, applications: ids.map(id => app(id)) });
  const select = (ids: string[], id = ids[0]) => {
    write(registryFile, JSON.stringify(registry(ids)));
    process.env.AURA_APPLICATION = id || '';
    resetActiveScope();
  };
  select([]);
  await check('empty registry is valid and scope explains onboarding', () => {
    assert.equal(validateRegistry(registry([])).applications.length, 0);
    assert.throws(() => resolveScope({}, registry([])), /No applications|no applications/);
  });
  for (const file of ['tests-e2e/pages/unrelated.page.ts', 'ai/knowledge/page/unrelated.yaml',
    'ai/dashboard/recordings/TC_SAME.spec.ts', 'tests-e2e/generated/TC_SAME.spec.ts',
    'ai/test-mapping/mapping.json', 'tests-e2e/fixtures.ts', 'ai/knowledge/framework/framework.yaml'])
    write(path.join(root, file), '// unrelated flat artifact');
  await check('first application never inherits unrelated flat artifacts', () => {
    const scope = resolveScope({ applicationId: 'alpha' }, registry(['alpha']));
    assert.equal(scope.flatLayout, false);
    for (const file of Object.values(scope.paths)) assert.equal(fs.existsSync(file), false, file);
    assert.deepEqual(scanSpecs(scope.paths.generatedDir), []);
  });
  await check('ownership paths stable on addition and removal', () => {
    const original = resolveScope({ applicationId: 'alpha' }, registry(['alpha'])).paths;
    for (const ids of [['alpha', 'beta'], ['gamma', 'alpha', 'beta'], ['alpha']])
      assert.deepEqual(resolveScope({ applicationId: 'alpha' }, registry(ids)).paths, original);
  });
  await check('unlisted workbook never acquires an owner at any size', () => {
    for (const ids of [[], ['alpha'], ['alpha', 'beta'], ['beta']])
      assert.throws(() => workbookOwner('excel/unrelated.xlsx', registry(ids)), /No application/);
    assert.equal(workbookOwner('excel/alpha-test-cases.xlsx', registry(['alpha'])), 'alpha');
  });
  await check('only explicitly declared legacy layout survives registry changes', () => {
    for (const others of [[], [app('beta')]]) {
      const scope = resolveScope({ applicationId: 'alpha' }, { schemaVersion: 1, applications: [app('alpha', true), ...others] });
      assert.equal(scope.flatLayout, true);
      assert.equal(scope.paths.fixturesFile, path.join(root, 'tests-e2e/fixtures.ts'));
    }
  });
  await check('unknown bare state remains unknown; identical case IDs remain separate', () => {
    const state = { TC_SAME: { status: 'accepted' }, 'alpha/TC_SAME': { status: 'failed' }, 'beta/TC_SAME': { status: 'accepted' } };
    const file = path.join(root, 'unknown-state.json'); write(file, JSON.stringify(state));
    for (const ids of [['alpha'], ['alpha', 'beta'], ['beta']]) {
      select(ids);
      assert.deepEqual(readState(file), state);
    }
    assert.notEqual(scopedKey('alpha', 'TC_SAME'), scopedKey('beta', 'TC_SAME'));
  });
  await check('derived index ownership is stable at one and several applications', () => {
    select(['alpha']); const first = writeIndex(buildIndex()).file;
    select(['alpha', 'beta']); assert.equal(writeIndex(buildIndex()).file, first);
    assert.match(first, /alpha/);
    assert.equal(fs.readFileSync(path.join(root, 'ai/knowledge/framework/framework.yaml'), 'utf8'), '// unrelated flat artifact');
  });
  await check('A cannot discover B specs or Page Objects, including after removal', () => {
    write(path.join(root, 'tests-e2e/generated/beta/TC_SAME.spec.ts'), "test('TC_SAME - beta', () => {});");
    write(path.join(root, 'tests-e2e/pages/beta/foreign.page.ts'), 'export class ForeignPage { secret() {} }');
    for (const ids of [['alpha', 'beta'], ['alpha']]) {
      select(ids); const scope = resolveScope({ applicationId: 'alpha' });
      assert.deepEqual(scanSpecs(scope.paths.generatedDir), []);
      assert.deepEqual(scanSpecs(path.join(root, 'tests-e2e/generated/beta')), []);
      assert.equal(buildIndex(scope).pages.ForeignPage, undefined);
    }
  });

  // Use the dashboard's real route, including validation and workbook creation.
  select([]);
  const portProbe = http.createServer();
  await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = (portProbe.address() as any).port;
  await new Promise<void>(resolve => portProbe.close(() => resolve()));
  const server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'ai/dashboard/server.ts')],
    { cwd: root, env: { ...process.env, AURA_APPLICATION: '', EXCEL_DASHBOARD_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = ''; server.stdout.on('data', b => serverLog += b); server.stderr.on('data', b => serverLog += b);
  const url = `http://127.0.0.1:${port}`;
  try {
    await check('dashboard empty -> first -> second -> third via HTTP', async () => {
      let ready = false;
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && server.exitCode === null) {
        try { ready = (await fetch(url + '/api/health')).ok; } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(ready, `Dashboard readiness timed out (exit ${server.exitCode}): ${serverLog}`);
      const empty = await fetch(url + '/api/projects'); assert.equal(empty.status, 200);
      assert.deepEqual((await empty.json() as any).projects, []);
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(url);
        await page.waitForFunction(() => document.querySelector('#workbookNote')?.textContent?.includes('No applications yet'));
        assert.equal(await page.locator('#project option').count(), 0);
        assert.equal(await page.locator('#addProjectOpen').isEnabled(), true);
      } finally { await browser.close(); }
      const post = (payload: unknown) => fetch(url + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      assert.equal((await post({ applicationId: '../escape', displayName: 'invalid', baseUrl: 'bad' })).status, 400);
      assert.equal(readRegistry().applications.length, 0);
      for (const [index, id] of ['alpha', 'beta', 'gamma'].entries()) {
        const res = await post({ applicationId: id, displayName: id, environmentId: 'qa', baseUrl: 'http://127.0.0.1/' });
        assert.equal(res.status, 201, `POST ${id}: ${res.status} ${await res.text()}`);
        assert.equal(readRegistry().applications.length, index + 1);
        assert.ok(fs.existsSync(path.join(root, `excel/${id}-test-cases.xlsx`)));
        const listed = await fetch(url + `/api/workbooks?applicationId=${id}`);
        const body = await listed.json() as any;
        assert.deepEqual(body.workbooks, [`excel/${id}-test-cases.xlsx`]);
      }
    });
  } finally { server.kill(); await new Promise<void>(resolve => server.exitCode !== null ? resolve() : server.once('exit', () => resolve())); }

  // Collection uses real Playwright and identical titles, with foreign flat/scoped canaries.
  const { collectionIgnoreFor } = await import('../../tests-e2e/support/collection-scope');
  write(path.join(root, 'collection.config.ts'), "import { collectionIgnoreFor } from './tests-e2e/support/collection-scope'; export default { testDir: './tests-e2e', testIgnore: collectionIgnoreFor(), reporter: 'list' };");
  // The unrelated flat fixture is a canary above; remove it in this disposable runtime.
  fs.unlinkSync(path.join(root, 'tests-e2e/fixtures.ts'));
  write(path.join(root, 'tests-e2e/generated/TC_SAME.spec.ts'), "import { test } from '@playwright/test'; test('TC_SAME - unrelated', () => { throw Error('foreign flat execution'); });");
  for (const id of ['alpha', 'beta']) write(path.join(root, `tests-e2e/generated/${id}/TC_SAME.spec.ts`),
    `import { test, expect } from '@playwright/test'; test('TC_SAME - ${id}', () => expect(process.env.AURA_APPLICATION).toBe('${id}'));`);
  await check('collection isolates identical IDs at one, two and removed-app cardinalities', async () => {
    for (const [ids, id] of [[['alpha'], 'alpha'], [['alpha', 'beta'], 'beta'], [['alpha', 'beta'], 'alpha']] as [string[], string][]) {
      select(ids, id);
      assert.ok(collectionIgnoreFor().length);
      const result = await run([path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'collection.config.ts', '--grep', 'TC_SAME', '--workers=1'], root);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /1 passed/);
    }
  });
  await check('legacy collection excludes leftover scoped artifacts of removed applications', async () => {
    write(registryFile, JSON.stringify({ schemaVersion: 1, applications: [app('alpha', true)] })); resetActiveScope();
    const ignored = collectionIgnoreFor();
    assert.ok(ignored.includes('tests-e2e/generated/beta/**'), JSON.stringify(ignored));
    assert.equal(scanSpecs(path.join(root, 'tests-e2e/generated')).some(entry => entry.testFile.includes('/beta/')), false);
  });
  await check('shared mutation guard cannot borrow FixturePortal opt-in', async () => {
    select(['alpha']);
    write(path.join(root, 'tests-e2e/generic/guard.spec.ts'), `import { baseTest as test, requireDataMutationOptIn } from '../support/base-fixtures';
      test('TC_GUARD - default deny', () => { requireDataMutationOptIn(); throw Error('unauthorised mutation'); });
      test('TC_GUARD - explicit allow', () => { requireDataMutationOptIn(true); });`);
    const result = await run([path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'collection.config.ts', '--grep', 'TC_GUARD', '--workers=1'], root,
      { ...process.env, FIXTUREAPP_ALLOW_DATA_MUTATION: '1' });
    assert.equal(result.code, 0, result.output); assert.match(result.output, /1 skipped/); assert.match(result.output, /1 passed/);
  });
  await check('generic runtime has no FixturePortal files or fixture dependency', async () => {
    select(['alpha']);
    assert.equal(fs.existsSync(path.join(root, 'tests-e2e/fixtures.ts')), false);
    const { writeCache } = await import('../excel/data-driven');
    writeCache({ schemaVersion: 1, workbook: 'alpha-test-cases.xlsx', workbookPath: path.join(root, 'excel/alpha-test-cases.xlsx'),
      generatedAt: new Date().toISOString(), rejected: [], cases: [{ testCaseId: 'TC_GENERIC', module: 'Synthetic', scenario: 'isolated form',
        worksheet: 'Cases', row: 2, inputs: { Name: { kind: 'literal', value: 'example' }, submit: { kind: 'literal', value: 'Submit' } },
        outcome: 'Error', message: { kind: 'contains', text: 'Rejected' }, expectedResult: 'Rejected' }] } as any);
    const form = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<label>Name<input></label><button onclick="document.querySelector(\'aside\').textContent=\'Rejected\'">Submit</button><aside role="alert"></aside>');
    });
    await new Promise<void>(resolve => form.listen(0, '127.0.0.1', resolve));
    const declared = registry(['alpha']); declared.applications[0].environments.qa.baseUrl = `http://127.0.0.1:${(form.address() as any).port}/`;
    write(registryFile, JSON.stringify(declared)); resetActiveScope();
    try {
      const result = await run([path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'collection.config.ts', '--grep', 'TC_GENERIC', '--workers=1'], root);
      assert.equal(result.code, 0, result.output); assert.match(result.output, /1 passed/);
    } finally { await new Promise<void>(resolve => form.close(() => resolve())); }
  });
  console.log(`Onboarding failures: ${failures}`);
  process.exitCode = failures ? 1 : 0;
}

async function main(): Promise<void> {
  if (process.argv.includes('--worker')) return worker();
  if (process.argv.includes('--mutations')) {
    for (const [name, [, , , gate]] of Object.entries(MUTATIONS)) {
      const result = await run([path.join(SOURCE, 'node_modules/tsx/dist/cli.mjs'), __filename], SOURCE,
        { ...process.env, AURA_ONBOARDING_MUTANT: name });
      const bites = result.code !== 0 && result.output.includes(`FAIL ${gate}`);
      console.log(`${bites ? 'KILLED' : 'SURVIVED'} ${name}: ${gate}`);
      if (!bites) { failures++; console.error(result.output); }
    }
    process.exitCode = failures ? 1 : 0;
    return;
  }
  const root = enterIsolatedArtefactRoot('aura-onboarding');
  try {
    assert.throws(() => removeFixtureTree(SOURCE), /outside the fixture root/);
    // Copy framework source only. No application Page Objects, fixtures, knowledge,
    // recordings, mappings, workbooks or environment credentials are installed.
    for (const dir of ['ai', 'tests-e2e/support', 'tests-e2e/generic']) {
      fs.cpSync(path.join(SOURCE, dir), path.join(root, dir), { recursive: true, filter: file => {
        if (fs.statSync(file).isDirectory()) return !['recordings', 'reports', 'page', 'framework'].includes(path.basename(file));
        return file.endsWith('.ts') || file.endsWith('index.html');
      } });
    }
    fs.symlinkSync(path.join(SOURCE, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    if (process.env.AURA_ONBOARDING_MUTANT) {
      const mutation = MUTATIONS[process.env.AURA_ONBOARDING_MUTANT];
      assert.ok(mutation, 'unknown mutant');
      const [file, before, after] = mutation;
      const target = path.join(root, file);
      const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
      assert.ok(source.includes(before), `mutation anchor missing: ${file}`);
      fs.writeFileSync(target, source.split(before).join(after));
    }
    const result = await run([path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'ai/projects/onboarding.fixture.ts'), '--worker'], root,
      { ...process.env, AURA_ARTEFACT_ROOT: root, AURA_REGISTRY_FILE: path.join(root, 'ai/projects/registry.json'), AURA_EXCEL_DIR: path.join(root, 'excel'), AURA_APPLICATION: '', AURA_ENVIRONMENT: '', EXCEL_WORKBOOK: '', FORCE_COLOR: '0' });
    console.log(result.output); process.exitCode = result.code ?? 1;
  } finally { leaveIsolatedArtefactRoot(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
