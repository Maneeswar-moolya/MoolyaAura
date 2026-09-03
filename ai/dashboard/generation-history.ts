/**
 * The last five generations, kept on disk so the Generation tab is not amnesiac.
 *
 *   npx tsx ai/dashboard/generation-history.fixture.ts
 *
 * WHAT THIS EXISTS FOR. The Generation tab was live-only: the generator's stdout was
 * streamed over SSE and held in one array in the server process. Closing the tab,
 * reloading it, or restarting the dashboard lost every word of it - including the run
 * that had just quarantined a spec, which is precisely the run somebody comes back to
 * read. The evidence existed for the length of one page view and was then unreachable.
 *
 * FIVE, AND ONLY EVER FIVE. This is a HARD CAP, not a default: a sixth generation
 * evicts the oldest. The store is a window onto the recent past, not an archive - a
 * generation record carries the whole captured log plus every Page Object decision,
 * and an unbounded store of those is a directory nobody prunes and everybody forgets.
 * `ai/dashboard/runs/` is the EXECUTION store and is deliberately unbounded; this is a
 * separate directory for a separate thing and neither one prunes the other.
 *
 * PRUNING HAPPENS ON WRITE. A reader that trimmed to five would leave the sixth file
 * on disk and merely stop mentioning it - the cap would be a display convention rather
 * than a fact, and the directory would grow forever behind a table that said it had not.
 * So `saveGeneration` deletes, `listGenerations` shows whatever it finds, and a pruning
 * failure is therefore visible rather than hidden.
 *
 * THE VOCABULARY IS OPEN AND IS NOT OURS. A status here is the generator's own word,
 * uppercased - `accepted` / `quarantined` / `declined` / `failed` are the four
 * `Verdict` values in `ai/autocode/work.ts`, and ACCEPTED / REJECTED / QUARANTINED /
 * FAILED / PASSED / GENERATED all round-trip unchanged. Nothing here translates one
 * word into another: a second taxonomy is a second thing that can disagree with the
 * pipeline about what happened, and the pipeline is the one that was there.
 */

import * as fs from 'fs';
import * as path from 'path';

import { LIFECYCLE_LOG, readLifecycleLog, type LifecycleDecision } from '../autocode/abstraction/lifecycle';

const ROOT = process.cwd();

/**
 * Its own directory, git-ignored, never `ai/dashboard/runs/`.
 *
 * A generation is not an execution: it has no browser, no results file, no evidence
 * and no Playwright report, and the runs store is unbounded on purpose. Sharing the
 * directory would mean this cap silently deleted somebody's execution history.
 */
export const GENERATIONS_DIR = path.join(ROOT, 'ai', 'dashboard', 'generations');

/** The hard cap. A sixth generation evicts the oldest. */
export const HISTORY_LIMIT = 5;

/**
 * The line `ai/autocode/cli.ts` prints so a dashboard-started generation can be tied
 * to its own records.
 *
 * WHY SCRAPING AT ALL. The runId is minted inside `orchestrate.run()` and reaches the
 * outside world in exactly two places: `appendLog`, which writes it into
 * `ai/reports/autocode-log.md` (a file, not stdout), and the metrics NDJSON. The
 * dashboard spawns the CLI and sees only its stdout, so before this line existed the
 * runId was simply not knowable from here - and the alternative, correlating the
 * metrics file by timestamp, is the mis-attribution `ai/autocode/metrics.ts` already
 * refuses for `browse.mjs`.
 *
 * THIS STRING IS MIRRORED IN `ai/autocode/cli.ts` AND THE TWO MUST AGREE. The
 * generator must not import from the dashboard - the dependency runs the other way -
 * so the fixture reads `cli.ts` and checks the line it prints parses here, exactly as
 * `recorder.fixture.ts` checks the HTML it cannot import.
 */
export const RUN_ID_MARKER = 'autocode run id: ';

/**
 * The marker line, with the runId's own shape required.
 *
 * The log carries workbook prose - scenario titles are printed verbatim - so a cell
 * could contain a line that starts with the marker. Requiring `newRunId()`'s shape
 * (ISO timestamp with the punctuation replaced, plus a random suffix) means a forged
 * line has to look exactly like a run id before it is read as one.
 */
const RUN_ID_LINE = new RegExp(`^${RUN_ID_MARKER}(\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z-[a-z0-9]+)\\s*$`, 'gm');

/** `=== TC_LOGIN_022 (new) Sign in with a valid account` */
const CASE_HEADING = /^=== (\S+) \((.*?)\)\s?(.*)$/;

/** `  ACCEPTED: passed as written and failed with its assertions broken` */
const VERDICT_LINE = /^ {2}([A-Z][A-Z_]{2,}): ?(.*)$/;

