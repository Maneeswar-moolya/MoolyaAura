/**
 * An assertion's proof may be its own PICK; an action's may not.
 *
 *   npx tsx ai/autocode/assertion-pick-reuse.fixture.ts
 *
 * WHAT THIS PINS. `isProvenAtPick` has existed since assertion-pick capture landed and
 * the recorder used it - but not one consumer did. Every decision that asks "is this
 * candidate proof?" asked `isProvenAgainstClickedTarget`, which ends
 * `measuredAt === 'press'`, and an assertion pick is `'pick'` by construction. So a
 * candidate measured at ONE element, in the same document, with identity matched, was
 * dropped for saying the wrong word about WHEN it was taken.
 *
 * TC_LOGIN_123 is what that cost. Three assertions about two issue checkboxes, each
 * carrying
 *
 *   page.locator(".tabulator-row").filter({ hasText: "<issue description>" })
 *     .locator(".bugChecked")            matchCount 1, identityMatched true, at 'pick'
 *
 * which is byte-identical to the `IssuesPage.issueCheckboxState(description)` already in
 * the repository. All three fell past Page Object reuse, past parameterised reuse, past
 * contextual settlement, and landed on
 * `.tabulator-table filter("close Filter : Saved Filters…") .bugChecked .nth(0|1)` -
 * a locator scoped by the SAVED-FILTERS BAR and narrowed by an index. It ran, and it
 * passed, which is why nothing caught it: the defect is a silently weaker locator, not
 * a red test.
 *
 * THE ASYMMETRY THAT MADE IT INVISIBLE. `positionRecovery` had already been taught the
 * distinction and takes the caller's `kind`; the settlement step 90 lines above it had
 * not. The weaker mechanism accepted pick-time proof and the stronger one refused it, so
 * more evidence produced a worse locator.
 *
 * WHAT MUST NOT MOVE. An ACTION still demands a press: a measurement from any other
 * moment describes a page the action did not happen on. That is checked in both
 * directions here, on the same evidence, because a fix that widened the bar for
 * everything would be a regression wearing a green tick.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  isProvenAgainstClickedTarget, isProvenAtPick, provesIdentity,
  type CandidateMeasurement, type DomNode, type TargetEvidence,
} from './dom-evidence';
import { assessLocator } from './locator-quality';
import { mapRecording, readAssertions, readEvidence } from './from-recording';
import { parseRecording, readArchivedArtifact } from '../dashboard/recorder';
import { validateCandidate } from './abstraction/validate';
import { effectiveLocator, provenCandidate } from './abstraction/classify';
import { analyseCorpus } from './abstraction/propose';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string): void => process.stdout.write(`\n== ${title} ==\n`);

/* ------------------------------------------------------------------ builders ---- */

/** The expression TC_LOGIN_123 actually measured, and the method that already exists. */
const ROW_SCOPED =
  'page.locator(".tabulator-row").filter({ hasText: "sign in is not present in Moolya Aura IOS" })'
  + '.locator(".bugChecked")';

const measurement = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'container-text', expression: ROW_SCOPED, matchCount: 1,
  identityMatched: true, sameDocument: true, measuredAt: 'pick', ...over,
} as CandidateMeasurement);

function evidence(
  candidates: CandidateMeasurement[],
  over: Partial<TargetEvidence> = {},
): TargetEvidence {
  return {
    locator: 'page.locator(".bugChecked")',
    target: { tag: 'input', type: 'checkbox', stableClasses: ['bugChecked'] } as DomNode,
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 2, matchCountDocument: 'same',
    captureTiming: 'assertion-pick', derivedCandidates: candidates,
    ...over,
  } as TargetEvidence;
}

const assess = (input: { kind: 'action' | 'assertion'; evidence?: TargetEvidence }) =>
  assessLocator({
    locator: 'page.locator(".bugChecked")', target: '1751002',
    kind: input.kind, value: null, context: undefined as never, evidence: input.evidence,
  });

/* ------------------------------------------------ A - the predicate itself ---- */

