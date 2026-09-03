/**
 * Excel Test Case Integration - normalized data model.
 *
 * Every workbook, whatever its column names, is reduced to the `TestCase`
 * shape below. Downstream consumers (generator, quality analyzer, execution
 * reporter) only ever see this model - never raw spreadsheet cells.
 */

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type Priority = (typeof PRIORITIES)[number] | '';

export const AUTOMATION_STATUSES = ['Not Automated', 'Generated', 'Automated', 'Needs Review'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const EXECUTION_STATUSES = ['Not Run', 'Passed', 'Failed', 'Skipped', 'Blocked'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/**
 * What KIND of test this is. Controlled, because "type" written freely becomes a
 * second tag column: the workbook already carries `Tags` for anything open-ended.
 */
export const TEST_TYPES = [
  'Functional', 'Regression', 'Smoke', 'Sanity', 'Negative', 'Integration',
  'End-to-End', 'Accessibility', 'Visual', 'Security',
] as const;
export type TestType = (typeof TEST_TYPES)[number] | '';

/**
 * What it costs the business when this breaks - deliberately NOT priority.
 *
 * Priority says when it runs; risk says what is at stake. A P2 case on a payment
 * path is Critical risk and low priority, and collapsing the two loses exactly
 * that distinction. The old `Criticality` heading used to bind to Priority; see
 * `column-map.ts` for why that synonym had to move.
 */
export const BUSINESS_RISKS = ['Critical', 'High', 'Medium', 'Low'] as const;
export type BusinessRisk = (typeof BUSINESS_RISKS)[number] | '';

/**
 * An authentication PROFILE NAME, never a credential.
 *
 * The row says which account a test needs (`BUGASURA_QA_USER`); the value lives
 * only in the environment. Anything that looks like an address or a secret is
 * refused at authoring time - a workbook is a shared file, and a password in one
 * is a leaked password whatever column it sits in.
 */
export const AUTH_PROFILE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

/** A requirement/story identifier: `PROJ-1234`, `JIRA_88`, `REQ 12`. */
export const REQUIREMENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*[ _-]?\d+$/;

/** Canonical field names a workbook column can be mapped onto. */
export const CANONICAL_FIELDS = [
  'testCaseId',
  'module',
  'feature',
  'scenario',
  'description',
  'preconditions',
  'steps',
  'testData',
  'expectedResult',
  'priority',
  'tags',
  'automationStatus',
  'automationNotes',
  /** Optional "Run" column - lets the workbook itself choose what executes. */
  'execute',
  /**
   * Optional data-driven contract. `expectedResult` states the expectation for
   * a human; these two state it for the runner, so a row can execute without a
   * spec being written. See ai/excel/data-driven.ts.
   */
  'expectedOutcome',
  'expectedMessage',
  /**
   * Enterprise authoring fields (P1). Every one is OPTIONAL: a workbook written
   * before they existed has no such column, reads as empty, and behaves exactly
   * as it did. Nothing here is ever required to parse, run or generate.
   */
  'requirementId',
  'testType',
  'businessRisk',
  'environment',
  'userRole',
  'authenticationProfile',
  'testOwner',
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/** Where a test case came from, so automation can point back at the source. */
export interface TestCaseSource {
  /** Absolute path of the workbook the row was read from. */
  workbookPath: string;
  /** Base file name, e.g. `login-test-cases.xlsx`. */
  workbook: string;
  /** Worksheet name the row was read from. */
  worksheet: string;
  /** 1-based row number in the worksheet, matching what the user sees in Excel. */
  row: number;
}

export interface TestCase {
  testCaseId: string;
  module: string;
  feature: string;
  scenario: string;
  description: string;
  preconditions: string;
  /** Steps split into discrete actions. Never empty for a valid test case. */
  steps: string[];
  testData: string;
  expectedResult: string;
  priority: Priority;
  tags: string[];
  automationStatus: AutomationStatus;
  automationNotes: string;
  /**
   * Value of the workbook's Run column: true/false when the column exists and
   * the cell is filled, null when there is no such column or the cell is blank.
   * `null` is not `false` - "no opinion" must not be read as "do not run".
   */
  execute: boolean | null;
  /**
   * Machine-readable assertion for data-driven rows: `Signed In`, `Error` or
   * `Blocked`. Empty means the row is not data-driven and needs a spec.
   */
  expectedOutcome: string;
  /** Text or /regex/ the rejection message must match. Only with `Error`. */
  expectedMessage: string;
  /** Traceability: the story/requirement this case exists for. Free text. */
  requirementId: string;
  testType: TestType;
  businessRisk: BusinessRisk;
  /** An environment PROFILE name (`QA`, `TEST3`), not a URL. */
  environment: string;
  /** Who the test acts as, in the product's own words (`Project Admin`). */
  userRole: string;
  /** A credential profile NAME. Never a credential - see AUTH_PROFILE_PATTERN. */
  authenticationProfile: string;
  /** Who owns this test case. Governance, not automation. */
  testOwner: string;
  source: TestCaseSource;
  /** Columns that could not be mapped to a canonical field, preserved verbatim. */
  extra: Record<string, string>;
  /** Validation problems found on this row. Non-empty means "do not trust blindly". */
  issues: ParseIssue[];
}

export type IssueSeverity = 'error' | 'warning';

export interface ParseIssue {
  severity: IssueSeverity;
  /** Stable machine code, e.g. `MISSING_EXPECTED_RESULT`. */
  code: string;
  message: string;
  worksheet: string;
  row: number;
  testCaseId?: string;
  field?: CanonicalField;
}

/** How one column heading was interpreted. */
export interface ColumnBinding {
  /** The heading exactly as written in the workbook. */
  header: string;
  /** 1-based column index. */
  column: number;
  field: CanonicalField | null;
  /** 1 = exact synonym hit, lower = fuzzy match. `null` field means unmapped. */
  confidence: number;
  /** Why the mapper chose this field, surfaced to the user for auditability. */
  reason: string;
}

export interface WorksheetReport {
  worksheet: string;
  /** `false` when the sheet holds no recognisable test-case table. */
  recognized: boolean;
  skipReason?: string;
  headerRow?: number;
  bindings: ColumnBinding[];
  rowsRead: number;
  testCasesParsed: number;
  malformedRows: number;
}

export interface ParseResult {
  workbookPath: string;
  workbook: string;
  testCases: TestCase[];
  /** Rows that could not be turned into a test case at all. */
  malformed: ParseIssue[];
  /** Workbook- and sheet-level problems (unrecognised sheets, duplicate IDs...). */
  issues: ParseIssue[];
  worksheets: WorksheetReport[];
}

export interface TestCaseFilter {
  /** Worksheet name - the natural unit when a workbook is one sheet per module. */
  worksheet?: string[];
  module?: string[];
  feature?: string[];
  priority?: string[];
  tag?: string[];
  automationStatus?: string[];
  testCaseId?: string[];
}
