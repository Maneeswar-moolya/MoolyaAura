import '../testing/isolated-checkout';
/**
 * An unmeasured locator is not a locator. TC_LOGIN_096's regression.
 *
 *   npx tsx ai/autocode/strict-mode-locator.fixture.ts
 *
 * THE PRODUCTION FAILURE. TC_LOGIN_096 asserted:
 *
 *   await expect(page.getByText("Projects")).toBeVisible();
 *
 * and Playwright refused it at run time - `strict mode violation: resolved to 3
 * elements`. Nothing in the pipeline had been WRONG about that locator; nothing had
 * MEASURED it. The assertion picker recorded a text locator with no DOM capture, so
 * there was no evidence row for it at all, and the offline scorer rates `getByText`
 * at 75 - above a stable id - so it was emitted as "stable" on its shape alone.
 *
 * A bare, unscoped text locator is the one shape whose uniqueness is unknowable
 * without a measurement: every container holding the string matches it as well as the
 * element that owns it, which is how "Projects" found three. Every other shape here is
 * judged on structure that constrains it - an id, a role and a name, a scope.
 *
 * WHAT THIS FILE PINS is that the refusal is about the MEASUREMENT, not the shape:
 * the same locator is accepted when the browser counted one and refused when it
 * counted more or counted nothing. And that the refusal is never converted into a
 * position - `.first()` would have made TC_LOGIN_096 pass while asserting against
 * whichever of the three came first.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as path from 'path';

import { assessLocator, isUnscopedStructuralLocator, isUnscopedTextLocator } from './locator-quality';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording, pageObjectRequirements, readAssertions, readEvidence } from './from-recording';
import { isDomEvidence } from './dom-evidence';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** Evidence carrying a press-time text measurement, and optionally proven candidates. */
const withText = (text: string, matchCount: number, over: Record<string, unknown> = {}) => ({
  locator: `page.getByText('${text}')`,
  target: { tag: 'span', text },
  ancestors: [],
  pressTimeText: { text, matchCount, identityMatched: true },
  derivedCandidates: [],
  ...over,
}) as never;

const judge = (locator: string, evidence?: unknown) => assessLocator({
  locator, target: 'Projects', kind: 'assertion', context: {} as never,
  evidence: evidence as never,
});

/* --------------------------------------------- the failure, and its refusal ---- */

function checkTheFailure(): void {
  process.stdout.write('\n== getByText("Projects"): three elements, no measurement ==\n');

  // EXACTLY THE PRODUCTION CASE: no evidence row, so nothing counted it.
  const unmeasured = judge('page.getByText("Projects")');
  check('an unmeasured bare text locator is refused',
      unmeasured.outcome === 'NEEDS_REVIEW', unmeasured.outcome);
  check('and no expression is emitted for it',
      unmeasured.expression === null, String(unmeasured.expression));
  check('and it is marked ambiguous rather than stable',
      unmeasured.ambiguous && unmeasured.classification === 'suspicious',
      `${unmeasured.classification} ambiguous=${unmeasured.ambiguous}`);
  check('and the reason says nothing measured it',
      /never measured|identified \d+ elements/.test(unmeasured.reason), unmeasured.reason.slice(0, 76));

  // The same locator, measured at three: refused, and the count is named.
  const three = judge('page.getByText("Projects")', withText('Projects', 3));
  check('measured at 3 elements -> refused', three.outcome === 'NEEDS_REVIEW', three.outcome);
  check('and the refusal states the count', /3 elements/.test(three.reason), three.reason.slice(0, 72));

  // Measured at one: accepted. The rule is about the measurement, not the shape.
  const one = judge('page.getByText("Projects")', withText('Projects', 1));
  check('measured at exactly 1 -> accepted',
      one.outcome !== 'NEEDS_REVIEW', `${one.outcome} / ${one.classification}`);

  // Two is still two.
  check('measured at 2 -> refused',
      judge('page.getByText("Projects")', withText('Projects', 2)).outcome === 'NEEDS_REVIEW');
}

/* ------------------------------------------- what must NOT become the answer ---- */

