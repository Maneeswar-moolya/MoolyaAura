import '../testing/isolated-checkout';
/**
 * The offline gate for Phase 5. No browser, no model, no network, no writes.
 *
 * It runs the REAL functions - `extractRequirements`, `selectPageKnowledge`,
 * `assessSufficiency`, `assessBrowserNeed` - over every row of the real workbook, and
 * over synthetic rows for the regressions the workbook cannot express (the row that
 * produced `notifications`/`bell` was a benchmark row and no longer exists).
 *
 * Two invariants matter more than the counts:
 *
 *   1. No new exploration. A phrase can only be a gap if one of its words was already a
 *      gap, so the set of rows that open a browser must be a SUBSET of the old set. A
 *      row that gains a browser is a regression, not an improvement.
 *   2. Genuine UI requirements survive. An element nothing describes - the issue
 *      statistics panel - must still open one. The notifications bell used to be
 *      this example and no longer can be: knowledge now covers it, so it is the
 *      example of the opposite, and section 4 asserts both halves.
 *
 * Run: npx tsx ai/knowledge/requirements.fixture.ts
 */

import { assessBrowserNeed, assessSufficiency, isInspectableTermForTest, oldTermDecisionsForTest, readAllPageKnowledge, selectPageKnowledge } from './page-knowledge';
import { clausesForTest, extractRequirements, inspectableRequirements } from './requirements';
import { buildIndex } from './index';
import { parseWorkbook } from '../excel/parser';
import { NEEDS_CONFIRMATION, RECORDED_INTERACTION } from '../dashboard/placeholders';
import type { TestCase } from '../excel/types';

