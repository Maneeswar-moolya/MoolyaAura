# MoolyaAura Current Engineering State

**Observed: 2026-09-12.** Every number here is a measurement taken on that date against the
working tree at `C:\Users\Maneeswar\ClientProjects\MoolyaAura\MoolyaAura`, branch `develop`.

## Latest state: execution step evidence and the run report, 2026-09-15

**TRACED ON THE REAL ATTEMPT, THEN FIXED GENERALLY.** A successful execution showed its whole
step list and, for every step, "No screenshot captured" and "Capture timing not recorded",
with Evidence "-" and no Download Report. Read read-only on TC_SMOKE_037 attempt
`71373da6`: **eight screenshots were physically on disk**.

Three controls disagreed. The Playwright config forces native capture off for a selection run;
`server.ts` *also* forced `EXCEL_SCREENSHOT=off` for it; and `steps.ts` took a `PRE_STEP`
picture unconditionally, ignoring that control, while the after-step picture ran only when the
mode was `on`. So the settings said no pictures, pictures were taken anyway, and a passing step
never got the one it needed.

**The first layer where evidence disappeared is the execution API.** `collectSteps` published
only the legacy single `screenshotUrl`, derived from a path the forced-off mode never set; the
per-step `captures[]` were passed through untouched and their files were never copied into the
run. Two further defects made them unusable anyway: a capture named its artifact relative to
the *test's* output directory while retention keeps it one level down, and `manifest.steps[]`
carried no status, duration or captures at all.

One capture policy now, and it is the control the dashboard already offers: `off` means off
(previously ignored here); `only-on-failure` keeps the failing step's `PRE_STEP` and `FAILURE`
and discards a passing step's frame - the reading `runtime-pictures.fixture.ts` already
contracted, kept rather than overruled; `on` keeps `PRE_STEP` + `POST_STEP` per step. **A
selection-driven run now turns the framework channel ON**, while native screenshot, video and
trace stay off there - a credential decision, since those are unmasked and cannot cross the
retention boundary while the framework's masked captures can. Artifacts are recorded relative
to the output root, each capture is copied to
`runs/<id>/evidence/steps/<case>/<attempt>/<step>/<captureRef>.png` and served at its own URL,
so no step can be served another's and there is no global latest screenshot. Manifest steps are
joined to what happened by `recordingStepKey`. Capture timing is derived from the picture taken,
and where none could be taken the **reason** is recorded and shown.

**Download Report root cause:** `hasReport = executionSelection ? false : keepPlaywrightReport()`.
The artifact was never produced for a selection run, so the control correctly hid something that
did not exist; the route, the flag and the link were all already wired.
`ai/dashboard/run-report.ts` now writes the run's own self-contained report - inline CSS, no
scripts, no network, screenshots embedded - for every completed run, served by the existing
route, with Playwright's kept copy reachable at `/report/playwright/`. Every string is redacted
then escaped, the credential profile appears by **name**, and a report-scoped local-path
redaction was added because `diagnosticText` does not cover a user's home directory and the
report is the artifact that leaves the machine.

65 assertions offline, 31 through the real server and a real browser, **16 mutants killed**.
TypeScript **20 before → 19 after**: the diagnostic that disappeared is the pre-existing
`server.ts` TS2339 for `screenshotUrl`, removed by declaring the per-step capture model; no new
diagnostic appeared. **Zero application artifacts written.**

**Not claimed:** the one focused live validation run against TC_SMOKE_037 - it needs the
dashboard restarted and is a live authenticated run against a customer environment. Two
requested mutants target `collectSteps`, which the browser fixture bypasses by seeding at the
API storage boundary; the fixture that does exercise it exceeds the harness's own 300 s cap in
this environment after passing its server block, and is byte-identical to its pre-session copy.
The existing TC_SMOKE_037 attempt was **not** rewritten and cannot show step evidence: its
captures carry the old bare-filename references and the files they were copied from were wiped
by later runs. See [execution step evidence](../docs/validation/EXECUTION-STEP-EVIDENCE.md) and
status_version **71** in [REMAINING.md](../docs/history/REMAINING.md).

## Latest state: recorded statements, not recorded lines, 2026-09-15

**REPRODUCED THEN FIXED STRUCTURALLY.** `parseRecording` read the generated script a line at a
time, and `splitCall` required a whole `await <receiver>.<method>(<args>);` on one of them.
Codegen makes no such promise: it wraps a call as soon as its arguments grow, and every wrapped
call was then **dropped** - not mislabelled, absent. Reproduced across every wrapping Codegen
produces: a wrapped chain, `filter`, `fill`, `press`, `selectOption`, `dblclick`, `check`,
`hover`, a wrapped `expect(...)` and a wrapped `page.goto(...)` with its navigation marker were
all lost. The reported click was one instance of a broader defect.

One complete TypeScript statement is now one candidate recorded action. `ts.createSourceFile`
finds each `ExpressionStatement` wrapping an `AwaitExpression`, sorted by source position so
recording order is stated rather than assumed, and the outermost call is decomposed from the
tree rather than from a regex. `flattenExpression` normalises the receiver and argument text to
the single-line spelling - including removing the spaces a wrapped chain leaves around `.`, so
it still matches `^page\.` - while copying string literals verbatim, so no recorded value is
reformatted. Every downstream helper receives exactly what it received before. `rawActions` is
derived from the source using `countRecordedActions`' own definition, so the picker's position
space and the parser's cannot drift.

**Measured over the whole saved corpus**: 37 recordings, **22 byte-identical**, **15 changed,
each recovering exactly one action** - always the same wrapped `click({ modifiers: ['Alt'] })`
on the password field. TC_SMOKE_037 10 → 11, TC_SMOKE_038 14 → 15, TC_SMOKE_039 12 → 13, and in
all three the source's `await`-statement count now equals the parsed action count exactly. Read
only; no source file was modified, and nothing was reconstructed from screenshots, navigation or
evidence.

**The consequence was handled rather than discovered later.** Recovering an action renumbers
every step after it, and an ownership sidecar is keyed by `action:<n>`, so a binding saved at
`action:5` would quietly re-attach to a different control. `AuthoringOwners` now carries
`revision` - the step stream the choices were made against, where `recordingHash` only says
which script this is - and `loadOwners` refuses when both sides know their stream and differ.
Additive: an older sidecar reads as **unknown**, never as still-current. **Thirteen existing
sidecars predate the field and now describe a different stream** (TC_SMOKE_013, 015, 017, 021,
023, 027, 029, 030, 031, 035, 037, 038, 039). They were not modified and not re-keyed - two
steps in these recordings share a locator, so re-keying would be guessing. Re-review their
bindings before generating from them again.

Screenshot attribution is restored by the **action**, not by loosening the rule: ten
observations with ten actions pair into ten distinct step keys; ten with nine still attribute
nothing. 93 assertions in `ai/dashboard/recording-statements.fixture.ts`; **11 of 11 mutants
killed**. TypeScript **20 before / 20 after, identical identities**. **Zero application
artifacts written.**

**Not claimed:** no full regression, and no live Recording Review observation - the dashboard
still runs the pre-change server, and the pending recording that reported `10 observed /
9 recorded` is gone, so that one cannot be re-measured. The affected recordings do **not** need
re-recording; the source always contained the action. Separate follow-up, deliberately not
broadened: `page.locator('//div[1]')` still evades the XPath check. See
[multi-line statement parsing](../docs/validation/MULTILINE-STATEMENT-PARSING.md) and
status_version **70** in [REMAINING.md](../docs/history/REMAINING.md).

## Latest state: authoring locator refusal names its rule, 2026-09-15

