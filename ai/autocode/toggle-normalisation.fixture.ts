/**
 * One human toggle is one action, and a positional locator is not a verdict.
 *
 *   npx tsx ai/autocode/toggle-normalisation.fixture.ts
 *
 * TC_DASHBOARD_011 recorded three clicks on Bugasura's row checkboxes and produced
 * six actions. Clicking the visible span makes Codegen write the pointer event AND
 * the state change of the input the label forwards it to:
 *
 *   click .rounded-checkbox-ui   +   check [id="639978"]
 *   click .rounded-checkbox-ui   +   uncheck done
 *
 * Replaying both applies the toggle twice. The `check` is a harmless no-op; the
 * `uncheck` waits fifteen seconds for `getByRole('checkbox', { name: 'done' })` -
 * a name that is the Material Icons `::after` glyph and, measured live, exists only
 * while the box is checked (1 match checked, 0 unchecked). By the time it runs, the
 * click before it has already turned the box off, so the locator names nothing.
 *
 * The click is what survives. The input is 0x0 and `opacity: 0` - measured - so
 * `check()` on it can only succeed by doing nothing, and the span is what the person
 * actually touched.
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  isPositionProvenAgainstClickedTarget, isProvenAgainstClickedTarget,
  type CandidateMeasurement, type TargetEvidence,
} from './dom-evidence';
import { assessLocator, isPositionalLocator } from './locator-quality';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording, readAssertions, readEvidence } from './from-recording';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* ------------------------------------------------- synthetic evidence helpers */

const SPAN = (locator: string): TargetEvidence => ({
  locator,
  target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
  parent: { tag: 'label', stableClasses: ['rounded-checkbox-cont'] },
  ancestors: [], children: [], descendants: [],
  previousSiblings: [{ tag: 'input', type: 'checkbox', id: '639978', name: 'bugChecked',
    stableClasses: ['bugChecked'], relationship: 'previous-sibling', depth: 1 }],
  nextSiblings: [], relationships: [], matchCount: 1,
} as unknown as TargetEvidence);

const INPUT = (locator: string, id = '639978'): TargetEvidence => ({
  locator,
  target: { tag: 'input', type: 'checkbox', id, name: 'bugChecked', stableClasses: ['bugChecked'] },
  parent: { tag: 'label', stableClasses: ['rounded-checkbox-cont'] },
  ancestors: [], children: [], descendants: [], previousSiblings: [],
  nextSiblings: [{ tag: 'span', stableClasses: ['rounded-checkbox-ui'],
    relationship: 'next-sibling', depth: 1 }],
  relationships: [], matchCount: 1,
} as unknown as TargetEvidence);

/** A state action whose element could not be found - the `uncheck done` shape. */
const NOT_FOUND = (locator: string): TargetEvidence => ({
  locator, target: { tag: '(not found)' }, matchCount: 0,
} as unknown as TargetEvidence);

const script = (...lines: string[]): string =>
  `import { test, expect } from '@playwright/test';\n\ntest('t', async ({ page }) => {\n`
  + lines.map(line => `  ${line}\n`).join('') + '});';

const parse = (lines: string[], targets: TargetEvidence[]) => parseRecording(script(...lines), {
  startUrl: '', browser: '', durationMs: 0,
  evidence: { available: true, capturedAt: '', limits: {}, targets } as any,
});

const types = (lines: string[], targets: TargetEvidence[]) =>
  parse(lines, targets).actions.map(action => action.type).join(',');

/* ------------------------------------------------- A-I: what collapses, what does not */

