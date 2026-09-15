/**
 * Persisting the run record that `orchestrate.ts` already builds.
 *
 * This is not a second reporting system. `AutocodeResult`/`CaseOutcome` have
 * always held most of these numbers - `durationMs` is computed on every outcome
 * and then dropped, because `appendLog` only ever wrote the verdict table. The
 * timings in the Phase 1 baseline had to be reconstructed by subtracting
 * `state.json` from a markdown heading, which is not a measurement system.
 *
 * So: the same record, written to disk, as append-only NDJSON next to the
 * markdown log it complements.
 *
 *   ai/reports/generation-metrics.jsonl   one line per run, one per attempt
 *   ai/reports/generation-browse.jsonl    one line per browser command
 *
 * NDJSON rather than a JSON document because appending is the only write: a
 * killed run cannot corrupt earlier records, and a benchmark series is exactly
 * a series. Two record kinds share the file, discriminated by `kind` - a run
 * carries the routing census (which rows never reached the agent, i.e. the cache
 * hits), an attempt carries everything about one case.
 *
 * **Nothing here changes what is generated.** It records durations, counts and
 * sizes around work that already happened.
 *
 * One deliberate omission: the browse log records the *subcommand* and how many
 * arguments it had, never the arguments. `fill e5 "<password>"` must not become a
 * credential in a report, and a URL or a search string comes out of workbook
 * prose. A count is enough for a tool-call metric.
 */

import fs from 'node:fs';
import path from 'node:path';

import { classifyRootCause } from '../excel/results';

const ROOT = process.cwd();
const REPORTS = path.resolve(ROOT, 'ai', 'reports');

export const METRICS_FILE = path.join(REPORTS, 'generation-metrics.jsonl');
export const BROWSE_LOG = path.join(REPORTS, 'generation-browse.jsonl');

/**
 * The framework's own browser commands - opening the group's session and signing
 * it in - kept in a separate file from the agent's.
 *
 * Deliberately not merged into the browse log. That log is the evidence for "the
 * agent opened no browser for this case", and adding the framework's `open` to it
 * would corrupt exactly the measurement Phase 3 established. Same redaction rule
 * applies here and matters more: these commands include the sign-in, so the
 * subcommand and an argument count are recorded and never an argument.
 */
export const SESSION_LOG = path.join(REPORTS, 'generation-session.jsonl');

/**
 * Bumped only if a field changes meaning. Readers should check it.
 *
 * 2 — Phase 2. `context` was restructured: `mandatedReadChars` meant "CLAUDE.md +
 * SKILL.md, which the prompt orders it to read". Neither is read any more (CLAUDE.md
 * arrives automatically, SKILL.md is not this agent's job), so a field with that
 * name would be actively misleading rather than merely absent.
 *
 * 3 — Phase 3. Page knowledge added to `context`. `promptTokens` now includes it, so
 * a schema-2 and a schema-3 prompt total are not the same measurement.
 *
 * 4 — Phase 4. `session` added to an attempt and `sessions` to a run. On a schema-3
 * record every case paid for its own browser and sign-in, so a missing `session`
 * block means "one browser per row", not "not measured".
 *
 * 5 — Phase 4B. `browser` (was the browser needed, was one opened, was an
 * unnecessary open avoided) and `canonicalPageId` added to `context`; `contaminated`
 * / `reset` added to `session`. A schema-4 record opened a browser whenever the
 * knowledge was less than `sufficient`, so `unnecessaryBrowserOpenAvoided` is
 * meaningfully false there rather than absent.
 * 6 — Phase 5. `requirements` added to `context`: what the row was found to require
 * of a screen, by class, and what was dropped as generic prose or as a placeholder. On a
 * schema-5 record every word over three characters was a requirement candidate, so an
 * absent block means "extracted by the old word filter", not "not measured".
 *
 * 7 — Recorded pipeline correction. `pageObjectRequired` and `orderReconstructed`
 * added to `recorded`, and `failureClass` may now carry a `RECORDED_*` code. On a
 * schema-6 record every assertion was appended after every action, so
 * `orderReconstructed` is meaningfully FALSE there rather than absent - which is why
 * it is not defaulted to true when reading an older record back.
 *
 * 8 — Locator quality. `locators` added to `recorded`: what the deterministic engine
 * made of every recorded locator, by outcome and classification. A schema-7 record
 * emitted every unmapped locator verbatim with no judgement at all, so an absent
 * block means "not judged", never "judged and found stable".
 *
 * 9 — P0.7. A candidate measurement now carries WHEN it was taken (press or claim),
 *     WHICH document it was taken in, and whether the single element it matched is
 *     the element the person pressed. In a schema-8 record `derivedCandidates` meant
 *     "matched exactly one element" and nothing more, and a target's `matchCount`
 *     could be a count taken on the page a click had navigated to - so the two are
 *     not the same measurement and must not be compared.
 * 10 — assertion provenance. A target may now be captured at an assertion PICK rather
 *     than at an action, so `captureTiming` has a third value and
 *     `domEvidence.assertionPickCount` counts it - before + after + pick accounts for
 *     every target. A candidate measured at a pick may prove a position for the
 *     assertion that was being made, and only for it; an action still demands a press.
 * 11 - collection is distinguished from execution. `RECORDED_COLLECTION_FAILURE` says
 *     the suite never built, so the spec never ran - previously indistinguishable from
 *     `RECORDED_CLEAN_RUN_FAILURE`, which claims it ran and did not pass. Ten cases were
 *     filed under the wrong one because an undeclared fixture stopped Playwright before
 *     the first line. A schema-10 record reading CLEAN_RUN_FAILURE may therefore be
 *     either, and must not be counted as evidence about a locator.
 */
