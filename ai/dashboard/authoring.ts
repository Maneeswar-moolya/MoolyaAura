/**
 * Writing test cases back into a workbook from the dashboard.
 *
 * This is the one place the toolkit lets a UI create or change an *authored*
 * column, so the rules are tighter than anywhere else:
 *
 *   - Only data-driven rows. A row that runs through a hand-written spec is
 *     not editable here, because changing its wording cannot change what the
 *     spec asserts - the two would silently disagree, which is worse than not
 *     offering the button.
 *   - The contract is validated BEFORE the workbook is touched, using the same
 *     parser the runner uses. A row that would fail at run time is rejected at
 *     save time, with the same message.
 *   - Timestamped backup first, every time. No backup, no write.
 *   - Only the fields the form owns are written. Every other cell in the row,
 *     and every other row, is read and rewritten untouched.
 *
 * What this deliberately cannot do is turn prose into a new Playwright spec.
 * That needs judgement about the application, not a form.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Workbook } from 'exceljs';

import { parseInputs, parseMatcher, type Outcome } from '../excel/data-driven';
import { contractGap } from '../excel/intent';
import { parseWorkbook, splitSteps } from '../excel/parser';
import type { CanonicalField, ParseResult } from '../excel/types';
import { credentialsIn } from '../excel/readiness';
import {
  AUTH_PROFILE_PATTERN, BUSINESS_RISKS, PRIORITIES, REQUIREMENT_ID_PATTERN, TEST_TYPES,
} from '../excel/types';
import { assertWritable, backupPath, UserFacingError } from '../excel/writeback';

/** Fields the dashboard form owns. Nothing else in the row is written. */
export interface CaseDraft {
  worksheet: string;
  testCaseId: string;
  module: string;
  feature: string;
  scenario: string;
  /** P1: the business intent. Parsed since the beginning; authorable since P1. */
  description: string;
  /**
   * P1: what must hold before the steps run.
   *
   * Also parsed since the beginning and, until now, unauthorable - which is why
   * every manually written row had none, and why the framework had to infer a
   * signed-in starting state from step prose.
   */
  preconditions: string;
  steps: string;
  testData: string;
  expectedResult: string;
  assertOutcome: string;
  assertMessage: string;
  priority: string;
  tags: string;
  run: boolean;
  /* ---- P1 authoring fields. All optional; blank is a valid answer. ---- */
  requirementId: string;
  testType: string;
  businessRisk: string;
  environment: string;
  userRole: string;
  /** A profile NAME (`APPLICATION_QA_USER`). Never a credential - validated below. */
  authenticationProfile: string;
  testOwner: string;
}

/**
 * Fill in whatever the sender left out, as empty - never as a guess.
 *
 * WHY THIS EXISTS, AND WHY IT IS ONE FUNCTION
 *
 * `CaseDraft` is a TypeScript type, and every producer of one is on the other
 * side of an HTTP boundary where a type is a promise nobody checks. The record
 * panel has posted the same thirteen fields since before the enterprise fields
 * existed; when P1 added nine more, `validateDraft` began reading
 * `draft.testType.trim()` on an object that has no `testType`, and saving a
 * recorded case died with "Cannot read properties of undefined (reading
 * 'trim')" before a single row was written.
 *
 * The fix is a contract, not a sprinkling of `?.`: everything that accepts a
 * draft from outside normalises it FIRST, in one place, so that every field the
 * type promises is actually there. An optional field somebody did not fill in
 * is empty, which is exactly what an optional field means - and never a
 * plausible-looking default, because "Recorded test" in a Description or a
 * guessed APPLICATION_QA_USER in an Authentication Profile is business information
 * nobody authored.
 *
 * `run` is the one non-string: absent means yes, which is what both forms send
 * and what a row with no Run column has always meant.
 */
export function normalizeDraft(input: Partial<CaseDraft> | Record<string, unknown> | null | undefined): CaseDraft {
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (key: keyof CaseDraft): string => {
    const value = raw[key as string];
    return typeof value === 'string' ? value : '';
  };
  return {
    worksheet: text('worksheet'),
    testCaseId: text('testCaseId'),
    module: text('module'),
    feature: text('feature'),
    scenario: text('scenario'),
    description: text('description'),
    preconditions: text('preconditions'),
    steps: text('steps'),
    testData: text('testData'),
    expectedResult: text('expectedResult'),
    assertOutcome: text('assertOutcome'),
    assertMessage: text('assertMessage'),
    priority: text('priority'),
    tags: text('tags'),
    run: raw.run !== false,
    requirementId: text('requirementId'),
    testType: text('testType'),
    businessRisk: text('businessRisk'),
    environment: text('environment'),
    userRole: text('userRole'),
    authenticationProfile: text('authenticationProfile'),
    testOwner: text('testOwner'),
  };
}

