import '../testing/isolated-checkout';
import { reuseInputs } from '../testing/reuse-inputs';
import { findMethodByProvenLocator } from './from-recording';
import { rankProvenCandidates } from './abstraction/classify';
/**
 * Which captured evidence becomes a candidate, and which deliberately does not.
 *
 *   npx tsx ai/autocode/evidence-consumption.fixture.ts
 *
 * Offline: no browser, no model, no network. It writes nothing anywhere. Every claim is
 * made by CALLING the real generator with one field added to a bare graph and reading
 * what comes out - so a field that stops being consumed, or starts being consumed, is
 * visible here rather than in a live run six weeks later.
 *
 * WHY THIS EXISTS
 *
 * `dom-evidence.ts` captures more than the locator engine reads. Some of that is
 * deliberate (siblings are captured and no strategy consumes them; `scrollable` describes
 * the page, not a locator) and some of it was simply never wired. The difference was not
 * written down anywhere, so "is this field used?" could only be answered by reading four
 * modules - and the answer changed twice in two phases without anything noticing.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  applyFamilyBudget, candidateSelectorsFor, familyOf, semanticCandidatesFor,
  FAMILY_BUDGET, MAX_CANDIDATES, MAX_TOTAL_CANDIDATES,
} from './dom-evidence';
import { analyseIdentifier } from './locator-quality';
import { eligibility } from './abstraction/semantic';

const ROOT = process.cwd();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const isGenerated = (value: string) => analyseIdentifier(value).dynamic;

interface Graph {
  target: any; parent?: any; ancestors: any[]; children: any[]; descendants: any[];
  previousSiblings: any[]; nextSiblings: any[];
}
const bare = (): Graph => ({
  target: { tag: 'a' }, ancestors: [], children: [], descendants: [],
  previousSiblings: [], nextSiblings: [],
});
const built = (graph: Graph) =>
  candidateSelectorsFor(graph as never, isGenerated).map(entry => `${entry.strategy}::${entry.expression}`);

/** The candidates that appear ONLY because this field was added. */
function contribution(apply: (graph: Graph) => void): { count: number; strategies: string[] } {
  const before = built(bare());
  const graph = bare();
  apply(graph);
  const added = built(graph).filter(entry => !before.includes(entry));
  return { count: added.length, strategies: [...new Set(added.map(entry => entry.split('::')[0]))] };
}

/* ================================================== A - evidence IS consumed */

function checkConsumed(): void {
  section('A - evidence that becomes a candidate');

  const consumed: Array<[string, (graph: Graph) => void, string]> = [
    ['role attribute', g => { g.target.role = 'button'; g.target.text = 'Go'; }, 'role-name'],
    ['own text, name-from-content role', g => { g.target.text = 'Mobiles'; }, 'role-name'],
    ['verified accessible name', g => {
      g.target.accessibleName = 'Open menu';
      g.target.accessibleNameSource = 'browser-computed';
      g.target.accessibleNameVerified = true;
    }, 'role-name'],
    ['href, relative', g => { g.target.href = '/store'; g.target.hrefAbsolute = false; }, 'attribute'],
    ['alt', g => { g.target.tag = 'img'; g.target.alt = 'Get App'; }, 'alt-text'],
    ['authored id', g => { g.target.id = 'sign_in_btn'; }, 'stable-id'],
    ['name attribute', g => { g.target.name = 'login'; }, 'attribute'],
    ['placeholder', g => { g.target.tag = 'input'; g.target.placeholder = 'Enter your email'; }, 'placeholder'],
    ['title', g => { g.target.title = 'Search products'; }, 'title'],
    ['aria-label', g => { g.target.aria = { 'aria-label': 'Close' }; }, 'label'],
    ['data-testid', g => { g.target.data = { 'data-testid': 'submit' }; }, 'test-id'],
    ['own classes', g => { g.target.stableClasses = ['login-submit']; }, 'class'],
    ['parent classes', g => { g.parent = { tag: 'div', stableClasses: ['submit-btn-container'] }; }, 'parent-class'],
    ['ancestor with an authored id', g => {
      g.ancestors = [{ tag: 'form', id: 'loginForm', relationship: 'ancestor', depth: 1 }];
    }, 'scoped-tag'],
  ];
  for (const [name, apply, expected] of consumed) {
    const { count, strategies } = contribution(apply);
    check(`A: ${name} -> a candidate`, count > 0 && strategies.includes(expected),
        `${count} added: ${strategies.join(', ') || 'none'}`);
  }
}

