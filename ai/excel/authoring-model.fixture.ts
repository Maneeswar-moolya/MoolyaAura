import '../testing/isolated-checkout';
/**
 * P1 — the enterprise authoring model: what a row may say, and what it may not.
 *
 *   npx tsx ai/excel/authoring-model.fixture.ts
 *
 * Offline: no browser, no model, no network. Synthetic workbooks are built in a
 * temp directory; the synthetic workbook and synthetic recordings are READ and never
 * written. The credential checks compare against the real `.env` secret and
 * never print one - a failure names the surface, never the value.
 *
 * WHAT THIS PINS
 *
 * Every new field is OPTIONAL. That is the whole backward-compatibility story:
 * a workbook written before P1 has none of these columns, reads as empty, and
 * behaves exactly as it did - so the first thing checked here is the real
 * workbook, unchanged, parsing to the same 76 rows with no errors.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Workbook } from 'exceljs';

import { parseWorkbook } from './parser';
import { assessReadiness, credentialsIn, FREE_TEXT_FIELDS } from './readiness';
import { BUSINESS_RISKS, TEST_TYPES, type TestCase } from './types';
import { authoringFingerprint, fingerprint } from '../autocode/work';
import { rowFacts } from '../autocode/agent';
import { saveCase, validateDraft, SYSTEM_MANAGED_FIELDS, type CaseDraft } from '../dashboard/authoring';
import { recordingStatus, rememberRecordingFingerprint, describeRecording } from '../dashboard/case-status';

const ROOT = process.cwd();
const WORKBOOK = 'excel/fixture-cases.xlsx';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** Build a one-sheet workbook with whatever headings a check needs. */
async function workbookWith(headers: string[], rows: string[][]): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-'));
  const file = path.join(dir, 'cases.xlsx');
  const book = new Workbook();
  const sheet = book.addWorksheet('Cases');
  sheet.addRow(headers);
  for (const row of rows)
    sheet.addRow(row);
  await book.xlsx.writeFile(file);
  return file;
}

const CLASSIC_HEADERS = ['Test Case ID', 'Scenario', 'Steps', 'Expected Result'];

function draft(over: Partial<CaseDraft> = {}): CaseDraft {
  return {
    worksheet: 'Cases', testCaseId: 'TC_P1_001', module: 'Projects', feature: 'Issue Search',
    scenario: 'Verify user can filter project issues by status',
    description: 'Verify project users can search issues and filter them by status.',
    preconditions: 'User has access to Faclon Labs.\nAt least one issue exists.',
    steps: 'Open FixturePortal.\nSign in.\nOpen Faclon Labs.', testData: 'search = fac11',
    expectedResult: 'The matching issue is displayed with status New',
    assertOutcome: '', assertMessage: '', priority: 'P1', tags: 'regression', run: true,
    requirementId: 'PROJ-1234', testType: 'Functional', businessRisk: 'High',
    environment: 'QA', userRole: 'Project User', authenticationProfile: 'FIXTUREAPP_QA_USER',
    testOwner: 'QA', ...over,
  };
}

function testCase(over: Partial<TestCase> = {}): TestCase {
  return {
    testCaseId: 'TC_P1_001', module: 'Projects', feature: 'Issue Search',
    scenario: 'Verify user can filter project issues by status',
    description: 'Business intent', preconditions: 'Access to Faclon Labs',
    steps: ['Open FixturePortal.', 'Sign in.', 'Open Faclon Labs.'], testData: 'search = fac11',
    expectedResult: 'The matching issue is displayed', priority: 'P1', tags: ['regression'],
    automationStatus: 'Not Automated', automationNotes: '', execute: true,
    expectedOutcome: '', expectedMessage: '',
    requirementId: 'PROJ-1234', testType: 'Functional', businessRisk: 'High',
    environment: 'QA', userRole: 'Project User', authenticationProfile: 'FIXTUREAPP_QA_USER',
    testOwner: 'QA',
    source: { workbookPath: 'x', workbook: 'x.xlsx', worksheet: 'Cases', row: 2 },
    extra: {}, issues: [], ...over,
  } as TestCase;
}

/* ------------------------------------------------ A/B: parsing and old files */

