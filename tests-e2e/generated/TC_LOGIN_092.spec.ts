/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_092.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 2 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_092 - .rounded-checkbox-ui — #tc_summary_639978 contains "Line Chart : Getting flat line for Weekly and monthly periodicities in the rendered line chart and also displaying wrong data points using Summation operator in Device Data source."', async ({ page, loginPage, projectsPage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_092',
      module: '',
      scenario: '.rounded-checkbox-ui — #tc_summary_639978 contains "Line Chart : Getting flat line for Weekly and monthly periodicities in the rendered line chart and also displaying wrong data points using Summation operator in Device Data source."',
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

    await step('639978 is not ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Line Chart : Getting flat line for Weekly and monthly')).not.toBeChecked();
    });

    await step('Click .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Line Chart : Getting flat line for Weekly and monthly')).click();
    });

    await step('#tc_summary_639978 contains "Line Chart : Getting flat line for Weekly and monthly periodicities in the rendered line chart and also displaying wrong data points using Summation operator in Device Data source."', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly periodicities in the rende" })).toContainText('Line Chart : Getting flat line for Weekly and monthly periodicities in the rendered line chart and also displaying wrong data points using Summation operator in Device Data source.');
    });

    await step('639978 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Line Chart : Getting flat line for Weekly and monthly')).toBeChecked();
    });
  });
});
