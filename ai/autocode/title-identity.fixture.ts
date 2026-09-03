/**
 * The identity contract: a derived title and an authored Scenario are different
 * strings that must resolve to the SAME workbook row.
 *
 *   npx tsx ai/autocode/title-identity.fixture.ts
 *
 * TC_LOGIN_121 IS THE CASE THIS FILE EXISTS FOR. Its authored Scenario cell reads
 *
 *   #tr_1749552 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont
 *   > .rounded-checkbox-ui - 1749553 is ticked
 *
 * which is a CSS chain and two generated ids, so the assembler derives a stable title
 * instead. `staticCheck` then required the spec to contain
 * `${testCaseId} - ${authoredScenario}` byte for byte and quarantined the case for
 * carrying a BETTER title than the cell - a green, correct, executable spec, refused
 * for improving its own name. 47 of the corpus's 79 recorded cases were in that state.
 *
 * The justification in the old code was that "mapping sync and results.ts both find
 * the case by it". Neither does, and this file pins that: `results.ts` extracts the ID
 * with a word-boundary match on the title, and `scanSpecs` READS the scenario half out
 * of the spec rather than comparing it to anything. The ID is the identity. The
 * sentence is a label.
 *
 * Offline: no browser, no model, no network, no workbook write.
 */

import * as fs from 'fs';
import * as path from 'path';

import { staticCheck } from './verify';
import { scanSpecs, testTitleFor } from '../excel/mapping';
import { deriveScenarioTitle, unstableTitleReason } from './scenario-title';
import type { MappedStep, MappingResult } from './from-recording';

const ROOT = process.cwd();

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* --------------------------------------------------------------- the fixtures */

/** TC_LOGIN_121's real authored Scenario cell, verbatim. */
const AUTHORED_121 = '#tr_1749552 > .tabulator-cell.tabulator-cell--checkbox > '
  + '.rounded-checkbox-cont > .rounded-checkbox-ui — 1749553 is ticked';

/** The title the assembler derives for it, as observed in the quarantined spec. */
const DERIVED_121 = 'Verify issue checkbox on the Issues page';

/** A spec body carrying one title, with everything else `staticCheck` requires. */
const specWith = (title: string): string => [
  "import { expect, test, trace } from '../fixtures';",
  '',
  "test.describe('Login Test Cases', () => {",
  `  test('${title}', async ({ page, step, issuesPage }) => {`,
  "    await trace({ testCaseId: 'TC_LOGIN_121' });",
  "    await step('click the row checkbox', async () => {",
  "      await (await issuesPage.issueCheckbox('Copy of login')).click();",
  '    });',
  "    await step('the checkbox is ticked', async () => {",
  "      await expect(await issuesPage.issueCheckboxState('Copy of login')).toBeChecked();",
  '    });',
  '  });',
  '});',
  '',
].join('\n');

function step(over: Partial<MappedStep> = {}): MappedStep {
  return {
    kind: 'page-object', label: 'Click the row checkbox', code: ['await x.click();'],
    why: 'reused', from: 'click the row checkbox', ...over,
  } as MappedStep;
}

function mapping(steps: MappedStep[]): MappingResult {
  return {
    steps, fixtures: new Set(['step']), reused: [], unresolved: [], needsReview: [],
    assessments: [], codegenLocators: 0, authenticated: false, orderReconstructed: true,
  } as MappingResult;
}

/* ------------------------------------------- 1: the regression, reproduced ---- */

