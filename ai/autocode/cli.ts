/**
 * npm run excel:autocode -- <workbook> [--ids A,B] [--dry-run] [--no-create-page-objects]
 * npm run excel:autocode -- --watch
 *
 * `--watch` is the no-intervention mode: it watches excel/ and generates for
 * whatever changed. That covers editing a workbook in Excel and dropping a bulk
 * file in, which the dashboard hook cannot see because neither goes through it.
 */

import fs from 'node:fs';
import path from 'node:path';

import { appendLog, isRunning, run } from './orchestrate';
import { resolveScope } from '../projects/scope';
import { executionContextFromTransport, executionSelectionFromTransport } from '../projects/execution-context';

const ROOT = process.cwd();
const EXCEL_DIR = path.join(ROOT, 'excel');
/** Long enough that Excel's save (write, rename, unlock) settles into one event. */
const DEBOUNCE_MS = 4_000;

function fail(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

const write = (text: string) => process.stdout.write(text);

async function once(workbook: string, ids: string[] | undefined, dryRun: boolean,
    createPageObjects = true): Promise<void> {
  const scope=resolveScope({workbook,environmentId:process.env.AURA_ENVIRONMENT || undefined});
  const executionSelection=executionSelectionFromTransport();
  const executionContext=dryRun ? undefined : executionContextFromTransport(scope,executionSelection);
  const result = await run({ workbook, onlyIds: ids, dryRun, createPageObjects, onLog: write,executionContext,executionSelection });

  // The one line that carries the runId to whoever is reading stdout.
  //
  // `appendLog` writes it into ai/reports/autocode-log.md and the metrics NDJSON
  // carries it too - but the dashboard spawns this CLI and sees only its output, so
  // without this line a dashboard-started generation cannot be joined to its own
  // records in ai/reports/page-object-lifecycle.jsonl at all. Correlating those on a
  // timestamp window instead is exactly the mis-attribution `metrics.ts` refuses for
  // `browse.mjs`, and for the same reason: this is a grandchild-process world.
  //
  // MIRRORED IN ai/dashboard/generation-history.ts AS `RUN_ID_MARKER`, AND THE TWO
  // MUST AGREE - the generator must not import from the dashboard, so the dashboard's
  // fixture reads this file and checks the line still parses. Printed before the
  // blocked branch below, because a run that refused to start still has an id.
  if (result.runId)
    write(`\nautocode run id: ${result.runId}\n`);

  if (!dryRun)
    appendLog(result);

  if (result.blocked) {
    write(`\n${result.blocked}\n\n`);
    return;
  }
  const counts = result.outcomes.reduce<Record<string, number>>((total, outcome) => {
    total[outcome.verdict] = (total[outcome.verdict] ?? 0) + 1;
    return total;
  }, {});
  write(`\naccepted ${counts.accepted ?? 0}, quarantined ${counts.quarantined ?? 0}, ` +
    `declined ${counts.declined ?? 0}, failed ${counts.failed ?? 0}\n`);
  if (counts.quarantined)
    write('Quarantined specs are in ai/autocode/quarantine/ and are NOT part of the suite.\n');
  write('Nothing was committed and nothing was promoted to Automated.\n\n');
}

/**
 * Watch excel/ and generate for whatever is written there.
 *
 * Ignores Excel's own lock files (`~$name.xlsx`) and the backup directory,
 * which would otherwise make every write-back trigger a generation run.
 */
function watch(): void {
  if (!fs.existsSync(EXCEL_DIR))
    fail(`No excel/ directory at ${EXCEL_DIR}.`);

  write(`\nautocode watching ${EXCEL_DIR}\n  Ctrl+C to stop\n\n`);
  const pending = new Map<string, NodeJS.Timeout>();

  fs.watch(EXCEL_DIR, { recursive: true }, (_event, filename) => {
    if (!filename)
      return;
    const name = filename.toString().replace(/\\/g, '/');
    if (!name.endsWith('.xlsx') || path.basename(name).startsWith('~$') || name.startsWith('.backups/'))
      return;

    const workbook = path.join(EXCEL_DIR, name);
    clearTimeout(pending.get(workbook));
    pending.set(workbook, setTimeout(() => {
      pending.delete(workbook);
      if (!fs.existsSync(workbook))
        return;
      if (isRunning()) {
        write(`\n${name} changed while a run is in progress - it will be picked up on the next change.\n`);
        return;
      }
      write(`\n${name} changed\n`);
      void once(workbook, undefined, false).catch(error => {
        write(`\nautocode failed: ${(error as Error).message}\n`);
      });
    }, DEBOUNCE_MS));
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--watch')) {
    watch();
    return;
  }

  const positional = argv.filter(token => !token.startsWith('--'));
  const flag = (name: string): string | undefined => {
    const inline = argv.find(token => token.startsWith(`--${name}=`));
    if (inline)
      return inline.split('=').slice(1).join('=');
    const index = argv.indexOf(`--${name}`);
    return index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : undefined;
  };

  const workbook = positional[0] ?? 'excel/login-test-cases.xlsx';
  if (!fs.existsSync(path.resolve(workbook)))
    fail(`No workbook at ${workbook}.`);

  const ids = flag('ids')?.split(',').map(id => id.trim()).filter(Boolean);
  await once(workbook, ids, argv.includes('--dry-run'), !argv.includes('--no-create-page-objects'));
}

void main().catch(error => fail((error as Error).stack ?? String(error)));