export const SCHEMA = 11;

/** Where the browser writes its own trail. Read by `summariseBrowse`. */
export const BROWSE_LOG_ENV = 'AUTOCODE_BROWSE_LOG';
export const RUN_ID_ENV = 'AUTOCODE_RUN_ID';
export const CASE_ID_ENV = 'AUTOCODE_CASE_ID';

/** One invocation of `browse.mjs`, as that script records it. */
export interface BrowseCommand {
  runId: string;
  testCaseId: string;
  /** ISO timestamp the command started. */
  at: string;
  ms: number;
  /** The subcommand only - `open`, `snapshot`, `click`. Never the arguments. */
  command: string;
  /** How many arguments it carried. Enough to see effort, carries no content. */
  argc: number;
  exitCode: number | null;
  /** True when browse.mjs refused it, so refusals are visible in the metrics. */
  refused?: boolean;
}

export interface BrowseSummary {
  /** Total browser commands issued for this case. */
  commands: number;
  byCommand: Record<string, number>;
  refused: number;
  /**
   * Distinct browser sessions opened. This is the "number of browser
   * explorations" - it is what a persistent session is meant to drive to 1.
   */
  explorations: number;
  /** Duration of the first `open`. Includes the first navigation, not just launch. */
  browserOpenMs: number | null;
  /** First command start to last command end. Includes the agent's thinking between them. */
  explorationWallMs: number | null;
  /** Sum of command durations - browser time actually spent. */
  explorationBusyMs: number;
  snapshotCommands: number;
  screenshotCommands: number;
}

export function emptyBrowseSummary(): BrowseSummary {
  return {
    commands: 0, byCommand: {}, refused: 0, explorations: 0, browserOpenMs: null,
    explorationWallMs: null, explorationBusyMs: 0, snapshotCommands: 0, screenshotCommands: 0,
  };
}

/** Commands that read a page's structure, for the snapshot count. */
const SNAPSHOT_COMMANDS = new Set(['snapshot', 'find', 'generate-locator']);
const SCREENSHOT_COMMANDS = new Set(['screenshot']);

/**
 * Read back what the browser did for one attempt.
 *
 * Attribution is by run and case ID stamped into each line from the environment,
 * not by timestamp window: the agent is a grandchild process and correlating on
 * time would silently mis-attribute anything that overlapped.
 */
export function summariseBrowse(runId: string, testCaseId: string, file: string = BROWSE_LOG): BrowseSummary {
  const summary = emptyBrowseSummary();
  if (!fs.existsSync(file))
    return summary;

  const mine: BrowseCommand[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim())
      continue;
    try {
      const record = JSON.parse(line) as BrowseCommand;
      if (record.runId === runId && record.testCaseId?.toUpperCase() === testCaseId.toUpperCase())
        mine.push(record);
    } catch {
      // A torn last line from a killed process is not worth failing a run over.
    }
  }
  if (!mine.length)
    return summary;

  summary.commands = mine.length;
  for (const record of mine) {
    summary.byCommand[record.command] = (summary.byCommand[record.command] ?? 0) + 1;
    summary.explorationBusyMs += record.ms;
    if (record.refused)
      summary.refused += 1;
    if (SNAPSHOT_COMMANDS.has(record.command))
      summary.snapshotCommands += 1;
    if (SCREENSHOT_COMMANDS.has(record.command))
      summary.screenshotCommands += 1;
  }

  const opens = mine.filter(record => record.command === 'open');
  summary.explorations = opens.length;
  summary.browserOpenMs = opens.length ? opens[0].ms : null;

  const first = Math.min(...mine.map(record => Date.parse(record.at)));
  const last = Math.max(...mine.map(record => Date.parse(record.at) + record.ms));
  summary.explorationWallMs = Number.isFinite(first) && Number.isFinite(last) ? last - first : null;

  return summary;
}

