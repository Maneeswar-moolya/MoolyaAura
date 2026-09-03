/**
 * The shape of DOM evidence a recording may carry, and the rules that bound it.
 *
 * WHY THIS EXISTS SEPARATELY FROM ITS CAPTURE
 *
 * Phase 7's resolver can only reason about what a Codegen chain literally says. It
 * cannot know whether `#tc_summary_638717` has a stable ancestor, whether a label
 * sits beside a field, or whether a selector matches one element or forty. All of
 * that is knowable in the browser and nowhere else, and it is thrown away the moment
 * the recording session ends.
 *
 * This module defines what would be kept if it were captured: a bounded relationship
 * graph per recorded target. It is the contract between whatever captures the
 * evidence and the resolver that will consume it - deliberately written first and on
 * its own, because the capture point is an architectural decision (Playwright's
 * `codegen` runs in a child process with no page handle, so capturing means either
 * driving the browser ourselves or replaying the recording afterwards) and the
 * consumer should not be blocked on it.
 *
 * NOTHING HERE CAPTURES ANYTHING. There is no browser in this file, no model, and no
 * network. It is types, limits, and the redaction rule that any capture must pass
 * through before its output is allowed to reach disk.
 *
 * ABSENT IS A VALID STATE, AND THE COMMON ONE
 *
 * Every recording made so far has no evidence, and recordings made later may fail to
 * capture it. `evidenceUnavailable()` is how that is said out loud: a reason, not a
 * silence. A consumer that cannot tell "no evidence" from "evidence that found
 * nothing" will eventually treat the first as the second.
 */

/* ------------------------------------------------------------------- limits */

/**
 * How far the graph may reach. Small on purpose.
 *
 * The brief's boundary rules are the whole design here: no complete HTML, no page
 * text, no unlimited walk in any direction. These numbers are what "bounded" means,
 * in one place, so a capture cannot quietly grow one of them.
 */
export const EVIDENCE_LIMITS = {
  /** Semantic containers worth naming, walking up from the target. */
  maxAncestors: 6,
  /** Immediate children only - depth 1. */
  maxChildren: 8,
  /** Descendants, and how deep. Never the whole subtree. */
  maxDescendants: 12,
  maxDescendantDepth: 3,
  maxPreviousSiblings: 3,
  maxNextSiblings: 3,
  /** Visible text kept per node. A label, not a paragraph. */
  maxTextLength: 120,
  /** Attributes kept per node, after filtering. */
  maxAttributes: 12,
  /**
   * Candidates whose measurement is kept for diagnosis after they were refused.
   *
   * A rejected candidate is not a locator and must never be promoted, but "twelve were
   * tried and every one matched several elements" and "nothing could be built at all"
   * are different findings, and only the first one tells the next person where to look.
   * Before this bound existed the funnel dropped every refused candidate and the log
   * read "none of the 0 alternative(s)" for a target that had measured twelve.
   */
  maxRejectedCandidates: 12,
  /** Longest candidate expression kept, in either list. */
  maxCandidateExpression: 200,
} as const;

/**
 * Ancestors worth recording at all.
 *
 * A relationship is only useful if it can be named later. `form`, `dialog` and `tr`
 * are things a locator can scope to; a `<div>` six levels up is not, and recording it
 * invites exactly the positional selector this toolkit refuses to emit.
 */
export const SEMANTIC_CONTAINERS = [
  'form', 'dialog', 'main', 'nav', 'header', 'footer', 'aside', 'section', 'article',
  'table', 'thead', 'tbody', 'tr', 'ul', 'ol', 'li', 'fieldset', 'details',
] as const;

/** Roles that make a container worth recording even when its tag does not. */
export const SEMANTIC_ROLES = [
  'dialog', 'alertdialog', 'form', 'main', 'navigation', 'region', 'search',
  'table', 'row', 'rowgroup', 'grid', 'list', 'listitem', 'tabpanel', 'banner',
] as const;

/* -------------------------------------------------------------------- shape */

/** One node in the graph: what it is, never how it is drawn. */
export interface DomNode {
  tag: string;
  role?: string;
  accessibleName?: string;
  /** Trimmed and truncated to `maxTextLength`. Never the node's whole subtree text. */
  text?: string;
  id?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  title?: string;
  /** `aria-label`, `aria-labelledby`, `aria-describedby`… locator-relevant only. */
  aria?: Record<string, string>;
  /** `data-testid` and friends. The capture decides which are stable. */
  data?: Record<string, string>;
  /** Classes that look authored. Generated/hashed ones are dropped at capture. */
  stableClasses?: string[];
  /**
   * This node scrolls its own content: `overflow` is `auto`/`scroll` AND its scroll
   * extent genuinely exceeds its client extent. Measured, not inferred from a class
   * name.
   */
  scrollable?: boolean;
  /**
   * This node renders only part of its content - a virtualized list or grid.
   *
   * DELIBERATELY NARROW. A scrollbar is NOT evidence of virtualization: a long page
   * scrolls and renders everything. The only signals accepted are ones the
   * application states about itself - `aria-rowcount`/`aria-setsize` larger than the
   * rows actually rendered, or an attribute whose NAME says virtual. Anything else is
   * `scrollable` without being `virtualized`, which is the honest distinction: one
   * means "scroll to see it", the other means "it may not exist yet".
   */
  virtualized?: boolean;
  /** What said so, when `virtualized` is true. Named so the call can be argued with. */
  virtualizedSignal?: string;
}

export type DomRelationship =
  | 'parent' | 'child' | 'ancestor' | 'descendant' | 'previous-sibling' | 'next-sibling';

/** A node plus how it is related to the target, and how far away. */
export interface RelatedNode extends DomNode {
  relationship: DomRelationship;
  /** 1 for a parent or an immediate child; grows with distance. */
  depth: number;
}

/**
 * How many elements the recorded locator matched, when the capture could tell.
 *
 * `null` means not measured, and that is a normal answer - a capture that could not
 * evaluate the page, or a locator it declined to run. It must never be read as 1.
 * Uniqueness is only ever *measured* here, never inferred.
 */
export type MatchCount = number | null;

/**
 * One alternative selector, measured in the browser.
 *
 * WHY A COUNT OF ONE IS NOT ENOUGH ON ITS OWN
 *
 * `matchCount === 1` says the selector identifies ONE element. It does not say it is
 * the element the person acted on. TC_LOGIN_060 recorded a click on a project tile
 * and, because the count was taken after the click had navigated, produced four
 * candidates each measuring exactly one element - on the page the click had arrived
 * at. Promoting any of them would have emitted a locator for an element nobody
 * touched, and it would have looked like the best kind of evidence while doing it.
 *
 * So a promotion needs three separate facts, and `isProvenAgainstClickedTarget` is
 * where they are stated once: the measurement happened in the document the press
 * happened in (`sameDocument`), it found exactly one element (`matchCount`), and that
 * element is the one the person acted on (`identityMatched`).
 */
/**
 * WHEN a candidate was counted. Three different moments, never interchangeable.
 *
 *   press  the person's pointerdown on the element, before the action took effect.
 *          The strongest, and the only timing an ACTION may be promoted on.
 *   claim  when Codegen's line appeared, ~400ms later, in whatever document was
 *          showing. Identity is not asked and must stay unstated.
 *   pick   when the person chose an assertion from the picker's card. The element
 *          is the one they selected, identity IS asked, and it is answered against
 *          the semantic assertion subject - which is often not the element under
 *          the pointer.
 *
 * `pick` is deliberately NOT an alias for `press`: an action promoted on a
 * pick-time measurement would be an action promoted on a measurement taken after
 * it happened. `isProvenAgainstClickedTarget` therefore still accepts `press`
 * alone, and assertions use `isProvenAtPick`.
 */
export type MeasurementTiming = 'press' | 'claim' | 'pick';

export interface CandidateMeasurement {
  /** `scoped-class`, `test-id`, `role-name`, `parent-text`… */
  strategy: string;
  /** The Playwright expression, as it would be emitted. */
  expression: string;
  /**
   * How many elements it matched, measured. Never inferred.
   *
   * `null` when the measurement could not be taken at all - an unbuildable selector,
   * or a scope too large to walk inside the budget. It is not zero: zero is a page
   * that was searched and held nothing.
   */
  matchCount: MatchCount;
  /**
   * The single element it matched IS the element the person acted on.
   *
   * Only ever set when there was an element to compare against - a press-time
   * measurement holds the exact `event.target`. `undefined` means the question was
   * not asked (every recording made before P0.7), and must never be read as `true`.
   */
  identityMatched?: boolean;
  /**
   * WHICH of several matches was pressed - `nodes.indexOf(pressedElement)`.
   *
   * Set only when the expression matched more than one element and the pressed node
   * was among them. `null`/absent means the question could not be answered, and must
   * never be read as `0`: index zero is a measurement, absence is not.
   *
   * This is what makes `candidate.nth(k)` an EVIDENCE-BACKED locator rather than a
   * guess. `identityMatched` is necessarily false for an ambiguous expression - the
   * expression alone does not identify anything - but the expression PLUS this index
   * provably resolved to the element the person pressed, at the press, in that
   * document. It is the only circumstance in which a positional locator carries
   * identity, and it is never inferred: no recording made before this field existed
   * has one, and none may be given one afterwards.
   */
  positionWithinCandidate?: number | null;
  /** The measurement was taken in the document the press happened in. */
  sameDocument?: boolean;
  /**
   * WHEN it was measured.
   *
   *   `press` - as the person pressed, in the document they pressed in.
   *   `claim` - when the recorder saw the generated line, which for a click that
   *             navigated is a different page entirely.
   */
  measuredAt?: MeasurementTiming;
  /** Why this candidate may not be promoted. Present only on a refused one. */
  rejectionReason?: string;
  /** What stopped the measurement, when `matchCount` is null. */
  measurementError?: string;
}

