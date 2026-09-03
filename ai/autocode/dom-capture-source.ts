/**
 * The browser-side capture, as a STRING.
 *
 * Not a function literal, and not in the spike file: tsx/esbuild rewrites function
 * literals to add a `__name` helper for stack traces, and that helper does not exist
 * inside the page — the first run died with `ReferenceError: __name is not defined`.
 * A string crosses the boundary exactly as written.
 *
 * Bounded here as well as in `sanitiseEvidence`, so a page with ten thousand nodes
 * cannot be walked in the first place: 8 ancestors, 10 children, 15 descendants to
 * depth 3, 4 siblings each way, 300 chars of text per node. The funnel then trims to
 * the contract's own limits.
 */
export const ELEMENT_CAPTURE = `element => {
  const CONTAINERS = ['form','dialog','main','nav','header','footer','aside','section','article','table','thead','tbody','tr','ul','ol','li','fieldset','details'];
  // Phase 8A found the account email inside a <script> node's textContent. Script and
  // style bodies are source code and can hold anything - tokens, session data,
  // addresses - so these nodes are not described at all, in any direction.
  const OPAQUE = ['script','style','noscript','template','iframe','object','embed'];
  var isOpaque = function (node) { return OPAQUE.indexOf(node.tagName.toLowerCase()) >= 0; };
  var describe = function (node) {
    var attributes = {}; var aria = {}; var data = {};
    var list = Array.prototype.slice.call(node.attributes);
    for (var i = 0; i < list.length; i++) {
      var attribute = list[i];
      if (attribute.name.indexOf('aria-') === 0) aria[attribute.name] = attribute.value;
      else if (attribute.name.indexOf('data-') === 0) data[attribute.name] = attribute.value;
      else attributes[attribute.name] = attribute.value;
    }
    var classes = Array.prototype.slice.call(node.classList).filter(function (name) {
      return name.length < 30 && !/^(css-|jss)/.test(name) && !/[a-z]{2}[0-9]{4,}/.test(name);
    }).slice(0, 8);
    var style = null;
    try { style = window.getComputedStyle(node); } catch (e) { style = null; }
    // SCROLLABLE: the node clips its own content AND actually overflows. Both halves
    // matter - overflow:auto on a box that fits scrolls nothing.
    var overflowY = style ? style.overflowY : '';
    var overflowX = style ? style.overflowX : '';
    var scrolls = (overflowY === 'auto' || overflowY === 'scroll' || overflowX === 'auto' || overflowX === 'scroll')
      && (node.scrollHeight > node.clientHeight + 4 || node.scrollWidth > node.clientWidth + 4);
    // VIRTUALIZED: only what the application says about itself. A scrollbar is NOT a
    // signal - a long page scrolls and still renders everything.
    var virtualSignal = '';
    var declaredRows = parseInt(node.getAttribute('aria-rowcount') || '', 10);
    var declaredSet = parseInt(node.getAttribute('aria-setsize') || '', 10);
    var renderedRows = node.querySelectorAll('[role="row"], [role="option"], [role="listitem"], tr').length;
    if (!isNaN(declaredRows) && declaredRows > 0 && renderedRows > 0 && declaredRows > renderedRows)
      virtualSignal = 'aria-rowcount ' + declaredRows + ' > ' + renderedRows + ' rendered rows';
    else if (!isNaN(declaredSet) && declaredSet > 0 && renderedRows > 0 && declaredSet > renderedRows)
      virtualSignal = 'aria-setsize ' + declaredSet + ' > ' + renderedRows + ' rendered items';
    if (!virtualSignal) {
      var names = Array.prototype.slice.call(node.attributes).map(function (a) { return a.name; });
      for (var n = 0; n < names.length; n++) {
        if (names[n].indexOf('virtual') >= 0) { virtualSignal = 'attribute ' + names[n]; break; }
      }
    }
    return {
      tag: node.tagName.toLowerCase(),
      scrollable: scrolls || undefined,
      virtualized: virtualSignal ? true : undefined,
      virtualizedSignal: virtualSignal || undefined,
      role: node.getAttribute('role') || undefined,
      accessibleName: (node.getAttribute('aria-label') || node.title || '') || undefined,
      text: (node.textContent || '').trim().slice(0, 300) || undefined,
      id: node.id || undefined,
      name: attributes.name || undefined,
      type: attributes.type || undefined,
      placeholder: attributes.placeholder || undefined,
      title: attributes.title || undefined,
      aria: aria, data: data, stableClasses: classes
    };
  };
  var ancestors = []; var current = element.parentElement; var depth = 1;
  while (current && ancestors.length < 8 && depth <= 12) {
    if (!isOpaque(current) && (CONTAINERS.indexOf(current.tagName.toLowerCase()) >= 0 || current.getAttribute('role') || current.id)) {
      var a = describe(current); a.relationship = 'ancestor'; a.depth = depth; ancestors.push(a);
    }
    current = current.parentElement; depth++;
  }
  var children = Array.prototype.slice.call(element.children).filter(function (n) { return !isOpaque(n); }).slice(0, 10).map(function (node) {
    var c = describe(node); c.relationship = 'child'; c.depth = 1; return c;
  });
  var descendants = [];
  var walk = function (node, level) {
    if (level > 3 || descendants.length >= 15) return;
    var kids = Array.prototype.slice.call(node.children).filter(function (n) { return !isOpaque(n); });
    for (var i = 0; i < kids.length; i++) {
      var d = describe(kids[i]); d.relationship = 'descendant'; d.depth = level;
      descendants.push(d);
      walk(kids[i], level + 1);
    }
  };
  walk(element, 1);
  var previous = []; var sibling = element.previousElementSibling;
  while (sibling && previous.length < 4) {
    if (isOpaque(sibling)) { sibling = sibling.previousElementSibling; continue; }
    var p = describe(sibling); p.relationship = 'previous-sibling'; p.depth = previous.length + 1;
    previous.push(p); sibling = sibling.previousElementSibling;
  }
  var next = []; sibling = element.nextElementSibling;
  while (sibling && next.length < 4) {
    if (isOpaque(sibling)) { sibling = sibling.nextElementSibling; continue; }
    var n = describe(sibling); n.relationship = 'next-sibling'; n.depth = next.length + 1;
    next.push(n); sibling = sibling.nextElementSibling;
  }
  var rect = element.getBoundingClientRect();
  var onScreen = rect.bottom > 0 && rect.right > 0
    && rect.top < (window.innerHeight || 0) && rect.left < (window.innerWidth || 0);
  // scrollRequired: it is off screen AND something above it scrolls, so scrolling is
  // what would bring it into view rather than it simply not existing.
  var scrollingAncestor = false;
  var walk = element.parentElement;
  while (walk && !scrollingAncestor) {
    var s2 = null;
    try { s2 = window.getComputedStyle(walk); } catch (e) { s2 = null; }
    var oy = s2 ? s2.overflowY : '';
    var ox = s2 ? s2.overflowX : '';
    if ((oy === 'auto' || oy === 'scroll' || ox === 'auto' || ox === 'scroll')
      && (walk.scrollHeight > walk.clientHeight + 4 || walk.scrollWidth > walk.clientWidth + 4))
      scrollingAncestor = true;
    walk = walk.parentElement;
  }
  return {
    attached: element.isConnected === true,
    viewport: {
      inViewport: onScreen,
      scrollRequired: !onScreen && (scrollingAncestor || document.documentElement.scrollHeight > window.innerHeight),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    target: describe(element),
    parent: element.parentElement ? describe(element.parentElement) : undefined,
    ancestors: ancestors, children: children, descendants: descendants,
    previousSiblings: previous, nextSiblings: next
  };
}`;

