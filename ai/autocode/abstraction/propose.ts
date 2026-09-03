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
  type AssertionProvenance, type TargetEvidence,
} from '../dom-evidence';
import { analyseIdentifier, isPositionalLocator} from '../locator-quality';
import { parseRecording } from '../../dashboard/recorder';
import { mapRecording, readAssertions, readEvidence } from '../from-recording';
import { ACCEPTED_DIR } from '../../dashboard/recorder';
import {
  declaredSelectors, readAllPageKnowledge, selectorTokens, type PageKnowledge,
} from '../../knowledge/page-knowledge';
import { buildIndex } from '../../knowledge/index';
import {
  classify, effectiveLocator, insideRepeatedContainer, structuralSignature,
} from './classify';
import {
  parameterisationHolds, parameterNameFor, parameterSourceOf, templateFor, validateCandidate,
} from './validate';
import { componentClassNameFor, methodNameForTarget, parameterisedNameFor } from './naming';
import {
  refuse, type Category, type Proposal, type ProposalStatus, type Refusal, type RefusalCode,
  type TargetRole,
} from './types';

const ROOT = process.cwd();
export const RECORDINGS_DIR = path.join(ROOT, 'ai', 'dashboard', 'recordings');
export const LEDGER = path.join(ROOT, 'ai', 'reports', 'abstraction-proposals.jsonl');

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
}

