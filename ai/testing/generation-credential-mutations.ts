/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract = 'ai/dashboard/generation-credentials.fixture.ts';
const mutants = [
  // The defect itself: the profile named for the recording is dropped and generation quietly
  // runs on the application binding. Nothing fails, nothing is reported - which is precisely
  // why only a contract on the execution profile can see it.
  {
    name: 'the recording profile never reaches generation',
    file: 'ai/dashboard/server.ts',
    from: "            const executionData = generationSelection(generationScope,\n"
      + "                  recorded?.credentialProfileId ?? (typeof (body as any).credentialProfileId === 'string' ? (body as any).credentialProfileId : undefined))\n"
      + "              ?? (body as any).executionData;",
    to: "            void recorded;\n            const executionData = (body as any).executionData;",
    marker: 'generation is bound to the ID the save produced, not one the user re-selects',
  },
  // The ordering put back the way it was: a selection left in the Execution Data dialog, made
  // for other cases and persisting in the page until cleared, silently outranking the selector
  // the person has just used beside Record.
  {
    name: 'a stale dialog selection outranks the recording profile',
    file: 'ai/dashboard/server.ts',
    from: "            const executionData = generationSelection(generationScope,\n"
      + "                  recorded?.credentialProfileId ?? (typeof (body as any).credentialProfileId === 'string' ? (body as any).credentialProfileId : undefined))\n"
      + "              ?? (body as any).executionData;",
    to: "            const executionData = (body as any).executionData\n"
      + "              ?? generationSelection(generationScope,\n"
      + "                  recorded?.credentialProfileId ?? (typeof (body as any).credentialProfileId === 'string' ? (body as any).credentialProfileId : undefined));",
    marker: 'the recording profile outranks a stale Execution Data selection',
  },
  // The hand-off across Stop and Save broken: the ID the workbook assigned never meets the
  // profile the session chose, so the person is sent back to select the case they just made.
  {
    name: 'the save does not stamp the recording context with the new id',
    file: 'ai/dashboard/recorder.ts',
    from: "  if (held.context)\n    generationContext = { ...held.context, testCaseId };",
    to: "  if (false && held.context)\n    generationContext = { ...held.context, testCaseId };",
    marker: 'the profile chosen when recording started reaches the generation context',
  },
  // A generation context left readable: the next unrelated save inherits an account nobody
  // chose for it.
  {
    name: 'the generation context is not consumed on read',
    file: 'ai/dashboard/recorder.ts',
    from: '  generationContext = null;\n  return held;',
    to: '  return held;',
    marker: 'the context is collected once, so no later save inherits it',
  },
  // Application isolation dropped from the hand-off.
  {
    name: 'another application can collect this generation context',
    file: 'ai/dashboard/recorder.ts',
    from: "  if (held.applicationId !== scope.applicationId\n"
      + "      || held.testCaseId.toUpperCase() !== testCaseId.toUpperCase())",
    to: "  if (held.testCaseId.toUpperCase() !== testCaseId.toUpperCase())",
    marker: 'another application cannot collect this application\'s generation context',
  },
  // A selection that outlives its attempt. 'examples' reads the case's saved Example rows -
  // the shape that would pin a logical test to one account for every future run.
  {
    name: 'the generation selection is not ephemeral',
    file: 'ai/test-data/execution.ts',
    from: " return {mode:'selected',credentialProfileIds:[id],expectedVersion:readTestData(scope).version};",
    to: " return {mode:'examples',credentialProfileIds:[id],expectedVersion:readTestData(scope).version};",
    marker: 'the generation selection is ephemeral, single-profile and version-pinned',
  },
  // A refused credential reported as a generic failure, which tells a person nothing about
  // what to fix and hides the one code section 8 asks for by name.
  {
    name: 'a refused credential profile loses its typed code',
    file: 'ai/dashboard/server.ts',
    from: "  const named = /^(CREDENTIAL|DATA|SOURCE_ENVIRONMENT|BROWSER|EXECUTION)_CONFIGURATION_FAILURE\\b/.exec(message);\n  return named?.[0];",
    to: '  void message;\n  return undefined;',
    marker: 'a profile that does not support the target environment refuses generation',
  },
  // The other half of the separation: loosening the EXECUTION rule to make generation work
  // would be the wrong fix, and this proves the existing-case rule was not touched.
  {
    name: 'Execution Data stops requiring selected cases',
    file: 'ai/dashboard/server.ts',
    from: "          if(!Array.isArray(body.testCaseIds)||!body.testCaseIds.length||body.testCaseIds.some(id=>!parsed.testCases.some(c=>c.testCaseId===id)))throw Error('Select test cases from this application workbook.');",
    to: "          if(!Array.isArray(body.testCaseIds))throw Error('Select test cases from this application workbook.');",
    marker: 'Execution Data still requires selected cases when run from Run Selected',
  },
];
const selected = process.argv.find(a => a.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), __filename, `--mutant=${i}`],
      { stdio: 'inherit', windowsHide: true, timeout: 300000 });
    assert.equal(r.status, 0, `Mutation ${i}: ${r.error ?? ''}`);
  }
  console.log(`PASS ${mutants.length} generation credential mutants killed`);
} else {
  require('./isolated-checkout'); assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m = mutants[Number(selected?.split('=')[1])]; assert.ok(m);
  const before = fs.readFileSync(m.file, 'utf8'); assert.ok(before.includes(m.from), 'Mutation anchor: ' + m.name);
  try {
    fs.writeFileSync(m.file, before.replace(m.from, m.to));
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), contract],
      { encoding: 'utf8', timeout: 240000, windowsHide: true });
    assert.ok(!r.error, `${m.name}: ${r.error}`);
    assert.notEqual(r.status, 0, 'SURVIVED ' + m.name);
    assert.ok((r.stdout + r.stderr).includes(m.marker),
      'Wrong failure for ' + m.name + ': ' + (r.stdout + r.stderr).slice(-900));
    console.log('KILLED ' + m.name);
  } finally { fs.writeFileSync(m.file, before); }
}
