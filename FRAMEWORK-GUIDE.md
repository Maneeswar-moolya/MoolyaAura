# Framework Guide — end to end

How the Excel-to-Playwright framework works, and how to use it day to day for
scripting, running, maintaining and extending.

Companion documents:
[EXCEL-AUTOMATION.md](EXCEL-AUTOMATION.md) is the command reference;
[CLAUDE.md](CLAUDE.md) is what the AI agent reads; this file is the walkthrough.

---

## 1. What the framework actually is

Three layers, deliberately separated. Knowing which layer owns a problem is most
of the skill in maintaining it.

| Layer | Lives in | Owns | Changes when |
| --- | --- | --- | --- |
| **Toolkit** (deterministic) | `ai/excel/*.ts` | Parsing, column mapping, filtering, quality checks, traceability, reporting | Rarely — it is application-agnostic |
| **Framework** (application) | `tests-e2e/` | Page Objects, fixtures, locators, specs | When a registered application's UI changes |
| **Dashboard** (control surface) | `ai/dashboard/` | Choosing what runs and how, authoring data-driven rows, keeping each execution's evidence | When the toolkit gains an option worth exposing |
| **Agent** (judgement) | `.claude/skills/excel-automation/` | Reading intent, choosing Page Objects, writing specs, deciding what is safe to heal | When conventions change |

The split matters: **anything that can be decided by a rule is code, anything
needing judgement is the skill.** A parser that guesses at ambiguity is a
liability; a human (or agent) that re-implements column mapping by hand is waste.

### The pipeline

```
excel/your-workbook.xlsx
  │
  ├─ parser.ts ........... finds the header row, maps columns, splits steps,
  │                        validates mandatory fields, reports malformed rows
  ├─ filter.ts ........... narrows to the working set (module/priority/tag/...)
  ├─ quality.ts .......... flags missing/ambiguous/duplicate cases
  │                        → ai/reports/test-case-quality-report.md
  │
  ├─ data-driven.ts ...... rows declaring "Assert Outcome" need no spec at all;
  │                        their contract is cached for the runner to read
  │                        → ai/test-data/<workbook>.data-driven.json
  │
  ├─ [ AGENT ] ........... everything else: reads intent, reuses Page Objects,
  │                        writes the spec
  │                        → tests-e2e/<module>/<module>.spec.ts
  │
  ├─ mapping.ts .......... links Test Case ID ⇄ spec file
  │                        → ai/test-mapping/mapping.json
  │
  ├─ playwright ......... runs the specs
  │                        → test-results-excel/results.json
  │
  ├─ results.ts .......... classifies each failure into a root cause
  ├─ execution-report.ts . joins workbook + mapping + results
  │                        → reports/<workbook>-execution-report.xlsx
  └─ html-report.ts ...... same rows, browser-readable edition
                           → reports/<workbook>-execution-report.html
```

**Authored columns are never written by automation.** Results *are* written back into the source
workbook by `excel:run` and `report --in-place`, into result columns only and always after a
timestamped backup to `excel/.backups/`. The one exception is the dashboard's authoring form,
where a person is deliberately editing their own data-driven row — same backup, same
ID-matching, and only the fields the form owns.

---

## 2. First-time setup

### Who needs what

| | **Test author / client** | **Engineer** |
| --- | --- | --- |
| Uses | The dashboard in a browser | The dashboard, the CLI, the code |
| Needs to understand | Recording, authoring, reading results | All of it |
| Installs | Node, dependencies, browsers, `.env` | The same |

A test author never needs to read TypeScript. Everything in §3 onward is for engineers;
the two Quick Starts in [README.md](README.md) are what an author actually needs.

### Prerequisites

| Tool | Required? | Version | Why |
| --- | --- | --- | --- |
| **Node.js** | **Required** | **>= 18** (`package.json` engines) | Runs everything |
| **npm** | **Required** | Ships with Node | Dependencies |
| **Git** | **Required** | any | Cloning |
| **Chromium** | **Required** | installed by Playwright | Recording and running |
| **Java** | *Optional* | 8+ | Only for `excel:allure` reports. Everything else works without it |
| **Firefox / WebKit** | *Optional* | — | Only behind `EXCEL_ALL_BROWSERS=1` |
| Python | **Not required** | — | Not used by the framework |

