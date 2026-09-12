/**
 * What this test case actually requires of a screen.
 *
 * This replaces the extractor that was `terms()`: lowercase the row's prose, split on
 * spaces, keep every word longer than three characters that was not in a 69-word
 * stop-list, and call each survivor a "requirement". That filter was inverted. Twenty
 * of those 69 stop-words were the UI and action vocabulary - `button`, `field`,
 * `click`, `displayed`, `shown`, `select` - so "Check the Create Project button is
 * displayed" contributed `create` and `project` and threw away the two words that made
 * it a claim about a screen. Meanwhile any four-letter word nobody had thought to deny
 * survived as a requirement, and an unmatched requirement opens a browser.
 *
 * Measured consequence, from ai/reports/generation-metrics.jsonl: of the eight distinct
 * gap terms that ever opened a browser, six named nothing on any screen - `needs`,
 * `confirmation`, `recorded`, `strong`, `short`, `characters`. Four of the five browser
 * launches were caused by them, and three of those four were caused by prose THIS
 * TOOLKIT generated: `recorder.ts` writes the literal Expected Result "Needs
 * confirmation" when a recording contains no assertion, and titles an unnamed recording
 * "Recorded interaction". The pipeline was reading its own placeholders as facts to
 * verify about the application.
 *
 * So: classify clauses, do not tokenise prose. Everything here is deterministic, pure,
 * and closed - no I/O, no model, no browser, no heuristic that grows with the corpus.
 *
 * The rule that decides every ambiguous case: a word earns the right to open a browser
 * by being part of a phrase that names something on a screen or something done to it.
 * Anything else is dropped - not marked "covered", DROPPED. Those are different, and the
 * difference is the whole conservatism of this module. A false "covered" suppresses the
 * exploration that would have corrected a wrong assumption, and nothing downstream
 * catches it: the falsification gate proves a spec CAN fail, not that it asserts the
 * right thing. A dropped word makes no claim about the screen at all, so it cannot
 * license an assumption. What still opens a browser is a genuine UI phrase that the
 * knowledge does not account for - `notifications bell` must keep doing exactly that.
 */

import { PLACEHOLDER_TEXTS } from '../dashboard/placeholders';
import type { TestCase } from '../excel/types';

/**
 * Where a requirement came from, and it is not decoration - the field decides what the
 * text is allowed to mean.
 *
 * `steps` are what a person does, so they yield actions and the things acted on.
 * `expectedResult` is what should then be true, so it yields observable claims and
 * business assertions.
 *
 * `scenario` is absent on purpose. It is a title - derived by `scenarioFrom` for a
 * recorded row, hand-typed for an Excel one - and it was the single largest source of
 * phantom requirements: TC_LOGIN_028's entire gap set (`strong`, `needs`,
 * `confirmation`) came from a scenario cell reading `Strong`. It still reaches the
 * agent in the prompt, and `selectPageKnowledge` still scores against it; it simply
 * cannot, by itself, send anybody to open a browser.
 *
 * `testData`, `preconditions`, `description`, `module` and `feature` were never
 * requirement sources and are not becoming ones.
 */
export type RequirementSource = 'steps' | 'expectedResult';

export type RequirementClass =
  /** Something a browser could be opened to look at: an element, its state, its copy. */
  | 'ui-observable'
  /** Something a person does to the application. Its target is a UI thing. */
  | 'action'
  /**
   * A claim about data or a rule rather than about a screen - "the password is too
   * short", "the email is invalid". Recorded, counted, and deliberately NOT a browser
   * requirement: no screen has to be inspected to learn that a rule exists. It becomes
   * `ui-observable` the moment the clause also names a surface that shows it, which is
   * the difference between "Password is too short" and "The password field shows an
   * error when it is too short".
   */
  | 'business-assertion';

export interface Requirement {
  /** The noun phrase itself, lower-cased: `create project button`, `notifications bell`. */
  phrase: string;
  class: RequirementClass;
  sourceField: RequirementSource;
  /** The clause it was read from, verbatim, so a decision can be audited. */
  clause: string;
  /** Why this clause produced a requirement of this class. */
  reason: string;
  /** The UI surface noun that qualified it, when one did. */
  surface: string | null;
  /** True when the phrase came from quoted or capitalised copy - the application's own words. */
  quoted: boolean;
}