function checkTheRegression(): void {
  process.stdout.write('\n== TC_LOGIN_121: the exact failure, reproduced ==\n');

  // 1. THE TITLE CAN BE DERIVED. The authored cell cannot name the test.
  check('1: the authored Scenario is refused as a stable title',
      Boolean(unstableTitleReason(AUTHORED_121)), unstableTitleReason(AUTHORED_121) ?? 'accepted');
  const derived = deriveScenarioTitle(mapping([
    step({ pageObject: 'IssuesPage', method: 'issueCheckbox' }),
    step({ pageObject: 'IssuesPage', method: 'issueCheckboxState',
      from: 'assert checked 1749553', label: '1749553 is ticked' }),
  ]));
  check('1: a stable title IS derived from the semantic journey',
      Boolean(derived) && unstableTitleReason(derived!.title) === null,
      derived?.title ?? 'null');

  // 2. THE WORKBOOK CELL IS UNCHANGED. Nothing here writes it, and the deriver is a
  //    pure function of the mapping - it never receives the cell to modify.
  const before = AUTHORED_121;
  deriveScenarioTitle(mapping([step({ pageObject: 'IssuesPage', method: 'issueCheckbox' })]));
  check('2: deriving a title does not touch the authored Scenario', before === AUTHORED_121);

  // 3. THE CORRECT WORKBOOK ROW IS STILL LOCATED, through both real consumers.
  const spec = specWith(`TC_LOGIN_121 - ${DERIVED_121}`);
  const dir = fs.mkdtempSync(path.join(ROOT, '.title-identity-'));
  try {
    fs.writeFileSync(path.join(dir, 'TC_LOGIN_121.spec.ts'), spec, 'utf8');
    const found = scanSpecs(dir);
    check('3: mapping sync finds the row by its Test Case ID',
        found.length === 1 && found[0].testCaseId === 'TC_LOGIN_121',
        found.map(entry => entry.testCaseId).join(', ') || 'none');
    check('3: and it READS the derived scenario rather than requiring the authored one',
        found[0]?.testName === `TC_LOGIN_121 - ${DERIVED_121}`, found[0]?.testName ?? 'none');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // results.ts keys on the same thing: the ID, by word boundary, anywhere in the title.
  const RESULTS_KEY = /\b((?:TC|TS)[_-][A-Za-z0-9_-]+)\b/;
  check('3: results.ts extracts the same ID from the derived title',
      RESULTS_KEY.exec(`TC_LOGIN_121 - ${DERIVED_121}`)?.[1] === 'TC_LOGIN_121');

  // 4. STATIC VERIFICATION SUCCEEDS.
  const problems = staticCheck(spec, 'TC_LOGIN_121', AUTHORED_121);
  check('4: static verification accepts the derived title',
      problems.length === 0, problems.map(entry => entry.message).join(' | '));

  // 5. AND THE CASE IS NOT QUARANTINED MERELY FOR DIFFERING FROM THE CELL.
  check('5: no problem mentions the authored Scenario text',
      !problems.some(entry => entry.message.includes('.rounded-checkbox-ui')));
}

/* --------------------------------- 2: what must still be refused ---- */

function checkStillRefused(): void {
  process.stdout.write('\n== the check did not become fuzzy ==\n');

  // A spec with NO title for this case is still refused - the failure the check was
  // built for, and the one that silently detaches a spec from its row.
  const wrongCase = staticCheck(specWith('TC_LOGIN_999 - something else'), 'TC_LOGIN_121', AUTHORED_121);
  check('a spec titled for a DIFFERENT case is refused',
      wrongCase.some(entry => /No test titled/.test(entry.message)),
      wrongCase.map(entry => entry.message).join(' | ').slice(0, 110));

  const noTitle = staticCheck(specWith('no identifier at all'), 'TC_LOGIN_121', AUTHORED_121);
  check('a spec with no canonical title is refused',
      noTitle.some(entry => /No test titled/.test(entry.message)));

  // A NEAR MISS on the ID is still a miss: `TC_LOGIN_12` is not `TC_LOGIN_121`.
  const nearMiss = staticCheck(specWith('TC_LOGIN_12 - Verify issue checkbox on the Issues page'),
      'TC_LOGIN_121', AUTHORED_121);
  check('a near-miss on the Test Case ID is still refused',
      nearMiss.some(entry => /No test titled/.test(entry.message)),
      nearMiss.map(entry => entry.message).join(' | ').slice(0, 90));

  // An empty scenario half names the case and says nothing about it.
  const empty = staticCheck(specWith('TC_LOGIN_121 - '), 'TC_LOGIN_121', AUTHORED_121);
  check('an empty scenario half is refused',
      empty.length > 0, empty.map(entry => entry.message).join(' | ').slice(0, 90));
}

/* ------------------------- 3: ordinary cases keep the exact-match contract ---- */

function checkOrdinaryCases(): void {
  process.stdout.write('\n== a stable authored Scenario is still authoritative ==\n');

  const STABLE = 'Sign in with valid credentials';
  check('the stable Scenario needs no derivation', unstableTitleReason(STABLE) === null);

  const exact = staticCheck(specWith(`TC_LOGIN_001 - ${STABLE}`), 'TC_LOGIN_001', STABLE);
  check('a spec carrying the authored Scenario verbatim passes',
      exact.length === 0, exact.map(entry => entry.message).join(' | '));

  // THE HALF THAT MUST NOT BE LOST. Where the cell CAN name the test, a generator that
  // paraphrases it has drifted from the author's words, and that is still refused -
  // the fix relaxes identity, not authorship.
  const drifted = staticCheck(specWith('TC_LOGIN_001 - Sign in with the right credentials'),
      'TC_LOGIN_001', STABLE);
  check('a spec that PARAPHRASES a stable authored Scenario is still refused',
      drifted.some(entry => /must match it exactly/.test(entry.message)),
      drifted.map(entry => entry.message).join(' | ').slice(0, 120));

  check('and testTitleFor still builds the authored title for such a case',
      testTitleFor({ testCaseId: 'TC_LOGIN_001', scenario: STABLE } as never)
        === `TC_LOGIN_001 - ${STABLE}`);
}

/* ------------------------------------- 4: the whole corpus, read only ---- */

function checkCorpus(): void {
  process.stdout.write('\n== every accepted spec still resolves its own row ==\n');

  const dir = path.join(ROOT, 'tests-e2e', 'generated');
  if (!fs.existsSync(dir)) {
    check('the generated spec directory exists', false, dir);
    return;
  }
  const specs = scanSpecs(dir);
  check('every generated spec yields a Test Case ID', specs.length > 0 && specs.every(
      entry => /^(?:TC|TS)[_-][A-Za-z0-9_-]+$/.test(entry.testCaseId)),
  `${specs.length} title(s)`);

  // Each accepted spec must pass the check AGAINST ITS OWN TITLE - which is what a
  // regeneration would be measured on. Read-only: no file is written or regenerated.
  let refused = 0;
  const names: string[] = [];
  for (const entry of specs) {
    const source = fs.readFileSync(path.resolve(ROOT, entry.testFile), 'utf8');
    const scenario = entry.testName.slice(entry.testCaseId.length + 3);
    const problems = staticCheck(source, entry.testCaseId, scenario)
        .filter(problem => /No test titled|scenario half/.test(problem.message));
    if (problems.length) {
      refused++;
      names.push(entry.testCaseId);
    }
  }
  check('no accepted spec is refused on identity grounds', refused === 0,
      names.slice(0, 6).join(', '));
}

function main(): void {
  checkTheRegression();
  checkStillRefused();
  checkOrdinaryCases();
  checkCorpus();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
