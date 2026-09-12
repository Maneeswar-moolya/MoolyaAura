# MoolyaAura Architecture Contract

## System Flow
Recording / User Intent
→ Project Context
→ Evidence Capture
→ Knowledge + Page Object Lookup
→ Candidate Generation
→ Runtime Measurement
→ Target Identity Verification
→ Safety / Provenance Gates
→ Ranking
→ Page Object Reuse or Generation
→ Spec Generation
→ Execution
→ Results / History

## Project Context
The active scope identifies application/project and environment. Application-specific ownership must remain isolated.

> No application-specific artifact may be resolved outside the active `applicationId` scope unless explicitly declared a shared framework capability.

`applicationId` is **declared**, never derived from a URL, and is immutable: it is simultaneously a directory name, a file name and a scope key, so a rename orphans every artifact filed under the old one — invisibly, because resolution then returns nothing and a miss reads exactly like "this application has no artifacts yet".

Two lists make "is this shared?" a question with a written answer rather than an inferred one. **Shared framework capability** — the recorder, evidence engine, locator engine, generation engine, execution engine, validation engine, AI gateway, dashboard framework and framework-level knowledge — is never duplicated per application and may be read by any application's run. **Application-owned artifacts** — Page Objects, components, knowledge, locators, evidence, recordings, test cases, test data, generated specs, results and history — always resolve under the active scope. Anything not on the shared list that produces or consumes application artifacts must take a scope.

> **There is no cross-application fallback.** A miss inside the active scope is a miss, reported as not-found; the remedy is to author the artifact for this application. "Look here, and if nothing is there look everywhere else" fails in the worst direction — it does not error, it produces a green test against the wrong application.

A migration affordance is not a fallback: where artifacts predate the scope layer, the single application entitled to the unscoped directories is **declared**, at most one may declare it, and every other application resolves to its own scoped path where a miss stays a miss. Entitlement must never be keyed to a fact about the registry's *size*; a fact about how many applications are registered is not a statement about who owns a directory.

Scope-awareness is required of *validation* as well as of production paths. Sweeps and fixtures that judge generated artifacts must evaluate each application's artifacts under that application's own scope; checking one application's specs against another's ownership reports correct work as broken and lets real breakage through.

Application context is captured at recording time and remains immutable for the recording lifecycle where required. Because a Test Case ID is unique *within* an application and deliberately reusable across applications, generation, execution, results, history and metrics must each carry the application identity — a test case id alone cannot tell two applications' work apart. A record written before an identity field existed reads as *unknown*; it is never inferred from a workbook name, a file name, a title or a URL.

## Evidence
Evidence is bounded and purposeful rather than full-DOM by default. It may include exact target identity, role/name, browser-verified accessible name, authored identifiers, stable attributes, href/alt, bounded ancestors, required sibling evidence, document identity and provenance.

Optional evidence can reduce coverage or confidence but must not be replaced by invented assumptions.

## Candidate Generation
Candidate families include Page Object capabilities, semantic role/name, scoped semantic candidates, test hooks/stable identifiers, stable attributes and structural candidates.

Candidate budgets are safety/performance controls, not correctness shortcuts.

## Verification
Every candidate goes through:
1. resolution;
2. match count;
3. same-document verification;
4. exact recorded-target identity;
5. safety/provenance gates;
6. available stability/quality evidence;
7. ranking.

`count === 1` is never sufficient by itself.

## Semantic Locators
Role + name candidates may have exact and non-exact variants. Both are subject to the same ambiguity and identity gates. Never assume exact, non-exact, ID or semantic is universally best.

## Page Object Reuse
Existing Page Object capabilities are first-class candidates. Ownership is derived from project/application/page context rather than inferred only from locator text.

Reuse is attempted before creation at every stage, and in this order: an existing capability, then an existing parameterised capability matched on its template, then — only where deterministic evidence supports it — a new capability. A parameterised capability is reused on the template it declares, and the template must still round-trip to the expression that was actually measured; parameterised reuse never loosens the structural guarantee that makes it reuse rather than resemblance.

> A Page Object class resolves the shared framework it is built on from **where that framework actually is**, computed from the class file's own location. No layout may be assumed. A hard-coded relative path is correct for exactly one directory depth, and an application whose Page Objects live one level deeper then imports files that do not exist — which surfaces at test *collection*, as a refused spec, rather than as anything a locator or a capability could explain.

## Project Knowledge Lifecycle
An application's page and component knowledge is derived from its own recordings. It is never seeded from another application, and never invented.

