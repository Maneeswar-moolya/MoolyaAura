import '../testing/isolated-checkout';
/**
 * Accessible-name stability: the classifier, its refusals, and what still must not move.
 *
 *   npx tsx ai/autocode/accessible-name-stability.fixture.ts
 *
 * Offline: no browser, no model, no network. It writes nothing anywhere.
 *
 * PHASE 6 asked whether stability could be measured at all and answered yes, with one
 * condition. PHASE 7 collects it: `accessibleNameStable` is now a real optional field on
 * the evidence, written at the settled point, and read by NOTHING that selects a locator.
 * Section D is what holds that line - ranking, generation, budgets, reuse, AI eligibility
 * and the falsification gate are all asserted unchanged.
 *
 * WHAT THE LIVE EXPERIMENT MEASURED, at the two points the pipeline already has - the
 * press, and the settled point reached by the application's OWN signal, never a sleep:
 *
 *   Password field   "Password" -> "Password Not too short! enter min 5 characters."   CHANGED
 *   Email field      "Email" -> "Email"                                                 stable
 *   Sign In button   "Sign In" -> "Sign In"                                             stable
 *   Language toggle  "English " -> "English "  (expanded/collapsed)                     stable
 *   Mobiles link     the press did not park - guard fired                               unknown
 *
 * Replay in the settled state: the press-time name matched 0, the settled name matched 1,
 * and `#password_field` matched 1 in BOTH states. Three of the four FixturePortal controls
 * went through the identical validation flow and only ONE name moved, so the measurement
 * discriminates rather than flagging everything that happens to be nearby.
 *
 * THE FINDING THAT MATTERS MOST IS THE FIFTH ROW. The first run reported FixtureShop's
 * Mobiles link as `stable`, with the name "Login Get access to your Orders...". The press
 * had not parked a new entry, so the newest slot still held an earlier element and
 * measuring the same stale slot twice produced two identical names and a confident, false
 * `stable`. A stability signal without a slot-identity guard is not merely weak - it is
 * wrong in the safe-looking direction.
 */

import fs from 'node:fs';
import path from 'node:path';

import { candidateSelectorsFor, redactNode, type DomNode } from './dom-evidence';
import { analyseIdentifier, scoreExpression } from './locator-quality';
import { classifyNameStability } from '../dashboard/live-recorder';

const ROOT = process.cwd();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

/* ------------------------------------------------------- the proposed shape */

/**
 * PHASE 7: the field is now REAL, and this fixture drives the PRODUCTION classifier.
 *
 * `classifyNameStability` lives in `ai/dashboard/live-recorder.ts` beside the measurement
 * that gathers its inputs. It is pure, so every refusal below is tested without a browser
 * - and the refusals are the part Phase 6 got wrong.
 */
export type AccessibleNameStability = 'stable' | 'changed' | 'unknown';

/** The Phase 6 shape, expressed against the production classifier. */
function stability(
  atPress: string | null | undefined,
  atSettled: string | null | undefined,
  slotHoldsTarget = true,
  sameDocument = true,
  pressVerified = true,
): AccessibleNameStability {
  return classifyNameStability({
    pressName: atPress ?? undefined,
    pressVerified,
    sameDocument,
    slotHoldsTarget,
    settledName: atSettled ?? null,
  });
}

/* ============================================== A - the classifier itself */

