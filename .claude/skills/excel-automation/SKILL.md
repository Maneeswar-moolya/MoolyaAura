---
name: excel-automation
description: Turn Excel test cases into maintainable Playwright TypeScript automation, run them, analyse failures and produce an Excel execution report. Use whenever the request mentions an Excel/xlsx test case file, a Test Case ID (TC_*), automating test cases by priority/module/tag, finding unautomated or duplicate test cases, or reporting execution results back into a spreadsheet.
---

# Excel test case automation

The deterministic work is already code — parsing, filtering, quality checks, traceability
and reporting all live in `ai/excel/` behind `npm run excel:*`. **Always call those commands
rather than re-implementing them or reading .xlsx files by hand.**

What is left to you is the judgement: reading the business intent of a test case, deciding
which existing Page Object covers it, writing the spec, and deciding whether a failure is
safe to heal. That is what this skill governs.

## Non-negotiable rules

1. **Never modify an authored column.** Scenarios, steps and expected results belong to the
   person who wrote them; changes they need go in `ai/reports/test-case-change-requests.md`.
   Execution *results* are written back into the source workbook by `excel:run` and
   `report --in-place` — into result columns only, always after a timestamped backup to
   `excel/.backups/`. Use `--no-in-place` to leave the file completely untouched.
2. **Never change the business intent of a test case to make automation pass.** If the
   application disagrees with the expected result, the test has found something — report it.
3. **If a test case is ambiguous, flag it, do not guess.** Record the decision with
   `npm run excel:mapping -- review <ID> --reason "..."` and move on. A guessed assertion is
   worse than no automation, because it looks like coverage.
4. **Reuse before creating.** Read `tests-e2e/pages/` and `tests-e2e/fixtures.ts` before
   writing anything. Extend an existing Page Object rather than adding a second one for the
   same screen, and never duplicate a helper.
5. **Traceability is mandatory.** Every generated test is titled `TC_ID - Scenario` and calls
   `trace({...})` with the module, scenario and source workbook/worksheet. The mapping and
   the execution report both depend on that title format.

## The workflow

```
Excel → parse → filter → quality check → understand intent → inspect framework
      → reuse page objects → generate spec → run → analyse failure
      → heal if safe → re-run → execution report
```

### 1. Parse and select

```bash
npm run excel:list -- <workbook> --priority P0 --module Login
```
Filters: `--module --feature --priority --tag --status --id`, each repeatable or
comma-separated. `--json` gives the normalized test cases for programmatic use.

Read the output. A `!` in the first column means the case has a blocking defect and is not
automatable as written.

### 2. Check quality before writing any code

```bash
npm run excel:quality   -- <workbook>
npm run excel:sync-data -- <workbook> --strict
```

`sync-data --strict` is the cheap gate — no browser, no credentials, no network. It exits
non-zero when a row declares a data-driven contract that cannot be read, and those rows **fail**
the suite rather than skipping, so catch them here.

`quality` writes `ai/reports/test-case-quality-report.md`. Read the **Column interpretation** table
first — a mis-mapped column silently changes what gets automated. Then read **Recommended
"Needs Review"**: those cases must be flagged, not automated.

The report's deterministic checks do not replace your reading. Also look for intent that is
technically complete but wrong: a "negative" case whose expected result describes success,
steps that contradict the preconditions, a scenario that cannot be reached from the app's
actual navigation.

### 3. Prefer a data-driven row over a written spec

**Before writing any spec, ask whether the case belongs to a family already served by a
data-driven runner** (`grep -rl "@data-driven-module" tests-e2e/`). A case qualifies when it
differs from the family only in its **input** and its **expected outcome** — the actions are
identical. Login validation is the archetype: fill two fields, submit, check what came back.

If it qualifies, write nothing. Tell the author which two columns to fill in
(`Assert Outcome`, `Assert Message`) and what to put in `Test Data`, per EXCEL-AUTOMATION.md.
A row costs them a minute and never needs maintaining; a spec costs a review and lives forever.

If several *new* cases would qualify but no runner exists for that module, propose building one
before writing the third near-identical spec — one runner replaces the whole family.

Do **not** force a case into the contract when it does not fit. Different actions, a negative
message assertion, or anything reading the DOM directly all need a real spec. Stretching the
contract to cover them makes the runner a second, worse test framework.

### 4. Understand and generate

For each remaining selected, automatable case:

- Read the scenario, steps, test data and expected result together. The expected result is
  the assertion; the steps are only how you get there.
- Inspect `tests-e2e/pages/` for a Page Object covering the screen. Extend it if a locator
  is missing. Add a new Page Object only for a screen that has none.
- Add locators as **ordered candidate strategies** (see `tests-e2e/support/resilient-locator.ts`),
  leading with the accessible-name strategy. This is what makes healing possible later.
- Write the test into `tests-e2e/<module>/<module>.spec.ts`, titled `TC_ID - Scenario`,
  starting with `trace({...})`.