/**
 * Fields the FRAMEWORK owns. A form may show them; it may never write them.
 *
 * Automation status is written by the gate, execution status and its neighbours
 * by the run reporter, and the recording/spec paths by the pipelines that made
 * them. A person editing a business field must not be able to declare their own
 * test automated, and `writeCase` below simply has no column for any of these.
 */
export const SYSTEM_MANAGED_FIELDS = [
  'automationStatus', 'automationNotes', 'executionStatus', 'duration', 'failureReason',
  'rootCause', 'healingPerformed', 'finalStatus', 'testFile', 'lastExecutionTime',
  'report', 'evidence', 'attempts', 'frameworkFingerprint', 'lastGenerated', 'quarantineReason',
  'recordingArtifact', 'evidenceArtifact', 'createdAt', 'updatedAt',
] as const;

const OUTCOMES: Outcome[] = ['Signed In', 'Error', 'Blocked', 'Visible'];

/** `TC_PROJ_007` -> { prefix: 'TC_PROJ_', number: 7, width: 3 } */
function splitId(id: string): { prefix: string; number: number; width: number } | null {
  const match = /^(.*?)(\d+)$/.exec(id.trim());
  if (!match)
    return null;
  return { prefix: match[1], number: Number(match[2]), width: match[2].length };
}

/**
 * Turn a module or sheet name into an ID prefix.
 *
 * Only a fallback. Real workbooks do not name their prefixes after their sheets -
 * "Create Project" uses TC_PROJ_, which no derivation would ever guess - so the
 * prefix is learned from existing rows whenever there are any.
 */
function derivePrefix(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const body = words.join('_').slice(0, 16).replace(/_$/, '');
  return `TC_${body || 'CASE'}_`;
}

export interface IdSuggestion {
  testCaseId: string;
  /** How the prefix was chosen, shown in the UI so the number is never a mystery. */
  basis: string;
}

/**
 * The next free Test Case ID for a sheet or module.
 *
 * Two rules that matter:
 *
 *   - The prefix is inherited from whatever the target sheet already uses, then
 *     from the module, and only then derived from the name. Adding a row to
 *     "Create Project" continues TC_PROJ_, not TC_CREATE_PROJECT_.
 *   - The number is `max + 1` across the WHOLE workbook for that prefix - never
 *     the lowest unused one. Two sheets can share a prefix (Login Test Cases and
 *     Login Validation both use TC_LOGIN_), so a per-sheet maximum would collide;
 *     and a gap is usually a reserved ID, not an invitation.
 */
export function suggestTestCaseId(parsed: ParseResult, worksheet: string, module: string): IdSuggestion {
  const parsedIds = parsed.testCases
      .map(c => ({ testCase: c, parts: splitId(c.testCaseId) }))
      .filter((entry): entry is { testCase: typeof entry.testCase; parts: NonNullable<typeof entry.parts> } =>
        entry.parts !== null);

  /** Most-used prefix among a set of rows, so one stray ID cannot hijack the scheme. */
  const dominantPrefix = (rows: typeof parsedIds): string | null => {
    const counts = new Map<string, number>();
    for (const row of rows)
      counts.set(row.parts.prefix, (counts.get(row.parts.prefix) ?? 0) + 1);
    let best: string | null = null;
    let bestCount = 0;
    for (const [prefix, count] of counts) {
      if (count > bestCount) {
        best = prefix;
        bestCount = count;
      }
    }
    return best;
  };

  const inSheet = parsedIds.filter(r => r.testCase.source.worksheet === worksheet);
  const inModule = module.trim()
    ? parsedIds.filter(r => r.testCase.module.trim().toLowerCase() === module.trim().toLowerCase())
    : [];

  let prefix = dominantPrefix(inSheet);
  let basis = prefix ? `continuing "${worksheet}"` : '';
  if (!prefix) {
    prefix = dominantPrefix(inModule);
    basis = prefix ? `continuing the ${module} module` : '';
  }
  if (!prefix) {
    prefix = derivePrefix(module.trim() || worksheet.trim() || 'case');
    basis = `new prefix from "${module.trim() || worksheet.trim()}"`;
  }

  // Highest number for this prefix anywhere in the workbook, so two sheets
  // sharing a prefix cannot produce the same ID.
  const sameParts = parsedIds.filter(r => r.parts.prefix === prefix);
  const highest = sameParts.reduce((max, r) => Math.max(max, r.parts.number), 0);
  const width = sameParts.length
    ? Math.max(...sameParts.map(r => r.parts.width))
    : 3;

  const taken = new Set(parsed.testCases.map(c => c.testCaseId.toUpperCase()));
  let next = highest + 1;
  let candidate = `${prefix}${String(next).padStart(width, '0')}`;
  // Belt and braces: a hand-written ID could already sit above the maximum in a
  // different format. Never hand back one that exists.
  while (taken.has(candidate.toUpperCase())) {
    next++;
    candidate = `${prefix}${String(next).padStart(width, '0')}`;
  }

  return { testCaseId: candidate, basis };
}

