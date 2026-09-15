/** Behavioral mutants run only in disposable nested checkouts, never the real source. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const mutants = [
  {name:'foreign artifact ownership',file:'ai/dashboard/server.ts',from:'record.applicationId!==applicationId',to:'false',fixture:'ai/dashboard/environment-execution.fixture.ts',gate:'Foreign project artifact refused'},
  {name:'source-to-target URL binding',file:'tests-e2e/support/execution-environment.ts',from:'if (!process.env.AURA_RUN_ID) return raw;',to:'return raw;',fixture:'ai/dashboard/environment-execution.fixture.ts',gate:'Target environment execution must pass'},
  {name:'retry artifact collision',file:'tests-e2e/support/steps.ts',from:'attemptId: `${testIdentity}-${attemptNumber}`',to:'attemptId: `${testIdentity}-1`',fixture:'ai/dashboard/environment-execution.fixture.ts',gate:'Both attempts retain their own step evidence'},
  {name:'explicit dashboard runner scope',file:'ai/dashboard/server.ts',from:'scanDataDrivenRunners(SPEC_DIR, scope)',to:'scanDataDrivenRunners(SPEC_DIR)',fixture:'ai/dashboard/environment-execution.fixture.ts',gate:'Scoped workbook API must load'},
  {name:'explicit dashboard survey scope',file:'ai/dashboard/server.ts',from:'surveyWork(parsed, mapping, readState(), new Set([wantedId.toUpperCase()]), scope)',to:'surveyWork(parsed, mapping, readState(), new Set([wantedId.toUpperCase()]))',fixture:'ai/dashboard/environment-execution.fixture.ts',gate:'Scoped authoring must activate without ambient project'},
  {name:'recording note visibility',file:'ai/dashboard/public/index.html',from:"$('recAuthNote').classList.toggle('show', auth.detected === true)",to:"$('recAuthNote').classList.toggle('show', false)",fixture:'ai/dashboard/dashboard-experience.fixture.ts',gate:'Detected authentication is visible in the actual review'},
];
const choice = process.argv.find(arg => arg.startsWith('--mutant='));
if (!choice && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  // Each mutation gets its own bounded isolation lifecycle. A combined 300-second
  // fixture watchdog must not cut off the third real browser execution.
  for (let index = 0; index < mutants.length; index++) {
    const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename, `--mutant=${index}`],
      {cwd:process.cwd(), env:process.env, stdio:'inherit', timeout:300000, windowsHide:true});
    assert.equal(result.status,0,`Mutation ${index} failed: ${result.error || ''}`);
  }
  console.log('PASS all 6 dashboard/environment source mutants were killed by their intended behavioral gates');
} else {
require('./isolated-checkout');
assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
const index = Number(choice?.split('=')[1]);
assert.ok(Number.isInteger(index) && index >= 0 && index < mutants.length);
for(const mutant of [mutants[index]]) {
  const before=fs.readFileSync(mutant.file,'utf8');assert.ok(before.includes(mutant.from),`Mutation anchor: ${mutant.name}`);
  try {
    fs.writeFileSync(mutant.file,before.replace(mutant.from,mutant.to));
    const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',mutant.fixture,'--contract-only'],{
      cwd:process.cwd(),env:{...process.env,AURA_SYNTHETIC_FIXTURE_ROOT:'',AURA_UI_CAPTURE_DIR:''},encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:4*1024*1024,
    });
    const output=result.stdout+result.stderr;
    assert.notEqual(result.status,0,`SURVIVED: ${mutant.name}`);
    assert.ok(output.includes(mutant.gate),`Wrong failure for ${mutant.name}: ${output}`);
    console.log(`KILLED ${mutant.name}: ${mutant.gate}`);
  } finally {fs.writeFileSync(mutant.file,before);}
}
}

