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
import path from 'node:path';

import type { Page, TestInfo } from '@playwright/test';

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
  readonly steps: StepRecord[] = [];
  private next = 1;

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
  const started = Date.now();

  const photograph = async (): Promise<string | undefined> => {
    if (!page || page.isClosed())
      return undefined;
    try {
      const file = testInfo.outputPath(`step-${fileSlug(index, title)}.png`);
      await page.screenshot({ path: file, timeout: 5_000 });
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
    const result = await body();
    const record: StepRecord = { index, title, status: 'passed', durationMs: Date.now() - started };
    if (captureMode() === 'on')
      record.screenshotPath = await photograph();
    recorder.add(record);
    return result;
  } catch (error) {
    const record: StepRecord = {
      index, title, status: 'failed', durationMs: Date.now() - started,
      error: firstLine(error),
    };
    if (captureMode() !== 'off')
      record.screenshotPath = await photograph();
    recorder.add(record);
    throw error;
  }
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
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
  const log: StepLog = { testCaseId, testTitle, steps: recorder.steps };
  fs.writeFileSync(path.join(STEPS_DIR, `${testCaseId}.json`), `${JSON.stringify(log, null, 2)}\n`, 'utf8');
}
