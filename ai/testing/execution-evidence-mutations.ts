/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/diagnostics/execution-evidence.fixture.ts';
const mutants=[
  // The reported behaviour: a passing step is never photographed.
  {name:'screenshots taken only on failure',file:'tests-e2e/support/steps.ts',
    from:"    if (diagnostic && captureMode() === 'on') await take('POST_STEP');",
    to:"    if (false) await take('POST_STEP');",
    marker:'keeps exactly one after-step picture'},
  // The other half of the measured inconsistency: pictures taken when the run said not to.
  {name:'the capture control ignored for step evidence',file:'tests-e2e/support/steps.ts',
    from:"    if (mode === 'off') return;",
    to:"    if (false) return;",
    marker:'capture off means no pictures are taken at all'},
  // A passing step keeps a frame the run's settings said not to retain.
  {name:'only-on-failure retains a passing step picture',file:'tests-e2e/support/steps.ts',
    from:"    else if (captureMode() === 'only-on-failure') captures.length = 0;",
    to:"    else if (false) captures.length = 0;",
    marker:'only-on-failure photographs no passing step'},
  // The measured reference defect: a filename with no directory resolves nowhere.
  {name:'a capture named by filename alone',file:'tests-e2e/support/steps.ts',
    from:"      capture.artifact = path.relative(testInfo.project.outputDir,",
    to:"      capture.artifact = path.basename(path.relative(testInfo.project.outputDir,",
    extra:{from:"        path.join(testInfo.outputDir, capture.artifact)).replace(/\\\\/g, '/');",
      to:"        path.join(testInfo.outputDir, capture.artifact))).replace(/\\\\/g, '/');"},
    marker:'the artifact names its directory, not just a filename'},
  {name:'capture timing left unrecorded',file:'tests-e2e/support/steps.ts',
    from:"      record.captureTiming = 'after-step';",
    to:"      record.captureTiming = undefined;",
    marker:'records WHEN it was captured'},
  {name:'an unavailable capture reports no reason',file:'tests-e2e/support/steps.ts',
    from:"    if (page.isClosed()) { unavailable.push(`${type}: the page had already closed`); return; }",
    to:"    if (page.isClosed()) { return; }",
    marker:'the reason is recorded'},
  {name:'the failure state never photographed',file:'tests-e2e/support/steps.ts',
    from:"    if (diagnostic) await take('FAILURE');",
    to:"    if (false) await take('FAILURE');",
    marker:'the failing step keeps a failure-state picture'},
  // The report stops carrying what a report is for.
  {name:'the report omits the failure reason',file:'ai/dashboard/run-report.ts',
    from:"  <td>${step.error ? `<pre>${safe(step.error)}</pre>` : '<span class=\"none\">—</span>'}</td>",
    to:"  <td>${'<span class=\"none\">—</span>'}</td>",
    marker:'the failure reason appears'},
  {name:'the report ships an absolute local path',file:'ai/dashboard/run-report.ts',
    from:'const safe = (value: unknown): string => esc(withoutLocalPaths(diagnosticText(value)));',
    to:'const safe = (value: unknown): string => esc(diagnosticText(value));',
    marker:'no absolute local path reaches the report'},
  {name:'the report ships a protected value',file:'ai/dashboard/run-report.ts',
    from:'const safe = (value: unknown): string => esc(withoutLocalPaths(diagnosticText(value)));',
    to:'const safe = (value: unknown): string => esc(withoutLocalPaths(String(value ?? "")));',
    marker:'no secret reaches the report'},
  // A step shown the wrong moment of itself.
  {name:'the report shows the pre-step state as the step result',file:'ai/dashboard/run-report.ts',
    from:"        .sort((a, b) => ['POST_STEP', 'FAILURE', 'PRE_STEP'].indexOf(a.captureType)\n          - ['POST_STEP', 'FAILURE', 'PRE_STEP'].indexOf(b.captureType))[0];",
    to:"        .sort((a, b) => ['PRE_STEP', 'POST_STEP', 'FAILURE'].indexOf(a.captureType)\n          - ['PRE_STEP', 'POST_STEP', 'FAILURE'].indexOf(b.captureType))[0];",
    marker:'the report states Captured after the step completed'},
];
const selected=process.argv.find(a=>a.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:300000});
    assert.equal(r.status,0,`Mutation ${i}: ${r.error??''}`);
  }
  console.log(`PASS ${mutants.length} execution evidence mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m=mutants[Number(selected?.split('=')[1])] as any;assert.ok(m);
  const before=fs.readFileSync(m.file,'utf8');assert.ok(before.includes(m.from),'Mutation anchor: '+m.name);
  if(m.extra)assert.ok(before.includes(m.extra.from),'Mutation extra anchor: '+m.name);
  try{
    let faulted=before.replace(m.from,m.to);
    if(m.extra)faulted=faulted.replace(m.extra.from,m.extra.to);
    fs.writeFileSync(m.file,faulted);
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),contract],{encoding:'utf8',timeout:240000,windowsHide:true});
    assert.ok(!r.error,`${m.name}: ${r.error}`);
    assert.notEqual(r.status,0,'SURVIVED '+m.name);
    assert.ok((r.stdout+r.stderr).includes(m.marker),'Wrong failure for '+m.name+': '+(r.stdout+r.stderr).slice(-700));
    console.log('KILLED '+m.name);
  }finally{fs.writeFileSync(m.file,before);}
}