**TRACED AGAINST THE LIVE DASHBOARD, not inferred from the message.** Save Mapping refused a
step with "Enter a supported Playwright locator expression beginning with page" on a locator
that visibly began with `page.`. Read read-only from the running server, the submitted
expression is
`page.locator('div').filter({ hasText: 'Close1closeSELECTED ASSETS' }).nth(1)`. Run against
the real validator, the prefix condition is **false** and the condition that fires is
`forbiddenMechanisms` returning `nth() - chosen by position, and nobody chose a position`.
`validateAuthoringLocator` had collapsed five independent rules into one sentence about the
prefix, so the screen told a person to fix the only thing that was already correct. `.filter()`
is supported - the identical chain without `.nth(1)` is accepted - and the expression is
neither malformed nor mis-quoted.

**Nothing was relaxed.** `.nth()` is still refused in authoring, which carries no measurement.
The locator contract's one positional exception stays in `validateCandidate` on
`effectiveLocator().positionProven`, and a contract proves a browser-measured index is still
admitted there while an unmeasured one is not. What changed is the answer: a category and an
actionable sentence, carried into the review as `ReviewStep.locatorSafety` by the same function
the save uses, so the reason appears beside the locator and Save is disabled rather than a
transaction being spent on a refusal already known. The browser decides only *when* the verdict
applies - an established capability runs its own declared locator and is not judged on the
recorded chain - and never re-states the rule. `RECORDED_LOCATOR` was already validated; that
was verified rather than changed.

No safe locator exists for that step and none was invented: `evidence: missing`, `route: null`,
`documentId: null` - the recorder captured nothing for that element. The step stays
`USER_BINDING_INCOMPLETE` and the choice belongs to a person.

50 assertions in `ai/dashboard/authoring-locator-safety.fixture.ts`; **8 of 8 mutants killed**.
TypeScript **20 before / 20 after, identical identities**. **No application artifact was written
by this work.** Restart the dashboard: the running process predates the change, and a browser
refresh alone degrades safely to the previous behaviour rather than showing the new reasons.

**Separate finding, reported and not fixed.** The `10 observed / 9 recorded` action mismatch
behind "17 screenshots captured" is a real user action missing from the recording.
`parseRecording` reads the codegen script line by line, so a click codegen wrote as a multi-line
call is dropped by `splitCall`. Proven on the saved `TC_SMOKE_038`: the source contains the
Password click, the parsed actions do not, and the index sequence matches that recording's
persisted review keys exactly. The screenshots are the symptom; the dropped click is the defect,
and it is the same family as the navigating-click loss corrected earlier the same day. See
[authoring locator refusal](../docs/validation/AUTHORING-LOCATOR-REFUSAL.md) and status_version
**69** in [REMAINING.md](../docs/history/REMAINING.md).

## Latest state: live recorder action loss corrected, 2026-09-15

**REPRODUCED IN A BROWSER, THEN FIXED.** A user click that causes a document navigation was
not reaching Playwright's recorder at all. `recordingPictureHook` wrapped
`__pw_recorderRecordAction` and awaited an out-of-process screenshot before delegating to it.
`playwright-core` does not consume an ordinary click, so the browser dispatches it natively
and records it afterwards; for a navigating click the document was already being torn down,
the awaited binding never returned, and the original was never called. Playwright then wrote
`await page.goto(...)` for a navigation nothing caused - **the consequence standing in place
of its cause**, which is the one substitution the navigation model must never make.

Measured both ways on one synthetic scenario (Page A -> Continue -> Page B -> Open Cases ->
Page C, plus one action that stays put): with the hook uninstalled all three clicks recorded;
with it installed the two navigating ones were replaced by `goto` lines. After the fix the
recorded script is identical to the un-hooked one.

A second, independent divergence was measured in the same run. The assertion picker's overlay
records as `page.locator('ba-aura-assert').click()` and is dropped by `parseRecording`; the
picture layer did not drop it. Pairing pictures to steps is all-or-nothing by design, so
either divergence discards **every** action picture while the assertion picture - kept in its
own list with its own length check - survives alone. That is the reported symptom: one
`ASSERTION_STATE`, "No recording screenshot was captured for this step" on every action, and
twelve screenshots from that session sitting on disk the whole time.

The rule now enforced: **observation must never sit between a user action and the recorder's
record of it.** After dispatch the recorder is told first and the picture is reported without
being waited for; before dispatch, where nothing is navigating and a true before-action
picture is the only one obtainable, the wait is kept. `isRecorderOwnAction` is injected into
the picture layer rather than restated, so the two streams cannot drift apart. Observation
work is chained in arrival order and `settle(page)` is a protocol round-trip barrier - the
pattern `NavigationJournal.settle` already uses - not a delay. Where the streams genuinely
cannot be paired, `CaptureAttribution` records `paired` plus four counts, travels on the
evidence and reaches Recording Review, which no longer calls unattributed screenshots
uncaptured. The all-or-nothing pairing rule itself is unchanged.

24 assertions in six groups in `ai/diagnostics/recording-navigation.fixture.ts` through the real
`_enableRecorder`, the real hook, a closed-shadow picker overlay and a picked assertion; **5
of 5 mutants killed**. TypeScript **20 before / 20 after, identical identities**, measured
against a pre-change copy of the tree. **Zero application artifacts written.** One harness
correction, labelled as such: `recording-pictures.fixture.ts` settles reports before pairing
them, because it had assumed a wait a navigating click could not afford.

**Not claimed:** no full framework regression (focused checks only, as instructed), no live
recording against a real application, no credential used, no historical recording rewritten
and no action reconstructed from a navigation. **A recording made before this fix must be
re-recorded** - the clicks were never recorded, so there is nothing to repair - and the
dashboard must be restarted first; a process started before 2026-09-15 15:00 local runs the
old code. See [recording action loss](../docs/validation/RECORDING-ACTION-LOSS.md) and
status_version **68** in [REMAINING.md](../docs/history/REMAINING.md).

## Latest state: execution context propagation verified, 2026-09-14

**VERIFIED FROM THE REPOSITORY, not from the previous handoff.** Two defects were carried
forward as open: the source environment missing from the Playwright clean-run process
(which stopped TC_SMOKE_026 before its first UI action), and Headed mode not reaching a
quarantine rerun. Both were already implemented in the working tree. The tree changed after
the 17:09 UTC failure that `ai/autocode/state.json` still records for TC_SMOKE_024/025/026,
and no handoff was written for it — so `REMAINING.md` status_version 61 and the sections
below still described the defects as open. Re-measurement, not restatement, settled it.

One typed `ExecutionContext` — application, target and source environment, credential/data/row
selection, browser engine, channel, Headed mode and the locator timeout — is resolved once per
entry point and carried as `AURA_EXECUTION_CONTEXT` through the dashboard, the autocode CLI,
orchestration, the falsification gate, `excel run` and the quarantine rerun.
`playwright.excel.config.ts` reads the same context for `headless` and the channel. A missing,
unselected or foreign source environment is refused as `SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE`
before any child process or browser starts. `ksp` declares two environments and no
`defaultSourceEnvironmentId`, so a source must be chosen explicitly — that is correct
fail-closed behaviour, not a defect.

