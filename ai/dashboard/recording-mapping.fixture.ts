import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import { workspaceData } from '../testing/workspace-data';
import { createLogicalPage, createPageObject, createAuthoringMethod } from './authoring-catalog';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { authoringCatalog, authoringCatalogPath } from './authoring-catalog';
import { recordingMappingReview, saveRecordingMapping, draftOwnersFile, type MappingDraft, type MappingInput } from './recording-mapping';
import { hashContent } from '../knowledge/authoring-owners';
import { mapRecording } from '../autocode/from-recording';
import { writeFixtureFile } from '../testing/synthetic-data';
import { writeKnowledge, recordingSource } from '../testing/synthetic-data';
import { parseRecording } from './recorder';
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) ?? 'all';
const only = process.argv.find(arg => arg.startsWith('--check='))?.slice(8);
if(phase==='all'&&!only){
  let failed=false;
  for(const group of ['catalog','save','reuse','isolation']){
    const result=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--phase=${group}`],{env:{...process.env,AURA_SYNTHETIC_FIXTURE_ROOT:''},stdio:'inherit',windowsHide:true,timeout:240000});
    if(result.status!==0){failed=true;console.error(`FAIL isolated authoring ${group}: ${result.error??result.status}`);}
  }
  process.exit(failed?1:0);
}
const { scope, other, recording, source } = workspaceData();
createLogicalPage(scope, { name: 'Shared header', route: '/home', description: 'Header across screens' });
createPageObject(scope, 'Shared header', 'LegacyControls');
createAuthoringMethod(scope, 'LegacyControls', 'entryLink', "page.getByTestId('entry')");
assert.ok(readAllPageKnowledge(scope.paths.knowledgePageDir, true).some(page => page.elements.some(element =>
  element.page_object === 'LegacyControls' && element.page_object_method === 'entryLink')),
  'saved authoring must reconstruct reusable capabilities through the application YAML reader');
console.log('PASS saved authoring reconstructs reusable YAML capabilities');
assert.equal(fs.existsSync(authoringCatalogPath(scope)), false, 'new authoring does not create a parallel catalog store');
const draft: MappingDraft = { source, recording };
const inputs = (patch: Partial<MappingInput> = {}, target = draft): MappingInput => {
  const review = recordingMappingReview(scope, target);
  return { applicationId: scope.applicationId, revision: review.revision, mappingVersion: review.mappingVersion, stepKey: 'action:1',
    page: { name: 'Home sections', route: '/home', description: 'Reusable sections', create: true }, pageObject: { name: 'HeaderControls', create: true }, ...patch };
};
const existing = { page: { name: 'Home sections', route: '/home', description: '' }, pageObject: { name: 'HeaderControls' } };
const snapshot = () => {
  const result: Record<string, string> = {};
  for (const dir of [scope.paths.pagesDir, scope.paths.knowledgePageDir, scope.paths.recordingsDir]) if (fs.existsSync(dir))
    for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name); if (fs.statSync(file).isFile()) result[file] = hashContent(fs.readFileSync(file, 'utf8')); }
  result[scope.paths.fixturesFile] = hashContent(fs.readFileSync(scope.paths.fixturesFile, 'utf8')); return result;
};
let failures = 0;
function check(group: string, name: string, run: () => void) {
  if (phase !== 'all' && phase !== group || only && only !== name) return;
  try { run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).stack}`); }
}
check('catalog', 'route is context and multiple logical Pages can share it', () => {
  createLogicalPage(scope, { name: 'Overview', route: '/home', description: 'Customer summary' });
  createLogicalPage(scope, { name: 'Dashboard', route: '/home', description: 'Reports and widgets' });
  createLogicalPage(scope, { name: 'Across screens', route: '', description: 'Reusable component' });
  createLogicalPage(scope, { name: 'Order details', route: '/orders/:id', description: '' });
  const catalog = authoringCatalog(scope);
  assert.notEqual(catalog.pages.find(page => page.name === 'Overview')?.file, catalog.pages.find(page => page.name === 'Dashboard')?.file);
  assert.ok(catalog.pages.some(page => page.name === 'Across screens' && !page.route));
  assert.ok(authoringCatalog(scope, 'Customer summary').pages.some(page => page.name === 'Overview'));
  assert.ok(authoringCatalog(scope, '/orders/:id').pages.some(page => page.name === 'Order details'));
  assert.throws(() => createLogicalPage(scope, { name: 'Overview', route: '/different', description: '' }), /Page already exists/);
  assert.equal(recordingMappingReview(scope, draft).steps[0].screenRoute, '/home');
  assert.equal(recordingMappingReview(scope, draft).steps[0].userSelection, null, 'ranking must never select a Page');
});
check('catalog', 'one Save Mapping persists source YAML fixture and exact binding without proof', () => {
  const unproven = { ...draft, recording: structuredClone(recording) };
  unproven.recording.evidence = { available: false, reason: 'Synthetic missing evidence' } as any;
  const result = saveRecordingMapping(scope, unproven, inputs({}, unproven)), binding = result.saved.binding!;
  assert.ok(binding.method); assert.equal(result.steps[0].provenance, 'USER_CONFIRMED');
  assert.ok(result.authoring.objects.some(object=>object.className===binding.pageObject&&object.methods.some(method=>method.name===binding.method)), 'newly saved capability must appear in the returned catalog');
  assert.deepEqual(recordingMappingReview(scope, unproven).steps[0].userSelection, binding);
  assert.ok(readAllPageKnowledge(scope.paths.knowledgePageDir, true).some(page => page.elements.some(element => element.page_object === binding.pageObject && element.page_object_method === binding.method)));
  assert.equal(readAllPageKnowledge(scope.paths.knowledgePageDir).some(page => page.elements.some(element => element.page_object === binding.pageObject)), false);
  assert.ok(mapRecording(unproven.recording).steps.some(step => step.method === binding.method));
  assert.ok(fs.readFileSync(scope.paths.fixturesFile, 'utf8').includes('headerControls'));
});
check('catalog', 'Page Object names and Page associations are validated', () => {
  const before = snapshot();
  for (const name of ['loginButton()', 'clickLogin()', '../Foreign', 'BasePage'])
    assert.throws(() => saveRecordingMapping(scope, draft, inputs({ page: { name: 'Name validation', route: '', description: '', create: true }, pageObject: { name, create: true } })), /PascalCase/);
  assert.deepEqual(snapshot(), before);
  const home = authoringCatalog(scope).objects.find(object => object.className === 'FirstPage')!.page;
  assert.throws(() => saveRecordingMapping(scope, draft, inputs({ page: { name: home, route: '/home', description: '' }, pageObject: { name: 'SparePage' } })), /another logical Page/);
});
for (const stage of ['sidecar', 'YAML'] as const) check('save', `failed ${stage} commit rolls back all artifacts`, () => {
  const before = snapshot(), rename = fs.renameSync;
  fs.renameSync = ((from: any, to: any) => { if (stage === 'sidecar' ? String(to) === draftOwnersFile(scope, source) : String(to).endsWith('.yaml')) throw Error(`Injected ${stage} failure`); return rename(from, to); }) as typeof fs.renameSync;
  try { assert.throws(() => saveRecordingMapping(scope, draft, inputs()), new RegExp(`Injected ${stage} failure`)); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(snapshot(), before, 'no partial sidecar/YAML/source/fixture state');
  assert.equal(draft.ownerOverrides, undefined);
});
check('save', 'readback mismatch rolls back the committed transaction', () => {
  const before = snapshot(), read = fs.readFileSync; let injected = false;
  fs.readFileSync = ((file: any, options: any) => { if (!injected && String(file) === draftOwnersFile(scope, source) && fs.existsSync(file)) { injected = true; return '{}'; } return read(file, options); }) as typeof fs.readFileSync;
  try { assert.throws(() => saveRecordingMapping(scope, draft, inputs()), /Persisted authoring artifacts differ/); }
  finally { fs.readFileSync = read; }
  assert.deepEqual(snapshot(), before);
});
check('save', 'invalid TypeScript and stale revisions are refused before persistence', () => {
  const before = snapshot();
  assert.throws(() => saveRecordingMapping(scope, draft, inputs({ locatorOverride: 'page.getByTestId(true)' })), /TS2345/);
  assert.throws(() => saveRecordingMapping(scope, draft, inputs({ mappingVersion: 'stale' })), /Mapping changed/);
  assert.deepEqual(snapshot(), before);
});
const ensureSaved = () => { if (!authoringCatalog(scope).objects.some(object => object.className === 'HeaderControls')) saveRecordingMapping(scope, draft, inputs()); };
check('reuse', 'later steps recordings and restart reuse the persisted capability', () => {
  ensureSaved(); const first = recordingMappingReview(scope, draft).steps[0].userSelection!;
  const file = path.join(scope.paths.pagesDir, 'HeaderControls.ts'), original = fs.readFileSync(file, 'utf8');
  const next = saveRecordingMapping(scope, draft, inputs({ ...existing, stepKey: 'action:2' }));
  assert.equal(next.saved.binding?.method, first.method); assert.equal(next.saved.reused, true);
  const later = { source: source + '\n// Another synthetic recorded case\n', recording: structuredClone(recording) };
  assert.equal(saveRecordingMapping(scope, later, inputs(existing, later)).saved.binding?.method, first.method);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(authoringCatalog(scope).objects.filter(object => object.className === 'HeaderControls').length, 1);
  const probe = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/testing/mapping-reload-probe.ts'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(probe.status, 0, probe.stdout + probe.stderr); assert.match(probe.stdout, /HeaderControls/);
  const auto = structuredClone(recording); delete auto.authoringOwners;
  assert.equal(mapRecording(auto).reused.some(item => item.pageObject === 'HeaderControls'), false, 'authored knowledge is not automatically proven');
});
check('reuse', 'established capability collisions and ambiguity never overwrite methods', () => {
  ensureSaved(); const before = snapshot();
  assert.throws(() => saveRecordingMapping(scope, draft, inputs({ ...existing, locatorOverride: "page.getByTestId('different')" })), /established method already uses this name/);
  assert.deepEqual(snapshot(), before);
  const file = path.join(scope.paths.pagesDir, 'HeaderControls.ts'), original = fs.readFileSync(file, 'utf8');
  const extra = original.slice(0, original.lastIndexOf('}')) + "  duplicate() { return this.page.getByTestId('continue'); }\n}\n";
  writeFixtureFile(path.relative(process.cwd(), file), extra);
  try { assert.throws(() => saveRecordingMapping(scope, draft, inputs(existing)), /Multiple established capabilities/); assert.equal(fs.readFileSync(file, 'utf8'), extra); }
  finally { writeFixtureFile(path.relative(process.cwd(), file), original); }
});
check('reuse', 'parameterized capabilities reuse their declared template without new methods', () => {
  const file = path.join(scope.paths.pagesDir, 'FirstPage.ts'), original = fs.readFileSync(file, 'utf8');
  const template = "page.getByRole('button', { name: label })", locator = "page.getByRole('button', { name: 'Billing' })";
  writeFixtureFile(path.relative(process.cwd(), file), original.slice(0, original.lastIndexOf('}')) + `  section(label: string) { return this.${template}; }\n}\n`);
  writeKnowledge('north/parameterized.yaml', '/home', [{ id:'section',owner:'FirstPage',method:'section',expression:template,usage:'action' }]);
  const text = recordingSource(["await page.goto('https://portal.example.invalid/home');",`await ${locator}.click();`]);
  const flow:MappingDraft = { source:text,recording:parseRecording(text,{startUrl:'',browser:'',durationMs:0,evidence:{available:false,reason:'Explicit template authoring'} as any}) };
  const object = authoringCatalog(scope).objects.find(object=>object.className==='FirstPage')!;
  const result = saveRecordingMapping(scope,flow,inputs({page:{name:object.page,route:'/home',description:''},pageObject:{name:'FirstPage'}},flow));
  assert.equal(result.saved.binding?.method,'section');assert.deepEqual(result.saved.binding?.arguments,['Billing']);
  assert.match(mapRecording(flow.recording).steps.flatMap(step=>step.code).join('\n'),/firstPage.section\('Billing'\)/);
  assert.equal(result.saved.methodCreated,false);
});
check('reuse', 'nested recorded locators compile and explicit methods ignore unusable recorded locators', () => {
  ensureSaved();
  const nested="page.locator('.row').filter({ has: page.getByText('Details') })";
  const result=saveRecordingMapping(scope,draft,inputs({...existing,method:'detailsRow',locatorOverride:nested}));
  assert.equal(result.saved.binding?.method,'detailsRow');
  const oldSource=source.replace(recording.actions[1].locator,"page.locator('.old').first()");
  const flow:MappingDraft={source:oldSource,recording:parseRecording(oldSource,{startUrl:'',browser:'',durationMs:0,evidence:{available:false,reason:'Old unusable recorded locator'} as any})};
  const explicit=saveRecordingMapping(scope,flow,inputs({...existing,method:'detailsRow'},flow));
  assert.equal(explicit.saved.reused,true);
});
check('reuse', 'Reset to Auto keeps knowledge and explicit raw execution stays unvalidated', () => {
  ensureSaved(); const files = [path.join(scope.paths.pagesDir, 'HeaderControls.ts'), ...readAllPageKnowledge(scope.paths.knowledgePageDir, true).map(page => path.resolve(page.file))];
  const bytes = files.map(file => fs.readFileSync(file, 'utf8'));
  const result = saveRecordingMapping(scope, draft, inputs({ executionMode: 'AUTO' }));
  assert.equal(result.steps[0].provenance, 'AUTO'); assert.equal(result.steps[0].userSelection, null);
  assert.deepEqual(files.map(file => fs.readFileSync(file, 'utf8')), bytes);
  const nextBefore = result.steps[1].userSelection;
  const raw = saveRecordingMapping(scope, draft, inputs({ page: undefined, pageObject: undefined, executionMode: 'RECORDED_LOCATOR' }));
  assert.equal(raw.saved.binding?.pageObject, ''); assert.equal(raw.steps[0].provenance, 'USER_CONFIRMED');
  if (result.steps[1].explicit) assert.deepEqual(raw.steps[1].userSelection, nextBefore, 'another step retains its explicit execution choice');
  else assert.equal(raw.steps[1].userSelection?.executionMode, 'AUTO');
  assert.ok(mapRecording(draft.recording).steps.some(step => step.kind === 'codegen-locator' && /NOT VALIDATED/.test(step.why)));
});
check('isolation', 'another application cannot discover or bind saved authoring', () => {
  ensureSaved();
  assert.equal(authoringCatalog(other).pages.some(page => page.name === 'Home sections'), false);
  assert.equal(authoringCatalog(other).objects.some(object => object.className === 'HeaderControls'), false);
  assert.equal(readAllPageKnowledge(other.paths.knowledgePageDir, true).some(page => page.elements.some(element => element.page_object === 'HeaderControls')), false);
  assert.throws(() => saveRecordingMapping(scope, draft, inputs({ applicationId: other.applicationId, ...existing })), /Cross-application/);
  assert.throws(() => saveRecordingMapping(other, draft, { ...inputs(existing), applicationId: other.applicationId }), /another application/);
  const foreign = structuredClone(recording); foreign.authoringOwners!.applicationId = other.applicationId;
  assert.throws(() => mapRecording(foreign), /Foreign recording ownership/);
});
if (failures) process.exitCode = 1;
