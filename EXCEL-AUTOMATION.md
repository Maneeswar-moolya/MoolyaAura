# Excel Test Case Integration

Turn a spreadsheet of test cases into maintainable Playwright TypeScript automation, run it,
analyse what failed, and report results back as a separate Excel workbook.

**The source workbook is only written when you ask** (`excel:run`, or `report --in-place`), and
always after a timestamped backup. Otherwise everything is written to `reports/`.

Applications are registered through the dashboard. The repository starts with an empty registry.

## Layout

| Path | What it holds |
| --- | --- |
| `excel/` | Input workbooks. Read-only by contract. |
| `ai/excel/` | The toolkit: parser, column mapper, quality analyzer, mapping store, report writer. |
| `ai/test-mapping/mapping.json` | Traceability: Test Case ID → spec file, test name, module, source row, status. Committed. |
| `ai/reports/` | Generated quality report and healing log. Git-ignored. |
| `tests-e2e/` | Fixtures, Page Objects and generated specs. |
|  `reports/<workbook>-execution-report.xlsx` | The execution report. Git-ignored. |
|  `reports/<workbook>-execution-report.html` | Same report, readable in a browser. Written by the same run. Git-ignored. |
| `reports/allure` | Allure dashboard — trends, severity, module grouping. Needs Java. Git-ignored. |
| `.claude/skills/excel-automation/` | The agent workflow for the natural-language commands. |

`tests-e2e/` is kept separate from the repository's own `tests/`, and
`playwright.excel.config.ts` separate from `playwright.config.ts`, so that `npm test` and the
Playwright roll workflow stay independent of application availability.

## Commands

```bash

npm run excel:list     -- excel/<applicationId>-test-cases.xlsx --priority P0 --module Login
npm run excel:quality  -- excel/<applicationId>-test-cases.xlsx
npm run excel:sync-data -- excel/<applicationId>-test-cases.xlsx   # which rows run without a spec
npm run excel:mapping  -- sync --workbook excel/<applicationId>-test-cases.xlsx
npm run excel:test
npm run excel:mapping  -- promote --results test-results-excel/results.json
npm run excel:report   -- excel/<applicationId>-test-cases.xlsx --results test-results-excel/results.json
```

## Driving everything from the spreadsheet

One command runs the cases the workbook selects and writes the results back into that same
workbook:

```bash
npm run excel:run -- excel/<applicationId>-test-cases.xlsx
```

Add a **`Run`** column to the sheet (`Yes`/`No`). Only rows marked `Yes` execute. Without that
column the usual `--module` / `--priority` / `--id` filters apply instead; `--all` ignores the
column when it exists.

A blank Run cell means "no opinion", not "no" — an unfilled cell never silently excludes a case.

### Running one sheet, or one module, or one case

A workbook is usually one sheet per module, so the sheet is the natural unit of work:

```bash
npm run excel:run -- excel/<applicationId>-test-cases.xlsx --sheet "Create Project"
npm run excel:run -- excel/<applicationId>-test-cases.xlsx --sheet "Login Validation" --priority P0
npm run excel:run -- excel/<applicationId>-test-cases.xlsx --id TC_LOGIN_014
npm run excel:run -- excel/<applicationId>-test-cases.xlsx --module Login --tag negative
```

Every filter — `--sheet --module --feature --priority --tag --status --id` — is repeatable or
comma-separated, and each one **ANDs with the Run column**. That is the part worth remembering:

> `--sheet "Create Project"` runs **only** that sheet, even though the Login sheet is full of
> `Yes`. A row must satisfy the filters *and* be marked to run.

Two consequences that prevent nasty surprises:

- **A filtered run only writes the rows it covered.** Running one sheet leaves every other
  sheet's results exactly as they were. Without this, cases with no execution record in this run
  would read as `Not Run` and blank out results the other sheets had already earned.
- **`--all` ignores the Run column** but still honours the filters, which is how you re-run a
  whole sheet without editing twelve cells back to `Yes`.

Not sure what a command will pick up? Ask first — nothing runs and the workbook is not touched:

```bash
npm run excel:run -- excel/<applicationId>-test-cases.xlsx --sheet "Create Project" --dry-run
```

It lists what would run and, underneath, everything excluded with the reason — `Run=No` or
`filtered out`. Use it whenever a run covers more or fewer cases than you expected.

`npm run excel:list` takes the same filters, so you can inspect a selection without going near
the runner.

The command then updates these columns in the same file, creating any that are missing and
leaving every authored column untouched:

