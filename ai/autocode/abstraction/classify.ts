/**
 * What kind of thing did the person touch?
 *
 *   npx tsx ai/autocode/abstraction-engine.fixture.ts
 *
 * Ten rules, evaluated in order, first match wins. Every one of them reads evidence
 * the recorder already captured; none of them asks a model, and none of them counts
 * how often a target appears.
 *
 * RECURRENCE IS DELIBERATELY NOT A RULE. A capability discovered once still deserves
 * a method - that is what Page Objects are for. What keeps this from proposing a
 * method for everything is not frequency but AUTHORED IDENTITY: rule 5 requires an
 * accessible name on an interactive element, and rule 7 sends anything identified
 * only by its own text back as data.
 *
 * That single distinction is the whole classifier. `Notification settings` has an
 * accessible name - authored chrome, the same string whatever data is on screen.
 * `Faclon labs` has none; its identity IS its text, and its text is a project name
 * somebody can rename. Measured, not guessed: both come straight from the captured
 * DomNode.
 */

import {
  analyseIdentifier, chainHasDynamicIdentifier, isPositionalLocator, parseChain, scoreExpression,
} from '../locator-quality';
import {
  isPositionProvenAgainstClickedTarget, looksLikeStateClass,
  positionalExpression, provesIdentity, type CandidateMeasurement, type DomNode,
  type TargetEvidence,
} from '../dom-evidence';
import type { Category, Classification, TargetRole } from './types';

/**
 * The recorder's own DOM, which is in the page but is not the application.
 *
 * The picker lives in a closed shadow root under `ba-aura-assert`; its veil and pill
 * still show up in evidence, and a corpus simulation duly offered `Assert: pick an
 * element` as a reusable capability. It is ours, so it is excluded by structure
 * rather than by name - filtering on the words would also exclude a real application
 * button that happened to say the same thing.
 */
const RECORDER_HOST = 'ba-aura-assert';
const RECORDER_CLASSES = ['veil', 'aura-veil', 'aura-pill', 'aura-card'];

/** Roles that make an element a region of the page rather than a control on it. */
const LANDMARK_ROLES = ['dialog', 'alertdialog', 'navigation', 'banner', 'complementary', 'region'];

/** Tags and roles a person can actually operate. */
const INTERACTIVE_TAGS = ['button', 'a', 'input', 'select', 'textarea', 'option', 'summary'];
const INTERACTIVE_ROLES = [
  'button', 'link', 'textbox', 'checkbox', 'radio', 'switch', 'combobox', 'listbox',
  'menuitem', 'menuitemcheckbox', 'tab', 'option', 'searchbox', 'spinbutton', 'slider',
];

/**
 * Tags that hold other things rather than being a thing.
 *
 * A container with an authored id passes rule 6 on the letter of it - `main-content`
 * did, in the corpus simulation - and produces a method that wraps the page's layout.
 * Whether a given container is a meaningful capability (`#all_apps`, the project
 * list) or scaffolding (`#main-content`) is not decidable from the DOM, so neither is
 * assumed: containers fall through to NEEDS_REVIEW and a person says which.
 */
const CONTAINER_TAGS = ['div', 'section', 'main', 'aside', 'header', 'footer', 'nav',
  'ul', 'ol', 'table', 'tbody', 'thead', 'tr', 'form', 'fieldset', 'span'];

/**
 * Containers that repeat: a member inside one is a row member, not a page member.
 *
 * `row` on its own is deliberately absent. It is Bootstrap's grid class and it is on
 * layout everywhere - including `#loginForm`, whose Sign In button was duly offered
 * as a row-scoped parameterised candidate. A repeated container has to be named as
 * one, or be a genuine list element by tag.
 */
const REPEATED_CONTAINER_CLASSES = ['tabulator-row', 'list-item', 'grid-row', 'table-row'];
const REPEATED_CONTAINER_TAGS = ['tr', 'li'];

const repeats = (node: DomNode): boolean =>
  REPEATED_CONTAINER_TAGS.includes(lower(node.tag))
  || (node.stableClasses ?? []).some(name => REPEATED_CONTAINER_CLASSES.includes(lower(name)));

const lower = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/** Is this element one a person operates, rather than one that holds others? */
export function isInteractive(node: DomNode): boolean {
  return INTERACTIVE_TAGS.includes(lower(node.tag))
    || INTERACTIVE_ROLES.includes(lower(node.role));
}

