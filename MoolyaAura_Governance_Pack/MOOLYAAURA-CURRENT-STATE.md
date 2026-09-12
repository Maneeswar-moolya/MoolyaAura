# MoolyaAura Current Engineering State

**Observed: 2026-09-12.** Every number here is a measurement taken on that date against the
working tree at `C:\Users\Maneeswar\ClientProjects\MoolyaAura\MoolyaAura`, branch `develop`.

## Latest state: old project cleanup, 2026-09-12

The production registry is empty. Bugasura, Flipkart and demoapp application artifacts and
obsolete credentials/configuration have been removed; Keysight has not been added. Generic
framework contracts and multi-project capabilities remain. Application artifacts in older
sections below are historical observations, not files to restore or current installed data.

Verification: 13/13 post-cleanup focused fixtures; 20 source mutants killed; one complete
full sweep 79/80 in 728.93 seconds. The only failure was a missing elementRef/captureRef
explanation in the shortened AI guide. Documentation restored; locator-validation follow-up
passed (exit 0). No second full sweep. A partial sweep had been stopped for a prompt helper
correction before the complete sweep. No repository files changed during the full sweep.

See [cleanup report](../docs/history/OLD-PROJECT-CLEANUP.md) and status_version 44 in
[REMAINING.md](../docs/history/REMAINING.md). The sections below predate cleanup.

## 1. Purpose of this document

This is a **point-in-time engineering handoff**, written so another coding agent can open this
repository and continue without depending on any prior conversation history.

**It is not governance.** The four `MOOLYAAURA-*` contracts in this directory are the authority;
this file is a snapshot beside them. Everything here is expected to go stale — counts, timings,
defects, the git state. Where this document and the repository disagree, **the repository wins**,
and the correct response is to re-measure rather than to trust the number written here.

Nothing in this file should be promoted into governance unless it turns out to be a reusable
architectural rule, in which case it belongs in the contract that owns that subject.

## 2. Product purpose

MoolyaAura turns recorded user intent and authored spreadsheet test cases into maintainable
Playwright TypeScript automation, for more than one application at a time, using deterministic
locator intelligence, reusable Page Object capabilities, per-application knowledge, runtime
measurement and a deliberately small amount of AI.

Two entry points exist today and share the same downstream pipeline:

- **Excel-sourced test cases** — a workbook drives selection, generation, execution and
  write-back of results (`ai/excel/`, `npm run excel:*`). Rows that declare their own assertion
  (`Assert Outcome`) execute with no spec written at all.
- **Recording** — a browser session captured through the local dashboard, with evidence measured
  at the moment of each interaction (`ai/dashboard/`), which the deterministic mapper then turns
  into a spec (`ai/autocode/from-recording.ts`).

The framework is deterministic-first. AI is a last-mile mechanism at two points only (§7).

## 3. Current architecture

Layers, in the order work flows through them:

| Layer | Where | What it owns |
| --- | --- | --- |
| Application scope | `ai/projects/` | Registry, `applicationId`, scoped artifact paths, provisioning, fixture isolation |
| Recording | `ai/dashboard/recorder.ts`, `live-recorder.ts` | Codegen + live capture, press-time measurement, assertion picking, recording origin |
| Evidence | `ai/autocode/dom-evidence.ts` | Bounded target snapshot, candidate generation, strategy contract, identity predicates |
| Knowledge | `ai/knowledge/` | Per-page YAML, canonical page identity, requirement extraction, framework knowledge |
| Locator intelligence | `ai/autocode/locator-quality.ts`, `abstraction/classify.ts` | Scoring, ranking, effective locator, positional recovery |
| Abstraction | `ai/autocode/abstraction/` | Proposals, validation, semantic resolver, Page Object writer, lifecycle ledger |
| Generation | `ai/autocode/agent.ts`, `orchestrate.ts` | Spec generation, context selection, browser handover, metrics |
| Validation | `ai/autocode/verify.ts`, `independence.ts` | Falsification gate, static check, self-authenticating specs |
| Execution | `playwright.excel.config.ts`, `tests-e2e/` | Run, capture, per-run artifact retention |
| Reporting | `ai/excel/results.ts`, `execution-report.ts`, `html-report.ts` | Root-cause classification, reports, workbook write-back |

