/** Quarantine revisions use the existing code/authoring contracts. Original evidence is immutable. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import type { ApplicationScope } from '../projects/scope';
import { scopedKey } from '../projects/scope';
import { readRegistry, workbookOwner } from '../projects/registry';
import { readState } from '../autocode/work';
import type { GateResult } from '../autocode/verify';
import { codeGraph, codeDependencySources, readCode, codeDefinition, prepareCodeSave, dependencyOwnership, type DependencyOwnership } from './code-workspace';
import { atomicText, commitTexts, hashContent } from '../knowledge/authoring-owners';
import { diagnosticRoot, containedFile, diagnosticText, diagnosticData, writeDiagnostic, type DiagnosticCapture } from '../diagnostics/artifacts';
import { sourceSteps } from '../diagnostics/manifest';
import { readMapping, upsertEntry } from '../excel/mapping';
import { parseRecording } from './recorder';
import { recordingMappingReview, saveRecordingMapping, type MappingInput, type MappingDraft } from './recording-mapping';
import { evidenceUnavailable } from '../autocode/dom-evidence';
import { manualStatusPath } from '../knowledge/manual-authoring';
import { executionPlan, type SelectionRequest, type ExecutionSelection, type ExecutionProfile } from '../test-data/execution';
import { testDataFile, readTestData } from '../test-data/store';
import { resolveExecutionContext, executionEnvironment, preflightAuthentication, type ExecutionContext, type ExecutionContextInput } from '../projects/execution-context';

const ROOT=process.cwd(),relative=(file:string)=>path.relative(ROOT,file).replace(/\\/g,'/');
interface Original {
  executionContext?:ExecutionContext;
  sourceEnvironmentId?:string;
  executionSelection?:ExecutionSelection; executionProfile?:ExecutionProfile;
  originalRevisionId?:string;
  dependencyProvenance?:string;
  schemaVersion:1; applicationId:string; environmentId:string; packageId:string; testCaseId:string; runId?:string;
  createdAt:string; entry:string; files:Record<string,string>; liveVersions:Record<string,string|null>;
  gate?:GateResult; workbook?:string; scenario:string; sourceWorksheet?:string; module?:string; sourceRow?:number;
}
interface Revision { revisionId:string; parent:string|null; createdAt:string;
  provenance:'ORIGINAL_GENERATED'|'USER_EDITED_QUARANTINE'|'APPLICATION_DEPENDENCY_REFRESH';
  reviewed?:ArtifactRecord[]; files:Record<string,string> }
/**
 * WHERE A RERUN'S SOURCE ENVIRONMENT CAME FROM.
 *
 * A package created before ExecutionContext existed recorded no source environment, and
 * that absence is a fact about the past: the run happened, nobody wrote down which source
 * it used, and no later evidence can recover it. The remedy is a NEW attempt that carries a
 * source somebody chose, never a repaired old one - so this says which, and the vocabulary
 * deliberately has no word meaning "original" or "inherited" for a value a person supplied.
 *
 *   ORIGINAL_EXECUTION           the package recorded its own context; this rerun used it.
 *   USER_SELECTED_FOR_RERUN      a person chose it for this attempt. Nothing historical.
 *   CARRIED_FROM_RERUN_SELECTION defaulted from an earlier attempt's user selection, so the
 *                                same revision is not re-asked. Still not historical.
 */
export type SourceEnvironmentProvenance='ORIGINAL_EXECUTION'|'USER_SELECTED_FOR_RERUN'|'CARRIED_FROM_RERUN_SELECTION';
/**
 * WHICH FRAMEWORK A RERUN RUNS ON. Two different questions, never one.
 *
 * A quarantine package retains the files that were on disk when it was made - the spec, the
 * application's Page Objects and knowledge, AND the shared framework of that day. Replaying
 * all of it reproduces the failure faithfully, which is what you want when asking "what
 * happened?". It is exactly wrong when asking "is it fixed?", because the fix is in the
 * framework the replay just overwrote: the run re-proves the old bug and reports it as the
 * test's fault.
 *
 * That is not hypothetical. TC_SMOKE_021 failed a rerun carrying locatorTimeoutMs 40000
 * while executing a retained resolver whose candidate window was 4000 - the context said
 * forty seconds and the code that read it had been replaced by its own ancestor.
 *
 *   CURRENT_FRAMEWORK_VALIDATION  retained TEST_OWNED + APPLICATION_OWNED artifacts on the
 *                                 CURRENT shared framework. The only basis that can earn
 *                                 promotion eligibility.
 *   HISTORICAL_REPLAY             retained artifacts AND retained shared framework.
 *                                 Reproduction only; can never establish eligibility,
 *                                 because it deliberately executes superseded code.
 */
export type ExecutionBasis='CURRENT_FRAMEWORK_VALIDATION'|'HISTORICAL_REPLAY';
export const EXECUTION_BASES:ExecutionBasis[]=['CURRENT_FRAMEWORK_VALIDATION','HISTORICAL_REPLAY'];
export function executionBasisOf(value:unknown):ExecutionBasis {
  if(value===undefined||value===null||value==='')return 'CURRENT_FRAMEWORK_VALIDATION';
  if(!EXECUTION_BASES.includes(value as ExecutionBasis))throw Error(`Unknown quarantine execution basis. Choose one of: ${EXECUTION_BASES.join(', ')}.`);
  return value as ExecutionBasis;
}
interface ArtifactRecord { path:string; hash:string; ownership:DependencyOwnership }
interface RunRevision { runId:string; revisionId:string; environmentId:string; sourceEnvironmentId?:string; sourceEnvironmentProvenance?:SourceEnvironmentProvenance;
  executionBasis?:ExecutionBasis; resultLabel?:'REPRODUCTION_ONLY'; currentFrameworkRevision?:string|null;
  retainedApplicationArtifacts?:ArtifactRecord[]; currentFrameworkArtifacts?:ArtifactRecord[];
  executionContext?:ExecutionContext; at:string; result:GateResult; executionSelection?:ExecutionSelection; executionProfile?:ExecutionProfile }