/**
 * Artefacts the browser left behind during a window.
 *
 * `.playwright-mcp/` is written only by these sessions, so counting files whose
 * mtime falls inside the attempt is reliable for "how many did this attempt
 * produce". Separate from the command counts because a snapshot can be read
 * without a file being written, and a file can be written by a command that
 * failed.
 */
export interface ArtefactCount {
  snapshotFilesWritten: number;
  screenshotFilesWritten: number;
  /** Snapshot files whose content this attempt had already seen before. */
  duplicateSnapshotFiles: number;
}

export function countArtefacts(fromMs: number, toMs: number, dir = path.resolve(ROOT, '.playwright-mcp')): ArtefactCount {
  const counts: ArtefactCount = { snapshotFilesWritten: 0, screenshotFilesWritten: 0, duplicateSnapshotFiles: 0 };
  if (!fs.existsSync(dir))
    return counts;

  const seen = new Set<string>();
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.mtimeMs < fromMs || stat.mtimeMs > toMs)
      continue;

    if (/\.ya?ml$/i.test(name)) {
      counts.snapshotFilesWritten += 1;
      // Cheap content identity, to measure the rediscovery the baseline found.
      const body = fs.readFileSync(full, 'utf8');
      if (seen.has(body))
        counts.duplicateSnapshotFiles += 1;
      seen.add(body);
    } else if (/\.(png|jpe?g)$/i.test(name)) {
      counts.screenshotFilesWritten += 1;
    }
  }
  return counts;
}

/**
 * What the attempt was given, broken down.
 *
 * The breakdown is the point rather than the total: the Phase 1 baseline showed
 * 31,218 tokens of which 168 were the test case, and only a per-layer split makes
 * that visible or fixable.
 */
export interface ContextMetrics {
  /** Exact character count of the prompt this attempt was given. */
  promptChars: number;
  promptTokensApprox: number;

  /** Per-layer split of the prompt, from the deterministic context selection. */
  testCaseTokens: number;
  briefTokens: number;
  frameworkIndexTokens: number;
  specExcerptTokens: number;
  instructionTokens: number;
  /** Upper bound on the files the prompt named for reading. */
  directedReadTokens: number;
  /** CLAUDE.md, loaded by Claude Code itself. Not reducible from here. */
  autoLoadedTokens: number;
  /** promptTokens + directedReadTokens - what context selection is accountable for. */
  controlledTokens: number;
  totalContextTokens: number;
  budgetTokens: number;
  overBudget: boolean;
  /** Page Objects the selector chose, so a wrong choice can be audited. */
  selectedFiles: string[];

  /** Page knowledge inlined for this row's screen(s). */
  pageKnowledgeTokens: number;
  pageKnowledgeFiles: string[];
  /**
   * True when the knowledge was judged to cover everything the row needs, i.e. the
   * generator was told no browser was necessary.
   *
   * This is the *prediction*. Whether a browser was actually opened is
   * `browserExplorations` on the same record, and only that proves reuse - a hit
   * here with explorations above zero means the prediction was wrong, which is
   * exactly what wants surfacing rather than hiding.
   */
  pageKnowledgeHit: boolean;
  /** `sufficient` | `partial` | `none`, and what was unaccounted for. */
  pageKnowledgeVerdict: 'sufficient' | 'partial' | 'none';
  pageKnowledgeMissReason: string;
  /** Whether the prompt told the agent it needed the browser at all. */
  browserExplorationRequired: boolean;

  /**
   * The Phase 4B decision, separated from the Phase 3 verdict because they are
   * different questions. `pageKnowledgeVerdict` says whether the knowledge is
   * complete; this says whether anything missing from it could be found by looking
   * at the application. A `partial` row whose only gaps are words like "arrival"
   * and "above" needs no browser.
   */
  browser: {
    /** The deterministic decision: is there a gap a browser could answer? */
    browserOpenRequired: boolean;
    /** Whether one was actually opened or handed over for this case. */
    browserOpened: boolean;
    /** `partial` knowledge that nevertheless needed no browser. */
    partialWithoutBrowser: boolean;
    /**
     * True when Phase 4 would have opened a browser here and Phase 4B did not -
     * i.e. the verdict was not `sufficient` but no gap was inspectable. This is the
     * number the phase is accountable for.
     */
    unnecessaryBrowserOpenAvoided: boolean;
    /** Gap terms dismissed as naming nothing inspectable, with the count. */
    dismissedGaps: string[];
    /** Gap terms that did justify a browser. */
    inspectableGaps: string[];
    reason: string;
  };

