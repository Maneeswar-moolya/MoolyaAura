/**
 * Recording in a browser we own, so DOM evidence can be captured while it happens.
 *
 * OPTIONAL BY CONSTRUCTION. Everything here sits behind a capability check and a
 * `try`, and every failure returns `null` so `recorder.ts` falls back to the existing
 * `playwright codegen` child process. A Playwright upgrade must never make recording
 * unusable, and the mechanism this depends on - `context._enableRecorder` - is an
 * underscore-prefixed client method, i.e. Playwright's own internals. It is the exact
 * call the `codegen` CLI makes, which is why it is worth using and also why it is
 * never assumed.
 *
 * HOW IT WORKS
 *
 *   chromium.launch()                     one browser, ours
 *   context._enableRecorder({ outputFile, mode: 'recording' })
 *                                         Playwright's OWN recorder: picker, assert
 *                                         toolbar, code generation, all unchanged
 *   watch(outputFile)                     the generated script IS the action stream
 *   -> new locator appears -> capture     bounded DOM evidence, from the live page
 *
 * There is no second browser, no replay, no CDP sidecar, no DebugController, no
 * protocol replication and no model. The person records exactly as they do today; the
 * only difference is that the browser belongs to this process, so a locator's
 * surroundings can be measured at the moment it is recorded.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never drives the page. While the recorder is armed Playwright's own glass pane
 * owns pointer input - observed in the Phase 8B spike - and that is correct: the
 * browser belongs to the person. This module only reads: `count()` and `evaluate()`,
 * which the spike measured at 10-49 ms and which are unaffected by the recorder.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  candidateRejection, candidateSelectorsFor, evidenceUnavailable, implicitRole,
  isProvenAgainstClickedTarget,
  isProvenAtPick, sanitiseEvidence, usableCandidateText, type AssertionProvenance,
  type CandidateMeasurement, type MatchCount,
  type RecordingEvidence, type RelatedNode, type SelectorCandidate, type TargetEvidence,
  isPositionProven,
} from '../autocode/dom-evidence';
import { ELEMENT_CAPTURE, PREACTION_HOOK } from '../autocode/dom-capture-source';
import { FORBIDDEN_VALUE_KEYS } from '../autocode/dom-evidence';
import { ASSERTION_PICKER, PICKER_NAMESPACE } from './assertion-picker-source';
import {
  assertionFor, capabilitiesForSemantics, describeAssertionTarget,
  VISIBILITY_CAPABILITY_IDS, type AssertionCapability,
} from './assertion-capabilities';
import {
  resolveAssertionSubject, type AssociationCandidate, type LiveState, type ResolvedSubject,
} from './associated-control';
import type { RecordedAssertion } from './recorder';
import { parseChain } from '../autocode/locator-quality';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import { activeScopePath } from '../projects/scope';

const ROOT = process.cwd();

/** `live` opts in; anything else keeps the codegen child process. */
export const TRANSPORT_ENV = 'RECORDER_TRANSPORT';

/**
 * Is the live transport wanted?
 *
 * Defaults to OFF. The codegen path is the proven one and stays the default until a
 * person has recorded through the live path and confirmed the recorder UI, the
 * picker, the assert toolbar and saving all behave - which is a human gate, not
 * something this file can assert.
 */
export function liveTransportRequested(): boolean {
  return (process.env[TRANSPORT_ENV] ?? '').toLowerCase() === 'live';
}

export interface LiveSession {
  /**
   * Stop, and return the generated source, whatever evidence was captured, and
   * the state assertions the person recorded through the picker.
   *
   * The three are separate because they come from different places and must not
   * be confused: the source is Codegen's, the evidence is the capture's, and the
   * assertions are the person's own statements of intent - the one thing in a
   * recording that was never inferred from anything.
   */
  stop(): Promise<{
    source: string; evidence: RecordingEvidence; stateAssertions: RecordedAssertion[];
  }>;
  /** Kill without collecting anything. Used when a start fails half-way. */
  dispose(): Promise<void>;
  metrics: LiveMetrics;
}

export interface LiveMetrics {
  startupMs: number;
  targetCount: number;
  captureMs: number[];
  /** Bytes of the sanitised evidence, so growth is visible. */
  evidenceBytes: number;
  failures: number;
  /** Was the pre-action hook installed? False means every graph is after-action. */
  preActionHook: boolean;
  /** Graphs taken before the interaction took effect. The ones worth having. */
  beforeActionCount: number;
  /** Graphs read from the page after the fact, because no pre-action one matched. */
  afterActionCount: number;
  /** Targets whose evidence showed a scrollable ancestor clipping them. */
  scrollRequiredCount: number;
  /** Entries the page pushed out as they were parked. Diagnostic, not a verdict. */
  parkedCount: number;
  /** Targets inside a container that DECLARED itself virtualized. */
  virtualizedCount: number;
  /** Parked presses whose candidates were measured in the document of the press. */
  pressMeasuredCount: number;
  /** Presses whose press-time measurement never completed - usually a lost race. */
  pressMeasureFailures: number;
  /** Candidates measured at one element AND proven to be the element pressed. */
  identityProvenCount: number;
  /** Candidates measured at one element that turned out to be a DIFFERENT element. */
  identityMismatchCount: number;
  /** Targets whose count was discarded because the document had already changed. */
  documentChangedCount: number;
  /** Was the assertion picker installed? False means the page has no picker. */
  pickerInstalled: boolean;
  /** State assertions the person recorded through it. */
  pickedAssertions: number;
  /** Assertions refused because their attribute name looked like a secret. */
  refusedAssertions: number;
  /** Assertions whose locator was proven contextually at pick time. */
  contextualAssertions: number;
  /** Assertions whose subject the browser matched to a recorded press by identity. */
  provenanceAssertions: number;
  /**
   * Assertions whose element was captured and measured AT THE PICK.
   *
   * The number that separates "this assertion has evidence of its own" from "this
   * assertion borrowed an action's". Before pick-time capture the second was the only
   * possibility, and an assertion made before any action had neither.
   */
  assertionCaptures: number;
  /**
   * Assertions where no press matched the subject, so no evidence may be adopted.
   *
   * Counted rather than logged as a failure: an assertion about an element nobody
   * interacted with is ordinary and correct, and it simply has no provenance.
   */
  provenanceUnavailable: number;
}

/** The browser-side capture, compiled once. See dom-capture-source.ts for why. */
const captureFunction = new Function(`return ${ELEMENT_CAPTURE}`)() as (element: Element) => unknown;

/**
 * Start a recording in a browser this process owns.
 *
 * Returns `null` for every failure - missing internal API, launch failure, recorder
 * refusal - and the caller then uses the existing codegen path. The reason is logged
 * to the returned session's evidence, never thrown.
 */
export async function startLiveRecording(options: {
  url: string;
  browser: string;
  onLog?: (text: string) => void;
}): Promise<LiveSession | null> {
  const log = options.onLog ?? (() => {});
  const startedAt = Date.now();
  const metrics: LiveMetrics = {
    startupMs: 0, targetCount: 0, captureMs: [], evidenceBytes: 0, failures: 0,
    preActionHook: false, beforeActionCount: 0, afterActionCount: 0,
    scrollRequiredCount: 0, parkedCount: 0, virtualizedCount: 0,
    pressMeasuredCount: 0, pressMeasureFailures: 0, identityProvenCount: 0,
    identityMismatchCount: 0, documentChangedCount: 0,
    pickerInstalled: false, pickedAssertions: 0, refusedAssertions: 0,
    contextualAssertions: 0, provenanceAssertions: 0, provenanceUnavailable: 0,
    assertionCaptures: 0,
  };

  let playwright: typeof import('playwright');
  try {
    playwright = require('playwright');
  } catch (error) {
    log(`live recorder unavailable: playwright could not be loaded (${String(error)})\n`);
    return null;
  }

  // The browser name is a string chosen at run time, so the launcher has to be looked
  // up by key. Typed as the record it actually is rather than as `any`: an `any` here
  // spreads to `browser` below, which then never narrows away its `null` initialiser -
  // so every use of it downstream was unchecked by the compiler for no reason.
  const engines = playwright as unknown as Record<string, typeof playwright.chromium>;
  const engine = engines[options.browser] ?? playwright.chromium;
  const outputFile = path.join(os.tmpdir(),
      `live-recording-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.spec.ts`);

  let browser: Awaited<ReturnType<typeof playwright.chromium.launch>> | null = null;
  try {
    browser = await engine.launch({ headless: false });
    const context = await browser.newContext();

    // The capability check the whole design hangs on. Not a version test: the method
    // either exists on this object or it does not, and asking is cheaper and more
    // honest than parsing a version string.
    const enableRecorder = (context as any)._enableRecorder;
    if (typeof enableRecorder !== 'function') {
      log('live recorder unavailable: context._enableRecorder is not a function on this '
        + 'Playwright build - falling back to the codegen recorder\n');
      await browser.close().catch(() => {});
      return null;
    }

    // `playwright-test`, exactly what the codegen CLI asks for (`--target
    // playwright-test`). NOT `javascript`: the library target cannot run assertions -
    // `expect` is not importable there - so Playwright's recorder emits them COMMENTED
    // OUT. The parser reads only lines starting with `await `, so every recorded
    // assertion vanished, the Expected Result became the "Needs confirmation"
    // placeholder, and the case was skipped before generation. TC_LOGIN_053 and 054
    // were both lost that way, with their assertions sitting in the artifact behind
    // `// await expect(...)`.
    await enableRecorder.call(context, {
      language: 'playwright-test',
      mode: 'recording',
      outputFile,
      handleSIGINT: false,
    });

    // Installed before the first page exists, so it is present on every page and
    // every navigation - including the one the recording starts with. Passive
    // listeners only; see PREACTION_HOOK for why it cannot change what is recorded.
    try {
      // Registered BEFORE the init script, so the hook always finds it. Every parked
      // entry is copied out the moment it is parked; without this the only copy lives on
      // a document that a navigating click destroys before the file watcher (400ms) ever
      // asks for it. Bounded, and it never reads the page.
      // A BINDING, not a plain function: the binding hands back the frame the press
      // happened in, and that frame is the only place the press-time document can
      // still be measured. `exposeFunction` gave us the entry and nothing to measure
      // it against.
      await context.exposeBinding('__auraPark', (source: any, entry: any) =>
        recordParkedEntry(source?.frame ?? source?.page, entry, metrics));
      await context.addInitScript({ content: PREACTION_HOOK });
      metrics.preActionHook = true;

      // ---- the assertion picker (P1 Phase 2B) --------------------------------
      //
      // Two bindings and one init script, all additive. The page asks what may be
      // asserted (`__auraDescribe`) and says what the person chose
      // (`__auraAssert`); every semantic decision is made HERE, by the Phase 2A
      // resolver, so the page holds no rules of its own.
      await context.exposeBinding('__auraDescribe', (_source: any, payload: any) => {
        try {
          return pickerModel(payload);
        } catch {
          return null;
        }
      });
      await context.exposeBinding('__auraAssert', async (source: any, payload: any) =>
        recordAssertionFromPicker(
            source?.frame ?? source?.page, payload, picked, outputFile, metrics, pickCaptures));
      await context.addInitScript({ content: ASSERTION_PICKER });
      metrics.pickerInstalled = true;
      // Said out loud, and only on success. P1.2 established that a recording had
      // been made with the picker installed and working, and that nothing anywhere
      // - not the log, not the sidecar, not the UI - said so, which is why the
      // question "was it installed?" could only be answered by reproducing the
      // whole startup afterwards.
      log('[recorder] assertion picker ready\n');
    } catch {
      // Without the hook, capture falls back to reading the page when the action
      // line appears - Phase 8C's behaviour, and the timing is recorded as such.
      metrics.preActionHook = false;
    }

    const page = await context.newPage();
    await page.goto(options.url);
    metrics.startupMs = Date.now() - startedAt;
    log(`live recorder ready in ${metrics.startupMs}ms (evidence capture is on)\n`);

    const captured = new Map<string, TargetEvidence>();
  /** State assertions the person recorded, in the order they recorded them. */
  const picked: RecordedAssertion[] = [];
  /**
   * Evidence captured AT each assertion pick, keyed by its own `captureRef`.
   *
   * A second map beside `captured` rather than an entry in it: `captured` is keyed by
   * the recorded locator, and a pick has no recorded locator - two different elements
   * routinely compose the same expression, so keying these by string is the very
   * mis-association the mechanism exists to remove.
   */
  const pickCaptures = new Map<string, TargetEvidence>();
    const watcher = watchForTargets(outputFile, async locator => {
      const at = Date.now();
      try {
        const evidence = await captureFor(page, locator, metrics);
        if (evidence) {
          captured.set(locator, evidence);
          metrics.captureMs.push(Date.now() - at);
          if (evidence.captureTiming === 'before-action')
            metrics.beforeActionCount++;
          else
            metrics.afterActionCount++;
          if (evidence.viewport?.scrollRequired)
            metrics.scrollRequiredCount++;
          if ([evidence.target, ...(evidence.ancestors ?? [])].some(node => node.virtualized))
            metrics.virtualizedCount++;
        }
      } catch {
        // A target that has already gone (a modal that closed, a row that
        // re-rendered) is normal during a recording and is not worth a failed
        // recording. It is counted, not raised.
        metrics.failures++;
      }
    });

    const finish = async () => {
      watcher.stop();
      let source = '';
      try {
        source = fs.readFileSync(outputFile, 'utf8');
      } catch {
        source = '';
      }
      // One last pass, so a target recorded moments before Stop is not missed.
      for (const locator of localorsIn(source)) {
        if (captured.has(locator))
          continue;
        try {
          const evidence = await captureFor(page, locator, metrics);
          if (evidence)
            captured.set(locator, evidence);
        } catch {
          metrics.failures++;
        }
      }
      await browser?.close().catch(() => {});
      fs.rmSync(outputFile, { force: true });

      // ACTION ROWS AND PICK ROWS, in one list. They are distinguishable by
      // `captureTiming` and reached by different keys, so nothing can mistake one for
      // the other - and an assertion's evidence travels in the same sidecar as
      // everything else rather than in a fourth file with its own lifecycle.
      const allTargets = [...captured.values(), ...pickCaptures.values()];
      let evidence: RecordingEvidence;
      try {
        metrics.targetCount = allTargets.length;
        evidence = allTargets.length
          ? sanitiseEvidence(allTargets, new Date().toISOString(), {
            transport: 'live',
            targetCount: allTargets.length,
            failures: metrics.failures,
            beforeActionCount: metrics.beforeActionCount,
            afterActionCount: metrics.afterActionCount,
            evidenceBytes: 0,
          })
          // Named so a reader can tell "live capture ran and found nothing" from
          // "live capture never ran" - the distinction that cost a whole diagnosis.
          : evidenceUnavailable('live capture was active but located no target in this recording'
            + ` (${metrics.failures} capture failure(s))`);
        metrics.evidenceBytes = JSON.stringify(evidence).length;
        if (evidence.available && evidence.recording)
          evidence.recording.evidenceBytes = metrics.evidenceBytes;
      } catch (error) {
        // Serialisation must never cost a recording.
        evidence = evidenceUnavailable(`evidence could not be serialised: ${String(error).slice(0, 120)}`);
      }
      metrics.targetCount = allTargets.length;
      return { source, evidence, stateAssertions: picked };
    };

    return {
      stop: finish,
      dispose: async () => {
        watcher.stop();
        await browser?.close().catch(() => {});
        fs.rmSync(outputFile, { force: true });
      },
      metrics,
    };
  } catch (error) {
    log(`live recorder unavailable: ${String(error).slice(0, 200)}\n`);
    await browser?.close().catch(() => {});
    fs.rmSync(outputFile, { force: true });
    return null;
  }
}

