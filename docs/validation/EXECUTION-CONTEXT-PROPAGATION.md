# Execution context propagation — verification and closure

Measured 2026-09-14 against the working tree at `C:\Users\Maneeswar\ClientProjects\MoolyaAura\MoolyaAura`,
branch `develop`. This report **verifies an implementation this session did not write** and closes the one
link in it that no test covered. Whole-framework regression and live acceptance are not claimed.

## What was reported, and what the repository says

Two defects were handed over as unresolved:

1. **TC_SMOKE_026 clean execution fails before the first UI action** because `sourceEnvironmentId` /
   `AURA_SOURCE_ENVIRONMENT` is not propagated into the Playwright clean-run process.
2. **Quarantine reruns do not propagate Headed browser mode.**

Both are real, and both are recorded in the repository rather than only in a summary. The live failure is
retained verbatim in `ai/autocode/state.json` under `ksp/TC_SMOKE_026` (and identically under
`ksp/TC_SMOKE_024` and `ksp/TC_SMOKE_025`), and in the generation record
`ai/dashboard/generations/2026-09-13T17-09-55-757Z-dmgr.json`:

```
Phase: EXECUTION | Reason: RUNTIME_FAILURE | Collected tests: 1.
Error: Select a configured source environment for execution
  at support\execution-environment.ts:10
   9 |   const sourceId = process.env.AURA_SOURCE_ENVIRONMENT;
 > 10 |   if (!sourceId || !Object.hasOwn(application.environments, sourceId)) throw Error(...)
```

**The quoted source no longer exists.** `tests-e2e/support/execution-environment.ts` line 10 now reads the
resolved context, not a bare environment variable, and the whole transport around it was rewritten in the
working tree between 22:55 and 23:29 local on 2026-09-13 — after the 17:09 UTC failure that produced the
record above. The handoff documents were never updated to match, which is why the defect still reads as
open in `REMAINING.md` status_version 61. **The repository wins over the summary**, so what follows is a
re-measurement rather than a restatement.

### Root cause, as the code shows it

`ksp` declares two environments (`stg`, `qa`) and no `defaultSourceEnvironmentId`, so
`defaultSourceEnvironment()` correctly returns nothing and a source environment must be chosen
explicitly. Before the correction, that choice existed only in the dashboard request; nothing carried it
down to the Playwright child, and the child was launched anyway. The first `page.goto` — the step before
any UI action — then asked for a source environment that the process had never been told about.

The correction is one typed `ExecutionContext`, resolved once per entry point and carried whole:

- `ai/projects/execution-context.ts` owns `resolveExecutionContext`, the transport readers, and
  `executionEnvironment` / `executionBrowserArgs`. Application, target environment, source environment,
  credential/data/row selection, browser engine, channel, headed mode and the locator timeout travel
  together as `AURA_EXECUTION_CONTEXT`, with the flat `AURA_*` variables kept beside it.
- Every launcher passes it: `ai/dashboard/server.ts` (`startAutocode` and the run path),
  `ai/autocode/cli.ts`, `ai/autocode/orchestrate.ts`, `ai/autocode/verify.ts` (`gate` → `runOne`),
  `ai/excel/cli.ts` and `ai/dashboard/quarantine-workspace.ts` (`rerunQuarantine`).
- `playwright.excel.config.ts` reads the same context for `headless` and the browser channel, so the
  approved mode reaches the browser rather than only the argv.
- A missing or foreign source environment is refused as `SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE`
  **before any child is spawned**. The prior session's recorded red run
  ([execution-context-red.txt](execution-context-red.txt)) is exactly that gate failing to hold: the gate
  reached a Playwright launch with no source environment configured.

### The failing statement, re-measured against the real registry

A read-only probe calls the exact statement TC_SMOKE_026 died on — `executionUrl()` for its recorded
`page.goto('https://stgsupport.keysight.com/us/en/home')` — against the live `ksp` registry, with no
browser, no network and no write of any kind
([script](execution-context-tc026-probe.ts), [output](execution-context-tc026-probe.txt)):

```
no context (the state this case failed in) -> REFUSED: SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE:
    Application ksp; target environment stg; source environment = not selected.
flat AURA_SOURCE_ENVIRONMENT=stg                -> https://stgsupport.keysight.com/us/en/home
full AURA_EXECUTION_CONTEXT (source stg, headed) -> https://stgsupport.keysight.com/us/en/home
source qa rebased onto target stg                -> https://stgsupport.keysight.com/us/en/home
unconfigured source -> REFUSED: SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE:
    Application ksp; target environment stg; source environment is not configured in this application.
```

The statement resolves as soon as the context reaches the process, and when it does not the refusal is a
named configuration failure rather than the `RUNTIME_FAILURE` the case was recorded under.

## The gap this session found and closed

Server-side propagation of the approved browser mode was implemented and tested. The link **above** it was
not: nothing checked what the quarantine workspace actually puts in the rerun request. That is the shape
the original defect had — a rerun that dropped Headed looked correct from the server, because the server
faithfully propagated the headless it was handed.

Added to `ai/dashboard/quarantine-browser.fixture.ts`: the real workspace is driven through **Re-run
draft** → the execution-settings dialog → **Use execution settings** → **Re-run with original profile**,
and the resulting `POST /api/quarantine/rerun` body is captured. It must carry `headed: true`, the
selected `sourceEnvironmentId`, the selected browser engine and its own `applicationId`. The request is
answered in the page rather than executed — the subject is the payload, and running it would open a
second real headed browser inside a fixture.

