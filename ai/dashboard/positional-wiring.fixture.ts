/**
 * The wiring between a measured position and the evidence file.
 *
 *   npx tsx ai/dashboard/positional-wiring.fixture.ts
 *
 * WHY THIS EXISTS AND positional-recovery.fixture.ts DOES NOT COVER IT. That file
 * tests the DECISION: given evidence that carries a proven position, what locator
 * comes out. It builds its evidence by hand, which is the right way to test a
 * decision and is exactly why it could not catch this - the decision layer was
 * correct all along, and the field never reached it.
 *
 * Two links were broken, and each one on its own was enough to make the whole
 * mechanism unreachable for every recording:
 *
 *   1. `measureCandidates` built a `CandidateMeasurement` from the page's answer and
 *      never copied `positionWithinCandidate`. The in-page half computed it; the
 *      recorder dropped it one line later.
 *   2. `splitCandidates` sends anything that is not proven-unique to
 *      `rejectedCandidates`, and a position exists only when the count is above one -
 *      so a positioned candidate always landed there. Persistence harvested
 *      `positionProvenCandidates` by FILTERING `derivedCandidates`, which admits
 *      `matchCount === 1` alone. The two conditions are mutually exclusive: that
 *      block could never run.
 *
 * The failure mode is what makes it worth a fixture of its own. Nothing threw and
 * nothing went red. Evidence was written with no position in it, recovery correctly
 * declined for want of a measurement, and the case reported NEEDS_REVIEW - which is
 * also precisely what a correct pipeline reports for a recording made before the
 * field existed. Broken and working looked identical from the outside.
 *
 * Offline: no browser, no model, no network.
 */

import {
  isPositionProvenAgainstClickedTarget, sanitiseEvidence,
  type CandidateMeasurement, type TargetEvidence,
} from '../autocode/dom-evidence';
import { assessLocator } from '../autocode/locator-quality';
import { splitCandidates } from './live-recorder';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const CONTEXTUAL =
  'page.locator(".tabulator-row").filter({ hasText: "Line Chart" }).locator(".rounded-checkbox-ui")';

/** Proven unique: one element, and it is the one that was pressed. */
const UNIQUE: CandidateMeasurement = {
  strategy: 'container-text', expression: `${CONTEXTUAL}-unique`, matchCount: 1,
  identityMatched: true, sameDocument: true, measuredAt: 'press',
};

/** Ambiguous, but the browser recorded which of the three was pressed. */
const POSITIONED: CandidateMeasurement = {
  strategy: 'container-text', expression: CONTEXTUAL, matchCount: 3,
  identityMatched: false, sameDocument: true, measuredAt: 'press',
  positionWithinCandidate: 1,
};

/** Ambiguous and unpositioned - the ordinary refusal, and it must stay one. */
const AMBIGUOUS: CandidateMeasurement = {
  strategy: 'css', expression: 'page.locator(".rounded-checkbox-ui")', matchCount: 3,
  identityMatched: false, sameDocument: true, measuredAt: 'press',
};

const target = (over: Partial<TargetEvidence> = {}): TargetEvidence => ({
  locator: "page.locator('.rounded-checkbox-ui').first()",
  target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
  ancestors: [{ tag: 'div', id: 'bugReport-table', stableClasses: ['tabulator'] }],
  captureTiming: 'before-action', matchCount: 3,
  // The writer walks all of these unconditionally, so a target has to carry them.
  children: [], descendants: [], previousSiblings: [], nextSiblings: [], relationships: [],
  derivedCandidates: [], rejectedCandidates: [],
  ...over,
} as unknown as TargetEvidence);

/* ------------------------------------------- LINK 2: the recorder's own split ---- */

