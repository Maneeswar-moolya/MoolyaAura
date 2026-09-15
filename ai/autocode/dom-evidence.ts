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
  /**
   * The element's accessible name.
   *
   * TWO SOURCES, AND THEY ARE NOT EQUIVALENT - read `accessibleNameSource` before
   * trusting this. `browser-computed` is the browser's own answer, obtained through CDP
   * at the press; `aria-label` and `title` are the attributes the capture can read in
   * the page, which is what this field has always held and is an APPROXIMATION of the
   * accessible name, not the accessible name.
   *
   * Measured on eleven live targets: the browser's answer was available on 11 of 11 and
   * an in-page approximation agreed with it on 7 of 10. The three disagreements were all
   * cases where the browser folds something else in - Bugasura's password field computes
   * as "Password Not too short! enter min 5 characters." once its error label is showing,
   * and Bugasura's Google button as "Google Google Sign In". A locator built on the
   * approximation there matched ZERO elements, which is the failure mode this
   * distinction exists to keep visible rather than to hide.
   */
  accessibleName?: string;
  /** WHERE `accessibleName` came from. Absent on every recording made before this. */
  accessibleNameSource?: 'browser-computed' | 'aria-label' | 'title';
  /**
   * Is `accessibleName` the browser's own computed value?
   *
   * `true` only for `browser-computed`. False or absent means the name is an
   * approximation and a candidate built from it must earn its place at run time exactly
   * like any other - which every candidate already has to do, so this changes no gate.
   * It is recorded so a reader can tell an unverified name from a verified one without
   * inferring it from the source string.
   */
  accessibleNameVerified?: boolean;
  /**
   * Did the authoritative accessible name hold still between the press and the settled
   * point, for the SAME parked element in the SAME document?
   *
   * COLLECTION ONLY. Nothing reads this to decide anything: candidate generation,
   * ranking, Page Object reuse, the budgets, AI eligibility and the falsification gate
   * are all unchanged by its presence. It exists so a future ranking decision can be made
   * from recorded evidence rather than from one anecdote.
   *
   *   `stable`  - the browser computed the same name at both points.
   *   `changed` - it computed a different one. NOT a verdict: a name that changes may be
   *               legitimate UI state, and whether it makes a locator unusable is decided
   *               by replaying that locator, not by this field.
   *   `unknown` - the comparison could not be PROVEN to be about the same target in the
   *               same document. Missing CDP, a released slot, a detached node, a
   *               navigation between the two points, or a press-time name that was only
   *               the in-page approximation all land here.
   *
   * FAIL CLOSED. `unknown` is the answer whenever anything is unproven, and two equal
   * strings are never enough on their own - Phase 6 measured a stale slot producing two
   * identical names and a confident, entirely false `stable`.
   *
   * Absent on every recording made before this existed, which reads as "not measured".
   */
  accessibleNameStable?: 'stable' | 'changed' | 'unknown';
  /**
   * The `href` ATTRIBUTE as it was authored - never the resolved absolute URL.
   *
   * Resolving it would bake in the origin, and the same application at two environments
   * has two origins: a locator built on the resolved value would be environment-specific
   * by construction. `/mobile-phones-store` is a fact about the application;
   * `https://www.flipkart.com/mobile-phones-store` is a fact about one deployment of it.
   */
  href?: string;
  /**
   * The authored href is absolute (has a scheme, or is protocol-relative).
   *
   * A flag rather than a resolution, and it is what keeps `javascript:void(0)` and
   * cross-origin links out of candidate generation without anything having to parse a
   * URL twice.
   */
  hrefAbsolute?: boolean;
  /** The `alt` attribute, authored. Frequently shared - see `getByAltText` generation. */
  alt?: string;
  /**
   * This ancestor does NOT satisfy the container/role/id rule and was kept anyway.
   *
   * Exactly one per graph, the nearest, appended after every qualifying ancestor so it
   * can never displace one from any window a consumer slices. Present only on ancestors.
   */
  nonQualifying?: boolean;
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
  /**
   * WHICH ESTABLISHED CAPABILITY'S DECLARED LOCATOR THIS EXPRESSION IS.
   *
   * Present only on a measurement taken to answer one question - does the locator this
   * capability declares resolve to the element that was just acted on? - and it is the
   * only thing that makes such a measurement attributable. Without it a measurement is
   * a candidate for a NEW locator; with it, it is evidence about an EXISTING method.
   *
   * The measurement itself is ordinary: same rebuild, same count, same in-page identity
   * comparison, same `provesIdentity` bar. What is different is only what it is asked
   * ABOUT, and this field records that. Absent everywhere else, and absent on every
   * recording made before it existed.
   */
  capability?: { owner: string; method: string };
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

/**
 * EVERY MEASUREMENT THIS ELEMENT CARRIES THAT PROVES IDENTITY, from all four lists.
 *
 * One reader, so "what did the browser prove about this element?" has a single answer.
 * The bar is `provesIdentity` and nothing here relaxes it: one element, in the
 * interaction's own document, and that element is the one acted on (an assertion may
 * also be proven at its own pick, exactly as everywhere else).
 *
 * `rejectedCandidates` is read too, and that is not a promotion. Nothing is emitted from
 * this list - the caller is asking whether a KNOWN expression identified this element,
 * not choosing a locator - and a measurement that satisfies `provesIdentity` proves that
 * whichever list the recorder happened to file it in. The filing decides what may be
 * emitted; it does not decide what was measured.
 */