Windows note: commands are shown for a POSIX shell. In PowerShell, set a variable with
`$env:RECORDER_TRANSPORT='live'` before the command rather than prefixing it.

### Steps, from a clean machine

```bash
git clone <repository-url>
cd playwright-mcp

npm install                    # 1. dependencies
npx playwright install chromium # 2. the browser (Playwright will not work without this)
cp .env.example .env            # 3. credentials - then edit it
```

Edit `.env` and fill in the placeholders. **Use a dedicated QA account** — the suite makes
deliberate failed sign-in attempts, which can trip lockout on a personal account. `.env` is
git-ignored and must never be committed.

```bash
npm run excel:list -- excel/<applicationId>-test-cases.xlsx   # 4. verify, touching nothing
```

### Environment variables

Only the first two are needed to record and run. Everything else has a working default.

| Variable | Required | Purpose | Format | Where |
| --- | --- | --- | --- | --- |
| `APPLICATION_EMAIL` | **Yes** | The account tests sign in as | `<your-qa-email>` | `.env` |
| `APPLICATION_PASSWORD` | **Yes** for sign-in tests | Its password | `<your-password>` | `.env` |
| `RECORDER_TRANSPORT` | **For recording** | `live` enables DOM evidence + the assertion picker | `live` | command line |
| `APPLICATION_BASE_URL` | No | Override the application URL | URL | `.env` |
| `EXCEL_DASHBOARD_HOST` | No | Dashboard hostname (default `moolyaautomationreport.com`) | hostname | command line |
| `EXCEL_DASHBOARD_PORT` | No | Dashboard port (default `80`, falls back to `4321`) | number | command line |
| `EXCEL_WORKERS` | No | Parallel workers (default 1 — choose concurrency for the environment) | number | `.env` |
| `EXCEL_SCREENSHOT` / `EXCEL_VIDEO` / `EXCEL_TRACE` | No | Capture mode | `on` / `only-on-failure` / `off` | command line |
| `EXCEL_ALL_BROWSERS` | No | Adds Firefox and WebKit | `1` | command line |
| `APPLICATION_ALLOW_DATA_MUTATION` + `APPLICATION_TEAM` | No | Allows tests that create real data. **Both** required | `1` / team name | `.env` |
| `APPLICATION_EXPLORATION_PROFILE` / `_USER` | No | A separate account for the generator's browser | name / email | `.env` |
| `CLAUDE_CLI` | No | Only if `excel:autocode` cannot find Claude Code | path | `.env` |

Never put a real password in `.env.example`, a spec, a workbook or a report.

```bash
```

Verify the install without touching the application:

```bash
npm run excel:list -- excel/<applicationId>-test-cases.xlsx
```

You should see the workbook parse: the `Read Me` sheet skipped as prose, and one malformed row
reported (the Delete Project row, which has no Test Case ID). The case COUNT is deliberately not
quoted here - it grows every time somebody adds a row, and a number in a document is a number that
goes stale. What matters is that it parses, that `Read Me` is skipped rather than read as cases,
and that the malformed row is named rather than silently dropped.

To record a case in a browser instead of writing one, see
[RECORDING-GUIDE.md](RECORDING-GUIDE.md).

---

## 2b. Authoring from the dashboard

The second primary journey. Recording performs the test; authoring describes it and lets
the deterministic pipeline build it.

```bash
npm run excel:dashboard          # live transport not needed for authoring
```

1. **Select** a worksheet and a case, or press **Add** for a new one.
2. **Fill in** Title, Steps and Expected Result. Steps are prose; the pipeline reads them
   to decide what the case requires of the screen.
3. **Save.** The workbook row is written, after a timestamped backup to `excel/.backups/`.
   Nothing is written if the draft is invalid — the problems are listed instead.
4. **Generate:**

```bash
npm run excel:autocode -- excel/<applicationId>-test-cases.xlsx --ids TC_LOGIN_050
npm run excel:autocode -- excel/<applicationId>-test-cases.xlsx --dry-run   # what needs code, and why
```

5. **Run** it, and read the result in the dashboard.

### What the generator does with locators

In this order, and it never skips a step:

