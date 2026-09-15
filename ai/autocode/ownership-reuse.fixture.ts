import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeFixtureFile, recordingSource, targetEvidence, measurement } from '../testing/synthetic-data';
import { activeScope, resetActiveScope } from '../projects/scope';
import { resetActiveApplication } from '../knowledge/canonical';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording, findMethodByProvenLocator, pageObjectRequirements, generateFromRecording } from './from-recording';
import { analyseCorpus, resolveOwner } from './abstraction/propose';
import { applyProposals } from './abstraction/writer';

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

import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import { buildIndex } from '../knowledge/index';
let failures = 0;
function check(name: string, run: () => void) {
  try { run(); console.log(`PASS ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}: ${(error as Error).message}`); }
}
applyProposals(analyseCorpus().proposals.filter(p => p.testCaseId === id));
const recording = parseRecording(source, { startUrl: '', browser: 'chromium', durationMs: 0, evidence });
const original = mapRecording(recording);
const controls = original.steps.filter(s => s.kind === 'page-object' && s.pageObject === 'AccessPage');
assert.equal(controls.length, 3);
const indexBefore = buildIndex();
const homeFile = indexBefore.pages.OverviewPage.file;
let homeSource = fs.readFileSync(homeFile, 'utf8');
const expressions = [email, password, submit];
const duplicateMethods = controls.map((step, i) => `  ${step.method}(): Promise<Locator> { return this.resolve('overview.${step.method}', [{ strategy: 'synthetic', build: page => ${expressions[i]} }]); }`).join('\n');
homeSource = homeSource.replace(/}\s*$/, duplicateMethods + '\n}\n');
writeFixtureFile(homeFile, homeSource);
const homeKnowledge = readAllPageKnowledge().find(k => k.route === '/overview')!;
let yaml = fs.readFileSync(homeKnowledge.file, 'utf8');
for (const [i, name] of ['Account', 'Secret', 'Other action'].entries())
  yaml += `\n  misplaced_${i}:\n    accessible_name: ${name}\n    page_object: OverviewPage\n    page_object_method: ${controls[i].method}\n    locator_strategy: ${JSON.stringify(expressions[i])}\n`;
