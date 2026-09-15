import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ownershipReview, pageCatalog, createAuthoringPage } from './page-ownership';
import { codeGraph, readCode, codeDefinition, saveCode } from './code-workspace';
import { workspaceData } from '../testing/workspace-data';
import { hashContent, loadOwners, ownersPath, commitTexts } from '../knowledge/authoring-owners';
import { mapRecording } from '../autocode/from-recording';
import { analyseCorpus } from '../autocode/abstraction/propose';
import { applyProposals } from '../autocode/abstraction/writer';
import { revalidate } from '../autocode/abstraction/semantic';
import { writeFixtureFile, measurement } from '../testing/synthetic-data';
import { manualStatusPath, manualMethods } from '../knowledge/manual-authoring';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
const {scope,other,recording,source,primary,alternative}=workspaceData();
let failures=0;
function check(name:string, fn:()=>void) { const only=process.argv.find(arg=>arg.startsWith('--check='))?.slice(8); if(only&&name!==only)return; try{fn();console.log('PASS '+name);}catch(error){failures++;console.error('FAIL '+name+': '+(error as Error).stack);}}
const id='TC_EDIT', spec='tests-e2e/generated/north/TC_EDIT.spec.ts', po='tests-e2e/pages/north/FirstPage.ts';
check('recommended owner comes from measured application route',()=>{
  const view=ownershipReview(scope,recording);assert.equal(view.steps[0].recommended,'FirstPage');assert.equal(view.steps[0].evidence,'proven');
});
check('search lists only active application Page Objects',()=>{
  const pages=pageCatalog(scope,'first');assert.equal(pages.length,1);assert.ok(pages[0].file.includes('/north/'));assert.ok(!pageCatalog(scope).some(p=>p.file.includes('/south/')));
});
check('ownership inherits until navigation and supports per-step override',()=>{
  const inherited=ownershipReview(scope,recording,{'action:1':'SparePage'});assert.equal(inherited.steps[1].confirmed,'SparePage');assert.equal(inherited.steps[1].explicit,false);assert.equal(inherited.steps[2].confirmed,null);
  const override=ownershipReview(scope,recording,{'action:1':'SparePage','action:2':'FirstPage'});assert.equal(override.steps[1].confirmed,'FirstPage');
  const auto=ownershipReview(scope,recording,{'action:1':'SparePage','action:2':''});assert.equal(auto.steps[1].confirmed,null);assert.equal(auto.steps[1].explicit,true);
  assert.throws(()=>ownershipReview(scope,recording,{'action:1':'ForeignPage'}),/Unknown Page Object/);
});
check('ownership cannot replace missing or foreign target evidence',()=>{
  const bad=structuredClone(recording);bad.evidence={available:false,reason:'No measured target'} as any;
  bad.authoringOwners={version:1,applicationId:'north',recordingHash:'',pages:[],choices:[{key:'action:1',recommended:'FirstPage',confirmed:'FirstPage',route:'/home',explicit:true}]};
  const mapping=mapRecording(bad);assert.ok(!mapping.steps.some(s=>s.pageObject==='FirstPage'));assert.ok(mapping.needsReview.length);
  bad.authoringOwners.applicationId='south';assert.throws(()=>mapRecording(bad),/Foreign/);
  const foreign=structuredClone(recording);(foreign.evidence as any).origin.applicationId='south';assert.throws(()=>ownershipReview(scope,foreign),/another application/);
});
check('new page is a scoped declaration until a proven capability creates its class',()=>{
  const page=createAuthoringPage(scope,recording,{name:'CustomReportsPage',route:'/reports',description:'Reports overview'},[]);
  assert.equal(pageCatalog(scope,'custom',[page]).length,1);assert.ok(!fs.existsSync(path.join(scope.paths.pagesDir,'CustomReportsPage.ts')));
  const review=ownershipReview(scope,recording,{'assertion:0':page.name},[page]);
  const metadata={version:1,applicationId:'north',recordingHash:hashContent(source),pages:[page],choices:review.steps};
  fs.writeFileSync(ownersPath(path.join(scope.paths.recordingsDir,id+'.spec.ts')),JSON.stringify(metadata));
  assert.equal(loadOwners(scope,path.join(scope.paths.recordingsDir,id+'.spec.ts'),source)?.choices.at(-1)?.confirmed,page.name);
  assert.throws(()=>loadOwners(other,path.join(scope.paths.recordingsDir,id+'.spec.ts'),source),/does not belong/);
  assert.throws(()=>loadOwners(scope,path.join(scope.paths.recordingsDir,id+'.spec.ts'),source+'\n'),/revision/);
  const proposal=analyseCorpus().proposals.find(p=>p.testCaseId===id&&p.owner==='CustomReportsPage');assert.ok(proposal,'confirmed bootstrap owner is proposed');
  const semantic=revalidate(proposal,[],{decision:'CREATE_PAGE_OBJECT',owner:page.name,methodName:proposal.method,reasoning:'Recorded identity and route established the owner'} as any);
  assert.equal(semantic.accepted,true,JSON.stringify(semantic));
  const result=applyProposals([proposal]);assert.equal(result.applied,true,JSON.stringify(result));
});
check('explicit Page creation does not require a measured route',()=>{
  const later=structuredClone(recording);(later.evidence as any).targets.forEach((target:any)=>target.captureTiming='after-action');
  assert.equal(createAuthoringPage(scope,later,{name:'LaterPage',route:'/reports',description:''},[]).name,'LaterPage');
});
check('dependency tree includes used page and excludes unrelated or foreign pages',()=>{
  const graph=codeGraph(scope,id);assert.ok(graph.files.some(f=>f.id===po),JSON.stringify(graph.files.map(f=>f.id)));assert.ok(graph.files.some(f=>f.id==='tests-e2e/pages/base.page.ts'));
  assert.ok(graph.files.some(f=>f.category==='Knowledge'));assert.ok(graph.files.some(f=>f.category==='Evidence'));
  assert.ok(!graph.files.some(f=>f.id.includes('SparePage')));assert.ok(!graph.files.some(f=>f.id.includes('/south/')));
  assert.throws(()=>readCode(scope,id,'tests-e2e/pages/south/FirstPage.ts'),/not a dependency/);
});
check('go to definition resolves typed method and shared base method',()=>{
  const code=readCode(scope,id,spec);const target=codeDefinition(scope,id,spec,code.content.indexOf('control()')+2);assert.equal(target?.id,po);assert.ok(target!.line>1);
  const page=readCode(scope,id,po);const base=codeDefinition(scope,id,po,page.content.indexOf('resolve(')+2);assert.equal(base?.id,'tests-e2e/pages/base.page.ts');
});
check('valid save formats code and preserves another application',()=>{
  const code=readCode(scope,id,spec), otherBefore=fs.readFileSync(path.join(other.paths.generatedDir,id+'.spec.ts'),'utf8');
  const result=saveCode(scope,id,spec,code.version,code.content.replace('toBeVisible();','toBeVisible( );'));assert.equal(result.accepted,true,JSON.stringify(result));
  assert.equal(fs.readFileSync(path.join(other.paths.generatedDir,id+'.spec.ts'),'utf8'),otherBefore);
});
check('invalid TypeScript save never corrupts the active file',()=>{
  const code=readCode(scope,id,spec);const result=saveCode(scope,id,spec,code.version,code.content+'\nconst broken: = ;');assert.equal(result.accepted,false);
  assert.equal(fs.readFileSync(spec,'utf8'),code.content);
  const invalid=saveCode(scope,id,spec,code.version,code.content.replace('firstPage.control()','firstPage.absentMethod()'));assert.equal(invalid.accepted,false);assert.equal(fs.readFileSync(spec,'utf8'),code.content);
});
check('concurrent edits and foreign imports are refused',()=>{
  const code=readCode(scope,id,spec);assert.throws(()=>saveCode(scope,id,spec,'stale',code.content),/changed outside/);
  assert.throws(()=>saveCode(scope,id,spec,code.version,code.content.replace('../../north.fixtures','../../south.fixtures')),/outside this application/);
});
check('shared framework files are protected from editing',()=>{
  const file='tests-e2e/pages/base.page.ts', code=readCode(scope,id,file);assert.equal(code.editable,false);assert.throws(()=>saveCode(scope,id,file,code.version,code.content+'\n'),/read-only/);
});
check('manual unproven locator is saved without deterministic promotion',()=>{
  const code=readCode(scope,id,po);const result=saveCode(scope,id,po,code.version,code.content.replace("'continue'","'unproven-target'"));
  assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.authoringStatus,'USER AUTHORED — NOT VALIDATED');
  assert.ok(fs.readFileSync(po,'utf8').includes('unproven-target'));
  assert.ok(!readAllPageKnowledge(scope.paths.knowledgePageDir).some(page=>page.elements.some(element=>element.page_object==='FirstPage'&&element.page_object_method==='control')));
  fs.writeFileSync(po,code.content);fs.writeFileSync(manualStatusPath(scope),JSON.stringify({applicationId:scope.applicationId,methods:[]}));
});
check('proven locator maintenance updates code and matching knowledge together',()=>{
  const otherBefore=fs.readFileSync(path.join(other.paths.pagesDir,'FirstPage.ts'),'utf8');
  const code=readCode(scope,id,po);const result=saveCode(scope,id,po,code.version,code.content.replace(primary,alternative));assert.equal(result.accepted,true,JSON.stringify(result));
  assert.ok(fs.readFileSync('ai/knowledge/page/north/north__home.yaml','utf8').includes('getByRole'));
  assert.equal(fs.readFileSync(path.join(other.paths.pagesDir,'FirstPage.ts'),'utf8'),otherBefore);
});
check('locator properties and foreign-document measurements stay unvalidated',()=>{
  const code=readCode(scope,id,po);const property=saveCode(scope,id,po,code.version,code.content.replace('extends BasePage {',"extends BasePage {\n  private other = this.page.getByTestId('not-measured');"));
  assert.equal(property.authoringStatus,'USER AUTHORED — NOT VALIDATED',JSON.stringify(property));
  fs.writeFileSync(po,code.content);fs.writeFileSync(manualStatusPath(scope),JSON.stringify({applicationId:scope.applicationId,methods:[]}));
  const evidenceFile=path.join(scope.paths.recordingsDir,id+'.evidence.json'),before=fs.readFileSync(evidenceFile,'utf8'),evidence=JSON.parse(before);
  const expression="page.getByTestId('wrong-document')";evidence.targets[0].derivedCandidates.push(measurement(expression,{sameDocument:false}));fs.writeFileSync(evidenceFile,JSON.stringify(evidence));
  try{const edited=code.content.replace(/page\.getBy(?:Role|TestId)\([^\n]+?\)(?=\s*})/,expression);const result=saveCode(scope,id,po,code.version,edited);assert.equal(result.authoringStatus,'USER AUTHORED — NOT VALIDATED',JSON.stringify(result));}
  finally{fs.writeFileSync(evidenceFile,before);fs.writeFileSync(po,code.content);fs.writeFileSync(manualStatusPath(scope),JSON.stringify({applicationId:scope.applicationId,methods:[]}));}
});
check('fixture edits are checked against other cases in the same application',()=>{
  const otherSpec=fs.readFileSync(spec,'utf8').replaceAll('TC_EDIT','TC_DEPENDENT').replaceAll('firstPage','sparePage');
  writeFixtureFile('tests-e2e/generated/north/TC_DEPENDENT.spec.ts',otherSpec);
  const file='tests-e2e/north.fixtures.ts',code=readCode(scope,id,file);
  const edited=code.content.replace(/^.*sparePage:.*\n/gm,'');
  const result=saveCode(scope,id,file,code.version,edited);assert.equal(result.accepted,false,JSON.stringify(result));assert.equal(fs.readFileSync(file,'utf8'),code.content);
  const valid=saveCode(scope,id,file,code.version,code.content+'\n// Reviewed fixture registration.\n');assert.equal(valid.accepted,true,JSON.stringify(valid));
});
check('knowledge capability edits cannot bypass the deterministic lifecycle',()=>{
  const file='ai/knowledge/page/north/north__home.yaml',code=readCode(scope,id,file);
  assert.throws(()=>saveCode(scope,id,file,code.version,code.content.replace('page_object: FirstPage','page_object: SparePage')),/limited to description/);
  assert.equal(saveCode(scope,id,file,code.version,code.content.replace('Exercise ownership and reusable capabilities','Reviewed screen purpose')).accepted,true);
});
check('multi-file commit rolls back if a rename fails',()=>{
  const a=path.join(scope.paths.pagesDir,'FirstPage.ts'), b=path.join(scope.paths.knowledgePageDir,'north__home.yaml');
  const beforeA=fs.readFileSync(a,'utf8'),beforeB=fs.readFileSync(b,'utf8'),rename=fs.renameSync;let fault=true;
  fs.renameSync=((from:any,to:any)=>{if(to===b&&fault){fault=false;throw Error('synthetic rename failure');}return rename(from,to);}) as any;
  try{assert.throws(()=>commitTexts(new Map([[a,beforeA+'\n'],[b,beforeB+'\n']])),/synthetic rename/);}finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(a,'utf8'),beforeA);assert.equal(fs.readFileSync(b,'utf8'),beforeB);
});
if(failures)process.exitCode=1;