`Automation Status` · `Execution Status` · `Duration (s)` · `Failure Reason` · `Root Cause` ·
`Healing Performed` · `Final Status` · `Test File` · `Last Execution Time` · `Report` ·
`Evidence`

The last two are clickable from the spreadsheet:

| Column | Opens |
| --- | --- |
| **Report** | The HTML report scrolled to that exact test case (`…-execution-report.html#TC_ID`) |
| **Evidence** | The Playwright report — trace, screenshot and video. Blank for cases that never ran |

Links are written **relative** to the workbook, so the repo can be cloned anywhere and they
still resolve. Each workbook gets its own report — `reports/<workbook-name>-execution-report.*`
— so running a second workbook cannot invalidate the first one's links.

**Close the workbook in Excel first.** Excel holds an exclusive lock on an open file, so the
write-back cannot proceed; the command detects this and tells you rather than failing
obscurely. To keep it open, use `--no-in-place` and read `reports/` instead.

**Every in-place write is preceded by a timestamped backup** in `excel/.backups/`. No backup,
no write.

## The run dashboard

```bash
npm run excel:dashboard        # then open http://moolyaautomationreport.com
```

A local control panel for runs that have not happened yet — as opposed to the HTML execution
report, which is a record of one that already did. Pick test cases from the workbook, choose how
they run, watch the output live, and read the per-case result.

| Control | Notes |
| --- | --- |
| **Test case picker** | Grouped by worksheet, filterable by sheet, priority, free text, and the workbook's **Run** column (all · Yes · No · blank). Cases with no automation are greyed out |
| **Select all** | The header checkbox selects every visible case; each worksheet has its own checkbox for that sheet alone. Both act on what the filters currently show, and go half-ticked when only part of the group is selected |
| **Browser** | Chromium, Firefox or WebKit |
| **Parallel workers** | 1–8. Choose concurrency appropriate to the selected environment |
| **Headed / headless** | Headed opens a visible browser so you can watch |
| **Screenshot / Video / Trace** | Never · On failure · Always, chosen per execution |
| **Write into workbook** | Off by default. On, results are written back after a timestamped backup |
| **Results** | Per-case status, duration, root cause and links to that case's screenshot, video and trace |
| **Upload** | Drop an `.xlsx` in from the header. It lands in `excel/`, is parsed immediately, and is selected — an existing file of the same name is backed up first |
| **Add / edit a case** | Author a data-driven row from the page — new sheets and modules included, with the Test Case ID generated for you. `edit` on any data-driven row loads it back into the form |
| **Playwright report** | The standard HTML report, kept per execution — linked from the results header and from every past run |
| **Past executions** | The last 50 runs with the configuration each used. Click one to bring back its output, its results, its evidence and its report |

The page is light-themed regardless of your OS setting.

### Capture, and why past evidence still exists

Capture defaults to failures only. Set any of the three to **Always** to record a passing run —
useful when a case is suspicious rather than broken, and expensive if left on for a whole suite.
The equivalent outside the dashboard is `EXCEL_SCREENSHOT` / `EXCEL_VIDEO` / `EXCEL_TRACE`, read
by `playwright.excel.config.ts`; unset, capture behaves exactly as it always has.

**Playwright wipes `test-results-excel/` at the start of every run, and rewrites
`reports/playwright-html/` on every run too**, so an earlier execution's screenshots and its HTML
report are gone the moment the next one begins. Past results are only worth showing if you can
still open their evidence, so each run keeps its own copy:

```
ai/dashboard/runs/<run-id>.json                    results + captured output
ai/dashboard/runs/<run-id>/evidence/               screenshots, video, traces
ai/dashboard/runs/<run-id>/playwright-report/      that run's HTML report
```

The report is served at `/api/runs/<run-id>/report/`, so links from old executions keep
working — including the bundled trace viewer.

That directory is git-ignored and grows with every recorded run: roughly **3 MB per run** with
traces on, far less without. Delete `ai/dashboard/runs/` whenever you want the space back; the
dashboard simply shows no past executions.

Traces download rather than open; view one with `npx playwright show-trace <file>`.

Firefox and WebKit are opt-in Playwright projects (`EXCEL_ALL_BROWSERS=1`, set automatically by
the dashboard), so a plain `excel:test` still runs Chromium only and never triples the suite
against a live product. Install them once before selecting them:

```bash
npx playwright install firefox webkit
```

### Authoring from the dashboard

