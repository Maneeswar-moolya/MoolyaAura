/**
 * A test's scenario title, built from the SEMANTIC JOURNEY rather than from the DOM.
 *
 * TC_LOGIN_112 is why this exists. Its recorded title was
 *
 *   "#tr_1749558 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont
 *    > .rounded-checkbox-ui — 1749558 is ticked"
 *
 * which is a CSS chain and a generated issue id. `scenarioFrom` in the recorder builds
 * a title from `action.target`, and Codegen's `target` for an element with no
 * accessible name IS the selector - so the title inherited the selector, the generated
 * id and the row position all at once. Every one of those changes when the application
 * is redeployed or the test data is recreated, which makes the title an unstable name
 * for a stable test.
 *
 * THE RAW MATERIAL IS THE MAPPING, NOT THE RECORDING. A recorded action knows a
 * selector; a MAPPED step knows the Page Object and the method the element resolved
 * to - `IssuesPage.issueCheckbox` - and those are semantic by construction, because
 * the abstraction engine refuses to derive a method name from data or from a position.
 * So the journey is read from `mapRecording`'s output, after resolution, and the title
 * is made of the same words the Page Objects are made of.
 *
 * WHAT IS IGNORED, DELIBERATELY. Opening a URL, signing in, and the landing-screen
 * redirect are infrastructure: every authenticated test in the corpus performs them,
 * so they distinguish nothing and a title built from them says only "signed in". The
 * journey is what happened AFTER the application was reached.
 *
 * NOTHING IS INVENTED. Where no semantic material exists - every step a raw locator,
 * no assertion, no Page Object - this returns null and the caller keeps whatever the
 * workbook authored. A title is a claim about what the test means, and a guess at that
 * is worse than an ugly-but-honest one.
 */

import type { MappedStep, MappingResult } from './from-recording';

/* ------------------------------------------------------- what a title may not be */

/**
 * Shapes that must never reach a title, each with the reason it is refused.
 *
 * Checked against the WHOLE candidate string rather than tokenised, because a title
 * that merely contains `#tr_1749558` is as unstable as one made entirely of it.
 */