  /**
   * The one file this row's screen resolves to, derived from its route rather than
   * chosen by the agent. Recorded so a second file for the same screen is visible.
   */
  canonicalPageId: string;
  canonicalPageFile: string;
  /** Knowledge files pulled in because they answered a gap the scoring had missed. */
  rescuedKnowledgeFiles: string[];
  /** Two files claiming one screen, at the moment this case ran. Should be zero. */
  knowledgeDuplicates: number;
  /**
   * Every requirement and how it was decided, so "no browser was needed" can be
   * audited rather than believed. Recording only "covered" would make a wrong
   * suppression indistinguishable from a right one after the fact.
   */
  pageKnowledgeDecisions: Array<{
    requirement: string;
    matched: string | null;
    matchType: string;
    matchedKnowledge: string | null;
    confidence: string;
    reason: string;
  }>;

  /**
   * What this row was found to require of a screen (Phase 5).
   *
   * The counts matter more than they look: `genericDroppedCount` is the size of the
   * problem this phase fixed - clauses that named nothing on a screen and would each
   * have become a browser-opening gap. `null` on a row that never reached extraction
   * (verdict `none`, no knowledge for the screen), so "not extracted" stays distinct
   * from "extracted nothing".
   */
  requirements: {
    requirementCount: number;
    actionCount: number;
    uiObservableCount: number;
    businessAssertionCount: number;
    genericDroppedCount: number;
    placeholderDroppedCount: number;
    requirementSourceCounts: Record<string, number>;
  } | null;

  /** Bytes of stdout the agent produced. A weak proxy; see the phase notes. */
  agentOutputChars: number;
  /**
   * Real usage as reported by the model. Always null today: `claude -p` in
   * plaintext mode reports none, and requesting `--output-format json` would
   * replace the streamed log the dashboard shows live. Recorded as an explicit
   * null rather than omitted, so a reader can tell "not measured" from "zero".
   */
  modelInputTokens: number | null;
  modelOutputTokens: number | null;
  modelCostUsd: number | null;
}

/** Conservative chars-per-token for mixed prose and code. Documented, not tuned. */
export const CHARS_PER_TOKEN = 3.7;
export const approxTokens = (chars: number): number => Math.round(chars / CHARS_PER_TOKEN);

/**
 * Size of what Claude Code loads into the agent's context by itself.
 *
 * CLAUDE.md only. Verified empirically rather than assumed: a headless run with
 * every file tool denied still answers questions about CLAUDE.md's contents, and
 * answers `NOT_IN_CONTEXT` for the skill body. So this is the floor no context
 * selection can touch - reducing it means editing CLAUDE.md, which is a separate
 * decision with its own consequences for every other session in this repo.
 */
export function autoLoadedChars(): number {
  try {
    return fs.statSync(path.resolve(ROOT, 'CLAUDE.md')).size;
  } catch {
    // Absent is 0, not an error - this is telemetry.
    return 0;
  }
}

export interface GateMetrics {
  staticMs: number | null;
  /** The spec run as written. Must pass. */
  cleanRunMs: number | null;
  /** The spec run with its assertions broken. Must fail. */
  mutationRunMs: number | null;
  cleanStatus?: string;
  mutatedStatus?: string;
  mutationsApplied: number;
}

/**
 * The browser this case was given, and what it cost.
 *
 * Every timing here is null unless THIS case is the one that paid for it. A case
 * handed a running browser has `browserStartupMs: null` and `browserSessionReuse:
 * true` - which is the measurement, not a gap in it. Summing the non-null values
 * across a run gives the total browser and sign-in cost, and that sum is what a
 * per-row session would have multiplied by the number of rows.
 */
export interface SessionMetrics {
  /** Logical id of the browser. Changes when a session is discarded and reopened. */
  browserSessionId: string | null;
  /** True when the browser was already open, from an earlier case in the group. */
  browserSessionReuse: boolean;
  /** Browser launch, for the case that launched it. */
  browserStartupMs: number | null;
  /** Sign-ins performed while preparing this case. 0 when it inherited one. */
  authenticationAttempts: number;
  /** True when this case used a sign-in performed for an earlier case. */
  authenticationReuse: boolean;
  /** The sign-in, for the case that performed it. */
  authenticationMs: number | null;
  /**
   * Browser shutdown this case paid for - i.e. a session discarded while preparing
   * it, as expired, contaminated or dead. Null when nothing was discarded.
   *
   * The group's FINAL close is deliberately not here: it happens after the last
   * case's record has been written, so it lands on the run record's per-group
   * summary instead. Reading it here as "this group's shutdown cost" would
   * undercount by exactly one close.
   */
  browserShutdownMs: number | null;
  /** Sessions thrown away as expired, contaminated or dead before this case ran. */
  sessionsDiscarded: number;
  /**
   * The checkpoint found the browser in a state this row did not expect: a stale
   * overlay, a lapsed sign-in, a sign-in that should not have been there, or a dead
   * browser. Not a failure - it is the thing being detected.
   */
  sessionContaminated: boolean;
  /**
   * A declared, safe reset put it right and the browser was kept. False with
   * `sessionContaminated` true means the session had to be discarded instead.
   */
  sessionReset: boolean;
  /** What the reset did, in order. Empty when the state was already clean. */
  resetActions: string[];
  /** The compatibility group, so the sharing can be checked against the grouping. */
  groupKey: string;
  groupSize: number;
  /** Whether the framework signed this group's browser in. */
  authRequired: boolean;
}

