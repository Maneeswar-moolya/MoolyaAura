# TC_SMOKE_021 — selected JSON profile diagnostic

Measured 2026-09-13, 14:37 UTC. **LIVE DIAGNOSIS BLOCKED — ENVIRONMENT ACCESS.**

The user explicitly selected `kspuserCommon`. The KSP/stg catalog resolved exactly that active profile, with stable ID `cred_6e7fe914-7889-4cac-9b98-4dbe1de759ed`. Scoped preflight returned HTTP 200: username available, password decryptable, profile active. The diagnostic process resolved the same coherent JSON profile through `appCredentials`; no credential environment variables or `.env` setup were required.

The diagnostic browser then navigated to the configured staging entry route, `/us/en/home`. The response was **HTTP 403**, and the returned page identified **Cloudflare**. The replay stopped immediately as requested. The initial Log In action, SSO email/password/submit controls and dashboard assertion were not reached or tested. Credential availability/decryption does not establish that the SSO service accepts the credentials; no SSO submission occurred.

| Finding | Measured result |
| --- | --- |
| Classification | `ENVIRONMENT_FAILURE` |
| Blocked operation | Diagnostic `page.goto(scope.baseUrl, { waitUntil: 'domcontentloaded' })` received Cloudflare 403. |
| Failing recorded/generated step | None executed in this diagnostic attempt; access failed before the first DOM action. This is not evidence of a generated statement or locator defect. |
| Locator counts/state | Not measured; the application screen was inaccessible. |
| Mapping and Page Objects | Preserved. No USER_CONFIRMED choice was replaced. |
| Screenshot | One masked `FAILURE` capture of the live access-denial screen, marked `LIVE_DIAGNOSTIC_ONLY`; it is not a historical recording screenshot. |
| Trace/video | Not captured by this diagnostic probe. |
| Credentials | Resolved only in runtime memory; no values printed or emitted into application artifacts. |
| Quarantine | TC_SMOKE_021 remains quarantined. No normal product rerun, acceptance or promotion occurred. |
| Next action | Restore authorized access to staging for the diagnostic browser, then repeat the same profile/mapping flow. No credential or mapping change is justified by this result. |

Evidence:

- [Safe diagnostic report](ksp21-live/2026-09-13T14-37-33-651Z/diagnostic.json).
- [Masked access-denial screenshot](ksp21-live/2026-09-13T14-37-33-651Z/aura-7330c841-752a-4f81-9c35-c72602bdb86a.png).
- [Application artifact comparison](ksp21-profile-integrity.json): **104 before, 104 after; no changes or additions** across the selected application artifacts, including encrypted Test Data, recordings, owners, evidence, Page Objects, knowledge, quarantine, mappings and workbook.

Only validation scripts, this report/handoff and the new diagnostic directory were written. No production implementation changed, no full regression ran, and no further live requests were attempted after the access denial. The diagnostic script exited 0 because it successfully captured and reported the blocked condition; that exit code is not a passing test result.
