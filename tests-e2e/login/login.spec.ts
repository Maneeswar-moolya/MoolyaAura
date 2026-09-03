/**
 * Generated from excel/login-test-cases.xlsx :: "Login Test Cases"
 *
 * Traceability: every title is `<Test Case ID> - <Scenario>` and every test
 * calls trace() so the JSON report carries the source row. Do not rename a
 * test without updating the workbook - run `npm run excel:mapping -- sync`
 * after any change.
 *
 * Not generated from this sheet, deliberately:
 *   TC_LOGIN_005 - "Login should work properly" has no expected result and
 *                  vague steps. Flagged Needs Review; automating it would mean
 *                  inventing the acceptance criteria.
 *   TC_LOGIN_006 - 100% duplicate of TC_LOGIN_001. Flagged Needs Review rather
 *                  than producing a second copy of the same automation.
 */

import { expect, requireCredentials, requireEmail, test, trace } from '../fixtures';
import { INVALID_PASSWORD } from '../support/env';

const SOURCE = { sourceWorkbook: 'login-test-cases.xlsx', sourceWorksheet: 'Login Test Cases', module: 'Login' };

test.describe('Login', () => {
  test('TC_LOGIN_001 - Valid Login', async ({ loginPage, workspacePage, bugasuraCredentials, page }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_LOGIN_001', scenario: 'Valid Login', priority: 'P0' });
    requireCredentials(bugasuraCredentials);

    await loginPage.open();
    await loginPage.signIn(bugasuraCredentials.email, bugasuraCredentials.password);

    // Expected result: "User is signed in and the workspace dashboard is displayed"
    //
    // Wait for whichever happens first - the workspace, or a rejection toast.
    // Reporting Bugasura's own words beats a bare 20-second timeout, because
    // "Your account does not exist" and "Invalid password" call for completely
    // different follow-up.
    let outcome = '';
    for (let attempt = 0; attempt < 40 && !outcome; attempt++) {
      if (await workspacePage.isSignedIn())
        outcome = 'signed-in';
      else
        outcome = await loginPage.currentErrorText();
      if (!outcome)
        await page.waitForTimeout(500);
    }

    expect(outcome, `Sign-in did not reach the workspace. Bugasura said: "${outcome || 'nothing'}"`)
        .toBe('signed-in');
    await expect(await workspacePage.signedInMarker()).toBeVisible();
  });

  // Needs a registered email but deliberately not its password, so this runs
  // with BUGASURA_EMAIL alone.
  test('TC_LOGIN_002 - Invalid Password', async ({ loginPage, bugasuraEmail }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_LOGIN_002', scenario: 'Invalid Password', priority: 'P0' });
    requireEmail(bugasuraEmail);

    await loginPage.open();
    await loginPage.signIn(bugasuraEmail, INVALID_PASSWORD);

    // Expected result: "An error message is displayed and the user stays on the
    // login page". Both halves are asserted - staying put alone would also be
    // true if the button simply did nothing.
    const message = await loginPage.errorText();
    expect(message, 'Expected Bugasura to reject the sign-in with a message').not.toBe('');
    expect(await loginPage.isOnLoginPage()).toBe(true);

    // The test case says "Invalid Password", which presumes the account exists.
    // "Your account does not exist" means the test DATA is wrong, not the
    // application - so it is called out rather than accepted as a pass.
    expect(message, `BUGASURA_EMAIL is not a registered account - Bugasura said "${message}". ` +
      'This test case needs a real account with a deliberately wrong password.')
        .not.toMatch(/does not exist/i);
  });

  test('TC_LOGIN_003 - Empty Email Validation', async ({ loginPage, page }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_LOGIN_003', scenario: 'Empty Email Validation', priority: 'P0' });

    await loginPage.open();
    const email = await loginPage.emailField();
    await email.fill('');
    await (await loginPage.passwordField()).fill(INVALID_PASSWORD);
    await (await loginPage.signInButton()).click();

    // Expected result: "A validation message is shown for the email field and
    // no navigation occurs."
    //
    // The second half is asserted exactly. For the first, the app's own message
    // text has not been confirmed with the team, so this checks the observable
    // signals a blocked submission produces - a visible error, an aria-invalid
    // flag, or native constraint validation. Pin this to the real message once
    // QA confirms the copy; widening it further would stop testing anything.
    expect(await loginPage.isOnLoginPage()).toBe(true);

    const validationShown = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[type="email"], input[name*="email" i]');
      const nativeInvalid = input ? !input.checkValidity() : false;
      const ariaInvalid = input?.getAttribute('aria-invalid') === 'true';
      const visibleError = Array.from(document.querySelectorAll<HTMLElement>('[class*="error"], [role="alert"]'))
          .some(node => node.offsetParent !== null && node.textContent!.trim().length > 0);
      return nativeInvalid || ariaInvalid || visibleError;
    });
    expect(validationShown, 'Expected a validation signal on the empty email field').toBe(true);
  });

  test('TC_LOGIN_004 - Forgot Password Link', async ({ loginPage, page }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_LOGIN_004', scenario: 'Forgot Password Link', priority: 'P1' });

    await loginPage.open();
    await (await loginPage.forgotPasswordLink()).click();

    // Expected result: "The password recovery form is displayed".
    //
    // Asserted on #resetForm, not on page text. `getByText(/reset|recover|
    // forgot/i).first()` matched the sign-in form's own "Forgot Password?"
    // link, which stays in the DOM after the click inside a container that is
    // on its way out - so the assertion resolved during the transition and
    // passed whether or not the recovery form ever arrived. Verified: at the
    // moment the spec asserted, toBeVisible AND toBeHidden both passed on that
    // element, which is exactly what a test proving nothing looks like.
    await expect(page.locator('#resetForm')).toBeVisible();
    await expect(page.locator('#loginForm')).toBeHidden();
    await expect(page.locator('#resetForm input[type="email"], #resetForm input[name*="email" i]').first())
        .toBeVisible();
  });

  // The workbook row still says 255 characters. Confirmed with the author on
  // 2026-08-10 that 250 is intended and the row is stale, so this asserts the
  // real limit. See ai/reports/test-case-change-requests.md - until the
  // workbook is updated, automation and source disagree on the number.
  test('TC_LOGIN_007 - Email Field Maximum Length', async ({ loginPage }, testInfo) => {
    await trace({ ...SOURCE, testCaseId: 'TC_LOGIN_007', scenario: 'Email Field Maximum Length', priority: 'P2' });

    const emailOfLength = (total: number) => `${'a'.repeat(total - '@example.com'.length)}@example.com`;

    // A boundary is only tested by both sides of it. Exactly at the limit must
    // NOT be refused for length - it may still fail to find an account, which
    // is a different message and not what this case is about.
    await loginPage.open();
    const maxLengthAttr = await (await loginPage.emailField()).evaluate(node => (node as HTMLInputElement).maxLength);
    await loginPage.signIn(emailOfLength(250), INVALID_PASSWORD);
    const atLimit = await loginPage.errorText();
    expect(atLimit, '250 characters is the documented limit and must not be rejected for length')
        .not.toMatch(/longer than \d+ characters/i);

    // One character over must be refused, and the message must name the limit.
    await loginPage.open();
    await loginPage.signIn(emailOfLength(251), INVALID_PASSWORD);
    expect(await loginPage.errorText()).toMatch(/cannot be longer than 250 characters/i);

    // Recorded, not asserted: whether the missing client-side cap is a defect
    // is still an open question for the team, so it is reported rather than
    // failed on.
    testInfo.annotations.push({
      type: 'finding',
      description: `#email_field declares no maxlength (maxLength=${maxLengthAttr}); the 250-character ` +
        'limit is enforced server-side only, so the field accepts unlimited typing before submit.',
    });
  });

  /**
   * Signs nobody in - it opens a dropdown and reads what appeared. The
   * data-driven runners always submit a form, so this could never have been a
   * spreadsheet row whatever Assert Outcome it declared.
   *
   * Everything here is scoped to #login_area, and that is not caution: Bugasura
   * mounts the sign-in and sign-up panels together, and each carries its OWN
   * copy of the language dropdown under the SAME ids - #lang_dropdown_wrap and
   * #lang_toggle both resolve to two elements. Unscoped, `#lang_toggle` is a
   * strict-mode violation, and `.first()` would silently pick whichever the
   * markup happens to put first.
   */
  test('TC_LOGIN_019 - Check language option is is working in login page', async ({ loginPage, page, step }) => {
    await trace({
      ...SOURCE,
      testCaseId: 'TC_LOGIN_019',
      scenario: 'Check language option is is working in login page',
      priority: 'P0',
    });

    const area = page.locator('#login_area');
    const selectLanguage = area.getByText(/select language/i).locator('visible=true');

    await step('Open Bugasura login page', () => loginPage.open());

    // The state before the click, asserted rather than assumed. "Select
    // Language" is in the DOM from page load - it is only hidden - so without
    // this the test would pass even if the dropdown never opened.
    await step('Select Language is not on screen yet', async () => {
      await expect(area).toBeVisible();
      await expect(selectLanguage).toHaveCount(0);
    });

    await step('Click on English Language option', async () => {
      await area.locator('#lang_toggle').click();
    });

    await step('Check for Select Language text visibility', async () => {
      await expect(selectLanguage,
          'Expected result: "Select Language Text should be visible". The dropdown is open when ' +
          'the picker heading appears inside #login_area.')
          .toHaveCount(1);
    });
  });
});