/**
 * May this candidate be emitted?
 *
 * The single definition both sides share: the recorder uses it to decide which list a
 * measurement belongs in, and the resolver uses it to decide what it may promote. A
 * second copy of this rule is how the two would drift apart.
 */
export function isProvenAgainstClickedTarget(candidate: CandidateMeasurement): boolean {
  return candidate.matchCount === 1
    && candidate.identityMatched === true
    && candidate.sameDocument === true
    && candidate.measuredAt === 'press';
}

/**
 * May `candidate.nth(position)` be trusted as the pressed element's locator?
 *
 * The positional counterpart of `isProvenAgainstClickedTarget`, and deliberately not
 * a relaxation of it. That function asks whether an EXPRESSION identifies the pressed
 * element; this asks whether an expression PLUS a measured index does. Both are
 * answered by the browser at the press; neither is inferred.
 *
 * Five conditions, and every one is a measurement:
 *
 *  - measured at the press, so it describes the page the person was looking at;
 *  - in the press's own document, so it is not about some later page;
 *  - the expression matched SEVERAL elements - a count of one needs no index, and
 *    would mean this candidate belonged in `derivedCandidates` instead;
 *  - a position was recorded, which is the browser saying `nodes.indexOf(pressed)`;
 *  - the position lies inside the match list it was measured against.
 *
 * WHAT THIS DOES AND DOES NOT PROVE. It proves that at the moment of the press,
 * `expression.nth(position)` WAS the element acted on - which is exactly what a
 * positional locator has never been able to claim before. It does NOT prove the page
 * will look the same later: a row inserted above shifts every index below it. That
 * residual risk is real and is caught at run time by the cardinality resolver and by
 * the test's own assertions - it is not something this predicate can settle, and
 * pretending otherwise is the failure this whole contract exists to avoid.
 */
export function isPositionProvenAgainstClickedTarget(candidate: CandidateMeasurement): boolean {
  const position = candidate.positionWithinCandidate;
  return candidate.measuredAt === 'press'
    && candidate.sameDocument === true
    && typeof candidate.matchCount === 'number'
    && candidate.matchCount > 1
    && typeof position === 'number'
    && Number.isInteger(position)
    && position >= 0
    && position < candidate.matchCount;
}

/**
 * The same five measurements, taken when a person ASSERTED rather than when they
 * pressed - and a separate predicate for the same reason `isProvenAtPick` is separate
 * from `isProvenAgainstClickedTarget`.
 *
 * Widening the press predicate to accept `pick` would let an ACTION be resolved on a
 * measurement taken after the action had already happened, which is the failure the
 * whole timing contract exists to prevent. Two predicates, two timings, one standard of
 * proof - and the caller decides which timing its question allows.
 *
 * FOR AN ASSERTION, A PICK IS THE RIGHT MOMENT, not a weaker version of a press. The
 * assertion is a claim about the page as it stood when the person made it, so a
 * measurement taken then describes exactly the state being asserted. TC_LOGIN_107
 * asserted "not ticked" before clicking anything: there was no press to borrow from,
 * and borrowing the later one would have described a different instant.
 */
export function isPositionProvenAtPick(candidate: CandidateMeasurement): boolean {
  const position = candidate.positionWithinCandidate;
  return candidate.measuredAt === 'pick'
    && candidate.sameDocument === true
    && typeof candidate.matchCount === 'number'
    && candidate.matchCount > 1
    && typeof position === 'number'
    && Number.isInteger(position)
    && position >= 0
    && position < candidate.matchCount;
}

/** Is this candidate's position proven at EITHER timing? */
export function isPositionProven(candidate: CandidateMeasurement): boolean {
  return isPositionProvenAgainstClickedTarget(candidate) || isPositionProvenAtPick(candidate);
}

/** The positional expression this candidate proves, or null. */
export function positionalExpression(candidate: CandidateMeasurement): string | null {
  if (!isPositionProven(candidate))
    return null;
  const expression = (candidate.expression ?? '').trim();
  if (!expression)
    return null;
  return `${expression}.nth(${candidate.positionWithinCandidate})`;
}

/**
 * Why a measured candidate cannot be promoted, or null when it can.
 *
 * Ordered by what a reader needs to hear first: a measurement taken in the wrong
 * document says nothing at all, so it is reported before any number it produced.
 */
/**
 * May this candidate become an ASSERTION's locator?
 *
 * The same three substantive facts the action bar demands - one element, in the
 * document the person was looking at, and that element is the one meant - measured
 * at the moment the assertion was chosen rather than at a press.
 *
 * Separate from `isProvenAgainstClickedTarget` on purpose. Widening that predicate
 * to accept `pick` would let an ACTION be promoted on a measurement taken after the
 * action had already happened, which is the failure P0.7 exists to prevent. Two
 * predicates, two timings, one standard of proof.
 */
export function isProvenAtPick(candidate: CandidateMeasurement): boolean {
  return candidate.matchCount === 1
    && candidate.identityMatched === true
    && candidate.sameDocument === true
    && candidate.measuredAt === 'pick';
}

/**
 * Does this candidate prove IDENTITY for a step of this ROLE?
 *
 * THE ONE PLACE THAT ANSWERS "WHICH TIMING MAY THIS CALLER ACT ON", for identity, and
 * the exact counterpart of the `kind` parameter `positionRecovery` already takes for
 * position. Two predicates, two timings, one standard of proof - this only says which
 * of them a caller's question admits, and it invents no third standard.
 *
 * ACTION - a press, and nothing else. A measurement taken at any other moment describes
 * a page the action did not happen on, which is the failure the timing contract exists
 * to prevent. Widening this is not a convenience; it is the safety property.
 *
 * ASSERTION - a press OR a pick. An assertion is a claim about the page as it stood
 * when the person made it, so a measurement taken THEN describes exactly the state
 * being asserted; it is the right evidence, not a weaker one. For an assertion made
 * before anything was clicked there is no press to borrow, and borrowing a later one
 * would describe a different instant.
 *
 * WHAT THIS FIXED. TC_LOGIN_123 measured, at the pick, one element for
 * `.tabulator-row filter(hasText: "<issue description>") .bugChecked` with identity
 * matched - byte-identical to the existing `IssuesPage.issueCheckboxState(description)`.
 * Every consumer filtered it out for saying `pick`, so three assertions fell past Page
 * Object reuse to `.tabulator-table filter("close Filter : Saved Filters…") .nth(0/1)`:
 * a locator made WORSE by better evidence existing. The candidate, the count and the
 * identity were all in the file the whole time.
 */
export function provesIdentity(
  candidate: CandidateMeasurement,
  role: 'action' | 'assertion',
): boolean {
  return role === 'assertion'
    ? isProvenAgainstClickedTarget(candidate) || isProvenAtPick(candidate)
    : isProvenAgainstClickedTarget(candidate);
}

export function candidateRejection(candidate: CandidateMeasurement): string | null {
  if (candidate.matchCount === null) {
    return candidate.measurementError
      ? `could not be measured (${candidate.measurementError})`
      : 'could not be measured';
  }
  if (candidate.sameDocument === false) {
    return 'the document had already changed when this was measured, so it describes a '
      + 'different page than the one the person acted on';
  }
  if (candidate.matchCount === 0)
    return 'matched nothing';
  if (candidate.matchCount > 1)
    return `matched ${candidate.matchCount} elements`;
  if (candidate.identityMatched === false)
    return 'matched exactly one element, but not the one the person acted on';
  return null;
}

