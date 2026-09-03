/**
 * Assembled from a Playwright Codegen recording of TC_DASHBOARD_007.
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
  test('TC_DASHBOARD_007 - Close — Enable Notifications Receive notifications for activity acro is ticked', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_DASHBOARD_007',
      module: '',
      scenario: 'Close — Enable Notifications Receive notifications for activity acro is ticked',
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

    await step('click Notifications', async () => {
      await (page.getByRole('link', { name: 'Notifications' })).click();
    });

    await step('click Notification settings', async () => {
      await (page.getByRole('button', { name: 'Notification settings' })).click();
    });

    await step('Enable Notifications Receive notifications for activity acro is ticked', async () => {
      await expect(page.getByLabel("Enable Notifications Receive notifications for activity across Bugasura.")).toBeChecked();
    });

    await step('click .ba-switch__track', async () => {
      await (page.locator('.ba-switch__track').first()).click();
    });

    await step('uncheck Enable Notifications Enable', async () => {
      await (page.getByRole('checkbox', { name: 'Enable Notifications Enable' })).uncheck();
    });

    await step('Enable Notifications Receive notifications for activity acro is not ticked', async () => {
      await expect(page.getByLabel("Enable Notifications Receive notifications for activity across Bugasura.")).not.toBeChecked();
    });

    await step('click .ba-switch__thumb', async () => {
      await (page.locator('.ba-switch__thumb').first()).click();
    });

    await step('check Enable Notifications Enable', async () => {
      await (page.getByRole('checkbox', { name: 'Enable Notifications Enable' })).check();
    });

    await step('click Close', async () => {
      await (page.getByRole('button', { name: 'Close' })).click();
    });
  });
});