The high-level flow matches the Architecture contract and is implemented end to end:

```
recording → application/project context → evidence → knowledge / Page Objects
  → candidate generation → runtime measurement → identity → safety / provenance
  → ranking / reuse → generation → execution → results / history
```

Two components worth naming because they are easy to miss:

- **`ai/autocode/abstraction/lifecycle.ts`** — every element that needed a Page Object ends at
  exactly one of six terminal dispositions. "Nobody looked" is not one of the values, which is
  what stopped a coverage hole from being indistinguishable from a considered refusal.
- **`ai/dashboard/`** is a loopback-only control panel (recording, authoring, generation,
  execution, per-run artifacts). It is not a deployment and has no authentication (§14).

## 4. Current application-scope architecture

**Implemented and load-bearing.** `applicationId` is declared in `ai/projects/registry.json`,
never derived from a URL, and validated as an immutable lowercase slug with a reserved-name list.

Three applications are registered today: `bugasura`, `demoapp`, `flipkart`.

`ai/projects/scope.ts` resolves an `ApplicationScope` carrying `applicationId`, `environmentId`,
`baseUrl`, credential **variable names** (never values), and `ScopePaths` — `pagesDir`,
`knowledgePageDir`, `recordingsDir`, `generatedDir`, `mappingFile`, `fixturesFile`.

- `SHARED_CAPABILITIES` and `APPLICATION_ARTEFACTS` are written-down lists, not inferred.
- **There is no cross-application fallback.** A miss inside the active scope is a miss.
- **One migration affordance exists**: `legacyLayout: true` on at most one application declares
  who owns the unscoped directories. Bugasura holds it today. `layoutFor` prefers
  `<dir>/<applicationId>/` and falls back to flat only for that declared owner; a second
  application resolving to a missing scoped path gets a miss, never somebody else's artifact.
  Recordings have already migrated to scoped directories; Page Objects, knowledge, generated
  specs, the mapping and the fixtures module have not.
- `activeScope()` answers the *ambient* question — "which application does a caller that predates
  the scope layer mean?" — as the declared flat-layout owner. `resolveScope({})` still refuses the
  explicit question when more than one application is registered.
- **Collection isolation**: `tests-e2e/support/collection-scope.ts` ignores other applications'
  generated directories at Playwright collection time, because a Test Case ID is deliberately
  reusable across applications and `--grep TC_LOGIN_001` would otherwise run two tests and
  misattribute one verdict.
- **Fixture module per application**: `ScopePaths.fixturesFile`, because fixture names derive from
  class names and two applications registering `loginPage` in one file would silently hand every
  spec the first application's class.
- **Application-aware validation**: `ai/autocode/locator-validation.fixture.ts` (section E20)
  groups generated specs by owning application and validates each under its own scope.
- **Provisioning** (`ai/projects/provision.ts`) is a two-effect transaction — one workbook, one
  registry entry — validated first, registry written last and atomically, with rollback that
  deletes only the workbook that call created.

## 5. Current locator architecture

**Candidate families** (`CandidateFamily`): `identifier`, `content`, `container`, `structural`,
`semantic`, `semantic-scoped`, `attribute`.

**Strategy contract** — `STRATEGY_CONTRACT` in `ai/autocode/dom-evidence.ts` declares, for every
strategy the framework emits: `family`, `measuredBy` (`page` | `expression`), `budget`
(`structural-cap` | `family-budget` | `unbudgeted`), `scoreable`, `rebuildable`. 35 entries
declared; the four `NOT_YET_EMITTED` reserved names are written down as such so a genuinely dead
entry cannot hide among them. `ai/autocode/strategy-contract.fixture.ts` runs the real generators
and fails, naming the strategy, when an emission site forgets its declaration — it exists because
all three failure modes (unmapped family dropped by budget, unscoreable expression ranking last,
unrebuildable expression never provable) are silent.

**Runtime measurement** — candidates are counted in the page (`__auraMeasure`) or rebuilt on the
Node side (`buildLocator`), at the moment of the interaction.

**Exact target identity** — `provesIdentity(candidate, role)` in `dom-evidence.ts` is the single
bar: exactly one match, in the interaction's own document, and that element is the one acted on.
Timing is part of the bar and is not interchangeable — an **action** may only be proven at
`press`; an **assertion** at `press` or at `pick`. `matchCount === 1` is never sufficient alone.
`provenMeasurements()` is the one reader that gathers every proving measurement across all four
evidence lists.

