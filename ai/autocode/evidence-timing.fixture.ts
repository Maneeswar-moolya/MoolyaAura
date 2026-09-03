/**
 * Phase 9A: when evidence is taken, and what it says about scrolling.
 *
 *   npx tsx ai/autocode/evidence-timing.fixture.ts
 *
 * Offline. The rules under test are the ones that decide whether a graph can be
 * trusted at all:
 *
 *   - `before-action` vs `after-action` is recorded, never assumed;
 *   - a pre-action graph is matched to a recorded chain by the ELEMENT'S identity,
 *     never by position in a queue;
 *   - `scrollable` needs a measured overflow, and `virtualized` needs the application
 *     to say so - a scrollbar alone is explicitly not enough.
 */

import fs from 'node:fs';
import path from 'node:path';

import { sanitiseEvidence, type TargetEvidence } from './dom-evidence';
import { locatorMetrics, mapRecording } from './from-recording';
import { literalsIn } from '../dashboard/live-recorder';
import { parseRecording } from '../dashboard/recorder';
import { ELEMENT_CAPTURE, PREACTION_HOOK } from './dom-capture-source';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

function target(overrides: Partial<TargetEvidence> = {}): TargetEvidence {
  return {
    locator: "page.locator('#tc_summary_638717')",
    target: { tag: 'div', id: 'tc_summary_638717' },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1, ...overrides,
  };
}

/** Run the browser-side capture over a jsdom-free stub, using the real source text. */
function runCapture(html: string, selector: string): any {
  // A tiny DOM stand-in is not enough for the real capture, so this only checks the
  // SOURCE's rules by reading it. The behavioural proof is the live smoke test.
  return { html, selector };
}

