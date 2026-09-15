/** Each fault is installed only in a guarded temporary checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const code='ai/dashboard/code-workspace.ts',owners='ai/dashboard/page-ownership.ts';
const mutants=[
  {name:'explicit Page authoring requires automatic route evidence',file:owners,gate:'explicit Page creation does not require a measured route',edits:[
    ["const review = ownershipReview(scope, recording, {}, existing);","const review = ownershipReview(scope, recording, {}, existing); if (!review.steps.some(step => step.route === route)) throw Error('Automatic route required');"]]},
  {name:'save ignores concurrent edits',file:code,gate:'concurrent edits and foreign imports are refused',edits:[
    ["if (hashContent(before) !== version) throw Error('The file changed outside this editor. Your draft is retained; reload and merge before saving.');",'']]},
  {name:'foreign-document locator proof is trusted',file:code,gate:'locator properties and foreign-document measurements stay unvalidated',edits:[
    ['const proven = provenMeasurements(target, role).map','const proven = (target.derivedCandidates ?? []).map']]},
  {name:'catalog reads a foreign project',file:owners,gate:'search lists only active application Page Objects',edits:[
    ['const index = buildIndex(scope), knowledge',"const index = buildIndex({ ...scope, paths: { ...scope.paths, pagesDir: scope.paths.pagesDir.replace(scope.applicationId, 'south') } }), knowledge"]]},
  {name:'owner context ignores navigation',file:owners,gate:'ownership inherits until navigation and supports per-step override',edits:[
    ['if (route !== lastRoute) { inherited = null; inheritedBinding = null; }',''],
    ["if (action.type === 'navigate') { inherited = null; inheritedBinding = null; lastRoute = null; lastRecommended = null; screenRoute = routeFrom(action.value ?? ''); }","if (action.type === 'navigate') { screenRoute = routeFrom(action.value ?? ''); /* corrupted context */ }"]]},
  {name:'owner selection grants identity',file:'ai/autocode/from-recording.ts',gate:'ownership cannot replace missing or foreign target evidence',edits:[
    ["if (!evidence || (element.usage && element.usage !== role)) return null;","return []; // corrupted identity gate"]]},
  {name:'dependency scope is not checked',file:code,gate:'concurrent edits and foreign imports are refused',edits:[
    ["if (!category(scope, file)) throw Error('Dependency is outside this application or the shared framework allowlist.');",'']]},
  {name:'shared files become editable',file:code,gate:'shared framework files are protected from editing',edits:[
    ["if (!node.editable) throw Error('Shared framework files, recordings and evidence are read-only.');",'']]},
  {name:'save bypasses syntax and semantic validation',file:code,gate:'invalid TypeScript save never corrupts the active file',edits:[
    ['if (syntax.length) return','if (false) return'],['if (introduced.length) return','if (false) return']]},
  {name:'manual locator is trusted without evidence',file:code,gate:'manual unproven locator is saved without deterministic promotion',edits:[
    ['const proven = !changes.length || proveLocatorEdits(scope, graph, changes);','const proven = true;']]},
  {name:'capability knowledge can be edited freely',file:code,gate:'knowledge capability edits cannot bypass the deterministic lifecycle',edits:[
    ["if (protectedKnowledge(before) !== protectedKnowledge(formatted)) throw Error('Knowledge editing is limited to description and purpose. Ownership, locators and capabilities require the deterministic lifecycle.');",'']]},
  {name:'partial commit is not rolled back',file:'ai/knowledge/authoring-owners.ts',gate:'multi-file commit rolls back if a rename fails',edits:[
    ['for (const file of committed.reverse()) { const original = before.get(file); if (original === null) fs.unlinkSync(file); else atomicText(file, original!); }','']]},
];
const choice=process.argv.find(arg=>arg.startsWith('--mutant='));
if(!choice&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const child=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',__filename,`--mutant=${i}`],{stdio:'inherit',timeout:300000,windowsHide:true});
    assert.equal(child.status,0,`Mutation ${i}: ${child.error??''}`);
  }
  console.log(`PASS all ${mutants.length} authoring workspace mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant=mutants[Number(choice?.split('=')[1])];assert.ok(mutant);
  const before=fs.readFileSync(mutant.file,'utf8');let changed=before.replace(/\r\n/g,'\n');
  for(const [from,to] of mutant.edits){assert.ok(changed.includes(from),`Mutation anchor: ${mutant.name}`);changed=changed.split(from).join(to);}
  try{
    fs.writeFileSync(mutant.file,changed);
    const child=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/dashboard/authoring-workspace.fixture.ts',`--check=${mutant.gate}`],{
      env:{...process.env,AURA_SYNTHETIC_FIXTURE_ROOT:''},encoding:'utf8',timeout:240000,windowsHide:true,maxBuffer:4*1024*1024});
    const output=child.stdout+child.stderr;assert.notEqual(child.status,0,`SURVIVED: ${mutant.name}`);assert.ok(output.includes(`FAIL ${mutant.gate}`),`Wrong failure: ${output}`);
    console.log(`KILLED ${mutant.name}: ${mutant.gate}`);
  }finally{fs.writeFileSync(mutant.file,before);}
}
