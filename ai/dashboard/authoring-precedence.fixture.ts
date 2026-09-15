import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { workspaceData } from '../testing/workspace-data';
import { recordingSource } from '../testing/synthetic-data';
import { parseRecording } from './recorder';
import { ownershipReview, pageCatalog } from './page-ownership';
import { createLogicalPage, createPageObject, createAuthoringMethod } from './authoring-catalog';
import { executableBinding } from '../knowledge/authoring-owners';
import { mapRecording } from '../autocode/from-recording';
import { evidenceAbsence } from '../autocode/dom-evidence';

/**
 * A PAGE OBJECT BEING NEARBY IS NOT A DECISION ABOUT HOW TO RUN A STEP.
 *
 * Page/Page Object context INHERITS down a screen, and the method deliberately does not - the
 * method that finds the email box must never silently become the method that finds the
 * password box. What was wrong is what the inherited, method-less context was then called.
 * It was written as `provenance: USER_CONFIRMED` with `explicit: false`, `method: null` and
 * `executionMode: AUTO`: a state that reads as a completed mapping in Recording Review and is
 * one nowhere else. Generation found no binding there, fell through to automatic inference,
 * and refused the step for missing interaction-time identity evidence - true about the
 * evidence, misleading about the cause, and unfixable by re-recording, because nothing had
 * ever said how to run it.
 *
 * Three states now, and the middle one is the point: AUTO, USER_BINDING_INCOMPLETE,
 * USER_CONFIRMED. The AUTO evidence gate is untouched.
 */
const { scope } = workspaceData();
let checks = 0;
const check = (name: string, run: () => void) => {
  try { run(); } catch (e: any) { throw new Error(`FAIL ${name}: ${e?.message ?? e}`); }
  checks++; console.log('PASS ' + name);
};

// The synthetic project declares no credentials fixture, and without one the sign-in span is
// refused before authoring is even consulted - which would hide the very thing under test.
// Declared here so the authentication contracts below measure the authoring decision.
{
  const file = scope.paths.fixturesFile;
  const source = fs.readFileSync(file, 'utf8')
    .replace('interface Fixtures {', 'interface Fixtures {\n  appCredentials: { email: string; password: string };')
    .replace('  // <page-object-fixtures>',
      "  appCredentials: async ({}, use) => { await use({ email: process.env.FIXTURE_EMAIL ?? '', password: process.env.FIXTURE_PASSWORD ?? '' }); },\n  // <page-object-fixtures>");
  fs.writeFileSync(file, source, 'utf8');
}

createLogicalPage(scope, { name: 'Sign in', route: '/home', description: 'Credential screen' });
createPageObject(scope, 'Sign in', 'SignInPage');
createAuthoringMethod(scope, 'SignInPage', 'emailField', "page.getByRole('textbox', { name: 'Email' })");
createAuthoringMethod(scope, 'SignInPage', 'passwordField', "page.getByRole('textbox', { name: 'Password' })");
createAuthoringMethod(scope, 'SignInPage', 'signInButton', "page.getByRole('button', { name: 'Sign in' })");
createLogicalPage(scope, { name: 'Menu', route: '/home', description: 'Header menu' });
createPageObject(scope, 'Menu', 'MenuPage');

// Shaped like the real recording this came from: a sign-in whose password the recorder has
// already redacted, a CHAIN of browser-managed redirects behind it, a menu click, and one more
// redirect behind that. Action indices are the step keys.
//   0 fill Email   1 fill Password   2 click Sign in   3,4 redirect chain
//   5 click My Cases   6 redirect
const source = recordingSource([
  `await page.getByRole('textbox', { name: 'Email' }).fill('person@example.invalid');`,
  `await page.getByRole('textbox', { name: 'Password' }).fill('[type=password]');`,
  `await page.getByRole('button', { name: 'Sign in' }).click();`,
  `await page.goto("[navigation withheld]"); // @aura-navigation unknown id=nav-2 reason=no-browser-evidence documents=0 history=0 other=0 unresolved=0`,
  `await page.goto("[navigation withheld]"); // @aura-navigation unknown id=nav-3 reason=no-browser-evidence documents=0 history=0 other=0 unresolved=0`,
  `await page.getByRole('menuitem', { name: 'My Cases' }).click();`,
  `await page.goto("[navigation withheld]"); // @aura-navigation unknown id=nav-4 reason=no-browser-evidence documents=0 history=0 other=0 unresolved=0`,
]);
/** No evidence at all: every contract below is about authoring, not about measurement. */
const recording = () => parseRecording(source, { startUrl: 'https://portal.example.invalid/home',
  browser: 'chromium', durationMs: 0,
  evidence: { available: false, reason: 'synthetic authoring precedence contract' } as any });
