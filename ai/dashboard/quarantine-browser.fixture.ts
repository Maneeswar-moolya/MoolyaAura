import '../testing/isolated-checkout';
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {spawn}from'node:child_process';
import {chromium}from'playwright';import ExcelJS from'exceljs';
import {workspaceData}from'../testing/workspace-data';import {createQuarantinePackage}from'./quarantine-workspace';import {gate}from'../autocode/verify';
import {captureDiagnostic,diagnosticRoot}from'../diagnostics/artifacts';
async function main(){
 const {scope}=workspaceData(),browser=await chromium.launch({headless:true});let child:ReturnType<typeof spawn>|undefined;
 try{
  for(const app of ['north','south']){const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Cases');sheet.addRows([['Test Case ID','Scenario','Module','Steps','Expected Result','Run'],['TC_EDIT','Continues to the next screen','Authoring','Click Continue','Continue is visible','Yes']]);await workbook.xlsx.writeFile(`excel/${app}.xlsx`);}
  fs.writeFileSync(scope.paths.fixturesFile,fs.readFileSync(scope.paths.fixturesFile,'utf8').replace('interface Fixtures {','interface Fixtures {\n  step: import("./support/base-fixtures").StepFn;'));
  const capturePage=await browser.newPage();await capturePage.setContent('<button>Continue</button>');
  const capture=await captureDiagnostic(capturePage,path.join(diagnosticRoot(scope),'recordings','synthetic'),'action:1','BEFORE_ACTION');assert.ok(capture);capture.artifact='recordings/synthetic/'+capture.artifact;await capturePage.close();
  const evidence=path.join(scope.paths.recordingsDir,'TC_EDIT.evidence.json'),data=JSON.parse(fs.readFileSync(evidence,'utf8'));data.captures=[capture];fs.writeFileSync(evidence,JSON.stringify(data));
  const spec='tests-e2e/generated/north/TC_EDIT.spec.ts';fs.writeFileSync(spec,`import {test,expect,trace} from '../../north.fixtures';
test('TC_EDIT - Continues to the next screen',async({page,firstPage,step})=>{
 await trace({testCaseId:'TC_EDIT',module:'Authoring',scenario:'Continues to the next screen',sourceWorkbook:'north.xlsx',sourceWorksheet:'Cases'});
 await page.setContent('<button data-testid="continue">Continue</button>');
 // @aura-step {"recordingStepKey":"action:1","label":"Continue","pageObject":"FirstPage","method":"control","provenance":"USER_CONFIRMED"}
 await step('Continue',async()=>{await (await firstPage.control()).click();});
 // @aura-step {"recordingStepKey":"assertion:0","label":"Saved state"}
 await step('Saved state',async()=>{await expect(page.getByRole('heading',{name:'Saved'})).toBeVisible({timeout:100});});
});`);
  const result=gate(spec,'TC_EDIT','Continues to the next screen','excel/north.xlsx');assert.equal(result.verdict,'quarantined');
  const id=createQuarantinePackage(scope,spec,'TC_EDIT',result,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',runId:'synthetic-ui-run'});fs.unlinkSync(spec);
  const probe=http.createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address()as any).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/dashboard/server.ts'],{env:{...process.env,EXCEL_DASHBOARD_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout!.on('data',data=>output+=data);child.stderr!.on('data',data=>output+=data);
  const base=`http://127.0.0.1:${port}`;let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,'dashboard startup: '+output);
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(60_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.waitForFunction(()=>!!(window as any).quarantineWorkspace);await page.locator('#project').selectOption('north');await page.waitForFunction(()=>document.querySelector('#caseRows')?.textContent?.includes('TC_EDIT'));
  await page.locator('#tab-quarantine').click();await page.locator('#qdCases button').filter({hasText:'TC_EDIT'}).click();await page.waitForFunction(()=>document.querySelector('#qdFilename')?.textContent?.includes('TC_EDIT.spec.ts'),{},{timeout:60_000});
  assert.match(await page.locator('#qdFailure').innerText(),/expect|visible|locator/i,'workspace shows actual retained runtime error');
  assert.ok(await page.getByRole('link',{name:'Download sanitized trace'}).isVisible(),'trace available in failure workspace');
  await page.locator('#qdPictures').getByRole('button',{name:'Failure',exact:true}).click();assert.ok(await page.locator('#qdPictures img').isVisible(),'runtime FAILURE screenshot displayed');
  await page.locator('#qdSteps button').filter({hasText:/^Continue$/}).click();await page.locator('#qdPictures').getByRole('button',{name:'Recorded',exact:true}).click();assert.ok(await page.locator('#qdPictures img').isVisible(),'recorded screenshot displayed');
  await page.locator('#qdPictures input[type=range]').fill('150');assert.equal(await page.locator('#qdPictures img').evaluate(image=>(image as HTMLElement).style.width),'150%','screenshot zoom state');
  await page.locator('#qdPictures').getByRole('button',{name:'Fit',exact:true}).click();assert.equal(await page.locator('#qdPictures img').evaluate(image=>(image as HTMLElement).style.width),'100%');
  await page.locator('#qdPictures').getByRole('button',{name:'Fullscreen',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);assert.ok(await page.evaluate(()=>!!document.fullscreenElement),'screenshot fullscreen state');await page.evaluate(()=>document.exitFullscreen());
  await page.locator('#qdSource .aw-line').filter({hasText:'await (await firstPage.control()).click()'}).locator('.aw-symbol').filter({hasText:/^control$/}).click();await page.waitForFunction(()=>document.querySelector('#qdFilename')?.textContent?.includes('FirstPage.ts'));
  await page.locator('#qdBack').click();await page.waitForFunction(()=>document.querySelector('#qdFilename')?.textContent?.includes('TC_EDIT.spec.ts'));await page.locator('#qdForward').click();await page.waitForFunction(()=>document.querySelector('#qdFilename')?.textContent?.includes('FirstPage.ts'));
  await page.locator('#qdSource .aw-symbol').filter({hasText:/^resolve$/}).click();await page.waitForFunction(()=>document.querySelector('#qdFilename')?.textContent?.includes('base.page.ts'));assert.ok(await page.locator('#qdEdit').isDisabled(),'shared source protected in quarantine');
  await page.locator('#qdFiles button').filter({hasText:spec}).click();await page.waitForFunction(()=>document.querySelector('#qdFilename')?.textContent?.includes('TC_EDIT.spec.ts'));await page.locator('#qdEdit').click();const source=await page.locator('#qdEditor').inputValue();
  await page.locator('#qdEditor').fill(source+'\nconst broken: = ;');await page.locator('#qdPictures').getByRole('button',{name:'Next step'}).click();assert.ok((await page.locator('#qdEditor').inputValue()).includes('const broken'),'screenshot navigation preserves unsaved editor');
  await page.locator('#qdSave').click();await page.waitForFunction(()=>document.querySelector('#qdStatus')?.textContent?.includes('Unsaved editor content was kept'));assert.ok(await page.locator('#qdDirty').isVisible(),'invalid save keeps dirty content');
  await page.locator('#qdEditor').fill(source+'\n// reviewed quarantine draft\n');await page.locator('#qdSave').click();await page.waitForFunction(()=>document.querySelector('#qdStatus')?.textContent?.includes('Draft saved'),{},{timeout:60_000});assert.ok(await page.locator('#qdPromote').isDisabled(),'Save Draft never promotes');
  await page.locator('#qdDiff').click();await page.waitForFunction(()=>document.querySelector('#qdDifference')?.textContent?.includes('reviewed quarantine draft'));assert.match(await page.locator('#qdDifference').innerText(),/reviewed quarantine draft/,'quarantine diff visible');
  await page.getByRole('button',{name:'Open executed revision',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#qdFilename')?.textContent?.includes('executed revision'));
  assert.ok(!(await page.locator('#qdSource').innerText()).includes('reviewed quarantine draft'),'executed revision remains exact after editing');assert.ok(await page.locator('#qdEdit').isDisabled(),'historical executed revision is read-only');
  await page.locator('#qdOriginal').click();await page.waitForFunction(()=>document.querySelector('#qdFilename')?.textContent?.includes('editable draft'));assert.match(await page.locator('#qdSource').innerText(),/reviewed quarantine draft/,'return from history restores current draft');
  await page.getByRole('separator',{name:'Resize quarantine panes'}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('separator',{name:'Resize quarantine panes'}).getAttribute('aria-valuenow'),'25','pane resize is keyboard accessible');
  await page.locator('#qdMapping').click();await page.locator('#ownerSteps button').first().click();await page.locator('#logicalPage').click();await page.getByRole('option',{name:/Create new Page/}).click();assert.equal(await page.locator('#newPageRoute').inputValue(),'/home','route prefilled from recording');await page.locator('#newPageName').fill('ReusableHeader');await page.locator('#newPageRoute').fill('');await page.getByRole('button',{name:'Use new Page',exact:true}).click();
  await page.locator('#ownerPageObject').click();await page.getByRole('option',{name:/Create.*Page Object/}).click();await page.locator('#newPageObjectName').fill('HeaderControls');await page.getByRole('button',{name:'Use new Page Object',exact:true}).click();await page.locator('#saveMapping').click();await page.waitForFunction(()=>document.querySelector('#ownerFeedback')?.textContent?.includes('Mapping saved'),{},{timeout:60_000});
  assert.match(await page.locator('#ownerDetail').innerText(),/ReusableHeader/,'route-less mapping reads back selected Page');assert.ok(await page.locator('#ownerDetail .qd-viewer img').isVisible(),'Recording Review displays selected step screenshot');
  await page.locator('#ownerSteps button').nth(1).click();assert.match(await page.locator('#ownerDetail .qd-viewer').innerText(),/No recording screenshot was captured for this step/,'missing historical capture is honest');
  await page.setViewportSize({width:760,height:980});assert.ok(await page.locator('#qdMappingHost').isVisible(),'responsive quarantine mapping');
  const width=await page.locator('#qdFailure').evaluate(node=>({scroll:node.scrollWidth,client:node.clientWidth}));assert.ok(width.scroll<=width.client+1,'failure details fit the responsive pane: '+JSON.stringify(width));
  if(process.env.AURA_UI_CAPTURE_DIR){fs.mkdirSync(process.env.AURA_UI_CAPTURE_DIR,{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(process.env.AURA_UI_CAPTURE_DIR,'quarantine-mobile.png')});await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(process.env.AURA_UI_CAPTURE_DIR,'quarantine-desktop.png')});}
  const foreign=await fetch(base+'/api/quarantine/details?'+new URLSearchParams({applicationId:'south',environmentId:'qa',packageId:id}));assert.equal(foreign.status,400,'foreign quarantine API rejected');
  // WHAT THE WORKSPACE SENDS. The rerun service's use of the approved mode is proven by
  // quarantine-workspace.fixture.ts --phase=rerun and its mutant, and the gate's argv by
  // execution-context.fixture.ts - but nothing checked the link above them: whether the
  // dialog a person answers puts its answer in the request at all. A rerun that silently
  // dropped Headed looked identical from the server side, because the server faithfully
  // propagated the headless it was sent. The request is answered here rather than executed:
  // the subject is the payload, and running it would open a second real headed browser.
  await page.setViewportSize({width:1440,height:1000});
  let rerunRequest:any;
  await page.route('**/api/quarantine/rerun',async route=>{rerunRequest=route.request().postDataJSON();
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({runId:'synthetic-ui-rerun',result:{verdict:'quarantined',reason:'Synthetic rerun transport check'}})});});
  await page.locator('#qdRerun').click();
  const settings=page.locator('dialog').filter({hasText:'Quarantine execution settings'});
  await settings.waitFor({timeout:60_000});
  // This package was created without an ExecutionContext, so it is legacy: the dialog must
  // ASK rather than prefill, and say why, instead of quietly reusing the target environment.
  assert.equal(await settings.getByLabel('Source Environment',{exact:true}).inputValue(),'','a legacy package never prefills a source it never recorded');
  const legacyNote=settings.locator('.qd-legacy-source');
  // VISIBLE, not merely present: `.note` is display:none until `.show` is added, so a note
  // built without it sits in the DOM saying nothing to the person being asked to choose.
  assert.equal(await legacyNote.isVisible(),true,'the legacy explanation is actually shown, not just present in the DOM');
  assert.match(await legacyNote.innerText(),/predates Source Environment tracking[\s\S]*original record will not be changed/,'the dialog explains why it is asking and promises the original is untouched');
  await settings.getByRole('button',{name:'Use execution settings',exact:true}).click();
  assert.match(await settings.locator('.note.bad').innerText(),/SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE/,'an unanswered source refuses instead of guessing');
  await settings.getByLabel('Source Environment',{exact:true}).selectOption('qa');
  await settings.getByLabel('Mode',{exact:true}).selectOption('headed');
  // The normal Re-run workflow must default to validating against the current framework;
  // reproduction is available but never chosen for the user, and never silently.
  const basis=settings.getByRole('group',{name:'Execution basis'});
  assert.equal(await basis.getByRole('radio',{name:/Validate with current framework/}).isChecked(),true,'Re-run defaults to CURRENT_FRAMEWORK_VALIDATION');
  assert.equal(await basis.getByRole('radio',{name:/Reproduce historical execution/}).isChecked(),false,'historical replay is never the default');
  assert.match(await basis.innerText(),/cannot establish promotion eligibility/,'the dialog states what a replay cannot prove');
  await settings.getByRole('button',{name:'Use execution settings',exact:true}).click();
  await page.getByRole('button',{name:'Re-run with original profile',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#qdStatus')?.textContent?.includes('Synthetic rerun transport check'),{},{timeout:60_000});
  assert.equal(rerunRequest?.executionBasis,'CURRENT_FRAMEWORK_VALIDATION','the workspace sends the execution basis it displayed');
  assert.equal(rerunRequest?.headed,true,'quarantine rerun sends the approved Headed mode');
  assert.equal(rerunRequest?.sourceEnvironmentId,'qa','quarantine rerun sends the selected Source Environment');
  assert.equal(rerunRequest?.browserEngine,'chromium','quarantine rerun sends the selected browser engine');
  assert.equal(rerunRequest?.applicationId,'north','quarantine rerun stays inside its own application');
  await page.unroute('**/api/quarantine/rerun');
  console.log('PASS quarantine rerun request carries the approved browser mode, source environment and application');
  assert.deepEqual(errors,[],'quarantine browser has no unhandled JavaScript errors');console.log('PASS quarantine browser: failure details, images/zoom/navigation, code definitions, Back/Forward, dirty save/diff, route-less mapping, responsiveness and isolation');
 }finally{await browser.close();child?.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
