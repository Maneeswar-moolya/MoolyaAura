/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_123.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 3 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 *
 * The title is DERIVED, not authored: the workbook's Scenario cell says
 * the title contains a CSS descendant chain, so it cannot name this test stably. This title comes from the
 * semantic journey instead (action method + screen). The cell itself is unchanged.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_123 - Verify issue checkbox on the Issues page', async ({ page, loginPage, projectsPage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_123',
      module: '',
      scenario: 'Verify issue checkbox on the Issues page',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
    });

    await step('Open https://my.bugasura.io/', async () => {
      await loginPage.open();
    });

    await step('Sign in', async () => {
      await loginPage.signIn(bugasuraCredentials.email, bugasuraCredentials.password);
    });

    await step('Open the Projects dashboard, and the Create Project / Create New Team dialogs', async () => {
      await projectsPage.open();
    });

    await step('Click iosense.io', async () => {
      await (await projectsPage.projectCard('iosense.io')).click();
    });

    await step('1751002 is not ticked', async () => {
      await expect(page.locator(".tabulator-table").filter({ hasText: "close Filter :  Saved Filterskeyboard_arrow_right" }).locator(".bugChecked").nth(0)).not.toBeChecked();
    });

    await step('Click .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('sign in is not present in Moolya Aura IOS')).click();
    });

    await step('1751002 is ticked', async () => {
      await expect(page.locator(".tabulator-table").filter({ hasText: "close Filter :  Saved Filterskeyboard_arrow_right" }).locator(".bugChecked").nth(0)).toBeChecked();
    });

    await step('Click #tr_1751001 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('login is not present in moolya aura IOS')).click();
    });

    await step('1751001 is ticked', async () => {
      await expect(page.locator(".tabulator-table").filter({ hasText: "close Filter :  Saved Filterskeyboard_arrow_right" }).locator(".bugChecked").nth(1)).toBeChecked();
    });
  });
});
