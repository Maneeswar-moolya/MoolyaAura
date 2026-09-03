/**
 * The in-page assertion picker, as a STRING.
 *
 * Not a function literal, for the same reason `dom-capture-source.ts` is not:
 * tsx/esbuild rewrites function literals to add a `__name` helper that does not
 * exist inside the page, and the first such script died with
 * `ReferenceError: __name is not defined`. A string crosses the boundary exactly
 * as written.
 *
 * WHAT THIS IS FOR
 *
 * While a person records, they can say what they EXPECT - "Submit is disabled
 * here", "the box is not ticked yet" - instead of that intent being reconstructed
 * afterwards by a model reading their clicks. The assertion is captured at the
 * moment they mean it, from the element they point at.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It knows no semantics. It does not decide that a `role="switch"` may be
 * asserted ON, or that a `<div>` may not be asserted Checked - those rules live
 * in `assertion-capabilities.ts`, in Node, and the page asks for them across the
 * binding. Two copies of that table would be two answers to one question.
 *
 * It also never touches the application:
 *
 *   - no attribute is written on any application element, ever;
 *   - nothing is clicked, filled, checked, focused or dispatched;
 *   - `preventDefault` is called on exactly one thing - clicks that land on the
 *     recorder's own overlay while assert mode is on, which are not application
 *     interactions;
 *   - the UI is `position: fixed` inside a shadow root, so no application layout
 *     is reflowed and no application style can be inherited into it.
 *
 * WHY THE OVERLAY EXISTS, AND WHY IT IS THE HONEST DESIGN
 *
 * While assert mode is ON, a full-viewport transparent layer takes the pointer.
 * That is what stops a selection click from reaching the application - the app
 * never sees it, so no state changes and nothing is recorded against it. Playwright's
 * recorder still records a click, but against the OVERLAY, which is namespaced
 * `ba-aura-assert` and dropped by `parseRecording`. The alternative - letting the
 * click through and calling `preventDefault` - would leave the recorder writing
 * an action the person never meant to perform.
 *
 * WHY THE SHADOW ROOT IS CLOSED
 *
 * Because that sentence above was not true while it was open, and P1.2d is what
 * that cost. Playwright's selector generator PIERCES an open shadow root: it
 * names the innermost element and never mentions the host, so the pill recorded
 * as `getByText('Assert')`, the veil as `locator('div').nth(1)`, and a capability
 * row as `getByRole('button', { name: 'ON' })`. `isRecorderOwnAction` tests the
 * generated locator for this namespace and found none of them, so every picker
 * interaction was kept as an application action - and TC_LOGIN_076 was refused
 * because one of them could not be resolved to a unique element.
 *
 * Closed, the generator cannot look inside. A click anywhere in this UI retargets
 * to the host at the document level and is recorded as
 * `page.locator('ba-aura-assert').click()` - which the existing filter already
 * recognises, unchanged. Measured both ways against a live recorder.
 *
 * Filtering by NAME instead was considered and is unsafe: the same measurement
 * showed a real application button labelled OFF recording as
 * `getByRole('button', { name: 'OFF' })` - byte-identical to the picker's own OFF
 * row. Dropping by name would silently delete a real interaction. Only the
 * structure separates them, so the structure is what is used.
 *
 * Nothing outside this file reads `host.shadowRoot`; every internal reference is
 * the closure's `shadow`, which `attachShadow` returns whatever the mode.
 */

/** The custom element name everything recorder-owned lives inside. */
export const PICKER_NAMESPACE = 'ba-aura-assert';

/**
 * Where the pill sits, as an inset from the viewport's bottom-right corner.
 *
 * It used to be `right: 16, bottom: 16`, which put it exactly on top of
 * Bugasura's Freshchat launcher - measured at 70x75 with a 15px inset, i.e.
 * occupying everything from 15 to 90 in both axes. The pill won the stacking
 * contest (z-index 2147483647 against the widget's 2147483600) and stayed
 * clickable, so nothing failed; it simply rendered on top of a chat bubble,
 * which is the worst place on the page to put a control nobody has been told
 * about. P1.2 found that a recording had been made with the picker installed,
 * working, and never noticed.
 *
 * 120 rather than the 90 first suggested: the launcher's top edge IS at 90, so
 * 90 would sit flush against it with no clearance at all, and the widget grows
 * upward when it is opened. `RESERVED_AREAS` pads that to 110 and the fixture
 * checks the pill's whole rectangle against it at three viewport sizes - which
 * is what rejected 104, a number that looked fine and left the pill's bottom
 * edge 6px inside the padding. These numbers are checked, not trusted.
 */