/** Everything known about one recorded target. */
export interface TargetEvidence {
  /** Codegen's locator for this target, unchanged. The join key. */
  locator: string;
  /**
   * The NAME of the registration this graph was captured from - the second join key,
   * and the only one that survives two independently written locators.
   *
   * `locator` joins a target to the line Codegen wrote for it, and that is the right
   * key for an ACTION: the action IS that line. It is the wrong key for anything that
   * arrives at the same element by another route. An assertion's locator is composed
   * from the element's own description by `locatorFor`, so `page.locator(".bugChecked")`
   * and `page.locator('[id="1749552"]')` can be one element and share no substring -
   * and TC_DASHBOARD_023 is what that costs: the assertion found no evidence, fell
   * through to the offline scorer, was emitted raw, and Playwright refused it as three
   * elements while the proof of which one was meant sat in this very file.
   *
   * This is allocated in the page when the press is parked (`refFor`, an opaque
   * `documentId:slot`), so it names a REGISTRATION, not a shape. Two things can be
   * compared by it only if the browser compared their nodes with `===`.
   *
   * Absent on an after-action capture - there was no press to name - and on every
   * recording made before it existed. Absence means the association is unavailable,
   * never that it failed.
   */
  elementRef?: string;
  target: DomNode;
  parent?: DomNode;
  ancestors: RelatedNode[];
  children: RelatedNode[];
  descendants: RelatedNode[];
  previousSiblings: RelatedNode[];
  nextSiblings: RelatedNode[];
  /** Every relationship present, so a consumer can branch without walking arrays. */
  relationships: DomRelationship[];
  matchCount: MatchCount;
  /**
   * WHEN this graph was taken, relative to the interaction it describes.
   *
   * `before-action` is the one worth having: the DOM as it was when the person acted
   * on it. `after-action` is the fallback and is exactly what Phase 8C shipped - the
   * script is written after the action, so a click that navigated, closed a modal or
   * re-rendered a virtualized row was measured against a page that had already moved
   * on. A reader must be able to tell the two apart before trusting a graph.
   *
   * `assertion-pick` is neither: no action is involved at all. The person pointed at an
   * element and said what must be true of it, and this graph was taken at that moment.
   * It is the right evidence for that assertion and the WRONG evidence for any action,
   * which is why it is a third value rather than a flavour of the other two - and why
   * `evidenceFor`, which answers "what was captured for this recorded line", skips it.
   */
  captureTiming?: 'before-action' | 'after-action' | 'assertion-pick';
  /**
   * The identity of one assertion-pick capture, distinct from `elementRef`.
   *
   * TWO DIFFERENT QUESTIONS, and conflating them is what TC_LOGIN_107 exposed.
   * `elementRef` names the NODE - ask the registry twice for the same element and the
   * same name comes back. This names the CAPTURE, because one node can be asserted
   * about more than once and each assertion is a claim about a different instant:
   * TC_LOGIN_107 asserts the same checkbox is unticked, clicks it, and asserts it is
   * ticked. Both assertions are about one element and neither may be judged on the
   * other's measurement.
   *
   * Present only on an `assertion-pick` row.
   */
  captureRef?: string;
  /** Was the element attached when the graph was taken? */
  attached?: boolean;
  /** Where it sat, and whether that was on screen. Numbers only, no content. */
  viewport?: {
    inViewport: boolean;
    /** True when the element sits inside a scrollable ancestor's clipped region. */
    scrollRequired: boolean;
    width: number;
    height: number;
  };
  /** The raw id and what the existing detector made of it. Preserved verbatim. */
  identifier?: {
    raw: string;
    dynamic: boolean;
    normalised: string;
  };
  /**
   * Alternative selectors built from this element's own evidence, each one COUNTED
   * in the page it was captured from.
   *
   * This is what makes a replacement honest. Offline, a resolver can invent
   * `#bugReport-table .tabulator-cell-draft--summary` from the ancestor chain, but it
   * cannot know whether that matches one element or forty - and a locator that
   * matches forty is not an improvement on a generated id, it is a different kind of
   * broken. Measuring the candidates while the browser is open and the element is on
   * screen is the only place that number is available.
   *
   * Empty when nothing could be derived. A candidate with `matchCount: 1` is the only
   * kind a resolver may promote.
   */
  derivedCandidates?: CandidateMeasurement[];
  /**
   * Candidates that matched SEVERAL elements but recorded which one was pressed.
   *
   * A third list, deliberately separate from the other two. `derivedCandidates`
   * carries only what matched exactly one element, and nothing may ever be promoted
   * out of `rejectedCandidates` - that rule exists precisely to stop an ambiguous
   * candidate being "improved" with `.first()`. An ambiguous candidate carrying a
   * measured position is a different thing from both: not a locator on its own, and
   * not a dead end either. Naming it separately is what keeps the older rules intact
   * while letting positional recovery read exactly what it is entitled to.
   *
   * Absent in every recording made before the measurement existed, which is why
   * positional recovery is simply unavailable for those - never approximated.
   */
  positionProvenCandidates?: CandidateMeasurement[];
  /**
   * Candidates that were measured and REFUSED, with the reason. Diagnostic only.
   *
   * Nothing may ever be promoted from this list - `derivedCandidates` is the only
   * promotable one - and every entry carries a `rejectionReason` saying why it is
   * here. It exists because the funnel used to discard them silently, which made a
   * target that had measured twelve alternatives indistinguishable from one that
   * could build none.
   */
  rejectedCandidates?: CandidateMeasurement[];
  /** How many candidates were built and measured, before any were refused. */
  candidatesTried?: number;
  /**
   * What the pressed element's OWN text identified, measured in the document of the
   * press and page-wide.
   *
   * THE MEASUREMENT NOTHING ELSE CAN TAKE. Codegen writes `page.getByText('Faclon
   * labs')` after the click, and by then the click has navigated: counting it there
   * answers a question about the page it arrived at. This is taken while the person
   * is still looking at the page they pressed, and it is what says whether the text
   * Codegen chose identified one element or several at that moment.
   *
   * `matchCount` is null when the document was too large to walk inside the budget -
   * not zero, and never 1.
   */
  pressTimeText?: {
    /** The element's own text as measured, bounded and secret-filtered. */
    text: string;
    /** How many elements that text resolved to, by the text engine's own rule. */
    matchCount: MatchCount;
    /** Was the pressed element one of them? */
    identityMatched: boolean;
  };
  /**
   * Identity of the document this graph was captured in - an opaque per-document
   * nonce, no URL and nothing about the page.
   *
   * A press and the measurement that follows it are only comparable inside ONE
   * document. `getByRole('button', { name: 'Sign In' })` measured 0 in four separate
   * recordings, not because the button was missing when it was pressed but because it
   * was counted after login had navigated away. Without an identity to compare, that
   * 0 is indistinguishable from evidence about the click.
   */
  documentId?: string;
  /**
   * Which document `matchCount` was taken in, relative to the press.
   *
   *   `same`    - the document the person pressed in. The count describes the click.
   *   `other`   - the document had already changed. `matchCount` is then `null`: a
   *               count from the page that REPLACED the one that was clicked is not
   *               weak evidence about the click, it is evidence about something else.
   *   `unknown` - no press was recorded for this target (the after-action path), so
   *               the graph and the count were both taken from the page as it is now
   *               and are consistent with each other but with no press.
   */
  matchCountDocument?: 'same' | 'other' | 'unknown';
}

export interface DomEvidence {
  available: true;
  /** ISO timestamp of capture, so stale evidence is recognisable. */
  capturedAt: string;
  /** One entry per recorded target, keyed by the Codegen locator. */
  targets: TargetEvidence[];
  limits: typeof EVIDENCE_LIMITS;
  /**
   * How the recording that produced this was made. Numbers and a transport name -
   * no content, no locators, nothing about the page.
   *
   * It rides along with the evidence rather than in a file of its own, because the
   * question it answers - "was live capture on, and did it find anything?" - is only
   * ever asked about a specific recording. TC_LOGIN_053 could not be diagnosed
   * without inspecting the artifact's first line, which is not a diagnostic.
   */
  recording?: RecordingTelemetry;
}

/** What the recorder itself did. Additive; every field is optional to a reader. */
export interface RecordingTelemetry {
  transport: 'live' | 'codegen';
  targetCount: number;
  failures: number;
  beforeActionCount: number;
  afterActionCount: number;
  evidenceBytes: number;
}

export interface DomEvidenceUnavailable {
  available: false;
  /** Why. Never an empty string - a silence reads as "captured nothing". */
  reason: string;
}

export type RecordingEvidence = DomEvidence | DomEvidenceUnavailable;

/** The state every recording is in until something captures evidence for it. */
export function evidenceUnavailable(reason: string): DomEvidenceUnavailable {
  return { available: false, reason: reason.trim() || 'no reason recorded' };
}

/* ------------------------------------------------------------------ safety */

/**
 * Attribute and property names whose VALUES must never be captured.
 *
 * The rule is the same one `recorder.ts` already applies to a recorded `fill`, and it
 * is applied again here because this is a second, wider route to the same page: a
 * capture walks the DOM, and a password input's `value` is in the DOM. The names are
 * matched case-insensitively as substrings, so `data-user-token` and `otpCode` are
 * both caught.
 */
export const FORBIDDEN_VALUE_KEYS = [
  'password', 'passwd', 'pwd', 'secret', 'token', 'otp', 'onetime', 'one-time',
  'cvv', 'cvc', 'pin', 'ssn', 'authorization', 'auth', 'cookie', 'session',
  'apikey', 'api-key', 'credential', 'bearer', 'jwt', 'private',
];

/** Input types whose value is a secret whatever it is called. */
export const FORBIDDEN_INPUT_TYPES = ['password'];

/** Would capturing this attribute's value leak a credential? */
export function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_VALUE_KEYS.some(forbidden => lower.includes(forbidden));
}

/**
 * Strip anything a capture must not keep.
 *
 * Applied to every node before it is stored, on the belt-and-braces principle the
 * rest of this subsystem already follows: the capture is expected to filter, and this
 * runs anyway, because a value that reaches disk cannot be unwritten.
 *
 * A password field is not *dropped* - knowing there is a password input at this
 * position is exactly the structural fact the graph exists to record. Its value and
 * anything that could carry a value are removed; its tag, role and label stay.
 */
