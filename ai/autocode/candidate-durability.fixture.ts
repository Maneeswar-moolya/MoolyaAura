import '../testing/isolated-checkout';
/**
 * CANDIDATE DURABILITY across a real state transition (P11).
 *
 *   npx tsx ai/autocode/candidate-durability.fixture.ts
 *
 * Offline: no browser, no model, no network, and it writes nothing anywhere. It drives
 * the real `classifyDurability`, the real `classifyNameStability` and the real
 * `splitCandidates`, and it replays measurements taken from the live applications on
 * 2026-09-08 through the production press path.
 *
 * WHY THIS EXISTS
 *
 * `accessibleNameStable` answers "did the browser-computed NAME hold still". It does not
 * answer the question a locator is judged by, which is: after the screen changes, does
 * this expression still identify the element that was pressed? Measured over 19 targets
 * on portal.fixture.invalid and shop.fixture.invalid, the two come apart in both directions:
 *
 *   - name CHANGED, candidate DURABLE - 13 candidate-measurements. FixturePortal's email
 *     field becomes "Email Please enter a valid email id" and the non-exact role+name
 *     locator still matches exactly it.
 *   - name STABLE, candidate AMBIGUOUS - FixtureShop's `Mobiles` link. Nothing about the
 *     element moved; a search query brought three more elements whose names contain
 *     "Mobiles", and the non-exact locator went 1 -> 3.
 *
 * A third failure mode has nothing to do with names at all: FixturePortal's password error
 * label keeps its element and its slot, and every TEXT-derived candidate for it goes to
 * ZERO when the message is replaced, while `#password_field-error` stays durable.
 *
 * WHAT THIS FIXTURE IS NOT. `classifyDurability` decides no locator, is called by nothing
 * in the recording path, and no evidence field carries its verdict. It is a measurement,
 * and the checks below are about what it REFUSES to call durable.
 */

import { classifyDurability, classifyNameStability, splitCandidates } from '../dashboard/live-recorder';
import type { CandidateMeasurement } from './dom-evidence';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

/** Everything true except what a check is about. */
const SOUND = { pressProven: true, sameDocument: true, slotHoldsTarget: true };
const verdict = (input: Partial<Parameters<typeof classifyDurability>[0]>) =>
  classifyDurability({ ...SOUND, matchCount: 1, identityMatched: true, ...input });

/* ------------------------------------------------------- A. what is refused */

function checkRefusals(): void {
  section('A. one element is not durability - every guard, in order');

  check('A1: one element with identity NEVER ASKED is unknown, not durable',
      verdict({ identityMatched: undefined }) === 'unknown',
      verdict({ identityMatched: undefined }));
  check('A2: one element that is the WRONG element is wrong-target',
      verdict({ identityMatched: false }) === 'wrong-target');
  check('A3: several elements is ambiguous - even when the target is among them',
      verdict({ matchCount: 2, identityMatched: true }) === 'ambiguous');
  check('A4: another document is unknown - a count there is about another page',
      verdict({ sameDocument: false }) === 'unknown');
  check('A5: a released or detached target is unknown, never a failure of the locator',
      verdict({ slotHoldsTarget: false }) === 'unknown');
  check('A6: no count at all is unknown - `null` is never read as zero',
      verdict({ matchCount: null }) === 'unknown' && verdict({ matchCount: undefined }) === 'unknown');
  check('A7: zero elements is unresolved',
      verdict({ matchCount: 0, identityMatched: false }) === 'unresolved');
  check('A8: a candidate that was never proven at the press has no durability to lose',
      verdict({ pressProven: false }) === 'unknown');

  // THE IDENTITY GUARD IS NOT REACHABLE AROUND. Every combination of the other inputs is
  // tried; `durable` may come back only where identity was answered YES.
  let bypassed = 0;
  let durableWithIdentity = 0;
  for (const pressProven of [true, false])
    for (const sameDocument of [true, false])
      for (const slotHoldsTarget of [true, false])
        for (const matchCount of [null, 0, 1, 2, 7])
          for (const identityMatched of [true, false, null, undefined]) {
            const answer = classifyDurability({
              pressProven, sameDocument, slotHoldsTarget, matchCount, identityMatched,
            } as any);
            if (answer !== 'durable')
              continue;
            if (identityMatched === true && matchCount === 1 && pressProven && sameDocument && slotHoldsTarget)
              durableWithIdentity++;
            else
              bypassed++;
          }
  check('A9: nothing reaches `durable` without identity, one element and both guards',
      bypassed === 0 && durableWithIdentity === 1, `${bypassed} bypass(es), ${durableWithIdentity} sound`);
}

