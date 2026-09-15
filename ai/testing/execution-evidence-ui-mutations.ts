/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/dashboard/execution-evidence.browser.fixture.ts';
const mutants=[
  // Evidence exists and the route refuses to serve it.
  {name:'the evidence route forgets the capture urls',file:'ai/dashboard/server.ts',
    from:"          ...Object.values(record.steps || {}).flat().flatMap(s=>[s.screenshotUrl,...(s.captures ?? []).map(c=>c.url)]).filter(Boolean)];",
    to:"          ...Object.values(record.steps || {}).flat().map(s=>s.screenshotUrl).filter(Boolean)];",
    marker:'the evidence route serves a capture url the API published'},
  // A report that exists and a control that hides it.
  {name:'the download control hidden although a report exists',file:'ai/dashboard/public/index.html',
    from:"  if (runId && hasReport) {",
    to:"  if (false) {",
    marker:'the download control appears when a report artifact exists'},
  // A download that hands back a different execution.
  {name:'the download points at another run',file:'ai/dashboard/public/index.html',
    from:"    link.href = `/api/projects/${encodeURIComponent(selectedProject()?.applicationId || \"\")}/runs/${encodeURIComponent(runId)}/report/`;",
    to:"    link.href = `/api/projects/${encodeURIComponent(selectedProject()?.applicationId || \"\")}/runs/${encodeURIComponent(String(runId).replace(/-qa-1$/, ''))}/report/`;",
    marker:'the download targets this run'},
  // The screen shows a step a picture that is not of that step.
  {name:'the screen falls back to another step picture',file:'ai/dashboard/public/index.html',
    from:"  const source = shot ? shot.url : step.screenshotUrl;",
    to:"  const source = (visibleSteps[0].captures || [])[0]?.url || step.screenshotUrl;",
    marker:"fetched THAT step's artifact"},
  // Timing known and not said.
  {name:'capture timing dropped on the way to the screen',file:'ai/dashboard/public/index.html',
    from:'  const timing = shot ? { POST_STEP: "Captured after the step completed", FAILURE: "Captured on failure",',
    to:'  const timing = false ? { POST_STEP: "Captured after the step completed", FAILURE: "Captured on failure",',
    marker:'a passing step reports when it was captured'},
];
const selected=process.argv.find(a=>a.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:420000});
    assert.equal(r.status,0,`Mutation ${i}: ${r.error??''}`);
  }
  console.log(`PASS ${mutants.length} execution evidence UI mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m=mutants[Number(selected?.split('=')[1])] as any;assert.ok(m);
  const before=fs.readFileSync(m.file,'utf8');assert.ok(before.includes(m.from),'Mutation anchor: '+m.name);
  try{
    fs.writeFileSync(m.file,before.replace(m.from,m.to));
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),contract],{encoding:'utf8',timeout:360000,windowsHide:true});
    assert.ok(!r.error,`${m.name}: ${r.error}`);
    assert.notEqual(r.status,0,'SURVIVED '+m.name);
    assert.ok((r.stdout+r.stderr).includes(m.marker),'Wrong failure for '+m.name+': '+(r.stdout+r.stderr).slice(-700));
    console.log('KILLED '+m.name);
  }finally{fs.writeFileSync(m.file,before);}
}
