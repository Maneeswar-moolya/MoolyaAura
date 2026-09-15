/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/diagnostics/recording-navigation.fixture.ts';
const mutants=[
  // The measured defect, put back exactly as it was: wait for the picture, then record.
  {name:'observation awaited before the recorder is told about the action',file:'ai/diagnostics/recording.ts',
    from:"      if(!before) { const recorded=original.call(this,action,...rest);try{void win.__auraPictureBefore(payload).catch(()=>{});}catch{}return recorded; }",
    to:"      if(!before) { try{await win.__auraPictureBefore(payload);}catch{}return original.call(this,action,...rest); }",
    marker:'A navigating click must survive as an action'},
  // The same loss reached from the other end: an observation the parser never keeps.
  {name:'the recorder\'s own overlay observed as an application action',file:'ai/diagnostics/recording.ts',
    from:"    if(this.recorderOwnAction?.(selector)) return '';",
    to:"    if(false) return '';",
    marker:'Observed and recorded streams must be one stream'},
  {name:'attribution claims every picture was placed',file:'ai/diagnostics/recording.ts',
    from:'    this.attribution={paired:actionsPaired&&assertionsPaired,',
    to:'    this.attribution={paired:true,',
    marker:'A stream that does not align is never reported as paired'},
  {name:'a stream that does not align paired anyway',file:'ai/diagnostics/recording.ts',
    from:'    const actionsPaired=actual.length===observed.length && actual.every(',
    to:'    const actionsPaired=actual.length<=observed.length && actual.every(',
    marker:'attributes no action picture, rather than guessing one'},
  {name:'every action picture pointed at one step',file:'ai/diagnostics/recording.ts',
    from:'recordingStepKey:`action:${item.index}`',
    to:'recordingStepKey:`action:${actual[0].index}`',
    marker:'must keep exactly one before-action picture'},
];
const selected=process.argv.find(a=>a.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:420000});
    assert.equal(r.status,0,`Mutation ${i}: ${r.error??''}`);
  }
  console.log(`PASS ${mutants.length} recording navigation mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m=mutants[Number(selected?.split('=')[1])];assert.ok(m);
  const before=fs.readFileSync(m.file,'utf8');assert.ok(before.includes(m.from),'Mutation anchor: '+m.name);
  try{
    fs.writeFileSync(m.file,before.replace(m.from,m.to));
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),contract],{encoding:'utf8',timeout:360000,windowsHide:true});
    assert.ok(!r.error,`${m.name}: ${r.error}`);
    assert.notEqual(r.status,0,'SURVIVED '+m.name);
    assert.ok((r.stdout+r.stderr).includes(m.marker),'Wrong failure for '+m.name+': '+(r.stdout+r.stderr).slice(-900));
    console.log('KILLED '+m.name);
  }finally{fs.writeFileSync(m.file,before);}
}
