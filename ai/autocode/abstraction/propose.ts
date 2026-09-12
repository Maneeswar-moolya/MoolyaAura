/**
 * The abstraction engine's Phase 1: propose, never write.
 *
 *   npx tsx ai/autocode/abstraction/propose.ts          # writes the ledger
 *   npx tsx ai/autocode/abstraction/propose.ts --dry    # prints, writes nothing
 *
 * IT MODIFIES NO PRODUCTION FILE. Not a Page Object, not a knowledge file, not
 * fixtures.ts, not a generated spec. The only thing it writes is
 * `ai/reports/abstraction-proposals.jsonl`, which is a report.
 *
 * IT IS A CONSUMER OF THE EXISTING PIPELINE, NOT A CHANGE TO IT. `mapRecording`
 * already labels every step with what the matcher decided - `page-object` is
 * findMethod FOUND, `codegen-locator` and `needs-review` are findMethod NOT FOUND -
 * so the analyzer reads that output rather than being spliced into the branch. That
 * is why `from-recording.ts`, `locator-quality.ts` and `dom-evidence.ts` are
 * untouched by this phase: existing Page Object reuse cannot regress if nothing in
 * the reuse path changed.
 *
 * There is no model call anywhere in this file or anything it imports.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  evidenceFor, evidenceForAssertionSubject, isDomEvidence, looksLikeSecretValue,
  provenMeasurements,
  type AssertionProvenance, type CandidateMeasurement, type TargetEvidence,
} from '../dom-evidence';
import { analyseIdentifier, isPositionalLocator} from '../locator-quality';
import { parseRecording } from '../../dashboard/recorder';
import { mapRecording, readAssertions, readEvidence } from '../from-recording';
import { acceptedDir, recordingsDir } from '../../dashboard/recorder';
import {
  readAllPageKnowledge, type PageKnowledge,
} from '../../knowledge/page-knowledge';
import { buildIndex } from '../../knowledge/index';
import { canonicalIdentity } from '../../knowledge/canonical';
import { activeScope } from '../../projects/scope';
import {
  classify, effectiveLocator, insideRepeatedContainer, provenCandidate, structuralSignature,
} from './classify';
import {
  parameterisationHolds, parameterNameFor, parameterSourceOf, templateFor, validateCandidate,
} from './validate';
import { templateOf } from './parameter';
import { componentClassNameFor, methodNameForTarget, parameterisedNameFor } from './naming';
import {
  refuse, type Category, type Proposal, type ProposalStatus, type Refusal, type RefusalCode,
  type TargetRole,
} from './types';

const ROOT = process.cwd();
/**
 * THE CORPUS COMES FROM THE RECORDER, both halves of it.
 *
 * This module used to declare a private `path.join(ROOT, 'ai','dashboard','recordings')`
 * two lines above an `import { ACCEPTED_DIR } from '../../dashboard/recorder'` - the
 * live directory spelled here, the archive imported from there. Scoping one and not the
 * other would have made `analyseCorpus` read one application's live recordings beside
 * another application's archive, so both now come from `recordingsDir()` /
 * `acceptedDir()` and there is one convention rather than two.
 */

export const LEDGER = path.join(ROOT, 'ai', 'reports', 'abstraction-proposals.jsonl');
/** Proven evidence about capabilities that already exist. A report, read by nothing. */
export const ALTERNATIVES = path.join(ROOT, 'ai', 'reports', 'abstraction-alternatives.jsonl');

