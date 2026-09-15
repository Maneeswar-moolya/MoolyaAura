/**
 * A user action that causes a navigation is still a user action.
 *
 * THE DEFECT THIS EXISTS TO STOP COMING BACK
 *
 * The recording picture hook wraps Playwright's own recorder bindings so a screenshot
 * can be taken around each action. It used to AWAIT that screenshot - an out-of-process
 * round trip - BEFORE handing the action to the recorder. For an ordinary click that is
 * invisible. For a click that navigates it is fatal: the browser has already dispatched
 * the click, the document is being torn down, the awaited call never comes back, and
 * `__pw_recorderRecordAction` is therefore never reached. The action is not delayed or
 * degraded; it never exists. Playwright then sees a navigation nothing caused and writes
 * `await page.goto(...)` in its place, so the recording ends up holding the CONSEQUENCE
 * of an action it no longer holds - which is the one substitution the navigation model
 * must never make.
 *
 * Measured, not reasoned about: the same three-click scenario below recorded all three
 * clicks with the hook uninstalled and lost both navigating ones with it installed.
 *
 * The second half is the same defect seen from the other end. Pictures pair with steps
 * only when the observed stream and the recorded stream are the same stream, so one lost
 * action discards EVERY action picture in the recording while the assertion picture -
 * kept in its own list - survives. The screen then said "No recording screenshot was
 * captured for this step" about steps whose screenshots were sitting on disk.
 */
import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { workspaceData } from '../testing/workspace-data';
import { RecordingPictures } from './recording';
import { containedFile, diagnosticRoot, type DiagnosticCapture } from './artifacts';
import { NavigationJournal } from '../dashboard/navigation';
import { isRecorderOwnAction } from '../dashboard/live-recorder';
import { parseRecording, type RecordedAssertion, type Recording } from '../dashboard/recorder';
import { recordingMappingReview } from '../dashboard/recording-mapping';
import { evidenceUnavailable } from '../autocode/dom-evidence';

/** Page A -> Continue -> Page B -> Open Cases -> Page C, plus one action that stays put. */
const PAGES: Record<string, string> = {
  '/a': `<h1>Landing</h1><button onclick="location.href='/b'">Continue</button>`,
  '/b': `<h1>Signed in</h1><button onclick="location.href='/c'">Open Cases</button>`,
  '/c': `<h1>My Support Cases</h1><button onclick="this.textContent='Helped'">Product Help</button>`,
};

/**
 * The recorder's own overlay, built the way the real picker builds it.
 *
 * A closed shadow root and no light-DOM text, because that is what makes Playwright's
 * selector generator name the HOST - `page.locator('ba-aura-assert')` - which is the
 * shape `isRecorderOwnAction` recognises. Injected after the application actions so it
 * cannot intercept them.
 */
const PICKER_HOST = `(() => {
  const host = document.createElement('ba-aura-assert');
  host.setAttribute('data-aura-recorder-ui', 'true');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  host.attachShadow({ mode: 'closed' }).innerHTML =
    '<div style="position:fixed;inset:0;pointer-events:auto;background:transparent"></div>';
  document.body.appendChild(host);
})()`;

/** The state assertion a person records through the picker, in the shape the picker sends. */
const PICKED: RecordedAssertion = {
  type: 'contains', target: 'heading', locator: `page.getByRole('heading')`,
  locatorStrategy: 'role', value: 'My Support Cases', expected: true,
  // Picker positions count RAW script lines: goto + three clicks + the picker's own click.
  afterActions: 5,
};

async function settleObservations(count: number, pictures: RecordingPictures): Promise<void> {
  // The pre-interaction buffer is refreshed on a 750ms cycle in the page, so an
  // observation appears shortly after the action rather than with it. Bounded and
  // condition-driven: it waits for the observation, never for a fixed duration.
  for (let attempt = 0; attempt < 100 && pictures.observations.length < count; attempt++)
    await new Promise(resolve => setTimeout(resolve, 100));
}

