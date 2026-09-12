/**
 * Record Test: a second way to author a test case, not a second framework.
 *
 * A person records what they do in a browser; this turns that into the SAME
 * `CaseDraft` the Add/Edit form produces, and hands it to the same
 * `/api/case` endpoint. From that point the row is indistinguishable from one
 * typed into Excel - same ID scheme, same workbook, same generation, same
 * quality gate, same runner, same results. Nothing downstream knows or cares
 * that a recording produced it.
 *
 * Three properties are load-bearing:
 *
 * **Playwright's own recorder, not ours.** `playwright codegen --target
 * playwright-test -o <file>` is the existing installation doing the work. We
 * spawn it and read what it wrote. There is no custom browser automation here
 * and no MCP.
 *
 * **Deterministic, zero AI calls.** Codegen emits a small, regular grammar -
 * `await page.<locator>.<action>(...)` and `await expect(<locator>).<matcher>(...)`.
 * Parsing that is a job for a parser. A model is not asked to read it, name it,
 * or summarise it. See `toDraft` for the naming rules.
 *
 * **The recording is an input, never the output.** The generated script is
 * parsed, then deleted. It never becomes a spec: the existing generation
 * pipeline is still what writes automation, using Page Objects, page knowledge
 * and the falsification gate. Raw codegen output pasted into `tests-e2e/` would
 * bypass all three.
 *
 * SECURITY
 *
 * A recording watches somebody type. Two independent guards stop a password
 * reaching disk, an API response, the workbook or a log:
 *
 *   1. the field looks sensitive - password/pwd/secret/token/otp/cvv, or a
 *      `[type=password]` locator;
 *   2. the captured value equals a secret this process already holds.
 *
 * Either one replaces the value with `[type=password]`. The check itself never
 * reports WHICH guard fired or which secret matched, because "your password was
 * the thing that matched" is itself a disclosure. Values are never logged, and
 * the temporary script is written to the OS temp directory - outside the repo,
 * so it cannot be committed even by accident - and deleted after parsing.
 */

// Populates process.env from the git-ignored .env, using the loader the suite
// already uses. Needed for the second redaction guard below: nothing in ai/ loads
// .env by itself, so without this the "does this value equal a secret we hold?"
// check would silently compare against undefined and never fire - which a test
// caught. It reads secrets INTO this process and never out of it: no value here is
// returned, logged or stored, and the children this server spawns already load the
// same file themselves.
import '../../tests-e2e/support/load-env';

import { NEEDS_CONFIRMATION, RECORDED_INTERACTION } from './placeholders';
import {
  evidenceUnavailable, type AssertionProvenance, type RecordingEvidence, type TargetEvidence,
} from '../autocode/dom-evidence';
import {
  type ApplicationScope, activeAcceptedDir, activeRecordingsDir, resolveScope,
} from '../projects/scope';
import type { RecordingOrigin } from '../autocode/dom-evidence';
import { readRegistry, registryFile } from '../projects/registry';
import { classify } from './assertion-capabilities';
import { resolveAssertionSubject, sameElement } from './associated-control';
import {
  isRecorderOwnAction, liveTransportRequested, startLiveRecording, type LiveSession,
} from './live-recorder';

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();

/** Browsers codegen accepts, mapped from the names the dashboard already uses. */
const BROWSERS: Record<string, string> = { chromium: 'chromium', firefox: 'firefox', webkit: 'webkit' };

export interface RecordedAction {
  type: 'navigate' | 'click' | 'dblclick' | 'fill' | 'press' | 'check' | 'uncheck' | 'select' | 'hover';
  /** Human-readable name of the thing acted on: an accessible name, label or selector. */
  target: string;
  /** Codegen's own locator expression, preserved verbatim. */
  locator: string;
  /** getByRole, getByLabel, getByPlaceholder, getByText, getByTestId, locator… */
  locatorStrategy: string;
  /** Typed text, chosen option, key pressed. Null when there is none or it was redacted. */
  value: string | null;
  /** True when a value was captured and deliberately replaced. */
  redacted?: boolean;
}

export interface RecordedAssertion {
  type: 'visible' | 'hidden' | 'text' | 'contains' | 'value' | 'checked' | 'url' | 'count'
    | 'title' | 'empty'
    // P1 state assertions. `enabled` carries both halves through `expected`,
    // because "disabled" is not a different question - it is the same question
    // answered no, and two types would let a spec hold both at once.
    | 'enabled' | 'attribute' | 'class' | 'values';
  target: string;
  locator: string;
  locatorStrategy: string;
  value: string | null;
  /**
   * Whether the person asserted that this IS true, or that it is NOT.
   *
   * `expect(x).toBeChecked()` and `expect(x).not.toBeChecked()` are opposite
   * claims about the same thing, and until this field existed the second parsed
   * as the first - the `.not.` was dropped and the locator was corrupted by the
   * slice that assumed the receiver ended in `)`. A recording of "the box is
   * empty" therefore generated a test asserting it was ticked: green, and the
   * exact reverse of what somebody watched happen.
   *
   * Absent on every recording parsed before this existed, and absent means TRUE:
   * every one of those was a positive assertion, because a negative one could
   * not be represented at all.
   */
  expected?: boolean;
  /** The attribute name, for an `attribute` assertion. Never a value. */
  name?: string;
  /**
   * The element the person actually pointed at, when it is not the element being
   * asserted about (P1.2b).
   *
   * A custom switch puts its state on an input the pointer cannot reach - 0x0,
   * behind a decorated span - so the ASSERTION SUBJECT is resolved to that input
   * while the INTERACTION TARGET stays exactly what was clicked. This records the
   * difference rather than hiding it: `locator` is the subject, this is what the
   * person saw. Absent when they are the same element, which is almost always.
   *
   * It is documentation, not an instruction. Nothing generates a step from it,
   * and P0.7's recorded click is untouched by any of this.
   */
  interactionTarget?: string;
  /** The expected options of a multiple `<select>`, for a `values` assertion. */
  values?: string[];
  /**
   * WHICH RECORDED TARGET this assertion is about, proven in the page at pick time.
   *
   * The association `locator` cannot express. An assertion's locator is composed from
   * the element's own description; a recorded action's is composed by Codegen from the
   * same element by different rules; so one element can produce two locators with
   * nothing in common, and the string join that pairs an action with its evidence
   * cannot pair an assertion with the same element's evidence. TC_DASHBOARD_023 is
   * `page.locator(".bugChecked")` against a target recorded as
   * `page.locator('[id="1749552"]')` - one input, no shared substring, no evidence
   * found, and a locator matching three elements emitted as if it named one.
   *
   * What is in here is an identity check and a count, both taken by the browser while
   * the person still had the element selected. Nothing is inferred from a selector, an
   * id, a class, DOM proximity, the preceding action or a matching index, and absence
   * is a real answer: an assertion about an element no action ever touched simply has
   * none, and is judged exactly as it was before this field existed.
   *
   * Absent on every recording made before it, and on every assertion whose subject
   * could not be matched. See `AssertionProvenance`.
   */
  subjectProvenance?: AssertionProvenance;
  /**
   * How many actions had been recorded when this assertion was made - so a spec
   * can put it back where the person put it.
   *
   * The recorded order IS the evidence: "check the modal says Create New Project,
   * then cancel" and "cancel, then check the modal says Create New Project" are
   * different tests, and only one of them can pass. Emitting every assertion after
   * every action turned the first into the second and then reported the resulting
   * failure as a bad recording.
   *
   * `undefined` only for a Recording built before this field existed. Absent
   * positions are appended last - the old behaviour - never guessed at.
   */
  afterActions?: number;
}

/**
 * Whether the person signed in while recording, and nothing else about it.
 *
 * This exists so generation does not repeat work the recording already did: a
 * recorded sign-in means the generated test needs authentication, and the project
 * already has a mechanism for that (`requireCredentials` + `loginPage.signIn`
 * reading the git-ignored .env). Detecting it lets the generator use that
 * mechanism instead of opening a browser to work out how to log in - which is what
 * made a simple recorded case take minutes and end with a request for a password.
 *
 * `method` is the shape that was recognised, never a credential. There is
 * deliberately no field for an address, a value or a token: this type cannot carry
 * a secret because it has nowhere to put one.
 */
export interface AuthenticationEvidence {
  detected: boolean;
  method?: 'login-form';
  /** What the detection saw, for the review screen. Field names only. */
  evidence?: string;
}

