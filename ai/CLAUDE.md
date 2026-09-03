# ai/ — the AURA subsystem

This file loads when Claude works with files under `ai/`. It was split out of the root
[CLAUDE.md](../CLAUDE.md) so that the design rationale for the generation pipeline stops
costing every session the ~12,000 tokens it does not need.

The root file keeps what applies everywhere: the two-suite separation, the commands, the
commit convention, the Excel integration overview, the data-driven row contract, Selection,
CI, the silent-breakage invariants and the Bugasura facts. What follows is how `ai/dashboard`,
`ai/autocode` and `ai/knowledge` actually work, and why.

### Per-step evidence in the dashboard

The results table expands to an ordered step list per case: which step ran, how long it took,
which one failed, why, and a screenshot of the screen at that moment. The failing step's entry
is open by default, because that is what anybody opening a red result came for.

**Playwright's JSON reporter does not emit steps** — verified on 1.63.0-alpha, no `steps` key
appears anywhere in `results.json` — so `test.step` alone would have produced nothing for the
dashboard to show. Steps are recorded separately by `tests-e2e/support/steps.ts` and read back
by `ai/excel/steps.ts`, one file per test case in `ai/reports/steps/`, exactly like the healing
log and for the same reason: parallel workers would race on a shared document. `globalSetup`
clears the directory, so a step list can never be attributed to a run that did not produce it.

Screenshots follow the existing capture control rather than a new one: `EXCEL_SCREENSHOT=on`
photographs every step, `only-on-failure` (the default) photographs just the step that broke,
`off` costs nothing. Each run keeps its own copies under `runs/<id>/evidence/steps/<TC_ID>/`,
because Playwright wipes its output directory on the next run.

Step names are written the way the **workbook row** reads, not the way the code runs — "Click
Sign In", "These are on the page: My Favourites". They are not the workbook's Steps column
though, and must never be presented as it: that column does not drive execution, so numbering a
failure against it would be fiction. What the list shows is what the runner actually did.

Wrap the actions a person would recognise, not every line. Use the `step` fixture:

```ts
test('TC_X - ...', async ({ page, step }) => {
  await step('Open the Bugasura sign-in page', () => loginPage.open());
});
```

### Record Test: a second way to author a case, not a second pipeline

`ai/dashboard/recorder.ts` spawns `playwright codegen`, parses what it wrote, and produces the
**same `CaseDraft`** the Add/Edit form produces — same `/api/case`, same ID scheme, same
workbook, same generator, same gate. Deterministic and zero AI calls: codegen emits a small
regular grammar and a parser reads it. The script is an input, never the output; it is redacted,
held for the save that follows, and deleted once a spec has been assembled from it.

Two rules in the review screen are load-bearing, and both were defects for as long as the
feature existed:

- **Those notes are toggled by the `show` class, never by the `hidden` property.** The
  stylesheet has `.note { display: none }` and `.note.show { display: block }`, and **an author
  `display` rule beats the user agent's `[hidden] { display: none }`** however the property is
  set. So `class="note show" hidden` is permanently visible: the "Needs confirmation" warning
  sat on screen next to three recorded assertions, and `recAuthNote` announced "Authentication
  detected — ." for recordings containing no sign-in. Every layer underneath was correct — the
  parser found the assertions, `toDraft` set `needsConfirmation: false`, the row saved with the
  right Expected Result — which is why nothing caught it. This applies to any element in
  `index.html` whose class sets `display`; `recProblem` already had the right pattern.

- **The redaction marker belongs in Steps; the workbook token belongs in Test Data.** They are
  different strings saying different things and must never be merged: `[type=password]` means
  *a value was captured and thrown away*, and `<valid-password>` means *fetch it from the
  environment*. `parseToken` reads anything outside angle brackets as a literal, so
  `Password = [type=password]` reached `credentialProblems` as "a credential typed into the
  workbook" — and `validateDraft` problems are **thrown, not warned**, so every recorded sign-in
  was refused at save time. Collapsing the two strings would instead make the marker executable.

  The token is written when a fill is redacted **and `authentication.detected` is true**, not on
  `redacted` alone. The detector proves a sign-in form was filled in and submitted; it does not
  prove the sign-in succeeded, and it says nothing at all about a redacted field that was never
  submitted (a change-password form, a field somebody clicked into and left). Naming that
  `<valid-password>` would be a claim about a flow nothing recognised.

`testDataFrom` (recorder.ts) and `recTestDataLines` (index.html) must agree, because the steps
are editable in the review so the page rebuilds the lines rather than posting the server's —
the same deliberate mirroring as `assertionPhrase`. `npx tsx ai/dashboard/recorder.fixture.ts`
pins both, plus the visibility rule: 54 offline checks, no browser and no model, and it reads
`index.html` itself because that rule lives in HTML and CSS where no unit test reaches. It
compares against the real `.env` secret and never prints one — a failure names the surface that
leaked, not the value.

A recorded row's Expected Result is composed **only** from assertions the person recorded;
nothing is ever assembled from the actions. "They clicked Sign In, so they must have expected to
be signed in" is the invented acceptance criterion this whole toolkit exists to prevent. The
recorded email is still written into the workbook verbatim — see
[PHASE-STATUS.md](../docs/history/PHASE-STATUS.md), which carries that and the other open decisions.

**A recorded case owns its own spec file**, `tests-e2e/generated/<TC_ID>.spec.ts`
(`recordedSpecPathFor`), and the agent path keeps the shared module file from `specPathFor`.
The two write differently and only one of them may share: `from-recording.ts` assembles a
*complete* file and writes it whole, while the agent edits a module file in place and is told
its siblings must not change. On the shared path those combine badly — each recording replaced
the previous case's spec, and quarantining the newest one then found no other test in the file
and deleted it. Eight cases were lost that way, five of which nothing had ever refused, and
every one of them still read `Automated` on the dashboard while Playwright answered
`No tests found`. Per-case files also make `retractSpec`'s "it held only the quarantined case"
genuinely true rather than accidentally true.

**A record is only believed while the file it names is there.** Two places had trusted the
record over the filesystem, and a deleted spec made both of them lie: `surveyWork` skipped an
`accepted` entry whose spec was gone — silently, not even into `skipped[]`, so the row could
never regenerate and the dashboard reported "no runner covers this module" — and the dashboard
called a case runnable on `Boolean(entry.testFile)`, so it was selectable, `/api/run` accepted
it and the run produced nothing. All three now check existence: the survey turns it into ordinary
`stale` work (`accepted state is stale: spec file missing`) without rewriting the verdict or
promoting anything, `specExists` gates both of the server's runnable calculations, and
`excel:run` skips the row by name rather than handing Playwright a `--grep` that matches
nothing. `excel:mapping sync` is what reconciles a mapping entry whose spec has gone.

**The recorded order is the test.** Codegen writes actions and assertions interleaved, and
`RecordedAssertion.afterActions` (set in `parseRecording`, re-based after
`collapseRepeatedFills` shortens the stream) is what puts each one back where the person made
it. Emitting every assertion after every action — which is what `// Assertions last` did —
turns "check the modal says Create New Project, then cancel" into "cancel, then check the
modal", and the resulting failure was reported as a bad recording. It cost TC_LOGIN_031 and
TC_LOGIN_033. An assertion with **no** position is appended last, the old behaviour, and
`orderReconstructed: false` is recorded: an absent position is absent, never inferred from the
assertion's target.

**A recording is evidence, so it is kept until there is a verdict.** `discardArtifact` used to
run the moment a spec was written, so a spec the gate then refused took the recording with it,
and the retry — with nothing to assemble from — silently became an AI generation. Only
`acceptRecording()`, called on `accepted`, discards it now.

**A recording with no assertion never reaches a model.** The recorder writes the
`Needs confirmation` placeholder because it will not invent an Expected Result; asking a
generator to write a test against that placeholder asks it to invent one anyway, and it
declined both times it was asked (TC_LOGIN_028). `surveyWork` now stops such a row with
"recorded test has no assertion", and the recorded branch stops again if the artifact itself
asserts nothing. No spec, no quarantine, no state entry — confirming the row releases it.

**A raw locator is not Page Object reuse.** An element no Page Object describes still gets
Codegen's own locator (it is real evidence) and still goes through the gate unchanged, but it
is reported as **Page Object Required**, named with its locator, in the log and in
`recorded.pageObjectRequired`. Counting it as reuse is how a coverage gap stayed invisible
until the clean run failed for what looked like an unrelated reason: the quarantined recordings
carried 7–12 raw steps, the accepted ones 0–5.

**A recorded locator is judged before it is emitted** (`ai/autocode/locator-quality.ts`). Codegen
writes the locator that worked *at that moment*, which is not the same as one worth keeping.
The engine parses the recorded chain, scores each segment (Page Object 100 → role+name 95 →
label 90 → placeholder/test-id 85 → text 75 → stable id 70 → CSS 65 → relational XPath 55 →
generated id 35 → generic role 30 → raw 10, with penalties for containers, deep chains,
positional selectors and generated classes), and returns one of `REUSE_PAGE_OBJECT`,
`STABLE_LOCATOR`, `RAW_LOCATOR_LAST_RESORT`, `NORMALIZED_LOCATOR`, `SAFE_NEW_PAGE_OBJECT` or
`NEEDS_REVIEW` with its reason. Candidates come only from the recorded chain — no role, name,
test id or text is ever synthesised.

- **Only `invalid` blocks: a generated id or an absolute XPath.** `#tc_summary_636432` names one
  Bugasura issue, not one element (`separator-digits`, normalised to `tc_summary_<dynamic>` **for
  analysis only** — never emitted as `[id^="tc_summary_"]`, because a prefix match is correct only
  if it matches exactly one element and nothing offline can know that). Blocking costs nothing and
  saves the two Playwright runs the gate would have spent proving it.
- **Dynamic-id detection is multi-signal, never "contains a number".** One strong signal (UUID,
  hex-hash tail with a digit, separator plus four or more digits, framework prefix) or two weak
  ones. `#loginForm2`, `#step-3` and `#gsigninform_btn` are authored and must stay that way.
- **`weak` and `suspicious` are reported, not blocked, and that is deliberate.**
  `getByRole('strong')` claiming "Welcome to Bugasura" (TC_LOGIN_036) and `getByRole('heading')`
  claiming the same thing (TC_LOGIN_037) are the same shape offline — the first failed and the
  second passed. Nothing available without a page separates them, so the gate decides. The expected
  value is never rewritten to make either one pass.
- **`.first()`/`.nth()` in a recorded chain is evidence, not noise**: Codegen found several
  elements. It is penalised and marks the locator ambiguous; it is never *added* to force
  uniqueness.
- **A dynamic scope is dropped for a descendant the recording proves is inside it.**
  `#tc_summary_636432 >> getByText('Config Line Chart: Unable to')` becomes the text alone
  (`NORMALIZED_LOCATOR`, classified **weak** — the descendant is recorded, its uniqueness is not).
  A *stable* scope is never dropped, and nothing is ever added that the recording did not contain.
- **The only relationship a recording states is containment**, and it states it by chaining.
  Ancestor/descendant axes are generated from that; sibling, parent and following axes are not,
  because Codegen never writes one down and inventing a DOM shape is the thing this refuses to do.
  An ancestor candidate is generated and then **rejected with its reason** when naming the ancestor
  would need a prefix match on a generated id or a position — the attempt is on the record in
  `rejected`, so "nothing was found" and "four things were found and all were unsafe" stay
  different statements.
- **An assertion is never resolved to its own expected text.** `expect(getByText('Line Chart |
  Time Config…')).toContainText('Line Chart | Time Config…')` finds the element *by* the string it
  checks for, so it can only pass — and it survives the gate, because the mutator changes the text,
  the locator stops matching and the mutated run fails. That is the one transformation here that
  could manufacture false coverage rather than merely fail, so it is refused outright.
- **`assessNewPageObject` in `locator-quality.ts` is dead and cannot ever return `safe`** — it
  unconditionally pushes "selector uniqueness cannot be proven offline". It has no caller and is
  superseded by `ai/autocode/abstraction/`, which answers uniqueness from press-time measurement
  rather than declaring it unanswerable. It is left in place only because deleting it shifts
  `frameworkFingerprint` and reopens every case's attempt budget. **Do not build on it.**

