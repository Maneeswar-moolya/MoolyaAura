# Secure JSON Test Data and execution profiles

Date: 2026-09-13. Scope: focused implementation and validation; no full framework regression or live acceptance claim.

Latest live follow-up: the user selected `kspuserCommon`; KSP/stg JSON credential preflight passed. Staging then returned Cloudflare HTTP 403 before the initial login action. The replay stopped as **LIVE DIAGNOSIS BLOCKED — ENVIRONMENT ACCESS**, with all selected application artifacts unchanged. See [the measured profile diagnosis](TC_SMOKE_021-JSON-PROFILE-DIAGNOSIS.md). The earlier profile-pending observations below describe the state at implementation closure.

The dashboard now manages reusable application users and typed data in JSON. A logical case is executed with a selected data row and environment; its automation source is shared by those execution instances. New profiles do not require a `.env` file or credential environment variables.

## Product and architecture coverage

| Area | Implemented behavior |
| --- | --- |
| 1. Storage | `ai/test-data/<applicationId>/test-data.json`, rooted through the existing artifact/scope layer. Application stores remain ignored by Git; framework TypeScript modules in `ai/test-data/` remain source files. Existing workbook-derived caches and Page YAML keep their separate responsibilities. |
| 2. Schema | `schemaVersion: 1`, immutable `applicationId`, revision, credential profiles, data profiles, case tags/Example rows and safe audit events. Read/write validation rejects unsupported versions, malformed references and unsafe data keys. |
| 3. Encryption | Windows DPAPI `CurrentUser`, with application/profile/environment context as entropy. JSON contains username and encrypted `secretPayload`; reusable passwords are not plaintext. The PowerShell bridge receives values through anonymous pipes, not argv, files or environment variables. No key is hardcoded or put in `.env`. Unsupported hosts fail closed. |
| 4. Credential UI | Searchable cards; role/environment/status filters; tags; create, edit, duplicate, activate/deactivate and guarded deletion. Passwords are masked, require explicit reveal, and are never fetched to populate an edit field. An unchanged password preserves its encrypted payload. |
| 5. Data UI | Structured key/value rows support strings, numbers, booleans, null and controlled nested JSON; Advanced shows JSON. Profiles can be edited and reused. Credential/prototype keys are reserved. |
| 6. Examples UI | Case-specific rows select credential and data profiles, tags, typed overrides and enabled status. Edit, duplicate, remove and enable/disable persist through the same store service. |
| 7. Execution selection | Searchable profile/data selectors, environment compatibility metadata, create-profile-from-selector, preview counts, saved Examples and explicit matrix mode. A new profile is selected immediately after its validated save. Saving selections as Examples is a separate explicit action. |
| 8. Stable IDs | UUID-based `cred_`, `data_` and `row_` identifiers. Renaming retains identity; references never depend on the display name. |
| 9. Isolation | Registered immutable application scope controls reads, writes, preflight, runtime selection, dependency access and reruns. Foreign profile IDs are rejected; matching names/usernames/routes do not confer ownership. |
| 10. Roles/tags | Credential roles and tags, data tags, Example tags and existing workbook/case tags combine for filtering. The existing filter module supports `@tag`, `and`, `or`, `not` and parentheses. Ranking never selects a user. |
| 11. Scenario Outline behavior | Each enabled selected row creates an independent instance. Multiple users with one data profile are supported; multiple data profiles require explicit matrix expansion or explicit rows. Preview and execution cap the selection at 100 instances. |
| 12. Generated code | Authentication continues to use `appCredentials.email/password`. Explicit authored `<data:fieldName>` values generate `String(testData.fieldName)`. Changing saved values does not require source duplication or regeneration. No field is inferred from a locator name. |
| 13. Credentials fixture | An explicit JSON profile resolves a coherent username/password pair in runtime memory, before the existing application credential path. Invalid explicit profiles fail clearly instead of falling back or mixing sources. |
| 14. Data fixture | `testData` combines a selected data profile and row overrides. Missing requested fields produce `DATA_CONFIGURATION_FAILURE`. `executionProfile` exposes safe IDs/name snapshots, role, tags, environment and row metadata. |
| 15. Results | Case/row/profile/data/environment identifiers accompany each child run and attempt. Serialized child executions use independent Playwright contexts. One profile's failure does not remove the spec or overwrite another profile's result. Workbook write-back is refused for profile instances. |
| 16. Quarantine | A failed execution instance receives its own diagnostics/package. Rerun can use the original or a different profile and creates a new attempt. Original metadata remains immutable; a passing clean run plus assertion mutation permits eligibility, not automatic promotion. |
| 17. Secret API | GET/save responses return safe profile metadata and per-environment availability flags, never usernames, passwords or encrypted payloads. Password input is sent only for an explicit change. JSON parsing errors do not echo request contents. |
| 18. Restart | Catalogs reconstruct from validated JSON; saved Examples and IDs survive reload and a fresh process. No separate in-memory-only catalog is authoritative. |
| 19. Concurrent writes | Whole-file version hash plus an exclusive lock, validated temporary file, flush, atomic rename and readback. Stale writes fail with a reload/merge message. Failed commits preserve the previous JSON. |
| 20. Compatibility | Existing scoped credential-variable configurations still resolve when no explicit profile is selected. No new `.env` file or credential-variable requirement was introduced. Non-authentication flows can run without an explicit user profile. |
| 21. TC_SMOKE_021 | The secure dashboard is available at `http://localhost`. The user has been asked to save and identify a KSP/stg profile through the UI. At the last safe catalog check, no profile was saved. Authenticated replay was not attempted; the current mapping was not changed and the case was not promoted. |

