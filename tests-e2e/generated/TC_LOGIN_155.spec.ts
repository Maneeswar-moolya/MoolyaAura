/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_155.
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
  test('TC_LOGIN_155 - Search — #all_apps contains "Faclon labs"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_155',
      module: '',
      scenario: 'Search — #all_apps contains "Faclon labs"',
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

    await step('Click Search', async () => {
      await (await projectsPage.projectSearchField()).click();
    });

    await step('Enter the Search', async () => {
      await (await projectsPage.projectSearchField()).fill('Faclon');
    });

    await step('press Search', async () => {
      await (await projectsPage.projectSearchField()).press('Enter');
    });

    await step('#all_apps contains "Faclon labs"', async () => {
      await expect(page.locator('#all_apps')).toContainText('Faclon labs');
    });

    await step('input is visible', async () => {
      await expect(page.locator("#apps_tab_container .js-input-search")).toBeVisible();
    });
  });
});
