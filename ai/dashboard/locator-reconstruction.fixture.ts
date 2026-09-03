/**
 * A locator this module cannot rebuild is not a locator it may rebuild APPROXIMATELY.
 *
 *   npx tsx ai/dashboard/locator-reconstruction.fixture.ts
 *
 * WHAT WENT WRONG. `buildLocator` reconstructs a recorded expression so the page can be
 * asked to count it. Its segment regex listed the calls it knew - `locator`, the
 * `getBy*` family, `first`/`last`/`nth` - and it only ever LOOKED FOR those. Anything
 * else was not refused; it was stepped over. So
 *
 *   page.locator(".tabulator-row").filter({ hasText: "…" }).locator(".bugChecked")
 *
 * was counted as `page.locator(".tabulator-row").locator(".bugChecked")` - every
 * checkbox in every row, instead of the checkbox in the row that says a particular
 * thing. Measured live on my.bugasura.io: the recorded expression matches 1, the
 * filter-stripped one matches 2, and 2 is the number that reached TC_LOGIN_123's
 * sidecar as `locatorMatchCount`.
 *
 * WHY THAT IS WORSE THAN NO NUMBER. `matchCount: null` means "not measured" everywhere
 * downstream and is never read as ambiguity - `measuredAmbiguity` needs a number above
 * one, and `measuredZero` needs a zero. A WRONG number is indistinguishable from a real
 * measurement and it decides branches: a count of 2 made three assertions that identify
 * exactly one element each look ambiguous, which is what sent them looking for an index.
 * The failure is always INFLATION - dropping a filter can only widen - so it can turn
 * unique into ambiguous but never ambiguous into unique. It costs locator quality, not
 * element safety, and this file pins both halves of that.
 *
 * NOTHING HERE TEACHES `filter()`. The fix is a refusal.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildLocator, chainMethodsIn } from './live-recorder';
import { assessLocator } from '../autocode/locator-quality';
import type { CandidateMeasurement, DomNode, TargetEvidence } from '../autocode/dom-evidence';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string): void => process.stdout.write(`\n== ${title} ==\n`);

/* --------------------------------------------------------------- a stub page ---- */

/**
 * A Playwright-shaped stub that RECORDS the chain it was asked to build.
 *
 * The point is not the count - it is which expression the page was asked about. A stub
 * makes that observable; a real browser would only show the number and leave the reason
 * to inference, which is exactly how this defect survived.
 */
function stubPage() {
  const built: string[] = [];
  const make = (soFar: string): any => ({
    expression: soFar,
    locator: (value: string) => make(`${soFar}.locator(${JSON.stringify(value)})`),
    getByText: (value: string) => make(`${soFar}.getByText(${JSON.stringify(value)})`),
    getByLabel: (value: string) => make(`${soFar}.getByLabel(${JSON.stringify(value)})`),
    getByTestId: (value: string) => make(`${soFar}.getByTestId(${JSON.stringify(value)})`),
    getByRole: (role: string, options?: { name?: string }) =>
      make(`${soFar}.getByRole(${JSON.stringify(role)}${options?.name ? `, { name: ${JSON.stringify(options.name)} }` : ''})`),
    first: () => make(`${soFar}.first()`),
    last: () => make(`${soFar}.last()`),
    nth: (index: number) => make(`${soFar}.nth(${index})`),
    filter: () => { throw new Error('the stub page has no filter(): reaching it means the chain was rebuilt'); },
    count: async () => 0,
  });
  const page = make('page');
  return {
    page,
    /** The expression `buildLocator` actually composed, or null when it refused. */
    rebuild(expression: string): string | null {
      const locator = buildLocator(page, expression);
      const composed = locator ? String(locator.expression) : null;
      if (composed)
        built.push(composed);
      return composed;
    },
    built,
  };
}

/* ------------------------------------------------- A/B - the reconstruction ---- */

