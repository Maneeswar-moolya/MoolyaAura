/**
 * A step that passed is a step with evidence.
 *
 * WHAT WAS MEASURED, AND WHERE IT WENT
 *
 * A successful execution showed its whole step list and, for every step, "No screenshot
 * captured" and "Capture timing not recorded". The pictures were on disk the whole time -
 * eight of them in the attempt directory. Three separate things had to be true at once:
 *
 *   1. a run started from an execution selection forced `EXCEL_SCREENSHOT=off`, while the
 *      per-step capture path ignored that control and photographed anyway. So the settings
 *      said no pictures, pictures were taken, and nothing downstream expected any;
 *   2. a capture named its file relative to the TEST's output directory, but retention
 *      copies that directory into the attempt keeping its path - so `aura-….png` described
 *      a file one level down, and every reference resolved nowhere;
 *   3. the execution API published only the legacy single `screenshotUrl`, which is set
 *      only by the legacy capture mode. The per-step `captures[]` - which existed, with
 *      their types and timestamps - were never copied into the run and never served.
 *
 * The rule now: one capture policy, the control the dashboard already offers; a step's
 * pictures are addressed by its own step and capture reference; and what the framework
 * knows about timing is what the screen says.
 */
import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStep, StepRecorder, flushSteps, STEPS_DIR } from '../../tests-e2e/support/steps';
import { renderRunReport } from '../dashboard/run-report';
import { workspaceData } from '../testing/workspace-data';

const SECRET = 'synthetic-secret-value-9f2';
// Registered as a protected value, because redaction covers what POLICY classifies as a
// secret and never guesses at an arbitrary string. This is the same channel the run
// diagnostics already read.
process.env.SYNTHETIC_FIXTURE_SECRET = SECRET;
const ABSOLUTE = process.platform === 'win32' ? 'C:\\Users\\someone\\secrets' : '/home/someone/secrets';

/** A page that photographs, masks and can be closed, without a browser. */
function fakePage(outputDir: string) {
  return {
    closed: false,
    isClosed() { return this.closed; },
    url: () => 'https://portal.example.invalid/account?token=SHOULD_NOT_APPEAR',
    frames() { return [{ locator: () => ({}), getByText: () => ({}) }]; },
    async screenshot({ path: file }: { path: string }) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // A 1x1 PNG. The bytes do not matter; which step owns them does.
      fs.writeFileSync(file, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex'));
    },
  } as any;
}

function fakeTestInfo(root: string, name: string) {
  const outputDir = path.join(root, name);
  fs.mkdirSync(outputDir, { recursive: true });
  const attachments: Array<{ name: string; path: string }> = [];
  return {
    outputDir, project: { name: 'chromium', outputDir: root },
    file: path.join(process.cwd(), 'tests-e2e', 'generated', 'synthetic.spec.ts'),
    testId: 'synthetic-test', repeatEachIndex: 0, retry: 0,
    outputPath: (file: string) => path.join(outputDir, file),
    attach: async (label: string, options: { path: string }) => { attachments.push({ name: label, path: options.path }); },
    attachments,
  } as any;
}

async function record(root: string, mode: string, bodies: Array<() => Promise<void>>) {
  process.env.EXCEL_SCREENSHOT = mode;
  const recorder = new StepRecorder();
  const testInfo = fakeTestInfo(root, `run-${mode}-${bodies.length}-${Math.random().toString(36).slice(2, 7)}`);
  const page = fakePage(testInfo.outputDir);
  const failures: string[] = [];
  for (let at = 0; at < bodies.length; at++) {
    try { await runStep(recorder, page, testInfo, `Step ${at + 1}`, bodies[at]); }
    catch (error) { failures.push(String((error as Error).message)); break; }
  }
  return { recorder, testInfo, failures };
}

