/**
 * Assembled from a Playwright Codegen recording of TC_LOGIN_127.
 *
 * Deterministic: every step below is a recorded action mapped onto an existing
 * Page Object method. No browser was opened and no model was asked to write this.
 *
 * The recording included a sign-in. It is performed here through the existing
 * fixture and Page Object - the recorded credentials were never captured.
 *
 * 5 step(s) use the recorded locator directly, because no Page
 * Object method describes that element yet.
 *
 * The title is DERIVED, not authored: the workbook's Scenario cell says
 * the title contains a class or id token, so it cannot name this test stably. This title comes from the
 * semantic journey instead (action method + screen). The cell itself is unchanged.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

test.describe('Login Test Cases', () => {
  test('TC_LOGIN_127 - Verify team name field on the Projects page', async ({ page, loginPage, projectsPage, bugasuraCredentials, step }) => {
    requireCredentials(bugasuraCredentials);

    await trace({
      testCaseId: 'TC_LOGIN_127',
      module: '',
      scenario: 'Verify team name field on the Projects page',
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

    await step('Click Enter a Project Name', async () => {
      await (await projectsPage.projectNameField()).click();
    });

    await step('Enter the Enter a Project Name', async () => {
      await (await projectsPage.projectNameField()).fill('test');
    });

    await step('click Select your team ', async () => {
      await (page.getByRole('button', { name: 'Select your team ' })).click();
    });

    await step('Click Create New Team', async () => {
      await (await projectsPage.createNewTeamOption()).click();
    });

    await step('Click Create New Team', async () => {
      await (await projectsPage.createNewTeamOption()).click();
    });

    await step('Click Enter team name', async () => {
      await (await projectsPage.teamNameField()).click();
    });

    await step('Enter the Enter team name', async () => {
      await (await projectsPage.teamNameField()).fill('test');
    });

    await step('click #create_team_invite_modal', async () => {
      await (page.locator('#create_team_invite_modal')).click();
    });

    await step('#create_team_invite_form contains "Owner"', async () => {
      await expect(page.locator('#create_team_invite_form')).toContainText('Owner');
    });

    await step('click Cancel', async () => {
      await (page.locator("#create_team_cancel_btn")).click();
    });

    await step('#first_report_modal contains "Create New Project"', async () => {
      await expect(page.locator('#first_report_modal')).toContainText('Create New Project');
    });
  });
});