| Step | Outcome |
| --- | --- |
| An existing Page Object method describes the element | **REUSE** |
| An existing *parameterised* method matches | **REUSE_PARAMETERIZED** |
| A contextual locator was proven at the press | that locator is used |
| Nothing is proven | **NEEDS_REVIEW** — a person decides |

A generated spec is then run **twice** — once as written, once with its assertions broken.
It is kept only if it passes the first and *fails* the second. One that passes both ways is
asserting nothing, which is the failure that looks exactly like coverage; it goes to
`ai/autocode/quarantine/` and is never registered.

### Statuses you will see

| Status | Meaning |
| --- | --- |
| `Not Automated` | No spec yet |
| `Generated` | A spec exists and survived the falsification gate |
| `Automated` | Earned by a green run of the real suite (`excel:mapping promote`) — never hand-set |
| **Needs Review** | The evidence did not prove a safe locator, or ownership was ambiguous |
| Quarantined | The spec passed even with its assertions broken |

**Needs Review is a correct outcome, not a defect.** See
[ABSTRACTION-GUIDE.md](ABSTRACTION-GUIDE.md) §5 for what each refusal means.

### What happens to a locator no Page Object covers

```
Dashboard Recording
      ↓  press-time evidence (matchCount, identity, document, measuredAt)
Authoring (workbook row)
      ↓
Existing Page Object reuse            ← deterministic, no model
      ↓  by name, by proven locator, then by parameterised template
      ↓  nothing matched
Deterministic abstraction             ← classify · validate · name · parameterise
      ↓  PROPOSED                          ↓  NEEDS_REVIEW, semantic reason only
      │                            Semantic AI fallback   ← ONE question, closed answers
      │                                    ↓
      │                            Deterministic re-validation  ← every other rule, again
      └──────────────→ Page Object method ←┘
                             ↓
                       Knowledge YAML entry
                             ↓
                 future recordings REUSE it   ← deterministic, no model
```

Refusals are **coded**, and the code decides who may clear one. `SAFETY`
(no press-time proof, identity unproven, a generated id, `first()`/`nth()`, XPath, force,
coordinates, a sleep or a retry used as identity) is never clearable by anything.
`STRUCTURAL` is a fact — the value is not in the expression, the method already exists.
Only `SEMANTIC` may be put to a resolver, one question at a time, and only when no safety
refusal is present alongside it.

A `PROPOSED` line is written without a countersignature: reaching it means every gate
already passed. Everything that did **not** reach it is what needs a person.
[ABSTRACTION-GUIDE.md](ABSTRACTION-GUIDE.md) §3 is the full boundary.

---

## 2c. New team member — first day

```bash
git clone <repository-url> && cd playwright-mcp
npm install
npx playwright install chromium
cp .env.example .env                 # fill in the placeholders

npm run excel:list -- excel/<applicationId>-test-cases.xlsx     # workbook parses?
npx tsx ai/autocode/locator-safety.fixture.ts        # framework healthy? (offline)

RECORDER_TRANSPORT=live npm run excel:dashboard      # record something
npm run excel:test -- --grep TC_LOGIN_001            # run something
```

If all five succeed, the machine is ready. Nothing above needs an AI model, an API key or
network access beyond the application under test.

---

## 3. Scripting — automating a new test case

This is the core loop. Steps 3 and 6 are the ones people skip and later regret.

### Step 0 — Check whether the case needs a spec at all

Some cases run without anyone writing code. If the new case differs from an
existing family only in its **input** and its **expected outcome** — same actions,
different data — it can be declared in the spreadsheet instead:

```bash
grep -rl "@data-driven-module" tests-e2e/     # which modules have a runner
npm run excel:sync-data -- excel/your-workbook.xlsx
```

Fill in `Assert Outcome` (`Signed In` / `Error` / `Blocked`), optionally
`Assert Message`, and name the inputs in `Test Data` (`email = <blank>`). The row
is a running test on the next `excel:run` — no spec, no `mapping sync`, no agent.
See **Data-driven rows** in [EXCEL-AUTOMATION.md](EXCEL-AUTOMATION.md).

Everything else — different actions, a negative assertion, anything that reads
the DOM — goes through the steps below.

### Step 1 — Select the work

```bash
npm run excel:list -- excel/your-workbook.xlsx --priority P0 --module Login
```