### The Page Object lifecycle: every element gets a decision, and none is silence

`ai/autocode/abstraction/lifecycle.ts` gives every `PAGE OBJECT REQUIRED` element exactly
one terminal disposition — `EXISTING_PO_REUSED`, `PO_CREATED_DETERMINISTICALLY`,
`PO_CREATED_BY_AI`, `AI_REPAIRED_AND_ACCEPTED` or `REFUSED_NO_ADMISSIBLE_EVIDENCE`. There is
no `NEEDS_REVIEW` in that vocabulary, deliberately: it was the state that asked a person to
make a decision the framework had the evidence to make.

- **The silent `continue` is gone, and it was the whole defect.** `analyseCorpus` had two
  exits that discarded an element without a record — `if (!evidence) continue` per target,
  and a whole-recording skip when the sidecar was missing. Measured over the corpus: **225
  raw locators, 87 of which had never been evaluated at all**. From the report those 87 were
  indistinguishable from the 138 that were evaluated and correctly refused, which made a
  coverage hole look like a considered decision. They are now `UnmeasuredTarget` records
  carrying `NO_ADMISSIBLE_EVIDENCE` and the one remedy that lifts it.
- **`Proposal.sightings` is the join key.** The ledger keeps one line per abstraction, so an
  element first seen in another recording has no proposal of its own — filtering by
  `testCaseId` found nothing for exactly the elements a second recording shares with a first.
  Every sighting is recorded, including the deduped ones, and it is never used to decide
  anything.
- **A method created in THIS generation reports the creation, not a reuse.**
  `ensurePageObjects` runs before assembly, so a method it creates already exists when
  `mapRecording` looks for it and comes back as an ordinary `page-object` step. Reporting
  that as `EXISTING_PO_REUSED` is how the loop closing would become invisible.
- **`written`, never `outcome === 'APPLIED'`.** `WriteResult.outcome` is decided before
  anything reaches disk and is never revised, so a rolled-back run still carries `APPLIED` on
  every result — and the orchestrator was logging those as `created`.
- Structured, one JSON line per element, in `ai/reports/page-object-lifecycle.jsonl`.
- `npx tsx ai/autocode/abstraction/lifecycle.fixture.ts` — offline, no browser, no model.

**The writer now registers the fixture, and `verify()` checks it.** A method on a class with
no fixture is not a missing improvement: Playwright answers `Test has unknown parameter
"issuesPage"` and refuses the WHOLE FILE, collecting 0 tests. `registerFixture` writes all
three declarations (import, `Fixtures` property, factory) or none, and refuses outright for
`BasePage`/`TermsPage`, which have no fixture *by design* and say so in their own headers.
`applyProposals` also creates a Page Object CLASS that knowledge declares and no file
implements, and deletes it again on rollback — a created file has no backup to restore.

**A shared accessible name is never written into a knowledge entry.** `findMethod` matches
`accessible_name` page-wide, so an entry keyed on a name several structurally different
elements share binds all of them — all five `Close` buttons in this corpus would have bound
to the notification panel's locator. `Proposal.accessibleNameAmbiguous` is computed from the
corpus before anything is asked, `renderKnowledgeEntry` omits the field when it is set, and
the method is reached instead by `findMethodByProvenLocator` on the measured expression.
This is what let `AMBIGUOUS_NAME` become askable: the binding hazard was removed, not the
refusal overruled. `revalidate` still refuses to clear it unless the flag is set AND a
template exists.

**A method name may not be the element's CSS class in camelCase** (`classDerivedName`, in
`validate.ts` so both paths can reach it). `roundedCheckboxUi` passes every other naming rule
and is still the stylesheet's name for the element rather than the capability's. An **id** is
deliberately not refused — `issueSummaryInput` from `#issue_summary_input` is a good name,
because somebody authored that id to mean something, and generated ids never reach naming at
all.

**The scenario title is derived from the semantic journey when the authored one names a
selector** (`ai/autocode/scenario-title.ts`). TC_LOGIN_112's workbook cell held
`#tr_1749558 > .tabulator-cell… — 1749558 is ticked`, because `scenarioFrom` builds a title
from the last click's `target` and Codegen's `target` for an element with no accessible name
IS the selector. The raw material is the MAPPING, not the recording: a mapped step knows
`IssuesPage.issueCheckbox`, and those words are semantic by construction. Infrastructure —
opening a URL, signing in, the landing redirect — is excluded, because every authenticated
test performs it. **The authored cell is never rewritten**; the derivation happens at
assembly, and a hand-written title always wins.

### The abstraction engine writes Page Object methods; a model may resolve one question

`ai/autocode/abstraction/` turns proven recorded locators into reusable methods. It runs
**after** generation, only under `--create-page-objects`, and it is deterministic apart from one
narrow, audited exception. [ABSTRACTION-GUIDE.md](../ABSTRACTION-GUIDE.md) is the full reference;
what must not be got wrong:

- **Every refusal carries a CODE, and the code decides who may clear it** (`types.ts`:
  `SAFETY` / `SEMANTIC` / `STRUCTURAL`). Nothing anywhere branches on refusal wording — that is
  what the codes exist to make impossible, and `refusals: string[]` is a projection of
  `refusalCodes`, never a second list.
- **A model is asked only when there are ZERO safety refusals and ZERO structural ones, and
  every open semantic question is one it may be asked.** A dynamic id with a naming question
  is a dynamic id. One askable question beside one unaskable one is *not* asked either:
  clearing half would leave the rest standing and the call would be spent learning what
  eligibility already knew. Measured on the real corpus: 11 of 61 proposals eligible, and the
  normal path — REUSE, parameterised REUSE, a deterministically safe new method — costs no
  model call at all.
- **Several semantic questions go in ONE exchange, not one each.** The answers constrain one
  another — which class owns an element bears on what it is called, and whether its text is a
  label bears on whether it takes an argument — so splitting them costs a call each and lets
  two exchanges disagree. `eligibility` returns `codes: RefusalCode[]`, and `revalidate`
  checks all of them together.
- **The repair loop is bounded and the standard never moves** (`MAX_RESOLVER_ATTEMPTS = 3`).
  A rejected or malformed answer is put back with the validator's VERBATIM rejection and
  re-validated by the identical `revalidate`; a repair is a second attempt at the question,
  never a second, laxer standard. Exhaustion is a terminal `RESOLVER_EXHAUSTED` (STRUCTURAL,
  so it is never re-asked in the run), and `exhaustedBefore` reads the audit log so a
  stateless analyser cannot re-ask the same unanswerable question on every future run.
- **A transport outage is not a verdict.** It spends no attempt, adds no refusal and leaves
  the proposal exactly as the deterministic engine produced it — otherwise one afternoon
  without the Claude Code binary would close the question permanently.
- **A decline is respected only when it declines the question that was asked.** Found by a
  real resolver: asked whether a project card's text was LABEL or DATA it answered
  `"textKind": "DATA"` at confidence 0.9 and set `"decision": "NEEDS_REVIEW"` beside it,
  because it was unsure whether to CREATE or REUSE — which is not its call, since that is
  decided against the repository index. Reading the decision field first threw the good
  answer away and burned the whole repair budget re-asking a settled question. The decision
  is terminal only where it IS the answer (capability-or-container, worth-a-parameter);
  elsewhere an incomplete answer is rejected for *what is missing*, which is what the repair
  prompt then quotes.
- **`REUSE_EXISTING` must name something that exists.** Also found live: a resolver answered
  `REUSE_EXISTING` for `ProjectsPage.projectCard`, a method the repository did not have, and
  the framework quietly created one under a decision that said the opposite. The outcome was
  safe; the disagreement is now a rejection the repair loop can act on.
- **A recommendation is re-validated against every other rule as though it had never spoken.**
  It cannot choose a locator (a returned template that differs from the measured one rejects the
  whole answer), cannot invent an owner (closed set from knowledge), cannot rename what the
  framework derived, and cannot clear a second refusal. Confidence is recorded and never obeyed.
  `semantic.ts` is the ONLY module in `abstraction/` allowed to reach a model, it is named rather
  than pattern-matched in the zero-AI fixtures, and no deterministic module may import it.
- **`AMBIGUOUS_NAME` was switched off because it was tried, and is now ON because the reason
  was REMOVED rather than overruled.** A resolver asked about the notification panel's Close
  control answered `closeButton` — sensible, and the entry would have declared
  `accessible_name: Close` beside a panel-scoped locator. `findMethod` matches accessible
  names page-wide, so all five Close buttons in the corpus would have bound to the panel.
  That entry was written and rolled back in an earlier phase. The ambiguity is in the
  BINDING, not the name — so the binding was fixed: `renderKnowledgeEntry` omits
  `accessible_name` whenever `Proposal.accessibleNameAmbiguous` is set, which is exactly when
  the refusal is raised. With no shared key there is nothing left to bind wrongly, and
  `findMethodByProvenLocator` reaches the method on the measured expression instead.
  `revalidate` refuses to clear the code unless that flag is set AND a template exists, so a
  method can never be created into the gap the fix opens.
- **`PROPOSED` is written with nobody's countersignature, and status is the only door.** An
  approvals-file override was tried and removed: an approved fingerprint would have carried a
  `REFUSED` proposal — a generated identifier — past the gate that exists to stop it.
- **Three reuse resolvers run before anything is created**, in `from-recording.ts`:
  `findMethod` (by the name the recording used), `findMethodByProvenLocator` (an
  existing non-parameterised method whose declared locator IS the proven expression),
  then `findParameterisedMethod` (by declared template, supplying the argument). The
  middle one exists because a recorded assertion on the issue-list search box is called
  `filter-value` — its id — while knowledge declares it under `accessible_name: Search`,
  so no name matched and a raw locator was emitted with `IssuesPage.searchField()`
  sitting right there. It matches only on exact equivalence or on a sole authored id
  the entry declares as its ONLY selector, refuses two claimants, and refuses a dynamic
  id or a positional expression. **A target any of the three resolves never becomes a
  proposal, so a model is never asked to rediscover a method that already exists.**
- **A knowledge entry that declares no selector and no accessible name is UNREACHABLE**, and
  the framework will cheerfully propose creating what it already has. `create_team_cancel_button`
  declared a description, `page_object: ProjectsPage` and `page_object_method:
  createTeamCancelButton` - and `ProjectsPage.createTeamCancelButton()` had existed all along,
  resolving `#create_team_cancel_btn`. Every resolver still missed it: `findMethod` compares the
  RECORDED target ("Cancel") against `accessible_name` / `id` / the method's words, and
  "create team cancel button" is none of them; `findMethodByProvenLocator` needs a concrete
  selector to compare the proven expression against; `findParameterisedMethod` needs a template;
  and `existingCapability` keys off declared selector TOKENS, so with none the element looked
  new. TC_LOGIN_127 therefore measured the button at one element with identity proven, found no
  capability, and asked a model who owned an element the repository already owned - which the
  resolver correctly declined, because /apps has three owners. **AMBIGUOUS_OWNERSHIP was a true
  answer to a question that should never have been asked.** One `locator_strategy` line fixed it:
  measured afterwards, TC_LOGIN_127 asks the resolver 0 questions instead of 1, and TC_LOGIN_126
  asks 1 instead of 2.
- **A declaration with no implementation is not a capability - it is an INVISIBLE one, and
  the engine will duplicate it.** `existingCapability` requires the declared method to be on
  the class before it will call an element already described, correctly: a method that does not
  exist cannot be reused. So `password_length_error`, which declared `LoginPage.passwordLengthError`
  and had no such method, made `#password_field-error` read as undescribed - and TC_LOGIN_120's
  recording produced a SECOND capability for the same element, `passwordFieldErrorState()`, whose
  own description carried the recorder's `[type=password]` redaction marker. One element, two
  methods, and nothing able to see the collision coming. The authored method is now implemented,
  the generated duplicate is gone from the class and from knowledge, and
  `po-discovery.fixture.ts` asserts over the whole corpus that every declared capability exists
  on its class - 41 declared, 41 implemented.
