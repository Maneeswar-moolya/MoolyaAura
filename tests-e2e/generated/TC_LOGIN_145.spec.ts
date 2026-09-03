/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_145.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * The title is DERIVED, not authored: the workbook's Scenario cell says
 * the title contains a CSS selector, so it cannot name this test stably. This title comes from the
 * semantic journey instead (action method + state method + screen). The cell itself is unchanged.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_145 - Verify issue checkbox selection on the Issues page', async ({ loginPage, projectsPage, bugasuraCredentials, step, issuesPage }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_145',
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

    await step('Open the Projects dashboard, and the Create Project / Create New Team dialogs', async () => {
      await projectsPage.open();
    });

    await step('Click Faclon labs', async () => {
      await (await projectsPage.projectCard('Faclon labs')).click();
    });

    await step('Click #tr_638416 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Compare Mode : After selecting any one day in Calendar of')).click();
    });

    await step('Click .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Line Chart : Getting flat line for Weekly and monthly')).click();
    });

    await step('639978 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Line Chart : Getting flat line for Weekly and monthly')).toBeChecked();
    });
  });
});