The form writes a **data-driven row** into the workbook, so a case added there is runnable
immediately — no spec, no `mapping sync`, no agent.

**New sheets and modules.** Pick `+ New sheet…` and type a name: the worksheet is created with
the full column set in place, so the very first row written to it already parses. The Module
field suggests names already in the workbook, so a new case joins `Login` rather than inventing
`login ` beside it. Excel's own naming rules (31 characters, no `: \ / ? * [ ]`) are enforced.

**Test Case IDs generate themselves.** Leave the ID blank and the next one appears, with a note
saying where it came from. Two rules decide it:

| The target | ID you get | Why |
| --- | --- | --- |
| A sheet that already has rows | continues that sheet's prefix — `Create Project` → `TC_PROJ_009` | The prefix is *learned*, never derived. No rule would guess `TC_PROJ_` from "Create Project" |
| A new sheet in a known module | continues the module's prefix — `Login` → `TC_LOGIN_017` | A module's numbering should not restart because a sheet did |
| A new sheet and a new module | derived — `Customer` → `TC_CUSTOMER_001` | Only when there is nothing to learn from |

The number is **the highest for that prefix anywhere in the workbook, plus one** — never the
lowest unused one. Two reasons: `Login Test Cases` and `Login Validation` share `TC_LOGIN_`, so a
per-sheet maximum would collide; and a gap is usually a deliberately reserved ID (as
`TC_LOGIN_008`/`009` are here), not an invitation to reuse it.

Type your own ID and the suggestion stops overriding it; clear the field and it comes back. The
ID that is actually written is generated **server-side at save time**, after the final re-parse,
so two browser tabs cannot be handed the same number.

Four rules make all of this safe:

- **Only data-driven rows are editable.** A case backed by a hand-written spec has no `edit`
  link, because changing its wording could not change what the spec asserts; the two would
  silently disagree, which is worse than not offering the button.
- **The contract is validated before the workbook is opened**, by the same parser the runner
  uses. A misspelt `<registred-email>`, an unknown outcome, a broken regex or a duplicate ID is
  rejected with the problems listed — and nothing is written.
- **Timestamped backup first**, into `excel/.backups/`, exactly as every other write-back.
- **Only the form's own fields are written.** Every other cell and row is rewritten untouched,
  and rows are matched by Test Case ID read back from the file, never by remembered position.

Close the workbook in Excel before saving — an open file is locked, and the dashboard says so
without changing anything.

### What it cannot do: turn prose into a new spec

A case whose *actions* are new — a different screen, a different flow — still needs a Playwright
spec, and writing one means reading the application and deciding what to assert. That is
judgement, not a form, and nothing in `ai/dashboard/` attempts it. The dashboard covers the
family-shaped cases; anything else goes through the workflow in
[FRAMEWORK-GUIDE.md](FRAMEWORK-GUIDE.md) §3.

### What it is not

It is a **developer tool bound to `127.0.0.1`**, not a service. It starts processes on your
machine, so it must never be exposed to a network — there is deliberately no `--host` option.
Requests are validated rather than sanitised: a test case ID that is not in the workbook, an
unknown browser, or a workbook path outside the repository is rejected with a `400`. Every child
process is spawned with an argv array and `shell: false`, so nothing from the page is ever
interpreted by a shell.

One run at a time, by design: Playwright wipes its output directory at the start of every run,
so two concurrent runs would destroy each other's results.

### The friendly URL

The dashboard listens on **port 80**, so the address carries no `:1234`. The name itself is a
one-time, machine-local mapping — run once in an **Administrator** PowerShell, because editing
the hosts file needs elevation:

```powershell
Add-Content -Path $env:SystemRoot\System32\drivers\etc\hosts -Value "127.0.0.1 moolyaautomationreport.com"
```

Until that entry exists the dashboard prints the command and serves on `http://127.0.0.1`
instead — it never fails just because the name is unmapped.

This resolves **on that machine only**. It is not DNS, nothing is registered, and no colleague
can reach it: the server still binds `127.0.0.1` and has no option to do otherwise. A teammate
who wants the dashboard runs it on their own machine.

One caveat worth a thought: `moolyaautomationreport.com` is a real, registrable `.com`. If
anyone ever registers it, machines with this entry will silently reach your local server instead
of the real site. A reserved TLD avoids that permanently — `.test` can never be registered
(RFC 2606):

```bash
EXCEL_DASHBOARD_HOST=moolya-automation.test npm run excel:dashboard
```

