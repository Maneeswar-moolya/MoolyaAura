/**
 * reports/excel-execution-report.xlsx
 *
 * Joins three sources - the source workbook, the traceability mapping and the
 * Playwright run - into one workbook a QA lead can hand to a client.
 *
 * Safety rule, enforced in code below: the source workbook is never written to.
 * A separate report workbook is always produced.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Workbook, type Worksheet } from 'exceljs';

import { renderHtmlReport } from './html-report';
import type { Mapping } from './mapping';
import type { ExecutionRecord, HealingRecord } from './results';
import type { AutomationStatus, ExecutionStatus, ParseResult, TestCase } from './types';

export interface ReportRow {
  testCaseId: string;
  scenario: string;
  module: string;
  priority: string;
  automationStatus: AutomationStatus;
  executionStatus: ExecutionStatus;
  durationSeconds: number | '';
  failureReason: string;
  rootCause: string;
  healingPerformed: string;
  finalStatus: string;
  testFile: string;
  lastExecutionTime: string;
}

const COLUMNS: Array<{ header: string; key: keyof ReportRow; width: number }> = [
  { header: 'Test Case ID', key: 'testCaseId', width: 18 },
  { header: 'Scenario', key: 'scenario', width: 42 },
  { header: 'Module', key: 'module', width: 16 },
  { header: 'Priority', key: 'priority', width: 10 },
  { header: 'Automation Status', key: 'automationStatus', width: 18 },
  { header: 'Execution Status', key: 'executionStatus', width: 17 },
  { header: 'Duration (s)', key: 'durationSeconds', width: 12 },
  { header: 'Failure Reason', key: 'failureReason', width: 60 },
  { header: 'Root Cause', key: 'rootCause', width: 44 },
  { header: 'Healing Performed', key: 'healingPerformed', width: 20 },
  { header: 'Final Status', key: 'finalStatus', width: 22 },
  { header: 'Test File', key: 'testFile', width: 40 },
  { header: 'Last Execution Time', key: 'lastExecutionTime', width: 22 },
];

const STATUS_FILL: Record<string, string> = {
  Passed: 'FFE3F5E1',
  Failed: 'FFFBE0E0',
  Skipped: 'FFF2F2F2',
  Blocked: 'FFFDF0DC',
  'Not Run': 'FFF7F7F7',
};

function findExecution(records: ExecutionRecord[], testCase: TestCase, mapping: Mapping): ExecutionRecord | undefined {
  const byId = records.find(record => record.testCaseId?.toUpperCase() === testCase.testCaseId.toUpperCase());
  if (byId)
    return byId;
  // Fall back to the mapped test name for specs whose title lost the ID prefix.
  const entry = mapping[testCase.testCaseId];
  return entry ? records.find(record => record.testName === entry.testName) : undefined;
}

function resolveAutomationStatus(testCase: TestCase, mapping: Mapping): AutomationStatus {
  const entry = mapping[testCase.testCaseId];
  if (entry?.status)
    return entry.status;
  // A blocking parse error means the row cannot be automated as written.
  if (testCase.issues.some(item => item.severity === 'error'))
    return 'Needs Review';
  return testCase.automationStatus;
}

function resolveFinalStatus(
  execution: ExecutionRecord | undefined,
  healing: HealingRecord | undefined,
  automationStatus: AutomationStatus,
): string {
  if (automationStatus === 'Needs Review')
    return 'Needs Review';
  if (!execution)
    return 'Not Run';
  if (healing?.healed && healing.rerunStatus)
    return healing.rerunStatus === 'Passed' ? 'Passed (after healing)' : `${healing.rerunStatus} (healing did not help)`;
  if (execution.flaky)
    return 'Passed (flaky - passed on retry)';
  return execution.executionStatus;
}

export function buildRows(
  parsed: ParseResult,
  mapping: Mapping,
  records: ExecutionRecord[],
  healingLog: Record<string, HealingRecord>,
): ReportRow[] {
  return parsed.testCases.map(testCase => {
    const execution = findExecution(records, testCase, mapping);
    const healing = healingLog[testCase.testCaseId];
    const automationStatus = resolveAutomationStatus(testCase, mapping);
    const entry = mapping[testCase.testCaseId];

    const healingPerformed = healing?.healed
      ? `Yes (${healing.attempts.filter(attempt => attempt.applied).length} locator(s))`
      : healing?.attempts.length ? 'Proposed - not applied' : 'No';

    // Why this case is not automated, in order of specificity: the parse error
    // that blocks it, else the reason a human recorded via `mapping review`.
    // Leaving this blank while Root Cause says "not automatable" tells the
    // reader nothing actionable.
    const blockingIssue = testCase.issues.find(item => item.severity === 'error');
    const notAutomatableReason = blockingIssue?.message ?? entry?.reviewReason ?? '';

    return {
      testCaseId: testCase.testCaseId,
      scenario: testCase.scenario,
      module: testCase.module,
      priority: testCase.priority,
      automationStatus,
      executionStatus: execution?.executionStatus ?? 'Not Run',
      durationSeconds: execution ? Number((execution.durationMs / 1000).toFixed(2)) : '',
      failureReason: execution?.failureReason || (automationStatus === 'Needs Review' ? notAutomatableReason : ''),
      rootCause: execution?.rootCause || (automationStatus === 'Needs Review' ? 'Test case is not automatable as written' : ''),
      healingPerformed,
      finalStatus: resolveFinalStatus(execution, healing, automationStatus),
      testFile: execution?.testFile || entry?.testFile || '',
      lastExecutionTime: execution?.lastExecutionTime ?? '',
    };
  });
}

export interface ReportSummary {
  total: number;
  automated: number;
  generated: number;
  notAutomated: number;
  needsReview: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  notRun: number;
  healed: number;
  flaky: number;
}

export function summarizeRows(rows: ReportRow[], healingLog: Record<string, HealingRecord>): ReportSummary {
  const count = (predicate: (row: ReportRow) => boolean) => rows.filter(predicate).length;
  return {
    total: rows.length,
    automated: count(row => row.automationStatus === 'Automated'),
    generated: count(row => row.automationStatus === 'Generated'),
    notAutomated: count(row => row.automationStatus === 'Not Automated'),
    needsReview: count(row => row.automationStatus === 'Needs Review'),
    passed: count(row => row.executionStatus === 'Passed'),
    failed: count(row => row.executionStatus === 'Failed'),
    skipped: count(row => row.executionStatus === 'Skipped'),
    blocked: count(row => row.executionStatus === 'Blocked'),
    notRun: count(row => row.executionStatus === 'Not Run'),
    healed: Object.values(healingLog).filter(record => record.healed).length,
    flaky: count(row => row.finalStatus.includes('flaky')),
  };
}

function styleHeader(sheet: Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
  header.alignment = { vertical: 'middle', horizontal: 'left' };
  header.height = 22;
}

function addResultsSheet(workbook: Workbook, rows: ReportRow[]): void {
  const sheet = workbook.addWorksheet('Execution Results', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map(column => ({ header: column.header, key: column.key, width: column.width }));
  styleHeader(sheet);

  for (const row of rows) {
    const added = sheet.addRow(row);
    added.alignment = { vertical: 'top', wrapText: true };
    const fill = STATUS_FILL[row.executionStatus];
    if (fill)
      added.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    if (row.automationStatus === 'Needs Review')
      added.getCell('automationStatus').font = { bold: true, color: { argb: 'FFB45309' } };
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
}

function addSummarySheet(
  workbook: Workbook,
  summary: ReportSummary,
  parsed: ParseResult,
  generatedAt: string,
  resultsPath: string | null,
): void {
  const sheet = workbook.addWorksheet('Summary');
  sheet.columns = [{ width: 34 }, { width: 52 }];

  sheet.addRow(['Excel Execution Report']).font = { bold: true, size: 16 };
  sheet.addRow([]);
  const meta: Array<[string, string]> = [
    ['Source workbook', parsed.workbook],
    ['Source path', parsed.workbookPath],
    ['Worksheets read', parsed.worksheets.filter(item => item.recognized).map(item => item.worksheet).join(', ') || '-'],
    ['Playwright results', resultsPath ?? 'not supplied - execution columns are "Not Run"'],
    ['Generated at', generatedAt],
    ['Source workbook modified', 'No - opened read-only'],
  ];
  for (const [label, value] of meta) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }

  sheet.addRow([]);
  sheet.addRow(['Totals']).font = { bold: true, size: 13 };
  const totals: Array<[string, number]> = [
    ['Total test cases', summary.total],
    ['Automated', summary.automated],
    ['Generated (awaiting first green run)', summary.generated],
    ['Not automated', summary.notAutomated],
    ['Needs review', summary.needsReview],
    ['Passed', summary.passed],
    ['Failed', summary.failed],
    ['Skipped', summary.skipped],
    ['Blocked', summary.blocked],
    ['Not run', summary.notRun],
    ['Healed', summary.healed],
    ['Flaky (passed on retry)', summary.flaky],
  ];
  for (const [label, value] of totals) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }

  if (parsed.malformed.length) {
    sheet.addRow([]);
    sheet.addRow(['Malformed rows skipped', parsed.malformed.length]).getCell(1).font = { bold: true };
    for (const issue of parsed.malformed.slice(0, 20))
      sheet.addRow([`${issue.worksheet} row ${issue.row}`, issue.message]);
  }
}

/**
 * Guard the one rule that matters most: a report must never be written over a
 * workbook a tester owns.
 */
