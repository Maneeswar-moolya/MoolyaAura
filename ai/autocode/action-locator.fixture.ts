import '../testing/isolated-checkout';
import { syntheticLoginEvidence, targetEvidence } from '../testing/synthetic-data';
/**
 * What locator a recorded ACTION gets, and when a dynamic scope may be dropped.
 *
 *   npx tsx ai/autocode/action-locator.fixture.ts
 *
 * Two rules are pinned here, and they were learned the hard way from TC_LOGIN_042.
 *
 * P0   The action branch must emit the locator the RESOLVER chose. It used to emit
 *      `action.locator` while the assertion branch already used `quality.expression`,
 *      so a locator the engine had rejected went into the spec anyway.
 *
 * P0.1 A dynamic scope may only be dropped when the replacement is PROVEN unique.
 *      Dropping `#tc_summary_638717` left `getByText('Line Chart | Time Config Page')`,
 *      which the application renders twice - once for mobile (`visible-xs`), once for
 *      desktop (`hidden-xs`) - so the "safer" locator matched two elements and could
 *      never be clicked. The id had been doing the disambiguation. Without measured
 *      evidence the answer is NEEDS_REVIEW, not a guess.
 *
 * Priority under test: Page Object > measured candidate > recorded locator > review.
 */

import fs from 'node:fs';
import path from 'node:path';

import { sanitiseEvidence, type TargetEvidence } from './dom-evidence';
import { mapRecording } from './from-recording';
import { parseRecording } from '../dashboard/recorder';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const SIGN_IN = `  await page.goto('https://portal.fixture.invalid/'); // @aura-navigation intentional
  await page.getByRole('textbox', { name: 'Email' }).fill('someone@moolya.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('[type=password]');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
`;

const wrap = (body: string) => `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
${SIGN_IN}${body}});`;

function mapped(script: string, evidence?: TargetEvidence[]) {
  return mapRecording(parseRecording(script, {
    startUrl: '', browser: '', durationMs: 0,
    evidence: syntheticLoginEvidence([targetEvidence("page.locator('#project_banner')"), ...(evidence ?? [])]),
  }));
}

function emitted(script: string, evidence?: TargetEvidence[]): Map<string, string> {
  const byStep = new Map<string, string>();
  for (const step of mapped(script, evidence).steps)
    byStep.set(step.from, step.code.join(' '));
  return byStep;
}

const DYNAMIC_CLICK = wrap(
    `  await page.locator('#tc_summary_638717').getByText('Line Chart | Time Config Page').click();\n`);

/**
 * The graph as MEASURED live on FixturePortal during the TC_LOGIN_042 diagnosis.
 *
 * The target is an unclassed <span>; what distinguishes the desktop copy from the
 * mobile one is its PARENT's responsive classes, inside `#bugReport-table`. The unique
 * candidate is derived from that structure by `candidateSelectorsFor` - it is not
 * written into the resolver.
 */
function measuredEvidence(overrides: Partial<TargetEvidence> = {}): TargetEvidence {
  return {
    locator: "page.locator('#tc_summary_638717').getByText('Line Chart | Time Config Page')",
    target: { tag: 'span', text: 'Line Chart | Time Config Page: Note, under Periodicity Field' },
    parent: { tag: 'div', id: 'tc_update_summary_638717',
      stableClasses: ['bug-report__summary--text', 'hidden-xs'] },
    ancestors: [
      { tag: 'div', id: 'tr_638717', relationship: 'ancestor', depth: 2 },
      { tag: 'div', id: 'bugReport-table', relationship: 'ancestor', depth: 3 },
    ],
    children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: ['parent', 'ancestor'], matchCount: 1,
    identifier: { raw: 'tc_summary_638717', dynamic: true, normalised: 'tc_summary_<dynamic>' },
    derivedCandidates: [
      { strategy: 'scoped-parent-class-pair',
        expression: 'page.locator("#bugReport-table .bug-report__summary--text.hidden-xs")',
        matchCount: 1 },
      { strategy: 'parent-class', expression: 'page.locator(".bug-report__summary--text")', matchCount: 26 },
    ],
    ...overrides,
  };
}

