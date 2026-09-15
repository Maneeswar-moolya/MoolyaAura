/**
 * Which rows need code written, and which have had their code invalidated.
 *
 * Deterministic on purpose: the agent is expensive, non-deterministic and has
 * to be pointed at something. Deciding *what* to point it at is bookkeeping,
 * and bookkeeping belongs in code.
 *
 * A row needs a spec when all of these hold:
 *
 *   - it declares no readable data-driven contract (those already run with no
 *     code, and the skill says to prefer them);
 *   - nothing in the mapping already automates it;
 *   - the quality checks do not say it is unfit to automate as written.
 *
 * That last one is the important exclusion. A row with no expected result, no
 * steps or genuinely ambiguous wording cannot be automated by anyone without
 * inventing acceptance criteria, and an agent inventing them is exactly the
 * failure this whole toolkit is built to avoid. Those rows are reported, never
 * generated.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// From `placeholders.ts`, not `recorder.ts`: that module loads `.env` at import
// time, and the survey has no business pulling dotenv in behind it.
import { PLACEHOLDER_TEXTS } from '../dashboard/placeholders';
import { SCHEMA } from './metrics';
import { buildCache } from '../excel/data-driven';
import { type Mapping } from '../excel/mapping';
import { activeScopePath, activeScope, scopedKey, type ApplicationScope } from '../projects/scope';
import { analyzeQuality, needsReview } from '../excel/quality';
import type { ParseResult, TestCase } from '../excel/types';

export const AUTOCODE_DIR = path.resolve(process.cwd(), 'ai', 'autocode');
export const STATE_FILE = path.join(AUTOCODE_DIR, 'state.json');
/** Specs that failed the gate. Outside tests-e2e so Playwright never sees them. */
export const QUARANTINE_DIR = path.join(AUTOCODE_DIR, 'quarantine');
/**
 * Where accepted specs live. Inside tests-e2e so the normal suite runs them.
 *
 * APPLICATION-OWNED (`generated specs`), and the collision is the same one the
 * recordings directory has: a generated spec is named after its Test Case ID, and an
 * ID is unique within an application only. Two applications with TC_LOGIN_001 write
 * one file, and whichever generates second silently replaces the other's automation
 * while both mapping entries still claim it.
 *
 * `QUARANTINE_DIR` and `STATE_FILE` above are deliberately NOT scoped here - see the
 * Phase 2 report. They are keyed by Test Case ID and carry the same collision, but
 * they are the generator's own bookkeeping rather than automation, and moving them
 * changes what `frameworkFingerprint` and the attempt budget mean. Listed as
 * remaining, not fixed silently.
 */
export function generatedDir(): string {
  return activeScopePath('generatedDir', path.resolve(process.cwd(), 'tests-e2e', 'generated'));
}

export type Verdict =
  /** Generated, ran green, and proved it can go red. Registered. */
  | 'accepted'
  /** Generated but could not prove itself. Quarantined, not registered. */
  | 'quarantined'
  /** The agent declined to write a spec and said why. */
  | 'declined'
  /** The agent produced nothing usable. */
  | 'failed';

export interface StateEntry {
  /** Hash of the authored cells. A change here means the spec is out of date. */
  fingerprint: string;
  verdict: Verdict;
  /** Repo-relative path of the spec, when one was written. */
  specFile?: string;
  reason?: string;
  /**
   * The model that wrote it. Absent on entries recorded before this was pinned,
   * and deliberately NOT part of the fingerprint: changing model does not make
   * an accepted spec stale, and treating it as staleness would regenerate the
   * whole workbook the first time anyone set AUTOCODE_MODEL.
   */
  model?: string;
  at: string;
  /** Consecutive unsuccessful attempts. Stops an unwritable row looping forever. */
  attempts: number;
  /**
   * The generation framework this attempt ran against (`frameworkFingerprint`).
   *
   * The attempt budget used to be keyed to the workbook row alone, which asked the
   * wrong question. A row that failed twice was declared unwritable and told to edit
   * itself - but nothing about the row was wrong: TC_LOGIN_041/042/043 failed because
   * the suite clicked a project card before the application had bound its click
   * handler, and after P0.8 fixed exactly that, all three stayed skipped. The budget
   * protects against a row nobody can automate; it must not protect against a defect
   * we have since repaired.
   *
   * Absent on every entry written before P0.11, and absent is treated as "unknown
   * framework", which reopens the budget once. That is the migration: the next run
   * records a fingerprint and the protection resumes from there.
   */
  framework?: string;
}

