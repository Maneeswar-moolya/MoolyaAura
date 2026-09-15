import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import ExcelJS from 'exceljs';
import { workspaceData } from '../testing/workspace-data';
import { waitForFixtureHttp, stopFixtureProcess } from '../testing/process-fixture';
import { resolveScope, resetActiveScope } from '../projects/scope';
import { readTestData, updateTestData } from '../test-data/store';

/**
 * GENERATING A NEWLY RECORDED CASE MUST NOT REQUIRE SELECTING AN EXISTING ONE.
 *
 * Two workflows were sharing one dialog. The Execution Data modal exists to run EXISTING
 * workbook cases, so it defaults its `testCaseIds` to the workbook checkbox selection and
 * `/api/test-data/preview` refuses an empty or unknown list with "Select test cases from
 * this application workbook." That rule is correct for execution. But it was also the only
 * way to hand a credential profile to GENERATION: the modal is what sets the selection the
 * save request forwards as `executionData`. So a person who had just recorded a brand new
 * case - which by definition is not in the workbook yet and is not checked anywhere - could
 * pick their profile and still be refused, for the absence of a case that has nothing to do
 * with the recording they made.
 *
 * The recording's own "Signing in as" selector is the right place to choose. Its profile ID
 * travels with the save, is bound to the ID the workbook actually assigned, and becomes the
 * credential selection for that generation's clean validation and mutation - once. It is not
 * a permanent binding: nothing is written to the case's Examples, and a later execution may
 * choose any profile it likes. Synthetic values only.
 */
const ACCOUNT = 'generation-profile@example.invalid';
const SECRET = 'synthetic-generation-password-4417';
const OTHER_ACCOUNT = 'second-profile@example.invalid';
const OTHER_SECRET = 'synthetic-second-password-9930';

