/**
 * An authored locator is refused for the rule it actually broke.
 *
 * THE DEFECT THIS EXISTS TO STOP COMING BACK
 *
 * Five independent rules shared one sentence: "Enter a supported Playwright locator
 * expression beginning with page." A recorded chain like
 * `page.locator('div').filter({ hasText: '...' }).nth(1)` begins with `page.` - the
 * person could read that on the screen - and was refused for its `.nth(1)`. So the
 * screen told them to fix the one thing that was already right, and the rule that did
 * the refusing was never named. A gate nobody can act on is a gate people route around.
 *
 * NOTHING HERE RELAXES THE GATE. `.nth()` is still refused. What changes is that the
 * refusal says which rule spoke and what to do instead, and that it is said at the point
 * the person is still choosing rather than after a transaction has been attempted.
 */
import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceData } from '../testing/workspace-data';
import { authoringLocatorProblem, validateAuthoringLocator, prepareAuthoringMethod } from './authoring-catalog';
import { ownershipReview } from './page-ownership';
import { saveRecordingMapping, recordingMappingReview } from './recording-mapping';
import { validateCandidate } from '../autocode/abstraction/validate';
import { parseRecording } from './recorder';
import { recordingSource, targetEvidence, measurement } from '../testing/synthetic-data';

/** The exact expression the live dashboard submitted for the Account Settings step. */
const RECORDED_POSITIONAL = "page.locator('div').filter({ hasText: 'Close1closeSELECTED ASSETS' }).nth(1)";
const STABLE = "page.getByRole('menuitem', { name: 'Account Settings' })";

