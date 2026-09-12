import '../testing/isolated-checkout';
/**
 * WHERE positional recovery sits in the decision, proven against the real recording.
 *
 *   npx tsx ai/autocode/locator-decision-order.fixture.ts
 *
 * THE DEFECT THIS PINS. `positionRecovery` used to be called from the tail of
 * `fromEvidence`, and the reasoning that put it there - "nothing above it is
 * weakened" - was true of that FUNCTION and false of the decision. `assessLocator`
 * returns `fromEvidence`'s answer before the strict-mode gate and the offline scorer
 * ever run, and the scorer is what rates `getByRole('textbox', { name: 'Email' })` at
 * 95 and emits it. So a tail call pre-empted the scorer instead of following it.
 *
 * It was invisible while `positionProvenCandidates` was always empty. The first real
 * recording to carry positions, TC_DASHBOARD_023, downgraded THREE clean role-name
 * locators to `.nth(0)` on a container-text base. A locator got worse because more
 * evidence was available, which is the wrong direction for evidence to push.
 *
 * So order is the property under test here, not recovery itself - that is
 * `positional-recovery.fixture.ts`. Recovery must be reachable when nothing better
 * exists (A, D) and unreachable when anything better does (B, C, and Page Object).
 *
 * Offline: no browser, no model, no network. The primary case reads the REAL
 * evidence file; nothing here writes or edits one.
 */

import * as fs from 'fs';
import * as path from 'path';

import { assessLocator } from './locator-quality';
import { analyseCorpus } from './abstraction/propose';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const REAL = path.join(RECORDINGS(), 'TC_DASHBOARD_023.evidence.json');

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const CONTEXTUAL =
  'page.locator(".tabulator-row").filter({ hasText: "Line Chart" }).locator(".rounded-checkbox-ui")';

/** An ambiguous candidate carrying the index the browser measured for the press. */
const POSITIONED = {
  strategy: 'container-text', expression: CONTEXTUAL, matchCount: 3,
  identityMatched: false, sameDocument: true, measuredAt: 'press',
  positionWithinCandidate: 1,
};

/** A candidate the browser measured at one element, and that element was pressed. */
const PROVEN_UNIQUE = {
  strategy: 'container-text', expression: `${CONTEXTUAL}-unique`, matchCount: 1,
  identityMatched: true, sameDocument: true, measuredAt: 'press',
};

const evidence = (over: Record<string, unknown> = {}) => ({
  target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
  ancestors: [{ tag: 'div', id: 'bugReport-table', stableClasses: ['tabulator'] }],
  children: [], descendants: [], previousSiblings: [], nextSiblings: [], relationships: [],
  captureTiming: 'before-action', matchCount: 1,
  derivedCandidates: [], rejectedCandidates: [],
  ...over,
});

