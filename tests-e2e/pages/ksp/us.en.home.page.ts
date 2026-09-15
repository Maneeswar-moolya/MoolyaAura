/**
 * UsEnHomePage - created by the abstraction engine from measured recordings.
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

export class UsEnHomePage extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /**
   * dashboard-heading contains "My Dashboard" - read on the UsEnHomePage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  myDashboardState(): Promise<Locator> {
    return this.resolve('usenhome.myDashboardState', [
      { strategy: 'getByRole(\'heading\', { name: \'My Dashboard\', exact: true })', build: page => page.getByRole('heading', { name: 'My Dashboard', exact: true }) },
    ]);
  }

  /**
   * Enter email - operated on the UsEnHomePage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  enterEmailField(): Promise<Locator> {
    return this.resolve('usenhome.enterEmailField', [
      { strategy: 'getByRole(\'textbox\', { name: \'Enter email\' })', build: page => page.getByRole('textbox', { name: 'Enter email' }) },
    ]);
  }

  /**
   * Password - operated on the UsEnHomePage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  passwordField(): Promise<Locator> {
    return this.resolve('usenhome.passwordField', [
      { strategy: 'getByRole(\'textbox\', { name: \'Password\' })', build: page => page.getByRole('textbox', { name: 'Password' }) },
    ]);
  }

  /**
   * Log In - operated on the UsEnHomePage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  logInButton(): Promise<Locator> {
    return this.resolve('usenhome.logInButton', [
      { strategy: 'getByRole(\'button\', { name: \'Log In\', exact: true })', build: page => page.getByRole('button', { name: 'Log In', exact: true }) },
    ]);
  }

  /**
   * Hardware - operated on the UsEnHomePage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  hardwareButton(): Promise<Locator> {
    return this.resolve('usenhome.hardwareButton', [
      { strategy: 'getByRole(\'button\', { name: \'Hardware\' })', build: page => page.getByRole('button', { name: 'Hardware' }) },
    ]);
  }

  /** USER AUTHORED — NOT VALIDATED */
  homeLinkState() { const page = this.page; return page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link'); }

  /** USER AUTHORED — NOT VALIDATED */
  productHelp() { const page = this.page; return page.getByRole('button', { name: 'Product Help' }); }

  /** USER AUTHORED — NOT VALIDATED */
  mySupportCaseUnderProductHelp() { const page = this.page; return page.getByRole('menuitem', { name: 'My Support Cases' }); }

  /**
   * Product Help - operated on the UsEnHomePage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  productHelpButton(): Promise<Locator> {
    return this.resolve('usenhome.productHelpButton', [
      { strategy: 'getByRole(\'button\', { name: \'Product Help\' })', build: page => page.getByRole('button', { name: 'Product Help' }) },
    ]);
  }

  /** USER AUTHORED — NOT VALIDATED */
  settionsIcon() { const page = this.page; return page.getByRole('button', { name: 'Settings' }); }

  /** USER AUTHORED — NOT VALIDATED */
  accountSettingsUnderSettingsIconMenu() { const page = this.page; return page.getByRole('menuitem', { name: 'Account Settings' }); }
}