/**
 * Framework lines that share the verdict's shape and are not verdicts.
 *
 * `NOTE:` is printed by `agent.ts` when a case is over the context budget. It always
 * precedes the real verdict, so last-wins already ignores it - except in a run that was
 * killed in the middle of that case, where it would otherwise be recorded as what
 * became of the row. A status is a decision somebody made; this is a remark.
 */
const NOT_A_VERDICT: ReadonlySet<string> = new Set(['NOTE']);

/**
 * What became of a generation, in the generator's own word.
 *
 * Deliberately a string rather than a union: the words come from the pipeline and the
 * pipeline is free to add one. A closed union here would mean a new verdict arriving as
 * a type error in the dashboard - or worse, being quietly mapped onto the nearest word
 * this file already knew.
 */
export type GenerationStatus = string;

/**
 * Run-level precedence, worst first.
 *
 * A single column can only show one word, and the useful one is whatever needs a
 * person: a run of three accepted specs and one quarantine is a run with a quarantine
 * in it. SKIPPED ranks last on purpose - it is the answer only when nothing else
 * happened at all, and ranking it above ACCEPTED would report a successful run as a
 * skipped one because one row of it was ineligible.
 */
const STATUS_PRECEDENCE: readonly GenerationStatus[] = [
  'FAILED', 'QUARANTINED', 'REJECTED', 'DECLINED', 'ACCEPTED', 'PASSED', 'GENERATED', 'SKIPPED',
];

/** One row the generator reported on, with the verdict it gave that row. */
export interface GenerationCase {
  testCaseId: string;
  /** The scenario title, as the generator printed it. */
  scenario: string;
  status: GenerationStatus;
  reason: string;
}

/** One generation, with everything needed to inspect it after the tab was closed. */
export interface GenerationRecord {
  /** Allocated here, sortable, and the file name. Never the autocode runId. */
  id: string;
  /**
   * The generator's own run identifier, which is what joins this record to
   * `ai/reports/page-object-lifecycle.jsonl` and `generation-metrics.jsonl`.
   * Null when the generator never printed one - a killed run, or an older CLI.
   */
  runId: string | null;
  workbook: string;
  /** The ids the dashboard asked for. Empty means "whatever needs code". */
  requestedIds: string[];
  /** The rows the generator actually reported on, in the order it reported them. */
  cases: GenerationCase[];
  status: GenerationStatus;
  startedAt: string;
  finishedAt: string;
  /** Null when the child was killed by a signal rather than exiting. */
  exitCode: number | null;
  /** Everything the generator wrote, exactly as the live tab showed it. */
  log: string;
  /** Every per-element Page Object decision this generation recorded. */
  lifecycle: LifecycleDecision[];
}

/** A history row: enough for the table, without the log or the decisions. */
export interface GenerationSummary {
  id: string;
  runId: string | null;
  workbook: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  status: GenerationStatus;
  testCaseIds: string[];
  scenario: string;
  caseCount: number;
  lifecycleCount: number;
}

/**
 * A sortable id with a random tail.
 *
 * The timestamp is fixed-width, so lexicographic order IS chronological order - which
 * is what lets the prune below decide "oldest" from the file name alone, the same
 * assumption `listRuns()` already makes about the run store. The suffix exists because
 * two ids minted in one millisecond would otherwise be one id, and the second record
 * would silently overwrite the first.
 */
export function newGenerationId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Read the generator's own output. Nothing here is inferred, timed or guessed.
 *
 * The verdict taken for a case is the LAST one in its block, because the agent's raw
 * stdout is streamed into the same log between the heading and the verdict: the
 * orchestrator prints its decision after the agent has finished, so a model that
 * happened to write an indented capitalised word cannot displace it. A case with no
 * verdict at all is `UNREPORTED` - the generator started that row and never said what
 * became of it, which is a killed run and not a verdict anybody gave.
 */
export function parseGenerationLog(text: string): { runId: string | null; cases: GenerationCase[] } {
  let runId: string | null = null;
  RUN_ID_LINE.lastIndex = 0;
  for (let match = RUN_ID_LINE.exec(text); match; match = RUN_ID_LINE.exec(text))
    runId = match[1];

  const cases: GenerationCase[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const heading = CASE_HEADING.exec(line);
    if (heading) {
      cases.push({
        testCaseId: heading[1], scenario: heading[3].trim(), status: 'UNREPORTED', reason: '',
      });
      continue;
    }
    const verdict = VERDICT_LINE.exec(line);
    if (!verdict || !cases.length || NOT_A_VERDICT.has(verdict[1]))
      continue;
    const current = cases[cases.length - 1];
    current.status = verdict[1];
    current.reason = verdict[2].trim();
  }
  return { runId, cases };
}

