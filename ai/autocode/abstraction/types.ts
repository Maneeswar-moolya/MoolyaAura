/**
 * What the abstraction engine decides, and the shape it reports.
 *
 * Phase 1 is REPORT ONLY: nothing here writes a Page Object, a knowledge entry or a
 * fixture. The output is a ledger a person reads before any of that is built.
 */

/** Where a target ended up, and which rule put it there. */
export type Category =
  /** The recorder's own overlay, not the application. */
  | 'RECORDER_OWNED'
  /** A generated id. Never a Page Object locator. */
  | 'DYNAMIC'
  /** The recording does not prove this locator identifies one element. */
  | 'NOT_UNIQUE'
  /** Measured too late, or in the wrong document, to say anything. */
  | 'BAD_TIMING'
  /** A landmark or overlay: belongs to a component, not a screen. */
  | 'COMPONENT'
  /** An authored, interactive capability. The thing Page Object methods are for. */
  | 'METHOD'
  /** Identified by its own text: a value, not an element. */
  | 'TEST_DATA'
  /** Structural, inside a repeated container - a row member. */
  | 'COMPONENT_MEMBER'
  /** No rule matched. A person decides. */
  | 'UNCLASSIFIED';

export type ProposalStatus = 'PROPOSED' | 'REUSE' | 'NEEDS_REVIEW' | 'REFUSED';

/**
 * What the target was used FOR, which is not the same as what it is.
 *
 * The clickable element and the element holding the state are routinely different
 * nodes - Bugasura's row checkbox is a `span.rounded-checkbox-ui` you press and an
 * `input.bugChecked` that carries `checked`. One method cannot serve both, so the
 * role travels with every proposal and two proposals for one control is the correct
 * outcome, not a duplicate.
 */
export type TargetRole = 'action' | 'assertion';

export interface Classification {
  category: Category;
  /** The rule number from the design, 0-9, so a decision can be traced to a rule. */
  rule: number;
  reason: string;
}

/** Why a candidate may not be built. Empty means it may. */
export interface SafetyResult {
  safe: boolean;
  /**
   * The refusals, coded. This is the source of truth; `refusals` is its projection.
   *
   * Declared with `Refusal` from below rather than a string so that eligibility can
   * be decided on `code`/`class` and never on wording.
   */
  codes: Refusal[];
  /** `codes.map(c => c.detail)`, kept because the ledger and its readers are prose. */
  refusals: string[];
  /** The candidate measurement that carries the press-time proof, when there is one. */
  proof: {
    matchCount: number | null;
    identityMatched?: boolean;
    sameDocument?: boolean;
    measuredAt?: string;
    strategy?: string;
    expression?: string;
  } | null;
}

