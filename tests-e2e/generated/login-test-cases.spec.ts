import { expect, requireCredentials, test, trace } from '../fixtures';
import { IssuesPage } from '../pages/issues.page';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_066 - Verify that the issue details/summary is displayed.', async ({ page, loginPage, projectsPage, bugasuraCredentials, healing, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_066',
      module: '',
      scenario: 'Verify that the issue details/summary is displayed.',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
      priority: 'P0',
    });

    const issuesPage = new IssuesPage(page, healing);

    await step('Open Bugasura and sign in', async () => {
      await loginPage.open();
      await loginPage.signIn(bugasuraCredentials.email, bugasuraCredentials.password);
    });

    await step('Open the Faclon labs project', async () => {
      await projectsPage.openProject('Faclon labs');
    });

    await step('Search the issue list for "fac11"', async () => {
      await issuesPage.search('fac11');
    });

    await step('Verify the resulting issue is New', async () => {
      const rows = issuesPage.resultRows();
      await expect(rows).toHaveCount(1);
      await expect(issuesPage.rowStatus(rows.first())).toHaveText('New');
    });
  });
});
