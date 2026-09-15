# Recording Authoring regression-failure closure

Date: 2026-09-13. Status: **READY — implementation/closure scope**.

## Production change

`ai/knowledge/canonical.ts` no longer imports the eager runtime `BASE_URL` constant.
The legacy URL helper resolves its default through `activeScope()` only when called.
Importing canonical identity and authoring modules therefore does not require a selected
application. Scoped operations still use the existing registry/scope validation and
request selection; no application or environment default was introduced.

Real HTTP/browser checks cover zero applications, first-project creation, two applications
without an ambient selection, explicit application/environment selection and clear refusal
of an operation that needs missing scope. Existing environment execution also passed.

No changes were made to production target identity, locator ranking, navigation causality,
USER_CONFIRMED behavior, Page ownership, catalog authoring, manual validation status,
Code Workspace or application code.

## Fixture corrections

The five stale expectations now test current behavior:

- `dom-evidence`: missing evidence preserves safe raw actions and refuses automatic reuse.
- `evidence-consumption`: a lower-ranked proven expression still finds its declared method.
- `evidence-persistence`: execute the parsed production save function with a held recording,
  delegate to real persistence, verify the returned artifact/evidence and pending consumption.
- `parameter`: execute the parsed production resolver expression with dependency doubles;
  verify USER_CONFIRMED precedence and short-circuit behavior at every resolver.
- `semantic-candidates`: exercise candidate enumeration, identity/timing refusals, assertion
  pick admission and unresolved competing declarations.

The test-only parser helper executes actual production units without rewriting source or
adding production test hooks. Integration checks remain in the focused authoring suites.

Four fixtures now supply minimal synthetic press-time evidence for their positive controls:
`exploration-auth` supplies the cancel control; `locator-quality` supplies bell/settings;
`locator-safety` supplies the bell; `notifications-knowledge` supplies bell/settings actions
alongside its existing assertion evidence. Measurements use the intended expression, one
match, matched identity, the same document and press timing. Deliberately unproven dynamic
identifier and bare-text controls remain unproven. No customer evidence was changed.

## Regression routing

`ai/testing/final-regression.ts` uses explicit fixture routing:

- `repository-secrets`: read-only in the actual Git checkout; no synthetic Git index.
- `onboarding`: native entry point and its existing guarded isolation; its copy now includes
  required authoring JS/CSS, verified by actual HTTP requests.
- Other fixtures: guarded synthetic checkouts, with no installed application artifacts.

Startup failures retain child stdout/stderr and fail readiness explicitly before HTTP work.
Owned fixture children are terminated during cleanup. The synthetic worker's execution
limit is 300 seconds, with exit 124 for timeout; its outer limit is 360 seconds including
copying/seeding/cleanup. Native onboarding has a 360-second outer limit; the read-only Git
check has 30 seconds. Reports retain exit codes, timeout status, route and logs.

The sweep collects every result, including after failure. A behavioral injected-failure
check and an early-stop mutation protect this property. Reports label this suite as framework
contracts and explicitly separate it from live application validation.

## Focused validation

All exited 0, in the requested group order:

| Group | Checks |
| --- | --- |
| A: startup | dashboard-startup, dashboard-experience, environment-execution, project-api, native onboarding |
| B: corrected fixtures | dom-evidence, evidence-consumption, evidence-persistence, parameter, semantic-candidates, exploration-auth, locator-quality, locator-safety, notifications-knowledge |
| C: authoring and integration | explicit-authoring, authoring-workspace, authoring-browser, ownership-reuse, recorded-flow, navigation-causality, fixture-routing |

There were 21 focused checks. The routing check was additionally rerun after adding the
explicit sweep-continuation test and timeout reporting; it also exited 0. Browser checks
used synthetic applications. Logs are `regression-repair-A-*.log`, `-B-*.log`, and `-C-*.log`
in this directory.

## Mutations

All **63 mutations were killed**:

| Suite | Killed |
| --- | ---: |
| Closure: startup, request scope, reuse/identity/ambiguity, persistence, precedence and routing | 10 |
| Explicit authoring | 8 |
| Code Workspace / authoring workspace | 12 |
| Ownership / reuse | 10 |
| Navigation causality | 12 |
| Recorded flow | 11 |

The initial closure mutation harness stopped because restoring eager URL resolution triggered
an earlier stale-URL assertion than its expected startup diagnostic. The harness was corrected
to drive the direct dashboard startup fixture; all nine original closure mutants then passed.
The tenth, sweep-continuation mutation was run separately and killed. This was a harness
expectation correction; no production change followed that result. See the retained initial
log and `regression-repair-D-regression-repair-confirmed.log`, `-D-sweep-continuation.log`,
and the five existing-suite `-D-*.log` files.

## TypeScript

Fresh before/after `tsc --noEmit --pretty false` runs both exited **2** with **20 diagnostics**.
Their output is byte-identical: zero additions and zero removals. No new authoring-module
diagnostics were introduced. The repository-wide existing issues remain; this is not a green
repository typecheck. See [comparison](regression-repair-typescript-comparison.json),
[before](regression-repair-typescript-before.log), and [after](regression-repair-typescript-after.log).

## Final framework regression

One complete regression ran on the settled source tree:

```text
node node_modules/tsx/dist/cli.mjs ai/testing/final-regression.ts docs/validation/regression-repair-full.json
```

**90/90 fixtures passed, zero failures, exit 0, 559.230 seconds.** No fixture timed out.
The real-checkout `repository-secrets` route passed 8/8 checks; native onboarding passed
with zero failures. All other fixtures used guarded synthetic workers. No source was edited
during or after the sweep, and no second full sweep was run.

See [complete results](regression-repair-full.json), [runner output](regression-repair-F-final.log),
and [per-fixture logs](regression-repair-full-logs).

## Artifact integrity and review

The final before/after comparison found only the intended framework/test changes. All 71
monitored KSP files remained byte-identical, including application artifacts. The inventory
grew from 287 to 294 files through seven new test/helper modules, with no unexpected changes.
See [integrity comparison](regression-repair-integrity.json). The final sweep itself changed
zero files in the monitored source/application roots, including root package/config files.

Concurrent dashboard activity: no application-artifact changes were detected across this
closure. No user dashboard was stopped or modified; idle/read-only activity was not measured.

Self-review followed AGENTS.md and the four governance contracts: the production fix is
generic and scope-preserving; evidence additions are synthetic; automatic identity admission
is unchanged; meaningful mutations protect the boundaries; artifact-writing checks use guarded
temporary roots. The TypeScript limitation is explicitly retained.

This closure does not claim live acceptance of TC_SMOKE_015. Its previously documented Auto
authentication limitation remains outside this task, and no KSP test was generated or executed.
