/**
 * What happened to the Page Object question, for EVERY element of one generation.
 *
 * THE DEFECT THIS EXISTS TO MAKE IMPOSSIBLE. The engine used to have one silent exit -
 * `if (!evidence) continue` in `analyseCorpus` - and a whole-recording one beside it.
 * An element that left through either produced no proposal, no refusal and no count,
 * and then appeared downstream as `PAGE OBJECT REQUIRED` with a raw locator. Measured
 * over the corpus: 225 raw locators, of which 87 had never been evaluated at all. From
 * the report those 87 were indistinguishable from the 138 that HAD been evaluated and
 * correctly refused, which is the worst property a report can have - it made a coverage
 * hole look like a considered decision.
 *
 * So every element that needed a Page Object now ends at exactly one disposition, and
 * "nobody looked" is not one of the values it can take.
 *
 * WHAT THIS MODULE IS NOT. It decides nothing. Every disposition here is READ from a
 * decision another module already made and recorded - the proposal's status, the
 * writer's outcome, the resolver's audit, the unmeasured list. It is a join and a
 * vocabulary, deliberately, because a second place that could decide whether an
 * element is safe to wrap is a second place that could disagree with `validate.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { MappedStep, MappingResult } from '../from-recording';
import type { UnmeasuredTarget } from './propose';
import type { Proposal, RefusalCode } from './types';
import type { WriteResult } from './writer';

const ROOT = process.cwd();
export const LIFECYCLE_LOG = path.join(ROOT, 'ai', 'reports', 'page-object-lifecycle.jsonl');

/**
 * Where a Page Object-required element ended up.
 *
 * SIX VALUES, ALL TERMINAL, NONE OF THEM A REVIEW QUEUE. `NEEDS_REVIEW` is
 * deliberately absent: it was the state that asked a person to make a decision the
 * framework had all the evidence to make, and the two that replaced it -
 * `PO_CREATED_BY_AI` for the ambiguity a resolver settles, and
 * `REFUSED_NO_ADMISSIBLE_EVIDENCE` for the evidence nothing can conjure - are both
 * decisions the framework made and can show its working for.
 *
 * The sixth, `REFUSED_WRITER_BLOCKED`, was added because the fifth was being used to
 * report something it is not: a proposal whose evidence was proven and whose validation
 * passed, which the WRITER did not persist. Blaming the evidence for that sent a reader
 * to re-record work that was already correct.
 */
export type Disposition =
  /** A method already described this element. The best case, and the cheapest. */
  | 'EXISTING_PO_REUSED'
  /** Every gate passed with no ambiguity, so the method was written without a model. */
  | 'PO_CREATED_DETERMINISTICALLY'
  /** A resolver settled a question about meaning, and the answer validated first time. */
  | 'PO_CREATED_BY_AI'
  /** The first answer failed deterministic validation; a repaired one passed it. */
  | 'AI_REPAIRED_AND_ACCEPTED'
  /**
   * No admissible evidence, so no method - and re-recording is the only route.
   *
   * Covers every SAFETY refusal: nothing measured this element, the measurement does
   * not prove identity, the locator narrows by a position or a generated id. These are
   * NOT weakened to reach a green disposition; the whole point of naming the state is
   * that refusing stays possible while silence does not.
   */
  | 'REFUSED_NO_ADMISSIBLE_EVIDENCE'
  /**
   * The proposal was sound and the WRITER did not persist it - a different state, and
   * calling it "no admissible evidence" was a false statement about the evidence.
   *
   * TC_LOGIN_126 is why it exists. Two proposals the resolver accepted and the
   * validator passed were reported as evidence failures, when the evidence was proven
   * and a THIRD proposal had refused the batch. `diagnostic` says which of the two it
   * was for this element, and `reason` carries the writer's own words.
   */
  | 'REFUSED_WRITER_BLOCKED';

/**
 * WHY a decision came out the way it did, in one word a reader can act on.
 *
 * The disposition says what happened to the element; this says which part of the
 * pipeline decided it, so "no method" stops meaning six different things. Null on the
 * paths where the disposition is already the whole answer - a reuse, a creation, or a
 * recorder-owned overlay, whose reason names itself.
 */