/* ------------------------------------------------------------ action stream */

/** Every `page.<chain>` a generated script mentions, in order, de-duplicated. */
export function localorsIn(source: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const line of source.split('\n')) {
    const match = /(?:await\s+)?(?:expect\()?\s*(page\.(?:locator|getBy|frame)[^;]*?)(?:\)\.(?:to[A-Z]\w*)|\.(?:click|fill|press|check|uncheck|selectOption|hover|dblclick)\s*\()/
        .exec(line.trim());
    if (!match)
      continue;
    const locator = match[1].trim().replace(/\s+/g, ' ');
    if (!seen.has(locator)) {
      seen.add(locator);
      found.push(locator);
    }
  }
  return found;
}

/** Poll the generated script and report each locator the first time it appears. */
function watchForTargets(file: string, onTarget: (locator: string) => void): { stop(): void } {
  const seen = new Set<string>();
  const timer = setInterval(() => {
    let source = '';
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      return;   // not written yet
    }
    for (const locator of localorsIn(source)) {
      if (seen.has(locator))
        continue;
      seen.add(locator);
      onTarget(locator);
    }
  }, 400);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/* --------------------------------------------------------------- capturing */

/**
 * Capture one target's surroundings from the live page.
 *
 * Reads only. `count()` first, because a locator that matches nothing is still worth
 * recording as evidence - "this matched zero at record time" is a fact a resolver
 * needs, and inventing 1 would be the exact error `MatchCount` exists to prevent.
 */
// Exported so the claim path - the pipeline's settled point, where the accessible-name
// stability comparison happens - can be driven against a real page without Codegen. Same
// reason `measureAtPress` and `splitCandidates` are exported; `startLiveRecording` remains
// its only production caller.
export async function captureFor(page: any, expression: string, metrics?: LiveMetrics): Promise<TargetEvidence | null> {
  // The graph the page parked when the person pressed on this element, BEFORE the
  // interaction took effect. Preferred whenever one matches, because reading the page
  // now reads a page that has already navigated, closed a modal or re-rendered a row.
  const preAction = await takePreAction(page, expression, metrics);
  if (preAction)
    return preAction;

  const locator = buildLocator(page, expression);
  if (!locator)
    return null;

  let matchCount: MatchCount = null;
  try {
    matchCount = await locator.count();
  } catch {
    matchCount = null;
  }
  if (!matchCount) {
    return {
      locator: expression, target: { tag: '(not found)' }, ancestors: [], children: [],
      descendants: [], previousSiblings: [], nextSiblings: [], relationships: [], matchCount,
      // SAY WHERE THE COUNT WAS TAKEN. Every other count in this file states its
      // document, and this branch was the one that did not - so a zero arrived as a bare
      // number with no way to tell "this locator names nothing" from "this locator was
      // counted on the page a click had already navigated to". `unknown` is the same
      // answer the successful after-action path below gives, and for the same reason:
      // no press was claimed, so there is no other document to compare against. Absence
      // used to have to stand in for it, which made a decision rule read the field's
      // absence as a fact about the page.
      matchCountDocument: 'unknown',
    };
  }

  const handle = await locator.first().elementHandle();
  if (!handle)
    return null;
  const raw = await handle.evaluate(captureFunction) as any;
  await handle.dispose();

  const { analyseIdentifier } = require('../autocode/locator-quality') as
    typeof import('../autocode/locator-quality');
  const identifier = raw.target.id ? analyseIdentifier(raw.target.id) : undefined;

  return {
    locator: expression,
    target: raw.target,
    parent: raw.parent,
    ancestors: raw.ancestors as RelatedNode[],
    children: raw.children as RelatedNode[],
    descendants: raw.descendants as RelatedNode[],
    previousSiblings: raw.previousSiblings as RelatedNode[],
    nextSiblings: raw.nextSiblings as RelatedNode[],
    relationships: [
      ...(raw.parent ? ['parent' as const] : []),
      ...(raw.children.length ? ['child' as const] : []),
      ...(raw.ancestors.length ? ['ancestor' as const] : []),
      ...(raw.descendants.length ? ['descendant' as const] : []),
      ...(raw.previousSiblings.length ? ['previous-sibling' as const] : []),
      ...(raw.nextSiblings.length ? ['next-sibling' as const] : []),
    ],
    matchCount,
    // No press was ever recorded for this target, so there is no other document to
    // compare with: the graph and the count were both taken from the page as it is
    // now. Consistent with each other, and evidence about no click in particular.
    matchCountDocument: 'unknown',
    captureTiming: 'after-action',
    attached: raw.attached,
    viewport: raw.viewport,
    ...(identifier ? { identifier: { raw: identifier.value, dynamic: identifier.dynamic, normalised: identifier.normalised } } : {}),
    ...splitCandidates(await measureCandidates(page, raw, expression), metrics),
  };
}

/* --------------------------------------------------- press-time measurement */

/**
 * Measure this press's candidates in the document the press happened in.
 *
 * WHY NOT LATER
 *
 * Everything else about a recorded target can be read when Codegen writes its line.
 * Uniqueness cannot: by then a click has navigated, a modal has closed or a list has
 * re-rendered, and `count()` answers about the page that REPLACED the one that was
 * clicked. Four live recordings measured `getByRole('button', { name: 'Sign In' })`
 * at 0 elements for exactly that reason, and TC_LOGIN_060 produced four candidates
 * measured at exactly one element each - on the page the click had arrived at.
 *
 * WHY NOT IN THE PAGE
 *
 * The candidates come from `candidateSelectorsFor`, which is the one place that knows
 * which shapes are worth measuring. Copying those rules into the browser string would
 * give the project two of them, and they would drift. So the derivation stays here
 * and only the measuring happens in the page - in ONE batched call, because a call
 * per candidate is a dozen round trips against a page the person is still using.
 *
 * Never throws: a lost race, a destroyed context and a missing hook are all recorded
 * on the entry as "not measured", which is the state the resolver already handles.
 */
// Exported so the press-time path can be driven against a real page without a person
// recording, the same reason `splitCandidates` is exported. `startLiveRecording` remains
// its only production caller.
export async function measureAtPress(frame: any, entry: any, metrics: LiveMetrics): Promise<void> {
  if (!frame || !entry?.graph || typeof entry.targetIndex !== 'number')
    return;

  // THE BROWSER'S NAME, BEFORE ANY CANDIDATE IS DERIVED FROM IT.
  //
  // The capture cannot compute an accessible name - no DOM API exposes one - so it
  // records `aria-label`/`title` and stamps them unverified. This is the only moment the
  // real answer can be had: the node is parked, its document still stands, and CDP can
  // be asked about that exact node. Applied here rather than at claim time because
  // `candidateSelectorsFor` runs on the next line and a name that arrives afterwards
  // would describe candidates nobody generated.
  //
  // Failure is silent and total: no session, no object id, no name, a navigation
  // mid-call - the approximation stays exactly as the page recorded it, still marked
  // unverified, and the recording continues.
  const computed = await browserAccessibleName(frame, entry);
  if (computed && entry.graph?.target) {
    entry.graph.target.accessibleName = computed.name;
    entry.graph.target.accessibleNameSource = 'browser-computed';
    entry.graph.target.accessibleNameVerified = true;
  }

  const generated = candidateSelectorsFor({ ...entry.graph }, looksGenerated);
  // TWO MEASUREMENT PATHS, AND THE SPLIT IS NOT A PREFERENCE.
  //
  // `__auraMeasure` evaluates a CSS selector with `querySelectorAll`, which cannot
  // express `getByRole` or `getByLabel` at all - no accessible-name computation exists
  // in that string, and putting one there would be a second locator engine. So the
  // semantic families are rebuilt with `buildLocator` on this side instead and
  // identity-checked against the same parked node, in the same document, at the same
  // moment. Both paths produce `measuredAt: 'press'` because both are the press.
  const candidates = generated.filter(candidate => candidate.measuredBy !== 'expression');
  const expressions = generated.filter(candidate => candidate.measuredBy === 'expression');
  // The element's own text, through the same filter a candidate's text passes: a
  // secret-shaped value never leaves the page, here or anywhere else.
  const ownText = usableCandidateText(entry.graph?.target?.text, looksGenerated);
  const byExpression = await measureExpressionCandidates(frame, entry, expressions);
  // THE CAPABILITY QUESTION, asked at the same moment and kept apart from the answer to
  // the candidate one. It is parked on the entry rather than merged into
  // `pressMeasurement.measured`, because everything in that list is a candidate for
  // emission and none of these ever is.
  entry.capabilityMeasurement = await measureDeclaredCapabilities(frame, entry);
  if (!candidates.length && !ownText) {
    entry.pressMeasurement = {
      measured: byExpression, sameDocument: true, attempted: expressions.length,
    };
    return;
  }
  try {
    const answer = await frame.evaluate(MEASURE_IN_PAGE, {
      index: entry.targetIndex,
      documentId: entry.documentId ?? null,
      ...(ownText ? { ownText } : {}),
      candidates: candidates.map(candidate => ({
        strategy: candidate.strategy,
        selector: candidate.selector,
        ...(candidate.text === undefined ? {} : { text: candidate.text, textMode: candidate.textMode }),
        // Without this the contextual family reaches the page as its container
        // alone - `.tabulator-row` - which measures ten and is refused. The whole
        // point of the shape is the element inside, so it travels with it.
        ...(candidate.descendant === undefined ? {} : { descendant: candidate.descendant }),
      })),
    });
    if (!answer) {
      // The CSS half could not be taken. Anything already measured by expression is
      // still a real measurement and is kept - a failure of one path is not a verdict
      // about the other.
      entry.pressMeasurement = {
        measured: byExpression, failed: 'the page carried no measurement hook',
        attempted: candidates.length + expressions.length,
      };
      metrics.pressMeasureFailures++;
      return;
    }
    // Results come back in the order they were sent, one per candidate, so the
    // expression each one belongs to is the one at the same index. The strategy is
    // carried too and compared, so a future change to either side fails loudly here
    // rather than quietly attributing a count to the wrong selector.
    const measured: CandidateMeasurement[] = [...byExpression];
    (answer.results ?? []).forEach((result: any, index: number) => {
      const candidate = candidates[index];
      if (!candidate || (result.strategy && result.strategy !== candidate.strategy))
        return;
      const entryMeasurement: CandidateMeasurement = {
        strategy: candidate.strategy,
        expression: candidate.expression,
        matchCount: typeof result.count === 'number' ? result.count : null,
        sameDocument: answer.sameDocument === true,
        measuredAt: 'press',
        // Only ever stated when there WAS an element to compare against. Without the
        // parked node the honest answer is "not asked", never "no".
        ...(answer.targetPresent ? { identityMatched: result.identityMatched === true } : {}),
        // WHICH of several matches was pressed. The page answers this only when the
        // expression matched more than one element and the pressed node was in that
        // list; anything else comes back null and is carried as ABSENCE, never as 0.
        // Dropping it here is what made the measurement unreachable: the in-page half
        // computed it, and the recorder threw it away before evidence was written.
        ...(typeof result.positionWithinCandidate === 'number'
          ? { positionWithinCandidate: result.positionWithinCandidate }
          : {}),
        ...(result.error ? { measurementError: String(result.error).slice(0, 80) } : {}),
      };
      measured.push(entryMeasurement);
    });
    entry.pressMeasurement = {
      measured, attempted: candidates.length + expressions.length,
      sameDocument: answer.sameDocument === true,
      targetPresent: answer.targetPresent === true,
      ...(ownText && answer.ownText
        ? {
          ownText: {
            text: ownText,
            matchCount: typeof answer.ownText.matchCount === 'number' ? answer.ownText.matchCount : null,
            identityMatched: answer.ownText.identityMatched === true,
          },
        }
        : {}),
    };
    if (answer.sameDocument === true)
      metrics.pressMeasuredCount++;
  } catch (error) {
    // The document went while we were asking - a click that navigated fast. Recorded,
    // not raised: this is the normal cost of measuring a page somebody else is driving.
    entry.pressMeasurement = {
      measured: byExpression, failed: String(error).slice(0, 120),
      attempted: candidates.length + expressions.length,
    };
    metrics.pressMeasureFailures++;
  }
}

/* ------------------------------------------------- the browser's accessible name */

/**
 * One CDP session per page, or a remembered null. A CAPABILITY, never a requirement.
 *
 * `newCDPSession` exists on Chromium only, so Firefox and WebKit resolve to null once
 * and are never asked again. A recording is NEVER refused for want of it: the capture's
 * own `aria-label`/`title` approximation stands, marked unverified, and every candidate
 * built from it is measured and refused exactly as before. Nothing about the gate moves.
 */
const cdpSessions = new WeakMap<object, Promise<any | null>>();

function accessibilitySession(page: any): Promise<any | null> {
  const existing = cdpSessions.get(page);
  if (existing)
    return existing;
  const opened = (async () => {
    try {
      const session = await page.context().newCDPSession(page);
      await session.send('Accessibility.enable');
      return session;
    } catch {
      // Not Chromium, or the session could not be opened. Remembered as "no", so the
      // cost of asking is paid once per page rather than once per press.
      return null;
    }
  })();
  cdpSessions.set(page, opened);
  return opened;
}

/**
 * The BROWSER'S computed accessible name for one parked node - or null.
 *
 * Reached through the registry rather than through a Playwright handle, because
 * `window.__auraTargets[slot]` is already the expression both sides agree names this
 * element, and `Runtime.evaluate` hands back the object id
 * `Accessibility.getPartialAXTree` needs. Converting an ElementHandle would need an
 * internal Playwright id that is not part of its API.
 *
 * THE DOCUMENT GUARD IS FREE HERE. `__auraTargets` belongs to the document that parked
 * the node; after a navigation the array is fresh and the slot is empty, so a name can
 * never be attributed to an element from a page the person did not act on.
 *
 * `fetchRelatives: false` keeps this to the node itself - no subtree, no ancestors, no
 * page-level accessibility snapshot. Measured at 66 bytes for the name and role.
 */
