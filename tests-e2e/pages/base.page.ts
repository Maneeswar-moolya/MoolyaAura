/**
 * Shared behaviour for every page object.
 *
 * Page objects expose intent ("sign in", "the error banner"), never raw
 * selectors. Locators are declared as ordered candidate strategies so a UI
 * tweak degrades into a recorded healing event rather than a red build.
 */

import type { Locator, Page } from '@playwright/test';
import { installLocatorPolicy } from '../support/locator-policy';

import { resolveLocator, type HealingRecorder, type LocatorCandidate } from '../support/resilient-locator';

export abstract class BasePage {
  constructor(
    protected readonly page: Page,
    protected readonly healing?: HealingRecorder,
  ) { installLocatorPolicy(page); }

  /**
   * Resolve a logical element to EXACTLY ONE element.
   *
   * The default and the one to reach for. A candidate that matches several
   * elements has not identified anything and is skipped for the next one; it is
   * never narrowed with `first()`.
   */
  protected resolve(logicalName: string, candidates: LocatorCandidate[]): Promise<Locator> {
    return resolveLocator({ page: this.page, logicalName, candidates, recorder: this.healing });
  }

  /**
   * Resolve a logical element that genuinely IS a collection.
   *
   * Explicit, never inferred: the caller is saying "several is correct here",
   * and takes responsibility for whatever positional operation follows. Use it
   * only where the name means a set - a list of rows, a strip of tabs - and
   * never to get an ambiguous identity locator past `resolve`.
   */
  protected resolveMany(logicalName: string, candidates: LocatorCandidate[]): Promise<Locator> {
    return resolveLocator({
      page: this.page, logicalName, candidates, recorder: this.healing, cardinality: 'many',
    });
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  url(): string {
    return this.page.url();
  }
}