`EXCEL_DASHBOARD_HOST` sets the name; `EXCEL_DASHBOARD_PORT` sets the port. If port 80 is taken
or refused, the dashboard says so and falls back to 4321 rather than failing.

## Data-driven rows — test cases that need no spec written

Most test cases need someone to read the intent and write automation. A *family* of cases does
not: rows that differ only in their input and their expected outcome. For those, the workbook
can carry the contract itself, and **adding a row is the only step** — no code, no agent, no
`mapping sync`.

Add two columns to the sheet:

| Column | Values | Meaning |
| --- | --- | --- |
| **Assert Outcome** | `Signed In` | The action succeeded and the app moved on |
| | `Error` | The app rejected it and said so — a toast or banner |
| | `Blocked` | The form refused it client-side; no message, no navigation |
| | `Visible` | It succeeded **and** every item in `expect` is on the resulting page |
| **Assert Message** | text, or `/regex/` | What the rejection must say. Only with `Error`; blank means "any message" |

`Signed In` only proves the door opened. A case about what should be on the far side of it —
menus, tabs, headings — needs `Visible`, which requires an `expect` line and is rejected without
one. A row that signs in and checks nothing is a green test proving nothing:

```
url      = /
email    = <registered-email>
password = <valid-password>
expect   = My Favourites, All, Team Projects, Following
```

Each item is looked for as a link, button, menu item, or finally any visible text with that
name. **Short or common words make weak assertions** — `All` will match any visible text
containing "all". Prefer the full label where you can.

`Test Data` then names the inputs, one `name = value` per line:

```
email = <registered-email>
password = <invalid-password>
```

Secrets and awkward values are **named, not typed into the spreadsheet**:

| Token | Resolves to |
| --- | --- |
| `<blank>` | the empty string |
| `<registered-email>` | `APPLICATION_EMAIL` |
| `<valid-password>` | `APPLICATION_PASSWORD` |
| `<invalid-password>` | a deliberately wrong password |
| `<email:250>` | a well-formed address of exactly 250 characters |
| `<chars:300>` | 300 repeated characters |

A row that needs a credential the environment does not have **skips with a reason**, exactly as
the hand-written specs do.

**Typing a real password into the workbook is rejected.** Any input whose name looks like a
credential (`password`, `secret`, `token`, `pwd`) must use a token — a spreadsheet gets shared,
committed and backed up, and a literal in one is a leaked credential in all three.

See the `Login Validation` sheet for a worked example — seven cases, no spec written for any of
them. Inspect what a workbook declares with:

```bash
npm run excel:sync-data -- excel/<applicationId>-test-cases.xlsx
```

### What this deliberately does not do

- **It never infers the contract from prose.** A blank `Assert Outcome` means "not data-driven";
  the row waits for a hand-written spec. Guessing an assertion from "verify it works correctly"
  would produce green coverage that proves nothing.
- **A non-blank contract that cannot be read fails the run**, loudly, naming the sheet and row.
  It is never skipped — silently dropping a row the author believed was running is the worst
  outcome available.
- **`Assert Message` cannot express a negative** ("must *not* mention length"). A case that needs
  one still needs a spec.
- **The runner owns the actions.** `tests-e2e/login/login-validation.spec.ts` opens the sign-in
  page, fills the named fields and submits. A case with different actions — Forgot Password,
  a probe that reads a DOM attribute — needs its own spec in `login.spec.ts`. The `Steps` column
  stays authoritative for humans but does **not** drive execution here; keep the two in agreement.

### Any module, no spec: the generic runner

`tests-e2e/generic/generic.spec.ts` is marked `@data-driven-module: *` and picks up **every**
module that has no runner of its own. A case added for a module nobody has written code for is
runnable the moment it is saved.

It works because a row can supply the three things a per-module spec would hard-code. Put them
in `Test Data` alongside the fields:

| Reserved input | Meaning | Default |
| --- | --- | --- |
| `url` | Where to start, relative or absolute | `APPLICATION_BASE_URL` |
| `scope` | A CSS selector confining the search to one form | the whole page |
| `submit` | The control to press, by its visible text | the form's own submit button |

Everything else is a field to fill, **found by the name a person would call it** — accessible
role first, then label, placeholder, and finally `name`/`id` matching. So:

```
url    = /
email  = <registered-email>
password = <blank>
```

is enough for a module that has never been coded.

The submit control is searched for **inside the form the fields were found in**, not across the
page. That distinction is not cosmetic: applications may mount multiple forms together, and
a page-wide button search pressed "Sign in with Google" instead.

