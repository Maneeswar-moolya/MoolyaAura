# USER_CONFIRMED authentication mapping

Date: 2026-09-13. Result: **TC_SMOKE_018 mapping unblocked**. Live execution and application acceptance were not performed.

## Saved authoring selection

The retained `.owners.json` sidecar was loaded against the application's immutable ID and recording content hash. Its initial action `action:1` had:

| Field | Saved value before this task |
| --- | --- |
| Page | `ksp__us-en-home` |
| Page Object | `LandingPage` |
| Method | `null` — the UI's Auto / Recommended method choice |
| Execution mode | Absent; no explicit recorded-locator choice |
| Provenance | `USER_CONFIRMED` |

The other saved choices were Auto. Page/Page Object confirmation alone did not identify an executable method. After inspection, the user explicitly instructed: “Use its existing recorded locator”. Only action 1's `userSelection.executionMode` was set to `RECORDED_LOCATOR`, preserving its Page, Page Object, null method, provenance and other choices. The atomic write checked the recording revision and concurrent sidecar changes. Neither evidence nor recording source was altered.

## Blocker and generalized correction

Before the change, read-only mapping exited 2 with `authenticationCapability`: action 1 lacked admissible interaction-time identity evidence. The mapper also required a target evidence row even after resolving a USER_CONFIRMED method; credential field and submit checks still demanded automatically measured DOM types. Thus an explicit executable binding could be sent through the automatic admission path again.

Authentication now selects an explicit scoped Page Object method first, then an explicitly selected recorded locator, then the existing automatic resolver chain. Explicit controls do not need target measurements or inferred Page ownership. Automatic controls still require the existing identity evidence and deliverable capability. Whole-span planning remains atomic; credential fills use the scoped credential fixture, and failed plans emit no partial credential operations. Explicit controls prevent automatic composite substitution. Missing methods/fixtures and foreign bindings still fail clearly.

Recording Review persists the recorded-locator mode per action, supports resetting it to Auto and does not inherit execution choices with Page/Page Object context. A Page/PO choice with no method and no execution mode still means Auto execution. Recorded locators are parsed and checked for safe supported expressions, remain USER AUTHORED — NOT VALIDATED, and do not become automatic knowledge. Authentication locators are not reported as requiring Page Object creation. Generated descriptions no longer claim automatic validation for manual choices.

Application isolation, configured credential handling, navigation-causality decisions, automatic locator ranking, existing identity functions, Page authoring/catalog behavior and Code Workspace remain in place. No application-specific branch was added. Recording ownership can come from the scoped, revision-bound authoring sidecar when target evidence is unavailable; foreign evidence remains rejected.

## TC_SMOKE_018 result

Final command: `node node_modules/tsx/dist/cli.mjs ai/testing/inspect-recorded-case.ts ksp TC_SMOKE_018` — **exit 0**. Eleven recorded actions and one assertion map with zero unresolved steps and zero review blocks. The generated authentication call plan is:

```ts
await (page.locator('header').getByRole('link', { name: 'Log In' })).click();
await (await ssoauthLoginPage.enterEmailField()).click();
await (await ssoauthLoginPage.enterEmailField()).fill(appCredentials.email);
await (await ssoauthLoginPage.passwordField()).click();
await (await ssoauthLoginPage.passwordField()).fill(appCredentials.password);
await (await ssoauthLoginPage.logInButton()).click();
```

The remaining automatic authentication controls used existing proven scoped capabilities. The existing dashboard assertion also mapped. There is **no next mapping gate** reported. This command did not save a generated spec, launch the application, or claim a clean/assertion-mutated live pass. Details: [final mapping log](auth-binding-case-final.log).

## Validation

The new isolated behavioral fixture reproduced the defect before production changes: explicit method and recorded-locator authentication failed without target evidence. Its red log also exposed absent execution-mode inheritance and expression-safety handling: [red log](auth-binding-red.log).

All five focused fixture commands exited 0:

| Fixture | Coverage |
| --- | --- |
| `ai/autocode/user-confirmed-auth.fixture.ts` | Eleven behavioral checks: no-measurement explicit methods, persisted raw mode without a PO, Auto evidence refusal, navigation causality/session destinations, foreign bindings/evidence, broken methods, non-inherited execution choices, expression injection, absent evidence sidecar, method precedence and mixed explicit/Auto spans |
| `ai/dashboard/explicit-authoring.fixture.ts` | Existing logical Pages, methods, provenance, inheritance, manual status, explicit auth composition and independent navigation |
| `ai/autocode/ownership-reuse.fixture.ts` | Existing automatic identity, route ownership, ambiguity and reuse protections |
| `ai/autocode/recorded-flow.fixture.ts` | Scoped automatic credentials, recorded-flow assembly, navigation, composites and lifecycle |
| `ai/dashboard/authoring-browser.fixture.ts` | Real browser review selection/persistence/reset, non-inheritance, Code Workspace definitions/history/editing, isolation and responsive layout |

Recorded-flow was rerun after the final generated-description change and again exited 0. [Focused results](auth-binding-focused-results.json), [settled recorded-flow log](auth-binding-recorded-flow-settled.log).

All **28 meaningful mutants were killed**; all three mutation commands exited 0:

- Nine new authentication mutants: repeated automatic gating, discarded raw mode, Auto bypass, foreign binding acceptance, navigation bypass, credential-value disclosure, inherited execution mode, expression-safety bypass and reversed method precedence.
- Eight existing explicit-authoring mutants, including composite substitution and authoring persistence.
- Eleven existing recorded-flow mutants. Two anchors were updated to target the equivalent current authentication receiver/scope expressions; the protected behaviors were retained.

[Mutation results](auth-binding-mutations-results.json). Every writing fixture and mutant ran under guarded temporary checkout isolation with an independent deletion guard.

TypeScript before/after output is byte-identical: **20 existing diagnostics, zero additional diagnostics**, including none in the new authoring/authentication modules. Latest `tsc --noEmit --pretty false` exits 2 because those existing issues remain. [Before](auth-binding-typescript-before.log), [after](auth-binding-typescript-after.log). Changed tracked files pass `git diff --check`.

No complete framework regression was run for this follow-up; the previously completed full regression predates these changes. No live application execution was run.

## Integrity and review

Compared this task's before/after SHA-256 inventory across `ai`, `tests-e2e` and `excel`. Of 65 monitored application/registry files, only the explicitly authorized `TC_SMOKE_018.owners.json` changed. The other 64 were unchanged; no application files were added or removed. Recording source, evidence, application Page Objects, fixture, knowledge, workbook and generated artifacts were preserved. No concurrent dashboard artifact changes were observed. [Integrity result](auth-binding-integrity.json).

Self-review followed AGENTS.md and the engineering, architecture, locator and testing contracts: the fix separates explicit execution authority from automatic evidence, retains scoped safety, fabricates no measurements and makes no live acceptance claim. The current handoff is recorded in `docs/history/REMAINING.md`.

**READY for this authentication mapping task.** TC_SMOKE_018 is unblocked at mapping; live acceptance remains unverified.