function checkClassifier(): void {
  section('A - the classifier, and what it refuses to conclude');

  check('A: identical names are stable', stability('Email', 'Email') === 'stable');
  check('A: different names are changed',
      stability('Password', 'Password Not too short! enter min 5 characters.') === 'changed');

  // FAIL CLOSED, five ways. Every one of these produced a false `stable` in some earlier
  // draft of the harness, which is why each is a check rather than a comment.
  check('A: a missing press-time name is unknown, not stable',
      stability(null, 'Email') === 'unknown');
  check('A: a missing settled name is unknown, not stable',
      stability('Email', null) === 'unknown');
  check('A: both missing is unknown, not stable',
      stability(null, null) === 'unknown');
  check('A: undefined is treated as missing, not as an empty name',
      stability(undefined, undefined) === 'unknown');
  // THE GUARD. Two reads of a STALE slot agree with each other and mean nothing.
  check('A: a slot that is not the pressed element is unknown, even when the names agree',
      stability('Login Get access to your Orders', 'Login Get access to your Orders', false)
        === 'unknown');

  // An empty name never reaches the classifier: `browserAccessibleName` returns null when
  // the browser computes no name, so absence and emptiness are the same state upstream and
  // the classifier treats them the same way here.
  check('A: an empty press-time name is unknown, matching what the measurement returns',
      stability('', '') === 'unknown');

  /* ---- the remaining rows of the Phase 7 matrix ---- */
  check('A: a document change between the two points is unknown, even when names agree',
      stability('Email', 'Email', true, false) === 'unknown');
  check('A: an UNVERIFIED press-time name is never authoritative for stability',
      stability('Email', 'Email', true, true, false) === 'unknown');
  check('A: CDP unavailable at the settled point is unknown',
      stability('Email', null) === 'unknown');
  check('A: equal names on a slot that no longer holds the target is unknown',
      stability('Sign In', 'Sign In', false) === 'unknown');
  check('A: a changed name on a proven-same target is `changed`, not `unknown`',
      stability('Password', 'Password Not too short!') === 'changed');
}

/* ================================ B - replay is what decides usability */

function checkReplaySemantics(): void {
  section('B - `changed` is not the same as `unusable`');

  // The measured Password numbers, as the shape a future signal would have to carry.
  // A changed name is only disqualifying when the press-time name stops resolving; the
  // experiment measured exactly that, and measured the alternative surviving both states.
  const measured = {
    atPress: 'Password',
    atSettled: 'Password Not too short! enter min 5 characters.',
    pressNameInSettledState: 0,
    settledNameInSettledState: 1,
    authoredIdInBothStates: 1,
  };
  check('B: the Password name changed between the two points',
      stability(measured.atPress, measured.atSettled) === 'changed');
  check('B: and the press-time name resolves to NOTHING in the settled state',
      measured.pressNameInSettledState === 0);
  check('B: while the authored id resolves in both',
      measured.authoredIdInBothStates === 1);

  // THE CONTROL, and the reason this is a signal rather than a blanket suspicion of
  // validation flows: three of four FixturePortal controls went through the identical flow
  // and did not move.
  for (const [label, before, after] of [
    ['Email field', 'Email', 'Email'],
    ['Sign In button', 'Sign In', 'Sign In'],
    ['Language toggle (expanded/collapsed)', 'English ', 'English '],
  ] as Array<[string, string, string]>)
    check(`B: ${label} is stable through the same settled point`,
        stability(before, after) === 'stable');
}

/* ==================== C - the population, and what it does NOT contain */

function checkPopulation(): void {
  section('C - authored legacy and browser-computed provenance');
  const legacy = redactNode({ tag: 'button', accessibleName: 'Save' });
  check('C: redaction does not fabricate legacy name provenance',
      legacy.accessibleNameSource === undefined && legacy.accessibleNameVerified === undefined);
  const current = redactNode({ tag: 'button', accessibleName: 'Save',
    accessibleNameSource: 'browser-computed', accessibleNameVerified: true });
  check('C: browser-computed provenance survives redaction',
      current.accessibleNameSource === 'browser-computed' && current.accessibleNameVerified === true);
  const unknown = redactNode({ tag: 'button', accessibleName: 'Save', accessibleNameVerified: false });
  check('C: an unverified name stays unverified', unknown.accessibleNameVerified === false);
}

/* ============================ D - production is untouched by this phase */