/**
 * The run-level status, from the generator's own words and its exit code.
 *
 * The exit code comes first because it is the generator's verdict on ITSELF: a process
 * that died after accepting two specs is a failed run, and reporting it as ACCEPTED
 * would hide the death behind the work it managed before it. `null` is a kill signal -
 * the Stop button - and is a failure by the same reasoning.
 */
export function deriveStatus(cases: readonly GenerationCase[], exitCode: number | null): GenerationStatus {
  if (exitCode !== 0)
    return 'FAILED';
  for (const status of STATUS_PRECEDENCE) {
    if (cases.some(one => one.status === status))
      return status;
  }
  // A word this file has never seen is SHOWN, not flattened: the vocabulary is the
  // pipeline's, and "I do not recognise this" is not a reason to report SKIPPED.
  return cases[0]?.status ?? 'SKIPPED';
}

/**
 * Every Page Object decision this generation recorded, joined on the runId.
 *
 * `generationId` in the lifecycle log IS the autocode runId (orchestrate.ts sets it
 * from the same variable), so this is an exact join and never a time window. Read once
 * when the run finishes and stored INTO the record: the log is append-only and shared
 * by every generation, so a record that merely pointed at it would answer differently
 * once five more runs had appended to it - and would answer nothing at all after
 * somebody deleted `ai/reports/`, which is git-ignored and routinely cleared.
 */
export function collectLifecycle(runId: string | null, file = LIFECYCLE_LOG): LifecycleDecision[] {
  if (!runId)
    return [];
  return readLifecycleLog(file).filter(decision => decision.generationId === runId);
}

/** Record files, newest first. The id is the sort key - see `newGenerationId`. */
function ordered(dir: string): string[] {
  if (!fs.existsSync(dir))
    return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().reverse();
}

/**
 * Write one generation and evict anything past the cap.
 *
 * Pruning is here, on the write path, and nowhere else. Returns the ids it deleted so
 * a caller can say so; a delete that fails is swallowed, because a history record that
 * refuses to be written is worse than one stale file.
 */
export function saveGeneration(record: GenerationRecord, dir = GENERATIONS_DIR): { evicted: string[] } {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${path.basename(record.id)}.json`),
      `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const evicted: string[] = [];
  for (const name of ordered(dir).slice(HISTORY_LIMIT)) {
    try {
      fs.rmSync(path.join(dir, name));
      evicted.push(name.replace(/\.json$/, ''));
    } catch {
      // A file somebody has open. It stays, and the next save tries again.
    }
  }
  return { evicted };
}

/**
 * The history table's rows, newest first.
 *
 * Deliberately NOT trimmed to `HISTORY_LIMIT`: the cap is enforced by the writer, and
 * a reader that trimmed as well would make a pruning failure invisible - the table
 * would keep saying five while the directory grew.
 */
export function listGenerations(dir = GENERATIONS_DIR): GenerationSummary[] {
  const summaries: GenerationSummary[] = [];
  for (const name of ordered(dir)) {
    const record = readRecordFile(path.join(dir, name));
    if (!record)
      continue;
    summaries.push({
      id: record.id,
      runId: record.runId ?? null,
      workbook: record.workbook,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      exitCode: record.exitCode ?? null,
      status: record.status,
      // The rows it reported on, falling back to the rows it was asked for: a run
      // that died before its first heading still has to say what it was about.
      testCaseIds: record.cases.length ? record.cases.map(one => one.testCaseId) : record.requestedIds,
      scenario: record.cases[0]?.scenario ?? '',
      caseCount: record.cases.length,
      lifecycleCount: record.lifecycle.length,
    });
  }
  return summaries;
}

/** One record in full, or null. A file that will not parse is not repaired. */
export function readGeneration(id: string, dir = GENERATIONS_DIR): GenerationRecord | null {
  // basename() so a crafted id cannot walk out of the store - the same guard the
  // /api/runs/<id> route applies, applied here as well so it holds for every caller
  // rather than only for the one route that remembered.
  const safe = path.basename(id);
  if (!safe || safe.startsWith('.'))
    return null;
  return readRecordFile(path.join(dir, `${safe}.json`));
}

function readRecordFile(file: string): GenerationRecord | null {
  if (!fs.existsSync(file))
    return null;
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as GenerationRecord;
    // Every field is defaulted rather than assumed: a record written by an older
    // dashboard must still open, and a half-written one must not take the table down.
    return {
      ...record,
      requestedIds: record.requestedIds ?? [],
      cases: record.cases ?? [],
      lifecycle: record.lifecycle ?? [],
      log: record.log ?? '',
    };
  } catch {
    return null;
  }
}
