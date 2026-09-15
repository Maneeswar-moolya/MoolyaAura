# Quarantine diagnostics — focused implementation report

2026-09-13. Scope: retained TC_SMOKE_021 diagnosis, recording/runtime screenshots, quarantine inspection and draft lifecycle, optional-route authoring. No complete framework regression or live-case promotion was performed.

## TC_SMOKE_021: measured diagnosis

Original application/environment: `ksp/stg`. Original run: `2026-09-13T09-12-10-285Z-a9v1e3`.

The retained metric says **Skipped**, with one collected test. It does not establish a locator failure. The original Playwright report and scratch diagnostics were deleted by the old verification cleanup. A separate replay of the retained spec, changing only its fixture import location, reproduced the credential guard skip. Its annotation says the application declares no credential-variable names. This is new diagnostic evidence, not a reconstructed historical report. See [the diagnosis](TC_SMOKE_021-DIAGNOSIS.md) and [the diagnostic replay report](ksp21-guard-replay/results.json).

| Requested item | Finding |
|---|---|
| 1. Failing recording step | No recorded step failed in the reproduced invocation: execution skipped before recorded actions. The historical skip annotation was not retained. |
| 2. Generated statement | `requireCredentials(appCredentials);` is the reproduced stopping statement. |
| 3. Source line | Line 15 of `ai/autocode/quarantine/ksp.TC_SMOKE_021.2026-09-13T09-12-14-284Z.spec.ts.txt`. |
| 4. Page | The saved action:1 context is `initialLandingPage`; it is not a failing runtime Page established by this skip. |
| 5. Page Object | `InitialLandingPage`, not `LoginButton`, is called by the retained generated spec. |
| 6. Method | `InitialLandingPage.logIn()`. |
| 7. Locator | `page.locator('header').getByRole('link', { name: 'Log In' })`. It matches the recorded locator and `LoginButton.logIn()`. |
| 8. Provenance | `USER_CONFIRMED`, `PAGE_OBJECT_METHOD`; source is annotated `USER AUTHORED — NOT VALIDATED`. No selection was changed. |
| 9. Exact runtime error | There was no locator exception in the reproduced skipped test. The new annotation is: `Application "ksp" declares no credentials in ai/projects/registry.json, so the authenticated part of this test case is skipped. Declare credential VARIABLE NAMES for its environment - the account of another application is never borrowed.` |
| 10. Match count/state | Not measured in the skipped invocation. The later live probe timed out waiting for the initial locator to become visible; it did not retain an explicit element-count measurement. |
| 11. Recording screenshot | Not captured by this historical recording. |
| 12. Runtime PRE_STEP image | Not retained for the original run. |
| 13. Runtime FAILURE image | Not retained for the original run. A separately timestamped live diagnostic screenshot exists; it is not historical evidence. |
| 14. Trace/video | Original trace, video and browser-console evidence are unavailable. |
| 15. Live staging result | The configured entry URL returned a Cloudflare block screen and HTTP 403 diagnostics. Initial login visibility timed out after 15 seconds. No credentials were entered. Authenticated replay remains blocked by configuration/access. |
| 16. Recording/runtime comparison | The initial recorded locator and both inspected manual implementations agree. The live browser did not reach the application's login UI, so SSO and dashboard DOM compatibility remain unverified. |
| 17. Classification | **CREDENTIAL_CONFIGURATION_FAILURE** for the reproduced retained-spec skip. The separate live diagnostic encountered **ENVIRONMENT_FAILURE**. There is no runtime evidence of an authentication-control locator failure. |
| 18. Framework change needed | Yes: retain the actual execution result and skip reason, distinguish credential configuration from locator/runtime failure, and retain diagnostics. No application-specific repair is justified. |
| 19. Mapping recommendation | No mapping change on this evidence. Configure the application's environment bindings/values and restore staging access, then complete diagnostic replay. |

The recorded/generated control comparison is:

| Implementation | Inspected locator/resolver | Runtime result |
|---|---|---|
| `InitialLandingPage.logIn()` in `tests-e2e/pages/ksp/InitialLandingPage.ts` | Header → link named Log In; explicit Page Object execution | Not executed by the skipped diagnostic spec; the separate blocked-page visibility probe timed out. |
| `LoginButton.logIn()` in `tests-e2e/pages/ksp/LoginButton.ts` | The same header link | Not called by the retained spec. No basis to replace the saved binding. |
| `SsoauthLoginPage.enterEmailField()` | BasePage resolver → textbox named Enter email | Not reached. Generated fills use `appCredentials.email`. |
| `SsoauthLoginPage.passwordField()` | BasePage resolver → textbox named Password | Not reached. Generated fills use `appCredentials.password`. |
| `SsoauthLoginPage.logInButton()` | BasePage resolver → button named Log In, exact | Not reached. |
| `UsEnHomePage.myDashboardState()` | BasePage resolver → heading named My Dashboard, exact | Final assertion not reached. |