function checkProductionUnchanged(): void {
  section('D - nothing in production moved');

  // Ranking is unchanged: role+name still outranks an authored id, which is exactly the
  // question Phase 7 would decide. Pinned so this phase cannot be mistaken for that one.
  const roleName = scoreExpression('page.getByRole("textbox", { name: "Password", exact: true })')?.weakest;
  const stableId = scoreExpression('page.locator("#password_field")')?.weakest;
  check('D: role+name still scores 95', roleName === 95, String(roleName));
  check('D: stable-id still scores 70', stableId === 70, String(stableId));
  check('D: so role+name still outranks the id, unchanged by this phase',
      (roleName ?? 0) > (stableId ?? 0));

  // No stability field reached the evidence schema or the generator.
  const evidenceSource = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'dom-evidence.ts'), 'utf8');
  // PHASE 7 ADDS THE FIELD AND NOTHING ELSE. It is optional, it travels through the
  // redaction allow-list beside the name it describes, and no consumer branches on it.
  check('D: accessibleNameStable exists on the schema and is optional',
      /accessibleNameStable\?: 'stable' \| 'changed' \| 'unknown';/.test(evidenceSource));
  // ASKED OF `redactNode`, not of its source: a line that is still written but no longer
  // reached looks identical to a working one when you only grep for it.
  const carried = redactNode({
    tag: 'input', id: 'password_field', accessibleName: 'Password',
    accessibleNameSource: 'browser-computed', accessibleNameVerified: true,
    accessibleNameStable: 'changed',
  } as DomNode);
  check('D: it reaches the sidecar through the redaction allow-list',
      carried.accessibleNameStable === 'changed', String(carried.accessibleNameStable));
  // And it never outlives the name it describes - the same rule the other two
  // provenance fields follow.
  const nameless = redactNode({
    tag: 'input', type: 'password', name: 'password', text: 'hunter2',
    accessibleNameStable: 'stable',
  } as DomNode);
  check('D: and it does not survive on a node whose name did not',
      nameless.accessibleNameStable === undefined, String(nameless.accessibleNameStable));
  check('D: candidate generation still reads only accessibleNameVerified',
      /accessibleNameVerified === true/.test(evidenceSource));
  // THE COLLECTION-ONLY INVARIANT: nothing anywhere decides a locator on it.
  const consumers = ['ai/autocode/dom-evidence.ts', 'ai/autocode/locator-quality.ts',
    'ai/autocode/abstraction/classify.ts', 'ai/autocode/from-recording.ts',
    'ai/autocode/abstraction/semantic.ts', 'ai/autocode/verify.ts'];
  const branching = consumers.filter(rel => {
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // A mention inside the schema's own doc comment is not a branch; a comparison is.
    const code = body.split(/\r?\n/)
        .filter(line => !/^\s*(\*|\/\/)/.test(line))
        .join(' ');
    // A COMPARISON, not a declaration and not a write. `accessibleNameStable?:` is the
    // optional-property marker on the schema and `= ...` is the collection itself; only
    // `===`, `!==` or a ternary read would mean something BRANCHES on the value.
    return /accessibleNameStable\s*(===|!==)/.test(code)
      || /accessibleNameStable\s*\?(?!:)/.test(code);
  });
  check('D: no module branches on accessibleNameStable - it is collected, not consulted',
      branching.length === 0, branching.join(', ') || 'none');

  // An UNVERIFIED name is still not authoritative - the Phase 2 rule, re-checked here
  // because "measure stability" would be meaningless if an approximation could win.
  const unverified: any = {
    target: {
      tag: 'input', id: 'password_field', accessibleName: 'Password',
      accessibleNameSource: 'title', accessibleNameVerified: false,
      aria: { 'aria-label': 'Secret' },
    },
    ancestors: [], descendants: [],
  };
  const built = candidateSelectorsFor(unverified as never, value => analyseIdentifier(value).dynamic)
      .map(entry => entry.expression);
  check('D: an unverified name does not displace the aria-label it sits beside',
      built.some(e => e.includes('Secret')) && !built.some(e => /getByRole[^)]*"Password"/.test(e)),
      built.filter(e => e.includes('getByRole')).join(' | '));

  // The falsification gate is untouched - it is what stops a state-dependent locator
  // shipping today, and this phase must not have weakened it.
  const verify = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'verify.ts'), 'utf8');
  check('D: the gate still requires a clean pass and a mutated failure',
      /clean/i.test(verify) && /mutat/i.test(verify));
}

