# Old project cleanup — 2026-09-12

**Recommendation: READY FOR KEYSIGHT ONBOARDING through the dashboard**, with the exact regression qualification below. Keysight has not been added. No Copilot integration was attempted.

## Application data removed

Bugasura, Flipkart and demoapp are no longer registered. The production registry contains schemaVersion 1 and an empty applications array. Generation state is empty.

All 2,488 deleted files were listed in a removal manifest, hash-verified against a task-start backup, and resolved inside the workspace before deletion. Registry and state were cleared separately; those retained files are not included in the deletion count.

| Application-owned category | Removed files |
| --- | ---: |
| Workbooks and backups | 260 |
| Recordings and evidence | 466 |
| Generation/execution history and attachments | 967 |
| Reports and archived evidence | 509 |
| Browser snapshots and logs | 108 |
| Generated and quarantined specs | 132 |
| Knowledge, derived index and mappings | 7 |
| Manual application suites | 4 |
| Application Page Objects | 7 |
| Old fixture bundles, sample generator and credentials file | 4 |
| IDE links to application reports | 8 |
| Data-driven caches | 16 |

The workbook total includes three workbooks and 257 backups. The spec total includes 64 generated and 68 quarantined specs. Two application fixture bundles were removed; generic shared fixtures and BasePage remain. The old ignored `.env` contained only the retired application's credentials and was removed; `.env.example` now describes per-application configuration without an installed account.

The old scheduled live CI binding and sample-workbook generator were retired. Generic CI still validates each registered workbook under its declared owner; its empty-registry script was executed successfully. Live CI credentials and scheduling are an application-owner configuration step, not a dashboard-onboarding prerequisite.

Generic IDE settings, the upstream suite's `test-results/.last-run.json`, and the four architectural documents in `Documents/` were preserved. Only proven application-report links were removed from IDE state.

## Generic capabilities preserved

Provisioning, explicit legacy ownership, immutable application scopes, locator/evidence/identity engines, ranking, Page Object reuse and lifecycle, knowledge enrichment, workbook contracts, generic execution, history/metrics infrastructure, and fixture deletion guards remain.

Sixteen core implementation files are byte-identical to the task-start snapshot: scorer, capture/evidence engine, recording mapper, abstraction classifier/proposer/writer/validator/lifecycle, verification, scope, fixture safety, shared fixtures, collection scope, generic runner and BasePage. The four governance contracts are unchanged.

Necessary generalizations remove old application exceptions: registry-declared and conventionally named secret redaction; selected-application browser instructions and mutation permission; removal of application-only credential/mutation exports and lexical exceptions; neutral dashboard examples, reporter metadata and CI configuration. Authentication selection, workbook ownership, history architecture and production ranking were not redesigned.

## Synthetic test migration

`ai/testing/isolated-checkout.ts` copies framework source into a guarded OS temporary checkout. `seed-project.ts` then authors fictional registry, workbook, recording, evidence, knowledge, Page Object, mapping and fixture inputs. It copies no installed application artifacts or `.env`.

All 78 existing fixtures were migrated or neutralized. Of the current 80 fixtures, 78 use this harness; onboarding has its own isolated checkout, and the repository-secret audit intentionally reads the real Git state. Two new fixtures cover secret redaction and application-neutral generation prompts.

| Coverage | Synthetic replacement |
| --- | --- |
| Locator benchmark | 49 ordered candidate-family pairs, invalid-proof cases and three PO reuse controls; authored-ID counts remain informational. |
| Evidence and mapping | Authored scripts/sidecars for dynamic and scoped IDs, timing, persistence, archives, assertion provenance and pick identity. |
| Locator reuse and safety | Contextual rows, parameterized action/state methods, semantic/ID collisions, measured positional recovery and unproven-position refusal. |
| Abstraction and lifecycle | Fresh PO/knowledge declarations exercise classification, reuse, semantic eligibility, refusals, writer transactions and idempotency. |
| Picker and press claiming | Authored picker-click scripts, retained assertions, compound-CSS graphs, wrong-row rejection and association boundaries. |
| Workbook/project integration | Synthetic workbooks, caches, mappings, histories and first/second/third applications under isolated artifact roots. |

Historical population-count expectations and application-only DOM/readiness implementation assertions were retired. Their generic invariants remain tested. Existing minimal inline structural regression examples remain fixture inputs; they are not installed recordings or application Page Objects. No real corpus was retained merely to keep tests green.

## Verification

- Post-cleanup focused checks: **13/13 fixtures passed**, including the locator benchmark and workspace accordion.
- Onboarding proves an empty dashboard, invalid-configuration refusal, first → second → third via HTTP, workbook availability, stable ownership on additions/removals, refusal of unrelated flat artifacts, identical testCaseIds, cross-application collection and actual generic Playwright execution.
- **20 source mutants killed:** nine onboarding/ownership/isolation; three ranking/proof; two secret-redaction; three prompt destination/permission/export; one each for content candidates, scoped dynamic IDs and press claiming. Contextual falsification controls also pass and are not counted as separate source mutants.
- **One complete full regression: 79/80 passed, one failed, 728.93 seconds.** The sole failure was locator-validation F6: the shortened `ai/CLAUDE.md` omitted the elementRef/captureRef explanation. Production identity code was unchanged.
- Restored that instruction in **documentation only**. The affected locator-validation fixture then passed, exit 0, in 19.35 seconds. There are no remaining known failing fixtures. **No second full sweep ran.**
- An earlier partial sweep was deliberately interrupted when review found the prompt naming a retired mutation helper. It was corrected to the existing `requireDataMutationOptIn` export; the new export check and all three prompt mutants passed before the complete sweep.
- Across the complete full sweep: **zero repository files changed, created or deleted**.

The full result remains recorded as 79/80; it is not relabeled green after the focused follow-up. [Machine-readable results](OLD-PROJECT-CLEANUP-RESULTS.json) preserve all fixture exit codes and timings.

## Remaining references and repository safety

No old application-named files or directories remain, and no executable old-project references remain. Retained names occur only in explanatory source/HTML comments, historical engineering notes, and this cleanup's removal/verification records. Each source occurrence was checked as a comment. [Reference inventory](OLD-PROJECT-CLEANUP-REFERENCES.json) lists every matching file and line with its justification.

Some historical comments describe the earlier repository in present tense; their counts and examples are not current configuration. AGENTS.md, current governance and the actual registry govern. Active agent instructions no longer contain old application DOM facts; the detailed AI notes were moved to `AI-IMPLEMENTATION-NOTES.md` as explicitly historical engineering rationale.

No clean/reset/stash/revert or staging operation was used. The pre-existing staged `.env` deletion remains the only staged change. Existing uncommitted architecture was checked against the task-start snapshot, not Git HEAD. No unexplained file deletions were found.

The backup, per-file removal hashes and raw focused/mutation/regression logs remain outside the repository at `C:/Users/MANEES~2/AppData/Local/Temp/aura-cleanup-audit-ory0g08o`. They are not installed framework or application inputs.

Readiness is supported by synthetic onboarding and execution evidence, with the explicit regression/documentation-follow-up qualification above. Register the real application and supply its configuration and credentials through the existing dashboard workflow when requested. No live old-project tests or AI calls were made during cleanup.
