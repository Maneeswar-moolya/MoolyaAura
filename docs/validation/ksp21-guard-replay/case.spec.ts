/**
 * Assembled from a Playwright Codegen recording of TC_SMOKE_021.
 *
 * Recorded actions use explicit user bindings or automatically resolved controls.
 * Assembly opened no browser and used no model; it does not prove runtime validity.
 *
 * Authentication uses the application credential fixture; recorded credential
 * values are not emitted into this spec.
 */

import { expect, requireCredentials, test, trace } from "C:/Users/Maneeswar/ClientProjects/MoolyaAura/MoolyaAura/tests-e2e/ksp.fixtures";

test.describe('Test Cases', () => {
  test('TC_SMOKE_021 - Log In â€” dashboard-heading contains "My Dashboard"', async ({ page, appCredentials, step, initialLandingPage, ssoauthLoginPage, usEnHomePage }) => {
    requireCredentials(appCredentials);

    await trace({
      testCaseId: 'TC_SMOKE_021',
      module: '',
      scenario: 'Log In â€” dashboard-heading contains "My Dashboard"',
      sourceWorkbook: 'ksp-test-cases.xlsx',
      sourceWorksheet: 'Test Cases',
    });

    await step('Open recorded destination', async () => {
      await page.goto('https://stgsupport.keysight.com/us/en/home');
    });

    await step('Use Log In', async () => {
      await (await initialLandingPage.logIn()).click();
    });

    await step('Use Enter email', async () => {
      await (await ssoauthLoginPage.enterEmailField()).click();
    });

    await step('Enter account from configured credentials', async () => {
      await (await ssoauthLoginPage.enterEmailField()).fill(appCredentials.email);
    });

    await step('Enter password from configured credentials', async () => {
      await (await ssoauthLoginPage.passwordField()).fill(appCredentials.password);
    });

    await step('Use Log In', async () => {
      await (await ssoauthLoginPage.logInButton()).click();
    });

    await step('dashboard-heading contains "My Dashboard"', async () => {
      await expect(await usEnHomePage.myDashboardState()).toContainText('My Dashboard');
    });
  });
});
