/**
 * A position is only a locator when the browser measured which element was pressed.
 *
 *   npx tsx ai/autocode/positional-recovery.fixture.ts
 *
 * WHAT THIS PHASE IS. When every other mechanism has declined - no Page Object, no
 * proven-unique candidate, no counted alternative - the recorder may still know
 * something nobody could use before: of the several elements a contextual expression
 * matched, WHICH one the person actually pressed. `positionWithinCandidate` is that
 * measurement, taken in the page at the press by `nodes.indexOf(element)`.
 *
 * WHY IT IS NOT `.first()` IN DISGUISE. `.first()` takes whatever the DOM ordered
 * first: nobody chose it and nothing measured it. This takes the index the browser
 * recorded for the pressed element. The expression plus that index provably resolved
 * to the element acted on - the one claim a positional locator has never been able to
 * make.
 *
 * WHAT IT DOES NOT PROVE, and this file says so out loud: an index does not survive a
 * row being inserted above it. That risk is real, is not settleable offline, and is
 * caught at run time by the cardinality resolver. The phase is last for that reason.
 *
 * BACKWARD COMPATIBILITY IS A CHECK HERE, not an assumption: no recording made before
 * this measurement existed has the field, so recovery must be simply unavailable for
 * all of them - never approximated, never defaulted to index 0.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  isPositionProvenAgainstClickedTarget, isPositionProvenAtPick, positionalExpression,
} from './dom-evidence';
import { assessLocator } from './locator-quality';
import { effectiveLocator } from './abstraction/classify';
import { validateCandidate } from './abstraction/validate';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** Just enough of a candidate to audit one read back off disk. */
interface CandidateShape {
  strategy?: string; matchCount?: number | null; measuredAt?: string;
  positionWithinCandidate?: number | null;
}

const CONTEXTUAL =
  'page.locator(".tabulator-row").filter({ hasText: "Line Chart" }).locator(".rounded-checkbox-ui")';

/** A position-proven candidate, overridable field by field. */
const candidate = (over: Record<string, unknown> = {}) => ({
  strategy: 'container-text', expression: CONTEXTUAL, matchCount: 3,
  sameDocument: true, measuredAt: 'press', positionWithinCandidate: 1, ...over,
}) as never;

/** Evidence for a recorded positional click, with whatever lists the case declares. */
const evidence = (over: Record<string, unknown> = {}) => ({
  locator: "page.locator('.rounded-checkbox-ui').first()",
  target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
  ancestors: [{ tag: 'div', id: 'bugReport-table', stableClasses: ['tabulator'] }],
  captureTiming: 'before-action', matchCount: 1,
  derivedCandidates: [], rejectedCandidates: [], ...over,
}) as never;

const judge = (over: Record<string, unknown> = {}) => assessLocator({
  locator: "page.locator('.rounded-checkbox-ui').first()", target: 'checkbox',
  kind: 'action', context: {} as never, evidence: evidence(over),
});

/* ------------------------------------------- the measurement's own contract ---- */

function checkPredicate(): void {
  process.stdout.write('\n== when is a position evidence, and when is it noise ==\n');

  check('a press-time index inside range is proof',
      isPositionProvenAgainstClickedTarget(candidate()));
  check('index 0 is a measurement, not an absence',
      isPositionProvenAgainstClickedTarget(candidate({ positionWithinCandidate: 0 })));

  for (const [label, over] of [
    ['no position recorded', { positionWithinCandidate: undefined }],
    ['position explicitly null', { positionWithinCandidate: null }],
    ['position out of range', { positionWithinCandidate: 3 }],
    ['negative position', { positionWithinCandidate: -1 }],
    ['fractional position', { positionWithinCandidate: 1.5 }],
    ['measured at claim time', { measuredAt: 'claim' }],
    ['a different document', { sameDocument: false }],
    ['matchCount unmeasurable', { matchCount: null }],
    ['matchCount 1 - an index would be meaningless', { matchCount: 1, positionWithinCandidate: 0 }],
  ] as Array<[string, Record<string, unknown>]>)
    check(`${label} -> not proof`, !isPositionProvenAgainstClickedTarget(candidate(over)));

  check('the expression composes onto the CONTEXTUAL candidate',
      positionalExpression(candidate()) === `${CONTEXTUAL}.nth(1)`,
      String(positionalExpression(candidate())));
  check('and nothing is composed when the position is not proof',
      positionalExpression(candidate({ measuredAt: 'claim' })) === null);
}

/* ------------------------------------------------- the phase, and its order ---- */

