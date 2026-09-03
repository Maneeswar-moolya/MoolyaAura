/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_050.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 3 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_050 - Notifications — #project_banner contains "Name your projects the way your teams recognize it."', async ({ page, loginPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_050',
      module: '',
      scenario: 'Notifications — #project_banner contains "Name your projects the way your teams recognize it."',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
    });

    await step('Open https://my.bugasura.io/', async () => {
      await loginPage.open();
    });

    await step('Sign in', async () => {
      await loginPage.signIn(bugasuraCredentials.email, bugasuraCredentials.password);
    });

    await step('#project_banner contains "Name your projects the way your teams recognize it."', async () => {
      await expect(page.locator('#project_banner')).toContainText('Name your projects the way your teams recognize it.');
    });

    await step('click Notifications', async () => {
      await (page.getByRole('link', { name: 'Notifications' })).click();
    });

    await step('#ap_notifications_panel contains "Notification Preferences"', async () => {
      await expect(page.locator('#ap_notifications_panel')).toContainText('Notification Preferences');
    });
  });
});