/** Excel's own rules for a worksheet name, which ExcelJS will not enforce for us. */
export function validateSheetName(name: string): string | null {
  const value = name.trim();
  if (!value)
    return 'Worksheet name is required.';
  if (value.length > 31)
    return 'Excel worksheet names are limited to 31 characters.';
  if (/[:\\/?*[\]]/.test(value))
    return 'Worksheet names cannot contain : \\ / ? * [ ]';
  if (/^'|'$/.test(value))
    return 'Worksheet names cannot start or end with an apostrophe.';
  return null;
}

/** Column order for a sheet this form creates from scratch. */
const NEW_SHEET_COLUMNS: CanonicalField[] = [
  'testCaseId', 'module', 'feature', 'scenario', 'description', 'requirementId',
  'testType', 'priority', 'businessRisk', 'tags', 'environment', 'userRole',
  'authenticationProfile', 'testOwner', 'preconditions', 'steps', 'testData',
  'expectedResult', 'expectedOutcome', 'expectedMessage', 'execute',
];

const NEW_SHEET_WIDTHS = [16, 12, 16, 40, 40, 14, 14, 9, 12, 18, 12, 16, 22, 14, 34, 46, 34, 46, 16, 40, 7];

/** Column headings created when the target sheet does not have them yet. */
const HEADINGS: Partial<Record<CanonicalField, string>> = {
  testCaseId: 'Test Case ID',
  module: 'Module',
  feature: 'Feature',
  scenario: 'Scenario',
  steps: 'Steps',
  testData: 'Test Data',
  expectedResult: 'Expected Result',
  expectedOutcome: 'Assert Outcome',
  expectedMessage: 'Assert Message',
  priority: 'Priority',
  tags: 'Tags',
  execute: 'Run',
  description: 'Test Case Description',
  preconditions: 'Pre-Requisite',
  requirementId: 'Requirement ID',
  testType: 'Test Type',
  businessRisk: 'Business Risk',
  environment: 'Environment',
  userRole: 'User Role',
  authenticationProfile: 'Auth Profile',
  testOwner: 'Test Owner',
};

/**
 * Check a draft the way the runner will read it.
 *
 * Returns the problems in the order a person would fix them. An empty array
 * means this row will parse into a runnable case.
 */