**Ranking** (`rankProvenCandidates` in `abstraction/classify.ts`), in order: highest *weakest*
segment score → fewer chain segments → exact before its loose twin → shorter expression →
generation order. Stability and durability are **not** ranking inputs. An unscoreable expression
sorts last rather than being dropped.

**Positional safety** — `.first()`, `.last()`, XPath, `force`, mouse coordinates,
`dispatchEvent`, sleeps and retries are refused outright (`abstraction/validate.ts`). `.nth()` is
admitted only where `positionWithinCandidate` was measured at the interaction and lies inside the
measured match list. Nothing is stripped from a chain to make it pass.

**Page Object reuse** — see §6.

**Adopted from experiments, and what was not.** Exact and non-exact role+name twins are both
generated, the loose twin emitted last within its family and kept behind its exact one in
ranking; measured over 1,231 archived ranked lists, **0 differed**, so no selection made today
moved. Candidate durability and accessible-name stability are measured and recorded; **neither
became a ranking rule.**

## 6. Current Page Object / knowledge lifecycle

**Reuse before creation, and reuse is a measurement.** `existingCapability()` in
`abstraction/propose.ts` credits an existing capability with the recorded element only where:

- the recorder measured that capability's own declared locator against the element at the
  interaction (the measurement carries `capability: {owner, method}`), **or** an ordinary
  candidate with a byte-equal expression proved identity; or
- for a parameterised proposal, the declared template equals the proposed one and something was
  proven at the interaction;

**and** the knowledge entry names a method that really exists on its class, **and** exactly one
capability qualifies. More than one claimant returns null — two claimants are no claimant.
Selector-token overlap is no longer a basis and the token helpers are no longer imported there.

**Lifecycle states**: a screen is UNKNOWN until a recording establishes it, BOOTSTRAPPED when a
first recording establishes ownership plus one proven capability, ESTABLISHED as later recordings
add proven capabilities to the same screen.

**Append-safe, verified after the fact.** `postWriteVerification()` in `abstraction/writer.ts`
compares a pre-write byte snapshot: every previously declared capability still declares the same
locator, no file outside the intended set changed, nothing was removed. Failure rolls the whole
set back — edited files from backup, created files deleted.

**Transactional** — knowledge entry, Page Object method and fixture registration for one
capability are applied together or not at all. **Idempotent** — re-processing a recording produces
the same artifacts rather than duplicates. **Never an overwrite** — a bootstrap knowledge file
already at the target path is appended to, not replaced.

**Superseding evidence is observed, never applied.** `alternativeEvidenceFor()` records one line
per *distinct* alternative to `ai/reports/abstraction-alternatives.jsonl` when a recording proves
an expression different from what knowledge declares for the capability it resolved to. It refuses
in every ambiguous direction (no declared expression, prose-only declaration, a parameterised
template legitimately instantiated, a mere quoting difference). Nothing is auto-applied.

**New application bootstrap** — a Page Object written into a scoped application directory computes
its `BasePage` and healing-recorder import specifiers from its own location to the framework's real
location, anchored on the fixtures module's directory. The legacy flat layout emits byte-identical
strings. `tests-e2e/support/base-fixtures.ts` holds the application-independent fixture wiring so a
newly provisioned application can write its first Page Object at all.

## 7. Current AI usage

**Exactly two invocation points. Both spawn the Claude Code CLI as a child process.**

| | Spec generation | Semantic resolver |
| --- | --- | --- |
| File | `ai/autocode/agent.ts` | `ai/autocode/abstraction/semantic.ts` |
| Transport | `spawn(resolveClaude(), …)`, `shell: false`, prompt on stdin | same |
| Model | `DEFAULT_MODEL = 'claude-sonnet-5'`, pinned; `AUTOCODE_MODEL` overrides | same resolver |
| Tools | `Read Write Edit Glob Grep` + `Bash(node ai/autocode/browse.mjs:*)` only, `--permission-mode acceptEdits`, `--add-dir <repo root>` | **none at all**, every tool disallowed |
| Purpose | Write one spec; explore an unknown screen once and leave knowledge behind | Answer one semantic question from a closed list |