export type DropKind =
  /** Prose this toolkit generated to mean "nothing was stated". */
  | 'placeholder'
  /** Ordinary English that names no surface, no state and no action. */
  | 'generic';

export interface DroppedClause {
  clause: string;
  sourceField: RequirementSource;
  kind: DropKind;
  reason: string;
}

export interface RequirementCounts {
  requirementCount: number;
  actionCount: number;
  uiObservableCount: number;
  businessAssertionCount: number;
  genericDroppedCount: number;
  placeholderDroppedCount: number;
  requirementSourceCounts: Record<RequirementSource, number>;
}

export interface ExtractionResult {
  requirements: Requirement[];
  dropped: DroppedClause[];
  counts: RequirementCounts;
}

/* ------------------------------------------------------------------ vocabularies */

/**
 * Things a screen is made of.
 *
 * Closed, and it may contain nouns naming UI - which is exactly what NON_INSPECTABLE
 * may never contain. The two lists pull in opposite directions and that is the point:
 * this one admits a requirement, that one suppresses a gap, and a mistake here costs a
 * browser launch while a mistake there costs a wrong assumption nothing detects.
 */
const UI_SURFACES = new Set([
  'button', 'buttons', 'field', 'fields', 'input', 'inputs', 'textbox', 'textarea',
  'checkbox', 'checkboxes', 'radio', 'dropdown', 'combobox', 'menu', 'submenu',
  'heading', 'header', 'subheader', 'title', 'label', 'placeholder', 'tooltip',
  'option', 'options', 'message', 'error', 'errors', 'warning', 'toast', 'snackbar',
  'alert', 'banner', 'notification', 'notifications', 'bell', 'badge', 'counter',
  'tab', 'tabs', 'strip', 'icon', 'logo', 'image', 'avatar', 'link', 'links',
  'dialog', 'modal', 'popup', 'overlay', 'form', 'page', 'screen', 'view',
  'list', 'listing', 'table', 'grid', 'row', 'column', 'cell', 'card', 'tile',
  'section', 'panel', 'sidebar', 'navigation', 'breadcrumb', 'footer',
  'spinner', 'loader', 'progress', 'calendar', 'datepicker', 'picker',
  'slider', 'toggle', 'switch', 'checkmark', 'cursor', 'scrollbar',
  'url', 'route', 'dashboard', 'popover',
]);

/**
 * Verbs whose object is a thing on the screen. "Click the notifications bell" names an
 * element, so the target is a requirement.
 */
const ELEMENT_VERBS = new Set([
  'click', 'tap', 'press', 'select', 'choose', 'upload', 'navigate', 'go', 'open',
  'submit', 'hover', 'check', 'uncheck', 'close', 'cancel', 'confirm', 'switch',
  'toggle', 'scroll', 'drag', 'drop', 'login', 'logout', 'signin', 'signout',
]);

/**
 * Verbs whose object is a VALUE, not an element - and the distinction earned its place
 * by measurement.
 *
 * "Enter the email address", "Enter three spaces as the project name", "Enter the
 * correct password": the words after the verb are data a person types, and no browser
 * has to be opened to find out what an email address is. Treating them as UI targets
 * made `email address` an unanswered requirement on eight rows of the real workbook and
 * sent every one of them to a browser - the same class of false positive as `needs` and
 * `confirmation`, arriving by a different route.
 *
 * The value is only a requirement when the clause also names the surface it goes into
 * ("enter the email in the Email field" -> `email field`), which is the same promotion
 * rule class C already uses.
 */
const DATA_VERBS = new Set([
  'enter', 'type', 'fill', 'paste', 'copy', 'clear', 'search', 'give', 'provide',
  'input', 'set', 'write', 'append', 'leave', 'keep',
]);

/** What a person does. Closed; inflections are handled by `baseForm`. */
const ACTION_VERBS = new Set([...ELEMENT_VERBS, ...DATA_VERBS]);

/**
 * Verbs that introduce an observation rather than perform one.
 *
 * "Verify the heading reads All Projects" is an observable claim, not an action - the
 * person is not doing anything to the heading. Kept separate from ACTION_VERBS so the
 * class is right; both strip the verb before the noun phrase is read.
 */
