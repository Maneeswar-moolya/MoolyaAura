/** User-authored Page Object. No deterministic capabilities claimed. */

import type { Locator, Page } from '@playwright/test';

import type { HealingRecorder } from '../../support/resilient-locator';
import { BasePage } from '../base.page';

export class Notifications extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /** USER AUTHORED — NOT VALIDATED */
  notificationsHeader() { const page = this.page; return page.locator('c-notifications-settings-header'); }
}
