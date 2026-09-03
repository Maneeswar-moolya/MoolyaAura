/**
 * Which assertions are meaningful for this element, and what is known about it.
 *
 * ONE TABLE, TWO QUESTIONS, KEPT APART
 *
 *   capability    "can this element meaningfully be asserted this way?"
 *   current state "what is true about it right now?"
 *
 * They are different questions and answering the first with the second is the
 * mistake this file exists to prevent. A Submit button that is enabled right now
 * must still offer BOTH `Enabled` and `Disabled`: the whole point of recording
 * "assert disabled" is to write it down before the thing becomes enabled. So
 * capability never consults state, and state is reported separately - with
 * `unknown` as a real answer rather than a guess.
 *
 * WHAT IT READS
 *
 * Only the DOM evidence this project already captures for every recorded
 * target: tag, type, role, aria-*, and classes. Nothing here opens a browser,
 * touches the page, or asks a model. It is a pure function of a captured node,
 * which is what makes it testable and what will let the picker (2B) and the
 * generator agree without a second implementation.
 *
 * WHAT IT REFUSES
 *
 * Semantics are proven, never inferred. `class="switch"` proves nothing;
 * `role="switch"` proves it. `class="disabled"` proves nothing; `aria-disabled`
 * or a native disabled control proves it. An element whose semantics cannot be
 * established gets the conservative set - visible, hidden, text, attribute,
 * class - which are true of any element in any document.
 */

import type { DomNode } from '../autocode/dom-evidence';
import type { RecordedAssertion } from './recorder';

/** What the recorder writes down when a person picks this capability. */
export interface CapabilityAssertion {
  type: RecordedAssertion['type'];
  expected: boolean;
}

export interface AssertionCapability {
  /** Stable identifier. The UI never invents its own. */
  id: string;
  /** What a person reads. `ON`/`OFF` for a switch, never `checked: true`. */
  label: string;
  /** The structured assertion recording this capability produces. */
  assertion: CapabilityAssertion;
  /**
   * This capability needs something from the person before it can be recorded:
   * the text to expect, the attribute name, the class, the value.
   */
  needs?: 'text' | 'value' | 'values' | 'attribute' | 'class';
}

/** What the DOM proves this element IS. Never guessed from class names. */
export type ElementSemantics =
  | 'button' | 'checkbox' | 'radio' | 'switch' | 'textbox' | 'select' | 'generic';

/**
 * `true`/`false` where the evidence proves it, `undefined` where it does not.
 *
 * `undefined` is the common answer today and must stay visible as one: the
 * capture records `aria-*` but not the native `disabled` and `checked`
 * PROPERTIES, so an ordinary `<button>` has no provable enabled-ness. Reporting
 * "Enabled" because nothing said otherwise would be a claim about a page nobody
 * looked at.
 */
export interface CurrentState {
  visible?: boolean;
  enabled?: boolean;
  checked?: boolean;
  /** Names of the states that could not be established, for the UI to show. */
  unknown: Array<'visible' | 'enabled' | 'checked'>;
}

export interface AssertionTarget {
  semantics: ElementSemantics;
  /** Why it was classified that way, so a wrong answer can be argued with. */
  reason: string;
  capabilities: AssertionCapability[];
  currentState: CurrentState;
}

/* ----------------------------------------------------------- the vocabulary */

export const VISIBILITY_CAPABILITY_IDS = ['visible', 'hidden'] as const;

const VISIBILITY: AssertionCapability[] = [
  { id: 'visible', label: 'Visible', assertion: { type: 'visible', expected: true } },
  { id: 'hidden', label: 'Hidden', assertion: { type: 'visible', expected: false } },
];

const DESCRIPTIVE: AssertionCapability[] = [
  { id: 'text', label: 'Has Text', assertion: { type: 'contains', expected: true }, needs: 'text' },
  { id: 'attribute', label: 'Has Attribute', assertion: { type: 'attribute', expected: true }, needs: 'attribute' },
  { id: 'class', label: 'Has Class', assertion: { type: 'class', expected: true }, needs: 'class' },
];

