/**
 * survey -> generate -> gate -> register, one case at a time.
 *
 * Sequential on purpose. Two agents editing tests-e2e/ at once would race on
 * the Page Objects they both want to extend, and two verification runs at once
 * would be the concurrent navigation Bugasura refuses. Throughput is not the
 * point; not needing anyone to watch it is.
 *
 * Nothing here promotes a case to Automated and nothing commits. `Automated` is
 * earned by a green run of the real suite via `mapping promote`, and a machine
 * asserting its own work is good enough is precisely the thing being guarded
 * against.
 */

import fs from 'node:fs';
import path from 'node:path';

import { declined, generate, resolveModel } from './agent';
import { describeGroups, type Group, groupWork } from './groups';
import {
  analyseCorpus, writeLedger, type CorpusResult, type UnmeasuredTarget,
} from './abstraction/propose';
import { resolveSemanticReviews } from './abstraction/semantic';
import { applyProposals, ensureFixturesModule, type WriteResult } from './abstraction/writer';
import {
  appendLifecycleLog, decideLifecycle, describeLifecycle, summarise,
} from './abstraction/lifecycle';
import type { Proposal } from './abstraction/types';
import {
  acceptRecording, describeMapping, generateFromRecording, type RecordedGeneration,
} from './from-recording';
import { isRecordedTags } from '../dashboard/recorder';
import * as metrics from './metrics';
import { GroupSession, persistentSessionEnabled, SessionUnavailable } from './session';
import {
  AUTOCODE_DIR, fingerprint, frameworkFingerprint, generatedDir, QUARANTINE_DIR, readState,
  slug, StateEntry, stateKeyFor, surveyWork, Verdict, writeState,
} from './work';
import { gate, type GateResult } from './verify';
import { activeApplicationId } from '../knowledge/canonical';
import { activeMappingFile, readMapping, upsertEntry, writeMapping } from '../excel/mapping';
import { pinActiveScope } from '../projects/scope';
import { parseWorkbook } from '../excel/parser';

const ROOT = process.cwd();
export const LOCK_FILE = path.join(AUTOCODE_DIR, '.lock');
export const LOG_FILE = path.resolve(ROOT, 'ai', 'reports', 'autocode-log.md');

export interface CaseOutcome {
  testCaseId: string;
  scenario: string;
  verdict: Verdict;
  reason: string;
  specFile?: string;
  quarantinedTo?: string;
  durationMs: number;
}

export interface AutocodeResult {
  workbook: string;
  startedAt: string;
  finishedAt: string;
  outcomes: CaseOutcome[];
  skipped: Array<{ testCaseId: string; reason: string }>;
  /** The model that wrote these specs. Recorded so a weak batch is explicable. */
  model?: string;
  /** Set when the run refused to start. */
  blocked?: string;
  /** Ties this run to its records in ai/reports/generation-metrics.jsonl. */
  runId?: string;
}

/**
 * A run identifier that sorts chronologically and needs no coordination.
 *
 * Timestamp plus a short random suffix, because two runs can start inside the
 * same millisecond (the watcher and the dashboard both firing on one save) and a
 * collision would merge two runs' metrics into one.
 */
function newRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * One run at a time, across every entry point.
 *
 * The dashboard, the watcher and the CLI can all ask for a run, and the
 * watcher in particular will ask again the moment a spec is written - the
 * generated file lands inside the repo the watcher is not looking at, but a
 * verification run rewrites the workbook's cache. A stale lock from a killed
 * process is cleared after an hour rather than wedging the feature.
 */
/** The PID recorded in the lock, or null if it is unreadable. */
function lockHolder(): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Signal 0 tests for existence without delivering anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else - still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A lock left behind by a process that is no longer running.
 *
 * The age fallback used to be the *only* test, and an hour is a long time to
 * silently do nothing: a killed run (closing the dashboard is enough) wedged
 * every later save, and because generation is meant to need no intervention,
 * nobody was watching a terminal to notice. The holder's PID is written into
 * the file, so liveness is a syscall away - the hour remains only for the case
 * where the PID has been recycled by an unrelated process.
 */
function lockIsStale(): boolean {
  if (!fs.existsSync(LOCK_FILE))
    return false;
  const pid = lockHolder();
  if (pid !== null && pid !== process.pid && !alive(pid))
    return true;
  return Date.now() - fs.statSync(LOCK_FILE).mtimeMs >= 60 * 60_000;
}

