/** Managed application test data. This is independent of locator/Page knowledge and derived workbook caches. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { artefactRoot, type ApplicationScope } from '../projects/scope';
import { readRegistry } from '../projects/registry';
import { encryptPassword, decryptPassword, type SecretPayload } from './encryption';
import { registerCredentialSecrets } from './secrets';

export type DataValue = string | number | boolean | null | DataValue[] | {[key:string]:DataValue};
export type DataFields = Record<string,DataValue>;
interface CredentialProfile { id:string; name:string; role:string; tags:string[]; description:string; active:boolean; environments:Record<string,{username:string;secretPayload:SecretPayload}>; }
export interface DataProfile { id:string; name:string; tags:string[]; description:string; data:DataFields; }
export interface ExecutionRow { id:string; credentialProfileId:string|null; dataProfileId:string|null; tags:string[]; overrides:DataFields; enabled:boolean; }
interface Store {schemaVersion:1; applicationId:string; revision:number; credentialProfiles:CredentialProfile[]; dataProfiles:DataProfile[]; testCases:Record<string,{tags:string[];executionRows:ExecutionRow[]}>;audit:Array<{at:string;event:string;profileId?:string;environmentId?:string}>;}
export interface CredentialInput {id?:string;name:string;role?:string;tags?:string[];description?:string;active?:boolean;environments?:Record<string,{username?:string;password?:string;remove?:boolean}>;}
export type StoreChange = {kind:'credential';profile:CredentialInput}|{kind:'duplicateCredential';id:string;name:string}|{kind:'deleteCredential';id:string}|{kind:'data';profile:Omit<DataProfile,'id'> & {id?:string}}|{kind:'deleteData';id:string}|{kind:'examples';testCaseId:string;tags?:string[];rows:ExecutionRow[]};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const context=(scope:ApplicationScope,id:string,environment:string)=>JSON.stringify(['MoolyaAura',1,scope.applicationId,id,environment]);
const idPattern=/^(?:cred|data|row)_[a-f0-9-]{36}$/;
const casePattern=/^(?:TC|TS)[_-][A-Za-z0-9_-]+$/;
const own=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
function fail(message:string):never { throw Error(message); }
function label(value:unknown,field:string,required=true):string {
  if(typeof value!=='string'||value.length>500||/[\x00-\x1f]/.test(value)||(required&&!value.trim()))fail(`${field} is invalid.`);
  return value.trim();
}
export function tags(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>100)fail('Tags must be a list.');
 return [...new Set(value.map(v=>{const t=label(v,'Tag').replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_-]+$/.test(t))fail('Invalid tag.');return t;}))];
}
export function dataFields(value:unknown):DataFields {
 let count=0;
 const visit=(v:any,depth:number):DataValue=>{
  if(++count>5000||depth>8)fail('Test data is too large or deeply nested.');
  if(v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=10000||typeof v==='number'&&Number.isFinite(v))return v;
  if(Array.isArray(v))return v.map(item=>visit(item,depth+1));
  if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype){const out:DataFields={};for(const [key,item]of Object.entries(v)){
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)||/^(?:constructor|prototype|__proto__|password|passwd|secret|token|cookie|authorization|username|email)$/i.test(key))fail('Use Credential Profiles for credentials; data keys must be safe identifiers.');
   out[key]=visit(item,depth+1);
  }return out;}return fail('Test data must contain JSON values only.');
 };
 if(!value||Array.isArray(value)||typeof value!=='object')fail('Test data must be an object.');
 return visit(value,0) as DataFields;
}
export function testDataFile(scope:ApplicationScope):string {
 if(!/^[a-z0-9][a-z0-9_-]*$/.test(scope.applicationId)||!readRegistry().applications.some(a=>a.applicationId===scope.applicationId))fail('Unknown Test Data application scope.');
 const root=path.join(artefactRoot(),'ai','test-data'),file=path.join(root,scope.applicationId,'test-data.json');
 let current=file;while(current!==path.dirname(current)){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())fail('Test Data symlinks are not allowed.');if(current===root)break;current=path.dirname(current);}
 return file;
}
function empty(scope:ApplicationScope):Store{return {schemaVersion:1,applicationId:scope.applicationId,revision:0,credentialProfiles:[],dataProfiles:[],testCases:{},audit:[]};}
function validate(scope:ApplicationScope,value:any):asserts value is Store {
 if(value?.schemaVersion!==1)fail('Unsupported Test Data schemaVersion. No files were changed.');
 if(value.applicationId!==scope.applicationId)fail('Test Data belongs to another application.');
 if(!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.credentialProfiles)||!Array.isArray(value.dataProfiles)||!value.testCases||!Array.isArray(value.audit))fail('Invalid Test Data schema.');
 const ids=new Set<string>();const take=(id:string,prefix:string)=>{if(!idPattern.test(id)||!id.startsWith(prefix+'_')||ids.has(id))fail('Invalid or duplicate stable profile/row ID.');ids.add(id);};
 const app=readRegistry().applications.find(a=>a.applicationId===scope.applicationId)!;
 const names=new Set<string>();
 for(const p of value.credentialProfiles){take(p.id,'cred');label(p.name,'Profile name');label(p.role,'Role');tags(p.tags);label(p.description,'Description',false);if(names.has(p.name.toLowerCase()))fail('Credential profile name already exists.');names.add(p.name.toLowerCase());if(typeof p.active!=='boolean'||!p.environments)fail('Invalid credential profile.');
  for(const [env,binding]of Object.entries(p.environments) as Array<[string,any]>){if(!own(app.environments,env)||typeof binding.username!=='string'||!binding.username.trim()||binding.username.length>1000||binding.secretPayload?.provider!=='WINDOWS_DPAPI_CURRENT_USER'||!/^[A-Za-z0-9+/]+={0,2}$/.test(binding.secretPayload.ciphertext)||own(binding,'password'))fail('Invalid environment credential binding.');}
 }
 const dataNames=new Set<string>();for(const p of value.dataProfiles){take(p.id,'data');label(p.name,'Data profile name');if(dataNames.has(p.name.toLowerCase()))fail('Data profile name already exists.');dataNames.add(p.name.toLowerCase());tags(p.tags);dataFields(p.data);}
 for(const [testCaseId,entry]of Object.entries(value.testCases) as Array<[string,any]>){if(!casePattern.test(testCaseId)||!Array.isArray(entry.executionRows))fail('Invalid Test Case Examples.');tags(entry.tags);
  for(const row of entry.executionRows){take(row.id,'row');if(typeof row.enabled!=='boolean')fail('Invalid Example enabled state.');tags(row.tags);dataFields(row.overrides);if(row.credentialProfileId!==null&&!value.credentialProfiles.some(p=>p.id===row.credentialProfileId))fail('Credential profile is missing or belongs to another application.');if(row.dataProfileId!==null&&!value.dataProfiles.some(p=>p.id===row.dataProfileId))fail('Data profile is missing or belongs to another application.');}
 }
}
function load(scope:ApplicationScope):{store:Store;version:string;text:string}{
 const file=testDataFile(scope),text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
 let store:Store;try{store=text?JSON.parse(text):empty(scope);}catch{fail('Test Data JSON is invalid. Existing file was preserved.');}
 validate(scope,store);return {store,version:digest(text),text};
}
function references(store:Store,id:string){return Object.entries(store.testCases).flatMap(([testCaseId,e])=>{const count=e.executionRows.filter(r=>r.credentialProfileId===id||r.dataProfileId===id).length;return count?[{testCaseId,count}]:[];});}
function catalog(store:Store,version:string){return {schemaVersion:store.schemaVersion,applicationId:store.applicationId,version,
 credentialProfiles:store.credentialProfiles.map(p=>({id:p.id,name:p.name,role:p.role,tags:p.tags,description:p.description,active:p.active,references:references(store,p.id),environments:Object.fromEntries(Object.entries(p.environments).map(([env,c])=>[env,{usernameConfigured:!!c.username,passwordConfigured:!!c.secretPayload}]))})),
 dataProfiles:store.dataProfiles.map(p=>({...p,references:references(store,p.id)})),testCases:store.testCases,audit:store.audit};}
export function readTestData(scope:ApplicationScope){const {store,version}=load(scope);return catalog(store,version);}
function historyReferences(scope:ApplicationScope,id:string):boolean {
 // Historical JSON contains only safe IDs. Do not delete profiles required to explain past attempts.
 const roots=[path.join(artefactRoot(),'ai','dashboard','runs'),path.join(artefactRoot(),'ai','diagnostics','artifacts',scope.applicationId,'quarantine')];
 const scan=(dir:string):boolean=>fs.existsSync(dir)&&fs.readdirSync(dir,{withFileTypes:true}).some(e=>!e.isSymbolicLink()&&(e.isDirectory()?scan(path.join(dir,e.name)):e.name.endsWith('.json')&&fs.readFileSync(path.join(dir,e.name),'utf8').includes(id)));
 return roots.some(scan);
}
export function updateTestData(scope:ApplicationScope,expectedVersion:string,change:StoreChange){
 const file=testDataFile(scope);fs.mkdirSync(path.dirname(file),{recursive:true});const lock=file+'.lock';let fd:number;
 try{fd=fs.openSync(lock,'wx');}catch{throw Error('The Test Data store is being updated. Reload and retry.');}
 try{
  const loaded=load(scope);if(expectedVersion!==loaded.version)fail('The Test Data store changed. Reload and merge your changes.');
  const store=structuredClone(loaded.store);const audit=(event:string,profileId?:string,environmentId?:string)=>store.audit.push({at:new Date().toISOString(),event,profileId,environmentId});
  if(change.kind==='credential'){
   const input=change.profile,existing=input.id?store.credentialProfiles.find(p=>p.id===input.id):undefined;
   if(input.id&&!existing)fail('Credential profile is missing or belongs to another application.');
   const profile:CredentialProfile=existing||{id:'cred_'+randomUUID(),name:'',role:'custom',tags:[],description:'',active:true,environments:{}};
   const name=label(input.name,'Profile name');if(existing&&profile.name!==name)audit('Profile renamed',profile.id);
   profile.name=name;profile.role=label(input.role??profile.role,'Role');profile.tags=tags(input.tags??profile.tags);profile.description=label(input.description??profile.description,'Description',false);profile.active=input.active??profile.active;
   if(existing&&!profile.active)audit('Profile deactivated',profile.id);
   for(const [env,binding]of Object.entries(input.environments??{})){
    if(!own(readRegistry().applications.find(a=>a.applicationId===scope.applicationId)!.environments,env))fail('Environment does not belong to this application.');
    if(binding.remove){delete profile.environments[env];audit('Environment removed',profile.id,env);continue;}
    const previous=profile.environments[env],username=binding.username===undefined?previous?.username:binding.username;
    if(typeof username!=='string'||!username.trim()||username.length>1000)fail('Username is required for this environment.');
    if(binding.password!==undefined&&(typeof binding.password!=='string'||!binding.password||binding.password.length>10000))fail('A nonempty password is required.');
    const secretPayload=binding.password!==undefined?encryptPassword(binding.password,context(scope,profile.id,env)):previous?.secretPayload;
    if(!secretPayload)fail('Password is required for this environment.');
    profile.environments[env]={username,secretPayload};if(binding.password!==undefined)audit('Password changed',profile.id,env);if(!previous)audit('Environment added',profile.id,env);
   }
   if(!existing){store.credentialProfiles.push(profile);audit('Profile created',profile.id);}
  }else if(change.kind==='duplicateCredential'){
   const source=store.credentialProfiles.find(p=>p.id===change.id);if(!source)fail('Credential profile is missing or foreign.');
   const p:CredentialProfile={...structuredClone(source),id:'cred_'+randomUUID(),name:label(change.name,'Profile name'),environments:{}};
   for(const [env,b]of Object.entries(source.environments))p.environments[env]={username:b.username,secretPayload:encryptPassword(decryptPassword(b.secretPayload,context(scope,source.id,env)),context(scope,p.id,env))};
   store.credentialProfiles.push(p);audit('Profile duplicated',p.id);
  }else if(change.kind==='deleteCredential'||change.kind==='deleteData'){
   if(references(store,change.id).length||historyReferences(scope,change.id))fail('This profile has Example or execution references. Deactivate it or resolve references first.');
   if(change.kind==='deleteCredential')store.credentialProfiles=store.credentialProfiles.filter(p=>p.id!==change.id);else store.dataProfiles=store.dataProfiles.filter(p=>p.id!==change.id);audit('Unreferenced profile deleted',change.id);
  }else if(change.kind==='data'){
   const p=change.profile,existing=p.id?store.dataProfiles.find(x=>x.id===p.id):undefined;if(p.id&&!existing)fail('Data profile is missing or belongs to another application.');
   const next:DataProfile={id:existing?.id??'data_'+randomUUID(),name:label(p.name,'Data profile name'),description:label(p.description??'','Description',false),tags:tags(p.tags??[]),data:dataFields(p.data)};
   if(existing)Object.assign(existing,next);else store.dataProfiles.push(next);audit('Data profile saved',next.id);
  }else if(change.kind==='examples'){
   if(!casePattern.test(change.testCaseId))fail('Invalid test case ID.');
   store.testCases[change.testCaseId]={tags:tags(change.tags??store.testCases[change.testCaseId]?.tags??[]),executionRows:change.rows.map(row=>({...row,id:row.id||'row_'+randomUUID(),tags:tags(row.tags??[]),overrides:dataFields(row.overrides??{}),enabled:row.enabled!==false,credentialProfileId:row.credentialProfileId??null,dataProfileId:row.dataProfileId??null}))};audit('Examples saved');
  }else fail('Unknown Test Data operation.');
  store.revision++;store.audit=store.audit.slice(-1000);validate(scope,store);
  const text=JSON.stringify(store,null,2)+'\n',temporary=file+'.'+randomUUID()+'.tmp';let committed=false;
  try{
   const temp=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(temp,text);fs.fsyncSync(temp);}finally{fs.closeSync(temp);}
   validate(scope,JSON.parse(fs.readFileSync(temporary,'utf8')));
   if(load(scope).version!==expectedVersion)fail('The Test Data store changed. Reload and merge your changes.');
   fs.renameSync(temporary,file);committed=true;const saved=load(scope);if(saved.text!==text)fail('Test Data readback did not match the saved revision.');return catalog(saved.store,saved.version);
  }catch(error){if(committed){if(loaded.text){fs.writeFileSync(temporary,loaded.text,{mode:0o600});fs.renameSync(temporary,file);}else fs.unlinkSync(file);}throw error;}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
export function resolveProfileCredentials(scope:ApplicationScope,id:string){
 try{
  const p=load(scope).store.credentialProfiles.find(p=>p.id===id);if(!p)fail('Selected profile is missing or belongs to another application.');if(!p.active)fail('Selected profile is inactive.');
  const binding=p.environments[scope.environmentId];if(!binding?.username)fail('Selected profile has no username for this environment.');if(!binding.secretPayload)fail('Selected profile has no password for this environment.');
  const password=decryptPassword(binding.secretPayload,context(scope,id,scope.environmentId));if(!password)fail('Selected profile password is unavailable.');
  registerCredentialSecrets(binding.username,password);return {email:binding.username,password};
 }catch(error){throw Error('CREDENTIAL_CONFIGURATION_FAILURE: '+(error as Error).message);}
}
export function credentialPreflight(scope:ApplicationScope,id:string){resolveProfileCredentials(scope,id);return {profileId:id,environmentId:scope.environmentId,profile:'Active',username:'Available',password:'Available'};}
