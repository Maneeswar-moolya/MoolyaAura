/** Offline regression routing. This never invokes installed application validation. */
import { spawn } from 'node:child_process';
import { stopFixtureProcess } from './process-fixture';

export function fixtureRoute(file: string) {
  const fixture = file.replace(/\\/g, '/');
  if (!/^ai\/[\w/.-]+\.fixture\.ts$/.test(fixture) || fixture.includes('..')) throw Error('Invalid fixture path');
  const kind = fixture === 'ai/projects/repository-secrets.fixture.ts' ? 'repository-read-only'
    : fixture === 'ai/projects/onboarding.fixture.ts' ? 'self-isolated' : 'synthetic';
  // The synthetic worker has a five-minute execution limit; the outer minute
  // covers copying, seeding and guarded cleanup. Native onboarding owns its copy.
  const timeoutMs = kind === 'repository-read-only' ? 30000 : 360000;
  return { fixture, kind, timeoutMs, workerTimeoutMs: kind === 'synthetic' ? 300000 : null,
    args: ['node_modules/tsx/dist/cli.mjs', ...(kind === 'synthetic' ? ['ai/testing/regression-worker.ts'] : []), fixture] };
}

export async function runFixtureCommand(args: string[], timeoutMs: number) {
  const started = Date.now();
  const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false, error: string | undefined;
  child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  const timer = setTimeout(() => {
    timedOut = true;
    void stopFixtureProcess(child).catch(e => { error = String(e); });
  }, timeoutMs);
  const exitCode = await new Promise<number | null>(resolve => {
    child.once('error', e => { error = e.message; resolve(null); });
    child.once('close', code => resolve(code));
  });
  clearTimeout(timer);
  return { exitCode, timedOut, error, milliseconds: Date.now() - started, stdout, stderr };
}

export async function runFixture(file: string) {
  const route = fixtureRoute(file);
  const result = await runFixtureCommand(route.args, route.timeoutMs);
  return { ...route, ...result, timedOut: result.timedOut || (route.kind === 'synthetic' && result.exitCode === 124) };
}

/** A failed result is still a result; only the caller decides overall acceptance. */
export async function* collectFixtureResults<T>(fixtures: string[], execute: (file: string) => Promise<T>): AsyncGenerator<T> {
  for (const fixture of fixtures) yield await execute(fixture);
}
