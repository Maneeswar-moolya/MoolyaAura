import { executableBinding, guidedKnowledge, loadOwners } from '../knowledge/authoring-owners';
/**
 * A recorded test becomes a spec by MAPPING, not by asking a model to write one.
 *
 * Playwright Codegen already watched a person use the real application and wrote
 * down what they did, with the locators it chose. That is finished browser work and
 * it is trustworthy in a way nothing else here is: it is a recording, not an
 * inference. So for a recorded row the pipeline is
 *
 *   Codegen source -> parse -> map each action onto an existing Page Object method
 *                  -> assemble a framework-compliant spec -> existing quality gate
 *
 * with no browser, no exploration, no credentials and - when every action maps - no
 * model call at all.
 *
 * WHAT THIS IS NOT
 *
 * It is not a second generator competing with `agent.ts`. It handles exactly one
 * case (a recorded row with a kept artifact) and reports a typed block
 * when a deterministic capability or navigation provenance is missing. An unresolved action is reported,
 * never guessed: the whole value of a recording is that nobody had to guess.
 *
 * It is also not a route around the quality gate. The assembled spec runs clean and
 * mutated like every other, and is quarantined on the same terms. The optimisation
 * removes rediscovery, not validation.
 *
 * WHY MAPPING IS POSSIBLE AT ALL
 *
 * `ai/knowledge/page/*.yaml` already records, per element, the accessible name the
 * application shows AND the Page Object method that wraps it. That pairing is
 * exactly what turns `getByRole('button', { name: 'Sign In' })` into
 * `loginPage.signInButton()`. The framework index then confirms the method really
 * exists on that class, so a stale knowledge file cannot produce a call to nothing.
 *
 * AUTHENTICATION
 *
 * A recorded sign-in is recognised as a SHAPE - a redacted fill followed by a submit
 * - and bound to the active application's credential fixture through explicit user
 * bindings or identity-proven automatic controls. A composite is reused only if its declared body matches those
 * operations. Recorded credential values are never emitted.
 */

import { routeMatches } from '../knowledge/routes';
import { replayableNavigation } from '../dashboard/navigation';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { forbiddenMechanisms } from './abstraction/validate';

import { buildIndex, type FrameworkIndex, type IndexedMethod } from '../knowledge/index';
import {
  analyseIdentifier, assessLocator, chainHasDynamicIdentifier, isPositionalLocator,
  type LocatorAssessment, type RecordedStep,
} from './locator-quality';
import { resolveParameterisedReuse, rejectValue } from './abstraction/parameter';
import { effectiveLocator, provenCandidate, rankProvenCandidates } from './abstraction/classify';
import {
  evidenceFor, evidenceForAssertionSubject, evidenceUnavailable, isDomEvidence,
  provesIdentity, provenMeasurements, isPositionProven, readAssertionProvenance,
  type CandidateMeasurement, type RecordingEvidence, type TargetEvidence,
} from './dom-evidence';
import {
  declaredSelectors, type PageElement, type PageKnowledge, readAllPageKnowledge,
} from '../knowledge/page-knowledge';
import {
  archiveArtifact, archivedPath, assertionPhrase, assertionsPath, evidencePath, parseRecording,
   readArtifact,
  type RecordedAction, type RecordedAssertion, type Recording,
} from '../dashboard/recorder';
import { deriveScenarioTitle, unstableTitleReason } from './scenario-title';
import { activeScope, activeScopePath } from '../projects/scope';
import { dataFieldToken, generatedInput } from '../test-data/values';
import { credentialsFixtureName } from './abstraction/writer';
import { manualMethods } from '../knowledge/manual-authoring';
import { diagnosticData } from '../diagnostics/artifacts';
import type { TestCase } from '../excel/types';

const ROOT = process.cwd();

/* ------------------------------------------------------------------ mapping */

export type StepKind =
  /** An existing Page Object method wraps this element. The good case. */
  | 'page-object'
  /** Navigation, mapped to a Page Object `open()` or a plain goto. */
  | 'navigate'
  /** The recorded sign-in, collapsed into the framework's own auth mechanism. */
  | 'authenticate'
  /** Codegen's own locator, used directly because no Page Object describes it. */
  | 'codegen-locator'
  /**
   * A locator the quality engine refused: a generated id, an absolute XPath. The
   * recording is fine - what it captured cannot be replayed as written, and only a
   * person can decide what should replace it.
   */
  | 'needs-review'
  /** Nothing could be resolved. Never guessed - reported. */
  | 'unresolved';

export interface MappedStep {
  diagnostic?: import('../diagnostics/artifacts').DiagnosticStep;
  kind: StepKind;
  /** The human-readable step name, used for the `step(...)` wrapper. */
  label: string;
  /** The TypeScript to emit, already indented by the assembler. */
  code: string[];
  pageObject?: string;
  method?: string;
  why: string;
  /** The recorded action(s) this came from, for the report. */
  from: string;
  /** What the locator-quality engine made of this step's locator. */
  quality?: LocatorAssessment;
  /** Non-element provenance never participates in the Page Object element ledger. */
  subject?: 'navigation' | 'authentication' | 'authoring';
  failure?: 'navigationCausality' | 'authenticationCapability' | 'userBindingIncomplete';
  /** Proven element mappings consumed by a declared composite capability. */
  components?: MappedStep[];
}

export interface MappingResult {
  steps: MappedStep[];
  /** Fixtures the spec must destructure. Derived from what was actually mapped. */
  fixtures: Set<string>;
  reused: Array<{ pageObject: string; method: string }>;
  unresolved: MappedStep[];
  /** Steps whose locator the quality engine refused. Blocks assembly. */
  needsReview: MappedStep[];
  /** The recording's DOM evidence, carried through so telemetry can report it. */
  evidence?: import('./dom-evidence').RecordingEvidence;
  /** Every judgement made, in recorded order, for the report and the metrics. */
  assessments: Array<{ from: string; assessment: LocatorAssessment }>;
  codegenLocators: number;
  authenticated: boolean;
  /**
   * True when every assertion was put back where it was recorded. False for a
   * Recording with no positions, whose assertions were appended last - the old
   * behaviour, kept for artifacts that predate the position field.
   *
   * This is the difference between "the application refused this test" and "we
   * reassembled the recording wrongly and then blamed the recording".
   */
  orderReconstructed: boolean;
}

/**
 * An element the recording used that no Page Object describes.
 *
 * Codegen's own locator is real evidence and is still emitted - it was used against
 * the running application - but it is NOT Page Object reuse and must not be counted
 * or reported as if it were. Naming these is what turns "the clean run failed" into
 * "these four elements need Page Object methods".
 */
export interface PageObjectRequirement {
  /** The human-readable name of the element, as the recording knew it. */
  target: string;
  /** Codegen's locator expression, verbatim. */
  locator: string;
  /** `click`, `fill`, `assert contains`Ã¢â‚¬Â¦ - what the recording did with it. */
  did: string;
}

/**
 * What the locator-quality engine decided, counted.
 *
 * Deterministic by construction: every number here comes from a rule in
 * `locator-quality.ts`, none of them needs a page and none of them needs a model.
 */
export interface LocatorMetrics {
  recordedLocatorCount: number;
  existingPageObjectReuseCount: number;
  stableLocatorCount: number;
  dynamicLocatorCount: number;
  normalizedLocatorCount: number;
  newPageObjectCount: number;
  rawLocatorFallbackCount: number;
  needsReviewCount: number;
  /** Distinct winning strategies, so a spec's selector diet is visible at a glance. */
  locatorStrategiesUsed: string[];
  /** Every candidate the resolver scored, across the recording. */
  candidateCount: number;
  cssCandidateCount: number;
  xpathCandidateCount: number;
  /** Axis candidates generated from a recorded containment relationship. */
  xpathAxisCandidateCount: number;
  /** Candidates generated and then refused, with reasons kept per assessment. */
  rejectedCandidateCount: number;
  /** Live DOM evidence: what arrived with the recording, and what it decided. */
  domEvidence: {
    captured: boolean;
    unavailableReason: string | null;
    targetCount: number;
    /** Targets whose uniqueness the browser actually measured. */
    measuredCount: number;
    /** Targets the browser measured at more than one element. */
    ambiguousCount: number;
    /** Dynamic ids replaced by a counted alternative. */
    resolvedFromEvidence: number;
    /** Graphs taken before the interaction took effect - the ones worth having. */
    beforeActionCount: number;
    /** Graphs read after the fact, i.e. Phase 8C timing. */
    afterActionCount: number;
    /**
     * Graphs taken when a person ASSERTED, not at an action.
     *
     * Counted separately so before + after + this accounts for every target. Without
     * it a reader comparing targetCount against the other two would find them short
     * and have no way to know why.
     */
    assertionPickCount: number;
    /** Targets a scrollable ancestor was clipping when they were captured. */
    scrollRequiredCount: number;
    /** Targets inside a container that DECLARED itself virtualized. */
    virtualizedContainerCount: number;
    /** Targets that were no longer attached when their graph was taken. */
    detachedAtCaptureCount: number;
    /** Targets carrying at least one candidate measured AT the press. */
    pressMeasuredTargetCount: number;
    /** Candidates measured at one element and proven to be the element pressed. */
    identityProvenCount: number;
    /** Candidates measured at one element that turned out to be a different one. */
    identityMismatchCount: number;
    /** Targets whose count was refused because the document had already changed. */
    documentChangedCount: number;
    /** Targets whose own text identified more than one element AT the press. */
    pressTimeAmbiguousCount: number;
    /** Locators settled by the element the person actually clicked. */
    disambiguatedByClickedTargetCount: number;
  };
  /** Locators the engine judged weak or suspicious but did NOT block. */
  weakLocatorCount: number;
  suspiciousLocatorCount: number;
}

export function emptyLocatorMetrics(): LocatorMetrics {
  return {
    recordedLocatorCount: 0, existingPageObjectReuseCount: 0, stableLocatorCount: 0,
    dynamicLocatorCount: 0, normalizedLocatorCount: 0, newPageObjectCount: 0,
    rawLocatorFallbackCount: 0, needsReviewCount: 0, locatorStrategiesUsed: [],
    candidateCount: 0, cssCandidateCount: 0, xpathCandidateCount: 0,
    xpathAxisCandidateCount: 0, rejectedCandidateCount: 0,
    domEvidence: { captured: false, unavailableReason: null, targetCount: 0,
      measuredCount: 0, ambiguousCount: 0, resolvedFromEvidence: 0,
      beforeActionCount: 0, afterActionCount: 0, assertionPickCount: 0,
      scrollRequiredCount: 0,
      virtualizedContainerCount: 0, detachedAtCaptureCount: 0,
      pressMeasuredTargetCount: 0, identityProvenCount: 0, identityMismatchCount: 0,
      documentChangedCount: 0, pressTimeAmbiguousCount: 0,
      disambiguatedByClickedTargetCount: 0 },
    weakLocatorCount: 0, suspiciousLocatorCount: 0,
  };
}