export interface Proposal {
  timestamp: string;
  testCaseId: string;
  /** The recorded target's human name, as the recording carried it. */
  target: string;
  role: TargetRole;
  category: Category;
  rule: number;
  status: ProposalStatus;
  /** Null whenever ownership could not be resolved from evidence. Never guessed. */
  owner: string | null;
  ownerKind: 'page-object' | 'component' | null;
  /**
   * Present only when the owner was BOOTSTRAPPED - derived from the active application
   * and the route the recording established, because nothing declared one.
   *
   * The writer reads it for the one thing it cannot otherwise know: which knowledge file
   * to create, under which identity, declaring which route. Absent on every proposal
   * whose owner came from a declared rule, which is every proposal an application with
   * knowledge produces.
   */
  bootstrap?: { canonicalId: string; route: string; pageName: string };
  method: string | null;
  parameterised: boolean;
  parameterSource: string | null;
  locatorStrategy: string;
  /** The expression that would be wrapped. Redacted, never a secret. */
  expression: string | null;
  proof: SafetyResult['proof'];
  reason: string;
  refusals: string[];
  /**
   * The expression a generated method would return, with the recorded value already
   * replaced by the parameter name.
   *
   * Stored rather than the raw expression because the raw one CONTAINS the value -
   * an issue summary, a project name - and the ledger must not carry test data. The
   * template is what the writer builds from, and it is safe to read because there is
   * nothing of the recording left in it.
   */
  template: string | null;
  /** The parameter's name, when the method takes one. */
  parameterName: string | null;
  /**
   * The element's authored accessible name, when it has one.
   *
   * Carried so a knowledge entry can declare it - it is the strongest thing the
   * matcher can key on. Null for an element with none, which is most row members,
   * and null is what must then be written rather than something invented.
   */
  accessibleName: string | null;
  /**
   * Is that accessible name shared by structurally different elements in the corpus?
   *
   * Computed deterministically from every sighting, before any model is asked, and it
   * decides ONE thing: whether `renderKnowledgeEntry` may declare `accessible_name`.
   * `findMethod` matches that field PAGE-WIDE, so an entry keyed on a shared name binds
   * every element that shares it - which is how all five `Close` buttons in this corpus
   * would have bound to the notifications panel's locator.
   *
   * The fix is structural rather than a refusal: the entry omits the name, the method
   * is still created, and it is reached by `findMethodByProvenLocator` on the exact
   * expression the recorder measured. A UNIQUE name is unaffected and still declared.
   */
  accessibleNameAmbiguous: boolean;
  /**
   * Every recorded element this one proposal stands for, across the whole corpus.
   *
   * The ledger holds ONE line per distinct abstraction (`seen`, the fingerprint gate),
   * which is right for a ledger and wrong for answering "what happened to the element
   * in THIS test?". A recording whose target was first seen in another case has no
   * proposal of its own, so the lifecycle had no record to join to and reported the
   * element as never evaluated.
   *
   * Populated for every sighting including the deduped ones. Never used to decide
   * anything - it is the join key, not evidence.
   */
  sightings: Array<{ testCaseId: string; from: string }>;
  /** owner + role + accessibleName|id + strategy. Dedupes across runs. */
  fingerprint: string;
  /**
   * The same refusals as `refusals`, carrying the code that decides who may clear
   * one. Empty on a PROPOSED or REUSE line.
   */
  refusalCodes: Refusal[];
  /**
   * How this proposal reached its status. `ai` ONLY ever means a semantic refusal
   * was cleared by a model and the result then passed every deterministic gate
   * again - never that a model decided the locator, the proof or the safety.
   */
  resolvedBy: 'deterministic' | 'ai';
  /** The model exchange, when there was one. Null on the deterministic path. */
  semantic: SemanticAudit | null;
  /**
   * The owners a semantic resolver may choose between - the CLOSED SET.
   *
   * Exactly what knowledge declares for this screen, computed deterministically
   * before any model sees the proposal. An answer outside this list is rejected, so
   * a resolver cannot invent a class or move an element to a screen it was never on.
   */
  allowedOwners: string[];
  /**
   * The name the FRAMEWORK derived, whatever the status.
   *
   * `method` is null on a NEEDS_REVIEW line because no method is being proposed. The
   * derivation still happened though, and it is deterministic - so when a resolver
   * clears the semantic question, the name is already settled and the model's
   * suggestion has to agree with it rather than replace it. Null only when nothing
   * could be derived, which is the one case a resolver is asked to name something.
   */
  derivedMethod: string | null;
  /**
   * Does substituting the recorded value back into the template reproduce the
   * expression the recorder measured?
   *
   * True by construction for a template built by `templateFor` - it is built by
   * splitting the measured expression on the quoted value - but asserted rather than
   * assumed, because a template that does NOT round-trip is a method that points
   * somewhere the recorder never proved. False whenever there is no template.
   */
  roundTrip: boolean;
}

/* ------------------------------------------------------ refusal reason codes */

/**
 * WHY a refusal exists, and therefore who is allowed to clear it.
 *
 * The classes are not a severity scale. They answer one question: can a semantic
 * judgement resolve this, or is it a fact about the evidence?
 *
 * - `SAFETY`    - the press-time proof, the dynamic-id detector, the forbidden
 *                 mechanisms. NOTHING clears these. Not a person, not a model.
 * - `SEMANTIC`  - a question about meaning that the DOM cannot answer: who owns
 *                 this, what is it called, is it one capability or two.
 * - `STRUCTURAL`- a fact that is neither. The value is not in the expression, the
 *                 method already exists. A judgement cannot change it either, but it
 *                 is not a safety prohibition and must not be reported as one.
 */
export type RefusalClass = 'SAFETY' | 'SEMANTIC' | 'STRUCTURAL';

