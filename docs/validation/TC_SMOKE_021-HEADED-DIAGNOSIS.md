# TC_SMOKE_021 — headed authenticated diagnostic

Measured 2026-09-13, 15:35–15:36 UTC. **LIVE DIAGNOSIS FAILED — LOCATOR_FAILURE.**

The scoped `kspuserCommon` profile resolved and decrypted successfully for `ksp` / `stg`. The replay used bundled Chromium **152.0.7977.8**, headed, with a fresh isolated browser context and Playwright **1.63.0-alpha-2026-08-05**. No existing browser profile, cookies, stealth options, credential environment variables or mapping changes were used.

The configured entry page returned **HTTP 200**, title **Support Home**, with no Cloudflare block. The initial Log In click, SSO email click/fill, password resolution/fill and authentication Log In click all succeeded. Browser-managed redirects returned to the application. The dashboard Page Object then failed to resolve its heading while the application still displayed its loading overlay. Successful credential submission and redirects do not by themselves prove the final authenticated dashboard state.

## Steps and retained captures

Every DOM control below matched **one**, was **visible**, and was **enabled** before its successful action, except the dashboard heading, which matched **zero** at failure. Redirects are browser consequences, not replayed navigation commands; their locator count/state are not applicable.

| Stage / recording key | Page Object / method | Exact locator / resolver | Result | Sanitized route | PRE_STEP |
| --- | --- | --- | --- | --- | --- |
| A / `action:1` | `InitialLandingPage.logIn()` | `page.locator('header').getByRole('link', { name: 'Log In' })` | Click succeeded | `/us/en/home` → `/ssoauth/login` | Retained |
| B / `action:2` | `SsoauthLoginPage.enterEmailField()` | `resolve('ssoauthlogin.enterEmailField')` → `getByRole('textbox', { name: 'Enter email' })` | Click succeeded | `/ssoauth/login` | Unavailable during navigation |
| C / `action:3` | `SsoauthLoginPage.enterEmailField()` | Same email resolver | Scoped account fill succeeded | `/ssoauth/login` | Retained |
| D / `action:4` | `SsoauthLoginPage.passwordField()` | `resolve('ssoauthlogin.passwordField')` → `getByRole('textbox', { name: 'Password' })` | Control resolved | `/ssoauth/login` | Retained |
| E / `action:4` | `SsoauthLoginPage.passwordField()` | Same password resolver | Scoped secret fill succeeded | `/ssoauth/login` | Retained |
| F / `action:5` | `SsoauthLoginPage.logInButton()` | `resolve('ssoauthlogin.logInButton')` → `getByRole('button', { name: 'Log In', exact: true })` | Click succeeded | `/ssoauth/login` → identity-provider session | Retained |
| G / cause `action:5`; recorded consequences `action:6`–`action:9` | Browser-managed redirects | No navigation command injected | Returned to application origin; redirect chain continued | `/saml/authn-request.jsp` → `/secur/frontdoor.jsp` → `/us/en/home` | Unavailable during navigation |
| H / `assertion:0` | `UsEnHomePage.myDashboardState()` | `resolve('usenhome.myDashboardState')` → `getByRole('heading', { name: 'My Dashboard', exact: true })` | Resolution failed: count 0, visible/enabled false | `/us/en/home` | Unavailable during navigation; **FAILURE retained** |

The selected initial binding remains Page `initialLandingPage`, Page Object `InitialLandingPage`, method `logIn`, execution `PAGE_OBJECT_METHOD`, provenance `USER_CONFIRMED`, validation `USER AUTHORED — NOT VALIDATED`. Nothing promoted this diagnostic observation into deterministic knowledge.

## Exact failure and limits

Retained generated source: `ai/autocode/quarantine/ksp.TC_SMOKE_021.2026-09-13T09-12-14-284Z.spec.ts.txt`, **line 50**:

```ts
await expect(await usEnHomePage.myDashboardState()).toContainText('My Dashboard');
```

The inner Page Object call threw before `toContainText` could run:

```text
Could not resolve "usenhome.myDashboardState" on https://stgsupport.keysight.com/us/en/home to exactly one element.
Tried 1 strateg(ies):
  - getByRole('heading', { name: 'My Dashboard', exact: true }) - nothing attached
This is a genuine locator failure - add a candidate strategy that identifies the element, or the element is gone. A strategy that matched several elements is NOT narrowed with first(): that would pick an element nobody chose.
```