export function redactNode<T extends DomNode>(node: T): T {
  const safe: DomNode = { tag: node.tag };
  if (node.role) safe.role = node.role;
  if (node.accessibleName) safe.accessibleName = truncate(node.accessibleName);
  if (node.id) safe.id = node.id;
  if (node.name) safe.name = node.name;
  if (node.type) safe.type = node.type;
  if (node.placeholder) safe.placeholder = truncate(node.placeholder);
  if (node.title) safe.title = truncate(node.title);
  if (node.stableClasses?.length) safe.stableClasses = node.stableClasses.slice(0, EVIDENCE_LIMITS.maxAttributes);
  if (node.scrollable !== undefined) safe.scrollable = node.scrollable;
  if (node.virtualized !== undefined) safe.virtualized = node.virtualized;
  if (node.virtualizedSignal) safe.virtualizedSignal = node.virtualizedSignal;

  // Text is dropped entirely for a credential-shaped field: a password input has no
  // text, but a mis-tagged one might, and the cost of being wrong is a leaked secret.
  const credentialShaped = FORBIDDEN_INPUT_TYPES.includes((node.type ?? '').toLowerCase())
    || isForbiddenKey(node.name ?? '') || isForbiddenKey(node.id ?? '');
  if (node.text && !credentialShaped)
    safe.text = truncate(node.text);

  safe.aria = filterAttributes(node.aria);
  safe.data = filterAttributes(node.data);
  if (!Object.keys(safe.aria).length) delete safe.aria;
  if (!Object.keys(safe.data).length) delete safe.data;

  // Allow-list, not overlay. `{ ...node, ...safe }` looked equivalent and was the
  // opposite: spreading the original first put every dropped field back, so a
  // password's text and a `data-auth-token` survived the redaction that had just
  // removed them. Only what was explicitly copied above leaves this function, plus
  // the two fields that say how a related node is related.
  const relationship = (node as Partial<RelatedNode>).relationship;
  const depth = (node as Partial<RelatedNode>).depth;
  return {
    ...safe,
    ...(relationship ? { relationship } : {}),
    ...(depth === undefined ? {} : { depth }),
  } as T;
}

/**
 * Does this VALUE look like a credential rather than a name?
 *
 * The key is the primary guard - `data-auth-token` is refused whatever it holds. The
 * value needs its own test for the case where a safe-looking key carries a secret,
 * but that test must be about SHAPE, not vocabulary: matching the word "password"
 * in a value threw away `data-testid="password-input"`, which is an element's name
 * and exactly the kind of stable hook the next phase is meant to find. A secret is
 * long, unbroken and mixes letters with digits; an identifier is short and readable.
 */
export function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 20 || /\s/.test(trimmed))
    return false;
  // A JWT, or a long opaque token.
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed))
    return true;
  return /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed) && /^[\w.\-+/=]+$/.test(trimmed);
}

function filterAttributes(attributes: Record<string, string> | undefined): Record<string, string> {
  const kept: Record<string, string> = {};
  if (!attributes)
    return kept;
  for (const [key, value] of Object.entries(attributes)) {
    if (isForbiddenKey(key) || looksLikeSecretValue(value))
      continue;
    if (Object.keys(kept).length >= EVIDENCE_LIMITS.maxAttributes)
      break;
    kept[key] = truncate(value);
  }
  return kept;
}

function truncate(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > EVIDENCE_LIMITS.maxTextLength
    ? `${trimmed.slice(0, EVIDENCE_LIMITS.maxTextLength - 1)}…`
    : trimmed;
}

/**
 * Apply every bound and every redaction rule to a captured graph.
 *
 * The single funnel: whatever captures evidence hands it here, and what comes out is
 * safe to write and small enough to keep. A capture cannot opt out of it, because the
 * consumer only ever reads what this returns.
 */
export function sanitiseEvidence(
  targets: TargetEvidence[],
  capturedAt: string,
  recording?: RecordingTelemetry,
): DomEvidence {
  return {
    available: true,
    capturedAt,
    limits: EVIDENCE_LIMITS,
    ...(recording ? { recording } : {}),
    targets: targets.map(entry => ({
      locator: entry.locator,
      // The registration this graph came from. Carried verbatim because there is
      // nothing in it to redact - an opaque per-document nonce and a slot number, no
      // URL, no text, no attribute - and dropped when the capture had no press behind
      // it, so absence keeps meaning "unavailable" rather than "not proven".
      ...(entry.elementRef ? { elementRef: entry.elementRef } : {}),
      // The identity of one assertion-pick capture. Opaque, derived from the element's
      // own registration name and a per-recording counter; nothing about the page.
      ...(entry.captureRef ? { captureRef: entry.captureRef } : {}),
      target: redactNode(entry.target),
      ...(entry.parent ? { parent: redactNode(entry.parent) } : {}),
      ancestors: entry.ancestors.slice(0, EVIDENCE_LIMITS.maxAncestors).map(redactNode),
      children: entry.children.slice(0, EVIDENCE_LIMITS.maxChildren).map(redactNode),
      descendants: entry.descendants
          .filter(node => node.depth <= EVIDENCE_LIMITS.maxDescendantDepth)
          .slice(0, EVIDENCE_LIMITS.maxDescendants)
          .map(redactNode),
      previousSiblings: entry.previousSiblings.slice(0, EVIDENCE_LIMITS.maxPreviousSiblings).map(redactNode),
      nextSiblings: entry.nextSiblings.slice(0, EVIDENCE_LIMITS.maxNextSiblings).map(redactNode),
      relationships: [...new Set(entry.relationships)],
      ...(entry.captureTiming ? { captureTiming: entry.captureTiming } : {}),
      ...(entry.attached === undefined ? {} : { attached: entry.attached }),
      ...(entry.viewport ? { viewport: entry.viewport } : {}),
      // Never defaulted. `null` is "not measured" and must survive as itself.
      matchCount: entry.matchCount,
      ...(entry.matchCountDocument ? { matchCountDocument: entry.matchCountDocument } : {}),
      ...(entry.pressTimeText
        ? {
          pressTimeText: {
            ...entry.pressTimeText,
            text: entry.pressTimeText.text.slice(0, EVIDENCE_LIMITS.maxTextLength),
          },
        }
        : {}),
      ...(entry.documentId ? { documentId: entry.documentId } : {}),
      // Only promotable candidates are carried forward. A candidate that matched
      // several elements is not a locator, and keeping it in this list invites
      // somebody downstream to "improve" it with .first(). One that was measured
      // against the pressed element and turned out to be a DIFFERENT element is
      // refused here too, whatever its count says.
      ...(entry.derivedCandidates?.length
        ? {
          derivedCandidates: entry.derivedCandidates
              .filter(candidate => candidate.matchCount === 1 && candidate.identityMatched !== false)
              .map(redactCandidate),
        }
        : {}),
      // AMBIGUOUS BUT POSITIONED, kept in its own list. The filter above admits only
      // what matched exactly one element, and it stays that way; this is the separate
      // channel described on `positionProvenCandidates`. Only candidates whose
      // position the browser actually measured are carried, so absence here always
      // means "not measured" and never "index 0".
      // READ FROM ITS OWN LIST, not by filtering `derivedCandidates`. That filter
      // could never match: the list above admits `matchCount === 1` only, and a
      // position exists precisely when the count is greater than one - so the two
      // conditions were mutually exclusive and this block was unreachable. The
      // recorder now hands the positioned candidates over separately. The predicate
      // is still applied here, so nothing lands in the file that cannot prove itself.
      // EITHER TIMING, and the predicate still decides. A press proves it for an action;
      // a pick proves it for the assertion that was being made at that moment. What is
      // refused is unchanged: no measurement, no position, or a position outside the
      // match list it was measured against.
      ...((entry.positionProvenCandidates ?? []).some(isPositionProven)
        ? {
          positionProvenCandidates: (entry.positionProvenCandidates ?? [])
              .filter(isPositionProven)
              .slice(0, EVIDENCE_LIMITS.maxRejectedCandidates)
              .map(redactCandidate),
        }
        : {}),
      // Refused candidates travel too, bounded and each carrying its reason. Nothing
      // may be promoted from here - it exists so that "twelve were measured and every
      // one matched several elements" stops reading as "none could be built", which
      // is what the log said for every target before P0.7.
      ...(entry.rejectedCandidates?.length
        ? {
          rejectedCandidates: entry.rejectedCandidates
              .slice(0, EVIDENCE_LIMITS.maxRejectedCandidates)
              .map(candidate => ({
                ...redactCandidate(candidate),
                rejectionReason: candidate.rejectionReason ?? candidateRejection(candidate) ?? 'refused',
              })),
        }
        : {}),
      ...(typeof entry.candidatesTried === 'number' ? { candidatesTried: entry.candidatesTried } : {}),
      ...(entry.identifier ? { identifier: entry.identifier } : {}),
    })),
  };
}

/** One candidate, bounded. The expression is the only unbounded thing it carries. */
function redactCandidate(candidate: CandidateMeasurement): CandidateMeasurement {
  return {
    ...candidate,
    expression: candidate.expression.slice(0, EVIDENCE_LIMITS.maxCandidateExpression),
  };
}

/**
 * The key two independently-written strings must agree on to describe one element.
 *
 * The recorder stores the chain exactly as Codegen wrote it; the live capture reads
 * the same chain out of the generated script. Codegen wraps a long chain across
 * lines, so the two can differ by whitespace alone and the evidence would then be
 * filed under a key nothing looks up. Runs of whitespace OUTSIDE quotes collapse to
 * one space; whitespace inside a quoted string is untouched, because
 * `getByText('a  b')` and `getByText('a b')` are different locators.
 *
 * This normalises the KEY only. The locator that gets emitted into a spec is always
 * the recorded one, unchanged.
 */
