# Execution step evidence and the downloadable report

**Measured 2026-09-15 against this working tree and the real TC_SMOKE_037 artifacts.**
Framework correctness defects in shared capabilities. Nothing here is application-specific.

## 1. The measured screenshot policy, before any change

Three controls, and they disagreed with each other.

| layer | measured |
| --- | --- |
| `playwright.excel.config.ts` | `screenshot: AURA_EXECUTION_SELECTION ? 'off' : EXCEL_SCREENSHOT ?? 'only-on-failure'` |
| `server.ts` run env | a run with an `executionSelection` forced `EXCEL_SCREENSHOT:'off'`, `EXCEL_VIDEO:'off'`, `EXCEL_TRACE:'off'` |
| `tests-e2e/support/steps.ts` | `take('PRE_STEP')` ran **unconditionally**, ignoring `captureMode()` entirely; the after-step `photograph()` ran only when the mode was `on` |

So a dashboard-selected run: settings said *no screenshots*, a PRE_STEP screenshot was taken
for every step anyway, and the after-step picture a passing step would need was never taken.

## 2. Where the evidence disappeared, layer by layer

Traced on attempt `71373da6-e519-4fa0-b607-98d3b1b3535d` (TC_SMOKE_037, KSP/stg,
`2026-09-15T15:02:30Z`), read only.

| | question | measured |
| --- | --- | --- |
| A | screenshot physically created? | **Yes — 8 PNGs**, one per step bar one |
| B | where? | `test-results-excel/generated-ksp-TC_SMOKE_037-…-chromium/aura-*.png`, retained to `<attempt>/generated-…/` |
| C | manifest references it? | the **files** appear in `manifest.artifacts`; `manifest.steps[]` carried **no** captures, no status, no duration |
| D | step metadata references it? | **Yes** — `steps/0.json` holds per-step `captures[]`… but `artifact` is the bare filename `aura-….png` while the file is one directory down |
| E | execution API returns it? | **No.** `collectSteps` published only `screenshotUrl`, derived from `screenshotPath`, which the forced-`off` mode never set. `captures[]` were passed through untouched and their files were never copied into the run |
| F | UI receives it? | `selectReportStep` read only `step.screenshotUrl` and `step.captureTiming` |

**First layer where the evidence disappears: E, the execution API.** The pictures existed,
were correctly per-step, and were never published. B and D made them unresolvable even if
they had been, and the policy at layer 1 meant a passing step had no *after* picture at all.

The live run record confirms all of it: `hasReport: false`, `evidence: 0 entries`, and every
step `screenshotUrl: null`, `captureTiming: null`, `captures: 1`.

**Evidence = "—"** has its own cause: `collectEvidence` admits only attachments named
`screenshot`, `video` or `trace`. Framework captures attach as `PRE_STEP-1`, and native
capture was forced off, so the column had nothing to count.

## 3. Did the real run have physical screenshots?

**Yes — eight**, listed above, still on disk, unmodified.

## 4. The generalized fix

**One capture policy, and it is the control the dashboard already offers.**

| `EXCEL_SCREENSHOT` | behaviour |
| --- | --- |
| `off` | no step captures at all (previously ignored here) |
| `only-on-failure` | the failing step keeps its `PRE_STEP` **and** `FAILURE`; a passing step's pre-step frame is discarded |
| `on` | every step keeps `PRE_STEP` + `POST_STEP`; a failing step also keeps `FAILURE` |

`only-on-failure` retaining the failing step's prior frame is not new — it is the behaviour
`runtime-pictures.fixture.ts` already contracted, and that reading was kept rather than
overruled.

**A selection-driven run now turns step evidence ON, not off.** Native screenshots, video and
trace stay off for those runs, and that is a *credential* decision, not a cost one: they are
unmasked and cannot cross the retention boundary. The framework's own captures are masked at
source and can. Forcing them off was why a step-by-step report of a selection run could never
show anything.

No sleeps were added. `POST_STEP` is taken once the step's own work has settled, which the
locator policy has already awaited.

## 5. Screenshot per step

A capture now records its artifact **relative to the output root** — the one space retention,
the run evidence copy and the manifest all already speak — instead of relative to the test's
own output directory. `collectSteps` copies each capture to
`runs/<runId>/evidence/steps/<testCaseId>/<attemptId>/<stepId>/<captureRef>.png` and serves it
at its own URL. Keyed by step **and** capture reference, so a step's second picture cannot
overwrite its first and no step can be served another's. There is no global latest screenshot.

`manifest.steps[]` is now the generated step list **joined to what happened** — status,
duration, attempt, captures, error — by `recordingStepKey`, never by ordinal or filename, so
run → test case → step → screenshot is reconstructable from the manifest alone.

## 6. Capture timing

`captureTiming` is derived from the picture actually taken, so a step stops reporting unknown
timing about evidence it is holding. The screen says **Captured after the step completed**,
**Captured on failure** or **Captured before the step ran**. Where no picture could be taken,
the *reason* is recorded (`captureUnavailable`) and shown, instead of the same
"No screenshot captured" a step nobody photographed would produce.

## 7. Credentials

Unchanged and reused: `captureDiagnostic` masks every `input, textarea, [contenteditable],
[data-sensitive]` and every known secret value at capture time. Credential steps are therefore
photographed *masked* rather than skipped — a contract asserts the "Enter account from
configured credentials" step still shows evidence. Native unmasked capture remains off for
selection runs.

## 8. Download Report — root cause and fix

