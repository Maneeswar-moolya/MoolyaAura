import '../testing/isolated-checkout';
/** Post-authentication ordering: preserve explicit actions; never manufacture a redirect goto.
 * Offline synthetic measurements exercise Page Object reuse and raw-action ordering.
 */
import { syntheticLoginEvidence, targetEvidence } from '../testing/synthetic-data';
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
    // Only the authored Create Project interaction has additional identity proof.
    // Keep the draft clicks unmeasured so they still exercise raw-action ordering.
    evidence: syntheticLoginEvidence(actions.filter(action =>
      action.locator === "page.getByRole('button', { name: 'Create Project' })").map(action =>
      targetEvidence(action.locator, {
        documentId: 'synthetic-apps', elementRef: 'synthetic-apps:create-project', route: '/apps',
        target: { tag: 'button', role: 'button', accessibleName: 'Create Project', accessibleNameVerified: true },
      }))),
  };
}

const SIGN_IN = [
  { type: 'navigate', navigationCause: 'intentional', target: 'https://portal.fixture.invalid/', value: 'https://portal.fixture.invalid/', locator: null },
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
  check('H: observed landing does not invent a Page Object open', openAt === -1, code.join(' | '));
  check('H: the recorded click is still emitted', clickAt >= 0);
  check('H: signIn precedes the recorded click without an invented navigation',
      signInAt >= 0 && clickAt > signInAt && openAt === -1,
      `signIn@${signInAt} open@${openAt} click@${clickAt}`);
  check('H: no fabricated redirect step',
      !raw.steps.some((step: any) => step.from === 'post-sign-in redirect'));

  process.stdout.write('\n== I — never emitted twice ==\n');
  const twoRaw = mapRecording(recording([...SIGN_IN,
    { type: 'click', target: 'Quarterly draft', value: null, locator: CLICK_LOCATOR },
    { type: 'click', target: 'Annual draft', value: null, locator: "page.getByText('Annual draft')" }]) as any);
  const opens = codeOf(twoRaw).filter(line => line.includes('projectsPage.open()'));
  check('I: two raw actions do not manufacture navigation', opens.length === 0, String(opens.length));

  const matched = mapRecording(recording([...SIGN_IN,
    { type: 'click', target: 'Create Project', value: null, locator: "page.getByRole('button', { name: 'Create Project' })" },
    { type: 'click', target: 'Quarterly draft', value: null, locator: CLICK_LOCATOR }]) as any);
  const matchedOpens = codeOf(matched).filter(line => line.includes('projectsPage.open()'));
  check('I: Page Object reuse does not manufacture navigation',
      matchedOpens.length === 0, `${matchedOpens.length}: ${codeOf(matched).join(' | ')}`);

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
