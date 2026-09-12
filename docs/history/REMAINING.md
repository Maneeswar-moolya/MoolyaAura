# REMAINING

Last updated: 2026-09-12 (old project cleanup; empty registry; full sweep 79/80, documentation follow-up green)

<!-- ===================================================================== -->
<!-- MACHINE-READABLE STATUS. Any session, any account: read this first.   -->
<!-- The repository is the source of truth. Verify before trusting.        -->
<!-- ===================================================================== -->

```yaml
status_version: 44
updated: 2026-09-12
verified_by: >
  2026-09-12 cleanup: 2488 verified application-owned files removed; registry and state
  empty. 13/13 post-cleanup focused fixtures; 20 source mutants killed. One complete
  full sweep: 79/80 in 728.93 seconds. Sole failure: omitted elementRef/captureRef guide
  paragraph. Restored documentation only; locator-validation follow-up exit 0.
  Zero repository writes during the full sweep. Earlier entries below are historical.
  2026-09-12: locator benchmark contract correction, 32 focused checks, three behavioral
  mutations killed, workspace accordion 22/22, and exactly one final full regression:
  78/78 fixtures by exit code, zero failures, 648.10 seconds in an isolated copy.
  Production and application artifact hashes unchanged. See locator_benchmark_contract_alignment.
  2026-09-12: foundational onboarding gates (13/13), nine behavioral mutations killed,
  affected project/dashboard/authoring fixtures, and exactly one full 78-fixture sweep
  in an isolated copy. No live application tests or AI calls. See
  foundational_dashboard_onboarding for the two sweep failures and focused follow-up.
  2026-09-04: the full offline fixture regression on the settled tree, plus the isolation
  gate driving the REAL production accessors under a two-application registry (98 checks).
  Nothing live was run this session and nothing was generated - see
  `application_isolation_phase_2` for exactly what was and was not exercised.
  2026-08-24 (still true, not re-run): Playwright collection of the fresh TC_LOGIN_112
  spec (2 tests in 2 files) + LIVE execution against my.bugasura.io passing in 24.8s +
  four live resolver exchanges through the real headless Claude Code transport.
implementation: COMPLETE for future generations; see blockers for what is not
regression:
  fixtures: 80
  failures: 1
  remaining_failures_after_focused_followup: 0
  verified_on: >
    Current cleanup: one complete full sweep, 79/80, 728.93 seconds. Only F6 in
    locator-validation failed: shortened ai/CLAUDE.md omitted the elementRef/captureRef
    distinction. Documentation restored; targeted rerun passed. No second full sweep.
    The following results predate cleanup.
    2026-09-12, after test-only locator benchmark alignment: 78/78 passed by exit code,
    zero failures, 648.10 seconds. Exactly one final full sweep after the tests settled.
    Both locator-quality-benchmark and workspace-accordion passed in this sweep.
    Historical onboarding sweep earlier on 2026-09-12: 76/78 passed (702.49 seconds).
    workspace-accordion had an obsolete project API stub; after declaring its synthetic
    project, its existing browser assertions pass (exit 0). No production change followed
    the sweep and no second full sweep was run. locator-quality-benchmark remains red:
    its authored-ID preference expectation conflicts with selection on existing TC_LOGIN_160
    evidence. Benchmark, ranking/proof code and evidence match pre-implementation hashes.
    Earlier results below are historical.
    2026-09-09, after P12B (Page Object / knowledge bootstrap): 76/76 by EXIT CODE, 0
    failures, on the settled tree, including the new
    ai/projects/bootstrap-knowledge.fixture.ts. Before that,
    2026-09-09, after P12A (locator strategy contract): 75/75 by EXIT CODE, 0 failures, on
    the settled tree, including the new ai/autocode/strategy-contract.fixture.ts. Before
    that, 2026-09-08, after P11 (candidate durability): 74/74 by EXIT CODE, 0 failures, on the
    settled tree, including the new ai/autocode/candidate-durability.fixture.ts. Before
    that, after P10 (exact + non-exact semantic candidates): 73/73 by EXIT CODE,
    0 failures, on the settled tree. One fixture went red during the phase and was a real
    contract change, not a stale assertion - see `fixture_contract_changed` in
    `p10_exact_and_non_exact_semantic_candidates`. Previously
    2026-09-05, after the P5 locator-engine implementation: 66/66 by EXIT CODE, 0 failures,
    including ai/autocode/abstraction.fixture.ts and the new
    ai/autocode/semantic-candidates.fixture.ts. Two fixtures went red during P5 and were
    real regressions, not stale assertions - see `p5_locator_engine`. Previously 63/63
    after the TypeScript diagnostic cleanup; final settled tree 2026-09-04 (Phase 8).
  failure_is_pre_existing: >
    Current cleanup failure was a documentation omission, not a production regression.
    Fixed in ai/CLAUDE.md only; targeted locator-validation rerun exit 0. Remaining
    known failures: zero. The following explanations are historical.
    No remaining failures in the current sweep. The prior locator-quality-benchmark
    failure was classified STALE TEST EXPECTATION: universal authored-ID preference
    contradicted the existing ranking contract. Corrected only the test; production
    ranking/proof code and TC_LOGIN_160 evidence are unchanged.
    The following abstraction note is historical and was not a failure in this sweep.
    NOT caused by Phase 2 and not a code defect - one sound outstanding proposal
    (TC_LOGIN_087 -> WorkspacePage.bugNewSubmit) against two SNAPSHOT assertions. It was
    invisible until the CRLF parser fix, because with the pre-fix parser the fixture
    could not load at all on any checkout. Full reasoning in `abstraction_fixture_red`.
    DO NOT edit that fixture to make the regression green.
  baseline_before: >
    54 fixtures / 3282 checks / 0 failures, claimed on 2026-08-24 and measured on a tree
    whose knowledge YAML still parsed. 49 fixtures on 2026-08-21.
  command: "for f in $(find ai -name '*.fixture.ts' | sort); do npx tsx $f; done"
  and_then: "Compare artifact hashes and counts against the measured pre-run baseline, never a historical total."
  flipkart_count: >
    20 files as of 2026-09-08, not the 8 quoted by earlier phases: four recordings
    (TC_SMOKE_006..009) were made through the dashboard recorder during the P11 session.
    A fixture that pins a corpus TOTAL will go red whenever this happens - see
    `corpus_grew_mid_phase_and_a_fixture_had_pinned_a_snapshot` in p11_candidate_durability
    for the one that did and how it was restated.
  note: >
    RUN THIS BEFORE BELIEVING ANY NUMBER HERE. Check EXIT CODES, not the printed
    summaries - several fixtures print their own wording and a grep for PASS/FAIL reports
    NO-SUMMARY for them while they are perfectly green. The numbers in
    `page_object_lifecycle` below were measured at the end of the 2026-08-24 session; a
    corpus that has gained a recording since will move the corpus-derived ones.

# ------------------------------------------------------------------- 2026-09-12
old_project_cleanup:
  status: "DONE; ready for dashboard onboarding, with the regression qualification below"
  report: docs/history/OLD-PROJECT-CLEANUP.md
  results: docs/history/OLD-PROJECT-CLEANUP-RESULTS.json
  registry: "schemaVersion 1; applications empty; no Keysight added"
  removed: "2488 verified application-owned files; registry entries and generation state cleared"
  synthetic_tests: "78 migrated existing fixtures; two new fixtures; no installed corpus copied"
  mutations: "20 source mutants killed; contextual falsification retained"
  full_regression: "79/80, 728.93 seconds; sole failure documentation assertion F6"
  followup: "elementRef/captureRef explanation restored in ai/CLAUDE.md; locator-validation exit 0"
  remaining_known_failures: 0
  integrity: "Zero repository writes during full sweep; 16 protected core files unchanged"
  next: "Onboard the real application from the dashboard when requested; do not restore old data"
  qualification: >
    A partial sweep was stopped to correct a prompt helper and test its shared export.
    Exactly one complete full sweep followed. Its 79/80 result is not relabeled green;
    the only later correction was documentation, verified by the affected fixture.

# ------------------------------------------------------------------- 2026-09-12
locator_benchmark_contract_alignment:
  status: "DONE - test/fixture hardening; no production behavior change."
  root_cause: >
    The benchmark treated a historical authored-ID selection count as a universal
    preference. TC_LOGIN_160 has four proven semantic selections scoring 95 ahead of
    proven authored IDs scoring 70, which is valid under the existing ranking contract.
  test_change: >
    Replaced the universal ID assertion with an independent weakest-segment score
    comparison over press-time identity-proven action candidates. The selected proven
    candidate must have no strictly higher-scoring admissible proven competitor.
    Unscoreable expressions retain the contract's -1 score; ties acquire no new rule.
    Authored-ID selection counts are informational only. The returned measurement
    itself must carry proof and belong to the proven set; no proof requires abstention.
    Page Object reuse and the existing state-dependent-name checks remain intact.
    Corpus-only imports are deferred so synthetic selection checks need no app setup.
  focused_result: >
    Benchmark exit 0, 32/32 checks, 7.41 seconds: 1097 captured graphs, 625 with proof,
    396 with multiple proven candidates, zero unproven or outranked selections.
    Authored IDs: 210 selected, four not selected; all three existing Page Object reuse
    cases pass. Workspace accordion exit 0, 22/22 browser assertions, 13.08 seconds.
  mutations_command: "npx tsx ai/autocode/locator-quality-benchmark.mutations.ts"
  mutations_result: >
    3/3 killed, driver exit 0, 36.51 seconds. Reversed ranking and forced lower-scoring
    ID selection each fail the higher-scoring-competitor gate. Removing proof admission
    fails the inadmissible-candidate gate. Synthetic checks cover no match, ambiguity,
    wrong target, another document, assertion-pick timing for an action and unknown
    identity, including abstention with no proven candidate. Baseline and restored
    controls pass. Mutants modify only guarded OS temporary source copies; no application
    artifacts or credentials are installed there. Import/syntax errors cannot count as kills.
  final_regression: >
    Exactly one full sweep on the settled tests: 78/78 fixtures passed by exit code,
    zero failures, 648.10 seconds. Includes both previously failing fixtures and all
    13 onboarding gates, including empty -> first -> second -> third via dashboard HTTP,
    stable ownership and generic runtime without Bugasura files. No live application
    tests or AI calls. Only this handoff documentation was updated after the sweep.
  integrity: >
    All workspace files were SHA256-snapshotted before the task (2739 files, excluding
    dependencies, Git internals and pre-existing temporary directories). Only the
    benchmark, its new mutation driver and this handoff changed; no file was removed.
    Production ranking, scorer, proof, evidence, locator generation and all application
    artifacts are byte-identical. Existing uncommitted and untracked work is preserved.
  files_changed:
    - ai/autocode/locator-quality-benchmark.fixture.ts
    - ai/autocode/locator-quality-benchmark.mutations.ts
    - docs/history/REMAINING.md
  next_action: >
    The benchmark blocker is resolved. Proceed to a scoped old-project cleanup task:
    back up and inventory owned artifacts, preserve generic capabilities, and migrate
    or sanitize corpus-dependent regression inputs before deleting application data.
    The full benchmark still reads the existing corpus, knowledge and named Bugasura
    Page Object reuse cases; green regression is not proof those inputs can be removed.
    No Bugasura, Flipkart or demo data was deleted in this task.

# ------------------------------------------------------------------- 2026-09-12
foundational_dashboard_onboarding:
  status: >
    IMPLEMENTED. A valid empty registry can start the dashboard; the same Add Project
    route provisions the first, second and subsequent applications. Workbooks are
    created at registration; existing scope/lifecycle writers create other artifacts
    on demand. No per-application framework edit or production-registry change.
  root_causes: >
    Empty registry validation rejected the initial state. Singleton fallbacks granted
    flat paths, undeclared workbooks, bare historical state and derived-index ownership.
    Collection bypassed isolation for a singleton, and discovery forgot namespace
    boundaries when an application was deregistered. The generic runner imported the
    legacy application fixture bundle; shared mutation guards borrowed its opt-in.
  ownership: >
    Only explicit legacyLayout declarations grant flat compatibility. Undeclared
    workbooks and bare historical keys remain unowned. Scoped directories stay scoped
    after deregistration. Singleton selection remains UI/selection metadata only.
  focused_validation: >
    ai/projects/onboarding.fixture.ts: 13 behavioral gates pass, including an empty
    dashboard browser check, real HTTP empty -> alpha -> beta -> gamma provisioning,
    identical-ID Playwright collection/execution, and real local generic form execution
    in a temporary checkout with no installed application artifacts. Existing affected
    project/dashboard/authoring fixtures also exercised in an isolated corpus copy.
  mutations_command: "npx tsx ai/projects/onboarding.fixture.ts --mutations"
  mutations_result: >
    9/9 killed, exit 0 from the mutation driver. Reintroduced empty rejection,
    singleton flat ownership, undeclared-workbook ownership, bare-state reassignment,
    cardinality-based index naming and collection, foreign-file discovery, the legacy
    generic fixture import, and Bugasura-authorized shared mutations. Every mutant
    failed its intended behavioral gate in a disposable checkout.
  fixture_contract_changes: >
    isolation.fixture now explicitly declares its legacy owner. provisioning-isolation
    no longer expects deregistration to grant ownership; its scan uses a guarded OS
    temporary artifact root. Corpus integrity compares against this run's measured
    baseline, not the obsolete 409-recording snapshot. No application artifact changed.
  final_regression: >
    Exactly one full sweep: 78 fixtures, 76 passed, two exit 1, 702.49 seconds.
    workspace-accordion's obsolete API stub was corrected after the sweep; its existing
    assertions then passed in a focused browser run (exit 0, 10.88 seconds). Production
    was unchanged after the full sweep. locator-quality-benchmark remains red on the
    pre-existing TC_LOGIN_160 authored-ID-versus-semantic ranking expectation.
  integrity: >
    1258 protected files, including 466 recording files, match the pre-change SHA256
    snapshot. Production registry, Page Objects, knowledge, recordings, mappings,
    generated specs, workbooks, application fixtures and history are untouched.
    No existing file was removed; uncommitted and untracked work is preserved.
  files_changed:
    - ai/projects/registry.ts
    - ai/projects/scope.ts
    - ai/autocode/work.ts
    - ai/excel/mapping.ts
    - ai/knowledge/index.ts
    - ai/dashboard/public/index.html
    - tests-e2e/generic/generic.spec.ts
    - tests-e2e/support/base-fixtures.ts
    - tests-e2e/support/collection-scope.ts
    - ai/projects/onboarding.fixture.ts
    - ai/projects/isolation.fixture.ts
    - ai/projects/provisioning-isolation.fixture.ts
    - ai/dashboard/workspace-accordion.fixture.ts
    - docs/history/REMAINING.md
  remaining_before_old_project_cleanup: >
    Do not delete Bugasura/Flipkart/demo data yet. Inventory and preserve owned artifacts
    and legacy declarations; separate corpus-dependent regression inputs from removable
    application data. Auth selectors, workbook/upload behavior, global history retention
    and details, and provisioning concurrency/rollback limitations were not redesigned.
    Existing legacy application helpers remain for existing application consumers.
  next_action: >
    Resolve the pre-existing benchmark expectation through a separate investigation.
    Review cleanup ownership, generic capabilities and backups before old-project removal.
    GitHub Copilot integration and Keysight onboarding remain out of scope.

# ------------------------------------------------------------------- 2026-09-09
p13_7_resolver_terminal_decline_and_page_object_bootstrap:
  status: >
    DONE - two unrelated real-world blockers, kept apart. A: the semantic resolver spent two
    further transport calls on a question its own validator had already settled. B: a
    bootstrapped Page Object could not resolve BasePage from a scoped application directory.
  a_root_cause: >
    `revalidate` computes `decisionIsTheAnswer` and says in its rejection text that such a
    decline "is a correct answer"; the loop stopped only on accepted/REUSE/REFUSED, so the
    settled decline read as repairable. The reasoning existed and was not communicated.
  a_the_rule: >
    TERMINAL iff the resolver declined AND every question still unanswered is one whose
    ANSWER IS THE DECISION - UNCLASSIFIED_TARGET, CONTAINER_OR_CAPABILITY,
    CONSTANT_PARAMETER_VALUE. A decline leaving NO_METHOD_NAME or an owner problem open stays
    repairable. A timeout is never terminal.
  a_why_it_is_safe: >
    A terminal exchange ends exactly where a spent budget ends - NEEDS_REVIEW, a STRUCTURAL
    RESOLVER_EXHAUSTED refusal, not re-asked. No answer is accepted that was not accepted
    before, no validation is skipped, no standard is lowered. Only transport calls change.
  a_measured: >
    Replaying the REAL recorded first attempts through the REAL validator: over the last 12
    exchanges 32 transport calls become 24. TC_SMOKE_013 3 -> 1 (~278s -> ~93s at the measured
    ~93s/call). TC_SMOKE_016 9 -> 7. TC_SMOKE_012 unchanged at 3, correctly - NO_METHOD_NAME
    is repairable. The residue in TC_SMOKE_016 is two TEXT_ONLY_IDENTITY exchanges that
    legitimately repair and then hit the 120s transport ceiling.
  a_scope_verified: >
    `ensurePageObjects` already passes only this case's proposals to the resolver, by
    testCaseId or sighting. There is NO corpus-wide semantic path. `analyseCorpus` is
    corpus-wide and costs 2.2-2.8s (Bugasura) / 0.08-0.13s (Flipkart).
  a_observability: >
    Per attempt: transportMs, responded, terminal. Per exchange: startedAt, finishedAt,
    totalMs, terminal. Per case: a `semantic` block on the attempt metrics (exchanges, calls,
    attempts, totalMs, accepted, rejected, terminalStops). The metrics SCHEMA is deliberately
    NOT bumped - it rides in frameworkFingerprint, so a bump would grant every row a fresh
    attempt budget, and an observational field decides nothing.
  b_root_cause: >
    `renderPageObjectClass` emitted two FIXED relative imports correct only for a class
    written directly into tests-e2e/pages - the legacy unscoped layout. A scoped application
    is one directory deeper, so `./base.page` and `../support/resilient-locator` both named
    files that do not exist, and Playwright refused the spec at COLLECTION.
  b_the_fix: >
    Both specifiers are computed from the class file's own directory to the framework file's
    real location, anchored on the fixtures module's directory (the layout root the scope
    resolves). Generalized: a third application resolves the same way with nothing named
    after it. The legacy layout emits byte-identical strings.
  b_artefact_repair: >
    tests-e2e/pages/flipkart/home.page.ts had been written by the defective renderer; its two
    import lines were corrected. No capability, locator, knowledge entry or identity touched.
    Verified: `npx playwright test --config=playwright.excel.config.ts --list` on the Flipkart
    generated spec now reports "Total: 1 test in 1 file".
  tests: >
    semantic.fixture.ts section T (10 checks); bootstrap-knowledge.fixture.ts section F (6
    checks). Fixture COUNT unchanged at 77.
  mutations: >
    Eight, all bite. R1 terminal short-circuit removed -> T1/T2/T8/T10. R2 non-terminal
    decline treated as terminal -> T4. R3 timeout becomes a terminal rejection -> T6 and the
    existing outage check. R4 stop on the first rejection regardless of validation -> T4.
    R5 resolver bypassed -> sections D and E. B1 fixed BasePage path -> F2/F6. B2 fixed
    support path -> F3/F6. B3 framework looked for beside the class -> F2/F3/F5/F6.
  production_files_changed: >
    ai/autocode/abstraction/semantic.ts, ai/autocode/abstraction/types.ts,
    ai/autocode/abstraction/writer.ts, ai/autocode/metrics.ts, ai/autocode/orchestrate.ts.
  regression: "77 fixtures run, 77 green, 0 failures, exit code 0 - 2026-09-09, one run on the settled tree. One fixture went RED during the phase and was a REAL defect, not a stale assertion: locator-validation E20 judged every application's specs against the ACTIVE application's fixture list, and a concurrent recording run produced the first scoped generated spec destructuring a scoped fixture. The sweep is now application-aware and E1 proves it bites. Fixture COUNT unchanged at 77."
  next_action: >
    Resume broad Flipkart validation. Two known costs remain and neither is a correctness
    problem: (1) transport calls take ~83-102s with a 120s ceiling, so an exchange that
    legitimately repairs still costs minutes - that is a transport question, not a resolver
    one, and A3 forbids converting a timeout into a semantic answer; (2) Phase 13.6 moved 8
    Bugasura rows from a false REUSE to an honest NEEDS_REVIEW, which raises AI-eligible
    proposals there from 10 to 18 - real review work whose cost lands the next time Bugasura
    runs with --create-page-objects, and which a re-recording clears without a model call.

# ------------------------------------------------------------------- 2026-09-09
p13_6_capability_identity_is_measured:
  status: >
    DONE - framework correctness. The duplicate gate no longer infers element identity from
    a selector token; it reads a measurement taken at the interaction. Option (a) MEASURE,
    as authorised after the Phase 13.5 investigation.
  the_invariant: >
    An existing capability may be credited with the recorded element only where the element
    resolved by that capability's own declared locator, in the document the interaction
    happened in, IS the element that was acted on. A name, a selector token, a score and a
    method name are each not element identity. Unknown never becomes yes.
  production_files_changed:
    ai/autocode/dom-evidence.ts: >
      CandidateMeasurement gains an optional `capability: {owner, method}`; TargetEvidence
      gains an optional `capabilityMeasurements` list; `provenMeasurements(evidence, role)`
      is the one reader that returns every measurement satisfying `provesIdentity` across
      all four lists; `sanitiseEvidence` carries the new list, attributed and bounded by the
      existing `maxRejectedCandidates` limit. All additive and optional.
    ai/dashboard/live-recorder.ts: >
      `measureDeclaredCapabilities` resolves the ACTIVE application's declared capability
      locators against the parked node through the EXISTING `measureExpressionCandidates` -
      same faithful rebuild, same document guard, same in-page identity comparison, same
      bar - and attributes each answer. Called from `measureAtPress` and from the assertion
      pick. Bounded by MAX_CAPABILITY_MEASUREMENTS (40) so it cannot sit in a person's click
      path; prose and parameterised declarations are skipped because they are not locators.
    ai/autocode/abstraction/propose.ts: >
      `existingCapability` rewritten. It now takes the element's proven measurements (and,
      for a parameterised group, the template) instead of a locator string, matches on an
      attributed capability measurement or on a proven candidate whose expression IS the
      declared locator, matches a parameterised capability on its template, and refuses
      when more than one capability qualifies. `selectorTokens`/`declaredSelectors` are no
      longer imported here. Row members carry their own `identityProofs`.
  what_did_NOT_change: >
    Candidate generation, families, budgets, scoring, ranking, durability, exact-vs-loose,
    AI eligibility, the resolvers in from-recording.ts, the writer, the transaction, the
    lifecycle vocabulary. No new strategy, no new evidence store, no fallback.
  corpus_before_after:
    bugasura: >
      Same 409 recordings. Element-gate claims 9 -> 1; retained alternatives 2 -> 0;
      REUSE 14 -> 6; NEEDS_REVIEW 66 -> 74; REFUSED 11 -> 11. Proposals 91, matcher reuses
      458 and unmeasured 207 are unchanged, and PROPOSED is EMPTY before and after - so
      nothing new is written and nothing established moved. Measured both ways on the same
      tree by substituting the token basis back in, which reproduced the Phase 13.5 numbers
      exactly.
    the_one_surviving_claim: >
      The row-scoped `.bugChecked` group against IssuesPage.issueCheckboxState, on the
      TEMPLATE basis - the declared template is byte-identical to the proposed one and the
      instantiated expression was proven at the press. It was already REUSE by the name
      gate, so no outcome depends on it.
    the_eight_that_disappeared: >
      3 provably wrong (.mdl-button across different containers with disjoint text filters),
      1 wrong on the recorded evidence (a container id), 4 that proved nothing (a container
      id or a shared class). Each becomes NEEDS_REVIEW - visible work rather than false
      coverage. `lifecycle.ts` had been recording all eight as EXISTING_PO_REUSED / passed /
      no remedy.
    flipkart: >
      Unchanged, and by inspection must be: its single declared capability is a getByRole
      chain, which yields no selector token, so the token gate could never match it either.
      Measured 21 proposals / 5 reuses / 2 unmeasured / 0 claims / 0 alternatives on both
      bases.
  corpus_grew_during_this_phase: >
    NOT BY THIS WORK. A person was recording Flipkart through the dashboard while the phase
    ran: TC_SMOKE_010/011/012 appeared at 12:07-12:48 on 2026-09-09, and the 12:07 autocode
    run bootstrapped `ai/knowledge/page/flipkart/flipkart__root.yaml` plus
    `tests-e2e/pages/flipkart/home.page.ts` (HomePage.homeLink) - Phase 12B working on a
    live application for the first time. Flipkart recordings 20 -> 30 files; Bugasura
    unchanged at 409. Recorded here because the testing contract's baselines are facts about
    the repository, and this one moved for a legitimate reason that was not this phase.
  tests: >
    ai/projects/knowledge-enrichment.fixture.ts, 47 -> 67 checks. Section J is I1-I14 plus
    I4b (a name that NAMES an established capability), I8b (a measurement from another
    document) and I10a/I10b (attribution follows identity), driven through the real
    analyseCorpus/applyProposals in a temporary artefact root with TWO registered
    applications. Sections C, D and H were updated - not relaxed - so the simulated recorder
    carries the capability measurement a real press now takes; the cases that must NOT prove
    identity carry none.
  mutations: >
    Six, all bite: M1 token equality (I3, I5, I11, I12), M2 accessible-name equality (C4,
    C5, D4, H1-H4, H9, I4b, I5, G2), M3 same-document protection removed (I8b), M4
    unresolved counts as identity (I6), M5 several resolved count as identity (I7), M6
    identity bypassed on token overlap (I3, I5, I11, I12). M7 - attribution without proven
    identity - was written, applied and measured, and CANNOT bite: attribution has no gate
    of its own, and a name-resolved item is resolved by `findMethod` before the analyser
    sees it. Applying it leaves the retained alternatives byte-identical. M1/M2/M6 protect
    the same invariant from the reachable side.
  governance: >
    MOOLYAAURA-ARCHITECTURE.md extends the Phase 13.3 attribution rule with how identity IS
    established (measurement at the interaction), what is not identity (name, selector token,
    score, method name), and what happens when it cannot be established (the proposal and
    review path; unknown is not yes). No rule was weakened.
  the_honest_cost: >
    A recording carrying no capability measurement and no proven candidate equal to the
    declared locator now leaves identity unproven, so a real duplicate can reach the
    proposal path where the token gate would have blocked it. That is the governed outcome
    rather than a regression - the brief is explicit that unknown must not become yes - and
    it shrinks with every recording made from now on, because every press measures the
    declared capabilities. On the current corpus nothing is written either way.
  regression: "77 fixtures run, 77 green, 0 failures, exit code 0 - 2026-09-09, one run, after every change was complete. Fixture count unchanged (the enrichment fixture grew from 47 to 70 checks rather than a new file being added)."
  next_action: >
    None outstanding for identity. Two things follow from it and are separate: (1) the
    eight elements now in NEEDS_REVIEW are real coverage work, and their capabilities can be
    created once a recording measures them; (2) `lifecycle.ts` reports any REUSE as
    EXISTING_PO_REUSED / validationStatus passed / remedy null, including a REUSE the NAME
    gate produced - on this corpus all six are genuinely the same element, so it is a
    reporting hazard rather than a live defect, and it is not this phase's to fix.

# ------------------------------------------------------------------- 2026-09-09
p13_5_element_identity_investigation:
  status: >
    INVESTIGATION COMPLETE, NO FIX APPLIED - authorised as read-only. The duplicate gate
    is NOT a local defect. It is one place where the framework claims ELEMENT IDENTITY on
    a basis that cannot establish it, and it is the only resolver that does so.
  the_gate: >
    existingCapability(template, knowledge, index) in ai/autocode/abstraction/propose.ts.
    It tokenises the proposal's template, takes the LAST token, and returns the first
    knowledge entry whose declaredSelectors() contain that one token. Two call sites: the
    per-target ladder (~line 1138) and the parameterised group (~line 1342). A match sets
    status REUSE, adds METHOD_EXISTS "already wraps this element", and - since P13.3 -
    is ALSO the sole authority that attributes alternative evidence to a capability.
  what_the_basis_actually_proves: >
    Nothing about identity. Two expressions sharing a selector token are not thereby the
    same element, and two sharing none are not thereby different elements. The gate's own
    premise - "the LAST concrete token names the element the method returns" - is false
    for any expression whose final narrowing step contributes no token: getByText(...),
    getByRole(...), a bare tag. For those the trailing token is the CONTAINER, so the
    gate compares a scope against an element.
  the_framework_already_holds_the_right_standard_everywhere_else:
    findMethodByProvenLocator: >
      Full expression equality, or a sole authored id that is the entry's ONLY declared
      selector; and it honours `usage`.
    findParameterisedMethod: >
      A structural template match whose round-trip must reproduce the measured expression
      byte for byte.
    disambiguateByProvenLocator: >
      Uses token containment, but ONLY to narrow a set already tied on another basis -
      "it can only ever narrow, never invent a match".
    existingCapability: >
      Token containment as a POSITIVE identity claim, on its own, with no usage check, no
      owner/page check, and no ambiguity refusal.
    therefore: >
      The generalized rule is not new. It is the framework's own standard, which this one
      resolver does not meet: identity may be claimed only on an identity-grade basis, and
      token overlap may only narrow a set some identity-grade basis already justified.
  measured_on_the_real_corpus:
    element_gate_matches: 9
    provably_wrong: >
      3 - TC_DASHBOARD_004 ("close"), TC_LOGIN_071 ("Cancel") and TC_LOGIN_074
      ("Close is visible") each matched WorkspacePage.newIssue on `.mdl-button` alone,
      against a declared locator scoped to a DIFFERENT container id AND filtered to
      disjoint text ('add Add Issue'). Corroborated outside the analyser: a person had to
      hand-write `#first_report_modal button:has-text("close")` in projects.page.ts, on a
      different class, for the element the gate calls already wrapped.
    wrong_on_the_recorded_evidence: >
      1 - TC_LOGIN_126 "Select your team" matched ProjectsPage.projectButton on the
      CONTAINER id `#team_select_create`; the declared element is a `.team-list-item` row.
    unproven_basis_defensible_outcome: >
      4 - TC_DASHBOARD_008, TC_DASHBOARD_027 x2, TC_LOGIN_074 "Notification Preferences".
      The capability named is plausibly the right one (generated specs do call
      bugReportOverviewLink, reportsNavLink and notificationsPanel.panel) but the gate
      matched a container id or a shared class, so it did not establish that.
    true_and_redundant: >
      1 - the row-scoped `.bugChecked` group matched IssuesPage.issueCheckboxState on a
      BYTE-IDENTICAL template, and that proposal was already REUSE by the name gate.
    crossed_a_declared_usage: 2 - TC_LOGIN_074 and TC_DASHBOARD_024
    two_claimants_first_won_silently: >
      1 - TC_LOGIN_074, where both NotificationsPanel.panel and
      NotificationsPanel.settingsButton declare `#ap_notifications_panel`.
    exposure: >
      47 declared capabilities, all 47 implemented; 28 declare at least one concrete
      token; 18 of those END in a class token. Of 91 proposals, 29 have a basis ending in
      a class (the false-positive shape) and 35 have no token at all (the gate is blind to
      them). Flipkart shows 0 matches only because it has 0 declared capabilities - the
      failure mode GROWS with maturity rather than being self-limiting.
  falsification_three_mutations_applied_to_the_real_source_and_reverted:
    method: >
      analyseCorpus() only - applyProposals was never called, so nothing was written under
      any mutation; both BASELINE measurements are identical.
    M1_every_token_not_just_the_last: >
      9 -> 10 matches, and IssuesPage.resultRows immediately claims two row-scoped groups.
      The code comment predicting this was right. All-tokens is worse; last-token is not
      thereby right - both are token overlap.
    M2_the_gate_never_matches: >
      DECISIVE. Matches 9 -> 0, REUSE 14 -> 6, NEEDS_REVIEW 66 -> 74, and PROPOSED stays
      EMPTY. On this corpus the gate prevents no write whatsoever. Its entire measurable
      effect is to move 8 rows out of the review queue on a premise it did not establish,
      and to manufacture 2 false evidence records.
    M3_whole_expression_equality: >
      9 -> 1 match (the byte-identical `.bugChecked` one) and 0 alternatives. Exactly one
      of the nine is a real duplicate, and expression equality alone finds it.
  counterexamples_A_to_G:
    what_was_built: >
      Seven minimal cases, each in its OWN temporary artefact root under os.tmpdir() with a
      synthetic registry - no Bugasura DOM, no `.mdl-button`, no WorkspacePage - driven
      through the real analyseCorpus + applyProposals.
      A shared class, different containers -> BLOCKED (wrong).
      B shared class and container, disjoint text filters -> BLOCKED (wrong).
      C the new element is text INSIDE the established container -> BLOCKED (wrong).
      D the new element is a bare tag inside it -> BLOCKED (wrong).
      E byte-identical expression -> correctly reused, but by findMethodByProvenLocator; the
        item never reaches the gate.
      F same element, quoting differs only -> same, also resolved by the matcher.
      G same element, CSS expression vs SEMANTIC expression -> NOT blocked, PROPOSED, and
        APPLIED: a SECOND capability (saveNowButton beside saveButton) was written for one
        element. The false-negative half is not hypothetical.
    conclusion: >
      Unsound in BOTH directions, so it is not a conservative approximation of identity.
      A-D reproduce the failure in an application that shares nothing with Bugasura, which
      is what makes the rule generalized rather than application-specific.
  governance_position: >
    MOOLYAAURA-ARCHITECTURE.md already states the rule this violates: "Evidence is
    attributed to a capability only where the framework has established that the recorded
    element is the one that capability wraps. A match made on a name is not element
    identity." A match made on a shared selector token is not element identity either. The
    governance text needs no change to forbid this; the implementation does not meet it.
  consequences_that_are_not_cosmetic:
    review_queue: >
      lifecycle.ts turns status REUSE into disposition EXISTING_PO_REUSED with
      validationStatus "passed" and remedy null. Eight elements are therefore recorded as
      covered by an existing Page Object when they are not, and no remedy is ever offered.
    evidence_store: >
      Both alternative-evidence records the corpus produces are false attributions to
      WorkspacePage.newIssue. That is 2 of 2 - the entire P13.3 evidence store, on this
      corpus, is wrong. Nothing is on disk yet: ai/reports/abstraction-alternatives.jsonl
      does not exist and is only written when the pipeline next runs.
    no_wrong_call_was_ever_emitted: >
      Checked: no generated spec calls a capability the gate mis-associated. Spec emission
      is decided by the matcher, not by this gate, and the matcher requires expression
      equality. The damage is to the ledger, the review queue and the evidence store.
  what_a_fix_must_decide_NOT_DECIDED_HERE: >
    Two directions, and the choice is a governance decision rather than a coding one.
    (a) MEASURE: resolve the declared locator in the press's own document and ask
    __auraSameElement - the only thing that can PROVE identity, and the framework already
    has the primitive. Requires evidence a knowledge entry does not carry today: an entry
    records a locator STRING, not an element identity, which is the structural gap under
    all of this. (b) REFUSE TO CLAIM: keep the gate as a REVIEW FLAG rather than an
    identity answer - an unprovable identity must not silently settle the question. Note
    that (b) alone re-opens counterexample G, which is a real duplicate write.
  integrity_of_this_phase: >
    Production behaviour unchanged - three mutations applied to propose.ts and reverted
    byte-for-byte (no markers remain; both baselines identical). No capability, knowledge
    file, recording, spec or mapping modified. No report artefact created;
    abstraction-proposals.jsonl untouched (mtime 2026-09-08). Artefacts: Bugasura 409,
    Flipkart 20, zero TC_TEST*, knowledge 3, Page Objects 7, generated specs 63. No full
    77/77 regression was run - none was required, because no production change was made;
    knowledge-enrichment, abstraction and po-discovery fixtures were run as an integrity
    check and are green.
  next_action: >
    DECIDE (a) or (b) above, then authorise Phase 13.6 to implement it. Do not widen or
    narrow the token comparison - both were measured and both are token overlap.

