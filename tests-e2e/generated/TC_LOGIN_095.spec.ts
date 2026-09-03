/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_095.
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

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_095 - Notification settings — #ap_notifications_panel contains "Notification Preferences"', async ({ page, loginPage, projectsPage, workspacePage, bugasuraCredentials, step, notificationsPanel }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_095',
      module: '',
      scenario: 'Notification settings — #ap_notifications_panel contains "Notification Preferences"',
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

    await step('Click Notifications', async () => {
      await (await workspacePage.notificationsBell()).click();
    });

    await step('Click Notification settings', async () => {
      await (await notificationsPanel.settingsButton()).click();
    });

    await step('#ap_notifications_panel contains "Notification Preferences"', async () => {
      await expect(await notificationsPanel.panel()).toContainText('Notification Preferences');
    });

    await step('Enable Notifications Receive notifications for activity acro is ticked', async () => {
      await expect(page.getByLabel("Enable Notifications Receive notifications for activity across Bugasura.")).toBeChecked();
    });
  });
});