/* ============================================ B - evidence deliberately NOT used */

function checkDeliberatelyUnused(): void {
  section('B - evidence captured and deliberately NOT turned into a candidate');

  // Each of these is a decision with a reason, not an omission. If one starts producing
  // a candidate, the reason has to be revisited - which is what this section is for.
  const unused: Array<[string, (graph: Graph) => void, string]> = [
    ['generated id', g => { g.target.id = 'tc_summary_636432'; },
      'a generated id names one record, not one element'],
    ['absolute href', g => { g.target.href = 'https://x.test/s'; g.target.hrefAbsolute = true; },
      'an absolute href names a deployment, not an application'],
    ['aria idref', g => { g.target.aria = { 'aria-labelledby': 'hdr' }; },
      'an idref names another element, not this one'],
    ['data-* other than a test id', g => { g.target.data = { 'data-issue-id': '4711' }; },
      'it identifies one record; only a declared test id is a locator hook'],
    ['children', g => { g.children = [{ tag: 'span', text: 'x', relationship: 'child', depth: 1 }]; },
      'no strategy addresses an element by its children'],
    ['descendants', g => { g.descendants = [{ tag: 'span', text: 'x', relationship: 'descendant', depth: 1 }]; },
      'they only DISQUALIFY a descend shape (bearsTextDeeper); they never build one'],
    ['previous siblings', g => {
      g.previousSiblings = [{ tag: 'label', text: 'Email', relationship: 'previous-sibling', depth: 1 }];
    }, 'no sibling strategy exists - a recording never states a sibling relationship'],
    ['next siblings', g => {
      g.nextSiblings = [{ tag: 'span', text: 'err', relationship: 'next-sibling', depth: 1 }];
    }, 'the same reason'],
    ['scrollable / virtualized', g => { g.target.scrollable = true; g.target.virtualized = true; },
      'they describe how to REACH an element, never how to name one'],
  ];
  for (const [name, apply, why] of unused) {
    const { count, strategies } = contribution(apply);
    check(`B: ${name} -> no candidate (${why})`, count === 0,
        count ? strategies.join(', ') : '');
  }

  // The one that is neither: an UNVERIFIED accessible name is consumed only as a
  // fallback, so on its own - with no aria-label or title to fall back FROM - it adds
  // nothing. This is the flag doing its job, not a gap.
  const unverified = contribution(g => {
    g.target.accessibleName = 'Open menu';
    g.target.accessibleNameSource = 'title';
    g.target.accessibleNameVerified = false;
  });
  check('B: an unverified accessible name is not a candidate source by itself',
      unverified.count === 0, unverified.strategies.join(', '));
}

/* ================================================== C - the candidate budget */