async function main() {
  const { scope } = workspaceData();
  // Two environments: qa is the target, `second` exists so a profile can be bound to one
  // environment and not the other - the shape section 8 calls "supports target environment".
  const registryFile = process.env.AURA_REGISTRY_FILE!;
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  registry.applications[0].environments.second = { baseUrl: 'https://second.example.invalid/' };
  registry.applications[0].defaultSourceEnvironmentId = 'qa';
  fs.writeFileSync(registryFile, JSON.stringify(registry));
  resetActiveScope();
  const active = resolveScope({ applicationId: 'north', environmentId: 'qa' });

  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Cases');
  sheet.addRows([['Test Case ID', 'Scenario', 'Module', 'Steps', 'Expected Result', 'Run'],
    ['TC_EXIST', 'Existing case', 'Authoring', 'Open the page', 'Something is visible', 'Yes']]);
  await workbook.xlsx.writeFile('excel/north.xlsx');

  // Three profiles: usable, bound only to the other environment, and a second usable one
  // that proves a later execution is free to choose differently.
  let catalog = updateTestData(active, readTestData(active).version, {
    kind: 'credential',
    profile: { name: 'kspuserCommonLike', role: 'Tester', environments: { qa: { username: ACCOUNT, password: SECRET } } },
  } as any);
  catalog = updateTestData(active, catalog.version, {
    kind: 'credential',
    profile: { name: 'Other environment only', role: 'Tester', environments: { second: { username: OTHER_ACCOUNT, password: OTHER_SECRET } } },
  } as any);
  catalog = updateTestData(active, catalog.version, {
    kind: 'credential',
    profile: { name: 'Second tester', role: 'Tester', environments: { qa: { username: OTHER_ACCOUNT, password: OTHER_SECRET } } },
  } as any);
  const profile = catalog.credentialProfiles.find(p => p.name === 'kspuserCommonLike')!;
  const elsewhere = catalog.credentialProfiles.find(p => p.name === 'Other environment only')!;
  const second = catalog.credentialProfiles.find(p => p.name === 'Second tester')!;

  // ---- 0. THE HAND-OFF, in process, through the production derivation.
  //
  // Stop knows the profile but not the ID; Save knows the ID but has already consumed the
  // recording. This is the join, and it is the whole of section 3.
  {
    const { openRecordingCredentials, closeRecordingCredentials, retainRecordingForTest,
      keepArtifactFor, takeRecordedGenerationContext, parseRecording } = require('./recorder') as typeof import('./recorder');
    const { generationSelection } = require('../test-data/execution') as typeof import('../test-data/execution');
    const { recordingSource } = require('../testing/synthetic-data') as typeof import('../testing/synthetic-data');
    let checks0 = 0;
    const check0 = (name: string, run: () => void) => {
      try { run(); } catch (e: any) { throw new Error(`FAIL ${name}: ${e?.message ?? e}`); }
      checks0++; console.log('PASS ' + name);
    };
    const source = recordingSource([`await page.goto('https://portal.example.invalid/home');`,
      `await page.getByTestId('continue').click();`]);
    const recording = parseRecording(source, { startUrl: 'https://portal.example.invalid/home', browser: 'chromium',
      durationMs: 0, evidence: { available: false, reason: 'synthetic generation context contract' } as any });

    openRecordingCredentials(active, profile.id);
    retainRecordingForTest(source, recording, { scope: active, browser: 'chromium',
      startedAt: new Date(0).toISOString(), sourceEnvironmentId: 'qa' } as any);
    closeRecordingCredentials();
    keepArtifactFor('TC_RECGEN');

    check0('the profile chosen when recording started reaches the generation context', () => {
      const held = takeRecordedGenerationContext(active, 'TC_RECGEN');
      assert.ok(held, 'a context was stamped by the save');
      assert.equal(held!.credentialProfileId, profile.id);
      assert.equal(held!.testCaseId, 'TC_RECGEN', 'bound to the ID the workbook assigned');
      assert.equal(held!.sourceEnvironmentId, 'qa', 'and to the environment it was recorded against');
      assert.equal(held!.applicationId, 'north');
    });
    check0('the context is collected once, so no later save inherits it', () => {
      assert.equal(takeRecordedGenerationContext(active, 'TC_RECGEN'), null);
    });

    openRecordingCredentials(active, profile.id);
    retainRecordingForTest(source, recording, { scope: active, browser: 'chromium',
      startedAt: new Date(0).toISOString(), sourceEnvironmentId: 'qa' } as any);
    closeRecordingCredentials();
    keepArtifactFor('TC_RECGEN2');
    check0('another application cannot collect this application\'s generation context', () => {
      assert.equal(takeRecordedGenerationContext(resolveScope({ applicationId: 'south', environmentId: 'qa' }), 'TC_RECGEN2'), null);
      assert.equal(takeRecordedGenerationContext(active, 'TC_OTHER_CASE'), null, 'nor another case');
      assert.ok(takeRecordedGenerationContext(active, 'TC_RECGEN2'), 'the owner still can');
    });
    check0('a recording made with no profile hands over no credential claim', () => {
      openRecordingCredentials(active, undefined);
      retainRecordingForTest(source, recording, { scope: active, browser: 'chromium',
        startedAt: new Date(0).toISOString(), sourceEnvironmentId: 'qa' } as any);
      keepArtifactFor('TC_RECGEN3');
      assert.equal(takeRecordedGenerationContext(active, 'TC_RECGEN3')!.credentialProfileId, undefined);
      assert.equal(generationSelection(active, undefined), undefined,
        'and no selection is invented, so generation keeps the application binding it always had');
    });
    check0('the generation selection is ephemeral, single-profile and version-pinned', () => {
      const request = generationSelection(active, profile.id)!;
      assert.equal(request.mode, 'selected', 'never "examples" - an Example would outlive this attempt');
      assert.deepEqual(request.credentialProfileIds, [profile.id]);
      assert.equal(request.expectedVersion, readTestData(active).version);
      assert.equal(request.rows, undefined, 'nothing is written into the case');
    });
    console.log(`${checks0} generation context hand-off contracts passed`);
  }

  const probe = http.createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as any).port; await new Promise<void>(r => probe.close(() => r()));
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/dashboard/server.ts'],
    { env: { ...process.env, EXCEL_DASHBOARD_PORT: String(port), AURA_APPLICATION: '', AURA_ENVIRONMENT: '',
      AURA_EXECUTION_CONTEXT: '', AURA_EXECUTION_SELECTION: '', AURA_SOURCE_ENVIRONMENT: '' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  const base = `http://127.0.0.1:${port}`;
  const post = async (route: string, body: unknown) => {
    const r = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any };
  };
  const get = async (route: string) => { const r = await fetch(base + route); return { status: r.status, body: await r.json() as any }; };
  let checks = 0;
  const check = (name: string, run: () => void) => {
    try { run(); } catch (e: any) { throw new Error(`FAIL ${name}: ${e?.message ?? e}`); }
    checks++; console.log('PASS ' + name);
  };
  const saveNew = (scenario: string, extra: Record<string, unknown> = {}) => post('/api/case', {
    applicationId: 'north', environmentId: 'qa', sourceEnvironmentId: 'qa',
    browserEngine: 'chromium', headed: false,
    workbook: 'excel/north.xlsx', isNew: true,
    draft: { worksheet: 'Cases', scenario, module: 'Authoring', steps: 'Open the page',
      expectedResult: 'Something is visible', assertOutcome: '', assertMessage: '', priority: '', tags: '', run: true },
    ...extra,
  });
  const stopGenerator = async () => { try { await post('/api/autocode/stop', {}); } catch { /* nothing running */ } };

  try {
    await waitForFixtureHttp(child, base + '/api/health', () => logs);
    const version = (await get('/api/test-data?applicationId=north&environmentId=qa')).body.version as string;

    // ---- 1. THE EXECUTION-DATA RULE, which is correct and stays.
    const empty = await post('/api/test-data/preview', { applicationId: 'north', environmentId: 'qa',
      workbook: 'excel/north.xlsx', testCaseIds: [], selection: { mode: 'selected', credentialProfileIds: [profile.id], expectedVersion: version } });
    check('Execution Data still requires selected cases when run from Run Selected', () => {
      assert.equal(empty.status, 400);
      assert.match(String(empty.body.error), /Select test cases from this application workbook/);
    });
    const chosen = await post('/api/test-data/preview', { applicationId: 'north', environmentId: 'qa',
      workbook: 'excel/north.xlsx', testCaseIds: ['TC_EXIST'], selection: { mode: 'selected', credentialProfileIds: [profile.id], expectedVersion: version } });
    check('an existing selected case previews exactly as before', () => {
      assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
      assert.equal(chosen.body.count, 1);
      assert.equal(chosen.body.instances[0].profile.credentialProfileId, profile.id);
    });

    // ---- 2. GENERATION OF A NEW CASE: no checkbox, no modal, no existing case.
    const saved = await saveNew('Newly recorded case', { credentialProfileId: profile.id });
    check('a new case saves and generates with only a credential profile named', () => {
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.ok(saved.body.testCaseId, 'the response names the ID the workbook assigned');
      assert.equal(saved.body.autocode.started, true,
        `generation refused: ${saved.body.autocode.reason ?? ''}`);
    });
    check('no existing-case selection was required anywhere in that request', () => {
      assert.doesNotMatch(JSON.stringify(saved.body), /Select test cases from this application workbook/);
    });
    const savedId = saved.body.testCaseId as string;
    check('generation is bound to the ID the save produced, not one the user re-selects', () => {
      assert.equal(saved.body.autocode.executionProfile?.testCaseId, savedId);
    });
    check('the same credential profile reaches the generation execution context', () => {
      assert.equal(saved.body.autocode.executionProfile?.credentialProfileId, profile.id);
      assert.equal(saved.body.autocode.executionProfile?.credentialProfileName, 'kspuserCommonLike');
    });
    check('clean validation and mutation run under that one execution context', () => {
      const context = saved.body.autocode.executionContext;
      assert.equal(context.applicationId, 'north');
      assert.equal(context.environmentId, 'qa');
      assert.equal(context.sourceEnvironmentId, 'qa');
      assert.equal(context.browserEngine, 'chromium');
      assert.equal(typeof context.locatorTimeoutMs, 'number');
      assert.ok(context.locatorTimeoutMs > 0, 'the locator deadline travels with the attempt');
    });
    check('no credential value reaches the browser payload', () => {
      const text = JSON.stringify(saved.body);
      assert.ok(!text.includes(ACCOUNT), 'an account identifier reached the page');
      assert.ok(!text.includes(SECRET), 'a password reached the page');
    });
    check('the case is NOT permanently bound to the recording profile', () => {
      const store = readTestData(active);
      assert.equal(store.testCases[savedId]?.executionRows?.length ?? 0, 0,
        'a generation attempt must not write an Examples row pinning this case to one user');
      assert.equal(store.credentialProfiles.find(p => p.id === profile.id)!.references.length, 0);
    });
    await stopGenerator();

    // A selection left behind in the Execution Data dialog was made for OTHER cases and
    // persists in the page until it is cleared. It must not outrank the selector the person
    // has just used beside Record.
    const stale = await saveNew('Case saved with a stale dialog selection', {
      credentialProfileId: profile.id,
      executionData: { mode: 'selected', credentialProfileIds: [second.id], expectedVersion: readTestData(active).version },
    });
    check('the recording profile outranks a stale Execution Data selection', () => {
      assert.equal(stale.status, 200, JSON.stringify(stale.body));
      assert.equal(stale.body.autocode.executionProfile?.credentialProfileId, profile.id,
        'the profile chosen beside Record is the one this generation runs as');
    });
    await stopGenerator();
    // With no recording profile named, that dialog selection is still the only source, and
    // still works exactly as it did.
    const dialogOnly = await saveNew('Case saved from the dialog alone', {
      executionData: { mode: 'selected', credentialProfileIds: [second.id], expectedVersion: readTestData(active).version },
    });
    check('an Execution Data selection still drives a save that names no recording profile', () => {
      assert.equal(dialogOnly.status, 200, JSON.stringify(dialogOnly.body));
      assert.equal(dialogOnly.body.autocode.executionProfile?.credentialProfileId, second.id);
    });
    await stopGenerator();

    // ---- 3. PREFLIGHT. A named profile that cannot serve the target is refused, never swapped.
    const wrongEnvironment = await saveNew('Case with an unusable profile', { credentialProfileId: elsewhere.id });
    check('a profile that does not support the target environment refuses generation', () => {
      assert.equal(wrongEnvironment.status, 200, 'the workbook row is still committed');
      assert.equal(wrongEnvironment.body.autocode.started, false);
      assert.equal(wrongEnvironment.body.autocode.code, 'CREDENTIAL_CONFIGURATION_FAILURE');
    });
    check('and no other profile is silently substituted', () => {
      assert.equal(wrongEnvironment.body.autocode.executionProfile, undefined);
      assert.match(String(wrongEnvironment.body.autocode.reason), /CREDENTIAL_CONFIGURATION_FAILURE/);
    });
    const unknown = await saveNew('Case with an unknown profile', { credentialProfileId: 'cred_not_here' });
    check('an unknown profile refuses generation rather than falling back', () => {
      assert.equal(unknown.status, 200);
      assert.equal(unknown.body.autocode.started, false);
      assert.equal(unknown.body.autocode.code, 'CREDENTIAL_CONFIGURATION_FAILURE');
    });

    // ---- 4. A LATER EXECUTION IS FREE TO CHOOSE. The logical test is profile-independent.
    const override = await post('/api/test-data/preview', { applicationId: 'north', environmentId: 'qa',
      workbook: 'excel/north.xlsx', testCaseIds: [savedId],
      selection: { mode: 'selected', credentialProfileIds: [second.id], expectedVersion: readTestData(active).version } });
    check('the generated case may later be executed with a different profile', () => {
      assert.equal(override.status, 200, JSON.stringify(override.body));
      assert.equal(override.body.instances[0].profile.credentialProfileId, second.id);
    });
    const multi = await post('/api/test-data/preview', { applicationId: 'north', environmentId: 'qa',
      workbook: 'excel/north.xlsx', testCaseIds: [savedId],
      selection: { mode: 'selected', credentialProfileIds: [profile.id, second.id], expectedVersion: readTestData(active).version } });
    check('and with several profiles at once - existing multi-user execution is unchanged', () => {
      assert.equal(multi.status, 200, JSON.stringify(multi.body));
      assert.equal(multi.body.count, 2);
      assert.deepEqual(multi.body.instances.map((i: any) => i.profile.credentialProfileId).sort(),
        [profile.id, second.id].sort());
    });

    // ---- 5. ISOLATION.
    const foreign = await saveNew('Case with a foreign profile', { applicationId: 'south', credentialProfileId: profile.id });
    check('another application cannot borrow this application\'s profile', () => {
      assert.notEqual(foreign.body.autocode?.started, true);
    });

    console.log(`${checks} generation credential contracts passed`);
  } finally { await stopGenerator(); await stopFixtureProcess(child); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