- **`--strict-mcp-config`** on both, so a user's own MCP servers cannot enter an unattended run.
- **Closed question list** (`SEMANTIC_ENABLED`): `AMBIGUOUS_OWNERSHIP`, `NO_METHOD_NAME`,
  `CONSTANT_PARAMETER_VALUE`, `TEXT_ONLY_IDENTITY`, `UNCLASSIFIED_TARGET`,
  `CONTAINER_OR_CAPABILITY`, `AMBIGUOUS_NAME`. `SINGLE_TARGET` is deliberately excluded — it is a
  claim about sample size, not meaning.
- **The resolver is a post-pass, not a stage.** `analyseCorpus()` is synchronous and contains no
  model call; the deterministic answer exists in full before anything is asked. `revalidate()`
  clears exactly the one refusal that was asked about and re-runs every other rule.
- **The locator is never the model's.** `templateFor` builds the expression from the measured one;
  a returned locator is a consistency check and nothing else.
- **Terminal decline** — a validated decline ends the exchange when every still-unanswered question
  is one whose answer is the decision (`DECIDABLE_BY_DECISION`). A timeout is never terminal; an
  outage leaves the proposal exactly as the deterministic engine produced it.
- **Attempt budget** — `MAX_RESOLVER_ATTEMPTS = 3`; a spent budget records a structural
  `RESOLVER_EXHAUSTED` refusal rather than a verdict.

**Is there an `AIProvider` abstraction?** **Partially, and only inside the resolver.**
`export type Transport = (prompt: string, model: string) => Promise<string>` in `semantic.ts` is a
real seam — fixtures substitute it — but `claudeTransport()` is the only implementation, and
`agent.ts` has no equivalent seam at all: it builds Claude-CLI argv inline. There is no provider
registry, no provider selection, no capability negotiation, no shared prompt/response contract.

**Is GitHub Copilot integrated?** **No.** There is no Copilot code, dependency or configuration
anywhere in the framework. The only occurrences of "Copilot" in the repository are in the root
`README.md`, which is the **upstream Playwright MCP** README (regenerated by `npm run lint`) and
documents how to register the Playwright MCP server with the Copilot CLI. It is unrelated to
MoolyaAura's AI path.

**Dependencies**: `package.json` declares no Anthropic SDK, no OpenAI SDK, no LLM client of any
kind. The dependency on Claude is the CLI binary found at run time by `resolveClaude()`.

## 8. GitHub Copilot target direction

**Planned. Not implemented. Nothing below exists in code today.**

The intended Keysight production direction is:

```
MoolyaAura deterministic framework → AI provider abstraction → GitHub Copilot provider
  → AI suggestion → deterministic MoolyaAura validation
  → identity / safety / ranking / reuse / generation
```

The constraints that make this safe are already governance and must not be relaxed to make an
integration fit:

- The MoolyaAura core stays **provider-agnostic**. A provider is a transport plus a prompt/response
  contract; it is never a decision-maker.
- **GitHub Copilot must never become the source of locator truth.** Copilot output is a suggestion
  and passes the identical deterministic verification as any other candidate.
- Adoption is subject to enterprise licensing, authentication and security approval, which are
  outside the framework's control (§15).

## 9. Current testing / validation architecture

- **77 offline fixtures**, `ai/**/*.fixture.ts`, run individually with `npx tsx <file>`. They are
  the regression suite. They are deliberately not Playwright tests and not part of `npm test`
  (which is the upstream Playwright MCP suite and must stay hermetic).
- **Fixture isolation** — `ai/projects/fixture-safety.ts`. `enterIsolatedArtefactRoot()` points
  `AURA_ARTEFACT_ROOT` at an OS temp directory so a fixture cannot *name* a real artifact path;
  `removeFixtureTree()` independently refuses any delete outside the active fixture root, including
  when no isolation is active; `assertAbsent()` protects the deliberately un-isolated fixture.
  Both barriers exist because of two real incidents in which fixture cleanup deleted live
  recordings — one recovered from a backup, one not.
- **Mutation testing** — a protection is proven by intentionally removing or corrupting it and
  showing the relevant fixture goes red. Phase 13.7 recorded eight mutations, all biting.
