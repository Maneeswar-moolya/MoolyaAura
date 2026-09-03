/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_108.
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
  test('TC_LOGIN_108 - .rounded-checkbox-ui — 1749553 is not ticked', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_108',
      module: '',
      scenario: '.rounded-checkbox-ui — 1749553 is not ticked',
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

    await step('1749553 is not ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".bugChecked").nth(0)).not.toBeChecked();
    });

    await step('click .rounded-checkbox-ui', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".rounded-checkbox-ui").nth(0)).click();
    });

    await step('1749553 is ticked', async () => {
      await expect(page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".bugChecked").nth(0)).toBeChecked();
    });
  });
});