export function validateDraft(submitted: CaseDraft, parsed: ParseResult, isNew: boolean): string[] {
  // Normalised first, always. A sender that omits an optional field gets it as
  // empty; a sender that omits a required one gets told which, rather than a
  // TypeError from the first `.trim()` that reaches it.
  const draft = normalizeDraft(submitted);
  const problems: string[] = [];
  const id = draft.testCaseId.trim();

  // A blank ID on a new case is not an error: it means "generate one".
  if (!id && !isNew)
    problems.push('Test Case ID is required - it is how automation traces back to the workbook.');
  else if (id && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id))
    problems.push('Test Case ID may only contain letters, digits, hyphens and underscores.');

  if (isNew && id && parsed.testCases.some(c => c.testCaseId.toUpperCase() === id.toUpperCase()))
    problems.push(`Test Case ID "${id}" already exists in this workbook. IDs must be unique.`);

  const sheetProblem = validateSheetName(draft.worksheet);
  if (sheetProblem)
    problems.push(sheetProblem);

  if (!draft.scenario.trim())
    problems.push('Scenario is required - it becomes the test title after the ID.');

  if (!draft.steps.trim())
    problems.push('Steps are required. They do not drive a data-driven run, but they are what a person reads.');

  if (!draft.expectedResult.trim())
    problems.push('Expected Result is required - the sentence a human can check the run against.');

  const declared = draft.assertOutcome.trim();
  if (declared && !(OUTCOMES as string[]).includes(declared))
    problems.push(`Assert Outcome must be one of: ${OUTCOMES.join(', ')}, or blank.`);

  if (!declared) {
    // Blank is a legitimate answer, not a missing one: it means the assertion
    // lives in a spec rather than in the spreadsheet. Test Data is then free
    // prose for whoever writes that spec, so it is not parsed as a contract -
    // but a credential typed into it is a leaked credential either way.
    const asContract = parseInputs(draft.testData);
    if (!('error' in asContract))
      problems.push(...credentialProblems(asContract as Record<string, { kind: string; value?: string }>));
  } else {
    problems.push(...contractProblems(draft));
  }

  if (draft.assertMessage.trim() && draft.assertOutcome !== 'Error') {
    problems.push('Assert Message only applies when Assert Outcome is Error - ' +
      'a blocked or successful submission has no message to match.');
  }
  if (draft.assertMessage.trim()) {
    const matcher = parseMatcher(draft.assertMessage);
    if (matcher?.kind === 'regex') {
      try {
        new RegExp(matcher.source, matcher.flags);
      } catch (error) {
        problems.push(`Assert Message is not a valid regular expression: ${(error as Error).message}`);
      }
    }
  }

  problems.push(...enumProblems(draft));
  problems.push(...referenceProblems(draft));
  problems.push(...freeTextCredentialProblems(draft));

  return problems;
}

/**
 * Controlled fields, checked against their lists.
 *
 * Blank is always allowed - every P1 field is optional, and a row written before
 * they existed has none of them. What is refused is a value that is neither
 * blank nor one of the list: it can only come from a hand-edited cell or a
 * stale form, and accepting it would put an unqueryable string in a column the
 * whole point of which is that it can be counted.
 */
function enumProblems(draft: CaseDraft): string[] {
  const problems: string[] = [];
  const check = (label: string, value: string, allowed: readonly string[]) => {
    const text = value.trim();
    if (text && !allowed.some(option => option.toLowerCase() === text.toLowerCase()))
      problems.push(`${label} must be one of: ${allowed.join(', ')}, or blank.`);
  };
  check('Priority', draft.priority, PRIORITIES);
  check('Test Type', draft.testType, TEST_TYPES);
  check('Business Risk', draft.businessRisk, BUSINESS_RISKS);
  return problems;
}

/**
 * References that must stay references.
 *
 * The Authentication Profile is the one field where a mistake is a security
 * incident rather than a typo: it names an account, and a person who types the
 * account's address or password into it has put a credential in a shared file.
 * So it is checked twice - the shape it must have, and the shapes it must not.
 */
function referenceProblems(draft: CaseDraft): string[] {
  const problems: string[] = [];
  const profile = draft.authenticationProfile.trim();
  if (profile) {
    if (profile.includes('@') || /\s/.test(profile)) {
      problems.push('Authentication Profile is a profile NAME, not an account. '
        + 'Use something like APPLICATION_QA_USER; the address and password stay in the environment.');
    } else if (!AUTH_PROFILE_PATTERN.test(profile)) {
      problems.push('Authentication Profile must look like APPLICATION_QA_USER - '
        + 'capitals, digits and underscores, at least three characters.');
    }
  }
  const requirement = draft.requirementId.trim();
  if (requirement && !REQUIREMENT_ID_PATTERN.test(requirement))
    problems.push(`Requirement ID "${requirement}" is not a recognisable identifier (e.g. PROJ-1234).`);
  return problems;
}

/**
 * A credential typed into ANY authored field, not just Test Data.
 *
 * The original check looked only at Test Data, because that was the only place a
 * `name = value` pair was expected. A person filling in a new Preconditions or
 * Description box has just as many opportunities, and the workbook is just as
 * shared. `credentialsIn` is the single rule, shared with the readiness layer.
 */
