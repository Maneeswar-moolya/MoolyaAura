/**
 * Assembled from a Playwright Codegen recording of TC_DASHBOARD_028.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 1 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('DashBoard', () => {
  test('TC_DASHBOARD_028 - Reports — heading contains "A comprehensive visual overview of bug status, trends, and metrics for effective monitoring and analysis."', async ({ page, loginPage, projectsPage, workspacePage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_DASHBOARD_028',
      module: 'DashBoard',
      scenario: 'Reports — heading contains "A comprehensive visual overview of bug status, trends, and metrics for effective monitoring and analysis."',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'DashBoard',
      priority: 'P1',
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

    await step('1755479 is not ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Moolya Aura login is not working FAC')).not.toBeChecked();
    });

    await step('Click .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Moolya Aura login is not working FAC')).click();
    });

    await step('1755479 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Moolya Aura login is not working FAC')).toBeChecked();
    });

    await step('Click #tr_636432 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Config Line Chart: Unable to select periodicities under')).click();
    });

    await step('636432 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Config Line Chart: Unable to select periodicities under')).toBeChecked();
    });

    await step('Click Reports', async () => {
      await (await workspacePage.bugReportOverviewLink('Reports')).click();
    });

    await step('heading contains "A comprehensive visual overview of bug status, trends, and metrics for effective monitoring and analysis."', async () => {
      await expect(page.getByRole('heading')).toContainText('A comprehensive visual overview of bug status, trends, and metrics for effective monitoring and analysis.');
    });
  });
});