- **Corpus measurement** — `ai/autocode/locator-quality-benchmark.fixture.ts`,
  `candidate-durability.fixture.ts`, `exact-nonexact.fixture.ts`,
  `accessible-name-stability.fixture.ts` measure over the archived corpus rather than asserting a
  single case.
- **Strategy contract test** — §5.
- **Application-aware validation** — §4.
- **Falsification gate** — `ai/autocode/verify.ts` / `npm run excel:verify`: a generated spec must
  fail when the behaviour it claims is broken, or it is quarantined. Note this **writes**
  `ai/autocode/state.json` and `ai/test-mapping/mapping.json` and drives a live browser.
- **Independence** — `npm run excel:independence`: generated specs must authenticate for themselves.

## 10. Latest verified regression baseline

**Last known verified baseline: 77/77 fixtures green, 0 failures.**

- **Source**: `docs/history/REMAINING.md`, `status_version: 41`, the `regression:` block and
  `p13_7_resolver_terminal_decline_and_page_object_bootstrap.regression` — "77 fixtures run, 77
  green, 0 failures, exit code 0 — 2026-09-09, one run on the settled tree".
- **Independently corroborated during this audit**: `find ai -name '*.fixture.ts' | wc -l` returns
  **77**, so the fixture *count* the baseline refers to is current and no fixture has been added
  or removed since.
- **Not re-run.** This was a documentation-only task; running 77 fixtures is expensive and several
  write artifacts. One fixture was run as a targeted check —
  `npx tsx ai/autocode/strategy-contract.fixture.ts`, chosen because it writes nothing anywhere —
  and it passed all checks with exit code 0 (30 strategies emitted by 6 graphs, 35 declared).
- **Treat 77/77 as a point-in-time observation, not a target.** The number moves whenever a phase
  adds a fixture, and it has (63 → 66 → 73 → 74 → 75 → 76 → 77 across P5…P13.7).

**Re-measure with**: `for f in $(find ai -name '*.fixture.ts' | sort); do npx tsx $f; done` —
and check **exit codes**, not printed summaries; several fixtures print their own wording and a
grep for PASS/FAIL reports nothing for them while they are green.

## 11. Current artifact state

Point-in-time observations, 2026-09-12. **Do not modify artifacts to preserve these numbers.**

| | Count |
| --- | --- |
| Registered applications | 3 (`bugasura`, `demoapp`, `flipkart`) |
| Bugasura recording files | 412 |
| Flipkart recording files | 54 |
| Evidence sidecars (`*.evidence.json`) | 102 Bugasura, 17 Flipkart |
| Page knowledge files | 4 (3 Bugasura, 1 Flipkart) |
| Page Object classes | 8 (7 Bugasura flat, 1 Flipkart scoped) |
| Generated specs | 64 (62 Bugasura flat, 2 Flipkart scoped) |
| Offline fixtures | 77 |

The `TESTING-CONTRACT` previously quoted 409 Bugasura / 20 Flipkart. Both moved through ordinary
recording work; that is the expected behaviour of a baseline and is why the numbers were moved out
of governance and into this file.

**No `TC_TEST*` artifact exists in any live corpus.** The single filesystem match is
`ai/reports/recordings-premigration-bugasura/accepted/TC_TEST_A.spec.ts`, inside a pre-migration
backup snapshot under the git-ignored `ai/reports/`. That is history, not a live artifact.

## 12. Known confirmed defects

Each of these is supported by evidence gathered during this audit. **None was fixed** — this was a
documentation-only task.

1. **The AI boundary is enforced asymmetrically.** `postWriteVerification()` protects established
   capabilities on the *framework's own* write path. The spec-generation agent
   (`ai/autocode/agent.ts`) runs with `Read Write Edit`, `--permission-mode acceptEdits` and
   `--add-dir <repo root>`, and there is **no post-run repository-integrity comparison** over
   knowledge YAML or Page Object files. Further, `explorationRequest()` in
   `ai/knowledge/page-knowledge.ts` explicitly instructs the agent to write `page_object:` and
   `page_object_method:` lines into a knowledge file.
   *Mitigated but not closed*: such a declaration establishes nothing, because
   `existingCapability()` still requires a proven measurement and a method that exists on the
   class. The gap is that an AI-authored declaration can enter the repository unverified, not that
   it can be credited.
