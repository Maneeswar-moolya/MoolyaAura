/**
 * Filesystem isolation for fixtures that WRITE or DELETE application artefacts.
 *
 * WHY THIS EXISTS, TWICE OVER
 *
 * A fixture builds a synthetic registry and then resolves `ScopePaths` from it - but
 * `pathsFor` builds those paths under the repository root, so a synthetic APPLICATION
 * still yields a REAL directory. Two incidents came from exactly that shape:
 *
 *   - `lifecycle-isolation.fixture.ts` used the id `bugasura` and its cleanup deleted
 *     `ai/dashboard/recordings/bugasura` - 410 real artefacts, recovered from a backup.
 *   - `dashboard-scope.fixture.ts` used the id `flipkart` and its cleanup recursively
 *     deleted `ai/dashboard/recordings/flipkart` - a real project's recordings, the day
 *     somebody added a real Flipkart project. Those were NOT recoverable.
 *
 * Both were "safe" under the reasoning that the id was made up. A made-up id is only made
 * up until somebody registers it, and the registry is now a thing users edit from a
 * dashboard - so the assumption gets less true over time, not more.
 *
 * THE FIX IS TO REMOVE THE ABILITY, NOT TO REMEMBER THE RULE
 *
 * `enterIsolatedArtefactRoot()` points `AURA_ARTEFACT_ROOT` at a temp directory, so every
 * path `ScopePaths` produces is inside it. A fixture in isolation cannot NAME
 * `ai/dashboard/recordings/<real app>`, so it cannot delete it however wrong its cleanup
 * is. `removeFixtureTree` is then a second, independent barrier: it refuses any path that
 * is not inside the active fixture root, so a fixture that forgot to isolate itself gets
 * an error instead of somebody's data.
 *
 * Two barriers rather than one on purpose. Isolation is the property that makes the
 * dangerous path unreachable; the guard is what catches the fixture that never enabled it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resetActiveScope } from './scope';

const ROOT = process.cwd();

/** The isolated root currently in force, or null when a fixture has not entered one. */
let fixtureRoot: string | null = null;

/**
 * Redirect every application artefact path into a fresh temporary directory.
 *
 * Created under the OS temp directory rather than the repository, so even a catastrophic
 * cleanup cannot reach tracked files. Returns the root so a fixture can assert against it.
 */
export function enterIsolatedArtefactRoot(label = 'aura-fixture'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  fixtureRoot = root;
  process.env.AURA_ARTEFACT_ROOT = root;
  // Paths are memoised on the scope; a root change must invalidate them.
  resetActiveScope();
  return root;
}

/** Leave isolation and remove the temporary root. Safe to call when never entered. */
export function leaveIsolatedArtefactRoot(): void {
  const root = fixtureRoot;
  fixtureRoot = null;
  delete process.env.AURA_ARTEFACT_ROOT;
  resetActiveScope();
  if (root && root.startsWith(os.tmpdir()))
    fs.rmSync(root, { recursive: true, force: true });
}

/** The active fixture root, or null. */
export function activeFixtureRoot(): string | null {
  return fixtureRoot;
}

/**
 * Is this path inside the active fixture root?
 *
 * False when no fixture root is active, which is the fail-closed answer: a fixture that
 * never isolated itself is asking about a real path.
 */
export function isInsideFixtureRoot(target: string): boolean {
  if (!fixtureRoot)
    return false;
  const relative = path.relative(fixtureRoot, path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Delete a tree, but only inside the active fixture root.
 *
 * THE ONLY DELETE A FIXTURE SHOULD USE for anything derived from a scope. It refuses
 * rather than deleting when the path is outside - including when no isolation is active
 * at all - because the two incidents above were both a `rmSync` that looked local and
 * resolved somewhere real.
 */
export function removeFixtureTree(target: string): void {
  if (!isInsideFixtureRoot(target)) {
    throw new Error('refusing to delete a path outside the fixture root: '
      + `${path.relative(ROOT, path.resolve(target)) || target}. `
      + (fixtureRoot
        ? `The active fixture root is ${fixtureRoot}.`
        : 'No fixture root is active - call enterIsolatedArtefactRoot() first.'));
  }
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * Refuse to proceed if a path a fixture intends to create already exists.
 *
 * The complement of the two barriers above: isolation stops a fixture reaching real data,
 * and this stops a fixture that is deliberately NOT isolated - because it is asserting
 * something about the real repository - from writing over anything.
 */
export function assertAbsent(targets: string[]): void {
  const occupied = targets.filter(target => fs.existsSync(target));
  if (occupied.length) {
    throw new Error('refusing to run: these paths already exist, so something real owns '
      + `them - ${occupied.map(target => path.relative(ROOT, target)).join(', ')}`);
  }
}
