/**
 * Generated from excel/login-test-cases.xlsx :: "DashBoard"
 *
 * Why this case is a spec and not a data-driven row: its steps click a tab and
 * then read what changed. The shared runners open a page, fill the named fields
 * and press one control - nothing more - so as a `Visible` row the click never
 * happened and the assertion ran against the projects dashboard as it arrives.
 *
 * That still went green, which is the whole reason this file exists. Bugasura
 * puts "My Favourites" in the tab strip at all times, so "is My Favourites on
 * the page?" is true before anything is clicked. The element that actually
 * moves is the section heading: "All Projects" on arrival, "My Favourites"
 * after the tab is selected. Asserting on the heading is what makes the click
 * load-bearing - break the click and this test goes red, which the row it
 * replaces did not.
 */

import { expect, requireCredentials, test, trace } from '../fixtures';

const SOURCE = {
  sourceWorkbook: 'login-test-cases.xlsx',
  sourceWorksheet: 'DashBoard',
  module: 'DashBoard',
};

/** The heading shown before any tab is chosen. Asserted, not assumed. */
const DEFAULT_HEADING = /^\s*All Projects\s*$/i;

test.describe('DashBoard', () => {
  test('TC_DASHBOARD_001 - Check menus present in the dashboard page', async ({
    loginPage, workspacePage, bugasuraCredentials, page, step,
  }) => {
    await trace({
      ...SOURCE,
      testCaseId: 'TC_DASHBOARD_001',
      scenario: 'Check menus present in the dashboard page',
      priority: 'P0',
    });
    requireCredentials(bugasuraCredentials);

    // Step 1
    await step('Open the Bugasura login page', () => loginPage.open());

    // Steps 2-3
    await step('Enter a registered email and the correct password', async () => {
      await (await loginPage.emailField()).fill(bugasuraCredentials.email);
      await (await loginPage.passwordField()).fill(bugasuraCredentials.password);
    });
    await step('Click Sign In and navigate to dashboard', async () => {
      await (await loginPage.signInButton()).click();
      // Bugasura navigates itself to /apps. Calling goto() while that is in
      // flight aborts it, so this waits rather than driving.
      await page.waitForURL(/\/apps\b/, { timeout: 30_000 });
    });

    // Step 4 - "wait for 3 seconds", as a wait for the thing rather than the
    // clock: the tab strip being present is what the next step needs, and a
    // fixed sleep is either too short on a slow morning or wasted every run.
    await step('Wait for the projects dashboard to load', async () => {
      await expect(await workspacePage.dashboardTab('My Favourites'))
          .toBeVisible({ timeout: 30_000 });
    });

    // The state before the click, asserted rather than assumed. Without this
    // the test could pass on a dashboard that opened on My Favourites already,
    // proving nothing about the click - the exact failure this file replaces.
    await step('The dashboard opens on All Projects, not My Favourites', async () => {
      await expect(await workspacePage.sectionHeader()).toHaveText(DEFAULT_HEADING, { timeout: 15_000 });
      expect(await workspacePage.isTabActive('My Favourites'),
          'My Favourites is already the selected tab, so clicking it cannot be shown to do anything')
          .toBe(false);
    });

    // Step 5
    await step('Click My Favourites(0) menu option', async () => {
      await (await workspacePage.dashboardTab('My Favourites')).click();
    });

    // Step 6
    await step('Wait for the My Favourites tab to become active', async () => {
      await expect.poll(() => workspacePage.isTabActive('My Favourites'), { timeout: 15_000 })
          .toBe(true);
    });

    // Steps 7-8. Expected result: "Check My Favourites is displayed".
    await step('The header reads My Favourites', async () => {
      await expect(await workspacePage.sectionHeader(),
          'After selecting the My Favourites tab the section heading should name it. ' +
          'The tab label itself says "My Favourites" whether or not it is selected, so the ' +
          'heading is the only element that witnesses the click.')
          .toHaveText(/^\s*My Favourites\s*$/i, { timeout: 15_000 });
    });
  });
});