/**
 * What the SEMANTIC RESOLVER spent on this case.
 *
 * Additive and optional. Null when no exchange happened, which is the ordinary case and
 * must stay distinguishable from "an exchange that cost nothing".
 */
export interface SemanticSpend {
  /** Exchanges opened - one per eligible proposal that was actually asked about. */
  exchanges: number;
  /** Transport calls made. The number the wall clock is proportional to. */
  calls: number;
  /** Attempts recorded across every exchange, including malformed and timed-out ones. */
  attempts: number;
  /** Wall clock across every exchange, measured at the exchange boundary. */
  totalMs: number;
  accepted: number;
  rejected: number;
  /** Exchanges that stopped on a VALIDATED TERMINAL answer rather than a spent budget. */
  terminalStops: number;
}

export interface AttemptMetrics {
  kind: 'attempt';
  schema: number;
  runId: string;
  workbook: string;

  testCaseId: string;
  module: string;
  worksheet: string;
  scenario: string;
  priority: string;

  /**
   * How this row was routed. Today the agent only ever sees `spec:new` and
   * `spec:stale`; `data-driven` rows never reach it and are counted on the run
   * record instead. The field exists so SIMPLE/STANDARD/AI_EXPLORE have
   * somewhere to land later without a schema change.
   */
  mode: 'spec:new' | 'spec:stale';
  model: string;

  startedAt: string;
  finishedAt: string;
  /** Everything: agent, gate, bookkeeping. */
  totalMs: number;
  /** The headless Claude Code process, start to exit. */
  agentMs: number;
  /**
   * Agent time not spent inside a browser command. Reading, thinking and
   * writing, plus the gaps between browser commands - an upper bound on
   * generation proper, not a measurement of it.
   */
  agentNonBrowserMs: number | null;
  browserOpenMs: number | null;
  explorationWallMs: number | null;
  explorationBusyMs: number | null;

  /**
   * The AGENT's own sign-in, which is still not separable and still null.
   *
   * Not to be confused with `session.authenticationMs`, which is the framework
   * signing the group's browser in and IS measured. This one stays null because
   * when the agent signs itself in - a group the framework left signed out - the
   * fills and clicks it uses are indistinguishable from any others in its browse
   * log. The per-command log is persisted so it remains derivable by hand.
   */
  authMs: null;
  /** Read/Grep/Glob happen inside the agent process, invisible from outside. */
  repoDiscoveryMs: null;
  /**
   * Null on the AGENT path, where it is not separable from thinking -
   * `agentNonBrowserMs` is the bound there, and that is why this was declared `null`.
   *
   * A NUMBER on the deterministic recorded path, which does not think: there it is
   * assembly time, measured directly by `from-recording.ts`. Widening the type states
   * what the two writers already do rather than letting one of them contradict it.
   */
  generationMs: number | null;

  /**
   * The resolver's spend, or null when it was never engaged.
   *
   * Deliberately beside `gate` rather than inside `recorded`: an exchange is not a
   * property of the recording, it is a cost of the run, and a reader comparing two cases
   * needs it whichever path produced them.
   */
  semantic?: SemanticSpend | null;
  gate: GateMetrics | null;

  status: 'accepted' | 'declined' | 'quarantined' | 'failed';
  agentExitCode: number | null;
  agentTimedOut: boolean;

  browserExplorations: number;
  browseCommands: number;
  browseByCommand: Record<string, number>;
  browseRefused: number;
  snapshots: { commands: number; filesWritten: number; duplicateFiles: number };
  screenshots: { commands: number; filesWritten: number };

  /** Why this row was not a cache hit. An attempt is a miss by definition. */
  cache: { hit: false; missReason: 'new' | 'stale' };

  /**
   * Null when this case needed no browser at all - page knowledge answered it, so
   * no session was ever opened for it. Distinguishable from a session that failed,
   * which never produces an attempt record: the row is skipped instead.
   */
  session: SessionMetrics | null;

