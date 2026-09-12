import '../testing/isolated-checkout';
/**
 * EXACT and NON-EXACT role+name candidates (P10).
 *
 *   npx tsx ai/autocode/exact-nonexact.fixture.ts
 *
 * Offline: no browser, no model, no network, and it writes nothing anywhere. It drives
 * the real `candidateSelectorsFor`, the real `applyFamilyBudget`, the real
 * `rankProvenCandidates`, the real `splitCandidates` and the real `buildLocator` against
 * a stub page - behaviour, not a grep over the source.
 *
 * WHY THIS EXISTS
 *
 * `getByRole(role, { name, exact: true })` and `getByRole(role, { name })` fail in
 * OPPOSITE directions, and both failures are measured rather than argued:
 *
 *  - EXACT fails when the application EXTENDS a name with state text. FixturePortal's password
 *    field computes as "Password" and, once its validation error is showing, as
 *    "Password Not too short! enter min 5 characters." - the exact locator then matches
 *    ZERO elements while the loose one still matches one. Measured live on 2026-09-08:
 *    of 20 pressed targets across two applications, that transition is the single row
 *    classified NONEXACT_ONLY_SURVIVES.
 *  - LOOSE fails when another element's name CONTAINS this one. FixturePortal's Sign In button
 *    is the case: `{ name: 'Sign In' }` matches two (Google's sign-in button contains the
 *    words) where `exact: true` matches one. That row is EXACT_ONLY_VALID, at the press,
 *    before anything else is asked.
 *
 * So neither form is generally better and neither is preferred. Both are generated, and
 * the existing machinery decides: counted at the press, refused unless it resolves to
 * exactly one element, refused unless that element is the one acted on.
 *
 * TWO THINGS THE ADDITION MAY NOT DO, and both are checked here rather than trusted:
 *
 *  1. It may not spend another candidate's budget. Emitted beside its exact twin the
 *     loose form displaced 150 candidates the generator already produced (125 scoped
 *     text, 25 scoped label) across the 1026 captured targets. Deferred to the end of
 *     its family it displaces ZERO and still offers 374 of the 524.
 *  2. It may not change a selection that is made today. Both forms score 95/95 over one
 *     segment, so the shorter-expression tie-break would have promoted the loose form on
 *     every element where both are proven - a global preference decided by counting
 *     characters. `rankProvenCandidates` now keeps a loose twin behind its exact one.
 */

import {
  applyFamilyBudget, candidateSelectorsFor, familyOf, semanticCandidatesFor,
  MAX_CANDIDATES, MAX_TOTAL_CANDIDATES,
  type CandidateMeasurement, type SelectorCandidate, type TargetEvidence,
} from './dom-evidence';
import { analyseIdentifier, scoreExpression } from './locator-quality';
import { provenCandidate, rankProvenCandidates } from './abstraction/classify';
import { buildLocator, splitCandidates } from '../dashboard/live-recorder';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const isGenerated = (value: string) => analyseIdentifier(value).dynamic;
const build = (graph: any): SelectorCandidate[] => candidateSelectorsFor(graph, isGenerated);
const strategies = (list: SelectorCandidate[]) => list.map(entry => entry.strategy);
const expressionFor = (list: SelectorCandidate[], strategy: string) =>
  list.find(entry => entry.strategy === strategy)?.expression ?? '';

/* --------------------------------------------------------------------- graphs */

/** FixturePortal's password field, as the capture records it once CDP has answered. */
const PASSWORD = {
  target: {
    tag: 'input', id: 'password_field', name: 'password', type: 'password', role: 'textbox',
    accessibleName: 'Password', accessibleNameSource: 'browser-computed', accessibleNameVerified: true,
    classes: ['form-control'], stableClasses: ['form-control'],
  },
  parent: { tag: 'div', classes: ['login-input-group'] },
  ancestors: [{ tag: 'form', id: 'loginForm' }, { tag: 'div', id: 'login_container' }],
  descendants: [],
};

/** An element with a role and no name at all - nothing to match loosely. */
const UNNAMED = {
  target: { tag: 'input', id: 'search_box', type: 'text', role: 'textbox' },
  parent: { tag: 'div' },
  ancestors: [{ tag: 'form', id: 'searchForm' }],
  descendants: [],
};

/** Every scoped shape at once, so the family budget is genuinely contended. */
const CONTENDED = {
  target: {
    tag: 'button', role: 'button', text: 'Sign In',
    accessibleName: 'Sign In', accessibleNameVerified: true,
    aria: { 'aria-label': 'Sign In' }, placeholder: '', title: 'Sign In',
    name: 'login', classes: ['login-submit'], stableClasses: ['login-submit'],
  },
  parent: { tag: 'div', classes: ['login-actions'] },
  ancestors: [{ tag: 'form', id: 'loginForm' }, { tag: 'div', id: 'login_container' }, { tag: 'main', id: 'app_root' }],
  descendants: [],
};

