/** Canonical workbook authoring helpers used by dashboard project provisioning.
 * Preserve authored and result column contracts for every application.
 */

import type { Workbook, Worksheet } from 'exceljs';

/** The canonical header row. Every entry is a declared synonym in `column-map.ts`. */
export const CASE_HEADERS = [
  'TC ID', 'Module', 'Feature', 'Test Scenario', 'Test Case Description', 'Pre-Requisite',
  'Test Steps', 'Test Data', 'Expected', 'Prio', 'Tags', 'Automation', 'Automation Notes', 'Run',
] as const;

/** Column widths, index-aligned with `CASE_HEADERS`. */
export const CASE_WIDTHS = [15, 11, 19, 40, 50, 38, 50, 40, 58, 7, 21, 15, 44, 7];

export type CaseRow = string[];

/**
 * Add a formatted test-case sheet.
 *
 * `banner` puts a title row above the header, which the demo workbook uses on one
 * sheet deliberately - a real workbook often has one, and the parser has to find the
 * header row rather than assume row 1. A provisioned workbook passes none.
 */
export function addCaseSheet(
  workbook: Workbook,
  name: string,
  rows: CaseRow[],
  banner?: string,
  headerColour = 'FF1F3864',
): Worksheet {
  const sheet = workbook.addWorksheet(name);

  if (banner) {
    sheet.addRow([banner]);
    sheet.getRow(1).font = { bold: true, size: 13 };
    sheet.addRow([]);
  }

  const headerRow = sheet.addRow([...CASE_HEADERS]);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColour } };

  for (const row of rows)
    sheet.addRow(row).alignment = { vertical: 'top', wrapText: true };

  CASE_WIDTHS.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: CASE_HEADERS.length },
  };
  return sheet;
}
