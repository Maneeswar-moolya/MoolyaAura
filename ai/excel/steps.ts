/**
 * Reading back the per-step evidence a run wrote.
 *
 * The tests write one file per test case (see tests-e2e/support/steps.ts);
 * this is the consumer side, shaped the same way `readHealingLog` is.
 */

import fs from 'node:fs';
import path from 'node:path';

export const STEPS_DIR = path.resolve(process.cwd(), 'ai', 'reports', 'steps');

export interface StepRecord {
  index: number;
  title: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
  screenshotPath?: string;
}

export interface StepLog {
  testCaseId: string;
  testTitle: string;
  steps: StepRecord[];
}

/** Every step log this run produced, keyed by Test Case ID. */
export function readStepLogs(dir: string = STEPS_DIR): Record<string, StepLog> {
  const logs: Record<string, StepLog> = {};
  if (!fs.existsSync(dir))
    return logs;

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json'))
      continue;
    try {
      const log = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')) as StepLog;
      if (log.testCaseId)
        logs[log.testCaseId] = log;
    } catch {
      // A half-written file from a killed run is not worth failing a report for.
    }
  }
  return logs;
}

/** The step that failed, when one did. */
export function failingStep(log: StepLog | undefined): StepRecord | undefined {
  return log?.steps.find(step => step.status === 'failed');
}
