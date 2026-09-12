import '../testing/isolated-checkout';
/**
 * Content-aware candidate generation (P0.4).
 *
 *   npx tsx ai/autocode/content-candidates.fixture.ts
 *   npx tsx ai/autocode/content-candidates.fixture.ts --mutate    (proves the checks bite)
 *
 * Offline: no browser, no model, no network. It reads the real TC_LOGIN_059 sidecar
 * and drives the real `candidateSelectorsFor`.
 *
 * WHY THIS EXISTS
 *
 * TC_LOGIN_059 built twelve candidates for each `tc_summary_*` target, measured every
 * one in the live page, and none matched exactly one element - so the funnel dropped
 * all twelve and the sidecar recorded `derivedCandidates: []`. That was not a filter
 * bug. Inside a repeating container every row carries the same classes, so no
 * combination of ancestor id, class and tag can EVER be unique there. The only thing
 * that separates one row from the next is what it says, and the graph already held
 * that text and never used it.
 *
 * What this pins is generation only. Nothing here promotes anything: a candidate is
 * still promoted solely on a measured `matchCount === 1`, which needs a live page.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  candidateSelectorsFor, candidateTextFor, contentExpression, normaliseCandidateText,
  recordedTextLiteral, usableCandidateText, sanitiseEvidence,
  CANDIDATE_TEXT_LIMIT, MAX_CANDIDATES, MAX_CONTENT_CANDIDATES, MAX_TOTAL_CANDIDATES,
  type SelectorCandidate, type DomNode, type RelatedNode, type TargetEvidence,
} from './dom-evidence';
import { analyseIdentifier, assessLocator } from './locator-quality';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
const SIDECAR = path.join(RECORDINGS(), 'TC_LOGIN_059.evidence.json');
const MUTATE = process.argv.includes('--mutate');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const isGenerated = (value: string) => analyseIdentifier(value).dynamic;

/** The module under test, or its mutant when `--mutate` is on. */
type Generator = typeof candidateSelectorsFor;
let generate: Generator = candidateSelectorsFor;

/**
 * The CONTENT family: a candidate whose text discriminates the element itself.
 *
 * `container-text` is also text-bearing but is a different family with different
 * rules - it identifies an ANCESTOR by what it says and then descends (see
 * `contextual-locator.fixture.ts`). Every assertion in this file was written about
 * the content family, so it is what this selects.
 */
const contentOf = (candidates: SelectorCandidate[]) =>
  candidates.filter(entry => entry.text !== undefined && entry.strategy !== 'container-text');

/* ------------------------------------------------------------------ fixtures */

/** Two rows of one table: identical classes, different text. The whole problem. */
function rowGraph(id: string, summary: string): {
  locator: string; target: DomNode; parent?: DomNode; ancestors: RelatedNode[]; descendants: RelatedNode[];
} {
  return {
    locator: `page.locator('#cell_${id}')`,
    target: {
      tag: 'div', id: `cell_${id}`, text: summary,
      stableClasses: ['grid-cell', 'grid-cell--summary'],
    },
    parent: { tag: 'div', id: `row_${id}`, stableClasses: ['grid-row'] },
    ancestors: [
      { tag: 'div', id: `row_${id}`, stableClasses: ['grid-row'], relationship: 'ancestor', depth: 1 },
      { tag: 'table', id: 'report-table', stableClasses: ['grid'], relationship: 'ancestor', depth: 2 },
    ],
    descendants: [],
  };
}

/** A leaf <span> whose distinguishing classes sit on its parent - TC_LOGIN_059's second target. */
function leafGraph(text: string, recorded?: string): any {
  return {
    locator: recorded ?? `page.locator('#wrap').getByText('${text}')`,
    target: { tag: 'span', text },
    parent: { tag: 'div', id: 'summary_638476', stableClasses: ['summary--text', 'hidden-xs'] },
    ancestors: [
      { tag: 'div', id: 'summary_638476', stableClasses: ['summary--text'], relationship: 'ancestor', depth: 1 },
      { tag: 'table', id: 'report-table', stableClasses: ['grid'], relationship: 'ancestor', depth: 2 },
    ],
    descendants: [],
  };
}

/** A TargetEvidence carrying one measured candidate, for the promotion checks. */
function evidenceWith(matchCount: number): TargetEvidence {
  return {
    locator: "page.locator('#cell_638717')",
    target: { tag: 'div', id: 'cell_638717', text: 'Line Chart is blank', stableClasses: ['grid-cell'] },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1,
    identifier: { raw: 'cell_638717', dynamic: true, normalised: 'cell_<dynamic>' },
    derivedCandidates: [{
      strategy: 'scoped-class-text',
      expression: 'page.locator("#report-table .grid-cell").filter({ hasText: "Line Chart is blank" })',
      matchCount,
    }],
  } as TargetEvidence;
}