The application-change, successful-authentication, redirect and final-dashboard hypotheses remain unverified. The smallest live-case action is **APPLICATION_CONFIGURATION_CHANGE**, followed by restored environment access and diagnostic replay. The user's last message said they would configure staging credentials; it did not confirm completion.

## Implemented framework behavior

| Requested item | Implementation |
|---|---|
| 20. Recording screenshots | `RecordingPictures` integrates with native recorder bindings. Perform-action hooks capture before/after; assertion hooks capture assertion state. Modern native clicks use a bounded masked pre-interaction buffer, explicitly labeled and timestamped. A focus image is eligible for fills only if it completed before input on that control. Input events are not cancelled or replayed. |
| 21. Runtime screenshots | Verification and quarantine executions enable masked PRE_STEP and FAILURE captures. The failed action still throws its original error. Captures are observational and do not grant locator proof. |
| 22. Correlation | Revision-bound recording action/assertion keys travel in structured generation comments. TypeScript parsing resolves generated source ranges; the runtime callsite selects the matching step. Imported symbols identify Page Object implementations and source. Image references carry the same structural step key. |
| 23. Manifest | Application/environment, test case, run/attempt, generated source, parsed steps, method source, captures, status, sanitized error/report references and trace availability are retained. Existing step/evidence structures are extended; no alternate reusable-knowledge database is introduced. |
| 24. Package | Exact executed spec; available pre-execution fixture/PO/BasePage snapshots; recording, owners, assertions and evidence; dependency graph; runtime JSON report, stdout/stderr, console errors, screenshots, sanitized trace, metadata and immutable revisions. Legacy import labels current supporting snapshots honestly. |
| 25. Workspace | Scoped quarantine search/list, selected case/step/file, actual retained reason, recorded/pre/failure viewer, zoom/fit/fullscreen, previous/next step, parsed method source, report/trace links, exact run inspection, resizable panes and responsive layout. Unsaved code survives screenshot navigation. |
| 26. Original/draft | Immutable original JSON and immutable revision files; an atomic state pointer identifies the editable draft. Page Object edits are staged with the quarantine rather than silently changing live application source. |
| 27. Diff | Original/current draft comparison highlights added/removed content for the selected spec or application Page Object. Historical executed revisions remain separately readable. |
| 28. Save Draft | Reuses Code Workspace parsing/formatting, TypeScript/static checks, ownership and applicable knowledge/locator contracts. Atomic revision/state commit rolls back on failure; invalid editor content remains unsaved. Shared framework files are read-only. |
| 29. Rerun | Validate the exact draft, copy its scoped dependencies into a private checkout, run the existing clean/assertion-mutation gate, retain fresh diagnostics and append a run revision. Failures remain quarantined. Parent/worker timeouts are bounded and child output is retained. |
| 30. Promotion | Saving never promotes. A clean pass plus a failing assertion mutation makes the exact revision/environment eligible. Explicit promotion refuses concurrent source changes and newer generated specs, then atomically restores the validated draft as Generated. It does not mark the case Automated. Only synthetic promotion was exercised. |
| 31. History | Original, edited revisions and failed/passed runs are retained. Selecting a prior run opens its evidence and corresponding code revision; Back/Forward use the existing parsed definition service. |
| 32. Optional route | Page name alone is accepted. Blank, shared and parameterized routes coexist. Route may be prefilled, edited or cleared; it remains context rather than identity. |
| 33. Authoring | Quarantine uses the same simplified Recording Review instance: Page → Page Object → Save Mapping, with method/execution details in Advanced. A saved mapping can be deterministically rebuilt into a private draft before validation/rerun. |
| 34. Reusable YAML | Explicit mapping uses the existing atomic YAML/append-safe Page Object/fixture/index architecture. Recording-specific ownership stays in its revision-bound sidecar. The saved mapping and private revision update together; reusable application knowledge remains discoverable to later flows. |
| 35. Security | Scope derives from immutable applicationId and selected environment. Artifact paths reject traversal/symlinks. Credential values and sensitive URL query/fragment data are redacted; inputs and known credential text are masked. Raw inline report attachments, native DOM/network trace bodies and unmasked video/screenshots are excluded. Credential fills still use scoped configuration. |
| 36. Focused/browser checks | All 22 checks in the focused selection passed, plus separate rerun and mapping-rebuild phases. Final native-recorder, runtime and browser rechecks passed; browser coverage includes fullscreen, keyboard pane resizing, dirty/error state, definitions, history, mapping and responsive wrapping. No complete framework sweep was run. |
| 37. Mutations | All **38** selected mutants were killed: 11 new quarantine diagnostics, 11 Recording Review mapping, 9 explicit authentication and 7 Code Workspace protections. |
| 38. TypeScript | **20 before, 20 after; zero introduced, zero removed.** The final compiler exits 2 because pre-existing errors remain. No new authoring/quarantine/diagnostic module has a diagnostic. Existing errors remain in changed `live-recorder.ts` and `server.ts`; the latter's inferred type display expanded, but its existing missing-`screenshotUrl` error did not change identity. |
| 39. Artifact integrity | Hash comparison covers 344 existing files, including 130 application artifacts. No application artifact changed or appeared. Intentional writes are framework/test code, this handoff/report and separate diagnostic artifacts. No real user binding, KSP YAML, PO, recording, workbook or generated test was rewritten. |
| 40. Limitations | Authenticated staging replay is incomplete. Historical screenshots/report/trace cannot be recovered. Fast first input, capture timeout, unsupported recorder hooks or ambiguous/coalesced recording streams may leave an explicitly unavailable image; buffered frames show their true capture time. Sanitized traces omit DOM/network bodies and video. Native trace-viewer launch is wired but its external viewer window was not automated in the browser fixture. Whole-framework and live-case acceptance are not claimed. |

