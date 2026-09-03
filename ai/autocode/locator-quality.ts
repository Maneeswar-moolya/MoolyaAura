/**
 * What a recorded locator is worth, decided deterministically.
 *
 * Codegen writes the locator that identified the element *at that moment*, which is
 * not the same as a locator worth keeping. `#tc_summary_636432` names one issue in
 * one workspace; `getByRole('strong')` names whichever emphasised span the page
 * happens to render first. Both are real evidence and neither is a maintainable
 * selector, and the mapper used to emit them with the same shrug - "no Page Object
 * describes this, use the recorded locator".
 *
 * This module sits between the recording and the assembler. It parses the recorded
 * chain, produces candidate strategies from the evidence *already in the recording*,
 * scores them, and says what should happen. It never opens a browser, never calls a
 * model, and never invents a role, a name, a test id or a text: everything it emits
 * came from the Codegen chain it was handed.
 *
 * What it deliberately does NOT do:
 *
 *   - It does not count DOM matches. It cannot: there is no page here. Uniqueness is
 *     inferred only from evidence the recording itself carries - a `.first()` in the
 *     chain is Codegen telling us it found several.
 *   - It does not rewrite an expected value to make an assertion pass. TC_LOGIN_036
 *     asserts "Welcome to Bugasura" against a <strong> holding "Bugasura"; the honest
 *     answer is to mark that assertion suspicious, not to quietly change either half.
 *   - It does not turn a dynamic id into `[id^="tc_summary_"]`. Normalisation is how
 *     the id is *recognised*, not a selector to emit - a prefix match is only correct
 *     if it matches exactly one element, and nothing here can know that.
 */

import {
  isPositionProvenAgainstClickedTarget, isPositionProvenAtPick,
  isProvenAgainstClickedTarget, positionalExpression, provesIdentity,
  type TargetEvidence,
} from './dom-evidence';

/** What should happen with this element. */
export type LocatorOutcome =
  /** An existing Page Object method already describes it. Nothing to decide. */
  | 'REUSE_PAGE_OBJECT'
  /** A semantic, stable locator was found in the recording. */
  | 'STABLE_LOCATOR'
  /** Every condition for writing a new Page Object method is provable. */
  | 'SAFE_NEW_PAGE_OBJECT'
  /** A dynamic identifier was recognised and a stable alternative was proven. */
  | 'NORMALIZED_LOCATOR'
  /** Nothing better exists; the recorded locator is used as it was recorded. */
  | 'RAW_LOCATOR_LAST_RESORT'
  /** Not resolvable from the evidence. A person has to look. */
  | 'NEEDS_REVIEW';

/**
 * How much this locator can be trusted, on the vocabulary the brief asks for.
 *
 * `invalid` is the only one that stops assembly. `suspicious` and `weak` are
 * reported and still emitted, because the quality gate is what decides whether a
 * questionable assertion actually holds - and it is better at it than a heuristic
 * with no page in front of it. TC_LOGIN_037 proves the point from both sides: its
 * generic `getByRole('heading')` assertion PASSED, while the same shape failed in
 * TC_LOGIN_036. Nothing available offline separates those two, so neither is blocked.
 */
export type LocatorClass = 'reusable' | 'stable' | 'weak' | 'suspicious' | 'invalid';

export interface LocatorCandidate {
  /** `role-name`, `label`, `test-id`, `stable-id`, `text`, `css`, `xpath`… */
  strategy: string;
  /** The Playwright expression, exactly as it would be emitted. */
  expression: string;
  score: number;
  /** Every adjustment applied, with its reason, so a ranking can be audited. */
  penalties: Array<{ reason: string; points: number }>;
  /** True when the expression is scoped by a container from the recording. */
  scoped: boolean;
}

export interface DynamicIdentifier {
  value: string;
  dynamic: boolean;
  /** Which rules fired. Named so a false positive can be argued with. */
  signals: string[];
  /** `tc_summary_<dynamic>` - an analysis result, never a selector. */
  normalised: string;
}

export interface LocatorAssessment {
  outcome: LocatorOutcome;
  /** 0..1, the winning candidate's score over 100. */
  confidence: number;
  strategy: string;
  /** What should be emitted. Null when the outcome is NEEDS_REVIEW. */
  expression: string | null;
  classification: LocatorClass;
  reason: string;
  pageObject: { pageObject: string; method: string } | null;
  candidates: LocatorCandidate[];
  dynamic: DynamicIdentifier | null;
  /** Set when the recording itself shows the locator matched several elements. */
  ambiguous: boolean;
  /** Strategies generated from the recording and then refused, with the reason. */
  rejected: RejectedCandidate[];
}

/* ------------------------------------------------------------------ parsing */

export interface ChainSegment {
  call: string;
  /** First argument, unquoted, when it is a literal. */
  arg: string;
  /** `name:` from a getByRole options object. */
  name: string;
  raw: string;
}

const QUOTED = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\`(?:\\.|[^\`\\])*\`)`;
const SEGMENT = new RegExp(String.raw`\.?(getBy[A-Za-z]+|locator|frameLocator|contentFrame|filter|first|last|nth)\s*\(([^]*?)\)(?=\s*(?:\.|$))`, 'g');

/** Strip one layer of quotes from a literal, leaving the text as written. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (/^['"`]/.test(trimmed) && trimmed.length >= 2 && trimmed.at(-1) === trimmed[0])
    return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Split `page.locator('#x').getByRole('button', { name: 'Close' })` into segments.
 *
 * Balanced-paren aware, because a getByRole options object contains commas and
 * braces and a naive split on `)` cuts it in half.
 */
export function parseChain(locator: string): ChainSegment[] {
  const segments: ChainSegment[] = [];
  let index = 0;
  const source = locator.replace(/^await\s+/, '').trim();
  while (index < source.length) {
    const start = source.indexOf('(', index);
    if (start < 0)
      break;
    const head = source.slice(index, start);
    const call = /([A-Za-z]+)\s*$/.exec(head)?.[1];
    if (!call) {
      index = start + 1;
      continue;
    }
    let depth = 0;
    let end = start;
    let quote = '';
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) {
        if (character === '\\') {
          end++;
          continue;
        }
        if (character === quote)
          quote = '';
        continue;
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character;
        continue;
      }
      if (character === '(')
        depth++;
      else if (character === ')') {
        depth--;
        if (!depth)
          break;
      }
    }
    const body = source.slice(start + 1, end);
    const first = splitTopLevel(body)[0] ?? '';
    const name = /name\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(body)?.[2] ?? '';
    segments.push({ call, arg: unquote(first), name, raw: `${call}(${body})` });
    index = end + 1;
  }
  return segments;
}

/** Split an argument list on top-level commas only. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (quote) {
      current += character;
      if (character === '\\') {
        current += body[++index] ?? '';
        continue;
      }
      if (character === quote)
        quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      current += character;
      continue;
    }
    if (character === '(' || character === '{' || character === '[')
      depth++;
    if (character === ')' || character === '}' || character === ']')
      depth--;
    if (character === ',' && !depth) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim())
    parts.push(current);
  return parts;
}

/* ------------------------------------------------- dynamic identifier rules */

/**
 * Roles that carry no identity of their own.
 *
 * `strong` and `heading` are here for the same reason: without an accessible name
 * they name a shape of text, not a thing on the page. This is the TC_LOGIN_036
 * shape - `getByRole('strong')` matched an emphasised span holding "Bugasura" while
 * the recorded expectation was the sentence around it.
 */
const GENERIC_ROLES = new Set([
  'strong', 'emphasis', 'heading', 'paragraph', 'generic', 'group', 'region',
  'list', 'listitem', 'row', 'cell', 'article', 'section', 'banner', 'main',
  'navigation', 'contentinfo', 'complementary', 'separator', 'presentation', 'none',
  'img', 'image', 'link', 'button', 'textbox',
]);

/** Ids that name a layout box rather than a thing somebody would assert about. */
const CONTAINER_IDS = /^(main[-_]?content|content|root|app|page|body|wrapper|container|layout|shell|outlet|view)$/i;

/** Prefixes frameworks generate. An id that starts like this was never authored. */
const FRAMEWORK_ID = /^(ember\d|ng-|react-|mui-|radix-|headlessui-|css-[a-z0-9]{5,}|jss\d|:r[0-9a-z]+:)/i;

/**
 * Is this identifier generated rather than authored?
 *
 * Multi-signal on purpose. "Contains a number" would call `#loginForm2` dynamic and
 * send a perfectly good selector to review; one strong signal, or two weak ones, is
 * the bar. Every rule that fires is named in `signals`, so a wrong call can be
 * argued with rather than guessed at.
 */
