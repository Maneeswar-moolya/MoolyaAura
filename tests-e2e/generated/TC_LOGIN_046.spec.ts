/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_046.
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

test.describe('Projects', () => {
  test('TC_LOGIN_046 - Sign In — #project_banner contains "Name your projects the way your teams recognize it."', async ({ page, loginPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_046',
      module: 'Projects',
      scenario: 'Sign In — #project_banner contains "Name your projects the way your teams recognize it."',
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

    await step('#project_banner contains "Name your projects the way your teams recognize it."', async () => {
      await expect(page.locator('#project_banner')).toContainText('Name your projects the way your teams recognize it.');
    });

    await step('#contributed_projects contains "Following"', async () => {
      await expect(page.locator('#contributed_projects')).toContainText('Following');
    });
  });
});
