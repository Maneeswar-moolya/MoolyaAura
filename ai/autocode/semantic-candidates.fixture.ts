import '../testing/isolated-checkout';
import { reuseInputs } from '../testing/reuse-inputs';
import { findMethodByProvenLocator } from './from-recording';
/**
 * Semantic candidates, the family budget, and ranked selection (P5).
 *
 *   npx tsx ai/autocode/semantic-candidates.fixture.ts
 *
 * Offline: no browser, no model, no network, and it writes nothing anywhere. It drives
 * the real `candidateSelectorsFor`, the real `scoreExpression` and the real
 * `rankProvenCandidates`, and it reads `live-recorder.ts` as text for the wiring it
 * cannot reach without a page.
 *
 * WHY THIS EXISTS
 *
 * Four changes, each measured before it was made, over the whole recorded corpus of
 * 1058 targets:
 *
 *  1. The RECORDED locator was the only measured expression in the pipeline whose
 *     identity was never asked - absent on all 1058 - while 137 targets with no proven
 *     candidate at all carried one already counted at exactly one element in the press's
 *     own document. Codegen's `getByRole('link', { name: 'Mobiles' })` is the case.
 *  2. `candidateSelectorsFor` generated CSS shapes only, so `getByRole`, `getByLabel`,
 *     `getByPlaceholder` and the rest existed in the SCORING table and could never be
 *     produced as candidates. FixtureShop's Mobiles link built zero candidates of any kind.
 *  3. Adding those families takes 706 of 1058 targets past `MAX_CANDIDATES`, so a budget
 *     was needed that a prolific weak family cannot win.
 *  4. `provenCandidate` returned the FIRST proven candidate in generation order. On the
 *     sign-in button, nine were proven and it returned `#loginForm .login-submit`
 *     filtered by its own text while `getByRole('button', { name: 'Sign In' })` sat
 *     proven in the same list.
 *
 * And the scoring false positive that had to be fixed first, because ranking makes it
 * load-bearing: `GENERATED_CLASS` called `.login-submit` a bundler class.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  applyFamilyBudget, candidateSelectorsFor, familyOf, implicitRole, semanticCandidatesFor,
  FAMILY_BUDGET, MAX_CANDIDATES, MAX_TOTAL_CANDIDATES,
  type CandidateMeasurement, type SelectorCandidate, type TargetEvidence,
} from './dom-evidence';
import { analyseIdentifier, scoreChain, scoreExpression, parseChain } from './locator-quality';
import { provenCandidate, rankProvenCandidates } from './abstraction/classify';

const ROOT = process.cwd();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` â€” ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const isGenerated = (value: string) => analyseIdentifier(value).dynamic;
const build = (graph: any) => candidateSelectorsFor(graph, isGenerated);
const expressions = (list: SelectorCandidate[]) => list.map(entry => entry.expression);
const strategies = (list: SelectorCandidate[]) => list.map(entry => entry.strategy);

/* --------------------------------------------------------------------- graphs
 * Every one is a REAL captured shape, copied from the sidecar it came from - not an
 * invented DOM. The point of the experiment was that these are what the recorder
 * actually holds, missing fields included.
 */

/** FixtureShop TC_SMOKE_004: an anchor with a text and literally nothing else. */
const MOBILES = {
  target: { tag: 'a', text: 'Mobiles' },
  parent: { tag: 'div', text: 'Mobiles' },
  ancestors: [],
  descendants: [{ tag: 'div', text: 'Mobiles', relationship: 'descendant', depth: 1 }],
};

/** FixturePortal's sign-in email field: id, name, type and placeholder, no accessible name. */
const EMAIL = {
  target: {
    tag: 'input', id: 'email_field', name: 'email', type: 'email',
    placeholder: 'Enter your email',
  },
  parent: { tag: 'div', stableClasses: ['login-input-group'] },
  ancestors: [
    { tag: 'form', id: 'loginForm', stableClasses: ['log-in-form'], relationship: 'ancestor', depth: 1 },
    { tag: 'div', id: 'login_area', stableClasses: ['row'], relationship: 'ancestor', depth: 3 },
  ],
  descendants: [],
};

