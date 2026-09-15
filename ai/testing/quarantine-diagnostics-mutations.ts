/** Faults execute only in guarded synthetic checkouts, with assertion-specific kills. */
import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync}from'node:child_process';
const workspace='ai/dashboard/quarantine-workspace.ts',fixture='ai/dashboard/quarantine-workspace.fixture.ts';
const mutants=[
 {name:'route becomes mandatory',file:'ai/dashboard/authoring-catalog.ts',from:'if (!name || name.length',to:'if (!route || !name || name.length',test:fixture,args:['--phase=route'],gate:'Page name alone creates a Page'},
 {name:'route becomes Page identity and rejects a second logical Page',file:'ai/dashboard/authoring-catalog.ts',from:'hashContent(page.name).slice(0, 20)',to:'hashContent(page.route).slice(0, 20)',test:fixture,args:['--phase=route'],gate:'same-route and route-less logical Pages coexist'},
 {name:'draft save overwrites immutable original',file:workspace,from:'commitTexts(changes);\n  const {transaction',to:"commitTexts(changes);fs.writeFileSync(path.join(loaded.directory,'original.json'),JSON.stringify({...loaded.original,files:{...loaded.original.files,[file]:content}}));\n  const {transaction",test:fixture,args:['--phase=editing'],gate:'quarantine draft never overwrites original'},
 {name:'Save Draft grants promotion eligibility',file:workspace,from:'return {...state,eligible:false,promoted:false}',to:'return {...state,eligible:true,promoted:false}',test:fixture,args:['--phase=editing'],gate:'Save Draft alone never promotes or grants eligibility'},
 {name:'draft pointer failure leaves partial revision',file:'ai/knowledge/authoring-owners.ts',from:'committed.reverse()',to:'[]',test:fixture,args:['--phase=editing'],gate:'failed save leaves no partial revision'},
 {name:'runtime captures lose recording-step correlation',file:'tests-e2e/support/steps.ts',from:"diagnostic?.recordingStepKey ?? `runtime:${stepId}`,type",to:"`runtime:${stepId}`,type",test:'ai/diagnostics/runtime-pictures.fixture.ts',gate:'failure screenshots keep structural step correlation'},
 {name:'quarantine omits runtime error',file:workspace,from:'createdAt:new Date().toISOString(),entry,files,liveVersions,gate,dependencyProvenance,scenario:',to:"createdAt:new Date().toISOString(),entry,files,liveVersions,gate:gate?{...gate,detail:{...gate.detail,playwrightMessage:''}}:undefined,dependencyProvenance,scenario:",test:fixture,args:['--phase=package'],gate:'runtime error retained in quarantine'},
 {name:'foreign source request resolves another application',file:workspace,from:'const loaded=load(scope,id),overlay=original?',to:"if(scope.applicationId==='south')scope=require('../projects/scope').resolveScope({applicationId:'north',environmentId:'qa'});const loaded=load(scope,id),overlay=original?",test:fixture,args:['--phase=package'],gate:'foreign quarantine source cannot be opened for editing'},
 {name:'known recorded secret bypasses diagnostic redaction',file:'ai/diagnostics/artifacts.ts',from:"let text = String(input ?? '');",to:"let text = String(input ?? '');return text;",test:'ai/diagnostics/security.fixture.ts',gate:'recorded secret never enters diagnostic manifest'},
 {name:'runtime failure silently rewrites a user locator',file:'ai/autocode/verify.ts',from:"if (clean.status !== 'Passed') {",to:"if (clean.status !== 'Passed') { fs.writeFileSync(absolute,original.replace(\"getByTestId('continue')\",\"getByTestId('replacement')\"));",test:'ai/diagnostics/runtime-pictures.fixture.ts',gate:'runtime failure never silently replaces user-authored locator'},
 {name:'trace retains credential fill values',file:'ai/diagnostics/trace.ts',from:'JSON.stringify(diagnosticData(JSON.parse(line)))',to:'JSON.stringify(JSON.parse(line))',test:'ai/diagnostics/security.fixture.ts',gate:'trace redacts credential fill payloads'},
];
const choice=process.argv.find(arg=>arg.startsWith('--mutant='));
if(!choice&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
 for(let i=0;i<mutants.length;i++){const child=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',timeout:300000,windowsHide:true});assert.equal(child.status,0,`Mutation ${i}: ${child.error??''}`);}console.log(`PASS all ${mutants.length} quarantine diagnostics mutants killed`);
}else{
 require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
 const mutant=mutants[Number(choice?.split('=')[1])];assert.ok(mutant);const original=fs.readFileSync(mutant.file,'utf8');assert.ok(original.includes(mutant.from),`Missing mutation anchor: ${mutant.name}`);
 try{fs.writeFileSync(mutant.file,original.replace(mutant.from,mutant.to));const child=spawnSync(process.execPath,[require.resolve('tsx/cli'),mutant.test,...(mutant.args??[])],{encoding:'utf8',timeout:240000,maxBuffer:5*1024*1024,windowsHide:true});
 assert.notEqual(child.status,0,`SURVIVED ${mutant.name}`);assert.ok((child.stdout+child.stderr).includes(mutant.gate),`Wrong failure for ${mutant.name}: ${child.stdout}${child.stderr}`);console.log(`KILLED ${mutant.name}: ${mutant.gate}`);
 }finally{fs.writeFileSync(mutant.file,original);}
}