/* -------------------------------------------------------------------- checks */

function checkRepeatingContainer(): void {
  process.stdout.write('\n== A — a repeating container: structure is ambiguous, content is not ==\n');
  const first = generate(rowGraph('638717', 'Line Chart | Time Config Page is blank'), isGenerated);
  const second = generate(rowGraph('638476', 'Line Chart | Compute Flow is empty'), isGenerated);

  // STRUCTURAL means a CSS shape, which is what `measuredBy: 'page'` now says outright.
  // It used to be spelt `text === undefined`, and that stopped meaning the same thing
  // when the semantic families arrived: `getByText("...")` carries no `text` FIELD (the
  // text is inside the expression) and is emphatically not structural.
  const structural = (list: SelectorCandidate[]) =>
    list.filter(entry => entry.measuredBy !== 'expression' && entry.text === undefined)
        .map(entry => entry.expression);
  const semantic = (list: SelectorCandidate[]) =>
    list.filter(entry => entry.measuredBy === 'expression').map(entry => entry.expression);
  check('A: every STRUCTURAL candidate is identical for both rows — none can be unique',
      JSON.stringify(structural(first)) === JSON.stringify(structural(second)),
      `${structural(first).length} vs ${structural(second).length}`);
  // The same property the content family has, for the same reason: what separates two
  // identical rows is what they SAY, and a semantic candidate says it too.
  check('A: and the semantic candidates differ, because they carry the row text',
      semantic(first).length > 0
      && JSON.stringify(semantic(first)) !== JSON.stringify(semantic(second)),
      `${semantic(first).length} / ${semantic(second).length}`);
  check('A: a content candidate IS generated for each row',
      contentOf(first).length > 0 && contentOf(second).length > 0,
      `${contentOf(first).length} / ${contentOf(second).length}`);
  check('A: and the two rows\' content candidates differ',
      contentOf(first)[0]?.expression !== contentOf(second)[0]?.expression);
  check('A: candidates built from the element\'s OWN classes keep it (filter, never descend)',
      contentOf(first).filter(entry => entry.selector.includes('.grid-cell'))
          .every(entry => entry.textMode === 'filter'),
      contentOf(first).map(entry => `${entry.selector}=${entry.textMode}`).join(' | '));
  check('A: it is scoped by a stable ancestor, never page-wide',
      contentOf(first).every(entry => entry.selector.startsWith('#report-table')),
      contentOf(first)[0]?.selector);
}

function checkOrdering(): void {
  process.stdout.write('\n== ordering and cap ==\n');
  const built = generate(rowGraph('638717', 'Line Chart | Time Config Page is blank'), isGenerated);
  const lastContent = built.map(entry => entry.text !== undefined).lastIndexOf(true);
  const firstStructural = built.map(entry => entry.text !== undefined).indexOf(false);
  check('content candidates come before every structural one',
      lastContent >= 0 && lastContent < firstStructural, `${lastContent} < ${firstStructural}`);
  check(`no more than ${MAX_CONTENT_CANDIDATES} content candidates`,
      contentOf(built).length <= MAX_CONTENT_CANDIDATES, String(contentOf(built).length));
  // 12 -> 16 when the contextual family was added, so that it could not evict a
  // candidate that already existed. The claim that matters is the second half.
  // The structural budget is still 16 and is still the whole of what reaches the in-page
  // measurement; the semantic families are budgeted separately on top of it.
  check(`the structural cap is ${MAX_CANDIDATES} and nothing structural exceeds it`,
      MAX_CANDIDATES === 16
      && built.filter(entry => entry.measuredBy !== 'expression').length <= MAX_CANDIDATES,
      String(built.filter(entry => entry.measuredBy !== 'expression').length));
  check(`the total ceiling is ${MAX_TOTAL_CANDIDATES} and nothing exceeds it`,
      built.length <= MAX_TOTAL_CANDIDATES, String(built.length));
  check('no duplicate expressions', new Set(built.map(e => e.expression)).size === built.length);
}