2. **`.gitignore`'s rationale for recordings contradicts the architecture.** The comment calls
   `ai/dashboard/recordings/` a "short-lived internal artifact, never a recording repository".
   It is now a 466-file durable evidence corpus that the identity, enrichment, durability and
   corpus-benchmark architecture all read. The directory is ignored, so the corpus exists on this
   machine only and is unrecoverable if lost.
3. **`docs/history/PHASE-STATUS.md` is stale and self-contradicting.** Dated 2026-08-14, it states
   "Nothing here is committed. `ai/`, `excel/` and `tests-e2e/` are untracked by choice" — 121
   files under `ai/`, 81 under `tests-e2e/` and 1 under `excel/` are now tracked. Its
   `blockers.legacy_22` reasoning in `REMAINING.md` rests on the same premise.
4. **Root `CLAUDE.md` contains one factually wrong sentence, corrected during this audit.** It
   stated "no `tsconfig.json`"; one exists (untracked, editor-only, `noEmit`). See §19.

**Open blockers carried forward from `REMAINING.md`, unverified this session** — recorded so they
are not lost, not confirmed here: `legacy_22` (22 accepted tests with unsafe locators whose
evidence was deleted before retention existed), `accepted_specs_with_positional_identity` (3 specs
using `.first()` for identity, a subset of the above), `page_object_direct_locators` (5 sync
getters bypassing the cardinality chokepoint — audited 2026-08-20 and classified a diagnostics
improvement, not a safety hole), `open_cases.TC_LOGIN_100` (re-record required).

## 13. Known performance limitations

**Measured from `ai/reports/abstraction-semantic.jsonl` during this audit (50 exchange records):**

- **AI transport latency dominates and is not framework computation.** Of the records carrying a
  per-attempt `transportMs`, the range is **71.3 s – 120.1 s**, median **89.4 s**, against a
  **120 s** transport ceiling in `claudeTransport()`. 120,085 ms is the ceiling being hit.
- One exchange in the log spent **271 s** across 3 attempts and still ended `TRANSPORT_FAILED`.
- Several recent Flipkart exchanges ended `TRANSPORT_FAILED` or `REJECTED` after 3 attempts.
- **`terminal: 0` across all 50 records.** The P13.7 terminal-decline optimisation was validated by
  replaying recorded first attempts through the real validator (32 transport calls → 24 over the
  last 12 exchanges), but **no live run since has recorded a terminal stop**. The saving is
  demonstrated, not yet observed in production.

**Framework computation, by contrast, is cheap** (figures from `REMAINING.md`, not re-measured):
`analyseCorpus` 2.2–2.8 s for Bugasura, 0.08–0.13 s for Flipkart; candidate generation
0.30 → 0.43 ms per target after P10; press-time measurement 15 → 19 ms mean over 5 live targets.

**The distinction matters.** Generation wall-clock is provider-bound, not compute-bound. Optimising
the deterministic engine will not move it.

## 14. Architectural work remaining

Verified as genuinely absent or incomplete:

1. **AI provider abstraction.** A `Transport` function type exists in `semantic.ts` with one
   implementation; `agent.ts` has no seam at all. No provider registry, selection, capability
   contract or shared prompt/response schema.
2. **GitHub Copilot integration.** Absent entirely (§7).
3. **Authentication / authorization.** None. `ai/dashboard/server.ts` binds `127.0.0.1` with no
   host option and no auth layer; safety today is that it is unreachable, not that it is guarded.
   Any remote deployment needs this first.
4. **Deployment hardening.** Everything is local: hosts-file friendly name, spawned child
   processes, filesystem artifact store, no service boundary, no multi-user model.
5. **Retention policy.** `ai/dashboard/generations/` keeps the latest five generations; execution
   runs under `ai/dashboard/runs/` are **unbounded** (~3 MB per run with traces). Recordings have
   no retention policy at all.
6. **Legacy-layout migration.** Bugasura still owns five unscoped artifact classes. `legacyLayout`
   is explicitly a migration marker that is meant to expire; only recordings have moved.
7. **Repository durability of the corpus and the scope layer.** See §18 — this is the largest
   practical risk and it is not a code problem.

## 15. External / provider limitations