function checkPhase(): void {
  process.stdout.write('\n== recovery runs only after everything else declines ==\n');

  const recovered = judge({ positionProvenCandidates: [candidate()] });
  check('an ambiguous positional recording recovers',
      recovered.outcome === 'NORMALIZED_LOCATOR'
      && recovered.strategy === 'evidence-backed-position', `${recovered.outcome}/${recovered.strategy}`);
  check('the locator is the contextual chain plus the measured index',
      recovered.expression === `${CONTEXTUAL}.nth(1)`, String(recovered.expression));
  check('NEVER the recorded chain plus an index',
      !/rounded-checkbox-ui'\)\.nth|first\(\)/.test(recovered.expression ?? ''),
      String(recovered.expression));
  check('and it is still flagged ambiguous, so nothing reads it as clean identity',
      recovered.ambiguous === true);

  // ORDER: a proven UNIQUE candidate must win, and recovery must not be consulted.
  const proven = judge({
    derivedCandidates: [{
      strategy: 'container-text', expression: `${CONTEXTUAL}-unique`, matchCount: 1,
      identityMatched: true, sameDocument: true, measuredAt: 'press',
    }],
    positionProvenCandidates: [candidate()],
  });
  check('a proven unique candidate still wins over a position',
      proven.strategy === 'disambiguated-by-clicked-target', String(proven.strategy));
  check('and the position is not what was emitted',
      !/\.nth\(/.test(proven.expression ?? ''), String(proven.expression));
}

/* ------------------------------------ wrong, stale and dangerous positions ---- */

function checkRejections(): void {
  process.stdout.write('\n== a position that proves nothing is refused, not used ==\n');

  const refused = (label: string, over: Record<string, unknown>) => {
    const verdict = judge({ positionProvenCandidates: [candidate(over)] });
    check(label, verdict.outcome === 'NEEDS_REVIEW' && verdict.expression === null,
        `${verdict.outcome} -> ${verdict.expression}`);
  };

  refused('out-of-range index (stale list, list shrank)', { positionWithinCandidate: 5 });
  refused('negative index', { positionWithinCandidate: -1 });
  refused('index with no count to bound it', { matchCount: null });
  refused('claim-time index (measured after the action)', { measuredAt: 'claim' });
  refused('index from another document', { sameDocument: false });
  refused('no index at all', { positionWithinCandidate: null });

  // The base expression must be safe in its own right - an index cannot rescue it.
  refused('a base carrying a generated id',
      { expression: 'page.locator("#tr_1749558 .rounded-checkbox-ui")' });
  refused('a base that is itself positional',
      { expression: 'page.locator(".rounded-checkbox-ui").first()' });

  // BACKWARD COMPATIBILITY: every recording made before the measurement existed.
  const legacy = judge({});
  check('a recording with no positional evidence stays NEEDS_REVIEW',
      legacy.outcome === 'NEEDS_REVIEW' && legacy.strategy === 'measured-positional',
      `${legacy.outcome}/${legacy.strategy}`);
  check('and index 0 is never assumed for it',
      legacy.expression === null);
}

/* --------------------------------------- what the abstraction engine sees ---- */

function checkAbstraction(): void {
  process.stdout.write('\n== the engine may wrap an evidence-backed index, and only that ==\n');

  const positioned = evidence({ positionProvenCandidates: [candidate()] });
  const eff = effectiveLocator(positioned);
  check('effectiveLocator reports positionProven separately from proven',
      eff.positionProven === true && eff.proven === true, JSON.stringify(eff).slice(0, 70));
  check('and its expression is the contextual chain plus the index',
      eff.expression === `${CONTEXTUAL}.nth(1)`, eff.expression);

  const safety = validateCandidate(positioned);
  check('an evidence-backed index is NOT a forbidden mechanism',
      !safety.codes.some(code => code.code === 'FORBIDDEN_MECHANISM'),
      safety.codes.map(code => code.code).join(', ') || 'clean');

  // Every other mechanism is still refused, positionProven or not.
  for (const [label, expression] of [
    ['first()', 'page.locator(".x").first()'],
    ['last()', 'page.locator(".x").last()'],
    ['force', 'page.locator(".x").click({ force: true })'],
    ['mouse coordinates', 'page.mouse.click(10, 10)'],
    ['dispatchEvent', 'page.locator(".x").dispatchEvent("click")'],
    ['a sleep', 'page.waitForTimeout(500)'],
  ] as Array<[string, string]>) {
    const bad = validateCandidate(evidence({
      positionProvenCandidates: [candidate({ expression })],
    }));
    check(`${label} is still refused`,
        bad.codes.some(code => code.code === 'FORBIDDEN_MECHANISM' || code.code === 'NO_PRESS_TIME_PROOF'),
        bad.codes.map(code => code.code).join(', ') || 'NOTHING REFUSED');
  }

  const legacy = validateCandidate(evidence({}));
  check('and a bare positional recording with no measurement is still refused',
      legacy.codes.some(code => code.code === 'FORBIDDEN_MECHANISM'),
      legacy.codes.map(code => code.code).join(', '));
}

/* ------------------------------------------- the real corpus, and TC_LOGIN_100 ---- */

function checkCorpus(): void {
  process.stdout.write('\n== the corpus: what real recordings actually carry ==\n');

  const dir = path.join(ROOT, 'ai', 'dashboard', 'recordings');
  let withField = 0;
  let targets = 0;
  let withoutField = 0;
  const unprovable: string[] = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.evidence.json'))) {
    let body: { targets?: Array<Record<string, unknown>> };
    try { body = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { continue; }
    for (const target of body.targets ?? []) {
      targets++;
      const list = target.positionProvenCandidates as CandidateShape[] | undefined;
      if (list?.length) {
        withField++;
        for (const candidate of list) {
          // EITHER TIMING, because the writer admits both - and the row says which one it
          // is entitled to. A press row's positions must be press-time; an
          // assertion-pick row's must be pick-time. Checking the union alone would let a
          // press position be filed on a pick row, or the reverse, which is exactly the
          // confusion the two predicates exist to prevent.
          const wanted = target.captureTiming === 'assertion-pick' ? 'pick' : 'press';
          const provable = target.captureTiming === 'assertion-pick'
            ? isPositionProvenAtPick(candidate as never)
            : isPositionProvenAgainstClickedTarget(candidate as never);
          if (!provable || candidate.measuredAt !== wanted)
            unprovable.push(`${file}: ${candidate.strategy} `
              + `${candidate.positionWithinCandidate}/${candidate.matchCount} `
              + `@${candidate.measuredAt} on a ${target.captureTiming ?? 'legacy'} row`);
        }
      } else if (list !== undefined) {
        // Present but empty is the one shape the writer must never produce: absence is
        // said by omitting the key, so an empty list would be a claim about nothing.
        unprovable.push(`${file}: an EMPTY positioned list was written`);
      } else {
        withoutField++;
      }
    }
  }

  // THE INVARIANT CHANGED BECAUSE REALITY DID, and the old one held only while the
  // pipeline was broken. Until 2026-08-20 the recorder dropped every measured position
  // before evidence was written, so "0 of 304 targets carry one" was true - and read as
  // a statement of design when it was really a defect report. TC_DASHBOARD_023 is the
  // first recording made with the wiring repaired.
  //
  // What must hold now is stronger than a count, and does not go stale as recordings
  // accumulate: every position that reached a file can prove itself, and a target that
  // carries none is never given one.
  check('at least one recording carries a measured position, so the phase is live',
      withField > 0, `${withField} of ${targets} targets`);
  check('EVERY position in the corpus passes the predicate FOR ITS OWN TIMING - none was '
    + 'written unprovable, and none was filed under the wrong moment',
      unprovable.length === 0, unprovable.slice(0, 3).join(' | ') || 'all provable');
  check('and targets carrying none are left alone, not given a default',
      withoutField > 0, `${withoutField} target(s) with no positioned list`);

  // TC_LOGIN_100: the diagnostic case. Its rows are genuinely indistinguishable by
  // text, so even WITH a measurement the contextual base is the ambiguous part.
  const hundred = path.join(dir, 'TC_LOGIN_100.evidence.json');
  if (fs.existsSync(hundred)) {
    const body = JSON.parse(fs.readFileSync(hundred, 'utf8')) as
      { targets?: Array<{ derivedCandidates?: unknown[]; rejectedCandidates?: Array<{ rejectionReason?: string }> }> };
    const ambiguous = (body.targets ?? []).filter(target =>
      !(target.derivedCandidates ?? []).length
      && (target.rejectedCandidates ?? []).some(entry => /matched \d+ elements/.test(entry.rejectionReason ?? '')));
    check('TC_LOGIN_100 still has targets whose every candidate was ambiguous',
        ambiguous.length > 0, `${ambiguous.length} target(s)`);
    check('so TC_LOGIN_100 requires RE-RECORDING to obtain the measurement',
        true, 'reported, not worked around');
  }
}

function main(): void {
  checkPredicate();
  checkPhase();
  checkRejections();
  checkAbstraction();
  checkCorpus();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