/**
 * Generation state, keyed by `applicationId/testCaseId`.
 *
 * GENERATION IDENTITY IS applicationId + testCaseId, NEVER testCaseId ALONE.
 *
 * This map was keyed by the bare Test Case ID, in one global file. A Test Case ID is
 * unique within an application and meaningless across them, so two applications that
 * both have TC_LOGIN_001 shared ONE entry: one project's attempt count, fingerprint,
 * verdict and spec path answering for the other. The visible failures would have been
 * a row refusing to generate because a different project had spent its two attempts,
 * and a row skipped as `accepted` on the strength of a spec belonging to another
 * product.
 *
 * `MAX_ATTEMPTS` is unchanged and stays global: how many times to retry is execution
 * POLICY, a number that means the same thing everywhere. What is per-application is the
 * RECORD - and only the key moved, so every existing rule about when the budget resets
 * still reads exactly as it did.
 */
export type State = Record<string, StateEntry>;

/**
 * The key an entry is filed under.
 *
 * `activeScope()` rather than a parameter because every caller is a generation CLI,
 * where the ambient scope IS the operation's scope. A caller that knows better passes
 * `applicationId`.
 */
export function stateKeyFor(testCaseId: string, applicationId?: string): string {
  return scopedKey(applicationId ?? activeScope().applicationId, testCaseId);
}

/** How many times a row is retried before it is left alone until it changes. */
export const MAX_ATTEMPTS = 2;

export function readState(file: string = STATE_FILE): State {
  if (!fs.existsSync(file))
    return {};
  const contents = fs.readFileSync(file, 'utf8').trim();
  return contents ? (JSON.parse(contents) as State) : {};
}

// Bare historical keys have unknown ownership. Preserve them without attribution.

