/**
 * P0.9 — the test's sign-in and the exploration browser's sign-in are two
 * different questions, and the answer to one is not the answer to the other.
 *
 *   npx tsx ai/autocode/exploration-auth.fixture.ts
 *
 * Offline: no browser, no model, no network. The real workbook and the real
 * .env are READ; neither is written.
 *
 * WHY THIS EXISTS
 *
 * One boolean answered both questions, so a plain-English row that signs in on
 * its way somewhere else ("Sign in -> open Faclon labs -> search fac11 -> check
 * the status", TC_LOGIN_066) got an anonymous browser, could not reach the
 * screen it was about, and was declined for want of a page nothing had given it
 * a way to open. The rows whose SUBJECT is the sign-in screen still get an
 * anonymous browser, because an authenticated one is bounced off `/` and cannot
 * read the page they are about.
 *
 * The secret half of this file never prints a secret. A failure names the
 * surface that leaked, never the value.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { authRequirement, groupWork, describeGroups } from './groups';
import { instructions, rowFacts, type GenerateRequest } from './agent';
import { mapRecording, readEvidence } from './from-recording';
import { parseRecording } from '../dashboard/recorder';
import { parseWorkbook } from '../excel/parser';
import {
  credentials, explorationCredentials, explorationIdentity, explorationSource,
  MISSING_EXPLORATION_CREDENTIALS_REASON,
} from '../../tests-e2e/support/env';
import type { TestCase } from '../excel/types';

const ROOT = process.cwd();
const WORKBOOK = 'excel/login-test-cases.xlsx';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const read = (relative: string): string => {
  try {
    return fs.readFileSync(path.resolve(ROOT, relative), 'utf8');
  } catch {
    return '';
  }
};

/** A test case shaped like the workbook's, with only the fields this decides on. */
function row(steps: string[], preconditions = ''): TestCase {
  return {
    testCaseId: 'TC_FIXTURE_001', module: '', feature: '', scenario: 'fixture',
    description: '', preconditions, steps, testData: '', expectedResult: 'something',
    expectedOutcome: '', expectedMessage: '', priority: '', tags: [], status: '',
    source: { worksheet: 'Fixture', row: 2 },
  } as unknown as TestCase;
}

/* ------------------------------------------------- A-D: the semantic matrix */

function checkMatrix(): void {
  process.stdout.write('\n== A — a login test: the sign-in IS the subject ==\n');
  const login = authRequirement(row([
    'Open the Bugasura login page', 'Enter the email address for this case',
    'Enter the password for this case', 'Click Sign In',
    'Verify the user is taken to the dashboard',
  ]));
  check('A: the test starts signed out', login.testStartsSignedIn === false);
  check('A: and the exploration browser stays signed out', login.explorationNeedsAuth === false,
      login.explorationReason);
  check('A: because nothing acts after the sign-in',
      /only observe|subject/.test(login.explorationReason), login.explorationReason);

  process.stdout.write('\n== B — an authenticated journey: TC_LOGIN_066 ==\n');
  const journey = authRequirement(row([
    'Step 1: Open Bugasura.', 'Step 2: Enter email.', 'Step 3: Enter password.',
    'Step 4: Click Sign In.', 'Step 5: Open Faclon labs.',
    'Step 6: Click on search field and and enter "fac11" and hit enter',
    'step7: verify the status should be new for the resulted issue',
  ]));
  check('B: the test still signs in for itself', journey.testStartsSignedIn === false);
  check('B: the exploration browser is authenticated', journey.explorationNeedsAuth === true,
      journey.explorationReason);
  check('B: the reason names the step that acts',
      /step 5 acts after the sign-in/.test(journey.explorationReason), journey.explorationReason);

  process.stdout.write('\n== C — an already-authenticated journey ==\n');
  const already = authRequirement(
      row(['Open the projects dashboard', 'Search for a project'], 'User is signed in to Bugasura'));
  check('C: the test starts signed in', already.testStartsSignedIn === true);
  check('C: the exploration browser is authenticated', already.explorationNeedsAuth === true);

  process.stdout.write('\n== D — a public page ==\n');
  const publicPage = authRequirement(row([
    'Open the terms of service page', 'Verify the heading is displayed',
  ]));
  check('D: the exploration browser stays signed out', publicPage.explorationNeedsAuth === false,
      publicPage.explorationReason);
  check('D: nothing here is behind a sign-in',
      /no step signs in/.test(publicPage.explorationReason));

  process.stdout.write('\n   the edge that broke the first draft of this rule\n');
  const languagePicker = authRequirement(row([
    'Open bugasura login page', 'click on language options and select italian',
    'check sign button language should be in italian',
  ]));
  check('   a row that ACTS on the sign-in page stays anonymous',
      languagePicker.explorationNeedsAuth === false, languagePicker.explorationReason);
  check('   "login page" names the screen, it does not sign in',
      /no step signs in/.test(languagePicker.explorationReason));
}