**Root cause, measured:** `record.hasReport = record.executionSelection ? false : keepPlaywrightReport(record.id)`.
For every selection-driven run the artifact was never produced, so the control correctly hid
something that did not exist. The run directory held only `context.registry.json`.

The `/api/…/runs/<id>/report/` route, `hasReport` and `setReportLink` were all already wired;
what was missing was the artifact — **and** Playwright's report cannot carry what this report
must: application, environment, credential profile **by name**, attempt, recorded step key,
per-step duration and MoolyaAura's own evidence.

`ai/dashboard/run-report.ts` writes the run's own self-contained report — inline CSS, no
scripts, no network requests, screenshots embedded as data URIs — into `runs/<id>/report/`
for **every** completed run. The existing route serves it; Playwright's kept copy stays
reachable at `/report/playwright/`. `keepPlaywrightReport` still runs exactly where it did.

## 9. Report security

Every string passes `diagnosticText` (the same redaction the run diagnostics use) and then
HTML escaping — order deliberate, since escaping a secret still ships it. A **local-path**
redaction was added in the report only: `diagnosticText` does not cover `C:\Users\<name>\…`
or `/home/<name>/…`, and the report is the one artifact that leaves the machine. The
credential profile appears as a name; its values are never read.

## 10. Contracts

`ai/diagnostics/execution-evidence.fixture.ts` — **65 assertions**: a passing run where every
step keeps exactly one after-step picture with a unique, run-relative, existing artifact; a
failing run where the failure state is captured, later steps never run, the reason is retained
and the original exception still reaches the caller; the capture control honoured in both
directions; an unavailable capture recording its reason; the flushed log carrying each step's
captures with no absolute path; and the report carrying run, profile name, per-step evidence
and failure reason while shipping no secret, no absolute local path, no token and no script.

`ai/dashboard/execution-evidence.browser.fixture.ts` — **31 assertions** through the real
dashboard server and a real browser: the API returns each step's own capture keyed to its own
generated step key with no index shifting; the evidence route serves a published URL;
selecting step 1, 2, 3 and returning to 2 fetches **that** step's artifact each time; a
passing step reports when it was captured; the failing step reports its failure state; no step
reports unknown timing; a credential step still shows evidence; the download control appears,
targets the selected attempt exactly, downloads, and carries the profile name, case, failure
reason and each step's own embedded evidence; a run that kept no report offers none.

## 11. Mutants — 16 killed

`ai/testing/execution-evidence-mutations.ts` (**11**): screenshots only on failure; the
capture control ignored; `only-on-failure` retaining a passing step's picture; a capture named
by filename alone; capture timing left unrecorded; an unavailable capture reporting no reason;
the failure state never photographed; the report omitting the failure reason; the report
shipping an absolute local path; the report shipping a protected value; the report showing the
pre-step state as the step result.

`ai/testing/execution-evidence-ui-mutations.ts` (**5**): the evidence route forgetting the
capture URLs; the download control hidden although a report exists; the download pointing at
another run; the screen falling back to another step's picture; capture timing dropped on the
way to the screen.

**Two requested mutants are not carried, and why.** "Screenshot created but omitted from the
manifest" and "manifest has image but API drops it" target `collectSteps`, which the browser
fixture deliberately bypasses by seeding at the API's storage boundary so the UI contracts run
in seconds rather than minutes. `collectSteps` itself is exercised by
`environment-execution.fixture.ts`, whose server block passed here; its browser half exceeded
the harness's own 300 s isolated cap in this environment. That fixture is byte-identical to its
pre-session copy, so the cap is not something this work introduced — but it means the publish
step is covered by its output shape, not by a biting mutant. Reported rather than claimed.

## 12. Other checks

- Green on the settled tree: `execution-evidence` (65), `execution-evidence.browser` (31),
  `runtime-pictures`, `security`, `recording-pictures`, `locator-timeout` (21).
- TypeScript **20 before → 19 after**. The diagnostic that disappeared is
  `ai/dashboard/server.ts` TS2339 `screenshotUrl` — a pre-existing error caused by the API
  writing a field `StepView` did not declare. Declaring the per-step capture model removed it.
  No new diagnostic appeared.
- **No application artifact was written**: nothing under `ai/dashboard/recordings`,
  `ai/knowledge/page`, `ai/test-mapping`, `ai/test-data`, `ai/reports`, `registry.json`,
  `tests-e2e/pages`, `tests-e2e/generated`, `excel`, `ai/diagnostics/artifacts` or
  `ai/dashboard/runs`.
- No full regression; focused checks only, as instructed.

## 13. The existing TC_SMOKE_037 run

**Not rewritten.** Its eight screenshots remain in the attempt directory and its run record is
untouched. It cannot show step evidence in the Step-by-step report, for two reasons that are
both honest: its captures carry the old bare-filename references, and the
`test-results-excel/` files they were copied from were wiped by later runs, so there is nothing
left to re-publish from. Re-indexing it would mean rewriting a historical record, which is out
of bounds.

**A new run is therefore required to see step evidence on screen** — and it will need the
dashboard restarted, because the running process predates every file changed here.

## 14. What was not done

**The one focused live validation run against TC_SMOKE_037 was not started.** It needs the
dashboard restarted first (a person's action), and it is a live authenticated execution
against a customer environment. The generalized fix is proven offline and through the real
server and browser; what a live run would add is confirmation that `collectSteps` publishes
real capture files end to end. That is a one-click confirmation after restart, and the
decision to spend a real authenticated run on it is the user's.