export function analyseIdentifier(value: string): DynamicIdentifier {
  const raw = value.replace(/^#/, '');
  const signals: string[] = [];
  let normalised = raw;

  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(raw);
  if (uuid) {
    signals.push('uuid');
    normalised = raw.replace(uuid[0], '<dynamic>');
  }

  // A separator then four or more digits: `tc_summary_636432`, `row-100482`. Four is
  // the bar because `step-3` and `tab-12` are things people write by hand.
  const digits = /^(.*?)[_-](\d{4,})$/.exec(raw);
  if (digits) {
    signals.push('separator-digits');
    normalised = `${digits[1]}_<dynamic>`;
  }

  // A hex-looking tail with at least one digit in it, so `#header-section` (letters
  // that happen to be a-f) cannot qualify.
  const hex = /^(.*?)[_-]?([0-9a-f]{8,})$/i.exec(raw);
  if (hex && /\d/.test(hex[2]) && /^[0-9a-f]+$/i.test(hex[2]) && !signals.includes('separator-digits')) {
    signals.push('hex-hash');
    normalised = `${hex[1]}<dynamic>`;
  }

  if (/^\d{4,}$/.test(raw)) {
    signals.push('digits-only');
    normalised = '<dynamic>';
  }

  if (FRAMEWORK_ID.test(raw)) {
    signals.push('framework-generated-prefix');
    normalised = raw.replace(/[0-9]+/g, '<dynamic>');
  }

  const weak: string[] = [];
  // A long mixed-case alphanumeric tail: `panel_aB3xQ91k`.
  if (/[_-][A-Za-z0-9]{8,}$/.test(raw) && /[A-Za-z]/.test(raw.slice(-8)) && /\d/.test(raw.slice(-8)))
    weak.push('mixed-alphanumeric-tail');
  // One to three trailing digits. Never enough on its own - `#loginForm2` is authored.
  if (/[A-Za-z]\d{1,3}$/.test(raw))
    weak.push('short-trailing-digits');

  const dynamic = signals.length > 0 || weak.length >= 2;
  return { value: raw, dynamic, signals: [...signals, ...weak], normalised: dynamic ? normalised : raw };
}

/* ---------------------------------------------------------------- scoring */

/**
 * Base scores by strategy, highest first.
 *
 * Ordered the way the brief asks and the way this repository already argues in
 * `login.page.ts`: a role with an accessible name beats a structural selector,
 * because the name is what a person sees and the structure is what a developer
 * changes. Adjusted from the brief's starting numbers in one place - a *scoped*
 * stable id scores above unscoped text, because `#loginForm` scoping is the single
 * convention this framework repeats most (three sign-in forms are mounted at once).
 */
const BASE: Record<string, number> = {
  'page-object': 100,
  'role-name': 95,
  label: 90,
  placeholder: 85,
  'test-id': 85,
  title: 78,
  'alt-text': 78,
  text: 75,
  'stable-id': 70,
  'data-attribute': 82,
  css: 65,
  'xpath-relational': 55,
  'normalized-dynamic-id': 35,
  'role-generic': 30,
  raw: 10,
  'xpath-absolute': 0,
};

/** A CSS selector that leans on where a thing sits rather than what it is. */
const POSITIONAL_CSS = /:nth-(child|of-type)\(|>\s*\*|\[\d+\]/;
/** Class names a bundler produced: `css-1x2y3z`, `Button_root__aB3xQ`. */
const GENERATED_CLASS = /\.(css-[a-z0-9]{5,}|[A-Za-z]+_[A-Za-z]+__[A-Za-z0-9]{4,}|[a-z]+-[a-z0-9]{6,}\b)/;

/** One recorded step, as context for resolving a different step's locator. */
export interface RecordedStep {
  locator: string;
  target: string;
  kind: 'action' | 'assertion';
  value: string | null;
}

interface AssessInput {
  /** Codegen's chain, verbatim. */
  locator: string;
  /** The human-readable name the recorder derived. */
  target: string;
  /** 'action' or 'assertion' - an assertion is judged on what it proves. */
  kind: 'action' | 'assertion';
  /** The expected value, for an assertion. */
  value?: string | null;
  /** An existing Page Object method, when `findMethod` already matched one. */
  pageObject?: { pageObject: string; method: string } | null;
  /**
   * The rest of the recording.
   *
   * A relationship this recording actually demonstrates is evidence: in
   * TC_LOGIN_036 the person clicked
   * `#tc_summary_636432 >> getByText('Config Line Chart: Unable to')`, which proves
   * that container holds that text. Nothing is inferred beyond what a chain in the
   * recording literally shows - there is no DOM here, and a relationship nobody
   * recorded is a relationship nobody can check.
   */
  context?: RecordedStep[];
  /**
   * What the browser saw for this exact locator while it was being recorded.
   *
   * Absent for every recording made before Phase 8C and for any recording whose
   * capture failed, in which case every rule below is skipped and the offline
   * reasoning stands unchanged. When present it carries the two things offline
   * analysis can never produce: a measured `matchCount`, and alternatives that were
   * counted in the same page.
   */
  evidence?: TargetEvidence;
}

/**
 * A strategy that was tried and thrown away, with the reason.
 *
 * Kept because "no candidate was found" and "four candidates were found and every
 * one of them was unsafe" are different statements, and only the second one tells
 * the next person what to do about it.
 */
export interface RejectedCandidate {
  strategy: string;
  expression: string;
  reason: string;
}

/** Semantic segment strategies, in preference order, for picking a replacement. */
const SEMANTIC_CALLS = new Set([
  'getByRole', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'getByText',
  'getByTitle', 'getByAltText',
]);

/** Is this segment something a person would recognise, rather than structure? */
function isSemantic(segment: ChainSegment): boolean {
  if (!SEMANTIC_CALLS.has(segment.call))
    return false;
  if (segment.call === 'getByRole')
    return Boolean(segment.name);
  return segment.arg.trim().length >= 3;
}

/** `page.` + the segments, as an expression that can be emitted. */
function expressionFor(segments: ChainSegment[]): string {
  return `page.${segments.map(s => s.raw).join('.')}`;
}

/** The scoring key for one segment: `role-name`, `text`, `label`… */
function strategyOf(segment: ChainSegment | undefined): string {
  if (!segment)
    return 'raw';
  switch (segment.call) {
    case 'getByRole': return segment.name ? 'role-name' : 'role-generic';
    case 'getByLabel': return 'label';
    case 'getByPlaceholder': return 'placeholder';
    case 'getByTestId': return 'test-id';
    case 'getByText': return 'text';
    case 'getByTitle': return 'title';
    case 'getByAltText': return 'alt-text';
    default: return 'css';
  }
}

/**
 * Drop a scope that cannot resolve, when the recording proves what is inside it.
 *
 * `page.locator('#tc_summary_636432').getByText('Config Line Chart: Unable to')` is
 * a generated container wrapping a stable text. The container names one issue and
 * will not exist next run; the text was recorded and is a real thing on the page. So
 * the descendant alone is a candidate - it is strictly better than a selector that
 * is known not to resolve, and if it turns out to match several rows the gate says
 * so loudly rather than passing on the wrong one.
 *
 * Only ever narrower-from-recorded: nothing is added that the recording did not
 * contain, and the scope is never dropped when it is stable.
 */
function scopeDropCandidates(segments: ChainSegment[]): Array<{ segments: ChainSegment[]; why: string }> {
  if (segments.length < 2)
    return [];
  const [scope, ...rest] = segments;
  if (scope.call !== 'locator')
    return [];
  const identifier = /^#[^\s.>:[]+$/.test(scope.arg) ? analyseIdentifier(scope.arg) : null;
  if (!identifier?.dynamic)
    return [];
  const semantic = rest.filter(isSemantic);
  if (!semantic.length)
    return [];
  return [{
    segments: rest,
    why: `the scope #${identifier.value} is a generated id (${identifier.signals.join(', ')}); `
      + 'the recording shows this element inside it, so the recorded descendant is used on its own',
  }];
}

/**
 * Relationships this recording actually demonstrated, as XPath axis candidates.
 *
 * The only relationship a Codegen recording states is containment, and it states it
 * by chaining: `A.locator(B)` means B was inside A. That yields two axes honestly -
 * `descendant` (from the container's point of view) and `ancestor` (from the child's)
 * - and nothing else. There is no sibling, parent or following axis in a recording,
 * because Codegen never writes one down; generating those would be inventing a DOM
 * shape, which is the one thing this whole module refuses to do.
 *
 * An ancestor candidate also has to be *expressible*. Naming the ancestor requires an
 * attribute the ancestor actually has, and here it has only the generated id - so the
 * axis would need `starts-with(@id, …)` (a prefix match nothing can prove unique) or
 * `ancestor::*[2]` (positional). Both are refused, and refused visibly: the candidate
 * is generated, rejected and reported, so the attempt is on the record.
 */
function axisCandidates(input: {
  locator: string; segments: ChainSegment[]; context: RecordedStep[]; dynamic: DynamicIdentifier | null;
}): { candidates: Array<{ expression: string; strategy: string; why: string }>; rejected: RejectedCandidate[] } {
  const candidates: Array<{ expression: string; strategy: string; why: string }> = [];
  const rejected: RejectedCandidate[] = [];
  if (!input.dynamic?.dynamic)
    return { candidates, rejected };

  // Somewhere else in the recording, was this exact container used as a scope?
  const scopePrefix = `page.locator('#${input.dynamic.value}')`;
  for (const step of input.context) {
    if (!step.locator.startsWith(scopePrefix) || step.locator === input.locator)
      continue;
    const inner = parseChain(step.locator).slice(1).filter(isSemantic);
    if (!inner.length)
      continue;
    // The child is nameable; the container is not. `ancestor::` needs a predicate to
    // stop at the right level, and every predicate available here is one this module
    // refuses on principle.
    rejected.push({
      strategy: 'xpath-ancestor',
      expression: `${expressionFor(inner)}.locator('xpath=ancestor::*[starts-with(@id, "${input.dynamic.normalised.replace('<dynamic>', '')}")]')`,
      reason: 'the only way to name the ancestor is a prefix match on the generated id, '
        + 'which nothing here can prove resolves to exactly one element',
    });
    rejected.push({
      strategy: 'xpath-ancestor-positional',
      expression: `${expressionFor(inner)}.locator('xpath=ancestor::*[2]')`,
      reason: 'positional axis - it depends on how deeply the row happens to be nested',
    });
  }
  return { candidates, rejected };
}

/**
 * Would this candidate assert its own expected text?
 *
 * `expect(getByText('Line Chart | Time Config…')).toContainText('Line Chart | Time
 * Config…')` finds the element BY the string it then checks for, so it can only
 * pass. Worse, it survives the gate: the mutator changes the expected text, the
 * locator stops matching, the mutated run fails, and a tautology is accepted as a
 * proven test. Deriving an assertion's target from its own expectation is therefore
 * refused outright - it is the one transformation here that could manufacture false
 * coverage rather than merely fail.
 */
function isTautology(expression: string, kind: 'action' | 'assertion', value: string | null | undefined): boolean {
  if (kind !== 'assertion' || !value)
    return false;
  const expected = value.trim().toLowerCase();
  if (expected.length < 3)
    return false;
  const texts = [...expression.matchAll(new RegExp(String.raw`getBy(?:Text|Title|AltText)\(\s*${QUOTED}`, 'g'))]
      .map(match => unquote(match[0].slice(match[0].indexOf('(') + 1)).trim().toLowerCase());
  return texts.some(text => text.length >= 3 && (expected.includes(text) || text.includes(expected)));
}


/**
 * What the live page proved about this locator, if a recording captured it.
 *
 * Three rules, in this order, and each one refuses rather than guesses:
 *
 *  1. A locator that MATCHED SEVERAL elements is ambiguous - not "use .first()".
 *  2. A dynamic id is replaced only by a candidate the browser counted at exactly
 *     one element. `#tc_summary_638717` becomes `#bugReport-table
 *     .tabulator-cell-draft--summary` because that selector was measured, not
 *     because it looks better.
 *  3. An assertion whose expected text lives in the PARENT rather than the target is
 *     retargeted - TC_LOGIN_036's `<strong>Bugasura</strong>` inside
 *     `<h2>Welcome to Bugasura</h2>` - and only when a counted candidate for that
 *     parent exists. Otherwise it is reported, never rewritten.
 */
/** A generated id the evidence path may act on: the node's own, or one in the chain. */
interface ResolvedIdentifier {
  /** The id without its `#`. */
  raw: string;
  /** `tc_summary_<dynamic>` - an analysis result, never a selector. */
  normalised: string;
  /** Which rules fired, or `captured` when the capture itself judged the node's id. */
  signals: string[];
}

/**
 * Every generated identifier written anywhere inside one CSS selector.
 *
 * THE SHAPE OF THE SELECTOR IS NOT THE QUESTION - the presence of the id is. A bare
 * `#tr_637446` was detected and refused; the same id as the left-hand side of one
 * compound selector,
 *
 *   page.locator('#tr_637446 > .tabulator-cell > .rounded-checkbox-ui')
 *
 * was not, because the test required the WHOLE argument to be an id. So a locator
 * pinned to one Bugasura issue passed as ordinary CSS and was emitted verbatim -
 * measured live in TC_DASHBOARD_011, whose generated step carried that row id.
 *
 * Scanning for the id wherever it occurs closes that, and covers the descendant,
 * child, attribute and multi-id forms with one rule rather than four.
 *
 * Exported because `ai/autocode/abstraction/` needs exactly this question answered
 * and had grown its own copy. One rule, one place: two detectors of the same thing
 * drift, and the half that drifts is the half that lets an id through.
 */
export function dynamicIdentifiersIn(selector: string): string[] {
  const found: string[] = [];
  for (const match of (selector ?? '').matchAll(/#([A-Za-z0-9_-]+)|\[id\s*=\s*["']([^"']+)["']\]/g)) {
    const raw = match[1] ?? match[2] ?? '';
    if (raw && analyseIdentifier(raw).dynamic)
      found.push(raw);
  }
  return found;
}

/** Does any segment of this recorded chain carry a generated identifier? */
export function chainHasDynamicIdentifier(locator: string): boolean {
  return parseChain(locator ?? '').some(segment =>
    segment.call === 'locator' && dynamicIdentifiersIn(segment.arg || segment.raw).length > 0);
}

/**
 * The generated id this locator is built on, wherever it sits - or null.
 *
 * The captured identifier wins when it is dynamic: the browser looked at the actual
 * node. Otherwise the recorded chain is read, because a dynamic id used as a SCOPE
 * never reaches `target.id` - the graphed element is a descendant of it.
 *
 * Read from `locator()` segments only, and now from anywhere INSIDE one: a compound
 * selector is still a selector built on that id. `filter({ hasText })` and the
 * `getBy*` family are deliberately not scanned - a `#` in visible text is a character,
 * not an identifier.
 */
function dynamicIdentifierFor(
  locator: string,
  captured: TargetEvidence['identifier'],
): ResolvedIdentifier | null {
  if (captured?.dynamic)
    return { raw: captured.raw, normalised: captured.normalised, signals: ['captured'] };
  for (const segment of parseChain(locator)) {
    if (segment.call !== 'locator')
      continue;
    for (const raw of dynamicIdentifiersIn(segment.arg || segment.raw)) {
      const identifier = analyseIdentifier(raw);
      if (identifier.dynamic)
        return { raw: identifier.value, normalised: identifier.normalised, signals: identifier.signals };
    }
  }
  return null;
}

/**
 * Is this locator nothing but a page-wide `getByText` of the element's own text?
 *
 * Asked only to decide whether a press-time text measurement describes THIS locator.
 * A scoped chain (`locator('#x').getByText(…)`) is a different question - the scope
 * changes what the text resolves to - so only a single, unscoped segment qualifies.
 *
 * Codegen may have written a shorter run of the element's text than the capture
 * recorded. That direction is safe: every element holding the longer string holds the
 * shorter one, so a text measured as ambiguous cannot become unique by being trimmed.
 */
function isBareTextLocator(locator: string, measuredText: string): boolean {
  const segments = parseChain(locator)
      .filter(segment => segment.call === 'locator' || segment.call.startsWith('getBy'));
  if (segments.length !== 1 || segments[0].call !== 'getByText')
    return false;
  const written = segments[0].arg.replace(/\s+/g, ' ').trim().toLowerCase();
  const measured = measuredText.replace(/\s+/g, ' ').trim().toLowerCase();
  return Boolean(written) && Boolean(measured) && measured.includes(written);
}

/**
 * A single, unscoped `getByText(...)`: the one shape whose uniqueness NOTHING offline
 * can judge.
 *
 * `isBareTextLocator` asks whether a press-time TEXT MEASUREMENT describes a locator,
 * so it needs the measured string. This asks only about the shape, because it has to
 * answer when there is no measurement at all - which is exactly the case that failed.
 */
export function isUnscopedTextLocator(locator: string): boolean {
  const segments = parseChain(locator)
      .filter(segment => segment.call === 'locator' || segment.call.startsWith('getBy'));
  return segments.length === 1 && segments[0].call === 'getByText';
}

/**
 * Did the browser actually measure this bare text locator at exactly one element?
 *
 * Two acceptable proofs, both measurements and neither an inference: the press-time
 * text count for this very string, or a proven candidate whose expression IS this
 * locator. Anything else - including no evidence at all - is not a proof of one.
 */
function textProvenUnique(
  evidence: TargetEvidence | undefined,
  locator: string,
  /** An assertion's proof may be its own pick; an action's may not. */
  kind: 'action' | 'assertion' = 'action',
): boolean {
  if (!evidence)
    return false;
  const text = evidence.pressTimeText;
  if (text && text.matchCount === 1 && isBareTextLocator(locator, text.text))
    return true;
  return (evidence.derivedCandidates ?? []).some(candidate =>
    provesIdentity(candidate, kind)
    && (candidate.expression ?? '').trim() === locator.trim());
}

/**
 * A single, unscoped STRUCTURAL selector: a bare tag, a bare class chain, or a tag with
 * classes - `h2`, `.veil`, `h2.u-entity-title`.
 *
 * The structural counterpart of `isUnscopedTextLocator`, and it exists for the same
 * reason. That rule refuses a bare `getByText` because any container holding the string
 * matches it as well as the element that owns it; this refuses a bare tag because every
 * OTHER element of that tag matches it as well as the one that was recorded. Neither
 * shape carries anything that constrains it - no id, no attribute, no role and name, no
 * scope - so nothing about the expression itself says it identifies one element.
 *
 * DELIBERATELY NARROW. An id, an attribute selector, a descendant or a combinator all
 * take an expression out of this rule, because each is a constraint the recording chose:
 * `#apps_tab_container h2` is scoped by an authored id and is judged as it always was.
 * Measured over the corpus: 112 of 694 emitted decisions match this shape, and 104 of
 * those are the recorder's own overlay (`ba-aura-assert`, `.veil`). The application
 * locators it touches are `h2`, `h1` and `body`.
 */
export function isUnscopedStructuralLocator(locator: string): boolean {
  const segments = parseChain(locator)
      .filter(segment => segment.call === 'locator' || segment.call.startsWith('getBy'));
  if (segments.length !== 1 || segments[0].call !== 'locator')
    return false;
  const argument = (segments[0].arg ?? '').trim();
  if (!argument)
    return false;
  // An id or an attribute is a constraint the recording chose; scoping and combinators
  // put the expression outside this rule entirely.
  if (/[#[]/.test(argument) || /[\s>+~,]/.test(argument))
    return false;
  return /^[a-zA-Z][\w-]*(\.[\w-]+)*$/.test(argument) || /^(\.[\w-]+)+$/.test(argument);
}

/**
 * Is this locator's uniqueness ATTRIBUTABLE - measured somewhere that can be reasoned
 * about - rather than merely counted at one?
 *
 * THE DISTINCTION THIS WHOLE RULE TURNS ON, and the one `measuredZero` already makes for
 * a count of zero: `same` was counted in the document the interaction happened in, so it
 * is a fact about the element; `unknown` was read from whatever page was showing
 * afterwards, so it is a fact about a moment nobody can name.
 *
 * TC_LOGIN_128 is the case. Its `h2` assertion was written by Codegen into the script,
 * so it never passed the picker, and `captureFor` measured it after the action:
 * `matchCount: 1`, `matchCountDocument: 'unknown'`, identity never asked. One, in a
 * document that no longer existed by the time the spec ran - where the page has three
 * `h2`s. The count suppressed `measuredAmbiguity`, no replacement was sought, and the
 * offline scorer emitted the bare tag. It failed strict mode at run time.
 *
 * Two proofs, both measurements and neither an inference: the recorded locator's own
 * count taken in the interaction's own document, or a candidate this role can prove
 * whose expression IS this locator - the same pair `textProvenUnique` accepts.
 */
function structurallyAttributable(
  evidence: TargetEvidence | undefined,
  locator: string,
  kind: 'action' | 'assertion',
): boolean {
  if (!evidence)
    return false;
  if (evidence.matchCountDocument === 'same' && evidence.matchCount === 1)
    return true;
  return (evidence.derivedCandidates ?? []).some(candidate =>
    provesIdentity(candidate, kind)
    && (candidate.expression ?? '').trim() === locator.trim());
}

/**
 * The measured statement that this locator does not identify one element - or null.
 *
 * TWO MEASUREMENTS, ONE MEANING, TAKEN AT DIFFERENT MOMENTS.
 *
 * The first is the recorded locator's own count. It exists only when the document the
 * person acted in was still there when Codegen wrote the line - which rules out every
 * click that navigates, which is most of the interesting ones.
 *
 * The second is what the element's own text identified AT THE PRESS. That is the only
 * measurement available for a click that left the page, and it is what TC_LOGIN_063
 * needs: `getByText('Faclon labs')` was counted at 2 on the page the click ARRIVED at,
 * which says nothing about the page it was clicked on.
 */
/**
 * Does this recorded locator choose by POSITION?
 *
 * `.first()` and `.nth()` are how Codegen writes down "several matched and I took
 * one of them". They are evidence of ambiguity - and they also hide it, because the
 * measured count of `X.first()` is 1 however many elements `X` found.
 */
export function isPositionalLocator(locator: string): boolean {
  return /\.first\(\)|\.last\(\)|\.nth\(/.test(locator);
}

/**
 * Did the browser count this target's own locator at exactly zero elements, somewhere
 * the count can be reasoned about?
 *
 * The counterpart of `measuredAmbiguity`, and deliberately as narrow. Ambiguity asks
 * "does this name more than one thing"; this asks "does it name anything at all". Both
 * are measurements of the RECORDED expression, and neither is inferred from its shape.
 *
 * Three conditions, and each rules something specific out:
 *
 *   - the count is a number. `null` is "not measured" and must never read as zero.
 *   - the count is 0.
 *   - the count is attributable. `same` is decisive. `other` is refused outright -
 *     a count on the page that replaced the one acted on is evidence about that page,
 *     which is the whole of P0.7. Anything else (`unknown`, or a recording made before
 *     the field existed) needs the second failure: the recorder could not find the
 *     element on that page either, which is what `(not found)` records.
 */
function measuredZero(evidence: TargetEvidence): boolean {
  if (typeof evidence.matchCount !== 'number' || evidence.matchCount !== 0)
    return false;
  if (evidence.matchCountDocument === 'same')
    return true;
  if (evidence.matchCountDocument === 'other')
    return false;
  return (evidence.target?.tag ?? '') === '(not found)';
}

function measuredAmbiguity(
  evidence: TargetEvidence,
  locator: string,
): { count: number; reason: string } | null {
  if (typeof evidence.matchCount === 'number' && evidence.matchCount > 1) {
    return {
      count: evidence.matchCount,
      reason: `the browser measured ${evidence.matchCount} elements for this locator while it was `
        + 'being recorded, so it does not identify one thing',
    };
  }
  const text = evidence.pressTimeText;
  if (text && typeof text.matchCount === 'number' && text.matchCount > 1
      && isBareTextLocator(locator, text.text)) {
    return {
      count: text.matchCount,
      reason: `the text "${truncate(text.text)}" identified ${text.matchCount} elements in the page `
        + 'at the moment it was pressed, so this locator does not identify one thing (it was never '
        + 'counted there - the interaction had already changed the page)',
    };
  }
  return null;
}

/**
 * What was tried, and why none of it could be used. Never "0 alternative(s)".
 *
 * The refusals used to report the length of the list of candidates that SURVIVED,
 * which is zero exactly when the interesting thing happened: twelve were built,
 * twelve were measured, and every one of them was refused.
 */
function triedSummary(evidence: TargetEvidence): string {
  const rejected = evidence.rejectedCandidates ?? [];
  const kept = evidence.derivedCandidates ?? [];
  const tried = evidence.candidatesTried ?? (rejected.length + kept.length);
  // Absent is not zero. A sidecar written before P0.7 dropped every refused candidate
  // at the funnel, so "nothing was tried" and "what was tried was not written down"
  // are indistinguishable in it - and only one of them is true.
  if (evidence.candidatesTried === undefined && !rejected.length && !kept.length)
    return ' This recording does not say what was measured; it was made before refused'
      + ' candidates were kept.';
  if (!tried)
    return ' Nothing could be built from its surroundings to measure.';
  const families = new Map<string, number>();
  const note = (family: string) => families.set(family, (families.get(family) ?? 0) + 1);
  for (const candidate of rejected) {
    if (candidate.sameDocument === false)
      note('were measured in a document the press never happened in');
    else if (candidate.matchCount === null)
      note('could not be measured');
    else if (candidate.matchCount === 0)
      note('matched nothing');
    else if (candidate.matchCount > 1)
      note('matched several elements');
    else if (candidate.identityMatched === false)
      note('matched exactly one element - a DIFFERENT one from the element that was pressed');
    else
      note('were refused');
  }
  const parts = [...families.entries()].map(([family, count]) => `${count} ${family}`);
  return ` ${tried} alternative(s) were built from its surroundings and measured`
    + (parts.length ? `: ${parts.join(', ')}.` : ', and none could be promoted.');
}

function fromEvidence(input: AssessInput): LocatorAssessment | null {
  const evidence = input.evidence;
  if (!evidence)
    return null;

  const measurements = evidence.derivedCandidates ?? [];
  // PROVEN is the only thing an ambiguity may be settled with: measured as the person
  // pressed, in the document they pressed in, at exactly one element, and that element
  // is the one they acted on. `unique` is the older, weaker bar - a count of one and
  // nothing said about identity - and it stays available to the rules that already
  // used it, because a recording that never asked the identity question must not be
  // read as having answered it "no".
  // WHICH TIMING SETTLES THIS CALLER'S QUESTION, and it is asked of the SAME role the
  // positional fallback 90 lines below is already asked about. The two disagreed, and
  // that disagreement was the whole of TC_LOGIN_123: its assertion carried a candidate
  // measured at ONE element with identity matched, taken at the pick - the moment the
  // claim was made - and this filter dropped it for saying `pick`, while
  // `positionRecovery` accepted a pick-time POSITION from the same file. So the branch
  // settled with an index on a container-text base instead of the row-scoped expression
  // that already had a Page Object. A worse locator, chosen because the better evidence
  // was the wrong shape of proof for one of two consumers.
  //
  // An ACTION is unchanged and must stay so: `provesIdentity` requires a press for it.
  const proven = measurements.filter(candidate => provesIdentity(candidate, input.kind));
  const unique = measurements.filter(candidate =>
    candidate.matchCount === 1 && candidate.identityMatched !== false);
  const base = {
    pageObject: null, dynamic: null as DynamicIdentifier | null, ambiguous: false,
    rejected: (evidence.rejectedCandidates ?? []).map(candidate => ({
      strategy: candidate.strategy,
      expression: candidate.expression,
      reason: candidate.rejectionReason ?? 'refused',
    })) as RejectedCandidate[],
    candidates: [] as LocatorCandidate[],
  };

  // 0. MEASURED AT ZERO ELEMENTS. It names nothing, so it is not a locator.
  //
  // THIS RUNS FIRST, and before the offline scorer, because the scorer judges SHAPE and
  // this is a MEASUREMENT. `getByRole('checkbox', { name: 'done' })` is a textbook
  // role-and-name locator, rated 95 and classified `stable` - the highest confidence
  // this engine issues - and the browser had already counted it at zero. TC_LOGIN_109
  // emitted it four times. Measured across the whole corpus: 29 targets carry a count
  // of zero, every one of them was emitted verbatim as STABLE_LOCATOR, and no accepted
  // spec on disk contains a single one of them. Not one is a working locator.
  //
  // WHEN A ZERO IS ATTRIBUTABLE, and this is the whole care of the rule. A count is only
  // evidence about the element if it was taken somewhere that can be reasoned about:
  //
  //   `same`     - counted in the document of the press. Decisive: the element was
  //                there, and this expression did not find it.
  //   `other`    - counted on the page that REPLACED the one acted on. NEVER refused
  //                here: `getByRole('button', { name: 'Sign In' })` measured 0 in four
  //                recordings because login had navigated, which is a fact about the
  //                page, not about the button. That is the P0.7 rule and it stands.
  //   `unknown`  - read from the page after the fact, with no press to compare against.
  //                Refused only when the recorder ALSO failed to find the element there
  //                (`(not found)`), which is two independent failures to locate it and
  //                no captured graph to set against them.
  //
  // An UNMEASURED locator (`matchCount === null`) is never touched: absence of a
  // measurement is not a measurement of absence.
  //
  // WHAT REPLACES IT. A press-time proven candidate when the recording has one - which
  // is what the six `same` targets in the corpus all have (TC_LOGIN_071/076/077/078/087
  // carry 2 to 5 each), so they gain a measured locator rather than losing a step.
  // Otherwise a person, because nothing here may invent one.
  if (measuredZero(evidence)) {
    const best = proven[0];
    const where = evidence.matchCountDocument === 'same'
      ? 'in the document the press happened in'
      : 'on the page as it stood just afterwards, and the recorder could not find the '
        + 'element there either';
    if (best) {
      return {
        ...base,
        outcome: 'NORMALIZED_LOCATOR', confidence: 0.9,
        strategy: 'replaced-measured-zero',
        expression: best.expression, classification: 'stable',
        candidates: proven.map(candidate => ({
          strategy: candidate.strategy, expression: candidate.expression, score: 85,
          penalties: [], scoped: candidate.strategy.startsWith('scoped'),
        })),
        reason: `the browser counted this locator at 0 elements ${where}, so it does not `
          + `name anything. It was replaced by ${best.expression}, which the browser measured `
          + 'at exactly one element at the moment of the press, and that element is the one '
          + 'the person acted on (identity checked, not inferred).',
      };
    }
    return {
      ...base, outcome: 'NEEDS_REVIEW', confidence: 0, strategy: 'measured-zero',
      expression: null, classification: 'invalid',
      reason: `the browser counted this locator at 0 elements ${where}. A locator that `
        + 'matches nothing cannot be acted on or asserted against - it can only time out - '
        + 'and nothing measured in this element\'s surroundings can replace it.'
        + triedSummary(evidence),
    };
  }

  // 1. Measured ambiguity - settled ONLY by the element the person actually clicked.
  //
  // A candidate that matched exactly one element is not enough on its own and never
  // was: TC_LOGIN_060 produced four of them, each measured on the page its click had
  // already navigated to. What makes this safe is the identity check - the one match
  // IS the pressed node - and it is why `first()`/`nth()` remain refused: they choose
  // by position, and nobody chose a position.
  const ambiguity = measuredAmbiguity(evidence, input.locator);
  if (ambiguity) {
    const best = proven[0];
    if (best) {
      return {
        ...base,
        outcome: 'NORMALIZED_LOCATOR', confidence: 0.9,
        strategy: 'disambiguated-by-clicked-target',
        expression: best.expression, classification: 'stable',
        candidates: proven.map(candidate => ({
          strategy: candidate.strategy, expression: candidate.expression, score: 85,
          penalties: [], scoped: candidate.strategy.startsWith('scoped'),
        })),
        reason: `${ambiguity.reason}. It was replaced by ${best.expression}, which the browser `
          + 'measured at exactly one element in the same page, at the moment of the press, and '
          + 'that element is the one the person acted on (identity checked, not inferred).',
      };
    }
    // BEFORE REFUSING, the same last recovery branch 1b performs. This is an
    // exhaustion point too, and it was the one a REAL recording actually lands on:
    // an ambiguous click that Codegen wrote WITHOUT `.first()` leaves the recorded
    // locator matching several elements, so `measuredAmbiguity` fires here rather
    // than at 1b, and returning from here consulted nothing. The measured position
    // was in the evidence file and no code path ever read it.
    //
    // "Narrowing it with nth() would pick an element nobody chose" stays true of a
    // SYNTHESISED index and is the reason the refusal below is unchanged. It is not
    // true of an index the browser recorded for the pressed element - somebody did
    // choose that one, which is the whole distinction positionRecovery turns on.
    const byPosition = positionRecovery(evidence, base, input.kind);
    if (byPosition)
      return byPosition;

    return {
      ...base, outcome: 'NEEDS_REVIEW', confidence: 0, strategy: 'measured-ambiguous',
      expression: null, classification: 'invalid', ambiguous: true,
      reason: `${ambiguity.reason}. Narrowing it with first()/nth() would `
        + 'pick an element nobody chose - a person has to say which one.'
        + triedSummary(evidence),
    };
  }

  // 1b. A positional locator, when something proven can replace it.
  //
  // `.first()` collapses any number of matches to one, so `measuredAmbiguity` above
  // sees a count of 1 and the gate never fires. TC_DASHBOARD_011 recorded a click on
  // one checkbox among ten as `locator('.rounded-checkbox-ui').first()` and carried,
  // in the same sidecar, a candidate the browser had measured at exactly one element
  // AND identity-checked against the pressed node. It was never consulted.
  //
  // WHY THIS UPGRADES AND NEVER REJECTS. Treating `.first()` as ambiguous outright
  // would send every positional locator with no proven candidate to NEEDS_REVIEW -
  // measured across the recordings on disk, 15 of 18 positional targets, quarantining
  // steps in nine cases that work today. A positional locator is a last resort, not a
  // defect, and it stays exactly as it was whenever nothing better has been proven.
  // So this branch can only ever replace one, never refuse one.
  if (isPositionalLocator(input.locator)) {
    const best = proven[0];
    if (best) {
      return {
        ...base,
        outcome: 'NORMALIZED_LOCATOR', confidence: 0.9,
        strategy: 'disambiguated-by-clicked-target',
        expression: best.expression, classification: 'stable', ambiguous: true,
        candidates: proven.map(candidate => ({
          strategy: candidate.strategy, expression: candidate.expression, score: 85,
          penalties: [], scoped: candidate.strategy.startsWith('scoped'),
        })),
        reason: 'the recording chose this element by position, which records that several '
          + `matched and hides how many. It was replaced by ${best.expression}, which the `
          + 'browser measured at exactly one element in the same page, at the moment of the '
          + 'press, and that element is the one the person acted on (identity checked, not '
          + 'inferred).',
      };
    }

    // AND WHERE NOTHING WAS PROVEN, THE ANSWER IS NOT THE POSITION.
    //
    // `.first()` is Codegen's record that several elements matched and it took the
    // one that happened to come first. Emitting it as a last resort shipped exactly
    // that guess into a spec - five of them in TC_LOGIN_082 - while the abstraction
    // engine, looking at the same chain, refused to build anything on it. One
    // pipeline, two answers to the same question.
    //
    // The position is not stripped, not re-indexed and not replaced by a different
    // position: there is simply nothing here that identifies the element, so a person
    // decides. A proven contextual candidate is still preferred whenever one exists -
    // that is the branch directly above, and it is unchanged.
    // BEFORE REFUSING, the last deterministic recovery: did the recorder capture
    // which of the several matches was actually pressed? Only reached because the
    // branch above found no proven unique candidate.
    const byPosition = positionRecovery(evidence, base, input.kind);
    if (byPosition)
      return byPosition;

    return {
      ...base, outcome: 'NEEDS_REVIEW', confidence: 0, strategy: 'measured-positional',
      expression: null, classification: 'invalid', ambiguous: true,
      reason: 'the recording chose this element by position, which records that several '
        + 'matched and hides how many. Nothing measured in its surroundings identified '
        + 'exactly one element that the recording can vouch for, so there is nothing to '
        + 'replace the position with - and the position itself says only "the first one '
        + 'Playwright happened to find".'
        + triedSummary(evidence),
    };
  }

  // 2. A generated id, replaced only by something that was counted.
  //
  // WHERE THE GENERATED ID SITS IS NOT THE QUESTION. It may be the graphed element's
  // own - `#tc_summary_638717` recorded on its own - or it may sit in the SCOPE of the
  // recorded chain: `#tc_summary_638717 >> getByText('…')`, whose graphed target is an
  // unclassed <span> carrying no id at all. `evidence.identifier` describes the NODE, so
  // it is null in the second case, and TC_LOGIN_060 showed what that cost. The same row,
  // the same container, the same run: the assertion (bare id) was resolved from measured
  // evidence, while the click (id in the scope) was refused with "nothing in this
  // recording proves a replacement would match exactly one element" - and the proof was
  // sitting in the same sidecar, a candidate the browser had counted at exactly one.
  //
  // So the id is looked for in the recorded chain as well, by the same rules the offline
  // analysis below already uses. What may replace it is unchanged: a candidate the
  // browser measured at exactly one element, and nothing else.
  const identifier = dynamicIdentifierFor(input.locator, evidence.identifier);
  if (identifier) {
    // Proven first, merely-counted second. Both are measured; only the first one knows
    // WHICH element it measured.
    const best = proven[0] ?? unique[0];
    if (!best) {
      // A SAFE ID STILL WINS - that is `best` above, and it is tried first, unchanged.
      // Only once nothing measured can replace the generated id does the position get
      // a hearing. TC_DASHBOARD_023 is the case: Codegen wrote
      // `#tr_1749552 > .tabulator-cell... > .rounded-checkbox-ui`, so the chain carries
      // a generated id, no candidate measured one element, and this branch returned
      // before anything read the nine positioned candidates sitting in the evidence.
      // The dynamic-id analysis itself is untouched: the id is still refused, and what
      // replaces it is still only something the browser measured.
      const byPosition = positionRecovery(evidence, base, input.kind);
      if (byPosition)
        return byPosition;

      return {
        ...base, outcome: 'NEEDS_REVIEW', confidence: 0, strategy: 'normalized-dynamic-id',
        expression: null, classification: 'invalid',
        dynamic: { value: identifier.raw, dynamic: true, signals: identifier.signals, normalised: identifier.normalised },
        reason: `"#${identifier.raw}" is a generated id (reads as ${identifier.normalised}), and nothing `
          + 'measured in its surroundings identified exactly one element that the recording can vouch '
          + 'for. Nothing here can be promoted without guessing.'
          + triedSummary(evidence),
      };
    }
    return {
      ...base,
      outcome: 'NORMALIZED_LOCATOR', confidence: 0.9, strategy: best.strategy,
      expression: best.expression, classification: 'stable',
      dynamic: { value: identifier.raw, dynamic: true, signals: identifier.signals, normalised: identifier.normalised },
      candidates: unique.map(candidate => ({
        strategy: candidate.strategy, expression: candidate.expression, score: 80,
        penalties: [], scoped: candidate.strategy.startsWith('scoped'),
      })),
      reason: `"#${identifier.raw}" is generated, so it was replaced by ${best.expression}, which the `
        + 'browser measured at exactly one element while the recording was being made '
        + `(${best.strategy})`
        + (isProvenAgainstClickedTarget(best)
          ? ', and that element is the one the person acted on (identity checked).'
          : '.'),
    };
  }

  // 3. The expectation belongs to the parent, not the target.
  if (input.kind === 'assertion' && input.value && evidence.parent) {
    const expected = input.value.trim().toLowerCase();
    const targetText = (evidence.target.text ?? '').trim().toLowerCase();
    const parentText = (evidence.parent.text ?? '').trim().toLowerCase();
    const targetHasIt = Boolean(targetText) && targetText.includes(expected);
    const parentHasIt = Boolean(parentText) && parentText.includes(expected);
    if (!targetHasIt && parentHasIt) {
      const best = proven[0] ?? unique[0];
      return {
        ...base,
        outcome: best ? 'NORMALIZED_LOCATOR' : 'NEEDS_REVIEW',
        confidence: best ? 0.85 : 0,
        strategy: best ? best.strategy : 'parent-owns-expectation',
        expression: best ? best.expression : null,
        classification: best ? 'stable' : 'suspicious',
        candidates: best ? [{ strategy: best.strategy, expression: best.expression, score: 80, penalties: [], scoped: false }] : [],
        reason: `the recorded element <${evidence.target.tag}> holds "${truncate(evidence.target.text ?? '')}", `
          + `but the expected text is on its parent <${evidence.parent.tag}> `
          + `("${truncate(evidence.parent.text ?? '')}")`
          + (best
            ? `. Retargeted to ${best.expression}, measured at one element.`
            : '. No counted alternative for the parent exists, so this needs a person - the '
              + 'expected value is NOT rewritten to match the smaller element.'),
      };
    }
  }

  // NO TAIL RECOVERY HERE, deliberately, and this was a real defect.
  //
  // `fromEvidence` is not the last word: `assessLocator` returns its answer only if it
  // produced one, and then goes on to the strict-mode gate and the offline scorer -
  // which is what rates `getByRole('textbox', { name: 'Email' })` at 95 and emits it.
  // A tail call here therefore pre-empted the scorer rather than following it, and the
  // docstring's "nothing above it is weakened" was true only WITHIN this function.
  //
  // It was harmless while `positionProvenCandidates` was always empty. The moment real
  // recordings started carrying positions, TC_DASHBOARD_023 downgraded three clean
  // role-name locators to `.nth(0)` on a container-text base. Positional recovery is
  // now consulted by `assessLocator` AFTER scoring, so it is genuinely last across the
  // whole decision rather than last inside one branch of it.
  return null;
}

/**
 * LAST DETERMINISTIC RECOVERY: an ambiguous candidate that recorded WHICH element
 * was pressed.
 *
 * WHERE IT IS CALLED FROM, and the mistake the old note here made. Four places, and
 * every one of them is an exhaustion point: the measured-ambiguity branch and the
 * positional branch of `fromEvidence`, once no proven unique candidate exists; its
 * generated-id branch, once nothing measured can replace the id; and `assessLocator`
 * itself, after the offline scorer has declined - via `lastResortPosition`.
 *
 * This note used to say "exactly two places... nothing above it is weakened", and the
 * second half was the error. One of those two was the TAIL of `fromEvidence`, whose
 * answer `assessLocator` returns BEFORE the strict-mode gate and the offline scorer
 * run - and the scorer is what emits `getByRole('textbox', { name: 'Email' })`. So the
 * tail pre-empted the scorer rather than following it. Harmless while no recording
 * carried a position; the first one that did downgraded three role-name locators to
 * `.nth(0)`. Recovery is now consulted after scoring, so it is last across the whole
 * decision rather than last within one branch of it.
 *
 * WHY THIS IS NOT `first()` IN DISGUISE. `.first()` picks whatever the DOM happened
 * to order first; nobody chose it and nothing measured it. This picks the index the
 * BROWSER recorded for the element the person actually pressed, at the press, in the
 * press's own document (`isPositionProvenAgainstClickedTarget`). The expression plus
 * that index provably resolved to the pressed element - the one thing a positional
 * locator has never been able to claim.
 *
 * THE CONTEXTUAL CANDIDATE IS THE BASE, never the recorded chain. A scoped candidate
 * is preferred over a bare one, so recovery composes
 * `.tabulator-row filter(...) .rounded-checkbox-ui .nth(k)` rather than
 * `.rounded-checkbox-ui .nth(k)`: the index is a tiebreak inside a named context, not
 * a way to address the whole page by ordinal.
 *
 * WHAT IT DOES NOT PROVE, stated because it matters: a row inserted above shifts every
 * index below it. That residual risk is real, is not settleable here, and is caught at
 * run time by the cardinality resolver and by the test's own assertions.
 */
function positionRecovery(
  evidence: TargetEvidence,
  base: Omit<LocatorAssessment, 'outcome' | 'confidence' | 'strategy' | 'expression' | 'classification' | 'reason'>,
  /**
   * WHICH TIMING this caller may act on, and the only change this function has taken
   * for assertion provenance.
   *
   * An ACTION still demands a press: a position measured at any other moment describes
   * a page the action did not happen on, which is the failure the timing contract
   * exists to prevent, and `isPositionProvenAtPick` is deliberately not merged into the
   * press predicate for that reason.
   *
   * An ASSERTION is a claim about the page as it stood when the person made it, so a
   * position measured AT THAT PICK is the right evidence rather than a weaker one -
   * and for an assertion made before anything was clicked it is the only evidence there
   * can be. TC_LOGIN_107 asserts "not ticked" before its click; there is no press to
   * borrow, and borrowing the later one would describe a different instant.
   *
   * Nothing else about this function moved. The five measurements demanded of a
   * candidate, the refusal of an unsafe base expression, the scoped-beats-bare
   * ordering and the composition of the expression are all unchanged.
   */
  kind: 'action' | 'assertion' = 'action',
): LocatorAssessment | null {
  const proves = kind === 'assertion'
    ? (candidate: CandidateMeasurement) =>
        isPositionProvenAgainstClickedTarget(candidate) || isPositionProvenAtPick(candidate)
    : isPositionProvenAgainstClickedTarget;
  const positioned = (evidence.positionProvenCandidates ?? [])
      .filter(proves)
      // A candidate whose own expression is unsafe cannot be rescued by an index.
      .filter(candidate => {
        const expression = candidate.expression ?? '';
        return Boolean(expression)
          && !isPositionalLocator(expression)
          && !chainHasDynamicIdentifier(expression)
          && !dynamicIdentifiersIn(expression).length;
      })
      // Scoped beats bare: an index should disambiguate inside a context.
      .sort((left, right) => Number(isScopedStrategy(right.strategy)) - Number(isScopedStrategy(left.strategy)));

  const recovered = positioned[0];
  const expression = recovered ? positionalExpression(recovered) : null;
  if (!recovered || !expression)
    return null;

  return {
    ...base,
    outcome: 'NORMALIZED_LOCATOR', confidence: 0.8,
    strategy: 'evidence-backed-position',
    expression, classification: 'stable', ambiguous: true,
    candidates: [{
      strategy: recovered.strategy, expression, score: 70,
      penalties: [{ reason: 'position is evidence, not identity on its own', points: -15 }],
      scoped: isScopedStrategy(recovered.strategy),
    }],
    reason: 'no expression identified this element on its own, but the browser measured '
      + `"${truncate(recovered.expression ?? '')}" at ${recovered.matchCount} elements while the `
      + 'person was pressing, and recorded that the element they pressed was index '
      + `${recovered.positionWithinCandidate} of those. The locator is that expression with that `
      + 'index - the position the browser observed, not a position chosen to make the count one. '
      + 'An index cannot survive the list being reordered, which is why this is the last '
      + 'deterministic resort and why the run-time resolver re-checks cardinality.',
  };
}

/** A candidate strategy that names a container rather than the whole page. */
function isScopedStrategy(strategy: string): boolean {
  return strategy.startsWith('scoped') || strategy.includes('container') || strategy.includes('parent');
}

/**
 * Judge one recorded locator.
 *
 * Candidates come only from the chain that was recorded - each segment of it is a
 * strategy somebody's browser actually resolved. Nothing is synthesised from the
 * element's name, its text or its role unless the recording wrote it down.
 */
/**
 * The last resort, reached only after every better mechanism has declined.
 *
 * ORDER, as the code actually runs it: Page Object reuse, then everything
 * `fromEvidence` measures (proven-unique disambiguation, contextual recovery,
 * identifier replacement), then the strict-mode gate, then the offline scorer. This
 * runs after all of that, at the exits that would otherwise be NEEDS_REVIEW.
 *
 * NOT called at two of those exits, on purpose. An unmeasured bare text locator is
 * refused rather than positioned - `.first()` on three matches is what that gate
 * exists to prevent, and an index measured for one of them does not make the OTHER
 * two go away for a locator nobody scoped. And a chain that would not parse has no
 * candidate to attach an index to.
 */
function lastResortPosition(input: AssessInput, over: {
  dynamic?: DynamicIdentifier | null; ambiguous?: boolean; rejected?: RejectedCandidate[];
} = {}): LocatorAssessment | null {
  const evidence = input.evidence;
  if (!evidence)
    return null;
  return positionRecovery(evidence, {
    pageObject: null, dynamic: over.dynamic ?? null, ambiguous: over.ambiguous ?? false,
    rejected: over.rejected ?? [], candidates: [],
  }, input.kind);
}

export function assessLocator(input: AssessInput): LocatorAssessment {
  if (input.pageObject) {
    return {
      outcome: 'REUSE_PAGE_OBJECT', confidence: 1, strategy: 'page-object',
      expression: null, classification: 'reusable',
      reason: `${input.pageObject.pageObject}.${input.pageObject.method}() already describes this element`,
      pageObject: input.pageObject, candidates: [], dynamic: null, ambiguous: false, rejected: [],
    };
  }

  // ---- Live DOM evidence, when the recording carried any. Every rule here is
  // driven by something the browser MEASURED; nothing is inferred from shape.
  const evidenceVerdict = fromEvidence(input);
  if (evidenceVerdict)
    return evidenceVerdict;

  // ---- STRICT MODE. An unmeasured bare text locator is not a locator.
  //
  // TC_LOGIN_096 asserted `getByText("Projects")` and Playwright refused it at
  // runtime: "resolved to 3 elements". Nothing here had been wrong about it - nothing
  // had MEASURED it. The assertion picker recorded a text locator with no DOM capture,
  // so `fromEvidence` had nothing to answer with, and the offline scorer rates
  // `getByText` at 75, above a stable id. It was emitted as "stable" on shape alone.
  //
  // A bare, unscoped text locator is the one shape whose uniqueness is unknowable
  // without a measurement: any container holding the string matches it as well as the
  // element that owns it, which is why "Projects" found three. Every other shape here
  // is judged on structure that constrains it - an id, a role and name, a scope.
  //
  // So it is refused unless the browser counted exactly one. NOT downgraded, NOT
  // replaced by position, and NOT rewritten into something narrower that nobody
  // measured either: `.first()` would have made this pass and would have asserted
  // against whichever of the three came first. A step with no safe locator is a step
  // for a person.
  // THE SAME RULE FOR THE SAME REASON, ONE SHAPE OVER: a bare structural selector whose
  // uniqueness nothing ATTRIBUTABLE establishes.
  //
  // `page.locator('h2')` reached a generated spec and failed strict mode on three
  // elements (TC_LOGIN_128). Nothing here had been wrong about it either - the recorded
  // locator carried a count of ONE, so `measuredAmbiguity` did not fire, no replacement
  // was sought, and the offline scorer rates css at 65 and emits it. But that count was
  // taken by `captureFor` AFTER the action, in whatever page was showing
  // (`matchCountDocument: 'unknown'`), with identity never asked - the same
  // unattributable measurement the zero rule already refuses to reason from. One in a
  // document nobody can name is not one in the document that mattered.
  //
  // WHAT THIS DOES NOT DO. It does not reject an unknown document: a stable authored id,
  // a role and name, a scoped or contextual expression are all outside the shape test
  // and are judged exactly as before. It runs AFTER `fromEvidence`, so a proven
  // candidate, contextual recovery and evidence-backed position all still answer first,
  // and after Page Object reuse, which happens before this function is ever called.
  // Measured over the corpus: of 694 emitted decisions it touches 110, and 104 of those
  // are the recorder's own overlay.
  if (isUnscopedStructuralLocator(input.locator)
    && !structurallyAttributable(input.evidence, input.locator, input.kind)) {
    const counted = input.evidence?.matchCount;
    const where = input.evidence?.matchCountDocument;
    return {
      outcome: 'NEEDS_REVIEW', confidence: 0, strategy: 'structural', expression: null,
      classification: 'suspicious', pageObject: null, candidates: [], dynamic: null,
      ambiguous: true, rejected: [],
      reason: typeof counted === 'number'
        ? `this locator names nothing but its tag or class, and the only count it has (${counted}) `
          + `was taken ${where === 'other' ? 'on the page that replaced the one acted on'
            : 'after the fact, in a document that cannot be attributed to the interaction'} - `
          + 'so nothing establishes that it identifies one element. Narrowing it by position '
          + 'would pick an element nobody chose; a scoped or named locator, or a person, is the answer'
        : 'an unscoped structural locator was never measured, so nothing establishes that it '
          + 'matches one element - every other element of that tag or class matches it equally',
    };
  }

  if (isUnscopedTextLocator(input.locator) && !textProvenUnique(input.evidence, input.locator, input.kind)) {
    const measured = input.evidence?.pressTimeText?.matchCount;
    return {
      outcome: 'NEEDS_REVIEW', confidence: 0, strategy: 'text', expression: null,
      classification: 'suspicious', pageObject: null, candidates: [], dynamic: null,
      ambiguous: true, rejected: [],
      reason: typeof measured === 'number'
        ? `the text identified ${measured} elements when it was pressed, so this locator does `
          + 'not identify one thing'
        : 'an unscoped text locator was never measured, so nothing establishes that it matches '
          + 'one element - Playwright refuses an ambiguous locator at run time, and choosing '
          + 'one of the matches by position is not an answer',
    };
  }

  const segments = parseChain(input.locator);
  const scoped = segments.filter(s => s.call === 'locator' || s.call.startsWith('getBy')).length > 1;
  const ambiguous = segments.some(s => ['first', 'last', 'nth'].includes(s.call));
  const candidates: LocatorCandidate[] = [];
  let dynamic: DynamicIdentifier | null = null;

  for (const segment of segments) {
    const penalties: Array<{ reason: string; points: number }> = [];
    let strategy: string | null = null;

    if (segment.call === 'getByRole') {
      if (segment.name) {
        strategy = 'role-name';
      } else {
        strategy = 'role-generic';
        penalties.push({ reason: `role "${segment.arg}" carries no accessible name`, points: -10 });
        if (GENERIC_ROLES.has(segment.arg.toLowerCase()))
          penalties.push({ reason: `"${segment.arg}" is a generic role - it names a shape of content, not a thing`, points: -10 });
      }
    } else if (segment.call === 'getByLabel') {
      strategy = 'label';
    } else if (segment.call === 'getByPlaceholder') {
      strategy = 'placeholder';
    } else if (segment.call === 'getByTestId') {
      strategy = 'test-id';
    } else if (segment.call === 'getByText') {
      strategy = 'text';
      if (segment.arg.trim().length < 3)
        penalties.push({ reason: 'the text is too short to identify anything', points: -30 });
    } else if (segment.call === 'getByTitle') {
      strategy = 'title';
    } else if (segment.call === 'getByAltText') {
      strategy = 'alt-text';
    } else if (segment.call === 'locator') {
      const selector = segment.arg;
      // A leading slash is XPath, and it is a SINGLE slash that makes it absolute -
      // `/html/body/div[2]` is the shape Codegen falls back to when an element has
      // nothing else to identify it. Matching only `//` sent exactly that string to
      // the CSS branch, where it scored as an ordinary selector.
      if (/^xpath=|^\.?\//.test(selector)) {
        const body = selector.replace(/^xpath=/, '');
        strategy = /^\/(?!\/)/.test(body) ? 'xpath-absolute' : 'xpath-relational';
        if (/\[\d+\]/.test(selector))
          penalties.push({ reason: 'positional XPath - it depends on sibling order', points: -30 });
        if (strategy === 'xpath-absolute')
          penalties.push({ reason: 'absolute XPath from the document root', points: -40 });
      } else if (dynamicIdentifiersIn(selector).length) {
        // A GENERATED ID ANYWHERE IN THE SELECTOR, not only as the whole of it.
        //
        // `#tr_637446` was caught here; `#tr_637446 > .tabulator-cell > .rounded-checkbox-ui`
        // was not, because the test below requires the selector to BE an id. The compound
        // form therefore scored as ordinary CSS and was emitted verbatim - a locator pinned
        // to one Bugasura issue, live in TC_DASHBOARD_011's generated step.
        //
        // Both shapes are the same fact and now take the same branch. What may replace the
        // id is unchanged: a candidate the browser measured at exactly one element, at the
        // press, and confirmed to be the element acted on. Nothing is promoted by being
        // reclassified here - a target with no such candidate becomes NEEDS_REVIEW, which
        // is what it always should have been.
        const identifier = analyseIdentifier(dynamicIdentifiersIn(selector)[0]);
        dynamic = identifier;
        strategy = 'normalized-dynamic-id';
        penalties.push({ reason: `the selector is built on "${identifier.value}", which looks generated (${identifier.signals.join(', ')}); it identifies one record, not one element`, points: -20 });
      } else if (/^#[^\s.>:[]+$/.test(selector)) {
        const identifier = analyseIdentifier(selector);
        if (identifier.dynamic) {
          dynamic = identifier;
          strategy = 'normalized-dynamic-id';
          penalties.push({ reason: `id looks generated (${identifier.signals.join(', ')}); it identifies one record, not one element`, points: -20 });
        } else {
          strategy = 'stable-id';
          if (CONTAINER_IDS.test(selector.slice(1)))
            penalties.push({ reason: `"${selector}" names a layout container, not a thing to assert about`, points: -25 });
        }
      } else if (/^\[data-[^\]]+\]/.test(selector)) {
        strategy = 'data-attribute';
      } else {
        strategy = 'css';
        if (POSITIONAL_CSS.test(selector))
          penalties.push({ reason: 'positional CSS', points: -25 });
        if (GENERATED_CLASS.test(selector))
          penalties.push({ reason: 'generated class name', points: -25 });
        if (selector.split(/\s+/).length > 3)
          penalties.push({ reason: 'deep descendant chain', points: -15 });
      }
    }

    if (!strategy)
      continue;
    if (ambiguous)
      penalties.push({ reason: 'the recording needed first()/nth() - Codegen matched several elements', points: -30 });

    const score = Math.max(0, penalties.reduce((total, p) => total + p.points, BASE[strategy] ?? 10)
      + (scoped && segment !== segments[0] ? 10 : 0));
    candidates.push({ strategy, expression: segment.raw, score, penalties, scoped });
  }

  if (!candidates.length) {
    return {
      outcome: 'NEEDS_REVIEW', confidence: 0, strategy: 'unknown', expression: null,
      classification: 'invalid', reason: 'the recorded locator could not be parsed into any known strategy',
      pageObject: null, candidates: [], dynamic, ambiguous, rejected: [],
    };
  }

  // ---- Multi-strategy: when the recorded chain cannot resolve, look for a better
  // one IN THE RECORDING. Nothing below invents an attribute, a role or a text.
  const rejected: RejectedCandidate[] = [];

  if (dynamic?.dynamic) {
    // A dynamic scope may only be removed when the replacement is PROVEN unique, and
    // offline nothing can prove that. TC_LOGIN_042 is why this is a hard rule rather
    // than a preference: dropping `#tc_summary_638717` left
    // `getByText('Line Chart | Time Config Page')`, which the application renders
    // twice - once for mobile, once for desktop - so the "safer" locator resolved to
    // two elements and could never be clicked. The id had been doing the
    // disambiguation. Uniqueness now comes from a measured candidate in the evidence
    // (handled in `fromEvidence`, above) or it does not come at all.
    for (const drop of scopeDropCandidates(segments)) {
      const expression = expressionFor(drop.segments);
      rejected.push({
        strategy: 'scope-drop',
        expression,
        reason: 'the recorded descendant may not be unique on its own - this recording '
          + 'carries no measured evidence, and a locator that resolves to two elements '
          + 'is not an improvement on one that resolves to a stale id',
      });
    }

    const axes = axisCandidates({ locator: input.locator, segments, context: input.context ?? [], dynamic });
    rejected.push(...axes.rejected);

    // Same rule as the evidence branch: the id is refused, and a measured position is
    // the last thing tried before giving up on the target entirely.
    const byPosition = lastResortPosition(input, { dynamic, ambiguous, rejected });
    if (byPosition)
      return byPosition;

    return {
      outcome: 'NEEDS_REVIEW', confidence: 0, strategy: 'normalized-dynamic-id',
      expression: null, classification: 'invalid',
      pageObject: null, candidates: [], dynamic, ambiguous, rejected,
      reason: `"#${dynamic.value}" is a generated id (${dynamic.signals.join(', ')}); it reads as `
        + `${dynamic.normalised}. It cannot be emitted, and nothing in this recording proves a `
        + 'replacement would match exactly one element - record this case with '
        + 'RECORDER_TRANSPORT=live so the alternatives can be counted in the page.',
    };
  }

  // The chain as a whole is what gets emitted; the winning candidate explains why it
  // is worth emitting. A scoped chain is judged by its weakest link, because a chain
  // is exactly as reproducible as the least reproducible thing in it.
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const weakest = [...candidates].sort((a, b) => a.score - b.score)[0];
  const best = ranked[0];

  const classification = classify({ weakest, best, dynamic, ambiguous, kind: input.kind });
  const outcome = decide({ classification, best, dynamic, ambiguous });

  // AFTER SCORING, and only if scoring produced no safe locator. This is the ordering
  // that makes positional recovery genuinely last: a role-name locator, a label, a
  // test id - anything `decide` is willing to emit - wins outright, and the position
  // is never consulted for it.
  if (outcome === 'NEEDS_REVIEW') {
    const byPosition = lastResortPosition(input, { dynamic, ambiguous, rejected });
    if (byPosition)
      return byPosition;
  }

  return {
    outcome,
    confidence: Math.round((weakest.score / 100) * 100) / 100,
    strategy: weakest.strategy,
    expression: outcome === 'NEEDS_REVIEW' ? null : input.locator,
    classification,
    reason: explain({ classification, outcome, weakest, best, dynamic, ambiguous, input }),
    pageObject: null,
    candidates: ranked,
    dynamic,
    ambiguous,
    rejected,
  };
}

function classify(input: {
  weakest: LocatorCandidate; best: LocatorCandidate; dynamic: DynamicIdentifier | null;
  ambiguous: boolean; kind: 'action' | 'assertion';
}): LocatorClass {
  if (input.dynamic)
    return 'invalid';
  if (input.weakest.strategy === 'xpath-absolute')
    return 'invalid';
  if (input.weakest.strategy === 'role-generic')
    return input.kind === 'assertion' ? 'suspicious' : 'weak';
  if (input.weakest.penalties.some(p => /layout container/.test(p.reason)))
    return 'weak';
  if (input.ambiguous)
    return 'suspicious';
  // An authored id is stable evidence, so the bar is the stable-id score rather than
  // the text score. `#project_banner` was landing under it and being reported as a
  // last resort, which reads as "we had nothing better" - untrue, and it would have
  // sent a good selector to the Page Object backlog.
  if (input.weakest.score >= BASE['stable-id'])
    return 'stable';
  return 'weak';
}

function decide(input: {
  classification: LocatorClass; best: LocatorCandidate; dynamic: DynamicIdentifier | null;
  ambiguous?: boolean;
}): LocatorOutcome {
  // Only `invalid` stops the pipeline. A dynamic id cannot resolve twice and an
  // absolute XPath cannot survive a layout change: emitting either produces a spec
  // whose failure says nothing about the application.
  if (input.classification === 'invalid')
    return 'NEEDS_REVIEW';
  // A POSITION IS NOT AN IDENTITY, HERE EITHER.
  //
  // The measured branch already refuses `.first()` when nothing was proven. This is
  // the same refusal for a recording that carries no evidence at all - made before
  // capture existed, or whose sidecar has no row for this target. There is even less
  // to go on there, not more, so emitting the position would be the one place the
  // policy relaxed as the evidence got worse.
  if (input.ambiguous)
    return 'NEEDS_REVIEW';
  if (input.best.score >= BASE['stable-id'])
    return 'STABLE_LOCATOR';
  return 'RAW_LOCATOR_LAST_RESORT';
}

function explain(input: {
  classification: LocatorClass; outcome: LocatorOutcome; weakest: LocatorCandidate;
  best: LocatorCandidate; dynamic: DynamicIdentifier | null; ambiguous: boolean; input: AssessInput;
}): string {
  if (input.dynamic) {
    return `"#${input.dynamic.value}" looks generated (${input.dynamic.signals.join(', ')}), so it names `
      + `one record rather than one element - it reads as ${input.dynamic.normalised}. No stable `
      + 'alternative appears in the recording, so this needs a person: give the element a Page Object '
      + 'method, or re-record asserting something that is true for any row.';
  }
  if (input.weakest.strategy === 'xpath-absolute')
    return 'an absolute XPath describes where the element sat, not what it is';
  if (input.classification === 'suspicious' && input.weakest.strategy === 'role-generic') {
    return `${input.weakest.expression} has no accessible name, so it matches by shape alone`
      + (input.input.value ? ` while claiming "${truncate(input.input.value)}" - if the page nests that text, `
        + 'this asserts against the inner element and the expectation belongs to the outer one' : '')
      + '. Recorded as-is; the gate decides whether it holds.';
  }
  if (input.classification === 'weak')
    return `${input.weakest.expression} works but is not semantic: ${input.weakest.penalties.map(p => p.reason).join('; ') || 'structural selector'}`;
  return `${input.weakest.strategy} - ${input.weakest.expression}`;
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}

/* ------------------------------------------------- new Page Object decision */

export interface NewPageObjectDecision {
  safe: boolean;
  /** The class it would go on, when that is known. */
  pageObject: string | null;
  /** A deterministic method name derived from the element's own name. */
  method: string | null;
  /** Ordered candidates for `resolve()`, best first. */
  strategies: string[];
  /** Every condition that could not be proven. Empty means safe. */
  unproven: string[];
}

/**
 * May a new Page Object method be written for this element?
 *
 * Ten conditions, and any one of them unproven means no. This function decides; it
 * does not write - nothing in this phase edits a Page Object or a knowledge file,
 * because the two conditions that fail on every element seen so far are the two that
 * cannot be recovered from a recording alone: which Page Object class owns the screen
 * the element was on, and whether the selector is unique. Guessing either produces a
 * method that looks authoritative and is wrong, which is worse than a raw locator
 * that is honestly labelled.
 */
export function assessNewPageObject(input: {
  assessment: LocatorAssessment;
  target: string;
  /** Page Object class for the screen, when the caller can prove which one it is. */
  owningPageObject?: string | null;
  /** Method names already on that class, to refuse a duplicate. */
  existingMethods?: string[];
}): NewPageObjectDecision {
  const unproven: string[] = [];
  const { assessment } = input;

  if (assessment.classification === 'invalid')
    unproven.push('locator is not stable');
  if (assessment.classification === 'suspicious' || assessment.classification === 'weak')
    unproven.push('locator is not semantic enough to name an element');
  if (assessment.ambiguous)
    unproven.push('uniqueness is not established - the recording needed first()/nth()');
  if (!input.target.trim())
    unproven.push('element identity is unclear - the recording carries no name for it');
  if (!input.owningPageObject)
    unproven.push('the Page Object class that owns this screen is not known from the recording');

  const method = methodNameFor(input.target);
  if (!method)
    unproven.push('no deterministic method name can be derived from the element name');
  if (method && input.existingMethods?.includes(method))
    unproven.push(`${input.owningPageObject}.${method}() already exists`);
  // Uniqueness inside the page cannot be established without a page.
  unproven.push('selector uniqueness cannot be proven offline');

  return {
    safe: unproven.length === 0,
    pageObject: input.owningPageObject ?? null,
    method: method ?? null,
    strategies: assessment.candidates.map(c => c.expression),
    unproven,
  };
}

/** `Create New Team` -> `createNewTeamOption`-style camelCase, or null. */
export function methodNameFor(target: string): string | null {
  const words = target.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.join('').length < 3)
    return null;
  return words
      .map((word, index) => (index === 0
        ? word.toLowerCase()
        : word[0].toUpperCase() + word.slice(1).toLowerCase()))
      .join('');
}