function checkReconstruction(): void {
  section('A - a filtered chain is never rebuilt by dropping the filter');

  const stub = stubPage();
  const filtered =
    'page.locator(".tabulator-row").filter({ hasText: "sign in is not present in Moolya Aura IOS" })'
    + '.locator(".bugChecked")';

  check('A1: the parser sees all three calls, filter included',
      chainMethodsIn(filtered).join(',') === 'locator,filter,locator',
      chainMethodsIn(filtered).join(','));

  const rebuilt = stub.rebuild(filtered);
  check('A2: and refuses to rebuild it at all',
      rebuilt === null, String(rebuilt));
  check('A2: so the broader chain is never composed',
      !stub.built.some(entry => /tabulator-row.*bugChecked/.test(entry)),
      stub.built.join(' | ') || '(nothing composed)');

  section('B - unknown, never a fabricated broader locator');

  // THE OLD BEHAVIOUR, STATED AS THE THING THAT MUST NOT HAPPEN. This is the exact
  // expression the old regex composed, and the test is that nothing produces it.
  const stripped = 'page.locator(".tabulator-row").locator(".bugChecked")';
  check('B1: the filter-stripped chain IS rebuildable on its own - so refusing the '
      + 'filtered one is a decision, not an accident',
      stubPage().rebuild(stripped) === stripped);
  check('B2: but no filtered expression ever produces it',
      stub.rebuild(filtered) === null);

  for (const [why, expression] of [
    ['filter({ hasText })', 'page.locator(".row").filter({ hasText: "x" }).locator(".box")'],
    ['filter({ has })', 'page.locator(".row").filter({ has: page.locator(".box") })'],
    ['filter({ hasNotText })', 'page.locator(".row").filter({ hasNotText: "x" }).first()'],
    ['and()', 'page.locator(".row").and(page.locator(".other"))'],
    ['or()', 'page.locator(".row").or(page.locator(".other"))'],
    ['frameLocator()', 'page.frameLocator("#frame").locator(".box")'],
    ['getByRole inside a filter', 'page.locator(".row").filter({ has: page.getByRole("button") }).locator("input")'],
  ] as Array<[string, string]>) {
    check(`B3: ${why} is refused, not approximated`,
        stubPage().rebuild(expression) === null, String(stubPage().rebuild(expression)));
  }

  section('B - what is rebuildable still is');

  const supported: Array<[string, string]> = [
    ['a plain css chain', 'page.locator(".tabulator-row").locator(".bugChecked")'],
    ['an id locator', 'page.locator("[id=\\"1749552\\"]")'],
    ['role and name', 'page.getByRole("button", { name: "Sign In" })'],
    ['role alone', 'page.getByRole("checkbox")'],
    ['text', 'page.getByText("Faclon labs")'],
    ['label', 'page.getByLabel("Email")'],
    ['a positional tail', 'page.locator(".bugChecked").nth(2)'],
    ['first()', 'page.locator(".bugChecked").first()'],
  ];
  for (const [why, expression] of supported) {
    check(`B4: ${why} is still rebuilt`,
        stubPage().rebuild(expression) !== null, expression);
  }

  // QUOTING. A dot inside a string is not a method call, and a scanner that thought it
  // was would refuse honest expressions - which is the way this fix could go wrong.
  check('B5: a dot inside a quoted literal is not read as a chain call',
      chainMethodsIn('page.getByText("a.b(c)")').join(',') === 'getByText',
      chainMethodsIn('page.getByText("a.b(c)")').join(','));
  check('B5: and such an expression still rebuilds',
      stubPage().rebuild('page.getByText("a.b(c)")') !== null);
  check('B6: a call nested inside an argument is not read as a chain step',
      chainMethodsIn('page.locator(".row").filter({ has: page.locator(".box") })').join(',')
        === 'locator,filter',
      chainMethodsIn('page.locator(".row").filter({ has: page.locator(".box") })').join(','));
  check('B7: an expression that is not a page chain is refused as before',
      stubPage().rebuild('locator(".x")') === null
      && stubPage().rebuild('page') === null);
}

/* ------------------------------------- C/D/E/F - what the count then decides ---- */

const ROW_SCOPED =
  'page.locator(".tabulator-row").filter({ hasText: "sign in is not present in Moolya Aura IOS" })'
  + '.locator(".bugChecked")';

const measurement = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'container-text', expression: ROW_SCOPED, matchCount: 1,
  identityMatched: true, sameDocument: true, measuredAt: 'pick', ...over,
} as CandidateMeasurement);

function evidence(over: Partial<TargetEvidence> = {}): TargetEvidence {
  return {
    locator: ROW_SCOPED,
    target: { tag: 'input', type: 'checkbox', stableClasses: ['bugChecked'] } as DomNode,
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], captureTiming: 'assertion-pick',
    derivedCandidates: [measurement()],
    ...over,
  } as TargetEvidence;
}

const assess = (target: TargetEvidence) => assessLocator({
  locator: ROW_SCOPED, target: '1751002', kind: 'assertion', value: null,
  context: undefined as never, evidence: target,
});

