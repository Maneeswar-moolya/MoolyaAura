import '../testing/isolated-checkout';
/**
 * The target snapshot: href, alt, the browser's accessible name, one plain ancestor.
 *
 *   npx tsx ai/autocode/target-snapshot.fixture.ts
 *
 * Offline: no browser, no model, no network, and it writes nothing anywhere. It runs the
 * GENERATED capture string against a stub DOM - the only way to test the in-page half,
 * and the reason `clicked-target.fixture.ts` does the same - and drives the real
 * `redactNode`, `sanitiseEvidence` and `candidateSelectorsFor`.
 *
 * WHY THIS EXISTS
 *
 * Measured over eleven live targets before anything was changed:
 *
 *  - FixtureShop's Mobiles and Home links have TWELVE ancestors and keep none, because none
 *    is a container tag and none carries a role or an id. Both produced exactly one
 *    candidate. Their authored `href` identifies each of them uniquely.
 *  - `alt` was read into the capture's attribute bag and dropped. 91 images on one page
 *    carry one; three of eight sampled identified their element uniquely and four shared
 *    `alt="Image"` across 62 elements.
 *  - `accessibleName` held `aria-label || title`, which is not the accessible name. The
 *    browser's own answer was available on 11 of 11 targets; an attribute-based guess
 *    agreed with it on 7 of 10, and the three misses were real: FixturePortal's password field
 *    computes as "Password Not too short! enter min 5 characters." once its error label
 *    is showing.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ELEMENT_CAPTURE } from './dom-capture-source';
import {
  candidateSelectorsFor, hrefCarriesSecret, redactNode, sanitiseEvidence,
  type DomNode, type TargetEvidence,
} from './dom-evidence';
import { analyseIdentifier } from './locator-quality';

const ROOT = process.cwd();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const isGenerated = (value: string) => analyseIdentifier(value).dynamic;
const expressions = (graph: any) =>
  candidateSelectorsFor(graph, isGenerated).map((entry: any) => entry.expression);

/* ------------------------------------------------------------------ stub DOM
 * Enough of a DOM for the generated capture to walk. Written as a tiny class rather
 * than mocked per call, so the capture is exercised as one program.
 */
class Node {
  tagName: string;
  attributes: Array<{ name: string; value: string }> = [];
  children: Node[] = [];
  parentElement: Node | null = null;
  classList: string[] = [];
  textContent = '';
  id = '';
  title = '';
  isConnected = true;

