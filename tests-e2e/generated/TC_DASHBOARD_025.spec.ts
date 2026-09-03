/**
 * Assembled from a Playwright Codegen recording of TC_DASHBOARD_025.
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
  test('TC_DASHBOARD_025 - .rounded-checkbox-ui — 639978 is ticked', async ({ page, loginPage, projectsPage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_DASHBOARD_025',
      module: '',
      scenario: '.rounded-checkbox-ui — 639978 is ticked',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'DashBoard',
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

    await step('Click .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Line Chart : Getting flat line for Weekly and monthly')).click();
    });

    await step('639978 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Line Chart : Getting flat line for Weekly and monthly')).toBeChecked();
    });

    await step('Click #tr_637446 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('LineChart: Data labels are not displaying after toggle on')).click();
    });

    await step('Click #tr_637609 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('After selecting Different date in calendar of line chart it')).click();
    });

    await step('Click .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Line Chart : Getting flat line for Weekly and monthly')).click();
    });

    await step('639978 is not ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Line Chart : Getting flat line for Weekly and monthly')).not.toBeChecked();
    });
  });
});