/* ------------------------------------------------ the real workbook, swept */

async function checkWorkbook(): Promise<void> {
  process.stdout.write('\n== the whole workbook, measured rather than argued ==\n');
  const parsed = await parseWorkbook(path.resolve(ROOT, WORKBOOK));
  const verdicts = new Map<string, ReturnType<typeof authRequirement>>();
  for (const testCase of parsed.testCases)
    verdicts.set(testCase.testCaseId.toUpperCase(), authRequirement(testCase));

  const anonymous = ['TC_LOGIN_010', 'TC_LOGIN_011', 'TC_LOGIN_012', 'TC_LOGIN_013',
    'TC_LOGIN_046', 'TC_LOGIN_058', 'TC_LOGIN_062', 'TC_LOGIN_025'];
  for (const id of anonymous) {
    const verdict = verdicts.get(id);
    if (verdict)
      check(`   ${id} keeps an anonymous browser`, verdict.explorationNeedsAuth === false, verdict.explorationReason);
  }
  const authenticated = ['TC_LOGIN_064', 'TC_LOGIN_065', 'TC_LOGIN_066', 'TC_PROJ_009',
    'TC_DASHBOARD_002'];
  for (const id of authenticated) {
    const verdict = verdicts.get(id);
    if (verdict)
      check(`   ${id} gets an authenticated browser`, verdict.explorationNeedsAuth === true, verdict.explorationReason);
  }
  const precondition = verdicts.get('TC_PROJ_001');
  if (precondition) {
    check('   TC_PROJ_001 starts signed in AND explores signed in',
        precondition.testStartsSignedIn === true && precondition.explorationNeedsAuth === true);
  }
  check('   no row asks the test to start signed in while exploring anonymously',
      [...verdicts.values()].every(v => !(v.testStartsSignedIn && !v.explorationNeedsAuth)));

  process.stdout.write('\n   grouping keeps the two apart\n');
  const items = parsed.testCases
      .filter(t => ['TC_LOGIN_010', 'TC_LOGIN_066'].includes(t.testCaseId.toUpperCase()))
      .map(testCase => ({ testCase, reason: 'new' as const, fingerprint: 'x' }));
  const groups = groupWork(items as any);
  check('   a login row and a journey row do not share a browser', groups.length === 2,
      groups.map(g => g.key).join(' | '));
  const journeyGroup = groups.find(g => g.explorationNeedsAuth);
  check('   the journey group names the variable, never the account',
      Boolean(journeyGroup) && journeyGroup!.authIdentity === explorationIdentity()
      && !journeyGroup!.authIdentity.includes('@'), journeyGroup?.authIdentity ?? '(none)');
  const described = describeGroups(groups);
  check('   the log states both answers separately',
      /test starts signed (in|out).*exploration browser signed (in|out)/s.test(described));
  check('   and the log carries no account address', !described.includes('@'));
}

/* --------------------------------------------- E-H: the credential profile */

function withEnv(values: Record<string, string | undefined>, body: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, process.env[key]);
    if (value === undefined)
      delete process.env[key];
    else
      process.env[key] = value;
  }
  try {
    body();
  } finally {
    for (const [key, value] of saved.entries()) {
      if (value === undefined)
        delete process.env[key];
      else
        process.env[key] = value;
    }
  }
}