- **An owner nothing declares is not an owner.** `applyProposals` states the contract it depends
  on: *"the owner is never invented - resolveOwner returns only what a knowledge file declares
  for the route"*. That held for the containment, container and route rules and was FALSE for the
  component rule, which derived a class name from a dialog's markup (`#create_team_invite_modal`
  → `CreateTeamInviteModal`) and returned it as though a repository had declared it.
  `knowledgeFileFor` then found no file for that class and refused - so the proposal was
  PROPOSED, validated and **unwritable by construction**, and the all-or-nothing writer took the
  sound proposals in the same run down with it. The rule now returns a component owner only when
  knowledge already declares that class (which is what `NotificationsPanel` is) and otherwise
  refuses with `OWNER_UNKNOWN` naming the class to declare. Strictly more refusing, and refused
  before a batch can be spent on it.

- **A container entry settles ownership; it is not a capability.** `project_grid` established the
  shape and `create_team_invite_dialog` follows it exactly: `page_object` plus a
  `locator_strategy` naming the container's authored id, and **deliberately no
  `page_object_method`**. `resolveOwner`'s second rule reads that id out of the declared strategy,
  so every element inside the container is owned deterministically instead of falling to the route
  rule - which sees three owners on /apps and correctly refuses to guess. The key is descriptive
  (`create_team_invite_dialog`), never the DOM id: keying it `create_team_invite_modal` makes the
  writer's `alreadyApplied` check fire on a proposal for the dialog ELEMENT, so the knowledge entry
  is skipped, the method is written anyway and `verify()` then rolls the whole batch back. Tried,
  measured, reverted.
- **The writer is all-or-nothing, and that policy is not the defect - reporting it as one was.**
  `applyProposals` writes every sound proposal or none, on purpose ("a run that wrote two methods
  and refused the third leaves a repository nobody planned"). TC_LOGIN_126 had three proposals: two
  the resolver accepted and the validator passed, and one BLOCKED with `no knowledge file declares
  CreateTeamInviteModal`. All three were reported as `REFUSED_NO_ADMISSIBLE_EVIDENCE` - a false
  statement about two elements whose evidence was proven, and one that sends a person to re-record
  work that was already correct. The disposition vocabulary now has a sixth value,
  `REFUSED_WRITER_BLOCKED`, and every decision carries a `diagnostic`: `WRITER_BLOCKED` (this
  proposal, with the writer's own `problems` verbatim) or `BATCH_ROLLED_BACK` (this proposal was
  sound; another refused the batch - named, with what it said, and with the others it took down).
  `SAFETY_REFUSED`, `EVIDENCE_INSUFFICIENT`, `OWNERSHIP_AMBIGUOUS`, `PROPOSAL_REJECTED` and
  `ALREADY_APPLIED` cover the rest. Nothing about the transaction changed.
- **"Measured nothing" and "measured plenty, proved nothing" are different states.**
  `validate.ts` read an empty `derivedCandidates` as the first and printed *"evidence predates
  press-time measurement"* over recordings made minutes earlier: TC_LOGIN_126's textbox is a live
  recording whose target carries 14 candidates measured AT the press, none of which identifies it.
  The refusal, its code and its class are unchanged; the sentence now says how many were measured
  and that a new recording would measure the same thing, so nobody re-records a complete recording.

- **An existing method short-circuits the group question** (`propose.ts`). Once the capability is
  on the class the index has already answered; without this, a constant-value group would be asked
  about, come back REUSE, and cost a model call on every run forever.

### A measurement is only a measurement where and when the person acted (P0.7)

A count of one says a selector identifies one element. It does not say it identifies the element
somebody clicked, and it does not say which page it counted. Both gaps produced evidence that
looked authoritative and was about something else.

- **`matchCount` used to be taken ~400 ms after the action, in whatever document was showing.**
  `getByRole('button', { name: 'Sign In' })` measured **0** in all four live recordings, because
  login had navigated to `/apps` by the time Codegen's line appeared; TC_LOGIN_063's
  `getByText('Faclon labs')` measured **2** on the page its click *arrived at*. Every parked press
  now carries a per-document nonce (`window.__auraDocument`, regenerated by every navigation
  because init scripts run per document), and a count taken anywhere else is `null` with
  `matchCountDocument: 'other'` — never a number, and never `0`.
- **Candidates are measured AT the press, in one batched `page.evaluate`.** `__auraPark` is an
  `exposeBinding` rather than an `exposeFunction` precisely so the frame comes back with the
  entry; `candidateSelectorsFor` stays the single source of the shapes worth measuring and only
  the counting happens in the page. It is fire-and-forget: the page called it from a passive
  `pointerdown` listener and never awaits it, and losing the race to a navigation costs exactly
  the pre-P0.7 behaviour.
- **The pressed element itself is parked** (`window.__auraTargets`, addressed by a counter that
  never shifts) so a candidate can be checked by identity — `nodes[0] === element` — not by
  resemblance. `isProvenAgainstClickedTarget` states the whole bar in one place: measured at the
  press, in the press's document, exactly one element, and that element is the one acted on.
  **TC_LOGIN_060 is why the count alone is not enough**: four candidates, each measured at one
  element, all of them on the page the click had already reached.
- **`pressTimeText` is the measurement nothing else can take**: how many elements the pressed
  element's own text resolved to, page-wide, while the person was still looking at that page. It
  is what makes a navigating click's ambiguity knowable at all, and it is only read for a bare,
  unscoped `getByText` of that text. The offline scorer cannot help here — it rates `getByText`
  at 75, above a stable id — so without this the choice is between a number from the wrong page
  and no number at all.
- **`disambiguated-by-clicked-target`** is the only new resolution. It fires exactly where the
  old rule refused, and refuses in the same words when nothing is proven. `first()`/`nth()`,
  `force`, `mouse.*`, `dispatchEvent` and XPath remain out of the question: they choose by
  position, and nobody chose a position.
- **Refused candidates are kept** (`rejectedCandidates`, bounded to 12, each with its reason).
  The funnel used to drop them, so a target that had measured twelve alternatives and refused
  every one reported *"none of the 0 alternative(s)"*. A sidecar recorded before this says so
  ("does not say what was measured") rather than claiming nothing was tried.
- **An unstated identity is not a failed one.** Claim-time candidates keep the old bar (a count
  of one), because every recording made before P0.7 has no identity answer and reading absence as
  "no" would silently un-resolve every generated id that resolves today. An identity that was
  *checked and came back false* is refused everywhere, including in the funnel.
- `npx tsx ai/autocode/clicked-target.fixture.ts` — 64 offline checks, no browser and no model.
  It runs the **generated** hook string against a stub DOM, so the in-page half is tested rather
  than read.

**The post-sign-in redirect is emitted for a raw recorded action too (P0.8).** A recording
cannot contain the navigation the application performs for itself, so the assembler emits the
landing screen's declared entry point (`ProjectsPage.open()`, from `entry_point:` in the
knowledge file) after the sign-in. That used to happen **only** when the next recorded action
matched a Page Object method; when it fell through to a Codegen locator — which is exactly what
a click on a project card does — nothing was emitted, and the spec clicked a card that was drawn
but not yet wired. `landingAfterSignIn` picks the screen from knowledge alone, refuses when two
screens claim it (ambiguity is not a match, as everywhere else here), and fires once. The
recorded action and its locator are untouched; a step is inserted *before* it, never around it.

`classifyRecordedFailure` (metrics.ts) separates the two things "quarantined" used to mean:
`RECORDED_ASSEMBLY_ERROR` when we reconstructed the recording wrongly — including any clean-run
failure where `orderReconstructed` is false — against `RECORDED_APPLICATION_FAILURE`,
`RECORDED_CLEAN_RUN_FAILURE`, `RECORDED_MUTATION_FAILURE`, `RECORDED_NO_ASSERTION` and
`RECORDED_UNMAPPED_ACTION`. These are telemetry codes; the workbook statuses are unchanged.
`npx tsx ai/autocode/recorded-lifecycle.fixture.ts` pins all of it — 45 offline checks, no
browser and no model.

### The assertion picker: what is pointed at, and what is asserted (P1.2)

A person records an assertion by clicking the **Assert pill** in the recorder overlay and then
selecting an element. The pill lives in the page, inside `ba-aura-assert` (a shadow root), and
it is the recorder's, not Playwright's.

- **Nobody used it for a week, because nothing said it existed.** The dashboard told people to
  use *Playwright's* Assert toolbar, and the pill rendered at `right: 16, bottom: 16` — exactly
  on top of Bugasura's Freshchat launcher (measured 70x75 at a 15px inset, z-index 2147483600
  against our 2147483647, so we won the stack and rendered over a chat bubble). A real recording
  was made with the picker installed, injected, visible and clickable, and no assertion came out
  of it. `PILL_ANCHOR`, `RESERVED_AREAS` and `pillRect()` in `assertion-picker-source.ts` now hold
  the position, and the fixture checks the rectangle against every reserved area at three viewport
  sizes — which is what rejected `bottom: 104`, a number that looked fine and left 6px of the pill
  inside the padding.
- **`[recorder] assertion picker ready` is logged when, and only when, the install succeeds.**
  The `pickerInstalled` / `pickedAssertions` / `refusedAssertions` metrics are still in-memory
  only and reach no sidecar, so the log line is currently the only way to answer "was it there?"
  without reproducing the whole startup.
- **A comment inside `ASSERTION_PICKER` must contain no backtick and no single `\s`.** It is a
  template literal: a backtick ends the script, and `\s` reaches the page as `s`. Both have
  broken it, twice each. Check the GENERATED string, never the source.

**INTERACTION TARGET is not ASSERTION SUBJECT** (`associated-control.ts`). The element a person
can point at often is not the element holding the state. Bugasura's toggle is the case:

```
label                                     <- what closest('label') finds
  span.ba-switch                          <- the wrapper, names the widget
    input.ba-switch__input                <- 0x0, carries `checked`
    span.ba-switch__track
      span.ba-switch__thumb               <- 10x10, what a person clicks
```

- The page **proposes** candidates by relationships the DOM states outright — a label's control,
  a `for`/`id` pair, a wrapper containing exactly one checkable input, `aria-controls` — and
  applies no semantics. `associated-control.ts` **disposes**, taking them in that priority order
  and only where the candidate classifies as `checkbox`, `radio` or `switch`.
- **A wrapper needs the structure AND a marker.** Containment alone adopts an unrelated sibling
  (`<div><span/><input type=checkbox></div>`); a class alone invents a control that is not there.
  Both, or nothing. `active`, `on`, `off` and `selected` are never consulted as class names.
- **Which element, and what to call it, are two questions.** Resolution priority answers the
  first: the `<label>` beats the wrapper, because it is the stronger statement of association.
  It says nothing about the second — the wrapper is what makes the control a *switch*, so the
  person sees ON/OFF rather than Checked/Unchecked. Answering both with the priority order
  offered "Checked/Unchecked" for Bugasura's toggle, and only the live check found it: the
  offline fixture had the thumb outside the label and passed.
- **Visibility stays with what a person can see.** The subject is 0x0 by design, so `Visible`
  and `Hidden` are bound to the clicked element while checkedness and enablement go to the
  control. Binding all six to the subject would emit `toBeVisible()` against an input the
  application deliberately hides — a red test about correct behaviour.
- **The recorded click is untouched.** Only the assertion moves; `interactionTarget` records
  what was pointed at, as documentation, and nothing generates a step from it. P0.7's target
  identity is not involved in any of this.

Verified end to end on the live application: the card reads `Enable Notifications…`, `✓ Visible
✓ Enabled ✓ ON`, offers ON/OFF/Enabled/Disabled/Visible/Hidden, and the recorded assertion
(`getByLabel(...)`, `toBeChecked`) matches one element, passes, and **fails when negated** — so
it is falsifiable rather than vacuously green. The toggle read `true` before and after.

### Assertion-to-target provenance: WHICH element an assertion is about

