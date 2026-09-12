import '../testing/isolated-checkout';
/**
 * An element's OWN id is a candidate. TC_LOGIN_077 is why.
 *
 *   npx tsx ai/autocode/stable-id-candidate.fixture.ts
 *
 * The recorded click was `<a id="notif_bell_trigger" aria-label="Notifications">`,
 * the sidebar bell. Codegen wrote `getByRole('link', { name: 'Notifications' })`,
 * and on FixturePortal's Manage screen that name belongs to more than one anchor, so
 * the locator measured 2 and the step was refused - correctly.
 *
 * What was wrong is what it was offered instead. The bell carries no classes and
 * no test id, so every candidate the builder produced came from its PARENT's
 * classes and described the parent: three measured exactly one element and were
 * refused because that element was not the one pressed, three matched many.
 * Ancestor ids were used, but only as scopes. The element's own id - unique on
 * every screen measured - was never proposed.
 *
 * WHAT THIS DOES NOT CHANGE, AND THE CHECKS THAT PROVE IT
 *
 * Nothing about how a candidate is judged. The id goes through the same press-time
 * measurement and the same `isProvenAgainstClickedTarget` bar as everything else:
 * one element, in the press's document, and that element is the one acted on. A
 * unique id pointing at a different element is still refused (12), a duplicated id
 * is still refused (11), and a dynamic id is never proposed at all (2).
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  candidateSelectorsFor, isProvenAgainstClickedTarget,
  type CandidateMeasurement, type TargetEvidence,
} from './dom-evidence';
import { analyseIdentifier, assessLocator } from './locator-quality';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** The production guard, exactly as `live-recorder.ts` passes it in. */
const looksGenerated = (value: string): boolean => analyseIdentifier(value).dynamic;

const build = (graph: Parameters<typeof candidateSelectorsFor>[0]) =>
  candidateSelectorsFor(graph, looksGenerated);
const expressions = (graph: Parameters<typeof candidateSelectorsFor>[0]) =>
  build(graph).map(candidate => candidate.expression);

/** TC_LOGIN_077's bell, field for field as its evidence file records it. */
const BELL = {
  target: {
    tag: 'a', accessibleName: 'Notifications', id: 'notif_bell_trigger',
    aria: { 'aria-label': 'Notifications' },
  },
  parent: { tag: 'li', stableClasses: ['gap', 'text-center'], text: 'Notifications' },
  ancestors: [
    { tag: 'li', stableClasses: ['gap', 'text-center'], text: 'Notifications', relationship: 'ancestor', depth: 1 },
    { tag: 'ul', stableClasses: ['nav', 'nav-stacked'], relationship: 'ancestor', depth: 2 },
    { tag: 'nav', stableClasses: ['ap__siderbar-compact'], relationship: 'ancestor', depth: 3 },
    { tag: 'div', id: 'main_content_wrapper', relationship: 'ancestor', depth: 4 },
  ],
  descendants: [],
} as unknown as Parameters<typeof candidateSelectorsFor>[0];

/* ------------------------------------------------- 1-2: when an id is proposed */

function checkGeneration(): void {
  process.stdout.write('\n== 1-2 — which ids become candidates ==\n');

  const built = build(BELL);
  check('1: a stable target id produces a candidate',
      built.some(candidate => candidate.expression === 'page.locator("#notif_bell_trigger")'),
      built.map(candidate => candidate.expression).join(' | '));
  check('1: under the strategy name stable-id',
      built.find(candidate => candidate.expression === 'page.locator("#notif_bell_trigger")')
          ?.strategy === 'stable-id');

  // 2 - every shape the existing rule already calls dynamic. No new rule: the
  // guard is `analyseIdentifier().dynamic`, the one the ancestor scopes use.
  for (const id of [
    'tc_summary_636432', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'ember1234',
    'react-select-2-input', 'notif_bell_trigger2',
  ]) {
    check(`2: "${id}" is dynamic, so it produces no id candidate`,
        looksGenerated(id)
        && !expressions({ ...BELL, target: { ...(BELL as any).target, id } } as any)
            .some(expression => expression.includes(id)),
        `dynamic=${looksGenerated(id)}`);
  }
  // and the authored ones this project relies on are still offered
  for (const id of ['loginForm2', 'step-3', 'gsigninform_btn', 'main_content_wrapper'])
    check(`2: "${id}" is authored, so it IS offered`,
        !looksGenerated(id)
        && expressions({ ...BELL, target: { ...(BELL as any).target, id } } as any)
            .includes(`page.locator("#${id}")`));

  // By strategy: the ancestor SCOPE candidates are written `#scope .class` and have
  // always existed, so a '#' prefix says nothing about whose id it is.
  check('2: a target with no id gains no id candidate',
      !build({ ...BELL, target: { tag: 'a', accessibleName: 'x' } } as any)
          .some(candidate => candidate.strategy === 'stable-id'));
  check('2: and the ancestor scopes it always had are untouched',
      expressions({ ...BELL, target: { tag: 'a', accessibleName: 'x' } } as any)
          .includes('page.locator("#main_content_wrapper a")'));
}

