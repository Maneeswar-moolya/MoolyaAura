/**
 * Does the contract a row declares actually witness the result it claims?
 *
 * The data-driven contract is four outcomes, and each one witnesses a different
 * thing:
 *
 *   Signed In   the submission was accepted and the page moved on
 *   Error       the application rejected it and said so, in words
 *   Blocked     the submission never left the page and nothing appeared
 *   Visible     it was accepted AND every item named in `expect` is on the page
 *
 * Nothing stopped an author from pairing an Expected Result of "Check My
 * Favourites is displayed" with `Assert Outcome = Signed In`. That row passes
 * the moment the browser lands on /apps, having never looked for My Favourites -
 * a green test that proves nothing, which is worse than no test, because a red
 * one gets investigated and a green one gets trusted.
 *
 * This module is the check the workbook was missing: when the Expected Result
 * claims something is *on the screen*, only an outcome that looks at the screen
 * can prove it. `Error` looks (it reads the message). `Visible` looks (it reads
 * the named items). `Signed In` and `Blocked` do not.
 *
 * It never invents an assertion from prose. It derives the repair only from
 * item names the author already wrote down, and when it cannot find any it says
 * so and refuses - "all should be visible" names nothing a browser can look for,
 * and guessing what "all" meant would replace a green lie with a red one.
 *
 * There is a second way a row goes green having proved nothing, and matching the
 * outcome to the claim does not catch it: the *actions*. The data-driven runners
 * do exactly one thing - open a page, fill the named fields, press one control.
 * A row whose Steps say "Click My Favourites, then check the header" declares
 * work that never happens, and `Visible` then finds the words in the navigation
 * that were on screen before the click. The assertion is honest; it is simply
 * asserting against the wrong screen. So the steps are checked too.
 */

import type { Outcome } from './data-driven';

/**
 * Words that make a sentence a claim about what is on the screen.
 *
 * Deliberately narrow. "The form refuses the submission and the user stays on
 * the sign-in page" is a claim about behaviour, not presence, and a `Blocked`
 * row proves it exactly. Widening these patterns until they matched that
 * sentence would flag eight correct rows to catch two wrong ones.
 */
const PRESENCE_PREDICATE =
  /\b(?:is|are|was|were|should\s+be|shall\s+be|must\s+be|will\s+be|to\s+be)\s+(?:displayed|visible|shown|present|available|there)\b|\b(?:displays?|shows?|lists?|contains?|is\s+showing)\b/i;

/** "Check X is present", "verify the menus appear" - the imperative form. */
const PRESENCE_INTENT =
  /\b(?:check|verify|validate|ensure|confirm|assert)\b[^.;]{0,80}?\b(?:present|displayed|display|visible|shown|appears?|available)\b/i;

/** True when the text claims something can be seen on the page. */
export function assertsPresence(text: string): boolean {
  return PRESENCE_PREDICATE.test(text) || PRESENCE_INTENT.test(text);
}

/**
 * Quantifiers and pronouns. A subject made only of these names nothing: "all"
 * is not something `getByRole` can look for.
 */
const STOP = new Set([
  'all', 'everything', 'every', 'each', 'both', 'any', 'some', 'none', 'it', 'they', 'them',
  'this', 'that', 'these', 'those', 'there', 'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on',
  'at', 'to', 'be', 'been', 'should', 'shall', 'must', 'will', 'is', 'are', 'was', 'were',
  'their', 'its', 'user', 'users',
]);

/**
 * Nouns that describe a *kind* of thing rather than name one. "the fields" is
 * not a locator; "My Favourites" is.
 */
const GENERIC = new Set([
  'field', 'fields', 'menu', 'menus', 'item', 'items', 'element', 'elements', 'option',
  'options', 'button', 'buttons', 'link', 'links', 'tab', 'tabs', 'page', 'pages', 'section',
  'sections', 'screen', 'screens', 'data', 'detail', 'details', 'information', 'thing',
  'things', 'content', 'contents', 'list', 'lists', 'value', 'values', 'text', 'label',
  'labels', 'icon', 'icons', 'header', 'headers', 'footer', 'result', 'results', 'control',
  'controls', 'component', 'components', 'widget', 'widgets', 'form', 'forms',
]);

