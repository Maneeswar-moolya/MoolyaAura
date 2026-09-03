/**
 * Candidate validation before scoring, fixture-backed Page Object reuse, and quarantine
 * classification - the three defects TC_LOGIN_109 exposed.
 *
 *   npx tsx ai/autocode/locator-validation.fixture.ts
 *
 * Offline: no browser, no model, no network.
 *
 * WHAT WENT WRONG, IN ONE SENTENCE EACH
 *
 * 1. MEASUREMENT LOST TO SHAPE. `getByRole('checkbox', { name: 'done' })` is a textbook
 *    role-and-name locator, so the offline scorer rated it 95 and classified it `stable`
 *    - the highest confidence this engine issues - while the browser had already counted
 *    it at ZERO elements. `fromEvidence` had no rule for a count of zero (only for a
 *    count above one), so nothing stopped it. Measured over the whole corpus: 29 targets
 *    carry a count of zero, all 29 were emitted verbatim, and not one of them appears in
 *    an accepted spec. Every one would time out.
 *
 * 2. A METHOD THAT EXISTS IS NOT A METHOD THAT CAN BE DELIVERED. `IssuesPage` is a Page
 *    Object with no Playwright fixture. The reuse resolvers checked `index.pages` and
 *    never `index.fixtures`, so `issuesPage.issueCheckbox(...)` was emitted, the spec
 *    destructured `issuesPage`, and Playwright refused the whole file: `Test has unknown
 *    parameter "issuesPage"`, 0 tests collected. Ten specs were quarantined that way.
 *
 * 3. THE SYMPTOM REPORTED AS THE CAUSE. That refusal reached the workbook as `Not
 *    Collected. No test with this ID was collected from the spec.` - one string covering
 *    an unknown fixture, a file that does not compile, and a `--grep` that matched
 *    nothing. Playwright had already said exactly what was wrong, in a structured
 *    `errors[]` entry in a JSON file the gate was already opening, and it was read past.
 *
 * Case C of the required coverage - one checkbox component driven through click, check,
 * uncheck and both assertion polarities - needs the real recorder and a stub DOM, which
 * live in `assertion-provenance.fixture.ts`. It is part K there.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  isPositionProven, isProvenAgainstClickedTarget,
  type CandidateMeasurement, type TargetEvidence,
} from './dom-evidence';
import { assessLocator } from './locator-quality';
import { methodIsDeliverable } from './from-recording';
import { classifyCollectionError, classifyExecutionFailure, staticCheck } from './verify';
import { classifyRecordedFailure } from './metrics';
import { buildIndex, type FrameworkIndex } from '../knowledge/index';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string): void => process.stdout.write(`\n== ${title} ==\n`);

/* ------------------------------------------------------------ test evidence */

/** A target whose own locator the browser counted. Everything else is a real shape. */
const target = (over: Partial<TargetEvidence> = {}): TargetEvidence => ({
  locator: "page.getByRole('checkbox', { name: 'done' })",
  target: { tag: '(not found)' },
  ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
  relationships: [], matchCount: 0,
  ...over,
} as unknown as TargetEvidence);

const proven = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'scoped-class', expression: 'page.locator("#bugReport-table .bugChecked")',
  matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press', ...over,
});

const positioned = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'container-text',
  expression: 'page.locator(".tabulator-row").filter({ hasText: "a row" }).locator(".bugChecked")',
  matchCount: 3, identityMatched: false, sameDocument: true, measuredAt: 'press',
  positionWithinCandidate: 0, ...over,
});

const judge = (evidence: TargetEvidence, kind: 'action' | 'assertion' = 'action') =>
  assessLocator({ locator: evidence.locator, target: 'done', kind, evidence });

/* =========================================================================
   A - a candidate measured at ZERO is refused, whatever it scores
   ========================================================================= */