/** Is this the recorder's own overlay rather than the application? */
export function isRecorderOwned(evidence: TargetEvidence): boolean {
  const locator = evidence.locator ?? '';
  if (locator.includes(RECORDER_HOST))
    return true;
  const nodes: DomNode[] = [evidence.target, ...(evidence.ancestors ?? [])];
  return nodes.some(node => lower(node.tag) === RECORDER_HOST
    || (node.stableClasses ?? []).some(name => RECORDER_CLASSES.includes(lower(name))));
}

/**
 * Any generated identifier ANYWHERE in the recorded chain, not just on the target.
 *
 * Re-exported from `locator-quality`, which is where the rule now lives. This module
 * had its own copy and the two were not equivalent: this one scanned compound
 * selectors, that one required the whole argument to be an id - so the spec path
 * emitted `#tr_637446 > .cell > .ui` while this path refused it. One rule, one place.
 */
export { chainHasDynamicIdentifier } from '../locator-quality';

/**
 * The measurement that carries proof for a step of this ROLE, or null when there is
 * none.
 *
 * `role` defaults to `action`, which is the strictest answer and the one every caller
 * got before it existed: a press, in the press's document, at one element that is the
 * element acted on. An ASSERTION may also be proven at its PICK - see `provesIdentity`,
 * which is the one place that distinction is made.
 */
export function provenCandidate(
  evidence: TargetEvidence,
  role: TargetRole = 'action',
): CandidateMeasurement | null {
  return rankProvenCandidates(evidence, role)[0] ?? null;
}

/**
 * Every candidate that proves this target, BEST FIRST.
 *
 * WHAT CHANGED, AND WHAT DID NOT. The filter is `provesIdentity`, unchanged and
 * unweakened: press-time for an action, press-or-pick for an assertion, one element, the
 * press's own document, and that element is the one acted on. Nothing reaches this
 * ordering that would not have reached `.find()` before it. What changed is only which
 * of the survivors is returned.
 *
 * WHY ORDER WAS WORTH ANYTHING. `.find()` returned the first proven candidate in
 * GENERATION order, which is the order `candidateSelectorsFor` happens to emit shapes in
 * - test id, id, content, container, scoped classes, bare classes. That order is a
 * reasonable guess and it is not a judgement: measured on the sign-in button, nine
 * candidates were proven at the press and `.find()` returned
 * `#loginForm .login-submit` filtered by its own text, while
 * `getByRole('button', { name: 'Sign In', exact: true })` sat proven in the same list.
 * Both identify the button; only one of them still will after somebody renames a class.
 *
 * Ranked on the EXISTING model - `scoreExpression`, which is `assessLocator`'s own
 * scorer - so a locator is worth here exactly what it is worth everywhere else. The
 * WEAKEST segment is the rank, because a chain is only as strong as its weakest link
 * and that is already how `classify` reads one.
 *
 * TIES BREAK ON THE SIMPLER CHAIN, and the first attempt got this wrong in a way the
 * corpus caught. Breaking on the strongest segment instead put
 * `page.locator("#create_team_invite_form").getByText("Cancel")` (weakest 70, best 85)
 * above `page.locator("#create_team_cancel_btn")` (70, one segment) - so a chain earned
 * its place from a segment that is not the one holding it up, and TC_LOGIN_126/127 lost
 * the Page Object reuse they had. On a genuine tie the shorter chain is the better
 * default: scoping is already paid for inside the score, as the +10 a narrowing segment
 * receives. Then the shorter expression, then generation order, which is stable - so two
 * runs over one sidecar cannot disagree.
 *
 * An unscoreable expression sorts last rather than being dropped: it was proven against
 * the pressed element, and a scorer that cannot parse it is a fact about the scorer.
 *
 * A LOOSE TWIN NEVER OUTRANKS ITS EXACT ONE, and that rule exists because the length
 * tie-break would otherwise settle a question no measurement has answered.
 * `getByRole('textbox', { name: 'Password' })` and the same call with `exact: true`
 * score identically (95/95, one segment) and differ only in being twelve characters
 * apart, so the shorter-expression rule would silently promote the loose form for every
 * element on which both are proven - a global preference arrived at by counting
 * characters. Measured live, the two forms fail in OPPOSITE directions: Bugasura's
 * password field keeps its loose locator through a validation error that takes the exact
 * one to zero matches, while its Sign In button's loose locator matches two elements
 * (Google's sign-in button contains the name) where the exact one matches one. Neither
 * is generally better, so the added candidate takes the position an added candidate
 * should: immediately after the one that already existed, changing no selection that is
 * made today and answering only where the exact form is refused.
 */
/**
 * The name matched loosely - the same evidence as its exact twin, expressed as the wider
 * matcher. Named here rather than tested for `exact: true` in the expression, because a
 * strategy is what the generator decided and a substring of an expression is not.
 */
