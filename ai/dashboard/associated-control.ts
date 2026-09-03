/**
 * The element a person can point at is not always the element that holds the state.
 *
 * INTERACTION TARGET vs ASSERTION SUBJECT
 *
 *   interaction target   the exact DOM node the person selected. Never changed,
 *                        never substituted, and still what P0.7 records for the
 *                        click. This file does not touch it.
 *   assertion subject    the associated semantic control whose state is actually
 *                        being asserted.
 *
 * They are the same element almost always, and that is the default. They come
 * apart on custom controls, where the visible thing is a decorated `<span>` and
 * the state lives on an input the pointer cannot reach. Bugasura's notification
 * toggle is the case that motivated this:
 *
 *   span.ba-switch                     <- the wrapper
 *     input.ba-switch__input           <- 0x0, carries `checked`
 *     span.ba-switch__track
 *       span.ba-switch__thumb          <- what a person sees and clicks
 *
 * Pointing at the thumb used to yield semantics `generic` - visible, hidden,
 * text, attribute, class - because a bare `<span>` proves nothing. The
 * checkedness was on a sibling with zero width and zero height, which no click
 * can ever land on. So the one assertion worth recording about a toggle was the
 * one assertion the picker could not offer.
 *
 * WHAT MAKES THIS SAFE
 *
 * The page proposes, this file disposes. The page walks only relationships that
 * the DOM states explicitly - a label's control, a `for`/`id` pair, a wrapper
 * that contains exactly one checkable input - and describes each candidate
 * exactly as it describes any other element. It applies no semantics of its own.
 * Here, a candidate is accepted only when:
 *
 *   - the relationship is one of the five named below, in that priority order;
 *   - the candidate classifies as `checkbox`, `radio` or `switch` - the only
 *     three controls whose associated state is well defined. Anything else falls
 *     back to the existing capability rules for the clicked element itself;
 *   - and for a wrapper, the structure proves containment AND the wrapper says
 *     what kind of control it is.
 *
 * That last conjunction is the whole guard against the obvious failure mode.
 * A `<div>` that happens to contain one checkbox is not a switch, and neither
 * the class name nor the containment alone is allowed to make it one:
 *
 *   <div><span class="thumb"/><input type="checkbox"></div>   refused - no marker
 *   <div class="switch"><span/></div>                         refused - no control
 *   <span class="ba-switch"><input type="checkbox"/><span/></span>   accepted
 *
 * `active`, `on`, `off`, `selected` and `checked` are never consulted as class
 * names anywhere. A stylesheet is not a specification.
 */

import { classify, type ElementSemantics } from './assertion-capabilities';
import type { DomNode } from '../autocode/dom-evidence';


/**
 * How a candidate was reached. Closed set, in priority order - a relationship
 * not on this list is not a relationship this will act on.
 */
export type AssociationRelationship =
  | 'label-control'
  | 'label-ancestor'
  | 'for-id'
  | 'switch-wrapper'
  | 'aria-controls';

export const ASSOCIATION_PRIORITY: AssociationRelationship[] = [
  'label-control', 'label-ancestor', 'for-id', 'switch-wrapper', 'aria-controls',
];

/** What the page reads off an element right now. Display and state only. */
export interface LiveState {
  visible?: boolean;
  enabled?: boolean;
  checked?: boolean;
}

/** The element the relationship was proved THROUGH - the label, the wrapper. */
export interface AssociationVia {
  tag?: string;
  role?: string;
  stableClasses?: string[];
  /** Checkable inputs the wrapper contains. Only 1 is ever acted on. */
  controlCount?: number;
}

export interface AssociationCandidate {
  relationship: AssociationRelationship;
  node: DomNode;
  state?: LiveState;
  via?: AssociationVia | null;
}

export interface ResolvedSubject {
  node: DomNode;
  state?: LiveState;
  relationship: AssociationRelationship;
  /** What the subject is asserted AS. `switch` says ON/OFF; the state is `checked`. */
  semantics: ElementSemantics;
  /** Why, in words, so a wrong answer can be argued with rather than guessed at. */
  reason: string;
}

/** The three controls whose associated state is well defined. Nothing else. */
const ASSOCIABLE: ReadonlySet<ElementSemantics> = new Set<ElementSemantics>([
  'checkbox', 'radio', 'switch',
]);

/**
 * A class token that names a switch widget.
 *
 * Only ever consulted for a wrapper that has ALREADY been proved to contain
 * exactly one checkable input, and only to choose between saying `ON/OFF` and
 * saying `Checked/Unchecked` about that input. It can never create a control
 * that is not there. Matches `switch`, `ba-switch`, `switch__track`,
 * `toggle-wrap`; does not match `switched`, `switchboard`.
 */
const SWITCH_TOKEN = /(^|[-_])(switch|toggle)([-_]|$)/;

function hasSwitchToken(classes: string[] | undefined): boolean {
  return (classes ?? []).some(name => SWITCH_TOKEN.test(name.trim().toLowerCase()));
}

