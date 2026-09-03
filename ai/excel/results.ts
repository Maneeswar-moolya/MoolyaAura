/**
 * Playwright JSON results -> per-test-case execution facts.
 *
 * Also classifies failures into a root cause. The classification is
 * deliberately conservative: anything it cannot recognise is reported as
 * "Unclassified - needs analysis" rather than given a confident wrong label.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ExecutionStatus } from './types';

interface RawResult {
  status?: string;
  duration?: number;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  startTime?: string;
  retry?: number;
}

interface RawTest {
  status?: string;
  projectName?: string;
  results?: RawResult[];
}

interface RawSpec {
  title?: string;
  file?: string;
  ok?: boolean;
  tests?: RawTest[];
}

interface RawSuite {
  title?: string;
  file?: string;
  specs?: RawSpec[];
  suites?: RawSuite[];
}

export interface ExecutionRecord {
  testCaseId: string | null;
  testName: string;
  testFile: string;
  executionStatus: ExecutionStatus;
  /** Total wall time across attempts, in milliseconds. */
  durationMs: number;
  failureReason: string;
  rootCause: string;
  retries: number;
  /** Passed only after a retry - worth surfacing separately from a clean pass. */
  flaky: boolean;
  lastExecutionTime: string;
}

const TEST_CASE_ID = /\b((?:TC|TS)[_-][A-Za-z0-9_-]+)\b/;

const ROOT_CAUSES: Array<[RegExp, string]> = [
  [/strict mode violation/i, 'Locator matched multiple elements (ambiguous selector)'],
  [/waiting for (?:locator|selector)|locator\.\w+: Timeout|element is not visible|not attached to the DOM/i,
    'Locator did not resolve - element missing, renamed or not yet rendered'],
  [/Timeout .* exceeded|exceeded while running|navigation timeout/i, 'Timeout waiting for element or navigation'],
  // Checked before the assertion pattern: these surface AS assertion failures,
  // but the fix is the test data, not the application or the automation.
  [/does not exist|no such (account|user)|account not found|not a registered|account is locked|account disabled/i,
    'Test data problem - the account under test does not exist or is unusable'],
  [/expect\(.*\)\.(?:to|not)|Expected string|Received string|toHaveText|toBeVisible|toHaveURL/i,
    'Assertion mismatch - application behaviour differs from the expected result'],
  [/net::ERR|ECONNREFUSED|ENOTFOUND|getaddrinfo|socket hang up|502|503|504/i,
    'Environment or network failure - application unreachable'],
  [/401|403|unauthori[sz]ed|forbidden|invalid credentials|login failed/i,
    'Authentication failure - credentials or session invalid'],
  [/TypeError|ReferenceError|is not a function|undefined is not/i, 'Defect in the automation code'],
  [/test\.setTimeout|Test timeout of \d+ms exceeded/i, 'Test exceeded its own timeout budget'],
];

export function classifyRootCause(failureReason: string): string {
  if (!failureReason.trim())
    return '';
  for (const [pattern, cause] of ROOT_CAUSES) {
    if (pattern.test(failureReason))
      return cause;
  }
  return 'Unclassified - needs analysis';
}

function toExecutionStatus(status: string | undefined): ExecutionStatus {
  switch (status) {
    case 'expected': return 'Passed';
    case 'flaky': return 'Passed';
    case 'unexpected': return 'Failed';
    case 'skipped': return 'Skipped';
    case 'interrupted': return 'Blocked';
    default: return 'Not Run';
  }
}

function cleanMessage(message: string): string {
  // Playwright colourises errors; ANSI codes make the spreadsheet unreadable.
  return message
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(' | ')
    .slice(0, 800);
}

function collectSpecs(suite: RawSuite, inheritedFile: string, into: Array<{ spec: RawSpec; file: string }>): void {
  const file = suite.file ?? inheritedFile;
  for (const spec of suite.specs ?? [])
    into.push({ spec, file: spec.file ?? file });
  for (const child of suite.suites ?? [])
    collectSpecs(child, file, into);
}

export function parseResults(reportPath: string): ExecutionRecord[] {
  const absolute = path.resolve(reportPath);
  const report = JSON.parse(fs.readFileSync(absolute, 'utf8')) as { suites?: RawSuite[] };

  const specs: Array<{ spec: RawSpec; file: string }> = [];
  for (const suite of report.suites ?? [])
    collectSpecs(suite, '', specs);

  const records: ExecutionRecord[] = [];
  for (const { spec, file } of specs) {
    for (const test of spec.tests ?? []) {
      const attempts = test.results ?? [];
      const last = attempts[attempts.length - 1];
      const failing = [...attempts].reverse().find(attempt => attempt.status === 'failed' || attempt.status === 'timedOut');
      const messages = [failing?.error?.message, ...(failing?.errors ?? []).map(error => error.message)]
          .filter((message): message is string => Boolean(message));
      const failureReason = messages.length ? cleanMessage(messages.join('\n')) : '';
      const executionStatus = toExecutionStatus(test.status);

      records.push({
        testCaseId: TEST_CASE_ID.exec(spec.title ?? '')?.[1] ?? null,
        testName: spec.title ?? '(untitled)',
        testFile: (file || '').replace(/\\/g, '/'),
        executionStatus,
        durationMs: attempts.reduce((total, attempt) => total + (attempt.duration ?? 0), 0),
        // A flaky pass keeps its failure text: the reason it failed first is
        // exactly what an engineer needs to see.
        failureReason: executionStatus === 'Failed' || test.status === 'flaky' ? failureReason : '',
        rootCause: executionStatus === 'Failed' ? classifyRootCause(failureReason) : '',
        retries: Math.max(0, attempts.length - 1),
        flaky: test.status === 'flaky',
        lastExecutionTime: last?.startTime ?? '',
      });
    }
  }

  return records;
}

export interface HealingAttempt {
  locatorName: string;
  from: string;
  to: string;
  at: string;
  applied: boolean;
  note?: string;
}

export interface HealingRecord {
  testCaseId: string;
  healed: boolean;
  attempts: HealingAttempt[];
  rerunStatus?: ExecutionStatus;
}

export const HEALING_LOG = path.resolve(process.cwd(), 'ai', 'reports', 'healing-log.json');
export const HEALING_DIR = path.resolve(process.cwd(), 'ai', 'reports', 'healing');

/**
 * Healing evidence comes from two places: a merged log file if one exists, and
 * the per-test files each worker writes during a run (one file per test case,
 * so parallel workers never race on a single JSON document).
 */
export function readHealingLog(file: string = HEALING_LOG, dir: string = HEALING_DIR): Record<string, HealingRecord> {
  const merged: Record<string, HealingRecord> = {};

  if (fs.existsSync(file)) {
    const contents = fs.readFileSync(file, 'utf8').trim();
    if (contents)
      Object.assign(merged, JSON.parse(contents) as Record<string, HealingRecord>);
  }

  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json'))
        continue;
      const record = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')) as HealingRecord;
      if (record.testCaseId)
        merged[record.testCaseId] = record;
    }
  }

  return merged;
}
