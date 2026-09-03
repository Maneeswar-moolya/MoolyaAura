/**
 * What a proposed method would be called.
 *
 * `methodNameFor` in locator-quality.ts already turns a target name into camelCase
 * and is reused verbatim - a second implementation is how two parts of one pipeline
 * come to disagree about what an element is called. What is added here is only what
 * that function cannot know: the element's ROLE, and whether the name it produced
 * already means something else on the owning class.
 *
 * There is no `name2`. A collision that cannot be proven equivalent is NEEDS_REVIEW,
 * because `notificationSettings2()` is not a name - it is a record of the framework
 * having been unable to decide, written into the code where nobody will read it.
 */

import { methodNameFor } from '../locator-quality';
import type { DomNode } from '../dom-evidence';
import type { TargetRole } from './types';

/** Roles whose name reads better with the noun attached: `saveButton`, `emailField`. */
const ROLE_SUFFIX: Record<string, string> = {
  button: 'Button',
  link: 'Link',
  textbox: 'Field',
  input: 'Field',
  checkbox: 'Checkbox',
  radio: 'Radio',
  switch: 'Toggle',
  dialog: 'Dialog',
};

/**
 * The bare camelCase name, before any collision handling.
 *
 * Preference order is the order of confidence in what the element IS: the accessible
 * name is what the application renders and what a person would say; an authored id is
 * the developer's own word for it; a `data-testid` is a name written for testing.
 * Text is deliberately last and only used when nothing else exists - text is usually
 * content, and content is data.
 */
export function baseNameFor(node: DomNode): string | null {
  const source = (node.accessibleName ?? '').trim()
    || (node.data?.testid ?? node.data?.['test-id'] ?? '').trim()
    || (node.id ?? '').trim()
    || (node.placeholder ?? '').trim();
  if (!source)
    return null;
  return methodNameFor(source);
}

/** `notificationSettings` + role button -> `notificationSettingsButton`. */
export function withRoleSuffix(name: string, node: DomNode): string {
  const role = (node.role || node.tag || '').toLowerCase();
  const suffix = ROLE_SUFFIX[role] ?? (role === 'a' ? 'Link' : '');
  if (!suffix || name.toLowerCase().endsWith(suffix.toLowerCase()))
    return name;
  return name + suffix;
}

/**
 * The assertion counterpart of an action method.
 *
 * A distinct NAME, never a flag on the same method. `issueCheckbox(d).click()` and
 * `expect(issueCheckboxState(d)).toBeChecked()` address different elements, and a
 * boolean parameter would let a call site ask for the wrong one and still compile.
 */
export function stateNameFor(name: string): string {
  return name.endsWith('State') ? name : `${name}State`;
}

/**
 * The name a proposal would use, or null when none can be derived.
 *
 * Deterministic: the same node and role always produce the same name, which is what
 * makes the fingerprint in `propose.ts` stable across runs.
 */
export function methodNameForTarget(
  node: DomNode,
  role: TargetRole,
  options: { needsRoleSuffix?: boolean } = {},
): string | null {
  const base = baseNameFor(node);
  if (!base)
    return null;
  const named = options.needsRoleSuffix ? withRoleSuffix(base, node) : base;
  return role === 'assertion' ? stateNameFor(named) : named;
}

/** `NotificationsPanel` from an overlay's id, for a component that does not exist yet. */
export function componentClassNameFor(node: DomNode): string | null {
  const source = (node.accessibleName ?? '').trim() || (node.id ?? '').trim();
  const camel = source ? methodNameFor(source) : null;
  if (!camel)
    return null;
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * The noun a Page Object stands for: `IssuesPage` -> `issue`.
 *
 * A parameterised method is named for what it addresses, and the owning class has
 * already said what that is. Deriving it from the class rather than from the data is
 * the whole point - `issueCheckbox(description)` reads the same whichever issue is
 * passed, while a name built from the value would be `line Chart Getting Flat Line`.
 */
export function ownerNoun(owner: string): string | null {
  const stem = owner.replace(/(Page|Panel|Component)$/, '');
  if (!stem)
    return null;
  const singular = stem.endsWith('ies') ? `${stem.slice(0, -3)}y`
    : stem.endsWith('ses') ? stem.slice(0, -2)
      : stem.endsWith('s') ? stem.slice(0, -1) : stem;
  return singular.charAt(0).toLowerCase() + singular.slice(1);
}

/**
 * What KIND of control this is, from a closed vocabulary.
 *
 * Read from what the element states about itself - an input's `type`, then its role,
 * then the words in its authored classes - and never from its text. `rounded-checkbox-ui`
 * yields `Checkbox` because the word is in the class; a class that says nothing
 * recognisable yields null and the group goes to review rather than being named
 * after markup.
 */
const MEMBER_NOUNS = ['checkbox', 'radio', 'button', 'link', 'summary', 'title', 'status',
  'badge', 'toggle', 'switch', 'icon', 'label', 'menu', 'tab', 'cell', 'row', 'field', 'input'];

export function memberNoun(node: DomNode): string | null {
  const type = (node.type ?? '').toLowerCase();
  if (type === 'checkbox')
    return 'Checkbox';
  if (type === 'radio')
    return 'Radio';
  const role = (node.role ?? '').toLowerCase();
  if (MEMBER_NOUNS.includes(role))
    return role.charAt(0).toUpperCase() + role.slice(1);
  const words = (node.stableClasses ?? [])
      .flatMap(name => name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/))
      .map(word => word.toLowerCase());
  const found = MEMBER_NOUNS.find(noun => words.includes(noun));
  return found ? found.charAt(0).toUpperCase() + found.slice(1) : null;
}

/**
 * `IssuesPage` + a row checkbox + action -> `issueCheckbox`; assertion -> `issueCheckboxState`.
 *
 * Null when either half cannot be derived, which sends the group to review. A name
 * is never assembled from the recorded VALUE: `issue639978` and `faclonLabs` are the
 * two failures this function exists to make impossible.
 */
export function parameterisedNameFor(
  owner: string,
  member: DomNode,
  role: TargetRole,
): string | null {
  const noun = ownerNoun(owner);
  const kind = memberNoun(member);
  if (!noun || !kind)
    return null;
  const name = `${noun}${kind}`;
  return role === 'assertion' ? stateNameFor(name) : name;
}
