/** Ownership/reuse mutants run only inside guarded synthetic checkouts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const mapping = 'ai/autocode/from-recording.ts';
const mutants = [
  { name: 'later route grants interaction-time ownership', file: mapping,
    edits: [["if (evidence.captureTiming !== 'before-action' && evidence.captureTiming !== 'assertion-pick') return matches;", '']],
    gate: 'an after-action route cannot settle interaction-time ownership' },
  { name: 'early reuse drops alternative evidence', file: 'ai/autocode/abstraction/propose.ts',
    edits: [['if (resolvedStep?.pageObject && resolvedStep.method && observed?.proven)', 'if (false)']],
    gate: 'early proven reuse retains alternative evidence without rewriting capabilities' },
  { name: 'reconstructed route overrides measured route', file: 'ai/autocode/abstraction/propose.ts',
    edits: [['const effectiveRoutes = measuredRoute ? [measuredRoute] : routes;', 'const effectiveRoutes = routes;']],
    gate: 'measured route overrides reconstructed route' },
  { name: 'measured page does not disambiguate reuse', file: mapping,
    edits: [['if (!evidence?.route) return matches;', 'return matches;']],
    gate: 'authentication reuses proven controls on their measured page' },
  { name: 'name grants identity without a measurement', file: mapping,
    edits: [["if (!evidence || (element.usage && element.usage !== role)) return null;", "return []; // corrupted: name bypasses identity"],
      ["else\n        candidates.push({ rank: 5, match: { pageObject, method, page, why: `${page.file} declares the locator whose target identity was measured` }, element });", ""]],
    gate: 'unmeasured same-name link cannot reuse a form button' },
  { name: 'same-route duplicate picks first owner', file: mapping,
    edits: [['return distinct.size === 1 ? [...distinct.values()][0] : null;', 'return [...distinct.values()][0] ?? null;']],
    gate: 'different proven expressions cannot choose between same-route owners' },
  { name: 'missing route picks arbitrary owner', file: mapping,
    edits: [['if (!evidence?.route) return matches;', 'if (!evidence?.route) return matches.slice(0, 1);']],
    gate: 'missing measured route cannot settle duplicate owners' },
  { name: 'foreign-document candidate grants named reuse', file: mapping,
    edits: [['return provenMeasurements(evidence, role).some(candidate =>', 'return (evidence.derivedCandidates ?? []).some(candidate =>']],
    gate: 'foreign-document identity cannot grant named reuse' },
  { name: 'capability-only identity is discarded for auth', file: mapping,
    edits: [["evidence && provenMeasurements(evidence, 'action').length > 0 && (", "evidence && provenCandidate(evidence, 'action') && ("]],
    gate: 'capability identity evidence alone supports authentication reuse' },
  { name: 'names hide duplicate proven owners', file: mapping,
    edits: [['if (new Set(candidates.map(entry => `${entry.match.pageObject}.${entry.match.method}`)).size > 1) return null;', '']],
    gate: 'different names cannot hide a same-route ownership conflict' },
];
const choice = process.argv.find(arg => arg.startsWith('--mutant='));
if (!choice && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename, `--mutant=${i}`],
      { stdio: 'inherit', timeout: 300000, windowsHide: true });
    assert.equal(child.status, 0, `Mutation ${i}: ${child.error ?? ''}`);
  }
  console.log(`PASS all ${mutants.length} ownership/reuse source mutants killed`);
} else {
  require('./isolated-checkout');
  assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant = mutants[Number(choice?.split('=')[1])]; assert.ok(mutant);
  const before = fs.readFileSync(mutant.file, 'utf8'); let changed = before.replace(/\r\n/g, '\n');
  for (const [from, to] of mutant.edits) {
    assert.ok(changed.includes(from), `Mutation anchor: ${mutant.name}`);
    changed = changed.split(from).join(to);
  }
  try {
    fs.writeFileSync(mutant.file, changed);
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/autocode/ownership-reuse.fixture.ts'], {
      env: { ...process.env, AURA_SYNTHETIC_FIXTURE_ROOT: '' }, encoding: 'utf8',
      timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    const output = child.stdout + child.stderr;
    assert.notEqual(child.status, 0, `SURVIVED: ${mutant.name}`);
    assert.ok(output.includes(`FAIL ${mutant.gate}`) || output.includes(`[ERR_ASSERTION]: ${mutant.gate}`),
      `Wrong failure for ${mutant.name}: ${output}`);
    console.log(`KILLED ${mutant.name}: ${mutant.gate}`);
  } finally { fs.writeFileSync(mutant.file, before); }
}
