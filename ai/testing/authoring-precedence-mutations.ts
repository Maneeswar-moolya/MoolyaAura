/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract = 'ai/dashboard/authoring-precedence.fixture.ts';
const mutants = [
  // The defect itself, restored: a Page Object being nearby is called a completed mapping.
  {
    name: 'inherited Page Object context is called USER_CONFIRMED again',
    file: 'ai/dashboard/page-ownership.ts',
    from: "    const provenance = runnable ? 'USER_CONFIRMED'\n"
      + "      : inherited || inheritedBinding ? 'USER_BINDING_INCOMPLETE' : 'AUTO';",
    to: "    const provenance = inherited || inheritedBinding ? 'USER_CONFIRMED' : 'AUTO';",
    marker: 'a Page Object inherited from the previous step is USER_BINDING_INCOMPLETE, not confirmed',
  },
  // The predicate loosened so that context counts as execution.
  {
    name: 'a Page Object with no method counts as executable',
    file: 'ai/knowledge/authoring-owners.ts',
    from: "  if (binding.method) return 'PAGE_OBJECT_METHOD';\n  return false;",
    to: "  if (binding.method || binding.pageObject) return 'PAGE_OBJECT_METHOD';\n  return false;",
    marker: 'the executable predicate is the single definition of a completed mapping',
  },
  // Save Mapping allowed to report success while persisting the contradictory state.
  {
    name: 'Save Mapping persists a Page Object with nothing to run',
    file: 'ai/dashboard/page-ownership.ts',
    from: '      if (selected.pageObject && !executableBinding(selected))',
    to: '      if (false && selected.pageObject && !executableBinding(selected))',
    marker: 'saving a Page Object with nothing to run is refused as USER_BINDING_INCOMPLETE',
  },
  // Generation silently demoting started authoring back to automatic inference.
  {
    name: 'generation demotes an incomplete binding to AUTO',
    file: 'ai/autocode/from-recording.ts',
    from: '    const incomplete = action.type === \'navigate\' ? null : incompleteBinding(key);',
    to: '    const incomplete = null;',
    marker: 'generation never silently demotes started authoring to AUTO',
  },
  // The navigation-causality relaxation taken too far: ANY preceding action counts as a
  // cause, so a navigation behind a step nobody bound is waved through. Deliberately mutated
  // at the resolver rather than at the `if` - dropping the `causedBy &&` guard leaves the
  // message dereferencing a null cause, which crashes instead of changing behaviour, and a
  // mutant that only proves the code can throw proves nothing about this contract.
  {
    name: 'unproven navigation is waved through without a cause',
    file: 'ai/autocode/from-recording.ts',
    from: '          return executableBinding(userSelection(`action:${at}`)) ? { at, action: previous } : null;',
    to: '          return { at, action: previous };',
    marker: 'a navigation with no confirmed action behind it still blocks',
  },
  // ...and the opposite: the relaxation removed, so a confirmed cause still blocks assembly.
  {
    name: 'a navigation caused by a confirmed action blocks again',
    file: 'ai/autocode/from-recording.ts',
    from: '      if (causedBy && action.navigationCause !== \'intentional\') {',
    to: '      if (false && causedBy && action.navigationCause !== \'intentional\') {',
    marker: 'a navigation after a confirmed action is provenance, not a review block',
  },
  // THE AUTHENTICATION GATE, one credential field at a time. `userMethod` is what lets an
  // explicitly bound control skip automatic identity; narrowing it per field is how a single
  // field silently falling back to AUTO would look.
  {
    name: 'the explicit email method is sent through the AUTO evidence gate',
    file: 'ai/autocode/from-recording.ts',
    from: '    if (!binding.method) return null;',
    to: "    if (!binding.method || binding.method === 'emailField') return null;",
    marker: 'every explicitly bound credential control is used, with no automatic identity demanded',
  },
  {
    name: 'the explicit password method is sent through the AUTO evidence gate',
    file: 'ai/autocode/from-recording.ts',
    from: '    if (!binding.method) return null;',
    to: "    if (!binding.method || binding.method === 'passwordField') return null;",
    marker: 'every explicitly bound credential control is used, with no automatic identity demanded',
  },
  {
    name: 'the explicit login-button method is sent through the AUTO evidence gate',
    file: 'ai/autocode/from-recording.ts',
    from: '    if (!binding.method) return null;',
    to: "    if (!binding.method || binding.method === 'signInButton') return null;",
    marker: 'every explicitly bound credential control is used, with no automatic identity demanded',
  },
  // The recorded-locator election reduced to context, so an explicit execution choice stops
  // being one and the step falls back to inference.
  {
    name: 'the recorded-locator election is dropped',
    file: 'ai/knowledge/authoring-owners.ts',
    from: "  if (binding.executionMode === 'RECORDED_LOCATOR') return 'RECORDED_LOCATOR';",
    to: "  if (false) return 'RECORDED_LOCATOR';",
    marker: 'the executable predicate is the single definition of a completed mapping',
  },
  // A saved choice that stops counting as the user's own.
  {
    name: 'the explicit flag is dropped from a saved step',
    file: 'ai/dashboard/page-ownership.ts',
    from: '      explicit: Object.hasOwn(overrides, key), documentId: evidence?.documentId ?? null,',
    to: '      explicit: false, documentId: evidence?.documentId ?? null,',
    marker: 'an explicit recorded-locator choice persists as USER_CONFIRMED and explicit',
  },
  // A recording made today on the codegen transport told to treat itself as a legacy artifact.
  {
    name: 'a codegen recording is labelled legacy again',
    file: 'ai/autocode/dom-evidence.ts',
    from: "  if (/codegen/i.test(recorded))",
    to: "  if (false && /codegen/i.test(recorded))",
    marker: 'a codegen recording is not labelled a legacy artifact',
  },
];
const selected = process.argv.find(a => a.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), __filename, `--mutant=${i}`],
      { stdio: 'inherit', windowsHide: true, timeout: 240000 });
    assert.equal(r.status, 0, `Mutation ${i}: ${r.error ?? ''}`);
  }
  console.log(`PASS ${mutants.length} authoring precedence mutants killed`);
} else {
  require('./isolated-checkout'); assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m = mutants[Number(selected?.split('=')[1])]; assert.ok(m);
  const before = fs.readFileSync(m.file, 'utf8'); assert.ok(before.includes(m.from), 'Mutation anchor: ' + m.name);
  try {
    fs.writeFileSync(m.file, before.replace(m.from, m.to));
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), contract],
      { encoding: 'utf8', timeout: 180000, windowsHide: true });
    assert.ok(!r.error, `${m.name}: ${r.error}`);
    assert.notEqual(r.status, 0, 'SURVIVED ' + m.name);
    assert.ok((r.stdout + r.stderr).includes(m.marker),
      'Wrong failure for ' + m.name + ': ' + (r.stdout + r.stderr).slice(-900));
    console.log('KILLED ' + m.name);
  } finally { fs.writeFileSync(m.file, before); }
}
