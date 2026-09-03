/**
 * Phase 4: supply a parameterised method's argument from the recording, or refuse.
 *
 * Phase 3 wrote `IssuesPage.issueCheckboxState(description)` and stopped one step
 * short: the method existed, but no future recording could say what `description`
 * was, so every row target fell back to its contextual locator. This closes that,
 * and only that.
 *
 * THE WHOLE DESIGN RESTS ON ONE PROPERTY: ROUND-TRIP EQUALITY.
 *
 * The knowledge entry already carries the method's locator as a template with the
 * parameter in it:
 *
 *   page.locator('.tabulator-row').filter({ hasText: description }).locator('.bugChecked')
 *
 * and the recorder measured, at the press, an expression for the element somebody
 * actually touched:
 *
 *   page.locator(".tabulator-row").filter({ hasText: "Line Chart : ..." }).locator(".bugChecked")
 *
 * Matching one against the other yields the argument. Substituting that argument
 * back into the template must then reproduce the proven expression EXACTLY, byte for
 * byte. When it does, the locator a generated call would evaluate is not merely
 * similar to the one that was proven - it IS that one, so `matchCount === 1`,
 * `identityMatched`, `sameDocument` and `measuredAt: 'press'` carry over untouched.
 * No gate is re-derived, re-argued or relaxed; the same measurement answers for both.
 *
 * When the round trip does not hold, there is nothing to argue about and the answer
 * is NEEDS_REVIEW. Refusing costs a raw locator, which is honest. Guessing costs a
 * call that looks right in review and addresses the wrong row.
 *
 * NOT A GENERAL TEXT-TO-PARAMETER MECHANISM. A value becomes an argument only where a
 * method already declares that parameter in a template this element's own proven
 * expression matches. `getByText('Faclon labs')` does not become `openProject('Faclon
 * labs')` here, and must not: no template proves that relationship.
 *
 * There is no model call in this file or anything it imports.
 */

import { analyseIdentifier } from '../locator-quality';
import { looksLikeSecretValue, provesIdentity, type TargetEvidence } from '../dom-evidence';
import type { PageElement } from '../../knowledge/page-knowledge';
import type { IndexedMethod } from '../../knowledge/index';
import { provenCandidate } from './classify';
import type { TargetRole } from './types';

/** One argument, and exactly where it came from. */
export interface ParameterExtraction {
  parameterName: string;
  value: string;
  /** `filter.hasText` / `getByText` - the shape in the chain that carried it. */
  source: string;
  /** The proven expression the value was read out of. */
  expression: string;
  confidence: 'proven';
}

export type ReuseOutcome =
  | { status: 'REUSE_PARAMETERIZED'; parameters: ParameterExtraction[]; expression: string }
  | { status: 'NEEDS_REVIEW'; reason: string };

/** Sources a parameter may be read from. Anything else is not a source. */
const SOURCES: Array<{ name: string; pattern: (parameter: string) => RegExp }> = [
  { name: 'filter.hasText', pattern: parameter => new RegExp(`hasText:\\s*${parameter}\\b`) },
  { name: 'getByText', pattern: parameter => new RegExp(`getByText\\(\\s*${parameter}\\s*\\)`) },
  { name: 'getByRole.name', pattern: parameter => new RegExp(`name:\\s*${parameter}\\b`) },
];

/** A bare identifier in the template, i.e. the parameter rather than a literal. */
const IDENTIFIER = /^[A-Za-z_]\w*$/;

/**
 * The template a knowledge entry declares for this method, when it declares one.
 *
 * `locator_strategy` is free text on most entries ("#proj_name, with getByPlaceholder
 * as the fallback"), so it is only read as a template when it actually looks like
 * one: a locator expression that mentions every parameter the method declares, as a
 * bare identifier. Anything else returns null and the method is simply not
 * reusable this way - which is the correct answer, not a failure.
 */
export function templateOf(element: PageElement, method: IndexedMethod): string | null {
  const strategy = (element.locator_strategy ?? '').trim();
  if (!strategy || !/^page\s*\./.test(strategy))
    return null;
  const required = (method.params ?? []).filter(parameter => !parameter.optional);
  if (!required.length)
    return null;
  for (const parameter of required) {
    if (!IDENTIFIER.test(parameter.name))
      return null;
    if (!SOURCES.some(source => source.pattern(parameter.name).test(strategy)))
      return null;
  }
  return strategy;
}

/** Which shape carried this parameter in the template. */
export function sourceOf(template: string, parameter: string): string | null {
  return SOURCES.find(source => source.pattern(parameter).test(template))?.name ?? null;
}

/**
 * A value that may not be an argument, whatever the template says.
 *
 * Reasons, in the order they matter: a generated identifier is one row's id and would
 * pin the call to data that changes; a purely numeric value is the same thing wearing
 * no prefix; a secret-shaped value must never be written into a spec at all; and an
 * empty value identifies nothing.
 */
export function rejectValue(value: string): string | null {
  const text = (value ?? '').trim();
  if (!text)
    return 'the extracted value is empty';
  if (analyseIdentifier(text).dynamic)
    return `"${text}" is a generated identifier`;
  if (/^\d+$/.test(text))
    return 'the extracted value is a bare number, which identifies a row rather than describing one';
  if (looksLikeSecretValue(text))
    return 'the extracted value looks like a credential';
  return null;
}