export interface Recording {
  startUrl: string;
  browser: string;
  /**
   * Structural DOM evidence for the recorded targets, when something captured it.
   *
   * Absent on every recording made so far, and `{ available: false, reason }` on any
   * recording whose capture failed - never silently missing. Playwright's `codegen`
   * runs in its own child process with no page handle reachable from here, so
   * capturing this needs a decision about how recording is driven; until then the
   * field is the contract, and the Phase 7 resolver works exactly as before without
   * it. See ai/autocode/dom-evidence.ts.
   */
  evidence: RecordingEvidence;
  /** Detected, never stored: see AuthenticationEvidence. */
  authentication: AuthenticationEvidence;
  actions: RecordedAction[];
  assertions: RecordedAssertion[];
  /** What this cost. `aiCalls` is 0 by construction - see the module comment. */
  metrics: {
    recordingActionCount: number;
    /** Consecutive fills of one field folded into the last value. */
    collapsedFills: number;
    assertionCount: number;
    durationMs: number;
    redactedValues: number;
    aiCalls: 0;
    aiInputTokens: 0;
    aiOutputTokens: 0;
  };
}

interface Session {
  /**
   * Which recorder produced this session.
   *
   * `codegen` is the child process this module has always spawned and remains the
   * default. `live` is a browser this process owns, which is what makes DOM evidence
   * possible; it is attempted only when asked for, and any failure falls back to
   * `codegen` before the person sees anything.
   */
  transport: 'codegen' | 'live';
  live?: LiveSession;
  child?: ChildProcess;
  outputFile: string;
  url: string;
  browser: string;
  startedAt: string;
  startedMs: number;
  /**
   * WHICH APPLICATION THIS RECORDING BELONGS TO, decided before the browser opened.
   *
   * Captured at `startRecording` and never rewritten for the life of the session -
   * that immutability is the point of holding it here rather than deriving it later.
   * A recording navigates: sign-in, then /apps, then an issue, then settings, and a
   * person may type any address into the browser the recorder handed them. If identity
   * were re-derived from wherever the browser ended up, a single navigation could
   * silently move the recording into another application's namespace, and the evidence
   * would be filed there - correctly formed, provably measured, and about the wrong
   * product.
   *
   * So the URL is what the session STARTED at (navigation evidence), and `scope` is
   * what the session IS (identity). The two are never the same question.
   */
  scope: ApplicationScope;
  /** The row this recording is being made for, when the person named one. */
  testCaseId?: string;
  /** Set when the recorder exits on its own, i.e. the person closed the browser. */
  exited: boolean;
  error?: string;
}

let session: Session | null = null;

/**
 * Where a recorded test's Codegen output waits between "Stop" and "Saved".
 *
 * SHORT-LIVED INTERNAL ARTIFACT, not a recording repository. It exists because the
 * deterministic mapper needs Codegen's actual code - the locators it chose - and
 * the test case ID it belongs to does not exist until the row is saved. So the
 * redacted source is held in memory at Stop, written under the ID at Save, and
 * deleted by the mapper once a spec has been assembled from it.
 *
 * Git-ignored, and the file is redacted BEFORE it is written: what lands on disk is
 * safe to open. A failed generation may leave one behind on purpose - that is the
 * one case where somebody needs to look at it - but it can never be committed.
 */
/**
 * APPLICATION-OWNED, and the artefacts are what make it so.
 *
 * The recorder ENGINE is a SHARED_CAPABILITY - one implementation, used by every
 * application - but the script and the three sidecars it writes for each case are
 * `recordings`, an APPLICATION_ARTEFACT. Test Case IDs are unique within an
 * application and meaningless across them, so two applications that both have
 * TC_LOGIN_001 write to one set of file names in one flat directory: the second
 * recording overwrites the first's evidence, and the gate then judges one
 * application's spec against another application's measurements.
 *
 * The suffixes are deliberately not named here. Each is spelled EXACTLY ONCE in this
 * file, in the helper that owns it, and `evidence-persistence.fixture.ts` counts those
 * literals to prove no second path convention has appeared - a doc comment that
 * repeated them would be a second spelling that can drift from the first.
 *
 * Resolved per call, never memoised into a module constant, because the dashboard is
 * one process that can switch applications between recordings.
 */
export const recordingsDir = activeRecordingsDir;

/**
 * The recording waiting to be claimed by the next save. One at a time.
 *
 * `stateAssertions` are the picker's, held UNRE-BASED - exactly as
 * `stop()` returned them. `parseRecording` re-bases `afterActions` against the
 * collapsed action stream, so `recording.assertions` holds re-based copies;
 * persisting those and parsing them again would re-base a second time, and
 * `positionAfter` is not idempotent when repeated fills collapse. The raw ones
 * round-trip through exactly one re-base, which is what makes the reloaded
 * recording identical to the live one.
 */
let pending: {
  source: string; recording: Recording; stateAssertions?: RecordedAssertion[];
  /**
   * The session's LOCKED application context, carried across the Stop/Save gap.
   *
   * `stopRecording` clears `session`, so by the time `keepArtifactFor` runs there is
   * nothing left to ask. Re-deriving it at save time is exactly the mistake this phase
   * removes - the only evidence still available then is the recorded URL. So the
   * decision travels with the recording instead.
   */
  origin?: RecordingOrigin;
} | null = null;

/**
 * `dir` defaults to the ACTIVE scope's store, and the default is not always right.
 *
 * The dashboard is one process serving many requests, so the ambient scope and the
 * scope a particular RECORDING was made in are different questions. A save resolves
 * the directory from the recording's own locked origin and passes it here; everything
 * else - reading an existing artefact, the CLI, the gates - legitimately means "the
 * application this process is working in" and takes the default.
 *
 * Without the parameter a person who selected Flipkart in a process whose ambient
 * application was Bugasura would have their recording written into Bugasura's store:
 * correctly formed, provably measured, and filed under the wrong product.
 */
export function artifactPath(testCaseId: string, dir = recordingsDir()): string {
  return path.join(dir, `${testCaseId.toUpperCase()}.spec.ts`);
}

/**
 * The structured evidence that belongs to that artifact.
 *
 * A sidecar rather than something embedded in the script, because the script has to
 * stay exactly what Codegen wrote - it is parsed as source, and a comment block full
 * of JSON would be a second thing to keep in step. Same directory, same ID, same
 * lifecycle: the ID is the pairing key, so a sidecar can never be read against a
 * different recording.
 */
export function evidencePath(testCaseId: string, dir = recordingsDir()): string {
  return path.join(dir, `${testCaseId.toUpperCase()}.evidence.json`);
}

/**
 * The state assertions a person recorded through the picker, beside the same
 * artifact.
 *
 * A third sidecar, for the same reason as the second: the script has to stay
 * exactly what Codegen wrote. Codegen never sees these - the picker records them
 * on its own channel - so there is nowhere in the script they could live, and
 * P1.2c is what happens without this file. TC_LOGIN_075 captured `checked:false`
 * then `checked:true`, both correct in memory, both written into the workbook's
 * Expected Result as prose, and neither one anywhere on disk as structure. The
 * save wrote the script and the evidence; generation re-read the script, found no
 * `expect(` in it, and reported "the recording contains no assertion".
 */
export function assertionsPath(testCaseId: string, dir = recordingsDir()): string {
  return path.join(dir, `${testCaseId.toUpperCase()}.assertions.json`);
}

/**
 * Attach the recording just stopped to the test case that was just saved.
 *
 * Called from the save path with the ID the workbook actually got. Returns the
 * artifact path when one was written, so the caller can say so.
 */
export function keepArtifactFor(testCaseId: string): string | null {
  if (!pending)
    return null;
  const held = pending;
  pending = null;
  return persistRecording(testCaseId, held.source, held.recording.evidence, held.stateAssertions,
      held.origin);
}

/**
 * Write a recording's two files: the script, and its evidence when there is any.
 *
 * Extracted from `keepArtifactFor` so a test can drive the REAL persistence without a
 * browser. That matters more than it looks: the first version of this write was lost
 * to a patch that silently did not apply, and the fixture of the day could not notice
 * because it created the sidecar itself before asserting on it. A test that builds the
 * thing it is testing proves nothing.
 *
 * The stale removal is unconditional and comes FIRST. A sidecar left from an earlier
 * recording of the same Test Case ID would otherwise be paired with this one - evidence
 * describing a page nobody just recorded, which is worse than no evidence at all.
 */
