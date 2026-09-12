import '../testing/isolated-checkout';
/**
 * Assertion-to-target provenance: which element a recorded assertion is ABOUT.
 *
 *   npx tsx ai/autocode/assertion-provenance.fixture.ts
 *
 * Offline: no browser, no model, no network.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * `evidenceFor` joins an assertion to its evidence on the locator STRING. That is the
 * right key for an action - the action IS the line Codegen wrote - and the wrong key
 * for an assertion, whose locator is composed independently by `locatorFor` from the
 * element's own description. One element, two composers, two strings that need share
 * no substring. TC_DASHBOARD_023 is the case: the assertion carries
 * `page.locator(".bugChecked")` and the evidence row for that very input is
 * `page.locator('[id="1749552"]')`. No join, no evidence, the offline scorer rated a
 * bare class at 65 and emitted it, and Playwright refused it at run time as three
 * elements - while the measurement naming WHICH of the three sat in the same file.
 *
 * WHAT IS TESTED, AND WHY IN THREE LAYERS
 *
 *   A. THE IN-PAGE HALF, by running the GENERATED hook string against a stub DOM. The
 *      association is an identity check on real nodes, so reading the source proves
 *      nothing: the check has to be run.
 *   B. THE WIRING, because that is where this class of mechanism dies. The positional
 *      measurement was computed in the page and dropped one line later in the
 *      recorder, and every fixture stayed green because they all built their evidence
 *      by hand. So the recorder's own sequence is driven here, through the real
 *      exported functions.
 *   C. THE DECISION, given evidence that carries an association - the ten cases the
 *      mechanism has to get right, including every case where the answer is
 *      NEEDS_REVIEW rather than a locator.
 *
 * WHAT IS NOT CLAIMED. Part F replays TC_DASHBOARD_023's REAL measured candidates -
 * counts, positions, identity flags, all read from its own evidence file and none of
 * them altered - and supplies the one thing a recording made before this mechanism
 * existed cannot have: the registration name. That is a test of the decision, not a
 * claim about the file on disk. The recording on disk carries no `elementRef`, so
 * provenance is genuinely unavailable for it and re-recording is the only route.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PREACTION_HOOK } from './dom-capture-source';
import {
  evidenceFor, evidenceForAssertionSubject, positionalExpression,
  sanitiseEvidence, targetByElementRef,
  type AssertionProvenance, type CandidateMeasurement, type DomEvidence,
  type RecordingEvidence, type TargetEvidence,
} from './dom-evidence';
import { assessLocator } from './locator-quality';
import { mapRecording, readAssertions } from './from-recording';
import {
  recordAssertionFromPicker, resolveAssertionProvenance,
} from '../dashboard/live-recorder';
import {
  assertionsPath, parseRecording, type Recording, type RecordedAssertion,
} from '../dashboard/recorder';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string): void => { process.stdout.write(`\n== ${title} ==\n`); };

/* ------------------------------------------------------------- a stub DOM */

/**
 * Enough DOM to run the real hook against: tags, ids, classes, text, descendant
 * selectors and - the whole point here - object identity.
 *
 * Deliberately the same shape as `clicked-target.fixture.ts`'s, because it exists for
 * the same reason: to let the in-page half be executed rather than read.
 */
class Node {
  tag: string;
  id: string;
  classList: string[];
  own: string;
  attributes: Array<{ name: string; value: string }> = [];
  children: Node[] = [];
  parentElement: Node | null = null;
  nodeType = 1;

  constructor(tag: string, options: { id?: string; classes?: string[]; text?: string;
    attributes?: Record<string, string>; } = {}) {
    this.tag = tag;
    this.id = options.id ?? '';
    this.classList = options.classes ?? [];
    this.own = options.text ?? '';
    if (options.id)
      this.attributes.push({ name: 'id', value: options.id });
    for (const [name, value] of Object.entries(options.attributes ?? {}))
      this.attributes.push({ name, value });
  }

  add(child: Node): Node {
    child.parentElement = this;
    this.children.push(child);
    return this;
  }

  /** Detach, the way a re-render does. The node survives; its place in the tree does not. */
  detach(): void {
    if (!this.parentElement)
      return;
    this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null;
  }

  get tagName(): string {
    return this.tag.toUpperCase();
  }

  get textContent(): string {
    return [this.own, ...this.children.map(child => child.textContent)]
        .join(' ').replace(/\s+/g, ' ').trim();
  }

  getAttribute(name: string): string | null {
    return this.attributes.find(entry => entry.name === name)?.value ?? null;
  }

  getBoundingClientRect(): { width: number; height: number; top: number; left: number;
    bottom: number; right: number; } {
    return { width: 10, height: 10, top: 0, left: 0, bottom: 10, right: 10 };
  }

  // Enough of the layout surface for the real capture to run: it reads all of these,
  // and a throw anywhere in it is swallowed by `remember` - which would leave the
  // press half of this fixture silently untested.
  get isConnected(): boolean {
    return true;
  }

  get title(): string {
    return this.getAttribute('title') ?? '';
  }

  scrollHeight = 0;
  clientHeight = 0;
  scrollWidth = 0;
  clientWidth = 0;

  get previousElementSibling(): Node | null {
    const siblings = this.parentElement?.children ?? [];
    const at = siblings.indexOf(this);
    return at > 0 ? siblings[at - 1] : null;
  }

  get nextElementSibling(): Node | null {
    const siblings = this.parentElement?.children ?? [];
    const at = siblings.indexOf(this);
    return at >= 0 && at + 1 < siblings.length ? siblings[at + 1] : null;
  }

  descendants(): Node[] {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }

  closest(): null {
    return null;
  }

  matchesCompound(compound: string): boolean {
    const parts = compound.match(/[#.]?[A-Za-z0-9_-]+/g) ?? [];
    return parts.every(part => {
      if (part.startsWith('#'))
        return this.id === part.slice(1);
      if (part.startsWith('.'))
        return this.classList.includes(part.slice(1));
      return part === '*' || this.tag === part;
    });
  }

  querySelectorAll(selector: string): Node[] {
    if (selector === '*')
      return this.descendants();
    const compounds = selector.trim().split(/\s+/);
    let scope: Node[] = [this];
    for (const compound of compounds) {
      const next: Node[] = [];
      for (const node of scope) {
        for (const candidate of node.descendants()) {
          if (candidate.matchesCompound(compound) && !next.includes(candidate))
            next.push(candidate);
        }
      }
      scope = next;
    }
    return scope;
  }
}

/** The issue list, as TC_DASHBOARD_023 recorded it: three rows, three identical ticks. */
function issueList(): { document: any; rows: Node[]; inputs: Node[]; spans: Node[] } {
  const rows: Node[] = [];
  const inputs: Node[] = [];
  const spans: Node[] = [];
  const summaries = [
    'first issue on the board',
    'second issue on the board',
    'login is not working in moolya aura SAM',
  ];
  const table = new Node('div', { id: 'bugReport-table', classes: ['tabulator-table'] });
  summaries.forEach((summary, index) => {
    const input = new Node('input', { id: String(1749550 + index), classes: ['bugChecked'],
      attributes: { type: 'checkbox', name: 'bugChecked' } });
    const span = new Node('span', { classes: ['rounded-checkbox-ui'] });
    const row = new Node('div', { id: `tr_${1749550 + index}`, classes: ['tabulator-row'] })
        .add(new Node('div', { classes: ['tabulator-cell'] }).add(input).add(span))
        .add(new Node('div', { classes: ['tabulator-cell'], text: summary }));
    table.add(row);
    rows.push(row);
    inputs.push(input);
    spans.push(span);
  });
  const body = new Node('body').add(table);
  const documentElement = new Node('html').add(body);
  return {
    document: {
      body, documentElement,
      querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    },
    rows, inputs, spans,
  };
}

/**
 * Install the GENERATED hook into a fake window and keep the listener it registers.
 *
 * The listener matters: `remember` is what parks a press, and it is reachable only
 * through `document.addEventListener`. Swallowing it - which is what every other
 * fixture that installs this hook does, because it needs only `__auraMeasure` - would
 * leave the press half of this mechanism untested.
 */
function installHook(document: any): { window: any; press: (element: Node, kind?: string) => any } {
  const listeners: Array<{ type: string; fn: (event: any) => void }> = [];
  const parked: any[] = [];
  const window: any = {
    innerWidth: 1280, innerHeight: 800,
    // Nothing here scrolls and nothing is hidden, which keeps the capture's
    // scrollable/virtualized judgements out of the way of what this fixture is about.
    getComputedStyle: () => ({ overflowY: 'visible', overflowX: 'visible',
      display: 'block', visibility: 'visible', opacity: '1' }),
  };
  window.__auraPark = (entry: any) => parked.push(entry);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', PREACTION_HOOK)(window, {
    ...document,
    addEventListener: (type: string, fn: (event: any) => void) => listeners.push({ type, fn }),
  });
  const press = (element: Node, kind = 'pointerdown'): any => {
    for (const listener of listeners) {
      if (listener.type === kind)
        listener.fn({ type: kind, target: element });
    }
    return parked[parked.length - 1];
  };
  return { window, press };
}

/**
 * A frame that runs a compiled in-page function the way Playwright's `evaluate` does.
 *
 * `SAME_ELEMENT_IN_PAGE` is `new Function('payload', '...window.__auraSameElement...')`,
 * so it resolves `window` from the global scope - which is what makes it a real test:
 * the fixture drives the same compiled string the recorder sends, not a copy of it.
 */
