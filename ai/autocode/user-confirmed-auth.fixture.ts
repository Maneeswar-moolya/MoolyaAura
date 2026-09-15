import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceData } from '../testing/workspace-data';
import { recordingSource, writeFixtureFile } from '../testing/synthetic-data';
import { parseRecording } from '../dashboard/recorder';
import { ownershipReview } from '../dashboard/page-ownership';
import { mapRecording, pageObjectRequirements } from './from-recording';
import type { OwnerSelection } from '../dashboard/authoring-catalog';
import { hashContent, loadOwners, ownersPath } from '../knowledge/authoring-owners';

const { scope } = workspaceData();
const controls = ['entry', 'account', 'secret', 'submit'];
const locators = controls.map(name => `page.getByTestId('${name}')`);
const relative = (file: string) => path.relative(process.cwd(), file);
writeFixtureFile(relative(path.join(scope.paths.pagesDir, 'AccessControls.ts')), `
import { BasePage } from '../base.page';
export class AccessControls extends BasePage {
${controls.map((name, at) => `  ${name}() { return ${locators[at].replace(/^page\./, 'this.page.')}; }`).join('\n')}
}
`);
const fixtures = fs.readFileSync(scope.paths.fixturesFile, 'utf8');
writeFixtureFile(relative(scope.paths.fixturesFile), fixtures
  .replace('// <page-object-imports>', "import { AccessControls } from './pages/north/AccessControls';")
  .replace('interface Fixtures {', 'interface Fixtures {\n  accessControls: AccessControls;\n  appCredentials: { email: string; password: string } | null;')
  .replace('// <page-object-fixtures>', 'accessControls: async ({ page }, use) => { await use(new AccessControls(page)); },'));
