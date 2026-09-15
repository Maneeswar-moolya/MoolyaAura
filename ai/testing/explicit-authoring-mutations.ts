/** Mutation workers never modify the source checkout or installed applications. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const mutants = [
  { name: 'one route one Page', file: 'ai/dashboard/authoring-catalog.ts', from: 'const found = catalog.pages.find(item => item.name === page.name);', to: "if (!existing && catalog.pages.some(item => item.route === page.route)) throw Error('Route already owned'); const found = catalog.pages.find(item => item.name === page.name);" },
  { name: 'explicit method loses precedence', file: 'ai/autocode/from-recording.ts', from: 'const match = userMethod(`action:${position}`) ?? findMethod', to: 'const match = findMethod' },
  { name: 'foreign user selection accepted', file: 'ai/dashboard/page-ownership.ts', from: "if (selected.applicationId !== scope.applicationId) throw Error('Cross-application binding is not allowed.');", to: '' },
  { name: 'explicit authentication ignored', file: 'ai/autocode/from-recording.ts', from: 'const explicitMatch = userMethod(`action:${at}`);', to: 'const explicitMatch = null;' },
  { name: 'automatic composite overrides user methods', file: 'ai/autocode/from-recording.ts', from: 'const composite = !hasExplicitControls && !recording.assertions.some', to: 'const composite = !recording.assertions.some' },
  { name: 'persisted user selection discarded', file: 'ai/knowledge/authoring-owners.ts', from: 'return value;', to: 'value.choices.forEach(choice => { delete choice.userSelection; delete choice.provenance; }); return value;' },
  { name: 'manual method falsely validated', file: 'ai/dashboard/authoring-catalog.ts', from: "status: 'USER AUTHORED — NOT VALIDATED'", to: "status: 'USER AUTHORED — VALIDATED'" },
  { name: 'explicit authoring bypasses navigation causality', file: 'ai/autocode/from-recording.ts', from: "if (action.navigationCause !== 'intentional' || !replayableNavigation(action.value ?? '')) {", to: 'if (false) {' },
];
const selected = process.argv.find(arg => arg.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let at = 0; at < mutants.length; at++) {
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename, `--mutant=${at}`], { stdio: 'inherit', timeout: 300000, windowsHide: true });
    assert.equal(child.status, 0, `Mutation ${at}: ${child.error ?? ''}`);
  }
  console.log(`PASS all ${mutants.length} explicit-authoring mutants killed`);
} else {
  require('./isolated-checkout'); assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant = mutants[Number(selected?.split('=')[1])], before = fs.readFileSync(mutant.file, 'utf8');
  assert.ok(before.includes(mutant.from), `Missing mutation anchor: ${mutant.name}`);
  try {
    fs.writeFileSync(mutant.file, before.replace(mutant.from, mutant.to));
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/dashboard/explicit-authoring.fixture.ts'], { encoding: 'utf8', timeout: 240000, windowsHide: true });
    assert.notEqual(child.status, 0, `SURVIVED ${mutant.name}`);
    assert.match(child.stdout + child.stderr, /AssertionError|Route already owned/, `Unexpected failure: ${child.stdout + child.stderr}`);
    console.log(`KILLED ${mutant.name}`);
  } finally { fs.writeFileSync(mutant.file, before); }
}