/* ------------------------------------- 3-5, 11-12: the bar it must still clear */

const measured = (over: Partial<CandidateMeasurement>): CandidateMeasurement => ({
  strategy: 'stable-id',
  expression: 'page.locator("#notif_bell_trigger")',
  matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press',
  ...over,
});

/** The TC_LOGIN_077 target, as the funnel receives it. */
const ambiguous = (candidates: CandidateMeasurement[]): TargetEvidence => ({
  locator: "page.getByRole('link', { name: 'Notifications', exact: true })",
  target: (BELL as any).target,
  parent: (BELL as any).parent,
  ancestors: (BELL as any).ancestors,
  children: [], descendants: [], previousSiblings: [], nextSiblings: [],
  relationships: [], matchCount: 2, matchCountDocument: 'same',
  captureTiming: 'before-action',
  derivedCandidates: candidates,
} as unknown as TargetEvidence);

const verdictFor = (candidates: CandidateMeasurement[]) => assessLocator({
  locator: "page.getByRole('link', { name: 'Notifications', exact: true })",
  target: 'Notifications', kind: 'action', evidence: ambiguous(candidates),
});

function checkTheBar(): void {
  process.stdout.write('\n== 3-5, 11-12 — the identity bar is unchanged ==\n');

  check('3: one element, same document, identity matched — proven',
      isProvenAgainstClickedTarget(measured({})));
  const good = verdictFor([measured({})]);
  check('3: and the funnel resolves it',
      good.outcome === 'NORMALIZED_LOCATOR' && good.strategy === 'disambiguated-by-clicked-target',
      `${good.outcome} | ${good.strategy}`);
  check('3: emitting the id, not a narrowed version of the ambiguous locator',
      good.expression === 'page.locator("#notif_bell_trigger")', String(good.expression));

  check('4: identityMatched false is refused by the predicate',
      !isProvenAgainstClickedTarget(measured({ identityMatched: false })));
  const noIdentity = verdictFor([measured({ identityMatched: false })]);
  check('4: and the funnel still refuses the step',
      noIdentity.outcome === 'NEEDS_REVIEW' && noIdentity.expression === null,
      `${noIdentity.outcome} | ${String(noIdentity.expression)}`);

  check('5: a measurement in another document is refused',
      !isProvenAgainstClickedTarget(measured({ sameDocument: false })));
  const otherDoc = verdictFor([measured({ sameDocument: false })]);
  check('5: and the funnel still refuses the step',
      otherDoc.outcome === 'NEEDS_REVIEW' && otherDoc.expression === null);

  // 11 - an id duplicated in the document is exactly a match count above one.
  check('11: a duplicated id measures more than one and is refused',
      !isProvenAgainstClickedTarget(measured({ matchCount: 2 })));
  const duplicated = verdictFor([measured({ matchCount: 2 })]);
  check('11: and the funnel still refuses the step',
      duplicated.outcome === 'NEEDS_REVIEW' && duplicated.expression === null);

  // 12 - the whole reason a count of one is not enough on its own.
  check('12: a UNIQUE id naming a different element is refused',
      !isProvenAgainstClickedTarget(measured({ matchCount: 1, identityMatched: false })));
  const wrongElement = verdictFor([measured({ matchCount: 1, identityMatched: false })]);
  check('12: and nothing is emitted for it',
      wrongElement.expression === null, String(wrongElement.expression));
  check('12: a claim-time measurement is not press-time proof',
      !isProvenAgainstClickedTarget(measured({ measuredAt: 'claim' })));
  check('11-12: an unmeasured id proves nothing',
      !isProvenAgainstClickedTarget(measured({ matchCount: null })));
}

/* ---------------------------------------------------- 6: the real TC_LOGIN_077 */

function checkTheRealCase(): void {
  const rebuilt = expressions(BELL);
  check('integration: the target id precedes parent-class candidates', rebuilt[0] === 'page.locator("#notif_bell_trigger")');
  check('integration: a proven id disambiguates the recorded name', verdictFor([measured({})]).strategy === 'disambiguated-by-clicked-target');
}


/* --------------------------------------------- 7-10: ordering, drift, hygiene */

