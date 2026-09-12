/**
 * The one place a model is allowed to influence an abstraction decision.
 *
 *   npx tsx ai/autocode/abstraction/semantic.ts --dry   # what WOULD be asked, ask nothing
 *
 * IT IS A POST-PASS, NOT A STAGE. `analyseCorpus()` is unchanged, still synchronous
 * and still contains no model call; this runs afterwards over its output. So the
 * deterministic engine's answer exists in full before anything is asked, and the
 * normal path - REUSE, REUSE_PARAMETERIZED, a deterministically safe new Page Object
 * - never reaches this file at all.
 *
 * WHAT A MODEL MAY DECIDE. One semantic question, chosen by the framework, from a
 * closed list: who owns this, what is it called, is this one reusable capability.
 * Questions about MEANING, which the DOM does not answer.
 *
 * WHAT IT MAY NOT DECIDE. Anything measured. The press-time proof, the identity
 * match, the document, the match count, the dynamic-id verdict, the forbidden
 * mechanisms - and, above all, the locator. A recommendation arrives as a few words
 * and a name; the expression a method returns is built by `templateFor` from
 * evidence the recorder measured, and if the model returns a locator at all it is
 * compared and used for nothing else. A model that disagrees with the deterministic
 * template rejects its own recommendation.
 *
 * THE GATE RUNS AGAIN AFTERWARDS, and this is the whole design. A recommendation
 * clears exactly ONE refusal - the one it was asked about, by code - and the
 * proposal is then re-checked against every other rule as though the model had never
 * spoken. Anything still refusing sends it back to review.
 */

import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';

import { resolveClaude, resolveModel } from '../agent';
import { buildIndex } from '../../knowledge/index';
import { looksLikeSecretValue } from '../dom-evidence';
import { analyseIdentifier } from '../locator-quality';
import { classDerivedName, parameterNameFor, parameterSourceOf, templateFor } from './validate';
import {
  refuse, refusalsOfClass, type Proposal, type Refusal, type RefusalCode, type SemanticAudit,
} from './types';
import type { CorpusResult } from './propose';

const ROOT = process.cwd();
export const AUDIT_LOG = path.join(ROOT, 'ai', 'reports', 'abstraction-semantic.jsonl');

/**
 * The semantic questions a model is trusted with, and no others.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A WEAKENING. Three of these were previously
 * refused, and the reason each was refused has been REMOVED rather than overruled:
 *
 * - `TEXT_ONLY_IDENTITY` was refused because "there is still no expression to wrap
 *   that is not the data". That is true of only half the cases, and the half is
 *   exactly what the question now asks about. `filter({ hasText: "Cancel" })` and
 *   `filter({ hasText: "All Issues" })` name a CONTROL by its printed label;
 *   `filter({ hasText: "Faclon labs" })` names a row by its data. The DOM cannot tell
 *   them apart - both are a string in the same position of the same shape - and that
 *   is the definition of a semantic question. The answer is then held to a
 *   deterministic standard either way: a LABEL must survive the credential and
 *   identifier tests and is wrapped verbatim; DATA must yield a template that
 *   round-trips to the measured expression, or it is refused. Nothing is invented in
 *   either branch, because `templateFor` splits the expression the recorder measured.
 *
 * - `AMBIGUOUS_NAME` was refused because the entry would declare
 *   `accessible_name: Close` and `findMethod` matches that PAGE-WIDE, so all five
 *   `Close` buttons in this corpus would bind to the notification panel's locator.
 *   That defect was real and was rolled back. It is now fixed STRUCTURALLY:
 *   `Proposal.accessibleNameAmbiguous` is computed from the corpus before anything is
 *   asked, and `renderKnowledgeEntry` omits `accessible_name` entirely when it is set.
 *   The entry can no longer be keyed on the shared name, so there is nothing left to
 *   bind wrongly, and the method is reached by `findMethodByProvenLocator` on the
 *   exact expression the recorder measured. `revalidate` still refuses the answer
 *   unless that flag is set and a template exists - the guard did not go away, it
 *   changed from "never" to "only when the binding hazard has been removed".
 *
 * - `UNCLASSIFIED_TARGET` / `CONTAINER_OR_CAPABILITY` ask whether an element is a
 *   capability worth a method or a container that merely holds one. Both answers are
 *   terminal and neither invents anything: a capability goes through every gate
 *   unchanged, and "it is a container" is a decision, recorded as such, not a review.
 *
 * `SINGLE_TARGET` remains absent, and it is the one that stays absent. It says one
 * sighting cannot support parameterisation, which is a claim about the SIZE OF THE
 * SAMPLE rather than about meaning - and a confident model extrapolates from one
 * example as readily as an unconfident one. The corpus answers that question by
 * containing a second sighting or not containing one; judgement cannot substitute.
 */
export const SEMANTIC_ENABLED: readonly RefusalCode[] = [
  'AMBIGUOUS_OWNERSHIP',
  'NO_METHOD_NAME',
  'CONSTANT_PARAMETER_VALUE',
  'TEXT_ONLY_IDENTITY',
  'UNCLASSIFIED_TARGET',
  'CONTAINER_OR_CAPABILITY',
  'AMBIGUOUS_NAME',
];

/**
 * How many times one proposal may be put to a resolver: the question, then repairs.
 *
 * A repair is a second attempt at the SAME question with the validator's verbatim
 * rejection attached - never a second, laxer standard, because `revalidate` runs
 * unchanged on every attempt. Three is where the corpus stopped improving: a resolver
 * that has been told twice what is wrong and still answers wrongly is answering a
 * question it cannot answer, and a fourth call buys a repeat of the third.
 */
export const MAX_RESOLVER_ATTEMPTS = 3;

/** What a resolver is allowed to answer. Anything else is malformed. */
export const DECISIONS = ['CREATE_PAGE_OBJECT', 'REUSE_EXISTING', 'PARAMETERIZE', 'NEEDS_REVIEW'] as const;
export type Decision = (typeof DECISIONS)[number];

export interface Recommendation {
  decision: Decision;
  owner: string | null;
  methodName: string | null;
  usage: string | null;
  parameterName: string | null;
  locatorTemplate: string | null;
  reasoning: string;
  confidence: number | null;
  /** The logical component the element belongs to. Recorded, never binding. */
  component: string | null;
  /** One clause for the knowledge entry's `description`. Sanitised before use. */
  semanticDescription: string | null;
  /**
   * `LABEL` or `DATA`, on a TEXT_ONLY_IDENTITY question. Null everywhere else.
   *
   * The ONLY field on this interface that changes what is built rather than what it is
   * called - LABEL wraps the measured expression as it stands, DATA must produce a
   * round-tripping template - which is why `revalidate` re-derives the template itself
   * rather than trusting the answer.
   */
  textKind: 'LABEL' | 'DATA' | null;
}

export interface Eligibility {
  eligible: boolean;
  /**
   * Every code a model would be authorised to clear, in the order they are put to it.
   *
   * A LIST, not one code. An element can carry more than one question about meaning at
   * once - who owns this, what is it called, is that string a label or a value - and
   * asking them one exchange at a time costs a model call each, lets two answers
   * contradict one another, and leaves the proposal in review after the first
   * clearance anyway because the second refusal still stands. One exchange produces
   * one coherent component model, and `revalidate` then checks all of it together.
   */
  codes: RefusalCode[];
  why: string;
}

