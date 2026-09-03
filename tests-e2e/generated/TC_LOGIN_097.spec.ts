/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_097.
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
  test('TC_LOGIN_097 - Next — Next is enabled', async ({ page, loginPage, projectsPage, workspacePage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_097',
      module: '',
      scenario: 'Next — Next is enabled',
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

    await step('Click Tour', async () => {
      await (await workspacePage.introHelp()).click();
    });

    await step('Next is enabled', async () => {
      await expect(page.getByText("Next")).toBeEnabled();
    });

    await step('click Next', async () => {
      await (page.getByRole('button', { name: 'Next' })).click();
    });

    await step('Projects are how you organize work. Here is a list of all yo is visible', async () => {
      await expect(page.getByText("Projects are how you organize work. Here is a list of all your projects. With fi")).toBeVisible();
    });

    await step('click Next', async () => {
      await (page.getByRole('button', { name: 'Next' })).click();
    });
  });
});
