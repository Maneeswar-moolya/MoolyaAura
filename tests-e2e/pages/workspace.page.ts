/**
 * The signed-in Bugasura workspace.
 *
 * Kept intentionally small: only what the current test cases assert on. It
 * grows when a test case needs it, not before - a page object full of unused
 * methods is a maintenance cost with no test behind it.
 */

import type { Locator, Page } from '@playwright/test';

import type { HealingRecorder } from '../support/resilient-locator';
import { BasePage } from './base.page';

export class WorkspacePage extends BasePage {
  constructor(page: Page, healing?: HealingRecorder) {
    super(page, healing);
  }

  /** Something that only exists once authentication has succeeded. */
  signedInMarker(): Promise<Locator> {
    return this.resolve('workspace.signedInMarker', [
      { strategy: "getByRole('navigation')", build: page => page.getByRole('navigation') },
      { strategy: "getByRole('button', { name: /profile|account|avatar/i })", build: page => page.getByRole('button', { name: /profile|account|avatar|menu/i }) },
      { strategy: "getByText(/dashboard|projects|issues|workspace/i)", build: page => page.getByText(/dashboard|projects|issues|workspace/i) },
    ]);
  }

  projectsLink(): Promise<Locator> {
    return this.resolve('workspace.projectsLink', [
      { strategy: "getByRole('link', { name: /projects/i })", build: page => page.getByRole('link', { name: /projects/i }) },
      { strategy: "getByRole('button', { name: /projects/i })", build: page => page.getByRole('button', { name: /projects/i }) },
      { strategy: "getByText(/projects/i)", build: page => page.getByText(/^projects$/i) },
    ]);
  }

  /**
   * The notification bell in the top bar.
   *
   * Nav chrome, like projectsLink() above it - present wherever the person is
   * signed in, not owned by any one screen. The panel it opens is its own
   * component (NotificationsPanel); this is only the control that opens it.
   *
   * `#notif_bell_trigger` is an authored id and measured exactly one element. The
   * role fallback is the non-exact form on purpose: with `exact: true` the
   * recordings measured TWO, and both forms resolved to this same id.
   */
  notificationsBell(): Promise<Locator> {
    return this.resolve('workspace.notificationsBell', [
      { strategy: '#notif_bell_trigger', build: page => page.locator('#notif_bell_trigger') },
      { strategy: "getByRole('link', { name: 'Notifications' })", build: page => page.getByRole('link', { name: 'Notifications' }) },
    ]);
  }

  /**
   * A tab in the projects dashboard: My Favourites, All, Team Projects,
   * Following.
   *
   * Matched on the tab's own label span rather than page-wide text. The tab
   * strip and the section header both say "My Favourites", and confusing the
   * two is precisely how a test can click nothing and still find the words.
   */
  /**
   * The tab strip entries matching a name - a COLLECTION, declared as one.
   *
   * `/apps` renders the strip more than once (a desktop row and a narrow-screen
   * copy), so a named tab legitimately matches more than one element and
   * `isTabActive` reads the first deliberately. Declaring that here is what
   * keeps `resolve`'s "exactly one" rule honest everywhere else: this method is
   * the exception because its meaning is a set, not because the locator is
   * loose.
   */
  dashboardTab(name: string): Promise<Locator> {
    const label = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    return this.resolveMany(`workspace.dashboardTab(${name})`, [
      {
        strategy: `.dashboard-tab-options .project-tab-js:has(.project-type-label matching /${name}/i)`,
        build: page => page.locator('.dashboard-tab-options .project-tab-js')
            .filter({ has: page.locator('.project-type-label').filter({ hasText: label }) }),
      },
      {
        strategy: `.project-tab-js:has-text(/${name}/i)`,
        build: page => page.locator('.project-tab-js').filter({ hasText: label }),
      },
    ]);
  }

  /**
   * The heading naming which set of projects is on screen.
   *
   * This is the element that actually moves when a tab is clicked - it reads
   * "All Projects" on arrival and takes the tab's name afterwards. The tab
   * label does not move, so it can witness nothing.
   */
  sectionHeader(): Promise<Locator> {
    return this.resolve('workspace.sectionHeader', [
      { strategy: "locator('h2').first()", build: page => page.locator('h2:visible') },
      { strategy: "getByRole('heading', { level: 2 })", build: page => page.getByRole('heading', { level: 2 }) },
    ]);
  }

  /** Whether a dashboard tab is the selected one. */
  async isTabActive(name: string): Promise<boolean> {
    const tab = await this.dashboardTab(name);
    return ((await tab.first().getAttribute('class')) ?? '').split(/\s+/).includes('active');
  }

  async isSignedIn(): Promise<boolean> {
    // No VISIBLE password field is the stable signal that the sign-in screen is
    // gone. Bugasura keeps a hidden sign-up form mounted, so counting all
    // password inputs would never reach zero and this would never return true.
    return (await this.page.locator('input[type="password"]:visible').count()) === 0;
  }

  /**
   * Tour - operated on the WorkspacePage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  introHelp(): Promise<Locator> {
    return this.resolve('workspace.introHelp', [
      { strategy: '#intro_help', build: page => page.locator('#intro_help') },
    ]);
  }

  /**
   * add Add Issue - operated on the WorkspacePage screen.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  newIssue(): Promise<Locator> {
    return this.resolve('workspace.newIssue', [
      { strategy: 'locator(\'#bug_no_issue_added .mdl-button\').filter({ hasText: \'add Add Issue\' })', build: page => page.locator('#bug_no_issue_added .mdl-button').filter({ hasText: 'add Add Issue' }) },
    ]);
  }

  /**
   * The control in one workspace row, addressed by its description.
   *
   * Composed from the container the caller names, not from a row id: the
   * recorded ids belong to individual issues and change with the data. The
   * description is what identifies the row, and it is the caller's to supply.
   *
   * Measured at the press in 2 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  reportsNavLink(description: string): Locator {
    return this.page.locator('#reports_nav .js-activity-link')
        .filter({ hasText: description });
  }

  /**
   * The control in one workspace row, addressed by its description.
   *
   * Composed from the container the caller names, not from a row id: the
   * recorded ids belong to individual issues and change with the data. The
   * description is what identifies the row, and it is the caller's to supply.
   *
   * Measured at the press in 2 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  bugReportOverviewLink(description: string): Locator {
    return this.page.locator('#bugreport_main_container .js-overview-link')
        .filter({ hasText: description });
  }

  /**
   * The control in one workspace row, addressed by its description.
   *
   * Composed from the container the caller names, not from a row id: the
   * recorded ids belong to individual issues and change with the data. The
   * description is what identifies the row, and it is the caller's to supply.
   *
   * Measured at the press in 1 recording(s): one element, in the
   * document the press happened in, and that element is the one acted on.
   */
  newIssuesBadge(description: string): Locator {
    return this.page.locator('#issue_stats_section .u-dis-f-rc')
        .filter({ hasText: description });
  }
}