async function main() {
  const { scope } = workspaceData();
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(PAGES[(request.url || '/').split('?')[0]] ?? '<h1>Elsewhere</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const outputFile = path.join(os.tmpdir(), `aura-recording-navigation-${Date.now()}.spec.ts`);
  const browser = await chromium.launch({ headless: true });
  let pictures: RecordingPictures;
  let source = '';
  try {
    const context = await browser.newContext();
    // The REAL recorder, the REAL hook. Nothing about the action stream is simulated.
    await (context as any)._enableRecorder({ language: 'playwright-test', mode: 'recording',
      outputFile, handleSIGINT: false, hideToolbar: true });
    pictures = new RecordingPictures(scope, isRecorderOwnAction);
    await pictures.install(context);
    const page = await context.newPage();
    const navigation = new NavigationJournal();
    await navigation.attach(page);
    await navigation.navigateEntry(page, `${base}/a`);

    for (const [name, destination] of [['Continue', '/b'], ['Open Cases', '/c']] as const) {
      await page.waitForTimeout(1200);
      await page.getByRole('button', { name }).click();
      await page.waitForURL(`**${destination}`);
    }
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Product Help' }).click();
    await settleObservations(3, pictures);

    await page.waitForTimeout(1200);
    await page.evaluate(PICKER_HOST);
    await page.mouse.click(20, 20);
    await pictures.assertion(page as any, 0);
    // Codegen flushes its script asynchronously; wait for the last application action.
    for (let attempt = 0; attempt < 100; attempt++) {
      source = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
      if (source.includes('Product Help')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await pictures.settle(page);
    await navigation.settle();
    source = navigation.finish(fs.readFileSync(outputFile, 'utf8'), `${base}/a`).source;
  } finally {
    await browser.close();
    fs.rmSync(outputFile, { force: true });
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  /* ---------------------------------------------- the actions survived the navigations */

  const recording = parseRecording(source, { startUrl: `${base}/a`, browser: 'chromium',
    durationMs: 0, stateAssertions: [PICKED] });
  const performed = recording.actions.filter(action => action.type !== 'navigate')
    .map(action => `${action.type} ${action.target}`);
  assert.deepEqual(performed, ['click Continue', 'click Open Cases', 'click Product Help'],
    `A navigating click must survive as an action. Recorded:\n${source}`);
  assert.ok(!recording.actions.some(action => action.type === 'navigate'
    && (action.value ?? '').endsWith('/b')),
    'The navigation a click caused must not stand in the recording in place of that click');
  assert.ok(recording.actions[0]?.type === 'navigate',
    'The one explicit entry navigation is still the recording\'s first action');
  assert.ok(!JSON.stringify(recording.actions).includes('ba-aura-assert'),
    'The recorder\'s own overlay is not a step of the test');
  console.log('PASS both navigating clicks retained, entry navigation retained, overlay dropped');

  /* -------------------------------------------- every step carries its own picture */

  const captures = pictures!.finish(recording.actions, recording.assertions);
  const forStep = (key: string) => captures.filter(capture => capture.recordingStepKey === key);
  const attribution = pictures!.attribution!;
  assert.equal(attribution.paired, true,
    `Observed and recorded streams must be one stream: ${JSON.stringify(attribution)}`);
  assert.equal(attribution.attributed, attribution.observed,
    'Every picture taken reaches the step it describes when the streams pair');

  for (const [key, route] of [['action:1', '/a'], ['action:2', '/b'], ['action:3', '/c']] as const) {
    const before = forStep(key).filter(capture => capture.captureType === 'BEFORE_ACTION');
    assert.equal(before.length, 1, `${key} must keep exactly one before-action picture`);
    // The route each before-action picture was taken on is the proof that the two
    // navigations happened, and that they happened BETWEEN these actions rather than
    // instead of them. It is read from the capture, never asserted from the script.
    assert.equal(before[0].route, route, `${key} was recorded on ${route}`);
  }
  const assertionState = forStep('assertion:0');
  assert.deepEqual(assertionState.map(capture => capture.captureType), ['ASSERTION_STATE'],
    'The picked assertion keeps its own assertion-state picture');
  assert.equal(assertionState[0].route, '/c', 'The assertion was made on the final screen');
  // A navigating action may legitimately have no after-action picture: the document it
  // would have photographed is gone. Losing the BEFORE one is the defect, not this.
  assert.ok(forStep('action:3').some(capture => capture.captureType === 'AFTER_ACTION'),
    'An action that stays on its page keeps its after-action picture');
  console.log('PASS per-step before-action pictures across two navigations and one assertion state');

  /* ------------------------------------------------ nothing was overwritten or shared */

  const refs = captures.map(capture => capture.captureRef);
  const artifacts = captures.map(capture => capture.artifact);
  assert.equal(new Set(refs).size, refs.length, 'Capture references are unique');
  assert.equal(new Set(artifacts).size, artifacts.length, 'No two steps share one screenshot file');
  const keys = new Set(captures.map(capture => capture.recordingStepKey));
  assert.equal(keys.size, 4, `Four steps carry pictures, not one: ${[...keys].join(', ')}`);
  const bytes = new Map<string, string>();
  for (const capture of captures) {
    const file = containedFile(diagnosticRoot(scope), capture.artifact);
    assert.ok(fs.existsSync(file), `${capture.recordingStepKey} picture is on disk`);
    bytes.set(capture.artifact, fs.readFileSync(file).toString('base64'));
  }
  for (const [key, route] of [['action:1', '/a'], ['action:2', '/b']] as const) {
    const mine = forStep(key).find(capture => capture.captureType === 'BEFORE_ACTION')!;
    const later = forStep('action:3').find(capture => capture.captureType === 'BEFORE_ACTION')!;
    assert.notEqual(bytes.get(mine.artifact), bytes.get(later.artifact),
      `${key} (${route}) must not have been overwritten by a later screen`);
  }
  console.log('PASS unique capture references, unique files and distinct screen states');

  /* ------------------------------------------- Recording Review resolves step by step */

  const review = recordingMappingReview(scope, { source, recording: withCaptures(recording, captures) });
  const reviewed = review.steps.map(step => step.key);
  assert.deepEqual(reviewed, ['action:1', 'action:2', 'action:3', 'assertion:0'],
    `Every recorded step reaches Recording Review: ${reviewed.join(', ')}`);
  assert.equal(review.captureAttribution?.paired, true, 'Review carries the attribution verdict');
  for (const step of review.steps) {
    // The exact rule the viewer applies: a step shows the captures keyed to it.
    const shown = (review.captures as DiagnosticCapture[])
      .filter(capture => capture.recordingStepKey === step.key);
    assert.ok(shown.length, `${step.key} has a picture to show`);
    assert.ok(shown.every(capture => !captures.some(other =>
      other.recordingStepKey !== step.key && other.artifact === capture.artifact)),
      `${step.key} shows its own picture and no other step's`);
  }
  console.log('PASS Recording Review resolves a distinct capture set for each recorded step');

  /* ------------------------------------- a stream that does not align says so out loud */

  // The same pairing, asked about a stream it CANNOT place - one action short, exactly the
  // shape the lost click produced. Showing none is right; calling it "nothing was captured"
  // is what sent a person looking for screenshots that were on disk the whole time.
  const divergent = pictures!.finish(recording.actions.slice(0, 3), recording.assertions);
  const unpaired = pictures!.attribution!;
  // Order matters here, and it is the order of the two separate rules: what is SHOWN is
  // decided first, and only then what is SAID about it. A pairing that has quietly
  // loosened shows a picture; a verdict that has quietly hardened only mis-states one.
  assert.equal(divergent.filter(capture => capture.recordingStepKey.startsWith('action:')).length, 0,
    'A stream that does not align attributes no action picture, rather than guessing one');
  assert.equal(unpaired.paired, false, 'A stream that does not align is never reported as paired');
  assert.ok(unpaired.observed > 0 && unpaired.attributed < unpaired.observed,
    `Pictures taken but not attributed are counted, not forgotten: ${JSON.stringify(unpaired)}`);
  assert.notEqual(unpaired.observedActions, unpaired.recordedActions,
    'The reason the streams differ is stated as the two counts, not as a verdict');
  console.log(`PASS unattributed pictures are counted and named ${JSON.stringify(unpaired)}`);
  console.log(`PASS attribution ${JSON.stringify(attribution)}`);
}

function withCaptures(recording: Recording, captures: DiagnosticCapture[]): Recording {
  return { ...recording, evidence: { ...evidenceUnavailable('synthetic navigation scenario: pictures only'),
    captures, captureAttribution: { paired: true, observed: captures.length, attributed: captures.length,
      observedActions: 3, recordedActions: 3, observedAssertions: 1, recordedAssertions: 1 } } };
}

main().catch(error => { console.error(error); process.exitCode = 1; });
