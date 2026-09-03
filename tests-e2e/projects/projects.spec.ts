/**
 * Generated from excel/login-test-cases.xlsx :: "Create Project"
 *
 * Split by blast radius, not by scenario type:
 *
 *   describe('Create Project - validation')  - never creates anything. Every
 *     submit here is invalid, and Bugasura blocks it client-side without
 *     sending a request, so these are safe to run on any workspace.
 *
 *   describe('Create Project - writes data') - gated behind
 *     BUGASURA_ALLOW_DATA_MUTATION=1. Nothing deletes what these create.
 */

import {
  expect,
  requireCredentials,
  requireDataMutationOptIn,
  test,
  trace,
} from '../fixtures';
import type { LoginPage } from '../pages/login.page';
import { targetTeam, type Credentials } from '../support/env';

const SOURCE = {
  module: 'Projects',
  sourceWorkbook: 'login-test-cases.xlsx',
  sourceWorksheet: 'Create Project',
};

/** Every test here signs in first; the pack's precondition is "user is signed in". */
async function signIn(loginPage: LoginPage, credentials: Credentials): Promise<void> {
  await loginPage.open();
  await loginPage.signIn(credentials.email, credentials.password);
}

test.describe('Create Project - validation', () => {
  test('TC_PROJ_002 - Create Project form opens from the Projects page', async ({
    loginPage, projectsPage, bugasuraCredentials,
  }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_PROJ_002', scenario: 'Create Project form opens from the Projects page', priority: 'P2' });
    requireCredentials(bugasuraCredentials);

    await signIn(loginPage, bugasuraCredentials);
    await projectsPage.open();
    await projectsPage.openCreateForm();

    // Expected: "The create form is displayed with a Project Name field and a
    // mandatory Team selector"
    await expect(await projectsPage.projectNameField()).toBeVisible();
    await expect(await projectsPage.teamDropdownButton()).toBeVisible();
    expect(await projectsPage.availableTeams(), 'Team selector should offer at least one team')
        .not.toHaveLength(0);
  });

  test('TC_PROJ_003 - Team is mandatory', async ({ loginPage, projectsPage, bugasuraCredentials }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_PROJ_003', scenario: 'Team is mandatory', priority: 'P1' });
    requireCredentials(bugasuraCredentials);

    await signIn(loginPage, bugasuraCredentials);
    await projectsPage.open();
    await projectsPage.openCreateForm();
    await (await projectsPage.projectNameField()).fill('QA Automation TC_PROJ_003 - never submitted');
    // Team deliberately left unselected.
    await projectsPage.submit();

    // Expected: 'The error "Team is not selected." is displayed, the form stays
    // open and no project is created'
    await expect.poll(() => projectsPage.validationMessages(), { timeout: 10_000 })
        .toContain('Team is not selected.');
    expect(await projectsPage.isFormOpen(), 'Form must stay open so the user can fix it').toBe(true);
  });

  test('TC_PROJ_004 - Project name is mandatory', async ({ loginPage, projectsPage, bugasuraCredentials }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_PROJ_004', scenario: 'Project name is mandatory', priority: 'P1' });
    requireCredentials(bugasuraCredentials);

    await signIn(loginPage, bugasuraCredentials);
    await projectsPage.open();
    await projectsPage.openCreateForm();
    // Name left empty. A team IS selected, otherwise the team error masks this one.
    await projectsPage.selectFirstTeam();
    await projectsPage.submit();

    // Expected: 'The error "Project name cannot be empty." is displayed, the
    // form stays open and no project is created'
    await expect.poll(() => projectsPage.validationMessages(), { timeout: 10_000 })
        .toContain('Project name cannot be empty.');
    expect(await projectsPage.isFormOpen(), 'Form must stay open so the user can fix it').toBe(true);
  });

  test('TC_PROJ_006 - Cancel discards the form', async ({ loginPage, projectsPage, bugasuraCredentials }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_PROJ_006', scenario: 'Cancel discards the form', priority: 'P2' });
    requireCredentials(bugasuraCredentials);

    await signIn(loginPage, bugasuraCredentials);
    await projectsPage.open();
    await projectsPage.openCreateForm();
    await (await projectsPage.projectNameField()).fill('QA Automation TC_PROJ_006 - cancelled');
    await (await projectsPage.cancelButton()).click();

    // Expected: "The form closes and no project is created"
    await expect.poll(() => projectsPage.isFormOpen(), { timeout: 10_000 }).toBe(false);
    expect(await projectsPage.isProjectListed('QA Automation TC_PROJ_006 - cancelled'),
        'Cancelling must not leave a project behind').toBe(false);
  });

  test('TC_PROJ_007 - Project name field length limit', async ({ loginPage, projectsPage, bugasuraCredentials }, testInfo) => {
    await trace({ ...SOURCE, testCaseId: 'TC_PROJ_007', scenario: 'Project name field length limit', priority: 'P3' });
    requireCredentials(bugasuraCredentials);

    await signIn(loginPage, bugasuraCredentials);
    await projectsPage.open();
    await projectsPage.openCreateForm();

    // Never submitted - this case only inspects what the field accepts.
    const field = await projectsPage.projectNameField();
    const declared = await field.evaluate(node => (node as HTMLInputElement).maxLength);
    await field.fill('z'.repeat(300));
    const kept = (await field.inputValue()).length;

    testInfo.annotations.push({
      type: 'finding',
      description: `#proj_name declares maxLength=${declared} and kept ${kept} of 300 typed characters.`,
    });

    // Expected: "The field enforces a documented maximum length".
    // The workbook has no number in it because none is documented, so this
    // asserts the weaker, honest thing: input is bounded at all. It fails today,
    // which is the finding - see ai/reports/test-case-change-requests.md.
    expect(kept, `Project Name accepted all ${kept} characters - no client-side limit is enforced`)
        .toBeLessThan(300);
  });
});