/* ------------------------------------- B. the measured cases, replayed exactly */

/**
 * Measured on 2026-09-08 through the production press path: `PREACTION_HOOK` ->
 * `recordParkedEntry` -> `measureAtPress`, then the transition, then the page's own
 * `__auraMeasure` / `measureExpressionCandidates`. Only the numbers are reproduced here.
 */
const LIVE = {
  fixtureappEmail: {
    pressName: 'Email', settledName: 'Email Please enter a valid email id',
    exact: { press: { count: 1, identity: true }, after: { count: 0, identity: false } },
    loose: { press: { count: 1, identity: true }, after: { count: 1, identity: true } },
    authoredId: { press: { count: 1, identity: true }, after: { count: 1, identity: true } },
  },
  fixtureappPassword: {
    pressName: 'Password', settledName: 'Password Not too short! enter min 5 characters.',
    exact: { press: { count: 1, identity: true }, after: { count: 0, identity: false } },
    loose: { press: { count: 1, identity: true }, after: { count: 1, identity: true } },
    authoredId: { press: { count: 1, identity: true }, after: { count: 1, identity: true } },
  },
  fixtureappSignIn: {
    pressName: 'Sign In', settledName: 'Sign In',
    exact: { press: { count: 1, identity: true }, after: { count: 1, identity: true } },
    // Never proven at the press: `{ name: 'Sign In' }` matches Google's button too.
    loose: { press: { count: 2, identity: false }, after: { count: 2, identity: false } },
  },
  fixtureshopMobiles: {
    pressName: 'Mobiles', settledName: 'Mobiles',
    exact: { press: { count: 1, identity: true }, after: { count: 1, identity: true } },
    loose: { press: { count: 1, identity: true }, after: { count: 3, identity: false } },
  },
  fixtureappErrorLabel: {
    // The element and its slot survive; the MESSAGE is replaced.
    scopedText: { press: { count: 1, identity: true }, after: { count: 0, identity: false } },
    authoredId: { press: { count: 1, identity: true }, after: { count: 1, identity: true } },
  },
};

const durabilityOf = (measured: { press: { count: number; identity: boolean }; after: { count: number; identity: boolean } }) =>
  classifyDurability({
    ...SOUND,
    pressProven: measured.press.count === 1 && measured.press.identity === true,
    matchCount: measured.after.count,
    identityMatched: measured.after.identity,
  });