export type LifecycleDiagnostic =
  /** A locator-safety gate refused: a generated id, a position, a forbidden mechanism. */
  | 'SAFETY_REFUSED'
  /** Nothing measured this element, or nothing measured proves which element it is. */
  | 'EVIDENCE_INSUFFICIENT'
  /** The route or the container does not say which Page Object owns it. */
  | 'OWNERSHIP_AMBIGUOUS'
  /** A semantic question was asked and not settled, or the answer did not validate. */
  | 'PROPOSAL_REJECTED'
  /** THIS proposal was refused by the writer, and `reason` is the writer's own text. */
  | 'WRITER_BLOCKED'
  /** This proposal was sound; another in the same run refused the all-or-nothing batch. */
  | 'BATCH_ROLLED_BACK'
  /** The capability was already on disk, so there was nothing to write. */
  | 'ALREADY_APPLIED';

/** One element, one decision, with everything a person needs to check it. */
export interface LifecycleDecision {
  testCaseId: string;
  /** Ties every decision of one generation together. */
  generationId: string;
  timestamp: string;
  /** The step's join key: `click Close`, `assert checked 639978`. */
  from: string;
  target: string;
  role: 'action' | 'assertion';
  disposition: Disposition;
  /**
   * Which part of the pipeline decided, when the disposition alone does not say.
   *
   * Additive: every existing reader ignores it, and a decision that needs no
   * explanation carries null.
   */
  diagnostic: LifecycleDiagnostic | null;
  /** Which half of the architecture answered. `none` means no question was needed. */
  resolver: 'deterministic' | 'ai' | 'none';
  /** Resolver attempts spent. 0 on every deterministic path. */
  attempts: number;
  /** The logical component, when one was identified. */
  component: string | null;
  pageObject: string | null;
  method: string | null;
  parameters: string[];
  evidenceStatus: 'measured' | 'no-measurement' | 'no-sidecar';
  validationStatus: 'passed' | 'failed' | 'not-attempted';
  reason: string;
  /** The only thing that would change the answer. Null when nothing needs to. */
  remedy: string | null;
  refusalCodes: RefusalCode[];
  /** The abstraction this element belongs to, when it has one. */
  fingerprint: string | null;
}

export interface LifecycleInput {
  testCaseId: string;
  generationId: string;
  timestamp: string;
  mapping: MappingResult;
  /** Proposals AFTER the semantic pass and the writer have run. */
  proposals: readonly Proposal[];
  unmeasured: readonly UnmeasuredTarget[];
  /** What the writer actually did. Absent when nothing was applied. */
  writes?: readonly WriteResult[];
}

/** The step kinds that mean "no Page Object method describes this element". */
const REQUIRES_PAGE_OBJECT: ReadonlySet<MappedStep['kind']> =
  new Set(['codegen-locator', 'needs-review', 'unresolved']);

/**
 * How a proposal that reached the writer should be reported.
 *
 * Reads `resolvedBy` and the audit rather than re-deriving anything: whether a model
 * was involved, and whether it took more than one attempt, are facts the resolver
 * already recorded, and recomputing them here would be a second opinion about history.
 */
function creationDisposition(proposal: Proposal): Disposition {
  if (proposal.resolvedBy !== 'ai')
    return 'PO_CREATED_DETERMINISTICALLY';
  return proposal.semantic?.repaired ? 'AI_REPAIRED_AND_ACCEPTED' : 'PO_CREATED_BY_AI';
}

/**
 * Was this proposal's method actually written, or only proposed?
 *
 * `WriteResult.outcome` is decided BEFORE anything reaches disk and is never revised,
 * so a rolled-back run still carries `APPLIED`. `written` is the flag that is set after
 * the verify passes, which makes it the only honest answer to "does this method exist?"
 * - and reporting a rolled-back write as a creation is exactly the bug this avoids.
 */
function wasWritten(proposal: Proposal, writes: readonly WriteResult[] | undefined): boolean | null {
  const mine = writes?.find(entry => entry.proposal.fingerprint === proposal.fingerprint);
  if (!mine)
    return null;
  return mine.written || mine.outcome === 'ALREADY_APPLIED';
}