const source = recordingSource([
  "await page.goto('https://portal.example.invalid/access');",
  `await ${locators[0]}.click();`,
  `await ${locators[1]}.fill('discard@example.invalid');`,
  `await ${locators[2]}.fill('[type=password]');`,
  `await ${locators[3]}.click();`,
]);
function recorded(mode: 'method' | 'locator' | 'context' | 'auto' = 'method') {
  const recording = parseRecording(source, { startUrl: '', browser: '', durationMs: 0,
    evidence: { available: true, origin: { applicationId: scope.applicationId }, targets: [] } as any });
  const overrides: Record<string, OwnerSelection> = mode === 'auto' ? {} : Object.fromEntries(controls.map((method, at) => [`action:${at + 1}`, {
    applicationId: scope.applicationId, page: '', pageObject: mode === 'locator' ? '' : 'AccessControls',
    method: mode === 'method' ? method : null,
    ...(mode === 'locator' ? { executionMode: 'RECORDED_LOCATOR' } : {}),
  }]));
  const review = ownershipReview(scope, recording, overrides);
  recording.authoringOwners = { version: 1, applicationId: scope.applicationId, recordingHash: hashContent(source), choices: review.steps, pages: [] };
  return recording;
}
let failures = 0;
function check(name: string, run: () => void) {
  try { run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
const code = (recording: ReturnType<typeof recorded>) => {
  const result = mapRecording(recording);
  assert.deepEqual(result.unresolved, [], 'explicit executable controls must not require automatic identity/ownership');
  return { result, text: result.steps.flatMap(step => step.code).join('\n') };
};
check('explicit methods execute every auth control with no target evidence or knowledge', () => {
  const { result, text } = code(recorded());
  assert.match(text, /accessControls.entry\(\)\)\.click\(\)/);
  assert.match(text, /accessControls.account\(\)\)\.fill\(appCredentials.email\)/);
  assert.match(text, /accessControls.secret\(\)\)\.fill\(appCredentials.password\)/);
  assert.match(text, /accessControls.submit\(\)\)\.click\(\)/);
  assert.equal(result.reused.length, 4);
  assert.doesNotMatch(text, /discard@example|\[type=password\]/);
});
check('recorded locator mode persists and executes without any Page Object', () => {
  const recording = recorded('locator'), file = path.join(scope.paths.recordingsDir, 'TC_EXPLICIT.spec.ts');
  writeFixtureFile(relative(file), source);
  writeFixtureFile(relative(ownersPath(file)), JSON.stringify(recording.authoringOwners));
  recording.authoringOwners = loadOwners(scope, file, source);
  const { result, text } = code(recording);
  assert.match(text, /page.getByTestId\('entry'\)\)\.click\(\)/);
  assert.match(text, /page.getByTestId\('account'\)\)\.fill\(appCredentials.email\)/);
  assert.match(text, /page.getByTestId\('secret'\)\)\.fill\(appCredentials.password\)/);
  assert.match(text, /page.getByTestId\('submit'\)\)\.click\(\)/);
  assert.equal(result.reused.length, 0, 'manual locators must not claim automatic capability reuse');
  assert.equal(result.codegenLocators, 4);
  assert.deepEqual(pageObjectRequirements(result), [], 'explicit authentication locators do not require Page Object creation');
  assert.equal(result.fixtures.has('undefined'), false);
  assert.doesNotMatch(text, /discard@example|\[type=password\]/);
});
check('Auto and Page/PO-only choices still require automatic target identity', () => {
  for (const mode of ['auto', 'context'] as const)
    assert.match(mapRecording(recorded(mode)).unresolved[0]?.why ?? '', /missing admissible interaction-time identity/);
});
check('navigation causality remains independent of explicit authentication', () => {
  for (const mode of ['method', 'locator'] as const) {
    const recording = recorded(mode); recording.actions[0].navigationCause = 'unknown';
    assert.ok(mapRecording(recording).needsReview.some(step => step.failure === 'navigationCausality'));
    recording.actions[0].navigationCause = 'intentional'; recording.actions[0].value = 'https://identity.example.invalid/?SAMLResponse=synthetic';
    const result = mapRecording(recording);
    assert.ok(result.needsReview.some(step => step.failure === 'navigationCausality'));
    assert.doesNotMatch(result.steps.flatMap(step => step.code).join('\n'), /SAMLResponse/);
  }
});
check('foreign application bindings and foreign evidence are rejected in both explicit modes', () => {
  for (const mode of ['method', 'locator'] as const) {
    const recording = recorded(mode);
    recording.authoringOwners!.choices[0].userSelection!.applicationId = 'south';
    assert.throws(() => mapRecording(recording), /Cross-application/);
    const foreign = recorded(mode); (foreign.evidence as any).origin.applicationId = 'south';
    assert.throws(() => mapRecording(foreign), /Foreign recording evidence/);
  }
});
check('a missing confirmed method stays broken instead of falling back', () => {
  const recording = recorded(); recording.authoringOwners!.choices[0].userSelection!.method = 'missing';
  assert.throws(() => mapRecording(recording), /USER BINDING BROKEN/);
});
check('explicit execution modes never inherit onto another control', () => {
  const recording = recorded('locator');
  const review = ownershipReview(scope, recording, { 'action:1': recording.authoringOwners!.choices[0].userSelection! });
  assert.notEqual((review.steps[1].userSelection as any)?.executionMode, 'RECORDED_LOCATOR');
  assert.equal(review.steps[1].userSelection?.method, null);
});
check('explicit recorded locator cannot inject executable code', () => {
  for (const locator of ["page.locator('x'); process.exit(0); //", "page.locator(process.exit())", "page.locator('x').evaluate(() => 1)"]) {
    const recording = recorded('locator'); recording.actions[1].locator = locator;
    assert.throws(() => mapRecording(recording), /recorded locator|Locator|locator expression/);
  }
});
check('persisted application ownership suffices when the entire evidence sidecar is unavailable', () => {
  for (const mode of ['method', 'locator'] as const) {
    const recording = recorded(mode); recording.evidence = { available: false, reason: 'No sidecar' } as any;
    code(recording);
  }
});
check('explicit methods take precedence over recorded-locator mode', () => {
  const recording = recorded();
  for (const choice of recording.authoringOwners!.choices) choice.userSelection!.executionMode = 'RECORDED_LOCATOR';
  const { result } = code(recording);
  assert.equal(result.reused.length, 4); assert.equal(result.codegenLocators, 0);
});
check('a mixed span executes the explicit entry control and retains the Auto evidence gate for the next control', () => {
  const recording = recorded(); recording.authoringOwners!.choices.splice(1);
  const result = mapRecording(recording);
  assert.match(result.unresolved[0]?.why ?? '', /authentication action 2 .*missing admissible interaction-time identity/);
  assert.equal(result.steps.some(step => step.code.some(line => line.includes('appCredentials'))), false, 'failed authentication plans never emit partial credential operations');
});
if (failures) process.exitCode = 1;