Re-measured green: 18 execution-context checks; 3 real UI → HTTP → autocode CLI →
orchestration → gate → Playwright-child contracts with no mocked transport, where the child
navigates the target origin and never the source; quarantine `--phase=rerun` and
`--phase=package`; the quarantine browser fixture. **One untested link was found and closed**:
nothing checked what the quarantine workspace *sends*, which is exactly the shape the original
defect had — a rerun that dropped Headed looks correct from the server, because the server
faithfully propagates the headless it was handed. A new browser check captures the rerun
request and requires the approved Headed mode, source environment, engine and owning
`applicationId`; two new mutants faulting `ai/dashboard/public/quarantine-workspace.js` make it
red. **Ten of ten execution-context mutants killed on the settled tree.** TypeScript: 20 before
/ 20 after, identical diagnostic identities, repository typecheck still exits 1. Application
artifacts: **209 before / 209 after, zero changed, added or removed**; TC_SMOKE_026's quarantine
record, recording, mapping and USER_CONFIRMED bindings are untouched.

No production file was changed by this session; the additions are one browser check and two
mutants. **Not claimed:** any live re-run of TC_SMOKE_026, any live quarantine rerun or
assertion mutation, any promotion, and any whole-framework regression. A dashboard process
started before 2026-09-13 22:55 local still runs the pre-correction code and must be restarted.
Runtime AI was not invoked; Copilot remains not implemented. See
[execution context validation](../docs/validation/EXECUTION-CONTEXT-PROPAGATION.md) and
status_version **62** in [REMAINING.md](../docs/history/REMAINING.md).

## Latest state: navigation causality correction, 2026-09-13

**PROVEN:** a scripted fragment redirect reproduced the recorder's exact-URL correlation
failure. Main-frame request/loader and browser-initiator capture now reconcile after a protocol
drain, support refresh/form/history navigation, preserve fragment document identity and refuse
conflicting visits. New source markers retain only safe cause/reason/ID metadata. Navigation
review labels are accurate. LF formatting is restored; the old semantic-candidates failure
passes focused validation. First correction: 19 mutants killed and 84/84 full regression
passed (989.89 seconds). Live TC_SMOKE_007 nevertheless exposed remaining ambiguity using
that corrected recorder. A follow-up synthetic/browser reproduction proved same-URL history
rewrite competing for a document cause; event kinds are now separated and safe counts retained.
Follow-up: nine navigation mutants killed, full regression 84/84 (1029.38 seconds).
Concurrent TC_SMOKE_009 still blocked (4 document, 2 history, 1 unknown). A browser fixture
then reproduced the explicit initial request contaminating a proven return to the same URL.
The journal now binds the actual entry command to its first matching non-redirect request;
only that visit is consumed as entry. Later visits retain independent causality requirements.
Focused checks pass and all twelve navigation mutants killed (301.03 seconds); Entry-correction broad regression stopped as premature: 43/84 completed results recorded, 43 passed. This is an incomplete run, not a final regression. Use focused ownership/reuse tests and verify TC_SMOKE_011 before one final settled-tree sweep. TC_SMOKE_011 now passes navigation, but generation
blocks on duplicate authentication capabilities in SsoauthLoginPage and UsEnHomePage.
Read-only mapping proves all three controls have identity evidence; a measured-route-only
in-memory lookup resolves them correctly. No production ownership correction or application
artifact repair has been applied. Header Log In link is also incorrectly reused as form button
by name despite missing evidence. These are remaining ownership/reuse blockers, not reasons
to weaken navigation or target identity. Live generation success is not claimed.

TC_SMOKE_005's five PO actions map, including the heading, but its old unknown navigation marker
cannot safely be repaired. Its exact historical cause is not proven. Load the latest correction and
capture using live Chromium; restarting alone did not resolve TC_SMOKE_007. No application files were edited, and no
runtime AI was invoked. Copilot remains not implemented. See
[navigation validation](../docs/validation/NAVIGATION-CAUSALITY-VALIDATION.md).

## Latest state: recorded-flow foundations, 2026-09-12

**PROVEN FROM REPOSITORY:** generalized authentication uses scoped, identity-proven Page
Object controls without a fixed class/method name. Navigation causality is captured for new
recordings; unknown legacy events and unsafe destinations block generation. Proven heading
assertions bootstrap scoped Page Objects, including owners whose classes do not yet exist.
Lifecycle diagnostics exclude navigation and retain composite authentication's underlying
controls. Deterministic mapping failures preserve recording/evidence and do not invoke the
generic AI generator. Locator ranking and same-document identity rules are unchanged.

**Actual TC_SMOKE_002 retry:** run `2026-09-12T17-56-34-402Z-mgixhq` created
`UsEnHomePage.myDashboardState()` deterministically, reused four element actions, and refused
zero elements. It blocked on six legacy navigation events without causality. No accepted spec,
execution or runtime AI call occurred. Re-recording is needed to establish navigation intent,
not to replace the valid heading evidence. KSP is already registered in the current working
tree; older empty-registry statements below describe earlier snapshots.

**Validation (completed 2026-09-13 local):** focused checks passed; all 11 source mutations
were killed. Exactly one final full sweep passed **83/84 in 1817.51 seconds**. The sole
failure is `semantic-candidates.fixture.ts:442`: its LF-only source regex fails against CRLF
introduced when editing live-recorder.ts. The assertion-pick call and ranking behavior are
unchanged; in-memory newline normalization makes that source check match. This remains an
open test/formatting blocker; no second sweep or post-sweep code correction was performed.
Framework files, registry and original TC_SMOKE_002 inputs stayed unchanged during the sweep.
Concurrent dashboard activity added TC_SMOKE_003/004 recordings/generations and changed the
workbook/data state/logs; those changes were preserved. The whole application tree is therefore
not byte-identical to the pre-sweep snapshot. See [validation record](../docs/validation/RECORDED-FLOW-VALIDATION.md).
Copilot remains **not implemented**. No credentials or authentication behavior were invented.

## Latest state: dashboard and environment execution, 2026-09-12

**PROVEN FROM REPOSITORY:** the existing vanilla dashboard now has a collapsible navigation
shell, responsive workspace, project/source selectors, an environment-settings drawer and a
step-linked screenshot inspector. Environments are validated and persisted through scoped
APIs. One saved case executes serially across selected environments with separate parent/child,
case, attempt and step records. Native Playwright reports remain available per environment.
Source selection reaches recording/generation; missing request scope in workbook scanning and
activation surveys was reproduced and corrected with explicit scope parameters. Locator
ranking, Page Object/knowledge policies, auth selectors and runtime AI provider behavior were
not redesigned. API version is now **9**; restart older dashboard processes.

**Validation:** one complete full regression passed **81/82 in 870.69 seconds**. The sole
failure was the recorder fixture's blanket ban on global `[hidden]` CSS: 54/55 checks. All
other fixtures passed, including the new browser/execution tests, locator benchmark, workspace
accordion and provisioning/isolation suites. A subsequent **test-only** correction replaced
that restriction with actual recording-note visibility checks: recorder **54/54**, dashboard
browser checks exit 0, and the visibility mutant killed. Five earlier ownership/environment/
scope mutants also bit. **No second full sweep was run; 81/82 remains the actual full result.**
A fresh all-green full baseline after the test-only correction remains unverified.

All 277 measured files and the directory structure were unchanged during the full
run; the follow-up tests also made no repository writes. The real registry remains
`applications: []`, generation state remains `{}`, and no real application data was created.
Only tests and documentation changed after the full run; production behavior did not.
Screenshots contain isolated synthetic applications only. See the
[validation report and screenshots](../docs/validation/DASHBOARD-VALIDATION.md) and
status_version **46** in [REMAINING.md](../docs/history/REMAINING.md).