/** The sign-in button: a name from its own content, and four authored classes. */
const SIGN_IN = {
  target: {
    tag: 'button', name: 'login', type: 'button', text: 'Sign In',
    stableClasses: ['login-submit', 'mdl-button', 'mdl-js-button', 'mdl-js-ripple-effect'],
  },
  parent: { tag: 'div', stableClasses: ['submit-btn-container', 'row'], text: 'Sign In' },
  ancestors: [
    { tag: 'form', id: 'loginForm', stableClasses: ['log-in-form'], relationship: 'ancestor', depth: 1 },
    { tag: 'div', id: 'login_area', stableClasses: ['row'], relationship: 'ancestor', depth: 3 },
  ],
  descendants: [],
};

/** FixtureShop's footer link: an aria-label, which is the only accessible name captured. */
const SELLER = {
  target: { tag: 'a', text: 'Become a Seller', aria: { 'aria-label': 'Become a Seller' } },
  parent: { tag: 'div', stableClasses: ['N5kmDa'] },
  ancestors: [
    { tag: 'div', id: 'slot-list-container', relationship: 'ancestor', depth: 4 },
  ],
  descendants: [],
};

/* ============================================================ A - the scorer */

function checkGeneratedClassFix(): void {
  section('A - GENERATED_CLASS no longer calls an authored class a bundler class');

  // A hyphen and a six-letter tail is a WORD, not a hash. All four of these are names
  // somebody typed, and all four were taking a -25 penalty.
  for (const selector of ['.login-submit', '.js-password-input', '.error-container', '.mdl-button']) {
    const scored = scoreExpression(`page.locator(${JSON.stringify(selector)})`);
    check(`A: ${selector} scores as ordinary CSS`, scored?.weakest === 65,
        `${scored?.weakest} (base css is 65)`);
  }
  // What the rule is actually for. A hash carries a digit; a word does not.
  for (const selector of ['.css-1x2y3z', '.header-a1b2c3d4']) {
    const scored = scoreExpression(`page.locator(${JSON.stringify(selector)})`);
    check(`A: ${selector} is still penalised as generated`, scored?.weakest === 40,
        String(scored?.weakest));
  }
  // The rest of the scoring model is untouched - these are the numbers the BASE table
  // has always carried.
  const cases: Array<[string, number]> = [
    ["page.getByRole('button', { name: 'Sign In', exact: true })", 95],
    ['page.getByLabel("Become a Seller")', 90],
    ['page.getByPlaceholder("Enter your email")', 85],
    ['page.locator("#email_field")', 70],
    ['page.getByText("Sign In", { exact: true })', 75],
  ];
  for (const [expression, expected] of cases) {
    check(`A: ${expression.slice(0, 46)} scores ${expected}`,
        scoreExpression(expression)?.weakest === expected,
        String(scoreExpression(expression)?.weakest));
  }
  check('A: an unscoreable expression is null, never a zero',
      scoreExpression('notAnExpression') === null);
  check('A: scoreChain and scoreExpression agree on the weakest segment',
      Math.min(...scoreChain(parseChain('page.locator("#loginForm").getByRole("button", { name: "Sign In" })'))
          .candidates.map(c => c.score))
      === scoreExpression('page.locator("#loginForm").getByRole("button", { name: "Sign In" })')?.weakest);
}

/* ================================================ B - semantic generation */

