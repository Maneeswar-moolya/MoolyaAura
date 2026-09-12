import '../testing/isolated-checkout';
/**
 * P1 regression — a draft that predates a field must still save.
 *
 *   npx tsx ai/dashboard/draft-normalization.fixture.ts
 *
 * Offline: no browser, no model, no network. Workbooks are built in a temp
 * directory; the real workbook and the real recordings are never written.
 *
 * THE FAILURE THIS PINS
 *
 * P1 added nine optional fields to `CaseDraft`. The record panel had been
 * posting the same thirteen fields since before they existed - correctly, since
 * every new field is optional - and `validateDraft` then read
 * `draft.testType.trim()` on an object with no `testType`:
 *
 *   TypeError: Cannot read properties of undefined (reading 'trim')
 *     at check (ai/dashboard/authoring.ts:320)
 *     at enumProblems (ai/dashboard/authoring.ts:325)
 *     at validateDraft (ai/dashboard/authoring.ts:301)
 *
 * A recorded case could not be saved at all. The cause is not the `.trim()`: it
 * is that `CaseDraft` is a promise made across an HTTP boundary that nothing
 * checked (`server.ts` casts `body.draft as CaseDraft`). So the contract is
 * enforced in one place - `normalizeDraft` - and this file is what stops it
 * being quietly removed again.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Workbook } from 'exceljs';

import { normalizeDraft, saveCase, validateDraft, type CaseDraft } from './authoring';
import { parseWorkbook } from '../excel/parser';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/**
 * The exact object `recDraft()` in index.html posts. Thirteen fields, none of
 * them the ones P1 added. Kept verbatim on purpose: if the record panel changes
 * shape, this fixture should be updated deliberately, not silently.
 */
const RECORDED_DRAFT = {
  worksheet: 'Cases',
  testCaseId: '',
  module: '',
  feature: '',
  scenario: 'Faclon labs — the issue summary is displayed',
  steps: 'Open https://portal.fixture.invalid/\nSign in\nClick Faclon labs',
  testData: 'Email = someone@moolya.com\nPassword = <valid-password>',
  expectedResult: 'The issue summary is displayed',
  assertOutcome: '',
  assertMessage: '',
  priority: '',
  tags: 'recorded, signed-in',
  run: true,
};

const MANUAL_FULL: CaseDraft = {
  worksheet: 'Cases', testCaseId: '', module: 'Projects', feature: 'Issue Search',
  scenario: 'Verify user can filter project issues by status',
  description: 'Business intent.', preconditions: 'User has access.',
  steps: 'Open FixturePortal.\nSign in.', testData: 'search = fac11',
  expectedResult: 'The matching issue is displayed.',
  assertOutcome: '', assertMessage: '', priority: 'P1', tags: 'regression', run: true,
  requirementId: 'PROJ-1234', testType: 'Functional', businessRisk: 'High',
  environment: 'QA', userRole: 'Project User', authenticationProfile: 'FIXTUREAPP_QA_USER',
  testOwner: 'QA',
};

const CLASSIC_HEADERS = ['Test Case ID', 'Scenario', 'Steps', 'Expected Result'];
const P1_HEADERS = [...CLASSIC_HEADERS, 'Test Case Description', 'Pre-Requisite', 'Requirement ID',
  'Test Type', 'Business Risk', 'Environment', 'User Role', 'Auth Profile', 'Test Owner',
  'Test Data', 'Priority', 'Tags', 'Run'];

async function workbookWith(headers: string[]): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1reg-'));
  const file = path.join(dir, 'cases.xlsx');
  const book = new Workbook();
  const sheet = book.addWorksheet('Cases');
  sheet.addRow(headers);
  sheet.addRow(['TC_SEED_1', 'Seed row', 'A step', 'A result']);
  await book.xlsx.writeFile(file);
  return file;
}

/** Save, and report what happened rather than throwing at the fixture. */
async function trySave(file: string, draft: unknown): Promise<{ ok: boolean; detail: string }> {
  try {
    const saved = await saveCase(file, draft as CaseDraft, true);
    return { ok: true, detail: saved.testCaseId };
  } catch (error) {
    return { ok: false, detail: (error as Error).message.split('\n')[0] };
  }
}

/* ------------------------------------------------------ the normaliser */

function checkNormaliser(): void {
  process.stdout.write('\n== the contract: every promised field is there ==\n');
  const normalised = normalizeDraft(RECORDED_DRAFT);
  const keys: Array<keyof CaseDraft> = ['worksheet', 'testCaseId', 'module', 'feature', 'scenario',
    'description', 'preconditions', 'steps', 'testData', 'expectedResult', 'assertOutcome',
    'assertMessage', 'priority', 'tags', 'requirementId', 'testType', 'businessRisk',
    'environment', 'userRole', 'authenticationProfile', 'testOwner'];
  check('every string field is a string', keys.every(key => typeof normalised[key] === 'string'),
      keys.filter(key => typeof normalised[key] !== 'string').join(', '));
  check('the missing ones are EMPTY, not invented',
      normalised.description === '' && normalised.preconditions === ''
      && normalised.requirementId === '' && normalised.testType === ''
      && normalised.businessRisk === '' && normalised.environment === ''
      && normalised.userRole === '' && normalised.authenticationProfile === ''
      && normalised.testOwner === '');
  check('nothing plausible was guessed into them',
      !JSON.stringify(normalised).includes('Recorded') || normalised.description === '',
      normalised.description);
  check('what the sender DID say survives untouched',
      normalised.scenario === RECORDED_DRAFT.scenario
      && normalised.steps === RECORDED_DRAFT.steps
      && normalised.testData === RECORDED_DRAFT.testData
      && normalised.expectedResult === RECORDED_DRAFT.expectedResult
      && normalised.tags === RECORDED_DRAFT.tags);
  check('a blank Assert Outcome stays blank - it means "the spec asserts"',
      normalised.assertOutcome === '');
  check('run defaults to yes when absent', normalizeDraft({}).run === true);
  check('run: false is respected', normalizeDraft({ run: false }).run === false);
  check('a null draft does not explode', normalizeDraft(null).scenario === '');
  check('a non-string value is not passed through',
      normalizeDraft({ testType: 42 as never }).testType === '');
}

