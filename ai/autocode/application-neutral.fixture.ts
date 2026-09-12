import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { instructions } from './agent';
import { resetActiveScope } from '../projects/scope';
import { resetActiveApplication } from '../knowledge/canonical';
import * as sharedFixtures from '../../tests-e2e/support/base-fixtures';

const file = process.env.AURA_REGISTRY_FILE!;
const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
const originalRegistry = JSON.stringify(registry);
registry.applications.push({ applicationId: 'second-fixture', displayName: 'Second fixture', defaultEnvironmentId: 'qa',
  environments: { qa: { baseUrl: 'https://second.example.invalid/' } }, workbooks: ['excel/second.xlsx'] });
fs.writeFileSync(file, JSON.stringify(registry));
process.env.OTHER_APPLICATION_ALLOW_DATA_MUTATION = '1';

for (const [applicationId, url, permission] of [
  ['fixtureapp', 'https://portal.fixture.invalid/', 'FIXTUREAPP_ALLOW_DATA_MUTATION'],
  ['second-fixture', 'https://second.example.invalid/', 'SECOND_FIXTURE_ALLOW_DATA_MUTATION'],
]) {
  process.env.AURA_APPLICATION = applicationId;
  resetActiveScope(); resetActiveApplication();
  const request = { testCase: { testCaseId: 'TC_NEUTRAL_001', scenario: 'Create a draft' },
    workbook: applicationId === 'fixtureapp' ? 'excel/fixture-cases.xlsx' : 'excel/second.xlsx', specFile: 'synthetic.spec.ts' } as never;
  delete process.env[permission];
  const denied = instructions(request);
  assert.ok(denied.includes(url), 'browser instructions must use the selected application URL');
  assert.ok(denied.includes('Data-mutating flows are NOT permitted'), 'another application cannot grant mutation permission');
  process.env[permission] = '1';
  const allowed = instructions(request);
  assert.ok(allowed.includes('Data-mutating flows are permitted'), 'explicit permission for this application must apply');
  assert.ok(allowed.includes(permission), 'generated tests must retain the application permission guard');
  const guard = /with (\w+)\(process\.env\./.exec(allowed)?.[1];
  assert.equal(typeof sharedFixtures[guard as keyof typeof sharedFixtures], 'function',
      'prompt mutation guard must exist in the shared fixture API');
  delete process.env[permission];
}
console.log('PASS: configured browser destination and application-scoped mutation permission');

if (process.argv.includes('--mutate')) {
  const sourceFile = path.join(process.cwd(), 'ai/autocode/agent.ts');
  const original = fs.readFileSync(sourceFile, 'utf8');
  const mutations = [
    ['fixed browser destination', '...browserCrib(handover, withheld, scope.baseUrl)',
      "...browserCrib(handover, withheld, 'https://wrong.example.invalid/')",
      'browser instructions must use the selected application URL'],
    ['borrowed mutation permission', "process.env[mutationPermission] === '1'",
      "process.env.OTHER_APPLICATION_ALLOW_DATA_MUTATION === '1'",
      'another application cannot grant mutation permission'],
    ['missing shared guard export', 'with requireDataMutationOptIn(',
      'with removedMutationGuard(', 'prompt mutation guard must exist in the shared fixture API'],
  ];
  try {
    for (const [label, before, after, expected] of mutations) {
      assert.equal(original.split(before).length, 2, `${label}: marker must match once`);
      fs.writeFileSync(sourceFile, original.replace(before, after));
      fs.writeFileSync(file, originalRegistry);
      const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', __filename],
        { cwd: process.cwd(), env: { ...process.env, AURA_APPLICATION: 'fixtureapp' }, encoding: 'utf8', timeout: 60_000, windowsHide: true });
      assert.notEqual(result.status, 0, `${label}: mutant survived`);
      assert.ok(result.stderr.includes(expected), `${label}: expected behavioral failure, got ${result.stderr}`);
      console.log(`KILLED: ${label}`);
    }
  } finally {
    fs.writeFileSync(sourceFile, original);
    fs.writeFileSync(file, originalRegistry);
  }
}
