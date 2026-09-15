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
// `recorderSessionStatus`, aliased. Both this module and `case-status` export a
// `recordingStatus`, and they answer different questions with different signatures:
// the recorder's takes NOTHING and reports whether a codegen session is live, the
// bookkeeper's takes a TestCase and reports whether that row's recording is stale.
// Imported under one name, the second binding won and `GET /api/record` called the
// bookkeeper with `testCase === undefined` - a throw on every poll of the Record
// screen. Verified by bundling this file: only one `recordingStatus` survived, the
// two-argument one.
import { hasPendingRecording, keepArtifactFor, recordingStatus as recorderSessionStatus, startRecording, stopRecording, takeRecordedGenerationContext, toDraft } from './recorder';
import { readState, surveyWork } from '../autocode/work';
import { assessReadiness } from '../excel/readiness';
import { describeRecording, recordingStatus, rememberRecordingFingerprint } from './case-status';
import {
  HISTORY_LIMIT, collectLifecycle, deriveStatus, listGenerations, newGenerationId,
  parseGenerationLog, readGeneration, saveGeneration, type GenerationRecord,
} from './generation-history';
import {
  assertWorkbookInScope, describeProjects, scopeForWorkbook, tryScopeFromSelection,
} from './scope-request';
import {
  provisionProject, type ProvisionRequest, unownedWorkbooks, workbooksFor,
} from '../projects/provision';
import { addApplication, readRegistry, baseUrlFor } from '../projects/registry';
import { saveEnvironment, validBaseUrl } from '../projects/environments';
import { randomUUID } from 'node:crypto';
import { pendingRecordingFor } from './recorder';
import { ownershipReview, createAuthoringPage } from './page-ownership';
import { recordingMappingReview, saveRecordingMapping } from './recording-mapping';
import { createLogicalPage, createPageObject, createAuthoringMethod } from './authoring-catalog';
import { codeGraph, readCode, codeDefinition, saveCode } from './code-workspace';
import { listQuarantine, importLegacyQuarantine, quarantineDetails, quarantineFile, quarantineDefinition, saveQuarantineDraft,
  validateQuarantine, rerunQuarantine, promoteQuarantine, reviewQuarantineMapping, saveQuarantineMapping, rebuildQuarantineDraft, openQuarantineTrace,
  quarantineDependencyDrift, refreshQuarantineDependencies } from './quarantine-workspace';
import { diagnosticRoot, containedFile } from '../diagnostics/artifacts';
import { writeRunReport } from './run-report';
import { createQuarantinePackage, quarantineExecutionContext } from './quarantine-workspace';
import { retainAttempt } from '../diagnostics/runtime';
import { sourceSteps } from '../diagnostics/manifest';
import { classifyExecutionFailure } from '../autocode/verify';
import { codeDependencySources } from './code-workspace';
import { type ApplicationScope, resolveScope, resetActiveScope, ScopeError } from '../projects/scope';
import { buildCache, writeCache } from '../excel/data-driven';
import { readTestData, updateTestData, credentialPreflight } from '../test-data/store';
import { executionPlan, generationSelection, resolveExecutionData, type ExecutionSelection, type ExecutionProfile, type SelectionRequest } from '../test-data/execution';
import { resolveExecutionContext, executionEnvironment, preflightAuthentication, ExecutionConfigurationError, type ExecutionContext, type ExecutionContextInput } from '../projects/execution-context';
import { credentialSecrets } from '../test-data/secrets';
import {  readMapping, runnerFor, scanDataDrivenRunners, upsertEntry, writeMapping } from '../excel/mapping';
import { parseWorkbook } from '../excel/parser';
import { parseResults, type ExecutionRecord } from '../excel/results';
import { readStepLogEntries, type StepRecord } from '../excel/steps';
import type { TestCase } from '../excel/types';

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
const API_VERSION = 11;

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
  executionContext?: ExecutionContextInput;
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

/** One capture of one step, served from this run's own copy. */
interface StepCaptureView {
  captureRef: string;
  captureType: string;
  capturedAt?: string;
  route?: string;
  /** URL under /api/runs/<id>/evidence/steps/... */
  url: string;
}

/** One step of one test case, with its screenshots served from this run's copy. */
interface StepView extends Omit<StepRecord, "screenshotPath" | "captures"> {
  index: number;
  title: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
  /**
   * Every picture this step holds, each addressed by its OWN url.
   *
   * The single `screenshotUrl` below is the older model and is kept for runs recorded
   * under it. It could only ever describe one picture per step, and it was populated
   * only where the legacy capture mode asked for one - which is why a passing run, whose
   * steps were photographed all along, arrived at the screen with nothing to show.
   */
  captures?: StepCaptureView[];
  /** URL under /api/runs/<id>/evidence/steps/... , when a screenshot was taken. */
  screenshotUrl?: string;
}

interface RunRecord {
  executionContext?: ExecutionContext;
  executionSelection?: ExecutionSelection;
  executionProfile?: ExecutionProfile;
  status?: 'queued' | 'running' | 'completed' | 'cancelled';
  parentExecutionId?: string;
  environmentDisplayName?: string;
  environmentRuns?: RunRecord[];
  sourceEnvironmentId?: string;
  /**
   * EXECUTION IDENTITY = applicationId + testCaseId + runId.
   *
   * `id` is the runId and is unique per execution; `applicationId` says whose
   * execution it was. The store stays physically GLOBAL - `ai/dashboard/runs/` is one
   * directory of past executions on this machine, which is the question it answers -
   * but a global store needs every record to carry its own identity, or two projects'
   * TC_LOGIN_001 appear as two indistinguishable rows and the dashboard cannot filter
   * them apart.
   *
   * The application is NOT recoverable from `request.workbook` after the fact and must
   * not be re-derived from it: a workbook can be renamed or reassigned, and a record is
   * a statement about what happened, not a lookup to redo later. Optional so records
   * written before this read as unknown rather than as belonging to anybody.
   */
  applicationId?: string;
  /** Which environment it ran against. Configuration, recorded as evidence. */
  environmentId?: string;
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

/** One parent owns the existing serialized scratch output until every child finishes. */
let executionBatch: { record: RunRecord; clients: Set<http.ServerResponse>; log: string[];
  cancelled: boolean; queue: Array<{ scope: ApplicationScope; registry: string; record: RunRecord }> } | null = null;

/**
 * The code generator, spawned after a save or an upload.
 *
 * Held separately from `active` because it is not a test run and must not make
 * the Run button think one is in progress - but it does verify its work by
 * running Playwright, so the two still cannot overlap.
 */
let autocode: {
  executionContext:ExecutionContext;
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
function startAutocode(workbookPath: string, ids: string[], scope = scopeForWorkbook(path.relative(ROOT,workbookPath)), input:ExecutionContextInput = {}, executionData?:SelectionRequest): { started: boolean; reason?: string; executionContext?:ExecutionContext; executionProfile?:ExecutionProfile } {
  if (active || executionBatch)
    return { started: false, reason: 'a test run is in progress' };
  if (autocode)
    return { started: false, reason: 'the generator is already running' };
  // executionPlan resolves the profile and credentialPreflight proves it can serve THIS
  // target environment - exists, active, owned by this application, username present,
  // password decryptable. Both throw CREDENTIAL_CONFIGURATION_FAILURE. Nothing here
  // substitutes another profile or falls back to the application binding: a person named an
  // account, and quietly generating under a different one is a worse answer than refusing.
  const planned=executionData ? executionPlan(scope,ids,executionData) : [];
  if(planned.length>1)throw Error('Choose one execution profile and test case for generation verification. Use Run for multiple execution instances.');
  const selection=planned[0]?.selection;
  const context=resolveExecutionContext(scope,input,selection);

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
    env: { ...process.env, ...executionEnvironment(context,selection), FORCE_COLOR: '0' },
  });

