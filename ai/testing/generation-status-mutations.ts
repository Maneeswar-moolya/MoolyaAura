/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/dashboard/generation-status.fixture.ts';
const mutants=[
  {name:'BLOCKED converted back to UNREPORTED',file:'ai/dashboard/generation-history.ts',
    from:"const VERDICT_LINE = /^ {2}([A-Z][A-Z_]{2,})(?: \\(([^)]*)\\))?: ?(.*)$/;",
    to:"const VERDICT_LINE = /^ {2}([A-Z][A-Z_]{2,})()(): ?(.*)$/;",
    marker:'a blocked generation is recorded as BLOCKED, not UNREPORTED'},
  {name:'verdict classification discarded',file:'ai/dashboard/generation-history.ts',
    from:"    current.code = verdict[2]?.trim() || undefined;",to:'    current.code = undefined;',
    marker:'its classification is retained as a code'},
  {name:'verdict reason discarded',file:'ai/dashboard/generation-history.ts',
    from:"    current.reason = (current.code ? `${current.code}: ` : '') + verdict[3].trim();",
    to:"    current.reason = '';",
    marker:'its reason is retained and not empty'},
];
const selected=process.argv.find(a=>a.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:240000});
    assert.equal(r.status,0,`Mutation ${i}: ${r.error??''}`);
  }
  console.log(`PASS ${mutants.length} generation status mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m=mutants[Number(selected?.split('=')[1])];assert.ok(m);
  const before=fs.readFileSync(m.file,'utf8');assert.ok(before.includes(m.from),'Mutation anchor: '+m.name);
  try{
    fs.writeFileSync(m.file,before.replace(m.from,m.to));
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),contract],{encoding:'utf8',timeout:180000,windowsHide:true});
    assert.ok(!r.error,`${m.name}: ${r.error}`);
    assert.notEqual(r.status,0,'SURVIVED '+m.name);
    assert.ok((r.stdout+r.stderr).includes(m.marker),'Wrong failure for '+m.name+': '+(r.stdout+r.stderr).slice(-700));
    console.log('KILLED '+m.name);
  }finally{fs.writeFileSync(m.file,before);}
}