function checkCollapse(): void {
  process.stdout.write('\n== A-I — one human toggle, one action ==\n');
  const CLICK = "await page.locator('.rounded-checkbox-ui').first().click();";

  check('A: click + check of the associated input collapses to the click',
      types([CLICK, 'await page.locator(\'[id="639978"]\').check();'],
          [SPAN("page.locator('.rounded-checkbox-ui').first()"),
            INPUT('page.locator(\'[id="639978"]\')')]) === 'click',
      types([CLICK, 'await page.locator(\'[id="639978"]\').check();'],
          [SPAN("page.locator('.rounded-checkbox-ui').first()"),
            INPUT('page.locator(\'[id="639978"]\')')]));

  check('B: click + uncheck whose element cannot be found collapses too',
      types([CLICK, "await page.getByRole('checkbox', { name: 'done' }).uncheck();"],
          [SPAN("page.locator('.rounded-checkbox-ui').first()"),
            NOT_FOUND("page.getByRole('checkbox', { name: 'done' })")]) === 'click');
  check('B: and the surviving action is the CLICK, never the state change',
      parse([CLICK, "await page.getByRole('checkbox', { name: 'done' }).uncheck();"],
          [SPAN("page.locator('.rounded-checkbox-ui').first()"),
            NOT_FOUND("page.getByRole('checkbox', { name: 'done' })")]).actions[0].type === 'click');

  // C/D - a state change that is its own interaction is never touched.
  check('C: a check with no click before it is kept',
      types(['await page.locator(\'[id="639978"]\').check();'],
          [INPUT('page.locator(\'[id="639978"]\')')]) === 'check');
  check('C: an uncheck with no click before it is kept',
      types(['await page.locator(\'[id="639978"]\').uncheck();'],
          [INPUT('page.locator(\'[id="639978"]\')')]) === 'uncheck');
  check('D: a click on something unrelated does not swallow the next check',
      types(["await page.getByRole('button', { name: 'Filter' }).click();",
        'await page.locator(\'[id="639978"]\').check();'],
      [{ locator: "page.getByRole('button', { name: 'Filter' })",
        target: { tag: 'button', text: 'Filter' }, matchCount: 1 } as any,
      INPUT('page.locator(\'[id="639978"]\')')]) === 'click,check');

  // E/F - identity, not adjacency.
  check('E: a click whose label holds a DIFFERENT control is not collapsed',
      types([CLICK, 'await page.locator(\'[id="111111"]\').check();'],
          [SPAN("page.locator('.rounded-checkbox-ui').first()"),
            INPUT('page.locator(\'[id="111111"]\')', '111111')]) === 'click,check');
  check('F: a click not inside a label is never collapsed',
      types([CLICK, 'await page.locator(\'[id="639978"]\').check();'],
          [{ ...SPAN("page.locator('.rounded-checkbox-ui').first()"),
            parent: { tag: 'div', stableClasses: ['cell'] } } as any,
          INPUT('page.locator(\'[id="639978"]\')')]) === 'click,check');
  check('F: nor is one whose sibling is not a checkable control',
      types([CLICK, 'await page.locator(\'[id="639978"]\').check();'],
          [{ ...SPAN("page.locator('.rounded-checkbox-ui').first()"),
            previousSiblings: [{ tag: 'input', type: 'text', id: '639978',
              relationship: 'previous-sibling', depth: 1 }] } as any,
          INPUT('page.locator(\'[id="639978"]\')')]) === 'click,check');

  // G - no evidence at all means nothing is collapsed. Every older recording.
  check('G: with no evidence the action stream is untouched',
      parseRecording(script(CLICK, 'await page.locator(\'[id="639978"]\').check();'),
          { startUrl: '', browser: '', durationMs: 0 })
          .actions.map(a => a.type).join(',') === 'click,check');

  // H/I - assertions and picker actions are not the collapse's business.
  const withAssertion = parse([CLICK,
    "await expect(page.locator('#banner')).toBeVisible();",
    'await page.locator(\'[id="639978"]\').check();'],
  [SPAN("page.locator('.rounded-checkbox-ui').first()"), INPUT('page.locator(\'[id="639978"]\')')]);
  // An assertion is not an action, so it does not separate the pair - and it must
  // not, because it is not evidence of a second human interaction. What matters is
  // that the assertion SURVIVES and still lands where it was made.
  check('H: an assertion between them is kept, and the pair still collapses',
      withAssertion.actions.map(a => a.type).join(',') === 'click'
      && withAssertion.assertions.length === 1,
      `${withAssertion.actions.map(a => a.type).join(',')} + ${withAssertion.assertions.length} assertion(s)`);
  check('H: and it is still positioned after the click it followed',
      withAssertion.assertions[0].afterActions === 1,
      String(withAssertion.assertions[0].afterActions));
  check('H: no assertion is ever removed by the collapse',
      parse([CLICK, "await expect(page.locator('#a')).toBeVisible();",
        "await expect(page.locator('#b')).toBeHidden();",
        'await page.locator(\'[id="639978"]\').check();'],
      [SPAN("page.locator('.rounded-checkbox-ui').first()"),
        INPUT('page.locator(\'[id="639978"]\')')]).assertions.length === 2);

  // A picker click is dropped before adjacency is judged - it was never an
  // application action to begin with.
  check('I: a picker action between them is dropped and the pair still collapses',
      types([CLICK, "await page.locator('ba-aura-assert').click();",
        'await page.locator(\'[id="639978"]\').check();'],
      [SPAN("page.locator('.rounded-checkbox-ui').first()"),
        INPUT('page.locator(\'[id="639978"]\')')]) === 'click');
  check('I: and no picker action survives the parse',
      !JSON.stringify(parse([CLICK, "await page.locator('ba-aura-assert').click();"],
          [SPAN("page.locator('.rounded-checkbox-ui').first()")]).actions)
          .includes('ba-aura-assert'));
}