/* ------------------------------------------- 1-10: the backward-compat list */

async function checkCompatibility(): Promise<void> {
  process.stdout.write('\n== the original failure, gone ==\n');
  const old = await workbookWith(CLASSIC_HEADERS);
  const parsedOld = await parseWorkbook(old);
  let threw = '';
  try {
    validateDraft(RECORDED_DRAFT as never, parsedOld, true);
  } catch (error) {
    threw = (error as Error).message;
  }
  check('validateDraft no longer throws on a recorded draft', threw === '', threw);
  check('and it reports no problems with it',
      validateDraft(RECORDED_DRAFT as never, parsedOld, true).length === 0,
      validateDraft(RECORDED_DRAFT as never, parsedOld, true).join(' | '));

  process.stdout.write('\n== 1-10: every shape a draft arrives in ==\n');
  const cases: Array<[string, unknown, string[]]> = [
    ['1. an existing recorded draft (13 fields)', RECORDED_DRAFT, CLASSIC_HEADERS],
    ['2. a newly recorded draft', { ...RECORDED_DRAFT, tags: 'recorded' }, CLASSIC_HEADERS],
    ['3. a manual draft, optional fields empty', {
      ...MANUAL_FULL, description: '', preconditions: '', requirementId: '', testType: '',
      businessRisk: '', environment: '', userRole: '', authenticationProfile: '', testOwner: '',
    }, CLASSIC_HEADERS],
    ['4. a manual draft, optional fields populated', MANUAL_FULL, CLASSIC_HEADERS],
    ['5. an OLD workbook with none of the new columns', RECORDED_DRAFT, CLASSIC_HEADERS],
    ['6. a NEW workbook with all of them', MANUAL_FULL, P1_HEADERS],
    ['7. saved without Description', omit(MANUAL_FULL, 'description'), P1_HEADERS],
    ['8. saved without Preconditions', omit(MANUAL_FULL, 'preconditions'), P1_HEADERS],
    ['9. saved without Auth Profile', omit(MANUAL_FULL, 'authenticationProfile'), P1_HEADERS],
    ['10. saved with everything populated', MANUAL_FULL, P1_HEADERS],
  ];
  for (const [label, draft, headers] of cases) {
    const file = await workbookWith(headers);
    const result = await trySave(file, draft);
    check(label, result.ok, result.detail);
  }

  process.stdout.write('\n   and what was saved is what was sent\n');
  const file = await workbookWith(CLASSIC_HEADERS);
  await trySave(file, RECORDED_DRAFT);
  const reread = await parseWorkbook(file);
  const row = reread.testCases.find(c => c.scenario === RECORDED_DRAFT.scenario);
  check('the recorded row is in the workbook', Boolean(row));
  check('its steps are unchanged', row?.steps.length === 3, String(row?.steps.length));
  check('its expected result is unchanged', row?.expectedResult === RECORDED_DRAFT.expectedResult);
  check('its test data is unchanged - including the credential TOKEN',
      row?.testData === RECORDED_DRAFT.testData && row?.testData.includes('<valid-password>'));
  check('the new fields are empty on it, not filled in',
      row?.description === '' && row?.testType === '' && row?.authenticationProfile === ''
      && row?.requirementId === '' && row?.environment === '');
  check('the seed row beside it is untouched',
      reread.testCases.some(c => c.testCaseId === 'TC_SEED_1' && c.scenario === 'Seed row'));
}

function omit<T extends object>(value: T, key: keyof T): Record<string, unknown> {
  const copy = { ...value } as Record<string, unknown>;
  delete copy[key as string];
  return copy;
}

/* --------------------------------------------- the recorder is not involved */

function checkRecorderUntouched(): void {
  process.stdout.write('\n== the recorded pipeline was not touched to achieve this ==\n');
  const recorder = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/recorder.ts'), 'utf8');
  check('recorder.ts knows nothing about the new fields',
      !/requirementId|businessRisk|authenticationProfile|testOwner/.test(recorder));
  check('toDraft still returns what it always returned',
      /return \{\s*scenario: scenarioFrom\(recording\),/.test(recorder));
  check('and it is not where the fix went', !/normalizeDraft/.test(recorder));

  const authoring = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/authoring.ts'), 'utf8');
  check('the fix is in ONE function', (authoring.match(/export function normalizeDraft/g) ?? []).length === 1);
  check('applied at validation', /const draft = normalizeDraft\(submitted\);/.test(authoring));
  check('and at the writer', /repairDraft\(normalizeDraft\(submitted\)\)/.test(authoring));
  check('with no scattered optional chaining in its place',
      (authoring.match(/\?\.trim\(\)/g) ?? []).length === 0);

  const ui = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/public/index.html'), 'utf8');
  check('the record panel still posts its own thirteen fields',
      /function recDraft\(\)/.test(ui) && !/recDraft[\s\S]{0,600}requirementId/.test(ui));
}

async function main(): Promise<void> {
  checkNormaliser();
  await checkCompatibility();
  checkRecorderUntouched();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
