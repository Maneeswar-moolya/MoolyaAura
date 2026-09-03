/**
 * Writing results back into the source workbook, in place.
 *
 * This is the one operation in the toolkit that modifies a file a tester owns,
 * so it is opt-in (`--in-place`) and defended in three ways:
 *
 *   1. A timestamped backup is written BEFORE the workbook is touched, every
 *      time. No backup, no write.
 *   2. Only result columns are written. Every authored column - id, steps,
 *      expected result - is read and rewritten untouched.
 *   3. Rows are matched by Test Case ID read back from the file, never by
 *      position, so a workbook that gained or lost rows since the run cannot
 *      have results written against the wrong case.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Workbook, type Worksheet } from 'exceljs';

import type { ReportRow } from './execution-report';
import type { ParseResult } from './types';

/** Columns this module owns. Anything else in the sheet is left alone. */
export const RESULT_COLUMNS = [
  'Automation Status',
  'Execution Status',
  'Duration (s)',
  'Failure Reason',
  'Root Cause',
  'Healing Performed',
  'Final Status',
  'Test File',
  'Last Execution Time',
  /** Hyperlink to this case's row in the HTML report. */
  'Report',
  /** Hyperlink to the Playwright report - traces, screenshots, video. */
  'Evidence',
] as const;

type ResultColumn = (typeof RESULT_COLUMNS)[number];

/** Where the reports live, so the workbook can link to them. */
export interface ReportLinks {
  /** Absolute path to reports/excel-execution-report.html */
  htmlReport?: string;
  /** Absolute path to the Playwright HTML report directory. */
  playwrightReport?: string;
}

/**
 * Hyperlinks are written RELATIVE to the workbook, so the pair keeps working
 * when the repository is cloned elsewhere. An absolute path would break on
 * every other machine, and Excel resolves relative links against the
 * workbook's own location.
 */
function relativeLink(fromWorkbook: string, target: string): string {
  return path.relative(path.dirname(fromWorkbook), target).replace(/\\/g, '/');
}

const LINK_FONT = { color: { argb: 'FF0563C1' }, underline: true } as const;

function valueFor(column: ResultColumn, row: ReportRow): string | number {
  switch (column) {
    case 'Automation Status': return row.automationStatus;
    case 'Execution Status': return row.executionStatus;
    case 'Duration (s)': return row.durationSeconds === '' ? '' : row.durationSeconds;
    case 'Failure Reason': return row.failureReason;
    case 'Root Cause': return row.rootCause;
    case 'Healing Performed': return row.healingPerformed;
    case 'Final Status': return row.finalStatus;
    case 'Test File': return row.testFile;
    case 'Last Execution Time': return row.lastExecutionTime;
    // Link columns are written separately - see writeLinkCell.
    case 'Report': case 'Evidence': return '';
  }
}

/**
 * Write a clickable cell, or plain text when there is nothing to link to.
 * A link that goes nowhere is worse than no link.
 */
function writeLinkCell(
  cell: { value: unknown; font?: unknown },
  text: string,
  target: string | null,
): void {
  if (!target) {
    cell.value = text;
    return;
  }
  cell.value = { text, hyperlink: target };
  cell.font = LINK_FONT;
}

function normalizeHeading(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** `login-test-cases.xlsx` -> `excel/.backups/login-test-cases.2026-08-10T08-15-00-000Z.xlsx` */
export function backupPath(workbookPath: string, stamp: string): string {
  const dir = path.join(path.dirname(workbookPath), '.backups');
  const ext = path.extname(workbookPath);
  const base = path.basename(workbookPath, ext);
  return path.join(dir, `${base}.${stamp.replace(/[:.]/g, '-')}${ext}`);
}

/**
 * Excel takes an exclusive lock on an open workbook, so writing to it fails
 * with EBUSY/EPERM. Check before doing any work: a clear "close the file"
 * beats a stack trace after the tests have already run, and it guarantees we
 * never leave a backup behind for a write that was never going to succeed.
 */
/**
 * A problem the user can fix, reported as a plain message. A stack trace for
 * "your file is open in Excel" hides the one line that matters.
 */
export class UserFacingError extends Error {}

const CLI_LOCK_REMEDY =
  '  Close the workbook and run the command again.\n' +
  '  Or keep it open and use --no-in-place, which leaves the source untouched and writes\n' +
  '  reports/excel-execution-report.xlsx instead.';

/**
 * @param remedy What the caller should tell the user to do. The CLI and the
 * dashboard offer different ways out, and "use --no-in-place" is useless advice
 * to someone looking at a web form.
 */
export function assertWritable(workbookPath: string, remedy: string = CLI_LOCK_REMEDY): void {
  let handle: number | undefined;
  try {
    handle = fs.openSync(workbookPath, 'r+');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new UserFacingError(
          `Cannot write to ${path.basename(workbookPath)} - it is open in Excel (or another program) ` +
          `which holds an exclusive lock.\n${remedy}`);
    }
    throw error;
  } finally {
    if (handle !== undefined)
      fs.closeSync(handle);
  }
}