/* --------------------------------------------- 7-14: the positional upgrade */

const proven = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'container-text',
  expression: 'page.locator(".tabulator-row").filter({ hasText: "Line Chart" }).locator(".rounded-checkbox-ui")',
  matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press', ...over,
});

const verdictFor = (locator: string, candidates: CandidateMeasurement[]) => assessLocator({
  locator, target: 'checkbox', kind: 'action',
  evidence: { ...SPAN(locator), derivedCandidates: candidates } as any,
});

function checkPositional(): void {
  process.stdout.write('\n== 7-14 — a positional locator may be upgraded, never rejected ==\n');

  check('7: .first() with a proven candidate is replaced',
      verdictFor("page.locator('.rounded-checkbox-ui').first()", [proven()]).expression
        === proven().expression);
  check('7: under the existing resolution name',
      verdictFor("page.locator('.rounded-checkbox-ui').first()", [proven()]).strategy
        === 'disambiguated-by-clicked-target');
  check('11: .nth() is positional too',
      isPositionalLocator("page.getByRole('button').nth(1)")
      && isPositionalLocator("page.locator('.x').first()")
      && !isPositionalLocator("page.getByRole('button', { name: 'Save' })"));
  check('11: and .nth() is upgraded the same way',
      verdictFor("page.getByRole('button', { name: 'Icon' }).nth(1)", [proven()]).expression
        === proven().expression);

  // 8-10 - the bar is the existing one, unchanged.
  for (const [label, over] of [
    ['8: identity false', { identityMatched: false }],
    ['9: another document', { sameDocument: false }],
    ['10: several matches', { matchCount: 4 }],
    ['8: claim-time', { measuredAt: 'claim' as const }],
  ] as Array<[string, Partial<CandidateMeasurement>]>) {
    const verdict = verdictFor("page.locator('.rounded-checkbox-ui').first()", [proven(over)]);
    // The BAR is unchanged - each of these still fails P0.7 and still may not be
    // promoted. What changed is what happens next: the position used to be emitted
    // as a last resort, and is now refused, because "several matched and Playwright
    // took the first" is not an identity however honestly it is labelled. Nothing is
    // stripped: the chain is not rewritten, it is simply not used.
    check(`${label} is refused, and the position is not emitted either`,
        verdict.outcome === 'NEEDS_REVIEW' && verdict.expression === null,
        `${verdict.outcome} | ${String(verdict.expression)}`);
  }

  // THE safety rule, restated: nothing is ever rewritten to make it pass. A locator
  // with no proven candidate is refused whole - the `.first()` is not removed, no
  // other index is substituted, and no sibling is guessed at.
  const bare = verdictFor("page.locator('.rounded-checkbox-ui').first()", []);
  check('12: a positional locator with nothing proven is refused, not rewritten',
      bare.outcome === 'NEEDS_REVIEW' && bare.expression === null,
      `${bare.outcome} | ${String(bare.expression)}`);
  check('12: a unique non-positional locator is unaffected by any of this',
      assessLocator({ locator: "page.getByRole('button', { name: 'Save' })", target: 'Save',
        kind: 'action', evidence: { ...SPAN("page.getByRole('button', { name: 'Save' })"),
          derivedCandidates: [proven()] } as any }).expression
        === "page.getByRole('button', { name: 'Save' })");

  check('13: nothing emitted carries a generated numeric id',
      !verdictFor("page.locator('.rounded-checkbox-ui').first()", [proven()])
          .expression!.includes('639978'));
  check('14: and the emitted contextual locator carries no first()/nth()',
      !/\.first\(\)|\.nth\(/.test(
          verdictFor("page.locator('.rounded-checkbox-ui').first()", [proven()]).expression!));
  check('14: nor XPath, force, or anything positional',
      !/xpath|\/\/|::|force:/.test(
          verdictFor("page.locator('.rounded-checkbox-ui').first()", [proven()]).expression!));
}

/* ------------------------------------- 1, 15-19: the real case, end to end */

function checkRealCase(): void {
  process.stdout.write('\n== 1, 15-19 — TC_DASHBOARD_011 end to end ==\n');
  const id = 'TC_DASHBOARD_011';
  const file = path.resolve(ROOT, `ai/dashboard/recordings/${id}.spec.ts`);
  if (!fs.existsSync(file)) {
    check('1: the TC_DASHBOARD_011 recording is present', false, file);
    return;
  }
  const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
    startUrl: '', browser: '', durationMs: 0,
    evidence: readEvidence(id), stateAssertions: readAssertions(id),
  });
  const kinds = recording.actions.map(action => action.type).join(',');
  check('1: the six recorded actions become three clicks plus the sign-in',
      kinds === 'navigate,fill,click,fill,click,click,click,click,click', kinds);
  check('1: no check or uncheck survives',
      !recording.actions.some(action => action.type === 'check' || action.type === 'uncheck'));
  check('1: and nothing named "done" is left anywhere',
      !JSON.stringify(recording.actions).includes('done'));

  const code = mapRecording(recording).steps.flatMap(step => step.code).join('\n');

  // 7 - THE ROW IS ADDRESSED BY ITS OWN TEXT, wherever that expression now lives.
  //
  // This used to match the inline chain in the emitted code. The abstraction engine
  // has since wrapped it in `IssuesPage.issueCheckbox(description)`, so the inline
  // form is gone and the property it stood for is stronger, not weaker: one
  // definition instead of one per click. Either shape satisfies it - what must not
  // appear is a generated id or a position, which checks 13 and 14 pin separately.
  const inline = (code.match(
      /\.filter\(\{ hasText: "Line Chart[^"]*" \}\)\.locator\("\.rounded-checkbox-ui"\)/g) ?? []).length;
  const viaMethod = (code.match(/\.issueCheckbox\(['"]Line Chart[^'"]*['"]\)/g) ?? []).length;
  check('7: the checkbox clicks are addressed by the row text, inline or via a Page Object',
      inline + viaMethod === 2, `${inline} inline + ${viaMethod} via method`);
  check('7: and the method they call resolves the row contextually',
      viaMethod === 0 || /hasText: description/.test(
          fs.readFileSync(path.resolve(ROOT, 'tests-e2e/pages/issues.page.ts'), 'utf8')
              .split('issueCheckbox(description: string)')[1]?.slice(0, 220) ?? ''));
  check('7: and no generated row id is emitted either way',
      !/tr_\d|\[id="\d+"\]/.test(code),
      code.split('\n').filter(l => /tr_\d|\[id="\d+"\]/.test(l)).join(' | ').slice(0, 120) || 'none');
  check('14: and no emitted action uses first()/nth()',
      !/\.first\(\)|\.nth\(/.test(code),
      code.split('\n').filter(l => /\.first\(\)|\.nth\(/.test(l)).join(' | ') || 'none');

  // 15 - the assertions are exactly what they were, on the input, not the span.
  check('15: both assertions survive untouched, on .bugChecked',
      recording.assertions.length === 2
      && recording.assertions.every(a => a.locator.includes('.bugChecked')),
      recording.assertions.map(a => `${a.expected}`).join(','));
  check('15: with their polarity intact and in order',
      recording.assertions[0].expected === true && recording.assertions[1].expected === false);
  check('15: re-based onto the shortened action stream',
      recording.assertions[0].afterActions === 7 && recording.assertions[1].afterActions === 8,
      recording.assertions.map(a => a.afterActions).join(','));
  check('15: toBeChecked and not.toBeChecked are both emitted',
      (code.match(/toBeChecked\(\)/g) ?? []).length === 2
      && (code.match(/\.not\.toBeChecked\(\)/g) ?? []).length === 1);

  // 16 - picker actions.
  check('16: no picker action survives', !code.includes('ba-aura-assert'));

  // 17-19 - the neighbours.
  const positional = fs.readdirSync(path.resolve(ROOT, 'ai/dashboard/recordings'))
      .filter(name => name.endsWith('.evidence.json'));
  let upgraded = 0;
  let untouched = 0;
  // DERIVED FROM THE CORPUS, NOT HARD-CODED.
  //
  // This block scans the live recordings directory, so any number written here is a
  // number that goes stale the next time somebody records. It did: the count was 3
  // until TC_DASHBOARD_020 was recorded, and the fixture then failed for a reason
  // that had nothing to do with the code it guards.
  //
  // What actually matters is the INVARIANT - every positional target that carries
  // press-time proof is upgraded, and none is left behind - so that is what is
  // counted, from the same data on both sides.
  let provenPositional = 0;
  /** Positional targets whose only proof is a MEASURED INDEX, not a unique expression. */
  let positionRecovered = 0;
  const positionMisrouted: string[] = [];
  const upgradedSelectors: string[] = [];
  for (const name of positional) {
    const evidence = JSON.parse(fs.readFileSync(
        path.resolve(ROOT, 'ai/dashboard/recordings', name), 'utf8'));
    for (const target of evidence.targets ?? []) {
      if (!isPositionalLocator(target.locator))
        continue;
      const verdict = assessLocator({ locator: target.locator, target: 'x', kind: 'action',
        evidence: target });
      if ((target.derivedCandidates ?? []).some(isProvenAgainstClickedTarget)) {
        provenPositional += 1;
        if (verdict.strategy === 'disambiguated-by-clicked-target') {
          upgraded += 1;
          upgradedSelectors.push(target.locator);
        }
      } else if ((target.positionProvenCandidates ?? [])
          .some(isPositionProvenAgainstClickedTarget)) {
        // A THIRD ANSWER, and the corpus grew one. No candidate identified this element
        // on its own, but the browser recorded WHICH of several matches was pressed, so
        // evidence-backed positional recovery applies. It is not "untouched" and it is
        // not a refusal - counted separately, and required to be exactly that.
        positionRecovered += 1;
        if (verdict.strategy !== 'evidence-backed-position'
            || !/\.nth\(\d+\)$/.test(String(verdict.expression ?? '')))
          positionMisrouted.push(`${name}: ${verdict.strategy} ${verdict.expression}`);
      } else {
        untouched += verdict.outcome !== 'NEEDS_REVIEW' ? 1 : 0;
      }
    }
  }
  check('17-19: every positional target WITH proof is upgraded, and none is missed',
      upgraded === provenPositional && provenPositional > 0,
      `${upgraded} upgraded of ${provenPositional} proven`);

  // AND NONE OF THEM CAME FROM THE COMPOUND-SELECTOR PATH.
  //
  // `claimParkedEntry` learned to decompose compound CSS selectors so an action could
  // claim its own press. That must not quietly promote anything here: every upgrade in
  // this corpus is a bare `.class`/`#id` positional, which took the same branch before
  // the change as after it. If a compound selector ever appears in this list, the
  // decomposition has changed which presses are claimed and that needs a person.
  const bare = upgradedSelectors.every(locator => {
    const argument = /locator\((['"])(.*?)\1\)/.exec(locator)?.[2] ?? '';
    return /^[#.][A-Za-z0-9_-]+$/.test(argument);
  });
  check('17-19: and every upgrade is a bare class/id, not a decomposed compound selector',
      bare, upgradedSelectors.map(s => s.slice(0, 46)).join(' | ') || 'none');
  check('17-19: a positional target proven only by a measured INDEX takes that route',
      positionMisrouted.length === 0, positionMisrouted.join(' | ') || `${positionRecovered} recovered`);
  check('17-19: and every positional target with NO proof at all is refused, never emitted',
      untouched === 0, `${untouched} still emitted rather than sent to review`);
}

function main(): void {
  checkCollapse();
  checkPositional();
  checkRealCase();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
