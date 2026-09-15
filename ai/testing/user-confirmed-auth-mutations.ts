/** Faults are installed only in disposable, guarded synthetic checkouts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const mapper = 'ai/autocode/from-recording.ts';
const mutants = [
  { name: 'explicit methods re-enter automatic identity gate', file: mapper,
    from: 'if (!explicit && (!evidence || !match)) {', to: 'if (!evidence || (!explicit && !match)) {',
    gate: 'explicit methods execute every auth control with no target evidence or knowledge' },
  { name: 'explicit recorded locators ignored', file: mapper,
    from: 'const locator = explicitMatch ? null : userLocator(`action:${at}`, action);', to: 'const locator = null;',
    gate: 'recorded locator mode persists and executes without any Page Object' },
  { name: 'Auto silently becomes explicit recorded execution', file: mapper,
    from: 'const locator = explicitMatch ? null : userLocator(`action:${at}`, action);',
    to: 'const locator = explicitMatch ? null : (userLocator(`action:${at}`, action) ?? checkedRecordedLocator(action.locator));',
    gate: 'Auto and Page/PO-only choices still require automatic target identity' },
  { name: 'foreign explicit binding accepted', file: mapper,
    from: "if (binding.applicationId !== index.applicationId) throw Error('Cross-application binding is not allowed.');", to: '',
    gate: 'foreign application bindings and foreign evidence are rejected in both explicit modes' },
  { name: 'explicit authentication bypasses navigation safety', file: mapper,
    from: "if (action.navigationCause !== 'intentional' || !replayableNavigation(action.value ?? '')) {", to: 'if (false) {',
    gate: 'navigation causality remains independent of explicit authentication' },
  { name: 'recorded credential value emitted', file: mapper,
    from: "? [`await (${receiver}).fill(${credentialFixture}.${action.redacted ? 'password' : 'email'});`]", to: '? callFor(action, receiver)',
    gate: 'explicit methods execute every auth control with no target evidence or knowledge' },
  { name: 'execution mode inherits onto next control', file: 'ai/dashboard/page-ownership.ts',
    from: "inheritedBinding = { ...inheritedBinding, method: null, executionMode: 'AUTO', locatorOverride: undefined, arguments: undefined };", to: 'inheritedBinding = { ...inheritedBinding, method: null };',
    gate: 'explicit execution modes never inherit onto another control' },
  { name: 'raw expression bypasses code safety', file: mapper,
    from: 'function checkedRecordedLocator(locator: string): string {', to: 'function checkedRecordedLocator(locator: string): string { return locator;',
    gate: 'explicit recorded locator cannot inject executable code' },
  { name: 'recorded execution supersedes the selected method', file: mapper,
    from: 'const explicitMatch = userMethod(`action:${at}`);',
    to: "const explicitMatch = userSelection(`action:${at}`)?.executionMode === 'RECORDED_LOCATOR' ? null : userMethod(`action:${at}`);",
    gate: 'explicit methods take precedence over recorded-locator mode' },
];
const choice = process.argv.find(arg => arg.startsWith('--mutant='));
if (!choice && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let at = 0; at < mutants.length; at++) {
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename, `--mutant=${at}`], { stdio: 'inherit', timeout: 300000, windowsHide: true });
    assert.equal(child.status, 0, `Mutation ${at}: ${child.error ?? ''}`);
  }
  console.log(`PASS all ${mutants.length} user-confirmed authentication mutants killed`);
} else {
  require('./isolated-checkout'); assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const mutant = mutants[Number(choice?.split('=')[1])]; assert.ok(mutant);
  const before = fs.readFileSync(mutant.file, 'utf8');
  assert.ok(before.includes(mutant.from), `Missing mutation anchor: ${mutant.name}`);
  try {
    fs.writeFileSync(mutant.file, before.replace(mutant.from, mutant.to));
    const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'ai/autocode/user-confirmed-auth.fixture.ts'], { encoding: 'utf8', timeout: 180000, windowsHide: true });
    assert.notEqual(child.status, 0, `SURVIVED ${mutant.name}`);
    assert.ok((child.stdout + child.stderr).includes(`FAIL ${mutant.gate}`), `Wrong failure: ${child.stdout}${child.stderr}`);
    console.log(`KILLED ${mutant.name}: ${mutant.gate}`);
  } finally { fs.writeFileSync(mutant.file, before); }
}
