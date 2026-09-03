/**
 * Local run dashboard: pick test cases in a browser, run them, watch the output.
 *
 *   npm run excel:dashboard        then open http://127.0.0.1:4321
 *
 * Why a server at all: a page cannot start a process. The HTML report the
 * framework already produces is a record of a run that happened; this is a
 * control surface for runs that have not happened yet, so something local has
 * to hold the child process and stream its output back.
 *
 * Three rules this file exists to enforce, because "browser input becomes a
 * command line" is exactly where test tooling grows a remote-execution hole:
 *
 *   1. Bound to 127.0.0.1. Never 0.0.0.0 - the whole office should not be able
 *      to drive your machine, and `--host` is deliberately not an option.
 *   2. Every child process is spawned with an argv array and `shell: false`.
 *      No string interpolation reaches a shell, ever.
 *   3. Nothing from the client is trusted as a command argument. Test case IDs
 *      are checked against the ones actually parsed from the workbook; the
 *      browser must be one of the configured projects; workers is clamped to a
 *      small integer. Anything else is rejected with 400 rather than sanitised,
 *      because a request that does not match the workbook is a bug or an
 *      attack, and neither deserves a best effort.
 *
 * Deliberately dependency-free (node:http, not hono/express): this repo is a
 * published npm wrapper whose dependency list is upstream's business.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { readCase, saveCase, suggestTestCaseId, type CaseDraft } from './authoring';
import { hasPendingRecording, keepArtifactFor, recordingStatus, startRecording, stopRecording, toDraft } from './recorder';
import { readState, surveyWork } from '../autocode/work';
import { assessReadiness } from '../excel/readiness';
import { describeRecording, recordingStatus, rememberRecordingFingerprint } from './case-status';
import {
  HISTORY_LIMIT, collectLifecycle, deriveStatus, listGenerations, newGenerationId,
  parseGenerationLog, readGeneration, saveGeneration, type GenerationRecord,
} from './generation-history';
import { buildCache, writeCache } from '../excel/data-driven';
import { MAPPING_FILE, readMapping, runnerFor, scanDataDrivenRunners, upsertEntry, writeMapping } from '../excel/mapping';
import { parseWorkbook } from '../excel/parser';
import { parseResults, type ExecutionRecord } from '../excel/results';
import { readStepLogs, type StepRecord } from '../excel/steps';
import type { TestCase } from '../excel/types';
import { UserFacingError } from '../excel/writeback';

/**
 * Always bound to loopback. A friendly hostname does not change that: the name
 * is mapped to 127.0.0.1 in the machine's own hosts file, so it resolves for
 * this machine and nowhere else. There is deliberately no way to bind 0.0.0.0.
 */
const BIND = '127.0.0.1';

/** The name people type. Mapped to 127.0.0.1 by a hosts entry - see printBanner. */
const HOSTNAME = process.env.EXCEL_DASHBOARD_HOST ?? 'moolyaautomationreport.com';

/**
 * Bumped whenever the page starts depending on a route the server did not have
 * before. The page compares it against its own and says so plainly rather than
 * failing with a bare 404 from a stale process.
 */
const API_VERSION = 7;

/** Port 80 so the URL carries no ":1234". Falls back when it is unavailable. */
const PORT = Number(process.env.EXCEL_DASHBOARD_PORT) || 80;
const FALLBACK_PORT = 4321;

const ROOT = process.cwd();
// Resolved from the repo root like every other path in ai/, rather than from
// import.meta.url: this file also uses require.resolve (as ai/excel/cli.ts
// does), and mixing the two module systems under tsx is asking for trouble.
const PUBLIC_DIR = path.join(ROOT, 'ai', 'dashboard', 'public');
const RUNS_DIR = path.join(ROOT, 'ai', 'dashboard', 'runs');
const RESULTS_JSON = path.join(ROOT, 'test-results-excel', 'results.json');
/** Playwright's own HTML report, rewritten in place by every run. */
const PLAYWRIGHT_REPORT = path.join(ROOT, 'reports', 'playwright-html');
const SPEC_DIR = path.join(ROOT, 'tests-e2e');

/** Projects the Playwright config can actually run. Anything else is rejected. */
const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
type Browser = (typeof BROWSERS)[number];

/** Upper bound on workers. Bugasura refuses concurrent navigation well before this. */
const MAX_WORKERS = 8;

/** Capture modes, matching Playwright's own vocabulary so nothing is translated. */
const SCREENSHOT_MODES = ['off', 'only-on-failure', 'on'] as const;
const VIDEO_MODES = ['off', 'retain-on-failure', 'on'] as const;
const TRACE_MODES = ['off', 'retain-on-failure', 'on'] as const;

interface RunRequest {
  workbook: string;
  testCaseIds: string[];
  browser: Browser;
  workers: number;
  headed: boolean;
  /** Write results back into the source workbook. Off by default here. */
  inPlace: boolean;
  screenshot: (typeof SCREENSHOT_MODES)[number];
  video: (typeof VIDEO_MODES)[number];
  trace: (typeof TRACE_MODES)[number];
}

/** One saved artefact, served back from the run's own copy. */
interface Evidence {
  testCaseId: string;
  name: string;
  /** URL under /api/runs/<id>/evidence/... */
  url: string;
}

/** One step of one test case, with its screenshot served from this run's copy. */
interface StepView {
  index: number;
  title: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
  /** URL under /api/runs/<id>/evidence/steps/... , when a screenshot was taken. */
  screenshotUrl?: string;
}

interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  request: Omit<RunRequest, 'workbook'> & { workbook: string };
  exitCode?: number | null;
  /** Set when the run produced no results of its own. */
  note?: string;
  /** Per-test-case outcome, filled in when the run ends. */
  results: ExecutionRecord[];
  /** Screenshots, video and traces, copied out of Playwright's output directory. */
  evidence: Evidence[];
  /** Ordered steps per test case, so a failure names the step it happened in. */
  steps: Record<string, StepView[]>;
  /** True when this run's own copy of the Playwright HTML report was kept. */
  hasReport?: boolean;
  summary: { passed: number; failed: number; skipped: number; flaky: number };
}