interface DraftState { revisionId:string; runs:RunRevision[]; eligible:boolean; promoted?:boolean; mappingNeedsBuild?:boolean }
const locks=new Set<string>();
function packageDirectory(scope:ApplicationScope,id:string) {
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid quarantine package.');
  return containedFile(diagnosticRoot(scope),`quarantine/${id}`);
}
function json<T>(file:string):T{return JSON.parse(fs.readFileSync(file,'utf8'));}
function load(scope:ApplicationScope,id:string) {
  const directory=packageDirectory(scope,id);
  if(!fs.existsSync(path.join(directory,'original.json')))throw Error('No quarantine package belongs to the selected application.');
  const original=json<Original>(path.join(directory,'original.json'));
  if(original.applicationId!==scope.applicationId||original.packageId!==id)throw Error('Quarantine belongs to another application.');
  const state=json<DraftState>(path.join(directory,'state.json'));
  if(!/^[a-f0-9-]{36}$/.test(state.revisionId))throw Error('Invalid quarantine revision.');
  const revision=json<Revision>(containedFile(directory,`revisions/${state.revisionId}.json`));
  const overlay=new Map(Object.entries({...original.files,...revision.files}).map(([file,text])=>[path.resolve(ROOT,file),text]));
  // The normal workspace proves every dependency belongs to this application or the shared allowlist.
  let graph:ReturnType<typeof codeGraph>|undefined;
  return {directory,original,state,revision,overlay,get graph(){return graph??=codeGraph(scope,original.testCaseId,overlay);}};
}
function writeNew(file:string,value:unknown) { fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'}); }
export function createQuarantinePackage(scope:ApplicationScope,specFile:string,testCaseId:string,gate?:GateResult,
    metadata:{workbook?:string;runId?:string;scenario?:string;module?:string;sourceWorksheet?:string;sourceRow?:number;sourceEnvironmentId?:string;executionContext?:ExecutionContext;executionSelection?:ExecutionSelection;executionProfile?:ExecutionProfile}={}) {
  const source=fs.readFileSync(path.resolve(ROOT,specFile),'utf8'),entry=relative(path.join(scope.paths.generatedDir,`${testCaseId}.spec.ts`));
  const overlay=new Map([[path.resolve(ROOT,entry),source]]),graph=codeGraph(scope,testCaseId,overlay);
  const files:Record<string,string>={},liveVersions:Record<string,string|null>={};
  for(const node of graph.files) {
    const absolute=path.resolve(ROOT,node.id);
    files[node.id]=overlay.get(absolute)??fs.readFileSync(absolute,'utf8');
    liveVersions[node.id]=fs.existsSync(absolute)?hashContent(fs.readFileSync(absolute,'utf8')):null;
  }
  for(const [file,source]of codeDependencySources(scope,testCaseId,overlay)){
    files[relative(file)]=source;liveVersions[relative(file)]=fs.existsSync(file)?hashContent(fs.readFileSync(file,'utf8')):null;
  }
  let dependencyProvenance=gate?'Current source at package creation; historical executed dependencies were not retained.':'Only the legacy spec is historical. Supporting recording, binding and dependency files reflect application state at import; original supporting snapshots were not retained.';
  if(gate?.detail.diagnostics){
    const snapshot=containedFile(diagnosticRoot(scope),`${gate.detail.diagnostics}/executed-dependencies.json`);
    if(fs.existsSync(snapshot)){const executed=json<{files:Record<string,string>}>(snapshot);
      for(const [file,source]of Object.entries(executed.files))if(file in files){files[file]=source;liveVersions[file]=hashContent(source);}
      dependencyProvenance='Available application fixture, Page Object and BasePage snapshots captured before execution. Omitted sources remain marked unavailable in the runtime manifest.';
    }
  }
  const packageId=randomUUID(),directory=packageDirectory(scope,packageId),revisionId=randomUUID();
  const original:Original={schemaVersion:1,originalRevisionId:revisionId,applicationId:scope.applicationId,environmentId:scope.environmentId,packageId,testCaseId,
    createdAt:new Date().toISOString(),entry,files,liveVersions,gate,dependencyProvenance,scenario:metadata.scenario??testCaseId,...metadata};
  // The pointer is published only after every immutable part exists.
  const staging=directory+'.'+randomUUID()+'.tmp';
  try {
    writeNew(path.join(staging,'original.json'),original);
    writeNew(path.join(staging,'revisions',`${revisionId}.json`),{revisionId,parent:null,createdAt:original.createdAt,provenance:'ORIGINAL_GENERATED',files:{}} satisfies Revision);
    writeNew(path.join(staging,'state.json'),{revisionId,runs:[],eligible:false} satisfies DraftState);
    fs.renameSync(staging,directory);
  }catch(error){if(fs.existsSync(staging))fs.rmSync(staging,{recursive:true,force:true});throw error;}
  return packageId;
}
export function listQuarantine(scope:ApplicationScope) {
  const root=path.join(diagnosticRoot(scope),'quarantine'),packages:any[]=[];
  if(fs.existsSync(root))for(const id of fs.readdirSync(root)) {
    if(!/^[a-f0-9-]{36}$/.test(id))continue;
    const {original,state}=load(scope,id);
    packages.push({packageId:id,testCaseId:original.testCaseId,createdAt:original.createdAt,reason:original.gate?.reason??'Historical runtime diagnostics unavailable',
      eligible:state.eligible,promoted:!!state.promoted,executionProfile:original.executionProfile});
  }
  const state=readState();
  const legacy=Object.entries(state).flatMap(([key,value])=>{
    const id=key.startsWith(scope.applicationId+'/')?key.slice(scope.applicationId.length+1):'';
    if(!id||key!==scopedKey(scope.applicationId,id)||value.verdict!=='quarantined'||packages.some(item=>item.testCaseId===id))return [];
    return [{testCaseId:id,legacy:true,createdAt:value.at,reason:diagnosticText(value.reason??'Historical diagnostics unavailable')}];
  });
  return [...packages,...legacy].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export function importLegacyQuarantine(scope:ApplicationScope,testCaseId:string) {
  const entry=readState()[scopedKey(scope.applicationId,testCaseId)];
  if(entry?.verdict!=='quarantined'||!/^[A-Za-z0-9_-]+$/.test(testCaseId))throw Error('No quarantined case belongs to this application.');
  const root=path.join(ROOT,'ai/autocode/quarantine');
  // Legacy writer explicitly stamped applicationId in each retained filename. Require
  // BOTH the scoped state entry and that stamp, then validate the imported dependency graph.
  const candidates=fs.existsSync(root)?fs.readdirSync(root).filter(name=>name.startsWith(`${scope.applicationId}.${testCaseId}.`)&&name.endsWith('.spec.ts.txt')).sort():[];
  const reference=entry.specFile?.replace(/^ai\/autocode\/quarantine\//,'')??candidates.at(-1);
  if(!reference)throw Error('The historical spec was not retained. It cannot be reconstructed as original evidence.');
  const file=containedFile(root,reference);
  const existing=listQuarantine(scope).find(item=>item.testCaseId===testCaseId&&!item.legacy);
  if(existing)return existing.packageId as string;
  return createQuarantinePackage(scope,file,testCaseId,undefined,{scenario:testCaseId});
}
function revisionState(state:DraftState):DraftState{return {...state,eligible:false,promoted:false};}
export function quarantineDetails(scope:ApplicationScope,id:string,selectedRunId?:string) {
  const {directory,original,state,revision,graph}=load(scope,id);
  const latest=selectedRunId==='original'?undefined:selectedRunId?state.runs.find(run=>run.runId===selectedRunId):state.runs.at(-1),gate=latest?.result??original.gate;
  if(selectedRunId&&selectedRunId!=='original'&&!latest)throw Error('Unknown quarantine run revision.');
  const steps=sourceSteps(path.resolve(ROOT,original.entry),revision.files[original.entry]??original.files[original.entry]);
  let runtime:any=null;
  if(gate?.detail.diagnostics){
    const run=containedFile(diagnosticRoot(scope),gate.detail.diagnostics);
    if(fs.existsSync(path.join(run,'manifest.json'))){
      runtime=json<any>(path.join(run,'manifest.json'));
      runtime.stepLogs=[];
      for(const file of runtime.artifacts??[])if(file.startsWith('steps/')&&file.endsWith('.json')){
        const log=json<any>(containedFile(run,file));
        for(const step of log.steps??[])for(const capture of step.captures??[]) {
          const artifact=runtime.artifacts.find((item:string)=>item.endsWith('/'+capture.artifact));
          if(artifact)capture.artifact=`${gate.detail.diagnostics}/${artifact}`;else capture.artifact='';
        }
        runtime.stepLogs.push(log);
      }
    }
  }
  const recordingCaptures:DiagnosticCapture[]=Object.entries(original.files).filter(([name])=>name.endsWith('.evidence.json')).flatMap(([,text])=>{
    try{return JSON.parse(text).captures??[];}catch{return [];}
  });
  // The ORIGINAL's own answer, never the latest attempt's. A rerun appended to a legacy
  // package must not make the historical record look as though it recorded a source.
  const legacy=legacyExecutionContext(original);
  const carried=legacy?rerunDefault(state,state.revisionId):undefined;
  return diagnosticData({packageId:id,testCaseId:original.testCaseId,applicationId:scope.applicationId,environmentId:scope.environmentId,executionProfile:latest?.executionProfile??original.executionProfile,
    legacyExecutionContext:legacy,
    historicalSourceEnvironmentId:original.sourceEnvironmentId??original.executionContext?.sourceEnvironmentId??null,
    sourceEnvironmentProvenance:latest?.sourceEnvironmentProvenance??null,
    rerunSourceEnvironmentId:carried?.sourceEnvironmentId??null,
    rerunExecutionContext:carried?.executionContext??null,
    executionContext:latest?.executionContext??original.executionContext,sourceEnvironmentId:latest?.sourceEnvironmentId??original.sourceEnvironmentId,
    runId:latest?.runId??original.runId,viewedRevisionId:latest?.revisionId??original.originalRevisionId,dependencyProvenance:original.dependencyProvenance,createdAt:original.createdAt,gate,steps,runtime,recordingCaptures,graph,state,
    revision:{...revision,files:undefined},history:fs.readdirSync(path.join(directory,'revisions')).filter(name=>name.endsWith('.json')).map(name=>{
      const item=json<Revision>(path.join(directory,'revisions',name));return {revisionId:item.revisionId,parent:item.parent,createdAt:item.createdAt,provenance:item.provenance,changedFiles:Object.keys(item.files)};
    })});
}
function revisionOverlay(loaded:ReturnType<typeof load>,revisionId?:string) {
  if(!revisionId)return loaded.overlay;
  if(!/^[a-f0-9-]{36}$/.test(revisionId))throw Error('Invalid historical revision.');
  const revision=json<Revision>(containedFile(loaded.directory,`revisions/${revisionId}.json`));
  if(revision.revisionId!==revisionId)throw Error('Quarantine revision mismatch.');
  return new Map(Object.entries({...loaded.original.files,...revision.files}).map(([file,text])=>[path.resolve(ROOT,file),text]));
}
export function quarantineFile(scope:ApplicationScope,id:string,file:string,original=false,revisionId?:string) {
  const loaded=load(scope,id),overlay=original?new Map(Object.entries(loaded.original.files).map(([file,text])=>[path.resolve(ROOT,file),text])):revisionOverlay(loaded,revisionId);
  return readCode(scope,loaded.original.testCaseId,file,overlay);
}
export function quarantineDefinition(scope:ApplicationScope,id:string,file:string,position:number,version?:string,revisionId?:string) {
  const loaded=load(scope,id);return codeDefinition(scope,loaded.original.testCaseId,file,position,version,revisionOverlay(loaded,revisionId));
}
export function saveQuarantineDraft(scope:ApplicationScope,id:string,file:string,version:string,content:string,revisionId:string) {
  if(locks.has(id))throw Error('Wait for this quarantine validation to finish.');
  const loaded=load(scope,id);
  if(loaded.state.revisionId!==revisionId)throw Error('Draft changed in another editor. Your unsaved content is retained.');
  const result=prepareCodeSave(scope,loaded.original.testCaseId,file,version,content,loaded.overlay);
  if(!result.accepted||!result.transaction)return result;
  const next=randomUUID(),files={...loaded.revision.files};
  for(const [file,text]of result.transaction){
    if(file===manualStatusPath(scope)){
      const previous=JSON.parse(loaded.overlay.get(file)??'{"methods":[]}'),next=JSON.parse(text);
      if(next.applicationId!==scope.applicationId)throw Error('Foreign manual authoring status.');
      next.methods=[...previous.methods.filter((old:any)=>!next.methods.some((item:any)=>item.owner===old.owner&&item.method===old.method)),...next.methods];files[relative(file)]=JSON.stringify(next,null,2);
    }else files[relative(file)]=text;
  }
  const revision:Revision={revisionId:next,parent:revisionId,createdAt:new Date().toISOString(),provenance:'USER_EDITED_QUARANTINE',files};
  const changes=new Map([[path.join(loaded.directory,'revisions',`${next}.json`),JSON.stringify(revision,null,2)+'\n'],
    [path.join(loaded.directory,'state.json'),JSON.stringify({...revisionState(loaded.state),revisionId:next},null,2)+'\n']]);
  commitTexts(changes);
  const {transaction,...saved}=result;
  return {...saved,revisionId:next,provenance:revision.provenance};
}
export function validateQuarantine(scope:ApplicationScope,id:string) {
  const {original,overlay,graph,state}=load(scope,id),node=graph.files.find(item=>item.id===original.entry)!;
  if(state.mappingNeedsBuild)return {accepted:false,status:'invalid',errors:[{message:'Rebuild this quarantine draft from the saved mapping before validation or rerun.'}]};
  const result=prepareCodeSave(scope,original.testCaseId,original.entry,node.version,overlay.get(path.resolve(ROOT,original.entry))!,overlay);
  if('transaction'in result){const {transaction,...validation}=result;return validation;}return result;
}
export function quarantineMappingDraft(scope:ApplicationScope,id:string):MappingDraft {
  const loaded=load(scope,id);
  const node=loaded.graph.files.find(node=>node.category==='Recording'&&node.id.endsWith('.spec.ts'));
  if(!node)throw Error('No original recording was retained for this quarantine.');
  const file=path.resolve(ROOT,node.id),source=loaded.overlay.get(file)!,base=node.id.replace(/\.spec\.ts$/,'');
  const evidenceText=loaded.overlay.get(path.resolve(ROOT,base+'.evidence.json'));
  const assertionsText=loaded.overlay.get(path.resolve(ROOT,base+'.assertions.json'));
  const ownersText=loaded.overlay.get(path.resolve(ROOT,base+'.owners.json'));
  const recording=parseRecording(source,{startUrl:'',browser:'chromium',durationMs:0,evidence:evidenceText?JSON.parse(evidenceText):evidenceUnavailable('Historical evidence unavailable'),stateAssertions:assertionsText?JSON.parse(assertionsText):undefined});
  if(ownersText)recording.authoringOwners=JSON.parse(ownersText);
  const ownersFile=path.join(loaded.directory,'mapping.owners.json');
  return {source,recording,origin:{applicationId:scope.applicationId},ownersFile,
    ownerOverrides:Object.fromEntries((recording.authoringOwners?.choices??[]).filter(choice=>choice.explicit).map(choice=>[choice.key,choice.userSelection??choice.confirmed??''])),
    prepareRevision:(texts,owners)=>{
      const next=randomUUID(),files={...loaded.revision.files};
      for(const [file,text]of texts)if(file!==ownersFile)files[relative(file)]=text;
      files[base+'.owners.json']=JSON.stringify(owners,null,2);
      const revision:Revision={revisionId:next,parent:loaded.state.revisionId,createdAt:new Date().toISOString(),provenance:'USER_EDITED_QUARANTINE',files};
      texts.set(path.join(loaded.directory,'revisions',`${next}.json`),JSON.stringify(revision,null,2)+'\n');
      texts.set(path.join(loaded.directory,'state.json'),JSON.stringify({...revisionState(loaded.state),revisionId:next,mappingNeedsBuild:true},null,2)+'\n');
    }};
}
export function reviewQuarantineMapping(scope:ApplicationScope,id:string){return recordingMappingReview(scope,quarantineMappingDraft(scope,id));}
export function saveQuarantineMapping(scope:ApplicationScope,id:string,input:MappingInput){
  if(locks.has(id))throw Error('Wait for this quarantine run to finish.');
  return saveRecordingMapping(scope,quarantineMappingDraft(scope,id),input);
}
export async function rebuildQuarantineDraft(scope:ApplicationScope,id:string,workbook:string) {
  if(locks.has(id))throw Error('Wait for quarantine execution to finish.');
  if(workbookOwner(workbook)!==scope.applicationId)throw Error('Workbook belongs to another application.');
  const loaded=load(scope,id),output=path.join(loaded.directory,`build-${randomUUID()}.json`);
  try {
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(process.execPath,[require.resolve('tsx/cli'),path.join(__dirname,'quarantine-build.ts'),scope.applicationId,scope.environmentId,id,workbook,output],
        {cwd:ROOT,windowsHide:true,env:{...process.env,AURA_APPLICATION:scope.applicationId,AURA_ENVIRONMENT:scope.environmentId}});
      let error='';child.stderr.on('data',data=>error=(error+data).slice(-4000));child.stdout.resume();
      const timer=setTimeout(()=>{child.kill();reject(Error('Quarantine draft build timed out.'));},60_000);
      child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error(diagnosticText(error)||'Quarantine draft build failed.'));});
    });
    const built=json<{source:string}>(output),node=loaded.graph.files.find(item=>item.id===loaded.original.entry)!;
    const result=saveQuarantineDraft(scope,id,loaded.original.entry,node.version,built.source,loaded.state.revisionId);
    if(result.accepted){const next=load(scope,id);atomicText(path.join(next.directory,'state.json'),JSON.stringify({...next.state,mappingNeedsBuild:false},null,2)+'\n');}
    return result;
  }finally{if(fs.existsSync(output))fs.unlinkSync(output);}
}