export const PILL_ANCHOR = { right: 24, bottom: 120 };

/**
 * The largest the pill ever gets. It is anchored bottom-right and grows left,
 * because its label changes to "Assert: pick an element" while it is armed.
 */
export const PILL_MAX = { width: 220, height: 40 };

/**
 * Viewport regions the pill must not cover, and the reason each one is here.
 *
 * Expressed as insets so they hold at any window size. This is the "intentionally
 * configured excluded areas" list: add to it when a screen turns out to reserve
 * a corner, rather than nudging the pill and hoping.
 */
export const RESERVED_AREAS: Array<{
  name: string; edge: 'bottom-right' | 'top'; width: number; height: number;
}> = [
  // Freshchat, measured on my.bugasura.io at 70x75 inset 15,15 - so it reaches
  // 90 from each edge. 110 keeps a margin for its opened state.
  { name: 'chat launcher', edge: 'bottom-right', width: 110, height: 110 },
  // Application navigation runs across the top of every Bugasura screen.
  { name: 'main navigation', edge: 'top', width: 0, height: 80 },
];

/**
 * How much of the panel must stay on screen, in CSS pixels.
 *
 * A floating tool may be dragged half off an edge - that is how people park one -
 * but never so far that it cannot be grabbed again. The top edge is held at 0
 * because the header IS the drag handle: push it above the fold and the panel
 * becomes unreachable without a reload.
 */
export const PANEL_MIN_VISIBLE = 56;

/** Where a panel of this size sits when nobody has moved it. */
export function defaultPanelRect(
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  let rect = {
    left: viewport.width - PILL_ANCHOR.right - size.width,
    top: viewport.height - PILL_ANCHOR.bottom - size.height,
    width: size.width, height: size.height,
  };
  // Step out of anything the application has already claimed. Above it when there
  // is room - a floating tool belongs over content, not over a launcher - and
  // below it when there is not.
  for (const area of RESERVED_AREAS) {
    const reserved = reservedRect(area, viewport);
    const box = { left: rect.left, top: rect.top,
      right: rect.left + rect.width, bottom: rect.top + rect.height };
    if (!overlaps(box, reserved))
      continue;
    const above = reserved.top - size.height - 8;
    rect = { ...rect, top: above >= 0 ? above : reserved.bottom + 8 };
  }
  return clampToViewport(rect, viewport);
}

/**
 * Keep a rectangle grabbable inside the viewport.
 *
 * Not the same as keeping it wholly inside: a panel pushed against the right edge
 * should stay there, showing its left portion. What must never happen is that all
 * of it leaves, or that the header goes above the top.
 */
export function clampToViewport(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  minVisible: number = PANEL_MIN_VISIBLE,
): { left: number; top: number; width: number; height: number } {
  const visible = Math.min(minVisible, rect.width);
  const left = Math.min(Math.max(rect.left, visible - rect.width), viewport.width - visible);
  const top = Math.min(Math.max(rect.top, 0), Math.max(0, viewport.height - Math.min(minVisible, rect.height)));
  return { left, top, width: rect.width, height: rect.height };
}

/** The pill's rectangle in a viewport of this size, at its largest. */
export function pillRect(viewport: { width: number; height: number }): {
  left: number; top: number; right: number; bottom: number;
} {
  const right = viewport.width - PILL_ANCHOR.right;
  const bottom = viewport.height - PILL_ANCHOR.bottom;
  return { left: right - PILL_MAX.width, top: bottom - PILL_MAX.height, right, bottom };
}

/** The reserved area's rectangle in a viewport of this size. */
export function reservedRect(
  area: (typeof RESERVED_AREAS)[number], viewport: { width: number; height: number },
): { left: number; top: number; right: number; bottom: number } {
  if (area.edge === 'top')
    return { left: 0, top: 0, right: viewport.width, bottom: area.height };
  return {
    left: viewport.width - area.width, top: viewport.height - area.height,
    right: viewport.width, bottom: viewport.height,
  };
}

