/**
 * Assembled from a Playwright Codegen recording of TC_DASHBOARD_018.
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
  test('TC_DASHBOARD_018 - Notification settings — #all_apps contains "Faclon labs"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_DASHBOARD_018',
      module: 'DashBoard',
      scenario: 'Notification settings — #all_apps contains "Faclon labs"',
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

    await step('#all_apps contains "iosense.io"', async () => {
      await expect(page.locator('#all_apps')).toContainText('iosense.io');
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

    await step('639978 is ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line for Weekly and monthly" }).locator(".bugChecked")).toBeChecked();
    });

    await step('click Notifications', async () => {
      await (page.getByRole('link', { name: 'Notifications' })).click();
    });

    await step('click Notification settings', async () => {
      await (page.getByRole('button', { name: 'Notification settings' })).click();
    });

    await step('#ap_notifications_panel contains "Notification Preferences"', async () => {
      await expect(page.locator('#ap_notifications_panel')).toContainText('Notification Preferences');
    });
  });
});