const bind = (over: Record<string, any>) => ownershipReview(scope, recording(), over);
const app = scope.applicationId;
const method = (pageObject: string, name: string) =>
  ({ applicationId: app, page: 'Sign in', pageObject, method: name, executionMode: 'PAGE_OBJECT_METHOD' });

// ---- 1. What "completed" means, stated once, before anything depends on it.
check('the executable predicate is the single definition of a completed mapping', () => {
  assert.equal(executableBinding({ pageObject: 'SignInPage', method: 'emailField', executionMode: 'PAGE_OBJECT_METHOD' } as any), 'PAGE_OBJECT_METHOD');
  assert.equal(executableBinding({ pageObject: 'MenuPage', executionMode: 'RECORDED_LOCATOR' } as any), 'RECORDED_LOCATOR');
  assert.equal(executableBinding({ pageObject: 'SignInPage', method: null, executionMode: 'AUTO' } as any), false,
    'Page Object plus AUTO is the contradictory state and is never executable');
  assert.equal(executableBinding(null), false);
});

// ---- 2. Inherited context is NOT a completed mapping.
check('a Page Object inherited from the previous step is USER_BINDING_INCOMPLETE, not confirmed', () => {
  const steps = bind({ 'action:0': method('SignInPage', 'emailField') }).steps;
  assert.equal(steps[0].provenance, 'USER_CONFIRMED', 'the step the user actually bound');
  assert.equal(steps[1].provenance, 'USER_BINDING_INCOMPLETE',
    'the next step inherits the Page Object as CONTEXT and must not wear a completed mapping\'s label');
  assert.equal(steps[1].userSelection?.method, null, 'the method still does not inherit');
  assert.equal(steps[1].explicit, false);
});
check('a step with no authoring at all is still plain AUTO', () => {
  const steps = bind({}).steps;
  assert.equal(steps[0].provenance, 'AUTO');
  assert.equal(steps[0].userSelection, null);
});
// ---- 3. Save Mapping refuses to persist the contradictory state, and says what to choose.
check('saving a Page Object with nothing to run is refused as USER_BINDING_INCOMPLETE', () => {
  assert.throws(() => bind({ 'action:1': { applicationId: app, page: 'Sign in', pageObject: 'SignInPage', method: null, executionMode: 'AUTO' } }),
    /USER_BINDING_INCOMPLETE at action:1/);
});
check('the refusal names the choices rather than the failure', () => {
  try { bind({ 'action:5': { applicationId: app, page: 'Menu', pageObject: 'MenuPage', method: null, executionMode: 'AUTO' } }); assert.fail('expected a refusal'); }
  catch (error: any) {
    assert.match(error.message, /choose recorded-locator execution/i);
    assert.match(error.message, /create the method this step needs/i);
  }
});
check('a Page Object carrying methods lists them in the refusal', () => {
  try { bind({ 'action:1': { applicationId: app, page: 'Sign in', pageObject: 'SignInPage', method: null, executionMode: 'AUTO' } }); assert.fail('expected a refusal'); }
  catch (error: any) { assert.match(error.message, /emailField/); assert.match(error.message, /signInButton/); }
});