function checkPredicate(): void {
  section('A - one predicate, two timings, one standard of proof');

  const atPress = measurement({ measuredAt: 'press' });
  const atPick = measurement({ measuredAt: 'pick' });

  check('A1: an ACTION is not proven by a pick-time measurement',
      provesIdentity(atPick, 'action') === false);
  check('A1: an ACTION is proven by a press-time measurement',
      provesIdentity(atPress, 'action') === true);
  check('A2: an ASSERTION is proven by its own pick',
      provesIdentity(atPick, 'assertion') === true);
  check('A2: an ASSERTION is also proven by a press - it loses nothing',
      provesIdentity(atPress, 'assertion') === true);

  // THE OTHER THREE MEASUREMENTS ARE UNTOUCHED. Only the timing word is role-aware;
  // widening any of these would be a different change and a much worse one.
  for (const [why, broken] of [
    ['a count above one', measurement({ matchCount: 3 })],
    ['a count of one that is a DIFFERENT element', measurement({ identityMatched: false })],
    ['an unanswered identity', measurement({ identityMatched: undefined })],
    ['a measurement from another document', measurement({ sameDocument: false })],
    ['no count at all', measurement({ matchCount: null })],
  ] as Array<[string, CandidateMeasurement]>) {
    check(`A3: ${why} proves nothing, for EITHER role`,
        provesIdentity(broken, 'action') === false && provesIdentity(broken, 'assertion') === false);
  }

  check('A4: the predicate is composed of the two that already existed, not a third rule',
      provesIdentity(atPick, 'assertion') === (isProvenAgainstClickedTarget(atPick) || isProvenAtPick(atPick))
      && provesIdentity(atPress, 'action') === isProvenAgainstClickedTarget(atPress));

  // `provenCandidate` is the shared accessor every abstraction module reads through.
  check('A5: provenCandidate defaults to the STRICT answer when nobody states a role',
      provenCandidate(evidence([atPick])) === null);
  check('A5: and finds the pick candidate when the caller says assertion',
      provenCandidate(evidence([atPick]), 'assertion')?.expression === ROW_SCOPED);
}

/* ------------------------------------- B/C/D - the locator engine's answer ---- */