function frameFor(window: any, counts: Record<string, number> = {}): any {
  return {
    evaluate: async (fn: any, payload: any) => {
      const had = 'window' in globalThis;
      const previous = (globalThis as any).window;
      (globalThis as any).window = window;
      try {
        return fn(payload);
      } finally {
        if (had)
          (globalThis as any).window = previous;
        else
          delete (globalThis as any).window;
      }
    },
    // `countQuietly` builds a locator from the expression and counts it. Only the
    // count matters here, so the chain is answered by the table above; anything the
    // table does not name answers null, which is "not measured".
    locator: (selector: string) => ({
      count: async () => {
        if (!(selector in counts))
          throw new Error('not measured');
        return counts[selector];
      },
    }),
  };
}

/* -------------------------------------------------------- shared test data */

const CONTEXTUAL_BASE = 'page.locator(".tabulator-row").filter({ hasText: '
  + '"login is not working in moolya aura SAM" }).locator(".bugChecked")';

const positioned = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'container-text', expression: CONTEXTUAL_BASE, matchCount: 3,
  identityMatched: false, sameDocument: true, measuredAt: 'press',
  positionWithinCandidate: 2, ...over,
});

const provenUnique = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'container-text',
  expression: 'page.locator(".tabulator-row").filter({ hasText: "login is not working in '
    + 'moolya aura SAM" }).getByRole("checkbox")',
  matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press', ...over,
});

/** One recorded target, with a registration name unless one is refused. */
const target = (over: Partial<TargetEvidence> = {}): TargetEvidence => ({
  locator: 'page.locator(\'[id="1749552"]\')',
  elementRef: 'doc-press:7',
  target: { tag: 'input', id: '1749552', name: 'bugChecked', stableClasses: ['bugChecked'] },
  ancestors: [{ tag: 'div', id: 'bugReport-table', stableClasses: ['tabulator-table'] }],
  children: [], descendants: [], previousSiblings: [], nextSiblings: [], relationships: [],
  matchCount: 1, matchCountDocument: 'same', captureTiming: 'before-action',
  documentId: 'doc-press',
  identifier: { raw: '1749552', dynamic: true, normalised: '<dynamic>' },
  positionProvenCandidates: [positioned()],
  rejectedCandidates: [positioned({ rejectionReason: 'matched 3 elements' })],
  candidatesTried: 12,
  ...over,
} as unknown as TargetEvidence);

const evidenceOf = (...targets: TargetEvidence[]): RecordingEvidence => ({
  available: true, capturedAt: '2026-08-20T00:00:00.000Z',
  limits: {} as DomEvidence['limits'], targets,
} as unknown as RecordingEvidence);

const assertionOf = (over: Partial<RecordedAssertion> = {}): RecordedAssertion => ({
  type: 'checked', expected: true, target: '1749552',
  locator: 'page.locator(".bugChecked")', locatorStrategy: 'class', value: null,
  interactionTarget: 'page.locator(".rounded-checkbox-ui")', afterActions: 10,
  subjectProvenance: { refs: ['doc-press:7'], locatorMatchCount: 3 },
  ...over,
} as RecordedAssertion);

/** What the locator engine makes of one assertion, given the association. */
function judge(assertion: RecordedAssertion, evidence: RecordingEvidence) {
  const subject = evidenceForAssertionSubject(evidence, assertion);
  return {
    subject,
    verdict: assessLocator({
      locator: assertion.locator, target: assertion.target, kind: 'assertion',
      value: assertion.value, evidence: subject?.evidence ?? undefined,
    }),
  };
}

/* =========================================================================
   A - the in-page half, executed
   ========================================================================= */

function partA(): void {
  section('A - the in-page half: a name for a NODE, and identity for nothing else');

  const page = issueList();
  const { window, press } = installHook(page.document);

  const parked = press(page.inputs[2]);
  check('A1: a press is parked with a registration NAME, not only a slot',
      typeof parked.elementRef === 'string' && parked.elementRef.length > 0,
      String(parked.elementRef));
  check('A1: the name is the document nonce and the slot, so it cannot be read as an ordinal',
      parked.elementRef === `${window.__auraDocument}:${parked.targetIndex}`,
      `${parked.elementRef} vs ${window.__auraDocument}:${parked.targetIndex}`);

  // A SLOT NAMES THE NODE, NOT THE EVENT, and that is the TC_LOGIN_107 fix. Asking
  // again for the same live element returns the same slot, so its name exists from the
  // first moment anything looks at it - a press, or a person pointing at it.
  const pickSlot = window.__auraRegister(page.inputs[2]);
  check('A2: registering an already-registered node returns its existing slot',
      pickSlot === parked.targetIndex, `${pickSlot} vs ${parked.targetIndex}`);
  const same = window.__auraSameElement({ index: pickSlot, documentId: window.__auraDocument });
  check('A2: so the press and the pick answer with ONE name',
      same.sameDocument === true && same.targetPresent === true
      && same.refs.length === 1 && same.refs[0] === parked.elementRef,
      JSON.stringify(same.refs));

  // THE CASE THAT WAS BROKEN: a node nothing has ever pressed still has a name. Before
  // this, only the press queue was consulted, so an assertion made first came back with
  // an empty list and could not be tied to the element it was about.
  const neverPressed = window.__auraRegister(page.inputs[0]);
  const fresh = window.__auraSameElement({ index: neverPressed, documentId: window.__auraDocument });
  check('A3: a node with NO press has a name of its own',
      fresh.targetPresent === true && fresh.refs.length === 1
      && fresh.refs[0] === `${window.__auraDocument}:${neverPressed}`,
      JSON.stringify(fresh.refs));

  // A LOOK-ALIKE IS STILL NOT THE SAME ELEMENT. Same tag, same class, same name
  // attribute, same place in an identical row - and a different node, so a different
  // name. What must never happen is the two sharing one.
  const lookAlike = window.__auraRegister(page.inputs[1]);
  const other = window.__auraSameElement({ index: lookAlike, documentId: window.__auraDocument });
  check('A4: a look-alike in the sibling row gets a DIFFERENT name',
      other.refs.length === 1 && other.refs[0] !== same.refs[0]
      && !other.refs.includes(parked.elementRef), JSON.stringify(other.refs));
  check('A4: and neither list contains the name of the other',
      !same.refs.some((ref: string) => other.refs.includes(ref)));
  check('A4: three distinct nodes, three distinct names',
      new Set([same.refs[0], fresh.refs[0], other.refs[0]]).size === 3,
      [same.refs[0], fresh.refs[0], other.refs[0]].join(' | '));

  // ONE NODE, TWO PRESSES, still one name. pointerdown and focusin both fire on the
  // input a label forwards to; that is two events about one element, and the element is
  // what a name is for.
  const secondPress = press(page.inputs[2], 'focusin');
  const both = window.__auraSameElement({
    index: window.__auraRegister(page.inputs[2]), documentId: window.__auraDocument });
  check('A5: one node pressed twice still yields exactly one name',
      both.refs.length === 1 && both.refs[0] === parked.elementRef
      && secondPress.elementRef === parked.elementRef, JSON.stringify(both.refs));

  // A DIFFERENT DOCUMENT CANNOT BE ASKED. The registry is per document, so a nonce
  // from anywhere else is refused rather than answered against the wrong page.
  const elsewhere = window.__auraSameElement({ index: pickSlot, documentId: 'some-other-document' });
  check('A6: a question about another document is refused, not answered',
      elsewhere.sameDocument === false && elsewhere.refs.length === 0);

  const unknown = window.__auraSameElement({ index: 9999, documentId: window.__auraDocument });
  check('A6: an unregistered slot reports no target, never a default one',
      unknown.sameDocument === true && unknown.targetPresent === false
      && unknown.refs.length === 0);

  // STALE BY RELEASE. The registry holds 60 nodes and nulls the slot MAX ago; a node
  // whose slot has gone is registered afresh and gets a NEW name, and the old one must
  // not come back. Sixty DISTINCT nodes are needed to force a release now that
  // registering the same node twice allocates once.
  const staleDoc = issueList();
  const stale = installHook(staleDoc.document);
  const stalePress = stale.press(staleDoc.inputs[0]);
  for (let index = 0; index < 61; index++)
    stale.window.__auraRegister(new Node('div', { classes: [`filler-${index}`] }));
  const restaleSlot = stale.window.__auraRegister(staleDoc.inputs[0]);
  const staleAnswer = stale.window.__auraSameElement({
    index: restaleSlot, documentId: stale.window.__auraDocument });
  check('A7: a released slot is re-registered under a NEW name',
      restaleSlot !== stalePress.targetIndex, `${restaleSlot} vs ${stalePress.targetIndex}`);
  check('A7: and the released name never comes back',
      !staleAnswer.refs.includes(stalePress.elementRef), JSON.stringify(staleAnswer.refs));

  // THE THIRD DOOR: capture the surroundings of a registered node without pressing it.
  const observed = stale.window.__auraObserveSlot({
    index: restaleSlot, documentId: stale.window.__auraDocument });
  check('A8: a registered node can be captured with no interaction at all',
      Boolean(observed?.graph?.target)
      && observed.elementRef === `${stale.window.__auraDocument}:${restaleSlot}`,
      String(observed?.elementRef));
  check('A8: the capture is NOT parked as a press',
      stale.window.__auraPreAction.every((entry: any) => entry.targetIndex !== restaleSlot),
      `${stale.window.__auraPreAction.length} parked`);
  check('A8: a slot in another document cannot be captured',
      stale.window.__auraObserveSlot({ index: restaleSlot, documentId: 'elsewhere' }) === null);
  check('A8: nor can one that was never registered',
      stale.window.__auraObserveSlot({ index: 9999, documentId: stale.window.__auraDocument }) === null);

  // NOTHING BUT NAMES CROSSES. No node, no attribute, no text, no selector.
  const shape = JSON.stringify(both);
  check('A9: the answer carries names and flags only - no text, no selector, no node',
      !/bugChecked|tabulator|login is not working/.test(shape), shape.slice(0, 120));

  // THE FILE'S OWN HAZARD, checked on the GENERATED string rather than the source. An
  // unescaped backtick in dom-capture-source.ts ends the template literal and takes the
  // whole hook with it - naming remember() in backticks in a comment did exactly that
  // while this fix was being written, and every fixture that installs the hook went red
  // at once. Compiling the string is the only check that catches it, because the source
  // still looks perfectly reasonable.
  let compiles = '';
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', PREACTION_HOOK);
  } catch (error) {
    compiles = (error as Error).message;
  }
  check('A9: the generated hook is syntactically whole', compiles === '', compiles);
}