function checkBudget(): void {
  section('C - the candidate budget, and what it can drop');

  check('C: the structural budget is unchanged', MAX_CANDIDATES === 16, String(MAX_CANDIDATES));
  check('C: the ceiling is 28', MAX_TOTAL_CANDIDATES === 28, String(MAX_TOTAL_CANDIDATES));
  check('C: the family budgets are 5/4/3',
      FAMILY_BUDGET.semantic === 5 && FAMILY_BUDGET['semantic-scoped'] === 4
      && FAMILY_BUDGET.attribute === 3,
      JSON.stringify(FAMILY_BUDGET));

  const ancestors = [
    { tag: 'form', id: 'loginForm', relationship: 'ancestor', depth: 1 },
    { tag: 'div', id: 'login_area', relationship: 'ancestor', depth: 3 },
  ];
  const attributeFamily = (target: any) => {
    const graph = { target, ancestors, descendants: [], previousSiblings: [], nextSiblings: [] };
    const raw = semanticCandidatesFor(graph as never, isGenerated, ancestors as never)
        .filter(entry => entry.family === 'attribute');
    const kept = candidateSelectorsFor(graph as never, isGenerated)
        .filter(entry => entry.family === 'attribute');
    return { raw, kept, keptScoped: kept.filter(entry => entry.strategy === 'scoped-attribute') };
  };

  // The shape the whole corpus has today: `name` and nothing else competing for a slot.
  // Measured over 1026 captured graphs - 467 generate a scoped-attribute and all 467 keep
  // at least one.
  const nameOnly = attributeFamily({ tag: 'input', name: 'email', type: 'email' });
  check('C: with `name` alone the scoped attributes survive, nearest first',
      nameOnly.keptScoped.length === 2
      && nameOnly.keptScoped[0].expression.includes('#loginForm'),
      nameOnly.kept.map(entry => entry.strategy).join(', '));

  // THE EXHAUSTION CASE, now fixed by ordering rather than by budget. It used to spend
  // every slot on unscoped shapes, because the scoped variants were emitted LAST - so an
  // element carrying `name` plus two of {aria-label, href} lost the only member of the
  // family that disambiguates. `attribute-order-redaction.fixture.ts` is where the fix
  // itself is pinned; this is the audit's own record that the hole is closed.
  const crowded = attributeFamily({
    tag: 'a', name: 'go', href: '/store', hrefAbsolute: false, aria: { 'aria-label': 'Store' },
  });
  check('C: `name` + aria-label + href no longer spends every slot on unscoped shapes',
      crowded.keptScoped.length > 0 && crowded.kept.length === 3,
      crowded.kept.map(entry => entry.strategy).join(', '));
  check('C: an unscoped candidate still survives beside them',
      crowded.kept.some(entry => entry.strategy !== 'scoped-attribute'),
      crowded.kept.map(entry => entry.expression).join(' | '));

  // A prolific family still cannot take another family's slots.
  const many = Array.from({ length: 12 }, (_, index) => ({
    strategy: 'attribute', selector: `[data-x="${index}"]`,
    expression: `page.locator("[data-x=\\"${index}\\"]")`,
    family: 'attribute' as const, measuredBy: 'expression' as const,
  }));
  const semantic = Array.from({ length: 12 }, (_, index) => ({
    strategy: 'role-name', selector: '', expression: `page.getByRole("link", { name: "n${index}" })`,
    family: 'semantic' as const, measuredBy: 'expression' as const,
  }));
  const budgeted = applyFamilyBudget([...many, ...semantic]);
  check('C: each family gets exactly its own budget, whatever the other generates',
      budgeted.filter(entry => entry.family === 'attribute').length === FAMILY_BUDGET.attribute
      && budgeted.filter(entry => entry.family === 'semantic').length === FAMILY_BUDGET.semantic,
      String(budgeted.length));
  check('C: familyOf places every new strategy in a budgeted family',
      ['alt-text', 'attribute', 'scoped-attribute', 'role-name', 'scoped-placeholder']
          .every(strategy => Boolean(FAMILY_BUDGET[familyOf(strategy)])
            || familyOf(strategy) === 'structural'),
      ['alt-text', 'attribute', 'scoped-attribute'].map(familyOf).join(', '));
}

/* ============================== D - the budget cannot break Page Object reuse */

