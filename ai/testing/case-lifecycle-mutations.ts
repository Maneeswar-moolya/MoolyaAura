/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/dashboard/case-lifecycle-sync.fixture.ts';
// The `activate` guard below the generator guard is defensive: this fixture cannot make
// activate() fail, so it carries no biting mutant and is reported as uncovered rather than
// claimed as protected.
const mutants=[
  {name:'generator refusal fails the committed save again',file:'ai/dashboard/server.ts',
    from:'          } catch (error) {\n            generating = { started: false,',
    to:'          } catch (error) {\n            throw error; generating = { started: false,',
    marker:'a committed save is reported as success even when the generator refuses'},
  {name:'refusal reported without its reason',file:'ai/dashboard/server.ts',
    from:'              reason: error instanceof Error ? error.message : String(error),',
    to:"              reason: 'the generator did not start',",
    marker:'the refusal is reported as data, with its reason and code'},
];
const selected=process.argv.find(a=>a.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:600000});
    assert.equal(r.status,0,`Mutation ${i}: ${r.error??''}`);
  }
  console.log(`PASS ${mutants.length} case lifecycle mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m=mutants[Number(selected?.split('=')[1])];assert.ok(m);
  const before=fs.readFileSync(m.file,'utf8');assert.ok(before.includes(m.from),'Mutation anchor: '+m.name);
  try{
    fs.writeFileSync(m.file,before.replace(m.from,m.to));
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),contract],{encoding:'utf8',timeout:540000,windowsHide:true});
    assert.ok(!r.error,`${m.name}: ${r.error}`);
    assert.notEqual(r.status,0,'SURVIVED '+m.name);
    assert.ok((r.stdout+r.stderr).includes(m.marker),'Wrong failure for '+m.name+': '+(r.stdout+r.stderr).slice(-1500));
    console.log('KILLED '+m.name);
  }finally{fs.writeFileSync(m.file,before);}
}
