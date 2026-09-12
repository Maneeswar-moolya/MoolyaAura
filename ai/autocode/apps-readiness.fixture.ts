import '../testing/isolated-checkout';
/**
 * P0.8 — the project card is drawn before it is wired, and the suite must wait
 * for the wiring, not for a clock.
 *
 *   npx tsx ai/autocode/apps-readiness.fixture.ts
 *
 * Offline: no browser, no model, no network. Two halves:
 *
 *   - the Page Object's readiness, asserted on its SOURCE, because "waits for
 *     load" and "waits 2 seconds" are indistinguishable at runtime and only one
 *     of them is acceptable;
 *   - the assembler's output, driven through the real `mapRecording` with the
 *     real knowledge files, because the defect was not that `open()` was wrong -
 *     it was that nothing ever emitted it.
 *
 * WHAT WAS MEASURED (ai/reports/diagnostics/TC_LOGIN_064): cards hit-testable at
 * ~1350ms, delegated click handler bound at ~2294ms in the same 100ms sample as
 * `[data-original-title]` appearing on 23 elements, load at ~2539ms. Clicking in
 * the gap succeeds as an action and does nothing to the application: 6 of 9 runs
 * stayed on /apps for 30s.
 */

import fs from 'node:fs';
import path from 'node:path';

import { mapRecording } from './from-recording';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

// Application-owned readiness methods were retired with their Page Objects.
// These authored actions exercise the generic post-login entry-point ordering.
const CLICK_LOCATOR = "page.locator('#drafts .title').filter({ hasText: 'Quarterly draft' })";

function recording(actions: any[]): any {
  return {
    testCaseId: 'TC_FIXTURE_001',
    startUrl: 'https://portal.fixture.invalid/',
    actions,
    assertions: [],
    evidence: { available: false, reason: 'this fixture carries no DOM evidence on purpose' },
  };
}

const SIGN_IN = [
  { type: 'navigate', target: 'https://portal.fixture.invalid/', value: 'https://portal.fixture.invalid/', locator: null },
  { type: 'fill', target: 'Email', value: 'someone@moolya.com', locator: "page.getByRole('textbox', { name: 'Email' })" },
  { type: 'fill', target: 'Password', value: '[type=password]', locator: "page.getByRole('textbox', { name: 'Password' })", redacted: true },
  { type: 'click', target: 'Sign In', value: null, locator: "page.getByRole('button', { name: 'Sign In', exact: true })" },
];

function codeOf(result: any): string[] {
  return result.steps.flatMap((step: any) => step.code ?? []);
}

function checkAssembler(): void {
  process.stdout.write('\n== H — a raw recorded action still gets the landing screen opened ==\n');
  const raw = mapRecording(recording([...SIGN_IN,
    { type: 'click', target: 'Quarterly draft', value: null, locator: CLICK_LOCATOR }]) as any);
  const code = codeOf(raw);
  process.stdout.write(`${code.map(line => `      ${line}`).join('\n')}\n`);
  const signInAt = code.findIndex(line => line.includes('loginPage.signIn('));
  const openAt = code.findIndex(line => line.includes('projectsPage.open()'));
  const clickAt = code.findIndex(line => line.includes("hasText: 'Quarterly draft'"));
  check('H: the sign-in is emitted', signInAt >= 0);
  check('H: projectsPage.open() is emitted for a raw action', openAt >= 0, code.join(' | '));
  check('H: the recorded click is still emitted', clickAt >= 0);
  check('H: the order is signIn -> open -> recorded click',
      signInAt >= 0 && openAt > signInAt && clickAt > openAt,
      `signIn@${signInAt} open@${openAt} click@${clickAt}`);
  check('H: the step is labelled as the redirect a recording cannot capture',
      raw.steps.some((step: any) => step.from === 'post-sign-in redirect'));

  process.stdout.write('\n== I — never emitted twice ==\n');
  const twoRaw = mapRecording(recording([...SIGN_IN,
    { type: 'click', target: 'Quarterly draft', value: null, locator: CLICK_LOCATOR },
    { type: 'click', target: 'Annual draft', value: null, locator: "page.getByText('Annual draft')" }]) as any);
  const opens = codeOf(twoRaw).filter(line => line.includes('projectsPage.open()'));
  check('I: two raw actions still open the screen once', opens.length === 1, String(opens.length));

  const matched = mapRecording(recording([...SIGN_IN,
    { type: 'click', target: 'Create Project', value: null, locator: "page.getByRole('button', { name: 'Create Project' })" },
    { type: 'click', target: 'Quarterly draft', value: null, locator: CLICK_LOCATOR }]) as any);
  const matchedOpens = codeOf(matched).filter(line => line.includes('projectsPage.open()'));
  check('I: a Page Object match followed by a raw action opens it once',
      matchedOpens.length === 1, `${matchedOpens.length}: ${codeOf(matched).join(' | ')}`);

  process.stdout.write('\n== J — Page Object priority is unchanged ==\n');
  const poCode = codeOf(matched);
  check('J: the matched action still reuses its Page Object method',
      poCode.some(line => /projectsPage\.createProjectButton\(\)/.test(line)),
      poCode.join(' | '));
  check('J: reuse is still counted as reuse',
      matched.steps.some((step: any) => step.kind === 'page-object'));
  check('J: the raw action is still reported as unabstracted',
      matched.steps.some((step: any) => step.kind === 'codegen-locator'));

  process.stdout.write('\n== K — recorded locators and evidence are untouched ==\n');
  const emitted = codeOf(raw).find(line => line.includes('hasText')) ?? '';
  check('K: the recorded locator is emitted verbatim',
      emitted.includes("hasText: 'Quarterly draft'"), emitted);
  check('K: no readiness call was injected into the recorded step',
      !emitted.includes('projectCardsInteractive') && !emitted.includes('waitFor'));
  check('K: nothing was appended after the recorded click', !/waitForURL/.test(emitted));
  check('K: the assessment for the recorded action still ran',
      raw.assessments.some((entry: any) => entry.from === 'click Quarterly draft'),
      JSON.stringify(raw.assessments.map((a: any) => a.from)));

  process.stdout.write('\n== the flow a person will read ==\n');
  for (const line of codeOf(raw))
    process.stdout.write(`      ${line}\n`);
}

function main(): void {
  checkAssembler();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
