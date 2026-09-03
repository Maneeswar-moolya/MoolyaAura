/**
 * May this candidate become a Page Object method?
 *
 * The classifier says WHAT a target is. This says whether the evidence is good
 * enough to build on, and it is deliberately the stricter of the two: a wrong
 * classification produces a badly named method, a wrong validation produces a method
 * that points at the wrong element in every test that ever calls it.
 *
 * Every gate here already existed. `isProvenAgainstClickedTarget` is P0.7's whole bar
 * in one place, `analyseIdentifier` is the dynamic-id detector, `isPositionalLocator`
 * is the positional check. Nothing is re-implemented and nothing is relaxed - a
 * candidate that the existing engine would refuse to EMIT is not one to wrap in a
 * method and emit everywhere.
 *
 * `.first()` is the case worth stating outright: it is never stripped to make a
 * locator pass. Codegen wrote it because it found several elements, so the chain is
 * evidence of ambiguity, and removing it would hide the ambiguity rather than
 * resolve it.
 *
 * What CAN answer for such a target is a different expression the recorder measured
 * itself - at the press, against the pressed element, matching exactly one. That is
 * not the recorded chain with its `.first()` taken off; it is an independent
 * measurement that resolves what Codegen could not, and it is the same expression
 * the pipeline already emits. Where no such measurement exists, the recorded chain
 * is judged as it stands and its `.first()` refuses it.
 */

import { analyseIdentifier, isPositionalLocator, parseChain } from '../locator-quality';
import { provesIdentity, type TargetEvidence } from '../dom-evidence';
import { chainHasDynamicIdentifier, effectiveLocator, provenCandidate } from './classify';
import { refuse, type Refusal, type RefusalCode, type SafetyResult, type TargetRole } from './types';

/**
 * Mechanisms that choose by position, by force or by timing.
 *
 * All of them make a locator resolve; none of them makes it correct. They are
 * refused in a recorded chain for the same reason the resolver never adds one.
 */