const LOOSE_STRATEGIES = new Set(['role-name-loose', 'scoped-role-name-loose']);

export function rankProvenCandidates(
  evidence: TargetEvidence,
  role: TargetRole = 'action',
): CandidateMeasurement[] {
  const proven = (evidence.derivedCandidates ?? [])
      .map((candidate, order) => ({ candidate, order }))
      .filter(entry => provesIdentity(entry.candidate, role));
  return proven
      .map(entry => {
        const scored = scoreExpression(entry.candidate.expression);
        return {
          ...entry,
          weakest: scored?.weakest ?? -1,
          best: scored?.best ?? -1,
          segments: parseChain(entry.candidate.expression).length,
          loose: LOOSE_STRATEGIES.has(String(entry.candidate.strategy)) ? 1 : 0,
        };
      })
      .sort((a, b) =>
        b.weakest - a.weakest
        || a.segments - b.segments
        || a.loose - b.loose
        || a.candidate.expression.length - b.candidate.expression.length
        || a.order - b.order)
      .map(entry => entry.candidate);
}

/** Is the element inside something that repeats? */
export function insideRepeatedContainer(evidence: TargetEvidence): boolean {
  return (evidence.ancestors ?? []).some(repeats);
}

/** A container: it holds things, and nothing says it is a control. */
export function isContainerElement(node: DomNode): boolean {
  if (isInteractive(node))
    return false;
  return CONTAINER_TAGS.includes(lower(node.tag));
}

/**
 * The locator this target would ACTUALLY be wrapped in.
 *
 * Codegen recorded `page.locator('[id="639978"]')` for a row checkbox - one issue's
 * generated id, useless as a method. The recorder also measured, at the press and
 * against the pressed element, a contextual alternative:
 *
 *   page.locator(".tabulator-row").filter({ hasText: "..." }).locator(".bugChecked")
 *
 * which names the row by its own text and the control by its role in that row. The
 * pipeline already prefers that expression when it emits a step, so classifying the
 * RECORDED string would refuse a target the framework has safely resolved - and
 * would do it on the grounds of an id nothing intends to use.
 *
 * This is not a relaxation of the dynamic-id rule. The alternative is taken only
 * when it is press-time proven AND itself free of generated identifiers; when it is
 * not, the recorded locator stands and rule 1 refuses exactly as before. A generated
 * id never becomes a locator either way - the question is only whether a proven
 * stable expression is allowed to answer for the element instead.
 */
export function effectiveLocator(
  evidence: TargetEvidence,
  /**
   * WHICH TIMING this target's proof may come from. `action` - the default and the
   * behaviour every existing caller had - demands a press. An `assertion` may also be
   * proven at its pick, which is when the person made the claim.
   */
  role: TargetRole = 'action',
): { expression: string; proven: boolean; positionProven?: boolean } {
  const candidate = provenCandidate(evidence, role);
  const expression = candidate?.expression ?? '';
  if (expression && !chainHasDynamicIdentifier(expression))
    return { expression, proven: true };

  // NO EXPRESSION IDENTIFIES IT ALONE - but the recorder may have measured WHICH of
  // several matches was pressed. `positionProven` is flagged separately from `proven`
  // on purpose: the two are different claims, and everything downstream that refuses
  // a positional locator must keep refusing one that carries no such measurement.
  const positioned = (evidence.positionProvenCandidates ?? [])
      .filter(isPositionProvenAgainstClickedTarget)
      .filter(entry => {
        const base = entry.expression ?? '';
        return Boolean(base) && !chainHasDynamicIdentifier(base) && !isPositionalLocator(base);
      });
  const byPosition = positioned.length ? positionalExpression(positioned[0]) : null;
  if (byPosition)
    return { expression: byPosition, proven: true, positionProven: true };

  return { expression: evidence.locator ?? '', proven: false };
}

/** Classes that describe a moment rather than a kind: `animated`, `active`, `in`. */
const stableOnly = (classes: readonly string[] | undefined): string[] =>
  (classes ?? []).filter(name => !looksLikeStateClass(name)).slice().sort();

/** The nearest ancestor that repeats, and is therefore a row rather than a page. */
export function containerOf(evidence: TargetEvidence): DomNode | null {
  return (evidence.ancestors ?? []).find(repeats) ?? null;
}

/**
 * What this target IS, structurally, with every trace of data removed.
 *
 * Two row checkboxes in different rows must produce the same signature or they can
 * never be seen as one method; two different controls in the same row must not. So
 * the signature carries the element's kind and its path from the container, and
 * carries no id, no text and no state class - those are exactly what varies between
 * rows, which is the thing being parameterised rather than matched.
 */