function freeTextCredentialProblems(draft: CaseDraft): string[] {
  const problems: string[] = [];
  const fields: Array<[string, string]> = [
    ['Scenario', draft.scenario], ['Description', draft.description],
    ['Preconditions', draft.preconditions], ['Test Data', draft.testData],
    ['Expected Result', draft.expectedResult], ['Assert Message', draft.assertMessage],
    ['Requirement ID', draft.requirementId], ['Environment', draft.environment],
    ['User Role', draft.userRole], ['Test Owner', draft.testOwner],
    ['Authentication Profile', draft.authenticationProfile],
  ];
  for (const [label, value] of fields) {
    const names = credentialsIn(value);
    if (names.length) {
      problems.push(`${label} looks like it contains a credential (${names.join(', ')}). `
        + 'Never type one into the workbook: use <valid-password>, which is read from the '
        + 'environment when the test runs, or an Authentication Profile.');
    }
  }
  return problems;
}

/** A password typed into a spreadsheet is a leaked password, in either mode. */
function credentialProblems(inputs: Record<string, { kind: string; value?: string }>): string[] {
  const problems: string[] = [];
  for (const [name, token] of Object.entries(inputs)) {
    if (/pass|secret|token|pwd/i.test(name) && token.kind === 'literal' && token.value) {
      problems.push(`"${name}" has a literal value. Never type a credential into the workbook - ` +
        'use <valid-password>, which is read from .env when the test runs.');
    }
  }
  return problems;
}

/** The data-driven contract checks. Only meaningful when an outcome is declared. */
function contractProblems(draft: CaseDraft): string[] {
  const problems: string[] = [];
  const inputs = parseInputs(draft.testData);
  if ('error' in inputs) {
    problems.push(inputs.error as string);
  } else {
    if (draft.assertOutcome === 'Visible' && !(inputs as Record<string, unknown>).expect) {
      problems.push('Assert Outcome = Visible needs an "expect" line naming what must be on the ' +
        'page, e.g. expect = My Favourites, All, Team Projects. Without it the row would pass as ' +
        'soon as the page loaded, having checked nothing.');
    }
    problems.push(...credentialProblems(inputs as Record<string, { kind: string; value?: string }>));

    // The outcome has to be able to witness what the Expected Result claims.
    // "Check My Favourites is displayed" with Assert Outcome = Signed In is a
    // test that goes green the moment the page changes, having looked for
    // nothing. `repairDraft` has already fixed the rows whose repair follows
    // from what the author wrote, so anything still here needs a decision only
    // they can make.
    const gap = contractGap({
      scenario: draft.scenario,
      expectedResult: draft.expectedResult,
      outcome: draft.assertOutcome as Outcome,
      inputNames: Object.keys(inputs as Record<string, unknown>),
      steps: splitSteps(draft.steps),
      submit: (inputs as Record<string, { value?: string }>).submit?.value,
    });
    if (gap)
      problems.push(gap.message);
  }
  return problems;
}

/**
 * Strengthen a contract that cannot prove its own Expected Result, where the
 * repair follows from what the author already wrote.
 *
 * The only rewrite it makes is the one with a single possible answer: a row
 * claiming that named items are on the screen, asserted with `Signed In`, which
 * witnesses nothing beyond the page changing. `Visible` witnesses exactly that
 * claim, and the items come from the author's own Expected Result - never
 * invented. A row whose Expected Result names nothing checkable ("all should be
 * visible") is left alone and refused by `validateDraft`, because inventing what
 * "all" meant would only swap a green lie for a red one.
 *
 * This writes an authored column, which nothing else in the toolkit does. It is
 * allowed here for the same reason the form itself is: the author is saving
 * their own row, in the one place a UI owns those cells. What it must never be
 * is silent - every change is returned and shown on the page.
 */