/**
 * May a model be asked about this proposal at all?
 *
 * Decided on codes, never on wording, and the SAFETY test comes first so that a
 * proposal carrying both a safety refusal and a semantic one is never asked about -
 * a dynamic id with a naming question is a dynamic id.
 */
export function eligibility(proposal: Proposal): Eligibility {
  const no = (why: string): Eligibility => ({ eligible: false, codes: [], why });

  if (proposal.status !== 'NEEDS_REVIEW')
    return no(`status is ${proposal.status}, not NEEDS_REVIEW`);

  const safety = refusalsOfClass(proposal.refusalCodes, 'SAFETY');
  if (safety.length)
    return no(`${safety.length} safety refusal(s): ${safety.map(entry => entry.code).join(', ')}`);

  const structural = refusalsOfClass(proposal.refusalCodes, 'STRUCTURAL');
  if (structural.length)
    return no(`${structural.length} structural refusal(s): ${structural.map(entry => entry.code).join(', ')}`);

  const semantic = refusalsOfClass(proposal.refusalCodes, 'SEMANTIC');
  if (!semantic.length)
    return no('no semantic refusal to resolve');

  // EVERY OPEN QUESTION MUST BE ONE A RESOLVER MAY BE ASKED - not merely one of them.
  //
  // Clearing a subset would leave the rest standing, `revalidate` would refuse the
  // whole recommendation for the refusals it was not authorised to clear, and the
  // model call would have been spent to learn something the eligibility test already
  // knew. So a proposal carrying one askable question and one unaskable one is not
  // asked at all, and says which one stopped it.
  const codes = semantic.map(entry => entry.code);
  const unaskable = codes.filter(code => !SEMANTIC_ENABLED.includes(code));
  if (unaskable.length)
    return no(`${unaskable.join(', ')} is not a question a resolver may be asked`);

  // Belt and braces: the proof is what makes this proposal worth a question, so it
  // is re-read here rather than inferred from the absence of a safety refusal.
  const proof = proposal.proof;
  const proven = proof?.matchCount === 1 && proof.identityMatched === true
    && proof.sameDocument === true && proof.measuredAt === 'press';
  if (!proven)
    return no('press-time proof is not present on this proposal');

  return {
    eligible: true,
    codes: [...new Set(codes)],
    why: `${codes.length} semantic question(s): ${[...new Set(codes)].join(', ')}`,
  };
}

/* ----------------------------------------------------------------- the prompt */

/** What each code asks, in the words a resolver reads. */
const QUESTIONS: Partial<Record<RefusalCode, string>> = {
  AMBIGUOUS_OWNERSHIP: 'Which of the listed Page Object classes owns this element?',
  AMBIGUOUS_NAME: 'This element\'s accessible name is shared by several structurally different '
    + 'elements, so the generated knowledge entry will NOT declare it and the method will be '
    + 'found by its measured locator instead. Given that, what should this capability be called?',
  NO_METHOD_NAME: 'What should this reusable capability\'s method be called?',
  CONSTANT_PARAMETER_VALUE: 'Every recorded example of this element used the SAME value, so the '
    + 'deterministic engine cannot tell a reusable parameterised capability from a one-off. '
    + 'Judging by the structure and the template only: is this a reusable capability that '
    + 'should take an argument?',
  TEXT_ONLY_IDENTITY: 'This element is identified by its own printed text. Is that text a LABEL '
    + '(a fixed part of the interface, like "Cancel", "Close" or a section heading) or DATA '
    + '(a value that belongs to one record, like a project name or an issue summary)? '
    + 'Answer with "textKind": "LABEL" or "textKind": "DATA".',
  UNCLASSIFIED_TARGET: 'No deterministic rule classified this element. Is it a reusable capability '
    + 'that deserves a Page Object method, or is it a container that merely holds one?',
  CONTAINER_OR_CAPABILITY: 'This element could be read as a container or as a capability. '
    + 'Which is it? A container gets no method.',
};

/**
 * The questions, the evidence, and nothing a resolver could mistake for a free hand.
 *
 * ONE PROMPT FOR EVERY OPEN QUESTION. The resolver is asked to produce a single
 * coherent component model rather than to answer each refusal in isolation, because
 * the answers constrain one another: which class owns an element bears on what it
 * should be called, and whether its text is a label bears on whether it takes an
 * argument. Splitting them lets two exchanges disagree and costs a call each.
 */
export function buildPrompt(proposal: Proposal, codes: readonly RefusalCode[]): string {
  const owners = proposal.allowedOwners;
  const asked = codes.map((code, index) =>
    `  ${index + 1}. [${code}] ${QUESTIONS[code] ?? 'Resolve this semantic ambiguity.'}`);

  return [
    `You are resolving ${codes.length === 1 ? 'ONE semantic question' : `${codes.length} semantic questions`}`
      + ' for a deterministic test-automation framework.',
    '',
    'You are NOT choosing a locator. The locator and its template were measured by a recorder',
    'against the running application and are fixed. Do not propose, alter or "improve" them.',
    'Do not browse anything. Decide from the evidence below alone.',
    '',
    'QUESTIONS:',
    ...asked,
    '',
    '--- deterministic evidence (measured, not inferred) ---',
    `role (action or assertion) : ${proposal.role}`,
    `category / rule            : ${proposal.category} / rule ${proposal.rule}`,
    `element                    : ${proposal.target}`,
    `accessible name            : ${proposal.accessibleName ?? '(none)'}`,
    `accessible name is shared  : ${proposal.accessibleNameAmbiguous ? 'YES - it will not be declared' : 'no'}`,
    `locator strategy           : ${proposal.locatorStrategy}`,
    `locator template           : ${proposal.template ?? '(none)'}`,
    `parameterised (derived)    : ${proposal.parameterised}`,
    `parameter name (derived)   : ${proposal.parameterName ?? '(none)'}`,
    `method name (derived)      : ${proposal.derivedMethod ?? '(none could be derived)'}`,
    `distinct recorded values   : ${proposal.parameterSource ?? '(n/a)'}`,
    `recorded in                : ${proposal.sightings.length} sighting(s) across the corpus`,
    `press-time proof           : matchCount=${proposal.proof?.matchCount}`
      + ` identityMatched=${proposal.proof?.identityMatched}`
      + ` sameDocument=${proposal.proof?.sameDocument} measuredAt=${proposal.proof?.measuredAt}`,
    `deterministic refusals     : ${proposal.refusals.join(' | ')}`,
    '',
    '--- the ONLY owners you may choose from ---',
    owners.length ? owners.map(owner => `  ${owner}`).join('\n') : '  (none declared)',
    'Returning any other owner rejects your recommendation.',
    '',
    '--- naming rules ---',
    'A method name describes the CAPABILITY, never the test data. camelCase, no digits,',
    'no issue summaries, no project names. Good: issueCheckbox, notificationToggle,',
    'projectCard. Bad: checkbox1749558, clickCopyOfLogin, issueCheckboxForLineChart.',
    'Never name it after a CSS class, an id, an XPath or a position: roundedCheckboxUi,',
    'locator1 and nth0 are all rejected.',
    'An action and an assertion are separate capabilities: the assertion form of',
    'issueCheckbox is issueCheckboxState, and an assertion method name MUST end in State.',
    '',
    'Reply with ONE JSON object and nothing else. No prose, no code fence.',
    '{',
    `  "decision": ${DECISIONS.map(value => `"${value}"`).join(' | ')},`,
    '  "component": "<the logical UI component this element belongs to>",',
    '  "semanticDescription": "<one clause describing what it is, for the knowledge entry>",',
    '  "owner": "<one of the owners listed above, or null>",',
    '  "methodName": "<camelCase capability name, or null>",',
    '  "usage": "action" | "assertion",',
    '  "parameterName": "<argument name, or null>",',
    '  "textKind": "LABEL" | "DATA" | null,',
    '  "locatorTemplate": "<echo the template above verbatim, or null>",',
    '  "reasoning": "<one sentence>",',
    '  "confidence": <0..1>',
    '}',
    'Answer "NEEDS_REVIEW" if the evidence does not settle it. That is a correct answer.',
  ].join('\n');
}