export function persistRecording(
  testCaseId: string,
  source: string,
  evidence: RecordingEvidence,
  stateAssertions?: RecordedAssertion[],
  origin?: RecordingOrigin,
): string | null {
  try {
    // THE RECORDING'S OWN APPLICATION, not the one this process happens to be in.
    // `origin.applicationId` was locked before the browser opened; resolving the store
    // from it is what keeps a save in the project the person actually selected.
    const dir = origin
      ? resolveScope({ applicationId: origin.applicationId }).paths.recordingsDir
      : recordingsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = artifactPath(testCaseId, dir);
    fs.writeFileSync(file, source, 'utf8');

    // The picker's assertions, on the same terms as the evidence: removed first,
    // written only when there are some, and never allowed to fail the save. An
    // empty list writes no file, so "recorded nothing" and "recorded before this
    // existed" stay the same state on disk rather than two.
    const assertions = assertionsPath(testCaseId, dir);
    fs.rmSync(assertions, { force: true });
    if (stateAssertions?.length) {
      try {
        fs.writeFileSync(assertions, JSON.stringify(stateAssertions, null, 2), 'utf8');
      } catch {
        // Same rule as the evidence sidecar: an unwritten one degrades to the
        // behaviour before it existed. A save must never fail over a sidecar.
      }
    }

    const sidecar = evidencePath(testCaseId, dir);
    // Always, before deciding whether to write a new one.
    fs.rmSync(sidecar, { force: true });
    if (evidence.available) {
      try {
        // Ownership is stamped HERE rather than at capture, because it is a fact about
        // the SESSION and the capture layer has no business knowing about projects.
        // `testCaseId` is only known now - the row does not exist until the save - so
        // this is the first moment the whole origin can be written down.
        if (origin)
          (evidence as { origin?: RecordingOrigin }).origin = { ...origin, testCaseId };
        // Already redacted and bounded by `sanitiseEvidence` before it reached this
        // object; nothing is re-filtered here, because a second redaction
        // implementation is a second thing to get wrong.
        fs.writeFileSync(sidecar, JSON.stringify(evidence, null, 2), 'utf8');
      } catch {
        // Evidence is an optimisation. A save must never fail over it, and an
        // unwritten sidecar degrades to exactly the pre-Phase-8 behaviour.
      }
    }
    return path.relative(ROOT, file).replace(/\\/g, '/');
  } catch {
    // A missing artifact costs the deterministic path, not correctness: generation
    // falls back to the existing behaviour. Never worth failing a save over.
    return null;
  }
}

/** Read a kept artifact back. Null when there is none for this case. */
export function readArtifact(testCaseId: string): string | null {
  try {
    return fs.readFileSync(artifactPath(testCaseId), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Delete it. Called when a recording is genuinely finished with.
 *
 * All three files, always together. A sidecar left behind would be paired by ID
 * with whatever is recorded for that case next - evidence describing a page nobody
 * recorded, or assertions nobody made, which is worse than having neither.
 *
 * ACCEPTANCE NO LONGER CALLS THIS - see `archiveArtifact`.
 */
export function discardArtifact(testCaseId: string): void {
  fs.rmSync(artifactPath(testCaseId), { force: true });
  fs.rmSync(evidencePath(testCaseId), { force: true });
  fs.rmSync(assertionsPath(testCaseId), { force: true });
}

/**
 * Where an accepted recording's provenance lives.
 *
 * A subdirectory, so the active queue is unchanged: every scan of the recordings
 * folder reads `*.spec.ts` at the top level and never recurses, so an archived
 * recording cannot be mistaken for one waiting to be generated.
 */
export const acceptedDir = activeAcceptedDir;

/**
 * Every artefact belonging to one recording, by the SAME helpers that create them.
 *
 * ONE PATH CONVENTION, and this list is why. Naming the suffixes again here would put
 * a second definition of "what an evidence file is called" in the file, and a sidecar
 * read against the wrong recording is the failure that convention exists to prevent.
 * So the archive derives from the live paths rather than restating them - the only
 * literal is the authoring sidecar, which `case-status.ts` owns and which has no
 * helper here to borrow.
 */
function liveArtefacts(testCaseId: string): string[] {
  return [
    artifactPath(testCaseId),
    evidencePath(testCaseId),
    assertionsPath(testCaseId),
    path.join(recordingsDir(), `${testCaseId.toUpperCase()}.authoring.json`),
  ];
}

/** The archived counterpart of one artefact: same file name, archive directory. */
export function archivedPath(testCaseId: string, suffix: string): string {
  const live = liveArtefacts(testCaseId).find(file => file.endsWith(suffix));
  return path.join(acceptedDir(), path.basename(live ?? `${testCaseId.toUpperCase()}${suffix}`));
}

/**
 * Keep the provenance of an accepted recording instead of destroying it.
 *
 * WHY THIS REPLACED A DELETE. Acceptance used to call `discardArtifact`, on the
 * reasoning that a recording had "served its purpose" once a spec was built from it.
 * That reasoning holds only until somebody needs to ask a question of the spec later -
 * and the strict-mode audit is exactly that. Twenty-seven accepted tests carry
 * locators nobody can now repair, because the evidence that would have proved a safe
 * alternative was deleted at the moment the test passed. A test is not finished with
 * its evidence; a test is the CLAIM, and the evidence is why the claim is believed.
 *
 * MOVED, NOT COPIED, so nothing is duplicated and the active queue is left clean.
 * IDEMPOTENT: re-accepting a case overwrites its own archive, because there is one
 * accepted spec per case and the archive mirrors it. Running it twice with nothing
 * left to move is a no-op rather than an error.
 *
 * EVIDENCE IS NEVER REWRITTEN HERE. The bytes that arrive are the bytes that are
 * kept; this function moves files and does nothing else to them.
 */
export function archiveArtifact(testCaseId: string): void {
  fs.mkdirSync(acceptedDir(), { recursive: true });
  for (const from of liveArtefacts(testCaseId)) {
    if (!fs.existsSync(from))
      continue;
    const to = path.join(acceptedDir(), path.basename(from));
    fs.rmSync(to, { force: true });
    fs.renameSync(from, to);
  }
}

/** An archived recording's script, or null. Never consulted by the generation queue. */
export function readArchivedArtifact(testCaseId: string): string | null {
  try {
    return fs.readFileSync(
        path.join(acceptedDir(), path.basename(artifactPath(testCaseId))), 'utf8');
  } catch {
    return null;
  }
}

export function recordingStatus(): {
  recording: boolean; startedAt?: string; url?: string; browser?: string; browserClosed?: boolean;
  error?: string; applicationId?: string; environmentId?: string; displayName?: string; testCaseId?: string;
} {
  if (!session)
    return { recording: false };
  return {
    recording: true,
    startedAt: session.startedAt,
    url: session.url,
    browser: session.browser,
    // The LOCKED identity, so the page can show which application is being recorded
    // rather than leaving a person to infer it from the address bar - which is the
    // inference this phase removed everywhere else.
    applicationId: session.scope.applicationId,
    environmentId: session.scope.environmentId,
    displayName: session.scope.displayName,
    ...(session.testCaseId ? { testCaseId: session.testCaseId } : {}),
    // The recorder can end without anyone pressing Stop - the browser has its own
    // close button. Saying so is the difference between "still going" and "waiting
    // for you to press Stop on something that already finished".
    browserClosed: session.exited,
    error: session.error,
  };
}

/** Playwright's CLI, resolved the same way every other caller here resolves it. */
function playwrightCli(): string {
  return path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
}

/**
 * Start a recording INSIDE a chosen application.
 *
 * `scope` is required and comes from the dashboard's project/environment selection.
 * It is not optional and it is not derived: a caller that cannot say which application
 * it is recording has not made the decision yet, and guessing it from `url` is the one
 * thing this whole phase exists to remove.
 *
 * `url` stays a parameter because a person may legitimately start deeper than the
 * application's front door - on a specific issue, or a settings page. When it is
 * omitted the environment's own `baseUrl` is used, which is the normal case and the
 * one that makes the selection do real work: choose Bugasura + QA and the recorder
 * opens Bugasura's QA address without anybody typing it.
 */
export async function startRecording(options: {
  scope: ApplicationScope;
  url?: string;
  browser: string;
  testCaseId?: string;
}): Promise<{ started: boolean; error?: string; transport?: 'codegen' | 'live';
  applicationId?: string; environmentId?: string; url?: string }> {
  if (session)
    return { started: false, error: 'A recording is already in progress. Stop it first.' };

  if (!options.scope?.applicationId) {
    return { started: false,
      error: 'No project was selected. A recording is made INSIDE an application, and the '
        + 'application is chosen, never inferred from the address.' };
  }

  // The environment's declared address is the default, so the selection is what opens
  // the browser. An explicit url only ever narrows WHERE in the application to start;
  // it never decides WHICH application, and nothing below reads it for identity.
  const url = (options.url ?? '').trim() || options.scope.baseUrl;
  // Only http(s), and parsed rather than pattern-matched: this string becomes an
  // argument to a browser, and `file://` or `javascript:` are not recordings.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { started: false, error: `"${url}" is not a URL. Include the scheme, e.g. https://app.example.com/` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return { started: false, error: 'Only http:// and https:// addresses can be recorded.' };

  const browser = BROWSERS[options.browser] ?? 'chromium';
  const outputFile = path.join(os.tmpdir(),
      `recording-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.spec.ts`);

  // The live transport, when it is asked for AND available. `startLiveRecording`
  // returns null for every failure - a Playwright build without `_enableRecorder`, a
  // browser that will not launch, a recorder that refuses - and the codegen path
  // below then runs exactly as it always has. Recording never fails because evidence
  // capture is unavailable.
  if (liveTransportRequested()) {
    const live = await startLiveRecording({
      url: parsed.toString(),
      browser,
      onLog: text => process.stdout.write(`  [recorder] ${text}`),
    });
    if (live) {
      session = {
        transport: 'live', live, outputFile, url: parsed.toString(), browser: options.browser,
        startedAt: new Date().toISOString(), startedMs: Date.now(), exited: false,
        scope: options.scope, testCaseId: options.testCaseId,
      };
      return { started: true, transport: 'live', applicationId: options.scope.applicationId,
        environmentId: options.scope.environmentId, url: parsed.toString() };
    }
    process.stdout.write('  [recorder] falling back to the codegen recorder; '
      + 'this recording will carry no DOM evidence\n');
  }

  // argv array, shell:false - the rule this whole subsystem follows. The URL is one
  // argument and is never concatenated into a command line.
  const child = spawn(process.execPath, [
    playwrightCli(), 'codegen',
    '--target', 'playwright-test',
    '--browser', browser,
    '--output', outputFile,
    parsed.toString(),
  ], { cwd: ROOT, shell: false, env: { ...process.env, FORCE_COLOR: '0' } });

  const started: Session = {
    transport: 'codegen', child, outputFile, url: parsed.toString(), browser: options.browser,
    startedAt: new Date().toISOString(), startedMs: Date.now(), exited: false,
    scope: options.scope, testCaseId: options.testCaseId,
  };
  session = started;

  child.on('error', error => { started.exited = true; started.error = error.message; });
  child.on('close', () => { started.exited = true; });
  // Codegen's own chatter is not interesting and could echo a page's contents.
  child.stdout?.resume();
  child.stderr?.resume();

  return { started: true, transport: 'codegen', applicationId: options.scope.applicationId,
    environmentId: options.scope.environmentId, url: parsed.toString() };
}

/**
 * The application a recording is being made in, or null when nothing is recording.
 *
 * READ-ONLY BY CONSTRUCTION. There is deliberately no setter: the only way to change
 * the application is to stop this recording and start another, which is exactly the
 * decision a person should have to make. Everything that files an artefact for the
 * recording in progress asks here, so there is one answer rather than one per caller.
 */
export function recordingScope(): ApplicationScope | null {
  return session?.scope ?? null;
}

/** The row the recording in progress was started for, if the person named one. */
export function recordingTestCaseId(): string | null {
  return session?.testCaseId ?? null;
}

/**
 * The session's application context, as a record that outlives the session.
 *
 * Read from `Session.scope` - the value chosen before the browser opened - and never
 * from `session.url`. That is the whole distinction this phase installs: the URL says
 * where the browser went, the scope says which application it was.
 */
function originOf(current: Session): RecordingOrigin {
  return {
    applicationId: current.scope.applicationId,
    environmentId: current.scope.environmentId,
    baseUrl: current.scope.baseUrl,
    ...(current.testCaseId ? { testCaseId: current.testCaseId } : {}),
    browser: current.browser,
    startedAt: current.startedAt,
  };
}

/** Wait for the recorder to exit, so its output file is complete. */
async function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    child.once('close', done);
  });
}