export function locatorKey(locator: string): string {
  let key = '';
  let quote = '';
  let pendingSpace = false;
  for (let index = 0; index < locator.length; index++) {
    const character = locator[index];
    if (quote) {
      key += character;
      if (character === '\\') {
        key += locator[++index] ?? '';
        continue;
      }
      if (character === quote)
        quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      if (pendingSpace) { key += ' '; pendingSpace = false; }
      quote = character;
      key += character;
      continue;
    }
    // Outside a quoted string, whitespace in a locator expression is never
    // significant - `locator('#x')\n  .getByText('y')` and `locator('#x').getByText('y')`
    // are the same chain, and Codegen wraps long ones. Dropping it entirely (rather
    // than collapsing to one space) is what makes the wrapped and flat forms produce
    // the same key; collapsing left a stray space before the dot and the two
    // producers still disagreed.
    if (/\s/.test(character))
      continue;
    if (pendingSpace)
      pendingSpace = false;
    key += character;
  }
  return key.trim();
}

/**
 * The evidence for one recorded locator, or null when there is none.
 *
 * ASSERTION-PICK ROWS ARE NOT VISIBLE HERE, deliberately. This function answers "what
 * was captured FOR this locator", and a pick row was captured for a NODE - the picker
 * composed its expression afterwards from the element's own description. Two different
 * elements can compose the same expression (two checkboxes both yield `.bugChecked`),
 * so matching a pick row by string is precisely the wrong association this whole
 * mechanism exists to remove. Pick rows are reached by `captureRef` and nothing else.
 */
export function evidenceFor(evidence: RecordingEvidence | undefined, locator: string): TargetEvidence | null {
  if (!evidence?.available)
    return null;
  const wanted = locatorKey(locator);
  return evidence.targets.find(entry => entry.captureTiming !== 'assertion-pick'
    && locatorKey(entry.locator) === wanted) ?? null;
}


/* ------------------------------------------- assertion-to-target provenance */

/**
 * WHICH ELEMENT an assertion is about, recorded at the moment the person said so.
 *
 * Written by the picker, read by the generator, and it carries no opinion: `refs` are
 * the names of registrations the BROWSER matched to the asserted element with `===`,
 * and `locatorMatchCount` is what the assertion's own locator counted in that same
 * document at that same moment. Neither is derived from a selector, an id, a class, a
 * position in the recording or the previous step.
 *
 * THE ASSERTED ELEMENT, not necessarily the association resolver's subject. A state
 * assertion is about the control that holds the state; a visibility assertion is about
 * what the pointer was on, because a custom switch's subject is a 0x0 input the
 * application hides on purpose. `recordPickedAssertion` makes that choice and supplies
 * the slot; nothing here re-decides it.
 *
 * `refs` may hold more than one name for a single node: `pointerdown` and `focusin`
 * both park the input a label forwards to, so one element can be registered twice.
 * That is a multiplicity of NAMES, never of elements - every name in the list was
 * proven against the same node.
 */
export interface AssertionProvenance {
  /** Registrations whose node IS the asserted element. Empty is impossible: absent instead. */
  refs: string[];
  /**
   * The `captureRef` of the graph taken FOR THIS ASSERTION, at the moment it was made.
   *
   * `refs` say which element; this says which measurement. Both matter and they are not
   * the same: TC_LOGIN_107 asserts one checkbox is unticked, clicks it, and asserts it
   * is ticked, so two assertions share an element and must not share an instant. The
   * first assertion had no press to borrow evidence from at all, which is the whole
   * reason this field exists.
   *
   * Absent when the capture could not be taken - the hook was missing, the document had
   * changed, the element had gone. The assertion then falls back to `refs`, which finds
   * an action's row for the same element if the recording has one, and to no evidence at
   * all if it does not. Nothing is approximated.
   */
  captureRef?: string;
  /**
   * What the assertion's OWN locator matched, in the document of the pick.
   *
   * The measurement that has never existed for an assertion. A recorded target's
   * `matchCount` is a count of the locator CODEGEN wrote; the picker composes its own,
   * so nothing had ever counted the string that actually reaches the spec. `null` when
   * the count could not be taken - never 0, and never 1 by default.
   */
  locatorMatchCount: MatchCount;
}

/**
 * The most names a single assertion may carry.
 *
 * Not a policy number: it is the page's own press-queue bound (`MAX` in
 * PREACTION_HOOK), because that queue is what `__auraSameElement` walks, so no honest
 * answer can be longer. A longer list did not come from that page and is refused
 * rather than truncated - truncating could drop the very name that matches.
 */
const MAX_PROVENANCE_REFS = 60;

/**
 * Read a provenance record off disk, or refuse it.
 *
 * The assertions sidecar is a file anything could have written, and a malformed
 * provenance must degrade to "this assertion has none" rather than reach the
 * association with a string where a number belongs. Same rule the evidence sidecar
 * follows, and for the same reason.
 */
export function readAssertionProvenance(value: unknown): AssertionProvenance | null {
  if (!value || typeof value !== 'object')
    return null;
  const raw = value as Partial<AssertionProvenance>;
  if (!Array.isArray(raw.refs))
    return null;
  const refs = raw.refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0);
  if (!refs.length || refs.length > MAX_PROVENANCE_REFS)
    return null;
  const count = raw.locatorMatchCount;
  if (count !== null && !(typeof count === 'number' && Number.isInteger(count) && count >= 0))
    return null;
  // A capture name is optional, and a malformed one is DROPPED rather than failing the
  // whole record: without it the assertion falls back to node identity, which is the
  // behaviour every recording made before pick-time capture already has.
  const captureRef = typeof raw.captureRef === 'string' && raw.captureRef
    ? raw.captureRef : undefined;
  return {
    refs: [...new Set(refs)], locatorMatchCount: count,
    ...(captureRef ? { captureRef } : {}),
  };
}

/**
 * The recorded target this provenance names - or nothing, with the reason.
 *
 * ONE, or none. A name matches at most one registration by construction, but two
 * registrations of the same node can each have become a recorded target (a `click`
 * and a `check` on the same input write two lines and claim two parked entries), and
 * then two graphs of one element are both true and were taken at different moments.
 * Choosing between them is judgement, so it is refused and said out loud. That is the
 * cost of not guessing, and it is the correct cost.
 */
export function targetByElementRef(
  evidence: RecordingEvidence | undefined,
  refs: string[],
): { target: TargetEvidence | null; why: string } {
  if (!evidence?.available)
    return { target: null, why: 'this recording carries no DOM evidence' };
  const wanted = new Set(refs);
  // ACTION ROWS ONLY. A pick row is reached by its own `captureRef`, never by node
  // identity: one node can be asserted about repeatedly, so several pick rows can share
  // an `elementRef`, and matching on that would make every one of them ambiguous.
  const matches = evidence.targets.filter(entry =>
    entry.captureTiming !== 'assertion-pick'
    && typeof entry.elementRef === 'string' && wanted.has(entry.elementRef));
  if (!matches.length) {
    return {
      target: null,
      why: 'no recorded target was captured from the registration this assertion names - the '
        + 'element it is about was never the subject of a recorded action, or its press was '
        + 'made before this recording could name one',
    };
  }
  if (matches.length > 1) {
    return {
      target: null,
      why: `${matches.length} recorded targets were captured from this same element at different `
        + 'moments, and each graph is true of a different instant. Which one an assertion should '
        + 'be judged against is a decision for a person, so none is chosen',
    };
  }
  return { target: matches[0], why: `captured from the same element (${matches[0].locator})` };
}

/**
 * The pick-time capture with this name, or nothing with the reason.
 *
 * A `captureRef` names exactly one capture, so unlike node identity there is nothing to
 * choose between: either the row is in the file or it is not. It is absent when the
 * capture failed at record time, and the caller then falls back to node identity.
 */
function captureByRef(
  evidence: RecordingEvidence | undefined,
  captureRef: string,
): { target: TargetEvidence | null; why: string } | null {
  if (!evidence?.available)
    return null;
  const target = evidence.targets.find(entry => entry.captureTiming === 'assertion-pick'
    && entry.captureRef === captureRef);
  if (!target)
    return null;
  return {
    target,
    why: 'measured for this element at the moment the assertion was made'
      + (target.elementRef ? ` (${target.elementRef})` : ''),
  };
}

/**
 * The evidence an assertion may be JUDGED against, when provenance names one.
 *
 * WHY THIS IS A PROJECTION AND NOT THE ROW ITSELF. A recorded target holds two kinds
 * of fact, and only one of them is about the element.
 *
 *   ELEMENT-LEVEL - the node, its parent, its ancestors, its siblings, every measured
 *   candidate and every refused one, what its own text identified at the press. All of
 *   it is true of the element however you address it, so all of it transfers.
 *
 *   LOCATOR-LEVEL - `locator`, `matchCount`, `matchCountDocument`, `identifier`. Each
 *   is a statement about the EXPRESSION Codegen wrote. Carrying them over would make
 *   the resolver read "the browser measured 1 element for this locator" about a string
 *   the browser never counted, and `identifier` would send an assertion whose own
 *   locator is a clean role-and-name down the generated-id branch and out the other
 *   side as an index - a locator made WORSE by evidence existing, which is exactly the
 *   defect the decision order was rewritten to remove.
 *
 * So this is an ALLOW-LIST, deliberately, rather than a spread with overrides: a field
 * added to `TargetEvidence` tomorrow does not transfer until somebody decides it is
 * true of the element rather than of the expression.
 *
 * `matchCount` becomes the picker's own measurement of the assertion's own locator -
 * a real count, taken in the page the person was looking at, of the string that will
 * reach the spec. `matchCountDocument` is `same` only when that count exists: the
 * registry that proved the identity is per-document, so a matched ref IS the press's
 * document, and an absent count says `unknown` rather than naming a document.
 */
