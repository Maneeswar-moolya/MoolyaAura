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

import { activeScope, activeScopePath, artefactRoot, resolveScope, type ApplicationScope } from '../projects/scope';
import type { AutomationStatus, TestCase } from './types';

export const MAPPING_DIR = path.resolve(process.cwd(), 'ai', 'test-mapping');

/** The pre-scope location, and the fallback for a checkout with no registry. */
const LEGACY_MAPPING_FILE = path.join(MAPPING_DIR, 'mapping.json');

/**
 * The active application's traceability store.
 *
 * APPLICATION-OWNED, and this one is load-bearing twice over. The mapping is keyed by
 * BARE Test Case ID, so two applications that both have TC_LOGIN_001 do not merely
 * share a file - they share a KEY, and the second `upsertEntry` overwrites the first
 * application's spec path, test name and status in place. Everything downstream then
 * follows the wrong entry: `excel:report` writes one application's result into the
 * other's workbook row, and `mapping promote` marks it Automated.
 *
 * Scoping the FILE rather than namespacing the key is deliberate. `scopedKey()` exists
 * in `ai/projects/scope.ts` and is not used here, because the key is also the
 * traceability contract with the workbook: `results.ts` extracts the ID from a test
 * TITLE (`TC_ID - Scenario`), and namespacing the key would mean namespacing the
 * title, which is authored text this framework does not own. One file per application
 * gives the same isolation and leaves the ID exactly as the tester wrote it.
 *
 * Flat compatibility belongs only to the registry's declared legacy owner.
 */
export function activeMappingFile(): string {
  return activeScopePath('mappingFile', LEGACY_MAPPING_FILE);
}

/**
 * The traceability store for the application that OWNS a workbook.
 *
 * USE THIS WHENEVER A WORKBOOK IS IN HAND; `activeMappingFile()` is for a caller that
 * has none. The difference is not cosmetic and it produced a real cross-project defect:
 * `activeMappingFile()` reads the AMBIENT scope, which falls back to the declared
 * `legacyLayout` owner, so `excel:run excel/demoapp-test-cases.xlsx` read and wrote
 * BUGASURA's `ai/test-mapping/mapping.json` - measured, not theorised. A run of one
 * project's workbook would have promoted its cases into another project's mapping, and
 * because the mapping is keyed by BARE Test Case ID a shared `TC_LOGIN_001` would have
 * overwritten the real owner's spec path, test name and status in place.
 *
 * The workbook's owner is DECLARED in the registry (`workbookOwner`), never derived from
 * the file's name - `excel/demoapp-test-cases.xlsx` is owned by `demoapp` because the
 * registry says so, and renaming the file changes nothing.
 */
export function mappingFileFor(workbook: string): string {
  return resolveScope({ workbook }).paths.mappingFile;
}

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

export function readMapping(file: string = activeMappingFile()): Mapping {
  if (!fs.existsSync(file))
    return {};
  const contents = fs.readFileSync(file, 'utf8').trim();
  if (!contents)
    return {};
  return JSON.parse(contents) as Mapping;
}

export function writeMapping(mapping: Mapping, file: string = activeMappingFile()): void {
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
  // DEFAULTS FIRST, THEN THE TWO SPREADS - AND THE OVERWRITING IS THE POINT.
  //
  // TypeScript reports the five literals below as TS2783 ("specified more than once,
  // so this usage will be overwritten") under `strictNullChecks`. That is a correct
  // description of what happens and a wrong description of what it means: the literals
  // exist to give a BRAND-NEW entry a complete shape, and an entry that already exists
  // is supposed to win over them. Reordering to silence the diagnostic would make a
  // first write incomplete, and `?? ''`-ing each field individually would turn one
  // statement into five that can drift apart. Deliberate; do not "fix".
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
 * A subdirectory that is another application's namespace, which a scan must not enter.
 *
 * `tests-e2e/generated` is Bugasura's ENTIRE generated tree under the flat layout, and
 * `tests-e2e/generated/demoapp` is a second application's scoped directory sitting
 * inside it. Both walkers below recurse, so without this a Bugasura `mapping sync`
 * walks into demoapp and registers its specs against Bugasura's test-case IDs - a
 * cross-application leak that produces a plausible mapping rather than an error, and
 * one that gets worse the moment the two applications share an ID.
 *
 * Namespace boundaries are structural, not a list of currently registered names.
 * Removing an application must never expose its remaining scoped files to the flat owner.
 */
function isForeignScopeDir(full: string, scope?: ApplicationScope): boolean {
  const generated = path.join(artefactRoot(), 'tests-e2e/generated');
  if (path.dirname(full) !== generated)
    return false;
  return full !== (scope || activeScope()).paths.generatedDir;
}

/** Flat application runners are not generic framework capabilities. */
function canReadSuiteFile(file: string, requestedScope?: ApplicationScope): boolean {
  const suite = path.join(artefactRoot(), 'tests-e2e');
  const relative = path.relative(suite, file);
  // Explicit source-analysis callers may scan independent temporary directories.
  if (relative.startsWith('..') || path.isAbsolute(relative))
    return true;
  const scope = requestedScope || activeScope();
  if (relative.startsWith(`generic${path.sep}`))
    return true;
  const generatedRelative = path.relative(scope.paths.generatedDir, file);
  if (!generatedRelative.startsWith('..') && !path.isAbsolute(generatedRelative))
    return !scope.flatLayout || path.dirname(scope.paths.generatedDir) === path.join(suite, 'generated')
      || path.dirname(generatedRelative) === '.';
  return scope.flatLayout && !relative.startsWith(`generated${path.sep}`);
}

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
        if (isForeignScopeDir(full))
          continue;
        walk(full);
      } else if (/\.spec\.ts$/.test(entry.name) && canReadSuiteFile(full)) {
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

export function scanDataDrivenRunners(specDir: string, scope?: ApplicationScope): Array<{ module: string; testFile: string }> {
  const found: Array<{ module: string; testFile: string }> = [];
  if (!fs.existsSync(specDir))
    return found;

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isForeignScopeDir(full, scope))
          continue;
        walk(full);
      } else if (/\.spec\.ts$/.test(entry.name) && canReadSuiteFile(full, scope)) {
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