Outside the framework's control:

- **Provider transport latency** — 71–120 s per resolver call against a 120 s ceiling (§13). Not
  tunable from inside MoolyaAura; the only framework-side levers are asking fewer questions
  (terminal decline) and failing fast.
- **Provider availability** — an outage produces `TRANSPORT_FAILED`, and by design records no
  verdict at all.
- **Claude Code CLI dependency** — the AI path requires a locally installed binary discovered by
  `resolveClaude()` or named by `CLAUDE_CLI`. It is not an SDK dependency and not in
  `package.json`.
- **Enterprise licensing and access** — GitHub Copilot adoption depends on Keysight licensing,
  authentication and security review.
- **Target-application behaviour** — e.g. a product that refuses concurrent navigation from one
  host forces single-worker execution. Such facts belong in that application's knowledge scope,
  never in framework logic.

## 16. Important decisions that must not be accidentally reversed

1. **Generalized framework capability over application-specific patch.** A Flipkart, Bugasura or
   Keysight failure never becomes a global framework rule; it becomes knowledge, a Page Object, or
   a scoped artifact.
2. **Deterministic-first, minimal AI.** The deterministic answer exists in full before anything is
   asked. AI is a post-pass over a closed question list.
3. **Runtime identity over locator similarity.** A name, a selector token, a score, a method name
   and a shared class are each not element identity. Identity is a measurement taken at the
   interaction.
4. **Unknown is not yes.** An unresolved locator, several matches, a prose-only declaration or a
   recording predating the measurement all leave identity unknown — and unknown never becomes yes.
5. **Two claimants are no claimant.** Ambiguous ownership returns nothing and goes to review.
6. **Application isolation, with no cross-application fallback.** A miss in scope is a miss.
7. **No silent capability overwrite.** Established capabilities are append-only under automated
   enrichment; stronger-looking evidence is retained for review, never applied.
8. **Page Object reuse before creation** — and reuse must be proven, not resembled.
9. **AI cannot bypass deterministic verification**, cross application scope, or supply a locator.
10. **Fixtures cannot touch production artifacts** — isolation plus an independent delete guard.
11. **Instrument before optimizing**, and never trade target correctness for speed.
12. **Timing is part of proof** — an action is proven at the press and nowhere else.
13. **Baselines are observations, not targets.**

## 17. Current next-step candidates

**Not chosen. Listed for a person to decide.** Do not start one of these on the strength of this
list alone.

1. **Investigate and design the AI provider abstraction**, then GitHub Copilot integration
   (§8, §14.1–2). Confirmed from code to be the largest missing architectural piece, and the one
   the stated Keysight direction depends on. `semantic.ts`'s `Transport` seam is the natural
   starting point; `agent.ts` is the harder half and has no seam at all.
2. **Close the AI boundary asymmetry** (§12.1) — a post-generation repository-integrity comparison
   equivalent to `postWriteVerification`, and a decision about whether the exploration prompt
   should ask for `page_object` bindings at all.
3. **Commit the scope layer and decide the corpus's durability story** (§18). This is not
   engineering work, but everything else is at risk until it is settled.
4. **Continue broad Flipkart validation**, which is the `next_action` recorded in `REMAINING.md`
   at the end of Phase 13.7.
5. **Retention and deployment hardening** (§14.3–5), needed before anything leaves localhost.

## 18. Repository risks / warnings for the next coding agent

**Read this section before touching anything.**

1. **The working tree is far ahead of `HEAD`, and the gap contains the architecture.** `HEAD` is
   `a35da57`, dated **2026-09-03**. Phases 12 through 13.7 exist **only as uncommitted working-tree
   state**. Specifically untracked: the **entire `ai/projects/` directory** — the registry, scope
   resolution, fixture safety, provisioning, migration and 11 of the 77 fixtures — plus
   `tests-e2e/support/collection-scope.ts`, `tests-e2e/support/base-fixtures.ts`,
   `tests-e2e/flipkart.fixtures.ts`, every Flipkart artifact, 10 further fixtures,
   `ai/excel/workbook-template.ts`, `ai/dashboard/scope-request.ts` and `tsconfig.json`.
   **A fresh clone of this repository does not contain the application-scope architecture at all.**