/**
 * WHY this proposal has no method, when the writer is the reason - in the writer's own
 * words, never a summary of them.
 *
 * The information was always there: `WriteResult` carries `outcome` and `problems`, and
 * `decideLifecycle` is handed the whole array. It was thrown away and replaced with one
 * sentence - "the writer blocked it or the run rolled back" - which cannot tell a person
 * which of the two happened, let alone which proposal was at fault. For TC_LOGIN_126 the
 * answer was a line the writer had already computed:
 * `no knowledge file declares CreateTeamInviteModal`.
 *
 * TWO STATES, KEPT APART, because the remedy differs. BLOCKED is about THIS element and
 * is fixed here. BATCH_ROLLED_BACK is about a DIFFERENT element - this one was sound -
 * so the remedy is elsewhere, and saying so is the difference between one fix and three
 * people re-recording good work. The all-or-nothing policy is not touched: it is
 * deliberate, and this only reports it accurately.
 */
function writerVerdict(
  proposal: Proposal,
  writes: readonly WriteResult[] | undefined,
): { diagnostic: LifecycleDiagnostic; reason: string; remedy: string } | null {
  const mine = writes?.find(entry => entry.proposal.fingerprint === proposal.fingerprint);
  if (!mine)
    return null;

  if (mine.outcome === 'BLOCKED') {
    return {
      diagnostic: 'WRITER_BLOCKED',
      reason: `the writer refused this proposal: ${mine.problems.join('; ') || 'no reason recorded'}`,
      remedy: 'Resolve what the writer named above; nothing about the evidence needs to change.',
    };
  }

  // SOUND, AND NOT WRITTEN. Name the proposal that refused the batch and what it said,
  // then the others that went down with it - the whole of what a reader needs, and none
  // of what they could previously see.
  const blockers = (writes ?? []).filter(entry => entry.outcome === 'BLOCKED');
  const alsoAffected = (writes ?? [])
      .filter(entry => entry.outcome !== 'BLOCKED'
        && entry.proposal.fingerprint !== proposal.fingerprint
        && !entry.written)
      .map(entry => `${entry.proposal.owner}.${entry.proposal.method}()`);
  const named = blockers
      .map(entry => `${entry.proposal.owner}.${entry.proposal.method}() - ${entry.problems.join('; ')}`)
      .join(' | ');
  return {
    diagnostic: 'BATCH_ROLLED_BACK',
    reason: 'this proposal validated and was not written: the writer is all-or-nothing and '
      + (blockers.length
        ? `${blockers.length} other proposal(s) in this run did not validate (${named})`
        : 'the run was rolled back after writing')
      + (alsoAffected.length ? `; also affected: ${alsoAffected.join(', ')}` : ''),
    remedy: blockers.length
      ? 'Fix the blocking proposal named above and re-run; this element needs nothing.'
      : 'Re-run generation; this element needs nothing.',
  };
}

/**
 * Join every Page Object-required element of one generation to its decision.
 *
 * THE JOIN KEY IS THE STEP'S `from`, which is the same string `analyseCorpus` records
 * in `Proposal.sightings` and in every `UnmeasuredTarget`. It is the recorded action's
 * own label, so it survives the locator being rewritten by the resolver - which the
 * step's emitted code does not, and which is why joining on the locator found nothing
 * for exactly the elements this phase is about.
 */
