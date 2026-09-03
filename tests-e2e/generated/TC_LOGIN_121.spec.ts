/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_121.
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
  test('TC_LOGIN_121 - Verify issue checkbox on the Issues page', async ({ page, loginPage, projectsPage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_121',
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

    await step('Click sample', async () => {
      await (await projectsPage.projectCard('sample')).click();
    });

    await step('click .rounded-checkbox-ui', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".rounded-checkbox-ui").nth(0)).click();
    });

    await step('Click #tr_1749558 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Copy of login is not working in moolya aura SAM')).click();
    });

    await step('click #tr_1749552 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".rounded-checkbox-ui").nth(2)).click();
    });

    await step('1749553 is ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".bugChecked").nth(0)).toBeChecked();
    });
  });
});