writeFixtureFile(homeKnowledge.file, yaml);
const knowledge = readAllPageKnowledge(), index = buildIndex();
check('measured route overrides reconstructed route', () => {
  const owner = resolveOwner(targets[0], knowledge, ['/overview'], { applicationId: 'north', originApplicationId: 'north', route: '/access' });
  assert.equal(owner.owner, 'AccessPage');
});
check('authentication reuses proven controls on their measured page', () => {
  const mapped = mapRecording(recording);
  assert.equal(mapped.unresolved.length, 0);
  assert.equal(mapped.steps.filter(s => s.pageObject === 'AccessPage').length, 3);
  assert.ok(!mapped.steps.some(s => s.pageObject === 'OverviewPage' && s.from.startsWith('fill')));
});
check('proven locator lookup disambiguates owners by measured route', () => {
  assert.equal(findMethodByProvenLocator(targets[0], knowledge, index, 'action')?.pageObject, 'AccessPage');
});
check('different proven expressions cannot choose between same-route owners', () => {
  const alternate = `page.locator('#same-account')`;
  const conflicting = knowledge.map(k => ({ ...k, route: '/access', elements: k.elements.map(e =>
    e.page_object === 'OverviewPage' && e.page_object_method === controls[0].method ? { ...e, locator_strategy: alternate } : e) }));
  const both = { ...targets[0], derivedCandidates: [...targets[0].derivedCandidates!, measurement(alternate)] };
  assert.equal(findMethodByProvenLocator(both, conflicting, index, 'action'), null);
});
check('same-route duplicate owners remain ambiguous', () => {
  const sameRoute = knowledge.map(k => ({ ...k, route: '/access' }));
  assert.equal(findMethodByProvenLocator(targets[0], sameRoute, index, 'action'), null);
});
check('different names cannot hide a same-route ownership conflict', () => {
  try {
    writeFixtureFile(homeKnowledge.file, yaml.replace(/route:.*$/, 'route: /access')
      .replace(/route: [^\r\n]*/, 'route: /access').replace('accessible_name: Account', 'accessible_name: Account alias'));
    const one = parseRecording(recordingSource([`await ${email}.click();`]), { startUrl: '', browser: '', durationMs: 0, evidence });
    assert.ok(!mapRecording(one).steps.some(s => s.kind === 'page-object'));
  } finally { writeFixtureFile(homeKnowledge.file, yaml); }
});
check('an after-action route cannot settle interaction-time ownership', () => {
  assert.equal(findMethodByProvenLocator({ ...targets[0], captureTiming: 'after-action' }, knowledge, index, 'action'), null);
});
check('missing measured route cannot settle duplicate owners', () => {
  assert.equal(findMethodByProvenLocator({ ...targets[0], route: undefined }, knowledge, index, 'action'), null);
});
const link = `page.locator('header').getByRole('link', { name: 'Continue' })`;
const linkSource = recordingSource([`await ${link}.click();`]);
check('unmeasured same-name link cannot reuse a form button', () => {
  const parsed = parseRecording(linkSource, { startUrl: '', browser: '', durationMs: 0, evidence: { ...evidence, targets: [] } });
  assert.ok(!mapRecording(parsed).steps.some(s => s.kind === 'page-object'));
});
check('proven link cannot reuse a different same-name button', () => {
  const linkTarget = targetEvidence(link, { route: '/overview', target: { tag: 'a', role: 'link', accessibleName: 'Continue' } });
  const parsed = parseRecording(linkSource, { startUrl: '', browser: '', durationMs: 0, evidence: { ...evidence, targets: [linkTarget] } });
  assert.ok(!mapRecording(parsed).steps.some(s => s.kind === 'page-object'));
});
check('capability identity evidence alone supports authentication reuse', () => {
  const onlyCapabilities = targets.map((t, i) => i === 3 ? t : ({ ...t, derivedCandidates: [],
    capabilityMeasurements: t.derivedCandidates!.map(c => ({ ...c, capability: { owner: 'AccessPage', method: controls[i].method! } })) }));
  const parsed = parseRecording(source, { startUrl: '', browser: '', durationMs: 0, evidence: { ...evidence, targets: onlyCapabilities } });
  assert.equal(mapRecording(parsed).unresolved.length, 0);
});
check('missing authentication evidence identifies the failing control', () => {
  const parsed = parseRecording(source, { startUrl: '', browser: '', durationMs: 0,
    evidence: { ...evidence, targets: targets.filter(t => t.locator !== password) } });
  const failure = mapRecording(parsed).unresolved[0];
  assert.match(failure?.why ?? '', /action 2.*Secret.*identity/i);
});
check('foreign-document identity cannot grant named reuse', () => {
  const bad = { ...targets[0], derivedCandidates: targets[0].derivedCandidates!.map(c => ({ ...c, sameDocument: false })) };
  const one = parseRecording(recordingSource([`await ${email}.click();`]), { startUrl: '', browser: '', durationMs: 0, evidence: { ...evidence, targets: [bad] } });
  assert.ok(!mapRecording(one).steps.some(s => s.kind === 'page-object'));
});
check('proven header link bootstraps its own reusable capability', () => {
  const linkTarget = targetEvidence(link, { route: '/overview', documentId: 'header-doc', elementRef: 'header-doc:1',
    target: { tag: 'a', role: 'link', accessibleName: 'Continue', accessibleNameVerified: true } });
  const headerEvidence = { ...evidence, targets: [linkTarget] };
  const headerId = 'TC_HEADER_LINK';
  writeFixtureFile(relative(path.join(scope.paths.recordingsDir, `${headerId}.spec.ts`)), linkSource);
  writeFixtureFile(relative(path.join(scope.paths.recordingsDir, `${headerId}.evidence.json`)), JSON.stringify(headerEvidence));
  const headerProposals = analyseCorpus().proposals.filter(p => p.testCaseId === headerId);
  assert.equal(headerProposals.length, 1); assert.equal(headerProposals[0].owner, 'OverviewPage');
  assert.notEqual(headerProposals[0].method, controls[2].method);
  applyProposals(headerProposals);
  const parsed = parseRecording(linkSource, { startUrl: '', browser: '', durationMs: 0, evidence: headerEvidence });
  const step = mapRecording(parsed).steps[0];
  assert.equal(step.kind, 'page-object'); assert.equal(step.pageObject, 'OverviewPage');
  assert.equal(step.method, headerProposals[0].method);
});
check('early proven reuse retains alternative evidence without rewriting capabilities', () => {
  const alternate = `page.locator('#account-alternate')`;
  const retainedTarget = { ...targets[0], locator: alternate, derivedCandidates: [measurement(alternate)],
    capabilityMeasurements: [measurement(email, { capability: { owner: 'AccessPage', method: controls[0].method! } })] };
  const alternateId = 'TC_ALTERNATIVE_REUSE';
  writeFixtureFile(relative(path.join(scope.paths.recordingsDir, `${alternateId}.spec.ts`)), recordingSource([`await ${alternate}.click();`]));
  writeFixtureFile(relative(path.join(scope.paths.recordingsDir, `${alternateId}.evidence.json`)), JSON.stringify({ ...evidence, targets: [retainedTarget] }));
  const before = fs.readFileSync(homeKnowledge.file, 'utf8');
  const analysis = analyseCorpus();
  assert.ok(analysis.reused.some(r => r.testCaseId === alternateId && r.pageObject === 'AccessPage'));
  assert.ok(analysis.alternatives.some(a => a.testCaseId === alternateId && a.owner === 'AccessPage' && a.observed === alternate));
  assert.equal(fs.readFileSync(homeKnowledge.file, 'utf8'), before);
});
process.exitCode = failures ? 1 : 0;
