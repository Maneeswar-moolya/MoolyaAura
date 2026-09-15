import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { workspaceData } from '../testing/workspace-data';
import { RecordingPictures } from './recording';
import { diagnosticRoot, diagnosticData, containedFile } from './artifacts';
import { parseRecording, persistRecording } from '../dashboard/recorder';
import { evidenceUnavailable } from '../autocode/dom-evidence';
import { recordingSource } from '../testing/synthetic-data';
async function main(){
  const {scope,other}=workspaceData(),browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext();
    await context.exposeBinding('__pw_recorderPerformAction',async({page},action)=>{await page.getByTestId(action.selector).click();});
    await context.exposeBinding('__pw_recorderRecordAction',async()=>{});
    const pictures=new RecordingPictures(scope);await pictures.install(context);
    const page=await context.newPage();await page.setContent('<button data-testid="continue" onclick="this.textContent=\'Saved\'">Continue</button><input type="password" value="synthetic-password">');
    await page.evaluate(async()=>{await (window as any).__pw_recorderPerformAction({name:'click',selector:'continue'});});
    await page.evaluate(async()=>{await (window as any).__pw_recorderRecordAction({name:'assertText',selector:'continue',value:'Saved'});});
    const source=recordingSource(["await page.getByTestId('continue').click();","await expect(page.getByTestId('continue')).toContainText('Saved');"]);
    const recording=parseRecording(source,{startUrl:'',browser:'chromium',durationMs:0});
    // HARNESS CORRECTION, not a behaviour change: an action the browser has already
    // performed is reported to this process without the page waiting for the picture,
    // so the reports are settled before they are paired. Asserting straight after the
    // evaluate assumed a wait that a navigating click could not afford to make.
    await pictures.settle(page);
    const captures=pictures.finish(recording.actions,recording.assertions);
    console.log(JSON.stringify({observations:pictures.observations.map(item=>({name:item.name,captures:item.captures.length})),actions:recording.actions.map(item=>item.type),assertions:recording.assertions.map(item=>item.type)}));
    assert.deepEqual(captures.map(item=>item.captureType),['BEFORE_ACTION','AFTER_ACTION','ASSERTION_STATE'],'recording captures before action and assertion state');
    assert.deepEqual(captures.map(item=>item.recordingStepKey),['action:0','action:0','assertion:0'],'recording captures have structural step keys');
    for(const capture of captures)assert.ok(fs.existsSync(containedFile(diagnosticRoot(scope),capture.artifact)),'screenshot exists before generation');
    assert.notDeepEqual(fs.readFileSync(containedFile(diagnosticRoot(scope),captures[0].artifact)),fs.readFileSync(containedFile(diagnosticRoot(scope),captures[1].artifact)),'before and after capture different screen states');
    const evidence={...evidenceUnavailable('Synthetic recording pictures without locator measurements'),captures};
    persistRecording('TC_PICTURES',source,evidence,[],{applicationId:scope.applicationId,environmentId:scope.environmentId,baseUrl:scope.baseUrl});
    const saved=JSON.parse(fs.readFileSync(path.join(scope.paths.recordingsDir,'TC_PICTURES.evidence.json'),'utf8'));
    assert.equal(saved.available,false,'screenshots must not invent locator identity proof');assert.equal(saved.captures.length,3,'pictures persist even without automatic evidence');
    assert.equal(fs.existsSync(path.join(other.paths.recordingsDir,'TC_PICTURES.evidence.json')),false,'pictures stay in the selected application');
    process.env.DIAGNOSTIC_SECRET='synthetic-sensitive-value';
    const safe=JSON.stringify(diagnosticData({url:'https://example.invalid/auth?SAMLResponse=private#secret',label:process.env.DIAGNOSTIC_SECRET,cookie:'private',password:'private'}));
    assert.ok(!safe.includes('synthetic-sensitive-value')&&!safe.includes('SAMLResponse=private')&&!safe.includes('"private"'),'diagnostic metadata redacts secrets and sensitive URLs');
    assert.throws(()=>containedFile(diagnosticRoot(scope),'../../south/secrets.json'),/outside this application/,'foreign diagnostic artifact denied');
    const native=await browser.newContext(),nativeSource=path.resolve('native-pictures.spec.ts');
    await (native as any)._enableRecorder({language:'playwright-test',mode:'recording',outputFile:nativeSource,handleSIGINT:false,hideToolbar:true},()=>{});
    const nativePictures=new RecordingPictures(scope);await nativePictures.install(native);
    await native.route('https://recording.example.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<button onclick="this.textContent=\'Saved\'">Continue</button><input aria-label="Search">'}));
    const nativePage=await native.newPage();await nativePage.goto('https://recording.example.invalid/');await nativePage.waitForTimeout(1200);
    await nativePage.getByRole('button',{name:'Continue'}).click();
    for(let i=0;i<60&&!nativePictures.observations.some(item=>item.name==='click'&&item.captures.length===2);i++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(nativePictures.observations.some(item=>item.name==='click'&&item.captures.some(capture=>capture.captureType==='BEFORE_ACTION')),'native recorder captures BEFORE_ACTION without replacing recorder behavior '+JSON.stringify(nativePictures.observations.map(item=>({name:item.name,captures:item.captures.length}))));
    const click=nativePictures.observations.find(item=>item.name==='click')!;
    assert.notDeepEqual(fs.readFileSync(containedFile(diagnosticRoot(scope),click.captures[0].artifact)),fs.readFileSync(containedFile(diagnosticRoot(scope),click.captures[1].artifact)),'native buffered screenshot precedes the application action');
    await nativePage.getByRole('textbox').focus();await nativePage.waitForTimeout(400);
    await nativePage.getByRole('textbox').pressSequentially('synthetic');
    for(let i=0;i<40&&!nativePictures.observations.some(item=>item.name==='fill'&&item.captures.some(capture=>capture.captureType==='BEFORE_ACTION'));i++)await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(nativePictures.observations.some(item=>item.name==='fill'&&item.captures.some(capture=>capture.captureType==='BEFORE_ACTION')),'native fill uses a completed focus capture before input');
    assert.equal(await nativePage.getByRole('textbox').inputValue(),'synthetic','screenshots do not change input behavior');await native.close();
    console.log('PASS recording screenshots, assertion state, pre-generation persistence, correlation and redaction');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