/* =========================================================================
   B - the recorder wiring
   ========================================================================= */

async function partB(): Promise<void> {
  section('B - the wiring: pick time is the only time this can be measured');

  const page = issueList();
  const { window, press } = installHook(page.document);
  const parked = press(page.inputs[2]);
  const pickSlot = window.__auraRegister(page.inputs[2]);

  // The payload the real picker sends: the pointer was on the decorated span, the
  // association resolver moves the subject to the input, and the input carries its own
  // registration because `associatedCandidates(element, true)` registered it.
  const payload = {
    capabilityId: 'checked',
    node: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
    state: { visible: true },
    candidates: [{
      // The relationship FixturePortal's tick actually presents: the span sits inside the
      // <label> that forwards to the hidden input, and the input carries its OWN
      // registration because `associatedCandidates(element, true)` registered it.
      relationship: 'label-ancestor' as const,
      node: { tag: 'input', type: 'checkbox', id: '1749552', stableClasses: ['bugChecked'] },
      state: { checked: true },
      via: { tag: 'label' },
      targetIndex: pickSlot,
    }],
    // The slot for the SPAN under the pointer. Deliberately not the subject's: if the
    // provenance ever came from here, it would name the wrong element.
    context: { documentId: window.__auraDocument, targetIndex: window.__auraRegister(page.spans[2]),
      ancestors: [] },
  };

  const frame = frameFor(window, { '.bugChecked': 3, '.rounded-checkbox-ui': 3 });
  const documentId = window.__auraDocument as string;
  const provenance = await resolveAssertionProvenance(
      frame, { documentId, slot: pickSlot }, 'page.locator(".bugChecked")');
  check('B1: provenance names the press that was on that very node',
      provenance !== null && provenance.refs.length === 1
      && provenance.refs[0] === parked.elementRef, JSON.stringify(provenance));
  check('B1: and it carries a count of the assertion\'s OWN locator',
      provenance?.locatorMatchCount === 3, String(provenance?.locatorMatchCount));

  // A count that cannot be taken is absent, never 1 and never 0.
  const unmeasured = await resolveAssertionProvenance(
      frame, { documentId, slot: pickSlot }, 'page.getByRole("checkbox")');
  check('B2: an uncountable locator carries null, not a number',
      unmeasured !== null && unmeasured.locatorMatchCount === null,
      String(unmeasured?.locatorMatchCount));

  // No registration - the page could not register it - and nothing proceeds on a
  // description instead.
  check('B3: no registration means no provenance',
      await resolveAssertionProvenance(frame, { documentId, slot: null },
          'page.locator(".bugChecked")') === null);

  // THE SEQUENCE, driven through the function the binding calls. Order is load-bearing
  // and silent when wrong: the assertion is still recorded and simply carries nothing.
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-')), 'live.spec.ts');
  fs.writeFileSync(outputFile, 'await page.goto("x");\nawait page.locator(".rounded-checkbox-ui").click();\n', 'utf8');
  const picked: RecordedAssertion[] = [];
  const outcome = await recordAssertionFromPicker(frame, payload as never, picked, outputFile);
  check('B4: the assertion is recorded', outcome.recorded === true, outcome.reason ?? '');
  check('B4: and it carries its provenance', picked.length === 1
      && picked[0].subjectProvenance?.refs[0] === parked.elementRef,
      JSON.stringify(picked[0]?.subjectProvenance));
  check('B4: measured against the locator that was actually recorded',
      picked[0].locator === 'page.locator(".bugChecked")'
      && picked[0].subjectProvenance?.locatorMatchCount === 3,
      `${picked[0]?.locator} @ ${picked[0]?.subjectProvenance?.locatorMatchCount}`);
  check('B4: the object never crosses the binding',
      !('assertion' in outcome), Object.keys(outcome).join(', '));

  // THE ELEMENT AN ASSERTION IS ABOUT IS NOT ALWAYS THE SUBJECT, and this is the case
  // that made the first version of this mechanism wrong. `Checked` belongs to the
  // control that holds the state; `Visible` belongs to what a person can actually see,
  // because a custom switch's subject is a 0x0 input the application deliberately
  // hides. Deriving the slot from the payload's subject named the INPUT for a `visible`
  // assertion recorded against the SPAN - one element's locator judged against another
  // element's evidence, which is exactly the wrong association this whole mechanism
  // exists to make impossible.
  const spanPress = press(page.spans[2]);
  const visible: RecordedAssertion[] = [];
  await recordAssertionFromPicker(
      frame, { ...payload, capabilityId: 'visible' } as never, visible, outputFile);
  check('B4b: a visibility assertion is recorded against what the pointer was on',
      visible[0]?.locator === 'page.locator(".rounded-checkbox-ui")', visible[0]?.locator);
  check('B4b: and its provenance names THAT element, not the associated control',
      visible[0]?.subjectProvenance?.refs.length === 1
      && visible[0]?.subjectProvenance?.refs[0] === spanPress.elementRef,
      `${JSON.stringify(visible[0]?.subjectProvenance)} vs span ${spanPress.elementRef}`);
  check('B4b: the two assertions resolve to two DIFFERENT registrations',
      visible[0]?.subjectProvenance?.refs[0] !== picked[0]?.subjectProvenance?.refs[0]);
  check('B4b: and the count is of the visibility locator, not the state one',
      visible[0]?.subjectProvenance?.locatorMatchCount === 3);

  // A frame that throws must not lose the assertion.
  const broken = { evaluate: async () => { throw new Error('context destroyed'); } };
  const second: RecordedAssertion[] = [];
  const survived = await recordAssertionFromPicker(broken as never, payload as never, second, outputFile);
  check('B5: a failed measurement still records the assertion, with no provenance',
      survived.recorded === true && second.length === 1
      && second[0].subjectProvenance === undefined);

  // ROUND TRIP. A field that does not survive persistence is a field that does not
  // exist - the evidence sidecar was written by a patch that silently did not apply,
  // and 46 green checks ran against a file the test had created itself.
  const id = 'TC_PROVENANCE_FIXTURE';
  const file = assertionsPath(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify(picked, null, 2), 'utf8');
    const back = readAssertions(id);
    check('B6: provenance survives the assertions sidecar',
        back?.[0].subjectProvenance?.refs[0] === parked.elementRef,
        JSON.stringify(back?.[0].subjectProvenance));

    // A malformed record must arrive as ABSENT, never as something to interpret.
    const cases: Array<[string, unknown]> = [
      ['refs is not an array', { refs: 'doc:1', locatorMatchCount: 3 }],
      ['refs is empty', { refs: [], locatorMatchCount: 3 }],
      ['the count is a string', { refs: ['doc:1'], locatorMatchCount: '3' }],
      ['the count is negative', { refs: ['doc:1'], locatorMatchCount: -1 }],
      ['the count is fractional', { refs: ['doc:1'], locatorMatchCount: 1.5 }],
      ['there are more names than the page could produce',
        { refs: Array.from({ length: 61 }, (_, index) => `doc:${index}`), locatorMatchCount: 3 }],
    ];
    for (const [why, value] of cases) {
      fs.writeFileSync(file, JSON.stringify([{ ...picked[0], subjectProvenance: value }], null, 2), 'utf8');
      const reloaded = readAssertions(id);
      check(`B7: refused - ${why}`,
          reloaded?.length === 1 && reloaded[0].subjectProvenance === undefined,
          JSON.stringify(reloaded?.[0].subjectProvenance));
      check(`B7: and the rest of the assertion is untouched - ${why}`,
          reloaded?.[0].type === 'checked' && reloaded?.[0].expected === true
          && reloaded?.[0].locator === 'page.locator(".bugChecked")');
    }
    // A count of null is VALID - it is the honest answer when the page could not be
    // counted - and must not be refused with the malformed ones.
    fs.writeFileSync(file, JSON.stringify([{ ...picked[0],
      subjectProvenance: { refs: ['doc:1'], locatorMatchCount: null } }], null, 2), 'utf8');
    check('B7: accepted - a null count is an answer, not a malformation',
        readAssertions(id)?.[0].subjectProvenance?.locatorMatchCount === null);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
  }
  check('B8: the fixture left no assertions sidecar behind', !fs.existsSync(file));
}

/* =========================================================================
   C - the association, and what it is allowed to carry over
   ========================================================================= */