DPAPI's account-bound protection is documented by [Microsoft's ProtectedData reference](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata). The actual Windows implementation was exercised with synthetic secrets; no production password was supplied to the agent.

## Recording, diagnostics and retained behavior

The simplified Page/Page Object authoring model, optional route context, USER_CONFIRMED method/recorded-locator precedence, target identity, locator ranking and navigation causality were preserved. No application-specific Page Object, YAML, recording or binding was edited for this implementation.

Profile execution registers decrypted values only in process memory for credential use and redaction. Framework screenshots mask input controls and rendered credential values. Safe runtime manifests/results carry profile metadata, not account values. A dedicated reporter sanitizes errors/annotations and retains masked framework screenshots. Native Playwright HTML/Allure output, raw traces, native screenshots and video are disabled for JSON-profile runs because those channels can persist credential fill arguments. This is an explicit retention limitation; raw trace availability is not claimed.

Quarantine execution initially exposed missing scenario/source-environment metadata in the new profile package path. Packages now retain those existing execution facts, so rerun resolves the original scenario and configured source environment without inventing an application or weakening navigation rules. The private rerun checkout copies only the encrypted Test Data store; decryption remains under the same Windows account. Application store directories remain excluded from the Code Workspace dependency graph; required framework Test Data modules are explicit read-only shared dependencies.

## Credential form correction reported during validation

The user reported missing Save/Cancel buttons. A new browser assertion reproduced the problem: the action row was below the visible form at 1280 × 720. Test Data dialogs now have a scrollable field area and a separate persistent footer containing Save, Cancel, error and dirty status. Desktop and 390 × 640 checks prove the buttons are visible and clickable without scrolling. Removing/re-adding an environment works, and structural edits participate in unsaved-change protection. Users must refresh the dashboard to load the updated assets; the service was not restarted for this CSS/JavaScript correction.

## 22. Focused results

### HTTP hostname follow-up

The subsequent Add Credential Profile report exposed a separate production defect: `crypto.randomUUID()` was used to build form/list IDs and Example IDs. Chromium supplies that API on localhost but not on the dashboard's plain-HTTP hostname. The previous localhost tests therefore missed a supported deployment context.

Both an actual HTTP-hostname synthetic reproduction and a read-only probe of the running `http://moolyaautomationreport.com` dashboard produced `crypto.randomUUID is not a function`; the form did not open. DOM identifiers now use a page-local sequence. New Example rows leave their ID empty for the existing scoped backend to assign a stable UUID, including the explicit save-selections-as-Examples path. Encryption, profile identity, scope and storage contracts are unchanged.

The actual dashboard probe after the change reported the dialog, Save Profile and Cancel visible, with no page error while `crypto.randomUUID` remained unavailable. No credentials were entered or read by this probe. The HTTP-hostname fixture passed create/edit/save, selectors, nested profile creation, Example creation/removal and backend stable-ID validation (exit 0). Logs: `test-data-hostname-before.log`, `test-data-hostname-after.log`, and `test-data-hostname-live-before/after.log`. One additional mutation reintroducing the UUID dependency was killed at the intended form-opening assertion (exit 0, `test-data-hostname-mutation.log`).

This follow-up's TypeScript comparison remained 20 before/20 after, both exit 2, with no new or removed diagnostics. Its hash comparison found only the intended UI, browser fixture, mutation and REMAINING changes, with no added or modified application files (`test-data-hostname-comparison.json`). No full regression, credential write or live test execution was run for this correction.

All 14 selected focused fixture invocations passed with exit code 0. The recorded selection is in `test-data-focused-results.json`; it is not a complete regression sweep.

| Checks | Result |
| --- | --- |
| Test Data store, initial browser/runtime and screenshot security | Passed |
| Explicit USER_CONFIRMED authentication | Passed |
| Recording Mapping, authoring browser and Code Workspace | Passed |
| Quarantine package, editing, rerun and optional-route phases | Passed |
| Secret redaction, application execution isolation and legacy environment execution | Passed |

