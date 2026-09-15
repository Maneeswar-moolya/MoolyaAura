/** Explicitly invoked final sweep; fixture exit codes and repository integrity are recorded. */
import fs from 'node:fs';
import path from 'node:path';
import { runFixture, collectFixtureResults } from './fixture-routing';
import { createHash } from 'node:crypto';
const output = path.resolve(process.argv[2] ?? 'docs/validation/authoring-final-regression.json');
if (fs.existsSync(output)) throw Error('Refusing to overwrite an existing validation report.');
const files = (dir: string): string[] => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
  if (item.isSymbolicLink() || ['node_modules', '.git'].includes(item.name)) return [];
  const file = path.join(dir, item.name); return item.isDirectory() ? files(file) : [file];
}) : [];
const snapshot = () => Object.fromEntries(['ai', 'tests-e2e', 'excel'].flatMap(files)
  .concat(['package.json', 'package-lock.json', 'playwright.config.ts', 'playwright.excel.config.ts']).filter(file => fs.existsSync(file))
  .map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
async function main() {
const before = snapshot(), started = new Date().toISOString(), results: Array<Omit<Awaited<ReturnType<typeof runFixture>>, 'stdout' | 'stderr'>> = [];
const fixtures = files('ai').filter(file => file.endsWith('.fixture.ts')).sort();
const logDir = output.replace(/\.json$/, '-logs');fs.mkdirSync(logDir, { recursive: true });
for await (const { stdout, stderr, ...result } of collectFixtureResults(fixtures, runFixture)) {
  const fixture = result.fixture; results.push(result);
  fs.writeFileSync(path.join(logDir, fixture.replace(/[\\/]/g, '_') + '.log'), stdout + stderr);
  console.log(`${results.length}/${fixtures.length} exit=${result.exitCode} timeout=${result.timedOut} ${result.kind} ${fixture}`);
  // Persist progress and collect EVERY result, including after a failure or timeout.
  fs.writeFileSync(output, JSON.stringify({ started, suite: 'framework-contracts', liveApplicationValidation: false,
    total: fixtures.length, completed: results.length, results }, null, 2));
}
const after = snapshot(), changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
const report = { started, finished: new Date().toISOString(), suite: 'framework-contracts', liveApplicationValidation: false,
  total: fixtures.length, completed: results.length, results, changed,
  passed: results.length === fixtures.length && results.every(result => result.exitCode === 0 && !result.timedOut && !result.error) && !changed.length };
fs.mkdirSync(path.dirname(output), { recursive: true });fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: path.relative(process.cwd(), output), completed: results.length, total: fixtures.length, changed: changed.length, passed: report.passed }));
if (!report.passed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
