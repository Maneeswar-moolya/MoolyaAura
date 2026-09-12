/**
 * Command line entry point for the Excel test case toolkit.
 *
 *   npm run excel:list     -- excel/login-test-cases.xlsx --priority P0
 *   npm run excel:quality  -- excel/login-test-cases.xlsx
 *   npm run excel:mapping  -- sync
 *   npm run excel:report   -- --workbook excel/login-test-cases.xlsx --results test-results-excel/results.json
 *
 * Everything here is deterministic. The reasoning steps - reading intent from a
 * test case, writing the spec, deciding whether a failure is safe to heal -
 * live in .claude/skills/, not in this file.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { workbookOwner } from '../projects/registry';

import { applyFilter, summarize, toList } from './filter';
import { writeExecutionReport, type ReportSummary } from './execution-report';
import { UserFacingError, writeResultsIntoWorkbook } from './writeback';
import { buildCache, writeCache } from './data-driven';
import { activeMappingFile, mappingFileFor, readMapping, runnerFor, scanDataDrivenRunners, scanSpecs, testTitleFor, unautomated, upsertEntry, writeMapping } from './mapping';
import { isAutomatable, parseWorkbook } from './parser';
import { analyzeQuality, needsReview, renderQualityReport } from './quality';
import { readHealingLog, parseResults, HEALING_LOG } from './results';
import type { ParseResult, TestCase } from './types';

const DEFAULT_SPEC_DIR = path.resolve(process.cwd(), 'tests-e2e');
const DEFAULT_QUALITY_REPORT = path.resolve(process.cwd(), 'ai', 'reports', 'test-case-quality-report.md');
/**
 * One report per workbook.
 *
 * A single shared path looked tidy until two workbooks existed: running the
 * second overwrote the first's report, and every hyperlink the first had
 * written into its spreadsheet pointed at anchors that no longer existed.
 * Deriving the name from the workbook keeps each pair self-consistent.
 */
function defaultExecutionReport(workbookPath: string): string {
  const base = path.basename(workbookPath, path.extname(workbookPath));
  return path.resolve(process.cwd(), 'reports', `${base}-execution-report.xlsx`);
}
const DEFAULT_RESULTS = path.resolve(process.cwd(), 'test-results-excel', 'results.json');

/**
 * Where the workbook's hyperlinks should point. The HTML report sits beside the
 * .xlsx report; the Playwright report is written by the test run itself.
 */
function reportLinks(xlsxOutputPath: string) {
  const playwright = path.resolve(process.cwd(), 'reports', 'playwright-html');
  return {
    htmlReport: xlsxOutputPath.replace(/\.xlsx$/i, '.html'),
    playwrightReport: fs.existsSync(playwright) ? playwright : undefined,
  };
}

function printSummary(summary: ReportSummary): void {
  process.stdout.write(`  Total test cases : ${summary.total}\n`);
  process.stdout.write(`  Automated        : ${summary.automated}\n`);
  process.stdout.write(`  Generated        : ${summary.generated}\n`);
  process.stdout.write(`  Not automated    : ${summary.notAutomated}\n`);
  process.stdout.write(`  Needs review     : ${summary.needsReview}\n`);
  process.stdout.write(`  Passed           : ${summary.passed}\n`);
  process.stdout.write(`  Failed           : ${summary.failed}\n`);
  process.stdout.write(`  Skipped          : ${summary.skipped}\n`);
  process.stdout.write(`  Blocked          : ${summary.blocked}\n`);
  process.stdout.write(`  Not run          : ${summary.notRun}\n`);
  process.stdout.write(`  Healed           : ${summary.healed}\n`);
  process.stdout.write(`  Flaky            : ${summary.flaky}\n`);
}

interface Args {
  positionals: string[];
  flags: Record<string, string[] | true>;
}

function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags: Record<string, string[] | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split(/=(.*)/s);
    const value = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : undefined);
    if (value === undefined) {
      flags[name] = true;
    } else {
      const existing = flags[name];
      flags[name] = Array.isArray(existing) ? [...existing, value] : [value];
    }
  }
  return { positionals, flags };
}

function flagValue(args: Args, name: string): string | undefined {
  const value = args.flags[name];
  return Array.isArray(value) ? value[value.length - 1] : undefined;
}

function flagList(args: Args, name: string): string[] | undefined {
  const value = args.flags[name];
  return Array.isArray(value) ? toList(value) : undefined;
}