**External setup / remaining validation:** obtain approved Keysight project/environment IDs,
actual URLs, account and authentication requirements, network access and approved cases.
Credential variable-name bindings can now be edited in Project Settings; the earlier cleanup
handoff's statement that this requires separate registry editing is superseded. Secret VALUES
remain external (process environment, ignored local environment configuration or CI secrets).
No Keysight application was added. Real authentication, SSO/MFA/redirect compatibility,
custom specs bypassing shared fixtures, and cross-browser/client-host behavior are unverified.
Environment URL binding is proven through the shared framework/base fixtures. Existing
Claude CLI runtime integration remains; **Copilot/provider abstraction is NOT IMPLEMENTED**
and no runtime AI was invoked. A future all-green full baseline requires a separately
requested sweep; it must not be inferred from the targeted follow-up.

## Historical state: cleanup baseline closed, 2026-09-12

**PROVEN FROM REPOSITORY:** the newly authorized full offline regression after the
`elementRef`/`captureRef` guide correction passed **80/80 fixtures by exit code, zero
failures, 1470.07 seconds**, run sequentially with a stop-on-first-failure policy.
Locator validation (including F6), locator-quality benchmark, workspace accordion, and
synthetic empty -> first -> second -> third dashboard onboarding all passed. No runtime AI
or live application tests were invoked. No further framework changes or cleanup were made.

All 267 measured working-tree files (excluding `.git` and `node_modules`) were unchanged
across this run: zero changed, created or deleted.
The real registry remains schemaVersion 1 with `applications: []`; generation state is `{}`.
Application stores contain no application files or subdirectories (only retained `.gitkeep`
files and generic BasePage where applicable). None of the 2488 removed files reappeared.
The 16 protected framework files and four governance contracts still match their recorded
pre-cleanup hashes. Retained source/tests also match the recorded pre-final-cleanup snapshot;
its only differences are the documented guide/handoff changes and three cleanup reports.

The external recovery backup is readable: all **2740 files** match `before-hashes.json`,
and all **2488 removal-manifest entries** match the backup. Location:
`C:/Users/Maneeswar/AppData/Local/Temp/aura-cleanup-audit-ory0g08o`.
Fresh logs, result JSON and integrity records are in its
`baseline-closure-20260912-182223/` subdirectory. Recovery contains retired application data
and secrets; keep it private and outside client deliverables. No client package was built.
Client delivery must exclude recovery material, `.git` history and local secret files.
No secrets were printed; no Git history rewrite, commit or push was performed.

The earlier cleanup sweep remains **79/80 in 728.93 seconds**, followed by the passing
locator-validation documentation follow-up. Those historical results and their report/JSON
are unchanged; this 80/80 run is a separate measurement. Prior focused/mutation results were
not rerun or relabeled in this closure. Only this current-state file and REMAINING.md were
updated after the new regression.

**Keysight registration configuration, proven from implementation:** Add Project requires
project name, a unique permanent lowercase project ID, an environment ID, and the actual
base URL including its scheme. The dashboard POST validates and registers the application,
creates `excel/<applicationId>-test-cases.xlsx`, and selects it. Application paths derive
from the ID; artifact directories are populated by their existing lifecycle on first write.
The starter workbook row is an inactive example, not an approved Keysight test.

**Remaining blockers / recommendations:**

- Obtain the approved environment URL, application/environment IDs, network access, actual
  test cases and test-account/authentication requirements. None of these Keysight facts has
  been supplied or validated; Keysight has not been added.
- The four-field Add Project form has no credential controls. Environment credential
  VARIABLE NAME bindings need separate configuration: the registration API accepts them at
  creation, or the environment's registry configuration must be updated after form creation.
  Secret values belong in the runtime environment, ignored local `.env`, or CI secret store,
  never the registry, authored artifacts or a client package. This is configuration, not a
  framework source-code change; the dashboard has no project credential-editing endpoint.
- Authenticated generation is not proven for Keysight. `ai/autocode/session.ts` still uses
  fixed `#loginForm` email/password, `.login-submit`, and login-page probe selectors. Determine
  compatibility with the real authentication flow before enabling it; setting credentials
  alone cannot establish compatibility. Do not assume password login, SSO or MFA behavior.
  A mismatch would require a separately authorized generalized investigation/change.
- Provisioning does not discover business requirements, authenticate the application, or
  create evidence-backed Page Objects automatically. Author approved cases and capture the
  real flow through the existing recording/knowledge/Page Object lifecycle. Host Node/npm,
  Playwright browser availability, network access and any live CI secrets/schedule remain
  external setup. The offline suite does not prove client-host or live-app readiness.
- Runtime AI still uses the existing Claude CLI integration; installation/sign-in is external
  if that path is later used. **GitHub Copilot and its provider abstraction are NOT
  IMPLEMENTED** and were not invoked or added here; they are not required for registration.

**RECOMMENDATION:** ready for dashboard registration once the real configuration is supplied;
not a claim of authenticated Keysight execution/generation readiness. Next action is to
obtain that configuration and establish authentication compatibility, not restore old data.
See status_version 45 in [REMAINING.md](../docs/history/REMAINING.md) and the historical
[cleanup report](../docs/history/OLD-PROJECT-CLEANUP.md). Sections below predate cleanup.

## 1. Purpose of this document

This is a **point-in-time engineering handoff**, written so another coding agent can open this
repository and continue without depending on any prior conversation history.

**It is not governance.** The four `MOOLYAAURA-*` contracts in this directory are the authority;
this file is a snapshot beside them. Everything here is expected to go stale â€” counts, timings,
defects, the git state. Where this document and the repository disagree, **the repository wins**,
and the correct response is to re-measure rather than to trust the number written here.

Nothing in this file should be promoted into governance unless it turns out to be a reusable
architectural rule, in which case it belongs in the contract that owns that subject.

## 2. Product purpose

MoolyaAura turns recorded user intent and authored spreadsheet test cases into maintainable
Playwright TypeScript automation, for more than one application at a time, using deterministic
locator intelligence, reusable Page Object capabilities, per-application knowledge, runtime
measurement and a deliberately small amount of AI.

Two entry points exist today and share the same downstream pipeline:

- **Excel-sourced test cases** â€” a workbook drives selection, generation, execution and
  write-back of results (`ai/excel/`, `npm run excel:*`). Rows that declare their own assertion
  (`Assert Outcome`) execute with no spec written at all.
- **Recording** â€” a browser session captured through the local dashboard, with evidence measured
  at the moment of each interaction (`ai/dashboard/`), which the deterministic mapper then turns
  into a spec (`ai/autocode/from-recording.ts`).

The framework is deterministic-first. AI is a last-mile mechanism at two points only (Â§7).

## 3. Current architecture

Layers, in the order work flows through them:

| Layer | Where | What it owns |
| --- | --- | --- |
| Application scope | `ai/projects/` | Registry, `applicationId`, scoped artifact paths, provisioning, fixture isolation |
| Recording | `ai/dashboard/recorder.ts`, `live-recorder.ts` | Codegen + live capture, press-time measurement, assertion picking, recording origin |
| Evidence | `ai/autocode/dom-evidence.ts` | Bounded target snapshot, candidate generation, strategy contract, identity predicates |
| Knowledge | `ai/knowledge/` | Per-page YAML, canonical page identity, requirement extraction, framework knowledge |
| Locator intelligence | `ai/autocode/locator-quality.ts`, `abstraction/classify.ts` | Scoring, ranking, effective locator, positional recovery |
| Abstraction | `ai/autocode/abstraction/` | Proposals, validation, semantic resolver, Page Object writer, lifecycle ledger |
| Generation | `ai/autocode/agent.ts`, `orchestrate.ts` | Spec generation, context selection, browser handover, metrics |
| Validation | `ai/autocode/verify.ts`, `independence.ts` | Falsification gate, static check, self-authenticating specs |
| Execution | `playwright.excel.config.ts`, `tests-e2e/` | Run, capture, per-run artifact retention |
| Reporting | `ai/excel/results.ts`, `execution-report.ts`, `html-report.ts` | Root-cause classification, reports, workbook write-back |