**Precedence:** a module with its own runner keeps it. `Login` rows go to
`login-validation.spec.ts`, which knows the screen and can assert things a generic driver
cannot; everything else falls through to the wildcard. Give a module its own runner later and
its rows move automatically, with nothing to update.

**The honest limit:** a control with no accessible name, no label and an opaque id cannot be
found generically. The failure says exactly which strategies were tried and suggests `scope`, a
rename, or a Page Object — it does not time out mysteriously.

### Adding a dedicated runner for a module

Worth it when the module needs assertions the generic driver cannot make. One file with a marker
comment naming the module — that is how `excel:run` pairs workbook rows with the runner, since
these tests have no titles in any source file for the scanner to find:

```ts
// @data-driven-module: Projects
```

Then loop over `loadDataDriven()` rows for that module, perform the module's actions, and assert
against `outcome` and `message`. Copy `login-validation.spec.ts`.

## Reports

`report` writes two editions of the same data: the `.xlsx` for handing on, and a
self-contained `.html` next to it for reading. Both are rendered from one set of rows, so they
cannot disagree. Use `--html <path>` to relocate the HTML, or `--no-html` to skip it. Add
`--in-place` to also merge results into the source workbook.

```bash
start reports/<applicationId>-test-cases-execution-report.html   # Windows
```

Filters accepted by `list` and `mapping unautomated`: `--module`, `--feature`, `--priority`,
`--tag`, `--status`, `--id`. Each is repeatable or comma-separated, and case-insensitive —
`--priority critical` selects rows stored as `P0`.

`npm run excel -- help` prints the full reference.

## Column mapping

Column headings do not have to match a fixed template. Headings are normalized (case,
punctuation and spacing are ignored) and matched against a synonym table, then fuzzily if no
synonym hits. A field is claimed by at most one column; ties go to the higher-confidence
heading and the loser is preserved as an extra column rather than silently overwriting data.

`TC ID`, `Test Case ID`, `Testcase#` → `testCaseId` · `Scenario`, `Test Scenario`, `Title` →
`scenario` · `Expected`, `Expected Result`, `Acceptance Criteria` → `expectedResult` ·
`Steps`, `Test Steps`, `Procedure` → `steps` · `Prio`, `Priority` → `priority`

Every decision is printed in the **Column interpretation** table of the quality report. Read
it before trusting a run on an unfamiliar workbook.

The parser also handles the usual real-world mess: a banner row above the header, sheets that
are prose rather than tables (skipped, with a reason), steps written as one arrow-separated
line, and rows with no Test Case ID (reported as malformed, never invented).

## Statuses

**Automation Status** — `Not Automated` → `Generated` → `Automated`, or `Needs Review`.
`Generated` means a spec exists; `Automated` is earned by `mapping promote` after the test
actually passes, and is revoked if it starts failing.

**Execution Status** — `Not Run`, `Passed`, `Failed`, `Skipped`, `Blocked`.

## Safety rules

These are enforced in code where possible and in the skill everywhere else:

- The parser opens workbooks read-only.
- The report writer refuses to write a report over a source workbook.
- Writing results **into** the source workbook happens only when asked
  (`excel:run`, or `report --in-place`), always after a timestamped backup, and only to the
  result columns listed above — authored columns are read and rewritten unchanged. Rows are
  matched by Test Case ID read back from the file, never by remembered position, so a workbook
  edited since the run cannot get results against the wrong case.
- Ambiguous test cases are flagged `Needs Review` with a recorded reason, never guessed at.
  `npm run excel:mapping -- review <ID> --reason "..."`
- Healing may only select a different **pre-declared candidate strategy for the same logical
  element**. It can never invent a selector, retarget a different element, or alter an
  assertion. An assertion mismatch is a finding about the application, not something to heal.

## Credentials

Declare credential variable names for the environment in the dashboard's Add Project form.
Supply their values through the shell or ignored `.env`; see `.env.example`. Application
selection determines the account, URL, workbooks and artifacts. No default project or
account ships with the repository. Mutating flows require that application's explicit opt-in.

## Onboarding

Run `npm run excel:dashboard`, choose **Add Project**, and provide a stable applicationId,
display name, environment and base URL. A validated project registration creates its workbook;
other scoped structures are available immediately and materialize on their first write.
Add cases, record intent and assertions, then generate and verify automation through the
existing lifecycle. Repeat for additional projects without framework source changes.
