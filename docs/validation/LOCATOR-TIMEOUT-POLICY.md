# Universal runtime locator deadline — validation

Measured 2026-09-13. The generalized **40-second runtime UI policy is implemented and focused validation passes**. The headed TC_SMOKE_021 diagnostic passes with its original locator. Whole-framework acceptance and live quarantine eligibility are not claimed.

## Live TC_SMOKE_021 result

Application `ksp`, environment `stg`, saved profile `kspuserCommon`, bundled Chromium **152.0.7977.8**, **headed**, Playwright **1.63.0-alpha-2026-08-05**. Scoped preflight confirmed active profile and available/decryptable credential fields; values stayed in runtime memory. The configured entry page returned **HTTP 200**, title **Support Home**, without Cloudflare denial.

| Recorded key | Existing executed method | Result | Resolution time | Full operation |
| --- | --- | --- | --- | --- |
| `action:1` | `InitialLandingPage.logIn()` | One visible/enabled match; click passed | 1 ms | 3,837 ms |
| `action:2` | `SsoauthLoginPage.enterEmailField()` | One visible/enabled match; click passed | 1,173 ms | 1,913 ms |
| `action:3` | `SsoauthLoginPage.enterEmailField()` | Scoped account fill passed | 4 ms | 23 ms |
| `action:4`, control inspection | `SsoauthLoginPage.passwordField()` | One visible/enabled match | 3 ms | 10 ms |
| `action:4`, fill | `SsoauthLoginPage.passwordField()` | Scoped secret fill passed | 3 ms | 23 ms |
| `action:5` | `SsoauthLoginPage.logInButton()` | One visible/enabled match; click passed | 3 ms | 1,145 ms |
| Consequences of `action:5` | Browser-managed redirects | Returned through SAML endpoints to `/us/en/home`; no transient navigation command replayed | Not a locator operation | See sanitized navigation events |
| `assertion:0` | `UsEnHomePage.myDashboardState()` | One visible/enabled match; **assertion passed** | **5,273 ms** | **5,630 ms** |

The exact locator remains:

```ts
getByRole('heading', { name: 'My Dashboard', exact: true })
```

The exact retained statement, line 50 of `ai/autocode/quarantine/ksp.TC_SMOKE_021.2026-09-13T09-12-14-284Z.spec.ts.txt`, remains:

```ts
await expect(await usEnHomePage.myDashboardState()).toContainText('My Dashboard');
```

The target appeared after the former four-second resolver window and passed inside the new shared budget. Together with the previous loading-overlay failure, this establishes the previous failure as a **synchronization/readiness timeout**, not grounds to rewrite the heading locator or initial USER_CONFIRMED binding.

Evidence: [sanitized live diagnostic](ksp21-headed/2026-09-13T16-12-33-707Z/diagnostic.json), [dashboard after the passing assertion](ksp21-headed/2026-09-13T16-12-33-707Z/aura-bcb27e93-72fd-4ad1-a6e4-b1cff4c3382f.png). Eight masked PRE_STEP images and one POST_STEP image exist. Two initially unavailable transition captures were recovered before the action/assertion and explicitly labeled `BEFORE_ACTION_AFTER_RESOLUTION`; the redirect observation capture remained unavailable. No FAILURE capture was needed. Native trace/video was not captured under the existing profile credential-protection policy. Runtime AI was **not invoked**.

**Live quarantine rerun and live assertion mutation were not attempted.** The previously proven generalized browser-mode propagation defect is unchanged: Quarantine's request/service/verifier do not pass Headed mode. No headless substitute was used. No eligibility or promotion state was changed. The separate synthetic Quarantine tests below do not constitute validation of the live case.

Browser compatibility remains: headed bundled Chromium is supported; headed installed Chrome was supported in the earlier comparison; current headless shell was blocked by Cloudflare in that comparison. Chrome channel is not mandatory. No stealth/bypass behavior was added.