/** One run at a time. Two concurrent Playwright runs would fight over
 * test-results-excel/, which Playwright wipes at the start of every run. */
let active: { record: RunRecord; child: ChildProcess; log: string[]; clients: Set<http.ServerResponse> } | null = null;

/**
 * The code generator, spawned after a save or an upload.
 *
 * Held separately from `active` because it is not a test run and must not make
 * the Run button think one is in progress - but it does verify its work by
 * running Playwright, so the two still cannot overlap.
 */
let autocode: {
  child: ChildProcess; log: string[]; startedAt: string; workbook: string; ids: string[];
  clients: Set<http.ServerResponse>;
} | null = null;

/**
 * Its own client set, not the run stream's.
 *
 * `broadcast` drops everything when no test run is active, which is exactly
 * when the generator is doing its work - reusing it would have thrown away
 * every line and looked like the generator had hung.
 */
function broadcastAutocode(event: string, data: unknown): void {
  if (!autocode)
    return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of autocode.clients)
    client.write(payload);
}

/**
 * Ask the generator to write code for what just changed.
 *
 * Detached from the request: generation opens a browser and can take minutes,
 * and an HTTP save must not sit waiting for it. Progress is streamed to the
 * page over the same channel a test run uses.
 *
 * Refused rather than queued while anything else is running. `excel:autocode`
 * takes its own lock as well, so a watcher started in a terminal and this
 * cannot collide either.
 */