export type RefusalCode =
  /* SAFETY */
  | 'NO_PRESS_TIME_PROOF'
  | 'IDENTITY_NOT_PROVEN'
  | 'DYNAMIC_IDENTIFIER'
  | 'FORBIDDEN_MECHANISM'
  | 'GROUP_MEMBER_UNPROVEN'
  /**
   * The recorder measured NOTHING for this element.
   *
   * Distinct from `NO_PRESS_TIME_PROOF`, which says a measurement exists and does not
   * prove identity. This says the element reached the generator with no measurement at
   * all - either the recording predates dom-evidence capture, or the sidecar holds no
   * row joinable to this locator. The distinction matters because the two have
   * different remedies: one is a recording that measured the wrong thing, the other is
   * a recording that measured nothing, and only the second is repaired by re-recording
   * alone.
   *
   * It exists because the code that hit this case used to be `if (!evidence) continue`
   * - so "never evaluated" and "evaluated and refused" were the same silence. 87 of the
   * corpus's 225 raw locators were in that silence.
   */
  | 'NO_ADMISSIBLE_EVIDENCE'
  /**
   * The recorder's own overlay, not the application.
   *
   * SAFETY, because no judgement may overturn it: wrapping the recorder's assertion
   * picker in a Page Object method would put the tool into the test. It exists as a
   * code at all so the element gets a RECORD - it used to leave `analyseCorpus` through
   * a bare `continue`, and eight `click .veil` steps then reached the report as
   * "the engine holds no record for this element".
   */
  | 'RECORDER_OWNED_ELEMENT'
  /* SEMANTIC */
  | 'AMBIGUOUS_OWNERSHIP'
  | 'AMBIGUOUS_NAME'
  | 'NO_METHOD_NAME'
  | 'CONSTANT_PARAMETER_VALUE'
  | 'SINGLE_TARGET'
  | 'TEXT_ONLY_IDENTITY'
  | 'CONTAINER_OR_CAPABILITY'
  | 'OWNER_UNKNOWN'
  | 'UNCLASSIFIED_TARGET'
  /**
   * Bootstrap could not establish which SCREEN this element belongs to.
   *
   * Raised only on the empty-knowledge path, where nothing declares an owner and the
   * only remaining evidence is the route the recording itself established. No route,
   * a route the document never stated, or a route carrying a generated identifier -
   * `/issues/636432` names one record, not one screen - and there is nothing left to
   * derive an owner from.
   *
   * SEMANTIC by class and deliberately ABSENT from `SEMANTIC_ENABLED`: a resolver asked
   * "which page is this?" with no route would be inventing the page, which is the one
   * thing bootstrap exists to make impossible.
   */
  | 'BOOTSTRAP_ROUTE_UNKNOWN'
  /* STRUCTURAL */
  | 'SIGNATURE_MISMATCH'
  | 'PARAMETER_SOURCE_MISSING'
  | 'TEMPLATE_NOT_DERIVABLE'
  | 'POSITIONAL_NOT_PARAMETERISABLE'
  | 'METHOD_EXISTS'
  /**
   * The resolver was asked, told what was wrong, asked again, and never validated.
   *
   * STRUCTURAL because it is a fact about what happened, not a question and not a
   * safety prohibition - and putting it in that class is what stops the same proposal
   * being asked about a second time inside one run: `eligibility` refuses anything
   * carrying a structural refusal. It is the terminal, automated end of the repair
   * loop, and it replaces leaving the line in NEEDS_REVIEW for a person to adjudicate.
   */
  | 'RESOLVER_EXHAUSTED';

export const REFUSAL_CLASS: Record<RefusalCode, RefusalClass> = {
  NO_PRESS_TIME_PROOF: 'SAFETY',
  IDENTITY_NOT_PROVEN: 'SAFETY',
  DYNAMIC_IDENTIFIER: 'SAFETY',
  FORBIDDEN_MECHANISM: 'SAFETY',
  GROUP_MEMBER_UNPROVEN: 'SAFETY',
  // SAFETY, and the class is what makes it unaskable: a resolver invited to answer
  // "what should this be called?" about an element nothing measured would be inventing
  // the evidence, not interpreting it.
  NO_ADMISSIBLE_EVIDENCE: 'SAFETY',
  RECORDER_OWNED_ELEMENT: 'SAFETY',
  AMBIGUOUS_OWNERSHIP: 'SEMANTIC',
  AMBIGUOUS_NAME: 'SEMANTIC',
  NO_METHOD_NAME: 'SEMANTIC',
  CONSTANT_PARAMETER_VALUE: 'SEMANTIC',
  SINGLE_TARGET: 'SEMANTIC',
  TEXT_ONLY_IDENTITY: 'SEMANTIC',
  CONTAINER_OR_CAPABILITY: 'SEMANTIC',
  OWNER_UNKNOWN: 'SEMANTIC',
  UNCLASSIFIED_TARGET: 'SEMANTIC',
  // SEMANTIC, and never askable - see the code's own note.
  BOOTSTRAP_ROUTE_UNKNOWN: 'SEMANTIC',
  SIGNATURE_MISMATCH: 'STRUCTURAL',
  PARAMETER_SOURCE_MISSING: 'STRUCTURAL',
  TEMPLATE_NOT_DERIVABLE: 'STRUCTURAL',
  // SAFETY, not STRUCTURAL, and the class is the whole point: a measured index is
  // evidence about the ONE instance that was pressed, so nothing - not a model, not
  // an approval - may clear this and turn it into a reusable indexed method.
  POSITIONAL_NOT_PARAMETERISABLE: 'SAFETY',
  METHOD_EXISTS: 'STRUCTURAL',
  RESOLVER_EXHAUSTED: 'STRUCTURAL',
};

