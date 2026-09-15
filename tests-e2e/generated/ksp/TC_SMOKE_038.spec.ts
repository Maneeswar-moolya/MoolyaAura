/**
 * Assembled from a Playwright Codegen recording of TC_SMOKE_038.
 *
 * Recorded actions use explicit user bindings or automatically resolved controls.
 * Assembly opened no browser and used no model; it does not prove runtime validity.
 *
 * Authentication uses the application credential fixture; recorded credential
 * values are not emitted into this spec.
 *
 * The title is DERIVED, not authored: the workbook's Scenario cell says
 * the title contains a class or id token, so it cannot name this test stably. This title comes from the
 * semantic journey instead (action method + screen). The cell itself is unchanged.
 */

import { expect, requireCredentials, test, trace } from '../../ksp.fixtures';

test.describe('Test Cases', () => {
  test('TC_SMOKE_038 - Verify case details new on the My Support Cases page', async ({ page, appCredentials, step, initialLandingPage, mySupportCasesPage, ssoauthLoginPage, usEnHomePage }) => {
    requireCredentials(appCredentials);

    await trace({
      testCaseId: 'TC_SMOKE_038',
      module: '',
      scenario: 'Verify case details new on the My Support Cases page',
      sourceWorkbook: 'ksp-test-cases.xlsx',
      sourceWorksheet: 'Test Cases',
    });

    // @aura-step {"recordingStepKey":"action:0","label":"Open recorded destination","locator":"","provenance":"AUTO","executionMode":"AUTO"}
    await step('Open recorded destination', async () => {
      await page.goto('https://stgsupport.keysight.com/us/en/home');
    });

    // @aura-step {"recordingStepKey":"action:1","label":"Use Log In","page":"initialLandingPage","pageObject":"InitialLandingPage","method":"logIn","locator":"page.locator('header').getByRole('link', { name: 'Log In' })","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD","validationStatus":"USER AUTHORED — NOT VALIDATED"}
    await step('Use Log In', async () => {
      await (await initialLandingPage.logIn()).click();
    });

    // @aura-step {"recordingStepKey":"action:2","label":"Use Enter email","page":"ksp__ssoauth-login","pageObject":"SsoauthLoginPage","method":"enterEmailField","locator":"page.getByRole('textbox', { name: 'Enter email' })","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD"}
    await step('Use Enter email', async () => {
      await (await ssoauthLoginPage.enterEmailField()).click();
    });

    // @aura-step {"recordingStepKey":"action:3","label":"Enter account from configured credentials","page":"ksp__ssoauth-login","pageObject":"SsoauthLoginPage","method":"enterEmailField","locator":"page.getByRole('textbox', { name: 'Enter email' })","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD"}
    await step('Enter account from configured credentials', async () => {
      await (await ssoauthLoginPage.enterEmailField()).fill(appCredentials.email);
    });

    // @aura-step {"recordingStepKey":"action:4","label":"Enter password from configured credentials","page":"ksp__ssoauth-login","pageObject":"SsoauthLoginPage","method":"passwordField","locator":"page.getByRole('textbox', { name: 'Password' })","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD"}
    await step('Enter password from configured credentials', async () => {
      await (await ssoauthLoginPage.passwordField()).fill(appCredentials.password);
    });

    // @aura-step {"recordingStepKey":"action:5","label":"Use Log In","page":"ksp__ssoauth-login","pageObject":"SsoauthLoginPage","method":"logInButton","locator":"page.getByRole('button', { name: 'Log In' })","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD"}
    await step('Use Log In', async () => {
      await (await ssoauthLoginPage.logInButton()).click();
    });

    // @aura-step {"recordingStepKey":"action:8","label":"Click Product Help","page":"ksp__us-en-home","pageObject":"UsEnHomePage","method":"productHelpButton","locator":"page.getByRole('button', { name: 'Product Help' })","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD"}
    await step('Click Product Help', async () => {
      await (await usEnHomePage.productHelpButton()).click();
    });

    // @aura-step {"recordingStepKey":"action:9","label":"Click My Support Cases","page":"ksp__us-en-home","pageObject":"UsEnHomePage","method":"mySupportCaseUnderProductHelp","locator":"page.getByRole('menuitem', { name: 'My Support Cases' })","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD","validationStatus":"USER AUTHORED — NOT VALIDATED"}
    await step('Click My Support Cases', async () => {
      await (await usEnHomePage.mySupportCaseUnderProductHelp()).click();
    });

    // @aura-step {"recordingStepKey":"action:11","label":"Click msc-filters-btn","page":"ksp_my-support-cases","pageObject":"MySupportCasesPage","method":"filterButton","locator":"page.getByTestId('msc-filters-btn')","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD","validationStatus":"USER AUTHORED — NOT VALIDATED"}
    await step('Click msc-filters-btn', async () => {
      await (await mySupportCasesPage.filterButton()).click();
    });

    // @aura-step {"recordingStepKey":"action:12","label":"Click msc-filter-status-new","page":"ksp_my-support-cases","pageObject":"MySupportCasesPage","method":"filterStatusNew","locator":"page.getByTestId('msc-filter-status-new')","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD","validationStatus":"USER AUTHORED — NOT VALIDATED"}
    await step('Click msc-filter-status-new', async () => {
      await (await mySupportCasesPage.filterStatusNew()).click();
    });

    // @aura-step {"recordingStepKey":"action:13","label":"Click msc-filter-apply-btn","page":"ksp_my-support-cases","pageObject":"MySupportCasesPage","method":"filterApplyButton","locator":"page.getByTestId('msc-filter-apply-btn')","provenance":"USER_CONFIRMED","executionMode":"PAGE_OBJECT_METHOD","validationStatus":"USER AUTHORED — NOT VALIDATED"}
    await step('Click msc-filter-apply-btn', async () => {
      await (await mySupportCasesPage.filterApplyButton()).click();
    });

    // @aura-step {"recordingStepKey":"assertion:0","label":"#msc-case-details-section-content contains \"New\"","pageObject":"MySupportCasesPage","method":"caseDetailsNew","locator":"page.locator('#msc-case-details-section-content')"}
    await step('#msc-case-details-section-content contains "New"', async () => {
      await expect(await mySupportCasesPage.caseDetailsNew()).toContainText('New');
    });
  });
});
