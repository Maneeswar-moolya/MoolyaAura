import '../testing/isolated-checkout';
/**
 * THE LOCATOR STRATEGY CONTRACT (P12A).
 *
 *   npx tsx ai/autocode/strategy-contract.fixture.ts
 *
 * Offline: no browser, no model, no network, and it writes nothing anywhere. It runs the
 * REAL generators over synthetic graphs, collects the strategies they actually emit, and
 * holds every one of them to the declaration in `STRATEGY_CONTRACT`.
 *
 * THE INVARIANT
 *
 *   Every locator strategy the framework emits has a complete contract: a family, an
 *   applicable budget, a recognised measurement path, a score, and - where it is a
 *   Playwright expression - a faithful rebuild.
 *
 * WHY IT EXISTS. A strategy was a bare string spelled at four unrelated places, and every
 * disagreement between them failed SILENTLY in the same direction - the new strategy
 * quietly vanishing:
 *
 *   - an unmapped family resolves to `structural`, which has no `FAMILY_BUDGET` entry, so
 *     `applyFamilyBudget` admits NONE of it (measured: 0 retained);
 *   - an expression the scorer cannot parse scores `null` and ranks LAST;
 *   - an expression `buildLocator` cannot rebuild is measured `matchCount: null` and can
 *     therefore never be proven, so it can never be selected.
 *
 * None of those produces an error, a warning or a missing-candidate report. A generation
 * run looks exactly the same as one where the strategy is working.
 *
 * WHAT THIS FIXTURE IS NOT. It changes no ranking, no score, no budget and no candidate.
 * It asserts that the pipeline UNDERSTANDS what the generators produce - and it fails,
 * naming the strategy, when a future emission site forgets its declaration.
 */

import {
  applyFamilyBudget, candidateSelectorsFor, familyOf, semanticCandidatesFor,
  strategyContract, FAMILY_BUDGET, MAX_CANDIDATES, STRATEGY_CONTRACT,
  type CandidateFamily, type SelectorCandidate,
} from './dom-evidence';
import { analyseIdentifier, scoreExpression } from './locator-quality';
import { buildLocator } from '../dashboard/live-recorder';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const isGenerated = (value: string) => analyseIdentifier(value).dynamic;

/**
 * Strategies the contract declares that no generator emits.
 *
 * `familyOf` has answered for these names since before the contract existed and the
 * answers are kept, so nothing that asks about one gets a different family today. The
 * list lives HERE rather than in production because it is a statement about the tests'
 * coverage, not about the pipeline - and because a genuinely dead entry added later
 * cannot hide among them: it fails until somebody either emits it or writes it down.
 */
const NOT_YET_EMITTED = new Set([
  'text', 'scoped-test-id-api', 'scoped-title', 'scoped-alt-text',
  // Codegen's own line, built in `live-recorder.ts` rather than by a generator here.
  'recorded-locator',
]);

/* ------------------------------------------------------------------- graphs
 *
 * Between them these have to trigger every generated strategy. Coverage is ASSERTED
 * below rather than assumed - a contract entry no graph reaches is reported by name.
 */