/**
 * The same question again, with the deterministic validator's verdict attached.
 *
 * THE STANDARD DOES NOT MOVE. `revalidate` runs unchanged on a repaired answer, so
 * this prompt exists only to tell the resolver what was actually wrong - which it
 * could not otherwise know, because the rules that rejected it are not all in the
 * first prompt. Restating the rejection verbatim is deliberate: a paraphrase would be
 * a second interpretation of a deterministic result.
 */
export function buildRepairPrompt(
  proposal: Proposal,
  codes: readonly RefusalCode[],
  previous: string,
  rejection: string,
): string {
  return [
    'Your previous recommendation was REJECTED by the framework\'s deterministic validator.',
    'The validator is the final authority; it does not negotiate and its rules have not changed.',
    '',
    '--- what you replied ---',
    previous.trim().slice(0, 1200),
    '',
    '--- why it was rejected (verbatim) ---',
    rejection,
    '',
    'Produce a corrected recommendation that fixes exactly that problem and changes nothing else.',
    'If you cannot fix it within the rules, answer with "decision": "NEEDS_REVIEW" - that is a',
    'correct answer and is better than a recommendation you cannot justify.',
    '',
    '--- the original question and evidence, unchanged ---',
    buildPrompt(proposal, codes),
  ].join('\n');
}

/* ------------------------------------------------------------------ the parse */

/**
 * Strict. A response that is not one well-formed object with a known decision is
 * malformed, and malformed is NEEDS_REVIEW - never a partial reading.
 */
