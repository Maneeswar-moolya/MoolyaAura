import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseRecording, redactSourceForTest } from './recorder';
import { recordingSource } from '../testing/synthetic-data';

// Deliberately not named PASSWORD/TOKEN/SECRET: the registry declaration is authority.
const registryFile = process.env.AURA_REGISTRY_FILE!;
const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
const originalRegistry = JSON.stringify(registry);
registry.applications[0].environments.qa.credentials.password = 'FIXTURE_OPAQUE_VALUE';
fs.writeFileSync(registryFile, JSON.stringify(registry));
process.env.FIXTURE_OPAQUE_VALUE = 'authored-private-value';
process.env.UNRELATED_SERVICE_TOKEN = 'authored-service-value';

for (const key of ['FIXTURE_OPAQUE_VALUE', 'UNRELATED_SERVICE_TOKEN']) {
  const value = process.env[key]!;
  const source = recordingSource([
    `await page.getByLabel('Reference').fill('${value}');`,
    `// retained source must redact this too: ${value}`,
  ]);
  const parsed = parseRecording(source, { startUrl: '', browser: '', durationMs: 0 });
  assert.equal(parsed.actions[0]?.redacted, true, `${key}: oddly labelled field must be redacted`);
  assert.equal(parsed.actions[0]?.value, '[type=password]');
  assert.ok(!redactSourceForTest(source, parsed).includes(value), `${key}: source must not retain a known secret`);
}
registry.applications = [];
fs.writeFileSync(registryFile, JSON.stringify(registry));
const source = recordingSource(["await page.getByLabel('Password').fill('typed-private-value');"]);
assert.equal(parseRecording(source, { startUrl: '', browser: '', durationMs: 0 }).actions[0]?.redacted, true);
console.log('PASS: declared secret names, conventional tokens, persisted source, and empty-registry redaction');

if (process.argv.includes('--mutate')) {
  const file = path.join(process.cwd(), 'ai/dashboard/recorder.ts');
  const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const mutants = [
    ['declared password names ignored', 'names.add(environment.credentials.password);', ';', 'FIXTURE_OPAQUE_VALUE'],
    ['conventional service secrets ignored',
      'const names = new Set(Object.keys(process.env).filter(name =>\n'
      + '    /(?:^|_)(?:PASSWORD|PASSWD|PWD|TOKEN|SECRET|API_KEY|PRIVATE_KEY)(?:_|$)/i.test(name)));',
      'const names = new Set<string>();', 'UNRELATED_SERVICE_TOKEN'],
  ];
  try {
    for (const [label, before, after, expected] of mutants) {
      assert.equal(original.split(before).length, 2, `${label}: mutation must match exactly once`);
      fs.writeFileSync(file, original.replace(before, after));
      fs.writeFileSync(registryFile, originalRegistry);
      const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename],
        { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
      assert.notEqual(result.status, 0, `${label}: mutant survived`);
      assert.match(result.stderr, new RegExp(`${expected}: oddly labelled field must be redacted`));
      console.log(`KILLED: ${label}`);
    }
  } finally {
    fs.writeFileSync(file, original);
    fs.writeFileSync(registryFile, originalRegistry);
  }
}