const GRAPHS: Array<{ label: string; graph: any }> = [
  {
    label: 'a named form control inside two authored ids',
    graph: {
      target: {
        tag: 'input', id: 'email_field', name: 'email', type: 'email', role: 'textbox',
        placeholder: 'Enter your email', title: 'Email', accessibleName: 'Email',
        accessibleNameVerified: true, aria: { 'aria-label': 'Email' },
        data: { 'data-testid': 'email-input' },
        classes: ['form-control', 'js-email'], stableClasses: ['form-control', 'js-email'],
      },
      parent: { tag: 'div', classes: ['login-input-group', 'field'], stableClasses: ['login-input-group', 'field'] },
      ancestors: [
        { tag: 'form', id: 'loginForm', stableClasses: ['login-form'] },
        { tag: 'div', id: 'login_container', stableClasses: ['container'] },
      ],
      descendants: [],
    },
  },
  {
    label: 'a button that names itself by its own text',
    graph: {
      target: {
        tag: 'button', name: 'login', type: 'submit', role: 'button', text: 'Sign In',
        accessibleName: 'Sign In', accessibleNameVerified: true,
        classes: ['login-submit'], stableClasses: ['login-submit'],
      },
      parent: { tag: 'div', classes: ['actions'], stableClasses: ['actions'] },
      ancestors: [{ tag: 'form', id: 'loginForm', stableClasses: ['login-form'] }],
      descendants: [],
    },
  },
  {
    label: 'an unnamed control with no classes of its own',
    graph: {
      target: { tag: 'input', type: 'checkbox', role: 'checkbox' },
      parent: { tag: 'div', classes: ['rounded-checkbox-cont', 'cell'], stableClasses: ['rounded-checkbox-cont', 'cell'] },
      ancestors: [{ tag: 'div', id: 'bugReport_table', stableClasses: ['tabulator'] }],
      descendants: [],
    },
  },
  {
    label: 'an element inside a repeating container that names itself by its text',
    graph: {
      target: {
        tag: 'span', text: 'Copy of login is not working', role: 'generic',
        classes: ['bug-report__summary--text', 'hidden-xs'],
        stableClasses: ['bug-report__summary--text', 'hidden-xs'],
      },
      parent: { tag: 'div', classes: ['tabulator-cell'], stableClasses: ['tabulator-cell'] },
      ancestors: [
        { tag: 'div', stableClasses: ['tabulator-row'], text: 'Copy of login is not working  open  P1' },
        { tag: 'div', id: 'bugReport_table', stableClasses: ['tabulator-table'] },
      ],
      descendants: [],
    },
  },
  {
    label: 'an image and a link, for alt and href-shaped evidence',
    graph: {
      target: {
        tag: 'img', alt: 'Mobiles', role: 'img', title: 'Mobiles',
        classes: ['banner-image'], stableClasses: ['banner-image'],
      },
      parent: { tag: 'a', classes: ['nav-link'], stableClasses: ['nav-link'] },
      ancestors: [{ tag: 'nav', id: 'main_nav', stableClasses: ['nav'] }],
      descendants: [],
    },
  },
  {
    label: 'a parent-classed text element with no classes of its own',
    graph: {
      target: { tag: 'span', text: 'All Projects' },
      parent: { tag: 'h2', classes: ['section-heading', 'title'], stableClasses: ['section-heading', 'title'] },
      ancestors: [{ tag: 'div', id: 'apps_tab_container', stableClasses: ['tabs'] }],
      descendants: [],
    },
  },
];

interface Observed {
  strategy: string;
  families: Set<CandidateFamily>;
  measuredBy: Set<string>;
  expressions: string[];
  selectors: string[];
}

function observe(): Map<string, Observed> {
  const seen = new Map<string, Observed>();
  const note = (candidate: SelectorCandidate) => {
    const entry = seen.get(candidate.strategy) ?? {
      strategy: candidate.strategy, families: new Set<CandidateFamily>(),
      measuredBy: new Set<string>(), expressions: [], selectors: [],
    };
    if (candidate.family)
      entry.families.add(candidate.family);
    entry.measuredBy.add(String(candidate.measuredBy));
    if (candidate.expression && entry.expressions.length < 3)
      entry.expressions.push(candidate.expression);
    entry.selectors.push(candidate.selector ?? '');
    seen.set(candidate.strategy, entry);
  };
  for (const { graph } of GRAPHS) {
    // BOTH generators, and the RAW semantic list as well as the budgeted one: a strategy
    // the budget happens to drop for these graphs is still a strategy that was emitted.
    for (const candidate of candidateSelectorsFor(graph, isGenerated))
      note(candidate);
    const stable = (graph.ancestors ?? []).filter((node: any) => node.id && !isGenerated(node.id)).slice(0, 3);
    for (const candidate of semanticCandidatesFor(graph, isGenerated, stable))
      note(candidate);
  }
  return seen;
}

