/**
 * Bugasura terms of service - https://bugasura.io/terms-of-service
 *
 * A different host from the rest of the suite: the sign-in app lives on
 * my.bugasura.io, and the Terms link under the form points at the marketing
 * site, in a new tab (`target="_blank"`). So this page object is constructed
 * over the popup Page rather than the fixture's - see `LoginPage.openTerms()`.
 *
 * There is no fixture for it on purpose. The tab does not exist until a test
 * clicks the link, and a fixture would have to invent one.
 */

import type { Locator, Page } from '@playwright/test';

import type { HealingRecorder } from '../support/resilient-locator';
import { BasePage } from './base.page';

export class TermsPage extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /**
   * The page's own title heading.
   *
   * Found STRUCTURALLY, never by its words. The test case's whole question is
   * whether this heading reads "TERMS OF SERVICE", and a locator that searched
   * for that text would answer its own question - the assertion could then only
   * fail the way the locator already failed. Verified on 2026-08-11: the
   * document has exactly one h1, whose text is literally uppercase in the DOM
   * (`text-transform: none`), so the copy is real and not a CSS effect.
   */
  heading(): Promise<Locator> {
    return this.resolve('terms.heading', [
      { strategy: "getByRole('heading', { level: 1 })", build: page => page.getByRole('heading', { level: 1 }) },
      { strategy: 'main h1', build: page => page.locator('main h1') },
      { strategy: 'h1', build: page => page.locator('h1') },
    ]);
  }
}