function checkNoPositionalEscape(): void {
  process.stdout.write('\n== ambiguity is never converted into a position ==\n');

  for (const locator of [
    'page.getByText("Projects").first()',
    'page.getByText("Projects").nth(1)',
    'page.getByText("Projects").last()',
  ]) {
    const verdict = judge(locator, withText('Projects', 3));
    check(`${locator.slice(24)} is not accepted as the fix`,
        verdict.outcome === 'NEEDS_REVIEW' || verdict.ambiguous,
        `${verdict.outcome} ambiguous=${verdict.ambiguous}`);
  }

  // And nothing the gate emits ever contains one.
  const verdict = judge('page.getByText("Projects")');
  check('the refusal emits no positional expression',
      !/\.first\(|\.nth\(|\.last\(/.test(verdict.expression ?? ''));
}

/* ------------------------------------------ identity, not merely a count of 1 ---- */

function checkIdentity(): void {
  process.stdout.write('\n== a count of one is not the same as the right element ==\n');

  // A proven candidate is only proof when it IS this locator and identity was checked.
  const wrongElement = judge('page.getByText("Projects")', withText('Projects', 0, {
    pressTimeText: undefined,
    derivedCandidates: [{
      strategy: 'text', expression: 'page.getByText("Projects")', matchCount: 1,
      identityMatched: false, sameDocument: true, measuredAt: 'press',
    }],
  }));
  check('count 1 with identityMatched false -> refused',
      wrongElement.outcome === 'NEEDS_REVIEW', wrongElement.outcome);

  for (const [label, over] of [
    ['measured at claim time', { measuredAt: 'claim' }],
    ['identity unstated', { identityMatched: undefined }],
    ['a different document', { sameDocument: false }],
  ] as Array<[string, Record<string, unknown>]>) {
    const verdict = judge('page.getByText("Projects")', withText('Projects', 0, {
      pressTimeText: undefined,
      derivedCandidates: [{
        strategy: 'text', expression: 'page.getByText("Projects")', matchCount: 1,
        identityMatched: true, sameDocument: true, measuredAt: 'press', ...over,
      }],
    }));
    check(`count 1 but ${label} -> refused`, verdict.outcome === 'NEEDS_REVIEW', verdict.outcome);
  }

  // The proof that IS accepted: this very expression, press-time, identity checked.
  const good = judge('page.getByText("Projects")', withText('Projects', 0, {
    pressTimeText: undefined,
    derivedCandidates: [{
      strategy: 'text', expression: 'page.getByText("Projects")', matchCount: 1,
      identityMatched: true, sameDocument: true, measuredAt: 'press',
    }],
  }));
  check('a proven candidate for this exact expression -> accepted',
      good.outcome !== 'NEEDS_REVIEW', good.outcome);
}

/* ------------------------------------------------- only this shape is affected ---- */

function checkScopeOfTheRule(): void {
  process.stdout.write('\n== the gate touches one shape and no other ==\n');

  check('a bare getByText is the shape', isUnscopedTextLocator('page.getByText("Projects")'));
  for (const other of [
    "page.getByRole('link', { name: 'Projects' })",
    "page.locator('#all_apps').getByText('Projects')",
    "page.locator('.tabulator-row').filter({ hasText: 'Projects' }).locator('.bugChecked')",
    "page.locator('#record_search')",
    "page.getByLabel('Projects')",
  ])
    check(`not the shape: ${other.slice(0, 52)}`, !isUnscopedTextLocator(other));

  // A role+name locator with no evidence is NOT refused by this gate: its structure
  // constrains it, which is exactly the difference the rule turns on.
  const role = judge("page.getByRole('link', { name: 'Projects' })");
  check('an unmeasured role+name locator is left alone by this gate',
      role.outcome !== 'NEEDS_REVIEW' || !/never measured/.test(role.reason),
      `${role.outcome}`);
}

/* -------------------------------------------- the real recording, end to end ---- */

function checkRealRecording(): void {
  const recording = parseRecording("import { test, expect } from '@playwright/test';\ntest('synthetic ambiguity', async ({ page }) => {\n  await expect(page.getByText('Projects')).toBeVisible();\n});", {
    startUrl: '', browser: '', durationMs: 0 });
  const mapping = mapRecording(recording);
  check('unmeasured bare text is refused through the assembler', mapping.steps.length === 1 && mapping.steps[0].kind === 'needs-review');
  check('no ambiguous text locator reaches emitted code', !mapping.steps.flatMap(s => s.code).join('').includes('getByText'));
  check('a safety refusal is not misreported as missing Page Object knowledge', pageObjectRequirements(mapping).length === 0);
}


/* ----------------------------------------- existing reuse must be untouched ---- */

function checkExistingReuse(): void {
  process.stdout.write('\n== the capabilities that already worked still work ==\n');

  const methodsIn = (id: string): string[] => {
    const file = path.join(RECORDINGS(), `${id}.spec.ts`);
    if (!fs.existsSync(file))
      return [];
    const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
      startUrl: '', browser: '', durationMs: 0,
      evidence: readEvidence(id), stateAssertions: readAssertions(id) });
    return mapRecording(recording).steps
        .filter(step => step.kind === 'page-object')
        .map(step => `${step.pageObject}.${step.method}`);
  };

  const ninetyOne = methodsIn('TC_SEARCH');
  check('TC_SEARCH still reuses searchField three times',
      ninetyOne.filter(name => name === 'IssuesPage.searchField').length === 3,
      ninetyOne.join(', '));
  const ninetyTwo = methodsIn('TC_ROW_A');
  check('TC_ROW_A still reuses issueCheckbox',
      ninetyTwo.includes('IssuesPage.issueCheckbox'), ninetyTwo.join(', '));
  check('TC_ROW_A still reuses issueCheckboxState',
      ninetyTwo.includes('IssuesPage.issueCheckboxState'));

  // A measured-unique bare text locator is still emitted: the gate is about the
  // measurement, and removing these would be the over-correction.
  const eight = methodsIn('TC_ROW_A');
  check('a recording whose text WAS measured at one still maps',
      eight.length > 0, `${eight.length} page-object step(s)`);
}

/* ------------- the structural twin: TC_LOGIN_128's bare h2 (cases A-J) ---- */

/**
 * THE SAME FAILURE ONE SHAPE OVER, and the same refusal.
 *
 * TC_LOGIN_128 asserted `expect(page.locator('h2')).toContainText('All Projects')` -
 * written by Codegen into the recorded script, so it never passed the assertion picker
 * and carries no provenance. `captureFor` measured it AFTER the action:
 * `matchCount: 1`, `matchCountDocument: 'unknown'`, identity never asked. That count of
 * one suppressed `measuredAmbiguity`, no replacement was sought, and the offline scorer
 * emitted the bare tag. The live page has three `h2`s.
 *
 * One in a document nobody can name is not one in the document that mattered - the
 * distinction `measuredZero` already makes for a count of zero. These checks pin that
 * the refusal is about the ATTRIBUTABILITY of the measurement and about the SHAPE, and
 * that neither part reaches a locator the recording actually constrained.
 */
function checkStructuralGate(): void {
  process.stdout.write('\n== the structural twin: an unattributable bare selector ==\n');

  const afterAction = (locator: string, over: Record<string, unknown> = {}) => ({
    locator,
    target: { tag: 'h2', stableClasses: ['u-entity-title'], text: 'All Projects' },
    ancestors: [], derivedCandidates: [],
    captureTiming: 'after-action',
    matchCount: 1, matchCountDocument: 'unknown',
    ...over,
  }) as never;

  // A: the real shape - one count, taken where nothing can attribute it.
  const bare = judge("page.locator('h2')", afterAction("page.locator('h2')"));
  check('A: a bare tag with an unattributable count of one is refused',
      bare.outcome === 'NEEDS_REVIEW' && bare.strategy === 'structural', `${bare.outcome}/${bare.strategy}`);
  check('A: and no locator is emitted for it', bare.expression === null, String(bare.expression));
  check('A: the reason says the count could not be attributed, not that it was wrong',
      /cannot be attributed|after the fact/.test(bare.reason), bare.reason.slice(0, 90));

  // B: counted at three - refused by the ambiguity rule, as it always was.
  const three = judge("page.locator('h2')",
      afterAction("page.locator('h2')", { matchCount: 3, matchCountDocument: 'same' }));
  check('B: the same locator counted at three is still refused',
      three.outcome === 'NEEDS_REVIEW', `${three.outcome}/${three.strategy}`);
  check('B: by the measured-ambiguity rule, which is untouched',
      three.strategy === 'measured-ambiguous', String(three.strategy));

  // C: an ATTRIBUTABLE count of one - measured in the interaction's own document.
  const attributable = judge("page.locator('.add-invite-user')",
      afterAction("page.locator('.add-invite-user')",
        { matchCount: 1, matchCountDocument: 'same', captureTiming: 'before-action' }));
  check('C: an attributable count of one is accepted exactly as before',
      attributable.outcome !== 'NEEDS_REVIEW' && attributable.expression === "page.locator('.add-invite-user')",
      `${attributable.outcome} ${attributable.expression}`);

  // D: a proven candidate whose expression IS this locator.
  const proven = judge("page.locator('.add-invite-user')", afterAction("page.locator('.add-invite-user')", {
    matchCountDocument: 'unknown',
    derivedCandidates: [{
      strategy: 'class', expression: "page.locator('.add-invite-user')", matchCount: 1,
      identityMatched: true, sameDocument: true, measuredAt: 'press',
    }],
  }));
  check('D: a press-proven candidate for the same expression is accepted',
      proven.expression === "page.locator('.add-invite-user')", `${proven.outcome} ${proven.expression}`);

  // E-G: shapes the recording CONSTRAINED are outside the rule entirely.
  const constrained: Array<[string, string]> = [
    ['a stable authored id', "page.locator('#create_team_invite_form')"],
    ['an attribute selector', "page.locator('[data-team-name]')"],
    ['a scoped descendant', "page.locator('#apps_tab_container h2')"],
    ['a role and name', "page.getByRole('heading', { name: 'All Projects' })"],
    ['a chained scope', "page.locator('#apps_tab_container').locator('h2')"],
  ];
  for (const [why, locator] of constrained) {
    check(`E-G: ${why} is not touched by the structural rule`,
        !isUnscopedStructuralLocator(locator), locator);
    const verdict = judge(locator, afterAction(locator));
    check(`E-G: ...and is still emitted from the same evidence - ${why}`,
        verdict.expression === locator, `${verdict.outcome} ${verdict.expression}`);
  }

  // The shape test itself, in both directions.
  for (const unsafe of ["page.locator('h2')", "page.locator('body')", "page.locator('.veil')",
    "page.locator('h2.u-entity-title')", "page.locator('.a.b')"])
    check(`the shape test catches ${unsafe}`, isUnscopedStructuralLocator(unsafe));
  for (const safe of ["page.locator('#id')", "page.locator('.row .cell')", "page.locator('h2 > span')",
    "page.getByText('x')", "page.locator('.row').filter({ hasText: 'x' }).locator('.cell')"])
    check(`the shape test leaves ${safe} alone`, !isUnscopedStructuralLocator(safe));

  // I: the REAL recording. Nothing may emit a bare h2 for TC_LOGIN_128.
  const file = path.join(RECORDINGS(), 'TC_LOGIN_128.evidence.json');
  if (fs.existsSync(file)) {
    const evidence = JSON.parse(fs.readFileSync(file, 'utf8')) as { targets?: Array<Record<string, unknown>> };
    const h2 = (evidence.targets ?? []).find(target => String(target.locator) === "page.locator('h2')");
    check('I: TC_LOGIN_128 carries the after-action h2 capture', Boolean(h2),
        `${(evidence.targets ?? []).length} target(s)`);
    if (h2) {
      check('I: its count is one, and unattributable - the state that caused the failure',
          h2.matchCount === 1 && h2.matchCountDocument === 'unknown',
          `${h2.matchCount}/${h2.matchCountDocument}`);
      check('I: it has no elementRef, so no provenance join is possible',
          !h2.elementRef && !h2.captureRef);
      const real = judge("page.locator('h2')", h2);
      check('I: and the engine now refuses it rather than emitting it',
          real.outcome === 'NEEDS_REVIEW' && real.expression === null,
          `${real.outcome} ${real.expression}`);
      check('I: none of its claim-time candidates is promoted in its place',
          real.expression === null);
    }
  }
}

function main(): void {
  checkTheFailure();
  checkNoPositionalEscape();
  checkIdentity();
  checkScopeOfTheRule();
  checkRealRecording();
  checkExistingReuse();
  checkStructuralGate();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