## Implementation contract

- `tests-e2e/support/locator-policy.ts` owns the single production constant `LOCATOR_TIMEOUT_MS = 40_000`, monotonic deadlines, public locator/action adapters, the framework `expect` adapter, and observed readiness diagnostics.
- `BasePage` installs the policy on its page. The shared application fixture also installs it, covering explicit manual methods and generated recorded-locator execution without changing any application source. Existing application fixtures re-export the shared `expect` and `step` implementations.
- `runStep` starts one async-local deadline for its UI body. Resolution, declared fallback candidates, readiness rechecks, locator actions and framework assertions consume its remaining budget. A standalone resolved locator carries its deadline into its next action/assertion. A later explicit framework step starts a fresh deadline; it does not inherit an expired prior step.
- Zero-match candidates are rechecked in their existing declared order until a candidate qualifies or the common deadline expires. An available candidate returns immediately. No candidate gets a fresh 40 seconds. Multiple matches remain ambiguous; no first/last/nth selection is introduced. Explicit collection resolution remains separate.
- Click, fill, select, check/radio, press, hover, other locator actions, and legacy selector-based Page actions receive bounded timeout arguments. Spent budgets throw rather than passing Playwright's unlimited `timeout: 0`. Explicit shorter caller observation windows remain permitted and cannot extend the global maximum.
- `playwright.excel.config.ts` uses the same constant for default action and assertion waits. Existing total test limits are extended by one finite UI budget for each recorded step so earlier work does not consume a later step's entire allowance. Independent process/overall execution limits still exist.
- Generic data-driven form field/submit resolvers reuse the shared runtime resolver while preserving their existing candidate expressions, visible filtering and order. Its positive UI waits use the common default; negative observation windows remain deliberately shorter. Its existing fixed polling sleeps now use bounded deadline rechecks.
- There is no `waitForTimeout(40000)`, unconditional 40-second delay, per-application timeout branch, ranking change or target-identity relaxation. The 100 ms recheck cadence samples availability inside the deadline; it is not a pre-action sleep.
- Shared-budget assertions use the framework fixture's `expect` export. Custom code should use these framework fixtures/exports; a separate third-party runner does not acquire MoolyaAura's operation context merely by importing Playwright. The unrelated upstream MCP suite/config remains separate.

## Readiness and diagnostics

Visible `aria-busy=true`, an incomplete document or an observed pending main-frame navigation support `PAGE_READINESS_TIMEOUT`. A complete document with an explicit root `aria-busy=false` and zero target matches supports `LOCATOR_NOT_FOUND_AFTER_READY`. Where application readiness is not established, `LOCATOR_TIMEOUT_READINESS_UNKNOWN` preserves that uncertainty. A completed DOM alone does not prove an unmarked application-specific loading overlay has disappeared; no CSS-class/name guess is used to manufacture readiness.

Ambiguity remains `LOCATOR_AMBIGUOUS`; actionability timeouts retain their original error with `UI_OPERATION_TIMEOUT` where no more specific readiness finding exists. Assertion mismatch is never converted into success.

Runtime step records retain the configured maximum, elapsed time, candidates/locator, final count, sanitized route, readiness signals and classification alongside their existing test/run identity, source/recording-step mapping, Page Object/method, captures and error. Parsed source manifests are cached per source/manifest revision, including for normal execution without a prebuilt verifier manifest. Quarantine retention records the same maximum in its manifest and retains the step records and trace reference when available.

The UI execution budget is 40 seconds. Best-effort screenshots and a bounded final read-only readiness observation can add small diagnostic overhead after failure; they do not grant additional UI action or assertion time. Queries without a native timeout argument are raced against the common deadline and have no mutation side effects.

## Validation results

All listed passing commands exited **0**. The pre-change reproduction exited **1**, demonstrating that a synthetic target available after five seconds was rejected by the former resolver. Tests use guarded OS temporary checkouts with the independent deletion guard; no real application fixture data is copied or mutated.