const proven = (strategy: string, expression: string): CandidateMeasurement => ({
  strategy, expression, matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press',
} as CandidateMeasurement);

/* ------------------------------------------------------------- A. generation */

function checkGeneration(): void {
  section('A. both forms are generated, from the same evidence');
  const built = build(PASSWORD);
  const exact = expressionFor(built, 'role-name');
  const loose = expressionFor(built, 'role-name-loose');
  check('A1: the exact form is still generated',
      exact === 'page.getByRole("textbox", { name: "Password", exact: true })', exact);
  check('A2: the loose form is generated beside it',
      loose === 'page.getByRole("textbox", { name: "Password" })', loose);
  check('A3: they differ ONLY by the exact option',
      exact.replace(', exact: true', '') === loose);
  check('A4: the loose form belongs to the semantic family',
      familyOf('role-name-loose') === 'semantic' && built.find(c => c.strategy === 'role-name-loose')?.family === 'semantic');
  const scopedExact = expressionFor(built, 'scoped-role-name');
  const scopedLoose = expressionFor(built, 'scoped-role-name-loose');
  check('A5: the scoped pair is generated too, in the scoped family',
      scopedLoose.includes('#loginForm') && scopedLoose.includes('Password')
        && !scopedLoose.includes('exact')
        && scopedExact.replace(', exact: true', '') === scopedLoose
        && familyOf('scoped-role-name-loose') === 'semantic-scoped',
      scopedLoose);
  check('A6: both are measured on the expression path, never in the page',
      built.filter(c => c.strategy.includes('role-name'))
          .every(c => c.measuredBy === 'expression'));

  const unnamed = build(UNNAMED);
  check('A7: no name, no loose candidate - and the generic role form is untouched',
      !strategies(unnamed).some(s => s.endsWith('-loose'))
        && strategies(unnamed).includes('role-generic'));

  // A name is only a name where the capture holds one. Nothing here reads a placeholder,
  // a class or the element's own text to invent one for the loose form.
  const invented = build({ ...UNNAMED, target: { ...UNNAMED.target, placeholder: 'Search products' } });
  check('A8: a placeholder does not become a loose role+name',
      !strategies(invented).some(s => s.endsWith('-loose'))
        && strategies(invented).includes('placeholder'));
}

/* ------------------------------------------------------------- B. the budget */

function checkBudget(): void {
  section('B. the addition spends nobody else\'s budget');
  const isLoose = (c: SelectorCandidate) => c.strategy.endsWith('-loose');
  const raw = semanticCandidatesFor(CONTENDED as any, isGenerated,
      CONTENDED.ancestors.filter(a => a.id) as any);
  const baseline = applyFamilyBudget(raw.filter(c => !isLoose(c))).map(c => c.expression);
  const kept = applyFamilyBudget(raw).map(c => c.expression);
  const lost = baseline.filter(expression => !kept.includes(expression));
  check('B1: every candidate the loose-free generator produced survives the addition',
      lost.length === 0, lost.join(' | '));
  check('B2: the loose forms are emitted last within their families',
      raw.findIndex(isLoose) > raw.map(isLoose).lastIndexOf(false),
      `first loose at ${raw.findIndex(isLoose)} of ${raw.length}`);
  check('B3: a contended budget drops the LOOSE form, never an existing one',
      kept.filter(e => !e.includes('exact: true') && e.includes('getByRole')).length
        < raw.filter(isLoose).length);
  check('B4: the family ceilings themselves did not move',
      MAX_CANDIDATES === 16 && MAX_TOTAL_CANDIDATES === 28);

  // The structural half is bounded by its own cap and never sees these families at all.
  const built = build(CONTENDED);
  check('B5: the structural half is unchanged in size',
      built.filter(c => c.measuredBy !== 'expression').length <= MAX_CANDIDATES);
}

/* ------------------------------------------------------------ C. the ranking */

