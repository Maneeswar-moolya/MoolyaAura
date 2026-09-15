/** Meaningful faults installed only in guarded synthetic checkouts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const service='ai/dashboard/recording-mapping.ts',catalog='ai/dashboard/authoring-catalog.ts',fixture='ai/dashboard/recording-mapping.fixture.ts';
const mutants=[
  {name:'route becomes logical Page identity',file:catalog,edits:[["hashContent(page.name).slice(0, 20)","hashContent(page.route).slice(0, 20)"]],gate:'route is context and multiple logical Pages can share it'},
  {name:'foreign application Pages enter the catalog',file:catalog,edits:[["const term = query.toLowerCase().trim();","if (scope.applicationId === 'south') for (const foreign of readAllPageKnowledge(path.join(path.dirname(scope.paths.knowledgePageDir), 'north'), true)) pages.push({ name: (parseYaml(foreign.raw) as any).page.logical_name || foreign.id, route: foreign.route, description: foreign.purpose }); const term = query.toLowerCase().trim();"]],gate:'another application cannot discover or bind saved authoring'},
  {name:'unrelated Page Objects enter the default selector',file:'ai/dashboard/public/recording-review.js',edits:[["objects.filter(object=>(object.pages||[object.page]).includes(page)&&fuzzy(query,","objects.filter(object=>fuzzy(query,"]],test:'ai/dashboard/review-selectors.fixture.ts',gate:'unrelated logical Page objects must remain hidden'},
  {name:'sidecar succeeds without reusable YAML capability',file:service,edits:[
    ["texts.set(yaml, appendElement(before, authoringKnowledgeEntry(object.className, method, methodCreated || matches.includes(method) ? locator : '', step.role, action.target)));",''],
    ["if (binding?.method && !readAllPageKnowledge(scope.paths.knowledgePageDir, true).some(page => page.elements.some(element => element.page_object === binding!.pageObject && element.page_object_method === binding!.method))) throw Error('Saved capability is missing from reusable YAML knowledge.');",'']],gate:'one Save Mapping persists source YAML fixture and exact binding without proof'},
  {name:'sidecar failure leaves knowledge and source committed',file:'ai/knowledge/authoring-owners.ts',edits:[['committed.reverse()','[]']],gate:'failed sidecar commit rolls back all artifacts'},
  {name:'established capability overwritten on name collision',file:service,edits:[["if (!input.method && !matches.includes(method)) throw Error('An established method already uses this name for another capability. Choose a different name in Advanced.');","if (!input.method && !matches.includes(method)) texts.set(file, source.replace(/return [^;]+;/, `return ${locator};`));"]],gate:'established capability collisions and ambiguity never overwrite methods'},
  {name:'newly created catalog entries stay invisible',file:service,edits:[['return { ...result!, saved:','return { ...result!, authoring: current.authoring, saved:']],gate:'one Save Mapping persists source YAML fixture and exact binding without proof'},
  {name:'dropdown ranking silently selects a Page',file:'ai/dashboard/public/recording-review.js',edits:[["name:b.page,create:false}:null,pageObject:","name:b.page,create:false}:{...ownership.authoring.pages[0],create:false},pageObject:"]],test:'ai/dashboard/authoring-browser.fixture.ts',gate:'ranking never silently selects a Page'},
  {name:'manual authoring requires automatic target proof',file:service,edits:[['const locator = input.locatorOverride || step.locator;',"const locator = input.locatorOverride || step.locator; if (!evidenceFor(draft.recording.evidence, step.locator)) throw Error('Automatic proof required');"]],gate:'one Save Mapping persists source YAML fixture and exact binding without proof'},
  {name:'parameterized reuse loses its bound arguments',file:service,edits:[['if (parameterArgs.has(method)) binding.arguments = parameterArgs.get(method);','']],gate:'parameterized capabilities reuse their declared template without new methods'},
  {name:'late review response overwrites the saved mapping',file:'ai/dashboard/public/recording-review.js',edits:[['structuredClone(stateFor(step)),turn=++epoch;busy=true','structuredClone(stateFor(step)),turn=epoch;busy=true']],test:'ai/dashboard/authoring-browser.fixture.ts',gate:'late pre-save review must not replace persisted mapping'},
];
const choice=process.argv.find(arg=>arg.startsWith('--mutant='));
if(!choice&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let at=0;at<mutants.length;at++){const child=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',__filename,`--mutant=${at}`],{stdio:'inherit',timeout:300000,windowsHide:true});assert.equal(child.status,0,`Mutation ${at}: ${child.error??''}`);}
  console.log(`PASS all ${mutants.length} Recording Review mapping mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant=mutants[Number(choice?.split('=')[1])];assert.ok(mutant);const original=fs.readFileSync(mutant.file,'utf8');let changed=original;
  for(const [from,to] of mutant.edits){assert.ok(changed.includes(from),`Missing mutation anchor: ${mutant.name}`);changed=changed.replace(from,to);}
  try{fs.writeFileSync(mutant.file,changed);const child=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',mutant.test??fixture,...(mutant.test?[]:[`--check=${mutant.gate}`])],{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:5*1024*1024,env:{...process.env,AURA_UI_CAPTURE_DIR:''}});
    assert.notEqual(child.status,0,`SURVIVED ${mutant.name}`);assert.ok((child.stdout+child.stderr).includes(mutant.gate),`Wrong failure: ${child.stdout}${child.stderr}`);console.log(`KILLED ${mutant.name}: ${mutant.gate}`);
  }finally{fs.writeFileSync(mutant.file,original);}
}