function partA(): void {
  section('A - measured at zero elements: refused before it is ever scored');

  // The unmeasured control: the SAME locator with no evidence scores 95 and is emitted.
  // Without this the checks below could pass for the wrong reason - a locator refused
  // because role-name is unpopular rather than because a measurement refuted it.
  const unmeasured = assessLocator({
    locator: "page.getByRole('checkbox', { name: 'done' })", target: 'done', kind: 'action',
  });
  check('A1: with no evidence this exact locator scores high and IS emitted',
      unmeasured.confidence >= 0.9 && unmeasured.expression === "page.getByRole('checkbox', { name: 'done' })",
      `${unmeasured.strategy} @ confidence ${unmeasured.confidence}`);

  const zero = judge(target({ matchCountDocument: 'same', target: { tag: 'input' } as never }));
  check('A2: counted at 0 in the press document - REFUSED',
      zero.outcome === 'NEEDS_REVIEW' && zero.strategy === 'measured-zero',
      `${zero.outcome} / ${zero.strategy}`);
  check('A2: and nothing is emitted', zero.expression === null, String(zero.expression));
  check('A2: classified invalid, not merely weak', zero.classification === 'invalid', zero.classification);
  check('A2: the reason says what was counted and where',
      /counted this locator at 0 elements/.test(zero.reason)
      && /document the press happened in/.test(zero.reason), zero.reason.slice(0, 120));

  // The rule is about the MEASUREMENT, not the shape. A high-scoring role-name locator
  // and a low-scoring css one are refused identically.
  for (const [what, locator] of [
    ['role-name (scores 95)', "page.getByRole('checkbox', { name: 'done' })"],
    ['test-id (scores 85)', "page.getByTestId('bug-checkbox')"],
    ['stable id (scores 70)', "page.locator('#bug_done')"],
    ['css (scores 65)', "page.locator('.bugChecked')"],
    ['label (scores 90)', "page.getByLabel('Done')"],
  ] as Array<[string, string]>) {
    const verdict = judge(target({ locator, matchCountDocument: 'same', target: { tag: 'input' } as never }));
    check(`A3: refused regardless of shape - ${what}`,
        verdict.strategy === 'measured-zero' && verdict.expression === null,
        `${verdict.strategy} ${verdict.expression}`);
  }

  section('A - and a zero is only refused when it is ATTRIBUTABLE');

  // `other`: counted on the page that REPLACED the one acted on. This is the P0.7 rule
  // and it must stand - getByRole('button', { name: 'Sign In' }) measured 0 in four real
  // recordings because login had navigated, which is a fact about the page.
  const other = judge(target({
    locator: "page.getByRole('button', { name: 'Sign In' })",
    matchCountDocument: 'other', target: { tag: 'button' } as never,
  }));
  check('A4: a zero counted in ANOTHER document is never refused here',
      other.strategy !== 'measured-zero'
      && other.expression === "page.getByRole('button', { name: 'Sign In' })",
      `${other.strategy} ${other.expression}`);

  // `unknown` + a captured graph: the element WAS found, so one failure to count it is
  // not two independent failures to locate it. Spared - TC_LOGIN_063 is this case.
  const graphed = judge(target({
    locator: "page.getByRole('button', { name: 'Sign In' })",
    matchCountDocument: 'unknown', captureTiming: 'before-action',
    target: { tag: 'button', stableClasses: ['login-submit'] } as never,
  }));
  check('A5: a zero with a captured graph behind it is spared',
      graphed.strategy !== 'measured-zero', `${graphed.strategy} ${graphed.expression}`);

  // `unknown` + `(not found)`: two independent failures to locate it, and no graph to
  // set against them. Refused. This is TC_LOGIN_109's `done`.
  for (const doc of [undefined, 'unknown'] as Array<string | undefined>) {
    const notFound = judge(target({ matchCountDocument: doc as never }));
    check(`A6: a zero with NO captured element is refused (document ${doc ?? 'absent'})`,
        notFound.strategy === 'measured-zero' && notFound.expression === null,
        `${notFound.strategy} ${notFound.expression}`);
    check(`A6: and the reason says the recorder could not find it either (${doc ?? 'absent'})`,
        /could not find the element there either/.test(notFound.reason));
  }

  // NOT MEASURED IS NOT MEASURED AT ZERO. The distinction the whole rule turns on.
  const nulled = judge(target({ matchCount: null as never, matchCountDocument: 'same' }));
  check('A7: an UNMEASURED locator is untouched - absence of a measurement is not zero',
      nulled.strategy !== 'measured-zero', `${nulled.strategy} ${nulled.expression}`);

  section('A - what replaces a refused zero');

  const replaced = judge(target({
    matchCountDocument: 'same', target: { tag: 'input' } as never,
    derivedCandidates: [proven()],
  }));
  check('A8: a press-time PROVEN candidate replaces it',
      replaced.outcome === 'NORMALIZED_LOCATOR' && replaced.strategy === 'replaced-measured-zero'
      && replaced.expression === proven().expression,
      `${replaced.strategy} -> ${replaced.expression}`);
  check('A8: the reason states the identity was checked',
      /identity checked, not inferred/.test(replaced.reason), replaced.reason.slice(0, 90));
  check('A8: nothing is invented when there is no candidate',
      judge(target({ matchCountDocument: 'same', target: { tag: 'input' } as never })).expression === null);

  // A zero is NOT rescued by a position. An index into a match list of zero is nothing.
  const positionedZero = judge(target({
    matchCountDocument: 'same', target: { tag: 'input' } as never,
    positionProvenCandidates: [positioned()],
  }));
  check('A9: a measured zero is not rescued by positional recovery',
      positionedZero.strategy === 'measured-zero' && positionedZero.expression === null,
      `${positionedZero.strategy} ${positionedZero.expression}`);
  check('A9: no .nth() escapes from a zero-match target',
      !/nth\(/.test(String(positionedZero.expression ?? '')));

  section('A - the corpus, which is what the boundary was drawn from');

  const dir = 'ai/dashboard/recordings';
  let refused = 0; let swapped = 0; let spared = 0; let emittedZero = 0;
  for (const file of fs.readdirSync(path.resolve(ROOT, dir))) {
    if (!file.endsWith('.evidence.json'))
      continue;
    let evidence: any;
    try {
      evidence = JSON.parse(fs.readFileSync(path.resolve(ROOT, dir, file), 'utf8'));
    } catch {
      continue;
    }
    for (const entry of evidence.targets ?? []) {
      if (entry.matchCount !== 0)
        continue;
      const verdict = assessLocator({ locator: entry.locator, target: 'x', kind: 'action', evidence: entry });
      if (verdict.strategy === 'measured-zero')
        refused++;
      else if (verdict.strategy === 'replaced-measured-zero')
        swapped++;
      else {
        spared++;
        // Only an ATTRIBUTABLE zero counts as a miss. `other` is a fact about a
        // different page, and a zero with a captured graph behind it is one failure to
        // count rather than two failures to locate - both are spared on purpose.
        const attributable = entry.matchCountDocument === 'same'
          || (entry.matchCountDocument !== 'other' && (entry.target?.tag ?? '') === '(not found)');
        if (verdict.expression === entry.locator && attributable)
          emittedZero++;
      }
    }
  }
  check('A10: every measured-zero target in the corpus is refused or replaced, except the '
    + 'one with a captured graph and an unattributable count',
      refused > 0 && swapped > 0 && spared === 1,
      `refused ${refused}, replaced ${swapped}, spared ${spared}`);
  // A CENSUS, NOT AN INVARIANT - so it is asserted as one.
  //
  // This read `swapped === 6`, which was the corpus on the day it was written. Every new
  // recording of a dialog with a Close or Cancel button adds one: the button's own
  // locator counts zero in the document it was pressed in (the dialog has gone by the
  // time Codegen writes the line) and the recording carries a proven candidate to
  // replace it with. TC_LOGIN_126 and TC_LOGIN_127, recorded on 2026-08-22, took it to
  // eight - a fixture going red because the mechanism worked twice more.
  //
  // What must hold is that the number only ever GROWS and that none of them is emitted
  // verbatim, which the check below states exactly. The six are still named because the
  // floor is what the rule was measured against.
  check('A10: every same-document zero gains a measured locator - at least the six this '
    + 'rule was measured against (TC_LOGIN_071 x2, 076, 077, 078, 087)',
      swapped >= 6, `${swapped} replaced`);
  check('A10: and the only spared one is spared by the document rule, not by accident',
      emittedZero === 0, `${emittedZero} zero-match locator(s) still emitted verbatim`);
}

/* =========================================================================
   B - a candidate measured AMBIGUOUS is not a strict-mode locator
   ========================================================================= */

function partB(): void {
  section('B - measured at three elements: never emitted as a plain locator');

  const ambiguous = target({
    locator: 'page.locator(".bugChecked")', matchCount: 3, matchCountDocument: 'same',
    target: { tag: 'input', stableClasses: ['bugChecked'] } as never,
    candidatesTried: 12,
  });

  const bare = judge(ambiguous);
  check('B1: with nothing proven it is REFUSED, never narrowed',
      bare.outcome === 'NEEDS_REVIEW' && bare.expression === null,
      `${bare.outcome} ${bare.expression}`);
  check('B1: and no first()/last()/nth() reaches the EXPRESSION',
      !/first\(|last\(|nth\(/.test(String(bare.expression ?? '')), String(bare.expression));
  check('B1: the reason names them only to say why they are refused',
      /first\(\)\/nth\(\) would/.test(bare.reason), bare.reason.slice(0, 90));
  check('B1: the refusal says a person has to choose',
      /a person has to say which one/.test(bare.reason), bare.reason.slice(0, 110));

  const settled = judge({ ...ambiguous, derivedCandidates: [proven()] } as TargetEvidence);
  check('B2: a PROVEN UNIQUE candidate settles it, and wins over any position',
      settled.strategy === 'disambiguated-by-clicked-target'
      && settled.expression === proven().expression, `${settled.strategy} ${settled.expression}`);

  const byPosition = judge({ ...ambiguous, positionProvenCandidates: [positioned()] } as TargetEvidence);
  check('B3: position evidence, and only that, may narrow it',
      byPosition.strategy === 'evidence-backed-position'
      && byPosition.expression === `${positioned().expression}.nth(0)`,
      `${byPosition.strategy} ${byPosition.expression}`);
  check('B3: the index is the measured one', /\.nth\(0\)$/.test(String(byPosition.expression)));

  // Every way a position can fail to be proven. Each must fall back to the refusal.
  const unproven: Array<[string, Partial<CandidateMeasurement>]> = [
    ['no position recorded', { positionWithinCandidate: undefined }],
    ['measured in another document', { sameDocument: false }],
    ['position outside the match list', { positionWithinCandidate: 9 }],
    ['a fractional index', { positionWithinCandidate: 0.5 }],
    ['a negative index', { positionWithinCandidate: -1 }],
    ['matched exactly one, so no index applies', { matchCount: 1 }],
  ];
  for (const [why, over] of unproven) {
    const verdict = judge({
      ...ambiguous, positionProvenCandidates: [positioned(over)],
    } as TargetEvidence);
    check(`B4: refused - ${why}`,
        verdict.expression === null || !/nth\(/.test(String(verdict.expression)),
        `${verdict.strategy} ${verdict.expression}`);
  }

  check('B5: an ACTION may not use a position measured at a pick',
      !/nth\(/.test(String(judge({
        ...ambiguous, positionProvenCandidates: [positioned({ measuredAt: 'pick' })],
      } as TargetEvidence, 'action').expression ?? '')));
  check('B5: while an ASSERTION may, because the pick is the moment it is about',
      /\.nth\(0\)$/.test(String(judge({
        ...ambiguous, positionProvenCandidates: [positioned({ measuredAt: 'pick' })],
      } as TargetEvidence, 'assertion').expression ?? '')));

  check('B6: the predicates agree with the verdicts',
      isProvenAgainstClickedTarget(proven()) && !isProvenAgainstClickedTarget(positioned())
      && isPositionProven(positioned()) && !isPositionProven(positioned({ sameDocument: false })));
}

/* =========================================================================
   D - a Page Object method with no fixture is not reusable
   ========================================================================= */

function partD(): void {
  section('D - reuse requires the fixture, not only the method');

  const index: FrameworkIndex = {
    pages: {
      IssuesPage: { methods: [{ name: 'issueCheckbox', params: [{ name: 'summary' }] }] } as never,
      LoginPage: { methods: [{ name: 'open', params: [] }] } as never,
    },
    fixtures: ['loginPage', 'page', 'step'],
    support: {},
  } as never;

  check('D1: a method whose fixture exists is deliverable',
      methodIsDeliverable(index, 'LoginPage', 'open'));
  check('D2: a method whose fixture is ABSENT is not, however real the method is',
      !methodIsDeliverable(index, 'IssuesPage', 'issueCheckbox'));
  check('D3: a method that does not exist is not deliverable either',
      !methodIsDeliverable(index, 'LoginPage', 'noSuchMethod'));
  check('D4: nor is a class the index has never heard of',
      !methodIsDeliverable(index, 'GhostPage', 'open'));
  check('D5: the fixture name is derived, not guessed',
      methodIsDeliverable({ ...index, fixtures: ['issuesPage', 'loginPage'] } as never,
          'IssuesPage', 'issueCheckbox'));

  section('D - against the framework as it actually stands');

  const real = buildIndex();
  const missing = Object.keys(real.pages)
      .filter(name => !real.fixtures.includes(name.charAt(0).toLowerCase() + name.slice(1)));
  check('D6: the real index still has Page Objects with no fixture, so this rule is live',
      missing.length > 0, missing.join(', '));
  for (const name of missing) {
    const method = (real.pages[name]?.methods ?? [])[0]?.name;
    if (!method)
      continue;
    check(`D6: ${name}.${method}() is refused - no ${name.charAt(0).toLowerCase() + name.slice(1)} fixture`,
        !methodIsDeliverable(real, name, method));
  }
  for (const name of Object.keys(real.pages).filter(n => !missing.includes(n))) {
    const method = (real.pages[name]?.methods ?? [])[0]?.name;
    if (!method)
      continue;
    check(`D7: ${name}.${method}() is still reusable - its fixture exists`,
        methodIsDeliverable(real, name, method));
  }

  section('D - the fixture IssuesPage should always have had');

  // MIRRORS notifications-knowledge.fixture.ts:155-160, and for the same reason: a
  // generated spec obtains a Page Object by destructuring a fixture named after the
  // class, so the module must expose exactly that name. NotificationsPanel got the
  // fixture AND this check when it was added; IssuesPage got neither, and ten specs
  // paid for it.
  const fixturesSource = fs.readFileSync(path.resolve(ROOT, 'tests-e2e/fixtures.ts'), 'utf8');
  check('D6a: the issuesPage fixture is declared on the Fixtures interface',
      /issuesPage:\s*IssuesPage;/.test(fixturesSource));
  check('D6a: and a factory provides it, following the documented pattern',
      /issuesPage:\s*async \(\{ page, healing \}, use\) => \{/.test(fixturesSource)
      && /await use\(new IssuesPage\(page, healing\)\);/.test(fixturesSource));
  check('D6a: the class is imported',
      /import \{ IssuesPage \} from '\.\/pages\/issues\.page';/.test(fixturesSource));

  // AND THE TWO DELIBERATE OMISSIONS STAY OMITTED. TermsPage says in its own header
  // that it has no fixture on purpose - it is constructed over a popup Page that does
  // not exist until a test clicks the link - and BasePage is the abstract base. They
  // are what keeps the gate above honest: a rule with no live subject is untested.
  check('D6b: TermsPage still has no fixture, and still says why in its own header',
      !/termsPage:/.test(fixturesSource)
      && /There is no fixture for it on purpose/.test(
          fs.readFileSync(path.resolve(ROOT, 'tests-e2e/pages/terms.page.ts'), 'utf8')));
  check('D6b: so the deliverability gate still has something to refuse',
      !methodIsDeliverable(buildIndex(), 'TermsPage',
          (buildIndex().pages.TermsPage?.methods ?? [])[0]?.name ?? 'x'));

  section('D - THE INVARIANT: a generated spec may only name fixtures the framework has');

  // The property that actually matters, checked over every spec on disk rather than
  // over one case. Playwright refuses the WHOLE FILE for one unknown parameter, so a
  // single violation costs every test in it.
  const BUILT_IN = ['page', 'context', 'browser', 'browserName', 'request', 'playwright'];
  const allowed = new Set([...real.fixtures, ...BUILT_IN]);
  const offenders: string[] = [];
  for (const dir of ['tests-e2e/generated', 'ai/autocode/quarantine']) {
    const full = path.resolve(ROOT, dir);
    if (!fs.existsSync(full))
      continue;
    for (const file of fs.readdirSync(full)) {
      const source = fs.readFileSync(path.resolve(full, file), 'utf8');
      for (const match of source.matchAll(/async \(\{([^}]*)\}/g)) {
        for (const raw of match[1].split(',')) {
          const name = raw.trim();
          if (name && !allowed.has(name))
            offenders.push(`${dir}/${file}: ${name}`);
        }
      }
    }
  }
  const generated = offenders.filter(entry => entry.startsWith('tests-e2e/generated'));
  check('D8: no spec in the live suite names a fixture the framework does not declare',
      generated.length === 0, generated.slice(0, 4).join(' | ') || 'none');
  check('D9: the quarantined specs are the record of the defect, and are expected to '
    + 'still carry it - they were written before the rule existed',
      true, `${offenders.length - generated.length} historical offender(s)`);
}

/* =========================================================================
   E - a quarantine names the cause, not the symptom
   ========================================================================= */

function partE(): void {
  section('E - collection failures are classified, and Playwright is quoted');

  // THE REAL MESSAGE, captured from a real run of the real quarantined spec through the
  // gate's own command shape. Not paraphrased: this is what Playwright wrote into the
  // JSON report's errors[0].message.
  const REAL = 'Test has unknown parameter "issuesPage".';
  const verdict = classifyCollectionError(REAL);
  check('E1: the real unknown-fixture message classifies as UNKNOWN_FIXTURE',
      verdict.code === 'UNKNOWN_FIXTURE', verdict.code);
  check('E1: and it names the fixture, so the report can print it',
      verdict.fixture === 'issuesPage', String(verdict.fixture));
  check('E2: it is NOT collapsed into a generic collection error',
      verdict.code !== 'COLLECTION_ERROR');

  const collection: Array<[string, string]> = [
    ['SyntaxError: Unexpected token }', 'COMPILE_ERROR'],
    ["Cannot find module '../pages/nope'", 'COMPILE_ERROR'],
    ['error TS2345: Argument of type', 'COMPILE_ERROR'],
    ['Transform failed with 1 error', 'COMPILE_ERROR'],
    ['playwright.config.ts: something is wrong', 'COLLECTION_ERROR'],
  ];
  for (const [message, expected] of collection)
    check(`E3: ${expected} - ${message.slice(0, 42)}`,
        classifyCollectionError(message).code === expected,
        classifyCollectionError(message).code);

  const execution: Array<[string, string]> = [
    ["strict mode violation: locator('.bugChecked') resolved to 3 elements", 'STRICT_MODE_FAILURE'],
    ['expect(received).toBeChecked() Expected: checked Received: unchecked', 'ASSERTION_FAILURE'],
    ['expect(locator).toBeVisible() failed', 'ASSERTION_FAILURE'],
    ['locator.click: Timeout 15000ms exceeded waiting for locator', 'TIMEOUT'],
    ['Test timeout of 60000ms exceeded', 'TIMEOUT'],
    ['TypeError: page.foo is not a function', 'RUNTIME_FAILURE'],
    ['net::ERR_EMPTY_RESPONSE', 'RUNTIME_FAILURE'],
  ];
  for (const [message, expected] of execution)
    check(`E4: ${expected} - ${message.slice(0, 46)}`,
        classifyExecutionFailure(message) === expected, classifyExecutionFailure(message));

  // ORDER IS LOAD-BEARING. A strict-mode violation is delivered through a locator call
  // that also times out, so a timeout-first classifier would hide the one failure this
  // project cares most about.
  const both = 'locator.click: Timeout 15000ms exceeded\nstrict mode violation: resolved to 3 elements';
  check('E5: strict mode is recognised even when a timeout is reported alongside it',
      classifyExecutionFailure(both) === 'STRICT_MODE_FAILURE', classifyExecutionFailure(both));
  const assertionTimeout = 'expect(locator).toBeChecked() failed: Timeout 5000ms exceeded';
  check('E5: an expect that timed out is an assertion failure, not a bare timeout',
      classifyExecutionFailure(assertionTimeout) === 'ASSERTION_FAILURE',
      classifyExecutionFailure(assertionTimeout));

  section('E - the gate reads the report it was already opening');

  const source = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/verify.ts'), 'utf8');
  check('E6: runOne captures what spawnSync returned instead of discarding it',
      /const result = spawnSync\(/.test(source));
  check('E7: it reads the report\'s own errors[] rather than scraping stdout',
      /report\?\.errors \?\? \[\]/.test(source) || /\(report\?\.errors \?\? \[\]\)/.test(source));
  check('E8: Playwright\'s message is carried verbatim onto the result',
      /playwrightMessage/.test(source));
  check('E9: the gate headline names the phase and the reason code',
      /Phase: \$\{\(clean\.phase/.test(source) && /Reason: \$\{clean\.code\}/.test(source));
  check('E10: "No test with this ID was collected" is gone as a catch-all',
      !/No test with this ID was collected from the spec\./.test(source));
  check('E11: NO_MATCHING_TEST now says how many tests DID build',
      /NO_MATCHING_TEST/.test(source) && /contained \$\{collected\} test/.test(source));

  section('E - and the two places that mis-read a collection failure downstream');

  // A SPEC THAT NEVER RAN IS NOT A SPEC THAT CHECKED NOTHING. Both of these read a
  // clean-run status and drew a conclusion about execution from it.
  check('E15: a collection failure is no longer classified as a clean-RUN failure',
      classifyRecordedFailure({
        orderReconstructed: true, cleanStatus: 'Not Collected',
        reason: 'UNKNOWN_FIXTURE: Test has unknown parameter "issuesPage"',
      } as never) === 'RECORDED_COLLECTION_FAILURE');
  check('E15: while a spec that DID run and fail still is one',
      classifyRecordedFailure({
        orderReconstructed: true, cleanStatus: 'Failed', reason: 'expect(x).toBeChecked() failed',
      } as never) === 'RECORDED_CLEAN_RUN_FAILURE');
  check('E15: and the older, more specific classes still win where they apply',
      classifyRecordedFailure({
        orderReconstructed: true, cleanStatus: 'Failed', reason: 'Could not resolve "issues.checkbox"',
      } as never) === 'RECORDED_APPLICATION_FAILURE'
      && classifyRecordedFailure({
        orderReconstructed: false, cleanStatus: 'Failed', reason: 'x',
      } as never) === 'RECORDED_ASSEMBLY_ERROR'
      && classifyRecordedFailure({
        orderReconstructed: true, mutatedStatus: 'Passed', reason: 'x',
      } as never) === 'RECORDED_MUTATION_FAILURE');

  // `SUSPECT` is excel:verify's only finding and its only non-zero exit. It means
  // "passed with every assertion broken". A spec Playwright refused to BUILD was
  // landing in it by falling off the end of the chain.
  const cli = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/verify-cli.ts'), 'utf8');
  check('E16: excel:verify routes Not Collected to red, not to SUSPECT',
      /clean === 'Not Collected'/.test(cli)
      && cli.indexOf("clean === 'Not Collected'") < cli.indexOf("mark = 'SUSPECT'"));
  check('E17: and the metrics schema records that the distinction now exists',
      /export const SCHEMA = 11;/.test(
          fs.readFileSync(path.resolve(ROOT, 'ai/autocode/metrics.ts'), 'utf8')));

  section('E - the static gate closes the MODEL path too');

  // THE RESOLVER FIX COVERS ONE HALF OF THE PIPELINE. methodIsDeliverable stops the
  // deterministic recorded mapper naming a fixture that does not exist, which is where
  // the IssuesPage failure came from. A spec the MODEL wrote goes straight to gate() and
  // nothing between the two validated its destructure list - so the same failure could
  // arrive by the other route. staticCheck is where that check is free.
  const ghost = "test('TC_X - s', async ({ page, ghostPage, step }) => { trace({}); expect(1); });";
  const fired = staticCheck(ghost, 'TC_X', 's')
      .filter(problem => /does not declare as a fixture/.test(problem.message));
  check('E18: a spec naming an undeclared fixture is refused STATICALLY, before any run',
      fired.length === 1, fired[0]?.message.slice(0, 90) ?? 'not refused');
  check('E18: and the message names the fixture and what Playwright would do',
      /"ghostPage"/.test(fired[0]?.message ?? '')
      && /refuses the whole file/.test(fired[0]?.message ?? ''));
  check('E19: a built-in Playwright fixture is never mistaken for an undeclared one',
      staticCheck("test('TC_X - s', async ({ page, context, browserName, request }) => { trace({}); expect(1); });",
          'TC_X', 's').filter(p => /does not declare as a fixture/.test(p.message)).length === 0);
  check('E19: nor is a renamed one - { page: p } still names page',
      staticCheck("test('TC_X - s', async ({ page: p, step }) => { trace({}); expect(1); });",
          'TC_X', 's').filter(pr => /does not declare as a fixture/.test(pr.message)).length === 0);

  // AND IT REFUSES NOTHING THAT WORKS TODAY. The rule is only safe if the suite as it
  // stands passes it - a static check that quarantines working specs is worse than none.
  let scanned = 0; const refused: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.spec.ts')) continue;
      scanned++;
      if (staticCheck(fs.readFileSync(full, 'utf8'), 'IGNORE', 'IGNORE')
          .some(problem => /does not declare as a fixture/.test(problem.message)))
        refused.push(full);
    }
  };
  walk(path.resolve(ROOT, 'tests-e2e'));
  check('E20: and not one spec in the live suite is refused by it',
      refused.length === 0 && scanned > 20, `${scanned} scanned, ${refused.length} refused`);

  section('E - a globalSetup fault is not a spec defect');

  // RUN MODE ORDERS globalSetup BEFORE THE LOAD TASK, so a locked workbook or an
  // unreadable data-driven contract arrives in errors[] before a single spec is read -
  // and `Cannot find module` from global-setup.ts matches the compile pattern exactly.
  // Without the location check the SPEC would be quarantined and retracted for an
  // environment fault.
  const spec = 'tests-e2e/generated/TC_X.spec.ts';
  check('E21: an error located outside the spec is GLOBAL_SETUP_FAILURE',
      classifyCollectionError("Cannot find module 'x'",
          { file: 'C:/r/tests-e2e/support/global-setup.ts' }, spec).code === 'GLOBAL_SETUP_FAILURE');
  check('E21: the same message located IN the spec is still a compile error',
      classifyCollectionError("Cannot find module 'x'",
          { file: 'C:/r/tests-e2e/generated/TC_X.spec.ts' }, spec).code === 'COMPILE_ERROR');
  check('E21: an unknown fixture in the spec is still an unknown fixture',
      classifyCollectionError('Test has unknown parameter "ghostPage".',
          { file: 'C:/r/tests-e2e/generated/TC_X.spec.ts' }, spec).code === 'UNKNOWN_FIXTURE');
  check('E22: NO_MATCHING_TEST is reachable - Playwright throws it into errors[]',
      classifyCollectionError('Error: No tests found.').code === 'NO_MATCHING_TEST');

  section('E - and the distinction survives the boundary, not only the prose');

  // THE POINT OF A CODE IS THAT A MACHINE CAN READ IT. Before this, the four collection
  // codes were collapsed back into one class the moment they reached the record, because
  // it branched on the STATUS STRING - so the granularity existed only as a substring
  // inside a sentence.
  check('E23: the record branches on the CODE, so UNKNOWN_FIXTURE keeps its identity',
      classifyRecordedFailure({ orderReconstructed: true, cleanStatus: 'Not Collected',
        cleanCode: 'UNKNOWN_FIXTURE', reason: 'x' } as never) === 'RECORDED_UNKNOWN_FIXTURE');
  check('E23: an environment fault is not filed against the recording',
      classifyRecordedFailure({ orderReconstructed: true, cleanStatus: 'Not Collected',
        cleanCode: 'GLOBAL_SETUP_FAILURE', reason: 'x' } as never) === 'RECORDED_ENVIRONMENT_FAILURE');
  check('E23: and a record written before codes existed still classifies',
      classifyRecordedFailure({ orderReconstructed: true, cleanStatus: 'Not Collected',
        reason: 'x' } as never) === 'RECORDED_COLLECTION_FAILURE');
  check('E24: orchestrate actually passes the code through',
      /cleanCode: gateDetail\.detail\.code/.test(
          fs.readFileSync(path.resolve(ROOT, 'ai/autocode/orchestrate.ts'), 'utf8')));

  section('E - nothing here weakens the gate');

  const mutateStart = source.indexOf('export function mutate(');
  const afterMutate = source.indexOf('export ', mutateStart + 1);
  const mutateBody = source.slice(mutateStart, afterMutate > 0 ? afterMutate : undefined);
  check('E12: the mutator is still evidence-blind',
      !/evidence|elementRef|captureRef/i.test(mutateBody));
  check('E13: a run is still required to PASS clean and FAIL mutated',
      /if \(clean\.status !== 'Passed'\)/.test(source)
      && /if \(broken\.status === 'Passed'\)/.test(source));
  check('E14: classification never changes a verdict - both branches still quarantine',
      (source.match(/verdict: 'quarantined'/g) ?? []).length >= 4);
}

/* =========================================================================
   F - the safety architecture this must not have disturbed
   ========================================================================= */

function partF(): void {
  section('F - every rule that had to survive these three changes');

  const quality = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/locator-quality.ts'), 'utf8');

  check('F1: a generated id is still never emitted',
      judge(target({
        locator: 'page.locator(\'[id="1749553"]\')', matchCount: 1, matchCountDocument: 'same',
        target: { tag: 'input', id: '1749553' } as never,
        identifier: { raw: '1749553', dynamic: true, normalised: '<dynamic>' } as never,
      })).expression === null);
  check('F2: first() and last() are still refused outright',
      /\.first\(\)\|\\.last\(\)/.test(quality) || /first\(\)\/nth\(\)/.test(quality));
  check('F3: the strict-mode gate on unmeasured bare text is untouched',
      assessLocator({ locator: "page.getByText('Projects')", target: 'x', kind: 'assertion' })
          .outcome === 'NEEDS_REVIEW');
  check('F4: positional recovery is still the LAST deterministic resort - a proven '
    + 'unique candidate beats a position',
      judge({
        ...target({ locator: 'page.locator(".bugChecked")', matchCount: 3, matchCountDocument: 'same',
          target: { tag: 'input' } as never }),
        derivedCandidates: [proven()], positionProvenCandidates: [positioned()],
      } as TargetEvidence).expression === proven().expression);
  check('F5: scoring still cannot override a measurement - the zero rule runs inside '
    + 'fromEvidence, which is consulted before the scorer',
      quality.indexOf('function measuredZero') < quality.indexOf('const ranked = [...candidates]')
      && quality.indexOf('if (measuredZero(evidence))') < quality.indexOf('// ---- STRICT MODE.'));
  const guide = fs.readFileSync(path.resolve(ROOT, 'ai/CLAUDE.md'), 'utf8');
  check('F6: elementRef and captureRef remain separate concepts, and the guide says so',
      /elementRef` names the element/.test(guide) && /captureRef` names one capture/.test(guide));
  const provenance = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-evidence.ts'), 'utf8');
  check('F6: and the contract still declares both, separately',
      /elementRef\?: string;/.test(provenance) && /captureRef\?: string;/.test(provenance));

  const evidence = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-evidence.ts'), 'utf8');
  check('F7: the press predicate was not widened to accept a pick',
      /export function isPositionProvenAgainstClickedTarget/.test(evidence)
      && /candidate\.measuredAt === 'press'/.test(evidence));
  check('F8: sameDocument is still demanded by both positional predicates',
      (evidence.match(/candidate\.sameDocument === true/g) ?? []).length >= 2);
}

/* ---------------------------------------------------------------- run it */

function main(): void {
  partA();
  partB();
  partD();
  partE();
  partF();
  process.stdout.write(failures ? `\n${failures} CHECK(S) FAILED\n` : '\nall checks passed\n');
  process.exit(failures ? 1 : 0);
}

main();