function checkEngine(): void {
  section('B - a unique pick-proven candidate settles a measured ambiguity');

  const unique = evidence([measurement()]);
  const asAssertion = assess({ kind: 'assertion', evidence: unique });
  check('B1: the assertion is settled by the proven candidate, not by an index',
      asAssertion?.strategy === 'disambiguated-by-clicked-target', String(asAssertion?.strategy));
  check('B1: and the expression is the measured one, unchanged',
      asAssertion?.expression === ROW_SCOPED, String(asAssertion?.expression));
  check('B1: no index was introduced',
      !/\.nth\(|\.first\(|\.last\(/.test(String(asAssertion?.expression)));

  // THE SAME EVIDENCE, THE OTHER ROLE. This is the check that would go red if the fix
  // had been "accept pick everywhere", which is the one thing it must not be.
  const asAction = assess({ kind: 'action', evidence: unique });
  check('B2: the IDENTICAL evidence does NOT settle an action',
      asAction?.strategy !== 'disambiguated-by-clicked-target', String(asAction?.strategy));
  check('B2: and the action is never given the pick-proven expression',
      asAction?.expression !== ROW_SCOPED, String(asAction?.expression));

  section('C - an ambiguous assertion continues down the existing hierarchy');

  // A pick-time candidate that matched THREE elements proves nothing on its own, so the
  // hierarchy must carry on exactly as it did - to positional recovery when the position
  // was measured, and to NEEDS_REVIEW when it was not.
  const ambiguous = evidence([], {
    derivedCandidates: [],
    positionProvenCandidates: [measurement({
      matchCount: 3, identityMatched: false, positionWithinCandidate: 2,
    })],
  });
  const recovered = assess({ kind: 'assertion', evidence: ambiguous });
  check('C1: it reaches positional recovery, which is unchanged',
      recovered?.strategy === 'evidence-backed-position', String(recovered?.strategy));
  check('C1: with the index the browser measured, not one chosen to make the count one',
      String(recovered?.expression).endsWith('.nth(2)'), String(recovered?.expression));

  const unmeasurable = evidence([], {
    derivedCandidates: [],
    positionProvenCandidates: [measurement({
      matchCount: 3, identityMatched: false, positionWithinCandidate: null,
    })],
  });
  const refused = assess({ kind: 'assertion', evidence: unmeasurable });
  check('C2: an ambiguity with no position and nothing proven is still NEEDS_REVIEW',
      refused?.outcome === 'NEEDS_REVIEW', String(refused?.outcome));
  check('C2: and no locator is emitted for it',
      refused?.expression === null);

  section('D - no admissible evidence is judged the same for both roles');

  const before = assess({ kind: 'assertion', evidence: undefined });
  const action = assess({ kind: 'action', evidence: undefined });
  // THE INVARIANT IS ROLE-AGNOSTICITY, and it is the half this file is about: the timing
  // fix must not make the no-evidence path differ between an action and an assertion.
  //
  // The VALUE changed later, and not by anything here: `page.locator(".bugChecked")` is a
  // bare class, so the structural gate added for TC_LOGIN_128 refuses it when nothing
  // attributable measured it. That is strictly safer than the RAW_LOCATOR_LAST_RESORT
  // this used to assert - the same shape emitted for TC_DASHBOARD_023 and failed strict
  // mode on three elements - and it is refused identically for both roles, which is what
  // this check exists to prove.
  check('D1: an assertion with no evidence at all is refused, not emitted',
      before?.outcome === 'NEEDS_REVIEW' && before?.expression === null,
      `${before?.outcome} ${before?.expression}`);
  check('D1: and an action with no evidence is judged identically',
      action?.outcome === before?.outcome && action?.expression === before?.expression);
}

/* -------------------------------------------- H/I - safety that must not move ---- */

function checkSafety(): void {
  section('H - identifier safety is unchanged for both roles');

  // EACH ROLE IS GIVEN A CANDIDATE THAT IS PROOF FOR IT, so the gate under test is the
  // identifier rule rather than the timing rule - otherwise the action would refuse for
  // want of a press and the check would prove nothing about generated identifiers.
  for (const [role, timing] of [['action', 'press'], ['assertion', 'pick']] as const) {
    const dynamic = evidence(
        [measurement({ expression: 'page.locator("#tr_1751002").locator(".bugChecked")', measuredAt: timing })],
        { identifier: { raw: '1751002', dynamic: true } } as never);
    const codes = validateCandidate(dynamic, role).codes.map(entry => entry.code);
    check(`H1: a chain scoped by a generated id is refused for an ${role} proven at the ${timing}`,
        !validateCandidate(dynamic, role).safe && codes.includes('DYNAMIC_IDENTIFIER'), codes.join(','));
  }

  section('I - positional safety is unchanged');

  for (const [role, timing] of [['action', 'press'], ['assertion', 'pick']] as const) {
    const positional = evidence([measurement({ expression: `${ROW_SCOPED}.first()`, measuredAt: timing })]);
    const safety = validateCandidate(positional, role);
    const codes = safety.codes.map(entry => entry.code);
    check(`I1: first() is a forbidden mechanism for an ${role}, even fully proven at the ${timing}`,
        !safety.safe && codes.includes('FORBIDDEN_MECHANISM'), codes.join(','));
  }

  // An index with no measurement behind it is refused whatever the role claims.
  const unproven = evidence([], {
    derivedCandidates: [],
    positionProvenCandidates: [measurement({
      matchCount: 3, identityMatched: false, positionWithinCandidate: null,
    })],
  });
  check('I2: effectiveLocator reports no proof when nothing measured a position',
      effectiveLocator(unproven, 'assertion').proven === false);

  const source = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'locator-quality.ts'), 'utf8');
  const body = source.slice(source.indexOf('function positionRecovery('));
  check('I3: positionRecovery still decides position by the caller\'s kind and nothing else',
      /kind === 'assertion'/.test(body)
      && /isPositionProvenAgainstClickedTarget/.test(body)
      && /isPositionProvenAtPick/.test(body));
  check('I3: and it still refuses an unsafe base expression',
      /isPositionalLocator\(expression\)/.test(body)
      && /chainHasDynamicIdentifier\(expression\)/.test(body));

  section('J - the AI boundary is where it was');

  const changed = [
    path.join('ai', 'autocode', 'dom-evidence.ts'),
    path.join('ai', 'autocode', 'locator-quality.ts'),
    path.join('ai', 'autocode', 'from-recording.ts'),
    path.join('ai', 'autocode', 'abstraction', 'classify.ts'),
    path.join('ai', 'autocode', 'abstraction', 'validate.ts'),
    path.join('ai', 'autocode', 'abstraction', 'parameter.ts'),
    path.join('ai', 'autocode', 'abstraction', 'propose.ts'),
  ];
  const offenders = changed.filter(file => /\bclaude\b|anthropic|openai|\bspawn\s*\(|child_process|runAgent/i
      .test(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
  check('J1: no module changed by this fix can reach a model',
      offenders.length === 0, offenders.join(', '));
}

/* ------------------------------------------- K - the two real recordings ---- */

function mapArchived(id: string) {
  const source = readArchivedArtifact(id);
  if (!source)
    return null;
  const recording = parseRecording(source, {
    startUrl: '', browser: '', durationMs: 0,
    evidence: readEvidence(id, { archived: true }),
    stateAssertions: readAssertions(id, { archived: true }),
  });
  recording.startUrl = recording.actions.find(action => action.type === 'navigate')?.value ?? '';
  return mapRecording(recording);
}

function checkCorpus(): void {
  section('K - TC_LOGIN_123 and TC_LOGIN_122, from their own evidence files');

  const one = mapArchived('TC_LOGIN_123');
  if (!one) {
    check('K: TC_LOGIN_123 is on disk', false, 'no archived recording');
  } else {
    const assertions = one.steps.filter(step => /^assert /.test(String(step.from)));
    check('K1: all three assertions were recorded', assertions.length === 3, String(assertions.length));
    check('K1: every one of them reuses an existing Page Object method',
        assertions.every(step => step.kind === 'page-object'),
        assertions.map(step => step.kind).join(','));
    check('K1: and the method is the one that already existed',
        assertions.every(step => /issuesPage\.issueCheckboxState\(/.test(step.code.join(' '))));
    check('K2: the argument is the issue description the person recorded, not an index',
        assertions.some(step => step.code.join(' ').includes("'sign in is not present in Moolya Aura IOS'"))
        && assertions.some(step => step.code.join(' ').includes("'login is not present in moolya aura IOS'")));

    const nth = one.steps.reduce((total, step) =>
      total + (step.code.join(' ').match(/\.nth\(/g) ?? []).length, 0);
    check('K3: the whole spec contains NO nth() at all', nth === 0, `${nth} occurrence(s)`);
    check('K3: and nothing was left for a person',
        one.needsReview.length === 0, `${one.needsReview.length} needs-review`);

    // NO DUPLICATE CAPABILITY. The point of the fix is to REACH the existing method.
    const reused = new Set(one.reused.map(entry => `${entry.pageObject}.${entry.method}`));
    check('K4: issueCheckboxState is REUSED, never re-created',
        reused.has('IssuesPage.issueCheckboxState'), [...reused].join(', '));
    check('K4: and the clicks still reuse issueCheckbox, which never changed',
        reused.has('IssuesPage.issueCheckbox'));
  }

  const two = mapArchived('TC_LOGIN_122');
  if (!two) {
    check('K: TC_LOGIN_122 is on disk', false, 'no archived recording');
  } else {
    // THE CONTROL, AND THE DISTINCTION THE WHOLE FIX TURNS ON. Its project has three
    // issues whose descriptions are substrings of one another, so the identical
    // row-scoped shape measured 3 with identity FALSE. Nothing proves it, so positional
    // recovery is correct there and must still happen.
    const assertion = two.steps.find(step => /^assert /.test(String(step.from)));
    check('K5: TC_LOGIN_122 still resolves through positional recovery',
        assertion?.kind === 'codegen-locator', String(assertion?.kind));
    check('K5: with the index the browser measured for it',
        /\.nth\(2\)/.test(assertion?.code.join(' ') ?? ''), assertion?.code.join(' ').slice(0, 120));
    check('K5: and it is NOT resolved to a Page Object it cannot prove',
        !/issueCheckboxState/.test(assertion?.code.join(' ') ?? ''));

    const onDisk = path.join(ROOT, 'tests-e2e', 'generated', 'TC_LOGIN_122.spec.ts');
    if (fs.existsSync(onDisk)) {
      const accepted = fs.readFileSync(onDisk, 'utf8');
      const drifted = two.steps
          .map(step => step.code.join(' ').trim())
          .filter(code => code && !accepted.includes(code));
      check('K6: every mapped step still matches the accepted spec byte for byte',
          drifted.length === 0, drifted.join(' | ').slice(0, 160));
    }
  }
}

/* --------------------------------- L - the abstraction engine's own join ---- */

function checkProvenanceJoin(): void {
  section('L - an assertion reaches its evidence by provenance, not by its locator');

  // TC_LOGIN_122's assertion is the case: it carries `subjectProvenance` naming a pick
  // capture, and its recorded locator (`page.locator(".bugChecked")`) matches no evidence
  // row and no candidate expression - so the locator-string join finds nothing and the
  // element used to be filed as "the evidence sidecar holds no measurement joinable to
  // this element's recorded locator" while a measured capture for that very element sat
  // in the file, reachable by captureRef.
  const corpus = analyseCorpus({ includeArchived: true });
  const unmeasured = corpus.unmeasured.filter(entry =>
    entry.testCaseId === 'TC_LOGIN_122' && entry.role === 'assertion');
  check('L1: TC_LOGIN_122\'s assertion is no longer reported as having no admissible evidence',
      unmeasured.length === 0,
      unmeasured.map(entry => `${entry.from}: ${entry.code}`).join(' | '));

  const oneTwoThree = corpus.unmeasured.filter(entry =>
    entry.testCaseId === 'TC_LOGIN_123' && entry.role === 'assertion');
  check('L1: nor are TC_LOGIN_123\'s three',
      oneTwoThree.length === 0,
      oneTwoThree.map(entry => `${entry.from}: ${entry.code}`).join(' | '));

  // AND THE REFUSAL STILL WORKS WHERE IT IS TRUE. TC_DASHBOARD_023 predates the
  // mechanism: no elementRef on any target, no subjectProvenance on its assertion. It
  // must still be refused, and refused for that reason - repairing it would mean
  // inventing the measurement.
  const legacy = corpus.unmeasured.filter(entry =>
    entry.testCaseId === 'TC_DASHBOARD_023' && entry.role === 'assertion');
  check('L2: a recording with no provenance is still refused, not rescued',
      legacy.length > 0 && legacy.every(entry => entry.code === 'NO_ADMISSIBLE_EVIDENCE'),
      legacy.map(entry => entry.code).join(',') || 'none reported');

  // The knowledge file must still declare the method exactly once: the fix reaches an
  // existing capability, it does not add a second one.
  const knowledge = path.join(ROOT, 'ai', 'knowledge', 'page', 'bugasura__issues-id.yaml');
  if (fs.existsSync(knowledge)) {
    const declared = (fs.readFileSync(knowledge, 'utf8')
        .match(/page_object_method:\s*issueCheckboxState/g) ?? []).length;
    check('L3: issueCheckboxState is declared exactly once', declared === 1, String(declared));
  }
}

function main(): void {
  checkPredicate();
  checkEngine();
  checkSafety();
  checkCorpus();
  checkProvenanceJoin();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