export function repairDraft(draft: CaseDraft): { draft: CaseDraft; applied: string[] } {
  // No declared outcome means no contract to strengthen: the assertion is going
  // to live in a spec, and this module has nothing to say about spec code.
  if (!draft.assertOutcome.trim())
    return { draft, applied: [] };

  const inputs = parseInputs(draft.testData);
  if ('error' in inputs)
    return { draft, applied: [] };

  const gap = contractGap({
    scenario: draft.scenario,
    expectedResult: draft.expectedResult,
    outcome: draft.assertOutcome as Outcome,
    inputNames: Object.keys(inputs as Record<string, unknown>),
    steps: splitSteps(draft.steps),
    submit: (inputs as Record<string, { value?: string }>).submit?.value,
  });

  // The row's steps ask for actions no shared runner performs, so no contract
  // can be right for it. Clearing the outcome loses nothing the author wrote -
  // in spec mode Test Data stays on the row as notes for the generator - and it
  // moves the case to the only mode that can express it.
  if (gap?.clearOutcome) {
    return {
      draft: { ...draft, assertOutcome: '', assertMessage: '' },
      applied: [`Assert Outcome cleared (was "${draft.assertOutcome}"). ${gap.message}`],
    };
  }

  if (!gap?.repair)
    return { draft, applied: [] };

  const applied: string[] = [];
  const repaired: CaseDraft = { ...draft };

  if (repaired.assertOutcome !== gap.repair.outcome) {
    applied.push(`Assert Outcome changed from "${draft.assertOutcome}" to "${gap.repair.outcome}" - ` +
      `"${draft.assertOutcome}" cannot see what this case says should be on the screen.`);
    repaired.assertOutcome = gap.repair.outcome;
  }

  if (gap.repair.expect) {
    const line = `expect = ${gap.repair.expect}`;
    repaired.testData = `${draft.testData.trim()}\n${line}`.trim();
    applied.push(`Added "${line}" to Test Data, taken from the Expected Result. ` +
      'Correct it if those are not the exact words on the page.');
  }

  return { draft: repaired, applied };
}

