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

const PROJECTS = fs.readFileSync(path.resolve(ROOT, 'tests-e2e/pages/projects.page.ts'), 'utf8');
const LOGIN = fs.readFileSync(path.resolve(ROOT, 'tests-e2e/pages/login.page.ts'), 'utf8');

/** One method's body, so a claim about it cannot be satisfied by another method. */
function methodBody(source: string, name: string): string {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0)
    return '';
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{')
      depth++;
    else if (source[index] === '}' && --depth === 0)
      return source.slice(start, index + 1);
  }
  return '';
}

/* ------------------------------------------------ A-D: the readiness itself */

function checkReadiness(): void {
  process.stdout.write('\n== A — open() waits for the application, not for the DOM alone ==\n');
  const open = methodBody(PROJECTS, 'open');
  check('A: open() still waits for the /apps redirect', /waitForURL\(\/\\\/apps\//.test(open));
  check('A: open() waits for the page load event',
      /waitForLoadState\('load'\)/.test(open), open.includes('waitForLoadState') ? 'found' : 'MISSING');
  check('A: open() no longer settles for domcontentloaded',
      !/waitForLoadState\('domcontentloaded'\)/.test(open));
  check('A: open() waits for the cards to be interactive',
      /await this\.projectCardsInteractive\(\)/.test(open));
  check('A: readiness comes BEFORE the onboarding dismissal',
      open.indexOf('projectCardsInteractive') < open.indexOf('dismissOnboardingModal'));

  process.stdout.write('\n== B — the readiness is bounded and degrades ==\n');
  const ready = methodBody(PROJECTS, 'projectCardsInteractive');
  check('B: the method exists', Boolean(ready));
  check('B: it takes a bounded timeout', /timeout = \d+_?\d*/.test(ready), ready.slice(0, 60));
  check('B: the timeout is passed to the wait', /waitFor\(\{ state: 'attached', timeout \}\)/.test(ready));
  check('B: it degrades instead of hanging or throwing', /\.catch\(\(\) => \{\}\)/.test(ready));
  check('B: it waits for ATTACHED, not for a paint',
      /state: 'attached'/.test(ready) && !/state: 'visible'/.test(ready));

  process.stdout.write('\n== C — no fixed wait, no force, no fallback click ==\n');
  for (const [name, body] of [['open', open], ['projectCardsInteractive', ready],
    ['openProject', methodBody(PROJECTS, 'openProject')]] as Array<[string, string]>) {
    check(`C: ${name}() has no waitForTimeout`, !/waitForTimeout/.test(body));
    check(`C: ${name}() has no fixed sleep or millisecond literal wait`,
        !/setTimeout|sleep\(|await new Promise/.test(body));
    check(`C: ${name}() never forces, dispatches or JS-clicks`,
        !/force\s*:|dispatchEvent|evaluate\(|mouse\.|\.hover\(/.test(body));
    check(`C: ${name}() adds no retry loop`, !/for \(|while \(|retry/i.test(body));
  }
  // The one pre-existing waitForTimeout in this file belongs to the onboarding
  // dismissal and predates P0.8. Pinned so P0.8 cannot be blamed for it and so a
  // new one cannot be added quietly.
  check('C: exactly one waitForTimeout remains in the file, the pre-existing one',
      (PROJECTS.match(/waitForTimeout/g) ?? []).length === 1
      && /waitForTimeout/.test(methodBody(PROJECTS, 'dismissOnboardingModal')));

  process.stdout.write('\n== D — the marker is scoped to the project list ==\n');
  check('D: the selector is scoped to #all_apps',
      /locator\('#all_apps \[data-original-title\]'\)/.test(ready), ready.slice(-200));
  check('D: it is not a page-wide attribute sweep',
      !/locator\('\[data-original-title\]'\)/.test(PROJECTS));
  check('D: nothing else in the suite waits on that attribute unscoped',
      !/page\.locator\('\[data-original-title\]'\)/.test(PROJECTS));
}

/* ------------------------------------------------------ E-G: openProject() */

function checkOpenProject(): void {
  process.stdout.write('\n== E — openProject keeps the recorded locator shape ==\n');
  const body = methodBody(PROJECTS, 'openProject');
  check('E: the method exists', Boolean(body));
  check('E: it opens the screen first', /await this\.open\(\);/.test(body));
  check('E: it clicks getByText(name) - the shape a recording produces',
      /this\.page\.getByText\(name\)\.click\(\)/.test(body), body.slice(0, 200));
  check('E: it does not substitute a different strategy',
      !/getByRole|locator\(|getByTestId|exact: true/.test(body));
  check('E: it does not narrow with first()/nth()', !/\.first\(\)|\.nth\(/.test(body));

  process.stdout.write('\n== F — openProject proves the application moved ==\n');
  check('F: it waits for the issues route', /waitForURL\(\/\\\/issues\\\/\//.test(body), body.slice(-160));
  check('F: the wait is bounded', /timeout: \d+_?\d*/.test(body));
  check('F: the arrival check comes after the click',
      body.indexOf('click()') < body.indexOf('waitForURL'));

  process.stdout.write('\n== G — signIn() is untouched ==\n');
  const signIn = methodBody(LOGIN, 'signIn');
  const lines = signIn.split('\n').map(line => line.trim()).filter(Boolean);
  check('G: signIn() is still exactly fill, fill, click',
      lines.length === 5
      && /emailField\(\)\)\.fill\(email\)/.test(lines[1])
      && /passwordField\(\)\)\.fill\(password\)/.test(lines[2])
      && /signInButton\(\)\)\.click\(\)/.test(lines[3]),
      JSON.stringify(lines));
  check('G: signIn() waits for nothing - the redirect is not its business',
      !/waitFor|waitForURL|waitForLoadState/.test(signIn));
  check('G: signIn() knows nothing about /apps', !/apps|projectCards/.test(signIn));
}

/* --------------------------------------------- H-K: what the assembler emits */

/**
 * A project-card click, in the SCOPED form the recorder produces today.
 *
 * This was a bare `page.getByText('Faclon labs')`. That shape is now refused before
 * generation - an unscoped text locator whose uniqueness nothing measured is exactly
 * what made TC_LOGIN_096 fail Playwright's strict mode at run time - so a fixture
 * built on it was testing P0.8 through a vehicle the pipeline no longer emits.
 *
 * The INVARIANT here is unchanged and is not about text: a raw recorded action, of
 * whatever shape, must still get the landing screen opened before it. So the vehicle
 * moved to the contextual expression the recorder actually measures for a card
 * (`#all_apps` scoping the title), and every assertion below still checks what it
 * always checked.
 */
const CLICK_LOCATOR = "page.locator('#all_apps .title').filter({ hasText: 'Faclon labs' })";

function recording(actions: any[]): any {
  return {
    testCaseId: 'TC_FIXTURE_001',
    startUrl: 'https://my.bugasura.io/',
    actions,
    assertions: [],
    evidence: { available: false, reason: 'this fixture carries no DOM evidence on purpose' },
  };
}

const SIGN_IN = [
  { type: 'navigate', target: 'https://my.bugasura.io/', value: 'https://my.bugasura.io/', locator: null },
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
    { type: 'click', target: 'Faclon labs', value: null, locator: CLICK_LOCATOR }]) as any);
  const code = codeOf(raw);
  process.stdout.write(`${code.map(line => `      ${line}`).join('\n')}\n`);
  const signInAt = code.findIndex(line => line.includes('loginPage.signIn('));
  const openAt = code.findIndex(line => line.includes('projectsPage.open()'));
  const clickAt = code.findIndex(line => line.includes("hasText: 'Faclon labs'"));
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
    { type: 'click', target: 'Faclon labs', value: null, locator: CLICK_LOCATOR },
    { type: 'click', target: 'Sundyne', value: null, locator: "page.getByText('Sundyne')" }]) as any);
  const opens = codeOf(twoRaw).filter(line => line.includes('projectsPage.open()'));
  check('I: two raw actions still open the screen once', opens.length === 1, String(opens.length));

  const matched = mapRecording(recording([...SIGN_IN,
    { type: 'click', target: 'Create Project', value: null, locator: "page.getByRole('button', { name: 'Create Project' })" },
    { type: 'click', target: 'Faclon labs', value: null, locator: CLICK_LOCATOR }]) as any);
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
      emitted.includes("hasText: 'Faclon labs'"), emitted);
  check('K: no readiness call was injected into the recorded step',
      !emitted.includes('projectCardsInteractive') && !emitted.includes('waitFor'));
  check('K: nothing was appended after the recorded click', !/waitForURL/.test(emitted));
  check('K: the assessment for the recorded action still ran',
      raw.assessments.some((entry: any) => entry.from === 'click Faclon labs'),
      JSON.stringify(raw.assessments.map((a: any) => a.from)));

  process.stdout.write('\n== the flow a person will read ==\n');
  for (const line of codeOf(raw))
    process.stdout.write(`      ${line}\n`);
}

function main(): void {
  checkReadiness();
  checkOpenProject();
  checkAssembler();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