function startAutocode(workbookPath: string, ids: string[]): { started: boolean; reason?: string } {
  if (active)
    return { started: false, reason: 'a test run is in progress' };
  if (autocode)
    return { started: false, reason: 'the generator is already running' };

  const args = [
    'ai/autocode/cli.ts',
    path.relative(ROOT, workbookPath).replace(/\\/g, '/'),
  ];
  // Validated against the workbook by the caller; passed as one argv element,
  // never concatenated into a command line.
  if (ids.length)
    args.push('--ids', ids.join(','));

  const child = spawn(process.execPath, [require.resolve('tsx/cli'), ...args], {
    cwd: ROOT,
    shell: false,
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  const log: string[] = [];
  autocode = {
    child, log,
    startedAt: new Date().toISOString(),
    workbook: path.relative(ROOT, workbookPath).replace(/\\/g, '/'),
    ids,
    clients: new Set(),
  };

  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    log.push(text);
    broadcastAutocode('log', { text });
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);
  child.on('close', exitCode => {
    // Recorded BEFORE the 'done' event, not after: the page reloads its history the
    // moment it hears 'done', and a record written afterwards would be missed by the
    // very refresh that was watching for it - the run you just sat through would be
    // the one run missing from the table until you pressed Refresh.
    recordGeneration(autocode, exitCode);
    broadcastAutocode('done', { exitCode });
    for (const client of autocode?.clients ?? [])
      client.end();
    autocode = null;
  });

  return { started: true };
}

/**
 * Turn the generation that just ended into one of the five retained records.
 *
 * Everything here is READ from the generator's own output: the runId from the line
 * `ai/autocode/cli.ts` prints, the per-case verdicts from the lines the orchestrator
 * prints, the status from those plus the exit code. Nothing is inferred from timing
 * and nothing is invented for a run that said nothing.
 *
 * The Page Object decisions are copied INTO the record rather than pointed at.
 * `ai/reports/page-object-lifecycle.jsonl` is append-only, shared by every generation
 * and lives under a git-ignored directory that is routinely cleared - a record that
 * merely held the runId would answer this question differently next week, and not at
 * all after somebody deleted `ai/reports/`.
 *
 * Never thrown from. A history record that takes the dashboard down with it on the way
 * out of a generation is worse than a generation with no history record.
 */
function recordGeneration(run: typeof autocode, exitCode: number | null): void {
  if (!run)
    return;
  try {
    const log = run.log.join('');
    const parsed = parseGenerationLog(log);
    const record: GenerationRecord = {
      id: newGenerationId(),
      runId: parsed.runId,
      workbook: run.workbook,
      requestedIds: run.ids,
      cases: parsed.cases,
      status: deriveStatus(parsed.cases, exitCode),
      startedAt: run.startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      log,
      lifecycle: collectLifecycle(parsed.runId),
    };
    saveGeneration(record);
  } catch (error) {
    process.stderr.write(`(generation not recorded: ${(error as Error).message})\n`);
  }
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(payload);
}

function badRequest(res: http.ServerResponse, message: string): void {
  send(res, 400, { error: message });
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A control panel never needs a large body; refuse rather than buffer.
    if (size > 256_000)
      throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** Resolve a client-supplied workbook path, refusing anything outside the repo. */
function resolveWorkbook(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : 'excel/login-test-cases.xlsx';
  const absolute = path.resolve(ROOT, raw);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Workbook must live inside the repository');
  if (!/\.xlsx$/i.test(absolute))
    throw new Error('Workbook must be an .xlsx file');
  if (!fs.existsSync(absolute))
    throw new Error(`No workbook at ${relative}`);
  return absolute;
}

/**
 * Is the spec a mapping entry names still on disk?
 *
 * The mapping is a record; the file is the fact. They disagree whenever a spec is
 * deleted without the entry being synced - `excel:mapping sync` is what reconciles
 * them - and every caller here wants the fact.
 */
function specExists(testFile: string | undefined): boolean {
  return Boolean(testFile) && fs.existsSync(path.resolve(ROOT, testFile as string));
}

/** Everything the UI needs to render the picker for one workbook. */
async function describeWorkbook(workbookPath: string) {
  const parsed = await parseWorkbook(workbookPath);
  const mapping = readMapping(MAPPING_FILE);
  const cache = buildCache(parsed, new Date().toISOString());
  const runners = scanDataDrivenRunners(SPEC_DIR);

  // 'no-runner' survives only for the case where even the wildcard runner is
  // missing, which means someone deleted tests-e2e/generic/generic.spec.ts.
  const dataDriven = new Map<string, 'ready' | 'broken' | 'no-runner'>();
  for (const row of cache.cases)
    dataDriven.set(row.testCaseId.toUpperCase(), runnerFor(runners, row.module) ? 'ready' : 'no-runner');
  for (const row of cache.rejected) {
    if (runnerFor(runners, row.module))
      dataDriven.set(row.testCaseId.toUpperCase(), 'broken');
  }

  const describe = (testCase: TestCase) => {
    const entry = mapping[testCase.testCaseId];
    const kind = dataDriven.get(testCase.testCaseId.toUpperCase());
    return {
      testCaseId: testCase.testCaseId,
      worksheet: testCase.source.worksheet,
      row: testCase.source.row,
      module: testCase.module,
      feature: testCase.feature,
      scenario: testCase.scenario,
      priority: testCase.priority,
      tags: testCase.tags,
      automationStatus: entry?.status ?? testCase.automationStatus,
      testFile: entry?.testFile ?? '',
      execute: testCase.execute,
      dataDriven: kind ?? null,
      // The single fact the UI needs to grey out a checkbox: is there anything
      // to run? Data-driven rows qualify without a mapping entry.
      // 'no-runner' is deliberately not runnable: the contract is fine, but
      // nothing exists that knows how to perform this module's actions.
      //
      // The mapping names a file; only the file itself proves there is anything
      // to run. An entry whose spec has been deleted used to read as runnable,
      // so the case was selectable, /api/run accepted it, and Playwright then
      // reported `No tests found` with nothing to show for the run.
      runnable: specExists(entry?.testFile) || kind === 'ready' || kind === 'broken',
      blockedReason: testCase.issues.filter(i => i.severity === 'error').map(i => i.message),
      // P1. Three separate answers, deliberately not merged into one badge:
      //
      //   readiness  is this row AUTHORED well enough to build from?
      //   recording  does the evidence still match what the row says?
      //   system     what the framework has done about it so far.
      //
      // `automationStatus` above answers none of those, which is why one column
      // could never explain why a row was not running.
      readiness: (() => {
        const recording = recordingStatus(testCase);
        const verdict = assessReadiness(testCase, {
          recording: { exists: recording.exists, stale: recording.stale },
        });
        return {
          ready: verdict.ready,
          codes: verdict.codes,
          findings: verdict.findings.map(finding => ({
            code: finding.code, severity: finding.severity, field: finding.field, message: finding.message,
          })),
        };
      })(),
      recording: (() => {
        const status = recordingStatus(testCase);
        return {
          exists: status.exists,
          hasEvidence: status.hasEvidence,
          stale: status.stale ?? null,
          summary: describeRecording(status),
        };
      })(),
      system: {
        automationStatus: entry?.status ?? testCase.automationStatus,
        testFile: entry?.testFile ?? '',
        testName: entry?.testName ?? '',
        lastGeneratedAt: entry?.lastGeneratedAt ?? '',
        executionStatus: testCase.extra['Execution Status'] ?? '',
        lastExecutionTime: testCase.extra['Last Execution Time'] ?? '',
        finalStatus: testCase.extra['Final Status'] ?? '',
      },
    };
  };

  return {
    workbook: path.relative(ROOT, workbookPath).replace(/\\/g, '/'),
    worksheets: parsed.worksheets.filter(s => s.recognized).map(s => s.worksheet),
    cases: parsed.testCases.map(describe),
    malformed: parsed.malformed.map(i => ({ worksheet: i.worksheet, row: i.row, message: i.message })),
  };
}

/**
 * Make a just-saved row executable, without anyone running a command.
 *
 * Two artefacts stand between a workbook row and a running test: the
 * data-driven cache the runners read at collection time, and the mapping entry
 * that makes the case traceable and selectable. `excel:run` builds both, so a
 * row saved here was already runnable *by that command* - but until it ran, the
 * dashboard showed it as having no automation behind it, and a bare
 * `excel:test` did not know about it at all.
 *
 * Doing it at save time closes that window: the row is live the moment the
 * author presses Save. It is the same code `excel:run` calls, so the two cannot
 * disagree.
 */
async function activate(workbookPath: string, testCaseId: string): Promise<{
  runnable: boolean;
  runner: string | null;
  /** Set when the saved row declares a contract that cannot be read. */
  contractError?: string;
  /** True when the generator has a spec to write - or an existing one to rewrite. */
  needsCode: boolean;
  /** Why the generator has nothing to do, in `surveyWork`'s own words. */
  noCodeReason?: string;
}> {
  const parsed = await parseWorkbook(workbookPath);
  const cache = buildCache(parsed, new Date().toISOString());
  writeCache(cache);

  const runners = scanDataDrivenRunners(SPEC_DIR);
  const wanted = testCaseId.toUpperCase();
  const rejected = cache.rejected.find(row => row.testCaseId.toUpperCase() === wanted);
  const saved = cache.cases.find(row => row.testCaseId.toUpperCase() === wanted) ?? rejected;
  const runner = saved ? runnerFor(runners, saved.module) : null;

  // Only the row that was just saved. `excel:run` registers every row in the
  // cache because it is about to decide what can run; a save is about one row,
  // and the mapping is keyed by Test Case ID alone. Two workbooks sharing an ID
  // - which is what a copy of a workbook is - would otherwise have each other's
  // entries rewritten every time someone pressed Save in either one.
  if (saved && runner) {
    const mapping = readMapping(MAPPING_FILE);
    upsertEntry(mapping, saved.testCaseId, {
      testFile: runner,
      testName: `${saved.testCaseId} - ${saved.scenario}`,
      module: saved.module,
      scenario: saved.scenario,
      // Never demote a case a green run already earned.
      status: mapping[saved.testCaseId]?.status ?? 'Generated',
      sourceWorkbook: parsed.workbook,
      sourceWorksheet: saved.worksheet,
      sourceRow: saved.row,
    }, new Date().toISOString());
    writeMapping(mapping, MAPPING_FILE);
  }

  // Whether code needs writing is `surveyWork`'s decision, never a rule
  // restated here. It is the same call `excel:autocode` makes, so the page and
  // the generator cannot disagree - and it already draws the distinction this
  // used to flatten: a spec THIS module generated, whose row has been edited
  // since, is `stale` work and has to be rewritten. Only a hand-written spec is
  // "already automated" and nobody else's to touch.
  //
  // Asking here rather than spawning and letting the generator decide keeps the
  // old property that a save which needs no code starts no process.
  const mapping = readMapping(MAPPING_FILE);
  const wantedId = saved?.testCaseId ?? testCaseId;
  const survey = surveyWork(parsed, mapping, readState(), new Set([wantedId.toUpperCase()]));
  const needsCode = survey.work.length > 0;
  // Exactly one row was surveyed, so there is at most one reason to report.
  const noCodeReason = needsCode ? undefined : survey.skipped[0]?.reason;

  // A row can also be covered by a spec somebody wrote, which the data-driven
  // cache knows nothing about - as long as that spec is still there. The same
  // rule as the picker's: the mapping names a file, the file is what runs.
  const existing = mapping[wantedId]?.testFile;
  if (!runner && specExists(existing))
    return { runnable: true, runner: existing as string, needsCode, noCodeReason };

  return {
    runnable: Boolean(runner), runner, contractError: rejected?.reason,
    needsCode, noCodeReason,
  };
}

function parseRunRequest(body: unknown, known: Set<string>): RunRequest {
  const input = (body ?? {}) as Record<string, unknown>;

  const ids = Array.isArray(input.testCaseIds) ? input.testCaseIds.map(String) : [];
  if (!ids.length)
    throw new Error('Select at least one test case');
  // Reject rather than filter. A request naming a case this workbook does not
  // contain means the page is out of date or the input is hostile; quietly
  // running the subset that happens to match would hide both.
  const unknown = ids.filter(id => !known.has(id.toUpperCase()));
  if (unknown.length)
    throw new Error(`Not in this workbook: ${unknown.slice(0, 5).join(', ')}`);

  const browser = String(input.browser ?? 'chromium') as Browser;
  if (!BROWSERS.includes(browser))
    throw new Error(`Unknown browser "${browser}"`);

  const workers = Number(input.workers ?? 1);
  if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS)
    throw new Error(`Workers must be a whole number between 1 and ${MAX_WORKERS}`);

  const pick = <T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], label: string): T[number] => {
    const chosen = String(value ?? fallback);
    if (!allowed.includes(chosen))
      throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
    return chosen as T[number];
  };

  return {
    workbook: '',
    testCaseIds: ids,
    browser,
    workers,
    headed: input.headed === true,
    inPlace: input.inPlace === true,
    screenshot: pick(input.screenshot, SCREENSHOT_MODES, 'only-on-failure', 'Screenshot'),
    video: pick(input.video, VIDEO_MODES, 'retain-on-failure', 'Video'),
    trace: pick(input.trace, TRACE_MODES, 'retain-on-failure', 'Trace'),
  };
}