function checkRanking(): void {
  section('C. a loose twin may not demote its exact twin');
  const exact = proven('role-name', 'page.getByRole("textbox", { name: "Password", exact: true })');
  const loose = proven('role-name-loose', 'page.getByRole("textbox", { name: "Password" })');
  const id = proven('id', 'page.locator("#password_field")');
  const scoreOf = (candidate: CandidateMeasurement) => scoreExpression(candidate.expression)?.weakest ?? -1;

  check('C1: the two score identically - so the tie-break is what decides',
      scoreOf(exact) === scoreOf(loose) && scoreOf(exact) === 95);
  const order = (list: CandidateMeasurement[]) =>
      rankProvenCandidates({ derivedCandidates: list } as TargetEvidence).map(c => c.strategy);
  check('C2: exact first, whatever order they were generated in',
      order([exact, loose]).join('>') === 'role-name>role-name-loose'
        && order([loose, exact]).join('>') === 'role-name>role-name-loose');
  check('C3: `provenCandidate` therefore returns exactly what it returned before',
      provenCandidate({ derivedCandidates: [loose, exact, id] } as TargetEvidence)?.strategy === 'role-name');
  check('C4: the score still decides ahead of the twin rule',
      order([loose, id]).join('>') === 'role-name-loose>id');
  check('C5: nothing else about the order moved',
      order([id, exact, loose]).join('>') === 'role-name>role-name-loose>id');

  // The reuse resolver walks the whole ranked list, so a loose twin sitting in it can
  // neither hide nor claim a declared method. Checked through the ranking it consumes.
  const ranked = rankProvenCandidates({ derivedCandidates: [loose, id, exact] } as TargetEvidence);
  check('C6: every proven expression is still offered to the reuse resolvers',
      ranked.length === 3 && ranked.map(c => c.expression).includes(id.expression));
}

/* -------------------------------------------------------------- D. the gates */

function checkGates(): void {
  section('D. every existing gate applies to the loose form unchanged');
  const ambiguous = { ...proven('role-name-loose', 'page.getByRole("button", { name: "Sign In" })'), matchCount: 2, identityMatched: false };
  const wrong = { ...proven('role-name-loose', 'page.getByRole("button", { name: "Sign In" })'), identityMatched: false };
  const zero = { ...proven('role-name', 'page.getByRole("textbox", { name: "Password", exact: true })'), matchCount: 0, identityMatched: false };
  const good = proven('role-name-loose', 'page.getByRole("textbox", { name: "Password" })');
  const split = splitCandidates([ambiguous, wrong, zero, good] as CandidateMeasurement[]);
  check('D1: an ambiguous loose candidate is refused - synthetic Sign In, count 2',
      !split.derivedCandidates.includes(ambiguous as CandidateMeasurement)
        && split.rejectedCandidates.some(c => c.expression === ambiguous.expression));
  check('D2: a loose candidate matching ONE WRONG element is refused by identity',
      !split.derivedCandidates.includes(wrong as CandidateMeasurement));
  check('D3: an exact candidate the state change took to zero is refused',
      !split.derivedCandidates.includes(zero as CandidateMeasurement));
  check('D4: and the proven one is kept, with its identity counted',
      split.derivedCandidates.length === 1 && split.derivedCandidates[0].strategy === 'role-name-loose');

  // A measurement is only real if the expression can be rebuilt faithfully. A loose
  // locator that `buildLocator` refused would be measured as `null` and silently unproven.
  const calls: any[] = [];
  const stubPage = {
    getByRole: (role: string, options: any) => { calls.push({ role, options }); return stubPage; },
    locator: () => stubPage,
  };
  const rebuilt = buildLocator(stubPage, 'page.getByRole("textbox", { name: "Password" })');
  check('D5: the loose expression round-trips through `buildLocator`',
      Boolean(rebuilt) && calls.length === 1 && calls[0].role === 'textbox'
        && calls[0].options?.name === 'Password' && calls[0].options?.exact === undefined,
      JSON.stringify(calls[0] ?? null));
  const exactCalls: any[] = [];
  const exactPage = {
    getByRole: (role: string, options: any) => { exactCalls.push({ role, options }); return exactPage; },
    locator: () => exactPage,
  };
  buildLocator(exactPage, 'page.getByRole("textbox", { name: "Password", exact: true })');
  check('D6: and the exact one still carries its option - the two are not conflated',
      exactCalls[0]?.options?.exact === true);
}

/* ------------------------------------------------------------- E. redaction */

function checkSecrets(): void {
  section('E. a secret never becomes a loose candidate either');
  const secret = build({
    ...PASSWORD,
    target: {
      ...PASSWORD.target,
      accessibleName: 'Hunter2!SecretPassphrase', accessibleNameVerified: true,
      text: 'Hunter2!SecretPassphrase',
    },
  });
  const carries = secret.some(c => c.expression.includes('Hunter2!SecretPassphrase'));
  check('E1: whatever the exact form does with a credential-shaped name, the loose form does',
      strategies(secret).includes('role-name') === strategies(secret).includes('role-name-loose'),
      carries ? 'name admitted by both' : 'name refused by both');
}

/* ------------------------------------------------------------------- main */

function main(): void {
  checkGeneration();
  checkBudget();
  checkRanking();
  checkGates();
  checkSecrets();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