function main(): void {
  process.stdout.write('\n== A — timing is recorded, never assumed ==\n');
  const before = sanitiseEvidence([target({ captureTiming: 'before-action' })], 'x');
  const after = sanitiseEvidence([target({ captureTiming: 'after-action' })], 'x');
  check('A: before-action survives the funnel', before.targets[0].captureTiming === 'before-action');
  check('A: after-action survives the funnel', after.targets[0].captureTiming === 'after-action');
  const silent = sanitiseEvidence([target()], 'x');
  check('A: absent timing stays absent (never defaulted)', silent.targets[0].captureTiming === undefined);

  const mapped = (evidenceTargets: TargetEvidence[]) => {
    const script = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_040.spec.ts'), 'utf8');
    return locatorMetrics(mapRecording(parseRecording(script, {
      startUrl: '', browser: '', durationMs: 0,
      evidence: sanitiseEvidence(evidenceTargets, 'x'),
    })));
  };
  const counts = mapped([
    target({ captureTiming: 'before-action' }),
    target({ locator: "page.locator('#project_banner')", captureTiming: 'after-action' }),
  ]);
  check('A: telemetry counts both timings',
      counts.domEvidence.beforeActionCount === 1 && counts.domEvidence.afterActionCount === 1,
      `before=${counts.domEvidence.beforeActionCount} after=${counts.domEvidence.afterActionCount}`);

  process.stdout.write('\n== B — association is by element identity, not order ==\n');
  check('B: an id literal is extracted',
      literalsIn("page.locator('#tc_summary_638717')").includes('tc_summary_638717'),
      literalsIn("page.locator('#tc_summary_638717')").join(', '));
  check('B: a role name is extracted',
      literalsIn("page.getByRole('button', { name: 'Sign In' })").includes('Sign In'));
  check('B: both scope and descendant literals are extracted',
      literalsIn("page.locator('#bugReport-table').getByText('Line Chart')").length === 2);
  check('B: an escaped quote does not truncate the literal',
      literalsIn("page.getByText('Don\\'t show this again')")[0] === "Don't show this again",
      literalsIn("page.getByText('Don\\'t show this again')")[0]);
  check('B: a chain with no literals yields none (nothing to match on)',
      literalsIn('page.locator()').length === 0);
  const hook = PREACTION_HOOK;
  check('B: the hook records a fingerprint per event', /fingerprint: fingerprint\(element\)/.test(hook));
  check('B: and the graph alongside it', /graph: capture\(element\)/.test(hook));
  // ONE GRAPH SERVES ONE LOCATOR. P0.6 moved claiming out of the page - entries are
  // mirrored to the framework as they are parked, because a navigating click destroys
  // the document that held them - so the consumption is a splice on the mirror plus a
  // claimed-key filter on the page read, not the old in-page `queue.splice(index, 1)`.
  // The property is what matters; this asserts both halves of it.
  const liveSource = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  check('B: a claimed entry is removed from the mirror',
      /parkedEntries\.splice\(parkedEntries\.indexOf\(claimed\), 1\)/.test(liveSource));
  check('B: and cannot be claimed twice from the page read',
      /claimedKeys\.has\(entryKey\(entry\)\)/.test(liveSource)
      && /claimedKeys\.add\(entryKey\(claimed\)\)/.test(liveSource));

  process.stdout.write('\n== C — the hook cannot change what is being recorded ==\n');
  check('C: listeners are passive', /passive: true/.test(hook));
  check('C: and capture-phase', /capture: true/.test(hook));
  check('C: it never preventsDefault', !/preventDefault/.test(hook));
  check('C: it never stops propagation', !/stopPropagation|stopImmediatePropagation/.test(hook));
  check('C: it never writes styles or the DOM',
      !/\.style\.|innerHTML|setAttribute|classList\.add/.test(hook));
  check('C: it is bounded', /queue\.length >= MAX/.test(hook) && /const MAX = \d+/.test(hook));
  check('C: it installs once', /if \(window\.__auraPreAction\) return;/.test(hook));
  check('C: failures inside it are swallowed', /catch \(error\)/.test(hook));

  process.stdout.write('\n== D — scrollable is measured, virtualized is declared ==\n');
  const source = ELEMENT_CAPTURE;
  check('D: scrollable needs overflow AND real overflow',
      /overflowY === 'auto' \|\| overflowY === 'scroll'/.test(source)
      && /scrollHeight > node\.clientHeight \+ 4/.test(source));
  check('D: virtualization looks at aria-rowcount', /aria-rowcount/.test(source));
  check('D: and aria-setsize', /aria-setsize/.test(source));
  check('D: compared against RENDERED rows', /renderedRows/.test(source));
  check('D: or an attribute that says virtual', /indexOf\('virtual'\)/.test(source));
  check('D: a scrollbar alone never sets virtualized',
      !/scrolls \? true/.test(source) && !/virtualized: scrolls/.test(source));
  check('D: the signal that fired is recorded', /virtualizedSignal/.test(source));

  process.stdout.write('\n== E — viewport facts are numbers, never content ==\n');
  check('E: inViewport is computed from the rect', /getBoundingClientRect/.test(source));
  check('E: scrollRequired needs off-screen AND a scrolling ancestor',
      /scrollRequired: !onScreen && \(scrollingAncestor/.test(source));
  check('E: attachment is recorded', /isConnected/.test(source));
  const viewportEvidence = sanitiseEvidence([target({
    attached: true,
    viewport: { inViewport: false, scrollRequired: true, width: 320, height: 24 },
  })], 'x');
  check('E: viewport survives the funnel',
      viewportEvidence.targets[0].viewport?.scrollRequired === true);
  check('E: it carries no text', !/text/.test(JSON.stringify(viewportEvidence.targets[0].viewport)));

  process.stdout.write('\n== F — telemetry for the new facts ==\n');
  const scrolled = mapped([target({
    captureTiming: 'before-action', attached: false,
    viewport: { inViewport: false, scrollRequired: true, width: 10, height: 10 },
    ancestors: [{ tag: 'div', id: 'grid', relationship: 'ancestor', depth: 1,
      scrollable: true, virtualized: true, virtualizedSignal: 'aria-rowcount 500 > 30 rendered rows' }],
  })]);
  check('F: scrollRequired counted', scrolled.domEvidence.scrollRequiredCount === 1);
  check('F: virtualized container counted', scrolled.domEvidence.virtualizedContainerCount === 1);
  check('F: detached-at-capture counted', scrolled.domEvidence.detachedAtCaptureCount === 1);
  check('F: a plain graph counts none of them', (() => {
    const plain = mapped([target({ captureTiming: 'after-action' })]);
    return plain.domEvidence.scrollRequiredCount === 0
      && plain.domEvidence.virtualizedContainerCount === 0
      && plain.domEvidence.detachedAtCaptureCount === 0;
  })());

  process.stdout.write('\n== G — no generated id is emitted, and 9B was not started ==\n');
  const recorder = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  const mapper = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/from-recording.ts'), 'utf8');
  // Specifically a Playwright forced action - `fs.rmSync(..., { force: true })` is
  // filesystem cleanup and has nothing to do with clicking.
  const forcedAction = /\.(click|fill|check|uncheck|hover|dblclick|selectOption)\([^)]*force:\s*true/;
  check('G: no forced Playwright action anywhere in the recorded path',
      !forcedAction.test(recorder) && !forcedAction.test(mapper));
  check('G: no retry loop was added around actions',
      !/for \(let attempt|while \(attempt|retryUntil|recoveryAttempt/.test(mapper));
  check('G: no dispatchEvent fallback', !/dispatchEvent/.test(mapper));
  check('G: no generic hover fallback', !/hover\(\)\s*;\s*\/\/ fallback/i.test(mapper));
  check('G: callFor still emits the plain recorded action',
      /case 'click': return \[`await \(\$\{receiver\}\)\.click\(\);`\]/.test(mapper));
  check('G: no scrollIntoViewIfNeeded in generated code', !/scrollIntoViewIfNeeded/.test(mapper));

  runCapture('<div></div>', 'div');
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
