/**
 * What the application looks like, remembered instead of rediscovered.
 *
 * The generator's expensive habit was opening Bugasura and reading the same pages
 * again for every row. `ai/knowledge/page/*.yaml` is where an exploration is kept
 * so the next case can read it instead: explore once, save, reuse.
 *
 * Three rules keep these files useful rather than just large:
 *
 * - **Semantics, never refs.** `role`, `accessible_name`, `test_id`, and above all
 *   the Page Object method that already wraps the element. Snapshot refs (`e17`,
 *   `f35e11`) are per-session and would be actively wrong the next time.
 * - **Not a copy of anything.** Not the DOM, not the accessibility tree, not the
 *   Page Object source. A knowledge file that grows to the size of the thing it
 *   describes has bought nothing. `references:` points at the snapshot it came
 *   from rather than embedding it.
 * - **Page Objects come first.** Knowledge tells the agent *which* method to call.
 *   It never becomes a place to write locators that belong in a Page Object, and
 *   never a workaround for one that is broken.
 *
 * Sufficiency is decided here, deterministically, before the agent runs - the same
 * principle as `surveyWork` and `selectContext`. But the verdict is *advice in the
 * prompt*, not a lock: a heuristic that wrongly says "sufficient" must not be able
 * to force a spec written from incomplete knowledge. The agent may always explore
 * and say why, and `browserExplorations` in the metrics records what it actually
 * did - so the benchmark measures behaviour, not intent.
 */

import fs from 'node:fs';
import path from 'node:path';

import { KNOWLEDGE_DIR } from './index';
import { type ExtractionResult, extractRequirements, inspectableRequirements } from './requirements';
import { parse, type YamlValue } from './yaml';
import type { TestCase } from '../excel/types';

const ROOT = process.cwd();
export const PAGE_DIR = path.join(KNOWLEDGE_DIR, 'page');

const CHARS_PER_TOKEN = 3.7;
const approx = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

/**
 * Selector tokens, with method calls removed first.
 *
 * `.filter`, `.locator`, `.click` and friends look exactly like class selectors to a
 * regex, and a knowledge entry's `locator_strategy` is often a whole expression:
 *
 *   page.locator('.tabulator-row').filter({ hasText: description }).locator('.bugChecked')
 *
 * Read naively that yields `.locator`, `.tabulator-row`, `.filter`, `.bugChecked` - and
 * the project card `page.locator("#all_apps .title").filter({ hasText: "Faclon labs" })`
 * yields `.locator`, `#all_apps`, `.title`, `.filter`. Both end in `.filter`, so a
 * project card was reported as already wrapped by `IssuesPage.issueCheckboxState()` -
 * two unrelated elements, matched on a method name. Stripping `.name(` first leaves
 * only what is actually a selector.
 */
