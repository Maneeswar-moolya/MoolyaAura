# Quarantine execution basis — implementation and validation

Measured 2026-09-14, branch `develop`, framework revision `e2d308fa3e81041a4961c28e6202472b831a438c`.
Focused validation only; no whole-framework regression was run and nothing was promoted.

## 1. The model: two bases, never conflated

A quarantine package retains what was on disk when it was made — the spec, the application's
Page Objects and knowledge, **and the shared framework of that day**. Replaying all of it answers
*what happened*. It cannot answer *is it fixed*, because the fix lives in the framework the replay
overwrites: the run re-proves the old bug and files it against the test.

That is measured, not theoretical. TC_SMOKE_021's previous rerun carried `locatorTimeoutMs: 40000`
while executing a retained resolver whose `CANDIDATE_TIMEOUT_MS` was `4000`. The context said forty
seconds; the code reading it had been replaced by its own ancestor.

| Basis | Runs | Can establish eligibility |
| --- | --- | --- |
| `CURRENT_FRAMEWORK_VALIDATION` | retained TEST_OWNED + APPLICATION_OWNED artifacts on the **current** shared framework | **Yes** |
| `HISTORICAL_REPLAY` | those artifacts **and** the retained shared framework; labelled `REPRODUCTION_ONLY` | **Never** |

## 2. Ownership classification

Derived from the existing `category()` contract in `ai/dashboard/code-workspace.ts` rather than a
second set of path rules — two independent classifiers drift, and the drift is silent: a file that
reads as application code to one and framework code to the other is replayed from the wrong era and
the run then proves nothing about either. `dependencyOwnership()` is a projection of the one contract:

- `Generated Spec` → **TEST_OWNED**
- `Page Objects Used`, `Application Fixture`, `Knowledge`, `Recording`, `Evidence` → **APPLICATION_OWNED**
- `Shared Dependencies` → **SHARED_FRAMEWORK**
- anything else → **`null` = UNKNOWN**

No application-specific path checks exist anywhere in this change.

## 3. Overlay rules

Every retained file is classified before it is written into the private checkout.

- TEST_OWNED and APPLICATION_OWNED are overlaid in **both** bases — they are the case's identity.
- SHARED_FRAMEWORK is overlaid **only** under `HISTORICAL_REPLAY`. Under validation the current
  checkout's copy executes, restored explicitly when the bulk copy did not already provide it
  (this is what `tests-e2e/pages/base.page.ts` needed).
- Unclassifiable dependency → `QUARANTINE_DEPENDENCY_OWNERSHIP_UNKNOWN`, run stops.
- A retained shared file absent from the current checkout → the same refusal, because validation
  cannot supply what no longer exists. Neither case is guessed.

## 4. Immutability

`original.json`, historical revisions, dependency snapshots and execution manifests are never
written by either basis. Both create **new attempts**. Proven on the live package: after the run,
`original.json` is byte-identical at `dd8bdd7ece465fbf723bf3290d43bdbcbb2afeb6298a8e6a6f0082d80a866393`
and the only changed file in the package is `state.json`.

## 5. Provenance recorded per attempt

`executionBasis`, `resultLabel` (replay only), `sourceEnvironmentProvenance`, `revisionId`,
application/environment/source, `credentialProfileId`, `dataProfileId`, `executionRowId`,
`browserEngine`, `browserChannel`, `headed`, `locatorTimeoutMs`, `currentFrameworkRevision`, and
`retainedApplicationArtifacts` / `currentFrameworkArtifacts` as path+hash lists. **No credential
values.** The live attempt recorded 14 retained application artifacts and 20 current framework
artifacts.

## 6. UI

An **Execution basis** fieldset, defaulting to *Validate with current framework*. The replay option
states in the dialog that it "cannot establish promotion eligibility". The basis travels in the
rerun request; no mode is ever switched silently.

## 7. Eligibility and clean/mutation consistency

`eligible` is set only by `verdict === 'accepted' && basis === 'CURRENT_FRAMEWORK_VALIDATION'`.
`promoteQuarantine` independently refuses any last run not labelled `CURRENT_FRAMEWORK_VALIDATION`
— including unlabelled runs written before bases existed, because an unlabelled pass is not proof
it ran on the framework the promotion would ship against.

