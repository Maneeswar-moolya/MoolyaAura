import '../testing/isolated-checkout';
import { writeRecording } from '../testing/synthetic-data';
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
const section = (title: string): void => { process.stdout.write(`\n== ${title} ==\n`); };

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

/* ------------------------------------------- K - the synthetic recordings ---- */

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
  section('K - authored archived assertions with unique and positional pick proof');
  for (const [id, description, positional] of [
    ['TC_PICK_A', 'Quarterly draft for the northern region', false],
    ['TC_PICK_B', 'Annual draft for the southern region', false],
    ['TC_PICK_POSITION', 'Repeated draft summary', true],
  ] as const) {
    const expression = `page.locator(".tabulator-row").filter({ hasText: "${description}" }).locator(".bugChecked")`;
    const captureRef = `capture:${id}`;
    const candidate = measurement({ expression, matchCount: positional ? 3 : 1, identityMatched: !positional,
      ...(positional ? { positionWithinCandidate: 2 } : {}) });
    const graph = evidence(positional ? [] : [candidate], {
      captureRef, elementRef: `doc:${id}`, documentId: 'doc',
      ...(positional ? { positionProvenCandidates: [candidate] } : {}),
    });
    writeRecording(id, [], [graph], { archived: true, assertions: [{
      type: 'checked', expected: true, target: 'row selection', locator: 'page.locator(".bugChecked")',
      value: null, afterActions: 0,
      subjectProvenance: { refs: [`doc:${id}`], captureRef, locatorMatchCount: 3 },
    }] });
    const mapped = mapArchived(id);
    check(`K: ${id} loads from the archive`, Boolean(mapped));
    const assertion = mapped?.steps.find(s => s.from.startsWith('assert'));
    if (positional) {
      check('K: ambiguous pick retains its own measured index', assertion?.kind === 'codegen-locator' && assertion.code.join('').includes('.nth(2)'));
      check('K: ambiguous proof cannot reuse a unique Page Object method', !assertion?.code.join('').includes('issueCheckboxState'));
    } else {
      check(`K: ${id} reuses the declared state capability`, assertion?.kind === 'page-object' && assertion.method === 'issueCheckboxState');
      check(`K: ${id} preserves the recorded argument`, assertion?.code.join('').includes(description) === true);
      check(`K: ${id} emits no positional locator`, !assertion?.code.join('').includes('.nth('));
    }
  }
}


/* --------------------------------- L - the abstraction engine's own join ---- */

function checkProvenanceJoin(): void {
  const corpus = analyseCorpus({ includeArchived: true });
  const linked = corpus.unmeasured.filter(e => ['TC_PICK_A', 'TC_PICK_B', 'TC_PICK_POSITION'].includes(e.testCaseId) && e.role === 'assertion');
  check('L: archive assertions join their own capture instead of the recorded locator string', linked.length === 0);
  const unlinked = corpus.unmeasured.filter(e => e.testCaseId === 'TC_UNPROVEN_ASSERTION' && e.role === 'assertion');
  check('L: missing provenance stays a visible safety refusal', unlinked.length === 1 && unlinked[0].code === 'NO_ADMISSIBLE_EVIDENCE');
  const yaml = fs.readFileSync(path.join(ROOT, 'ai/knowledge/page/fixtureapp__issues-id.yaml'), 'utf8');
  check('L: no duplicate state capability was added', (yaml.match(/page_object_method:\s*issueCheckboxState/g) ?? []).length === 1);
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
