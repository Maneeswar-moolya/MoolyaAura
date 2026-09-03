/**
 * Assembled from a Playwright Codegen recording of TC_DASHBOARD_016.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 9 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('DashBoard', () => {
  test('TC_DASHBOARD_016 - Config Line Chart: Unable to — #all_apps contains "Faclon labs"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_DASHBOARD_016',
      module: 'DashBoard',
      scenario: 'Config Line Chart: Unable to — #all_apps contains "Faclon labs"',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'DashBoard',
      priority: 'P0',
    });

    await step('Open https://my.bugasura.io/', async () => {
      await loginPage.open();
    });

    await step('Sign in', async () => {
      await loginPage.signIn(bugasuraCredentials.email, bugasuraCredentials.password);
    });

    await step('#all_apps contains "Faclon labs"', async () => {
      await expect(page.locator('#all_apps')).toContainText('Faclon labs');
    });

    await step('Open the Projects dashboard, and the Create Project / Create New Team dialogs', async () => {
      await projectsPage.open();
    });

    await step('click Faclon labs', async () => {
      await (page.getByText('Faclon labs')).click();
    });

    await step('#issue_stats_section contains "Total Issues"', async () => {
      await expect(page.locator('#issue_stats_section')).toContainText('Total Issues');
    });

    await step('639978 is not ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly" }).locator(".bugChecked")).not.toBeChecked();
    });

    await step('click .rounded-checkbox-ui', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly" }).locator(".rounded-checkbox-ui")).click();
    });

    await step('#tc_summary_636432 contains "Config Line Chart: Unable to select periodicities under fixed time mode. Nothing is displaying after clicking on Periodicities Dropdown"', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "Config Line Chart: Unable to select periodicities under fixed time mode. Nothing" })).toContainText('Config Line Chart: Unable to select periodicities under fixed time mode. Nothing is displaying after clicking on Periodicities Dropdown');
    });

    await step('639978 is ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly" }).locator(".bugChecked")).toBeChecked();
    });

    await step('click Config Line Chart: Unable to', async () => {
      await (page.locator("#bugReport-table .bug-report__summary--text.hidden-xs").getByText("Config Line Chart: Unable to select periodicities under fixed time mode. Nothing")).click();
    });

    await step('#response_modal_dialog contains "Config Line Chart: Unable to select periodicities under fixed time mode. Nothing is displaying after clicking on Periodicities Dropdown"', async () => {
      await expect(page.locator('#response_modal_dialog')).toContainText('Config Line Chart: Unable to select periodicities under fixed time mode. Nothing is displaying after clicking on Periodicities Dropdown');
    });
  });
});
