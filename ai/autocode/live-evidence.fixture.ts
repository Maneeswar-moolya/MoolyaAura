/**
 * Phase 8C: what live DOM evidence changes, and what must survive without it.
 *
 *   npx tsx ai/autocode/live-evidence.fixture.ts
 *
 * Offline. No browser, no model, no network - the evidence is handed in as data,
 * exactly as a recording would carry it. The checks that matter most are the ones
 * that REFUSE: a measured ambiguity, a generated id with no counted alternative, and
 * an assertion whose expectation sits on the parent with nothing countable to move to.
 */

import fs from 'node:fs';
import path from 'node:path';

import { assessLocator } from './locator-quality';
import { evidenceFor, evidenceUnavailable, sanitiseEvidence, type TargetEvidence } from './dom-evidence';
import { liveTransportRequested, localorsIn, TRANSPORT_ENV } from '../dashboard/live-recorder';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

function evidence(overrides: Partial<TargetEvidence>): TargetEvidence {
  return {
    locator: "page.locator('#tc_summary_638717')",
    target: { tag: 'div', id: 'tc_summary_638717', stableClasses: ['tabulator-cell', 'tabulator-cell-draft--summary'] },
    ancestors: [{ tag: 'div', id: 'bugReport-table', relationship: 'ancestor', depth: 2 }],
    children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: ['parent', 'ancestor'], matchCount: 1,
    identifier: { raw: 'tc_summary_638717', dynamic: true, normalised: 'tc_summary_<dynamic>' },
    ...overrides,
  };
}