/**
 * Copy this run's artefacts somewhere they will survive.
 *
 * Playwright wipes `outputDir` at the start of every run, so a screenshot from
 * an earlier execution is already gone by the time anyone clicks on it. Past
 * results are only worth showing if their evidence is still there, so each run
 * keeps its own copy.
 */
function keepPlaywrightReport(runId: string): boolean {
  const index = path.join(PLAYWRIGHT_REPORT, 'index.html');
  if (!fs.existsSync(index))
    return false;
  try {
    // The reporter rewrites reports/playwright-html/ on every run, so linking
    // past executions at the live folder would show all of them whatever the
    // newest run produced - wrong exactly when an old failure is what you came
    // back to look at.
    fs.cpSync(PLAYWRIGHT_REPORT, path.join(RUNS_DIR, runId, 'playwright-report'), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function collectEvidence(runId: string): Evidence[] {
  if (!fs.existsSync(RESULTS_JSON))
    return [];

  const destRoot = path.join(RUNS_DIR, runId, 'evidence');
  const evidence: Evidence[] = [];
  const seen = new Set<string>();

  interface Spec { title: string; tests?: Array<{ results?: Array<{ attachments?: Array<{ name: string; path?: string }> }> }> }
  interface Suite { suites?: Suite[]; specs?: Spec[] }

  const walk = (suite: Suite): void => {
    for (const child of suite.suites ?? [])
      walk(child);
    for (const spec of suite.specs ?? []) {
      const testCaseId = /^((?:TC|TS)[_-][A-Za-z0-9_-]+)/.exec(spec.title)?.[1] ?? spec.title;
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          for (const attachment of result.attachments ?? []) {
            // Inline attachments (the Allure metadata blobs) have no path and
            // are not evidence anyone wants to open.
            if (!attachment.path || !fs.existsSync(attachment.path))
              continue;
            if (!/^(screenshot|video|trace)$/.test(attachment.name))
              continue;
            const relative = path.relative(path.join(ROOT, 'test-results-excel'), attachment.path);
            if (relative.startsWith('..') || seen.has(relative))
              continue;
            seen.add(relative);
            const destination = path.join(destRoot, relative);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(attachment.path, destination);
            evidence.push({
              testCaseId,
              name: attachment.name,
              url: `/api/runs/${runId}/evidence/${relative.split(path.sep).map(encodeURIComponent).join('/')}`,
            });
          }
        }
      }
    }
  };

  try {
    const report = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8')) as { suites?: Suite[] };
    for (const suite of report.suites ?? [])
      walk(suite);
  } catch {
    return [];
  }
  return evidence;
}

/**
 * Copy this run's step screenshots somewhere they survive, and turn them into
 * URLs.
 *
 * Same reason the other evidence is copied: Playwright wipes its output
 * directory at the start of the next run, and a step screenshot is worth
 * exactly nothing if it is gone by the time somebody comes back to look at why
 * a test went red last Tuesday.
 */
function collectSteps(runId: string): Record<string, StepView[]> {
  const logs = readStepLogs();
  const views: Record<string, StepView[]> = {};

  for (const [testCaseId, log] of Object.entries(logs)) {
    views[testCaseId] = log.steps.map((step: StepRecord) => {
      const view: StepView = {
        index: step.index, title: step.title, status: step.status,
        durationMs: step.durationMs, error: step.error,
      };
      if (!step.screenshotPath || !fs.existsSync(step.screenshotPath))
        return view;
      try {
        const name = `${String(step.index).padStart(2, '0')}.png`;
        const destination = path.join(RUNS_DIR, runId, 'evidence', 'steps', testCaseId, name);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(step.screenshotPath, destination);
        view.screenshotUrl =
          `/api/runs/${runId}/evidence/steps/${encodeURIComponent(testCaseId)}/${name}`;
      } catch {
        // A missing screenshot must not cost the step list it belongs to.
      }
      return view;
    });
  }
  return views;
}

function summarise(results: ExecutionRecord[]): RunRecord['summary'] {
  return {
    passed: results.filter(r => r.executionStatus === 'Passed').length,
    failed: results.filter(r => r.executionStatus === 'Failed').length,
    skipped: results.filter(r => r.executionStatus === 'Skipped').length,
    flaky: results.filter(r => r.flaky).length,
  };
}

function broadcast(event: string, data: unknown): void {
  if (!active)
    return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of active.clients)
    client.write(payload);
}