export function locatorMetrics(mapping: MappingResult): LocatorMetrics {
  const metrics = emptyLocatorMetrics();
  const evidence = mapping.evidence;
  if (evidence?.available) {
    metrics.domEvidence.captured = true;
    metrics.domEvidence.targetCount = evidence.targets.length;
    metrics.domEvidence.measuredCount = evidence.targets.filter(t => typeof t.matchCount === 'number').length;
    metrics.domEvidence.ambiguousCount = evidence.targets.filter(t => typeof t.matchCount === 'number' && t.matchCount > 1).length;
    metrics.domEvidence.beforeActionCount = evidence.targets.filter(t => t.captureTiming === 'before-action').length;
    metrics.domEvidence.afterActionCount = evidence.targets.filter(t => t.captureTiming === 'after-action').length;
    metrics.domEvidence.assertionPickCount = evidence.targets.filter(t => t.captureTiming === 'assertion-pick').length;
    metrics.domEvidence.scrollRequiredCount = evidence.targets.filter(t => t.viewport?.scrollRequired).length;
    metrics.domEvidence.virtualizedContainerCount = evidence.targets.filter(t =>
      [t.target, ...(t.ancestors ?? [])].some(node => node.virtualized)).length;
    metrics.domEvidence.detachedAtCaptureCount = evidence.targets.filter(t => t.attached === false).length;
    // P0.7. `ambiguousCount` above counts only what a claim-time count could see, which
    // for a click that navigated is a number about the wrong page. These count what was
    // measured at the press, where the person actually was.
    const allCandidates = evidence.targets.flatMap(t =>
      [...(t.derivedCandidates ?? []), ...(t.rejectedCandidates ?? [])]);
    metrics.domEvidence.pressMeasuredTargetCount = evidence.targets.filter(t =>
      [...(t.derivedCandidates ?? []), ...(t.rejectedCandidates ?? [])]
          .some(candidate => candidate.measuredAt === 'press')).length;
    metrics.domEvidence.identityProvenCount = allCandidates.filter(c => c.identityMatched === true).length;
    metrics.domEvidence.identityMismatchCount = allCandidates.filter(c => c.identityMatched === false).length;
    metrics.domEvidence.documentChangedCount = evidence.targets.filter(t =>
      t.matchCountDocument === 'other').length;
    metrics.domEvidence.pressTimeAmbiguousCount = evidence.targets.filter(t =>
      typeof t.pressTimeText?.matchCount === 'number' && t.pressTimeText.matchCount > 1).length;
  } else if (evidence) {
    metrics.domEvidence.unavailableReason = evidence.reason;
  }
  metrics.recordedLocatorCount = mapping.assessments.length;
  // Reuse is counted from the mapped steps, not the assessments: an element that a
  // Page Object already describes never reaches the engine.
  metrics.existingPageObjectReuseCount = mapping.steps.filter(s => s.kind === 'page-object'
    || s.kind === 'navigate' || s.kind === 'authenticate').length;
  const strategies = new Set<string>();
  for (const { assessment } of mapping.assessments) {
    strategies.add(assessment.strategy);
    if (assessment.dynamic?.dynamic)
      metrics.dynamicLocatorCount++;
    if (assessment.outcome === 'NEEDS_REVIEW')
      metrics.needsReviewCount++;
    if (assessment.outcome === 'STABLE_LOCATOR')
      metrics.stableLocatorCount++;
    if (assessment.outcome === 'NORMALIZED_LOCATOR')
      metrics.normalizedLocatorCount++;
    if (assessment.strategy === 'disambiguated-by-clicked-target')
      metrics.domEvidence.disambiguatedByClickedTargetCount++;
    if (assessment.outcome === 'RAW_LOCATOR_LAST_RESORT')
      metrics.rawLocatorFallbackCount++;
    if (assessment.outcome === 'SAFE_NEW_PAGE_OBJECT')
      metrics.newPageObjectCount++;
    if (assessment.classification === 'weak')
      metrics.weakLocatorCount++;
    if (assessment.classification === 'suspicious')
      metrics.suspiciousLocatorCount++;
    if (assessment.outcome === 'NORMALIZED_LOCATOR' && /measured at|counted/.test(assessment.reason))
      metrics.domEvidence.resolvedFromEvidence++;
    metrics.candidateCount += assessment.candidates.length;
    metrics.cssCandidateCount += assessment.candidates.filter(c => c.strategy === 'css'
      || c.strategy === 'stable-id' || c.strategy === 'data-attribute').length;
    metrics.xpathCandidateCount += assessment.candidates.filter(c => c.strategy.startsWith('xpath')).length;
    metrics.xpathAxisCandidateCount += [...assessment.candidates, ...assessment.rejected]
        .filter(c => /ancestor|descendant|sibling|parent::|following|preceding/.test(c.strategy)).length;
    metrics.rejectedCandidateCount += assessment.rejected.length;
  }
  metrics.locatorStrategiesUsed = [...strategies].sort();
  return metrics;
}

/** Every step that fell back to a recorded locator, as a coverage report. */
export function pageObjectRequirements(mapping: MappingResult): PageObjectRequirement[] {
  return mapping.steps
      .filter(step => step.kind === 'codegen-locator' && !step.subject)
      .map(step => ({
        target: step.label,
        locator: step.code.join(' ').trim(),
        did: step.from,
      }));
}

/** Compare application-visible names the way a person would: case and spacing only. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

interface ElementMatch {
  pageObject: string;
  method: string;
  why: string;
  /** The knowledge file the element came from, so its own entry point is reachable. */
  page?: PageKnowledge;
  /**
   * Arguments to call the method with, already quoted as TS literals.
   *
   * Absent and empty mean the same thing at the call site - `()`. Only ever
   * populated by `argumentsFor`, and only from a value the knowledge file's
   * author wrote down.
   */
  args?: string[];
}

/** `LoginPage.open()` style entry point a knowledge file declares for its screen. */
function entryPointOf(page: PageKnowledge, index: FrameworkIndex): ElementMatch | null {
  const match = /([A-Z]\w*Page)\.(\w+)\(\)/.exec(page.entryPoint || '');
  if (!match || !methodIsDeliverable(index, match[1], match[2]))
    return null;
  return {
    pageObject: match[1], method: match[2], page,
    why: `${page.file} declares ${match[1]}.${match[2]}() as this screen's entry point`,
  };
}

/**
 * The screen the application lands on after a sign-in, as KNOWLEDGE declares it.
 *
 * `entryPointOf` answers "how is this screen opened?" for a screen somebody has
 * already identified. This answers the question that comes first when nothing on the
 * next recorded action identifies a screen at all: which screen is the person on now?
 *
 * The answer is not inferred from the recording - a recording cannot see a redirect
 * it did not perform. It is read from the knowledge file, which states it outright
 * (`entry_point: ProjectsPage.open() after sign-in`). Nothing here is Bugasura
 * specific: any application whose knowledge declares a post-sign-in landing screen
 * gets the same treatment, and one that declares none gets nothing.
 *
 * AMBIGUITY IS NOT A MATCH, for the same reason it is not one in `findMethod`: two
 * screens both claiming to be where sign-in lands is a question for their author,
 * and picking either would be a guess wearing a mapping's clothes.
 */
function landingAfterSignIn(knowledge: PageKnowledge[], index: FrameworkIndex): ElementMatch | null {
  const declared = knowledge.filter(page => (page.route || '/') !== '/'
    && /after\s+sign[\s-]?in/i.test(page.entryPoint ?? '')
    && entryPointOf(page, index));
  if (declared.length !== 1)
    return null;
  return entryPointOf(declared[0], index);
}

/**
 * Does this element's description QUOTE the wording that was recorded?
 *
 * Knowledge files often carry the application's literal copy only in prose - `/apps`
 * describes its trigger as `"+ Create Project" trigger on the dashboard` and gives it
 * no `accessible_name` field at all - so ignoring descriptions throws away real
 * recorded knowledge. But matching descriptions *loosely* is worse than useless, and
 * measurement showed exactly why: descriptions REFER TO OTHER ELEMENTS. "Create
 * Project" appears in three of them -
 *
 *   create_project_button      "+ Create Project" trigger on the dashboard
 *   create_new_team_heading    ... a SEPARATE dialog from Create Project ...
 *   create_team_cancel_button  ... the Create Project dialog underneath stays open
 *
 * - so a plain phrase match tied three ways and resolved to nothing.
 *
 * The signal that separates them is quoting. These files quote the application's own
 * wording and leave cross-references unquoted, which is a convention rather than an
 * accident: a quoted string in a knowledge file is copy, and copy is what a recorded
 * accessible name is. So only quoted segments are searched, and the two elements
 * merely *mentioning* Create Project stop competing with the one that IS it.
 *
 * Still fenced: the phrase must be substantial (two words, or one of six characters)
 * and must match a whole quoted segment's words, not a fragment of one.
 */
