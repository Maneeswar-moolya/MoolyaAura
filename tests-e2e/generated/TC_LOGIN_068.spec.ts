/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_068.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 6 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login', () => {
  test('TC_LOGIN_068 - Close — #tc_summary_638416 contains "Line Chart | Compare Mode : After selecting any one day in Calendar of line chart, the line graph should have duration of 24 hours (12 AM to 12 AM) of that particular day, but we are getting different duration for that day."', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_068',
      module: 'Login',
      scenario: 'Close — #tc_summary_638416 contains "Line Chart | Compare Mode : After selecting any one day in Calendar of line chart, the line graph should have duration of 24 hours (12 AM to 12 AM) of that particular day, but we are getting different duration for that day."',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
      priority: 'P0',
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

    await step('#tc_summary_638416 contains "Line Chart | Compare Mode : After selecting any one day in Calendar of line chart, the line graph should have duration of 24 hours (12 AM to 12 AM) of that particular day, but we are getting different duration for that day."', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "Line Chart | Compare Mode : After selecting any one day in Calendar of line char" })).toContainText('Line Chart | Compare Mode : After selecting any one day in Calendar of line chart, the line graph should have duration of 24 hours (12 AM to 12 AM) of that particular day, but we are getting different duration for that day.');
    });

    await step('click Line Chart | Compare Mode :', async () => {
      await (page.locator("#bugReport-table .bug-report__summary--text.hidden-xs").getByText("Line Chart | Compare Mode : After selecting any one day in Calendar of line char")).click();
    });

    await step('#response_modal_dialog contains "Line Chart | Compare Mode : After selecting any one day in Calendar of line chart, the line graph should have duration of 24 hours (12 AM to 12 AM) of that particular day, but we are getting different duration for that day."', async () => {
      await expect(page.locator('#response_modal_dialog')).toContainText('Line Chart | Compare Mode : After selecting any one day in Calendar of line chart, the line graph should have duration of 24 hours (12 AM to 12 AM) of that particular day, but we are getting different duration for that day.');
    });

    await step('click close', async () => {
      await (page.getByRole('button', { name: 'close' })).click();
    });

    await step('#tc_summary_639496 contains "Line Chart Page| Compute Flow: Line is not displaying for the line chart using Compute flow ID as data source, It is showing only data points."', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "Line Chart Page| Compute Flow: Line is not displaying for the line chart using C" })).toContainText('Line Chart Page| Compute Flow: Line is not displaying for the line chart using Compute flow ID as data source, It is showing only data points.');
    });
  });
});
