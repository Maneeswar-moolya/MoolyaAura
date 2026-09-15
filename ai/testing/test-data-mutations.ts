/** Run real behavior against corrupted source in an independently guarded checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const store='ai/test-data/store.ts',execution='ai/test-data/execution.ts';
const mutants=[
 {name:'plaintext password written to JSON',file:store,from:"const text=JSON.stringify(store,null,2)+'\\n'",to:"const text=JSON.stringify({...store,plaintextPassword:'synthetic-test-password'},null,2)+'\\n'",gate:'store must encrypt passwords'},
 {name:'GET exposes password payload',file:store,from:'passwordConfigured:!!c.secretPayload',to:'passwordConfigured:!!c.secretPayload,password:c.secretPayload.ciphertext',gate:'API GET never exposes a password property'},
 {name:'cross-application catalog read',file:store,from:'export function readTestData(scope:ApplicationScope){const {store,version}=load(scope)',to:"export function readTestData(scope:ApplicationScope){const {store,version}=load({...scope,applicationId:'north'})",gate:'foreign profiles not listed'},
 {name:'rename changes stable profile ID',file:store,from:"profile.name=name;profile.role",to:"if(existing&&profile.name!==name)profile.id='cred_'+randomUUID();profile.name=name;profile.role",gate:'rename retains stable ID'},
 {name:'Example rows collapse into one execution',file:execution,from:'return plan;',to:'return plan.slice(0,1);',gate:'Example rows remain separate executions'},
 {name:'stale JSON update overwrites newer data',file:store,from:'if(expectedVersion!==loaded.version)',to:'if(false)',from2:'if(load(scope).version!==expectedVersion)',to2:'if(false)',gate:'stale revision cannot overwrite'},
 {name:'inactive credential executes',file:store,from:"if(!p.active)fail('Selected profile is inactive.');",to:'',gate:'Missing expected exception'},
 {name:'referenced credential deleted',file:store,from:"if(references(store,change.id).length||historyReferences(scope,change.id))fail('This profile has Example or execution references. Deactivate it or resolve references first.');",to:'',from2:"if(row.credentialProfileId!==null&&!value.credentialProfiles.some(p=>p.id===row.credentialProfileId))fail('Credential profile is missing or belongs to another application.');",to2:'',gate:'referenced profile cannot be deleted'},
 {name:'atomic failure corrupts prior store',file:store,from:'fs.renameSync(temporary,file);committed=true;',to:"fs.writeFileSync(file,'{}');fs.renameSync(temporary,file);committed=true;",gate:'failed atomic commit keeps prior JSON intact'},
 {name:'row overrides do not apply',file:execution,from:'...dataFields(row.overrides??{})',to:'...{}',gate:'row override wins'},
 {name:'matrix silently expands without explicit intent',file:execution,from:"if(request.mode!=='matrix'&&data.length>1)",to:'if(false)',gate:'Cartesian expansion must be explicit'},
 {name:'foreign runtime selection accepted',file:execution,from:'if(selected.applicationId!==scope.applicationId||selected.environmentId!==scope.environmentId)',to:'if(false)',gate:'Missing expected exception'},
 {name:'missing data becomes a runtime failure',file:'ai/test-data/values.ts',from:'DATA_CONFIGURATION_FAILURE: Required data field',to:'RUNTIME_FAILURE: Required data field',gate:'missing data is a configuration failure'},
 {name:'profile secret omitted from diagnostic redaction',file:'ai/diagnostics/artifacts.ts',from:'...credentialSecrets(), ',to:'',gate:'Expected values to be strictly equal'},
 {name:'screenshots expose rendered credentials',file:'ai/diagnostics/artifacts.ts',from:'...values.map(value => frame.getByText(value,{exact:false}))',to:'',fixture:'ai/dashboard/test-data.security.fixture.ts',gate:'screenshots mask rendered profile usernames and passwords'},
 {name:'recorded username emitted in authentication code',file:'ai/autocode/from-recording.ts',from:"${credentialFixture}.${action.redacted ? 'password' : 'email'}",to:"${action.redacted ? credentialFixture+'.password' : literal(action.value??'')}",fixture:'ai/autocode/user-confirmed-auth.fixture.ts',gate:'FAIL explicit methods execute every auth control'},
 {name:'recorded password emitted in authentication code',file:'ai/autocode/from-recording.ts',from:"${credentialFixture}.${action.redacted ? 'password' : 'email'}",to:"${action.redacted ? literal(action.value??'') : credentialFixture+'.email'}",fixture:'ai/autocode/user-confirmed-auth.fixture.ts',gate:'FAIL explicit methods execute every auth control'},
 {name:'execution override overwrites saved Examples',file:execution,from:'return plan;',to:"if(request.mode!=='examples')require('./store').updateTestData(scope,catalog.version,{kind:'examples',testCaseId:testCaseIds[0],rows:[]});return plan;",gate:'execution override never changes saved Examples'},
 {name:'profile browser inherits authenticated storage',file:'tests-e2e/support/base-fixtures.ts',from:'page: async ({ page, executionProfile }, use) => {',to:"page: async ({ page, executionProfile }, use) => { if(executionProfile)await page.context().addCookies([{name:'prior-profile',value:'reused',url:activeScope().baseUrl}]);",fixture:'ai/dashboard/test-data.browser.fixture.ts',args:['--runtime'],gate:'browser instance starts with independent storage'},
 {name:'quarantine writes decrypted profile credentials',file:'ai/dashboard/server.ts',from:'manifest.executionProfile=record.executionProfile;',to:'manifest.executionProfile={...record.executionProfile,appCredentials:resolveExecutionData(scope,record.executionSelection!).appCredentials};',fixture:'ai/dashboard/test-data.browser.fixture.ts',args:['--runtime'],gate:'quarantine never stores decrypted credentials'},
 {name:'profile dialog requires a secure-context UUID API',file:'ai/dashboard/public/test-data.js',from:'const controlId=()=>String(++controlSequence);',to:'const controlId=()=>crypto.randomUUID();',fixture:'ai/dashboard/test-data.browser.fixture.ts',args:['--http-hostname'],gate:'Add Credential Profile opens its form'},
];
const choice=process.argv.find(a=>a.startsWith('--mutant='));
if(!choice&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
 for(let i=0;i<mutants.length;i++){const child=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:300000});assert.equal(child.status,0,`Mutation ${i} did not produce its expected behavioral failure.`);}
 console.log(`PASS ${mutants.length} Test Data mutants killed`);
}else{
 require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
 const mutant=mutants[Number(choice?.split('=')[1])];assert.ok(mutant);const before=fs.readFileSync(mutant.file,'utf8');assert.ok(before.includes(mutant.from),'Missing mutation anchor: '+mutant.name);
 try{let corrupted=before.replace(mutant.from,mutant.to);if(mutant.from2){assert.ok(corrupted.includes(mutant.from2));corrupted=corrupted.replace(mutant.from2,mutant.to2!);}fs.writeFileSync(mutant.file,corrupted);const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',mutant.fixture??'ai/dashboard/test-data.fixture.ts',...(mutant.args??[])],{encoding:'utf8',windowsHide:true,timeout:240000});const output=result.stdout+result.stderr;assert.notEqual(result.status,0,'SURVIVED '+mutant.name);assert.ok(!/TransformError|Cannot find module|SyntaxError/.test(output),'Invalid mutation: '+output);assert.ok(output.includes(mutant.gate),'Wrong failure for '+mutant.name+': '+output);console.log('KILLED '+mutant.name);}
 finally{fs.writeFileSync(mutant.file,before);}
}