const OBSERVE_VERBS = new Set([
  'verify', 'validate', 'assert', 'ensure', 'confirm', 'observe', 'see', 'view',
  'expect', 'inspect', 'notice', 'watch',
]);

/** States and behaviours a browser can witness. */
const OBSERVABLE_PREDICATES = new Set([
  'displayed', 'display', 'displays', 'visible', 'invisible', 'hidden', 'present',
  'shown', 'show', 'shows', 'appear', 'appears', 'appearing', 'disappear', 'disappears',
  'enabled', 'disabled', 'greyed', 'grayed', 'selected', 'unselected', 'deselected',
  'checked', 'unchecked', 'highlighted', 'active', 'inactive', 'focused', 'focus',
  'empty', 'blank', 'populated', 'filled', 'cleared', 'contains', 'contain',
  'containing', 'reads', 'listed', 'lists', 'exists', 'expanded', 'collapsed',
  'opens', 'opened', 'opening', 'closes', 'closed', 'closing',
  'redirects', 'redirected', 'navigates', 'navigated', 'lands', 'loads', 'loaded',
  'changes', 'changed', 'updates', 'updated', 'working', 'works', 'masked',
]);

/**
 * Claims about data and rules.
 *
 * A row can assert every one of these without anybody looking at a screen, so on their
 * own they produce no browser requirement. `strong` and `short` are here because that
 * is what they are - judgements about a password, not things on a page.
 */
const BUSINESS_PREDICATES = new Set([
  'valid', 'invalid', 'mandatory', 'required', 'optional', 'short', 'long', 'strong',
  'weak', 'registered', 'unregistered', 'rejected', 'accepted', 'refused', 'denied',
  'allowed', 'blocked', 'successful', 'success', 'unsuccessful', 'failure', 'failed',
  'duplicate', 'unique', 'correct', 'incorrect', 'wrong', 'matching', 'mismatched',
  'expired', 'locked', 'limit', 'maximum', 'minimum', 'length', 'trimmed', 'created',
  'saved', 'deleted', 'updated', 'sent', 'received',
]);

/**
 * Words that carry grammar rather than meaning, trimmed out of a noun phrase.
 *
 * Not a stop-list over the whole row - that is the mistake this module exists to
 * correct. These are only ever removed from the EDGES of an already-identified phrase,
 * so `terms and conditions page` keeps its middle intact.
 */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'and', 'or', 'but', 'if', 'then', 'than', 'that', 'which', 'who', 'whom', 'whose',
  'this', 'these', 'those', 'it', 'its', 'their', 'his', 'her', 'they', 'them',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'about',
  'as', 'no', 'not', 'should', 'shall', 'must', 'will', 'would', 'can', 'could',
  'may', 'might', 'do', 'does', 'did', 'has', 'have', 'had', 'get', 'gets', 'got',
  'when', 'while', 'after', 'before', 'again', 'also', 'only', 'very', 'too', 'so',
  'please', 'kindly', 'now', 'here', 'above', 'below', 'via',
  'you', 'your', 'yours', 'we', 'us', 'our', 'me', 'my', 'mine', 'him', 'she', 'he',
  'there', 'here', 'up', 'down', 'out', 'off', 'over', 'under', 'user', 'users',
  'test', 'case', 'step', 'steps', 'expected', 'result', 'application', 'app',
  'system', 'successfully', 'properly', 'correctly', 'able',
]);

/**
 * Names of markup, not of anything a person is shown.
 *
 * Playwright Codegen falls back to a tag name when an element has no accessible name, so
 * a recorded step can read "Click Div". No browser visit can answer what `div` is - it is
 * the absence of a name, not a name - so it is dropped rather than explored. Closed, and
 * deliberately excluding words that are also real UI vocabulary (`input`, `label`,
 * `option`, `table`, `form` are surfaces and stay surfaces).
 */
const MARKUP_TOKENS = new Set([
  'div', 'span', 'td', 'tr', 'th', 'tbody', 'thead', 'ul', 'ol', 'li', 'br', 'hr',
  'iframe', 'svg', 'nbsp', 'dom', 'css', 'xpath', 'html', 'nav', 'aside',
]);