export function decideLifecycle(input: LifecycleInput): LifecycleDecision[] {
  const { testCaseId, generationId, timestamp } = input;
  const mapping = { ...input.mapping, steps: input.mapping.steps.flatMap(step => step.components ?? [step]) };
  const decisions: LifecycleDecision[] = [];

  const base = (step: MappedStep): Pick<LifecycleDecision,
  'testCaseId' | 'generationId' | 'timestamp' | 'from' | 'target' | 'role'> => ({
    testCaseId, generationId, timestamp,
    from: step.from,
    target: step.label,
    role: step.from.startsWith('assert ') ? 'assertion' : 'action',
  });

  // 1. RESOLVED TO A METHOD. Usually that means an existing one described the element -
  //    the outcome the whole lifecycle is trying to reach, and the only one that costs
  //    nothing.
  //
  //    BUT NOT ALWAYS, AND THE DIFFERENCE IS THE POINT OF THE PHASE. `ensurePageObjects`
  //    runs BEFORE the spec is assembled, so a method created for THIS recording already
  //    exists by the time `mapRecording` looks for it, and the step comes back as an
  //    ordinary reuse. Reporting that as `EXISTING_PO_REUSED` is how the loop closing
  //    would become invisible: the one element the resolver had just resolved would be
  //    indistinguishable from four that were never in question. So a step whose method
  //    was created in this pass reports the CREATION, and reuse means what it says.
  for (const step of mapping.steps) {
    if (step.subject) continue;
    if (step.kind !== 'page-object' || !step.pageObject || !step.method)
      continue;
    const createdHere = input.proposals.find(entry =>
      entry.status === 'PROPOSED'
      && entry.owner === step.pageObject && entry.method === step.method
      && wasWritten(entry, input.writes) === true);
    decisions.push({
      ...base(step),
      disposition: createdHere ? creationDisposition(createdHere) : 'EXISTING_PO_REUSED',
      // Nothing was blocked and no batch was rolled back: this element resolved to a
      // method. `diagnostic` is required on every record precisely so that "no
      // diagnostic" is stated rather than left as a missing key a reader has to guess at.
      diagnostic: null,
      resolver: createdHere ? (createdHere.resolvedBy === 'ai' ? 'ai' : 'deterministic') : 'none',
      attempts: createdHere?.semantic?.attempts.length ?? 0,
      component: step.pageObject,
      pageObject: step.pageObject,
      method: step.method,
      parameters: argumentsOf(step),
      evidenceStatus: 'measured',
      validationStatus: 'passed',
      reason: createdHere
        ? `created in this generation, then used by it: ${step.why}`
        : step.why,
      remedy: null,
      refusalCodes: [],
      fingerprint: createdHere?.fingerprint ?? null,
    });
  }

  // 2. EVERYTHING ELSE. Each one must find a record, and the branch at the end is what
  //    guarantees it - there is no path out of this loop that appends nothing.
  for (const step of mapping.steps) {
    if (step.subject) continue;
    if (step.subject || !REQUIRES_PAGE_OBJECT.has(step.kind))
      continue;

    const proposal = input.proposals.find(entry =>
      entry.sightings.some(sighting =>
        sighting.testCaseId === testCaseId && sighting.from === step.from));

    if (proposal) {
      decisions.push(fromProposal(base(step), proposal, input.writes));
      continue;
    }

    const missing = input.unmeasured.find(entry =>
      entry.testCaseId === testCaseId && entry.from === step.from);
    if (missing) {
      decisions.push({
        ...base(step),
        disposition: 'REFUSED_NO_ADMISSIBLE_EVIDENCE',
        // RECORDER_OWNED names itself and needs no second word; everything else here is
        // the evidence layer having nothing admissible to offer.
        diagnostic: missing.code === 'RECORDER_OWNED_ELEMENT' ? null : 'EVIDENCE_INSUFFICIENT',
        resolver: 'none',
        attempts: 0,
        component: null,
        pageObject: null,
        method: null,
        parameters: [],
        // A recorder-owned element WAS measured - it is refused for what it is, not
        // for want of evidence - so it must not be reported as unmeasured.
        evidenceStatus: missing.code === 'RECORDER_OWNED_ELEMENT'
          ? 'measured'
          : /no DOM evidence sidecar/.test(missing.reason) ? 'no-sidecar' : 'no-measurement',
        validationStatus: 'not-attempted',
        reason: missing.reason,
        remedy: missing.remedy,
        refusalCodes: [missing.code],
        fingerprint: null,
      });
      continue;
    }

    // NO RECORD AT ALL. This is the state the phase exists to eliminate, so it is
    // reported LOUDLY as itself rather than quietly omitted - a decision saying "the
    // engine has no record of this element" is a bug report, and an absent line is not.
    //
    // The commonest legitimate cause is a recording the corpus analyser cannot see
    // (an accepted recording lives in `recordings/accepted/`, which `analyseCorpus`
    // does not scan), so the reason says so rather than guessing.
    decisions.push({
      ...base(step),
      disposition: 'REFUSED_NO_ADMISSIBLE_EVIDENCE',
      diagnostic: 'EVIDENCE_INSUFFICIENT',
      resolver: 'none',
      attempts: 0,
      component: null,
      pageObject: null,
      method: null,
      parameters: [],
      evidenceStatus: 'no-measurement',
      validationStatus: 'not-attempted',
      reason: 'the abstraction engine holds no record for this element - it produced neither a '
        + 'proposal nor an unmeasured entry, which happens when the recording is outside the '
        + 'corpus the analyser scans',
      remedy: 'Re-record required.',
      refusalCodes: ['NO_ADMISSIBLE_EVIDENCE'],
      fingerprint: null,
    });
  }

  return decisions;
}