export async function stopRecording(): Promise<{ recording?: Recording; error?: string }> {
  if (!session)
    return { error: 'No recording is in progress.' };
  const current = session;
  session = null;

  // The live transport collects its own source AND the evidence it captured while
  // the person was recording. Everything after this point is identical for both
  // transports: the same parser, the same redaction, the same pending artifact.
  if (current.transport === 'live' && current.live) {
    // Derived from `stop()` rather than restated: the hand-written annotation had
    // omitted `stateAssertions`, which the live recorder has always returned.
    let collected: Awaited<ReturnType<LiveSession['stop']>>;
    try {
      collected = await current.live.stop();
    } catch (error) {
      // A failure to collect must not lose the recording outright, but there is
      // nothing to parse either - say so plainly rather than returning an empty one.
      return { error: `The live recorder could not be stopped cleanly: ${String(error).slice(0, 160)}` };
    }
    const liveRecording = parseRecording(collected.source, {
      startUrl: current.url,
      browser: current.browser,
      durationMs: Date.now() - current.startedMs,
      evidence: collected.evidence,
      stateAssertions: collected.stateAssertions,
    });
    if (!liveRecording.actions.length && !liveRecording.assertions.length)
      return { error: 'Nothing was recorded. No actions were captured before the browser closed.' };
    pending = {
      source: redactSource(collected.source, liveRecording),
      recording: liveRecording,
      stateAssertions: collected.stateAssertions,
      origin: originOf(current),
    };
    return { recording: liveRecording };
  }

  if (!current.exited && current.child) {
    current.child.kill();
    await waitForExit(current.child);
  }

  let source = '';
  try {
    source = fs.readFileSync(current.outputFile, 'utf8');
  } catch {
    // No file at all: the browser was closed before anything was recorded, or it
    // never started. Both are the same thing to the person waiting.
    return {
      error: current.error
        ? `The recorder could not start: ${current.error}`
        : 'Nothing was recorded. The browser closed before any action was captured.',
    };
  } finally {
    // The script is an input, not an artefact. It is gone whatever happened next.
    fs.rmSync(current.outputFile, { force: true });
  }

  const recording = parseRecording(source, {
    startUrl: current.url,
    browser: current.browser,
    durationMs: Date.now() - current.startedMs,
  });

  if (!recording.actions.length && !recording.assertions.length)
    return { error: 'Nothing was recorded. No actions were captured before the browser closed.' };

  // Hold the REDACTED source for the save that follows. Redacted first and always:
  // the artifact that reaches disk must be safe to open, so the literal Codegen
  // wrote into a `.fill()` never gets that far.
  pending = { source: redactSource(source, recording), recording, origin: originOf(current) };

  return { recording };
}

/**
 * Replace every captured secret in Codegen's own source before it is kept.
 *
 * Works from the parsed recording rather than by re-scanning the text: the parser
 * already decided which values were sensitive, using both guards, so redaction here
 * cannot disagree with redaction there. Each redacted action's literal is replaced
 * inside its own `.fill(...)` call, which keeps the file valid TypeScript and
 * leaves everything else - the locators, the structure, the assertions - intact for
 * the mapper to read.
 */
function redactSource(source: string, recording: Recording): string {
  let out = source;
  for (const action of recording.actions) {
    if (!action.redacted || !action.locator)
      continue;
    // Only the fill on THIS locator, and only its argument.
    const escaped = action.locator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
        new RegExp(`(${escaped}\\s*\\.\\s*fill\\s*\\()(['"\`])(?:\\\\.|(?!\\2)[^\\\\])*\\2`, 'g'),
        `$1'${PLACEHOLDER}'`);
  }
  // Belt and braces: if a secret this process holds still appears anywhere in the
  // file - a URL, a comment, a form somewhere the parser did not model - it goes.
  for (const name of knownSecretNames()) {
    const secret = process.env[name];
    if (secret && secret.length >= 4)
      out = out.split(secret).join(PLACEHOLDER);
  }
  return out;
}