  /**
   * Set only for a case assembled by the recorded pipeline, i.e. mapped from a
   * Playwright Codegen recording with no agent and no browser. Absent on every other
   * attempt, which is the honest distinction: this is a different way of producing a
   * spec, not a different measurement of the same one.
   */
  recorded?: {
    recorded: true;
    codegenActions: number;
    codegenAssertions: number;
    reusedPageObjectMethods: number;
    newPageObjectMethods: number;
    unresolvedActions: number;
    codegenLocatorSteps: number;
    aiFallbackCalls: number;
    /** Null by definition: no model was called, so there is nothing to report. */
    aiFallbackTokens: null;
    browserOpened: 0;
    browserCommands: 0;
    /**
     * Elements the recording used that no Page Object describes, named rather than
     * counted. A raw locator is real evidence and still runs, but it is not reuse,
     * and reporting it as reuse is how a coverage gap stays invisible until the
     * clean run fails for what looks like an unrelated reason.
     */
    pageObjectRequired: Array<{ target: string; locator: string; did: string }>;
    /**
     * The locator-quality verdicts, counted. Deterministic: every field comes from a
     * rule in `locator-quality.ts`, and none of them needs a browser or a model.
     */
    locators?: {
      recordedLocatorCount: number;
      existingPageObjectReuseCount: number;
      stableLocatorCount: number;
      dynamicLocatorCount: number;
      normalizedLocatorCount: number;
      newPageObjectCount: number;
      rawLocatorFallbackCount: number;
      needsReviewCount: number;
      locatorStrategiesUsed: string[];
      weakLocatorCount: number;
      suspiciousLocatorCount: number;
    };
    /** False when assertions were appended last for want of recorded positions. */
    orderReconstructed: boolean;
    mappingTimeMs: number;
    assemblyTimeMs: number;
  };

  context: ContextMetrics;

  failureClass: string;
  failureReason: string;

  specFile?: string;
  quarantinedTo?: string;
}

export interface RunMetrics {
  kind: 'run';
  schema: number;
  runId: string;
  workbook: string;
  /**
   * WHICH APPLICATION THIS RUN WAS FOR.
   *
   * `ai/reports/*` is deliberately GLOBAL - one append-only log per machine, because
   * these answer "what has the generator been doing", which is a question about this
   * checkout rather than about a project. Physically partitioning them would make a
   * simple `tail` into a directory walk for no gain.
   *
   * But a global log needs each record to say whose it is, or two projects' work is
   * indistinguishable the moment both generate TC_LOGIN_001. This is the run record,
   * and every other report - page-object-lifecycle.jsonl, generation-metrics.jsonl's
   * own attempt rows, generation-browse.jsonl - joins to it by `runId`, so stamping it
   * here labels the whole set from one place rather than seven.
   *
   * Optional, so records written before this read as unknown rather than as belonging
   * to anybody.
   */
  applicationId?: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  /** `crashed` carries the error message in `blocked`. */
  status: 'completed' | 'blocked' | 'dry-run' | 'crashed';
  blocked?: string;
  /**
   * The census. `cacheHits` is rows with an accepted spec and an unchanged
   * fingerprint - the work the fingerprint cache avoided. `needsAgent` is the
   * misses.
   */
  routing: {
    rowsConsidered: number;
    needsAgent: number;
    cacheHits: number;
    skipped: number;
    skippedByReason: Record<string, number>;
  };
  attempts: number;

  /**
   * Browser sharing across the whole run.
   *
   * `browsersOpened` against `attempts` is the claim this phase makes: four
   * compatible rows should show one browser and one sign-in, not four of each.
   * `groups` is what made that possible, so a disappointing ratio can be traced
   * to the grouping rather than to the session.
   */
  sessions?: {
    groups: Array<{
      key: string;
      size: number;
      authRequired: boolean;
      browsersOpened: number;
      authentications: number;
      reuseCount: number;
      discarded: number;
      /**
       * Every browser close this group paid for, including the final one.
       *
       * It lives here rather than on an attempt because the group's last close
       * happens after the last case's record has already been written.
       */
      shutdownMs: number;
    }>;
    browsersOpened: number;
    authentications: number;
    reuseCount: number;
    discarded: number;
    /** Groups whose browser could not be prepared, so their rows were skipped. */
    unavailable: number;
  };
}

/**
 * Bucket `surveyWork`'s reason strings.
 *
 * Matched on the leading phrase each is built from in `work.ts`. Anything
 * unrecognised lands in `other` rather than being forced into a bucket, so a new
 * reason shows up as unclassified instead of silently inflating a category.
 */