function assertNotSourceWorkbook(outputPath: string, parsed: ParseResult): void {
  const output = path.resolve(outputPath);
  if (output.toLowerCase() === path.resolve(parsed.workbookPath).toLowerCase()) {
    throw new Error(
        `Refusing to write the execution report over the source workbook (${parsed.workbookPath}). ` +
        'Choose a different --out path.');
  }
}

export async function writeExecutionReport(options: {
  parsed: ParseResult;
  mapping: Mapping;
  records: ExecutionRecord[];
  healingLog: Record<string, HealingRecord>;
  outputPath: string;
  generatedAt: string;
  resultsPath: string | null;
  /** Where to write the HTML edition. Pass null to skip it. */
  htmlPath?: string | null;
}): Promise<{ rows: ReportRow[]; summary: ReportSummary; outputPath: string; htmlPath: string | null }> {
  const { parsed, mapping, records, healingLog, outputPath, generatedAt, resultsPath } = options;
  assertNotSourceWorkbook(outputPath, parsed);

  const rows = buildRows(parsed, mapping, records, healingLog);
  const summary = summarizeRows(rows, healingLog);

  const workbook = new Workbook();
  workbook.creator = 'Moolya Excel Test Case Integration';
  workbook.created = new Date(generatedAt);
  addSummarySheet(workbook, summary, parsed, generatedAt, resultsPath);
  addResultsSheet(workbook, rows);

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  await workbook.xlsx.writeFile(path.resolve(outputPath));

  // The HTML edition is rendered from the SAME rows and summary, so the two
  // formats cannot drift apart.
  let htmlPath: string | null = null;
  if (options.htmlPath !== null) {
    htmlPath = path.resolve(options.htmlPath ?? outputPath.replace(/\.xlsx$/i, '.html'));
    assertNotSourceWorkbook(htmlPath, parsed);
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, renderHtmlReport({
      parsed, mapping, rows, summary, healingLog, generatedAt, resultsPath,
      xlsxPath: path.relative(process.cwd(), path.resolve(outputPath)).replace(/\\/g, '/'),
    }), 'utf8');
  }

  return { rows, summary, outputPath: path.resolve(outputPath), htmlPath };
}
