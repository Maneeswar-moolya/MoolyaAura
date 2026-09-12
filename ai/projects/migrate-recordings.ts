/**
 * Move one application's recording artefacts under its scoped directory.
 *
 *   npx tsx ai/projects/migrate-recordings.ts --dry-run    # plan only, touch nothing
 *   npx tsx ai/projects/migrate-recordings.ts              # do it, transactionally
 *
 * WHY THIS IS A SCRIPT AND NOT A `mv`
 *
 * `ai/dashboard/recordings/` is GIT-IGNORED. There is no history to restore from, so a
 * half-finished move is unrecoverable - and it would also be SILENT, because
 * `layoutFor` prefers `<dir>/<applicationId>/` the moment that directory exists. Create
 * it, copy half the files, and the other half stop existing as far as the framework is
 * concerned: `analyseCorpus` reports a smaller corpus, `recordingStatus` reports
 * `exists: false`, and every one of those reads like "nobody recorded that case" rather
 * than like a failure.
 *
 * So this is a transaction with a verification gate before anything is deleted:
 *
 *   1. STAGE     copy every artefact into `recordings/.staging-<id>/`. That name is not
 *                a valid applicationId, so `layoutFor` cannot select it and the live
 *                store keeps resolving to the flat directory for the whole copy.
 *   2. VERIFY    sha256 every source against its copy. A single mismatch aborts before
 *                anything has been renamed or removed.
 *   3. BACKUP    a second independent copy, outside the recordings tree, kept.
 *   4. SWAP      rename staging -> `recordings/<applicationId>/`. This is the instant
 *                the framework starts resolving the new location.
 *   5. CONFIRM   re-resolve through the real accessors and re-read the corpus. The
 *                artefact COUNT and the resolved directory must both be right.
 *   6. REMOVE    only now, and only the originals that were verified in step 2.
 *
 * WHAT IS NOT MIGRATED, AND WHY IT IS NOT AN OVERSIGHT
 *
 * Page Objects, generated specs and the fixtures module stay flat. Their files carry
 * RELATIVE IMPORTS - a generated spec says `from '../fixtures'` and `from
 * '../pages/issues.page'`, a Page Object says `from '../support/resilient-locator'` -
 * so moving them one directory deeper breaks every one of those imports and Playwright
 * collects nothing. Recordings have no such problem: their `.spec.ts` files import
 * `@playwright/test` and nothing else, and they live outside `testDir`, so Playwright
 * never collects them at all. Rewriting the imports is a separate piece of work.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { acceptedDir, recordingsDir } from '../dashboard/recorder';
import { activeScope, resetActiveScope } from './scope';

const ROOT = process.cwd();
const RECORDINGS_ROOT = path.join(ROOT, 'ai', 'dashboard', 'recordings');

const rel = (value: string) => path.relative(ROOT, value).split(path.sep).join('/');

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Every file under `dir`, recursively, as paths relative to it. */
function filesUnder(dir: string, skip: (name: string) => boolean = () => false): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (skip(entry.name))
        continue;
      const full = path.join(current, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        walk(full, key);
      else if (entry.isFile())
        found.push(key);
    }
  };
  if (fs.existsSync(dir))
    walk(dir, '');
  return found.sort();
}

