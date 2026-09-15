/**
 * Reading back the per-step evidence a run wrote.
 *
 * The tests write one file per test case (see tests-e2e/support/steps.ts);
 * this is the consumer side, shaped the same way `readHealingLog` is.
 */

import fs from 'node:fs';
import path from 'node:path';

export const STEPS_DIR = path.resolve(process.cwd(), 'ai', 'reports', 'steps');

export type { StepRecord, StepLog } from '../../tests-e2e/support/steps';
import type { StepRecord, StepLog } from '../../tests-e2e/support/steps';

/** Every step log this run produced, keyed by Test Case ID. */
export function readStepLogEntries(dir: string = STEPS_DIR): StepLog[] {
  const logs: StepLog[] = [];
  if (!fs.existsSync(dir))
    return logs;

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json'))
      continue;
    try {
      const log = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')) as StepLog;
      if (log.testCaseId)
        logs.push(log);
    } catch {
      // A half-written file from a killed run is not worth failing a report for.
    }
  }
  return logs;
}

/** Compatibility for workbook reports: the last actual attempt, never merged retries. */
export function readStepLogs(dir: string = STEPS_DIR): Record<string, StepLog> {
  const logs: Record<string, StepLog> = {};
  for (const log of readStepLogEntries(dir)) {
    const previous = logs[log.testCaseId];
    if (!previous || (log.attemptNumber || 0) >= (previous.attemptNumber || 0)) logs[log.testCaseId] = log;
  }
  return logs;
}

/** The step that failed, when one did. */
export function failingStep(log: StepLog | undefined): StepRecord | undefined {
  return log?.steps.find(step => step.status === 'failed');
}