/**
 * Did this package record which source environment it ran against?
 *
 * Asked of the ORIGINAL only. A package written before ExecutionContext existed answers no,
 * and keeps answering no however many reruns are appended to it - a rerun is a new attempt,
 * not a discovery about the original. Never inferred from the workbook, the recording, the
 * target environment or registry cardinality: absent means unknown, and unknown is not stg.
 */
export function legacyExecutionContext(original:Pick<Original,'sourceEnvironmentId'|'executionContext'>):boolean {
  return !original.sourceEnvironmentId && !original.executionContext?.sourceEnvironmentId;
}
/**
 * The most recent attempt whose own context is complete enough to rerun from.
 *
 * This is what lets a legacy package stop asking after the first explicit selection: the
 * default comes from an ATTEMPT a person configured, not from the original. Scoped to the
 * revision being rerun, so editing the draft asks again rather than silently reusing a
 * selection made for different code.
 */
function rerunDefault(state:DraftState,revisionId:string):RunRevision|undefined {
  return [...state.runs].reverse().find(run=>run.revisionId===revisionId&&!!run.executionContext?.sourceEnvironmentId);
}
/** Read-only preflight also powers the UI preview. Overrides never mutate historical metadata. */
export function quarantineExecutionContext(scope:ApplicationScope,id:string,request?:SelectionRequest,input:ExecutionContextInput={}) {
  const loaded=load(scope,id),originalSelection=loaded.original.executionSelection;
  const selectionRequest=request??(originalSelection?{mode:'selected' as const,rows:[originalSelection.row],expectedVersion:readTestData(scope).version}:undefined);
  const planned=selectionRequest?executionPlan(scope,[loaded.original.testCaseId],selectionRequest):[];
  if(planned.length>1)throw Error('A quarantine rerun accepts one execution profile. Each rerun is a new attempt.');
  const selected=planned[0];
  const saved:ExecutionContextInput=loaded.original.executionContext??{};
  const {credentialProfileId,dataProfileId,executionRowId,...original}=saved;
  const legacy=legacyExecutionContext(loaded.original);
  // A legacy package has no historical source to fall back on, so the fallback is the last
  // attempt somebody configured for this exact revision - and the answer says which it was.
  const carried=legacy?rerunDefault(loaded.state,loaded.state.revisionId):undefined;
  const {credentialProfileId:_c,dataProfileId:_d,executionRowId:_r,...carriedContext}=(carried?.executionContext??{}) as ExecutionContextInput;
  const historicalSource=loaded.original.sourceEnvironmentId??original.sourceEnvironmentId;
  const context=resolveExecutionContext(scope,{...original,...carriedContext,sourceEnvironmentId:historicalSource??carriedContext.sourceEnvironmentId,
    ...input,environmentId:scope.environmentId},selected?.selection);
  const sourceEnvironmentProvenance:SourceEnvironmentProvenance=input.sourceEnvironmentId
    ? 'USER_SELECTED_FOR_RERUN'
    : historicalSource ? 'ORIGINAL_EXECUTION' : 'CARRIED_FROM_RERUN_SELECTION';
  preflightAuthentication(scope,selected?.selection,/\bappCredentials\b/.test(loaded.overlay.get(path.resolve(ROOT,loaded.original.entry))!));
  return {context,selected,sourceEnvironmentProvenance,legacyExecutionContext:legacy,
    historicalSourceEnvironmentId:historicalSource??null,carriedFromRunId:input.sourceEnvironmentId?undefined:carried?.runId};
}
/** Best-effort identity of the framework this run executed. Absent is honest; invented is not. */
function currentFrameworkRevision():string|null {
  try{
    const result=spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',windowsHide:true,timeout:10_000});
    const value=result.status===0?String(result.stdout).trim():'';
    return /^[0-9a-f]{40}$/.test(value)?value:null;
  }catch{return null;}
}
/** Run a snapshot in a private checkout. No application artifact in the dashboard checkout is overlaid. */
export async function rerunQuarantine(scope:ApplicationScope,id:string,workbook:string,request?:SelectionRequest,input:ExecutionContextInput={},basisInput?:unknown):Promise<RunRevision> {
  if(locks.has(id))throw Error('This quarantine draft is already running.');
  if(workbookOwner(workbook)!==scope.applicationId)throw Error('Workbook belongs to another application.');
  const executionBasis=executionBasisOf(basisInput);
  const validation=validateQuarantine(scope,id);if(!validation.accepted)throw Error(JSON.stringify(validation.errors));
  const loaded=load(scope,id),runId=randomUUID();
  const {context,selected,sourceEnvironmentProvenance}=quarantineExecutionContext(scope,id,request,input);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'aura-quarantine-'));
  const retainedApplicationArtifacts:ArtifactRecord[]=[],currentFrameworkArtifacts:ArtifactRecord[]=[];
  const provenance={executionBasis,sourceEnvironmentProvenance,currentFrameworkRevision:currentFrameworkRevision(),
    retainedApplicationArtifacts,currentFrameworkArtifacts,
    ...(executionBasis==='HISTORICAL_REPLAY'?{resultLabel:'REPRODUCTION_ONLY' as const}:{})};
  let stdout='',stderr='';
  locks.add(id);
  try {
    fs.cpSync(path.join(ROOT,'ai'),path.join(temporary,'ai'),{recursive:true,filter:file=>{
      const entry=fs.lstatSync(file);return !entry.isSymbolicLink()&&(entry.isDirectory()?!['artifacts','recordings','reports','page','framework','quarantine','generations','runs'].includes(path.basename(file)):/\.(ts|js|css|html)$/.test(file)&&!file.endsWith('.fixture.ts'));
    }});
    for(const dir of ['tests-e2e/support'])fs.cpSync(path.join(ROOT,dir),path.join(temporary,dir),{recursive:true});
    for(const file of ['tsconfig.json','package.json','playwright.excel.config.ts'])fs.copyFileSync(path.join(ROOT,file),path.join(temporary,file));
    // The fixture can import unused Page Objects; copy this application's directory only.
    if(fs.existsSync(scope.paths.pagesDir))for(const name of fs.readdirSync(scope.paths.pagesDir)){
      const file=path.join(scope.paths.pagesDir,name);if(fs.lstatSync(file).isFile()&&name.endsWith('.ts')){const target=path.join(temporary,relative(file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);}
    }
    // THE OVERLAY, AND WHAT IT IS ALLOWED TO REACH.
    //
    // Every retained file is classified through the single ownership contract. Test- and
    // application-owned artifacts are the quarantined case's identity and are replayed in
    // BOTH bases. Shared framework is the era: replayed under HISTORICAL_REPLAY, and under
    // CURRENT_FRAMEWORK_VALIDATION deliberately not written, so the current checkout's copy
    // - already present from the bulk copy above, or restored here when it is not - is what
    // executes. An unclassifiable dependency stops the run; running it from a guessed era
    // produces a confident result about nothing.
    for(const [file,content]of loaded.overlay){
      const id=relative(file),ownership=dependencyOwnership(scope,id);
      if(!ownership)throw Error(`QUARANTINE_DEPENDENCY_OWNERSHIP_UNKNOWN: ${id} cannot be classified as TEST_OWNED, APPLICATION_OWNED or SHARED_FRAMEWORK, so neither execution basis can be applied to it.`);
      const destination=containedFile(temporary,id);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      if(executionBasis==='CURRENT_FRAMEWORK_VALIDATION'&&ownership==='SHARED_FRAMEWORK'){
        const live=path.resolve(ROOT,id);
        if(!fs.existsSync(live))throw Error(`QUARANTINE_DEPENDENCY_OWNERSHIP_UNKNOWN: shared framework file ${id} was retained by this package but no longer exists in the current checkout, so current-framework validation cannot supply it.`);
        const source=fs.readFileSync(live,'utf8');
        fs.writeFileSync(destination,source);
        currentFrameworkArtifacts.push({path:id,hash:hashContent(source),ownership});
        continue;
      }
      fs.writeFileSync(destination,content);
      (ownership==='SHARED_FRAMEWORK'?currentFrameworkArtifacts:retainedApplicationArtifacts).push({path:id,hash:hashContent(content),ownership});
    }
    const registry=readRegistry();writeNew(path.join(temporary,'ai/projects/registry.json'),{...registry,applications:registry.applications.filter(app=>app.applicationId===scope.applicationId)});
    if(selected){const destination=path.join(temporary,'ai','test-data',scope.applicationId,'test-data.json');fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(testDataFile(scope),destination);}
    const workbookFile=containedFile(ROOT,workbook);if(fs.existsSync(workbookFile)){const target=containedFile(temporary,relative(workbookFile));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(workbookFile,target);}
    fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(temporary,'node_modules'),'junction');
    const runner=`import fs from 'node:fs';import {gate} from './ai/autocode/verify';const result=gate(${JSON.stringify(loaded.original.entry)},${JSON.stringify(loaded.original.testCaseId)},${JSON.stringify(loaded.original.scenario)},${JSON.stringify(workbook)},undefined,${JSON.stringify({runId,executionContext:context,executionSelection:selected?.selection})});fs.writeFileSync('quarantine-result.json',JSON.stringify(result));`;
    fs.writeFileSync(path.join(temporary,'quarantine-run.ts'),runner);
    const result=await new Promise<number>((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(ROOT,'node_modules/tsx/dist/cli.mjs'),'quarantine-run.ts'],{cwd:temporary,windowsHide:true,env:{...process.env,
        ...executionEnvironment(context,selected?.selection),AURA_ARTEFACT_ROOT:temporary,AURA_EXCEL_DIR:path.join(temporary,'excel'),AURA_REGISTRY_FILE:path.join(temporary,'ai/projects/registry.json'),AURA_RUN_ID:runId,EXCEL_WORKBOOK:workbook}});
      let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;if(process.platform==='win32'&&child.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10_000});else child.kill();},390_000);
      child.stdout.on('data',data=>stdout=(stdout+data).slice(-1_000_000));child.stderr.on('data',data=>stderr=(stderr+data).slice(-1_000_000));
      child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);timedOut?reject(Error('Quarantine execution exceeded 390000ms. '+diagnosticText(stderr).slice(-2000))):resolve(code??1);});
    });
    const report=path.join(temporary,'quarantine-result.json');
    if(result!==0||!fs.existsSync(report))throw Error('Quarantine runner failed: '+diagnosticText(stderr||stdout).slice(-4000));
    const verdict=json<GateResult>(report);
    for(const reference of [verdict.detail.diagnostics,verdict.detail.mutationDiagnostics].filter((value):value is string=>!!value)){
      const origin=containedFile(path.join(temporary,'ai/diagnostics/artifacts',scope.applicationId),reference),destination=containedFile(diagnosticRoot(scope),reference);
      fs.mkdirSync(path.dirname(destination),{recursive:true});fs.cpSync(origin,destination,{recursive:true,errorOnExist:true,force:false});
    }
    const run:RunRevision={runId,revisionId:loaded.state.revisionId,environmentId:scope.environmentId,sourceEnvironmentId:context.sourceEnvironmentId,...provenance,executionContext:context,at:new Date().toISOString(),result:verdict,executionSelection:selected?.selection,executionProfile:selected?.profile};
    const current=load(scope,id);if(current.state.revisionId!==loaded.state.revisionId)throw Error('Draft changed during execution; result cannot validate another revision.');
    // HISTORICAL_REPLAY can never grant eligibility: it passed on superseded code, which is
    // a statement about the past, not about what would ship.
    atomicText(path.join(loaded.directory,'state.json'),JSON.stringify({...loaded.state,runs:[...loaded.state.runs,run],
      eligible:verdict.verdict==='accepted'&&executionBasis==='CURRENT_FRAMEWORK_VALIDATION'},null,2)+'\n');
    return run;
  }catch(error){
    const folder=path.join(diagnosticRoot(scope),'runs',runId),message=diagnosticText(error instanceof Error?error.message:error);
    writeDiagnostic(path.join(folder,'manifest.json'),{schemaVersion:1,applicationId:scope.applicationId,environmentId:scope.environmentId,testCaseId:loaded.original.testCaseId,runId,kind:'clean',steps:[],artifacts:[],error:message});
    fs.writeFileSync(path.join(folder,'stdout.txt'),diagnosticText(stdout));fs.writeFileSync(path.join(folder,'stderr.txt'),diagnosticText(stderr||message));
    const result:GateResult={verdict:'quarantined',reason:message,detail:{staticProblems:[],mutationsApplied:[],cleanStatus:'Not Collected',phase:'collection',code:'GLOBAL_SETUP_FAILURE',playwrightMessage:message,diagnostics:`runs/${runId}`}};
    const run:RunRevision={runId,revisionId:loaded.state.revisionId,environmentId:scope.environmentId,sourceEnvironmentId:context.sourceEnvironmentId,...provenance,executionContext:context,at:new Date().toISOString(),result,executionSelection:selected?.selection,executionProfile:selected?.profile};
    const current=load(scope,id);atomicText(path.join(loaded.directory,'state.json'),JSON.stringify({...current.state,eligible:false,runs:[...current.state.runs,run]},null,2)+'\n');
    return run;
  }finally{
    locks.delete(id);
    const checked=path.relative(os.tmpdir(),path.resolve(temporary));
    if(!checked.startsWith('..')&&!path.isAbsolute(checked)&&path.basename(temporary).startsWith('aura-quarantine-'))fs.rmSync(temporary,{recursive:true,force:true});
  }
}
export async function openQuarantineTrace(scope:ApplicationScope,id:string,runId?:string) {
  const details=quarantineDetails(scope,id,runId),trace=details.runtime?.trace;
  if(!trace||!details.gate?.detail.diagnostics)throw Error('No sanitized trace was retained for this run.');
  const file=containedFile(diagnosticRoot(scope),`${details.gate.detail.diagnostics}/${trace}`);
  if(!fs.existsSync(file)||!file.endsWith('.zip'))throw Error('The sanitized trace is unavailable.');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,[require.resolve('@playwright/test/cli'),'show-trace',file],{cwd:ROOT,windowsHide:true,stdio:'ignore'});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
  return {message:'Playwright trace viewer launched for this sanitized run.'};
}
/**
 * Which APPLICATION-OWNED dependencies have moved on since this draft. Read-only.
 *
 * Scoped to application-owned artifacts on purpose: those accompany the promoted test and
 * must be the ones it was proven against. Shared framework is deliberately excluded - it is
 * supplied from the current checkout at run time, so "drift" there is answered by re-running,
 * never by freezing a copy into the draft.
 */