| Check | Result |
| --- | --- |
| `ai/autocode/locator-timeout.fixture.ts` | **21 contracts passed**: immediate, 300 ms, 5/7/31/35 seconds, missing targets at 40 seconds, three fallbacks sharing the deadline, declared order, ambiguity, readiness/unknown state, resolution + action total, explicit auth/manual execution, oversized/zero timeouts and exhausted budget. Delayed cases use an injected clock. |
| `ai/autocode/locator-timeout-browser.fixture.ts` | **7 browser contracts passed**: real hydration, Page Object/manual/recorded controls, remaining assertion/action budgets, select/check/radio/press/hover, generic form candidates and negative/attribute matcher behavior. |
| `ai/autocode/locator-cardinality.fixture.ts` | Passed existing cardinality, no positional narrowing, declared fallback, collection, reuse and static generation safety checks. One source-presence check was adapted to the bounded count-call wrapper; behavioral protections remain. |
| `ai/diagnostics/runtime-pictures.fixture.ts` | Passed actual clean-failure execution, timeout metadata/count/readiness, exact source/step correlation, PRE_STEP/FAILURE captures, retained error and sanitized trace. |
| `ai/dashboard/quarantine-workspace.fixture.ts --phase=rerun` | Passed actual isolated failed/passed reruns, shared timeout retention, clean/assertion-mutation eligibility contract, history and no automatic promotion. |
| `ai/autocode/user-confirmed-auth.fixture.ts` | Passed explicit method/recorded-locator precedence, Auto evidence requirements, foreign binding rejection, secret handling and navigation separation. |
| `ai/dashboard/navigation-causality.fixture.ts` | Passed browser causality and event/frame/URL privacy checks. |
| `ai/diagnostics/security.fixture.ts` | Passed manifest/trace redaction and application path containment. |
| `ai/testing/locator-timeout-mutations.ts` | **8/8 killed**: old ceiling, reset deadline, lost resolution budget, manual execution ignoring the active budget, ambiguity accepted, busy classification lost, query leak, and spent budget sent as a Playwright action. |
| Headed TC_SMOKE_021 diagnostic | **Passed**, unchanged saved profile/mapping/locator, no runtime AI. |
| TypeScript | **20 before / 20 after**; zero new or removed diagnostic identities; zero changed-module diagnostics. One existing `server.ts` TS2339 `screenshotUrl` error displays an expanded StepRecord type containing new metadata. Repository typecheck still exits **1**, not green. |

[TypeScript comparison](locator-timeout-type-comparison.json), [before diagnostics](locator-timeout-types-before.txt), [after diagnostics](locator-timeout-types-after.txt).

No complete framework regression was run; it was not authorized.

## Artifact integrity and scope

[Application artifact comparison](locator-timeout-integrity.json): **189 before / 189 after, zero changed, zero added** across the measured application artifacts for the implementation and focused validation. The live replay's independent snapshot compared **160 before / 160 after, zero changed, zero added**. No concurrent dashboard artifact changes were detected in these intervals. The four concurrent changes documented in the earlier headed failure belong to that earlier interval, not this one.

Intentional writes are generalized framework runtime/diagnostic support, focused tests/mutations, the validation helper, new diagnostic captures/reports and the handoff. KSP recordings, sidecars, Page Objects, YAML, credentials, Test Data, generated/quarantined source and workbook were preserved. No accepted spec was regenerated. Application isolation, USER_CONFIRMED precedence, logical Page/optional route behavior, navigation causality, locator ranking and AI boundaries were not changed.

Remaining: propagate approved browser mode through the generalized Quarantine rerun path in a separately authorized task, then perform the normal live clean/assertion-mutation validation before claiming eligibility. Native profile trace retention still requires the existing credential-safe retention work. Focused success is not a whole-framework READY claim.
