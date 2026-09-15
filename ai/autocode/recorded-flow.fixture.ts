import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import ExcelJS from 'exceljs';
import { run } from './orchestrate';
import { credentials } from '../../tests-e2e/support/env';
import fs from 'node:fs';
import path from 'node:path';
import { writeFixtureFile, recordingSource, targetEvidence } from '../testing/synthetic-data';
import { activeScope, resetActiveScope } from '../projects/scope';
import { resolveExecutionContext } from '../projects/execution-context';
import { resetActiveApplication } from '../knowledge/canonical';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording, pageObjectRequirements, generateFromRecording } from './from-recording';
import { analyseCorpus } from './abstraction/propose';
import { applyProposals } from './abstraction/writer';
import { decideLifecycle } from './abstraction/lifecycle';
import { revalidate } from './abstraction/semantic';
import { classify } from './abstraction/classify';
import type { TestCase } from '../excel/types';

// No customer inputs, provider or remote browser. Both applications live in the guarded worker.
writeFixtureFile('ai/projects/registry.json', JSON.stringify({ schemaVersion: 1, applications:
  ['north', 'south'].map(applicationId => ({ applicationId, displayName: applicationId,
    defaultEnvironmentId: 'qa', environments: { qa: { baseUrl: 'https://portal.example.invalid/access',
      credentials: { email: `${applicationId.toUpperCase()}_EMAIL`, password: `${applicationId.toUpperCase()}_PASSWORD` } } },
    workbooks: [`excel/${applicationId}.xlsx`] })) }));
process.env.AURA_APPLICATION = 'north'; process.env.AURA_ENVIRONMENT = 'qa';
resetActiveScope(); resetActiveApplication();
const scope = activeScope();
const email = `page.getByRole('textbox', { name: 'Account' })`;
const password = `page.getByLabel('Secret')`;
const submit = `page.getByRole('button', { name: 'Continue', exact: true })`;
const heading = `page.getByTestId('overview-title')`;
const targets = [
  targetEvidence(email, { route: '/access', documentId: 'login-doc', elementRef: 'login-doc:1',
    target: { tag: 'input', type: 'email', accessibleName: 'Account', accessibleNameVerified: true } }),
  targetEvidence(password, { route: '/access', documentId: 'login-doc', elementRef: 'login-doc:2',
    target: { tag: 'input', type: 'password', accessibleName: 'Secret', accessibleNameVerified: true } }),
  targetEvidence(submit, { route: '/access', documentId: 'login-doc', elementRef: 'login-doc:3',
    target: { tag: 'button', type: 'submit', accessibleName: 'Continue', accessibleNameVerified: true } }),
  targetEvidence(heading, { route: '/overview', documentId: 'overview-doc', elementRef: 'overview-doc:1',
    target: { tag: 'h1', text: 'Overview', accessibleName: 'Overview', accessibleNameVerified: true,
      data: { 'data-testid': 'overview-title' } } }),
];
const evidence: any = { available: true, capturedAt: new Date(0).toISOString(), limits: {}, targets,
  origin: { applicationId: 'north', environmentId: 'qa', baseUrl: 'https://portal.example.invalid/access' } };
