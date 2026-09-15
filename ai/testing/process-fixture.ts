/** Process-fixture diagnostics and bounded cleanup, never a production process manager. */
import { spawnSync, type ChildProcess } from 'node:child_process';

export async function stopFixtureProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
  } else child.kill('SIGKILL');
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Fixture child did not exit after termination')), 10000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

export async function waitForFixtureHttp(child: ChildProcess, url: string, output: () => string,
  timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error(`Dashboard startup failed (exit ${child.exitCode}, signal ${child.signalCode}):\n${output()}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Dashboard readiness timed out after ${timeoutMs}ms:\n${output()}`);
}