function selectorText(value: string): string {
  return (value ?? '').replace(/\.[A-Za-z_]\w*\s*\(/g, ' ');
}

/**
 * The `#id`, `.class` and `[attr="v"]` tokens in a string, method calls stripped first.
 *
 * ONE TOKENISER, TWO READERS. `declaredSelectors` asks it what a knowledge entry
 * declares; the abstraction engine asks it what a locator template points at. Those
 * were separate regexes for one phase, which is how they drifted - the engine's copy
 * omitted the attribute form - so the comparison between them was not quite
 * symmetrical. They are the same question about the same syntax and now share one
 * answer.
 */
export function selectorTokens(value: string): string[] {
  const original = value ?? '';
  const found = selectorText(original)
      .match(/#[A-Za-z_][\w-]*|\.[A-Za-z_][\w-]*|\[[\w-]+\s*=\s*["'][^"']*["']\]/g) ?? [];
  // A trailing full stop in prose looks like a class. A bare `.word` with no hyphen or
  // underscore is far more likely to be English than a selector, so it is kept only
  // when the text reads like a selector rather than a sentence.
  //
  // TESTED AGAINST THE ORIGINAL, not the stripped copy. `selectorText` removes
  // `.locator(` - which is exactly the marker this test looks for - so reading the
  // stripped text made every camelCase class vanish: `issueCheckboxState` declares
  // `.tabulator-row` and `.bugChecked`, and only `.tabulator-row` survived. The method
  // was then matched on the row CONTAINER it merely sits in, which is the false
  // positive the stripping was added to prevent in the first place.
  return found.filter(token =>
    !token.startsWith('.') || /[-_]/.test(token) || /locator\(|\bcss\b/i.test(original));
}

/**
 * The concrete selector tokens a knowledge entry declares - `#id`, `.class`,
 * `[attr="v"]` - read out of its `locator_strategy`.
 *
 * `locator_strategy` is prose with a selector in it, not a selector:
 *
 *     "#filter-value - only one copy on this screen, unlike the login/apps search
 *      fields there is no hidden duplicate to scope away"
 *     "getByRole textbox named Search; a CSS fallback"
 *
 * So it is scanned for tokens rather than compared. An entry that names no concrete
 * token returns nothing, and callers treat that as "cannot be matched on a locator" -
 * never as "matches anything".
 *
 * TWO CALLERS, ONE READER. `findMethod` uses it to break a tie between entries that
 * share an accessible name, and the abstraction engine uses it to notice that a
 * capability it is about to create already exists under another name. Both are asking
 * the same question - what does this entry claim to point at - so both ask it here.
 */
export function declaredSelectors(element: PageElement): string[] {
  return [...new Set(selectorTokens(element.locator_strategy ?? ''))];
}

export interface PageElement {
  id: string;
  /**
   * Which kind of step this element's method is for: `action` or `assertion`.
   *
   * Optional and additive - every entry written before it has none, and an entry with
   * none behaves exactly as it did. It exists because the clickable element and the
   * element carrying state are routinely different nodes, so a method written for one
   * must not be reused for the other on the strength of a similar-looking locator.
   */
  usage?: string;
  description?: string;
  role?: string;
  accessible_name?: string;
  label?: string;
  test_id?: string;
  page_object?: string;
  page_object_method?: string;
  locator_strategy?: string;
}

/**
 * Blocking UI a previous generation case can leave behind on a screen, declared by
 * whoever explored it, with the control that closes it.
 *
 * This is what makes the session reset application-aware instead of a generic
 * "press Escape and hope". `ai/autocode/session.ts` checks each `selector` for
 * visibility before handing a reused browser to the next case, and clicks
 * `close_selector` if one is showing. Nothing else is ever clicked: a reset that
 * guesses is more dangerous than a fresh browser, because it can leave the
 * application in a state nobody has described.
 *
 *   overlays:
 *     - name: onboarding report modal
 *       selector: "#first_report_modal"
 *       close_selector: "#first_report_modal button:has-text('close')"
 *
 * An overlay with no `close_selector` is one nothing knows how to dismiss safely -
 * so seeing it means the session is contaminated and must be discarded.
 */
export interface Overlay {
  name: string;
  description?: string;
  selector: string;
  closeSelector?: string;
  /** Which knowledge file declared it, for the log. */
  file: string;
  route: string;
}

export interface PageKnowledge {
  /** Repo-relative path of the YAML this came from. */
  file: string;
  id: string;
  name: string;
  purpose: string;
  route: string;
  authenticationRequired: boolean;
  entryPoint: string;
  prerequisites: string[];
  elements: PageElement[];
  actions: Array<{ name: string; description?: string; page_object?: string; method?: string }>;
  assertions: Array<{ name: string; description?: string }>;
  states: Array<{ name: string; description?: string }>;
  references: { screenshot?: string; accessibility_snapshot?: string };
  /**
   * Optional `synonyms:` map — a word the workbook might use, pointing at the
   * concept this file describes.
   *
   * Declared per file rather than as a global table on purpose. A global synonym
   * list is a guess about vocabulary the guesser has not read; a list in the
   * knowledge file is a statement by whoever explored that screen. It is the
   * sanctioned way to fix a legitimate false negative — the alternative is
   * widening the fuzzy matching that this module just removed.
   *
   *   synonyms:
   *     terms: [conditions, tos]
   */
  synonyms: Map<string, string>;
  /** Blocking UI this screen can leave behind, and how to close it safely. */
  overlays: Overlay[];
  metadata: { source?: string; last_verified?: string; knowledge_version?: number | string };
  /** Raw YAML text, for inlining into a prompt without re-emitting it. */
  raw: string;
  approxTokens: number;
}

const asRecord = (value: YamlValue): Record<string, YamlValue> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, YamlValue> : {};
const asArray = (value: YamlValue): YamlValue[] => Array.isArray(value) ? value : [];
const asString = (value: YamlValue): string => value === null || value === undefined ? '' : String(value);

function hydrate(file: string, raw: string): PageKnowledge {
  const document = asRecord(parse(raw));
  const page = asRecord(document.page);
  const navigation = asRecord(document.navigation);
  const elements = asRecord(document.elements);
  const references = asRecord(document.references);
  const metadata = asRecord(document.metadata);

  return {
    file: path.relative(ROOT, file).replace(/\\/g, '/'),
    id: asString(page.id) || path.basename(file, path.extname(file)),
    name: asString(page.name),
    purpose: asString(page.purpose),
    route: asString(page.route),
    authenticationRequired: navigation.authentication_required === true,
    entryPoint: asString(navigation.entry_point),
    prerequisites: asArray(navigation.prerequisites).map(asString),
    elements: Object.entries(elements).map(([id, value]) => {
      const entry = asRecord(value);
      return {
        id,
        usage: asString(entry.usage) || undefined,
        description: asString(entry.description) || undefined,
        role: asString(entry.role) || undefined,
        accessible_name: asString(entry.accessible_name) || undefined,
        label: asString(entry.label) || undefined,
        test_id: asString(entry.test_id) || undefined,
        page_object: asString(entry.page_object) || undefined,
        page_object_method: asString(entry.page_object_method) || undefined,
        locator_strategy: asString(entry.locator_strategy) || undefined,
      };
    }),
    actions: asArray(document.actions).map(value => {
      const entry = asRecord(value);
      return {
        name: asString(entry.name),
        description: asString(entry.description) || undefined,
        page_object: asString(entry.page_object) || undefined,
        method: asString(entry.method) || undefined,
      };
    }),
    assertions: asArray(document.assertions).map(value => {
      const entry = asRecord(value);
      return { name: asString(entry.name), description: asString(entry.description) || undefined };
    }),
    states: asArray(document.states).map(value => {
      const entry = asRecord(value);
      return { name: asString(entry.name), description: asString(entry.description) || undefined };
    }),
    references: {
      screenshot: asString(references.screenshot) || undefined,
      accessibility_snapshot: asString(references.accessibility_snapshot) || undefined,
    },
    synonyms: (() => {
      const map = new Map<string, string>();
      for (const [concept, listed] of Object.entries(asRecord(document.synonyms))) {
        for (const word of asArray(listed).map(asString))
          map.set(word.trim().toLowerCase(), concept.trim().toLowerCase());
      }
      return map;
    })(),
    overlays: asArray(document.overlays).map(value => {
      const entry = asRecord(value);
      return {
        name: asString(entry.name),
        description: asString(entry.description) || undefined,
        selector: asString(entry.selector),
        closeSelector: asString(entry.close_selector) || undefined,
        file: path.relative(ROOT, file).replace(/\\/g, '/'),
        route: asString(page.route),
      };
    }).filter(overlay => overlay.selector),
    metadata: {
      source: asString(metadata.source) || undefined,
      last_verified: asString(metadata.last_verified) || undefined,
      knowledge_version: metadata.knowledge_version as number | string | undefined,
    },
    raw,
    approxTokens: approx(raw.length),
  };
}

/**
 * Every page knowledge file.
 *
 * A file that will not parse throws rather than being skipped: silently dropping
 * it would look exactly like "no knowledge exists", and the generator would go and
 * explore a page it already knew - the failure this module exists to prevent, made
 * invisible.
 */
export function readAllPageKnowledge(dir: string = PAGE_DIR): PageKnowledge[] {
  if (!fs.existsSync(dir))
    return [];
  const found: PageKnowledge[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.ya?ml$/i.test(name))
      continue;
    const full = path.join(dir, name);
    try {
      found.push(hydrate(full, fs.readFileSync(full, 'utf8')));
    } catch (error) {
      throw new Error(`ai/knowledge/page/${name} could not be read: ${(error as Error).message}`);
    }
  }
  return found;
}

/**
 * Every overlay any screen declares.
 *
 * Read by the session checkpoint, which does not know which screen the browser is
 * on - the previous case could have left it anywhere - so it checks all of them in
 * one page evaluation. Cheap: there are a handful, and they are CSS selectors.
 */
export function declaredOverlays(all: PageKnowledge[] = readAllPageKnowledge()): Overlay[] {
  return all.flatMap(knowledge => knowledge.overlays);
}

/** Words too common to be evidence. Shared shape with context.ts's list. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'then', 'when', 'should',
  'page', 'test', 'user', 'click', 'open', 'check', 'verify', 'enter', 'select', 'displayed',
  'shown', 'able', 'must', 'will', 'have', 'has', 'are', 'was', 'not', 'button', 'field',
  'bugasura', 'application', 'valid', 'invalid', 'correct', 'successfully', 'without',
  'given', 'their', 'they', 'them', 'all', 'any', 'each', 'new', 'via', 'using', 'after',
  'before', 'again', 'also', 'only', 'same', 'other', 'step', 'steps', 'case', 'expected',
  'result', 'navigate', 'navigates', 'navigated', 'goes', 'sees', 'see', 'show', 'shows',
]);

function terms(text: string): string[] {
  return [...new Set(
      text.toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .split(' ')
          .filter(word => word.length > 3 && !STOPWORDS.has(word)),
  )];
}

/**
 * How a requirement came to be considered known.
 *
 * Ordered by how much it can be trusted, and that ordering is the whole design.
 * The earlier version of this module used a five-character prefix as its main
 * mechanism and justified it as "biased toward covered, because the gate still has
 * to pass". That was wrong, and the reasoning was wrong: the falsification gate
 * proves a spec *can fail*, not that it tests the right thing. A false "covered"
 * suppresses the exploration that would have corrected a wrong assumption, and the
 * result is a spec that passes, fails when mutated, and asserts something the
 * author never asked for. Nothing downstream catches that.
 *
 * So the prefix is gone, and uncertainty now resolves to `partial` - targeted
 * exploration - rather than to silence.
 */
export type MatchType =
  /** Whole word in a structured knowledge field. */
  | 'exact-knowledge'
  /** Whole word elsewhere in the YAML body - e.g. the `languages:` table. */
  | 'knowledge-data'
  /** Whole word in an existing Page Object method name. */
  | 'page-object-method'
  /** Declared in that knowledge file's own `synonyms:` map. */
  | 'declared-synonym'
  /** One of a short, fixed list of inflection rules. See INFLECTIONS. */
  | 'inflection'
  /** Found only inside a YAML comment. Real evidence, but not structured - uncertain. */
  | 'comment-only'
  | 'none';

export type Confidence = 'certain' | 'uncertain' | 'none';

export interface MatchDecision {
  requirement: string;
  /** The word or phrase in the knowledge that accounted for it. */
  matched: string | null;
  matchType: MatchType;
  /** Which knowledge file, when the match came from one. */
  matchedKnowledge: string | null;
  reason: string;
  confidence: Confidence;
}

/**
 * A whole-word test. Substring matching is what makes `project` match `projection`.
 *
 * Exported for the matcher test: whole-word behaviour is the single property that
 * prevents the worst class of false positive, so it is worth asserting directly
 * rather than only through a verdict.
 */
export function hasWordForTest(haystack: string, word: string): boolean {
  return hasWord(haystack, word);
}

function hasWord(haystack: string, word: string): boolean {
  if (!word)
    return false;
  return new RegExp(`(?:^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`)
      .test(haystack);
}

/**
 * The only morphological relationships treated as meaning-preserving.
 *
 * Each is a form of the same lemma, not a derivation into a new concept. What is
 * *absent* matters more than what is present:
 *
 *   -ion    REJECTED. `projection` is not `project`, `selection` is not `select`.
 *           This is the exact false positive that a generic stemmer produces and
 *           the reason five-character prefixing had to go.
 *   -ment   REJECTED. `agreement` is not `agree`.
 *   -ance   REJECTED. `appearance` is not `appear` for testing purposes.
 *   -al     REJECTED. `approval` is not `approve`.
 *   -ive    REJECTED. `selective` is not `select`.
 *
 * `-bility`/`-ble` is included and is the one nominalisation here, because it is a
 * closed, regular pair in English and the two words denote the same property:
 * "verify visibility" and "asserted VISIBLE" are the same requirement. That case is
 * the reason this table exists at all rather than only exact matching.
 */
const INFLECTIONS: Array<{ rule: string; forms: (term: string) => string[] }> = [
  { rule: 'plural -s', forms: term => term.endsWith('s') && !term.endsWith('ss') ? [term.slice(0, -1)] : [] },
  { rule: 'plural -es', forms: term => term.endsWith('es') ? [term.slice(0, -2)] : [] },
  { rule: 'plural -ies/-y', forms: term => term.endsWith('ies') ? [`${term.slice(0, -3)}y`] : [] },
  { rule: 'singular -> plural', forms: term => [`${term}s`, `${term}es`] },
  { rule: 'past -ed', forms: term => term.endsWith('ed') ? [term.slice(0, -1), term.slice(0, -2)] : [] },
  { rule: 'gerund -ing', forms: term => term.endsWith('ing') ? [term.slice(0, -3), `${term.slice(0, -3)}e`] : [] },
  { rule: 'adverb -ly', forms: term => term.endsWith('ly') ? [term.slice(0, -2)] : [] },
  { rule: '-bility/-ble', forms: term => term.endsWith('bility') ? [`${term.slice(0, -6)}ble`] : [] },
  { rule: '-ble/-bility', forms: term => term.endsWith('ble') ? [`${term.slice(0, -3)}bility`] : [] },
];

/** Forms of the same word, with the rule that produced each. Never derivations. */
function inflectionsOf(term: string): Array<{ form: string; rule: string }> {
  const found: Array<{ form: string; rule: string }> = [];
  for (const { rule, forms } of INFLECTIONS) {
    for (const form of forms(term)) {
      // Too-short forms collide with unrelated words; the term itself is not news.
      if (form.length >= 4 && form !== term)
        found.push({ form, rule });
    }
  }
  return found;
}

/** The three haystacks a knowledge file offers, in descending trustworthiness. */
interface Haystacks {
  file: string;
  /** Values of the modelled fields: elements, actions, assertions, states, page. */
  structured: string;
  /** Every non-comment line of the YAML. Includes sections this module does not model. */
  body: string;
  /** Comment lines only. Genuine knowledge, but unstructured - so uncertain. */
  comments: string;
  /** Declared word -> concept, from the file's own `synonyms:` map. */
  synonyms: Map<string, string>;
}

function haystacksFor(knowledge: PageKnowledge): Haystacks {
  const lines = knowledge.raw.split('\n');
  return {
    file: knowledge.file,
    structured: structuredText(knowledge).toLowerCase(),
    body: lines.filter(line => !line.trim().startsWith('#')).join(' ').toLowerCase(),
    comments: lines.filter(line => line.trim().startsWith('#')).join(' ').toLowerCase(),
    synonyms: knowledge.synonyms,
  };
}

/**
 * Decide one requirement, recording how and how confidently.
 *
 * Priority order is the user-facing contract: exact semantics, then an existing
 * Page Object method, then a mapping somebody declared explicitly, then a
 * meaning-preserving inflection, then unstructured prose - and only that last one
 * counts as uncertain.
 */
function decide(term: string, haystacks: Haystacks[], methodText: string): MatchDecision {
  for (const hay of haystacks) {
    if (hasWord(hay.structured, term)) {
      return { requirement: term, matched: term, matchType: 'exact-knowledge',
        matchedKnowledge: hay.file, confidence: 'certain',
        reason: `"${term}" appears in a structured field of ${hay.file}` };
    }
  }

  if (hasWord(methodText, term)) {
    return { requirement: term, matched: term, matchType: 'page-object-method',
      matchedKnowledge: null, confidence: 'certain',
      reason: `"${term}" names part of an existing Page Object method` };
  }

  for (const hay of haystacks) {
    const concept = hay.synonyms.get(term);
    if (concept && (hasWord(hay.structured, concept) || hasWord(hay.body, concept))) {
      return { requirement: term, matched: concept, matchType: 'declared-synonym',
        matchedKnowledge: hay.file, confidence: 'certain',
        reason: `${hay.file} declares "${term}" as a synonym for "${concept}", which it describes` };
    }
  }

  for (const hay of haystacks) {
    if (hasWord(hay.body, term)) {
      return { requirement: term, matched: term, matchType: 'knowledge-data',
        matchedKnowledge: hay.file, confidence: 'certain',
        reason: `"${term}" appears in the body of ${hay.file}` };
    }
  }

  for (const { form, rule } of inflectionsOf(term)) {
    for (const hay of haystacks) {
      if (hasWord(hay.structured, form) || hasWord(hay.body, form)) {
        return { requirement: term, matched: form, matchType: 'inflection',
          matchedKnowledge: hay.file, confidence: 'certain',
          reason: `"${term}" is the same word as "${form}" (${rule}), described in ${hay.file}` };
      }
    }
    if (hasWord(methodText, form)) {
      return { requirement: term, matched: form, matchType: 'inflection',
        matchedKnowledge: null, confidence: 'certain',
        reason: `"${term}" is the same word as "${form}" (${rule}), which names part of a Page Object method` };
    }
  }

  for (const hay of haystacks) {
    if (hasWord(hay.comments, term)) {
      return { requirement: term, matched: term, matchType: 'comment-only',
        matchedKnowledge: hay.file, confidence: 'uncertain',
        reason: `"${term}" appears only in a comment in ${hay.file}, not in a structured field - ` +
          'treated as uncertain, so it is inspected rather than assumed' };
    }
  }

  return { requirement: term, matched: null, matchType: 'none', matchedKnowledge: null,
    confidence: 'none', reason: `nothing in the selected knowledge accounts for "${term}"` };
}

/**
 * Is this whole phrase accounted for?
 *
 * `decide()` is untouched and still judges one word against the knowledge. A requirement
 * is now a noun phrase, so it is judged by composing that function over its words - and
 * the composition is where the conservatism lives:
 *
 *   every word certain                  -> certain   (exactly the old behaviour)
 *   head noun certain, a modifier not   -> uncertain (inspect: `bell` is described,
 *                                                     `notifications bell` may not be)
 *   head noun not certain               -> none      (inspect)
 *
 * The head of an English noun phrase is its last word, which is why `notifications bell`
 * is judged on `bell` and `create project button` on `button`.
 *
 * The property that makes this safe to ship: a phrase can only be a gap if at least one
 * of its words was already a gap under the old extractor, so no phrase can send anybody
 * to a browser that the previous algorithm would not have sent. The change strictly
 * removes exploration; it cannot add any.
 */
function decidePhrase(phrase: string, haystacks: Haystacks[], methodText: string): MatchDecision {
  const all = phrase.split(' ').filter(Boolean);
  // Words of three characters or fewer are not judged when the phrase has longer words
  // to judge instead. The old extractor never made a claim about them (its filter was
  // `length > 3`), so treating one as an unanswered requirement would ADD exploration
  // this phase is supposed to remove - `visibility off` opened a browser on the strength
  // of `off`. A phrase that is nothing but short words is still judged on them, because
  // `tab` and `row` are real things on a screen.
  const long = all.filter(word => word.length > 3);
  const words = long.length ? long : all;

  // The whole phrase first, because knowledge files quote the application's own copy:
  // `bugasura__apps.yaml` contains "Project name cannot be empty." verbatim, and judging
  // that word by word failed on `cannot` - prose inside a quotation. `decide` already
  // matches whole words, and a phrase with spaces is just a longer whole word.
  if (all.length > 1) {
    const whole = decide(phrase, haystacks, methodText);
    if (whole.confidence === 'certain')
      return { ...whole, requirement: phrase, reason: `the whole phrase "${phrase}" appears in ${whole.matchedKnowledge ?? 'a Page Object method'}` };
  }

  const perWord = words.map(word => decide(word, haystacks, methodText));
  const head = perWord[perWord.length - 1];

  if (perWord.every(decision => decision.confidence === 'certain')) {
    return { ...head, requirement: phrase,
      reason: words.length === 1
        ? head.reason
        : `every word of "${phrase}" is accounted for (${perWord.map(decision => decision.matchType).join(', ')})` };
  }

  const missing = perWord.filter(decision => decision.confidence !== 'certain')
      .map(decision => decision.requirement);

  if (head.confidence === 'certain') {
    return {
      requirement: phrase, matched: head.matched, matchType: head.matchType,
      matchedKnowledge: head.matchedKnowledge, confidence: 'uncertain',
      reason: `"${head.requirement}" is described, but ${missing.map(word => `"${word}"`).join(', ')} `
        + `${missing.length === 1 ? 'is' : 'are'} not - so "${phrase}" is inspected rather than assumed`,
    };
  }

  return {
    requirement: phrase, matched: null, matchType: 'none', matchedKnowledge: null,
    confidence: 'none',
    reason: `nothing in the selected knowledge accounts for "${phrase}"`,
  };
}

/**
 * The values of the fields this module models.
 *
 * Kept separate from the rest of the YAML because the distinction carries weight in
 * the sufficiency decision: a hit here is a structured statement about the page, a
 * hit elsewhere in the body is still real (the `languages:` table is verified
 * knowledge no field models), and a hit only in a comment is not enough to suppress
 * exploration.
 */
function structuredText(knowledge: PageKnowledge): string {
  return [
    knowledge.id, knowledge.name, knowledge.purpose, knowledge.route, knowledge.entryPoint,
    ...knowledge.prerequisites,
    ...knowledge.elements.flatMap(element => [
      element.id, element.description, element.role, element.accessible_name,
      element.label, element.test_id, element.page_object_method,
    ]),
    ...knowledge.actions.flatMap(action => [action.name, action.description, action.method]),
    ...knowledge.assertions.flatMap(assertion => [assertion.name, assertion.description]),
    ...knowledge.states.flatMap(state => [state.name, state.description]),
  ].filter(Boolean).join(' ');
}

/**
 * Everything a *selection* decision may look at.
 *
 * Selection is allowed to be fuzzy - choosing which knowledge file to show costs a
 * few hundred tokens if it is wrong. Sufficiency is not, because being wrong there
 * suppresses a browser visit. The two use different machinery on purpose.
 */
function searchable(knowledge: PageKnowledge): string {
  return `${knowledge.raw} ${structuredText(knowledge)}`.toLowerCase();
}

export interface KnowledgeMatch {
  knowledge: PageKnowledge;
  score: number;
  why: string;
}

/**
 * Which knowledge files this row is about.
 *
 * Scored the same way Page Objects are, and for the same reason: the row names its
 * screen in its own words, so the words are the signal. Only files that clear a
 * floor are returned - loading every knowledge file would recreate the survey
 * problem one directory over.
 */
export function selectPageKnowledge(testCase: TestCase, all: PageKnowledge[] = readAllPageKnowledge()): KnowledgeMatch[] {
  const rowText = [
    testCase.module, testCase.feature, testCase.scenario, testCase.description,
    testCase.preconditions, testCase.steps.join(' '), testCase.testData,
    testCase.expectedResult, testCase.source.worksheet,
  ].filter(Boolean).join(' ');
  const rowTerms = terms(rowText);
  const lowered = rowText.toLowerCase();

  return all
      .map(knowledge => {
        const hay = searchable(knowledge);
        const hits = rowTerms.filter(term => hay.includes(term));
        // The file's own id and name are the strongest signal - a row about the
        // "language picker" naming it is not a coincidence.
        const named = [knowledge.id, knowledge.name]
            .filter(Boolean)
            .some(label => lowered.includes(label.toLowerCase().replace(/[-_]/g, ' '))
              || lowered.includes(label.toLowerCase()));
        const score = hits.length + (named ? 6 : 0);
        return {
          knowledge,
          score,
          why: [
            named ? `row names "${knowledge.id}"` : '',
            hits.length ? `${hits.length} term(s) match: ${hits.slice(0, 5).join(', ')}` : '',
          ].filter(Boolean).join('; '),
        };
      })
      .filter(match => match.score >= 3)
      .sort((a, b) => b.score - a.score)
      // A RELATIVE floor as well as an absolute one, and it earned its place by
      // measurement. Once knowledge was consolidated one-file-per-screen the files got
      // bigger, and a bigger file wins incidental hits: the /apps file scored 4-7 on
      // the *login* rows on generic vocabulary alone - "option", "text", "email",
      // "link" - while the sign-in file scored 8-12. Both cleared the absolute floor,
      // so three rows carried an extra ~2,955-token file about a screen they never
      // touch, and went over the context budget doing it.
      //
      // Anything scoring less than 60% of the best match is incidental rather than
      // relevant. This can only ever drop a file that something else beat clearly; if
      // that file was in fact needed, its terms become gaps and the row is sent to look
      // at them, which is the conservative direction.
      .filter((match, _index, ranked) => match.score >= ranked[0].score * 0.6);
}

export type Sufficiency = 'sufficient' | 'partial' | 'none';

export interface SufficiencyResult {
  verdict: Sufficiency;
  /**
   * Requirements to inspect: everything not certainly covered. Uncertain items are
   * in here too - that is the point of the conservative rule.
   */
  gaps: string[];
  /** Requirements certainly covered. */
  covered: string[];
  /** Every decision, with its type and reason, so a verdict can be audited. */
  decisions: MatchDecision[];
  reason: string;
  /**
   * What was extracted from the row and what was dropped, for the metrics and the run
   * log. Optional so the `none` verdict - returned before anything is extracted - does
   * not have to fabricate an empty one.
   */
  requirements?: ExtractionResult;
}

/**
 * Is what we already know enough to write this test without a browser?
 *
 * The rule, and it is deliberately asymmetric:
 *
 *   every requirement CERTAINLY covered      -> sufficient
 *   any requirement uncertain or uncovered   -> partial  (inspect just those)
 *   no knowledge file for the screen         -> none     (explore it once)
 *
 * Uncertainty resolves to exploration, never to silence. The earlier version
 * treated a fuzzy hit as covered on the grounds that the falsification gate would
 * catch a mistake, and that was a misreading of what the gate does: it proves a spec
 * *can fail*, not that it asserts the right thing. A spec written from a wrong
 * assumption passes clean, fails mutated, and is accepted - so a false "covered" is
 * not a cheap error, it is an undetectable one.
 *
 * `sufficient` still is not a licence. It suppresses the default assumption that a
 * browser is needed; the agent may open one anyway, and `browserExplorations` in the
 * metrics records what it actually did rather than what this predicted.
 */
export function assessSufficiency(
  testCase: TestCase,
  matches: KnowledgeMatch[],
  pageObjectMethods: string[] = [],
): SufficiencyResult {
  if (!matches.length) {
    return {
      verdict: 'none', gaps: [], covered: [], decisions: [],
      reason: 'no page knowledge file covers this screen yet - explore it once, then write the YAML',
    };
  }

  // What this row actually requires of a screen, classified rather than tokenised.
  //
  // This used to be `terms()` over scenario + steps + expected result: every word over
  // three characters that was not in a 69-word stop-list. Twenty of those stop-words
  // were the UI vocabulary (`button`, `field`, `displayed`, `click`), so the filter
  // discarded the evidence and kept the prose - and six of the eight gap terms that
  // ever opened a browser named nothing on any screen. See ai/knowledge/requirements.ts.
  //
  // `terms()` is still used, immediately above in `selectPageKnowledge`, and that is
  // deliberate: choosing WHICH knowledge files are relevant is a recall problem where a
  // loose match costs a little context, while deciding whether to open a browser is a
  // precision problem where a loose match costs a browser and a wrong assumption.
  const extraction = extractRequirements(testCase);
  const required = inspectableRequirements(extraction);

  const haystacks = matches.map(match => haystacksFor(match.knowledge));
  // camelCase split so `openCreateNewTeamForm` offers `create`, `team`, `form`.
  const methodText = pageObjectMethods
      .map(name => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
      .join(' ')
      .toLowerCase();

  const decisions = required.map(requirement => decidePhrase(requirement.phrase, haystacks, methodText));
  const covered = decisions.filter(decision => decision.confidence === 'certain').map(decision => decision.requirement);
  const gaps = decisions.filter(decision => decision.confidence !== 'certain').map(decision => decision.requirement);

  const files = matches.map(match => match.knowledge.file).join(', ');

  // A row that places no requirement on a screen. Not the same as a covered row, and
  // said differently in the reason so it can never be read as one: nothing was found to
  // verify, so there is nothing a browser could be opened to answer. This is where the
  // placeholder rows land - "Needs confirmation" is not a fact about an application.
  if (!required.length) {
    return {
      verdict: 'sufficient', gaps: [], covered: [], decisions: [], requirements: extraction,
      reason: `no requirement in this row names anything on a screen `
        + `(${extraction.counts.genericDroppedCount} generic and `
        + `${extraction.counts.placeholderDroppedCount} placeholder clause(s) dropped, `
        + `${extraction.counts.businessAssertionCount} business assertion(s) noted)`,
    };
  }

  if (!gaps.length) {
    return {
      verdict: 'sufficient', gaps, covered, decisions, requirements: extraction,
      reason: `all ${covered.length} requirement(s) certainly covered by ${files}`,
    };
  }

  const uncertain = decisions.filter(decision => decision.confidence === 'uncertain');
  return {
    verdict: 'partial', gaps, covered, decisions, requirements: extraction,
    reason: `${files} certainly covers ${covered.length} term(s); ${gaps.length} need inspection` +
      `${uncertain.length ? ` (${uncertain.length} matched only uncertainly)` : ''}: ${gaps.join(', ')}`,
  };
}

/**
 * Words that cannot name anything a browser could be opened to look at.
 *
 * A closed, reviewable list, and the reason it exists: `assessSufficiency` extracts
 * requirement terms from the row's own prose, so a scenario reading "the All tab is
 * selected on arrival" yields `arrival` as a "requirement". Nothing on any screen is
 * an arrival. Four of the six gaps in the Phase 4 benchmark were words of this kind -
 * `arrival`, `above`, `marked`, `accepts` - and each of them opened a browser that
 * had nothing to find.
 *
 * The rule for membership is deliberately narrow: a word belongs here only if it
 * describes a RELATION, a MOMENT, a MANNER or a GENERIC STATE - never a thing. There
 * are no nouns naming UI here. `strip` was considered and rejected: a tab strip is a
 * real element somebody could inspect, so if it is genuinely unknown the browser
 * should open. (It is not unknown - the /apps knowledge describes it - which is the
 * other, better way for a gap to be answered.)
 *
 * This is a false-negative risk and is treated as one. A word wrongly listed here
 * suppresses a browser visit, which is the failure mode Phase 3's review was about.
 * Two things bound it: the verdict stays `partial`, so the prompt still tells the
 * agent those terms are unverified and it may still decline; and every dismissal is
 * recorded in the metrics with its reason, so a wrong one is visible afterwards
 * rather than invisible.
 */
const NON_INSPECTABLE = new Set([
  // Relations between things, not things.
  'above', 'below', 'beneath', 'beside', 'near', 'under', 'over', 'within', 'inside',
  'outside', 'upper', 'lower', 'front', 'behind', 'alongside', 'between', 'atop', 'onto',
  // Moments and order.
  'arrival', 'arrive', 'arrives', 'arriving', 'initial', 'initially', 'first', 'second',
  'third', 'final', 'finally', 'last', 'previously', 'already', 'still', 'immediately',
  'once', 'twice', 'afterwards', 'subsequently', 'meanwhile', 'during',
  // Manner and degree.
  'exactly', 'correctly', 'properly', 'cleanly', 'plainly', 'merely', 'simply', 'fully',
  'partially', 'roughly', 'briefly', 'directly', 'instead', 'rather', 'either', 'neither',
  // Generic states and outcomes - true of anything, so they name nothing to inspect.
  'accept', 'accepts', 'accepted', 'allow', 'allows', 'allowed', 'contain', 'contains',
  'containing', 'reads', 'become', 'becomes', 'remain', 'remains', 'stays', 'keeps',
  'gains', 'holds', 'marked', 'marks', 'marking', 'appears', 'appear', 'exists',
  // Vague quantities and parts.
  'fragment', 'portion', 'piece', 'several', 'various', 'multiple', 'many', 'more',
  'less', 'least', 'most', 'both',
]);

export type GapKind =
  /** A word describing a relation, moment, manner or generic state - nothing to look at. */
  | 'not-inspectable'
  /** Something a browser genuinely would have to be opened to find out. */
  | 'inspectable';

export interface GapDecision {
  term: string;
  kind: GapKind;
  reason: string;
}

export interface BrowserNeed {
  /** True when at least one gap could only be answered by looking at the application. */
  required: boolean;
  gaps: GapDecision[];
  /** Gaps that would have opened a browser before this was assessed. */
  dismissed: string[];
  inspectable: string[];
  reason: string;
}

/**
 * Does this row actually need a browser?
 *
 * Phase 4 opened one whenever the verdict was not `sufficient`, so a `partial`
 * verdict cost ~6.5 s of browser launch plus a sign-in even when every missing term
 * was a preposition. This is the deterministic second look the decision was missing:
 *
 *   sufficient                       -> no browser
 *   partial, every gap uninspectable -> no browser (the knowledge really is enough)
 *   partial, any gap inspectable     -> browser
 *   none                             -> browser
 *
 * It never *adds* a browser visit that Phase 4 would not have made, so the worst it
 * can do is withhold one - which is why the membership rule for NON_INSPECTABLE is
 * narrow and every decision is recorded.
 */
export function assessBrowserNeed(sufficiency: SufficiencyResult): BrowserNeed {
  if (sufficiency.verdict === 'none') {
    return {
      required: true, gaps: [], dismissed: [], inspectable: [],
      reason: 'no knowledge exists for this screen, so it has to be looked at',
    };
  }
  if (sufficiency.verdict === 'sufficient') {
    return {
      required: false, gaps: [], dismissed: [], inspectable: [],
      reason: 'every requirement is certainly covered by existing knowledge',
    };
  }

  const gaps: GapDecision[] = sufficiency.gaps.map(term => NON_INSPECTABLE.has(term)
    ? {
      term, kind: 'not-inspectable' as const,
      reason: `"${term}" describes a relation, a moment, a manner or a generic state - ` +
        'there is nothing on a screen it could name',
    }
    : {
      term, kind: 'inspectable' as const,
      reason: `"${term}" could name something on the screen and nothing accounts for it`,
    });

  const inspectable = gaps.filter(gap => gap.kind === 'inspectable').map(gap => gap.term);
  const dismissed = gaps.filter(gap => gap.kind === 'not-inspectable').map(gap => gap.term);

  if (inspectable.length) {
    return {
      required: true, gaps, dismissed, inspectable,
      reason: `${inspectable.length} gap(s) need looking at: ${inspectable.join(', ')}`,
    };
  }
  return {
    required: false, gaps, dismissed, inspectable,
    reason: `all ${dismissed.length} gap(s) are words that name nothing inspectable ` +
      `(${dismissed.join(', ')}), so the knowledge is enough`,
  };
}

/**
 * The old word-at-a-time decision, exposed for the Phase 5 fixture only.
 *
 * The before/after comparison has to run the REAL matcher over the REAL knowledge, or
 * the baseline is a guess. `terms()` is the old extractor and `decide()` is the old
 * judgement; together they are exactly what shipped before this phase.
 */
export function oldTermDecisionsForTest(
  testCase: TestCase, matches: KnowledgeMatch[], pageObjectMethods: string[] = [],
): MatchDecision[] {
  const text = [testCase.scenario, testCase.steps.join(' '), testCase.expectedResult]
      .filter(Boolean).join(' ');
  const haystacks = matches.map(match => haystacksFor(match.knowledge));
  const methodText = pageObjectMethods
      .map(name => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
      .join(' ')
      .toLowerCase();
  return terms(text).map(term => decide(term, haystacks, methodText));
}

/** Exported for the Phase 4B test: membership must be assertable directly. */
export function isInspectableTermForTest(term: string): boolean {
  return !NON_INSPECTABLE.has(term);
}

/** The audit trail, for the run log and the report. */
export function describeDecisions(result: SufficiencyResult): string {
  if (!result.decisions.length)
    return '';
  const lines: string[] = [];
  for (const decision of result.decisions) {
    const mark = decision.confidence === 'certain' ? 'ok  ' : decision.confidence === 'uncertain' ? 'UNSURE' : 'MISS';
    lines.push(`      ${mark} ${decision.requirement.padEnd(16)} ${decision.matchType.padEnd(19)} ${decision.reason}`);
  }
  return lines.join('\n');
}

/**
 * The knowledge as it goes into the prompt.
 *
 * The YAML verbatim - it is already the compact form, and re-rendering it would be
 * a second representation to keep honest.
 */
export function toPromptBlock(matches: KnowledgeMatch[], sufficiency: SufficiencyResult): string {
  if (!matches.length)
    return '';
  const lines = ['===== PAGE KNOWLEDGE (already explored - reuse it, do not rediscover it) ====='];
  for (const match of matches) {
    lines.push(`# ${match.knowledge.file}  (selected because: ${match.why})`);
    lines.push(match.knowledge.raw.trim());
    lines.push('');
  }

  if (sufficiency.verdict === 'sufficient') {
    lines.push(
        'This knowledge covers everything this row asks about, and it was read off the real',
        'application. **Do not open the browser.** Write the spec from the Page Object methods',
        'named above. If - and only if - you find something genuinely missing, open the browser,',
        'look at ONLY that, and say in a code comment what was missing.');
  } else {
    lines.push(
        'This knowledge is INCOMPLETE for this row. These are either absent from it or only',
        `hinted at, so treat them as unknown: ${sufficiency.gaps.join(', ')}.`,
        'Reuse everything above rather than rediscovering it, and open the browser to inspect ONLY',
        'the missing part. Do not re-explore the page, do not re-read what is already described here,',
        'and do not navigate anywhere this row does not need.',
        '',
        'Then ADD what you found to the knowledge file(s) above, or create one for the screen if the',
        'gap was a screen these do not describe. Do this whether you write a spec or decline the row -',
        'especially if you decline, because otherwise the next attempt pays for the same browser',
        'session again. What you learned about the application is true regardless of this test case.',
        'Semantics and Page Object methods only: no snapshot refs, no DOM dumps, keep it compact.');
  }
  return lines.join('\n');
}

/**
 * The instruction for a row with no knowledge at all.
 *
 * Kept separate from `toPromptBlock` because it is the one case where exploration
 * is the correct first move, and the agent is asked to leave the knowledge behind
 * so the next row does not pay for it again.
 */
export function explorationRequest(testCase: TestCase, suggestedFile: string): string {
  return [
    '===== PAGE KNOWLEDGE (none yet for this screen) =====',
    'Nothing has been recorded about this screen, so explore it once - only the part this row',
    'needs - and then leave the knowledge behind for the next row.',
    '',
    'Write down what you learn, in ALL cases - whether you end up writing a spec, or',
    'decline the row. **Especially if you decline.** A declined row is the expensive',
    'case: somebody has to read it, edit it and send it back, and if the exploration',
    'was thrown away the next attempt pays for the whole browser session again. The',
    'knowledge is about the application, and it is true regardless of what happened to',
    'this one test case.',
    '',
    `Write it to ${suggestedFile} in this shape:`,
    '',
    'page:',
    `  id: <short-kebab-id>`,
    '  name: <human name>',
    '  purpose: <one line>',
    '  route: <path>',
    'navigation:',
    '  entry_point: <how you get there>',
    '  authentication_required: <true|false>',
    'elements:',
    '  <element_id>:',
    '    description: <what it is>',
    '    role: <aria role>',
    '    accessible_name: <name>',
    '    page_object: <ClassName>',
    '    page_object_method: <method>',
    'actions:',
    '  - name: <action>',
    '    page_object: <ClassName>',
    '    method: <method>',
    'assertions:',
    '  - name: <what can be proven>',
    '    description: <how>',
    'states:',
    '  - name: <state>',
    '    description: <what is true in it>',
    'references:',
    '  accessibility_snapshot: <path under .playwright-mcp/ if you made one>',
    'metadata:',
    `  source: explored for ${testCase.testCaseId}`,
    '  last_verified: <YYYY-MM-DD>',
    '  knowledge_version: 1',
    '',
    'Rules for that file: semantic locators and Page Object methods ONLY - never snapshot refs',
    'like e17, never a copy of the DOM or the accessibility tree, never a copy of Page Object',
    'source. Keep it under ~60 lines. It is a map, not a recording.',
  ].join('\n');
}