function checkOrderingAndDrift(): void {
  process.stdout.write('\n== 7 — ordering ==\n');
  const withBoth = build({
    ...(BELL as any),
    target: { ...(BELL as any).target, data: { 'data-testid': 'bell' }, stableClasses: ['bell-link'] },
  } as any);
  const order = withBoth.map(candidate => candidate.strategy);
  check('7: data-testid comes first', order[0] === 'test-id', order.join(' > '));
  check('7: stable-id comes second', order[1] === 'stable-id', order.join(' > '));
  check('7: content and class candidates come after both',
      order.slice(2).every(strategy => strategy !== 'test-id' && strategy !== 'stable-id'),
      order.join(' > '));

  process.stdout.write('\n== 8 — additive authored-id generation on synthetic controls ==\n');
  for (const id of [undefined, 'item_900001', 'save_button']) {
    const graph = { target: { tag: 'button', id, stableClasses: ['save-control'],
      data: { 'data-testid': 'save' } }, ancestors: [], descendants: [] } as any;
    const candidates = build(graph);
    check(`8: ${id ?? 'no id'} keeps its test-id candidate`,
        candidates.some(c => c.expression === 'page.getByTestId("save")'));
    check(`8: ${id ?? 'no id'} keeps its structural class candidate`,
        candidates.some(c => c.expression === 'page.locator(".save-control")'));
    check(`8: ${id ?? 'no id'} gets an id candidate only when authored`,
        candidates.filter(c => c.strategy === 'stable-id').length === (id === 'save_button' ? 1 : 0));
  }

  process.stdout.write('\n== 9-10 — hygiene ==\n');
  const source = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-evidence.ts'), 'utf8');
  // The file has always mentioned `.first()` in a comment explaining why it is
  // refused. What must hold is that no CODE writes one, so comments are stripped.
  const code = source.split('\n')
      .filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
  // THE RULE NARROWED, NOT DROPPED. This file may now contain exactly ONE positional
  // expression: `positionalExpression`, which composes `expression.nth(k)` from an
  // index the BROWSER measured (`isPositionProvenAgainstClickedTarget`). Everything
  // else about the builder is unchanged - it still never synthesises a position, which
  // is what the output-level check above asserts and what actually matters. So instead
  // of "no .nth() anywhere", the scan now requires that every occurrence lives in that
  // one function and that the function is gated on the measurement.
  const positional = code.split('\n')
      .map((line, index) => ({ line, index }))
      .filter(entry => /\.(first|nth|last)\s*\(/.test(entry.line));
  const inPositionalExpression = (index: number): boolean => {
    const start = code.split('\n').findIndex(line => line.includes('export function positionalExpression'));
    return start >= 0 && index > start && index < start + 10;
  };
  check('9: every positional expression in the builder is the measured one',
      positional.every(entry => inPositionalExpression(entry.index)),
      positional.filter(entry => !inPositionalExpression(entry.index))
          .map(entry => entry.line.trim().slice(0, 50)).join(' | ') || 'all accounted for');
  // GATED ON A MEASUREMENT, whichever timing took it. `isPositionProven` is the union
  // of the press-time and pick-time predicates and demands the same five measurements of
  // both - an action still may not act on a pick, but that rule lives in
  // locator-quality.ts, not in the expression builder. What is asserted here is
  // unchanged: this function refuses to compose an index nothing measured.
  check('9: and it is gated on a measured index, not synthesised',
      /isPositionProven\(candidate\)/.test(
          code.slice(code.indexOf('export function positionalExpression'),
              code.indexOf('export function positionalExpression') + 320)));
  check('9: nor force, dispatchEvent, mouse, XPath, retries or sleeps',
      !/force:|dispatchEvent|mouse\.|xpath|setTimeout|waitForTimeout/i.test(code));
  check('9: and the added id branch is two lines of candidate construction',
      source.includes('if (target.id && !isGenerated(target.id))')
      && source.includes("structural('stable-id', idSelector(target.id, escape));"));
  check('9: which reuses the existing generated-id rule rather than a new one',
      !/function\s+\w*[Gg]enerated|looksDynamic|isDynamicId/.test(
          source.slice(source.indexOf('function idSelector'))));
  check('9: no candidate this builder produces carries first()/nth()',
      !build(BELL).some(candidate => /first\(\)|nth\(/.test(candidate.expression)));

  // 10 - an id that is not a plain CSS identifier must not be pasted after a '#'.
  for (const [id, expected] of [
    ['plain_id-9', 'page.locator("#plain_id-9")'],
    ['has.dot', 'page.locator("[id=\\"has.dot\\"]")'],
    ['has space', 'page.locator("[id=\\"has space\\"]")'],
    ['has:colon', 'page.locator("[id=\\"has:colon\\"]")'],
    ['9leading', 'page.locator("[id=\\"9leading\\"]")'],
    ['has[bracket]', 'page.locator("[id=\\"has[bracket]\\"]")'],
  ] as Array<[string, string]>) {
    const rebuilt = expressions({
      ...(BELL as any), target: { tag: 'a', id },
    } as any);
    check(`10: "${id}" is emitted safely`,
        rebuilt.includes(expected), `${rebuilt.filter(e => e.includes('id')).join(' | ')} — wanted ${expected}`);
  }
  const quoted = expressions({ ...(BELL as any), target: { tag: 'a', id: 'has"quote' } } as any);
  check('10: a quote in an id is escaped rather than closing the selector',
      quoted.some(expression => expression.includes('\\"has')
        || expression.includes('\\\\"')), quoted.join(' | '));
}

function main(): void {
  checkGeneration();
  checkTheBar();
  checkTheRealCase();
  checkOrderingAndDrift();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