test.describe('Create Project - writes data', () => {
  test('TC_PROJ_001 - Create a project with a valid name and team', async ({
    loginPage, projectsPage, bugasuraCredentials,
  }, testInfo) => {
    await trace({ ...SOURCE, testCaseId: 'TC_PROJ_001', scenario: 'Create a project with a valid name and team', priority: 'P1' });
    requireCredentials(bugasuraCredentials);
    requireDataMutationOptIn();

    const team = targetTeam();
    expect(team, 'Set BUGASURA_TEAM - Bugasura marks Team mandatory on the create form').toBeTruthy();

    const projectName = `QA Automation TC_PROJ_001 ${testInfo.workerIndex}-${Date.now()}`;

    await signIn(loginPage, bugasuraCredentials);
    await projectsPage.open();
    await projectsPage.fillNewProject(projectName, team!);
    await projectsPage.submit();

    // Expected: "The project is created and appears in the project list"
    await expect.poll(() => projectsPage.isProjectListed(projectName), { timeout: 25_000 }).toBe(true);

    testInfo.annotations.push({
      type: 'created-data',
      description: `Left behind in team "${team}": project "${projectName}". Delete manually.`,
    });
  });

  test('TC_PROJ_005 - Whitespace-only project name is rejected', async ({
    loginPage, projectsPage, bugasuraCredentials,
  }) => {
    await trace({ ...SOURCE, testCaseId: 'TC_PROJ_005', scenario: 'Whitespace-only project name is rejected', priority: 'P2' });
    requireCredentials(bugasuraCredentials);
    // Gated even though it "should" be rejected: if Bugasura does not trim, this
    // submit CREATES a project named "   ". Until that is known, treat it as
    // data-mutating rather than find out the hard way on a client workspace.
    requireDataMutationOptIn();

    await signIn(loginPage, bugasuraCredentials);
    await projectsPage.open();
    await projectsPage.openCreateForm();
    await (await projectsPage.projectNameField()).fill('   ');
    await projectsPage.selectFirstTeam();
    await projectsPage.submit();

    // Expected: "The name is rejected as empty and no project is created"
    await expect.poll(() => projectsPage.validationMessages(), { timeout: 10_000 })
        .toContain('Project name cannot be empty.');
    expect(await projectsPage.isFormOpen()).toBe(true);
  });
});