Two mutants were added to `ai/testing/execution-context-mutations.ts` for it, both faulting
`ai/dashboard/public/quarantine-workspace.js`: dropping `headed` from the dialog's choice, and dropping
the selected source environment. Both make the new check red.

No production file was changed by this session.

## Validation results

All listed commands exited **0** on the settled tree, except the typecheck, which is discussed in its own
row. Logs: [unit](execution-context-focused.txt), [end-to-end](execution-context-browser.txt),
[quarantine rerun](execution-context-quarantine-rerun.txt),
[quarantine package](execution-context-quarantine-package.txt),
[quarantine browser](execution-context-quarantine-browser.txt),
[mutants](execution-context-mutations.log).

| Check | Result |
| --- | --- |
| `ai/projects/execution-context.fixture.ts` | **18 behavioural checks passed**: target default is not a source default, configured/singleton source selection, invalid and foreign source refused, browser/channel and timeout-policy refusal, two credential profiles as independent rows, transport round-trip, Playwright config consuming headed mode and channel, a real `gate()` clean+mutation pair, **both Playwright children receiving source distinct from target, `--headed` and `--project=`**, and both manifests retaining the context. |
| `ai/dashboard/execution-context.browser.fixture.ts` | **3 contracts passed**, end to end with no mocked transport: HTTP generation preflight refuses a missing source without touching a browser; then **real UI → HTTP → autocode CLI → grouping/orchestration → gate → clean and mutation Playwright children**, where the child navigates to the *target* origin and never the source, with headed mode carried into both diagnostic manifests; then a manual execution with two JSON credential profiles keeping source/target/browser context in separate instances. |
| `ai/dashboard/quarantine-workspace.fixture.ts --phase=rerun` | Passed: failed and passed reruns in an isolated checkout, `headed: true` and the original source environment retained in the executed run's manifest, an override changing both, shared 40-second policy recorded, revision history, and no automatic promotion. |
| `ai/dashboard/quarantine-browser.fixture.ts` | Passed, baseline **and** with the new check: **the rerun request carries the approved browser mode, source environment and application**. |
| `ai/testing/execution-context-mutations.ts` | **10/10 killed** — see the table below. |
| TypeScript (`npx tsc --noEmit`) | **20 diagnostics before and after, identical identities**, zero in any changed module — [before](execution-context-tsc-before.txt) / [after](execution-context-tsc-after.txt). The repository typecheck is still not green: it exits **2** (diagnostics present). That is the pre-existing state recorded in [LOCATOR-TIMEOUT-POLICY.md](LOCATOR-TIMEOUT-POLICY.md), which quotes exit 1 for the same 20 diagnostics; the exit code differs, the diagnostics do not. Not a new failure. |

### Mutants

| # | Mutation | Killed by |
| --- | --- | --- |
| 0 | source context dropped before the recorded gate | browser end-to-end |
| 1 | source lost before the Playwright child | unit + real gate |
| 2 | source silently replaced with the target | unit |
| 3 | credential profile changes the source | unit |
| 4 | quarantine loses its original source | quarantine `--phase=package` |
| 5 | headed mode lost on quarantine rerun | quarantine `--phase=rerun` |
| 6 | **quarantine rerun workspace drops the approved browser mode** | quarantine browser (new) |
| 7 | **quarantine rerun workspace drops the selected source environment** | quarantine browser (new) |
| 8 | missing source mislabeled as a runtime failure | unit |
| 9 | another application's source accepted | unit |

Mutants 6 and 7 are this session's; the rest were already declared and are re-measured here on the settled
tree.

## Artifact integrity

Application artifacts were hashed before and after every run in this session, over the same roots the
earlier audit used (registry, recordings, page knowledge, `ksp` test data, mappings, `state.json`,
quarantine, diagnostics, dashboard runs, `ksp` Page Objects, generated specs, fixtures module, workbooks):

**209 files before / 209 after, zero changed, zero added, zero removed** — byte-identical to the snapshot
`execution-context-after-hashes.json` taken at 23:28 on 2026-09-13. Every fixture ran inside the guarded
OS temporary checkout with the independent deletion guard, so no real application artifact was named,
written or deleted. `ai/autocode/state.json` still records TC_SMOKE_026 as quarantined with its original
reason; nothing about the live case was rewritten.

## What is not claimed

- **TC_SMOKE_026 has not been re-run.** The framework defect that stopped it before its first UI action is
  fixed and proven; whether the case then passes against live Keysight staging is a separate question that
  needs network access, the saved `kspuserCommon` profile, a headed browser and explicit authorization.
  Its quarantine record, recording, mapping and `USER_CONFIRMED` bindings are untouched and ready for that
  run.
- **A dashboard already running from before 2026-09-13 22:55 still has the old code.** The failure in
  `state.json` was produced by such a process. Restart it before re-running.
- **No live quarantine rerun and no live assertion mutation were attempted**, and no eligibility or
  promotion state was changed anywhere.
- **No whole-framework regression was run.** It was not authorized, and focused success is not a
  framework-wide READY claim.
- Runtime AI was not invoked. Copilot remains not implemented.