The high-level flow matches the Architecture contract and is implemented end to end:

```
recording â†’ application/project context â†’ evidence â†’ knowledge / Page Objects
  â†’ candidate generation â†’ runtime measurement â†’ identity â†’ safety / provenance
  â†’ ranking / reuse â†’ generation â†’ execution â†’ results / history
```

Two components worth naming because they are easy to miss:

- **`ai/autocode/abstraction/lifecycle.ts`** â€” every element that needed a Page Object ends at
  exactly one of six terminal dispositions. "Nobody looked" is not one of the values, which is
  what stopped a coverage hole from being indistinguishable from a considered refusal.
- **`ai/dashboard/`** is a loopback-only control panel (recording, authoring, generation,
  execution, per-run artifacts). It is not a deployment and has no authentication (Â§14).

## 4. Current application-scope architecture

**Implemented and load-bearing.** `applicationId` is declared in `ai/projects/registry.json`,
never derived from a URL, and validated as an immutable lowercase slug with a reserved-name list.

Three applications are registered today: `bugasura`, `demoapp`, `flipkart`.

`ai/projects/scope.ts` resolves an `ApplicationScope` carrying `applicationId`, `environmentId`,
`baseUrl`, credential **variable names** (never values), and `ScopePaths` â€” `pagesDir`,
`knowledgePageDir`, `recordingsDir`, `generatedDir`, `mappingFile`, `fixturesFile`.

- `SHARED_CAPABILITIES` and `APPLICATION_ARTEFACTS` are written-down lists, not inferred.
- **There is no cross-application fallback.** A miss inside the active scope is a miss.
- **One migration affordance exists**: `legacyLayout: true` on at most one application declares
  who owns the unscoped directories. Bugasura holds it today. `layoutFor` prefers
  `<dir>/<applicationId>/` and falls back to flat only for that declared owner; a second
  application resolving to a missing scoped path gets a miss, never somebody else's artifact.
  Recordings have already migrated to scoped directories; Page Objects, knowledge, generated
  specs, the mapping and the fixtures module have not.
- `activeScope()` answers the *ambient* question â€” "which application does a caller that predates
  the scope layer mean?" â€” as the declared flat-layout owner. `resolveScope({})` still refuses the
  explicit question when more than one application is registered.
- **Collection isolation**: `tests-e2e/support/collection-scope.ts` ignores other applications'
  generated directories at Playwright collection time, because a Test Case ID is deliberately
  reusable across applications and `--grep TC_LOGIN_001` would otherwise run two tests and
  misattribute one verdict.
- **Fixture module per application**: `ScopePaths.fixturesFile`, because fixture names derive from
  class names and two applications registering `loginPage` in one file would silently hand every
  spec the first application's class.
- **Application-aware validation**: `ai/autocode/locator-validation.fixture.ts` (section E20)
  groups generated specs by owning application and validates each under its own scope.
- **Provisioning** (`ai/projects/provision.ts`) is a two-effect transaction â€” one workbook, one
  registry entry â€” validated first, registry written last and atomically, with rollback that
  deletes only the workbook that call created.

## 5. Current locator architecture

**Candidate families** (`CandidateFamily`): `identifier`, `content`, `container`, `structural`,
`semantic`, `semantic-scoped`, `attribute`.

**Strategy contract** â€” `STRATEGY_CONTRACT` in `ai/autocode/dom-evidence.ts` declares, for every
strategy the framework emits: `family`, `measuredBy` (`page` | `expression`), `budget`
(`structural-cap` | `family-budget` | `unbudgeted`), `scoreable`, `rebuildable`. 35 entries
declared; the four `NOT_YET_EMITTED` reserved names are written down as such so a genuinely dead
entry cannot hide among them. `ai/autocode/strategy-contract.fixture.ts` runs the real generators
and fails, naming the strategy, when an emission site forgets its declaration â€” it exists because
all three failure modes (unmapped family dropped by budget, unscoreable expression ranking last,
unrebuildable expression never provable) are silent.

**Runtime measurement** â€” candidates are counted in the page (`__auraMeasure`) or rebuilt on the
Node side (`buildLocator`), at the moment of the interaction.

**Exact target identity** â€” `provesIdentity(candidate, role)` in `dom-evidence.ts` is the single
bar: exactly one match, in the interaction's own document, and that element is the one acted on.
Timing is part of the bar and is not interchangeable â€” an **action** may only be proven at
`press`; an **assertion** at `press` or at `pick`. `matchCount === 1` is never sufficient alone.
`provenMeasurements()` is the one reader that gathers every proving measurement across all four
evidence lists.

**Ranking** (`rankProvenCandidates` in `abstraction/classify.ts`), in order: highest *weakest*
segment score â†’ fewer chain segments â†’ exact before its loose twin â†’ shorter expression â†’
generation order. Stability and durability are **not** ranking inputs. An unscoreable expression
sorts last rather than being dropped.

**Positional safety** â€” `.first()`, `.last()`, XPath, `force`, mouse coordinates,
`dispatchEvent`, sleeps and retries are refused outright (`abstraction/validate.ts`). `.nth()` is
admitted only where `positionWithinCandidate` was measured at the interaction and lies inside the
measured match list. Nothing is stripped from a chain to make it pass.

**Page Object reuse** â€” see Â§6.

**Adopted from experiments, and what was not.** Exact and non-exact role+name twins are both
generated, the loose twin emitted last within its family and kept behind its exact one in
ranking; measured over 1,231 archived ranked lists, **0 differed**, so no selection made today
moved. Candidate durability and accessible-name stability are measured and recorded; **neither
became a ranking rule.**

## 6. Current Page Object / knowledge lifecycle

**Reuse before creation, and reuse is a measurement.** `existingCapability()` in
`abstraction/propose.ts` credits an existing capability with the recorded element only where:

- the recorder measured that capability's own declared locator against the element at the
  interaction (the measurement carries `capability: {owner, method}`), **or** an ordinary
  candidate with a byte-equal expression proved identity; or
- for a parameterised proposal, the declared template equals the proposed one and something was
  proven at the interaction;

**and** the knowledge entry names a method that really exists on its class, **and** exactly one
capability qualifies. More than one claimant returns null â€” two claimants are no claimant.
Selector-token overlap is no longer a basis and the token helpers are no longer imported there.

**Lifecycle states**: a screen is UNKNOWN until a recording establishes it, BOOTSTRAPPED when a
first recording establishes ownership plus one proven capability, ESTABLISHED as later recordings
add proven capabilities to the same screen.

**Append-safe, verified after the fact.** `postWriteVerification()` in `abstraction/writer.ts`
compares a pre-write byte snapshot: every previously declared capability still declares the same
locator, no file outside the intended set changed, nothing was removed. Failure rolls the whole
set back â€” edited files from backup, created files deleted.

**Transactional** â€” knowledge entry, Page Object method and fixture registration for one
capability are applied together or not at all. **Idempotent** â€” re-processing a recording produces
the same artifacts rather than duplicates. **Never an overwrite** â€” a bootstrap knowledge file
already at the target path is appended to, not replaced.

**Superseding evidence is observed, never applied.** `alternativeEvidenceFor()` records one line
per *distinct* alternative to `ai/reports/abstraction-alternatives.jsonl` when a recording proves
an expression different from what knowledge declares for the capability it resolved to. It refuses
in every ambiguous direction (no declared expression, prose-only declaration, a parameterised
template legitimately instantiated, a mere quoting difference). Nothing is auto-applied.