function main(): void {
  process.stdout.write('\n== A — a generated id with a COUNTED alternative ==\n');
  const resolved = assessLocator({
    locator: "page.locator('#tc_summary_638717')", target: 'summary', kind: 'action',
    evidence: evidence({
      derivedCandidates: [
        { strategy: 'scoped-class', expression: `page.locator("#bugReport-table .tabulator-cell-draft--summary")`, matchCount: 1 },
      ],
    }),
  });
  check('A: promoted to NORMALIZED_LOCATOR', resolved.outcome === 'NORMALIZED_LOCATOR', resolved.outcome);
  check('A: emits the counted selector',
      resolved.expression === `page.locator("#bugReport-table .tabulator-cell-draft--summary")`, String(resolved.expression));
  check('A: the generated id is NOT emitted', !String(resolved.expression).includes('tc_summary_638717'));
  check('A: the reason says it was measured', /measured at exactly one element/.test(resolved.reason));
  check('A: no wildcard, prefix match or first()',
      !/\[id\^=|\*=|first\(\)|nth\(/.test(String(resolved.expression)));

  process.stdout.write('\n== B — a generated id with NO counted alternative ==\n');
  const unresolved = assessLocator({
    locator: "page.locator('#tc_summary_638717')", target: 'summary', kind: 'action',
    evidence: evidence({ derivedCandidates: [] }),
  });
  check('B: NEEDS_REVIEW', unresolved.outcome === 'NEEDS_REVIEW', unresolved.outcome);
  check('B: nothing is emitted', unresolved.expression === null);
  check('B: the reason says nothing could be promoted', /without guessing/.test(unresolved.reason));

  process.stdout.write('\n== C — measured ambiguity is never narrowed ==\n');
  const ambiguous = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    evidence: evidence({ matchCount: 7, identifier: undefined,
      derivedCandidates: [{ strategy: 'class', expression: 'page.locator(".row")', matchCount: 1 }] }),
  });
  check('C: NEEDS_REVIEW', ambiguous.outcome === 'NEEDS_REVIEW', ambiguous.outcome);
  check('C: reports the measured count', /measured 7 elements/.test(ambiguous.reason), ambiguous.reason.slice(0, 80));
  check('C: refuses to use first()/nth()', /would pick an element nobody chose/.test(ambiguous.reason));
  check('C: does NOT silently take the unique candidate', ambiguous.expression === null);

  process.stdout.write('\n== D — TC_LOGIN_036: the expectation belongs to the parent ==\n');
  const retarget = assessLocator({
    locator: "page.getByRole('strong')", target: 'strong', kind: 'assertion',
    value: 'Welcome to Bugasura',
    evidence: evidence({
      locator: "page.getByRole('strong')",
      target: { tag: 'strong', text: 'Bugasura' },
      parent: { tag: 'h2', text: 'Welcome to Bugasura' },
      identifier: undefined, matchCount: 1,
      derivedCandidates: [{ strategy: 'scoped-tag', expression: `page.locator("#login_area h2")`, matchCount: 1 }],
    }),
  });
  check('D: retargeted from the strong', retarget.outcome === 'NORMALIZED_LOCATOR', retarget.outcome);
  check('D: to the counted parent selector',
      retarget.expression === `page.locator("#login_area h2")`, String(retarget.expression));
  check('D: the reason names both texts',
      retarget.reason.includes('Bugasura') && retarget.reason.includes('Welcome to Bugasura'));
  check('D: the expected VALUE is never rewritten', !/rewrit/i.test(String(retarget.expression)));

  const noCandidate = assessLocator({
    locator: "page.getByRole('strong')", target: 'strong', kind: 'assertion',
    value: 'Welcome to Bugasura',
    evidence: evidence({
      target: { tag: 'strong', text: 'Bugasura' }, parent: { tag: 'h2', text: 'Welcome to Bugasura' },
      identifier: undefined, matchCount: 1, derivedCandidates: [],
    }),
  });
  check('D2: with nothing countable it is NEEDS_REVIEW', noCandidate.outcome === 'NEEDS_REVIEW', noCandidate.outcome);
  check('D2: and says the value is not rewritten',
      /expected value is NOT rewritten/.test(noCandidate.reason));

  process.stdout.write('\n== E — no evidence: Phase 7 behaviour, unchanged ==\n');
  const offline = assessLocator({
    locator: "page.locator('#tc_summary_638717')", target: 'summary', kind: 'action',
  });
  check('E: still NEEDS_REVIEW offline', offline.outcome === 'NEEDS_REVIEW', offline.outcome);
  check('E: still detects the dynamic id offline', offline.dynamic?.dynamic === true);
  const stable = assessLocator({ locator: "page.getByRole('button', { name: 'Sign In' })", target: 'Sign In', kind: 'action' });
  check('E: a good locator is still stable offline', stable.outcome === 'STABLE_LOCATOR', stable.outcome);

  process.stdout.write('\n== F — the transport guard and its fallback ==\n');
  const source = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  check('F: _enableRecorder is checked before it is called',
      /typeof enableRecorder !== 'function'/.test(source));
  check('F: a missing method returns null (caller falls back)',
      /is not a function on this[\s\S]{0,200}return null/.test(source));
  check('F: every start failure returns null', /catch \(error\)[\s\S]{0,240}return null;/.test(source));
  check('F: capture failure is counted, not thrown', /metrics\.failures\+\+/.test(source));
  check('F: serialisation failure degrades to evidenceUnavailable',
      /evidence could not be serialised/.test(source));
  const recorderSource = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/recorder.ts'), 'utf8');
  check('F: the codegen path is still there', /'codegen',\s*$/m.test(recorderSource) || recorderSource.includes("playwrightCli(), 'codegen'"));
  check('F: live is opt-in, codegen is the default',
      !liveTransportRequested(), `${TRANSPORT_ENV} unset -> live requested = ${liveTransportRequested()}`);

  process.stdout.write('\n== G — the action stream parser ==\n');
  const script = `import { test, expect } from '@playwright/test';
test('test', async ({ page }) => {
  await page.goto('https://my.bugasura.io/');
  await page.getByRole('textbox', { name: 'Email' }).fill('a@b.com');
  await expect(page.locator('#project_banner')).toContainText('hello');
  await page.locator('#tc_summary_1').click();
});`;
  const found = localorsIn(script);
  check('G: finds action targets', found.includes("page.getByRole('textbox', { name: 'Email' })"), found.join(' | '));
  check('G: finds assertion targets', found.includes("page.locator('#project_banner')"));
  check('G: de-duplicates', new Set(found).size === found.length);
  check('G: ignores goto (no element to capture)', !found.some(f => f.includes('goto')));

  process.stdout.write('\n== H — evidence still passes the funnel ==\n');
  const funnelled = sanitiseEvidence([evidence({
    derivedCandidates: [
      { strategy: 'scoped-class', expression: 'page.locator("#bugReport-table .x")', matchCount: 1 },
      { strategy: 'class', expression: 'page.locator(".x")', matchCount: 12 },
    ],
  })], '2026-08-14T00:00:00.000Z');
  check('H: non-unique candidates are dropped at the funnel',
      funnelled.targets[0].derivedCandidates?.length === 1,
      JSON.stringify(funnelled.targets[0].derivedCandidates));
  check('H: evidenceFor finds by locator',
      Boolean(evidenceFor(funnelled, "page.locator('#tc_summary_638717')")));
  check('H: unavailable evidence yields null', evidenceFor(evidenceUnavailable('x'), 'anything') === null);

  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
