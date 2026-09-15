/**
 * Resilient locators, and what "safe healing" is allowed to mean.
 *
 * Each logical element declares an ordered list of candidate strategies. At
 * run time the first candidate that actually resolves wins. If the primary
 * candidate fails and a fallback succeeds, that is recorded as a healing
 * event: the element was found a different way and the page object should be
 * updated.
 *
 * The boundary is deliberate. Healing may only pick a different pre-declared
 * strategy for the SAME logical element. It can never invent a selector, point
 * at a different element, or touch an assertion - those would change the
 * business intent of the test case, which is never allowed.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';
import { bindLocator, locatorDeadline, recordLocatorWait, timeoutDetail, LocatorPolicyError, type LocatorClock } from './locator-policy';

export interface LocatorCandidate {
  /** Human-readable strategy name, e.g. `getByRole(textbox, Email)`. */
  strategy: string;
  build: (page: Page) => Locator;
}

export interface HealingEvent {
  logicalName: string;
  from: string;
  to: string;
  at: string;
}

/** Collected per test, flushed by the fixture. */
export class HealingRecorder {
  readonly events: HealingEvent[] = [];

  record(event: HealingEvent): void {
    this.events.push(event);
  }
}

/**
 * How many elements a logical name is SUPPOSED to identify.
 *
 * `one` is the default and the overwhelming majority: a field, a button, a
 * heading - something a test acts on or asserts about. `many` has to be asked
 * for, because a resolver that infers it cannot tell a collection from an
 * ambiguous identity locator, and those are the two things this distinction
 * exists to keep apart.
 */
export type Cardinality = 'one' | 'many';

export interface ResolveOptions {
  /** Injection changes the clock, never the production maximum. */
  clock?: LocatorClock;
  page: Page;
  logicalName: string;
  candidates: LocatorCandidate[];
  recorder?: HealingRecorder;
  /**
   * Defaults to `one`. Set `many` ONLY where the logical element genuinely is
   * a collection and a caller will do something explicitly positional with it.
   */
  cardinality?: Cardinality;
}

/**
 * Return the first candidate that IDENTIFIES the element - which means exactly
 * one element, not merely at least one.
 *
 * WHY THE COUNT, AND NOT `.first()`. This function used to narrow every
 * candidate with `.first()` before waiting on it. That made a strict-mode
 * exception impossible, which reads like safety and is the opposite: a
 * candidate matching three elements became indistinguishable from one matching
 * exactly the right element, the healing log recorded a successful resolution
 * either way, and the test asserted against whichever element happened to come
 * first in the DOM. Playwright's strict mode is a diagnostic, and `.first()`
 * was switching it off for all thirty-five methods that resolve through here.
 *
 * So cardinality is measured. A candidate that matches several elements has not
 * identified anything: it is recorded and the NEXT candidate is tried, which is
 * exactly what healing already does for a candidate that matches none. Nothing
 * about the ordering, the fallback or the healing record changes - only the
 * question asked of each candidate, from "is it attached?" to "is it attached
 * and unique?".
 *
 * `cardinality: 'many'` opts out, for a logical name that really is a
 * collection. It is never inferred.
 *
 * Throws with every candidate and the count it produced when none identify the
 * element - a locator that no known strategy can pin down is a real failure,
 * not something to paper over.
 */
export async function resolveLocator(options: ResolveOptions): Promise<Locator> {
  const { page, logicalName, candidates, recorder } = options;
  const cardinality = options.cardinality ?? 'one';
  if (!candidates.length)
    throw new Error(`No candidates declared for "${logicalName}".`);

  const deadline = locatorDeadline(options.clock);
  const counts: Array<number | null> = candidates.map(() => null);
  // Recheck every declared candidate in order within ONE deadline. No positional narrowing.
  do {
    for (const [index, candidate] of candidates.entries()) {
      if (deadline.remaining() <= 0) break;
      const locator = candidate.build(page);
      let count: number;
      try { count = await deadline.observe(() => locator.count()); }
      catch (error) {
        if (/observation deadline exhausted/.test(String(error))) break;
        if (!/execution context|navigation|frame.*detach/i.test(String(error))) throw error;
        counts[index] = null; continue;
      }
      counts[index] = count;
      if (cardinality === 'one' ? count !== 1 : count < 1) continue;
      if (index > 0) recorder?.record({ logicalName, from: candidates[0].strategy, to: candidate.strategy, at: new Date().toISOString() });
      return bindLocator(locator, deadline);
    }
    if (counts.every(count => count !== null && count > 1)) break;
    if (deadline.remaining() <= 0) break;
    await deadline.recheck();
  } while (deadline.remaining() > 0);
  const measured = candidates.map((candidate, index) => ({ strategy: candidate.strategy, count: counts[index] }));
  const detail = await timeoutDetail(page, deadline, { logicalName, candidates: measured, finalMatchCount: counts[0] });
  if (counts.every(count => count !== null && count > 1)) detail.classification = 'LOCATOR_AMBIGUOUS';
  recordLocatorWait(detail);
  throw new LocatorPolicyError(detail,
    `Could not resolve "${logicalName}" to ${cardinality === 'one' ? 'exactly one element' : 'a non-empty collection'}. ` +
    `Waited ${detail.elapsedMs}ms (maximum ${detail.configuredTimeoutMs}ms).\n` +
    measured.map(item => `  - ${item.strategy} - matched ${item.count ?? 'unknown'} elements`).join('\n') +
    '\nAmbiguous targets are NOT narrowed with first(): that would pick an element nobody chose.');
}

export const HEALING_DIR = path.resolve(process.cwd(), 'ai', 'reports', 'healing');

/**
 * One file per test case avoids workers racing on a single JSON file.
 * The reporter merges the directory.
 */
export function flushHealing(testCaseId: string, recorder: HealingRecorder, rerunStatus?: string): void {
  if (!recorder.events.length)
    return;
  fs.mkdirSync(HEALING_DIR, { recursive: true });
  const payload = {
    testCaseId,
    healed: true,
    attempts: recorder.events.map(event => ({
      locatorName: event.logicalName,
      from: event.from,
      to: event.to,
      at: event.at,
      applied: true,
      note: 'Fallback strategy declared in the page object resolved the element.',
    })),
    rerunStatus,
  };
  const safeName = testCaseId.replace(/[^A-Za-z0-9_-]/g, '_');
  fs.writeFileSync(path.join(HEALING_DIR, `${safeName}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