export function structuralSignature(evidence: TargetEvidence): string | null {
  const node = evidence.target;
  const container = containerOf(evidence);
  if (!container)
    return null;
  const member = [lower(node.tag), ...stableOnly(node.stableClasses)].join('.');
  const scope = [lower(container.tag), ...stableOnly(container.stableClasses)].join('.');
  if (!member || !scope)
    return null;
  // The path between them, so a checkbox in the checkbox cell and one somewhere else
  // in the same row are not confused for each other.
  const between = (evidence.ancestors ?? []);
  const depth = between.indexOf(container as never);
  const path = between.slice(0, depth < 0 ? 0 : depth)
      .map(step => [lower(step.tag), ...stableOnly(step.stableClasses)].join('.'))
      .join('>');
  return `${scope}|${path}|${member}`;
}

const decide = (category: Category, rule: number, reason: string): Classification =>
  ({ category, rule, reason });

/**
 * Classify one recorded target.
 *
 * The rules are ordered by what disqualifies rather than by what qualifies, so a
 * target that is unsafe for several reasons is reported by the FIRST one - which is
 * the one a reader needs, and keeps the reason stable as later rules change.
 */
export function classify(evidence: TargetEvidence, role: TargetRole = 'action'): Classification {
  const node = evidence.target ?? ({} as DomNode);

  // 0 - ours, not the application's.
  if (isRecorderOwned(evidence))
    return decide('RECORDER_OWNED', 0, 'the recorder\'s own overlay, not the application');

  // 1 - a generated id names one row of data, not one element.
  //
  // Judged on the EFFECTIVE locator, so a target whose recorded locator was a
  // generated id but which the recorder also measured a proven, stable contextual
  // expression for is judged on the expression that would actually be emitted. The
  // id is still never a locator; it is simply not the only thing on offer.
  const effective = effectiveLocator(evidence, role);
  if (!effective.proven) {
    if (evidence.identifier?.dynamic === true)
      return decide('DYNAMIC', 1, `"${evidence.identifier.raw}" is a generated identifier`);
    if (chainHasDynamicIdentifier(evidence.locator))
      return decide('DYNAMIC', 1, 'the recorded chain is scoped by a generated identifier');
  }

  // 2 - a count of one is not the same as "this is the element they touched".
  const proof = provenCandidate(evidence, role);
  if (evidence.matchCount !== 1 && !proof) {
    return decide('NOT_UNIQUE', 2,
        `the browser measured ${evidence.matchCount ?? 'no'} element(s) and nothing proves identity`);
  }
  if (!proof) {
    return decide('NOT_UNIQUE', 2,
        'no candidate was measured at the press against the element that was pressed');
  }

  // 3 - a graph taken after the action describes a page that had already moved on.
  if (evidence.captureTiming !== 'before-action' && !proof) {
    return decide('BAD_TIMING', 3,
        `evidence was captured ${evidence.captureTiming ?? 'at an unknown time'} with no press-time proof`);
  }

  // 4 - a region of the page belongs to a component, not to a screen.
  if (LANDMARK_ROLES.includes(lower(node.role)))
    return decide('COMPONENT', 4, `role "${node.role}" makes this a region, not a control`);

  // 5 - THE RULE THAT MATTERS. An authored name on something operable.
  if ((node.accessibleName ?? '').trim() && isInteractive(node)) {
    return decide('METHOD', 5,
        `authored accessible name "${node.accessibleName}" on an interactive ${node.role || node.tag}`);
  }

  // 6 - an authored id, as long as it names a control and not the furniture.
  if ((node.id ?? '').trim() && !analyseIdentifier(node.id ?? '').dynamic) {
    if (isContainerElement(node)) {
      return decide('UNCLASSIFIED', 6,
          `"${node.id}" is an authored id on a container - whether it is a capability or layout `
          + 'is not decidable from the DOM');
    }
    return decide('METHOD', 6, `authored, non-dynamic id "${node.id}"`);
  }

  // 7 - identified by its own text: that is a value, not an element.
  if ((node.text ?? '').trim() && !(node.accessibleName ?? '').trim() && !(node.id ?? '').trim())
    return decide('TEST_DATA', 7, 'identified only by its own text, which is data rather than identity');

  // 8 - structural, and inside something that repeats.
  if ((node.stableClasses ?? []).length && insideRepeatedContainer(evidence))
    return decide('COMPONENT_MEMBER', 8, 'structural classes inside a repeated container');

  // 9 - nothing decided it.
  return decide('UNCLASSIFIED', 9, 'no rule identified this target');
}
