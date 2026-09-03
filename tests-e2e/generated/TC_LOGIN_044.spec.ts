/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_044.
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

test.describe('Projects', () => {
  test('TC_LOGIN_044 - Faclon labs — #issues_banner contains "+ Add Issue JIRA Import GlitchTip Import Sentry Import Automation Import CSV Import Google Sheets Import Excel Import"', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_044',
      module: 'Projects',
      scenario: 'Faclon labs — #issues_banner contains "+ Add Issue JIRA Import GlitchTip Import Sentry Import Automation Import CSV Import Google Sheets Import Excel Import"',
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

    await step('#issues_banner contains "+ Add Issue JIRA Import GlitchTip Import Sentry Import Automation Import CSV Import Google Sheets Import Excel Import"', async () => {
      await expect(page.locator('#issues_banner')).toContainText('+ Add Issue JIRA Import GlitchTip Import Sentry Import Automation Import CSV Import Google Sheets Import Excel Import');
    });

    await step('#main-content contains "Faclon labs"', async () => {
      await expect(page.locator('#main-content')).toContainText('Faclon labs');
    });

    await step('#issue_stats_section contains "Total Issues"', async () => {
      await expect(page.locator('#issue_stats_section')).toContainText('Total Issues');
    });
  });
});