function checkRecordedLiteral(): void {
  process.stdout.write('\n== B — the recorded literal beats derived text ==\n');
  const full = 'Line Chart | Compute Flow | Shift Comparison : Data is not displaying';
  const graph = leafGraph(full, `page.locator('#tc_summary_638476').getByText('Line Chart | Compute Flow |')`);
  const text = candidateTextFor(graph, isGenerated);
  check('B: the literal from the recorded chain is used',
      text === 'Line Chart | Compute Flow |', String(text));
  check('B: not the element\'s longer own text', text !== normaliseCandidateText(full));

  check('B: getByText literal is read', recordedTextLiteral(`page.getByText('Sign out')`) === 'Sign out');
  check('B: a getByRole name is read',
      recordedTextLiteral(`page.getByRole('button', { name: 'Save draft' })`) === 'Save draft');
  check('B: the INNERMOST literal wins — a chain narrows left to right',
      recordedTextLiteral(`page.getByText('Outer').getByText('Inner')`) === 'Inner');
  check('B: a locator with no text literal yields none',
      recordedTextLiteral(`page.locator('#tc_summary_638717')`) === null);

  process.stdout.write('\n   the literal must be text the element actually carries\n');
  const input = {
    locator: `page.getByRole('textbox', { name: 'Email' })`,
    target: { tag: 'input', id: 'email_field' },
    parent: { tag: 'div', stableClasses: ['login-input-group'] },
    ancestors: [{ tag: 'form', id: 'loginForm', relationship: 'ancestor' as const, depth: 1 }],
    descendants: [],
  };
  check('B: an <input>\'s accessible name is NOT used as content — it is a label, not its text',
      candidateTextFor(input, isGenerated) === null);
  check('B: so the input gets no content candidate at all',
      contentOf(generate(input, isGenerated)).length === 0);
}

function checkDescendGuard(): void {
  process.stdout.write('\n== descend only when the element itself bears the text ==\n');
  const leaf = generate(leafGraph('Line Chart | Compute Flow is empty'), isGenerated);
  check('a leaf span descends from its parent\'s classes',
      contentOf(leaf).some(entry => entry.textMode === 'descend'
        && entry.selector === '#report-table .summary--text.hidden-xs'),
      contentOf(leaf).map(entry => entry.selector).join(' | '));

  const container = {
    locator: `page.locator('#main-content')`,
    target: { tag: 'div', id: 'main-content', text: 'Faclon labs Revenue Flows Chat' },
    parent: { tag: 'div', id: 'main_content_wrapper' },
    ancestors: [{ tag: 'div', id: 'main_content_wrapper', relationship: 'ancestor' as const, depth: 1 }],
    descendants: [{ tag: 'span', text: 'Faclon labs', relationship: 'descendant' as const, depth: 1 }],
  };
  check('a container whose text lives further down gets NO descending candidate — it would '
      + 'resolve to a different node than the one recorded',
      contentOf(generate(container, isGenerated)).length === 0,
      contentOf(generate(container, isGenerated)).map(e => e.expression).join(' | '));
}

function checkRefusedText(): void {
  process.stdout.write('\n== E/F/G — text that may not be used ==\n');
  const refuse = (label: string, value: string | undefined) =>
    check(`  refused: ${label}`, usableCandidateText(value, isGenerated) === null,
        JSON.stringify(usableCandidateText(value, isGenerated)));

  refuse('E: undefined', undefined);
  refuse('E: empty', '');
  refuse('E: whitespace only', '   \n\t  ');
  refuse('E: a single character', 'x');
  refuse('F: a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N');
  refuse('F: a long opaque token', 'AKIAIOSFODNN7EXAMPLEKEY1234567890abcdef');
  refuse('G: digits only', '638717');
  refuse('G: digits and punctuation', '638,717.00 / 2025-02-11');
  refuse('G: a lone generated token', 'tc_summary_638717');
  refuse('G: a hashed class-shaped token', 'css-1x2y3z4a5b6c7d8e');

  check('  accepted: ordinary prose', usableCandidateText('Line Chart is blank', isGenerated)
    === 'Line Chart is blank');
  check('  accepted: prose that merely QUOTES an id — it is a sentence, not an identifier',
      usableCandidateText('Bug 638717 is not displayed', isGenerated) === 'Bug 638717 is not displayed');
  check('  accepted: a non-Latin label',
      usableCandidateText('プロジェクト作成', isGenerated) === 'プロジェクト作成');
  check('  a graph with no usable text produces no content candidate',
      contentOf(generate(rowGraph('1', '   '), isGenerated)).length === 0);
}

