import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import { workspaceData } from '../testing/workspace-data';
import { createAuthoringPage, pageCatalog } from './page-ownership';
import { authoringCatalog, createLogicalPage, createPageObject, createAuthoringMethod } from './authoring-catalog';
import { mapRecording } from '../autocode/from-recording';
import { manualMethods } from '../knowledge/manual-authoring';
import { ownershipReview } from './page-ownership';
import fs from 'node:fs';
import path from 'node:path';
import { parseRecording } from './recorder';
import { recordingSource, targetEvidence } from '../testing/synthetic-data';
import { hashContent, loadOwners, ownersPath } from '../knowledge/authoring-owners';

const { scope, recording } = workspaceData();
const sameRoute = createAuthoringPage(scope, recording, { name: 'SecondHomePage', route: '/home', description: 'Another logical screen' }, []);
assert.equal(sameRoute.route, '/home', 'multiple logical Pages may share a route');
const missing = structuredClone(recording);
missing.evidence = { available: false, reason: 'No automatic evidence' } as any;
assert.equal(createAuthoringPage(scope, missing, { name: 'AuthoredPage', route: '/new', description: 'User authored' }, []).name, 'AuthoredPage');
assert.ok(pageCatalog(scope, 'control').some(page => page.name === 'FirstPage'), 'Page Object search includes method names');
console.log('PASS explicit creation without inferred ownership and method search');
createLogicalPage(scope, { name: 'Customer overview', route: '/home', description: 'Overview for customers' });
createLogicalPage(scope, { name: 'Customer details', route: '/home', description: 'Second logical Page' });
createLogicalPage(scope, { name: 'Unrouted screen', route: '', description: '' });
assert.equal(authoringCatalog(scope, '/home').pages.length, 3);
createPageObject(scope, 'Customer overview', 'CustomerControls');
createAuthoringMethod(scope, 'CustomerControls', 'continueControl', "page.getByTestId('manual-control')");
assert.equal(authoringCatalog(scope, 'continueControl').objects[0].className, 'CustomerControls');
assert.equal(manualMethods(scope).find(method => method.owner === 'CustomerControls')?.status, 'USER AUTHORED — NOT VALIDATED');
const selection = { applicationId: scope.applicationId, page: 'Customer overview', pageObject: 'CustomerControls', method: 'continueControl' };
const view = ownershipReview(scope, missing, { 'action:1': selection });
assert.equal(view.steps[0].provenance, 'USER_CONFIRMED');
assert.equal(view.steps[0].userSelection?.method, 'continueControl');
assert.equal(view.steps[1].userSelection?.pageObject, 'CustomerControls');
assert.equal(view.steps[1].userSelection?.method, null, 'method does not silently bind another control');
missing.authoringOwners = { version: 1, applicationId: scope.applicationId, recordingHash: '', choices: view.steps, pages: [] };
const mapped = mapRecording(missing);
assert.ok(mapped.steps.some(step => step.pageObject === 'CustomerControls' && step.method === 'continueControl'));
assert.throws(() => ownershipReview(scope, missing, { 'action:1': { ...selection, applicationId: 'south' } }), /Cross-application/);
missing.authoringOwners.choices[0].userSelection!.method = 'disappeared';
assert.throws(() => mapRecording(missing), /USER BINDING BROKEN/);
console.log('PASS logical Pages, named Page Objects, manual methods, explicit precedence, inheritance, isolation and broken bindings');
const fixture = fs.readFileSync(scope.paths.fixturesFile, 'utf8');
fs.writeFileSync(scope.paths.fixturesFile, fixture.replace('interface Fixtures {', 'interface Fixtures {\n  appCredentials: { email: string; password: string } | null;'));
const controls = ["page.getByLabel('Account')", "page.getByLabel('Secret')", "page.getByRole('button', { name: 'Continue' })"];
const names = ['accountControl', 'secretControl', 'submitControl'];
names.forEach((name, at) => createAuthoringMethod(scope, 'CustomerControls', name, controls[at]));
const controlsFile = path.join(scope.paths.pagesDir, 'CustomerControls.ts');
const controlsSource = fs.readFileSync(controlsFile, 'utf8');
fs.writeFileSync(controlsFile, controlsSource.slice(0, controlsSource.lastIndexOf('}')) + `
  async combine(account: string, secret: string): Promise<void> {
    await (await this.accountControl()).fill(account);
    await (await this.secretControl()).fill(secret);
    await (await this.submitControl()).click();
  }
}\n`);
const authSource = recordingSource([
  "await page.goto('https://portal.example.invalid/home'); // @aura-navigation intentional",
  `await ${controls[0]}.fill('synthetic@example.invalid');`, `await ${controls[1]}.fill('[type=password]');`, `await ${controls[2]}.click();`,
]);
const auth = parseRecording(authSource, { startUrl: '', browser: '', durationMs: 0, evidence: {
  available: true, origin: { applicationId: scope.applicationId }, targets: controls.map((locator, at) => targetEvidence(locator, {
    route: '/unknown', documentId: 'auth-doc', elementRef: `auth-doc:${at}`, derivedCandidates: [],
    target: { tag: at === 2 ? 'button' : 'input', type: ['email','password','submit'][at] },
  })),
} as any });
const authReview = ownershipReview(scope, auth, Object.fromEntries(names.map((method, at) => [`action:${at + 1}`, { ...selection, method }])));
auth.authoringOwners = { version: 1, applicationId: scope.applicationId, recordingHash: hashContent(authSource), choices: authReview.steps, pages: [] };
const authFile = path.join(scope.paths.recordingsDir, 'TC_AUTHORED.spec.ts');
fs.writeFileSync(authFile, authSource);fs.writeFileSync(ownersPath(authFile), JSON.stringify(auth.authoringOwners));
auth.authoringOwners = loadOwners(scope, authFile, authSource);
assert.equal(auth.authoringOwners?.choices[1].provenance, 'USER_CONFIRMED');
assert.ok(Object.hasOwn(auth.authoringOwners!.choices[1], 'frameworkRecommendation'));
const authMapping = mapRecording(auth), authCode = authMapping.steps.flatMap(step => step.code).join('\n');
assert.equal(authMapping.unresolved.length, 0, JSON.stringify(authMapping.unresolved));
assert.match(authCode, /customerControls.accountControl\(\)\)\.fill\(appCredentials.email\)/);
assert.match(authCode, /customerControls.secretControl\(\)\)\.fill\(appCredentials.password\)/);
assert.match(authCode, /customerControls.submitControl\(\)\)\.click\(\)/);
assert.doesNotMatch(authCode, /synthetic@example/);
const oldNavigation = structuredClone(auth);oldNavigation.actions[0].navigationCause = 'unknown';
assert.ok(mapRecording(oldNavigation).needsReview.some(step => step.failure === 'navigationCausality'));
console.log('PASS persisted user bindings compose scoped authentication while navigation causality remains independent');