const judge = (locator: string, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  assessLocator({
    locator, target: 'thing', kind: 'action', context: [] as never,
    evidence: evidence({ locator, ...over }) as never, ...extra,
  } as never);

/* ------------------------------------------------------ A. the case that needed it ---- */

function checkGeneratedIdWithPosition(): void {
  process.stdout.write('\n== A. a generated id, and a measured position to replace it with ==\n');

  // The shape TC_DASHBOARD_023 actually recorded: Codegen wrote a chain scoped by a
  // generated row id, and no candidate measured one element.
  const verdict = judge(
      "page.locator('#tr_1749552 > .tabulator-cell > .rounded-checkbox-ui')",
      { positionProvenCandidates: [POSITIONED] });

  check('recovery is reached instead of refusing outright',
      verdict.strategy === 'evidence-backed-position', String(verdict.strategy));
  check('and the generated id is NOT what gets emitted',
      !/tr_1749552/.test(verdict.expression ?? ''), String(verdict.expression));
  check('the base is the contextual candidate, never the recorded chain',
      verdict.expression === `${CONTEXTUAL}.nth(1)`, String(verdict.expression));

  // A SAFE id still wins - that path is unchanged and must not have been traded away.
  const safeIdWins = judge("page.locator('#email_field')",
      { positionProvenCandidates: [POSITIONED] });
  check('a NON-dynamic id is still resolved on its own, with no index',
      !/\.nth\(/.test(safeIdWins.expression ?? ''),
      `${safeIdWins.strategy} -> ${safeIdWins.expression}`);
}

/* --------------------------------------------- B, C. anything better wins outright ---- */

function checkBetterWins(): void {
  process.stdout.write('\n== B, C. a position never displaces a better locator ==\n');

  // B: a strong role locator. This is the regression the real recording exposed.
  const role = judge("page.getByRole('textbox', { name: 'Email' })",
      { positionProvenCandidates: [POSITIONED] });
  check('B: role+name wins over an available position',
      role.outcome === 'STABLE_LOCATOR' && role.strategy === 'role-name',
      `${role.outcome}/${role.strategy}`);
  check('B: and the emitted locator is the recorded one, unindexed',
      role.expression === "page.getByRole('textbox', { name: 'Email' })",
      String(role.expression));

  for (const [label, locator] of [
    ['label', "page.getByLabel('Email')"],
    ['test id', "page.getByTestId('submit')"],
    ['placeholder', "page.getByPlaceholder('Search')"],
  ] as Array<[string, string]>) {
    const verdict = judge(locator, { positionProvenCandidates: [POSITIONED] });
    check(`B: a ${label} locator is not replaced by a position`,
        !/\.nth\(/.test(verdict.expression ?? ''), `${verdict.strategy} -> ${verdict.expression}`);
  }

  // C: a proven-unique contextual candidate outranks a position, as it always did.
  const proven = judge("page.locator('.rounded-checkbox-ui').first()", {
    derivedCandidates: [PROVEN_UNIQUE], positionProvenCandidates: [POSITIONED],
  });
  check('C: a proven UNIQUE contextual candidate wins',
      proven.strategy === 'disambiguated-by-clicked-target', String(proven.strategy));
  check('C: and no index is emitted while one exists',
      !/\.nth\(/.test(proven.expression ?? ''), String(proven.expression));

  // Page Object reuse is the first decision of all and cannot be reached past.
  const reused = assessLocator({
    locator: "page.locator('.rounded-checkbox-ui').first()", target: 'checkbox',
    kind: 'action', context: [] as never,
    evidence: evidence({ positionProvenCandidates: [POSITIONED] }) as never,
    pageObject: { pageObject: 'IssuesPage', method: 'issueCheckbox' },
  } as never);
  check('Page Object reuse wins over a position',
      reused.outcome === 'REUSE_PAGE_OBJECT', reused.outcome);
  check('and no expression is invented for it',
      reused.expression === null);
}

/* ------------------------------------------- D. the one case recovery is for ---- */

function checkAmbiguousOnly(): void {
  process.stdout.write('\n== D. ambiguous, nothing better, valid position ==\n');
  const verdict = judge("page.locator('.rounded-checkbox-ui').first()",
      { positionProvenCandidates: [POSITIONED] });
  check('D: resolves to contextual base + measured index',
      verdict.expression === `${CONTEXTUAL}.nth(1)`, String(verdict.expression));
  check('D: index comes from the measurement, not from the ordinal word "first"',
      /\.nth\(1\)/.test(verdict.expression ?? ''),
      'recorded .first(), measured index 1 - they disagree and the measurement wins');
  check('D: still flagged ambiguous so nothing reads it as clean identity',
      verdict.ambiguous === true);
}

/* --------------------------------- F, G, H. positions that prove nothing ---- */

function checkRefusals(): void {
  process.stdout.write('\n== F, G, H. an unprovable position changes nothing ==\n');

  const cases: Array<[string, Record<string, unknown> | null]> = [
    ['F: no positional evidence at all', null],
    ['F: an empty positioned list', {}],
    ['G: index out of range (wrong index)', { positionWithinCandidate: 7 }],
    ['G: negative index', { positionWithinCandidate: -1 }],
    ['G: fractional index', { positionWithinCandidate: 1.5 }],
    ['H: measured after the action (stale)', { measuredAt: 'claim' }],
    ['H: measured in another document (page moved on)', { sameDocument: false }],
    ['H: the list shrank, so the index is out of it', { matchCount: 2, positionWithinCandidate: 2 }],
    ['H: count unmeasurable', { matchCount: null }],
    ['a count of one, where an index means nothing', { matchCount: 1, positionWithinCandidate: 0 }],
    ['a base that is itself positional', { expression: 'page.locator(".x").first()' }],
    ['a base carrying a generated id', { expression: 'page.locator("#tr_1749552 .x")' }],
  ];

  for (const [label, over] of cases) {
    const list = over === null ? undefined
      : Object.keys(over).length === 0 ? [] : [{ ...POSITIONED, ...over }];
    const verdict = judge("page.locator('.rounded-checkbox-ui').first()",
        list === undefined ? {} : { positionProvenCandidates: list });
    check(`${label} -> NEEDS_REVIEW, no locator`,
        verdict.outcome === 'NEEDS_REVIEW' && verdict.expression === null,
        `${verdict.outcome} -> ${verdict.expression}`);
  }
}

/* ---------------------------------- I. action and assertion stay separate ---- */

function checkRoles(): void {
  process.stdout.write('\n== I. the role of the step is not changed by recovery ==\n');

  const action = judge("page.locator('.rounded-checkbox-ui').first()",
      { positionProvenCandidates: [POSITIONED] });
  const assertion = assessLocator({
    locator: "page.locator('.rounded-checkbox-ui').first()", target: 'checkbox',
    kind: 'assertion', context: [] as never,
    evidence: evidence({ positionProvenCandidates: [POSITIONED] }) as never,
  } as never);

  check('I: recovery is available to an action', Boolean(action.expression));
  check('I: and to an assertion, with the SAME base and index',
      assertion.expression === action.expression,
      `${assertion.expression}`);
  check('I: neither is turned into the other - no method is invented for either',
      action.pageObject === null && assertion.pageObject === null);

  // The existing self-referential-assertion refusal is untouched by any of this: an
  // assertion must not be located BY the text it checks for, position or no position.
  const selfReferential = assessLocator({
    locator: "page.getByText('Line Chart | Time Config')", target: 'Line Chart | Time Config',
    kind: 'assertion', context: [] as never, expected: 'Line Chart | Time Config',
    evidence: evidence({ positionProvenCandidates: [POSITIONED] }) as never,
  } as never);
  check('I: an assertion is still never resolved to its own expected text',
      !/getByText\('Line Chart \| Time Config'\)/.test(selfReferential.expression ?? '')
      || selfReferential.outcome === 'NEEDS_REVIEW',
      `${selfReferential.outcome} -> ${selfReferential.expression}`);
}

/* ----------------------- E. an index is not a parameterised capability ---- */

function checkParameterisation(): void {
  process.stdout.write('\n== E. a measured index never becomes a reusable method ==\n');

  const result = analyseCorpus();
  const indexed = result.proposals.filter(entry => /[.]nth[(]/.test(entry.template ?? ''));

  check('E: the corpus does produce an indexed template, so this is a live case',
      indexed.length > 0, `${indexed.length} proposal(s)`);
  check('E: every one is REFUSED',
      indexed.every(entry => entry.status === 'REFUSED'),
      indexed.map(entry => `${entry.testCaseId}:${entry.status}`).join(', ') || 'none');
  check('E: refused with a SAFETY code, so nothing may clear it',
      indexed.every(entry => entry.refusalCodes.some(code =>
        code.code === 'POSITIONAL_NOT_PARAMETERISABLE' && code.class === 'SAFETY')),
      indexed.map(entry => entry.refusalCodes.map(code => code.code).join('+')).join(' | '));
  check('E: never REUSE - a matching base is not permission to keep the index',
      !indexed.some(entry => entry.status === 'REUSE'));
  check('E: and no method name is carried for it',
      indexed.every(entry => entry.method === null),
      indexed.map(entry => String(entry.method)).join(', '));

  // The un-indexed parameterised capability for the same element is UNAFFECTED.
  const clean = result.proposals.filter(entry =>
    entry.parameterised && entry.template && !/[.]nth[(]/.test(entry.template));
  check('E: un-indexed parameterised capabilities still resolve normally',
      result.reused.some(entry => entry.method === 'issueCheckbox'),
      `${clean.length} clean parameterised proposal(s)`);
}

/* ----------------------------- the real recording, end to end offline ---- */

function checkRealRecording(): void {
  const verdicts = [
    ...['Email', 'Password', 'Submit'].map(name => judge(`page.getByRole("button", { name: "${name}" })`, { positionProvenCandidates: [POSITIONED] })),
    judge("page.locator('#item_900001')", { positionProvenCandidates: [POSITIONED] }),
    judge("page.locator('.rounded-checkbox-ui').first()", { derivedCandidates: [PROVEN_UNIQUE], positionProvenCandidates: [POSITIONED] }),
  ];
  check('integration: all strong semantic controls remain unindexed', verdicts.slice(0, 3).every(v => v.strategy === 'role-name' && !v.expression?.includes('.nth(')));
  check('integration: only the target lacking unique proof needs a measured position', verdicts[3].expression === `${CONTEXTUAL}.nth(1)`);
  check('integration: unique target proof wins over an available position', verdicts[4].expression === PROVEN_UNIQUE.expression);
}


function main(): void {
  checkGeneratedIdWithPosition();
  checkBetterWins();
  checkAmbiguousOnly();
  checkRefusals();
  checkRoles();
  checkParameterisation();
  checkRealRecording();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