A `!` in the first column means the row has a blocking defect and cannot be
automated as written. Do not start on those.

### Step 2 — Check quality before writing code

```bash
npm run excel:quality -- excel/your-workbook.xlsx
```

Open `ai/reports/test-case-quality-report.md` and read **Column interpretation**
first. If a column mapped to the wrong field, everything downstream is wrong and
no amount of good spec-writing will save it.

Then read **Recommended "Needs Review"**. Those get flagged, not automated:

```bash
npm run excel:mapping -- review TC_X_001 --reason "why it cannot be automated as written"
```

### Step 3 — Read the application before writing locators

Never invent a selector. Open the page and look:

```bash
npx playwright codegen https://app.example.com/
```

This is where most wasted effort comes from. Some applications mount several forms at
once, so a plausible-looking `input[type=password]` silently targets the hidden
sign-up field. Check what is actually there.

### Step 4 — Reuse, then extend

Read `tests-e2e/pages/` before creating anything. The rule is one Page Object per
screen:

- Locator missing from an existing screen → add a method to that Page Object.
- Entirely new screen → new Page Object extending `BasePage`.
- Never a second Page Object for a screen that already has one.

Declare every locator as **ordered candidate strategies**, accessible-name first:

```ts
emailField(): Promise<Locator> {
  return this.resolve('login.emailField', [
    { strategy: "#loginForm getByRole('textbox', { name: /email/i })",
      build: page => page.locator('#loginForm').getByRole('textbox', { name: /e-?mail/i }) },
    { strategy: '#loginForm input[type=email]',
      build: page => page.locator('#loginForm input[type="email"]') },
    { strategy: '#email_field', build: page => page.locator('#email_field') },
  ]);
}
```

The order *is* the healing policy. Candidate 1 is what should work; the rest are
what the framework is allowed to fall back to. Anything not in this list is not
an option, which is what keeps healing safe.

### Step 5 — Write the spec

Two non-negotiables: the title format and `trace()`.

```ts
test('TC_LOGIN_001 - Valid Login', async ({ loginPage, workspacePage, appCredentials }) => {
  trace({ ...SOURCE, testCaseId: 'TC_LOGIN_001', scenario: 'Valid Login', priority: 'P0' });
  requireCredentials(appCredentials);

  await loginPage.open();
  await loginPage.signIn(appCredentials.email, appCredentials.password);

  // Expected result: "User is signed in and the workspace dashboard is displayed"
  await expect(await workspacePage.signedInMarker()).toBeVisible();
});
```

Guidelines that have already paid for themselves:

- **Quote the expected result in a comment** above the assertion. Reviewers can
  then check the test against the test case without opening Excel.
- **Assert the expected result as written.** If you cannot express it faithfully,
  assert what you can and name in a comment what must be confirmed. Never quietly
  weaken it into something that always passes.
- **Prefer a failure message that quotes the application.** `The application said: "Your
  account does not exist."` diagnoses itself; a 20-second timeout does not.
- **Gate destructive tests.** Anything that writes to the workspace calls
  `requireDataMutationOptIn()` so a routine run never leaves debris.

### Step 6 — Record traceability, run, promote

```bash
npm run excel:mapping -- sync --workbook excel/your-workbook.xlsx
npm run excel:test -- --grep TC_LOGIN_001
npm run excel:mapping -- promote --results test-results-excel/results.json
npm run excel:report  -- excel/your-workbook.xlsx --results test-results-excel/results.json
```

`promote` is what turns `Generated` into `Automated`. Skip it and your report
under-reports your own coverage.

---

## 4. Running

### From the dashboard

```bash
npm run excel:dashboard        # http://moolyaautomationreport.com
```

The point-and-click surface: tick the cases, choose browser, workers, headed or
headless, and what to capture; watch the output stream; read per-case results with
links to each one's screenshot, video and trace, plus that run's own Playwright
HTML report. It also uploads workbooks and authors data-driven rows.

It is a local tool bound to `127.0.0.1` that starts processes on your machine —
never expose it. Full detail, including the one-time hosts entry for the friendly
URL, is in [EXCEL-AUTOMATION.md](EXCEL-AUTOMATION.md).