const WORKBOOK = 'excel/fixture-cases.xlsx';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    console.log(`  ok    ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

/** The old extractor, copied verbatim so before/after is measured, not remembered. */
const OLD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'then', 'when', 'should',
  'page', 'test', 'user', 'click', 'open', 'check', 'verify', 'enter', 'select', 'displayed',
  'shown', 'able', 'must', 'will', 'have', 'has', 'are', 'was', 'not', 'button', 'field',
  'fixtureapp', 'application', 'valid', 'invalid', 'correct', 'successfully', 'without',
  'given', 'their', 'they', 'them', 'all', 'any', 'each', 'new', 'via', 'using', 'after',
  'before', 'again', 'also', 'only', 'same', 'other', 'step', 'steps', 'case', 'expected',
  'result', 'navigate', 'navigates', 'navigated', 'goes', 'sees', 'see', 'show', 'shows',
]);

function oldTerms(testCase: TestCase): string[] {
  const text = [testCase.scenario, testCase.steps.join(' '), testCase.expectedResult]
      .filter(Boolean).join(' ');
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
      .filter(word => word.length > 3 && !OLD_STOPWORDS.has(word)))];
}

function synthetic(overrides: Partial<TestCase>): TestCase {
  return {
    testCaseId: 'TC_FIXTURE_000', module: '', feature: '', scenario: '', description: '',
    preconditions: '', steps: [], testData: '', expectedResult: '', priority: 'P1' as TestCase['priority'],
    tags: [], automationStatus: 'Not Automated' as TestCase['automationStatus'], automationNotes: '',
    execute: null, expectedOutcome: '', expectedMessage: '',
    requirementId: '', testType: '' as TestCase['testType'],
    businessRisk: '' as TestCase['businessRisk'], environment: '', userRole: '',
    authenticationProfile: '', testOwner: '',
    source: { workbookPath: '', workbook: 'fixture.xlsx', worksheet: 'Fixture', row: 2 },
    extra: {}, issues: [], ...overrides,
  };
}

const knowledge = readAllPageKnowledge();
const methods = Object.values(buildIndex().pages).flatMap(entry => entry.methods.map(method => method.name));

function assess(testCase: TestCase) {
  const matches = selectPageKnowledge(testCase, knowledge);
  const sufficiency = assessSufficiency(testCase, matches, methods);
  return { matches, sufficiency, need: assessBrowserNeed(sufficiency) };
}

console.log('\n=== 1. Clause segmentation: protected spans\n');
{
  const clauses = clausesForTest('Check Terms and Conditions page is opening');
  check('"Terms and Conditions" is never split', clauses.length === 1, JSON.stringify(clauses));

  const two = clausesForTest('Click Save and check the toast appears');
  check('" and " before a verb does split', two.length === 2, JSON.stringify(two));

  const quoted = clausesForTest('Verify the heading reads "All Projects"');
  check('quoted copy survives', quoted[0].includes('All Projects'), JSON.stringify(quoted));
}

console.log('\n=== 2. Classification of the four classes\n');
{
  const a = extractRequirements(synthetic({ expectedResult: 'The Create Project button is displayed' }));
  check('A: UI-observable is found', a.counts.uiObservableCount === 1, JSON.stringify(a.requirements.map(r => r.phrase)));

  const b = extractRequirements(synthetic({ steps: ['Click the Sign In button'] }));
  check('B: action target is a phrase, not words', b.requirements[0]?.class === 'action'
    && b.requirements[0].phrase.includes('sign in'), JSON.stringify(b.requirements.map(r => r.phrase)));

  const c = extractRequirements(synthetic({ expectedResult: 'Password is too short' }));
  check('C: business assertion, not a UI requirement',
      c.counts.businessAssertionCount === 1 && inspectableRequirements(c).length === 0,
      JSON.stringify(c.requirements.map(r => `${r.phrase}:${r.class}`)));

  const cPromoted = extractRequirements(synthetic({
    expectedResult: 'The password field displays an error when the password is too short',
  }));
  check('C promoted to A when a surface shows it', cPromoted.counts.uiObservableCount >= 1,
      JSON.stringify(cPromoted.requirements.map(r => `${r.phrase}:${r.class}`)));

  const d = extractRequirements(synthetic({ expectedResult: 'It should work properly and cleanly' }));
  check('D: generic prose is dropped, not turned into a gap',
      d.counts.requirementCount === 0 && d.counts.genericDroppedCount > 0,
      JSON.stringify(d.dropped.map(item => item.reason)));
}

console.log('\n=== 3. Regression A: placeholder prose must not open a browser\n');
{
  // TC_LOGIN_028's shape: a recorded row on a screen the knowledge already describes,
  // whose Expected Result is the placeholder. The screen matters - a row with no
  // knowledge at all is verdict `none` and must still open a browser, which is checked
  // separately below.
  const placeholder = synthetic({
    scenario: 'Strong',
    module: 'Login',
    steps: ['Open the sign in page', 'Enter the email address', 'Enter the password'],
    expectedResult: NEEDS_CONFIRMATION,
    tags: [],
  });
  const extraction = extractRequirements(placeholder);
  const { need } = assess(placeholder);

  check('"Needs confirmation" is dropped as a placeholder',
      extraction.counts.placeholderDroppedCount >= 1, JSON.stringify(extraction.dropped.map(d => d.clause)));
  check('placeholder row opens no browser', need.required === false, need.reason);
  for (const word of ['needs', 'confirmation', 'recorded', 'strong'])
    check(`"${word}" is not an inspectable gap`, !need.inspectable.includes(word),
        JSON.stringify(need.inspectable));

  const scenarioOnly = synthetic({ scenario: 'Strong password meter shows a bell icon', steps: ['Do the thing'] });
  check('scenario alone creates no requirement',
      extractRequirements(scenarioOnly).counts.requirementCount === 0,
      JSON.stringify(extractRequirements(scenarioOnly).requirements.map(r => r.phrase)));
  check('RECORDED_INTERACTION is the shared constant', RECORDED_INTERACTION === 'Recorded interaction');

  // The conservative default is untouched: no knowledge for the screen still means look
  // at it. Phase 5 narrows what counts as a requirement, it does not make silence safe.
  const unknownScreen = synthetic({
    module: 'Billing', scenario: 'Invoice export',
    steps: ['Open the invoices page', 'Click the Export button'],
    expectedResult: 'The download starts',
  });
  check('a screen with no knowledge still opens a browser',
      assess(unknownScreen).need.required === true, assess(unknownScreen).sufficiency.verdict);
}

console.log('\n=== 4. Regression B: TC_RECBENCH_003 must still open a browser\n');
{
  const genuine = synthetic({
    testCaseId: 'TC_RECBENCH_003',
    scenario: 'Notifications bell',
    steps: ['Sign in', 'Click the notifications bell in the header'],
    expectedResult: 'The notifications bell is displayed',
  });
  const extraction = extractRequirements(genuine);
  console.log(`      requirements: ${extraction.requirements.map(r => `${r.phrase} [${r.class}]`).join(' | ')}`);
  check('the bell is extracted as a UI requirement',
      extraction.requirements.some(r => r.phrase.includes('bell') && r.class === 'ui-observable'));

  // THE BELL IS NO LONGER THE EXAMPLE OF AN UNCOVERED ELEMENT, because it is now
  // covered: `fixtureapp__apps.yaml` declares it (WorkspacePage.notificationsBell,
  // NotificationsPanel.panel, .settingsButton). A row about it is answered from
  // knowledge and correctly opens nothing - which is the POINT of knowledge, not a
  // regression in this gate.
  //
  // So the coverage half of this regression moves to an element nothing describes
  // yet. The issue statistics panel is a real FixturePortal element (`#issue_stats_section`,
  // seen in the recorded evidence), is on no page object and in no knowledge file,
  // and is not one of the deliberately excluded third-party widgets. The assertions
  // below are unchanged in kind and in strength: a genuine UI requirement that
  // knowledge cannot answer must still send somebody to look at the screen.
  const covered = assess(genuine);
  check('the bell is now ANSWERED FROM KNOWLEDGE, so it opens no browser',
      covered.need.required === false,
      `${covered.sufficiency.verdict}: ${covered.need.reason}`);

  const uncovered = synthetic({
    testCaseId: 'TC_RECBENCH_003',
    scenario: 'Issue statistics panel',
    steps: ['Sign in', 'Open a project and view the issue statistics panel'],
    expectedResult: 'The issue statistics panel is displayed and shows the issue counts',
  });
  const uncoveredExtraction = extractRequirements(uncovered);
  const { need, sufficiency } = assess(uncovered);
  console.log(`      requirements: ${uncoveredExtraction.requirements.map(r => `${r.phrase} [${r.class}]`).join(' | ')}`);
  check('the statistics panel is extracted as a UI requirement',
      uncoveredExtraction.requirements.some(r => r.phrase.includes('statistics') && r.class === 'ui-observable'),
      JSON.stringify(uncoveredExtraction.requirements.map(r => `${r.phrase} [${r.class}]`)));
  check('TC_RECBENCH_003 still opens a browser', need.required === true,
      `${sufficiency.verdict}: ${need.reason}`);
  check('and it opens for the panel, not for prose',
      need.inspectable.some(gap => gap.includes('statistics') || gap.includes('panel')),
      JSON.stringify(need.inspectable));

  // The replacement is only a valid stand-in while nothing describes it. If a later
  // phase gives the statistics panel a page object, this says so instead of quietly
  // going green for the wrong reason.
  check('the replacement is genuinely uncovered - no method and no knowledge entry',
      !methods.some(name => /issueStats|statisticsPanel/i.test(name))
      && !knowledge.some(page => page.elements.some(element =>
        /issue_stats|statistics/i.test(element.id)
        || /statistics panel/i.test(element.description ?? ''))),
      'no page object method and no knowledge element describes it');

  const bare = extractRequirements(synthetic({ steps: ['Notifications bell'] }));
  check('rule 6: a bare surface phrase with no predicate survives',
      bare.requirements.some(r => r.phrase.includes('bell')),
      JSON.stringify(bare.requirements.map(r => r.phrase)));
}