  const log: string[] = [`execution context: ${JSON.stringify(context)}\n`];
  autocode = {
    executionContext:context,
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

  // The profile, so the page can SHOW what this generation is running as. Names and IDs
  // only - ExecutionProfile has no field for an account or a password.
  return { started: true, executionContext:context, ...(planned[0] ? { executionProfile: planned[0].profile } : {}) };
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
      executionContext:run.executionContext,
      id: newGenerationId(),
      runId: parsed.runId,
      workbook: run.workbook,
      // The workbook's DECLARED owner, so a global history can still tell two
      // projects' TC_LOGIN_001 apart. Never thrown from - a missing registry costs
      // the label, not the record.
      applicationId: (() => {
        try {
          return scopeForWorkbook(run.workbook).applicationId;
        } catch {
          return undefined;
        }
      })(),
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
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Error('Invalid JSON request body. Submitted values were not retained.'); }
}

/** Resolve a client-supplied workbook path, refusing anything outside the repo. */
/**
 * The workbook a request names, checked for SHAPE but not for existence.
 *
 * Split out so ownership can be decided before the filesystem is consulted. Which
 * project a workbook belongs to is a fact about the registry, and answering "that file
 * is not here" first turns a cross-project request into a missing-file message - which
 * sends somebody looking for a file rather than telling them they picked the wrong
 * project. The traversal and extension guards stay first, because they are about what
 * the string is allowed to be at all.
 */
function workbookPathOf(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : 'excel/login-test-cases.xlsx';
  const absolute = path.resolve(ROOT, raw);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Workbook must live inside the repository');
  if (!/\.xlsx$/i.test(absolute))
    throw new Error('Workbook must be an .xlsx file');
  return absolute;
}

