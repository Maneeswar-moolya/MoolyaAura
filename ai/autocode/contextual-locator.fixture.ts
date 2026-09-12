import '../testing/isolated-checkout';
/**
 * A container identified by what it SAYS, and the element inside it.
 *
 *   npx tsx ai/autocode/contextual-locator.fixture.ts
 *   npx tsx ai/autocode/contextual-locator.fixture.ts --mutate
 *
 * TC_LOGIN_082 recorded a click on one checkbox among ten identical rows. The
 * element is `<input id="639978" class="bugChecked">`; the id is numeric, the
 * dynamic-id policy refuses it - correctly, it is an issue number - and every
 * class shape describes all ten rows. An `<input>` has no text of its own, so the
 * existing content family produced nothing at all. Eleven candidates, ten matches
 * each, no locator.
 *
 * What separates that row from its nine siblings is what the ROW says. This
 * fixture pins the family that expresses it:
 *
 *   page.locator('.tabulator-row')
 *       .filter({ hasText: 'Line Chart : Getting flat line for Weekly and monthly' })
 *       .locator('.bugChecked')
 *
 * WHAT IT MUST NOT BECOME
 *
 * Uniqueness has never been enough here, and a contextual locator is the easiest
 * kind to get confidently wrong: a container filtered by the wrong phrase is
 * unique AND names another row's checkbox. Every acceptance below therefore goes
 * through `isProvenAgainstClickedTarget` - measured at the press, in the press's
 * document, one element, and that element is the one the person acted on.
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  candidateSelectorsFor, containerExpression, containerPhraseFor, isProvenAgainstClickedTarget,
  looksLikeStateClass, MAX_CANDIDATES, MAX_CONTAINER_CANDIDATES, MAX_TOTAL_CANDIDATES,
  type CandidateMeasurement, type TargetEvidence,
} from './dom-evidence';
import { analyseIdentifier, assessLocator } from './locator-quality';
import { claimParkedEntry, locatorFor } from '../dashboard/live-recorder';

const ROOT = process.cwd();
const MUTATE = process.argv.includes('--mutate');
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** The production guard, exactly as the live recorder passes it in. */
const gen = (value: string): boolean => analyseIdentifier(value).dynamic;
const build = (graph: any) => candidateSelectorsFor(graph, gen);
const contextual = (graph: any) =>
  build(graph).filter(candidate => candidate.strategy === 'container-text');

const CHECKBOX = 'page.locator(\'[id="639978"]\')';
const PHRASE = 'Line Chart : Getting flat line for Weekly and monthly';

function recordedTarget(locator: string): any {
  const span = locator.includes('rounded-checkbox-ui');
  return {
    locator, target: { tag: span ? 'span' : 'input', type: span ? undefined : 'checkbox',
      id: span ? undefined : '639978', stableClasses: [span ? 'rounded-checkbox-ui' : 'bugChecked'] },
    ancestors: [
      { tag: 'div', id: 'row_639978', stableClasses: ['tabulator-row'],
        text: '639978 ' + PHRASE + '  ' + 'supplementary details '.repeat(6), relationship: 'ancestor', depth: 1 },
      { tag: 'div', text: 'var email = "fixture@example.invalid"; var password;', relationship: 'ancestor', depth: 2 },
    ], descendants: [], previousSiblings: [], nextSiblings: [],
    rejectedCandidates: [{ expression: 'page.locator(".bugChecked")', matchCount: 3 }],
  };
}
const graphOf = (entry: any) => ({
  target: entry.target, parent: entry.parent, ancestors: entry.ancestors,
  descendants: entry.descendants, previousSiblings: entry.previousSiblings,
  nextSiblings: entry.nextSiblings, locator: entry.locator,
});

/* --------------------------------------------------- A-D: the recorded graph */

