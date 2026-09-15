import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { workspaceData } from '../testing/workspace-data';
import { reviewBrowserChecks, executionChoiceChecks } from '../testing/review-browser-checks';
async function main() {
  const {scope,recording,source}=workspaceData();
  for(const app of ['north','south']) {
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Cases');
    sheet.addRows([['Test Case ID','Scenario','Module','Steps','Expected Result','Run'],['TC_EDIT','Continues to the next screen','Authoring','Click Continue','Continue is visible','Yes']]);
    fs.mkdirSync('excel',{recursive:true});await workbook.xlsx.writeFile(`excel/${app}.xlsx`);
  }
  const probe=http.createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/dashboard/server.ts'],{env:{...process.env,EXCEL_DASHBOARD_PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  const base=`http://127.0.0.1:${port}`,browser=await chromium.launch({headless:true});
  try {
    for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100));}
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.waitForFunction(()=>typeof (window as any).authoringCode==='object');
    await page.locator('#project').selectOption('north');
    await page.waitForFunction(()=>document.querySelector('#caseRows')?.textContent?.includes('TC_EDIT'));
    await page.locator('#tab-code').click();await page.locator('#codeCase').selectOption('TC_EDIT');
    await page.waitForFunction(()=>document.querySelector('#codeFilename')?.textContent?.endsWith('TC_EDIT.spec.ts'));
    assert.ok(await page.locator('#codeFiles button').filter({hasText:'FirstPage.ts'}).count());
    assert.equal(await page.locator('#codeFiles button').filter({hasText:'SparePage.ts'}).count(),0);
    await page.locator('#codeSource .aw-symbol').filter({hasText:/^control$/}).click();
    await page.waitForFunction(()=>document.querySelector('#codeFilename')?.textContent?.endsWith('FirstPage.ts'));
    assert.ok(await page.locator('#codeSource .aw-line.selected').innerText().then(text=>text.includes('control')));
    await page.locator('#codeBack').click();await page.waitForFunction(()=>document.querySelector('#codeFilename')?.textContent?.endsWith('TC_EDIT.spec.ts'));
    assert.match(await page.locator('#codeSource .aw-line.selected').innerText(), /control\(\)/, 'Back restores the source call location');
    await page.locator('#codeForward').click();await page.waitForFunction(()=>document.querySelector('#codeFilename')?.textContent?.endsWith('FirstPage.ts'));
    await page.locator('#codeSource .aw-symbol').filter({hasText:/^resolve$/}).click();await page.waitForFunction(()=>document.querySelector('#codeFilename')?.textContent==='tests-e2e/pages/base.page.ts');
    assert.equal(await page.locator('#codeEdit').isDisabled(),true);
    await page.locator('#codeFiles button').filter({hasText:'TC_EDIT.spec.ts'}).first().click();await page.waitForFunction(()=>document.querySelector('#codeFilename')?.textContent?.includes('generated'));
    await page.locator('#codeEdit').click();const original=await page.locator('#codeEditor').inputValue();
    await page.locator('#codeEditor').fill(original+'\nconst broken: = ;');await page.locator('#codeSave').click();await page.waitForFunction(()=>document.querySelector('#codeFeedback')?.classList.contains('bad'));
    assert.ok((await page.locator('#codeEditor').inputValue()).includes('const broken'));assert.ok(await page.locator('#codeDirty').isVisible());
    await page.locator('#codeEditor').fill(original.replace('toBeVisible();','toBeVisible( );'));await page.locator('#codeSave').click();await page.waitForFunction(()=>document.querySelector('#codeFeedback')?.classList.contains('good'));
    assert.equal(await page.locator('#codeDirty').isVisible(),false);
    const capture=process.env.AURA_UI_CAPTURE_DIR;if(capture){fs.mkdirSync(capture,{recursive:true});await page.screenshot({path:path.join(capture,'authoring-code-desktop.png'),fullPage:true});}
    // AURA_EXECUTION_CHOICE_ONLY runs just the execution-choice contracts.
    // The full sequence is long, and a fault anywhere in the UI is caught by whichever of its
    // ~40 assertions comes first - which makes a mutation aimed at one control report a
    // failure in an unrelated one. Narrowing the run is what lets each mutant redden the
    // contract written for it instead of the earliest bystander.
    if(!process.env.AURA_EXECUTION_CHOICE_ONLY)await reviewBrowserChecks(page,scope,recording,source,capture);
    await executionChoiceChecks(page,scope,recording,source);
    const foreign=await fetch(base+'/api/workspace/file?'+new URLSearchParams({applicationId:'north',environmentId:'qa',testCaseId:'TC_EDIT',file:'tests-e2e/pages/south/FirstPage.ts'}));assert.equal(foreign.status,400);
    assert.deepEqual(errors,[]);console.log('PASS actual code APIs, definitions, history, safe editing, scoped review renderer, keyboard resizing and responsive browser layout');
  } finally {await browser.close();child.kill();await new Promise<void>(r=>child.exitCode!==null?r():child.once('exit',()=>r()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
