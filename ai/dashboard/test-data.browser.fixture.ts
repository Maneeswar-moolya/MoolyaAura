import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { waitForFixtureHttp, stopFixtureProcess } from '../testing/process-fixture';

async function main(){
 const app=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Profile contract</h1><label>Account<input id="account"></label><label>Passphrase<input id="passphrase" type="password"></label><label>Customer<input id="customer"></label><button>Continue</button>');});
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const appUrl=`http://127.0.0.1:${(app.address() as any).port}`;
 const probe=http.createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
 fs.writeFileSync(process.env.AURA_REGISTRY_FILE!,JSON.stringify({schemaVersion:1,applications:[]}));
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/dashboard/server.ts'],{windowsHide:true,env:{...process.env,AURA_APPLICATION:'',AURA_ENVIRONMENT:'',EXCEL_DASHBOARD_PORT:String(port)},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const base=`http://127.0.0.1:${port}`,scope={applicationId:'alpha',environmentId:'qa'};
 const request=async(route:string,body?:any)=>{try{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}catch{throw Error(`Fixture request ${route.split('?')[0]} failed; dashboard exit ${child.exitCode}: ${logs.slice(-5000)}`);}};
 const httpHostname=process.argv.includes('--http-hostname');
 const browser=await chromium.launch(httpHostname?{args:['--host-resolver-rules=MAP test-data.fixture.invalid 127.0.0.1','--no-proxy-server']}:{});
 try{
  await waitForFixtureHttp(child,base+'/api/projects',()=>logs);
  const project=await request('/api/projects',{applicationId:'alpha',displayName:'Alpha',environmentId:'qa',baseUrl:appUrl});assert.equal(project.status,201,JSON.stringify(project.body));const workbook=project.body.workbook;
  await request('/api/projects',{applicationId:'beta',displayName:'Beta',environmentId:'qa',baseUrl:appUrl});
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(workbook);const sheet=wb.getWorksheet('Test Cases')!,headers=sheet.getRow(1).values as string[];
  const set=(name:string,value:string)=>{const col=headers.findIndex(h=>String(h).toLowerCase().replace(/[^a-z0-9]/g,'')===name);if(col>0)sheet.getRow(2).getCell(col).value=value;};
  set('tcid','TC_PROFILE');set('testscenario','Profile execution');set('scenario','Profile execution');set('run','Yes');set('steps','Open page and enter configured account');set('expectedresult','Administrator sees the profile contract');await wb.xlsx.writeFile(workbook);
  fs.mkdirSync('tests-e2e/generated/alpha',{recursive:true});const spec='tests-e2e/generated/alpha/TC_PROFILE.spec.ts';
  const source=`import { baseTest as test, expect, trace, requireCredentials } from '../../support/base-fixtures';
test('TC_PROFILE - Profile execution', async ({page,step,appCredentials,executionProfile,testData}) => {
 await trace({testCaseId:'TC_PROFILE',module:'Profile',scenario:'Profile execution',sourceWorkbook:${JSON.stringify(workbook)},sourceWorksheet:'Test Cases'});
 requireCredentials(appCredentials);
 // @aura-step {"recordingStepKey":"action:1","executionMode":"RECORDED_LOCATOR","provenance":"USER_CONFIRMED"}
 await step('Enter configured account',async()=>{
  expect(await page.context().cookies()).toEqual([]);
  await page.goto(${JSON.stringify(appUrl)});
  await page.locator('#account').fill(appCredentials.email);
  await page.locator('#passphrase').fill(appCredentials.password);
  await page.locator('#customer').fill(String(testData.customerName || 'Default'));
  await expect(page.locator('#account')).toHaveValue(appCredentials.email);
  await page.context().addCookies([{name:'isolated',value:'yes',url:${JSON.stringify(appUrl)}}]);
 });
 // @aura-step {"recordingStepKey":"assertion:1"}
 await step('Role expectation',async()=>{expect(executionProfile?.role,appCredentials.email+' '+appCredentials.password).toBe('admin');});
});`;
  fs.writeFileSync(spec,source);fs.mkdirSync('ai/test-mapping',{recursive:true});fs.writeFileSync('ai/test-mapping/alpha.mapping.json',JSON.stringify({TC_PROFILE:{testFile:spec,testTitle:'TC_PROFILE - Profile execution',module:'Profile',scenario:'Profile execution',status:'Generated',sourceWorkbook:workbook,sourceWorksheet:'Test Cases'}}));
  const page=await browser.newPage(),errors:string[]=[];page.on('dialog',dialog=>dialog.accept());page.on('pageerror',error=>errors.push(error.message));await page.goto(httpHostname?`http://test-data.fixture.invalid:${port}`:base);
  if(httpHostname)assert.deepEqual(await page.evaluate(()=>({secure:isSecureContext,uuid:typeof crypto.randomUUID})),{secure:false,uuid:'undefined'},'fixture uses an actual HTTP hostname without secure-context UUID support');
  await page.locator('#project').selectOption('alpha');await page.getByRole('tab',{name:'Test Data',exact:true}).click();
  await page.getByRole('button',{name:'+ Add Credential Profile',exact:true}).click();let modal=page.getByRole('dialog');
  assert.equal(await modal.count(),1,'Add Credential Profile opens its form: '+errors.join('; '));
  for(const viewport of [{width:1280,height:720},{width:390,height:640}]){
   await page.setViewportSize(viewport);
   for(const name of ['Cancel','Save Profile']){
    const reachable=await modal.getByRole('button',{name,exact:true}).evaluate(button=>{const r=button.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
    assert.ok(reachable,`${name} stays visible and clickable without scrolling at ${viewport.width}x${viewport.height}`);
   }
  }
  await page.setViewportSize({width:1280,height:720});
  await modal.getByRole('button',{name:'Remove environment',exact:true}).click();
  assert.equal(await modal.locator('.td-dirty').innerText(),'Unsaved changes','removing an environment preserves dirty state');
  const addEnvironment=modal.getByRole('combobox',{name:'Add environment',exact:true});await addEnvironment.click();await addEnvironment.press('Enter');
  await modal.getByLabel('Username *',{exact:true}).waitFor();
  if(process.argv.includes('--modal-layout-only')){console.log('PASS credential modal: Save and Cancel remain visible at desktop and narrow viewport sizes');return;}
  await modal.getByLabel('Profile name *',{exact:true}).fill('Administrator');await modal.getByLabel('Role',{exact:true}).fill('admin');await modal.getByLabel('Tags',{exact:true}).fill('smoke admin');
  await modal.getByLabel('Username *',{exact:true}).fill('synthetic-alpha-user');const password=modal.getByLabel('Password *',{exact:true});assert.equal(await password.getAttribute('type'),'password');await password.fill('synthetic-alpha-password');
  await modal.getByRole('button',{name:'Save Profile',exact:true}).click();await modal.waitFor({state:'hidden'});
  const get=()=>request('/api/test-data?'+new URLSearchParams(scope));let catalog=(await get()).body;const credential=catalog.credentialProfiles[0];assert.ok(credential.id);assert.ok(!JSON.stringify(catalog).includes('synthetic-alpha-'));assert.ok(!fs.readFileSync('ai/test-data/alpha/test-data.json','utf8').includes('synthetic-alpha-password'));
  await page.locator('.td-card').filter({has:page.getByRole('heading',{name:'Administrator',exact:true})}).getByRole('button',{name:'Edit',exact:true}).click();modal=page.getByRole('dialog');assert.equal(await modal.getByLabel('Password configured',{exact:true}).inputValue(),'');assert.equal(await modal.getByLabel('Username configured · enter only to change').inputValue(),'');await modal.getByLabel('Profile name *',{exact:true}).fill('Administrator renamed');await modal.getByRole('button',{name:'Save Profile',exact:true}).click();await modal.waitFor({state:'hidden'});catalog=(await get()).body;assert.equal(catalog.credentialProfiles[0].id,credential.id);
  const save=async(change:any)=>{const r=await request('/api/test-data/save',{...scope,workbook,expectedVersion:catalog.version,change});assert.equal(r.status,200,JSON.stringify(r.body));catalog=r.body;return r.body;};
  await save({kind:'credential',profile:{name:'Standard',role:'standard',tags:['user'],environments:{qa:{username:'synthetic-beta-user',password:'synthetic-beta-password'}}}});const second=catalog.credentialProfiles[1];
  await page.locator('#view-test-data').getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('heading',{name:'Standard',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Data Profiles',exact:true}).click();await page.getByRole('button',{name:'+ Add Data Profile',exact:true}).click();modal=page.getByRole('dialog');await modal.getByLabel('Data profile name *').fill('Enterprise');await modal.getByRole('button',{name:'+ Add field'}).click();await modal.getByLabel('Data key').fill('customerName');await modal.getByLabel('Data value').fill('Synthetic business');await modal.getByRole('button',{name:'Save Data Profile',exact:true}).click();await modal.waitFor({state:'hidden'});catalog=(await get()).body;const data=catalog.dataProfiles[0];
  await save({kind:'examples',testCaseId:'TC_PROFILE',tags:['smoke'],rows:[credential,second].map(p=>({id:'',credentialProfileId:p.id,dataProfileId:data.id,tags:[p.id===credential.id?'admin':'user'],enabled:true,overrides:{quantity:3}}))});const savedExamples=JSON.stringify(catalog.testCases);
  await page.getByRole('button',{name:'Refresh',exact:true}).filter({visible:true} as any).first().click().catch(()=>{});
  await page.reload();await page.locator('#project').selectOption('alpha');await page.getByRole('tab',{name:'Test Data',exact:true}).click();await page.getByRole('tab',{name:'Test Case Examples',exact:true}).click();await page.locator('#view-test-data').getByLabel('Test Case ID',{exact:true}).fill('TC_PROFILE');await page.locator('#view-test-data').getByLabel('Test Case ID',{exact:true}).press('Tab');await page.getByRole('button',{name:'+ Add Example',exact:true}).click();modal=page.getByRole('dialog');const selector=modal.getByRole('combobox',{name:'Credential Profile',exact:true});await selector.fill('Administrator');await selector.press('ArrowDown');await selector.press('Enter');assert.equal(await selector.getAttribute('aria-expanded'),'false');assert.ok(!(await modal.innerText()).includes('synthetic-alpha-user'));await modal.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'+ Add Example',exact:true}).click();modal=page.getByRole('dialog');
  await modal.getByRole('combobox',{name:'Credential Profile',exact:true}).fill('Administrator renamed');
  await modal.getByRole('option').filter({hasText:'Administrator renamed'}).click();
  await modal.getByRole('button',{name:'Save Example',exact:true}).click();await modal.waitFor({state:'hidden'});
  catalog=(await get()).body;const exampleRows:Array<{id:string}>=catalog.testCases.TC_PROFILE.executionRows;
  assert.equal(exampleRows.length,3,'Add Example persists through the backend without a browser-generated UUID');
  assert.ok(exampleRows.every(r=>/^row_[a-f0-9-]{36}$/.test(r.id)));assert.equal(new Set(exampleRows.map(r=>r.id)).size,3,'backend creates distinct stable Example IDs');
  await page.locator('#view-test-data .td-card').filter({has:page.getByRole('heading',{name:'3. Administrator renamed',exact:true})}).getByRole('button',{name:'Remove',exact:true}).click();
  await page.getByRole('heading',{name:'3. Administrator renamed',exact:true}).waitFor({state:'hidden'});
  assert.equal((await request('/api/test-data?applicationId=beta&environmentId=qa')).body.credentialProfiles.length,0);
  await page.getByRole('tab',{name:'Test cases',exact:true}).click();await page.getByRole('button',{name:'Choose users & data',exact:true}).click();
  let executionDialog=page.getByRole('dialog').first();await executionDialog.getByRole('combobox',{name:'Run with users',exact:true}).click();
  await executionDialog.getByRole('option',{name:'+ Create new Credential Profile',exact:true}).click();modal=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Add Credential Profile',exact:true})});
  await modal.getByLabel('Profile name *',{exact:true}).fill('Support');await modal.getByLabel('Role',{exact:true}).fill('support');await modal.getByLabel('Username *',{exact:true}).fill('synthetic-support-user');await modal.getByLabel('Password *',{exact:true}).fill('synthetic-support-password');await modal.getByRole('button',{name:'Save Profile',exact:true}).click();await modal.waitFor({state:'hidden'});
  executionDialog=page.getByRole('dialog');await executionDialog.getByRole('button',{name:'Support ×',exact:true}).waitFor();assert.ok(!(await executionDialog.innerText()).includes('synthetic-support-user'),'execution selector never exposes usernames');await executionDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  catalog=(await get()).body;assert.equal(catalog.credentialProfiles.length,3,'new profile from execution is immediately reusable');
  if(process.env.AURA_TEST_DATA_SCREENSHOT){await page.getByRole('tab',{name:'Test Data',exact:true}).click();await page.getByRole('tab',{name:'Credential Profiles',exact:true}).click();await page.getByRole('heading',{name:'Support',exact:true}).waitFor();assert.equal(path.basename(process.env.AURA_TEST_DATA_SCREENSHOT),'test-data-ui.png');await page.screenshot({path:process.env.AURA_TEST_DATA_SCREENSHOT,fullPage:true});}
  assert.equal((await request('/api/test-data/preflight',{...scope,credentialProfileId:credential.id})).status,200,'JSON credentials work without environment variables');
  assert.equal((await request('/api/test-data/preflight',{applicationId:'beta',environmentId:'qa',credentialProfileId:credential.id})).status,400);
  const preview=await request('/api/test-data/preview',{...scope,workbook,testCaseIds:['TC_PROFILE'],selection:{mode:'examples',expectedVersion:catalog.version}});assert.equal(preview.body.count,2,JSON.stringify(preview.body));
  assert.deepEqual(errors,[],'Test Data browser has no uncaught errors');
  if(!process.argv.includes('--runtime')){console.log('PASS Test Data browser: secure create/edit, IDs, structured data, Examples reload, accessible selectors and scoped APIs');return;}
  const run=await request('/api/run',{...scope,workbook,testCaseIds:['TC_PROFILE'],environmentIds:['qa'],executionData:{mode:'selected',credentialProfileIds:catalog.credentialProfiles.map(p=>p.id),dataProfileIds:[data.id],expectedVersion:catalog.version},workers:1,inPlace:false});assert.equal(run.status,202,JSON.stringify(run.body));assert.equal(run.body.environmentRuns.length,3);
  let finished:any;for(let i=0;i<1100;i++){finished=(await request(`/api/runs/${run.body.id}?applicationId=alpha`)).body;if(finished.finishedAt)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(finished.finishedAt,'Profile execution batch must finish');const attempts=finished.environmentRuns;
  assert.equal(attempts[0].results[0]?.executionStatus,'Passed','browser instance starts with independent storage');assert.equal(attempts[1].results[0]?.executionStatus,'Failed',JSON.stringify(attempts[1]));
  assert.equal(finished.summary.passed,1);assert.equal(finished.summary.failed,2);assert.notEqual(attempts[0].id,attempts[1].id);assert.notEqual(attempts[0].executionProfile.executionRowId,attempts[1].executionProfile.executionRowId);assert.equal(new Set(attempts.map(a=>a.executionProfile.credentialProfileId)).size,3,'three users execute as distinct instances');
  const failure=attempts[1].results[0];assert.ok(failure.quarantinePackageId,JSON.stringify(attempts[1]));
  assert.equal(fs.readFileSync(spec,'utf8'),source,'Profile failure never removes or duplicates the logical spec');assert.equal(JSON.stringify((await get()).body.testCases),savedExamples,'execution selections do not rewrite Examples');
  const details=await request('/api/quarantine/details?'+new URLSearchParams({...scope,packageId:failure.quarantinePackageId}));assert.equal(details.body.executionProfile.credentialProfileId,second.id);assert.equal(details.body.state.eligible,false);
  assert.ok(!JSON.stringify(finished).includes('synthetic-alpha-user'));assert.ok(!JSON.stringify(finished).includes('synthetic-beta-password'));assert.ok(!JSON.stringify(details.body).includes('synthetic-beta-password'));
  const retainedManifest=fs.readFileSync(path.join('ai/diagnostics/artifacts/alpha',failure.diagnostics,'manifest.json'),'utf8');
  assert.ok(!retainedManifest.includes('synthetic-beta-password')&&!retainedManifest.includes('synthetic-beta-user'),'quarantine never stores decrypted credentials');
  assert.ok(details.body.runtime.steps.some(s=>s.recordingStepKey==='assertion:1'));assert.ok(details.body.runtime.artifacts.some(f=>f.endsWith('.png')),'masked runtime captures retained');
  assert.ok(attempts.every(a=>a.steps.TC_PROFILE.filter(s=>s.title==='Enter configured account').every(s=>s.status==='passed')),'browser state does not leak between profile contexts');
  const originalFile=path.join('ai/diagnostics/artifacts/alpha/quarantine',failure.quarantinePackageId,'original.json'),original=fs.readFileSync(originalFile,'utf8');
  const rerun=await request('/api/quarantine/rerun',{...scope,packageId:failure.quarantinePackageId,workbook,executionData:{mode:'selected',expectedVersion:catalog.version,credentialProfileIds:[credential.id],dataProfileIds:[data.id]}});
  assert.equal(rerun.status,200,JSON.stringify(rerun.body));assert.equal(rerun.body.result.verdict,'accepted',JSON.stringify(rerun.body));
  assert.equal(rerun.body.executionProfile.credentialProfileId,credential.id);assert.notEqual(rerun.body.runId,attempts[1].id);
  assert.equal(fs.readFileSync(originalFile,'utf8'),original,'rerun with another user never rewrites original profile metadata');
  const afterRerun=(await request('/api/quarantine/details?'+new URLSearchParams({...scope,packageId:failure.quarantinePackageId}))).body;
  assert.equal(afterRerun.state.eligible,true);assert.equal(Boolean(afterRerun.state.promoted),false,'profile rerun never automatically promotes');assert.equal(afterRerun.state.runs.length,1);
  console.log('PASS profile runtime: one spec, three isolated users, independent pass/quarantine, safe diagnostics, preserved Examples and unchanged spec');
 }finally{await browser.close();await stopFixtureProcess(child);await new Promise<void>(r=>app.close(()=>r()));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