Use the CLI below for anything scripted, for CI, and when you want a filtered run
written back into the workbook.

### Driving it from the spreadsheet

```bash
npm run excel:run -- excel/<applicationId>-test-cases.xlsx
```

The workbook becomes the control surface: a `Run` column (`Yes`/`No`) chooses what executes,
and results are written back into that same file after a timestamped backup to
`excel/.backups/`. Close the workbook in Excel first — an open file is locked, and the command
will say so rather than fail obscurely. Use `--no-in-place` to keep the source untouched.

Cases with no generated automation are reported and skipped rather than silently ignored, so a
row marked `Yes` that has never been automated tells you why.

### Running just one sheet

```bash
npm run excel:run -- excel/<applicationId>-test-cases.xlsx --sheet "Create Project"
npm run excel:run -- excel/<applicationId>-test-cases.xlsx --sheet "Create Project" --dry-run
```

Filters (`--sheet --module --feature --priority --tag --status --id`) **AND** with the `Run`
column, so `--sheet "Create Project"` runs only that sheet even while the Login sheet is full
of `Yes`. Only the rows the run covered are written back, so the other sheets keep the results
they already earned.

`--dry-run` prints the selection and, beneath it, everything excluded with the reason
(`Run=No` or `filtered out`) — reach for it whenever a run picks up more or fewer cases than
you expected. `--all` ignores the `Run` column while still honouring the filters.

### Running Playwright directly

> **Always go through `npm run excel:test`.** A bare `npx playwright test` picks up
> *upstream's* `playwright.config.ts`, whose `testDir` is `./tests` — it will report
> `No tests found` for anything in `tests-e2e/`. The npm script supplies
> `--config=playwright.excel.config.ts`; everything after `--` is passed straight through to
> Playwright, so every flag and filter still works.

```bash
npm run excel:test                              # everything
npm run excel:test -- login.spec.ts             # one file
npm run excel:test -- --grep TC_LOGIN_001       # one case
npm run excel:test -- --grep "TC_LOGIN_00[12]"  # a set
npm run excel:test -- --headed                  # watch it
npm run excel:test -- --debug                   # step through
npx playwright show-report reports/playwright-html   # traces, screenshots, video
start reports/<workbook>-execution-report.html            # the test-case-level report
npm run excel:allure && npm run excel:allure:open    # trends, severity, history
```

Four reports, four jobs — pick by audience, not by preference:

| Report | Best for | Needs |
| --- | --- | --- |
| `<workbook>-execution-report.xlsx` | Handing to a client or test lead | Excel |
| `<workbook>-execution-report.html` | Reading the same data quickly, printing to PDF | A browser |
| `reports/playwright-html` | Debugging a failure — traces, screenshots, video | A browser |
| `reports/allure` | Trends across runs, severity and module dashboards | **Java** |

### Allure

```bash
npm run excel:test            # writes test-results-excel/allure-results
npm run excel:allure          # generate  -> reports/allure
npm run excel:allure:open     # serve the generated report
npm run excel:allure:serve    # generate and serve in one step
```

Allure is the only report with a hard prerequisite: its generator is a Java tool, so a
machine without a JRE cannot produce it. Everything else in the framework works without Java,
which is why Allure is additive rather than the default.

The traceability is mapped into Allure's own vocabulary by `trace()`, so its dashboards group
by the things a test lead thinks in:

| Workbook field | Allure |
| --- | --- |
| Test Case ID | `ALLURE_ID` + tag |
| Module | epic and feature |
| Scenario | story |
| Priority P0/P1/P2/P3 | severity blocker/critical/normal/minor |
| Workbook, worksheet | custom labels |

Allure's real advantage over the other three is **history**: keep `reports/allure/history`
between runs and it charts pass-rate and flakiness over time. In CI, restore the previous
report's `history/` directory into `allure-results/` before generating, or the trend graph
starts from scratch every run.

Defaults worth knowing: **one worker** (concurrency depends on the environment
from one host — raise with `EXCEL_WORKERS=4` once that is confirmed lifted), and
**one retry**, where a retried pass is reported as `flaky`, not `passed`.

---

## 5. Maintenance

### The UI changed and a locator broke

Read the failure's root cause first — the report tells you which of these it is.