function acquireLock(): boolean {
  fs.mkdirSync(AUTOCODE_DIR, { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    if (!lockIsStale())
      return false;
    fs.rmSync(LOCK_FILE, { force: true });
  }
  fs.writeFileSync(LOCK_FILE, `${process.pid}\n`, 'utf8');
  return true;
}

function releaseLock(): void {
  fs.rmSync(LOCK_FILE, { force: true });
}

export function isRunning(): boolean {
  return fs.existsSync(LOCK_FILE) && !lockIsStale();
}

/** `tests-e2e/generated/create-project.spec.ts` for a case in the Projects module. */
function specPathFor(module: string, worksheet: string): string {
  const name = slug(module.trim() || worksheet.trim());
  return path.relative(ROOT, path.join(generatedDir(), `${name}.spec.ts`)).replace(/\\/g, '/');
}

/**
 * `tests-e2e/generated/TC_LOGIN_029.spec.ts` - one recorded case, one file.
 *
 * The recorded pipeline assembles a COMPLETE file and writes it whole, unlike the
 * agent, which edits a module file in place and leaves its siblings alone. Given
 * the module path, those two behaviours combine badly: each recording replaced the
 * previous case's spec, and quarantining the newest one then found no other test
 * in the file and deleted it - taking accepted cases with it. Eight cases were
 * lost that way, five of which nothing had ever refused.
 *
 * So a recorded case owns its own file. Nothing else changes: same directory,
 * same fixtures, same gate, same mapping entry, and the AI path keeps the module
 * file it has always shared.
 */
export function recordedSpecPathFor(testCaseId: string): string {
  const name = testCaseId.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_') || 'CASE';
  return path.relative(ROOT, path.join(generatedDir(), `${name}.spec.ts`)).replace(/\\/g, '/');
}

/**
 * Move a spec the gate refused out of tests-e2e/.
 *
 * It has to leave: everything under tests-e2e/ is collected by the normal
 * suite, and a spec that only passes because it checks nothing would sit there
 * reporting green for as long as nobody looked at it.
 */
export function quarantine(specFile: string, testCaseId: string): string {
  fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // THE APPLICATION IS PART OF THE NAME, and the timestamp alone was not enough.
  //
  // The directory stays GLOBAL - it is a diagnostic pile, not an artefact store - but
  // the name was `<testCaseId>.<stamp>`, which fails twice once two applications share
  // a Test Case ID. `copyFileSync` OVERWRITES, so two generators quarantining
  // TC_LOGIN_001 in the same millisecond lose one file silently; millisecond precision
  // makes that unlikely, not impossible, and "unlikely" is not a property to rely on
  // for the one copy of a spec somebody will want to read. The decisive reason is
  // simpler though: `TC_LOGIN_001.2026-...txt` cannot be attributed to a project at
  // all, so the pile becomes unreadable the moment there are two.
  //
  // Nothing parses this name back - every caller uses the returned path - so the only
  // cost is that the file now says whose it is.
  const owner = activeApplicationId();
  // .txt, not .ts: nothing should ever compile or collect this by accident.
  const destination = path.join(QUARANTINE_DIR, `${owner}.${testCaseId}.${stamp}.spec.ts.txt`);
  fs.copyFileSync(path.resolve(ROOT, specFile), destination);
  return path.relative(ROOT, destination).replace(/\\/g, '/');
}

/**
 * Remove one test from a shared spec file, leaving the others alone.
 *
 * Generated specs are grouped per module, so a quarantined case cannot simply
 * delete the file. When it is the only test, the file goes; otherwise the file
 * is left and the case is recorded as quarantined, because cutting a test block
 * out of source with a regex is how you corrupt the tests that were fine.
 */
export function retractSpec(specFile: string, testCaseId: string, onLog: (text: string) => void): void {
  const absolute = path.resolve(ROOT, specFile);
  if (!fs.existsSync(absolute))
    return;
  const source = fs.readFileSync(absolute, 'utf8');
  const others = [...source.matchAll(/['"`]\s*((?:TC|TS)[_-][A-Za-z0-9_-]+)\s*-/g)]
      .map(match => match[1])
      .filter(id => id.toUpperCase() !== testCaseId.toUpperCase());

  if (!others.length) {
    fs.rmSync(absolute, { force: true });
    onLog(`  removed ${specFile} (it held only the quarantined case)\n`);
    return;
  }
  onLog(`  WARNING: ${specFile} also holds ${[...new Set(others)].join(', ')}, so it was left in ` +
    `place. ${testCaseId} is quarantined but its code is still in that file - review it.\n`);
}

/**
 * Say so when a case's previous spec file still holds a test with its ID.
 *
 * Only reachable when a case moves between files - a recorded row that was
 * generated into the shared module file before it owned one. Reported and left
 * alone, on the same reasoning as `retractSpec`: cutting a test block out of
 * source with a regex is how the tests that were fine get corrupted.
 */
function warnOnDuplicate(
  previousSpec: string | undefined,
  currentSpec: string,
  testCaseId: string,
  onLog: (text: string) => void,
): void {
  if (!previousSpec || previousSpec === currentSpec)
    return;
  const absolute = path.resolve(ROOT, previousSpec);
  if (!fs.existsSync(absolute))
    return;
  const pattern = new RegExp(`['"\`]\\s*${testCaseId}\\s*-`, 'i');
  if (!pattern.test(fs.readFileSync(absolute, 'utf8')))
    return;
  onLog(`  WARNING: ${previousSpec} still holds a test titled ${testCaseId}, and this case now ` +
    `owns ${currentSpec}. Two tests share that ID, so a run selecting it would execute both - ` +
    'remove the old one by hand.\n');
}

export interface RunOptions {
  workbook: string;
  onlyIds?: string[];
  onLog?: (text: string) => void;
  /** Survey and report, generate nothing. */
  dryRun?: boolean;
  /**
   * Refresh the abstraction ledger and apply the proposals a person has APPROVED.
   *
   * ON by default. `PAGE OBJECT REQUIRED` must not be the terminal state for a
   * candidate the engine can prove is safe and reusable, so creation runs as part of
   * authoring rather than as a chore somebody remembers afterwards.
   *
   * Set `false` to generate without touching Page Objects or knowledge - which is
   * what a dry run does anyway, and what CI wants when it must not write.
   */
  createPageObjects?: boolean;
}

/**
 * The abstraction result for this run, computed once.
 *
 * `analyseCorpus()` reads every recording on disk, so calling it per case would make
 * a batch quadratic. Nothing but a WRITE can change what it returns, so it is cached
 * for the run and dropped the moment a Page Object is created.
 */
let corpusCache: CorpusResult | null = null;

/**
 * Create the Page Objects this recording needs, BEFORE its spec is assembled.
 *
 * THIS IS THE ORDER THE WHOLE PHASE EXISTS FOR, and it used to be the other way
 * round. The engine ran after generation, so a capability it created could only ever
 * help the NEXT recording - the spec that motivated it kept its raw locator and was
 * reported as `PAGE OBJECT REQUIRED`. Running first means the method exists by the
 * time `mapRecording` looks for it, and the current test consumes it in the same
 * authoring operation. Nothing is cached between the two: `mapRecording` calls
 * `readAllPageKnowledge()` and `buildIndex()` itself, so it sees what was just written.
 *
 * THERE IS STILL EXACTLY ONE CREATION PATH. This orchestrates the existing modules -
 * `analyseCorpus` classifies and validates, `resolveSemanticReviews` asks the one
 * semantic question where the deterministic engine could not decide, `applyProposals`
 * is the only thing that writes - and adds no logic of its own.
 *
 * ONLY THIS RECORDING'S PROPOSALS ARE ACTED ON. The analysis is corpus-wide because
 * parameterisation is a judgement no single recording can support, but writing is
 * scoped to what this case actually touched, so authoring one case cannot quietly
 * rewrite the Page Objects of a case nobody asked about.
 *
 * Failures are logged and swallowed. A Page Object that could not be created is a
 * missed improvement, not a bad spec: generation carries on and the element is
 * reported as `PAGE OBJECT REQUIRED` exactly as it was before.
 */
/**
 * What this case's Page Object pass decided, carried forward to the lifecycle join.
 *
 * Returned rather than logged and discarded, because the mapping the decisions have to
 * be joined against does not exist yet: `ensurePageObjects` runs BEFORE
 * `generateFromRecording`, deliberately, so that a method it creates is available to
 * the spec that motivated it.
 */
interface PageObjectPass {
  proposals: Proposal[];
  unmeasured: UnmeasuredTarget[];
  writes: WriteResult[];
  /** What the semantic resolver spent, or null when it was never engaged. */
  semantic: metrics.SemanticSpend | null;
}

async function ensurePageObjects(
  testCaseId: string,
  options: RunOptions,
  log: (text: string) => void,
): Promise<PageObjectPass> {
  const empty: PageObjectPass = { proposals: [], unmeasured: [], writes: [], semantic: null };
  if (options.createPageObjects === false || options.dryRun)
    return empty;
  try {
    const result = corpusCache ?? (corpusCache = analyseCorpus());
    // EVERY SIGHTING, not only the recording that first produced the proposal. The
    // ledger keeps one line per abstraction, so a target first seen in another case has
    // no proposal of its own - and filtering on `testCaseId` alone therefore found
    // nothing for exactly the elements a second recording shares with a first.
    const mine = result.proposals.filter(proposal =>
      proposal.testCaseId.split(',').includes(testCaseId)
      || proposal.sightings.some(sighting => sighting.testCaseId === testCaseId));
    const unmeasured = result.unmeasured.filter(entry => entry.testCaseId === testCaseId);
    if (!mine.length)
      return { ...empty, unmeasured };


    const deterministic = mine.filter(proposal => proposal.status === 'PROPOSED').length;

    // The resolver sees only what this case left unresolved, and only where what is
    // left is a question about meaning. Everything already settled costs no model call.
    const semantic = await resolveSemanticReviews({ ...result, proposals: mine }, {});
    const spend: metrics.SemanticSpend | null = semantic.asked
      ? {
        exchanges: semantic.asked,
        calls: semantic.calls,
        attempts: semantic.audits.reduce((total, audit) => total + audit.attempts.length, 0),
        totalMs: semantic.totalMs,
        accepted: semantic.accepted,
        rejected: semantic.rejected,
        terminalStops: semantic.terminalStops,
      }
      : null;
    if (semantic.asked) {
      log(`  semantic resolver: asked ${semantic.asked}, accepted ${semantic.accepted} `
        + `(${semantic.repaired} after repair), rejected ${semantic.rejected}, `
        + `${semantic.calls} transport call(s) in ${Math.round(semantic.totalMs / 1000)}s`
        + `${semantic.terminalStops ? `, ${semantic.terminalStops} settled on the first answer` : ''}\n`);
      for (const audit of semantic.audits) {
        log(`    ${audit.semanticCodes.join('+')} -> ${audit.outcome}`
          + `${audit.attempts.length > 1 ? ` in ${audit.attempts.length} attempt(s)` : ''}`
          + `${audit.owner ? ` ${audit.owner}.${audit.methodName}()` : ''}`
          + `${audit.rejection ? ` (${audit.rejection.slice(0, 78)})` : ''}\n`);
      }
    }

    const outcome = applyProposals(mine);
    // WRITTEN, NOT MERELY `APPLIED`. `outcome` is decided before anything reaches disk
    // and is never revised, so a run that rolled back still carries `APPLIED` on every
    // result - and reporting those as `created` told a person a method existed when the
    // repository had just been restored without it.
    const created = outcome.results.filter(entry => entry.written);
    if (created.length) {
      corpusCache = null;                 // the index moved; the analysis is now stale
      for (const entry of created)
        log(`  created ${entry.proposal.owner}.${entry.proposal.method}() + knowledge entry\n`);
      log(`  ${deterministic} deterministic, ${semantic.accepted} model-resolved\n`);
    } else if (outcome.results.length) {
      log(`  no Page Object was written: ${outcome.reason}\n`);
    }
    writeLedger(result);
    return { proposals: mine, unmeasured, writes: outcome.results, semantic: spend };
  } catch (error) {
    log(`\n  abstraction: skipped - ${(error as Error).message}\n`);
    return empty;
  }
}

export async function run(options: RunOptions): Promise<AutocodeResult> {
  const log = options.onLog ?? (() => {});
  corpusCache = null;
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const workbookRelative = path.relative(ROOT, path.resolve(options.workbook)).replace(/\\/g, '/');

  // WHICH APPLICATION THIS RUN IS FOR, stated before anything resolves a path.
  //
  // The workbook is the authoritative source - the registry declares exactly one owner for
  // it - and every artefact this run reads or writes is application-owned: the recording it
  // assembles from, the page knowledge it selects, the Page Object index it builds, the
  // fixtures module a generated spec imports, the directory that spec lands in, the mapping
  // entry it registers. All of those resolve through `activeScopePath`, which without this
  // line answers with the AMBIENT scope - the declared legacy owner. Measured on a real
  // Flipkart run: the recording sat in `ai/dashboard/recordings/flipkart/TC_SMOKE_003.spec.ts`
  // while this process looked in `ai/dashboard/recordings/bugasura`, selected
  // `bugasura__root.yaml`, and would have written into `tests-e2e/pages`. It then reported
  // "no Codegen artifact was kept for this case" about a recording that existed.
  //
  // Pinned HERE rather than in `ai/autocode/cli.ts` because this is the single boundary
  // every entry point crosses - the CLI, its --watch mode and the dashboard's spawn all
  // arrive at `run()` - so one statement covers them all and none can forget it.
  const scope = pinActiveScope({ workbook: options.workbook });
  log(`application: ${scope.applicationId} (${scope.environmentId})
`);

  const model = resolveModel();
  const runId = newRunId();
  const base: AutocodeResult = {
    workbook: workbookRelative, startedAt, finishedAt: startedAt, outcomes: [], skipped: [], model, runId,
  };

  /**
   * Browser sharing across the whole run, accumulated per group.
   *
   * Kept outside the try so a crashed run still records the browsers it opened -
   * a benchmark that silently omitted the expensive half of a failed run would be
   * worse than no benchmark.
   */
  const sessions: NonNullable<metrics.RunMetrics['sessions']> = {
    groups: [], browsersOpened: 0, authentications: 0, reuseCount: 0, discarded: 0, unavailable: 0,
  };

  /** The run-level record. Written on every exit path, including the blocked one. */
  const recordRun = (
    status: metrics.RunMetrics['status'],
    routing: metrics.RunMetrics['routing'],
    attempts: number,
    blocked?: string,
  ) => metrics.append({
    kind: 'run', schema: metrics.SCHEMA, runId, workbook: workbookRelative,
    applicationId: activeApplicationId(), model,
    startedAt, finishedAt: new Date().toISOString(), totalMs: Date.now() - startedMs,
    status, ...(blocked ? { blocked } : {}), routing, attempts,
    ...(sessions.groups.length ? { sessions } : {}),
  });

  const noRouting: metrics.RunMetrics['routing'] = {
    rowsConsidered: 0, needsAgent: 0, cacheHits: 0, skipped: 0, skippedByReason: {},
  };
  /** Best census known so far, so a crash still records what it had. */
  let routingSoFar = noRouting;

  if (!options.dryRun && !acquireLock()) {
    const blocked = 'Another autocode run is in progress. Nothing was started.';
    // A blocked run is still an event worth counting: it is how a save gets
    // silently dropped, and the baseline found two of them in the log.
    recordRun('blocked', noRouting, 0, blocked);
    return { ...base, finishedAt: new Date().toISOString(), blocked };
  }

  try {
    const parsed = await parseWorkbook(path.resolve(options.workbook));
    const mapping = readMapping(activeMappingFile());
    const state = readState();
    const onlyIds = options.onlyIds?.length
      ? new Set(options.onlyIds.map(id => id.toUpperCase()))
      : undefined;

    const survey = surveyWork(parsed, mapping, state, onlyIds);
    base.skipped = survey.skipped;

    // A row with an accepted spec and an unchanged fingerprint is skipped
    // silently by surveyWork - no work item, no skip entry. That silence is the
    // fingerprint cache doing its job, so it is counted by subtraction rather
    // than by adding a reason string nobody needs to read.
    const considered = parsed.testCases
        .filter(testCase => !onlyIds || onlyIds.has(testCase.testCaseId.toUpperCase())).length;
    const skippedByReason: Record<string, number> = {};
    for (const skip of survey.skipped) {
      const bucket = metrics.classifySkip(skip.reason);
      skippedByReason[bucket] = (skippedByReason[bucket] ?? 0) + 1;
    }
    const routing: metrics.RunMetrics['routing'] = {
      rowsConsidered: considered,
      needsAgent: survey.work.length,
      cacheHits: Math.max(0, considered - survey.work.length - survey.skipped.length),
      skipped: survey.skipped.length,
      skippedByReason,
    };
    routingSoFar = routing;

    log(`\nautocode: ${survey.work.length} case(s) need code, ${survey.skipped.length} skipped ` +
      `(model: ${model}${process.env.AUTOCODE_MODEL ? ' via AUTOCODE_MODEL' : ''}, ` +
      `browser: playwright-cli, session: ` +
      `${persistentSessionEnabled()
        ? 'one per group'
        : 'one per row (AUTOCODE_PERSISTENT_SESSION off)'})\n`);
    for (const skip of survey.skipped)
      log(`  - ${skip.testCaseId}: ${skip.reason}\n`);

    // Which rows may share a browser. Sequential within a group and across them:
    // Bugasura returns ERR_EMPTY_RESPONSE on concurrent navigation from one host,
    // so this optimises reuse, never concurrency.
    //
    // Computed before the dry-run exit so `--dry-run` shows the grouping. Checking
    // that four login rows land in one group should not cost four generations.
    const groups = groupWork(survey.work);
    if (survey.work.length)
      log(describeGroups(groups));

    if (options.dryRun || !survey.work.length) {
      for (const item of survey.work)
        log(`  would generate: ${item.testCase.testCaseId} (${item.reason}) ${item.testCase.scenario}\n`);
      // A dry run and a nothing-to-do run are both recorded. The census is the
      // point: it is where the cache-hit rate comes from, and it costs no agent.
      recordRun(options.dryRun ? 'dry-run' : 'completed', routing, 0);
      return { ...base, finishedAt: new Date().toISOString() };
    }

    /**
     * The recorded pipeline's own attempt record.
     *
     * Written into the SAME metrics file as every other attempt, with the same
     * shape, so a recorded case and an AI-generated one can be compared line for
     * line. `agentMs` is 0 rather than null because it is measured and it really is
     * zero: no agent ran. The model token fields stay null - there was no call to
     * report them.
     */
    const recordRecorded = (
      testCase: typeof survey.work[number]['testCase'],
      status: metrics.AttemptMetrics['status'],
      reason: string,
      result: RecordedGeneration,
      startedMs: number,
      gateDetail: GateResult,
    ) => metrics.append({
      kind: 'attempt', schema: metrics.SCHEMA, runId, workbook: workbookRelative,
      testCaseId: testCase.testCaseId, module: testCase.module,
      worksheet: testCase.source.worksheet, scenario: testCase.scenario, priority: testCase.priority,
      mode: 'spec:new', model: 'none (deterministic)',
      startedAt: new Date(startedMs).toISOString(), finishedAt: new Date().toISOString(),
      totalMs: Date.now() - startedMs,
      agentMs: 0, agentNonBrowserMs: 0, browserOpenMs: null,
      explorationWallMs: null, explorationBusyMs: null,
      authMs: null, repoDiscoveryMs: null, generationMs: result.metrics.assemblyTimeMs,
      gate: {
        staticMs: gateDetail.detail.staticMs ?? null,
        cleanRunMs: gateDetail.detail.cleanRunMs ?? null,
        mutationRunMs: gateDetail.detail.mutationRunMs ?? null,
        cleanStatus: gateDetail.detail.cleanStatus,
        mutatedStatus: gateDetail.detail.mutatedStatus,
        mutationsApplied: gateDetail.detail.mutationsApplied.length,
      },
      status, agentExitCode: 0, agentTimedOut: false,
      browserExplorations: 0, browseCommands: 0, browseByCommand: {}, browseRefused: 0,
      snapshots: { commands: 0, filesWritten: 0, duplicateFiles: 0 },
      screenshots: { commands: 0, filesWritten: 0 },
      cache: { hit: false, missReason: 'new' },
      session: null,
      recorded: result.metrics,
      context: {
        promptChars: 0, promptTokensApprox: 0, testCaseTokens: 0, briefTokens: 0,
        frameworkIndexTokens: 0, specExcerptTokens: 0, instructionTokens: 0,
        directedReadTokens: 0, autoLoadedTokens: 0, controlledTokens: 0, totalContextTokens: 0,
        budgetTokens: 0, overBudget: false, selectedFiles: [],
        pageKnowledgeTokens: 0, pageKnowledgeFiles: [], pageKnowledgeHit: false,
        pageKnowledgeVerdict: 'sufficient', pageKnowledgeMissReason: 'not consulted - mapped deterministically',
        browserExplorationRequired: false, pageKnowledgeDecisions: [],
        browser: {
          browserOpenRequired: false, browserOpened: false, partialWithoutBrowser: false,
          unnecessaryBrowserOpenAvoided: true, dismissedGaps: [], inspectableGaps: [],
          reason: 'recorded: assembled deterministically from the Codegen recording',
        },
        canonicalPageId: '', canonicalPageFile: '', rescuedKnowledgeFiles: [], knowledgeDuplicates: 0,
        // Null, not zeroes: the deterministic recorded path never extracts requirements
        // from prose - the recording is the requirement - so there is nothing to count.
        requirements: null,
        agentOutputChars: 0, modelInputTokens: null, modelOutputTokens: null, modelCostUsd: null,
      },
      // The recorded axis first, then the generic one. `classifyOutcome` cannot see
      // whether the assertions were put back where they were recorded, and that is
      // precisely the distinction between our defect and a real failure.
      failureClass: status === 'accepted' ? '' : (metrics.classifyRecordedFailure({
        block: result.block,
        orderReconstructed: result.metrics.orderReconstructed,
        cleanStatus: gateDetail.detail.cleanStatus,
        cleanCode: gateDetail.detail.code,
        mutatedStatus: gateDetail.detail.mutatedStatus,
        reason,
      }) || metrics.classifyOutcome(status, reason, { timedOut: false, wroteSpec: true })),
      failureReason: status === 'accepted' ? '' : reason,
    });

    /**
     * A recorded case that never reached the gate, because there was nothing to gate.
     *
     * Recorded as an attempt so the run is not silent about it, with `status:
     * 'declined'` - the existing vocabulary for "this row needs its author", and the
     * closest true statement. No new status, and no state entry: nothing was refused
     * about this recording, so nothing should count against it.
     */
    const recordRecordedBlocked = (
      testCase: typeof survey.work[number]['testCase'],
      result: RecordedGeneration,
      startedMs: number,
    ) => metrics.append({
      kind: 'attempt', schema: metrics.SCHEMA, runId, workbook: workbookRelative,
      testCaseId: testCase.testCaseId, module: testCase.module,
      worksheet: testCase.source.worksheet, scenario: testCase.scenario, priority: testCase.priority,
      mode: 'spec:new', model: 'none (deterministic)',
      startedAt: new Date(startedMs).toISOString(), finishedAt: new Date().toISOString(),
      totalMs: Date.now() - startedMs,
      agentMs: 0, agentNonBrowserMs: 0, browserOpenMs: null,
      explorationWallMs: null, explorationBusyMs: null,
      authMs: null, repoDiscoveryMs: null, generationMs: 0,
      gate: {
        staticMs: null, cleanRunMs: null, mutationRunMs: null,
        cleanStatus: undefined, mutatedStatus: undefined, mutationsApplied: 0,
      },
      status: 'declined', agentExitCode: 0, agentTimedOut: false,
      browserExplorations: 0, browseCommands: 0, browseByCommand: {}, browseRefused: 0,
      snapshots: { commands: 0, filesWritten: 0, duplicateFiles: 0 },
      screenshots: { commands: 0, filesWritten: 0 },
      cache: { hit: false, missReason: 'new' },
      session: null,
      recorded: result.metrics,
      context: {
        promptChars: 0, promptTokensApprox: 0, testCaseTokens: 0, briefTokens: 0,
        frameworkIndexTokens: 0, specExcerptTokens: 0, instructionTokens: 0,
        directedReadTokens: 0, autoLoadedTokens: 0, controlledTokens: 0, totalContextTokens: 0,
        budgetTokens: 0, overBudget: false, selectedFiles: [],
        pageKnowledgeTokens: 0, pageKnowledgeFiles: [], pageKnowledgeHit: false,
        pageKnowledgeVerdict: 'sufficient', pageKnowledgeMissReason: 'not consulted - no assertion to build on',
        browserExplorationRequired: false, pageKnowledgeDecisions: [],
        browser: {
          browserOpenRequired: false, browserOpened: false, partialWithoutBrowser: false,
          unnecessaryBrowserOpenAvoided: true, dismissedGaps: [], inspectableGaps: [],
          reason: 'recorded: no assertion, so nothing was generated and no browser was needed',
        },
        canonicalPageId: '', canonicalPageFile: '', rescuedKnowledgeFiles: [], knowledgeDuplicates: 0,
        requirements: null,
        agentOutputChars: 0, modelInputTokens: null, modelOutputTokens: null, modelCostUsd: null,
      },
      failureClass: metrics.classifyRecordedFailure({
        block: result.block, orderReconstructed: result.metrics.orderReconstructed, reason: result.reason,
      }),
      failureReason: result.reason,
    });

    /**
     * Generate one case against its group's browser.
     *
     * Extracted from the loop because the loop is two deep now - groups, then the
     * rows inside one - and a hundred and eighty lines at that indentation is not
     * readable. `continue` became `return`; nothing else about the body changed.
     */
    const runCase = async (
      item: typeof survey.work[number],
      group: Group,
      session: GroupSession,
    ): Promise<void> => {
      const testCase = item.testCase;
      const started = Date.now();
      const specFile = specPathFor(testCase.module, testCase.source.worksheet);
      // Which of the two the recorded branch below writes; the agent path keeps
      // `specFile` whether the row was recorded or not, because a fallback to the
      // agent is the ordinary generator doing its ordinary thing.
      const recordedSpecFile = recordedSpecPathFor(testCase.testCaseId);
      const isRecorded = isRecordedTags(testCase.tags);
      fs.mkdirSync(generatedDir(), { recursive: true });
      // THE SPEC'S IMPORT TARGET IS AN OUTPUT DESTINATION TOO. Every generated spec
      // imports this application's fixtures module unconditionally, so it has to exist by
      // the time one is written - and it is NOT created by writing a Page Object, because
      // a run can legitimately create none. Flipkart's TC_SMOKE_004 assembled from its
      // recording with all five elements correctly refused, and was then quarantined at
      // collection with `Cannot find module '../../flipkart.fixtures'`.
      const fixturesModule = ensureFixturesModule();
      if (fixturesModule.created) {
        const shown = path.relative(ROOT, fixturesModule.file).split(path.sep).join('/');
        log(`  created ${shown} - this application had no fixtures module yet\n`);
      }

      log(`\n=== ${testCase.testCaseId} (${item.reason}) ${testCase.scenario}\n`);
      if (item.staleReason)
        log(`  ${item.staleReason}\n`);
      log(`  writing ${isRecorded ? recordedSpecFile : specFile}\n`);

      const before = fs.existsSync(path.resolve(ROOT, specFile))
        ? fs.readFileSync(path.resolve(ROOT, specFile), 'utf8')
        : null;

      // Declared before the recorded branch below, which assigns them. They used to
      // live just under the `generate()` call, and the recorded branch assigning them
      // above their own `let` was a temporal-dead-zone crash - the gate ran, the spec
      // was written, and then the run died before recording any outcome. Found by a
      // case that produced a spec and no verdict.
      let gateResult: GateResult | undefined;
      let wroteSpec = false;

      /**
       * The bookkeeping half of `record()`, without the agent half.
       *
       * `record()` finishes by calling `recordAttempt(outcome, agent, …)`, and `agent`
       * does not exist on the recorded path - reading it from there was a second
       * temporal-dead-zone crash, which wrote the metrics and then died before
       * `state.json`, leaving a case that had passed the gate with no verdict at all.
       *
       * So the recorded branch does the outcome, the state and the log here, and its
       * own `recordRecorded()` writes its own measurements. Same effects, no shared
       * variable that only one path can see.
       */
      const recordOutcomeOnly = (verdict: Verdict, reason: string, extra: Partial<CaseOutcome> = {}) => {
        const outcome: CaseOutcome = {
          testCaseId: testCase.testCaseId, scenario: testCase.scenario, verdict, reason,
          durationMs: Date.now() - started, ...extra,
        };
        base.outcomes.push(outcome);
        // Not the run's model: no model wrote this one. Recording the configured model
        // here would put a name against work it did not do, and `state.json` is read
        // later to explain why a batch of specs came out the way it did.
        state[stateKeyFor(testCase.testCaseId)] = nextState(state[stateKeyFor(testCase.testCaseId)], item.fingerprint,
            outcome, 'none (deterministic mapping)');
        writeState(state);
        log(`  ${verdict.toUpperCase()}: ${reason}\n`);
      };

      // ---- The recorded pipeline, tried FIRST and only for a recorded row.
      //
      // Playwright Codegen already watched somebody use the application. If every
      // recorded action maps onto an existing Page Object method, the spec is
      // assembled from that mapping - no browser, no exploration, no model call -
      // and then goes through the SAME quality gate as everything else. If anything
      // cannot be mapped confidently it falls through to the existing path below,
      // so a mapping failure costs a fallback rather than a wrong spec.
      let recordedResult: RecordedGeneration | null = null;
      /**
       * What the resolver spent on THIS case, held where `recordAttempt` can read it.
       *
       * The pass is scoped to the recorded branch; the metrics record is written for every
       * branch, and a cost that only some records can carry is a cost nobody can compare.
       */
      let semanticSpend: metrics.SemanticSpend | null = null;
      if (isRecorded) {
        // FIRST, not afterwards. Any Page Object this recording proves and does not
        // already have is created here, so the mapping below can reuse it.
        const pass = await ensurePageObjects(testCase.testCaseId, options, log);
        semanticSpend = pass.semantic;
        recordedResult = generateFromRecording(testCase, recordedSpecFile, workbookRelative);
        log(describeMapping(recordedResult));

        // THE LIFECYCLE JOIN, and the reason the pass above returns anything at all.
        //
        // It can only run here: the decisions were made before the spec was assembled,
        // and the mapping that says which elements ended up needing a Page Object only
        // exists after. Joining the two is what turns "5 step(s) use the recorded
        // locator directly" into five named decisions with a reason and a remedy each.
        //
        // Wrapped, because a report must never be able to fail a generation.
        try {
          if (recordedResult.mapping) {
            const decisions = decideLifecycle({
              testCaseId: testCase.testCaseId,
              generationId: runId,
              timestamp: new Date().toISOString(),
              mapping: recordedResult.mapping,
              proposals: pass.proposals,
              unmeasured: pass.unmeasured,
              writes: pass.writes,
            });
            appendLifecycleLog(decisions);
            log(describeLifecycle(decisions));
            const totals = summarise(decisions);
            log(`  page objects: ${totals.byDisposition.EXISTING_PO_REUSED} reused, `
              + `${totals.byDisposition.PO_CREATED_DETERMINISTICALLY} created deterministically, `
              + `${totals.byDisposition.PO_CREATED_BY_AI + totals.byDisposition.AI_REPAIRED_AND_ACCEPTED}`
              + ` created by resolver, ${totals.withoutPageObject} refused\n`);
          }
        } catch (error) {
          log(`  page-object lifecycle: not recorded - ${(error as Error).message}\n`);
        }
      }

      // A recording with nothing asserted stops here. It is not quarantined - no spec
      // was written, so there is nothing to quarantine - and it is emphatically not
      // sent to the agent: the row's Expected Result is the "Needs confirmation"
      // placeholder, and asking a model to write a test against a placeholder is
      // asking it to invent the acceptance criteria. It declined both times it was
      // asked. Nothing is written to state either, so confirming the row and saving
      // is all it takes to try again.
      // A locator the quality engine refused. Same treatment as no-assertion, and for
      // the same reason: nothing was assembled, so there is nothing to quarantine and
      // no gate run to spend. The recording is kept, and the reason names the element
      // and the rules that fired - `#tc_summary_636432` is one issue's id, not a
      // selector, and no amount of re-running will make it resolve twice.
      if (recordedResult?.block === 'needsReview') {
        base.skipped.push({ testCaseId: testCase.testCaseId,
          reason: `recorded locator needs review - ${recordedResult.reason}` });
        recordRecordedBlocked(testCase, recordedResult, started);
        log(`  SKIPPED: ${recordedResult.reason}
`);
        log('  nothing was written and no model was called; the recording is kept at '
          + `ai/dashboard/recordings/${testCase.testCaseId}.spec.ts
`);
        return;
      }

      if (recordedResult?.block === 'noAssertion') {
        base.skipped.push({ testCaseId: testCase.testCaseId,
          reason: 'recorded test has no assertion - confirm the Expected Result on the row, '
            + 'or re-record it with the check you want made' });
        recordRecordedBlocked(testCase, recordedResult, started);
        log('  SKIPPED: recorded test has no assertion (Needs Confirmation - no spec written, '
          + 'no model called, artifact kept)\n');
        return;
      }

      if (recordedResult?.assembled) {
        // A case that was generated into a shared file before it owned one leaves
        // its old test behind, and two tests with the same title would both match
        // the runner's --grep. Said, never cut out with a regex: that is how the
        // tests that were fine get corrupted.
        warnOnDuplicate(item.previousSpec, recordedSpecFile, testCase.testCaseId, log);

        const verdict = gate(recordedSpecFile, testCase.testCaseId, testCase.scenario, workbookRelative, log);
        gateResult = verdict;
        wroteSpec = true;

        if (verdict.verdict === 'accepted') {
          upsertEntry(mapping, testCase.testCaseId, {
            testFile: recordedSpecFile,
            testName: `${testCase.testCaseId} - ${testCase.scenario}`,
            module: testCase.module,
            scenario: testCase.scenario,
            // Generated, never Automated - identical to the AI path. Assembling a
            // spec deterministically is not the same as earning a green suite run.
            status: 'Generated',
            sourceWorkbook: parsed.workbook,
            sourceWorksheet: testCase.source.worksheet,
            sourceRow: testCase.source.row,
          }, new Date().toISOString());
          writeMapping(mapping, activeMappingFile());
          recordRecorded(testCase, 'accepted', verdict.reason, recordedResult, started, verdict);
          recordOutcomeOnly('accepted', verdict.reason, { specFile: recordedSpecFile });
          // Only now. The recording has produced a spec that passed the gate, so the
          // evidence has done its job; on any other verdict it is what somebody needs
          // to read next.
          acceptRecording(testCase.testCaseId);
          return;
        }

        const kept = quarantine(recordedSpecFile, testCase.testCaseId);
        retractSpec(recordedSpecFile, testCase.testCaseId, log);
        recordRecorded(testCase, 'quarantined', verdict.reason, recordedResult, started, verdict);
        recordOutcomeOnly('quarantined', verdict.reason, { quarantinedTo: kept });
        if (!recordedResult.metrics.orderReconstructed) {
          log('  NOTE: this recording had no assertion positions, so its assertions ran after '
            + 'every action rather than where they were made. Treat this failure as a '
            + 'reconstruction defect first (RECORDED_ASSEMBLY_ERROR) - re-record the case '
            + 'before concluding the test is wrong. The recording has been kept.\n');
        } else {
          log(`  the recording has been kept at ai/dashboard/recordings/${testCase.testCaseId}.spec.ts `
            + 'for diagnosis.\n');
        }
        return;
      }

      if (recordedResult) {
        log('  recorded pipeline could not assemble a spec - falling back to the existing '
          + `generator, which writes ${specFile} (and still opens no browser for a `
          + 'recorded row)\n');
      }

      let agent: Awaited<ReturnType<typeof generate>>;
      try {
        agent = await generate({
          testCase, specFile, workbook: workbookRelative, replacing: item.previousSpec, runId,
        }, {
          onLog: log,
          // Called only if page knowledge did not cover the row. Page knowledge
          // stays the first optimisation - a session being available is not a
          // reason to open one.
          //
          // Always passed, whatever the session lifetime: the framework owns the
          // sign-in now that `.env` is denied to the agent, so an authenticated row
          // has no other route to credentials.
          ensureSession: () => session.ensure(),
        });
      } catch (error) {
        if (!(error instanceof SessionUnavailable))
          throw error;
        // NOT a verdict about the row. The browser or the sign-in failed, so this
        // case was never attempted: it is skipped, no state is written, and the
        // attempt budget is untouched. Recording it as a failure would let an
        // outage lock a perfectly good row out after two runs.
        const reason = `the generation browser could not be prepared - ${error.message}`;
        sessions.unavailable += 1;
        base.skipped.push({ testCaseId: testCase.testCaseId, reason });
        // The census was computed before generation started; this skip is
        // discovered during it, so the same object is corrected in place.
        routing.skipped += 1;
        routing.skippedByReason.infrastructure = (routing.skippedByReason.infrastructure ?? 0) + 1;
        log(`  SKIPPED: ${reason}\n`);
        return;
      }

      // (`gateResult` and `wroteSpec` are declared above the recorded branch, which
      // also assigns them. Both are read at record() time either way.)

      const record = (verdict: Verdict, reason: string, extra: Partial<CaseOutcome> = {}) => {
        const outcome: CaseOutcome = {
          testCaseId: testCase.testCaseId, scenario: testCase.scenario, verdict, reason,
          durationMs: Date.now() - started, ...extra,
        };
        base.outcomes.push(outcome);
        state[stateKeyFor(testCase.testCaseId)] = nextState(state[stateKeyFor(testCase.testCaseId)], item.fingerprint, outcome, model);
        writeState(state);
        log(`  ${verdict.toUpperCase()}: ${reason}\n`);
        recordAttempt(outcome, agent, gateResult, wroteSpec);
      };

      /**
       * The same outcome, persisted with its measurements.
       *
       * Deliberately the last thing record() does: an outcome must be in
       * state.json and visible in the log even if telemetry cannot be written.
       *
       * A function declaration rather than a const so it hoists above the
       * record() that calls it, instead of relying on call order.
       */
      function recordAttempt(
        outcome: CaseOutcome,
        agentResult: typeof agent,
        gateDetail: GateResult | undefined,
        wrote: boolean,
      ) {
        const browse = metrics.summariseBrowse(runId, testCase.testCaseId);
        const agentFromMs = Date.parse(agentResult.startedAt);
        const agentToMs = Date.parse(agentResult.finishedAt);
        const artefacts = metrics.countArtefacts(agentFromMs, agentToMs);
        const budget = agentResult.budget;

        metrics.append({
          kind: 'attempt', schema: metrics.SCHEMA, runId, workbook: workbookRelative,

          testCaseId: testCase.testCaseId,
          module: testCase.module,
          worksheet: testCase.source.worksheet,
          scenario: testCase.scenario,
          priority: testCase.priority,

          mode: item.reason === 'stale' ? 'spec:stale' : 'spec:new',
          model,

          startedAt: new Date(started).toISOString(),
          finishedAt: new Date().toISOString(),
          totalMs: outcome.durationMs,
          agentMs: agentResult.durationMs,
          agentNonBrowserMs: browse.explorationWallMs === null
            ? null
            : Math.max(0, agentResult.durationMs - browse.explorationWallMs),
          browserOpenMs: browse.browserOpenMs,
          explorationWallMs: browse.explorationWallMs,
          explorationBusyMs: browse.commands ? browse.explorationBusyMs : null,

          authMs: null,
          repoDiscoveryMs: null,
          generationMs: null,

          semantic: semanticSpend,
          gate: gateDetail
            ? {
              staticMs: gateDetail.detail.staticMs ?? null,
              cleanRunMs: gateDetail.detail.cleanRunMs ?? null,
              mutationRunMs: gateDetail.detail.mutationRunMs ?? null,
              cleanStatus: gateDetail.detail.cleanStatus,
              mutatedStatus: gateDetail.detail.mutatedStatus,
              mutationsApplied: gateDetail.detail.mutationsApplied.length,
            }
            : null,

          status: outcome.verdict,
          agentExitCode: agentResult.exitCode,
          agentTimedOut: agentResult.timedOut,

          browserExplorations: browse.explorations,
          browseCommands: browse.commands,
          browseByCommand: browse.byCommand,
          browseRefused: browse.refused,
          snapshots: {
            commands: browse.snapshotCommands,
            filesWritten: artefacts.snapshotFilesWritten,
            duplicateFiles: artefacts.duplicateSnapshotFiles,
          },
          screenshots: {
            commands: browse.screenshotCommands,
            filesWritten: artefacts.screenshotFilesWritten,
          },

          cache: { hit: false, missReason: item.reason },

          // Null when this case needed no browser: page knowledge answered it and
          // no session was ever opened for it.
          session: agentResult.handover
            ? {
              browserSessionId: agentResult.handover.sessionId,
              browserSessionReuse: agentResult.handover.reused,
              browserStartupMs: agentResult.handover.startupMs,
              authenticationAttempts: agentResult.handover.authenticationAttempts,
              authenticationReuse: agentResult.handover.authenticationReuse,
              authenticationMs: agentResult.handover.authMs,
              browserShutdownMs: agentResult.handover.shutdownMs,
              sessionsDiscarded: agentResult.handover.sessionsDiscarded,
              sessionContaminated: agentResult.handover.contaminated,
              // Contaminated but not discarded means the declared reset worked.
              sessionReset: agentResult.handover.contaminated
                && agentResult.handover.sessionsDiscarded === 0,
              resetActions: agentResult.handover.resetActions,
              groupKey: group.key,
              groupSize: group.items.length,
              // The metric records what the BROWSER did, which is the second
              // question. Field name unchanged: the meaning is what it always was.
              authRequired: group.explorationNeedsAuth,
            }
            : null,

          context: {
            promptChars: agentResult.promptChars,
            promptTokensApprox: metrics.approxTokens(agentResult.promptChars),
            testCaseTokens: budget.testCaseTokens,
            briefTokens: budget.briefTokens,
            frameworkIndexTokens: budget.frameworkIndexTokens,
            specExcerptTokens: budget.specExcerptTokens,
            instructionTokens: budget.instructionTokens,
            directedReadTokens: budget.directedReadTokens,
            autoLoadedTokens: budget.autoLoadedTokens,
            controlledTokens: budget.controlledTokens,
            totalContextTokens: budget.totalContextTokens,
            budgetTokens: budget.budgetTokens,
            overBudget: budget.overBudget,
            selectedFiles: agentResult.selectedFiles,
            pageKnowledgeTokens: budget.pageKnowledgeTokens,
            pageKnowledgeFiles: agentResult.pageKnowledgeFiles,
            pageKnowledgeHit: agentResult.sufficiency.verdict === 'sufficient',
            pageKnowledgeVerdict: agentResult.sufficiency.verdict,
            pageKnowledgeMissReason: agentResult.sufficiency.reason,
            browserExplorationRequired: agentResult.sufficiency.verdict !== 'sufficient',

            browser: {
              browserOpenRequired: agentResult.browserNeed.required,
              browserOpened: Boolean(agentResult.handover),
              partialWithoutBrowser: agentResult.sufficiency.verdict === 'partial'
                && !agentResult.browserNeed.required,
              // What Phase 4 would have opened and Phase 4B did not.
              unnecessaryBrowserOpenAvoided: agentResult.sufficiency.verdict !== 'sufficient'
                && !agentResult.browserNeed.required,
              dismissedGaps: agentResult.browserNeed.dismissed,
              inspectableGaps: agentResult.browserNeed.inspectable,
              reason: agentResult.browserNeed.reason,
            },
            canonicalPageId: agentResult.canonicalPage.id,
            canonicalPageFile: agentResult.canonicalPage.file,
            rescuedKnowledgeFiles: agentResult.rescuedKnowledge,
            knowledgeDuplicates: agentResult.knowledgeDuplicates,
            pageKnowledgeDecisions: agentResult.sufficiency.decisions.map(decision => ({
              requirement: decision.requirement,
              matched: decision.matched,
              matchType: decision.matchType,
              matchedKnowledge: decision.matchedKnowledge,
              confidence: decision.confidence,
              reason: decision.reason,
            })),
            requirements: agentResult.sufficiency.requirements?.counts ?? null,
            agentOutputChars: agentResult.log.length,
            modelInputTokens: null,
            modelOutputTokens: null,
            modelCostUsd: null,
          },

          failureClass: metrics.classifyOutcome(outcome.verdict, outcome.reason,
              { timedOut: agentResult.timedOut, wroteSpec: wrote }),
          failureReason: outcome.verdict === 'accepted' ? '' : outcome.reason,

          ...(outcome.specFile ? { specFile: outcome.specFile } : {}),
          ...(outcome.quarantinedTo ? { quarantinedTo: outcome.quarantinedTo } : {}),
        });
      };

      if (agent.timedOut) {
        record('failed', 'The generator hit its time limit and was stopped.');
        return;
      }

      const wrote = fs.existsSync(path.resolve(ROOT, specFile))
        && fs.readFileSync(path.resolve(ROOT, specFile), 'utf8') !== before;
      wroteSpec = wrote;

      if (!wrote) {
        record(declined(testCase.testCaseId) ? 'declined' : 'failed',
            declined(testCase.testCaseId)
              ? 'The generator declined this case and recorded what it needs in ' +
                'ai/reports/test-case-change-requests.md.'
              : `No spec was written and no reason was recorded (claude exited ${agent.exitCode}).`);
        return;
      }

      const verdict = gate(specFile, testCase.testCaseId, testCase.scenario, workbookRelative, log);
      gateResult = verdict;

      if (verdict.verdict === 'accepted') {
        upsertEntry(mapping, testCase.testCaseId, {
          testFile: specFile,
          testName: `${testCase.testCaseId} - ${testCase.scenario}`,
          module: testCase.module,
          scenario: testCase.scenario,
          // Generated, never Automated. That is earned by a green run of the
          // real suite, not by the thing that wrote the code.
          status: 'Generated',
          sourceWorkbook: parsed.workbook,
          sourceWorksheet: testCase.source.worksheet,
          sourceRow: testCase.source.row,
        }, new Date().toISOString());
        writeMapping(mapping, activeMappingFile());
        record('accepted', verdict.reason, { specFile });
        return;
      }

      const kept = quarantine(specFile, testCase.testCaseId);
      retractSpec(specFile, testCase.testCaseId, log);
      record('quarantined', verdict.reason, { quarantinedTo: kept });
    };

    for (const group of groups) {
      const session = new GroupSession({ runId, group, onLog: log });
      log(`\n--- group: ${group.worksheet} — ${group.items.length} row(s), ` +
        `exploration browser ${group.explorationNeedsAuth
          ? `signed in once for all of them as ${group.authIdentity}` : 'signed out'}\n`);
      try {
        for (const item of group.items) {
          await runCase(item, group, session);
          // One case per browser when the lifetime is switched down. The framework
          // still opened and signed in this browser; it just does not survive to
          // the next row. This is the "before" half of the benchmark.
          if (!persistentSessionEnabled())
            await session.close();
        }
      } finally {
        // Always, including when a case threw: a group must not leave a browser
        // running for nobody, and the session lifetime is exactly this group.
        await session.close();
        const stats = session.summary();
        sessions.groups.push({
          key: group.key,
          size: group.items.length,
          authRequired: group.explorationNeedsAuth,
          browsersOpened: stats.browsersOpened,
          authentications: stats.authentications,
          reuseCount: stats.reuseCount,
          discarded: stats.discarded,
          shutdownMs: stats.shutdownMs,
        });
        sessions.browsersOpened += stats.browsersOpened;
        sessions.authentications += stats.authentications;
        sessions.reuseCount += stats.reuseCount;
        sessions.discarded += stats.discarded;
        if (stats.browsersOpened) {
          log(`  group done: ${stats.browsersOpened} browser(s), ${stats.authentications} sign-in(s), ` +
            `${stats.reuseCount} case(s) reused a running browser` +
            `${stats.discarded ? `, ${stats.discarded} session(s) discarded` : ''}\n`);
        }
      }
    }

    recordRun('completed', routing, base.outcomes.length);
    return { ...base, finishedAt: new Date().toISOString() };
  } catch (error) {
    // Recorded then rethrown, unchanged: a run that died is exactly the run a
    // benchmark must not silently omit.
    recordRun('crashed', routingSoFar, base.outcomes.length, (error as Error).message);
    throw error;
  } finally {
    if (!options.dryRun)
      releaseLock();
  }
}

function nextState(previous: StateEntry | undefined, print: string, outcome: CaseOutcome, model: string): StateEntry {
  const framework = frameworkFingerprint();
  // Attempts count only against an unchanged row AND an unchanged framework. Editing
  // the row is the author saying "try again"; changing the framework is the project
  // saying it. Either one starts the budget over, so a case reopened by a framework
  // fix gets its own MAX_ATTEMPTS rather than one final try.
  const unchanged = previous?.fingerprint === print && previous?.framework === framework;
  return {
    fingerprint: print,
    verdict: outcome.verdict,
    specFile: outcome.specFile ?? (outcome.verdict === 'accepted' ? previous?.specFile : undefined),
    reason: outcome.reason,
    model,
    at: new Date().toISOString(),
    attempts: outcome.verdict === 'accepted' ? 0 : (unchanged ? (previous?.attempts ?? 0) + 1 : 1),
    framework,
  };
}

/** Append a human-readable record of the run. */
export function appendLog(result: AutocodeResult): void {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const lines: string[] = [];
  if (!fs.existsSync(LOG_FILE)) {
    lines.push('# Autocode log', '',
        'Written by `npm run excel:autocode`. Every generated spec is listed with the ',
        'verdict of the falsification gate: `accepted` passed as written and failed with its ',
        'assertions broken; `quarantined` could not show it was checking anything.', '');
  }
  lines.push(`## ${result.startedAt} — \`${result.workbook}\`${result.model ? ` — model \`${result.model}\`` : ''}`, '');
  if (result.blocked) {
    lines.push(`Not started: ${result.blocked}`, '');
  } else if (!result.outcomes.length) {
    lines.push('Nothing needed generating.', '');
  } else {
    lines.push('| Test case | Verdict | Took | Where | Why |', '| --- | --- | --- | --- | --- |');
    for (const outcome of result.outcomes) {
      const where = outcome.specFile ?? outcome.quarantinedTo ?? '—';
      // durationMs has always been computed here and never written down. The
      // Phase 1 baseline had to recover these by subtracting state.json from a
      // markdown heading, which is what the metrics file now makes unnecessary.
      const took = `${(outcome.durationMs / 1000).toFixed(0)}s`;
      lines.push(`| ${outcome.testCaseId} | ${outcome.verdict} | ${took} | \`${where}\` | ` +
        `${outcome.reason.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
  }
  if (result.runId)
    lines.push(`Metrics: \`${path.relative(ROOT, metrics.METRICS_FILE).replace(/\\/g, '/')}\` run \`${result.runId}\``, '');
  if (result.skipped.length) {
    lines.push('<details><summary>Skipped</summary>', '');
    for (const skip of result.skipped)
      lines.push(`- **${skip.testCaseId}** — ${skip.reason}`);
    lines.push('', '</details>', '');
  }
  fs.appendFileSync(LOG_FILE, `${lines.join('\n')}\n`, 'utf8');
}