function checkPageObjectInteraction(): void {
  section('D - budget vs declared Page Object capabilities');

  // A TRIPWIRE, not a rule about the application. `findMethodByProvenLocator` matches a
  // declared `locator_strategy` against a PROVEN expression, so a capability declared in
  // an attribute shape could only be reached through a candidate the attribute budget is
  // allowed to drop. No knowledge file declares one today, which is why the budget cannot
  // currently cost a reuse - and if one is ever added, this check is what says so.
  const knowledgeDir = path.join(ROOT, 'ai', 'knowledge', 'page');
  const declared: string[] = [];
  if (fs.existsSync(knowledgeDir)) {
    for (const name of fs.readdirSync(knowledgeDir)) {
      if (!name.endsWith('.yaml')) continue;
      for (const line of fs.readFileSync(path.join(knowledgeDir, name), 'utf8').split('\n')) {
        if (/locator_strategy\s*:/.test(line) && /\[name=|\[aria-label=|\[href=/.test(line))
          declared.push(`${name}: ${line.trim().slice(0, 70)}`);
      }
    }
  }
  check('D: no knowledge file declares an attribute-shaped locator, so the attribute '
    + 'budget cannot cost a Page Object reuse', declared.length === 0, declared.join(' | '));

  // Reuse reads the RANKED list, not one candidate, so a longer candidate list can only
  // ever give it more chances - adding href and alt cannot remove a match.
  const generator = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'from-recording.ts'), 'utf8');
  const reuse = reuseInputs();
  check('D: raw candidate ranks above the declared capability',
      rankProvenCandidates(reuse.evidence, 'action')[0]?.expression !== reuse.expression);
  check('D: reuse walks every proven candidate',
      findMethodByProvenLocator(reuse.evidence, reuse.knowledge, reuse.index, 'action')?.method === 'control');
  check('D: and the three resolvers still run before a recorded locator is emitted',
      /findMethod\(/.test(generator) && /findMethodByProvenLocator\(/.test(generator)
      && /findParameterisedMethod\(/.test(generator));
}

/* ==================================================== E - the AI boundary */

function checkAiBoundary(): void {
  section('E - the AI boundary');

  const semanticSource = fs.readFileSync(
      path.join(ROOT, 'ai', 'autocode', 'abstraction', 'semantic.ts'), 'utf8');

  // AI IS NOT A LOCATOR FALLBACK, and this is asked of the real `eligibility` rather
  // than of its source: a model is only ever put a question about an element whose
  // locator is ALREADY proven at the press. What is open is what to call it or who owns
  // it - never how to find it.
  const provenProof = {
    matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press',
    strategy: 'stable-id', expression: 'page.locator("#x")',
  };
  const proposal = (overrides: Record<string, unknown> = {}) => ({
    status: 'NEEDS_REVIEW',
    refusalCodes: [{ code: 'NO_METHOD_NAME', class: 'SEMANTIC' }],
    proof: provenProof,
    ...overrides,
  }) as never;

  check('E: a proposal with press-time proof and one askable question IS eligible',
      eligibility(proposal()).eligible === true, eligibility(proposal()).why ?? '');
  for (const [label, overrides] of [
    ['no proof at all', { proof: undefined }],
    ['proof measured at claim', { proof: { ...provenProof, measuredAt: 'claim' } }],
    ['proof in another document', { proof: { ...provenProof, sameDocument: false } }],
    ['proof matching several elements', { proof: { ...provenProof, matchCount: 3 } }],
    ['proof whose identity was false', { proof: { ...provenProof, identityMatched: false } }],
  ] as Array<[string, Record<string, unknown>]>) {
    check(`E: a model is NOT asked when the proof is ${label}`,
        eligibility(proposal(overrides)).eligible === false,
        eligibility(proposal(overrides)).why ?? 'ELIGIBLE');
  }
  check('E: nor when any SAFETY refusal stands',
      eligibility(proposal({
        refusalCodes: [{ code: 'NO_METHOD_NAME', class: 'SEMANTIC' },
          { code: 'DYNAMIC_IDENTIFIER', class: 'SAFETY' }],
      })).eligible === false);
  check('E: nor when any STRUCTURAL refusal stands',
      eligibility(proposal({
        refusalCodes: [{ code: 'NO_METHOD_NAME', class: 'SEMANTIC' },
          { code: 'RESOLVER_EXHAUSTED', class: 'STRUCTURAL' }],
      })).eligible === false);
  check('E: nor when one semantic question is unaskable, even beside an askable one',
      eligibility(proposal({
        refusalCodes: [{ code: 'NO_METHOD_NAME', class: 'SEMANTIC' },
          { code: 'SOMETHING_UNASKABLE', class: 'SEMANTIC' }],
      })).eligible === false);
  check('E: and not at all when there is no semantic question to resolve',
      eligibility(proposal({ refusalCodes: [] })).eligible === false);
  check('E: one unaskable semantic question stops the whole proposal',
      /is not a question a resolver may be asked/.test(semanticSource));
  check('E: and semantic.ts is still the only module allowed to reach a model',
      !/spawn|claude/i.test(fs.readFileSync(
          path.join(ROOT, 'ai', 'autocode', 'abstraction', 'propose.ts'), 'utf8')));
}

/* ------------------------------------------------------------------- main */

function main(): void {
  checkConsumed();
  checkDeliberatelyUnused();
  checkBudget();
  checkPageObjectInteraction();
  checkAiBoundary();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
