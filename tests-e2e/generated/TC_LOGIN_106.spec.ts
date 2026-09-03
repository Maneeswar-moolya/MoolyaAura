/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_106.
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

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_106 - Requirements Management — #requirements_banner contains "Requirements management need not be hard"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_106',
      module: '',
      scenario: 'Requirements Management — #requirements_banner contains "Requirements management need not be hard"',
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

    await step('click .rounded-checkbox-ui', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".rounded-checkbox-ui").nth(0)).click();
    });

    await step('click .rounded-checkbox-ui', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".rounded-checkbox-ui").nth(0)).click();
    });

    await step('click #tr_1749552 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui', async () => {
      await (page.locator(".tabulator-row").filter({ hasText: "login is not working in moolya aura SAM" }).locator(".rounded-checkbox-ui").nth(2)).click();
    });

    await step('click Requirements Management', async () => {
      await (page.getByRole('link', { name: 'Requirements Management' })).click();
    });

    await step('#requirements_banner contains "Requirements management need not be hard"', async () => {
      await expect(page.locator('#requirements_banner')).toContainText('Requirements management need not be hard');
    });
  });
});
