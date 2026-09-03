/**
 * An element's OWN id is a candidate. TC_LOGIN_077 is why.
 *
 *   npx tsx ai/autocode/stable-id-candidate.fixture.ts
 *
 * The recorded click was `<a id="notif_bell_trigger" aria-label="Notifications">`,
 * the sidebar bell. Codegen wrote `getByRole('link', { name: 'Notifications' })`,
 * and on Bugasura's Manage screen that name belongs to more than one anchor, so
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
  process.stdout.write('\n== 6 — TC_LOGIN_077, from its own evidence file ==\n');
  const file = path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_077.evidence.json');
  if (!fs.existsSync(file)) {
    check('6: the TC_LOGIN_077 evidence file is present', false, file);
    return;
  }
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  const recorded = evidence.targets.find((entry: any) =>
    entry.locator === "page.getByRole('link', { name: 'Notifications', exact: true })");
  check('6: the ambiguous target is in the file', Boolean(recorded));
  check('6: it measured two elements at press time',
      recorded.matchCount === 2 && recorded.matchCountDocument === 'same');
  check('6: and none of the candidates it was actually offered names the id',
      !(recorded.rejectedCandidates ?? []).some((candidate: any) =>
        candidate.expression.includes('notif_bell_trigger')),
      `${(recorded.rejectedCandidates ?? []).length} rejected`);

  // Rebuilt from the recorded graph, which is what a re-recording would measure.
  const rebuilt = expressions({
    target: recorded.target, parent: recorded.parent,
    ancestors: recorded.ancestors, descendants: recorded.descendants,
    locator: recorded.locator,
  } as any);
  check('6: rebuilding from that graph now proposes the id',
      rebuilt.includes('page.locator("#notif_bell_trigger")'), rebuilt.join(' | '));
  check('6: and it is proposed first, ahead of the parent-class shapes',
      rebuilt[0] === 'page.locator("#notif_bell_trigger")', rebuilt[0]);
  check('6: the six candidates it had before are all still proposed',
      (recorded.rejectedCandidates ?? []).every((candidate: any) =>
        rebuilt.includes(candidate.expression)),
      `${rebuilt.length} candidates now`);
  const resolved = verdictFor([measured({})]);
  check('6: measured at the press it reaches disambiguated-by-clicked-target',
      resolved.strategy === 'disambiguated-by-clicked-target', String(resolved.strategy));
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

  process.stdout.write('\n== 8 — existing recordings do not shift ==\n');
  // The stored evidence of an existing recording is not recomputed by this change:
  // its candidates were measured in a browser that is gone. What could shift is
  // what a re-recording would BUILD, so that is what is compared - a target with no
  // id, or a dynamic one, must build exactly what it built before.
  for (const id of ['TC_LOGIN_059', 'TC_LOGIN_060', 'TC_LOGIN_063']) {
    const file = path.resolve(ROOT, `ai/dashboard/recordings/${id}.evidence.json`);
    if (!fs.existsSync(file)) {
      check(`8: ${id} evidence is present`, false, file);
      continue;
    }
    const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
    let unchanged = 0;
    let gained = 0;
    let kept = 0;
    let lost = 0;
    for (const entry of evidence.targets ?? []) {
      if (!entry.target)
        continue;
      // `locator` matters: the live caller passes it and `candidateTextFor` prefers
      // Codegen's own text over the node's. Omitting it rebuilds different text and
      // makes an unchanged candidate look like a lost one.
      const graph = {
        target: entry.target, parent: entry.parent,
        ancestors: entry.ancestors, descendants: entry.descendants,
        locator: entry.locator,
      } as any;
      // By STRATEGY, not by a '#' prefix: the scoped-ancestor candidates have
      // always been written `#scope .class` and are not id candidates.
      const idCandidates = build(graph).filter(candidate => candidate.strategy === 'stable-id');
      const targetId: string | undefined = entry.target.id;
      const shouldHave = Boolean(targetId) && !looksGenerated(targetId!);
      if (shouldHave)
        gained += 1;
      else if (idCandidates.length === 0)
        unchanged += 1;
      else
        check(`8: ${id} — ${entry.locator} gained an id candidate it must not have`, false,
            idCandidates.map(candidate => candidate.expression).join(' | '));

      // Purely additive: every candidate this target was measured against before
      // is still produced. Those came from this builder, so none may disappear.
      const rebuilt = expressions(graph);
      for (const previous of [...(entry.derivedCandidates ?? []), ...(entry.rejectedCandidates ?? [])]) {
        if (rebuilt.includes(previous.expression))
          kept += 1;
        else {
          lost += 1;
          check(`8: ${id} — ${previous.expression} is no longer proposed`, false, entry.locator);
        }
      }
    }
    check(`8: ${id} — every previously measured candidate is still proposed`,
        lost === 0, `${kept} kept, ${lost} lost`);
    check(`8: ${id} — an id candidate appears only where the id is authored`,
        true, `${unchanged} target(s) correctly gained none, ${gained} have an authored id`);
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
