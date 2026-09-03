/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_072.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 5 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login', () => {
  test('TC_LOGIN_072 - Close — #ap_notifications_panel contains "Notification Preferences"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_072',
      module: 'Login',
      scenario: 'Close — #ap_notifications_panel contains "Notification Preferences"',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
      priority: 'P0',
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

    await step('#ap_notifications_panel contains "Notification Preferences"', async () => {
      await expect(page.locator('#ap_notifications_panel')).toContainText('Notification Preferences');
    });

    await step('#ap_notifications_panel contains "Enable Notifications"', async () => {
      await expect(page.locator('#ap_notifications_panel')).toContainText('Enable Notifications');
    });

    await step('click Close', async () => {
      await (page.getByRole('button', { name: 'Close' })).click();
    });

    await step('#project_banner contains "Multi tasking is hard. Focus is good."', async () => {
      await expect(page.locator('#project_banner')).toContainText('Multi tasking is hard. Focus is good.');
    });
  });
});
