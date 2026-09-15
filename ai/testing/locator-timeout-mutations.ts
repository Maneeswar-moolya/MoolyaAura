/** Corrupt protections only inside guarded disposable checkouts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const policy = 'tests-e2e/support/locator-policy.ts', resolver = 'tests-e2e/support/resilient-locator.ts';
const fixture = 'ai/autocode/locator-timeout.fixture.ts';
const mutants = [
  { name: 'restore four-second ceiling', file: policy, from: 'LOCATOR_TIMEOUT_MS = 40_000', to: 'LOCATOR_TIMEOUT_MS = 4_000', gate: 'screen.delayedHeading' },
  { name: 'fallback rechecks reset the deadline', file: resolver, from: 'await deadline.recheck();', to: 'await deadline.recheck(); (deadline as any).started = deadline.clock.now();', gate: 'FAIL zero matches fail at one forty-second deadline after ready' },
  { name: 'resolution does not hand remaining budget to action', file: resolver, from: 'return bindLocator(locator, deadline);', to: 'return bindLocator(locator);', gate: 'FAIL resolution and action share forty seconds rather than eighty' },
  { name: 'manual execution ignores the active operation', file: policy, from: 'const budget = operations.getStore()?.deadline ?? inherited ?? new LocatorDeadline();', to: 'const budget = inherited ?? new LocatorDeadline();', gate: 'FAIL authentication and user-confirmed recorded controls share the active step budget' },
  { name: 'ambiguous candidate accepted', file: resolver, from: "cardinality === 'one' ? count !== 1 : count < 1", to: "cardinality === 'one' ? count < 1 : count < 1", gate: 'FAIL ambiguity never narrows the target' },
  { name: 'busy page mislabeled as missing locator', file: policy, from: "readiness.state === 'TRANSITIONING' ? 'PAGE_READINESS_TIMEOUT'", to: "false ? 'PAGE_READINESS_TIMEOUT'", gate: 'FAIL visible declared busy state reports readiness timeout' },
  { name: 'timeout metadata leaks URL query', file: policy, from: 'route: diagnosticText(page.url()), readiness, classification', to: 'route: page.url(), readiness, classification', extraFrom: 'return diagnosticData({ ...details, configuredTimeoutMs:', extraTo: 'return ({ ...details, configuredTimeoutMs:', gate: 'FAIL zero matches fail at one forty-second deadline after ready' },
  { name: 'expired action turns into unlimited Playwright wait', file: policy, from: "if (remaining <= 0) throw Error('UI_OPERATION_TIMEOUT: shared locator deadline exhausted.');", to: '', gate: 'FAIL expired budget cannot become Playwright unlimited timeout' },
];
const selected = process.argv.find(arg => arg.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let index = 0; index < mutants.length; index++) {
    const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), __filename, `--mutant=${index}`], { stdio: 'inherit', windowsHide: true, timeout: 120000 });
    assert.equal(result.status, 0, `mutation ${index}: ${result.error ?? ''}`);
  }
  console.log(`PASS all ${mutants.length} locator-timeout mutants killed`);
} else {
  require('./isolated-checkout');
  assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant = mutants[Number(selected?.split('=')[1])]; assert.ok(mutant);
  const original = fs.readFileSync(mutant.file, 'utf8'); assert.ok(original.includes(mutant.from), mutant.name);
  let changed = original.replace(mutant.from, mutant.to);
  if (mutant.extraFrom) { assert.ok(changed.includes(mutant.extraFrom)); changed = changed.replace(mutant.extraFrom, mutant.extraTo!); }
  try {
    fs.writeFileSync(mutant.file, changed);
    const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), fixture], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    assert.notEqual(result.status, 0, `SURVIVED ${mutant.name}`);
    assert.ok((result.stdout + result.stderr).includes(mutant.gate), `Wrong failure for ${mutant.name}: ${result.stdout}${result.stderr}`);
    console.log('KILLED ' + mutant.name);
  } finally { fs.writeFileSync(mutant.file, original); }
}
