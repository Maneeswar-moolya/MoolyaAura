/**
 * Workbook -> normalized test cases.
 *
 * Reads every worksheet, finds the header row, maps columns, validates
 * mandatory fields and reports anything malformed instead of guessing.
 * This module is strictly read-only: it never opens a workbook for writing.
 */

import path from 'node:path';

import { Workbook, type Worksheet, type CellValue } from 'exceljs';

import { headerRowScore, mapColumns, normalizeHeader, REBOUND_HEADINGS } from './column-map';
import {
  type AutomationStatus,
  type CanonicalField,
  type ColumnBinding,
  type ParseIssue,
  type ParseResult,
  type Priority,
  type TestCase,
  type TestType,
  type BusinessRisk,
  BUSINESS_RISKS,
  TEST_TYPES,
  type WorksheetReport,
} from './types';

/** Rows scanned from the top of a sheet while looking for the header row. */
const HEADER_SEARCH_DEPTH = 15;

/** Fields a row must have before it can be automated at all. */
const MANDATORY_FIELDS: CanonicalField[] = ['testCaseId', 'steps', 'expectedResult'];

/** Flatten any ExcelJS cell value into plain trimmed text. */
function cellText(value: CellValue): string {
  if (value === null || value === undefined)
    return '';
  if (typeof value === 'string')
    return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date)
    return value.toISOString();
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText))
      return (record.richText as Array<{ text?: string }>).map(part => part.text ?? '').join('').trim();
    if (typeof record.text === 'string')
      return record.text.trim();
    if ('result' in record)
      return cellText(record.result as CellValue);
    if ('hyperlink' in record && typeof record.hyperlink === 'string')
      return record.hyperlink.trim();
  }
  return String(value).trim();
}

function rowValues(sheet: Worksheet, rowNumber: number): string[] {
  const row = sheet.getRow(rowNumber);
  const values: string[] = [];
  const width = Math.max(sheet.columnCount, row.cellCount);
  for (let column = 1; column <= width; column++)
    values.push(cellText(row.getCell(column).value));
  return values;
}

/**
 * Split a free-text steps cell into discrete actions.
 * Handles newlines, arrows, and numbered or bulleted lists.
 */