  constructor(tag: string, attributes: Record<string, string> = {}, text = '') {
    this.tagName = tag.toUpperCase();
    this.textContent = text;
    for (const [name, value] of Object.entries(attributes)) {
      this.attributes.push({ name, value });
      if (name === 'id') this.id = value;
      if (name === 'title') this.title = value;
      if (name === 'class') this.classList = value.split(/\s+/).filter(Boolean);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.find(entry => entry.name === name)?.value ?? null;
  }

  append(...nodes: Node[]): this {
    for (const node of nodes) { node.parentElement = this; this.children.push(node); }
    return this;
  }

  getBoundingClientRect() { return { width: 10, height: 10, top: 0, left: 0, bottom: 10, right: 10 }; }
  querySelectorAll() { return []; }
}

/** The capture, compiled the way production compiles it (live-recorder.ts:151). */
const capture = new Function(`
  const window = {
    innerHeight: 800,
    getComputedStyle: () => ({ overflowY: 'visible', overflowX: 'visible' }),
  };
  const document = { documentElement: { scrollHeight: 800 } };
  return ${ELEMENT_CAPTURE};
`)() as (element: unknown) => any;

/* ---------------------------------------------------------------- fixtures */

/** FixtureShop's Mobiles link: an anchor with an href, wrapped in plain divs only. */
function mobiles(): Node {
  const anchor = new Node('a', { href: '/mobile-phones-store' }, 'Mobiles');
  const inner = new Node('div', { class: 'r-1awozwy r-1777fci' }, 'Mobiles');
  const outer = new Node('div', { class: 'r-13awgt0' }, 'Mobiles');
  const shell = new Node('div', {}, 'Mobiles');
  shell.append(outer);
  outer.append(inner);
  inner.append(anchor);
  return anchor;
}

/** A footer link inside a real container, so a qualifying ancestor exists too. */
function seller(): Node {
  const anchor = new Node('a', {
    href: 'https://seller.shop.fixture.invalid/?utm_source=x', 'aria-label': 'Become a Seller',
  }, 'Become a Seller');
  const wrapper = new Node('div', { class: 'N5kmDa' }, 'Become a Seller');
  const footer = new Node('footer', { id: 'slot-list-container' }, 'Become a Seller');
  footer.append(wrapper);
  wrapper.append(anchor);
  return anchor;
}

/** A product image whose alt is shared with sixty-one others. */
function image(): Node {
  const img = new Node('img', { alt: 'Image', src: '/x.png' });
  const cell = new Node('div', { class: 'card' });
  cell.append(img);
  return img;
}

/* ============================================================== A - href */

function checkHref(): void {
  section('A - href: authored, never resolved');

  const graph = capture(mobiles());
  check('A: the href is captured', graph.target.href === '/mobile-phones-store', String(graph.target.href));
  check('A: and flagged relative', graph.target.hrefAbsolute === false, String(graph.target.hrefAbsolute));
  check('A: it yields a candidate',
      expressions(graph).includes('page.locator("[href=\\"/mobile-phones-store\\"]")'),
      expressions(graph).join(' | '));

  // AN ABSOLUTE HREF NAMES A DEPLOYMENT, not an application. Captured as evidence of
  // where the recording ran, never turned into a locator.
  const absolute = capture(seller());
  check('A: an absolute href is captured', Boolean(absolute.target.href));
  check('A: and flagged absolute', absolute.target.hrefAbsolute === true);
  check('A: and NEVER becomes a candidate',
      !expressions(absolute).some((e: string) => e.includes('href')),
      expressions(absolute).filter((e: string) => e.includes('href')).join(' | ') || 'none');

  const scripted = capture(new Node('a', { href: 'javascript:void(0)' }, 'Forgot Password?'));
  check('A: javascript:void(0) is absolute by the same test, so it is not a candidate',
      scripted.target.hrefAbsolute === true
      && !expressions(scripted).some((e: string) => e.includes('href')));

  const empty = capture(new Node('a', { href: '' }, 'x'));
  check('A: an empty href is not captured at all', empty.target.href === undefined);
}

/* =============================================================== B - alt */

function checkAlt(): void {
  section('B - alt: captured, ambiguity preserved');

  const graph = capture(image());
  check('B: the alt is captured', graph.target.alt === 'Image', String(graph.target.alt));
  check('B: it yields a getByAltText candidate',
      expressions(graph).includes('page.getByAltText("Image", { exact: true })'),
      expressions(graph).join(' | '));
  // THE POINT OF THE AMBIGUOUS CASE. `alt="Image"` matched 62 elements on the live page.
  // Generation does not know that and must not guess it: the candidate is emitted, then
  // measured, then refused. Nothing here forces it and nothing here suppresses it.
  check('B: nothing about generation is conditional on how many elements it will match',
      expressions(capture(image())).length === expressions(graph).length);
  const none = capture(new Node('img', { alt: '' }));
  check('B: an empty alt is not captured', none.target.alt === undefined);
}

/* ================================================= C - the accessible name */

function checkAccessibleName(): void {
  section('C - accessible name: approximate in the page, authoritative from the browser');

  const labelled = capture(new Node('a', { 'aria-label': 'Become a Seller' }, 'Become a Seller'));
  check('C: an aria-label is captured as the approximation',
      labelled.target.accessibleName === 'Become a Seller');
  check('C: with its source', labelled.target.accessibleNameSource === 'aria-label');
  check('C: and marked UNVERIFIED, because the page cannot compute a name',
      labelled.target.accessibleNameVerified === false);

  const titled = capture(new Node('input', { title: 'Search for Products' }));
  check('C: a title is the second source', titled.target.accessibleNameSource === 'title');

  const plain = capture(new Node('a', {}, 'Mobiles'));
  check('C: no attribute means no approximation, not an invented one',
      plain.target.accessibleName === undefined
      && plain.target.accessibleNameSource === undefined
      && plain.target.accessibleNameVerified === undefined);

  // THE BROWSER'S ANSWER OUTRANKS EVERY APPROXIMATION, and only when it says so.
  const withBrowserName = {
    target: {
      tag: 'input', type: 'password', id: 'password_field',
      accessibleName: 'Password Not too short! enter min 5 characters.',
      accessibleNameSource: 'browser-computed', accessibleNameVerified: true,
      aria: { 'aria-label': 'Password' },
    },
    ancestors: [], descendants: [],
  };
  check('C: a verified name is used, not the aria-label beside it',
      expressions(withBrowserName).some((e: string) =>
        e.includes('Password Not too short! enter min 5 characters.')),
      expressions(withBrowserName).filter((e: string) => e.includes('getByRole')).join(' | '));

  // ...and an UNVERIFIED one does not outrank it. Same shape, one flag different.
  const unverified = {
    ...withBrowserName,
    target: { ...withBrowserName.target, accessibleNameVerified: false, accessibleNameSource: 'title' },
  };
  check('C: an unverified name does NOT displace the aria-label',
      !expressions(unverified).some((e: string) => e.includes('Not too short')),
      expressions(unverified).filter((e: string) => e.includes('getByRole')).join(' | '));

  // A recording made before any of this reads exactly as it did.
  const legacy = { target: { tag: 'a', text: 'Mobiles' }, ancestors: [], descendants: [] };
  check('C: a pre-P5.1 graph still generates its role+name from the text',
      expressions(legacy).includes('page.getByRole("link", { name: "Mobiles", exact: true })'));
}

/* ============================================== D - the one plain ancestor */

function checkAncestor(): void {
  section('D - exactly one non-qualifying ancestor, appended');

  const graph = capture(mobiles());
  const ancestors = graph.ancestors ?? [];
  check('D: Mobiles has an ancestor now, where it had none',
      ancestors.length === 1, String(ancestors.length));
  check('D: it is the NEAREST plain wrapper', ancestors[0]?.depth === 1, String(ancestors[0]?.depth));
  check('D: and it says so', ancestors[0]?.nonQualifying === true);
  check('D: exactly one, never two',
      ancestors.filter((a: any) => a.nonQualifying).length === 1);

  // APPENDED, NOT INSERTED. A consumer slices this array - `stableAncestors` takes the
  // first three carrying an id, the container family the first four - so an entry placed
  // in depth order can push a qualifying ancestor out of a window it was inside. Two
  // plain ancestors lost a candidate on one live target; reordering lost them on two.
  const withContainer = capture(seller());
  const list = withContainer.ancestors ?? [];
  const qualifying = list.filter((a: any) => !a.nonQualifying);
  check('D: every qualifying ancestor comes first',
      list.slice(0, qualifying.length).every((a: any) => !a.nonQualifying),
      list.map((a: any) => `${a.tag}${a.nonQualifying ? '(plain)' : ''}`).join(' > '));
  check('D: the plain one is last', list[list.length - 1]?.nonQualifying === true);
  check('D: and the qualifying ones keep their own order, nearest first',
      qualifying.every((a: any, index: number) => index === 0 || a.depth > qualifying[index - 1].depth));

  const deep = new Node('span', {}, 'x');
  let parent: Node = deep;
  for (let level = 0; level < 8; level++) {
    const wrapper = new Node('div', { class: `w${level}` });
    wrapper.append(parent);
    parent = wrapper;
  }
  const many = capture(deep);
  check('D: eight plain wrappers still yield exactly one',
      (many.ancestors ?? []).filter((a: any) => a.nonQualifying).length === 1,
      String((many.ancestors ?? []).length));
}

/* ================================================= E - redaction and limits */

function checkRedaction(): void {
  section('E - redaction, and the allow-list the new fields go through');

  const node: DomNode = {
    tag: 'a', href: '/x', hrefAbsolute: false, alt: 'A picture',
    accessibleName: 'Open', accessibleNameSource: 'browser-computed', accessibleNameVerified: true,
    nonQualifying: true,
  };
  const safe = redactNode(node);
  for (const field of ['href', 'hrefAbsolute', 'alt', 'accessibleName',
    'accessibleNameSource', 'accessibleNameVerified', 'nonQualifying'] as const)
    check(`E: ${field} survives the allow-list`, (safe as any)[field] !== undefined);

  // AN HREF CAN BE A CREDENTIAL. A reset link is the secret.
  check('E: a token in the query refuses the whole href',
      hrefCarriesSecret('/reset?token=abc123def456ghi789jkl'));
  check('E: a session parameter too', hrefCarriesSecret('/x?session=1'));
  check('E: and a secret-shaped value under a harmless key',
      hrefCarriesSecret('/x?q=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'));
  check('E: an ordinary route is kept', !hrefCarriesSecret('/mobile-phones-store'));
  check('E: an ordinary query is kept', !hrefCarriesSecret('/search?q=phone&page=2'));
  check('E: a refused href is dropped WHOLE, never trimmed',
      redactNode({ tag: 'a', href: '/reset?token=abc123def456ghi789jkl' }).href === undefined);

  // The name's provenance may not outlive the name it describes.
  const credential = redactNode({
    tag: 'input', type: 'password', name: 'password', text: 'hunter2',
    accessibleName: '', accessibleNameSource: 'browser-computed', accessibleNameVerified: true,
  } as DomNode);
  check('E: a password field keeps its shape and loses its text', credential.text === undefined);
  check('E: a source with no name does not survive on its own',
      credential.accessibleNameSource === undefined && credential.accessibleNameVerified === undefined);

  // The funnel every capture passes through still applies every bound.
  const evidence = sanitiseEvidence([{
    locator: 'page.locator("#x")',
    target: { tag: 'a', href: '/x', alt: 'A', accessibleName: 'Open',
      accessibleNameSource: 'browser-computed', accessibleNameVerified: true },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1,
  } as unknown as TargetEvidence], {} as never);
  const written = (evidence as any).targets?.[0]?.target ?? {};
  check('E: the new fields reach the sidecar through sanitiseEvidence',
      written.href === '/x' && written.alt === 'A' && written.accessibleNameVerified === true,
      JSON.stringify(written));
}

/* ====================================== F - identity, isolation, compatibility */

function checkInvariants(): void {
  section('F - what did NOT change');

  const recorder = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'live-recorder.ts'), 'utf8');
  const evidenceSource = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'dom-evidence.ts'), 'utf8');

  // IDENTITY IS STILL THE PARKED NODE. Measured in the audit: across every real
  // look-alike pair on FixturePortal - two password inputs, three email inputs, eleven
  // buttons - the richer snapshot added NO distinguishing power, because `id` already
  // separated all of them. Identity never needed a bigger snapshot.
  check('F: identity is still node identity against the parked target',
      /window\.__auraTargets/.test(recorder) && /pair\[0\] === pair\[1\]/.test(recorder));
  check('F: isProvenAgainstClickedTarget is untouched',
      /matchCount === 1\s*\n\s*&& candidate\.identityMatched === true\s*\n\s*&& candidate\.sameDocument === true\s*\n\s*&& candidate\.measuredAt === 'press'/
          .test(evidenceSource));

  // CDP IS A CAPABILITY. A recording is never refused for want of it.
  check('F: the CDP session is opened once per page and remembered',
      /cdpSessions = new WeakMap/.test(recorder));
  check('F: a browser without it resolves to null rather than throwing',
      /catch \{\s*\n\s*\/\/ Not Chromium[^]*?return null;/.test(recorder));
  check('F: the accessible name is fetched BEFORE candidates are derived',
      recorder.indexOf('const computed = await browserAccessibleName(frame, entry);')
      < recorder.indexOf('const generated = candidateSelectorsFor'));
  check('F: it reaches the node through the registry, not a Playwright handle',
      /window\.__auraTargets && window\.__auraTargets\[/.test(recorder));
  check('F: and asks for the node alone - no subtree, no page snapshot',
      /fetchRelatives: false/.test(recorder));
  check('F: the object is always released',
      /Runtime\.releaseObject/.test(recorder));

  // NOTHING ELSE WAS ADDED. The audit measured full DOM at 214x the snapshot, a second
  // before/after snapshot at +100% for a signal that named nothing about the target, and
  // no strategy consumes siblings at all.
  const capture = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'dom-capture-source.ts'), 'utf8');
  check('F: no full-DOM capture', !/outerHTML/.test(capture));
  check('F: no before/after second snapshot', !/afterSnapshot|beforeSnapshot/.test(capture));
  check('F: sibling capture is unchanged', /previous\.length < 4/.test(capture) && /next\.length < 4/.test(capture));
  check('F: no value is captured', !/described\.value|\.value \|\| undefined/.test(capture));

  // BACKWARD COMPATIBILITY. Every new field is optional, so a graph recorded before this
  // reads exactly as it did.
  const legacy = { target: { tag: 'input', id: 'email_field', placeholder: 'Enter your email' },
    ancestors: [{ tag: 'form', id: 'loginForm', relationship: 'ancestor', depth: 1 }], descendants: [] };
  const built = expressions(legacy);
  check('F: a graph with none of the new fields still generates its old candidates',
      built.includes('page.locator("#email_field")')
      && built.includes('page.getByPlaceholder("Enter your email")'),
      String(built.length) + ' candidates');
  check('F: and generates no href or alt candidate out of nothing',
      !built.some((e: string) => /href|AltText/.test(e)));
}

/* ------------------------------------------------------------------- main */

function main(): void {
  checkHref();
  checkAlt();
  checkAccessibleName();
  checkAncestor();
  checkRedaction();
  checkInvariants();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