/**
 * The pre-action hook, installed once per page via `context.addInitScript`.
 *
 * WHY THIS EXISTS
 *
 * Codegen writes an action line AFTER the person performs it, so anything that reads
 * the DOM when the line appears is reading a page that has already moved on: a click
 * that navigated, a click that closed a modal, a click that re-rendered a virtualized
 * row. The graph then describes the wrong thing, or nothing at all.
 *
 * `pointerdown` and `focusin` fire BEFORE the interaction takes effect, in the capture
 * phase, on the element the person is actually acting on. So the graph is taken there
 * and parked on the page; the recorder drains it when the corresponding line appears
 * and matches it by the element's own identity, never by ordering.
 *
 * PASSIVE BY CONSTRUCTION. Listeners are `capture: true, passive: true`: they never
 * call `preventDefault`, never stop propagation, never mutate the DOM and never touch
 * styles. The page behaves exactly as it would with no recorder attached - which is
 * the whole point, since the person is recording real behaviour.
 *
 * BOUNDED. At most `MAX` entries are kept; the oldest is dropped. A long recording
 * cannot grow the page's memory without limit.
 *
 * WHAT P0.7 ADDED, AND WHY IT HAD TO BE HERE
 *
 * Two facts exist only in this document, at this instant, and nowhere afterwards.
 *
 * The first is WHICH document this is. A click that navigates is measured, 400ms
 * later, against the page it arrived at: `getByRole('button', { name: 'Sign In' })`
 * measured 0 in every live recording made so far, and 0 there means "the login page
 * is gone", not "the button was missing when it was pressed". `__auraDocument` is an
 * opaque nonce - no URL, nothing about the page - and it is what lets the recorder
 * refuse to read a number taken in a document the person never clicked in.
 *
 * The second is the ELEMENT ITSELF. `event.target` is the exact node the person acted
 * on; a selector that matches exactly one element may still match a different one.
 * `__auraTargets` keeps the node so a candidate can be checked against it by identity
 * (`===`), which is the only check that can tell those two apart. The measurement is
 * driven from the recorder in one batched call (`__auraMeasure`), so the derivation
 * rules stay in `candidateSelectorsFor` and are not copied in here.
 */