# ------------------------------------------------------------------- 2026-09-09
p13_4_enrichment_fails_closed_and_verifies_what_it_wrote:
  status: DONE - safety phase. No decision, ranking, budget or corpus outcome changed.
  authorised_by: >
    Architecture: knowledge/Page Object/fixture updates are ONE TRANSACTION; a capability
    requires deterministic evidence and proof at the interaction; established capabilities
    are append-only; no artefact resolved outside the active applicationId; and the rule
    added this phase - evidence is attributed to a capability only where the framework has
    established the recorded element is the one that capability wraps, a name being no
    element identity.
  what_changed: >
    ai/autocode/abstraction/writer.ts only.  (pre-write, pure) feeds
    the  array the batch already refuses on;  joins the
    existing  step and therefore the existing rollback. No second writer, no
    second transaction, no new evidence store, and 13.3s observational report is NOT an
    input to any mutation.
  pre_write_invariants: >
    capability named; every file the write would touch inside the ACTIVE scope
    (, which had no production caller before this); locator is a measured
    expression, never prose;  holds for the press-time proof; the write
    would not change what an established capability resolves to; and it would not give one
    element a second name.
  post_write_invariants: >
    every capability that existed still declares what it declared, and no file this run
    did not intend to write has changed - compared as BYTES against a snapshot taken
    before the write. Never mtime, never ordering, never a timestamp.
  unreachable_mutation_recorded: >
    Removing the post-write CALL SITE cannot bite: every defect reachable today is refused
    before the write, so nothing reaches the verification with something to find. That is
    the fail-closed property, not a hole. The two checks it runs are protected reachably
    (P6, P7) through a deliberately corrupted result.
  corpus: >
    bugasura 91/458/207 and flipkart 18/0/2 - byte-identical to the accepted 13.3 baseline.
    The writer eligible set on the real corpus is EMPTY (0 PROPOSED, archived included), so
    no existing capability could be affected either way.
  pinned_by: ai/projects/knowledge-enrichment.fixture.ts (47 checks, 12 new in section I)

# ------------------------------------------------------------------- 2026-09-09
p13_3_alternative_evidence_is_retained_for_review:
  status: DONE - operationalises one governance sentence. No decision anywhere changed.
  authorised_by: >
    Architecture / Project Knowledge Lifecycle: "New evidence about an established
    capability - including a locator that appears stronger - may be retained for review.
    It is never applied automatically." Until now the second half was enforced and the
    first half was not: the evidence was simply discarded.
  what_changed: >
    ai/autocode/abstraction/propose.ts only. , 
    and  (its own report file, rewritten from the corpus like the
    ledger). The record is built at ONE place - the analyser duplicate gate that
    established the element is already wrapped - and read by nothing.
  the_record: >
    application, recording, step, role, the established owner and method, the DECLARED
    locator and the OBSERVED one verbatim, the knowledge file, and the identity basis. No
    score, no verdict, no timestamp.
  three_corrections_the_corpus_and_fixture_forced: >
    (1) THE MATCHER PATH RECORDS NOTHING.  matches by accessible NAME, which is
    not element identity - a control sharing a name was recorded as new evidence for an
    unrelated capability.  can only match when declared equals
    proven, so it has nothing to report. Only the duplicate gate knows both facts.
    (2) AN INSTANTIATED TEMPLATE IS NOT A RIVAL: a parameterised capability plus one row
    is the capability being used - 118 of the first 150 records were that.
    (3) A PROSE  states no locator to differ from. Also: one line per
    distinct alternative, and formatting is not evidence.
  corpus: >
    Bugasura 91 proposals / 458 reuses / 207 unmeasured and flipkart 18/0/2 - BYTE-IDENTICAL
    to the accepted baseline. Observations: bugasura 2 from 101 recordings, flipkart 0.
  a_finding_for_a_future_phase_not_changed_here: >
    Both Bugasura observations are , and both show the duplicate
    gate associating differently-scoped buttons because they share a last selector token
    (): a modal Close and a Cancel control are currently treated as already
    wrapped by newIssue, which blocks two legitimate capabilities from ever being created.
    The gate errs conservatively (it refuses to create, never to overwrite) so nothing is
    unsafe, and it is exactly the kind of thing this report exists to surface. NOT changed
    in this phase.
  pinned_by: ai/projects/knowledge-enrichment.fixture.ts (35 checks, 9 mutations, all bit)

# ------------------------------------------------------------------- 2026-09-09
p13_1_and_13_2_governance_and_enrichment_contract:
  status: DONE - governance updated, enrichment behaviour PINNED. Zero production change.
  governance: >
    Nine durable rules landed in the pack (G1-G8 plus the approved removal of the obsolete
    AI candidate-family claim): append-only automated enrichment with an explicit reviewed
    maintenance path, new evidence retained for review rather than applied, capability
    requires deterministic proof while prose does not, AI descriptive authorship carries no
    authority, transactional writes, idempotent enrichment, accepted specs are never
    silently regenerated, the P12A strategy contract, and the corrected Flipkart baseline
    (8 -> 20). Placement: Architecture (knowledge lifecycle + AI boundary), Principles
    (item 11), Locator Contract (new Strategy Contract section), Testing Contract
    (artifact safety).
  what_13_2_added: >
    ONE FIXTURE AND NOTHING ELSE - ai/projects/knowledge-enrichment.fixture.ts, 22 offline
    checks in a temporary artefact root. It pins the enrichment behaviour that already
    existed BEFORE any Phase 13 change touches it: a second proven capability is appended
    with the first entry byte-identical; the same element recorded again adds nothing; an
    element already wrapped is a REUSE even under a different name and a different proven
    locator; a rival locator for an established capability is written nowhere; an unproven
    target adds nothing; an unsound proposal is refused by validation before any file is
    written; and the enriched capability is what the next recording reuses.
  defence_in_depth_measured: >
    Several enrichment invariants are guarded twice - a reuse resolver answers before a
    proposal is made, and the writer refuses again on disk - so single mutations often
    cannot bite. Each of the five mutations is therefore aimed at the gate that actually
    decides in the scenario the fixture drives: append-only (M1), element identity (M2),
    the proof requirement (M3), the pre-write refusal (M4, with the rollback deliberately
    left holding), fixture idempotency (M5). All five bite.
  not_done: >
    13.3 (superseding-evidence record) and 13.4 (pre-write knowledge validation with
    post-write verification, per the approved decision) are NOT implemented.

# ------------------------------------------------------------------- 2026-09-09
p12b_page_object_and_knowledge_bootstrap:
  status: DONE - framework capability. Existing owner decisions byte-identical.
  the_gap: >
    MoolyaAura could reuse an application's knowledge and never create the first piece of
    it. All four resolveOwner rules read a knowledge file; OWNER_UNKNOWN is not in
    SEMANTIC_ENABLED so no resolver may be asked; and applyProposals refuses a proposal
    whose owner no knowledge file declares. Flipkart proved it live: 0 Page Objects, 0
    knowledge files, 1 generated spec, 5 raw locators, 0 reuse.
  what_changed: >
    (1) ai/autocode/dom-capture-source.ts captures `location.pathname` at the press, in
    the document that parked it, on both registration sites; (2) TargetEvidence.route
    carries it, allow-listed through sanitiseEvidence and dropped whole when a path
    segment looks like a secret (routeCarriesSecret); (3) live-recorder carries it onto
    the press and pick evidence rows; (4) propose.ts gains bootstrapOwner + a FIFTH owner
    rule and declaredForRoute; (5) types.ts gains BOOTSTRAP_ROUTE_UNKNOWN (SEMANTIC, NOT
    in SEMANTIC_ENABLED) and Proposal.bootstrap; (6) writer.ts gains renderKnowledgeFile +
    bootstrapKnowledgePath and creates the first knowledge file inside the existing
    transaction.
  the_rule: >
    An owner is derived from TWO facts and no others - the active applicationId and the
    route the DOCUMENT stated at the press. canonicalIdentity turns them into
    `<app>__<routeSlug>`; the class is that slug in PascalCase plus `Page`, with `HomePage`
    for the root route (the approved naming decision). Nothing is derived from a page
    title, DOM shape, text, accessible name, locator strength or a model.
  fail_closed: >
    No route, a route carrying a generated identifier (`/issues/636432` names a record),
    an origin naming another application, or no origin at all - each refuses with no
    knowledge file, no class and no fixture. A historical recording is never enriched to
    become bootstrapable.
  existing_knowledge_always_wins: >
    Containment, declared container, declared component and declared route all answer
    first, and an AMBIGUOUS declared owner stays ambiguous. `declaredForRoute` was
    extracted so the declared rules are asked with the PRESS-TIME route as well as the
    reconstructed one - without it, a recording whose goto the step walker cannot read had
    its second element bootstrapped on a screen it had already described (found by the
    fixture, not reasoned about).
  corpus: >
    Bugasura 91 proposals / 458 reuses / 207 unmeasured - BYTE-IDENTICAL to the pre-phase
    baseline. Flipkart: identical statuses, owners and methods; the only difference is a
    more precise refusal sentence on two targets (BOOTSTRAP_ROUTE_UNKNOWN where it was
    OWNER_UNKNOWN - both SEMANTIC, both unaskable, both PROPOSAL_REJECTED /
    REFUSED_NO_ADMISSIBLE_EVIDENCE). Owner decisions over every real recorded target:
    2034 for bugasura, all unchanged, 0 bootstrapped.
  pinned_by: ai/projects/bootstrap-knowledge.fixture.ts (37 checks, 10 mutations, all bit)
  mutations_that_taught_something: >
    Two mutations could not bite as first written and both were informative. Removing the
    writer's pre-write block is caught by the ROLLBACK (defence in depth, applied:false and
    nothing on disk either way); letting an existing knowledge file be re-rendered is
    UNREACHABLE because knowledgeFileFor finds that file first, so bootstrap never runs for
    a screen that already has one. The reachable form of the same concern - existing
    knowledge SKIPPED - bites. Separately, the two origin guards were merged into one
    comparison because each masked the other, so neither could be tested alone.
  not_done_deliberately: >
    No navigation/open() method is generated for a bootstrapped page (a capability nothing
    measured); no component is created; no historical evidence is migrated; no locator
    strategy, ranking, budget or AI behaviour is touched. AI is not involved in ownership
    at any point.

# ------------------------------------------------------------------- 2026-09-09
p12a_locator_strategy_contract:
  status: DONE - framework capability. ZERO locator-behaviour change, proven by corpus diff.
  what_changed: >
    ONE table and one derivation, both in ai/autocode/dom-evidence.ts. `STRATEGY_CONTRACT`
    declares, for all 35 strategy names, family + budget kind + measurement path +
    scoreable + rebuildable; `strategyContract()` reads it through a Map built once;
    `familyOf` derives the family from it and keeps its old default for an undeclared
    name. No other production file changed. No ranking, score, budget, generation order,
    identity gate, safety gate, Page Object or AI behaviour was touched.
  the_gap_it_closes: >
    A strategy was a bare string spelled at four unrelated places - emission site,
    familyOf, the scorer's shape classifier, buildLocator's REBUILDABLE - and every
    disagreement failed SILENTLY in the same direction. Measured: an unmapped family falls
    to `structural`, which has no FAMILY_BUDGET entry, so applyFamilyBudget retains 0 of
    it; scoreExpression returns null for an unknown Playwright call, which ranks it last;
    buildLocator returns null for the same, which makes matchCount null so the candidate
    can never be proven. None of the three produces an error.
  what_the_contract_found: >
    THREE STRATEGIES ARE GENUINELY NOT REBUILDABLE - container-text, scoped-class-text and
    scoped-class-pair-text - because they build `.filter({ hasText })` and `readOptions`
    supports `name`/`exact` only, deliberately. All three are measured in the page by
    __auraMeasure and never need a rebuild, so the contract records `rebuildable: false`
    and the fixture requires rebuildability only of an `expression` strategy. Measured
    over the corpus: 0 refusals for every other strategy, 2480 refusals across those three.
  behaviour_unchanged: >
    Corpus diff over all 1041 captured graphs, before vs after: per-graph ordered candidate
    lists with family and measurement path - IDENTICAL; all 1247 ranked selections
    (action + assertion) - IDENTICAL; totals - IDENTICAL (raw 18039, retained 17272, proven
    candidates 3050, zero-proven targets 172, ambiguous 8431, wrong-target 563, unresolved
    49, at-ceiling 0, dropped-by-budget 767; families identifier 316, container 1875,
    structural 10023, semantic 1209, semantic-scoped 1530, attribute 1455, content 864).
  performance: >
    familyOf 13.9 ns -> 19.5 ns per call (min of 5 x 1,000,000 calls), about 17 calls per
    captured target. Whole-corpus generation timing is dominated by machine noise at this
    scale (0.16-0.44 ms/target on both trees across repeats), which is why the isolated
    function was measured instead.
  pinned_by: ai/autocode/strategy-contract.fixture.ts (9 checks over 30 emitted strategies)
  mutations: >
    EIGHT, all bit. Declaration side: entry removed (A1), scoreable lied about (B-E),
    rebuildable lied about (B-E), family moved to one with no budget (B-E + G1),
    measurement path swapped (B-E). Reality side: FAMILY_BUDGET entry removed (B-E + G1),
    getByRole removed from REBUILDABLE (B-E), and a NEW EMISSION SITE with no contract
    entry (A1 + G1) - the case the whole phase exists for.
  deliberately_not_done: >
    The scorer's shape classifier was NOT rewired to read the contract. It classifies an
    arbitrary RECORDED chain, not only our own strategies, so making it contract-driven
    would either change how a Codegen locator scores or add a second path - both are
    behaviour changes this phase forbids. Same reasoning for REBUILDABLE, which must keep
    parsing Codegen's chains and is deliberately a SUPERSET of what our strategies use
    (first/last/nth are rebuildable and no strategy emits them). The fixture asserts the
    relationship behaviourally instead: every emitted expression must actually rebuild.

# ------------------------------------------------------------------- 2026-09-08
p11_candidate_durability:
  status: DONE - measurement/knowledge phase. NO ranking change, and none is proposed yet.
  production_change: >
    ONE pure function and one export keyword, both instrumentation. `classifyDurability`
    in ai/dashboard/live-recorder.ts answers "does this candidate still identify the
    pressed element after a state transition" and is called by NOTHING in the recording
    path; `measureExpressionCandidates` became exported (visibility only, no behaviour).
    No evidence field carries a durability verdict, and no locator is chosen or refused by
    one. Ranking, candidate budgets, AI eligibility, Page Object reuse, the falsification
    gates, application isolation and every locator safety rule are untouched.
  methodology: >
    19 targets measured across my.bugasura.io and flipkart.com (21 planned; 2 could not be
    measured and are reported as such, not as data). Production path throughout:
    PREACTION_HOOK -> recordParkedEntry -> measureAtPress for the press, production
    splitCandidates for the press verdicts, the page's own __auraMeasure for CSS
    candidates and production measureExpressionCandidates for Playwright ones after the
    transition, classifyDurability for the verdict, classifyNameStability for the name.
    Every transition ends on a signal the application produces; no sleep anywhere.
  press_matrix: >
    296 candidate measurements at the press: 126 proven, 144 ambiguous, 14 wrong-target,
    12 unresolved.
  durability_matrix: >
    Of the 126 proven at the press: 104 durable, 11 unknown (both reload transitions -
    the document is gone), 10 unresolved, 1 ambiguous. Per target:
    BOTH_DURABLE 7, EXACT_DURABLE_ONLY 3, NONEXACT_DURABLE_ONLY 2, NOT_GENERATED 5,
    UNKNOWN 2. By application - bugasura {BOTH 4, EXACT_ONLY 2, NONEXACT_ONLY 2,
    NOT_GENERATED 3, UNKNOWN 1}, flipkart {BOTH 3, EXACT_ONLY 1, NOT_GENERATED 2,
    UNKNOWN 1}.
  three_failure_modes: >
    (1) NAME EXTENSION breaks the EXACT form: Bugasura email "Email" ->
    "Email Please enter a valid email id" and password "Password" -> "Password Not too
    short! enter min 5 characters." take getByRole(..., exact:true) from 1 to 0 while the
    non-exact form stays at 1 and identity-matched. (2) A NEW SIMILAR ELEMENT breaks the
    NON-EXACT form: Flipkart's Mobiles link goes 1 -> 3 when a search query brings
    suggestions whose names contain "Mobiles" - with the accessible name perfectly stable.
    (3) DYNAMIC TEXT breaks every text-derived candidate: Bugasura's password error label
    keeps its element and its slot, its scoped-text and scoped-class-text candidates go to
    0, and #password_field-error stays durable.
  name_stability_is_not_durability: >
    13 candidate-measurements are DURABLE through a CHANGED name; 1 is AMBIGUOUS through
    a STABLE one. The two contracts share no input: classifyDurability takes no name and
    classifyNameStability takes no count. accessibleNameStable is unchanged and was not
    redefined.
  deterministic_alternatives: >
    NEITHER "id is better" NOR "semantic is better" survives the corpus. Unscoped
    [name="..."] was AMBIGUOUS at the press 7 times (the three simultaneously mounted
    Bugasura forms) against 5 proven; the SCOPED attribute form was proven 8/8 and durable
    10/10; the authored id (stable-id) was proven 5/5 and durable 5/5. What held up across
    both applications was SCOPE, not the family. Also measured durable: scoped-class 13/13,
    scoped-placeholder 4/4, scoped-role-name-loose 5/5, role-name 10/14, role-name-loose
    9/12, scoped-role-name 13/19 (the shortfalls are the two reload rows and the two
    validation rows).
  selection_impact: NONE. No candidate selection changed, because nothing consumes the verdict.
  performance: >
    Re-measurement after a transition costs 159 ms median per target for every proven
    candidate - the in-page batch is 4 ms median for all CSS candidates at once, and the
    Playwright-expressed ones cost 40 ms median each on the Node side (max 89 ms). Press
    measurement itself is 243 ms median, unchanged. No timeouts were introduced and no
    polling was added to manufacture a durable verdict; 2 of 21 targets could not be
    measured (a flipkart login dialog that did not render and its suggestion list, which
    the search box would not accept a query for on the final run).
  harness_fault_found_and_fixed: >
    The first run reported 42 of 42 CSS-path candidates as `unknown`. That uniformity was
    a HARNESS fault, not a page property: __auraMeasure answers `count` and production's
    measureAtPress translates it to `matchCount`; the harness read `matchCount` off the raw
    result, got undefined, and classifyDurability correctly refused to guess. Reading the
    field the page actually sends took durable from 66 to 104. Recorded here because the
    Phase 8 lesson repeated exactly: a suppression fault always flatters the tool.
  ranking_question: >
    NOT ANSWERED, deliberately. The evidence shows both forms failing, in different ways,
    on both applications - 3 EXACT_DURABLE_ONLY against 2 NONEXACT_DURABLE_ONLY - so no
    repeatable "A survives where B does not" pattern exists for either. What DOES repeat
    is that scoped candidates and authored ids were durable wherever they were proven
    (23/23 across stable-id, scoped-attribute and scoped-placeholder), and that is the
    hypothesis a future phase could test - on more targets, more applications and more
    transition kinds than 19/2/12.
  pinned_by: ai/autocode/candidate-durability.fixture.ts (25 checks, 8 mutations, all bit)
  corpus_grew_mid_phase_and_a_fixture_had_pinned_a_snapshot: >
    FOUR flipkart recordings were made through the dashboard recorder at 21:22-21:44 on
    2026-09-08, while this phase was running - genuine human recordings (Codegen chains
    with assertions, their own .spec.ts and .authoring.json). Nothing in this phase wrote
    them and none of them was deleted. Flipkart therefore holds 20 files, not the 8 that
    earlier phases recorded; bugasura is unchanged at 409.
    They turned three checks in ai/autocode/accessible-name-stability.fixture.ts red,
    because section C asserted CORPUS TOTALS - 52 named, 0 browser-verified, 0 proven
    role+name - which were true of every recording that existed when P7 was written and
    could not survive a new one. The claim those totals stood for is the honest limit:
    evidence captured before browser-computed names existed cannot answer the stability
    question and none was fabricated to make it. A pre-capability capture is identifiable
    PER TARGET - it carries no `accessibleNameSource` key - so the limit is now asserted
    over exactly that population (1031 graphs, 52 named, 0 verified, 0 proven role+name -
    the original numbers, intact) and holds however many recordings are added. It also
    now asserts the other half, which the snapshot could never check: every
    post-capability target carrying a name carries a VERIFIED one (10 of 10).
    NOT A WEAKENING - the same refusals, stated over the population they were about.
  historical_data: >
    No recording was written, no durability value was invented for existing evidence, and
    nothing under ai/dashboard/recordings was read for a durability claim - every number
    here comes from a live press taken during this phase.

p10_exact_and_non_exact_semantic_candidates:
  status: DONE - production change, measured before and after.
  what_changed: >
    THREE lines of behaviour, no new mechanism. (1) `semanticCandidatesFor` emits a
    non-exact twin for every role+name candidate it already emitted, unscoped and scoped;
    (2) both twins are emitted LAST within their families, after every other candidate;
    (3) `rankProvenCandidates` keeps a loose twin behind its exact one. Nothing else in
    generation, measurement, identity, the gates or the AI boundary moved.
  the_finding: >
    NEITHER FORM IS GENERALLY BETTER, and the live matrix says so in one table. 20 pressed
    targets across my.bugasura.io and flipkart.com, production hook and production
    measurement: 15 BOTH_VALID, 1 EXACT_ONLY_VALID, 5 NEITHER_VALID (2 of which generate
    no role+name at all), 0 NONEXACT_ONLY_VALID at the press. Through a state change:
    4 BOTH_SURVIVE, 1 NONEXACT_ONLY_SURVIVES (Bugasura's password field, whose name gains
    the validation error - exact goes to 0 matches), 1 EXACT_ONLY_SURVIVES (Sign In, whose
    loose form matches Google's sign-in button too), 1 NEITHER_SURVIVES.
  why_it_is_generated_and_not_preferred: >
    The exact form was introduced in P5.1 for a real reason (Flipkart's "Home" matched two
    loosely) and the loose form answers a real failure (an appended validation message
    takes exact to zero). Both are refused by the machinery that was already there when
    they are wrong - ambiguity at the press, identity against the pressed node - so
    generating both costs nothing that is not measured, and choosing between them offline
    would be a preference nothing has established.
  budget_pressure_measured_explicitly: >
    Emitted BESIDE its exact twin, the loose form displaced 150 candidates the generator
    already produced across the 1026 captured targets - 125 scoped-semantic-text and 25
    scoped-label - because `semantic-scoped` is budgeted at 4 over 2 scopes. None of the
    150 is proven in the corpus, but the family budget exists so that nothing proven today
    can be displaced by anything added, and "not proven yet" is not "worthless". Emitted
    LAST it displaces ZERO and still offers 374 of the 524 loose candidates (236 unscoped,
    138 scoped). No budget constant changed: MAX_CANDIDATES 16, MAX_TOTAL_CANDIDATES 28,
    FAMILY_BUDGET {semantic 5, semantic-scoped 4, attribute 3}.
  ranking_invariant: >
    Both forms score 95/95 over one segment, so the shorter-expression tie-break would
    have promoted the loose form wherever both are proven - a global preference decided by
    counting characters. `LOOSE_STRATEGIES` in classify.ts breaks that tie for the exact
    twin. VERIFIED over the whole archived corpus: 1231 ranked lists before and after,
    0 differing. Page Object reuse therefore cannot move - `findMethodByProvenLocator`
    walks the same list in the same order.
  corpus_before_after: >
    1026 targets. Candidates 16804 -> 17178 (+2.2%). Semantic family 948 -> 1184. Loose
    kept 0 -> 374. Targets at the total ceiling 0 -> 0. Candidates dropped by budget
    467 -> 767, and the whole increase is the loose form dropping ITSELF (300); the 467
    attribute-pair drops are the pre-existing baseline. Proven candidates no longer
    generated: 15 before, 15 after - identical, and pre-existing drift in the text limits
    rather than anything this phase did.
  cost: >
    Generation 0.297 -> 0.43 ms per target (arithmetic, 3 passes over 1026 graphs). At the
    press, live on Bugasura over 5 targets: 15 -> 19 ms mean, 19 -> 20 candidates measured.
  not_done_deliberately: >
    Durability is NOT ranked on. The loose form survived the one transition exact did not,
    and exact survived one where loose was already ambiguous; ranking on that would need
    durability measured, and a press is one instant. No application-specific rule, no
    change to identity/document/slot/ambiguity/forbidden-locator/dynamic-id/falsification
    rules, no AI involvement, no workbook or mapping or historical evidence rewritten.
  pinned_by: ai/autocode/exact-nonexact.fixture.ts (22 checks, 8 mutations, all bit)
  fixture_contract_changed: >
    ai/autocode/semantic-candidates.fixture.ts asserted "every generated role+name
    candidate carries exact:true" - the P5 contract, and P10 is exactly the change to it.
    It went red in the regression and was UPDATED, not weakened: the exact form must still
    be generated and must still be the settling one, and the loose twin must follow it -
    never instead of it, never before it. Two checks where there was one.
  evidence: >
    Live matrix and the before/after corpus runs were driven by scratchpad harnesses over
    the PRODUCTION path (PREACTION_HOOK, recordParkedEntry -> measureAtPress,
    candidateSelectorsFor). Nothing was saved to ai/dashboard/recordings and no credential
    was read - Bugasura was driven anonymously.

p9_stability_coverage_and_the_exactness_finding:
  status: DONE - collection quality + coverage. ZERO production changes.
  headline: >
    THE HAZARD IS `exact: true`, NOT "a changed name". Measured on Bugasura in both
    states: getByRole('textbox', {name:'Password'}) matches 1 CLEAN and 1 AFTER the
    validation error; the same locator with exact:true matches 1 clean and ZERO after.
    Identical for Email. The error text is APPENDED, so substring matching survives and
    exact matching breaks. Phases 6-8 had framed this as "the accessible name changed",
    which is true and is not the operative fact.
  the_tension_this_exposes: >
    Production's GENERATED semantic candidates all carry exact:true - added in P5.1
    deliberately, because the non-exact form matched two elements for Flipkart's "Home".
    So exact:true fixes ambiguity and creates state-fragility. That is a real measured
    trade-off, not a defect, and it is what a ranking phase would have to weigh.
  suppression_sources_diagnosed: >
    "press never claimed" = HARNESS fault, not production. Phase 8 invented expressions
    Codegen would never write: `page.locator('#loginForm .login-input-group i')` yields
    the literal "loginForm .login-input-group i" and claims nothing, while
    `getByText('visibility')` claims immediately; and defaulting a missing role to 'link'
    made `getByRole('link', ...)` on an <i> unclaimable by construction. Fixed by asking
    the BROWSER for role+name via ariaSnapshot, which is Codegen's own basis.
    "unverified approximation" = GENUINE limitation, left alone. Those Flipkart footer
    anchors come back from Accessibility.getPartialAXTree as `ignored: true, role: none`,
    with and without scrolling into view - the browser computes no name, so `unknown` is
    correct and no approximation was promoted.
  sample: >
    26 interactions across 11 categories. stable 15 (57.7%), changed 2 (7.7%), unknown 9
    (34.6%). Bugasura 14: 8/2/4. Flipkart 12: 7/0/5. Unknown reasons: 3 no accessible name
    at all, 2 press never claimed, 4 element absent or a page timeout.
  answer_to_the_A_B_C_question: >
    A - inline validation, and narrower still. Across ~50 observations over Phases 8-9
    spanning navigation, dropdowns, expanded/collapsed, toggles, buttons, links, form
    fields, dialogs, typing and search, the ONLY changed names are the two Bugasura fields
    an error label attaches to. Flipkart: ZERO changed in 24 observations. Even the Sign In
    button inside the same validation flow is stable - only the field the error is bound to
    moves.
  recommendation: NO ranking change. The evidence supports a narrower question about exactness.

# ------------------------------------------------------------------- 2026-09-08
p8_stability_evidence_collected:
  status: DONE - observation only. ZERO production changes.
  pinned_by: ai/autocode/accessible-name-stability.fixture.ts (section E)
  how: >
    The production recording path driven live against both applications - production
    PREACTION_HOOK, production recordParkedEntry/measureAtPress, production captureFor ->
    takePreAction. NO artefact was saved: Phase 8's own integrity rule requires Bugasura
    to stay at 409 and Flipkart at 8, so the evidence objects were collected in memory and
    only the analysis was written to the scratchpad. The data is real; the stores are not.
  distribution: >
    24 interactions. stable 11 (45.8%), changed 2 (8.3%), unknown 11 (45.8%).
    Bugasura 12: 5 stable / 2 changed / 5 unknown. Flipkart 12: 6 stable / 0 changed /
    6 unknown. Every `changed` is in the VALIDATION category (2 of 4); navigation 4/4
    stable; expanded/collapsed stable; dialogs, toggles and unlabelled images unknown.
  the_one_real_hazard_observed: >
    Bugasura's EMAIL field through validation: "Email" -> "Email Please enter a valid
    email id", and the engine SELECTED `getByRole("textbox", { name: "Email", exact:
    true })` while `#email_field` was proven and available. That locator matches nothing
    once the error shows. The password field also changed but the engine selected
    `#password_field`, so it is unaffected. ONE of two changed targets is actually
    exposed - a first observed instance, not a pattern.
  unknown_reasons: >
    5 unverified approximation (not browser-computed), 3 press never claimed (the
    expression matched no parked entry), 3 other. `unknown` is dominated by elements the
    page gives no accessible name and by claim-matching, NOT by CDP failure: across two
    instrumented runs only 1 of 24 press measurements timed out and zero failed.
  harness_corrections_worth_recording: >
    Four, each of which had made the data look better than it was: waiting for any parked
    entry rather than a NEW one; reporting the press-time name as the settled name;
    waiting on `parked[length-1]` (a moving target) rather than the pinned entry; and
    attributing every unknown to "CDP unavailable". The contradiction that exposed the
    third - 17 rows with no name while only ONE measurement had timed out - is the reason
    the attribution logic is now pinned and mutation-tested.
  sufficient_for_a_ranking_experiment: >
    NOT YET. 2 changed targets, both in one category of one application, one of them
    actually exposed. That is a first instance, not a distribution.