/**
 * MAY THIS FILE BE REFRESHED INTO THE DRAFT AND LATER WRITTEN BY PROMOTION?
 *
 * One predicate, phrased as promotion's own write contract plus application ownership, so
 * the two paths agree BY CONSTRUCTION rather than by both remembering the same rules. They
 * did not: refresh accepted any changed application-owned file, and promotion then refused
 * the revision for containing a protected artifact - a draft that could never be promoted,
 * created by the very mechanism meant to make promotion possible.
 *
 * The three conditions are the ones promotion already trusts: the ownership contract, this
 * CASE's dependency graph, and the graph node's editability (with promotion's own two
 * exceptions). A file outside the graph has no promotable identity for this case however
 * legitimately it changed - it simply belongs to some other test.
 */
type RefusalReason='NOT_APPLICATION_OWNED'|'NOT_IN_CASE_DEPENDENCY_GRAPH'|'PROTECTED_NON_EDITABLE_ARTIFACT';
function promotionWritable(scope:ApplicationScope,graph:ReturnType<typeof codeGraph>,file:string):boolean {
  const node=graph.files.find(item=>item.id===file);
  return !!node?.editable||path.resolve(ROOT,file)===manualStatusPath(scope)
    ||(node?.category==='Recording'&&file.endsWith('.owners.json'));
}
export function isPromotableApplicationDependency(scope:ApplicationScope,graph:ReturnType<typeof codeGraph>,file:string):
    {ok:true}|{ok:false;reason:RefusalReason} {
  if(dependencyOwnership(scope,file)!=='APPLICATION_OWNED')return {ok:false,reason:'NOT_APPLICATION_OWNED'};
  if(!graph.files.some(item=>item.id===file))return {ok:false,reason:'NOT_IN_CASE_DEPENDENCY_GRAPH'};
  if(!promotionWritable(scope,graph,file))return {ok:false,reason:'PROTECTED_NON_EDITABLE_ARTIFACT'};
  return {ok:true};
}
/**
 * Which application dependencies have moved on, split by whether they can actually be used.
 *
 * `drifted` is what Refresh may take; `notApplicableToCase` is context only and never enters
 * a revision. Shared framework appears in neither: it is supplied from the current checkout.
 */