const ENABLEMENT: AssertionCapability[] = [
  { id: 'enabled', label: 'Enabled', assertion: { type: 'enabled', expected: true } },
  { id: 'disabled', label: 'Disabled', assertion: { type: 'enabled', expected: false } },
];

const CHECKEDNESS: AssertionCapability[] = [
  { id: 'checked', label: 'Checked', assertion: { type: 'checked', expected: true } },
  { id: 'unchecked', label: 'Unchecked', assertion: { type: 'checked', expected: false } },
];

/** A switch says ON/OFF to a person and `checked` to Playwright. */
const SWITCHED: AssertionCapability[] = [
  { id: 'on', label: 'ON', assertion: { type: 'checked', expected: true } },
  { id: 'off', label: 'OFF', assertion: { type: 'checked', expected: false } },
];

const HAS_VALUE: AssertionCapability[] = [
  { id: 'value', label: 'Has Value', assertion: { type: 'value', expected: true }, needs: 'value' },
];

/* ------------------------------------------------------------ classification */

const TEXTUAL_INPUT_TYPES = new Set([
  '', 'text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'time',
  'datetime-local', 'month', 'week',
]);

const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);

/** Roles the ARIA spec gives a checked state. Playwright's own list, and short. */
const CHECKED_ROLES = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);