function main(): void {
  const dry = process.argv.includes('--dry-run');
  const scope = activeScope();
  const target = path.join(RECORDINGS_ROOT, scope.applicationId);
  const staging = path.join(RECORDINGS_ROOT, `.staging-${scope.applicationId}`);
  const backup = path.join(ROOT, 'ai', 'reports', `recordings-premigration-${scope.applicationId}`);

  const write = (line: string) => process.stdout.write(`${line}\n`);

  write('');
  write(`  application        ${scope.applicationId} (${scope.displayName})`);
  write(`  recordings root    ${rel(RECORDINGS_ROOT)}`);
  write(`  resolves today to  ${rel(recordingsDir())}`);
  write(`  archive today      ${rel(acceptedDir())}`);
  write(`  target             ${rel(target)}`);

  if (fs.existsSync(target)) {
    write(`\n  ALREADY MIGRATED - ${rel(target)} exists. Nothing to do.\n`);
    return;
  }
  if (!fs.existsSync(RECORDINGS_ROOT)) {
    write('\n  Nothing to migrate: there is no recordings directory.\n');
    return;
  }

  // Everything except the staging directory itself and any directory that already
  // carries an applicationId - a second application's store is not ours to move.
  const reserved = new Set([path.basename(staging), scope.applicationId]);
  const sources = filesUnder(RECORDINGS_ROOT, name => reserved.has(name));

  const live = sources.filter(file => !file.includes('/')).length;
  const archived = sources.filter(file => file.startsWith('accepted/')).length;
  write(`\n  ${sources.length} artefact(s): ${live} live, ${archived} archived, `
    + `${sources.length - live - archived} elsewhere`);

  if (!sources.length) {
    write('\n  Nothing to migrate.\n');
    return;
  }

  if (dry) {
    write(`\n  DRY RUN - nothing was copied, renamed or removed.`);
    write(`  Would stage into   ${rel(staging)}`);
    write(`  Would back up to   ${rel(backup)}`);
    write(`  Would end up at    ${rel(target)}\n`);
    return;
  }

  // 1. STAGE. A name layoutFor cannot select, so the live store is untouched until
  //    the swap - a copy interrupted here leaves the repository exactly as it was.
  fs.rmSync(staging, { recursive: true, force: true });
  for (const file of sources) {
    const from = path.join(RECORDINGS_ROOT, file);
    const to = path.join(staging, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  // 2. VERIFY. Byte-for-byte, before anything is renamed and long before anything is
  //    removed. A mismatch aborts with the originals still in place.
  const mismatched: string[] = [];
  for (const file of sources) {
    if (sha256(path.join(RECORDINGS_ROOT, file)) !== sha256(path.join(staging, file)))
      mismatched.push(file);
  }
  if (mismatched.length) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`${mismatched.length} file(s) did not copy identically - `
      + `${mismatched.slice(0, 3).join(', ')}. Nothing was moved; the originals are untouched.`);
  }
  write(`  verified           ${sources.length}/${sources.length} sha256 match`);

  // 3. BACKUP, outside the recordings tree so a mistake in it cannot be selected as a
  //    scope, and kept afterwards rather than cleaned up.
  fs.rmSync(backup, { recursive: true, force: true });
  for (const file of sources) {
    const to = path.join(backup, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(RECORDINGS_ROOT, file), to);
  }
  fs.writeFileSync(path.join(backup, 'MANIFEST.sha256'),
    `${sources.map(file => `${sha256(path.join(backup, file))} *${file}`).join('\n')}\n`, 'utf8');
  write(`  backed up          ${rel(backup)}`);

  // 4. SWAP.
  fs.renameSync(staging, target);

  // The active scope is MEMOISED, and it was resolved before the swap - when
  // `<recordings>/bugasura` did not exist, so `layoutFor` correctly answered with the
  // flat directory and cached it. Without this the confirmation below reads a stale
  // answer and the transaction rolls back a migration that actually succeeded, which
  // is what happened the first time this was run. Dropping the memo is not a
  // workaround for the cache; it is the one moment in the process where the thing the
  // cache describes has genuinely changed underneath it.
  resetActiveScope();

  // 5. CONFIRM through the real accessors, not through the paths this script composed.
  const resolved = recordingsDir();
  if (path.resolve(resolved) !== path.resolve(target)) {
    fs.renameSync(target, staging);
    resetActiveScope();
    throw new Error(`after the swap recordingsDir() resolved to ${rel(resolved)}, not ${rel(target)}. `
      + 'Rolled back; the originals are untouched.');
  }
  const seen = filesUnder(target);
  if (seen.length !== sources.length) {
    fs.renameSync(target, staging);
    resetActiveScope();
    throw new Error(`the migrated directory holds ${seen.length} artefact(s), expected ${sources.length}. `
      + 'Rolled back; the originals are untouched.');
  }
  write(`  confirmed          ${rel(resolved)} holds ${seen.length} artefact(s)`);

  // 6. REMOVE, last, and only what step 2 verified.
  for (const file of sources)
    fs.rmSync(path.join(RECORDINGS_ROOT, file), { force: true });
  for (const entry of fs.readdirSync(RECORDINGS_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== scope.applicationId
      && !fs.readdirSync(path.join(RECORDINGS_ROOT, entry.name)).length)
      fs.rmdirSync(path.join(RECORDINGS_ROOT, entry.name));
  }

  write(`\n  MIGRATED - ${sources.length} artefact(s) now under ${rel(target)}`);
  write(`  The pre-migration copy is kept at ${rel(backup)} and is git-ignored.\n`);
}

main();