async function browserAccessibleName(
  frame: any,
  entry: any,
): Promise<{ name: string; role?: string } | null> {
  const page = typeof frame?.page === 'function' ? frame.page() : frame;
  if (!page || typeof entry?.targetIndex !== 'number')
    return null;
  const session = await accessibilitySession(page);
  if (!session)
    return null;
  let objectId: string | undefined;
  try {
    const evaluated: any = await session.send('Runtime.evaluate', {
      expression: `window.__auraTargets && window.__auraTargets[${Number(entry.targetIndex)}]`,
      returnByValue: false,
    });
    objectId = evaluated?.result?.objectId;
    if (!objectId)
      return null;
    const tree: any = await session.send('Accessibility.getPartialAXTree', {
      objectId, fetchRelatives: false,
    });
    const node = (tree?.nodes ?? [])[0];
    const name = typeof node?.name?.value === 'string' ? node.name.value.trim() : '';
    if (!name)
      return null;
    const role = typeof node?.role?.value === 'string' ? node.role.value : undefined;
    return { name: name.slice(0, 120), role };
  } catch {
    // A navigation mid-call, a detached node, a domain that refused. Not a verdict.
    return null;
  } finally {
    if (objectId)
      await session.send('Runtime.releaseObject', { objectId }).catch(() => {});
  }
}

/**
 * Is the slot still holding the very element the press parked, in the press's document?
 *
 * THE GUARD PHASE 6 PROVED IS NOT OPTIONAL. Two reads of a stale slot agree with each
 * other and mean nothing: the experiment measured Flipkart's Mobiles link as `stable`
 * carrying the login modal's name, because the newest slot still held an earlier element.
 * Equal strings are not evidence of stability - equal strings ABOUT THE SAME ELEMENT are.
 *
 * What makes the slot a safe key at all is that `allocate` never reuses an index: it
 * increments a counter and NULLS the slot MAX presses ago, so `targets[slot]` holds either
 * the original node or nothing. That is why this can be answered without keeping a
 * reference to the node across the two moments - a reference nothing here could hold.
 *
 * Three things are checked and all three must hold: the document is the one that parked
 * it, the slot is still populated, and the node is still attached. Anything else is a
 * refusal, which the caller turns into `unknown`.
 */
const SLOT_STILL_HOLDS_TARGET = new Function('payload', `
  if (typeof window.__auraDocument !== 'string') return false;
  if (payload.documentId && window.__auraDocument !== payload.documentId) return false;
  var targets = window.__auraTargets;
  if (!Array.isArray(targets)) return false;
  var node = targets[payload.index];
  if (!node || node.nodeType !== 1) return false;
  return node.isConnected === true;
`) as any;

/**
 * The settled-point half of the accessible-name stability measurement.
 *
 * COLLECTION ONLY - the result is written to evidence and read by nothing that decides a
 * locator. Called at the point the pipeline already treats as settled: when Codegen has
 * written its line and `takePreAction` is claiming the entry. No sleep is introduced and
 * no new lifecycle point is invented; if that moment cannot answer, the answer is
 * `unknown`.
 *
 * Reuses the per-page CDP session opened at the press - one session per page, never one
 * per measurement.
 */
async function measureNameStability(
  page: any,
  claimed: any,
  sameDocument: boolean,
): Promise<'stable' | 'changed' | 'unknown'> {
  const target = claimed?.graph?.target;
  const pressName: string | undefined = target?.accessibleName;
  const pressVerified: boolean = target?.accessibleNameVerified === true;

  // Everything the classifier needs is gathered first, and every failure to gather one
  // simply leaves it in the shape the classifier already refuses.
  let slotHoldsTarget = false;
  let settledName: string | null = null;
  if (pressVerified && pressName && sameDocument && typeof claimed.targetIndex === 'number') {
    try {
      slotHoldsTarget = await page.evaluate(SLOT_STILL_HOLDS_TARGET, {
        index: claimed.targetIndex,
        documentId: claimed.documentId ?? null,
      }) === true;
      if (slotHoldsTarget)
        settledName = (await browserAccessibleName(page, claimed))?.name ?? null;
    } catch {
      // A navigation mid-measurement, a destroyed context, a domain that refused. Not a
      // verdict about the name - the classifier reads this as unproven.
      slotHoldsTarget = false;
      settledName = null;
    }
  }
  return classifyNameStability({
    pressName, pressVerified, sameDocument, slotHoldsTarget, settledName,
  });
}

/**
 * Compare the two names, or refuse to. THE WHOLE DECISION, in one pure function.
 *
 * Separated from the measurement so every refusal can be tested without a browser - the
 * refusals are the part that matters, and the part that was got wrong in Phase 6.
 *
 * FAIL CLOSED, IN ORDER. Each guard below answers a question that must be YES before two
 * strings mean anything:
 *
 *   - was the press-time name the BROWSER'S? An in-page approximation reads one attribute;
 *     two equal reads of it say the attribute held still, which is not the question.
 *   - is this the same DOCUMENT? Two names from two pages are never compared.
 *   - does the slot still hold that element, attached? Two reads of a stale slot agree
 *     with each other and mean nothing - Phase 6 measured exactly that and got a
 *     confident, false `stable`.
 *   - did the settled read produce a name at all?
 *
 * Only then does equality decide, and `changed` remains a statement about the NAME rather
 * than a verdict about any locator built from it.
 */
export function classifyNameStability(input: {
  pressName?: string;
  pressVerified?: boolean;
  sameDocument: boolean;
  slotHoldsTarget: boolean;
  settledName: string | null;
}): 'stable' | 'changed' | 'unknown' {
  if (input.pressVerified !== true || !input.pressName)
    return 'unknown';
  if (!input.sameDocument)
    return 'unknown';
  if (!input.slotHoldsTarget)
    return 'unknown';
  if (input.settledName === null || input.settledName === undefined)
    return 'unknown';
  return input.settledName === input.pressName ? 'stable' : 'changed';
}

/**
 * Does this candidate still identify the SAME element after the screen changed state?
 *
 * A DIFFERENT QUESTION FROM `classifyNameStability`, and the two are deliberately not
 * derived from one another. That one asks whether the browser-computed accessible NAME
 * held still; this asks whether a specific LOCATOR still names the element that was
 * pressed. Measured on Bugasura, they come apart in both directions: the email field's
 * name changes when its validation message appears, and `getByRole('textbox', { name:
 * 'Email' })` still matches exactly that field - a changed name with a durable locator;
 * and a name can hold perfectly still while a second element appears whose name contains
 * it, which makes the same locator ambiguous without the name moving at all.
 *
 * PURE, so every refusal is testable without a browser - the refusals are the whole of
 * it. FAIL CLOSED, in this order, because each guard answers a question that must be YES
 * before a count means anything:
 *
 *   - was the candidate PROVEN at the press? Durability is a statement about a candidate
 *     that identified the target; a candidate that never did cannot survive anything.
 *   - is this the same DOCUMENT? A count taken on another page is not about this element.
 *   - does the slot still hold that element, attached? A released or detached target
 *     makes the identity answer meaningless rather than false.
 *   - was a count taken at all? `null` is "not measured" everywhere here and is never
 *     read as zero.
 *
 * Then, and only then: 0 is `unresolved`, more than one is `ambiguous` (whether or not
 * the target is among them - a locator matching several is not a locator), exactly one
 * WITH identity is `durable`, exactly one WITHOUT it is `wrong-target`, and exactly one
 * whose identity was never asked is `unknown`. One element is never durable on its own.
 *
 * COLLECTION ONLY. Nothing in the recording path calls this, no evidence field carries
 * its verdict, and no locator is chosen or rejected by it.
 */
export function classifyDurability(input: {
  pressProven: boolean;
  sameDocument: boolean;
  slotHoldsTarget: boolean;
  matchCount: number | null | undefined;
  identityMatched?: boolean | null;
}): 'durable' | 'ambiguous' | 'wrong-target' | 'unresolved' | 'unknown' {
  if (input.pressProven !== true)
    return 'unknown';
  if (input.sameDocument !== true)
    return 'unknown';
  if (input.slotHoldsTarget !== true)
    return 'unknown';
  if (input.matchCount === null || input.matchCount === undefined)
    return 'unknown';
  if (input.matchCount === 0)
    return 'unresolved';
  if (input.matchCount > 1)
    return 'ambiguous';
  if (input.identityMatched === true)
    return 'durable';
  if (input.identityMatched === false)
    return 'wrong-target';
  return 'unknown';
}

/**
 * The parked node for one slot, in the document that parked it - or null.
 *
 * Compiled with `new Function` for the same reason every other page-side helper here
 * is: tsx rewrites a literal to add a `__name` helper the page does not have.
 *
 * THE DOCUMENT CHECK IS INSIDE, not outside. A node read from a document that has since
 * been replaced is a node from a different page, and comparing a candidate against it
 * would produce an identity answer about something nobody clicked. Refusing here means
 * the caller cannot forget.
 */
const READ_PARKED_TARGET = new Function('payload', `
  if (typeof window.__auraDocument !== 'string') return null;
  if (payload.documentId && window.__auraDocument !== payload.documentId) return null;
  var targets = window.__auraTargets;
  if (!Array.isArray(targets)) return null;
  var node = targets[payload.index];
  return node && node.nodeType === 1 ? node : null;
`) as any;

/** Node identity, asked of the page. Only the page can compare two nodes. */
const SAME_NODE_IN_PAGE = new Function('pair', 'return pair[0] === pair[1];') as any;

/**
 * How many matches are worth walking to find WHICH one was pressed.
 *
 * A unique candidate costs one comparison; an ambiguous one costs its whole match list,
 * and a bare tag on a large page matches hundreds. The page-side measurement is a single
 * batched evaluate and can afford `indexOf`; this side pays a round trip per handle, so
 * the position is measured for a bounded list and honestly left unmeasured above it -
 * never guessed, and never a reason to skip the count itself.
 */
const EXPRESSION_POSITION_LIMIT = 30;

/**
 * How many declared capabilities one interaction may be measured against.
 *
 * A bound on the person's own click, not a correctness knob. The measurement is fire and
 * forget and races the navigation a click may start; asking about two hundred locators
 * would lose that race and produce nothing at all. What is beyond the bound is simply not
 * measured, and an unmeasured capability is NOT PROVEN - which is the answer the analyser
 * already gives for every capability nobody asked about.
 */
const MAX_CAPABILITY_MEASUREMENTS = 40;

/**
 * The capabilities of the ACTIVE application whose declared locator can be resolved.
 *
 * Read from knowledge, which is scoped: a capability belonging to another application is
 * not in this list and can never be measured, let alone matched. Read once per recording
 * process - knowledge does not change while a person is recording - and re-read if the
 * scope is reset, because the fixtures do exactly that.
 *
 * A DECLARED LOCATOR IS PROSE UNTIL IT IS AN EXPRESSION. Most entries describe their
 * element in words ("an authored id; its classes are state"), and words cannot be
 * resolved against anything. Only an expression is taken, and only one with no parameter
 * standing where a value belongs: a template is instantiated by the caller, so it is not
 * a locator until somebody supplies the argument. Both exclusions fail closed - the
 * capability is simply not measured, and therefore not proven.
 */
let capabilityCache: { key: string; entries: SelectorCandidate[];
  owners: Array<{ owner: string; method: string }> } | null = null;

export function resetCapabilityCache(): void {
  capabilityCache = null;
}