const FORBIDDEN_IN_TITLE: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /[#.][A-Za-z_][\w-]*\s*>/, why: 'a CSS descendant chain' },
  { pattern: /^\s*[#.][A-Za-z_][\w-]*/, why: 'a CSS selector' },
  { pattern: /\[[A-Za-z-]+\s*[~^|*$]?=/, why: 'an attribute selector' },
  { pattern: /\.(?:nth|first|last)\s*\(/, why: 'a positional selector' },
  { pattern: /\bxpath\s*=|\/\/\w+\[/, why: 'an XPath' },
  { pattern: /\bgetBy[A-Z]\w*\s*\(/, why: 'a locator expression' },
  { pattern: /\bpage\s*\.\s*locator\s*\(/, why: 'a locator expression' },
  { pattern: /\b\d{4,}\b/, why: 'a generated identifier' },
  { pattern: /\b[a-z]+(?:[-_][a-z0-9]+){2,}\b/i, why: 'a class or id token' },
];

/**
 * Why this text may not be a title, or null when it may.
 *
 * Exported because it is also the GATE: the assembler asks it of the authored title
 * before deciding whether to derive one, and a regression fixture asks it of every
 * title the deriver produces. One rule, both directions.
 */
export function unstableTitleReason(text: string): string | null {
  const value = (text ?? '').trim();
  if (!value)
    return 'the title is empty';
  for (const rule of FORBIDDEN_IN_TITLE) {
    if (rule.pattern.test(value))
      return `the title contains ${rule.why}`;
  }
  return null;
}

/* ------------------------------------------------------------ semantic vocabulary */

/** `issueCheckbox` -> `issue checkbox`. Method names are already the semantic words. */
export function humaniseMethod(method: string): string {
  return (method ?? '')
      .replace(/State$/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .trim();
}

/**
 * `IssuesPage` -> `Issues page`, `NotificationsPanel` -> `Notifications panel`.
 *
 * The trailing noun is kept rather than dropped: "on the Issues page" and "in the
 * Notifications panel" are different places, and a title that flattened both to
 * "Issues" would name two screens the same.
 */
export function humaniseScreen(pageObject: string): string {
  const words = (pageObject ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);
  if (!words.length)
    return '';
  const tail = words[words.length - 1].toLowerCase();
  return [...words.slice(0, -1), tail].join(' ');
}

/** `in the Notifications panel` / `on the Issues page` - the preposition the noun takes. */
function placePhrase(pageObject: string): string {
  const screen = humaniseScreen(pageObject);
  if (!screen)
    return '';
  return /panel|dialog|modal|menu|drawer$/.test(screen) ? `in the ${screen}` : `on the ${screen}`;
}

/* ------------------------------------------------------------- the journey itself */

/**
 * Steps that every authenticated recording performs, and which therefore describe none
 * of them.
 *
 * `authenticate` and `navigate` are kinds, so they are excluded by kind. The entry
 * point is excluded by NAME - `open()` is the method a knowledge file declares to reach
 * a screen, and a title saying "open the projects dashboard" would name the setup of
 * the test rather than its subject.
 */
function isInfrastructure(step: MappedStep): boolean {
  if (step.kind === 'authenticate' || step.kind === 'navigate')
    return true;
  if (step.pageObject === 'LoginPage')
    return true;
  return /^(open|goto|visit)$/.test(step.method ?? '');
}

export interface JourneyInputs {
  /** Page Objects the test drove, in order, infrastructure removed. */
  screens: string[];
  /** The method the test's last meaningful ACTION resolved to. */
  action: { pageObject: string; method: string } | null;
  /** The method the test's ASSERTION resolved to, when it resolved to one. */
  outcome: { pageObject: string; method: string } | null;
  /** The assertion's own phrasing, kept only when it is stable enough to use. */
  outcomePhrase: string | null;
}

/**
 * Read the semantic journey out of a mapping.
 *
 * Exported so a fixture can assert on the INPUTS as well as the sentence: a title is
 * a rendering decision and may reasonably be reworded, while "which screen, which
 * capability, which outcome" is the part that must be right.
 */
export function journeyOf(mapping: MappingResult, assertionPhrase?: string | null): JourneyInputs {
  const semantic = mapping.steps.filter(step => step.kind === 'page-object' && !isInfrastructure(step));

  // THE ASSERTION'S OWN WORDS, taken from the mapping rather than from the recording.
  //
  // An assertion step's `label` IS `assertionPhrase(assertion)` - the assembler sets it
  // at both emission sites - so the mapping already carries the sentence a person would
  // have written, and reading it here means the deriver needs the mapping alone. It is
  // still put through `unstableTitleReason` below: TC_LOGIN_112's phrase is
  // "1749558 is ticked", which is a generated id and no better than the selector it
  // would have replaced.
  const asserted = mapping.steps.filter(step => step.from.startsWith('assert '));
  const phrase = assertionPhrase ?? asserted[asserted.length - 1]?.label ?? null;

  const screens: string[] = [];
  for (const step of semantic) {
    if (step.pageObject && screens[screens.length - 1] !== step.pageObject)
      screens.push(step.pageObject);
  }

  // THE ASSERTION IS THE LAST SEMANTIC STEP THAT READS STATE, and the action is the
  // last one before it. A method whose name ends in `State` is an assertion form by
  // the abstraction engine's own naming rule, so the two are separable without
  // re-deriving anything.
  const stateSteps = semantic.filter(step => /State$/.test(step.method ?? ''));
  const outcomeStep = stateSteps[stateSteps.length - 1] ?? null;
  const actionSteps = semantic.filter(step => step !== outcomeStep && !/State$/.test(step.method ?? ''));
  const actionStep = actionSteps[actionSteps.length - 1] ?? null;

  return {
    screens,
    action: actionStep?.pageObject && actionStep.method
      ? { pageObject: actionStep.pageObject, method: actionStep.method } : null,
    outcome: outcomeStep?.pageObject && outcomeStep.method
      ? { pageObject: outcomeStep.pageObject, method: outcomeStep.method } : null,
    outcomePhrase: phrase && !unstableTitleReason(phrase) ? phrase.trim() : null,
  };
}

export interface DerivedTitle {
  title: string;
  inputs: JourneyInputs;
  /** Which semantic facts the sentence was built from, for the report. */
  why: string;
}

/**
 * Build the title, or return null when there is nothing semantic to build it from.
 *
 * The sentence is deliberately dull and formulaic. A title is an identifier that a
 * person reads in a run report and that `mapping sync` keys a workbook row on - so it
 * must be reproducible from the same mapping every time, which rules out anything that
 * reads like writing.
 */
export function deriveScenarioTitle(
  mapping: MappingResult,
  options: { assertionPhrase?: string | null; feature?: string | null } = {},
): DerivedTitle | null {
  const inputs = journeyOf(mapping, options.assertionPhrase);
  const place = inputs.screens.length ? placePhrase(inputs.screens[inputs.screens.length - 1]) : '';

  // 1. THE STRONGEST FORM: a capability was acted on and a state was read. This is the
  //    shape every checkbox, toggle and switch recording has, and it names all three
  //    of subject, action and outcome without touching a selector.
  if (inputs.action && inputs.outcome) {
    const subject = humaniseMethod(inputs.outcome.method);
    const acted = humaniseMethod(inputs.action.method);
    const title = subject === acted
      ? `Verify ${subject} selection ${place}`.trim()
      : `Verify ${subject} after ${acted} ${place}`.trim();
    return { title: tidy(title), inputs, why: 'action method + state method + screen' };
  }

  // 2. A capability was acted on and the assertion is phrased stably. The phrase is
  //    used verbatim: it came from the person who recorded the assertion, and where it
  //    survives `unstableTitleReason` it says more than a rendering of the method does.
  if (inputs.action && inputs.outcomePhrase) {
    return {
      title: tidy(`Verify ${inputs.outcomePhrase} after ${humaniseMethod(inputs.action.method)} ${place}`),
      inputs, why: 'action method + recorded assertion phrase + screen',
    };
  }

  // 3. Only an action. The test drove a capability and asserted nothing a Page Object
  //    describes, so the title names what it drove and claims no outcome.
  if (inputs.action)
    return { title: tidy(`Verify ${humaniseMethod(inputs.action.method)} ${place}`), inputs, why: 'action method + screen' };

  // 4. Only a state read. A pure verification test.
  if (inputs.outcome)
    return { title: tidy(`Verify ${humaniseMethod(inputs.outcome.method)} ${place}`), inputs, why: 'state method + screen' };

  // 5. Nothing semantic resolved, but the assertion phrase is stable and a screen is
  //    known. This is the weakest form that is still honest.
  if (inputs.outcomePhrase && place)
    return { title: tidy(`Verify ${inputs.outcomePhrase} ${place}`), inputs, why: 'recorded assertion phrase + screen' };

  // NOTHING IS INVENTED. Every step was a raw locator and the assertion names a
  // selector or a generated id: there is no semantic journey to describe, and saying
  // so is the correct answer.
  return null;
}

/** Collapse the spaces the optional clauses leave behind, and capitalise once. */
function tidy(sentence: string): string {
  const value = sentence.replace(/\s+/g, ' ').trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