async function checkParsing(): Promise<void> {
  process.stdout.write('\n== A — the new columns parse ==\n');
  const file = await workbookWith(
      [...CLASSIC_HEADERS, 'Requirement ID', 'Test Type', 'Business Risk', 'Environment',
        'User Role', 'Auth Profile', 'Test Owner', 'Test Case Description', 'Pre-Requisite'],
      [['TC_A_1', 'A title', 'Open the app', 'It opens', 'PROJ-77', 'Regression', 'Critical',
        'QA', 'Project Admin', 'FIXTUREAPP_ADMIN', 'Maya', 'Why this exists', 'Signed in']]);
  const parsed = await parseWorkbook(file);
  const row = parsed.testCases[0];
  check('A: requirementId', row.requirementId === 'PROJ-77', row.requirementId);
  check('A: testType', row.testType === 'Regression', row.testType);
  check('A: businessRisk', row.businessRisk === 'Critical', row.businessRisk);
  check('A: environment', row.environment === 'QA', row.environment);
  check('A: userRole', row.userRole === 'Project Admin', row.userRole);
  check('A: authenticationProfile', row.authenticationProfile === 'FIXTUREAPP_ADMIN', row.authenticationProfile);
  check('A: testOwner', row.testOwner === 'Maya', row.testOwner);
  check('A: description and preconditions still parse',
      row.description === 'Why this exists' && row.preconditions === 'Signed in');

  process.stdout.write('   an unrecognised enum value is emptied, never fatal\n');
  const loose = await parseWorkbook(await workbookWith(
      [...CLASSIC_HEADERS, 'Test Type', 'Business Risk'],
      [['TC_A_2', 'T', 'S', 'E', 'functional testing', 'Sky High']]));
  check('A: unknown Test Type reads as empty', loose.testCases[0].testType === '');
  check('A: unknown Business Risk reads as empty', loose.testCases[0].businessRisk === '');
  check('A: the row still parses', loose.testCases[0].issues.every(i => i.severity !== 'error'));
  check('A: a spelling variant still binds', (await parseWorkbook(await workbookWith(
      [...CLASSIC_HEADERS, 'Test Type'], [['TC_A_3', 'T', 'S', 'E', 'end to end']]))).testCases[0].testType === 'End-to-End');

  process.stdout.write('\n== B — the workbook that existed before any of this ==\n');
  const real = await parseWorkbook(path.resolve(ROOT, WORKBOOK));
  // Deliberately NOT a row count. The workbook is a living file - recordings are
  // saved into it - and a fixture that pins its size fails for the one reason
  // that is not a defect. What must hold is that it parses, cleanly, whatever it
  // has grown into.
  check('B: still parses', real.testCases.length > 0, `${real.testCases.length} row(s)`);
  check('B: with no errors', real.issues.filter(i => i.severity === 'error').length === 0);
  check('B: every new field is a string, never undefined',
      real.testCases.every(row => typeof row.requirementId === 'string'
        && typeof row.testType === 'string' && typeof row.businessRisk === 'string'
        && typeof row.environment === 'string' && typeof row.userRole === 'string'
        && typeof row.authenticationProfile === 'string' && typeof row.testOwner === 'string'));
  check('B: and holds either nothing or a value from its list',
      real.testCases.every(row => (!row.testType || (TEST_TYPES as readonly string[]).includes(row.testType))
        && (!row.businessRisk || (BUSINESS_RISKS as readonly string[]).includes(row.businessRisk))));
  // The genuine old-workbook case: a sheet that has none of the P1 columns at
  // all. The form creates them on the sheet it writes to, so this is checked
  // where it is still true rather than across the whole file.
  const untouched = real.worksheets.filter(sheet => sheet.recognized
    && !sheet.bindings?.some(b => b.field === 'testType'));
  check('B: sheets without the new columns still exist', untouched.length > 0,
      untouched.map(s => s.worksheet).join(', '));
  check('B: and their rows read the new fields as empty, needing no migration',
      real.testCases.filter(row => untouched.some(sheet => sheet.worksheet === row.source.worksheet))
          .every(row => row.testType === '' && row.requirementId === '' && row.authenticationProfile === ''));
}

/* -------------------------------------------------- C: the synonym collision */

