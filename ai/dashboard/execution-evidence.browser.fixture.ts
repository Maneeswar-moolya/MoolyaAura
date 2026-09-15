/**
 * Step-by-step report: each step shows ITS OWN picture, and the report can be downloaded.
 *
 * Seeded at the API's own storage boundary - a completed run record, its evidence copies
 * and its report - rather than by running two live executions, so the contracts that matter
 * here run in seconds instead of minutes. What is being proven is the half that was broken:
 * that a passing step's evidence reaches the screen, that switching steps switches the
 * image, that no step is ever shown a neighbour's picture, and that the download control
 * appears and targets this run.
 */
import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { writeFixtureFile } from '../testing/synthetic-data';
import { renderRunReport } from './run-report';
import { stopFixtureProcess } from '../testing/process-fixture';

/** A distinct 1x1 PNG per step, so "which picture is on screen" is answerable by bytes. */
function png(seed: number): Buffer {
  const base = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489';
  const tail = '0000001049444154789c6360' + seed.toString(16).padStart(2, '0') + '0000000400010001';
  return Buffer.from(base + tail + '0000000049454e44ae426082', 'hex');
}

const RUN = '2026-09-15T00-00-00-000Z-fixture-qa-1';
const PARENT = '2026-09-15T00-00-00-000Z-fixture';
const STEPS = [
  { key: 'action:1', title: 'Open recorded destination', status: 'passed', type: 'POST_STEP' },
  { key: 'action:2', title: 'Enter account from configured credentials', status: 'passed', type: 'POST_STEP' },
  { key: 'action:3', title: 'Click My Support Cases', status: 'failed', type: 'FAILURE' },
];