function saveRun(record: RunRecord, log: string[]): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNS_DIR, `${record.id}.json`),
      `${JSON.stringify({ ...record, log }, null, 2)}\n`, 'utf8');
}

function startRun(workbookPath: string, request: RunRequest): RunRecord {
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const record: RunRecord = {
    id,
    startedAt: new Date().toISOString(),
    request: { ...request, workbook: path.relative(ROOT, workbookPath).replace(/\\/g, '/') },
    results: [],
    evidence: [],
    steps: {},
    summary: { passed: 0, failed: 0, skipped: 0, flaky: 0 },
  };

  // argv array, shell:false. Nothing here is ever concatenated into a command
  // string, so a test case ID containing shell metacharacters is just a string.
  // The `=` form is required, not stylistic: the CLI's parser stops reading a
  // flag's value at the next token starting with "--", so a separated
  // `--playwright-arg --project=firefox` would be read as a valueless flag.
  const args = [
    'ai/excel/cli.ts', 'run',
    path.relative(ROOT, workbookPath),
    '--id', request.testCaseIds.join(','),
    `--playwright-arg=--project=${request.browser}`,
    `--playwright-arg=--workers=${request.workers}`,
  ];
  if (request.headed)
    args.push('--playwright-arg=--headed');
  if (!request.inPlace)
    args.push('--no-in-place');

  const child = spawn(process.execPath, [require.resolve('tsx/cli'), ...args], {
    cwd: ROOT,
    shell: false,
    env: {
      ...process.env,
      // Only unlock the extra projects when one is actually requested, so the
      // default single-project behaviour is untouched.
      ...(request.browser === 'chromium' ? {} : { EXCEL_ALL_BROWSERS: '1' }),
      EXCEL_WORKERS: String(request.workers),
      EXCEL_SCREENSHOT: request.screenshot,
      EXCEL_VIDEO: request.video,
      EXCEL_TRACE: request.trace,
      FORCE_COLOR: '0',
    },
  });

  // Remember how old the results file is BEFORE the run. If a run dies without
  // producing one, an unchanged file still holds the previous run's outcome -
  // and reporting that as this run's result is the worst failure this dashboard
  // could have: it turns a crashed run into a confident green table.
  const resultsBefore = fs.existsSync(RESULTS_JSON) ? fs.statSync(RESULTS_JSON).mtimeMs : 0;

  const log: string[] = [];
  active = { record, child, log, clients: new Set() };

  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    log.push(text);
    broadcast('log', { text });
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);

  child.on('close', exitCode => {
    record.finishedAt = new Date().toISOString();
    record.exitCode = exitCode;
    // Read the per-case outcome from the run Playwright just wrote. This is the
    // same file the execution report is built from, so the dashboard and the
    // spreadsheet can never disagree about what happened.
    const resultsAfter = fs.existsSync(RESULTS_JSON) ? fs.statSync(RESULTS_JSON).mtimeMs : 0;
    if (resultsAfter && resultsAfter !== resultsBefore) {
      try {
        record.results = parseResults(RESULTS_JSON);
        record.evidence = collectEvidence(record.id);
        // globalSetup clears the step directory at the start of every run, so
        // whatever is there now belongs to this run and nothing earlier.
        record.steps = collectSteps(record.id);
        record.hasReport = keepPlaywrightReport(record.id);
      } catch {
        record.results = [];
        record.steps = {};
      }
    } else {
      record.results = [];
      record.steps = {};
      record.note = 'This run produced no results file, so nothing was executed. ' +
        'The output above says why; the results below are intentionally empty rather than ' +
        'the previous run\'s.';
      log.push(`\n${record.note}\n`);
      broadcast('log', { text: `\n${record.note}\n` });
    }
    record.summary = summarise(record.results);
    saveRun(record, log);
    broadcast('done', record);
    for (const client of active?.clients ?? [])
      client.end();
    active = null;
  });

  return record;
}

function listRuns(): Array<Pick<RunRecord, 'id' | 'startedAt' | 'finishedAt' | 'exitCode' | 'summary'> & { count: number }> {
  if (!fs.existsSync(RUNS_DIR))
    return [];
  return fs.readdirSync(RUNS_DIR)
      .filter(name => name.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 50)
      .map(name => {
        const record = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, name), 'utf8')) as RunRecord;
        return {
          id: record.id,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          exitCode: record.exitCode,
          summary: record.summary,
          count: record.results.length,
          browser: record.request?.browser ?? '',
          workers: record.request?.workers ?? 1,
          headed: record.request?.headed ?? false,
          evidenceCount: record.evidence?.length ?? 0,
          hasReport: record.hasReport ?? false,
          note: record.note,
        };
      });
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  // Playwright's HTML report ships its own fonts, icons and trace viewer.
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

/** Serve a file from `base`, refusing any path that escapes it. */
function serveStatic(res: http.ServerResponse, base: string, requested: string): boolean {
  const absolute = path.resolve(base, `.${requested}`);
  if (!absolute.startsWith(path.resolve(base)))
    return false;
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile())
    return false;
  res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(absolute).pipe(res);
  return true;
}

