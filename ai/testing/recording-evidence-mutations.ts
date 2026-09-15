/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/dashboard/recording-evidence.fixture.ts';
const mutants=[
  {name:'evidence sidecar skipped when nothing was captured',file:'ai/dashboard/recorder.ts',
    from:'    } else {\n      try {\n        // No admissible evidence.',
    to:'    } else if (false) {\n      try {\n        // No admissible evidence.',
    marker:'the absence is recorded rather than left implicit'},
  {name:'a present sidecar counted as admissible evidence',file:'ai/dashboard/case-status.ts',
    from:'    hasEvidence: exists && admissibleEvidence(testCase.testCaseId, dir).available,',
    to:'    hasEvidence: exists && fs.existsSync(evidenceArtifactPath(testCase.testCaseId, dir)),',
    marker:'a present sidecar is not admissible evidence'},
  {name:'incomplete recording reported as healthy',file:'ai/dashboard/case-status.ts',
    from:'  if (!status.hasEvidence) {',to:'  if (false) {',
    marker:'the state is named'},
  {name:'unavailable evidence downgraded to a soft yes',file:'ai/dashboard/recorder.ts',
    from:'          available: false,\n          reason: (evidence as { reason?: string }).reason',
    to:'          available: true,\n          reason: (evidence as { reason?: string }).reason',
    marker:'never a soft yes'},
  {name:'capture reason discarded from the sidecar',file:'ai/dashboard/recorder.ts',
    from:"          reason: (evidence as { reason?: string }).reason ?? 'no admissible interaction-time evidence was captured',",
    to:"          reason: 'unavailable',",
    marker:'the capture layer reason is preserved verbatim'},
];
const selected=process.argv.find(a=>a.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:300000});
    assert.equal(r.status,0,`Mutation ${i}: ${r.error??''}`);
  }
  console.log(`PASS ${mutants.length} recording evidence mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m=mutants[Number(selected?.split('=')[1])];assert.ok(m);
  const before=fs.readFileSync(m.file,'utf8');assert.ok(before.includes(m.from),'Mutation anchor: '+m.name);
  try{
    fs.writeFileSync(m.file,before.replace(m.from,m.to));
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),contract],{encoding:'utf8',timeout:240000,windowsHide:true});
    assert.ok(!r.error,`${m.name}: ${r.error}`);
    assert.notEqual(r.status,0,'SURVIVED '+m.name);
    assert.ok((r.stdout+r.stderr).includes(m.marker),'Wrong failure for '+m.name+': '+(r.stdout+r.stderr).slice(-900));
    console.log('KILLED '+m.name);
  }finally{fs.writeFileSync(m.file,before);}
}