function partC(): void {
  section('C - one target, or none, and only the facts that are about the element');

  const only = target();
  const found = targetByElementRef(evidenceOf(only), ['doc-press:7']);
  check('C1: a named registration finds its target', found.target === only, found.why);

  const missing = targetByElementRef(evidenceOf(only), ['doc-press:99']);
  check('C2: a name no target carries finds nothing, with a reason',
      missing.target === null && /never the subject of a recorded action/.test(missing.why),
      missing.why);

  // TWO ROWS, ONE ELEMENT. A click and a check on the same input write two lines and
  // claim two parked entries, so two graphs of one element are both true and were
  // taken at different moments. Refused, deliberately.
  const twice = targetByElementRef(
      evidenceOf(only, target({ elementRef: 'doc-press:8', locator: 'page.getByRole("checkbox")' })),
      ['doc-press:7', 'doc-press:8']);
  check('C3: two targets for one element are refused, not chosen between',
      twice.target === null && /decision for a person/.test(twice.why), twice.why);

  const noEvidence = targetByElementRef(undefined, ['doc-press:7']);
  check('C4: no evidence is said plainly', noEvidence.target === null
    && /no DOM evidence/.test(noEvidence.why), noEvidence.why);

  // A target with no registration name cannot be reached this way - an after-action
  // capture has no press behind it, so there is nothing to have named.
  const unnamed = targetByElementRef(
      evidenceOf(target({ elementRef: undefined })), ['doc-press:7']);
  check('C5: a target captured after the fact carries no name and is unreachable',
      unnamed.target === null);

  section('C - the projection is an allow-list');

  const projected = evidenceForAssertionSubject(evidenceOf(only), assertionOf());
  check('C6: the projection describes the assertion\'s OWN locator',
      projected?.evidence.locator === 'page.locator(".bugChecked")',
      String(projected?.evidence.locator));
  check('C7: matchCount is the picker\'s count of that locator, not Codegen\'s of another',
      projected?.evidence.matchCount === 3 && only.matchCount === 1,
      `${projected?.evidence.matchCount} vs ${only.matchCount}`);
  check('C8: the generated id is NOT carried - it describes an expression, not the element',
      projected?.evidence.identifier === undefined && only.identifier !== undefined);
  check('C9: every measured candidate IS carried - those are facts about the element',
      projected?.evidence.positionProvenCandidates?.length === 1
      && projected?.evidence.rejectedCandidates?.length === 1
      && projected?.evidence.candidatesTried === 12);
  check('C10: the graph is carried', projected?.evidence.target === only.target
    && projected?.evidence.ancestors === only.ancestors);
  check('C11: an absent count says unknown rather than naming a document',
      evidenceForAssertionSubject(evidenceOf(only),
          assertionOf({ subjectProvenance: { refs: ['doc-press:7'], locatorMatchCount: null } }))
          ?.evidence.matchCountDocument === 'unknown');
  check('C12: no provenance, no projection',
      evidenceForAssertionSubject(evidenceOf(only),
          assertionOf({ subjectProvenance: undefined })) === null);

  // The allow-list is the point: a field added to TargetEvidence must not travel until
  // somebody decides it is true of the element rather than of the expression.
  const future = { pressTimeText: undefined, someFutureField: 'x' } as unknown as Partial<TargetEvidence>;
  const invented = evidenceForAssertionSubject(evidenceOf(target(future)), assertionOf());
  check('C13: an unknown field does not travel',
      invented !== null && !('someFutureField' in invented.evidence),
      Object.keys(invented?.evidence ?? {}).join(','));
}

/* =========================================================================
   D - the ten cases
   ========================================================================= */

