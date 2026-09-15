/**
 * UsEnMySupportCasesPage - created by the abstraction engine from measured recordings.
 *
 * Route: declared by the knowledge file that owns this class.
 *
 * Every method below was written from a press-time measurement: one element, in the
 * document the press happened in, and that element is the one acted on. Nothing here
 * was hand-composed, and nothing here narrows by position.
 */

import type { Locator, Page } from '@playwright/test';

import type { HealingRecorder } from '../../support/resilient-locator';
import { BasePage } from '../base.page';

export class UsEnMySupportCasesPage extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /**
   * msc-comments-nav-link contains "Comments (0)" - read on the UsEnMySupportCasesPage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  comments0ButtonState(): Promise<Locator> {
    return this.resolve('usenmysupportcases.comments0ButtonState', [
      { strategy: 'getByRole(\'button\', { name: \'Comments (0)\', exact: true })', build: page => page.getByRole('button', { name: 'Comments (0)', exact: true }) },
    ]);
  }
}
