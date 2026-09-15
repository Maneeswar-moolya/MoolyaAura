import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import ExcelJS from 'exceljs';
import { workspaceData } from '../testing/workspace-data';
import { waitForFixtureHttp, stopFixtureProcess } from '../testing/process-fixture';
import { resetActiveScope } from '../projects/scope';

/**
 * SAVING A TEST CASE MUST NOT DEPEND ON THE GENERATOR AGREEING TO START.
 *
 * The workbook write is the transaction. Everything after it - rebuilding derived state,
 * starting the generator - is a separate decision that may legitimately be refused. When
 * that refusal escaped as an error status the page reported the save as failed and returned
 * before its own refresh, so a committed row stayed invisible until a manual browser reload;
 * pressing Save again then appended a SECOND row while the pending recording had already
 * been consumed by the first. That is the shape this fixture pins.
 */
async function main(){
  const {scope}=workspaceData();
  // Two environments and no default source: the state in which the generator must refuse.
  const registryFile=process.env.AURA_REGISTRY_FILE!;
  const registry=JSON.parse(fs.readFileSync(registryFile,'utf8'));
  registry.applications[0].environments.second={baseUrl:'https://second.example.invalid/'};
  delete registry.applications[0].defaultSourceEnvironmentId;
  fs.writeFileSync(registryFile,JSON.stringify(registry));resetActiveScope();

  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Cases');
  sheet.addRows([['Test Case ID','Scenario','Module','Steps','Expected Result','Run'],
    ['TC_EXIST','Existing case','Authoring','Open the page','Something is visible','Yes']]);
  await workbook.xlsx.writeFile('excel/north.xlsx');

  const probe=http.createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));
  const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/dashboard/server.ts'],
    {env:{...process.env,EXCEL_DASHBOARD_PORT:String(port),AURA_APPLICATION:'',AURA_ENVIRONMENT:'',
      AURA_EXECUTION_CONTEXT:'',AURA_EXECUTION_SELECTION:'',AURA_SOURCE_ENVIRONMENT:''},
     stdio:['ignore','pipe','pipe'],windowsHide:true});
  let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
  const base=`http://127.0.0.1:${port}`;
  const post=async(route:string,body:unknown)=>{const r=await fetch(base+route,{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const get=async(route:string)=>{const r=await fetch(base+route);return {status:r.status,body:await r.json()};};
  const scopeQuery='applicationId=north&environmentId=qa';
  const listIds=async()=>(await get(`/api/workbook?workbook=excel%2Fnorth.xlsx&${scopeQuery}`)).body.cases.map((c:any)=>c.testCaseId);
  let checks=0;const check=(name:string,run:()=>void)=>{try{run();}catch(e:any){throw new Error(`FAIL ${name}: ${e?.message??e}`);}checks++;console.log('PASS '+name);};

  try{
    await waitForFixtureHttp(child,base+'/api/health',()=>logs);
    const before=await listIds();

    // The save the user makes: a new case, with NO source environment selected.
    const draft={worksheet:'Cases',scenario:'Newly saved case',module:'Authoring',
      steps:'Open the page',expectedResult:'Something is visible',assertOutcome:'',assertMessage:'',
      priority:'',tags:'',run:true};
    const saved=await post('/api/case',{applicationId:'north',environmentId:'qa',sourceEnvironmentId:'',
      workbook:'excel/north.xlsx',draft,isNew:true});

    check('a committed save is reported as success even when the generator refuses',()=>{
      assert.equal(saved.status,200,JSON.stringify(saved.body));
      assert.ok(saved.body.testCaseId,'the response names the ID that was written');
      assert.ok(saved.body.row,'the response names the row');
    });
    check('the refusal is reported as data, with its reason and code',()=>{
      assert.equal(saved.body.autocode.started,false);
      assert.match(String(saved.body.autocode.reason),/SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE|Source Environment/i);
      assert.equal(saved.body.autocode.code,'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE');
    });

    const savedId=saved.body.testCaseId as string;
    const after=await listIds();
    check('the new case is in the catalog the page reloads after saving',()=>{
      assert.ok(after.includes(savedId),`${savedId} missing from ${JSON.stringify(after)}`);
      assert.equal(after.length,before.length+1,'exactly one row was added');
    });

    // The ghost-row shape: with the save correctly reported, nothing about a refused
    // generator can make the row disappear, so there is no failure to retry.
    const secondLook=await listIds();
    check('the committed row is stable across repeated catalog reads',()=>{
      assert.deepEqual(secondLook,after,'the catalog does not change between reads');
    });

    // Another application cannot see it.
    const foreign=await get(`/api/workbook?workbook=excel%2Fnorth.xlsx&applicationId=south&environmentId=qa`);
    check('a foreign application cannot list this workbook',()=>assert.equal(foreign.status,400));

    // With a source environment supplied, the same save path starts the generator.
    const withSource=await post('/api/case',{applicationId:'north',environmentId:'qa',sourceEnvironmentId:'qa',
      workbook:'excel/north.xlsx',draft:{...draft,scenario:'Second saved case'},isNew:true});
    check('supplying a source environment lets the same save path start the generator',()=>{
      assert.equal(withSource.status,200,JSON.stringify(withSource.body));
      assert.notEqual(withSource.body.autocode.code,'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE');
    });
    check('every saved case keeps one canonical id across response and catalog',()=>{
      assert.ok(withSource.body.testCaseId&&withSource.body.testCaseId!==savedId,'a second case gets its own id');
    });
    const ids=await listIds();
    check('both saved cases are present exactly once',()=>{
      for(const id of [savedId,withSource.body.testCaseId])
        assert.equal(ids.filter((x:string)=>x===id).length,1,`${id} appears once`);
    });
    console.log(`${checks} case lifecycle synchronisation contracts passed`);
  } finally { await stopFixtureProcess(child); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
