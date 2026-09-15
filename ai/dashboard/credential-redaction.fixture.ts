import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceData } from '../testing/workspace-data';
import { resolveScope, resetActiveScope } from '../projects/scope';
import { readTestData, updateTestData } from '../test-data/store';

/**
 * Recording must not persist a credential merely because the field was not called
 * "password". Synthetic values only; nothing here reads or writes a real credential.
 */
const ACCOUNT='synthetic-account@example.invalid';
const SECRET='synthetic-only-password-8842';
const BUSINESS='customer-contact@example.invalid';   // ordinary data, must stay recordable
const DATA='Northwind Trading';

const {scope}=workspaceData();
// Legacy application bindings: BOTH halves must be protected, not the password alone.
const registryFile=process.env.AURA_REGISTRY_FILE!;
const registry=JSON.parse(fs.readFileSync(registryFile,'utf8'));
registry.applications[0].environments.qa.credentials={email:'FIXTUREAPP_EMAIL',password:'FIXTUREAPP_PASSWORD'};
fs.writeFileSync(registryFile,JSON.stringify(registry));
process.env.FIXTUREAPP_EMAIL=ACCOUNT;process.env.FIXTUREAPP_PASSWORD=SECRET;
resetActiveScope();
process.env.AURA_APPLICATION='north';process.env.AURA_ENVIRONMENT='qa';
const active=resolveScope({applicationId:'north',environmentId:'qa'});

const {parseRecording,credentialProvenance}=require('./recorder') as typeof import('./recorder');
let checks=0;
const check=(name:string,run:()=>void)=>{try{run();}catch(error:any){throw new Error(`FAIL ${name}: ${error?.message??error}`);}checks++;console.log('PASS '+name);};

/** A recording whose account field is labelled neutrally - the shape that leaked before. */
function recordingSource(lines:string[]):string {
  return `import { test, expect } from '@playwright/test';\ntest('recorded', async ({ page }) => {\n${lines.map(l=>'  '+l).join('\n')}\n});\n`;
}
const source=recordingSource([
  `await page.goto('https://portal.example.invalid/signin');`,
  `await page.getByLabel('Sign-in ID').fill('${ACCOUNT}');`,          // neutral label
  `await page.getByLabel('Passcode').fill('${SECRET}');`,             // neutral label
  `await page.getByRole('button', { name: 'Continue' }).click();`,
  `await page.getByLabel('Customer contact email').fill('${BUSINESS}');`,
  `await page.getByLabel('Company').fill('${DATA}');`,
]);
const recording=parseRecording(source,{startUrl:'https://portal.example.invalid/signin',browser:'chromium',durationMs:0,
  evidence:{available:false,reason:'synthetic redaction contract'} as any});
const fills=recording.actions.filter(action=>action.type==='fill');

check('credential identifier is protected by provenance despite a neutral label',()=>{
  const account=fills[0];
  assert.equal(account.redacted,true);
  assert.notEqual(account.value,ACCOUNT);
  assert.equal(account.valueSource?.field,'email');
  assert.equal(account.valueSource?.sensitivity,'SENSITIVE');
});
check('credential password is protected and classified SECRET',()=>{
  const secret=fills[1];
  assert.equal(secret.redacted,true);
  assert.notEqual(secret.value,SECRET);
  assert.equal(secret.valueSource?.field,'password');
  assert.equal(secret.valueSource?.sensitivity,'SECRET');
});
check('a business email that is not a credential is NOT redacted',()=>{
  const business=fills[2];
  assert.equal(business.redacted,undefined,'label-only matching must not swallow ordinary data');
  assert.equal(business.value,BUSINESS);
  assert.equal(business.valueSource,undefined);
});
check('ordinary Test Data remains recordable',()=>{
  assert.equal(fills[3].value,DATA);assert.equal(fills[3].redacted,undefined);
});
check('provenance is a comparison, never a disclosure',()=>{
  assert.equal(credentialProvenance(ACCOUNT)?.field,'email');
  assert.equal(credentialProvenance(SECRET)?.field,'password');
  assert.equal(credentialProvenance(BUSINESS),null);
  assert.equal(credentialProvenance('anything-else'),null);
});

// A JSON Credential Profile is the other supported provenance.
let catalog=readTestData(active);
catalog=updateTestData(active,catalog.version,{kind:'credential',profile:{name:'Profile user',
  environments:{qa:{username:'profile-account@example.invalid',password:'profile-only-password-7731'}}}});
const profile=catalog.credentialProfiles.find(item=>item.name==='Profile user')!;
process.env.AURA_EXECUTION_SELECTION=JSON.stringify({applicationId:'north',environmentId:'qa',testCaseId:'TC_REDACT',
  storeVersion:catalog.version,row:{id:'override-1-1',credentialProfileId:profile.id,dataProfileId:null,tags:[],overrides:{},enabled:true}});
