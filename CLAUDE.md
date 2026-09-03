# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The three things that will confuse you first

**1. There is no MCP source code here.** `src/` contains only a README. The Playwright MCP
implementation lives in the [Playwright monorepo](https://github.com/microsoft/playwright) at
`packages/playwright-core/src/tools/mcp` and `.../tools/backend`. `npm run build` is literally
`echo OK`. To change MCP behaviour you clone `microsoft/playwright`, work there
(`npm ci && npm run watch`), lint with `npm run flint`, and test with `npm run ctest-mcp`.
This repo is the published npm wrapper plus its own integration tests.

**2. Two unrelated Playwright suites live side by side.** Separate configs, separate test
directories, separate output directories. Never merge them.

| | Upstream MCP tests | Excel-sourced application tests |
| --- | --- | --- |
| Config | `playwright.config.ts` | `playwright.excel.config.ts` |
| Tests | `tests/` | `tests-e2e/` |
| Output | `test-results/` | `test-results-excel/` |
| Run | `npm test` | `npm run excel:test` |
| Targets | The MCP server, hermetically | Bugasura (my.bugasura.io) over the network |

The separation is load-bearing three times over: `npm test` gates the Playwright roll and must
stay hermetic; the suites need conflicting **global** settings (ours requires `workers: 1` and
the json/Allure reporters), which Playwright cannot vary per project; and they must not share
an `outputDir`, because Playwright wipes it at the start of every run — a shared one means each
suite deletes the other's results.

**3. A bare `npx playwright test` runs the *upstream* suite.** It will report `No tests found`
for anything in `tests-e2e/`. Always go through `npm run excel:test`; arguments after `--` pass
straight through.

## Commands

```bash
npm test                                    # upstream MCP tests (gates the roll)
npm run ctest                               # the only browser project that exists: chrome
npx playwright test tests/click.spec.ts     # one upstream file
npx playwright test -g "browser_click"      # one upstream test by title
npm run lint                                # regenerates README.md from the tool schemas

npm run excel:test                          # all Excel-sourced tests
npm run excel:test -- login.spec.ts         # one file (args after -- pass through)
npm run excel:test -- --grep TC_LOGIN_001   # one test case by ID
npm run excel -- help                       # full toolkit reference
```

`playwright.config.ts` defines exactly one project, `chrome` (plus `chromium-docker` under
`MCP_IN_DOCKER=1`). The `ftest` and `wtest` scripts target `firefox` and `webkit` projects that
do not exist and fail immediately — verified, not assumed.

**There is no typecheck and no TS linter.** No `tsconfig.json`, no `typescript` in
`node_modules` — `npm run lint` only regenerates `README.md` from the tool schemas, and `tsx`
strips types without checking them. So a type error in `ai/` or `tests-e2e/` surfaces only as a
runtime failure: after editing either, actually run the thing (`npm run excel:run -- <wb>
--dry-run` exercises parser, column map and filter without a browser).

## Commit Convention

Semantic commit messages: `label(scope): description`

Labels: `fix`, `feat`, `chore`, `docs`, `test`, `devops`

```bash
git checkout -b fix-39562
# ... make changes ...
git add <changed-files>
git commit -m "$(cat <<'EOF'
fix(proxy): handle SOCKS proxy authentication

Fixes: https://github.com/microsoft/playwright/issues/39562
EOF
)"
git push origin fix-39562
gh pr create --repo microsoft/playwright --head username:fix-39562 \
  --title "fix(proxy): handle SOCKS proxy authentication" \
  --body "$(cat <<'EOF'
## Summary
- <describe the change very! briefly>

Fixes https://github.com/microsoft/playwright/issues/39562
EOF
)"
```

Never add Co-Authored-By agents in commit message.
Branch naming for issue fixes: `fix-<issue-number>`

Avoid `sed -i` across globs like `*.md` — it rewrites untouched upstream files with different
line endings and they show up as spurious modifications.

## Rolling Playwright

1. Run `node roll.js` (or `npm run roll`) to bump `playwright`, `playwright-core`, and `@playwright/test`, refresh `config.d.ts`, and regenerate the README. The script prints the resolved version — use its suffix for the branch name.
2. Create a branch: `git checkout -b roll-pw-<version-suffix>`.
3. Run `npm test`. Only proceed if all tests pass.
4. Commit with `chore: roll Playwright to <version>`, push, and open a PR against `microsoft/playwright-mcp` with the same title.

## Preparing a Release

See [.claude/skills/release.md](.claude/skills/release.md).

## Excel Test Case Integration

Converts spreadsheets of test cases into Playwright automation. Use the `excel-automation`
skill for any request involving a workbook, a `TC_*` id, or an execution report.
[FRAMEWORK-GUIDE.md](FRAMEWORK-GUIDE.md) is the end-to-end walkthrough;
[EXCEL-AUTOMATION.md](EXCEL-AUTOMATION.md) is the command reference.

**Deterministic work is code; judgement is the skill.** `ai/excel/` owns parsing, column
mapping, filtering, quality checks, traceability and reporting — call it via `npm run excel:*`
rather than reading `.xlsx` files directly. Reading business intent, choosing a Page Object,
writing the spec and deciding whether a failure is safe to heal belong to the skill.

```bash
npm run excel:run -- excel/login-test-cases.xlsx                  # workbook drives it, results written back
npm run excel:run -- <wb> --sheet "Create Project" --dry-run      # show the selection, run nothing
npm run excel:list -- <wb> --priority P0 --module Login
npm run excel:quality -- <wb>                                     # → ai/reports/test-case-quality-report.md
npm run excel:mapping -- sync|promote|review|unautomated
npm run excel:report -- <wb> --results test-results-excel/results.json [--in-place]
npm run excel:sync-data -- <wb>                                   # which rows run without a spec
npm run excel:dashboard                                           # http://moolyaautomationreport.com
npm run excel:allure && npm run excel:allure:open                 # needs Java
```

The skill itself is [.claude/skills/excel-automation/SKILL.md](.claude/skills/excel-automation/SKILL.md).

**`npm run excel:demo` is the one destructive command in the set.** It regenerates the demo
workbook and, with no `--out`, writes straight over `excel/login-test-cases.xlsx` — no backup,
no existence check, unlike every other write path here. It would discard authored rows and
every result written back. Pass `--out <path>` unless recreating the demo from scratch is
exactly the intent.

`ai/dashboard/` is a localhost-only control panel: pick cases, pick browser / workers / headed /
capture, run, read per-case results with links to their screenshot, video and trace. It spawns
processes from browser input, so three rules are load-bearing — bound to `127.0.0.1` with no
host option, every child spawned with an argv array and `shell: false`, and every field
validated against the workbook rather than sanitised. It also refuses to attribute a stale
`results.json` to a run that produced none; a crashed run reports zero results, never the
previous run's.

`ai/dashboard/authoring.ts` is the only place a UI writes an *authored* column. It handles
data-driven rows **only** — a spec-backed case gets no edit affordance, because editing its
wording cannot change what the spec asserts. Drafts are validated with the runner's own parser
before the workbook is opened, so an invalid contract never reaches the file; backup first,
match by ID read back from disk, write only the form's own fields.

It also creates worksheets and generates Test Case IDs. The ID prefix is **learned from existing
rows** (sheet first, then module) and only derived from the name when there is nothing to learn
from — no rule would ever guess `TC_PROJ_` from a sheet called "Create Project". The number is
`max + 1` for that prefix **across the whole workbook**, not the lowest unused one: two sheets
share `TC_LOGIN_`, and a gap is usually a reserved ID. Generation happens server-side after the
final re-parse, so concurrent tabs cannot collide.

`ai/dashboard/generation-history.ts` keeps the **latest FIVE generation runs and no more**
(`ai/dashboard/generations/`, git-ignored). Pruning happens on WRITE, not on read - a reader
that trimmed to five would make a pruning failure invisible - and the ids are fixed-width ISO
timestamps plus a random tail, so lexicographic order is chronological order and two runs
starting in the same millisecond stay distinct. Each record holds the captured log, the
per-case verdicts and the **per-element Page Object decisions** for that generation, joined
from `ai/reports/page-object-lifecycle.jsonl` by the runId, which `ai/autocode/cli.ts` now
prints on a stable line. Deliberately separate from `ai/dashboard/runs/`, which stores
EXECUTION runs, is unbounded, and is untouched.

The friendly hostname is a hosts-file entry mapping the name to `127.0.0.1`, plus listening on
port 80 — not DNS and not a deployment. The server still binds loopback only. Unmapped, it
prints the elevated one-liner and serves `http://127.0.0.1`; `EXCEL_DASHBOARD_HOST` and
`EXCEL_DASHBOARD_PORT` override both, and port 80 being taken falls back to 4321 with a message.

Each run keeps its own copy of both its artefacts (`runs/<id>/evidence/`) and Playwright's HTML
report (`runs/<id>/playwright-report/`), because Playwright wipes `outputDir` and rewrites
`reports/playwright-html/` on every run — without the copies, "past executions" would link to
files the next run had already destroyed, which is wrong exactly when an old failure is what you
came back for. Roughly 3 MB per run with traces on; the directory is git-ignored and safe to
delete. Capture modes come from `EXCEL_SCREENSHOT` / `EXCEL_VIDEO` / `EXCEL_TRACE`, which
default to the previous failure-only behaviour when unset.

Firefox and WebKit are gated behind `EXCEL_ALL_BROWSERS=1` in `playwright.excel.config.ts`, so
the default `excel:test` stays Chromium-only instead of tripling every run against a live app.

Pipeline: `workbook → parser.ts → filter → quality.ts → [agent writes spec] → mapping.ts →
playwright → results.ts (root-cause classification) → execution-report.ts + html-report.ts →
writeback.ts`

### Data-driven rows: cases that execute with no spec written

A sheet with an **`Assert Outcome`** column (`Signed In` / `Error` / `Blocked`) declares its own
assertions, and `Test Data` names its inputs (`email = <registered-email>`, one per line, with
`<blank>` / `<valid-password>` / `<invalid-password>` / `<email:N>` / `<chars:N>` resolved at run
time so secrets stay out of the spreadsheet). Those rows become tests without anyone writing
code — see the `Login Validation` sheet and `tests-e2e/login/login-validation.spec.ts`.

Three things that are easy to get wrong here:

- **`globalSetup` rebuilds the cache before Playwright collects tests** (verified on
  1.63.0-alpha, and the whole design depends on that order). The runner reads
  `ai/test-data/<workbook>.data-driven.json` synchronously, because collection cannot await.
- **`excel:run` registers data-driven rows in `mapping.json` itself**, before deciding what can
  run. `scanSpecs` cannot find them — their titles are built at run time and appear in no source
  file — so a runner declares `// @data-driven-module: <Module>` and gets paired with the rows by
  module. Without that registration they would look unautomated and never execute.
- **`tests-e2e/generic/generic.spec.ts` is marked `@data-driven-module: *`** and serves every
  module without a runner of its own, so a case for a brand-new module runs with no code written.
  `runnerFor()` in `mapping.ts` resolves exact-match first, wildcard second — give a module its
  own runner later and its rows move across automatically. The row supplies `url`, `scope` and
  `submit` in `Test Data`; fields are found by their human name. The submit control is searched
  for **inside the form the fields were found in** — a page-wide search pressed Bugasura's
  "Sign in with Google" button.
- **A blank `Assert Outcome` means "not data-driven"; an unreadable one fails the run.** Never
  infer the contract from prose, and never downgrade a broken contract to a skip.

  Blank is a real answer, not a missing one, and the dashboard form accepts it: it is the switch
  between the two ways a row can carry its assertion. **Filled** — the dropdown *is* the
  assertion, the row runs straight from the spreadsheet, and `Test Data` must parse as
  `name = value`. **Blank** — the assertion lives in a spec, `Test Data` is prose for whoever
  writes it, and autocode writes it. The form used to reject blank and default a loaded row to
  `Blocked`, which silently converted spec-backed rows into data-driven ones on the next save.
  Only the credential check spans both modes: a literal password is a leaked password whichever
  mode the row is in.
- **`Visible` requires an `expect` list, and a credential-shaped input must use a token.** Both
  are refused at save time. `Signed In` alone on a "check the menus" case is a green test that
  checked nothing; a literal password in a workbook is a leaked password.
- **The outcome must be able to witness the Expected Result** (`ai/excel/intent.ts`). When the
  Expected Result claims something is *on the screen* — "Check My Favourites is displayed" —
  only `Error` (it reads the message) or `Visible` (it reads the named items) can prove it.
  `Signed In` proves the page moved on and `Blocked` proves nothing appeared, so either one
  paired with a presence claim is a test that passes having looked at nothing. This is the one
  failure the rest of the checks cannot catch, because the row runs, goes green, and is counted
  as coverage.

- **The Steps must not ask for actions the runner does not perform** (`unsupportedActions`).
  A shared runner opens a page, fills the named fields and presses **one** control. A row whose
  steps say "Click My Favourites, wait, check the header" declares work that never happens, and
  `Visible` then finds those words in the navigation that was on screen *before* the click. The
  assertion is honest; it is asserting against the wrong screen — which no amount of matching the
  outcome to the Expected Result can detect, because both agree. Checked for every outcome and
  refused with no repair possible: the missing work is a click, and nothing can invent one. The
  row's actions are the point of the case, so it belongs in a spec — clearing Assert Outcome is
  the fix, and the dashboard applies exactly that (nothing is lost; in spec mode `Test Data`
  stays on the row as notes for the generator).

  Tuned against the whole workbook rather than reasoned about: every declared-outcome row still
  passes, and the only one flagged is the one that was lying. `delete`, `add` and `edit` are
  deliberately absent from the submit-word list — treating a mid-flow action as the submit is
  what would let these rows through.

  Three surfaces, three different responses, deliberately. **The dashboard repairs it** — a
  `Signed In` row becomes `Visible` with an `expect` line built from the item names the author
  already wrote, reported back on the page and never applied silently. **The cache rejects it**
  (the row fails loudly) rather than repairing, because a repair there would leave the
  spreadsheet saying one thing and the run asserting another. **The quality report names it**
  so an existing workbook surfaces the row before anyone runs it. Nothing anywhere invents an
  assertion: "all should be visible" names nothing a browser can look for, so it is refused,
  not guessed. `expect = All` derived from the word "all" would swap a green lie for a red one.

The runner owns the actions, the workbook owns data and assertion. A case whose *actions* differ
needs a real spec — forcing it into the contract turns the runner into a second, worse framework.

### The ai/ subsystem: recording, autocode, page knowledge

How the dashboard recorder, the deterministic recorded-test mapper, the falsification gate,
the generator's prompt, page knowledge and the shared browser session work — and the many
ways each of them has been got wrong — is in [ai/CLAUDE.md](ai/CLAUDE.md), which loads
automatically whenever Claude touches a file under `ai/`.

### The authoring model (P1)

A row carries three kinds of information, and conflating them is what made one status word
mean six things:

- **Business** — Test Case ID, Title/Scenario, Description, Requirement ID, Module, Feature,
  Test Type, Priority, Business Risk, Tags, Test Owner.
- **Execution context** — Environment, User Role, **Authentication Profile**. The profile is a
  NAME (`BUGASURA_QA_USER`), never an account: values live in the environment, and `validateDraft`
  refuses an address, a space or a lower-case value in that field.
- **System-managed** — Automation Status, execution results, spec path, attempts, fingerprints,
  recording artefacts. The form displays them read-only and the writer has no column for them.

Every P1 field is **optional and additive**: a workbook written before them has no such column,
reads as empty, and behaves exactly as it did. `columnFor()` creates a column when the sheet
lacks one, so there is no migration and no schema version.

**Two headings changed meaning**, because both were being read as something they are not:
`Type`/`Test Type` used to bind to Tags and now binds to Test Type; `Criticality` used to bind
to Priority and now binds to Business Risk. Priority says *when it runs*, risk says *what it
costs*. A workbook using either heading is reported once per sheet as `HEADING_REBOUND` — a
warning, never an error, and no cell is touched.

**`ai/excel/readiness.ts` answers one question and refuses the others**: is this row authored
well enough to build from? Not "is it eligible" (`work.ts`), not "is it automated" (the gate),
not "did it pass" (the reporter). `assessReadiness` returns `READY` or blocking codes
(`MISSING_EXPECTED_RESULT`, `PLACEHOLDER_EXPECTED_RESULT`, `INVALID_AUTH_PROFILE`,
`CREDENTIAL_IN_AUTHORED_FIELD`, `RECORDED_CASE_NEEDS_RERECORD`…) plus advisory ones that never
block. A credential typed into ANY authored field is refused, not just Test Data.

**Editing a recorded case never touches its artefacts.** `ai/dashboard/case-status.ts` keeps a
bookkeeping sidecar (`<ID>.authoring.json`) recording what the row said when the recording was
saved. Change the steps, expected result, preconditions, test data, environment, user role or
authentication profile and the recording is marked **stale**: generation is refused with the
reason and the choice — re-record, or undo the edit — is put to a person. Change the title,
description, requirement, priority, risk, tags or owner and the recording still stands. A
recording made before this bookkeeping existed reports *unknown*, never stale.

### Selection

A workbook may carry a **`Run`** column (`Yes`/`No`); one sheet per module is the normal layout.
Filters (`--sheet --module --feature --priority --tag --status --id`) and the Run column are
**ANDed** — `--sheet "Create Project"` excludes Login rows even when they say `Yes`. A blank Run
cell means "no opinion", never "no". `--all` ignores the column; `--dry-run` prints the
selection and why everything else was excluded.

### CI

`.github/workflows/excel-suite.yml`, kept apart from `ci.yml` for the same reason the configs
are kept apart: a Bugasura outage must never block a Playwright roll. Two jobs:

- **`workbook`** — no browser, no credentials, no network; the only job a fork can run.
  `excel:sync-data --strict` **fails the build** on an unreadable data-driven contract;
  `excel:quality` only reports, because ambiguous rows are findings for the workbook's author
  and the workbook is expected to carry some at any time.
- **`suite`** — schedule (06:30 UTC weekdays) and `workflow_dispatch` only, never on push.
  It asserts the credentials are present first: without them every authenticated case skips
  with a reason, and a suite of skips reports green. Runs with `--no-in-place`, because CI must
  not write results into the git-tracked workbook, and deliberately leaves
  `BUGASURA_ALLOW_DATA_MUTATION` unset so a nightly job cannot litter a real team's board.
  A `concurrency` group serialises runs — two at once is exactly the concurrent navigation
  Bugasura refuses.

### Invariants that break things silently if violated

- **Authored columns are never written.** Results *are* written back into the source workbook
  on `excel:run` / `report --in-place`, but only to result columns, always after a timestamped
  backup to `excel/.backups/`, and matched by Test Case ID read back from the file rather than
  by remembered row position.
- **A filtered run must only write the rows it covered** (`onlyTestCaseIds`). Writing every row
  blanks out other sheets' results, because a case with no execution record reads as `Not Run`.
- **Test titles are the traceability key.** Every generated test is `TC_ID - Scenario` and calls
  `trace({...})`. `mapping sync` scans specs for that pattern and `results.ts` extracts the ID
  from the title — rename carelessly and it silently detaches from its workbook row.
- **`Automated` is earned by a green run** via `mapping promote`, never hand-edited.
- **Ambiguous test cases get flagged, never guessed** — `mapping review <ID> --reason "..."`.
  Entries with no `testFile` survive `sync` so the decision persists.
- **Healing is bounded to pre-declared candidates for the same element**
  (`tests-e2e/support/resilient-locator.ts`). An assertion mismatch is a finding about the
  application, not something to heal.
- **Each workbook gets its own report** (`reports/<workbook>-execution-report.*`). A shared path
  means running one workbook invalidates the hyperlinks the other wrote into its spreadsheet.
- **Excel locks an open workbook.** Write-back checks first and reports it plainly; `--dry-run`
  and `--no-in-place` work with the file open.

### Bugasura facts

Cost hours once; do not rediscover them:

- Sign-in, sign-up and reset forms are **all mounted simultaneously** (`#loginForm`,
  `#createUserForm`, `#resetForm`). Scope every login locator to `#loginForm`, and filter
  `:visible` — the hidden sign-up password field means an unfiltered count never reaches zero,
  so an "am I signed in?" check can never return true.
- Login errors are a toast in `#toast-container .toast-message`, auto-dismissing in ~5s. Poll;
  do not sleep then read.
- Create Project errors are **inline** `label.error`, not toasts: `Team is not selected.` and
  `Project name cannot be empty.`. Team is checked first and masks the name error. Invalid
  submits fire **no request at all** — blocked client-side, so validation tests create nothing.
- After sign-in the app navigates itself to `/apps`. Calling `goto()` while that is in flight
  aborts it (`net::ERR_ABORTED`) — wait for the redirect instead.
- **`/apps` is clickable before it is functional, and waiting for the redirect is not enough.**
  The project cards are streamed in while the document is still parsing — present, visible,
  stable and hit-testable ~1.35 s after sign-in — but their click handler is bound later, by the
  application's own ready block (~2.3 s). A click in that gap passes every actionability check,
  is reported as successful, and does nothing: the browser simply stays on `/apps`. Measured
  6 failures in 9 runs, all with the click issued at 1144–1604 ms; every click after 2125 ms
  worked. That one gap quarantined eight recordings, each blamed on a different locator.
  `ProjectsPage.open()` now waits for `load` and then for `#all_apps [data-original-title]` —
  the tooltip initialisation the app performs in the same ready block that binds the click,
  measured flipping in the same 100 ms sample. It is the only DOM-visible witness this screen
  offers; no class, no `data-initialized` and no framework upgrade marker moves at that moment.
- `my.bugasura.io` returns `ERR_EMPTY_RESPONSE` on concurrent navigation from one host, so the
  suite defaults to one worker (`EXCEL_WORKERS` overrides).
- Neither the email nor the project-name field declares a `maxlength`; the email limit (250) is
  enforced server-side only.
- The `/apps` tab strip (`.dashboard-tab-options`) holds **My Favourites, All, Team Projects,
  Following**, and every one of those labels is in the DOM at all times. "Is My Favourites on the
  page?" is therefore true before anything is clicked — which is how a `Visible` row for
  TC_DASHBOARD_001 passed in 80 ms having clicked nothing. The element that moves is the section
  heading (`h2`): **`All Projects` on arrival**, the tab's name after it is selected, and the tab
  gains `class="active"`. Assert on the heading; the tab label witnesses nothing.

Credentials come from the git-ignored `.env` (see `.env.example`); the account is the
**@moolya.com** address. Tests that write to the live workspace are gated behind
`BUGASURA_ALLOW_DATA_MUTATION=1` plus `BUGASURA_TEAM`, because nothing deletes what they create.


## Session Handoff

**START HERE, every session.** The repository is the source of truth, not any
conversation. This project is worked on across sessions and across Claude
accounts, so nothing important may live only in a reply or in reasoning.

Before changing anything:

1. Read the `status_version` YAML block at the top of
   [docs/history/REMAINING.md](docs/history/REMAINING.md). It lists every
   architectural phase, where it lives, which fixture pins it, the blockers,
   the open cases and the exact next action.
2. **Verify before trusting it.** A phase marked `DONE` is a claim; run its
   fixture and read the named file. A previous session's statement is not
   evidence — the code, the fixtures and a green regression are.
3. Continue from the first phase that is genuinely incomplete. Do **not**
   restart work, and do **not** revert a previous session's changes merely
   because you did not make them.

If you must stop before the work is complete, leave the repository buildable
and update that YAML block — never half-written production files, duplicate
implementations or disabled safety checks.

When a task is nearing completion, the context window is becoming limited,
or the user asks to hand off the work to another Claude session:

1. Update docs/history/REMAINING.md with:
   - completed work
   - current task
   - remaining work
   - blockers
   - important decisions
   - exact next action

2. Update CLAUDE.md only when permanent project knowledge or rules have changed.

3. Never claim work is completed unless it is actually reflected in the project files.