function main(): void {
  process.stdout.write('\n== CASE 1 — dynamic id, NO evidence: nothing is emitted ==\n');
  const offline = mapped(DYNAMIC_CLICK);
  check('1: the step needs review',
      offline.needsReview.some(step => step.from === 'click Line Chart | Time Config Page'),
      offline.needsReview.map(s => s.from).join(', ') || '(none)');
  const offlineCode = offline.steps.filter(step => step.kind !== 'needs-review')
      .map(step => step.code.join(' ')).join('\n');
  check('1: the generated id is NOT emitted', !offlineCode.includes('tc_summary_638717'));
  check('1: and no ambiguous text-only locator is emitted either',
      !offlineCode.includes("getByText('Line Chart | Time Config Page')"));
  const reason = offline.needsReview[0]?.why ?? '';
  check('1: the reason says uniqueness was not proven',
      /match exactly one element/.test(reason), reason.slice(0, 110));
  check('1: and points at the live transport', /RECORDER_TRANSPORT=live/.test(reason));

  process.stdout.write('\n== CASE 1b — dynamic id WITH a measured unique candidate ==\n');
  const resolved = emitted(DYNAMIC_CLICK, [measuredEvidence()])
      .get('click Line Chart | Time Config Page') ?? '';
  check('1b: the measured unique candidate is emitted',
      resolved.includes('#bugReport-table .bug-report__summary--text.hidden-xs'), resolved);
  check('1b: the generated id is not emitted', !resolved.includes('tc_summary_638717'));
  check('1b: the 26-match candidate is not emitted',
      !resolved.includes('page.locator(".bug-report__summary--text")'));
  check('1b: it is still a click', /\.click\(\);$/.test(resolved.trim()), resolved);
  check('1b: no first()/nth()/force introduced', !/first\(\)|nth\(|force/.test(resolved));

  process.stdout.write('\n== CASE 2 — evidence exists but NO candidate is unique ==\n');
  const ambiguousOnly = mapped(DYNAMIC_CLICK, [measuredEvidence({
    derivedCandidates: [
      { strategy: 'parent-class', expression: 'page.locator(".bug-report__summary--text")', matchCount: 26 },
      { strategy: 'class', expression: 'page.locator(".summary")', matchCount: 2 },
    ],
  })]);
  check('2: still needs review',
      ambiguousOnly.needsReview.some(step => step.from === 'click Line Chart | Time Config Page'),
      ambiguousOnly.needsReview.map(s => s.from).join(', ') || '(none)');
  check('2: nothing ambiguous was emitted',
      !ambiguousOnly.steps.filter(s => s.kind !== 'needs-review')
          .some(s => s.code.join(' ').includes('summary')));

  process.stdout.write('\n== CASE 3 — a stable recorded locator is untouched ==\n');
  const stable = emitted(wrap(`  await page.locator('#project_banner').click();\n`));
  check('3: emitted verbatim',
      (stable.get('click #project_banner') ?? '').includes("page.locator('#project_banner')"),
      stable.get('click #project_banner'));
  const scoped = emitted(wrap(
      `  await page.locator('#response_modal_dialog').getByRole('button', { name: 'close' }).click();\n`));
  check('3: a stable SCOPE is never dropped',
      (scoped.get('click close') ?? '').includes('#response_modal_dialog'), scoped.get('click close'));

  process.stdout.write('\n== CASE 4 — Page Object still wins ==\n');
  const po = emitted(wrap(''));
  check('4: the recorded sign-in became the framework mechanism',
      [...po.values()].some(code => code.includes('loginPage.signIn(')));
  check('4: no raw sign-in locator was emitted',
      ![...po.values()].some(code => code.includes("getByRole('button', { name: 'Sign In'")));
  check('4: explicit navigation is retained',
      [...po.values()].some(code => code.includes('page.goto(')));

  process.stdout.write('\n== CASE 5 — no dynamic id, but text alone is still not identity ==\n');
  // This case used to assert that a recorded `getByText` stood untouched when no
  // dynamic id was involved. It no longer does, and the reason is not about dynamic
  // ids at all: an unscoped text locator whose uniqueness nothing measured is refused now - TC_LOGIN_096 shipped one and Playwright rejected it at run time, "resolved to 3 elements". What CASE 5 is for - that the dynamic-id rule does not fire here -
  // is unchanged and checked below.
  const text = emitted(wrap(`  await page.getByText('Faclon labs').click();\n`));
  check('5: an unscoped text locator is not emitted as identity',
      ![...text.values()].some(code => code.includes("getByText('Faclon labs')")),
      [...text.values()].join(' | ').slice(0, 80));
  check('5: and it was not refused for being a dynamic id',
      ![...text.values()].some(code => code.includes('tc_summary')))

  process.stdout.write('\n== CASE 6 — every verb uses the same measured candidate ==\n');
  const verbScript = wrap(
      `  await page.locator('#tc_summary_638717').getByText('Row One').click();\n`
    + `  await page.locator('#tc_summary_638717').getByRole('textbox', { name: 'Note' }).fill('hello');\n`);
  const verbs = emitted(verbScript, [
    measuredEvidence({ locator: "page.locator('#tc_summary_638717').getByText('Row One')",
      derivedCandidates: [{ strategy: 'scoped-parent-class', expression: 'page.locator("#bugReport-table .row-one")', matchCount: 1 }] }),
    measuredEvidence({ locator: "page.locator('#tc_summary_638717').getByRole('textbox', { name: 'Note' })",
      derivedCandidates: [{ strategy: 'scoped-parent-class', expression: 'page.locator("#bugReport-table .note-field")', matchCount: 1 }] }),
  ]);
  for (const [step, verb, selector] of [
    ['click Row One', 'click', '.row-one'],
    ['fill Note', 'fill', '.note-field'],
  ] as const) {
    const code = verbs.get(step) ?? '';
    check(`6: ${verb} uses the measured candidate`, code.includes(selector), code);
    check(`6: ${verb} drops the generated id`, code.length > 0 && !code.includes('tc_summary_638717'));
    check(`6: ${verb} keeps its own verb`, new RegExp(`\\.${verb}\\(`).test(code), code);
  }

  process.stdout.write('\n== CASE 7 — assertions follow the same rule ==\n');
  const assertion = emitted(wrap(
      `  await expect(page.locator('#project_banner')).toContainText('Multi tasking');\n`));
  check('7: a stable assertion is unchanged',
      assertion.get('assert contains #project_banner')
        === "await expect(page.locator('#project_banner')).toContainText('Multi tasking');",
      assertion.get('assert contains #project_banner'));
  const dynamicAssertion = mapped(wrap(
      `  await expect(page.locator('#tc_summary_638717')).toContainText('Line Chart');\n`));
  check('7: a dynamic assertion with no evidence needs review',
      dynamicAssertion.needsReview.some(step => step.from.includes('tc_summary_638717')));

  process.stdout.write('\n== CASE 8 — three synthetic dynamic scopes, offline ==\n');
  for (const id of ['tc_summary_900001', 'tc_summary_900002', 'tc_summary_900003']) {
    const result = mapped(wrap(`  await page.locator('#${id}').getByText('Line Chart').click();\n`));
    const code = result.steps.filter(step => step.kind !== 'needs-review')
        .map(step => step.code.join(' ')).join('\n');
    check(`8: ${id} emits no tc_summary id`, !/tc_summary_\d+/.test(code),
        (code.match(/tc_summary_\d+/) ?? ['clean'])[0]);
    check(`8: ${id} needs review rather than guessing`,
        result.needsReview.some(step => step.from.startsWith('click Line Chart')),
        result.needsReview.map(s => s.from).join(', ') || '(none)');
  }

  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