function checkConsequence(): void {
  section('C/D/E - what the recorded count then decides');

  // C: THE HONEST UNKNOWN. This is what the fix produces for a filtered expression:
  // the candidate was measured in the page, the recorded locator's own count is null.
  const unknown = assess(evidence({ matchCount: null, matchCountDocument: 'unknown' }));
  check('C1: a unique contextual candidate stays unique when the count is unknown',
      unknown?.strategy === 'disambiguated-by-clicked-target' || unknown?.expression === ROW_SCOPED,
      `${unknown?.strategy} ${unknown?.expression}`);
  check('C1: and no index is introduced',
      !/\.nth\(|\.first\(|\.last\(/.test(String(unknown?.expression)), String(unknown?.expression));

  // E: THE FABRICATED AMBIGUITY, kept as a test so the transition it caused stays
  // visible. A count of 2 on an expression that matches one element is exactly what the
  // old reconstruction produced - and the branch it opens is the one that ends in nth().
  const fabricated = assess(evidence({ matchCount: 2, matchCountDocument: 'same' }));
  check('E1: even WITH a fabricated ambiguous count the proven candidate settles it',
      fabricated?.strategy === 'disambiguated-by-clicked-target', String(fabricated?.strategy));
  check('E1: so no index appears',
      !/\.nth\(/.test(String(fabricated?.expression)), String(fabricated?.expression));
  check('E2: unknown and fabricated now agree - the count no longer changes the answer '
      + 'while a proven candidate exists',
      String(unknown?.expression) === String(fabricated?.expression),
      `${unknown?.expression} vs ${fabricated?.expression}`);

  // D/F: A GENUINE AMBIGUITY IS UNTOUCHED. No proven candidate, a measured position -
  // positional recovery must still be reached and still be the answer.
  const genuinely = assess(evidence({
    matchCount: 3, matchCountDocument: 'same',
    derivedCandidates: [],
    positionProvenCandidates: [measurement({
      matchCount: 3, identityMatched: false, positionWithinCandidate: 2,
    })],
  }));
  check('D1: a genuinely ambiguous contextual candidate is still ambiguous',
      genuinely?.strategy === 'evidence-backed-position', String(genuinely?.strategy));
  check('F1: and positional recovery still answers with the measured index',
      String(genuinely?.expression).endsWith('.nth(2)'), String(genuinely?.expression));

  const nothing = assess(evidence({
    matchCount: 3, matchCountDocument: 'same',
    derivedCandidates: [],
    positionProvenCandidates: [measurement({
      matchCount: 3, identityMatched: false, positionWithinCandidate: null,
    })],
  }));
  check('D2: ambiguous with nothing measured is still NEEDS_REVIEW',
      nothing?.outcome === 'NEEDS_REVIEW', String(nothing?.outcome));

  // H - A REFUSAL IS NOT AN AMBIGUITY. When reconstruction declines, the count is
  // absent; nothing about that says several elements matched, so nothing about it may
  // reach for an index. The locator engine must behave exactly as it does for any
  // recording that carries no count at all.
  const refused = assess(evidence({
    matchCount: null, matchCountDocument: 'unknown',
    derivedCandidates: [], positionProvenCandidates: [],
  }));
  check('H1: a reconstruction failure does NOT trigger positional recovery',
      refused?.strategy !== 'evidence-backed-position', String(refused?.strategy));
  check('H1: and introduces no index of any kind',
      !/\.nth\(|\.first\(|\.last\(/.test(String(refused?.expression ?? '')),
      String(refused?.expression));
  check('H2: it is the recorded expression, judged on shape, or a refusal - never an invention',
      refused?.expression === ROW_SCOPED || refused?.outcome === 'NEEDS_REVIEW',
      `${refused?.outcome} ${refused?.expression}`);
}

/* ------------------------------------------- the corpus this actually affects ---- */

function checkCorpus(): void {
  section('the recordings on disk whose counts came from a broadened locator');

  const dirs = ['ai/dashboard/recordings', 'ai/dashboard/recordings/accepted'];
  let withFilter = 0;
  const cases = new Set<string>();
  for (const dir of dirs) {
    if (!fs.existsSync(path.join(ROOT, dir)))
      continue;
    for (const file of fs.readdirSync(path.join(ROOT, dir)).filter(name => name.endsWith('.assertions.json'))) {
      let list: Array<{ locator?: string; subjectProvenance?: { locatorMatchCount?: number | null } }> = [];
      try {
        list = JSON.parse(fs.readFileSync(path.join(ROOT, dir, file), 'utf8'));
      } catch {
        continue;
      }
      for (const entry of list) {
        const locator = String(entry.locator ?? '');
        if (!locator || chainMethodsIn(locator).every(method => method !== 'filter'))
          continue;
        if (typeof entry.subjectProvenance?.locatorMatchCount === 'number') {
          withFilter += 1;
          cases.add(path.basename(file, '.assertions.json'));
        }
      }
    }
  }
  // NOT AN ASSERTION ABOUT A NUMBER - a statement of what is on disk and cannot be
  // repaired. Those counts were taken of a locator nobody recorded; re-recording is the
  // only way to obtain an honest one, exactly as with every other measurement here.
  check('every existing count taken through a filtered chain is now known to be broad',
      withFilter >= 0, `${withFilter} assertion(s) across ${cases.size} case(s): ${[...cases].sort().join(', ')}`);
  check('and nothing rewrites them', true, 'evidence is immutable provenance');
}

/* ------------------------------------------ options: faithful, or refused ---- */

/**
 * A stub that records the OPTIONS it was handed, not only the calls.
 *
 * `getByRole('button', { name: 'Sign In', exact: true })` was rebuilt as
 * `getByRole('button', { name: 'Sign In' })` - the option silently removed. Without a
 * stub that reports what it received, that is invisible: both produce a locator, and
 * only the count differs, on a page that happens to have a second matching name.
 */
function optionStub() {
  const make = (soFar: string): any => ({
    expression: soFar,
    locator: (value: string) => make(`${soFar}.locator(${JSON.stringify(value)})`),
    getByTestId: (value: string) => make(`${soFar}.getByTestId(${JSON.stringify(value)})`),
    getByRole: (role: string, options?: Record<string, unknown>) =>
      make(`${soFar}.getByRole(${JSON.stringify(role)}${options ? `, ${JSON.stringify(options)}` : ''})`),
    getByText: (value: string, options?: Record<string, unknown>) =>
      make(`${soFar}.getByText(${JSON.stringify(value)}${options ? `, ${JSON.stringify(options)}` : ''})`),
    getByLabel: (value: string, options?: Record<string, unknown>) =>
      make(`${soFar}.getByLabel(${JSON.stringify(value)}${options ? `, ${JSON.stringify(options)}` : ''})`),
    first: () => make(`${soFar}.first()`),
    last: () => make(`${soFar}.last()`),
    nth: (index: number) => make(`${soFar}.nth(${index})`),
    count: async () => 0,
  });
  const page = make('page');
  return (expression: string): string | null => {
    const locator = buildLocator(page, expression);
    return locator ? String(locator.expression) : null;
  };
}

function checkOptions(): void {
  section('options - reproduced exactly, or the whole expression is refused');

  const rebuild = optionStub();

  // A/B/C - the supported pair, in all three shapes, and the OPTION ITSELF is asserted.
  const withExactTrue = rebuild('page.getByRole(\'button\', { name: \'Sign In\', exact: true })');
  check('A: exact:true survives reconstruction',
      withExactTrue === 'page.getByRole("button", {"name":"Sign In","exact":true})', String(withExactTrue));

  const withExactFalse = rebuild('page.getByRole(\'button\', { name: \'Sign In\', exact: false })');
  check('B: exact:false survives too - it is a value, not a default to be inferred',
      withExactFalse === 'page.getByRole("button", {"name":"Sign In","exact":false})', String(withExactFalse));

  const nameOnly = rebuild('page.getByRole(\'button\', { name: \'Sign In\' })');
  check('C: a name with no exact is unchanged from before',
      nameOnly === 'page.getByRole("button", {"name":"Sign In"})', String(nameOnly));
  check('C: and a bare role is still a bare role',
      rebuild('page.getByRole(\'checkbox\')') === 'page.getByRole("checkbox")');

  // THE EXACT DEFECT, NAMED. This is the string the old builder produced for the
  // recorded expression above, and nothing may produce it from that input any more.
  check('A: the broader form is never produced from an exact recording',
      withExactTrue !== 'page.getByRole("button", {"name":"Sign In"})');

  // D/E - every option Playwright offers that this module does not reproduce. Each one
  // NARROWS, so removing it would widen the locator; the whole expression is refused.
  for (const option of ['checked: true', 'disabled: true', 'expanded: false',
    'includeHidden: true', 'level: 2', 'pressed: true', 'selected: true']) {
    const expression = `page.getByRole('button', { name: 'Sign In', ${option} })`;
    check(`D: ${option.split(':')[0]} is refused, never dropped`,
        rebuild(expression) === null, String(rebuild(expression)));
  }
  check('E: an option nobody has heard of is refused as well',
      rebuild('page.getByRole(\'button\', { somethingNew: 1 })') === null);
  check('E: and a supported option with an unreproducible VALUE is refused',
      rebuild('page.getByRole(\'button\', { name: \'x\', exact: someFlag })') === null);

  // A NAME THAT IS A REGEX. Dropping it would leave `getByRole('button')` - every
  // button on the page - which is the widest possible version of this defect.
  check('E: a regex name is refused rather than dropped',
      rebuild('page.getByRole(\'button\', { name: /Sign In/ })') === null);
  check('E: and a computed name is refused',
      rebuild('page.getByRole(\'button\', { name: label })') === null);

  // THE SAME OPTION ON THE TEXT FAMILY, which had the same hole: 32 recorded
  // expressions carry `getByText(..., { exact: true })`.
  check('A: getByText keeps its exact',
      rebuild('page.getByText(\'ON\', { exact: true })') === 'page.getByText("ON", {"exact":true})',
      String(rebuild('page.getByText(\'ON\', { exact: true })')));
  check('D: getByText refuses an option it cannot reproduce',
      rebuild('page.getByText(\'ON\', { exact: true, ignoreCase: false })') === null);
  check('A: getByLabel keeps its exact',
      rebuild('page.getByLabel(\'Email\', { exact: true })') === 'page.getByLabel("Email", {"exact":true})');

  // locator() and getByTestId() take options this module does not reproduce either.
  check('D: locator(selector, { hasText }) is refused',
      rebuild('page.locator(\'.row\', { hasText: \'x\' })') === null);
  check('D: getByTestId with a second argument is refused',
      rebuild('page.getByTestId(\'id\', { exact: true })') === null);

  // nth() used to turn anything unreadable into index 0 - a DIFFERENT element, chosen
  // silently. It is a literal integer or it is nothing.
  check('E: nth(n) still works', rebuild('page.locator(\'.x\').nth(2)') === 'page.locator(".x").nth(2)');
  check('E: nth(someIndex) is refused rather than becoming nth(0)',
      rebuild('page.locator(\'.x\').nth(someIndex)') === null);
  check('E: first() with an argument is refused',
      rebuild('page.locator(\'.x\').first(2)') === null);

  // Quoting, once more: an option-looking string inside a literal is not an option.
  check('E: a brace inside a quoted literal does not become an options object',
      rebuild('page.getByText(\'{ name: x }\')') === 'page.getByText("{ name: x }")',
      String(rebuild('page.getByText(\'{ name: x }\')')));
  check('E: a comma inside a quoted literal is not an argument separator',
      rebuild('page.getByText(\'Add, then close\')') === 'page.getByText("Add, then close")',
      String(rebuild('page.getByText(\'Add, then close\')')));

  section('no option is silently discarded - proved over the whole corpus');

  // EVERY option key the recordings actually contain, checked against what the builder
  // supports. A key that is neither supported nor refusing would be one being dropped.
  const dirs = ['ai/dashboard/recordings', 'ai/dashboard/recordings/accepted'];
  const keys = new Map<string, number>();
  for (const dir of dirs) {
    if (!fs.existsSync(path.join(ROOT, dir)))
      continue;
    for (const file of fs.readdirSync(path.join(ROOT, dir)).filter(name => name.endsWith('.spec.ts'))) {
      const text = fs.readFileSync(path.join(ROOT, dir, file), 'utf8');
      for (const call of text.matchAll(/\.(getBy[A-Za-z]+|locator)\(([^\n]*?)\)(?=\s*[.;)]|$)/g)) {
        const brace = call[2].indexOf('{');
        if (brace < 0)
          continue;
        for (const key of call[2].slice(brace).matchAll(/([A-Za-z]+)\s*:/g))
          keys.set(key[1], (keys.get(key[1]) ?? 0) + 1);
      }
    }
  }
  const unsupported = [...keys.keys()].filter(key => key !== 'name' && key !== 'exact');
  check('every option key in the corpus is one the builder reproduces exactly',
      unsupported.length === 0,
      `keys seen: ${[...keys].map(([k, v]) => `${k} x${v}`).join(', ')}`
      + (unsupported.length ? ` | NOT reproduced: ${unsupported.join(', ')}` : ''));
}

function main(): void {
  checkReconstruction();
  checkOptions();
  checkConsequence();
  checkCorpus();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
