/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_140.
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
 * the title contains a class or id token, so it cannot name this test stably. This title comes from the
 * semantic journey instead (action method + state method + screen). The cell itself is unchanged.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_140 - Verify issue checkbox after reports nav link on the Workspace page', async ({ page, loginPage, projectsPage, workspacePage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_140',
      module: '',
      scenario: 'Verify issue checkbox after reports nav link on the Workspace page',
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

    await step('Click Faclon labs', async () => {
      await (await projectsPage.projectCard('Faclon labs')).click();
    });

    await step('635838 is not ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Compute Flow: Unable to update date in line chart. FAC')).not.toBeChecked();
    });

    await step('Click #tr_635838 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Compute Flow: Unable to update date in line chart. FAC')).click();
    });

    await step('635838 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Compute Flow: Unable to update date in line chart. FAC')).toBeChecked();
    });

    await step('Click Reports', async () => {
      await (await workspacePage.bugReportOverviewLink('Reports')).click();
    });

    await step('#critical_bugs_moving contains "Rate at Which Critical Issues are Closed"', async () => {
      await expect(page.locator('#critical_bugs_moving')).toContainText('Rate at Which Critical Issues are Closed');
    });

    await step('Click Activity', async () => {
      await (await workspacePage.reportsNavLink('Activity')).click();
    });

    await step('#issues_update_container contains "Line Chart : Getting flat line for Weekly and monthly periodicities in the rendered line chart and also displaying wrong data points using Summation operator in Device Data source."', async () => {
      await expect(page.locator('#issues_update_container')).toContainText('Line Chart : Getting flat line for Weekly and monthly periodicities in the rendered line chart and also displaying wrong data points using Summation operator in Device Data source.');
    });
  });
});