function lower(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * What this element IS, from the DOM alone.
 *
 * Order matters: the explicit `role` wins over the tag, because an author who
 * writes `role="switch"` on a checkbox has said which control it is. A class
 * name is never consulted - `class="toggle"` is a stylist's word, not a
 * semantic one, and a test built on it asserts the stylesheet.
 */
export function classify(node: DomNode): { semantics: ElementSemantics; reason: string } {
  const tag = lower(node.tag);
  const type = lower(node.type);
  const role = lower(node.role);
  const aria = node.aria ?? {};
  const hasAriaChecked = typeof aria['aria-checked'] === 'string';

  if (role === 'switch')
    return { semantics: 'switch', reason: 'role="switch"' };
  // A native checkbox carrying aria-checked is how most switch widgets are
  // built. The role is absent, but the state is explicit, which is the proof
  // this needs - and it is the ONLY other way a switch is recognised.
  if (tag === 'input' && type === 'checkbox' && hasAriaChecked)
    return { semantics: 'switch', reason: 'input[type=checkbox] with an explicit aria-checked' };
  if (role === 'checkbox' || role === 'menuitemcheckbox')
    return { semantics: 'checkbox', reason: `role="${role}"` };
  if (role === 'radio' || role === 'menuitemradio')
    return { semantics: 'radio', reason: `role="${role}"` };
  if (tag === 'input' && type === 'checkbox')
    return { semantics: 'checkbox', reason: 'input[type=checkbox]' };
  if (tag === 'input' && type === 'radio')
    return { semantics: 'radio', reason: 'input[type=radio]' };
  if (tag === 'select')
    return { semantics: 'select', reason: '<select>' };
  if (role === 'listbox' || role === 'combobox')
    return { semantics: 'select', reason: `role="${role}"` };
  if (tag === 'button' || role === 'button')
    return { semantics: 'button', reason: tag === 'button' ? '<button>' : 'role="button"' };
  if (tag === 'input' && BUTTON_INPUT_TYPES.has(type))
    return { semantics: 'button', reason: `input[type=${type}]` };
  if (tag === 'textarea')
    return { semantics: 'textbox', reason: '<textarea>' };
  if (tag === 'input' && TEXTUAL_INPUT_TYPES.has(type))
    return { semantics: 'textbox', reason: type ? `input[type=${type}]` : '<input>' };
  if (role === 'textbox' || role === 'searchbox')
    return { semantics: 'textbox', reason: `role="${role}"` };
  return {
    semantics: 'generic',
    reason: `<${tag || 'unknown'}> carries no state semantics, so only what is true of any element is offered`,
  };
}

/**
 * What is provably true right now.
 *
 * Deliberately narrow. `aria-checked` and `aria-disabled` are explicit claims
 * the application makes about itself and are believed; everything else is
 * `unknown`, because the evidence contract records attributes and roles, not
 * the live `disabled`/`checked` properties. Reporting `unknown` is what lets
 * the picker say so instead of inventing a reassuring "Enabled".
 */
export function currentStateOf(node: DomNode): CurrentState {
  const aria = node.aria ?? {};
  const state: CurrentState = { unknown: [] };

  const ariaChecked = lower(aria['aria-checked']);
  const role = lower(node.role);
  const tag = lower(node.tag);
  const type = lower(node.type);
  const checkable = CHECKED_ROLES.has(role)
    || (tag === 'input' && (type === 'checkbox' || type === 'radio'));
  if (ariaChecked === 'true' || ariaChecked === 'false')
    state.checked = ariaChecked === 'true';
  else if (checkable)
    state.unknown.push('checked');

  const ariaDisabled = lower(aria['aria-disabled']);
  if (ariaDisabled === 'true' || ariaDisabled === 'false')
    state.enabled = ariaDisabled !== 'true';
  else
    state.unknown.push('enabled');

  // Visibility is a rendered fact, not an attribute. The graph knows whether the
  // element was in the viewport when it was captured, but that is a different
  // claim from "visible", so nothing is asserted here.
  state.unknown.push('visible');
  return state;
}

/**
 * Every assertion that is meaningful for this element. Never consults state.
 *
 * The lists are additive and conservative: each semantic adds what its own DOM
 * contract supports on top of the universal set. Nothing is offered that
 * Playwright cannot express deterministically, which is why `Selected` is
 * absent - there is no `toBeSelected()`, and an `<option>`'s `selected`
 * attribute describes the initial state rather than the current one.
 */
export function getAssertionCapabilities(node: DomNode): AssertionCapability[] {
  return capabilitiesForSemantics(classify(node).semantics);
}

/**
 * The same table, addressed by semantics rather than by node.
 *
 * Split out for the associated-control resolver (P1.2b): when the person points
 * at a switch's thumb, the SUBJECT is the checkbox inside the wrapper and it is
 * asserted as a switch - so the capability list has to be reachable without a
 * node to classify. Nothing about the lists changed.
 */
export function capabilitiesForSemantics(semantics: ElementSemantics): AssertionCapability[] {
  switch (semantics) {
    case 'button':
      return [...ENABLEMENT, ...VISIBILITY, ...DESCRIPTIVE];
    case 'checkbox':
    case 'radio':
      return [...CHECKEDNESS, ...ENABLEMENT, ...VISIBILITY,
        ...DESCRIPTIVE.filter(capability => capability.id !== 'text')];
    case 'switch':
      return [...SWITCHED, ...ENABLEMENT, ...VISIBILITY];
    case 'textbox':
      return [...ENABLEMENT, ...VISIBILITY, ...HAS_VALUE,
        ...DESCRIPTIVE.filter(capability => capability.id !== 'text')];
    case 'select':
      // Single-value only. `toHaveValues` exists for a multiple select, but
      // `multiple` is not in the evidence contract, so offering it would be a
      // claim about markup nobody captured.
      return [...ENABLEMENT, ...VISIBILITY, ...HAS_VALUE];
    default:
      return [...VISIBILITY, ...DESCRIPTIVE];
  }
}

/** Everything the picker needs about one target, in one call. */
export function describeAssertionTarget(node: DomNode): AssertionTarget {
  const { semantics, reason } = classify(node);
  return {
    semantics,
    reason,
    capabilities: getAssertionCapabilities(node),
    currentState: currentStateOf(node),
  };
}

/**
 * The structured assertion a chosen capability produces.
 *
 * The one place a capability becomes a `RecordedAssertion`, so the picker
 * cannot invent a shape the generator does not understand.
 */
export function assertionFor(
  capability: AssertionCapability,
  target: { target: string; locator: string; locatorStrategy: string },
  input?: { value?: string | null; name?: string; values?: string[] },
): RecordedAssertion {
  return {
    type: capability.assertion.type,
    expected: capability.assertion.expected,
    target: target.target,
    locator: target.locator,
    locatorStrategy: target.locatorStrategy,
    value: input?.value ?? null,
    ...(input?.name ? { name: input.name } : {}),
    ...(input?.values ? { values: input.values } : {}),
  };
}