export function evidenceForAssertionSubject(
  evidence: RecordingEvidence | undefined,
  assertion: { locator?: string; subjectProvenance?: AssertionProvenance },
): { evidence: TargetEvidence; why: string } | null {
  const provenance = assertion.subjectProvenance;
  if (!provenance?.refs?.length)
    return null;
  // THE ASSERTION'S OWN CAPTURE FIRST, and this order is the point.
  //
  // A pick row was measured at the instant the person made this claim, so it describes
  // exactly the state being asserted. An action row describes a different instant - and
  // for TC_LOGIN_107's first assertion, an instant that had not happened yet. Falling
  // back to node identity keeps every recording made before pick-time capture working
  // exactly as it did; preferring it would judge an assertion on somebody else's moment.
  const own = provenance.captureRef
    ? captureByRef(evidence, provenance.captureRef)
    : null;
  const found = own ?? targetByElementRef(evidence, provenance.refs);
  if (!found.target)
    return null;
  const target = found.target;
  return {
    why: found.why,
    evidence: {
      // The expression this projection describes the element BY. Stated, so a reason
      // line quoting it cannot be quoting somebody else's locator.
      locator: assertion.locator ?? target.locator,
      elementRef: target.elementRef,
      ...(target.captureRef ? { captureRef: target.captureRef } : {}),
      target: target.target,
      ...(target.parent ? { parent: target.parent } : {}),
      ancestors: target.ancestors,
      children: target.children,
      descendants: target.descendants,
      previousSiblings: target.previousSiblings,
      nextSiblings: target.nextSiblings,
      relationships: target.relationships,
      matchCount: provenance.locatorMatchCount,
      matchCountDocument: typeof provenance.locatorMatchCount === 'number' ? 'same' : 'unknown',
      ...(target.captureTiming ? { captureTiming: target.captureTiming } : {}),
      ...(target.attached === undefined ? {} : { attached: target.attached }),
      ...(target.viewport ? { viewport: target.viewport } : {}),
      ...(target.derivedCandidates ? { derivedCandidates: target.derivedCandidates } : {}),
      ...(target.positionProvenCandidates
        ? { positionProvenCandidates: target.positionProvenCandidates } : {}),
      ...(target.rejectedCandidates ? { rejectedCandidates: target.rejectedCandidates } : {}),
      ...(typeof target.candidatesTried === 'number' ? { candidatesTried: target.candidatesTried } : {}),
      ...(target.pressTimeText ? { pressTimeText: target.pressTimeText } : {}),
      ...(target.documentId ? { documentId: target.documentId } : {}),
      // identifier is DELIBERATELY absent. See the note above: it describes the id the
      // recorded expression was built on, and this expression is a different one.
    },
  };
}

/**
 * Is this shape a `DomEvidence` we are willing to trust?
 *
 * Structural only - it exists because a sidecar is a file on disk that anything could
 * have written or truncated, and a half-written graph must degrade to "no evidence"
 * rather than throw somewhere deep in the resolver.
 */
export function isDomEvidence(value: unknown): value is DomEvidence {
  if (!value || typeof value !== 'object')
    return false;
  const candidate = value as Partial<DomEvidence>;
  if (candidate.available !== true || !Array.isArray(candidate.targets))
    return false;
  return candidate.targets.every(entry => entry
    && typeof entry === 'object'
    && typeof (entry as TargetEvidence).locator === 'string'
    && typeof (entry as TargetEvidence).target === 'object'
    && Array.isArray((entry as TargetEvidence).ancestors)
    && ((entry as TargetEvidence).matchCount === null
      || typeof (entry as TargetEvidence).matchCount === 'number'));
}

/* ------------------------------------------------- candidate construction */

/** How many candidates are worth measuring for one element. */
export const MAX_CANDIDATES = 16;
/**
 * How many of those may be content-aware.
 *
 * Deliberately small. Content candidates go first so the cap cannot discard them, and
 * every slot they take is one an existing structural candidate loses - so they take
 * few. Three covers the shapes that can differ: the element's own class, its class
 * pair, and the scope alone.
 */
export const MAX_CONTENT_CANDIDATES = 3;

/**
 * The longest text a candidate may carry.
 *
 * `hasText` and `getByText` both match a SUBSTRING, so bounding a long summary leaves
 * a valid - merely looser - discriminator rather than a broken one. A shorter prefix
 * can only ever match MORE elements, and matching more is exactly what the measurement
 * rejects. Bounding can therefore never manufacture a false unique match.
 */
export const CANDIDATE_TEXT_LIMIT = 80;

/** One selector worth measuring, and how a content discriminator narrows it. */
export interface SelectorCandidate {
  strategy: string;
  /** The CSS selector this starts from. Always structural, never text. */
  selector: string;
  /** The content discriminator, when this candidate is content-aware. */
  text?: string;
  /**
   * How `text` narrows `selector`:
   *   `filter`  - keep the element `selector` matched, require it to contain the text.
   *   `descend` - take the text-bearing element inside it.
   *   `within`  - keep the element `selector` matched, require the text, then take
   *               `descendant` inside it. The contextual shape.
   */
  textMode?: 'filter' | 'descend' | 'within';
  /**
   * The element to take INSIDE the text-identified container, for `within`.
   *
   * Carried as its own field rather than folded into `selector` because both
   * measurement sites rebuild the locator from these parts - the batched in-page
   * one and the claim-time Playwright one - and neither parses `expression`.
   */
  descendant?: string;
  /** The Playwright expression this stands for. Rendered here so one place owns it. */
  expression: string;
}

/** One line, single spaces, bounded. A whitespace difference is not evidence. */
export function normaliseCandidateText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, CANDIDATE_TEXT_LIMIT).trim();
}

/**
 * Text that may be used to tell one element from its identical siblings - or null.
 *
 * Refused, in order: nothing at all, a single character, a secret-shaped value, a run
 * of digits and punctuation, and a lone token that reads like a generated id.
 *
 * The generated-id test is applied ONLY to a single token. `analyseIdentifier` exists
 * to judge identifiers; a sentence that happens to quote an issue number ("Line Chart
 * 638717 is blank") is prose about the screen, and rejecting it would throw away the
 * one discriminator this path exists to find.
 */
export function usableCandidateText(
  value: string | undefined,
  isGenerated: (value: string) => boolean,
): string | null {
  if (!value)
    return null;
  const text = normaliseCandidateText(value);
  // Empty, whitespace-only, or a single character that separates nothing.
  if (text.length < 2)
    return null;
  if (looksLikeSecretValue(text))
    return null;
  // At least one character that is not a digit, space, punctuation or symbol. Written
  // as a negated class rather than /[A-Za-z]/ so a non-Latin label still qualifies.
  if (!/[^\d\s\p{P}\p{S}]/u.test(text))
    return null;
  if (!/\s/.test(text) && isGenerated(text))
    return null;
  return text;
}

/**
 * The textual discriminator the RECORDING itself states, if any.
 *
 * Codegen writes down what it used to find the element, and when that is a text or an
 * accessible name it beats anything derived: it is what a person saw. The innermost
 * one wins, because a chain narrows left to right.
 */
