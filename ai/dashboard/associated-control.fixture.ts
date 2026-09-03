/**
 * P1.2b — interaction target vs assertion subject.
 *
 *   npx tsx ai/dashboard/associated-control.fixture.ts
 *
 * Offline: no browser, no model, no network. The in-page half is exercised by
 * running the GENERATED picker string against a stub DOM, the same way
 * `clicked-target.fixture.ts` runs the generated capture hook - reading the
 * source proves nothing about what reaches the page.
 *
 * The shape under test is Bugasura's notification toggle, which is what the
 * whole change is for:
 *
 *   span.ba-switch
 *     input.ba-switch__input[type=checkbox]   0x0, carries `checked`
 *     span.ba-switch__track
 *       span.ba-switch__thumb                 what a person sees and clicks
 *
 * The two claims that matter most are F and G: the SUBJECT moves to the
 * checkbox, and the element the person actually pointed at does not.
 */

import { ASSERTION_PICKER } from './assertion-picker-source';
import { classify } from './assertion-capabilities';
import { resolveAssertionSubject, type AssociationCandidate } from './associated-control';
import { pickerModel, recordPickedAssertion } from './live-recorder';
import type { RecordedAssertion } from './recorder';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* ------------------------------------------------------------- a stub DOM */

/**
 * Enough DOM to run the real candidate walk against.
 *
 * Deliberately small, like the one in `clicked-target.fixture.ts`: it exists to
 * let the walk be tested, not to reimplement a browser. Everything the picker
 * touches is here and nothing else is.
 */
interface Options {
  id?: string;
  classes?: string[];
  text?: string;
  attrs?: Record<string, string>;
  checked?: boolean;
  disabled?: boolean;
  /** Zero-sized, the way a visually-hidden switch input is. */
  invisible?: boolean;
}

class El {
  tagName: string;
  id: string;
  classList: string[];
  own: string;
  attrs: Record<string, string>;
  children: El[] = [];
  parentElement: El | null = null;
  checked?: boolean;
  disabled?: boolean;
  invisible: boolean;

  constructor(tag: string, options: Options = {}) {
    this.tagName = tag.toUpperCase();
    this.id = options.id ?? '';
    this.classList = options.classes ?? [];
    this.own = options.text ?? '';
    this.attrs = { ...(options.attrs ?? {}) };
    if (options.id)
      this.attrs.id = options.id;
    if (options.checked !== undefined)
      this.checked = options.checked;
    if (options.disabled !== undefined)
      this.disabled = options.disabled;
    this.invisible = options.invisible ?? false;
  }

  add(...children: El[]): El {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }

  get attributes(): Array<{ name: string; value: string }> {
    const list = Object.entries(this.attrs).map(([name, value]) => ({ name, value }));
    if (this.classList.length)
      list.push({ name: 'class', value: this.classList.join(' ') });
    return list;
  }

  get textContent(): string {
    return [this.own, ...this.children.map(child => child.textContent)]
        .join(' ').replace(/\s+/g, ' ').trim();
  }

  get title(): string {
    return this.attrs.title ?? '';
  }

  /** `HTMLInputElement.labels` - the labels pointing at this control. */
  get labels(): El[] {
    const root = this.root();
    return root.descendants().filter(node => node.tagName === 'LABEL'
      && (node.attrs.for === this.id || (this.id !== '' && node.contains(this))));
  }

  /** `HTMLLabelElement.control` - the control this label labels. */
  get control(): El | null {
    if (this.tagName !== 'LABEL')
      return null;
    if (this.attrs.for)
      return this.root().descendants().find(node => node.id === this.attrs.for) ?? null;
    return this.descendants().find(node => LABELABLE.has(node.tagName)) ?? null;
  }

  getAttribute(name: string): string | null {
    if (name === 'class')
      return this.classList.join(' ') || null;
    return this.attrs[name] ?? null;
  }

  root(): El {
    let walk: El = this;
    while (walk.parentElement)
      walk = walk.parentElement;
    return walk;
  }

  descendants(): El[] {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }

  contains(other: El): boolean {
    return this.descendants().includes(other);
  }