/** True when a recording is waiting to be claimed by a save. */
export function hasPendingRecording(): boolean {
  return pending !== null;
}

/**
 * Exported for the security test, which must exercise the REAL redaction rather than
 * a copy of it. Testing a reimplementation of a security control proves only that the
 * reimplementation works - the same reasoning as `hasWordForTest` in page-knowledge.
 */
export function redactSourceForTest(source: string, recording: Recording): string {
  return redactSource(source, recording);
}

/* ------------------------------------------------------------------ parsing */

/**
 * The last method call on a line, and everything before it.
 *
 * Locator chains contain their own brackets and quotes, so the receiver cannot be
 * matched by a non-greedy pattern from the left - `getByRole('button', { name: 'x' })`
 * defeats it. Reading the call at the END and treating the rest as the receiver is
 * unambiguous for the shape codegen emits.
 */
function splitCall(line: string): { receiver: string; method: string; args: string } | null {
  const match = /^(.*)\.([A-Za-z]+)\((.*)\)\s*;?\s*$/.exec(line.trim());
  if (!match)
    return null;
  return { receiver: match[1].trim(), method: match[2], args: match[3] };
}

/** Every quoted string in an argument list, in order, unquoted. */
function allStrings(args: string): string[] {
  const found: string[] = [];
  const pattern = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const match of args.matchAll(pattern))
    found.push(match[2].replace(/\\(['"`\\])/g, '$1'));
  return found;
}

/** First quoted string in an argument list, with its quoting removed. */
function firstString(args: string): string | null {
  const match = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(args);
  return match ? match[2].replace(/\\(['"`\\])/g, '$1') : null;
}

/** `{ name: 'Sign In' }` -> `Sign In`. */
function optionName(args: string): string | null {
  const match = /name\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(args);
  return match ? match[2].replace(/\\(['"`\\])/g, '$1') : null;
}

const LOCATOR_METHODS = [
  'getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'getByTestId',
  'getByAltText', 'getByTitle', 'locator', 'frameLocator',
];

/**
 * A name a person would recognise, and the strategy that found it.
 *
 * Codegen's locator is kept verbatim (`locator`) - rewriting it here would throw
 * away the one thing it is good at. This only extracts something readable for the
 * review screen and the workbook's Steps column.
 */
function describeLocator(chain: string): { target: string; strategy: string } {
  for (const method of LOCATOR_METHODS) {
    const at = chain.indexOf(`.${method}(`);
    if (at === -1)
      continue;
    const args = chain.slice(at + method.length + 2);
    const named = method === 'getByRole' ? optionName(args) ?? firstString(args) : firstString(args);
    return { target: named ?? method, strategy: method };
  }
  return { target: chain.replace(/^page\./, ''), strategy: 'locator' };
}

/**
 * Words that mark a field as holding something that must not be written down.
 * Matched against the human-readable target AND the raw locator, so both
 * `getByLabel('Password')` and `locator('input[type="password"]')` are caught.
 */
const SENSITIVE = /password|passwd|pwd|secret|token|otp|cvv|credit\s*card|card\s*number/i;
const PLACEHOLDER = '[type=password]';

/** Names only: configuration declares credentials; conventional names cover service tokens. */
function knownSecretNames(): Set<string> {
  const names = new Set(Object.keys(process.env).filter(name =>
    /(?:^|_)(?:PASSWORD|PASSWD|PWD|TOKEN|SECRET|API_KEY|PRIVATE_KEY)(?:_|$)/i.test(name)));
  const file = registryFile();
  if (fs.existsSync(file)) {
    for (const application of readRegistry(file).applications) {
      for (const environment of Object.values(application.environments)) {
        if (environment.credentials?.password)
          names.add(environment.credentials.password);
      }
    }
  }
  return names;
}

/**
 * Secrets this process already holds, so a value typed into an oddly-labelled
 * field is still caught.
 *
 * Read at call time rather than cached, and only ever compared - never returned,
 * logged, or included in a message. The comparison result is a boolean and the
 * caller is told nothing beyond "this was redacted".
 */
function looksLikeAKnownSecret(value: string): boolean {
  if (!value)
    return false;
  for (const name of knownSecretNames()) {
    const secret = process.env[name];
    if (secret && secret.length >= 4 && value === secret)
      return true;
  }
  return false;
}

/** The one place a captured value is allowed through, and the two tests it must pass. */
function safeValue(value: string | null, target: string, locator: string): { value: string | null; redacted: boolean } {
  if (value === null)
    return { value: null, redacted: false };
  if (SENSITIVE.test(target) || SENSITIVE.test(locator) || looksLikeAKnownSecret(value))
    return { value: PLACEHOLDER, redacted: true };
  return { value, redacted: false };
}

const ACTIONS: Record<string, RecordedAction['type']> = {
  click: 'click', dblclick: 'dblclick', fill: 'fill', type: 'fill', press: 'press',
  check: 'check', uncheck: 'uncheck', selectOption: 'select', hover: 'hover',
};

/**
 * Playwright's matcher names, and what each one claims.
 *
 * `positive` is the polarity the matcher ITSELF carries, before any `.not.`:
 * `toBeDisabled()` is the `enabled` question answered no. The two combine by
 * exclusive-or, so `.not.toBeDisabled()` is `enabled: true` - which is what it
 * says, and what a table of type names alone could never express.
 */
const MATCHERS: Record<string, { type: RecordedAssertion['type']; positive: boolean }> = {
  toBeVisible: { type: 'visible', positive: true },
  toBeHidden: { type: 'hidden', positive: true },
  toHaveText: { type: 'text', positive: true },
  toContainText: { type: 'contains', positive: true },
  toHaveValue: { type: 'value', positive: true },
  toHaveValues: { type: 'values', positive: true },
  toBeChecked: { type: 'checked', positive: true },
  toHaveURL: { type: 'url', positive: true },
  toHaveCount: { type: 'count', positive: true },
  toHaveTitle: { type: 'title', positive: true },
  // Playwright's own recorder emits this whenever "assert value" is used on an
  // empty field. It was not in this table, so every one of those assertions was
  // silently dropped - the person recorded a check and the spec contained none.
  toBeEmpty: { type: 'empty', positive: true },
  toBeEnabled: { type: 'enabled', positive: true },
  toBeDisabled: { type: 'enabled', positive: false },
  toHaveAttribute: { type: 'attribute', positive: true },
  toHaveClass: { type: 'class', positive: true },
};

/**
 * The index of the `)` that closes the `(` at `open`, ignoring brackets inside
 * string literals.
 *
 * `getByText('a)b')` is why this cannot be a regex or a `lastIndexOf`. Escapes
 * are honoured so `getByText('it\'s (here)')` does not end the scan early.
 */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let index = open; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === '\\') {
        index++;
        continue;
      }
      if (character === quote)
        quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
      if (depth === 0)
        return index;
    }
  }
  return -1;
}

/**
 * Split `expect(<locator>)` or `expect(<locator>).not` into its two facts.
 *
 * STRUCTURAL, not textual. The locator is taken from between the parentheses
 * that actually match, so it survives byte-for-byte whatever brackets and
 * quotes it contains; the modifier is whatever remains after them, and only two
 * remainders are accepted. `.soft`, `.resolves`, `.poll` and anything else
 * return null - the line is then not treated as an assertion at all, which is
 * the honest answer for a form this parser has never been taught. Guessing
 * would put a claim in a spec that nobody made.
 */
export function parseExpectReceiver(receiver: string): { chain: string; negated: boolean } | null {
  if (!receiver.startsWith('expect('))
    return null;
  const close = matchingParen(receiver, 'expect('.length - 1);
  if (close < 0)
    return null;
  const chain = receiver.slice('expect('.length, close).trim();
  if (!chain)
    return null;
  const tail = receiver.slice(close + 1).trim();
  if (tail === '')
    return { chain, negated: false };
  if (tail === '.not')
    return { chain, negated: true };
  return null;
}

export function parseRecording(
  source: string,
  context: {
    startUrl: string; browser: string; durationMs: number; evidence?: RecordingEvidence;
    /**
     * State assertions the person recorded through the in-page picker.
     *
     * They arrive already structured - a capability the resolver offered, an
     * `expected`, and the position in the action stream where they were made -
     * because they were never text. Codegen knows nothing about them, so they
     * are merged here rather than read out of its script.
     */
    stateAssertions?: RecordedAssertion[];
  },
): Recording {
  const actions: RecordedAction[] = [];
  /**
   * Which raw script line each KEPT action came from.
   *
   * The two kinds of assertion in a recording count their positions in different
   * spaces, and that only matters once something is actually dropped. A Codegen
   * `expect(...)` line counts kept actions - it is read off `actions.length` below,
   * after any drop. The picker's assertions count RAW script lines, because
   * `countRecordedActions` reads the file Codegen is writing and cannot know which
   * of those lines this parser will keep.
   *
   * While `isRecorderOwnAction` matched nothing the two spaces were identical, so
   * merging them was harmless. Closing the picker's shadow root (P1.2d) makes the
   * drop real, and without this map every picker assertion would slide backwards by
   * the number of picker clicks recorded before it.
   */
  const rawLineOfAction: number[] = [];
  let rawActionLines = 0;
  const assertions: RecordedAssertion[] = [];
  let redactedValues = 0;

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('await '))
      continue;
    const body = line.slice('await '.length);

    // The picker counted its positions against the RAW script, including the lines
    // this parser is about to drop. `countRecordedActions` counts every `await`
    // that is not an expect, so this counter has to be the same one - incremented
    // for a dropped picker click exactly as for a kept application action.
    if (!line.startsWith('await expect('))
      rawActionLines += 1;

    // Navigation is the one call whose receiver is the page itself.
    const goto = /^page\.goto\((['"`])(.*?)\1/.exec(body);
    if (goto) {
      actions.push({
        type: 'navigate', target: goto[2], locator: '', locatorStrategy: 'url', value: goto[2],
      });
      rawLineOfAction.push(rawActionLines);
      continue;
    }

    const call = splitCall(body);
    if (!call)
      continue;

    // An assertion: expect(<locator>).<matcher>(...) or expect(<locator>).not.<matcher>(...)
    const expectation = MATCHERS[call.method] ? parseExpectReceiver(call.receiver) : null;
    if (expectation) {
      const chain = expectation.chain;
      const described = describeLocator(chain);
      const value = firstString(call.args) ?? (call.args.trim() || null);
      const safe = safeValue(value, described.target, chain);
      if (safe.redacted)
        redactedValues += 1;
      const matcher = MATCHERS[call.method];
      // An attribute assertion names the attribute first and expects the value
      // second: `toHaveAttribute('data-state', 'open')`. The name is not a value
      // and never goes through redaction - it cannot be a secret, and blanking it
      // would leave an assertion about nothing.
      const strings = allStrings(call.args);
      assertions.push({
        type: matcher.type,
        target: described.target,
        locator: chain,
        locatorStrategy: described.strategy,
        // A `values` assertion carries its list and nothing else: leaving the
        // first option in `value` too would give one assertion two homes for the
        // same fact, and a later reader no way to know which one won.
        value: matcher.type === 'attribute' ? (strings[1] ?? null)
          : matcher.type === 'values' ? null : safe.value,
        ...(matcher.type === 'attribute' && strings[0] ? { name: strings[0] } : {}),
        ...(matcher.type === 'values' ? { values: strings } : {}),
        // The matcher's own polarity, flipped when the line said `.not.`.
        expected: expectation.negated ? !matcher.positive : matcher.positive,
        // Read off the action stream as it is built, so it survives whatever the
        // caller does to either array afterwards.
        afterActions: actions.length,
      });
      continue;
    }

    // The recorder's own overlay, not the application.
    //
    // While assert mode is on, the selection click lands on `ba-aura-assert` -
    // which is the point, because the application must not receive it - and
    // Codegen records that click like any other. It describes the recorder, not
    // the test, so it is dropped here rather than replayed against a page that
    // will never have an assert overlay on it.
    if (call.receiver.startsWith('page.') && ACTIONS[call.method]
      && isRecorderOwnAction(call.receiver))
      continue;

    // An action: page.<locator>.<method>(...)
    if (call.receiver.startsWith('page.') && ACTIONS[call.method]) {
      const described = describeLocator(call.receiver);
      const raw = ACTIONS[call.method] === 'click' || ACTIONS[call.method] === 'check'
        || ACTIONS[call.method] === 'uncheck' || ACTIONS[call.method] === 'hover'
        ? null
        : firstString(call.args);
      const safe = safeValue(raw, described.target, call.receiver);
      if (safe.redacted)
        redactedValues += 1;
      actions.push({
        type: ACTIONS[call.method],
        target: described.target,
        locator: call.receiver,
        locatorStrategy: described.strategy,
        value: safe.value,
        ...(safe.redacted ? { redacted: true } : {}),
      });
      rawLineOfAction.push(rawActionLines);
    }
  }

  collapseAssociatedToggles(actions, rawLineOfAction, assertions, context.evidence);

  const collapsed = collapseRepeatedFills(actions);
  // Positions were counted against the raw stream, and collapsing shortened it.
  // Re-basing them here rather than at the point of use keeps every consumer of a
  // Recording looking at one consistent set of indices.
  // The picker's assertions counted their position against the same raw action
  // stream, so they re-base with the rest. They are appended before re-basing
  // rather than after, so one rule places every assertion in a recording however
  // it was made.
  //
  // A picker position is a count of raw script lines, so it becomes a count of KEPT
  // actions first: every action written at or before that line, the dropped ones
  // simply not being there. That also makes it immune to the race it is read in -
  // Codegen flushes asynchronously, so an assertion may be recorded before or after
  // its own picker click reaches the file, and both answers map to the same place.
  const keptBy = (rawLine: number): number =>
    rawLineOfAction.filter(at => at <= rawLine).length;
  const fromPicker = (context.stateAssertions ?? []).map(assertion =>
    (assertion.afterActions === undefined
      ? assertion
      : { ...assertion, afterActions: keptBy(assertion.afterActions) }));

  const everything = [...assertions, ...fromPicker];
  const placed = everything.map(assertion => (assertion.afterActions === undefined
    ? assertion
    : { ...assertion, afterActions: collapsed.positionAfter[assertion.afterActions] ?? collapsed.actions.length }));

  return {
    startUrl: context.startUrl,
    browser: context.browser,
    // Said, not omitted. `codegen` is a separate process and this parser only ever
    // sees the script it wrote, so there is nothing here to capture from.
    evidence: context.evidence ?? evidenceUnavailable(
        'no DOM evidence was captured: parsed from the Codegen script alone'),
    authentication: detectAuthentication(collapsed.actions),
    actions: collapsed.actions,
    assertions: placed,
    metrics: {
      recordingActionCount: collapsed.actions.length,
      /** Keystroke-level duplicate fills folded into their final value. */
      collapsedFills: collapsed.collapsed,
      assertionCount: assertions.length,
      durationMs: context.durationMs,
      redactedValues,
      aiCalls: 0,
      aiInputTokens: 0,
      aiOutputTokens: 0,
    },
  };
}

/**
 * Collapse consecutive fills of the SAME field down to the last one.
 *
 * Codegen records typing as it happens, so a person typing an email address can
 * produce seven `fill` actions on one field - `ma`, `maneeswar`, `maneeswar.`, and
 * so on to the finished value. Every one of them is a real captured action and none
 * of them is a step anybody would write down: only the final value matters, and the
 * intermediate ones make the review screen and the workbook's Steps column nonsense.
 * A real recording in this project produced exactly that (thirteen steps, seven of
 * them the same email field).
 *
 * Only CONSECUTIVE fills on the same locator collapse, and only the last value
 * survives. Filling a field, doing something else, then coming back to it is a
 * different thing - two deliberate edits - and both are kept.
 *
 * Deterministic, no model, and reversible by the person reviewing: the collapsed
 * count is reported so nothing is quietly discarded.
 */
function collapseRepeatedFills(actions: RecordedAction[]): {
  actions: RecordedAction[];
  collapsed: number;
  /** For each raw action count 0..n, how many actions remain after collapsing. */
  positionAfter: number[];
} {
  const kept: RecordedAction[] = [];
  let collapsed = 0;
  // positionAfter[i] = length of `kept` once the first i raw actions are processed,
  // which is exactly what an assertion recorded after i actions should point at.
  const positionAfter: number[] = [0];
  for (const action of actions) {
    const previous = kept[kept.length - 1];
    if (action.type === 'fill' && previous?.type === 'fill' && previous.locator === action.locator) {
      kept[kept.length - 1] = action;   // the newer value replaces the older one
      collapsed += 1;
      positionAfter.push(kept.length);
      continue;
    }
    kept.push(action);
    positionAfter.push(kept.length);
  }
  return { actions: kept, collapsed, positionAfter };
}

/**
 * Did the person sign in during this recording?
 *
 * The signal is a shape, not a value: something was typed into a field this module
 * REDACTED (so it was a password, by either guard), and a control was pressed
 * afterwards. That is a login form being submitted. No address, no secret and no
 * token is read to decide it, which is why this function cannot leak one.
 *
 * A redacted fill with nothing pressed afterwards is not a sign-in - it might be a
 * change-password form, or a field somebody clicked into and left. Requiring the
 * submit keeps the detection to what was actually completed.
 */
function detectAuthentication(actions: RecordedAction[]): AuthenticationEvidence {
  const secretAt = actions.findIndex(action => action.type === 'fill' && action.redacted === true);
  if (secretAt === -1)
    return { detected: false };

  const submitted = actions.slice(secretAt + 1)
      .some(action => action.type === 'click' || action.type === 'press');
  if (!submitted)
    return { detected: false };

  // Field NAMES only - the review screen shows what was recognised, never what
  // was typed into it.
  const fields = actions
      .slice(0, secretAt + 1)
      .filter(action => action.type === 'fill')
      .map(action => action.target);

  return {
    detected: true,
    method: 'login-form',
    evidence: `a sign-in form was filled in and submitted (${fields.join(', ')})`,
  };
}

/* ------------------------------------------------------- recording -> draft */

const ARTICLE = /^(the|a|an)\s+/i;

function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}

/** One human-readable line per recorded action, for the workbook's Steps column. */
export function stepsFrom(recording: Recording): string[] {
  return recording.actions.map(action => {
    switch (action.type) {
      case 'navigate': return `Open ${action.value}`;
      case 'click': return `Click ${action.target}`;
      case 'dblclick': return `Double-click ${action.target}`;
      case 'hover': return `Hover over ${action.target}`;
      case 'press': return `Press ${action.value} in ${action.target}`;
      case 'check': return `Tick ${action.target}`;
      case 'uncheck': return `Untick ${action.target}`;
      case 'select': return `Choose ${action.value} in ${action.target}`;
      case 'fill': return `Enter the ${action.target.toLowerCase().replace(ARTICLE, '')}`;
      default: return `${action.type} ${action.target}`;
    }
  });
}

/**
 * The workbook's word for "the password comes from the environment".
 *
 * `ai/excel/data-driven.ts` owns this vocabulary - `parseToken` is the authority,
 * and it already resolves this to `{ kind: 'validPassword' }`, which
 * `tests-e2e/support/data-driven.ts` reads from `.env` at run time. Nothing new is
 * invented here; the recorder simply says what the workbook already understands.
 *
 * Deliberately NOT the same string as `PLACEHOLDER`. The two mean different things
 * and are read by different code: `[type=password]` is the redaction marker, shown
 * in the steps table and written into the kept artifact, and it says *a value was
 * captured and thrown away*. This one is a workbook token and says *fetch the value
 * from the environment*. Collapsing them would make the marker executable.
 */
const CREDENTIAL_TOKEN = '<valid-password>';

/**
 * The data a filled field carried, as `name = value` lines.
 *
 * Deliberately separate from the Steps: a step is what somebody did, and the data
 * is what they did it with.
 *
 * A redacted field becomes `<valid-password>` rather than the redaction marker,
 * and the reason is that the marker is not a value: `parseToken` reads anything
 * outside angle brackets as a literal, so `password = [type=password]` reached
 * `credentialProblems` as "a credential typed into the workbook" and every recorded
 * sign-in was refused at save time. Neither string is a password - one of them is
 * merely a string the workbook knows how to resolve.
 *
 * Gated on `authentication.detected`, not on `redacted` alone. The detector proves
 * a sign-in form was filled in and submitted; it does not prove the sign-in
 * succeeded, and it says nothing at all about a redacted field that was never
 * submitted (a change-password form, a field somebody clicked into and left).
 * Naming that `<valid-password>` would be a claim about a flow nothing recognised.
 *
 * Note this leaves `Assert Outcome` blank, which in this framework means "the
 * assertion lives in a spec" - so a recorded row goes to the generator, exactly
 * like any other spec-backed case, rather than becoming a data-driven contract.
 * On that path the token is never resolved: the generated spec authenticates
 * through `requireCredentials` + `loginPage.signIn`. It is the honest record of
 * where the value comes from, and it is what the row would need if its Assert
 * Outcome were ever filled in.
 */
export function testDataFrom(recording: Recording): string[] {
  const signedIn = recording.authentication.detected;
  return recording.actions
      .filter(action => action.type === 'fill' || action.type === 'select')
      .map(action => {
        const value = action.redacted && signedIn ? CREDENTIAL_TOKEN : action.value ?? '';
        return `${action.target} = ${value}`;
      });
}

/** An assertion as a sentence a person can check the application against. */
export function assertionPhrase(assertion: RecordedAssertion): string {
  // Absent means true: see `RecordedAssertion.expected`. Every recording made
  // before that field existed carried only positive assertions.
  const positive = assertion.expected !== false;
  switch (assertion.type) {
    case 'visible': return `${assertion.target} is ${positive ? 'visible' : 'not visible'}`;
    case 'hidden': return `${assertion.target} is ${positive ? 'not visible' : 'visible'}`;
    case 'text':
      return positive
        ? `${assertion.target} reads "${assertion.value ?? ''}"`
        : `${assertion.target} does not read "${assertion.value ?? ''}"`;
    case 'contains':
      return positive
        ? `${assertion.target} contains "${assertion.value ?? ''}"`
        : `${assertion.target} does not contain "${assertion.value ?? ''}"`;
    case 'value':
      return positive
        ? `${assertion.target} holds "${assertion.value ?? ''}"`
        : `${assertion.target} does not hold "${assertion.value ?? ''}"`;
    case 'checked': return `${assertion.target} is ${positive ? 'ticked' : 'not ticked'}`;
    case 'empty': return `${assertion.target} is ${positive ? 'empty' : 'not empty'}`;
    case 'enabled': return `${assertion.target} is ${positive ? 'enabled' : 'disabled'}`;
    case 'attribute':
      return positive
        ? `${assertion.target} has ${assertion.name ?? 'the attribute'} "${assertion.value ?? ''}"`
        : `${assertion.target} does not have ${assertion.name ?? 'the attribute'} "${assertion.value ?? ''}"`;
    case 'class':
      return positive
        ? `${assertion.target} has the class "${assertion.value ?? ''}"`
        : `${assertion.target} does not have the class "${assertion.value ?? ''}"`;
    case 'values':
      return positive
        ? `${assertion.target} has "${(assertion.values ?? []).join('", "')}" selected`
        : `${assertion.target} does not have "${(assertion.values ?? []).join('", "')}" selected`;
    case 'url':
      return positive
        ? `the URL is ${assertion.value ?? ''}`
        : `the URL is not ${assertion.value ?? ''}`;
    case 'count':
      return positive
        ? `${assertion.target} appears ${assertion.value ?? ''} time(s)`
        : `${assertion.target} does not appear ${assertion.value ?? ''} time(s)`;
    case 'title':
      return positive
        ? `the page title is "${assertion.value ?? ''}"`
        : `the page title is not "${assertion.value ?? ''}"`;
    default: return `${assertion.target} ${assertion.type}`;
  }
}

/**
 * The expected result, and the rule that matters most in this file.
 *
 * It is composed ONLY from assertions the person explicitly recorded. A recording
 * with no assertion gets the literal words "Needs confirmation" - never a guess
 * assembled from the actions, however obvious the intent looks. "They clicked Sign
 * In, so they must have expected to be signed in" is exactly the invented
 * acceptance criterion this whole toolkit exists to prevent, and a test that
 * asserts an invented expectation passes while proving nothing.
 *
 * The wording itself lives in `./placeholders` and is re-exported here, so this module's
 * public API is unchanged. One definition, two readers: this file writes it, and
 * `ai/knowledge/requirements.ts` recognises it so `needs` and `confirmation` never become
 * requirements about a screen.
 */
export { NEEDS_CONFIRMATION, RECORDED_INTERACTION };

export function expectedResultFrom(recording: Recording): string {
  if (!recording.assertions.length)
    return NEEDS_CONFIRMATION;
  return sentence(recording.assertions.map(assertionPhrase).join('; '));
}

/**
 * A scenario title, derived rather than invented.
 *
 * The rule: the last thing clicked is what the recording was *for*, and the
 * assertion says what it was expected to produce. "Sign In — All Projects is
 * visible" is descriptive without claiming anything the recording did not contain.
 * With no assertion it stays purely descriptive of the actions.
 *
 * No model is asked to do this. The review screen makes the field editable, which
 * is a better answer than a generated title nobody checked.
 */
export function scenarioFrom(recording: Recording): string {
  const clicks = recording.actions.filter(action => action.type === 'click' || action.type === 'dblclick');
  const last = clicks[clicks.length - 1];
  const filled = recording.actions.filter(action => action.type === 'fill').length;

  const doing = last
    ? `${last.target}`
    : filled
      ? `Fill in ${filled} field${filled === 1 ? '' : 's'}`
      : RECORDED_INTERACTION;

  if (recording.assertions.length)
    return sentence(`${doing} — ${assertionPhrase(recording.assertions[0])}`);
  return sentence(doing);
}

/**
 * The tags that mark where a case came from.
 *
 * `recorded` is the origin marker, and it is a TAG rather than a new column
 * because the workbook already has a Tags field, `CaseDraft` already carries it,
 * `/api/workbook` already returns it and `TestCase.tags` already reaches the
 * generator. Nothing had to be added to the model, nothing has to be migrated,
 * and a case without the tag is simply a normal case - which is exactly the
 * backward-compatible default.
 *
 * `signed-in` records that authentication was part of the recording. The generator
 * reads it to know the test needs to authenticate through the EXISTING fixtures,
 * rather than opening a browser to work out how.
 */
export const ORIGIN_TAG = 'recorded';
export const AUTHENTICATED_TAG = 'signed-in';

export function isRecordedTags(tags: string[]): boolean {
  return tags.some(tag => tag.trim().toLowerCase() === ORIGIN_TAG);
}

export function wasSignedInTags(tags: string[]): boolean {
  return tags.some(tag => tag.trim().toLowerCase() === AUTHENTICATED_TAG);
}

/** Which locator strategies the recording used, for the review screen. */
export function locatorSummary(recording: Recording): Array<{ strategy: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of [...recording.actions, ...recording.assertions]) {
    if (!item.locatorStrategy || item.locatorStrategy === 'url' || item.locatorStrategy === 'manual')
      continue;
    counts.set(item.locatorStrategy, (counts.get(item.locatorStrategy) ?? 0) + 1);
  }
  return [...counts.entries()]
      .map(([strategy, count]) => ({ strategy, count }))
      .sort((a, b) => b.count - a.count);
}

export interface DraftSuggestion {
  scenario: string;
  steps: string;
  testData: string;
  expectedResult: string;
  /** True when nothing was asserted, so the caller can show it prominently. */
  needsConfirmation: boolean;
  /** Tags that carry the origin. The review screen may add to these, never remove. */
  tags: string;
  authentication: AuthenticationEvidence;
  locators: Array<{ strategy: string; count: number }>;
}

/**
 * Everything the review screen needs, derived deterministically.
 *
 * Returned as fields of the EXISTING `CaseDraft`, not a new shape: the review
 * screen posts them to `/api/case` exactly as the Add/Edit form does, so ID
 * generation, validation, duplicate detection, the backup and the workbook write
 * are all the code that was already there.
 */
export function toDraft(recording: Recording): DraftSuggestion {
  const tags = [ORIGIN_TAG];
  if (recording.authentication.detected)
    tags.push(AUTHENTICATED_TAG);

  return {
    scenario: scenarioFrom(recording),
    steps: stepsFrom(recording).join('\n'),
    testData: testDataFrom(recording).join('\n'),
    expectedResult: expectedResultFrom(recording),
    needsConfirmation: recording.assertions.length === 0,
    tags: tags.join(', '),
    authentication: recording.authentication,
    locators: locatorSummary(recording),
  };
}


/* --------------------------------- one human toggle, recorded twice */

/** Controls whose state a click on their own label already changes. */
const TOGGLEABLE = new Set(['checkbox', 'radio', 'switch']);

/**
 * Does the evidence prove these two recorded actions are the same control?
 *
 * Built from the graph the capture already took, and judged by the association
 * resolver rather than by a second DOM heuristic: a `<label>` parent with a
 * checkable sibling is the `label-ancestor` relationship `associated-control.ts`
 * already names, and `resolveAssertionSubject` is what decides whether it holds.
 */
function associatedToggle(
  clicked: TargetEvidence | undefined,
  state: TargetEvidence | undefined,
): { proven: boolean; reason: string } {
  if (!clicked?.target)
    return { proven: false, reason: 'the click has no captured element' };

  // The candidate the graph states: the labelled control beside the thing clicked.
  const inLabel = lower(clicked.parent?.tag) === 'label';
  const siblings = [...(clicked.previousSiblings ?? []), ...(clicked.nextSiblings ?? [])];
  const control = siblings.find(node => TOGGLEABLE.has(classify(node).semantics));
  if (!inLabel || !control)
    return { proven: false, reason: 'the clicked element is not inside a label beside a control' };

  const subject = resolveAssertionSubject(clicked.target, [
    { relationship: 'label-ancestor', node: control },
  ]);
  if (!subject)
    return { proven: false, reason: 'the association resolver did not accept it' };

  // (a) The state action names that very control - identity, not resemblance.
  if (state?.target && sameElement(subject.node, state.target))
    return { proven: true, reason: `the same ${subject.semantics} the click toggles` };

  // (b) The state action names nothing that could be found.
  //
  // Weaker, and deliberately reachable only when (a)'s association already holds.
  // Playwright names a control by its ACCESSIBLE NAME at the instant it acts, and
  // Bugasura's tick is a Material Icons `::after` whose content is only in the
  // accessibility tree while the box is checked - measured live: the same locator
  // counts 1 checked and 0 unchecked. So `getByRole('checkbox', { name: 'done' })`
  // was already unfindable when the capture looked, and would be unfindable again
  // on replay the moment the click before it has done its work. Keeping it costs a
  // 15s timeout; it cannot be executed by anybody.
  const missing = !state || !state.target || lower(state.target.tag) === '(not found)'
    || state.matchCount === 0;
  if (missing)
    return { proven: true, reason: `a ${subject.semantics} state change with no findable element` };

  return { proven: false, reason: 'the state action names a different element' };
}

function lower(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Drop the second recording of a single human toggle.
 *
 * Clicking Bugasura's checkbox produces TWO Codegen lines - the pointer event on the
 * visible span, and the `check`/`uncheck` of the input the label forwards it to. Both
 * are real records of ONE action, and replaying both applies the toggle twice: the
 * click turns it on, the `check` is a harmless no-op, the click turns it off, and the
 * `uncheck` then waits fifteen seconds for a control whose name only exists while it
 * is on. That is what quarantined TC_DASHBOARD_011.
 *
 * The CLICK is what survives, always. The input is 0x0 and `opacity: 0` - measured -
 * so `check()` on it can only ever succeed by doing nothing, and the thing the person
 * actually interacted with is the span.
 *
 * Positions move when an action is dropped, so both index spaces are corrected here:
 * `rawLineOfAction` in step, and any Codegen assertion counted against a later index.
 */
function collapseAssociatedToggles(
  actions: RecordedAction[],
  rawLineOfAction: number[],
  assertions: RecordedAssertion[],
  evidence: RecordingEvidence | undefined,
): void {
  const byLocator = new Map<string, TargetEvidence>();
  for (const target of (evidence?.available ? evidence.targets : []) ?? [])
    byLocator.set(target.locator, target);
  if (!byLocator.size)
    return;

  for (let index = actions.length - 2; index >= 0; index--) {
    const click = actions[index];
    const next = actions[index + 1];
    if (click.type !== 'click' || (next.type !== 'check' && next.type !== 'uncheck'))
      continue;
    const verdict = associatedToggle(byLocator.get(click.locator), byLocator.get(next.locator));
    if (!verdict.proven)
      continue;

    actions.splice(index + 1, 1);
    rawLineOfAction.splice(index + 1, 1);
    for (const assertion of assertions) {
      if (assertion.afterActions !== undefined && assertion.afterActions > index + 1)
        assertion.afterActions -= 1;
    }
  }
}