// ---- 4. Explicit bindings execute with ZERO DOM evidence. Authentication included.
const mapWith = (over: Record<string, any>) => {
  const parsed = recording();
  const review = ownershipReview(scope, parsed, over);
  parsed.authoringOwners = { version: 1, applicationId: app, recordingHash: '',
    choices: review.steps.map(({ key, recommended, confirmed, route, explicit, provenance, userSelection, frameworkRecommendation }) =>
      ({ key, recommended, confirmed, route, explicit, provenance, userSelection, frameworkRecommendation })), pages: [] } as any;
  return mapRecording(parsed);
};
const explicitAll = {
  'action:0': method('SignInPage', 'emailField'),
  'action:1': method('SignInPage', 'passwordField'),
  'action:2': method('SignInPage', 'signInButton'),
  'action:5': { applicationId: app, page: 'Menu', pageObject: 'MenuPage', executionMode: 'RECORDED_LOCATOR' },
};
// Each credential field separately: one of the three failing is a different defect from all
// three failing, and a single combined assertion cannot tell them apart.
const authWhy = (over: Record<string, any>) => mapWith(over).steps
  .filter(step => step.failure === 'authenticationCapability').map(step => step.why).join(' | ');
// ONE CONTRACT FOR THE WHOLE CREDENTIAL SPAN, and deliberately not three.
//
// The span is planned atomically - "plan the whole credential span before emitting any part of
// it; never emit partial credentials" - so if any one control fails to resolve, none of the
// three is emitted. That is the right behaviour and it means email, password and submit cannot
// be told apart by inspecting the output. Splitting this into three contracts would assert a
// distinction the design refuses to make; the three mutants below break it three different
// ways and all land here.
check('every explicitly bound credential control is used, with no automatic identity demanded', () => {
  const steps = JSON.stringify(mapWith(explicitAll).steps);
  assert.match(steps, /emailField/, 'the bound email capability is the one used');
  assert.match(steps, /passwordField/, 'the bound password capability is the one used');
  assert.match(steps, /signInButton/, 'the bound submit capability is the one used');
  assert.equal(authWhy(explicitAll), '',
    'a control the user bound is never sent back through the automatic identity gate');
});
check('authentication with NO explicit binding is still refused - AUTO is untouched', () => {
  assert.notEqual(authWhy({}), '', 'an unbound sign-in with no evidence may not become executable');
});
check('a USER_CONFIRMED Page Object method runs with no DOM evidence whatsoever', () => {
  const mapping = mapWith(explicitAll);
  const bound = mapping.steps.filter(step => step.pageObject === 'SignInPage');
  assert.ok(bound.length, 'the explicit methods were used: ' + JSON.stringify(mapping.steps.map(s => s.why).slice(0, 4)));
  assert.equal(mapping.steps.some(step => step.failure === 'userBindingIncomplete'), false);
});
check('a USER_CONFIRMED recorded locator runs with no DOM evidence whatsoever', () => {
  const mapping = mapWith(explicitAll);
  assert.equal(mapping.steps.some(step => step.failure === 'userBindingIncomplete'), false,
    'the recorded-locator election is an execution choice and needs no automatic proof');
});
check('an explicitly bound sign-in composes from the credential fixture, not literals', () => {
  const code = JSON.stringify(mapWith(explicitAll).steps.map(step => step.code));
  assert.match(code, /appCredentials/, 'the sign-in reads its account from the execution profile');
  assert.ok(!code.includes('[type=password]'), 'the password placeholder is never emitted as a value');
});