# ------------------------------------------------------------------- 2026-09-08
p7_collect_accessible_name_stability:
  status: DONE - COLLECTION only. No ranking, generation, budget, reuse, AI or gate change.
  pinned_by: ai/autocode/accessible-name-stability.fixture.ts
  schema: >
    DomNode.accessibleNameStable?: 'stable' | 'changed' | 'unknown'. Optional, so every
    existing sidecar stays valid, and carried through redactNode ONLY beside the name it
    describes. No before/after pair is persisted - the brief asked for the smallest
    representation and no diagnostic need was demonstrated.
  meaning: >
    accessibleName is the authoritative press-time name (browser-computed via CDP when
    available; otherwise the aria-label/title approximation, marked unverified).
    accessibleNameStable says whether THAT authoritative name was unchanged at the settled
    point for the SAME parked target in the SAME document.
  timing_points: >
    Press: measureAtPress, unchanged. Settled: takePreAction, which is the moment Codegen
    has written its line and the entry is claimed - the pipeline's existing settled point.
    No sleep was introduced and no new lifecycle point invented.
  guards: >
    classifyNameStability is pure and fails closed in order - unverified press-time name,
    different document, slot no longer holding an attached target, missing settled name.
    Only then does equality decide. SLOT_STILL_HOLDS_TARGET checks document, slot populated
    and node attached; slot indices are never reused (allocate increments and NULLS the
    slot MAX presses ago), which is what makes the slot a safe key without holding a node
    reference across the two moments.
  measured_live_through_production: >
    Password field CHANGED ("Password" -> "Password Not too short! enter min 5
    characters."); Email, Sign In, Language toggle STABLE; a released slot UNKNOWN in the
    SAME document with EQUAL names - the guard firing on exactly the Phase 6 failure.
  latency: >
    One CDP name round trip isolated: mean 22 ms, max 28 ms. Press measurement (incl. the
    first CDP call and all candidate measurement) mean 39 ms. Claim path (incl. the second
    CDP call, the locator count and every candidate) mean 189 ms, max 225 ms. Zero
    failures, zero timeouts across 5 interactions. The session is opened once per page and
    reused; no session is created per measurement.
  refactor_note: >
    The __auraPark binding body was extracted to `recordParkedEntry` (mirror + press
    measurement in one place) so the claim path can be driven without Codegen. `captureFor`
    was exported for the same reason `measureAtPress` and `splitCandidates` were.
    startLiveRecording remains the only production caller of both.
  no_backfill: >
    No historical recording was rewritten to populate the field. The corpus still has ZERO
    browser-verified names, so it has zero stability values, and none were fabricated.

# ------------------------------------------------------------------- 2026-09-07
p6_accessible_name_stability:
  status: DONE - experiment only. NO production file changed at all.
  pinned_by: ai/autocode/accessible-name-stability.fixture.ts
  answer: >
    YES, stability is objectively measurable - but ONLY with a slot-identity guard.
  method: >
    Two points the pipeline already has: the press (where measureAtPress reads the name
    today) and the settled point, reached by the APPLICATION'S OWN signal - the error
    label it renders, the menu it opens, a load state - never a sleep. The CDP call was
    reproduced in the harness rather than exported from live-recorder.ts, so this phase
    touched no production file.
  measured_live: >
    Password field  "Password" -> "Password Not too short! enter min 5 characters."  CHANGED
    Email field     "Email" -> "Email"                                               stable
    Sign In button  "Sign In" -> "Sign In"                                            stable
    Language toggle "English " -> "English " (expanded/collapsed)                     stable
    Mobiles link    the press did not park - guard fired                              unknown
    Replay in the settled state: press-time name 0, settled name 1, #password_field 1 in
    BOTH states. Three of four Bugasura controls went through the IDENTICAL validation
    flow and only one name moved, so the signal discriminates rather than suspecting
    every flow.
  the_methodological_finding: >
    The first run reported Flipkart's Mobiles link as `stable` carrying the name "Login
    Get access to your Orders..." - the login modal. The press had not parked an entry,
    so the newest slot still held an EARLIER element and measuring that stale slot twice
    produced two identical names and a confident, false `stable`. A stability signal
    without a slot-identity guard is wrong in the safe-looking direction. With the guard
    the same case correctly reports `unknown`.
  population_limit: >
    ZERO historical targets carry a browser-verified name or a proven role+name candidate
    - every recording predates Phase 2 - so no historical evidence could be used and none
    was fabricated. All positive evidence is live; the classifier is pinned synthetically.
  generalisation: >
    Only the validation-message category produced a change. Expanded/collapsed did not.
    One category, one application, five scenarios - too narrow to call a general
    phenomenon yet, and reported as such rather than generalised.
  proposed_but_NOT_implemented: >
    accessibleNameStable: 'stable' | 'changed' | 'unknown', fail-closed, with `unknown`
    covering a missing CDP session, a released slot, a navigation mid-measurement and a
    failed guard. Not added to the evidence schema. Ranking is untouched: role+name still
    scores 95, stable-id still 70.

# ------------------------------------------------------------------- 2026-09-07
p5_5_locator_quality_benchmark:
  status: DONE - benchmark only. NO production behaviour changed.
  pinned_by: ai/autocode/locator-quality-benchmark.fixture.ts
  headline: ZERO genuine ranking defects.
  corpus: >
    1026 captured graphs. 583 have at least one press-time proven candidate (56.8%);
    226 exactly one, 357 two or more. 443 have none - 163 fall to evidence-backed
    positional recovery and 280 are genuinely unresolved.
  selected_vs_independently_best: >
    Over the 357 targets with a choice to make: BEST 223 (62.5%), AMBIGUOUS 131 (36.7%),
    weaker-provenance 3 (0.8%). All 3 are targets where a proven candidate matches a
    declared Page Object capability and is not ranked first - and all 3 REUSE THE
    CAPABILITY ANYWAY, because findMethodByProvenLocator walks the whole ranked list.
    So the raw ranking never decides them and the defect count is zero.
  the_ambiguous_band_is_a_model_limitation_not_a_finding: >
    131 disagreements are all between `#scope .class`, scoped text and a bare class.
    Which of those survives the next deploy is an empirical question about the
    APPLICATION, not a property of the locator, so the benchmark refuses to order them
    rather than inventing a preference.
  what_actually_ships: >
    Measured on the 63 generated specs rather than on candidates: 312 Page Object method
    calls against 256 raw locator expressions - 54.9% reuse. Raw locators by family:
    filter(text) 79, css 67, getByRole 63, getByText 27, getByLabel 12, [attr] 7, #id 1.
    ZERO specs emit the raw scoped-text Sign In locator; 60 of 62 call loginPage.signIn.
  authored_id_is_always_chosen: 210 of 210 targets where an authored id is proven.
  the_one_measured_hazard: >
    Bugasura's password field, measured live in both states: the error-bearing accessible
    name matches 0 on a clean page and 1 with the error showing; "Password" matches 1 and
    0; `#password_field` matches 1 in BOTH. So BOTH accessible names are state-dependent
    and the id is not - yet ranking prefers role+name (95) over stable-id (70). Not a
    shipped defect: no generated spec uses it as a locator, and a 0-match locator fails
    the clean run so the falsification gate refuses the spec. It costs a generation, not
    a green lie. Recommended as the smallest Phase 6 change.
  ai_boundary: >
    Unchanged and re-verified: `eligibility` requires press-time proof, so a model is only
    ever asked about an element whose locator is ALREADY proven. AI is never reached in
    place of a missing deterministic locator.

# ------------------------------------------------------------------- 2026-09-07
p5_4_sibling_evidence_experiment:
  status: DONE - experiment only. NO production locator behaviour changed.
  decision: KEEP CAPTURE + REDESIGN LATER (no sibling locator strategy)
  pinned_by: ai/autocode/sibling-evidence.fixture.ts
  the_correction: >
    Phase 3 said sibling evidence was "consumed by nothing". That was scoped to
    `candidateSelectorsFor` and is WRONG about the pipeline: `associatedToggle` in
    ai/dashboard/recorder.ts reads the sibling list to prove a click on a custom toggle's
    visible part and a state assertion are about the same control. Measured: 98 targets
    across 60 distinct recordings have that shape (Bugasura's
    label > span.rounded-checkbox-ui beside input.bugChecked). Deleting the capture to
    save 199 bytes a target would break every one of them. REMOVAL IS OFF THE TABLE.
  why_no_strategy: >
    Of 401 form-control targets, the number immediately preceded by a <label> is ZERO -
    the motivating shape does not occur. What follows an input here is <i> (202) and
    <span> (185). 114 targets have an adjacent sibling that names itself; 102 of those
    have no proven candidate; 71 of THOSE are the recorder's own overlay; 26 of the rest
    already carry an authored id; the last 5 already generate 20-23 candidates each. The
    number with no candidate of any kind is ZERO. Measured live with the existing proof
    model over 7 targets: 1 sibling candidate built, 1 proven, on a target where
    production had already proven 2. Targets where a sibling candidate would be the FIRST
    proven locator: ZERO.
  the_hazard_avoided: >
    `#tooltip772416` is NOT flagged by the dynamic-identifier detector - no separator
    before the digits, so it reads as authored. A sibling-scoped strategy would have
    pinned a locator to one tooltip instance with nothing refusing it. Four corpus targets
    sit beside exactly that shape.
  storage: >
    Sibling evidence is 204,613 bytes of 5,715,143 graph bytes (3.6%), 199 B per target.
    Kept, because the toggle association needs it.

# ------------------------------------------------------------------- 2026-09-07
p5_3_attribute_order_and_redaction:
  status: DONE
  where: ai/autocode/dom-evidence.ts
  pinned_by: ai/autocode/attribute-order-redaction.fixture.ts
  ordering_fix: >
    The attribute family emitted its SCOPED variants last, so an element carrying `name`
    plus two of {aria-label, href} spent all three budget slots on unscoped shapes and
    lost the only member of the family that disambiguates - measured on Bugasura,
    `[name="email"]` matches 3 elements and `#loginForm input[name="email"]` matches 1.
    Scoped variants are now emitted FIRST, nearest scope first. No budget, cap, ceiling or
    ranking changed. At most two scopes are ever offered, so a budget of three always
    leaves at least one slot for an unscoped candidate - that is what makes the guarantee
    structural rather than lucky.
  ordering_effect: >
    Corpus unchanged in shape: 1026 graphs, 17271 raw, 16804 retained, 467 dropped by the
    family budget, ceiling never reached. The DROP MOVED from scoped-attribute (467) to
    attribute-pair (467) - the scoped candidate now takes the slot the unscoped pair used
    to. All 467 graphs that generate a scoped-attribute still keep at least one.
  redaction_fix: >
    `redactNode` dropped a node's text whenever its id CONTAINED a credential word, so
    `#password_field-error` - a <label> reading "Not too short! enter min 5 characters." -
    lost its text for mentioning a password. `holdsCredentialText` replaces the substring
    heuristic with two independent tests: the text itself looks like a secret
    (`looksLikeSecretValue`, applied to EVERY element), or the element could hold a typed
    value at all. The second is an ALLOW-LIST of text-only tags, so an absent tag, an
    unknown tag and a custom element all fail closed.
  redaction_is_strictly_stronger: >
    The old rule read only type/name/id, so a <div> displaying a JWT was kept in full
    because no attribute mentioned a credential. The content test now catches that. What
    is newly KEPT is only text on elements that cannot hold a value - labels, headings,
    paragraphs, links and buttons whose id merely mentions a password.
  not_done: >
    Sibling candidate strategies. The audit measured that sibling evidence is captured and
    consumed by NOTHING; that is a Phase 4B experiment, not an assumption to act on.

# ------------------------------------------------------------------- 2026-09-07
p5_2_evidence_consumption_audit:
  status: DONE - audit only, plus the one fixture-hygiene fix that was asked for
  pinned_by: ai/autocode/evidence-consumption.fixture.ts
  what_is_consumed: >
    Measured by CALLING the generator with one field added to a bare graph: role, own text
    (name-from-content), verified accessibleName, relative href, alt, authored id, name,
    placeholder, title, aria-label, data-testid, own classes, parent classes and an
    ancestor with an authored id all produce candidates.
  deliberately_unused: >
    generated id, ABSOLUTE href, aria idrefs, data-* other than a test id, children,
    descendants (they only DISQUALIFY a descend shape), previous/next siblings (no sibling
    strategy exists at all), scrollable/virtualized, and an unverified accessibleName on
    its own. Each is a decision with a reason, now pinned so a change is visible.
  budget: >
    1026 captured graphs, 17271 candidates generated raw, 16804 retained (97%). The family
    budget drops exactly ONE strategy - scoped-attribute, 467 times - and the total ceiling
    of 28 is never reached. 369 graphs sit at the structural cap of 16, unchanged.
  strongest_candidate_lost: >
    NO, measured: of the 467 graphs that generate a scoped-attribute, all 467 keep at least
    one. The drops are always the SECOND scope, never the nearest. BUT the attribute family
    is budgeted at 3 and emits scoped variants LAST, so an element carrying `name` plus two
    of {aria-label, href} spends every slot on unscoped shapes and loses every scoped one.
    Zero occurrences in the corpus (no captured element has both); reachable on newly
    recorded elements, and given a third route when href was added in P5.1. A coverage
    risk, not a correctness defect - nothing wrong is emitted.
  page_object_interaction: >
    The budget cannot cost a reuse today: NO knowledge file declares an attribute-shaped
    locator_strategy, so no declared capability is reachable only through a droppable
    candidate. Pinned as a tripwire rather than as a rule about the application.
  ai_boundary: >
    AI is not a locator fallback. `eligibility` is called directly by the fixture and
    refuses without press-time proof, with any SAFETY or STRUCTURAL refusal, with one
    unaskable semantic question beside an askable one, and with no semantic question at
    all. A model is only ever asked what to CALL an element whose locator is already proven.
  two_pre_existing_artifacts_found_by_the_audit: >
    Re-deriving candidates from a STORED sidecar loses some that were proven live, for two
    pre-existing reasons - `redactNode` drops the text of any node whose id contains
    "password" (so `#password_field-error`, a validation message, loses its content
    candidates), and the documented "recorded literal beats derived text" rule changed
    candidate text after those sidecars were written. NEITHER has production impact:
    production reads `derivedCandidates` from the sidecar and never regenerates them.
  fixture_hygiene_fixed: >
    recorded-lifecycle.fixture.ts now runs inside enterIsolatedArtefactRoot, seeding the
    temporary root with the Page Objects, knowledge and mapping it READS (copies, never
    links). It proves the real store is unchanged by listing it before and after. The
    global quarantine pile is exempt and cleaned by name - orchestrate.ts states it is
    deliberately global. The bugasura recording count is now 409, not 410: the 410 included
    the leaked TC_TEST_A.

# ------------------------------------------------------------------- 2026-09-07
p5_1_target_snapshot:
  status: DONE
  where: >
    ai/autocode/dom-capture-source.ts (describe(node, isTarget): href/hrefAbsolute/alt,
    accessibleNameSource/Verified; one appended non-qualifying ancestor),
    ai/autocode/dom-evidence.ts (DomNode fields, redactNode allow-list, hrefCarriesSecret,
    href + alt candidates, verified-name preference),
    ai/dashboard/live-recorder.ts (accessibilitySession, browserAccessibleName, applied at
    both capture sites before candidates are derived).
  pinned_by: ai/autocode/target-snapshot.fixture.ts
  decision: >
    The BROWSER'S computed accessible name is authoritative when CDP is available; the
    in-page aria-label/title value is a fallback, always marked unverified, and only a
    verified name outranks the attribute sources in candidate generation.
  measured: >
    Snapshot +316 B on 2215 B (+14%) against a +232% superset probe. Flipkart Mobiles
    1 candidate -> 6; Home the same; both now carry an href candidate measured at exactly
    one element with identity proven. alt="Image" measured 58 and was refused, which is the
    ambiguity case working. Bugasura Email/Sign In choose role+name on the browser's own
    name; password_field-error is unchanged.
  the_state_dependent_name: >
    Bugasura's password field computes as "Password" before its validation error exists and
    as "Password Not too short! enter min 5 characters." after. Both are correct records of
    the instant of the press; a real recording focuses the field first and gets the former.
    An element whose accessible name folds in transient text yields a state-dependent
    role+name locator - the falsification gate catches it (the clean run fails) rather than
    shipping it. Verified in both orders.
  deliberately_not_built: >
    Full DOM (474 KB, 214x the snapshot, 479 MB across the corpus), before/after snapshots
    (+100% for a signal in which NONE of the target's own fields changed), page-level
    accessibility snapshots, sibling capture changes (no strategy consumes siblings),
    value capture, broad ancestor expansion. Two plain ancestors lost a candidate on one
    live target; any rule that reorders or scores them lost candidates on two.
  identity_unchanged: >
    Across every real look-alike pair on Bugasura the richer snapshot added NO
    distinguishing power - id already separated all of them. Identity is still
    targets[slot] === element against the parked node.

# ------------------------------------------------------------------- 2026-09-05
p5_locator_engine:
  status: DONE
  where: >
    ai/autocode/dom-evidence.ts (semanticCandidatesFor, familyOf, applyFamilyBudget,
    implicitRole), ai/autocode/locator-quality.ts (scoreChain, scoreExpression,
    GENERATED_CLASS), ai/dashboard/live-recorder.ts (measureExpressionCandidates,
    READ_PARKED_TARGET, the recorded-locator measurement in takePreAction),
    ai/autocode/abstraction/classify.ts (rankProvenCandidates),
    ai/autocode/from-recording.ts (findMethodByProvenLocator).
  pinned_by: ai/autocode/semantic-candidates.fixture.ts
  measured_before: >
    Over 1058 recorded targets (1026 with a captured graph): `identityMatched` absent on
    ALL 1058 recorded locators; 510 recorded locators counted exactly 1 in the press's own
    document with identity never asked; 443 targets with no press-time proven candidate,
    137 of which carry such a recorded locator; Flipkart's Mobiles link built 0 candidates.
  measured_after: >
    Generation 13024 -> 16804 candidates (x1.29); targets with zero candidates 3 -> 0;
    structural portion never exceeds MAX_CANDIDATES=16 (0 targets) and nothing exceeds
    MAX_TOTAL_CANDIDATES=28 (0 targets); 247 previously-unproven targets now generate a
    new-family candidate and 63 gain role+name. Ranking over the sidecars' OWN press-time
    candidates: 357 targets have more than one proven candidate, 198 selections change,
    166 to a higher-scoring locator, 0 to a lower-scoring one.
  verified_live: >
    Through the REAL press-time path - production PREACTION_HOOK, production `__auraPark`
    binding, a real pointerdown, production `measureAtPress`/`splitCandidates`/
    `rankProvenCandidates`. Mobiles: 0 candidates -> `getByRole("link", { name: "Mobiles",
    exact: true })` proven. Become a Seller: positional recovery -> role+name proven (5
    proven candidates). Home: `exact: true` resolves 1 where the non-exact recorded form
    resolves 2. Sign In: role+name replaces `#loginForm .login-submit` filtered by text.
    Email/Password/password_field-error: unchanged, the authored id still wins on a tie.
    iPhone: not present on the page reached, and NOTHING was invented for it.
  two_real_regressions_found_by_the_corpus: >
    1. Ranking tie-broken on the STRONGEST segment put a scoped-text chain above
    `#create_team_cancel_btn` and cost TC_LOGIN_126/127 their Page Object reuse. Fixed by
    breaking on the simpler chain - scoping is already paid for inside the score.
    2. `findMethodByProvenLocator` read only the top-ranked candidate. It now walks the
    whole ranked list, with every existing refusal intact.
    Both were caught by po-discovery.fixture.ts and abstraction.fixture.ts going red, and
    both were fixed in the code rather than in the fixtures.
  deliberately_not_done: >
    Ancestor capture and DOM snapshot capture are UNCHANGED. 83 of 1026 captured graphs
    still have zero ancestors; href, alt and the computed accessible name are still not
    captured, so `getByAltText`, any href candidate and an input's accessible name remain
    underivable and are refused rather than guessed. That is the next controlled phase.
  known_pre_existing_hygiene_gap: >
    ai/autocode/recorded-lifecycle.fixture.ts writes a synthetic TC_TEST_A through the real
    `acceptRecording`, leaving ai/dashboard/recordings/bugasura/accepted/TC_TEST_A.spec.ts
    behind - the directory is git-ignored and no real recording is touched, and the
    documented count of 410 INCLUDES it (409 without). Not introduced by P5; it is the last
    fixture still operating on the live artefact root rather than an isolated one.

# ---------------------------------------------------------------- 2026-08-22..24
# Eight phases, each approved separately. Every one verified by its own fixture and by
# replaying the real recordings; no locator strategy was added and no safety rule moved.
sessions_2026_08_22_24:
  - name: timing-aware assertion evidence (provesIdentity)
    where: ai/autocode/dom-evidence.ts + 6 consumers
    what: >
      `isProvenAtPick` existed and NO consumer used it. An assertion's own pick-time
      measurement was discarded for saying `pick`, so TC_LOGIN_123's three assertions fell
      past a byte-identical existing method to `.tabulator-table … .nth(0|1)`. ACTION still
      demands a press; only an assertion may act on its pick. 16 assertions across 11 cases
      gained a proven candidate.
    fixture: ai/autocode/assertion-pick-reuse.fixture.ts
  - name: assertion provenance reaches the abstraction engine
    where: ai/autocode/abstraction/propose.ts (evidenceForAssertionSubject fallback)
    what: a pick capture is unreachable by locator string BY DESIGN, so the join was blind to it.
  - name: faithful locator reconstruction
    where: ai/dashboard/live-recorder.ts (chainMethodsIn, REBUILDABLE, ROLE/TEXT_OPTIONS)
    what: >
      `buildLocator` stepped over calls it did not know and dropped options it did not read.
      `.filter({hasText})` and `exact: true` were both silently discarded, so the page was
      asked to count a BROADER locator - 1 measured as 2, live-verified twice. Now it rebuilds
      the whole chain faithfully or returns null; an unknown measurement is a fact, a wrong one
      is not.
    fixture: ai/dashboard/locator-reconstruction.fixture.ts
  - name: the gate can read an accepted case's evidence
    where: ai/autocode/verify.ts (provenPositionalExpressions -> evidencePath, then archivedPath)
    what: >
      acceptRecording MOVES evidence to recordings/accepted/, and the gate read only the live
      path - so 7 accepted specs could no longer pass the gate that accepted them (0 of 7 ->
      7 of 7). Same predicate either way.
    fixture: ai/autocode/archived-evidence-gate.fixture.ts
  - name: knowledge declarations that resolvers can actually reach
    where: ai/knowledge/page/bugasura__apps.yaml, bugasura__root.yaml
    what: >
      A capability declared with no selector and no accessible name is INVISIBLE to every
      resolver, and one declared with no implementation is invisible to duplicate detection.
      The first sent TC_LOGIN_127's Cancel to a model to have its owner guessed when
      ProjectsPage.createTeamCancelButton() already existed; the second let the engine write a
      second capability for #password_field-error. Resolver questions: 127 1->0, 126 2->1.
    fixture: ai/autocode/po-discovery.fixture.ts
  - name: an owner nothing declares is not an owner
    where: ai/autocode/abstraction/propose.ts (resolveOwner rule 2)
    what: >
      The rule derived a component class name from a dialog and returned it as though knowledge
      declared it; the writer then refused, and being all-or-nothing took two sound proposals
      with it. It now refuses HERE, naming the class to declare.
  - name: writer/lifecycle diagnostics
    where: ai/autocode/abstraction/lifecycle.ts (REFUSED_WRITER_BLOCKED + LifecycleDiagnostic)
    what: >
      A validated proposal the writer did not persist was reported as REFUSED_NO_ADMISSIBLE_EVIDENCE
      - a false statement about evidence that was proven. Seven diagnostics now distinguish
      WRITER_BLOCKED from BATCH_ROLLED_BACK, with the writer's own problems verbatim.
  - name: unattributable uniqueness is not uniqueness (structural gate)
    where: ai/autocode/locator-quality.ts (isUnscopedStructuralLocator + structurallyAttributable)
    what: >
      A count of ONE taken after the action, in a document nothing can name, suppressed
      `measuredAmbiguity` - so `page.locator('h2')` reached a spec and failed strict mode on 3
      elements. The structural twin of the bare-getByText gate refuses a bare tag or class whose
      uniqueness is not attributable. Touches 110 of 694 emitted decisions, 104 of them the
      recorder's own overlay. TC_DASHBOARD_023's original .bugChecked failure is now refused
      offline too.
    fixture: ai/autocode/strict-mode-locator.fixture.ts

# ---------------------------------------------------------------- 2026-09-04
# PHASE 2 - APPLICATION REGISTRY + AUTHORITATIVE SCOPE.
# Phase 1 (registry, scope, isolation gate, knowledge layer, CRLF parser) was landed by
# the previous session and VERIFIED here by running it, not by trusting it.
application_isolation_phase_2:
  state: >
    COMPLETE for every artefact class in ScopePaths; see remaining_global for what is
    deliberately still global and why.
  invariant: >
    No application-specific artefact may be resolved outside the active applicationId
    scope unless it is explicitly declared as a shared framework capability.
  gate: ai/projects/isolation.fixture.ts - 98 checks (was 52), 0 failures
  behaviour_today: >
    UNCHANGED, and that is a measurement rather than a claim. Bugasura is the sole
    registered application, so `layoutFor` returns the flat directory for every artefact
    class and all six ScopePaths entries resolve to the paths that existed before this
    work. Verified three ways: every path printed and compared, the abstraction corpus
    tally identical before and after (90 proposals - 66 NEEDS_REVIEW, 12 REUSE,
    11 REFUSED, 1 PROPOSED), and the generated fixture import string byte-identical
    (`./pages/notifications.panel`).

  # ---- the CRLF fix was not cosmetic. Establish this before doubting anything else.
  yaml_parser_was_a_total_breakage:
    what: >
      The committed knowledge YAML blobs contain CRLF (343 CR lines in
      bugasura__apps.yaml), so the pre-fix line-oriented parser threw
      "Unexpected indentation on line 73" on 2 of the 3 files ON EVERY PLATFORM, not
      only on Windows. `readAllPageKnowledge` rethrows, so the generator was dead in any
      fresh checkout.
    verified_by: running the HEAD parser against the files on disk, both parsers side by side
    consequence: >
      `abstraction.fixture.ts` could not even LOAD before the fix. Its 2 red checks are
      therefore newly VISIBLE, not newly caused - see abstraction_fixture_red.

  # ---- what changed, by artefact class
  scope_paths_final:
    pagesDir: tests-e2e/pages -> tests-e2e/pages/<applicationId>
    knowledgePageDir: ai/knowledge/page -> ai/knowledge/page/<applicationId>
    recordingsDir: ai/dashboard/recordings -> ai/dashboard/recordings/<applicationId>
    generatedDir: tests-e2e/generated -> tests-e2e/generated/<applicationId>
    mappingFile: ai/test-mapping/mapping.json -> ai/test-mapping/<applicationId>.mapping.json
    fixturesFile: tests-e2e/fixtures.ts -> tests-e2e/<applicationId>.fixtures.ts
    added_this_phase: [fixturesFile, soleApplication]
    why_fixturesFile: >
      The fixture NAME is derived from the class name (LoginPage -> loginPage), so two
      applications registering into one file do not conflict - the second registration
      finds the name present, returns the source UNCHANGED, and every spec that
      destructures `loginPage` silently gets the FIRST application's class. `verify()`
      then passes because `index.fixtures` contains the name. A shared file makes that
      invisible; a file per application makes it impossible.
    file_layout_rule: >
      `scopedFilePath` is the FILE twin of `layoutFor`: `<dir>/<applicationId>.<suffix>`
      preferred, `<dir>/<suffix>` only while one application is registered. Same
      migration affordance, same refusal once a second is registered.

  # ---- the two defects in the Phase 1 code, both HIGH, both fixed
  bare_catch_defeated_the_refusal:
    where: ai/knowledge/canonical.ts activeApplicationId, ai/knowledge/page-knowledge.ts activeKnowledgePageDir
    was: >
      `try { resolveScope()... } catch { return LEGACY }`. With two applications
      registered and none selected, `resolveScope` throws a ScopeError BY DESIGN - and
      the bare catch swallowed it and answered with the flat directory / with
      applicationSlug(BASE_URL). So the multi-application refusal was defeated, and
      defeated in the direction that reinstates the URL derivation the registry exists
      to abolish.
    now: >
      One place decides it - `activeScopePath` in scope.ts - and a ScopeError is
      RETHROWN. Only a missing registry.json reaches the legacy path. The try block
      holds one call and nothing else.

  read_write_symmetry:
    knowledge: SCOPED both ends (readAllPageKnowledge / canonicalFile + writer.knowledgeDir)
    page_objects: SCOPED both ends (buildIndex(scope) / writer.pageFilePathFor)
    fixtures_module: SCOPED both ends (buildIndex reads scope.paths.fixturesFile / writer.fixturesFile)
    recordings: SCOPED both ends (recorder.recordingsDir; case-status and propose now import it)
    evidence: SCOPED - verify.ts reaches it through the recorder's own evidencePath/archivedPath
    generated_specs: SCOPED for write and for independence.ts; mapping sync still scans the whole tree
    mapping: SCOPED both ends (activeMappingFile is the default of readMapping and writeMapping)
    was_mixed_and_is_the_reason_this_matters: >
      canonicalFile() named the FLAT PAGE_DIR while readAllPageKnowledge read the scoped
      one. Not an error - the write lands, the read finds nothing, and the generator
      concludes the screen was never explored and re-explores a page it had already
      written down. Silent, and it costs a browser and a second drifting copy.

  # ---- collision removals that were not path constants
  other_leaks_closed:
    - where: ai/autocode/groups.ts
      was: "application = new URL(BASE_URL).host - identity parsed out of a URL, and it is part of the group KEY"
      now: activeApplicationId(); `environment` stays BASE_URL, which is what a base URL genuinely is
    - where: ai/dashboard/live-recorder.ts
      was: LIVE_RECORDING_DIR - a THIRD hardcoded spelling, with no importer and no use
      now: removed, with a comment saying why it must not come back
    - where: ai/knowledge/index.ts writeIndex
      was: one application's Page Objects written into the declared-shared framework directory
      now: framework.yaml while sole, framework.<applicationId>.yaml afterwards
    - where: ai/autocode/work.ts frameworkFingerprint
      was: >
        hashed a hardcoded flat `tests-e2e/pages`, non-recursively. Under a scoped layout
        the scan finds nothing and returns [] - so the fingerprint SILENTLY stops covering
        Page Objects and the attempt budget never reopens when one is fixed. Fails open.
      now: derived from scope.paths.pagesDir, still repo-relative so the hash is unmoved
    - where: ai/projects/registry.ts
      was: applicationId "accepted" was admissible
      now: >
        RESERVED_APPLICATION_IDS. `layoutFor(recordings, 'accepted')` IS the archive
        every other application's acceptedDir() returns - a cross-application leak
        arriving through a NAME rather than a code path, which no downstream scoping
        would catch.

  selection_seam:
    added: AURA_APPLICATION / AURA_ENVIRONMENT / AURA_REGISTRY_FILE
    why: >
      The isolation gate cannot prove anything about two applications while only one is
      registered. These let it declare a second in a temp registry and drive the REAL
      accessors. Unset - which is every current invocation - nothing changes.
    not_a_bypass: an unknown id is a ScopeError, never a fallback to the other application

  # ---- what is still global, deliberately, with the reason
  remaining_global:
    - path: tests-e2e/support/
      why: SHARED_CAPABILITY - resilient-locator, env, steps, generic-form. No application owns it.
    - path: ai/knowledge/framework/
      why: declared shared; its one application-specific product (framework.yaml) is now named per application
    - path: ai/autocode/state.json, ai/autocode/quarantine/
      why: >
        Keyed by bare Test Case ID and genuinely collidable, but they are the generator's
        own bookkeeping rather than automation, and moving them changes what
        frameworkFingerprint and the attempt budget MEAN. Scope with the budget, not with
        the paths.
    - path: ai/dashboard/runs/, ai/dashboard/generations/, ai/reports/*
      why: >
        `results` and `history` ARE application artefacts and these are unscoped. The
        five-record generation cap is global, so one application's generations would
        evict another's. Not touched: they are Phase 3's execution/history surface.
    - path: ai/test-data/<workbook-basename>.data-driven.json
      why: keyed by workbook BASENAME; two applications with same-named workbooks collide
    - path: tests-e2e/support/env.ts BASE_URL and BUGASURA_* credential names
      why: >
        The registry declares environments[].baseUrl, baseUrlEnv and credentials BY NAME,
        and env.ts reads none of it. Verified they AGREE exactly today
        (BUGASURA_BASE_URL / BUGASURA_EMAIL / BUGASURA_PASSWORD, default
        https://my.bugasura.io/), so this is an unwired declaration, not a conflict.
        Runtime wiring is Phase 3 - env.ts is imported by specs and by the Playwright
        config, and scope.ts uses node:fs at module load.
    - path: playwright.excel.config.ts testDir + reporter output directories
      why: one testDir, one baseURL, one results/allure/report path for every application
    - path: ai/excel/cli.ts scanSpecs / scanDataDrivenRunners
      why: scans the whole tests-e2e tree, so `mapping sync` would see every application's specs
    - path: ai/dashboard/server.ts
      why: >
        No applicationId in the request surface, the child-process argv or any persisted
        record; the default workbook is a hardcoded literal. `resetActiveApplication()`
        exists FOR the dashboard and is still called by nothing but the isolation gate.

  recording_migration:
    state: "PLANNED AND DRY-RUN VERIFIED, NOT PERFORMED. Blocker below."
    script: ai/projects/migrate-recordings.ts (--dry-run first; transactional otherwise)
    inventory: 410 artefacts, 9.5 MB - 306 live + 104 archived under recordings/accepted/
    target: ai/dashboard/recordings/bugasura/ (+ .../bugasura/accepted/)
    references_found: >
      ZERO. Nothing in mapping.json, ai/autocode/state.json, ai/dashboard/generations/,
      ai/dashboard/runs/, ai/reports/, tests-e2e/ or the workbook names the recordings
      path, and no artefact contains an absolute path. Recordings are reached only by
      Test Case ID through the recorder's accessors. The one hit,
      ai/reports/pre-rerecord-backup/MANIFEST.sha256, names its OWN backup copy.
    no_import_problem: >
      A recording's .spec.ts imports @playwright/test and nothing else, and the directory
      is outside testDir, so Playwright never collects it. This is what makes recordings
      migratable while Page Objects and generated specs are NOT - those carry relative
      imports (`from '../fixtures'`, `from '../pages/issues.page'`,
      `from '../support/resilient-locator'`) that one extra directory level breaks.
    BLOCKER: >
      32 offline fixtures name `ai/dashboard/recordings/...` as a LITERAL path
      (abstraction, locator-quality, dom-evidence, evidence-*, proven-locator-reuse,
      strict-mode-locator, assertion-*, parked-claim, ...). The brief's condition was
      "if it can safely perform the migration WITHOUT BREAKING REFERENCES" - a fixture
      is a reference, so the condition is not met and nothing was moved.
    to_unblock: >
      Give the fixtures one accessor for the corpus directory instead of 32 literals,
      then run the script. It stages under a name layoutFor cannot select, sha256-verifies
      every file, keeps a backup outside the tree, swaps, re-confirms through the real
      accessors and the artefact count, and only then removes the originals.
    do_not: >
      Never `mv` this by hand. ai/dashboard/recordings/ is GIT-IGNORED - there is no
      history to restore from - and a half-finished move is SILENT, because layoutFor
      prefers <dir>/<applicationId>/ the moment it exists and everything left behind
      simply stops existing.

  regression:
    fixtures: 56
    red: 1
    red_is: ai/autocode/abstraction.fixture.ts
    command: "for f in $(find ai -name '*.fixture.ts' | sort); do npx tsx $f; done"
  and_then: "find ai/dashboard/recordings/bugasura -type f | wc -l   # must be 409"   # was 410; that number included the leaked TC_TEST_A

  first_real_second_application_run_2026_09_05:
    milestone: >
      TC_SMOKE_004 completed the whole pipeline for a NON-legacy application against the
      live flipkart.com: recorded in the Dashboard, assembled from 4 recorded actions and
      1 assertion, spec written to tests-e2e/generated/flipkart/, clean run PASSED, mutated
      run FAILED, verdict ACCEPTED. accepted 1, quarantined 0, declined 0, failed 0.
    rc6_fixture_module_bootstrap:
      symptom: "Cannot find module '../../flipkart.fixtures' at collection"
      cause: >
        The seed lived inside `applyProposals`, in the loop over eligible PROPOSALS, so it
        ran only when a Page Object was created. All five of TC_SMOKE_004's elements were
        correctly REFUSED_NO_ADMISSIBLE_EVIDENCE, so there were zero proposals, the loop
        body never ran, and the spec was still written importing a module guaranteed not to
        exist. Creating a Page Object and needing somewhere to destructure it from are two
        different facts, and only the second is what a spec depends on.
      fix: >
        `ensureFixturesModule()` in ai/autocode/abstraction/writer.ts, called from
        ai/autocode/orchestrate.ts beside the existing `mkdirSync(generatedDir())` - the
        point where the run already prepares its output destinations, and the one boundary
        both the recorded and agent paths cross. Generation, not provisioning: provisioning
        alone would not make the invariant true, because Flipkart was already provisioned
        without one and a module can be deleted.
    rc7_authoring_sidecar_scope:
      cause: >
        ai/dashboard/server.ts called `rememberRecordingFingerprint(savedRow)` with no
        scope, so it fell to the AMBIENT scope - the legacy owner - whatever project was
        selected. Measured: saving Flipkart's TC_SMOKE_004 wrote its .authoring.json into
        ai/dashboard/recordings/bugasura while the recording went correctly to
        recordings/flipkart. The sidecar decides whether a recording is STALE, so it was
        answering that question for the wrong project. Same cause as the TC_SMOKE_002/003
        sidecars found earlier.
      fix: "the selected scope is resolved once and passed to both the sidecar write and
        `activate()`. It was already computed two lines below for the latter."
    evidence_trace_mobiles_iphone:
      finding: NOT a generator defect and NOT a race.
      measured: >
        candidatesTried: ✕ 2, Mobiles 0, iPhone 0, Become a Seller 3. The Mobiles/iPhone
        rows captured `{tag:'a', text:'...'}` and nothing else - no id, no surviving class,
        no aria, no data-*, and zero ancestors - so `candidateSelectorsFor` built no shapes.
        `pressTimeText` DID measure the one remaining signal: "Mobiles" matched 14 elements
        with identityMatched false. The refusal is correct.
      identified_limitation: >
        ai/autocode/dom-capture-source.ts line ~75 records an ancestor only when it is a
        container tag, or has a `role`, or has an `id`. A nav link wrapped in plain divs
        therefore contributes ZERO ancestors, so container-scoped candidate shapes that
        could disambiguate "Mobiles" from the other 13 can never be built. "Become a Seller"
        got 2 ancestors because one is a <footer>. This is a capture limitation, not policy
        - widening it would change evidence for the existing 410-recording corpus, so it
        needs its own measured phase. NOT changed here.
    fixture: "ai/projects/application-pipeline.fixture.ts - 95 checks (RC6 10, RC7 6 added)"

  n_application_completion_2026_09_05:
    incident_first: >
      A REGRESSION RUN DESTROYED A USER'S FLIPKART RECORDINGS.
      `ai/projects/dashboard-scope.fixture.ts` used `flipkart` as a synthetic applicationId
      and ended with `fs.rmSync(selected.paths.recordingsDir, { recursive: true })`. The
      registry was synthetic but `pathsFor` builds under the repository root, so the path
      was the REAL `ai/dashboard/recordings/flipkart`. TC_SMOKE_002/003 .spec.ts and
      .evidence.json were unrecoverable - recordings are git-ignored and only Bugasura has
      a backup. Same shape as the earlier incident that cost Bugasura 410 artefacts.
    recovery: >
      Two misfiled sidecars (TC_SMOKE_002/003.authoring.json) were found in Bugasura's
      store, written there by the pre-fix RC1 defect. Ownership was PROVEN, not inferred:
      `recordingFingerprint` recomputed from each candidate workbook row matched only the
      Flipkart rows. Moved to ai/dashboard/recordings/flipkart with byte-identical digests
      (72d42aec.., 63deacb5..). Bugasura back to exactly 410, its digest unchanged.
    fixture_filesystem_isolation:
      problem: "a synthetic applicationId + real ScopePaths + recursive delete = real data loss"
      fix: >
        `AURA_ARTEFACT_ROOT` in ai/projects/scope.ts redirects EVERY application artefact
        path at once, and ai/projects/fixture-safety.ts provides
        `enterIsolatedArtefactRoot` / `leaveIsolatedArtefactRoot` / `removeFixtureTree` /
        `isInsideFixtureRoot` / `assertAbsent`. Two independent barriers: isolation makes
        the dangerous path UNNAMEABLE, and the guarded delete refuses anything outside the
        active fixture root - including when no isolation is active, which is fail-closed.
      mutation_tested: >
        M1 removeFixtureTree on a real path with isolation active -> refused, 410 intact.
        M2 removeFixtureTree with NO isolation -> refused, flipkart intact.
        M3 isolation redirects a real resolve into the temp root and restores on leave.
      audit: "11 fixtures resolve scope AND delete; 7 delete a scope-derived path; only
        dashboard-scope.fixture.ts deleted a whole scoped tree, and it is now isolated."
    rc4_closed: >
      `credentialsFixtureName()` (ai/autocode/abstraction/writer.ts) reads the name from the
      APPLICATION'S OWN fixtures module - the first declared fixture matching
      /\w*[Cc]redentials/. Legacy module -> `bugasuraCredentials`, seeded module ->
      `appCredentials`, none declared -> null and no sign-in emitted. from-recording.ts
      (5 sites), writer.ts (the factory anchor, now matched by shape) and agent.ts (the
      prompt) all derive it. FIXTURE_ORDER ranks a credentials fixture by SHAPE, not name.
      No hardcoded credentials capability remains in the generation path.
    recorded_pipeline_answer: >
      "no Codegen artifact was kept for this case" is emitted by `generateFromRecording`
      when `readArtifact` returns null, and `readArtifact` resolves through
      `activeRecordingsDir()`. It was RC1: the recording was in recordings/flipkart while
      the run was scoped to bugasura. Proven end to end in part `recorded pipeline` - the
      owner finds its artefact, another application with the SAME id finds nothing, and
      each looks only in its own store.
    fixture: "ai/projects/application-pipeline.fixture.ts - 79 checks"
    regression: "65/65, 0 failures. Recordings 410/2/411 unchanged by the run."
    remaining_legacy_fallbacks: >
      `layoutFor`'s flat fallback for the single DECLARED legacyLayout owner (Bugasura),
      which is the documented migration affordance and expires per artefact class; and
      `activeScope()`'s ambient default to that same declared owner, for pre-scope CLIs.
      Both are declared, at most one application can hold them, and no other application
      can reach them. No application-SPECIFIC hardcoded fallback remains.

  n_application_pipeline_2026_09_05:
    phase: >
      End-to-end application isolation for the Record -> Generate -> Run pipeline, driven
      by a REAL Flipkart failure rather than by fixtures.
    reported_symptoms: >
      Flipkart provisioned from the dashboard, a case recorded, and generation selected
      bugasura__root.yaml / bugasura__apps.yaml / bugasura__issues-id.yaml, canonical page
      bugasura__root, used tests-e2e/fixtures.ts, created no Flipkart directories, and said
      "no Codegen artifact was kept for this case" about a recording that existed.
    first_scope_loss_point: >
      ai/autocode/orchestrate.ts `run(options)`. It receives `options.workbook` - whose
      owner the registry declares - and never converted it into a scope. Every
      application-owned path in the generation subsystem resolves through
      `activeScopePath` -> `activeScope()`, which with no selection answers with the
      AMBIENT scope: the declared legacyLayout owner. So the whole run belonged to
      Bugasura. `ai/dashboard/server.ts` spawning the generator without AURA_APPLICATION is
      where it becomes visible, but the CLI path (`npm run excel:autocode -- <wb>`) had the
      identical hole, so the fix belongs at `run()`, the one boundary all entry points cross.
    root_causes:
      RC1: "generation never established scope from its workbook (THE first scope-loss point)"
      RC2: >
        a newly provisioned application has no fixtures module: `applyProposals` did
        `fs.readFileSync(fixturesFile())` (ENOENT) and `registerFixture` needed an existing
        Page Object import group to anchor to, which a first registration has none of. The
        step meant to SEED a namespace was the one step that could not run.
      RC3: "the writer wrote files without creating their directory (ENOENT on tests-e2e/pages/<app>)"
      RC4: "the credentials fixture NAME is the literal `bugasuraCredentials` - REPORTED, NOT FIXED"
      RC5: >
        `ai/knowledge/canonical.ts` keeps its own `cachedApplicationId`, derived from the
        scope and not invalidated by a scope change - so a stale memo answered with the
        previous application, and page identity names every knowledge file.
    fixes:
      - "ai/projects/scope.ts: `pinActiveScope(request)` - state the application from something
         authoritative, once, at an entry point. Plus `onScopeChange` so derived memos die with
         the scope (scope.ts cannot import canonical.ts, which imports it)."
      - "ai/autocode/orchestrate.ts: `pinActiveScope({ workbook: options.workbook })` at run()."
      - "ai/knowledge/canonical.ts: registers its invalidator."
      - "tests-e2e/support/base-fixtures.ts (NEW): the application-INDEPENDENT half of a fixtures
         module - healing, step, trace, the require* guards, and neutral appCredentials/appEmail.
         tests-e2e/fixtures.ts (Bugasura's, legacy) is deliberately untouched."
      - "ai/autocode/abstraction/writer.ts: `emptyFixturesModule()` seeds a module with NO Page
         Objects; `registerFixture` anchors on its markers when there is no import group; the
         commit step mkdirs before writing."
    measured_after: >
      excel/flipkart-test-cases.xlsx now resolves applicationId=flipkart, canonical=flipkart,
      recordings ai/dashboard/recordings/flipkart (finds TC_SMOKE_002/003), knowledge 0 files
      in ai/knowledge/page/flipkart, pages tests-e2e/pages/flipkart, fixtures
      tests-e2e/flipkart.fixtures.ts, generated tests-e2e/generated/flipkart, mapping
      ai/test-mapping/flipkart.mapping.json. Bugasura resolves exactly what it always did.
    fixture: "ai/projects/application-pipeline.fixture.ts (48 checks: RC1, RC2/RC3, RC5, A-N matrix)"
    outstanding: >
      RC4. `from-recording.ts` (1016, 1386, 1462, 1507-1508), `abstraction/writer.ts` (216)
      and `agent.ts` (308) hardcode `bugasuraCredentials`. It only bites an AUTHENTICATED
      flow for a non-legacy application; the neutral `appCredentials` already exists in
      base-fixtures.ts, so the fix is to emit the name from the scope. Not attempted here.

  exploration_credentials_scoping_2026_09_05:
    phase: The last known shared-runtime Bugasura fallback. demoapp still NOT provisioned.
    was: >
      tests-e2e/support/env.ts explorationSource() resolved the GENERATION browser account
      from three Bugasura-spelled steps and ended
      `?? { email: 'BUGASURA_EMAIL', password: 'BUGASURA_PASSWORD' }`. Whichever application
      was selected, the generator would have signed in with Bugasura's account, against
      Bugasura's live product, to read a DOM it would then describe as another application.
      All three steps were the hole, not only the literal: BUGASURA_EXPLORATION_USER set for
      Bugasura would equally have served demoapp.
    now: >
      The variable-name PREFIX is derived from the active applicationId
      (`bugasura` -> `BUGASURA_`, `demoapp` -> `DEMOAPP_`), so all three steps are scoped:
      <APP>_EXPLORATION_PROFILE, then <APP>_EXPLORATION_USER/_PASSWORD, then the
      application's OWN registry-declared credentials. No literal and no step past that.
      `explorationSource()` is now nullable - null is the fail-closed answer - and
      MISSING_EXPLORATION_CREDENTIALS_REASON became
      `missingExplorationCredentialsReason()`, computed so it names the variables actually
      looked at.
    bugasura_unchanged: >
      Because its applicationId IS `bugasura`, every variable keeps its exact spelling:
      BUGASURA_EXPLORATION_PROFILE / _USER / _PASSWORD still work, and step 3 resolves the
      same BUGASURA_EMAIL / BUGASURA_PASSWORD its registry entry declares. .env needs
      nothing changed and ai/autocode/exploration-auth.fixture.ts still passes on the same
      assertions.
    feature_preserved: >
      A different account for exploration is still supported - it is now named per
      application. Proven by M9: DEMOAPP_EXPLORATION_USER gives demoapp its own exploration
      account, and M10 shows that setting it changes nothing for Bugasura.
    contract_change:
      - "explorationSource(): { email, password } -> { email, password } | null"
      - "MISSING_EXPLORATION_CREDENTIALS_REASON (const) -> missingExplorationCredentialsReason()"
      - "consumers updated: ai/autocode/session.ts, ai/autocode/exploration-auth.fixture.ts"
    fixture: "ai/projects/provisioning-isolation.fixture.ts part M (15 checks; 142 total)"
    residual_bugasura_references: >
      None are credential RESOLUTION. The notable one is ai/dashboard/recorder.ts:837,940,
      which sweeps ['BUGASURA_PASSWORD','BUGASURA_TOKEN'] out of a recording - a REDACTION
      list, not a resolution, so a second application's secrets would not be scrubbed from
      its recordings. Separate concern, not touched here. The rest are fixtures, the demo
      workbook's own content, doc/error examples of the variable-NAME format, Bugasura's own
      spec messages, .env.example and CI secrets.

  runtime_env_scoping_2026_09_05:
    phase: >
      The two remaining shared-runtime Bugasura fallbacks, found while auditing what
      demoapp would need to run. demoapp itself was NOT provisioned in this step.
    defect_1_base_url:
      was: "tests-e2e/support/env.ts:14  BASE_URL = process.env.BUGASURA_BASE_URL ?? 'https://my.bugasura.io/'"
      why_it_mattered: >
        `tests-e2e/generic/generic.spec.ts` is the wildcard data-driven runner, collected
        for EVERY application, and it navigates using BASE_URL. Measured before the fix:
        AURA_APPLICATION=demoapp resolved https://my.bugasura.io/ while its registry entry
        declared https://demoapp.invalid/. Worse than the workbook defect in consequence -
        my.bugasura.io is a live product with real teams, so it pointed another project at it.
      now: "activeScope().baseUrl, eager, and it THROWS when no application is selectable."
      env_override_preserved: >
        BUGASURA_BASE_URL still redirects Bugasura, because the REGISTRY declares it as
        that environment's `baseUrlEnv` and `baseUrlFor` applies it. It cannot reach any
        other application: the override is per environment and demoapp declares none.
        Proven by L-D with the override set to a distinct address.
    defect_2_credentials:
      was: "credentials()/registeredEmail() read process.env.BUGASURA_EMAIL / _PASSWORD directly"
      now: >
        `ApplicationScope.credentials` carries the VARIABLE NAMES the registry declares per
        environment; `credentialSource()` returns them (or null) and `credentials()` reads
        `process.env[declaredName]`. An application declaring none resolves nothing - it
        never borrows. `MISSING_CREDENTIALS_REASON` / `MISSING_EMAIL_REASON` became
        `missingCredentialsReason()` / `missingEmailReason()`, computed so the skip names
        the variables the SELECTED application actually uses.
      also: >
        `resolveInputs` in tests-e2e/support/data-driven.ts already RESOLVED through those
        functions, but its skip diagnostic still pushed the literals 'BUGASURA_EMAIL' /
        'BUGASURA_PASSWORD'. Now pushes the declared names.
    proof:
      demoapp_base_url: "https://demoapp.invalid/ (was https://my.bugasura.io/)"
      demoapp_credentials: "none - with BUGASURA_EMAIL/PASSWORD present in the process"
      bugasura: "unchanged; its own URL, override and credentials all still resolve"
    fixture: "ai/projects/provisioning-isolation.fixture.ts part L (14 checks; 127 total)"
    outstanding_bugasura_fallback: >
      tests-e2e/support/env.ts:237 - `explorationSource()` step 3 still ends
      `?? { email: 'BUGASURA_EMAIL', password: 'BUGASURA_PASSWORD' }`. That is the
      GENERATION browser's account, a separate resolution path with its own order and its
      own fixture (ai/autocode/exploration-auth.fixture.ts), and it was out of scope for
      this step. It now prefers the application's own declaration first, so it is strictly
      better than before, but the literal fallback remains. Safe today only because no
      second application has ever run generation.
    not_done: "demoapp is still not provisioned and has no reachable environment."

  data_driven_workbook_scoping_2026_09_05:
    phase: The last provisioning blocker. Found during final verification, not by design review.
    root_cause: >
      `tests-e2e/support/data-driven.ts` resolved the suite workbook as
      `process.env.EXCEL_WORKBOOK ?? 'excel/login-test-cases.xlsx'` - a hardcoded FILENAME
      as the fallback. `tests-e2e/generic/generic.spec.ts` is the shared wildcard runner,
      is collected for EVERY application, and builds its tests from that cache at import
      time. So `AURA_APPLICATION=demoapp` with EXCEL_WORKBOOK unset collected TWO of
      Bugasura's data-driven rows (TC_LOGIN_017, TC_LOGIN_018) under demoapp's scope.
      Two independent selectors could disagree and the tie went to whichever project was
      named in the source file. globalSetup reads the same constant, so the default also
      decided which workbook was PARSED, not only which cache was read.
    fix: >
      Resolution is now `active application -> registry-declared workbook -> runner`.
      `resolveSuiteWorkbook()` reads `activeScope()` (the same AURA_APPLICATION channel
      `playwright.excel.config.ts` already uses at config load, so nothing new was
      introduced for collection time) and then: EXCEL_WORKBOOK set -> use it only after
      `workbookOwner` confirms the registry gives it to the active application, otherwise
      REFUSE; unset -> the workbook that application declares; none declared -> null, fail
      closed, no rows and never anybody else's; several declared -> refuse and name them.
      Nothing reads a basename, URL, hostname, page title, documentId or test-case id.
    also_changed: >
      `ai/autocode/verify.ts` now sends AURA_APPLICATION alongside EXCEL_WORKBOOK, matching
      `ai/excel/cli.ts`. It sent the workbook without the application, which the new
      ownership check would (correctly) have rejected for any scoped application.
    measured:
      before: "AURA_APPLICATION=demoapp, EXCEL_WORKBOOK unset -> 2 tests in 1 file (Bugasura's)"
      after:  "AURA_APPLICATION=demoapp, EXCEL_WORKBOOK unset -> 0 tests in 0 files"
      bugasura: "88 tests in 67 files, with or without an explicit workbook - unchanged"
      cross: "demoapp+bugasura workbook and bugasura+demoapp workbook are both REFUSED by name"
    fixture: "ai/projects/provisioning-isolation.fixture.ts part K (14 checks; 113 total)"
    note_on_88_vs_79: >
      Bugasura collects 88/67 where an earlier session measured 79/66. Not a regression and
      not cross-project: `ai/test-data/excel-login-test-cases.data-driven.json` was
      regenerated under the Phase-5 full-path cache name, so Bugasura's OWN data-driven
      rows became collectable (8 from login-validation.spec.ts, 2 from generic.spec.ts).

  project_provisioning_2026_09_05:
    phase: Safe project provisioning. Bugasura + demoapp now both registered.
    the_flat_to_scoped_defect:
      cause: >
        `layoutFor` fell back to the flat `<dir>/` while `soleApplication` - a fact about
        how many applications are REGISTERED, not about who owns the directory. Measured
        against the real repository with a two-application registry: five of Bugasura's
        six artefact classes resolved to scoped paths that DO NOT EXIST - 7 Page Objects,
        3 knowledge files, 62 generated specs, ai/test-mapping/mapping.json and
        tests-e2e/fixtures.ts. Nothing errored. Recordings were unaffected because that
        one class had already been physically migrated in Phase 2.
      design_chosen: >
        C - hybrid with EXPLICITLY DECLARED legacy ownership.
        `ApplicationConfig.legacyLayout` (at most one per registry, enforced by
        validateRegistry) names the owner of the unscoped directories, and
        `flatFallback = legacyLayout || soleApplication` replaces the size test.
      design_rejected: >
        B (physical migration) was disqualified by measurement, not preference: it would
        rewrite 62 generated specs' `../fixtures` import, 1 `../pages/issues.page`, 9
        imports across the 7 Page Objects, 5 in fixtures.ts, 62 `testFile` entries in
        mapping.json, and would turn red the 12+ fixtures that hardcode those literal
        paths (apps-readiness, exploration-auth, locator-validation, attempt-budget,
        evidence-sidecar). ZERO artefacts were moved. Scoped-if-it-exists is still
        checked FIRST, so each class can still migrate on its own later with no registry
        edit - which is exactly how recordings already resolve scoped.
    three_leaks_the_fix_exposed:
      - "ai/excel/mapping.ts: scanSpecs and scanDataDrivenRunners RECURSE, so a flat-layout
         scan walks into `tests-e2e/generated/<other>` and claims its specs. Now skips any
         directory named after a registered application (`registeredApplicationIds`)."
      - "Playwright collected `testDir: './tests-e2e'` while `excel:run` and the gate select
         with `--grep <TC_ID>` - and a TC ID is deliberately reusable across applications, so
         a shared ID ran twice and `results.ts` (which reads the ID off the TITLE) filed the
         wrong verdict. `tests-e2e/support/collection-scope.ts` narrows collection from the
         registry; `ai/excel/cli.ts` passes AURA_APPLICATION from the workbook's DECLARED owner."
      - "ai/autocode/from-recording.ts hardcoded `from '../fixtures'`, correct for the flat
         layout only. Now derived from the two resolved paths (the pattern writer.ts already
         used): still byte-identical `../fixtures` for Bugasura, `../../<id>.fixtures` scoped."
    the_ambient_default: >
      MEASURED THE HARD WAY: registering demoapp turned 60 of 64 fixtures red in one step -
      not because anything was misfiled, but because `activeScope()` began refusing a
      question it had always answered. Every CLI here and ~60 offline fixtures predate the
      scope layer and were written against the UNSCOPED directories, so that is what an
      unscoped AMBIENT caller means; `activeScope()` now falls back to the declared
      legacyLayout owner. `resolveScope({})` is UNCHANGED and still refuses - which is what
      keeps the dashboard demanding an explicit choice, since every one of its request paths
      goes through resolveScope. Drop the flag after migration and the ambient question has
      no answer again, correctly.
    provisioning:
      module: ai/projects/provision.ts
      transaction: "validate whole candidate registry -> write workbook -> write registry
        atomically -> on failure delete ONLY the workbook this call created. The registry is
        written LAST because it is the only durable claim."
      workbook: "excel/<applicationId>-test-cases.xlsx, ONE sheet, Module as a COLUMN. Schema
        shared with make-demo-workbook.ts via the new ai/excel/workbook-template.ts - one
        header list, because a drifted heading is not an error, it silently reads as empty."
      ownership: "The registry `workbooks` array is authoritative. /api/workbooks answers from
        it, never from a listing of excel/; an undeclared workbook is reported as `unowned`
        and offered to NOBODY."
      seam: "AURA_EXCEL_DIR, mirroring AURA_REGISTRY_FILE, so a fixture that exercises
        provisioning never writes into the real excel/ directory."
    demo_project: >
      demoapp was provisioned through the REAL dashboard API (POST /api/projects) and is now
      in ai/projects/registry.json with excel/demoapp-test-cases.xlsx. Bugasura: 194 cases
      across 4 sheets, all six artefact paths resolving to their original locations. demoapp:
      1 case, its own scoped destinations, 0 tests collected by Playwright. Crossing the two
      workbooks is refused in BOTH directions.
    fixture: ai/projects/provisioning-isolation.fixture.ts (99 checks, offline, no writes to real data)
    deferred:
      - "demoapp has no Page Objects, knowledge, fixtures module or specs yet, so it cannot
         yet be RUN end to end. Its base URL is synthetic. Recording/generating for it is the
         next real step."
      - "tests-e2e/generic/generic.spec.ts is treated as shared framework and imports the flat
         `../fixtures`. A scoped application's data-driven rows would need it to resolve the
         ACTIVE application's fixtures module - not attempted here."
      - "Bugasura's five flat artefact classes are still flat. Nothing forces them to move;
         each can migrate independently by creating its scoped directory."

  typescript_diagnostics_2026_09_05:
    phase: TypeScript / VS Code diagnostic cleanup. NOT a behaviour change.
    root_cause: >
      The repository had NO tsconfig.json, no `typescript` in node_modules and no ESLint,
      so VS Code fell back to an INFERRED project and guessed every compiler option.
      Measured with tsc 5.9 over all 218 project files: guessing produced 305 diagnostics
      against 29 under the options the repository actually executes with. 155 of the
      difference were `esModuleInterop` alone (TS1192 + TS1259) and 124 were a guessed ES5
      target (TS2802 / TS1501 / TS2550). None was a defect - tsx/esbuild applies exactly
      that interop and target, which is why the same code runs green.
    tsconfig_added: >
      tsconfig.json at the root. It emits nothing and gates nothing (noEmit; `npm run
      build` is still `echo OK`); it exists so an editor stops guessing. Every option
      DESCRIBES how the repository already runs. `useDefineForClassFields: true` was
      VERIFIED, not assumed - a class field with no initialiser over a base-constructor
      assignment reads `undefined` under tsx both with and without the file, so define
      semantics were already in force. `isolatedModules` was measured to add zero
      diagnostics. Excludes are git-ignored artefact directories ONLY (120 raw codegen
      recordings under ai/dashboard/recordings, 125 report snapshots under ai/reports),
      plus the transient **/*.mutant.ts. No source directory and NO FIXTURE is excluded.
    strict_null_checks: >
      The one checking flag switched on, and it is a correction rather than a new
      standard: WITHOUT it TypeScript strips null/undefined from every type and six pieces
      of CORRECT production code are reported as errors, because a discriminated union
      cannot be narrowed by its own discriminant (abstraction/semantic.ts:1021/1024/1027,
      from-recording.ts:269). No other strictness flag was enabled.
    production_fixed:
      - ai/dashboard/live-recorder.ts: >
          `(playwright as any)[options.browser]` made `engine` any, so `browser` never
          narrowed away its null initialiser and every use of it downstream was unchecked.
          Retyped as Record<string, typeof playwright.chromium>. This REMOVES an `any`.
      - ai/autocode/abstraction/propose.ts: >
          OwnerResolution.code/.candidates are optional; the member holds them as | null.
          `?? null` (every reader already coalesces), and the group guard now witnesses
          that parameterSource is non-null - `parameterised` already required it, so the
          added test changes nothing at run time.
      - ai/autocode/abstraction/lifecycle.ts: >
          The resolved-to-a-method branch omitted the REQUIRED `diagnostic`, so that JSONL
          record shipped without the key. Now `diagnostic: null` - nothing was blocked and
          no batch was rolled back, and "no diagnostic" is stated rather than left missing.
    fixtures_fixed: >
      15, none weakened and none deleted: six identical `(t: string): void =>
      process.stdout.write(...)` concise bodies; four synthetic TestCase helpers missing
      TestCaseSource.workbookPath and all seven P1 authoring fields; two Proposal helpers
      missing sightings / refusalCodes / resolvedBy / semantic / allowedOwners /
      derivedMethod / roundTrip / accessibleNameAmbiguous; two LifecycleDecision literals
      missing `diagnostic`; one `...{...} as never` spread. Every default is the value the
      readers already coalesce an absent field to, so no assertion moved.
    left_standing_deliberately:
      - "3 x TS2307: ./dom-evidence.mutant, ../dashboard/live-recorder.mutant, ./locator-quality.mutant.
         Written by a mutation fixture and deleted again in its finally, so the module genuinely
         does not exist at rest. Any fix would hide the specifier from the compiler, which is a
         suppression in spirit."
      - "5 x TS2783 in ai/excel/mapping.ts (upsertEntry). Defaults-first-then-spread, and the
         overwriting IS the intent: the literals give a brand-new entry a complete shape and an
         existing entry is supposed to win. Documented in place; behaviour untouched."
    verification:
      command: "npx tsc --noEmit --project ."
      before: 305
      after: 8
      production_remaining: 0
      fixtures: "63/63 by exit code, 0 failures"
      playwright: "both suites still collect - upstream 8 tests in 5 files, excel 79 tests in 66 files"
      data: "recordings 410, premigration backup 411, 0 stray .mutant files"
      suppressions: >
        Zero `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `as any` or `: any` on any
        ADDED line of the session diff; two `any` lines were removed. Pre-existing and NOT
        from this cleanup: 15 `any` annotations typing untyped HTTP/JSON bodies in
        ai/dashboard/project-api.fixture.ts and ai/knowledge/yaml.fixture.ts.
    do_not: >
      Do not "fix" the five TS2783 by reordering the spread - a first write would then be
      incomplete. Do not add a strictness flag to this tsconfig without measuring it first.

  abstraction_fixture_red:
    checks: >
      2 - "a second run has nothing left to write" and "the real corpus writes nothing
      while nothing is approved"
    cause: >
      NOT the scope work, and not a code defect. One outstanding sound proposal:
      TC_LOGIN_087 "click Add Issue" -> WorkspacePage.bugNewSubmit,
      page.locator("#bug_new_submit"), matchCount 1, identityMatched true,
      sameDocument true, measuredAt press, refusals []. It is a real element, distinct
      from the declared WorkspacePage.newIssue, and every deterministic gate passed.
      Both checks are SNAPSHOT assertions that the corpus has nothing outstanding.
    proven_pre_existing: >
      With the HEAD yaml.ts the fixture cannot load at all on this checkout, so the red
      predates and is independent of Phase 2. The corpus tally is byte-identical before
      and after every change in this phase.
    decision_owner: user
    options: [apply the proposal, or widen the snapshot check to allow a sound outstanding proposal]
    do_not: [edit the fixture to make the regression green]

  defect_found_and_fixed_in_passing:
    where: ai/dashboard/server.ts
    what: >
      `recordingStatus` was imported from BOTH ./recorder (no arguments, "is a codegen
      session live?") and ./case-status (takes a TestCase, "is this row's recording
      stale?"). One name, two bindings - the second won, so `GET /api/record` called the
      bookkeeper with testCase === undefined and threw on every poll of the Record screen.
    verified_by: bundling server.ts with esbuild - only the two-argument function survived
    now: the recorder's is imported as `recorderSessionStatus`; both survive the bundle
    note: unrelated to scoping, found in the import block this phase had to edit, reported rather than silently fixed

# ---------------------------------------------------------------- 2026-09-04 (later)
# PHASE 3 - DASHBOARD PROJECT / ENVIRONMENT / RECORDING SCOPE.
# Phase 2 accepted. TC_LOGIN_087 resolved and the recording store migrated first; both
# are recorded under `phase_2_closeout` below.
application_isolation_phase_3:
  state: COMPLETE for selection, locking, evidence and execution; see deferred.
  objective: >
    Project -> Environment -> Test Case -> Record/Run, with the ApplicationScope
    established BEFORE a browser opens, and never inferred from a URL.
  gates:
    - ai/projects/dashboard-scope.fixture.ts   (57 checks - selection, locking, A-F)
    - ai/dashboard/project-api.fixture.ts      (27 checks - the REAL server over HTTP)
    - ai/projects/isolation.fixture.ts         (98 checks - Phase 2, unchanged)

  the_flow:
    - Dashboard        project + environment selectors in the header, before the workbook
    - Project          GET /api/projects -> applicationId (sent) + displayName (shown)
    - Environment      only that project's; selecting one resolves environmentId + baseUrl
    - ApplicationScope tryScopeFromSelection() in ai/dashboard/scope-request.ts, ONE door
    - Test Case        resolved inside the selected project via its workbook
    - Record / Run     startRecording({ scope, url?, browser, testCaseId }) / POST /api/run
    - PageContext      Session.scope, immutable for the session's lifetime
    - Evidence         DomEvidence.origin { applicationId, environmentId, baseUrl, testCaseId }
    - Artefacts        ScopePaths, unchanged from Phase 2
    - Results          per-application stores; run/generation history still global (deferred)

  two_defects_the_tests_found:
    - what: >
        POST /api/run with NO project succeeded (202) while two applications were
        registered. `scopeFromSelection` accepted the WORKBOOK as a second source, and
        the registry does declare an owner per workbook - so it resolved instead of
        refusing. A lookup, not an inference, but still a weaker rule than the flow
        promises: the selector would have been decorative, ignored on every request,
        and nobody would find out until two projects shared a workbook name.
      now: >
        The dashboard requires the CHOICE. The workbook is used only to CHECK it
        (`assertWorkbookInScope`). The CLI still resolves a scope from a workbook,
        which is right - a command given the file has named the project.
      found_by: ai/dashboard/project-api.fixture.ts, over real HTTP
    - what: >
        `persistRecording` resolved the recordings directory from the AMBIENT scope. In
        a dashboard serving many requests that is a different question from "which
        application was this recording made in", so a person who selected Flipkart in a
        process whose ambient application was Bugasura would have had their recording
        written into Bugasura's store - correctly formed, provably measured, and filed
        under the wrong product.
      now: >
        The store is resolved from the recording's own locked `origin`, and the script
        and both sidecars share that one directory. `artifactPath`/`evidencePath`/
        `assertionsPath` take it as a parameter; the default stays the ambient scope,
        which is right for every reader.
      found_by: reading the save path after the API tests passed - no test had reached it

  identity_is_locked:
    where: ai/dashboard/recorder.ts Session.scope
    rule: >
      Captured at startRecording, never rewritten, and there is deliberately NO setter -
      `recordingScope()` reads, nothing writes. The URL is what the session STARTED at
      (navigation evidence); the scope is what the session IS (identity). A recording
      navigates through /login, /apps, an issue and settings, and a person may type any
      address into the browser it handed them; if identity were re-derived from wherever
      the browser ended up, one navigation could move the recording into another
      application's namespace.
    proven_by: >
      dashboard-scope.fixture.ts section D drives four in-application routes AND an
      address belonging to the other application, and asserts the resolved artefacts
      are unchanged every time.

  backward_compatibility:
    single_application: >
      UNCHANGED. An unscoped request resolves to the sole registered application, which
      is exactly what every pre-Phase-3 page sent. Asserted against a LIVE server on a
      single-application registry, not reasoned about - and the assertion deliberately
      uses a Test Case ID the workbook does not contain, so it proves the scope check
      passed without spawning Playwright at the live application.
    multiple_applications: >
      A missing applicationId is a controlled 400 carrying `choices`, never a fallback
      to the first application and never to a URL-derived identity. Asserted for
      /api/record/start and /api/run, including with a Bugasura URL in the body.

  deferred:
    - what: run and generation history (ai/dashboard/runs, ai/dashboard/generations)
      why: >
        Explicitly out of scope for this phase - "do NOT restructure unrelated global
        run/history infrastructure". `results` and `history` ARE application artefacts
        and these directories are unscoped; the five-record generation cap is global, so
        one application's generations would evict another's. Phase 4 material.
    - what: tests-e2e/support/env.ts BASE_URL and BUGASURA_* credential names
      why: >
        The registry declares environments[].baseUrl, baseUrlEnv and credentials BY
        NAME and env.ts reads none of it. VERIFIED to agree exactly today, so this is an
        unwired declaration rather than a conflict. Wiring it means importing scope.ts
        (which uses node:fs at module load) into a module the Playwright config and
        every spec import.
    - what: playwright.excel.config.ts - one testDir, one baseURL, one results path
      why: execution-side scoping, not dashboard-side; Phase 4.
    - what: Add Project UI
      why: >
        The API and registry foundation are done and tested (POST /api/projects, with
        the whole candidate validated by the same rules that guard every read). A form
        was deliberately not built - the brief said to defer UI polish if the
        architecture did not support it cleanly, and project creation is rare enough
        that the endpoint is the useful half.

  remaining_collision_risks:
    - ai/dashboard/runs and ai/dashboard/generations are keyed without an applicationId
    - ai/reports/* is a single set of files per repository, not per application
    - "ai/test-data/<workbook-basename>.data-driven.json collides on same-named workbooks"
    - ai/autocode/state.json and ai/autocode/quarantine are keyed by bare Test Case ID
  remaining_risks_note: >
    NONE of the four can currently be reached across applications by the DASHBOARD,
    because every route resolves a scope first and refuses without one. They are
    collisions in storage, not open paths.

# ---------------------------------------------------------------- Phase 2 closeout
phase_2_closeout:
  tc_login_087:
    decision: GENUINELY DISTINCT - the capability was created, the fixture was not touched.
    evidence: >
      The recording contains BOTH buttons. `getByRole('button', { name: 'add Add Issue' })`
      OPENS the new-issue form and is WorkspacePage.newIssue() -> #bug_no_issue_added
      .mdl-button; then the summary and the rich-text editor are filled; then
      `getByRole('button', { name: 'Add Issue', exact: true })` SUBMITS it and is
      #bug_new_submit. Different elements, different points in the flow.
    created: >
      WorkspacePage.bugNewSubmit() via the normal mechanism (abstraction writer, not by
      hand). It resolves through `this.resolve()` - the cardinality chokepoint - so it
      gets healing rather than a direct locator. Two files written: the class and
      bugasura__apps.yaml. fixtures.ts unchanged (workspacePage was already registered),
      verified by md5.
    outcome: >
      abstraction.fixture.ts green. Corpus 90 -> 88 proposals, PROPOSED 1 -> 0, and the
      element is now REUSED by two recordings (TC_LOGIN_071 and TC_LOGIN_087) - so it
      closed a duplicate risk across two cases, not one. 47 declared capabilities,
      0 unimplemented, 0 duplicate declarations.
  recording_migration:
    state: DONE
    moved: 410 artefacts (306 live + 104 archived) -> ai/dashboard/recordings/bugasura/
    verification: >
      410/410 sha256 match against the kept backup manifest, 0 mismatch, 0 missing,
      0 files in the target the manifest does not name. Old flat directory holds 0
      files and only the `bugasura` subdirectory. Accessors resolve to the new store.
      0 persisted references to the old location anywhere.
    backup: ai/reports/recordings-premigration-bugasura (git-ignored, KEPT)
    unblocked_by: >
      32 fixtures named the flat path literally. They were classified before being
      touched: 3 occurrences test path BEHAVIOUR or are prose and were left alone (the
      gate asserting verify.ts does not spell 'recordings'; the .gitignore check; the
      fingerprint's synthetic relative path). The rest read real artefacts and now go
      through `activeRecordingsDir()`.
    a_real_bug_the_safeguard_caught: >
      The first run ROLLED BACK. `activeScope()` is memoised and had been resolved
      before the swap, when the scoped directory did not exist - so the confirmation
      read a stale answer. The transaction refused to delete anything and restored the
      originals. `resetActiveScope()` at the swap is the fix; the rollback worked
      exactly as designed and is why nothing was lost.
    accessor_now_single: >
      `activeRecordingsDir`/`activeAcceptedDir` are DEFINED in ai/projects/scope.ts and
      re-exported by the recorder under its existing names. Defined there because
      recorder.ts loads .env at import and ~30 offline fixtures needed the directory;
      importing the recorder into all of them would pull dotenv and the codegen surface
      into gates meant to touch nothing.

# ---------------------------------------------------------------- 2026-09-04 (Phase 4)
# PHASE 4 - END-TO-END RECORDING / PAGE CONTEXT / EVIDENCE.
# A verification phase: prove the boundary holds, audit ambient state, fix what the
# audit finds. Phase 3 accepted and not reopened.
application_isolation_phase_4:
  state: COMPLETE
  invariant: ACTIVE APPLICATION SCOPE IS IMMUTABLE FOR THE OPERATION.
  where_enforced:
    - "Session.scope (ai/dashboard/recorder.ts) - set before the browser opens, no setter exists"
    - "pending.origin - carries it across the Stop/Save gap, after `session` is cleared"
    - "persistRecording - resolves the store from the ORIGIN, never the ambient scope"
    - "scopeForWorkbook / tryScopeFromSelection - one door, per request, in the server"
    - "buildIndex(scope), readAllPageKnowledge(dir), recordingsDir() - scoped inputs only"
  gate: ai/projects/lifecycle-isolation.fixture.ts (57 checks)

  # ---- the audit the phase asked for
  ambient_state_audit:
    SAFE:
      what: >
        Every ambient read inside a SHORT-LIVED CLI - ai/excel/cli.ts,
        ai/autocode/orchestrate.ts, ai/autocode/groups.ts, ai/projects/migrate-recordings.ts.
        One process, one command, one project: the ambient scope IS the operation's
        scope, and there is no second request to confuse it with.
    LEGACY_COMPATIBILITY:
      what: >
        `applicationSlug(BASE_URL)` in ai/knowledge/canonical.ts. Reachable only when
        there is no registry.json at all, and a ScopeError is rethrown rather than
        swallowed - so it can never answer an ambiguous scope. Deletable once no
        checkout predates the registry.
    DANGEROUS_AMBIENT_STATE_FOUND_AND_REMOVED:
      where: ai/dashboard/server.ts
      what: >
        SIX per-request reads went through the process-wide memo instead of the
        request's own scope: `readMapping(activeMappingFile())` in describeWorkbook and
        twice in activate, `writeMapping(..., activeMappingFile())`, and three
        `recordingStatus(testCase)` calls defaulting to the ambient recordings
        directory. In a long-lived server that asks "which application is this PROCESS
        in" when the question is "which application is this REQUEST about" - the same
        answer only by luck.
      now: >
        `describeWorkbook(workbookPath, scope)` and `activate(workbookPath, testCaseId,
        scope)` take the scope; the routes derive it with `scopeForWorkbook`, which
        resolves from the workbook's DECLARED owner and refuses when the request names a
        different project. Zero `activeMappingFile()` and zero bare
        `recordingStatus(testCase)` remain in the server.

  concurrency:
    model: >
      The dashboard is ONE process. Two people share the ambient scope, the module-level
      `session` and every memo, so the only thing keeping their work apart is that each
      operation carries its own scope.
    A: "user A records Alpha, user B selects Beta, user A saves -> lands in Alpha"
    B: "both save from one process with the ambient on neither -> two files, two projects"
    C: "changing or clearing the ambient application moves neither recording"
    bounded_by: >
      A SECOND concurrent recording is refused by design ("A recording is already in
      progress"), so concurrency here is between a recording and other requests, not
      between two recordings. Written down rather than assumed.

  adversarial_cases_proven:
    - two applications with the SAME Page Object class name resolve independently
    - the SAME `#username` selector in both is not a way to cross the boundary
    - the same Test Case ID files two recordings, two specs, two mapping entries
    - "four navigations incl. the other application's address leave applicationId unchanged"
    - "AI isolation: the starved project gets an EMPTY pool, never a borrowed candidate"
  ai_boundary: >
    A resolver is handed three things and all three are scoped by construction - the
    Page Object index (buildIndex(scope)), page knowledge (readAllPageKnowledge over the
    scoped directory) and the recording corpus (recordingsDir()). There is no fourth
    input, so there is no path by which another project's candidate could be offered.
    Nothing about AI eligibility was changed.

  # ---- the incident. Recorded because the backup is the only reason it cost nothing.
  incident_the_fixture_deleted_the_real_recordings:
    what: >
      The first version of lifecycle-isolation.fixture.ts used the application ids
      `bugasura` and `flipkart`. ScopePaths is rooted at the repository, so `bugasura`
      resolved to ai/dashboard/recordings/bugasura - the LIVE store holding the 410
      migrated artefacts - and the fixture's own cleanup removed it.
    recovered: >
      Fully. 410/410 restored from ai/reports/recordings-premigration-bugasura and
      re-verified against its sha256 manifest: 410 match, 0 mismatch, 0 missing. The
      migration's kept backup is the only reason this cost nothing.
    root_cause: >
      A fixture that composes REAL paths from a scope is one rmSync away from the real
      thing, and "clean up after yourself" is indistinguishable from "delete the
      repository" when the paths are computed rather than owned.
    fixed_by_two_guards:
      - "track() records a directory only if it did NOT already exist - never delete what you did not create"
      - "assertNothingRealAtRisk() refuses to run at all if any path the fixture would write to exists"
      - "the test applications are now `alpha`/`beta` - ids nothing in this repository uses"
    guard_verified: >
      Creating tests-e2e/pages/alpha and re-running produces "refusing to run: these
      paths already exist and are not this fixture's to write or remove".
    rule_for_every_future_fixture: >
      A fixture MUST NOT use a real applicationId, and MUST NOT remove a path it did not
      create. Both are now enforced in code rather than remembered.

  regression:
    fixtures: 59
    red: 0
    note: >
      Includes ai/autocode/abstraction.fixture.ts, green since TC_LOGIN_087's capability
      was created in the Phase 2 closeout. The recordings store was re-counted at 410
      after the whole suite ran, which is now part of the regression command.

  deferred_unchanged_from_phase_3:
    - ai/dashboard/runs and ai/dashboard/generations are unscoped (history)
    - ai/reports/* is one set of files per repository
    - "ai/test-data/<workbook-basename> collides on same-named workbooks"
    - ai/autocode/state.json and ai/autocode/quarantine are keyed by bare Test Case ID
    - tests-e2e/support/env.ts still reads BUGASURA_* rather than the registry
    - playwright.excel.config.ts is one testDir, one baseURL, one results path
  deferred_note: >
    None is reachable across applications through the dashboard - every route resolves a
    scope first and refuses without one. They are collisions in STORAGE, not open paths.

# ---------------------------------------------------------------- 2026-09-04 (Phase 5)
# PHASE 5 - GENERATION ISOLATION.
application_isolation_phase_5:
  state: COMPLETE
  identity: "GENERATION IDENTITY = applicationId + testCaseId, NEVER testCaseId alone."
  gate: ai/projects/generation-isolation.fixture.ts (48 checks)

  # ---- the pipeline, and where each stage gets its application
  pipeline_audit:
    - "dashboard route      | request selection (tryScopeFromSelection / scopeForWorkbook) | scoped | -   | none"
    - "recording session    | Session.scope, set before the browser opens                  | scoped | -   | none"
    - "recording store      | origin.applicationId -> resolveScope                          | scoped | r/w | none"
    - "evidence             | evidence.origin                                              | scoped | r/w | historical files have none (optional by design)"
    - "knowledge            | readAllPageKnowledge -> activeKnowledgePageDir                | scoped | r   | none"
    - "page object index    | buildIndex(scope)                                            | scoped | r   | none"
    - "locator resolution   | pools from index + knowledge + corpus only                    | scoped | r   | none"
    - "abstraction writer   | pagesDir / knowledgeDir / fixturesFile                        | scoped | r/w | none"
    - "AI eligibility       | the same three pools, no fourth input                        | scoped | r   | none"
    - "generated spec       | generatedDir()                                               | scoped | w   | none"
    - "mapping              | scope.paths.mappingFile                                      | scoped | r/w | none"
    - "fixtures module      | scope.paths.fixturesFile + index importFrom                  | scoped | r/w | FIXED this phase"
    - "attempt budget/state | stateKeyFor() = applicationId/testCaseId                     | scoped | r/w | FIXED this phase"
    - "validation (verify)  | evidencePath / archivedPath / buildIndex                     | scoped | r   | none"
    - "test-data cache      | full workbook path                                           | unique | r/w | FIXED this phase"
    - "generation history   | applicationId stamped on the record                          | global | w   | intentional, labelled"
    - "reports ai/reports/* | applicationId on the run record, joined by runId              | global | w   | intentional, labelled"
    - "quarantine           | <testCaseId>.<ISO timestamp>.spec.ts.txt                     | global | w   | no overwrite possible"

  four_real_defects_fixed:
    - what: >
        ai/autocode/state.json was keyed by the BARE Test Case ID in one global file, so
        two applications that both have TC_LOGIN_001 shared ONE entry - attempt count,
        fingerprint, verdict and spec path. One project could exhaust another's budget,
        and a row could be skipped as `accepted` on the strength of another product's
        spec.
      now: >
        Keyed `applicationId/testCaseId` via `stateKeyFor()`. MAX_ATTEMPTS is unchanged
        and stays global - how many times to retry is POLICY; the RECORD is per
        application. Only the key moved, so every rule about when the budget resets
        reads exactly as before.
      migration: >
        `readState` re-files bare keys under the SOLE registered application, in memory,
        and the next save persists the scoped shape. Proven lossless on the real file:
        119 -> 119 entries, verdicts identical (67 accepted / 51 quarantined / 1
        declined), every id survives the rename. Dropping them instead would have made
        every accepted case read as never generated and `surveyWork` would have set
        about regenerating finished specs.
    - what: >
        ai/knowledge/index.ts emitted `importFrom: tests-e2e/fixtures.ts` as a LITERAL
        while `buildIndex` reads `scope.paths.fixturesFile`. The index read one
        application's fixtures module and told the generator to import from the flat
        one, so under a scoped layout a generated spec would name a file that is not its
        application's.
      now: "emits `index.support.fixtures.file` - the path that was actually read"
      found_by: the user, reading the framework.yaml diff
    - what: >
        `cachePathFor` derived the data-driven cache name from the workbook BASENAME.
        Two applications owning two DIFFERENT workbooks with the same file name -
        excel/bugasura/cases.xlsx and excel/flipkart/cases.xlsx - collapsed to one cache
        file, so one project's rows executed under the other's name.
      now: derived from the whole repo-relative path, which is unique by construction
    - what: "RunMetrics and GenerationRecord carried a workbook but no application"
      now: >
        both stamp applicationId, so the deliberately GLOBAL logs can still tell two
        projects' TC_LOGIN_001 apart. Retention semantics untouched - the generation
        history is still the newest five records, whatever project they belong to.

  determinations_made_not_changed:
    quarantine: >
      GLOBAL and left alone. File names are `<testCaseId>.<ISO timestamp>.spec.ts.txt`,
      so two applications cannot overwrite each other - the timestamp differs. Nothing
      reads the directory back programmatically. Restructuring it would break
      locator-validation.fixture.ts for a legibility gain.
    reports: >
      GLOBAL by intent - one append-only log per checkout, answering "what has the
      generator been doing here". Partitioning would turn a `tail` into a directory
      walk. Identity is carried instead: the run record names the application and every
      other report joins to it by runId.
    generation_history: >
      GLOBAL by intent, five records, unchanged. Now labelled per record so the UI can
      distinguish two projects' TC_LOGIN_001.
    framework_yaml: >
      MIXED, and now handled as such. `pages` and `fixtures` are application-specific;
      `support` is genuinely shared framework plumbing. The file is named per
      application once more than one exists (Phase 2), and `importFrom` now names the
      application's own fixtures module.

  regression:
    fixtures: 60
    red: 0
    also_verified: "recordings/bugasura = 410 artefacts; migration backup = 411 files"

  remaining_risks:
    - "tests-e2e/support/env.ts reads BUGASURA_* rather than the registry (verified to agree today)"
    - "playwright.excel.config.ts is one testDir, one baseURL, one results path"
    - "ai/dashboard/runs is unscoped execution history (records carry no applicationId yet)"
  remaining_risks_note: >
    None is reachable across applications through the dashboard or the generator - every
    route and every generation stage resolves a scope first. They are collisions in
    STORAGE or unwired declarations, not open paths.

# ---------------------------------------------------------------- 2026-09-04 (Phase 6)
# PHASE 6 - EXECUTION / RESULTS / HISTORY ISOLATION.
application_isolation_phase_6:
  state: COMPLETE
  identity: "EXECUTION IDENTITY = applicationId + testCaseId + runId"
  attempt_policy: GLOBAL - MAX_ATTEMPTS is a number and means the same everywhere
  attempt_state: APPLICATION-SCOPED - the ledger entry is about one project's row
  gates:
    - ai/projects/execution-isolation.fixture.ts (33 checks)
    - ai/dashboard/project-api.fixture.ts        (37 checks, real server over HTTP)

  execution_pipeline_audit:
    - "dashboard run route | request selection, refused without one | scoped | -   | none"
    - "generated spec      | scope.paths.generatedDir               | scoped | r   | none"
    - "fixtures module     | scope.paths.fixturesFile               | scoped | r   | none"
    - "test data           | cachePathFor(full workbook path)       | unique | r/w | none"
    - "environment         | applicationId + environmentId          | scoped | r   | none"
    - "run record          | applicationId + environmentId + runId  | global store, identified | w | none"
    - "run metrics         | applicationId on the run record        | global store, identified | w | none"
    - "results             | per run directory under runs/<runId>   | global store, identified | w | none"
    - "generation history  | applicationId on record and summary    | global store, identified | w | none"
    - "reports ai/reports/*| applicationId on the run record, joined by runId | global, identified | w | none"
    - "attempt budget      | stateKeyFor = applicationId/testCaseId | scoped key | r/w | none"
    - "fingerprints        | held inside the scoped state entry     | scoped | r/w | none"
    - "verdicts            | held inside the scoped state entry     | scoped | r/w | none"
    - "quarantine          | applicationId.testCaseId.stamp         | global, identified | w | FIXED this phase"

  three_defects_fixed:
    - what: >
        Dashboard RUN RECORDS carried no applicationId. `ai/dashboard/runs/` is a global
        store of past executions, so two projects' TC_LOGIN_001 appeared as two
        indistinguishable rows and no filtering was possible.
      now: >
        `RunRecord.applicationId` and `.environmentId`, stamped in `startRun` from the
        scope the ROUTE already resolved - never re-derived from `request.workbook`,
        because a record is a statement about what happened rather than a lookup to redo
        later.
    - what: >
        QUARANTINE names were `<testCaseId>.<ISO stamp>.spec.ts.txt`. `copyFileSync`
        overwrites, so two generators quarantining TC_LOGIN_001 in the same millisecond
        lose one file silently - unlikely, not impossible, and "unlikely" is a poor
        property for the one copy of a spec somebody wants to read. The decisive reason
        is simpler: the name cannot be attributed to a project at all.
      now: >
        `<applicationId>.<testCaseId>.<stamp>.spec.ts.txt`. The directory stays GLOBAL -
        it is a diagnostic pile, not an artefact store - and nothing parses the name
        back, so the only cost is that the file now says whose it is.
    - what: "run and generation LISTINGS dropped the application, so the UI could not filter"
      now: >
        both summaries carry it, both endpoints accept `?applicationId=`, and the page
        sends the selected project. Retention is untouched: filtering narrows the VIEW,
        so asking as one project never evicts another project's record.

  what_stays_physically_global_and_why:
    ai_dashboard_runs: >
      One directory of past executions on this machine, which is the question it
      answers. Each record now carries applicationId + environmentId + runId, and the
      listing narrows on it.
    ai_dashboard_generations: >
      Global, newest FIVE, retention deliberately unchanged. The requirement was no
      identity collision, not a directory per project - so records and summaries carry
      the application and the view is filtered.
    ai_reports: >
      Append-only logs per checkout. Partitioning would turn a `tail` into a directory
      walk. The run record names the application and every other report joins by runId.
    quarantine: "a diagnostic pile; identity is now in the file name"
    legacy_records: >
      A record written before these fields has no application and is claimed by NEITHER
      project - it appears only in the unfiltered list. Attributing it to whichever
      project is asking would be inventing history, the same rule `readState`'s
      migration follows for an ambiguous key.

  concurrency_bounded_honestly: >
    ONE run at a time and ONE recording at a time, both by existing design - `active`
    and `session` are single slots, and the run comment explains why (Playwright wipes
    test-results-excel/ at the start of every run). So two applications cannot execute
    SIMULTANEOUSLY on one dashboard, and what Phase 6 proves is that their STATE cannot
    mix: separate specs, fixtures, mappings, ledgers, fingerprints, verdicts, caches and
    result records. Making execution genuinely parallel is a different piece of work and
    would need Playwright's output directory scoped first.

  decisions_recorded_not_changed:
    playwright_config: >
      `playwright.excel.config.ts` stays SHARED. It is framework configuration - the
      reporters, the worker count, the capture modes, the one project `chrome` - and
      duplicating it per application would duplicate a SHARED_CAPABILITY for symmetry.
      What is application-specific is `testDir`, `baseURL` and the output paths, and
      those are execution-side scoping that needs Playwright to be launched per scope.
      Deferred with the reason, not silently.
    env_ts: >
      `tests-e2e/support/env.ts` keeps reading BUGASURA_* and remains LEGACY
      SINGLE-APPLICATION COMPATIBILITY. The registry declares baseUrl, baseUrlEnv and
      credentials BY NAME and they were verified to agree exactly. Environment variables
      stay as the SECRET provider - that discipline is deliberate and is not being
      removed - but they must not become project identity, and they do not: nothing
      derives an applicationId from them.

  final_verification_2026_09_04:
    serial_execution_safety:
      proven_by: "ai/dashboard/project-api.fixture.ts - the six `serial:` checks"
      invariant: >
        A run, a generation and a recording each hold ONE slot and refuse the others
        with 409, because `test-results-excel/` is NOT application-scoped and Playwright
        wipes it at the start of every run. Two applications therefore cannot execute
        simultaneously - the second is refused, never queued and never scoped.
      asserted_on: >
        The SOURCE, not over HTTP: reaching the guards from outside needs a real run in
        flight, and an offline gate must not launch Playwright at a live application to
        prove a refusal. The checks pin that both guards precede `readJsonBody`, that
        the refusal names the shared output directory as its reason, and that `active`
        is a single slot rather than a collection - a queue or a map would be the
        beginning of parallel execution.
      mutation_tested: "removing the `if (active)` guard turns 3 checks red"
      pre_existing_gap: >
        lifecycle-isolation.fixture.ts proved only the RECORDER's mutual exclusion
        (recorder.ts). Nothing covered the run/generator exclusion in server.ts, which
        is the Playwright-output-state question.
    history_api_scope:
      proven_by: "ai/dashboard/project-api.fixture.ts - the twelve `history:` checks"
      trace: "UI selected project -> ?applicationId= -> equality predicate against each record's OWN applicationId -> response"
      finding: >
        The endpoints do NOT validate the id against the registry - and they do not need
        to, because the id is used ONLY as an equality predicate. An unknown id matches
        no record, so the result set can only ever SHRINK: fail-closed by construction,
        with no path by which an arbitrary value widens it. Verified with `nonexistent`,
        `bugasura-`, `BUGASURA`, `../bugasura` and `` - all empty except the empty
        string, which means "no filter asked for" and returns the unfiltered list.
      exact_match_is_deliberate: >
        applicationId is a lowercase slug the registry validates, so `BUGASURA` is not a
        spelling of `bugasura` - it is an id nothing is filed under. No case-folding and
        no prefix matching.
      divergence_recorded_not_changed: >
        Every other application-specific route (/api/record/start, /api/run,
        /api/workbook) returns a controlled 400 for an unknown applicationId; the two
        history endpoints return an empty list instead. Left as it is: the safety
        property holds either way, the UI only ever sends ids from /api/projects, and
        changing it was outside what this verification was asked to do. Worth a decision
        later if a typo'd filter reading as "no history" is judged confusing.
      mutation_tested: "making the filter ignore the id turns 12 checks red"
  regression:
    fixtures: 61
    red: 0
    also_verified: "recordings/bugasura = 410; migration backup = 411; no scoped strays"

  remaining_risks:
    - "playwright.excel.config.ts: one testDir, one baseURL, one results path"
    - "tests-e2e/support/env.ts: BUGASURA_* rather than the registry (verified to agree)"
    - "execution is serialised, so simultaneous two-project runs are not possible yet"
  remaining_risks_note: >
    None is a cross-project collision. Every execution store is either scoped or carries
    its own identity, and every dashboard route resolves a scope before touching one.

# ---------------------------------------------------------------- 2026-09-04 (Phase 7)
# PHASE 7 - PRODUCTION-READINESS / END-TO-END ISOLATION AUDIT.
# An adversarial audit, not a feature phase. One real defect found and fixed.
application_isolation_phase_7:
  state: COMPLETE
  gate: ai/projects/ambient-cache.fixture.ts (22 checks)

  the_one_real_defect:
    where: ai/autocode/work.ts - cachedFingerprint
    what: >
      `frameworkFingerprint` hashes `generationPageObjectDir()`, which has been
      scope-derived since Phase 2 - so its value is a fact about ONE APPLICATION'S Page
      Objects. The memo was keyed by the repository ROOT alone. Harmless in the
      generation CLI (one process, one application); NOT harmless in the dashboard,
      where `surveyWork` calls it and the server calls `surveyWork` per request inside
      `activate`. A server that had served Project A answered for Project B with A's
      fingerprint, and `budgetExhausted` compares that value - so a row of B whose
      framework genuinely changed read as unchanged, its attempt budget was not
      reopened, and it stayed skipped saying "edit the row to try again".
    fix: "the memo key is now root + applicationId. The VALUE is unchanged, so no fingerprint moves and no attempt budget reopens."
    mutation_tested: >
      Reverting the key to the root alone turns 2 checks red, showing beta served
      alpha's fingerprint. The FIRST mutation attempt silently did not land (escaping in
      a nested heredoc) and the fixture stayed green - which is exactly the failure mode
      mutation testing exists to expose, and why the second attempt asserts the mutation
      landed before drawing any conclusion.

  audit_findings_by_section:
    identity_derivation: >
      ONE remaining URL-derived path: `applicationSlug(BASE_URL)` in canonical.ts,
      reachable only from `activeApplicationId()`'s catch when the registry cannot be
      read at all, with ScopeError rethrown. LEGACY-COMPATIBILITY, documented, deletable
      once no checkout predates the registry. Nothing else derives identity from a URL,
      host, title, documentId, workbook basename, testCaseId or Page Object name.
    ambient_state: >
      Seven module-level mutables. `session`/`pending` (recorder) are session-scoped and
      proven in Phase 4; `active`/`autocode` (server) are the serial-execution slots
      proven in Phase 6; `cachedApplicationId`/`cachedScope` are the documented ambient
      memos with an explicit reset; `corpusCache` (orchestrate) is SAFE because the
      server imports only `readState`/`surveyWork` from autocode and spawns generation
      as a child process - verified, not assumed. `cachedFingerprint` was the defect.
    caches_and_indexes: >
      Knowledge and the Page Object index are rebuilt on every call - no memoisation
      anywhere. Every other `new Map` in ai/ is a local inside a function. The only
      module-level cache carrying application-specific state was the fingerprint memo.
    path_traversal: >
      An applicationId can NEVER reach the filesystem unvalidated, twice over:
      `pathsFor` is called at exactly one site and only after `findApplication` confirms
      the id is registered, and `validateRegistry` admits only `[a-z][a-z0-9-]*` - so a
      registered id cannot contain a separator or a dot. Verified with `../bugasura`,
      `..`, `alpha/../beta`, `ALPHA`, `a/b`, `a.b`, `1alpha`, `al_pha`. Surrounding
      whitespace is trimmed and THEN validated, which is deliberate - a trailing space
      is a spelling, not an attack, and the trimmed value still goes through
      `findApplication`.
    ai_isolation: >
      `semantic.ts` is handed `buildIndex()` (scoped) and validates every answer against
      `index.pages[owner]` - the closed set is the active application's. Knowledge and
      corpus likewise, all rebuilt per call. No fourth input exists.
    fail_safe: "six ScopeError throw sites, all refusals; no silent fallback to a default or first project"

  what_this_phase_did_not_change:
    - "the legacy applicationSlug fallback - safe, documented, and not cosmetic to remove"
    - "corpusCache - per-process by construction; changing it would be refactoring without a finding"
    - "global stores (runs, generations, reports, quarantine) - identity-carrying by Phase 6"
    - "serialised execution - audited, not redesigned; parallel execution is not implemented"

  before_parallel_execution_could_be_enabled:
    - "test-results-excel/ is a single shared Playwright outputDir and is not scoped"
    - "reports/playwright-html/ is rewritten wholesale by every run"
    - "ai/reports/healing and allure-results are cleared by globalSetup unconditionally"
    - "`active` would have to become a per-application slot AND the output paths scoped first"
  parallel_execution_note: >
    Listed as the prerequisites, not as a plan. Nothing in this phase claims or prepares
    parallel execution.

  regression:
    fixtures: 62
    red: 0
    also_verified: "recordings/bugasura = 410; migration backup = 411; no scoped strays"

# ---------------------------------------------------------------- 2026-09-04 (Phase 8)
# PHASE 8 - FINAL PRODUCTION-READINESS, SECURITY AND DEPLOYMENT AUDIT.
# Broader than isolation. One P0, two P1, two P2. Read the P0 first.
production_readiness_phase_8:
  state: COMPLETE
  recommendation: READY WITH PREREQUISITES
  gate: ai/projects/repository-secrets.fixture.ts (8 checks)

  P0_committed_credential:
    status: REMEDIATED IN THIS REPOSITORY; ROTATION CONFIRMED BY THE OWNER
    what: >
      `.env` was TRACKED by Git and carried a real BUGASURA_EMAIL and
      BUGASURA_PASSWORD. `.gitignore` had listed `.env` since the beginning and had no
      effect, because gitignore only applies to files Git is not ALREADY tracking - the
      file was committed before the rule existed, so the rule read like protection while
      providing none.
    exposure: >
      Committed in 1eb2fa9 and present on origin/main AND origin/develop, so the
      credential reached the shared remote's history. Untracking does NOT remove it from
      earlier commits.
    done:
      - "`git rm --cached .env` - untracked, file preserved on disk, ignore rule now effective"
      - "the credential was rotated outside this repository by the owner"
      - "ai/projects/repository-secrets.fixture.ts pins the invariant, mutation-tested"
    still_required_by_policy: >
      History cleanup (git filter-repo / BFG plus a force-push) if organizational policy
      requires the old value gone from earlier commits. Rotation is the real fix and is
      done; cleanup is hygiene and is an operational decision with a force-push
      attached, so it is NOT performed from a fixture or from this session.
    rule_from_now_on: >
      `.env` must remain untracked. The fixture fails the whole suite if it is ever
      added again - verified by forcing `git add -f .env`, which turns the check red
      with the remediation command in the message and no value printed.

  P1_authentication:
    status: NOT IMPLEMENTED - deployment prerequisite, not a defect
    what: >
      There is no authentication, authorization, session, token or CSRF anywhere in
      ai/dashboard. The entire security model is `BIND = '127.0.0.1'` with no host
      option. Every mutating operation is unauthenticated: start and stop recording,
      start generation, start a run, create a project, write the workbook, read
      evidence, knowledge, test data and results.
    acceptable_when: "the dashboard is what it is today - a localhost developer tool"
    blocking_for: >
      ANY deployment that exposes the dashboard or its API beyond loopback - Docker with
      a published port, ECS/Fargate, a shared host, a tunnel. `EXCEL_DASHBOARD_HOST`
      changes only the friendly NAME; the socket stays on 127.0.0.1, so exposure would
      come from the deployment (port publishing, a proxy), not from a code change.
    not_implemented_here: "deliberately - inventing an auth layer was out of scope and would be worse than naming the gap"

  P1_run_retention:
    status: DOCUMENTED, NOT IMPLEMENTED
    measured: "ai/dashboard/runs holds 900 files / 98 MB today; ~3 MB per run with traces on"
    what: >
      `generations` is capped at five; `runs` has no retention at all and is deliberately
      unbounded (the root CLAUDE.md says so). Fine for a developer machine where the
      directory is disposable; on a long-lived deployment it exhausts disk.
    why_not_fixed_here: >
      A retention policy is a semantics decision, and the brief was explicit about not
      introducing arbitrary limits. The measurement is recorded so the decision can be
      made on evidence rather than on a guess.

  P2_items:
    - what: "corrupt state.json or mapping.json throws a bare JSON.parse error naming no file"
      severity: P2
      why_not_higher: >
        It fails LOUDLY. Nothing produces a wrong project, a false PASS or a false
        ACCEPTED - the run stops. `ai/projects/registry.ts` already wraps its parse with
        the file name and the reason, and is the model to copy when this is addressed.
    - what: "ai/reports/* is append-only and unbounded (450 files / 16 MB today)"
      severity: P2
      note: "intentionally global and identity-carrying since Phase 6; only the growth is unaddressed"

  P3_items:
    - "the legacy applicationSlug(BASE_URL) fallback - documented, ScopeError-guarded, reachable only with no registry at all"

  clean_results:
    command_execution: >
      Every process is spawned with an argv array, `shell: false`, and
      `process.execPath` or a resolved binary. BOTH occurrences of `shell: true` in the
      repository are COMMENTS explaining why it is not used - one in agent.ts (a shell
      would put spreadsheet prose through a command interpreter) and one in excel/cli.ts
      (the shell would read the `|` in a --grep pattern as a pipe). The --grep pattern
      escapes regex metacharacters from every Test Case ID.
    logging: >
      No credential reaches a log call. Passwords are redacted to the `[type=password]`
      marker before anything is written, and the redaction happens at capture rather
      than at write.
    filesystem_inputs: >
      Workbook paths are refused outside the repository and refused without an .xlsx
      extension. An applicationId cannot reach a path unvalidated - see Phase 7.
    deployment_portability: >
      No hardcoded absolute paths in tracked source; the Windows branch in agent.ts is a
      portability fix rather than an assumption; port 80 falls back to 4321 on EADDRINUSE
      or EACCES; the friendly hostname is optional and prints its own instructions.

  deployment_prerequisites:
    - "rotate any credential that was ever committed (done) and keep .env untracked (pinned by fixture)"
    - "put authentication and authorization in front of the dashboard before any non-loopback exposure"
    - "decide a retention policy for ai/dashboard/runs and ai/reports"
    - "provision BUGASURA_EMAIL / BUGASURA_PASSWORD as deployment secrets, never as files in the image"
    - "install Playwright browsers in the image; the suite assumes a chromium project exists"
    - "scope test-results-excel/ before any attempt at parallel execution (see Phase 7)"

  regression:
    fixtures: 63
    red: 0

decisions_2026_08_24:
  script_written_assertions: >
    For a script-written assertion with no admissible provenance the framework intentionally
    prefers NEEDS_REVIEW over promoting a claim-time locator candidate. CLAIM-TIME UNIQUENESS
    IS NOT PROOF OF RUN-TIME IDENTITY. Tested on TC_LOGIN_128's own evidence in three designs:
    honest claim-time identity capture changes nothing (provesIdentity requires press or pick),
    and marking the count attributable - or stamping the capture as a pick - both RE-EMIT
    `page.locator('h2')`, which fails on three elements. The record-time page had one h2 and the
    run-time page has three, so no record-time capture can settle it. The expected assertion
    text is never identity; h2 is never rewritten to a scoped or role-and-name locator; no index
    is ever added.
  recommended_recording_path: >
    An assertion that needs element-level provenance should be recorded through the existing
    Assert/Pick workflow, which captures at the instant the claim is made and resolves a SCOPED
    expression. TC_LOGIN_123 / 126 / 127 are the working proof; a Codegen-written assertion
    cannot carry provenance and its honest outcome is a refusal.

# Every phase below was verified by reading the code and running its fixture,
# not by trusting a previous session's claim.
phases:
  - name: locator-quality safety (dynamic ids, positional, XPath, force, sleeps)
    state: DONE
    where: ai/autocode/locator-quality.ts
    fixture: ai/autocode/locator-quality.fixture.ts, locator-safety.fixture.ts
  - name: press-time evidence (measuredAt/identityMatched/sameDocument/matchCount)
    state: DONE
    where: ai/autocode/dom-evidence.ts (isProvenAgainstClickedTarget)
    fixture: ai/autocode/clicked-target.fixture.ts, dom-evidence.fixture.ts
  - name: compound-selector press claim (RC-1)
    state: DONE
    where: ai/dashboard/live-recorder.ts (containerTokens - ids required, classes corroborate)
    fixture: ai/dashboard/parked-claim.fixture.ts
    note: >
      Fixes claiming for future recordings only. Recordings made before
      2026-08-19 14:39 keep claim-time evidence and cannot be repaired.
  - name: existing Page Object reuse by name
    state: DONE
    where: ai/autocode/from-recording.ts (findMethod, + proven-locator tie-break)
    fixture: ai/autocode/proven-locator-reuse.fixture.ts
  - name: existing Page Object reuse by proven locator
    state: DONE
    where: ai/autocode/from-recording.ts (findMethodByProvenLocator)
    fixture: ai/autocode/proven-locator-reuse.fixture.ts
  - name: parameterised Page Object reuse
    state: DONE
    where: ai/autocode/abstraction/parameter.ts (resolveParameterisedReuse)
    fixture: ai/autocode/parameter.fixture.ts
  - name: structural/contextual recovery from a positional recorded locator
    state: DONE
    where: ai/autocode/abstraction/classify.ts (effectiveLocator, disambiguated-by-clicked-target)
    evidence: >
      All 5 corpus positional locators that have a proven unique contextual
      alternative resolve to Page Objects with 0 positional emitted and 0
      needs-review (TC_DASHBOARD_008/011/020, TC_LOGIN_083/092). The other 18
      have every candidate measured ambiguous and are correctly NEEDS_REVIEW.
  - name: safe identifier fallback (prefer a stable authored id)
    state: DONE
    where: ai/autocode/locator-quality.ts (analyseIdentifier) + candidate ranking
    evidence: >
      66 of 185 emitted raw locators already use a stable authored id; 13
      unproven targets carrying a generated id are refused. What such targets
      still lack is Page Object WRAPPING, which is the abstraction engine's
      job and is governed by ownership/naming, not by identifier choice.
  - name: deterministic abstraction (classify/validate/name/propose/write)
    state: DONE
    where: ai/autocode/abstraction/
    fixture: ai/autocode/abstraction.fixture.ts
  - name: duplicate-capability detection by element, not by name
    state: DONE
    where: ai/autocode/abstraction/propose.ts (existingCapability) + knowledge/page-knowledge.ts (selectorTokens)
    fixture: ai/autocode/proven-locator-reuse.fixture.ts (checkTokeniser)
  - name: AI semantic fallback, deterministically re-validated
    state: DONE
    where: ai/autocode/abstraction/semantic.ts (single entry, single validation path)
    fixture: ai/autocode/abstraction/semantic.fixture.ts
    note: "AMBIGUOUS_NAME deliberately disabled - see the note in semantic.ts."
  - name: Page Object creation before mapping (current test consumes it)
    state: DONE
    where: ai/autocode/orchestrate.ts (ensurePageObjects, called before generateFromRecording)
    fixture: ai/autocode/abstraction.fixture.ts
  - name: strict-mode gate on unmeasured bare text locators
    state: DONE
    where: ai/autocode/locator-quality.ts (isUnscopedTextLocator + textProvenUnique)
    fixture: ai/autocode/strict-mode-locator.fixture.ts
  - name: identity cardinality (no silent .first() in Page Object resolution)
    state: DONE
    where: tests-e2e/support/resilient-locator.ts + pages/base.page.ts (resolve / resolveMany)
    fixture: ai/autocode/locator-cardinality.fixture.ts
    live_verified: true
  - name: positional-identity static gate on generated specs
    state: DONE
    where: ai/autocode/verify.ts (staticCheck -> positionalIdentity)
    fixture: ai/autocode/locator-cardinality.fixture.ts
  - name: evidence retention on acceptance
    state: DONE
    where: ai/dashboard/recorder.ts (archiveArtifact) + from-recording.ts (acceptRecording)
    fixture: ai/dashboard/evidence-retention.fixture.ts
    note: "Forward-looking only. See blockers.legacy_22."
  - name: final NEEDS_REVIEW as terminal state
    state: DONE
    evidence: >
      A target that exhausts reuse, contextual recovery and identifier
      fallback becomes kind:'needs-review' and emits no locator. Verified on
      TC_LOGIN_096 (unmeasured text) and TC_LOGIN_100 (positional with every
      candidate ambiguous).

  - name: press-time positional measurement (positionWithinCandidate)
    state: DONE
    where: ai/autocode/dom-capture-source.ts (in-page), ai/autocode/dom-evidence.ts
    fixture: ai/autocode/positional-recovery.fixture.ts
    schema_change: true
    note: >
      Measured in the page as nodes.indexOf(pressedElement), only when a candidate
      matched more than one element. NOT derived from targetIndex (a parking slot),
      recording order, post-action DOM or AI. Persisted in its OWN list,
      positionProvenCandidates, because derivedCandidates admits only matchCount===1
      and nothing may be promoted out of rejectedCandidates.
  - name: evidence-backed positional recovery
    state: DONE
    where: ai/autocode/locator-quality.ts (positionRecovery, called from 2 exhaustion points)
    fixture: ai/autocode/positional-recovery.fixture.ts
    note: >
      Last deterministic resort. Composes bestContextualCandidate.nth(measuredIndex),
      never recordedChain.nth(). Requires measuredAt==='press', sameDocument===true,
      matchCount>1, an integer index inside range, and a base expression that is
      itself free of dynamic identifiers and other forbidden mechanisms. A proven
      UNIQUE candidate still wins; this cannot run while any earlier phase can.
  - name: abstraction accepts an evidence-backed index
    state: DONE
    where: ai/autocode/abstraction/classify.ts (effectiveLocator.positionProven), validate.ts
    note: >
      effectiveLocator reports positionProven SEPARATELY from proven. validate.ts skips
      the FORBIDDEN_MECHANISM refusal for .nth() only when that flag is set; first(),
      last(), force, mouse, dispatchEvent, sleeps, retries and XPath are refused
      exactly as before, and so is an index with no measurement behind it.

  # ---- Page Object lifecycle (2026-08-21). Every element gets a decision.
  - name: the THIRD silent exit - RECORDER_OWNED targets
    state: DONE
    where: ai/autocode/abstraction/propose.ts (RECORDER_OWNED_ELEMENT)
    note: >
      Found by the lifecycle itself, not by reading the code: eight `click .veil` steps
      across four recordings came back as "the abstraction engine holds no record for
      this element", which is the loud failure this phase installed. A recorder overlay
      still gets no method - only the silence changed. Corpus-wide afterwards: 430
      elements, 0 without a record.
  - name: no silent skip - every PAGE OBJECT REQUIRED element is evaluated or refused
    state: DONE
    where: ai/autocode/abstraction/propose.ts (unmeasured[]), abstraction/lifecycle.ts
    fixture: ai/autocode/abstraction/lifecycle.fixture.ts
    evidence: >
      The two silent exits are gone: `if (!evidence) continue` per target, and the
      whole-recording skip when no sidecar exists. Measured before the change: 225 raw
      locators across the corpus, 87 of which had NEVER been evaluated - 58 from 16
      recordings with no sidecar, 29 from 18 recordings with a sidecar but no
      measurement for that target. They are now UnmeasuredTarget records carrying
      NO_ADMISSIBLE_EVIDENCE and the remedy "Re-record required."
  - name: lifecycle dispositions replace user-facing NEEDS_REVIEW
    state: DONE
    where: ai/autocode/abstraction/lifecycle.ts (Disposition, decideLifecycle)
    note: >
      Five terminal values, none of them a review queue. A method created in THIS
      generation reports the creation rather than the reuse it looks like to
      mapRecording, and `written` decides that - never `outcome === 'APPLIED'`, which
      is set before anything reaches disk and survives a rollback.
    log: ai/reports/page-object-lifecycle.jsonl (one JSON line per element)
  - name: multi-question resolver exchange
    state: DONE
    where: ai/autocode/abstraction/semantic.ts (eligibility -> codes[], revalidate(codes))
    note: >
      One exchange settles every open semantic question. An askable question beside an
      unaskable one is still not asked - clearing half leaves the rest standing.
  - name: bounded AI repair loop
    state: DONE
    where: ai/autocode/abstraction/semantic.ts (MAX_RESOLVER_ATTEMPTS = 3)
    note: >
      revalidate runs UNCHANGED on every attempt; the repair prompt carries the
      validator's verbatim rejection. Exhaustion is a terminal RESOLVER_EXHAUSTED
      (STRUCTURAL). A transport OUTAGE spends no attempt and adds no refusal.
      `exhaustedBefore` memoises across runs so a stateless analyser cannot re-ask an
      unanswerable question for ever.
  - name: widened semantic questions (TEXT_ONLY_IDENTITY, UNCLASSIFIED, AMBIGUOUS_NAME)
    state: DONE
    where: ai/autocode/abstraction/semantic.ts (SEMANTIC_ENABLED)
    evidence: "eligible proposals went 4 -> 11 of the 12 purely-semantic ones"
    note: >
      SINGLE_TARGET stays off: it is a claim about SAMPLE SIZE, not meaning. The 12th
      is correctly refused by the press-time proof bar (identityMatched false).
  - name: AMBIGUOUS_NAME structural writer fix
    state: DONE
    where: ai/autocode/abstraction/writer.ts (renderKnowledgeEntry), propose.ts flag
    note: >
      A shared accessible name is OMITTED from the entry, so findMethod's page-wide
      match has nothing to bind; the method is reached by findMethodByProvenLocator.
      A UNIQUE name is still declared. revalidate refuses to clear the code unless the
      corpus flag is set AND a template exists.
  - name: Page Object registration (fixture + class + verify)
    state: DONE
    where: ai/autocode/abstraction/writer.ts (registerFixture, renderPageObjectClass, verify)
    note: >
      verify() now consults index.fixtures. Without it a method could be written onto a
      fixture-less class, report APPLIED, and make Playwright refuse the whole spec file
      with "Test has unknown parameter" - 0 tests collected. BasePage and TermsPage have
      no fixture BY DESIGN and are refused rather than registered.
  - name: semantic scenario titles
    state: DONE
    where: ai/autocode/scenario-title.ts, from-recording.ts assembleSpec
    evidence: >
      TC_LOGIN_112 went from
      "#tr_1749558 > .tabulator-cell... - 1749558 is ticked" to
      "Verify issue checkbox selection on the Issues page".
    note: >
      Derived at ASSEMBLY from the mapping's semantic vocabulary, only when the authored
      cell fails `unstableTitleReason`. The workbook cell is never rewritten - authored
      columns are not ours to touch - and a hand-written title always wins.
  - name: fresh-generation harness (archived recordings, no spec overwritten)
    state: DONE
    where: ai/autocode/fresh-generation.ts, propose.ts analyseCorpus({ includeArchived })
    note: >
      includeArchived is OFF by default and that default is load-bearing: reading the
      archive by default would make accepted recordings look live and a routine run
      would regenerate every accepted spec.

page_object_lifecycle:
  measured_before: "225 raw locators; 87 never evaluated; 45 of 60 proposals NEEDS_REVIEW"
  eligible_for_resolver: "4 of 45 before, 11 of 61 after"
  tc_login_112_fresh:
    title_before: "#tr_1749558 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont > .rounded-checkbox-ui - 1749558 is ticked"
    title_after: "Verify issue checkbox selection on the Issues page"
    elements: 9
    reused: 5
    refused: 4
    created: "ProjectsPage.projectCard(description), by the resolver, re-validated"
    raw_locators: "5 -> 4"
    collected: true
    executed: "passed live against my.bugasura.io in 24.8s"
    existing_spec_modified: false
  live_resolver_variance:
    observed: >
      Four live exchanges on the SAME question gave four different answers:
      REUSE_EXISTING+projectCard, CREATE+openProjectCard, three declines, and
      CREATE+projectCard. Every one was handled correctly - nothing invalid was ever
      accepted and no run ended in an open review. Two real defects were found this way
      and fixed: a decline that ANSWERED the question was being discarded, and
      REUSE_EXISTING naming a non-existent method was silently becoming a creation.
    consequence: >
      The framework guarantees SAFETY and VALIDITY, not name stability across runs.
      Once created, METHOD_EXISTS/existingCapability pin the name, so the variance is
      spent exactly once per capability.

blockers:
  legacy_22:
    what: 22 accepted tests carry unsafe locators (positional, dynamic id, ambiguous text)
    why_blocked: >
      Their recordings AND evidence were deleted by the old discard-on-accept
      policy, before evidence retention existed. ai/ is untracked in git, so
      there is no history to restore from. They are LEGACY_UNRECOVERABLE.
    options: [re-record each case, remove from Automated with the ID reported]
    decision_owner: user
    do_not: [invent locators, weaken gates, silently quarantine]
  page_object_direct_locators:
    what: 5 sync getters build locators directly instead of via resolve()
    which: [resultRows, rowStatus, issueCheckboxState, issueCheckbox, issueRow]
    why_it_matters: >
      They bypass the cardinality chokepoint and have no healing. The three
      engine-created ones inherit this from the writer's template.
    audited: 2026-08-20
    audit_finding: >
      NOT a safety hole. No getter narrows internally - zero .first()/.nth()/
      .last() anywhere in a getter body - so an ambiguous one throws Playwright's
      strict-mode error at the point of use rather than silently picking an
      element. resultRows is a collection by name and intent and must stay
      direct. rowStatus is identity already scoped to a caller-supplied row.
      The remaining three (issueCheckboxState, issueCheckbox, issueRow) are
      identity and can genuinely match several - TC_LOGIN_100 measured 3.
      Routing those three through resolve() buys healing and a better message;
      it is a DIAGNOSTICS improvement, not a safety fix.
    also_checked: >
      projects.page.ts validationMessages/availableTeams return string[] via
      evaluateAll, so they are reads, not identity getters and not in scope.
      The only caller narrowing a getter result is login-test-cases.spec.ts:35,
      issuesPage.rowStatus(rows.first()) - it narrows the COLLECTION before
      passing it as a scope, which is legitimate. resilient-locator.ts contains
      0 occurrences of build(page).first().
    decision_owner: user
  accepted_specs_with_positional_identity:
    what: 3 accepted specs marked Automated use .first() to IDENTIFY an element
    which:
      - TC_DASHBOARD_007 (2: .ba-switch__track, .ba-switch__thumb)
      - TC_DASHBOARD_010 (1: .rounded-checkbox-ui)
      - TC_DASHBOARD_017 (2: .ba-switch__track)
    why_blocked: >
      They were accepted before verify.ts gained positionalIdentity(). Today's
      gate refuses all 5 - confirmed by running staticCheck over the real files.
      They are a subset of blockers.legacy_22, called out separately because
      unlike the rest they are exactly what evidence-backed positional recovery
      was built to replace, and one of them is measurably re-recordable now.
    decision_owner: user
    do_not: [hand-edit the locator, weaken positionalIdentity, silently requarantine]

open_cases:
  TC_LOGIN_100:
    recorded: 2026-08-20 07:00
    generated: false
    finding: >
      Two targets. Both have ZERO accepted candidates; every contextual
      candidate was rejected "matched 3 elements". The row text is not unique
      on that screen. Correct outcome is NEEDS_REVIEW - neither contextual
      recovery nor identifier fallback can help, because [id="1749553"] is a
      generated identifier.
    next_action: >
      RE-RECORD REQUIRED. Two things are missing and only a new recording can
      supply either: the positionWithinCandidate measurement (added 2026-08-20,
      so no existing recording has it) and a contextual base that is not itself
      ambiguous - its rows are not distinguishable by text, so every candidate
      measured 3 elements. Evidence was NOT manufactured to make it pass.
      Re-record against a project whose issue rows have distinct summaries.

evidence_schema:
  changed: 2026-08-20
  added:
    - CandidateMeasurement.positionWithinCandidate (number | null)
    - TargetEvidence.positionProvenCandidates (CandidateMeasurement[])
    - TargetEvidence.elementRef (string)
    - TargetEvidence.captureRef (string) - assertion-pick rows only
    - "TargetEvidence.captureTiming gains a third value: 'assertion-pick'"
    - RecordedAssertion.subjectProvenance - in the ASSERTIONS sidecar, not this one
  element_ref: >
    The NAME of the registration a graph was captured from, an opaque
    "documentId:slot". The second join key, and the only one that survives two
    independently composed locators for one element. Present only on the before-action
    path; an after-action capture has no press to name.
  subject_provenance: >
    { refs: string[], locatorMatchCount: number | null, captureRef?: string }, written to
    <TC_ID>.assertions.json. Validated on read by readAssertionProvenance and stripped
    when malformed, never interpreted; a malformed captureRef is dropped on its own
    rather than failing the whole record.
  capture_ref: >
    Names one assertion-pick CAPTURE, where elementRef names the NODE. One element can be
    asserted about repeatedly and each claim is about a different instant, so a name per
    node cannot also identify a measurement. Format is <elementRef>#<n>, n being a
    per-recording counter, so a reader can still see which node a capture belongs to.
  capture_timing_third_value: >
    'assertion-pick' means no action was involved: a person pointed at an element and
    said what must be true of it. evidenceFor and targetByElementRef both skip such rows
    - the first because a pick row was captured for a node and not for a locator, the
    second because several pick rows can share an elementRef. They are reached by
    captureRef and nothing else. domEvidence.assertionPickCount counts them, so before +
    after + pick accounts for every target.
  backward_compatible: true
  reading_old_evidence: >
    All optional. Absent positionWithinCandidate means positional recovery is
    UNAVAILABLE for that recording - never approximated and never defaulted to index 0.
    Absent elementRef means the assertion-to-target ASSOCIATION is unavailable, so the
    assertion is judged exactly as it was before that mechanism existed. Verified over
    the whole corpus: 0 of 304 targets carried positionWithinCandidate when it landed,
    and 0 of TC_DASHBOARD_023's 7 targets carry elementRef. Neither can fire for an
    existing recording, by design.
  fingerprint_impact: >
    dom-evidence.ts, from-recording.ts and locator-quality.ts are all hashed by
    frameworkFingerprint, and the metrics SCHEMA went 9 -> 10, so every case's attempt
    budget reopens once. Expected and accepted. LiveMetrics gained provenanceAssertions /
    provenanceUnavailable / assertionCaptures, which are in-memory recorder telemetry and
    reach no sidecar.

wiring_gaps_found_and_fixed:
  when: 2026-08-20
  how_found: >
    Code tracing BEFORE asking for a recording, not by a recording. Four links
    between the live-proven measurement and the decision layer were broken, and
    each one alone was enough to make the mechanism unreachable for every
    recording ever made.
  why_nothing_caught_them: >
    The failure was silent and indistinguishable from correct behaviour.
    Evidence was written with no position, recovery declined for want of a
    measurement, and the case reported NEEDS_REVIEW - which is exactly what a
    CORRECT pipeline reports for a recording made before the field existed.
    positional-recovery.fixture.ts builds its evidence by hand, which is the
    right way to test a decision and the reason it could not see any of this.
  gaps:
    - where: ai/dashboard/live-recorder.ts measureCandidates
      was: >
        Built CandidateMeasurement from the page answer and never copied
        positionWithinCandidate. The in-page half computed it; the recorder
        dropped it one line later.
      now: carried only when the page answered a number; absence never becomes 0
    - where: ai/dashboard/live-recorder.ts splitCandidates
      was: >
        promotable = isProvenAgainstClickedTarget, which requires matchCount 1.
        A position exists only when the count exceeds 1, so a positioned
        candidate always went to rejectedCandidates - from which nothing may be
        promoted.
      now: >
        Returns a THIRD list, positionProvenCandidates. The candidate still goes
        to rejectedCandidates with its reason and still never enters
        derivedCandidates; nothing was promoted and no list changed meaning.
    - where: ai/autocode/dom-evidence.ts sanitiseEvidence
      was: >
        Harvested positionProvenCandidates by FILTERING derivedCandidates, which
        admits matchCount 1 alone. Mutually exclusive conditions: the block was
        unreachable dead code.
      now: reads the recorder's own list, predicate still applied at the boundary
    - where: ai/autocode/locator-quality.ts branch 1 (measuredAmbiguity)
      was: >
        Returned NEEDS_REVIEW/measured-ambiguous without consulting
        positionRecovery. THE DECISIVE ONE: a real ambiguous click that Codegen
        writes without .first() leaves the recorded locator matching several
        elements, so a real recording lands on THIS branch, not the positional
        one at 1b. Verified: target matchCount 1 and null recovered, 3 did not.
      now: >
        Consults positionRecovery before refusing, mirroring 1b. Third call site.
        The refusal text is unchanged and still true of a SYNTHESISED index.
  not_changed:
    - where: ai/dashboard/live-recorder.ts, the second MEASURE_IN_PAGE call site
      why: >
        It is the assertion picker and builds measuredAt 'pick'. A position is
        proof only at 'press', so a pick-time position is deliberately not
        carried. Left alone on purpose.
  empirical_confirmation:
    recordings: [TC_LOGIN_102, TC_LOGIN_103]
    recorded_by: user, 2026-08-20 12:54 and 13:11
    finding: >
      Both recorded exactly the intended scenario - a click on
      .rounded-checkbox-ui in the issue list - and BOTH carry zero positions.
      TC_LOGIN_103 target 5 holds 12 candidates, every one measuredAt 'press'
      with identityMatched false, and the container-text and scoped-class
      candidates measured EXACTLY 3. So the in-page half ran, measured the right
      candidates and computed the index; the recorder discarded it. This is the
      bug observed in real data rather than inferred from code.
    real_contextual_base_available: >
      page.locator(".tabulator-row").filter({ hasText: "login is not working in
      moolya aura SAM" }).locator(".rounded-checkbox-ui") - measured at 3.
    verdict_today: >
      NEEDS_REVIEW / measured-positional / null. CORRECT: the position is
      genuinely absent from the file and was NOT injected to make it pass.
      Because Codegen wrote .first(), the recorded locator's own matchCount is 1,
      so this recording lands on branch 1b - gaps 1-3 are what blocked it, and
      gap 4 blocks the variant Codegen writes without .first().
    consequence: >
      These two recordings CANNOT be repaired. Evidence is immutable provenance
      and the measurement is missing, not wrong. Re-recording is the only route.
  regression_protection: ai/dashboard/positional-wiring.fixture.ts (27 checks)
  testability_change: >
    splitCandidates is now exported, for that fixture only. The wiring it
    performs had no test, which is how the field reached evidence as nothing at
    all for as long as it existed.

live_validation:
  measurement:
    when: 2026-08-20
    how: >
      The real PREACTION_HOOK injected into my.bugasura.io, signed in, opened a
      project, clicked .rounded-checkbox-ui index 1 of 3, then called the real
      window.__auraMeasure. Read-only apart from the checkbox toggle, which was
      toggled back. No recording, no generation, no workbook write.
    result: >
      The pressed span measured count=3, identityMatched=false,
      positionWithinCandidate=1 - the element actually clicked. The sibling
      parked entry (the 0x0 input) measured null, correctly, because it is not
      in that match list. isPositionProvenAgainstClickedTarget accepted it and
      positionalExpression composed
      '#bugReport-table .rounded-checkbox-ui' + .nth(1).
    proves: >
      The in-page half works against the real application: a real ambiguous
      press yields the real index, and an element outside the match list yields
      null rather than a default.
    does_NOT_prove: >
      End-to-end. A recording needs the dashboard driving codegen with a person
      clicking, so the chain recording -> evidence.json -> candidate -> Page
      Object -> generated test -> run -> acceptance is still UNEXERCISED.
      The architecture is NOT production-proven.

decision_order:
  authoritative: ai/autocode/locator-quality.ts assessLocator
  established: 2026-08-20
  order:
    - 1. input.pageObject -> REUSE_PAGE_OBJECT (first decision, nothing reaches past it)
    - 2. fromEvidence - measured mechanisms, in this order inside it:
    -    2a. measured ambiguity settled by a press-time proven-unique candidate
    -    2b. positional recorded locator replaced by a proven-unique candidate
    -    2c. generated identifier replaced by proven, then merely-counted, candidate
    -    (each of 2a-2c consults positional recovery only after ITS OWN better path fails)
    - 3. strict-mode gate - an unmeasured bare text locator is refused, never positioned
    - 4. offline scorer - role+name 95, label 90, test-id 85, text 75, stable-id 70, css 65
    - 5. evidence-backed positional recovery, ONLY where 1-4 produced no safe locator
    - 6. identifier policy unchanged - a generated id is still never emitted
    - 7. NEEDS_REVIEW
  the_defect_this_replaced: >
    positionRecovery was called from the TAIL of fromEvidence, so it answered before
    steps 3 and 4 ever ran. assessLocator returns fromEvidence's verdict if it has one,
    and step 4 is what emits getByRole('textbox', { name: 'Email' }). Harmless while no
    recording carried a position; the first one that did (TC_DASHBOARD_023) downgraded
    three role-name locators to .nth(0) on a container-text base. A locator got WORSE
    because more evidence existed.
  fixture: ai/autocode/locator-decision-order.fixture.ts

positional_not_parameterisable:
  where: ai/autocode/abstraction/propose.ts, types.ts
  code: POSITIONAL_NOT_PARAMETERISABLE (class SAFETY - nothing may clear it)
  what: >
    A proven expression narrowing by a measured index cannot become a parameterised
    capability. TC_DASHBOARD_023 offered
    `.tabulator-row filter(hasText: description) .rounded-checkbox-ui .nth(2)` as a
    reusable method taking a description - the parameter says "any row you name" and
    the index says "the third one I pressed". Index 2 generalises to no other value.
  all_three_outcomes_shut: >
    name-matched REUSE and template-matched REUSE are both gated on SAFETY, and the
    branch takes REFUSED before the ladder can reach PROPOSED. It was reported REUSE
    before this, and only because a method of that name already existed - had it not,
    PROPOSED was the next branch and an indexed method would have been written.
  unaffected: >
    A method that resolves the target WITHOUT positional narrowing still reuses
    normally; its expression carries no index so it never enters this branch.

static_check_is_evidence_aware:
  where: ai/autocode/verify.ts provenPositionalExpressions, positionalIdentity
  why: >
    The proof for an index cannot be in the spec text. A locator string carries no
    provenance, so a shape-only rule can only establish that an index is PRESENT -
    which quarantined TC_DASHBOARD_023, whose index was the one measured thing about
    it. The check now re-derives, from that case's own evidence file and with the same
    predicate, the exact set of positional expressions the recording proves, and skips
    only a line containing one of them.
  teeth_verified:
    - the exact proven expression -> allowed
    - same base different index -> refused
    - a base the evidence never measured -> refused
    - the proven expression under a different case id -> refused
    - the proven expression with no case id -> refused
    - first() and last() -> always refused
  boundary_narrowed: >
    ai/autocode/dom-evidence.fixture.ts asserted `!verify.includes('dom-evidence')`.
    Replaced by the invariant it was protecting, with more teeth: verify.ts may import
    ONLY isPositionProvenAgainstClickedTarget and positionalExpression, the mutator is
    evidence-blind, and no run is skipped or excused on the strength of evidence.

assertion_target_provenance:
  state: DONE
  implemented: 2026-08-20
  chose: "option (a) - record the association at pick time"
  what_was_broken: >
    evidenceFor() joins a recorded step to its evidence on the locator STRING. Correct
    for an action - the action IS the line Codegen wrote - and wrong for an assertion,
    whose locator is composed independently by locatorFor from the element's own
    description. TC_DASHBOARD_023: assertion page.locator(".bugChecked") against a row
    recorded as page.locator('[id="1749552"]'). One input, no shared substring, no
    evidence, css scored 65 and emitted, strict-mode violation at run time - with the
    measurement naming which of the three sitting in the same file.
  mechanism: >
    NODE IDENTITY, compared in the page while both nodes are alive, and nothing else.
    Every registration into __auraTargets now also gets a NAME (refFor -> an opaque
    "documentId:slot"), allocated by the ONE allocate() that both the press hook and the
    picker's door go through. A press carries its name out on the parked entry;
    takePreAction puts it on TargetEvidence.elementRef. At pick time __auraSameElement
    compares the picked SUBJECT's node with every queued press's node using === and
    returns the names that match. RecordedAssertion.subjectProvenance holds those names
    plus locatorMatchCount - Playwright's own count of the ASSERTION's own locator, taken
    in the document the person was looking at.
  where:
    - "ai/autocode/dom-capture-source.ts: allocate, refFor, __auraSameElement"
    - "ai/dashboard/live-recorder.ts: elementRef on claim, assertionSubjectSlot, registrySlotFor, resolveAssertionProvenance, recordAssertionFromPicker"
    - "ai/dashboard/recorder.ts: RecordedAssertion.subjectProvenance"
    - "ai/autocode/dom-evidence.ts: elementRef, AssertionProvenance, readAssertionProvenance, targetByElementRef, evidenceForAssertionSubject"
    - "ai/autocode/from-recording.ts: readAssertions validation, emitAssertion wiring"
  fixture: ai/autocode/assertion-provenance.fixture.ts
  not_used_to_decide: >
    selector text, generated id, DOM proximity, previous step, matching index, similar
    class name. A look-alike in the sibling row - same tag, class, name and place in an
    identical row - matches nothing, asserted against a real DOM rather than reasoned
    about.
  projection_is_an_allow_list: >
    An adopted row is projected, not handed over. Element-level facts transfer (node,
    parent, ancestors, siblings, every measured and refused candidate, pressTimeText);
    locator-level facts do not. matchCount/matchCountDocument are restated from the
    pick-time count and IDENTIFIER IS DROPPED - it describes the id Codegen's expression
    was built on, and carrying it would send an assertion whose own locator is a clean
    role-and-name down the generated-id branch and out as an index. An allow-list, so a
    field added to TargetEvidence tomorrow does not travel until somebody decides it is
    true of the element.
  two_rows_one_element: >
    Refused, not chosen between. A click and a check on one input write two lines and
    claim two parked entries; both graphs are true and were taken at different instants.
    refs may hold several names for one node (pointerdown and focusin both fire on the
    input a label forwards to) - a multiplicity of NAMES, never of elements.
  which_element_is_asserted: >
    NOT always the association resolver's subject, and the first version of this got it
    wrong. Checked belongs to the control holding the state; Visible belongs to what a
    person can SEE, because a custom switch's subject is a 0x0 input the application
    hides on purpose. recordPickedAssertion already makes that decision, so it now hands
    out the slot (`asserted`) and resolveAssertionProvenance takes a slot rather than a
    payload. Deriving it from the subject named the INPUT for a `visible` assertion
    recorded against the SPAN - one element's locator judged against another element's
    evidence. Mutation-tested: restoring the subject-derived slot turns two checks red.
  role_separation: >
    Provenance is a third fallback for the reuse resolvers and a second source for the
    locator engine. It changes no action step (asserted), the assertion is still emitted
    as an assertion, and evidenceForResolved stays a reuse-only key because its row's
    counts belong to Codegen's chain. One pre-existing inconsistency was fixed while
    here: assessLocator re-derived its evidence with evidenceFor() alone, so the fallback
    the reuse resolvers already had never reached the one decision that needed it.
  legacy: >
    A recording made before 2026-08-20 17:00 carries no elementRef and CANNOT be
    repaired - the document that could have answered is gone, exactly as with
    positionWithinCandidate. Verified: 0 of TC_DASHBOARD_023's 7 targets carry one, and
    its assertion carries no subjectProvenance. Re-recording is the only route.
  superseded_by: assertion_pick_capture

assertion_pick_capture:
  state: DONE
  implemented: 2026-08-20
  found_by: TC_LOGIN_107, recorded by the user at 20:09
  what_was_broken: >
    TC_LOGIN_107 asserts a checkbox is NOT ticked, clicks it, then asserts it IS ticked -
    both assertions about the same input, id 1749553. The second resolved to the proven
    positional locator and passed. The FIRST emitted a raw page.locator(".bugChecked")
    and failed strict mode on 3 elements. Cause: elementRef was allocated fresh per
    PRESS, and __auraSameElement walked the press queue only, so an element nothing had
    yet pressed had no name at all - and the assertion that came first therefore had no
    way to be tied to the element it was about.
  two_things_conflated: >
    elementRef was doing duty as both "which node" and "which capture". They are
    different questions. One node can be asserted about repeatedly, and each claim is
    about a different instant, so a name per node cannot also identify a measurement.
  mechanism_1_idempotent_allocation: >
    allocate() is now IDEMPOTENT PER NODE: ask the registry twice for the same live
    element and the same slot comes back, so its name exists from the first moment
    anything looks at it rather than being earned by an interaction. A linear scan of at
    most MAX entries, not a Map, so no extra reference is held; a released slot cannot
    match, so the element is registered afresh and gets a NEW name and a stale one is
    never handed back.
  mechanism_2_own_name_first: >
    __auraSameElement returns the NODE'S OWN name first, then any other press-queue
    registration that is the same node - which only differs after a release. One node
    pressed twice is now one name; two look-alike siblings are two names.
  mechanism_3_pick_is_a_capture_site: >
    __auraObserveSlot captures a registered node's graph with NO interaction, and
    captureAssertionTarget measures its candidates through the same
    candidateSelectorsFor -> __auraMeasure path a press uses, stamped measuredAt 'pick'.
    It never parks a press, so an assertion's graph can never be claimed by a recorded
    action line.
  mechanism_4_capture_has_its_own_name: >
    TargetEvidence.captureRef names one such capture; captureTiming gains a third value,
    'assertion-pick'; AssertionProvenance.captureRef names the capture made for THAT
    assertion. evidenceForAssertionSubject resolves captureRef first and falls back to
    node identity, which is what keeps every earlier recording unchanged.
  unreachable_by_string: >
    A pick row is invisible to evidenceFor twice over - its locator is not an expression
    at all, and evidenceFor skips assertion-pick rows regardless - because two different
    elements routinely compose the same expression and matching a pick row by string is
    the mis-association the whole mechanism exists to remove. targetByElementRef skips
    them too: several pick rows can share an elementRef, so node identity would find
    them all ambiguous.
  timing_asymmetry_preserved: >
    isPositionProvenAtPick is a SEPARATE predicate, for the reason isProvenAtPick is
    separate from isProvenAgainstClickedTarget. An ACTION still demands a press-time
    position; an ASSERTION may use its own pick, because an assertion is a claim about
    the page as it stood when it was made. positionRecovery takes the caller's kind and
    nothing else about it moved - the five measurements demanded of a candidate, the
    refusal of an unsafe base, the scoped-beats-bare ordering and the composition of the
    expression are all unchanged.
  locator_quality_change: >
    ONE, and it was required: positionRecovery gained a `kind` parameter and consults the
    pick predicate only for an assertion. Nothing else in locator-quality.ts moved, and
    no scoring changed.
  where:
    - "ai/autocode/dom-capture-source.ts: idempotent allocate, __auraSameElement own-ref, __auraObserveSlot"
    - "ai/dashboard/live-recorder.ts: OBSERVE_IN_PAGE, captureAssertionTarget, pick handling in splitCandidates, pickCaptures map"
    - "ai/autocode/dom-evidence.ts: isPositionProvenAtPick, isPositionProven, captureRef, captureTiming 'assertion-pick', captureByRef"
    - "ai/autocode/locator-quality.ts: positionRecovery kind parameter"
    - "ai/autocode/verify.ts: provenPositionalExpressions accepts either timing"
    - "ai/autocode/metrics.ts + from-recording.ts: SCHEMA 9 -> 10, domEvidence.assertionPickCount"
  fixture_cases: >
    assertion-provenance.fixture.ts parts H, I and J. H drives assert(A) click(A)
    assert(A) through the real recorder over a stub DOM of TC_LOGIN_107's exact shape:
    one elementRef, two captureRefs, each assertion judged on its own measurement, and
    the same evidence gives an ACTION no position at all. I drives assert(A) assert(B) on
    two elements that compose the IDENTICAL locator and requires two different resolved
    indices. J mutates the association - swap the captured element, remove the capture,
    drop the captureRef, restamp a press as a pick - and every one turns it red.
  mutation_tested_in_production: >
    Reverting the idempotent allocator turns 8 checks red; preferring node identity over
    the assertion's own capture turns 11 red; removing the captureTiming exclusion from
    evidenceFor turns 1 red. Verified, then restored.
  on_disk_today: >
    TC_LOGIN_107's recording predates the capture, so it carries no captureRef and
    generation from it still emits expect(page.locator(".bugChecked")).not.toBeChecked()
    for the first assertion. Confirmed after the change, so the fix is backward
    compatible and changes no existing recording's outcome.
  NOT_production_proven: >
    The end-to-end chain recording -> pick capture -> evidence -> locator -> live run has
    NOT been exercised, because no recording carries a pick capture yet. Offline the
    mechanism is proven through the real recorder; live it is unexercised.
  validated:
    offline: >
      105 checks. The GENERATED hook run against a stub DOM (identity, look-alike,
      double registration, other document, released slot); the recorder's own sequence
      through the real exported functions; the sidecar round trip with six malformed
      provenance records refused and a null count accepted; the ten required decision
      cases; and TC_DASHBOARD_023 replayed through the real parser, evidence and
      mapRecording.
    live: >
      The assembled spec ran against my.bugasura.io. Clean run PASSED in 32.0s -
      expect(...locator(".bugChecked").nth(2)).toBeChecked() resolved to exactly one
      element, no strict-mode violation. Mutated run (.not.toBeChecked) FAILED, so the
      assertion is falsifiable rather than vacuously green. staticCheck reported 0
      problems, positionalIdentity included: it re-derives the proven set from
      TC_DASHBOARD_023's own evidence and both .nth(2) expressions are in it.
    spec_not_kept: >
      That spec was assembled with a REPLAYED association and has been deleted. Leaving
      it would imply the pipeline produced it from the recording on disk, which it does
      not and cannot. Nothing was written into tests-e2e/, mapping.json, state.json or
      the workbook.

regression_claim_corrected:
  when: 2026-08-20
  what: >
    The status_version 2 block claimed 43 fixtures / 2393 checks / 0 failures. Verified
    rather than trusted, per the handoff rule, and FIVE fixtures were red before any
    change in this session. None was caused by this work; each is recorded here with
    what was actually stale.
  failures_found_and_fixed:
    - where: ai/autocode/exploration-auth.fixture.ts
      why: >
        It hashes every entry of ai/dashboard/recordings/ with readFileSync.
        recordings/accepted/ is a DIRECTORY - created by the evidence-retention phase -
        so the read threw EISDIR and took the whole fixture down. Now filters to files.
    - where: ai/autocode/locator-quality.fixture.ts (check P)
      why: >
        It read candidates[0].penalties for getByText('Faclon labs').first(). The
        strict-mode gate refuses an unmeasured unscoped text locator and returns no
        candidates, so the check threw. Replaced by the stronger statement - refused,
        nothing emitted, no first() - plus the same penalty invariant asserted on a
        SCOPED chain, which does reach the scorer.
    - where: ai/autocode/locator-quality.fixture.ts (U2, Z)
      why: >
        Both asserted exactly ONE needs-review step. Those recordings carry no DOM
        evidence and also contain an unmeasured bare-text locator, which the strict-mode
        gate now refuses too - two refusals, both correct. Both are named individually
        rather than counted loosely, so a third would still fail.
    - where: ai/autocode/toggle-normalisation.fixture.ts
      why: >
        Its positional scan had two branches, proven-unique or refuse, and the corpus
        grew a third answer: TC_DASHBOARD_024, TC_LOGIN_104 and TC_LOGIN_105 (recorded
        15:50-15:58 on 2026-08-20) carry positionProvenCandidates with no proven-unique
        candidate, so evidence-backed positional recovery legitimately fires. The third
        branch is now asserted to take exactly that route with a .nth(index); "no proof
        at all" is still required to be refused.
    - where: ai/dashboard/recorder.fixture.ts
      why: >
        It required three expect( in the assembled spec. All three recorded assertions
        are unscoped getByText with no evidence, so the strict-mode gate refuses them.
        Now asserts all three are accounted for as steps for a person, that each refusal
        names the missing measurement, and that NONE is emitted - a spec must not claim
        coverage it does not have.
    - where: ai/autocode/assertion-context.fixture.ts (check 15)
      why: >
        THIS ONE WAS CAUSED BY THIS SESSION. It counted two identical `nextTarget++`
        lines to prove the picker and the press share one counter. They now share one
        allocate(), so there is one. The invariant is unchanged and the check is
        stronger: exactly one allocation site, one release rule, and both callers
        asserted to go through it - a shared allocator cannot drift, which two copies
        could.

measurement_outranks_shape:
  state: DONE
  implemented: 2026-08-21
  found_by: TC_LOGIN_109, recorded by the user at 22:39 on 2026-08-20
  three_defects_one_seam: >
    All three sat between what was MEASURED and what was DECIDED, and the quarantine
    message hid all of them behind one sentence.
  defect_1_what: >
    getByRole('checkbox', name 'done') was emitted as STABLE_LOCATOR, role-name,
    confidence 0.95 - the highest this engine issues - while the browser had already
    counted it at ZERO elements. fromEvidence had a rule for a count above one and none
    for a count of zero, so it fell through to the offline scorer, which judges SHAPE.
  defect_1_corpus: >
    29 targets across the corpus carry a count of zero. ALL 29 were emitted verbatim.
    NOT ONE appears in an accepted spec. Every one would time out. So no legitimate
    workflow depended on a measured-zero candidate - the boundary question was answered
    before the rule was written, not after.
  defect_1_boundary: >
    A zero is refused only when ATTRIBUTABLE. matchCountDocument 'same' is decisive.
    'other' is NEVER refused - getByRole('button', name 'Sign In') measured 0 in four
    recordings because login had navigated, which is P0.7 and stands. 'unknown' or absent
    is refused only when the recorder also failed to find the element there
    (target.tag === '(not found)'), which is two independent failures to locate it with no
    captured graph against them. An UNMEASURED locator is never touched.
  defect_1_effect: >
    6 replaced by a press-time proven candidate they already carried (TC_LOGIN_071 Close
    and Cancel, 076/077/078 Close, 087 to #bug_new_submit), 22 refused, 1 spared
    (TC_LOGIN_063 - captured graph, unattributable count).
  defect_1_source_fix: >
    captureFor's zero branch now records matchCountDocument 'unknown'. It was the only
    count in live-recorder.ts that did not say where it was taken, which forced a decision
    rule to read the field's ABSENCE as a fact about the page.
  defect_1_locator_quality_change: >
    ONE, and required by the objective: step 0 of fromEvidence. No scoring changed, no
    threshold moved, and positional recovery is untouched - a measured zero is not rescued
    by an index either, because an index into a match list of zero is nothing.
  defect_2_what: >
    A generated spec obtains a Page Object only by destructuring the fixture named after
    the class. The reuse resolvers checked index.pages and never index.fixtures, so
    IssuesPage methods were offered, issuesPage.issueCheckbox(...) was emitted, and
    Playwright refused the whole FILE - Test has unknown parameter issuesPage, 0 tests
    collected.
  defect_2_blast_radius: >
    10 quarantines. The ten ids in ai/reports/autocode-log.md carrying "Not Collected. No
    test with this ID was collected from the spec." are EXACTLY the ten files in
    ai/autocode/quarantine/ that destructure issuesPage - TC_DASHBOARD_020,
    TC_LOGIN_089/090/091/092/094/104/109/110/111. Identical sets.
  defect_2_resolver_fix: >
    methodIsDeliverable(index, pageObject, method) - the method must exist AND
    index.fixtures must contain fixtureFor(pageObject). Six call sites routed through it
    (entryPointOf, findMethod's exists and indexed, findMethodByProvenLocator,
    findParameterisedMethod, openerFor, the sign-in step). Both halves come from the index
    that was already being consulted; nothing new is read and nothing is guessed.
  defect_2_fixture_added: >
    issuesPage IS declared now, and the evidence that it was an OVERSIGHT is conclusive.
    FRAMEWORK-GUIDE.md's own five-step procedure for adding a Page Object ends "Register a
    fixture in tests-e2e/fixtures.ts" and step 5 had been skipped. TermsPage's header
    states its omission is deliberate and says why (built over a popup Page that does not
    exist until a test clicks the link) while IssuesPage's says nothing. NotificationsPanel
    got a fixture AND a pinned check when it was added. And an accepted spec,
    login-test-cases.spec.ts, already constructs IssuesPage BY HAND with
    new IssuesPage(page, healing).
  defect_2_both_are_needed: >
    Not alternatives. Without the gate a future Page Object repeats the failure; without
    the fixture the abstraction engine's two measured methods become dead code and the
    seven declared elements in bugasura__issues-id.yaml become unusable. Base and TermsPage
    stay fixture-less on purpose, which keeps the gate's test subjects alive.
  defect_3_what: >
    "Not Collected. No test with this ID was collected from the spec." covered an unknown
    fixture, a file that does not compile, and a --grep that matched nothing. Playwright
    had already said which, in a structured errors[] entry in the JSON report runOne was
    already opening, and spawnSync's stdout and stderr were discarded entirely.
  defect_3_added: >
    FailurePhase (collection or execution) and FailureCode (UNKNOWN_FIXTURE,
    NO_MATCHING_TEST, COMPILE_ERROR, COLLECTION_ERROR, STRICT_MODE_FAILURE,
    ASSERTION_FAILURE, TIMEOUT, RUNTIME_FAILURE), plus playwrightMessage, location, fixture
    and collected on RunOutcome and GateResult.detail. Playwright's sentence is preserved
    verbatim, never paraphrased.
  defect_3_classified_from_structure: >
    From report.errors[0] message, location and snippet, not from scraped console text - a
    rendering changes with the reporter and the terminal. Verified against a real run: a
    collection failure writes suites [] with errors [1] and stats, so the report EXISTS and
    runOne's existsSync check passes, which is why it reached the wrong branch.
  defect_3_order_is_load_bearing: >
    A strict-mode violation is delivered through a locator call that also times out, so
    strict mode is matched before timeout, and assertion before runtime. A timeout-first
    classifier would hide the failure this project cares most about.
  defect_3_two_downstream_readers_fixed: >
    excel:verify routed Not Collected to SUSPECT - its only finding and its only non-zero
    exit, meaning "passed with every assertion broken" - said of a spec that never ran. Now
    red. And classifyRecordedFailure returned RECORDED_CLEAN_RUN_FAILURE ("built
    faithfully, ran, and did not pass") for the same thing; RECORDED_COLLECTION_FAILURE now
    exists. Metrics SCHEMA 10 to 11, so a schema-10 record reading CLEAN_RUN_FAILURE may be
    either and is not evidence about a locator.
  defect_3_not_replaced: >
    The prose ROOT_CAUSES table in ai/excel/results.ts stays. It explains an execution
    failure to whoever reads the workbook; these are codes for a machine and a heading.
  investigated_contextual_precision: >
    A strictly better candidate DOES exist in captured evidence - data-issue-id on the row,
    present, free of generated identifiers per analyseIdentifier, expressible as pure CSS,
    and measurable by both existing engines today. candidateSelectorsFor never builds it:
    data-* is read from the TARGET only (one line, two fixed test-id keys) and never from an
    ancestor. NOT retrofitted to TC_LOGIN_109 - the candidate was never measured in that
    document and the document is gone, so the positional fallback is retained rather than a
    selector invented. Building that family is a real improvement for FUTURE recordings and
    is separate, unstarted work.
  investigated_page_object_asymmetry_is_correct: >
    1749558's row text is unique as a SUBSTRING, so its container-text candidate measured 1
    with identityMatched true and landed in derivedCandidates, which is what
    provenCandidate() reads - so parameterised reuse resolved. 1749553 and 1749552 have text
    that is a substring of it, so the identically-worded candidate measured 3, landed in
    positionProvenCandidates, and reuse correctly declined. PRESERVED: this is the
    difference between an abstraction that describes the element and one that resembles it.
  investigated_toggle_collapse_not_extended: >
    collapseAssociatedToggles collapsed only 1 of TC_LOGIN_109's 4 click-plus-state pairs.
    It requires the CLICK half to be a span inside a label beside a checkable control; pairs
    where the click is on the input itself fail on "no toggleable sibling", and pairs where
    the click is the (not found) getByRole fail on "the click has no captured element".
    Extending it would make TC_LOGIN_109 fully automatable. NOT DONE - it is a fourth
    change, outside the three confirmed defects, and it needs its own evidence before it
    touches what actions reach a spec.
  surfaced_mutator_double_negation: >
    NEWLY SURFACED, NOT FIXED. mutate() turns .toBeChecked() into .not.toBeChecked() by
    substitution, so a spec that ALREADY contains .not.toBeChecked() becomes
    .not.not.toBeChecked() and the mutated run fails with a TypeError rather than an
    assertion mismatch. The gate's verdict is still correct - it demands only that the
    mutated run fail - but the proof is weaker than intended. Observed live on
    TC_DASHBOARD_020. Out of scope here; reported.
  fixture_locator_validation: "ai/autocode/locator-validation.fixture.ts, 101 checks: A measured-zero, B measured-ambiguous, D unknown fixture, E quarantine classification, F the safety architecture"
  fixture_component_case_c: "ai/autocode/assertion-provenance.fixture.ts part K: one checkbox component through click, check, uncheck and both assertion polarities, twice over"
  live_what_was_proven: >
    TC_DASHBOARD_020 and TC_LOGIN_092 - both previously quarantined as Not Collected, both
    reusing IssuesPage - were regenerated, statically gated (0 problems), COLLECTED (2 tests
    in 2 files, where the same command previously listed 0) and EXECUTED against live
    my.bugasura.io. TC_DASHBOARD_020 passed in 19.5s, TC_LOGIN_092 in 29.9s.
    TC_DASHBOARD_020's mutated run FAILED, so it is not vacuously green - though the failure
    was the TypeError described under surfaced_mutator_double_negation rather than an
    assertion mismatch.
  closed_after_a_cross_check_critique:
    model_path_was_unguarded: >
      methodIsDeliverable covers the DETERMINISTIC recorded mapper only. A spec the MODEL
      wrote goes straight to gate() and nothing validated its destructure list, so the
      same failure could arrive by the other route. staticCheck now refuses a spec naming
      a fixture the framework does not declare - offline, no browser, one read of an index
      rebuilt every run. Verified: fires on a synthetic ghostPage, and refuses 0 of the 43
      specs the suite actually has.
    classification_was_discarded_at_the_boundary: >
      orchestrate never read detail.code, and classifyRecordedFailure branched on the
      STATUS STRING - so the four collection codes collapsed back into one class the
      moment they reached the record, and the distinction survived only as a substring in
      a sentence. orchestrate now passes cleanCode, and the record branches on it:
      RECORDED_UNKNOWN_FIXTURE and RECORDED_ENVIRONMENT_FAILURE are new classes, and a
      record written before codes existed still classifies.
    no_matching_test_was_unreachable: >
      Playwright throws "No tests found." into errors[] when a positional file argument
      matches nothing, so firstError fired and the code came back COLLECTION_ERROR. A
      pattern for it makes the documented code reachable.
    global_setup_faults_were_misread_as_spec_defects: >
      Run mode orders globalSetup BEFORE the load task, so a locked workbook or an
      unreadable data-driven contract lands in errors[] before a single spec is read - and
      "Cannot find module" from global-setup.ts matches the compile pattern exactly. The
      spec would then be quarantined and retracted for an environment fault.
      classifyCollectionError now compares the error's own location against the spec under
      test and returns GLOBAL_SETUP_FAILURE when they differ. Structured data, not a guess.
    index_fixtures_null_guard: >
      methodIsDeliverable and deliverableMethod now read (index.fixtures ?? []) and FAIL
      CLOSED. A hand-built index with no fixture list crashed proven-locator-reuse.fixture;
      defaulting the other way would have turned the gate off for any partial index.
  reported_not_fixed:
    gate_destroys_traceability_directories: >
      Every gate() invocation runs globalSetup twice (clean and mutated), and
      tests-e2e/support/global-setup.ts unconditionally rmSync's HEALING_DIR, STEPS_DIR
      and test-results-excel/allure-results. runOne overrides only EXCEL_STEPS_DIR, so
      ai/reports/healing and the allure results are destroyed by every verification run.
      Both paths are hardcoded (resilient-locator.ts and global-setup.ts) with no env
      override. PRE-EXISTING, and it breaks CLAUDE.md's own "each run keeps its own copy"
      invariant. The fix mirrors EXCEL_STEPS_DIR - add EXCEL_HEALING_DIR and an allure
      override - and is outside these three defects.
    double_await_on_page_object_locators: >
      Six of seven IssuesPage methods return a bare Locator, and the emitter writes
      `await (await issuesPage.issueCheckbox(...)).click()`. Harmless (awaiting a
      non-promise yields it) but noisy, and it is emitted right now in TC_DASHBOARD_020
      and TC_LOGIN_092.
    pipeline_bottleneck_is_elsewhere: >
      Measured over all 64 recordings: 21 map clean, 2 are blocked SOLELY by measured-zero
      (TC_LOGIN_104 and TC_LOGIN_109), 7 are mixed, 34 are blocked by something else. The
      needsReview histogram is 29 unmeasured-bare-text, 28 positional-with-nothing-proven,
      14 measured-zero, 5 ambiguous, ~19 generated-id. So measured-zero is a small share
      and the two dominant causes are untouched work.
  live_what_was_NOT_proven: >
    TC_LOGIN_109 itself is NOT collected and NOT executed, and that is the correct outcome
    rather than a shortfall. Three of its recorded actions are the refused
    getByRole('checkbox', name 'done'), so mapRecording returns needsReview=3,
    generateFromRecording blocks at that check BEFORE assembleSpec, and orchestrate SKIPS
    the case - no spec, no state entry, no gate run. The recording genuinely contains three
    actions whose target the evidence cannot identify. Re-recording will not help either:
    the accessible name is pseudo-element content that ELEMENT_CAPTURE structurally cannot
    see. Only the toggle-collapse extension above would make that recording automatable.

next_required_action: >
  RE-RECORD TC_LOGIN_107 (user action - Claude cannot record). One recording closes both
  open items: it is the assert / click / assert sequence, so it exercises the pick
  capture, the shared elementRef, the two captureRefs and the positional recovery for an
  assertion made before any interaction - and it is the same screen and the same
  checkbox family as TC_DASHBOARD_023, so it also retires that one's replay caveat.
  Nothing in the pipeline is waiting on code. Expect the first assertion to become
  expect(<scoped .bugChecked>.nth(N)).not.toBeChecked() with N measured at the pick, and
  the second to keep the locator it already has. Until that recording exists and runs
  green clean and red mutated, the chain is offline-proven only and MUST NOT be called
  production-proven. Also still open and independent: re-record TC_DASHBOARD_010, which
  currently clicks page.locator('.rounded-checkbox-ui').first() and would retire one of
  the 5 positional-identity calls in the Automated suite. Then decide
  blockers.legacy_22, blockers.page_object_direct_locators and
  blockers.accepted_specs_with_positional_identity.
```

<!-- ===================================================================== -->
<!-- Narrative history below. Older sections describe earlier phases and    -->
<!-- are kept for context; the YAML above is authoritative for STATE.       -->
<!-- ===================================================================== -->


## Completed work

**Recorded-test pipeline correction (this session).** The recorded path is now
recording-first: the human recording is treated as primary evidence, reassembled faithfully,
and never handed to a model to re-derive.

1. **Recorded order preserved.** `RecordedAssertion.afterActions` is set in `parseRecording`
   and re-based after `collapseRepeatedFills`; `mapRecording` puts each assertion back where
   it was made instead of appending them all last. Assertions with no position keep the old
   append-last behaviour and set `orderReconstructed: false` — never guessed.
2. **Artifact retained until a verdict exists.** `generateFromRecording` no longer discards it;
   `acceptRecording()` does, and only on `accepted`. Every other outcome keeps the recording.
3. **No assertion never reaches a model.** `surveyWork` stops a row whose Expected Result is
   still the `Needs confirmation` placeholder; the recorded branch stops again if the artifact
   asserts nothing. No spec, no quarantine, no state entry, no new status.
4. **Page Object Required.** Raw Codegen locators are named (`recorded.pageObjectRequired`) and
   reported in the log, and are no longer counted as reuse. The gate is unchanged — such a spec
   still has to run and still has to fail when mutated.
5. **`RECORDED_*` failure classes** in `classifyRecordedFailure`, separating "we reassembled it
   wrongly" from "the application refused it". Metrics schema 6 → 7.
6. **Direct CLI runnability** (`ai/excel/cli.ts`) now requires the spec to exist, matching the
   dashboard. A stale entry is skipped by name with the `excel:mapping sync` hint instead of
   producing `No tests found` for the whole run.

Retained from the previous session, all still green: per-recorded-case spec files, stale
`accepted` state returning to work, dashboard runnability.

7. **Obsolete shared-spec mappings cleaned** (scoped, approved). The 8 entries pointing at the
   deleted `tests-e2e/generated/login-test-cases.spec.ts` were removed from `mapping.json` by an
   exact two-condition rule — `testFile` equal to that path **and** the file absent — never by
   ID. `excel:mapping sync` was deliberately **not** used: it would also have dropped
   TC_LOGIN_018, whose spec exists. Mapping 34 → 26 entries; every survivor byte-identical;
   Excel, `state.json` and all protected code unchanged; no AI call and no browser.

8. **Locator quality engine** (`ai/autocode/locator-quality.ts`). Every recorded locator is now
   scored, classified and explained before assembly. Only `invalid` blocks — a generated id or an
   absolute XPath — and blocking costs no gate run. `weak`/`suspicious` are reported and still
   emitted, because the gate is the only thing that can settle them. Nothing writes a Page Object
   method: `assessNewPageObject` reports what it cannot prove instead. Metrics schema 7 → 8;
   `RECORDED_LOCATOR_NEEDS_REVIEW` added. 70 offline checks in
   `ai/autocode/locator-quality.fixture.ts`, 0 AI calls, 0 browsers.

9. **Multi-strategy locator resolution (Phase 7).** The engine now generates candidates from the
   whole recording rather than one chain: a dynamic scope is dropped for a descendant the
   recording proves is inside it (`NORMALIZED_LOCATOR`, classified weak), ancestor/descendant
   axes are generated from recorded containment and rejected *with reasons* when they would need
   a prefix match or a position, and an assertion is never resolved to its own expected text.
   Measured effect: TC_LOGIN_036 went from 2 needs-review locators to 1 — its click resolved,
   its assertion did not. 87 offline checks, 0 AI, 0 browsers.

10. **DOM evidence contract (Phase 8, partial).** `ai/autocode/dom-evidence.ts` defines the
    bounded relationship graph the next phase will consume — target/parent/ancestors/children/
    descendants/siblings, relationships, `matchCount` (measured or null, never inferred), the
    preserved Codegen locator and the dynamic-id record — with every bound in one place and a
    redaction funnel nothing can opt out of. `Recording.evidence` now always says whether
    evidence exists, and every existing recording reports `available: false` with a reason.
    50 offline checks. **The capture itself is NOT implemented — see blockers.**

10B. **Live DOM evidence (Phase 8C) — implemented, awaiting human acceptance.** A second
    recording transport (`ai/dashboard/live-recorder.ts`) runs Playwright's own recorder in a
    browser this process owns, so a locator's surroundings can be measured while it is
    recorded. Guarded on `typeof context._enableRecorder === 'function'` and behind
    `RECORDER_TRANSPORT=live`; **codegen remains the default and the fallback**. The resolver
    now promotes a generated id only to a candidate the browser counted at exactly one element,
    refuses a measured ambiguity outright, and retargets an assertion whose expected text lives
    on the parent (TC_LOGIN_036). 30 new offline checks. NOT complete until a human records.

10C. **Evidence sidecar (TC_LOGIN_040 fix).** The evidence captured during a live recording now
    survives Save: `keepArtifactFor` writes `<TC_ID>.evidence.json` beside the `.spec.ts` when
    `evidence.available`, and `generateFromRecording` loads it back through `readEvidence()`.
    Missing, malformed or wrong-shaped sidecars degrade to `evidenceUnavailable(reason)` and the
    pre-existing Phase 7 behaviour. Both files share one lifecycle keyed by Test Case ID, so a
    stale graph cannot be paired with a later recording. `locatorKey()` gives both producers one
    normalisation, so a Codegen chain wrapped across lines still finds its evidence.
    46 new offline checks in `ai/autocode/evidence-sidecar.fixture.ts`.

11. **Evidence timing (Phase 9A).** A passive `pointerdown`/`focusin` hook installed via
    `context.addInitScript` captures the graph BEFORE the interaction takes effect and parks it
    on the page; the recorder claims it by the element's own identity when the action line
    appears. `captureTiming` records which timing produced each graph. `scrollable` is measured
    (overflow + real overflow); `virtualized` requires the application to declare itself
    (`aria-rowcount`/`aria-setsize` above rendered rows, or an attribute named `*virtual*`) - a
    scrollbar alone is explicitly not enough. Additive telemetry. 47 new offline checks.
    **Phase 9B (the recovery ladder) is NOT started.**

12. **P0: the action branch uses the resolver's locator** (`from-recording.ts`). It emitted
    `action.locator` while the assertion branch already used `quality.expression`, so a locator
    the engine had rejected went into the spec anyway - the cause of the TC_LOGIN_041/042/043
    quarantines. Page Object reuse still wins (that branch returns first); the recorded locator
    is still the fallback when the resolver has nothing better. 26 offline checks in
    `ai/autocode/action-locator.fixture.ts`. Verified in real generation: no `#tc_summary_*`
    is emitted any more. **The three cases still quarantine, on a different failure** - see
    remaining work.

13. **P0.1: a dynamic scope is dropped only when uniqueness is MEASURED.** The Phase 7
    scope-drop was unsafe and P0 shipped it into actions: dropping `#tc_summary_638717` left
    `getByText('Line Chart | Time Config Page')`, which Bugasura renders twice (mobile
    `visible-xs` / desktop `hidden-xs`), so the click could never resolve. Offline the answer is
    now NEEDS_REVIEW naming the live transport; with evidence, only a candidate measured at
    exactly one element may be promoted. `candidateSelectorsFor()` derives candidates from the
    graph - stable ancestor ids, the element's classes and, decisively, the PARENT's classes -
    and the capture counts each one. 30 checks in `action-locator.fixture.ts`.

14. **P0.3: the live recorder asks for `playwright-test`, not `javascript`.** The library target
    cannot run assertions, so Playwright's recorder emitted them COMMENTED OUT; the parser reads
    only `await ` lines, so every recorded assertion vanished, the Expected Result became the
    `Needs confirmation` placeholder and the row was skipped before generation. That is what lost
    TC_LOGIN_053 and TC_LOGIN_054 - their assertions are in the artifacts behind `// await
    expect(...)`. The parser was NOT taught to read comments. The evidence sidecar now also
    carries `recording: { transport, targetCount, failures, beforeActionCount, afterActionCount,
    evidenceBytes }`, and a live capture that finds nothing now says so distinctly. 24 checks in
    `ai/autocode/recorder-language.fixture.ts`.

15. **P0.2 (final): the save actually writes the sidecar.** The original P0.2 patch never
    landed - a Python `str.replace()` silently matched nothing, and the fixture of the day
    created the `.evidence.json` itself, so 46 green checks ran against a file the test had
    written. TC_LOGIN_053/054/055 were all saved with no sidecar. The write now lives in
    `persistRecording()` (called by `keepArtifactFor`), extracted so a test can drive the real
    production path without a browser. `ai/autocode/evidence-persistence.fixture.ts` (40 checks)
    exercises it and was **mutation-tested**: removing the write turns it red.

16. **P0.7: an ambiguous recorded action is settled by the element the person CLICKED.**
    Two independent defects, both of which made evidence look authoritative while describing
    something else.

    *Where.* `matchCount` was taken when Codegen's line appeared - ~400 ms after the action, in
    whatever document was showing by then. `getByRole('button', { name: 'Sign In' })` measured
    **0** in all four live recordings (login had navigated), and TC_LOGIN_063's
    `getByText('Faclon labs')` measured **2** on the page its click arrived at. Every press now
    carries a per-document nonce; a count from any other document is `null` +
    `matchCountDocument: 'other'`, never a number.

    *Which element.* Candidates were only ever counted. TC_LOGIN_060 has four candidates measured
    at exactly one element each - all on the post-click page. The pressed node is now parked
    (`window.__auraTargets`) and every candidate is checked by identity (`nodes[0] === element`)
    in ONE batched `page.evaluate`, fired from the `__auraPark` binding at pointerdown.
    `isProvenAgainstClickedTarget` states the bar once: press-time, same document, exactly one
    element, and that element is the one acted on.

    *What it unlocks.* `pressTimeText` records what the pressed element's own text identified
    page-wide, at the press - the only way a navigating click's ambiguity is knowable, since the
    offline scorer rates a bare `getByText` at 75 (above a stable id) and cannot see the problem.
    A proven candidate then resolves it as `disambiguated-by-clicked-target`; nothing proven means
    the same refusal, in the same words, plus what was actually tried.

    *Diagnostics.* `rejectedCandidates` (bounded 12, each with a reason) and `candidatesTried`
    survive the funnel, so "twelve were measured and every one was refused" stops reading as
    "none of the 0 alternative(s)". Metrics schema 8 -> 9.

    64 new offline checks (`ai/autocode/clicked-target.fixture.ts`), which run the **generated**
    hook against a stub DOM rather than reading it; 644 checks green across all 15 fixtures;
    0 AI calls, 0 browsers. Protected files verified byte-identical by hash.

17. **P0.8: /apps is clickable before it is functional.** TC_LOGIN_064's diagnostic proved the
    failure was never a locator: Bugasura streams the project cards into /apps while the document
    parses, and binds their click handler later, in its own ready block. A click in that gap
    passes every actionability check, is reported as successful and does nothing - the browser
    stays on /apps and every later step hunts for elements on a page that never opened. Measured:
    6 failures in 9 verbatim runs, all clicking at 1144-1604ms; every click at 2125ms+ worked; the
    same element clicked again 5s later navigates every time.

    Two changes. `ProjectsPage.open()` now waits for `load` and then for
    `#all_apps [data-original-title]` - the tooltip initialisation the application performs in the
    same ready block that binds the click, measured flipping in the same 100ms sample, and the
    only DOM-visible witness this screen offers. Bounded at 15s and degrading to today's behaviour
    if it never appears. `ProjectsPage.openProject(name)` was added for hand-written use: the
    recorded locator shape (`getByText(name)`), plus readiness before and an arrival check after.

    And in the assembler, `landingAfterSignIn` emits the landing screen's declared entry point for
    a **raw** recorded action too, not only for one that matched a Page Object method. That
    asymmetry was the whole defect: `signIn()` was followed immediately by the recorded card click
    with nothing in between. The generated flow is now `loginPage.open()` -> `loginPage.signIn()`
    -> `projectsPage.open()` -> the recorded click, verbatim.

    `LoginPage.signIn()` was deliberately NOT touched (11 callers, 3 of them negative-login cases
    where no redirect ever comes). 51 new offline checks in `ai/autocode/apps-readiness.fixture.ts`;
    749 checks green across all 16 fixtures. TC_LOGIN_044, 045 and 064 regenerated and **accepted**
    by the unchanged gate.

18. **P0.11: a spent attempt budget no longer outlives the defect it was protecting against.**
    `MAX_ATTEMPTS` was keyed to the workbook row alone, so TC_LOGIN_041/042/043 - which spent
    their attempts on the click P0.8 later fixed - stayed skipped afterwards, told to "edit the
    row to try again" when nothing about the row was wrong. `frameworkFingerprint()` hashes what
    decides a spec's content (`from-recording.ts`, `locator-quality.ts`, `dom-evidence.ts`,
    `context.ts`, every Page Object, and the metrics `SCHEMA`), `budgetExhausted()` requires BOTH
    the row and the framework to be unchanged before it blocks, and `nextState` records the
    fingerprint so the protection resumes immediately. Entries written before P0.11 carry none,
    which reopens them once - the whole migration. Verified end to end: the same dry run that
    reported "0 need code, 3 skipped" now reports **3 need code, 0 skipped**, and wrote nothing.
    38 new offline checks in `ai/autocode/attempt-budget.fixture.ts`; 787 green across 17
    fixtures.

19. **P0.9: the test's sign-in and the exploration browser's sign-in are different questions.**
    `groups.ts` had one boolean, `authRequired`, answering both. A manually authored plain-English
    row (TC_LOGIN_066: "Sign in → open Faclon labs → search fac11 → select New → verify the issue")
    was therefore handed an anonymous browser, could not reach `/apps`, and the generator declined
    it — correctly, since it will not invent selectors for a screen it cannot see.

    `authRequirement()` now returns `{ testStartsSignedIn, explorationNeedsAuth }` with a reason
    for each. The exploration answer is structural and measured over all 76 rows: a signed-in
    precondition says yes; otherwise the last step that *performs* a sign-in (not one that merely
    names the sign-in page — the language-picker rows act on that page and must stay anonymous)
    opens a window, and any later step that ACTS means the row works on a screen behind the
    sign-in. Verb classification is reused from `ai/knowledge/requirements.ts`, not re-listed.
    `GroupSession` gates on `explorationNeedsAuth`; `context.ts` and `independence.ts` keep using
    `testStartsSignedIn`, so knowledge selection and the spec's own sign-in are unchanged.

    Exploration credentials are their own profile (`explorationCredentials`,
    `BUGASURA_EXPLORATION_PROFILE` / `BUGASURA_EXPLORATION_USER`, falling back to the suite's), and
    only the framework ever reads them: group keys, logs and metrics carry the VARIABLE NAME. 97
    new offline checks in `ai/autocode/exploration-auth.fixture.ts`, twelve of which scan every
    written surface for the real password and none of which ever prints one. 884 checks green
    across 18 fixtures. The recorder, its evidence and recorded test data are untouched.

20. **P1: the enterprise authoring model.** Seven optional canonical fields (Requirement ID,
    Test Type, Business Risk, Environment, User Role, Authentication Profile, Test Owner), plus
    Description and Preconditions finally authorable — both were parsed and consumed since the
    beginning, and neither had an input, which is why every hand-written row had no preconditions
    and the framework had to infer a signed-in start from step prose.

    Additive by construction: an old workbook has none of the columns, reads them as empty and
    behaves identically (verified on the real file: 76 rows, 0 errors, no new column). Two
    headings changed meaning on purpose - `Type` was being read as a tag and `Criticality` as
    priority - and a workbook using either is warned once per sheet rather than silently
    reinterpreted.

    `ai/excel/readiness.ts` answers authoring completeness and nothing else; `ai/dashboard/
    case-status.ts` compares a recording against the row it was saved for and marks it stale
    without ever touching `.spec.ts` or `.evidence.json`. The generator now receives description,
    requirement, test type, risk, tags, environment, user role, owner and the authentication
    profile **as a name**. 152 offline checks in `ai/excel/authoring-model.fixture.ts`; 1037 green
    across 19 fixtures.

## Current task

None in flight. **P0.7 still awaits its acceptance recording**; P0.8 is complete for the cases
that could be gated - see below.

## Remaining work

- **The per-step model (`Step Details`) was deliberately NOT built.** Steps, Test Data and
  Expected Result stay the single authoritative representation; a parallel structured column
  would have been a second copy of the same data, free to drift. Per-step expected results
  remain an open design question, not an accident.
- **Row-level Environment and Authentication Profile are stored, validated and shown to the
  generator, but not yet wired to anything.** The base URL is still `BUGASURA_BASE_URL` and the
  exploration account is still chosen per run, not per row. Wiring them would change P0.9's
  session credential selection and needs its own approval.

- **TC_LOGIN_041 / 042 / 043 are NOT fixed by P0.8, and are blocked twice over.** The readiness
  step does reach them - `mapRecording` now emits `projectsPage.open()` before their recorded card
  click, verified offline. But their summary-row click is `#tc_summary_638717`, a generated id, and
  their recordings carry **no live evidence sidecar** (they predate the live transport), so the
  resolver refuses it as NEEDS_REVIEW and the case never reaches a spec. On top of that the
  orchestrator skips them at `MAX_ATTEMPTS` ("quarantined after 2 attempt(s) and unchanged since").
  The fix for both is one action: **re-record them with `RECORDER_TRANSPORT=live`**, which is what
  turned TC_LOGIN_064 from the same shape into an accepted case.

- **TC_LOGIN_036 and TC_LOGIN_037 are explicitly NOT claimed as fixed by P0.8**, unchanged from
  the earlier decision: 036 is blocked by `#tc_summary_636432` plus a circular `getByRole('strong')`
  assertion, 037 by the same generated id. Both need re-recording, not a readiness fix.

- **TC_LOGIN_063 must be RE-RECORDED through `RECORDER_TRANSPORT=live` before P0.7 can be
  called done on a real case, and nothing in it was edited by hand.** Its existing sidecar was
  written before press-time measurement existed, so it carries no `pressTimeText`, no
  `documentId` and no identity answers - and the refused candidates it once measured were
  discarded at the funnel. Re-checked against the current code, the old file behaves exactly as
  it did: the Faclon click stays NEEDS_REVIEW, and `#tc_summary_637609` / `#tc_summary_637446`
  still resolve to the same measured alternatives. **Nothing can be retro-resolved from it** -
  a resolution from that file would be a guess, which is the thing this phase removes.

  On the new recording, expect: the Faclon click either resolves as
  `disambiguated-by-clicked-target` (if a candidate is proven against the clicked span) or stays
  NEEDS_REVIEW naming what was measured; the two `tc_summary_*` targets unchanged; and
  `getByRole('button', { name: 'Sign In' })` reporting `matchCount: null` with
  `matchCountDocument: 'other'` instead of a false 0.

- **Phase 9B (the recovery ladder) is still NOT started**, deliberately and unchanged by P0.7.

- **041/042/043 now fail at `getByText('<row text>')`, not at the dynamic id.** After
  `click Faclon labs` the row text is not found within 15 s. 044 (`#issues_banner`) and 045
  (`#issue_stats_section`) fail the same way at the same point in the flow, so the common
  factor is the step AFTER clicking the project, not the locator strategy. Diagnosing it needs
  a recording made with `RECORDER_TRANSPORT=live` (is the row virtualized? is the click's
  destination different? is the list slower than the timeout?) - this is the question Phase 9B
  was scoped to answer, and it should not be guessed at.

- **The 8 cleaned cases are now generation work and are deliberately NOT regenerated**
  (TC_LOGIN_020/021/022/023/025/029/030/032). Their workbook rows are intact and they will be
  regenerated through the per-case architecture only when actually needed. TC_LOGIN_021 and
  TC_LOGIN_025 are no longer blocked as "already automated" and appear as `new` work.
- **Three of them lost an `Automated` status they had earned** (021, 030, 032). That is stale
  operational data about a file that no longer exists, not a lost result; re-earning it needs a
  green run of a regenerated spec.
- **Deleting those eight rows from the workbook was considered on 2026-08-14 and decided
  against.** The rows stay authored and stay in the dashboard's 43-case list. Do not propose
  removing them again without being asked: the mapping cleanup already achieved what the
  deletion was for, since all eight read `Not Automated` and are not runnable.
- **TC_LOGIN_039 joins 036 and 037 as a locator regression.** Its `#tc_summary_638717` appears
  only in an assertion whose expected text is the element's own content, so the only stable
  evidence available would make the assertion circular. It stays in review, deliberately.
- **TC_LOGIN_036 and TC_LOGIN_037 stay quarantined and are NOT regenerated.** Both are blocked
  by the same generated id, `#tc_summary_636432`, which names one Bugasura issue rather than one
  element. To automate either, re-record asserting something true of any row (the list heading,
  a count, the project name), or give the summary element a Page Object method by hand. 036 also
  asserts "Welcome to Bugasura" through `getByRole('strong')`, whose own text is "Bugasura" —
  flagged suspicious, never rewritten.
- **Re-record TC_LOGIN_031 and TC_LOGIN_033.** Their quarantines are now understood as
  `RECORDED_ASSEMBLY_ERROR` — assertions were moved out of position by the old assembler. The
  fix is in, but their artifacts were deleted under the old lifecycle, so the evidence is gone
  and only a new recording can prove the fix on a real case.
- **TC_LOGIN_034 and TC_LOGIN_035 are genuine.** 034 recorded a one-time onboarding tour
  (`Next`, `Don't show this again`) that cannot replay on an account that has seen it; 035
  needs a working `createNewTeamOption` strategy on `ProjectsPage`.
- **TC_LOGIN_027 / TC_LOGIN_028 need their author**, not a generator: confirm the Expected
  Result on the row or re-record with the check in it.
- **Safe deterministic Page Object creation** is the next phase proper. `pageObjectRequired`
  is the input it needs and is now produced; nothing creates methods yet, by design.

## Blockers (continued)

**Phase 8C is at its human acceptance gate.** Nothing further should be built on the live
transport until somebody records through it and confirms the recorder UI, picker, assert
toolbar, action/fill/assertion capture and save all behave.

## Blockers

**Phase 8 capture needs an architectural decision.** `playwright codegen` runs as a child
process (`recorder.ts:262`); we hold a `ChildProcess` and an output file, never a `page`. The
CLI exposes no debugging port and no DOM hook (checked against `codegen --help`: `--output`,
`--save-har`, `--save-storage`, `--load-storage`, `--test-id-attribute`). So capturing a DOM
graph means either **(A)** driving the browser ourselves with `chromium.launch()` and an init
script, replacing Playwright's recorder UI, or **(B)** a replay pass after Stop that reopens a
browser, signs in and re-walks the recorded steps. A is large and contradicts "Playwright's own
recorder, not ours"; B costs a browser run per recording and cannot reproduce the dynamic rows
that motivated the phase. Nothing was chosen unilaterally.

## Important decisions

- **The quality gate was not touched.** `verify.ts` is byte-identical; recorded specs run
  clean-then-mutated exactly as AI-generated ones do. No recorded case has ever been rejected
  by the mutation run, so nothing was relaxed on a hypothetical.
- **No new workbook status.** `RECORDED_*` are telemetry codes. `Needs Confirmation` is the
  placeholder already on the row, reused rather than reinvented.
- **A legacy recording is not repaired, it is flagged.** Inferring where an assertion belonged
  would be guessing at the person's intent.
- **`orderReconstructed: false` outranks every other failure signal**, so a clean-run failure on
  a re-ordered spec reads as our defect, not their recording.
- **Raw locators still run.** They are evidence, not error; they are classified, not blocked.
- `ai/autocode/recorded-lifecycle.fixture.ts` is kept as a permanent regression test, following
  the `recorder.fixture.ts` / `requirements.fixture.ts` convention. TEST A is the one that must
  never go red.

## Exact next action (2026-08-24)

**Nothing is in flight.** The regression is 54 fixtures / 3,282 checks / 0 failures on the
settled tree; run it before believing that.

Three decisions are waiting, none of them work:

1. **Regenerate the accepted specs that predate this session's fixes** - TC_LOGIN_123 carries
   three `.nth()` assertions its own recording now resolves to
   `IssuesPage.issueCheckboxState(...)`, and TC_LOGIN_119 carries two. Deferred deliberately;
   nothing is wrong with them, they are simply worse than what the pipeline now produces.
2. **`CreateTeamInviteModal`** - the Create New Team dialog's container is an incidental click
   target and no component was created for it. Declaring one (knowledge + class + fixture) is a
   product decision, not a framework gap.
3. **The legacy blockers below** are unchanged: `legacy_22`, the three accepted specs with
   positional identity, and the recordings that predate press-time or pick-time capture.

TC_LOGIN_128 needs no action: its Codegen-written `h2` assertion is correctly NEEDS_REVIEW and
no spec is produced for it. See `decisions_2026_08_24` above before proposing to "fix" it.

---

### The older next action, kept for the cases it names

**Re-record TC_LOGIN_041, TC_LOGIN_042 and TC_LOGIN_043 with `RECORDER_TRANSPORT=live`** - one
recording each unblocks both their generated id and their attempt budget, exactly as it did for
TC_LOGIN_064.

Then, still open from P0.7: **re-record TC_LOGIN_063 with `RECORDER_TRANSPORT=live`** and read its new
`ai/dashboard/recordings/TC_LOGIN_063.evidence.json`: `recording.transport`, then per target
`matchCountDocument`, `pressTimeText`, and whether any `derivedCandidates` entry carries
`measuredAt: 'press'` with `identityMatched: true`. That is the only thing that can prove P0.7
on a real case; everything else about it is already pinned offline.

Nothing else is queued. The mapping is consistent — no entry names a spec that is not on disk — and
no work is in progress.

When the next phase is wanted, it is **safe deterministic Page Object creation**, and its input
(`recorded.pageObjectRequired`) is already produced by the recorded pipeline. Before that, the
cheapest useful step is to re-record TC_LOGIN_031 or TC_LOGIN_033 and confirm on a real case
that assertions now run where they were recorded — their original artifacts were destroyed by
the old discard-at-assembly lifecycle, so only a new recording can prove it.

**Do not run `excel:mapping sync` on this workbook.** It pairs runners only from
`cache.cases`, so it would delete TC_LOGIN_018 (a rejected data-driven contract whose spec
exists); without `--workbook` it would delete all nine data-driven registrations too.

## P1.2a + P1.2b — assertion picker discoverability and associated-control semantics (2026-08-16)

Done and verified. Discoverability: the pill moved to `right: 24, bottom: 120` (clear of
Bugasura's Freshchat launcher, measured 30px on the live page), the dashboard now names the
in-page **Assert** pill instead of Playwright's toolbar, and `[recorder] assertion picker ready`
is logged on a successful install. Association: `ai/dashboard/associated-control.ts` resolves the
assertion subject for checkbox/radio/switch only, by five stated DOM relationships, and the
recorded click is untouched. 1356 offline checks across 24 fixtures, 0 failures.

**The one thing left is the human acceptance recording**, exactly as specified:

1. **Restart the dashboard** — the running server loaded these modules at startup and still has
   the old ones. This is not incidental: it is what made the P1.2 diagnosis hard.
   `RECORDER_TRANSPORT=live npm run excel:dashboard`
2. Record a case, open Notifications, click the panel's **Notification settings** button
   (`[data-original-title="Notification settings"]`), click the **Assert** pill, select the
   **Enable Notifications** switch thumb.
3. Expect: the card headed `Enable Notifications…`, a note saying it resolved through the label
   inside `span.ba-switch`, state `✓ Visible ✓ Enabled ✓ ON`, and six choices — ON, OFF, Enabled,
   Disabled, Visible, Hidden.
4. Record ON or OFF, stop, save. The saved recording should carry a `checked` assertion whose
   `locator` is the checkbox (`getByLabel(...)`) and whose `interactionTarget` is
   `page.locator(".ba-switch__thumb")` — the element that was actually clicked.

Driven programmatically against the live application it already produces exactly that, and the
resulting assertion matches one element, passes, and fails when negated. What the human pass adds
is the part no harness can stand in for: that a person finds the pill and reads the card.