function describes(description: string | undefined, wanted: string): boolean {
  if (!description || !wanted)
    return false;
  const words = wanted.split(' ').filter(Boolean);
  if (words.length < 2 && wanted.length < 6)
    return false;

  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const phrase = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`);
  for (const quoted of description.matchAll(/"([^"]{2,80})"|'([^']{2,80})'/g)) {
    if (phrase.test(normalise(quoted[1] ?? quoted[2] ?? '')))
      return true;
  }
  return false;
}

/** Names rank already-proven capabilities; they never establish target identity. */
function provenMethodArguments(element: PageElement, method: IndexedMethod,
  evidence: TargetEvidence | null | undefined, role: 'action' | 'assertion'): string[] | null {
  if (!evidence || (element.usage && element.usage !== role)) return null;
  if ((method.params ?? []).some(parameter => !parameter.optional)) {
    const reuse = resolveParameterisedReuse({ evidence, element, method, role, usage: element.usage ?? null });
    return reuse.status === 'REUSE_PARAMETERIZED' ? reuse.parameters.map(p => literal(p.value)) : null;
  }
  const declared = (element.locator_strategy ?? '').trim();
  if (!declared.startsWith('page.') || isPositionalLocator(declared) || chainHasDynamicIdentifier(declared)) return null;
  const normaliseExpression = (value: string) => value.replace(/["']/g, '"').replace(/\s+/g, ' ').trim();
  return provenMeasurements(evidence, role).some(candidate =>
    normaliseExpression(candidate.expression ?? '') === normaliseExpression(declared)) ? [] : null;
}

/** A measured route can distinguish proven page owners. Shared controls with a sole
 * proven capability still reuse it; route alone never proves any capability. */
function preferMeasuredRoute<T>(matches: T[], evidence: TargetEvidence | null | undefined,
  pageOf: (match: T) => PageKnowledge | undefined): T[] {
  if (!evidence?.route) return matches;
  if (evidence.captureTiming !== 'before-action' && evidence.captureTiming !== 'assertion-pick') return matches;
  const onRoute = matches.filter(match => routeMatches(pageOf(match)?.route || '/', evidence.route!));
  return onRoute.length ? onRoute : matches;
}

function findMethod(
  target: string,
  knowledge: PageKnowledge[],
  index: FrameworkIndex,
  /**
   * The recorded target's evidence, when the caller has it.
   *
   * Used for one thing only: supplying a parameterised method's argument from the
   * expression the recorder PROVED for this element. Absent evidence changes nothing
   * - the method is simply refused as it was before.
   */
  evidence?: TargetEvidence | null,
  role: 'action' | 'assertion' = 'action',
): ElementMatch | null {
  const wanted = normalise(target);
  if (!wanted)
    return null;

  const exists = (pageObject: string, method: string) =>
    methodIsDeliverable(index, pageObject, method);
  const indexed = (pageObject: string, method: string) =>
    deliverableMethod(index, pageObject, method);

  const provenArgs = new Map<PageElement, string[]>();
  let candidates: Array<{ match: ElementMatch; rank: number; accessibleName?: string;
    element?: PageElement; }> = [];

  for (const page of knowledge) {
    for (const element of page.elements) {
      const pageObject = element.page_object;
      const method = element.page_object_method;
      if (!pageObject || !method || !exists(pageObject, method))
        continue;
      const args = provenMethodArguments(element, indexed(pageObject, method)!, evidence, role);
      if (!args) continue;
      provenArgs.set(element, args);

      const name = normalise(element.accessible_name ?? '');
      const id = normalise(element.id);
      const methodWords = normalise(element.page_object_method ?? '');

      if (name && name === wanted)
        candidates.push({ rank: 1, match: { pageObject, method, page, why: `accessible name "${element.accessible_name}" in ${page.file}` } , accessibleName: element.accessible_name, element });
      else if ((id && id === wanted) || (methodWords && methodWords === wanted))
        candidates.push({ rank: 2, match: { pageObject, method, page, why: `element id "${element.id}" in ${page.file}` } , accessibleName: element.accessible_name, element });
      else if (name && wanted.length >= 4 && name.includes(wanted))
        candidates.push({ rank: 3, match: { pageObject, method, page, why: `"${target}" is part of accessible name "${element.accessible_name}"` } , accessibleName: element.accessible_name, element });
      else if (describes(element.description, wanted))
        candidates.push({ rank: 4, match: { pageObject, method, page, why: `${page.file} describes it as "${(element.description ?? '').trim()}"` } , accessibleName: element.accessible_name, element });
      else
        candidates.push({ rank: 5, match: { pageObject, method, page, why: `${page.file} declares the locator whose target identity was measured` }, element });
    }
  }

  if (!candidates.length)
    return null;
  candidates = preferMeasuredRoute(candidates, evidence, entry => entry.match.page);
  // Names cannot choose between two independently declared capabilities for one target.
  if (new Set(candidates.map(entry => `${entry.match.pageObject}.${entry.match.method}`)).size > 1) return null;
  candidates.sort((left, right) => left.rank - right.rank);

  // Multiple owners were refused above. Names choose only a diagnostic label
  // among declarations of the same proven capability.
  const winner = candidates[0];
  const args = winner.element ? provenArgs.get(winner.element) : null;
  if (!args)
    return null;
  return { ...winner.match, why: `${winner.match.why}; its declared locator was proven against this target`, ...(args.length ? { args } : {}) };
}

/**
 * An EXISTING, non-parameterised method whose declared locator IS this element.
 *
 * The third and last reuse resolver, and the one that closes the gap the other two
 * leave. `findMethod` matches on what the recording CALLED the element; a recorded
 * assertion on the issue-list search box is called `filter-value` (its id) while
 * knowledge declares it under `accessible_name: Search`, so no name matches and the
 * step fell through to a raw locator - even though the capability
 * (`IssuesPage.searchField`) was sitting right there. `findParameterisedMethod`
 * cannot help either: `searchField()` takes no argument.
 *
 * What settles it is the thing neither name has: the expression the recorder PROVED,
 * measured at the press, at one element, in that document, against the element acted
 * on. `page.locator("#filter-value")` is what knowledge declares that method to be.
 *
 * TWO WAYS TO MATCH, BOTH DETERMINISTIC AND BOTH NARROW:
 *
 * 1. EXACT EQUIVALENCE - the declared strategy, normalised for quotes and spacing, is
 *    the proven expression. Nothing is inferred.
 * 2. A SOLE AUTHORED ID - the proven expression is exactly an id locator, and the
 *    entry declares that same id as its ONLY concrete selector. Requiring it to be the
 *    only one is what keeps `LoginPage.errorMessage` out: it declares
 *    `#toast-container .toast-message`, where the id names the container and the
 *    element is the class, so an expression naming the container is not that method.
 *
 * AMBIGUITY IS REFUSED, exactly as in `findMethod`: two entries claiming one id is
 * knowledge that does not identify a method, so the step falls through and a person
 * decides. And a dynamic id can never match, because a generated id names one issue
 * rather than one element - which is the rule everywhere else here.
 *
 * NO MODEL, and none reachable: this is string comparison over authored knowledge.
 */
export function findMethodByProvenLocator(
  evidence: TargetEvidence | null,
  knowledge: PageKnowledge[],
  index: FrameworkIndex,
  role: 'action' | 'assertion',
): ElementMatch | null {
  if (!evidence)
    return null;

  // EVERY PROVEN EXPRESSION IS TRIED, BEST FIRST - not only the top-ranked one.
  //
  // This used to read `provenCandidate` alone, which was harmless while that returned
  // the first candidate in generation order and generation put the authored id first.
  // Ranking changed which one comes back, and TC_LOGIN_126/127 immediately lost the
  // reuse of `ProjectsPage.createTeamCancelButton()`: the ranked pick was a scoped text
  // chain, knowledge declares `#create_team_cancel_btn`, and a resolver that sees one
  // expression cannot notice that another proven candidate names the very method it is
  // looking for.
  //
  // NOTHING IS RELAXED. Each candidate still has to pass `provesIdentity` for this role,
  // still may not be positional or built on a generated id, and still has to resolve to
  // exactly ONE declared method - two claimants are refused here as they always were.
  // What changed is only how many proven expressions get to ask the question.
  const candidates = [...rankProvenCandidates(evidence, role), ...provenMeasurements(evidence, role)];
  const matches = candidates.flatMap(proven => declaredMethodsFor(proven, knowledge, index, role));
  const scoped = preferMeasuredRoute(matches, evidence, match => match.page);
  const distinct = new Map(scoped.map(match => [`${match.pageObject}.${match.method}`, match]));
  return distinct.size === 1 ? [...distinct.values()][0] : null;
}

/** One proven expression against the declared methods. See `findMethodByProvenLocator`. */
function declaredMethodsFor(
  proven: CandidateMeasurement,
  knowledge: PageKnowledge[],
  index: FrameworkIndex,
  role: 'action' | 'assertion',
): ElementMatch[] {
  if (!provesIdentity(proven, role))
    return [];
  const expression = (proven.expression ?? '').trim();
  if (!expression || isPositionalLocator(expression) || chainHasDynamicIdentifier(expression))
    return [];

  const flatten = (value: string): string =>
    value.replace(/["']/g, '"').replace(/\s+/g, ' ').trim();
  const wanted = flatten(expression);

  // The id this expression resolves BY, and only when that is all it does.
  const sole = /^page\.locator\(\s*["']#([A-Za-z_][\w-]*)["']\s*\)$/.exec(expression);
  const soleId = sole && !analyseIdentifier(sole[1]).dynamic ? `#${sole[1]}` : null;

  const exact: ElementMatch[] = [];
  const byId: ElementMatch[] = [];

  for (const page of knowledge) {
    for (const element of page.elements) {
      const pageObject = element.page_object;
      const method = element.page_object_method;
      if (!pageObject || !method)
        continue;
      const indexed = deliverableMethod(index, pageObject, method);
      if (!indexed)
        continue;
      // A method that takes an argument is `findParameterisedMethod`'s to resolve; it
      // needs a value read from the recording, which this resolver never supplies.
      if ((indexed.params ?? []).some(parameter => !parameter.optional))
        continue;
      // ACTION AND ASSERTION STAY SEPARATE. Where knowledge states which a method is
      // for, the other kind may not have it. An entry stating neither is unconstrained,
      // which is how one control serves a click, a fill and an assertion without
      // growing three methods.
      const usage = (element.usage ?? '').trim().toLowerCase();
      if (usage && usage !== role)
        continue;

      const declared = (element.locator_strategy ?? '').trim();
      if (!declared)
        continue;
      const match: ElementMatch = { pageObject, method, page,
        why: `${page.file} declares this method for the expression the recorder proved` };

      if (flatten(declared) === wanted) {
        exact.push(match);
        continue;
      }
      const tokens = declaredSelectors(element);
      if (soleId && tokens.length === 1 && tokens[0] === soleId)
        byId.push(match);
    }
  }

  return exact.length ? exact : byId;
}

/**
 * An EXISTING parameterised method whose locator template this target matches.
 *
 * Tried only after `findMethod` has found nothing, so an exact match on a name always
 * wins and the decision order is unchanged. What this adds is the case a name cannot
 * reach at all: a row checkbox records as `639978`, which is one issue's id and
 * resembles no method - but the expression the recorder PROVED for it,
 *
 *   page.locator(".tabulator-row").filter({ hasText: "..." }).locator(".bugChecked")
 *
 * differs from `IssuesPage.issueCheckboxState`'s declared template in exactly one
 * place: where the parameter goes. That is a structural match, not a resemblance, and
 * the value standing in that position is the argument.
 *
 * Nothing here relaxes a gate. The expression read from is the press-time proven one,
 * and substituting the value back must reproduce it exactly - so the locator a call
 * builds IS the string the browser measured at one element, in the press's document,
 * and confirmed to be the element acted on.
 *
 * AMBIGUITY IS NOT A MATCH, as everywhere else here: two templates matching one
 * expression means the recording does not say which method was meant, so neither is
 * used.
 */
function findParameterisedMethod(
  evidence: TargetEvidence | null,
  knowledge: PageKnowledge[],
  index: FrameworkIndex,
  role: 'action' | 'assertion',
): ElementMatch | null {
  if (!evidence)
    return null;
  const matches: ElementMatch[] = [];
  for (const page of knowledge) {
    for (const element of page.elements) {
      const owner = element.page_object;
      const name = element.page_object_method;
      if (!owner || !name)
        continue;
      const method = deliverableMethod(index, owner, name);
      if (!method || !(method.params ?? []).some(parameter => !parameter.optional))
        continue;
      const reuse = resolveParameterisedReuse({
        evidence, element, method, role, usage: element.usage ?? null,
      });
      if (reuse.status !== 'REUSE_PARAMETERIZED')
        continue;
      matches.push({
        pageObject: owner, method: name, page,
        args: reuse.parameters.map(parameter => literal(parameter.value)),
        why: `reused the existing parameterised ${owner}.${name}() - ${reuse.parameters
          .map(parameter => `${parameter.parameterName} read from ${parameter.source}`).join(' and ')}`
          + ', and substituting it reproduces the expression measured at the press',
      });
    }
  }
  const scoped = preferMeasuredRoute(matches, evidence, match => match.page);
  return scoped.length === 1 ? scoped[0] : null;
}

/**
 * `await projectsPage.openProject('Faclon labs')` - the receiver a step calls.
 *
 * One helper for both the action and the assertion site: they used to build the
 * same string independently, which is how one of them could learn about arguments
 * and the other not.
 */
function receiverFor(match: ElementMatch): string {
  return `await ${fixtureFor(match.pageObject)}.${match.method}(${(match.args ?? []).join(', ')})`;
}

/**
 * The evidence row for an assertion's locator.
 *
 * An assertion carries the locator the picker RESOLVED, not the one Codegen wrote, so
 * the sidecar's own key misses it. The fallback is an exact match against a
 * measurement taken for that element - never a partial or resembling one.
 */
function evidenceForResolved(
  evidence: RecordingEvidence | undefined,
  locator: string,
): TargetEvidence | null {
  if (!locator || !isDomEvidence(evidence))
    return null;
  return evidence.targets.find(target =>
    (target.derivedCandidates ?? []).some(candidate => candidate.expression === locator)) ?? null;
}

/** `LoginPage` -> `loginPage`, which is how the fixtures expose it. */
function fixtureFor(pageObject: string): string {
  return pageObject.charAt(0).toLowerCase() + pageObject.slice(1);
}

/**
 * May this Page Object method be emitted AT ALL - and the answer is not "does it exist".
 *
 * A generated spec obtains a Page Object one way only: by destructuring the Playwright
 * fixture that provides it. So a method is usable when TWO things hold, and the resolvers
 * only ever checked the first:
 *
 *   1. the class declares the method (`index.pages`), and
 *   2. the framework declares a fixture that delivers the class (`index.fixtures`).
 *
 * WHAT THE SECOND ONE COST. `IssuesPage` is a Page Object with no fixture. Its methods
 * were offered for reuse, `assembleSpec` destructured `issuesPage`, and Playwright
 * refused the file outright: `Test has unknown parameter "issuesPage"`, 0 tests
 * collected. The gate then reported "Not Collected", which is the symptom. Ten specs
 * were quarantined that way - TC_DASHBOARD_020, TC_LOGIN_089/090/091/092/094/104/109/
 * 110/111 - and in every one of them the locator pipeline had already done its job.
 * `Base` and `TermsPage` are in the same position and would have done the same.
 *
 * Both halves come from the SAME index that was already being consulted, so nothing new
 * is read and nothing is guessed. A method that fails this simply is not a match, and
 * the step falls back to the evidence-backed locator path exactly as it would for an
 * element no Page Object describes.
 */
// Exported for `locator-validation.fixture.ts` only, on the same terms as
// `splitCandidates`: this predicate is the whole of the fix, it is consulted from six
// call sites, and a rule with six callers and no test is how one of them drifts.
export function methodIsDeliverable(index: FrameworkIndex, pageObject: string, method: string): boolean {
  if (!index.pages[pageObject]?.methods.some(entry => entry.name === method))
    return false;
  // FAILS CLOSED. An index with no fixture list declares no fixtures, so it can deliver
  // nothing - never "so anything goes". Defaulting the other way would turn the gate off
  // for any caller holding a partial index, which is the failure mode this rule exists
  // to close.
  return (index.fixtures ?? []).includes(fixtureFor(pageObject));
}

/** The indexed method, but only when a fixture can actually deliver it. */
function deliverableMethod(
  index: FrameworkIndex, pageObject: string, method: string,
): FrameworkIndex['pages'][string]['methods'][number] | undefined {
  if (!(index.fixtures ?? []).includes(fixtureFor(pageObject)))
    return undefined;
  return index.pages[pageObject]?.methods.find(entry => entry.name === method);
}

/** A TS string literal, quoted safely. */
function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/**
 * The Page Object whose knowledge file claims this route, so a recorded navigation
 * becomes `projectsPage.open()` rather than a bare goto.
 */
function openerFor(url: string, knowledge: PageKnowledge[], index: FrameworkIndex): ElementMatch | null {
  let route: string;
  try {
    route = new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return null;
  }
  for (const page of knowledge) {
    const declared = (page.route || '').split(/[?#]/)[0].replace(/\/$/, '') || '/';
    if (declared !== route)
      continue;
    // `entry_point: LoginPage.open() navigates to Ã¢â‚¬Â¦`
    const match = /([A-Z]\w*Page)\.(\w+)\(\)/.exec(page.entryPoint || '');
    if (match && methodIsDeliverable(index, match[1], match[2]))
      return { pageObject: match[1], method: match[2], why: `${page.file} declares it as this route's entry point` };
  }
  return null;
}

/** The action verbs a mapped locator supports, and how each is called. */
function callFor(action: RecordedAction, receiver: string): string[] {
  switch (action.type) {
    case 'click': return [`await (${receiver}).click();`];
    case 'dblclick': return [`await (${receiver}).dblclick();`];
    case 'hover': return [`await (${receiver}).hover();`];
    case 'check': return [`await (${receiver}).check();`];
    case 'uncheck': return [`await (${receiver}).uncheck();`];
    case 'fill': return [`await (${receiver}).fill(${dataFieldToken(action.value) ? generatedInput(action.value!) : literal(action.value ?? '')});`];
    case 'press': return [`await (${receiver}).press(${literal(action.value ?? 'Enter')});`];
    case 'select': return [`await (${receiver}).selectOption(${dataFieldToken(action.value) ? generatedInput(action.value!) : literal(action.value ?? '')});`];
    default: return [];
  }
}

/**
 * One recorded assertion, as Playwright code. Deterministic: no model is asked
 * what `not ticked` means.
 *
 * `expected` is the person's claim - IS this true, or is it NOT? Absent means
 * true, which is what every recording made before the field existed meant.
 * Where Playwright has a matcher for the negative it is used (`toBeHidden` for
 * a visibility that must be false); everywhere else the negation is `.not.`,
 * which is exactly what the recorder wrote down.
 */
const MATCHER: Record<RecordedAssertion['type'],
  (receiver: string, assertion: RecordedAssertion, positive: boolean) => string> = {
  visible: (receiver, _assertion, positive) =>
    `await expect(${receiver}).${positive ? 'toBeVisible' : 'toBeHidden'}();`,
  hidden: (receiver, _assertion, positive) =>
    `await expect(${receiver}).${positive ? 'toBeHidden' : 'toBeVisible'}();`,
  // Playwright has a matcher for each side of enabled-ness, so neither side
  // needs `.not.` - and `toBeDisabled()` reads as what the person recorded.
  enabled: (receiver, _assertion, positive) =>
    `await expect(${receiver}).${positive ? 'toBeEnabled' : 'toBeDisabled'}();`,
  text: (receiver, assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toHaveText(${literal(assertion.value ?? '')});`,
  contains: (receiver, assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toContainText(${literal(assertion.value ?? '')});`,
  value: (receiver, assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toHaveValue(${literal(assertion.value ?? '')});`,
  values: (receiver, assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toHaveValues([${(assertion.values ?? [])
        .map(value => literal(value)).join(', ')}]);`,
  checked: (receiver, _assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toBeChecked();`,
  empty: (receiver, _assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toBeEmpty();`,
  attribute: (receiver, assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toHaveAttribute(`
    + `${literal(assertion.name ?? '')}, ${literal(assertion.value ?? '')});`,
  class: (receiver, assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toHaveClass(${literal(assertion.value ?? '')});`,
  url: (_receiver, assertion, positive) =>
    `await expect(page)${positive ? '' : '.not'}.toHaveURL(${literal(assertion.value ?? '')});`,
  count: (receiver, assertion, positive) =>
    `await expect(${receiver})${positive ? '' : '.not'}.toHaveCount(${Number(assertion.value ?? 0)});`,
  title: (_receiver, assertion, positive) =>
    `await expect(page)${positive ? '' : '.not'}.toHaveTitle(${literal(assertion.value ?? '')});`,
};

/**
 * Which recorded actions ARE the sign-in, so they can be replaced by the framework's
 * own mechanism rather than reproduced.
 *
 * The span runs from the first field the person filled in on the login form through
 * the submit that followed the password. It deliberately does NOT start at the
 * beginning of the recording, and that is a bug fix rather than a nicety: the first
 * version absorbed everything up to the submit, which swallowed the opening
 * `page.goto` as well. The assembled spec then called `loginPage.signIn()` on
 * `about:blank`, and the gate rejected it with "Could not resolve login.emailField on
 * about:blank" - correctly, because the test never opened the page.
 *
 * So the walk goes BACKWARDS from the password: fills and clicks on the form are part
 * of signing in, and anything else - a navigation, an unrelated click - is not.
 */
/**
 * WHICH credential field a recorded fill carries.
 *
 * Structured provenance wins where the recorder supplied it. The legacy fallback -
 * "redacted means password, anything else in the span means account" - is kept EXACTLY for
 * recordings made before identifiers were protected, because for those it is still true.
 * Once identifiers are redacted too that inference is wrong in the worst direction: it
 * would emit the password into the account field.
 */
export function credentialFieldOf(action: RecordedAction): 'email' | 'password' | null {
  const source = action.valueSource;
  if (source && (source.kind === 'CREDENTIAL_PROFILE' || source.kind === 'APPLICATION_CREDENTIALS'))
    return source.field === 'password' ? 'password' : 'email';
  return null;
}
function authenticationSpan(actions: RecordedAction[]): { start: number; end: number } | null {
  const secretAt = actions.findIndex(action => action.type === 'fill'
    && (credentialFieldOf(action) === 'password' || (!action.valueSource && action.redacted === true)));
  if (secretAt === -1)
    return null;

  let end = -1;
  for (let index = secretAt + 1; index < actions.length; index++) {
    if (actions[index].type === 'click' || actions[index].type === 'press') {
      end = index;
      break;
    }
  }
  if (end === -1)
    return null;                 // filled a password but never submitted: not a sign-in

  let start = secretAt;
  while (start > 0) {
    const previous = actions[start - 1];
    if (previous.type === 'fill' || previous.type === 'click')
      start -= 1;                // still on the form
    else
      break;                     // a navigation, or something else entirely
  }
  return { start, end };
}

/** Reuse a composite only when its complete declared body is the same three proven
 * operations. A familiar method name is not evidence about what it does. */
function authComposite(index: FrameworkIndex, controls: MappedStep[]): string | null {
  if (controls.length !== 3 || controls.some(c => c.pageObject !== controls[0].pageObject)) return null;
  const owner = controls[0].pageObject!;
  const page = index.pages[owner];
  if (!page) return null;
  const source = fs.readFileSync(path.resolve(ROOT, page.file), 'utf8');
  const candidates = page.methods.filter(method => {
    if (method.params?.length !== 2 || method.params.some(p => p.type !== 'string') || (method.returns && method.returns !== 'void')) return false;
    const [email, password] = method.params.map(p => p.name);
    const body = new RegExp(`\\b${method.name}\\s*\\([^)]*\\)\\s*:\\s*Promise<void>\\s*\\{([^{}]*)\\}`).exec(source)?.[1];
    if (!body) return false;
    const expected = `await (await this.${controls[0].method}()).fill(${email});`
      + `await (await this.${controls[1].method}()).fill(${password});`
      + `await (await this.${controls[2].method}()).click();`;
    return body.replace(/\s/g, '') === expected.replace(/\s/g, '') && methodIsDeliverable(index, owner, method.name);
  });
  return candidates.length === 1 ? candidates[0].name : null;
}

/** Syntax and execution safety for an explicitly selected recorded locator; never identity proof. */
function checkedRecordedLocator(locator: string): string {
  const problem = () => { throw Error('Invalid recorded locator: select a supported, single Playwright locator expression.'); };
  if (!locator || locator.length > 4000 || forbiddenMechanisms(locator).length) return problem();
  const source = ts.createSourceFile('recorded-locator.ts', `const target = ${locator};`, ts.ScriptTarget.Latest, true);
  const statement = source.statements[0];
  if ((source as any).parseDiagnostics.length || source.statements.length !== 1 || !ts.isVariableStatement(statement)
      || statement.declarationList.declarations.length !== 1) return problem();
  const methods = new Set(['getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'getByAltText', 'getByTitle', 'locator', 'filter', 'and', 'or']);
  const value = (node: ts.Expression): boolean => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isNumericLiteral(node) || ts.isRegularExpressionLiteral(node)
    || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)
    || (ts.isArrayLiteralExpression(node) && node.elements.every(value))
    || (ts.isObjectLiteralExpression(node) && node.properties.every(property => ts.isPropertyAssignment(property)
      && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && value(property.initializer)))
    || chain(node);
  const chain = (node: ts.Expression): boolean => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && methods.has(node.expression.name.text) && node.arguments.every(value)
    && ((ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'page') || chain(node.expression.expression));
  const expression = statement.declarationList.declarations[0].initializer;
  if (!expression || !chain(expression)) return problem();
  return expression.getText(source);
}

export function mapRecording(recording: Recording): MappingResult {
  const knowledge = readAllPageKnowledge();
  const index = buildIndex();
  if (recording.authoringOwners && recording.authoringOwners.applicationId !== index.applicationId) throw Error('Foreign recording ownership metadata.');
  if (recording.authoringOwners && isDomEvidence(recording.evidence) && recording.evidence.origin?.applicationId
      && recording.evidence.origin.applicationId !== index.applicationId) throw Error('Foreign recording evidence cannot be used with this application binding.');
  const userSelection = (key: string) => {
    const choice = recording.authoringOwners?.choices.find(choice => choice.key === key);
    const binding = choice?.userSelection;
    if (!binding) return null;
    // USER_BINDING_INCOMPLETE carries a selection too - a Page Object associated with the step
    // and nothing chosen to run. It is admitted here only so it can be REPORTED as that; the
    // executable check below is what decides whether anything runs, and it never will.
    if (choice.provenance !== 'USER_CONFIRMED' && choice.provenance !== 'USER_BINDING_INCOMPLETE')
      throw Error('Invalid authoring provenance: user selection must be USER_CONFIRMED.');
    if (choice.provenance === 'USER_BINDING_INCOMPLETE' && executableBinding(binding))
      throw Error(`USER BINDING BROKEN: ${key} is marked incomplete but carries an executable binding.`);
    if (binding.applicationId !== index.applicationId) throw Error('Cross-application binding is not allowed.');
    if (binding.executionMode && !['AUTO', 'PAGE_OBJECT_METHOD', 'RECORDED_LOCATOR'].includes(binding.executionMode)) throw Error('Unknown authoring execution mode.');
    if (binding.executionMode === 'PAGE_OBJECT_METHOD' && !binding.method) throw Error('USER BINDING BROKEN: select a method for Page Object execution.');
    if (binding.method && !binding.pageObject) throw Error('USER BINDING BROKEN: selected method has no Page Object.');
    if (binding.pageObject && !index.pages[binding.pageObject]) throw Error(`USER BINDING BROKEN: ${binding.pageObject} disappeared.`);
    return binding;
  };
  const userMethod = (key: string): ElementMatch | null => {
    const binding = userSelection(key);
    if (!binding) return null;
    if (!binding.pageObject) return null;
    if (!index.pages[binding.pageObject]) throw Error(`USER BINDING BROKEN: ${binding.pageObject} disappeared.`);
    if (!binding.method) return null;
    const method = index.pages[binding.pageObject].methods.find(method => method.name === binding.method);
    if (!method || !methodIsDeliverable(index, binding.pageObject, binding.method))
      throw Error(`USER BINDING BROKEN: ${binding.pageObject}.${binding.method} or its fixture disappeared.`);
    const args = binding.arguments ?? [];
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || rejectValue(value))) throw Error('USER BINDING BROKEN: invalid or sensitive method arguments.');
    if (args.length > (method.params?.length ?? 0) || method.params?.some((parameter, at) => !parameter.optional && at >= args.length)) throw Error(`USER BINDING BROKEN: ${binding.pageObject}.${binding.method} requires arguments; review its binding.`);
    return { pageObject: binding.pageObject, method: binding.method, ...(args.length ? { args: args.map(literal) } : {}), why: 'USER_CONFIRMED authoring binding; automatic ownership inference is not used' };
  };
  const userLocator = (key: string, action: RecordedAction): string | null => {
    const binding = userSelection(key);
    return binding?.executionMode === 'RECORDED_LOCATOR' && !binding.method ? checkedRecordedLocator(binding.locatorOverride ?? action.locator) : null;
  };
  /**
   * A step carrying authoring that cannot run.
   *
   * A Page Object associated with a step is CONTEXT, not an execution choice, and context
   * inherits down a screen while the method deliberately does not. Such a step used to reach
   * here indistinguishable from one nobody had touched, fall through to automatic inference,
   * and be refused for missing interaction-time evidence - an accurate statement about the
   * evidence and a misleading one about the cause, because no amount of evidence would have
   * helped: nothing had ever said how to run it.
   *
   * Reported as its own state instead. Never silently demoted to AUTO, and never invented
   * into a recorded-locator choice the user did not make.
   */
  const incompleteBinding = (key: string): { pageObject: string; why: string } | null => {
    const binding = userSelection(key);
    if (!binding || executableBinding(binding)) return null;
    if (!binding.pageObject) return null;
    const known = index.pages[binding.pageObject];
    const methods = (known?.methods ?? []).map(method => method.name);
    return { pageObject: binding.pageObject,
      why: `USER_BINDING_INCOMPLETE: ${binding.pageObject} is associated with this step but no executable `
        + 'binding was saved. Choose one of its methods, create the method this step needs, or choose '
        + `recorded-locator execution in Recording Review${methods.length ? ` (existing methods: ${methods.join(', ')})` : ''}.` };
  };
  const steps: MappedStep[] = [];
  const fixtures = new Set<string>(['step']);
  if(recording.actions.some(action=>['fill','select'].includes(action.type)&&!action.redacted&&dataFieldToken(action.value)))fixtures.add('testData');
  const reused: Array<{ pageObject: string; method: string }> = [];
  let codegenLocators = 0;
  const assessments: Array<{ from: string; assessment: LocatorAssessment }> = [];
  /**
   * The whole recording, as context for resolving any one locator.
   *
   * A relationship the person demonstrated somewhere in the recording is evidence
   * everywhere in it: TC_LOGIN_036 clicks inside `#tc_summary_636432`, which is how
   * the resolver learns what that generated container holds.
   */
  const context: RecordedStep[] = [
    ...recording.actions.filter(a => a.locator)
        .map(a => ({ locator: a.locator, target: a.target, kind: 'action' as const, value: a.value })),
    ...recording.assertions.filter(a => a.locator)
        .map(a => ({ locator: a.locator, target: a.target, kind: 'assertion' as const, value: a.value })),
  ];

  const span = authenticationSpan(recording.actions);
  const authenticated = span !== null;
  // Plan the whole credential span before emitting any part of it. Explicit execution
  // choices lead; automatic destinations require identity. Never emit partial credentials.
  const authSteps = new Map<number, MappedStep>();
  let authProblem = '';
  const credentialFixture = credentialsFixtureName();
  if (span) {
    const origin = isDomEvidence(recording.evidence) ? recording.evidence.origin : undefined;
    if ((origin?.applicationId ?? recording.authoringOwners?.applicationId) !== activeScope().applicationId)
      authProblem = 'authentication needs recording ownership in the active application';
    else if (!credentialFixture)
      authProblem = 'the active application has no credentials fixture';
    const bindings: Array<{ at: number; action: RecordedAction; evidence: TargetEvidence | null; match: ElementMatch | null; locator: string | null; explicit: boolean }> = [];
    for (let at = span.start; at <= span.end && !authProblem; at++) {
      const action = recording.actions[at];
      const evidence = evidenceFor(recording.evidence, action.locator);
      const authKnowledge = guidedKnowledge(recording, `action:${at}`, knowledge);
      const explicitMatch = userMethod(`action:${at}`);
      const locator = explicitMatch ? null : userLocator(`action:${at}`, action);
      const explicit = !!(explicitMatch || locator);
      const match = explicitMatch ?? (!locator && evidence && provenMeasurements(evidence, 'action').length > 0 ? (
        findMethod(action.target, authKnowledge, index, evidence, 'action')
        ?? findMethodByProvenLocator(evidence, authKnowledge, index, 'action')
        ?? findParameterisedMethod(evidence, authKnowledge, index, 'action')) : null);
      if (!explicit && (!evidence || !match)) {
        const proven = provenMeasurements(evidence, 'action').length > 0;
        authProblem = `authentication action ${at} (${action.type} ${action.target}): ` + (proven
          ? 'identity is proven, but no unique deliverable Page Object capability matches its measured page and locator'
          : 'missing admissible interaction-time identity evidence for this control');
        break;
      }
      bindings.push({ at, action, evidence, match, locator, explicit });
    }
    const fields = bindings.filter(b => b.action.type === 'fill');
    const secret = fields.filter(b => credentialFieldOf(b.action) === 'password'
      || (!b.action.valueSource && b.action.redacted && (b.explicit || b.evidence?.target.type === 'password')));
    const account = fields.filter(b => credentialFieldOf(b.action) === 'email'
      || (!b.action.valueSource && !b.action.redacted && (b.explicit ||
      b.evidence?.target.type === 'email' || b.evidence?.target.name === 'username'
      || b.evidence?.target.id === 'username')));
    const submit = bindings.find(b => b.at === span.end);
    if (!authProblem && (secret.length !== 1 || account.length !== 1 || fields.length !== 2
        || !submit || (!submit.explicit && submit.evidence?.target.type !== 'submit')
        || !['click', 'press'].includes(submit.action.type)
        || (submit.action.type === 'press' && submit.action.value !== 'Enter')))
      authProblem = 'authentication needs an unambiguous measured account field, password field and submit control';
    if (!authProblem && bindings.some(b => !b.explicit && b.at !== span.end && b.action.type !== 'fill'
        && !(b.action.type === 'click' && [secret[0], account[0]].some(field =>
          field.evidence?.documentId && field.evidence.documentId === b.evidence?.documentId
          && field.evidence.elementRef && field.evidence.elementRef === b.evidence?.elementRef))))
      authProblem = 'authentication contains an operation outside its proven credential controls';
    if (!authProblem) {
      for (const binding of bindings) {
        const { action, match, at, locator } = binding;
        const receiver = match ? receiverFor(match) : locator!;
        const code = action.type === 'fill'
          ? [`await (${receiver}).fill(${credentialFixture}.${credentialFieldOf(action) ?? (action.redacted ? 'password' : 'email')});`]
          : callFor(action, receiver);
        authSteps.set(at, { kind: match ? 'page-object' : 'codegen-locator', label: action.type === 'fill'
          ? `Enter ${(credentialFieldOf(action) ?? (action.redacted ? 'password' : 'email')) === 'password' ? 'password' : 'account'} from configured credentials` : `Use ${action.target}`,
          code, pageObject: match?.pageObject, method: match?.method, ...(!match ? { subject: 'authentication' as const } : {}),
          why: `authentication composed from scoped controls: ${match?.why ?? 'USER_CONFIRMED recorded locator — USER AUTHORED — NOT VALIDATED'}`,
          from: `${action.type} ${action.target}` });
      }
      const controls = [...authSteps.values()];
      const hasExplicitControls = bindings.some(binding => binding.explicit);
      const composite = !hasExplicitControls && !recording.assertions.some(a => a.afterActions !== undefined
          && a.afterActions > span.start && a.afterActions <= span.end)
        && fields[0] === account[0] && fields[1] === secret[0] ? authComposite(index, controls) : null;
      if (composite) {
        authSteps.clear();
        authSteps.set(span.end, { kind: 'authenticate', subject: 'authentication', components: controls,
          label: 'Sign in using configured credentials', from: 'recorded sign-in',
          pageObject: controls[0].pageObject, method: composite,
          why: 'declared composite body matches the measured credential controls',
          code: [`await ${fixtureFor(controls[0].pageObject!)}.${composite}(${credentialFixture}.email, ${credentialFixture}.password);`] });
      }
    }
  }

  const emitAction = (action: RecordedAction, position: number): void => {
    if (span && position >= span.start && position <= span.end) {
      if (authProblem) {
        if (position === span.end)
          steps.push({ kind: 'unresolved', subject: 'authentication', failure: 'authenticationCapability',
            label: 'Authentication capability required', code: [], why: authProblem, from: 'recorded sign-in' });
      } else {
        const planned = authSteps.get(position);
        if (!planned) return;
        fixtures.add(credentialFixture!);
        if (planned.pageObject && planned.method) {
          fixtures.add(fixtureFor(planned.pageObject));
          reused.push({ pageObject: planned.pageObject, method: planned.method });
        } else { fixtures.add('page'); codegenLocators++; }
        steps.push(planned);
      }
      return;
    }

    if (action.redacted) {
      steps.push({ kind: 'unresolved', subject: 'authentication', failure: 'authenticationCapability',
        label: 'Unsupported credential operation', code: [], from: 'recorded credential operation',
        why: 'a redacted operation outside the proven authentication span requires review' });
      return;
    }

    if (action.type === 'navigate') {
      if (action.navigationCause === 'observed') {
        steps.push({ kind: 'navigate', subject: 'navigation', label: 'Observed browser navigation', code: [],
          why: 'the browser navigated as a consequence; no navigation command is replayed', from: `navigate event ${position}` });
        return;
      }
      // A NAVIGATION THAT FOLLOWS A STEP THE USER EXPLICITLY BOUND is a consequence of it.
      //
      // A browser-managed redirect has no DOM target to prove, so demanding target evidence
      // for it demands something that cannot exist - and the codegen transport supplies no
      // protocol journal at all, so every such navigation reads as `unknown`. What CAN be
      // established without inventing anything is the cause: the last real action before it
      // is one the user confirmed and bound. That is recorded as provenance and nothing else.
      // The destination is still not claimed, nothing is replayed, and no identity is asserted.
      //
      // A navigation with no confirmed action behind it is genuinely unproven and still
      // blocks, which is the protection this must not spend.
      const causedBy = (() => {
        for (let at = position - 1; at >= 0; at--) {
          const previous = recording.actions[at];
          if (previous.type === 'navigate') continue;  // a redirect chain shares one cause
          return executableBinding(userSelection(`action:${at}`)) ? { at, action: previous } : null;
        }
        return null;
      })();
      if (causedBy && action.navigationCause !== 'intentional') {
        steps.push({ kind: 'navigate', subject: 'navigation', label: 'Navigation after a confirmed action', code: [],
          from: `navigate event ${position}`,
          why: 'no navigation command is replayed; this navigation follows the USER_CONFIRMED step '
            + `"${causedBy.action.type} ${causedBy.action.target}" (action:${causedBy.at}) and is retained as its `
            + 'consequence. A browser-managed navigation has no DOM target, so none is claimed' });
        return;
      }
      if (action.navigationCause !== 'intentional' || !replayableNavigation(action.value ?? '')) {
        steps.push({ kind: 'needs-review', subject: 'navigation', failure: 'navigationCausality',
          label: 'Navigation needs review', code: [], from: `navigate event ${position}`,
          why: `navigation requires review (${action.navigationReason ?? 'capture reason unavailable'}); intent is unproven or the destination may carry authentication/session state`
            + (action.navigationCounts ? `; evidence: ${action.navigationCounts.documents} document, ${action.navigationCounts.history} history, ${action.navigationCounts.other} same-document, ${action.navigationCounts.unresolved} unattributed` : '') });
        return;
      }
      fixtures.add('page');
      steps.push({ kind: 'navigate', subject: 'navigation', label: 'Open recorded destination',
        code: [`await page.goto(${literal(action.value!)});`],
        why: 'explicit recorded navigation intent', from: `navigate event ${position}` });
      return;
    }

    // DECISION ORDER, three resolvers, narrowest evidence first:
    //   1. `findMethod`                - an existing method matched by the NAME the
    //                                    recording used for the element.
    //   2. `findMethodByProvenLocator` - an existing non-parameterised method whose
    //                                    declared locator IS the proven expression.
    //   3. `findParameterisedMethod`   - an existing method whose declared TEMPLATE
    //                                    the proven expression matches, supplying its
    //                                    argument from the recording.
    // Only after all three does the step fall through to its recorded locator and get
    // reported as PAGE OBJECT REQUIRED.
    // THE EVIDENCE IS HANDED TO BOTH. `findMethod` uses it only to break a tie between
    // knowledge entries that share an accessible name - "Search" names the issue
    // list's box and the project list's - and it can only ever narrow, never match
    // something the name did not already support.
    const actionEvidence = evidenceFor(recording.evidence, action.locator);
    const actionKnowledge = guidedKnowledge(recording, `action:${position}`, knowledge);
    const recordedLocator = userLocator(`action:${position}`, action);
    if (recordedLocator) {
      fixtures.add('page'); codegenLocators++;
      steps.push({ kind: 'codegen-locator', label: `${action.type} ${action.target}`, code: callFor(action, recordedLocator),
        why: 'USER_CONFIRMED recorded locator — USER AUTHORED — NOT VALIDATED', from: `${action.type} ${action.target}` });
      return;
    }
    const match = userMethod(`action:${position}`) ?? findMethod(action.target, actionKnowledge, index, actionEvidence, 'action')
      ?? findMethodByProvenLocator(actionEvidence, actionKnowledge, index, 'action')
      ?? findParameterisedMethod(actionEvidence, actionKnowledge, index, 'action');
    if (match) {
      fixtures.add(fixtureFor(match.pageObject));
      reused.push({ pageObject: match.pageObject, method: match.method });
      const receiver = receiverFor(match);
      steps.push({
        kind: 'page-object',
        label: `${action.type === 'fill' ? 'Enter the' : action.type === 'click' ? 'Click' : action.type} ${action.target}`,
        code: callFor(action, receiver),
        pageObject: match.pageObject, method: match.method,
        why: `reused ${match.pageObject}.${match.method}() - ${match.why}`,
        from: `${action.type} ${action.target}`,
      });
      return;
    }

    // No Page Object describes it. Codegen's own locator is real evidence - it was
    // used against the running application - so it is emitted rather than guessed
    // at, and counted so the report says how much of the spec is not abstracted.
    if (action.locator) {
      const quality = assessLocator({
        locator: action.locator, target: action.target, kind: 'action', value: action.value, context,
        evidence: evidenceFor(recording.evidence, action.locator) ?? undefined,
      });
      assessments.push({ from: `${action.type} ${action.target}`, assessment: quality });
      if (quality.outcome === 'NEEDS_REVIEW') {
        steps.push({
          kind: 'needs-review', label: `${action.type} ${action.target}`, code: [],
          why: quality.reason, from: `${action.type} ${action.target}`, quality,
        });
        return;
      }
      fixtures.add('page');
      codegenLocators += 1;
      // The resolver's answer, not the recorded chain.
      //
      // This branch used to emit `action.locator` verbatim while the assertion branch
      // below already used `quality.expression`, so a locator the engine had ALREADY
      // rejected went into the spec anyway. That is what quarantined TC_LOGIN_041,
      // 042 and 043: the engine recognised `#tc_summary_638717` as one issue's id and
      // produced `page.getByText('Line Chart | Time Config Page')` from the recorded
      // chain, and the generator then emitted the id regardless. The two recordings
      // prove the point between them - the same control was `#tc_summary_638717` in
      // one session and `#tc_summary_639978` in the next.
      //
      // `expression` is null only for NEEDS_REVIEW, which returned above; the
      // `startsWith` guard is a belt-and-braces check that what we are about to emit
      // is a Playwright chain and not something unbuildable.
      const resolved = quality.expression && quality.expression.startsWith('page.')
        ? quality.expression
        : action.locator;
      steps.push({
        kind: 'codegen-locator',
        label: `${action.type} ${action.target}`,
        code: callFor(action, resolved),
        why: `no Page Object method describes "${action.target}": ${quality.reason}`,
        from: `${action.type} ${action.target}`,
        quality,
      });
      return;
    }

    steps.push({
      kind: 'unresolved', label: `${action.type} ${action.target}`, code: [],
      why: `"${action.target}" could not be mapped and the recording carries no locator for it`,
      from: `${action.type} ${action.target}`,
    });
  };

  /**
   * Where each assertion goes, in `steps` indices.
   *
   * `boundary[n]` is how many steps had been emitted once the first n recorded
   * actions were mapped, so an assertion recorded after n actions belongs at
   * `boundary[n]`. One action can map to zero steps (the sign-in span) or two (the
   * post-login `open()`), which is exactly why this is measured rather than assumed
   * to be n.
   */
  const boundary: number[] = [0];
  const authoredMethods=manualMethods();
  recording.actions.forEach((action, position) => {
    const first = steps.length;
    const key = `action:${position}`, binding = userSelection(key);
    // BEFORE automatic inference, not after it. Reaching the evidence gate at all is what
    // produced a refusal that named the wrong cause.
    const incomplete = action.type === 'navigate' ? null : incompleteBinding(key);
    if (incomplete)
      steps.push({ kind: 'needs-review', subject: 'authoring', failure: 'userBindingIncomplete',
        label: `${action.type} ${action.target}`, code: [], from: `${action.type} ${action.target}`,
        why: incomplete.why });
    else
      emitAction(action, position);
    const runnable = executableBinding(binding);
    for (const step of steps.slice(first)) step.diagnostic = {
      recordingStepKey:key,label:step.label,page:binding?.page ?? undefined,
      pageObject:step.pageObject ?? binding?.pageObject ?? undefined,method:step.method,locator:binding?.locatorOverride ?? action.locator ?? undefined,
      provenance:runnable ? 'USER_CONFIRMED' : binding?.pageObject ? 'USER_BINDING_INCOMPLETE' : 'AUTO',
      executionMode:runnable || binding?.executionMode || 'AUTO',
      validationStatus:binding?.executionMode==='RECORDED_LOCATOR'?'USER AUTHORED — NOT VALIDATED'
        : authoredMethods.find(item=>item.owner===step.pageObject&&item.method===step.method)?.status,
    };
    boundary.push(steps.length);
  });

  /**
   * Assertions go back where they were recorded.
   *
   * An assertion with no `afterActions` comes from a Recording built before the
   * position existed; it is appended last, which is what this module has always
   * done. Nothing is guessed: an absent position is treated as absent, not as a
   * position to infer from the assertion's target.
   */
  let orderReconstructed = true;
  const placements: Array<{ at: number; steps: MappedStep[] }> = [];
  const pending: MappedStep[] = [];
  const emitAssertion = (assertion: RecordedAssertion, out: MappedStep[]): void => {
    if (assertion.type === 'url' && !replayableNavigation(assertion.value ?? '')) {
      out.push({ kind: 'needs-review', subject: 'navigation', failure: 'navigationCausality',
        label: 'URL assertion needs review', code: [], from: 'assert URL',
        why: 'the URL assertion may carry authentication/session state and cannot be emitted safely' });
      return;
    }

    /**
     * The evidence row this assertion's SUBJECT was captured as, when the recording
     * proved which one that is.
     *
     * Projected, not the row itself: everything true of the element transfers and
     * everything true of Codegen's expression does not. See
     * `evidenceForAssertionSubject`.
     */
    const subject = evidenceForAssertionSubject(recording.evidence, assertion);
    /** The row recorded under this very locator, when there is one. The strongest key. */
    const ownRow = evidenceFor(recording.evidence, assertion.locator ?? '');
    /**
     * For REUSE. The existing two keys first - the assertion's own row, then a row that
     * measured this locator as a candidate - and provenance last, because the first two
     * describe the assertion's own expression while provenance describes the element it
     * is about.
     */
    const assertionEvidence = ownRow
      ?? evidenceForResolved(recording.evidence, assertion.locator ?? '')
      ?? subject?.evidence
      ?? null;
    const hasAssertionProof = Boolean(assertionEvidence && (
      effectiveLocator(assertionEvidence, 'assertion').proven
      || (assertionEvidence.positionProvenCandidates ?? []).some(isPositionProven)));

    /**
     * For JUDGEMENT. Narrower on purpose: the locator engine reads `matchCount` and
     * `identifier` as statements about the string it was handed, so it may only be
     * given a row that IS about that string - the assertion's own recorded row, or the
     * projection, which restates both from measurements of the assertion's own locator.
     * `evidenceForResolved` deliberately does not appear: it stays a reuse key, exactly
     * as it was, because its row's counts belong to Codegen's chain.
     */
    const judged = ownRow ?? subject?.evidence ?? undefined;
    const assertionKnowledge = guidedKnowledge(recording, `assertion:${recording.assertions.indexOf(assertion)}`, knowledge);
    const match = userMethod(`assertion:${recording.assertions.indexOf(assertion)}`) ?? (hasAssertionProof ? findMethod(assertion.target, assertionKnowledge, index, assertionEvidence, 'assertion')
      ?? findMethodByProvenLocator(assertionEvidence, assertionKnowledge, index, 'assertion')
      ?? findParameterisedMethod(assertionEvidence, assertionKnowledge, index, 'assertion') : null);
    const needsPage = assertion.type === 'url' || assertion.type === 'title';
    if (needsPage)
      fixtures.add('page');

    if (match && !needsPage) {
      fixtures.add(fixtureFor(match.pageObject));
      reused.push({ pageObject: match.pageObject, method: match.method });
      out.push({
        kind: 'page-object',
        label: assertionPhrase(assertion),
        // Same three arguments the locator branch below passes. This used to hand
        // MATCHER the assertion's VALUE where the assertion itself belongs and omit
        // `positive` entirely, so every Page Object assertion came out negated and
        // empty - `.not.toContainText('')`. It was invisible because no assertion had
        // ever matched a Page Object method: every one of them fell through to the
        // locator branch, which was always correct.
        code: [MATCHER[assertion.type](receiverFor(match), assertion, assertion.expected !== false)],
        pageObject: match.pageObject, method: match.method,
        why: `asserted through ${match.pageObject}.${match.method}() - ${match.why}`,
        from: `assert ${assertion.type} ${assertion.target}`,
      });
      return;
    }

    if (assertion.locator || needsPage) {
      // A page-level assertion (url, title) has no locator to judge.
      const quality = needsPage ? null : assessLocator({
        locator: assertion.locator, target: assertion.target, kind: 'assertion',
        value: assertion.value, context,
        // `judged`, not a second lookup. This line used to call `evidenceFor` again,
        // so the fallback the reuse resolvers had already been given never reached the
        // locator engine at all - the association existed and the one decision that
        // needed it could not see it.
        evidence: judged,
      });
      if (quality && !hasAssertionProof && quality.outcome !== 'NEEDS_REVIEW') {
        quality.outcome = 'NEEDS_REVIEW';
        quality.expression = null;
        quality.reason = 'assertion target has no admissible interaction-time identity evidence';
      }
      if (quality)
        assessments.push({ from: `assert ${assertion.type} ${assertion.target}`, assessment: quality });
      // WHERE THE EVIDENCE CAME FROM, said out loud wherever a reason is written.
      //
      // An assertion judged against a row it does not share a locator with is exactly
      // the kind of thing that must not happen invisibly: the whole reason this works
      // is an identity check nobody reading the spec can see. So the log names it.
      const association = judged && judged === subject?.evidence && subject
        ? ` The evidence for this element was found by provenance, not by its locator: `
          + `${subject.why}, matched by the identity of the node the browser registered `
          + 'when it was pressed.'
        : '';
      if (quality?.outcome === 'NEEDS_REVIEW') {
        out.push({
          kind: 'needs-review', label: assertionPhrase(assertion), code: [],
          why: quality.reason + association,
          from: `assert ${assertion.type} ${assertion.target}`, quality,
        });
        return;
      }
      if (!needsPage) {
        fixtures.add('page');
        codegenLocators += 1;
      }
      out.push({
        kind: needsPage ? 'page-object' : 'codegen-locator',
        label: assertionPhrase(assertion),
        // The resolver's expression when it found a better one, the recorded chain
        // otherwise. `expression` is null only for NEEDS_REVIEW, handled above.
        code: [MATCHER[assertion.type](quality?.expression ?? assertion.locator ?? 'page',
            assertion, assertion.expected !== false)],
        why: needsPage
          ? 'a page-level assertion, which takes no Page Object'
          : `no Page Object method describes "${assertion.target}": ${quality?.reason ?? ''}${association}`,
        from: `assert ${assertion.type} ${assertion.target}`,
        ...(quality ? { quality } : {}),
      });
      return;
    }

    out.push({
      kind: 'unresolved', label: assertionPhrase(assertion), code: [],
      why: `"${assertion.target}" could not be mapped and no locator was recorded for it`,
      from: `assert ${assertion.type} ${assertion.target}`,
    });
  };

  for (const [assertionIndex, assertion] of recording.assertions.entries()) {
    if (assertion.afterActions === undefined) {
      orderReconstructed = false;
      const first = pending.length;
      emitAssertion(assertion, pending);
      for (const step of pending.slice(first)) step.diagnostic = {recordingStepKey:`assertion:${assertionIndex}`,label:step.label,pageObject:step.pageObject,method:step.method,locator:assertion.locator ?? undefined};
      continue;
    }
    const at = boundary[Math.min(assertion.afterActions, recording.actions.length)] ?? steps.length;
    const built: MappedStep[] = [];
    emitAssertion(assertion, built);
    for (const step of built) step.diagnostic = {recordingStepKey:`assertion:${assertionIndex}`,label:step.label,pageObject:step.pageObject,method:step.method,locator:assertion.locator ?? undefined};
    placements.push({ at, steps: built });
  }

  // Rebuilt in one pass rather than spliced: each assertion is emitted before the
  // step that followed it in the recording, several at the same spot stay in the
  // order they were made, and an index cannot shift under a later insertion.
  const ordered: MappedStep[] = [];
  for (let position = 0; position <= steps.length; position++) {
    for (const placement of placements) {
      if (placement.at === position)
        ordered.push(...placement.steps);
    }
    if (position < steps.length)
      ordered.push(steps[position]);
  }
  ordered.push(...pending);

  return {
    steps: ordered,
    fixtures,
    reused,
    unresolved: ordered.filter(step => step.kind === 'unresolved'),
    needsReview: ordered.filter(step => step.kind === 'needs-review'),
    evidence: recording.evidence,
    assessments,
    codegenLocators,
    authenticated,
    orderReconstructed,
  };
}

/* ---------------------------------------------------------------- assembly */

/** Fixture order the existing specs use, so a generated file reads like a written one. */
// Ordering only, so a generated destructure reads consistently. `page` first and `step`
// last are framework; the Page Object names between them are Bugasura's and are simply
// absent for any other application, which leaves its own fixtures in discovery order.
// A credentials fixture sorts just before `step` whatever it is called - matched by SHAPE
// rather than by name, because the name belongs to the application.
const FIXTURE_ORDER = ['page', 'loginPage', 'projectsPage', 'workspacePage', 'step'];

function fixtureRank(name: string): number {
  if (/[Cc]redentials$/.test(name))
    return FIXTURE_ORDER.length - 1.5;
  const at = FIXTURE_ORDER.indexOf(name);
  return at === -1 ? FIXTURE_ORDER.length - 0.5 : at;
}

function orderedFixtures(fixtures: Set<string>): string[] {
  // Ranked rather than partitioned, so a credentials fixture lands in the same slot
  // whatever the application calls it.
  const ordered = [...fixtures].sort((a, b) => fixtureRank(a) - fixtureRank(b) || a.localeCompare(b));
  const known = ordered.filter(name => fixtureRank(name) < FIXTURE_ORDER.length - 0.5);
  const rest = ordered.filter(name => fixtureRank(name) >= FIXTURE_ORDER.length - 0.5);
  return [...known, ...rest];
}

export interface AssembledSpec {
  source: string;
  mapping: MappingResult;
}

/**
 * The spec, written from the mapping.
 *
 * Deliberately the same shape a person writes here: `../fixtures` imports, a
 * `test.describe` per module, the mandatory `trace({...})`, `step(...)` around the
 * actions somebody would recognise, and web-first assertions. It has to be - the
 * quality gate checks the title and the trace call, the mutator has to recognise the
 * assertions, and a spec that looked different would be a second dialect nobody
 * asked for.
 */
/**
 * The module specifier a generated spec imports its fixtures from.
 *
 * DERIVED FROM THE TWO REAL PATHS, never spelled `../fixtures`, for exactly the reason
 * `registerFixture` in `abstraction/writer.ts` derives its Page Object imports: the
 * generated directory and the fixtures module move INDEPENDENTLY under a scoped layout.
 * Bugasura owns the flat pair (`tests-e2e/generated/x.spec.ts` -> `tests-e2e/fixtures.ts`,
 * which really is `../fixtures`); a scoped application has
 * `tests-e2e/generated/<app>/x.spec.ts` -> `tests-e2e/<app>.fixtures.ts`, which is
 * `../../<app>.fixtures`. The hardcoded string was right for one application and
 * resolves to the WRONG application's fixtures module for the next one - and Playwright
 * answers that with `Test has unknown parameter`, refusing the whole file, which
 * `ai/CLAUDE.md` already records as how ten specs were lost once.
 *
 * `path.relative` between the two is the only expression correct in both layouts.
 * POSIX separators because this is a module specifier, not a filesystem path.
 */
function fixturesSpecifier(): string {
  // Resolved through the scope layer directly rather than through `work.ts` /
  // `abstraction/writer.ts`, which export the same two paths: this module is loaded by
  // roughly a dozen offline fixtures, and importing either of those would pull the
  // survey and the Page Object writer into gates that are meant to touch nothing.
  const from = activeScopePath('generatedDir', path.resolve(ROOT, 'tests-e2e', 'generated'));
  const to = activeScopePath('fixturesFile', path.resolve(ROOT, 'tests-e2e', 'fixtures.ts'));
  const specifier = path.relative(from, to)
      .split(path.sep).join('/')
      .replace(/\.ts$/, '');
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

export function assembleSpec(testCase: TestCase, mapping: MappingResult, workbook: string): string {
  const fixtures = orderedFixtures(mapping.fixtures);
  const lines: string[] = [];

  lines.push('/**');
  lines.push(` * Assembled from a Playwright Codegen recording of ${testCase.testCaseId}.`);
  lines.push(' *');
  lines.push(' * Recorded actions use explicit user bindings or automatically resolved controls.');
  lines.push(' * Assembly opened no browser and used no model; it does not prove runtime validity.');
  if (mapping.authenticated) {
    lines.push(' *');
    lines.push(' * Authentication uses the application credential fixture; recorded credential');
    lines.push(' * values are not emitted into this spec.');
  }
  if (mapping.codegenLocators) {
    lines.push(' *');
    lines.push(` * ${mapping.codegenLocators} step(s) use recorded locators directly. Explicitly authored`);
    lines.push(' * locator choices are not automatic target-identity validation.');
  }
  lines.push(' */');
  lines.push('');

  const imports = ['expect', 'test', 'trace'];
  const credentialsFixture = credentialsFixtureName();
  if (credentialsFixture && mapping.fixtures.has(credentialsFixture))
    imports.splice(1, 0, 'requireCredentials');
  lines.push(`import { ${imports.join(', ')} } from '${fixturesSpecifier()}';`);
  lines.push('');

  const describe = testCase.module.trim() || testCase.source.worksheet.trim() || 'Recorded';

  // THE TITLE, DERIVED WHEN THE AUTHORED ONE NAMES A SELECTOR.
  //
  // `testCase.scenario` is the workbook's Scenario cell, and for a recorded case that
  // cell was written by `scenarioFrom`, which builds it from the last click's `target`
  // - which for an element with no accessible name IS Codegen's CSS selector. So
  // TC_LOGIN_112 was titled `#tr_1749558 > .tabulator-cellÃ¢â‚¬Â¦ - 1749558 is ticked`: a
  // class chain, a child combinator and a generated issue id, every part of which
  // changes when the application is redeployed or the data is recreated.
  //
  // THE AUTHORED CELL IS NEVER REWRITTEN - authored columns are not ours to touch, and
  // that invariant is older and more important than this title. The derivation happens
  // HERE, at assembly, from the mapping's own semantic vocabulary, and only when the
  // authored title fails `unstableTitleReason`. A hand-written title always wins.
  const authoredProblem = unstableTitleReason(testCase.scenario);
  const derived = authoredProblem
    ? deriveScenarioTitle(mapping)
    : null;
  const scenario = derived?.title ?? testCase.scenario;
  if (derived) {
    // BEFORE the header's closing `*/`, found by searching rather than counted back
    // from the end: by this point the import block has already been pushed, so
    // `lines.length - 2` addressed the import line and put three comment lines
    // *outside* the comment - which Playwright reported as a syntax error and 0 tests
    // collected, from a file that had merely been annotated.
    const closeAt = lines.indexOf(' */');
    if (closeAt > 0) {
      lines.splice(closeAt, 0,
          ' *',
          ` * The title is DERIVED, not authored: the workbook's Scenario cell says`,
          ` * ${authoredProblem}, so it cannot name this test stably. This title comes from the`,
          ` * semantic journey instead (${derived.why}). The cell itself is unchanged.`);
    }
  }

  lines.push(`test.describe(${literal(describe)}, () => {`);
  // `literal()` on both halves, where the title used to escape only the single quote:
  // a scenario carrying a backslash produced a valid trace line and an invalid title.
  lines.push(`  test(${literal(`${testCase.testCaseId} - ${scenario}`)}, async ({ ${fixtures.join(', ')} }) => {`);
  if (credentialsFixture && mapping.fixtures.has(credentialsFixture))
    lines.push(`    requireCredentials(${credentialsFixture});`);
  lines.push('');
  lines.push('    await trace({');
  lines.push(`      testCaseId: ${literal(testCase.testCaseId)},`);
  lines.push(`      module: ${literal(testCase.module)},`);
  // The SAME string as the test title. They are two renderings of one fact, and a spec
  // whose trace disagreed with its own title would report one scenario and run another.
  lines.push(`      scenario: ${literal(scenario)},`);
  lines.push(`      sourceWorkbook: ${literal(path.basename(workbook))},`);
  lines.push(`      sourceWorksheet: ${literal(testCase.source.worksheet)},`);
  if (testCase.priority)
    lines.push(`      priority: ${literal(testCase.priority)},`);
  lines.push('    });');

  for (const step of mapping.steps) {
    if (!step.code.length)
      continue;
    lines.push('');
    if (step.diagnostic) lines.push(`    // @aura-step ${JSON.stringify(diagnosticData(step.diagnostic)).replace(/[\u2028\u2029]/g,' ')}`);
    if (step.code.length === 1) {
      lines.push(`    await step(${literal(step.label)}, async () => {`);
      lines.push(`      ${step.code[0]}`);
      lines.push('    });');
    } else {
      lines.push(`    await step(${literal(step.label)}, async () => {`);
      for (const line of step.code)
        lines.push(`      ${line}`);
      lines.push('    });');
    }
  }

  lines.push('  });');
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ the path */

export interface RecordedGeneration {
  /** True when a spec was assembled and written. */
  assembled: boolean;
  specFile?: string;
  reason: string;
  /** Why not, when `assembled` is false. Decides what the caller does next. */
  block?: RecordedBlock;
  mapping?: MappingResult;
  metrics: {
    recorded: true;
    codegenActions: number;
    codegenAssertions: number;
    reusedPageObjectMethods: number;
    newPageObjectMethods: number;
    unresolvedActions: number;
    codegenLocatorSteps: number;
    aiFallbackCalls: number;
    /** Not measurable without a model call, and there is none. */
    aiFallbackTokens: null;
    browserOpened: 0;
    browserCommands: 0;
    /** Elements the recording used that no Page Object describes. Not reuse. */
    pageObjectRequired: PageObjectRequirement[];
    /** What the locator-quality engine decided, per outcome. Deterministic, no AI. */
    locators: LocatorMetrics;
    /** False when assertions had to be appended last for want of positions. */
    orderReconstructed: boolean;
    mappingTimeMs: number;
    assemblyTimeMs: number;
  };
}

function emptyMetrics(): RecordedGeneration['metrics'] {
  return {
    recorded: true, codegenActions: 0, codegenAssertions: 0, reusedPageObjectMethods: 0,
    newPageObjectMethods: 0, unresolvedActions: 0, codegenLocatorSteps: 0, aiFallbackCalls: 0,
    aiFallbackTokens: null, browserOpened: 0, browserCommands: 0,
    pageObjectRequired: [], locators: emptyLocatorMetrics(), orderReconstructed: true,
    mappingTimeMs: 0, assemblyTimeMs: 0,
  };
}

/**
 * Load the evidence sidecar written when this case was recorded.
 *
 * Every failure is the same answer - `evidenceUnavailable` with the reason - because
 * evidence is an optimisation and generation predates it. A missing file is the
 * normal case (every recording made before this existed, and every recording made on
 * the codegen transport). A malformed one is a file somebody or something truncated,
 * and trusting half a graph is worse than trusting none: `isDomEvidence` is a
 * structural check, not a parse, so a shape that is not evidence cannot reach the
 * resolver dressed as evidence.
 */
export function readEvidence(
  testCaseId: string,
  options: { archived?: boolean } = {},
): RecordingEvidence {
  // EXPLICIT, NEVER A FALLBACK. Reading the archive by default would make an accepted
  // recording look live to `surveyWork`, and a routine run would then regenerate every
  // spec that has already been accepted.
  const file = options.archived ? archivedPath(testCaseId, '.evidence.json') : evidencePath(testCaseId);
  if (!fs.existsSync(file))
    return evidenceUnavailable('no evidence sidecar was written for this recording');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return evidenceUnavailable(`the evidence sidecar could not be read: ${String(error).slice(0, 120)}`);
  }
  if (!isDomEvidence(parsed))
    return evidenceUnavailable('the evidence sidecar is not a DOM evidence document');
  return parsed;
}

/** Every assertion type the recorder can write. A file naming another is not ours. */
const ASSERTION_TYPES: ReadonlySet<string> = new Set([
  'visible', 'hidden', 'text', 'contains', 'value', 'checked', 'url', 'count',
  'title', 'empty', 'enabled', 'attribute', 'class', 'values',
]);

/**
 * The state assertions a person recorded through the picker, read back.
 *
 * `undefined` means "this recording has none", which is the answer for every
 * recording made before P1.2c and for every one where nobody used the picker.
 * That is the whole of the backward compatibility story: `parseRecording` treats
 * it as an empty list and behaves exactly as it did.
 *
 * A file that cannot be read or does not hold assertions is treated the same way
 * rather than thrown over - the same rule the evidence sidecar follows, because a
 * generation must not fail over an optional file. Polarity is the one thing that
 * must survive intact: `expected` is copied as the boolean it is and never
 * defaulted, since absent means TRUE to `parseRecording` and turning a recorded
 * `false` into an absent field would invert the person's assertion.
 */
export function readAssertions(
  testCaseId: string,
  options: { archived?: boolean } = {},
): RecordedAssertion[] | undefined {
  const file = options.archived ? archivedPath(testCaseId, '.assertions.json') : assertionsPath(testCaseId);
  if (!fs.existsSync(file))
    return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed))
    return undefined;
  const assertions = parsed.filter((entry): entry is RecordedAssertion =>
    Boolean(entry) && typeof entry === 'object'
    && typeof (entry as RecordedAssertion).type === 'string'
    && ASSERTION_TYPES.has((entry as RecordedAssertion).type)
    && typeof (entry as RecordedAssertion).locator === 'string')
      // PROVENANCE IS VALIDATED, NEVER TRUSTED, AND NEVER REPAIRED.
      //
      // It decides which evidence row an assertion is judged against, so a malformed
      // one - a string where a count belongs, an empty ref list, more names than the
      // page could possibly have produced - must reach the association as ABSENT
      // rather than as something to interpret. Stripped by destructuring rather than
      // overwritten, because a spread would copy the bad field through. Every other
      // field survives untouched, `expected` above all: absent means TRUE downstream,
      // so rebuilding the object without it would invert the person's assertion.
      .map(entry => {
        const { subjectProvenance, ...rest } = entry;
        const valid = readAssertionProvenance(subjectProvenance);
        return (valid ? { ...rest, subjectProvenance: valid } : rest) as RecordedAssertion;
      });
  return assertions.length ? assertions : undefined;
}

/**
 * Why a recording could not become a spec. Telemetry, never a workbook status.
 *
 * `noAssertion` is deliberately not a failure of generation: a recording with
 * nothing asserted is a row whose Expected Result nobody has confirmed yet, and the
 * only correct response is to stop and say so. Sending it to a model asks the model
 * to invent the acceptance criteria, which is the one thing this toolkit exists to
 * prevent - and the model declined twice when it was asked (TC_LOGIN_028).
 */
export type RecordedBlock = 'noArtifact' | 'noAssertion' | 'unmappedAction' | 'needsReview'
  | 'navigationCausality' | 'authenticationCapability'
  /** Authoring was started for a step and never resolved to something that can run. */
  | 'userBindingIncomplete';

/**
 * Try to build this recorded case's spec without a model or a browser.
 *
 * Returns `assembled: false` with a reason and a `block` whenever it cannot. The
 * caller reports the typed block and retains the recording and evidence. A framework
 * mapping failure is never automatically delegated to a general AI generator.
 *
 * The artifact is NOT discarded here. It is the primary evidence and the verdict is
 * not known yet: it used to be deleted the moment a spec was written, so a spec the
 * gate then refused took the recording with it and the retry - having nothing to
 * assemble from - silently became an AI generation.
 */
export function generateFromRecording(
  testCase: TestCase,
  specFile: string,
  workbook: string,
): RecordedGeneration {
  const source = readArtifact(testCase.testCaseId);
  if (!source) {
    return { assembled: false, block: 'noArtifact', metrics: emptyMetrics(),
      reason: 'no Codegen artifact was kept for this case' };
  }

  const mapStarted = Date.now();
  const recording = parseRecording(source, {
    startUrl: '', browser: '', durationMs: 0, evidence: readEvidence(testCase.testCaseId),
    // The picker's assertions live beside the script rather than in it: Codegen
    // never saw them. Without this the reloaded recording asserts nothing, however
    // much the person recorded (P1.2c).
    stateAssertions: readAssertions(testCase.testCaseId),
  });
  // The artifact has no URL context of its own; the first navigate carries it.
  recording.startUrl = recording.actions.find(action => action.type === 'navigate')?.value ?? '';
  recording.authoringOwners = loadOwners(activeScope(), path.join(activeScope().paths.recordingsDir, `${testCase.testCaseId}.spec.ts`), source);
  const mapping = mapRecording(recording);
  const mappingTimeMs = Date.now() - mapStarted;

  const metrics = {
    ...emptyMetrics(),
    codegenActions: recording.actions.length,
    codegenAssertions: recording.assertions.length,
    reusedPageObjectMethods: new Set(mapping.reused.map(entry => `${entry.pageObject}.${entry.method}`)).size,
    unresolvedActions: mapping.unresolved.length,
    codegenLocatorSteps: mapping.codegenLocators,
    pageObjectRequired: pageObjectRequirements(mapping),
    locators: locatorMetrics(mapping),
    orderReconstructed: mapping.orderReconstructed,
    mappingTimeMs,
  };

  // A locator the quality engine refused cannot produce a test that means anything:
  // a generated id resolves to nothing on the next run, and an absolute XPath
  // resolves to whatever moved into that position. Assembling it would spend a full
  // gate run - two Playwright executions - to discover what is already known here.
  const frameworkBlock = mapping.steps.find(step => step.failure)?.failure;
  if (frameworkBlock) {
    return { assembled: false, block: frameworkBlock, mapping, metrics,
      reason: mapping.steps.filter(step => step.failure).map(step => step.why).join('; ') };
  }
  if (mapping.needsReview.length) {
    return {
      assembled: false, block: 'needsReview', mapping, metrics,
      reason: `${mapping.needsReview.length} recorded locator(s) need a person: `
        + mapping.needsReview.map(step => `${step.from} - ${step.why}`).join(' | '),
    };
  }

  if (mapping.unresolved.length) {
    return {
      assembled: false, block: 'unmappedAction', mapping, metrics,
      reason: `${mapping.unresolved.length} recorded action(s) could not be mapped: `
        + mapping.unresolved.map(step => step.why).join('; '),
    };
  }

  // The gate needs something to break. A recording with no assertion has nothing to
  // assert, and inventing one is the thing this whole toolkit refuses to do.
  const assertions = mapping.steps.filter(step => step.code.some(line => line.includes('expect(')));
  if (!assertions.length) {
    return {
      assembled: false, block: 'noAssertion', mapping, metrics,
      reason: 'the recording contains no assertion, so there is nothing for a spec to prove',
    };
  }

  const assemblyStarted = Date.now();
  const source_ = assembleSpec(testCase, mapping, workbook);
  const absolute = path.resolve(ROOT, specFile);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, source_, 'utf8');
  metrics.assemblyTimeMs = Date.now() - assemblyStarted;

  // The artifact stays until the gate has spoken - `acceptRecording()` is what
  // finally discards it. See the note on this function.

  return {
    assembled: true, specFile, mapping, metrics,
    reason: `assembled from ${recording.actions.length} recorded action(s) and `
      + `${recording.assertions.length} assertion(s) ${mapping.orderReconstructed
        ? 'in the recorded order' : 'with assertions appended last (no recorded positions)'}, `
      + `reusing ${metrics.reusedPageObjectMethods} Page Object method(s)`
      + (metrics.pageObjectRequired.length
        ? `; ${metrics.pageObjectRequired.length} element(s) need a Page Object method` : ''),
  };
}

/**
 * The gate accepted the spec. The recording is ARCHIVED, not destroyed.
 *
 * It used to be deleted here, on the reasoning that a recording had served its
 * purpose once a spec existed. It has not: the spec is a claim, and the evidence is
 * why the claim is believed. Twenty-seven accepted tests now carry locators that
 * cannot be repaired or even explained, because their evidence was deleted at the
 * moment they passed - and a strict-mode audit is precisely the question one asks of
 * an old test.
 *
 * Called only on `accepted`. Every other verdict leaves the artefact in the queue,
 * because that is when somebody needs to look at what was actually recorded.
 */
export function acceptRecording(testCaseId: string): void {
  archiveArtifact(testCaseId);
}

/** One line per mapped step, for the run log. */
export function describeMapping(result: RecordedGeneration): string {
  if (!result.mapping)
    return `  recorded pipeline: ${result.reason}\n`;
  const lines = [`  recorded pipeline: ${result.reason}`];
  for (const step of result.mapping.steps) {
    const mark = step.kind === 'needs-review' ? 'NEEDS REVIEW' : step.kind === 'unresolved' ? 'MISS' : step.kind === 'codegen-locator' ? 'raw ' : 'ok  ';
    lines.push(`      ${mark} ${step.from.padEnd(34)} ${step.why}`);
  }
  // Named, not just counted: "4 raw locators" is a number, and these are the four
  // elements somebody has to write a Page Object method for.
  const required = result.metrics.pageObjectRequired;
  if (required.length) {
    lines.push(`      PAGE OBJECT REQUIRED (${required.length}) - the spec still runs and is still gated:`);
    for (const item of required)
      lines.push(`        ${item.did.padEnd(34)} ${item.locator}`);
  }
  // The locator verdicts, so a weak selector is visible before the gate spends a
  // minute proving it. Only the ones worth reading: a stable locator needs no line.
  for (const { from, assessment } of result.mapping.assessments) {
    if (assessment.classification === 'stable' || assessment.classification === 'reusable')
      continue;
    lines.push(`      ${assessment.classification.toUpperCase().padEnd(10)} ${from.padEnd(30)} ${assessment.reason}`);
  }
  const review = result.mapping.needsReview;
  if (review.length)
    lines.push(`      NEEDS REVIEW (${review.length}) - nothing was assembled, and no gate run was spent.`);
  if (!result.mapping.orderReconstructed) {
    lines.push('      NOTE: this recording carries no assertion positions, so its assertions were '
      + 'appended last. Re-record it to assert where the actions happened.');
  }
  return `${lines.join('\n')}\n`;
}
