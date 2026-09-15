import assert from 'node:assert/strict';
import { fixtureRoute, runFixtureCommand, collectFixtureResults } from './fixture-routing';
async function main() {
  for (const [file, kind] of [
    ['ai/projects/repository-secrets.fixture.ts', 'repository-read-only'],
    ['ai/projects/onboarding.fixture.ts', 'self-isolated'],
    ['ai/dashboard/dashboard-startup.fixture.ts', 'synthetic'],
  ]) {
    const route = fixtureRoute(file); assert.equal(route.kind, kind);
    assert.equal(route.args.includes('ai/testing/regression-worker.ts'), kind === 'synthetic');
  }
  assert.throws(() => fixtureRoute('ai/../outside.fixture.ts'));
  const results: Array<{ fixture: string; exitCode: number }> = [];
  for await (const result of collectFixtureResults(['failed', 'passed'], async fixture => ({ fixture, exitCode: fixture === 'failed' ? 1 : 0 }))) results.push(result);
  assert.deepEqual(results, [{ fixture: 'failed', exitCode: 1 }, { fixture: 'passed', exitCode: 0 }], 'sweep must continue after failure');
  const failed = await runFixtureCommand(['-e', "console.log('startup stdout'); console.error('startup stderr'); process.exitCode=7"], 10000);
  assert.equal(failed.exitCode, 7); assert.match(failed.stdout, /startup stdout/); assert.match(failed.stderr, /startup stderr/);
  const timeout = await runFixtureCommand(['-e', 'setInterval(()=>{},1000)'], 100);
  assert.equal(timeout.timedOut, true); assert.notEqual(timeout.exitCode, 0);
  const next = await runFixtureCommand(['-e', "console.log('continued after failure')"], 10000);
  assert.equal(next.exitCode, 0);
  console.log('PASS fixture routing, startup diagnostics, explicit timeout and continued execution');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
