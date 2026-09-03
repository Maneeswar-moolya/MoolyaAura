/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_143.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 10 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_143 - Close — heading contains "A comprehensive visual overview of bug status, trends, and metrics for effective monitoring and analysis."', async ({ page, loginPage, projectsPage, workspacePage, bugasuraCredentials, step, issuesPage, notificationsPanel }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_143',
      module: '',
      scenario: 'Close — heading contains "A comprehensive visual overview of bug status, trends, and metrics for effective monitoring and analysis."',
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

    await step('Click #tr_635838 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (await issuesPage.issueCheckbox('Compute Flow: Unable to update date in line chart. FAC')).click();
    });

    await step('635838 is ticked', async () => {
      await expect(await issuesPage.issueCheckboxState('Compute Flow: Unable to update date in line chart. FAC')).toBeChecked();
    });

    await step('click Reports', async () => {
      await (page.getByRole('link', { name: 'Reports' })).click();
    });

    await step('heading contains "A comprehensive visual overview of bug status, trends, and metrics for effective monitoring and analysis."', async () => {
      await expect(page.getByRole('heading')).toContainText('A comprehensive visual overview of bug status, trends, and metrics for effective monitoring and analysis.');
    });

    await step('Click Activity', async () => {
      await (await workspacePage.reportsNavLink('Activity')).click();
    });

    await step('heading contains "Activity"', async () => {
      await expect(page.getByRole('heading')).toContainText('Activity');
    });

    await step('Click Notifications', async () => {
      await (await workspacePage.notificationsBell()).click();
    });

    await step('Click Notification settings', async () => {
      await (await notificationsPanel.settingsButton()).click();
    });

    await step('Enable Notifications Receive notifications for activity acro is ticked', async () => {
      await expect(page.getByLabel("Enable Notifications Receive notifications for activity across Bugasura.")).toBeChecked();
    });

    await step('click .ba-switch__thumb', async () => {
      await (page.locator(".modal").filter({ hasText: "notify you when something important happens.  Notification" }).locator(".ba-switch__thumb").nth(0)).click();
    });

    await step('uncheck Enable Notifications Enable', async () => {
      await (page.getByRole('checkbox', { name: 'Enable Notifications Enable' })).uncheck();
    });

    await step('Enable Notifications Receive notifications for activity acro is not ticked', async () => {
      await expect(page.getByLabel("Enable Notifications Receive notifications for activity across Bugasura.")).not.toBeChecked();
    });

    await step('click .ba-switch__track', async () => {
      await (page.locator(".modal").filter({ hasText: "notify you when something important happens.  Notification" }).locator(".ba-switch__track").nth(0)).click();
    });

    await step('check Enable Notifications Enable', async () => {
      await (page.getByRole('checkbox', { name: 'Enable Notifications Enable' })).check();
    });

    await step('click Close', async () => {
      await (page.locator(".modal").filter({ hasText: "notify you when something important happens.  Notification" }).locator(".ap-notif-settings-close")).click();
    });
  });
});