export function quarantineDependencyDrift(scope:ApplicationScope,id:string) {
  const loaded=load(scope,id),drifted:ArtifactRecord[]=[];
  const notApplicableToCase:Array<{path:string;reason:RefusalReason}>=[];
  for(const [absolute,text]of loaded.overlay){
    const file=relative(absolute);
    if(file===loaded.original.entry)continue;
    if(dependencyOwnership(scope,file)!=='APPLICATION_OWNED')continue;   // shared framework is never offered
    if(!fs.existsSync(absolute))continue;
    const actual=fs.readFileSync(absolute,'utf8');
    if(hashContent(actual)===hashContent(text))continue;
    const verdict=isPromotableApplicationDependency(scope,loaded.graph,file);
    if(verdict.ok)drifted.push({path:file,hash:hashContent(actual),ownership:'APPLICATION_OWNED'});
    else notApplicableToCase.push({path:file,reason:verdict.reason});
  }
  return {revisionId:loaded.state.revisionId,drifted,notApplicableToCase};
}
/**
 * Bring reviewed CURRENT application-owned dependencies into a NEW revision.
 *
 * The supported answer to application drift, and deliberately not a quiet one: it creates a
 * revision rather than editing history, records WHICH files were reviewed and at what hash,
 * and resets eligibility - because the previous pass proved the previous dependencies, and
 * nothing has yet proven these. The earlier attempt and its evidence stay in the history.
 */
