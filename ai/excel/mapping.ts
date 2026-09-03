/**
 * Traceability store: Test Case ID -> generated automation.
 *
 * The mapping is the contract between the workbook a tester owns and the
 * spec files automation owns. It is written by the generator and read by the
 * execution reporter, so a failure in CI can always be traced back to the
 * originating row.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { AutomationStatus, TestCase } from './types';

export const MAPPING_DIR = path.resolve(process.cwd(), 'ai', 'test-mapping');
export const MAPPING_FILE = path.join(MAPPING_DIR, 'mapping.json');

export interface MappingEntry {
  testFile: string;
  testName: string;
  module: string;
  scenario: string;
  status: AutomationStatus;
  sourceWorkbook: string;
  sourceWorksheet: string;
  sourceRow?: number;
  lastGeneratedAt?: string;
  /** Free-text reason when status is `Needs Review`. */
  reviewReason?: string;
}

export type Mapping = Record<string, MappingEntry>;

export function readMapping(file: string = MAPPING_FILE): Mapping {
  if (!fs.existsSync(file))
    return {};
  const contents = fs.readFileSync(file, 'utf8').trim();
  if (!contents)
    return {};
  return JSON.parse(contents) as Mapping;
}

export function writeMapping(mapping: Mapping, file: string = MAPPING_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted: Mapping = {};
  for (const key of Object.keys(mapping).sort())
    sorted[key] = mapping[key];
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/** Merge one entry, preserving fields the caller did not supply. */
export function upsertEntry(
  mapping: Mapping,
  testCaseId: string,
  entry: Partial<MappingEntry> & Pick<MappingEntry, 'testFile' | 'testName'>,
  timestamp: string,
): Mapping {
  const existing = mapping[testCaseId];
  mapping[testCaseId] = {
    module: '',
    scenario: '',
    status: 'Generated',
    sourceWorkbook: '',
    sourceWorksheet: '',
    ...existing,
    ...entry,
    lastGeneratedAt: timestamp,
  };
  return mapping;
}

/** Title convention every generated test follows: `TC_ID - Scenario`. */
export function testTitleFor(testCase: TestCase): string {
  return `${testCase.testCaseId} - ${testCase.scenario || testCase.description || 'Untitled scenario'}`;
}

const TITLE_PATTERN = /['"`]\s*((?:TC|TS)[_-][A-Za-z0-9_-]+)\s*-\s*([^'"`]+?)\s*['"`]/g;

/**
 * Rebuild the mapping from the spec files themselves.
 *
 * Scanning the source of truth beats trusting a hand-edited JSON file: if a
 * test is renamed or deleted, the mapping follows without anyone remembering.
 */
export function scanSpecs(specDir: string): Array<{ testCaseId: string; testName: string; testFile: string }> {
  const found: Array<{ testCaseId: string; testName: string; testFile: string }> = [];
  if (!fs.existsSync(specDir))
    return found;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.spec\.ts$/.test(entry.name)) {
        const contents = fs.readFileSync(full, 'utf8');
        for (const match of contents.matchAll(TITLE_PATTERN)) {
          found.push({
            testCaseId: match[1],
            testName: `${match[1]} - ${match[2]}`,
            testFile: path.relative(process.cwd(), full).replace(/\\/g, '/'),
          });
        }
      }
    }
  };

  walk(specDir);
  return found;
}

// `*` must be allowed through - it is the wildcard runner's own module name -
// so the closing `*/` of a block comment is stripped afterwards instead of
// being excluded by the character class.
const RUNNER_PATTERN = /@data-driven-module:\s*([^\r\n]+)/g;

function cleanModuleName(raw: string): string {
  return raw.replace(/\*\/\s*$/, '').trim();
}

/**
 * Find the data-driven runners and the module each one serves.
 *
 * Data-driven tests are declared at run time from the workbook, so their titles
 * never appear in any source file and `scanSpecs` cannot see them. A runner
 * therefore states which module it covers in a marker comment, and `sync` pairs
 * that with the rows in the data-driven cache.
 */
/**
 * Pick the runner for a module: an exact match first, then the `*` wildcard.
 *
 * Precedence matters. A module with its own runner keeps it - that spec knows
 * the screen and can assert things a generic driver cannot - and giving a module
 * a runner later moves its rows automatically.
 */
export function runnerFor(
  runners: Array<{ module: string; testFile: string }>,
  module: string,
): string | null {
  const wanted = module.trim().toLowerCase();
  const exact = runners.find(r => r.module.trim().toLowerCase() === wanted && r.module.trim() !== '*');
  if (exact)
    return exact.testFile;
  return runners.find(r => r.module.trim() === '*')?.testFile ?? null;
}

export function scanDataDrivenRunners(specDir: string): Array<{ module: string; testFile: string }> {
  const found: Array<{ module: string; testFile: string }> = [];
  if (!fs.existsSync(specDir))
    return found;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.spec\.ts$/.test(entry.name)) {
        const contents = fs.readFileSync(full, 'utf8');
        for (const match of contents.matchAll(RUNNER_PATTERN)) {
          const module = cleanModuleName(match[1]);
          if (module)
            found.push({ module, testFile: path.relative(process.cwd(), full).replace(/\\/g, '/') });
        }
      }
    }
  };

  walk(specDir);
  return found;
}

/** Test case IDs present in the workbook but absent from automation. */
export function unautomated(testCases: TestCase[], mapping: Mapping): TestCase[] {
  return testCases.filter(testCase => {
    const entry = mapping[testCase.testCaseId];
    return !entry || entry.status === 'Not Automated' || entry.status === 'Needs Review';
  });
}
