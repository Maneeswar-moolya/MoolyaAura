import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';

// Real gate, synthetic child: a configuration failure must never launch Playwright.
const registryFile = process.env.AURA_REGISTRY_FILE!;
const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
const application = registry.applications.find((app:any) => app.applicationId === 'fixtureapp');
application.environments.second = {baseUrl:'https://second.example.invalid/'};
delete application.defaultSourceEnvironmentId;
fs.writeFileSync(registryFile, JSON.stringify(registry));
delete process.env.AURA_SOURCE_ENVIRONMENT;
delete process.env.AURA_EXECUTION_CONTEXT;
const scope = require('./scope').resolveScope({applicationId:'fixtureapp'});
const file = path.join(scope.paths.generatedDir, 'TC_CONTEXT.spec.ts');
fs.mkdirSync(path.dirname(file), {recursive:true});
fs.writeFileSync(file, `import {test, expect} from '../../support/base-fixtures';
test('TC_CONTEXT - Shows ready state', async ({page, step, trace}) => {
  trace({testCaseId:'TC_CONTEXT', scenario:'Shows ready state', module:'Context'});
  await step('Ready state is visible', async () => {
    await expect(page.getByRole('heading', {name:'Ready'})).toBeVisible();
  });
});`);
let launches = 0;
const spawn = childProcess.spawnSync;
childProcess.spawnSync = (() => { launches++; return {status:1,stdout:'',stderr:'Synthetic launch must not be reached'}; }) as any;
try {
  const result = require('../autocode/verify').gate(file, 'TC_CONTEXT', 'Shows ready state', application.workbooks[0]);
  assert.equal(result.detail.code, 'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE', JSON.stringify(result));
  assert.equal(launches, 0, 'missing source must fail before any browser or generated action');
  console.log('PASS missing source fails preflight without launching a child');
} finally { childProcess.spawnSync = spawn; }