// ---- 5. NAVIGATION CAUSALITY. A browser-managed redirect has no DOM target to prove.
check('a navigation after a confirmed action is provenance, not a review block', () => {
  const mapping = mapWith(explicitAll);
  const navigation = mapping.steps.filter(step => step.subject === 'navigation');
  assert.ok(navigation.length, 'the navigation is still recorded');
  assert.equal(navigation.some(step => step.failure === 'navigationCausality'), false,
    'a redirect caused by a step the user confirmed must not block assembly');
  assert.match(navigation.map(step => step.why).join(' '), /USER_CONFIRMED step/);
  assert.deepEqual(navigation.flatMap(step => step.code), [],
    'and nothing is replayed - the destination is never claimed');
});
check('a navigation with no confirmed action behind it still blocks', () => {
  const mapping = mapWith({});
  assert.ok(mapping.steps.some(step => step.failure === 'navigationCausality'),
    'genuinely unproven navigation keeps its protection');
});
check('a chain of redirects shares the one cause that produced it', () => {
  const navigation = mapWith(explicitAll).steps.filter(step => step.subject === 'navigation');
  // Three browser navigations: two behind the sign-in, one behind the menu click.
  assert.equal(navigation.length, 3, 'every navigation is accounted for, none dropped');
  const attributed = navigation.map(step => /action:(\d+)/.exec(step.why)?.[1]);
  assert.deepEqual(attributed, ['2', '2', '5'],
    'the redirect chain is attributed to the click that started it, not to the redirect before it');
});
check('no navigation destination is ever invented', () => {
  const navigation = mapWith(explicitAll).steps.filter(step => step.subject === 'navigation');
  assert.deepEqual(navigation.flatMap(step => step.code), [], 'nothing is replayed');
  assert.ok(!JSON.stringify(navigation).includes('goto'), 'and no destination is reconstructed');
});

// ---- 6. AUTO is untouched.
check('an AUTO step with zero evidence is still refused', () => {
  const mapping = mapWith({});
  assert.ok(mapping.needsReview.length || mapping.steps.some(step => step.failure),
    'automatic inference without evidence must not become executable');
  assert.equal(mapping.steps.some(step => step.failure === 'userBindingIncomplete'), false,
    'and a step nobody touched is not an incomplete BINDING - there is no binding');
});
check('generation never silently demotes started authoring to AUTO', () => {
  // The inherited-context shape, reaching generation exactly as TC_SMOKE_031's did.
  const mapping = mapWith({ 'action:0': method('SignInPage', 'emailField') });
  const incomplete = mapping.steps.filter(step => step.failure === 'userBindingIncomplete');
  assert.ok(incomplete.length, 'the inherited step is reported, not quietly inferred');
  assert.match(incomplete[0].why, /USER_BINDING_INCOMPLETE/);
  assert.match(incomplete[0].why, /SignInPage/, 'and names the Page Object that was associated');
  assert.doesNotMatch(incomplete[0].why, /evidence/i,
    'the cause is the missing choice, never the missing evidence');
});

// ---- 7. BROKEN is not INCOMPLETE. A binding that named something real and lost it is a
// different fact from one that never named anything, and the two must not be merged.
check('a selected method that disappears is USER_BINDING_BROKEN, not incomplete', () => {
  const parsed = recording();
  parsed.authoringOwners = { version: 1, applicationId: app, recordingHash: '', pages: [],
    choices: [{ key: 'action:0', recommended: null, confirmed: 'SignInPage', route: null, explicit: true,
      provenance: 'USER_CONFIRMED', frameworkRecommendation: { pageObject: null },
      userSelection: method('SignInPage', 'methodThatWasDeleted') }] } as any;
  assert.throws(() => mapRecording(parsed), /USER BINDING BROKEN/,
    'a method the user chose and that no longer exists is reported, never quietly re-inferred');
});
check('a Page Object that disappears is USER_BINDING_BROKEN', () => {
  const parsed = recording();
  parsed.authoringOwners = { version: 1, applicationId: app, recordingHash: '', pages: [],
    choices: [{ key: 'action:0', recommended: null, confirmed: 'GonePage', route: null, explicit: true,
      provenance: 'USER_CONFIRMED', frameworkRecommendation: { pageObject: null },
      userSelection: { applicationId: app, page: 'Sign in', pageObject: 'GonePage', method: 'whatever', executionMode: 'PAGE_OBJECT_METHOD' } }] } as any;
  assert.throws(() => mapRecording(parsed), /USER BINDING BROKEN/);
});
check('an incomplete binding claiming to be executable is refused as broken', () => {
  const parsed = recording();
  parsed.authoringOwners = { version: 1, applicationId: app, recordingHash: '', pages: [],
    choices: [{ key: 'action:0', recommended: null, confirmed: 'SignInPage', route: null, explicit: true,
      provenance: 'USER_BINDING_INCOMPLETE', frameworkRecommendation: { pageObject: null },
      userSelection: method('SignInPage', 'emailField') }] } as any;
  assert.throws(() => mapRecording(parsed), /USER BINDING BROKEN/,
    'the label and the binding must agree; a hand-edited sidecar cannot smuggle one past the other');
});