`evidenceFor` joins a recorded step to its evidence on the **locator string**. That is the right
key for an action — the action *is* the line Codegen wrote — and the wrong key for an assertion,
whose locator is composed independently by `locatorFor` from the element's own description. One
element, two composers, two strings that need share no substring.

TC_DASHBOARD_023 is what that cost. The assertion carried `page.locator(".bugChecked")`; the
evidence row for that very input was `page.locator('[id="1749552"]')`. No join, so no evidence,
so `fromEvidence` had nothing to answer with, the offline scorer rated a bare class at 65 and
emitted it — and Playwright refused it at run time as **three elements**, while the measurement
naming which of the three sat in the same file.

**The association is node identity, taken in the page at pick time, and nothing else.** Every
registration into `__auraTargets` now also gets a NAME — `refFor(slot)`, an opaque
`documentId:slot` allocated by the one `allocate()` both the press hook and the picker's door go
through. A press carries its name out on the parked entry (`TargetEvidence.elementRef`); at pick
time `__auraSameElement` compares the picked subject's node with each queued press's node using
`===` and returns the names that match. `RecordedAssertion.subjectProvenance` holds those names
plus `locatorMatchCount` — Playwright's own count of the assertion's own locator, in the document
the person was looking at.

- **Nothing is inferred from a selector, a generated id, DOM proximity, the preceding action, a
  matching index or a similar class name.** A look-alike in the sibling row — same tag, same
  class, same `name`, same place in an identical row — matches nothing, and that is asserted
  against a real DOM rather than reasoned about.
- **An empty answer is a real answer.** An assertion about an element no action ever touched, a
  press whose slot has been released, a node that was re-rendered, a different document — all of
  them yield no provenance, and the assertion is then judged exactly as it was before any of this
  existed.
- **`locatorMatchCount` is the measurement that never existed for an assertion.** A recorded
  target's `matchCount` counts *Codegen's* expression, so the string that actually reaches the
  spec had never been counted by anything. Counted at the pick, which is also the moment the
  assertion is about. It is what turns an ambiguous assertion locator into a *measured* ambiguity
  — refused, or settled by a proven candidate, or recovered by the measured index — instead of a
  css locator scored at 65 and emitted.
- **The evidence an assertion adopts is a PROJECTION, and it is an allow-list**
  (`evidenceForAssertionSubject`). Element-level facts transfer: the node, its parent, ancestors,
  siblings, every measured and every refused candidate, `pressTimeText`. Locator-level facts do
  not: `locator`, `matchCount`, `matchCountDocument` are restated from the pick-time measurement,
  and **`identifier` is dropped** — it describes the id *Codegen's* expression was built on, and
  carrying it would send an assertion whose own locator is a clean role-and-name down the
  generated-id branch and out as an index. A locator made worse by more evidence existing is the
  exact defect the decision order was rewritten to remove. An allow-list means a field added to
  `TargetEvidence` tomorrow does not travel until somebody decides it is true of the element.
- **One target, or none.** Two evidence rows captured from the same node (a `click` and a `check`
  on one input write two lines and claim two parked entries) are two graphs of one element taken
  at different instants; both are true and choosing between them is judgement, so it is refused
  and said out loud. `refs` may hold several names for one node — `pointerdown` and `focusin`
  both fire on the input a label forwards to — which is a multiplicity of names, never of
  elements.
- **The element an assertion is ABOUT is not always the subject, and this is where the first
  version was wrong.** `Checked` belongs to the control that holds the state; `Visible` belongs
  to what a person can actually see, because a custom switch's subject is a 0x0 input the
  application deliberately hides. `recordPickedAssertion` already made that decision, so it is
  the one place that hands out the slot (`asserted`), and `resolveAssertionProvenance` takes a
  slot rather than a payload. Deriving it from the subject named the *input* for a `visible`
  assertion recorded against the *span* — one element's locator judged against another
  element's evidence, the exact wrong association this mechanism exists to prevent.
  Mutation-tested: restoring the subject-derived slot turns two checks red.
- **Roles stay separate.** Provenance is a third fallback for the reuse resolvers and a second
  source for the locator engine; it changes no action step, and `evidenceForResolved` stays a
  reuse-only key, unchanged, because its row's counts belong to Codegen's chain.
- `recordAssertionFromPicker` is extracted from the `__auraAssert` binding for the same reason
  `splitCandidates` was: the ORDER is load-bearing (contextual locator first, because it may
  replace what is recorded; provenance last, because it counts what was chosen) and getting it
  wrong is silent — the assertion is still recorded and simply carries nothing.

- **DECISION (2026-08-24): for a script-written assertion with no admissible provenance, the
  framework intentionally prefers NEEDS_REVIEW over promoting a claim-time candidate.
  Claim-time uniqueness is not proof of run-time identity.** Tested before it was believed, on
  TC_LOGIN_128's own evidence, in three designs: capturing identity at the moment Codegen
  appends the line and stamping it honestly (`measuredAt: 'claim'`) changes **nothing** -
  `provesIdentity` requires a press or a pick, so no candidate proves anything; marking the
  count attributable, or stamping the capture as a pick, both **re-emit `page.locator('h2')`**,
  the locator that fails strict mode on three elements.

  The reason is not measurement quality. The record-time page had ONE `h2` and the run-time page
  has THREE, at the same point in the same flow - so no record-time capture, however precise,
  can establish a fact about run time. Provenance answers *which element did you mean*; this
  failure asks *will that expression still name one element later*, which the recorder cannot
  answer. The evidence does contain `page.locator("#apps_tab_container h2")` counted at 1, and
  it would probably have been right - "probably right" is exactly what this architecture does
  not emit.

  So the expected assertion text is never identity, `h2` is never rewritten to a scoped or
  role-and-name locator, no index is added, and no claim-time measurement is promoted.
- **The recommended recording path for an assertion that needs element-level provenance is the
  existing Assert/Pick workflow.** The picker captures at the instant the person makes the claim
  and resolves a SCOPED expression (`container-text`) rather than certifying the bare one, which
  is why TC_LOGIN_123, TC_LOGIN_126 and TC_LOGIN_127 resolve where a Codegen-written assertion
  cannot. An assertion typed into the script by Codegen is not wrong to record - it simply
  cannot carry provenance, and the honest outcome for it is a refusal.

- **A count is only evidence of uniqueness where it can be ATTRIBUTED - and that now applies
  to one, not just to zero.** `measuredZero` has always distinguished `same` (counted in the
  document the interaction happened in) from `unknown` (read from whatever page was showing
  afterwards). Nothing made the same distinction for a count of ONE, and one is what suppresses
  `measuredAmbiguity` - so a locator with an unattributable count of one was never even
  considered for replacement. TC_LOGIN_128 asserted `page.locator('h2')`, an assertion **Codegen
  wrote into the recorded script**, so it never passed the picker and has no provenance;
  `captureFor` measured it after the action at `matchCount: 1, matchCountDocument: 'unknown'`
  with identity never asked, and the offline scorer emitted the bare tag. The live page has
  three `h2`s: STRICT_MODE_FAILURE at run time, after a full gate run.

  `isUnscopedStructuralLocator` is the structural twin of `isUnscopedTextLocator`, and it exists
  for the same reason: a bare tag or class carries nothing that constrains it, so every other
  element of that tag matches it as well as the one recorded. It refuses unless uniqueness is
  attributable - the recorded locator's own count taken in the interaction's own document, or a
  candidate this role can prove whose expression IS this locator. **Deliberately narrow**: an id,
  an attribute, a descendant or a combinator all take an expression out of the rule, and it runs
  after `fromEvidence`, so proven candidates, contextual recovery and evidence-backed position
  all still answer first. Measured over the corpus: of 694 emitted decisions it touches 110, and
  104 of those are the recorder's own overlay (`ba-aura-assert`, `.veil`); the application
  locators it refuses are `h2`, `h1` and `body`.

  **The provenance gap it does NOT close**: a script-written assertion still gets no `elementRef`
  and no pick-time capture, so its ten measured candidates stay unattributable and the honest
  answer is NEEDS_REVIEW rather than a resolved locator. Giving those assertions the capture the
  picker already gives is a separate phase.