async function checkCollisions(): Promise<void> {
  process.stdout.write('\n== C — headings that used to mean something else ==\n');
  const file = await workbookWith([...CLASSIC_HEADERS, 'Type', 'Criticality'],
      [['TC_C_1', 'T', 'S', 'E', 'Smoke', 'High']]);
  const parsed = await parseWorkbook(file);
  const row = parsed.testCases[0];
  check('C: "Type" now means Test Type', row.testType === 'Smoke', row.testType);
  check('C: and no longer becomes a tag', !row.tags.includes('Smoke'), JSON.stringify(row.tags));
  check('C: "Criticality" now means Business Risk', row.businessRisk === 'High', row.businessRisk);
  check('C: and no longer becomes Priority', row.priority === '', row.priority);
  const warnings = parsed.issues.filter(i => i.code === 'HEADING_REBOUND');
  check('C: both rebindings are reported', warnings.length === 2, String(warnings.length));
  check('C: as warnings, never errors', warnings.every(w => w.severity === 'warning'));
  check('C: the message names where it used to go',
      warnings.every(w => /used to be read as/.test(w.message)), warnings[0]?.message ?? '');

  const classic = await parseWorkbook(await workbookWith([...CLASSIC_HEADERS, 'Tags', 'Priority'],
      [['TC_C_2', 'T', 'S', 'E', 'smoke, ui', 'P2']]));
  check('C: ordinary Tags and Priority headings are untouched',
      classic.testCases[0].tags.length === 2 && classic.testCases[0].priority === 'P2');
  check('C: and raise no rebinding warning',
      classic.issues.filter(i => i.code === 'HEADING_REBOUND').length === 0);
}

/* ------------------------------------------------------------ D: readiness */

function checkReadiness(): void {
  process.stdout.write('\n== D — generation readiness, separate from every other status ==\n');
  check('D: a fully authored row is READY', assessReadiness(testCase()).codes.join() === 'READY');
  const codes = (over: Partial<TestCase>, options = {}) => assessReadiness(testCase(over), options).codes.join();
  check('D: no title', codes({ scenario: '' }) === 'MISSING_TITLE');
  check('D: no steps', codes({ steps: [] }) === 'MISSING_STEPS');
  check('D: no expected result', codes({ expectedResult: '' }) === 'MISSING_EXPECTED_RESULT');
  check('D: placeholder expected result',
      codes({ expectedResult: 'Needs confirmation' }) === 'PLACEHOLDER_EXPECTED_RESULT');
  check('D: "Recorded interaction" is a placeholder too',
      codes({ expectedResult: 'Recorded interaction' }) === 'PLACEHOLDER_EXPECTED_RESULT');
  check('D: an account in the profile field',
      codes({ authenticationProfile: 'qa.user@moolya.com' }) === 'INVALID_AUTH_PROFILE');
  check('D: a malformed requirement id',
      codes({ requirementId: 'see the ticket' }) === 'INVALID_REQUIREMENT_ID');
  check('D: an unparseable enum only when the caller has the raw text',
      assessReadiness(testCase({ testType: '' }), { raw: { testType: 'functional testing' } })
          .codes.join() === 'INVALID_TEST_TYPE');
  check('D: and NOT when the row simply left it blank',
      assessReadiness(testCase({ testType: '' })).ready);
  check('D: a stale recording blocks',
      codes({}, { recording: { exists: true, stale: true } }) === 'RECORDED_CASE_NEEDS_RERECORD');
  check('D: a matching recording does not',
      assessReadiness(testCase(), { recording: { exists: true, stale: false } }).ready);
  check('D: an unknown-age recording does not',
      assessReadiness(testCase(), { recording: { exists: true } }).ready);

  process.stdout.write('   advisory findings never block\n');
  const policy = assessReadiness(testCase({ module: '', environment: '' }),
      { require: ['module', 'environment'] });
  check('D: policy gaps are advisory', policy.ready && policy.findings.length === 2,
      JSON.stringify(policy.findings.map(f => f.code)));
  const compound = assessReadiness(testCase({ steps: ['Login, open the project and search for the issue'] }));
  check('D: a compound step is advisory, not blocking',
      compound.ready && compound.findings.some(f => f.code === 'NON_ATOMIC_STEP'));
  check('D: an atomic step raises nothing',
      !assessReadiness(testCase({ steps: ['Open Faclon Labs.'] })).findings
          .some(f => f.code === 'NON_ATOMIC_STEP'));
}

/* -------------------------------------------- E: credentials, everywhere */

