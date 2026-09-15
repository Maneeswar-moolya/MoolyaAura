/**
 * SsoauthLoginPage - created by the abstraction engine from measured recordings.
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

export class SsoauthLoginPage extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /**
   * Enter email - operated on the SsoauthLoginPage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  enterEmailField(): Promise<Locator> {
    return this.resolve('ssoauthlogin.enterEmailField', [
      { strategy: 'getByRole(\'textbox\', { name: \'Enter email\' })', build: page => page.getByRole('textbox', { name: 'Enter email' }) },
    ]);
  }

  /**
   * fill Password - operated on the SsoauthLoginPage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  passwordField(): Promise<Locator> {
    return this.resolve('ssoauthlogin.passwordField', [
      { strategy: 'getByRole(\'textbox\', { name: \'Password\' })', build: page => page.getByRole('textbox', { name: 'Password' }) },
    ]);
  }

  /**
   * Log In - operated on the SsoauthLoginPage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  logInButton(): Promise<Locator> {
    return this.resolve('ssoauthlogin.logInButton', [
      { strategy: 'getByRole(\'button\', { name: \'Log In\', exact: true })', build: page => page.getByRole('button', { name: 'Log In', exact: true }) },
    ]);
  }

  /** USER AUTHORED — NOT VALIDATED */
  formState() { const page = this.page; return page.locator('form'); }
}
