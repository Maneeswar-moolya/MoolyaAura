import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceData } from '../testing/workspace-data';
import { persistRecording, evidencePath } from './recorder';
import { recordingStatus, describeRecording, recordingEvidenceGap } from './case-status';
import { evidenceUnavailable } from '../autocode/dom-evidence';
import { targetEvidence, recordingSource } from '../testing/synthetic-data';
import { resolveScope } from '../projects/scope';

/**
 * A RECORDING THAT CANNOT GENERATE MUST NOT LOOK READY.
 *
 * The sidecar used to be written only when evidence was available, so a recording whose
 * live capture produced nothing left no file at all - indistinguishable on disk from one
 * made before evidence existed - while its spec, owners and authoring sidecar were all
 * present. Generation was the first thing to discover it, after the only moment that could
 * have been measured had passed. The fix records the ABSENCE, and nothing credits it.
 */
const {scope}=workspaceData();
const dir=scope.paths.recordingsDir;
let checks=0;
const check=(name:string,run:()=>void)=>{try{run();}catch(e:any){throw new Error(`FAIL ${name}: ${e?.message??e}`);}checks++;console.log('PASS '+name);};

const origin={applicationId:'north',environmentId:'qa',baseUrl:'https://portal.example.invalid/'} as any;
const source=recordingSource([`await page.goto('https://portal.example.invalid/home');`,
  `await page.getByTestId('continue').click();`]);

// ---- 1. A recording WITH evidence writes an available sidecar.
const rich:any={available:true,capturedAt:new Date(0).toISOString(),limits:{},
  targets:[targetEvidence(`page.getByTestId('continue')`,{route:'/home',documentId:'d1',elementRef:'d1:1',
    target:{tag:'button',role:'button',accessibleName:'Continue',accessibleNameVerified:true}})]};
persistRecording('TC_RICH',source,rich,undefined,origin);
check('a recording with captured targets writes an available sidecar',()=>{
  const file=evidencePath('TC_RICH',dir);
  assert.ok(fs.existsSync(file),'sidecar written');
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(parsed.available,true);
  assert.equal(parsed.targets.length,1,'the captured target survives the save');
  assert.equal(parsed.origin.applicationId,'north','evidence is application scoped');
  assert.equal(parsed.origin.testCaseId,'TC_RICH','evidence is bound to its case id');
});
check('step identity survives save and reload',()=>{
  const parsed=JSON.parse(fs.readFileSync(evidencePath('TC_RICH',dir),'utf8'));
  assert.equal(parsed.targets[0].locator,`page.getByTestId('continue')`,'the recorded locator is the pairing key');
  assert.equal(parsed.targets[0].elementRef,'d1:1','interaction-time element identity is retained');
});
check('a recording with evidence reports as usable',()=>{
  const status=recordingStatus({testCaseId:'TC_RICH',steps:['x'],expectedResult:'y'} as any,dir);
  assert.equal(status.exists,true);assert.equal(status.hasEvidence,true);
  assert.equal(recordingEvidenceGap('TC_RICH',dir),undefined,'no gap is reported');
});

// ---- 2. A recording WITHOUT evidence records the reason instead of nothing.
persistRecording('TC_BARE',source,evidenceUnavailable('live capture was active but located no target in this recording (0 capture failure(s))'),undefined,origin);
check('a recording with no captured target still writes a sidecar',()=>{
  assert.ok(fs.existsSync(evidencePath('TC_BARE',dir)),'the absence is recorded rather than left implicit');
});
check('the sidecar says unavailable and why - no fabricated evidence',()=>{
  const parsed=JSON.parse(fs.readFileSync(evidencePath('TC_BARE',dir),'utf8'));
  assert.equal(parsed.available,false,'never a soft yes');
  assert.match(String(parsed.reason),/located no target/,'the capture layer reason is preserved verbatim');
  assert.equal(parsed.targets,undefined,'no targets are invented');
  assert.equal(parsed.captures,undefined,'no captures are invented');
  assert.equal(parsed.origin.applicationId,'north','the record is still application scoped');
});
check('an unusable recording is reported as RECORDING_EVIDENCE_INCOMPLETE, not as ready',()=>{
  const status=recordingStatus({testCaseId:'TC_BARE',steps:['x'],expectedResult:'y'} as any,dir);
  assert.equal(status.exists,true,'the recording itself was saved');
  assert.equal(status.hasEvidence,false,'a present sidecar is not admissible evidence');
  const summary=describeRecording(status);
  assert.match(summary,/RECORDING_EVIDENCE_INCOMPLETE/,'the state is named');
  assert.match(summary,/Re-record/,'and the remedy is stated');
  assert.doesNotMatch(summary,/Recording matches the authored row/,'it must not read as healthy');
  assert.match(String(recordingEvidenceGap('TC_BARE',dir)),/no admissible|located no target/);
});

check('a case nobody recorded has no evidence gap to report',()=>{
  assert.equal(recordingStatus({testCaseId:'TC_NONE',steps:['x'],expectedResult:'y'} as any,dir).exists,false);
  assert.equal(recordingEvidenceGap('TC_NONE',dir),undefined,
    'a missing sidecar is only a finding about a recording that exists');
});

// ---- 3. Application isolation.
check('another application cannot see this evidence',()=>{
  const other=resolveScope({applicationId:'south',environmentId:'qa'});
  assert.equal(fs.existsSync(evidencePath('TC_RICH',other.paths.recordingsDir)),false);
  assert.equal(fs.existsSync(evidencePath('TC_BARE',other.paths.recordingsDir)),false);
});

// ---- 4. Re-saving replaces rather than accumulating, and can go either way.
persistRecording('TC_BARE',source,rich,undefined,origin);
check('re-recording an incomplete case can restore admissible evidence',()=>{
  const parsed=JSON.parse(fs.readFileSync(evidencePath('TC_BARE',dir),'utf8'));
  assert.equal(parsed.available,true,'the new recording replaces the incomplete record');
  assert.equal(recordingStatus({testCaseId:'TC_BARE',steps:['x'],expectedResult:'y'} as any,dir).hasEvidence,true);
});
persistRecording('TC_RICH',source,evidenceUnavailable('capture produced nothing on this attempt'),undefined,origin);
check('a later evidence-less recording downgrades rather than keeping the old sidecar',()=>{
  const parsed=JSON.parse(fs.readFileSync(evidencePath('TC_RICH',dir),'utf8'));
  assert.equal(parsed.available,false,'a stale available sidecar is never left behind');
  assert.equal(parsed.targets,undefined,'the previous recording’s targets are not carried over');
});
console.log(`${checks} recording evidence contracts passed`);