export function classifySkip(reason: string): string {
  // Its own bucket, and first, because it is the one skip that says nothing about
  // the row: the browser or the sign-in failed, so the row was never attempted.
  // Counting it as a generation failure would blame the workbook for an outage.
  if (reason.startsWith('the generation browser')) return 'infrastructure';
  if (reason.startsWith('runs as a data-driven row')) return 'dataDriven';
  if (reason.startsWith('declares a data-driven contract')) return 'brokenContract';
  if (reason.startsWith('not automatable as written')) return 'unfitAsWritten';
  if (reason.startsWith('flagged for review')) return 'needsReview';
  if (reason.startsWith('already automated by')) return 'handWritten';
  if (reason.includes('attempt(s) and unchanged since')) return 'attemptsExhausted';
  return 'other';
}

/**
 * Classify a generation attempt's failure.
 *
 * Two different axes, and conflating them is what would make the metric useless.
 * `classifyRootCause` in `ai/excel/results.ts` classifies why a *test* failed and
 * is reused verbatim for the one case that is a test failure - the clean run
 * going red. Everything else here is a failure of the *generator*, which that
 * function has never seen and should not be taught to guess at: a timeout, a
 * decline, an empty spec, a gate refusal.
 *
 * Order matters. The gate's own refusals are recognised first, because their text
 * contains assertion words that would otherwise be read as an assertion mismatch.
 */
export function classifyOutcome(
  status: AttemptMetrics['status'],
  reason: string,
  agent: { timedOut: boolean; wroteSpec: boolean },
): string {
  if (status === 'accepted')
    return '';
  if (agent.timedOut)
    return 'Generator timed out before writing a spec';
  if (status === 'declined')
    return 'Generator declined - the workbook row needs its author';
  if (status === 'failed' && !agent.wroteSpec)
    return 'Generator produced no spec and gave no reason';

  if (reason.startsWith('Failed the static checks'))
    return 'Gate: spec failed the static checks';
  if (reason.includes('None of the known assertion forms'))
    return 'Gate: no assertion the mutator can break';
  if (reason.includes('still passes with every assertion broken'))
    return 'Gate: spec asserts nothing about the application';

  // What remains is the clean run going red, i.e. an ordinary test failure.
  return classifyRootCause(reason) || 'Unclassified - needs analysis';
}

/**
 * Reason codes for a recorded case. Telemetry only - never a workbook status.
 *
 * They exist to stop one word covering two very different events. "Quarantined"
 * used to mean both "the application refused this test" and "we reassembled the
 * recording wrongly and then failed it", and only the first is a statement about
 * the person's recording.
 */
export type RecordedFailureClass =
  | 'RECORDED_CONFIGURATION_FAILURE'
  /** Nothing was asserted. Not a generation failure: the row needs its author. */
  | 'RECORDED_NO_ASSERTION'
  /** A recorded locator cannot be replayed as written - a generated id, say. */
  | 'RECORDED_LOCATOR_NEEDS_REVIEW'
  /** An action carried no locator, so nothing could be mapped from it. */
  | 'RECORDED_UNMAPPED_ACTION'
  | 'RECORDED_NAVIGATION_CAUSALITY_REQUIRED'
  | 'RECORDED_AUTHENTICATION_CAPABILITY_REQUIRED'
  /** The spec could not be built, or was built from a recording we could not order. */
  | 'RECORDED_ASSEMBLY_ERROR'
  /** Built faithfully, ran, and did not pass. */
  | 'RECORDED_CLEAN_RUN_FAILURE'
  /**
   * The spec named a Playwright fixture the framework does not declare.
   *
   * The most specific collection failure, and the one worth naming: it is a defect in
   * what was GENERATED, fixable without touching the recording, and it accounted for all
   * ten of the collection failures on the board.
   */
  | 'RECORDED_UNKNOWN_FIXTURE'
  /**
   * globalSetup threw, so nothing was loaded and neither the recording nor the spec is
   * implicated. A locked workbook is not a test defect.
   */
  | 'RECORDED_ENVIRONMENT_FAILURE'
  /**
   * Playwright never built the suite, so the spec never ran.
   *
   * Distinct from CLEAN_RUN_FAILURE, which says "ran and did not pass". A collection
   * failure means no locator in the spec was ever exercised, so nothing may be concluded
   * about one - and ten cases were filed as clean-run failures when an undeclared
   * fixture had stopped Playwright before the first line.
   */
  | 'RECORDED_COLLECTION_FAILURE'
  /** Passed with every assertion broken - it is checking nothing. */
  | 'RECORDED_MUTATION_FAILURE'
  /** The application or a Page Object refused, not the recording. */
  | 'RECORDED_APPLICATION_FAILURE';

