/**
 * Per-step evidence: which step failed, and what the screen looked like.
 *
 * "It failed" and a stack trace tell a test lead almost nothing. The question
 * is always *which step* - did it never reach the form, did the submit not
 * fire, or did the assertion at the end disagree? - and the answer is worth
 * more than the error text.
 *
 * Playwright already records steps via `test.step`, but **its JSON reporter
 * does not emit them** (verified against 1.63.0-alpha: no `steps` key appears
 * anywhere in results.json). The dashboard is built on that file, so the steps
 * have to be recorded separately.
 *
 * One file per test case, exactly like the healing log and for the same reason:
 * workers run in parallel and would race on a single shared document.
 * `globalSetup` clears the directory, so a step list can never survive into a
 * run that did not produce it.
 */

import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { activeScope } from '../../ai/projects/scope';
import path from 'node:path';

import type { Page, TestInfo } from '@playwright/test';
import { captureDiagnostic, diagnosticText, diagnosticData, type DiagnosticCapture, type DiagnosticStep } from '../../ai/diagnostics/artifacts';
import { runtimeStep } from '../../ai/diagnostics/manifest';
import { withLocatorOperation, LOCATOR_TIMEOUT_MS, type LocatorWaitDetail } from './locator-policy';

/**
 * Where a run's step evidence lands.
 *
 * `EXCEL_STEPS_DIR` redirects it, and the falsification gate sets it: that gate
 * runs the suite twice, the second time with the assertions deliberately
 * broken, and without the redirect the *mutated* run's step list was the one
 * left on disk. The dashboard would then show a red step list for a test that
 * is green - evidence for a run nobody asked for, which is precisely the kind
 * of misleading artefact the step log exists to prevent.
 */
export const STEPS_DIR = process.env.EXCEL_STEPS_DIR
  ? path.resolve(process.env.EXCEL_STEPS_DIR)
  : path.resolve(process.cwd(), 'ai', 'reports', 'steps');

export type StepStatus = 'passed' | 'failed';

export interface StepRecord {
  locatorTimeoutMs?: number;
  locatorWaits?: LocatorWaitDetail[];
  diagnostic?: Partial<DiagnosticStep>;
  captures?: DiagnosticCapture[];
  stepId?: string;
  applicationId?: string;
  environmentId?: string;
  runId?: string;
  attemptId?: string;
  attemptNumber?: number;
  captureTiming?: 'after-step' | 'after-failure';
  /**
   * Why this step has no picture, when it has none.
   *
   * A step nobody tried to photograph and a step that could not be photographed read
   * identically on screen - "No screenshot captured" - and they are different facts.
   * The reason is recorded so the screen can say which one happened.
   */
  captureUnavailable?: string;
  /** 1-based, in execution order. */
  index: number;
  title: string;
  status: StepStatus;
  durationMs: number;
  /** First line of the failure, enough to read in a table. */
  error?: string;
  /** Absolute path to the screenshot taken for this step, when one was. */
  screenshotPath?: string;
}

export interface StepLog {
  console?: Array<{type:string;message:string;at:string;recordingStepKey?:string}>;
  applicationId?: string;
  environmentId?: string;
  runId?: string;
  attemptId?: string;
  attemptNumber?: number;
  testCaseId: string;
  testTitle: string;
  steps: StepRecord[];
}

/**
 * When to photograph a step.
 *
 * Reuses the dashboard's existing capture control rather than inventing a
 * second one: `on` documents every step, `only-on-failure` photographs just the
 * step that broke - which is the one anybody actually opens - and `off` costs
 * nothing. Default matches the config's default.
 */
function captureMode(): 'off' | 'only-on-failure' | 'on' {
  const mode = process.env.EXCEL_SCREENSHOT;
  return mode === 'on' || mode === 'off' ? mode : 'only-on-failure';
}

