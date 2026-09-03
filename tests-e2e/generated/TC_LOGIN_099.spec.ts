/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_099.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 2 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_099 - Sample — #tc_summary_1749558 contains "Copy of login is not working in moolya aura"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_099',
      module: '',
      scenario: 'Sample — #tc_summary_1749558 contains "Copy of login is not working in moolya aura"',
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

    await step('click sample', async () => {
      await (page.locator("#all_apps .title").filter({ hasText: "sample" })).click();
    });

    await step('#tc_summary_1749558 contains "Copy of login is not working in moolya aura"', async () => {
      await expect(page.locator("#bugReport-table .tabulator-cell").filter({ hasText: "Copy of login is not working in moolya aura Bug | | Authentication" })).toContainText('Copy of login is not working in moolya aura');
    });
  });
});