| Root cause | Meaning | Action |
| --- | --- | --- |
| Locator did not resolve | Element renamed, moved or gone | **Safe to fix.** Add or reorder candidates in the Page Object |
| Ambiguous selector | Matches several elements | Scope it — usually to a container id |
| Assertion mismatch | App behaves differently than expected | **Do not "fix" the test.** Raise it: the test found something |
| Test data problem | Account missing/locked | Fix the data, not the test |
| Timeout | Slow or hung | Investigate before raising the timeout |
| Environment/network | App unreachable | Not a test defect |
| Defect in automation code | Our bug | Fix the spec or Page Object |

If a fallback candidate resolved the element, that is recorded automatically:

```bash
cat ai/reports/healing/TC_LOGIN_001.json
```

Healing means **the Page Object is now out of date** — the primary strategy no
longer works. Promote the working candidate to first position and delete the
dead one. Healing buys you a green run; it does not maintain the code for you.

### The workbook changed

```bash
npm run excel:quality -- excel/your-workbook.xlsx     # re-check
npm run excel:mapping -- sync --workbook excel/your-workbook.xlsx
npm run excel:mapping -- unautomated excel/your-workbook.xlsx
```

`unautomated` lists rows with no passing automation — new rows appear here.

Rows added to a data-driven sheet need none of this: `excel:run` rebuilds the
cache, registers them for traceability and executes them in one command.

Renaming a test case ID orphans its automation: the mapping entry survives (it
still points at a spec) but the workbook row no longer matches. Rename the test
title to match, then `sync`.

### A test case is wrong, not the app

The framework never edits the source workbook. Record the requested change in
`ai/reports/test-case-change-requests.md` and hand it to the row's author. Keep
the case `Needs Review` until the workbook is corrected — with one exception: if
a human explicitly decides the application is right, you may automate against
reality, but note the divergence in that file so nobody trusts the stale row.

### Routine hygiene

| When | Do |
| --- | --- |
| Every run | `promote`, then `report` |
| Weekly | `excel:quality`, action new findings |
| After any UI release | Full run; expect locator failures first |
| When healing fires | Update the Page Object; do not leave it healing forever |
| Before a demo | Full run + report; confirm 0 unexplained failures |

---

## 6. Extending to a new module

Worked example — adding a Customers module:

1. **Add rows** to the workbook with IDs like `TC_CUST_001`. No code change is
   needed for the parser to pick them up.
2. **Confirm they parse**: `npm run excel:list -- <workbook> --module Customer`
3. **Explore the screens** with `npx playwright codegen`.
4. **Create** `tests-e2e/pages/customers.page.ts` extending `BasePage`, with
   candidate-strategy locators.
5. **Register a fixture** in the selected application's `tests-e2e/<applicationId>.fixtures.ts` (the Page Object lifecycle provisions it):
   ```ts
   customersPage: async ({ page, healing }, use) => {
     await use(new CustomersPage(page, healing));
   },
   ```
   (add it to the `Fixtures` interface too)
6. **Write** `tests-e2e/customers/customers.spec.ts`, titles `TC_CUST_001 - ...`.
7. **Sync, run, promote, report.**

### Worth doing once per module: a data-driven runner

If the module has a *family* of cases that differ only in input and expected
outcome — validation rules, boundary values, permission checks — add a runner and
those rows never need a spec again:

```ts
// tests-e2e/customers/customers-validation.spec.ts
// @data-driven-module: Customer
```

Copy `tests-e2e/login/login-validation.spec.ts`: it loops over `loadDataDriven()`
rows for its module, performs the module's actions, and asserts against the
`outcome` and `message` the workbook declared. The marker comment is how
`excel:run` pairs workbook rows with the runner, since these tests have no titles
in any source file for the scanner to find.

After that, a new case in that family is a spreadsheet edit — from Excel or from
the dashboard's form — and it runs on the next `excel:run` with no code written.

Nothing in `ai/excel/` needs to change. If you find yourself editing the toolkit
to support a new module, something has gone wrong.

---

## 7. Using the agent

The natural-language surface is the `excel-automation` skill. It follows the same
workflow, calling the same commands:

- "Automate all P0 login test cases"
- "Automate TC_CUST_001"
- "Find test cases that are not automated"
- "Find duplicate test cases"
- "Analyse the failures from the last run"
- "Show me test cases that need better assertions"

