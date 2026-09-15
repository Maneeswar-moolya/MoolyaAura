# Recorded-flow validation â€” 2026-09-12

## Scope and root causes

- The mapper absorbed login actions into a fixed LoginPage.signIn call. It now prevalidates
  scoped identity-proven controls, substitutes active-environment credentials, and composes
  their operations. Exact-body composite reuse is optional and independent of naming.
- Codegen goto output lacked authored/observed causality. New capture stores navigation
  provenance; automatic events are not replayed. Legacy unknowns fail closed. Transient or
  query/fragment-bearing destinations are withheld; no historical causality was fabricated.
- The deterministic classifier excluded noninteractive headings with test hooks, and semantic
  validation required an already existing class. Proven assertion targets and validated route
  bootstrap owners now use the existing transactional writer.
- Lifecycle reporting joined navigation/composite steps to single DOM proposals. Navigation
  is excluded; composite controls retain their individual decisions.
- Unmapped deterministic capabilities entered generic AI generation without their evidence.
  Typed navigation/authentication blocks now terminate that path and retain the mapping.
  This task adds no new AI fallback eligibility or runtime provider integration.

## Tests

New synthetic recorded-flow and real-browser navigation-causality fixtures cover arbitrary
login PO/composite names, asynchronous proven-control composition, scoped environment
credentials, authored entry navigation, script/HTTP redirects, withheld session URLs,
heading/class bootstrap, missing/foreign identity, lifecycle counts and real orchestration's
provider boundary. Existing mapper/assertion fixtures now declare intentional synthetic
navigation and explicit target identity evidence. Expected matcher/polarity/reuse/position
coverage remains; no locator ranking code was changed.

Eleven isolated source mutations target hardcoded auth, foreign ownership, redirect replay,
legacy intent invention, URL leakage, heading classification, missing-class refusal,
fabricated identity, navigation lifecycle counts, unproven composite reuse and AI fallback.
Focused recorded-flow, live-navigation and corrected mapper/assertion checks passed.
All eleven mutations were killed at their intended assertion; complete mutation run exit 0,
410.14 seconds. The Windows provider trap intercepts the actual spawn, rather than counting
a platform executable error as a successful mutation.

## Existing recording retry

Run `2026-09-12T17-56-34-402Z-mgixhq`, application ksp / environment stg, TC_SMOKE_002.
CLI exit 0; **blocked, not accepted**. One deterministic heading capability written,
four element actions reused, zero refused, zero model-resolved. Six navigation events lack
causality; no generated spec/execution or generic AI call. Original recording, evidence,
authoring, workbook and registry unchanged. Scoped heading PO/knowledge and fixture
registration were added by the normal writer; generation logs were appended.

Re-record navigation with the live recorder before generating an executable test. The existing
heading proof is valid. A URL's shape or position cannot establish which historical navigation
was deliberate. Query/fragment-bearing intentional destinations and transports without
initiator proof still require review; ambiguous/MFA credential flows are not guessed.

## Final regression and integrity

Completed 2026-09-13 local time: **83/84 fixtures passed in 1817.51 seconds**. This was
exactly one full sweep; it is not a green baseline. The runner completed, but one fixture
returned exit 1: `ai/autocode/semantic-candidates.fixture.ts:442`,
`E: and at an assertion pick, stamped as a pick`.

The test searches raw source with `/'pick',\n\s*\);/`. This task's edit saved
`live-recorder.ts` with CRLF (2978 CRLF lines; baseline had LF only). The call still passes
`'pick'`; the exact regex fails on raw bytes and succeeds after in-memory CRLF normalization.
Ranking checks within the same fixture passed. No post-sweep source/test correction or
second full run was made. Remaining smallest correction: restore the file's original LF
format, or make this source-text assertion newline-independent, then validate it explicitly.
All other fixtures passed, including locator benchmark, workspace accordion, recorder,
new recorded-flow/navigation, onboarding, provisioning and isolation.

**Integrity:** no framework source file or directory changed during the sweep. Registry and
TC_SMOKE_002 recording/evidence/authoring remained byte-identical. Fifteen application/log
files changed: new TC_SMOKE_003/004 recording triples, two dashboard generation records,
workbook and two workbook backups, data-driven case state, and three generation/lifecycle
logs. Their separate dashboard run IDs are `2026-09-12T18-12-34-772Z-3xs579` and
`2026-09-12T18-16-22-945Z-o67otv`, not the authorized TC_SMOKE_002 retry ID. The observed
records establish concurrent dashboard generation activity; attribution to its human/process
initiator is not proven. All these changes were preserved. Do not claim a globally unchanged
application tree or overwrite the newer workbook from the earlier recovery snapshot.
 No typecheck is
claimed: the workspace has no local TypeScript compiler. Runtime fixtures use tsx.

Private recovery snapshot and logs:
`C:\Users\MANEES~2\AppData\Local\Temp\aura-recorded-flow-puk4817k`.
No secrets copied into this report. No commit, push, cleanup or history rewriting performed.

## Files changed in this task

Production: `ai/autocode/from-recording.ts`, `orchestrate.ts`, `metrics.ts`;
`ai/autocode/abstraction/{classify,lifecycle,semantic}.ts`;
`ai/dashboard/{navigation,live-recorder,recorder}.ts` (navigation is new).

New validation: `ai/autocode/recorded-flow.fixture.ts`,
`ai/dashboard/navigation-causality.fixture.ts`, `ai/testing/recorded-flow-mutations.ts`.
Synthetic helper: `ai/testing/synthetic-data.ts`.
Adjusted autocode fixtures: action-locator, apps-readiness, assertion-persistence,
evidence-persistence, evidence-sidecar, exploration-auth, locator-quality,
notifications-knowledge, parameter, recorded-lifecycle.
Adjusted dashboard fixtures: assertion-capabilities, assertion-picker, negated-assertions,
picker-transparency, recorder. The recorder fixture already contained unrelated edits;
those were preserved.

Authorized retry artifacts: `tests-e2e/pages/ksp/us.en.home.page.ts`,
`ai/knowledge/page/ksp/ksp__us-en-home.yaml`, `tests-e2e/ksp.fixtures.ts`, and appended
`ai/reports/{abstraction-proposals,page-object-lifecycle,generation-metrics}.jsonl`
and `ai/reports/autocode-log.md`. These are application outputs, not framework exceptions.

Documentation: this record, CURRENT-STATE.md, and docs/history/REMAINING.md.
Pre-existing dashboard/environment implementation changes were not part of this task.