/** Suffix stripping, deliberately tiny: only what an English verb does regularly. */
function baseForm(word: string): string {
  for (const [suffix, replacement] of [['ing', ''], ['ed', ''], ['es', ''], ['s', '']] as const) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const stem = word.slice(0, word.length - suffix.length) + replacement;
      if (ACTION_VERBS.has(stem) || OBSERVE_VERBS.has(stem))
        return stem;
      // Doubled consonant, as in `clicking` -> `click` (already handled) or
      // `submitted` -> `submit`.
      const undoubled = stem.replace(/([a-z])\1$/, '$1');
      if (ACTION_VERBS.has(undoubled) || OBSERVE_VERBS.has(undoubled))
        return undoubled;
      const withE = `${stem}e`;
      if (ACTION_VERBS.has(withE) || OBSERVE_VERBS.has(withE))
        return withE;
    }
  }
  return word;
}

/**
 * Does this word DO something to the application?
 *
 * Exported because the session grouping asks the same question of a step - "is
 * there work left after the sign-in, or only looking?" - and a second verb list
 * would drift from this one. Behaviour here is unchanged.
 */
export function isActionVerb(word: string): boolean {
  return ACTION_VERBS.has(word) || ACTION_VERBS.has(baseForm(word));
}

/** Does this word merely LOOK at the application? Exported for the same reason. */
export function isObserveVerb(word: string): boolean {
  return OBSERVE_VERBS.has(word) || OBSERVE_VERBS.has(baseForm(word));
}

/** A surface, allowing the regular plural the UI_SURFACES list does not spell out. */
function isSurface(word: string): boolean {
  if (UI_SURFACES.has(word))
    return true;
  return word.endsWith('s') && UI_SURFACES.has(word.slice(0, -1));
}

/* --------------------------------------------------- protecting the real copy */

const MASK_OPEN = '';
const MASK_CLOSE = '';

/**
 * The application's own words, kept whole.
 *
 * Two spans qualify: anything quoted, and any run of Capitalised Words - which is how
 * Bugasura's copy appears in these rows ("Create New Project", "My Favourites", "Terms
 * and Conditions"). They are masked to a single token BEFORE any splitting, which is
 * what stops ` and ` from cutting "Terms and Conditions" in half. It also stops the
 * phrase builder from trimming `and` out of the middle of it.
 *
 * A leading verb is excluded from the span. "Check Terms and Conditions" would
 * otherwise mask as `Check Terms and Conditions` and make the sentence's own imperative
 * part of the application's copy - and then "Click Sign In" would produce the
 * requirement `click sign in`, which names no element.
 */
function protectSpans(text: string): { masked: string; spans: string[] } {
  const spans: string[] = [];
  const mask = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed)
      return raw;
    spans.push(trimmed);
    return `${MASK_OPEN}${spans.length - 1}${MASK_CLOSE}`;
  };

  // A URL is an address, not an element. Left in, `https://my.bugasura.io/` tokenised to
  // `httpsmy` and became an unanswered requirement on three rows. The navigation it
  // belongs to is still an action; it just has nothing on a screen as its object.
  let masked = text.replace(/\bhttps?:\/\/\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+){2,}\S*/gi, ' ');

  masked = masked.replace(/"([^"]{1,80})"|'([^']{1,80})'|“([^”]{1,80})”/g,
      (_full, a, b, c) => mask(a ?? b ?? c));

  // `[ \t]` and never `\s`, because `\s` crosses a newline and steps arrive newline
  // separated. It cost the first fixture run two requirements: "Sign in to
  // Bugasura\nClick the notifications bell" masked "Bugasura Click" as one span, which
  // swallowed the step boundary AND hid the imperative inside a span - so the clause had
  // no action verb, fell through to the bare-surface rule, and produced `header` instead
  // of `notifications bell`. A masked verb is an invisible one.
  masked = masked.replace(
      /\b[A-Z][A-Za-z0-9]*(?:[ \t]+(?:and|of|the|for|to|&)[ \t]+[A-Z][A-Za-z0-9]*|[ \t]+[A-Z][A-Za-z0-9]*)+/g,
      match => {
        const words = match.split(/\s+/);
        // Drop a leading imperative, and the connector it leaves behind: both belong to
        // the sentence, not to the copy. The connector alternative in the pattern above
        // is what makes "Click the Sign In button" match from `Click`, so without this
        // the span is "the Sign In" and the requirement reads `the sign in`.
        while (words.length > 1
          && (isActionVerb(words[0].toLowerCase()) || isObserveVerb(words[0].toLowerCase())
            || FUNCTION_WORDS.has(words[0].toLowerCase())))
          words.shift();
        if (words.length < 2)
          return match;
        const span = words.join(' ');
        return match.slice(0, match.length - span.length) + mask(span);
      });

  return { masked, spans };
}