/**
 * Is this wrapper a well-defined custom-control wrapper?
 *
 * Two independent things must both be true: the structure proves it holds
 * exactly one checkable control, and the wrapper says which control it is.
 * Either one alone is a guess.
 */
function wrapperIsRecognisable(via: AssociationVia | null | undefined): { ok: boolean; marker: string } {
  if (!via || via.controlCount !== 1)
    return { ok: false, marker: 'the wrapper does not contain exactly one checkable control' };
  if ((via.role ?? '').trim().toLowerCase() === 'switch')
    return { ok: true, marker: 'role="switch"' };
  if (hasSwitchToken(via.stableClasses))
    return { ok: true, marker: `<${via.tag ?? 'element'} class="${(via.stableClasses ?? []).join(' ')}">` };
  return { ok: false, marker: 'the wrapper names no control kind, so containment alone proves nothing' };
}

/**
 * The control whose state the person means, or `null` for "the one they clicked".
 *
 * `null` is the ordinary answer and the safe one: it leaves the existing
 * capability rules in charge of the clicked element, exactly as before.
 */
export function resolveAssertionSubject(
  target: DomNode,
  candidates: AssociationCandidate[] | undefined,
): ResolvedSubject | null {
  // The person pointed at the control itself. Nothing to resolve, and resolving
  // anyway is how a radio in a group would acquire its neighbour's state.
  if (ASSOCIABLE.has(classify(target).semantics))
    return null;
  if (!candidates?.length)
    return null;

  for (const relationship of ASSOCIATION_PRIORITY) {
    for (const candidate of candidates) {
      if (candidate.relationship !== relationship || !candidate.node)
        continue;
      const { semantics, reason } = classify(candidate.node);
      if (!ASSOCIABLE.has(semantics))
        continue;

      if (relationship === 'aria-controls') {
        // Rule 5 is the loosest relationship in the DOM, so it is taken only
        // where the controlled element states its own semantics outright.
        if (!(candidate.node.role ?? '').trim())
          continue;
        return { node: candidate.node, state: candidate.state, relationship, semantics,
          reason: `aria-controls names an element with role="${candidate.node.role}"` };
      }

      if (relationship === 'switch-wrapper' && !wrapperIsRecognisable(candidate.via).ok)
        continue;

      // WHICH element, and WHAT TO CALL IT, are two questions.
      //
      // The priority order answers the first: a <label> is a stronger statement
      // of association than containment, so it wins. It says nothing about the
      // second. Bugasura's toggle is a checkbox inside a label inside a
      // span.ba-switch - resolved by the label, and still a switch, because the
      // wrapper says so. Answering both with the priority order offered
      // "Checked/Unchecked" for a control whose whole vocabulary is ON and OFF.
      const wrapper = switchWrapperFor(candidate.node, candidates);
      const spoken: ElementSemantics =
        semantics === 'checkbox' && wrapper ? 'switch' : semantics;
      const because = relationship === 'switch-wrapper'
        ? `${wrapperIsRecognisable(candidate.via).marker} contains exactly one ${reason}`
        : `${LABEL_REASON[relationship]} resolves to ${reason}`;
      const spokenBecause = spoken === semantics || relationship === 'switch-wrapper'
        ? because
        : `${because}, inside ${wrapper}`;
      return { node: candidate.node, state: candidate.state, relationship,
        semantics: spoken, reason: spokenBecause };
    }
  }
  return null;
}

/**
 * Is this control held by a wrapper that calls itself a switch?
 *
 * Read from the candidate list rather than walked for: the page already reported
 * the wrapper relationship if there was one, and this only asks whether the SAME
 * control was also reached that way. Returns the marker for the reason line, or
 * `null` - and `null` simply means the control keeps its own semantics.
 */
function switchWrapperFor(
  subject: DomNode, candidates: AssociationCandidate[],
): string | null {
  for (const candidate of candidates) {
    if (candidate.relationship !== 'switch-wrapper' || !sameElement(candidate.node, subject))
      continue;
    const { ok, marker } = wrapperIsRecognisable(candidate.via);
    if (ok)
      return marker;
  }
  return null;
}

/**
 * Two descriptions of what is probably one element.
 *
 * The page describes each candidate separately, so identity is gone by the time
 * it arrives; an id settles it, and otherwise the tag and the full class list
 * have to agree. Deliberately strict - a false match here would speak about one
 * control using another one's wrapper.
 */
export function sameElement(a: DomNode, b: DomNode): boolean {
  if (a.id || b.id)
    return Boolean(a.id) && a.id === b.id;
  if ((a.tag ?? '') !== (b.tag ?? ''))
    return false;
  const left = (a.stableClasses ?? []).join(' ');
  const right = (b.stableClasses ?? []).join(' ');
  return left !== '' && left === right;
}

const LABEL_REASON: Record<string, string> = {
  'label-control': 'the <label> that was clicked',
  'label-ancestor': 'the <label> the clicked element sits inside',
  'for-id': 'an explicit for/id pair',
};
