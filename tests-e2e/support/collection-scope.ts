/**
 * Which specs Playwright may collect for the application that is about to run.
 *
 * THE PROBLEM THIS SOLVES IS `--grep`, NOT DISCOVERY.
 *
 * `playwright.excel.config.ts` sets `testDir: './tests-e2e'`, and both callers -
 * `ai/excel/cli.ts` and the falsification gate in `ai/autocode/verify.ts` - select a
 * case with `--grep <TC_ID>` and no path argument. A Test Case ID is unique inside an
 * application and deliberately REUSABLE across them (`ai/projects/scope.ts` says so:
 * `bugasura/TC_LOGIN_001` and `demoapp/TC_LOGIN_001` are different cases with no
 * collision and no renaming). Collect both applications and that grep matches two
 * tests. Both run; `ai/excel/results.ts` recovers the ID from the test TITLE, which
 * carries no application; and one workbook row gets the other application's verdict.
 *
 * That is a misattribution, not a crash, which is why it has to be closed here rather
 * than left to be noticed.
 *
 * WHAT IS IGNORED, AND HOW IT IS DECIDED
 *
 * The registry is the authority, exactly as it is for paths. `ApplicationScope.paths`
 * already answers "where do this application's generated specs live", so this asks the
 * same question of every registered application and ignores everyone else's answer.
 * Nothing is inferred from a file name, a title, a locator or a URL.
 *
 * The application that owns the flat layout (`legacyLayout`) also owns every
 * hand-written suite under `tests-e2e/` - that is what owning the unscoped artefacts
 * means - so for that application only the other applications' scoped directories are
 * ignored. For a scoped application the reverse holds: everything is ignored except its
 * own generated directory and the SHARED data-driven runner, which is framework rather
 * than application (`tests-e2e/generic/generic.spec.ts`, `@data-driven-module: *`, the
 * catch-all that lets a brand-new module run with no code written).
 *
 * Registry size never grants collection ownership. Scoped directories remain scoped
 * even if their applications are subsequently removed from the registry.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readRegistry } from '../../ai/projects/registry';
import { resolveScope } from '../../ai/projects/scope';

const ROOT = process.cwd();

/** Framework specs no application owns. Collected for everyone. */
const SHARED_SPEC_DIRS = ['generic'];

/** POSIX-style, repo-relative, which is the shape Playwright matches globs against. */
function rel(absolute: string): string {
  return path.relative(ROOT, absolute).replace(/\\/g, '/');
}

export function collectionIgnoreFor(): string[] {
  let registry;
  try {
    registry = readRegistry();
  } catch {
    // No registry at all is a pre-registry checkout. It has one application by
    // definition, so there is nothing to separate and nothing to ignore.
    return [];
  }
  // WHICH APPLICATION IS ABOUT TO RUN. `AURA_APPLICATION` is the selection mechanism
  // every CLI in this repository already uses (`activeScope`), and `ai/excel/cli.ts`
  // sets it in the Playwright child from the workbook's declared owner - so the runs
  // that select a case by `--grep <TC_ID>`, the ones that can misattribute, always
  // arrive here with an application named.
  //
  // NO SELECTION IS NOT AN ERROR HERE, and this is the one place that judgement differs
  // from the rest of the scope layer. `resolveScope({})` refuses an ambiguous request
  // because it is about to FILE an artefact somewhere. This is a config file: throwing
  // means Playwright cannot load it at all, so `npx playwright test --list`, a
  // whole-suite run and every tooling call that never names a case would stop working
  // the moment a second project existed. Ignoring nothing is also the honest answer to
  // what was asked - a run that named no application and no case wants the whole suite.
  let scope;
  try {
    scope = resolveScope({
      applicationId: process.env.AURA_APPLICATION?.trim() || undefined,
      environmentId: process.env.AURA_ENVIRONMENT?.trim() || undefined,
    }, registry);
  } catch {
    return [];
  }

  const ignore: string[] = [];

  if (scope.flatLayout) {
    for (const application of registry.applications) {
      if (application.applicationId !== scope.applicationId)
        ignore.push(`tests-e2e/generated/${application.applicationId}/**`);
    }
    // Every child of generated/ is an application namespace, even after deregistration.
    const generated = path.join(ROOT, 'tests-e2e/generated');
    if (fs.existsSync(generated)) {
      for (const entry of fs.readdirSync(generated, { withFileTypes: true })) {
        if (entry.isDirectory() && path.join(generated, entry.name) !== scope.paths.generatedDir)
          ignore.push(`${rel(path.join(generated, entry.name))}/**`);
        else if (entry.isFile() && scope.paths.generatedDir !== generated)
          ignore.push(rel(path.join(generated, entry.name)));
      }
    }
    return [...new Set(ignore)];
  }

  // A scoped application owns ONE directory. Everything else under tests-e2e belongs to
  // the flat owner - its hand-written suites and its flat generated specs alike - so the
  // list is built by naming what is kept and excluding the rest of the tree. Built from
  // the directory as it actually is rather than from a hardcoded list, so a suite added
  // later is excluded by default: for a foreign application, unknown means not mine.
  const mine = rel(scope.paths.generatedDir);
  const suiteRoot = path.join(ROOT, 'tests-e2e');
  for (const entry of fs.readdirSync(suiteRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || SHARED_SPEC_DIRS.includes(entry.name))
      continue;
    const child = rel(path.join(suiteRoot, entry.name));
    if (mine === child || mine.startsWith(`${child}/`)) {
      // The generated tree holds this application's directory. Exclude its
      // siblings - the flat owner's own specs and any third application - by name.
      for (const inner of fs.readdirSync(path.join(ROOT, child), { withFileTypes: true })) {
        const innerPath = rel(path.join(ROOT, child, inner.name));
        if (innerPath === mine)
          continue;
        ignore.push(inner.isDirectory() ? `${innerPath}/**` : innerPath);
      }
      continue;
    }
    ignore.push(`${child}/**`);
  }
  // Loose specs sitting directly in tests-e2e/ belong to the flat owner too.
  for (const entry of fs.readdirSync(suiteRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.spec\.ts$/.test(entry.name))
      ignore.push(rel(path.join(suiteRoot, entry.name)));
  }
  return ignore;
}