function unmask(token: string, spans: string[]): string | null {
  const found = new RegExp(`^${MASK_OPEN}(\\d+)${MASK_CLOSE}$`).exec(token);
  return found ? spans[Number(found[1])] ?? null : null;
}

/* ------------------------------------------------------------------- clauses */

/**
 * One statement per clause.
 *
 * Sentence marks, semicolons, newlines and ` then ` always split. ` and ` splits ONLY
 * when what follows opens with a verb - "click Save and check the toast" is two
 * statements, "Terms and Conditions" is one thing and by this point is a single masked
 * token anyway.
 */
function clausesOf(text: string, spans: string[]): string[] {
  return text
      .split(/[.;!?\n]+|\s+then\s+/i)
      .flatMap(part => {
        const pieces: string[] = [];
        let current: string[] = [];
        const words = part.trim().split(/\s+/).filter(Boolean);
        words.forEach((word, index) => {
          const next = words[index + 1]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
          if (/^and$/i.test(word) && current.length && (isActionVerb(next) || isObserveVerb(next))) {
            pieces.push(current.join(' '));
            current = [];
            return;
          }
          current.push(word);
        });
        if (current.length)
          pieces.push(current.join(' '));
        return pieces;
      })
      .map(clause => clause.trim())
      .filter(clause => clause.length > 1)
      // A clause that is nothing but a masked span is still a clause: "My Favourites".
      .filter(clause => clause !== '' && (clause.length > 2 || unmask(clause, spans) !== null));
}

interface Token {
  /** Lower-cased, punctuation stripped. Empty for a mask token. */
  word: string;
  /** The original text, or the unmasked span. */
  text: string;
  span: boolean;
}