function resolveWorkbook(value: unknown): string {
  const absolute = workbookPathOf(value);
  if (!fs.existsSync(absolute))
    throw new Error(`No workbook at ${path.relative(ROOT, absolute)}`);
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

/**
 * Everything the UI needs to render the picker for one workbook.
 *
 * `scope` is the workbook's OWN application, resolved by the caller. It used to read
 * the mapping and the recording status through the process-wide ambient scope, which
 * in a long-lived server asks "which application is this process in" when the question
 * is "which application is this workbook's". With two projects registered the answer
 * would have come from whichever one the process happened to be pointed at.
 */
async function describeWorkbook(workbookPath: string, scope: ApplicationScope) {
  const parsed = await parseWorkbook(workbookPath);
  const mapping = readMapping(scope.paths.mappingFile);
  const cache = buildCache(parsed, new Date().toISOString());
  const runners = scanDataDrivenRunners(SPEC_DIR, scope);

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
        const recording = recordingStatus(testCase, scope.paths.recordingsDir);
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
        const status = recordingStatus(testCase, scope.paths.recordingsDir);
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
async function activate(workbookPath: string, testCaseId: string, scope: ApplicationScope): Promise<{
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

  const runners = scanDataDrivenRunners(SPEC_DIR, scope);
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
    const mapping = readMapping(scope.paths.mappingFile);
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
    writeMapping(mapping, scope.paths.mappingFile);
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
  const mapping = readMapping(scope.paths.mappingFile);
  const wantedId = saved?.testCaseId ?? testCaseId;
  const survey = surveyWork(parsed, mapping, readState(), new Set([wantedId.toUpperCase()]), scope);
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

/**
 * The typed code behind a refused configuration, whoever raised it.
 *
 * `ExecutionConfigurationError` carries its code as a field; the Test Data layer raises the
 * same vocabulary as a plain Error whose message BEGINS with the code, because it is read by
 * the CLI and the gates as text. Reading only the first shape reported a refused credential
 * profile as the generic GENERATION_NOT_STARTED, which tells a person nothing about what to
 * fix - and is exactly the case section 8 asks to be named.
 */
function configurationFailureCode(error: unknown): string | undefined {
  if (error instanceof ExecutionConfigurationError)
    return error.code;
  const message = error instanceof Error ? error.message : String(error);
  const named = /^(CREDENTIAL|DATA|SOURCE_ENVIRONMENT|BROWSER|EXECUTION)_CONFIGURATION_FAILURE\b/.exec(message);
  return named?.[0];
}
function executionInput(body:any):ExecutionContextInput {
  const input:ExecutionContextInput={...(body.executionContext??{})};
  for(const key of ['applicationId','environmentId','sourceEnvironmentId','browserEngine','browserChannel','headed','locatorTimeoutMs'] as const)
    if(body[key]!==undefined)(input as any)[key]=body[key];
  if(input.browserEngine===undefined&&body.browser!==undefined)input.browserEngine=body.browser;
  return input;
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

  const browser = String(executionInput(input).browserEngine ?? 'chromium') as Browser;
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
    executionContext:executionInput(input),
    testCaseIds: ids,
    browser,
    workers,
    headed: executionInput(input).headed === true,
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
function collectSteps(runId: string, scope: ApplicationScope): Record<string, StepView[]> {
  const views: Record<string, StepView[]> = {};
  for (const log of readStepLogEntries()) {
    if (log.applicationId !== scope.applicationId || log.environmentId !== scope.environmentId || log.runId !== runId) continue;
    for (const step of log.steps) {
      if (!step.stepId || !step.attemptId || step.runId !== runId || step.environmentId !== scope.environmentId || step.applicationId !== scope.applicationId) continue;
      const { screenshotPath, captures, ...rest } = step;
      const view: StepView = rest as StepView;
      (views[log.testCaseId] ||= []).push(view);
      const safeIdentity = /^[A-Za-z0-9_-]+$/.test(log.testCaseId) && /^[a-z0-9-]+$/i.test(step.attemptId) && /^[a-z0-9-]+$/i.test(step.stepId);
      // EVERY capture this step took, each copied under ITS OWN reference.
      //
      // Playwright rewrites its output directory on the next run, so a step's pictures
      // only survive because they are copied here; and they are keyed by captureRef, so
      // a step's second picture can never overwrite its first, and no step can ever be
      // served another step's. A capture whose file has gone is dropped rather than
      // linked to nothing.
      if (safeIdentity) for (const capture of captures ?? []) {
        if (!capture?.artifact || !/^[a-zA-Z0-9][\w./-]*\.png$/.test(capture.artifact) || capture.artifact.includes('..')) continue;
        if (!/^[a-z0-9-]+$/i.test(capture.captureRef)) continue;
        const source = path.join(ROOT,'test-results-excel',capture.artifact);
        if (!fs.existsSync(source)) continue;
        try {
          const relativeFile = `steps/${log.testCaseId}/${step.attemptId}/${step.stepId}/${capture.captureRef}.png`;
          const destination = path.join(RUNS_DIR,runId,'evidence',relativeFile);
          fs.mkdirSync(path.dirname(destination),{recursive:true}); fs.copyFileSync(source,destination);
          (view.captures ||= []).push({ captureRef: capture.captureRef, captureType: capture.captureType,
            capturedAt: capture.capturedAt, route: capture.route,
            url: `/api/runs/${runId}/evidence/${relativeFile}` });
        } catch { /* The recorded step survives an unavailable picture. */ }
      }
      if (!screenshotPath || !fs.existsSync(screenshotPath)) continue;
      const relative = path.relative(path.join(ROOT,'test-results-excel'),fs.realpathSync(screenshotPath));
      if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
      if (!safeIdentity) continue;
      try {
        const relativeFile = `steps/${log.testCaseId}/${step.attemptId}/${step.stepId}.png`;
        const destination = path.join(RUNS_DIR,runId,'evidence',relativeFile);
        fs.mkdirSync(path.dirname(destination),{recursive:true}); fs.copyFileSync(screenshotPath,destination);
        view.screenshotUrl = `/api/runs/${runId}/evidence/${relativeFile}`;
      } catch { /* The recorded step survives an unavailable screenshot. */ }
    }
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
  if (!active && !executionBatch)
    return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of executionBatch?.clients || active!.clients)
    client.write(payload);
}

function saveRun(record: RunRecord, log: string[]): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNS_DIR, `${record.id}.json`),
      `${JSON.stringify({ ...record, log }, null, 2)}\n`, 'utf8');
}

function startRun(workbookPath: string, request: RunRequest, scope: ApplicationScope,
    prepared?: RunRecord, registrySnapshot?: string, completed?: (record: RunRecord, log: string[]) => void): RunRecord {
  const id = prepared?.id || new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0,8);
  const record: RunRecord = prepared || {
    // Stamped from the scope the ROUTE resolved, never looked up again here - the
    // route already refused the request if no project was chosen.
    applicationId: scope.applicationId,
    environmentId: scope.environmentId,
    id,
    startedAt: new Date().toISOString(),
    request: { ...request, workbook: path.relative(ROOT, workbookPath).replace(/\\/g, '/') },
    results: [],
    evidence: [],
    steps: {},
    summary: { passed: 0, failed: 0, skipped: 0, flaky: 0 },
  };

  const context=resolveExecutionContext(scope,record.executionContext ?? request.executionContext ?? {},record.executionSelection);
  for(const id of request.testCaseIds){const file=readMapping(scope.paths.mappingFile)[id]?.testFile;
    preflightAuthentication(scope,record.executionSelection,Boolean(file && fs.existsSync(path.resolve(file)) && /\bappCredentials\b/.test(fs.readFileSync(path.resolve(file),'utf8'))));}
  record.executionContext=context;record.sourceEnvironmentId=context.sourceEnvironmentId;
  record.status = 'running'; record.startedAt = new Date().toISOString();
  const registry = registrySnapshot || JSON.stringify(readRegistry());
  const contextFile = path.join(RUNS_DIR,id,'context.registry.json');
  fs.mkdirSync(path.dirname(contextFile),{recursive:true}); fs.writeFileSync(contextFile,registry);
  saveRun(record,[]);

  if(record.executionSelection) resolveExecutionData(scope,record.executionSelection);
  const secrets = [...credentialSecrets(), ...Object.values(scope.credentials || {}).map(name => process.env[name!]).filter((value): value is string => Boolean(value))];
  const redact = (text: string) => secrets.reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), text);
  const selectedCase=record.executionSelection?.testCaseId;
  const profileEntry=selectedCase?readMapping(scope.paths.mappingFile)[selectedCase]:undefined;
  const profileSpec=profileEntry?.testFile;
  const profileSource=profileSpec&&fs.existsSync(path.resolve(ROOT,profileSpec))?fs.readFileSync(path.resolve(ROOT,profileSpec),'utf8'):undefined;
  let profileDependencies:Record<string,string>={};
  if(profileSource&&profileSpec){for(const [file,text]of codeDependencySources(scope,selectedCase!,new Map([[path.resolve(ROOT,profileSpec),profileSource]])))profileDependencies[path.relative(ROOT,file).replace(/\\/g,'/')]=text;}
  const childEnvironment = {...process.env};
  const allowedReferences = new Set(Object.values(scope.credentials || {}));
  for (const app of readRegistry().applications) for (const environment of Object.values(app.environments))
    for (const name of Object.values(environment.credentials || {})) if(name && !allowedReferences.has(name)) delete childEnvironment[name];

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
      ...childEnvironment,
      // Only unlock the extra projects when one is actually requested, so the
      // default single-project behaviour is untouched.
      ...(request.browser === 'chromium' ? {} : { EXCEL_ALL_BROWSERS: '1' }),
      ...executionEnvironment(context,record.executionSelection),
      AURA_RUN_ID: id,
      AURA_REGISTRY_FILE: contextFile,
      EXCEL_WORKERS: String(request.workers),
      EXCEL_SCREENSHOT: request.screenshot,
      EXCEL_VIDEO: request.video,
      EXCEL_TRACE: request.trace,
      FORCE_COLOR: '0',
      AURA_EXECUTION_SELECTION: record.executionSelection ? JSON.stringify(record.executionSelection) : '',
      // A SELECTION RUN IS THE DIAGNOSTIC ONE, so its step evidence is turned ON, not off.
      //
      // Native Playwright screenshots, video and trace stay off here and that is a
      // credential decision, not a cost one: they are unmasked and cannot cross the
      // retention boundary. The framework's own captures are masked at source and can, so
      // they are the evidence channel for these runs - and forcing them off was why a
      // step-by-step report of a selection run could never show anything.
      ...(record.executionSelection ? { AURA_DIAGNOSTICS:'1', EXCEL_SCREENSHOT:'on', EXCEL_VIDEO:'off', EXCEL_TRACE:'off' } : {}),
    },
  });

  // Remember how old the results file is BEFORE the run. If a run dies without
  // producing one, an unchanged file still holds the previous run's outcome -
  // and reporting that as this run's result is the worst failure this dashboard
  // could have: it turns a crashed run into a confident green table.
  const resultsBefore = fs.existsSync(RESULTS_JSON) ? fs.statSync(RESULTS_JSON).mtimeMs : 0;

  const log: string[] = [];
  active = { record, child, log, clients: new Set() };

  let pendingLog = '';
  const emitLog = (text: string) => { const safe = redact(text); log.push(safe); broadcast('log',{text:safe}); };
  const onChunk = (chunk: Buffer) => {
    pendingLog += chunk.toString('utf8');
    const end = pendingLog.lastIndexOf('\n');
    if(end >= 0) { emitLog(pendingLog.slice(0,end+1)); pendingLog = pendingLog.slice(end+1); }
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);

  child.on('close', exitCode => {
    if(pendingLog) emitLog(pendingLog);
    record.finishedAt = new Date().toISOString();
    record.status = 'completed';
    record.exitCode = exitCode;
    // Read the per-case outcome from the run Playwright just wrote. This is the
    // same file the execution report is built from, so the dashboard and the
    // spreadsheet can never disagree about what happened.
    const resultsAfter = fs.existsSync(RESULTS_JSON) ? fs.statSync(RESULTS_JSON).mtimeMs : 0;
    if (resultsAfter && resultsAfter !== resultsBefore) {
      try {
        record.results = parseResults(RESULTS_JSON).map(result => ({...result, applicationId:scope.applicationId, environmentId:scope.environmentId,sourceEnvironmentId:context.sourceEnvironmentId,executionContext:context, runId:id,executionProfile:record.executionProfile}));
        record.evidence = collectEvidence(record.id);
        // globalSetup clears the step directory at the start of every run, so
        // whatever is there now belongs to this run and nothing earlier.
        record.steps = collectSteps(record.id,scope);
        // Playwright's copy is retained exactly as before, for the runs that had it.
        if (!record.executionSelection) keepPlaywrightReport(record.id);
        // And the run's OWN report is written for every completed run, including the
        // selection-driven ones that previously produced no artifact at all - which is
        // why the download control had nothing to offer and correctly hid itself.
        record.hasReport = writeRunReport(path.join(RUNS_DIR, record.id), {
          id: record.id, applicationId: scope.applicationId, environmentId: scope.environmentId,
          environmentDisplayName: record.environmentDisplayName, startedAt: record.startedAt,
          finishedAt: record.finishedAt, status: record.status, exitCode: record.exitCode,
          // A NAME. The profile's values are never read here and never reach the report.
          executionProfileName: record.executionProfile?.credentialProfileName,
          sourceEnvironmentId: context.sourceEnvironmentId,
          results: record.results as any, steps: record.steps as any,
        });
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
    for (const result of record.results) {
      result.testName=redact(result.testName);result.failureReason=redact(result.failureReason);result.rootCause=redact(result.rootCause);
      for (const attempt of result.attempts || []) if(attempt.error) attempt.error=redact(attempt.error);
    }
    for (const step of Object.values(record.steps).flat()) {step.title=redact(step.title);if(step.error)step.error=redact(step.error);}
    record.summary = summarise(record.results);
    if(record.executionSelection&&profileSource&&profileSpec){
      try{
        const scratch=path.dirname(RESULTS_JSON);
        fs.writeFileSync(path.join(scratch,'generated-steps.json'),JSON.stringify({steps:sourceSteps(path.resolve(ROOT,profileSpec),profileSource)}));
        fs.writeFileSync(path.join(scratch,'executed-dependencies.json'),JSON.stringify({files:profileDependencies}));
        const stepDirectory=path.join(scratch,'steps');fs.mkdirSync(stepDirectory,{recursive:true});
        for(const [i,entry]of readStepLogEntries().filter(log=>log.applicationId===scope.applicationId&&log.runId===id).entries())fs.writeFileSync(path.join(stepDirectory,String(i)+'.json'),JSON.stringify(entry));
        const diagnostics=retainAttempt(scope,scratch,path.resolve(ROOT,profileSpec),selectedCase!,'clean',log.join(''),' ',id,profileSource,context);
        const manifestFile=containedFile(diagnosticRoot(scope),diagnostics+'/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));manifest.executionProfile=record.executionProfile;fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
        for(const result of record.results){result.diagnostics=diagnostics;if(result.executionStatus==='Failed')result.quarantinePackageId=createQuarantinePackage(scope,path.resolve(ROOT,profileSpec),selectedCase!,{verdict:'quarantined',reason:result.failureReason,detail:{phase:'execution',code:classifyExecutionFailure(result.failureReason),cleanStatus:'Failed',playwrightMessage:result.failureReason,diagnostics,staticProblems:[],mutationsApplied:[]}},{executionContext:context,sourceEnvironmentId:record.sourceEnvironmentId,scenario:profileEntry?.scenario||result.testName.replace(selectedCase!+' - ',''),module:profileEntry?.module,sourceWorksheet:profileEntry?.sourceWorksheet,runId:id,workbook:path.relative(ROOT,workbookPath).replace(/\\/g,'/'),executionProfile:record.executionProfile,executionSelection:record.executionSelection});}
      }catch(error){record.note='Execution result retained; diagnostic packaging failed: '+redact((error as Error).message);}
    }
    saveRun(record, log);
    if (completed) { active = null; completed(record,log); }
    else { broadcast('done', record); for (const client of active?.clients ?? []) client.end(); active = null; }
  });

  return record;
}

function startEnvironmentExecution(workbookPath: string, request: RunRequest, source: ApplicationScope, ids: unknown, selectionRequest?:SelectionRequest,caseTags:Record<string,string[]>={}): RunRecord {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length)
    throw Error('Select one or more distinct configured execution environments');
  if (request.workers !== 1) throw Error('Environment execution uses one worker to preserve independent artifact ownership');
  if (request.inPlace && ids.length > 1) throw Error('Multi-environment results are retained per run. Disable workbook write-back to avoid overwriting one environment with another.');
  const registry = readRegistry();
  const application = registry.applications.find(a => a.applicationId === source.applicationId)!;
  const frozen = structuredClone(application);
  for (const [id, environment] of Object.entries(frozen.environments)) {
    environment.baseUrl = validBaseUrl(baseUrlFor(application,id)); delete environment.baseUrlEnv;
  }
  const snapshot = {schemaVersion:1 as const, applications:[frozen]};
  const scopes = ids.map(environmentId => {
    if (!Object.hasOwn(frozen.environments,environmentId)) throw Error(`Environment "${environmentId}" is not configured for this project`);
    const scope = resolveScope({applicationId:source.applicationId,environmentId},snapshot);
    const refs = scope.credentials;
    if (!selectionRequest && refs && (!refs.email || !refs.password || !process.env[refs.email] || !process.env[refs.password]))
      throw Error(`Environment "${environmentId}" is missing its declared credential variables. Configure them before execution.`);
    return scope;
  });
  const id = new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
  const make = (runId: string): RunRecord => ({id:runId,applicationId:source.applicationId,
    startedAt:new Date().toISOString(),status:'queued',request:{...request,workbook:path.relative(ROOT,workbookPath).replace(/\\/g,'/')},results:[],evidence:[],steps:{},summary:{passed:0,failed:0,skipped:0,flaky:0}});
  const parent = make(id); parent.environmentRuns = scopes.map(scope => ({...make(id+'-'+scope.environmentId),parentExecutionId:id,
    environmentId:scope.environmentId,environmentDisplayName:frozen.environments[scope.environmentId].displayName || scope.environmentId}));
  if(selectionRequest){
    if(request.inPlace)throw Error('Execution profile results are retained per instance. Disable workbook write-back.');
    parent.environmentRuns=scopes.flatMap(scope=>executionPlan(scope,request.testCaseIds,selectionRequest,caseTags).map((entry,i)=>({...make(id+'-'+scope.environmentId+'-'+(i+1)),parentExecutionId:id,
      environmentId:scope.environmentId,environmentDisplayName:frozen.environments[scope.environmentId].displayName||scope.environmentId,executionSelection:entry.selection,executionProfile:entry.profile,
      request:{...parent.request,testCaseIds:[entry.profile.testCaseId],inPlace:false}})));
    if(parent.environmentRuns.length>100)throw Error('Select at most 100 execution instances.');
  }
  // Validate EVERY instance before launching the first, without coupling credentials to source.
  for(const record of parent.environmentRuns!){const scope=scopes.find(scope=>scope.environmentId===record.environmentId)!;
    record.executionContext=resolveExecutionContext(scope,{...request.executionContext,environmentId:scope.environmentId},record.executionSelection,snapshot);
    record.sourceEnvironmentId=record.executionContext.sourceEnvironmentId;
    for(const id of record.request.testCaseIds){const file=readMapping(scope.paths.mappingFile)[id]?.testFile;
      preflightAuthentication(scope,record.executionSelection,Boolean(file&&fs.existsSync(path.resolve(file))&&/\bappCredentials\b/.test(fs.readFileSync(path.resolve(file),'utf8'))));}}
  executionBatch = {record:parent,clients:new Set(),log:[],cancelled:false,queue:scopes.map((scope,i)=>({scope,registry:JSON.stringify(snapshot),record:parent.environmentRuns![i]}))};
  if(selectionRequest)executionBatch.queue=parent.environmentRuns!.map(record=>({scope:scopes.find(s=>s.environmentId===record.environmentId)!,registry:JSON.stringify(snapshot),record}));
  const batch = executionBatch;
  const advance = () => {
    if (batch.cancelled) for (const entry of batch.queue) { entry.record.status='cancelled';entry.record.finishedAt=new Date().toISOString();entry.record.note='Cancelled before execution';saveRun(entry.record,[]); }
    const next = batch.cancelled ? undefined : batch.queue.shift();
    parent.results = parent.environmentRuns!.flatMap(r=>r.results);
    parent.summary = summarise(parent.results);
    if (!next) {
      parent.finishedAt=new Date().toISOString();parent.status=batch.cancelled?'cancelled':'completed';
      parent.exitCode=batch.cancelled||parent.environmentRuns!.some(r=>r.exitCode!==0)?1:0;
      saveRun(parent,batch.log);broadcast('done',parent);for(const client of batch.clients)client.end();executionBatch=null;return;
    }
    parent.status='running';
    startRun(workbookPath,next.record.request,next.scope,next.record,next.registry,(record,log)=>{
      batch.log.push(`\n[${record.environmentId}]\n`,...log);saveRun(parent,batch.log);broadcast('environment',parent);advance();
    });
    saveRun(parent,batch.log);broadcast('environment',parent);
  };
  saveRun(parent,[]);advance();return parent;
}

/** Identity comes from the saved record. A foreign project/environment never acquires it. */
function requestedRun(id: string, url: URL): RunRecord | null {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const file = path.join(RUNS_DIR,id+'.json'); if(!fs.existsSync(file))return null;
  const record = JSON.parse(fs.readFileSync(file,'utf8')) as RunRecord;
  const applicationId=url.searchParams.get('applicationId');
  if (!applicationId || record.applicationId!==applicationId) return null;
  const environmentId=url.searchParams.get('environmentId');
  if(environmentId && record.environmentId!==environmentId)return null;
  return record;
}

/**
 * Past executions, newest first, optionally narrowed to one application.
 *
 * The store stays GLOBAL - it answers "what has run on this machine" - so the
 * narrowing happens HERE, on the record's own `applicationId`. Never on the workbook,
 * the URL or the Test Case ID: two projects' TC_LOGIN_001 are two different executions
 * and only the recorded application separates them.
 *
 * A record written before the field existed has no application, so it cannot be
 * claimed by either project and is shown only in the unfiltered list. Attributing it
 * to whichever project is asking would be inventing history.
 */
function listRuns(applicationId?: string): Array<Pick<RunRecord,
  'id' | 'startedAt' | 'finishedAt' | 'exitCode' | 'summary' | 'applicationId'> & { count: number }> {
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
          applicationId: record.applicationId,
          environmentId: record.environmentId,
          environmentRuns: record.environmentRuns?.map(r=>({id:r.id,environmentId:r.environmentId,status:r.status,summary:r.summary})),
          parentExecutionId: record.parentExecutionId,
          status: record.status,
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
      })
      .filter(summary => !summary.parentExecutionId && (!applicationId || summary.applicationId === applicationId));
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

      if (['/test-data.js','/test-data.css','/authoring-workspace.js', '/authoring-workspace.css', '/recording-review.js','/diagnostic-viewer.js','/quarantine-workspace.js','/quarantine-workspace.css'].includes(route) && req.method === 'GET') {
        serveStatic(res, PUBLIC_DIR, route); return;
      }
      if(route.startsWith('/api/test-data')){
        if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw Error('Test Data changes must originate from this dashboard.');
        const body:any=req.method==='POST'?await readJsonBody(req):Object.fromEntries(url.searchParams);
        if(typeof body.applicationId!=='string'||!body.applicationId)throw Error('Select an application first.');
        const scope=resolveScope({applicationId:body.applicationId,environmentId:body.environmentId});
        res.setHeader('Cache-Control','no-store');
        if(route==='/api/test-data'&&req.method==='GET'){send(res,200,readTestData(scope));return;}
        if(route==='/api/test-data/save'&&req.method==='POST'){
          if(active||executionBatch||autocode)throw Error('Wait for execution/generation to finish before changing Test Data.');
          if(body.change?.kind==='examples'){
            const candidate=workbookPathOf(body.workbook);assertWorkbookInScope(scope,path.relative(ROOT,candidate));
            const parsed=await parseWorkbook(resolveWorkbook(body.workbook));if(!parsed.testCases.some(c=>c.testCaseId===body.change.testCaseId))throw Error('Test case is not in the selected application workbook.');
          }
          send(res,200,updateTestData(scope,body.expectedVersion,body.change));return;
        }
        if(route==='/api/test-data/preflight'&&req.method==='POST'){send(res,200,credentialPreflight(scope,String(body.credentialProfileId)));return;}
        if(route==='/api/test-data/preview'&&req.method==='POST'){
          const candidate=workbookPathOf(body.workbook);assertWorkbookInScope(scope,path.relative(ROOT,candidate));const parsed=await parseWorkbook(resolveWorkbook(body.workbook));
          if(!Array.isArray(body.testCaseIds)||!body.testCaseIds.length||body.testCaseIds.some(id=>!parsed.testCases.some(c=>c.testCaseId===id)))throw Error('Select test cases from this application workbook.');
          const selectedEnvs=body.environmentIds??[scope.environmentId];if(!Array.isArray(selectedEnvs)||!selectedEnvs.length)throw Error('Select an environment.');
          const instances=selectedEnvs.flatMap(environmentId=>executionPlan(resolveScope({applicationId:scope.applicationId,environmentId}),body.testCaseIds,body.selection,Object.fromEntries(parsed.testCases.map(c=>[c.testCaseId,c.tags]))));
          if(instances.length>100)throw Error('Select at most 100 execution instances.');send(res,200,{count:instances.length,instances:instances.map(({profile,preflight})=>({profile,preflight}))});return;
        }
        throw Error('Unsupported Test Data operation.');
      }
      if(route.startsWith('/api/quarantine/')||route==='/api/diagnostics/artifact') {
        if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw Error('Quarantine changes must originate from this dashboard.');
        const body:any=req.method==='POST'?await readJsonBody(req):Object.fromEntries(url.searchParams);
        if(typeof body.applicationId!=='string'||!body.applicationId)throw Error('Select an application first.');
        const scope=resolveScope({applicationId:body.applicationId,environmentId:body.environmentId}),id=String(body.packageId??'');
        if(route==='/api/diagnostics/artifact'&&req.method==='GET') {
          const file=containedFile(diagnosticRoot(scope),String(body.artifact??'')),extension=path.extname(file);
          const types:Record<string,string>={'.png':'image/png','.json':'application/json','.txt':'text/plain; charset=utf-8','.zip':'application/zip'};
          if(!types[extension]||!fs.statSync(file).isFile())throw Error('Unsupported diagnostic artifact.');
          res.writeHead(200,{'Content-Type':types[extension],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(extension==='.zip'?{'Content-Disposition':'attachment; filename="sanitized-trace.zip"'}:{})});fs.createReadStream(file).pipe(res);return;
        }
        if(route==='/api/quarantine/list'&&req.method==='GET'){send(res,200,{cases:listQuarantine(scope)});return;}
        if(route==='/api/quarantine/details'&&req.method==='GET'){send(res,200,quarantineDetails(scope,id,body.runId));return;}
        if(route==='/api/quarantine/file'&&req.method==='GET'){send(res,200,quarantineFile(scope,id,String(body.file),body.original==='true',body.revisionId));return;}
        if(route==='/api/quarantine/definition'&&req.method==='GET'){send(res,200,{target:quarantineDefinition(scope,id,String(body.file),Number(body.position),body.version,body.revisionId)});return;}
        if(route==='/api/quarantine/mapping'&&req.method==='GET'){send(res,200,reviewQuarantineMapping(scope,id));return;}
        if(route==='/api/quarantine/dependencies'&&req.method==='GET'){send(res,200,quarantineDependencyDrift(scope,id));return;}
        if(req.method!=='POST')throw Error('Unsupported quarantine operation.');
        if(active||autocode||recorderSessionStatus().recording)throw Error('Wait for recording, generation or execution to finish.');
        if(route==='/api/quarantine/import'){send(res,200,{packageId:importLegacyQuarantine(scope,String(body.testCaseId))});return;}
        if(route==='/api/quarantine/save'){const result=saveQuarantineDraft(scope,id,String(body.file),String(body.version),body.content,String(body.revisionId));send(res,result.accepted?200:422,result);return;}
        if(route==='/api/quarantine/validate'){const result=validateQuarantine(scope,id);send(res,result.accepted?200:422,result);return;}
        if(route==='/api/quarantine/context'){const preview=quarantineExecutionContext(scope,id,body.executionData,executionInput(body));send(res,200,{executionContext:preview.context,executionProfile:preview.selected?.profile,
          sourceEnvironmentProvenance:preview.sourceEnvironmentProvenance,legacyExecutionContext:preview.legacyExecutionContext,
          historicalSourceEnvironmentId:preview.historicalSourceEnvironmentId,carriedFromRunId:preview.carriedFromRunId});return;}
        if(route==='/api/quarantine/rerun'){send(res,200,await rerunQuarantine(scope,id,String(body.workbook),body.executionData,executionInput(body),body.executionBasis));return;}
        if(route==='/api/quarantine/refresh-dependencies'){send(res,200,refreshQuarantineDependencies(scope,id,String(body.revisionId)));return;}
        if(route==='/api/quarantine/promote'){send(res,200,promoteQuarantine(scope,id));return;}
        if(route==='/api/quarantine/trace'){send(res,200,await openQuarantineTrace(scope,id,body.runId));return;}
        if(route==='/api/quarantine/mapping/save-mapping'){send(res,200,saveQuarantineMapping(scope,id,body));return;}
        if(route==='/api/quarantine/rebuild'){const result=await rebuildQuarantineDraft(scope,id,String(body.workbook));send(res,result.accepted?200:422,result);return;}
        throw Error('Unsupported quarantine operation.');
      }
      if (route.startsWith('/api/workspace/') || route.startsWith('/api/record/ownership')) {
        if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
          throw Error('Workspace changes must originate from this dashboard.');
        const body: any = req.method === 'POST' ? await readJsonBody(req) : Object.fromEntries(url.searchParams);
        if (typeof body.applicationId !== 'string' || !body.applicationId) throw Error('Select an application first.');
        const scope = resolveScope({ applicationId: body.applicationId, environmentId: body.environmentId });
        if (route.startsWith('/api/record/ownership')) {
          const draft = pendingRecordingFor(scope);
          if (route === '/api/record/ownership' && req.method === 'GET') {
            send(res, 200, recordingMappingReview(scope, draft)); return;
          }
          if (route === '/api/record/ownership/save-mapping' && req.method === 'POST') {
            if (active || autocode || recorderSessionStatus().recording) throw Error('Wait for recording, generation or execution to finish before saving a mapping.');
            send(res, 200, saveRecordingMapping(scope, draft, body)); return;
          }
          const current = ownershipReview(scope, draft.recording, draft.ownerOverrides, draft.authoringPages);
          if (req.method === 'POST') {
            if (body.revision !== current.revision) throw Error('The recording changed. Reload its ownership review.');
            if (route === '/api/record/ownership/logical-page') {
              createLogicalPage(scope, body.page ?? {});
            } else if (route === '/api/record/ownership/page-object') {
              createPageObject(scope, String(body.pageName ?? ''), String(body.className ?? ''));
            } else if (route === '/api/record/ownership/method') {
              createAuthoringMethod(scope, String(body.className ?? ''), String(body.method ?? ''), String(body.locator ?? ''));
            } else if (route === '/api/record/ownership/page') {
              const page = createAuthoringPage(scope, draft.recording, body.page ?? {}, draft.authoringPages ?? []);
              draft.authoringPages = [...(draft.authoringPages ?? []), page];
            } else {
              if (!body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)
                  || Object.values(body.overrides).some(value => typeof value !== 'string' && (!value || typeof value !== 'object'))) throw Error('Invalid owner selections.');
              ownershipReview(scope, draft.recording, body.overrides, draft.authoringPages);
              draft.ownerOverrides = body.overrides;
            }
          }
          send(res, 200, ownershipReview(scope, draft.recording, draft.ownerOverrides, draft.authoringPages)); return;
        }
        const id = String(body.testCaseId ?? '');
        if (route === '/api/workspace/graph' && req.method === 'GET') { send(res, 200, codeGraph(scope, id)); return; }
        if (route === '/api/workspace/file' && req.method === 'GET') { send(res, 200, readCode(scope, id, String(body.file))); return; }
        if (route === '/api/workspace/definition' && req.method === 'GET') { send(res, 200, { target: codeDefinition(scope, id, String(body.file), Number(body.position), body.version) }); return; }
        if (route === '/api/workspace/save' && req.method === 'POST') {
          if (active || autocode || recorderSessionStatus().recording) throw Error('Wait for recording, generation or execution to finish before saving code.');
          const result = saveCode(scope, id, String(body.file), String(body.version), body.content);
          send(res, result.accepted ? 200 : 422, result); return;
        }
        throw Error('Unsupported workspace operation.');
      }


      // ---- Projects. The FIRST choice in every application-specific flow.
      //
      // The page shows `displayName` and sends `applicationId`, and those are two
      // different things on purpose: "Bugasura" is what a person reads and `bugasura`
      // is what every path, key and namespace is built from. A UI that posted the
      // display name would make renaming a project silently orphan its artefacts.
      if (route === '/api/projects' && req.method === 'GET') {
        send(res, 200, describeProjects());
        return;
      }

      // Add Project - the REGISTRY foundation, deliberately not a management UI.
      // Everything else follows from the registry with no scaffolding step: ScopePaths
      // derives every location from the applicationId, so a project is selectable and
      // its artefacts resolve the moment this returns. The whole candidate is validated
      // by the same `validateRegistry` that guards every read, so a duplicate id, a
      // reserved name, a workbook another project already claims, or a credential VALUE
      // where a variable name belongs are refused by the existing rules.
      if (route === '/api/projects' && req.method === 'POST') {
        const body = await readJsonBody(req);
        try {
          // PROVISIONING, not just registration. A registry entry alone makes every
          // artefact path resolve, but it gives the project nowhere to author test
          // cases - and without a workbook the dashboard has no case list, `excel:run`
          // has nothing to select from and generation has no rows to read, so the
          // project appears in the selector and can do nothing. `provisionProject`
          // creates the workbook and the entry as ONE transaction: it validates the
          // whole candidate registry first, writes the workbook, then writes the
          // registry atomically, and removes the workbook it made if that last step
          // fails. `resetActiveScope` happens inside it, for the same reason it did
          // here - the memo was taken from the set of registered applications.
          const created = await provisionProject(body as ProvisionRequest);
          send(res, 201, {
            projects: describeProjects().projects,
            applicationId: created.applicationId,
            displayName: created.displayName,
            environmentId: created.environmentId,
            baseUrl: created.baseUrl,
            workbook: created.workbook,
            count: created.registry.applications.length,
          });
        } catch (error) {
          send(res, 400, { error: (error as Error).message });
        }
        return;
      }

      const environmentRoute = /^\/api\/projects\/([a-z][a-z0-9-]*)\/environments(?:\/([a-z][a-z0-9-]*))?$/.exec(route);
      if (environmentRoute && (req.method === 'POST' || req.method === 'PUT')) {
        if (active || autocode || executionBatch) { send(res,409,{error:'Wait for execution/generation to finish before editing environments'}); return; }
        const body = await readJsonBody(req) as any;
        if (active || autocode || executionBatch || recorderSessionStatus().recording) {send(res,409,{error:'Finish the current browser operation before editing environments'});return;}
        const create = req.method === 'POST';
        if (create === Boolean(environmentRoute[2])) throw Error('Use POST to add an environment or PUT to edit its permanent ID');
        const environmentId = create ? body.environmentId : environmentRoute[2];
        const environment = saveEnvironment(environmentRoute[1], environmentId, body, create);
        send(res,create ? 201 : 200,{environmentId, environment, projects:describeProjects().projects});
        return;
      }

      if (route === '/api/workbook' && req.method === 'GET') {
        const workbookPath = resolveWorkbook(url.searchParams.get('workbook'));
        // Reading a workbook is scoped too: the page lists cases from it, and listing
        // one project's rows while another is selected is exactly the mixing rule 14
        // forbids. Only enforced when the request names a project, so the existing
        // single-application page keeps working unchanged.
        // The workbook's own application, and it must agree with any project the
        // request names. Derived from the registry's declared ownership rather than
        // from the ambient scope, so what is listed is this workbook's rows under this
        // workbook's project - never whichever project the server process is in.
        const scope = scopeForWorkbook(path.relative(ROOT, workbookPath),
            { applicationId: url.searchParams.get('applicationId') ?? undefined, environmentId: url.searchParams.get('environmentId') ?? undefined });
        send(res, 200, await describeWorkbook(workbookPath, scope));
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
            'generations', 'projects'] });
        return;
      }

      // WHICH WORKBOOKS MAY THIS PROJECT SELECT - not "what .xlsx files are there".
      //
      // A directory listing answers the second question, and answering it for the first
      // is how one project's workbook becomes selectable by another: its rows would then
      // be generated, run and written back under the wrong application, with the results
      // landing in the real owner's spreadsheet. The registry's `workbooks` array is
      // authoritative, and `workbooksFor` reads it and nothing else.
      //
      // FAIL CLOSED. A workbook no application declares is reported separately as
      // `unowned` and is never offered as a selection: silently attributing it to
      // whoever happens to be selected is identity-by-filename, which is the one thing
      // this architecture refuses everywhere else. While a single application is
      // registered the sole-application rule still applies, so an unmigrated checkout
      // behaves exactly as it did.
      if (route === '/api/workbooks' && req.method === 'GET') {
        try {
          const selected = tryScopeFromSelection({
            applicationId: url.searchParams.get('applicationId') ?? undefined,
            environmentId: url.searchParams.get('environmentId') ?? undefined,
          });
          if ('error' in selected) {
            send(res, 400, { ...selected, workbooks: [] });
            return;
          }
          const owned = workbooksFor(selected.scope.applicationId);
          const unowned = unownedWorkbooks();
          send(res, 200, {
            applicationId: selected.scope.applicationId,
            workbooks: owned,
            // Reported so the page can say so, never merged into `workbooks`.
            unowned,
          });
        } catch (error) {
          send(res, 400, { error: (error as Error).message, workbooks: [] });
        }
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
        const summary = await describeWorkbook(destination,
            scopeForWorkbook(path.relative(ROOT, destination)));
        // A bulk import is the case this exists for: every row that needs a
        // spec gets one, without anyone naming them.
        const generating = startAutocode(destination, [], scopeForWorkbook(path.relative(ROOT,destination), {applicationId:url.searchParams.get("applicationId"), environmentId:url.searchParams.get("environmentId")}),executionInput({...Object.fromEntries(url.searchParams),headed:url.searchParams.get("headed")==="true"}));
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
        const selectedScope = scopeForWorkbook(
            path.relative(ROOT, workbookPath), body as Record<string, unknown>);
        if (hasPendingRecording()) {
          const pendingDraft = pendingRecordingFor(selectedScope);
          const review = ownershipReview(selectedScope, pendingDraft.recording, pendingDraft.ownerOverrides, pendingDraft.authoringPages);
          if (body.ownershipRevision && body.ownershipRevision !== review.revision) throw Error('Recording ownership review is stale.');
          pendingDraft.recording.authoringOwners = { version: 1, applicationId: selectedScope.applicationId,
            recordingHash: '', choices: review.steps.map(({ key, recommended, confirmed, route, explicit, provenance, userSelection, frameworkRecommendation }) => ({ key, recommended, confirmed, route, explicit, provenance, userSelection, frameworkRecommendation })),
            pages: pendingDraft.authoringPages ?? [] };
        }
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
        // THE SELECTED PROJECT, resolved once and used for everything below.
        //
        // `rememberRecordingFingerprint` used to be called with no scope, so it fell to
        // `recordingsDir()` -> the AMBIENT scope, which in this long-lived server is the
        // declared legacy owner whatever project the person selected. Measured: saving
        // Flipkart's TC_SMOKE_004 wrote `TC_SMOKE_004.authoring.json` into
        // `ai/dashboard/recordings/bugasura` while the recording itself went correctly to
        // `recordings/flipkart`. The bookkeeping and the artefact it describes ended up in
        // two different applications' stores - and the sidecar is what decides whether a
        // recording is stale, so it was answering that question for the wrong project.

        if (artifact) {
          const savedRow = (await parseWorkbook(workbookPath)).testCases
              .find(row => row.testCaseId.toUpperCase() === saved.testCaseId.toUpperCase());
          if (savedRow)
            rememberRecordingFingerprint(savedRow, selectedScope.paths.recordingsDir);
        }
        // Rebuild the cache and register the mapping straight away, so the row
        // is a running test before the response reaches the page.
        // Same rule as below: the row is committed, so rebuilding derived state may report
        // a problem but may not un-save the case. A failure here leaves the row present and
        // simply not yet runnable, which is exactly what the response then says.
        let live:Awaited<ReturnType<typeof activate>>;
        try { live = await activate(workbookPath, saved.testCaseId, selectedScope); }
        catch (error) {
          live = { runnable:false, needsCode:true,
            noCodeReason:`derived state could not be rebuilt after saving: ${error instanceof Error?error.message:String(error)}` } as any;
        }
        // Send the generator after any row that needs code written, including
        // one whose spec this module already wrote and whose row has since been
        // edited. Keying off `runnable` was wrong: a spec-backed case is
        // runnable, so an edit to it silently left the old spec asserting the
        // old wording while the page said there was nothing left to do.
        //
        // THE WORKBOOK ROW IS ALREADY COMMITTED BY THIS POINT, so nothing below may turn
        // the save into a failure. Starting the generator is a SEPARATE decision that can
        // legitimately be refused - most often because no Source Environment is selected -
        // and that refusal used to escape this handler as a 400. The page then reported the
        // save as failed and returned before its own `loadWorkbook()`, so the Test Cases
        // list never refreshed and the row only surfaced on a manual browser refresh.
        // Worse, a person reasonably pressed Save again: the second save appended a SECOND
        // row, and the pending recording had already been consumed by the first, leaving a
        // duplicate case with no recording behind it.
        //
        // So a post-commit refusal is reported as DATA on a successful save, never as an
        // error status. The reason still reaches the page verbatim.
        let generating:{started:boolean;reason?:string;code?:string;executionContext?:ExecutionContext;executionProfile?:ExecutionProfile};
        if (!live.needsCode)
          generating = { started: false, reason: live.noCodeReason ?? 'no runner covers this module' };
        else {
          const generationScope = scopeForWorkbook(path.relative(ROOT,workbookPath),body as any);
          try {
            // WHICH ACCOUNT THIS GENERATION RUNS AS, in priority order.
            //
            // 1. The recording this save just consumed. Server-held, stamped with the ID the
            //    workbook assigned a few lines above, and collected once - this is what makes
            //    "record, save, generate" one movement instead of three, and why nobody has to
            //    go back and select the case they have only just created.
            // 2. The profile named on the recording panel, for a save whose pending recording
            //    has already been consumed. An ID, never a value: the account and password are
            //    resolved in this process from the store.
            // 3. An explicit Execution Data selection. Unchanged for the workflow it belongs
            //    to - saving an existing case names no recording profile, so this is still the
            //    only source there. It ranks BELOW the two above deliberately: that selection
            //    persists in the page until it is cleared, and it was made for other cases, so
            //    letting it outrank the selector a person has just used beside Record would
            //    re-create the confusion in the opposite direction.
            //
            // None of these is a saved Example. The selection lives for this generation only;
            // the logical test stays profile-independent and any later run may choose again.
            const recorded = takeRecordedGenerationContext(generationScope, saved.testCaseId);
            const executionData = generationSelection(generationScope,
                  recorded?.credentialProfileId ?? (typeof (body as any).credentialProfileId === 'string' ? (body as any).credentialProfileId : undefined))
              ?? (body as any).executionData;
            generating = startAutocode(workbookPath, [saved.testCaseId], generationScope,executionInput(body),executionData);
          } catch (error) {
            generating = { started: false,
              reason: error instanceof Error ? error.message : String(error),
              code: configurationFailureCode(error) ?? 'GENERATION_NOT_STARTED' };
          }
        }
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
        // The application constrains the execution artefacts, and it is SELECTED.
        // Never inferred from the generated spec's file name, the Test Case ID, the
        // base URL or a Page Object name - all four of which are downstream of the
        // decision rather than evidence for it.
        const selected = tryScopeFromSelection(body as Record<string, unknown>);
        if ('error' in selected) {
          send(res, 400, selected);
          return;
        }
        // OWNERSHIP FIRST, existence second. A workbook belongs to exactly one
        // application and the registry says which, so "you selected the wrong project"
        // is answerable without touching the disk - and it is the more useful answer.
        // Without this a person could select Bugasura and run Flipkart's workbook, and
        // every result would be written back into Flipkart's rows under Bugasura's
        // scope - one application's execution record filed under another's name.
        const candidate = workbookPathOf((body as Record<string, unknown>).workbook);
        assertWorkbookInScope(selected.scope, path.relative(ROOT, candidate));
        const workbookPath = resolveWorkbook((body as Record<string, unknown>).workbook);
        const parsed = await parseWorkbook(workbookPath);
        // Test cases are resolved INSIDE the selected application. TC_LOGIN_001 is
        // unique within a workbook and a workbook belongs to one project, so the
        // workbook boundary is the application boundary - reused here rather than
        // duplicated into a second store keyed by applicationId.
        const known = new Set(parsed.testCases.map(c => c.testCaseId.toUpperCase()));
        const request = parseRunRequest(body, known);
        if (active || executionBatch || autocode || recorderSessionStatus().recording) { send(res,409,{error:'The browser/output queue is busy. Wait for the current operation to finish.'}); return; }
        const environments = (body as any).environmentIds;
        if((body as any).executionData){send(res,202,startEnvironmentExecution(workbookPath,request,selected.scope,environments??[selected.scope.environmentId],(body as any).executionData,Object.fromEntries(parsed.testCases.map(c=>[c.testCaseId,c.tags]))));return;}
        send(res, 202, environments !== undefined
          ? startEnvironmentExecution(workbookPath,request,selected.scope,environments)
          : startRun(workbookPath,request,selected.scope));
        return;
      }

      if (route === '/api/stream' && req.method === 'GET') {
        const running = executionBatch?.record || active?.record;
        if (running && running.applicationId !== url.searchParams.get('applicationId')) { send(res,404,{error:'No execution for this project'});return; }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        if (!active && !executionBatch) {
          res.write(`event: idle\ndata: {}\n\n`);
          res.end();
          return;
        }
        // Replay what has already been printed, so a page opened mid-run is not
        // left staring at a blank console.
        const owner = executionBatch || active!;
        res.write(`event: log\ndata: ${JSON.stringify({ text: owner.log.join('') })}\n\n`);
        owner.clients.add(res);
        req.on('close', () => owner.clients.delete(res));
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
        if (active || executionBatch) {send(res,409,{started:false,reason:'A test run is in progress'});return;}
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const workbookPath = resolveWorkbook(body.workbook);
        // The workbook's own application. The staleness gate below reads recording
        // evidence, and reading it through the ambient scope would check one project's
        // rows against another project's recordings.
        const autocodeScope = scopeForWorkbook(path.relative(ROOT, workbookPath), body);
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
          const recording = recordingStatus(testCase, autocodeScope.paths.recordingsDir);
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
        const started = startAutocode(workbookPath, ids, autocodeScope, executionInput(body),body.executionData as SelectionRequest|undefined);
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
        // THE PROJECT IS CHOSEN BEFORE THE BROWSER OPENS. A ScopeError here means
        // either "you did not say which application" (with two or more registered) or
        // "there is no application by that name", and both are answers a person has to
        // give - so the request is refused with the choices named rather than resolved
        // against whichever application happens to be first, or against the URL.
        const selected = tryScopeFromSelection(body);
        if ('error' in selected) {
          send(res, 400, { started: false, ...selected });
          return;
        }
        // `await`: the live transport decides asynchronously whether it can run and
        // falls back to the codegen child process before answering, so the person
        // always gets a browser or a clear error - never a half-started session.
        //
        // `url` is optional and only ever narrows WHERE in the application to start.
        // Omitted, the recorder opens the selected environment's own baseUrl, which is
        // what makes the selection do the work instead of somebody retyping an address.
        // The account is named here, before the browser opens, and only its ID travels.
        // The recorder resolves it in this process so it can recognise what gets typed
        // into the sign-in form; nothing it resolves is ever sent back to the page.
        const started = await startRecording({
          scope: selected.scope,
          url: typeof body.url === 'string' ? body.url : undefined,
          browser: String(body.browser ?? 'chromium'),
          testCaseId: typeof body.testCaseId === 'string' ? body.testCaseId : undefined,
          credentialProfileId: typeof body.credentialProfileId === 'string' ? body.credentialProfileId : undefined,
          // Carried so the generation this recording leads to rebases from the same
          // environment the browser was pointed at, without anyone restating it at Save.
          sourceEnvironmentId: typeof body.sourceEnvironmentId === 'string' ? body.sourceEnvironmentId : undefined,
        });
        send(res, started.started ? 202 : 400, started);
        return;
      }

      if (route === '/api/record' && req.method === 'GET') {
        send(res, 200, recorderSessionStatus());
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
        const owner = executionBatch?.record || active?.record;
        if (owner && owner.applicationId !== url.searchParams.get('applicationId')) { send(res,404,{error:'No execution for this project'});return; }
        if (executionBatch) executionBatch.cancelled = true;
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
        // The RETENTION stays global and unchanged - the newest five generations on
        // this machine, whatever project they belong to. Only the VIEW is narrowed, so
        // asking as one project never evicts another project's record.
        const wanted = url.searchParams.get('applicationId') ?? undefined;
        const generations = listGenerations()
            .filter(entry => !wanted || entry.applicationId === wanted);
        send(res, 200, { generations, limit: HISTORY_LIMIT });
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
        // `?applicationId=` narrows a GLOBAL store by the identity each record carries.
        send(res, 200, {
          runs: listRuns(url.searchParams.get('applicationId') ?? undefined),
          active: (() => { const record=executionBatch?.record || active?.record; const wanted=url.searchParams.get('applicationId');return record && (!wanted || record.applicationId===wanted) ? record.id : null; })(),
        });
        return;
      }

      // /api/runs/<id>/report[/...] - this run's own copy of the Playwright
      // HTML report. The trailing slash matters: the report is a single-page
      // app that loads its assets by relative path, and without it the browser
      // resolves them against /api/runs/ and every one 404s.
      const reportRoute = /^\/api\/(?:projects\/([^/]+)\/)?runs\/([^/]+)\/report(\/.*)?$/.exec(route);
      if (reportRoute && req.method === 'GET') {
        const id = path.basename(decodeURIComponent(reportRoute[2]));
        if (reportRoute[1]) url.searchParams.set('applicationId',decodeURIComponent(reportRoute[1]));
        if (!requestedRun(id,url)) {send(res,404,{error:'No report for this project'});return;}
        const rest = reportRoute[3];
        if (rest === undefined || rest === '') {
          res.writeHead(302, { location: `/api/projects/${encodeURIComponent(url.searchParams.get('applicationId')!)}/runs/${encodeURIComponent(id)}/report/` });
          res.end();
          return;
        }
        // The run's own report is what `/report/` means now. Playwright's kept copy, where
        // one exists, stays reachable one level down rather than being taken away.
        const playwright = /^\/playwright(\/.*)?$/.exec(rest);
        const base = playwright ? path.join(RUNS_DIR, id, 'playwright-report')
          : fs.existsSync(path.join(RUNS_DIR, id, 'report', 'index.html')) ? path.join(RUNS_DIR, id, 'report')
          : path.join(RUNS_DIR, id, 'playwright-report');
        const within = playwright ? (playwright[1] ?? '/') : rest;
        const requested = within === '/' ? '/index.html' : decodeURIComponent(within);
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
        const record = requestedRun(id,url);
        if (!record) { send(res,404,{error:'No evidence for this project/environment'});return; }
        const manifest = [...(record.evidence || []).map(e=>e.url),
          ...Object.values(record.steps || {}).flat().flatMap(s=>[s.screenshotUrl,...(s.captures ?? []).map(c=>c.url)]).filter(Boolean)];
        if (!manifest.some(value=>new URL(value!, 'http://localhost').pathname===route)) {send(res,404,{error:'No artifact associated with this execution'});return;}
        const base = path.join(RUNS_DIR, id, 'evidence');
        const requested = decodeURIComponent(evidenceRoute[2]);
        if (!serveStatic(res, base, requested))
          send(res, 404, { error: 'No such evidence file' });
        return;
      }

      if (route.startsWith('/api/runs/') && req.method === 'GET') {
        // basename() so a crafted id cannot walk out of the runs directory.
        const id = path.basename(route.slice('/api/runs/'.length));
        const record = requestedRun(id,url);
        const file = path.join(RUNS_DIR, `${id}.json`);
        if (!record) {
          send(res, 404, { error: 'No such run' });
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        fs.createReadStream(file).pipe(res);
        return;
      }

      // Scratch directories have no durable request ownership. Only the retained,
      // manifest-checked run routes above may serve execution artifacts.
      send(res, 404, { error: `No route for ${route}` });
    } catch (error) {
      if(error instanceof ExecutionConfigurationError){send(res,400,{error:error.message,code:error.code,phase:'configuration'});return;}
      // A ScopeError is a CHOICE the person has not made, not a fault: "more than one
      // application is registered and you did not say which", or "that workbook
      // belongs to another project". Its message already names what to do, and it
      // carries the choices so the page can offer them rather than making somebody
      // read an error and go looking. Everything else stays a plain bad request.
      if (error instanceof ScopeError) {
        send(res, 400, {
          error: error.message,
          choices: describeProjects().projects.map(project => project.applicationId),
        });
        return;
      }
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
