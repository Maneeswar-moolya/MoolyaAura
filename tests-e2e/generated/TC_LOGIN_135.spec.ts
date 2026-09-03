/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_135.
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
  test('TC_LOGIN_135 - Verify issue checkbox after issue row on the Issues page', async ({ page, loginPage, projectsPage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_135',
      module: '',
      scenario: 'Verify issue checkbox after issue row on the Issues page',
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

    await step('Click .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Line Chart : Getting flat line for Weekly and monthly')).click();
    });

    await step('#tc_summary_635838 contains "Compute Flow: Unable to update date in line chart."', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "Compute Flow: Unable to update date in line chart. Bug | | Line Chart" })).toContainText('Compute Flow: Unable to update date in line chart.');
    });

    await step('639978 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Line Chart : Getting flat line for Weekly and monthly')).toBeChecked();
    });

    await step('Click Compute Flow: Unable to', async () => {
      await (await issuesPage.issueRow('Compute Flow: Unable to update date in line chart.')).click();
    });

    await step('#response_modal_dialog contains "Compute Flow: Unable to update date in line chart."', async () => {
      await expect(page.locator('#response_modal_dialog')).toContainText('Compute Flow: Unable to update date in line chart.');
    });
  });
});