function checkSemanticGeneration(): void {
  section('B - semantic candidates, from what the capture actually holds');

  // THE CASE THE EXPERIMENT WAS RUN FOR. Zero candidates before; the locator Codegen
  // itself chose is now generated independently, from the tag and the text.
  const mobiles = build(MOBILES);
  check('B: Mobiles now generates a candidate at all', mobiles.length > 0, String(mobiles.length));
  check('B: and it is getByRole(link, name) â€” derived, not read off Codegen',
      expressions(mobiles).includes('page.getByRole("link", { name: "Mobiles", exact: true })'),
      expressions(mobiles).join(' | '));
  // P10 CHANGED THIS CONTRACT, and the change is the point rather than a relaxation.
  // Until then every generated role+name candidate carried `exact: true`, because that
  // is what settles an ambiguous name. It still does, and it is still generated - but a
  // non-exact TWIN is generated after it, because the two fail in opposite directions
  // and a name a validation message extends takes the exact form to zero matches. The
  // rule that replaces "always exact" is: never a loose form without its exact form, and
  // never before it. `exact-nonexact.fixture.ts` holds the rest.
  const roleNames = expressions(mobiles).filter(e => e.startsWith('page.getByRole'));
  const exactForms = roleNames.filter(e => e.includes('exact: true'));
  const looseForms = roleNames.filter(e => !e.includes('exact: true'));
  check('B: the exact form is generated, and it is what settles an ambiguous name',
      exactForms.length === 1, roleNames.join(' | '));
  check('B: a loose twin follows it - never instead of it, never before it',
      looseForms.length === 1
        && looseForms[0] === exactForms[0].replace(', exact: true', '')
        && expressions(mobiles).indexOf(looseForms[0]) > expressions(mobiles).indexOf(exactForms[0]),
      roleNames.join(' | '));

  // An aria-label is an accessible name AND a label AND an attribute - three different
  // locators, all of them justified by one captured field.
  const seller = build(SELLER);
  check('B: an aria-label yields role+name', expressions(seller).some(e => e.includes('getByRole("link", { name: "Become a Seller"')));
  check('B: and getByLabel', expressions(seller).includes('page.getByLabel("Become a Seller")'));
  check('B: and an attribute selector',
      expressions(seller).includes('page.locator("[aria-label=\\"Become a Seller\\"]")'));

  // A placeholder is a locator; a placeholder is NOT an accessible name.
  const email = build(EMAIL);
  check('B: a placeholder yields getByPlaceholder',
      expressions(email).includes('page.getByPlaceholder("Enter your email")'));
  check('B: an input gets NO named role â€” its name lives in a <label> nothing captures',
      !expressions(email).some(e => /getByRole\("textbox", \{ name/.test(e)),
      expressions(email).filter(e => e.includes('getByRole')).join(' | '));
  check('B: it gets the unnamed role instead, which scores 30 and proves nothing on its own',
      expressions(email).includes('page.getByRole("textbox")'));

  // A button's name DOES come from its own content, so the same evidence yields a named
  // role here and not above. That asymmetry is the ARIA rule, not a heuristic.
  const signIn = build(SIGN_IN);
  check('B: a button takes its name from its own text',
      expressions(signIn).includes('page.getByRole("button", { name: "Sign In", exact: true })'));

  section('B - and refuses, loudly, where the evidence is missing');
  const every = [...build(MOBILES), ...build(EMAIL), ...build(SIGN_IN), ...build(SELLER)];
  check('B: no getByAltText anywhere â€” alt is read into attributes and dropped',
      !expressions(every).some(e => e.includes('getByAltText')));
  check('B: no href candidate anywhere â€” href is never captured',
      !expressions(every).some(e => /href/i.test(e)));
  check('B: getByLabel only ever comes from an aria-label',
      expressions(every).filter(e => e.includes('getByLabel'))
          .every(e => e.includes('Become a Seller')));
  check('B: a <div> gets no role candidate â€” nothing maps it',
      implicitRole({ tag: 'div' }) === null
      && !expressions(build({ target: { tag: 'div', text: 'x' }, ancestors: [], descendants: [] }))
          .some(e => e.includes('getByRole')));
  check('B: type is never a candidate on its own',
      !expressions(every).some(e => /^page\.locator\("\[type=/.test(e)));
  // A page-wide getByText scores 75 - ABOVE an authored id at 70 - so generating one
  // would let ranking prefer it over `#create_team_cancel_btn` on the strength of text
  // that happened to be unique when it was recorded. The content family already refuses
  // page-wide text; the semantic family refuses it for the same reason.
  check('B: no page-wide getByText is ever generated â€” only the scoped form',
      expressions(every).filter(e => e.includes('getByText'))
          .every(e => e.startsWith('page.locator("#')),
      expressions(every).filter(e => e.includes('getByText')).join(' | ') || 'none generated');

  section('B - scoped combinations: the thing that settles a real ambiguity');
  // Three sign-in forms are mounted at once on FixturePortal, so the bare placeholder matches
  // three elements and the scoped one matches the field on the form.
  check('B: a scoped placeholder is generated beside the bare one',
      expressions(email).includes('page.locator("#loginForm").getByPlaceholder("Enter your email")'));
  check('B: a scoped attribute combination too',
      expressions(email).includes('page.locator("#loginForm input[name=\\"email\\"]")'));
  check('B: a scope is only ever an ancestor with an AUTHORED id',
      expressions(email).filter(e => e.startsWith('page.locator("#'))
          .every(e => e.includes('#loginForm') || e.includes('#login_area') || e.includes('#email_field')),
      expressions(email).filter(e => e.startsWith('page.locator("#')).join(' | '));
  check('B: Mobiles gets no scoped candidate â€” it captured no ancestor to scope to',
      !expressions(mobiles).some(e => e.startsWith('page.locator("#')));

  section('B - every generated expression is one buildLocator can rebuild');
  const GRAMMAR =
    /^page\.(locator\("|getByRole\(|getByLabel\(|getByPlaceholder\(|getByTestId\(|getByText\(|getByTitle\(|getByAltText\()/;
  check('B: the grammar holds for every candidate of every family',
      expressions(every).every(e => GRAMMAR.test(e)),
      expressions(every).find(e => !GRAMMAR.test(e)) ?? 'all conform');
  for (const [name, pattern] of [['first()', /\.first\(/], ['nth(', /\.nth\(/],
    ['xpath', /xpath=|\/html/], ['positional pseudo', /:nth-child|:nth-of-type/]] as Array<[string, RegExp]>) {
    check(`B: no ${name} is ever generated`, !expressions(every).some(e => pattern.test(e)));
  }
}

/* ==================================================== C - the family budget */

function checkFamilyBudget(): void {
  section('C - the family budget');

  check('C: every strategy has a family', [
    'test-id', 'stable-id', 'container-text', 'scoped-class-text', 'scoped-class',
    'role-name', 'label', 'placeholder', 'scoped-placeholder', 'attribute', 'attribute-pair',
  ].every(strategy => Boolean(familyOf(strategy))));
  check('C: the four pre-existing families are apart from the three new ones',
      familyOf('stable-id') === 'identifier' && familyOf('container-text') === 'container'
      && familyOf('scoped-class-text') === 'content' && familyOf('scoped-class') === 'structural'
      && familyOf('role-name') === 'semantic' && familyOf('scoped-placeholder') === 'semantic-scoped'
      && familyOf('attribute') === 'attribute');

  // THE PROTECTION THAT MATTERS. The structural half of the output is byte-for-byte what
  // it was, so nothing proven today can be displaced by anything added here.
  for (const [name, graph] of [['Email', EMAIL], ['Sign In', SIGN_IN], ['Become a Seller', SELLER]] as const) {
    const built = build(graph);
    const structural = built.filter(entry => entry.measuredBy !== 'expression');
    check(`C: ${name} â€” the structural budget is untouched (<= ${MAX_CANDIDATES})`,
        structural.length <= MAX_CANDIDATES, String(structural.length));
    check(`C: ${name} â€” every structural candidate comes first, in its original order`,
        built.slice(0, structural.length).every(entry => entry.measuredBy !== 'expression'));
    check(`C: ${name} â€” the total respects the ceiling of ${MAX_TOTAL_CANDIDATES}`,
        built.length <= MAX_TOTAL_CANDIDATES, String(built.length));
  }

  // A prolific family cannot win. Twenty semantic candidates offered, five kept.
  const many: SelectorCandidate[] = Array.from({ length: 20 }, (_, index) => ({
    strategy: 'role-name', selector: '', expression: `page.getByRole("link", { name: "n${index}" })`,
    family: 'semantic' as const, measuredBy: 'expression' as const,
  }));
  const budgeted = applyFamilyBudget(many);
  check('C: a family is held to its own budget',
      budgeted.length === FAMILY_BUDGET.semantic, `${budgeted.length} of ${FAMILY_BUDGET.semantic}`);
  check('C: and it keeps the FIRST ones, so generation order decides',
      budgeted[0].expression.includes('n0') && budgeted[budgeted.length - 1].expression.includes('n4'));

  const mixed = [
    ...many,
    ...Array.from({ length: 20 }, (_, index) => ({
      strategy: 'attribute', selector: `[data-x="${index}"]`,
      expression: `page.locator("[data-x=\\"${index}\\"]")`,
      family: 'attribute' as const, measuredBy: 'expression' as const,
    })),
  ];
  const mixedBudget = applyFamilyBudget(mixed);
  check('C: a starved family still gets its budget when another generates twenty',
      mixedBudget.filter(entry => entry.family === 'attribute').length === FAMILY_BUDGET.attribute,
      String(mixedBudget.filter(entry => entry.family === 'attribute').length));
  check('C: an unbudgeted family is dropped rather than admitted by default',
      applyFamilyBudget([{
        strategy: 'scoped-class', selector: '.x', expression: 'page.locator(".x")',
        family: 'structural', measuredBy: 'expression',
      }]).length === 0);
  check('C: the budget is deterministic â€” the same input twice gives the same output',
      JSON.stringify(applyFamilyBudget(mixed)) === JSON.stringify(applyFamilyBudget(mixed)));
  check('C: and it consults no measurement â€” the signature takes candidates only',
      applyFamilyBudget.length === 1);
}

/* =========================================================== D - the ranking */

/** A proven press-time measurement, which is the only kind ranking ever sees. */
const proven = (expression: string, strategy = 'x'): CandidateMeasurement => ({
  strategy, expression, matchCount: 1, identityMatched: true,
  sameDocument: true, measuredAt: 'press',
});

function evidenceOf(candidates: CandidateMeasurement[]): TargetEvidence {
  return {
    locator: 'page.locator("#x")', target: { tag: 'button' }, ancestors: [], children: [],
    descendants: [], previousSiblings: [], nextSiblings: [], relationships: [], matchCount: 1,
    derivedCandidates: candidates,
  } as unknown as TargetEvidence;
}

function checkRanking(): void {
  section('D - ranking, not first-past-the-post');

  // THE MEASURED CASE, in the order the generator emits it: the structural shape comes
  // first and `.find()` took it.
  const signIn = evidenceOf([
    proven('page.locator("#loginForm .login-submit").filter({ hasText: "Sign In" })', 'scoped-class-text'),
    proven('page.locator("#loginForm .login-submit")', 'scoped-class'),
    proven('page.getByRole(\'button\', { name: \'Sign In\', exact: true })', 'recorded-locator'),
    proven('page.getByText("Sign In", { exact: true })', 'text'),
  ]);
  check('D: the best-scoring proven candidate is chosen, not the first',
      provenCandidate(signIn)?.expression === "page.getByRole('button', { name: 'Sign In', exact: true })",
      String(provenCandidate(signIn)?.expression));
  check('D: the whole ranking is returned, best first',
      rankProvenCandidates(signIn).map(c => c.expression)[1] === 'page.getByText("Sign In", { exact: true })',
      rankProvenCandidates(signIn).map(c => c.expression).join(' | '));
  check('D: and the previously chosen candidate is still IN the list, just not first',
      rankProvenCandidates(signIn).some(c => c.expression.includes('.login-submit')));

  // THE FILTER IS UNCHANGED. Everything `provesIdentity` refused is still refused; the
  // ordering never sees it.
  const unproven = evidenceOf([
    { ...proven('page.locator("#a")'), identityMatched: false },
    { ...proven('page.locator("#b")'), matchCount: 3 },
    { ...proven('page.locator("#c")'), sameDocument: false },
    { ...proven('page.locator("#d")'), measuredAt: 'claim' as const },
    { ...proven('page.locator("#e")'), identityMatched: undefined },
  ]);
  check('D: an unproven candidate is never ranked, however well it scores',
      rankProvenCandidates(unproven).length === 0,
      rankProvenCandidates(unproven).map(c => c.expression).join(','));
  check('D: with nothing proven the answer is null, exactly as before',
      provenCandidate(unproven) === null);
  check('D: a pick-time candidate is still refused for an ACTION',
      rankProvenCandidates(evidenceOf([{ ...proven('page.locator("#p")'), measuredAt: 'pick' as const }]),
          'action').length === 0);
  check('D: and admitted for an ASSERTION, which is the existing role rule',
      rankProvenCandidates(evidenceOf([{ ...proven('page.locator("#p")'), measuredAt: 'pick' as const }]),
          'assertion').length === 1);

  // THE TIE THE CORPUS CAUGHT. Both weakest 70; the chain's strongest segment is 85.
  // Ranking on the strongest segment put the chain first and cost TC_LOGIN_126 and
  // TC_LOGIN_127 the Page Object reuse they had, because knowledge declares the id.
  const cancel = evidenceOf([
    proven('page.locator("#create_team_cancel_btn")', 'stable-id'),
    proven('page.locator("#create_team_invite_form").getByText("Cancel")', 'scoped-text'),
  ]);
  check('D: on a tie the SIMPLER chain wins, not the one with a strong segment',
      provenCandidate(cancel)?.expression === 'page.locator("#create_team_cancel_btn")',
      String(provenCandidate(cancel)?.expression));
  check('D: and the order does not depend on which was generated first',
      provenCandidate(evidenceOf([
        proven('page.locator("#create_team_invite_form").getByText("Cancel")', 'scoped-text'),
        proven('page.locator("#create_team_cancel_btn")', 'stable-id'),
      ]))?.expression === 'page.locator("#create_team_cancel_btn")');

  // Determinism. Two equally-scored candidates must not depend on sort stability alone.
  const tied = evidenceOf([
    proven('page.locator("#bbbbbbbbbb")'),
    proven('page.locator("#a")'),
  ]);
  check('D: a tie breaks on the shorter expression, deterministically',
      provenCandidate(tied)?.expression === 'page.locator("#a")',
      String(provenCandidate(tied)?.expression));
  check('D: ranking twice gives the same order',
      JSON.stringify(rankProvenCandidates(signIn)) === JSON.stringify(rankProvenCandidates(signIn)));
  check('D: a candidate the scorer cannot parse sorts last but is not dropped',
      rankProvenCandidates(evidenceOf([proven('page.wat("#x")'), proven('page.locator("#y")')]))
          .map(c => c.expression).join(',') === 'page.locator("#y"),page.wat("#x")');

  // The scoring fix and the ranking together: a genuinely generated class must still
  // lose to a semantic locator, and an authored one must not be pushed down for nothing.
  const authored = evidenceOf([
    proven('page.locator(".login-submit")'),
    proven('page.locator(".header-a1b2c3d4")'),
  ]);
  check('D: an authored hyphenated class outranks a hashed one',
      provenCandidate(authored)?.expression === 'page.locator(".login-submit")',
      String(provenCandidate(authored)?.expression));
}

/* ============================================================= E - the wiring
 * The parts that need a live page are pinned as source facts, which is the same thing
 * `locator-validation.fixture.ts` does for the gate's call sites.
 */

function checkWiring(): void {
  section('E - the wiring the recorder performs');

  const recorder = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'live-recorder.ts'), 'utf8');

  check('E: the recorded locator is measured as a candidate of its own',
      /strategy: 'recorded-locator'/.test(recorder));
  check('E: through the SAME identity machinery the generated candidates use',
      /measureExpressionCandidates\(page, claimed, \[\{/.test(recorder));
  check('E: and only while the document is still the press\'s',
      /const recorded = sameDocument\s*\n\s*\?\s*await measureExpressionCandidates/.test(recorder));
  check('E: identity comes from the parked node, never from asking Codegen again',
      /window\.__auraTargets/.test(recorder) && /READ_PARKED_TARGET/.test(recorder));
  check('E: the parked node is refused outright when the document has changed',
      /window\.__auraDocument !== payload\.documentId\) return null/.test(recorder));
  check('E: a candidate with no parked node to compare against is not measured at all',
      /if \(!target\)\s*\n\s*return \[\];/.test(recorder));

  check('E: expression candidates are measured at the press',
      /measureExpressionCandidates\(frame, entry, expressions\)/.test(recorder));
  check('E: and at an assertion pick, stamped as a pick',
      /'pick',\r?\n\s*\);/.test(recorder)
      && /'pick',\r?\n\s*\);/.test(recorder.replace(/\r?\n/g, '\r\n')));
  check('E: but refused at claim time, where identity cannot be asked',
      /if \(candidate\.measuredBy === 'expression'\)\s*\n\s*continue;/.test(recorder));

  // The correctness gate is untouched: no call site relaxes it, and the recorder still
  // routes every measurement through splitCandidates.
  check('E: isProvenAgainstClickedTarget is unchanged',
      /matchCount === 1\s*\n\s*&& candidate\.identityMatched === true\s*\n\s*&& candidate\.sameDocument === true\s*\n\s*&& candidate\.measuredAt === 'press'/
          .test(fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'dom-evidence.ts'), 'utf8')));
  check('E: every measurement still passes through splitCandidates',
      /splitCandidates\(\s*\n?\s*\[\.\.\.withRecorded/.test(recorder));

  // Ranking changed WHICH proven expression comes back first, and three reuse resolvers
  // key off it. The resolver walks the whole ranked list rather than the top of it, so a
  // method declared for any proven expression is still found.
  const generator = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'from-recording.ts'), 'utf8');
  const reuse = reuseInputs();
  const resolve = (evidence = reuse.evidence, knowledge = reuse.knowledge, role: 'action' | 'assertion' = 'action') =>
    findMethodByProvenLocator(evidence, knowledge, reuse.index, role);
  check('E: Page Object reuse considers every proven candidate, not just the best',
      rankProvenCandidates(reuse.evidence, 'action')[0]?.expression !== reuse.expression && resolve()?.method === 'control');
  for (const invalid of [{ identityMatched: false }, { identityMatched: undefined }, { sameDocument: false }, { matchCount: 2 }, { measuredAt: 'pick' as const }]) {
    const evidence = structuredClone(reuse.evidence);
    Object.assign(evidence.derivedCandidates![1], invalid);
    check(`E: each candidate needs action identity ${JSON.stringify(invalid)}`, resolve(evidence) === null);
  }
  const pick = structuredClone(reuse.evidence); pick.derivedCandidates![1].measuredAt = 'pick';
  check('E: assertion pick identity remains usable', resolve(pick, reuse.knowledge, 'assertion')?.method === 'control');
  const ambiguous = structuredClone(reuse.knowledge);
  ambiguous[0].elements.push({ ...ambiguous[0].elements[0], id: 'other', page_object_method: 'other' });
  check('E: two claimants for one expression are still refused', resolve(reuse.evidence, ambiguous) === null);

  // Snapshot capture moved in P5.1 and the qualification rule itself did not: the same
  // container/role/id test still decides which ancestors are KEPT, and exactly one
  // ancestor that fails it is appended afterwards. `target-snapshot.fixture.ts` pins
  // the behaviour; this pins that the rule is still the rule.
  const capture = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'dom-capture-source.ts'), 'utf8');
  check('E: the ancestor qualification rule is unchanged',
      /CONTAINERS\.indexOf\(current\.tagName\.toLowerCase\(\)\) >= 0\s*\n?\s*\|\| current\.getAttribute\('role'\) \|\| current\.id/
          .test(capture));
  check('E: and the in-page measurement is unchanged â€” it never sees a semantic candidate',
      /document\.querySelectorAll\(candidate\.selector\)/.test(capture));
}

/* ------------------------------------------------------------------- main */

function main(): void {
  checkGeneratedClassFix();
  checkSemanticGeneration();
  checkFamilyBudget();
  checkRanking();
  checkWiring();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
