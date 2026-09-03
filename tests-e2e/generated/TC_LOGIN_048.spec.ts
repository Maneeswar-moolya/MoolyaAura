/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_048.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 7 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_048 - Cancel — #contributed_projects contains "Following"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_048',
      module: '',
      scenario: 'Cancel — #contributed_projects contains "Following"',
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

    await step('Click + Create Project', async () => {
      await (await projectsPage.createProjectButton()).click();
    });

    await step('click Enter a Project Name', async () => {
      await (page.getByRole('textbox', { name: 'Enter a Project Name' })).click();
    });

    await step('click Enter a Project Name', async () => {
      await (page.getByRole('textbox', { name: 'Enter a Project Name' })).click();
    });

    await step('fill Enter a Project Name', async () => {
      await (page.getByRole('textbox', { name: 'Enter a Project Name' })).fill('tre');
    });

    await step('click Select your team ', async () => {
      await (page.getByRole('button', { name: 'Select your team ' })).click();
    });

    await step('click kwysight', async () => {
      await (page.getByRole('link', { name: 'kwysight' })).click();
    });

    await step('click Cancel', async () => {
      await (page.getByText('Cancel')).click();
    });

    await step('#contributed_projects contains "Following"', async () => {
      await expect(page.locator('#contributed_projects')).toContainText('Following');
    });
  });
});