function declaredCapabilities(): { entries: SelectorCandidate[];
    owners: Array<{ owner: string; method: string }> } {
  let key = '';
  try {
    key = activeScopePath('knowledgePageDir');
  } catch {
    // No resolvable scope means no application, and an application is what owns a
    // capability. Nothing is measured rather than something being guessed.
    return { entries: [], owners: [] };
  }
  if (capabilityCache?.key === key)
    return capabilityCache;
  const entries: SelectorCandidate[] = [];
  const owners: Array<{ owner: string; method: string }> = [];
  try {
    for (const page of readAllPageKnowledge()) {
      for (const element of page.elements) {
        if (entries.length >= MAX_CAPABILITY_MEASUREMENTS)
          break;
        const owner = element.page_object;
        const method = element.page_object_method;
        const declared = (element.locator_strategy ?? '').trim();
        if (!owner || !method || !/^page\s*\./.test(declared))
          continue;
        // A parameter standing where a quoted value belongs. `buildLocator` would refuse
        // it anyway - this only avoids spending a measurement to be told so.
        if (/(hasText|hasNotText)\s*:\s*[^'"\s)]/.test(declared) || /getBy\w+\(\s*[^'"]/.test(declared))
          continue;
        entries.push({ strategy: 'capability', selector: '', expression: declared,
          measuredBy: 'expression' });
        owners.push({ owner, method });
      }
    }
  } catch {
    // Unreadable knowledge is not an error here: it means nothing can be proven, and
    // nothing is.
    return { entries: [], owners: [] };
  }
  capabilityCache = { key, entries, owners };
  return capabilityCache;
}

/**
 * DOES ANY ESTABLISHED CAPABILITY'S DECLARED LOCATOR RESOLVE TO THIS VERY ELEMENT?
 *
 * The measurement Phase 13.5 proved the framework did not have. Before it, the analyser
 * compared a trailing selector TOKEN between two expressions and called agreement
 * identity - which is not identity in either direction, and was wrong 8 times in 9 on the
 * corpus. This asks the browser instead, at the interaction, in the interaction's own
 * document, and takes its answer.
 *
 * Every result carries the capability it was taken for, so an answer can be attributed at
 * all; nothing else about the measurement differs from any other expression measurement,
 * including the bar it must clear to prove anything.
 */
export async function measureDeclaredCapabilities(
  frame: any,
  entry: any,
  measuredAt: 'press' | 'pick' = 'press',
): Promise<CandidateMeasurement[]> {
  const declared = declaredCapabilities();
  if (!declared.entries.length)
    return [];
  const measured = await measureExpressionCandidates(frame, entry, declared.entries, measuredAt);
  // Results come back one per input, in order, exactly as the candidate path relies on.
  // A short list would misattribute every answer after the gap, so it is refused whole.
  if (measured.length !== declared.entries.length)
    return [];
  return measured.map((candidate, index) => ({ ...candidate, capability: declared.owners[index] }));
}

/**
 * Measure Playwright-expressed candidates at the press, against the pressed node.
 *
 * The same bar as the in-page path, reached differently: exactly one element, in the
 * press's own document, and that element is the one acted on. `buildLocator` rebuilds
 * the expression faithfully or refuses it - a refusal is `matchCount: null`, which means
 * "not measured" everywhere downstream and is never read as ambiguity.
 *
 * Never throws. A navigation mid-measurement, a destroyed context and a released slot
 * all end as "not measured", which is a state the resolver already handles.
 */
export async function measureExpressionCandidates(
  frame: any,
  entry: any,
  candidates: SelectorCandidate[],
  /**
   * WHEN this measurement was taken. `press` for an action, `pick` for an assertion -
   * the same distinction the in-page path already states, and for the same reason: an
   * assertion is a claim about the page as it stood when the person made it, so the
   * pick is the right moment rather than a weaker one.
   */
  measuredAt: 'press' | 'pick' = 'press',
): Promise<CandidateMeasurement[]> {
  if (!frame || !candidates.length || typeof entry?.targetIndex !== 'number')
    return [];
  let target: any = null;
  try {
    const handle = await frame.evaluateHandle(READ_PARKED_TARGET, {
      index: entry.targetIndex,
      documentId: entry.documentId ?? null,
    });
    target = handle?.asElement?.() ?? null;
  } catch {
    return [];
  }
  // No parked node means the document moved on or the slot was released. Measuring the
  // count alone would produce a candidate with no identity answer at all, which
  // `splitCandidates` would then judge on cardinality - the pre-P0.7 bar this whole
  // mechanism exists to replace. Nothing is better than that.
  if (!target)
    return [];

  const measured: CandidateMeasurement[] = [];
  try {
    for (const candidate of candidates) {
      const locator = buildLocator(frame, candidate.expression);
      if (!locator) {
        measured.push({
          strategy: candidate.strategy, expression: candidate.expression, matchCount: null,
          sameDocument: true, measuredAt,
          measurementError: 'the expression could not be rebuilt faithfully',
        });
        continue;
      }
      let count: number | null = null;
      try {
        count = await locator.count();
      } catch {
        count = null;
      }
      if (count === null) {
        measured.push({
          strategy: candidate.strategy, expression: candidate.expression, matchCount: null,
          sameDocument: true, measuredAt,
          measurementError: 'the expression could not be counted',
        });
        continue;
      }
      let identityMatched = false;
      let position: number | null = null;
      if (count > 0 && count <= EXPRESSION_POSITION_LIMIT) {
        try {
          const handles = await locator.elementHandles();
          for (let index = 0; index < handles.length; index++) {
            if (await frame.evaluate(SAME_NODE_IN_PAGE, [handles[index], target])) {
              // IDENTITY, not similarity - and only ever claimed for a unique match, so
              // this side and the in-page side answer the same question the same way.
              if (count === 1)
                identityMatched = true;
              else
                position = index;
              break;
            }
          }
          for (const handle of handles)
            await handle.dispose().catch(() => {});
        } catch {
          // The page moved while we were asking. The count stands; identity does not.
        }
      }
      measured.push({
        strategy: candidate.strategy,
        expression: candidate.expression,
        matchCount: count,
        // Guaranteed by READ_PARKED_TARGET, which refuses to hand back a node from any
        // document but the one that parked it. A node in hand IS the same document.
        sameDocument: true,
        measuredAt,
        identityMatched,
        ...(position === null ? {} : { positionWithinCandidate: position }),
      });
    }
  } finally {
    await target.dispose?.().catch?.(() => {});
  }
  return measured;
}

/** The capability measurements a claimed entry carries, if any. */
function capabilityMeasurementsOf(claimed: any): CandidateMeasurement[] {
  const measured = claimed?.capabilityMeasurement;
  return Array.isArray(measured) ? measured as CandidateMeasurement[] : [];
}

/** The press-time measurements a claimed entry carries, if any. */
function pressMeasurements(claimed: any): CandidateMeasurement[] {
  const measured = claimed?.pressMeasurement?.measured;
  return Array.isArray(measured) ? measured as CandidateMeasurement[] : [];
}

/**
 * Split measured candidates into what may be promoted and what may only be read.
 *
 * PROMOTABLE is deliberately narrow and asymmetric:
 *   - a press-time candidate must be proven against the element that was pressed;
 *   - a claim-time candidate keeps the pre-P0.7 bar (measured at exactly one
 *     element), because identity was never asked there and an absent answer must not
 *     read as a failed one - that would silently un-resolve every generated id that
 *     resolves from a recording made today;
 *   - a candidate whose identity was CHECKED and came back false is refused outright,
 *     wherever it was measured. One element that is the wrong element is the failure
 *     this exists to catch.
 */
// Exported for `positional-wiring.fixture.ts` only. The wiring this function
// performs had no test, which is how a position measured in the page reached
// evidence as nothing at all for as long as the field existed.
export function splitCandidates(all: CandidateMeasurement[], metrics?: LiveMetrics): {
  derivedCandidates: CandidateMeasurement[];
  rejectedCandidates: CandidateMeasurement[];
  positionProvenCandidates: CandidateMeasurement[];
  candidatesTried: number;
} {
  const derivedCandidates: CandidateMeasurement[] = [];
  const rejectedCandidates: CandidateMeasurement[] = [];
  // A THIRD ANSWER, and it is deliberately not a third BRANCH. A candidate that
  // matched several elements is not a unique locator and never becomes one, so it
  // still goes to `rejectedCandidates` with its reason - nothing is promoted and
  // `derivedCandidates` keeps meaning exactly what it meant. What this list adds is
  // the separate fact that the browser also recorded WHICH of those matches was
  // pressed. Without it the position had nowhere to live: the only channel to
  // evidence read `derivedCandidates`, which admits `matchCount === 1` alone, so a
  // position-proven candidate was filtered out at both ends and every recording
  // reported no measurement at all.
  const positionProvenCandidates: CandidateMeasurement[] = [];
  for (const candidate of all) {
    const promotable = candidate.measuredAt === 'press'
      ? isProvenAgainstClickedTarget(candidate)
      // A pick-time candidate is held to the SAME substantive bar as a press-time one -
      // one element, in the document being looked at, and that element is the subject -
      // just at a different moment. Stated rather than left to the claim-time fallback
      // below, which only ever asked for a count.
      : candidate.measuredAt === 'pick'
        ? isProvenAtPick(candidate)
        : candidate.matchCount === 1 && candidate.identityMatched !== false;
    if (promotable) {
      derivedCandidates.push(candidate);
      if (candidate.identityMatched === true && metrics)
        metrics.identityProvenCount++;
      continue;
    }
    if (candidate.identityMatched === false && metrics)
      metrics.identityMismatchCount++;
    // Ambiguous AND positioned. It is refused as a locator on the line below, exactly
    // as before, and recorded here as a measurement in its own right. Either timing
    // qualifies; which timing a CONSUMER may act on is the consumer's rule, not this
    // list's - an action still demands a press, an assertion may use its own pick.
    if (isPositionProven(candidate))
      positionProvenCandidates.push(candidate);
    rejectedCandidates.push({
      ...candidate,
      rejectionReason: candidateRejection(candidate) ?? 'not proven against the element that was pressed',
    });
  }
  return { derivedCandidates, rejectedCandidates, positionProvenCandidates, candidatesTried: all.length };
}

/**
 * Claim the pre-action graph for this locator, if the page parked one for it.
 *
 * Matched by the element's OWN identity against the literals in the recorded chain -
 * an id, a test id, an accessible name, a text, a placeholder. Never by ordering: a
 * recording contains navigations and assertions that produce no pointer event, and
 * "the next one in the queue" would silently pair a graph with the wrong element,
 * which is worse than having no graph at all.
 *
 * A claimed entry is removed from the queue, so the same graph cannot be handed to
 * two different locators.
 */
/**
 * Everything the `__auraPark` binding does, in one place.
 *
 * Extracted verbatim from the binding so the parked-entry mirror and the press
 * measurement stay a single behaviour rather than two that a caller has to remember to
 * perform together - the claim path reads the MIRROR, and an entry measured without being
 * mirrored is an entry `takePreAction` will re-read from the page, losing the
 * browser-computed name that `measureAtPress` wrote onto this copy.
 */
export function recordParkedEntry(frame: any, entry: any, metrics: LiveMetrics): void {
  if (parkedEntries.length >= MAX_PARKED)
    parkedEntries.shift();
  parkedEntries.push(entry);
  metrics.parkedCount++;
  // Fire and forget, deliberately. The page called this from a passive pointerdown
  // listener and does not await it; awaiting here would put this process in the path of
  // the person's own click. The measurement races the navigation that a click may start,
  // and losing that race costs nothing: the entry simply carries no press measurement and
  // the resolver behaves as it did before P0.7.
  void measureAtPress(frame, entry, metrics);
}

/** Entries pushed out of the page by `window.__auraPark`, newest last. Bounded. */
const parkedEntries: any[] = [];
const MAX_PARKED = 120;

/** Which parked entries have already answered a recorded line. */
const claimedKeys = new Set<string>();

/** Identity of one parked entry: when it happened, and what was pressed. */
export function entryKey(entry: any): string {
  const print = entry?.fingerprint ?? {};
  return [entry?.at, entry?.kind, print.tag, print.id, print.text].join('|');
}

/** Read whatever is still parked in the live document. Compiled: tsx would add `__name`. */
const READ_PARKED = new Function(
    `return Array.isArray(window.__auraPreAction) ? window.__auraPreAction.slice() : [];`);

/** This document's nonce. Compiled for the same reason as READ_PARKED. */
const READ_DOCUMENT_ID = new Function(
    `return typeof window.__auraDocument === 'string' ? window.__auraDocument : null;`);

/**
 * The one batched measurement call. Compiled for the same reason again.
 *
 * All the judgement lives in `__auraMeasure` (installed with the hook, so it is present
 * in every document including one this process never navigated) and in
 * `candidateSelectorsFor`. This is the wire between them.
 */
const MEASURE_IN_PAGE = new Function('payload',
    `return typeof window.__auraMeasure === 'function' ? window.__auraMeasure(payload) : null;`) as any;

/**
 * The identity question, asked of the page. Compiled for the same reason again.
 *
 * All of it lives in `__auraSameElement`, installed with the hook: only the page can
 * compare two nodes, and only the document that registered them still holds both.
 */
const SAME_ELEMENT_IN_PAGE = new Function('payload',
    `return typeof window.__auraSameElement === 'function' ? window.__auraSameElement(payload) : null;`) as any;

/**
 * Capture a registered node's surroundings with no interaction. Compiled, same reason.
 *
 * The third capture site. `takePreAction` builds a graph because Codegen wrote a line;
 * this builds one because a person asserted something. It never parks a press, so the
 * graph it produces cannot be claimed by any recorded action.
 */
const OBSERVE_IN_PAGE = new Function('payload',
    `return typeof window.__auraObserveSlot === 'function' ? window.__auraObserveSlot(payload) : null;`) as any;

/**
 * The ARIA role a node has WITHOUT anyone writing it down.
 *
 * Playwright's recorder writes `getByRole('listitem')`, but the DOM stores no `role`
 * attribute on an `<li>` - the role is implicit in the tag. The capture records
 * attributes, so the literal was unanswerable and every `getByRole` chain failed to
 * claim.
 *
 * THE TABLE ITSELF NOW LIVES IN `dom-evidence.ts` and is re-exported here, unchanged,
 * because generation needs the identical mapping: claiming reads it to decide whether a
 * parked element satisfies a `getByRole` Codegen wrote, and `semanticCandidatesFor`
 * reads it to propose a `getByRole` of its own. Two copies would drift, and a role that
 * means one thing when claiming and another when generating pairs a graph with a
 * locator describing a different element.
 */
export { implicitRole } from '../autocode/dom-evidence';

/** Everything a node can be named by, lowercased. */
function namesOf(node: any): string[] {
  if (!node)
    return [];
  const data = node.data ?? {};
  const aria = node.aria ?? {};
  return [
    node.id, node.testId, data['data-testid'], data['data-test-id'],
    node.ariaLabel, aria['aria-label'], node.accessibleName, node.name,
    node.placeholder, node.title, node.text, node.role, implicitRole(node),
    ...(node.classes ?? node.stableClasses ?? []),
  ].filter(Boolean).map((value: string) => String(value).toLowerCase());
}

/**
 * Literals at or below this length are matched on a word boundary, not as a
 * substring.
 *
 * `ON`, `OFF`, `OK`, `NO`, `YES` are two and three characters, and a substring
 * test makes them match almost anything: `"on"` is inside `"button"`, so
 * `getByRole('button', { name: 'ON' })` claimed a parked press of Bugasura's
 * `<button class="mdl-button" name="login">Sign In</button>` and the evidence for
 * TC_LOGIN_075 reported the ON control as the Sign In button. `"Submit"` reached
 * the same node through `login-submit`, by the same route.
 *
 * Three, not four: it is the shortest bound that covers the words a UI actually
 * uses for a state, and every longer literal keeps the substring behaviour that
 * `getByText('Config Line Chart: Unable to')` depends on.
 */
const SHORT_LITERAL = 3;

/**
 * Does this literal appear in the value as a word rather than as a fragment?
 *
 * Explicit character classes rather than `\b`, because the values here are already
 * lower-cased and a class states exactly what counts as a boundary: `tab` matches
 * `tab-strip` and `notifications on`, and does not match `button` or `cutoff`.
 */
function boundedBy(value: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(value);
}

function satisfiedBy(node: any, literal: string): boolean {
  const needle = String(literal).toLowerCase();
  // An exact match is an exact match at any length. Only the fallback narrows.
  const loose = needle.length <= SHORT_LITERAL
    ? (value: string) => boundedBy(value, needle)
    : (value: string) => value.includes(needle);
  return namesOf(node).some(value => value === needle || loose(value));
}

/**
 * The parked entry this recorded locator describes - or null.
 *
 * A CHAIN DESCRIBES RELATIONSHIPS, NOT ONE ELEMENT. `#tc_summary_638717 >>
 * getByText('Line Chart…')` names a scope and then a thing inside it; the element the
 * person clicked is the inner one, and the id belongs four levels above it. Requiring
 * every literal on the clicked element's own fingerprint is what discarded every entry
 * this mechanism ever parked.
 *
 * So the chain is read in the direction it was written: the LAST segment describes the
 * target, and earlier segments describe what contains it - matched against the parent
 * and the captured ancestors, never against descendants or siblings. Those point the
 * wrong way: an element that merely CONTAINS the text of some other element is not the
 * element the locator names, and matching downward would pair a parked node with a
 * locator meant for its child.
 */
/**
 * The id/class names a CSS selector states, split by what they describe.
 *
 * Only for `locator()`. A `getByText` argument is prose - a full stop in a sentence is
 * not a class - and decomposing it would compare a node against fragments of its own
 * copy. Selectors carrying an attribute, a pseudo-class argument or a quote are left
 * whole and therefore still match nothing, exactly as before: this widens one shape,
 * it does not open the door.
 */
function cssCompounds(call: string, selector: string): string[] {
  if (call !== 'locator' || !/[#.]/.test(selector))
    return [];
  if (/["'\[\]()]/.test(selector))
    return [];
  return selector.split(/\s*[>+~]\s*|\s+/).map(part => part.trim()).filter(Boolean);
}

const namesIn = (compound: string): string[] =>
  (compound.match(/[#.][A-Za-z_][\w-]*/g) ?? []).map(name => name.slice(1));

/** What the FINAL compound names: the element the selector resolves to. */
function elementTokens(call: string, selector: string): string[] {
  const compounds = cssCompounds(call, selector);
  return compounds.length ? namesIn(compounds[compounds.length - 1]) : [];
}

/**
 * What every EARLIER compound names, split by whether the capture contract can
 * actually record it.
 *
 * THIS SPLIT IS THE WHOLE POINT, and getting it wrong cost five recordings.
 * `dom-capture-source.ts` keeps an ancestor only when it is a CONTAINERS tag, carries
 * a `role`, or has an `id`:
 *
 *     CONTAINERS.indexOf(tag) >= 0 || getAttribute('role') || current.id
 *
 * Bugasura's row checkbox sits in `div.tabulator-cell--checkbox` inside
 * `label.rounded-checkbox-cont`. A plain div and a label are none of those three, so
 * NEITHER is in `ancestors` - the label survives only because `parent` is captured
 * separately, and the cell is not recorded anywhere at all. Requiring every class the
 * selector names therefore demanded evidence the recorder is designed never to
 * produce, and every compound selector in the corpus failed to claim its press.
 *
 * - `ids` are recordable by definition (`current.id` is one of the three conditions),
 *   so an id the selector names and the graph lacks is a genuine mismatch - a
 *   different row - and stays REQUIRED. Wrong-row protection lives here.
 * - `classes` may or may not be recordable depending on where they sit, and nothing
 *   offline can tell which. They corroborate; their absence proves nothing.
 *
 * The element itself is unaffected: the FINAL compound is still matched in full
 * against the pressed node, so a selector still has to name the thing it claims.
 */
function containerTokens(call: string, selector: string): { ids: string[]; classes: string[] } {
  const compounds = cssCompounds(call, selector);
  const earlier = compounds.slice(0, -1);
  const ids = earlier.flatMap(compound =>
    (compound.match(/#[A-Za-z_][\w-]*/g) ?? []).map(name => name.slice(1)));
  const classes = earlier.flatMap(compound =>
    (compound.match(/\.[A-Za-z_][\w-]*/g) ?? []).map(name => name.slice(1)));
  return { ids, classes };
}

export function claimParkedEntry(entries: any[], expression: string): any | null {
  if (!Array.isArray(entries) || !entries.length)
    return null;
  const segments = parseChain(expression).filter(segment =>
    segment.call === 'locator' || segment.call.startsWith('getBy'));
  if (!segments.length)
    return null;

  const literalsOf = (segment: any): string[] => {
    const found: string[] = [];
    if (segment.call === 'getByRole') {
      if (segment.arg) found.push(segment.arg);
      if (segment.name) found.push(segment.name);
    } else if (segment.arg) {
      // `#id` and `.class` name a thing the capture records without its punctuation.
      // Only a bare identifier is unwrapped - `.a.b` or `div > .c` is a selector, not a
      // name, and stripping its first character would compare against something no node
      // ever carries.
      //
      // `[id="639978"]` is the same statement written the other way, and Codegen
      // writes it whenever an id would not be a valid CSS identifier - which is every
      // numeric id. Unrecognised, the whole bracketed string was compared against the
      // node's names, matched nothing, and the press went unclaimed: TC_LOGIN_082's
      // checkbox had no press-time evidence at all, so no candidate for it could ever
      // carry an identity. Only a single, simply quoted attribute is unwrapped;
      // anything with an escape, a second attribute or an operator is left whole and
      // therefore still matches nothing.
      const attribute = /^\[[A-Za-z_:][-\w:.]*=(?:"([^"\\]*)"|'([^'\\]*)'|([^\]"'\s]+))\]$/
          .exec(segment.arg);
      const value = attribute ? (attribute[1] ?? attribute[2] ?? attribute[3]) : undefined;
      if (value)
        found.push(value);
      else if (/^[#.][A-Za-z0-9_-]+$/.test(segment.arg))
        found.push(segment.arg.slice(1));
      else {
        // A COMPOUND CSS SELECTOR NAMES THINGS TOO - it just names several of them.
        //
        // `#tr_1749558 > .tabulator-cell--checkbox > .rounded-checkbox-ui` was pushed
        // whole and compared against the node's names, which no node carries, so the
        // press went unclaimed and the action fell back to a claim-time re-capture.
        // Its ASSERTION, written by Codegen as `[id="1749558"]`, was unwrapped by the
        // rule above and claimed correctly - the same press, the same row, two
        // outcomes, decided by which shape Codegen happened to write.
        //
        // The final compound names the element; anything before a combinator names
        // what encloses it, which is the same distinction the chain already makes
        // between its last segment and the earlier ones. `elementTokens` returns the
        // first, `containerTokens` the second, and `matches` requires BOTH - so this
        // makes claiming stricter than the bare-`.class` case it sits beside, never
        // looser. A selector that yields no token at all is pushed whole, exactly as
        // before.
        const tokens = elementTokens(segment.call, segment.arg);
        if (tokens.length)
          found.push(...tokens);
        else
          found.push(segment.arg);
      }
    }
    return found.filter(Boolean);
  };

  // A chain that names nothing describes nothing. Without this every segment vacuously
  // matches and the newest parked entry is claimed for a locator that never identified
  // it - which is the guess this whole path exists to avoid.
  if (!segments.some(segment => literalsOf(segment).length))
    return null;

  const matches = (entry: any): boolean => {
    const graph = entry?.graph ?? {};
    const target = entry?.fingerprint ?? graph.target;
    if (!target)
      return false;
    const containers = [graph.parent, ...(graph.ancestors ?? [])].filter(Boolean);
    return segments.every((segment, index) => {
      const wanted = literalsOf(segment);
      if (!wanted.length)
        return true;                       // `locator()` with no literal argument
      const last = index === segments.length - 1;
      // A compound selector states its own containment, and that containment is still
      // checked - but only against what the capture contract can record.
      //
      // Every named ID must be found: ids are always recorded, so a missing one means a
      // DIFFERENT element (a different row), and that is the wrong-row rejection.
      // Named classes corroborate; the recorder drops the plain divs and labels most of
      // them sit on, so their absence is a fact about the capture, not about the page.
      // Where the selector names NO id at all, one class must still be found, so an
      // id-less compound cannot claim a press on containment evidence of nothing.
      const enclosing = containerTokens(segment.call, segment.arg ?? '');
      const holds = (literal: string): boolean => satisfiedBy(target, literal)
        || containers.some(node => satisfiedBy(node, literal));
      if (!enclosing.ids.every(holds))
        return false;
      if (!enclosing.ids.length && enclosing.classes.length && !enclosing.classes.some(holds))
        return false;
      // The final segment names the element itself. Earlier ones name what encloses it,
      // and the element is allowed to satisfy them too - a chain may re-state the thing
      // it already reached (`locator('#id').getByText('…')` on the element carrying both).
      return wanted.every(literal => satisfiedBy(target, literal)
        || (!last && containers.some(node => satisfiedBy(node, literal))));
    });
  };

  // Newest first: if the same element was pressed twice, the most recent press is the
  // one this line was written for.
  for (let index = entries.length - 1; index >= 0; index--) {
    if (matches(entries[index]))
      return entries[index];
  }
  return null;
}

async function takePreAction(page: any, expression: string, metrics?: LiveMetrics): Promise<TargetEvidence | null> {
  if (!literalsIn(expression).length)
    return null;
  // The mirror first: entries pushed out as they were parked, so a click that navigated
  // still has its graph here after its document is gone. Then, only if nothing matched,
  // whatever is still parked in the live page - which covers a recording made before the
  // binding existed, and costs one evaluate.
  let claimed = claimParkedEntry(parkedEntries, expression);
  if (claimed) {
    parkedEntries.splice(parkedEntries.indexOf(claimed), 1);
  } else {
    let live: any[] = [];
    try {
      live = await page.evaluate(READ_PARKED) ?? [];
    } catch {
      live = [];
    }
    // ONE GRAPH SERVES ONE LOCATOR. The mirror is consumed by splicing; the page read
    // returns a copy, so what was already claimed is filtered out here instead. Without
    // this a single press would answer two different recorded lines - which is how a
    // graph ends up paired with a locator that never described it.
    claimed = claimParkedEntry(live.filter(entry => !claimedKeys.has(entryKey(entry))), expression);
  }
  if (claimed)
    claimedKeys.add(entryKey(claimed));
  if (!claimed?.graph)
    return null;

  const raw = claimed.graph;
  const { analyseIdentifier } = require('../autocode/locator-quality') as
    typeof import('../autocode/locator-quality');
  const identifier = raw.target?.id ? analyseIdentifier(raw.target.id) : undefined;

  // WHICH DOCUMENT IS THIS? Everything below turns on the answer.
  //
  // The graph was taken as the person pressed. This runs when Codegen writes the
  // line, which for a click that navigated is a different page - and a count taken
  // there is not weak evidence about the press, it is evidence about something else.
  // `getByRole('button', { name: 'Sign In' })` measured 0 in four recordings and read
  // as "the button matched nothing", when what it meant was "the login page is gone".
  const pressDocumentId: string | null = claimed.documentId ?? null;
  const currentDocumentId = await readDocumentId(page);
  let matchCountDocument: 'same' | 'other' | 'unknown' = 'unknown';
  let matchCount: MatchCount = null;
  if (!pressDocumentId) {
    // A recording made before the document nonce existed. Behave exactly as before.
    matchCount = await countQuietly(page, expression);
  } else if (!currentDocumentId) {
    // The page could not be asked. Not measured - never 1, and never the last number.
    matchCount = null;
  } else if (currentDocumentId === pressDocumentId) {
    matchCount = await countQuietly(page, expression);
    matchCountDocument = 'same';
  } else {
    matchCountDocument = 'other';
    if (metrics)
      metrics.documentChangedCount++;
  }

  const sameDocument = matchCountDocument === 'same';
  // Claim-time candidates are only worth measuring while the document still stands.
  // In any other document they would describe the page that replaced the one the
  // person acted on, which is the whole error this phase exists to remove.
  const claimTime = sameDocument ? await measureCandidates(page, raw, expression) : [];
  const press = pressMeasurements(claimed);

  // THE RECORDED LOCATOR IS A CANDIDATE LIKE ANY OTHER, and until now it was the only
  // measured expression in the file that never had its identity asked.
  //
  // `matchCount` above counts it, and a count is not an identity: it says the expression
  // names one element, never that it names the element the person acted on. So across
  // the whole recorded corpus - 1058 targets - `identityMatched` was absent on every
  // single recorded locator, and 137 targets that have no proven candidate at all carry
  // a recorded locator already counted at exactly one element in the press's own
  // document. Codegen's `getByRole('link', { name: 'Mobiles' })` is the case: measured
  // at one element, in the right document, and refused for want of an answer nobody
  // asked for.
  //
  // Measured HERE rather than in `measureAtPress` because this is the first moment the
  // expression exists - Codegen writes its line after the action. Everything else about
  // it is the press: the same document (guarded by `sameDocument`), the same parked
  // node, the same `===`. Nothing is asked of Codegen; identity comes from the graph the
  // page parked when the person pressed.
  const recorded = sameDocument
    ? await measureExpressionCandidates(page, claimed, [{
      strategy: 'recorded-locator', selector: '', expression, measuredBy: 'expression',
    }])
    : [];

  // THE SETTLED-POINT MEASUREMENT. This is the moment the pipeline already treats as
  // settled - Codegen has written its line, the entry is being claimed - so no new
  // lifecycle point and no delay is introduced. Written to the graph before the evidence
  // is built, and read by nothing that selects a locator.
  const stability = await measureNameStability(page, claimed, sameDocument);
  if (raw.target)
    raw.target.accessibleNameStable = stability;

  const seen = new Set(press.map(candidate => candidate.expression));
  const withRecorded = [...press, ...recorded.filter(c => !seen.has(c.expression))];
  for (const candidate of recorded)
    seen.add(candidate.expression);
  const split = splitCandidates(
      [...withRecorded, ...claimTime.filter(c => !seen.has(c.expression))], metrics);
  return {
    locator: expression,
    target: raw.target,
    parent: raw.parent,
    ancestors: raw.ancestors ?? [],
    children: raw.children ?? [],
    descendants: raw.descendants ?? [],
    previousSiblings: raw.previousSiblings ?? [],
    nextSiblings: raw.nextSiblings ?? [],
    relationships: [
      ...(raw.parent ? ['parent' as const] : []),
      ...((raw.children ?? []).length ? ['child' as const] : []),
      ...((raw.ancestors ?? []).length ? ['ancestor' as const] : []),
      ...((raw.descendants ?? []).length ? ['descendant' as const] : []),
      ...((raw.previousSiblings ?? []).length ? ['previous-sibling' as const] : []),
      ...((raw.nextSiblings ?? []).length ? ['next-sibling' as const] : []),
    ],
    // Measured in the document of the press, or not measured at all.
    matchCount,
    matchCountDocument,
    // NEVER THROUGH `splitCandidates`. That function decides which candidates may be
    // emitted; these are not candidates and are not emitted, so they travel whole and
    // are judged only by the reader that asks about identity.
    ...(capabilityMeasurementsOf(claimed).length
      ? { capabilityMeasurements: capabilityMeasurementsOf(claimed) } : {}),
    ...(pressDocumentId ? { documentId: pressDocumentId } : {}),
    // The NAME of the registration this graph came from, carried straight through.
    // It is what lets an assertion recorded later find THIS row without sharing a
    // locator with it; see TargetEvidence.elementRef. Only ever present on this path
    // - `captureFor` reads the page after the fact and has no press to name.
    ...(typeof claimed.elementRef === 'string' && claimed.elementRef
      ? { elementRef: claimed.elementRef }
      : {}),
    // The screen the press happened on, as the document stated it at that moment.
    // Carried straight through: it is read in the page and never derived here.
    ...(typeof claimed.route === 'string' && claimed.route ? { route: claimed.route } : {}),
    ...(claimed.pressMeasurement?.ownText && claimed.pressMeasurement.sameDocument
      ? { pressTimeText: claimed.pressMeasurement.ownText }
      : {}),
    captureTiming: 'before-action',
    attached: raw.attached,
    viewport: raw.viewport,
    ...(identifier ? { identifier: { raw: identifier.value, dynamic: identifier.dynamic, normalised: identifier.normalised } } : {}),
    ...split,
  };
}

/** The identity of the document the page is showing now, or null if it cannot say. */
async function readDocumentId(page: any): Promise<string | null> {
  try {
    const value = await page.evaluate(READ_DOCUMENT_ID);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Every quoted literal in a recorded chain: ids, names, texts.
 *
 * A hand-written scan rather than a regex. The literals are what a pre-action graph is
 * matched against, so a subtle escaping bug here would pair a graph with the wrong
 * element - and a backslash class inside this template-heavy file is exactly where
 * such a bug hides.
 */
export function literalsIn(expression: string): string[] {
  const found: string[] = [];
  let quote = '';
  let current = '';
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index];
    if (quote) {
      if (character === '\\') {
        current += expression[++index] ?? '';
        continue;
      }
      if (character === quote) {
        const literal = current.trim().replace(/^#/, '');
        if (literal.length >= 2)
          found.push(literal);
        quote = '';
        current = '';
        continue;
      }
      current += character;
      continue;
    }
    if (character === "'" || character === '"' || character === '`')
      quote = character;
  }
  return found;
}

/**
 * Every method called in a recorded chain, in order - including the ones this module
 * cannot rebuild.
 *
 * WHY IT EXISTS. `buildLocator`'s segment regex only ever LOOKED FOR the calls it knows.
 * Anything else was not refused, it was stepped over: for
 *
 *   page.locator(".tabulator-row").filter({ hasText: "…" }).locator(".bugChecked")
 *
 * the two `locator(...)` calls matched and `.filter(...)` was skipped, so what the page
 * was asked to count was `page.locator(".tabulator-row").locator(".bugChecked")` - a
 * STRICTLY BROADER locator than the one recorded. TC_LOGIN_123 measured that at 2 where
 * its own expression measures 1, and a count of 2 is what makes an assertion look
 * ambiguous. Confirmed against the live application: the recorded expression counts 1,
 * the filter-stripped one counts 2, and 2 is the number that reached the sidecar.
 *
 * A hand-written scan rather than a regex, for the same reason `literalsIn` is one: it
 * has to be right about quoting and nesting, and a `.` inside a quoted string
 * (`getByText("a.b(c)")`) is not a method call.
 */
export function chainMethodsIn(expression: string): string[] {
  const found: string[] = [];
  let quote = '';
  let depth = 0;
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index];
    if (quote) {
      if (character === '\\') {
        index++;
        continue;
      }
      if (character === quote)
        quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      depth++;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    // Only a call in the OUTER chain is this module's to rebuild. One nested inside an
    // argument - `filter({ has: page.locator('.x') })` - belongs to the argument, and
    // reading it as a chain step would be a second way to build the wrong locator.
    if (depth !== 0 || character !== '.')
      continue;
    let end = index + 1;
    while (end < expression.length && /[A-Za-z0-9_$]/.test(expression[end]))
      end++;
    if (end > index + 1 && expression[end] === '(') {
      found.push(expression.slice(index + 1, end));
      index = end - 1;
    }
  }
  return found;
}

/**
 * The chain calls `buildLocator` can rebuild FAITHFULLY. Nothing else may be stepped
 * over: an unrebuildable call means no locator, which means no count.
 */
const REBUILDABLE = new Set([
  'locator', 'getByRole', 'getByLabel', 'getByPlaceholder', 'getByTestId',
  'getByText', 'getByTitle', 'getByAltText', 'first', 'last', 'nth',
]);

/**
 * The OPTIONS this module can reproduce, per call - and the same rule as the calls
 * themselves: anything absent from these sets refuses the whole expression.
 *
 * A call being rebuildable was never enough. `getByRole('button', { name: 'Sign In',
 * exact: true })` was rebuilt as `getByRole('button', { name: 'Sign In' })`, because the
 * builder read `name` and nothing else - and without `exact` Playwright matches the name
 * as a case-insensitive SUBSTRING, so on a page that also has "Sign in with Google" the
 * rebuilt locator counts two where the recorded one counts one. Identical in shape to
 * dropping `.filter()`, identical in direction (always broader), and on 90 recorded
 * expressions rather than 14.
 *
 * SUPPORTED IS DECIDED BY WHAT CAN BE REPRODUCED EXACTLY, not by what the corpus
 * happens to contain. `name` is a string and `exact` is a boolean, so both round-trip
 * with nothing lost. `checked`, `disabled`, `expanded`, `includeHidden`, `level`,
 * `pressed` and `selected` are deliberately NOT here: each is a real narrowing this
 * module has never had to reproduce, and adding one on speculation means shipping an
 * untested reconstruction of a locator whose whole purpose is to be exact. When a
 * recording carries one, the count is `null` - which is a fact - and support can be
 * added with a test that proves it round-trips.
 */
const ROLE_OPTIONS = new Set(['name', 'exact']);
const TEXT_OPTIONS = new Set(['exact']);

/**
 * A call's arguments, split at the top level - or null when they cannot be read.
 *
 * Quote- and depth-aware for the same reason `chainMethodsIn` is: a comma inside
 * `getByText("a, b")` is not an argument separator, and reading it as one would build a
 * locator from half a string.
 */
export function splitArguments(text: string): string[] | null {
  const parts: string[] = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      current += character;
      if (character === '\\') {
        current += text[++index] ?? '';
        continue;
      }
      if (character === quote)
        quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      current += character;
      continue;
    }
    if (character === '(' || character === '[' || character === '{')
      depth++;
    if (character === ')' || character === ']' || character === '}')
      depth--;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (quote || depth !== 0)
    return null;
  const last = current.trim();
  if (last)
    parts.push(last);
  return parts.filter((part, index) => part.length > 0 || index < parts.length);
}

/** The value of a token that is EXACTLY one quoted string, or null. */
export function stringLiteral(token: string): string | null {
  const text = (token ?? '').trim();
  if (text.length < 2)
    return null;
  const quote = text[0];
  if (quote !== "'" && quote !== '"' && quote !== '`')
    return null;
  let value = '';
  for (let index = 1; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') {
      value += text[++index] ?? '';
      continue;
    }
    if (character === quote)
      // Anything after the closing quote means this token is an EXPRESSION, not a
      // literal - `'a' + name`, a template with a hole - and cannot be reproduced.
      return index === text.length - 1 ? value : null;
    value += character;
  }
  return null;
}

/**
 * An options object, read as key → raw token - or null when anything about it cannot be
 * reproduced: a key this call does not support, a nested object, a duplicate key.
 */
export function readOptions(token: string, allowed: ReadonlySet<string>): Map<string, string> | null {
  const text = (token ?? '').trim();
  if (!text.startsWith('{') || !text.endsWith('}'))
    return null;
  const parts = splitArguments(text.slice(1, -1).trim());
  if (parts === null)
    return null;
  const options = new Map<string, string>();
  for (const part of parts) {
    if (!part)
      continue;
    const colon = part.indexOf(':');
    if (colon < 0)
      return null;
    const key = part.slice(0, colon).trim().replace(/^['"`]|['"`]$/g, '');
    const value = part.slice(colon + 1).trim();
    // AN UNSUPPORTED OPTION IS A REFUSAL, NEVER A REMOVAL. Every option Playwright
    // offers here NARROWS, so dropping one can only widen the locator - which is the
    // whole defect this guards.
    if (!key || !allowed.has(key) || !value || options.has(key))
      return null;
    options.set(key, value);
  }
  return options;
}

/** `true` / `false` written out, and nothing else. */
function booleanLiteral(token: string): boolean | null {
  const text = (token ?? '').trim();
  return text === 'true' ? true : text === 'false' ? false : null;
}

/** `count()` that answers null rather than throwing when the element has gone. */
async function countQuietly(page: any, expression: string): Promise<MatchCount> {
  const locator = buildLocator(page, expression);
  if (!locator)
    return null;
  try {
    return await locator.count();
  } catch {
    return null;
  }
}

/**
 * Build alternatives from this element's own evidence and COUNT each one.
 *
 * Only shapes the evidence supports: a test id it actually has, a class it actually
 * carries scoped to an ancestor id it actually sits under. Nothing is invented, and
 * nothing is trusted - the count is what decides, and `sanitiseEvidence` keeps only
 * the candidates that matched exactly one element.
 */
async function measureCandidates(
  page: any,
  raw: any,
  locatorExpression?: string,
): Promise<CandidateMeasurement[]> {
  const measured: CandidateMeasurement[] = [];
  // Built from the element's own graph by `candidateSelectorsFor`, which knows nothing
  // about any application: stable ancestor ids, the element's classes, and - crucially
  // for the responsive mobile/desktop split that made TC_LOGIN_042's text ambiguous -
  // the PARENT's classes. The recorded locator goes with it, because the text Codegen
  // used to find the element is a better discriminator than anything derived.
  for (const candidate of candidateSelectorsFor({ ...raw, locator: locatorExpression }, looksGenerated)) {
    // A SEMANTIC CANDIDATE IS PRESS-TIME ONLY, and that is a refusal rather than an
    // omission. This path runs after the action against whatever page is showing, with
    // no parked node to compare against, so it can produce a COUNT and nothing else -
    // and a claim-time candidate is promoted on its count alone (the pre-P0.7 bar kept
    // for recordings that predate identity). Letting `getByRole(...)` in here would
    // therefore promote a semantic locator on cardinality, which is exactly the
    // unverified promotion the whole mechanism exists to prevent. It is measured at the
    // press, where identity can be asked, or not at all.
    if (candidate.measuredBy === 'expression')
      continue;
    try {
      let locator = page.locator(candidate.selector);
      // Wiring only: WHICH shape a candidate takes was decided in
      // `candidateSelectorsFor`. This just calls the method it asked for.
      if (candidate.text !== undefined) {
        locator = candidate.textMode === 'descend'
          ? locator.getByText(candidate.text)
          : locator.filter({ hasText: candidate.text });
      }
      // The contextual shape: the container was identified by its text, and the
      // element wanted is inside it. Same composition the expression states.
      if (candidate.descendant)
        locator = locator.locator(candidate.descendant);
      const count = await locator.count();
      // Counted, never assumed. Tagged `claim` because that is when it happened: this
      // runs when the generated line appears, not when the person acted. Its identity
      // against the pressed element is not asked here and must stay unstated.
      measured.push({
        strategy: candidate.strategy,
        expression: candidate.expression,
        matchCount: count,
        measuredAt: 'claim',
      });
    } catch {
      // An unbuildable selector is not a candidate. Nothing to report.
    }
  }
  return measured;
}

/** A generated id or class, by the same rules the locator engine already uses. */
function looksGenerated(value: string): boolean {
  const { analyseIdentifier } = require('../autocode/locator-quality') as
    typeof import('../autocode/locator-quality');
  return analyseIdentifier(value).dynamic;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/**
 * Turn a recorded chain back into a Locator on our page.
 *
 * Deliberately narrow: only the shapes Codegen emits, and only by calling the same
 * public methods. Anything unrecognised returns null and is simply not captured -
 * evidence is an optimisation, and a chain we cannot rebuild is not worth an
 * `eval`.
 */
export function buildLocator(page: any, expression: string): any | null {
  const trimmed = expression.trim();
  if (!trimmed.startsWith('page.'))
    return null;

  // REBUILD THE WHOLE CHAIN OR NONE OF IT.
  //
  // The loop below FINDS the calls it knows and walks past everything else, which is
  // not a refusal - it is a different, broader locator built silently. Dropping
  // `.filter({ hasText })` turns "the checkbox in the row that says X" into "every
  // checkbox in every row", and the count that comes back is an ambiguity the recorded
  // expression does not have. That is how TC_LOGIN_123's three assertions were recorded
  // at `locatorMatchCount: 2` when their own locator matches exactly one element.
  //
  // So the chain is read FIRST, in full, and one unrebuildable call refuses the lot.
  // An unknown measurement is a fact this pipeline already knows how to carry -
  // `matchCount: null` means "not measured" everywhere downstream and is never read as
  // ambiguity. A wrong number is not: it is indistinguishable from a real measurement
  // and it decides branches. Nothing here learns a new call; refusing is the change.
  const methods = chainMethodsIn(trimmed);
  if (!methods.length || methods.some(method => !REBUILDABLE.has(method)))
    return null;

  let current: any = page;
  const segment = /\.(locator|getByRole|getByLabel|getByPlaceholder|getByTestId|getByText|getByTitle|getByAltText|first|last|nth)\(([^]*?)\)(?=\s*\.|$)/g;
  let rebuilt = 0;
  for (const match of trimmed.slice('page'.length).matchAll(segment)) {
    const method = match[1];
    const args = match[2].trim();
    try {
      if (method === 'first' || method === 'last') {
        if (args.trim())
          return null;
        current = current[method]();
      } else if (method === 'nth') {
        // `Number(args) || 0` turned anything unreadable into index 0 - a different
        // element, chosen silently. An index is a literal integer or it is nothing.
        const index = /^-?\d+$/.test(args.trim()) ? Number(args.trim()) : null;
        if (index === null || !Number.isInteger(index) || index < 0)
          return null;
        current = current.nth(index);
      } else if (method === 'getByRole') {
        const parts = splitArguments(args);
        if (!parts || parts.length < 1 || parts.length > 2)
          return null;
        const role = stringLiteral(parts[0]);
        if (role === null)
          return null;
        const options = parts.length === 2 ? readOptions(parts[1], ROLE_OPTIONS) : new Map<string, string>();
        if (options === null)
          return null;
        const built: { name?: string; exact?: boolean } = {};
        if (options.has('name')) {
          // A REGEX NAME IS NOT REPRODUCIBLE HERE, and dropping it would leave
          // `getByRole('button')` - every button on the page. Refused, like any other
          // value this cannot round-trip.
          const name = stringLiteral(options.get('name') as string);
          if (name === null)
            return null;
          built.name = name;
        }
        if (options.has('exact')) {
          const exact = booleanLiteral(options.get('exact') as string);
          if (exact === null)
            return null;
          built.exact = exact;
        }
        current = Object.keys(built).length ? current.getByRole(role, built) : current.getByRole(role);
      } else if (method === 'locator' || method === 'getByTestId') {
        // `locator(selector, { has, hasText })` and a test id take no option this
        // module reproduces, so a second argument refuses rather than being ignored.
        const parts = splitArguments(args);
        if (!parts || parts.length !== 1)
          return null;
        const literal = stringLiteral(parts[0]);
        if (literal === null)
          return null;
        current = current[method](literal);
      } else {
        // getByText / getByLabel / getByPlaceholder / getByTitle / getByAltText, each
        // of which takes `{ exact }` - dropped until now, exactly as on getByRole.
        const parts = splitArguments(args);
        if (!parts || parts.length < 1 || parts.length > 2)
          return null;
        const literal = stringLiteral(parts[0]);
        if (literal === null)
          return null;
        const options = parts.length === 2 ? readOptions(parts[1], TEXT_OPTIONS) : new Map<string, string>();
        if (options === null)
          return null;
        if (options.has('exact')) {
          const exact = booleanLiteral(options.get('exact') as string);
          if (exact === null)
            return null;
          current = current[method](literal, { exact });
        } else {
          current = current[method](literal);
        }
      }
      rebuilt++;
    } catch {
      return null;
    }
  }
  // BELT AND BRACES, and cheap. The check above says every call is one this module
  // KNOWS; this says the segment reader actually rebuilt every one of them. A quoting
  // or spacing shape the regex fails to match would otherwise produce a shorter chain -
  // the same silent broadening by a different route.
  return rebuilt === methods.length && rebuilt > 0 ? current : null;
}

// REMOVED: `LIVE_RECORDING_DIR`, a third hardcoded spelling of the recordings
// directory. It had no importer and no use in this file - the live recorder writes
// nothing there, which its own doc comment ("where a live recording's temporary script
// lives") got wrong - so it was a location declaration that could drift from the two
// real ones without anything failing. `recorder.ts recordingsDir()` is the only
// declaration now; anything here that needs the directory takes it from there.


/* ------------------------------------------------- the assertion picker */

/**
 * What the picker may offer for the element the person is pointing at.
 *
 * Every semantic decision is the Phase 2A resolver's. This adds only two things
 * the resolver cannot know: a readable name for the card, and the LIVE state the
 * page just read - which is more than the evidence contract records, and is used
 * for display only. Nothing here is written to the sidecar.
 */
export interface PickerPayload {
  node: any;
  state?: LiveState;
  /** Structurally related controls the page found. It judges none of them. */
  candidates?: AssociationCandidate[];
}

/** A capability, and WHICH element it is an assertion about. */
interface BoundCapability {
  capability: AssertionCapability;
  on: 'subject' | 'target';
}

const isVisibility = (capability: AssertionCapability): boolean =>
  (VISIBILITY_CAPABILITY_IDS as readonly string[]).includes(capability.id);

/**
 * Everything both bindings need, worked out once and identically.
 *
 * `pickerModel` and `recordPickedAssertion` must agree about what was offered:
 * if the card shows ON and the recorder then resolves a different element for
 * it, the person's assertion silently becomes an assertion about something else.
 * So the offer and the record come from one function.
 */
function pickerContext(payload: PickerPayload): {
  targetNode: any;
  targetLive: LiveState;
  subject: ResolvedSubject | null;
  bound: BoundCapability[];
  semantics: string;
  description: string;
  note?: string;
  state: Array<{ label: string; value: boolean | undefined }>;
} {
  const targetNode = payload.node ?? {};
  const targetLive = payload.state ?? {};
  const target = describeAssertionTarget(targetNode);
  const subject = resolveAssertionSubject(targetNode, payload.candidates);

  const describedSubject = subject ? describeAssertionTarget(subject.node) : null;
  const subjectLive: LiveState = subject?.state ?? {};
  const semantics = subject ? subject.semantics : target.semantics;

  // WHICH element each assertion is about.
  //
  // Checkedness and enablement belong to the associated control - that is the
  // whole point of resolving it. Visibility does NOT: the subject of a custom
  // switch is a 0x0 input, so `toBeVisible()` against it would be a red test
  // about a control the application deliberately hides. The thing a person can
  // see is the thing they pointed at, so Visible/Hidden stay bound to that.
  const bound: BoundCapability[] = subject
    ? [
      ...capabilitiesForSemantics(subject.semantics)
          .filter(capability => !isVisibility(capability))
          .map(capability => ({ capability, on: 'subject' as const })),
      ...target.capabilities.filter(isVisibility)
          .map(capability => ({ capability, on: 'target' as const })),
    ]
    : target.capabilities.map(capability => ({ capability, on: 'target' as const }));

  const nameOf = (node: any): string =>
    String(node?.accessibleName || node?.text || `<${node?.tag ?? 'element'}>`).slice(0, 60);
  const description = subject ? nameOf(subject.node) : nameOf(targetNode);

  // Live first, evidence second, `undefined` when neither proves it. A checkbox
  // whose page says nothing about its checkedness reads "?" - never "unchecked".
  const evidence = describedSubject?.currentState ?? target.currentState;
  const state: Array<{ label: string; value: boolean | undefined }> = [
    { label: 'Visible', value: targetLive.visible },
    { label: 'Enabled', value: (subject ? subjectLive.enabled : targetLive.enabled) ?? evidence.enabled },
  ];
  const checked = (subject ? subjectLive.checked : targetLive.checked) ?? evidence.checked;
  if (semantics === 'switch')
    state.push({ label: 'ON', value: checked });
  else if (semantics === 'checkbox' || semantics === 'radio')
    state.push({ label: 'Checked', value: checked });

  return {
    targetNode, targetLive, subject, bound, semantics, description,
    ...(subject ? { note: subject.reason } : {}),
    state,
  };
}

/**
 * What the picker may offer for the element the person is pointing at.
 *
 * Every semantic decision is the Phase 2A resolver's, and every ASSOCIATION
 * decision is the P1.2b resolver's. This adds only what neither can know: a
 * readable name for the card, and the LIVE state the page just read - which is
 * more than the evidence contract records, and is used for display only.
 * Nothing here is written to the sidecar.
 */
export function pickerModel(payload: PickerPayload): {
  description: string;
  semantics: string;
  note?: string;
  state: Array<{ label: string; value: boolean | undefined }>;
  capabilities: Array<{ id: string; label: string; needs?: string; placeholder?: string }>;
} {
  const context = pickerContext(payload);
  return {
    description: context.description,
    semantics: context.semantics,
    ...(context.note ? { note: context.note } : {}),
    state: context.state,
    capabilities: context.bound.map(({ capability }) => ({
      id: capability.id,
      label: capability.label,
      ...(capability.needs ? { needs: capability.needs, placeholder: placeholderFor(capability.needs) } : {}),
    })),
  };
}

function placeholderFor(needs: string): string {
  switch (needs) {
    case 'text': return 'the text it should contain';
    case 'value': return 'the value it should hold';
    case 'attribute': return 'name = value';
    case 'class': return 'the class it should have';
    default: return '';
  }
}

/** An attribute whose VALUE could be a secret. Same list the capture refuses. */
export function refusesAttribute(name: string): boolean {
  const normalised = name.trim().toLowerCase();
  return FORBIDDEN_VALUE_KEYS.some(key => normalised.includes(key));
}

/**
 * Turn the person's choice into a structured assertion.
 *
 * The locator is Codegen's own shape for the element, built from what the page
 * described - so the assertion joins the existing locator and evidence pipeline
 * rather than starting a second one. `afterActions` is read from the generated
 * script as it stands right now, which is what puts the assertion back where it
 * was made rather than at the end.
 */
export function recordPickedAssertion(
  payload: PickerPayload & { capabilityId: string; value?: string | null; context?: PickerContext },
  into: RecordedAssertion[],
  outputFile: string,
  metrics?: LiveMetrics,
  /**
   * A locator proven against the subject at pick time, when there is one.
   *
   * Passed in rather than resolved here so this function stays synchronous and
   * pure: measuring needs a page, and everything else about recording an assertion
   * does not. Absent - the ordinary case - nothing changes.
   */
  proven?: { locator: string; locatorStrategy: string },
  /**
   * The assertion that was recorded, and WHICH element it is about, handed back so the
   * caller can attach what only an async measurement can supply.
   *
   * This function stays synchronous and pure - it decides which element, which
   * capability and which locator, all from the payload - and provenance needs a page.
   * Returning both is what keeps the "which element" decision in ONE place: a state
   * assertion is about the associated control, a visibility assertion is about what the
   * pointer was on, and anything measuring the wrong one of those would judge an
   * element's locator against a different element's evidence.
   */
): {
  recorded: boolean; reason?: string; assertion?: RecordedAssertion;
  asserted?: { documentId: string | null; slot: number | null };
} {
  const context = pickerContext(payload);
  const bound = context.bound.find(entry => entry.capability.id === payload.capabilityId);
  if (!bound)
    return { recorded: false, reason: `"${payload.capabilityId}" is not offered for this element` };
  const capability = bound.capability;

  // The element this particular assertion is ABOUT. Visibility stays with what
  // the person pointed at; state goes to the control that holds it.
  const node = bound.on === 'subject' && context.subject ? context.subject.node : context.targetNode;

  let value: string | null = payload.value ?? null;
  let name: string | undefined;
  if (capability.needs === 'attribute') {
    const [rawName, ...rest] = String(value ?? '').split('=');
    name = rawName.trim();
    value = rest.join('=').trim();
    if (!name)
      return { recorded: false, reason: 'Write the attribute as name = value.' };
    if (refusesAttribute(name)) {
      if (metrics)
        metrics.refusedAssertions += 1;
      return { recorded: false, reason: `"${name}" can carry a secret, so it is not recorded.` };
    }
  }

  // A proven contextual locator replaces the SUBJECT's own locator only, and only
  // for a capability that is about the subject. Visibility stays bound to what a
  // person can see, so it keeps the target's locator either way.
  const useProven = proven && bound.on === 'subject';
  const assertion = assertionFor(capability, {
    target: String(node.accessibleName || node.text || node.id || node.tag || 'element').slice(0, 60),
    locator: useProven ? proven.locator : locatorFor(node),
    locatorStrategy: useProven ? proven.locatorStrategy : strategyFor(node),
  }, { value, name });
  // What the person pointed at, when that is not what is being asserted about.
  // Recorded rather than hidden - and never used to change the recorded click.
  if (node !== context.targetNode)
    assertion.interactionTarget = locatorFor(context.targetNode);
  assertion.afterActions = countRecordedActions(outputFile);
  into.push(assertion);
  if (metrics)
    metrics.pickedAssertions += 1;
  // WHICH element this assertion is about, as a registry slot. `node` above is the
  // decision - subject for state, pointed-at for visibility - and this is the same
  // decision expressed as the thing an identity check can be run against.
  return {
    recorded: true, assertion,
    asserted: { documentId: payload.context?.documentId ?? null, slot: registrySlotFor(payload, node) },
  };
}

/** How many ACTIONS the generated script holds right now. Assertions are not actions. */
function countRecordedActions(outputFile: string): number {
  try {
    return fs.readFileSync(outputFile, 'utf8').split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('await ') && !line.startsWith('await expect('))
        .length;
  } catch {
    return 0;
  }
}

/**
 * A locator for the described element, in Codegen's own vocabulary.
 *
 * Preference order is the project's existing one - a test id, then a role with a
 * name, then an id - and it stops there. Nothing is invented: an element with
 * none of those gets its tag, and the locator engine downstream judges it
 * exactly as it judges a recorded one.
 */
export function locatorFor(node: any): string {
  const testId = node.attributeNames?.includes('data-testid') ? node['data-testid'] : undefined;
  if (typeof testId === 'string' && testId)
    return `page.getByTestId(${JSON.stringify(testId)})`;
  if (node.role && node.accessibleName)
    return `page.getByRole(${JSON.stringify(node.role)}, { name: ${JSON.stringify(node.accessibleName)} })`;
  // The same policy the candidate builder follows. `#639978` is unique on the page
  // and gone next session; emitting it from here bypassed the rule entirely, and
  // TC_LOGIN_082's assertion was recorded against it with the strategy labelled
  // `stable-id`. A dynamic id is not a locator, wherever it is written.
  if (node.id && !looksGenerated(String(node.id)))
    return `page.locator(${JSON.stringify('#' + node.id)})`;
  if (node.accessibleName)
    return `page.getByLabel(${JSON.stringify(node.accessibleName)})`;
  if (node.placeholder)
    return `page.getByPlaceholder(${JSON.stringify(node.placeholder)})`;
  if (node.text)
    return `page.getByText(${JSON.stringify(node.text)})`;
  // A decorated element - the visible half of a custom control - usually has
  // nothing but its classes: no role, no name, no id, no text. Codegen resolves
  // exactly this shape the same way (it wrote `.ba-switch__thumb` for Bugasura's
  // switch), and a tag name on its own identifies nothing. Every class is used,
  // never a chosen one: choosing would be a guess about which is significant.
  const classes = (node.stableClasses ?? []).filter((name: string) => Boolean(name));
  if (classes.length)
    return `page.locator(${JSON.stringify(classes.map((name: string) => `.${name}`).join(''))})`;
  return `page.locator(${JSON.stringify(node.tag ?? '*')})`;
}

function strategyFor(node: any): string {
  if (node.role && node.accessibleName)
    return 'role-name';
  if (node.id && !looksGenerated(String(node.id)))
    return 'stable-id';
  if (node.accessibleName)
    return 'label';
  if (node.placeholder)
    return 'placeholder';
  if (node.text)
    return 'text';
  if ((node.stableClasses ?? []).length)
    return 'class';
  return 'css';
}

/** Is this recorded action a click on the recorder's own UI rather than the app? */
export function isRecorderOwnAction(locator: string): boolean {
  return locator.includes(PICKER_NAMESPACE) || locator.includes('data-aura-recorder-ui');
}


/* ------------------------------------- the contextual assertion locator (2C) */

/** The bounded container context the picker sends. In memory, never persisted. */
export interface PickerContext {
  documentId: string | null;
  targetIndex: number | null;
  ancestors: Array<{ tag: string; stableClasses: string[]; text: string }>;
}

/**
 * Is the ordinary assertion locator weak enough to be worth replacing?
 *
 * Deliberately narrow. A test id, a role with a name, an authored id or a label
 * already identifies the element, and a contextual locator is longer, more coupled
 * to page copy and no more true - so it is reached only for the shapes that
 * identify nothing on their own, and for an element whose id was refused as
 * dynamic. This is what keeps every existing assertion exactly as it was.
 */
export function needsContextualLocator(node: any): boolean {
  const strategy = strategyFor(node);
  if (strategy === 'class' || strategy === 'css')
    return true;
  // `#639978` never became the locator, but the element may still have nothing else.
  return Boolean(node?.id) && looksGenerated(String(node.id))
    && strategy !== 'role-name' && strategy !== 'stable-id' && strategy !== 'label';
}

/**
 * Everything that happens when a person presses an assertion, in order.
 *
 * EXTRACTED FROM THE BINDING, and only for the reason `splitCandidates` was: the
 * sequence had no test, and a sequence with no test is how a measured fact reaches
 * evidence as nothing at all. Both measurements here can only be taken while the
 * element is still selected, so getting the ORDER wrong is silent - the assertion is
 * still recorded, still looks right, and simply carries no provenance.
 *
 * The order is load-bearing twice over. The contextual locator is resolved FIRST,
 * because it may replace the locator that is about to be recorded. Provenance is
 * resolved LAST, because it counts the locator that was actually chosen - counting the
 * composed one when the contextual one won would be a measurement of a string that
 * appears nowhere.
 *
 * A failure anywhere is reported to the page as a refusal, never thrown: a recorder
 * that breaks the page cannot record anything.
 */
export async function recordAssertionFromPicker(
  frame: any,
  payload: PickerPayload & { capabilityId: string; value?: string | null; context?: PickerContext },
  into: RecordedAssertion[],
  outputFile: string,
  metrics?: LiveMetrics,
  /**
   * Where a pick-time capture is filed, keyed by its own `captureRef`.
   *
   * Passed in rather than held in module state so a test can drive the real sequence,
   * and so two recordings can never share one. Omitted - the pre-capture behaviour -
   * and the assertion simply falls back to node identity.
   */
  captures?: Map<string, TargetEvidence>,
): Promise<{ recorded: boolean; reason?: string }> {
  try {
    // Measured HERE, while the person still has the element selected and the page is
    // the one they are looking at. A locator is only substituted when the measurement
    // proves it identifies the subject itself.
    const proven = await resolveContextualAssertionLocator(frame, payload, metrics);
    const outcome = recordPickedAssertion(payload, into, outputFile, metrics, proven ?? undefined);
    if (outcome.recorded && outcome.assertion && outcome.asserted) {
      const provenance = await resolveAssertionProvenance(
          frame, outcome.asserted, outcome.assertion.locator, metrics);
      if (provenance) {
        // THE ASSERTION'S OWN EVIDENCE, taken now. A name that is unique per capture
        // rather than per element, because one element can be asserted about more than
        // once and each claim is about a different instant - which is exactly what
        // TC_LOGIN_107 does either side of its click. The element's own registration
        // name is the stem, so a reader can still see which node it belongs to.
        const captureRef = `${provenance.refs[0]}#${captures ? captures.size : 0}`;
        const captured = captures
          ? await captureAssertionTarget(frame, outcome.asserted, captureRef, metrics)
          : null;
        if (captured && captures) {
          captures.set(captureRef, captured);
          provenance.captureRef = captureRef;
        }
        outcome.assertion.subjectProvenance = provenance;
      }
    }
    // The picker reads `recorded` and `reason`; the assertion object never crosses the
    // binding, so it cannot be read or altered by the page.
    return { recorded: outcome.recorded, ...(outcome.reason ? { reason: outcome.reason } : {}) };
  } catch (error) {
    return { recorded: false, reason: String(error).slice(0, 120) };
  }
}

/**
 * Capture the asserted element's surroundings AT THE PICK, and measure its candidates
 * there - the evidence an assertion is entitled to and could not previously have.
 *
 * WHY THIS EXISTS. Before it, an assertion could only borrow an evidence row that some
 * ACTION had produced. TC_LOGIN_107 shows both halves of what that costs: its second
 * assertion followed a click on the checkbox, found that click's row, and resolved; its
 * FIRST assertion came before anything had been clicked, so there was no row to borrow
 * and the locator went out raw and failed strict mode on three elements. Borrowing the
 * later click's row would have been worse than failing - it would have judged a claim
 * about the unticked state on a measurement of a different instant.
 *
 * WHAT IT MEASURES. Exactly what a press measures, through exactly the same two calls:
 * `__auraObserveSlot` for the graph, `candidateSelectorsFor` for the shapes worth
 * measuring, `__auraMeasure` for the counts, the identity check and the position. Only
 * the timing differs, and it is recorded as `pick` so nothing downstream can mistake it
 * for a press.
 *
 * WHAT IT NEVER DOES. It does not park a press, so this graph cannot be claimed by a
 * recorded action line. It does not touch the page. It returns null on every failure -
 * a missing hook, a changed document, an element that has gone - and the assertion is
 * then recorded exactly as it was before any of this existed.
 */
async function captureAssertionTarget(
  frame: any,
  subject: { documentId: string | null; slot: number | null },
  captureRef: string,
  metrics?: LiveMetrics,
): Promise<TargetEvidence | null> {
  if (!frame || subject.slot === null)
    return null;

  let observed: any;
  try {
    observed = await frame.evaluate(OBSERVE_IN_PAGE,
        { index: subject.slot, documentId: subject.documentId ?? null });
  } catch {
    return null;
  }
  const raw = observed?.graph;
  if (!raw?.target)
    return null;

  // The same derivation the press path uses. Two copies of "which shapes are worth
  // measuring" is how the two would drift, so there is one - including the same split
  // into what `querySelectorAll` can evaluate and what only Playwright can. A pick has
  // a registered node, so a semantic candidate CAN be identity-checked here, and it is.
  // The same capability at the other capture site, for the same reason: a candidate is
  // about to be derived from the name, so the browser's answer has to arrive first.
  const computedName = await browserAccessibleName(frame, { targetIndex: subject.slot });
  if (computedName && raw.target) {
    raw.target.accessibleName = computedName.name;
    raw.target.accessibleNameSource = 'browser-computed';
    raw.target.accessibleNameVerified = true;
  }

  const derived = candidateSelectorsFor({ ...raw }, looksGenerated);
  const candidates = derived.filter(candidate => candidate.measuredBy !== 'expression');
  const byExpression = await measureExpressionCandidates(
      frame,
      { targetIndex: subject.slot, documentId: observed.documentId ?? null },
      derived.filter(candidate => candidate.measuredBy === 'expression'),
      'pick',
  );
  // THE SAME QUESTION AT A PICK. An assertion is a claim about the page as it stood
  // when the person made it, and "which capability is this element?" is as answerable
  // then as at a press - by the same measurement, at the pick's own moment.
  const capabilityMeasurements = await measureDeclaredCapabilities(
      frame, { targetIndex: subject.slot, documentId: observed.documentId ?? null }, 'pick');
  const ownText = usableCandidateText(raw.target?.text, looksGenerated);
  let answer: any = null;
  if (candidates.length || ownText) {
    try {
      answer = await frame.evaluate(MEASURE_IN_PAGE, {
        index: subject.slot,
        documentId: observed.documentId ?? null,
        ...(ownText ? { ownText } : {}),
        candidates: candidates.map(candidate => ({
          strategy: candidate.strategy,
          selector: candidate.selector,
          ...(candidate.text === undefined ? {} : { text: candidate.text, textMode: candidate.textMode }),
          ...(candidate.descendant === undefined ? {} : { descendant: candidate.descendant }),
        })),
      });
    } catch {
      answer = null;
    }
  }

  const measured: CandidateMeasurement[] = [...byExpression];
  (answer?.results ?? []).forEach((result: any, index: number) => {
    const candidate = candidates[index];
    if (!candidate || (result.strategy && result.strategy !== candidate.strategy))
      return;
    measured.push({
      strategy: candidate.strategy,
      expression: candidate.expression,
      matchCount: typeof result.count === 'number' ? result.count : null,
      sameDocument: answer.sameDocument === true,
      // THE ONE DIFFERENCE from a press, and it is a statement of fact rather than a
      // downgrade: this was measured when the person asserted.
      measuredAt: 'pick',
      ...(answer.targetPresent ? { identityMatched: result.identityMatched === true } : {}),
      ...(typeof result.positionWithinCandidate === 'number'
        ? { positionWithinCandidate: result.positionWithinCandidate }
        : {}),
      ...(result.measurementError ? { measurementError: String(result.measurementError).slice(0, 80) } : {}),
    });
  });

  const { analyseIdentifier } = require('../autocode/locator-quality') as
    typeof import('../autocode/locator-quality');
  const identifier = raw.target?.id ? analyseIdentifier(raw.target.id) : undefined;
  if (metrics)
    metrics.assertionCaptures += 1;

  return {
    // NOT a recorded locator. This row is reached by `captureRef`, never by a string,
    // and `evidenceFor` deliberately cannot see it - see its note.
    locator: `(assertion pick ${captureRef})`,
    captureRef,
    ...(typeof observed.elementRef === 'string' && observed.elementRef
      ? { elementRef: observed.elementRef }
      : {}),
    // The screen the person was looking at when they made the claim - the same fact,
    // read the same way, at the moment that is right for an assertion.
    ...(typeof observed.route === 'string' && observed.route ? { route: observed.route } : {}),
    captureTiming: 'assertion-pick',
    target: raw.target,
    ...(raw.parent ? { parent: raw.parent } : {}),
    ancestors: raw.ancestors ?? [],
    children: raw.children ?? [],
    descendants: raw.descendants ?? [],
    previousSiblings: raw.previousSiblings ?? [],
    nextSiblings: raw.nextSiblings ?? [],
    relationships: [
      ...(raw.parent ? ['parent' as const] : []),
      ...((raw.children ?? []).length ? ['child' as const] : []),
      ...((raw.ancestors ?? []).length ? ['ancestor' as const] : []),
      ...((raw.descendants ?? []).length ? ['descendant' as const] : []),
      ...((raw.previousSiblings ?? []).length ? ['previous-sibling' as const] : []),
      ...((raw.nextSiblings ?? []).length ? ['next-sibling' as const] : []),
    ],
    // There is no recorded expression to count, so there is no count. The assertion's
    // OWN locator is counted separately and lives on its provenance.
    matchCount: null,
    matchCountDocument: 'unknown',
    ...(observed.documentId ? { documentId: observed.documentId } : {}),
    ...(answer?.ownText && answer.sameDocument === true
      ? {
        pressTimeText: {
          text: ownText as string,
          matchCount: typeof answer.ownText.matchCount === 'number' ? answer.ownText.matchCount : null,
          identityMatched: answer.ownText.identityMatched === true,
        },
      }
      : {}),
    attached: raw.attached,
    viewport: raw.viewport,
    ...(identifier ? { identifier: { raw: identifier.value, dynamic: identifier.dynamic, normalised: identifier.normalised } } : {}),
    ...(capabilityMeasurements.length ? { capabilityMeasurements } : {}),
    ...splitCandidates(measured, metrics),
  };
}

/**
 * WHICH element an assertion is about, and the registry slot holding that very node.
 *
 * ONE derivation, because two things now need it and they must never disagree: the
 * contextual locator measures candidates against the subject, and the provenance
 * record names the presses that were on the subject. Two copies of "which element" is
 * how one of them would end up describing the thing under the pointer while the other
 * described the control it forwards to.
 *
 * The pointer is often not on the subject at all - a custom switch's state lives on a
 * 0x0 input behind a decorated span - so the answer comes from the association
 * resolver, and the slot comes from the registration the PAGE made for whichever node
 * that resolver chose. `slot: null` means the page could not register it, and nothing
 * downstream may proceed on a description instead.
 */
function assertionSubjectSlot(
  payload: PickerPayload & { context?: PickerContext },
): { node: any; slot: number | null } {
  const resolved = resolveAssertionSubject(payload.node ?? {}, payload.candidates);
  const node: any = resolved ? resolved.node : (payload.node ?? {});
  return { node, slot: registrySlotFor(payload, node) };
}

/**
 * The registry slot the page allocated for THIS node, or null.
 *
 * Candidates first, because an associated control only ever arrives that way and the
 * pointed-at element never does - `associatedCandidates` skips the element itself. So
 * the two cases cannot be confused, and the fallback is the pointed-at element's own
 * slot, which the picker sends as `context.targetIndex`.
 *
 * One rule, used by everything that needs a slot. The subject of a state assertion and
 * the subject of a VISIBILITY assertion are different elements, and each has to get
 * its own.
 */
function registrySlotFor(
  payload: PickerPayload & { context?: PickerContext },
  node: any,
): number | null {
  const fromCandidate = (payload.candidates ?? [])
      .find(candidate => candidate.node === node)?.targetIndex;
  if (typeof fromCandidate === 'number')
    return fromCandidate;
  const own = payload.context?.targetIndex;
  return typeof own === 'number' ? own : null;
}

/**
 * WHICH RECORDED TARGET this assertion is about - the association, captured at pick
 * time, from the only place it can be captured.
 *
 * THE PROBLEM. An assertion's locator is composed by `locatorFor` from the element's
 * own description; a recorded action's locator is composed by Codegen from the same
 * element by different rules. Both are correct and they need share no substring, so
 * `evidenceFor` - which joins on the locator STRING - finds nothing for the assertion
 * even when the very element it is about has a full evidence row two lines away.
 * TC_DASHBOARD_023 is the case: `page.locator(".bugChecked")` against a row recorded
 * as `page.locator('[id="1749552"]')`, one element, no shared text, no evidence, a raw
 * locator emitted and a strict-mode violation at run time - with the measured proof of
 * which of the three was meant sitting in the same file.
 *
 * WHAT IS ACTUALLY AVAILABLE HERE, and it is the whole answer: the page still holds
 * the node. The press parked it and named the registration; the picker registers the
 * subject and gets a slot; `__auraSameElement` compares them with `===`. So the
 * association is an identity check on real DOM nodes, taken while both are alive.
 *
 * WHAT IS DELIBERATELY NOT USED. Not the selector text, not the generated id, not DOM
 * proximity, not the previous step, not a matching index, not a similar class name.
 * None of those can distinguish "the same element" from "an element that looks like
 * it", which is the only distinction that matters here.
 *
 * THE SECOND MEASUREMENT. The assertion's own locator has never been counted by
 * anything: `matchCount` on a recorded target counts CODEGEN's expression. So it is
 * counted here, by Playwright itself, in the page the person is looking at and at the
 * moment the assertion is made - which is also the moment the assertion is about. That
 * is what lets an ambiguous assertion locator be REFUSED as measured-ambiguous instead
 * of scored on its shape and emitted.
 *
 * `null` whenever anything is unproven, and the caller then records the assertion
 * exactly as it did before.
 */
export async function resolveAssertionProvenance(
  frame: any,
  /**
   * WHICH element, decided by the caller, and its registration slot.
   *
   * Deliberately not a payload. The element an assertion is about is not always the
   * subject the association resolver names: a state assertion belongs to the control
   * that holds the state, and a VISIBILITY assertion belongs to the element a person
   * can actually see - a custom switch's subject is a 0x0 input, so `toBeVisible()`
   * against it would be a red test about correct behaviour. `recordPickedAssertion` is
   * the one place that decides which, so it is the one place that supplies the slot.
   * Deriving it here from the payload instead named the input for a `visible` assertion
   * recorded against the span, which would have judged one element's locator against
   * another element's evidence.
   */
  subject: { documentId: string | null; slot: number | null },
  locator: string,
  metrics?: LiveMetrics,
): Promise<AssertionProvenance | null> {
  if (!frame || subject.slot === null)
    return null;

  let answer: any;
  try {
    answer = await frame.evaluate(SAME_ELEMENT_IN_PAGE, {
      index: subject.slot,
      documentId: subject.documentId ?? null,
    });
  } catch {
    return null;
  }
  // Every one of these is a REFUSAL, not a degradation: a different document means the
  // registry that holds the node is gone, an absent target means the slot was released,
  // and an empty list means no recorded press was ever on this element.
  if (!answer || answer.sameDocument !== true || answer.targetPresent !== true) {
    if (metrics)
      metrics.provenanceUnavailable += 1;
    return null;
  }
  const refs = (Array.isArray(answer.refs) ? answer.refs : [])
      .filter((ref: unknown): ref is string => typeof ref === 'string' && Boolean(ref));
  if (!refs.length) {
    if (metrics)
      metrics.provenanceUnavailable += 1;
    return null;
  }

  const provenance: AssertionProvenance = {
    refs,
    locatorMatchCount: await countQuietly(frame, locator),
  };
  if (metrics)
    metrics.provenanceAssertions += 1;
  return provenance;
}

/**
 * A contextual locator for the assertion SUBJECT, proven at pick time - or null.
 *
 * The whole weight is on the last word. Candidates are built from the container
 * context the picker captured, then measured by the SAME engine the action path
 * uses - `__auraMeasure`, reached through the registry slot the picker registered -
 * and one is returned only when it matched exactly one element, in the document the
 * person was looking at, and that element is the subject itself.
 *
 * `null` is the ordinary answer and the safe one: the caller writes what it has
 * always written, and an unresolvable locator is refused downstream exactly as it
 * is today. Nothing here guesses, and nothing is accepted for being unique.
 */
export async function resolveContextualAssertionLocator(
  frame: any,
  payload: PickerPayload & { context?: PickerContext },
  metrics?: LiveMetrics,
): Promise<{ locator: string; locatorStrategy: string } | null> {
  const context = payload.context;
  if (!frame || !context || !Array.isArray(context.ancestors) || !context.ancestors.length)
    return null;

  const subject = assertionSubjectSlot(payload);
  if (subject.slot === null)
    return null;
  const subjectIndex = subject.slot;
  const subjectNode = subject.node;
  if (!needsContextualLocator(subjectNode))
    return null;

  const candidates = candidateSelectorsFor(
      { target: subjectNode, ancestors: context.ancestors as any },
      looksGenerated,
  ).filter(candidate => candidate.strategy === 'container-text');
  if (!candidates.length)
    return null;

  let answer: any;
  try {
    answer = await frame.evaluate(MEASURE_IN_PAGE, {
      index: subjectIndex,
      documentId: context.documentId ?? null,
      candidates: candidates.map(candidate => ({
        strategy: candidate.strategy, selector: candidate.selector,
        text: candidate.text, textMode: candidate.textMode, descendant: candidate.descendant,
      })),
    });
  } catch {
    return null;
  }
  if (!answer || answer.targetPresent !== true)
    return null;

  for (let index = 0; index < candidates.length; index++) {
    const result = answer.results?.[index];
    if (!result)
      continue;
    const measurement: CandidateMeasurement = {
      strategy: candidates[index].strategy,
      expression: candidates[index].expression,
      matchCount: typeof result.count === 'number' ? result.count : null,
      identityMatched: result.identityMatched === true,
      sameDocument: answer.sameDocument === true,
      measuredAt: 'pick',
    };
    if (isProvenAtPick(measurement)) {
      if (metrics)
        metrics.contextualAssertions += 1;
      return { locator: measurement.expression, locatorStrategy: 'container-text' };
    }
  }
  return null;
}