const server = http.createServer((req, res) => {
  // Base is only needed so URL() can parse a path; the request's own Host
  // header is irrelevant here and deliberately not trusted for anything.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = url.pathname;

  void (async () => {
    try {
      if (route === '/' || route === '/index.html') {
        serveStatic(res, PUBLIC_DIR, '/index.html');
        return;
      }

      if (route === '/api/workbook' && req.method === 'GET') {
        const workbookPath = resolveWorkbook(url.searchParams.get('workbook'));
        send(res, 200, await describeWorkbook(workbookPath));
        return;
      }

      // Lets the page check it is talking to a server that understands it.
      //
      // index.html is read from disk on every request, so an out-of-date server
      // process still serves the newest page - the buttons are all there and the
      // endpoints behind them are not. That failure reads as "No route for
      // /api/case", which says nothing about the actual problem.
      if (route === '/api/health' && req.method === 'GET') {
        send(res, 200, { api: API_VERSION,
          routes: ['run', 'case', 'next-id', 'upload', 'runs', 'report', 'autocode', 'record',
            'generations'] });
        return;
      }

      if (route === '/api/workbooks' && req.method === 'GET') {
        const dir = path.join(ROOT, 'excel');
        const files = fs.existsSync(dir)
          ? fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$')).map(f => `excel/${f}`)
          : [];
        send(res, 200, { workbooks: files });
        return;
      }

      // Upload a workbook. The file arrives as the raw body with its name in
      // the query, which avoids hand-rolling a multipart parser for a local
      // single-file upload. The name is stripped to a basename and forced into
      // excel/, so it cannot be written anywhere else.
      if (route === '/api/upload' && req.method === 'POST') {
        const requested = path.basename(url.searchParams.get('name') ?? '');
        if (!/^[\w. -]+\.xlsx$/i.test(requested))
          throw new Error('Upload must be an .xlsx file with a plain file name.');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > 25 * 1024 * 1024)
            throw new Error('Workbook is larger than 25 MB.');
          chunks.push(chunk as Buffer);
        }
        if (!size)
          throw new Error('No file content received.');
        const destination = path.join(ROOT, 'excel', requested);
        // Never silently replace a workbook that already has results in it.
        if (fs.existsSync(destination)) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          fs.mkdirSync(path.join(ROOT, 'excel', '.backups'), { recursive: true });
          fs.copyFileSync(destination, path.join(ROOT, 'excel', '.backups',
              `${path.basename(requested, '.xlsx')}.${stamp}.xlsx`));
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, Buffer.concat(chunks));
        // Parse immediately: an unreadable upload should fail here, not later.
        const summary = await describeWorkbook(destination);
        // A bulk import is the case this exists for: every row that needs a
        // spec gets one, without anyone naming them.
        const generating = startAutocode(destination, []);
        send(res, 200, { workbook: `excel/${requested}`, cases: summary.cases.length,
          worksheets: summary.worksheets, malformed: summary.malformed, autocode: generating });
        return;
      }

      // A preview of the ID the form will get. The authoritative one is
      // generated at save time, after the final re-parse, so two tabs open at
      // once cannot both be handed the same number.
      if (route === '/api/next-id' && req.method === 'GET') {
        const workbookPath = resolveWorkbook(url.searchParams.get('workbook'));
        const parsed = await parseWorkbook(workbookPath);
        send(res, 200, suggestTestCaseId(parsed,
            url.searchParams.get('worksheet') ?? '',
            url.searchParams.get('module') ?? ''));
        return;
      }

      if (route === '/api/case' && req.method === 'GET') {
        const workbookPath = resolveWorkbook(url.searchParams.get('workbook'));
        const id = url.searchParams.get('id') ?? '';
        const draft = await readCase(workbookPath, id);
        if (!draft) {
          send(res, 404, { error: `${id} is not in this workbook` });
          return;
        }
        send(res, 200, draft);
        return;
      }

      if (route === '/api/case' && req.method === 'POST') {
        if (active) {
          send(res, 409, { error: 'A run is in progress. Wait for it to finish before editing the workbook.' });
          return;
        }
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const workbookPath = resolveWorkbook(body.workbook);
        if (!body.draft || typeof body.draft !== 'object')
          throw new Error('No test case was submitted. Fill the form in and press Save again.');
        const draft = body.draft as CaseDraft;
        // saveCase returns the ID it actually wrote, which for a new case is
        // usually one it generated - echoing the (blank) draft value back would
        // leave the page saying "Added  in row 4".
        const saved = await saveCase(workbookPath, draft, body.isNew === true);
        // A recording waiting from /api/record/stop belongs to the row that was just
        // saved: only now does its Test Case ID exist. The artifact is redacted
        // already and is deleted by the mapper once a spec has been assembled from
        // it. Nothing here changes how the case is saved.
        const artifact = hasPendingRecording() ? keepArtifactFor(saved.testCaseId) : null;
        // What the row said at the moment this recording was retained. Written
        // beside the artifact, never into it, so the next edit can be compared
        // against it. See ai/dashboard/case-status.ts.
        if (artifact) {
          const savedRow = (await parseWorkbook(workbookPath)).testCases
              .find(row => row.testCaseId.toUpperCase() === saved.testCaseId.toUpperCase());
          if (savedRow)
            rememberRecordingFingerprint(savedRow);
        }
        // Rebuild the cache and register the mapping straight away, so the row
        // is a running test before the response reaches the page.
        const live = await activate(workbookPath, saved.testCaseId);
        // Send the generator after any row that needs code written, including
        // one whose spec this module already wrote and whose row has since been
        // edited. Keying off `runnable` was wrong: a spec-backed case is
        // runnable, so an edit to it silently left the old spec asserting the
        // old wording while the page said there was nothing left to do.
        const generating = live.needsCode
          ? startAutocode(workbookPath, [saved.testCaseId])
          : { started: false, reason: live.noCodeReason ?? 'no runner covers this module' };
        send(res, 200, { ...saved, ...live, autocode: generating, ...(artifact ? { recordingArtifact: artifact } : {}) });
        return;
      }

      if (route === '/api/run' && req.method === 'POST') {
        // The generator verifies its work by running Playwright, so it owns the
        // output directory for as long as it is going.
        if (autocode) {
          send(res, 409, { error: 'The code generator is running and needs Playwright to verify what it wrote. Wait for it to finish, or stop it.' });
          return;
        }
        if (active) {
          send(res, 409, { error: 'A run is already in progress. Playwright wipes its output directory at the start of every run, so two at once would destroy each other’s results.' });
          return;
        }
        const body = await readJsonBody(req);
        const workbookPath = resolveWorkbook((body as Record<string, unknown>).workbook);
        const parsed = await parseWorkbook(workbookPath);
        const known = new Set(parsed.testCases.map(c => c.testCaseId.toUpperCase()));
        const request = parseRunRequest(body, known);
        send(res, 202, startRun(workbookPath, request));
        return;
      }

      if (route === '/api/stream' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        if (!active) {
          res.write(`event: idle\ndata: {}\n\n`);
          res.end();
          return;
        }
        // Replay what has already been printed, so a page opened mid-run is not
        // left staring at a blank console.
        res.write(`event: log\ndata: ${JSON.stringify({ text: active.log.join('') })}\n\n`);
        active.clients.add(res);
        req.on('close', () => active?.clients.delete(res));
        return;
      }

      // Progress from the code generator. Separate from /api/stream because a
      // generation run is not a test run and outlives none of the same state.
      if (route === '/api/autocode/stream' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        if (!autocode) {
          res.write(`event: idle\ndata: {}\n\n`);
          res.end();
          return;
        }
        res.write(`event: log\ndata: ${JSON.stringify({ text: autocode.log.join('') })}\n\n`);
        autocode.clients.add(res);
        req.on('close', () => autocode?.clients.delete(res));
        return;
      }

      if (route === '/api/autocode' && req.method === 'GET') {
        send(res, 200, autocode
          ? { running: true, startedAt: autocode.startedAt, workbook: autocode.workbook, ids: autocode.ids }
          : { running: false });
        return;
      }

      // Ask for generation explicitly. The trigger is automatic, but a run that
      // was refused because something else was in progress needs a way back.
      if (route === '/api/autocode' && req.method === 'POST') {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const workbookPath = resolveWorkbook(body.workbook);
        const parsed = await parseWorkbook(workbookPath);
        const known = new Set(parsed.testCases.map(c => c.testCaseId.toUpperCase()));
        const ids = Array.isArray(body.testCaseIds) ? body.testCaseIds.map(String) : [];
        const unknown = ids.filter(id => !known.has(id.toUpperCase()));
        if (unknown.length)
          throw new Error(`Not in this workbook: ${unknown.slice(0, 5).join(', ')}`);

        // NEVER SILENTLY REUSE STALE RECORDING EVIDENCE (P1).
        //
        // A recorded case whose steps have been edited since is not a case the
        // generator may quietly reassemble: the recording is evidence for what
        // the row USED to say. The choice - re-record, or undo the edit - belongs
        // to a person, so the request is refused here with the reason rather than
        // producing a spec built on the wrong evidence.
        const blocked: string[] = [];
        for (const id of ids) {
          const testCase = parsed.testCases.find(c => c.testCaseId.toUpperCase() === id.toUpperCase());
          if (!testCase)
            continue;
          const recording = recordingStatus(testCase);
          if (!recording.exists || recording.stale !== true)
            continue;
          const verdict = assessReadiness(testCase, {
            recording: { exists: recording.exists, stale: recording.stale },
          });
          if (!verdict.ready)
            blocked.push(`${testCase.testCaseId}: ${describeRecording(recording)}`);
        }
        if (blocked.length)
          throw new Error(blocked.join(' | '));
        const started = startAutocode(workbookPath, ids);
        send(res, started.started ? 202 : 409, started);
        return;
      }

      // ---- Record Test: a second way to author a case, not a second pipeline.
      //
      // These three routes only drive Playwright's own `codegen` and hand back the
      // parsed result. Saving is NOT here: the review screen posts the draft to
      // /api/case, the same endpoint the Add/Edit form uses, so a recorded case gets
      // the same ID, validation, backup, workbook write, cache and mapping as any
      // other. Nothing downstream can tell the difference.
      if (route === '/api/record/start' && req.method === 'POST') {
        // A recorder is a browser. Two browsers against the same application at once
        // is the concurrent navigation the suite already avoids, so it waits its turn
        // exactly as the other long-running actions do.
        if (active) {
          send(res, 409, { error: 'A test run is in progress. Wait for it to finish before recording.' });
          return;
        }
        if (autocode) {
          send(res, 409, { error: 'The code generator is running and is using a browser. Wait for it to finish, or stop it.' });
          return;
        }
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        // `await`: the live transport decides asynchronously whether it can run and
        // falls back to the codegen child process before answering, so the person
        // always gets a browser or a clear error - never a half-started session.
        const started = await startRecording({
          url: String(body.url ?? ''),
          browser: String(body.browser ?? 'chromium'),
        });
        send(res, started.started ? 202 : 400, started);
        return;
      }

      if (route === '/api/record' && req.method === 'GET') {
        send(res, 200, recordingStatus());
        return;
      }

      if (route === '/api/record/stop' && req.method === 'POST') {
        const result = await stopRecording();
        if (result.error || !result.recording) {
          send(res, 409, { error: result.error ?? 'The recording could not be read.' });
          return;
        }
        // The draft fields are derived here, deterministically, so the page never
        // has to know the shape of a Playwright script.
        send(res, 200, { recording: result.recording, draft: toDraft(result.recording) });
        return;
      }

      if (route === '/api/autocode/stop' && req.method === 'POST') {
        if (!autocode) {
          send(res, 409, { error: 'The generator is not running' });
          return;
        }
        autocode.child.kill();
        send(res, 200, { stopped: true });
        return;
      }

      if (route === '/api/stop' && req.method === 'POST') {
        if (!active) {
          send(res, 409, { error: 'Nothing is running' });
          return;
        }
        active.child.kill();
        send(res, 200, { stopped: true });
        return;
      }

      // ---- Generation history: the latest five, read back from disk.
      //
      // Its OWN prefix, deliberately, rather than a sub-route of /api/runs. The
      // `route.startsWith('/api/runs/')` handler further down is a catch-all: anything
      // registered under that prefix after it is swallowed and answered with "No such
      // run", which is a 404 that blames the wrong thing. A separate prefix cannot be
      // caught by it at all, whatever order these end up in.
      if (route === '/api/generations' && req.method === 'GET') {
        send(res, 200, { generations: listGenerations(), limit: HISTORY_LIMIT });
        return;
      }

      const generationRoute = /^\/api\/generations\/([^/]+)$/.exec(route);
      if (generationRoute && req.method === 'GET') {
        // basename() so a crafted id cannot walk out of the store, exactly as the runs
        // routes do. `readGeneration` applies it again for callers that are not a route.
        const id = path.basename(decodeURIComponent(generationRoute[1]));
        const record = readGeneration(id);
        if (!record) {
          send(res, 404, { error: 'No such generation' });
          return;
        }
        send(res, 200, record);
        return;
      }

      if (route === '/api/runs' && req.method === 'GET') {
        send(res, 200, { runs: listRuns(), active: active?.record.id ?? null });
        return;
      }

      // /api/runs/<id>/report[/...] - this run's own copy of the Playwright
      // HTML report. The trailing slash matters: the report is a single-page
      // app that loads its assets by relative path, and without it the browser
      // resolves them against /api/runs/ and every one 404s.
      const reportRoute = /^\/api\/runs\/([^/]+)\/report(\/.*)?$/.exec(route);
      if (reportRoute && req.method === 'GET') {
        const id = path.basename(decodeURIComponent(reportRoute[1]));
        const rest = reportRoute[2];
        if (rest === undefined || rest === '') {
          res.writeHead(302, { location: `/api/runs/${encodeURIComponent(id)}/report/` });
          res.end();
          return;
        }
        const base = path.join(RUNS_DIR, id, 'playwright-report');
        const requested = rest === '/' ? '/index.html' : decodeURIComponent(rest);
        if (!serveStatic(res, base, requested))
          send(res, 404, { error: 'No Playwright report kept for this run' });
        return;
      }

      // /api/runs/<id>/evidence/<path> - this run's own copy of a screenshot,
      // video or trace, which is why it still exists after later runs wiped
      // Playwright's output directory.
      const evidenceRoute = /^\/api\/runs\/([^/]+)\/evidence(\/.+)$/.exec(route);
      if (evidenceRoute && req.method === 'GET') {
        const id = path.basename(decodeURIComponent(evidenceRoute[1]));
        const base = path.join(RUNS_DIR, id, 'evidence');
        const requested = decodeURIComponent(evidenceRoute[2]);
        if (!serveStatic(res, base, requested))
          send(res, 404, { error: 'No such evidence file' });
        return;
      }

      if (route.startsWith('/api/runs/') && req.method === 'GET') {
        // basename() so a crafted id cannot walk out of the runs directory.
        const id = path.basename(route.slice('/api/runs/'.length));
        const file = path.join(RUNS_DIR, `${id}.json`);
        if (!fs.existsSync(file)) {
          send(res, 404, { error: 'No such run' });
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        fs.createReadStream(file).pipe(res);
        return;
      }

      // Evidence links from the results table: the Playwright report, traces,
      // screenshots and the generated execution reports.
      if (route.startsWith('/reports/') && serveStatic(res, path.join(ROOT, 'reports'), route.slice('/reports'.length)))
        return;
      if (route.startsWith('/evidence/') && serveStatic(res, path.join(ROOT, 'test-results-excel'), route.slice('/evidence'.length)))
        return;

      send(res, 404, { error: `No route for ${route}` });
    } catch (error) {
      badRequest(res, error instanceof Error ? error.message : String(error));
    }
  })();
});