  closest(selector: string): El | null {
    for (let walk: El | null = this; walk; walk = walk.parentElement) {
      if (walk.matches(selector))
        return walk;
    }
    return null;
  }

  matches(selector: string): boolean {
    // tag, .class, #id and one [attr=value] - all the walk ever asks for.
    const attribute = selector.match(/\[([a-z-]+)=([^\]]+)\]/i);
    const bare = selector.replace(/\[[^\]]*\]/g, '');
    if (attribute && this.getAttribute(attribute[1]) !== attribute[2])
      return false;
    if (!bare)
      return true;
    if (bare.startsWith('#'))
      return this.id === bare.slice(1);
    if (bare.startsWith('.'))
      return this.classList.includes(bare.slice(1));
    return this.tagName === bare.toUpperCase();
  }

  querySelectorAll(selector: string): El[] {
    const wanted = selector.split(',').map(part => part.trim()).filter(Boolean);
    return this.descendants().filter(node => wanted.some(part => node.matches(part)));
  }

  querySelector(selector: string): El | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getBoundingClientRect(): { width: number; height: number } {
    const size = this.invisible ? 0 : 20;
    return { width: size, height: size };
  }

  // The picker installs listeners; nothing in this fixture fires one.
  addEventListener(): void {}
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  attachShadow(): { innerHTML: string; querySelector: () => El; appendChild: () => void;
    addEventListener: () => void; } {
    const stub = new El('div');
    return { innerHTML: '', querySelector: () => stub, appendChild: () => {},
      addEventListener: () => {} };
  }
  get style(): Record<string, string> {
    return {};
  }
  get isConnected(): boolean {
    return true;
  }
  appendChild(): void {}
}

const LABELABLE = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);

/**
 * Run the REAL picker script against a stub document and hand back its own
 * read-only helpers, so the walk under test is the one that ships.
 */