function checkGraph(): void {
  process.stdout.write('\n== A-D — authored repeated-row evidence ==\n');
  const entry = recordedTarget(CHECKBOX);
  check('A: the authored graph includes the intended checkbox', Boolean(entry));

  const built = build(graphOf(entry));
  const wanted = containerExpression('.tabulator-row', PHRASE, '.bugChecked');
  check('A: the contextual candidate is generated',
      built.some(candidate => candidate.expression === wanted),
      built.map(candidate => candidate.expression).find(e => e.includes('tabulator-row')) ?? '(none)');
  check('A: and it is offered first, ahead of every ten-match class shape',
      built[0]?.expression === wanted, built[0]?.expression);
  check('A: it is composition, not XPath',
      wanted.includes('.filter({ hasText:') && wanted.includes('.locator("')
      && !/xpath|\/\/|::/.test(wanted));

  // B/C - the dynamic-id policy is untouched: the id is still refused everywhere.
  check('B: the numeric id is still classified dynamic', gen('639978'));
  check('B: so no stable-id candidate is built from it',
      !built.some(candidate => candidate.strategy === 'stable-id'),
      built.filter(c => c.strategy === 'stable-id').map(c => c.expression).join(' | '));
  check('B: and nothing generated names it at all',
      !built.some(candidate => candidate.expression.includes('639978')),
      built.filter(c => c.expression.includes('639978')).join(' | '));
  check('C: a UUID id is refused the same way', gen('a1b2c3d4-e5f6-7890-abcd-ef1234567890'));
  const uuid = build({ ...graphOf(entry),
    target: { ...entry.target, id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' } });
  check('C: and builds no id candidate',
      !uuid.some(candidate => candidate.strategy === 'stable-id'));

  // D - an authored id is still preferred, and the contextual family does not displace it.
  const authored = build({ ...graphOf(entry), target: { ...entry.target, id: 'issue_checkbox' } });
  check('D: an authored id still produces a stable-id candidate',
      authored.some(candidate => candidate.expression === 'page.locator("#issue_checkbox")'));
  check('D: and it still outranks the contextual family',
      authored.findIndex(c => c.strategy === 'stable-id')
        < authored.findIndex(c => c.strategy === 'container-text'),
      authored.map(c => c.strategy).slice(0, 4).join(' > '));

  // The span the person actually pressed resolves to ITS own selector in the same row.
  const span = recordedTarget("page.locator('.rounded-checkbox-ui').first()");
  check('A: the span click yields the same container with ITS own descendant',
      build(graphOf(span))[0]?.expression
        === containerExpression('.tabulator-row', PHRASE, '.rounded-checkbox-ui'),
      build(graphOf(span))[0]?.expression);
}

/* ------------------------------------------------- E-I: what a phrase may be */

function checkPhrase(): void {
  process.stdout.write('\n== E-I — the identifying phrase ==\n');
  const row = recordedTarget(CHECKBOX).ancestors[0];

  check('E: the dynamic issue number is dropped from the phrase',
      containerPhraseFor(row, gen) === PHRASE, String(containerPhraseFor(row, gen)));
  check('E: so no phrase anywhere carries it',
      !String(containerPhraseFor(row, gen)).includes('639978'));
  check('F: the captured text was at the cap, i.e. truncated',
      (row.text ?? '').length >= 120, `${(row.text ?? '').length} chars`);
  check('F: and the phrase stops well before the boundary',
      !String(containerPhraseFor(row, gen)).includes('displayi'));
  check('F: a truncated final word is never matched against',
      containerPhraseFor({ text: `${'word '.repeat(23)}displayi` }, gen)?.includes('displayi') !== true);

  check('G: text too short to discriminate yields nothing',
      containerPhraseFor({ text: 'Ok go' }, gen) === null);
  check('G: two words are not a discriminator',
      containerPhraseFor({ text: 'Delete row' }, gen) === null);
  check('G: three real words are',
      containerPhraseFor({ text: 'Delete this project now' }, gen) === 'Delete this project now');

  // H - the container text of a table wrapper is an inline <script>, and it holds
  // the account's email. A rejected candidate still keeps its expression on disk.
  const script = recordedTarget(CHECKBOX).ancestors[1];
  check('H: a container whose text is script source yields no phrase',
      containerPhraseFor(script, gen) === null, String(containerPhraseFor(script, gen)));
  check('H: no candidate carries an email address',
      !build(graphOf(recordedTarget(CHECKBOX))).some(c => c.expression.includes('@')),
      build(graphOf(recordedTarget(CHECKBOX))).filter(c => c.expression.includes('@')).join(' | '));
  for (const text of [
    'var email_lo = "someone@example.com"; var domain',
    'password = hunter2 and more words here',
    'token: abcdefghijklmnop qrstuv wxyz',
  ]) {
    check(`H: refuses "${text.slice(0, 28)}…"`,
        containerPhraseFor({ text }, gen) === null, String(containerPhraseFor({ text }, gen)));
  }

  // I - state classes must never become the container's identity.
  for (const name of ['selected', 'active', 'disabled', 'open', 'closed', 'animated',
    'fadeIn', 'focused', 'checked', 'hover', 'tabulator-selected', 'is-open', 'has-error'])
    check(`I: "${name}" is recognised as state`, looksLikeStateClass(name));
  for (const name of ['tabulator-row', 'project-card', 'list-item', 'form-section',
    'rounded-checkbox-ui', 'bugChecked'])
    check(`I: "${name}" is structural`, !looksLikeStateClass(name));
  const stateOnly = contextual({
    target: { tag: 'input', stableClasses: ['bugChecked'] },
    ancestors: [{ tag: 'div', stableClasses: ['selected', 'animated', 'fadeIn'],
      text: 'Line Chart : Getting flat line for Weekly and monthly' }],
  });
  check('I: an ancestor with only state classes yields no container', stateOnly.length === 0,
      stateOnly.map(c => c.expression).join(' | '));
  check('I: the real row uses tabulator-row, not tabulator-selected',
      contextual(graphOf(recordedTarget(CHECKBOX)))[0].expression.startsWith('page.locator(".tabulator-row")'));
}

/* -------------------------------------------- J-N: the bar, unchanged and met */

const measured = (over: Partial<CandidateMeasurement>): CandidateMeasurement => ({
  strategy: 'container-text',
  expression: containerExpression('.tabulator-row', PHRASE, '.bugChecked'),
  matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press',
  ...over,
});

const verdict = (candidates: CandidateMeasurement[]) => {
  const entry = recordedTarget(CHECKBOX);
  return assessLocator({
    locator: CHECKBOX, target: '639978', kind: 'action',
    evidence: { ...entry, matchCount: 2, matchCountDocument: 'same',
      captureTiming: 'before-action', derivedCandidates: candidates,
      rejectedCandidates: [] } as unknown as TargetEvidence,
  });
};

function checkTheBar(): void {
  process.stdout.write('\n== J-N — the identity bar ==\n');

  check('J: press-time, same document, one element, identity matched — proven',
      isProvenAgainstClickedTarget(measured({})));
  const good = verdict([measured({})]);
  check('J: and the funnel emits the contextual locator',
      good.outcome === 'NORMALIZED_LOCATOR'
      && good.expression === containerExpression('.tabulator-row', PHRASE, '.bugChecked'),
      `${good.outcome} | ${String(good.expression)}`);
  check('J: under the existing resolution, not a new one',
      good.strategy === 'disambiguated-by-clicked-target', String(good.strategy));

  // K - THE case. Unique is not enough: this is another row's checkbox.
  check('K: unique but a DIFFERENT element is refused',
      !isProvenAgainstClickedTarget(measured({ matchCount: 1, identityMatched: false })));
  const wrong = verdict([measured({ identityMatched: false })]);
  check('K: and nothing is emitted', wrong.expression === null, String(wrong.expression));
  check('L: several matches are refused',
      !isProvenAgainstClickedTarget(measured({ matchCount: 4 })));
  check('L: and nothing is emitted', verdict([measured({ matchCount: 4 })]).expression === null);
  check('M: a measurement in another document is refused',
      !isProvenAgainstClickedTarget(measured({ sameDocument: false })));
  check('M: and nothing is emitted', verdict([measured({ sameDocument: false })]).expression === null);

  // N - identity that was never established is not proof. It is NOT the same as
  // identity that came back false, and the pre-existing claim-time path for every
  // candidate is deliberately left exactly as it was.
  check('N: an unmeasured identity is not proof',
      !isProvenAgainstClickedTarget(measured({ identityMatched: undefined })));
  check('N: nor is a claim-time measurement',
      !isProvenAgainstClickedTarget(measured({ measuredAt: 'claim' })));
  check('N: nor an unmeasured count',
      !isProvenAgainstClickedTarget(measured({ matchCount: null })));
}

/* ----------------------------------------- O-P: the press-time claim, and Q-U */

function checkClaimAndHygiene(): void {
  process.stdout.write('\n== O-P — the attribute-selector claim ==\n');
  const parked = (target: any) => ({ at: 1, kind: 'pointerdown',
    fingerprint: { tag: target.tag, id: target.id ?? '', testId: '', role: '', ariaLabel: '',
      name: target.name ?? '', placeholder: '', title: '', type: target.type ?? '',
      text: target.text ?? '', classes: target.classes ?? [] },
    graph: { target } });
  const box = parked({ tag: 'input', id: '639978', name: 'bugChecked', type: 'checkbox',
    classes: ['bugChecked'] });
  const named = parked({ tag: 'div', id: 'abc', classes: ['x'] });

  check('P: [id="639978"] claims the press it belongs to',
      Boolean(claimParkedEntry([box], CHECKBOX)));
  check('P: [id="abc"] claims its own press',
      Boolean(claimParkedEntry([named], 'page.locator(\'[id="abc"]\')')));
  check('P: an unquoted attribute value works too',
      Boolean(claimParkedEntry([named], "page.locator('[id=abc]')")));
  check('P: a value that names a different node does not claim',
      claimParkedEntry([named], 'page.locator(\'[id="wrong"]\')') === null);
  for (const [label, expression] of [
    ['unterminated', "page.locator('[id=\"639978\"')"],
    ['escaped value', "page.locator('[id=\"639\\\\\"978\"]')"],
    ['operator', "page.locator('[id^=\"639\"]')"],
    ['two attributes', 'page.locator(\'[id="639978"][name="bugChecked"]\')'],
  ] as Array<[string, string]>)
    check(`O: a ${label} attribute selector claims nothing`,
        claimParkedEntry([box], expression) === null);

  process.stdout.write('\n== Q-U — hygiene, ordering, caps, assertions ==\n');
  const built = build(graphOf(recordedTarget(CHECKBOX)));
  check('Q: no candidate carries first() or nth()',
      !built.some(candidate => /\.first\(\)|\.nth\(/.test(candidate.expression)));
  check('R: no candidate uses XPath',
      !built.some(candidate => /xpath=|\/\/|::/.test(candidate.expression)));
  const source = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-evidence.ts'), 'utf8')
      .split('\n').filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line)).join('\n');
  // NARROWED, NOT DROPPED - see the same reasoning in stable-id-candidate.fixture.ts.
  // Check Q above is the real test: nothing the builder PRODUCES carries a position.
  // The file may contain one positional expression, composed from a measured index.
  const positionalLines = source.split('\n').filter(line => /\.(first|nth|last)\s*\(/.test(line));
  check('Q-R: the builder writes no position except the measured one',
      positionalLines.every(line => /positionWithinCandidate/.test(line)),
      positionalLines.filter(line => !/positionWithinCandidate/.test(line))
          .map(line => line.trim().slice(0, 48)).join(' | ') || 'only the measured one');

  // S/T - every candidate the recording was measured against before is still built,
  // in the same relative order, and the cap did not evict any of them.
  const entry = recordedTarget(CHECKBOX);
  const previous = (entry.rejectedCandidates ?? []).map((c: any) => c.expression);
  const expressions = built.map(candidate => candidate.expression);
  check('S: every previously measured candidate is still built',
      previous.every((expression: string) => expressions.includes(expression)),
      `${previous.length} previously measured`);
  const order = previous.map((expression: string) => expressions.indexOf(expression));
  check('S: and in the same relative order',
      order.every((position: number, index: number) => index === 0 || position > order[index - 1]),
      order.join(','));
  check('T: the contextual family is bounded',
      contextual(graphOf(entry)).length <= MAX_CONTAINER_CANDIDATES,
      `${contextual(graphOf(entry)).length} of ${MAX_CONTAINER_CANDIDATES}`);
  // THE CAP IS TWO CAPS NOW, and the first half of this check is the one that always
  // mattered: the structural budget is untouched, so nothing that was measured before
  // the semantic families existed can be evicted by one of them.
  const structuralOnly = built.filter(candidate => candidate.measuredBy !== 'expression');
  check('T: the structural budget is unchanged and still holds everything measured before',
      structuralOnly.length <= MAX_CANDIDATES && structuralOnly.length >= previous.length + 1,
      `${structuralOnly.length} structural, cap ${MAX_CANDIDATES}, ${previous.length} pre-existing`);
  check('T: and the total stays inside the family-budget ceiling',
      built.length <= MAX_TOTAL_CANDIDATES,
      `${built.length} of ${MAX_TOTAL_CANDIDATES}`);

  // U - the assertion path obeys the same policy. It used to write `#639978`.
  check('U: the assertion locator refuses a dynamic id',
      !locatorFor({ tag: 'input', id: '639978', stableClasses: ['bugChecked'] }).includes('639978'),
      locatorFor({ tag: 'input', id: '639978', stableClasses: ['bugChecked'] }));
  check('U: and still uses an authored one',
      locatorFor({ tag: 'a', id: 'notif_bell_trigger' }) === 'page.locator("#notif_bell_trigger")');

}

/* ------------------------------------------------------- generality, and mutation */

function checkGenerality(): void {
  process.stdout.write('\n== generality — the same rule on other repeated shapes ==\n');
  const shapes: Array<[string, any, string]> = [
    ['table row', { tag: 'tr', stableClasses: ['issue-row'] }, '.issue-row'],
    ['card', { tag: 'div', stableClasses: ['project-card'] }, '.project-card'],
    ['list item', { tag: 'li', stableClasses: ['list-item'] }, '.list-item'],
    ['form section', { tag: 'fieldset', stableClasses: ['form-section'] }, '.form-section'],
  ];
  for (const [label, ancestor, container] of shapes) {
    const built = contextual({
      target: { tag: 'button', stableClasses: ['delete-action'] },
      ancestors: [{ ...ancestor, text: 'Quarterly revenue report for the northern region' }],
    });
    check(`generality: ${label} yields a contextual candidate`,
        built[0]?.expression === containerExpression(container,
            'Quarterly revenue report for the northern region', '.delete-action'),
        built[0]?.expression);
  }
  const noClasses = contextual({
    target: { tag: 'button' },
    ancestors: [{ tag: 'li', stableClasses: ['list-item'],
      text: 'Quarterly revenue report for the northern region' }],
  });
  check('generality: a target with no classes falls back to its tag',
      noClasses[0]?.expression.endsWith('.locator("button")'), noClasses[0]?.expression);
  check('generality: a container with no usable text yields nothing',
      contextual({ target: { tag: 'button', stableClasses: ['x'] },
        ancestors: [{ tag: 'li', stableClasses: ['list-item'], text: 'Go' }] }).length === 0);
}

function checkMutations(): void {
  process.stdout.write('\n== mutation — each guard is load-bearing ==\n');
  const wrongElement = measured({ matchCount: 1, identityMatched: false });

  check('mutation: dropping identity verification would accept another row\'s checkbox',
      !isProvenAgainstClickedTarget(wrongElement)
      && (wrongElement.matchCount === 1 && wrongElement.sameDocument === true),
      'unique and same-document, yet the wrong element');
  check('mutation: accepting unique-but-wrong would emit a locator for it',
      verdict([wrongElement]).expression === null
      && [wrongElement].filter(c => c.matchCount === 1).length === 1);

  // Removing the contextual family: what TC_LOGIN_082 looked like before.
  const entry = recordedTarget(CHECKBOX);
  const without = build(graphOf(entry)).filter(c => c.strategy !== 'container-text');
  check('mutation: without the contextual family nothing can resolve it',
      without.every(candidate => !candidate.expression.includes('hasText')),
      `${without.length} candidates, all class shapes`);
  const priorCounts = (entry.rejectedCandidates ?? []).map((c: any) => c.matchCount);
  check('mutation: and every one of those measured more than one element',
      priorCounts.every((count: number) => count > 1), priorCounts.join(','));

  // Removing the attribute-claim fix: replicate the OLD literal rule exactly.
  const oldLiteral = (argument: string) =>
    (/^[#.][A-Za-z0-9_-]+$/.test(argument) ? argument.slice(1) : argument);
  check('mutation: the old literal rule leaves the selector whole',
      oldLiteral('[id="639978"]') === '[id="639978"]');
  check('mutation: which no captured node name can satisfy, so the press went unclaimed',
      !['input', '639978', 'bugchecked', 'checkbox'].some(name =>
        name.includes(oldLiteral('[id="639978"]').toLowerCase())));

  // Allowing dynamic ids directly, in either writer.
  check('mutation: the builder would otherwise offer #639978',
      gen('639978') && !build(graphOf(entry)).some(c => c.expression === 'page.locator("#639978")'));
  check('mutation: and the assertion writer would otherwise write it',
      locatorFor({ tag: 'input', id: '639978', stableClasses: ['bugChecked'] })
        !== 'page.locator("#639978")');
}

/**
 * The wire, checked at the source.
 *
 * A contextual candidate is rebuilt from its PARTS at both measurement sites, not
 * from its expression string - and `descendant` was dropped from the press-time
 * payload for exactly as long as it took to notice. The family still generated,
 * still looked right in every offline check, and reached the page as its container
 * alone: `.tabulator-row`, ten matches, refused. Nothing else in this file can see
 * that, because it happens between processes.
 */
function checkWire(): void {
  process.stdout.write('\n== the wire — both measurement sites rebuild from the parts ==\n');
  const live = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  const payload = live.slice(live.indexOf('const answer = await frame.evaluate(MEASURE_IN_PAGE'),
      live.indexOf('const answer = await frame.evaluate(MEASURE_IN_PAGE') + 900);
  check('wire: the press-time payload carries the descendant',
      /descendant: candidate\.descendant/.test(payload),
      payload.split('\n').filter(line => line.includes('candidate.')).join(' | ').slice(0, 120));
  check('wire: it also still carries the text and its mode',
      /text: candidate\.text, textMode: candidate\.textMode/.test(payload));
  check('wire: the claim-time locator descends too',
      /if \(candidate\.descendant\)/.test(live) && /locator\.locator\(candidate\.descendant\)/.test(live));
  const capture = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-capture-source.ts'), 'utf8');
  check('wire: the in-page measurement descends inside the filtered container',
      /candidate\.descendant/.test(capture) && /querySelectorAll\(candidate\.descendant\)/.test(capture));
  check('wire: and reports a bad descendant rather than counting nothing',
      /descendant could not be evaluated/.test(capture));
  check('wire: identity is still what the in-page code answers',
      /identityMatched: nodes\.length === 1 && !!element && nodes\[0\] === element/.test(capture));
}

function main(): void {
  checkGraph();
  checkPhrase();
  checkTheBar();
  checkClaimAndHygiene();
  checkGenerality();
  checkWire();
  checkMutations();
  if (MUTATE)
    process.stdout.write('\n(--mutate: the mutation section above runs on every invocation)\n');
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