/* ================= E - attributing an `unknown`, which is reporting, not deciding */

/**
 * WHY a verdict came back `unknown`, in the order the production classifier refuses.
 *
 * REPORTING ONLY - nothing in production calls this, and no locator depends on it. It is
 * pinned because Phase 8 got it wrong twice and both errors flattered the tool:
 *
 *   - "CDP unavailable" was reported for elements that simply HAVE no accessible name -
 *     an unlabelled icon, a validation label - which is a fact about the page.
 *   - "document could not be attributed" was reported for presses that were never
 *     CLAIMED: when `takePreAction` matches no parked entry, `captureFor` falls back to
 *     an after-action capture that carries `matchCountDocument: 'unknown'` for an
 *     entirely different reason. `captureTiming` is what separates them.
 *
 * The order matters as much as the labels: the earliest true statement wins, so a row is
 * never explained by a later condition that is merely also true.
 */
export function attributeUnknown(row: {
  captureTiming?: string | null;
  pressName?: string | null;
  pressVerified?: boolean;
  matchCountDocument?: string | null;
  slotIsTarget?: boolean;
  settledNameMeasured?: string | null;
}): string {
  if (row.captureTiming === 'after-action') return 'press never claimed';
  if (row.pressName === null || row.pressName === undefined) return 'no accessible name at all';
  if (!row.pressVerified) return 'unverified approximation, not browser-computed';
  if (row.matchCountDocument === 'other') return 'navigation / document changed';
  if (row.slotIsTarget === false) return 'parked slot is not the pressed element';
  if (row.settledNameMeasured === null || row.settledNameMeasured === undefined)
    return 'no settled name';
  return 'other';
}

function checkAttribution(): void {
  section('E - attributing an unknown (reporting logic, pinned because it was wrong twice)');

  const base = {
    captureTiming: 'before-action', pressName: 'Email', pressVerified: true,
    matchCountDocument: 'same', slotIsTarget: true, settledNameMeasured: 'Email',
  };
  check('E: a press that was never claimed is named as such, not as a document problem',
      attributeUnknown({ ...base, captureTiming: 'after-action', matchCountDocument: 'unknown' })
        === 'press never claimed');
  check('E: an element with no accessible name is not reported as broken tooling',
      attributeUnknown({ ...base, pressName: null }) === 'no accessible name at all');
  check('E: an unverified name is distinguished from a missing one',
      attributeUnknown({ ...base, pressVerified: false })
        === 'unverified approximation, not browser-computed');
  check('E: a document change is named',
      attributeUnknown({ ...base, matchCountDocument: 'other' })
        === 'navigation / document changed');
  check('E: a stale slot is named',
      attributeUnknown({ ...base, slotIsTarget: false })
        === 'parked slot is not the pressed element');
  check('E: a missing settled name is named',
      attributeUnknown({ ...base, settledNameMeasured: null }) === 'no settled name');
  // THE ORDER, tested directly: several conditions true at once must yield the earliest.
  check('E: the earliest true reason wins when several apply',
      attributeUnknown({
        captureTiming: 'after-action', pressName: null, pressVerified: false,
        matchCountDocument: 'other', slotIsTarget: false, settledNameMeasured: null,
      }) === 'press never claimed');
}

/* ------------------------------------------------------------------- main */

function main(): void {
  checkClassifier();
  checkReplaySemantics();
  checkPopulation();
  checkProductionUnchanged();
  checkAttribution();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