export function parseRecommendation(text: string): { ok: true; value: Recommendation }
| { ok: false; why: string } {
  const trimmed = (text ?? '').trim();
  // A model that wrapped the object in a fence or a sentence is still answerable;
  // one that returned two objects is not, so the LAST balanced object is not sought
  // and the FIRST is taken only when nothing but whitespace and a fence precedes it.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = (fenced ? fenced[1] : trimmed).trim();
  if (!body.startsWith('{') || !body.endsWith('}'))
    return { ok: false, why: 'the response is not a single JSON object' };

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(body) as Record<string, unknown>;
  } catch (error) {
    return { ok: false, why: `the response is not valid JSON: ${(error as Error).message}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, why: 'the response is not a JSON object' };

  const decision = raw.decision;
  if (typeof decision !== 'string' || !DECISIONS.includes(decision as Decision))
    return { ok: false, why: `unknown decision ${JSON.stringify(decision)}` };

  const str = (value: unknown): string | null =>
    (typeof value === 'string' && value.trim() ? value.trim() : null);
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? raw.confidence : null;

  // STRICT ON THE ONE FIELD THAT CHANGES WHAT IS BUILT. Anything other than LABEL or
  // DATA is null rather than a guess, and `revalidate` then refuses the answer for the
  // TEXT_ONLY_IDENTITY question it was supposed to settle - which is the correct
  // outcome for "the resolver did not answer the question".
  const rawKind = (str(raw.textKind) ?? '').toUpperCase();
  const textKind = rawKind === 'LABEL' || rawKind === 'DATA' ? rawKind : null;

  // A RESOLVER THAT REPLIED WITH THE RICHER `methods: [...]` SHAPE IS STILL ANSWERABLE.
  //
  // The framework builds ONE method per proposal - an action and its state form are
  // two proposals, paired deterministically by the `State` naming rule - so a list of
  // methods is read for the entry that matches THIS proposal's usage and the rest is
  // ignored, exactly as an unsolicited name on an ownership question is ignored. It is
  // never allowed to create a second method: nothing downstream reads this field.
  let methodName = str(raw.methodName);
  let parameterName = str(raw.parameterName);
  const usageHint = str(raw.usage);
  if (!methodName && Array.isArray(raw.methods)) {
    const entries = (raw.methods as unknown[]).filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
    const wanted = entries.find(entry => {
      const purpose = (str(entry.purpose) ?? str(entry.usage) ?? '').toLowerCase();
      return purpose === 'interaction' || purpose === 'action'
        ? usageHint !== 'assertion' : purpose === 'state' || purpose === 'assertion'
          ? usageHint === 'assertion' : false;
    }) ?? entries[0];
    if (wanted) {
      methodName = str(wanted.name);
      parameterName = parameterName ?? str(wanted.parameter);
    }
  }

  return { ok: true, value: {
    decision: decision as Decision,
    owner: str(raw.owner),
    methodName,
    usage: usageHint,
    parameterName,
    locatorTemplate: str(raw.locatorTemplate),
    reasoning: str(raw.reasoning) ?? '',
    confidence,
    component: str(raw.component),
    semanticDescription: str(raw.semanticDescription),
    textKind,
  } };
}

/* ------------------------------------------------- deterministic re-validation */

/** A capability name, or why it is not one. Applied to a model's name and our own alike. */
/**
 * Did the recommendation actually answer this question?
 *
 * One field per code, and each one is the field the question asks for. This is what
 * separates "the resolver declined" from "the resolver answered and also had an
 * opinion about something else" - a distinction that cost three transport calls and a
 * good answer before it existed.
 */
export function answers(code: RefusalCode, recommendation: Recommendation): boolean {
  switch (code) {
    case 'TEXT_ONLY_IDENTITY':
      return recommendation.textKind !== null;
    case 'AMBIGUOUS_OWNERSHIP':
      return Boolean(recommendation.owner);
    case 'NO_METHOD_NAME':
    case 'AMBIGUOUS_NAME':
      return Boolean(recommendation.methodName);
    // For these the DECISION is the answer, so it is answered by not being a decline -
    // and the decline is handled before this is consulted.
    case 'CONSTANT_PARAMETER_VALUE':
    case 'UNCLASSIFIED_TARGET':
    case 'CONTAINER_OR_CAPABILITY':
      return recommendation.decision !== 'NEEDS_REVIEW';
    default:
      return true;
  }
}

export function nameProblem(name: string | null): string | null {
  if (!name)
    return 'no method name was returned';
  if (!/^[a-z][A-Za-z]*$/.test(name))
    return `"${name}" is not a camelCase capability name (letters only, leading lower case)`;
  if (name.length < 3)
    return `"${name}" is too short to describe a capability`;
  // `method1`, `checkbox1749558` and `issueCheckbox2` all die on the letters-only
  // rule above; this catches the wordier failures a model actually produces.
  if (/^(get|do|handle|element|locator|thing|item|method|temp)$/i.test(name))
    return `"${name}" names no capability`;
  return null;
}

/**
 * The questions whose ANSWER IS THE DECISION ITSELF.
 *
 * One list, read by the decline rule and by the terminality test, because they are the same
 * judgement asked twice: for these codes "NEEDS_REVIEW" is not an incomplete reply that a
 * repair could complete - it is the reply.
 */
const DECIDABLE_BY_DECISION = [
  'UNCLASSIFIED_TARGET', 'CONTAINER_OR_CAPABILITY', 'CONSTANT_PARAMETER_VALUE',
] as const;

export interface Revalidation {
  accepted: boolean;
  status: Proposal['status'];
  owner: string | null;
  method: string | null;
  parameterName: string | null;
  rejection: string | null;
  /**
   * What a TEXT_ONLY_IDENTITY answer of DATA turns the proposal into.
   *
   * Present only when the framework itself re-derived a template from the MEASURED
   * expression - `parameterNameFor` for the shape, `templateFor` to split it on the
   * recorded value, then a round trip asserted against the same expression. The
   * resolver's contribution was the judgement that the string is data; every byte of
   * the template is the recorder's.
   */
  reparameterised?: {
    parameterised: true;
    template: string;
    parameterName: string;
    parameterSource: string;
    roundTrip: true;
  };
  /** A one-clause description for the knowledge entry, sanitised. Null to keep the derived one. */
  description?: string | null;
  /**
   * REPAIR CANNOT IMPROVE THIS ANSWER, and the validator is what established that.
   *
   * Not "the answer was rejected" - most rejections ARE repairable and stay so. This says
   * the resolver answered the question that was asked, completely, and the answer is that
   * it declines. Asking again is asking the same thing.
   */
  terminal?: boolean;
}

/**
 * Is this string safe to keep INSIDE a method body as a fixed label?
 *
 * The LABEL branch of TEXT_ONLY_IDENTITY is the only place a recorded string is
 * deliberately baked into a generated method, so the same three tests the parameter
 * path applies to a value are applied here - a credential, a generated identifier and
 * a bare number are not labels whatever a resolver calls them.
 */
export function labelProblem(text: string | null): string | null {
  const value = (text ?? '').trim();
  if (!value)
    return 'no identifying text could be read from the measured expression';
  if (looksLikeSecretValue(value))
    return 'the identifying text looks like a credential';
  if (analyseIdentifier(value).dynamic)
    return `"${value}" is a generated identifier, not a label`;
  if (/^\d+$/.test(value))
    return `"${value}" is a bare number, which identifies one record rather than naming a control`;
  if (value.length > 40)
    return `"${value.slice(0, 30)}…" is too long to be a control's label`;
  return null;
}

/**
 * Run the recommendation back through every deterministic rule.
 *
 * The cleared code is removed from the refusal list and NOTHING ELSE IS. Whatever is
 * left - safety, structural, a second semantic question - refuses exactly as it did
 * before, so a model cannot clear a rule by answering a different one.
 */
export function revalidate(
  proposal: Proposal,
  cleared: RefusalCode | readonly RefusalCode[],
  recommendation: Recommendation,
  index = buildIndex(),
): Revalidation {
  // ONE CODE OR MANY, the rule is identical: everything NOT in this list still stands.
  // The single-code form is kept because it reads better at the call sites that only
  // ever have one, and because every existing fixture passes one.
  const clearedCodes: RefusalCode[] = Array.isArray(cleared) ? [...cleared] : [cleared as RefusalCode];
  const asked = (code: RefusalCode): boolean => clearedCodes.includes(code);

  const review = (rejection: string): Revalidation => ({
    accepted: false, status: 'NEEDS_REVIEW', owner: null, method: null,
    parameterName: null, rejection,
  });

  // A DECLINE IS RESPECTED - BUT ONLY WHEN IT DECLINES THE QUESTION THAT WAS ASKED.
  //
  // This is the mirror of the rule at step 4, and it was found the same way: by a real
  // resolver. Asked whether a project card's text was a LABEL or DATA, it answered
  // `"textKind": "DATA"` with confidence 0.9 - a complete, correct answer to the only
  // question put to it - and set `"decision": "NEEDS_REVIEW"` beside it, because it was
  // unsure whether to CREATE or REUSE. That is not its call: create-versus-reuse is
  // decided at step 6 against the repository index, and never from the model. Reading
  // the decision field first threw the good answer away and burned the whole repair
  // budget re-asking a question that had already been answered - three transport calls
  // to reach a refusal the first reply had settled.
  //
  // So a decline is terminal only where the DECISION IS ITSELF THE ANSWER - is this a
  // capability, is this worth a parameter - and elsewhere it is out-of-scope commentary
  // on a question nobody asked, exactly like an unsolicited method name.
  const decisionIsTheAnswer = DECIDABLE_BY_DECISION.some(code => asked(code));
  const unanswered = clearedCodes.filter(code => !answers(code, recommendation));
  if (recommendation.decision === 'NEEDS_REVIEW' && (decisionIsTheAnswer || unanswered.length)) {
    // TERMINAL, AND ONLY WHERE IT IS PROVABLY TERMINAL.
    //
    // A decline is the COMPLETE answer when every question still open is one whose answer
    // IS the decision - is this a capability, is this a container, is that value worth a
    // parameter. Repairing such an answer asks the identical question again, which is what
    // spent two further transport calls per exchange and up to 120 s each.
    //
    // It is NOT terminal when something else is still open. `NO_METHOD_NAME` left
    // unanswered beside a decline is repairable: the repair prompt quotes what is missing
    // and a resolver has produced a name at the second attempt before. So the test is not
    // "did it decline" but "is there anything left that a repair could answer".
    const terminal = decisionIsTheAnswer
      && unanswered.every(code => (DECIDABLE_BY_DECISION as readonly string[]).includes(code));
    return {
      ...review(unanswered.length
        ? `the resolver declined and left ${unanswered.join(', ')} unanswered, which is a correct answer`
        : 'the resolver declined to settle it, which is a correct answer'),
      terminal,
    };
  }
  if (unanswered.length)
    return review(`the resolver did not answer ${unanswered.join(', ')}`);

  // 1. THE LOCATOR IS NOT NEGOTIABLE. The template comes from the recorder's
  //    measurement; the returned one is a consistency check and never an input.
  if (recommendation.locatorTemplate && proposal.template
    && recommendation.locatorTemplate !== proposal.template)
    return review('the resolver returned a locator template that is not the measured one');
  if (recommendation.locatorTemplate && !proposal.template)
    return review('the resolver returned a locator template where the evidence has none');

  // 2. EVERY REFUSAL EXCEPT THE ONES IT WAS ASKED ABOUT still stands.
  const remaining = proposal.refusalCodes.filter(entry => !asked(entry.code));
  if (remaining.length) {
    return review(`${remaining.length} refusal(s) the resolver was not authorised to clear: `
      + remaining.map(entry => entry.code).join(', '));
  }

  // 3. THE OWNER MUST COME FROM THE CLOSED SET.
  const owner = recommendation.owner ?? proposal.owner;
  if (!owner)
    return review('no owner was returned and none was already resolved');
  if (proposal.owner && owner !== proposal.owner)
    return review(`the resolver moved the element from ${proposal.owner} to ${owner}`);
  if (!proposal.owner && !proposal.allowedOwners.includes(owner))
    return review(`${owner} is not one of the owners knowledge declares for this screen`);
  if (!index.pages[owner])
    return review(`no Page Object class named ${owner} exists`);

  // 4. THE NAME. Deterministic wherever it could be derived. A resolver is asked what
  //    to call something ONLY when the framework could not work it out; where it
  //    could, the framework's name stands and the model's has to agree with it.
  //    A NAME OFFERED ON A QUESTION THAT WAS NOT ABOUT NAMING IS DISREGARDED, not
  //    treated as a conflict. Asked who owns `#new_issue`, a resolver also suggested
  //    calling it `addIssueButton`; rejecting the whole recommendation for that threw
  //    away a valid ownership answer over an opinion nobody asked for. It is out of
  //    scope, so it is ignored - which is what "clears only the issue it was asked
  //    about" means in the direction that costs something.
  const derived = proposal.derivedMethod;
  const naming = asked('NO_METHOD_NAME') || asked('AMBIGUOUS_NAME')
    || asked('TEXT_ONLY_IDENTITY') || asked('UNCLASSIFIED_TARGET') || asked('CONTAINER_OR_CAPABILITY');
  const method = naming ? (recommendation.methodName ?? derived) : (derived ?? recommendation.methodName);
  const problem = nameProblem(method)
    ?? classDerivedName(method, proposal.template ?? proposal.expression);
  if (problem)
    return review(problem);

  // 4b. AN AMBIGUOUS ACCESSIBLE NAME IS A BINDING PROBLEM, AND A NAME STILL CANNOT FIX
  //     IT - so the BINDING is what was fixed, and this checks that the fix is in
  //     force rather than that the question is unanswerable.
  //
  //     `renderKnowledgeEntry` omits `accessible_name` exactly when
  //     `accessibleNameAmbiguous` is set, which is exactly when this refusal was
  //     raised. With the field omitted there is no page-wide key left to bind five
  //     `Close` buttons to one locator, and the method is reached instead by
  //     `findMethodByProvenLocator` on the measured expression - which is why a
  //     template is REQUIRED here. Without one the method would be created and
  //     unreachable, which is worse than refusing.
  if (asked('AMBIGUOUS_NAME')) {
    if (!proposal.accessibleNameAmbiguous) {
      return review('AMBIGUOUS_NAME was cleared for a proposal the corpus does not mark as sharing '
        + 'its accessible name, so the entry would still declare and bind that name');
    }
    if (!proposal.template) {
      return review('the entry will omit the shared accessible name, and there is no measured '
        + 'expression left to find the method by');
    }
  }

  // 5. ACTION AND ASSERTION STAY SEPARATE, whatever the resolver called it.
  if (recommendation.usage && recommendation.usage !== proposal.role)
    return review(`the resolver called this a ${recommendation.usage}, the evidence says ${proposal.role}`);
  if (proposal.role === 'assertion' && method && !/State$/.test(method))
    return review(`${method}() is an assertion and must be named for the state it reads`);
  if (proposal.role === 'action' && method && /State$/.test(method))
    return review(`${method}() names a state but the evidence is an action`);

  // 6. DUPLICATE DETECTION, against the same index the deterministic path uses.
  if (index.pages[owner]?.methods.some(entry => entry.name === method)) {
    return { accepted: false, status: 'REUSE', owner, method: method ?? null,
      parameterName: proposal.parameterName,
      rejection: `${owner}.${method}() already exists - reused, not created` };
  }

  // 7. THE PARAMETER, and its round trip. `parameterName` is derived from the SHAPE
  //    of the template, so a resolver renaming it is a disagreement about evidence.
  if (proposal.parameterised) {
    const expected = proposal.template ? parameterNameFor(proposal.template) : null;
    if (!expected || !proposal.parameterName)
      return review('the parameter name could not be derived from the measured template');
    if (recommendation.parameterName && recommendation.parameterName !== proposal.parameterName)
      return review('the resolver renamed the parameter the template already states');
    if (!proposal.roundTrip)
      return review('the parameter round trip does not reproduce the measured expression');
    if (!proposal.template?.includes(proposal.parameterName))
      return review('the template does not contain the parameter it declares');
  }

  // 8. IS IT A CAPABILITY AT ALL? Asked when no deterministic rule classified the
  //    element, or when it reads as both a container and a control.
  //
  //    "IT IS A CONTAINER" IS AN ANSWER, NOT A FAILURE. It is recorded as a terminal
  //    REFUSED with the resolver's reason - a decision the framework made and can show
  //    - rather than left in review for a person to make again.
  // 8a. `REUSE_EXISTING` MUST NAME SOMETHING THAT EXISTS, whatever was asked.
  //
  //     Checked for every code rather than only the classification ones, because the
  //     failure is the same everywhere and it was observed: asked whether a project
  //     card's text was a label or data, a real resolver answered `REUSE_EXISTING` for
  //     `ProjectsPage.projectCard` - a method the repository does not have. Rule 6
  //     found no such method, so the answer fell through and a NEW method was created
  //     under a decision that said the opposite. The framework's outcome was the safe
  //     one, but "the resolver said reuse and we created" is a disagreement, and the
  //     repair loop is what disagreements are for: it is put back with the reason, and
  //     the corrected answer is validated identically.
  if (recommendation.decision === 'REUSE_EXISTING'
    && !index.pages[owner]?.methods.some(entry => entry.name === method)) {
    return review(`the resolver answered REUSE_EXISTING, but ${owner}.${method}() does not exist `
      + '- REUSE_EXISTING names a capability the repository already has, so answer '
      + 'CREATE_PAGE_OBJECT or PARAMETERIZE to propose a new one');
  }

  if (asked('UNCLASSIFIED_TARGET') || asked('CONTAINER_OR_CAPABILITY')) {
    if (recommendation.decision !== 'CREATE_PAGE_OBJECT' && recommendation.decision !== 'PARAMETERIZE'
      && recommendation.decision !== 'REUSE_EXISTING') {
      return {
        accepted: false, status: 'REFUSED', owner, method: null, parameterName: null,
        rejection: `resolved as not a capability: ${recommendation.reasoning || 'no method is warranted'}`,
      };
    }
  }

  // 9. LABEL OR DATA - the one question whose answer changes WHAT IS BUILT.
  //
  //    Neither branch lets the resolver near a locator. LABEL keeps the expression the
  //    recorder measured, byte for byte, and only asks whether the string inside it is
  //    a control's printed name; DATA hands the same expression to `templateFor`,
  //    which splits it on the recorded value - so the template is composed here, by
  //    the framework, from measured bytes, and then asserted to round-trip back to
  //    that same expression. A resolver that says DATA about a string the splitter
  //    cannot find has its answer refused, not repaired by guesswork.
  let reparameterised: Revalidation['reparameterised'];
  if (asked('TEXT_ONLY_IDENTITY')) {
    const expression = proposal.template ?? proposal.expression;
    const value = expression ? parameterSourceOf(expression) : null;

    if (!recommendation.textKind)
      return review('the resolver did not say whether the identifying text is a LABEL or DATA');

    if (recommendation.textKind === 'LABEL') {
      const bad = labelProblem(value);
      if (bad)
        return review(`the resolver called the text a label, but ${bad}`);
      if (proposal.parameterised)
        return review('a label is fixed, so the method must not also take a parameter');
    } else {
      if (!expression)
        return review('there is no measured expression to build a parameterised template from');
      const parameter = parameterNameFor(expression);
      if (!parameter || !value)
        return review('the resolver called the text data, but no parameter can be read from the '
          + 'shape of the measured expression');
      const template = templateFor(expression, value, parameter);
      if (!template) {
        return review('the resolver called the text data, but the recorded value cannot be '
          + 'replaced by a parameter in the measured expression');
      }
      const roundTrip = template.split(parameter).join(`"${value}"`) === expression
        || template.split(parameter).join(`'${value}'`) === expression;
      if (!roundTrip) {
        return review('substituting the recorded value back into the derived template does not '
          + 'reproduce the measured expression');
      }
      const unusable = labelProblem(value);
      // A credential or a generated identifier is refused as an ARGUMENT for the same
      // reason it is refused as a label - `rejectValue` applies the identical rules on
      // the reuse path. Length is the one test that does not carry over: a long issue
      // summary is a perfectly good argument and a hopeless label.
      if (unusable && !/too long/.test(unusable))
        return review(`the resolver called the text data, but ${unusable}`);
      reparameterised = {
        parameterised: true, template, parameterName: parameter,
        parameterSource: '1 distinct recorded value(s), resolved as data',
        roundTrip: true,
      };
    }
  }

  return {
    accepted: true, status: 'PROPOSED', owner, method: method ?? null,
    parameterName: reparameterised?.parameterName ?? proposal.parameterName,
    rejection: null,
    reparameterised,
    description: sanitiseDescription(recommendation.semanticDescription),
  };
}

/**
 * A resolver's description, reduced to something safe to write into a YAML entry.
 *
 * It is prose destined for a `description:` line, so the only risks are structural -
 * a newline or a colon would break the file, and an over-long clause makes the entry
 * unreadable. Refusing it outright would cost nothing but a slightly worse comment, so
 * it is trimmed rather than validated, and null when nothing usable is left.
 */
export function sanitiseDescription(text: string | null): string | null {
  const value = (text ?? '').replace(/[\r\n]+/g, ' ').replace(/[:#]/g, '').replace(/\s+/g, ' ').trim();
  if (value.length < 4)
    return null;
  return value.length > 110 ? `${value.slice(0, 107)}...` : value;
}

/* -------------------------------------------------------------- the transport */

export type Transport = (prompt: string, model: string) => Promise<string>;

/**
 * One headless Claude Code call, with NO TOOLS AT ALL.
 *
 * Not a narrowed tool list - none. This is a judgement about evidence that is
 * already in the prompt, so a file read, a search or a browser could only be an
 * attempt to find something the framework decided not to show it. The browser wrapper
 * is unreachable for the same reason: it is spawned through Bash, and Bash is denied.
 *
 * The prompt goes in on stdin for the same reason the generator's does: Windows caps
 * a command line at ~32,767 characters.
 */
export function claudeTransport(timeoutMs = 120_000): Transport {
  return (prompt, model) => new Promise<string>((resolve, reject) => {
    const binary = resolveClaude();
    if (!binary) {
      reject(new Error('Could not find the Claude Code binary. Set CLAUDE_CLI to its full path.'));
      return;
    }
    const child = spawn(binary, [
      '-p',
      '--model', model,
      '--permission-mode', 'default',
      '--disallowed-tools', 'Bash', 'Read', 'Write', 'Edit', 'NotebookEdit',
      'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task',
      '--strict-mcp-config',
    ], { cwd: ROOT, shell: false, env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    let timedOut = false;
    child.stdout.on('data', chunk => { out += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { err += chunk.toString('utf8'); });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt, 'utf8');

    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', exitCode => {
      clearTimeout(timer);
      if (timedOut)
        reject(new Error(`the resolver timed out after ${timeoutMs} ms`));
      else if (exitCode !== 0)
        reject(new Error(`the resolver exited ${exitCode}: ${err.trim().slice(0, 200)}`));
      else
        resolve(out);
    });
  });
}

/* ------------------------------------------------------------------ the pass */

export interface SemanticOptions {
  transport?: Transport;
  model?: string;
  /** Ask nothing; report what would have been asked. */
  dry?: boolean;
  /** Where the audit goes. Overridden by fixtures so a test never writes the real log. */
  auditLog?: string;
  /**
   * The knowledge index to validate against. Built from the repository by default.
   * A fixture supplies its own so that "is this capability new?" is a property of the
   * test rather than of whatever the repository happens to contain that week.
   */
  index?: ReturnType<typeof buildIndex>;
  onLog?: (text: string) => void;
  /**
   * Transport calls per proposal: the question plus its repairs.
   *
   * Defaults to `MAX_RESOLVER_ATTEMPTS`. A fixture sets it to 1 to prove that a single
   * rejected answer is terminal, and to 2 or 3 to exercise the repair path itself.
   */
  maxAttempts?: number;
  /**
   * Consult the audit log for abstractions that already spent their budget.
   *
   * On by default, because a stateless analyser would otherwise re-ask an unanswerable
   * question on every run for ever. A fixture sets it false so that its own assertions
   * do not depend on what previous runs happened to leave in the log.
   */
  memo?: boolean;
}

export interface SemanticOutcome {
  asked: number;
  skipped: number;
  accepted: number;
  rejected: number;
  /** Proposals accepted on a repair rather than on the first answer. */
  repaired: number;
  /** Total transport calls, which is what the run actually costs. */
  calls: number;
  /** Wall clock across every exchange - the number the metrics could not report. */
  totalMs: number;
  /** Exchanges that ended on a validated terminal answer rather than a spent budget. */
  terminalStops: number;
  audits: SemanticAudit[];
}

/**
 * Has this exact abstraction already used up its repair budget, in an earlier run?
 *
 * WITHOUT THIS THE LOOP IS BOUNDED PER RUN AND UNBOUNDED OVER TIME. `analyseCorpus`
 * is stateless and rebuilds every proposal from the recordings, so a question that
 * exhausted three attempts yesterday is a fresh question today - and would be asked
 * three more times on every run, for ever, to reach the same answer.
 *
 * Keyed on the fingerprint, which is composed of owner, role, identity and strategy:
 * if any of those changes the proposal is a different one and is asked again. The log
 * is append-only JSONL and a torn line is skipped, because a report must never stop a
 * run.
 */
export function exhaustedBefore(fingerprint: string, file = AUDIT_LOG): boolean {
  if (!fs.existsSync(file))
    return false;
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim() || !line.includes(fingerprint))
        continue;
      let record: Partial<SemanticAudit>;
      try {
        record = JSON.parse(line) as Partial<SemanticAudit>;
      } catch {
        continue;
      }
      if (record.fingerprint !== fingerprint)
        continue;
      // ACCEPTED anywhere in the history clears it: the capability was created, so the
      // proposal will not come back as NEEDS_REVIEW anyway, and treating a success as
      // an exhaustion would be exactly backwards.
      if (record.outcome === 'ACCEPTED')
        return false;
      // AN OUTAGE SPENT NOTHING. A history of nothing but unreachable-resolver
      // attempts is not a spent budget, and memoising it would let one afternoon
      // without Claude Code close the question permanently.
      // A SETTLED ANSWER IS SETTLED NEXT RUN TOO. The validator established that repair
      // cannot improve it, so re-asking spends a call to reproduce a recorded conclusion -
      // which is the same waste this memo exists to prevent, reached one step earlier.
      // Absent on every record written before terminality was recorded, so an old history
      // is read exactly as it was.
      if (record.terminal === true)
        return true;
      const answered = (record.attempts ?? []).filter(entry => entry.outcome !== 'TRANSPORT_FAILED');
      if (answered.length >= MAX_RESOLVER_ATTEMPTS)
        return true;
    }
  } catch {
    // An unreadable audit log means no memo, never a blocked run.
  }
  return false;
}