function checkCredentials(): void {
  process.stdout.write('\n== E — an exploration account is available ==\n');
  check('E: the suite\'s own credentials still resolve', Boolean(credentials()));
  check('E: exploration falls back to them when nothing else is set',
      Boolean(explorationCredentials()), explorationIdentity());
  check('E: and reports WHICH VARIABLE, never the address',
      explorationIdentity() === 'BUGASURA_EMAIL', explorationIdentity());

  process.stdout.write('\n== F — no exploration account: a deterministic refusal ==\n');
  withEnv({
    BUGASURA_EMAIL: undefined, BUGASURA_PASSWORD: undefined,
    BUGASURA_EXPLORATION_USER: undefined, BUGASURA_EXPLORATION_PASSWORD: undefined,
    BUGASURA_EXPLORATION_PROFILE: undefined,
  }, () => {
    check('F: exploration credentials are null, not guessed', explorationCredentials() === null);
    check('F: the identity is anonymous', explorationIdentity() === 'anonymous');
  });
  check('F: the reason names the variables to set',
      /BUGASURA_EXPLORATION_USER/.test(MISSING_EXPLORATION_CREDENTIALS_REASON)
      && /BUGASURA_EXPLORATION_PROFILE/.test(MISSING_EXPLORATION_CREDENTIALS_REASON));
  check('F: and says the generator never asks for one',
      /never asks anybody for a password/.test(MISSING_EXPLORATION_CREDENTIALS_REASON));
  const session = read('ai/autocode/session.ts');
  check('F: the session throws rather than continuing without an account',
      /if \(!creds\) \{[\s\S]{0,400}throw new SessionUnavailable/.test(session));
  check('F: the refusal carries the framework own reason, not an improvised one',
      /MISSING_EXPLORATION_CREDENTIALS_REASON/.test(session));
  check('F: a missing credential cannot become prompt text - the session builds no prompts',
      !/from '\.\/agent'/.test(session) && !/instructions\(/.test(session));

  process.stdout.write('\n== G/H — a different exploration account ==\n');
  withEnv({ BUGASURA_EXPLORATION_USER: 'someone-else@example.com', BUGASURA_EXPLORATION_PASSWORD: 'x' }, () => {
    check('G: the exploration source moves to the exploration variables',
        explorationSource().email === 'BUGASURA_EXPLORATION_USER');
    check('G: the identity reported is the variable name',
        explorationIdentity() === 'BUGASURA_EXPLORATION_USER');
    check('G: the SUITE\'s credentials are untouched by that',
        credentials()?.email === process.env.BUGASURA_EMAIL);
  });
  withEnv({ BUGASURA_EXPLORATION_PROFILE: 'qa-user' }, () => {
    check('H: a profile names its variables and nothing else',
        explorationSource().email === 'BUGASURA_QA_USER_EMAIL'
        && explorationSource().password === 'BUGASURA_QA_USER_PASSWORD');
    check('H: an unset profile resolves to no credentials, not to a fallback',
        explorationCredentials() === null);
    check('H: the suite credentials still resolve independently', Boolean(credentials()));
  });
  check('G/H: the exploration variables are documented for a person',
      /BUGASURA_EXPLORATION_USER/.test(read('.env.example'))
      && /BUGASURA_EXPLORATION_PROFILE/.test(read('.env.example')));
}

/* ------------------------------- I-N: nothing else moved, especially the recorder */

async function checkIsolation(): Promise<void> {
  process.stdout.write('\n== I/J — the recorder and its data are untouched ==\n');
  const recorderFiles = [
    'ai/dashboard/live-recorder.ts', 'ai/dashboard/recorder.ts',
    'ai/autocode/dom-capture-source.ts', 'ai/autocode/dom-evidence.ts',
  ];
  for (const file of recorderFiles) {
    const source = read(file);
    check(`J: ${file.split('/').pop()} knows nothing about exploration credentials`,
        Boolean(source) && !/EXPLORATION|explorationCredentials/.test(source));
  }
  const recordings = 'ai/dashboard/recordings';
  // Files only. `recordings/accepted/` is a directory - the archive an accepted
  // recording is moved into - and hashing a directory throws EISDIR, which took the
  // whole fixture down the first time one existed.
  const digestRecordings = (): string => fs.readdirSync(path.resolve(ROOT, recordings))
      .filter(name => fs.statSync(path.resolve(ROOT, recordings, name)).isFile())
      .map(name => `${name}:${crypto.createHash('sha256')
          .update(fs.readFileSync(path.resolve(ROOT, recordings, name))).digest('hex')}`)
      .join('\n');
  const before = digestRecordings();
  withEnv({ BUGASURA_EXPLORATION_USER: 'other@example.com', BUGASURA_EXPLORATION_PASSWORD: 'y' }, () => {
    check('I: changing the exploration account resolves a different source',
        explorationSource().email === 'BUGASURA_EXPLORATION_USER');
  });
  const after = digestRecordings();
  check('I: every recording and sidecar is byte-identical afterwards', before === after);

  process.stdout.write('\n== M/N — the recorded pipeline is unchanged ==\n');
  const recordedId = fs.existsSync(path.resolve(ROOT, recordings, 'TC_LOGIN_065.spec.ts'))
    ? 'TC_LOGIN_065' : null;
  if (recordedId) {
    const recording: any = parseRecording(read(`${recordings}/${recordedId}.spec.ts`), {} as any);
    recording.evidence = readEvidence(recordedId);
    const mapping = mapRecording(recording);
    const code = (mapping.steps as any[]).flatMap(step => step.code ?? []);
    // THE WITNESS CHANGED, THE INVARIANT DID NOT.
    //
    // This used to assert that the project click was emitted as Codegen's RAW locator,
    // `page.getByText('Faclon labs')`. That was never the property under test - the
    // section asks whether the EXPLORATION-credentials work disturbed the recorded
    // pipeline - it was just the shape that element happened to have. It has since
    // gained a Page Object: `ProjectsPage.projectCard(description)` was created by the
    // abstraction engine from TC_LOGIN_112's measurement, and this recording now reuses
    // it, which is the loop closing across two unrelated cases. Pinning the raw form
    // would have made that improvement look like a regression.
    //
    // So both halves are asserted on what actually matters: the landing screen is
    // opened BEFORE the project is clicked, and the click is still driven by the
    // element the recording named.
    const clickedProject = code.findIndex(line => line.includes("'Faclon labs'"));
    check('M: a recorded case still opens the landing screen before its project click',
        code.some(line => line.includes('projectsPage.open()'))
        && clickedProject > code.findIndex(line => line.includes('projectsPage.open()')),
        code.join(' | ').slice(0, 120));
    check('M: and the click is still driven by the element the recording named',
        clickedProject >= 0 && /getByText\('Faclon labs'\)|projectCard\('Faclon labs'\)/
            .test(code[clickedProject]),
        code[clickedProject] ?? 'no step clicks Faclon labs');
    check('N: a recording with no assertion still asserts nothing',
        recording.assertions.length === 0);
    check('N: which is what makes its Expected Result a placeholder, not a guess',
        (mapping.steps as any[]).every(step => !/expect\(/.test((step.code ?? []).join(''))));
  } else {
    check('M/N: a recorded case is available to check', false, 'TC_LOGIN_065 recording missing');
  }

  process.stdout.write('\n== K/L — LoginPage and knowledge selection are unchanged ==\n');
  const loginPage = read('tests-e2e/pages/login.page.ts');
  const signIn = loginPage.slice(loginPage.indexOf('async signIn('));
  check('K: signIn() is still fill, fill, click',
      /emailField\(\)\)\.fill\(email\)[\s\S]{0,120}passwordField\(\)\)\.fill\(password\)[\s\S]{0,120}signInButton\(\)\)\.click\(\)/
          .test(signIn));
  check('K: signIn() still knows nothing about exploration',
      !/EXPLORATION|exploration/.test(signIn.slice(0, 400)));
  const context = read('ai/autocode/context.ts');
  check('L: knowledge selection asks about the TEST, not the browser',
      /authRequirement\(testCase\)\.testStartsSignedIn/.test(context));
  check('L: and never asks about exploration', !/explorationNeedsAuth/.test(context));
}