/* --------------------------------------------------- A. every emitted strategy */

function checkEmitted(observed: Map<string, Observed>): void {
  section('A. every strategy the generators emit is declared');

  const undeclared = [...observed.keys()].filter(strategy => !strategyContract(strategy)).sort();
  check('A1: no emitted strategy is missing from STRATEGY_CONTRACT',
      undeclared.length === 0,
      undeclared.length ? `undeclared: ${undeclared.join(', ')}` : `${observed.size} strategies emitted`);

  const missed = Object.keys(STRATEGY_CONTRACT)
      .filter(strategy => !observed.has(strategy) && !NOT_YET_EMITTED.has(strategy)).sort();
  check('A2: every declared strategy is actually emitted, or written down as not yet emitted',
      missed.length === 0,
      missed.length ? `declared but never emitted: ${missed.join(', ')}` : 'no dead entries');

  const stale = [...NOT_YET_EMITTED].filter(strategy => observed.has(strategy)).sort();
  check('A3: the not-yet-emitted list holds nothing that is now emitted',
      stale.length === 0, stale.join(', '));
}

/* ------------------------------------------- B-E. the four properties, per strategy */

function checkProperties(observed: Map<string, Observed>): void {
  section('B-E. family, budget, measurement, score and rebuild - for each emitted strategy');

  const stub: any = new Proxy({}, { get: () => (..._args: any[]) => stub });
  const problems: string[] = [];
  const record = (strategy: string, what: string) => problems.push(`${strategy}: ${what}`);

  for (const [strategy, entry] of [...observed].sort()) {
    const contract = strategyContract(strategy);
    if (!contract)
      continue; // A1 already named it.

    // B. THE FAMILY IS THE ONE THE CANDIDATE CARRIES, not merely a declared one.
    if (![...entry.families].every(family => family === contract.family))
      record(strategy, `emitted family ${[...entry.families].join('|')} but declares ${contract.family}`);
    if (familyOf(strategy) !== contract.family)
      record(strategy, `familyOf says ${familyOf(strategy)}, contract says ${contract.family}`);

    // C. THE BUDGET APPLIES. This is the silent drop: `family-budget` with no positive
    //    FAMILY_BUDGET entry means every candidate of that strategy is discarded.
    if (contract.budget === 'family-budget' && !((FAMILY_BUDGET[contract.family] ?? 0) > 0))
      record(strategy, `competes for a family budget and ${contract.family} has none`);
    // An expression candidate is REBUILT to be counted, so a strategy that declares the
    // expression path and cannot be rebuilt is a strategy whose every measurement comes
    // back `matchCount: null` - never proven, never selected, and never an error.
    if (contract.measuredBy === 'expression' && !contract.rebuildable)
      record(strategy, 'is measured by expression and declares itself unrebuildable');
    if (contract.budget === 'structural-cap' && contract.measuredBy !== 'page') {
      record(strategy, 'is capped by MAX_CANDIDATES but is not measured in the page - '
        + 'only the in-page half is sliced by that cap');
    }

    // D. THE MEASUREMENT PATH IS RECOGNISED, and the candidate carries what that path
    //    needs: the in-page measurer reads `selector`, the Node side reads `expression`.
    if (![...entry.measuredBy].every(path => path === contract.measuredBy))
      record(strategy, `emitted measuredBy ${[...entry.measuredBy].join('|')} but declares ${contract.measuredBy}`);
    if (contract.measuredBy === 'page' && entry.selectors.some(selector => !selector))
      record(strategy, 'is measured in the page but emitted a candidate with no selector');
    if (contract.measuredBy === 'expression' && !entry.expressions.length)
      record(strategy, 'is measured by expression but emitted no expression');

    for (const expression of entry.expressions) {
      // E. SCOREABLE. An unscoreable expression is not rejected - it ranks LAST, which is
      //    the failure that looks like a working strategy nobody ever selects.
      const scored = scoreExpression(expression);
      if (contract.scoreable && !scored)
        record(strategy, `declares scoreable and scoreExpression returned null for ${expression}`);
      if (!contract.scoreable && scored)
        record(strategy, 'declares unscoreable and the scorer scored it');

      // F. REBUILDABLE. `buildLocator` refusing means `matchCount: null`, which means the
      //    candidate can never be proven and therefore can never be selected.
      const rebuilt = Boolean(buildLocator(stub, expression));
      if (contract.rebuildable && !rebuilt)
        record(strategy, `declares rebuildable and buildLocator refused ${expression}`);
      if (!contract.rebuildable && rebuilt)
        record(strategy, 'declares unrebuildable and buildLocator rebuilt it');
    }
  }

  check('B-E: every emitted strategy satisfies its declaration',
      problems.length === 0, problems.slice(0, 8).join(' | '));
}