export interface WritebackResult {
  workbookPath: string;
  backup: string;
  rowsUpdated: number;
  columnsAdded: string[];
  unmatched: string[];
}

/**
 * Merge execution results into the workbook the cases came from.
 *
 * Result columns that already exist are updated in place; missing ones are
 * appended to the right of the existing table, so the author's column order is
 * preserved.
 */
export async function writeResultsIntoWorkbook(options: {
  parsed: ParseResult;
  rows: ReportRow[];
  timestamp: string;
  links?: ReportLinks;
  /**
   * Restrict the write to these Test Case IDs.
   *
   * Essential for a filtered run. `rows` always covers the whole workbook, and
   * a case with no execution record reads as "Not Run" - so writing every row
   * after `--sheet "Create Project"` would blank out the Login sheet's passing
   * results. Rows outside this set keep whatever they already had.
   *
   * Omit to write every row, which is right for a full run.
   */
  onlyTestCaseIds?: Set<string>;
}): Promise<WritebackResult> {
  const { parsed, rows, timestamp, links, onlyTestCaseIds } = options;
  const workbookPath = parsed.workbookPath;

  if (!fs.existsSync(workbookPath))
    throw new Error(`Source workbook has gone missing: ${workbookPath}`);

  // 0. Fail fast if the file is locked, before writing a backup for a write
  //    that cannot succeed.
  assertWritable(workbookPath);

  // 1. Back up first. If this fails, nothing is modified.
  const backup = backupPath(workbookPath, timestamp);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(workbookPath, backup);

  const byId = new Map(rows.map(row => [row.testCaseId.toUpperCase(), row]));
  const workbook = new Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const columnsAdded: string[] = [];
  const written = new Set<string>();
  let rowsUpdated = 0;

  for (const sheetReport of parsed.worksheets) {
    if (!sheetReport.recognized || sheetReport.headerRow === undefined)
      continue;
    const sheet: Worksheet | undefined = workbook.getWorksheet(sheetReport.worksheet);
    if (!sheet)
      continue;

    const headerRow = sheet.getRow(sheetReport.headerRow);
    const idBinding = sheetReport.bindings.find(binding => binding.field === 'testCaseId');
    if (!idBinding)
      continue;

    // Locate each result column, creating it if the workbook has none.
    let nextFreeColumn = Math.max(sheet.columnCount, sheetReport.bindings.length) + 1;
    const columnFor = new Map<ResultColumn, number>();
    for (const name of RESULT_COLUMNS) {
      const target = normalizeHeading(name);
      let found = 0;
      headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (!found && normalizeHeading(cell.value) === target)
          found = columnNumber;
      });
      // The author's own "Automation" column counts as Automation Status.
      if (!found && name === 'Automation Status') {
        const existing = sheetReport.bindings.find(binding => binding.field === 'automationStatus');
        if (existing)
          found = existing.column;
      }
      if (!found) {
        found = nextFreeColumn++;
        const cell = headerRow.getCell(found);
        cell.value = name;
        cell.font = { bold: true };
        columnsAdded.push(`${sheetReport.worksheet}!${name}`);
      }
      columnFor.set(name, found);
    }
    headerRow.commit();

    // Match by the ID read back from the file, not by remembered row number.
    for (let rowNumber = sheetReport.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const sheetRow = sheet.getRow(rowNumber);
      const id = String(sheetRow.getCell(idBinding.column).value ?? '').trim();
      if (!id)
        continue;
      const result = byId.get(id.toUpperCase());
      if (!result)
        continue;
      // Outside this run's scope - leave its previous results alone.
      if (onlyTestCaseIds && !onlyTestCaseIds.has(id.toUpperCase()))
        continue;

      for (const name of RESULT_COLUMNS) {
        const cell = sheetRow.getCell(columnFor.get(name)!);
        if (name === 'Report') {
          // Anchored at this case's row in the HTML report.
          writeLinkCell(cell, links?.htmlReport ? 'Open report' : '',
              links?.htmlReport ? `${relativeLink(workbookPath, links.htmlReport)}#${result.testCaseId}` : null);
        } else if (name === 'Evidence') {
          // Traces, screenshots and video only exist for cases that actually ran.
          const ran = Boolean(result.lastExecutionTime);
          writeLinkCell(cell, ran ? 'Trace & video' : '',
              ran && links?.playwrightReport
                ? relativeLink(workbookPath, path.join(links.playwrightReport, 'index.html'))
                : null);
        } else {
          cell.value = valueFor(name, result) as never;
        }
      }
      sheetRow.commit();
      written.add(id.toUpperCase());
      rowsUpdated++;
    }
  }

  await workbook.xlsx.writeFile(workbookPath);

  return {
    workbookPath,
    backup,
    rowsUpdated,
    columnsAdded,
    unmatched: rows.filter(row => !written.has(row.testCaseId.toUpperCase())).map(row => row.testCaseId),
  };
}