- **`buildLocator` rebuilds a recorded expression FAITHFULLY or refuses it.** It reconstructs
  the string so the page can be asked to count it, and the count it returns becomes
  `locatorMatchCount` / `matchCount` — a number that decides branches. It used to *look for*
  the calls it knew and step over everything else, and to read the options it knew and drop
  the rest. Both are the same defect: **a locator silently replaced by a broader one, whose
  count is then used to make a decision about the narrower one.** Every drop widens, so the
  fabricated answer is always "several matched" — a unique locator reported as ambiguous,
  which is what sends a case looking for an index.

  Two measured instances, both confirmed live on my.bugasura.io:
  `page.locator(".tabulator-row").filter({ hasText: … }).locator(".bugChecked")` was counted as
  `page.locator(".tabulator-row").locator(".bugChecked")` — **1 element counted as 2**, which
  is the number in TC_LOGIN_123's sidecar; and `getByRole('button', { name: 'Sign In', exact:
  true })` was counted as `{ name: 'Sign In' }` — **1 counted as 2**, the second being *Google
  Sign In*, on the single most-recorded expression in the corpus (82 of them).

  The rule now: `chainMethodsIn` reads the WHOLE chain first and one call outside `REBUILDABLE`
  refuses the lot; `readOptions` refuses any option outside `ROLE_OPTIONS` / `TEXT_OPTIONS`, any
  value that is not a literal (a regex `name`, a variable), and `nth(x)` that is not an integer
  — that last one used to become `nth(0)`, a different element chosen silently. **`null` is the
  safe answer**: `matchCount: null` means *not measured* everywhere downstream and is never read
  as ambiguity, while a wrong number is indistinguishable from a real measurement.
  `name` and `exact` are supported because they round-trip exactly; `checked`, `disabled`,
  `expanded`, `includeHidden`, `level`, `pressed`, `selected`, `has`, `hasText` and
  `hasNotText` are deliberately absent — support is added with a test that proves the
  round-trip, never on speculation.

  **The press-time path is untouched by any of this.** `takePreAction` matches parked entries
  by `literalsIn`, never by rebuilding, so `derivedCandidates`, identity and positions do not
  depend on the parser. Only the after-the-fact capture and `countQuietly` do.
  `ai/dashboard/locator-reconstruction.fixture.ts` pins it with a stub page that reports which
  chain and which options it was actually handed — a real browser shows only the number, which
  is how both defects survived.

**A slot names the NODE, not the event that registered it** — and getting that wrong is what
TC_LOGIN_107 exposed. It asserts a checkbox is unticked, clicks it, and asserts it is ticked.
The second assertion resolved; the first emitted a raw `.bugChecked` and failed strict mode on
three elements, because `elementRef` was allocated fresh per press and the identity answer walked
the press queue only. An element nothing had pressed yet therefore had no name at all, so the
assertion that came *first* could not be tied to the element it was about.

Two changes, both in the allocator layer:

- **`allocate` is idempotent per node.** Ask the registry twice for the same live element and the
  same slot comes back, so its name exists from the first moment anything looks at it. A linear
  scan of at most 60 entries rather than a Map, so no extra reference is held, and a released slot
  cannot match — the element is registered afresh and gets a new name, never a stale one.
  `__auraSameElement` now returns the node's own name first, then any other press-queue
  registration that is the same node (which only differs after a release). One node pressed twice
  is one name; two look-alike siblings are two names.
- **An assertion pick is a capture site.** `__auraObserveSlot` captures the asserted element's
  graph with no interaction at all, and `captureAssertionTarget` measures its candidates through
  the same `candidateSelectorsFor` → `__auraMeasure` path a press uses, stamped `measuredAt:
  'pick'`. It never parks a press, so an assertion's graph can never be claimed by a recorded
  action line.

**`elementRef` and `captureRef` answer different questions, and conflating them was the bug.**
`elementRef` names the element; `captureRef` names one capture of it. TC_LOGIN_107 asserts about
one checkbox twice, either side of a click — one element, two claims, two instants — so each
assertion carries its own `captureRef` and is judged on its own measurement.
`evidenceForAssertionSubject` resolves `captureRef` first and falls back to node identity, which
is what keeps every earlier recording behaving exactly as it did.

- **A pick row is unreachable by locator string, twice over.** Its `locator` is not an expression
  at all (`(assertion pick <ref>)`), and `evidenceFor` skips `assertion-pick` rows regardless —
  because two different elements routinely compose the same expression, and matching a pick row
  by string is the very mis-association the mechanism exists to remove. `targetByElementRef`
  skips them too: several pick rows can share an `elementRef`, so node identity would find them
  all ambiguous.
- **`isPositionProvenAtPick` is separate from `isPositionProvenAgainstClickedTarget`**, for the
  reason `isProvenAtPick` is separate from `isProvenAgainstClickedTarget`. An **action** still
  demands a press-time position — a measurement from any other moment describes a page the action
  did not happen on. An **assertion** may use its own pick, because an assertion is a claim about
  the page as it stood when the person made it, so the pick is the *right* moment rather than a
  weaker one. `positionRecovery` takes the caller's `kind` and nothing else about it moved.

- **`provesIdentity(candidate, role)` is the one place that answers "which timing may this
  caller act on" for IDENTITY**, and it exists because for a year only the POSITIONAL half of
  that question had an answer. `isProvenAtPick` was written with the pick-capture mechanism and
  used by the recorder — and by no consumer at all. Every decision that asks "is this proof?"
  asked `isProvenAgainstClickedTarget`, which ends `measuredAt === 'press'`, so a candidate
  measured at ONE element, in the same document, with identity matched, was discarded for saying
  the wrong word about WHEN.

  TC_LOGIN_123 is the case. Three assertions about two issue checkboxes, each carrying
  `.tabulator-row filter(hasText: "<issue description>") .bugChecked` at `matchCount: 1`,
  `identityMatched: true`, `measuredAt: 'pick'` — byte-identical to the
  `IssuesPage.issueCheckboxState(description)` already in the repository. All three fell past
  Page Object reuse, past parameterised reuse, past contextual settlement, and landed on
  `.tabulator-table filter("close Filter : Saved Filters…") .bugChecked .nth(0|1)`: scoped by
  the SAVED-FILTERS BAR and narrowed by an index. **The asymmetry is what made it invisible** —
  `positionRecovery` had been taught the distinction, the settlement step 90 lines above it had
  not, so the weaker mechanism accepted pick-time proof while the stronger one refused it and a
  locator got worse because better evidence existed. The spec ran and passed, which is why
  nothing caught it: a silently weaker locator, not a red test.

  `provenCandidate`, `effectiveLocator`, `classify` and `validateCandidate` all take a
  `role` that **defaults to `action`**, which is the strict answer and exactly what every caller
  had before; `findMethod`, `findMethodByProvenLocator` and `resolveParameterisedReuse` already
  carried the role and now use it. Only the timing word is role-aware: one element, the same
  document, identity matched, and every identifier and mechanism rule are unchanged for both
  roles. Measured over the corpus: 78 recorded assertions, 28 carry provenance, **16 across 11
  cases gain a proven candidate**. TC_LOGIN_122 does NOT — its three issue descriptions are
  substrings of one another, so the same row-scoped shape measured 3 with identity false, and it
  still resolves through positional recovery. **That distinction is the whole point** and is
  pinned in `assertion-pick-reuse.fixture.ts`.

- **An assertion reaches the ABSTRACTION engine's evidence by provenance too.**
  `propose.ts` joined only on the recorded locator string, which can never reach a pick capture
  (its `locator` is the synthetic `(assertion pick <ref>)`, and `evidenceFor` skips such rows by
  design). So an assertion whose composed phrase differed from its candidate's was filed as
  `NO_ADMISSIBLE_EVIDENCE` — "the evidence sidecar holds no measurement joinable to this
  element's recorded locator" — while the sidecar held a unique measurement for that very
  element. The item now carries `subjectProvenance` and falls back to
  `evidenceForAssertionSubject`, in that order: the recorded row describes the EXPRESSION, the
  provenance describes the ELEMENT. A recording with no provenance is still refused, not
  rescued.

`npx tsx ai/autocode/assertion-provenance.fixture.ts` — 156 offline checks, no browser and no
model. It runs the GENERATED hook against a stub DOM, drives the recorder's own sequence through
the real exported functions, replays TC_DASHBOARD_023's own measured candidates end to end
through `mapRecording`, and covers TC_LOGIN_107's shape directly: `assert(A) → click(A) →
assert(A)` must give both assertions one `elementRef` and two `captureRef`s, and `assert(A) →
assert(B)` on two elements that compose the *identical* locator must still resolve to two
different indices. Mutation-tested in both directions — reverting the idempotent allocator,
preferring node identity over the assertion's own capture, and removing the `captureTiming`
exclusion each turn it red.

**A recording made before this carries no `elementRef` and cannot be repaired** — the document
that could have answered is gone, exactly as with `positionWithinCandidate`. Verified: 0 of
TC_DASHBOARD_023's 7 targets carry one, and TC_LOGIN_107's first assertion carries no
`captureRef`, so on disk it still emits the raw class. Re-recording is the only route.

### A measurement outranks a shape, and a method is not a locator

Three defects, all found through one recording (TC_LOGIN_109), all in the seam between
what was measured and what was decided.

**A locator the browser counted at ZERO elements is refused** (`measuredZero` in
`locator-quality.ts`, consulted as step 0 of `fromEvidence` — i.e. before the offline
scorer). `getByRole('checkbox', { name: 'done' })` is a textbook role-and-name locator,
so the scorer rated it 95 and classified it `stable` while the browser had already
counted it at zero. Across the corpus, **29 targets carry a count of zero, all 29 were
emitted verbatim, and not one appears in an accepted spec** — every one would time out.

- **A zero is only refused when it is ATTRIBUTABLE.** `same` (counted in the press's own
  document) is decisive. `other` is never refused here — `getByRole('button', { name:
  'Sign In' })` measured 0 in four recordings because login had navigated, which is a
  fact about the page and is the whole of P0.7. `unknown` or absent is refused only when
  the recorder ALSO failed to find the element there (`(not found)`): two independent
  failures to locate it and no captured graph to set against them.
- **An unmeasured locator is untouched.** Absence of a measurement is not a measurement
  of absence.
- Measured effect: **6 targets replaced** with a press-time proven candidate they already
  carried (TC_LOGIN_071/076/077/078/087 — the notifications-panel Close, Cancel, and
  `#bug_new_submit` for Add Issue), **22 refused**, **1 spared** (TC_LOGIN_063, which has
  a captured graph and an unattributable count).
- `captureFor`'s zero branch now records `matchCountDocument: 'unknown'`. It was the one
  count in the file that did not say where it was taken, so a decision rule had to read
  the field's *absence* as a fact about the page.

**Page Object reuse requires the FIXTURE, not just the method** (`methodIsDeliverable`,
six call sites). A generated spec obtains a Page Object one way only — by destructuring
the fixture named after the class — and `IssuesPage` had no fixture. Its methods were
offered, `issuesPage.issueCheckbox(...)` was emitted, and Playwright refused the whole
file: `Test has unknown parameter "issuesPage"`, **0 tests collected**. Ten specs were
quarantined that way, and the ten ids are exactly the ten files in `quarantine/` that
destructure `issuesPage`.

- **`IssuesPage` was an oversight and now has a fixture.** FRAMEWORK-GUIDE.md's own
  five-step procedure ends "Register a fixture in `tests-e2e/fixtures.ts`"; step 5 had
  been skipped while the knowledge file, seven declared elements and two
  abstraction-engine methods measured against real recordings all existed. Contrast
  `TermsPage`, whose header says it has no fixture *on purpose* (it is built over a popup
  Page that does not exist until a test clicks the link), and `BasePage`, the abstract
  base. Those two stay fixture-less, which is what keeps the gate honest — a rule with no
  live subject is untested.
- The gate and the fixture are **not alternatives**. Without the gate a future Page
  Object repeats the failure; without the fixture the abstraction engine's two measured
  methods are dead code.

**A quarantine names the cause, not the symptom** (`verify.ts`). `Not Collected. No test
with this ID was collected from the spec.` was one string covering an unknown fixture, a
file that does not compile, and a `--grep` that matched nothing — and Playwright had
already said which, in a structured `errors[]` entry in the JSON report the gate was
already opening. `runOne` now reads it and returns a `FailurePhase` (`collection` |
`execution`) and a `FailureCode` (`UNKNOWN_FIXTURE`, `NO_MATCHING_TEST`, `COMPILE_ERROR`,
`COLLECTION_ERROR`, `STRICT_MODE_FAILURE`, `ASSERTION_FAILURE`, `TIMEOUT`,
`RUNTIME_FAILURE`) with Playwright's own sentence kept verbatim.

- **Classified from structure, not from scraped console text.** The reporter gives
  `{ message, location, snippet }`; matching on that beats matching on a rendering that
  changes with the reporter and the terminal. `spawnSync`'s output is captured too, for
  the one case where no report is written at all.
- **Order is load-bearing in the execution classifier.** A strict-mode violation arrives
  through a locator call that also times out, so a timeout-first rule would hide the one
  failure this project cares most about.
- **Two downstream readers were drawing execution conclusions from a collection
  failure.** `excel:verify` routed `Not Collected` to **SUSPECT** — its only finding and
  its only non-zero exit, meaning "passed with every assertion broken" — said of a spec
  that never ran; it is `red` now. And `classifyRecordedFailure` returned
  `RECORDED_CLEAN_RUN_FAILURE` ("built faithfully, ran, and did not pass") for the same
  thing; `RECORDED_COLLECTION_FAILURE` now exists. Metrics schema 10 → 11.
- The prose table in `ai/excel/results.ts` is NOT replaced. It explains an execution
  failure to whoever reads the workbook; these are codes for a machine and a heading.

**Why the three checkboxes resolve differently, and why that is correct.** `.bugChecked`
measures 3, `#bugReport-table input` 7, `#app-issue-table-container input` 116 — every
broad shape on that screen is ambiguous. Only row 1749558's text ("Copy of login is not
working in moolya aura SAM") is unique as a *substring*, so its container-text candidate
measured 1 with `identityMatched: true`, landed in `derivedCandidates`, and became
eligible for parameterised Page Object reuse. The other two rows' text is a substring of
that one, so their identically-worded candidate measured 3, landed in
`positionProvenCandidates`, and `provenCandidate()` — which reads `derivedCandidates`
only — correctly declined. They fall to evidence-backed positional recovery.
**Preserve this asymmetry**: it is the difference between an abstraction that describes
the element and one that merely resembles it.

A strictly better candidate does exist in the captured evidence — `data-issue-id` on the
row, present, free of generated identifiers, and expressible as pure CSS — and
`candidateSelectorsFor` never builds it, because `data-*` is only ever read from the
TARGET (one line, two fixed test-id keys) and never from an ancestor. That is a real
improvement and it is **not** retrofittable: the candidate was never measured in that
document and the document is gone. Positional recovery is retained rather than a selector
invented.

**Two halves of the pipeline, two guards.** `methodIsDeliverable` covers the deterministic
recorded mapper; a spec the **model** wrote goes straight to `gate()`, so `staticCheck` now
also refuses one that destructures a fixture the framework does not declare. Offline, one
read of an index rebuilt every run, and verified to refuse **0 of the 43** specs the suite
actually has. Both helpers read `(index.fixtures ?? [])` and **fail closed**: an index with
no fixture list declares nothing deliverable, never "anything goes".