export function refreshQuarantineDependencies(scope:ApplicationScope,id:string,revisionId:string) {
  if(locks.has(id))throw Error('Wait for this quarantine validation to finish.');
  const loaded=load(scope,id);
  if(loaded.state.revisionId!==revisionId)throw Error('Draft changed in another editor. Reload before refreshing dependencies.');
  const {drifted}=quarantineDependencyDrift(scope,id);
  // Inherit only what promotion could write. A prior revision may already carry a file that
  // promotion refuses - an earlier over-broad refresh did exactly that - and carrying it
  // forward would make every descendant unpromotable too. The entry spec is kept: promotion
  // writes it by its own path. Nothing is deleted; the old revision still holds it.
  const files:Record<string,string>={};
  const dropped:Array<{path:string;reason:RefusalReason}>=[];
  for(const [file,text]of Object.entries(loaded.revision.files)){
    if(file===loaded.original.entry){files[file]=text;continue;}
    const verdict=isPromotableApplicationDependency(scope,loaded.graph,file);
    if(verdict.ok)files[file]=text;else dropped.push({path:file,reason:verdict.reason});
  }
  // Dropping an unpromotable inherited file is itself a repair, so a draft that carries one
  // can be corrected even when nothing has drifted since. Only a no-op is refused.
  if(!drifted.length&&!dropped.length)
    throw Error('Nothing to refresh: no application dependency differs from the current checkout, and this revision carries no unpromotable file.');
  for(const record of drifted){
    const verdict=isPromotableApplicationDependency(scope,loaded.graph,record.path);
    if(!verdict.ok)throw Error(`Refusing to refresh ${record.path}: ${verdict.reason}. Only promotable application dependencies of this case may enter a draft.`);
    files[record.path]=fs.readFileSync(containedFile(ROOT,record.path),'utf8');
  }
  const next=randomUUID();
  const revision:Revision={revisionId:next,parent:revisionId,createdAt:new Date().toISOString(),
    provenance:'APPLICATION_DEPENDENCY_REFRESH',reviewed:drifted,files};
  // Named so the reset is one reviewable statement: new revision, eligibility cleared.
  const refreshedState={...revisionState(loaded.state),revisionId:next};
  commitTexts(new Map([[path.join(loaded.directory,'revisions',`${next}.json`),JSON.stringify(revision,null,2)+'\n'],
    [path.join(loaded.directory,'state.json'),JSON.stringify(refreshedState,null,2)+'\n']]));
  return {revisionId:next,provenance:revision.provenance,reviewed:drifted,dropped};
}
/**
 * WHAT A PROMOTION WOULD WRITE, decided once and read two ways.
 *
 * The publication set is NOT the revision delta. A revision legitimately carries zero changed
 * files - an ORIGINAL_GENERATED draft that passed re-validation unedited is the normal case -
 * while still describing a complete test through `original snapshot + ordered deltas`. That
 * composition is what `load()` calls the overlay, and it is what validation executed, so it is
 * what promotion must publish. Requiring every unchanged file to be duplicated into the delta
 * would make an unedited pass unpromotable and would rewrite history to say otherwise.
 *
 * Ownership decides the rest:
 *
 *   TEST_OWNED          the generated spec, always published from the effective revision,
 *                       whether it lives in the delta or only in the original snapshot.
 *   APPLICATION_OWNED   only what the revision INTENTIONALLY carries. An unchanged dependency
 *                       is left alone; promotion is not a bulk restore.
 *   SHARED_FRAMEWORK    never written. Under CURRENT_FRAMEWORK_VALIDATION the run deliberately
 *                       executed the current checkout's framework, so the historical copy in
 *                       the package is evidence, not a payload. It is verified and nothing more.
 *
 * `quarantinePromotionPlan` and `promoteQuarantine` share this one function, so what the plan
 * describes and what the commit writes cannot drift apart.
 */