function checkNormalisation(): void {
  process.stdout.write('\n== H — normalisation and bounding ==\n');
  check('H: whitespace runs collapse', normaliseCandidateText('  Line   Chart\n\t is  blank ')
    === 'Line Chart is blank');
  const long = `${'A'.repeat(70)} tail-one`;
  const longer = `${'A'.repeat(70)} tail-two`;
  check('H: bounded to the limit', normaliseCandidateText(long).length <= CANDIDATE_TEXT_LIMIT,
      String(normaliseCandidateText(long).length));
  check('H: never ends in a space after truncation',
      !/\s$/.test(normaliseCandidateText(`${'B'.repeat(79)}  ${'C'.repeat(20)}`)));
  check('H: two texts that differ INSIDE the bound stay different',
      normaliseCandidateText(long) !== normaliseCandidateText(longer));

  // Two rows whose first 80 characters are identical DO collapse to one discriminator.
  // That is safe and is the reason bounding is allowed at all: `hasText` and `getByText`
  // match a substring, so a shorter text can only ever match MORE elements. A collision
  // therefore measures 2+ and is rejected - it can never manufacture a false unique.
  const shared = 'X'.repeat(CANDIDATE_TEXT_LIMIT + 10);
  const one = generate(rowGraph('1', `${shared} first`), isGenerated);
  const two = generate(rowGraph('2', `${shared} second`), isGenerated);
  check('H: a shared prefix past the bound collapses to the same text — looser, never falsely unique',
      contentOf(one).length > 0
      && contentOf(one)[0]?.text === contentOf(two)[0]?.text
      && contentOf(one)[0]?.text?.length === CANDIDATE_TEXT_LIMIT);
  check('H: within one list the collapse creates no duplicate entries',
      new Set(one.map(entry => entry.expression)).size === one.length);
}

function checkPromotionRule(): void {
  process.stdout.write('\n== C/D — measurement, and only measurement, promotes ==\n');
  const assess = (matchCount: number) => assessLocator({
    locator: "page.locator('#cell_638717')", target: 'summary cell', kind: 'action',
    evidence: evidenceWith(matchCount),
  });
  check('C: a content candidate measured at 2 does not promote — NEEDS_REVIEW',
      assess(2).outcome === 'NEEDS_REVIEW', assess(2).outcome);
  check('C: and it is not emitted as the expression', !String(assess(2).expression ?? '').includes('hasText'));
  check('C: a content candidate measured at 0 does not promote',
      assess(0).outcome === 'NEEDS_REVIEW', assess(0).outcome);
  const unique = assess(1);
  check('D: a content candidate measured at exactly 1 IS eligible',
      unique.outcome === 'NORMALIZED_LOCATOR', unique.outcome);
  check('D: and it is the expression that gets used',
      String(unique.expression).includes('hasText'), String(unique.expression));

  // The funnel: only a measured-unique candidate is ever persisted.
  const kept = (matchCount: number) => {
    const sanitised = sanitiseEvidence([{ ...evidenceWith(matchCount) } as any], '2026-08-15T00:00:00.000Z');
    return sanitised.available ? (sanitised.targets[0]?.derivedCandidates ?? []) : [];
  };
  check('D: sanitiseEvidence keeps a content candidate measured at 1', kept(1).length === 1);
  check('C: and drops one measured at 2', kept(2).length === 0);
  check('C: and drops one measured at 0', kept(0).length === 0);
}

function checkRealEvidence(): void {
  process.stdout.write('\n== I/J/K — authored repeating rows and credential control ==\n');
  for (const id of ['900001', '900002']) {
    const entry = { ...rowGraph(id, `Record ${id} summary`), derivedCandidates: [] };
    const built = generate(entry, isGenerated);
    const content = contentOf(built);
    check(`I: ${id} — content is proposed despite an empty previous measurement`, content.length > 0);
    check(`I: ${id} — content is scoped to the stable table`,
        content.every(item => item.selector.startsWith('#report-table')));
    check(`I: ${id} — no generated row identifier is proposed`,
        content.every(item => !/cell_\d|row_\d/.test(item.expression)));
    check(`I: ${id} — content comes first`, built[0]?.text !== undefined);
  }
  const password = {
    target: { tag: 'input', type: 'password', id: 'password_field' },
    parent: { tag: 'form', text: 'Password password_value', stableClasses: ['auth-form'] },
    ancestors: [{ tag: 'form', text: 'Password password_value', stableClasses: ['auth-form'], relationship: 'ancestor', depth: 1 }],
    descendants: [],
  } as any;
  const built = generate(password, isGenerated);
  check('J: authored structural control remains available',
      built.some(item => item.strategy === 'stable-id' && item.expression === 'page.locator("#password_field")'));
  check('K: input gains no content candidate', contentOf(built).length === 0);
  check('K: contextual phrases do not disclose a credential label',
      !built.filter(item => item.strategy === 'container-text').some(item => /password|secret|token|pwd/i.test(item.text ?? '')));
  check('K: candidates never quote the credential value', !JSON.stringify(built).includes('password_value'));
}