**The gate reads a case's evidence LIVE OR ARCHIVED, and judges it identically either way.**
`positionalIdentity` refuses an index unless the case's own recording proves it, and
`provenPositionalExpressions` re-derives that proof from the evidence file — from
`recordings/` alone, until now. But `acceptRecording` **moves** that file to
`recordings/accepted/` the moment a spec is accepted, so the proof was filed rather than
withdrawn and **a spec that had passed this very gate could no longer pass it**. Measured: 7
accepted specs carry an evidence-backed index (TC_DASHBOARD_026, TC_LOGIN_106/108/112/121/
122/123) and not one still had live evidence — TC_LOGIN_122 derived 0 proven expressions from
`recordings/` and 43 from `accepted/`, with its two indices in the second set. Latent while
the gate only ever ran before acceptance; it fires on `excel:verify` over accepted specs and
on any re-gate. The lookup now tries `evidencePath` then `archivedPath` — **the recorder's own
accessors, so there is one archive convention and the gate no longer spells the live directory
itself** — and nothing else moved: same predicate, same composition, same teeth. A different
index, a base the evidence never measured, another case's expression, an unproven mechanism,
`first()` and `last()` are all still refused, from the archive as from the live file, and
`ai/autocode/archived-evidence-gate.fixture.ts` runs every one of those refusals *from the
archive* so a fix that merely trusted an accepted spec would turn six checks red.

**A code nobody reads is prose.** `orchestrate` now passes `detail.code` into
`classifyRecordedFailure`, which branches on the code rather than the status string —
otherwise the four collection codes collapsed back into one class the moment they reached
the record. `RECORDED_UNKNOWN_FIXTURE` and `RECORDED_ENVIRONMENT_FAILURE` are new;
metrics schema 10 → 11.

**A globalSetup fault is not a spec defect.** Run mode orders `globalSetup` *before* the
load task, so a locked workbook or an unreadable data-driven contract lands in `errors[]`
before a single spec is read — and `Cannot find module` from `global-setup.ts` matches the
compile pattern exactly, which would have quarantined and retracted the *spec* for an
environment fault. `classifyCollectionError` compares the error's own location against the
spec under test and returns `GLOBAL_SETUP_FAILURE` when they differ.

**Known and not fixed here:** every `gate()` run executes `globalSetup` twice, which
unconditionally deletes `ai/reports/healing/` and `test-results-excel/allure-results` —
`runOne` isolates only `EXCEL_STEPS_DIR`, and both other paths are hardcoded. That breaks
the "each run keeps its own copy" invariant and the fix mirrors `EXCEL_STEPS_DIR`.

`npx tsx ai/autocode/locator-validation.fixture.ts` — 114 offline checks. Case C of the
component coverage (one checkbox through click, check, uncheck and both assertion
polarities, twice over) is part K of `assertion-provenance.fixture.ts`, where the stub
DOM and the real recorder live.

### Autocode: specs written without being asked

`ai/autocode/` closes the last manual step. A saved case that cannot run as a data-driven row
gets a spec written for it by a headless Claude Code, triggered by the dashboard (save, upload)
and by `npm run excel:autocode:watch` on `excel/` — so editing the workbook in Excel or dropping
a bulk file in works too.

```bash
npm run excel:autocode -- <wb> --dry-run        # what needs code and why, generate nothing
npm run excel:autocode -- <wb> --ids TC_X,TC_Y
npm run excel:autocode:watch                    # the no-intervention mode
npm run excel:verify                            # the same gate, over hand-written specs
npm run excel:verify -- --ids TC_X --file <spec>
```

`excel:verify` points the falsification gate at specs **nobody generated**, which was the larger
and less-examined half of the suite. It reports three outcomes and never conflates them: only
`SUSPECT` (passed with every assertion broken) is a finding and the only one that exits non-zero;
`skipped` never ran, and `red` is already shouting. Unlike the orchestrator it **never moves a
file** — quarantining what an agent wrote is fair, relocating someone's own spec on a heuristic
is not. It skips data-driven runners, found via the same `@data-driven-module:` marker
`runnerFor` uses: their per-case titles are built at run time, so the gate would look for a title
that appears in no source and report eleven honest rows as suspect.

Its first run found two real defects in hand-written specs, which is the argument for it:
TC_LOGIN_004 asserted on `getByText(/reset|recover|forgot/i).first()`, which matched the sign-in
form's *own* "Forgot Password?" link on its way out — at the instant the spec asserted,
`toBeVisible` **and** `toBeHidden` both passed. TC_LOGIN_007 was not mutated at all, because the
gate had no rule for `toMatch`, nor any rule that could falsify a `.not.` assertion (a pattern
nothing matches leaves `.not.` passing — it has to be widened to one that matches everything).

**A generated spec is not trusted because it is green.** It is run twice — once as written, and
once with its assertions mechanically broken (`ai/autocode/verify.ts`). It is kept only if it
passes the first and **fails** the second. One that passes both ways is checking nothing, which
is precisely the failure that is invisible in every report because it looks like coverage; it
goes to `ai/autocode/quarantine/` (outside `tests-e2e/`, so Playwright never collects it) and is
never registered. Status is set to `Generated`, never `Automated` — that is still earned by a
green run of the real suite. Nothing is committed.

Five things here that are load-bearing:

- **The mutations are applied in one pass.** Applied in sequence they undid each other —
  `toBeVisible` became `toBeHidden` and the next rule turned it back — so the "mutated" run was
  byte-identical, passed, and the gate rejected every honest test. A single left-to-right scan
  never revisits replaced text.
- **The model and the browser are both pinned, not inherited.** `AUTOCODE_MODEL` defaults to
  `claude-sonnet-5` (the full ID, not the floating `sonnet` alias) and the resolved value is
  written into `state.json` and the log heading, so a weak batch can be explained afterwards.
  It is deliberately **not** part of the fingerprint: folding it in would mark every accepted
  spec stale the first time anyone set the variable.

  The browser is **`playwright-cli`, always**, driven through `ai/autocode/browse.mjs`. There is
  no switch and no MCP alternative. Note this is the *authoring* browser only — running the suite
  never involved MCP, and a generated spec is an ordinary `@playwright/test` file with no MCP
  dependency at runtime, which is why CI needs no agent and no server.

- **The generator's allow-list lives in `browse.mjs`, because a shell grant cannot hold it.**
  `Bash(node ai/autocode/browse.mjs:*)` is the agent's only command; `Bash` unqualified is never
  granted. The wrapper refuses `run-code` (it receives Playwright's `page`, i.e. browser-level
  control — `eval` stays allowed, since that is only the page's own JS context), `upload`/`drop`
  (reading this disk into a page), `attach` and the profile flags (a browser this machine is
  already signed into), and `state-save`/`state-load` (credentials). It pins the session name so a
  run cannot reach a browser it did not open.

  **This is looser than what it replaced, deliberately and on request.** The MCP server allowed
  the thirteen browser tools to be named individually *and* `Bash` to be denied outright. Neither
  is possible here: a scoped Bash pattern matches any subcommand, and denying `Bash` outranks the
  scoped grant and would leave the agent with no browser at all. So there is no second,
  contradicting list — containment is one narrow grant plus what the wrapper refuses. If that ever
  needs tightening, tighten `browse.mjs`; do not add `Bash` to the deny list.

  The verification is still run afterwards by deterministic code, because a generator that grades
  its own work grades it generously.
- **`claude` is resolved to a real binary** (`resolveClaude`). `spawn('claude')` is ENOENT on
  Windows — what is on PATH is a `.cmd` shim — and the fix is *not* `shell: true`, because that
  would put a prompt built from spreadsheet text through a command interpreter. Override with
  `CLAUDE_CLI`.
- **Three fingerprints, three questions** (`work.ts`). `fingerprint()` is what invalidates a
  spec: everything authored that can change what gets generated, now including Test Type,
  Environment, User Role and Authentication Profile. `authoringFingerprint()` adds the governance
  fields (Requirement ID, Business Risk, Test Owner) for change detection **only** — filling in a
  Jira number must not regenerate a passing test. `recordingFingerprint()` covers exactly what a
  recording is evidence for: steps, expected result, preconditions, test data, environment, user
  role, authentication profile. Tags stay in the spec fingerprint because they are not decoration
  — `context.ts` scores knowledge with them and `isRecordedTags` picks the whole pipeline.
- **The attempt budget is keyed to the row AND the framework** (`budgetExhausted`,
  `frameworkFingerprint` in `work.ts`). `MAX_ATTEMPTS` exists to stop a row nobody can automate
  from looping forever; it used to also stop a row that a *framework defect* had failed, and
  keep stopping it after the defect was fixed. TC_LOGIN_041/042/043 spent their attempts on a
  click the application swallowed, and stayed skipped through the fix for exactly that
  (P0.8) with "edit the row to try again" — a row that had nothing wrong with it. The
  fingerprint hashes what decides a spec's CONTENT: `from-recording.ts`, `locator-quality.ts`,
  `dom-evidence.ts`, `context.ts`, every `tests-e2e/pages/*.ts`, and the metrics `SCHEMA`. It
  deliberately excludes anything the pipeline writes (state, mapping, workbook, generated specs,
  reports), the recorder and `verify.ts` — including any of those would move the fingerprint on
  every run, which is the same as having no budget. Line endings are normalised, a missing file
  hashes as a named absence, and an entry written before P0.11 carries no fingerprint, which
  reopens it exactly once. Either half changing grants a fresh budget, so a reopened case gets
  its own `MAX_ATTEMPTS` rather than one last try.
- **Rows that cannot be automated as written are never sent to it.** No expected result, no
  steps, ambiguous wording, a duplicate, an unreadable data-driven contract — all skipped with a
  reason. An agent asked to automate those would invent acceptance criteria, which is the whole
  thing this toolkit exists to prevent.

Workbook prose reaches the model — it has to, it is the requirement — so treat a spreadsheet
cell as capable of carrying instructions. The containment is everything downstream: one narrowly
scoped command and no general shell, a spec that must survive falsification, nothing committed,
nothing promoted.

### What the generator is shown

The prompt is assembled by `ai/autocode/context.ts`, deterministically, before the
agent starts. It used to open with *"Follow SKILL.md and CLAUDE.md. Read them first"* and
then let the agent find everything else, which cost ~31,200 tokens per case of which 168
were the test case.

**CLAUDE.md is already in the agent's context — never tell it to read this file.** Verified,
not assumed: a headless run with every file tool denied still answers questions about it. The
old instruction bought a second ~8,500-token copy. SKILL.md's *body* is not auto-loaded (same
test returns `NOT_IN_CONTEXT`), but most of it is about running suites and reporting, so the
generation-relevant part lives in `ai/knowledge/brief.md` instead.

```
ai/knowledge/brief.md                    the rules, inlined into every prompt
ai/knowledge/index.ts                    builds the framework index from the framework
ai/knowledge/framework/framework.yaml    the inspectable copy — npm run excel:index
ai/knowledge/page/*.yaml                 what the application looks like (below)
ai/knowledge/page-knowledge.ts           reading, selection, sufficiency
ai/knowledge/yaml.ts                     a reader for the YAML subset those files use
ai/autocode/context.ts                   selection, spec slicing, context budget
```

- **The index is metadata only and is rebuilt every run** (~10 ms), so it cannot go stale the
  way a hand-maintained one would. ~1,050 tokens replaces ~9,300 tokens of Page Object source.
  The agent opens a named file only when it needs an implementation detail.
- **Page Objects are selected by scoring the row against class-name stems, method names and
  purpose lines.** `base.page.ts` travels only with a chosen Page Object, because `resolve()`
  lives there. Nothing forbids a `Grep` — the point is to remove the need to start with one.