function checkSplit(): void {
  process.stdout.write('\n== the recorder keeps the position without promoting anything ==\n');

  const split = splitCandidates([UNIQUE, POSITIONED, AMBIGUOUS]);

  check('the proven-unique candidate is the ONLY promotable one',
      split.derivedCandidates.length === 1
      && split.derivedCandidates[0].expression === UNIQUE.expression,
      split.derivedCandidates.map(c => c.expression).join(', ') || 'none');

  check('a positioned candidate is NOT promoted to derivedCandidates',
      !split.derivedCandidates.some(c => c.expression === CONTEXTUAL),
      'matchCount 3 must never read as a unique locator');

  check('it is still refused as a locator, with a reason',
      split.rejectedCandidates.some(c => c.expression === CONTEXTUAL && Boolean(c.rejectionReason)),
      split.rejectedCandidates.find(c => c.expression === CONTEXTUAL)?.rejectionReason ?? 'NO REASON');

  check('and it is ALSO reported as a measured position',
      split.positionProvenCandidates.length === 1
      && split.positionProvenCandidates[0].positionWithinCandidate === 1,
      JSON.stringify(split.positionProvenCandidates.map(c => c.positionWithinCandidate)));

  check('an ambiguous candidate with NO position is refused and not reported',
      split.rejectedCandidates.some(c => c.expression === AMBIGUOUS.expression)
      && !split.positionProvenCandidates.some(c => c.expression === AMBIGUOUS.expression));

  check('nothing is lost: every candidate comes out somewhere',
      split.derivedCandidates.length + split.rejectedCandidates.length === 3
      && split.candidatesTried === 3);

  // A position that cannot prove itself must not be reported, even here.
  for (const [label, over] of [
    ['claim-time', { measuredAt: 'claim' as const }],
    ['other document', { sameDocument: false }],
    ['out of range', { positionWithinCandidate: 9 }],
    ['negative', { positionWithinCandidate: -1 }],
    ['fractional', { positionWithinCandidate: 1.5 }],
  ] as Array<[string, Partial<CandidateMeasurement>]>) {
    const one = splitCandidates([{ ...POSITIONED, ...over } as CandidateMeasurement]);
    check(`a ${label} position is not reported as proven`,
        one.positionProvenCandidates.length === 0,
        `${one.positionProvenCandidates.length} reported`);
  }
}

/* ------------------------------------------------ LINK 3: what reaches the file ---- */

function checkPersistence(): void {
  process.stdout.write('\n== the position survives being written to evidence.json ==\n');

  const split = splitCandidates([UNIQUE, POSITIONED, AMBIGUOUS]);
  const written = sanitiseEvidence([target({
    derivedCandidates: split.derivedCandidates,
    rejectedCandidates: split.rejectedCandidates,
    positionProvenCandidates: split.positionProvenCandidates,
  })], new Date().toISOString());
  const [entry] = written.targets ?? [];

  check('evidence.json carries positionProvenCandidates',
      (entry?.positionProvenCandidates ?? []).length === 1,
      `${(entry?.positionProvenCandidates ?? []).length} entry(ies)`);
  check('with the measured index intact',
      entry?.positionProvenCandidates?.[0]?.positionWithinCandidate === 1,
      String(entry?.positionProvenCandidates?.[0]?.positionWithinCandidate));
  check('and the expression it belongs to',
      entry?.positionProvenCandidates?.[0]?.expression === CONTEXTUAL,
      String(entry?.positionProvenCandidates?.[0]?.expression));
  check('derivedCandidates still holds only the proven-unique one',
      (entry?.derivedCandidates ?? []).length === 1
      && !(entry?.derivedCandidates ?? []).some(c => c.expression === CONTEXTUAL));

  // THE ORIGINAL BUG, pinned: persistence must read its own list, never filter
  // derivedCandidates. If it filtered, this case would emit nothing.
  const noList = sanitiseEvidence([target({
    derivedCandidates: [UNIQUE], rejectedCandidates: [POSITIONED, AMBIGUOUS],
  })], new Date().toISOString()).targets?.[0];
  check('a target the recorder gave no positioned list gets no position invented',
      noList?.positionProvenCandidates === undefined,
      JSON.stringify(noList?.positionProvenCandidates));

  // And a position that fails the predicate is dropped at the file boundary too.
  const bad = sanitiseEvidence([target({
    positionProvenCandidates: [{ ...POSITIONED, measuredAt: 'claim' } as CandidateMeasurement],
  })], new Date().toISOString()).targets?.[0];
  check('an unprovable position is dropped rather than written',
      bad?.positionProvenCandidates === undefined,
      JSON.stringify(bad?.positionProvenCandidates));
}

/* ------------------------------- the join: written evidence drives the decision ---- */

