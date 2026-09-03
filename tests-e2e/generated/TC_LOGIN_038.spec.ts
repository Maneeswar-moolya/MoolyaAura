/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_038.
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

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_038 - Close widget — heading contains "Welcome to Bugasura"', async ({ page, loginPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_038',
      module: '',
      scenario: 'Close widget — heading contains "Welcome to Bugasura"',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
    });

    await step('Open https://my.bugasura.io/', async () => {
      await loginPage.open();
    });

    await step('heading contains "Welcome to Bugasura"', async () => {
      await expect(page.getByRole('heading')).toContainText('Welcome to Bugasura');
    });

    await step('Sign in', async () => {
      await loginPage.signIn(bugasuraCredentials.email, bugasuraCredentials.password);
    });

    await step('#project_banner contains "Multi tasking is hard. Focus is good."', async () => {
      await expect(page.locator('#project_banner')).toContainText('Multi tasking is hard. Focus is good.');
    });

    await step('click Open chat', async () => {
      await (page.locator('iframe[name="fc_widget"]').contentFrame().getByRole('button', { name: 'Open chat' })).click();
    });

    await step('heading contains "Talk to our support"', async () => {
      await expect(page.locator('iframe[name="fc_widget"]').contentFrame().getByRole('heading')).toContainText('Talk to our support');
    });

    await step('click Close widget', async () => {
      await (page.locator('iframe[name="fc_widget"]').contentFrame().getByRole('button', { name: 'Close widget' })).click();
    });
  });
});