The resolver has a 4,000 ms candidate attachment wait. The diagnostic's redirect observation returned at the intermediate application-origin SAML endpoint, then invoked the unchanged Page Object. The final home navigation was observed at 15:36:10.900 UTC. The failure screenshot at 15:36:11.453 UTC shows a loading overlay. This supports a readiness/timing problem at the assertion's locator-resolution boundary; it does **not** prove the heading is stale, that credentials were rejected, or that a longer wait would pass. No alternate locator or binding was substituted, no assertion was healed, and no retry was used to relabel this attempt as passing.

The raw diagnostic initially categorized the failure by assertion phase (`ASSERTION_FAILURE`). The reviewed classification is **LOCATOR_FAILURE**, because the Page Object threw before the matcher ran. The original diagnostic is retained unchanged. The validation helper now distinguishes resolver failure from matcher failure for any future authorized run; that helper-only correction was syntax-checked, not rerun live.

## Quarantine gate and browser compatibility

**Validate draft, clean Quarantine rerun and assertion mutation were not run.** The diagnostic failed, so the user's success prerequisite was not met. Independently, the normal Quarantine flow cannot currently propagate Headed:

- `ai/dashboard/public/quarantine-workspace.js` sends the execution-data selection without browser mode.
- `ai/dashboard/server.ts:1136` forwards scope, package, workbook and execution data only.
- `ai/dashboard/quarantine-workspace.ts:240` has no browser-mode argument and invokes the verifier without one.
- `ai/autocode/verify.ts:655` starts Playwright without `--headed`; `playwright.excel.config.ts` has no headed override.

This is a generalized execution-configuration defect. No product source was changed, no headless substitute rerun was launched, and TC_SMOKE_021 remains quarantined without new validation eligibility or promotion.

Measured compatibility from the preceding navigation-only comparison, corroborated here for headed bundled Chromium:

| Configuration | KSP/stg access |
| --- | --- |
| Bundled Chromium, headed | Supported; HTTP 200 again in this authenticated diagnostic |
| Installed Chrome channel, headed | Supported in the preceding comparison; not rerun here |
| Current bundled Chromium headless shell | Cloudflare HTTP 403 in the preceding comparison; not rerun here |

Chrome channel is not mandatory. No bypass is proposed. The next authorized framework work should address browser-mode propagation and independently test the redirect/readiness boundary; this diagnostic does not justify replacing the user's mapping.

## Evidence, security and integrity

- [Sanitized diagnostic and structural screenshot references](ksp21-headed/2026-09-13T15-35-44-026Z/diagnostic.json) retain step keys, exact generated statements/lines, method/locator, counts/states, sanitized routes, navigation observations, safe errors and stack.
- [Dashboard failure screenshot](ksp21-headed/2026-09-13T15-35-44-026Z/aura-568d13e2-136f-475e-af52-b63a835ce7d0.png).
- Six masked PRE_STEP images, including initial navigation, and one masked FAILURE image were retained. Three PRE_STEP attempts were unavailable during transitions under the existing best-effort capture helper. No historical screenshots were fabricated.
- No raw trace/video was captured: the current profile-execution architecture disables these because credential action arguments can enter native traces. Screenshot masks and in-memory credential redaction were used. Credential values and SSO query strings were not logged or stored in this diagnostic metadata.
- Runtime AI was **not invoked**. The diagnostic used existing deterministic Page Object methods directly.
- Application hashes: **141 files before and after; four changed, zero added**. All four changed at approximately **15:36:09 UTC** during separate dashboard authoring activity: `ai/dashboard/recordings/ksp/.draft-af451806ff3ed8c0c269f22082bb201efdb80cbf5f2edb1718c9b7b323888e4e.owners.json`, `ai/knowledge/page/ksp/.authoring-validation.json`, `ai/knowledge/page/ksp/ksp__us-en-home.yaml`, and `tests-e2e/pages/ksp/LandingPage.ts`. The diagnostic helper contains no writes to these locations and performed no dashboard mutation requests. Those external changes were preserved.
- TC_SMOKE_021's saved recording/owners/evidence, encrypted Test Data/profile, executed Page Objects, quarantined source and quarantine state were unchanged in this comparison. See [before hashes](ksp21-headed/2026-09-13T15-35-44-026Z/before-hashes.json) and [after hashes](ksp21-headed/2026-09-13T15-35-44-026Z/after-hashes.json).

Only the new validation helper, diagnostic artifacts, this report and the scoped handoff were intentionally written. The authenticated diagnostic exited **1**. No complete regression, production fix, second live attempt or promotion was performed.
