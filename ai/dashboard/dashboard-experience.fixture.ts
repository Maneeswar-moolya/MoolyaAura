import '../testing/isolated-checkout';
import { waitForFixtureHttp, stopFixtureProcess } from '../testing/process-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

async function main() {
  const root = process.cwd();
  assert.equal(root, process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const portProbe = http.createServer();
  await new Promise<void>(r => portProbe.listen(0, '127.0.0.1', r));
  const port = (portProbe.address() as any).port;
  await new Promise<void>(r => portProbe.close(() => r()));
  fs.writeFileSync(process.env.AURA_REGISTRY_FILE!, JSON.stringify({ schemaVersion: 1, applications: [] }));
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/dashboard/server.ts'], {
    cwd: root, env: { ...process.env, EXCEL_DASHBOARD_PORT: String(port), AURA_APPLICATION: '', AURA_ENVIRONMENT: '' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const url = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    await waitForFixtureHttp(child, url + '/api/health', () => output);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/projects')), page.goto(url)]);
    const capture = process.env.AURA_UI_CAPTURE_DIR;
    if (capture) { fs.mkdirSync(capture, { recursive: true }); await page.screenshot({ path: path.join(capture, process.argv.includes('--capture-before') ? 'before-empty.png' : 'after-empty.png'), fullPage: true }); }
    if (process.argv.includes('--capture-before')) { console.log('PASS captured actual empty dashboard before implementation'); return; }
    assert.equal(await page.locator('#sidebarToggle').count(), 1, 'Collapsible sidebar is available');
    await page.locator('#sidebarToggle').click();
    assert.equal(await page.locator('#sidebarToggle').getAttribute('aria-expanded'), 'false');
    await page.locator('#sidebarToggle').press('Enter');
    assert.equal(await page.locator('#sidebarToggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#tab-executions').click();
    assert.match(await page.locator('#breadcrumb').innerText(), /Executions/);
    assert.equal(await page.locator('#reportInspector').count(), 1);
    await page.locator('#tab-overview').click();
    await page.locator('#welcomeAddProject').click();
    await page.locator('#apName').fill('Orion quality workspace');await page.locator('#apId').fill('orion');await page.locator('#apEnv').fill('qa');await page.locator('#apUrl').fill('https://qa.synthetic.invalid/');await page.locator('#apCreate').click();
    await page.waitForFunction(()=>(document.querySelector('#project') as HTMLSelectElement)?.value==='orion');
    await page.locator('#projectSettingsOpen').click();await page.locator('#newEnvironment').click();await page.locator('#envId').fill('staging');await page.locator('#envName').fill('Release staging');await page.locator('#envBaseUrl').fill('https://staging.synthetic.invalid/');await page.locator('#saveEnvironment').click();
    await page.waitForFunction(()=>document.querySelector('#environmentFeedback')?.textContent?.startsWith('Environment saved'));
    await page.locator('#settingsClose').click();await page.locator('#environment').selectOption('staging');
    assert.equal(await page.locator('#environment').inputValue(),'staging');
    await page.locator('#tab-cases').click();await page.locator('#search').fill('Open');await page.locator('#tab-overview').click();await page.locator('#tab-cases').click();assert.equal(await page.locator('#search').inputValue(),'Open');
    const registered = await (await fetch(url+'/api/projects')).json();assert.equal(registered.projects[0].environments.length,2);
    if(capture)await page.screenshot({path:path.join(capture,'after-workspace-desktop.png')});
    // Exercise the real review renderer with explicitly synthetic, unsaved input.
    // No recorder, generation, or runtime AI is started by this view-level check.
    const reviewDraft={scenario:'Recording visibility contract',expectedResult:'Needs confirmation',tags:'recorded',authentication:{detected:false}};
    await page.evaluate(`recording={metrics:{recordingActionCount:0,recordingAssertionCount:0,redactedValues:0,durationMs:0,aiCalls:0},actions:[],assertions:[]};recSteps=[];recAsserts=[];openReview(${JSON.stringify(reviewDraft)})`);
    assert.ok(await page.locator('#recNeedsConfirm').isVisible(),'Missing-assertion note is visible in the actual review');
    assert.equal(await page.locator('#recAuthNote').isVisible(),false,'Anonymous review does not show an authentication note');
    await page.evaluate(`recAsserts=[{type:'visible',target:'Synthetic heading'}];openReview(${JSON.stringify({...reviewDraft,authentication:{detected:true}})})`);
    assert.equal(await page.locator('#recNeedsConfirm').isVisible(),false,'An asserted review hides the confirmation note');
    assert.ok(await page.locator('#recAuthNote').isVisible(),'Detected authentication is visible in the actual review');
    await page.getByRole('button',{name:'Remove assertion 1',exact:true}).click();
    assert.ok(await page.locator('#recNeedsConfirm').isVisible(),'Removing the last assertion restores the confirmation note');
    assert.deepEqual(errors, []);
    console.log('PASS empty dashboard, sidebar keyboard toggle and report shell');
  } finally { await browser.close(); await stopFixtureProcess(child); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
