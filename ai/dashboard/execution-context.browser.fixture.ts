import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { workspaceData } from '../testing/workspace-data';
import { recordingSource } from '../testing/synthetic-data';
import { parseRecording, toDraft, persistRecording } from './recorder';
import { recordingMappingReview, saveRecordingMapping, draftOwnersFile } from './recording-mapping';
import { resolveScope, resetActiveScope } from '../projects/scope';
import { readTestData, updateTestData } from '../test-data/store';
import { waitForFixtureHttp, stopFixtureProcess } from '../testing/process-fixture';
let appServer:http.Server|undefined;

async function main(){
  const {scope}=workspaceData(),id='TC_CONTEXT';
  fs.writeFileSync(scope.paths.fixturesFile,fs.readFileSync(scope.paths.fixturesFile,'utf8').replace('interface Fixtures {','interface Fixtures {\n  step: import("./support/base-fixtures").StepFn;'));
  const visits:string[]=[];
  const app=appServer=http.createServer((req,res)=>{visits.push(req.url!);res.setHeader('content-type','text/html');res.end('<html><title>Context contract</title><button data-testid="continue" onclick="this.textContent=\'Saved\'">Continue</button></html>');});
  await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(app.address() as any).port}`;
  const registry=JSON.parse(fs.readFileSync(process.env.AURA_REGISTRY_FILE!,'utf8'));
  registry.applications[0].environments={qa:{baseUrl:origin+'/source/'},target:{baseUrl:origin+'/target/'}};
  fs.writeFileSync(process.env.AURA_REGISTRY_FILE!,JSON.stringify(registry));resetActiveScope();
  const source=recordingSource([`await page.goto('${origin}/source/');`,`await page.getByTestId('continue').click();`,`await expect(page).toHaveTitle('Context contract');`]);
  const evidence:any={available:false,reason:'Synthetic explicit authoring, no automatic target proof'};
  const recording=parseRecording(source,{startUrl:origin+'/source/',browser:'chromium',durationMs:0,evidence}),draft={source,recording};
  for(const stepKey of ['action:1']){
    const review=recordingMappingReview(scope,draft);
    saveRecordingMapping(scope,draft,{applicationId:'north',revision:review.revision,mappingVersion:review.mappingVersion,stepKey,executionMode:'RECORDED_LOCATOR'});
  }
  persistRecording(id,source,evidence,undefined,{applicationId:'north',environmentId:'qa',baseUrl:origin+'/source/'});
  fs.copyFileSync(draftOwnersFile(scope,source),path.join(scope.paths.recordingsDir,id+'.owners.json'));
  const suggestion=toDraft(recording),wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Cases');
  sheet.addRows([['Test Case ID','Scenario','Module','Steps','Expected Result','Run','Tags','Test Data'],[id,suggestion.scenario,'Context',suggestion.steps,suggestion.expectedResult,'Yes',suggestion.tags,suggestion.testData]]);
  await wb.xlsx.writeFile('excel/north.xlsx');
  const targetScope=resolveScope({applicationId:'north',environmentId:'target'});
  let catalog=readTestData(targetScope);
  for(const name of ['First user','Second user'])catalog=updateTestData(targetScope,catalog.version,{kind:'credential',profile:{name,environments:{target:{username:'synthetic@example.invalid',password:'synthetic-profile-password'}}}});
  const probe=http.createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/dashboard/server.ts'],{env:{...process.env,EXCEL_DASHBOARD_PORT:String(port),AURA_APPLICATION:'',AURA_ENVIRONMENT:'',AURA_SOURCE_ENVIRONMENT:'foreign-only',AURA_EXECUTION_CONTEXT:'',AURA_EXECUTION_SELECTION:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
  const base=`http://127.0.0.1:${port}`,request=async(route:string,body?:unknown)=>{const response=await fetch(base+route,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    await waitForFixtureHttp(child,base+'/api/health',()=>logs);
    const invalid=await request('/api/autocode',{applicationId:'north',environmentId:'target',workbook:'excel/north.xlsx',testCaseIds:[id],sourceEnvironmentId:''});
    assert.equal(invalid.status,400,JSON.stringify(invalid));assert.equal(invalid.body.code,'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE');assert.equal(visits.length,0);
    console.log('PASS HTTP generation preflight refuses missing source with no browser action');
    browser=await chromium.launch();const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
    await page.locator('#project').selectOption('north');await page.waitForFunction(()=>document.querySelector('#workbook')?.textContent?.includes('north'));
    assert.equal(await page.locator('#environment').inputValue(),'','multiple source choices never arbitrarily select');
    await page.locator('#environment').selectOption('qa');
    await page.locator('#tab-cases').click();
    for(const check of await page.locator('#executionTargets input').all())await check.setChecked(await check.inputValue()==='target');
    await page.locator('#headed').check();
    let sent:any;page.on('request',req=>{if(req.url()===base+'/api/autocode'&&req.method()==='POST')sent=req.postDataJSON();});
    // Invoke the real handler behind the existing Regenerate button; transport is not mocked.
    const responsePromise=page.waitForResponse(response=>response.url()===base+'/api/autocode'&&response.request().method()==='POST');
    await page.evaluate((testCaseId:string)=>(window as any).startGenerationFor(testCaseId),id);
    const generated=await (await responsePromise).json();assert.equal(generated.started,true,JSON.stringify(generated));
    assert.equal(sent.sourceEnvironmentId,'qa');assert.equal(sent.environmentId,'target');assert.equal(sent.headed,true);
    assert.equal(generated.executionContext.sourceEnvironmentId,'qa');assert.equal(generated.executionContext.headed,true);
    for(let attempt=0;attempt<1500;attempt++){if(!(await request('/api/autocode')).body.running)break;await new Promise(resolve=>setTimeout(resolve,100));}
    const state=JSON.parse(fs.readFileSync('ai/autocode/state.json','utf8'));const entry=state['north::'+id]??Object.values(state).find((entry:any)=>entry.testCaseId===id)??Object.entries(state).find(([key])=>key.includes(id))?.[1];
    assert.equal((entry as any)?.verdict,'accepted',JSON.stringify({state,logs}));
    const manifests=fs.readdirSync('ai/diagnostics/artifacts/north/runs').map(folder=>JSON.parse(fs.readFileSync(`ai/diagnostics/artifacts/north/runs/${folder}/manifest.json`,'utf8'))).filter(manifest=>manifest.testCaseId===id);
    assert.equal(manifests.length,2);assert.deepEqual(new Set(manifests.map(item=>item.kind)),new Set(['clean','mutation']));
    for(const manifest of manifests){assert.equal(manifest.executionContext.sourceEnvironmentId,'qa');assert.equal(manifest.executionContext.environmentId,'target');assert.equal(manifest.executionContext.headed,true);assert.equal(manifest.executionContext.locatorTimeoutMs,40000);}
    assert.ok(visits.some(url=>url==='/target/'));assert.ok(!visits.some(url=>url==='/source/'));
    console.log('PASS UI → HTTP → autocode CLI → grouping/orchestration → gate → clean/mutation Playwright children, source URL rebasing and headed mode');
    const executionData={mode:'selected',credentialProfileIds:catalog.credentialProfiles.map(item=>item.id),expectedVersion:catalog.version};
    const run=await request('/api/run',{...sent,executionData,environmentIds:['target'],workers:1,inPlace:false,browser:'chromium',screenshot:'off',video:'off',trace:'off'});
    assert.equal(run.status,202,JSON.stringify(run));let finished:any;
    for(let attempt=0;attempt<1200;attempt++){finished=(await request(`/api/runs/${run.body.id}?applicationId=north`)).body;if(finished.finishedAt)break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.ok(finished.finishedAt);assert.equal(finished.environmentRuns.length,2);
    for(const row of finished.environmentRuns){assert.equal(row.results[0]?.executionStatus,'Passed',JSON.stringify(row));assert.equal(row.executionContext.sourceEnvironmentId,'qa');assert.equal(row.executionContext.environmentId,'target');assert.equal(row.executionContext.headed,true);assert.ok(row.executionContext.credentialProfileId);}
    assert.notEqual(finished.environmentRuns[0].executionContext.credentialProfileId,finished.environmentRuns[1].executionContext.credentialProfileId);
    assert.deepEqual(errors,[]);
    console.log('PASS manual generated-case execution and two JSON profiles retain source/target/browser context in separate execution instances');
  } finally {await browser?.close();await stopFixtureProcess(child);await new Promise<void>(resolve=>app.close(()=>resolve()));}
}
main().catch(error=>{appServer?.close();console.error(error);process.exitCode=1;});
