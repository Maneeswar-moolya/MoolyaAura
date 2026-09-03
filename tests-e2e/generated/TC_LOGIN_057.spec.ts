/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_057.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * 4 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_057 - Italian — #login_area contains "English"', async ({ page, loginPage, step }) => {

    await trace({
      testCaseId: 'TC_LOGIN_057',
      module: '',
      scenario: 'Italian — #login_area contains "English"',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
    });

    await step('Open https://my.bugasura.io/', async () => {
      await loginPage.open();
    });

    await step('#login_area contains "English"', async () => {
      await expect(page.locator('#login_area')).toContainText('English');
    });

    await step('click English ', async () => {
      await (page.getByRole('button', { name: 'English ' })).click();
    });

    await step('click Italian', async () => {
      await (page.getByRole('link', { name: 'Italian' })).click();
    });

    await step('heading contains "Benvenuto su Bugasura"', async () => {
      await expect(page.getByRole('heading')).toContainText('Benvenuto su Bugasura');
    });
  });
});