function normalizeHeading(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Create or update one row.
 *
 * Matched by Test Case ID read back from the file, never by remembered row
 * number, so a workbook edited in Excel since the page loaded cannot have the
 * wrong row overwritten.
 */
export async function saveCase(
  workbookPath: string,
  submitted: CaseDraft,
  isNew: boolean,
): Promise<{
  backup: string; row: number; created: boolean; columnsAdded: string[]; testCaseId: string;
  /** Contract repairs applied on the way in. Empty when the draft was already sound. */
  repairs: string[];
}> {
  const parsed = await parseWorkbook(workbookPath);
  // Repair before validating: a row whose only fault is an outcome too weak to
  // prove its own Expected Result is fixed rather than bounced back. Normalised
  // before either, so both are working on a complete object - see normalizeDraft.
  const { draft, applied: repairs } = repairDraft(normalizeDraft(submitted));
  const problems = validateDraft(draft, parsed, isNew);
  if (problems.length)
    throw new UserFacingError(problems.join('\n'));

  const sheetReport = parsed.worksheets.find(s => s.worksheet === draft.worksheet && s.recognized);
  const creatingSheet = !parsed.worksheets.some(s => s.worksheet === draft.worksheet);
  if (!creatingSheet && (!sheetReport || sheetReport.headerRow === undefined)) {
    throw new UserFacingError(`"${draft.worksheet}" exists but is not a recognisable test-case ` +
      'table, so a row added to it would never be parsed. Pick another sheet, or give it a header row.');
  }
  if (creatingSheet && !isNew)
    throw new UserFacingError(`Cannot edit a case in "${draft.worksheet}" - that sheet does not exist.`);

  // Generated here, not in the browser: this is after the final re-parse and
  // immediately before the write, so two tabs cannot be handed the same number.
  const generatedId = draft.testCaseId.trim()
    || suggestTestCaseId(parsed, draft.worksheet, draft.module).testCaseId;

  assertWritable(workbookPath,
      '  Close it in Excel, then press Save again. Nothing has been changed.');

  const workbook = new Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const backup = backupPath(workbookPath, new Date().toISOString());
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(workbookPath, backup);

  let sheet = workbook.getWorksheet(draft.worksheet);
  const columnsAdded: string[] = [];
  let headerRowNumber = sheetReport?.headerRow ?? 1;

  if (!sheet) {
    // A brand-new sheet gets the full column set in a fixed order, so the very
    // first row written to it is already a complete, parseable test case.
    sheet = workbook.addWorksheet(draft.worksheet, { views: [{ state: 'frozen', ySplit: 1 }] });
    const created = sheet.addRow(NEW_SHEET_COLUMNS.map(field => HEADINGS[field]!));
    created.font = { bold: true };
    created.alignment = { vertical: 'middle', wrapText: true };
    created.height = 28;
    NEW_SHEET_WIDTHS.forEach((width, index) => { sheet!.getColumn(index + 1).width = width; });
    headerRowNumber = 1;
    columnsAdded.push(`new sheet "${draft.worksheet}"`);
  }

  const headerRow = sheet.getRow(headerRowNumber);
  let nextFree = Math.max(sheet.columnCount, sheetReport?.bindings.length ?? 0) + 1;

  /** Column index for a field, creating the column when the sheet lacks it. */
  const columnFor = (field: CanonicalField): number => {
    const existing = sheetReport?.bindings.find(b => b.field === field);
    if (existing)
      return existing.column;
    const heading = HEADINGS[field];
    if (!heading)
      throw new UserFacingError(`No column for "${field}" and no heading to create one.`);
    let found = 0;
    headerRow.eachCell({ includeEmpty: false }, (cellValue, columnNumber) => {
      if (!found && normalizeHeading(cellValue.value) === normalizeHeading(heading))
        found = columnNumber;
    });
    if (!found) {
      found = nextFree++;
      const cell = headerRow.getCell(found);
      cell.value = heading;
      cell.font = { bold: true };
      columnsAdded.push(heading);
    }
    return found;
  };

  const targets: Array<[CanonicalField, string]> = [
    ['testCaseId', generatedId],
    ['module', draft.module.trim()],
    ['feature', draft.feature.trim()],
    ['scenario', draft.scenario.trim()],
    ['description', draft.description.trim()],
    ['preconditions', draft.preconditions.trim()],
    ['requirementId', draft.requirementId.trim()],
    ['testType', draft.testType.trim()],
    ['businessRisk', draft.businessRisk.trim()],
    ['environment', draft.environment.trim()],
    ['userRole', draft.userRole.trim()],
    ['authenticationProfile', draft.authenticationProfile.trim()],
    ['testOwner', draft.testOwner.trim()],
    ['steps', draft.steps.trim()],
    ['testData', draft.testData.trim()],
    ['expectedResult', draft.expectedResult.trim()],
    ['expectedOutcome', draft.assertOutcome],
    ['expectedMessage', draft.assertMessage.trim()],
    ['priority', draft.priority.trim()],
    ['tags', draft.tags.trim()],
    ['execute', draft.run ? 'Yes' : 'No'],
  ];
  // Resolve every column before writing any of them, so a failure part-way
  // through cannot leave a half-written row behind.
  const resolved = targets.map(([field, value]) => [columnFor(field), value] as const);
  headerRow.commit();

  const idColumn = columnFor('testCaseId');
  let rowNumber = 0;
  if (!isNew) {
    for (let n = headerRowNumber + 1; n <= sheet.rowCount; n++) {
      const value = String(sheet.getRow(n).getCell(idColumn).value ?? '').trim();
      if (value.toUpperCase() === generatedId.toUpperCase()) {
        rowNumber = n;
        break;
      }
    }
    if (!rowNumber)
      throw new UserFacingError(`${generatedId} is no longer in "${draft.worksheet}".`);
  } else {
    rowNumber = sheet.rowCount + 1;
  }

  const row = sheet.getRow(rowNumber);
  for (const [column, value] of resolved)
    row.getCell(column).value = value || null;
  row.alignment = { vertical: 'top', wrapText: true };
  row.commit();

  await workbook.xlsx.writeFile(workbookPath);
  return { backup, row: rowNumber, created: isNew, columnsAdded, testCaseId: generatedId, repairs };
}

/** The editable shape of an existing row, for populating the form. */
export async function readCase(workbookPath: string, testCaseId: string): Promise<CaseDraft | null> {
  const parsed = await parseWorkbook(workbookPath);
  const testCase = parsed.testCases.find(c => c.testCaseId.toUpperCase() === testCaseId.toUpperCase());
  if (!testCase)
    return null;
  return {
    worksheet: testCase.source.worksheet,
    testCaseId: testCase.testCaseId,
    module: testCase.module,
    feature: testCase.feature,
    scenario: testCase.scenario,
    description: testCase.description,
    preconditions: testCase.preconditions,
    requirementId: testCase.requirementId,
    testType: testCase.testType,
    businessRisk: testCase.businessRisk,
    environment: testCase.environment,
    userRole: testCase.userRole,
    authenticationProfile: testCase.authenticationProfile,
    testOwner: testCase.testOwner,
    steps: testCase.steps.join('\n'),
    testData: testCase.testData,
    expectedResult: testCase.expectedResult,
    assertOutcome: testCase.expectedOutcome,
    assertMessage: testCase.expectedMessage,
    priority: testCase.priority,
    tags: testCase.tags.join(', '),
    run: testCase.execute === true,
  };
}

/** Outcome values the form offers, exported so the UI cannot drift from them. */
export const OUTCOME_OPTIONS: Outcome[] = OUTCOMES;