export function splitSteps(raw: string): string[] {
  if (!raw.trim())
    return [];

  let parts = raw.split(/\r?\n/).map(part => part.trim()).filter(Boolean);
  // A single line usually means the author used arrows or numbering inline.
  if (parts.length <= 1) {
    parts = raw
      .split(/\s*(?:→|->|=>|;|\|)\s*/)
      .map(part => part.trim())
      .filter(Boolean);
  }
  if (parts.length <= 1) {
    const numbered = raw.split(/\s*(?=\d+\s*[.)]\s+)/).map(part => part.trim()).filter(Boolean);
    if (numbered.length > 1)
      parts = numbered;
  }

  return parts
    .map(part => part.replace(/^\s*(?:\d+\s*[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
}

export function splitTags(raw: string): string[] {
  if (!raw.trim())
    return [];
  return raw
    .split(/[,;|\n]+|\s+(?=@)/)
    .map(tag => tag.trim().replace(/^@/, ''))
    .filter(Boolean);
}

const PRIORITY_ALIASES: Array<[RegExp, Priority]> = [
  [/^(p0|0|critical|highest|blocker|smoke)$/i, 'P0'],
  [/^(p1|1|high|major)$/i, 'P1'],
  [/^(p2|2|medium|normal|moderate)$/i, 'P2'],
  [/^(p3|3|low|minor|trivial)$/i, 'P3'],
];

export function normalizePriority(raw: string): Priority {
  const value = raw.trim();
  if (!value)
    return '';
  for (const [pattern, priority] of PRIORITY_ALIASES) {
    if (pattern.test(value))
      return priority;
  }
  return '';
}

/**
 * Match a cell against a controlled list, case- and space-insensitively.
 *
 * Anything unrecognised becomes empty rather than an error. These fields are
 * optional by construction, and a workbook that says "functional testing" in a
 * Test Type column has not broken anything - it has simply not said which of the
 * ten values it means, and the readiness layer is where that is reported.
 */
export function normalizeEnum<T extends readonly string[]>(
  raw: string,
  allowed: T,
): T[number] | '' {
  const value = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!value)
    return '';
  for (const candidate of allowed) {
    if (candidate.toLowerCase() === value)
      return candidate;
  }
  // `end to end` for `End-to-End`, `p 0` for `P0`: separators only, nothing else.
  const loose = value.replace(/[\s_-]+/g, '');
  for (const candidate of allowed) {
    if (candidate.toLowerCase().replace(/[\s_-]+/g, '') === loose)
      return candidate;
  }
  return '';
}

const AUTOMATION_ALIASES: Array<[RegExp, AutomationStatus]> = [
  [/^(automated|yes|y|done|complete[d]?|true)$/i, 'Automated'],
  [/^(generated|draft|in progress|wip)$/i, 'Generated'],
  [/^(needs review|need review|review|to review|blocked|ambiguous)$/i, 'Needs Review'],
  [/^(not automated|no|n|pending|manual|none|false|na|n\/a)$/i, 'Not Automated'],
];

/**
 * Read the Run column. Blank means "no opinion" (null), not "no" - a tester who
 * left the cell empty has not asked to exclude the case.
 */
export function normalizeExecuteFlag(raw: string): boolean | null {
  const value = raw.trim();
  if (!value)
    return null;
  if (/^(y|yes|true|1|x|run|include|✓|✔)$/i.test(value))
    return true;
  if (/^(n|no|false|0|skip|exclude|-)$/i.test(value))
    return false;
  return null;
}

export function normalizeAutomationStatus(raw: string): AutomationStatus {
  const value = raw.trim();
  if (!value)
    return 'Not Automated';
  for (const [pattern, status] of AUTOMATION_ALIASES) {
    if (pattern.test(value))
      return status;
  }
  return 'Not Automated';
}

function findHeaderRow(sheet: Worksheet): { row: number; headers: string[] } | null {
  let best: { row: number; headers: string[]; score: number } | null = null;
  const depth = Math.min(HEADER_SEARCH_DEPTH, sheet.rowCount);
  for (let rowNumber = 1; rowNumber <= depth; rowNumber++) {
    const headers = rowValues(sheet, rowNumber);
    const score = headerRowScore(headers);
    if (score > (best?.score ?? 0))
      best = { row: rowNumber, headers, score };
  }
  return best ? { row: best.row, headers: best.headers } : null;
}

function issue(
  severity: ParseIssue['severity'],
  code: string,
  message: string,
  worksheet: string,
  row: number,
  extra: Partial<ParseIssue> = {},
): ParseIssue {
  return { severity, code, message, worksheet, row, ...extra };
}

function parseWorksheet(
  sheet: Worksheet,
  workbookPath: string,
  collected: TestCase[],
  malformed: ParseIssue[],
  /** Workbook-level findings: heading rebindings, and nothing row-specific. */
  workbookIssues: ParseIssue[] = [],
): WorksheetReport {
  const header = findHeaderRow(sheet);
  if (!header) {
    return {
      worksheet: sheet.name,
      recognized: false,
      skipReason: 'no row in this sheet looks like a test-case header',
      bindings: [],
      rowsRead: 0,
      testCasesParsed: 0,
      malformedRows: 0,
    };
  }

  const bindings = mapColumns(header.headers);
  const byField = new Map<CanonicalField, ColumnBinding>();
  for (const binding of bindings) {
    if (binding.field)
      byField.set(binding.field, binding);
  }
  const unmapped = bindings.filter(binding => !binding.field && binding.header);

  // A heading that used to mean something else. `Type` was read as Tags and
  // `Criticality` as Priority until each got a column of its own; a workbook
  // written before that still parses, and now parses BETTER, but the author is
  // told rather than left to discover it from a report. Reported once per sheet,
  // as a warning: nothing is refused and no cell is changed.
  const rebindings: ParseIssue[] = [];
  for (const binding of bindings) {
    const moved = REBOUND_HEADINGS[normalizeHeader(binding.header)];
    if (moved && binding.field === moved.to) {
      rebindings.push(issue('warning', 'HEADING_REBOUND',
          `Column "${binding.header}" now maps to "${moved.to}" (it used to be read as "${moved.from}"). `
          + 'Nothing in the file changed; check the values are what that field means.',
          sheet.name, header.row, { field: moved.to }));
    }
  }
  workbookIssues.push(...rebindings);

  const read = (values: string[], field: CanonicalField): string => {
    const binding = byField.get(field);
    return binding ? (values[binding.column - 1] ?? '') : '';
  };

  let rowsRead = 0;
  let parsed = 0;
  let malformedRows = 0;

  for (let rowNumber = header.row + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const values = rowValues(sheet, rowNumber);
    if (values.every(value => !value))
      continue;
    rowsRead++;

    const testCaseId = read(values, 'testCaseId');
    const scenario = read(values, 'scenario');
    const description = read(values, 'description');

    // Without an ID there is nothing to trace automation back to, so the row
    // cannot become a test case - it is reported rather than invented.
    if (!testCaseId) {
      malformedRows++;
      malformed.push(issue(
        'error',
        'MISSING_TEST_CASE_ID',
        `Row has no Test Case ID and cannot be traced; nearest label: "${(scenario || description || values.find(Boolean) || '').slice(0, 60)}"`,
        sheet.name,
        rowNumber,
      ));
      continue;
    }

    const steps = splitSteps(read(values, 'steps'));
    const expectedResult = read(values, 'expectedResult');
    const issues: ParseIssue[] = [];

    for (const field of MANDATORY_FIELDS) {
      const empty = field === 'steps' ? steps.length === 0 : !read(values, field);
      if (!byField.has(field)) {
        issues.push(issue('error', `MISSING_COLUMN_${field.toUpperCase()}`,
            `Workbook has no column mapped to "${field}"`, sheet.name, rowNumber, { testCaseId, field }));
      } else if (empty) {
        issues.push(issue('error', `MISSING_${field.toUpperCase()}`,
            `Mandatory field "${field}" is empty`, sheet.name, rowNumber, { testCaseId, field }));
      }
    }

    if (!scenario && !description) {
      issues.push(issue('warning', 'MISSING_SCENARIO',
          'Neither Scenario nor Description is filled in', sheet.name, rowNumber, { testCaseId }));
    }

    const extra: Record<string, string> = {};
    for (const binding of unmapped) {
      const value = values[binding.column - 1] ?? '';
      if (value)
        extra[binding.header] = value;
    }

    collected.push({
      testCaseId,
      module: read(values, 'module'),
      feature: read(values, 'feature'),
      scenario: scenario || description,
      description,
      preconditions: read(values, 'preconditions'),
      steps,
      testData: read(values, 'testData'),
      expectedResult,
      priority: normalizePriority(read(values, 'priority')),
      tags: splitTags(read(values, 'tags')),
      automationStatus: normalizeAutomationStatus(read(values, 'automationStatus')),
      automationNotes: read(values, 'automationNotes'),
      execute: normalizeExecuteFlag(read(values, 'execute')),
      expectedOutcome: read(values, 'expectedOutcome'),
      expectedMessage: read(values, 'expectedMessage'),
      // P1 fields. Absent column -> empty string, which is what every workbook
      // written before them reads as, and what every consumer treats as "not
      // stated". Enums are normalised but never rejected here: a parser that
      // refused a row for an unknown Test Type would make an optional field
      // mandatory by the back door.
      requirementId: read(values, 'requirementId'),
      testType: normalizeEnum(read(values, 'testType'), TEST_TYPES),
      businessRisk: normalizeEnum(read(values, 'businessRisk'), BUSINESS_RISKS),
      environment: read(values, 'environment'),
      userRole: read(values, 'userRole'),
      authenticationProfile: read(values, 'authenticationProfile').trim(),
      testOwner: read(values, 'testOwner'),
      source: {
        workbookPath,
        workbook: path.basename(workbookPath),
        worksheet: sheet.name,
        row: rowNumber,
      },
      extra,
      issues,
    });
    parsed++;
  }

  return {
    worksheet: sheet.name,
    recognized: true,
    headerRow: header.row,
    bindings,
    rowsRead,
    testCasesParsed: parsed,
    malformedRows,
  };
}

/** Read a workbook and return every test case it contains. Never writes. */
export async function parseWorkbook(workbookPath: string): Promise<ParseResult> {
  const absolute = path.resolve(workbookPath);
  const workbook = new Workbook();
  await workbook.xlsx.readFile(absolute);

  const testCases: TestCase[] = [];
  const malformed: ParseIssue[] = [];
  const issues: ParseIssue[] = [];
  const worksheets: WorksheetReport[] = [];

  workbook.eachSheet(sheet => {
    worksheets.push(parseWorksheet(sheet, absolute, testCases, malformed, issues));
  });

  const seen = new Map<string, TestCase>();
  for (const testCase of testCases) {
    const key = testCase.testCaseId.toUpperCase();
    const first = seen.get(key);
    if (first) {
      const duplicate = issue('error', 'DUPLICATE_TEST_CASE_ID',
          `Test Case ID "${testCase.testCaseId}" is already used at ${first.source.worksheet}!row ${first.source.row}`,
          testCase.source.worksheet, testCase.source.row, { testCaseId: testCase.testCaseId });
      testCase.issues.push(duplicate);
      issues.push(duplicate);
    } else {
      seen.set(key, testCase);
    }
  }

  if (!worksheets.some(sheet => sheet.recognized)) {
    issues.push(issue('error', 'NO_TEST_CASE_SHEET',
        `No worksheet in ${path.basename(absolute)} contains a recognisable test-case table`, '(workbook)', 0));
  }

  return {
    workbookPath: absolute,
    workbook: path.basename(absolute),
    testCases,
    malformed,
    issues,
    worksheets,
  };
}

/** True when a test case is complete enough to attempt automation. */
export function isAutomatable(testCase: TestCase): boolean {
  return !testCase.issues.some(item => item.severity === 'error');
}