The agent is bound by the same rules you are: never write to the source workbook,
never invent an assertion, flag ambiguity instead of guessing, reuse Page Objects.
If it proposes automating something ambiguous, that is a bug in the prompt — push
back and make it flag the case.

---

## 8. CI

The Excel workflow validates all registered workbooks under their application scope. With
an empty registry it reports that there is nothing to validate. This remains separate from
upstream MCP CI. Live application execution requires a project owner's explicit CI binding,
credentials and schedule; the former application's scheduled job has been removed.
Keep `--no-in-place`, explicit mutation opt-in and application-scoped collection when setting
up live CI. Dashboard onboarding itself requires no framework source changes.

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No tests found` from `npx playwright test <file>` | No `--config`, so Playwright used upstream's `playwright.config.ts` (`testDir: ./tests`) and never looked in `tests-e2e/` | `npm run excel:test -- <file>`, or add `--config=playwright.excel.config.ts` |
| `0 of N test cases selected` | Filter values do not match the data | Run `excel:list` with no filters and read the real values |
| A column is ignored | Heading not recognised | Check **Column interpretation** in the quality report; add a synonym in `ai/excel/column-map.ts` |
| A sheet is skipped | No recognisable header row | Needs an ID-ish column plus steps/expected/module |
| A row is "malformed" | No Test Case ID | Give it an ID; the parser will not invent one |
| Test skipped, not run | A `requireX` gate | The skip reason states exactly which variable to set |
| `ERR_EMPTY_RESPONSE` | Concurrent navigation | Keep `EXCEL_WORKERS=1` |
| Report shows `Not Run` for a passing test | `results.json` is stale or from a filtered run | Re-run the full suite before reporting |
| Report shows healing that did not happen | Stale healing files | `globalSetup` clears these; confirm it is still wired in the config |
| Case stuck at `Generated` | `promote` not run, or the test is failing | Run `promote` after a green run |
| Dashboard shows "no results" for a run | The run died before Playwright wrote `results.json` | Read the output above it; the dashboard refuses to show the previous run's results in its place |
| Dashboard will not save a case | Workbook open in Excel, or the contract is invalid | Close it in Excel; otherwise fix the listed problems — nothing was written |
| Case has no `edit` link | It is backed by a hand-written spec, not a data-driven row | Edit the spec, or the row in Excel |
| Port 80 unavailable | Another server holds it | The dashboard falls back to 4321 and says so; or set `EXCEL_DASHBOARD_PORT` |
| Friendly URL does not resolve | No hosts entry yet | The dashboard prints the elevated one-liner on startup |
| A data-driven row fails with "contract cannot be read" | Typo in `Assert Outcome` or `Test Data` | `excel:sync-data -- <workbook>` lists every problem; the row fails rather than skipping on purpose |

---

## 10. The invariants

Break these and the framework stops being trustworthy:

1. **Authored columns are never written by automation.** Results are, into result
   columns only, always after a timestamped backup. The dashboard's form is the
   single place a *person* may edit an authored column, and only on a
   data-driven row.
2. **A filtered run only writes the rows it covered.** A case with no execution
   record reads as `Not Run`, so writing every row after `--sheet X` would blank
   out every other sheet's results.
3. **Test titles are `TC_ID - Scenario`.** The whole traceability chain keys off
   this string — except data-driven rows, whose titles are built at run time and
   are matched to their runner by the `@data-driven-module` marker instead.
4. **`Automated` is earned by a green run**, never hand-edited.
5. **Ambiguous cases are flagged, never guessed.** Green coverage that tests
   nothing is worse than an honest gap. A blank `Assert Outcome` means "not
   data-driven"; a non-blank one that cannot be read fails the run rather than
   being skipped.
6. **Healing only selects a pre-declared candidate for the same element.** It may
   never invent a selector or touch an assertion.
7. **Application disagreement is a finding, not a test to fix.**
8. **A run never inherits another run's results or evidence.** If a run produces
   no `results.json`, it reports zero results — never the previous run's — and
   every execution keeps its own copy of its screenshots, video, traces and
   Playwright report, because Playwright destroys both directories on the next
   run.