**New application bootstrap** â€” a Page Object written into a scoped application directory computes
its `BasePage` and healing-recorder import specifiers from its own location to the framework's real
location, anchored on the fixtures module's directory. The legacy flat layout emits byte-identical
strings. `tests-e2e/support/base-fixtures.ts` holds the application-independent fixture wiring so a
newly provisioned application can write its first Page Object at all.

## 7. Current AI usage

**Exactly two invocation points. Both spawn the Claude Code CLI as a child process.**

| | Spec generation | Semantic resolver |
| --- | --- | --- |
| File | `ai/autocode/agent.ts` | `ai/autocode/abstraction/semantic.ts` |
| Transport | `spawn(resolveClaude(), â€¦)`, `shell: false`, prompt on stdin | same |
| Model | `DEFAULT_MODEL = 'claude-sonnet-5'`, pinned; `AUTOCODE_MODEL` overrides | same resolver |
| Tools | `Read Write Edit Glob Grep` + `Bash(node ai/autocode/browse.mjs:*)` only, `--permission-mode acceptEdits`, `--add-dir <repo root>` | **none at all**, every tool disallowed |
| Purpose | Write one spec; explore an unknown screen once and leave knowledge behind | Answer one semantic question from a closed list |

- **`--strict-mcp-config`** on both, so a user's own MCP servers cannot enter an unattended run.
- **Closed question list** (`SEMANTIC_ENABLED`): `AMBIGUOUS_OWNERSHIP`, `NO_METHOD_NAME`,
  `CONSTANT_PARAMETER_VALUE`, `TEXT_ONLY_IDENTITY`, `UNCLASSIFIED_TARGET`,
  `CONTAINER_OR_CAPABILITY`, `AMBIGUOUS_NAME`. `SINGLE_TARGET` is deliberately excluded â€” it is a
  claim about sample size, not meaning.
- **The resolver is a post-pass, not a stage.** `analyseCorpus()` is synchronous and contains no
  model call; the deterministic answer exists in full before anything is asked. `revalidate()`
  clears exactly the one refusal that was asked about and re-runs every other rule.
- **The locator is never the model's.** `templateFor` builds the expression from the measured one;
  a returned locator is a consistency check and nothing else.
- **Terminal decline** â€” a validated decline ends the exchange when every still-unanswered question
  is one whose answer is the decision (`DECIDABLE_BY_DECISION`). A timeout is never terminal; an
  outage leaves the proposal exactly as the deterministic engine produced it.
- **Attempt budget** â€” `MAX_RESOLVER_ATTEMPTS = 3`; a spent budget records a structural
  `RESOLVER_EXHAUSTED` refusal rather than a verdict.

**Is there an `AIProvider` abstraction?** **Partially, and only inside the resolver.**
`export type Transport = (prompt: string, model: string) => Promise<string>` in `semantic.ts` is a
real seam â€” fixtures substitute it â€” but `claudeTransport()` is the only implementation, and
`agent.ts` has no equivalent seam at all: it builds Claude-CLI argv inline. There is no provider
registry, no provider selection, no capability negotiation, no shared prompt/response contract.

**Is GitHub Copilot integrated?** **No.** There is no Copilot code, dependency or configuration
anywhere in the framework. The only occurrences of "Copilot" in the repository are in the root
`README.md`, which is the **upstream Playwright MCP** README (regenerated by `npm run lint`) and
documents how to register the Playwright MCP server with the Copilot CLI. It is unrelated to
MoolyaAura's AI path.

**Dependencies**: `package.json` declares no Anthropic SDK, no OpenAI SDK, no LLM client of any
kind. The dependency on Claude is the CLI binary found at run time by `resolveClaude()`.

## 8. GitHub Copilot target direction

**Planned. Not implemented. Nothing below exists in code today.**

The intended Keysight production direction is:

```
MoolyaAura deterministic framework â†’ AI provider abstraction â†’ GitHub Copilot provider
  â†’ AI suggestion â†’ deterministic MoolyaAura validation
  â†’ identity / safety / ranking / reuse / generation
```

The constraints that make this safe are already governance and must not be relaxed to make an
integration fit:

- The MoolyaAura core stays **provider-agnostic**. A provider is a transport plus a prompt/response
  contract; it is never a decision-maker.
- **GitHub Copilot must never become the source of locator truth.** Copilot output is a suggestion
  and passes the identical deterministic verification as any other candidate.
- Adoption is subject to enterprise licensing, authentication and security approval, which are
  outside the framework's control (Â§15).

## 9. Current testing / validation architecture

- **77 offline fixtures**, `ai/**/*.fixture.ts`, run individually with `npx tsx <file>`. They are
  the regression suite. They are deliberately not Playwright tests and not part of `npm test`
  (which is the upstream Playwright MCP suite and must stay hermetic).
- **Fixture isolation** â€” `ai/projects/fixture-safety.ts`. `enterIsolatedArtefactRoot()` points
  `AURA_ARTEFACT_ROOT` at an OS temp directory so a fixture cannot *name* a real artifact path;
  `removeFixtureTree()` independently refuses any delete outside the active fixture root, including
  when no isolation is active; `assertAbsent()` protects the deliberately un-isolated fixture.
  Both barriers exist because of two real incidents in which fixture cleanup deleted live
  recordings â€” one recovered from a backup, one not.
- **Mutation testing** â€” a protection is proven by intentionally removing or corrupting it and
  showing the relevant fixture goes red. Phase 13.7 recorded eight mutations, all biting.
- **Corpus measurement** â€” `ai/autocode/locator-quality-benchmark.fixture.ts`,
  `candidate-durability.fixture.ts`, `exact-nonexact.fixture.ts`,
  `accessible-name-stability.fixture.ts` measure over the archived corpus rather than asserting a
  single case.
- **Strategy contract test** â€” Â§5.
- **Application-aware validation** â€” Â§4.
- **Falsification gate** â€” `ai/autocode/verify.ts` / `npm run excel:verify`: a generated spec must
  fail when the behaviour it claims is broken, or it is quarantined. Note this **writes**
  `ai/autocode/state.json` and `ai/test-mapping/mapping.json` and drives a live browser.
- **Independence** â€” `npm run excel:independence`: generated specs must authenticate for themselves.

## 10. Latest verified regression baseline

**Last known verified baseline: 77/77 fixtures green, 0 failures.**

- **Source**: `docs/history/REMAINING.md`, `status_version: 41`, the `regression:` block and
  `p13_7_resolver_terminal_decline_and_page_object_bootstrap.regression` â€” "77 fixtures run, 77
  green, 0 failures, exit code 0 â€” 2026-09-09, one run on the settled tree".
- **Independently corroborated during this audit**: `find ai -name '*.fixture.ts' | wc -l` returns
  **77**, so the fixture *count* the baseline refers to is current and no fixture has been added
  or removed since.
- **Not re-run.** This was a documentation-only task; running 77 fixtures is expensive and several
  write artifacts. One fixture was run as a targeted check â€”
  `npx tsx ai/autocode/strategy-contract.fixture.ts`, chosen because it writes nothing anywhere â€”
  and it passed all checks with exit code 0 (30 strategies emitted by 6 graphs, 35 declared).
- **Treat 77/77 as a point-in-time observation, not a target.** The number moves whenever a phase
  adds a fixture, and it has (63 â†’ 66 â†’ 73 â†’ 74 â†’ 75 â†’ 76 â†’ 77 across P5â€¦P13.7).