// ---- 8. RECORDED LOCATOR: an execution choice, and a test-specific one.
check('an explicit recorded-locator choice persists as USER_CONFIRMED and explicit', () => {
  const step = bind({ 'action:5': { applicationId: app, page: 'Menu', pageObject: 'MenuPage', executionMode: 'RECORDED_LOCATOR' } })
    .steps.find(row => row.key === 'action:5')!;
  assert.equal(step.provenance, 'USER_CONFIRMED', 'electing the recorded locator IS an execution choice');
  assert.equal(step.explicit, true);
  assert.equal(step.userSelection?.executionMode, 'RECORDED_LOCATOR');
  assert.equal(step.userSelection?.method, undefined, 'and it names no method, by design');
});
check('a recorded locator executes for its own step and is marked not validated', () => {
  const mapping = mapWith(explicitAll);
  const step = mapping.steps.find(row => row.diagnostic?.recordingStepKey === 'action:5');
  assert.ok(step, 'the step was assembled');
  assert.equal(step!.diagnostic?.executionMode, 'RECORDED_LOCATOR');
  assert.match(String(step!.diagnostic?.validationStatus), /NOT VALIDATED/,
    'a locator the user vouched for is user authored, never automatically validated');
});
check('an unvalidated recorded locator does not become trusted AUTO knowledge', () => {
  // The Page Object the user pointed at gains nothing from the step having run.
  const before = pageCatalog(scope).find(page => page.name === 'MenuPage')!.methods.slice();
  mapWith(explicitAll);
  const after = pageCatalog(scope).find(page => page.name === 'MenuPage')!.methods;
  assert.deepEqual(after, before, 'no capability is written back from a recorded-locator election');
  assert.equal(after.length, 0, 'MenuPage still declares nothing automatic inference may reuse');
});
check('the recorded locator is bound to this step, not adopted for the identical locator elsewhere', () => {
  // action:5 elects the recorded locator; nothing else in the recording inherits that election.
  const steps = bind({ 'action:5': { applicationId: app, page: 'Menu', pageObject: 'MenuPage', executionMode: 'RECORDED_LOCATOR' } }).steps;
  for (const step of steps.filter(row => row.key !== 'action:5'))
    assert.notEqual(step.userSelection?.executionMode, 'RECORDED_LOCATOR',
      `${step.key} inherited an execution choice that belongs to action:5`);
});

// ---- 9. Evidence absence is named by TRANSPORT, not by date.
check('a codegen recording is not labelled a legacy artifact', () => {
  const verdict = evidenceAbsence({ available: false,
    reason: 'no DOM evidence was captured: parsed from the Codegen script alone' });
  assert.equal(verdict.code, 'CODEGEN_NO_BROWSER_EVIDENCE');
  assert.match(verdict.reason, /live recorder/, 'and the remedy is the transport, not the calendar');
  assert.doesNotMatch(verdict.reason, /before press-time capture existed/);
});
check('a live capture that produced nothing is its own state', () => {
  const verdict = evidenceAbsence({ available: false, reason: 'located no target in this recording' });
  assert.equal(verdict.code, 'CURRENT_RECORDING_EVIDENCE_CAPTURE_FAILED');
});
check('a genuinely legacy recording keeps the legacy wording', () => {
  assert.equal(evidenceAbsence({ available: false }).code, 'LEGACY_NO_EVIDENCE');
  assert.match(evidenceAbsence(null).reason, /before press-time capture existed/);
});

console.log(`${checks} authoring precedence contracts passed`);