/** The decision a proposal already carries, expressed in lifecycle vocabulary. */
function fromProposal(
  head: Pick<LifecycleDecision, 'testCaseId' | 'generationId' | 'timestamp' | 'from' | 'target' | 'role'>,
  proposal: Proposal,
  writes: readonly WriteResult[] | undefined,
): LifecycleDecision {
  const attempts = proposal.semantic?.attempts.length ?? 0;
  const codes = proposal.refusalCodes.map(entry => entry.code);
  const shared = {
    ...head,
    component: proposal.semantic?.methodName ?? proposal.derivedMethod ?? proposal.owner,
    pageObject: proposal.owner,
    parameters: proposal.parameterName ? [proposal.parameterName] : [],
    evidenceStatus: 'measured' as const,
    refusalCodes: codes,
    fingerprint: proposal.fingerprint,
    resolver: (proposal.resolvedBy === 'ai' ? 'ai' : 'deterministic') as 'ai' | 'deterministic',
    attempts,
  };

  if (proposal.status === 'REUSE') {
    return {
      ...shared,
      disposition: 'EXISTING_PO_REUSED',
      diagnostic: null,
      method: proposal.method,
      validationStatus: 'passed',
      reason: proposal.refusals[0] ?? proposal.reason,
      remedy: null,
    };
  }

  if (proposal.status === 'PROPOSED') {
    const written = wasWritten(proposal, writes);
    if (written === false) {
      // PROPOSED AND NOT WRITTEN. Saying "created" here is the claim the orchestrator
      // used to make; saying "no admissible evidence" was the claim that replaced it,
      // and it was equally untrue - the evidence was proven and the WRITER is the
      // reason. `writerVerdict` reports which writer state it was, in the writer's own
      // words, and the disposition no longer blames the evidence for it.
      const verdict = writerVerdict(proposal, writes);
      return {
        ...shared,
        disposition: 'REFUSED_WRITER_BLOCKED',
        diagnostic: verdict?.diagnostic ?? 'WRITER_BLOCKED',
        method: null,
        // THE PROPOSAL VALIDATED. What failed is persistence, and recording that as a
        // validation failure is what made three sound proposals look like bad evidence.
        validationStatus: 'passed',
        reason: verdict?.reason
          ?? 'the method validated but was not written, and the writer recorded no result for it',
        remedy: verdict?.remedy ?? 'Re-run generation; if it repeats, read the writer\'s problems.',
      };
    }
    return {
      ...shared,
      disposition: creationDisposition(proposal),
      // ALREADY_APPLIED is not a failure: the capability was on disk, so nothing needed
      // writing. It is still worth saying, because "created" and "was already there"
      // are different facts about the same green outcome.
      diagnostic: wasWritten(proposal, writes) === true
        && (writes ?? []).find(entry => entry.proposal.fingerprint === proposal.fingerprint)
            ?.outcome === 'ALREADY_APPLIED'
        ? 'ALREADY_APPLIED' : null,
      method: proposal.method,
      validationStatus: 'passed',
      reason: proposal.semantic?.attempts.slice(-1)[0]?.rejection
        ? `accepted after ${attempts} resolver attempt(s)`
        : proposal.reason,
      remedy: null,
    };
  }

  // REFUSED and NEEDS_REVIEW alike land here, and both report the SAME disposition on
  // purpose. A refusal is a decision; a line still marked NEEDS_REVIEW after the
  // resolver has run is one the resolver could not settle, which is the same terminal
  // answer arrived at more expensively. The codes below say which it was, so nothing
  // is lost by giving them one name - and the name is the one that tells a person the
  // only thing they can act on.
  const safety = proposal.refusalCodes.filter(entry => entry.class === 'SAFETY');
  // WHICH GATE DECIDED, from the codes the proposal already carries. Ordered by what a
  // reader can act on: an evidence problem needs a re-recording, an ownership one needs
  // a knowledge declaration, and everything else is a question the resolver could not
  // settle. Nothing here changes a decision - it names the one already made.
  const codeSet = new Set(codes);
  const diagnostic: LifecycleDiagnostic = codeSet.has('NO_PRESS_TIME_PROOF')
    ? 'EVIDENCE_INSUFFICIENT'
    : safety.length
      ? 'SAFETY_REFUSED'
      : codeSet.has('AMBIGUOUS_OWNERSHIP')
        ? 'OWNERSHIP_AMBIGUOUS'
        : 'PROPOSAL_REJECTED';
  return {
    ...shared,
    disposition: 'REFUSED_NO_ADMISSIBLE_EVIDENCE',
    diagnostic,
    method: null,
    validationStatus: attempts ? 'failed' : 'not-attempted',
    reason: proposal.refusals.join(' | ') || proposal.reason,
    remedy: safety.length
      ? 'Re-record required / insufficient admissible evidence.'
      : 'No admissible abstraction; the element keeps its measured locator.',
  };
}