async function checkCredentials(): Promise<void> {
  process.stdout.write('\n== E — a credential cannot be authored anywhere ==\n');
  check('E: a literal password is caught', credentialsIn('password = Hunter2real').length === 1);
  check('E: a token is not a credential', credentialsIn('password = <valid-password>').length === 0);
  check('E: quoted values count', credentialsIn('token: "abc123"').length === 1);
  check('E: api keys count', credentialsIn('api_key = sk-live-9').length === 1);
  check('E: ordinary prose does not', credentialsIn('The password field shows an error').length === 0);
  check('E: every authored free-text field is scanned', FREE_TEXT_FIELDS.length >= 10,
      FREE_TEXT_FIELDS.join(', '));

  const parsed = await parseWorkbook(await workbookWith(CLASSIC_HEADERS, [['TC_E_1', 'T', 'S', 'E']]));
  const problems = (over: Partial<CaseDraft>) => validateDraft(draft(over), parsed, true);
  for (const field of ['description', 'preconditions', 'testData', 'expectedResult', 'userRole'] as const) {
    check(`E: refused in ${field}`,
        problems({ [field]: 'password = Hunter2real' } as Partial<CaseDraft>)
            .some(p => /credential/i.test(p)));
  }
  check('E: the profile field refuses an address',
      problems({ authenticationProfile: 'qa@example.com' }).some(p => /profile NAME/.test(p)));
  check('E: the profile field refuses a password-shaped value',
      problems({ authenticationProfile: 'hunter2 secret' }).some(p => /profile NAME/.test(p)));
  check('E: a valid profile reference passes',
      problems({ authenticationProfile: 'FIXTUREAPP_READ_ONLY' }).length === 0);

  const secret = process.env.FIXTUREAPP_PASSWORD ?? '';
  if (secret.length >= 4) {
    const surfaces: Array<[string, string]> = [
      ['the workbook', fs.readFileSync(path.resolve(ROOT, WORKBOOK)).toString('latin1')],
      ['state.json', fs.readFileSync(path.resolve(ROOT, 'ai/autocode/state.json'), 'utf8')],
      ['mapping.json', fs.readFileSync(path.resolve(ROOT, 'ai/test-mapping/mapping.json'), 'utf8')],
      ['the autocode log', fs.readFileSync(path.resolve(ROOT, 'ai/reports/autocode-log.md'), 'utf8')],
    ];
    for (const [label, contents] of surfaces)
      check(`E: ${label} carries no password`, !contents.includes(secret));
    check('E: the generator prompt carries no password',
        !rowFacts({ testCase: testCase(), workbook: WORKBOOK, specFile: 'x', runId: 'r' } as never)
            .includes(secret));
  } else {
    check('E: a real password is available to scan for', false, 'FIXTUREAPP_PASSWORD is not set');
  }
}

/* ------------------------------------------------------ F: the fingerprints */

function checkFingerprints(): void {
  process.stdout.write('\n== F — what invalidates automation, and what does not ==\n');
  const base = testCase();
  const spec = fingerprint(base);
  const moved = (over: Partial<TestCase>) => fingerprint(testCase(over)) !== spec;
  check('F: steps invalidate', moved({ steps: ['Open something else'] }));
  check('F: expected result invalidates', moved({ expectedResult: 'Something else' }));
  check('F: environment invalidates', moved({ environment: 'PROD' }));
  check('F: user role invalidates', moved({ userRole: 'Project Admin' }));
  check('F: authentication profile invalidates', moved({ authenticationProfile: 'FIXTUREAPP_ADMIN' }));
  check('F: test type invalidates', moved({ testType: 'Security' }));
  check('F: tags invalidate - they choose the pipeline', moved({ tags: ['recorded'] }));
  check('F: requirement id does NOT', !moved({ requirementId: 'PROJ-999' }));
  check('F: business risk does NOT', !moved({ businessRisk: 'Low' }));
  check('F: test owner does NOT', !moved({ testOwner: 'Someone else' }));

  const authored = authoringFingerprint(base);
  check('F: but governance edits are still noticed',
      authoringFingerprint(testCase({ requirementId: 'PROJ-999' })) !== authored
      && authoringFingerprint(testCase({ businessRisk: 'Low' })) !== authored
      && authoringFingerprint(testCase({ testOwner: 'Someone' })) !== authored);
  check('F: an untouched row hashes the same twice', fingerprint(testCase()) === spec);
}

/* ------------------------------------------ G: recorded vs manual editing */