2. **91 tracked files are modified and 29 are deleted in the working tree**, all pre-existing.
   `.env` is **staged** for deletion. Do not clean, reset, stash or commit any of this without
   asking.
3. **The recording corpus is git-ignored and irreplaceable.** 466 files under
   `ai/dashboard/recordings/`. Every corpus measurement, the identity architecture and the
   enrichment lifecycle read it. It has already been deleted twice by fixture cleanup (§9). Never
   run a fixture that writes or deletes without `enterIsolatedArtefactRoot()`.
4. **Ignored-but-load-bearing**: `ai/reports/` (lifecycle ledger, semantic audit, generation
   metrics, alternative evidence), `ai/test-data/`, `ai/dashboard/runs/`,
   `ai/dashboard/generations/`, `ai/autocode/state.json`, `ai/autocode/quarantine/`.
5. **Two Playwright suites, never merge them.** `playwright.config.ts` + `tests/` is the upstream
   MCP suite and gates the Playwright roll; `playwright.excel.config.ts` + `tests-e2e/` is the
   application suite. A bare `npx playwright test` runs the *upstream* one and reports
   "No tests found" for anything in `tests-e2e/`.
6. **There is no typecheck.** No `typescript` in `node_modules`; `tsx` strips types without
   checking them. `tsconfig.json` exists for editors only (`noEmit`) and gates nothing. A type
   error surfaces as a runtime failure — after editing anything under `ai/` or `tests-e2e/`,
   actually run it.
7. **Legacy vs scoped paths coexist deliberately.** `tests-e2e/pages/*.ts` (flat, Bugasura) and
   `tests-e2e/pages/flipkart/*.ts` (scoped) are both correct. Never assume a flat directory.
8. **Expensive operations**: the full 77-fixture regression; anything invoking the semantic
   resolver (71–120 s per call); the falsification gate (writes state and drives a live browser);
   `npm run excel:demo` **with no `--out`, which overwrites `excel/login-test-cases.xlsx`**
   without backup.
9. **Live-application safety**: tests that write to a real workspace are gated behind
   `BUGASURA_ALLOW_DATA_MUTATION=1` plus `BUGASURA_TEAM`. Nothing deletes what they create.
10. **`docs/history/REMAINING.md` is the session handoff**, and its `status_version` YAML block is
    the machine-readable state. It is a *claim*: verify a phase marked DONE by running its fixture
    and reading the named file. `docs/history/PHASE-STATUS.md` is older and partly stale (§12.3).

## 19. Current git state

- **Branch**: `develop`. Main branch for PRs: `main`. `HEAD` = `a35da57`, 2026-09-03.
- **Pre-existing, before this task**: 91 modified tracked files (43 `ai/autocode`, 13
  `ai/dashboard`, 8 `ai/autocode/abstraction`, 7 `ai/excel`, 5 `ai/knowledge`, 3
  `tests-e2e/support`, 2 `tests-e2e/pages`, and one each in `tests-e2e`, `ai`, `ai/test-mapping`,
  `ai/knowledge/page`, `ai/knowledge/framework`, `ai/dashboard/public`, `excel`, `docs/history`,
  plus `playwright.excel.config.ts`); 29 deletions (28 generated report / test-result artifacts,
  plus `.env` **staged** for deletion); 28 untracked paths (§18.1).
- **Introduced by this documentation task — documentation only:**
  - modified `MoolyaAura_Governance_Pack/MOOLYAAURA-ARCHITECTURE.md`
  - modified `MoolyaAura_Governance_Pack/MOOLYAAURA-LOCATOR-CONTRACT.md`
  - modified `MoolyaAura_Governance_Pack/MOOLYAAURA-TESTING-CONTRACT.md`
  - modified `MoolyaAura_Governance_Pack/README.md`
  - modified `CLAUDE.md` (two corrections: the `tsconfig.json` sentence, and a pointer to this
    governance pack)
  - **added** `MoolyaAura_Governance_Pack/MOOLYAAURA-CURRENT-STATE.md` (this file)
  - `MOOLYAAURA-ENGINEERING-PRINCIPLES.md` was audited and needed **no change**.
- **No production TypeScript, fixture, recording, knowledge file, Page Object, spec, mapping,
  workbook, configuration or dependency was modified.** Nothing was cleaned, reset or reverted.
