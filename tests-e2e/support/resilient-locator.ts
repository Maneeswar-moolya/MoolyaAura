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

/** How long a single candidate gets to prove it resolves. */
const CANDIDATE_TIMEOUT_MS = 4000;

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

  const attempted: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    // BUILT UNNARROWED. Whatever the candidate matches is what gets counted, and
    // what gets returned.
    const locator = candidate.build(page);

    // THE WAIT IS A PRESENCE PROBE, and `.first()` belongs here for the same
    // reason it belongs in a readiness check: the question is "has anything
    // appeared yet?", not "which element is it?".
    //
    // IT ALSO HAS TO BE. `waitFor` is strict-mode checked, so waiting on the
    // unnarrowed locator throws for any candidate matching several - before the
    // count below can run. The live probe caught exactly that: an ambiguous
    // candidate was refused (right outcome) as "not attached" (wrong reason),
    // and a genuine collection could not resolve at all, because the wait threw
    // before `cardinality: 'many'` was ever consulted.
    try {
      await locator.first().waitFor({ state: 'attached', timeout: CANDIDATE_TIMEOUT_MS });
    } catch {
      attempted.push(`${candidate.strategy} - nothing attached`);
      continue;
    }

    if (cardinality === 'one') {
      const count = await locator.count().catch(() => -1);
      if (count !== 1) {
        // AMBIGUITY IS A FAILED CANDIDATE, not a candidate to trim. Recorded so
        // the run says which strategy was too loose and by how much, then the
        // next one is tried exactly as if this had matched nothing.
        attempted.push(`${candidate.strategy} - matched ${count === -1 ? 'an uncountable set' : `${count} elements`}`);
        continue;
      }
    }

    if (index > 0) {
      recorder?.record({
        logicalName,
        from: candidates[0].strategy,
        to: candidate.strategy,
        at: new Date().toISOString(),
      });
    }
    return locator;
  }

  throw new Error(
      `Could not resolve "${logicalName}" on ${page.url()} to exactly one element.\n` +
      `Tried ${candidates.length} strateg(ies):\n${attempted.map(strategy => `  - ${strategy}`).join('\n')}\n` +
      'This is a genuine locator failure - add a candidate strategy that identifies the element, '
      + 'or the element is gone. A strategy that matched several elements is NOT narrowed with '
      + 'first(): that would pick an element nobody chose.');
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