function checkRecordingPolicy(): void {
  process.stdout.write('\n== G — editing a recorded case ==\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1rec-'));
  const base = testCase();
  fs.writeFileSync(path.join(dir, `${base.testCaseId}.spec.ts`), '// recorded\n', 'utf8');
  fs.writeFileSync(path.join(dir, `${base.testCaseId}.evidence.json`), '{}', 'utf8');

  const before = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(dir, `${base.testCaseId}.spec.ts`))).digest('hex');

  check('G: a recording with no bookkeeping is UNKNOWN, not stale',
      recordingStatus(base, dir).stale === undefined);
  rememberRecordingFingerprint(base, dir);
  check('G: after recording, the row matches', recordingStatus(base, dir).stale === false);

  const invalidating: Array<[string, Partial<TestCase>]> = [
    ['steps', { steps: ['Open something else'] }],
    ['expected result', { expectedResult: 'Something else' }],
    ['preconditions', { preconditions: 'Nothing' }],
    ['test data', { testData: 'search = other' }],
    ['environment', { environment: 'PROD' }],
    ['user role', { userRole: 'Project Admin' }],
    ['authentication profile', { authenticationProfile: 'FIXTUREAPP_ADMIN' }],
  ];
  for (const [label, over] of invalidating)
    check(`G: editing ${label} marks it stale`, recordingStatus(testCase(over), dir).stale === true);

  const harmless: Array<[string, Partial<TestCase>]> = [
    ['title', { scenario: 'A better title' }],
    ['description', { description: 'Clearer intent' }],
    ['requirement', { requirementId: 'PROJ-999' }],
    ['priority', { priority: 'P0' }],
    ['business risk', { businessRisk: 'Low' }],
    ['tags', { tags: ['smoke'] }],
    ['test owner', { testOwner: 'Someone else' }],
  ];
  for (const [label, over] of harmless)
    check(`G: editing ${label} does NOT`, recordingStatus(testCase(over), dir).stale === false);

  check('G: the artifacts were never touched',
      crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, `${base.testCaseId}.spec.ts`)))
          .digest('hex') === before);
  check('G: the bookkeeping lives beside them, not inside them',
      fs.existsSync(path.join(dir, `${base.testCaseId}.authoring.json`))
      && fs.readFileSync(path.join(dir, `${base.testCaseId}.spec.ts`), 'utf8') === '// recorded\n');
  check('G: a stale recording says what to do',
      /Re-record it, or undo the edit/.test(describeRecording(recordingStatus(testCase({ steps: ['x'] }), dir))));

  process.stdout.write('   and the isolated reference recordings are untouched by any of this\n');
  const realOne = testCase({ testCaseId: 'TC_LOGIN_065' });
  check('G: a pre-P1 recording reports unknown, never stale',
      recordingStatus(realOne).stale === undefined);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ----------------------------------- H/I: system fields and generator context */

function checkSystemAndContext(): void {
  process.stdout.write('\n== H — system-managed fields cannot be authored ==\n');
  const keys = Object.keys(draft());
  for (const field of SYSTEM_MANAGED_FIELDS)
    check(`H: the form has no "${field}" input`, !keys.includes(field));
  const authoring = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/authoring.ts'), 'utf8');
  const writeBlock = authoring.slice(authoring.indexOf('const targets:'), authoring.indexOf('const resolved ='));
  check('H: and the writer has no column for automation status',
      !/automationStatus|automationNotes/.test(writeBlock));
  check('H: nor for any execution result', !/executionStatus|finalStatus|testFile/.test(writeBlock));

  process.stdout.write('\n== I — what the generator is told ==\n');
  const facts = rowFacts({ testCase: testCase(), workbook: WORKBOOK, specFile: 'x', runId: 'r' } as never);
  for (const [label, value] of [['Description', 'Business intent'], ['Requirement', 'PROJ-1234'],
    ['Test Type', 'Functional'], ['Business Risk', 'High'], ['Tags', 'regression'],
    ['Environment', 'QA'], ['User Role', 'Project User'], ['Test Owner', 'QA'],
    ['Preconditions', 'Access to Faclon Labs']] as Array<[string, string]>)
    check(`I: ${label} reaches the generator`, facts.includes(`${label}: ${value}`), label);
  check('I: the authentication profile is sent as a NAME',
      facts.includes('Authentication Profile: FIXTUREAPP_QA_USER'));
  check('I: and nothing that looks like an account or a secret is',
      !/@|password|FIXTUREAPP_PASSWORD/i.test(facts.split('Authentication Profile:')[1] ?? ''));
  check('I: an empty optional field is simply absent',
      !rowFacts({ testCase: testCase({ requirementId: '' }), workbook: WORKBOOK, specFile: 'x', runId: 'r' } as never)
          .includes('Requirement:'));
  check('I: no system metadata is sent',
      !/Automation Status|Execution Status|Attempts|fingerprint/i.test(facts));
}

/* ------------------------------- J: the acceptance case, end to end */

/**
 * The case the model was designed around, written through the REAL save path.
 *
 * Not a shape test: `saveCase` is what the form calls, so this is the round trip
 * a person gets - validate, back up, create any missing column, write the row,
 * read it back. Into a temp workbook, so nothing real is touched.
 */