/* ------------------------------------------------------- 1-12: the secret */

async function checkSecrets(): Promise<void> {
  process.stdout.write('\n== 1-12 — the password reaches nothing that can print it ==\n');
  const secret = process.env.BUGASURA_PASSWORD ?? '';
  if (secret.length < 4) {
    check('a real password is available to scan for', false,
        'BUGASURA_PASSWORD is not set - these checks cannot run');
    return;
  }
  const holds = (text: string) => text.includes(secret);

  // 3-10: everything this pipeline writes, plus everything it reads from.
  const surfaces: Array<[string, string]> = [
    ['6: state.json', read('ai/autocode/state.json')],
    ['7: mapping.json', read('ai/test-mapping/mapping.json')],
    ['4: generation metrics', read('ai/reports/generation-metrics.jsonl')],
    ['2: browse transcript', read('ai/reports/generation-browse.jsonl')],
    ['5: the autocode log', read('ai/reports/autocode-log.md')],
    ['5: the session log', read('ai/reports/generation-session.jsonl')],
    ['9: page knowledge (/apps)', read('ai/knowledge/page/bugasura__apps.yaml')],
    ['9: page knowledge (/)', read('ai/knowledge/page/bugasura__root.yaml')],
    ['10: LoginPage', read('tests-e2e/pages/login.page.ts')],
    ['10: ProjectsPage', read('tests-e2e/pages/projects.page.ts')],
    ['11: the prompt builder', read('ai/autocode/agent.ts')],
    ['11: the context builder', read('ai/autocode/context.ts')],
  ];
  for (const [label, contents] of surfaces)
    check(`${label} carries no password`, !holds(contents));

  for (const file of fs.readdirSync(path.resolve(ROOT, 'tests-e2e/generated'))) {
    check(`3: generated/${file} carries no password`,
        !holds(read(`tests-e2e/generated/${file}`)));
  }
  const workbook = (() => {
    try {
      return fs.readFileSync(path.resolve(ROOT, WORKBOOK)).toString('latin1');
    } catch {
      return '';
    }
  })();
  check('8: the workbook carries no password', Boolean(workbook) && !workbook.includes(secret));

  // 1: a real prompt, built the way a real run builds one, with a signed-in browser.
  const parsed = await parseWorkbook(path.resolve(ROOT, WORKBOOK));
  const testCase = parsed.testCases.find(t => t.testCaseId.toUpperCase() === 'TC_LOGIN_066')
    ?? parsed.testCases[0];
  const request: GenerateRequest = {
    testCase, specFile: 'tests-e2e/generated/TC_FIXTURE.spec.ts', workbook: WORKBOOK, runId: 'fixture',
  };
  const handover = {
    sessionId: 'fixture', reused: false, startupMs: 1, authMs: 1, authenticationAttempts: 1,
    authenticationReuse: false, url: 'https://my.bugasura.io/apps', signedIn: true,
    contaminated: false, resetActions: [], sessionsDiscarded: 0, shutdownMs: null,
  };
  const prompt = `${rowFacts(request)}\n${instructions(request, handover as any, null)}`;
  check('1: the agent prompt carries no password', !holds(prompt));
  check('1: it tells the agent it does not have credentials',
      /do not have them/.test(prompt), prompt.length ? '' : '(empty prompt)');
  check('1: and never names an exploration variable to it',
      !/BUGASURA_EXPLORATION/.test(prompt));

  // 11: only the framework side reads them.
  const readers = ['ai/autocode/session.ts', 'tests-e2e/support/env.ts'];
  for (const file of ['ai/autocode/agent.ts', 'ai/autocode/context.ts', 'ai/autocode/from-recording.ts',
    'ai/autocode/work.ts', 'ai/autocode/orchestrate.ts']) {
    check(`11: ${file.split('/').pop()} never reads exploration credentials`,
        !/explorationCredentials\(/.test(read(file)));
  }
  for (const file of readers) {
    check(`11: ${file.split('/').pop()} is a framework-side reader`,
        /explorationCredentials/.test(read(file)));
  }
  const browse = read('ai/autocode/browse.mjs');
  check('2: the browse log records the command and an argument COUNT, never arguments',
      /record\(command, argc/.test(browse) && !/args\.join/.test(browse.split('function record')[1] ?? ''));
}

async function main(): Promise<void> {
  checkMatrix();
  await checkWorkbook();
  checkCredentials();
  await checkIsolation();
  await checkSecrets();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