function main() {
  const { scope } = workspaceData();
  let checks = 0;
  const check = (condition: unknown, what: string) => { assert.ok(condition, what); checks++; };

  /* 1. An unsupported locator reports the rule that refused it. */

  const positional = authoringLocatorProblem(RECORDED_POSITIONAL);
  check(positional?.code === 'POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN',
    `the positional chain is refused for its position, not for something else: ${positional?.code}`);
  check(/\.nth\(\)/.test(positional!.message), 'the refusal names the mechanism it found');
  check(/role and accessible name|test id|stable attribute/.test(positional!.message),
    'the refusal says what to author instead');

  for (const [expression, code] of [
    ["locator('div')", 'UNSUPPORTED_LOCATOR_ROOT'],
    ['this.page.getByRole(\'button\')', 'UNSUPPORTED_LOCATOR_ROOT'],
    ["page.getByRole('button').click({ force: true })", 'FORBIDDEN_MECHANISM'],
    ["page.getByRole('button', { name: 'x' }).first()", 'POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN'],
    ["page.getByRole('button', { name: 'x'", 'MALFORMED_LOCATOR_EXPRESSION'],
    ["page.locator('a').evaluate(() => 1)", 'UNSUPPORTED_LOCATOR_CALL'],
    ["page.locator('div').filter({ hasText: 'a' + 'b' })", 'EXECUTABLE_LOCATOR_EXPRESSION'],
  ] as const) check(authoringLocatorProblem(expression)?.code === code,
    `${expression} -> ${code}, got ${authoringLocatorProblem(expression)?.code}`);

  /* 2. A locator that VISIBLY begins with page is never told to begin with page. */

  const visiblyRooted = [RECORDED_POSITIONAL, "page.getByRole('button', { name: 'x' }).first()",
    "page.getByRole('button').click({ force: true })"];
  for (const expression of visiblyRooted) {
    check(expression.startsWith('page.'), 'the expression visibly starts at the page');
    const problem = authoringLocatorProblem(expression)!;
    check(problem.code !== 'UNSUPPORTED_LOCATOR_ROOT',
      `${expression} must not be blamed on its root`);
    check(!/beginning with page|start at the page/.test(problem.message),
      `${expression} must not be told to start at the page: ${problem.message}`);
    // And the thrown form carries the same code, so a server refusal is greppable.
    try { validateAuthoringLocator(expression); assert.fail('must refuse'); }
    catch (error) { check(String((error as Error).message).startsWith(problem.code),
      'the thrown refusal leads with its code'); }
  }

  /* 3. An unproven position stays refused - authoring has no measurement to admit one. */

  check(authoringLocatorProblem(RECORDED_POSITIONAL) !== null, 'an unproven .nth() is refused');
  check(authoringLocatorProblem("page.locator('div').filter({ hasText: 'Close1closeSELECTED ASSETS' })") === null,
    'the SAME chain without the position is accepted, so .filter() is not what refused it');

  /* 4. A position the browser measured is still admitted where the contract admits it. */

  // The measurement the contract admits: the BASE expression, the count it matched, and
  // which of those matches was the element pressed - taken at the press, in its document.
  const measuredIndex = measurement("page.locator('.row')",
    { matchCount: 4, positionWithinCandidate: 2, identityMatched: true } as any);
  const positionProven = validateCandidate(targetEvidence("page.locator('.row').nth(2)", {
    route: '/home', documentId: 'home-doc', elementRef: 'home-doc:1',
    derivedCandidates: [], positionProvenCandidates: [measuredIndex],
    target: { tag: 'div', role: 'button', accessibleName: 'Row', accessibleNameVerified: true },
  }) as any);
  check(!positionProven.codes.some((code: any) => code.code === 'FORBIDDEN_MECHANISM'),
    `a measured index is not a forbidden mechanism: ${JSON.stringify(positionProven.codes.map((c: any) => c.code))}`);
  // The SAME shape with the measurement removed. One field is the whole difference.
  const positionUnproven = validateCandidate(targetEvidence("page.locator('.row').nth(2)", {
    route: '/home', documentId: 'home-doc', elementRef: 'home-doc:2',
    derivedCandidates: [], positionProvenCandidates: [
      measurement("page.locator('.row')", { matchCount: 4, identityMatched: true } as any)],
    target: { tag: 'div', role: 'button', accessibleName: 'Row', accessibleNameVerified: true },
  }) as any);
  check(positionUnproven.codes.some((code: any) => code.code === 'FORBIDDEN_MECHANISM'),
    'an index with no measurement behind it is still refused in the generation path');

  /* 5. A stable semantic candidate is accepted and can become a capability. */

  check(authoringLocatorProblem(STABLE) === null, 'a role+name locator is authorable');
  check(authoringLocatorProblem("page.getByTestId('sp-heading')") === null, 'a test id is authorable');
  const file = path.join(scope.paths.pagesDir, 'FirstPage.ts');
  const before = fs.readFileSync(file, 'utf8');
  const written = prepareAuthoringMethod('FirstPage', 'accountSettings', STABLE, file, before);
  check(written.includes('accountSettings()') && written.includes(STABLE),
    'the stable candidate is written into the class');

  /* 6. An invalid locator cannot create a Page Object method, and writes nothing. */

  assert.throws(() => prepareAuthoringMethod('FirstPage', 'servicepreference', RECORDED_POSITIONAL, file, before),
    /POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN/, 'a positional chain cannot become a capability');
  check(fs.readFileSync(file, 'utf8') === before, 'the refused method left the class byte-unchanged');
  checks++;

  /* 7. A refused save keeps the Page, Page Object and method choices it was given. */

  const source = recordingSource([
    `await page.goto('https://portal.example.invalid/home');`,
    `await ${RECORDED_POSITIONAL}.click();`,
  ]);
  const recording = parseRecording(source, { startUrl: 'https://portal.example.invalid/home',
    browser: 'chromium', durationMs: 0 });
  const draft: any = { source, recording };
  const review = recordingMappingReview(scope, draft);
  const step = review.steps.find(item => item.key === 'action:1')!;

  // The verdict travels to the screen, so the refusal is available BEFORE the save.
  check(step.locatorSafety.ok === false, 'the review carries the verdict for this step');
  check((step.locatorSafety as any).code === 'POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN',
    'and it is the same verdict the save would reach');

  const pagesBefore = fs.readdirSync(scope.paths.pagesDir).sort();
  const knowledgeBefore = fs.readdirSync(scope.paths.knowledgePageDir).sort();
  const fixturesBefore = fs.readFileSync(scope.paths.fixturesFile, 'utf8');
  assert.throws(() => saveRecordingMapping(scope, draft, {
    applicationId: scope.applicationId, revision: review.revision, mappingVersion: review.mappingVersion,
    stepKey: 'action:1', page: { name: 'AccountSettingsPage', route: '/account', description: 'Account settings', create: true },
    pageObject: { name: 'AccountSettings', create: true }, executionMode: 'PAGE_OBJECT_METHOD', method: 'servicepreference',
  } as any), /POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN/, 'the save is refused for the position');
  checks++;
  check(JSON.stringify(fs.readdirSync(scope.paths.pagesDir).sort()) === JSON.stringify(pagesBefore),
    'no Page Object was created by the refused save');
  check(JSON.stringify(fs.readdirSync(scope.paths.knowledgePageDir).sort()) === JSON.stringify(knowledgeBefore),
    'no knowledge page was created by the refused save');
  check(fs.readFileSync(scope.paths.fixturesFile, 'utf8') === fixturesBefore,
    'the fixtures file is byte-unchanged after the refusal');
  const after = recordingMappingReview(scope, draft);
  check(after.mappingVersion === review.mappingVersion,
    'the persisted mapping version did not move, so unsaved choices are still valid to retry');
  check(after.steps.find(item => item.key === 'action:1')?.userSelection === null,
    'the refused binding was not half-written onto the step');

  /* 8. Recorded-locator execution is judged by the same rule as a new method. */

  assert.throws(() => saveRecordingMapping(scope, draft, {
    applicationId: scope.applicationId, revision: review.revision, mappingVersion: review.mappingVersion,
    stepKey: 'action:1', executionMode: 'RECORDED_LOCATOR',
  } as any), /POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN/,
    'USER_CONFIRMED does not make an unproven position acceptable');
  checks++;

  /* 9. An existing capability is NOT judged on the recorded chain it did not author. */

  const existing = ownershipReview(scope, recording, {});
  check(existing.steps[0].locatorSafety.ok === false,
    'the step still reports its own recorded locator as unauthorable');
  check(existing.authoring.objects.some(object => object.methods.some(method => method.name === 'control')),
    'the catalog still offers established capabilities to choose instead');

  /* 10. The screen refuses exactly what the server refuses - and nothing more. */

  // The browser's own decision, exercised without a browser: WHEN the recorded locator is
  // the one being authored. It must never re-state the rule - it is handed the verdict - but
  // it does decide whether that verdict applies to the choice in front of the person.
  const ui = require('./public/recording-review.js') as {
    judgesRecordedLocator(state: any, catalog: any): boolean;
    locatorRefusal(step: any, state: any, catalog: any): unknown;
  };
  const catalog = { objects: [{ className: 'AccountSettings', pages: ['ksp_Account-Settings'], methods: [{ name: 'existing' }] }] };
  const onStep = { locator: RECORDED_POSITIONAL, locatorSafety: { ok: false, code: 'POSITIONAL_LOCATOR_NOT_EVIDENCE_PROVEN', message: 'x' } };
  const selection = { page: { name: 'ksp_Account-Settings' }, pageObject: { name: 'AccountSettings' } };

  check(ui.judgesRecordedLocator({ ...selection, executionMode: 'PAGE_OBJECT_METHOD', method: 'servicepreference' }, catalog),
    'a NEW method authors the recorded locator, so it is judged');
  check(!!ui.locatorRefusal(onStep, { ...selection, executionMode: 'PAGE_OBJECT_METHOD', method: 'servicepreference' }, catalog),
    'and Save is refused before the transaction');
  check(!ui.judgesRecordedLocator({ ...selection, executionMode: 'PAGE_OBJECT_METHOD', method: 'existing' }, catalog),
    'an ESTABLISHED capability runs its own declared locator, so the recorded chain is not judged');
  check(!ui.locatorRefusal(onStep, { ...selection, executionMode: 'PAGE_OBJECT_METHOD', method: 'existing' }, catalog),
    'and choosing it is not blocked by the recorded chain');
  check(ui.judgesRecordedLocator({ ...selection, executionMode: 'RECORDED_LOCATOR', method: '' }, catalog),
    'recorded-locator execution authors it too');
  check(!ui.judgesRecordedLocator({ ...selection, executionMode: 'RECORDED_LOCATOR', method: '', locatorOverride: STABLE }, catalog),
    'an override is what gets judged instead, so the recorded chain no longer blocks the save');
  check(!ui.judgesRecordedLocator({ ...selection, executionMode: 'AUTO', method: '' }, catalog),
    'Auto authors nothing');
  check(!ui.locatorRefusal({ locator: STABLE, locatorSafety: { ok: true } },
    { ...selection, executionMode: 'PAGE_OBJECT_METHOD', method: 'servicepreference' }, catalog),
    'an acceptable locator never blocks the save');

  console.log(`PASS ${checks} authoring locator safety contracts`);
}

main();
