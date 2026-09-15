/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/dashboard/authoring-locator-safety.fixture.ts';
const mutants=[
  // The defect itself: five rules collapsed back into one sentence about the prefix.
  {name:'every refusal blamed on the locator root again',file:'ai/dashboard/authoring-catalog.ts',
    from:'  if (problem) throw Error(`${problem.code}: ${problem.message}`);',
    to:"  if (problem) throw Error('Enter a supported Playwright locator expression beginning with page.');",
    marker:'the thrown refusal leads with its code'},
  // Position stops being its own answer and falls back to the generic mechanism refusal.
  {name:'a position reported as an unspecified forbidden mechanism',file:'ai/dashboard/authoring-catalog.ts',
    from:'  if (positional.length || POSITIONAL.test(locator))',
    to:'  if (positional.length && POSITIONAL.test(locator) && false)',
    marker:'the positional chain is refused for its position'},
  // The contract's one positional exception, removed.
  {name:'a browser-measured index refused like an unmeasured one',file:'ai/autocode/abstraction/validate.ts',
    // validate.ts is CRLF in this tree; an anchor has to be the bytes that are there.
    from:'    if (effective.positionProven && /nth\\(/.test(mechanism))\r\n      continue;',
    to:'    if (false)\r\n      continue;',
    marker:'a measured index is not a forbidden mechanism'},
  // The screen stops being told, so the refusal can only arrive from the transaction.
  {name:'the review claims every recorded locator is authorable',file:'ai/dashboard/page-ownership.ts',
    from:'      locatorSafety: locatorVerdict(item.locator) });',
    to:'      locatorSafety: { ok: true } });',
    marker:'the review carries the verdict for this step'},
  // USER_CONFIRMED treated as permission to run anything.
  {name:'recorded-locator execution exempted from locator safety',file:'ai/dashboard/recording-mapping.ts',
    from:'    if (!selectedMethod || input.locatorOverride) validateAuthoringLocator(locator);',
    to:"    if (mode === 'PAGE_OBJECT_METHOD' && (!selectedMethod || input.locatorOverride)) validateAuthoringLocator(locator);",
    marker:'USER_CONFIRMED does not make an unproven position acceptable'},
  // A method written from an expression nothing judged.
  {name:'a capability written without judging its locator',file:'ai/dashboard/authoring-catalog.ts',
    from:"  if (!/^[a-zA-Z_$][\\w$]{1,70}$/.test(name) || ['constructor', 'resolve', 'page', 'healing'].includes(name)) throw Error('Enter a unique method name.');\n  validateAuthoringLocator(locator);",
    to:"  if (!/^[a-zA-Z_$][\\w$]{1,70}$/.test(name) || ['constructor', 'resolve', 'page', 'healing'].includes(name)) throw Error('Enter a unique method name.');",
    marker:'a positional chain cannot become a capability'},
  // The screen stops applying the verdict, so a known refusal is spent on a transaction.
  {name:'the screen judges a recorded locator it is not authoring',file:'ai/dashboard/public/recording-review.js',
    from:'    return !((object||{}).methods||[]).some(method=>method.name===state.method);',
    to:'    return true;',
    marker:'an ESTABLISHED capability runs its own declared locator'},
  {name:'the screen ignores the verdict entirely',file:'ai/dashboard/public/recording-review.js',
    from:'    return judgesRecordedLocator(state,catalog)&&verdict&&verdict.ok===false?verdict:null;',
    to:'    return null;',
    marker:'Save is refused before the transaction'},
];
const selected=process.argv.find(a=>a.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:300000});
    assert.equal(r.status,0,`Mutation ${i}: ${r.error??''}`);
  }
  console.log(`PASS ${mutants.length} authoring locator mutants killed`);
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