- **The existing spec is sliced, never sent whole.** The module-level header (imports *and*
  file-level constants — TC_LOGIN_025's language table is one) plus the one test being
  rewritten, or the shortest existing test as a pattern. Specs wrap tests in
  `test.describe(...)`, so **test detection must be indentation-aware**: matching `test(` at
  column zero finds the describe, calls it the file's only test, and yields an excerpt that is
  the entire file.
- **Test-case IDs are not indexed here.** `ai/test-mapping/mapping.json` already is that index;
  a second one would drift.
- **The context budget measures, it never gates.** Default 15,000 tokens of prompt plus directed
  reads (`AUTOCODE_CONTEXT_BUDGET`); over-budget logs a note and is recorded, and the case still
  generates. A big row is a reason to look at the row.

Measured: 30,557 → 10,921 tokens mean across TC_LOGIN_022/023/024/025 (−64%), and the same
scenario regenerated and passed the unchanged gate in 180 s against 265 s.

### Page knowledge — explore once, reuse many times

`ai/knowledge/page/*.yaml` is where an exploration is *kept*. Before this, the generator opened
Bugasura and read the same sign-in page again for every row; the picker cost a browser session
five times over. The knowledge is inlined into the prompt and the generator is told whether it
still needs a browser.

- **Semantics only — never a snapshot ref.** `role`, `accessible_name`, `label`, `test_id`, and
  above all the Page Object method that already wraps the element. `e17`/`f35e11` are
  per-session and would be wrong next time. Not a DOM dump, not an accessibility-tree dump, not
  a copy of Page Object source: `references:` points at the snapshot instead of embedding it.
- **Sufficiency is conservative: uncertainty means explore.** Certainly covered → `sufficient`;
  anything uncertain or uncovered → `partial`, with the prompt scoping exploration to *those
  terms only*; no file for the screen → `none`. Matching is whole-word (substring matching is
  what made `project` match `projection`) across, in order: structured fields, Page Object
  method names, a `synonyms:` map the knowledge file declares itself, the rest of the YAML body,
  and a short fixed list of inflections. A match found **only in a comment** counts as
  *uncertain*, not covered.
- **`-ion` and friends are deliberately not inflection rules.** `projection` is not `project`,
  `selection` is not `select`, `agreement` is not `agree`. `-bility`/`-ble` is the one
  nominalisation allowed, because it is closed and regular: "verify visibility" and "asserted
  VISIBLE" are the same requirement. This replaced a five-character prefix that was defended as
  "harmless because the gate still has to pass" — **wrong, and the reasoning was the problem.**
  The gate proves a spec *can fail*, not that it asserts the right thing, so a spec built on a
  false "covered" passes clean, fails mutated and is accepted. That error is undetectable, not
  cheap.
- **`pageKnowledgeHit` is a prediction; `browserExplorations` is the fact.** A hit with
  explorations above zero means the prediction was wrong, and that is surfaced rather than
  hidden. Never claim exploration was avoided from the verdict alone — read the browse metrics.
  Every decision is persisted in `pageKnowledgeDecisions` with its match type and reason, so a
  suppressed browser visit can be audited afterwards.
- **Matching reads the file's raw text, not just the modelled fields.** The `languages:` block
  in `language-picker.yaml` is real verified knowledge that no field of `PageKnowledge` models;
  without the raw text a row asking about Portuguese was called a gap while the answer sat three
  lines away. A knowledge file can grow a section without the reader learning about it first.
- **Knowledge is recorded whether the row succeeds or is declined.** The instruction used to say
  to write it "after the spec passes", so a declined row threw away 417 s of exploration and the
  next attempt paid for the browser again. A declined row is the *expensive* case.
- **One file per screen.** Check for an equivalent before creating one — two files for one screen
  is worse than none. The file name is suggested from the row's *feature or module*, never its
  scenario, because knowledge serves every case on that screen.
- **Never a workaround for a broken Page Object.** If a method is defective, fix or report it;
  do not route around it with a raw locator. Page Object first, always.
- **The prompt goes to the agent on stdin, not as `-p <prompt>`.** Once the brief, the framework
  index, page knowledge and a spec excerpt are all inlined, the prompt reaches ~31,000 characters
  and Windows caps an entire command line at ~32,767 — generation died with `spawn ENAMETOOLONG`.
  `claude -p` with no prompt argument reads stdin, which has no such ceiling.
- **`ai/knowledge/yaml.ts` folds `|` and `>` block scalars before parsing.** It originally
  rejected them as outside its subset, and the first knowledge file a generator wrote used `>`
  for its longer descriptions — the readable, idiomatic choice — which threw and took the whole
  knowledge directory down. An unparseable file is still a hard failure rather than a silent skip
  (silently skipping looks exactly like "no knowledge exists", which sends the agent to explore a
  page it already knew), but the subset must accept what a careful author naturally writes.

### One browser for a group of rows

Page knowledge removes exploration that has already been done. What it cannot remove is the
*first* exploration of a screen, and that used to be charged a browser launch and a sign-in per
row: `ai/autocode/session.ts` charges it once per compatible group instead.

The Playwright CLI could always hold a browser open — the session is a detached daemon keyed by
name, and `browse.mjs` has pinned that name to `autocode` since it was written, so twenty
snapshots inside one case already shared one browser. What was not shared was the browser
*between* cases, because each case is its own headless Claude Code told to `open` first and
`close` last.

Two measured facts shape the design:

- **`open` on a live session destroys it.** The CLI's `startSession` stops the existing daemon
  before starting a new one — watched by the browser pid changing (27444 → 21772) as the page
  reset. So an `open` from the agent does not waste six seconds, it *deletes* the framework's
  signed-in browser, and the agent has no credentials to recover with. That is why `browse.mjs`
  refuses `open`, `close` and `delete-data` while `AUTOCODE_SESSION_MANAGED=1`. Those refusals
  are **additions**; every existing refusal applies in every mode, unchanged.
- **The browser cost is real but bounded**: ~6.5 s to launch, ~13 s to sign in, ~2.5 s to close.
  Measured 4 rows × (launch + sign-in + close) at 96.9 s against 32.1 s shared. The larger
  saving is that the agent no longer spends model turns working out how to sign in — that lands
  in `agentMs`, not here.

**The framework signs in, never the agent.** Credentials come from `tests-e2e/support/env` — the
same module the suite uses, no second secret path — and reach the CLI as one argv element of a
`shell: false` child. They never touch the prompt, the run log, the metrics, the session log,
page knowledge or a spec. The agent is told plainly that it is already signed in and does not
have them. **`.env` is now denied to the agent**, which it was not before: verified by asking a
headless run with the real tool configuration, which answered `READ_OK` before and `READ_DENIED`
after. The deny list is `Read(...)` rules **only** — Claude Code rejects `Grep(.env)` and
`Glob(.env)` at startup ("only Read(path) rules are… Read rules cover all file-reading tools"),
so naming them printed a warning on every generation and protected nothing. One exposure remains
and is not papered over: for the instant a
`fill` runs, the value is a child process's argument and is readable by anything on this machine
that can list command lines. That was equally true when the agent signed itself in.

Storage state was considered and rejected. Signing in with Playwright in-process to save a
`storageState` would introduce a second browser mechanism, and it would put a live session cookie
on disk — the thing `browse.mjs` refuses `state-save` to prevent. The live session *is* the reuse
mechanism, and nothing is written down.

**A group is rows that may share one browser**: same application and environment, same
authentication requirement, same identity, same worksheet. Feature orders rows inside a group
rather than splitting it — splitting on it would put TC_LOGIN_022..025 in four groups of one.

- **The worksheet, not the Module column.** Keying on `module || worksheet` split
  TC_LOGIN_022..025 into two groups, because TC_LOGIN_024 has its Module cell filled and its
  three neighbours on the same sheet testing the same screen leave it blank. Falling back from
  one namespace to another makes two rows "different modules" because somebody typed in a cell.
- **Two authentication questions, not one** (`authRequirement` in `groups.ts`). `testStartsSignedIn`
  governs the generated spec and which screen the row is *about*; `explorationNeedsAuth` governs one
  thing only — whether the framework signs in the browser the agent READS with. They coincided for
  the rows this started with, and came apart on the first plain-English row that signed in on its
  way somewhere else: TC_LOGIN_066 ("Sign in → open Faclon labs → search fac11 → check the status")
  got an anonymous browser, could not reach the screen it was about, and was declined for want of a
  page nothing had given it a way to open. The exploration answer is structural: a signed-in
  **precondition** says yes; otherwise find the last step that *performs* a sign-in — submitting
  one, not naming the screen, because "Open the login page" names it — and ask whether any later
  step **acts**. An action after a sign-in happens on a screen that only exists once signed in;
  steps that merely observe do not count, so "click Sign In, then verify the dashboard" is still a
  login test. `isActionVerb`/`isObserveVerb` come from `ai/knowledge/requirements.ts` rather than a
  second verb list. Measured over all 76 rows: the login rows and the language-picker rows that
  never submit stay anonymous, the 8 rows with a signed-in precondition are authenticated, and 47
  rows that act after signing in get a browser they can read with — while their specs still sign in
  for themselves, which `npm run excel:independence` checks.
- **The exploration account is not necessarily the test account** (`explorationCredentials` in
  `tests-e2e/support/env.ts`). Resolution: `BUGASURA_EXPLORATION_PROFILE=qa-user` →
  `BUGASURA_QA_USER_EMAIL`/`_PASSWORD`, else `BUGASURA_EXPLORATION_USER`/`_PASSWORD`, else the
  suite's own `BUGASURA_EMAIL`/`BUGASURA_PASSWORD` so an existing `.env` needs nothing added. A
  profile is a NAME, so another account can be used without a secret appearing in a command or a
  log. `explorationIdentity()` returns the VARIABLE NAME, never the address — it is what the group
  key, the run log and the metrics carry. Missing credentials are a deterministic
  `SessionUnavailable`, never a question put to the model.
- **Authentication splits a group, and the default is signed out.** A signed-in browser cannot
  explore the sign-in page — Bugasura bounces the base URL to `/apps`. So a group is
  authenticated only when the **preconditions** say the user already is, and any **step** that
  signs in or opens the sign-in page overrides that to signed-out (TC_PROJ_009 reads "Open
  Bugasura and login…" and is correctly signed-out while its eight siblings are not). Test Data
  is deliberately not read: `password = <valid-password>` appears on rows that are *testing* the
  sign-in. Guessing signed-out costs nothing — the agent behaves as it did before; guessing
  signed-in breaks every login row.
- **The session is opened lazily, on the first row that actually needs a browser.** A group whose
  every row is answered by page knowledge launches nothing. Having a session available is not a
  reason to use one.
- **Contamination is detected from the application's answer, not a flag.** The first version
  asked `this.signedIn`, which is set when *this module* signs in and could therefore never see a
  sign-in performed by the agent — the only way it happens in an anonymous group, and it happens
  whenever a valid-login case does the thing it is testing. So a signed-out group is navigated
  back to the base URL between rows and the redirect answers the question. Caught by a test that
  drove a real sign-in and then asked for the next row's session.
- **An expired sign-in is renewed in place**, not by discarding the browser: a fresh browser would
  land on the same sign-in page having cost a launch.
- **A browser that cannot be prepared is not a verdict about the row.** The row is *skipped* with
  an infrastructure reason, nothing is written to `state.json`, and the attempt budget is
  untouched — otherwise an outage would lock a good row out after two runs.
- The session closes in a `finally` at the end of its group. `AUTOCODE_PERSISTENT_SESSION=0`
  shortens the lifetime to **one row**, which is how the before-and-after was measured on
  identical rows. It does *not* switch the framework's sign-in off, and that distinction is
  load-bearing: **denying `.env` makes framework sign-in mandatory, not optional.** The first
  version of the flag omitted the session entirely, and an authenticated row then had no route to
  credentials at all — a benchmark row failed with the agent explaining it could not sign in and
  asking what to do. Only the lifetime may vary.
- **A `partial` verdict opens the browser even if the agent then does not use one.** The verdict
  is the only signal available before the agent starts, and the browser has to exist before it is
  handed over. Inside a group that cost is amortised, which is the point of the phase; for a
  one-row group it can be ~20 s spent on a browser nobody touched.
- **A signed-in handover invites a spec that forgets to sign in, so the prompt says so twice.**
  Two of the five specs written against a handed-over session called `projectsPage.open()` with no
  sign-in at all and sat on the login page — the *generation* browser was authenticated, so the
  agent wrote as if the *test* browser would be too. It is not: a spec runs in a fresh browser.
  The crib now states that explicitly and points at `requireCredentials`. The gate caught both, as
  it should, but a quarantined spec is a wasted generation.

Generation sharing and **test** isolation are separate concerns: generated specs are ordinary
`@playwright/test` files that know nothing about any of this, and the gate runs each one in its
own browser. `npm run excel:independence` is the regression test for that — it reads the generated
specs and fails if a row whose group starts signed in has no sign-in of its own, or if any spec
mentions the generation session (`autocode`, `browse.mjs`, `AUTOCODE_*`). It is deliberately not
part of `verify.ts`: the gate proves one spec can fail, this checks a property of the whole suite.

### One screen, one knowledge file, named after its route

`ai/knowledge/canonical.ts` gives every screen a derived identity — `bugasura__apps` from the
application and the route — and the knowledge file is named after it. The file name used to be a
*suggestion* built from the row's feature, which is how one run wrote `dashboard.yaml` and the next
wrote `dashboard-tabs.yaml` for the same screen: the second agent could not see the first file, so
it re-explored and the two drifted.

Derivation order, most stable first: declared **route** (with the application, so one identity
cannot mean two things in two environments) → the file's explicit `page.id` → a Page Object class
name. Duplicate detection is a map lookup on that identity, rebuilt from the directory every run —
not a model reading the files and forming an opinion. The prompt carries the index (identity,
route, file, size) plus "this row's screen is X and its file EXISTS — edit it".

**Applying the rule collapsed four files into two, and that was the rule working.** `login.yaml`
and `language-picker.yaml` both declared `route: /`; `create-project.yaml` and
`dashboard-tabs.yaml` both declared `/apps` — and both of the latter had independently written down
the same fact, that `WorkspacePage.sectionHeader()` reads "All Projects" on arrival. Two files for
one screen costs exactly that. The dialogs are a stack *on* /apps, not a route of their own, so
they belong in its file.

- **Which selected file is "this row's screen" is decided by the auth requirement, not by score.**
  TC_PROJ_005 ("enter three spaces as the project name") scored the sign-in page above /apps,
  because words like "spaces" and "three" appear in its prose — so knowledge written for that row
  would have landed on the wrong screen's file. A signed-in row is not on the sign-in page.
- **Knowledge selection needs a relative floor as well as an absolute one.** Consolidated files are
  bigger, and a bigger file wins incidental hits: the /apps file scored 4–7 on the *login* rows on
  generic vocabulary alone ("option", "text", "email"), against 8–12 for the sign-in file. Both
  cleared the old floor of 3, so three rows carried a 2,955-token file about a screen they never
  touch and went over the context budget. Anything below 60 % of the best match is now dropped.

### A requirement is a phrase that names something, not every word over three characters

`ai/knowledge/requirements.ts` decides what a row requires of a screen, and it replaced the
extractor that made `assessBrowserNeed` necessary in the first place. The old one was `terms()`:
every word longer than three characters that was not in a 69-word stop-list. **Twenty of those
stop-words were the UI vocabulary** — `button`, `field`, `click`, `displayed`, `select`, `page` — so
"Check the Create Project button is displayed" contributed `create` and `project` and threw away the
two words that made it a claim about a screen. The filter removed the signal and kept the noise, and
an unaccounted-for "requirement" opens a browser.

Measured before the change: of the 8 gap terms that had ever opened a browser, **6 named nothing on
any screen**, and **4 of the 5 launches** were caused by them. `terms()` still exists and is still
used by `selectPageKnowledge` — choosing which files are relevant is a recall problem where a loose
match costs a little context; deciding to open a browser is a precision problem where it costs a
browser and a wrong assumption.

- **Three of those four launches were caused by prose this toolkit generates.** `recorder.ts` writes
  the literal Expected Result "Needs confirmation" when a recording contains no assertion, and titles
  an unnamed recording "Recorded interaction" — and the pipeline read its own placeholders as facts to
  verify about the application. The wordings live in `ai/dashboard/placeholders.ts` precisely because
  two modules need the same string: `recorder.ts` writes them (and re-exports them, so its API is
  unchanged) and the classifier recognises them. A second copy would drift silently, and the failure
  would look exactly like a requirement.
- **The field decides what text is allowed to mean.** Steps yield actions and their targets; Expected
  Result yields observable claims and business assertions; **Scenario yields nothing** — it is a title,
  derived for a recorded row, and TC_LOGIN_028's entire gap set (`strong`, `needs`, `confirmation`)
  came from a cell reading `Strong`. It still reaches the agent and still scores knowledge selection;
  it just cannot send anybody to a browser. Test Data and preconditions were never sources.
- **Generic prose is DROPPED, never marked covered, and never added to `NON_INSPECTABLE`.** Those are
  different outcomes: a false "covered" suppresses the exploration that would have corrected a wrong
  assumption, and the falsification gate cannot catch it (it proves a spec *can* fail, not that it
  asserts the right thing). A dropped word makes no claim about the screen at all. `NON_INSPECTABLE`
  stays a backstop and must still never contain a noun naming UI.
- **A data verb's object is a value, not an element.** `enter`, `type`, `fill`, `search` produce a
  requirement only when the clause also names the field the value goes into. Treating them like
  `click` made `email address` an unanswered requirement on eight rows and sent every one to a
  browser — the same class of false positive as `needs`, by a different route. "Password is too
  short" is a business assertion; "the password field shows an error when it is too short" is a
  screen fact.
- **Quoted and Capitalised spans are masked before any splitting**, so `Terms and Conditions` cannot
  be cut in half by the ` and ` rule, and they are never edge-trimmed — "Sign In" trimmed to `sign`
  matches nothing. The leading imperative *and* the connector after it are stripped from the span,
  or "Click the Sign In button" masks as `the Sign In`.
- **The span pattern must not cross a newline.** Steps arrive newline-separated, and `\s` fused
  "Bugasura" + "Click" into one span — swallowing the step boundary and hiding the imperative inside
  it, so the clause had no verb and produced `header` instead of `notifications bell`. A masked verb
  is an invisible one.
- **Separators become a space, never nothing.** Deleting them fused `visibility_off` into
  `visibilityoff`, a token that exists in no knowledge file and no test case — invented by the
  tokeniser, and it opened a browser. This was the only change that *added* exploration, and what
  caught it was the invariant below.
- **The invariant: a phrase can only be a gap if one of its words was already a gap.** So the rows
  that open a browser are a strict subset of the rows that used to. `ai/knowledge/requirements.fixture.ts`
  asserts it per row over the whole workbook and recomputes the old decision with the *real* old
  extractor and matcher rather than approximating it. It also asserts that `notifications bell` still
  opens one: fewer browsers is not the goal, and a row that gains a browser is a regression while a
  genuine UI unknown that stops opening one is a defect.
- **Words of three characters or fewer are not judged** when the phrase has longer words to judge
  instead — the old filter never made a claim about them, so treating one as unanswered would add
  exploration. A phrase that is *only* short words is still judged, because `tab` and `row` are real.
  `MARKUP_TOKENS` drops `div`, `span`, `td` and friends: Codegen falls back to a tag name when an
  element has no accessible name, and no browser visit can resolve the absence of a name.

Measured over the real workbook: requirement terms 354 → 128, rows whose gaps would open a browser
31 → 7, 0 rows gained one. On one live regenerated row (TC_LOGIN_028): verdict `partial` → `sufficient`,
browser opened yes → no, 46.6 s → 36.4 s, and the same declined verdict for the same honest reason —
`agentMs` was unchanged, because what this removed is a browser, not model time.

### A browser is opened for what the row needs, not for the verdict

`assessBrowserNeed` is a second, deterministic look at a `partial` verdict: if every missing term
is a word that cannot name anything on a screen — a relation, a moment, a manner, a generic state —
then the knowledge really is enough and no browser is opened. `NON_INSPECTABLE` is the closed list,
and it contains **no nouns naming UI**: `strip` was considered and rejected, because a tab strip is
something somebody could genuinely inspect.

This is a false-negative risk and is bounded as one: the verdict stays `partial`, so the prompt
still names the unverified terms; the agent is told plainly that it has no browser and that
**declining is the correct move if it disagrees**; and every dismissal is recorded in the metrics
with its reason. `browse.mjs`'s managed refusals are switched on even when nothing was handed over,
so an attempt to open a browser anyway is refused and *counted* — a wrong dismissal shows up as
`browseRefused`, not as a silently guessed selector.

Measured on the real workbook: the mechanism fires on **0** of 34 rows there, because those gaps
are domain prose (`registered`, `mandatory`, `submission`) rather than prepositions. It fires on
all three Phase 4 benchmark rows, whose gaps were `marked`, `fragment` and `accepts` — the rows
that had cost three browser launches and three sign-ins. The honest reading is that the requirement
*extractor* is the deeper problem: it takes every word over three characters, so most "gaps" were
never requirements. Replacing it is a bigger change than this phase.

### The session checkpoint

Before a reused browser is handed to the next case it is taken back to the expected URL, and then
asked: is it alive, is the sign-in still there (or wrongly there), and is any declared overlay
showing? Overlays are declared by the knowledge files themselves (`overlays:` with a `selector` and
a `close_selector`), so what counts as blocking UI grows with what has been explored rather than
with a list in the session module. Nothing else is ever clicked.

- **The navigation is the reset for anything left in the DOM.** A modal a previous case left open
  does not survive a page load, so the overlay check is really for overlays the *application*
  raises on arrival — which is exactly why `ProjectsPage.dismissOnboardingModal()` exists.
- **An overlay with no declared `close_selector` is unrecoverable**, so the session is discarded
  rather than experimented on. Verified live.
- The checkpoint costs ~5–7 s per reused row (it was ~1.5 s in Phase 4, which skipped the
  navigation for authenticated groups). Against ~22 s for a launch plus sign-in, that is still the
  right trade, and it buys every row the same known starting screen.
- **`open` is retried once.** The CLI stops whatever session is registered before starting a new
  one, so a daemon that died without deregistering makes the first `open` fail — observed once
  after a killed run, and it cost a whole group its browser.

### Generation metrics

Every run and every attempt is persisted as NDJSON, because the numbers used to exist only in
memory: `durationMs` was computed on each outcome and dropped, and the first performance baseline
had to be reconstructed by subtracting `state.json` from a markdown heading.

```
ai/reports/generation-metrics.jsonl   one line per run (kind: "run"), one per attempt
ai/reports/generation-browse.jsonl    one line per browser command
ai/reports/generation-performance.md  the written-up baseline
```

`ai/autocode/metrics.ts` owns the shape; `readAll()` reads it back. Append-only, so a killed run
cannot corrupt earlier records and a benchmark series is just the file. **Blocked and crashed runs
are recorded too** — a save silently dropped because another run held the lock is exactly the
event a benchmark must not omit.

Four things worth knowing:

- **The browse log records the subcommand and an argument *count*, never the arguments.**
  `fill e5 "<password>"` must not become a credential sitting in a report, and a URL or search
  string is workbook prose. Attribution is by `AUTOCODE_RUN_ID` / `AUTOCODE_CASE_ID` stamped into
  the environment, not by timestamp window — `browse.mjs` is a grandchild process and correlating
  on time would mis-attribute anything that overlapped.
- **Unmeasurable fields are explicit `null`, never omitted or estimated.** `authMs`,
  `repoDiscoveryMs`, `generationMs` and the `modelInputTokens` family are all null: sign-in is a
  fill/click sequence indistinguishable from any other, and `Read`/`Grep` happen inside the agent
  process where nothing outside can see them. A reader can tell "not measured" from "zero", and
  `agentNonBrowserMs` is offered as the honest upper bound instead of a fabricated split.
- **Real token usage needs `--output-format json`**, which would replace the plaintext log the
  dashboard streams live. So `promptChars` (exact — it is our own string) and the sizes of the
  documents the prompt mandates are recorded instead, and the model's own usage stays null.
- **`classifyOutcome` reuses `classifyRootCause`** from `ai/excel/results.ts` for the one case
  that is a test failure — the clean run going red — and adds only the generator axis that
  function has never seen: timed out, declined, wrote nothing, refused by the gate. Gate refusals
  are matched first, because their wording contains assertion words that would otherwise read as
  an assertion mismatch.

Measured once the instrumentation existed: the gate's **mutated run costs about twice the clean
run** (42.4 s against 21.8 s for TC_LOGIN_022) because every broken assertion waits out the full
expect timeout before failing. `--max-failures=1` cannot help — `runOne` already runs exactly one
test via `--grep` — but lowering the expect timeout for the mutated run only would, and it is safe
there precisely because that run is required to fail.
