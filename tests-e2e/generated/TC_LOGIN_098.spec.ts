/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_098.
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

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_098 - Open chat — heading contains "Talk to our support"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_098',
      module: '',
      scenario: 'Open chat — heading contains "Talk to our support"',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
    });

    await step('Open https://my.bugasura.io/', async () => {
      await loginPage.open();
    });

    await step('Sign in', async () => {
      await loginPage.signIn(bugasuraCredentials.email, bugasuraCredentials.password);
    });

    await step('Open https://my.bugasura.io/apps', async () => {
      await projectsPage.open();
    });

    await step('Open the Projects dashboard, and the Create Project / Create New Team dialogs', async () => {
      await projectsPage.open();
    });

    await step('click Open chat', async () => {
      await (page.locator('iframe[name="fc_widget"]').contentFrame().getByRole('button', { name: 'Open chat' })).click();
    });

    await step('heading contains "Talk to our support"', async () => {
      await expect(page.locator('iframe[name="fc_widget"]').contentFrame().getByRole('heading')).toContainText('Talk to our support');
    });

    await step('iframe[name="fc_widget"] contains "send"', async () => {
      await expect(page.locator('iframe[name="fc_widget"]').contentFrame().locator('button')).toContainText('send');
    });

    await step('iframe[name="fc_widget"] contains "send"', async () => {
      await expect(page.locator('iframe[name="fc_widget"]').contentFrame().locator('button')).toContainText('send');
    });
  });
});
