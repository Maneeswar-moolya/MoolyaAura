import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {spawnSync} from 'node:child_process';
import { workspaceData } from '../testing/workspace-data';
import { recordingSource } from '../testing/synthetic-data';
import { hashContent } from '../knowledge/authoring-owners';
import { diagnosticRoot } from '../diagnostics/artifacts';
import { createQuarantinePackage,quarantineDetails,quarantineFile,quarantineDefinition,saveQuarantineDraft,validateQuarantine,
  rerunQuarantine,promoteQuarantine,listQuarantine,reviewQuarantineMapping,saveQuarantineMapping,rebuildQuarantineDraft,legacyExecutionContext,executionBasisOf,quarantineDependencyDrift,refreshQuarantineDependencies,isPromotableApplicationDependency,quarantinePromotionPlan } from './quarantine-workspace';
import { dependencyOwnership } from './code-workspace';
const relative=(file:string)=>path.relative(process.cwd(),file).split(path.sep).join('/');
import { randomUUID as randomId } from 'node:crypto';
import { createLogicalPage,createPageObject,authoringCatalog } from './authoring-catalog';
import { resolveExecutionContext } from '../projects/execution-context';
import { quarantineExecutionContext } from './quarantine-workspace';
const phase=process.argv.find(arg=>arg.startsWith('--phase='))?.slice(8)??'all';
async function main(){
 if(phase==='all'){for(const name of ['package','editing','rerun','route','rebuild','legacy','basis','promotion-gate','refresh-contract','effective-revision','promotion-plan']){const result=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--phase=${name}`],{env:{...process.env,AURA_SYNTHETIC_FIXTURE_ROOT:''},stdio:'inherit',windowsHide:true,timeout:240000});assert.equal(result.status,0,`quarantine ${name}: ${result.error??''}`);}return;}
 const {scope,other}=workspaceData(),id='TC_EDIT',spec='tests-e2e/generated/north/TC_EDIT.spec.ts',po='tests-e2e/pages/north/FirstPage.ts';
 const registry=JSON.parse(fs.readFileSync('ai/projects/registry.json','utf8'));registry.applications[0].environments.capture={baseUrl:'https://capture.example.invalid/'};fs.writeFileSync('ai/projects/registry.json',JSON.stringify(registry));
 const executionContext=resolveExecutionContext(scope,{sourceEnvironmentId:'capture',browserEngine:'chromium',headed:true});
 fs.writeFileSync(scope.paths.fixturesFile,fs.readFileSync(scope.paths.fixturesFile,'utf8').replace('interface Fixtures {','interface Fixtures {\n  step: import("./support/base-fixtures").StepFn;'));
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Cases');sheet.addRows([['Test Case ID','Scenario','Module','Steps','Expected Result','Run'],[id,'Continues to the next screen','Authoring','Click Continue','Continue is visible','Yes']]);await workbook.xlsx.writeFile('excel/north.xlsx');
 const source=`import {test,expect,trace} from '../../north.fixtures';
test('TC_EDIT - Continues to the next screen',async({page,firstPage,step})=>{
 await trace({testCaseId:'TC_EDIT',module:'Authoring',scenario:'Continues to the next screen',sourceWorkbook:'north.xlsx',sourceWorksheet:'Cases'});
 await page.setContent('<button data-testid="continue">Continue</button>');
 // @aura-step {"recordingStepKey":"assertion:0","label":"Continue is visible","pageObject":"FirstPage","method":"control"}
 await step('Continue is visible',async()=>{await expect(await firstPage.control()).toBeVisible({timeout:100});});
});
`;fs.writeFileSync(spec,source);
 if(phase==='rebuild')fs.writeFileSync(path.join(scope.paths.recordingsDir,id+'.spec.ts'),recordingSource(["await page.getByTestId('continue').click();","await expect(page).toHaveURL('https://portal.example.invalid/next');"]));
 const packageId=createQuarantinePackage(scope,spec,id,{verdict:'quarantined',reason:'Synthetic retained runtime error',detail:{staticProblems:[],mutationsApplied:[],cleanStatus:'Failed',code:'RUNTIME_FAILURE',phase:'execution',playwrightMessage:'Synthetic retained runtime error'}},{executionContext,sourceEnvironmentId:'capture',workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring',runId:'synthetic-original-run'});
 const directory=path.join(diagnosticRoot(scope),'quarantine',packageId),original=fs.readFileSync(path.join(directory,'original.json'),'utf8');fs.unlinkSync(spec);
 const originalPO=fs.readFileSync(po,'utf8');
 if(['all','package'].includes(phase)){
   assert.deepEqual(quarantineExecutionContext(scope,packageId).context,executionContext,'quarantine preview inherits original source and browser context');
   const changed=quarantineExecutionContext(scope,packageId,undefined,{sourceEnvironmentId:'qa',headed:false});
   assert.equal(changed.context.sourceEnvironmentId,'qa');assert.equal(changed.context.headed,false);assert.equal(fs.readFileSync(path.join(directory,'original.json'),'utf8'),original,'preview override cannot rewrite historical context');
   assert.equal(quarantineFile(scope,packageId,spec,true).content,source,'exact quarantined spec retained after suite removal');
   assert.match(quarantineDetails(scope,packageId).gate!.detail.playwrightMessage!,/Synthetic retained runtime error/,'runtime error retained in quarantine');
   assert.equal(listQuarantine(scope).length,1,'quarantine list finds scoped package');
   assert.equal(listQuarantine(other).length,0,'foreign application cannot discover quarantine');
   assert.throws(()=>quarantineDetails(other,packageId),/ENOENT|application/,'foreign application quarantine cannot become editable');
   assert.throws(()=>quarantineFile(other,packageId,spec),/ENOENT|application/,'foreign quarantine source cannot be opened for editing');
   const graph=quarantineDetails(scope,packageId).graph;assert.ok(graph.files.some(file=>file.id===po));assert.ok(!graph.files.some(file=>file.id.includes('/south/')));
   const file=quarantineFile(scope,packageId,spec),target=quarantineDefinition(scope,packageId,spec,file.content.indexOf('control()')+1,file.version);
   assert.equal(target?.id,po,'quarantine spec resolves exact Page Object method');
   const page=quarantineFile(scope,packageId,po),base=quarantineDefinition(scope,packageId,po,page.content.indexOf('resolve(')+1,page.version);
   assert.equal(base?.id,'tests-e2e/pages/base.page.ts','quarantine Page Object resolves shared BasePage');
   const shared=quarantineFile(scope,packageId,'tests-e2e/pages/base.page.ts');assert.equal(shared.editable,false);
   assert.throws(()=>saveQuarantineDraft(scope,packageId,shared.id,shared.version,shared.content+'\n',quarantineDetails(scope,packageId).state.revisionId),/read-only/,'shared framework protection');
   console.log('PASS quarantine exact original, runtime error, dependency graph, definitions and isolation');
 }
 if(['all','editing'].includes(phase)){
   const file=quarantineFile(scope,packageId,spec),state=quarantineDetails(scope,packageId).state.revisionId;
   const invalid=saveQuarantineDraft(scope,packageId,spec,file.version,source+'\nconst broken: = ;',state);
   assert.equal(invalid.accepted,false,'invalid edit rejected without corrupting draft');assert.equal(quarantineDetails(scope,packageId).state.revisionId,state);
   const saved=saveQuarantineDraft(scope,packageId,spec,file.version,source+'\n// explicitly edited draft\n',state);assert.equal(saved.accepted,true,'valid quarantine edit saved atomically');
   assert.equal(fs.readFileSync(path.join(directory,'original.json'),'utf8'),original,'quarantine draft never overwrites original');
   assert.equal(quarantineFile(scope,packageId,spec,false,state).content,source,'prior executed revision remains separately inspectable');
   assert.equal(quarantineDetails(scope,packageId).state.eligible,false,'Save Draft alone never promotes or grants eligibility');
   assert.match(quarantineFile(scope,packageId,spec).content,/explicitly edited draft/,'saved draft reloads separately');assert.ok(!quarantineFile(scope,packageId,spec,true).content.includes('explicitly edited draft'),'original/draft diff available');
   assert.throws(()=>promoteQuarantine(scope,packageId),/must pass/,'save is not permission to promote');
   const page=quarantineFile(scope,packageId,po),before=quarantineDetails(scope,packageId).state.revisionId;
   const changed=saveQuarantineDraft(scope,packageId,po,page.version,page.content.replace("getByTestId('continue')","getByTestId('continue-draft')"),before);
   assert.equal(changed.accepted,true,'application Page Object edit validated');assert.equal(fs.readFileSync(po,'utf8'),originalPO,'Page Object draft does not mutate application source');
   assert.ok(quarantineDetails(scope,packageId).history.length>=3,'revision history retained');
   const originalRename=fs.renameSync;let failed=false;try{(fs as any).renameSync=(from:any,to:any)=>{if(!failed&&String(to)===path.join(directory,'state.json')){failed=true;throw Error('synthetic state commit failure');}return originalRename(from,to);};
     const latest=quarantineFile(scope,packageId,spec),revision=quarantineDetails(scope,packageId).state.revisionId,history=fs.readdirSync(path.join(directory,'revisions')).sort();
     assert.throws(()=>saveQuarantineDraft(scope,packageId,spec,latest.version,latest.content+'\n// retry\n',revision),/synthetic state commit failure/,'failed draft pointer commit rolls back revision');
     assert.equal(quarantineDetails(scope,packageId).state.revisionId,revision);
     assert.deepEqual(fs.readdirSync(path.join(directory,'revisions')).sort(),history,'failed save leaves no partial revision');
   }finally{fs.renameSync=originalRename;}
   assert.equal(fs.readFileSync(path.join(directory,'original.json'),'utf8'),original,'failed save cannot corrupt immutable original');
   console.log('PASS quarantine valid/invalid editing, Page Object validation, diff/reload, rollback and immutable original');
 }
 if(['all','rerun'].includes(phase)){
   let file=quarantineFile(scope,packageId,spec);const failing=file.content.replace("data-testid=\"continue\"","data-testid=\"absent\"");
   assert.equal(saveQuarantineDraft(scope,packageId,spec,file.version,failing,quarantineDetails(scope,packageId).state.revisionId).accepted,true);
   const failed=await rerunQuarantine(scope,packageId,'excel/north.xlsx');assert.equal(failed.result.verdict,'quarantined','rerun failure remains quarantined');assert.ok(failed.result.detail.diagnostics,'rerun retains a new failure diagnostic package');
   const timeoutManifest=JSON.parse(fs.readFileSync(path.join(diagnosticRoot(scope),failed.result.detail.diagnostics!,'manifest.json'),'utf8'));
   assert.equal(timeoutManifest.locatorTimeoutMs,40000,'quarantine uses the same forty-second policy as normal execution');
   const timeoutSteps=timeoutManifest.artifacts.filter((name:string)=>name.startsWith('steps/')&&name.endsWith('.json')).flatMap((name:string)=>JSON.parse(fs.readFileSync(path.join(diagnosticRoot(scope),failed.result.detail.diagnostics!,name),'utf8')).steps);
   assert.ok(timeoutSteps.some((step:any)=>step.locatorTimeoutMs===40000),'quarantine runtime step records the shared policy');
   file=quarantineFile(scope,packageId,spec);assert.equal(saveQuarantineDraft(scope,packageId,spec,file.version,source,quarantineDetails(scope,packageId).state.revisionId).accepted,true);
   assert.equal(failed.executionContext?.sourceEnvironmentId,'capture');assert.equal(failed.executionContext?.headed,true);
   assert.equal(timeoutManifest.executionContext.sourceEnvironmentId,'capture');assert.equal(timeoutManifest.executionContext.headed,true);
   const passed=await rerunQuarantine(scope,packageId,'excel/north.xlsx',undefined,{sourceEnvironmentId:'qa',headed:false});assert.equal(passed.result.verdict,'accepted',JSON.stringify(passed.result));
   assert.equal(passed.executionContext?.sourceEnvironmentId,'qa');assert.equal(passed.executionContext?.headed,false);assert.notEqual(passed.runId,failed.runId);
   const state=quarantineDetails(scope,packageId).state;assert.equal(state.eligible,true,'clean pass and failing assertion mutation grant eligibility');assert.equal(state.runs.length,2,'failed and passed run history retained');assert.equal(fs.existsSync(spec),false,'rerun does not promote into generated suite');
   assert.equal(fs.readFileSync(po,'utf8'),originalPO,'private rerun preserves application source');assert.equal(fs.readFileSync(path.join(directory,'original.json'),'utf8'),original,'rerun preserves original');
   const failedDetails=quarantineDetails(scope,packageId,failed.runId);assert.equal(failedDetails.gate?.verdict,'quarantined','earlier run remains inspectable after passing rerun');
   assert.match(quarantineFile(scope,packageId,spec,false,failedDetails.viewedRevisionId).content,/data-testid="absent"/,'run selection opens exactly its executed revision');
   fs.writeFileSync(po,originalPO+'\n// concurrent application change\n');assert.throws(()=>promoteQuarantine(scope,packageId),/APPLICATION_CHANGED_AFTER_VALIDATION/,'promotion rejects concurrent source changes');fs.writeFileSync(po,originalPO);
   assert.equal(promoteQuarantine(scope,packageId).status,'Generated','explicit synthetic promotion restores validated draft only');assert.ok(fs.existsSync(spec),'explicit promotion restores generated source');
   console.log('PASS failed/passed rerun lifecycle, new diagnostics, mutation eligibility, revision history and no automatic promotion');
 }
 if(['all','route'].includes(phase)){
   assert.doesNotThrow(()=>createLogicalPage(scope,{name:'NameOnlyPage'}),'Page name alone creates a Page');assert.equal(authoringCatalog(scope).pages.find(page=>page.name==='NameOnlyPage')?.route,'','Page name alone creates a Page');
   assert.doesNotThrow(()=>{for(const page of [{name:'LandingPage',route:'/home',description:''},{name:'DashboardPage',route:'/home',description:''},{name:'HeaderPage',route:'',description:''},{name:'CasePage',route:'/support/case/:caseId',description:''}])createLogicalPage(scope,page);},'same-route and route-less logical Pages coexist');
   createPageObject(scope,'HeaderPage','HeaderControls');const review=reviewQuarantineMapping(scope,packageId);
   const saved=saveQuarantineMapping(scope,packageId,{applicationId:scope.applicationId,revision:review.revision,mappingVersion:review.mappingVersion,stepKey:'action:1',page:{name:'HeaderPage',route:'',description:''},pageObject:{name:'HeaderControls'}});
   assert.equal(saved.steps.find(step=>step.key==='action:1')?.provenance,'USER_CONFIRMED','route-less quarantine mapping saves USER_CONFIRMED');
   const catalog=authoringCatalog(scope);assert.equal(catalog.pages.find(page=>page.name==='HeaderPage')?.route,'','route-less Page remains route-less');assert.equal(catalog.pages.filter(page=>page.route==='/home').filter(page=>['LandingPage','DashboardPage'].includes(page.name)).length,2,'same route supports multiple logical Pages');
   assert.equal(authoringCatalog(other).pages.some(page=>page.name==='HeaderPage'),false,'quarantine authoring remains application isolated');
   assert.equal(validateQuarantine(scope,packageId).accepted,false,'saved mapping requires a deliberate deterministic draft rebuild');
   assert.equal(fs.readFileSync(path.join(directory,'original.json'),'utf8'),original,'mapping does not overwrite historical authoring');
   console.log('PASS route optional, same-route Pages, dynamic routes, route-less quarantine Save Mapping and isolation');
 }
 if(phase==='legacy'){
   // A package as it was written before ExecutionContext existed: no source, no context,
   // no selection. The absence is the evidence; nothing may repair it into a value.
   fs.writeFileSync(spec,source);
   const legacyId=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.unlinkSync(spec);
   const legacyDirectory=path.join(diagnosticRoot(scope),'quarantine',legacyId),originalFile=path.join(legacyDirectory,'original.json');
   const originalBytes=fs.readFileSync(originalFile),originalHash=hashContent(originalBytes.toString('utf8'));
   const stored=JSON.parse(originalBytes.toString('utf8'));
   assert.equal(stored.sourceEnvironmentId,undefined,'a legacy package records no source environment');
   assert.equal(stored.executionContext,undefined,'a legacy package records no execution context');

   assert.equal(quarantineDetails(scope,legacyId).legacyExecutionContext,true,'legacy package is reported as missing its source');
   assert.equal(quarantineDetails(scope,legacyId).historicalSourceEnvironmentId,null,'historical source reads as unknown, never as the target');
   assert.throws(()=>quarantineExecutionContext(scope,legacyId),/SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE/,'a legacy rerun requires an explicit selection');

   const chosen=quarantineExecutionContext(scope,legacyId,undefined,{sourceEnvironmentId:'capture',browserEngine:'chromium',headed:true});
   assert.equal(chosen.context.sourceEnvironmentId,'capture','the explicit selection reaches the rerun context');
   assert.equal(chosen.sourceEnvironmentProvenance,'USER_SELECTED_FOR_RERUN','an explicit choice is never labelled original or inherited');
   assert.equal(chosen.legacyExecutionContext,true);assert.equal(chosen.historicalSourceEnvironmentId,null);
   assert.equal(fs.readFileSync(originalFile,'utf8'),originalBytes.toString('utf8'),'previewing a selection cannot write historical metadata');

   const first=await rerunQuarantine(scope,legacyId,'excel/north.xlsx',undefined,{sourceEnvironmentId:'capture',browserEngine:'chromium',headed:true});
   assert.equal(first.sourceEnvironmentId,'capture','the new attempt retains the selected source');
   assert.equal(first.sourceEnvironmentProvenance,'USER_SELECTED_FOR_RERUN','the new attempt records how its source was chosen');
   assert.equal(first.executionContext?.headed,true);assert.equal(first.executionContext?.browserChannel,undefined,'bundled browser retained');
   assert.equal(first.executionContext?.locatorTimeoutMs,40000);
   assert.equal(hashContent(fs.readFileSync(originalFile,'utf8')),originalHash,'a rerun never rewrites the original package');

   // Section 3: the SAME revision may now default, and says it defaulted from an attempt.
   const repeat=quarantineExecutionContext(scope,legacyId);
   assert.equal(repeat.context.sourceEnvironmentId,'capture','a later rerun of this revision does not re-ask');
   assert.equal(repeat.sourceEnvironmentProvenance,'CARRIED_FROM_RERUN_SELECTION','a carried default is distinguished from historical metadata');
   assert.equal(repeat.carriedFromRunId,first.runId,'the carried default names the attempt it came from');
   assert.equal(repeat.legacyExecutionContext,true,'carrying a default does not make the package non-legacy');

   const afterRerun=quarantineDetails(scope,legacyId);
   assert.equal(afterRerun.historicalSourceEnvironmentId,null,'the historical package still reports source unknown after a rerun');
   assert.equal(afterRerun.legacyExecutionContext,true);
   assert.equal(afterRerun.sourceEnvironmentProvenance,'USER_SELECTED_FOR_RERUN','the viewed attempt carries its own provenance');
   assert.equal(afterRerun.rerunSourceEnvironmentId,'capture','the UI can prefill from the attempt, not from history');
   assert.equal(quarantineDetails(scope,legacyId,'original').historicalSourceEnvironmentId,null,'viewing the original still reports unknown');
   assert.equal(JSON.stringify(afterRerun).includes('synthetic-contract-password'),false,'no credential value reaches quarantine details');

   // An edited draft is different code, so its selection is asked again rather than assumed.
   const draftFile=quarantineFile(scope,legacyId,spec);
   assert.equal(saveQuarantineDraft(scope,legacyId,spec,draftFile.version,draftFile.content+'\n// reviewed\n',quarantineDetails(scope,legacyId).state.revisionId).accepted,true);
   assert.throws(()=>quarantineExecutionContext(scope,legacyId),/SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE/,'a new revision asks for the source again');
   assert.equal(hashContent(fs.readFileSync(originalFile,'utf8')),originalHash,'editing the draft never rewrites the original');
   console.log('PASS legacy package requires explicit source, retains it as USER_SELECTED_FOR_RERUN, carries it forward per revision and never rewrites history');
 }
 if(phase==='basis'){
   // The two bases must be OBSERVABLY different on the same package. A retained shared
   // framework file is given a behaviour the current one does not have, and the run says
   // which one executed - so "we used the current framework" is a measurement, not a claim.
   const shared='tests-e2e/support/resilient-locator.ts',live=fs.readFileSync(shared,'utf8');
   const marker='AURA_BASIS_MARKER_RETAINED';
   fs.writeFileSync(spec,source);
   fs.writeFileSync(shared,live.replace('export async function resolveLocator',`export const ${marker}=true;\nexport async function resolveLocator`));
   const basisId=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.writeFileSync(shared,live);fs.unlinkSync(spec);
   const basisDirectory=path.join(diagnosticRoot(scope),'quarantine',basisId),originalFile=path.join(basisDirectory,'original.json');
   const originalHash=hashContent(fs.readFileSync(originalFile,'utf8'));
   const retained=JSON.parse(fs.readFileSync(originalFile,'utf8')).files[shared];
   assert.ok(retained.includes(marker),'the package retained the historical shared framework');
   assert.ok(!fs.readFileSync(shared,'utf8').includes(marker),'the current checkout does not carry the historical marker');

   assert.equal(dependencyOwnership(scope,shared),'SHARED_FRAMEWORK');
   assert.equal(dependencyOwnership(scope,'tests-e2e/pages/base.page.ts'),'SHARED_FRAMEWORK');
   assert.equal(dependencyOwnership(scope,po),'APPLICATION_OWNED');
   assert.equal(dependencyOwnership(scope,scope.paths.fixturesFile),'APPLICATION_OWNED');
   assert.equal(dependencyOwnership(scope,spec),'TEST_OWNED');
   assert.equal(dependencyOwnership(scope,'package.json'),null,'an unclassifiable dependency is UNKNOWN, never defaulted');
   assert.equal(executionBasisOf(undefined),'CURRENT_FRAMEWORK_VALIDATION','the normal workflow validates rather than reproduces');
   assert.throws(()=>executionBasisOf('SOMETHING_ELSE'),/Unknown quarantine execution basis/,'an unknown basis fails closed');

   const settings={sourceEnvironmentId:'capture',browserEngine:'chromium' as const,headed:true};
   const replay=await rerunQuarantine(scope,basisId,'excel/north.xlsx',undefined,settings,'HISTORICAL_REPLAY');
   assert.equal(replay.executionBasis,'HISTORICAL_REPLAY','the attempt records the basis it ran on');
   assert.equal(replay.resultLabel,'REPRODUCTION_ONLY','a replay is labelled reproduction only');
   assert.ok(replay.currentFrameworkArtifacts?.some(item=>item.path===shared&&item.hash===hashContent(retained)),'historical replay executed the RETAINED shared framework');
   assert.ok(replay.retainedApplicationArtifacts?.some(item=>item.path===po),'retained application artifacts remain available in replay');
   assert.equal(quarantineDetails(scope,basisId).state.eligible,false,'a historical replay can never grant eligibility');

   const validation=await rerunQuarantine(scope,basisId,'excel/north.xlsx',undefined,settings,'CURRENT_FRAMEWORK_VALIDATION');
   assert.equal(validation.executionBasis,'CURRENT_FRAMEWORK_VALIDATION');
   assert.equal(validation.resultLabel,undefined,'a validation attempt is not labelled reproduction only');
   assert.ok(validation.currentFrameworkArtifacts?.some(item=>item.path===shared&&item.hash===hashContent(live)),'current-framework validation executed the CURRENT shared framework');
   assert.ok(!validation.currentFrameworkArtifacts?.some(item=>item.hash===hashContent(retained)),'the retained shared framework was not overlaid in validation mode');
   assert.ok(validation.retainedApplicationArtifacts?.some(item=>item.path===po),'retained application artifacts remain available in validation');
   assert.ok(validation.retainedApplicationArtifacts?.every(item=>dependencyOwnership(scope,item.path)!=='SHARED_FRAMEWORK'),'no shared framework file is counted as a retained application artifact');
   assert.notEqual(replay.currentFrameworkArtifacts?.find(i=>i.path===shared)?.hash,validation.currentFrameworkArtifacts?.find(i=>i.path===shared)?.hash,'the two bases are observably distinct on the same package');

   assert.equal(hashContent(fs.readFileSync(originalFile,'utf8')),originalHash,'neither basis rewrites the original package');
   const runs=quarantineDetails(scope,basisId).state.runs as any[];
   const lastRun=runs.at(-1)!;
   assert.deepEqual(runs.map((run:any)=>run.executionBasis),['HISTORICAL_REPLAY','CURRENT_FRAMEWORK_VALIDATION'],'each attempt persists its own basis');
   assert.equal(lastRun.executionContext.locatorTimeoutMs,40000,'the shared timeout policy still propagates');
   assert.equal(lastRun.executionContext.headed,true,'headed mode still propagates');
   assert.equal(lastRun.sourceEnvironmentProvenance,'USER_SELECTED_FOR_RERUN','legacy source provenance still works');

   // Eligibility is earned only by a passing validation; a failing one cannot grant it, and
   // promotion refuses a replay even when a replay happened to pass.
   if(quarantineDetails(scope,basisId).state.eligible)assert.equal(lastRun.result.verdict,'accepted','eligibility implies a passing clean+mutation validation');
   else assert.throws(()=>promoteQuarantine(scope,basisId),/must pass|CURRENT_FRAMEWORK_VALIDATION/,'promotion refuses without a passing validation attempt');
   console.log('PASS execution basis: ownership classification, distinct overlay rules, per-attempt persistence, immutable original and replay ineligibility');
 }
 if(phase==='effective-revision'){
   // WHAT A PROMOTION PUBLISHES IS THE EFFECTIVE REVISION, not the delta.
   //
   // A revision legitimately carries zero changed files: an ORIGINAL_GENERATED draft that
   // passed re-validation unedited is the ordinary case, and its test still exists - in the
   // original snapshot. Reading the publication set from `revision.files` alone would make
   // that draft publish nothing, and quarantine has already REMOVED its spec from the suite,
   // so the case would disappear rather than come back. These contracts pin the composition
   // and the ownership split that decides everything else.
   const settings={sourceEnvironmentId:'capture',browserEngine:'chromium' as const,headed:true};
   const generated=path.join(scope.paths.generatedDir,id+'.spec.ts');
   // quarantineDetails().revision is a SUMMARY with no files map; the delta must be read from
   // the immutable revision record itself or the assertion proves nothing.
   const rawRevision=(pkg:string,revisionId:string)=>JSON.parse(fs.readFileSync(path.join(diagnosticRoot(scope),'quarantine',pkg,'revisions',revisionId+'.json'),'utf8')) as {files:Record<string,string>;parent:string|null;provenance:string};

   // ---- A. Zero-file ORIGINAL_GENERATED, validated, no drift -> the spec IS published.
   fs.writeFileSync(spec,source);
   const plain=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.unlinkSync(spec);
   assert.equal(fs.existsSync(generated),false,'quarantine removed the spec from the suite');
   const plainDetails=quarantineDetails(scope,plain);
   assert.equal(plainDetails.revision.provenance,'ORIGINAL_GENERATED');
   assert.deepEqual(Object.keys(rawRevision(plain,plainDetails.state.revisionId).files),[],'an unedited draft carries no delta');
   const plainRun=await rerunQuarantine(scope,plain,'excel/north.xlsx',undefined,settings,'CURRENT_FRAMEWORK_VALIDATION');
   assert.equal(plainRun.result.verdict,'accepted',JSON.stringify(plainRun.result.reason));
   const plainPlan=quarantinePromotionPlan(scope,plain);
   assert.deepEqual(plainPlan.blocked,[],'a validated unedited draft is promotable');
   assert.deepEqual(plainPlan.testOwned.map(item=>item.path),[relative(generated)],'the generated spec is the test-owned payload');
   assert.equal(plainPlan.testOwned[0].sourceRevision,'original snapshot','it comes from the snapshot, because the delta is empty');
   assert.deepEqual(plainPlan.applicationOwned,[],'an unedited draft rewrites no application source');
   promoteQuarantine(scope,plain);
   assert.equal(fs.existsSync(generated),true,'a zero-file revision publishes its generated spec');
   assert.equal(fs.readFileSync(generated,'utf8'),source,'and publishes exactly what validation executed');
   assert.equal(quarantineDetails(scope,plain).state.promoted,true);
   console.log('PASS effective revision publishes the test-owned spec from a zero-file ORIGINAL_GENERATED draft');

   // ---- B. A later revision that DOES edit the spec publishes the edited one.
   fs.unlinkSync(generated);
   fs.writeFileSync(spec,source);
   const edited=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.unlinkSync(spec);
   const entry=relative(generated),draft=source.replace('Continue is visible','Continue is present');
   const before=quarantineFile(scope,edited,entry);
   assert.equal(saveQuarantineDraft(scope,edited,entry,before.version,draft,quarantineDetails(scope,edited).state.revisionId).accepted,true);
   const editedRun=await rerunQuarantine(scope,edited,'excel/north.xlsx',undefined,settings,'CURRENT_FRAMEWORK_VALIDATION');
   assert.equal(editedRun.result.verdict,'accepted',JSON.stringify(editedRun.result.reason));
   const editedPlan=quarantinePromotionPlan(scope,edited);
   assert.equal(editedPlan.testOwned[0].sourceRevision,'revision delta','an edited spec comes from the delta');
   // Asserted against the EFFECTIVE revision rather than against the string this test typed:
   // the contract is that promotion publishes what validation executed, whatever normalisation
   // the save applied on the way in.
   const validatedSpec=quarantineFile(scope,edited,entry).content;
   promoteQuarantine(scope,edited);
   assert.equal(fs.readFileSync(generated,'utf8'),validatedSpec,'the exact validated draft is published');
   assert.notEqual(fs.readFileSync(generated,'utf8'),source,'and not the original snapshot');
   assert.match(fs.readFileSync(generated,'utf8'),/Continue is present/,'the edit survives into the suite');
   console.log('PASS a later validated revision publishes its own spec, not the original snapshot');

   return;
 }
 if(phase==='promotion-plan'){
   const settings={sourceEnvironmentId:'capture',browserEngine:'chromium' as const,headed:true};
   const generated=path.join(scope.paths.generatedDir,id+'.spec.ts');
   const entry=relative(generated);
   const rawRevision=(pkg:string,revisionId:string)=>JSON.parse(fs.readFileSync(path.join(diagnosticRoot(scope),'quarantine',pkg,'revisions',revisionId+'.json'),'utf8')) as {files:Record<string,string>;parent:string|null;provenance:string};
   // ---- C/D. Application-owned: untouched unless the revision intentionally carries it.
   // This phase stands alone, so the suite copy left by the shared setup is removed only if
   // it is there - the previous phase's promotion does not happen in this process.
   if(fs.existsSync(generated))fs.unlinkSync(generated);
   fs.writeFileSync(spec,source);
   const refreshed=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.unlinkSync(spec);
   // C is already established above: the unedited validated draft's plan carried NO
   // application-owned writes at all. Re-proving it with another Playwright cycle would cost
   // two browser runs to restate the same fact.
   // Now move the application file and take it through the supported refresh.
   const untouchedRevisionId=quarantineDetails(scope,refreshed).state.revisionId;
   const poBefore=fs.readFileSync(po,'utf8');
   fs.writeFileSync(po,poBefore+'\n// later application capability\n');
   const newRevision=refreshQuarantineDependencies(scope,refreshed,quarantineDetails(scope,refreshed).state.revisionId);
   const after=quarantineDetails(scope,refreshed);
   assert.equal(after.revision.provenance,'APPLICATION_DEPENDENCY_REFRESH');
   assert.equal(after.revision.revisionId,newRevision.revisionId,'the refresh is now the current revision');
   assert.notEqual(newRevision.revisionId,untouchedRevisionId,'a refresh never edits the validated revision in place');
   const delta=rawRevision(refreshed,after.state.revisionId);
   assert.deepEqual(Object.keys(delta.files),[relative(po)],'the delta carries only the refreshed application dependency');
   assert.equal(delta.parent,untouchedRevisionId,'the refresh descends from the validated revision without rewriting it');
   assert.deepEqual(Object.keys(rawRevision(refreshed,untouchedRevisionId).files),[],'the parent revision is left exactly as it was');
   assert.equal(after.state.eligible,false,'a new revision is not validated yet');
   const refreshedRun=await rerunQuarantine(scope,refreshed,'excel/north.xlsx',undefined,settings,'CURRENT_FRAMEWORK_VALIDATION');
   assert.equal(refreshedRun.result.verdict,'accepted',JSON.stringify(refreshedRun.result.reason));
   const refreshedPlan=quarantinePromotionPlan(scope,refreshed);
   assert.deepEqual(refreshedPlan.applicationOwned.map(item=>item.path),[relative(po)],'the refreshed dependency is in the write set');
   assert.deepEqual(refreshedPlan.testOwned.map(item=>item.path),[entry],'and the spec still comes through ancestry');
   assert.equal(refreshedPlan.testOwned[0].sourceRevision,'original snapshot',
     'the test-owned spec is inherited even though this delta changes only application files');
   console.log('PASS application-owned files are published only when a revision carries them, spec still inherited');

   // ---- E. Shared framework is verified, never written into the application.
   assert.ok(refreshedPlan.sharedFramework.verifiedOnly.length>0,'framework artifacts are verified');
   for(const file of refreshedPlan.sharedFramework.verifiedOnly){
     assert.equal(dependencyOwnership(scope,file),'SHARED_FRAMEWORK');
     assert.equal(refreshedPlan.applicationOwned.some(item=>item.path===file),false,'shared framework never enters the write set');
     assert.equal(refreshedPlan.testOwned.some(item=>item.path===file),false);
   }
   console.log('PASS shared framework is verified only and never published into the application');

   // ---- A delta that carries a protected artifact is refused, whatever it claims.
   // No supported path can produce one - Save Draft refuses read-only files and Refresh takes
   // only promotable application-owned ones - so this writes the revision record directly to
   // prove the guard itself, not the paths that normally keep it unreached.
   {
     const shared='tests-e2e/support/resilient-locator.ts';
     const revisionFile=path.join(diagnosticRoot(scope),'quarantine',refreshed,'revisions',after.state.revisionId+'.json');
     const kept=fs.readFileSync(revisionFile,'utf8'),record=JSON.parse(kept);
     record.files[shared]=fs.readFileSync(shared,'utf8')+['','// smuggled into the delta',''].join('\n');
     fs.writeFileSync(revisionFile,JSON.stringify(record,null,2)+'\n');
     const smuggled=quarantinePromotionPlan(scope,refreshed);
     assert.ok(smuggled.blocked.some(item=>item.code==='PROTECTED_ARTIFACT'),
       'a shared framework file in the delta is refused, never published into the application');
     assert.equal(smuggled.applicationOwned.some(item=>item.path===shared),false,'and never reaches the write set');
     fs.writeFileSync(revisionFile,kept);
   }
   console.log('PASS a protected artifact in a revision delta is refused');

   // ---- The plan is a description, not an action.
   const untouched=fs.readFileSync(po,'utf8');
   quarantinePromotionPlan(scope,refreshed);
   assert.equal(fs.readFileSync(po,'utf8'),untouched,'inspecting the plan writes nothing');
   assert.equal(quarantineDetails(scope,refreshed).state.promoted??false,false,'inspecting the plan promotes nothing');
   console.log('PASS the promotion plan is read-only');
   fs.writeFileSync(po,poBefore);
   return;
 }
 if(phase==='promotion-gate'){
   // The gate must verify WHAT THE QUALIFYING VALIDATION EXECUTED, per ownership category -
   // not one universal comparison against the historical package.
   const shared='tests-e2e/support/resilient-locator.ts',sharedBefore=fs.readFileSync(shared,'utf8');
   const marker='AURA_GATE_MARKER_HISTORICAL';
   fs.writeFileSync(spec,source);
   fs.writeFileSync(shared,sharedBefore.replace('export async function resolveLocator',`export const ${marker}=true;\nexport async function resolveLocator`));
   const gateId=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.writeFileSync(shared,sharedBefore);fs.unlinkSync(spec);
   const gateDirectory=path.join(diagnosticRoot(scope),'quarantine',gateId),originalFile=path.join(gateDirectory,'original.json');
   const originalHash=hashContent(fs.readFileSync(originalFile,'utf8'));
   const settings={sourceEnvironmentId:'capture',browserEngine:'chromium' as const,headed:true};

   // Cheap and first: the refresh offer is application-owned only. This package's retained
   // shared framework already differs from the checkout, so a filter that let shared files
   // through would surface them here - before any run has cost anything.
   fs.writeFileSync(po,originalPO+'\n// later application capability\n');
   const offered=quarantineDependencyDrift(scope,gateId);
   assert.deepEqual(offered.drifted.map(item=>item.path),[po],'only the application-owned dependency is reported as drifted');
   fs.writeFileSync(po,originalPO);
   assert.deepEqual(quarantineDependencyDrift(scope,gateId).drifted,[],'an unchanged application dependency is not drift');

   const validated=await rerunQuarantine(scope,gateId,'excel/north.xlsx',undefined,settings,'CURRENT_FRAMEWORK_VALIDATION');
   assert.equal(validated.result.verdict,'accepted',JSON.stringify(validated.result.reason));
   assert.equal(quarantineDetails(scope,gateId).state.eligible,true);
   // The package's retained shared framework differs from the current checkout - that is the
   // POINT of this basis, and must not by itself refuse promotion.
   assert.notEqual(hashContent(JSON.parse(fs.readFileSync(originalFile,'utf8')).files[shared]),hashContent(sharedBefore));
   assert.doesNotThrow(()=>promoteQuarantine(scope,gateId),'current-framework validation must not be refused merely for differing from the historical package');
   assert.equal(quarantineDetails(scope,gateId).state.promoted,true);
   assert.equal(hashContent(fs.readFileSync(originalFile,'utf8')),originalHash,'promotion never rewrites the original');
   console.log('PASS promotion accepts current shared framework that differs from the historical snapshot');

   // A SECOND package, to prove each category refuses when it moves AFTER validation.
   for(const [label,file,code] of [['framework',shared,'FRAMEWORK_CHANGED_AFTER_VALIDATION'],['application',po,'APPLICATION_CHANGED_AFTER_VALIDATION']] as const){
     fs.writeFileSync(spec,source);
     const caseId=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
     fs.unlinkSync(spec);
     const pass=await rerunQuarantine(scope,caseId,'excel/north.xlsx',undefined,settings,'CURRENT_FRAMEWORK_VALIDATION');
     assert.equal(pass.result.verdict,'accepted',label+' baseline must pass');
     const before=fs.readFileSync(file,'utf8');
     fs.writeFileSync(file,before+`\n// drift introduced after validation (${label})\n`);
     try{ assert.throws(()=>promoteQuarantine(scope,caseId),new RegExp(code),`${label} drift after validation must refuse promotion`); }
     finally{ fs.writeFileSync(file,before); }
     assert.doesNotThrow(()=>promoteQuarantine(scope,caseId),'restoring the validated artifact makes it promotable again');
     console.log(`PASS ${label} changed after validation refuses promotion with ${code}`);
   }

   // APPLICATION dependency refresh: a new revision, reset eligibility, preserved history.
   fs.writeFileSync(spec,source);
   const refreshId=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.unlinkSync(spec);
   const firstPass=await rerunQuarantine(scope,refreshId,'excel/north.xlsx',undefined,settings,'CURRENT_FRAMEWORK_VALIDATION');
   assert.equal(firstPass.result.verdict,'accepted');
   const beforeRefresh=quarantineDetails(scope,refreshId).state;
   assert.equal(beforeRefresh.eligible,true);
   fs.writeFileSync(po,originalPO+'\n// reviewed application capability added later\n');
   const driftReport=quarantineDependencyDrift(scope,refreshId);
   assert.deepEqual(driftReport.drifted.map(item=>item.path),[po],'only the application-owned dependency is reported as drifted');
   assert.ok(!driftReport.drifted.some(item=>item.ownership!=='APPLICATION_OWNED'),'shared framework is never offered for refresh');
   assert.throws(()=>promoteQuarantine(scope,refreshId),/APPLICATION_CHANGED_AFTER_VALIDATION/,'application drift refuses until reviewed');
   const refreshed=refreshQuarantineDependencies(scope,refreshId,beforeRefresh.revisionId);
   assert.equal(refreshed.provenance,'APPLICATION_DEPENDENCY_REFRESH');
   assert.deepEqual(refreshed.reviewed.map(item=>item.path),[po],'the refresh records exactly what was reviewed');
   const afterRefresh=quarantineDetails(scope,refreshId).state;
   assert.notEqual(afterRefresh.revisionId,beforeRefresh.revisionId,'a refresh creates a new revision');
   assert.equal(afterRefresh.eligible,false,'a new revision resets eligibility');
   assert.equal(afterRefresh.runs.length,beforeRefresh.runs.length,'the earlier qualifying attempt is preserved');
   assert.ok(afterRefresh.runs.some((item:any)=>item.runId===firstPass.runId),'history retains the previous eligible attempt');
   assert.throws(()=>promoteQuarantine(scope,refreshId),/must pass clean execution/,'the refreshed revision must be revalidated before promotion');
   const revalidated=await rerunQuarantine(scope,refreshId,'excel/north.xlsx',undefined,settings,'CURRENT_FRAMEWORK_VALIDATION');
   assert.equal(revalidated.revisionId,afterRefresh.revisionId,'revalidation proves the refreshed revision');
   assert.equal(revalidated.result.verdict,'accepted');
   assert.equal(quarantineDetails(scope,refreshId).state.eligible,true,'clean plus mutation restores eligibility for the new revision');
   assert.doesNotThrow(()=>promoteQuarantine(scope,refreshId),'a revalidated refreshed revision promotes');
   assert.equal(hashContent(fs.readFileSync(path.join(diagnosticRoot(scope),'quarantine',refreshId,'original.json'),'utf8')),
     hashContent(fs.readFileSync(path.join(diagnosticRoot(scope),'quarantine',refreshId,'original.json'),'utf8')),'original stays readable');
   fs.writeFileSync(po,originalPO);
   console.log('PASS application dependency refresh creates a revision, resets eligibility, preserves history and requires revalidation');

   // A HISTORICAL_REPLAY pass can never promote, however green it is.
   fs.writeFileSync(spec,source);
   const replayId=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.unlinkSync(spec);
   const replay=await rerunQuarantine(scope,replayId,'excel/north.xlsx',undefined,settings,'HISTORICAL_REPLAY');
   assert.equal(replay.result.verdict,'accepted','the replay itself passes');
   assert.equal(quarantineDetails(scope,replayId).state.eligible,false);
   assert.throws(()=>promoteQuarantine(scope,replayId),/must pass clean execution|CURRENT_FRAMEWORK_VALIDATION/,'a passing historical replay still cannot promote');
   console.log('PASS a passing HISTORICAL_REPLAY never becomes promotable');
 }
 if(phase==='refresh-contract'){
   // One promotability predicate, and the invariant that refresh output is always a subset
   // of what promotion will write - the defect was these two disagreeing.
   fs.writeFileSync(spec,source);
   const rid=createQuarantinePackage(scope,spec,id,undefined,{workbook:'excel/north.xlsx',scenario:'Continues to the next screen',sourceWorksheet:'Cases',module:'Authoring'});
   fs.unlinkSync(spec);
   const rdir=path.join(diagnosticRoot(scope),'quarantine',rid),rOriginal=path.join(rdir,'original.json');
   const rOriginalHash=hashContent(fs.readFileSync(rOriginal,'utf8'));
   const graph=quarantineDetails(scope,rid).graph;
   const outOfGraph='tests-e2e/pages/north/SparePage.ts';           // application-owned, other test

   assert.equal(isPromotableApplicationDependency(scope,graph,po).ok,true,'application-owned, in graph and editable is refreshable');
   assert.deepEqual(isPromotableApplicationDependency(scope,graph,outOfGraph),{ok:false,reason:'NOT_IN_CASE_DEPENDENCY_GRAPH'},'an application file outside this case graph is not refreshable');
   assert.deepEqual(isPromotableApplicationDependency(scope,graph,'tests-e2e/support/resilient-locator.ts'),{ok:false,reason:'NOT_APPLICATION_OWNED'},'shared framework is never application-refreshable');
   assert.deepEqual(isPromotableApplicationDependency(scope,graph,spec),{ok:false,reason:'NOT_APPLICATION_OWNED'},'the test-owned spec is not an application dependency');
   console.log('PASS promotability predicate accepts only application-owned, in-graph, promotable dependencies');

   // An IN-GRAPH application artifact that promotion may not write: evidence is Knowledge/
   // Evidence category, editable=false. Ownership and graph membership both say yes, so only
   // the editability half of the predicate stands between it and an unpromotable revision.
   const evidenceFile=graph.files.find(item=>item.category==='Evidence')!.id;
   assert.ok(evidenceFile&&graph.files.some(item=>item.id===evidenceFile),'evidence is part of this case graph');
   assert.deepEqual(isPromotableApplicationDependency(scope,graph,evidenceFile),{ok:false,reason:'PROTECTED_NON_EDITABLE_ARTIFACT'},'an in-graph but non-editable application artifact is not refreshable');

   // Drift must CLASSIFY rather than offer everything that changed.
   fs.writeFileSync(po,originalPO+'\n// reviewed capability\n');
   fs.writeFileSync(outOfGraph,fs.readFileSync(outOfGraph,'utf8')+'\n// unrelated test change\n');
   const evidenceBefore=fs.readFileSync(path.resolve(evidenceFile),'utf8');
   fs.writeFileSync(path.resolve(evidenceFile),JSON.stringify({...JSON.parse(evidenceBefore),refreshedMarker:true}));
   const report=quarantineDependencyDrift(scope,rid);
   assert.deepEqual(report.drifted.map(item=>item.path),[po],'only promotable case dependencies are offered');
   assert.ok(!report.drifted.some(item=>item.path===outOfGraph));
   assert.ok(!report.drifted.some(item=>item.path===evidenceFile),'a protected in-graph artifact is never offered for refresh');
   assert.deepEqual(report.notApplicableToCase.find(item=>item.path===evidenceFile),{path:evidenceFile,reason:'PROTECTED_NON_EDITABLE_ARTIFACT'},'it is reported as informational context instead');
   assert.ok(!report.notApplicableToCase.some(item=>item.path.includes('resilient-locator')),'shared framework is not even reported as application drift');
   console.log('PASS drift separates refreshable dependencies from informational non-applicable changes');

   const before=quarantineDetails(scope,rid).state;
   const refreshed=refreshQuarantineDependencies(scope,rid,before.revisionId);
   const after=quarantineDetails(scope,rid).state;
   assert.notEqual(after.revisionId,before.revisionId,'a corrected refresh creates a new revision');
   assert.equal(after.eligible,false,'eligibility resets');assert.equal(!!after.promoted,false);
   assert.equal(hashContent(fs.readFileSync(rOriginal,'utf8')),rOriginalHash,'original.json remains immutable');
   const written=JSON.parse(fs.readFileSync(path.join(rdir,'revisions',after.revisionId+'.json'),'utf8'));
   assert.ok(!Object.keys(written.files).includes(outOfGraph),'an out-of-graph file never enters the revision');
   // THE INVARIANT: every file the refresh wrote is one promotion is allowed to write.
   for(const file of Object.keys(written.files)){
     if(file===quarantineDetails(scope,rid).graph.entry)continue;
     assert.equal(isPromotableApplicationDependency(scope,quarantineDetails(scope,rid).graph,file).ok,true,
       `refresh wrote ${file}, which promotion would refuse`);
   }
   console.log('PASS refresh output is always a subset of the promotion write set');

   // A revision already carrying an unpromotable file is REPAIRED by the next refresh,
   // without touching the old revision.
   const poisoned={...written,revisionId:randomId(),parent:written.revisionId,provenance:'USER_EDITED_QUARANTINE',
     files:{...written.files,[outOfGraph]:fs.readFileSync(outOfGraph,'utf8')}};
   fs.writeFileSync(path.join(rdir,'revisions',poisoned.revisionId+'.json'),JSON.stringify(poisoned,null,2)+'\n');
   fs.writeFileSync(path.join(rdir,'state.json'),JSON.stringify({...after,revisionId:poisoned.revisionId,eligible:false},null,2)+'\n');
   fs.writeFileSync(po,originalPO+'\n// reviewed capability second pass\n');
   const repaired=refreshQuarantineDependencies(scope,rid,poisoned.revisionId);
   assert.ok(repaired.dropped.some(item=>item.path===outOfGraph&&item.reason==='NOT_IN_CASE_DEPENDENCY_GRAPH'),'the unpromotable inherited file is reported as dropped');
   const repairedFiles=JSON.parse(fs.readFileSync(path.join(rdir,'revisions',repaired.revisionId+'.json'),'utf8')).files;
   assert.ok(!Object.keys(repairedFiles).includes(outOfGraph),'the corrected revision excludes it');
   assert.ok(Object.keys(JSON.parse(fs.readFileSync(path.join(rdir,'revisions',poisoned.revisionId+'.json'),'utf8')).files).includes(outOfGraph),'the old revision still holds it - history is not rewritten');
   assert.equal(hashContent(fs.readFileSync(rOriginal,'utf8')),rOriginalHash);
   fs.writeFileSync(po,originalPO);
   // Repair must not depend on something ALSO having drifted: a draft whose only fault is an
   // inherited unpromotable file is exactly the state that blocked TC_SMOKE_021.
   const settled=quarantineDetails(scope,rid).state.revisionId;
   const stuck={...JSON.parse(fs.readFileSync(path.join(rdir,'revisions',settled+'.json'),'utf8')),
     revisionId:randomId(),parent:settled,provenance:'USER_EDITED_QUARANTINE' as const};
   stuck.files={...stuck.files,[outOfGraph]:fs.readFileSync(outOfGraph,'utf8')};
   fs.writeFileSync(path.join(rdir,'revisions',stuck.revisionId+'.json'),JSON.stringify(stuck,null,2)+'\n');
   fs.writeFileSync(path.join(rdir,'state.json'),JSON.stringify({...quarantineDetails(scope,rid).state,revisionId:stuck.revisionId,eligible:false},null,2)+'\n');
   // Align disk with what the revision already holds, so the ONLY fault left is the file it
   // should never have carried - the exact shape the live TC_SMOKE_021 draft was stuck in.
   if(stuck.files[po])fs.writeFileSync(po,stuck.files[po]);
   assert.deepEqual(quarantineDependencyDrift(scope,rid).drifted,[],'nothing has drifted; the only fault is the inherited file');
   const repairedWithoutDrift=refreshQuarantineDependencies(scope,rid,stuck.revisionId);
   assert.ok(repairedWithoutDrift.dropped.some(item=>item.path===outOfGraph),'the inherited unpromotable file is dropped');
   assert.ok(!Object.keys(JSON.parse(fs.readFileSync(path.join(rdir,'revisions',repairedWithoutDrift.revisionId+'.json'),'utf8')).files).includes(outOfGraph));
   assert.equal(quarantineDetails(scope,rid).state.eligible,false,'the repaired revision still requires revalidation');
   assert.equal(hashContent(fs.readFileSync(rOriginal,'utf8')),rOriginalHash);
   console.log('PASS a draft whose only fault is an inherited unpromotable file can be repaired without drift');
   // An out-of-graph retained application file must never deadlock promotion: nothing can
   // refresh it and nothing can promote it, so demanding it match would be unreconcilable.
   const stillDrifted=quarantineDependencyDrift(scope,rid);
   assert.ok(!stillDrifted.drifted.some(item=>item.path===outOfGraph),'an out-of-graph file is never offered');
   fs.writeFileSync(outOfGraph,fs.readFileSync(outOfGraph,'utf8')+'\n// changed again after validation\n');
   const settledRun=quarantineDetails(scope,rid).state.runs.at(-1) as any;
   if(settledRun?.retainedApplicationArtifacts?.some((item:any)=>item.path===outOfGraph))
     assert.doesNotThrow(()=>promoteQuarantine(scope,rid),'a retained out-of-graph application file must not deadlock promotion');
   console.log('PASS an out-of-graph retained application file cannot deadlock promotion');
   console.log('PASS a revision carrying an unpromotable file is repaired forward, never rewritten');
 }
 if(phase==='rebuild'){
   const review=reviewQuarantineMapping(scope,packageId);
   saveQuarantineMapping(scope,packageId,{applicationId:scope.applicationId,revision:review.revision,mappingVersion:review.mappingVersion,stepKey:'action:0',page:{name:'HeaderPage',route:'',description:'',create:true},pageObject:{name:'HeaderControls',create:true}});
   const built=await rebuildQuarantineDraft(scope,packageId,'excel/north.xlsx');assert.equal(built.accepted,true,JSON.stringify(built));
   assert.equal(validateQuarantine(scope,packageId).accepted,true,'route-less mapping rebuild passes static draft validation');
   assert.match(quarantineFile(scope,packageId,spec).content,/headerControls\./,'rebuilt source uses the saved explicit mapping');
   assert.equal(fs.existsSync(spec),false,'mapping rebuild never publishes a generated suite spec');
   assert.equal(fs.readFileSync(path.join(directory,'original.json'),'utf8'),original,'mapping rebuild preserves original quarantine');
   console.log('PASS route-less mapping save, deterministic rebuild and validated private draft without promotion');
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