- Assert the expected result as written. If you cannot express it faithfully — for example
  the exact validation copy is unknown — assert what you can, and say so in a comment naming
  what must be confirmed. Do not silently weaken it to something that always passes.

Then record traceability:

```bash
npm run excel:mapping -- sync --workbook <workbook>
```

### 5. Run

```bash
npm run excel:run -- <workbook>                              # what the Run column selects
npm run excel:run -- <workbook> --sheet "Create Project"     # one sheet
npm run excel:run -- <workbook> --id TC_LOGIN_001 --dry-run  # show the selection, run nothing
npm run excel:test                                           # every spec, no write-back
```

Prefer `excel:run`: it rebuilds the data-driven cache, registers those rows for traceability,
scopes the write-back to the rows it covered, and refuses to report from a stale results file.
Never hand-write `--grep "A\|B"` — on Windows the shell eats the pipe and the run matches
nothing while still printing a summary from the previous run's results.

Credentials come from `BUGASURA_EMAIL` / `BUGASURA_PASSWORD`. Tests needing them skip with a
clear reason when they are absent — that is a skip, never a failure.

### 6. Analyse failures, heal only when safe

`npm run excel:report` classifies each failure into a root cause. Act on the class:

| Root cause | What to do |
| --- | --- |
| Locator did not resolve / ambiguous selector | **Safe to heal.** Add or reorder candidate strategies in the Page Object. Re-run. |
| Assertion mismatch | **Never heal.** The application behaved differently from the expected result. Report it as a probable defect. |
| Timeout | Investigate. A slow-but-correct app justifies a wait; a hang does not justify a longer timeout. |
| Environment / network failure | Not a test defect. Re-run and report the environment. |
| Defect in the automation code | Fix the automation. |
| Unclassified | Read the trace before doing anything. |

Healing is bounded by design: a fallback strategy for the **same logical element**, declared
in the Page Object. Never invent a selector, point at a different element, or touch an
assertion — those change the business intent.

Healing events are recorded automatically to `ai/reports/healing/` and surface in the report
as **Healing Performed**.

### 7. Report

```bash
npm run excel:mapping -- promote --results test-results-excel/results.json
npm run excel:report -- <workbook> --results test-results-excel/results.json
```

`promote` moves a case from `Generated` to `Automated` once it has actually passed, and back
to `Generated` if it starts failing. Then report, and summarise for the user: total,
automated, passed, failed, healed, needs review — and state that the source workbook is
unchanged.

## Natural language command routing

| The user says | Do this |
| --- | --- |
| "Automate all P0 login test cases" | `excel:list --priority P0 --module Login` → quality → generate → sync → run → promote → report |
| "Automate TC_LOGIN_001" | `excel:list --id TC_LOGIN_001` → generate that one → sync → `excel:test -- --grep TC_LOGIN_001` |
| "Automate all unautomated customer test cases" | `excel:mapping -- unautomated <workbook> --module Customer` → generate each |
| "Run all automated test cases from the Login module" | `excel:run -- <workbook> --module Login` |
| "Run only TC_LOGIN_001 and TC_LOGIN_002" | `excel:run -- <workbook> --id TC_LOGIN_001,TC_LOGIN_002`. Do **not** hand-write `--grep "A\|B"`: on Windows the shell eats the pipe and the run silently matches nothing |
| "Run just the Create Project sheet" | `excel:run -- <workbook> --sheet "Create Project"`. Filters AND with the Run column, and only the covered rows are written back |
| "Let me pick what runs" / "run it from a UI" | `npm run excel:dashboard` — point them at it rather than scripting a one-off |
| "Add a login validation case" / "this case is wrong, fix it" | If it is data-driven: the dashboard's form, or the workbook columns. Never edit a spec to make a failing assertion pass |
| "Analyze failed test cases from the execution report" | `excel:report`, then read Failure Reason + Root Cause per row and apply the table above |
| "Find test cases that are not automated" | `excel:mapping -- unautomated <workbook>` |
| "Find duplicate test cases" | `excel:quality`, then the `DUPLICATE_TEST_CASE` findings |
| "Show me test cases that need additional assertions" | `excel:quality`, then `WEAK_ASSERTION` and `MISSING_EXPECTED_RESULT` |
| "Generate Playwright tests for all P0 test cases" | as row 1, without the module filter |

## Reference

- `EXCEL-AUTOMATION.md` — full command reference and directory layout
- `FRAMEWORK-GUIDE.md` — the end-to-end walkthrough
- `ai/excel/` — parser, quality analyzer, mapping, execution report
- `ai/excel/data-driven.ts` — the contract that lets a row run with no spec
- `ai/dashboard/` — localhost run dashboard and the authoring form
- `tests-e2e/` — fixtures, Page Objects, generated specs
- `ai/test-mapping/mapping.json` — Test Case ID → automation
- `ai/reports/test-case-change-requests.md` — edits only the workbook's author can make