async function main() {
  writeFixtureFile('ai/projects/registry.json', JSON.stringify({ schemaVersion: 1, applications: [{
    applicationId: 'alpha', displayName: 'alpha', workbooks: ['excel/alpha.xlsx'], defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://portal.example.invalid/' } } }] }));

  const runsDir = path.resolve('ai/dashboard/runs');
  const evidenceRoot = path.join(runsDir, RUN, 'evidence');
  const steps = STEPS.map((step, at) => {
    const captureRef = `cap-${at}`;
    const relative = `steps/TC_UI/attempt-1/step-${at}/${captureRef}.png`;
    fs.mkdirSync(path.dirname(path.join(evidenceRoot, relative)), { recursive: true });
    fs.writeFileSync(path.join(evidenceRoot, relative), png(at + 1));
    return { applicationId: 'alpha', environmentId: 'qa', runId: RUN, attemptId: 'attempt-1', attemptNumber: 1,
      stepId: `step-${at}`, index: at + 1, title: step.title, status: step.status,
      durationMs: 1000 * (at + 1), diagnostic: { recordingStepKey: step.key },
      ...(step.status === 'failed' ? { error: 'Synthetic assertion disagreed' } : {}),
      // Step 1 deliberately carries NO legacy timing field: its caption has to come from
      // the capture it holds, which is the channel that was missing.
      ...(at === 0 ? {} : { captureTiming: step.status === 'failed' ? 'after-failure' : 'after-step' }),
      captures: [{ captureRef, captureType: step.type, capturedAt: '2026-09-15T00:00:0' + at + '.000Z',
        url: `/api/runs/${RUN}/evidence/${relative}` }] };
  });
  const child: any = { id: RUN, applicationId: 'alpha', environmentId: 'qa', environmentDisplayName: 'QA',
    parentExecutionId: PARENT, startedAt: '2026-09-15T00:00:00.000Z', finishedAt: '2026-09-15T00:00:42.000Z',
    status: 'completed', exitCode: 1, hasReport: true,
    executionProfile: { credentialProfileName: 'qaCommonUser' },
    results: [{ testCaseId: 'TC_UI', scenario: 'Synthetic scenario', executionStatus: 'Failed',
      applicationId: 'alpha', environmentId: 'qa', failureReason: 'Synthetic assertion disagreed' }],
    evidence: [], steps: { TC_UI: steps }, summary: { passed: 0, failed: 1, skipped: 0 } };
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, `${RUN}.json`), JSON.stringify(child, null, 2));
  fs.writeFileSync(path.join(runsDir, `${PARENT}.json`), JSON.stringify({ ...child, id: PARENT,
    parentExecutionId: undefined, environmentId: undefined, hasReport: false,
    environmentRuns: [child] }, null, 2));
  fs.mkdirSync(path.join(runsDir, RUN, 'report'), { recursive: true });
  fs.writeFileSync(path.join(runsDir, RUN, 'report', 'index.html'),
    renderRunReport({ id: RUN, applicationId: 'alpha', environmentId: 'qa', environmentDisplayName: 'QA',
      startedAt: child.startedAt, finishedAt: child.finishedAt, exitCode: 1,
      executionProfileName: 'qaCommonUser', results: child.results, steps: child.steps }, evidenceRoot));

  const probe = http.createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as any).port; await new Promise<void>(r => probe.close(() => r()));
  const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/dashboard/server.ts'],
    { env: { ...process.env, EXCEL_DASHBOARD_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; server.stdout.on('data', b => log += b); server.stderr.on('data', b => log += b);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  let checks = 0;
  const check = (condition: unknown, what: string) => { assert.ok(condition, what); checks++; };
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
      if (server.exitCode !== null) throw Error(log); await new Promise(r => setTimeout(r, 100)); }

    /* The API returns each step's own capture, keyed to that step. */
    const api = await (await fetch(`${base}/api/runs/${encodeURIComponent(RUN)}?applicationId=alpha&environmentId=qa`)).json() as any;
    const served = api.steps.TC_UI;
    check(served.length === 3, 'every recorded step reaches the API');
    for (let at = 0; at < served.length; at++) {
      check(served[at].captures?.length === 1, `step ${at + 1} carries its own capture`);
      check(served[at].captures[0].url.includes(`/step-${at}/`),
        `step ${at + 1} addresses its OWN artifact: ${served[at].captures[0].url}`);
      check(served[at].diagnostic.recordingStepKey === STEPS[at].key,
        `step ${at + 1} keeps its generated step key with no index shifting`);
    }
    check(new Set(served.map((s: any) => s.captures[0].url)).size === 3, 'no two steps share a url');
    const direct = await fetch(`${base}${served[0].captures[0].url}?applicationId=alpha&environmentId=qa`);
    check(direct.ok && (direct.headers.get('content-type') ?? '').startsWith('image/'),
      'the evidence route serves a capture url the API published');

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.locator('#project').selectOption('alpha');
    await page.locator('#tab-executions').click();
    await page.locator('#reportRun').selectOption(PARENT);
    await page.locator('#evidenceCanvas img').waitFor({ state: 'visible' });

    /* Selecting a step shows THAT step, and returning shows it again. */
    // The image is rendered from a blob url, which is new every time, so WHICH artifact the
    // page asked for is what identifies it - and that is the thing under test.
    const fetched: string[] = [];
    page.on('request', request => {
      const at = request.url().indexOf('/evidence/steps/');
      if (at >= 0) fetched.push(request.url().slice(at + '/evidence/'.length).split('?')[0]);
    });
    const captions: string[] = [];
    for (const at of [0, 1, 2, 1]) {
      fetched.length = 0;
      await page.locator('.step-choice').nth(at).click();
      await page.locator('#evidenceCanvas img').waitFor({ state: 'visible' });
      for (let i = 0; i < 50 && !fetched.length; i++) await page.waitForTimeout(40);
      captions.push(await page.locator('#evidenceCaption').innerText());
      check(fetched.length === 1, `step ${at + 1} fetched exactly one artifact: ${fetched.join(', ')}`);
      check(fetched[0].includes(`/step-${at}/`),
        `selecting step ${at + 1} fetched THAT step's artifact, never a neighbour's: ${fetched[0]}`);
    }
    check(/Captured after the step completed/.test(captions[0]),
      `a passing step reports when it was captured: ${captions[0]}`);
    check(/Captured on failure/.test(captions[2]),
      `the failing step reports its failure state: ${captions[2]}`);
    check(!/Capture timing not recorded/.test(captions.join(' ')),
      'no step reports unknown timing for evidence it is holding');
    check(/Enter account from configured credentials/.test(captions[1]),
      'a credential step still shows evidence, masked at capture rather than withheld');

    /* Download Report appears, and targets THIS run. */
    const link = page.locator('#reportLink');
    check(await link.isVisible(), 'the download control appears when a report artifact exists');
    const href = await link.getAttribute('href');
    check(!!href && href.includes(encodeURIComponent(RUN)), `the download targets this run: ${href}`);
    // The SELECTED environment run, not the parent it hangs under: the parent kept no
    // report of its own, and downloading it would hand back a different execution.
    check(href!.endsWith(`/runs/${encodeURIComponent(RUN)}/report/`),
      `the download targets the selected attempt exactly: ${href}`);
    const parentReport = await fetch(`${base}/api/projects/alpha/runs/${encodeURIComponent(PARENT)}/report/`);
    check(!parentReport.ok, 'a run that kept no report offers none rather than a different one');
    const report = await fetch(new URL(href!, base).toString());
    const html = await report.text();
    check(report.ok && /MoolyaAura execution report/.test(html), 'the report downloads from that url');
    check(html.includes('qaCommonUser') && html.includes('TC_UI') && html.includes('Synthetic assertion disagreed'),
      'and carries the profile name, the case and the failure reason');
    check((html.match(/data:image\/png;base64,/g) ?? []).length === 3, 'with each step\'s own evidence embedded');
    assert.deepEqual(errors, [], 'the page raised no script errors');
    console.log(`PASS ${checks} execution evidence browser contracts`);
  } finally {
    await browser.close();
    await stopFixtureProcess(server);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
