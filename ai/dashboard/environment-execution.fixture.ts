import '../testing/isolated-checkout';
import { waitForFixtureHttp, stopFixtureProcess } from '../testing/process-fixture';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

async function main() {
  assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const app = http.createServer((req,res) => { res.setHeader('content-type','text/html'); res.end(`<html><title>Environment contract</title><body style="background:${req.url?.startsWith('/qa/')?'#d7f1ed':'#e1e8ff'}"><h1>${req.url?.startsWith('/qa/')?'QA':'Staging'}</h1><button onclick="this.textContent='Saved'">Save</button></body></html>`); });
  await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));
  const appUrl = `http://127.0.0.1:${(app.address() as any).port}`;
  const probe=http.createServer(); await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r)); const port=(probe.address() as any).port; await new Promise<void>(r=>probe.close(()=>r()));
  fs.writeFileSync(process.env.AURA_REGISTRY_FILE!,JSON.stringify({schemaVersion:1,applications:[]}));
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/dashboard/server.ts'],{cwd:process.cwd(),env:{...process.env,AURA_APPLICATION:'',AURA_ENVIRONMENT:'',EXCEL_DASHBOARD_PORT:String(port),ALPHA_QA_EMAIL:'qa@example.invalid',ALPHA_QA_PASSWORD:'synthetic-qa-secret',ALPHA_STAGING_EMAIL:'stage@example.invalid',ALPHA_STAGING_PASSWORD:'synthetic-stage-secret'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  const base=`http://127.0.0.1:${port}`;
  const request=async(route:string,method='GET',body?:unknown)=>{const r=await fetch(base+route,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  try {
    await waitForFixtureHttp(child, base + '/api/health', () => logs);
    const created=await request('/api/projects','POST',{applicationId:'alpha',displayName:'Northstar QA',environmentId:'qa',baseUrl:appUrl+'/qa/'});assert.equal(created.status,201);
    const updated=await request('/api/projects/alpha/environments/qa','PUT',{applicationId:'alpha',displayName:'Quality assurance',baseUrl:appUrl+'/qa/',credentials:{email:'ALPHA_QA_EMAIL',password:'ALPHA_QA_PASSWORD'}});
    assert.equal(updated.status,200,'Environment editing must be implemented');
    assert.equal((await request('/api/projects/alpha/environments','POST',{applicationId:'alpha',environmentId:'staging',displayName:'Staging',baseUrl:appUrl+'/staging/',credentials:{email:'ALPHA_STAGING_EMAIL',password:'ALPHA_STAGING_PASSWORD'}})).status,201);
    assert.equal((await request('/api/projects/alpha/environments/qa','PUT',{applicationId:'beta',displayName:'Foreign',baseUrl:appUrl+'/qa/'})).status,400);
    const invalid=await request('/api/projects/alpha/environments/qa','PUT',{applicationId:'alpha',displayName:'Invalid',baseUrl:appUrl+'/qa/',credentials:{email:'credential-value@example.invalid',password:'secret-value'}});assert.equal(invalid.status,400);assert.ok(!JSON.stringify(invalid.body).includes('secret-value'));
    const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(created.body.workbook);const sheet=wb.getWorksheet('Test Cases')!;const headers=sheet.getRow(1).values as string[];
    const set=(name:string,value:string)=>{const col=headers.findIndex(h=>String(h).toLowerCase().replace(/[^a-z]/g,'')===name);assert.ok(col>0,'Header '+name);sheet.getRow(2).getCell(col).value=value;};
    set('tcid','TC_SHARED');set('run','Yes');await wb.xlsx.writeFile(created.body.workbook);
    const spec='tests-e2e/generated/alpha/TC_SHARED.spec.ts';fs.mkdirSync(path.dirname(spec),{recursive:true});
    fs.writeFileSync(spec,`import { baseTest as test, expect } from '../../support/base-fixtures';\ntest.describe.configure({ retries: 1 });\ntest('TC_SHARED - environment contract', async ({page,step,appCredentials},info)=>{\n await step('Open application',async()=>{await page.goto(${JSON.stringify(appUrl+'/qa/')});await expect(page.locator('h1')).toHaveText(process.env.AURA_ENVIRONMENT==='qa'?'QA':'Staging');});\n await step('Check account binding',async()=>{expect(appCredentials?.email).toBe(process.env.AURA_ENVIRONMENT==='qa'?'qa@example.invalid':'stage@example.invalid');});\n await step('Save changes',async()=>{await page.getByRole('button').click();if(info.retry===0)throw Error('Synthetic first-attempt failure');await expect(page.getByRole('button')).toHaveText('Saved');});\n});`);
    fs.mkdirSync('ai/test-mapping',{recursive:true});fs.writeFileSync('ai/test-mapping/alpha.mapping.json',JSON.stringify({TC_SHARED:{testFile:spec,testName:'TC_SHARED - environment contract',module:'Smoke',scenario:'Environment contract',status:'Automated',sourceWorkbook:created.body.workbook,sourceWorksheet:'Test Cases',sourceRow:2}}));
    const beta=await request('/api/projects','POST',{applicationId:'beta',displayName:'Independent project',environmentId:'qa',baseUrl:appUrl+'/beta/'});assert.equal(beta.status,201);
    fs.mkdirSync('tests-e2e/generated/beta',{recursive:true});fs.writeFileSync('tests-e2e/generated/beta/TC_SHARED.spec.ts',"import { test } from '@playwright/test'; test('TC_SHARED - foreign project',()=>{throw Error('Foreign case executed');});");
    assert.equal((await request('/api/projects/alpha/environments','POST',{applicationId:'alpha',environmentId:'missing',displayName:'Needs credentials',baseUrl:appUrl+'/missing/',credentials:{email:'ALPHA_MISSING_EMAIL',password:'ALPHA_MISSING_PASSWORD'}})).status,201);
    const workbookView=await request('/api/workbook?workbook='+encodeURIComponent(created.body.workbook)+'&applicationId=alpha&environmentId=qa');
    assert.equal(workbookView.status,200,'Scoped workbook API must load: '+JSON.stringify(workbookView.body));assert.equal(workbookView.body.cases.length,1);
    const draft=(await request('/api/case?workbook='+encodeURIComponent(created.body.workbook)+'&id=TC_SHARED&applicationId=alpha')).body;
    const saved=await request('/api/case','POST',{applicationId:'alpha',environmentId:'qa',workbook:created.body.workbook,draft,isNew:false});
    assert.equal(saved.status,200,'Scoped authoring must activate without ambient project: '+JSON.stringify(saved.body));
    assert.equal(saved.body.autocode?.started,false,'Existing synthetic automation must not invoke runtime AI');
    if(process.argv.includes('--workbook-only')) {
      const browser=await chromium.launch();try {const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('#project').selectOption('alpha');
      try {await page.waitForFunction(()=>document.querySelector('#envCases')?.textContent==='1');}catch(e){console.log('WORKBOOK UI DIAGNOSTIC',JSON.stringify({errors,counter:await page.locator('#envCases').textContent(),body:(await page.locator('body').innerText()).slice(-2000)}));throw e;}
      console.log('PASS scoped workbook API and actual UI case loading');}finally{await browser.close();}return;
    }
    const body={applicationId:'alpha',environmentId:'qa',sourceEnvironmentId:'qa',environmentIds:['qa','staging'],workbook:created.body.workbook,testCaseIds:['TC_SHARED'],screenshot:'on',workers:1};
    assert.equal((await request('/api/run','POST',{...body,environmentIds:['qa','foreign']})).status,400);
    assert.equal((await request('/api/run','POST',{...body,environmentIds:['qa','missing']})).status,400);
    assert.equal((await request('/api/runs?applicationId=alpha')).body.runs.length,0,'Configuration refusal starts no partial run');
    const run=await request('/api/run','POST',body);assert.equal(run.status,202,JSON.stringify(run.body));assert.equal(run.body.environmentRuns.length,2);assert.equal(run.body.environmentRuns[1].status,'queued');
    assert.equal((await request('/api/projects/alpha/environments/staging','PUT',{applicationId:'alpha',displayName:'Changed mid-run',baseUrl:appUrl+'/wrong/'})).status,409);
    assert.equal((await request('/api/record/start','POST',body)).status,409,'Recording cannot overlap execution');
    const generation = await request('/api/autocode','POST',{...body,ids:['TC_SHARED']});
    assert.equal(generation.body.started,false,'Generation cannot overlap execution');
    assert.equal((await request('/api/stop?applicationId=beta','POST')).status,404,'Foreign project cannot stop execution');
    assert.equal((await request('/api/runs?applicationId=beta')).body.active,null,'Foreign project does not inherit live execution status');
    let finished:any;
    for(let i=0;i<900;i++){finished=await request(`/api/runs/${run.body.id}?applicationId=alpha`);if(finished.body.finishedAt)break;await new Promise(r=>setTimeout(r,100));}
    assert.ok(finished.body.finishedAt,'Execution completed');
    assert.equal(finished.body.environmentRuns.length,2);
    const artifacts=new Set<string>();
    for(const env of finished.body.environmentRuns){assert.equal(env.results.length,1,'Foreign identical case ID is not collected');assert.equal(env.results[0]?.executionStatus,'Passed','Target environment execution must pass: '+JSON.stringify({env:env.environmentId,note:env.note,results:env.results}));assert.equal(env.applicationId,'alpha');assert.ok(env.results[0].flaky);const steps=env.steps.TC_SHARED;assert.equal(steps.length,6,'Both attempts retain their own step evidence');assert.equal(new Set(steps.map((s:any)=>s.attemptId)).size,2);for(const step of steps){assert.equal(step.environmentId,env.environmentId);assert.equal(step.runId,env.id);assert.ok(step.stepId);assert.ok(step.screenshotUrl);assert.ok(!artifacts.has(step.screenshotUrl));artifacts.add(step.screenshotUrl);assert.ok((await fetch(base+step.screenshotUrl+'?applicationId=alpha&environmentId='+env.environmentId)).ok);assert.equal((await fetch(base+step.screenshotUrl+'?applicationId=beta')).status,404,'Foreign project artifact refused');assert.equal((await fetch(base+step.screenshotUrl+'?applicationId=alpha&environmentId=foreign')).status,404);}}
    assert.equal((await request(`/api/runs/${run.body.id}?applicationId=beta`)).status,404);
    assert.ok(!JSON.stringify(finished.body).includes('synthetic-qa-secret'));
    assert.equal((await fetch(base+'/evidence/results.json?applicationId=beta')).status,404,'Scratch artifacts are not a public bypass');
    const childRun=finished.body.environmentRuns[0];
    assert.equal((await fetch(base+`/api/projects/beta/runs/${childRun.id}/report/`)).status,404);
    const redirect=await fetch(base+`/api/projects/alpha/runs/${childRun.id}/report`,{redirect:'manual'});
    assert.equal(redirect.status,302);assert.match(redirect.headers.get('location')!,/^\/api\/projects\/alpha\/runs\//);
    assert.equal((await fetch(base+redirect.headers.get('location'))).status,200);
    console.log('PASS real serialized two-environment execution, URL/credential binding, retry/step artifacts, ownership and secret-ref validation');
    if(process.argv.includes('--contract-only')) return;
    const browser = await chromium.launch({headless:true});
    try {
      const page = await browser.newPage({viewport:{width:1440,height:1100}});
      const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);
      await page.locator('#project').selectOption('alpha');
      await page.waitForFunction(()=>document.querySelector('#envCases')?.textContent==='1');
      await page.locator('#projectSettingsOpen').click();
      await page.locator('#settingsEnvironments button').filter({hasText:'Staging'}).click();
      await page.locator('#envName').fill('Release staging');
      await page.locator('#saveEnvironment').click();
      await page.waitForFunction(()=>document.querySelector('#environmentFeedback')?.textContent?.startsWith('Environment saved'));
      await page.locator('#settingsClose').press('Escape');
      assert.equal(await page.locator('#projectSettings').isVisible(),false);
      assert.equal(await page.locator('#projectSettingsOpen').evaluate(e=>e===document.activeElement),true);
      await page.locator('#tab-cases').click();
      await page.locator('#executionTargets input[value=qa]').check();
      await page.locator('#executionTargets input[value=staging]').check();
      assert.equal(await page.locator('#workers').inputValue(),'1');
      assert.ok(await page.locator('#inPlace').isDisabled());
      await page.locator('#tab-executions').click();
      await page.locator('#reportRun').selectOption(run.body.id);
      await page.locator('#evidenceCanvas img').waitFor({state:'visible'});
      assert.equal(await page.locator('.step-choice').count(),3);
      assert.ok(await page.locator('#reportLink').isVisible(),'Native Playwright report remains available for the selected environment');
      assert.ok((await page.locator('#reportLink').getAttribute('href'))?.includes(finished.body.environmentRuns[0].id));
      const imageDigest=async()=>page.locator('#evidenceCanvas img').evaluate(async (img:any)=>{const data=new Uint8Array(await(await fetch(img.src)).arrayBuffer());const hash=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');});
      const expectedDigest=(env:any,step:any)=>createHash('sha256').update(fs.readFileSync(path.join('ai/dashboard/runs',env.id,'evidence',step.screenshotUrl.split('/evidence/')[1]))).digest('hex');
      const qa=finished.body.environmentRuns[0],staging=finished.body.environmentRuns[1];
      assert.equal(await imageDigest(),expectedDigest(qa,qa.steps.TC_SHARED[0]));
      await page.locator('#reportEnvironment').selectOption('1');
      await page.locator('#evidenceCanvas img').waitFor({state:'visible'});
      assert.equal(await imageDigest(),expectedDigest(staging,staging.steps.TC_SHARED[0]));
      assert.ok((await page.locator('#reportLink').getAttribute('href'))?.includes(staging.id));
      const attempts=await page.locator('#reportAttempt option').evaluateAll(nodes=>nodes.map((n:any)=>n.value));
      await page.locator('#reportAttempt').selectOption(attempts[1]);
      await page.locator('#evidenceCanvas img').waitFor({state:'visible'});
      assert.equal(await imageDigest(),expectedDigest(staging,staging.steps.TC_SHARED[3]));
      await page.locator('.step-choice').nth(2).click();
      await page.locator('#evidenceCanvas img').waitFor({state:'visible'});
      assert.equal(await imageDigest(),expectedDigest(staging,staging.steps.TC_SHARED[5]));
      await page.locator('#evidenceFullscreen').click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));await page.locator('#fullscreenExit').click();await page.waitForFunction(()=>!document.fullscreenElement);
      await page.locator('#evidenceZoomIn').click();assert.ok(!(await page.locator('#evidenceCanvas').getAttribute('class'))?.includes('fit'));
      await page.locator('#evidenceFit').click();assert.ok((await page.locator('#evidenceCanvas').getAttribute('class'))?.includes('fit'));
      await page.locator('#reportDivider').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#reportDivider').getAttribute('aria-valuenow'),'36');
      // Hold one real screenshot response, switch to another, then release the old one.
      let release:()=>void=()=>{}; const held=new Promise<void>(r=>release=r);let seen:()=>void=()=>{};const requested=new Promise<void>(r=>seen=r);
      const slow=staging.steps.TC_SHARED[3].screenshotUrl;
      await page.route('**'+slow+'?*',async route=>{seen();await held;await route.continue().catch(()=>{});});
      await page.locator('.step-choice').nth(0).click();await requested;
      assert.equal(await page.locator('#evidenceCanvas img').count(),0,'Old evidence clears immediately');
      await page.locator('.step-choice').nth(1).click();await page.locator('#evidenceCanvas img').waitFor({state:'visible'});
      const latest=await imageDigest();release();await page.unroute('**'+slow+'?*');await page.waitForLoadState('networkidle');
      await page.waitForFunction(()=>document.querySelector('#stepPosition')?.textContent==='Step 2 of 3');
      assert.equal(await imageDigest(),latest,'An older response cannot replace the selected screenshot');
      // Missing evidence is an actual unavailable retained file, not a fabricated historical image.
      const missing=staging.steps.TC_SHARED[5];const missingFile=path.resolve('ai/dashboard/runs',staging.id,'evidence',missing.screenshotUrl.split('/evidence/')[1]);const relative=path.relative(process.cwd(),missingFile);assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative),'Independent file deletion guard');fs.unlinkSync(missingFile);
      await page.locator('.step-choice').nth(2).click();await page.waitForFunction(()=>document.querySelector('#evidenceMessage')?.textContent==='Screenshot unavailable');
      assert.equal(await page.locator('#evidenceCanvas img').count(),0);
      await page.locator('#reportAttempt').selectOption(attempts[0]);
      await page.locator('.step-choice').nth(2).click();await page.locator('.step-error summary').click();
      assert.match(await page.locator('.step-error pre').innerText(),/Synthetic first-attempt failure/);
      await page.locator('#evidenceCanvas img').waitFor({state:'visible'});
      if(process.env.AURA_UI_CAPTURE_DIR){fs.mkdirSync(process.env.AURA_UI_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AURA_UI_CAPTURE_DIR,'after-report-desktop.png'),fullPage:false});}
      await page.setViewportSize({width:390,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No horizontal page overflow on mobile');
      assert.equal(await page.locator('#reportDivider').isVisible(),false);
      if(process.env.AURA_UI_CAPTURE_DIR)await page.locator('#reportInspector').screenshot({path:path.join(process.env.AURA_UI_CAPTURE_DIR,'after-report-mobile.png')});
      // A second real run with capture disabled proves the no-screenshot state,
      // and changing run clears the previous environment/attempt evidence.
      await page.setViewportSize({width:1440,height:1100});await page.locator('#tab-cases').click();
      await page.locator('#executionTargets input[value=staging]').uncheck();
      await page.locator('#selMaster').check();await page.locator('#screenshot').selectOption('off');
      await page.locator('#video').selectOption('off');await page.locator('#trace').selectOption('off');
      const runResponse = page.waitForResponse(response=>response.url().endsWith('/api/run') && response.request().method()==='POST');
      await page.locator('#run').click();const uiResponse=await runResponse;
      const noCapture = {status:uiResponse.status(),body:await uiResponse.json()};assert.equal(noCapture.status,202);
      assert.equal(noCapture.body.environmentRuns.length,1);
      let noCaptureResult:any;
      for(let i=0;i<900;i++) {noCaptureResult=(await request(`/api/runs/${noCapture.body.id}?applicationId=alpha`)).body;if(noCaptureResult.finishedAt)break;await new Promise(r=>setTimeout(r,100));}
      assert.ok(noCaptureResult.finishedAt);
      assert.ok(noCaptureResult.environmentRuns[0].steps.TC_SHARED.every((step:any)=>!step.screenshotUrl));
      await page.setViewportSize({width:1440,height:1100});await page.reload();
      await page.locator('#tab-executions').click();await page.locator('#reportRun').selectOption(noCapture.body.id);
      await page.waitForFunction(()=>document.querySelector('#evidenceMessage')?.textContent==='No screenshot captured');
      assert.equal(await page.locator('#evidenceCanvas img').count(),0);
      await page.locator('#project').selectOption('beta');
      await page.waitForFunction(()=>document.querySelector('#navRuns')?.textContent==='0');
      assert.equal(await page.locator('#evidenceCanvas img').count(),0);
      assert.equal(await page.locator('.step-choice').count(),0);
      assert.equal(await page.locator('#reportRun option').count(),1,'Foreign project cannot retain prior execution choices');
      assert.ok(!(await page.locator('#runRows').innerText()).includes(noCapture.body.id));
      assert.deepEqual(errors,[]);
      console.log('PASS actual inspector screenshot hashes across environment/attempt/step, rapid switching, missing files, failure details, settings, keyboard and responsive layout');
    } finally {await browser.close();}

  } finally {await stopFixtureProcess(child);await new Promise<void>(r=>app.close(()=>r()));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
