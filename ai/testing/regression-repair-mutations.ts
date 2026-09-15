/** Closure protections are mutated only inside guarded temporary checkouts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const map = 'ai/autocode/from-recording.ts';
const mutants = [
  { name: 'eager dashboard URL resolution', file: 'ai/knowledge/canonical.ts', fixture: 'ai/dashboard/dashboard-experience.fixture.ts', gate: /Dashboard startup failed[\s\S]*No application is selected/,
    edits: [["import path from 'node:path';", "import path from 'node:path';\nimport { BASE_URL } from '../../tests-e2e/support/env';"], ['baseUrl: string = activeScope().baseUrl', 'baseUrl: string = BASE_URL']] },
  { name: 'invented ambient application', file: 'ai/knowledge/canonical.ts', fixture: 'ai/dashboard/dashboard-startup.fixture.ts', gate: /scoped identity fails clearly/,
    edits: [['cachedApplicationId = activeScope().applicationId;', "cachedApplicationId = 'invented';"]] },
  { name: 'request environment discarded', file: 'ai/dashboard/scope-request.ts', fixture: 'ai/dashboard/dashboard-startup.fixture.ts', gate: /request environment selection/,
    edits: [['environmentId: text(selection.environmentId),', 'environmentId: undefined,']] },
  { name: 'only top candidate considered', file: map, fixture: 'ai/autocode/evidence-consumption.fixture.ts', gate: /FAIL\s+D: reuse walks every proven candidate/,
    edits: [['const matches = candidates.flatMap(proven =>', 'const matches = candidates.slice(0, 1).flatMap(proven =>']] },
  { name: 'role identity admitted unconditionally', file: 'ai/autocode/dom-evidence.ts', fixture: 'ai/autocode/semantic-candidates.fixture.ts', gate: /FAIL\s+E: each candidate needs action identity/,
    edits: [["return role === 'assertion'", "return true; return role === 'assertion'"]] },
  { name: 'ambiguous candidates choose first', file: map, fixture: 'ai/autocode/semantic-candidates.fixture.ts', gate: /FAIL\s+E: two claimants/,
    edits: [['return distinct.size === 1 ? [...distinct.values()][0] : null;', 'return [...distinct.values()][0] ?? null;']] },
  { name: 'retained save does not persist', file: 'ai/dashboard/recorder.ts', fixture: 'ai/autocode/evidence-persistence.fixture.ts', gate: /FAIL\s+H: keepArtifactFor delegates/,
    edits: [['const artifact = persistRecording(testCaseId, held.source, held.recording.evidence, held.stateAssertions, held.origin);', 'const artifact = null;']] },
  { name: 'automatic resolver precedes user binding', file: map, fixture: 'ai/autocode/parameter.fixture.ts', gate: /FAIL\s+19: resolver precedence.*userMethod/,
    edits: [['const match = userMethod(`action:${position}`) ?? findMethod(action.target, actionKnowledge, index, actionEvidence, \'action\')', 'const match = findMethod(action.target, actionKnowledge, index, actionEvidence, \'action\') ?? userMethod(`action:${position}`)']] },
  { name: 'Git fixture forced into synthetic route', file: 'ai/testing/fixture-routing.ts', fixture: 'ai/testing/fixture-routing.fixture.ts', gate: /repository-read-only/,
    edits: [["? 'repository-read-only'", "? 'synthetic'"]] },
  { name: 'sweep stops after first result', file: 'ai/testing/fixture-routing.ts', fixture: 'ai/testing/fixture-routing.fixture.ts', gate: /sweep must continue after failure/,
    edits: [['for (const fixture of fixtures) yield await execute(fixture);', 'for (const fixture of fixtures) { yield await execute(fixture); return; }']] },
];
const selected = process.argv.find(arg => arg.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename, `--mutant=${i}`], { stdio: 'inherit', timeout: 300000, windowsHide: true });
    assert.equal(child.status, 0, `Mutation ${i}: ${child.error ?? ''}`);
  }
  console.log(`PASS all ${mutants.length} closure mutants killed`);
} else {
  require('./isolated-checkout'); assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant = mutants[Number(selected?.split('=')[1])]; assert.ok(mutant);
  const before = fs.readFileSync(mutant.file, 'utf8'); let changed = before.replace(/\r\n/g, '\n');
  for (const [from, to] of mutant.edits) { assert.ok(changed.includes(from), `Missing mutation anchor: ${mutant.name}`); changed = changed.replace(from, to); }
  try {
    fs.writeFileSync(mutant.file, changed);
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', mutant.fixture], { encoding: 'utf8', timeout: 180000, windowsHide: true });
    assert.notEqual(child.status, 0, `SURVIVED ${mutant.name}`);
    assert.match(child.stdout + child.stderr, mutant.gate, `Wrong failure for ${mutant.name}`);
    console.log(`KILLED ${mutant.name}`);
  } finally { fs.writeFileSync(mutant.file, before); }
}