const WORD = /[A-Za-z0-9][A-Za-z0-9'’-]*/g;

/**
 * Does this phrase name something, as opposed to describing a category of
 * things? It has to carry a capitalised word that is neither a quantifier nor a
 * generic noun - which is how the names people put in a UI are written, and how
 * `assertAllVisible` will have to look for them.
 */
function namesSomething(phrase: string): boolean {
  return (phrase.match(WORD) ?? []).some(word =>
    /^[A-Z]/.test(word) && !STOP.has(word.toLowerCase()) && !GENERIC.has(word.toLowerCase()));
}

function tidy(phrase: string): string {
  return phrase
      .replace(/^\s*(?:check|verify|validate|ensure|confirm|assert)\s+/i, '')
      .replace(/^\s*(?:that|whether|if)\s+/i, '')
      .replace(/^\s*(?:the|a|an)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
}

/** The clause-level patterns that expose the subject of a presence claim. */
const SUBJECT_PATTERNS = [
  /^(.*?)\b(?:is|are|was|were|should\s+be|shall\s+be|must\s+be|will\s+be|to\s+be)\s+(?:displayed|visible|shown|present|available|there)\b/i,
  /\b(?:check|verify|validate|ensure|confirm|assert)\s+(?:that\s+|whether\s+|if\s+)?(.*?)\b(?:is|are|should|must|will|appears?)\b/i,
  /\b(?:check|verify|validate|ensure|confirm|assert)\s+(?:that\s+|whether\s+|if\s+)?(.*?)\b(?:present|displayed|visible|shown|available)\b/i,
  // "the dashboard shows Reports and Settings" - here the items come *after*
  // the verb, and the subject is the thing doing the showing.
  /\b(?:displays?|shows?|lists?|contains?)\s+(.+)$/i,
];

/**
 * The items an Expected Result names as needing to be on the page.
 *
 * Empty means the text claims presence but names nothing checkable, which is
 * the case that must be refused rather than repaired.
 *
 * Quoted text wins outright - an author who wrote "the 'Team Projects' tab"
 * has already told us the exact string. Otherwise the subject of the presence
 * claim is split on the separators people use for a list.
 *
 * A comma-separated list keeps every part, including ones that would be thrown
 * out on their own: "My Favourites, All, Team Projects" is three menu names,
 * and "All" is one of them. A single bare part must stand on its own merits,
 * which is what stops "all should be visible" from becoming `expect = All`.
 */
export function namedItems(text: string): string[] {
  const quoted = [...text.matchAll(/["'“”‘’`]([^"'“”‘’`\r\n]{2,60})["'“”‘’`]/g)]
      .map(match => match[1].trim())
      .filter(Boolean);
  if (quoted.some(namesSomething))
    return dedupe(quoted).slice(0, 6);

  for (const clause of text.split(/[.;\r\n]+/)) {
    if (!clause.trim())
      continue;
    for (const pattern of SUBJECT_PATTERNS) {
      const subject = pattern.exec(clause)?.[1];
      if (subject === undefined)
        continue;
      const parts = tidy(subject)
          .split(/\s*(?:,|\band\b|&|\/)\s*/i)
          .map(part => tidy(part))
          .filter(part => part.length > 1 && part.length <= 60);
      if (!parts.length)
        continue;
      // One part has to be a real name before the list is trusted at all.
      if (!parts.some(namesSomething))
        continue;
      return dedupe(parts.length > 1 ? parts : parts.filter(namesSomething)).slice(0, 6);
    }
  }
  return [];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toLowerCase();
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

/**
 * Verbs that make a step an interaction with the page.
 *
 * `enter`/`type`/`fill` are absent on purpose - the runner fills every named
 * field, so those steps are already performed. So are `wait` and the assertion
 * verbs. What is left is the class the runner performs exactly once.
 */
const INTERACT_VERB =
  /\b(?:double[-\s]?click|right[-\s]?click|clicks?|clicked|clicking|taps?|presses|press|selects?|select|chooses?|choose|hovers?|hover|drags?|drag|uploads?|upload|scrolls?|scroll|expands?|expand|collapses?|collapse|toggles?|toggle|switch(?:es)?\s+to|dismiss(?:es)?|navigates?\s+to\s+the\s+\w+\s+(?:tab|menu))\b/i;

/**
 * Names a control that plausibly submits the form the runner filled. Kept to
 * words that end a form rather than move through one: `delete`, `add` and `edit`
 * are deliberately absent, because those are mid-flow actions and treating them
 * as the submit would let exactly the rows this check exists for slip through.
 */
const SUBMIT_WORD =
  /\b(?:sign\s*in|signin|log\s*in|login|sign\s*up|signup|register|submit|continue|proceed|next|save|create|apply|search|send|confirm|done|ok|go|enter)\b/i;

/** The object of an interaction step: what the author says to click. */
function interactionObject(step: string): string {
  const verb = INTERACT_VERB.exec(step);
  if (!verb)
    return '';
  return step
      .slice(verb.index + verb[0].length)
      // "Click Sign In and navigate to dashboard" is one action; everything
      // after the conjunction narrates its consequence.
      .split(/\s+(?:and|then|,|;|to\s+navigate|in\s+order\s+to)\s+/i)[0]
      // Nouns that describe what kind of control it is, not which one.
      .replace(/\b(?:the|a|an|on|onto|option|options|menu|button|link|tab|icon|item|control|element|from|of)\b/gi, ' ')
      .replace(/[^A-Za-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
}

/**
 * Steps that describe an interaction the data-driven runner will not perform.
 *
 * The runner presses one control. The first step that names it is that press;
 * anything else - a different control, or a second press - is work the row
 * declares and the run does not do. A row like that is not a broken assertion,
 * it is a case whose *actions* are its point, and those need a written spec.
 */
export function unsupportedActions(steps: readonly string[], submit?: string): string[] {
  const named = (submit ?? '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const isSubmit = (object: string): boolean => {
    if (!object)
      return true; // "Click submit" with nothing after it: assume the obvious.
    if (named)
      return object.toLowerCase().includes(named) || named.includes(object.toLowerCase());
    return SUBMIT_WORD.test(object);
  };

  const unsupported: string[] = [];
  let submitsSeen = 0;
  for (const step of steps) {
    if (!INTERACT_VERB.test(step))
      continue;
    const object = interactionObject(step);
    if (isSubmit(object) && submitsSeen === 0) {
      submitsSeen++;
      continue;
    }
    unsupported.push(step.trim());
  }
  return unsupported;
}

export interface ContractGap {
  /** What is wrong, addressed to whoever wrote the row. */
  message: string;
  /**
   * A contract that would prove the claim, when one follows from what the
   * author already wrote. Absent means the row needs a human decision.
   */
  repair?: { outcome: Outcome; expect: string };
  /**
   * The row cannot be data-driven at all, whatever outcome it declares. The
   * repair is to leave Assert Outcome blank and let a spec carry the case.
   */
  clearOutcome?: boolean;
}

export interface ContractClaim {
  scenario: string;
  expectedResult: string;
  outcome: Outcome;
  /** Input names parsed from Test Data. Only `expect` matters here. */
  inputNames: Iterable<string>;
  /** The Steps column. Checked against what the runner actually performs. */
  steps?: readonly string[];
  /** `submit = ...` from Test Data, when the row named the control to press. */
  submit?: string;
}

/**
 * The gap between what a row claims and what its contract can witness.
 *
 * `null` means the contract proves the claim - which is the answer for every
 * row that does not make a presence claim at all.
 */
export function contractGap(claim: ContractClaim): ContractGap | null {
  // Checked first, and for every outcome: an assertion that matches the claim
  // perfectly still proves nothing if it runs against a screen the row never
  // reached. There is no repair - the missing work is a click, and no rule can
  // invent one. The row belongs in a spec, which is what clearing the outcome
  // asks for.
  const skipped = unsupportedActions(claim.steps ?? [], claim.submit);
  if (skipped.length) {
    return {
      message:
        'The data-driven runner opens the page, fills the named fields and presses one control - ' +
        'that is all it does. These steps ask for more:\n' +
        skipped.map(step => `    - ${step}`).join('\n') + '\n' +
        `  They never run, so Assert Outcome = ${claim.outcome} is checked against the screen ` +
        'straight after the submission rather than the one the steps describe. A row whose ' +
        'actions are the point of the case needs a written spec: clear Assert Outcome and one ' +
        'gets generated, with Test Data left as notes for it.',
      clearOutcome: true,
    };
  }

  const text = `${claim.expectedResult}\n${claim.scenario}`.trim();
  if (!text || !assertsPresence(text))
    return null;

  // Error reads the message off the page; Visible reads the named items. Both
  // look at the screen, so both can witness a presence claim.
  if (claim.outcome === 'Error' || claim.outcome === 'Visible')
    return null;

  const quoted = claim.expectedResult.trim() || claim.scenario.trim();
  const items = namedItems(text);
  const alreadyListed = [...claim.inputNames].some(name => name.toLowerCase() === 'expect');

  if (claim.outcome === 'Blocked') {
    return {
      message:
        'Assert Outcome = Blocked asserts that the submission was refused and that nothing ' +
        `appeared, but this row claims something is on the screen: "${quoted}". Both cannot be ` +
        'true, so as written the row goes green the moment the form refuses the input, having ' +
        'never looked for what it describes.\n' +
        '  A case about what a page shows has to submit something and then look: use ' +
        'Assert Outcome = Visible with an "expect" line naming the items. A case about a page ' +
        'nobody submits to needs a written spec - the data-driven runner always submits.',
    };
  }

  // Signed In. It witnesses the door opening and nothing beyond it.
  const base =
    'Assert Outcome = Signed In only proves the submission was accepted and the page moved ' +
    `on, but this row claims something is on the screen: "${quoted}". As written it passes as ` +
    'soon as the page changes, having checked nothing.';

  if (alreadyListed) {
    return {
      message: `${base}\n  Test Data already names the items, so the outcome is the only thing ` +
        'out of step: use Assert Outcome = Visible, which checks them.',
      repair: { outcome: 'Visible', expect: '' },
    };
  }

  if (!items.length) {
    return {
      message: `${base}\n  Use Assert Outcome = Visible and add an "expect" line naming what ` +
        'must be there, e.g. expect = My Favourites, Team Projects. Naming them is the one part ' +
        'no rule can do for you - "all" and "the fields" are not things a browser can look for.',
    };
  }

  return {
    message: `${base}\n  Use Assert Outcome = Visible and add "expect = ${items.join(', ')}" to ` +
      'Test Data, so the run checks what the Expected Result promises.',
    repair: { outcome: 'Visible', expect: items.join(', ') },
  };
}