function checkForbiddenShapes(): void {
  process.stdout.write('\n== forbidden shapes never appear ==\n');
  const graphs = [
    rowGraph('638717', 'Line Chart | Time Config Page is blank'),
    leafGraph('Line Chart | Compute Flow is empty'),
  ];
  const every = graphs.flatMap(graph => generate(graph, isGenerated)).map(entry => entry.expression);
  const banned: Array<[string, RegExp]> = [
    ['.first()', /\.first\(/], ['.nth(', /\.nth\(/], ['force', /force/],
    ['xpath', /xpath=|\/html|\/\//], ['mouse.click', /mouse\.click/],
    ['dispatchEvent', /dispatchEvent/], ['evaluate', /evaluate\(/],
    ['positional pseudo', /:nth-child|:nth-of-type/],
  ];
  for (const [name, pattern] of banned)
    check(`  no ${name}`, !every.some(expression => pattern.test(expression)));
  // A CSS selector, or one of Playwright's own semantic builders. Nothing else, and in
  // particular nothing positional - `.first()`, `.nth()` and the rest are refused by the
  // banned list above and are absent from this grammar as well. Every shape here is one
  // `buildLocator` can rebuild faithfully, which is what makes it measurable at all.
  const GRAMMAR =
    /^page\.(locator\("|getByRole\(|getByLabel\(|getByPlaceholder\(|getByTestId\(|getByText\(|getByTitle\(|getByAltText\()/;
  check('  every expression is a CSS locator or a Playwright semantic builder — nothing else',
      every.every(expression => GRAMMAR.test(expression)),
      every.filter(expression => !GRAMMAR.test(expression))[0] ?? 'all conform');

  const source = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-evidence.ts'), 'utf8');
  check('  the generator opens no browser', !/chromium|playwright-cli|browse\.mjs/.test(source));
  check('  the generator calls no model', !/claude|anthropic|AUTOCODE_MODEL/i.test(source));
  check('  contentExpression emits only the two approved shapes',
      contentExpression('#a .b', 'x', 'filter') === 'page.locator("#a .b").filter({ hasText: "x" })'
      && contentExpression('#a', 'x', 'descend') === 'page.locator("#a").getByText("x")');
}

/* ------------------------------------------------------------------ mutation */

/**
 * L - remove the content strategy and prove the checks above go red.
 *
 * A fixture that passes with the feature removed is testing nothing. This writes a
 * copy of the module with the one line that emits content candidates deleted, imports
 * the copy, and re-runs the checks against it - which must FAIL.
 */
async function runMutation(): Promise<void> {
  const file = path.resolve(ROOT, 'ai/autocode/dom-evidence.ts');
  const mutant = path.resolve(ROOT, 'ai/autocode/dom-evidence.mutant.ts');
  const source = fs.readFileSync(file, 'utf8');
  const marker = '    for (const candidate of bases.slice(0, MAX_CONTENT_CANDIDATES))\n      add(candidate);';
  const hits = source.split(marker).length - 1;
  if (hits !== 1) {
    process.stdout.write(`FAIL  L: the mutation marker matched ${hits} times, expected exactly 1\n`);
    process.exit(1);
  }
  fs.writeFileSync(mutant, source.split(marker).join('    // MUTATED: content candidates removed'), 'utf8');
  let expected = false;
  try {
    const loaded = await import('./dom-evidence.mutant');
    generate = loaded.candidateSelectorsFor as Generator;
    process.stdout.write('\n### MUTANT: content candidate emission removed. Every content check MUST fail.\n');
    runChecks();
    expected = failures > 0;
    process.stdout.write(`\n${expected
      ? `L: PASS — the mutant failed ${failures} check(s), so the fixture bites`
      : 'L: FAIL — the mutant passed every check; the fixture proves nothing'}\n`);
  } finally {
    // Before the exit, never after it: `process.exit` inside the try would skip this
    // and leave a copy of the module sitting in the source tree.
    fs.rmSync(mutant, { force: true });
  }
  process.exit(expected ? 0 : 1);
}

function runChecks(): void {
  checkRepeatingContainer();
  checkOrdering();
  checkRecordedLiteral();
  checkDescendGuard();
  checkRefusedText();
  checkNormalisation();
  checkPromotionRule();
  checkRealEvidence();
  checkForbiddenShapes();
}

async function main(): Promise<void> {
  if (MUTATE) {
    await runMutation();
    return;
  }
  runChecks();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