function tokenise(clause: string, spans: string[]): Token[] {
  return clause
      .split(/\s+/)
      .map(raw => {
        // A mask token can arrive with punctuation attached, so the delimiters are
        // located inside the word rather than assumed to be the whole of it.
        const bare = new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`).exec(raw)?.[0] ?? raw;
        const span = unmask(bare, spans);
        if (span !== null)
          return { word: span.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim(), text: span, span: true };
        // Separators become a SPACE, never nothing. Deleting them fused
        // `visibility_off` into `visibilityoff` - a token that exists in no knowledge
        // file and in no test case, invented by the tokeniser itself, and it opened a
        // browser for TC_LOGIN_026. The old extractor split on the same boundary.
        const word = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return { word, text: raw, span: false };
      })
      .filter(token => token.word.length > 0);
}

/**
 * The noun phrase around an anchor token.
 *
 * Expands outwards over content words only - never over a function word, a verb or a
 * predicate - and caps at four tokens, because a longer "phrase" is a sentence and will
 * match nothing. A masked span counts as one token and is taken whole.
 */
function nounPhraseAround(tokens: Token[], anchor: number, leftOnly = false): string {
  // Quoted or capitalised copy IS the requirement - expanding it glues the sentence onto
  // the application own words ("error" + "Project name cannot be empty").
  if (tokens[anchor].span)
    return tokens[anchor].word;
  const isContent = (token: Token): boolean => token.span
    || (!FUNCTION_WORDS.has(token.word)
      && !isActionVerb(token.word)
      && !isObserveVerb(token.word)
      && !OBSERVABLE_PREDICATES.has(token.word)
      && token.word.length > 1);

  let start = anchor;
  let end = anchor;
  while (start - 1 >= 0 && isContent(tokens[start - 1]) && end - start < 3)
    start -= 1;
  // Modifiers precede the noun in English, so a surface anchor only ever expands LEFT.
  // Expanding right took the verb with it - "field enforces", "email field rejects" - and
  // those phrases match nothing, so each one opened a browser.
  while (!leftOnly && end + 1 < tokens.length && isContent(tokens[end + 1]) && end - start < 3)
    end += 1;

  return tokens.slice(start, end + 1)
      .map(token => token.word)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
}

/** The phrase that follows an action verb: what is being clicked, filled, selected. */
function targetAfterVerb(tokens: Token[], verbIndex: number): string {
  for (let index = verbIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.span || (!FUNCTION_WORDS.has(token.word) && !OBSERVABLE_PREDICATES.has(token.word)
      && !BUSINESS_PREDICATES.has(token.word) && !isActionVerb(token.word) && !isObserveVerb(token.word)))
      return nounPhraseAround(tokens, index);
  }
  return '';
}

/* --------------------------------------------------------------- classification */

function isPlaceholder(clause: string): boolean {
  const normalised = clause.trim().replace(/\s+/g, ' ').toLowerCase();
  return PLACEHOLDER_TEXTS.some(text => text.toLowerCase() === normalised);
}

function classifyClause(clause: string, sourceField: RequirementSource, spans: string[]):
{ requirements: Requirement[]; dropped: DroppedClause | null } {
  const original = clause.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g'),
      (_full, index) => spans[Number(index)] ?? '');

  if (isPlaceholder(original)) {
    return {
      requirements: [],
      dropped: {
        clause: original, sourceField, kind: 'placeholder',
        reason: `"${original}" is the wording this toolkit writes when nothing was stated, `
          + 'so it describes no screen',
      },
    };
  }

  const tokens = tokenise(clause, spans);
  if (!tokens.length)
    return { requirements: [], dropped: null };

  const isSurfaceToken = (token: Token): boolean => token.span
    ? token.word.split(' ').some(isSurface)
    : isSurface(token.word);
  const surfaceAt = (index: number): string | null => tokens[index].span
    ? tokens[index].word.split(' ').find(isSurface) ?? null
    : tokens[index].word;
  const isSubjectSurface = (index: number): boolean => isSurfaceToken(tokens[index]);

  const surfaceIndex = tokens.reduce((last, token, index) => isSurfaceToken(token) ? index : last, -1);
  const surface = surfaceIndex >= 0 ? surfaceAt(surfaceIndex) : null;
  /** Anything that could be the subject of a claim: a surface, or the app's own copy. */
  const subjectIndexes = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => token.span || isSurfaceToken(token))
      .map(({ index }) => index);
  const observableIndex = tokens.findIndex(token => OBSERVABLE_PREDICATES.has(token.word));
  const businessIndex = tokens.findIndex(token => BUSINESS_PREDICATES.has(token.word));
  const actionIndex = tokens.findIndex(token => !token.span && isActionVerb(token.word));
  const spanIndex = tokens.findIndex(token => token.span);

  const make = (
    phrase: string, requirementClass: RequirementClass, reason: string, quoted: boolean,
  ): { requirements: Requirement[]; dropped: DroppedClause | null } => {
    // Trimmed at the EDGES only. Filtering every word would cut the middle out of the
    // application's own copy - "Sign In" became `sign` because `in` is grammar
    // everywhere except inside a name.
    // ...and never for the application's own copy. "Sign In" trimmed to `sign`, because
    // `in` is grammar everywhere except inside a name - and `sign` matches nothing.
    const words = phrase.split(' ').filter(Boolean);
    if (!quoted) {
      while (words.length && FUNCTION_WORDS.has(words[0]))
        words.shift();
      while (words.length && FUNCTION_WORDS.has(words[words.length - 1]))
        words.pop();
    }
    const cleaned = words.join(' ').trim();
    if (words.length && words.every(word => MARKUP_TOKENS.has(word))) {
      return {
        requirements: [],
        dropped: {
          clause: original, sourceField, kind: 'generic',
          reason: `"${cleaned}" names markup rather than anything a person is shown - a `
            + 'recorder fell back to a tag name, and no browser can resolve that',
        },
      };
    }
    if (cleaned.length < 3) {
      return {
        requirements: [],
        dropped: {
          clause: original, sourceField, kind: 'generic',
          reason: 'no noun phrase survived - every word was grammar',
        },
      };
    }
    return {
      requirements: [{ phrase: cleaned, class: requirementClass, sourceField, clause: original, reason, surface, quoted }],
      dropped: null,
    };
  };

  // A — an observable claim. Needs something to be observed ABOUT: a surface, or the
  // application's own copy. "It should work properly" has a predicate and no subject,
  // and is not a requirement.
  //
  // One requirement per predicate, anchored on the surface NEAREST BEFORE it - because
  // that is where English puts the subject. Anchoring on the clause's last surface
  // instead lost the thing being asserted about: "The notifications bell is displayed
  // and the notification list opens" yielded only `notification list`, and the bell -
  // the entire point of the row - silently disappeared. Two claims in one clause are two
  // requirements.
  if (observableIndex >= 0 && (surfaceIndex >= 0 || spanIndex >= 0)) {
    const anchors = new Set<number>();
    tokens.forEach((token, index) => {
      if (!OBSERVABLE_PREDICATES.has(token.word))
        return;
      const before = subjectIndexes.filter(candidate => candidate < index).pop();
      const after = subjectIndexes.find(candidate => candidate > index);
      const anchor = before ?? after;
      if (anchor !== undefined)
        anchors.add(anchor);
    });
    const requirements = [...anchors].flatMap(anchor => make(
        nounPhraseAround(tokens, anchor, true), 'ui-observable',
        `"${tokens[observableIndex].word}" is a state a browser can witness, about `
        + `${isSubjectSurface(anchor) ? `the ${surfaceAt(anchor)}` : 'copy the row quotes'}`,
        tokens[anchor].span).requirements);
    if (requirements.length)
      return { requirements, dropped: null };
  }

  // C-promoted-to-A — a business rule that the row says is SHOWN somewhere. "The
  // password field shows an error when it is too short" is a screen fact; "the password
  // is too short" is not.
  if (businessIndex >= 0 && surfaceIndex >= 0) {
    return make(nounPhraseAround(tokens, surfaceIndex, true), 'ui-observable',
        `a business rule ("${tokens[businessIndex].word}") that this clause says the `
        + `${surface} shows`,
        tokens[surfaceIndex].span);
  }

  // B — an action. What counts as its target depends on the verb: an element verb acts
  // on something that is there, a data verb carries a value that is not.
  if (actionIndex >= 0) {
    const verb = tokens[actionIndex].word;
    const dataVerb = DATA_VERBS.has(verb) || DATA_VERBS.has(baseForm(verb));
    if (dataVerb) {
      if (surfaceIndex >= 0)
        return make(nounPhraseAround(tokens, surfaceIndex, true), 'ui-observable',
            `"${verb}" puts a value into the ${surface}, and the ${surface} is on the screen`,
            tokens[surfaceIndex].span);
      return {
        requirements: [],
        dropped: {
          clause: original, sourceField, kind: 'generic',
          reason: `"${verb}" carries a value rather than acting on something, and this clause `
            + 'names no field for it to go into - a value is not a thing to look at',
        },
      };
    }
    const target = targetAfterVerb(tokens, actionIndex);
    if (target)
      return make(target, 'action', `"${tokens[actionIndex].word}" acts on it`, tokens[spanIndex]?.span === true && target === tokens[spanIndex]?.word);
    return {
      requirements: [],
      dropped: {
        clause: original, sourceField, kind: 'generic',
        reason: `"${tokens[actionIndex].word}" names an action with no target to look for`,
      },
    };
  }

  // Rule 6 - a surface or the application's own copy, with no predicate at all.
  // "Notifications bell" is a legitimate requirement and must stay one.
  if (surfaceIndex >= 0)
    return make(nounPhraseAround(tokens, surfaceIndex, true), 'ui-observable',
        `names the ${surface} without saying anything about it, which is still a thing on a screen`,
        tokens[surfaceIndex].span);
  if (spanIndex >= 0)
    return make(tokens[spanIndex].word, 'ui-observable',
        'quoted or capitalised copy, which is the application\'s own words', true);

  // C — a business or data assertion with no surface. Counted, never browsed for.
  if (businessIndex >= 0) {
    const anchor = tokens.findIndex(token => !FUNCTION_WORDS.has(token.word)
      && !BUSINESS_PREDICATES.has(token.word) && !isActionVerb(token.word) && !isObserveVerb(token.word));
    if (anchor >= 0)
      return make(nounPhraseAround(tokens, anchor), 'business-assertion',
          `"${tokens[businessIndex].word}" is a claim about data or a rule, not about a screen`, false);
  }

  // D — generic prose.
  return {
    requirements: [],
    dropped: {
      clause: original, sourceField, kind: 'generic',
      reason: 'names no surface, no observable state and no action',
    },
  };
}

/* -------------------------------------------------------------------- entry point */

const CLASS_RANK: Record<RequirementClass, number> = {
  'ui-observable': 3,
  'action': 2,
  'business-assertion': 1,
};

/**
 * The requirements this row places on a screen.
 *
 * Deterministic and pure: same row in, same result out, no I/O, no model. The result is
 * what reaches page-knowledge matching; `terms()` still exists there and is still used
 * to SELECT which knowledge files are relevant, which is a recall problem and a
 * different job.
 */
export function extractRequirements(testCase: TestCase): ExtractionResult {
  const fields: Array<{ field: RequirementSource; text: string }> = [
    { field: 'steps', text: testCase.steps.filter(Boolean).join('\n') },
    { field: 'expectedResult', text: testCase.expectedResult ?? '' },
  ];

  const requirements: Requirement[] = [];
  const dropped: DroppedClause[] = [];

  for (const { field, text } of fields) {
    if (!text.trim())
      continue;
    const { masked, spans } = protectSpans(text);
    for (const clause of clausesOf(masked, spans)) {
      const outcome = classifyClause(clause, field, spans);
      if (outcome.requirements.length)
        requirements.push(...outcome.requirements);
      else if (outcome.dropped)
        dropped.push(outcome.dropped);
    }
  }

  // One requirement per phrase, keeping the strongest reading of it. A phrase that is
  // both acted on and asserted about is one thing on one screen.
  const best = new Map<string, Requirement>();
  for (const requirement of requirements) {
    const existing = best.get(requirement.phrase);
    if (!existing || CLASS_RANK[requirement.class] > CLASS_RANK[existing.class])
      best.set(requirement.phrase, requirement);
  }
  const unique = [...best.values()];

  return {
    requirements: unique,
    dropped,
    counts: {
      requirementCount: unique.length,
      actionCount: unique.filter(requirement => requirement.class === 'action').length,
      uiObservableCount: unique.filter(requirement => requirement.class === 'ui-observable').length,
      businessAssertionCount: unique.filter(requirement => requirement.class === 'business-assertion').length,
      genericDroppedCount: dropped.filter(item => item.kind === 'generic').length,
      placeholderDroppedCount: dropped.filter(item => item.kind === 'placeholder').length,
      requirementSourceCounts: {
        steps: unique.filter(requirement => requirement.sourceField === 'steps').length,
        expectedResult: unique.filter(requirement => requirement.sourceField === 'expectedResult').length,
      },
    },
  };
}

/**
 * The requirements that can send somebody to a browser.
 *
 * `business-assertion` is excluded here rather than filtered out at extraction, so the
 * count is still reported and a reader can see the row asserted a rule. Nothing about a
 * data rule is discoverable by looking at a screen.
 */
export function inspectableRequirements(result: ExtractionResult): Requirement[] {
  return result.requirements.filter(requirement => requirement.class !== 'business-assertion');
}

/** Exported for the fixtures: the vocabularies must be assertable directly. */
export const VOCABULARY_FOR_TEST = {
  UI_SURFACES, ACTION_VERBS, OBSERVE_VERBS, OBSERVABLE_PREDICATES, BUSINESS_PREDICATES,
};

/** Exported for the fixtures: clause segmentation is where "Terms and Conditions" breaks. */
export function clausesForTest(text: string): string[] {
  const { masked, spans } = protectSpans(text);
  return clausesOf(masked, spans).map(clause =>
    clause.replace(new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g'),
        (_full, index) => spans[Number(index)] ?? ''));
}