/** Text that must never reach the ledger, whatever it is attached to. */
const redact = (value: string | null | undefined): string | null => {
  const text = (value ?? '').trim();
  if (!text)
    return null;
  if (looksLikeSecretValue(text))
    return '<redacted>';
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** One entry per distinct wording, first occurrence wins. */
const dedupe = (refusals: readonly Refusal[]): Refusal[] => refusals.filter((refusal, index) =>
  refusals.findIndex(other => other.detail === refusal.detail) === index);

/**
 * Which class would own this element, decided from evidence or not at all.
 *
 * Three sources, in descending order of what they prove, and no fourth. There is no
 * "put it on the biggest Page Object" fallback and no name-similarity guess: an
 * unattributable element is NEEDS_REVIEW, which costs a person one decision, while a
 * wrong owner costs every future test that reuses it.
 */
export interface OwnerResolution {
  owner: string | null;
  kind: 'page-object' | 'component' | null;
  why: string;
  /**
   * Why ownership could not be settled, when it could not.
   *
   * `AMBIGUOUS_OWNERSHIP` means knowledge declares SEVERAL owners and the evidence
   * does not choose between them - a semantic question with a closed set of answers.
   * `OWNER_UNKNOWN` means nothing declares one at all, which no judgement can fix
   * because there is nothing to choose from.
   */
  code?: RefusalCode;
  /**
   * The owners a resolver may choose between. Exactly the classes knowledge already
   * declares for this screen - never a superset, never a free choice.
   */
  candidates?: string[];
  /**
   * Present only when the FIFTH rule answered: the screen this owner was derived for.
   *
   * The writer needs it because a bootstrapped owner is one no knowledge file declares
   * yet - it carries the canonical identity the file must be created under, the route
   * it must declare, and the page name, all derived before any file existed.
   */
  bootstrap?: { canonicalId: string; route: string; pageName: string };
}

/**
 * What bootstrap is allowed to know. Three facts, and not one of them is a DOM fact.
 *
 * `applicationId` is the locked active scope. `originApplicationId` is what the
 * recording says it was made against - compared, never trusted as a substitute. `route`
 * is the screen the recording itself established. Nothing here carries text, a locator,
 * a score or a model's opinion, because none of those says which page an element is on.
 */
export interface BootstrapContext {
  applicationId: string;
  /** The recording's own `origin.applicationId`, or null where it predates origins. */
  originApplicationId: string | null;
  /** The route the recording established, or null when it established none. */
  route: string | null;
}

/** What bootstrap derived, or why it refused. */
export type BootstrapResult =
  | { owner: string; canonicalId: string; route: string; pageName: string; why: string }
  | { owner: null; code: RefusalCode; why: string };

/** `/` -> `Home`, `/checkout` -> `Checkout`, `/team/settings` -> `TeamSettings`. */
function pascal(slug: string): string {
  return slug.split('-').filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
}

/**
 * THE FIFTH OWNER RULE, and the only one that can answer with no knowledge at all.
 *
 * It runs after every declared rule has refused, and it derives an owner from exactly
 * two things: the application that is active, and the route the recording established.
 * The identity is `canonicalIdentity`'s, unchanged - one screen, one identity, one file
 * - so a page bootstrapped today is found by the route rule tomorrow.
 *
 * FAIL CLOSED, IN ORDER. Each guard answers a question that must be YES before a name
 * means anything:
 *
 *   - is the recording THIS application's? A foreign origin is refused outright rather
 *     than reinterpreted, and a recording with no origin at all is refused too: it
 *     predates the field, so nothing states which application it belongs to and
 *     attributing it by the directory it sits in is exactly the inference this rule
 *     exists to avoid.
 *   - did the recording state a route? Absence is never a route.
 *   - does that route name a SCREEN rather than a RECORD? `/issues/636432` carries a
 *     generated identifier, so a screen identity built from it would be one screen per
 *     issue. Refused; normalising it to `/issues/:id` would be a guess about which
 *     segment is the parameter.
 *
 * Naming is a framework convention applied to evidence, never a description of content:
 * the route slug in PascalCase plus `Page`, and `Home` for the root route, which is what
 * an application's entry screen is called in every repository this framework will meet.
 * Nothing is derived from a title, the DOM, the text or the locator.
 */
export function bootstrapOwner(context: BootstrapContext): BootstrapResult {
  const application = (context.applicationId ?? '').trim();
  if (!application)
    return { owner: null, code: 'OWNER_UNKNOWN', why: 'no application scope is active' };
  // ONE COMPARISON, TWO REFUSALS. An absent origin and a foreign one are the same
  // failure - the recording does not state that it belongs to the active application -
  // and they were two guards until a mutation showed why that is worse: each masked the
  // other, so neither could be broken on its own and the protection could not be tested.
  // The reason still distinguishes them, because the remedies differ.
  const origin = (context.originApplicationId ?? '').trim();
  if (origin !== application) {
    return { owner: null, code: 'OWNER_UNKNOWN',
      why: origin
        ? `the recording was made against "${origin}" and the active application is `
          + `"${application}". Application artefacts are never resolved across scopes.`
        : 'the recording states no application of its own, so nothing but the directory '
          + 'it sits in attributes it - which is not evidence. Re-record it under this application.' };
  }
  const route = (context.route ?? '').trim();
  if (!route) {
    return { owner: null, code: 'BOOTSTRAP_ROUTE_UNKNOWN',
      why: 'no knowledge declares an owner and the recording established no route, so '
        + 'nothing says which screen this element belongs to' };
  }
  const dynamic = route.split('/').find(segment => segment && analyseIdentifier(segment).dynamic);
  if (dynamic) {
    return { owner: null, code: 'BOOTSTRAP_ROUTE_UNKNOWN',
      why: `the route "${route}" contains "${dynamic}", which looks generated - it names `
        + 'one record rather than one screen, so a page identity built from it would be a '
        + 'page per record' };
  }
  const identity = canonicalIdentity({ route, application });
  const slug = identity.id.slice(application.length + 2);
  const owner = `${slug === 'root' ? 'Home' : pascal(slug)}Page`;
  return {
    owner,
    canonicalId: identity.id,
    route,
    pageName: slug === 'root' ? `${application} entry page` : `${application} ${slug.split('-').join(' ')} page`,
    why: `bootstrapped from ${identity.reason} - no knowledge declares an owner for this screen yet`,
  };
}

/**
 * Rule 4 as one call: the derived owner, or nothing.
 *
 * `null` means "bootstrap did not answer" and the caller falls back to the refusal it
 * would have produced anyway - so a call site that offers no context, and one whose
 * context cannot establish a screen, both behave exactly as they did before this rule
 * existed. The route is the one the DOCUMENT stated at the press and never the one
 * reconstructed from the step stream: see the call site in `analyseCorpus`.
 */
/**
 * The declared answer for one route, or null when knowledge describes no such screen.
 *
 * Rule 3's body, extracted so the SAME lookup can be run against the route the document
 * stated as well as the one reconstructed from the step stream. That mattered as soon as
 * bootstrap existed: a recording whose `goto` the step walker cannot read leaves the
 * reconstructed route at `/`, which rule 3 discards - so a screen that ALREADY has
 * knowledge was being answered by bootstrap, deriving the same owner by a different
 * route. Correct outcome, wrong provenance, and it would have made `Proposal.bootstrap`
 * mean "no declared owner" only sometimes.
 *
 * Ambiguity is returned as ambiguity, exactly as rule 3 returns it, so a second owner
 * cannot be sidestepped by asking with a better route.
 */
function declaredForRoute(knowledge: PageKnowledge[], route: string): OwnerResolution | null {
  const page = knowledge.find(entry => routeMatches(entry.route || '/', route));
  if (!page)
    return null;
  const owners = [...new Set(page.elements
      .map(element => element.page_object)
      .filter((owner): owner is string => Boolean(owner)))];
  if (owners.length === 1)
    return { owner: owners[0], kind: 'page-object', why: `the action happened on ${route} (${page.file})` };
  return {
    owner: null,
    kind: null,
    code: owners.length > 1 ? 'AMBIGUOUS_OWNERSHIP' : 'OWNER_UNKNOWN',
    candidates: owners,
    why: `${page.file} declares ${owners.length} owners for ${route} (${owners.join(', ')}) - `
      + 'the route does not say which owns this element',
  };
}

function bootstrapFrom(bootstrap: BootstrapContext | undefined): OwnerResolution | null {
  if (!bootstrap)
    return null;
  const derived = bootstrapOwner(bootstrap);
  if (!derived.owner)
    return null;
  return {
    owner: derived.owner,
    kind: 'page-object',
    why: derived.why,
    bootstrap: { canonicalId: derived.canonicalId, route: derived.route, pageName: derived.pageName },
  };
}

/**
 * The knowledge entry that declares this capability, and the locator it declares.
 *
 * Both halves are required. An entry naming a method with no declared strategy states no
 * locator, so there is nothing for a later recording to differ FROM - and an observation
 * built on an absent declaration would be an invention.
 */
function declaredCapability(
  knowledge: PageKnowledge[],
  index: ReturnType<typeof buildIndex>,
  owner: string,
  method: string,
): { declared: string; file: string } | null {
  for (const page of knowledge) {
    for (const element of page.elements) {
      if (element.page_object !== owner || element.page_object_method !== method)
        continue;
      const declared = (element.locator_strategy ?? '').trim();
      // A DECLARED STRATEGY THAT IS NOT AN EXPRESSION STATES NO LOCATOR TO DIFFER FROM.
      // Most entries carry free text - "#ap_notifications_panel - an authored id; its
      // classes are state" - and comparing a proven expression against a sentence makes
      // every recording look like new evidence. The same test `templateOf` applies.
      if (!/^page\s*\./.test(declared))
        continue;
      // A PARAMETERISED CAPABILITY DECLARES A TEMPLATE, and a recording of one row proves
      // that template with its argument supplied. `filter({ hasText: description })` and
      // `filter({ hasText: "one row's summary" })` are the same capability being used,
      // not a second locator for it - so there is nothing to review and nothing is
      // recorded. Read through the repository's own template reader rather than by
      // looking for a parameter-shaped word.
      const indexed = index.pages[owner]?.methods.find(entry => entry.name === method);
      if (indexed && templateOf(element, indexed))
        return null;
      return { declared, file: page.file };
    }
  }
  return null;
}

/**
 * A COMPARISON KEY, and only that: quotes normalised, and spacing removed where it can
 * only be formatting. `page.locator('#x')` and `page.locator( "#x" )` are the same
 * locator written twice, and calling the second one new evidence would fill the report
 * with differences nobody made.
 *
 * The stored record keeps BOTH expressions verbatim - this key is never written down.
 */
function flattenExpression(value: string): string {
  return value
      .replace(/["']/g, '"')
      .replace(/\s*([(){}\[\],:])\s*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
}

/**
 * Did this recording prove something OTHER than what knowledge declares for the
 * capability it resolved to? If so, say so; if not, say nothing.
 *
 * REFUSES RATHER THAN GUESSES, in every direction: no established capability, no declared
 * locator, no proven expression, or an expression that is the declared one - all produce
 * nothing. Quoting differences are normalised away, because `page.locator('#x')` and
 * `page.locator("#x")` are the same evidence written twice.
 */
export function alternativeEvidenceFor(input: {
  applicationId: string | null;
  testCaseId: string;
  from: string;
  role: TargetRole;
  owner: string | null | undefined;
  method: string | null | undefined;
  observed: string | null | undefined;
  knowledge: PageKnowledge[];
  index: ReturnType<typeof buildIndex>;
  resolvedBy: 'element-already-wrapped';
}): AlternativeEvidence | null {
  const owner = (input.owner ?? '').trim();
  const method = (input.method ?? '').trim();
  const observed = (input.observed ?? '').trim();
  if (!owner || !method || !observed)
    return null;
  const declared = declaredCapability(input.knowledge, input.index, owner, method);
  if (!declared)
    return null;
  if (flattenExpression(declared.declared) === flattenExpression(observed))
    return null;
  return {
    applicationId: input.applicationId,
    testCaseId: input.testCaseId,
    from: input.from,
    role: input.role,
    owner,
    method,
    declared: declared.declared,
    observed,
    knowledgeFile: declared.file,
    resolvedBy: input.resolvedBy,
  };
}

export function resolveOwner(
  evidence: TargetEvidence,
  knowledge: PageKnowledge[],
  routes: string[],
  /**
   * The empty-knowledge fallback, supplied only by a caller that has an application
   * scope and a recording origin. Omitted - which is every existing caller and every
   * existing fixture - and the four declared rules are the whole of this function,
   * exactly as they were.
   */
  bootstrap?: BootstrapContext,
): OwnerResolution {
  // 1. CONTAINMENT. An ancestor that knowledge already names settles it outright -
  //    the element is inside something whose owner is written down.
  for (const ancestor of [evidence.target, ...(evidence.ancestors ?? [])]) {
    const id = (ancestor.id ?? '').trim();
    if (!id)
      continue;
    for (const page of knowledge) {
      const element = page.elements.find(entry => entry.id === id && entry.page_object);
      if (element?.page_object) {
        return {
          owner: element.page_object,
          kind: element.page_object === 'NotificationsPanel' ? 'component' : 'page-object',
          why: `contained by "${id}", which ${page.file} assigns to ${element.page_object}`,
        };
      }
    }
  }

  // 1b. A CONTAINER A KNOWLEDGE FILE NAMES.
  //
  //     A row target is inside `#bugReport-table`, which no element is KEYED by but
  //     which `bugasura__issues-id.yaml` names outright in `result_rows`'
  //     locator_strategy. That is an authored statement about which screen the
  //     container belongs to, so it settles ownership - and it is what covers the
  //     case a click navigated into, where no recorded `goto` states the route.
  //
  //     Refused when two files name the same container, because then it says nothing.
  for (const ancestor of evidence.ancestors ?? []) {
    const id = (ancestor.id ?? '').trim();
    if (!id || analyseIdentifier(id).dynamic)
      continue;
    const owners = new Set<string>();
    let source = '';
    for (const page of knowledge) {
      for (const element of page.elements) {
        if (!element.page_object || !(element.locator_strategy ?? '').includes(`#${id}`))
          continue;
        owners.add(element.page_object);
        source = page.file;
      }
    }
    if (owners.size === 1) {
      return {
        owner: [...owners][0], kind: 'page-object',
        why: `inside "#${id}", which ${source} names as this screen's own container`,
      };
    }
  }

  // 2. A NEW COMPONENT. A landmark that knowledge does not describe yet still knows
  //    what it is; it just has no class. Named, but proposed - never created here.
  const role = (evidence.target.role ?? '').toLowerCase();
  if (['dialog', 'alertdialog', 'navigation', 'banner', 'complementary', 'region'].includes(role)) {
    const proposed = componentClassNameFor(evidence.target);
    // AN OWNER NOTHING DECLARES IS NOT AN OWNER, and this rule used to return one.
    //
    // `applyProposals` states the contract it relies on outright: "the owner is never
    // invented - resolveOwner returns only what a knowledge file declares for the route".
    // That was true of rules 1, 1b and 3 and false of this one, which derived a class
    // NAME from the element and handed it back as if a repository had declared it. The
    // writer then looked for a knowledge file declaring that class, found none, and
    // refused - so every proposal this branch produced for an undeclared component was a
    // dead end: PROPOSED, validated, and unwritable by construction. `#create_team_invite_modal`
    // is the case, and being all-or-nothing the writer took two sound proposals down
    // with it.
    //
    // So the name is returned only when knowledge already declares that class - which is
    // exactly what `NotificationsPanel` is - and otherwise this refuses, HERE, with what
    // a person would have to declare to change the answer. Nothing is weakened: the
    // branch now refuses strictly more, and refuses it before a batch can be spent.
    const declared = proposed
      && knowledge.some(page => page.elements.some(element => element.page_object === proposed));
    if (proposed && declared)
      return { owner: proposed, kind: 'component', why: `role "${role}", declared as a component in knowledge` };
    return {
      owner: null, kind: null, code: 'OWNER_UNKNOWN', candidates: [],
      why: proposed
        ? `role "${role}" suggests the component ${proposed}, which no knowledge file declares - `
          + `declare ${proposed} (a page_object on one element) before a method can be written for it`
        : `role "${role}" but no name to derive a component from`,
    };
  }

  // 3. THE ROUTE THE ACTION HAPPENED ON.
  //
  //    `routes` is the route in effect at THIS step, not every route the recording
  //    visited - a recording that signs in, opens /apps and then an issue touches
  //    three screens, and asking which of them a target belonged to has one correct
  //    answer that the recorded navigation order states outright. Reading the last
  //    route of the whole recording instead would attribute every earlier target to
  //    the final screen, which is the guess this rule exists to avoid.
  //
  //    Still refused when the route is unknown, or when knowledge has no file for
  //    it: an owner nothing declares is not an owner.
  const specific = [...new Set(routes.filter(route => route && route !== '/'))];
  if (specific.length === 1) {
    const declared = declaredForRoute(knowledge, specific[0]);
    if (declared)
      return declared;
    {
      // NOTHING DECLARES THIS ROUTE AT ALL, which is the empty-knowledge case rule 4 is
      // for - so it is offered the route the step stream established rather than being
      // refused before it can answer. Note what this does NOT reach: the two refusals
      // below, where knowledge DOES describe the route and either names two owners or
      // names none. Those are declared answers, and bootstrap never overrides one.
      // NOTHING DECLARES THIS ROUTE. Ask knowledge once more with the route the DOCUMENT
      // stated, which the step walker may not have been able to reconstruct, and only
      // then bootstrap. See `declaredForRoute`.
      const alsoDeclared = bootstrap?.route ? declaredForRoute(knowledge, bootstrap.route) : null;
      if (alsoDeclared)
        return alsoDeclared;
      const derived = bootstrapFrom(bootstrap);
      if (derived)
        return derived;
      return { owner: null, kind: null, code: 'OWNER_UNKNOWN', candidates: [],
        why: `no knowledge file declares route ${specific[0]}` };
    }
  }

  // 4. NOTHING DECLARED IS LEFT. Bootstrap, if the caller offered a context.
  //
  //    LAST, AND ONLY HERE. Every return above is a declared answer or a declared
  //    ambiguity, and neither may be overridden: an application that already knows who
  //    owns a screen is never told by a route, and two owners for one route stay two
  //    owners. Reaching this line means the repository declares nothing at all about
  //    this screen, which is the only situation bootstrap is for.
  if (bootstrap && specific.length <= 1) {
    // THE DECLARED ANSWER FIRST, ALWAYS. The step walker could not offer a route here;
    // the document did. A screen that already has knowledge is answered by that
    // knowledge whichever route reached it.
    const alsoDeclared = bootstrap.route ? declaredForRoute(knowledge, bootstrap.route) : null;
    if (alsoDeclared)
      return alsoDeclared;
    const derived = bootstrapFrom(bootstrap);
    if (derived)
      return derived;
    const refusal = bootstrapOwner(bootstrap);
    if (refusal.owner === null)
      return { owner: null, kind: null, code: refusal.code, candidates: [], why: refusal.why };
  }

  return {
    owner: null,
    kind: null,
    code: 'OWNER_UNKNOWN',
    candidates: [],
    why: specific.length > 1
      ? `the route at this step is ambiguous (${specific.join(', ')})`
      : 'no route or container identifies an owner',
  };
}

/**
 * Does a concrete path match a declared route?
 *
 * Knowledge declares `/issues/:id` because the numeric segment is the PROJECT, not
 * the screen - keying on a concrete id would make a new screen of every project. So
 * the comparison is segment-wise with `:param` matching one segment.
 */
export function routeMatches(declared: string, actual: string): boolean {
  const left = declared.split('?')[0].replace(/\/$/, '').split('/');
  const right = actual.replace(/\/$/, '').split('/');
  if (left.length !== right.length)
    return false;
  return left.every((segment, index) => segment.startsWith(':') || segment === right[index]);
}

/** owner + role + accessibleName|id + strategy. Stable across runs by construction. */
export function fingerprintOf(input: {
  owner: string | null;
  role: TargetRole;
  identity: string;
  strategy: string;
}): string {
  return [input.owner ?? 'UNKNOWN', input.role, input.identity, input.strategy]
      .map(part => part.trim().toLowerCase().replace(/\s+/g, ' '))
      .join('|');
}

/**
 * The one comparison key two locator expressions are compared on.
 *
 * Quoting and whitespace are how the same expression is written twice, and neither is
 * part of what a locator MEANS. This normalises those away and nothing else: no token is
 * extracted, no segment is dropped, no shape is inferred. Two expressions that differ
 * anywhere else are different expressions and are never treated as one.
 */
function sameExpression(left: string | null | undefined, right: string | null | undefined): boolean {
  const flatten = (value: string) => value.replace(/["']/g, '"').replace(/\s+/g, ' ').trim();
  if (!left || !right)
    return false;
  return flatten(left) === flatten(right);
}

/**
 * The capability PROVEN to wrap this element - or null, which means NOT PROVEN.
 *
 * WHAT CHANGED IN PHASE 13.6, AND WHY. This used to tokenise the template, take the last
 * token, and treat agreement with a declared selector as identity. Phase 13.5 measured
 * that basis over the corpus and in a synthetic application: 9 associations, of which
 * three were provably wrong, one was wrong on the recorded evidence, four proved nothing,
 * and one was true and already caught by another gate. It is unsound in BOTH directions -
 * `.mdl-button` made two different modal buttons one element, and an element recorded
 * once by id and once by role escaped it entirely and was wrapped twice. Token overlap is
 * not a conservative approximation of identity; it is not an approximation of it at all.
 *
 * THE BASIS NOW IS A MEASUREMENT. The framework may say a capability wraps the recorded
 * element only where the browser resolved that capability's own declared locator, in the
 * document of the interaction, and reported that the element it found IS the element that
 * was acted on. That is `provesIdentity` over a measurement of the DECLARED expression,
 * and there are two ways one is in hand:
 *
 *   - the recorder asked the question directly at the press or the pick, and the answer
 *     carries `capability` naming who it was asked about (`measureDeclaredCapabilities`);
 *   - the same expression was measured as an ordinary candidate and proved identity. A
 *     capability declaring exactly that expression is proven by that measurement, because
 *     it IS a measurement of the capability's locator - taken for another reason.
 *
 * A PARAMETERISED capability is matched on its template, which is the existing structural
 * rule (`findParameterisedMethod`) rather than a second one: the instantiated expression
 * was proven at the interaction, and a declared template equal to the one being proposed
 * instantiates to that same expression. The template basis therefore still rests on a
 * measurement; it is only reached for a parameterised proposal, where an instantiated row
 * is the capability being USED and never a rival for it.
 *
 * NOT PROVEN IS NOT NO, AND IT IS CERTAINLY NOT YES. An unresolved locator, a locator that
 * matched several elements, a locator described only in prose, a recording made before the
 * measurement existed - each leaves this null, the proposal keeps whatever status its own
 * evidence earned, and a person decides. UNKNOWN never becomes YES.
 *
 * TWO CLAIMANTS ARE NO CLAIMANT, as everywhere else in this framework. The old gate
 * returned the first entry declaring the token and said nothing about the second; a
 * corpus element had two, and which one was reported was file order. If more than one
 * capability is proven to be this element, the repository is inconsistent and the answer
 * is review, not a coin toss.
 *
 * The entry must name a method that really exists on its class: a knowledge entry
 * pointing at a method nobody wrote is not a capability, and treating it as one would
 * refuse a proposal in favour of something uncallable.
 */
function existingCapability(
  proof: {
    /** Every measurement of this element that satisfies `provesIdentity`. */
    proven: readonly CandidateMeasurement[];
    /**
     * The template a PARAMETERISED proposal would create. Null on every other path, and
     * the template basis is unreachable without it.
     */
    template?: string | null;
  },
  knowledge: PageKnowledge[],
  index: ReturnType<typeof buildIndex>,
): { owner: string; method: string; file: string; basis: 'measured' | 'template' } | null {
  const found: Array<{ owner: string; method: string; file: string; basis: 'measured' | 'template' }> = [];
  for (const page of knowledge) {
    for (const element of page.elements) {
      const owner = element.page_object;
      const method = element.page_object_method;
      if (!owner || !method || !index.pages[owner]?.methods.some(entry => entry.name === method))
        continue;
      const declared = (element.locator_strategy ?? '').trim();
      // MEASURED. Either the question was asked about this very capability, or the
      // expression it declares was itself proven against this element.
      const measured = proof.proven.some(candidate => candidate.capability
        ? candidate.capability.owner === owner && candidate.capability.method === method
        : sameExpression(declared, candidate.expression));
      if (measured) {
        found.push({ owner, method, file: page.file, basis: 'measured' });
        continue;
      }
      // TEMPLATE. Only for a parameterised proposal, and only when something was proven
      // at the interaction: a template equal to the declared one, instantiated with the
      // value that was recorded, IS the expression the browser measured.
      if (proof.template && proof.proven.length && sameExpression(declared, proof.template))
        found.push({ owner, method, file: page.file, basis: 'template' });
    }
  }
  const distinct = new Set(found.map(entry => `${entry.owner}.${entry.method}`));
  if (distinct.size !== 1)
    return null;
  return found[0];
}

/** The status a category earns, before idempotency is considered. */
function statusFor(category: Category, safe: boolean): ProposalStatus {
  if (category === 'RECORDER_OWNED')
    return 'REFUSED';
  if (category === 'DYNAMIC')
    return 'REFUSED';
  if (category === 'TEST_DATA')
    return 'NEEDS_REVIEW';
  if (category === 'METHOD' || category === 'COMPONENT' || category === 'COMPONENT_MEMBER')
    return safe ? 'PROPOSED' : 'NEEDS_REVIEW';
  return 'NEEDS_REVIEW';
}

/**
 * An element that needed a Page Object and could not be evaluated for one, because
 * the recorder measured nothing for it.
 *
 * NOT a proposal, deliberately. A `Proposal` carries a classification, a safety
 * verdict and a proof, and every one of those is a statement about a measurement -
 * synthesising them for an element with no measurement would put invented evidence
 * into the ledger, which is the failure mode this whole subsystem is built against.
 * So this is its own record, with only what is actually known: which element, in which
 * recording, why nothing could be said about it, and the one thing that would change
 * that.
 */
export interface UnmeasuredTarget {
  testCaseId: string;
  /** The step's join key - `click Close`, `assert checked 639978`. */
  from: string;
  target: string;
  role: TargetRole;
  /** Codegen's own locator, redacted. Null when the recording carried none. */
  locator: string | null;
  code: RefusalCode;
  reason: string;
  /** The only thing that lifts this. Never a workaround. */
  remedy: string;
}

/**
 * A recording proved something ELSE about a capability the repository already has.
 *
 * WHY THIS EXISTS AT ALL. The framework's own rule is that an established capability is
 * append-only with respect to automated enrichment: a later recording must not replace,
 * rename or remove it. Until now the consequence was that the later evidence simply
 * vanished - a recording could measure a different expression for a known element, at the
 * press, with identity proven, and nothing anywhere would say so. The capability stayed
 * correct and the observation was lost, so the framework could neither learn from it nor
 * put it to a person.
 *
 * SO IT IS RECORDED AND NOTHING ELSE HAPPENS. This is a report. No writer reads it, no
 * proposal is derived from it, no locator is chosen by it, and the established capability
 * is not touched. The decision it exists to support - whether a capability should ever be
 * revised - is a person's, and the framework's job is to make that decision possible
 * rather than to take it.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: a score, a ranking, or any statement that the new
 * expression is BETTER. Locator quality is not capability ownership, and a comparison
 * stored here would be read as a verdict by the next person to automate against it. Both
 * expressions are recorded verbatim; whoever reviews them can judge them with the same
 * tools the framework uses.
 */
export interface AlternativeEvidence {
  /** The application that owns both the capability and the recording. */
  applicationId: string | null;
  testCaseId: string;
  /** The step's own join key, so the observation is findable per element. */
  from: string;
  role: TargetRole;
  /** The capability that already exists and stays exactly as it is. */
  owner: string;
  method: string;
  /** What knowledge declares for that capability. */
  declared: string;
  /** What THIS recording proved, at the press, against the element acted on. */
  observed: string;
  /** The knowledge file the capability is declared in. */
  knowledgeFile: string;
  /**
   * How the framework knows this observation is about THIS capability.
   *
   * One value today, and it is the point rather than a placeholder: the analyser's own
   * duplicate gate established that the recorded element is already wrapped by this
   * method, and then the recording proved a different expression for it. A reuse the
   * matcher resolved by NAME is deliberately not recorded - a name is not an element.
   */
  resolvedBy: 'element-already-wrapped';
}

export interface CorpusResult {
  proposals: Proposal[];
  /** Existing methods the matcher resolved. Counted, never re-proposed. */
  reused: Array<{ testCaseId: string; pageObject: string; method: string }>;
  /**
   * Elements that reached the engine with no measurement, one entry per sighting.
   *
   * Never deduped by fingerprint - there is no fingerprint to dedupe on, because a
   * fingerprint is built from a proof. Every occurrence in every recording is listed,
   * which is what lets the lifecycle answer for each element of each test.
   */
  unmeasured: UnmeasuredTarget[];
  /**
   * Proven evidence about capabilities that already exist. Retained for review, applied
   * by nothing. One entry per sighting, because each is a fact about one recording.
   */
  alternatives: AlternativeEvidence[];
  counts: Record<string, number>;
}

/**
 * Run the analyzer over every recording that still has its artefacts.
 *
 * A recording whose evidence was discarded on acceptance is skipped rather than
 * guessed at - there is nothing to classify without a captured graph.
 */
export interface AnalyseOptions {
  /**
   * Also read `recordings/accepted/`, which the analyser otherwise never sees.
   *
   * OFF BY DEFAULT, AND THAT DEFAULT IS LOAD-BEARING. The top-level, non-recursive
   * scan is what keeps the active queue and the archive apart: an accepted recording
   * must not look like one waiting to be generated, or a routine run would regenerate
   * every spec that has already been accepted - the mass migration this phase is
   * explicitly not doing.
   *
   * Turning it on answers a different question - "what would this recording produce
   * TODAY?" - and is used only by the fresh-generation harness, which writes to its
   * own file and never touches an accepted spec.
   */
  includeArchived?: boolean;
}

export function analyseCorpus(options: AnalyseOptions = {}): CorpusResult {
  const knowledge = readAllPageKnowledge();
  // THE ACTIVE APPLICATION, resolved once. Bootstrap needs it and nothing else does;
  // a scope that cannot be resolved simply leaves bootstrap unavailable, and every
  // declared owner rule answers exactly as it did before.
  let applicationId: string | null = null;
  try {
    applicationId = activeScope().applicationId;
  } catch {
    applicationId = null;
  }
  const index = buildIndex();
  const proposals: Proposal[] = [];
  const reused: CorpusResult['reused'] = [];
  const unmeasured: UnmeasuredTarget[] = [];
  const alternatives: AlternativeEvidence[] = [];
  /**
   * One line per DISTINCT alternative, not per sighting.
   *
   * The same element touched by two steps of one recording proves the same thing twice,
   * and a reviewer acts on the alternative rather than on how often it was seen. Keyed on
   * the application, the capability and the expression itself - the first sighting is
   * kept, so the record names a recording that really produced it.
   */
  const alternativesSeen = new Set<string>();
  const rememberAlternative = (entry: AlternativeEvidence | null): void => {
    if (!entry)
      return;
    const key = `${entry.applicationId ?? ''}|${entry.owner}.${entry.method}|${entry.observed}`;
    if (alternativesSeen.has(key))
      return;
    alternativesSeen.add(key);
    alternatives.push(entry);
  };
  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  const timestamp = new Date().toISOString();

  /**
   * Every sighting of every fingerprint, including the ones the ledger dedupes away.
   *
   * The ledger keeps one line per distinct abstraction; the lifecycle has to answer
   * "what happened to this element in THIS test", and a target first seen in another
   * recording has no line of its own. Collected here and attached to the surviving
   * proposal once the corpus has been read.
   */
  const sightings = new Map<string, Array<{ testCaseId: string; from: string }>>();
  const sight = (fingerprint: string, testCaseId: string, from: string) => {
    sightings.set(fingerprint, [...(sightings.get(fingerprint) ?? []), { testCaseId, from }]);
  };

  /**
   * Which distinct containers each accessible name was seen in.
   *
   * `findMethod` matches an accessible name PAGE-WIDE; it has no notion of the scope
   * a method's locator is written against. So a name that several different elements
   * share is not an identifier, however well proven any one of them is.
   */
  const nameContainers = new Map<string, Set<string>>();

  /** Row-scoped targets, held until the whole corpus has been read. */
  const members: Array<{
    signature: string; role: TargetRole; testCaseId: string;
    /** The step's join key, so the group's decision is findable per element. */
    from: string;
    owner: string | null; ownerWhy: string;
    ownerCode: RefusalCode | null; ownerCandidates: string[] | null;
    value: string; proven: boolean; node: TargetEvidence['target'];
    strategy: string; expression: string; refusals: Refusal[];
  }> = [];

  // ONE ENTRY PER RECORDING: its id, and the directory its artefacts live in. The live
  // queue is always read; the archive only when explicitly asked for.
  const sources: Array<{ testCaseId: string; dir: string }> = [];
  if (fs.existsSync(recordingsDir())) {
    for (const name of fs.readdirSync(recordingsDir()).filter(file => file.endsWith('.spec.ts')).sort())
      sources.push({ testCaseId: path.basename(name, '.spec.ts'), dir: recordingsDir() });
  }
  if (options.includeArchived && fs.existsSync(acceptedDir())) {
    const live = new Set(sources.map(entry => entry.testCaseId));
    for (const name of fs.readdirSync(acceptedDir()).filter(file => file.endsWith('.spec.ts')).sort()) {
      const testCaseId = path.basename(name, '.spec.ts');
      // A live recording always wins: it is the one waiting to be generated, and the
      // archived copy is the previous answer to the same question.
      if (!live.has(testCaseId))
        sources.push({ testCaseId, dir: acceptedDir() });
    }
  }

  for (const source of sources) {
    const { testCaseId, dir } = source;
    const archived = dir === acceptedDir();
    const recording = parseRecording(fs.readFileSync(path.join(dir, `${testCaseId}.spec.ts`), 'utf8'), {
      startUrl: '', browser: '', durationMs: 0,
      evidence: readEvidence(testCaseId, { archived }),
      stateAssertions: readAssertions(testCaseId, { archived }),
    });
    const mapping = mapRecording(recording);
    // WHAT THE RECORDING SAYS IT IS. Compared with the active scope by `bootstrapOwner`,
    // never used as a substitute for it, and null for every recording made before the
    // field existed - which is what makes those recordings non-bootstrapable.
    const originApplicationId = isDomEvidence(mapping.evidence)
      ? (mapping.evidence.origin?.applicationId ?? null)
      : null;

    // THE ROUTE IN EFFECT AT EACH STEP, read from the MAPPED steps.
    //
    // Not from the recorded actions, and that distinction is P0.8: a recording
    // cannot contain the navigation the application performs for itself, so after a
    // sign-in the recorded actions still say `/` while the browser is on `/apps`.
    // The assembler already inserts a navigate STEP for that redirect, resolved from
    // the landing screen's declared entry point - so walking the steps carries the
    // route change that walking the actions misses, using the pipeline's own answer
    // rather than a second guess at it.
    const routeOfNavigate = (code: string): string | null => {
      const goto = /goto\(\s*['"]([^'"]+)['"]/.exec(code);
      if (goto) {
        try {
          return new URL(goto[1]).pathname.replace(/\/$/, '') || '/';
        } catch {
          return null;
        }
      }
      // `await projectsPage.open();` - the entry point a knowledge file declares.
      const call = /\.(\w+)\(\s*\)/.exec(code);
      if (!call)
        return null;
      const page = knowledge.find(entry =>
        new RegExp(`\.${call[1]}\(\)`).test(entry.entryPoint || ''));
      return page ? (page.route || '/') : null;
    };
    // FOUND: the matcher already resolved these. Recorded as reuse, never analysed -
    // an existing method always wins, which is the whole backward-compatibility rule.
    for (const entry of mapping.reused)
      reused.push({ testCaseId, ...entry });

    // WHAT THE MATCHER RESOLVED, keyed by the step's own `from` string. A step whose
    // kind is `page-object` is findMethod FOUND, and its target is never analysed:
    // an existing method always wins.
    const resolved = new Set(mapping.steps
        .filter(step => step.kind === 'page-object' || step.kind === 'authenticate')
        .map(step => step.from));

    // ITERATE THE RECORDED ACTIONS, NOT THE EMITTED STEPS.
    //
    // A step carries the locator that will be EMITTED - for a row checkbox that is
    // the resolved contextual expression, while the evidence sidecar is keyed by
    // what Codegen RECORDED (`[id="639978"]`). Joining on the step therefore found
    // nothing for exactly the targets this phase is about. The recorded action
    // carries the recording's own locator, which is the sidecar's join key.
    //
    // BUILT BEFORE THE SIDECAR CHECK BELOW, and that ordering is the point: a
    // recording with no evidence at all still has elements that needed a Page Object,
    // and they have to be named as refused rather than vanish with the recording.
    const items: Array<{
      from: string; target: string; locator: string; role: TargetRole;
      /**
       * THE ASSERTION'S OWN PROVENANCE, carried so the join below can reach a capture
       * that no locator string can name.
       *
       * `evidenceForLocator` joins on the recorded expression, which is the right key
       * for an action - the action IS the line Codegen wrote - and cannot reach an
       * assertion-pick capture at all: a pick row's `locator` is the synthetic
       * `(assertion pick <ref>)` and `evidenceFor` skips such rows by design. So every
       * assertion whose composed phrase differed from its candidate's reported
       * NO_ADMISSIBLE_EVIDENCE - "the evidence sidecar holds no measurement joinable to
       * this element's recorded locator" - while the sidecar held a unique measurement
       * for that very element, reachable by `captureRef`. TC_LOGIN_123's three
       * assertions said exactly that, about a capture measuring one element with
       * identity matched.
       */
      provenance?: AssertionProvenance;
    }> = [
      ...recording.actions
          .filter(action => action.type !== 'navigate')
          .map(action => ({
            from: `${action.type} ${action.target}`, target: action.target,
            locator: action.locator, role: 'action' as TargetRole,
          })),
      ...(recording.assertions ?? []).map(assertion => ({
        from: `assert ${assertion.type} ${assertion.target}`, target: assertion.target,
        locator: assertion.locator ?? '', role: 'assertion' as TargetRole,
        ...(assertion.subjectProvenance ? { provenance: assertion.subjectProvenance } : {}),
      })),
    ];

    // A WHOLE RECORDING WITH NO SIDECAR IS 58 OF THE CORPUS'S 87 UNEVALUATED ELEMENTS.
    //
    // It used to `continue` here, which discarded every element in the recording at
    // once. Each one is now recorded as refused for the one reason that is true of all
    // of them, and the loop still does no analysis - there is nothing to analyse.
    if (!isDomEvidence(mapping.evidence)) {
      for (const item of items) {
        if (resolved.has(item.from))
          continue;
        unmeasured.push({
          testCaseId,
          from: item.from,
          target: redact(item.target) ?? '(unnamed)',
          role: item.role,
          locator: redact(item.locator) ?? null,
          code: 'NO_ADMISSIBLE_EVIDENCE',
          reason: 'the recording carries no DOM evidence sidecar (recorded before press-time capture existed)',
          remedy: 'Re-record required.',
        });
      }
      continue;
    }

    // The route in effect, tracked over the step stream (see routeOfNavigate).
    let route = '/';
    for (const step of mapping.steps) {
      if (step.kind === 'navigate')
        route = routeOfNavigate(step.code.join(' ')) ?? route;
    }
    const routeAtEnd = route;
    route = '/';

    for (const item of items) {
      // FOUND - the matcher already has a method for it. Never analysed.
      //
      // AND NEVER OBSERVED FROM HERE EITHER, which cost a wrong record before it was
      // measured. The matcher resolves by NAME (`findMethod`) or by the expression itself
      // (`findMethodByProvenLocator`). The second can only match when the declared
      // locator IS the proven one, so it has nothing to report; the first is explicitly
      // not element identity, and a control that merely shares an accessible name would
      // be reported as new evidence about a capability it has nothing to do with. The
      // duplicate gate below knows both facts - the element is already wrapped, and this
      // recording proved something else for it - so that is where an observation is made.
      if (resolved.has(item.from))
        continue;
      const role = item.role;
      // THE RECORDED LOCATOR FIRST, THEN PROVENANCE - the same order, and for the same
      // reason, as `judged` in from-recording.ts: a row recorded under this very
      // expression describes the expression being judged, while provenance describes the
      // ELEMENT it is about. Provenance is a fallback, never an override, and it is only
      // ever consulted for an assertion, because only an assertion has one.
      const evidence = (item.locator ? evidenceForLocator(mapping.evidence, item.locator) : null)
        ?? (item.provenance
          ? evidenceForAssertionSubject(mapping.evidence,
              { locator: item.locator, subjectProvenance: item.provenance })?.evidence ?? null
          : null);

      // NOT EVALUATED AND EVALUATED-AND-REFUSED MUST NOT LOOK THE SAME.
      //
      // This was `if (!evidence) continue;`, and it was the lifecycle's only silent
      // exit: an element the recorder never measured fell out of the engine here,
      // produced no proposal, no refusal and no count, and then appeared downstream as
      // `PAGE OBJECT REQUIRED` with a raw locator - indistinguishable from an element
      // that had been analysed and correctly refused. Measured over the corpus: 87 of
      // 225 raw locators left through this line.
      //
      // NOTHING IS RESCUED HERE. There is no measurement, so there is no candidate, no
      // proof and no method - the answer is still a refusal. What changes is that the
      // refusal is now WRITTEN DOWN, with the code that says which kind it is and the
      // one remedy that can lift it.
      if (!evidence) {
        unmeasured.push({
          testCaseId,
          from: item.from,
          target: redact(item.target) ?? '(unnamed)',
          role,
          locator: redact(item.locator) ?? null,
          code: 'NO_ADMISSIBLE_EVIDENCE',
          reason: !isDomEvidence(mapping.evidence)
            ? 'the recording carries no DOM evidence sidecar (recorded before press-time capture existed)'
            : 'the evidence sidecar holds no measurement joinable to this element\'s recorded locator',
          remedy: 'Re-record required.',
        });
        continue;
      }
      const step = mapping.steps.find(entry => entry.from === item.from);
      route = routeAtEnd;

      // Record where this name lives BEFORE any decision, so the post-pass below
      // sees every sighting including the ones that were refused for other reasons.
      // Keyed on the RECORDED TARGET, because that is the string `findMethod`
      // matches against. Keying on the captured accessibleName instead missed every
      // sighting whose graph was taken after the action and carries no name - which
      // was four of the five `Close` buttons, and would have let the ambiguity
      // through.
      const seenName = (item.target ?? '').trim().toLowerCase();
      if (seenName) {
        const scope = (evidence.ancestors ?? []).find(ancestor => (ancestor.id ?? '').trim())?.id
          ?? ((evidence.target.stableClasses ?? []).join('.') || 'page');
        nameContainers.set(seenName, (nameContainers.get(seenName) ?? new Set()).add(scope));
      }

      const classification = classify(evidence, role);
      counts[classification.category] = (counts[classification.category] ?? 0) + 1;

      // THE THIRD SILENT EXIT, and the lifecycle is what found it. A RECORDER_OWNED
      // target is the recorder's own overlay and correctly gets no Page Object - but it
      // was leaving with no record at all, so the eight `click .veil` steps across four
      // recordings reached the report as "the abstraction engine holds no record for
      // this element", which is the loud failure this phase installed for exactly this.
      //
      // The ANSWER does not change - there is still no method for a recorder overlay -
      // only the silence does.
      if (classification.category === 'RECORDER_OWNED') {
        unmeasured.push({
          testCaseId,
          from: item.from,
          target: redact(item.target) ?? '(unnamed)',
          role,
          locator: redact(item.locator) ?? null,
          code: 'RECORDER_OWNED_ELEMENT',
          reason: classification.reason,
          remedy: 'None: the recorder\'s own overlay is not part of the application under test.',
        });
        continue;
      }

      const safety = validateCandidate(evidence, role);
      // EVERY MEASUREMENT THAT IDENTIFIED THIS ELEMENT, read once. It is what the
      // capability gate below is entitled to reason from, and the only thing it is.
      const identityProofs = provenMeasurements(evidence, role);
      // THE ROUTE THE DOCUMENT ITSELF STATED AT THE PRESS, and only that.
      //
      // `route` above is RECONSTRUCTED from `goto` calls and declared entry points, which
      // is the best a recording made before press-time routes existed can offer - and it
      // is a reconstruction, not something the page said. Bootstrapping a screen from it
      // would be enriching a historical recording with evidence it never carried, which
      // is the one thing this phase may not do. So a recording with no `route` field is
      // not bootstrapable, exactly like one with no `origin`: re-record it.
      const pressRoute = typeof evidence.route === 'string' && evidence.route ? evidence.route : null;
      const owner = resolveOwner(evidence, knowledge, [route], applicationId
        ? { applicationId, originApplicationId, route: pressRoute }
        : undefined);
      const wantsSuffix = Boolean((evidence.target.accessibleName ?? '').trim());
      const method = methodNameForTarget(evidence.target, role, { needsRoleSuffix: wantsSuffix });
      const effective = effectiveLocator(evidence, role);
      const parameterSource = parameterSourceOf(effective.expression) ?? parameterSourceOf(evidence.locator);
      const parameterised = insideRepeatedContainer(evidence) && Boolean(parameterSource);

      // A ROW MEMBER IS NOT AN ABSTRACTION ON ITS OWN.
      //
      // One row checkbox is an element; several with the same structure and
      // different descriptions are a method with an argument. So a member is
      // collected here and decided later, once the whole corpus has been read -
      // parameterisation is the one judgement a single target cannot support.
      const signature = structuralSignature(evidence);
      // `parameterised` already requires a parameter source, so the third test changes
      // nothing at run time - it is what tells the compiler that `value` below is a
      // string rather than `string | null`.
      if (parameterised && signature && parameterSource) {
        members.push({
          signature, role, testCaseId, from: item.from,
          owner: owner.owner, ownerWhy: owner.why,
          // `OwnerResolution` leaves both optional; the member holds them as explicit
          // nulls, and every reader already coalesces, so the two are interchangeable.
          ownerCode: owner.code ?? null, ownerCandidates: owner.candidates ?? null,
          value: parameterSource, proven: safety.safe && effective.proven,
          node: evidence.target, strategy: safety.proof?.strategy ?? 'contextual',
          expression: effective.expression, refusals: safety.codes,
          // Carried, not re-derived: the group decides its capability question over the
          // whole corpus, long after this target's evidence has been released.
          identityProofs,
        });
        continue;
      }

      let status = statusFor(classification.category, safety.safe);
      const refusals: Refusal[] = [...safety.codes];
      // A CATEGORY THAT IS ITSELF THE REFUSAL. `statusFor` sends these to review with
      // no entry in `refusals`, so the code has to be added here or the proposal
      // would read as reviewable for no stated reason - and eligibility, decided on
      // codes alone, would see an empty list and wrongly call it eligible.
      if (status === 'NEEDS_REVIEW' && safety.safe) {
        if (classification.category === 'TEST_DATA')
          refusals.push(refuse('TEXT_ONLY_IDENTITY', classification.reason));
        else if (classification.category === 'UNCLASSIFIED')
          refusals.push(refuse(/container/.test(classification.reason)
            ? 'CONTAINER_OR_CAPABILITY' : 'UNCLASSIFIED_TARGET', classification.reason));
      }

      // IDEMPOTENCY, second gate: the name is already taken on the owning class. It
      // is only a reuse when the same element is meant, which nothing here can prove
      // - so it is a review, never an overwrite and never a `name2`.
      if (status === 'PROPOSED' && owner.owner && method) {
        const existing = index.pages[owner.owner]?.methods.some(entry => entry.name === method);
        if (existing) {
          status = 'REUSE';
          refusals.push(refuse('METHOD_EXISTS', `${owner.owner}.${method}() already exists`));
        }
      }
      if (status === 'PROPOSED' && (!owner.owner || !method)) {
        status = 'NEEDS_REVIEW';
        if (!owner.owner)
          refusals.push(refuse(owner.code ?? 'OWNER_UNKNOWN', owner.why));
        if (!method) {
          refusals.push(refuse('NO_METHOD_NAME',
              'no deterministic method name can be derived from this element'));
        }
      }

      // IDEMPOTENCY, BY ELEMENT. A capability already wrapped under another name is a
      // reuse, not a second method - and it is settled here so that a resolver is
      // never asked about something the repository has already answered. A SAFETY
      // refusal still wins: an unproven target says nothing about the method that
      // happens to point at the same element.
      let wrapsSameElement: { owner: string; method: string; file: string } | null = null;
      if (status !== 'REFUSED' && !refusals.some(entry => entry.class === 'SAFETY')) {
        const already = existingCapability({ proven: identityProofs }, knowledge, index);
        wrapsSameElement = already;
        if (already && already.method !== method) {
          status = 'REUSE';
          refusals.push(refuse('METHOD_EXISTS',
              `${already.owner}.${already.method}() already wraps this element (${already.file})`));
        }
      }

      // THE SAME OBSERVATION, ON THE OTHER PATH. Here the matcher did not resolve the
      // step; the analyser found THIS ELEMENT already wrapped and refused to wrap it
      // twice. That refusal is correct and unchanged - and it is also the moment a
      // second, proven expression for an established capability is known.
      //
      // ONLY THE ELEMENT GATE, NEVER THE NAME GATE. `METHOD_EXISTS` is also raised when
      // the NAME is taken on the owning class, which says nothing about the element -
      // two different controls can derive one name. Recording that as evidence about the
      // existing capability describes the wrong element entirely, and the corpus caught
      // it doing so. Read from the gate's own answer rather than from the refusal's
      // wording, which nothing here is allowed to branch on.
      if (wrapsSameElement) {
        const observation = alternativeEvidenceFor({
          applicationId, testCaseId, from: item.from, role,
          owner: wrapsSameElement.owner, method: wrapsSameElement.method,
          observed: safety.proof?.expression, knowledge, index,
          resolvedBy: 'element-already-wrapped',
        });
        rememberAlternative(observation);
      }

      const identity = (evidence.target.accessibleName ?? '').trim()
        || (evidence.target.id ?? '').trim()
        || (evidence.target.stableClasses ?? []).join('.')
        || evidence.target.tag;
      const fingerprint = fingerprintOf({
        owner: owner.owner, role, identity,
        strategy: safety.proof?.strategy ?? step?.quality?.strategy ?? 'unknown',
      });

      // EVERY SIGHTING IS RECORDED, INCLUDING THE DEDUPED ONES, and it happens before
      // the gate below rather than after. The ledger wants one line per abstraction;
      // the lifecycle wants to answer for one element of one test, and those are
      // different questions about the same fact.
      sight(fingerprint, testCaseId, item.from);

      // IDEMPOTENCY, fourth gate: one line per distinct abstraction, however many
      // recordings touched it. Running twice must not grow the ledger.
      if (seen.has(fingerprint))
        continue;
      seen.add(fingerprint);

      proposals.push({
        timestamp,
        testCaseId,
        target: redact(step?.label ?? item.from) ?? '(unnamed)',
        role,
        category: classification.category,
        rule: classification.rule,
        status,
        owner: owner.owner,
        ownerKind: owner.kind,
        ...(owner.bootstrap ? { bootstrap: owner.bootstrap } : {}),
        method: status === 'PROPOSED' || status === 'REUSE' ? method : null,
        parameterised,
        parameterSource: parameterised ? redact(parameterSource) : null,
        locatorStrategy: safety.proof?.strategy ?? step?.quality?.strategy ?? 'unknown',
        expression: redact(safety.proof?.expression ?? step?.quality?.expression ?? null),
        proof: safety.proof,
        reason: classification.reason,
        refusals: dedupe(refusals).map(entry => entry.detail),
        refusalCodes: dedupe(refusals),
        resolvedBy: 'deterministic',
        semantic: null,
        allowedOwners: owner.candidates ?? (owner.owner ? [owner.owner] : []),
        derivedMethod: method,
        // No parameter here, so there is no substitution to reverse.
        roundTrip: false,
        // No parameter, so the proven expression IS the template - and it contains
        // no recorded value, or rule 7 would have called it data.
        template: safety.proof?.expression ?? null,
        parameterName: null,
        accessibleName: (evidence.target.accessibleName ?? '').trim() || null,
        // Filled in the post-pass below, once every recording has been read: whether a
        // name is shared is a property of the CORPUS and is unknowable here.
        accessibleNameAmbiguous: false,
        sightings: [],
        fingerprint,
      });
    }
  }

  // ---- PARAMETERISED GROUPS, decided over the whole corpus.
  //
  // One line per abstraction, never one per row: the members of a group ARE the
  // evidence for it, and emitting them individually would be the duplication this
  // engine exists to avoid.
  const groups = new Map<string, typeof members>();
  for (const member of members) {
    const key = `${member.owner ?? 'UNKNOWN'}|${member.role}|${member.signature}`;
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }

  for (const [key, all] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    // UNPROVEN MEMBERS DO NOT JOIN THE GROUP; they are not evidence for anything.
    //
    // `parameterisationHolds` still refuses outright if an unproven member reaches it
    // - that rule is the contract and is tested directly. What happens here is one
    // step earlier: a target the recorder could not prove against the element that
    // was pressed says nothing about whether two rows share a structure, so it is
    // not counted either way. Excluding it is not the same as forgiving it, and the
    // count is carried into the ledger so a reader can see what was set aside.
    const group = all.filter(member => member.proven);
    const excluded = all.length - group.length;
    const first = group[0] ?? all[0];
    const holds = group.length
      ? parameterisationHolds(group.map(item => ({
        signature: item.signature, value: item.value, proven: item.proven,
      })))
      : { holds: false, code: null, reason: `no member of this group is identity-proven (${excluded} set aside)` };
    const method = first.owner ? parameterisedNameFor(first.owner, first.node, first.role) : null;
    const refusals: Refusal[] = [...group.flatMap(item => item.refusals)];
    let status: ProposalStatus = 'NEEDS_REVIEW';

    // THE INDEX ANSWERS BEFORE THE GROUP DOES. Once the capability is on the class,
    // it exists - and re-deciding whether the group's own values vary enough to
    // justify parameterising it is asking a question that has already been answered
    // in the repository. Left below, a constant-value group would go to review, be
    // asked about, come back REUSE, and cost one model call on every run forever.
    //
    // A SAFETY refusal still wins: an unproven group says nothing about the method
    // that happens to share its name, so it stays in review rather than quietly
    // reporting itself as covered.
    const existing = Boolean(first.owner && method
      && index.pages[first.owner]?.methods.some(entry => entry.name === method));

    // A MEASURED INDEX IS EVIDENCE ABOUT ONE INSTANCE, NOT A PROPERTY OF A CAPABILITY.
    //
    // TC_DASHBOARD_023 is why this exists. Its checkbox resolved, correctly, to
    // `.tabulator-row filter(hasText: <value>) .rounded-checkbox-ui .nth(2)` - and the
    // parameteriser then offered that as a REUSABLE method taking a description, with
    // `.nth(2)` baked in. The two halves contradict each other: the parameter says
    // "any row you name" and the index says "the third one I happened to press".
    // Index 2 was measured for one row and generalises to none.
    //
    // It was reported REUSE, so nothing was written that day - but only because a
    // method of that name already existed. Had it not, `PROPOSED` was the next branch
    // and an indexed method would have been generated. So all three outcomes are shut:
    // the name-matched REUSE and the template-matched REUSE below are both gated on
    // SAFETY, and this branch takes REFUSED before the ladder can reach PROPOSED.
    //
    // The target is left unresolved on purpose. An existing method that resolves it
    // WITHOUT positional narrowing still reuses normally - that path does not come
    // through here, because its expression carries no index.
    const positional = isPositionalLocator(first.expression ?? '');
    if (positional) {
      refusals.push(refuse('POSITIONAL_NOT_PARAMETERISABLE',
          'the proven expression narrows by a measured index, which is evidence about the '
          + 'one element that was pressed and cannot be a property of a method taking a '
          + 'parameter - index 2 of one recording generalises to no other value'));
    }

    const unsafe = refusals.some(entry => entry.class === 'SAFETY')
      || holds.code === 'GROUP_MEMBER_UNPROVEN';

    if (existing && !unsafe) {
      status = 'REUSE';
      refusals.push(refuse('METHOD_EXISTS', `${first.owner}.${method}() already exists`));
    } else if (positional) {
      status = 'REFUSED';
    } else if (!holds.holds) {
      refusals.push(refuse(holds.code ?? 'UNCLASSIFIED_TARGET', holds.reason));
    } else if (!first.owner) {
      refusals.push(refuse(first.ownerCode ?? 'OWNER_UNKNOWN', first.ownerWhy));
    } else if (!method) {
      refusals.push(refuse('NO_METHOD_NAME',
          'no method name can be derived from the owner and the element kind'));
    } else {
      // An existing parameterised method always wins, and was already handled above;
      // reaching here means the name is free and every gate passed.
      status = 'PROPOSED';
    }

    // THE TEMPLATE IS BUILT BEFORE ANYTHING IS STORED, so no recorded value ever
    // reaches the ledger or the writer. If the value cannot be found in the
    // expression the template is null and the group cannot be generated: a method
    // built from an expression that still held one issue's summary would hard-code
    // that issue in every test that called it.
    const parameterName = parameterNameFor(first.expression);
    const template = parameterName
      ? templateFor(first.expression, first.value, parameterName) : null;
    // ASSERTED, NOT ASSUMED. Put the recorded value back where the parameter went and
    // the measured expression must come back byte for byte. Nothing is stored but the
    // boolean, so the ledger still carries no test data.
    const roundTrip = Boolean(template && parameterName && first.value
      && (template.split(parameterName).join(`"${first.value}"`) === first.expression
        || template.split(parameterName).join(`'${first.value}'`) === first.expression));
    if (status === 'PROPOSED' && !template) {
      status = 'NEEDS_REVIEW';
      refusals.push(refuse('TEMPLATE_NOT_DERIVABLE',
          'the recorded value could not be replaced by a parameter in the locator'));
    }

    // The same idempotency, for a parameterised capability.
    if (status !== 'REFUSED' && !refusals.some(entry => entry.class === 'SAFETY')) {
      const already = existingCapability(
          { proven: group.flatMap(item => item.identityProofs), template }, knowledge, index);
      if (already && already.method !== method) {
        status = 'REUSE';
        refusals.push(refuse('METHOD_EXISTS',
            `${already.owner}.${already.method}() already wraps this element (${already.file})`));
      }
    }

    counts.PARAMETERISED = (counts.PARAMETERISED ?? 0) + 1;
    proposals.push({
      timestamp, testCaseId: [...new Set(all.map(item => item.testCaseId))].sort().join(','),
      target: `${group.length} proven row-scoped target(s) sharing one structure`
        + (excluded ? `, ${excluded} unproven set aside` : ''),
      role: first.role,
      category: 'COMPONENT_MEMBER', rule: 8, status,
      owner: first.owner, ownerKind: first.owner ? 'page-object' : null,
      method: status === 'PROPOSED' || status === 'REUSE' ? method : null,
      parameterised: true,
      // The DISTINCT COUNT, never the values. A ledger that listed them would be a
      // list of issue summaries and project names - test data, in a report.
      parameterSource: `${new Set(group.map(item => item.value)).size} distinct recorded value(s)`,
      locatorStrategy: first.strategy,
      expression: redact(first.expression),
      proof: {
        matchCount: 1,
        identityMatched: group.length > 0 && group.every(item => item.proven),
        sameDocument: true,
        measuredAt: 'press',
        strategy: first.strategy,
      },
      reason: holds.reason,
      refusals: dedupe(refusals).map(entry => entry.detail),
      refusalCodes: dedupe(refusals),
      resolvedBy: 'deterministic',
      semantic: null,
      allowedOwners: first.ownerCandidates ?? (first.owner ? [first.owner] : []),
      derivedMethod: method,
      roundTrip,
      template, parameterName,
      accessibleName: (first.node.accessibleName ?? '').trim() || null,
      accessibleNameAmbiguous: false,
      // A group proposal stands for every member sighting, so the lifecycle can find
      // it from any of the recordings that contributed a row.
      sightings: all.map(item => ({ testCaseId: item.testCaseId, from: item.from })),
      fingerprint: `${key}|parameterised`.toLowerCase(),
    });
  }

  // ---- A GENERIC NAME IS NOT AN IDENTIFIER.
  //
  // `Close` is the case that proved it. One was measured, proven and scoped inside
  // `#ap_notifications_panel` - unimpeachable on its own. But four other elements in
  // this corpus are also called `Close`: the add-issue section's, the assignee
  // dropdown's, `#first_report_modal`'s and `#response_modal_dialog`'s. Declaring
  // the name would have bound all of them to a locator scoped to the notification
  // panel, because the matcher reads names page-wide and knows nothing of scope.
  //
  // Measured across the corpus rather than judged: if a name was seen inside more
  // than one distinct container, it does not identify an element and the proposal
  // goes to review. Being well proven is not the same as being unambiguous.
  for (const proposal of proposals) {
    // THE SIGHTINGS ARE ATTACHED FIRST, and to every proposal whatever its status: a
    // REFUSED line still has to be findable by the test whose element it refused.
    //
    // ONLY WHERE THE MAP HAS AN ENTRY. A parameterised group proposal sets its own
    // sightings from its members and has no entry here, because its fingerprint is
    // composed (`<key>|parameterised`) rather than measured. Assigning `?? []`
    // unconditionally emptied all three of them.
    const seenAt = sightings.get(proposal.fingerprint);
    if (seenAt)
      proposal.sightings = seenAt;

    if (!proposal.accessibleName)
      continue;
    const scopes = nameContainers.get(proposal.accessibleName.trim().toLowerCase());
    if (!scopes || scopes.size <= 1)
      continue;

    // THE FLAG IS A FACT ABOUT THE CORPUS AND IS SET WHATEVER THE STATUS.
    //
    // It is what `renderKnowledgeEntry` consults before declaring `accessible_name`,
    // and the whole point of the structural fix is that the shared name is never
    // written into an entry - so it must be true on every proposal that carries such a
    // name, not only on the ones that happen to be reviewable.
    proposal.accessibleNameAmbiguous = true;

    if (proposal.status !== 'PROPOSED')
      continue;
    proposal.status = 'NEEDS_REVIEW';
    proposal.method = null;
    const ambiguous = refuse('AMBIGUOUS_NAME',
        `"${proposal.accessibleName}" names ${scopes.size} structurally different elements in this `
        + 'corpus, so it does not identify one - a method declared under it would bind them all');
    proposal.refusalCodes = dedupe([...proposal.refusalCodes, ambiguous]);
    proposal.refusals = proposal.refusalCodes.map(entry => entry.detail);
  }

  return { proposals, reused, unmeasured, alternatives, counts };
}

/**
 * The evidence row for a recorded locator.
 *
 * `evidenceFor` joins on the string Codegen wrote, which is right for an action. An
 * ASSERTION does not carry that string: the picker stores the locator it RESOLVED,
 * so a row checkbox's assertion arrives as the contextual expression while the
 * sidecar is still keyed by `page.locator('[id="639978"]')`. Joining on the recorded
 * key alone therefore missed exactly the targets this phase exists to group.
 */
function evidenceForLocator(
  evidence: Parameters<typeof evidenceFor>[0],
  locator: string,
): TargetEvidence | null {
  const direct = evidenceFor(evidence, locator);
  if (direct)
    return direct;
  if (!isDomEvidence(evidence))
    return null;
  // EXACT match against a measurement the recorder took for that element - not a
  // resemblance test. Either it measured this expression for this target or it did
  // not.
  return evidence.targets.find(target =>
    (target.derivedCandidates ?? []).some(candidate => candidate.expression === locator)) ?? null;
}

/**
 * Write the ledger. Same corpus in, same bytes out.
 *
 * THE TIMESTAMP IS FIRST-SEEN, NOT LAST-WRITTEN. A fingerprint already in the ledger
 * keeps the time it was first proposed, so re-running the engine over an unchanged
 * corpus rewrites the file byte for byte and a diff shows only what genuinely
 * changed. Stamping every run with `now` would make the whole file churn on every
 * invocation, which is the same as having no way to see what is new.
 */
export function writeLedger(result: CorpusResult, file = LEDGER): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const firstSeen = new Map<string, string>();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      try {
        const previous = JSON.parse(line) as Proposal;
        if (previous.fingerprint && previous.timestamp)
          firstSeen.set(previous.fingerprint, previous.timestamp);
      } catch {
        // A hand-edited or truncated line is skipped rather than throwing: the
        // ledger is a report, and one bad line must not stop the next run.
      }
    }
  }

  const lines = result.proposals
      .slice()
      .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
      .map(proposal => JSON.stringify({
        ...proposal,
        timestamp: firstSeen.get(proposal.fingerprint) ?? proposal.timestamp,
      }));
  fs.writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
}

/**
 * The alternative-evidence report: one JSON line per observation, its own file.
 *
 * SEPARATE FROM THE PROPOSAL LEDGER on purpose. That ledger holds one line per
 * abstraction and every consumer reads its lines as proposals; an observation is a
 * different kind of statement about a capability that is NOT being proposed. Rewritten
 * from the corpus on every run rather than appended to, exactly like the ledger, so the
 * same recordings always produce the same file.
 */
export function writeAlternatives(result: CorpusResult, file = ALTERNATIVES): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = result.alternatives
      .slice()
      .sort((left, right) => `${left.testCaseId}|${left.owner}.${left.method}|${left.from}`
          .localeCompare(`${right.testCaseId}|${right.owner}.${right.method}|${right.from}`))
      .map(entry => JSON.stringify(entry));
  fs.writeFileSync(file, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
}

function main(): void {
  const dry = process.argv.includes('--dry');
  const result = analyseCorpus();
  const byStatus: Record<string, number> = {};
  for (const proposal of result.proposals)
    byStatus[proposal.status] = (byStatus[proposal.status] ?? 0) + 1;

  process.stdout.write('\nabstraction engine - phase 1 (report only, no model, nothing written to source)\n\n');
  process.stdout.write(`  recordings analysed      ${fs.existsSync(recordingsDir())
    ? fs.readdirSync(recordingsDir()).filter(name => name.endsWith('.spec.ts')).length : 0}\n`);
  process.stdout.write(`  existing methods reused  ${result.reused.length}\n`);
  process.stdout.write(`  distinct proposals       ${result.proposals.length}\n\n`);
  for (const [status, count] of Object.entries(byStatus).sort())
    process.stdout.write(`    ${status.padEnd(14)} ${count}\n`);
  process.stdout.write('\n  classification counts\n');
  for (const [category, count] of Object.entries(result.counts).sort())
    process.stdout.write(`    ${category.padEnd(18)} ${count}\n`);

  if (dry) {
    process.stdout.write('\n  --dry: ledger not written\n');
    return;
  }
  writeLedger(result);
  writeAlternatives(result);
  process.stdout.write(`\n  ledger: ${path.relative(ROOT, LEDGER).replace(/\\/g, '/')}\n`);
}

if (process.argv[1] && /propose\.ts$/.test(process.argv[1]))
  main();