Subsequent focused checks exercised the final additions:

- `test-data-final-store.log`: encrypted persistence, readback/reload, atomic failure, revision conflict, stable IDs, coherent explicit/legacy precedence, typed data, tags and application isolation; exit 0.
- `test-data-final-browser.log`: one unchanged spec, three actual isolated profile executions, one pass and two independent quarantine failures; saved two-row Examples unchanged. Rerun with another profile passed clean and assertion-mutation validation, retained original history and did not promote; exit 0.
- `test-data-modal-before.log`: expected red result demonstrating unreachable Cancel at desktop height; exit 1.
- `test-data-modal-after.log`: both footer buttons reachable at desktop/narrow sizes; exit 0.
- `test-data-final-ui.log`: final form saves, secure edit, environment remove/restore, dirty state, Example reload and create-from-execution selection; exit 0.

Synthetic artifact-writing fixtures run inside guarded OS temporary checkouts. The independent deletion guard refuses the real repository. Browser startup/request failures retain child output. Synthetic observations are not published as live locator evidence.

## 23. Mutations

All **20 new Test Data mutants** and **nine existing explicit-authentication mutants** were killed. The initial group covered 17 new mutants; separate follow-ups killed the three protecting accidental persistence of run overrides, browser storage inheritance and decrypted credentials in quarantine manifests. The latest supplemental run passed the first two but the third stopped with `fetch failed`, so that attempt was not counted. Adding child-output diagnostics to the fixture and rerunning that mutant produced the intended quarantine-secret assertion failure and exit 0 (`test-data-mutant-19-followup.log`). The earlier connection failure remains recorded; its cause was not established and no production behavior was changed to make it pass.

The contracts cover plaintext password persistence, password API exposure, cross-application access, ID changes on rename, collapsed Example executions, stale updates, inactive users, referenced deletion, atomic corruption, missing row overrides, implicit matrices, foreign runtime selection, misclassified missing data, diagnostic/screenshot leaks and generated username/password literals. Mutations run against temporary source copies and must fail the intended behavioral assertion; compilation/import failures are rejected as invalid results.

## 24. TypeScript

Before: **20 diagnostics**, exit **2**. After: **20 diagnostics**, exit **2**. New: **0**. Removed: **0**. No changed/new module introduced additional diagnostics. Existing diagnostics in changed modules remain existing issues; the repository is not TypeScript-green.

Evidence: `test-data-typescript-before.json`, `test-data-typescript-after.json` and `test-data-comparison.json`. Counts are actual `tsc --noEmit --pretty false` runs, not inferred from transpilation or a build.

## 25. Artifact integrity and concurrent activity

The before/after hash audit found **no modified pre-existing application artifacts**. Intentional framework changes are listed in `test-data-comparison.json`. Validation logs, audit output and synthetic UI screenshots under this validation directory are intentional diagnostic artifacts. The temporary `test-data.fixture.pending` baseline entry was the task's own fixture staging file, later replaced by its `.ts` implementation.

Nine new application files were detected separately: original/state/revision files for three legacy quarantine imports, at 14:09:44–14:09:56 UTC:

- TC_SMOKE_022: package `1dc7dbc4-be89-4ef8-a632-9528d15a0412`.
- TC_SMOKE_021: package `9589da11-81d3-4a6a-8c83-ecaaafde9e64`.
- TC_SMOKE_020: package `bd52f8dc-b382-4570-a58d-af7363ab39f1`.

These contain legacy-import metadata with no execution run ID, consistent with concurrent dashboard quarantine inspection through the existing import path. They were not produced by synthetic fixtures and were preserved. The audit therefore does not claim an entirely unchanged application directory. No authenticated live run, profile creation, mapping change or promotion was performed by the agent.

## 26. Limits and next action

- A real profile must be saved and identified by the user before KSP/stg authenticated diagnosis. No environment-variable configuration is requested. A measured Cloudflare 403 will be reported as environment access failure, not a credential or locator defect.
- Windows CurrentUser DPAPI binds stored passwords to that OS account. A portable encrypted backup or non-Windows provider is not implemented; no plaintext fallback exists.
- Native traces/HTML/Allure/video are unavailable for JSON-profile executions until a credential-safe retention path is validated. Safe JSON, structural runtime diagnostics and masked screenshots remain available.
- Explicit data tokens or authored `testData` expressions bind business fields; data-field intent is not guessed from recording values. Profile catalogs use bounded local search; secure full-credential export is not implemented.
- Profile execution deliberately disables workbook result write-back. Results are retained per execution instance. Whole-framework regression was not requested or run.

Status: **FOCUSED IMPLEMENTATION VALIDATED; LIVE PROFILE/DIAGNOSIS PENDING; NO LIVE PROMOTION.**