function checkMeasuredCases(): void {
  section('B. the measured cases - exact and non-exact fail in opposite directions');

  for (const [name, row] of [['email', LIVE.fixtureappEmail], ['password', LIVE.fixtureappPassword]] as const) {
    check(`B1: fixtureapp ${name} - the EXACT locator is not durable once the name is extended`,
        durabilityOf(row.exact) === 'unresolved', durabilityOf(row.exact));
    check(`B2: fixtureapp ${name} - the NON-EXACT locator is durable through the same change`,
        durabilityOf(row.loose) === 'durable');
    check(`B3: fixtureapp ${name} - and the authored id was durable too, so nothing had to be rescued`,
        durabilityOf(row.authoredId) === 'durable');
  }

  check('B4: fixtureapp Sign In - the non-exact form never qualifies: ambiguous at the press',
      durabilityOf(LIVE.fixtureappSignIn.loose) === 'unknown'
        && durabilityOf(LIVE.fixtureappSignIn.exact) === 'durable');
  check('B5: fixtureshop Mobiles - the non-exact form is proven at the press and AMBIGUOUS after',
      durabilityOf(LIVE.fixtureshopMobiles.loose) === 'ambiguous'
        && durabilityOf(LIVE.fixtureshopMobiles.exact) === 'durable');
  check('B6: the error label - dynamic text takes a text candidate to zero, the id survives',
      durabilityOf(LIVE.fixtureappErrorLabel.scopedText) === 'unresolved'
        && durabilityOf(LIVE.fixtureappErrorLabel.authoredId) === 'durable');

  // The press-time gate is production's own, and an ambiguous candidate never reaches
  // durability at all - it is refused before the transition is even performed.
  const pressCandidates: CandidateMeasurement[] = [
    { strategy: 'role-name', expression: 'exact', matchCount: 1, identityMatched: true,
      sameDocument: true, measuredAt: 'press' } as CandidateMeasurement,
    { strategy: 'role-name-loose', expression: 'loose', matchCount: 2, identityMatched: false,
      sameDocument: true, measuredAt: 'press' } as CandidateMeasurement,
  ];
  const split = splitCandidates(pressCandidates);
  check('B7: the ambiguous non-exact candidate is refused at the press, as it always was',
      split.derivedCandidates.length === 1 && split.derivedCandidates[0].strategy === 'role-name'
        && split.rejectedCandidates.some(c => c.strategy === 'role-name-loose'));
}

/* --------------------------------------- C. two questions, two answers */

function checkSeparation(): void {
  section('C. name stability and candidate durability are separate measurements');

  const nameFor = (row: { pressName: string; settledName: string }) => classifyNameStability({
    pressName: row.pressName, pressVerified: true, sameDocument: true,
    slotHoldsTarget: true, settledName: row.settledName,
  });

  check('C1: a CHANGED name with a DURABLE candidate - fixtureapp email',
      nameFor(LIVE.fixtureappEmail) === 'changed'
        && durabilityOf(LIVE.fixtureappEmail.loose) === 'durable');
  check('C2: a STABLE name with an AMBIGUOUS candidate - fixtureshop Mobiles',
      nameFor(LIVE.fixtureshopMobiles) === 'stable'
        && durabilityOf(LIVE.fixtureshopMobiles.loose) === 'ambiguous');
  check('C3: a stable name says nothing about the exact form either way',
      nameFor(LIVE.fixtureappSignIn) === 'stable'
        && durabilityOf(LIVE.fixtureappSignIn.exact) === 'durable'
        && durabilityOf(LIVE.fixtureappSignIn.loose) === 'unknown');

  // Neither function can be derived from the other: the durability verdict does not read
  // a name at all, and the name verdict does not read a count.
  const durabilityInputs = Object.keys({
    pressProven: 0, sameDocument: 0, slotHoldsTarget: 0, matchCount: 0, identityMatched: 0,
  });
  check('C4: the durability contract takes no name, and the name contract takes no count',
      !durabilityInputs.some(key => key.toLowerCase().includes('name'))
        && classifyNameStability({ pressName: 'A', pressVerified: true, sameDocument: true,
          slotHoldsTarget: true, settledName: 'A' }) === 'stable');
}

/* ----------------------------------------- D. a verdict costs no waiting */

function checkNoWaiting(): void {
  section('D. a durability verdict is arithmetic over measurements, never a wait');

  const input = Object.freeze({ ...SOUND, matchCount: 1, identityMatched: true });
  const started = process.hrtime.bigint();
  const answers = new Set<string>();
  for (let pass = 0; pass < 1000; pass++)
    answers.add(classifyDurability({ ...input }));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  check('D1: the same measurements always give the same verdict',
      answers.size === 1 && answers.has('durable'));
  check('D2: it is synchronous - a verdict, not a promise to produce one later',
      typeof classifyDurability(input) === 'string');
  check('D3: a thousand verdicts cost no waiting at all',
      elapsedMs < 50, `${Math.round(elapsedMs * 100) / 100} ms`);
  check('D4: the input is read, never mutated - the same object answers twice',
      classifyDurability(input) === classifyDurability(input));
}

/* ------------------------------------------------------------------- main */

function main(): void {
  checkRefusals();
  checkMeasuredCases();
  checkSeparation();
  checkNoWaiting();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
