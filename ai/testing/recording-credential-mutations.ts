/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract = 'ai/dashboard/recording-credentials.fixture.ts';
const mutants = [
  // The recording session's own profile ignored: back to having nothing to compare against,
  // which is the state the account identifier leaked from.
  {
    name: 'the recording session profile is not consulted',
    file: 'ai/dashboard/recorder.ts',
    from: "  if (recordingCredentials) {\n"
      + "    add(recordingCredentials.email, 'email', 'CREDENTIAL_PROFILE');\n"
      + "    add(recordingCredentials.password, 'password', 'CREDENTIAL_PROFILE');\n"
      + "  }",
    to: "  if (false && recordingCredentials) {\n"
      + "    add(recordingCredentials.password, 'password', 'CREDENTIAL_PROFILE');\n"
      + "  }",
    marker: 'a named profile protects the account identifier despite a neutral label',
  },
  // Only the password protected - the original defect, restored exactly.
  {
    name: 'only the password half of the profile is protected',
    file: 'ai/dashboard/recorder.ts',
    from: "    add(recordingCredentials.email, 'email', 'CREDENTIAL_PROFILE');\n"
      + "    add(recordingCredentials.password, 'password', 'CREDENTIAL_PROFILE');",
    to: "    add(recordingCredentials.password, 'password', 'CREDENTIAL_PROFILE');",
    marker: 'a named profile protects the account identifier despite a neutral label',
  },
  // The resolution failure swallowed, so a profile that cannot be opened records anyway.
  {
    name: 'an unresolvable profile is ignored instead of refused',
    file: 'ai/dashboard/recorder.ts',
    from: "  const resolved = resolveProfileCredentials(scope, id);\n"
      + "  recordingCredentials = { profileId: id, email: resolved.email, password: resolved.password };",
    to: "  try {\n    const resolved = resolveProfileCredentials(scope, id);\n"
      + "    recordingCredentials = { profileId: id, email: resolved.email, password: resolved.password };\n"
      + "  } catch { /* mutant: record unprotected */ }",
    marker: 'a profile that cannot be resolved throws rather than recording unprotected',
  },
  // A value where an identifier belongs. The one place the profile is meant to travel is the
  // one place a credential must not.
  {
    name: 'the session reports the account instead of the profile id',
    file: 'ai/dashboard/recorder.ts',
    from: '  return recordingCredentials?.profileId;',
    to: '  return recordingCredentials?.email;',
    marker: 'the profile is exposed by ID only, never by value',
  },
  // The values outlive the session they were resolved for.
  {
    name: 'stopping the recording does not drop the resolved credentials',
    file: 'ai/dashboard/recorder.ts',
    from: "export function closeRecordingCredentials(): void {\n  recordingCredentials = null;\n}",
    to: "export function closeRecordingCredentials(): void {\n  /* mutant: kept */\n}",
    marker: 'stopping the recording drops the values but never weakens protection',
  },
];
const selected = process.argv.find(a => a.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), __filename, `--mutant=${i}`],
      { stdio: 'inherit', windowsHide: true, timeout: 240000 });
    assert.equal(r.status, 0, `Mutation ${i}: ${r.error ?? ''}`);
  }
  console.log(`PASS ${mutants.length} recording credential mutants killed`);
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