function partD(): void {
  section('D1 - the assertion is about the element the previous action touched');

  const one = judge(assertionOf(), evidenceOf(target()));
  check('D1: the association is made', one.subject !== null, one.subject?.why ?? 'none');
  check('D1: the ambiguity is MEASURED, so the position is consulted',
      one.verdict.strategy === 'evidence-backed-position', one.verdict.strategy);
  check('D1: and the locator is the proven contextual base with the measured index',
      one.verdict.expression === `${CONTEXTUAL_BASE}.nth(2)`, String(one.verdict.expression));
  check('D1: emitted, not refused', one.verdict.outcome === 'NORMALIZED_LOCATOR', one.verdict.outcome);

  section('D2 - the assertion is about a DIFFERENT element from the last action');

  // Two targets, two registrations. The assertion names the SECOND one, and the
  // recording order says nothing about which.
  const clicked = target({
    elementRef: 'doc-press:3', locator: 'page.getByText("sample")',
    target: { tag: 'span', stableClasses: ['title'] } as never,
    positionProvenCandidates: [positioned({ expression: 'page.locator("#all_apps .title")' })],
  });
  const asserted = target();
  const two = judge(assertionOf(), evidenceOf(clicked, asserted));
  check('D2: the later target is chosen by identity, not by being last or nearest',
      two.subject?.evidence.target === asserted.target, JSON.stringify(two.subject?.evidence.target));
  check('D2: and the locator comes from THAT element\'s candidates',
      two.verdict.expression === `${CONTEXTUAL_BASE}.nth(2)`, String(two.verdict.expression));
  // The same assertion, pointed at the other registration, must resolve elsewhere -
  // proof that the ref decides and nothing else does.
  const crossed = judge(
      assertionOf({ subjectProvenance: { refs: ['doc-press:3'], locatorMatchCount: 3 } }),
      evidenceOf(clicked, asserted));
  check('D2: naming the other registration resolves to the other element',
      crossed.verdict.expression === 'page.locator("#all_apps .title").nth(2)',
      String(crossed.verdict.expression));

  section('D3 - the assertion\'s own locator matches several elements');

  check('D3: a measured count above one is an ambiguity, however the locator was composed',
      judge(assertionOf({ subjectProvenance: { refs: ['doc-press:7'], locatorMatchCount: 7 } }),
          evidenceOf(target())).verdict.strategy === 'evidence-backed-position');
  // And with nothing measured to settle it, the answer is a person.
  const nothing = judge(assertionOf(),
      evidenceOf(target({ positionProvenCandidates: [] })));
  check('D3: ambiguous with nothing proven is NEEDS_REVIEW, never .first()',
      nothing.verdict.outcome === 'NEEDS_REVIEW' && nothing.verdict.expression === null,
      nothing.verdict.outcome);
  check('D3: and the refusal says what was measured',
      /12 alternative\(s\)/.test(nothing.verdict.reason), nothing.verdict.reason.slice(0, 90));
  // A count of exactly one is a locator. Nothing is "improved".
  const unique = judge(assertionOf({ subjectProvenance: { refs: ['doc-press:7'], locatorMatchCount: 1 } }),
      evidenceOf(target()));
  check('D3: a locator the browser counted at ONE is emitted as itself',
      unique.verdict.expression === 'page.locator(".bugChecked")'
      && unique.verdict.outcome !== 'NEEDS_REVIEW',
      `${unique.verdict.outcome} ${unique.verdict.expression}`);

  section('D4 - a generated-id action with a contextually proven assertion');

  const four = judge(assertionOf(), evidenceOf(target({
    derivedCandidates: [provenUnique()], positionProvenCandidates: [positioned()],
  })));
  check('D4: a PROVEN UNIQUE candidate wins outright - position is never consulted',
      four.verdict.strategy === 'disambiguated-by-clicked-target', four.verdict.strategy);
  check('D4: and it is the measured expression, not an index',
      four.verdict.expression === provenUnique().expression, String(four.verdict.expression));
  check('D4: the action\'s generated id did not drag the assertion anywhere',
      four.verdict.dynamic === null, JSON.stringify(four.verdict.dynamic));

  section('D5 - a positional action and a positional assertion');

  // The action's own row is unchanged: it keeps its own key and its own judgement.
  const positionalAction = target({
    locator: "page.locator('.rounded-checkbox-ui').first()",
    identifier: undefined,
    positionProvenCandidates: [positioned({
      expression: 'page.locator("#bugReport-table .rounded-checkbox-ui")', strategy: 'scoped-class',
    })],
  });
  const actionVerdict = assessLocator({
    locator: positionalAction.locator, target: 'tick', kind: 'action', evidence: positionalAction,
  });
  check('D5: the action recovers its own measured index',
      actionVerdict.expression === 'page.locator("#bugReport-table .rounded-checkbox-ui").nth(2)',
      String(actionVerdict.expression));
  const five = judge(assertionOf(), evidenceOf(target()));
  check('D5: and the assertion recovers its own, from its own candidate family',
      five.verdict.expression === `${CONTEXTUAL_BASE}.nth(2)`, String(five.verdict.expression));
  check('D5: two different expressions, each proven for its own element',
      actionVerdict.expression !== five.verdict.expression);

  section('D6 - no valid provenance');

  const six = judge(assertionOf({ subjectProvenance: undefined }), evidenceOf(target()));
  check('D6: nothing is adopted', six.subject === null);
  // WHAT PROVENANCE BUYS, stated as the contrast it is. Without it the assertion has
  // nothing but a bare class and no attributable measurement, and the structural gate
  // added for TC_LOGIN_128 refuses that shape - the same shape that was emitted for
  // TC_DASHBOARD_023 and failed strict mode on three elements. This used to assert the
  // emission (`css`, `.bugChecked`); refusing is strictly safer and leaves the contrast
  // sharper, because the linked case above resolves and this one cannot.
  check('D6: and with no provenance there is nothing safe to emit',
      six.verdict.expression === null && six.verdict.outcome === 'NEEDS_REVIEW',
      `${six.verdict.strategy} ${six.verdict.expression}`);
  // A ref that names nothing is the same answer, and it must not fall back to
  // "the only target there is".
  const stray = judge(assertionOf({ subjectProvenance: { refs: ['doc-press:404'], locatorMatchCount: 3 } }),
      evidenceOf(target()));
  check('D6: a ref that matches nothing never falls back to the nearest target',
      stray.subject === null && stray.verdict.expression === null,
      `subject=${stray.subject} expression=${stray.verdict.expression}`);

  section('D7 - action and assertion keep their roles');

  const roleEvidence = evidenceOf(target());
  const withProvenance = mapRecording(recordingWith(assertionOf(), roleEvidence));
  const withoutProvenance = mapRecording(
      recordingWith(assertionOf({ subjectProvenance: undefined }), roleEvidence));
  const actionCode = (result: ReturnType<typeof mapRecording>) =>
    result.steps.filter(step => step.from.startsWith('click')).flatMap(step => step.code).join('\n');
  check('D7: the assertion\'s provenance changes no action step',
      actionCode(withProvenance) === actionCode(withoutProvenance),
      actionCode(withProvenance).slice(0, 80));
  const assertionSteps = withProvenance.steps.filter(step => step.from.startsWith('assert'));
  check('D7: the assertion is emitted as an assertion, never as an action',
      assertionSteps.length === 1 && assertionSteps[0].code.every(line => line.includes('expect(')),
      assertionSteps[0]?.code.join(' '));
  check('D7: and it is the positional expression, with its index',
      assertionSteps[0].code.join('').includes(`${CONTEXTUAL_BASE}.nth(2)`),
      assertionSteps[0]?.code.join(''));
  check('D7: the log says the evidence was found by provenance rather than by locator',
      /found by provenance/.test(assertionSteps[0].why), assertionSteps[0]?.why.slice(0, 110));
  // An assertion may not be resolved to the very text it checks for, provenance or not.
  const tautology = judge(
      assertionOf({ type: 'contains', value: 'Faclon labs',
        locator: 'page.getByText("Faclon labs")' }),
      evidenceOf(target({
        target: { tag: 'span', text: 'Faclon labs', stableClasses: ['title'] } as never,
        identifier: undefined, positionProvenCandidates: [], rejectedCandidates: [],
        candidatesTried: 0,
      })));
  check('D7: an unmeasured bare-text assertion is still refused by the strict-mode gate',
      tautology.verdict.outcome === 'NEEDS_REVIEW', tautology.verdict.outcome);

  section('D8 - a wrong association is impossible to record, not merely unlikely');

  // The protection is Part A3 - the page cannot produce a ref for a look-alike. Here
  // is the other half: a ref names one registration, so it cannot name two elements.
  const twoElements = evidenceOf(
      target(),
      target({ elementRef: 'doc-press:9', locator: 'page.getByText("sample")',
        target: { tag: 'span', stableClasses: ['title'] } as never }));
  const resolved = targetByElementRef(twoElements, ['doc-press:7']);
  check('D8: a name resolves to exactly one row even when two rows exist',
      resolved.target?.locator === 'page.locator(\'[id="1749552"]\')', resolved.why);
  check('D8: and a name shared by two rows resolves to neither',
      targetByElementRef(evidenceOf(target(), target({ locator: 'page.getByText("x")' })),
          ['doc-press:7']).target === null);

  section('D9 - a stale association');

  // The recording says the element was pressed; the row it names is an after-action
  // capture of something that had already gone. Nothing can be adopted from it.
  const staleTarget = target({
    captureTiming: 'after-action', matchCount: 0,
    target: { tag: '(not found)' } as never,
    identifier: undefined, positionProvenCandidates: [], rejectedCandidates: [], candidatesTried: 0,
  });
  const nine = judge(assertionOf(), evidenceOf(staleTarget));
  check('D9: a graph of an element that had gone yields no locator',
      nine.verdict.outcome === 'NEEDS_REVIEW' || nine.verdict.expression === 'page.locator(".bugChecked")',
      `${nine.verdict.outcome} ${nine.verdict.expression}`);
  check('D9: and nothing was invented from it',
      nine.verdict.expression === null || !/nth\(/.test(String(nine.verdict.expression)),
      String(nine.verdict.expression));
  // The in-page half is where staleness is actually caught - see A7.
  check('D9: staleness by slot release is refused in the page (A7)', true);

  section('D10 - a dynamic-id target');

  // The subject's id is generated. The projection drops it, so a clean assertion
  // locator is judged on its own merits...
  const ten = judge(assertionOf({
    locator: 'page.getByRole("checkbox", { name: "Select issue" })', locatorStrategy: 'role-name',
    subjectProvenance: { refs: ['doc-press:7'], locatorMatchCount: 1 },
  }), evidenceOf(target()));
  check('D10: a role-and-name assertion is NOT downgraded by the element\'s generated id',
      ten.verdict.expression === 'page.getByRole("checkbox", { name: "Select issue" })',
      String(ten.verdict.expression));
  check('D10: and no index is introduced',
      !/nth\(/.test(String(ten.verdict.expression)), String(ten.verdict.expression));
  // ...while a generated id IN THE ASSERTION'S OWN LOCATOR is still refused.
  const carried = judge(assertionOf({
    locator: 'page.locator(\'[id="1749552"]\')', locatorStrategy: 'css',
    subjectProvenance: { refs: ['doc-press:7'], locatorMatchCount: 1 },
  }), evidenceOf(target()));
  check('D10: a generated id the assertion itself carries is still refused',
      carried.verdict.strategy === 'evidence-backed-position'
      || carried.verdict.outcome === 'NEEDS_REVIEW',
      `${carried.verdict.outcome} / ${carried.verdict.strategy}`);
  check('D10: and the id never reaches the emitted expression',
      !String(carried.verdict.expression ?? '').includes('1749552'),
      String(carried.verdict.expression));
}

/** A minimal recording: one click, one assertion, and the evidence for both. */
function recordingWith(assertion: RecordedAssertion, evidence: RecordingEvidence): Recording {
  return {
    startUrl: 'https://portal.fixture.invalid/', browser: 'chromium', evidence,
    authentication: { detected: false } as never,
    actions: [{
      type: 'click', target: 'tick',
      locator: 'page.locator("#bugReport-table .rounded-checkbox-ui").nth(2)',
      locatorStrategy: 'locator', value: null,
    }],
    assertions: [assertion],
    metrics: {
      recordingActionCount: 1, collapsedFills: 0, assertionCount: 1, durationMs: 0,
      redactedValues: 0, aiCalls: 0, aiInputTokens: 0, aiOutputTokens: 0,
    },
  } as unknown as Recording;
}

/* =========================================================================
   F - TC_DASHBOARD_023, replayed from its own measurements
   ========================================================================= */

function partF(): void {
  section('F - authored positional evidence through the parser and mapper');
  const captured = evidenceOf(target());
  const assertion = assertionOf({ afterActions: 0 });
  const source = "import { test, expect } from '@playwright/test';\ntest('synthetic provenance', async ({ page }) => {});";
  const map = (linked: boolean) => mapRecording(parseRecording(source, {
    startUrl: '', browser: '', durationMs: 0, evidence: captured,
    stateAssertions: [{ ...assertion, subjectProvenance: linked ? assertion.subjectProvenance : undefined }],
  } as never));
  const linked = map(true).steps.find(s => s.from.startsWith('assert'));
  check('F: the assembler consumes the subject-specific measured position',
      linked?.code.join('') === `await expect(${CONTEXTUAL_BASE}.nth(2)).toBeChecked();`, linked?.code.join(''));
  const unlinked = map(false).steps.find(s => s.from.startsWith('assert'));
  check('F: removing provenance prevents an assertion locator from being emitted',
      unlinked?.kind === 'needs-review' && unlinked.code.length === 0);
  check('F: mapping never fabricates provenance in the input',
      (captured as DomEvidence).targets[0].elementRef === 'doc-press:7');
}


/* =========================================================================
   H - TC_LOGIN_107: assert(A), click(A), assert(A)
   ========================================================================= */

/**
 * Drive the real pick sequence over the stub DOM and hand back what came out.
 *
 * Everything here is the production path: the generated hook, the real registry, the
 * real `recordAssertionFromPicker`, the real capture and the real measurement. The only
 * things the fixture supplies are the page and the counts a browser would return.
 */
function pickerRun(): {
  window: any;
  page: ReturnType<typeof issueList>;
  frame: any;
  outputFile: string;
  picked: RecordedAssertion[];
  captures: Map<string, TargetEvidence>;
  press: (element: any, kind?: string) => any;
  assertOn: (index: number, capability: string, checked: boolean) => Promise<void>;
} {
  const page = issueList();
  const installed = installHook(page.document);
  const window = installed.window;
  // The counts a real browser would return for the shapes this DOM produces. Three
  // checkboxes, three ticks, so every class shape is ambiguous - which is exactly the
  // TC_LOGIN_107 situation and the reason a position is needed at all.
  const frame = frameFor(window, {
    '.bugChecked': 3, '.rounded-checkbox-ui': 3, '#bugReport-table .bugChecked': 3,
  });
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'provenance-h-')), 'live.spec.ts');
  fs.writeFileSync(outputFile, 'await page.goto("x");\n', 'utf8');
  const picked: RecordedAssertion[] = [];
  const captures = new Map<string, TargetEvidence>();

  /**
   * Point at the span of row `index` and assert about the control it forwards to.
   *
   * `checked` reports what the box reads AT THIS MOMENT - false before the click, true
   * after - because that is what the picker sends and the scenario is only honest if the
   * two assertions really are claims about two different states.
   */
  const assertOn = async (index: number, capability: string, checked: boolean): Promise<void> => {
    const subjectSlot = window.__auraRegister(page.inputs[index]);
    const pointerSlot = window.__auraRegister(page.spans[index]);
    await recordAssertionFromPicker(frame, {
      capabilityId: capability,
      node: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
      state: { visible: true },
      candidates: [{
        relationship: 'label-ancestor' as const,
        node: { tag: 'input', type: 'checkbox', id: String(1749550 + index),
          stableClasses: ['bugChecked'] },
        state: { checked },
        via: { tag: 'label' },
        targetIndex: subjectSlot,
      }],
      context: { documentId: window.__auraDocument, targetIndex: pointerSlot, ancestors: [] },
    } as never, picked, outputFile, undefined, captures);
  };

  return { window, page, frame, outputFile, picked, captures, press: installed.press, assertOn };
}

