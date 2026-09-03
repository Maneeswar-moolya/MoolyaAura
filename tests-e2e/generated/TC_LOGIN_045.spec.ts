/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_045.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 3 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Projects', () => {
  test('TC_LOGIN_045 - Faclon labs — #issue_stats_section contains "Total Issues"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_045',
      module: 'Projects',
      scenario: 'Faclon labs — #issue_stats_section contains "Total Issues"',
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

    await step('click Faclon labs', async () => {
      await (page.getByText('Faclon labs')).click();
    });

    await step('#issue_stats_section contains "Total Issues"', async () => {
      await expect(page.locator('#issue_stats_section')).toContainText('Total Issues');
    });

    await step('#main-content contains "Faclon labs"', async () => {
      await expect(page.locator('#main-content')).toContainText('Faclon labs');
    });
  });
});