const profileRecording=parseRecording(recordingSource([
  `await page.getByLabel('User').fill('profile-account@example.invalid');`,
  `await page.getByLabel('Key').fill('profile-only-password-7731');`,
  `await page.getByRole('button', { name: 'Go' }).click();`,
]),{startUrl:'https://portal.example.invalid/signin',browser:'chromium',durationMs:0,
  evidence:{available:false,reason:'synthetic redaction contract'} as any});
const profileFills=profileRecording.actions.filter(action=>action.type==='fill');
check('JSON Credential Profile username is protected through the selected profile',()=>{
  assert.equal(profileFills[0].redacted,true);
  assert.equal(profileFills[0].valueSource?.kind,'CREDENTIAL_PROFILE');
  assert.equal(profileFills[0].valueSource?.field,'email');
  assert.notEqual(profileFills[0].value,'profile-account@example.invalid');
});
check('JSON Credential Profile password is protected through the selected profile',()=>{
  assert.equal(profileFills[1].redacted,true);
  assert.equal(profileFills[1].valueSource?.field,'password');
  assert.notEqual(profileFills[1].value,'profile-only-password-7731');
});
delete process.env.AURA_EXECUTION_SELECTION;

check('application isolation: another application resolves no credentials of this one',()=>{
  const other=resolveScope({applicationId:'south',environmentId:'qa'});
  assert.notEqual(other.applicationId,active.applicationId);
  assert.equal(readTestData(other).credentialProfiles.length,0,'a foreign application sees no profile of this one');
});

// GENERATION: the function generation uses to choose which semantic reference to emit.
const {credentialFieldOf}=require('../autocode/from-recording') as typeof import('../autocode/from-recording');
const semantic=(action:any)=>`appCredentials.${credentialFieldOf(action) ?? (action.redacted ? 'password' : 'email')}`;
check('generated code uses appCredentials.email for the protected identifier',()=>{
  assert.equal(credentialFieldOf(fills[0] as any),'email');
  assert.equal(semantic(fills[0]),'appCredentials.email');
});
check('generated code uses appCredentials.password for the protected secret',()=>{
  assert.equal(credentialFieldOf(fills[1] as any),'password');
  assert.equal(semantic(fills[1]),'appCredentials.password');
});
check('a legacy recording without provenance keeps its original inference exactly',()=>{
  assert.equal(credentialFieldOf({type:'fill',redacted:true} as any),null,'no provenance means the legacy rule decides');
  assert.equal(semantic({type:'fill',redacted:true}),'appCredentials.password');
  assert.equal(semantic({type:'fill'}),'appCredentials.email');
});

// The per-action replacement only reaches modelled `.fill()` calls. A credential can also
// land in a URL or a comment the parser never modelled, which is what the sweep is for.
const {redactSource}=require('./recorder') as typeof import('./recorder');
const leaky=source
  .replace("await page.goto('https://portal.example.invalid/signin');",
    `await page.goto('https://portal.example.invalid/signin?user=${ACCOUNT}');
  // resumed session for ${ACCOUNT} using ${SECRET}`);
const scrubbed=redactSource(leaky,recording as any);
check('a credential outside a modelled fill is still scrubbed from the recorded source',()=>{
  assert.ok(!scrubbed.includes(ACCOUNT),'an account identifier survived in a URL or comment');
  assert.ok(!scrubbed.includes(SECRET),'a password survived in a URL or comment');
  assert.ok(scrubbed.includes(BUSINESS),'ordinary data must survive redaction');
});

// SECRET-SCAN: nothing this pipeline produced may contain a synthetic credential value.
const protectedValues=[ACCOUNT,SECRET,'profile-account@example.invalid','profile-only-password-7731'];
const scanned:string[]=[];
const hits:string[]=[];
const serialised=[JSON.stringify(recording),JSON.stringify(profileRecording),scrubbed];
for(const [index,text] of serialised.entries()){
  scanned.push('recording['+index+']');
  for(const value of protectedValues)if(text.includes(value))hits.push(`recording[${index}]`);
}
const walk=(dir:string)=>{if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory()){walk(file);continue;}
  scanned.push(file);const text=fs.readFileSync(file).toString('utf8');
  for(const value of protectedValues)if(text.includes(value))hits.push(file);}};
for(const dir of [scope.paths.recordingsDir,scope.paths.generatedDir,path.join(process.cwd(),'ai/diagnostics/artifacts')])walk(dir);
check(`secret scan across ${scanned.length} produced artifact(s) finds no protected value`,()=>
  assert.deepEqual(hits,[],'a protected value reached a persisted artifact'));

console.log(`${checks} credential redaction contracts passed`);
