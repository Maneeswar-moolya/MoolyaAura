# REMAINING

Last updated: 2026-08-24 (assertion timing, faithful reconstruction, archived-evidence gate, structural safety)

<!-- ===================================================================== -->
<!-- MACHINE-READABLE STATUS. Any session, any account: read this first.   -->
<!-- The repository is the source of truth. Verify before trusting.        -->
<!-- ===================================================================== -->

```yaml
status_version: 6
updated: 2026-08-24
verified_by: >
  offline regression (see `regression` below) + Playwright collection of the fresh
  TC_LOGIN_112 spec (2 tests in 2 files) + LIVE execution of the fresh spec against
  my.bugasura.io, passing in 24.8s + four live resolver exchanges through the real
  headless Claude Code transport
implementation: COMPLETE for future generations; see blockers for what is not
regression:
  fixtures: 54
  checks: 3282
  failures: 0
  verified_on: final settled tree, 2026-08-24
  baseline_before: >
    49 fixtures on 2026-08-21. The 2026-08-22 session opened with ONE pre-existing red
    (proven-locator-reuse: the #password_field-error duplicate) and gained a second when a
    new recording entered the corpus (abstraction: a BLOCKED write). Both are fixed; see
    `sessions_2026_08_22_24` below.
  command: "for f in $(find ai -name '*.fixture.ts' | sort); do npx tsx $f; done"
  note: >
    RUN THIS BEFORE BELIEVING ANY NUMBER HERE. The numbers in `page_object_lifecycle`
    below were measured on the settled tree at the end of that session; a corpus that
    has gained a recording since will move the corpus-derived ones.

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