export function recordedTextLiteral(locator: string | undefined): string | null {
  if (!locator)
    return null;
  let found: string | null = null;
  const segment =
    /\.(getByText|getByTitle|getByAltText|getByLabel|getByPlaceholder|getByRole)\(([^]*?)\)(?=\s*\.|\s*$)/g;
  for (const match of locator.matchAll(segment)) {
    const args = match[2];
    if (match[1] === 'getByRole') {
      const name = /name\s*:\s*(['"`])([^]*?)\1/.exec(args);
      if (name)
        found = name[2];
    } else {
      const literal = /^\s*(['"`])([^]*?)\1/.exec(args);
      if (literal)
        found = literal[2];
    }
  }
  return found;
}

/**
 * The text a content-aware candidate should use for this graph, or null.
 *
 * Order: what the recording states, then the element's own text, then a descendant
 * whose text IS the element's text - a container whose label lives one level down.
 *
 * THE ELEMENT MUST ACTUALLY CARRY THE TEXT. A recorded literal is preferred for its
 * wording, but only when the target's own text contains it. `getByRole('textbox', {
 * name: 'Email' })` names an <input>, and an input holds no text: `hasText` would
 * measure zero, and `getByText` would descend to the LABEL - a different node than the
 * one recorded, which could measure exactly one and be promoted. An accessible name
 * that comes from a label or an aria attribute is not this element's content.
 *
 * A PARENT's text is deliberately not a source either, for the same reason: it
 * identifies the parent. The one case where it would be safe is a wrapper whose text
 * equals the target's, and that is already covered by the target's own text.
 */
export function candidateTextFor(graph: {
  target: DomNode;
  descendants?: RelatedNode[];
  locator?: string;
}, isGenerated: (value: string) => boolean): string | null {
  const ownText = normaliseCandidateText(graph.target.text ?? '');
  const recorded = usableCandidateText(recordedTextLiteral(graph.locator) ?? undefined, isGenerated);
  if (recorded && ownText.toLowerCase().includes(recorded.toLowerCase()))
    return recorded;
  const own = usableCandidateText(graph.target.text, isGenerated);
  if (own)
    return own;
  for (const node of graph.descendants ?? []) {
    const text = usableCandidateText(node.text, isGenerated);
    // Only a descendant that carries the element's whole visible text. One that merely
    // contains some other string is a different element's label, not this one's.
    if (text && ownText && normaliseCandidateText(node.text ?? '') === ownText)
      return text;
  }
  return null;
}

/** The Playwright expression for a content-aware candidate. */
export function contentExpression(
  selector: string,
  text: string,
  textMode: 'filter' | 'descend',
): string {
  const base = `page.locator(${JSON.stringify(selector)})`;
  return textMode === 'filter'
    ? `${base}.filter({ hasText: ${JSON.stringify(text)} })`
    : `${base}.getByText(${JSON.stringify(text)})`;
}

/**
 * Selectors worth MEASURING for one captured element, derived from its own graph.
 *
 * Pure: it builds strings, it does not know whether any of them is unique. Uniqueness
 * is decided by counting each one in the live page (`live-recorder.ts`), and only a
 * candidate measured at exactly one element may ever be emitted.
 *
 * WHY A DYNAMIC SCOPE IS NOT JUST NOISE
 *
 * `#tc_summary_638717 >> getByText('…')` carries two facts: an id that will not exist
 * next session, and the STRUCTURE around the element - it sits in a summary container,
 * inside `#bugReport-table`. Dropping the id and keeping only the text threw the
 * structure away, and TC_LOGIN_042 showed what that costs: the application renders the
 * same text twice, once for mobile (`visible-xs`) and once for desktop (`hidden-xs`),
 * so the text alone resolves to two elements and can never be clicked. The id was
 * doing the disambiguation.
 *
 * So the families below rebuild the structure from stable parts only - ancestor ids
 * that are not generated, classes that survive the capture's generated-class filter,
 * test ids - and pair them with the element's own text. Nothing here is specific to
 * any application: it reads what the graph contains.
 */
/* ------------------------------------------- contextual (container) candidates */

/**
 * Words that describe a MOMENT rather than a thing.
 *
 * A container is identified by what it structurally IS - a row, a card, a list
 * item - never by what it happens to be doing. Bugasura's issue row carries
 * `tabulator-row animated fadeIn` while it is drawing and gains
 * `tabulator-selected` the instant it is clicked: the same element captured twice
 * in one recording had two different class lists. A container built on any of
 * those would be a locator for a state.
 */
export const STATE_CLASS_TOKENS: ReadonlySet<string> = new Set([
  'selected', 'active', 'inactive', 'disabled', 'enabled', 'open', 'opened', 'closed',
  'animated', 'fadein', 'fadeout', 'focused', 'focus', 'checked', 'unchecked', 'hover',
  'hovered', 'collapsed', 'expanded', 'hidden', 'visible', 'loading', 'pending',
  'dragging', 'sorted', 'current', 'highlighted', 'pressed', 'busy', 'show', 'shown',
  'error', 'success', 'warning', 'invalid', 'valid', 'empty', 'dirty', 'touched',
]);

/**
 * Is this class name about state rather than structure?
 *
 * Split on the separators authors actually use, so a compound name is judged by
 * its parts: `tabulator-selected` is state, `tabulator-row` is not. `is-`, `has-`
 * and `js-` are dropped first - they are prefixes that say nothing on their own.
 * Erring towards refusal is deliberate: a refused container costs a candidate, an
 * accepted stateful one costs a test that passes only while the row is selected.
 */
export function looksLikeStateClass(name: string): boolean {
  const normalised = name.trim().toLowerCase();
  if (!normalised)
    return true;
  const segments = normalised.split(/[-_]+/).filter(Boolean)
      .filter(segment => segment !== 'is' && segment !== 'has' && segment !== 'js');
  if (!segments.length)
    return true;
  return segments.some(segment => STATE_CLASS_TOKENS.has(segment));
}

/**
 * Characters that do not appear in a label a person reads.
 *
 * A container's captured text is everything inside it - and inside Bugasura's
 * `#bugReport-table` that includes an inline <script>, whose text begins
 * `var email_lo = "maneeswar.reddy@moolya.com"; …`. `textContent` does not
 * distinguish script source from prose, `looksLikeSecretValue` does not recognise
 * an address, and a rejected candidate still keeps its expression in the evidence
 * sidecar - so without this the account's email would have been written to disk
 * inside a locator, and possibly into a generated spec.
 *
 * Deliberately a character test rather than a language one: `=`, `;`, `{`, `@`
 * and quotes are what separate code and addresses from a sentence on a screen. It
 * costs the occasional legitimate phrase with brackets in it, which costs one
 * candidate; the alternative costs a leak.
 */
const NOT_PROSE = /[=;{}<>@\$|()"'`]/;

/** How much of a container's text may become its identifying phrase. */
export const CONTAINER_PHRASE = {
  maxWords: 12, maxChars: 60, minWords: 3, minChars: 12,
} as const;

/** Ancestors considered as containers, nearest first. */
export const MAX_CONTAINER_ANCESTORS = 4;

/** Contextual candidates built per target. Bounded so they cannot crowd the list. */
export const MAX_CONTAINER_CANDIDATES = 3;

/**
 * A phrase that identifies a container by what it says - or null.
 *
 * The hard part is that a container's text is not a label; it is everything
 * inside it, dynamic parts included. Bugasura's row reads
 *
 *   "639978 Line Chart : Getting flat line for Weekly and monthly periodicities…"
 *
 * and `639978` is the issue id - the very identifier the dynamic-id policy exists
 * to keep out of locators. Using the text verbatim would smuggle it back in
 * through a `hasText`, which is why every volatile token is dropped and the
 * LONGEST CONTIGUOUS run of what survives is what gets used.
 *
 * Truncation is the second trap. The capture caps text at `maxTextLength` with no
 * marker, so a string at the cap may end mid-word - "…and also displayi". The last
 * token of a capped string is therefore discarded rather than matched against.
 * The phrase is capped far below that boundary anyway, so nothing usable is lost.
 *
 * Nothing here invents text: every word returned was captured from the page, in
 * the order the page had it.
 */
export function containerPhraseFor(
  node: { text?: string },
  isGenerated: (value: string) => boolean,
): string | null {
  const raw = (node.text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw)
    return null;
  // A container that TALKS about a credential is refused whole, not pruned. Dropping
  // the forbidden word and keeping its neighbours would leave the value in the
  // phrase - `password = hunter2 and more` becomes `hunter2 and more`, which is the
  // secret with its label removed. The same key list the redaction funnel uses.
  if (isForbiddenKey(raw))
    return null;
  const tokens = raw.split(' ').filter(Boolean);
  if (raw.length >= EVIDENCE_LIMITS.maxTextLength)
    tokens.pop();

  // Volatile tokens BREAK the run rather than being skipped over: the words on
  // either side of an id are not necessarily adjacent on the screen.
  const runs: string[][] = [];
  let run: string[] = [];
  for (const token of tokens) {
    const bare = token.replace(/[^\p{L}\p{N}]/gu, '');
    const volatileToken = NOT_PROSE.test(token)
      || (bare.length > 0 && (/^\d+$/.test(bare) || isGenerated(bare)));
    if (volatileToken) {
      if (run.length)
        runs.push(run);
      run = [];
      continue;
    }
    run.push(token);
  }
  if (run.length)
    runs.push(run);

  const best = runs.sort((left, right) => right.join(' ').length - left.join(' ').length)[0];
  if (!best)
    return null;

  const words: string[] = [];
  let length = 0;
  for (const token of best) {
    if (words.length >= CONTAINER_PHRASE.maxWords)
      break;
    const next = length === 0 ? token.length : length + 1 + token.length;
    if (next > CONTAINER_PHRASE.maxChars)
      break;
    words.push(token);
    length = next;
  }
  // A phrase must not end on punctuation left dangling by the cap.
  while (words.length && !/[\p{L}\p{N}]/u.test(words[words.length - 1]))
    words.pop();

  const phrase = words.join(' ').trim();
  if (words.length < CONTAINER_PHRASE.minWords || phrase.length < CONTAINER_PHRASE.minChars)
    return null;
  // Backstop. The token test above should have caught it; this makes the property
  // true of the RESULT rather than of the path that produced it.
  if (NOT_PROSE.test(phrase))
    return null;
  // The same secret/digits/generated rules every other candidate text passes.
  return usableCandidateText(phrase, isGenerated);
}

/** The Playwright expression for a contextual candidate. Composition, never XPath. */
export function containerExpression(
  container: string,
  phrase: string,
  descendant: string,
): string {
  return `page.locator(${JSON.stringify(container)})`
    + `.filter({ hasText: ${JSON.stringify(phrase)} })`
    + `.locator(${JSON.stringify(descendant)})`;
}

/**
 * A selector for an element's own id.
 *
 * `#name` for an ordinary CSS identifier, which is what almost every authored id
 * is and what the rest of this file already emits for ancestor scopes. Anything
 * else falls back to `[id="..."]`, which means the same thing and cannot be
 * misread: an id like `a.b` would make `#a.b` an id AND a class, and `foo bar`
 * would make it a descendant selector - a selector that silently matches
 * something else is worse than no candidate. The quoted form is escaped by the
 * caller's existing `escape`, the same one `[data-testid="..."]` uses; nothing
 * new is invented here.
 */
function idSelector(id: string, escape: (value: string) => string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) ? `#${id}` : `[id="${escape(id)}"]`;
}

export function candidateSelectorsFor(graph: {
  target: DomNode;
  parent?: DomNode;
  ancestors?: RelatedNode[];
  descendants?: RelatedNode[];
  previousSiblings?: RelatedNode[];
  nextSiblings?: RelatedNode[];
  /** Codegen's own locator for this target, when the caller has it. */
  locator?: string;
}, isGenerated: (value: string) => boolean): SelectorCandidate[] {
  const built: SelectorCandidate[] = [];
  const add = (candidate: SelectorCandidate) => {
    if (candidate.selector && !built.some(entry => entry.expression === candidate.expression))
      built.push(candidate);
  };
  // Quotes and backslashes only: a class or id going into a CSS selector.
  const escape = (value: string) => value.split('"').join('\\"').split('\\').join('\\\\');

  const structural = (strategy: string, selector: string) =>
    add({ strategy, selector, expression: `page.locator(${JSON.stringify(selector)})` });

  const target = graph.target;
  const testId = target.data?.['data-testid'] ?? target.data?.['data-test-id'];
  if (testId)
    structural('test-id', `[data-testid="${escape(testId)}"]`);

  // The element's OWN id, second only to a test id: both are the element naming
  // itself, which is the strongest thing a page offers.
  //
  // It was missing entirely, and TC_LOGIN_077 is what that cost. Codegen writes the
  // locator it prefers - `getByRole('link', { name: 'Notifications' })` for an
  // `<a id="notif_bell_trigger" aria-label="Notifications">` - and on the Manage
  // screen that name belongs to more than one anchor. The bell carries no classes
  // and no test id, so every candidate built from classes described its PARENT and
  // was correctly refused on identity, and the one selector that identifies it was
  // never offered. Ancestor ids were already used, but only as scopes.
  //
  // Nothing here decides anything: it is a candidate, measured at the press like
  // every other, and refused unless it matches exactly one element AND that element
  // is the one the person pressed. A dynamic id is excluded by the SAME rule the
  // ancestor scopes use - `#tc_summary_636432` names one Bugasura issue, not one
  // element.
  if (target.id && !isGenerated(target.id))
    structural('stable-id', idSelector(target.id, escape));

  // Ancestors whose id was authored, nearest first. These are the scopes worth using.
  const stableAncestors = (graph.ancestors ?? [])
      .filter(node => node.id && !isGenerated(node.id))
      .slice(0, 3);
  const targetClasses = (target.stableClasses ?? []).filter(name => !isGenerated(name));
  const parentClasses = (graph.parent?.stableClasses ?? []).filter(name => !isGenerated(name));

  // ---- Content-aware candidates, BEFORE the structural sweep.
  //
  // Inside a repeating container every row carries the same classes, so no
  // scope+class+tag combination can ever be unique - TC_LOGIN_059 measured twelve of
  // them and every one matched more than one element. What separates one row from the
  // next is what it SAYS, and the graph already holds that. These come first because
  // the list is capped: appended last they would be sliced off before anything counted
  // them. They are still only ever *candidates* - uniqueness is measured, never assumed.
  const text = candidateTextFor(graph, isGenerated);
  if (text) {
    const scope = stableAncestors[0]?.id ? `#${escape(stableAncestors[0].id!)}` : '';
    const within = (selector: string) => (scope ? `${scope} ${selector}` : selector);
    // 'filter' keeps the element the selector matched and requires it to contain the
    // text - right when the recorded element is the container. 'descend' takes the
    // text-bearing element inside it - right when the recorded element IS the text and
    // its classes live on the parent. Choosing wrongly would resolve to a different
    // node than the one recorded, so it follows where the classes are.
    //
    // A `descend` base matches an ANCESTOR of the recorded element, so `getByText`
    // has to land back on the element itself. That only holds when the element is the
    // one bearing the text: descending into `#main-content`, whose text is the sum of
    // everything inside it, reaches some node far below the one recorded - and a wrong
    // node that happens to measure 1 is exactly what would get promoted. So a graph
    // showing text further down disqualifies the descending shapes, never the
    // filtering ones, which keep the element they matched.
    const bearsTextDeeper = (graph.descendants ?? [])
        .some(node => normaliseCandidateText(node.text ?? '').length > 0);
    const bases: SelectorCandidate[] = [];
    const content = (strategy: string, selector: string, textMode: 'filter' | 'descend') => {
      if (textMode === 'descend' && bearsTextDeeper)
        return;
      bases.push({ strategy, selector, text, textMode, expression: contentExpression(selector, text, textMode) });
    };
    if (targetClasses.length) {
      content('scoped-class-text', within(`.${escape(targetClasses[0])}`), 'filter');
      if (targetClasses.length >= 2) {
        content('scoped-class-pair-text',
            within(`.${escape(targetClasses[0])}.${escape(targetClasses[1])}`), 'filter');
      }
    } else if (parentClasses.length) {
      content('scoped-parent-class-text', within(`.${escape(parentClasses[0])}`), 'descend');
      if (parentClasses.length >= 2) {
        content('scoped-parent-class-pair-text',
            within(`.${escape(parentClasses[0])}.${escape(parentClasses[1])}`), 'descend');
      }
    }
    // The scope on its own, last of the content family. Only ever WITH a scope: a
    // page-wide `getByText` carries no structure and is what this path exists to avoid.
    if (scope)
      content('scoped-text', scope, 'descend');
    for (const candidate of bases.slice(0, MAX_CONTENT_CANDIDATES))
      add(candidate);
  }

  // ---- Contextual candidates: a container identified by what it SAYS.
  //
  // The shape every repeated component needs and no other family can express:
  // twelve identical rows, one of them named by its own text, and the element
  // inside THAT one. TC_LOGIN_082's checkbox is the case - an `<input>` has no
  // text of its own, so the content family above produced nothing at all, and
  // every class shape below matched ten elements, one per row.
  //
  // ONLY THE TARGET'S OWN SELECTOR GOES INSIDE. A sibling or parent shape
  // (`.tabulator-row` … `.rounded-checkbox-ui` for a click on the input) would
  // name a DIFFERENT element, and a claim-time measurement carries no identity to
  // catch that - `locator-quality.ts` promotes a unique candidate whose identity
  // is merely unstated. Addressing the target itself makes the wrong-element case
  // unreachable rather than merely unlikely. It also produces the right locator
  // for both halves of a custom control on its own: the click on the span yields
  // `.rounded-checkbox-ui`, the check on the input yields `.bugChecked`, because
  // in each case that IS the target.
  const containerBases: SelectorCandidate[] = [];
  const inside = targetClasses.length
    ? targetClasses.slice(0, 2).map(name => `.${escape(name)}`)
    : (target.tag ? [target.tag] : []);
  for (const ancestor of (graph.ancestors ?? []).slice(0, MAX_CONTAINER_ANCESTORS)) {
    if (!inside.length)
      break;
    const structural = (ancestor.stableClasses ?? [])
        .filter(name => !isGenerated(name) && !looksLikeStateClass(name));
    if (!structural.length)
      continue;
    const phrase = containerPhraseFor(ancestor, isGenerated);
    if (!phrase)
      continue;
    const container = `.${escape(structural[0])}`;
    for (const descendant of inside) {
      containerBases.push({
        strategy: 'container-text', selector: container, text: phrase,
        textMode: 'within', descendant,
        expression: containerExpression(container, phrase, descendant),
      });
    }
  }
  for (const candidate of containerBases.slice(0, MAX_CONTAINER_CANDIDATES))
    add(candidate);

  for (const ancestor of stableAncestors) {
    const scope = `#${escape(ancestor.id!)}`;
    // A: scope + the element's own classes.
    for (const className of targetClasses.slice(0, 3))
      structural('scoped-class', `${scope} .${escape(className)}`);
    // B: scope + the PARENT's classes. The element itself is often an unclassed
    //    <span>; what distinguishes it is the box it sits in - which is exactly the
    //    responsive mobile/desktop split that made the text ambiguous.
    for (const className of parentClasses.slice(0, 4))
      structural('scoped-parent-class', `${scope} .${escape(className)}`);
    // C: scope + parent class pair, for the case where one class is shared by both
    //    responsive copies and only the pair separates them.
    if (parentClasses.length >= 2)
      structural('scoped-parent-class-pair', `${scope} .${escape(parentClasses[0])}.${escape(parentClasses[1])}`);
    // D: scope + tag, last of the scoped family.
    if (target.tag)
      structural('scoped-tag', `${scope} ${target.tag}`);
  }

  // Unscoped classes, ranked last: they carry no structure and are the most likely to
  // be shared across a list.
  for (const className of targetClasses.slice(0, 2))
    structural('class', `.${escape(className)}`);
  for (const className of parentClasses.slice(0, 2))
    structural('parent-class', `.${escape(className)}`);

  return built.slice(0, MAX_CANDIDATES);
}