**Re-measure with**: `for f in $(find ai -name '*.fixture.ts' | sort); do npx tsx $f; done` â€”
and check **exit codes**, not printed summaries; several fixtures print their own wording and a
grep for PASS/FAIL reports nothing for them while they are green.

## 11. Current artifact state

Point-in-time observations, 2026-09-12. **Do not modify artifacts to preserve these numbers.**

| | Count |
| --- | --- |
| Registered applications | 3 (`bugasura`, `demoapp`, `flipkart`) |
| Bugasura recording files | 412 |
| Flipkart recording files | 54 |
| Evidence sidecars (`*.evidence.json`) | 102 Bugasura, 17 Flipkart |
| Page knowledge files | 4 (3 Bugasura, 1 Flipkart) |
| Page Object classes | 8 (7 Bugasura flat, 1 Flipkart scoped) |
| Generated specs | 64 (62 Bugasura flat, 2 Flipkart scoped) |
| Offline fixtures | 77 |

The `TESTING-CONTRACT` previously quoted 409 Bugasura / 20 Flipkart. Both moved through ordinary
recording work; that is the expected behaviour of a baseline and is why the numbers were moved out
of governance and into this file.

**No `TC_TEST*` artifact exists in any live corpus.** The single filesystem match is
`ai/reports/recordings-premigration-bugasura/accepted/TC_TEST_A.spec.ts`, inside a pre-migration
backup snapshot under the git-ignored `ai/reports/`. That is history, not a live artifact.

## 12. Known confirmed defects

Each of these is supported by evidence gathered during this audit. **None was fixed** â€” this was a
documentation-only task.

1. **The AI boundary is enforced asymmetrically.** `postWriteVerification()` protects established
   capabilities on the *framework's own* write path. The spec-generation agent
   (`ai/autocode/agent.ts`) runs with `Read Write Edit`, `--permission-mode acceptEdits` and
   `--add-dir <repo root>`, and there is **no post-run repository-integrity comparison** over
   knowledge YAML or Page Object files. Further, `explorationRequest()` in
   `ai/knowledge/page-knowledge.ts` explicitly instructs the agent to write `page_object:` and
   `page_object_method:` lines into a knowledge file.
   *Mitigated but not closed*: such a declaration establishes nothing, because
   `existingCapability()` still requires a proven measurement and a method that exists on the
   class. The gap is that an AI-authored declaration can enter the repository unverified, not that
   it can be credited.
2. **`.gitignore`'s rationale for recordings contradicts the architecture.** The comment calls
   `ai/dashboard/recordings/` a "short-lived internal artifact, never a recording repository".
   It is now a 466-file durable evidence corpus that the identity, enrichment, durability and
   corpus-benchmark architecture all read. The directory is ignored, so the corpus exists on this
   machine only and is unrecoverable if lost.
3. **`docs/history/PHASE-STATUS.md` is stale and self-contradicting.** Dated 2026-08-14, it states
   "Nothing here is committed. `ai/`, `excel/` and `tests-e2e/` are untracked by choice" â€” 121
   files under `ai/`, 81 under `tests-e2e/` and 1 under `excel/` are now tracked. Its
   `blockers.legacy_22` reasoning in `REMAINING.md` rests on the same premise.
4. **Root `CLAUDE.md` contains one factually wrong sentence, corrected during this audit.** It
   stated "no `tsconfig.json`"; one exists (untracked, editor-only, `noEmit`). See Â§19.

**Open blockers carried forward from `REMAINING.md`, unverified this session** â€” recorded so they
are not lost, not confirmed here: `legacy_22` (22 accepted tests with unsafe locators whose
evidence was deleted before retention existed), `accepted_specs_with_positional_identity` (3 specs
using `.first()` for identity, a subset of the above), `page_object_direct_locators` (5 sync
getters bypassing the cardinality chokepoint â€” audited 2026-08-20 and classified a diagnostics
improvement, not a safety hole), `open_cases.TC_LOGIN_100` (re-record required).

## 13. Known performance limitations

**Measured from `ai/reports/abstraction-semantic.jsonl` during this audit (50 exchange records):**

- **AI transport latency dominates and is not framework computation.** Of the records carrying a
  per-attempt `transportMs`, the range is **71.3 s â€“ 120.1 s**, median **89.4 s**, against a
  **120 s** transport ceiling in `claudeTransport()`. 120,085 ms is the ceiling being hit.
- One exchange in the log spent **271 s** across 3 attempts and still ended `TRANSPORT_FAILED`.
- Several recent Flipkart exchanges ended `TRANSPORT_FAILED` or `REJECTED` after 3 attempts.
- **`terminal: 0` across all 50 records.** The P13.7 terminal-decline optimisation was validated by
  replaying recorded first attempts through the real validator (32 transport calls â†’ 24 over the
  last 12 exchanges), but **no live run since has recorded a terminal stop**. The saving is
  demonstrated, not yet observed in production.

**Framework computation, by contrast, is cheap** (figures from `REMAINING.md`, not re-measured):
`analyseCorpus` 2.2â€“2.8 s for Bugasura, 0.08â€“0.13 s for Flipkart; candidate generation
0.30 â†’ 0.43 ms per target after P10; press-time measurement 15 â†’ 19 ms mean over 5 live targets.

**The distinction matters.** Generation wall-clock is provider-bound, not compute-bound. Optimising
the deterministic engine will not move it.

## 14. Architectural work remaining

Verified as genuinely absent or incomplete:

1. **AI provider abstraction.** A `Transport` function type exists in `semantic.ts` with one
   implementation; `agent.ts` has no seam at all. No provider registry, selection, capability
   contract or shared prompt/response schema.
2. **GitHub Copilot integration.** Absent entirely (Â§7).
3. **Authentication / authorization.** None. `ai/dashboard/server.ts` binds `127.0.0.1` with no
   host option and no auth layer; safety today is that it is unreachable, not that it is guarded.
   Any remote deployment needs this first.
4. **Deployment hardening.** Everything is local: hosts-file friendly name, spawned child
   processes, filesystem artifact store, no service boundary, no multi-user model.
5. **Retention policy.** `ai/dashboard/generations/` keeps the latest five generations; execution
   runs under `ai/dashboard/runs/` are **unbounded** (~3 MB per run with traces). Recordings have
   no retention policy at all.
6. **Legacy-layout migration.** Bugasura still owns five unscoped artifact classes. `legacyLayout`
   is explicitly a migration marker that is meant to expire; only recordings have moved.
7. **Repository durability of the corpus and the scope layer.** See Â§18 â€” this is the largest
   practical risk and it is not a code problem.

## 15. External / provider limitations

Outside the framework's control:

- **Provider transport latency** â€” 71â€“120 s per resolver call against a 120 s ceiling (Â§13). Not
  tunable from inside MoolyaAura; the only framework-side levers are asking fewer questions
  (terminal decline) and failing fast.
- **Provider availability** â€” an outage produces `TRANSPORT_FAILED`, and by design records no
  verdict at all.
- **Claude Code CLI dependency** â€” the AI path requires a locally installed binary discovered by
  `resolveClaude()` or named by `CLAUDE_CLI`. It is not an SDK dependency and not in
  `package.json`.
- **Enterprise licensing and access** â€” GitHub Copilot adoption depends on Keysight licensing,
  authentication and security review.
- **Target-application behaviour** â€” e.g. a product that refuses concurrent navigation from one
  host forces single-worker execution. Such facts belong in that application's knowledge scope,
  never in framework logic.

## 16. Important decisions that must not be accidentally reversed