> Page ownership is established from the active `applicationId` plus a route the recording itself establishes. Page titles, DOM shape, text and locator strength are not ownership evidence.

Where existing knowledge declares an owner, that declaration decides. Bootstrap applies only where no knowledge exists.

When ownership cannot be established, the framework fails closed: it emits the recorded locator and reports Page Object Required. It never creates a placeholder page.

A screen is UNKNOWN until a recording establishes it. It is BOOTSTRAPPED when a first recording establishes its ownership and one proven capability. It becomes ESTABLISHED as later recordings add further proven capabilities to the same screen. Reuse is attempted before creation at every stage.

> Established capabilities are append-only with respect to automated enrichment: a later recording must not silently replace, rename or remove an established capability.

New evidence about an established capability — including a locator that appears stronger — may be retained for review. It is never applied automatically. Deliberate correction, maintenance or deprecation of a capability is an explicit reviewed operation, and is outside automated enrichment.

A capability requires deterministic framework evidence and proof taken at the interaction it describes. Exploration and prose describe a screen; they do not establish a capability.

Evidence is attributed to a capability only where the framework has established that the recorded element is the one that capability wraps. A match made on a name is not element identity.

> Element identity between a recorded target and an established capability is established by measurement at the interaction: the capability's own declared locator is resolved in the document the interaction happened in, and the element it resolves to is compared with the element that was acted on. A match made on a name, a selector token, a locator score or a method name is not element identity, and neither is the absence of one a proof of difference.

Where identity cannot be established - the declared locator does not resolve, resolves to several elements, is described only in prose, or was never measured - the framework does not claim the capability. The element goes to the ordinary proposal and review path. Unknown is not yes.

Automated enrichment is idempotent. Processing the same recording again produces the same knowledge, Page Objects and fixtures rather than duplicates.

Knowledge, Page Object and fixture updates for one capability are a single transaction: all are applied, or none is.

An accepted generated specification is never silently regenerated. A framework improvement changes what is generated next; re-deriving an accepted asset is an explicit operation that must pass the same gates as the original generation.

## AI Boundary
AI cannot invent target identity, evidence, provenance or ownership; bypass runtime verification; bypass ambiguity/safety gates; or cross application scope. AI is a controlled last-mile mechanism.

AI may author descriptive knowledge: a screen's prose and purpose, synonyms, and the record of a screen it was asked to explore. Descriptive authorship carries no authority. It establishes no application ownership, no page ownership, no locator truth and no capability, and it does not make an unproven element reusable.

> An AI-authored knowledge declaration — **including one that names a Page Object and a method** — establishes no capability and no identity. It is read as a declaration, and it is credited only where a measurement proves it and the method it names really exists. A declaration is not evidence about an element; it is a claim awaiting one.

> AI may not create, alter or remove a capability the deterministic framework has established. Such a change is refused, not merged.

### Resolver Termination
An exchange with a resolver ends on a validated answer or on a spent budget, and one further case: a resolver may **decline**, and a validated decline is terminal exactly where every question still unanswered is one whose answer *is* the decision. Repairing such an answer asks the identical question again. A decline that leaves a genuinely repairable question open stays repairable.

Terminating early changes only how many calls are made. It accepts no answer that would not have been accepted, skips no validation, and ends where a spent budget ends — in review or in a recorded refusal.

> **A timeout, a transport error or an absent provider is not a semantic decision.** It is an outage, and the proposal is left exactly as the deterministic engine produced it, so the next run asks the question for the first time. Converting silence into a verdict to save time is fabricating evidence, and it is refused whichever direction the verdict points.

## Artifact Integrity
Production changes must not unintentionally modify recordings, evidence, specs, mappings, workbooks or application-specific artifacts. Historical evidence must not be rewritten merely to populate new fields.

Where the framework writes artifacts itself, integrity is **verified rather than assumed**: the artifacts are snapshotted by content before the write, and afterwards every capability that existed still declares what it declared, nothing that existed has gone, and no file outside the set this write intended to touch has changed. Compared as bytes — never by timestamp or ordering — and a failure rolls the whole set back, including removing files the run brought into existence.

This is the enforcement mechanism for the append-safe and transactional rules above, and its reach is exactly the framework's own write paths. Anywhere an artifact can be written by something else — an agent granted file tools, a person, a script — the rules still stand as a contract, and the protection is that nothing downstream credits a declaration it has not measured.