function checkJoin(): void {
  process.stdout.write('\n== written evidence produces the contextual + measured locator ==\n');

  const split = splitCandidates([POSITIONED, AMBIGUOUS]);
  const written = sanitiseEvidence([target({
    derivedCandidates: split.derivedCandidates,
    rejectedCandidates: split.rejectedCandidates,
    positionProvenCandidates: split.positionProvenCandidates,
  })], new Date().toISOString());

  const verdict = assessLocator({
    locator: "page.locator('.rounded-checkbox-ui').first()", target: 'checkbox',
    kind: 'action', context: {} as never, evidence: written.targets?.[0] as never,
  });

  check('recovery fires from evidence that went through the real writer',
      verdict.strategy === 'evidence-backed-position', String(verdict.strategy));
  check('the locator is the CONTEXTUAL candidate plus the measured index',
      verdict.expression === `${CONTEXTUAL}.nth(1)`, String(verdict.expression));
  check('NOT the bare recorded selector plus an index',
      !/^page\.locator\("?\.rounded-checkbox-ui"?\)\.nth/.test(verdict.expression ?? ''),
      String(verdict.expression));
  check('and NOT first()',
      !/\.first\(\)/.test(verdict.expression ?? ''));

  // WHAT THE TARGET'S OWN COUNT DECIDES. When Codegen writes an ambiguous click
  // WITHOUT `.first()`, the recorded locator matches several elements and the target's
  // own matchCount is above one - `measured-ambiguous`, a different exhaustion point
  // from the positional branch at 1b, and for a while the only one consulting nothing.
  //
  // The 1-and-null rows here USED TO assert recovery as well, and that was wrong: it
  // was pinning the tail call in `fromEvidence` that pre-empted the offline scorer.
  // A target the browser measured at ONE element is not ambiguous, and putting an
  // index on it would narrow a locator that already identifies its element. Unmeasured
  // (null) keeps the pre-existing policy for a bare CSS class - emitted as a last
  // resort, unchanged by this phase. So the invariant is the count, not the presence
  // of a position: recovery is for the ambiguous case and only for it.
  const shapedFor = (recordedCount: number | null) => assessLocator({
    locator: "page.locator('.rounded-checkbox-ui')", target: 'checkbox',
    kind: 'action', context: {} as never,
    evidence: sanitiseEvidence([target({
      matchCount: recordedCount as never,
      derivedCandidates: [], rejectedCandidates: [AMBIGUOUS],
      positionProvenCandidates: [POSITIONED],
    })], new Date().toISOString()).targets?.[0] as never,
  });

  const ambiguousTarget = shapedFor(3);
  check('a recorded locator measured at 3 recovers with the index',
      ambiguousTarget.expression === `${CONTEXTUAL}.nth(1)`,
      `${ambiguousTarget.strategy} -> ${ambiguousTarget.expression}`);

  for (const count of [1, null] as Array<number | null>) {
    const verdict = shapedFor(count);
    check(`a recorded locator measured at ${String(count)} is NOT given an index`,
        !/\.nth\(/.test(verdict.expression ?? ''),
        `${verdict.strategy} -> ${verdict.expression}`);
  }

  // Negative: the same recording with the position withheld stays NEEDS_REVIEW.
  const withheld = sanitiseEvidence([target({
    derivedCandidates: [], rejectedCandidates: [POSITIONED, AMBIGUOUS],
  })], new Date().toISOString());
  const declined = assessLocator({
    locator: "page.locator('.rounded-checkbox-ui').first()", target: 'checkbox',
    kind: 'action', context: {} as never, evidence: withheld.targets?.[0] as never,
  });
  check('no positioned list -> NEEDS_REVIEW and no locator',
      declined.outcome === 'NEEDS_REVIEW' && declined.expression === null,
      `${declined.outcome} -> ${declined.expression}`);
}

/* ---------------------------------------------- the predicate is the only gate ---- */

function checkPredicateIsSole(): void {
  process.stdout.write('\n== one predicate decides, in both places ==\n');
  check('the recorder and the writer agree, because both call the same predicate',
      isPositionProvenAgainstClickedTarget(POSITIONED)
      && splitCandidates([POSITIONED]).positionProvenCandidates.length === 1);
  check('and a candidate the predicate refuses is refused by both',
      !isPositionProvenAgainstClickedTarget(AMBIGUOUS)
      && splitCandidates([AMBIGUOUS]).positionProvenCandidates.length === 0);
}

function main(): void {
  checkSplit();
  checkPersistence();
  checkJoin();
  checkPredicateIsSole();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