async function main() {
  const { scope } = workspaceData();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-execution-evidence-'));
  process.env.AURA_RUN_ID = 'synthetic-run';
  let checks = 0;
  const check = (condition: unknown, what: string) => { assert.ok(condition, what); checks++; };

  /* 1. A PASSING test: every step keeps its own after-step picture. */

  const pass = await record(root, 'on', [async () => {}, async () => {}, async () => {}]);
  check(pass.recorder.steps.length === 3, 'three steps ran');
  for (const step of pass.recorder.steps) {
    const after = (step.captures ?? []).filter(capture => capture.captureType === 'POST_STEP');
    check(step.status === 'passed', `step ${step.index} passed`);
    check(after.length === 1, `step ${step.index} keeps exactly one after-step picture`);
    check(step.captureTiming === 'after-step',
      `step ${step.index} records WHEN it was captured, not "timing not recorded"`);
  }
  // Each step's own file, and a path that resolves from the output root the manifest,
  // the retention copy and the run evidence copy all speak.
  const artifacts = pass.recorder.steps.flatMap(step => (step.captures ?? []).map(capture => capture.artifact));
  check(new Set(artifacts).size === artifacts.length, 'no two steps share a picture');
  for (const artifact of artifacts) {
    check(!path.isAbsolute(artifact) && !artifact.includes('..'), `run-relative artifact: ${artifact}`);
    check(artifact.includes('/'), `the artifact names its directory, not just a filename: ${artifact}`);
    check(fs.existsSync(path.join(root, artifact)), `the file is where the reference says: ${artifact}`);
  }
  console.log('PASS passing steps each retain their own after-step picture');

  /* 2. A FAILING test: failure state captured, later steps never run. */

  const fail = await record(root, 'on', [
    async () => {}, async () => { throw new Error(`Synthetic step failure near ${SECRET}`); }, async () => {},
  ]);
  check(fail.recorder.steps.length === 2, 'the step after the failure never ran');
  check(fail.recorder.steps[0].status === 'passed' && fail.recorder.steps[1].status === 'failed',
    'one passed, one failed');
  check((fail.recorder.steps[1].captures ?? []).some(capture => capture.captureType === 'FAILURE'),
    'the failing step keeps a failure-state picture');
  check(fail.recorder.steps[1].captureTiming === 'after-failure', 'and says it was captured on failure');
  check(!!fail.recorder.steps[1].error, 'the failure reason is retained');
  check(!JSON.stringify(fail.recorder.steps).includes(SECRET),
    'and the reason is redacted rather than repeating a secret');
  check(fail.failures.length === 1, 'the original exception still reached the caller');
  console.log('PASS a failing step keeps its failure state and the exception survives');

  /* 3. The capture control is honoured - in both directions. */

  const off = await record(root, 'off', [async () => {}, async () => {}]);
  check(off.recorder.steps.every(step => (step.captures ?? []).length === 0),
    'capture off means no pictures are taken at all');
  check(off.recorder.steps.every(step => !step.captureTiming), 'and none claims a capture timing');
  const onFailureOnly = await record(root, 'only-on-failure', [
    async () => {}, async () => { throw new Error('Synthetic failure'); },
  ]);
  check((onFailureOnly.recorder.steps[0].captures ?? []).length === 0,
    'only-on-failure photographs no passing step');
  check((onFailureOnly.recorder.steps[1].captures ?? []).some(capture => capture.captureType === 'FAILURE'),
    'and still photographs the one that broke');
  console.log('PASS the dashboard capture control governs step evidence in both directions');

  /* 4. A step that cannot be photographed says so, rather than reading as unphotographed. */

  const closed = await record(root, 'on', [async () => {}]);
  const shut = new StepRecorder();
  const shutInfo = fakeTestInfo(root, 'shut');
  const shutPage = fakePage(shutInfo.outputDir); shutPage.closed = true;
  await runStep(shut, shutPage, shutInfo, 'After the page closed', async () => {});
  check((shut.steps[0].captures ?? []).length === 0, 'a closed page yields no picture');
  check(/had already closed/.test(shut.steps[0].captureUnavailable ?? ''),
    `the reason is recorded: ${shut.steps[0].captureUnavailable}`);
  check(closed.recorder.steps.length === 1, 'the control case still captured normally');
  console.log('PASS an unavailable capture records its reason instead of reading as absent');

  /* 5. The flushed log is the join the report and the manifest both read. */

  // STEPS_DIR is resolved when the module loads, so it is read rather than redirected here.
  flushSteps('TC_SYNTHETIC', 'TC_SYNTHETIC - synthetic', pass.recorder);
  const written = fs.readdirSync(STEPS_DIR).filter(name => name.startsWith('TC_SYNTHETIC'));
  check(written.length === 1, `the run wrote one step log: ${written.join(', ')}`);
  const flushed = JSON.parse(fs.readFileSync(path.join(STEPS_DIR, written[0]), 'utf8'));

  check(flushed.steps.length === 3 && flushed.steps.every((step: any) => step.captures.length >= 1),
    'the flushed log carries each step\'s captures');
  check(flushed.steps.every((step: any) => step.captures.every((capture: any) => !path.isAbsolute(capture.artifact))),
    'and no absolute path survives into it');

  /* 6. The downloadable report: one row per step, its own evidence, and nothing secret. */

  const evidenceRoot = path.join(root, 'evidence');
  // EVERY capture the step took is published, exactly as the execution API publishes them,
  // so the report's own ranking is what decides which one a reader is shown.
  const served = pass.recorder.steps.map((step, at) => ({
    ...step, attemptId: 'attempt-1', attemptNumber: 1,
    captures: (step.captures ?? []).map(capture => {
      const relative = `steps/TC_SYNTHETIC/attempt-1/step-${at}/${capture.captureRef}.png`;
      const destination = path.join(evidenceRoot, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, capture.artifact), destination);
      return { captureRef: capture.captureRef, captureType: capture.captureType,
        capturedAt: capture.capturedAt, url: `/api/runs/synthetic-run/evidence/${relative}` };
    }),
  }));
  const failing = { ...fail.recorder.steps[1], attemptId: 'attempt-1', attemptNumber: 1, captures: [] };
  const html = renderRunReport({
    id: 'synthetic-run', applicationId: scope.applicationId, environmentId: 'qa',
    environmentDisplayName: 'QA', startedAt: '2026-09-15T10:00:00.000Z', finishedAt: '2026-09-15T10:00:42.000Z',
    status: 'completed', exitCode: 1, executionProfileName: 'qaCommonUser',
    sourceEnvironmentId: 'qa',
    results: [{ testCaseId: 'TC_SYNTHETIC', scenario: 'Synthetic scenario', executionStatus: 'Failed',
      // A run result reaches the report unredacted, so the report's OWN sanitisation is
      // what has to hold here - not a redaction that happened somewhere upstream.
      failureReason: `Assertion disagreed near ${ABSOLUTE} using ${SECRET}` }],
    steps: { TC_SYNTHETIC: [...served, failing] as any },
  }, evidenceRoot);

  for (const required of ['TC_SYNTHETIC', 'qaCommonUser', 'synthetic-run', 'QA',
    'Synthetic scenario', 'Captured after the step completed', 'Failure reason', '0.0']) {
    check(html.includes(required), `the report states ${required}`);
  }
  check((html.match(/data:image\/png;base64,/g) ?? []).length === 3,
    'each step with evidence embeds its OWN picture, so the report travels on its own');
  check(html.includes('No screenshot retained'), 'and a step without one says so');
  check(html.includes('Synthetic step failure'), 'the failure reason appears');
  check(!html.includes(SECRET), 'no secret reaches the report');
  check(!html.includes(ABSOLUTE) && !/[A-Za-z]:\\\\Users\\\\/.test(html) && !html.includes('/home/someone'),
    'no absolute local path reaches the report');
  check(!html.includes('token=SHOULD_NOT_APPEAR'), 'no query string with a token reaches the report');
  check(!/<script/i.test(html), 'the report runs nothing');
  console.log('PASS the downloadable report carries run, profile name, steps, evidence and failure reason');

  /* 7. Evidence belongs to the step that produced it. */

  const keys = served.map(step => step.captures.find(c => c.captureType === 'POST_STEP')!.url);
  check(new Set(keys).size === keys.length, 'each step addresses a different artifact');
  for (let at = 0; at < served.length; at++)
    check(keys[at].includes(`/step-${at}/`), `step ${at} resolves its own capture, not a neighbour's`);
  console.log(`PASS ${checks} execution evidence contracts`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