const source = recordingSource([
  `await page.goto('https://portal.example.invalid/access'); // @aura-navigation intentional`,
  `await ${email}.fill('discard@example.invalid');`,
  `await ${password}.fill('[type=password]');`,
  `await ${submit}.click();`,
  `await page.goto('https://identity.example.invalid/saml?SAMLResponse=DO_NOT_LEAK'); // @aura-navigation observed`,
  `await page.goto('https://portal.example.invalid/overview'); // @aura-navigation observed`,
  `await expect(${heading}).toContainText('Overview');`,
]);
const id = 'TC_AUTH_FLOW';
const relative = (file: string) => path.relative(process.cwd(), file);
writeFixtureFile(relative(path.join(scope.paths.recordingsDir, `${id}.spec.ts`)), source);
writeFixtureFile(relative(path.join(scope.paths.recordingsDir, `${id}.evidence.json`)), JSON.stringify(evidence));
let failures = 0;
function check(name: string, run: () => void) {
  try { run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
const corpus = analyseCorpus();
const proposals = corpus.proposals.filter(p => p.testCaseId === id);
check('assertion heading bootstraps deterministically', () => {
  const p = proposals.find(p => p.role === 'assertion')!;
  assert.equal(p?.status, 'PROPOSED'); assert.equal(p.owner, 'OverviewPage');
  assert.equal(p.bootstrap?.canonicalId, 'north__overview');
});
check('missing assertion identity is refused', () => {
  assert.notEqual(classify({ ...targets[3], derivedCandidates: [] }, 'assertion').category, 'METHOD');
  assert.notEqual(classify({ ...targets[3], derivedCandidates: targets[3].derivedCandidates!.map(p => ({ ...p, sameDocument: false })) }, 'assertion').category, 'METHOD');
});
check('semantic review accepts only the proven bootstrap owner', () => {
  const p: any = { ...proposals.find(p => p.role === 'assertion'), status: 'NEEDS_REVIEW',
    method: null, refusalCodes: [{ code: 'UNCLASSIFIED_TARGET', class: 'SEMANTIC', detail: 'classify target' }] };
  const answer: any = { decision: 'CREATE_PAGE_OBJECT', owner: 'OverviewPage', methodName: 'overviewState',
    usage: 'assertion', textKind: 'LABEL', confidence: 0.95, reasoning: 'A proven heading', locatorTemplate: p.template };
  assert.equal(revalidate(p, 'UNCLASSIFIED_TARGET', answer).accepted, true);
  assert.equal(revalidate({ ...p, bootstrap: undefined }, 'UNCLASSIFIED_TARGET', answer).accepted, false);
  assert.equal(revalidate({ ...p, proof: null }, 'UNCLASSIFIED_TARGET', answer).accepted, false);
  assert.equal(revalidate({ ...p, bootstrap: { ...p.bootstrap, canonicalId: 'south__overview' } }, 'UNCLASSIFIED_TARGET', answer).accepted, false);
  assert.equal(revalidate(p, 'UNCLASSIFIED_TARGET', { ...answer, owner: 'ForeignPage' }).accepted, false);
});
const writes = applyProposals(proposals);
const recording = parseRecording(source, { startUrl: '', browser: 'chromium', durationMs: 0, evidence });
const mapped = mapRecording(recording);
const code = mapped.steps.flatMap(s => s.code).join('\n');
check('authentication composes proven non-LoginPage controls', () => {
  assert.equal(mapped.unresolved.length, 0); assert.equal(mapped.needsReview.length, 0);
  assert.match(code, /accessPage\./); assert.match(code, /fill\(appCredentials.email\)/);
  assert.match(code, /fill\(appCredentials.password\)/); assert.match(code, /\.click\(\)/);
  assert.doesNotMatch(code, /loginPage|discard@example|\[type=password\]/);
});
check('deliberate navigation retained and redirects never replayed', () => {
  assert.equal((code.match(/page.goto/g) ?? []).length, 1); assert.match(code, /portal.example.invalid\/access/);
  assert.doesNotMatch(JSON.stringify(mapped.steps), /DO_NOT_LEAK|SAMLResponse|identity.example/);
});
check('intentional navigation cannot emit session-bearing destinations', () => {
  const unsafe = source.replace('portal.example.invalid/access', 'portal.example.invalid/access?arbitrary=DO_NOT_LEAK');
  const result = mapRecording(parseRecording(unsafe, { startUrl: '', browser: '', durationMs: 0, evidence }));
  assert.ok(result.needsReview.length); assert.doesNotMatch(JSON.stringify(result.steps), /DO_NOT_LEAK/);
});
check('navigation is excluded from element lifecycle', () => {
  assert.equal(pageObjectRequirements(mapped).length, 0);
  const decisions = decideLifecycle({ testCaseId: id, generationId: 'synthetic', timestamp: '', mapping: mapped,
    proposals, unmeasured: corpus.unmeasured, writes: writes.results });
  assert.equal(decisions.length, 4); assert.ok(decisions.every(d => !d.from.startsWith('navigate') && d.from !== 'recorded sign-in'));
});
check('bootstrap creates scoped class and next pass reuses it', () => {
  assert.ok(fs.existsSync(path.join(scope.paths.pagesDir, 'overview.page.ts')));
  assert.ok(mapped.reused.some(p => p.pageObject === 'OverviewPage'));
  assert.ok(!analyseCorpus().proposals.some(p => p.testCaseId === id && p.status === 'PROPOSED'));
});
check('unproven or foreign authentication cannot use credentials', () => {
  for (const invalid of [ { ...evidence, targets: [] }, { ...evidence, origin: { ...evidence.origin, applicationId: 'south' } } ]) {
    const bad = mapRecording(parseRecording(source, { startUrl: '', browser: '', durationMs: 0, evidence: invalid }));
    assert.ok(bad.unresolved.length || bad.needsReview.length);
    assert.doesNotMatch(bad.steps.flatMap(s => s.code).join('\n'), /appCredentials\.(email|password)/);
  }
});
check('runtime credentials stay application scoped', () => {
  process.env.NORTH_EMAIL = 'north@example.invalid'; process.env.NORTH_PASSWORD = 'north-secret';
  process.env.SOUTH_EMAIL = 'south@example.invalid'; process.env.SOUTH_PASSWORD = 'south-secret';
  assert.equal(credentials()?.email, 'north@example.invalid');
  const registry = JSON.parse(fs.readFileSync('ai/projects/registry.json', 'utf8'));
  registry.applications[0].environments.alternate = { baseUrl: 'https://alternate.example.invalid/access',
    credentials: { email: 'NORTH_ALTERNATE_EMAIL', password: 'NORTH_ALTERNATE_PASSWORD' } };
  writeFixtureFile('ai/projects/registry.json', JSON.stringify(registry));
  process.env.NORTH_ALTERNATE_EMAIL = 'alternate@example.invalid'; process.env.NORTH_ALTERNATE_PASSWORD = 'alternate-secret';
  process.env.AURA_ENVIRONMENT = 'alternate'; resetActiveScope(); resetActiveApplication();
  assert.equal(credentials()?.email, 'alternate@example.invalid');
  delete process.env.NORTH_ALTERNATE_PASSWORD;
  assert.equal(credentials(), null, 'missing environment credential never falls back');
  process.env.AURA_ENVIRONMENT = 'qa'; resetActiveScope(); resetActiveApplication();
  process.env.AURA_APPLICATION = 'south'; resetActiveScope(); resetActiveApplication();
  assert.equal(credentials()?.email, 'south@example.invalid');
  process.env.AURA_APPLICATION = 'north'; resetActiveScope(); resetActiveApplication();
});
check('missing assertion evidence blocks its emitted claim', () => {
  const missing = mapRecording(parseRecording(source, { startUrl: '', browser: '', durationMs: 0,
    evidence: { ...evidence, targets: targets.slice(0, 3) } }));
  assert.ok(missing.needsReview.some(s => s.from.startsWith('assert')));
  assert.ok(!missing.steps.some(s => s.code.some(line => line.includes('expect('))));
});
check('old navigation fails honestly without leaking transient URLs', () => {
  const legacy = source.replace(/ \/\/ @aura-navigation (intentional|observed)/g, '');
  const bad = mapRecording(parseRecording(legacy, { startUrl: '', browser: '', durationMs: 0, evidence }));
  assert.ok(bad.needsReview.length); assert.doesNotMatch(JSON.stringify(bad.steps), /DO_NOT_LEAK|SAMLResponse/);
  assert.doesNotMatch(bad.steps.flatMap(s => s.code).join('\n'), /page.goto/);
});
check('blocked mapping retains evidence and never writes a guessed spec', () => {
  const legacy = source.replace(/ \/\/ @aura-navigation (intentional|observed)/g, '');
  writeFixtureFile(relative(path.join(scope.paths.recordingsDir, `${id}.spec.ts`)), legacy);
  const result = generateFromRecording({ testCaseId: id } as TestCase, 'tests-e2e/generated/north/blocked.spec.ts', 'excel/north.xlsx');
  assert.equal(result.assembled, false); assert.ok(result.mapping?.evidence?.available);
  assert.equal(result.mapping?.evidence?.available && result.mapping.evidence.targets.length, 4);
  assert.ok(!fs.existsSync('tests-e2e/generated/north/blocked.spec.ts'));
});
async function integration() {
  // Execute the generated operations, including async locator getters, without a server.
  const calls: string[] = [];
  const controls = mapped.steps.filter(s => s.pageObject === 'AccessPage');
  const pageObject = Object.fromEntries(controls.map(s => [s.method!, async () => ({
    fill: async (value: string) => { calls.push(value); }, click: async () => { calls.push('submit'); },
  })]));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('accessPage', 'appCredentials', controls.flatMap(s => s.code).join('\n'))(
    pageObject, { email: 'scoped-account', password: 'scoped-secret' });
  assert.deepEqual(calls, ['scoped-account', 'scoped-secret', 'submit'], 'Composed auth executes asynchronous controls');
  console.log('PASS composed auth executes asynchronous controls');
  // An arbitrary composite name is reusable only if its entire body is the same proven sequence.
  const file = path.join(scope.paths.pagesDir, 'access.page.ts');
  const before = fs.readFileSync(file, 'utf8');
  const method = `  async authenticateAccount(account: string, secret: string): Promise<void> { await (await this.${controls[0].method}()).fill(account); await (await this.${controls[1].method}()).fill(secret); await (await this.${controls[2].method}()).click(); }`;
  fs.writeFileSync(file, before.replace(/}\s*$/, method + '\n}\n'));
  const composite = mapRecording(recording);
  assert.ok(composite.steps.some(s => s.method === 'authenticateAccount'), 'Arbitrary proven composite is reused');
  assert.equal(decideLifecycle({ testCaseId: id, generationId: 'composite', timestamp: '', mapping: composite,
    proposals, unmeasured: [], writes: writes.results }).length, 4, 'Composite retains underlying element lifecycle');
  fs.writeFileSync(file, before.replace(/}\s*$/, method.replace('fill(account)', "fill('wrong-account')") + '\n}\n'));
  assert.ok(!mapRecording(recording).steps.some(s => s.method === 'authenticateAccount'), 'Unproven composite body is never reused');
  fs.writeFileSync(file, before);
  console.log('PASS arbitrary proven composite and underlying element lifecycle');
  // A provider trap makes the REAL orchestration boundary falsifiable without runtime AI.
  const trap = writeFixtureFile('ai/testing/provider-trap.cjs', `require('fs').writeFileSync('provider-called', 'unexpected'); process.exit(90);`);
  process.env.CLAUDE_CLI = trap;
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Cases');
  sheet.addRow(['Test Case ID', 'Scenario', 'Steps', 'Expected Result', 'Tags', 'Automation Status']);
  sheet.addRow([id, 'Authenticate and inspect overview', 'Open entry page\nEnter account\nEnter password\nSubmit\nCheck overview', 'Overview is visible', 'recorded,signed-in', 'Not Automated']);
  await workbook.xlsx.writeFile('excel/north.xlsx');
  const messages: string[] = [];
  // Intercept the actual provider spawn: a .cjs file is not executable on Windows.
  const originalSpawn = childProcess.spawn;
  let providerCalled = false;
  childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
    if (args[0] === trap) { providerCalled = true; throw new Error('Provider trap'); }
    return originalSpawn(...args);
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  // THE NEGATIVE FIRST, on the state this fixture's own setup created. `runtime credentials
  // stay application scoped` added a second environment to north and left it there, so the
  // application now has two and declares no default source - exactly what production must
  // refuse. Asserted here rather than tolerated, because the refusal arriving later as an
  // unexplained crash is what made this fixture look broken.
  let spawnedDuringRefusal = 0;
  const spawnDuringRefusal = childProcess.spawn;
  childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
    spawnedDuringRefusal += 1; return spawnDuringRefusal(...args);
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  try {
    await assert.rejects(
        () => run({ workbook: 'excel/north.xlsx', onlyIds: [id], createPageObjects: false, onLog: () => {} }),
        /SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE/,
        'two environments, no default and no explicit source must fail closed');
  } finally { childProcess.spawn = spawnDuringRefusal; syncBuiltinESMExports(); }
  assert.equal(spawnedDuringRefusal, 0, 'a refused source environment must not start any child process or browser');
  console.log('PASS orchestration fails closed on an unselected source environment before any child starts');

  // This scenario is about deterministic orchestration, not environment selection, so it
  // states its source explicitly - through the same resolveExecutionContext the product
  // uses, with this synthetic application's own environment id, never an ambient variable.
  const executionContext = resolveExecutionContext(activeScope(), { sourceEnvironmentId: 'qa' });
  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run({ workbook: 'excel/north.xlsx', onlyIds: [id], createPageObjects: false, executionContext, onLog: text => messages.push(text) });
  } finally {
    childProcess.spawn = originalSpawn; syncBuiltinESMExports();
    assert.equal(providerCalled, false, 'Deterministic failure never calls generic AI');
  }
  assert.ok(!fs.existsSync('provider-called'), 'Deterministic failure never calls generic AI');
  assert.ok(messages.join('').includes('BLOCKED (navigationCausality)'), 'Orchestration reports the actual deterministic block');
  assert.ok(result.skipped.some(c => c.testCaseId === id));
  assert.ok(fs.existsSync(path.join(scope.paths.recordingsDir, `${id}.evidence.json`)), 'Blocked orchestration keeps evidence');
  console.log('PASS real orchestration blocks without AI and retains recording evidence');
}
integration().catch(error => { failures++; console.error(error); }).finally(() => { process.exitCode = failures ? 1 : 0; });