/** Escape a string for use as a literal inside a RegExp. */
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Read the arguments out of a proven expression, using the template as the key.
 *
 * The template is turned into a pattern by replacing each parameter with a capture of
 * one quoted literal, and everything else is matched literally. So the match succeeds
 * only when the expression differs from the template in exactly the places the
 * parameters occupy - a different element, a different scope or an extra step in the
 * chain all fail to match, which is precisely what should happen.
 */
export function extractFromTemplate(
  template: string,
  expression: string,
  parameters: string[],
): ParameterExtraction[] | null {
  const order: string[] = [];
  let pattern = '';
  let rest = template;

  while (rest.length) {
    const next = parameters
        .map(parameter => ({ parameter, at: rest.search(new RegExp(`\\b${parameter}\\b`)) }))
        .filter(entry => entry.at >= 0)
        .sort((left, right) => left.at - right.at)[0];
    if (!next) {
      pattern += escape(rest);
      break;
    }
    pattern += escape(rest.slice(0, next.at));
    // One quoted literal, in either quote style, with no quote of that kind inside.
    pattern += `(?:'([^']*)'|"([^"]*)")`;
    order.push(next.parameter);
    rest = rest.slice(next.at + next.parameter.length);
  }

  // Quote style is not information: the template is written in the repository's
  // single quotes and the recorder emits double. Normalise ONLY the quotes around
  // the parts that are matched literally - never the captured values themselves.
  const normalise = (value: string): string => value.replace(/"/g, "'");
  const match = new RegExp(`^${pattern.replace(/"/g, "'")}$`).exec(normalise(expression));
  if (!match)
    return null;

  const captured = match.slice(1).filter((value): value is string => value !== undefined);
  if (captured.length !== order.length)
    return null;

  return order.map((parameter, index) => ({
    parameterName: parameter,
    value: captured[index],
    source: sourceOf(template, parameter) ?? 'unknown',
    expression,
    confidence: 'proven' as const,
  }));
}

/**
 * May this recorded target reuse this existing parameterised method?
 *
 * Every refusal returns the reason rather than a bare no, because the reasons are
 * what a person needs when deciding whether the row, the method or the recording is
 * what should change.
 */
export function resolveParameterisedReuse(input: {
  evidence: TargetEvidence;
  element: PageElement;
  method: IndexedMethod;
  role: TargetRole;
  /** The method's declared usage, when knowledge states one. */
  usage?: string | null;
}): ReuseOutcome {
  const { evidence, element, method, role } = input;

  // ACTION AND ASSERTION ARE DIFFERENT METHODS. Where knowledge says which a method
  // is for, a target of the other kind may not have it - a structurally similar
  // locator is not permission to read a control as if it had been pressed.
  const usage = (input.usage ?? '').trim().toLowerCase();
  if (usage && usage !== role)
    return { status: 'NEEDS_REVIEW', reason: `${element.page_object_method}() is declared for ${usage}, not ${role}` };

  const template = templateOf(element, method);
  if (!template)
    return { status: 'NEEDS_REVIEW', reason: 'the knowledge entry declares no locator template for this parameter' };

  // THE PROOF IS THE ONLY EXPRESSION THAT MAY BE READ. A claim-time measurement, a
  // count without an identity, or a measurement from another document all fail here
  // exactly as they fail everywhere else in this pipeline.
  const candidate = provenCandidate(evidence, role);
  if (!candidate || !provesIdentity(candidate, role)) {
    return {
      status: 'NEEDS_REVIEW',
      reason: role === 'assertion'
        ? 'no candidate was measured at the press or at the pick, in that document, at one '
          + 'element that was the element asserted about'
        : 'no candidate was measured at the press, in the press\'s document, at one element '
          + 'that was the element acted on',
    };
  }

  const required = (method.params ?? []).filter(parameter => !parameter.optional);
  if (required.some(parameter => (parameter.type ?? '') !== 'string'))
    return { status: 'NEEDS_REVIEW', reason: 'a required parameter is not a string' };

  const extracted = extractFromTemplate(template, candidate.expression ?? '', required.map(parameter => parameter.name));
  if (!extracted) {
    return {
      status: 'NEEDS_REVIEW',
      reason: 'the proven expression does not match the method\'s template, so the value it needs is not in this recording',
    };
  }
  if (extracted.length !== required.length)
    return { status: 'NEEDS_REVIEW', reason: 'not every declared parameter could be read from the recording' };

  for (const parameter of extracted) {
    const problem = rejectValue(parameter.value);
    if (problem)
      return { status: 'NEEDS_REVIEW', reason: problem };
  }

  // ROUND TRIP. Put the values back and the result must BE the proven expression.
  // This is what carries the identity proof across: the locator a call would build
  // is the same string the browser measured at one element, in the right document,
  // and confirmed to be the element pressed.
  let rebuilt = template;
  for (const parameter of extracted)
    rebuilt = rebuilt.replace(new RegExp(`\\b${parameter.parameterName}\\b`), `'${parameter.value}'`);
  if (rebuilt.replace(/"/g, "'") !== (candidate.expression ?? '').replace(/"/g, "'")) {
    return {
      status: 'NEEDS_REVIEW',
      reason: 'substituting the extracted value does not reproduce the proven expression',
    };
  }

  return { status: 'REUSE_PARAMETERIZED', parameters: extracted, expression: candidate.expression ?? '' };
}
