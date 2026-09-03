/**
 * Two invariants, stated once and checked everywhere they can be broken.
 *
 *   npx tsx ai/autocode/locator-safety.fixture.ts
 *
 *   1. A GENERATED IDENTIFIER NEVER APPEARS IN AN EMITTED LOCATOR.
 *   2. A POSITION IS NEVER WHAT IDENTIFIES AN ELEMENT.
 *
 * Both were true of most shapes and false of one each, which is the way this kind of
 * rule fails: the check was written against the form the bug first appeared in.
 *
 * `#tr_637446` was refused; `#tr_637446 > .tabulator-cell > .rounded-checkbox-ui` was
 * not, because the test required the whole selector to BE an id - so a locator pinned
 * to one Bugasura issue scored as ordinary CSS and shipped. And `.first()` was
 * replaced by a proven contextual candidate where one existed, but emitted verbatim
 * where none did, so the pipeline refused to build a Page Object on a guess while
 * happily writing that guess into a spec.
 *
 * Neither fix removes anything from a recorded chain. A `.first()` is not stripped and
 * an id is not edited out: either an independently measured contextual candidate
 * identifies the element, or a person decides.
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  analyseIdentifier, assessLocator, chainHasDynamicIdentifier, dynamicIdentifiersIn,
  isPositionalLocator,
} from './locator-quality';
import type { CandidateMeasurement, DomNode, TargetEvidence } from './dom-evidence';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording, readAssertions, readEvidence } from './from-recording';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const CONTEXTUAL = 'page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line" })'
  + '.locator(".bugChecked")';

const proven = (expression = CONTEXTUAL): CandidateMeasurement => ({
  strategy: 'container-text', expression, matchCount: 1,
  identityMatched: true, sameDocument: true, measuredAt: 'press',
});

function evidence(candidates: CandidateMeasurement[] = [proven()]): TargetEvidence {
  return {
    locator: 'x', target: { tag: 'span' } as DomNode,
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1, captureTiming: 'before-action',
    derivedCandidates: candidates,
  } as TargetEvidence;
}

const assess = (locator: string, candidates?: CandidateMeasurement[]) =>
  assessLocator({
    locator, target: 'x', kind: 'action', context: [],
    evidence: candidates === undefined ? undefined : evidence(candidates),
  });

/* ------------------------------------------------- 1-5: the dynamic id ---- */

function checkDynamicIds(): void {
  process.stdout.write('\n== a generated id, wherever it is written ==\n');

  const shapes: Array<[string, string]> = [
    ['1: the whole selector', "page.locator('#tr_637446')"],
    ['2: a chained scope', "page.locator('#tr_637446').locator('.rounded-checkbox-ui')"],
    ['3: a compound child selector', "page.locator('#tr_637446 > .cell > .rounded-checkbox-ui')"],
    ['4: buried in a descendant chain', "page.locator('#foo .bar #tr_637446 .baz')"],
    ['4: an attribute selector', 'page.locator(\'[id="639978"]\')'],
    ['4: a compound attribute selector', 'page.locator(\'.cell [id="639978"] .ui\')'],
    ['4: two ids, one generated', "page.locator('#main-content #tc_summary_638717')"],
  ];
  for (const [label, locator] of shapes) {
    const outcome = assess(locator, []);
    check(`${label} -> refused`,
        outcome.outcome === 'NEEDS_REVIEW' && outcome.expression === null,
        `${outcome.outcome} / ${outcome.strategy}`);
    check(`${label} -> and the detector sees it`, chainHasDynamicIdentifier(locator));
  }

  // 5: the rule must not swallow authored ids.
  for (const stable of ['#total_issue_counts', '#notif_bell_trigger', '#loginForm', '#proj_name']) {
    check(`5: "${stable}" is still a stable id`,
        dynamicIdentifiersIn(stable).length === 0 && !analyseIdentifier(stable.slice(1)).dynamic);
  }
  const ok = assess("page.locator('#total_issue_counts')", []);
  check('5: and a stable id is still emitted',
      ok.outcome === 'STABLE_LOCATOR' && ok.expression === "page.locator('#total_issue_counts')",
      `${ok.outcome} / ${ok.strategy}`);
  const scoped = assess("page.locator('#loginForm .js-password-input')", []);
  check('5: a stable id inside a compound selector is untouched',
      scoped.expression === "page.locator('#loginForm .js-password-input')", scoped.outcome);

  // 6: the contextual candidate wins, and the id is gone.
  const upgraded = assess("page.locator('#tr_637446 > .cell > .rounded-checkbox-ui')", [proven()]);
  check('6: a proven contextual candidate replaces the id',
      upgraded.outcome === 'NORMALIZED_LOCATOR' && upgraded.expression === CONTEXTUAL,
      `${upgraded.outcome} / ${upgraded.strategy}`);
  check('6: and the id appears nowhere in what is emitted',
      !/tr_637446|639978/.test(upgraded.expression ?? ''), upgraded.expression ?? '');
}