export const PREACTION_HOOK = `(() => {
  if (window.__auraPreAction) return;
  const MAX = 60;
  const queue = [];
  window.__auraPreAction = queue;
  // Identity of THIS document. Random, opaque, and regenerated by every navigation,
  // because an init script runs afresh in every new document - which is exactly what
  // makes it usable as "the same page, or not".
  const DOCUMENT_ID = Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  window.__auraDocument = DOCUMENT_ID;
  // The pressed elements themselves, addressed by a counter that NEVER shifts: an
  // entry parked earlier still points at its own element after older ones are
  // released. Slots older than MAX are nulled, so at most 60 nodes are held from
  // collection, and all of them go with the document.
  const targets = [];
  let nextTarget = 0;
  window.__auraTargets = targets;
  // ONE allocator, because there are three callers and the slot lifecycle is a RULE.
  // Duplicating "take the next index, park the node, release the slot MAX ago" in
  // each of them is how they would drift, and a drifted registry hands an identity
  // check a slot somebody else already holds.
  //
  // IDEMPOTENT PER NODE, and that is the whole of the TC_LOGIN_107 fix. A slot named
  // a REGISTRATION EVENT, so one element pressed twice had two names and one element
  // never pressed at all had none - which is why an assertion made BEFORE anything was
  // clicked could not be tied to the element it was about, while the identical
  // assertion made after the click could. A slot now names the NODE: ask twice for the
  // same live element and the same index comes back, so its name exists from the first
  // moment anything looks at it, whether that was a press or a person pointing at it.
  //
  // The scan is linear over at most MAX entries and holds no extra reference to
  // anything - which is why it is a scan and not a Map. It is also self-correcting
  // about the release below: a slot whose node has been nulled cannot match, so the
  // element is simply registered afresh and gets a new name. A stale name is never
  // handed back.
  const allocate = element => {
    for (let index = 0; index < targets.length; index++)
      if (targets[index] === element) return index;
    const index = nextTarget++;
    targets[index] = element;
    if (index >= MAX) targets[index - MAX] = null;
    return index;
  };
  // A NAME for one registration, so a registration can be referred to after the
  // node itself is out of reach.
  //
  // The slot index alone is not enough: it is meaningful only inside this document,
  // and it is a small integer that anything downstream could mistake for a DOM
  // position (positionWithinCandidate IS such a number). Pairing it with the
  // document nonce makes it opaque, unique for the life of the document, and
  // obviously not an ordinal. Nothing about the page is in it - the nonce is random
  // and carries no URL, no text and no attribute.
  const refFor = index => DOCUMENT_ID + ':' + index;
  // The assertion picker's way into this registry.
  //
  // __auraMeasure checks identity as targets[index] === nodes[0], and the
  // counter that allocates those slots lives in this closure - so without a way in,
  // the picker could not have its subject identity-checked at all, and would have
  // needed a second measurement engine with its own copy of the filter, the descend
  // and the identity rule. One engine, one set of rules; this is the door.
  //
  // It takes an element and returns an INDEX. Nothing else crosses: no node, no
  // attribute, no value, no text. The slot lifecycle is the one above, unchanged -
  // same counter, same release of the slot MAX presses ago - so a registration can
  // never overwrite a live press's slot or shift an index somebody already holds.
  window.__auraRegister = element => {
    if (!element || element.nodeType !== 1) return null;
    return allocate(element);
  };
  // WHICH RECORDED PRESSES WERE ON THIS VERY NODE.
  //
  // The one question that can only be answered here, and the reason it exists: an
  // assertion's locator is composed independently of any action's, so two strings
  // naming one element need not look alike, and nothing outside this document can
  // tell whether they do. A press parked its node; the picker registered its
  // subject; this compares them with === and reports the presses that match by NAME.
  //
  // What it deliberately does not do: it never compares selectors, class names,
  // text, ids, ordering or recency, and it never falls back to "the last press" when
  // nothing matches. An empty list is a real answer - this assertion is about an
  // element no recorded press touched - and it is returned as one.
  //
  // Bounded by the press queue (MAX entries) and by the registry's own slot release,
  // so an element pressed long enough ago is honestly unmatchable rather than
  // approximated.
  window.__auraSameElement = payload => {
    const answer = { documentId: DOCUMENT_ID, sameDocument: false, targetPresent: false, refs: [] };
    if (!payload || (payload.documentId && payload.documentId !== DOCUMENT_ID)) return answer;
    answer.sameDocument = true;
    const element = targets[payload.index];
    if (!element || element.nodeType !== 1) return answer;
    answer.targetPresent = true;
    // THE NODE'S OWN NAME FIRST, and this is what an assertion made before any press
    // had no way to obtain. The slot the caller is asking about IS a registration of
    // this element, so its name is a fact about the element already - it does not have
    // to be earned by an interaction. TC_LOGIN_107 asserted "not ticked" before
    // clicking anything, and this list came back empty because only the press queue was
    // consulted.
    answer.refs.push(refFor(payload.index));
    // Then any OTHER registration in the press queue that is the same node. With an
    // idempotent allocator this is normally the same name and adds nothing; it still
    // matters when a slot was released and the element was registered again, which
    // leaves one node genuinely holding two names.
    for (let index = 0; index < queue.length; index++) {
      const entry = queue[index];
      if (!entry || typeof entry.targetIndex !== 'number' || !entry.elementRef) continue;
      // A released slot holds null, and null is never a live element - so an entry
      // whose node has gone simply does not match. It never matches "by absence".
      if (targets[entry.targetIndex] !== element) continue;
      if (answer.refs.indexOf(entry.elementRef) < 0) answer.refs.push(entry.elementRef);
    }
    return answer;
  };
  // CAPTURE THE SURROUNDINGS OF AN ALREADY-REGISTERED NODE, without parking a press.
  //
  // The third door, and the one an assertion needs. remember() below captures a graph
  // because something was pressed; this captures one because a person pointed at an
  // element and said what must be true of it. Same capture function, same registry,
  // same names - so an assertion's evidence is built by exactly the machinery an
  // action's is, and the two cannot describe an element differently.
  //
  // NO BACKTICK ANYWHERE IN THIS FILE: it is a template literal, and one ends the
  // injected script. This comment cost a run by naming remember() in backticks.
  //
  // DELIBERATELY NOT PARKED. It never enters the press queue and never reaches
  // window.__auraPark, because a graph taken at a pick must never be claimable by a
  // recorded action line: an assertion is not an interaction, and attributing one to
  // the other is the error the whole timing contract exists to prevent.
  window.__auraObserveSlot = payload => {
    if (!payload || (payload.documentId && payload.documentId !== DOCUMENT_ID)) return null;
    const element = targets[payload.index];
    if (!element || element.nodeType !== 1) return null;
    return {
      at: Date.now(),
      documentId: DOCUMENT_ID,
      targetIndex: payload.index,
      elementRef: refFor(payload.index),
      fingerprint: fingerprint(element),
      graph: capture(element)
    };
  };
  const capture = ${ELEMENT_CAPTURE};
  // How much of a scope may be walked when a candidate has to find the text-bearing
  // element inside it. A container like #all_apps can hold thousands of nodes, and a
  // measurement that walked all of them would stall the page the person is recording.
  // Hitting the cap reports an error for that candidate, which refuses it - it never
  // reports a count it did not finish taking.
  const MAX_SCAN = 2000;
  const MAX_BASES = 50;
  const MAX_CANDIDATES = 24;
  // \\s, not \s: this is a TEMPLATE LITERAL. A single backslash is eaten before the
  // string reaches the browser, and the regex becomes /s+/g - which collapses the
  // LETTER "s". The same bug once fingerprinted "Faclon labs" as "Faclon lab".
  const norm = value => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  // Measure candidate selectors against THIS document and THIS element.
  //
  // Called by the recorder immediately after an entry is parked, in one batch. It
  // reads querySelectorAll and textContent: no layout, no mutation, nothing the page
  // can observe.
  //
  // The two text shapes mirror what contentExpression will emit:
  //   filter  - locator(sel).filter({ hasText }): keep the element the selector
  //             matched, require it to contain the text.
  //   descend - locator(sel).getByText(text): the smallest element inside the scope
  //             whose text matches, which is how Playwright's text engine resolves.
  // Both are approximations of Playwright's own matching (textContent here, innerText
  // there), which is why nothing is promoted on this measurement alone: it has to
  // agree with an identity check against the pressed element, and the generation gate
  // still runs the spec afterwards.
  // Every element inside \`bases\` that is the SMALLEST one holding \`needle\` - which is
  // how Playwright's text engine resolves \`getByText\`. Returns null when the walk hits
  // its budget, because a partial count is not a count.
  const smallestHolding = (bases, needle) => {
    const found = [];
    let scanned = 0;
    for (let b = 0; b < bases.length && b < MAX_BASES; b++) {
      const inside = Array.prototype.slice.call(bases[b].querySelectorAll('*'));
      for (let i = 0; i < inside.length; i++) {
        if (++scanned > MAX_SCAN) return null;
        const node = inside[i];
        if (norm(node.textContent).indexOf(needle) < 0) continue;
        let smallest = true;
        const kids = Array.prototype.slice.call(node.children);
        for (let k = 0; k < kids.length; k++) {
          if (norm(kids[k].textContent).indexOf(needle) >= 0) { smallest = false; break; }
        }
        if (smallest && found.indexOf(node) < 0) found.push(node);
      }
    }
    return found;
  };
  window.__auraMeasure = payload => {
    const answer = { documentId: DOCUMENT_ID, sameDocument: false, targetPresent: false, results: [] };
    if (!payload || (payload.documentId && payload.documentId !== DOCUMENT_ID)) return answer;
    answer.sameDocument = true;
    const element = targets[payload.index];
    answer.targetPresent = !!(element && element.nodeType === 1);
    // WHAT THIS ELEMENT'S OWN TEXT IDENTIFIES, page-wide, right now.
    //
    // The one question a later count can never answer. Codegen writes the locator
    // AFTER the action, so by the time the recorder can count it, a click that
    // navigated has taken the page with it - and this is the measurement that decides
    // whether the text Codegen used identified one element or several at the moment
    // the person pressed it. Bounded by the same budget as everything else here.
    if (payload.ownText) {
      const needle = norm(payload.ownText);
      const holders = needle ? smallestHolding([document.body], needle) : null;
      answer.ownText = holders === null
        ? { matchCount: null, identityMatched: false, error: 'document too large to measure' }
        : { matchCount: holders.length, identityMatched: !!element && holders.indexOf(element) >= 0 };
    }
    const list = (payload.candidates || []).slice(0, MAX_CANDIDATES);
    for (let index = 0; index < list.length; index++) {
      const candidate = list[index];
      let nodes = null;
      try {
        nodes = Array.prototype.slice.call(document.querySelectorAll(candidate.selector));
      } catch (error) {
        answer.results.push({ strategy: candidate.strategy, error: 'selector could not be evaluated' });
        continue;
      }
      if (candidate.text) {
        const needle = norm(candidate.text);
        if (candidate.textMode === 'descend') {
          const found = smallestHolding(nodes, needle);
          if (found === null) {
            answer.results.push({ strategy: candidate.strategy, error: 'scope too large to measure' });
            continue;
          }
          nodes = found;
        } else {
          nodes = nodes.filter(node => norm(node.textContent).indexOf(needle) >= 0);
        }
      }
      // A contextual candidate names a CONTAINER by what it says and then the
      // element inside it. Descending here rather than in a second round trip is
      // what keeps the whole measurement one batched evaluate.
      if (candidate.descendant) {
        try {
          const inside = [];
          for (let outer = 0; outer < nodes.length; outer++) {
            const found = nodes[outer].querySelectorAll(candidate.descendant);
            for (let each = 0; each < found.length; each++)
              inside.push(found[each]);
          }
          nodes = inside;
        } catch (error) {
          answer.results.push({ strategy: candidate.strategy, error: 'descendant could not be evaluated' });
          continue;
        }
      }
      answer.results.push({
        strategy: candidate.strategy,
        count: nodes.length,
        // IDENTITY, not similarity. One element that is a DIFFERENT element is the
        // failure this whole mechanism exists to catch.
        identityMatched: nodes.length === 1 && !!element && nodes[0] === element,
        // WHICH of the matches was pressed, when there is more than one.
        //
        // identityMatched answers "does this expression identify the pressed
        // element?" and is false the moment the expression matches several. This
        // answers the different question the recorder could never answer before:
        // "which one was it?". Measured here because this is the only place both
        // sides exist at once - the live match list and the actual pressed node.
        //
        // NOT derived from targetIndex (a parking slot), not from recording order,
        // not from anything observed after the action. indexOf on the real nodes,
        // at the press, or null. NO BACKTICKS IN THIS FILE: it is a template
        // literal, and one would end the injected script.
        positionWithinCandidate: !!element && nodes.length > 1
          ? (nodes.indexOf(element) >= 0 ? nodes.indexOf(element) : null)
          : null
      });
    }
    return answer;
  };
  const fingerprint = element => {
    const attributes = {};
    for (const attribute of Array.prototype.slice.call(element.attributes))
      attributes[attribute.name] = attribute.value;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      testId: attributes['data-testid'] || attributes['data-test-id'] || '',
      role: element.getAttribute('role') || '',
      ariaLabel: element.getAttribute('aria-label') || '',
      name: attributes.name || '',
      placeholder: attributes.placeholder || '',
      title: attributes.title || '',
      type: attributes.type || '',
      // \\s, not \\\\s: this is a TEMPLATE LITERAL, so a single backslash is eaten before
      // the string ever reaches the browser and the regex becomes /s+/g - which replaces
      // the LETTER "s". It shipped that way, and "Faclon labs" was fingerprinted as
      // "Faclon lab", so no recorded text ever matched and every parked entry was thrown
      // away. Reading the source proves nothing here; the fixture asserts on the
      // generated string.
      text: (element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      classes: Array.prototype.slice.call(element.classList).slice(0, 8)
    };
  };
  const remember = event => {
    try {
      const element = event.target;
      if (!element || element.nodeType !== 1) return;
      if (queue.length >= MAX) queue.shift();
      // The element is parked beside its graph so a candidate measured later can be
      // checked against the node itself rather than against a description of it. The
      // index never shifts; the slot MAX presses ago is released instead.
      const targetIndex = allocate(element);
      const entry = {
        at: Date.now(),
        kind: event.type,
        documentId: DOCUMENT_ID,
        targetIndex: targetIndex,
        // The NAME of this registration, carried out of the page with the entry so
        // the evidence built from it can be referred to later by something that has
        // no locator in common with it. See __auraSameElement.
        elementRef: refFor(targetIndex),
        fingerprint: fingerprint(element),
        graph: capture(element)
      };
      queue.push(entry);
      // Hand the entry to the framework AS IT IS PARKED, not when the recorder later
      // writes its line. \`window.__auraPreAction\` lives on the document, so a click that
      // navigates destroys its own evidence ~400ms before the file watcher asks for it.
      // Still passive with respect to the PAGE: this pushes a copy out, it does not read
      // or alter anything the person is recording, and a failure is swallowed.
      try { if (window.__auraPark) window.__auraPark(entry); } catch (error) { }
    } catch (error) {
      // A capture must never break the page the person is recording.
    }
  };
  for (const type of ['pointerdown', 'focusin'])
    document.addEventListener(type, remember, { capture: true, passive: true });
})()`;
