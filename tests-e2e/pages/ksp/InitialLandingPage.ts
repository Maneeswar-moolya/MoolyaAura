/** User-authored Page Object. No deterministic capabilities claimed. */
import { BasePage } from '../base.page';
export class InitialLandingPage extends BasePage {

  /** USER AUTHORED — NOT VALIDATED */
  logIn() { const page = this.page; return page.locator('header').getByRole('link', { name: 'Log In' }); }
}