export function provenMeasurements(
  evidence: TargetEvidence | null | undefined,
  role: 'action' | 'assertion',
): CandidateMeasurement[] {
  if (!evidence)
    return [];
  return [
    ...(evidence.capabilityMeasurements ?? []),
    ...(evidence.derivedCandidates ?? []),
    ...(evidence.positionProvenCandidates ?? []),
    ...(evidence.rejectedCandidates ?? []),
  ].filter(candidate => provesIdentity(candidate, role));
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
  /**
   * The route the document was showing when this graph was taken - `location.pathname`,
   * read in the page, in the document that parked the press.
   *
   * A FACT ABOUT THE SCREEN, AND NEVER ABOUT THE APPLICATION. The application is the
   * locked `ApplicationScope`, decided before the browser opened; a URL is configuration
   * and changes between environments, so deriving identity from it is the category error
   * `ai/knowledge/canonical.ts` records at length. What this answers is which SCREEN of
   * that application the person was on, which is the one thing a first recording of a
   * new application cannot otherwise state.
   *
   * Pathname only - no query, no fragment - because that is where a reset token, a
   * session id and a search term live. Optional: every recording made before this field
   * existed carries none, reads as absent, and is never bootstrapable.
   */
  route?: string;
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
  /**
   * MEASUREMENTS OF ESTABLISHED CAPABILITIES' OWN DECLARED LOCATORS, against this element.
   *
   * A FOURTH LIST, and deliberately not one of the other three. `derivedCandidates`,
   * `positionProvenCandidates` and `rejectedCandidates` are about locators the framework
   * might EMIT for this element, and every one of them competes for a budget and a rank.
   * These are not candidates at all: nothing here is ever emitted, ranked, budgeted or
   * promoted. They answer one question the other lists cannot - is the element that was
   * acted on the element an existing capability already wraps? - and mixing them in would
   * change what gets generated, which this is not allowed to do.
   *
   * Each entry carries `capability`. Entries that did not prove identity are kept with
   * their reason, because "we asked and the answer was no" is a different and equally
   * useful fact from "we never asked"; every reader applies `provesIdentity` before
   * acting, so a refused one can never be mistaken for a match.
   */
  capabilityMeasurements?: CandidateMeasurement[];
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
  /**
   * WHICH APPLICATION THIS EVIDENCE IS ABOUT.
   *
   * Optional, so every recording made before this existed still reads exactly as it
   * did - absence means "made before ownership was stamped", never "belongs to
   * nobody". The DIRECTORY is still the authority (`recordings/<applicationId>/`);
   * this is the copy that survives a file being moved, mailed or quoted in a report,
   * and it is what lets a reader answer "which product is this about?" from the
   * evidence itself rather than from where it happened to be filed.
   *
   * Stamped from the SELECTED scope at Stop, never from the recorded URL - see
   * `Session.scope`.
   */
  origin?: RecordingOrigin;
}

/**
 * The application context a recording was made in.
 *
 * `applicationId` is identity, `environmentId` and `baseUrl` are configuration, and
 * the distinction is load-bearing: two environments of one application share an
 * identity and differ in address, so a reader must never recover the first from the
 * second. `baseUrl` is kept because it is evidence of WHERE the recording ran, which
 * is a real question when a failure turns out to be environment-specific.
 */