async function partH(): Promise<void> {
  section('H - assert(A), click(A), assert(A): one element, two claims, two instants');

  const run = pickerRun();
  // 1. Assert the box is NOT ticked. Nothing has been clicked; before this fix there
  //    was no press to borrow an evidence row from, so this assertion got none.
  await run.assertOn(0, 'unchecked', false);
  // 2. Click it. The press parks its own graph, exactly as it always did.
  const pressed = run.press(run.page.inputs[0]);
  // 3. Assert it IS ticked.
  await run.assertOn(0, 'checked', true);

  check('H1: both assertions were recorded', run.picked.length === 2,
      String(run.picked.length));
  const [first, second] = run.picked;

  // REQUIREMENT 1: the same DOM node yields the same elementRef, whether or not
  // anything has been pressed on it yet.
  check('H2: the FIRST assertion has provenance at all',
      Boolean(first.subjectProvenance), JSON.stringify(first.subjectProvenance));
  check('H2: both assertions name the SAME element',
      first.subjectProvenance?.refs[0] === second.subjectProvenance?.refs[0]
      && (first.subjectProvenance?.refs.length ?? 0) === 1,
      `${first.subjectProvenance?.refs[0]} vs ${second.subjectProvenance?.refs[0]}`);
  check('H2: and that name is the node\'s registration, which the press reused',
      first.subjectProvenance?.refs[0] === pressed.elementRef,
      `${first.subjectProvenance?.refs[0]} vs press ${pressed.elementRef}`);

  // REQUIREMENT 5: each assertion carries evidence measured at ITS OWN pick, not the
  // other's and not the press's.
  check('H3: each assertion names its own capture',
      Boolean(first.subjectProvenance?.captureRef) && Boolean(second.subjectProvenance?.captureRef)
      && first.subjectProvenance?.captureRef !== second.subjectProvenance?.captureRef,
      `${first.subjectProvenance?.captureRef} vs ${second.subjectProvenance?.captureRef}`);
  check('H3: two captures were filed, one per assertion', run.captures.size === 2,
      String(run.captures.size));
  check('H3: both captures are about the same element',
      new Set([...run.captures.values()].map(entry => entry.elementRef)).size === 1,
      [...run.captures.values()].map(entry => entry.elementRef).join(' | '));
  check('H3: each capture is stamped as an assertion pick, never as an action',
      [...run.captures.values()].every(entry => entry.captureTiming === 'assertion-pick'));
  check('H3: and measured at the pick, never claimed to be a press',
      [...run.captures.values()].every(entry =>
        (entry.positionProvenCandidates ?? []).every(candidate => candidate.measuredAt === 'pick')));

  // The pick captures must NOT be reachable by locator string - two different elements
  // routinely compose the same expression.
  const evidence = evidenceOf(...run.captures.values());
  check('H4: a pick capture carries no locator expression at all',
      [...run.captures.values()].every(entry => !entry.locator.startsWith('page.')),
      [...run.captures.values()].map(entry => entry.locator).join(' | '));
  check('H4: a pick capture is invisible to the locator join',
      evidenceFor(evidence, 'page.locator(".bugChecked")') === null);
  // TWO INDEPENDENT GUARDS, and this proves the second one on its own. Above, the row
  // simply has no locator to match. Here it is given the very expression both
  // assertions composed - what a careless change would do - and it must STILL be
  // unreachable by string, because `captureTiming` is what excludes it.
  const disguised = evidenceOf(...[...run.captures.values()]
      .map(entry => ({ ...entry, locator: 'page.locator(".bugChecked")' })));
  check('H4: and still invisible when given a real-looking locator',
      evidenceFor(disguised, 'page.locator(".bugChecked")') === null);
  check('H4: and invisible to the node-identity lookup, which only answers for actions',
      targetByElementRef(evidence, first.subjectProvenance?.refs ?? []).target === null);
  check('H4: it is reached by its own capture name and nothing else',
      evidenceForAssertionSubject(evidence, first)?.evidence.captureRef
        === first.subjectProvenance?.captureRef);

  // REQUIREMENT 2 and 4: a deterministic locator for that exact element, from a
  // measured index - not from the bare fact that .bugChecked matches three.
  const verdict = assessLocator({
    locator: first.locator, target: first.target, kind: 'assertion', value: null,
    evidence: evidenceForAssertionSubject(evidence, first)?.evidence,
  });
  // THIS ELEMENT'S ROW TEXT IS UNIQUE, so the capture also measured a row-scoped
  // candidate at ONE element with identity matched. It used to be invisible to every
  // consumer for saying `pick`, and the assertion fell to the index below; now the
  // hierarchy settles it where it should be settled, and positional recovery stays what
  // it is called - the LAST deterministic resort. The positional path is exercised
  // immediately below, on the element that genuinely needs it.
  check('H5: the first assertion is settled by its pick-proven unique candidate',
      verdict.strategy === 'disambiguated-by-clicked-target', verdict.strategy);
  check('H5: to the row-scoped expression, with no index at all',
      String(verdict.expression).includes('.bugChecked')
      && /\.tabulator-row/.test(String(verdict.expression))
      && !/\.nth\(|\.first\(|\.last\(/.test(String(verdict.expression)), String(verdict.expression));
  // REQUIREMENT 3: never the generated id.
  check('H6: the locator does not depend on the generated id',
      !/1749550|1749553/.test(String(verdict.expression)), String(verdict.expression));

  // AND THE POSITIONAL PATH, on the same capture with its unique candidate withheld -
  // which is the shape of a row whose text is NOT unique (TC_LOGIN_122's real case).
  // The index must still be the one the browser MEASURED, never the match count.
  const capture = run.captures.get(first.subjectProvenance!.captureRef!)!;
  const withoutUnique = evidenceForAssertionSubject(
      evidenceOf({ ...capture, derivedCandidates: [] }), first)?.evidence;
  const positional = assessLocator({
    locator: first.locator, target: first.target, kind: 'assertion', value: null,
    evidence: withoutUnique,
  });
  check('H6: with nothing proven unique it still recovers by the measured index',
      positional.strategy === 'evidence-backed-position'
      && /\.nth\(0\)$/.test(String(positional.expression)), String(positional.expression));
  const source = (capture.positionProvenCandidates ?? []).find(candidate =>
    positionalExpression(candidate) === positional.expression);
  check('H6: the index is a measurement, not the match count',
      source?.positionWithinCandidate === 0 && source?.matchCount === 3
      && source?.measuredAt === 'pick', JSON.stringify(source));

  // An ACTION may still never use a pick-time position. The timing asymmetry is the
  // safety gate, and it has to hold in the direction that matters.
  const asAction = assessLocator({
    locator: first.locator, target: first.target, kind: 'action', value: null,
    evidence: evidenceForAssertionSubject(evidence, first)?.evidence,
  });
  check('H7: the SAME evidence gives an action no position at all',
      asAction.strategy !== 'evidence-backed-position'
      && !/nth\(/.test(String(asAction.expression ?? '')),
      `${asAction.strategy} ${asAction.expression}`);

  // THROUGH THE REAL FUNNEL, because that is the boundary that writes the file and the
  // place this project has lost a measured fact twice. `evidenceOf` above builds the
  // shape by hand, which cannot see a filter that drops the very thing being tested:
  // `sanitiseEvidence` used to admit only press-proven positions, so a pick-proven one
  // would have been measured, carried, judged - and then silently dropped on the way to
  // disk, leaving a recording that looked exactly like one made before the mechanism.
  const funnelled = sanitiseEvidence([...run.captures.values()], '2026-08-20T00:00:00.000Z');
  check('H7b: a pick capture survives the redaction funnel',
      funnelled.targets.length === 2
      && funnelled.targets.every(entry => entry.captureTiming === 'assertion-pick'),
      String(funnelled.targets.length));
  check('H7b: with its capture name, so the assertion can still find it',
      funnelled.targets.every(entry => typeof entry.captureRef === 'string' && entry.captureRef),
      funnelled.targets.map(entry => entry.captureRef).join(' | '));
  check('H7b: and its pick-time position, which the funnel used to drop',
      funnelled.targets.every(entry =>
        (entry.positionProvenCandidates ?? []).some(candidate =>
          candidate.measuredAt === 'pick' && candidate.positionWithinCandidate === 0)),
      funnelled.targets.map(entry => (entry.positionProvenCandidates ?? []).length).join(' | '));
  check('H7b: the funnelled evidence resolves to the same locator as the unfunnelled',
      String(assessLocator({
        locator: first.locator, target: first.target, kind: 'assertion', value: null,
        evidence: evidenceForAssertionSubject(funnelled, first)?.evidence,
      }).expression) === String(verdict.expression));

  // THROUGH THE ASSEMBLER, because a verdict that is right and then not used is the
  // defect this file exists to catch. The recorded script is TC_LOGIN_107's shape: an
  // assertion, a click on the same element, another assertion.
  const script = 'import { test, expect } from \'@playwright/test\';\n\n'
    + 'test(\'test\', async ({ page }) => {\n'
    + '  await page.goto(\'https://portal.fixture.invalid/\');\n'
    + '  await page.locator(\'ba-aura-assert\').click();\n'
    + '  await page.locator(\'.rounded-checkbox-ui\').first().click();\n'
    + '  await page.locator(\'ba-aura-assert\').click();\n'
    + '});';
  const mapped = mapRecording(parseRecording(script, {
    startUrl: 'https://portal.fixture.invalid/', browser: 'chromium', durationMs: 0,
    evidence, stateAssertions: run.picked,
  } as never));
  const emitted = mapped.steps.filter(step => step.from.startsWith('assert'))
      .map(step => step.code.join(''));
  check('H8: both assertions reach the spec', emitted.length === 2, String(emitted.length));
  // BOTH LINES NAME THE SAME ELEMENT BY THE SAME MEANS, and it is the strongest means
  // the evidence supports: the row the person can read. A Page Object reaching that
  // expression is better still and is what the corpus does - either is accepted here,
  // because what this pins is the ELEMENT and the polarity, not which layer names it.
  const namesOneRow = (line: string) =>
    /issueCheckboxState\(|\.tabulator-row/.test(line) && !/\.first\(|\.last\(/.test(line);
  check('H8: the FIRST asserts the negative on a scoped locator for that row',
      namesOneRow(emitted[0] ?? '') && /\.not\.toBeChecked\(\);$/.test(emitted[0] ?? ''),
      emitted[0] ?? 'none');
  check('H8: the SECOND asserts the positive on the same element',
      namesOneRow(emitted[1] ?? '') && /(?<!not)\.toBeChecked\(\);$/.test(emitted[1] ?? ''),
      emitted[1] ?? 'none');
  check('H8: neither line contains a bare .bugChecked with no scope or index',
      !emitted.some(line => line.includes('expect(page.locator(".bugChecked"))')),
      emitted.join(' | '));
  check('H8: and neither carries a generated id',
      !emitted.some(line => /17495\d\d/.test(line)), emitted.join(' | '));

  fs.rmSync(path.dirname(run.outputFile), { recursive: true, force: true });
}

/* =========================================================================
   I - assert(A), assert(B): same structural locator, different elements
   ========================================================================= */

async function partI(): Promise<void> {
  section('I - two elements that compose the SAME locator are still told apart');

  const run = pickerRun();
  await run.assertOn(0, 'checked', true);
  await run.assertOn(2, 'checked', true);

  const [onA, onB] = run.picked;
  check('I1: both assertions composed the identical locator',
      onA.locator === onB.locator && onA.locator === 'page.locator(".bugChecked")',
      `${onA.locator} vs ${onB.locator}`);
  check('I2: and provenance still names two DIFFERENT elements',
      onA.subjectProvenance?.refs[0] !== onB.subjectProvenance?.refs[0],
      `${onA.subjectProvenance?.refs[0]} vs ${onB.subjectProvenance?.refs[0]}`);
  check('I2: with a capture each', run.captures.size === 2, String(run.captures.size));

  const evidence = evidenceOf(...run.captures.values());
  const forA = evidenceForAssertionSubject(evidence, onA);
  const forB = evidenceForAssertionSubject(evidence, onB);
  check('I3: each resolves to its own capture',
      forA?.evidence.captureRef === onA.subjectProvenance?.captureRef
      && forB?.evidence.captureRef === onB.subjectProvenance?.captureRef
      && forA?.evidence.captureRef !== forB?.evidence.captureRef);
  check('I3: and to its own element',
      forA?.evidence.target.id === '1749550' && forB?.evidence.target.id === '1749552',
      `${forA?.evidence.target.id} vs ${forB?.evidence.target.id}`);

  const locatorFor = (assertion: RecordedAssertion) => String(assessLocator({
    locator: assertion.locator, target: assertion.target, kind: 'assertion', value: null,
    evidence: evidenceForAssertionSubject(evidence, assertion)?.evidence,
  }).expression);
  const a = locatorFor(onA);
  const b = locatorFor(onB);
  check('I4: two identical composed locators become two DIFFERENT resolved locators',
      a !== b, `${a}\n         vs ${b}`);
  // ONE OF EACH, AND THE DIFFERENCE IS THE APPLICATION'S DATA, not the mechanism.
  // A's row text is unique, so it is settled outright; B's is a substring of another
  // row's, so nothing identifies it alone and the measured index is correct for it.
  // This is exactly the TC_LOGIN_123 / TC_LOGIN_122 distinction, in one stub.
  check('I4: each is settled on its OWN row, by its own pick-proven candidate',
      /first issue on the board/.test(a) && /login is not working/.test(b), `${a} | ${b}`);
  check('I4: and neither needs an index, because in this DOM each row names itself',
      !/\.nth\(/.test(a) && !/\.nth\(/.test(b), `${a} | ${b}`);

  // THE INDEX PATH, STILL TOLD APART. Withhold both unique candidates - the shape of
  // rows whose text does not identify them, which is TC_LOGIN_122's real case - and the
  // two must still resolve to two different elements, by the two measured indices.
  const indexedEvidence = evidenceOf(...[...run.captures.values()]
      .map(entry => ({ ...entry, derivedCandidates: [] })));
  const indexed = (assertion: RecordedAssertion) => String(assessLocator({
    locator: assertion.locator, target: assertion.target, kind: 'assertion', value: null,
    evidence: evidenceForAssertionSubject(indexedEvidence, assertion)?.evidence,
  }).expression);
  check('I4: with nothing unique to stand on, each ends in its own measured index',
      /\.nth\(0\)$/.test(indexed(onA)) && /\.nth\(2\)$/.test(indexed(onB)),
      `${indexed(onA)} | ${indexed(onB)}`);
  check('I4: and neither carries a generated id',
      !/17495\d\d/.test(a) && !/17495\d\d/.test(b), `${a} | ${b}`);

  fs.rmSync(path.dirname(run.outputFile), { recursive: true, force: true });
}

/* =========================================================================
   J - the mutation tests: break the association, the fixture must notice
   ========================================================================= */

async function partJ(): Promise<void> {
  section('J - mutating the captured element must turn H and I red');

  const run = pickerRun();
  await run.assertOn(0, 'checked', true);
  await run.assertOn(2, 'checked', true);
  const [onA, onB] = run.picked;
  const evidence = evidenceOf(...run.captures.values());
  const resolve = (assertion: RecordedAssertion, from: RecordingEvidence) => assessLocator({
    locator: assertion.locator, target: assertion.target, kind: 'assertion', value: null,
    evidence: evidenceForAssertionSubject(from, assertion)?.evidence,
  });

  const honest = String(resolve(onA, evidence).expression);
  check('J1: unmutated, A resolves to its OWN row, by its own unique candidate',
      /first issue on the board/.test(honest) && !/\.nth\(/.test(honest), honest);

  // MUTATION 1 - SWAP. Point A's provenance at B's capture. The locator must change,
  // which is what proves the association is doing the work rather than the locator
  // shape or the match count.
  const swapped = resolve({ ...onA,
    subjectProvenance: { ...onA.subjectProvenance!, captureRef: onB.subjectProvenance!.captureRef },
  } as RecordedAssertion, evidence);
  check('J2: swapping the captured element changes the locator',
      String(swapped.expression) !== honest,
      `${swapped.expression} vs ${honest}`);
  check('J2: to the OTHER element - named by ITS row, never by the one A is about',
      /login is not working/.test(String(swapped.expression))
      && !/first issue on the board/.test(String(swapped.expression)), String(swapped.expression));

  // MUTATION 2 - REMOVE the capture from the evidence. No capture, no position: the
  // assertion must fall back, never invent one.
  const withoutA = evidenceOf(...[...run.captures.entries()]
      .filter(([ref]) => ref !== onA.subjectProvenance!.captureRef)
      .map(([, entry]) => entry));
  const removed = resolve(onA, withoutA);
  check('J3: removing the capture removes the position',
      !/\.nth\(/.test(String(removed.expression ?? '')), String(removed.expression));
  check('J3: and the assertion falls back to the composed locator, unresolved',
      removed.expression === 'page.locator(".bugChecked")'
      || removed.outcome === 'NEEDS_REVIEW', `${removed.outcome} ${removed.expression}`);

  // MUTATION 3 - REMOVE the captureRef from the provenance. Node identity remains, and
  // there is no action row for this element, so again there is nothing to stand on.
  const noRef = resolve({ ...onA,
    subjectProvenance: { refs: onA.subjectProvenance!.refs, locatorMatchCount: 3 },
  } as RecordedAssertion, evidence);
  check('J4: dropping the capture NAME drops the position too',
      !/\.nth\(/.test(String(noRef.expression ?? '')), String(noRef.expression));

  // MUTATION 4 - RESTAMP the measurement as a press. It must not become an action's
  // proof: an action still demands a measurement taken at the press itself.
  const restamped = [...run.captures.values()].map(entry => ({
    ...entry,
    positionProvenCandidates: (entry.positionProvenCandidates ?? [])
        .map(candidate => ({ ...candidate, measuredAt: 'pick' as const })),
  }));
  const asAction = assessLocator({
    locator: onA.locator, target: onA.target, kind: 'action', value: null,
    evidence: evidenceForAssertionSubject(evidenceOf(...restamped), onA)?.evidence,
  });
  check('J5: a pick-time position is still refused for an ACTION',
      !/\.nth\(/.test(String(asAction.expression ?? '')), String(asAction.expression));

  fs.rmSync(path.dirname(run.outputFile), { recursive: true, force: true });
}

/* =========================================================================
   K - ONE CHECKBOX COMPONENT, every operation, both polarities, twice over
   ========================================================================= */

/**
 * The required coverage for TC_LOGIN_109's component question: click, check, uncheck,
 * assert-checked and assert-unchecked against checkbox A, then the same against B.
 *
 * WHAT THIS IS ACTUALLY ASKING. FixturePortal's tick is not one node:
 *
 *     label.rounded-checkbox-cont
 *       input.bugChecked[type=checkbox]      <- holds the STATE
 *       span.rounded-checkbox-ui             <- what a person CLICKS
 *
 * So a click and a state assertion on the same component legitimately resolve to
 * different DOM nodes and therefore different locators. What must NOT differ is which
 * COMPONENT INSTANCE they are about - and that is what `elementRef` answers. The trap
 * this pins shut is the opposite error: concluding that two locators mean two
 * components, or forcing both onto one node to make them look tidy.
 *
 * Lives here rather than in `locator-validation.fixture.ts` because it needs the real
 * recorder, the real registry and a stub DOM, which are all in this file.
 */
async function partK(): Promise<void> {
  section('K - one component, five operations, two instances');

  const run = pickerRun();
  const A = 0;
  const B = 2;

  // ---- checkbox A: click it, check it, uncheck it, assert both polarities ----
  const clickA = run.press(run.page.spans[A]);          // the span - what a person hits
  const stateA = run.press(run.page.inputs[A]);         // the input - what holds state
  await run.assertOn(A, 'unchecked', false);
  await run.assertOn(A, 'checked', true);

  // ---- checkbox B: the same five, on a different instance ----
  const clickB = run.press(run.page.spans[B]);
  const stateB = run.press(run.page.inputs[B]);
  await run.assertOn(B, 'unchecked', false);
  await run.assertOn(B, 'checked', true);

  check('K1: four assertions were recorded, two per instance',
      run.picked.length === 4, String(run.picked.length));
  const [aOff, aOn, bOff, bOn] = run.picked;

  // COMPONENT IDENTITY. Both of A's assertions are about one element; both of B's are
  // about another; and the two are not confused, even though all four compose the
  // identical locator string.
  check('K2: both assertions about A name ONE element',
      aOff.subjectProvenance?.refs[0] === aOn.subjectProvenance?.refs[0],
      `${aOff.subjectProvenance?.refs[0]} vs ${aOn.subjectProvenance?.refs[0]}`);
  check('K2: both assertions about B name ONE element',
      bOff.subjectProvenance?.refs[0] === bOn.subjectProvenance?.refs[0]);
  check('K2: and A is not B',
      aOff.subjectProvenance?.refs[0] !== bOff.subjectProvenance?.refs[0],
      `${aOff.subjectProvenance?.refs[0]} vs ${bOff.subjectProvenance?.refs[0]}`);
  check('K2: all four composed the SAME locator string, so nothing here came from it',
      new Set(run.picked.map(entry => entry.locator)).size === 1,
      run.picked[0]?.locator);
  check('K3: each assertion still has its OWN capture - four claims, four instants',
      new Set(run.picked.map(entry => entry.subjectProvenance?.captureRef)).size === 4,
      run.picked.map(entry => entry.subjectProvenance?.captureRef).join(' | '));
  check('K3: polarity survives - two negative, two positive',
      run.picked.filter(entry => entry.expected === false).length === 2
      && run.picked.filter(entry => entry.expected === true).length === 2);

  // THE STATE NODE AND THE CLICK NODE ARE DIFFERENT NODES OF ONE COMPONENT, and the
  // registry says so: different names, and the assertion's name is the state node's.
  check('K4: the click node and the state node have different names',
      clickA.elementRef !== stateA.elementRef,
      `click ${clickA.elementRef} vs state ${stateA.elementRef}`);
  check('K4: the assertion is about the STATE node, not the one the pointer hit',
      aOff.subjectProvenance?.refs[0] === stateA.elementRef,
      `${aOff.subjectProvenance?.refs[0]} vs state ${stateA.elementRef}`);
  check('K4: and the same holds for B, so it is a rule and not a coincidence',
      clickB.elementRef !== stateB.elementRef
      && bOff.subjectProvenance?.refs[0] === stateB.elementRef);
  check('K5: pressing one node twice never invents a second component',
      run.press(run.page.inputs[A]).elementRef === stateA.elementRef);

  // ---- what the pipeline emits for all of it ----
  const evidence = evidenceOf(...run.captures.values());
  const emitted = run.picked.map(assertion => String(assessLocator({
    locator: assertion.locator, target: assertion.target, kind: 'assertion', value: null,
    evidence: evidenceForAssertionSubject(evidence, assertion)?.evidence,
  }).expression));

  // IDENTITY, NOT INDEX. What must hold is that each claim names ITS OWN instance.
  // Whether the evidence lets that be said by the row's own text or only by a measured
  // index is a fact about the DATA, and both routes are pinned elsewhere in this file.
  check('K6: both claims about A name A, and both about B name B',
      /first issue on the board|\.nth\(0\)$/.test(emitted[0])
      && /first issue on the board|\.nth\(0\)$/.test(emitted[1])
      && /login is not working|\.nth\(2\)$/.test(emitted[2])
      && /login is not working|\.nth\(2\)$/.test(emitted[3]),
      emitted.join(' | ').slice(0, 200));
  check('K6: and no claim is narrowed by a position nobody chose',
      emitted.every(line => !/\.first\(|\.last\(/.test(line)), emitted.join(' | ').slice(0, 160));
  check('K6: so the two instances get two different locators',
      emitted[0] !== emitted[2]);
  check('K6: and the two claims about ONE instance get the same locator - the state '
    + 'does not change which element it is',
      emitted[0] === emitted[1] && emitted[2] === emitted[3]);

  // NO GENERATED ID, ANYWHERE. The inputs carry 1749550/1749552 and the rows carry
  // tr_1749550/tr_1749552; not one of them may reach an expression.
  check('K7: no generated id reaches any emitted locator',
      emitted.every(expression => !/17495\d\d/.test(expression)),
      emitted.find(expression => /17495\d\d/.test(expression)) ?? 'none');
  check('K7: nor does first() or last()',
      emitted.every(expression => !/first\(|last\(/.test(expression)));
  check('K7: every index is a MEASURED one, not a count',
      run.picked.every(assertion => {
        const capture = run.captures.get(assertion.subjectProvenance!.captureRef!);
        return (capture?.positionProvenCandidates ?? []).some(candidate =>
          candidate.measuredAt === 'pick' && candidate.sameDocument === true
          && typeof candidate.positionWithinCandidate === 'number'
          && candidate.matchCount === 3);
      }));

  // THE CLICK IS STILL THE CLICK. An action resolves against its own evidence, at the
  // press, and may land on the span while the assertion lands on the input.
  const clickVerdict = assessLocator({
    locator: 'page.locator(".rounded-checkbox-ui")', target: 'tick', kind: 'action',
    evidence: {
      locator: 'page.locator(".rounded-checkbox-ui")',
      target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
      ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
      relationships: [], matchCount: 3, matchCountDocument: 'same',
      positionProvenCandidates: [{
        strategy: 'container-text',
        expression: 'page.locator(".tabulator-row").filter({ hasText: "first issue on the board" })'
          + '.locator(".rounded-checkbox-ui")',
        matchCount: 3, identityMatched: false, sameDocument: true, measuredAt: 'press',
        positionWithinCandidate: 0,
      }],
    } as never,
  });
  check('K8: the CLICK resolves to the span - a different node of the same component',
      String(clickVerdict.expression).includes('.rounded-checkbox-ui')
      && /\.nth\(0\)$/.test(String(clickVerdict.expression)), String(clickVerdict.expression));
  check('K8: while the ASSERTION resolves to the input',
      emitted[0].includes('.bugChecked'), emitted[0]);
  check('K8: two nodes, one component, and neither locator pretends to be the other',
      clickVerdict.expression !== emitted[0]);

  fs.rmSync(path.dirname(run.outputFile), { recursive: true, force: true });
}

/* =========================================================================
   G - no browser, no model, no network
   ========================================================================= */

function partG(): void {
  section('G - this fixture and the mechanism it tests touch nothing live');

  const read = (file: string) => fs.readFileSync(path.resolve(ROOT, file), 'utf8');

  // THE FIXTURE'S OWN IMPORTS, not its prose. An earlier version searched the whole
  // file for the name of a model provider and found the search itself - a check that
  // can only fail, and never for the reason it was written.
  const self = read('ai/autocode/assertion-provenance.fixture.ts');
  const imports = self.slice(0, self.indexOf('const ROOT'));
  check('G1: the fixture imports no browser',
      !/from '(playwright|@playwright)/.test(imports), imports.match(/from '[^']+'/g)?.join(' ') ?? '');
  check('G2: and no model client',
      !/from '(@anthropic|openai)/.test(imports));

  // The association layer must stay deterministic: no clock, no randomness, no model,
  // and nothing read from outside the two arguments it is handed.
  const evidence = read('ai/autocode/dom-evidence.ts');
  const association = evidence.slice(evidence.indexOf('assertion-to-target provenance'));
  check('G3: the association reads no clock and no random number',
      !/Date\.now|Math\.random/.test(association));
  check('G4: and it asks nothing outside the two inputs it is given',
      !/readFileSync|fetch\(|spawn|process\.env/.test(association));
  check('G5: and it never mentions a model',
      !/anthropic|openai|\bagent\b/i.test(association));
}

/* ---------------------------------------------------------------- run it */

async function main(): Promise<void> {
  partA();
  await partB();
  partC();
  partD();
  await partH();
  await partI();
  await partJ();
  await partK();
  partF();
  partG();

  process.stdout.write(failures
    ? `\n${failures} CHECK(S) FAILED\n`
    : '\nall checks passed\n');
  process.exit(failures ? 1 : 0);
}

void main();