/**
 * Ask about every eligible proposal, and re-validate every answer.
 *
 * Mutates the proposals in `result` in place, because they are what the writer and
 * the ledger read next - and an accepted recommendation must be indistinguishable
 * from a deterministic PROPOSED to everything downstream. `resolvedBy` and the audit
 * record are how it stays distinguishable to a person.
 */
export async function resolveSemanticReviews(
  result: CorpusResult,
  options: SemanticOptions = {},
): Promise<SemanticOutcome> {
  const log = options.onLog ?? (() => {});
  const model = options.model ?? resolveModel();
  const transport = options.transport ?? claudeTransport();
  const index = options.index ?? buildIndex();
  const auditLog = options.auditLog ?? AUDIT_LOG;
  const budget = Math.max(1, options.maxAttempts ?? MAX_RESOLVER_ATTEMPTS);
  const outcome: SemanticOutcome = {
    asked: 0, skipped: 0, accepted: 0, rejected: 0, repaired: 0, calls: 0,
    totalMs: 0, terminalStops: 0, audits: [],
  };

  for (const proposal of result.proposals) {
    const check = eligibility(proposal);
    if (!check.eligible || !check.codes.length) {
      outcome.skipped++;
      continue;
    }
    if (options.dry) {
      log(`  would ask about ${proposal.fingerprint}: ${check.codes.join(', ')}\n`);
      outcome.asked++;
      continue;
    }
    // ALREADY EXHAUSTED IN AN EARLIER RUN. Asking again spends the whole budget to
    // reproduce a recorded answer; see `exhaustedBefore`.
    if (options.memo !== false && exhaustedBefore(proposal.fingerprint, auditLog)) {
      outcome.skipped++;
      log(`  ${proposal.fingerprint}: skipped - the repair budget was already spent on this `
        + 'abstraction in an earlier run\n');
      continue;
    }

    const audit: SemanticAudit = {
      fingerprint: proposal.fingerprint,
      semanticCodes: [...check.codes],
      evidence: `${proposal.category}/rule ${proposal.rule}; ${proposal.locatorStrategy}; `
        + `proof matchCount=${proposal.proof?.matchCount} identity=${proposal.proof?.identityMatched} `
        + `sameDocument=${proposal.proof?.sameDocument} measuredAt=${proposal.proof?.measuredAt}`,
      allowedOwners: proposal.allowedOwners,
      model,
      decision: null, owner: null, methodName: null, parameterName: null, confidence: null,
      outcome: 'REJECTED', rejection: null,
      attempts: [], repaired: false,
      startedAt: new Date().toISOString(),
    };
    const exchangeStarted = Date.now();

    outcome.asked++;

    /* ---- the bounded loop: ask, validate, repair, validate, accept or refuse ---- */
    let settled: Revalidation | null = null;
    let lastReply = '';
    let lastRejection = '';
    /**
     * The resolver could not be reached at all.
     *
     * Kept apart from "was reached and answered wrongly", because the two deserve
     * opposite treatment: a wrong answer has spent an attempt and eventually exhausts
     * the budget, while an outage has spent nothing. Marking an outage as exhausted
     * would record a refusal for a question that was never put, and the memo would then
     * refuse to ask it on every future run - the loop would silently close because
     * Claude Code happened to be missing for one afternoon.
     */
    let outage = false;

    for (let attempt = 1; attempt <= budget; attempt++) {
      const kind: 'question' | 'repair' = attempt === 1 ? 'question' : 'repair';
      const prompt = attempt === 1
        ? buildPrompt(proposal, check.codes)
        : buildRepairPrompt(proposal, check.codes, lastReply, lastRejection);

      let text: string;
      outcome.calls++;
      const callStarted = Date.now();
      try {
        text = await transport(prompt, model);
      } catch (error) {
        // A TRANSPORT FAILURE IS NOT A WRONG ANSWER, so it is not repaired. Re-sending
        // an identical prompt to a resolver that could not be reached is a retry, and
        // the brief says no unbounded retries; the loop stops and the run continues
        // deterministically without this capability.
        audit.attempts.push({
          attempt, kind, decision: null, owner: null, methodName: null, parameterName: null,
          textKind: null, confidence: null, outcome: 'TRANSPORT_FAILED',
          rejection: (error as Error).message,
          transportMs: Date.now() - callStarted, responded: false,
        });
        audit.outcome = 'TRANSPORT_FAILED';
        audit.rejection = (error as Error).message;
        outage = true;
        break;
      }

      lastReply = text;
      const parsed = parseRecommendation(text);
      if (!parsed.ok) {
        // MALFORMED IS REPAIRABLE, and this is the cheapest repair there is: the reply
        // was not one JSON object, which the next prompt says in those words.
        lastRejection = parsed.why;
        audit.attempts.push({
          attempt, kind, decision: null, owner: null, methodName: null, parameterName: null,
          textKind: null, confidence: null, outcome: 'MALFORMED', rejection: parsed.why,
          transportMs: Date.now() - callStarted, responded: true,
        });
        audit.outcome = 'MALFORMED';
        audit.rejection = parsed.why;
        continue;
      }

      const verdict = revalidate(proposal, check.codes, parsed.value, index);
      audit.decision = parsed.value.decision;
      audit.owner = parsed.value.owner;
      audit.methodName = parsed.value.methodName;
      audit.parameterName = parsed.value.parameterName;
      audit.confidence = parsed.value.confidence;
      audit.rejection = verdict.rejection;

      // THREE OUTCOMES ARE FINAL AND ONLY ONE OF THEM IS A CREATION. `REUSE` found the
      // capability already on the class and `REFUSED` is a resolved "this is not a
      // capability" - both are decisions, and repairing a decision would be asking the
      // resolver to change an answer the framework accepted.
      const conclusive = verdict.accepted || verdict.status === 'REUSE' || verdict.status === 'REFUSED';
      audit.attempts.push({
        attempt, kind,
        decision: parsed.value.decision, owner: parsed.value.owner,
        methodName: parsed.value.methodName, parameterName: parsed.value.parameterName,
        textKind: parsed.value.textKind, confidence: parsed.value.confidence,
        outcome: conclusive ? 'ACCEPTED' : 'REJECTED',
        rejection: verdict.rejection,
        transportMs: Date.now() - callStarted, responded: true,
        ...(verdict.terminal ? { terminal: true } : {}),
      });

      if (conclusive) {
        settled = verdict;
        audit.repaired = attempt > 1;
        break;
      }

      // A VALIDATED TERMINAL ANSWER ENDS THE EXCHANGE, and it ends it exactly where a spent
      // budget ends: the proposal keeps this verdict's NEEDS_REVIEW, takes the same
      // STRUCTURAL refusal below, and is not re-asked in this run. Nothing is accepted that
      // was not accepted before; what is saved is the two identical questions that used to
      // follow. `settled` is deliberately NOT set - it is the applied verdict, and a decline
      // applies nothing.
      if (verdict.terminal) {
        audit.terminal = true;
        log(`  ${proposal.fingerprint}: attempt ${attempt}/${budget} settled the question - `
          + `${verdict.rejection}\n`);
        break;
      }

      lastRejection = verdict.rejection ?? 'the recommendation did not validate';
      log(`  ${proposal.fingerprint}: attempt ${attempt}/${budget} rejected - ${lastRejection}\n`);
    }

    /* ------------------------------------------------- apply the settled verdict */

    if (settled && (settled.accepted || settled.status === 'REUSE')) {
      audit.outcome = 'ACCEPTED';
      proposal.status = settled.status;
      proposal.owner = settled.owner;
      proposal.method = settled.method;
      proposal.resolvedBy = 'ai';
      // Only the codes the resolver was authorised to clear leave the list, so the
      // ledger says exactly what is now true.
      proposal.refusalCodes = proposal.refusalCodes.filter(entry => !check.codes.includes(entry.code));
      proposal.refusals = proposal.refusalCodes.map(entry => entry.detail);

      // A `DATA` answer turns a fixed expression into a parameterised capability. The
      // template was composed by the framework from the measured expression and has
      // already round-tripped; this is where the proposal starts saying so.
      if (settled.reparameterised) {
        proposal.parameterised = true;
        proposal.template = settled.reparameterised.template;
        proposal.parameterName = settled.reparameterised.parameterName;
        proposal.parameterSource = settled.reparameterised.parameterSource;
        proposal.roundTrip = true;
      }
      if (settled.description)
        proposal.reason = settled.description;

      outcome.accepted++;
      if (audit.repaired)
        outcome.repaired++;
      log(`  ${proposal.fingerprint}: ${settled.owner}.${settled.method}() - `
        + `${settled.status === 'REUSE' ? 'reused' : 'accepted'}`
        + `${audit.repaired ? ` after ${audit.attempts.length} attempt(s)` : ''}\n`);
    } else if (settled && settled.status === 'REFUSED') {
      // A TERMINAL, AUTOMATED REFUSAL - not a review. The resolver was asked whether
      // this is a capability and said it is not; that is an answer, and it is recorded
      // as the decision rather than handed to a person to make again.
      audit.outcome = 'ACCEPTED';
      proposal.status = 'REFUSED';
      proposal.method = null;
      proposal.resolvedBy = 'ai';
      outcome.accepted++;
      log(`  ${proposal.fingerprint}: refused - ${settled.rejection}\n`);
    } else if (outage) {
      // AN OUTAGE IS NOT A VERDICT. The proposal is left exactly as the deterministic
      // engine produced it - same status, same refusals - so the next run, with the
      // resolver reachable, asks the question for the first time rather than reading a
      // refusal that records nothing but a missing binary.
      outcome.rejected++;
      log(`  ${proposal.fingerprint}: resolver unavailable - ${audit.rejection}\n`);
    } else {
      // THE BUDGET IS SPENT. This is still a decision the framework made and can show,
      // so it is recorded as one: the proposal carries a STRUCTURAL refusal naming the
      // attempts, and `eligibility` will not ask about it again in this run.
      outcome.rejected++;
      proposal.refusalCodes = dedupeRefusals([
        ...proposal.refusalCodes,
        refuse('RESOLVER_EXHAUSTED',
            `${audit.attempts.length} resolver attempt(s), none of which validated`
            + `${audit.rejection ? ` - last: ${audit.rejection}` : ''}`),
      ]);
      proposal.refusals = proposal.refusalCodes.map(entry => entry.detail);
      log(`  ${proposal.fingerprint}: unresolved after ${audit.attempts.length} attempt(s)\n`);
    }

    // THE EXCHANGE'S OWN WALL CLOCK, closed here so it covers every attempt and the
    // validation between them - which is what a reader comparing cases needs, and what no
    // field in the metrics carried while a case spent 278 s in this loop.
    audit.finishedAt = new Date().toISOString();
    audit.totalMs = Date.now() - exchangeStarted;
    outcome.totalMs += audit.totalMs;
    if (audit.terminal)
      outcome.terminalStops++;

    proposal.semantic = audit;
    outcome.audits.push(audit);
  }

  if (outcome.audits.length)
    appendAudit(outcome.audits, auditLog);
  return outcome;
}

/** Same rule as the engine's own: one refusal per distinct detail. */
function dedupeRefusals(refusals: readonly Refusal[]): Refusal[] {
  return refusals.filter((refusal, index) =>
    refusals.findIndex(other => other.detail === refusal.detail) === index);
}

/** Append-only, one line per exchange, so a killed run cannot corrupt earlier ones. */
export function appendAudit(audits: readonly SemanticAudit[], file = AUDIT_LOG): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const at = new Date().toISOString();
  fs.appendFileSync(file,
      `${audits.map(audit => JSON.stringify({ at, ...audit })).join('\n')}\n`, 'utf8');
}

async function main(): Promise<void> {
  const { analyseCorpus } = await import('./propose');
  const dry = process.argv.includes('--dry');
  const result = analyseCorpus();
  const outcome = await resolveSemanticReviews(result, {
    dry, onLog: text => process.stdout.write(text),
  });
  process.stdout.write(`\nasked ${outcome.asked}, skipped ${outcome.skipped}, `
    + `accepted ${outcome.accepted} (${outcome.repaired} after repair), `
    + `rejected ${outcome.rejected}, transport calls ${outcome.calls}\n`);
}

if (process.argv[1] && /semantic\.ts$/.test(process.argv[1]))
  void main();