export interface RecordingOrigin {
  applicationId: string;
  environmentId: string;
  baseUrl: string;
  /** The row it was recorded for, when the person named one before starting. */
  testCaseId?: string;
  /** Browser and transport, so "where did this come from" is answerable offline. */
  browser?: string;
  startedAt?: string;
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

export type RecordingEvidence = (DomEvidence | DomEvidenceUnavailable) & {
  /** Observational pictures, never automatic target identity evidence. */
  captures?: import('../diagnostics/artifacts').DiagnosticCapture[];
  /**
   * Whether those pictures could be attributed to the steps they describe.
   *
   * Additive and optional: a recording made before this was written says nothing here,
   * which reads as unknown - never as "they were attributed".
   */
  captureAttribution?: import('../diagnostics/artifacts').CaptureAttribution;
};

/** The state every recording is in until something captures evidence for it. */
export function evidenceUnavailable(reason: string): DomEvidenceUnavailable {
  return { available: false, reason: reason.trim() || 'no reason recorded' };
}

/**
 * WHY THERE IS NO EVIDENCE, said accurately.
 *
 * "recorded before press-time capture existed" was reported for every evidence-less
 * recording, which is only true of one of them. A recording made yesterday on the CODEGEN
 * transport has no evidence either - codegen is a script generator, not an instrumented
 * browser, and it can never supply interaction-time identity or a navigation journal. Telling
 * someone to treat a recording they just made as a legacy artifact sends them to re-record it
 * the same way, with the same result. The transport is the thing to change, so the transport
 * is what the message has to name.
 *
 * Read from the evidence's OWN recorded reason. Nothing is inferred from dates.
 */
export type EvidenceAbsence =
  | 'CODEGEN_NO_BROWSER_EVIDENCE'
  | 'CURRENT_RECORDING_EVIDENCE_CAPTURE_FAILED'
  | 'LEGACY_NO_EVIDENCE';
export function evidenceAbsence(evidence: unknown): { code: EvidenceAbsence; reason: string } {
  const recorded = String((evidence as { reason?: unknown } | null)?.reason ?? '').trim();
  if (/codegen/i.test(recorded))
    return { code: 'CODEGEN_NO_BROWSER_EVIDENCE',
      reason: 'this recording was made on the CODEGEN transport, which generates a script and '
        + 'never observes the browser, so it supplies no interaction-time identity and no '
        + 'navigation journal. Re-record it with the live recorder' };
  if (recorded)
    return { code: 'CURRENT_RECORDING_EVIDENCE_CAPTURE_FAILED',
      reason: `live capture ran but produced nothing admissible: ${recorded}` };
  return { code: 'LEGACY_NO_EVIDENCE',
    reason: 'the recording carries no DOM evidence sidecar at all (recorded before press-time '
      + 'capture existed)' };
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
 * Tags whose TEXT provably cannot be a value somebody typed.
 *
 * AN ALLOW-LIST, so the default is to redact. A custom element can host a control in a
 * shadow root, an unknown tag is unknown, and an absent tag says nothing at all - all
 * three fail closed by simply not being here. `code`, `pre`, `samp`, `kbd` and `output`
 * are deliberately ABSENT even though they hold no value: they are where an application
 * displays a token when it displays one, so they are left to be judged on their content.
 */
const TEXT_ONLY_TAGS = [
  'label', 'p', 'span', 'div', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'td', 'th', 'tr', 'table', 'thead', 'tbody',
  'strong', 'em', 'b', 'i', 'u', 'small', 'mark', 'abbr', 'cite', 'q', 'blockquote',
  'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figure',
  'figcaption', 'form', 'fieldset', 'legend', 'button', 'summary', 'details',
  'img', 'svg', 'path', 'br', 'hr',
];

/**
 * Would keeping this node's TEXT keep a credential?
 *
 * TWO INDEPENDENT TESTS, and the node is redacted if either says so.
 *
 * 1. IT IS A CREDENTIAL FIELD. A password input has no text, but a mis-tagged one might,
 *    and the cost of being wrong is a leaked secret. What changed is the "it is a field"
 *    half: only a FORM CONTROL can hold a value somebody typed. A `<label>`, `<p>` or
 *    `<div>` has no value at all, so a credential word in its id describes a field rather
 *    than being one.
 *
 *    The old rule asked `isForbiddenKey(id)` of every node, so `#password_field-error` -
 *    a `<label>` carrying "Not too short! enter min 5 characters." - lost its text for
 *    mentioning a password. Measured cost: every content-family candidate for that
 *    element became underivable, on an element that is a validation MESSAGE and can never
 *    hold a secret.
 *
 * 2. THE TEXT ITSELF LOOKS LIKE A SECRET, whatever the element is. This is new and it is
 *    strictly MORE protective: the old rule read only the type, name and id, so a
 *    `<div>` displaying a JWT was kept in full because no attribute mentioned a
 *    credential. `looksLikeSecretValue` is the same shape test `filterAttributes`
 *    already applies to every attribute value.
 *
 * FAIL CLOSED ON AMBIGUITY. `TEXT_ONLY_TAGS` is an ALLOW-LIST, so an absent tag, an
 * unknown tag and a custom element - which can host a real control in a shadow root -
 * are all judged as though they could hold a value.
 */
export function holdsCredentialText(node: Pick<DomNode, 'tag' | 'type' | 'name' | 'id' | 'text'>): boolean {
  // The content test runs first and applies to EVERY element, whatever it is.
  if (node.text && looksLikeSecretValue(node.text))
    return true;
  const tag = (node.tag ?? '').toLowerCase();
  if (TEXT_ONLY_TAGS.includes(tag))
    return false;
  return FORBIDDEN_INPUT_TYPES.includes((node.type ?? '').toLowerCase())
    || isForbiddenKey(node.name ?? '')
    || isForbiddenKey(node.id ?? '');
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
  // The provenance travels with the value or the value cannot be judged. Both are
  // copied only when the name itself survived above, so a source can never outlive
  // the name it describes.
  if (node.accessibleName && node.accessibleNameSource)
    safe.accessibleNameSource = node.accessibleNameSource;
  if (node.accessibleName && node.accessibleNameVerified !== undefined)
    safe.accessibleNameVerified = node.accessibleNameVerified;
  // Carried only beside a name, like the other two provenance fields: a stability verdict
  // about a name that did not survive redaction would describe nothing.
  if (node.accessibleName && node.accessibleNameStable)
    safe.accessibleNameStable = node.accessibleNameStable;
  // AN HREF CAN CARRY A CREDENTIAL. A reset link is `?token=…`, a magic sign-in link is
  // the whole secret, and both are ordinary hrefs on ordinary anchors. The key test is
  // applied to the query's parameter NAMES and the shape test to the value, which is the
  // same pair of rules `filterAttributes` already uses - href is not special enough to
  // deserve its own weaker ones.
  if (node.href && !hrefCarriesSecret(node.href)) {
    safe.href = truncate(node.href);
    if (node.hrefAbsolute !== undefined) safe.hrefAbsolute = node.hrefAbsolute;
  }
  if (node.alt) safe.alt = truncate(node.alt);
  if (node.nonQualifying !== undefined) safe.nonQualifying = node.nonQualifying;
  if (node.id) safe.id = node.id;
  if (node.name) safe.name = node.name;
  if (node.type) safe.type = node.type;
  if (node.placeholder) safe.placeholder = truncate(node.placeholder);
  if (node.title) safe.title = truncate(node.title);
  if (node.stableClasses?.length) safe.stableClasses = node.stableClasses.slice(0, EVIDENCE_LIMITS.maxAttributes);
  if (node.scrollable !== undefined) safe.scrollable = node.scrollable;
  if (node.virtualized !== undefined) safe.virtualized = node.virtualized;
  if (node.virtualizedSignal) safe.virtualizedSignal = node.virtualizedSignal;

  if (node.text && !holdsCredentialText(node))
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
/**
 * Would keeping this href keep a credential?
 *
 * Two independent tests, either of which refuses the whole href rather than editing it:
 * a query parameter whose NAME is one of the forbidden keys (`?token=`, `?session=`),
 * and any query VALUE that looks like a secret by the existing shape rule. The href is
 * dropped whole because a redacted URL is a different URL - trimming the query would
 * leave a value that reads like an authored link and is not one.
 *
 * Deliberately not applied to the path: `/reset-password` is a route, not a secret, and
 * refusing it would throw away exactly the stable link this phase exists to capture.
 */
/**
 * Does any segment of this path look like a secret?
 *
 * `/reset/9f2c8ab1e4d7...` is a token in a path rather than a query, and a screen
 * identity built from it would be both useless and a leak. The test is
 * `looksLikeSecretValue`, unchanged - one rule for values, wherever they are found -
 * applied per segment so an ordinary route is never refused for its length.
 */
export function routeCarriesSecret(route: string): boolean {
  return route.split('/').some(segment => segment && looksLikeSecretValue(segment));
}

export function hrefCarriesSecret(href: string): boolean {
  const query = href.slice(href.indexOf('?') + 1);
  if (!href.includes('?') || !query)
    return false;
  for (const pair of query.split(/[&;]/)) {
    const [key, ...rest] = pair.split('=');
    if (key && isForbiddenKey(key))
      return true;
    const value = rest.join('=');
    if (value && looksLikeSecretValue(decodeURIComponent(value)))
      return true;
  }
  return false;
}

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
      // THE ROUTE, WHEN IT IS SAFE TO KEEP. A path segment that looks like a secret is
      // dropped whole rather than trimmed, by the same rule and the same test `href`
      // already uses: a redacted route is a different route that still reads like a real
      // one. Dropping it fails bootstrap closed, which is the correct outcome.
      ...(entry.route && !routeCarriesSecret(entry.route) ? { route: entry.route } : {}),
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
      // CAPABILITY MEASUREMENTS, carried whole and bounded by the same limit.
      //
      // Not filtered to the proven ones. A capability whose declared locator was
      // measured and found to be a DIFFERENT element is the answer this phase exists to
      // record, and dropping it would leave that indistinguishable from never having
      // asked. Every reader applies `provesIdentity`, so nothing unproven can be acted
      // on; what is kept is the fact that the question was put.
      ...(entry.capabilityMeasurements?.length
        ? {
          capabilityMeasurements: entry.capabilityMeasurements
              .filter(candidate => candidate.capability?.owner && candidate.capability?.method)
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
      // WHICH ESTABLISHED CAPABILITY IS THIS ELEMENT - an element-level fact, so it
      // transfers like the candidate lists beside it. The pick takes this measurement
      // against the asserted node itself, and dropping it here would leave an assertion
      // unable to say which capability it is about while the answer sat in its own capture.
      ...(target.capabilityMeasurements
        ? { capabilityMeasurements: target.capabilityMeasurements } : {}),
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
  /**
   * Which budget this candidate competes in. See `FAMILY_BUDGET`.
   *
   * Derived from the strategy by `familyOf`, so a new strategy joins a budget by being
   * named there rather than by every call site remembering to say so.
   */
  family?: CandidateFamily;
  /**
   * HOW this candidate is measured, and it is not a preference.
   *
   *  - `page` (the default, and every candidate that existed before) is a CSS selector
   *    plus the optional text/descendant narrowing, measured inside the batched
   *    `__auraMeasure` call with `document.querySelectorAll`.
   *  - `expression` is a Playwright chain - `getByRole`, `getByLabel`, `getByText` -
   *    which `querySelectorAll` cannot evaluate at all. It is rebuilt on the Node side
   *    with `buildLocator` and identity-checked against the parked node.
   *
   * The split is why the in-page measurement and its own cap are untouched by any of
   * this: the new families never reach it.
   */
  measuredBy?: 'page' | 'expression';
}

/**
 * The budgets a candidate competes in.
 *
 * `identifier`, `content`, `container` and `structural` are the families that already
 * existed, kept apart only so the budget can protect them; `semantic`,
 * `semantic-scoped` and `attribute` are new.
 */
export type CandidateFamily =
  | 'identifier' | 'content' | 'container' | 'structural'
  | 'semantic' | 'semantic-scoped' | 'attribute';

/**
 * Which cap a strategy competes under. Three answers, and the difference is where the
 * candidate is generated rather than how good it is:
 *
 *  - `structural-cap`  - built by `candidateSelectorsFor` itself and sliced by
 *                        `MAX_CANDIDATES`, which is byte-identical to what that function
 *                        produced before any semantic family existed;
 *  - `family-budget`   - built by `semanticCandidatesFor` and admitted by
 *                        `applyFamilyBudget`, so its family MUST carry a positive
 *                        `FAMILY_BUDGET` entry or every candidate it produces is dropped;
 *  - `unbudgeted`      - not generated here at all. `recorded-locator` is Codegen's own
 *                        line, measured by the recorder against the parked node; it
 *                        competes for no slot because it was never in the list.
 */
export type CandidateBudget = 'structural-cap' | 'family-budget' | 'unbudgeted';

/**
 * EVERYTHING THE PIPELINE HAS TO KNOW ABOUT ONE STRATEGY, in one declaration.
 *
 * A strategy used to be a bare string spelled at four unrelated places - the emission
 * site, `familyOf`, the scorer's shape classifier and `buildLocator`'s rebuildable set -
 * and every disagreement between them failed SILENTLY, always in the direction of the new
 * strategy quietly vanishing: an unmapped family resolves to `structural`, whose
 * `FAMILY_BUDGET` entry is undefined, so `applyFamilyBudget` admits none of it; an
 * expression the scorer cannot parse ranks last; an expression `buildLocator` cannot
 * rebuild is measured as `matchCount: null` and can never be proven. Measured, all three:
 * a made-up strategy emitted through `semanticCandidatesFor` produced 0 retained
 * candidates, `scoreExpression` returned null for an unknown Playwright call, and
 * `buildLocator` returned null for the same.
 *
 * So the four properties are declared here, together, and `strategy-contract.fixture.ts`
 * runs the REAL generators and asserts the declaration against what they actually emit.
 * Nothing in this table decides anything at run time except the family, which is the one
 * answer `familyOf` always gave - the rest is what makes an omission a red test instead
 * of a candidate nobody notices is missing.
 */
export interface StrategyContract {
  /** The budget family. Exactly what `familyOf` returns for this strategy. */
  family: CandidateFamily;
  /**
   * How this candidate is counted: `page` goes to the batched in-page `__auraMeasure`
   * with its `selector`, `expression` is rebuilt on the Node side by `buildLocator`.
   * `getByRole` cannot be expressed in `querySelectorAll`, which is why the split exists.
   */
  measuredBy: 'page' | 'expression';
  budget: CandidateBudget;
  /** `scoreExpression` returns a score for its expressions. Nothing ranks without one. */
  scoreable: boolean;
  /** `buildLocator` reconstructs its expressions faithfully. Required for `expression`. */
  rebuildable: boolean;
}

/**
 * THE STRATEGIES THIS FRAMEWORK EMITS. Adding one means adding a line here.
 *
 * Order follows the generators: the structural half of `candidateSelectorsFor` first,
 * then its content and container families, then `semanticCandidatesFor`.
 */
export const STRATEGY_CONTRACT: Readonly<Record<string, StrategyContract>> = {
  /* ---- candidateSelectorsFor: identifiers, content, containers, structure. */
  'test-id': { family: 'identifier', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  'stable-id': { family: 'identifier', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  // `.filter({ hasText })`, which `buildLocator` deliberately refuses to reconstruct -
  // and never has to: this shape is counted in the page by `__auraMeasure`.
  'scoped-class-text': { family: 'content', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: false },
  // `.filter({ hasText })`, which `buildLocator` deliberately refuses to reconstruct -
  // and never has to: this shape is counted in the page by `__auraMeasure`.
  'scoped-class-pair-text': { family: 'content', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: false },
  'scoped-parent-class-text': { family: 'content', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  'scoped-parent-class-pair-text': { family: 'content', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  'scoped-text': { family: 'content', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  // The same `.filter({ hasText })` shape, plus the descendant inside it.
  'container-text': { family: 'container', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: false },
  'scoped-class': { family: 'structural', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  'scoped-parent-class': { family: 'structural', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  'scoped-parent-class-pair': { family: 'structural', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  'scoped-tag': { family: 'structural', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  class: { family: 'structural', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },
  'parent-class': { family: 'structural', measuredBy: 'page', budget: 'structural-cap', scoreable: true, rebuildable: true },

  /* ---- semanticCandidatesFor: page-wide semantics. */
  'role-name': { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'role-name-loose': { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'role-generic': { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  label: { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  placeholder: { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'test-id-api': { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  title: { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'alt-text': { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },

  /* ---- semanticCandidatesFor: the same, scoped to an authored ancestor id. */
  'scoped-role-name': { family: 'semantic-scoped', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'scoped-role-name-loose': { family: 'semantic-scoped', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'scoped-label': { family: 'semantic-scoped', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'scoped-placeholder': { family: 'semantic-scoped', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'scoped-semantic-text': { family: 'semantic-scoped', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },

  /* ---- semanticCandidatesFor: stable attributes and their bounded combinations. */
  attribute: { family: 'attribute', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'scoped-attribute': { family: 'attribute', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'attribute-pair': { family: 'attribute', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },

  /* ---- The recorder's own: CODEGEN'S LINE, not a generated candidate.
   *
   * Built in `live-recorder.ts` at the moment Codegen writes it and measured against the
   * parked node like anything else. It is declared here because every consumer that asks
   * a candidate what family it is will meet it, and `unbudgeted` is the honest answer:
   * it was never in the generated list, so no cap ever applied to it. */
  'recorded-locator': { family: 'structural', measuredBy: 'expression', budget: 'unbudgeted', scoreable: true, rebuildable: true },

  /* ---- RESERVED NAMES: `familyOf` has always answered for these and no site emits one.
   * Kept so that answer is unchanged, and listed in the fixture's own not-yet-emitted set
   * so a genuinely dead entry cannot hide among them. */
  text: { family: 'semantic', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'scoped-test-id-api': { family: 'semantic-scoped', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'scoped-title': { family: 'semantic-scoped', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
  'scoped-alt-text': { family: 'semantic-scoped', measuredBy: 'expression', budget: 'family-budget', scoreable: true, rebuildable: true },
};

/**
 * The table as a Map, built once.
 *
 * A Map rather than an index into the object literal for two reasons, and neither is
 * style: `familyOf` runs once per candidate on the recording path, so the lookup wants to
 * be a hash probe rather than a prototype walk; and a Map cannot answer `constructor` or
 * `toString` with something that is not a contract, which an object literal can. The
 * declaration above stays an object because that is what a person reads.
 */
const CONTRACT_BY_STRATEGY: ReadonlyMap<string, StrategyContract> =
  new Map(Object.entries(STRATEGY_CONTRACT));

/** The contract for one strategy, or null where nothing declares it. */
export function strategyContract(strategy: string): StrategyContract | null {
  return CONTRACT_BY_STRATEGY.get(strategy) ?? null;
}

/**
 * Which budget a strategy competes in. One table, so a new strategy cannot be homeless.
 *
 * THE DEFAULT IS UNCHANGED AND IS STILL A REAL ANSWER, not an error path: a strategy
 * nothing declares still gets the family it always got. What is new is that the fixture
 * refuses to let a generator emit one - the silent drop this default used to hide
 * (`structural` carries no `FAMILY_BUDGET` entry) is now a red test rather than a
 * candidate that never appears.
 */
export function familyOf(strategy: string): CandidateFamily {
  const contract = strategyContract(strategy);
  if (contract)
    return contract.family;
  return strategy.endsWith('-text') ? 'content' : 'structural';
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
      built.push({ ...candidate, family: familyOf(candidate.strategy), measuredBy: 'page' });
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

  // THE STRUCTURAL BUDGET IS UNCHANGED, deliberately and to the byte. Everything above
  // is what this function produced before the semantic families existed, sliced by the
  // same constant, so no candidate that is proven today can be displaced by one added
  // below - and the in-page measurement, which has its own cap, receives exactly the
  // list it always did.
  const structuralCandidates = built.slice(0, MAX_CANDIDATES);
  const semantic = semanticCandidatesFor(graph, isGenerated, stableAncestors);
  const taken = new Set(structuralCandidates.map(entry => entry.expression));
  return [
    ...structuralCandidates,
    ...applyFamilyBudget(semantic.filter(entry => !taken.has(entry.expression))),
  ];
}

/* ------------------------------------------------- semantic candidate families */

/**
 * The ARIA role a node has without anyone writing it down.
 *
 * Lives here rather than in the recorder because BOTH halves need the identical table
 * and a second copy would drift: the recorder reads it to decide whether a parked
 * element satisfies a `getByRole` literal Codegen wrote, and generation reads it to
 * propose a `getByRole` of its own. A role that means one thing when claiming and
 * another when generating would pair a graph with a locator describing a different
 * element - the exact failure the claim rules exist to prevent.
 *
 * Only mappings that are unambiguous from tag plus type. Anything else returns null and
 * no role candidate is generated; a guessed role is a guessed element.
 */
export function implicitRole(node: { tag?: string; type?: string } | undefined): string | null {
  const tag = (node?.tag ?? '').toLowerCase();
  const type = (node?.type ?? '').toLowerCase();
  if (tag === 'li') return 'listitem';
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';                       // only emitted for a linked anchor
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'input') {
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (['', 'text', 'email', 'tel', 'url', 'password'].includes(type)) return 'textbox';
    return null;                                        // submit, file, range, date…
  }
  return null;
}

/**
 * Roles whose accessible name comes from the element's own content.
 *
 * For anything else - a textbox above all - the name comes from a `<label>`, and label
 * text is NOT captured. So an input's name is not derivable here and no named role
 * candidate is generated for one. That is the honest answer rather than a convenient
 * one: `getByRole('textbox', { name: 'Email' })` is a locator this evidence cannot
 * justify, however obviously right it looks next to `placeholder="Enter your email"`.
 */
const NAME_FROM_CONTENT = new Set([
  'link', 'button', 'heading', 'listitem', 'checkbox', 'radio', 'option', 'menuitem', 'tab',
]);

/** How many of each new family may be generated. See `applyFamilyBudget`. */
export const FAMILY_BUDGET: Partial<Record<CandidateFamily, number>> = {
  semantic: 5,
  'semantic-scoped': 4,
  attribute: 3,
};

/** The hard ceiling on everything, structural budget included. */
export const MAX_TOTAL_CANDIDATES = 28;

/**
 * Keep each new family inside its own budget, in generation order.
 *
 * WHY A BUDGET RATHER THAN A BIGGER CAP. Measured across the whole recorded corpus:
 * adding these families takes 706 of 1058 targets past `MAX_CANDIDATES`, and a single
 * larger number resolves that by letting whichever family generates most win - which is
 * `structural`, the weakest one, because a page with many classes produces many class
 * shapes. A per-family budget makes the outcome independent of how prolific a family
 * happens to be on a given page: five semantic candidates are five semantic candidates
 * whether the element carries eight classes or none.
 *
 * Deterministic: generation order inside a family is fixed, the budgets are constants,
 * and nothing here consults a measurement - a budget decided by what resolved would
 * make candidate generation depend on the page it is measured against.
 */
export function applyFamilyBudget(candidates: SelectorCandidate[]): SelectorCandidate[] {
  const used = new Map<CandidateFamily, number>();
  const kept: SelectorCandidate[] = [];
  for (const candidate of candidates) {
    if (kept.length + MAX_CANDIDATES >= MAX_TOTAL_CANDIDATES)
      break;
    const family = candidate.family ?? familyOf(candidate.strategy);
    const budget = FAMILY_BUDGET[family] ?? 0;
    const spent = used.get(family) ?? 0;
    if (spent >= budget)
      continue;
    used.set(family, spent + 1);
    kept.push(candidate);
  }
  return kept;
}

/**
 * Candidates Playwright can express and `querySelectorAll` cannot.
 *
 * EVERY ONE IS BUILT FROM SOMETHING THE CAPTURE ACTUALLY HOLDS. Where the information
 * is missing the candidate is simply not generated - there is no fallback, no guess and
 * no inference from a neighbouring field:
 *
 *  - `href` and `alt` ARE captured now, for the target only, so both yield candidates -
 *    an href only when it is relative, because an absolute one names a deployment;
 *  - `<label>` text is still not captured, so `getByLabel` comes only from an
 *    `aria-label`. Measured, it earns nothing on its own anyway: `getByLabel("Email")`
 *    matches three elements on Bugasura, one per simultaneously-mounted form;
 *  - the accessible name is the BROWSER'S where CDP could be reached at the press
 *    (`accessibleNameVerified`), and otherwise an approximation from `aria-label`,
 *    `title`, or the element's own text for a name-from-content role. Nothing here
 *    reimplements the accessible-name algorithm.
 *
 * Every candidate returned here is still only a CANDIDATE: it is measured at the press
 * and refused unless it matches exactly one element AND that element is the one acted
 * on. Nothing below decides anything.
 */
export function semanticCandidatesFor(
  graph: { target: DomNode; parent?: DomNode; ancestors?: RelatedNode[]; descendants?: RelatedNode[] },
  isGenerated: (value: string) => boolean,
  stableAncestors?: RelatedNode[],
): SelectorCandidate[] {
  const target = graph.target;
  if (!target)
    return [];
  const out: SelectorCandidate[] = [];
  const seen = new Set<string>();
  const emit = (strategy: string, expression: string, selector: string) => {
    if (seen.has(expression))
      return;
    seen.add(expression);
    out.push({ strategy, selector, expression, family: familyOf(strategy), measuredBy: 'expression' });
  };

  const literal = (value: string) => JSON.stringify(value);
  const escape = (value: string) => value.split('"').join('\\"').split('\\').join('\\\\');
  // The same filter every candidate's text passes: bounded, single-line, never a
  // secret-shaped value, never a lone generated identifier.
  const usable = (value: string | undefined): string | null => {
    const text = usableCandidateText(value, isGenerated);
    return text && text.length <= CANDIDATE_TEXT_LIMIT ? text : null;
  };

  const role = target.role && !isGenerated(target.role) ? target.role : implicitRole(target);
  const ariaLabel = usable(target.aria?.['aria-label']);
  const title = usable(target.title);
  const placeholder = usable(target.placeholder);
  const testId = target.data?.['data-testid'] ?? target.data?.['data-test-id'];
  // The element's own text is a NAME only for a role that takes its name from content.
  // It is also only the element's own text when the element has no children to have
  // borrowed it from - `text` is `textContent`, which is the whole subtree.
  const ownText = usable(target.text);
  const leaf = !(graph.descendants ?? []).length;
  const nameFromContent = role && NAME_FROM_CONTENT.has(role) && ownText ? ownText : null;
  // THE BROWSER'S OWN ANSWER FIRST, when there is one. `accessibleNameVerified` is set
  // only where CDP returned the computed name at the press; everything below it is an
  // approximation built from attributes, and the two disagree in exactly the cases that
  // matter - a field whose error label the browser folds into its name, a button whose
  // icon contributes a word. A candidate built from either is still measured and still
  // refused unless it identifies the element that was acted on; the order only decides
  // which one is tried, never which one is trusted.
  const verifiedName = target.accessibleNameVerified === true ? usable(target.accessibleName) : null;
  const accessibleName = verifiedName ?? ariaLabel ?? title ?? nameFromContent;

  /* ---- role + name, and text + role: the same candidate, named by its source. */
  // THE SAME NAME, MATCHED LOOSELY - a second CANDIDATE, never a preference, and never
  // ahead of anything that already existed.
  //
  // `exact: true` and the bare form fail in OPPOSITE directions, and both failures were
  // measured rather than imagined. `exact: true` was introduced in P5.1 against a loose
  // form that matched TWO elements for Flipkart's "Home"; re-measured on 2026-09-08 that
  // page resolves to one either way, and the ambiguity reproduces on Bugasura instead -
  // `{ name: "Sign In" }` matches 2 (Google's sign-in button contains the words) where
  // exact matches 1. Loose survives where exact cannot when the application EXTENDS a
  // name with state text: Bugasura's email field computes as "Email" and then carries its
  // validation message, at which point exact matches 0 and loose still matches 1 - both
  // measured live, in that order, on the same field. Neither is generally better, so neither is
  // chosen here - both are offered, and the existing pipeline decides: each is counted
  // at the press, each must resolve to exactly one element, and each must BE the element
  // acted on. A loose candidate matching two is refused by the same ambiguity gate as
  // anything else; one matching a different element is refused by identity.
  //
  // DEFERRED TO THE END OF ITS FAMILY, and that is the budget rule rather than a
  // preference. Emitted beside its exact twin it displaced 150 candidates the generator
  // already produced (125 scoped text, 25 scoped label) - none of them proven in this
  // corpus, but "not proven yet" is not "worthless", and `FAMILY_BUDGET` exists so that
  // nothing proven today can be displaced by anything added. Appended, it displaces
  // ZERO and still offers 374 of the 524 loose candidates: measured both ways over all
  // 1026 captured targets.
  const loose: Array<[string, string]> = [];
  if (role && accessibleName) {
    emit('role-name', `page.getByRole(${literal(role)}, { name: ${literal(accessibleName)}, exact: true })`, '');
    loose.push(['role-name-loose', `page.getByRole(${literal(role)}, { name: ${literal(accessibleName)} })`]);
  } else if (role)
    emit('role-generic', `page.getByRole(${literal(role)})`, '');

  if (ariaLabel)
    emit('label', `page.getByLabel(${literal(ariaLabel)})`, '');
  if (placeholder)
    emit('placeholder', `page.getByPlaceholder(${literal(placeholder)})`, '');
  if (testId && !isGenerated(testId))
    emit('test-id-api', `page.getByTestId(${literal(testId)})`, '');
  if (title)
    emit('title', `page.getByTitle(${literal(title)})`, '');
  // AMBIGUITY IS PRESERVED, NOT AVOIDED. Measured on Flipkart's homepage: 91 images
  // carry an alt, and of eight sampled three identified their element uniquely while
  // four shared `alt="Image"` across 62 elements. The shared ones are not a reason to
  // withhold the candidate - they are a reason to measure it, which is what happens to
  // every candidate here. A 62-element match is refused at the press like any other.
  const alt = usable(target.alt);
  if (alt)
    emit('alt-text', `page.getByAltText(${literal(alt)}, { exact: true })`, '');
  // NO PAGE-WIDE getByText, and this is the content family's rule rather than a new one:
  // "Only ever WITH a scope: a page-wide `getByText` carries no structure and is what
  // this path exists to avoid." A bare text locator scores 75 - above an authored id at
  // 70 - so generating one would let ranking prefer it over `#create_team_cancel_btn`
  // on a page where the text happened to be unique when it was recorded, which is
  // exactly the TC_LOGIN_128 failure (one `h2` at record time, three at run time). The
  // scoped form is emitted below, where a scope exists to give it structure.

  /* ---- ancestor-scoped semantic candidates, and stable attribute combinations.
   *
   * The scope is an ANCESTOR'S AUTHORED ID and nothing else - the same scopes the
   * structural families already use, by the same rule. Scoping is what settles the
   * ambiguity a page-wide semantic locator cannot: three sign-in forms are mounted at
   * once on Bugasura, so `getByPlaceholder("Enter your email")` matches three elements
   * and `#loginForm` + the same placeholder matches one. */
  const scopes = (stableAncestors ?? (graph.ancestors ?? []).filter(node => node.id && !isGenerated(node.id)))
      .filter(node => node.id)
      .slice(0, 2)
      .map(node => idSelector(node.id!, escape));

  for (const scope of scopes) {
    const within = `page.locator(${literal(scope)})`;
    if (role && accessibleName) {
      emit('scoped-role-name', `${within}.getByRole(${literal(role)}, { name: ${literal(accessibleName)}, exact: true })`, '');
      loose.push(['scoped-role-name-loose', `${within}.getByRole(${literal(role)}, { name: ${literal(accessibleName)} })`]);
    }
    if (ariaLabel)
      emit('scoped-label', `${within}.getByLabel(${literal(ariaLabel)})`, '');
    if (placeholder)
      emit('scoped-placeholder', `${within}.getByPlaceholder(${literal(placeholder)})`, '');
    if (ownText && leaf)
      emit('scoped-semantic-text', `${within}.getByText(${literal(ownText)}, { exact: true })`, '');
  }

  /* ---- stable direct attributes and their bounded combinations.
   *
   * `type` never appears alone: it names a KIND of control, never one control. `value`
   * and `class` are excluded for the same reason plus a stronger one - a value can be
   * what somebody typed. */
  const tag = (target.tag ?? '').toLowerCase();
  const attribute = (strategy: string, selector: string) =>
    emit(strategy, `page.locator(${literal(selector)})`, selector);

  // SCOPED FIRST, and the order IS the fix.
  //
  // The family is budgeted at three and these were emitted last, so an element carrying
  // `name` plus two of {aria-label, href} spent every slot on unscoped shapes and lost
  // the scoped one entirely. That is the wrong candidate to lose: measured on Bugasura's
  // sign-in page, `[name="email"]` matches THREE elements - the sign-in, sign-up and
  // reset forms are all mounted at once - while `#loginForm input[name="email"]` matches
  // one. The unscoped shapes are the ambiguous ones; the scoped shape is the reason the
  // family is worth having.
  //
  // At most two scopes are ever offered (`scopes` is sliced to 2), so a budget of three
  // always leaves at least one slot for an unscoped candidate. Nearest scope first, which
  // is the order `scopes` already carries, so the highest-value scoped variant is the one
  // that survives a constrained budget.
  for (const scope of scopes) {
    if (tag && target.name)
      attribute('scoped-attribute', `${scope} ${tag}[name="${escape(target.name)}"]`);
  }
  if (target.name)
    attribute('attribute', `[name="${escape(target.name)}"]`);
  if (ariaLabel)
    attribute('attribute', `[aria-label="${escape(ariaLabel)}"]`);
  // RELATIVE HREFS ONLY, and that is the whole of the environment rule. An absolute href
  // carries the origin, so a locator built on it belongs to one deployment rather than to
  // the application - and `javascript:void(0)`, which names no destination at all, is
  // absolute by the same test and excluded by the same line. Measured: Flipkart's Mobiles
  // and Home links both resolve to exactly one element by their authored path, which is
  // the only candidate either of them has.
  if (target.href && target.hrefAbsolute !== true)
    attribute('attribute', `[href="${escape(target.href)}"]`);
  if (tag && target.name && target.type)
    attribute('attribute-pair', `${tag}[type="${escape(target.type)}"][name="${escape(target.name)}"]`);
  else if (tag && target.name)
    attribute('attribute-pair', `${tag}[name="${escape(target.name)}"]`);

  // The loose twins, last: they take the slots their families have left and no others.
  for (const [strategy, expression] of loose)
    emit(strategy, expression, '');

  return out;
}
