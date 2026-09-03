/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_133.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 2 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 *
 * The title is DERIVED, not authored: the workbook's Scenario cell says
 * the title contains a CSS selector, so it cannot name this test stably. This title comes from the
 * semantic journey instead (action method + state method + screen). The cell itself is unchanged.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_133 - Verify issue checkbox selection on the Issues page', async ({ page, loginPage, projectsPage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_133',
      module: '',
      scenario: 'Verify issue checkbox selection on the Issues page',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
    });

    await step('Open https://my.bugasura.io/', async () => {
      await loginPage.open();
    });

    await step('Sign in', async () => {
      await loginPage.signIn(bugasuraCredentials.email, bugasuraCredentials.password);
    });

    await step('Open is visible', async () => {
      await expect(page.locator("#all_apps .card__progress-title").filter({ hasText: "Open" }).nth(0)).toBeVisible();
    });

    await step('Open the Projects dashboard, and the Create Project / Create New Team dialogs', async () => {
      await projectsPage.open();
    });

    await step('Click iosense.io', async () => {
      await (await projectsPage.projectCard('iosense.io')).click();
    });

    await step('#tc_summary_1751002 contains "sign in is not present in Moolya Aura"', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "sign in is not present in Moolya Aura Bug | | Sign In |Added on 2" })).toContainText('sign in is not present in Moolya Aura');
    });

    await step('1751002 is not ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('sign in is not present in Moolya Aura IOS')).not.toBeChecked();
    });

    await step('Click .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('sign in is not present in Moolya Aura IOS')).click();
    });

    await step('1751002 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('sign in is not present in Moolya Aura IOS')).toBeChecked();
    });
  });
});
