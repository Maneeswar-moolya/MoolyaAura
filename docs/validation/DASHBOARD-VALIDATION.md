# Dashboard and environment execution validation — 2026-09-12

The modern dashboard, project environment settings, serialized environment execution and step-linked report inspector are implemented. The production registry remains empty. All browser data shown here belongs to isolated synthetic applications, not installed client applications.

## Working features — proven from repository and tests

- Collapsible sidebar, active navigation, breadcrumbs, persistent project selection, explicit source-environment selection, responsive workspace, project-settings drawer and keyboard controls. Existing workbook, authoring, recording, generation and execution paths remain in place.
- Add/edit environment IDs, display names, base URLs and supported credential **variable-name references** in Project Settings. Environment IDs are immutable; ownership, URL and reference validation runs on the server. Values are supplied externally, never through these configuration fields.
- One saved case runs across selected environments in the existing serialized execution path with one worker. Parent executions retain independent child results, logs, configuration snapshots and artifacts. Invalid/missing declared configuration is rejected before any child starts. Multi-environment workbook write-back is refused.
- Explicit application/environment/run/case/attempt/step associations retain screenshots across retries and subsequent environments. Capture timing is accurately recorded as after-step or after-failure. Historical missing fields are not invented.
- Inspector with ordered steps, status/duration/error details, environment/case/attempt selection, immediate stale-image clearing, abort/token protection, previous/next controls, fit/zoom/fullscreen, keyboard-resizable divider and mobile stacking. Native Playwright reports follow the selected environment.
- Project switches clear old evidence, run choices and result caches. Foreign project/environment artifact requests are refused. Retained report assets use project-scoped routes; unowned scratch directories are no longer served as public artifact URLs.

## Necessary API/data changes

- Dashboard API version **9**; restart an older dashboard process before using the new page.
- `POST /api/projects/:applicationId/environments` adds an environment; `PUT /api/projects/:applicationId/environments/:environmentId` edits it. Bodies declare the same application owner. Registry schema remains version 1; environment `displayName` is optional for older entries.
- `POST /api/run` accepts `environmentId` as the explicit source and `environmentIds` as execution targets, alongside the existing workbook/case/browser/capture options. The grouped response exposes `environmentRuns`; child records carry their environment and parent ID.
- Run detail/evidence requests supply `applicationId`; an optional requested environment must match the retained child. Native reports use `/api/projects/:applicationId/runs/:runId/report/` so relative assets keep ownership.
- Step logs now retain actual attempt identity and unique step IDs. Screenshot associations are written during execution, not reconstructed from file ordering. The workbook-report reader uses the last actual attempt rather than merging retries.
- Source environment is passed through authoring, recording and generation requests. Workbook runner scans and activation surveys accept the already-resolved request scope. No locator ranking, fingerprint algorithm, Page Object lifecycle policy, knowledge policy or AI provider was replaced.

## Root causes resolved

The old step log/file naming overwrote retry evidence, and the dashboard had no grouped environment execution or explicit environment-settings API. Startup also raced project loading. A correctly scoped two-project workbook request still reached ambient-scope runner scanning, and saving a case reached the same problem in the activation survey. Both failed with “No applicationId was supplied…” despite a declared request owner. The fix threads that owner through existing accessors; it does not pin a shared server to one application.

## Validation results

- Focused UI/API checks passed for empty onboarding, first/second projects, settings, same-case QA/Staging execution, separate credentials, retry/step screenshot hashes, foreign requests, delayed image responses, missing files, capture disabled, failed steps, native reports, project switching, keyboard controls and responsive layout.
- Affected existing focused fixtures passed, including workspace accordion, project API, generation/execution isolation, provisioning, application pipeline, knowledge/history and locator validation.
- Five environment/ownership/scope mutations were killed in the final mutation batch: foreign artifact ownership; source-to-target URL binding; retry artifact collisions; omitted runner scope; omitted activation-survey scope.
- **Exactly one full regression: 81/82 fixtures, 870.69 seconds.** The only failure was `ai/dashboard/recorder.fixture.ts`: **54/55 checks**, specifically `no global !important visibility rule was introduced`. All other full-run fixtures passed, including the new UI/execution tests, locator benchmark and workspace accordion.
- This was a stale blanket CSS restriction. The new shell uses native `[hidden]` semantics; the recording notes still use their existing `.show` rules. After the full run, only tests were adjusted: remove the blanket ban, exercise the real review renderer in Chromium, and mutate authentication-note visibility. Follow-up: **recorder 54/54**, dashboard browser checks exit 0, and the sixth visibility mutant killed. No production change followed the full run.
- **The full result remains 81/82. It has not been relabeled 82/82. No second full sweep was run.** A fresh all-green full baseline after the test-only correction remains unverified.
- The first combined mutation harness hit its aggregate watchdog after two kills. Each mutation now receives an independent bounded isolation lifecycle; the subsequent five-mutation batch and sixth targeted mutation passed. The timeout is not counted as a successful mutation result.

Machine-readable evidence: [full summary](dashboard-full-regression.json), [all fixture results](dashboard-full-regression-results.json), [focused recorder follow-up](dashboard-recorder-followup.json), [mutation results](dashboard-mutations.txt).

## Integrity and boundaries

All 277 measured repository files and directory structure were unchanged during the full sweep. Registry: `{"schemaVersion":1,"applications":[]}`. Generation state: `{}`. No real application artifacts were created. The follow-up tests also left the repository unchanged. Only the three documented test/harness files changed after the full sweep, before this documentation update. Locator/evidence ranking, Page Objects, knowledge artifacts, production workbooks and application stores were preserved. No dependency files, Git history, commits or pushes were changed; no old applications were restored.

Runtime AI was not invoked. GitHub Copilot and a provider abstraction remain **not implemented**. The installed runtime provider remains the existing Claude CLI path. No Keysight application, URLs or credentials were added.

## External configuration and unverified boundaries

Register a project with its approved permanent ID, display name, first environment ID and actual base URL. Use Project Settings for additional environments and email/password environment-variable references (plus the supported base-URL override reference). Supply secret values in the process environment, ignored local environment configuration or CI secret store. Network access, browser installation and approved test accounts/cases remain external setup.

Actual Keysight authentication is unverified; the existing generation sign-in selectors were not redesigned. SSO, MFA, cross-origin authentication redirects and client-host/browser compatibility need real configuration and separate validation. Environment URL binding is exercised through the shared framework/base fixtures; custom specs that bypass them are not covered by this proof. Cross-browser execution was not exercised here. There is no installed TypeScript compiler/typecheck; validation used the actual TSX, Playwright and offline fixture paths.

## Actual UI screenshots

- [Before: empty dashboard](dashboard-before-empty.png)
- [After: empty onboarding workspace](dashboard-after-empty.png)
- [After: test-case workspace](dashboard-after-workspace.png)
- [After: desktop step inspector](dashboard-after-report.png)
- [After: mobile step inspector](dashboard-after-mobile.png)

The report screenshots show an intentionally failed first attempt of a synthetic case that passes on retry. They are actual captured browser output, not generated or mocked screenshots.