const contextModule=require('./execution-context') as typeof import('./execution-context');
const {resolveExecutionContext,defaultSourceEnvironment,executionEnvironment,executionContextFromTransport}=contextModule;
const {readTestData,updateTestData,testDataFile}=require('../test-data/store') as typeof import('../test-data/store');
const {executionPlan}=require('../test-data/execution') as typeof import('../test-data/execution');
let checks=1;
function check(name:string,run:()=>void){try{run();checks++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name);throw error;}}
check('target default is not an implicit source default',()=>assert.equal(defaultSourceEnvironment(application),undefined));
check('configured source default selected independently',()=>assert.equal(resolveExecutionContext(scope,{},undefined,{...registry,applications:[{...application,defaultSourceEnvironmentId:'second'}]}).sourceEnvironmentId,'second'));
check('singleton source supported',()=>assert.equal(defaultSourceEnvironment({...application,environments:{qa:application.environments.qa}}),'qa'));
check('invalid source refused',()=>assert.throws(()=>resolveExecutionContext(scope,{sourceEnvironmentId:'absent'}),/SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE/));
registry.applications.push({applicationId:'foreign',displayName:'Foreign',defaultEnvironmentId:'foreign-only',environments:{'foreign-only':{baseUrl:'https://foreign.example.invalid/'}},workbooks:[]});
fs.writeFileSync(registryFile,JSON.stringify(registry));
check('another application source refused',()=>assert.throws(()=>resolveExecutionContext(scope,{sourceEnvironmentId:'foreign-only'}),/SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE/));
check('foreign context refused even with same source name',()=>assert.throws(()=>resolveExecutionContext(scope,{applicationId:'foreign',sourceEnvironmentId:'qa'}),/another application/));
check('incompatible browser channel refused',()=>assert.throws(()=>resolveExecutionContext(scope,{sourceEnvironmentId:'qa',browserEngine:'webkit',browserChannel:'chrome'}),/BROWSER_CONFIGURATION_FAILURE/));
check('timeout policy cannot be overridden',()=>assert.throws(()=>resolveExecutionContext(scope,{sourceEnvironmentId:'qa',locatorTimeoutMs:80000}),/timeout policy/));
let catalog=readTestData(scope);
for(const name of ['First account','Second account'])catalog=updateTestData(scope,catalog.version,{kind:'credential',profile:{name,environments:{qa:{username:'synthetic@example.invalid',password:'synthetic-only-secret'}}}});
const selected=executionPlan(scope,['TC_CONTEXT'],{mode:'selected',credentialProfileIds:catalog.credentialProfiles.map(profile=>profile.id),expectedVersion:catalog.version});
const contexts=selected.map(item=>resolveExecutionContext(scope,{sourceEnvironmentId:'second',browserEngine:'chromium',browserChannel:'chrome',headed:true},item.selection));
check('two users produce independent rows without switching source or target',()=>{
  assert.equal(contexts.length,2);assert.notEqual(contexts[0].credentialProfileId,contexts[1].credentialProfileId);
  for(const context of contexts){assert.equal(context.sourceEnvironmentId,'second');assert.equal(context.environmentId,'qa');assert.equal(context.headed,true);assert.equal(context.browserChannel,'chrome');assert.equal(context.locatorTimeoutMs,40000);}
});
check('context resolves credentials from target while source differs',()=>assert.ok(contexts.every(context=>context.credentialProfileId)));
check('context rejects mismatched row/profile instead of mixing credentials',()=>assert.throws(()=>resolveExecutionContext(scope,contexts[0],selected[1].selection),/disagree/));
const diskBefore=fs.readFileSync(testDataFile(scope),'utf8');
check('changing source does not switch or persist credential selection',()=>{
  const changed=resolveExecutionContext(scope,{...contexts[0],sourceEnvironmentId:'qa'},selected[0].selection);
  assert.equal(changed.credentialProfileId,contexts[0].credentialProfileId);assert.equal(fs.readFileSync(testDataFile(scope),'utf8'),diskBefore);
});
check('transport roundtrip retains the entire context',()=>{
  Object.assign(process.env,executionEnvironment(contexts[0],selected[0].selection));
  assert.deepEqual(executionContextFromTransport(scope,selected[0].selection),contexts[0]);
});
check('Playwright config consumes headed mode and installed channel',()=>{
  const config=require('../../playwright.excel.config').default;
  assert.equal(config.use.headless,false);assert.equal(config.projects[0].use.channel,'chrome');assert.equal(config.use.actionTimeout,40000);
});
delete process.env.AURA_EXECUTION_SELECTION;delete process.env.AURA_EXECUTION_CONTEXT;delete process.env.AURA_SOURCE_ENVIRONMENT;
const launched:any[]=[];
childProcess.spawnSync=((_node:any,args:any,options:any)=>{
  if(!options?.env?.PLAYWRIGHT_JSON_OUTPUT_NAME)return spawn(_node,args,options);
  launched.push({args,env:options.env});
  const failed=fs.readFileSync(file,'utf8').includes('.toBeHidden(');
  const results={suites:[{specs:[{title:'TC_CONTEXT - Shows ready state',file,tests:[{projectName:'chromium',status:failed?'unexpected':'expected',results:[{status:failed?'failed':'passed',duration:1,error:failed?{message:'expect(locator).toBeHidden assertion failed'}:undefined}]}]}]}]};
  fs.writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_NAME,JSON.stringify(results));
  return {status:failed?1:0,stdout:'',stderr:''};
}) as any;
try {
  const result=require('../autocode/verify').gate(file,'TC_CONTEXT','Shows ready state',application.workbooks[0],undefined,{executionContext:contexts[0],executionSelection:selected[0].selection});
  check('real gate runs clean and assertion mutation using the explicit context',()=>{assert.equal(result.verdict,'accepted',JSON.stringify(result));assert.equal(launched.length,2);});
  check('both Playwright children receive source distinct from target, headed and channel',()=>{
    for(const run of launched){assert.equal(run.env.AURA_SOURCE_ENVIRONMENT,'second');assert.equal(run.env.AURA_ENVIRONMENT,'qa');assert.ok(run.args.includes('--headed'));assert.ok(run.args.includes('--project=chromium'));assert.deepEqual(JSON.parse(run.env.AURA_EXECUTION_CONTEXT),contexts[0]);}
  });
  check('clean and mutation manifests retain context',()=>{
    for(const ref of [result.detail.diagnostics,result.detail.mutationDiagnostics]){
      const manifest=JSON.parse(fs.readFileSync(path.join(require('../diagnostics/artifacts').diagnosticRoot(scope),ref,'manifest.json'),'utf8'));
      assert.deepEqual(manifest.executionContext,contexts[0]);assert.equal(manifest.sourceEnvironmentId,'second');
    }
  });
} finally {childProcess.spawnSync=spawn;}
console.log(`${checks} execution context behavioral checks passed`);
