/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_080.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 5 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_080 - Compute Flow: Unable to — #tc_summary_637609 contains "After selecting Different date in calendar of line chart it is showing current date and time and also displaying daily line instead of hourly"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_080',
      module: '',
      scenario: 'Compute Flow: Unable to — #tc_summary_637609 contains "After selecting Different date in calendar of line chart it is showing current date and time and also displaying daily line instead of hourly"',
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

    await step('click Faclon labs', async () => {
      await (page.getByText('Faclon labs')).click();
    });

    await step('#tc_summary_637609 contains "After selecting Different date in calendar of line chart it is showing current date and time and also displaying daily line instead of hourly"', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "After selecting Different date in calendar of line chart it is showing current d" })).toContainText('After selecting Different date in calendar of line chart it is showing current date and time and also displaying daily line instead of hourly');
    });

    await step('#tc_summary_635838 contains "Compute Flow: Unable to update date in line chart."', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "Compute Flow: Unable to update date in line chart. Bug | | Line Chart" })).toContainText('Compute Flow: Unable to update date in line chart.');
    });

    await step('click Compute Flow: Unable to', async () => {
      await (page.locator("#bugReport-table .bug-report__summary--text.hidden-xs").getByText("Compute Flow: Unable to update date in line chart.")).click();
    });

    await step('#response_modal_dialog contains "Compute Flow: Unable to update date in line chart."', async () => {
      await expect(page.locator('#response_modal_dialog')).toContainText('Compute Flow: Unable to update date in line chart.');
    });
  });
});