1. **Generalized framework capability over application-specific patch.** A Flipkart, Bugasura or
   Keysight failure never becomes a global framework rule; it becomes knowledge, a Page Object, or
   a scoped artifact.
2. **Deterministic-first, minimal AI.** The deterministic answer exists in full before anything is
   asked. AI is a post-pass over a closed question list.
3. **Runtime identity over locator similarity.** A name, a selector token, a score, a method name
   and a shared class are each not element identity. Identity is a measurement taken at the
   interaction.
4. **Unknown is not yes.** An unresolved locator, several matches, a prose-only declaration or a
   recording predating the measurement all leave identity unknown â€” and unknown never becomes yes.
5. **Two claimants are no claimant.** Ambiguous ownership returns nothing and goes to review.
6. **Application isolation, with no cross-application fallback.** A miss in scope is a miss.
7. **No silent capability overwrite.** Established capabilities are append-only under automated
   enrichment; stronger-looking evidence is retained for review, never applied.
8. **Page Object reuse before creation** â€” and reuse must be proven, not resembled.
9. **AI cannot bypass deterministic verification**, cross application scope, or supply a locator.
10. **Fixtures cannot touch production artifacts** â€” isolation plus an independent delete guard.
11. **Instrument before optimizing**, and never trade target correctness for speed.
12. **Timing is part of proof** â€” an action is proven at the press and nowhere else.
13. **Baselines are observations, not targets.**

## 17. Current next-step candidates

**Not chosen. Listed for a person to decide.** Do not start one of these on the strength of this
list alone.

1. **Investigate and design the AI provider abstraction**, then GitHub Copilot integration
   (Â§8, Â§14.1â€“2). Confirmed from code to be the largest missing architectural piece, and the one
   the stated Keysight direction depends on. `semantic.ts`'s `Transport` seam is the natural
   starting point; `agent.ts` is the harder half and has no seam at all.
2. **Close the AI boundary asymmetry** (Â§12.1) â€” a post-generation repository-integrity comparison
   equivalent to `postWriteVerification`, and a decision about whether the exploration prompt
   should ask for `page_object` bindings at all.
3. **Commit the scope layer and decide the corpus's durability story** (Â§18). This is not
   engineering work, but everything else is at risk until it is settled.
4. **Continue broad Flipkart validation**, which is the `next_action` recorded in `REMAINING.md`
   at the end of Phase 13.7.
5. **Retention and deployment hardening** (Â§14.3â€“5), needed before anything leaves localhost.

## 18. Repository risks / warnings for the next coding agent

**Read this section before touching anything.**

1. **The working tree is far ahead of `HEAD`, and the gap contains the architecture.** `HEAD` is
   `a35da57`, dated **2026-09-03**. Phases 12 through 13.7 exist **only as uncommitted working-tree
   state**. Specifically untracked: the **entire `ai/projects/` directory** â€” the registry, scope
   resolution, fixture safety, provisioning, migration and 11 of the 77 fixtures â€” plus
   `tests-e2e/support/collection-scope.ts`, `tests-e2e/support/base-fixtures.ts`,
   `tests-e2e/flipkart.fixtures.ts`, every Flipkart artifact, 10 further fixtures,
   `ai/excel/workbook-template.ts`, `ai/dashboard/scope-request.ts` and `tsconfig.json`.
   **A fresh clone of this repository does not contain the application-scope architecture at all.**
2. **91 tracked files are modified and 29 are deleted in the working tree**, all pre-existing.
   `.env` is **staged** for deletion. Do not clean, reset, stash or commit any of this without
   asking.
3. **The recording corpus is git-ignored and irreplaceable.** 466 files under
   `ai/dashboard/recordings/`. Every corpus measurement, the identity architecture and the
   enrichment lifecycle read it. It has already been deleted twice by fixture cleanup (Â§9). Never
   run a fixture that writes or deletes without `enterIsolatedArtefactRoot()`.
4. **Ignored-but-load-bearing**: `ai/reports/` (lifecycle ledger, semantic audit, generation
   metrics, alternative evidence), `ai/test-data/`, `ai/dashboard/runs/`,
   `ai/dashboard/generations/`, `ai/autocode/state.json`, `ai/autocode/quarantine/`.
5. **Two Playwright suites, never merge them.** `playwright.config.ts` + `tests/` is the upstream
   MCP suite and gates the Playwright roll; `playwright.excel.config.ts` + `tests-e2e/` is the
   application suite. A bare `npx playwright test` runs the *upstream* one and reports
   "No tests found" for anything in `tests-e2e/`.
6. **There is no typecheck.** No `typescript` in `node_modules`; `tsx` strips types without
   checking them. `tsconfig.json` exists for editors only (`noEmit`) and gates nothing. A type
   error surfaces as a runtime failure â€” after editing anything under `ai/` or `tests-e2e/`,
   actually run it.
7. **Legacy vs scoped paths coexist deliberately.** `tests-e2e/pages/*.ts` (flat, Bugasura) and
   `tests-e2e/pages/flipkart/*.ts` (scoped) are both correct. Never assume a flat directory.
8. **Expensive operations**: the full 77-fixture regression; anything invoking the semantic
   resolver (71â€“120 s per call); the falsification gate (writes state and drives a live browser);
   `npm run excel:demo` **with no `--out`, which overwrites `excel/login-test-cases.xlsx`**
   without backup.
9. **Live-application safety**: tests that write to a real workspace are gated behind
   `BUGASURA_ALLOW_DATA_MUTATION=1` plus `BUGASURA_TEAM`. Nothing deletes what they create.
10. **`docs/history/REMAINING.md` is the session handoff**, and its `status_version` YAML block is
    the machine-readable state. It is a *claim*: verify a phase marked DONE by running its fixture
    and reading the named file. `docs/history/PHASE-STATUS.md` is older and partly stale (Â§12.3).

## 19. Current git state

- **Branch**: `develop`. Main branch for PRs: `main`. `HEAD` = `a35da57`, 2026-09-03.
- **Pre-existing, before this task**: 91 modified tracked files (43 `ai/autocode`, 13
  `ai/dashboard`, 8 `ai/autocode/abstraction`, 7 `ai/excel`, 5 `ai/knowledge`, 3
  `tests-e2e/support`, 2 `tests-e2e/pages`, and one each in `tests-e2e`, `ai`, `ai/test-mapping`,
  `ai/knowledge/page`, `ai/knowledge/framework`, `ai/dashboard/public`, `excel`, `docs/history`,
  plus `playwright.excel.config.ts`); 29 deletions (28 generated report / test-result artifacts,
  plus `.env` **staged** for deletion); 28 untracked paths (Â§18.1).
- **Introduced by this documentation task â€” documentation only:**
  - modified `MoolyaAura_Governance_Pack/MOOLYAAURA-ARCHITECTURE.md`
  - modified `MoolyaAura_Governance_Pack/MOOLYAAURA-LOCATOR-CONTRACT.md`
  - modified `MoolyaAura_Governance_Pack/MOOLYAAURA-TESTING-CONTRACT.md`
  - modified `MoolyaAura_Governance_Pack/README.md`
  - modified `CLAUDE.md` (two corrections: the `tsconfig.json` sentence, and a pointer to this
    governance pack)
  - **added** `MoolyaAura_Governance_Pack/MOOLYAAURA-CURRENT-STATE.md` (this file)
  - `MOOLYAAURA-ENGINEERING-PRINCIPLES.md` was audited and needed **no change**.
- **No production TypeScript, fixture, recording, knowledge file, Page Object, spec, mapping,
  workbook, configuration or dependency was modified.** Nothing was cleaned, reset or reverted.