export class StepRecorder {
  readonly console:NonNullable<StepLog['console']>=[];
  currentStepKey?:string;
  readonly steps: StepRecord[] = [];
  private next = 1;
  identity: Omit<StepLog, "testCaseId" | "testTitle" | "steps"> = {};

  claim(): number {
    return this.next++;
  }

  add(record: StepRecord): void {
    this.steps.push(record);
  }
}

/** `Fill the sign-in form` -> `03-fill-the-sign-in-form` */
function fileSlug(index: number, title: string): string {
  const body = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${String(index).padStart(2, '0')}-${body || 'step'}`;
}

/**
 * Run one step, timed, photographed and recorded.
 *
 * The error is re-thrown after recording: this is evidence collection, not
 * error handling, and swallowing a failure here would turn every red test
 * green - the exact failure the autocode gate exists to catch.
 */
export async function runStep<T>(
  recorder: StepRecorder,
  page: Page | undefined,
  testInfo: TestInfo,
  title: string,
  body: () => Promise<T>,
): Promise<T> {
  const index = recorder.claim();
  const stepId = randomUUID();
  const scope = activeScope();
  const attemptNumber = (testInfo.retry || 0) + 1;
  const testIdentity = createHash('sha256').update(`${testInfo.project.name}/${testInfo.testId}/${testInfo.repeatEachIndex || 0}`).digest('hex').slice(0,16);
  recorder.identity = { applicationId: scope.applicationId, environmentId: scope.environmentId,
    runId: process.env.AURA_RUN_ID, attemptId: `${testIdentity}-${attemptNumber}`, attemptNumber };
  const identity = { ...recorder.identity, stepId };
  const started = Date.now();
  const diagnostic = runtimeStep(testInfo.file,new Error().stack ?? '');
  const locatorWaits: LocatorWaitDetail[] = [];
  recorder.currentStepKey=diagnostic?.recordingStepKey;
  const captures: DiagnosticCapture[] = [];
  const unavailable: string[] = [];
  const take = async (type: 'PRE_STEP'|'POST_STEP'|'FAILURE') => {
    // ONE CAPTURE POLICY, and it is the control the dashboard already offers.
    //
    // `off` means off - this path used to photograph every step regardless, which is how
    // pictures existed on disk for a run whose settings said not to take any. Both other
    // modes keep the failure state; only `on` documents a step that passed, because that
    // is what asking for screenshots ON means.
    const mode = captureMode();
    if (mode === 'off') return;
    // `only-on-failure` still photographs the step BEFORE it runs, because a failing step's
    // prior state is evidence about that failure. What it does not do is keep the picture
    // once the step passes; the success path discards it below.
    if (!page) { unavailable.push(`${type}: this step runs without a page`); return; }
    if (page.isClosed()) { unavailable.push(`${type}: the page had already closed`); return; }
    const capture = await captureDiagnostic(page,testInfo.outputDir,diagnostic?.recordingStepKey ?? `runtime:${stepId}`,type);
    if (!capture) { unavailable.push(`${type}: the page could not be photographed safely`); return; }
    {
      // FILED WHERE A READER CAN FIND IT AGAIN.
      //
      // `captureDiagnostic` names the file relative to the directory it wrote into, which
      // is this TEST's output directory. Retention copies that directory into the attempt
      // keeping its relative path, so a bare `aura-….png` describes a file one level down -
      // a reference that resolves nowhere, which is how per-step evidence that existed on
      // disk arrived at the screen as "No screenshot captured". Recorded relative to the
      // OUTPUT ROOT: the one space retention, the run evidence copy and the manifest all
      // already speak.
      capture.artifact = path.relative(testInfo.project.outputDir,
        path.join(testInfo.outputDir, capture.artifact)).replace(/\\/g, '/');
      captures.push(capture);
      await testInfo.attach(`${type}-${index}`,{path:path.join(testInfo.project.outputDir,capture.artifact),contentType:'image/png'}).catch(() => {});
    }
  };
  if (diagnostic) await take('PRE_STEP');

  const photograph = async (): Promise<string | undefined> => {
    if (!page || page.isClosed())
      return undefined;
    if(process.env.AURA_EXECUTION_SELECTION){const capture=await captureDiagnostic(page,testInfo.outputDir,diagnostic?.recordingStepKey??`runtime:${stepId}`,'POST_STEP');return capture?path.join(testInfo.outputDir,capture.artifact):undefined;}
    try {
      const file = testInfo.outputPath(`step-${stepId}.png`);
      await page.screenshot({ path: file, timeout: 5_000, mask:[page.locator('input, textarea, [contenteditable], [data-sensitive]')] });
      // Attaching as well puts it in Playwright's own HTML report, where the
      // trace viewer can sit beside it.
      await testInfo.attach(`step-${index}`, { path: file, contentType: 'image/png' });
      return file;
    } catch {
      // A screenshot is evidence about a failure, never a cause of one.
      return undefined;
    }
  };

  try {
    const result = await withLocatorOperation(body, undefined, locatorWaits);
    // AFTER THE STEP, not only after a failure.
    //
    // Step-by-step evidence is what a PASSING run is for: the record that the application
    // looked right at each point. A report that can only show the step that broke cannot
    // show that. Taken once the step's own work has settled - the locator policy has
    // already awaited it - so there is nothing here to sleep for.
    if (diagnostic && captureMode() === 'on') await take('POST_STEP');
    // Asked for pictures only on failure, and this step did not fail: the pre-step frame
    // it was holding is dropped rather than retained against a setting that said not to.
    else if (captureMode() === 'only-on-failure') captures.length = 0;
    const record: StepRecord = { ...identity, index, title:diagnosticText(title), diagnostic, captures, locatorTimeoutMs: LOCATOR_TIMEOUT_MS, locatorWaits, status: 'passed', durationMs: Date.now() - started };
    if (captureMode() === 'on')
      record.screenshotPath = await photograph();
    // Timing is read from the picture that was actually taken, so a step stops reporting
    // "capture timing not recorded" about evidence it is holding.
    if (captures.some(capture => capture.captureType === 'POST_STEP') || record.screenshotPath)
      record.captureTiming = 'after-step';
    else if (unavailable.length) record.captureUnavailable = unavailable.join('; ');
    recorder.add(record);
    return result;
  } catch (error) {
    if (diagnostic) await take('FAILURE');
    const record: StepRecord = {
      ...identity, index, title:diagnosticText(title), diagnostic, captures, locatorTimeoutMs: LOCATOR_TIMEOUT_MS, locatorWaits, status: 'failed', durationMs: Date.now() - started,
      error: firstLine(error),
    };
    if (captureMode() !== 'off')
      record.screenshotPath = await photograph();
    if (captures.some(capture => capture.captureType === 'FAILURE') || record.screenshotPath)
      record.captureTiming = 'after-failure';
    else if (unavailable.length) record.captureUnavailable = unavailable.join('; ');
    recorder.add(record);
    throw error;
  }
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return diagnosticText(message)
      .replace(/\[[0-9;]*m/g, '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' | ')
      .slice(0, 500);
}

/**
 * Write this test's steps out.
 *
 * Called from the fixture teardown. A test that recorded nothing writes
 * nothing, so an un-instrumented spec is simply absent rather than appearing
 * with an empty, misleading step list.
 */
export function flushSteps(testCaseId: string, testTitle: string, recorder: StepRecorder): void {
  if (!recorder.steps.length)
    return;
  fs.mkdirSync(STEPS_DIR, { recursive: true });
  const log: StepLog = { ...recorder.identity, testCaseId, testTitle, steps: recorder.steps,console:recorder.console };
  fs.writeFileSync(path.join(STEPS_DIR, `${testCaseId}${log.attemptId ? "." + log.attemptId : ""}.json`), `${JSON.stringify(diagnosticData(log), null, 2)}\n`, 'utf8');
}
