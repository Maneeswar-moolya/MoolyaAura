# TC_SMOKE_021 retained-run diagnosis

Application `ksp`, environment `stg`, original run `2026-09-13T09-12-10-285Z-a9v1e3`.

## Established before implementation

The retained generation metric reports `cleanStatus: Skipped`, one collected test and no mutation run. It does not report a failed locator action. The original JSON report, stdout/stderr, step screenshots and trace were not retained: `verify.runOne` removed its temporary directory. The quarantine contains the generated source that was executed.

The generated test's first statement is `requireCredentials(appCredentials);` (line 15). A separate diagnostic copy of that exact spec, with only its fixture import relocated, was skipped by this guard. Playwright's new skip annotation says this application's environment declares no credential variable names. The current scoped configuration confirms that absence. This replay is new diagnostic evidence, not a reconstructed original report.

**Classification: CREDENTIAL_CONFIGURATION_FAILURE.** No recorded action, locator, visibility check or business assertion ran in the skipped invocation. A historical failing recording step, locator count and element state therefore cannot be claimed. The smallest application action is **APPLICATION_CONFIGURATION_CHANGE**. A **GENERALIZED_FRAMEWORK_FIX** is also needed because the verification gate misclassifies skipped tests and discards their diagnostic reason.

The saved action:1 selection is logical Page `initialLandingPage`, Page Object `InitialLandingPage`, method `logIn`, mode `PAGE_OBJECT_METHOD`, provenance `USER_CONFIRMED`. The source is `tests-e2e/pages/ksp/InitialLandingPage.ts`, annotated `USER AUTHORED — NOT VALIDATED`. Its locator is `page.locator('header').getByRole('link', { name: 'Log In' })`, identical to the recording and to `LoginButton.logIn()`. **LoginButton is not the Page Object called by this quarantined spec.** No mapping was changed.

The generated calls after the credential guard use `initialLandingPage.logIn()`, `ssoauthLoginPage.enterEmailField()` for click and configured email fill, `ssoauthLoginPage.passwordField()` for configured password fill, `ssoauthLoginPage.logInButton()`, and `usEnHomePage.myDashboardState()` for the final text assertion. The SSO methods resolve the recorded textbox/button roles through BasePage; the final method resolves the My Dashboard heading. Those implementations were inspected, not assumed to have failed.

## Live diagnostic replay

The scoped staging entry URL returned a Cloudflare block screen (“Sorry, you have been blocked”). The initial login control did not become visible within 15 seconds. Screenshot and sanitized diagnostic metadata are retained under `docs/validation/ksp21-live/2026-09-13T09-38-19-890Z/`. No credentials were entered. This is an independent **ENVIRONMENT_FAILURE** in the new diagnostic session and does not explain the original skipped result.

The user is configuring staging credentials through the existing settings. Authenticated replay still requires that configuration and successful access to staging from the browser process. There is no evidence yet that the application changed, any of the Page Objects is wrong, navigation failed, or the assertion failed. No user mapping change is recommended on the present evidence.

Original recording screenshots, runtime PRE_STEP/FAILURE screenshots, trace, video and browser-console evidence are unavailable. They must not be fabricated. The diagnostic replay's new screenshot is clearly separated from historical evidence. The case remains quarantined and has not been promoted.