export function writeState(state: State, file: string = STATE_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted: State = {};
  for (const key of Object.keys(state).sort())
    sorted[key] = state[key];
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/**
 * A hash of everything a person authored that can CHANGE WHAT IS GENERATED.
 *
 * Only the authored cells: result columns change on every run, and a spec does
 * not go stale because its last execution time moved. Change the scenario, the
 * steps or the data and the spec has to be revisited; change nothing and it
 * never regenerates, however many times the workbook is saved.
 *
 * WHY THREE FIELDS ARE DELIBERATELY MISSING (P1)
 *
 * `requirementId`, `businessRisk` and `testOwner` are governance: they say who
 * asked for this test, what it costs when it breaks, and who owns it. None of
 * them can change a line of the spec - they are traceability the generator is
 * shown as context and reporting reads afterwards. Including them would mark an
 * accepted, passing spec stale because somebody filled in a Jira number, which
 * is regeneration for no reason and costs a browser and a model to discover.
 *
 * Everything else IS here, including the ones added beside them:
 *
 *   testType                a Security or Accessibility case is a different test
 *   environment, userRole   which application, acting as whom
 *   authenticationProfile   which account the test signs in as
 *   tags                    not decoration: `context.ts` scores knowledge with
 *                           them, and `isRecordedTags` picks the whole pipeline
 *
 * `authoringFingerprint` below covers the governance fields too, for anything
 * that wants to notice an edit without treating it as staleness.
 */
export function fingerprint(testCase: TestCase): string {
  const authored = [
    testCase.module, testCase.feature, testCase.scenario, testCase.description,
    testCase.preconditions, testCase.steps.join('\n'), testCase.testData,
    testCase.expectedResult, testCase.expectedOutcome, testCase.expectedMessage,
    testCase.priority, testCase.tags.join(','),
    testCase.testType, testCase.environment, testCase.userRole, testCase.authenticationProfile,
  ].join(' ');
  return crypto.createHash('sha256').update(authored).digest('hex').slice(0, 16);
}

/**
 * Everything a person authored, governance included.
 *
 * Not a staleness signal - a change-detection one. "Has this row been edited at
 * all since we looked?" is a different question from "does the spec have to be
 * rewritten?", and answering the first with the second is what makes a tool
 * regenerate a passing test because somebody filled in a Jira number.
 */
export function authoringFingerprint(testCase: TestCase): string {
  const authored = [
    fingerprint(testCase),
    testCase.requirementId, testCase.businessRisk, testCase.testOwner,
  ].join(' ');
  return crypto.createHash('sha256').update(authored).digest('hex').slice(0, 16);
}

/**
 * The authored fields a RECORDING is evidence for.
 *
 * A recording shows a person doing those steps, with that data, on that screen,
 * as that user. Change any of them and the recording is evidence for something
 * the row no longer says - so it is marked stale and the choice (re-record, or
 * regenerate from the authored steps) is put to a person. Change the title, the
 * requirement, the priority, the risk, the tags or the owner and the recording
 * still shows exactly what it always showed.
 *
 * Deliberately NOT `fingerprint()`: that one includes module, feature, scenario,
 * priority and tags, none of which describe what the person did in the browser.
 */
export function recordingFingerprint(testCase: TestCase): string {
  const recorded = [
    testCase.steps.join('\n'), testCase.expectedResult, testCase.preconditions,
    testCase.testData, testCase.environment, testCase.userRole, testCase.authenticationProfile,
    testCase.expectedOutcome, testCase.expectedMessage,
  ].join(' ');
  return crypto.createHash('sha256').update(recorded).digest('hex').slice(0, 16);
}

/**
 * The files whose behaviour decides what a generated spec CONTAINS.
 *
 * Not "everything that could affect a run". A change here means the same row,
 * generated again, could come out differently - so a case the old code could not
 * write deserves another attempt. The list is deliberately short and explicit;
 * add a file when its behaviour changes what is emitted, and only then.
 *
 * Excluded on purpose:
 *   - `verify.ts` - it judges a spec, it does not write one, and it is the one file
 *     the project keeps byte-identical so a gate change is never quiet;
 *   - `dom-capture-source.ts` and the recorder - they shape future RECORDINGS, and a
 *     recording is an input to generation, not part of it. A recording that already
 *     exists is unchanged by them;
 *   - anything the pipeline writes: state, mapping, the workbook, generated specs,
 *     reports and metrics files. Including any of those would make every run change
 *     the fingerprint, which is the same as having no budget at all.
 */
export const GENERATION_SOURCES = [
  'ai/autocode/from-recording.ts',
  'ai/autocode/locator-quality.ts',
  'ai/autocode/dom-evidence.ts',
  'ai/autocode/context.ts',
];

/**
 * Page Objects: what a generated spec is told to reuse. Every `.ts`, sorted.
 *
 * Scoped, and it has to be: this is a DIRECTORY SCAN, so a layout the scan cannot see
 * does not fail - it returns an empty list and the fingerprint silently stops covering
 * Page Objects altogether. The attempt budget would then never reopen when one is
 * fixed, which is the exact failure the fingerprint was added to prevent, arriving as
 * "nothing happened".
 *
 * Kept REPO-RELATIVE because the relative path string is hashed alongside the file
 * contents, and because `frameworkFingerprint` takes a `root` so a fixture can hash a
 * different tree with this same layout. Today it resolves to `tests-e2e/pages`, byte
 * for byte what it always was, so no fingerprint moves and no budget reopens.
 */
export function generationPageObjectDir(scope?: ApplicationScope): string {
  return path.relative(process.cwd(), scope?.paths.pagesDir || activeScopePath('pagesDir', path.resolve(process.cwd(), 'tests-e2e', 'pages')))
      .split(path.sep).join('/');
}

let cachedFingerprint: { key: string; value: string } | null = null;

/**
 * The memo key, and it is NOT the root alone.
 *
 * `frameworkFingerprint` hashes `generationPageObjectDir()`, which is scope-derived -
 * so the value is a fact about ONE APPLICATION'S Page Objects. Keyed by root alone,
 * the first application to ask in a process answered for every application after it.
 *
 * That is harmless in the generation CLI, which is one process per application, and it
 * is NOT harmless in the dashboard: `surveyWork` calls this, and the server calls
 * `surveyWork` per request (server.ts, inside `activate`). A dashboard that served
 * Project A and then Project B would judge B's rows against A's framework fingerprint,
 * so a row of B whose framework genuinely changed reads as unchanged - its attempt
 * budget is not reopened and it stays skipped with "edit the row to try again".
 *
 * The VALUE is unchanged; only the key is. No fingerprint moves, so no attempt budget
 * reopens as a result of this fix.
 */
function fingerprintKey(root: string, scope?: ApplicationScope): string {
  let applicationId = '';
  try {
    applicationId = scope?.applicationId || activeScope().applicationId;
  } catch {
    // No registry, or a scope nobody chose. An empty component is a distinct key from
    // any real applicationId, so a legacy checkout memoises separately rather than
    // sharing with one.
  }
  return `${root}\u0000${applicationId}`;
}

/**
 * A hash of the generation framework, as it stands right now.
 *
 * Deterministic by construction: a fixed file list plus one sorted directory, each
 * file hashed with its own path, line endings normalised so a checkout that differs
 * only in CRLF cannot look like a code change. A missing file hashes as a named
 * absence rather than being skipped, so deleting a Page Object counts as a change.
 *
 * `SCHEMA` rides along because a metrics-schema bump marks a change in what the
 * pipeline records about generation - it is the version number this project already
 * maintains by hand for exactly that reason.
 *
 * Cached per root for the life of the process: one run must see one framework, and
 * reading six files repeatedly for every row is waste.
 */
export function frameworkFingerprint(root: string = process.cwd(), scope?: ApplicationScope): string {
  const key = fingerprintKey(root, scope);
  if (cachedFingerprint && cachedFingerprint.key === key)
    return cachedFingerprint.value;
  const hash = crypto.createHash('sha256');
  hash.update(`schema:${SCHEMA}\n`);
  const pageObjectDir = generationPageObjectDir(scope);
  const pageObjects = (() => {
    const dir = path.join(root, pageObjectDir);
    if (!fs.existsSync(dir))
      return [] as string[];
    return fs.readdirSync(dir).filter(name => name.endsWith('.ts')).sort()
        .map(name => `${pageObjectDir}/${name}`);
  })();
  for (const relative of [...GENERATION_SOURCES, ...pageObjects]) {
    const file = path.join(root, relative);
    const contents = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').split('\r\n').join('\n')
      : '<absent>';
    hash.update(`${relative}\n${contents}\n`);
  }
  const value = hash.digest('hex').slice(0, 16);
  cachedFingerprint = { key, value };
  return value;
}

/** Forget the cached fingerprint. For tests that change the tree under it. */
export function resetFrameworkFingerprint(): void {
  cachedFingerprint = null;
}

/**
 * Has this row spent its attempts against the framework it spent them on?
 *
 * Both halves have to be unchanged for the budget to hold. An edited row is the
 * author saying "try again"; a changed framework is the project saying it. Neither
 * one weakens the other protection: a row that keeps failing under one unchanged
 * framework still stops after MAX_ATTEMPTS, however many times it is surveyed.
 */
export function budgetExhausted(
  previous: StateEntry | undefined,
  print: string,
  framework: string,
): boolean {
  if (!previous || previous.fingerprint !== print)
    return false;
  if (previous.attempts < MAX_ATTEMPTS)
    return false;
  // `undefined` is not equal to any fingerprint, so a pre-P0.11 entry reopens once.
  return previous.framework === framework;
}

export type WorkReason =
  /** No automation exists for this row. */
  | 'new'
  /** A spec exists but the row it came from has been edited since. */
  | 'stale';

export interface WorkItem {
  testCase: TestCase;
  reason: WorkReason;
  fingerprint: string;
  /** The spec that is now out of date, for a `stale` item. */
  previousSpec?: string;
  /**
   * Why a row whose fingerprint has NOT changed is still work. Set only when an
   * `accepted` entry names a spec that is no longer on disk, so the log can say
   * so instead of reporting an unexplained rewrite.
   */
  staleReason?: string;
}

/**
 * Is this cell still one of the recorder's own placeholders?
 *
 * Whole trimmed clause, case-insensitively - the same rule `requirements.ts` uses,
 * and for the same reason: somebody who edits the cell to "Needs confirmation from
 * the product owner that the toast is correct" has written a real expected result,
 * and that row is ready to generate.
 */
function isPlaceholder(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  return PLACEHOLDER_TEXTS.some(text => text.toLowerCase() === normalised);
}

/**
 * Is the spec an entry claims still on disk?
 *
 * State records a repo-relative path; an entry with no path never had a spec, so
 * there is nothing to have gone missing and the caller's existing rules apply.
 */
function specExists(specFile: string | undefined): boolean {
  if (!specFile)
    return true;
  return fs.existsSync(path.resolve(process.cwd(), specFile));
}

export interface Survey {
  work: WorkItem[];
  /** Rows deliberately not sent to the agent, with the reason, for the log. */
  skipped: Array<{ testCaseId: string; reason: string }>;
}

/**
 * Decide what the agent should be asked to write.
 *
 * `onlyIds` narrows to specific cases (what the dashboard passes after a save);
 * without it the whole workbook is surveyed, which is what a bulk import needs.
 */
export function surveyWork(
  parsed: ParseResult,
  mapping: Mapping,
  state: State,
  onlyIds?: Set<string>,
  scope?: ApplicationScope,
): Survey {
  const cache = buildCache(parsed, new Date().toISOString());
  const dataDriven = new Set<string>();
  for (const row of cache.cases)
    dataDriven.add(row.testCaseId.toUpperCase());
  // A rejected contract is still the author's declared intent. Writing a spec
  // for it would paper over an authoring mistake they need to see.
  const brokenContract = new Set(cache.rejected.map(row => row.testCaseId.toUpperCase()));

  const unfit = needsReview(parsed, analyzeQuality(parsed));
  // Read once per survey: one run sees one framework.
  const framework = frameworkFingerprint(process.cwd(), scope);

  const work: WorkItem[] = [];
  const skipped: Array<{ testCaseId: string; reason: string }> = [];

  for (const testCase of parsed.testCases) {
    const id = testCase.testCaseId;
    const upper = id.toUpperCase();
    if (onlyIds && !onlyIds.has(upper))
      continue;

    if (dataDriven.has(upper)) {
      skipped.push({ testCaseId: id, reason: 'runs as a data-driven row - no spec needed' });
      continue;
    }
    if (brokenContract.has(upper)) {
      skipped.push({ testCaseId: id,
        reason: 'declares a data-driven contract that cannot be read - fix the row, do not write around it' });
      continue;
    }

    const review = unfit.get(id);
    if (review?.length) {
      skipped.push({ testCaseId: id,
        reason: `not automatable as written (${review.join('; ')}) - acceptance criteria would have to be invented` });
      continue;
    }

    const entry = mapping[id];
    if (entry?.status === 'Needs Review') {
      skipped.push({ testCaseId: id, reason: `flagged for review: ${entry.reviewReason ?? 'no reason recorded'}` });
      continue;
    }

    // A recording that asserted nothing. The recorder writes the "Needs
    // confirmation" placeholder as the Expected Result precisely because it will not
    // invent one, and sending that to a generator asks it to invent one anyway - it
    // declined both times it was asked. So the row stops here, with the reason said
    // out loud, and confirming the Expected Result (or re-recording with the check
    // in it) is what releases it. No new status: `Needs Confirmation` is the
    // placeholder already on the row.
    if (isPlaceholder(testCase.expectedResult)) {
      skipped.push({ testCaseId: id,
        reason: 'recorded test has no assertion - the Expected Result is still the '
          + `"${testCase.expectedResult.trim()}" placeholder, so there is nothing to prove. `
          + 'Confirm it on the row, or re-record with the check you want made.' });
      continue;
    }

    const print = fingerprint(testCase);
    const previous = state[stateKeyFor(id, scope?.applicationId)];

    // Automation that a human wrote is never regenerated. Only specs this
    // module produced are its to replace.
    const ownedHere = Boolean(previous?.specFile);
    if (entry?.testFile && !ownedHere) {
      skipped.push({ testCaseId: id, reason: `already automated by ${entry.testFile}` });
      continue;
    }

    if (previous && previous.fingerprint === print) {
      // `accepted` is a claim about a file, so it is only believed while the file
      // is there. A spec deleted underneath an accepted entry - which is what
      // quarantining a shared file used to do to its siblings - otherwise froze
      // the row forever: unchanged row, accepted verdict, no work, no reason
      // reported, and nothing anywhere noticed the spec had gone. Falling through
      // makes it ordinary `stale` work for the existing pipeline to rewrite; the
      // verdict itself is not rewritten here and nothing is promoted.
      if (previous.verdict === 'accepted' && specExists(previous.specFile))
        continue;
      if (previous.verdict === 'accepted') {
        work.push({
          testCase,
          reason: 'stale',
          fingerprint: print,
          previousSpec: previous.specFile,
          staleReason: `accepted state is stale: spec file missing (${previous.specFile ?? 'none recorded'})`,
        });
        continue;
      }
      if (previous.attempts >= MAX_ATTEMPTS) {
        if (budgetExhausted(previous, print, framework)) {
          skipped.push({ testCaseId: id,
            reason: `${previous.verdict} after ${previous.attempts} attempt(s), and neither the row `
              + 'nor the generation framework has changed since - edit the row to try again '
              + `(${previous.reason ?? 'no reason recorded'})` });
          continue;
        }
        // The framework moved under a row that had run out of attempts. That is the
        // project saying "try again", and it is why P0.8's fix could reach the cases
        // it was written for instead of stopping at their spent budget.
        work.push({
          testCase,
          reason: 'stale',
          fingerprint: print,
          previousSpec: previous.specFile,
          staleReason: `attempts were spent against a different generation framework `
            + `(${previous.framework ?? 'none recorded'} -> ${framework}), so the budget is reopened`,
        });
        continue;
      }
    }

    work.push({
      testCase,
      reason: previous?.specFile ? 'stale' : 'new',
      fingerprint: print,
      previousSpec: previous?.specFile,
    });
  }

  return { work, skipped };
}

/** `Create Project` -> `create-project`, for a spec file name. */
export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'case';
}
