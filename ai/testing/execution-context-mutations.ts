/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const unit='ai/projects/execution-context.fixture.ts',browser='ai/dashboard/execution-context.browser.fixture.ts',quarantine='ai/dashboard/quarantine-workspace.fixture.ts';
const quarantineBrowser='ai/dashboard/quarantine-browser.fixture.ts';
const mutants=[
  {name:'source context dropped before recorded gate',file:'ai/autocode/orchestrate.ts',from:'log,{runId,executionContext,executionSelection});',to:'log,{runId,executionSelection});',fixture:browser,marker:'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE'},
  {name:'source lost before Playwright child',file:'ai/projects/execution-context.ts',from:'AURA_EXECUTION_CONTEXT:JSON.stringify(context)',to:'AURA_EXECUTION_CONTEXT:JSON.stringify({...context,sourceEnvironmentId:undefined})',fixture:unit,marker:'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE'},
  {name:'source silently replaced with target',file:'ai/projects/execution-context.ts',from:'const sourceEnvironmentId = input.sourceEnvironmentId ?? defaultSourceEnvironment(application);',to:'const sourceEnvironmentId = scope.environmentId;',fixture:unit,marker:'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE'},
  {name:'credential profile changes source',file:'ai/projects/execution-context.ts',from:'environmentId:scope.environmentId, sourceEnvironmentId,',to:'environmentId:scope.environmentId, sourceEnvironmentId:selection ? selection.environmentId : sourceEnvironmentId,',fixture:unit,marker:'FAIL two users produce independent rows'},
  {name:'quarantine loses original source',file:'ai/dashboard/quarantine-workspace.ts',from:'sourceEnvironmentId:loaded.original.sourceEnvironmentId??original.sourceEnvironmentId,',to:'sourceEnvironmentId:undefined,',fixture:quarantine,args:['--phase=package'],marker:'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE'},
  {name:'headed mode lost on quarantine rerun',file:'ai/dashboard/quarantine-workspace.ts',from:'JSON.stringify({runId,executionContext:context,executionSelection:selected?.selection})',to:'JSON.stringify({runId,executionContext:{...context,headed:false},executionSelection:selected?.selection})',fixture:quarantine,args:['--phase=rerun'],marker:'false !== true'},
  {name:'quarantine rerun workspace drops the approved browser mode',file:'ai/dashboard/public/quarantine-workspace.js',from:"headed:mode.value==='headed'",to:'headed:false',fixture:quarantineBrowser,marker:'quarantine rerun sends the approved Headed mode'},
  {name:'quarantine rerun workspace drops the selected source environment',file:'ai/dashboard/public/quarantine-workspace.js',from:'sourceEnvironmentId:source.value,',to:'',fixture:quarantineBrowser,marker:'quarantine rerun sends the selected Source Environment'},
  {name:'legacy package prefills a source it never recorded',file:'ai/dashboard/public/quarantine-workspace.js',from:"? (details.rerunSourceEnvironmentId||'')",to:'? (details.rerunSourceEnvironmentId||details.environmentId)',fixture:quarantineBrowser,marker:'a legacy package never prefills a source it never recorded'},
  {name:'legacy rerun selection recorded as historical metadata',file:'ai/dashboard/quarantine-workspace.ts',from:"    ? 'USER_SELECTED_FOR_RERUN'",to:"    ? 'ORIGINAL_EXECUTION'",fixture:quarantine,args:['--phase=legacy'],marker:'never labelled original or inherited'},
  {name:'legacy original backfilled from the target environment',file:'ai/dashboard/quarantine-workspace.ts',from:'return !original.sourceEnvironmentId && !original.executionContext?.sourceEnvironmentId;',to:'return false;',fixture:quarantine,args:['--phase=legacy'],marker:'legacy package is reported as missing its source'},
  {name:'retained shared framework overlaid during current-framework validation',file:'ai/dashboard/quarantine-workspace.ts',from:"if(executionBasis==='CURRENT_FRAMEWORK_VALIDATION'&&ownership==='SHARED_FRAMEWORK'){",to:'if(false){',fixture:quarantine,args:['--phase=basis'],marker:'current-framework validation executed the CURRENT shared framework'},
  {name:'historical replay silently upgraded to current framework',file:'ai/dashboard/quarantine-workspace.ts',from:"if(executionBasis==='CURRENT_FRAMEWORK_VALIDATION'&&ownership==='SHARED_FRAMEWORK'){",to:"if(ownership==='SHARED_FRAMEWORK'){",fixture:quarantine,args:['--phase=basis'],marker:'historical replay executed the RETAINED shared framework'},
  {name:'historical replay can grant promotion eligibility',file:'ai/dashboard/quarantine-workspace.ts',from:"eligible:verdict.verdict==='accepted'&&executionBasis==='CURRENT_FRAMEWORK_VALIDATION'},null,2)",to:"eligible:verdict.verdict==='accepted'},null,2)",fixture:quarantine,args:['--phase=basis'],marker:'a historical replay can never grant eligibility'},
  {name:'unknown dependency ownership defaulted instead of refused',file:'ai/dashboard/code-workspace.ts',from:"return kind ? OWNERSHIP[kind] ?? null : null;",to:"return kind ? OWNERSHIP[kind] ?? 'SHARED_FRAMEWORK' : 'SHARED_FRAMEWORK';",fixture:quarantine,args:['--phase=basis'],marker:'an unclassifiable dependency is UNKNOWN, never defaulted'},
  {name:'reproduction-only label dropped from a historical replay',file:'ai/dashboard/quarantine-workspace.ts',from:"...(executionBasis==='HISTORICAL_REPLAY'?{resultLabel:'REPRODUCTION_ONLY' as const}:{})",to:'...({})',fixture:quarantine,args:['--phase=basis'],marker:'a replay is labelled reproduction only'},
  {name:'quarantine workspace stops sending its execution basis',file:'ai/dashboard/public/quarantine-workspace.js',from:'headed:mode.value===\'headed\',executionBasis:chosenBasis()',to:"headed:mode.value==='headed'",fixture:quarantineBrowser,marker:'the workspace sends the execution basis it displayed'},
  {name:'promotion reverts to one universal historical-snapshot rule',file:'ai/dashboard/quarantine-workspace.ts',
    from:"  drift(run.currentFrameworkArtifacts,'FRAMEWORK_CHANGED_AFTER_VALIDATION',false);",
    to:"  for(const [file,version]of Object.entries(loaded.original.liveVersions)){if(file===loaded.original.entry)continue;const t=path.resolve(ROOT,file);const a=fs.existsSync(t)?hashContent(fs.readFileSync(t,'utf8')):null;if(a!==version&&a!==hashContent(loaded.revision.files[file]??''))throw Error('A dependency changed after this quarantine snapshot.');}",
    fixture:quarantine,args:['--phase=promotion-gate'],marker:'current-framework validation must not be refused merely for differing from the historical package'},
  {name:'framework drift after validation accepted',file:'ai/dashboard/quarantine-workspace.ts',
    from:"  drift(run.currentFrameworkArtifacts,'FRAMEWORK_CHANGED_AFTER_VALIDATION',false);",to:'',
    fixture:quarantine,args:['--phase=promotion-gate'],marker:'FRAMEWORK_CHANGED_AFTER_VALIDATION'},
  {name:'application drift after validation accepted',file:'ai/dashboard/quarantine-workspace.ts',
    from:"  drift(run.retainedApplicationArtifacts,'APPLICATION_CHANGED_AFTER_VALIDATION',true);",to:'',
    fixture:quarantine,args:['--phase=promotion-gate'],marker:'APPLICATION_CHANGED_AFTER_VALIDATION'},
  {name:'dependency refresh reuses the revision instead of creating one',file:'ai/dashboard/quarantine-workspace.ts',
    from:'const refreshedState={...revisionState(loaded.state),revisionId:next}',
    to:'const refreshedState={...revisionState(loaded.state),revisionId:loaded.state.revisionId}',
    fixture:quarantine,args:['--phase=promotion-gate'],marker:'a refresh creates a new revision'},
  {name:'dependency refresh keeps eligibility from the previous revision',file:'ai/dashboard/quarantine-workspace.ts',
    from:'const refreshedState={...revisionState(loaded.state),revisionId:next}',
    to:'const refreshedState={...loaded.state,revisionId:next}',
    fixture:quarantine,args:['--phase=promotion-gate'],marker:'a new revision resets eligibility'},
  {name:'shared framework offered for refresh into the draft',file:'ai/dashboard/quarantine-workspace.ts',
    from:"    if(dependencyOwnership(scope,file)!=='APPLICATION_OWNED')continue;",to:"    if(dependencyOwnership(scope,file)==='TEST_OWNED')continue;",
    fixture:quarantine,args:['--phase=promotion-gate'],marker:'only the application-owned dependency is reported as drifted'},
  {name:'out-of-graph application file admitted to a refresh',file:'ai/dashboard/quarantine-workspace.ts',
    from:"  if(!graph.files.some(item=>item.id===file))return {ok:false,reason:'NOT_IN_CASE_DEPENDENCY_GRAPH'};",to:'',
    fixture:quarantine,args:['--phase=refresh-contract'],marker:'an application file outside this case graph is not refreshable'},
  {name:'protected non-editable artifact admitted to a refresh',file:'ai/dashboard/quarantine-workspace.ts',
    from:"  if(!promotionWritable(scope,graph,file))return {ok:false,reason:'PROTECTED_NON_EDITABLE_ARTIFACT'};",to:'',
    fixture:quarantine,args:['--phase=refresh-contract'],marker:'an in-graph but non-editable application artifact is not refreshable'},
  {name:'refresh predicate drifts from the promotion write contract',file:'ai/dashboard/quarantine-workspace.ts',
    from:'  return !!node?.editable||path.resolve(ROOT,file)===manualStatusPath(scope)',to:'  return !!node||path.resolve(ROOT,file)===manualStatusPath(scope)',
    fixture:quarantine,args:['--phase=refresh-contract'],marker:'an in-graph but non-editable application artifact is not refreshable'},
  {name:'unpromotable inherited files retained in the corrected revision',file:'ai/dashboard/quarantine-workspace.ts',
    from:'    if(verdict.ok)files[file]=text;else dropped.push({path:file,reason:verdict.reason});',to:'    files[file]=text;',
    fixture:quarantine,args:['--phase=refresh-contract'],marker:'the unpromotable inherited file is reported as dropped'},
  {name:'refresh drift stops classifying and offers everything',file:'ai/dashboard/quarantine-workspace.ts',
    from:'if(verdict.ok)drifted.push(',to:'if(true)drifted.push(',
    fixture:quarantine,args:['--phase=refresh-contract'],marker:'only promotable case dependencies are offered'},
  {name:'missing source mislabeled runtime failure',file:'ai/autocode/verify.ts',from:"if(detail.code==='RUNTIME_FAILURE')detail.code='EXECUTION_CONFIGURATION_FAILURE';",to:"detail.code='RUNTIME_FAILURE';",fixture:unit,marker:'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE'},
  {name:'another application source accepted',file:'ai/projects/execution-context.ts',from:'!Object.hasOwn(application.environments, sourceEnvironmentId)',to:'!registry.applications.some(app=>Object.hasOwn(app.environments,sourceEnvironmentId))',fixture:unit,marker:'FAIL another application source refused'},
];
const selected=process.argv.find(arg=>arg.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let index=0;index<mutants.length;index++){
    const result=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${index}`],{stdio:'inherit',windowsHide:true,timeout:900000});
    assert.equal(result.status,0,`Mutation ${index}: ${result.error??''}`);
  }
  console.log(`PASS ${mutants.length} execution context mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant=mutants[Number(selected?.split('=')[1])];assert.ok(mutant);
  const original=fs.readFileSync(mutant.file,'utf8');assert.ok(original.includes(mutant.from),'Mutation anchor: '+mutant.name);
  try{
    fs.writeFileSync(mutant.file,original.replace(mutant.from,mutant.to));
    const result=spawnSync(process.execPath,[require.resolve('tsx/cli'),mutant.fixture,...(mutant.args??[])],{encoding:'utf8',timeout:840000,windowsHide:true});
    assert.ok(!result.error,`${mutant.name}: ${result.error}`);
    assert.notEqual(result.status,0,'SURVIVED '+mutant.name);
    assert.ok((result.stdout+result.stderr).includes(mutant.marker),'Wrong failure for '+mutant.name+': '+result.stdout+result.stderr);
    console.log('KILLED '+mutant.name);
  }finally{fs.writeFileSync(mutant.file,original);}
}