Clean and mutation cannot diverge **structurally**: both are the same `gate()` call inside the one
private checkout the basis built. There is no code path that could build the overlay twice.

## 8–9. Focused tests and mutants

`--phase=basis` proves the bases are *observably* distinct on one package: a marker is planted in
the retained shared framework, and each attempt reports which copy executed. It also covers
ownership classification, default basis, unknown-basis refusal, per-attempt persistence,
retained application artifacts present in both modes, replay ineligibility, original immutability,
and continued propagation of headed mode, the 40 s policy and legacy source provenance.

All existing phases (`package`, `editing`, `rerun`, `route`, `rebuild`, `legacy`) still pass, as does
the quarantine browser fixture, which now asserts the dialog defaults to validation and sends it.

Six mutants added — **19/19 in the suite, all killed**:

| Mutation | Killed by |
| --- | --- |
| retained shared framework overlaid during current-framework validation | `--phase=basis` |
| historical replay silently upgraded to current framework | `--phase=basis` |
| historical replay can grant promotion eligibility | `--phase=basis` |
| unknown dependency ownership defaulted instead of refused | `--phase=basis` |
| reproduction-only label dropped from a historical replay | `--phase=basis` |
| workspace stops sending its execution basis | quarantine browser |

## 10. TypeScript

**20 before / 20 after, identical diagnostic identities.** Six new diagnostics introduced by the
new fixture's `runs.at(-1)` were fixed rather than accepted. The repository typecheck still exits
non-zero on the same pre-existing 20.

## 11. Artifact integrity

Only `state.json` of the TC_SMOKE_021 package changed; 32 new diagnostic files were added; nothing
removed. Page Objects, page knowledge, Test Data, registry, recordings, mappings and the workbook
are all byte-identical. No credential value appears in the new diagnostics.

## 12–14. TC_SMOKE_021

`CURRENT_FRAMEWORK_VALIDATION`, ksp / stg, source `stg` (`USER_SELECTED_FOR_RERUN`), kspuserCommon by
id, bundled Chromium, headed, 40 000 ms. Locator, mappings and Page Objects unchanged.

**Clean — Passed.**

| # | Step | Result |
| --- | --- | --- |
| 1 | Open recorded destination | passed 6,383 ms |
| 2 | `InitialLandingPage.logIn()` | passed 4,122 ms |
| 3–5 | `SsoauthLoginPage` email / account / password | passed |
| 6 | `SsoauthLoginPage.logInButton()` | passed 899 ms |
| 7 | `UsEnHomePage.myDashboardState()` | **passed 9,826 ms** |

9,826 ms is past the retained resolver's 4,000 ms window — the precise reason the historical basis
could not pass it and the current one does.

**Mutation — Failed as required**, at **40,516 ms**, having found the heading and rejected its
content (`Expected substring: "__autocode_mutant_no_match__"`). It consumed the full budget and
recorded a locator-wait diagnostic, so the assertion demonstrably inspects the application.

Every one of the fourteen steps across both runs carries `locatorTimeoutMs: 40000`.

**State: `eligible: true`, `promoted: false`.** Nothing was promoted.

## 15. Credential-recording security finding — separate, not fixed here

The recorder redacts passwords but **not account identifiers**. In `ai/dashboard/recorder.ts`,
`SENSITIVE` matches `password|passwd|pwd|secret|token|otp|cvv|credit card|card number`, so "Email",
"Enter email", "Username", "User ID", "Account" and "Login" are all `false` (verified by running the
predicate). The second guard compares only against environment variables named
`PASSWORD|PASSWD|PWD|TOKEN|SECRET|API_KEY|PRIVATE_KEY` plus the registry's
`environment.credentials.password` — `credentials.email` is never consulted, and the JSON credential
profile store is consulted by neither guard.

A typed email therefore persists literally, which is exactly how the account address reached
`ai/dashboard/recordings/ksp/TC_SMOKE_021.spec.ts`. The password did not, and the generated spec
correctly uses `appCredentials.email`.

Deliberately **not** fixed inside this task: it is a different subsystem and needs its own focused
contract and mutants. Proposed minimal generalized fix — extend guard 2 to the `credentials.email`
binding and to credential-profile usernames, and treat a field bound to authentication or test data
as sensitive by **intent** rather than by label, emitting `appCredentials.email` /
`appCredentials.password` as semantic references. The historical package must not be rewritten.
