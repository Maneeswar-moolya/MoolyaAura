/**
 * Run: npx tsx ai/autocode/locator-quality-benchmark.mutations.ts
 * Exercise the benchmark's shared selection checks against actual production mutants
 * in a guarded OS temporary checkout. No application artifacts or credentials copied.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { enterIsolatedArtefactRoot, leaveIsolatedArtefactRoot, removeFixtureTree } from '../projects/fixture-safety';

const SOURCE = process.cwd();
const mutations = [
  {
    name: 'reversed ranking',
    before: 'b.weakest - a.weakest',
    after: 'a.weakest - b.weakest',
    gate: 'D: no strictly higher-scoring proven candidate is ignored',
  },
  {
    name: 'lower-scoring authored ID forced first',
    before: 'return rankProvenCandidates(evidence, role)[0] ?? null;',
    after: `const ranked = rankProvenCandidates(evidence, role);
  return ranked.find(candidate => candidate.strategy === 'stable-id') ?? ranked[0] ?? null;`,
    gate: 'D: no strictly higher-scoring proven candidate is ignored',
  },
  {
    name: 'unproven candidate admitted',
    before: '.filter(entry => provesIdentity(entry.candidate, role))',
    after: '.filter(() => true)',
    gate: 'D: inadmissible candidate is refused',
  },
];

function main(): void {
  const root = enterIsolatedArtefactRoot('aura-locator-benchmark');
  try {
    assert.throws(() => removeFixtureTree(SOURCE), /outside the fixture root/);
    fs.cpSync(path.join(SOURCE, 'ai'), path.join(root, 'ai'), {
      recursive: true,
      filter: file => fs.statSync(file).isDirectory()
        ? !['recordings', 'reports', 'page', 'framework', 'generations', 'runs'].includes(path.basename(file))
        : file.endsWith('.ts'),
    });
    for (const name of ['package.json', 'tsconfig.json'])
      fs.copyFileSync(path.join(SOURCE, name), path.join(root, name));
    fs.symlinkSync(path.join(SOURCE, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    const run = () => {
      const result = spawnSync(process.execPath, [
        path.join(root, 'node_modules/tsx/dist/cli.mjs'),
        path.join(root, 'ai/autocode/locator-quality-benchmark.fixture.ts'), '--synthetic-only',
      ], {
        cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true,
        env: { ...process.env, AURA_ARTEFACT_ROOT: root,
          AURA_REGISTRY_FILE: path.join(root, 'ai/projects/registry.json'),
          AURA_APPLICATION: '', AURA_ENVIRONMENT: '', FORCE_COLOR: '0' },
      });
      return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, error: result.error };
    };
    const baseline = run();
    assert.equal(baseline.code, 0, `${baseline.error ?? ''}\n${baseline.output}`);
    assert.match(baseline.output, /PASS  D: no strictly higher-scoring proven candidate is ignored/);
    console.log('PASS baseline control: synthetic benchmark, no installed application artifacts');

    const file = path.join(root, 'ai/autocode/abstraction/classify.ts');
    const original = fs.readFileSync(file, 'utf8');
    for (const mutation of mutations) {
      assert.equal(original.split(mutation.before).length, 2, `mutation anchor must be unique: ${mutation.name}`);
      fs.writeFileSync(file, original.replace(mutation.before, mutation.after));
      const result = run();
      // A syntax/import error is not a kill: the intended behavioral assertion must fail.
      assert.equal(result.code, 1, `${mutation.name}: ${result.error ?? ''}\n${result.output}`);
      assert.ok(result.output.includes(`FAIL  ${mutation.gate}`), `${mutation.name}: wrong failure\n${result.output}`);
      console.log(`KILLED ${mutation.name}: exit ${result.code}; FAIL ${mutation.gate}`);
    }
    fs.writeFileSync(file, original);
    const restored = run();
    assert.equal(restored.code, 0, `${restored.error ?? ''}\n${restored.output}`);
    console.log('PASS restored control; 3/3 mutants killed');
  } finally {
    removeFixtureTree(root);
    leaveIsolatedArtefactRoot();
  }
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