/**
 * One refusal, with the code that decides who may clear it.
 *
 * `detail` is for a person reading the ledger and is the ONLY part that varies with
 * the target. Nothing branches on it - classifying a refusal by matching its prose
 * is what this type exists to make impossible.
 */
export interface Refusal {
  code: RefusalCode;
  class: RefusalClass;
  detail: string;
}

export function refuse(code: RefusalCode, detail: string): Refusal {
  return { code, class: REFUSAL_CLASS[code], detail };
}

/** Every refusal of a class, in order. */
export function refusalsOfClass(refusals: readonly Refusal[], type: RefusalClass): Refusal[] {
  return refusals.filter(refusal => refusal.class === type);
}

/**
 * One exchange in the repair loop: what was asked, what came back, what the
 * deterministic validator made of it.
 *
 * The loop re-runs `revalidate` UNCHANGED on every attempt. A repair is a second
 * chance at answering the question, never a second, laxer standard - so this record
 * exists to make the standard visible: every attempt carries the same rejection
 * vocabulary, and an accepted repair is an answer that passed the identical gate the
 * first one failed.
 */
export interface SemanticAttempt {
  /** 1 for the question, 2+ for each repair. */
  attempt: number;
  /** `question` or `repair` - what the prompt asked for. */
  kind: 'question' | 'repair';
  decision: string | null;
  owner: string | null;
  methodName: string | null;
  parameterName: string | null;
  /** LABEL or DATA, on a TEXT_ONLY_IDENTITY question. Null elsewhere. */
  textKind: string | null;
  confidence: number | null;
  outcome: 'ACCEPTED' | 'REJECTED' | 'MALFORMED' | 'TRANSPORT_FAILED';
  /** The validator's verbatim reason. It is also what the next repair prompt states. */
  rejection: string | null;
  /**
   * How long the transport call took, measured at its own boundary.
   *
   * The observability gap Phase 13.6's investigation named: a case spent 278 s here while
   * every timed field in the metrics read zero. Null when the call never returned.
   */
  transportMs?: number | null;
  /** Did the resolver answer at all? False for a timeout or an unreachable binary. */
  responded?: boolean;
  /**
   * The validator established that repair cannot improve this answer, so the exchange
   * stopped here. Absent on every record written before this existed.
   */
  terminal?: boolean;
}

/** What a model was asked, what it answered, and what the framework did with it. */
export interface SemanticAudit {
  fingerprint: string;
  /**
   * The codes the model was authorised to clear, in the order they were put to it.
   *
   * A list rather than one code: an element can carry several semantic questions at
   * once (who owns this, what is it called, is that text a label or data), and asking
   * them one per exchange costs one model call each and lets the answers contradict
   * one another. One exchange, one coherent component model, all of it re-validated.
   */
  semanticCodes: RefusalCode[];
  /** Evidence the model was shown, summarised. Never a locator it may edit. */
  evidence: string;
  allowedOwners: string[];
  model: string;
  decision: string | null;
  owner: string | null;
  methodName: string | null;
  parameterName: string | null;
  confidence: number | null;
  /** What the deterministic re-validation concluded, on the LAST attempt. */
  outcome: 'ACCEPTED' | 'REJECTED' | 'MALFORMED' | 'TRANSPORT_FAILED';
  /** Present whenever the outcome is not ACCEPTED. */
  rejection: string | null;
  /** Every attempt, in order. Length 1 when the first answer validated. */
  attempts: SemanticAttempt[];
  /** True when an attempt after the first is the one that was accepted. */
  repaired: boolean;
  /** When the exchange started and ended, and what it cost in total. */
  startedAt?: string;
  finishedAt?: string;
  totalMs?: number;
  /**
   * The exchange ended on a VALIDATED TERMINAL ANSWER rather than on a spent budget.
   *
   * Read by `exhaustedBefore`: a settled answer is settled in the next run too, and
   * re-asking it would spend a call to reproduce a recorded conclusion. Absent on every
   * record written before this existed, which is why an old record behaves as it did.
   */
  terminal?: boolean;
}