function pickerIn(root: El): {
  describe: (element: El) => any;
  liveState: (element: El) => any;
  associatedCandidates: (element: El) => AssociationCandidate[];
} {
  const document: any = {
    createElement: (tag: string) => new El(tag),
    getElementById: (id: string) => root.descendants().find(node => node.id === id) ?? null,
    addEventListener: () => {},
    body: root,
    documentElement: root,
  };
  const window: any = {
    getComputedStyle: (element: El) => ({
      display: element.invisible ? 'block' : 'block',
      visibility: 'visible',
      opacity: '1',
    }),
    // The picker places and re-clamps its floating panel, so it needs a viewport
    // and something to listen on. Every real window has both; this stub had
    // neither, which is a gap in the stub rather than in the picker.
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  window.window = window;
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', ASSERTION_PICKER)(window, document);
  return window.__auraPicker;
}

/** What the page sends across the binding for a given element. */
function payloadFor(root: El, selector: string): {
  node: any; state: any; candidates: AssociationCandidate[];
} {
  const picker = pickerIn(root);
  const element = selector === ':root' ? root : root.querySelector(selector);
  if (!element)
    throw new Error(`fixture selector matched nothing: ${selector}`);
  return {
    node: picker.describe(element),
    state: picker.liveState(element),
    candidates: picker.associatedCandidates(element),
  };
}

/* --------------------------------------------------------------- the shapes */

/** Bugasura's notification toggle, as the evidence file records it. */
function bugasuraSwitch(): El {
  const input = new El('input', {
    id: 'notif_master', classes: ['ba-switch__input', 'js-notif-master'],
    attrs: { type: 'checkbox' }, checked: false, invisible: true,
  });
  const thumb = new El('span', { classes: ['ba-switch__thumb'] });
  const track = new El('span', { classes: ['ba-switch__track'] }).add(thumb);
  const wrapper = new El('span', { classes: ['ba-switch', 'ap-notif-settings-switch'] })
      .add(input, track);
  const label = new El('label', { attrs: { for: 'notif_master' }, text: 'Enable Notifications' });
  return new El('div', { id: 'ap_notifications_panel' }).add(wrapper, label);
}

/**
 * The same toggle as Bugasura actually serves it - verified against the live
 * application, and different from the shape above in the one way that mattered.
 *
 * The thumb is inside a <label>, so the subject resolves by `label-ancestor`
 * (priority 2) rather than by the wrapper (priority 4). It is still a switch.
 * Resolving the relationship and naming the control are two questions, and
 * answering the second with the first offered "Checked/Unchecked" for a toggle
 * on the real page.
 */
function bugasuraLabelledSwitch(): El {
  const input = new El('input', {
    classes: ['ba-switch__input', 'js-notif-setting', 'js-notif-master'],
    attrs: { type: 'checkbox' }, checked: true, invisible: true,
  });
  const thumb = new El('span', { classes: ['ba-switch__thumb'] });
  const track = new El('span', { classes: ['ba-switch__track'] }).add(thumb);
  const wrapper = new El('span', { classes: ['ba-switch', 'ap-notif-settings-switch'] })
      .add(input, track);
  const label = new El('label', { text: 'Enable Notifications' }).add(wrapper);
  return new El('div', { id: 'ap_notifications_panel' }).add(label);
}

/* ----------------------------------------------------- A-C: what associates */

function checkAssociation(): void {
  process.stdout.write('\n== A-C — what associates ==\n');

  // ---- A: a native checkbox is its own subject
  const terms = new El('input', { id: 'terms', attrs: { type: 'checkbox' }, checked: false });
  const nativeRoot = new El('div').add(new El('label', { text: 'Accept Terms' }).add(terms));
  const native = payloadFor(nativeRoot, '#terms');
  check('A: a native checkbox classifies as a checkbox',
      classify(native.node).semantics === 'checkbox', classify(native.node).reason);
  check('A: and nothing is resolved for it - it IS the control',
      resolveAssertionSubject(native.node, native.candidates) === null);
  const nativeModel = pickerModel(native);
  check('A: it offers Checked and Unchecked',
      ['checked', 'unchecked'].every(id => nativeModel.capabilities.some(c => c.id === id)),
      nativeModel.capabilities.map(c => c.id).join(', '));
  check('A: and reads as currently unchecked from the live page',
      nativeModel.state.find(entry => entry.label === 'Checked')?.value === false,
      JSON.stringify(nativeModel.state));

  // ---- B: a native radio, same
  const yes = new El('input', { id: 'yes', attrs: { type: 'radio', name: 'q' }, checked: true });
  const radioRoot = new El('div').add(new El('label', { text: 'Yes' }).add(yes));
  const radio = payloadFor(radioRoot, '#yes');
  check('B: a native radio classifies as a radio',
      classify(radio.node).semantics === 'radio', classify(radio.node).reason);
  check('B: and is its own subject',
      resolveAssertionSubject(radio.node, radio.candidates) === null);

  // ---- B: clicking the label resolves TO the control
  const labelPayload = payloadFor(radioRoot, 'label');
  const fromLabel = resolveAssertionSubject(labelPayload.node, labelPayload.candidates);
  check('B: clicking the <label> resolves to the control it labels',
      fromLabel?.node.id === 'yes' && fromLabel.relationship === 'label-control',
      JSON.stringify({ id: fromLabel?.node.id, via: fromLabel?.relationship }));
  check('B: and it is spoken about as the radio it is, not promoted to a switch',
      fromLabel?.semantics === 'radio');

  // ---- C: the switch wrapper
  const thumb = payloadFor(bugasuraSwitch(), '.ba-switch__thumb');
  check('C: the thumb itself proves nothing - it is a bare span',
      classify(thumb.node).semantics === 'generic', classify(thumb.node).reason);
  const subject = resolveAssertionSubject(thumb.node, thumb.candidates);
  check('C: the wrapper resolves to the checkbox it contains',
      subject?.node.id === 'notif_master',
      JSON.stringify({ id: subject?.node.id, relationship: subject?.relationship }));
  check('C: reached as a switch wrapper', subject?.relationship === 'switch-wrapper');
  check('C: and spoken about as a switch, not a tick box',
      subject?.semantics === 'switch', subject?.reason);
  check('C: the reason names the structure it was proved by',
      /contains exactly one/.test(subject?.reason ?? ''), subject?.reason);
  check('C: the walk reaches it from two levels up without unbounded climbing',
      thumb.candidates.filter(entry => entry.relationship === 'switch-wrapper').length === 1,
      JSON.stringify(thumb.candidates.map(entry => entry.relationship)));

  // ---- C: the shape the live application actually serves
  const live = payloadFor(bugasuraLabelledSwitch(), '.ba-switch__thumb');
  check('C: the real markup reaches the control by BOTH routes',
      live.candidates.some(entry => entry.relationship === 'label-ancestor')
      && live.candidates.some(entry => entry.relationship === 'switch-wrapper'),
      JSON.stringify(live.candidates.map(entry => entry.relationship)));
  const resolvedLive = resolveAssertionSubject(live.node, live.candidates);
  check('C: the stronger relationship - the label - is what resolves it',
      resolvedLive?.relationship === 'label-ancestor', resolvedLive?.relationship);
  check('C: and it is STILL called a switch, because the wrapper says so',
      resolvedLive?.semantics === 'switch', `${resolvedLive?.semantics}: ${resolvedLive?.reason}`);
  check('C: the reason names both halves',
      /label/.test(resolvedLive?.reason ?? '') && /ba-switch/.test(resolvedLive?.reason ?? ''),
      resolvedLive?.reason);
  const liveModel = pickerModel(live);
  check('C: so the person is offered ON and OFF, not Checked and Unchecked',
      liveModel.capabilities.some(c => c.id === 'on')
      && !liveModel.capabilities.some(c => c.id === 'checked'),
      liveModel.capabilities.map(c => c.label).join(', '));
  check('C: and it reads as currently ON, which is what the input said',
      liveModel.state.find(entry => entry.label === 'ON')?.value === true,
      JSON.stringify(liveModel.state));

  // The same markup with the switch wrapper renamed: the label still resolves
  // the control, and it is now a plain checkbox. One variable, two answers.
  const plainWrapper = bugasuraLabelledSwitch();
  const inner = plainWrapper.querySelector('.ba-switch')!;
  inner.classList = ['ap-notif-settings-widget'];
  const plain = payloadFor(plainWrapper, '.ba-switch__thumb');
  const resolvedPlain = resolveAssertionSubject(plain.node, plain.candidates);
  check('C: rename the wrapper and the same control is a checkbox again',
      resolvedPlain?.relationship === 'label-ancestor' && resolvedPlain.semantics === 'checkbox',
      `${resolvedPlain?.relationship}/${resolvedPlain?.semantics}`);
}

/* ------------------------------------------ D-E: what deliberately does not */

function checkRefusals(): void {
  process.stdout.write('\n== D-E — what is refused ==\n');

  // ---- D: an unrelated sibling control is NOT adopted
  const unrelated = new El('div', { classes: ['row'] }).add(
      new El('span', { id: 'deco', classes: ['thumb'] }),
      new El('input', { id: 'unrelated', attrs: { type: 'checkbox' } }));
  const deco = payloadFor(unrelated, '#deco');
  const adopted = resolveAssertionSubject(deco.node, deco.candidates);
  check('D: a plain wrapper that merely contains a checkbox proves nothing',
      adopted === null, JSON.stringify(adopted?.node?.id ?? null));
  check("D: the page still offered it - the refusal is the resolver's",
      deco.candidates.some(entry => entry.relationship === 'switch-wrapper'),
      JSON.stringify(deco.candidates.map(entry => entry.relationship)));

  // ---- D: two controls in the wrapper is ambiguous, so nothing is chosen
  const twoControls = new El('span', { classes: ['ba-switch'] }).add(
      new El('span', { id: 't', classes: ['ba-switch__thumb'] }),
      new El('input', { id: 'a', attrs: { type: 'checkbox' } }),
      new El('input', { id: 'b', attrs: { type: 'checkbox' } }));
  const two = payloadFor(twoControls, '#t');
  check('D: a wrapper holding two checkable controls resolves to neither',
      resolveAssertionSubject(two.node, two.candidates) === null);

  // ---- E: a generic span gets generic semantics and no state assertions
  const plainRoot = new El('div').add(new El('span', { id: 'plain', text: 'Just some text' }));
  const generic = payloadFor(plainRoot, '#plain');
  check('E: a generic span resolves to no subject',
      resolveAssertionSubject(generic.node, generic.candidates) === null);
  const genericModel = pickerModel(generic);
  check('E: and is offered no checkedness at all',
      !genericModel.capabilities.some(c => ['checked', 'unchecked', 'on', 'off'].includes(c.id)),
      genericModel.capabilities.map(c => c.id).join(', '));

  // ---- E: class names alone never make a switch
  const classOnly = new El('div', { classes: ['switch', 'toggle', 'active', 'on'] })
      .add(new El('span', { id: 'lone', text: 'x' }));
  const lone = payloadFor(classOnly, '#lone');
  check('E: class="switch toggle active on" with no control inside proves nothing',
      resolveAssertionSubject(lone.node, lone.candidates) === null);

  // ---- E: a wrapper with a control but no marker is refused, and the SAME
  // structure with a marker is taken. One variable, two answers.
  const marked = new El('span', { classes: ['ba-switch'] }).add(
      new El('input', { id: 'in', attrs: { type: 'checkbox' } }),
      new El('span', { id: 'th' }));
  const unmarked = new El('span', { classes: ['ba-widget'] }).add(
      new El('input', { id: 'in', attrs: { type: 'checkbox' } }),
      new El('span', { id: 'th' }));
  const markedPayload = payloadFor(marked, '#th');
  const unmarkedPayload = payloadFor(unmarked, '#th');
  check('E: the marker is what decides it - same structure, marked',
      resolveAssertionSubject(markedPayload.node, markedPayload.candidates)?.node.id === 'in');
  check('E: the marker is what decides it - same structure, unmarked',
      resolveAssertionSubject(unmarkedPayload.node, unmarkedPayload.candidates) === null);

  // ---- E: role="switch" on the wrapper works without any class at all
  const byRole = new El('span', { attrs: { role: 'switch' } }).add(
      new El('input', { id: 'r', attrs: { type: 'checkbox' } }),
      new El('span', { id: 'knob' }));
  const roled = payloadFor(byRole, '#knob');
  check('E: role="switch" on the wrapper is enough on its own',
      resolveAssertionSubject(roled.node, roled.candidates)?.semantics === 'switch');

  // ---- aria-controls is taken only where the controlled element says what it is
  const vague: AssociationCandidate[] = [{ relationship: 'aria-controls', node: { tag: 'div' } as any }];
  check('E: aria-controls pointing at a role-less element is refused',
      resolveAssertionSubject({ tag: 'button' } as any, vague) === null);
  const explicit: AssociationCandidate[] = [
    { relationship: 'aria-controls', node: { tag: 'div', role: 'switch' } as any }];
  check('E: aria-controls pointing at role="switch" is taken',
      resolveAssertionSubject({ tag: 'button' } as any, explicit)?.semantics === 'switch');

  // ---- nothing outside checkbox/radio/switch is ever associated
  const textboxCandidate: AssociationCandidate[] = [
    { relationship: 'label-control', node: { tag: 'input', type: 'text' } as any }];
  check('E: a label pointing at a text box resolves nothing - only three controls qualify',
      resolveAssertionSubject({ tag: 'span' } as any, textboxCandidate) === null);
}

/* ------------------------------- F-I: the offer, the record, and the identity */

function checkRecording(): void {
  process.stdout.write('\n== F-I — what is offered and what is recorded ==\n');
  const thumb = payloadFor(bugasuraSwitch(), '.ba-switch__thumb');
  const model = pickerModel(thumb);

  check("G: the card is headed with the control's name, not <span>",
      model.description === 'Enable Notifications', model.description);
  check('G: it says why it resolved, naming the wrapper',
      /ba-switch/.test(model.note ?? ''), model.note ?? '(no note)');
  check('G: the semantics shown are switch', model.semantics === 'switch');
  check('G: ON, OFF, Enabled, Disabled, Visible and Hidden are all offered',
      ['on', 'off', 'enabled', 'disabled', 'visible', 'hidden']
          .every(id => model.capabilities.some(c => c.id === id)),
      model.capabilities.map(c => c.id).join(', '));
  check('G: and nothing else is - no Has Text, no Has Class on a switch',
      model.capabilities.length === 6, model.capabilities.map(c => c.label).join(', '));
  check('G: the current state reads ON rather than Checked',
      model.state.some(entry => entry.label === 'ON')
      && !model.state.some(entry => entry.label === 'Checked'),
      model.state.map(entry => `${entry.label}=${String(entry.value)}`).join(' '));
  check('G: ON reads false, which is what the input actually said',
      model.state.find(entry => entry.label === 'ON')?.value === false,
      JSON.stringify(model.state));
  check('G: Visible reads TRUE - from the thumb, not from the 0x0 input',
      model.state.find(entry => entry.label === 'Visible')?.value === true,
      JSON.stringify(model.state));

  const record = (capabilityId: string): RecordedAssertion | null => {
    const into: RecordedAssertion[] = [];
    const result = recordPickedAssertion({ ...thumb, capabilityId }, into, 'nowhere.spec.ts');
    return result.recorded ? into[0] : null;
  };

  const on = record('on');
  check('H: ON records checked = true',
      on?.type === 'checked' && on.expected === true, JSON.stringify(on));
  const off = record('off');
  check('I: OFF records checked = false',
      off?.type === 'checked' && off.expected === false, JSON.stringify(off));

  check('G: the assertion subject is the associated checkbox',
      on?.locator === 'page.locator("#notif_master")', on?.locator);
  check('G: named for the person, from its own label',
      on?.target === 'Enable Notifications', on?.target);

  check('F: the element the person pointed at is recorded alongside it',
      typeof on?.interactionTarget === 'string'
      && on.interactionTarget.includes('ba-switch__thumb'), on?.interactionTarget);
  check('F: and it is not the checkbox', on?.interactionTarget !== on?.locator);

  // Visibility is the one assertion that stays with what a person can see: the
  // subject is 0x0 by design, so toBeVisible() against it would be a red test
  // about a control the application hides on purpose.
  const visible = record('visible');
  check('F: Visible is asserted against the element that IS visible',
      Boolean(visible?.locator.includes('ba-switch__thumb')), visible?.locator);
  check('F: so it carries no separate interaction target',
      visible?.interactionTarget === undefined);

  // ---- an offer that was never made cannot be recorded
  const bogus: RecordedAssertion[] = [];
  const refused = recordPickedAssertion({ ...thumb, capabilityId: 'text' }, bogus, 'nowhere.spec.ts');
  check('F: a capability the card did not offer is refused',
      refused.recorded === false && bogus.length === 0, JSON.stringify(refused));

  // ---- and none of this changed how the picker treats the page
  // Bounded by the next declaration after the walk. `const place =` used to be it;
  // when that was replaced by the floating-panel placement the slice silently
  // became "the rest of the script", which is how a scoped check stops being one.
  const walkEnd = ASSERTION_PICKER.indexOf('// ---- floating-panel placement');
  const walk = ASSERTION_PICKER.slice(
      ASSERTION_PICKER.indexOf('const associatedCandidates'), walkEnd);
  check('F: the slice under test is the walk itself, not the whole script',
      walkEnd > 0 && walk.length > 200 && walk.length < 3500, `${walk.length} chars`);
  check('F: the association walk only reads - it writes nothing to the page',
      !/setAttribute|removeAttribute|innerHTML\s*=|classList\.(add|remove|toggle)|\.checked\s*=(?!=)/
          .test(walk));
  check('F: it is bounded rather than climbing to the document',
      /depth < 3/.test(walk) && !/while \(walk\)/.test(walk));
  check('F: more than one control in a wrapper stops the walk instead of choosing',
      /controls\.length > 1\) break/.test(walk));
}

function main(): void {
  checkAssociation();
  checkRefusals();
  checkRecording();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