## Validation evidence and self-review

- [Focused command results](quarantine-focused-results.json): 22/22, exit 0. Catalog/save/reuse/isolation use independent guarded phases.
- [Rerun lifecycle](quarantine-rerun-focused.log): exit 0; failed and passing runs, retained history, no automatic promotion, concurrent-source refusal and explicit synthetic promotion.
- [Mapping rebuild](quarantine-rebuild-focused.log): exit 0; route-less mapping saves, rebuilds and validates without publishing a generated spec.
- [Default authoring fixture entry](authoring-default-entry-final.log): exit 0 after isolating its four phases; the earlier shared-seed failures are resolved without a production mapping change.
- [Final native recording test](recording-pictures-final.log), [runtime test](runtime-pictures-final.log), [browser test](quarantine-browser-final.log): exit 0.
- [Quarantine mutations](quarantine-mutations.log), [mapping mutations](quarantine-mapping-mutations.log), [authentication mutations](quarantine-auth-mutations.log), [Code Workspace mutations](quarantine-code-mutations.log): all exit 0.
- [TypeScript comparison](quarantine-typescript-comparison.json), [before log](quarantine-typescript-before.log), [after log](quarantine-typescript-after.log).
- [Artifact hash audit](quarantine-artifact-integrity.json); [desktop](quarantine-ui/quarantine-desktop.png) and [responsive](quarantine-ui/quarantine-mobile.png) screenshots contain synthetic application data only.

Implementation followed AGENTS.md and the four governance contracts. The credential-guard defect was reproduced before correction. Native-recorder timing and promotion of an intentionally removed spec also received focused behavioral reproductions. No locator ranking, automatic target identity, authentication execution precedence, navigation causality, application isolation or provider behavior was relaxed. Screenshot observations never become deterministic knowledge.

Two test-harness issues were separated from production behavior: the old authoring fixture's default all-phase invocation shared conflicting seed state, while individual phases passed; its default entry now dispatches independently isolated phases. A new mutation initially failed at an earlier equivalent immutable-history assertion; ordering the immutable-original assertion first made the mutation runner's expected failure precise without removing either assertion.

The existing dashboard process was left running. The final application hash audit found no concurrent dashboard artifact changes during this task. No complete regression was authorized or run.

**DIAGNOSIS COMPLETE for the retained skip and its reproduced credential guard. QUARANTINE DIAGNOSTICS IMPLEMENTED with focused validation. AUTHENTICATED LIVE DIAGNOSIS INCOMPLETE. TC_SMOKE_021 STILL QUARANTINED.**