async function checkAcceptance(): Promise<void> {
  process.stdout.write('\n== J — the acceptance case, saved and read back ==\n');
  const file = await workbookWith(CLASSIC_HEADERS, [['TC_SEED_1', 'Seed', 'A step', 'A result']]);
  const wanted = draft({
    worksheet: 'Cases', testCaseId: 'TC_LOGIN_066',
    scenario: 'Verify user can filter project issues by status',
    description: 'Verify project users can search issues and filter them by status.',
    requirementId: 'PROJ-1234', module: 'Projects', feature: 'Issue Search',
    testType: 'Functional', priority: 'P1', businessRisk: 'High',
    environment: 'QA', userRole: 'Project User', authenticationProfile: 'FIXTUREAPP_QA_USER',
    preconditions: 'User has access to Faclon Labs.\nAt least one issue exists.',
    steps: ['Open FixturePortal.', 'Sign in.', 'Open Faclon Labs.', 'Search for "fac11".',
      'Select status "New".', 'Verify the matching issue is displayed.'].join('\n'),
    testData: 'search = fac11\nstatus = New',
    expectedResult: 'The issue list shows exactly the matching issue, with status New.',
    tags: 'regression, issue-search', testOwner: 'QA',
  });

  const parsedBefore = await parseWorkbook(file);
  check('J: the draft validates', validateDraft(wanted, parsedBefore, true).length === 0,
      validateDraft(wanted, parsedBefore, true).join(' | '));

  const saved = await saveCase(file, wanted, true);
  check('J: it was written', saved.created && saved.testCaseId === 'TC_LOGIN_066');
  check('J: the missing columns were created, not demanded of the author',
      saved.columnsAdded.length > 0, saved.columnsAdded.join(', '));

  const reread = await parseWorkbook(file);
  const row = reread.testCases.find(c => c.testCaseId === 'TC_LOGIN_066');
  check('J: the row round-trips', Boolean(row));
  if (!row)
    return;
  const same: Array<[string, string, string]> = [
    ['title', row.scenario, wanted.scenario],
    ['description', row.description, wanted.description],
    ['requirement', row.requirementId, wanted.requirementId],
    ['module', row.module, wanted.module],
    ['feature', row.feature, wanted.feature],
    ['test type', row.testType, wanted.testType],
    ['priority', row.priority, wanted.priority],
    ['business risk', row.businessRisk, wanted.businessRisk],
    ['environment', row.environment, wanted.environment],
    ['user role', row.userRole, wanted.userRole],
    ['auth profile', row.authenticationProfile, wanted.authenticationProfile],
    ['test owner', row.testOwner, wanted.testOwner],
    ['preconditions', row.preconditions, wanted.preconditions],
    ['expected result', row.expectedResult, wanted.expectedResult],
    ['test data', row.testData, wanted.testData],
  ];
  for (const [label, got, expected] of same) {
    // Detail only when it fails: printing "a != a" beside a PASS reads as a
    // contradiction, and a fixture that has to be re-read to be believed is worse
    // than one that says less.
    check(`J: ${label} survives the round trip`, got === expected,
        got === expected ? '' : `got ${JSON.stringify(got)}, wanted ${JSON.stringify(expected)}`);
  }
  check('J: all six steps survive', row.steps.length === 6, String(row.steps.length));
  check('J: it is READY for generation', assessReadiness(row).ready,
      assessReadiness(row).codes.join(', '));

  const facts = rowFacts({ testCase: row, workbook: file, specFile: 'x', runId: 'r' } as never);
  check('J: the generator gets the business information',
      facts.includes('Requirement: PROJ-1234') && facts.includes('Business Risk: High')
      && facts.includes('User Role: Project User'));
  check('J: and the profile by name only',
      facts.includes('Authentication Profile: FIXTUREAPP_QA_USER') && !facts.includes('@'));
  check('J: the seed row written before any of this is untouched',
      reread.testCases.some(c => c.testCaseId === 'TC_SEED_1' && c.scenario === 'Seed'));
  check('J: and it has empty new fields, not missing ones',
      reread.testCases.find(c => c.testCaseId === 'TC_SEED_1')?.testType === '');
}

async function main(): Promise<void> {
  await checkParsing();
  await checkCollisions();
  checkReadiness();
  await checkCredentials();
  checkFingerprints();
  checkRecordingPolicy();
  checkSystemAndContext();
  await checkAcceptance();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
