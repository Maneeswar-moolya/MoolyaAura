/**
 * Bugasura Projects area - https://my.bugasura.io/apps
 *
 * Locators below were read off the live DOM, not guessed. The create flow is
 * a form (#first-project-create-form) revealed by #create_project, with a
 * required Team dropdown that must be chosen before the submit will succeed.
 */

import type { Locator, Page } from '@playwright/test';

import { BASE_URL } from '../support/env';
import type { HealingRecorder } from '../support/resilient-locator';
import { BasePage } from './base.page';

export class ProjectsPage extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /**
   * Bugasura lands on /apps by itself after sign-in.
   *
   * Wait for that to happen before considering an explicit navigation: issuing
   * goto() while the app's own client-side navigation is in flight aborts it
   * and fails with net::ERR_ABORTED. Only navigate if the redirect never comes
   * - for example when this page object is used without signing in first.
   */
  async open(): Promise<void> {
    await this.page.waitForURL(/\/apps/, { timeout: 25_000 }).catch(() => {});
    if (!/\/apps/.test(this.page.url()))
      await this.goto(new URL('/apps', BASE_URL).toString());
    // `domcontentloaded` is NOT enough, and this was measured rather than argued.
    // Bugasura streams the project cards into /apps while the document is still
    // parsing: they are present, visible, stable and hit-testable ~1.35s after
    // sign-in, but their click handler is bound later, by the application's own
    // ready block. A click in that window is dispatched into an element with no
    // handler, is reported as successful by Playwright, and does nothing - the
    // browser simply stays on /apps. Waiting for `load` clears the ready block,
    // because a ready callback runs at DOMContentLoaded and `load` is strictly
    // after it.
    await this.page.waitForLoadState('load');
    await this.projectCardsInteractive();
    await this.dismissOnboardingModal();
  }

  /**
   * Wait until the project cards are wired up, not merely drawn.
   *
   * The application initialises the cards' tooltips in the SAME ready block that
   * binds their delegated click handler - measured twice, in the same 100ms
   * sample: the delegated `click` appears on `body` in the same tick that 23
   * elements gain `data-original-title`. That attribute is therefore the DOM's
   * own witness that the cards are live, and it is the only one this screen
   * offers: no class, no `data-initialized`, no framework upgrade marker moves
   * at that moment.
   *
   * Scoped to `#all_apps` so it can only ever describe the project list, and
   * bounded. It DEGRADES rather than hanging: if a future Bugasura stops using
   * that attribute, this returns and the click proceeds exactly as it does
   * today. It is a readiness probe, never a test action - nothing is clicked,
   * hovered, forced or retried here, and `first()` is used only to have one
   * element to wait on.
   */
  async projectCardsInteractive(timeout = 15_000): Promise<void> {
    await this.page.locator('#all_apps [data-original-title]').first()
        .waitFor({ state: 'attached', timeout })
        .catch(() => {});
  }

  /**
   * Open a project from the dashboard, by the name a person reads on the card.
   *
   * The locator is the one a recording of this action produces - `getByText(name)`
   * - deliberately unchanged: the human chose that element and the recorded
   * evidence proved it identifies exactly one. What this method adds is the
   * readiness BEFORE the click and the arrival check AFTER it, so a click that
   * the application swallows fails here, saying so, instead of failing three
   * steps later on an element that was never going to exist.
   */
  async openProject(name: string): Promise<void> {
    await this.open();
    await this.page.getByText(name).click();
    await this.page.waitForURL(/\/issues\//, { timeout: 20_000 });
  }

  /**
   * An onboarding modal can sit over the project list and swallow clicks.
   * Closing it is setup, not part of any test case's intent.
   */
  async dismissOnboardingModal(): Promise<void> {
    const close = this.page.locator('#first_report_modal button:has-text("close")').first();
    if (await close.isVisible().catch(() => false)) {
      await close.click();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * The project search box in the dashboard header, beside the Filter button.
   * Bugasura keeps a second, hidden copy for the mobile layout under the same
   * class (`.js-input-search`) - `getByRole` resolves to the visible one
   * because the hidden copy has no accessible role, but the CSS fallback must
   * filter `:visible` or it can resolve to the wrong input.
   */
  projectSearchField(): Promise<Locator> {
    return this.resolve('projects.searchField', [
      { strategy: "getByRole('textbox', { name: 'Search' })", build: page => page.getByRole('textbox', { name: 'Search' }) },
      { strategy: '.js-input-search:visible', build: page => page.locator('.js-input-search:visible') },
    ]);
  }

  createProjectButton(): Promise<Locator> {
    return this.resolve('projects.createButton', [
      { strategy: '#create_project', build: page => page.locator('#create_project') },
      { strategy: "getByRole('button', { name: /create project/i })", build: page => page.getByRole('button', { name: /create\s*project/i }) },
    ]);
  }

  projectNameField(): Promise<Locator> {
    return this.resolve('projects.nameField', [
      { strategy: '#proj_name', build: page => page.locator('#proj_name') },
      { strategy: "getByPlaceholder(/project name/i)", build: page => page.getByPlaceholder(/project\s*name/i) },
      { strategy: '#first-project-create-form input[type=text]', build: page => page.locator('#first-project-create-form input[type="text"]') },
    ]);
  }

  teamDropdownButton(): Promise<Locator> {
    return this.resolve('projects.teamDropdown', [
      { strategy: '#team_select_create .project__team-btn', build: page => page.locator('#team_select_create .project__team-btn') },
      { strategy: '#team_select_create button', build: page => page.locator('#team_select_create button') },
    ]);
  }

  submitButton(): Promise<Locator> {
    return this.resolve('projects.submitButton', [
      { strategy: '#create_first_report', build: page => page.locator('#create_first_report') },
      { strategy: '.create-report-button-div-btns-sec a:has-text("Create Project")', build: page => page.locator('.create-report-button-div-btns-sec a:has-text("Create Project")') },
    ]);
  }

  cancelButton(): Promise<Locator> {
    return this.resolve('projects.cancelButton', [
      { strategy: '#create_first_report_cancel', build: page => page.locator('#create_first_report_cancel') },
    ]);
  }

  /**
   * Inline validation messages. Bugasura blocks an invalid create entirely on
   * the client - no request is sent - and renders the reason in a `label.error`
   * beside the offending field. It is NOT a toast, unlike the login errors.
   */
  validationErrors(): Promise<Locator> {
    return this.resolve('projects.validationErrors', [
      { strategy: 'label.error (visible)', build: page => page.locator('label.error').filter({ hasText: /\S/ }) },
      { strategy: '#first-project-create-form .error', build: page => page.locator('#first-project-create-form .error') },
    ]);
  }

  /** Text of every visible validation message currently shown. */
  async validationMessages(): Promise<string[]> {
    return this.page.locator('label.error')
        .evaluateAll(nodes => nodes
            .filter(node => (node as HTMLElement).offsetParent !== null && node.textContent!.trim())
            .map(node => node.textContent!.trim()));
  }

  /** True while the create form is on screen. */
  async isFormOpen(): Promise<boolean> {
    return this.page.locator('#proj_name').isVisible().catch(() => false);
  }

  /** Team names offered by the dropdown, read from the live list. */
  async availableTeams(): Promise<string[]> {
    return this.page.locator('#team_select_create a.team-list-item')
        .evaluateAll(nodes => nodes.map(n => n.getAttribute('data-team-name') ?? '').filter(Boolean));
  }

  async selectTeam(teamName: string): Promise<void> {
    await (await this.teamDropdownButton()).click();
    const option = this.page.locator(`#team_select_create a.team-list-item[data-team-name="${teamName}"]`);
    await option.waitFor({ state: 'visible', timeout: 8000 });
    await option.click();
  }

  /** Open the create form and wait for it. */
  async openCreateForm(): Promise<void> {
    await (await this.createProjectButton()).click();
    await (await this.projectNameField()).waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Select whichever team the dropdown lists first. */
  async selectFirstTeam(): Promise<string> {
    await (await this.teamDropdownButton()).click();
    const option = this.page.locator('#team_select_create a.team-list-item').first();
    await option.waitFor({ state: 'visible', timeout: 10_000 });
    const name = (await option.getAttribute('data-team-name')) ?? '';
    await option.click();
    return name;
  }

  async submit(): Promise<void> {
    await (await this.submitButton()).click();
  }

  /** Fill the create form. Does not submit - the caller decides that. */
  async fillNewProject(name: string, teamName: string): Promise<void> {
    await this.openCreateForm();
    await (await this.projectNameField()).fill(name);
    await this.selectTeam(teamName);
  }

  /** True when a project with this exact name is listed. */
  async isProjectListed(name: string): Promise<boolean> {
    return (await this.page.getByText(name, { exact: true }).count()) > 0;
  }

  /** "Create New Project" popup heading - proves the dialog actually opened. */
  createProjectDialogHeading(): Promise<Locator> {
    return this.resolve('projects.createDialogHeading', [
      { strategy: 'getByText("Create New Project", exact)', build: page => page.getByText('Create New Project', { exact: true }) },
      { strategy: '.modal-header .title (Create New Project)', build: page => page.locator('.modal-header .title').filter({ hasText: 'Create New Project' }) },
    ]);
  }

  /** The "Create New Team" option inside the team dropdown's option list. */
  createNewTeamOption(): Promise<Locator> {
    return this.resolve('projects.createNewTeamOption', [
      { strategy: '#team_select_create .js-create-team a', build: page => page.locator('#team_select_create .js-create-team a') },
      { strategy: "getByRole('link', { name: 'Create New Team' })", build: page => page.getByRole('link', { name: 'Create New Team' }) },
    ]);
  }

  /** Open the "Create New Team" popup from the team dropdown on the create-project form. */
  async openCreateNewTeamForm(): Promise<void> {
    await (await this.teamDropdownButton()).click();
    await (await this.createNewTeamOption()).click();
    await (await this.teamNameField()).waitFor({ state: 'visible', timeout: 10_000 });
  }

  /** "Create New Team" popup heading. */
  createNewTeamHeading(): Promise<Locator> {
    return this.resolve('projects.createNewTeamHeading', [
      { strategy: '#create_team_invite_modal .modal-title', build: page => page.locator('#create_team_invite_modal .modal-title') },
      { strategy: 'getByText("Create New Team", exact)', build: page => page.getByText('Create New Team', { exact: true }) },
    ]);
  }

  teamNameField(): Promise<Locator> {
    return this.resolve('projects.teamNameField', [
      { strategy: '#create_team_name', build: page => page.locator('#create_team_name') },
      { strategy: 'getByPlaceholder(/enter team name/i)', build: page => page.getByPlaceholder(/enter team name/i) },
    ]);
  }

  /**
   * The tagsinput plugin hides the real `#team_invite_user_email` input and
   * renders a visible proxy text input inside this `.bootstrap-tagsinput`
   * container. The container - not the proxy input - is what must be clicked:
   * Playwright refuses a click directly on the proxy because the container
   * paints on top of it, and clicking the container is how the plugin itself
   * focuses the proxy for a real user.
   */
  teamEmailInputArea(): Promise<Locator> {
    return this.resolve('projects.teamEmailInputArea', [
      { strategy: '#create_team_invite_modal .bootstrap-tagsinput', build: page => page.locator('#create_team_invite_modal .bootstrap-tagsinput') },
    ]);
  }

  addTeamMemberButton(): Promise<Locator> {
    return this.resolve('projects.addTeamMemberButton', [
      { strategy: '#add_team_user_btn', build: page => page.locator('#add_team_user_btn') },
      { strategy: "getByRole('button', { name: 'Add', exact: true })", build: page => page.getByRole('button', { name: 'Add', exact: true }) },
    ]);
  }

  /** Inline validation message beside the team-invite email field. */
  teamEmailError(): Promise<Locator> {
    return this.resolve('projects.teamEmailError', [
      { strategy: '#invite_user_email_error', build: page => page.locator('#invite_user_email_error') },
    ]);
  }

  createTeamCancelButton(): Promise<Locator> {
    return this.resolve('projects.createTeamCancelButton', [
      { strategy: '#create_team_cancel_btn', build: page => page.locator('#create_team_cancel_btn') },
    ]);
  }

  /**
   * Types into the team-invite email field the way a person would. `fill()`
   * sets the value without the keystrokes the tagsinput plugin listens for to
   * enable the Add button, so this clicks the widget's visible container (see
   * teamEmailInputArea) and types instead.
   */
  async enterTeamEmail(email: string): Promise<void> {
    await (await this.teamEmailInputArea()).click();
    await this.page.keyboard.type(email);
  }

  async submitTeamEmail(): Promise<void> {
    await (await this.addTeamMemberButton()).click();
  }

  /** True while the "Create New Team" popup is on screen. */
  async isCreateTeamFormOpen(): Promise<boolean> {
    return this.page.locator('#create_team_name').isVisible().catch(() => false);
  }

  /**
   * The control in one project row, addressed by its description.
   *
   * Composed from the container the caller names, not from a row id: the
   * recorded ids belong to individual issues and change with the data. The
   * description is what identifies the row, and it is the caller's to supply.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  projectCard(description: string): Locator {
    return this.page.locator('#all_apps .title')
        .filter({ hasText: description });
  }

  /**
   * Desktop Web - operated on the ProjectsPage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  desktopWebPlatformOption(): Promise<Locator> {
    return this.resolve('projects.desktopWebPlatformOption', [
      { strategy: 'locator(\'#first-project-create-form .panel\').filter({ hasText: \'Desktop Web\' })', build: page => page.locator('#first-project-create-form .panel').filter({ hasText: 'Desktop Web' }) },
    ]);
  }

  /**
   * The control in one project row, addressed by its description.
   *
   * Composed from the container the caller names, not from a row id: the
   * recorded ids belong to individual issues and change with the data. The
   * description is what identifies the row, and it is the caller's to supply.
   *
   * Measured at the press in 2 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  projectButton(description: string): Locator {
    return this.page.locator('#team_select_create .team-list-item')
        .filter({ hasText: description });
  }
}
