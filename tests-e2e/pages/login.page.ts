/**
 * Bugasura sign-in page - https://my.bugasura.io/
 *
 * Bugasura's login is a client-rendered SPA with no data-test attributes, so
 * every element leads with an accessible-name strategy (the one that survives
 * restyling) and falls back to structural selectors.
 */

import type { Locator, Page } from '@playwright/test';

import { BASE_URL } from '../support/env';
import type { HealingRecorder, LocatorCandidate } from '../support/resilient-locator';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  async open(): Promise<void> {
    await this.goto(BASE_URL);
  }

  // Bugasura keeps the sign-in, sign-up and password-reset forms in the DOM at
  // once (#loginForm, #createUserForm, #resetForm). An unscoped
  // input[type=password] therefore matches the hidden sign-up field as well,
  // which is why every locator below is scoped to #loginForm. Do not unscope.
  emailField(): Promise<Locator> {
    return this.resolve('login.emailField', [
      { strategy: "#loginForm getByRole('textbox', { name: /email/i })", build: page => page.locator('#loginForm').getByRole('textbox', { name: /e-?mail/i }) },
      { strategy: '#loginForm input[type=email]', build: page => page.locator('#loginForm input[type="email"]') },
      { strategy: '#email_field', build: page => page.locator('#email_field') },
      { strategy: 'input[type=email]:visible', build: page => page.locator('input[type="email"]:visible') },
    ]);
  }

  passwordField(): Promise<Locator> {
    return this.resolve('login.passwordField', [
      // Password inputs have no implicit ARIA role, so structure leads here.
      { strategy: '#loginForm input[type=password]', build: page => page.locator('#loginForm input[type="password"]') },
      { strategy: '#password_field', build: page => page.locator('#password_field') },
      { strategy: 'input[type=password]:visible', build: page => page.locator('input[type="password"]:visible') },
    ]);
  }

  signInButton(): Promise<Locator> {
    return this.resolve('login.signInButton', [
      // Anchored and scoped: "Google Sign In" is a separate button on the same
      // screen and must never be clicked by this method.
      { strategy: "#loginForm getByRole('button', { name: /^sign in$/i })", build: page => page.locator('#loginForm').getByRole('button', { name: /^\s*sign\s*in\s*$/i }) },
      { strategy: '#loginForm button:has-text("Sign In")', build: page => page.locator('#loginForm button:has-text("Sign In")') },
      { strategy: '#loginForm button[type=submit]', build: page => page.locator('#loginForm button[type="submit"], #loginForm input[type="submit"]') },
    ]);
  }

  forgotPasswordLink(): Promise<Locator> {
    return this.resolve('login.forgotPasswordLink', [
      { strategy: "getByRole('link', { name: /forgot password/i })", build: page => page.getByRole('link', { name: /forgot\s*password/i }) },
      { strategy: "getByRole('button', { name: /forgot password/i })", build: page => page.getByRole('button', { name: /forgot\s*password/i }) },
      { strategy: "getByText(/forgot password/i)", build: page => page.getByText(/forgot\s*password/i) },
    ]);
  }

  /**
   * The "Terms" link under the sign-in form.
   *
   * Scoped to #loginForm for the usual reason and one extra: the hidden
   * #createUserForm carries its own `a.term-policy-info` to the same href, so an
   * unscoped locator matches two elements and `.first()` would pick whichever
   * the markup emits first. Verified on 2026-08-11: exactly one match inside
   * #loginForm, `<a class="term-policy-info" href="https://bugasura.io/terms-of-service"
   * target="_blank">Terms</a>`.
   *
   * The accessible name is anchored (`/^terms$/`) so it can never drift onto the
   * "Privacy Policy" link sitting beside it.
   *
   * Note `target="_blank"`: clicking this opens a SECOND tab. Use `openTerms()`.
   */
  termsLink(): Promise<Locator> {
    return this.resolve('login.termsLink', [
      { strategy: "#loginForm getByRole('link', { name: /^terms$/i })", build: page => page.locator('#loginForm').getByRole('link', { name: /^\s*terms\s*$/i }) },
      { strategy: '#loginForm a[href*="terms-of-service"]', build: page => page.locator('#loginForm a[href*="terms-of-service"]') },
      { strategy: '#loginForm a.term-policy-info[href*="terms"]', build: page => page.locator('#loginForm a.term-policy-info[href*="terms"]') },
    ]);
  }

  /**
   * Click "Terms" and return the tab Bugasura opens for it.
   *
   * The link is `target="_blank"`, so the terms of service never replace the
   * sign-in page - waiting for the popup is the only way to get a handle on it,
   * and the wait is armed before the click so the event cannot be missed.
   */
  async openTerms(): Promise<Page> {
    const [termsTab] = await Promise.all([
      this.page.waitForEvent('popup'),
      (await this.termsLink()).click(),
    ]);
    await termsTab.waitForLoadState('domcontentloaded');
    return termsTab;
  }

  /**
   * The sign-in button found WITHOUT reading its copy.
   *
   * `signInButton()` leads with the accessible name "Sign In", which is right
   * for every English test case and is what keeps it off the "Google Sign In"
   * button. Once the UI is switched to another language that button says
   * "Anmelden" and none of those candidates resolve - so a test that changes
   * the language needs a handle on the same control that does not depend on the
   * word printed on it. `.login-submit` is unique in the document (verified) and
   * `name="login"` is the form contract behind it.
   */
  localisedSignInButton(): Promise<Locator> {
    return this.resolve('login.localisedSignInButton', [
      { strategy: '#loginForm .login-submit', build: page => page.locator('#loginForm .login-submit') },
      { strategy: '#loginForm button[name=login]', build: page => page.locator('#loginForm button[name="login"]') },
      { strategy: '.login-submit', build: page => page.locator('.login-submit') },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Language picker
  //
  // Every locator below is scoped to #login_area for a reason that bites
  // immediately: Bugasura mounts the sign-in and sign-up panels at the same
  // time and each carries its OWN copy of this widget under the SAME ids -
  // #lang_dropdown_wrap, #lang_toggle, #lang_label and #lang_menu each resolve
  // to two elements, one of them inside the hidden #create_account_area. An
  // unscoped `#lang_toggle` is a strict-mode violation, and `.first()` would
  // silently pick whichever the markup happens to emit first.
  //
  // Note also what does NOT lead here: the accessible-name strategy. This
  // button's accessible name IS the currently selected language, which is the
  // very thing these test cases change - naming it "English" would make the
  // locator stop resolving at the exact moment the test succeeded. The `js-`
  // classes are the markup's own behavioural hooks and are the stable handle.
  // ---------------------------------------------------------------------------

  /** The globe button that opens the picker; its label is the current language. */
  languageToggle(): Promise<Locator> {
    return this.resolve('login.languageToggle', [
      { strategy: '#login_area .js-lang-toggle', build: page => page.locator('#login_area .js-lang-toggle') },
      { strategy: '#login_area #lang_toggle', build: page => page.locator('#login_area #lang_toggle') },
      { strategy: '#login_area .js-language-dropdown button', build: page => page.locator('#login_area .js-language-dropdown button') },
    ]);
  }

  /** The language name printed on the toggle - "English", "German", ... */
  selectedLanguageLabel(): Promise<Locator> {
    return this.resolve('login.selectedLanguageLabel', [
      { strategy: '#login_area .js-lang-label', build: page => page.locator('#login_area .js-lang-label') },
      { strategy: '#login_area #lang_label', build: page => page.locator('#login_area #lang_label') },
      { strategy: '#login_area .lang-selected span', build: page => page.locator('#login_area .lang-selected span') },
    ]);
  }

  /**
   * The "Select Language" heading of the open picker.
   *
   * Present in the DOM from page load and only hidden (display:none on the
   * menu), so assert its VISIBILITY - a presence check is true before anything
   * is clicked and would witness nothing.
   */
  languageMenuHeading(): Promise<Locator> {
    return this.resolve('login.languageMenuHeading', [
      { strategy: '#login_area .js-lang-menu .ba-dropdown__header', build: page => page.locator('#login_area .js-lang-menu .ba-dropdown__header') },
      { strategy: '#login_area #lang_menu .ba-dropdown__header', build: page => page.locator('#login_area #lang_menu .ba-dropdown__header') },
      { strategy: '#login_area .js-lang-menu getByText(/select language/i)', build: page => page.locator('#login_area .js-lang-menu').getByText(/select\s*language/i) },
    ]);
  }

  /**
   * One language in the open picker, by the name Bugasura itself stores on it.
   *
   * `data-lang-name` is the application's own identifier for the row, so this
   * keeps working when the list is translated; the text fallback does not.
   */
  languageOption(name: string): Promise<Locator> {
    return this.resolve(`login.languageOption(${name})`, [
      { strategy: `#login_area .js-lang-item[data-lang-name="${name}"]`, build: page => page.locator(`#login_area .js-lang-item[data-lang-name="${name}"]`) },
      { strategy: `#login_area .js-lang-list li:has-text("${name}")`, build: page => page.locator('#login_area .js-lang-list').locator('li', { hasText: new RegExp(`^\\s*${name}\\s*$`, 'i') }) },
      { strategy: `#login_area getByRole('link', { name: ${name} })`, build: page => page.locator('#login_area .js-lang-menu').getByRole('link', { name: new RegExp(`^\\s*${name}\\s*$`, 'i') }) },
    ]);
  }

  /**
   * EVERY language the picker offers, in the order Bugasura lists them.
   *
   * This is the one locator in this file that deliberately does NOT go through
   * `resolve()`. The resolver narrows its winning candidate to `.first()`, which
   * is right for a single element and destroys a list - and a test case about
   * *all* the languages needs all of them, or it silently checks only the ones
   * somebody happened to hard-code. The ordered-candidate contract and the
   * healing record are kept by hand instead, so a markup tweak still degrades
   * into a recorded heal rather than a red build.
   *
   * `.ba-dropdown__item` is absent from the candidates on purpose, and that is
   * not caution: the menu carries a fifteenth element with that class - the
   * search box's "nothing here" empty state (verified 2026-08-12, it renders
   * localised, e.g. "Α! Δεν υπάρχει εδώ."). Counting it would report a phantom
   * language. `js-lang-item` is the markup's own hook for a real language row.
   *
   * Scoped to #login_area for the usual reason: unscoped, `.js-lang-item`
   * matches 28 elements, because the hidden sign-up panel carries its own copy
   * of the whole picker.
   */
  async languageOptions(): Promise<Locator> {
    const candidates: LocatorCandidate[] = [
      { strategy: '#login_area .js-lang-item', build: page => page.locator('#login_area .js-lang-item') },
      { strategy: '#login_area .js-lang-list a', build: page => page.locator('#login_area .js-lang-list a') },
      { strategy: '#login_area #lang_list a', build: page => page.locator('#login_area #lang_list a') },
    ];

    const attempted: string[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const locator = candidate.build(this.page);
      try {
        // The rows are attached from page load with the menu display:none
        // around them, so `attached` - never `visible` - is the right wait.
        await locator.first().waitFor({ state: 'attached', timeout: 4000 });
      } catch {
        attempted.push(candidate.strategy);
        continue;
      }
      if (index > 0) {
        this.healing?.record({
          logicalName: 'login.languageOptions',
          from: candidates[0].strategy,
          to: candidate.strategy,
          at: new Date().toISOString(),
        });
      }
      return locator;
    }

    throw new Error(
        `Could not resolve "login.languageOptions" on ${this.page.url()}.\n` +
        `Tried ${candidates.length} strateg(ies):\n${attempted.map(strategy => `  - ${strategy}`).join('\n')}\n` +
        'This is a genuine locator failure - add a candidate strategy to the page object, or the picker is gone.');
  }

  /** The picker row Bugasura marks as chosen (`.active`). */
  activeLanguageOption(): Promise<Locator> {
    return this.resolve('login.activeLanguageOption', [
      { strategy: '#login_area .js-lang-item.active', build: page => page.locator('#login_area .js-lang-item.active') },
      { strategy: '#login_area .js-lang-list a.active', build: page => page.locator('#login_area .js-lang-list a.active') },
      { strategy: '#login_area .ba-dropdown__item.active', build: page => page.locator('#login_area .ba-dropdown__item.active') },
    ]);
  }

  /**
   * How Bugasura reports a rejected sign-in: a toast in #toast-container.
   *
   * An earlier, looser version of this matched a hidden #disposal_emails data
   * blob and made the test fail for the wrong reason. Every candidate here is
   * either structural or `:visible`-scoped - a locator that can match hidden
   * page data is not a locator, it is a coin flip.
   */
  errorMessage(): Promise<Locator> {
    return this.resolve('login.errorMessage', [
      { strategy: '#toast-container .toast-message', build: page => page.locator('#toast-container .toast-message') },
      { strategy: '.toast-message:visible', build: page => page.locator('.toast-message:visible') },
      { strategy: "getByRole('alert')", build: page => page.getByRole('alert') },
      {
        strategy: '.error, .error-message:visible',
        build: page => page.locator('.error:visible, .error-message:visible, [class*="error"]:visible'),
      },
    ]);
  }

  /** Rejection text visible right now, without waiting. For poll loops. */
  async currentErrorText(): Promise<string> {
    const toast = this.page.locator('#toast-container .toast-message, .toast-message:visible').first();
    if (await toast.isVisible().catch(() => false))
      return (await toast.textContent())?.trim() ?? '';
    return '';
  }

  /**
   * The rejection text Bugasura displayed, or '' if none appeared.
   *
   * The timeout is a parameter because the two uses are opposites: waiting for
   * a message that should arrive deserves patience, while confirming that no
   * message arrives should not cost eight seconds per test case.
   */
  async errorText(timeoutMs = 8000): Promise<string> {
    const toast = this.page.locator('#toast-container .toast-message, .toast-message:visible').first();
    try {
      await toast.waitFor({ state: 'visible', timeout: timeoutMs });
      return (await toast.textContent())?.trim() ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Whether the form is showing that it refused the input.
   *
   * Bugasura's login has no confirmed copy for client-side validation, so this
   * looks for the observable signals a blocked submission produces rather than
   * a specific string: native constraint validation, aria-invalid, or a visible
   * error node inside the sign-in form. Scoped to #loginForm - the hidden
   * sign-up and reset forms carry their own error nodes.
   */
  async hasValidationSignal(): Promise<boolean> {
    return this.page.evaluate(() => {
      const form = document.querySelector('#loginForm') ?? document;
      const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
      const nativeInvalid = inputs.some(input => input.offsetParent !== null && !input.checkValidity());
      const ariaInvalid = inputs.some(input => input.getAttribute('aria-invalid') === 'true');
      const visibleError = Array.from(form.querySelectorAll<HTMLElement>('[class*="error"], [role="alert"]'))
          .some(node => node.offsetParent !== null && (node.textContent ?? '').trim().length > 0);
      return nativeInvalid || ariaInvalid || visibleError;
    });
  }

  /** Fill both fields and submit. Used by every authenticated test case. */
  async signIn(email: string, password: string): Promise<void> {
    await (await this.emailField()).fill(email);
    await (await this.passwordField()).fill(password);
    await (await this.signInButton()).click();
  }

  /**
   * True while the browser is still on the sign-in screen.
   *
   * Counts only VISIBLE password inputs. The hidden #createUserForm carries one
   * too, so an unfiltered count is >0 even after a successful sign-in - which
   * would make this method answer "yes, still on login" forever.
   */
  async isOnLoginPage(): Promise<boolean> {
    return (await this.page.locator('#loginForm input[type="password"]:visible').count()) > 0;
  }

  /**
   * The inline message beside the password field - "Not too short! enter min 5
   * characters." - rendered on submit, not while typing.
   *
   * DECLARED SINCE `bugasura__root.yaml` WAS WRITTEN, AND IMPLEMENTED ONLY NOW, which is
   * what let a second capability be created for the same element. `existingCapability`
   * skips any knowledge entry whose method is not on the class - correctly, since a
   * method that does not exist cannot be reused - so `#password_field-error` looked like
   * an element nothing described, and the abstraction engine wrote
   * `passwordFieldErrorState()` for it from TC_LOGIN_120. One element, two methods, and
   * the generated one carried the recorder's redaction marker in its own description.
   *
   * A declaration with no implementation is not a capability. This is the implementation.
   */
  passwordLengthError(): Promise<Locator> {
    return this.resolve('login.passwordLengthError', [
      { strategy: '#password_field-error', build: page => page.locator('#password_field-error') },
    ]);
  }
}