/* ------------------------------------------------- 7-10: the position ---- */

function checkPositional(): void {
  process.stdout.write('\n== a position is not an identity ==\n');

  for (const [label, locator] of [
    ['7: .first() with proof', "page.locator('.rounded-checkbox-ui').first()"],
    ['9: .nth(2) with proof', "page.locator('.row').nth(2)"],
    ['.last() with proof', "page.locator('.row').last()"],
  ] as const) {
    const outcome = assess(locator, [proven()]);
    check(`${label} -> the contextual candidate wins`,
        outcome.outcome === 'NORMALIZED_LOCATOR' && outcome.expression === CONTEXTUAL,
        `${outcome.outcome} / ${outcome.strategy}`);
    check(`${label} -> and no position is emitted`,
        !/\.first\(|\.nth\(|\.last\(/.test(outcome.expression ?? ''));
  }

  for (const [label, locator] of [
    ['8: .first() with no proof', "page.locator('.rounded-checkbox-ui').first()"],
    ['10: .nth(2) with no proof', "page.locator('.row').nth(2)"],
  ] as const) {
    const measured = assess(locator, []);
    check(`${label} (measured, nothing proven) -> NEEDS_REVIEW`,
        measured.outcome === 'NEEDS_REVIEW' && measured.expression === null,
        `${measured.outcome} / ${measured.strategy}`);
    const offline = assess(locator);
    check(`${label} (no evidence at all) -> NEEDS_REVIEW`,
        offline.outcome === 'NEEDS_REVIEW' && offline.expression === null,
        `${offline.outcome} / ${offline.strategy}`);
  }

  // The position is never STRIPPED to make something pass, and never invented.
  const stripped = assess("page.locator('.rounded-checkbox-ui').first()", []);
  check('the chain is not rewritten without its position',
      stripped.expression === null, stripped.expression ?? 'null');
  check('isPositionalLocator recognises every form',
      ['.first()', '.nth(0)', '.last()'].every(suffix =>
        isPositionalLocator(`page.locator('.x')${suffix}`)));
  check('and does not fire on an ordinary chain',
      !isPositionalLocator("page.locator('.x').locator('.y')"));
}

/* ------------------------------------------------- 11-15: real recordings ---- */

function checkRecordings(): void {
  process.stdout.write('\n== the real recordings ==\n');
  const summary = new Map<string, { contextual: number; dynamic: number; positional: number;
    review: number; pageObject: number; }>();

  for (const id of ['TC_DASHBOARD_008', 'TC_DASHBOARD_011', 'TC_LOGIN_082', 'TC_LOGIN_083']) {
    const file = path.join(ROOT, 'ai', 'dashboard', 'recordings', `${id}.spec.ts`);
    if (!fs.existsSync(file))
      continue;
    const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
      startUrl: '', browser: '', durationMs: 0,
      evidence: readEvidence(id), stateAssertions: readAssertions(id),
    });
    const steps = mapRecording(recording).steps;
    const code = steps.map(step => step.code.join(' ')).join('\n');
    // CONTEXTUAL RESOLUTION, WHEREVER THE EXPRESSION NOW LIVES.
    //
    // Counting `hasText:` in the emitted code was only ever a proxy for "the row is
    // addressed by its own text rather than by an id or a position". Once the
    // abstraction engine wrapped that chain in `IssuesPage.issueCheckbox(description)`
    // the proxy read zero while the property it stood for was not merely intact but
    // strengthened - the expression is now in one place instead of four. So a
    // page-object step counts too, and only when the method it calls is itself
    // declared with a contextual locator.
    const contextualMethods = new Set(readAllPageKnowledge().flatMap(page => page.elements
        .filter(entry => /hasText:|\.filter\(/.test(entry.locator_strategy ?? ''))
        .map(entry => entry.page_object_method)
        .filter((name): name is string => Boolean(name))));
    const viaPageObject = steps.filter(step => step.kind === 'page-object'
      && step.method && contextualMethods.has(step.method)).length;

    summary.set(id, {
      contextual: (code.match(/hasText:/g) ?? []).length + viaPageObject,
      dynamic: (code.match(/tr_\d|\[id="\d+"\]|#\d{5,}/g) ?? []).length,
      positional: (code.match(/\.first\(|\.nth\(/g) ?? []).length,
      review: steps.filter(step => step.kind === 'needs-review').length,
      pageObject: steps.filter(step => step.kind === 'page-object').length,
    });
  }

  for (const [id, counts] of summary) {
    process.stdout.write(`      ${id}: contextual=${counts.contextual} dynamic=${counts.dynamic}`
      + ` positional=${counts.positional} review=${counts.review} pageObject=${counts.pageObject}\n`);
  }

  // 11 / 12: contextual resolution still works, and 011 no longer leaks.
  for (const id of ['TC_DASHBOARD_008', 'TC_DASHBOARD_011', 'TC_LOGIN_083']) {
    const counts = summary.get(id);
    if (!counts)
      continue;
    check(`${id}: the row is still addressed contextually (inline or via a Page Object)`,
        counts.contextual > 0, `${counts.contextual}`);
    check(`${id}: no generated id in anything emitted`, counts.dynamic === 0);
    check(`${id}: and no position either`, counts.positional === 0);
  }
  // 13: 082's positional targets are refused, not promoted.
  const login082 = summary.get('TC_LOGIN_082');
  check('13: TC_LOGIN_082 emits no position', !login082 || login082.positional === 0);
  check('13: and its unresolvable targets go to review',
      !login082 || login082.review > 0, `${login082?.review ?? 0} review step(s)`);

  // 14 / 15: the Page Object work of the earlier phases is untouched.
  const dashboard011 = summary.get('TC_DASHBOARD_011');
  check('14: the parameterised method is still reused',
      (dashboard011?.pageObject ?? 0) > 0, `${dashboard011?.pageObject ?? 0} page-object step(s)`);
  const reuse = mapRecording(parseRecording([
    "import { test, expect } from '@playwright/test';",
    '',
    "test('t', async ({ page }) => {",
    "  await page.getByRole('link', { name: 'Notifications' }).click();",
    '});',
  ].join('\n'), { startUrl: '', browser: '', durationMs: 0 })).steps;
  check('15: ordinary Page Object reuse is unaffected',
      reuse.some(step => step.kind === 'page-object' && /notificationsBell/.test(step.code.join(' '))));
}

/* ------------------------------------------------------------- safety ---- */

function checkSafety(): void {
  process.stdout.write('\n== nothing was relaxed, and nothing new was introduced ==\n');
  const quality = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'locator-quality.ts'), 'utf8');

  check('the identity proof is unchanged and still required',
      /isProvenAgainstClickedTarget/.test(
          fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'dom-evidence.ts'), 'utf8')));
  const domEvidence = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'dom-evidence.ts'), 'utf8');
  check('press-time, same-document and single-match are all still demanded',
      /measuredAt === 'press'/.test(domEvidence) && /sameDocument === true/.test(domEvidence)
      && /matchCount === 1/.test(domEvidence) && /identityMatched === true/.test(domEvidence));

  // XPath was NOT introduced as an ambiguity bypass: the axis candidates are still
  // built only to be rejected, and the rejection list is still where they land.
  check('XPath axis candidates are still generated only to be REJECTED',
      /rejected\.push\(\{\s*\n?\s*strategy: 'xpath-ancestor'/.test(quality)
      || /strategy: 'xpath-ancestor'/.test(quality));
  check('and no new XPath is emitted anywhere',
      !/expression: `?['"`]?xpath=/.test(quality.replace(/rejected\.push\([\s\S]*?\}\);/g, '')));

  // The contextual generator itself is untouched.
  const evidenceSource = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'dom-evidence.ts'), 'utf8');
  check('the container-text generator is unchanged and still present',
      /strategy: 'container-text'/.test(evidenceSource));
  check('one dynamic-id rule, not two',
      /export function chainHasDynamicIdentifier/.test(quality)
      && /export \{ chainHasDynamicIdentifier \} from '\.\.\/locator-quality'/.test(
          fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'abstraction', 'classify.ts'), 'utf8')));

  const changed = ['locator-quality.ts', 'abstraction/classify.ts'];
  for (const name of changed) {
    const body = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', name), 'utf8');
    check(`${name} calls no model`,
        !/\bclaude\b|anthropic|openai|child_process|\bspawn\s*\(/i
            .test(body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
  }
}

function main(): void {
  checkDynamicIds();
  checkPositional();
  checkRecordings();
  checkSafety();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
