import { activeScope, type ApplicationScope } from '../projects/scope';
import { readTestData, credentialPreflight, resolveProfileCredentials, dataFields, tags, type DataFields, type ExecutionRow } from './store';
import { matchesTagExpression } from '../excel/filter';

export interface ExecutionSelection {applicationId:string;environmentId:string;testCaseId:string;storeVersion:string;row:ExecutionRow;}
export interface ExecutionProfile {applicationId:string;environmentId:string;testCaseId:string;executionRowId:string;credentialProfileId:string|null;credentialProfileName?:string;role?:string;dataProfileId:string|null;dataProfileName?:string;tags:string[];}
export interface SelectionRequest {mode:'examples'|'selected'|'matrix';credentialProfileIds?:string[];dataProfileIds?:string[];rows?:ExecutionRow[];tagExpression?:string;expectedVersion:string;}
export function executionPlan(scope:ApplicationScope,testCaseIds:string[],request:SelectionRequest,caseTags:Record<string,string[]>={}) {
 const catalog=readTestData(scope);if(catalog.version!==request.expectedVersion)throw Error('The Test Data store changed. Reload execution selections.');
 if(!['examples','selected','matrix'].includes(request.mode))throw Error('Select Examples, selected rows or an explicit matrix.');
 const plan:Array<{selection:ExecutionSelection;profile:ExecutionProfile;preflight?:ReturnType<typeof credentialPreflight>}>=[];
 for(const testCaseId of testCaseIds){
  let rows:ExecutionRow[];
  if(request.mode==='examples')rows=catalog.testCases[testCaseId]?.executionRows.filter(r=>r.enabled)??[];
  else if(request.rows)rows=request.rows.filter(r=>r.enabled!==false);
  else {
   const users=request.credentialProfileIds?.length?request.credentialProfileIds:[null];
   const data=request.dataProfileIds?.length?request.dataProfileIds:[null];
   if(request.mode!=='matrix'&&data.length>1)throw Error('Multiple data profiles require explicit matrix expansion or selected rows.');
   rows=users.flatMap((credentialProfileId,i)=>data.map((dataProfileId,j)=>({id:`override-${i+1}-${j+1}`,credentialProfileId,dataProfileId,tags:[],overrides:{},enabled:true})));
  }
  for(const row of rows){
   const credential=row.credentialProfileId?catalog.credentialProfiles.find(p=>p.id===row.credentialProfileId):undefined;
   const data=row.dataProfileId?catalog.dataProfiles.find(p=>p.id===row.dataProfileId):undefined;
   if(row.credentialProfileId&&!credential)throw Error('CREDENTIAL_CONFIGURATION_FAILURE: Selected profile is missing or belongs to another application.');
   if(row.dataProfileId&&!data)throw Error('DATA_CONFIGURATION_FAILURE: Selected data profile is missing or belongs to another application.');
   const combined=tags([...(caseTags[testCaseId]??[]),...(catalog.testCases[testCaseId]?.tags??[]),...(credential?.tags??[]),...(data?.tags??[]),...(row.tags??[])]);
   if(!matchesTagExpression(request.tagExpression??'',combined))continue;
   const normalized={...row,overrides:dataFields(row.overrides??{}),tags:combined};
   const preflight=credential?credentialPreflight(scope,credential.id):undefined;
   plan.push({selection:{applicationId:scope.applicationId,environmentId:scope.environmentId,testCaseId,storeVersion:catalog.version,row:normalized},
    profile:{applicationId:scope.applicationId,environmentId:scope.environmentId,testCaseId,executionRowId:row.id,credentialProfileId:credential?.id??null,credentialProfileName:credential?.name,role:credential?.role,dataProfileId:data?.id??null,dataProfileName:data?.name,tags:combined},preflight});
  }
 }
 if(!plan.length)throw Error('No enabled execution rows match the selection.');
 if(plan.length>100)throw Error('This selection exceeds 100 execution instances. Narrow the rows or matrix.');
 return plan;
}
/**
 * THE CREDENTIAL SELECTION FOR ONE GENERATION ATTEMPT, from a profile ID alone.
 *
 * Generating a newly recorded case and executing existing ones are different workflows that
 * were sharing one dialog. The Execution Data modal is built for the second: it asks which
 * of the CHECKED workbook rows to run, and `/api/test-data/preview` rightly refuses an empty
 * list. But it was also the only way to attach a credential profile to generation, so a case
 * that had just been recorded - not yet in the workbook, checked nowhere - could not be given
 * one. This is the first workflow's own route: a profile, no case selection, no dialog.
 *
 * Deliberately an ephemeral `selected` request rather than a saved Example. An Example would
 * pin the logical test to one account for every future run; this selection lives only as long
 * as the generation that asked for it. Validity is not decided here - `executionPlan` and
 * `credentialPreflight` do that, and refuse rather than substitute.
 */
export function generationSelection(scope:ApplicationScope,credentialProfileId?:string|null):SelectionRequest|undefined {
 const id=(credentialProfileId??'').trim();
 if(!id)return undefined;
 return {mode:'selected',credentialProfileIds:[id],expectedVersion:readTestData(scope).version};
}
/** The environment carries only an execution selector, never reusable credential values. */
export function runtimeSelection():ExecutionSelection|null {
 const raw=process.env.AURA_EXECUTION_SELECTION;if(!raw)return null;
 let selected:ExecutionSelection;try{selected=JSON.parse(raw);}catch{throw Error('DATA_CONFIGURATION_FAILURE: Invalid execution selection.');}
 const scope=activeScope();
 if(selected.applicationId!==scope.applicationId||selected.environmentId!==scope.environmentId)throw Error('CREDENTIAL_CONFIGURATION_FAILURE: Execution profile belongs to another application or environment.');
 if(!selected.row||!selected.testCaseId)throw Error('DATA_CONFIGURATION_FAILURE: Invalid execution row.');
 if(selected.storeVersion!==readTestData(scope).version)throw Error('DATA_CONFIGURATION_FAILURE: Test Data changed after preflight. Select the current revision and retry.');
 return selected;
}
export function resolveExecutionData(scope:ApplicationScope,selection:ExecutionSelection){
 if(selection.applicationId!==scope.applicationId||selection.environmentId!==scope.environmentId)throw Error('DATA_CONFIGURATION_FAILURE: Foreign execution selection.');
 const catalog=readTestData(scope);if(selection.storeVersion!==catalog.version)throw Error('DATA_CONFIGURATION_FAILURE: Test Data changed after preflight.');
 const {row}=selection;
 const credential=row.credentialProfileId?catalog.credentialProfiles.find(p=>p.id===row.credentialProfileId):undefined;
 const data=row.dataProfileId?catalog.dataProfiles.find(p=>p.id===row.dataProfileId):undefined;
 if(row.dataProfileId&&!data)throw Error('DATA_CONFIGURATION_FAILURE: Data profile is unavailable.');
 const appCredentials=row.credentialProfileId?resolveProfileCredentials(scope,row.credentialProfileId):null;
 const testData:DataFields={...dataFields(data?.data??{}),...dataFields(row.overrides??{})};
 const executionProfile:ExecutionProfile={applicationId:scope.applicationId,environmentId:scope.environmentId,testCaseId:selection.testCaseId,executionRowId:row.id,credentialProfileId:row.credentialProfileId,credentialProfileName:credential?.name,role:credential?.role,dataProfileId:row.dataProfileId,dataProfileName:data?.name,tags:row.tags};
 return {appCredentials,testData,executionProfile};
}