function hasFlag(args: Args, name: string): boolean {
  return args.flags[name] !== undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireWorkbook(args: Args, positionalIndex = 0): string {
  const workbook = args.positionals[positionalIndex] ?? flagValue(args, 'workbook');
  if (!workbook)
    fail('No workbook given. Pass a path, e.g. `excel/login-test-cases.xlsx`.');
  const resolved = path.resolve(workbook!);
  if (!fs.existsSync(resolved))
    fail(`Workbook not found: ${resolved}`);
  return resolved;
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function selectedCases(parsed: ParseResult, args: Args): TestCase[] {
  return applyFilter(parsed.testCases, {
    worksheet: flagList(args, 'sheet') ?? flagList(args, 'worksheet'),
    module: flagList(args, 'module'),
    feature: flagList(args, 'feature'),
    priority: flagList(args, 'priority'),
    tag: flagList(args, 'tag'),
    automationStatus: flagList(args, 'status') ?? flagList(args, 'automation-status'),
    testCaseId: flagList(args, 'id') ?? flagList(args, 'test-case-id'),
  });
}

function printParseWarnings(parsed: ParseResult): void {
  for (const sheet of parsed.worksheets) {
    if (!sheet.recognized)
      process.stdout.write(`  skipped worksheet "${sheet.worksheet}": ${sheet.skipReason}\n`);
  }
  for (const issue of parsed.malformed)
    process.stdout.write(`  malformed ${issue.worksheet} row ${issue.row}: ${issue.message}\n`);
  for (const issue of parsed.issues)
    process.stdout.write(`  ${issue.severity}: ${issue.message}\n`);
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value.padEnd(width) : `${value.slice(0, width - 1)}…`;
}

async function commandList(args: Args): Promise<void> {
  const workbookPath = requireWorkbook(args);
  const parsed = await parseWorkbook(workbookPath);
  const cases = selectedCases(parsed, args);

  if (hasFlag(args, 'json')) {
    process.stdout.write(`${JSON.stringify({ workbook: parsed.workbook, testCases: cases }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`\n${parsed.workbook} - ${cases.length} of ${parsed.testCases.length} test case(s) selected\n\n`);
  printParseWarnings(parsed);
  if (parsed.malformed.length || parsed.issues.length)
    process.stdout.write('\n');

  process.stdout.write(`${truncate('ID', 16)} ${truncate('MODULE', 12)} ${truncate('PRI', 4)} ` +
    `${truncate('AUTOMATION', 14)} ${truncate('SCENARIO', 44)} STEPS\n`);
  process.stdout.write(`${'-'.repeat(105)}\n`);
  for (const testCase of cases) {
    const flag = isAutomatable(testCase) ? ' ' : '!';
    process.stdout.write(`${flag}${truncate(testCase.testCaseId, 15)} ${truncate(testCase.module, 12)} ` +
      `${truncate(testCase.priority || '-', 4)} ${truncate(testCase.automationStatus, 14)} ` +
      `${truncate(testCase.scenario, 44)} ${testCase.steps.length}\n`);
  }

  const stats = summarize(cases);
  process.stdout.write(`\nby priority: ${JSON.stringify(stats.byPriority)}\n`);
  process.stdout.write(`by automation status: ${JSON.stringify(stats.byAutomationStatus)}\n`);
  const blocked = cases.filter(testCase => !isAutomatable(testCase));
  if (blocked.length) {
    process.stdout.write(`\n! ${blocked.length} selected case(s) are not automatable as written ` +
      `(${blocked.map(testCase => testCase.testCaseId).join(', ')}). Run \`excel:quality\` for detail.\n`);
  }
  process.stdout.write('\n');
}

async function commandQuality(args: Args): Promise<void> {
  const workbookPath = requireWorkbook(args);
  const parsed = await parseWorkbook(workbookPath);
  const findings = analyzeQuality(parsed);
  const generatedAt = nowIso();
  const markdown = renderQualityReport(parsed, findings, generatedAt);

  const outputPath = path.resolve(flagValue(args, 'out') ?? DEFAULT_QUALITY_REPORT);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, 'utf8');

  const errors = findings.filter(finding => finding.severity === 'error').length;
  const warnings = findings.filter(finding => finding.severity === 'warning').length;
  const review = needsReview(parsed, findings);
  process.stdout.write(`\nquality report: ${path.relative(process.cwd(), outputPath).replace(/\\/g, '/')}\n`);
  process.stdout.write(`  ${parsed.testCases.length} test case(s), ${errors} error(s), ${warnings} warning(s)\n`);
  process.stdout.write(`  needs review: ${review.size ? [...review.keys()].join(', ') : 'none'}\n\n`);
}

async function commandMapping(args: Args): Promise<void> {
  const subcommand = args.positionals[0] ?? 'list';
  const mappingFile = path.resolve(flagValue(args, 'mapping') ?? activeMappingFile());
  const mapping = readMapping(mappingFile);

  if (subcommand === 'list') {
    const entries = Object.entries(mapping);
    if (!entries.length) {
      process.stdout.write('\nNo traceability entries yet. Generate a test, then run `excel:mapping -- sync`.\n\n');
      return;
    }
    process.stdout.write(`\n${entries.length} traceability entr(ies) in ${path.relative(process.cwd(), mappingFile)}\n\n`);
    for (const [id, entry] of entries)
      process.stdout.write(`  ${truncate(id, 16)} ${truncate(entry.status, 14)} ${entry.testFile}\n`);
    process.stdout.write('\n');
    return;
  }

  if (subcommand === 'sync') {
    const specDir = path.resolve(flagValue(args, 'spec-dir') ?? DEFAULT_SPEC_DIR);
    const found = scanSpecs(specDir);
    const timestamp = nowIso();

    // Optionally enrich from the workbook so module/scenario/source stay accurate.
    const workbookArg = flagValue(args, 'workbook');
    const byId = new Map<string, TestCase>();
    if (workbookArg) {
      const parsed = await parseWorkbook(path.resolve(workbookArg));
      for (const testCase of parsed.testCases)
        byId.set(testCase.testCaseId.toUpperCase(), testCase);

      // Data-driven rows have no title in any source file, so pair them with
      // the runner that declares their module instead. Without this they would
      // look unautomated and `run` would refuse to execute them.
      const runners = scanDataDrivenRunners(specDir);
      for (const dataDriven of buildCache(parsed, timestamp).cases) {
        const testFile = runnerFor(runners, dataDriven.module);
        if (!testFile)
          continue;
        found.push({
          testCaseId: dataDriven.testCaseId,
          testName: `${dataDriven.testCaseId} - ${dataDriven.scenario}`,
          testFile,
        });
      }
    }

    for (const spec of found) {
      const testCase = byId.get(spec.testCaseId.toUpperCase());
      upsertEntry(mapping, spec.testCaseId, {
        testFile: spec.testFile,
        testName: spec.testName,
        module: testCase?.module ?? mapping[spec.testCaseId]?.module ?? '',
        scenario: testCase?.scenario ?? mapping[spec.testCaseId]?.scenario ?? '',
        status: mapping[spec.testCaseId]?.status ?? 'Generated',
        sourceWorkbook: testCase?.source.workbook ?? mapping[spec.testCaseId]?.sourceWorkbook ?? '',
        sourceWorksheet: testCase?.source.worksheet ?? mapping[spec.testCaseId]?.sourceWorksheet ?? '',
        sourceRow: testCase?.source.row ?? mapping[spec.testCaseId]?.sourceRow,
      }, timestamp);
    }

    // Drop entries whose spec no longer exists - the specs are the source of
    // truth. Entries that never had a spec are kept: that is how a deliberate
    // "Needs Review" decision survives a sync.
    const live = new Set(found.map(spec => spec.testCaseId.toUpperCase()));
    const removed: string[] = [];
    for (const [id, entry] of Object.entries(mapping)) {
      if (!live.has(id.toUpperCase()) && entry.testFile) {
        removed.push(id);
        delete mapping[id];
      }
    }

    writeMapping(mapping, mappingFile);
    process.stdout.write(`\nsynced ${found.length} test(s) from ${path.relative(process.cwd(), specDir)} ` +
      `into ${path.relative(process.cwd(), mappingFile)}\n`);
    if (removed.length)
      process.stdout.write(`  removed ${removed.length} stale entr(ies): ${removed.join(', ')}\n`);
    process.stdout.write('\n');
    return;
  }

  if (subcommand === 'status') {
    const id = args.positionals[1];
    const status = args.positionals[2] ?? flagValue(args, 'set');
    if (!id || !status)
      fail('usage: excel:mapping -- status <TEST_CASE_ID> <Automated|Generated|Needs Review|Not Automated>');
    const entry = mapping[id!];
    if (!entry)
      fail(`No mapping entry for ${id}. Run \`excel:mapping -- sync\` first.`);
    entry.status = status as typeof entry.status;
    if (flagValue(args, 'reason'))
      entry.reviewReason = flagValue(args, 'reason');
    // Moving off "Needs Review" resolves the concern; leaving the old reason
    // behind would keep surfacing it as this case's Failure Reason.
    else if (entry.status !== 'Needs Review')
      delete entry.reviewReason;
    writeMapping(mapping, mappingFile);
    process.stdout.write(`\n${id} -> ${status}\n\n`);
    return;
  }

  if (subcommand === 'promote') {
    // Generated -> Automated, earned by a green run rather than asserted by hand.
    const resultsArg = flagValue(args, 'results') ?? 'test-results-excel/results.json';
    const resultsPath = path.resolve(resultsArg);
    if (!fs.existsSync(resultsPath))
      fail(`Playwright results file not found: ${resultsPath}. Run \`npm run excel:test\` first.`);

    const promoted: string[] = [];
    const demoted: string[] = [];
    for (const record of parseResults(resultsPath)) {
      if (!record.testCaseId)
        continue;
      const entry = mapping[record.testCaseId];
      if (!entry || entry.status === 'Needs Review')
        continue;
      if (record.executionStatus === 'Passed' && !record.flaky) {
        if (entry.status !== 'Automated') {
          entry.status = 'Automated';
          promoted.push(record.testCaseId);
        }
      } else if (record.executionStatus === 'Failed' && entry.status === 'Automated') {
        entry.status = 'Generated';
        demoted.push(record.testCaseId);
      }
    }

    writeMapping(mapping, mappingFile);
    process.stdout.write(`\npromoted to Automated: ${promoted.length ? promoted.join(', ') : 'none'}\n`);
    if (demoted.length)
      process.stdout.write(`demoted to Generated (now failing): ${demoted.join(', ')}\n`);
    process.stdout.write('\n');
    return;
  }

  if (subcommand === 'review') {
    // Records the decision "this test case must not be automated as written".
    // The entry has no test file on purpose, and survives `sync`.
    const id = args.positionals[1];
    const reason = flagValue(args, 'reason');
    if (!id || !reason)
      fail('usage: excel:mapping -- review <TEST_CASE_ID> --reason "why it cannot be automated as written"');

    const workbookArg = flagValue(args, 'workbook');
    let testCase: TestCase | undefined;
    if (workbookArg) {
      const parsed = await parseWorkbook(path.resolve(workbookArg));
      testCase = parsed.testCases.find(item => item.testCaseId.toUpperCase() === id!.toUpperCase());
    }

    upsertEntry(mapping, id!, {
      testFile: '',
      testName: '',
      module: testCase?.module ?? mapping[id!]?.module ?? '',
      scenario: testCase?.scenario ?? mapping[id!]?.scenario ?? '',
      status: 'Needs Review',
      sourceWorkbook: testCase?.source.workbook ?? mapping[id!]?.sourceWorkbook ?? '',
      sourceWorksheet: testCase?.source.worksheet ?? mapping[id!]?.sourceWorksheet ?? '',
      sourceRow: testCase?.source.row ?? mapping[id!]?.sourceRow,
      reviewReason: reason,
    }, nowIso());
    writeMapping(mapping, mappingFile);
    process.stdout.write(`\n${id} -> Needs Review (${reason})\n\n`);
    return;
  }

  if (subcommand === 'unautomated') {
    const workbookPath = requireWorkbook(args, 1);
    const parsed = await parseWorkbook(workbookPath);
    const pending = unautomated(selectedCases(parsed, args), mapping);
    process.stdout.write(`\n${pending.length} test case(s) without passing automation\n\n`);
    for (const testCase of pending) {
      const reason = mapping[testCase.testCaseId]?.status ?? 'no automation generated';
      process.stdout.write(`  ${truncate(testCase.testCaseId, 16)} ${truncate(testCase.priority || '-', 4)} ` +
        `${truncate(testCase.scenario, 50)} (${reason})\n`);
    }
    process.stdout.write('\n');
    return;
  }

  fail(`Unknown mapping subcommand "${subcommand}". Use list, sync, status or unautomated.`);
}

/** Generated -> Automated on a clean pass; Automated -> Generated on a failure. */
function promoteFromResults(mapping: ReturnType<typeof readMapping>, records: ReturnType<typeof parseResults>) {
  const promoted: string[] = [];
  const demoted: string[] = [];
  for (const record of records) {
    if (!record.testCaseId)
      continue;
    const entry = mapping[record.testCaseId];
    if (!entry || entry.status === 'Needs Review')
      continue;
    if (record.executionStatus === 'Passed' && !record.flaky) {
      if (entry.status !== 'Automated') {
        entry.status = 'Automated';
        promoted.push(record.testCaseId);
      }
    } else if (record.executionStatus === 'Failed' && entry.status === 'Automated') {
      entry.status = 'Generated';
      demoted.push(record.testCaseId);
    }
  }
  return { promoted, demoted };
}

/**
 * Run the test cases the workbook selects, then write the results back into it.
 *
 * The workbook is the control surface: a "Run" column decides what executes.
 * Without that column, the usual filters apply.
 */
async function commandRun(args: Args): Promise<void> {
  const workbookPath = requireWorkbook(args);
  const parsed = await parseWorkbook(workbookPath);
  // THE WORKBOOK'S OWNER DECIDES THE MAPPING, not the ambient scope. `activeMappingFile()`
  // falls back to the declared legacyLayout owner, so running a second project's workbook
  // read and wrote the FIRST project's mapping - and the mapping is keyed by bare Test
  // Case ID, so a shared TC_LOGIN_001 would overwrite the real owner's entry in place.
  const mappingFile = path.resolve(flagValue(args, 'mapping') ?? mappingFileFor(parsed.workbookPath));
  const mapping = readMapping(mappingFile);

  const hasRunColumn = parsed.worksheets.some(sheet => sheet.bindings.some(binding => binding.field === 'execute'));
  let selected = selectedCases(parsed, args);

  if (hasRunColumn && !hasFlag(args, 'all')) {
    selected = selected.filter(testCase => testCase.execute === true);
    process.stdout.write(`\nRun column found - executing the ${selected.length} row(s) marked to run. ` +
      'Use --all to ignore it.\n');
  } else if (hasRunColumn) {
    process.stdout.write('\nRun column present but --all given - ignoring it.\n');
  } else {
    process.stdout.write('\nNo Run column in this workbook - selecting by filters. ' +
      'Add a "Run" column (Yes/No) to drive execution from the spreadsheet.\n');
  }

  // Register data-driven rows in the mapping before deciding what can run.
  //
  // Their tests are declared from the workbook at collection time, so no title
  // exists in any source file for `mapping sync` to find. Doing it here keeps
  // the promise that adding a row is the only step: the row becomes runnable,
  // traceable and promotable in one command, with no `mapping sync` in between.
  const cache = buildCache(parsed, nowIso());
  writeCache(cache);
  const runners = scanDataDrivenRunners(DEFAULT_SPEC_DIR);
  const registered: string[] = [];
  for (const row of [...cache.cases, ...cache.rejected]) {
    const testFile = runnerFor(runners, row.module);
    if (!testFile)
      continue;
    if (!mapping[row.testCaseId])
      registered.push(row.testCaseId);
    upsertEntry(mapping, row.testCaseId, {
      testFile,
      testName: `${row.testCaseId} - ${row.scenario}`,
      module: row.module,
      scenario: row.scenario,
      status: mapping[row.testCaseId]?.status ?? 'Generated',
      sourceWorkbook: parsed.workbook,
      sourceWorksheet: row.worksheet,
      sourceRow: row.row,
    }, nowIso());
  }
  if (registered.length) {
    writeMapping(mapping, mappingFile);
    process.stdout.write(`data-driven rows registered for traceability: ${registered.join(', ')}\n`);
  }

  // Only cases with automation behind them can actually execute - and the mapping
  // names a file, while only the file itself can be run. An entry whose spec has
  // been deleted used to be selected anyway, and Playwright then answered `No tests
  // found` for the whole run, which reads as "the runner is broken" rather than
  // "that spec is gone". `excel:mapping sync` is what reconciles such an entry.
  const hasSpec = (testCase: TestCase) => {
    const testFile = mapping[testCase.testCaseId]?.testFile;
    return Boolean(testFile) && fs.existsSync(path.resolve(process.cwd(), testFile as string));
  };
  const runnable = selected.filter(hasSpec);
  const skipped = selected.filter(testCase => !hasSpec(testCase));
  for (const testCase of skipped) {
    const entry = mapping[testCase.testCaseId];
    const status = entry?.testFile
      ? `its spec is missing (${entry.testFile}) - stale mapping entry, run "excel:mapping sync"`
      : entry?.status ?? 'no automation generated';
    process.stdout.write(`  skipping ${testCase.testCaseId}: ${status}\n`);
  }

  if (!runnable.length)
    fail('Nothing to run. Mark rows "Yes" in the Run column, or generate automation for them first.');

  if (hasFlag(args, 'dry-run')) {
    process.stdout.write(`\nwould run ${runnable.length} test case(s):\n`);
    for (const testCase of runnable) {
      process.stdout.write(`  ${truncate(testCase.testCaseId, 15)} ${truncate(testCase.source.worksheet, 20)} ` +
        `${truncate(testCase.priority || '-', 4)} ${testCase.scenario}\n`);
    }
    const excluded = parsed.testCases.filter(testCase => !selected.includes(testCase));
    if (excluded.length) {
      process.stdout.write(`\nexcluded by the current selection (${excluded.length}):\n`);
      for (const testCase of excluded) {
        const why = testCase.execute === false ? 'Run=No' : 'filtered out';
        process.stdout.write(`  ${truncate(testCase.testCaseId, 15)} ${truncate(testCase.source.worksheet, 20)} ${why}\n`);
      }
    }
    process.stdout.write('\nNothing was executed and the workbook was not touched (--dry-run).\n\n');
    return;
  }

  const pattern = `(${runnable.map(testCase => testCase.testCaseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
  process.stdout.write(`\nrunning ${runnable.length} test case(s): ${runnable.map(t => t.testCaseId).join(', ')}\n\n`);

  const resultsPath = path.resolve(flagValue(args, 'results') ?? DEFAULT_RESULTS);
  const staleResultsAt = fs.existsSync(resultsPath) ? fs.statSync(resultsPath).mtimeMs : 0;

  // Invoke Playwright's CLI directly through node rather than `npx` with
  // shell: true. On Windows the shell interprets the "|" in the --grep pattern
  // as a pipe, which silently runs nothing at all.
  // `--playwright-arg --headed` parses as a valueless flag, because the parser
  // stops at the next token beginning with "--". That is almost always what
  // someone meant to pass, so say so instead of failing later with a TypeError.
  const extraFlag = args.flags['playwright-arg'];
  if (extraFlag === true) {
    fail('--playwright-arg needs a value. When the value itself starts with "--", use the = form:\n' +
      '  --playwright-arg=--headed --playwright-arg=--project=firefox');
  }
  const extra = extraFlag ?? [];
  const run = spawnSync(process.execPath,
      [require.resolve('@playwright/test/cli'), 'test',
        '--config=playwright.excel.config.ts', '--grep', pattern, ...extra],
      {
        stdio: 'inherit',
        shell: false,
        env: {
          ...process.env,
          // The data-driven runner reads the cache for THIS workbook, not the
          // default one, so a second workbook's rows never leak into the run.
          EXCEL_WORKBOOK: path.relative(process.cwd(), parsed.workbookPath),
          // WHICH APPLICATION THIS RUN IS, passed to the child so Playwright can narrow
          // COLLECTION before `--grep` is applied. A Test Case ID is unique within an
          // application and deliberately reusable across them, so without this a
          // `--grep TC_LOGIN_001` collects every project's TC_LOGIN_001, runs them all,
          // and `results.ts` - which recovers the ID from the test title - files the
          // wrong verdict against this workbook's row. Taken from the workbook's
          // DECLARED owner, never from its file name.
          AURA_APPLICATION: workbookOwner(parsed.workbookPath),
        },
      });

  if (!fs.existsSync(resultsPath))
    fail(`The run produced no results file at ${resultsPath}. Check the Playwright output above.`);

  // A results file that did not change means this run never wrote one. Reporting
  // the previous run's numbers as if they were this run's is worse than failing.
  if (fs.statSync(resultsPath).mtimeMs === staleResultsAt) {
    fail(`${path.relative(process.cwd(), resultsPath)} was not updated by this run - it still holds ` +
      'the previous results. Refusing to report stale numbers. Check the Playwright output above.');
  }

  const records = parseResults(resultsPath);
  const { promoted, demoted } = promoteFromResults(mapping, records);
  writeMapping(mapping, path.resolve(flagValue(args, 'mapping') ?? mappingFileFor(parsed.workbookPath)));

  const healingLog = readHealingLog(path.resolve(flagValue(args, 'healing') ?? HEALING_LOG));
  const outputPath = path.resolve(flagValue(args, 'out') ?? defaultExecutionReport(workbookPath));
  const generatedAt = nowIso();

  const { rows, summary } = await writeExecutionReport({
    parsed, mapping, records, healingLog, outputPath, generatedAt,
    resultsPath: path.relative(process.cwd(), resultsPath).replace(/\\/g, '/'),
  });

  // The point of this command: results go back into the workbook they came from.
  const writeback = hasFlag(args, 'no-in-place')
    ? null
    : await writeResultsIntoWorkbook({
      parsed, rows, timestamp: generatedAt, links: reportLinks(outputPath),
      // Only the cases this run actually covered. Anything outside the Run
      // column / filters keeps the results it already had.
      onlyTestCaseIds: new Set(selected.map(testCase => testCase.testCaseId.toUpperCase())),
    });

  process.stdout.write('\n');
  if (promoted.length)
    process.stdout.write(`promoted to Automated: ${promoted.join(', ')}\n`);
  if (demoted.length)
    process.stdout.write(`demoted to Generated : ${demoted.join(', ')}\n`);
  printSummary(summary);
  if (writeback) {
    process.stdout.write(`  Results written into: ${writeback.workbookPath}\n`);
    process.stdout.write(`  Backup of the original: ${writeback.backup}\n`);
    process.stdout.write(`  Rows updated: ${writeback.rowsUpdated}` +
      `${writeback.columnsAdded.length ? `, columns added: ${writeback.columnsAdded.length}` : ''}\n`);
  } else {
    process.stdout.write(`  Source workbook  : ${parsed.workbookPath} (unchanged, --no-in-place)\n`);
  }
  process.stdout.write('\n');

  if (run.status !== 0)
    process.exitCode = run.status ?? 1;
}

async function commandReport(args: Args): Promise<void> {
  const workbookPath = requireWorkbook(args);
  const parsed = await parseWorkbook(workbookPath);
  // Same rule as `commandRun`: the report is ABOUT this workbook, so it reads the
  // mapping of the application the registry says owns it.
  const mapping = readMapping(path.resolve(flagValue(args, 'mapping') ?? mappingFileFor(parsed.workbookPath)));

  const resultsArg = flagValue(args, 'results');
  const resultsPath = resultsArg ? path.resolve(resultsArg) : null;
  if (resultsPath && !fs.existsSync(resultsPath))
    fail(`Playwright results file not found: ${resultsPath}`);
  const records = resultsPath ? parseResults(resultsPath) : [];

  const healingLog = readHealingLog(path.resolve(flagValue(args, 'healing') ?? HEALING_LOG));
  const outputPath = path.resolve(flagValue(args, 'out') ?? defaultExecutionReport(workbookPath));

  // `--no-html` skips the HTML edition; `--html <path>` relocates it.
  const htmlPath = hasFlag(args, 'no-html') ? null : flagValue(args, 'html') ?? undefined;

  const generatedAt = nowIso();
  const { summary, rows, htmlPath: writtenHtml } = await writeExecutionReport({
    parsed, mapping, records, healingLog, outputPath, htmlPath, generatedAt,
    resultsPath: resultsPath ? path.relative(process.cwd(), resultsPath).replace(/\\/g, '/') : null,
  });

  const rel = (target: string) => path.relative(process.cwd(), target).replace(/\\/g, '/');
  process.stdout.write(`\nexecution report: ${rel(outputPath)}\n`);
  if (writtenHtml)
    process.stdout.write(`html report     : ${rel(writtenHtml)}\n`);
  process.stdout.write('\n');
  printSummary(summary);

  // Opt-in only: this is the one path that modifies the tester's own file.
  if (hasFlag(args, 'in-place')) {
    // With filters, scope the write to what was selected; without them the
    // report covers the whole workbook and every row may be written.
    const filtered = selectedCases(parsed, args);
    const scoped = filtered.length !== parsed.testCases.length
      ? new Set(filtered.map(testCase => testCase.testCaseId.toUpperCase()))
      : undefined;
    const writeback = await writeResultsIntoWorkbook({
      parsed, rows, timestamp: generatedAt, links: reportLinks(outputPath),
      onlyTestCaseIds: scoped,
    });
    process.stdout.write(`\n  Results written into: ${writeback.workbookPath}\n`);
    process.stdout.write(`  Backup of the original: ${writeback.backup}\n`);
    process.stdout.write(`  Rows updated: ${writeback.rowsUpdated}\n`);
    if (writeback.columnsAdded.length)
      process.stdout.write(`  Columns added: ${writeback.columnsAdded.join(', ')}\n`);
    if (writeback.unmatched.length)
      process.stdout.write(`  Not matched in the workbook: ${writeback.unmatched.join(', ')}\n`);
    process.stdout.write('\n');
  } else {
    process.stdout.write(`\n  Source workbook  : ${parsed.workbookPath} (unchanged - pass --in-place to write results into it)\n\n`);
  }
}

function commandTitle(args: Args): void {
  // Small helper the generator skill uses to keep test titles consistent.
  const id = args.positionals[0];
  const scenario = args.positionals.slice(1).join(' ');
  if (!id)
    fail('usage: excel:title -- TC_LOGIN_001 "Valid Login"');
  process.stdout.write(`${testTitleFor({ testCaseId: id, scenario, description: '' } as TestCase)}\n`);
}

const USAGE = `
Excel Test Case Integration

  list       <workbook> [--sheet "Create Project"] [--module M] [--feature F]
             [--priority P0] [--tag T]
             [--status "Not Automated"] [--id TC_LOGIN_001] [--json]
  quality    <workbook> [--out ai/reports/test-case-quality-report.md]
  mapping    list | sync [--workbook W] [--spec-dir tests-e2e]
             | promote [--results test-results-excel/results.json]
             | review <ID> --reason "..." [--workbook W]
             | status <ID> <Automation Status> [--reason "..."]
             | unautomated <workbook> [filters]
  sync-data  <workbook> [--strict]
             Shows which rows execute without a spec, and why the others do not.
             Rebuilt automatically by \`run\` and by globalSetup - this is for
             inspecting the contract. --strict exits non-zero when a row declares
             a contract that cannot be read, which makes it a CI gate needing no
             browser, credentials or network.

  run        <workbook> [--sheet "Create Project"] [--module M] [--priority P0]
             [--tag T] [--id TC_LOGIN_001] [--all] [--dry-run] [--no-in-place]
             Runs the cases the workbook selects, then writes the results back
             into that same workbook. A "Run" column (Yes/No) drives selection;
             without one, the filters above apply. --all ignores the Run column.

             Filters AND with the Run column, so --sheet "Create Project" runs
             only that sheet even when other sheets are marked Yes, and only the
             rows it covered are written back. --dry-run shows the selection and
             why everything else was excluded, without executing anything.

  report     <workbook> [--results test-results-excel/results.json]
             [--healing ai/reports/healing-log.json]
             [--out reports/excel-execution-report.xlsx]
             [--in-place] [--html <path> | --no-html]

By default the source workbook is only ever opened read-only. \`run\`, and
\`report --in-place\`, write results back into it - and always copy it to
excel/.backups/ first.
`;

/**
 * Rebuild the data-driven cache from a workbook.
 *
 * `excel:run` and globalSetup both do this automatically; this exists for
 * inspecting what the workbook actually declares, and for the rare run that
 * goes through neither.
 */
async function commandSyncData(args: Args): Promise<void> {
  const workbookPath = requireWorkbook(args);
  const parsed = await parseWorkbook(workbookPath);
  const cache = buildCache(parsed, nowIso());
  const file = writeCache(cache);

  process.stdout.write(`\n${cache.cases.length} data-driven row(s) in ${cache.workbook}` +
    `${cache.dataDrivenSheets.length ? ` (sheets: ${cache.dataDrivenSheets.join(', ')})` : ''}\n`);
  for (const testCase of cache.cases) {
    const inputs = Object.entries(testCase.inputs)
        .map(([name, token]) => `${name}=${token.kind === 'literal' ? token.value : `<${token.kind}>`}`)
        .join(' ');
    process.stdout.write(`  ${truncate(testCase.testCaseId, 16)} ${truncate(testCase.outcome, 10)} ` +
      `${truncate(inputs, 46)} ${testCase.scenario}\n`);
  }

  if (cache.rejected.length) {
    process.stdout.write(`\n! ${cache.rejected.length} row(s) declare a contract that cannot be read. ` +
      'These FAIL when the suite runs, rather than being skipped:\n');
    for (const row of cache.rejected)
      process.stdout.write(`  ${truncate(row.testCaseId, 16)} ${row.worksheet} row ${row.row}: ${row.reason}\n`);
  }

  if (!cache.dataDrivenSheets.length) {
    process.stdout.write('\nNo sheet has an "Assert Outcome" column, so nothing is data-driven here.\n' +
      'Add "Assert Outcome" (Signed In | Error | Blocked) and optionally "Assert Message"\n' +
      'to make a family of rows run without a spec being written.\n');
  }

  process.stdout.write(`\nwritten to ${path.relative(process.cwd(), file)}\n\n`);

  // --strict turns this into a gate. A row whose contract cannot be read is an
  // authoring mistake that will fail the suite anyway; catching it here costs
  // seconds and needs no browser, no credentials and no network.
  if (hasFlag(args, 'strict') && cache.rejected.length) {
    throw new UserFacingError(
        `${cache.rejected.length} data-driven row(s) declare a contract that cannot be read. ` +
        'Fix the workbook, or leave Assert Outcome empty to mark the row as not data-driven.');
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case 'list': case 'parse': await commandList(args); break;
    case 'run': await commandRun(args); break;
    case 'sync-data': await commandSyncData(args); break;
    case 'quality': await commandQuality(args); break;
    case 'mapping': await commandMapping(args); break;
    case 'report': await commandReport(args); break;
    case 'title': commandTitle(args); break;
    case undefined: case 'help': case '--help': case '-h': process.stdout.write(USAGE); break;
    default: fail(`Unknown command "${command}".${USAGE}`);
  }
}

main().catch((error: unknown) => {
  // Expected, fixable conditions get the message alone; genuine faults get the
  // stack, because that is what a stack trace is for.
  if (error instanceof UserFacingError) {
    process.stderr.write(`\nerror: ${error.message}\n\n`);
    process.exit(1);
  }
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
