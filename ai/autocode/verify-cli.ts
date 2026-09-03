/**
 * npm run excel:verify -- [--ids TC_X,TC_Y] [--file <spec>]
 *
 * The falsification gate, pointed at specs nobody generated.
 *
 * `ai/autocode/verify.ts` already refuses to register a generated spec that
 * passes with its assertions broken - a test that checks nothing looks exactly
 * like coverage in every report, so it is the one failure worth paying two runs
 * to catch. Nothing applied that standard to specs written by hand, which is
 * the larger half of the suite and the half nobody re-reads.
 *
 * The one deliberate difference: this **never moves a file**. The orchestrator
 * quarantines what it generated, because it generated it. A spec somebody wrote
 * is theirs; a tool that relocates it on a heuristic is worse than the vacuous
 * test it was chasing. This reports, and exits non-zero so CI can gate on it.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readMapping, scanDataDrivenRunners } from '../excel/mapping';
import { gate, type GateResult } from './verify';

const ROOT = process.cwd();

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

const write = (text: string) => process.stdout.write(text);

interface Target {
  testCaseId: string;
  scenario: string;
  testFile: string;
  workbook: string;
}

/**
 * Specs to check, from the mapping.
 *
 * Data-driven rows are skipped, and finding them here took a run to notice:
 * `excel:run` registers them against the *runner* that executes them, so they
 * carry a `testFile` like any other entry. The gate then looked for a test
 * titled `TC_LOGIN_010 - ...` in a file whose titles are built at run time,
 * found nothing, and reported eleven honest rows as suspect. Runners are
 * identified the same way `runnerFor` identifies them - by the
 * `@data-driven-module:` marker in the source - so the list stays correct when
 * a module gets a runner of its own.
 *
 * Their assertions come from the workbook, where `contractGap` checks them.
 * There is no per-case source to mutate, so the gate has nothing to add.
 */
function targets(ids: string[] | undefined, file: string | undefined): Target[] {
  const mapping = readMapping();
  const found: Target[] = [];
  const runners = new Set(
      scanDataDrivenRunners(path.resolve(ROOT, 'tests-e2e'))
          .map(runner => path.resolve(ROOT, runner.testFile)));

  for (const [testCaseId, entry] of Object.entries(mapping)) {
    if (!entry.testFile)
      continue;
    if (runners.has(path.resolve(ROOT, entry.testFile)))
      continue;
    if (ids && !ids.includes(testCaseId))
      continue;
    if (file && path.resolve(ROOT, entry.testFile) !== path.resolve(ROOT, file))
      continue;
    if (!fs.existsSync(path.resolve(ROOT, entry.testFile))) {
      write(`  ! ${testCaseId}: mapping points at ${entry.testFile}, which does not exist\n`);
      continue;
    }
    found.push({
      testCaseId,
      scenario: entry.scenario ?? '',
      testFile: entry.testFile,
      workbook: entry.sourceWorkbook
        ? path.join('excel', entry.sourceWorkbook)
        : 'excel/login-test-cases.xlsx',
    });
  }

  if (ids) {
    for (const id of ids) {
      if (!found.some(target => target.testCaseId === id))
        write(`  ! ${id}: no mapping entry with a spec file - nothing to verify\n`);
    }
  }
  return found;
}

function describe(result: GateResult): string {
  const { detail } = result;
  if (detail.staticProblems.length)
    return detail.staticProblems.join('; ');
  return `clean=${detail.cleanStatus ?? '?'} mutated=${detail.mutatedStatus ?? '?'}` +
    (detail.mutationsApplied.length ? ` (${detail.mutationsApplied.join('; ')})` : '');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const inline = argv.find(token => token.startsWith(`--${name}=`));
    if (inline)
      return inline.split('=').slice(1).join('=');
    const index = argv.indexOf(`--${name}`);
    return index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : undefined;
  };

  const ids = flag('ids')?.split(',').map(id => id.trim()).filter(Boolean);
  const file = flag('file');
  const list = targets(ids, file);
  if (!list.length)
    fail('Nothing to verify. Run `npm run excel:mapping -- sync` first, or check --ids/--file.');

  write(`\nverifying ${list.length} spec-backed case(s). Each runs twice: as written, and with ` +
    'its assertions broken.\n\n');

  /**
   * Three outcomes, kept apart on purpose.
   *
   * Only `suspect` is this tool's finding: a spec that passes with its
   * assertions broken. A spec that skipped never ran, and one that is red is
   * already shouting in the suite - lumping either in with "could not be shown
   * to test anything" makes the number meaningless, and a number nobody trusts
   * gets ignored exactly when it matters.
   */
  const suspect: Array<{ target: Target; result: GateResult }> = [];
  const skipped: Array<{ target: Target; result: GateResult }> = [];
  const red: Array<{ target: Target; result: GateResult }> = [];

  for (const target of list) {
    write(`${target.testCaseId}  ${target.testFile}\n`);
    const result = gate(target.testFile, target.testCaseId, target.scenario, target.workbook,
        text => write(`  |${text}`));

    let mark = 'ok     ';
    if (result.verdict !== 'accepted') {
      const clean = result.detail.cleanStatus;
      if (clean === 'Skipped') {
        mark = 'skipped';
        skipped.push({ target, result });
      } else if (clean === 'Not Collected') {
        // A SPEC THAT NEVER RAN IS NOT SUSPECT. `SUSPECT` means "passed with every
        // assertion broken" - the false-positive finding, and this tool's only non-zero
        // exit. A collection failure was landing in it by falling off the end of this
        // chain, so a spec Playwright had refused to build was reported as one that had
        // run and checked nothing. It is a broken spec, which is what `red` means.
        mark = 'red    ';
        red.push({ target, result });
      } else if (clean === 'Failed') {
        mark = 'red    ';
        red.push({ target, result });
      } else {
        mark = 'SUSPECT';
        suspect.push({ target, result });
      }
    }
    write(`  ${mark} ${describe(result)}\n\n`);
  }

  const verified = list.length - suspect.length - skipped.length - red.length;
  write(`${verified} of ${list.length} verified: each passes as written and fails when its ` +
    'assertions are broken.\n');

  if (skipped.length) {
    write(`\n${skipped.length} skipped, so nothing was proved either way ` +
      `(${skipped.map(entry => entry.target.testCaseId).join(', ')}).\n` +
      '  Usually a missing credential or an opt-in like BUGASURA_ALLOW_DATA_MUTATION. Not a ' +
      'false positive - a skip reports as a skip - but it is not coverage either.\n');
  }
  if (red.length) {
    write(`\n${red.length} already failing, so the gate had nothing to add ` +
      `(${red.map(entry => entry.target.testCaseId).join(', ')}).\n` +
      '  A red test is doing its job; fix or triage it in the suite.\n');
  }
  if (!suspect.length) {
    write('\nNo spec passed with its assertions broken.\n\n');
    return;
  }

  write(`\n${suspect.length} passed with every assertion broken, so ${suspect.length === 1
    ? 'it is' : 'they are'} not checking the application:\n\n`);
  for (const { target, result } of suspect)
    write(`  ${target.testCaseId}  ${target.testFile}\n    ${result.reason}\n\n`);
  write('Nothing was moved or edited. A spec that passes with its assertions broken is either ' +
    'asserting on a constant, or asserting something that is true of every page.\n\n');
  process.exit(1);
}

void main().catch(error => fail((error as Error).stack ?? String(error)));