const FORBIDDEN = [
  { pattern: /\.first\s*\(/, why: 'first() - the recording found several elements' },
  { pattern: /\.last\s*\(/, why: 'last() - the recording found several elements' },
  { pattern: /\.nth\s*\(/, why: 'nth() - chosen by position, and nobody chose a position' },
  { pattern: /xpath\s*=|^\s*\/\//, why: 'XPath' },
  { pattern: /\bforce\s*:/, why: 'force' },
  { pattern: /\bmouse\s*\./, why: 'mouse coordinates' },
  { pattern: /dispatchEvent/, why: 'dispatchEvent' },
  { pattern: /waitForTimeout|setTimeout|sleep\s*\(/, why: 'a sleep' },
  { pattern: /\bretry|\bretries\b/, why: 'a retry' },
];

/** Every forbidden mechanism present in a recorded chain, named. */
export function forbiddenMechanisms(locator: string): string[] {
  const found = FORBIDDEN.filter(rule => rule.pattern.test(locator ?? '')).map(rule => rule.why);
  if (!found.length && isPositionalLocator(locator ?? ''))
    found.push('a positional selector');
  return found;
}

/**
 * The proof, and everything that would stop it being one.
 *
 * Returns the measurement rather than a boolean so the ledger can carry the numbers a
 * person needs to check the decision: how many elements, in which document, when, and
 * whether the one element was the one pressed.
 */
export function validateCandidate(
  evidence: TargetEvidence,
  /**
   * WHICH TIMING this target's proof may come from - `action` (a press) by default,
   * which is what every caller got before this parameter existed. An `assertion` may
   * also be proven at its own pick; see `provesIdentity`, the one place that decides.
   * Every other gate below is untouched by it.
   */
  role: TargetRole = 'action',
): SafetyResult {
  const codes: Refusal[] = [];

  // JUDGE WHAT WOULD BE EMITTED, not what Codegen happened to write.
  //
  // A row checkbox records as `page.locator('.rounded-checkbox-ui').first()` or
  // `page.locator('[id="639978"]')` - one ambiguous, one a generated id, both
  // useless. The recorder ALSO measured, at the press and against the pressed
  // element, a contextual expression naming the row by its own text. That is what
  // the pipeline emits and therefore what a method would wrap, so that is what is
  // validated.
  //
  // NOTHING IS STRIPPED TO MAKE A LOCATOR PASS. `.first()` is not removed from the
  // recorded chain; a different expression, independently measured to match exactly
  // one element and to BE the element pressed, is used instead - and only when it is
  // free of generated identifiers and of every forbidden mechanism below. Where no
  // such measurement exists, the recorded locator is judged exactly as before and
  // its `.first()` refuses it.
  const effective = effectiveLocator(evidence, role);
  const locator = effective.expression;

  for (const mechanism of forbiddenMechanisms(locator)) {
    // AN EVIDENCE-BACKED INDEX IS NOT A FORBIDDEN MECHANISM, and this is the only
    // place that distinction is made. `.nth()` is refused everywhere by default
    // because it chooses a position nobody chose; when `effectiveLocator` reports
    // `positionProven`, the browser measured that the pressed element WAS at that
    // index, at the press, in the press's document. Every other mechanism in the
    // list - first(), last(), force, mouse, dispatchEvent, sleeps, retries, XPath -
    // is refused exactly as before, and so is an index with no measurement behind it.
    if (effective.positionProven && /nth\(/.test(mechanism))
      continue;
    codes.push(refuse('FORBIDDEN_MECHANISM',
        `the ${effective.proven ? 'resolved' : 'recorded'} locator uses ${mechanism}`));
  }

  if (chainHasDynamicIdentifier(locator))
    codes.push(refuse('DYNAMIC_IDENTIFIER', 'the locator is scoped by a generated identifier'));
  if (!effective.proven && evidence.identifier?.dynamic === true)
    codes.push(refuse('DYNAMIC_IDENTIFIER', `"${evidence.identifier.raw}" is a generated identifier`));

  const candidate = provenCandidate(evidence, role);
  if (!candidate) {
    // Say WHICH part is missing - "not proven" is not a finding somebody can act on.
    const measured = evidence.derivedCandidates ?? [];
    // TWO STATES, AND THEY WERE BEING REPORTED AS ONE.
    //
    // `measured` is `derivedCandidates` - the PROVEN list - so it is empty both when
    // nothing was measured at all and when plenty was measured and none of it proved
    // identity. Reading the empty list as the first meaning printed "evidence predates
    // press-time measurement" over recordings made minutes earlier: TC_LOGIN_126's
    // textbox is a live recording whose target carries 9 rejected and 5 position-proven
    // candidates, every one measured AT the press, none proving which element it was.
    // That sends a reader to re-record a recording that is already complete.
    //
    // The DECISION is untouched - the code, the class and the refusal are the same. Only
    // the sentence changes, and it now distinguishes what the reader has to do about it.
    const anyMeasurement = measured.length
      + (evidence.positionProvenCandidates ?? []).length
      + (evidence.rejectedCandidates ?? []).length;
    const moment = role === 'assertion' ? 'the press or the pick' : 'the press';
    const about = role === 'assertion' ? 'asserted about' : 'pressed';
    if (!anyMeasurement) {
      // NO_MEASUREMENT_AVAILABLE - nothing was measured for this element at all, which
      // for a recording made before press-time capture existed is the whole story.
      codes.push(refuse('NO_PRESS_TIME_PROOF',
          `no candidate was measured for this element at all (no measurement available: `
          + `either the recorder captured none, or the recording predates press-time measurement)`));
    } else {
      // MEASURED_BUT_NO_CANDIDATE_PROVEN - the browser did the work and the answer was
      // no. Say how much work, so the number itself shows the recording is not the
      // problem.
      codes.push(refuse('NO_PRESS_TIME_PROOF',
          `${anyMeasurement} candidate(s) were measured at ${moment} and none is proven against `
          + `the element that was ${about} (measured, but no candidate proven - a new recording `
          + 'of the same screen would measure the same thing)'));
    }
  }

  // A proven candidate satisfies all four by definition; state them anyway, because
  // the ledger is read by people checking the rule, not trusting it.
  if (candidate && !provesIdentity(candidate, role)) {
    codes.push(refuse('IDENTITY_NOT_PROVEN',
        `the candidate does not satisfy ${role === 'assertion' ? 'press- or pick-time' : 'press-time'} identity`));
  }

  for (const segment of parseChain(locator)) {
    const arg = (segment.arg ?? '').replace(/^[#.]/, '');
    if (arg && /^[A-Za-z0-9_-]+$/.test(arg) && analyseIdentifier(arg).dynamic)
      codes.push(refuse('DYNAMIC_IDENTIFIER', `"${arg}" in the chain is a generated identifier`));
  }

  // ONE SOURCE OF TRUTH. `refusals` is derived from `codes` here and nowhere else,
  // so a reason can never exist in prose without the code that classifies it.
  const unique = codes.filter((refusal, index) =>
    codes.findIndex(other => other.detail === refusal.detail) === index);

  return {
    safe: unique.length === 0,
    codes: unique,
    refusals: unique.map(refusal => refusal.detail),
    proof: candidate
      ? {
        matchCount: candidate.matchCount,
        identityMatched: candidate.identityMatched,
        sameDocument: candidate.sameDocument,
        measuredAt: candidate.measuredAt,
        strategy: candidate.strategy,
        expression: candidate.expression,
      }
      : null,
  };
}

/**
 * The four conditions a parameterised method needs, checked over a GROUP of targets.
 *
 * Parameterisation is the one decision a single target cannot support: one issue row
 * is an element, five issue rows with the same structure and different text are a
 * method with an argument. So this takes the group, and refuses when the group does
 * not actually vary - two identical targets are one element recorded twice, not a
 * parameter.
 */
export function parameterisationHolds(group: Array<{
  signature: string;
  value: string | null;
  proven: boolean;
}>): { holds: boolean; reason: string; code: RefusalCode | null } {
  if (group.length < 2) {
    return { holds: false, code: 'SINGLE_TARGET',
      reason: 'only one target has this structural signature' };
  }
  if (new Set(group.map(item => item.signature)).size !== 1) {
    return { holds: false, code: 'SIGNATURE_MISMATCH',
      reason: 'the targets do not share one structural signature' };
  }
  const values = group.map(item => item.value).filter((value): value is string => Boolean(value));
  if (values.length !== group.length) {
    return { holds: false, code: 'PARAMETER_SOURCE_MISSING',
      reason: 'a parameter source could not be read from every target' };
  }
  if (new Set(values).size < 2) {
    return { holds: false, code: 'CONSTANT_PARAMETER_VALUE',
      reason: 'the values do not differ, so there is nothing to parameterise' };
  }
  // LAST, AND DELIBERATELY SO. This is the one SAFETY clause in this function. A
  // group reaching it is already structurally sound, so when it fires it is the only
  // refusal left - and no semantic answer may ever clear it.
  if (!group.every(item => item.proven)) {
    return { holds: false, code: 'GROUP_MEMBER_UNPROVEN',
      reason: 'not every target in the group is individually identity-proven' };
  }
  return { holds: true, code: null,
    reason: `${group.length} targets, same structure, ${new Set(values).size} distinct values` };
}

/**
 * Where the argument would come from, read from the recorded chain only.
 *
 * `filter({ hasText: X })` and `getByText(X)` are the two shapes the recorder
 * actually produces for a value. Nothing is inferred from DOM text or from the
 * target's name: if the chain does not state the value, there is no parameter source
 * and the group is NEEDS_REVIEW rather than a guess.
 */
export function parameterSourceOf(locator: string): string | null {
  const hasText = /hasText:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(locator ?? '');
  if (hasText)
    return hasText[2];
  for (const segment of parseChain(locator ?? '')) {
    if (segment.call === 'getByText' && segment.arg)
      return segment.arg;
  }
  return null;
}

/**
 * The parameter's name, from the SHAPE of the evidence rather than the value.
 *
 * Two cases, because the recorder produces two shapes and each says something
 * different about what the argument is. `filter({ hasText: X })` selects one of many
 * repeated containers by the text it displays - that text describes the item, so the
 * argument is a `description`. `getByText(X)` addresses an entity by the name it is
 * rendered under, so the argument is a `name`.
 *
 * Fixed and deterministic. Nothing is derived from the value itself, which is how
 * `issueCheckboxStateLineChart` would happen.
 */
export function parameterNameFor(locator: string): string | null {
  if (/hasText:/.test(locator ?? ''))
    return 'description';
  if (/getByText\s*\(/.test(locator ?? ''))
    return 'name';
  return null;
}

/**
 * The expression with the recorded value replaced by the parameter.
 *
 * Returns null when the value cannot be found in the expression - that would mean
 * the template still carried data, and a method built from it would hard-code one
 * issue. Refusing is the only safe answer; there is nothing to guess at.
 */
export function templateFor(locator: string, value: string, parameter: string): string | null {
  if (!locator || !value || !parameter)
    return null;
  const quoted = [`"${value}"`, `'${value}'`];
  for (const needle of quoted) {
    if (locator.includes(needle))
      return locator.split(needle).join(parameter);
  }
  return null;
}

/**
 * Is this method name just the element's CSS class, spelled in camelCase?
 *
 * `roundedCheckboxUi` for `.rounded-checkbox-ui` passes every other naming rule - it is
 * camelCase, it is letters only, it is long enough, it names no forbidden verb - and it
 * is still exactly the name the brief forbids, because it describes the STYLESHEET
 * rather than the capability. A class is presentational and is renamed by any redesign;
 * the whole point of a Page Object method is to be the thing that does not move.
 *
 * AN ID IS DELIBERATELY NOT REFUSED. `#issue_summary_input` and `#bug_new_submit` are
 * AUTHORED identifiers, and `issueSummaryInput` is a good name precisely because
 * somebody chose that id to mean something. Generated ids never reach here at all -
 * `DYNAMIC_IDENTIFIER` is a SAFETY refusal and stops the proposal long before naming.
 *
 * Compared with separators removed so that `-`, `_` and camelCase are one spelling.
 */
export function classDerivedName(name: string | null, expression: string | null): string | null {
  const flat = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const wanted = flat(name ?? '');
  if (!wanted || !expression)
    return null;
  // Class tokens only: `.foo-bar` and the `.a.b.c` chains a scoped selector carries.
  // An `#id` is left out on purpose, per the note above.
  for (const match of expression.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    const token = match[1];
    // `.locator`, `.filter`, `.first` and friends are method calls, not classes.
    if (/^(locator|filter|first|last|nth|getBy\w*|and|or|page)$/.test(token))
      continue;
    if (flat(token) === wanted)
      return `"${name}" is the element's CSS class "${token}" in camelCase, which names the `
        + 'stylesheet rather than the capability';
  }
  return null;
}
