/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_069.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 6 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login', () => {
  test('TC_LOGIN_069 - Close — #tc_update_status_1254476 contains "New"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_069',
      module: 'Login',
      scenario: 'Close — #tc_update_status_1254476 contains "New"',
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

    await step('click Bugasura Live Support', async () => {
      await (page.getByText('Bugasura Live Support')).click();
    });

    await step('#tc_update_status_1254476 contains "New"', async () => {
      await expect(page.locator("#bugReport-table .badge").filter({ hasText: "New" })).toContainText('New');
    });

    await step('click Display folder name and test', async () => {
      await (page.locator("#bugReport-table .bug-report__summary--text.hidden-xs").getByText("Display folder name and test case count with pipe symbol. ex. \"Login | 15 cases\"")).click();
    });

    await step('#response_modal_dialog contains "Display folder name and test case count with pipe symbol. ex. "Login | 15 cases" or "Login | 15""', async () => {
      await expect(page.locator('#response_modal_dialog')).toContainText('Display folder name and test case count with pipe symbol. ex. "Login | 15 cases" or "Login | 15"');
    });

    await step('click close', async () => {
      await (page.getByRole('button', { name: 'close' })).click();
    });

    await step('heading contains "All Issues"', async () => {
      await expect(page.getByRole('heading')).toContainText('All Issues');
    });
  });
});