/**
 * Which of those a recorded attempt hit.
 *
 * `orderReconstructed: false` turns a clean-run failure into an ASSEMBLY_ERROR,
 * because a spec whose assertions were moved out of their recorded positions was
 * not the test the person recorded — blaming their recording for that failure is
 * blaming them for our defect. It is a signal about *our* reconstruction, so it is
 * read before anything about the application.
 *
 * `resolve()`'s own wording is the marker for an application failure: that error
 * comes from a Page Object exhausting its candidate strategies, which is a fact
 * about the page or the Page Object and never about the recording.
 */
export function classifyRecordedFailure(input: {
  block?: 'noArtifact' | 'noAssertion' | 'unmappedAction' | 'needsReview' | 'navigationCausality' | 'authenticationCapability' | 'userBindingIncomplete';
  orderReconstructed: boolean;
  cleanStatus?: string;
  mutatedStatus?: string;
  /**
   * The gate's own classification of the clean run, when it produced one.
   *
   * Preferred over `cleanStatus` because it is finer: `Not Collected` is one status
   * covering an unknown fixture, a spec that does not compile, a title that carries no
   * ID and a globalSetup fault. Branching on the status collapsed all four back into one
   * class the moment they arrived here, which is the level the four-way distinction was
   * being made for.
   */
  cleanCode?: string;
  reason: string;
}): RecordedFailureClass | '' {
  if (input.block === 'navigationCausality') return 'RECORDED_NAVIGATION_CAUSALITY_REQUIRED';
  if (input.block === 'authenticationCapability') return 'RECORDED_AUTHENTICATION_CAPABILITY_REQUIRED';
  if (input.block === 'noAssertion')
    return 'RECORDED_NO_ASSERTION';
  if (input.block === 'needsReview')
    return 'RECORDED_LOCATOR_NEEDS_REVIEW';
  if (input.block === 'unmappedAction')
    return 'RECORDED_UNMAPPED_ACTION';
  if (input.block === 'noArtifact')
    return 'RECORDED_ASSEMBLY_ERROR';

  if (input.mutatedStatus === 'Passed')
    return 'RECORDED_MUTATION_FAILURE';
  if (input.cleanCode?.endsWith('_CONFIGURATION_FAILURE')) return 'RECORDED_CONFIGURATION_FAILURE';

  if (input.cleanStatus && input.cleanStatus !== 'Passed') {
    // DID IT RUN AT ALL. Asked first, because every classification below is a statement
    // about a test that executed. `Not Collected` means Playwright could not build the
    // suite, so the spec never ran and neither its assembly nor the application can be
    // blamed for it. Ten recorded cases were filed as RECORDED_CLEAN_RUN_FAILURE -
    // "built faithfully, ran, and did not pass" - when an undeclared fixture had stopped
    // collection before the first line of any of them.
    // THE CODE FIRST, the status only as a fallback for a record written before codes
    // existed. An environment fault is not a defect in the recording and must not be
    // filed as one.
    if (input.cleanCode === 'GLOBAL_SETUP_FAILURE')
      return 'RECORDED_ENVIRONMENT_FAILURE';
    if (input.cleanCode === 'UNKNOWN_FIXTURE')
      return 'RECORDED_UNKNOWN_FIXTURE';
    if (input.cleanCode === 'NO_MATCHING_TEST' || input.cleanCode === 'COMPILE_ERROR'
      || input.cleanCode === 'COLLECTION_ERROR' || input.cleanStatus === 'Not Collected')
      return 'RECORDED_COLLECTION_FAILURE';
    if (!input.orderReconstructed)
      return 'RECORDED_ASSEMBLY_ERROR';
    if (/Could not resolve "/.test(input.reason))
      return 'RECORDED_APPLICATION_FAILURE';
    return 'RECORDED_CLEAN_RUN_FAILURE';
  }

  if (input.reason.startsWith('Failed the static checks')
    || input.reason.includes('None of the known assertion forms'))
    return 'RECORDED_ASSEMBLY_ERROR';

  return '';
}

/** Append one record. Never throws: telemetry must not fail a generation run. */
export function append(record: AttemptMetrics | RunMetrics, file: string = METRICS_FILE): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`  (metrics not recorded: ${(error as Error).message})\n`);
  }
}

/** Read every record back, for a benchmark or a report. */
export function readAll(file: string = METRICS_FILE): Array<AttemptMetrics | RunMetrics> {
  if (!fs.existsSync(file))
    return [];
  const records: Array<AttemptMetrics | RunMetrics> = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim())
      continue;
    try {
      records.push(JSON.parse(line) as AttemptMetrics | RunMetrics);
    } catch {
      // Skip a torn line rather than refuse to report at all.
    }
  }
  return records;
}