/* ------------------------------------ G. the budget actually admits each family */

function checkBudgetsAdmit(): void {
  section('G. a declared family budget really admits candidates');

  const byFamily = new Map<CandidateFamily, SelectorCandidate[]>();
  for (const { graph } of GRAPHS) {
    const stable = (graph.ancestors ?? []).filter((node: any) => node.id && !isGenerated(node.id)).slice(0, 3);
    for (const candidate of semanticCandidatesFor(graph, isGenerated, stable)) {
      const family = candidate.family ?? familyOf(candidate.strategy);
      byFamily.set(family, [...(byFamily.get(family) ?? []), candidate]);
    }
  }
  const starved: string[] = [];
  for (const [family, candidates] of byFamily) {
    // Each family on its own, so one family's budget cannot be paid for by another's.
    if (!applyFamilyBudget(candidates).length)
      starved.push(family);
  }
  check('G1: every family the semantic generator produces is admitted by the budget',
      starved.length === 0, starved.length ? `starved: ${starved.join(', ')}` : `${byFamily.size} families`);

  // The structural half is capped by a different constant, and that cap is a real number.
  check('G2: the structural cap is a positive bound', MAX_CANDIDATES > 0, String(MAX_CANDIDATES));
}

/* --------------------------------- H. the default answer is unchanged for a stranger */

function checkDefaultPreserved(): void {
  section('H. an undeclared name still gets the answer it always got');

  check('H1: an unknown strategy still falls to structural',
      strategyContract('brand-new-strategy') === null && familyOf('brand-new-strategy') === 'structural');
  check('H2: an unknown *-text strategy still falls to content',
      strategyContract('brand-new-text') === null && familyOf('brand-new-text') === 'content');
  // AND THAT DEFAULT IS EXACTLY THE HAZARD, which is why A1 exists: `structural` carries
  // no family budget, so an undeclared strategy emitted through the semantic generator
  // produces nothing at all. Asserted rather than described.
  const orphan: SelectorCandidate = {
    strategy: 'brand-new-strategy', selector: '', expression: 'page.getByRole("button")',
    family: familyOf('brand-new-strategy'), measuredBy: 'expression',
  };
  check('H3: and an undeclared strategy IS silently dropped by the budget - the reason A1 exists',
      applyFamilyBudget([orphan]).length === 0);
}

/* ------------------------------------------------------------------- main */

function main(): void {
  const observed = observe();
  process.stdout.write(`${observed.size} strategies emitted by ${GRAPHS.length} graphs; `
    + `${Object.keys(STRATEGY_CONTRACT).length} declared\n`);
  checkEmitted(observed);
  checkProperties(observed);
  checkBudgetsAdmit();
  checkDefaultPreserved();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