/** The arguments a reused step passes, read from the emitted code rather than guessed. */
function argumentsOf(step: MappedStep): string[] {
  const call = new RegExp(`\\.${step.method}\\(([^)]*)\\)`).exec(step.code.join(' '));
  const args = (call?.[1] ?? '').trim();
  return args ? [args] : [];
}

/* ------------------------------------------------------------------ reporting */

export interface LifecycleSummary {
  total: number;
  byDisposition: Record<Disposition, number>;
  /** Elements with no method, which is what `PAGE OBJECT REQUIRED` used to count. */
  withoutPageObject: number;
  resolverAttempts: number;
}

export function summarise(decisions: readonly LifecycleDecision[]): LifecycleSummary {
  const byDisposition = {
    EXISTING_PO_REUSED: 0, PO_CREATED_DETERMINISTICALLY: 0, PO_CREATED_BY_AI: 0,
    AI_REPAIRED_AND_ACCEPTED: 0, REFUSED_NO_ADMISSIBLE_EVIDENCE: 0,
    REFUSED_WRITER_BLOCKED: 0,
  } as Record<Disposition, number>;
  let resolverAttempts = 0;
  for (const decision of decisions) {
    byDisposition[decision.disposition]++;
    resolverAttempts += decision.attempts;
  }
  return {
    total: decisions.length,
    byDisposition,
    withoutPageObject: byDisposition.REFUSED_NO_ADMISSIBLE_EVIDENCE,
    resolverAttempts,
  };
}

/** The per-element block a person reads under a generation's log. */
export function describeLifecycle(decisions: readonly LifecycleDecision[]): string {
  if (!decisions.length)
    return '';
  const summary = summarise(decisions);
  const lines = [`      PAGE OBJECT LIFECYCLE (${summary.total} element(s)):`];
  for (const [disposition, count] of Object.entries(summary.byDisposition)) {
    if (count)
      lines.push(`        ${count.toString().padStart(3)}  ${disposition}`);
  }
  const refused = decisions.filter(entry => entry.disposition === 'REFUSED_NO_ADMISSIBLE_EVIDENCE');
  for (const entry of refused.slice(0, 8)) {
    lines.push(`        - ${entry.from}: ${entry.reason.slice(0, 120)}`);
    if (entry.remedy)
      lines.push(`          ${entry.remedy}`);
  }
  if (refused.length > 8)
    lines.push(`        ... and ${refused.length - 8} more, all in ${path.basename(LIFECYCLE_LOG)}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Append this generation's decisions, one JSON line each.
 *
 * Append-only so a killed run cannot corrupt earlier ones, and never thrown from: a
 * report that stops a generation is worse than a generation with no report.
 */
export function appendLifecycleLog(
  decisions: readonly LifecycleDecision[],
  file = LIFECYCLE_LOG,
): void {
  if (!decisions.length)
    return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${decisions.map(entry => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`(page-object lifecycle not recorded: ${(error as Error).message})\n`);
  }
}

/** Every decision recorded for one generation, newest first. Torn lines are skipped. */
export function readLifecycleLog(file = LIFECYCLE_LOG): LifecycleDecision[] {
  if (!fs.existsSync(file))
    return [];
  const decisions: LifecycleDecision[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim())
      continue;
    try {
      decisions.push(JSON.parse(line) as LifecycleDecision);
    } catch {
      // A torn last line from a killed run. Skipped, never repaired.
    }
  }
  return decisions;
}