export interface PromotionPlan {
  revisionId: string;
  testCaseId: string;
  testOwned: Array<{ path: string; sourceRevision: 'original snapshot' | 'revision delta'; hash: string }>;
  applicationOwned: Array<{ path: string; hash: string }>;
  sharedFramework: { verifiedOnly: string[] };
  mapping: { testCaseId: string; testFile: string; status: 'Generated' } | null;
  blocked: Array<{ code: string; message: string }>;
}
function planPromotion(scope: ApplicationScope, id: string) {
  const loaded = load(scope, id), run = loaded.state.runs.at(-1);
  const blocked: Array<{ code: string; message: string }> = [];
  const plan: PromotionPlan = { revisionId: loaded.state.revisionId, testCaseId: loaded.original.testCaseId,
    testOwned: [], applicationOwned: [], sharedFramework: { verifiedOnly: [] }, mapping: null, blocked };
  const stop = (code: string, message: string) => { blocked.push({ code, message }); return { loaded, plan, changes: new Map<string, string>() }; };

  if (locks.has(id) || !loaded.state.eligible || run?.revisionId !== loaded.state.revisionId
      || run.result.verdict !== 'accepted' || run.environmentId !== scope.environmentId)
    return stop('NOT_VALIDATED', 'This exact draft and environment must pass clean execution and assertion mutation before explicit promotion.');
  if (run.executionBasis !== 'CURRENT_FRAMEWORK_VALIDATION')
    return stop('HISTORICAL_REPLAY_NOT_PROMOTABLE', `Promotion requires a CURRENT_FRAMEWORK_VALIDATION attempt; this draft's last run was ${run.executionBasis ?? 'recorded before execution bases existed'}. A historical replay proves reproduction, never readiness.`);
  if (!run.currentFrameworkArtifacts || !run.retainedApplicationArtifacts)
    return stop('VALIDATION_EVIDENCE_MISSING', 'VALIDATION_EVIDENCE_MISSING: this attempt recorded no executed artifact hashes, so promotion cannot verify what it ran against. Re-run CURRENT_FRAMEWORK_VALIDATION.');

  const drift = (records: ArtifactRecord[], code: string, graphScoped: boolean) => {
    for (const record of records) {
      if (record.ownership === 'TEST_OWNED') continue;
      if (graphScoped && !loaded.graph.files.some(node => node.id === record.path)) continue;
      const target = path.resolve(ROOT, record.path);
      const actual = fs.existsSync(target) ? hashContent(fs.readFileSync(target, 'utf8')) : null;
      if (actual !== record.hash)
        blocked.push({ code, message: `${code}: ${record.path} (${record.ownership}) differs from the copy the qualifying validation executed. Review it and re-run CURRENT_FRAMEWORK_VALIDATION.` });
      else if (record.ownership === 'SHARED_FRAMEWORK') plan.sharedFramework.verifiedOnly.push(record.path);
    }
  };
  drift(run.currentFrameworkArtifacts, 'FRAMEWORK_CHANGED_AFTER_VALIDATION', false);
  drift(run.retainedApplicationArtifacts, 'APPLICATION_CHANGED_AFTER_VALIDATION', true);
  if (blocked.length) return { loaded, plan, changes: new Map<string, string>() };

  const changes = new Map<string, string>();
  for (const [file, text] of Object.entries(loaded.revision.files)) {
    if (file === loaded.original.entry) continue;   // published below, from the effective revision
    const node = loaded.graph.files.find(node => node.id === file);
    if (!node?.editable && path.resolve(ROOT, file) !== manualStatusPath(scope) && !(node?.category === 'Recording' && file.endsWith('.owners.json')))
      return stop('PROTECTED_ARTIFACT', 'Promotion contains a protected artifact.');
    const target = path.resolve(ROOT, file), version = fs.existsSync(target) ? hashContent(fs.readFileSync(target, 'utf8')) : null;
    if (version !== (loaded.original.liveVersions[file] ?? null) && version !== hashContent(text))
      return stop('APPLICATION_SOURCE_CHANGED', 'Application source changed after quarantine. Review the current source before promotion.');
    changes.set(target, text);
    plan.applicationOwned.push({ path: file, hash: hashContent(text) });
  }
  // THE TEST-OWNED SPEC, from the EFFECTIVE revision rather than the delta.
  const spec = path.resolve(ROOT, loaded.original.entry), effective = loaded.overlay.get(spec);
  if (effective === undefined)
    return stop('VALIDATED_SPEC_MISSING', `VALIDATED_SPEC_MISSING: ${loaded.original.entry} is absent from the validated revision, so there is no test to publish.`);
  if (fs.existsSync(spec) && hashContent(fs.readFileSync(spec, 'utf8')) !== loaded.original.liveVersions[loaded.original.entry])
    return stop('NEWER_SPEC_EXISTS', 'A newer generated spec exists; it will not be overwritten.');
  changes.set(spec, effective);
  plan.testOwned.push({ path: loaded.original.entry, hash: hashContent(effective),
    sourceRevision: Object.hasOwn(loaded.revision.files, loaded.original.entry) ? 'revision delta' : 'original snapshot' });

  const mapping = readMapping(scope.paths.mappingFile);
  upsertEntry(mapping, loaded.original.testCaseId, { testFile: loaded.original.entry, testName: `${loaded.original.testCaseId} - ${loaded.original.scenario}`, module: loaded.original.module ?? '', scenario: loaded.original.scenario, status: 'Generated', sourceWorkbook: loaded.original.workbook ?? '', sourceWorksheet: loaded.original.sourceWorksheet ?? '', sourceRow: loaded.original.sourceRow }, new Date().toISOString());
  changes.set(scope.paths.mappingFile, JSON.stringify(mapping, null, 2) + '\n');
  plan.mapping = { testCaseId: loaded.original.testCaseId, testFile: loaded.original.entry, status: 'Generated' };
  const state = readState(), key = scopedKey(scope.applicationId, loaded.original.testCaseId);
  if (state[key]) { state[key] = { ...state[key], verdict: 'accepted', specFile: loaded.original.entry, reason: 'Explicitly promoted USER_EDITED_QUARANTINE after clean execution and assertion mutation.', at: new Date().toISOString() }; changes.set(path.join(ROOT, 'ai/autocode/state.json'), JSON.stringify(state, null, 2) + '\n'); }
  changes.set(path.join(loaded.directory, 'state.json'), JSON.stringify({ ...loaded.state, eligible: false, promoted: true }, null, 2) + '\n');
  return { loaded, plan, changes };
}
/** Read-only: what promotion would write, or why it will not. Writes nothing, prints no values. */
export function quarantinePromotionPlan(scope: ApplicationScope, id: string): PromotionPlan {
  return planPromotion(scope, id).plan;
}
export function promoteQuarantine(scope: ApplicationScope, id: string) {
  const { plan, changes } = planPromotion(scope, id);
  if (plan.blocked.length) throw Error(plan.blocked[0].message);
  commitTexts(changes);
  return { status: 'Generated', message: 'Explicitly restored to the generated suite. This is not an Automated suite acceptance.', plan };
}