/** Do two rectangles share any area? Touching edges do not count as overlap. */
export function overlaps(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export const ASSERTION_PICKER = `(() => {
  if (window.__auraPicker) return;
  const NS = '${PICKER_NAMESPACE}';
  const host = document.createElement(NS);
  host.setAttribute('data-aura-recorder-ui', 'true');
  // Fixed, above everything, and inert until asked for: an overlay that took the
  // pointer by default would break the recording it exists to serve.
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = [
    '<style>',
    ':host { all: initial; }',
    // The veil sits UNDER the picker's own controls. It covers the application so a
    // selection click cannot reach it; it was never meant to cover the tool, and
    // while it did the pill could not be pressed to cancel.
    '.pill { position: fixed; right: ${PILL_ANCHOR.right}px; bottom: ${PILL_ANCHOR.bottom}px; pointer-events: auto;',
    '  touch-action: none; user-select: none; z-index: 2;',
    '  font: 600 12px/1.4 system-ui, sans-serif; padding: 8px 12px; border-radius: 999px;',
    '  background: #1f2937; color: #fff; cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,.35); }',
    '.pill[data-on="true"] { background: #b45309; }',
    '.veil { position: fixed; inset: 0; pointer-events: auto; background: transparent; cursor: crosshair; z-index: 1; }',
    '.ring { position: fixed; border: 2px solid #f59e0b; border-radius: 3px; pointer-events: none;',
    '  box-shadow: 0 0 0 2px rgba(245,158,11,.25); transition: none; }',
    '.card { position: fixed; pointer-events: auto; width: 272px; max-height: 72vh; z-index: 3;',
    '  display: flex; flex-direction: column;',
    '  background: #111827; color: #e5e7eb; border-radius: 10px;',
    '  font: 12px/1.5 system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.5); }',
    '.card h4 { margin: 0 0 2px; font-size: 12px; color: #fff; }',
    '.body { padding: 10px 12px 12px; overflow: auto; }',
    // The header is the drag handle, and ONLY the header: making the whole panel
    // draggable turns every attempt to press an assertion into a small drag.
    '.hd { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 10px;',
    '  border-bottom: 1px solid #1f2937; cursor: grab; touch-action: none; user-select: none;',
    '  border-radius: 10px 10px 0 0; background: #0b1220; }',
    '.hd:active { cursor: grabbing; }',
    '.hd .grip { color: #6b7280; letter-spacing: 1px; font-size: 13px; }',
    '.hd .ttl { font-weight: 700; color: #fff; flex: 1; }',
    '.hd .drag-hint { color: #6b7280; font-size: 10px; }',
    '.muted { color: #9ca3af; }',
    '.row { display: block; width: 100%; text-align: left; margin: 3px 0; padding: 6px 8px;',
    '  background: #1f2937; color: #e5e7eb; border: 0; border-radius: 6px; cursor: pointer; font: inherit; }',
    '.row:hover { background: #374151; }',
    '.state { margin: 6px 0; }',
    '.state span { display: inline-block; margin-right: 8px; }',
    'input { width: 100%; box-sizing: border-box; margin: 4px 0; padding: 5px 6px; font: inherit;',
    '  background: #0b1220; color: #e5e7eb; border: 1px solid #374151; border-radius: 5px; }',
    '.close { background: none; border: 0; color: #9ca3af; cursor: pointer; font: 16px/1 system-ui;',
    '  padding: 2px 6px; border-radius: 5px; }',
    '.close:hover, .close:focus-visible { background: #1f2937; color: #fff; outline: none; }',
    // Not colour alone: the pressed state also changes the label and the border.
    '.row:focus-visible { outline: 2px solid #f59e0b; outline-offset: 1px; }',
    '.pill:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }',
    '</style>',
    '<div class="pill" data-on="false">Assert</div>',
  ].join('');
  // An init script runs BEFORE the document exists: on a page that has not yet
  // been parsed, document.documentElement is null and appending threw
  // "Cannot read properties of null (reading 'appendChild')", which took the
  // whole picker with it. Attach as soon as there is something to attach to -
  // by event, never by timer.
  const attach = () => {
    const root = document.body || document.documentElement;
    if (root && !host.isConnected) root.appendChild(host);
  };
  if (document.body || document.documentElement) attach();
  else document.addEventListener('DOMContentLoaded', attach, { once: true });

  const pill = shadow.querySelector('.pill');
  let veil = null;
  let ring = null;
  let card = null;
  let hovered = null;

  const ours = node => {
    for (let walk = node; walk; walk = walk.parentNode || walk.host)
      if (walk === host) return true;
    return false;
  };

  /** The topmost APPLICATION element at a point, ignoring everything of ours. */
  const elementAt = (x, y) => {
    const stack = document.elementsFromPoint(x, y) || [];
    for (let index = 0; index < stack.length; index++) {
      const node = stack[index];
      if (node !== host && node.tagName && node.tagName.toLowerCase() !== NS && !ours(node))
        return node;
    }
    return null;
  };

  /**
   * The name a person would call this element.
   *
   * "aria-label" first, then the control's own <label> - which is what the
   * browser's accessible-name algorithm does for a labelled input, and what
   * Codegen used when it wrote getByRole('checkbox', { name: ... }) for exactly
   * this element. Reading the label matters because the associated control of a
   * custom switch is usually an input with no aria-label of its own: without it
   * the card would be headed "<input>" and the locator would fall all the way
   * back to a tag name.
   */
  const accessibleNameOf = element => {
    const aria = element.getAttribute('aria-label');
    if (aria) return aria;
    const labels = element.labels;
    if (labels && labels.length)
      // Double backslash: this is inside a template literal, so a single one
      // would reach the page as /s+/g and match the letter s. See the same
      // guard on the "text" field below.
      return (labels[0].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    return element.title || '';
  };

  /**
   * A plain description of one element. Attributes copied, nothing interpreted:
   * whether this is a switch, a button or nothing in particular is decided in
   * Node by the capability resolver.
   */
  const describe = element => {
    const aria = {};
    const attributes = {};
    const list = Array.prototype.slice.call(element.attributes || []);
    for (let index = 0; index < list.length; index++) {
      const attribute = list[index];
      if (attribute.name.indexOf('aria-') === 0) aria[attribute.name] = attribute.value;
      else if (attribute.name.indexOf('data-') !== 0) attributes[attribute.name] = attribute.value;
    }
    return {
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type') || undefined,
      role: element.getAttribute('role') || undefined,
      accessibleName: accessibleNameOf(element) || undefined,
      text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) || undefined,
      id: element.id || undefined,
      name: attributes.name || undefined,
      placeholder: attributes.placeholder || undefined,
      title: attributes.title || undefined,
      aria: aria,
      stableClasses: Array.prototype.slice.call(element.classList).slice(0, 8),
      attributeNames: Object.keys(attributes).slice(0, 24)
    };
  };

  /**
   * What is TRUE of this element right now - read, never inferred.
   *
   * Transient by design: nothing here is written to the evidence sidecar. A
   * property is reported only where the DOM answers it directly; a class named
   * "disabled" or "is-on" answers nothing and is not consulted.
   */
  const liveState = element => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const state = { visible: style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0.05 && rect.width > 0 && rect.height > 0 };
    const aria = name => {
      const value = element.getAttribute(name);
      return value === 'true' ? true : value === 'false' ? false : undefined;
    };
    if (typeof element.disabled === 'boolean') state.enabled = !element.disabled;
    else if (aria('aria-disabled') !== undefined) state.enabled = !aria('aria-disabled');
    const type = (element.getAttribute('type') || '').toLowerCase();
    const nativeCheckable = element.tagName.toLowerCase() === 'input'
      && (type === 'checkbox' || type === 'radio');
    if (nativeCheckable && typeof element.checked === 'boolean') state.checked = element.checked;
    else if (aria('aria-checked') !== undefined) state.checked = aria('aria-checked');
    return state;
  };

  /**
   * Controls this element is related to BY THE DOM, for Node to judge.
   *
   * Only relationships the markup states outright, and each one is labelled with
   * how it was reached so the resolver can apply its own rules. No semantics are
   * decided here: this collects, associated-control.ts disposes. The wrapper
   * walk is bounded to three levels and stops at the first ancestor holding any
   * checkable control - more than one is ambiguous and is refused rather than
   * chosen between.
   */
  /**
   * Put an element into the recorder's existing target registry and keep its slot.
   *
   * An INDEX comes back and nothing else. It is what lets the one measurement
   * engine check identity against this exact node instead of a description of it.
   * Absent hook, absent registry, absent index - and the contextual path is simply
   * not attempted.
   */
  const register = element => {
    try {
      return typeof window.__auraRegister === 'function' ? window.__auraRegister(element) : null;
    } catch (error) {
      return null;
    }
  };

  /**
   * The boxes this element sits in, and what they say.
   *
   * Bounded exactly like the capture contract: four ancestors, eight classes,
   * 120 characters of text each. The text is raw page text and stays in memory -
   * only a phrase derived from it, after every refusal in containerPhraseFor, may
   * ever reach a locator or the disk.
   */
  const contextOf = element => {
    const ancestors = [];
    let walk = element.parentElement;
    for (let depth = 0; walk && depth < 4; depth++) {
      ancestors.push({
        tag: walk.tagName.toLowerCase(),
        stableClasses: Array.prototype.slice.call(walk.classList).slice(0, 8),
        // Double backslash: inside a template literal a single one reaches the page
        // as /s+/g and collapses the letter s. Same guard as the two above.
        text: (walk.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
      });
      walk = walk.parentElement;
    }
    return {
      documentId: window.__auraDocument || null,
      targetIndex: register(element),
      ancestors: ancestors
    };
  };

  const associatedCandidates = (element, registerTargets) => {
    const out = [];
    const add = (relationship, node, via) => {
      if (!node || node === element || out.length >= 5) return;
      // The SAME control is reported under every relationship that reaches it,
      // deliberately. A switch thumb inside a <label> is reached both as
      // label-ancestor and as switch-wrapper; the first decides which element is
      // the subject, the second is the evidence that it should be called a switch
      // rather than a tick box. Dropping the duplicate threw that away and
      // Bugasura's toggle offered Checked/Unchecked - verified against the live
      // application, which is the only reason this is known.
      for (let index = 0; index < out.length; index++)
        if (out[index].element === node && out[index].relationship === relationship) return;
      out.push({ relationship: relationship, element: node, node: describe(node),
        state: liveState(node), via: via || null });
    };
    const tag = element.tagName.toLowerCase();

    // 1 - a <label> that was clicked directly
    if (tag === 'label' && element.control)
      add('label-control', element.control, { tag: 'label' });

    // 2 - the clicked element sits inside a <label>
    const label = element.closest ? element.closest('label') : null;
    if (label && label !== element && label.control)
      add('label-ancestor', label.control, { tag: 'label' });

    // 3 - an explicit for/id pair
    const forId = element.getAttribute('for');
    if (forId)
      add('for-id', document.getElementById(forId), { tag: tag });

    // 4 - a wrapper containing exactly one checkable control
    let walk = element.parentElement;
    for (let depth = 0; walk && depth < 3; depth++) {
      const controls = walk.querySelectorAll('input[type=checkbox], input[type=radio]');
      if (controls.length > 1) break;
      if (controls.length === 1) {
        add('switch-wrapper', controls[0], {
          tag: walk.tagName.toLowerCase(),
          role: walk.getAttribute('role') || undefined,
          stableClasses: Array.prototype.slice.call(walk.classList).slice(0, 8),
          controlCount: 1
        });
        break;
      }
      walk = walk.parentElement;
    }

    // 5 - aria-controls
    const controlled = element.getAttribute('aria-controls');
    if (controlled)
      add('aria-controls', document.getElementById(controlled), { tag: tag });

    const payload = [];
    for (let index = 0; index < out.length; index++)
      payload.push({ relationship: out[index].relationship, node: out[index].node,
        state: out[index].state, via: out[index].via,
        // The subject is often NOT the element under the pointer - a switch's
        // state lives on an input the pointer cannot reach - so identity has to be
        // answerable against each candidate in its own right.
        targetIndex: registerTargets ? register(out[index].element) : null });
    return payload;
  };

  // ---- floating-panel placement -----------------------------------------
  //
  // One implementation, in the page. The TypeScript helpers of the same name
  // mirror it exactly and the fixture runs BOTH against the same cases, so the
  // two cannot drift apart without going red.
  const MIN_VISIBLE = ${PANEL_MIN_VISIBLE};
  const RESERVED = ${JSON.stringify(RESERVED_AREAS)};
  const ANCHOR = ${JSON.stringify(PILL_ANCHOR)};
  /**
   * Where the person put each surface, once they have moved it. Null means
   * "decide for me".
   *
   * ONE PER SURFACE, deliberately. The pill is 58px and belongs at an edge; the
   * panel is 272px and does not. Sharing one position parked the panel wherever
   * the pill had been dropped, which at the right-hand edge left 56px of a 272px
   * panel on screen - technically reachable, useless in practice.
   */
  const parked = { pill: null, card: null };

  const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });

  const overlapping = (a, b) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  const reservedRectOf = (area, viewport) => (area.edge === 'top'
    ? { left: 0, top: 0, right: viewport.width, bottom: area.height }
    : { left: viewport.width - area.width, top: viewport.height - area.height,
      right: viewport.width, bottom: viewport.height });

  const clampRect = (rect, viewport) => {
    const visible = Math.min(MIN_VISIBLE, rect.width);
    const left = Math.min(Math.max(rect.left, visible - rect.width), viewport.width - visible);
    const top = Math.min(Math.max(rect.top, 0),
        Math.max(0, viewport.height - Math.min(MIN_VISIBLE, rect.height)));
    return { left: left, top: top, width: rect.width, height: rect.height };
  };

  const defaultRect = (viewport, size) => {
    let rect = {
      left: viewport.width - ANCHOR.right - size.width,
      top: viewport.height - ANCHOR.bottom - size.height,
      width: size.width, height: size.height
    };
    for (let index = 0; index < RESERVED.length; index++) {
      const reserved = reservedRectOf(RESERVED[index], viewport);
      const box = { left: rect.left, top: rect.top,
        right: rect.left + rect.width, bottom: rect.top + rect.height };
      if (!overlapping(box, reserved)) continue;
      const above = reserved.top - size.height - 8;
      rect = { left: rect.left, top: above >= 0 ? above : reserved.bottom + 8,
        width: rect.width, height: rect.height };
    }
    return clampRect(rect, viewport);
  };

  /** Put a floating node where it belongs and make sure it stays reachable. */
  const applyPosition = (node, surface) => {
    const measured = node.getBoundingClientRect();
    const size = { width: measured.width || 272, height: measured.height || 200 };
    const viewport = viewportSize();
    const remembered = parked[surface];
    const rect = remembered
      ? clampRect({ left: remembered.left, top: remembered.top,
        width: size.width, height: size.height }, viewport)
      : defaultRect(viewport, size);
    node.style.left = rect.left + 'px';
    node.style.top = rect.top + 'px';
    node.style.right = 'auto';
    node.style.bottom = 'auto';
  };

  /**
   * How far a pointer may travel before the press stops being a click.
   *
   * Below it, the person is pressing a button and a shaky hand should not change
   * that. Above it, they are moving the tool and the release must not also
   * activate it.
   */
  const DRAG_THRESHOLD = 6;

  /**
   * A drag has just finished, so the click the browser is about to synthesise is
   * not a click anybody made. State, not a timer: the flag is set on the pointer
   * event and consumed by the very next click, so nothing can arrive late and
   * nothing can be missed.
   */
  let suppressClick = false;
  const consumeSuppressedClick = () => {
    const suppress = suppressClick;
    suppressClick = false;
    return suppress;
  };

  /** Controls that own their own press. A drag surface must never swallow these. */
  const INTERACTIVE = 'button, input, select, textarea, a[href], [contenteditable]';

  /**
   * Drag by the handle, with pointer events and nothing else.
   *
   * No library, no timers, no coordinates reaching the application: our host owns
   * the pointer, and once a drag starts the pointer is captured by OUR element.
   *
   * TWO THINGS THIS GETS RIGHT THAT THE FIRST VERSION DID NOT.
   *
   * It does not preventDefault() on pointerdown. Doing so suppresses the
   * compatibility mouse events the browser generates from that pointer - which is
   * how the panel's Close button stopped working: the press was cancelled before
   * it could become a click, and the click that did arrive was targeted at the
   * header instead of the button. Default is only prevented once a drag has
   * actually begun, where it stops text selection and scrolling rather than a
   * button.
   *
   * And it suppresses the FOLLOW-UP CLICK by state. Stopping propagation of the
   * pointerup does nothing to the click that follows it - a separate event - so
   * dragging the pill moved it and then armed assert mode, as if it had been
   * tapped. The flag below is what makes "I moved this" and "I pressed this"
   * different gestures.
   */
  const draggable = (handle, node, surface) => {
    let origin = null;

    const finish = (event, cancelled) => {
      if (!origin) return;
      if (origin.captured) {
        try { handle.releasePointerCapture(origin.pointerId); } catch (error) { /* not fatal */ }
      }
      if (cancelled && origin.moved) {
        // Escape puts it back where it was, and the position is no longer manual
        // if it never was before this drag.
        node.style.left = origin.left + 'px';
        node.style.top = origin.top + 'px';
        parked[surface] = origin.placedBefore;
      }
      // Only a real drag suppresses the click. A press that never moved IS a click.
      if (origin.moved) suppressClick = true;
      origin = null;
      if (event) event.stopPropagation();
    };

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      // A press that begins on a control belongs to that control. Without this the
      // header swallowed its own Close button.
      if (event.target && event.target.closest && event.target.closest(INTERACTIVE)) return;
      const rect = node.getBoundingClientRect();
      origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top,
        pointerId: event.pointerId, moved: false, captured: false,
        placedBefore: parked[surface] };
      // Capture NOW, so a fast drag off a 58px pill still delivers its moves here.
      // Capture is not what breaks a click - preventDefault is, and that is why
      // there is none on this event. The gesture is still decided by distance.
      try {
        handle.setPointerCapture(event.pointerId);
        origin.captured = true;
      } catch (error) { /* not fatal */ }
    });

    handle.addEventListener('pointermove', event => {
      if (!origin || event.pointerId !== origin.pointerId) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (!origin.moved && Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
      origin.moved = true;
      const size = node.getBoundingClientRect();
      parked[surface] = clampRect({ left: origin.left + dx, top: origin.top + dy,
        width: size.width, height: size.height }, viewportSize());
      node.style.left = parked[surface].left + 'px';
      node.style.top = parked[surface].top + 'px';
      node.style.right = 'auto';
      node.style.bottom = 'auto';
      // From here the gesture IS a drag, so stop the page selecting text under it.
      event.preventDefault();
    });

    handle.addEventListener('pointerup', event => finish(event, false));
    handle.addEventListener('pointercancel', event => finish(event, true));
    handle.addEventListener('lostpointercapture', () => { if (origin) finish(null, false); });
    // Escape abandons a drag in progress and puts the tool back.
    handle.addEventListener('keydown', event => {
      if (event.key === 'Escape' && origin) finish(null, true);
    });
    return { cancel: () => finish(null, true), dragging: () => Boolean(origin && origin.moved) };
  };

  // A resize can leave a parked panel off screen. Re-clamp on the event itself;
  // no timer, no polling.
  window.addEventListener('resize', () => {
    if (card && card.isConnected) applyPosition(card, 'card');
    if (pill && pill.isConnected) applyPosition(pill, 'pill');
  });

  const closeCard = () => {
    if (card) { card.remove(); card = null; }
  };

  const setMode = on => {
    pill.setAttribute('data-on', String(on));
    pill.textContent = on ? 'Assert: pick an element' : 'Assert';
    host.style.pointerEvents = on ? 'auto' : 'none';
    if (on) {
      if (!veil) {
        veil = document.createElement('div');
        veil.className = 'veil';
        shadow.appendChild(veil);
      }
      if (!ring) {
        ring = document.createElement('div');
        ring.className = 'ring';
        ring.style.display = 'none';
        shadow.appendChild(ring);
      }
    } else {
      if (veil) { veil.remove(); veil = null; }
      if (ring) { ring.remove(); ring = null; }
      hovered = null;
      closeCard();
    }
  };

  pill.setAttribute('role', 'button');
  pill.setAttribute('tabindex', '0');
  pill.setAttribute('aria-label', 'Assert: record what must be true');
  pill.title = 'Click to pick an element. Drag to move.';
  applyPosition(pill, 'pill');
  const pillDrag = draggable(pill, pill, 'pill');

  const toggleMode = () => setMode(pill.getAttribute('data-on') !== 'true');

  pill.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    // A click the browser synthesised at the end of a drag is not a press.
    if (consumeSuppressedClick()) return;
    toggleMode();
  });
  pill.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    toggleMode();
  });

  // Escape leaves selection mode, and closes the panel if one is open. Registered
  // in the capture phase on OUR host first, then the document, so it works whether
  // or not the application also listens for it - and it never stops the page from
  // seeing its own Escape while the picker is idle.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (pillDrag.dragging()) {
      event.preventDefault();
      event.stopPropagation();
      pillDrag.cancel();
      return;
    }
    if (pill.getAttribute('data-on') !== 'true' && !card) return;
    event.preventDefault();
    event.stopPropagation();
    setMode(false);
  }, true);

  document.addEventListener('mousemove', event => {
    if (!veil || card) return;
    const element = elementAt(event.clientX, event.clientY);
    hovered = element;
    if (!element || !ring) { if (ring) ring.style.display = 'none'; return; }
    const rect = element.getBoundingClientRect();
    ring.style.display = '';
    ring.style.left = rect.left + 'px';
    ring.style.top = rect.top + 'px';
    ring.style.width = rect.width + 'px';
    ring.style.height = rect.height + 'px';
  }, { capture: true, passive: true });

  /**
   * The selection click.
   *
   * It lands on the veil - our own element - so the application never receives
   * it and its state cannot change. preventDefault/stopPropagation here are
   * about the recorder's own overlay, not about an application interaction.
   */
  const onVeilClick = async event => {
    if (!veil || event.target !== veil) return;
    event.preventDefault();
    event.stopPropagation();
    const element = hovered || elementAt(event.clientX, event.clientY);
    if (!element) return;
    let model = null;
    try {
      model = await window.__auraDescribe({ node: describe(element), state: liveState(element),
        candidates: associatedCandidates(element) });
    } catch (error) {
      model = null;
    }
    if (!model) return;
    openCard(element, model);
  };
  shadow.addEventListener('click', onVeilClick, true);

  const tick = value => (value === true ? '\\u2713 ' : value === false ? '\\u2717 ' : '? ');

  function openCard(element, model) {
    closeCard();
    card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Assert');

    // HEADER = the only drag handle. The body holds the assertion buttons, and a
    // person reaching for one of those must not start a drag by accident.
    const header = document.createElement('div');
    header.className = 'hd';
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.textContent = '\u2059';
    grip.setAttribute('aria-hidden', 'true');
    const heading = document.createElement('span');
    heading.className = 'ttl';
    heading.textContent = 'Assert';
    const hint = document.createElement('span');
    hint.className = 'drag-hint';
    hint.textContent = 'drag';
    const closeButton = document.createElement('button');
    closeButton.className = 'close';
    closeButton.type = 'button';
    closeButton.textContent = '\u00d7';
    closeButton.setAttribute('aria-label', 'Close without asserting');
    closeButton.title = 'Close (Esc)';
    header.appendChild(grip);
    header.appendChild(heading);
    header.appendChild(hint);
    header.appendChild(closeButton);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'body';
    card.appendChild(body);

    const title = document.createElement('div');
    title.innerHTML = '<h4></h4>';
    title.querySelector('h4').textContent = model.description || 'element';
    body.appendChild(title);
    if (model.semantics) {
      const kind = document.createElement('div');
      kind.className = 'muted';
      kind.textContent = model.semantics;
      body.appendChild(kind);
    }

    // When the assertion is about an associated control rather than the element
    // under the pointer, say so on the card. A person who selected a switch thumb
    // and is offered ON/OFF should be able to see WHY, and disagree if it is wrong.
    if (model.note) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = model.note;
      body.appendChild(note);
    }

    const state = document.createElement('div');
    state.className = 'state muted';
    for (let index = 0; index < model.state.length; index++) {
      const entry = model.state[index];
      const span = document.createElement('span');
      span.textContent = tick(entry.value) + entry.label;
      state.appendChild(span);
    }
    body.appendChild(state);

    const label = document.createElement('div');
    label.className = 'muted';
    label.textContent = 'Assert:';
    body.appendChild(label);

    for (let index = 0; index < model.capabilities.length; index++) {
      const capability = model.capabilities[index];
      const button = document.createElement('button');
      button.className = 'row';
      button.textContent = capability.label;
      button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        let value = null;
        if (capability.needs) {
          const input = card.querySelector('input[data-for="' + capability.id + '"]');
          value = input ? input.value : '';
          if (!value) { if (input) input.focus(); return; }
        }
        try {
          await window.__auraAssert({ capabilityId: capability.id, value: value,
            node: describe(element), state: liveState(element),
            candidates: associatedCandidates(element, true),
            context: contextOf(element) });
        } catch (error) {
          // A recorder that cannot record must not break the page.
        }
        setMode(false);
      }, true);
      body.appendChild(button);
      if (capability.needs) {
        const input = document.createElement('input');
        input.setAttribute('data-for', capability.id);
        input.placeholder = capability.placeholder || capability.needs;
        body.appendChild(input);
      }
    }

    closeButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setMode(false);
    }, true);

    shadow.appendChild(card);
    // Placed by the panel rules, not beside the element: a card pinned to whatever
    // was clicked is exactly what ran off the bottom of the screen. If the person
    // has already parked the panel somewhere, that position is kept.
    applyPosition(card, 'card');
    draggable(header, card, 'card');
  }

  // The three read-only helpers are exposed so the fixture can exercise the REAL
  // walk against a DOM rather than a copy of it living in a test. They only read:
  // none of them can write an attribute, click anything or change a page, which is
  // the same bar the rest of this file is held to.
  window.__auraPicker = { version: 3, namespace: NS,
    describe: describe, liveState: liveState, associatedCandidates: associatedCandidates,
    // The placement maths, exposed so the fixture can run THIS implementation
    // against the TypeScript one of the same name. Two copies of a rule is how
    // they drift; one test that runs both is how they cannot.
    clampRect: clampRect, defaultRect: defaultRect };
})()`;