/** Does the friendly name point at this machine yet? */
async function hostnameResolves(): Promise<boolean> {
  try {
    const { address } = await dns.lookup(HOSTNAME);
    return address === '127.0.0.1' || address === '::1';
  } catch {
    return false;
  }
}

async function printBanner(port: number): Promise<void> {
  const suffix = port === 80 ? '' : `:${port}`;
  const mapped = await hostnameResolves();

  process.stdout.write(`\n  Moolya Automation Report\n`);
  if (mapped) {
    process.stdout.write(`  http://${HOSTNAME}${suffix}\n`);
  } else {
    process.stdout.write(`  http://127.0.0.1${suffix}\n\n` +
      `  To use http://${HOSTNAME}${suffix} instead, map the name to this machine once.\n` +
      '  Run this in an ADMINISTRATOR PowerShell (editing hosts needs elevation):\n\n' +
      `    Add-Content -Path $env:SystemRoot\\System32\\drivers\\etc\\hosts -Value "127.0.0.1 ${HOSTNAME}"\n\n` +
      '  The name then resolves on this machine only. Nothing is exposed to the network.\n');
  }
  process.stdout.write(`\n  workbooks from ${path.join(ROOT, 'excel')}\n` +
    '  Ctrl+C to stop\n\n');
}

function listen(port: number, onFail: (error: NodeJS.ErrnoException) => void): void {
  const onError = (error: NodeJS.ErrnoException) => {
    server.removeListener('error', onError);
    onFail(error);
  };
  server.once('error', onError);
  server.listen(port, BIND, () => {
    server.removeListener('error', onError);
    void printBanner(port);
  });
}

// Port 80 is the whole point of the friendly URL, but it is also the port most
// likely to be taken (IIS, another dev server) or refused. Neither deserves a
// stack trace when a working fallback exists.
listen(PORT, error => {
  if ((error.code === 'EADDRINUSE' || error.code === 'EACCES') && PORT === 80) {
    process.stderr.write(`\n  Port 80 is unavailable (${error.code}) - falling back to ${FALLBACK_PORT}.\n` +
      '  Free port 80, or set EXCEL_DASHBOARD_PORT to choose another.\n');
    listen(FALLBACK_PORT, fallbackError => {
      process.stderr.write(`\n  Cannot listen on ${FALLBACK_PORT} either (${fallbackError.code}).\n\n`);
      process.exit(1);
    });
    return;
  }
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(`\n  Port ${PORT} is already in use - a dashboard is probably running.\n` +
      '  Stop the other one, or set EXCEL_DASHBOARD_PORT.\n\n');
    process.exit(1);
  }
  throw error;
});
