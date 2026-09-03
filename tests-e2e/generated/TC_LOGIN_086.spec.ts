/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_086.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 7 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_086 - #tr_635838 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui — #tc_summary_635838 contains "Compute Flow: Unable to update date in line chart."', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_086',
      module: '',
      scenario: '#tr_635838 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui — #tc_summary_635838 contains "Compute Flow: Unable to update date in line chart."',
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
      await expect(page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly" }).locator(".bugChecked")).not.toBeChecked();
    });

    await step('click .rounded-checkbox-ui', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly" }).locator(".rounded-checkbox-ui")).click();
    });

    await step('#tc_summary_635838 contains "Compute Flow: Unable to update date in line chart."', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "Compute Flow: Unable to update date in line chart. Bug | | Line Chart" })).toContainText('Compute Flow: Unable to update date in line chart.');
    });

    await step('639978 is ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly" }).locator(".bugChecked")).toBeChecked();
    });

    await step('click #tr_635838 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (page.locator('#tr_635838 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui')).click();
    });

    await step('635838 is ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "Compute Flow: Unable to update date in line chart. FAC" }).locator(".bugChecked")).toBeChecked();
    });
  });
});