export function resolveOwner(
  evidence: TargetEvidence,
  knowledge: PageKnowledge[],
  routes: string[],
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
    const page = knowledge.find(entry => routeMatches(entry.route || '/', specific[0]));
    if (!page) {
      return { owner: null, kind: null, code: 'OWNER_UNKNOWN', candidates: [],
        why: `no knowledge file declares route ${specific[0]}` };
    }

    // ONE ROUTE CAN HAVE TWO OWNERS, and picking the first declared is not a rule -
    // it is the order somebody typed the file in. `bugasura__apps.yaml` describes
    // both WorkspacePage (the tab strip, the chrome) and ProjectsPage (the list and
    // its dialogs); a target on /apps belongs to one of them and the route alone
    // does not say which. Refused, and the choice is put to a person.
    const owners = [...new Set(page.elements
        .map(element => element.page_object)
        .filter((owner): owner is string => Boolean(owner)))];
    if (owners.length === 1)
      return { owner: owners[0], kind: 'page-object', why: `the action happened on ${specific[0]} (${page.file})` };
    return {
      owner: null,
      kind: null,
      code: owners.length > 1 ? 'AMBIGUOUS_OWNERSHIP' : 'OWNER_UNKNOWN',
      candidates: owners,
      why: `${page.file} declares ${owners.length} owners for ${specific[0]} (${owners.join(', ')}) - `
        + 'the route does not say which owns this element',
    };
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
 * The method that already wraps THIS element, whatever it happens to be called.
 *
 * Duplicate detection used to ask one question - is this NAME taken on this class? -
 * and that misses the duplicate that matters. `#filter-value` is already
 * `IssuesPage.searchField()`, declared under `accessible_name: Search`; a proposal
 * derived the name `filterValue` from the id instead, found no clash, and was one
 * accepted ownership answer away from putting a second method on the same element.
 * Two methods for one control is the thing this engine exists to prevent, and a name
 * comparison cannot see it.
 *
 * MATCHED ON THE ELEMENT, NOT THE PATH. Only the template's LAST concrete token is
 * compared - the one naming the element the method returns. Comparing every token
 * would make any row-scoped capability a duplicate of `result_rows`, which declares
 * the row container they all sit in.
 *
 * The entry must name a method that really exists on its class: a knowledge entry
 * pointing at a method nobody wrote is not a capability, and treating it as one would
 * refuse a proposal in favour of something uncallable.
 */
function existingCapability(
  template: string | null,
  knowledge: PageKnowledge[],
  index: ReturnType<typeof buildIndex>,
): { owner: string; method: string; file: string } | null {
  // The SAME tokeniser the knowledge side uses, so the two lists are comparable. It
  // strips method calls first, or `.filter` and `.locator` read as class selectors and
  // any two chained expressions "match" on one of them.
  const tokens = selectorTokens(template ?? '');
  const own = tokens[tokens.length - 1];
  if (!own)
    return null;
  for (const page of knowledge) {
    for (const element of page.elements) {
      const owner = element.page_object;
      const method = element.page_object_method;
      if (!owner || !method || !index.pages[owner]?.methods.some(entry => entry.name === method))
        continue;
      const declared = declaredSelectors(element);
      if (declared.includes(own))
        return { owner, method, file: page.file };
    }
  }
  return null;
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
  const index = buildIndex();
  const proposals: Proposal[] = [];
  const reused: CorpusResult['reused'] = [];
  const unmeasured: UnmeasuredTarget[] = [];
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
  if (fs.existsSync(RECORDINGS_DIR)) {
    for (const name of fs.readdirSync(RECORDINGS_DIR).filter(file => file.endsWith('.spec.ts')).sort())
      sources.push({ testCaseId: path.basename(name, '.spec.ts'), dir: RECORDINGS_DIR });
  }
  if (options.includeArchived && fs.existsSync(ACCEPTED_DIR)) {
    const live = new Set(sources.map(entry => entry.testCaseId));
    for (const name of fs.readdirSync(ACCEPTED_DIR).filter(file => file.endsWith('.spec.ts')).sort()) {
      const testCaseId = path.basename(name, '.spec.ts');
      // A live recording always wins: it is the one waiting to be generated, and the
      // archived copy is the previous answer to the same question.
      if (!live.has(testCaseId))
        sources.push({ testCaseId, dir: ACCEPTED_DIR });
    }
  }

  for (const source of sources) {
    const { testCaseId, dir } = source;
    const archived = dir === ACCEPTED_DIR;
    const recording = parseRecording(fs.readFileSync(path.join(dir, `${testCaseId}.spec.ts`), 'utf8'), {
      startUrl: '', browser: '', durationMs: 0,
      evidence: readEvidence(testCaseId, { archived }),
      stateAssertions: readAssertions(testCaseId, { archived }),
    });
    const mapping = mapRecording(recording);

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
      const owner = resolveOwner(evidence, knowledge, [route]);
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
      if (parameterised && signature) {
        members.push({
          signature, role, testCaseId, from: item.from,
          owner: owner.owner, ownerWhy: owner.why,
          ownerCode: owner.code, ownerCandidates: owner.candidates,
          value: parameterSource, proven: safety.safe && effective.proven,
          node: evidence.target, strategy: safety.proof?.strategy ?? 'contextual',
          expression: effective.expression, refusals: safety.codes,
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
      if (status !== 'REFUSED' && !refusals.some(entry => entry.class === 'SAFETY')) {
        const already = existingCapability(safety.proof?.expression ?? null, knowledge, index);
        if (already && already.method !== method) {
          status = 'REUSE';
          refusals.push(refuse('METHOD_EXISTS',
              `${already.owner}.${already.method}() already wraps this element (${already.file})`));
        }
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
      : { holds: false, reason: `no member of this group is identity-proven (${excluded} set aside)` };
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
      const already = existingCapability(template, knowledge, index);
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

  return { proposals, reused, unmeasured, counts };
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

function main(): void {
  const dry = process.argv.includes('--dry');
  const result = analyseCorpus();
  const byStatus: Record<string, number> = {};
  for (const proposal of result.proposals)
    byStatus[proposal.status] = (byStatus[proposal.status] ?? 0) + 1;

  process.stdout.write('\nabstraction engine - phase 1 (report only, no model, nothing written to source)\n\n');
  process.stdout.write(`  recordings analysed      ${fs.existsSync(RECORDINGS_DIR)
    ? fs.readdirSync(RECORDINGS_DIR).filter(name => name.endsWith('.spec.ts')).length : 0}\n`);
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
  process.stdout.write(`\n  ledger: ${path.relative(ROOT, LEDGER).replace(/\\/g, '/')}\n`);
}

if (process.argv[1] && /propose\.ts$/.test(process.argv[1]))
  main();
