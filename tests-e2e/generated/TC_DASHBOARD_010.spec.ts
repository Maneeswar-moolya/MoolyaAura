/**
 * Assembled from a Playwright Codegen recording of TC_DASHBOARD_010.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 4 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('DashBoard', () => {
  test('TC_DASHBOARD_010 - .rounded-checkbox-ui — 637446 is not ticked', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_DASHBOARD_010',
      module: '',
      scenario: '.rounded-checkbox-ui — 637446 is not ticked',
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

    await step('click .rounded-checkbox-ui', async () => {
      await (page.locator('.rounded-checkbox-ui').first()).click();
    });

    await step('check [id="639978"]', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly" }).locator(".bugChecked")).check();
    });

    await step('637446 is not ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "LineChart: Data labels are not displaying after toggle on" }).locator(".bugChecked")).not.toBeChecked();
    });
  });
});