async function workbookSection(): Promise<void> {
  console.log('\n=== 5. The real workbook: before vs after, every row\n');
  const rows = (await parseWorkbook(WORKBOOK)).testCases;
  let oldBrowser = 0;
  let newBrowser = 0;
  let oldTermTotal = 0;
  let newRequirementTotal = 0;
  let gained = 0;
  const classTotals = { action: 0, ui: 0, business: 0, generic: 0, placeholder: 0 };

  console.log('  ID              old terms  new reqs  A/B/C  dropped  verdict     browser  gaps');
  for (const testCase of rows) {
    const matches = selectPageKnowledge(testCase, knowledge);
    const sufficiency = assessSufficiency(testCase, matches, methods);
    const need = assessBrowserNeed(sufficiency);
    const extraction = extractRequirements(testCase);
    const old = oldTerms(testCase);

    // The old browser decision, recomputed by running the REAL old extractor and the
    // REAL matcher over the same knowledge - not approximated from the new verdict.
    const oldDecisions = oldTermDecisionsForTest(testCase, matches, methods);
    const oldGaps = oldDecisions.filter(d => d.confidence !== 'certain').map(d => d.requirement);
    const oldWouldBrowse = matches.length === 0
      || oldGaps.some(term => isInspectableTermForTest(term));

    oldTermTotal += old.length;
    newRequirementTotal += extraction.counts.requirementCount;
    classTotals.action += extraction.counts.actionCount;
    classTotals.ui += extraction.counts.uiObservableCount;
    classTotals.business += extraction.counts.businessAssertionCount;
    classTotals.generic += extraction.counts.genericDroppedCount;
    classTotals.placeholder += extraction.counts.placeholderDroppedCount;
    if (oldWouldBrowse)
      oldBrowser += 1;
    if (need.required)
      newBrowser += 1;
    if (need.required && !oldWouldBrowse) {
      gained += 1;
      console.log(`      ^ GAINED: ${testCase.testCaseId} new gaps [${need.inspectable.join(", ")}] vs old gaps [${oldGaps.join(", ")}]`);
    }

    console.log('  ' + testCase.testCaseId.padEnd(16)
      + String(old.length).padStart(6)
      + String(extraction.counts.requirementCount).padStart(10)
      + `   ${extraction.counts.actionCount}/${extraction.counts.uiObservableCount}/${extraction.counts.businessAssertionCount}`.padEnd(8)
      + String(extraction.counts.genericDroppedCount + extraction.counts.placeholderDroppedCount).padStart(7)
      + '  ' + sufficiency.verdict.padEnd(11)
      + (need.required ? 'YES    ' : 'no     ')
      + ' ' + need.inspectable.slice(0, 4).join(', '));
  }

  console.log(`\n  rows: ${rows.length}`);
  console.log(`  requirement terms   old ${oldTermTotal} -> new ${newRequirementTotal}`);
  console.log(`  classes             action ${classTotals.action}, ui-observable ${classTotals.ui}, business ${classTotals.business}`);
  console.log(`  dropped             generic ${classTotals.generic}, placeholder ${classTotals.placeholder}`);
  console.log(`  rows opening a browser   old ${oldBrowser} -> new ${newBrowser}`);
  check('INVARIANT: no row gains a browser it did not have', gained === 0, `${gained} row(s) gained one`);
  check('fewer rows open a browser', newBrowser <= oldBrowser, `${oldBrowser} -> ${newBrowser}`);
}

void workbookSection().then(() => {
  console.log(`\n${failures ? 'FAIL' : 'PASS'} - ${checks - failures}/${checks} checks\n`);
  process.exit(failures ? 1 : 0);
});
