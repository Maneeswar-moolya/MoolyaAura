import '../testing/isolated-checkout';
/**
 * The offline gate for SAFE PROJECT PROVISIONING. No browser, no model, no network.
 *
 * It defends one sentence:
 *
 *   Registering a second application must not alter, hide, misattribute or collide
 *   with the first one's artefacts.
 *
 * WHY THIS FIXTURE EXISTS AT ALL, AND WHAT IT CAUGHT
 *
 * `layoutFor` preferred `<dir>/<applicationId>/` and fell back to the flat `<dir>/`
 * WHILE EXACTLY ONE APPLICATION WAS REGISTERED. That condition is a fact about the
 * registry's SIZE, not about who owns the directory - so adding a second application
 * silently moved five of FixturePortal's six artefact classes to scoped directories that do
 * not exist. Measured against the real repository: 7 Page Objects, 3 knowledge files,
 * 62 generated specs, the mapping file and the fixtures module all resolved MISSING,
 * and nothing anywhere reported an error. `ApplicationConfig.legacyLayout` declares the
 * owner instead, and part A below is the regression test for that.
 *
 * Three consequences of the fix are separately dangerous and separately tested:
 *
 *   - a second application's scoped directory sits INSIDE the first's flat one
 *     (`tests-e2e/generated/fixtureextra` inside `tests-e2e/generated`), so a recursive
 *     scan reaches it - part E;
 *   - Playwright collects `testDir: './tests-e2e'` and both callers select with
 *     `--grep <TC_ID>`, and a Test Case ID is deliberately reusable across
 *     applications - part F;
 *   - a generated spec's `../fixtures` import is correct for the flat layout only -
 *     part G.
 *
 * SAFETY. Nothing real is written. The registries are temp files reached through
 * `AURA_REGISTRY_FILE`; the synthetic trees live under one temp directory whose every
 * path `assertNothingRealAtRisk()` refuses to touch if it already exists; and part H
 * hashes the real FixturePortal artefacts before and after the whole run.
 *
 * Run: npx tsx ai/projects/provisioning-isolation.fixture.ts
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { enterIsolatedArtefactRoot, leaveIsolatedArtefactRoot } from './fixture-safety';
import path from 'node:path';

import { resetActiveApplication } from '../knowledge/canonical';
import { scanDataDrivenRunners, scanSpecs } from '../excel/mapping';
import { readRegistry, validateRegistry } from './registry';
import { activeScope, resolveScope, ScopeError, resetActiveScope, registeredApplicationIds } from './scope';

const ROOT = process.cwd();

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    console.log(`  ok    ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n== ${title} ==`);
}

/** Repo-relative, forward slashes - so a check reads as a path, not a drive letter. */
function norm(value: string): string {
  return path.relative(ROOT, path.resolve(ROOT, value)).split(path.sep).join('/');
}

/* ---------------------------------------------------------------- safety ------- */

const TEMP_DIR = path.join(ROOT, '.tmp-provisioning-fixture');

/**
 * The synthetic application ids. Deliberately NOT `fixtureapp`.
 *
 * An earlier fixture in this directory used the real id, and its cleanup deleted
 * `ai/dashboard/recordings/fixtureapp` - 409 real artefacts, recovered from a backup.
 * The second application here is `fixtureextra` only where it is READ as a name; every
 * directory this fixture creates lives under TEMP_DIR.
 */
const SECOND_APP = 'fixtureextra';

/**
 * Refuse to run if anything this fixture would create already exists.
 *
 * The guard is the reason a `rmSync` in the cleanup is safe: it can only remove a tree
 * this run made, because a pre-existing one aborts the run before a single write.
 */
function assertNothingRealAtRisk(): void {
  if (fs.existsSync(TEMP_DIR)) {
    throw new Error(`${norm(TEMP_DIR)} already exists. This fixture only ever creates it, `
      + 'so something else owns that path - refusing to run rather than delete it.');
  }
  const real = path.join(ROOT, 'ai', 'dashboard', 'recordings', 'fixtureapp');
  if (!fs.existsSync(real)) {
    throw new Error('The real FixturePortal recording store is missing. Refusing to run: this '
      + 'fixture asserts that store is UNCHANGED, and it cannot do that if it is not there.');
  }
}

/** Hash every real FixturePortal artefact this phase must not touch. */
function realArtefactDigest(): { files: number; digest: string } {
  const roots = [
    'ai/dashboard/recordings/fixtureapp',
    'tests-e2e/pages',
    'tests-e2e/generated',
    'ai/knowledge/page',
    'ai/test-mapping/mapping.json',
    'tests-e2e/fixtures.ts',
  ];
  const hash = crypto.createHash('sha256');
  let files = 0;
  const walk = (target: string): void => {
    if (!fs.existsSync(target))
      return;
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      files += 1;
      hash.update(norm(target));
      hash.update(fs.readFileSync(target));
      return;
    }
    for (const name of fs.readdirSync(target).sort())
      walk(path.join(target, name));
  };
  for (const root of roots)
    walk(path.join(ROOT, root));
  return { files, digest: hash.digest('hex') };
}

/* ------------------------------------------------------- the two registries ---- */

interface AppSpec {
  applicationId: string;
  displayName: string;
  baseUrl: string;
  workbooks: string[];
  legacyLayout?: boolean;
}

const FIXTUREAPP: AppSpec = {
  applicationId: 'fixtureapp', displayName: 'FixturePortal', baseUrl: 'https://portal.fixture.invalid/',
  workbooks: ['excel/fixture-cases.xlsx'], legacyLayout: true,
};
const FIXTUREEXTRA: AppSpec = {
  applicationId: SECOND_APP, displayName: 'Demo App', baseUrl: 'https://demo.invalid/',
  workbooks: [`excel/${SECOND_APP}-test-cases.xlsx`],
};

function registryDocument(apps: AppSpec[]): unknown {
  return {
    schemaVersion: 1,
    applications: apps.map(app => ({
      applicationId: app.applicationId,
      displayName: app.displayName,
      defaultEnvironmentId: 'qa',
      environments: { qa: { baseUrl: app.baseUrl } },
      workbooks: app.workbooks,
      ...(app.legacyLayout ? { legacyLayout: true } : {}),
    })),
  };
}

/** Point the process at a temp registry. Never writes the repository's own. */
function useRegistry(apps: AppSpec[], name: string): void {
  const file = path.join(TEMP_DIR, `${name}.json`);
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(registryDocument(apps), null, 2)}\n`, 'utf8');
  process.env.AURA_REGISTRY_FILE = path.relative(ROOT, file);
  resetActiveScope();
  resetActiveApplication();
}

function restoreRegistry(): void {
  delete process.env.AURA_REGISTRY_FILE;
  delete process.env.AURA_APPLICATION;
  resetActiveScope();
  resetActiveApplication();
}

/* ================================================================= A ==========
   1-7: every FixturePortal artefact class still resolves once a second app exists.    */

function partA(): void {
  section('A - FixturePortal survives a second application (requirements 1-7)');

  useRegistry([FIXTUREAPP], 'one');
  const before = resolveScope({ applicationId: 'fixtureapp' });
  const beforePaths = Object.fromEntries(
    Object.entries(before.paths).map(([k, v]) => [k, norm(v)]));

  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');
  const after = resolveScope({ applicationId: 'fixtureapp' });

  check('A1: a second application is genuinely registered', after.soleApplication === false);
  check('A1: FixturePortal still owns the flat layout', after.flatLayout === true);

  // Requirement 1 in the form that actually matters: not "a path came back" but
  // "the same path came back, and the artefacts are still there".
  for (const [artefact, wasPath] of Object.entries(beforePaths)) {
    const nowPath = norm(after.paths[artefact as keyof typeof after.paths]);
    check(`A2: ${artefact} resolves to the same location`, nowPath === wasPath,
        nowPath === wasPath ? nowPath : `${wasPath} -> ${nowPath}`);
    check(`A3: ${artefact} still exists on disk`,
        fs.existsSync(after.paths[artefact as keyof typeof after.paths]), nowPath);
  }

  // Requirements 2-6, stated as the artefact COUNTS a run would actually find, so a
  // path that resolves to an empty directory cannot pass.
  const pages = fs.readdirSync(after.paths.pagesDir).filter(f => f.endsWith('.ts'));
  check('A4: FixturePortal Page Objects resolve (requirement 2)', pages.length >= 7, `${pages.length} files`);
  const knowledge = fs.readdirSync(after.paths.knowledgePageDir).filter(f => /\.ya?ml$/i.test(f));
  check('A5: FixturePortal knowledge resolves (requirement 3)', knowledge.length >= 3, `${knowledge.length} files`);
  const generated = fs.readdirSync(after.paths.generatedDir).filter(f => f.endsWith('.spec.ts'));
  check('A6: FixturePortal generated specs resolve (requirement 4)', generated.length === 1, `${generated.length} specs`);
  check('A7: FixturePortal mapping resolves (requirement 5)',
      fs.existsSync(after.paths.mappingFile)
      && Object.keys(JSON.parse(fs.readFileSync(after.paths.mappingFile, 'utf8'))).length > 0);
  check('A8: FixturePortal fixtures module resolves (requirement 6)',
      fs.existsSync(after.paths.fixturesFile)
      && fs.readFileSync(after.paths.fixturesFile, 'utf8').includes('LoginPage'));

  // Requirement 7 - and note this one was ALREADY scoped, which is the proof that
  // `layoutFor`'s scoped-first check is what makes a per-class migration work.
  check('A9: FixturePortal recordings stay under recordings/fixtureapp (requirement 7)',
      norm(after.paths.recordingsDir) === 'ai/dashboard/recordings/fixtureapp',
      norm(after.paths.recordingsDir));
  const recordings = fs.readdirSync(after.paths.recordingsDir);
  check('A10: the recording store is populated', recordings.length > 0, `${recordings.length} entries`);

  restoreRegistry();
}

/* ================================================================= B ==========
   8-9: the new application gets its own destinations and cannot see FixturePortal's.  */

function partB(): void {
  section('B - the new application is scoped and blind (requirements 8-9)');
  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');

  const demo = resolveScope({ applicationId: SECOND_APP });
  const bug = resolveScope({ applicationId: 'fixtureapp' });

  check('B1: the new application does NOT get the flat layout', demo.flatLayout === false);

  const expected: Record<string, string> = {
    pagesDir: `tests-e2e/pages/${SECOND_APP}`,
    knowledgePageDir: `ai/knowledge/page/${SECOND_APP}`,
    recordingsDir: `ai/dashboard/recordings/${SECOND_APP}`,
    generatedDir: `tests-e2e/generated/${SECOND_APP}`,
    mappingFile: `ai/test-mapping/${SECOND_APP}.mapping.json`,
    fixturesFile: `tests-e2e/${SECOND_APP}.fixtures.ts`,
  };
  for (const [artefact, want] of Object.entries(expected)) {
    const got = norm(demo.paths[artefact as keyof typeof demo.paths]);
    check(`B2: ${artefact} is scoped to the new application (requirement 8)`, got === want, got);
  }

  // Requirement 9. Not "the paths differ" - "no artefact directory is shared", which is
  // the property that makes a miss a MISS rather than a look in someone else's tree.
  for (const artefact of Object.keys(expected)) {
    const key = artefact as keyof typeof demo.paths;
    check(`B3: ${artefact} does not resolve to FixturePortal's (requirement 9)`,
        norm(demo.paths[key]) !== norm(bug.paths[key]));
  }
  // And the sharper form: none of the new application's paths EXISTS yet, so a lookup
  // finds nothing rather than finding FixturePortal's copy.
  const leaked = Object.entries(demo.paths)
      .filter(([, p]) => fs.existsSync(p))
      .map(([k]) => k);
  check('B4: nothing of the new application exists yet, so nothing can be borrowed',
      leaked.length === 0, leaked.join(', ') || 'none');

  restoreRegistry();
}

/* ================================================================= C ==========
   10-12: the three collisions that must stay LEGAL.                              */

function partC(): void {
  section('C - shared names across applications stay legal (requirements 10-12)');
  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');

  const demo = resolveScope({ applicationId: SECOND_APP });
  const bug = resolveScope({ applicationId: 'fixtureapp' });

  // 10. Same Page Object class name. The class name is not the namespace - the
  //     DIRECTORY is - so `LoginPage` in both is two files that cannot overwrite
  //     each other.
  const bugLogin = path.join(bug.paths.pagesDir, 'login.page.ts');
  const demoLogin = path.join(demo.paths.pagesDir, 'login.page.ts');
  check('C1: LoginPage in both applications is two distinct files (requirement 10)',
      norm(bugLogin) !== norm(demoLogin), `${norm(bugLogin)} vs ${norm(demoLogin)}`);
  check('C1b: and the real FixturePortal one is the one that exists', fs.existsSync(bugLogin));

  // And the fixtures MODULE is separate too, which is the half that actually bites:
  // the fixture NAME is derived from the class name, so one shared fixtures file would
  // silently give every spec the first application's class.
  check('C2: each application has its own fixtures module (requirement 10)',
      norm(bug.paths.fixturesFile) !== norm(demo.paths.fixturesFile));

  // 11. Same locator. A locator is a string inside an application's own Page Object;
  //     nothing keys on it, so `#username` in both is two unrelated facts. Asserted as
  //     the property that makes it true: the files that would hold it are disjoint.
  check('C3: #username can exist in both applications (requirement 11)',
      !norm(demoLogin).startsWith(`${norm(bug.paths.pagesDir)}/`)
      || norm(bug.paths.pagesDir) !== norm(demo.paths.pagesDir));

  // 12. Same Test Case ID. The mapping is keyed by BARE id, so this is only legal
  //     because the FILE is per application.
  check('C4: TC_LOGIN_001 maps in two separate files (requirement 12)',
      norm(bug.paths.mappingFile) !== norm(demo.paths.mappingFile),
      `${norm(bug.paths.mappingFile)} vs ${norm(demo.paths.mappingFile)}`);
  check('C5: and their generated specs cannot overwrite each other (requirement 12)',
      norm(path.join(bug.paths.generatedDir, 'TC_LOGIN_001.spec.ts'))
      !== norm(path.join(demo.paths.generatedDir, 'TC_LOGIN_001.spec.ts')));
  check('C6: nor their recordings (requirement 12)',
      norm(path.join(bug.paths.recordingsDir, 'TC_LOGIN_001.spec.ts'))
      !== norm(path.join(demo.paths.recordingsDir, 'TC_LOGIN_001.spec.ts')));

  restoreRegistry();
}

/* ================================================================= D ==========
   13-14: a captured scope is immutable, and a refused registration changes nothing. */

function partD(): void {
  section('D - captured scope and failed provisioning (requirements 13-14)');
  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');

  // 13. A recording captures its scope once. Changing the AMBIENT selection afterwards
  //     must not retarget it - `persistRecording` resolves the store from the
  //     recording's OWN origin, so this asserts the property that makes that work.
  const captured = resolveScope({ applicationId: 'fixtureapp' });
  const capturedDir = norm(captured.paths.recordingsDir);
  process.env.AURA_APPLICATION = SECOND_APP;
  resetActiveScope();
  resetActiveApplication();
  // `activeScope()`, not `resolveScope({})`: the env var is the SELECTION mechanism and
  // only the memoised accessor reads it. `resolveScope({})` with two applications and no
  // id is a ScopeError by design, which is itself the point - ambient state cannot
  // silently answer "which application" for anybody.
  const ambient = activeScope();
  check('D1: the ambient selection really did move', ambient.applicationId === SECOND_APP);
  check('D2: the captured scope is unchanged (requirement 13)',
      norm(captured.paths.recordingsDir) === capturedDir, capturedDir);
  // Re-resolving the captured application by ID still gives the same store, so a
  // recording persisted by origin lands where it was captured.
  check('D3: resolving by the captured id gives the same store (requirement 13)',
      norm(resolveScope({ applicationId: 'fixtureapp' }).paths.recordingsDir) === capturedDir);
  delete process.env.AURA_APPLICATION;
  resetActiveScope();
  resetActiveApplication();

  // 14. A refused registration must leave the first application untouched. Every one of
  //     these is refused by `validateRegistry`, which is the SAME function every read
  //     goes through - so a candidate that fails cannot reach disk.
  const before = JSON.stringify(registryDocument([FIXTUREAPP, FIXTUREEXTRA]));
  const refusals: Array<[string, AppSpec[]]> = [
    ['a duplicate applicationId', [FIXTUREAPP, FIXTUREEXTRA, { ...FIXTUREEXTRA, workbooks: [] }]],
    ['a reserved applicationId', [FIXTUREAPP, { ...FIXTUREEXTRA, applicationId: 'pages' }]],
    ['an invalid applicationId', [FIXTUREAPP, { ...FIXTUREEXTRA, applicationId: 'Demo App' }]],
    ['a workbook another application owns',
      [FIXTUREAPP, { ...FIXTUREEXTRA, workbooks: ['excel/fixture-cases.xlsx'] }]],
    ['a second legacyLayout owner', [FIXTUREAPP, { ...FIXTUREEXTRA, legacyLayout: true }]],
    ['a base URL with no scheme', [FIXTUREAPP, { ...FIXTUREEXTRA, baseUrl: 'demo.invalid' }]],
  ];
  for (const [why, apps] of refusals) {
    let refused = false;
    try {
      validateRegistry(registryDocument(apps), 'fixture');
    } catch {
      refused = true;
    }
    check(`D4: ${why} is refused (requirement 14)`, refused);
  }
  check('D5: the candidate document was never mutated by validation (requirement 14)',
      JSON.stringify(registryDocument([FIXTUREAPP, FIXTUREEXTRA])) === before);

  // The registry on disk is still the two-application one the refusals were tried
  // against: nothing partially applied.
  const onDisk = readRegistry();
  check('D6: the registry still holds exactly the two valid applications (requirement 14)',
      onDisk.applications.length === 2
      && onDisk.applications.map(a => a.applicationId).join(',') === `fixtureapp,${SECOND_APP}`);

  restoreRegistry();
}

/* ================================================================= E ==========
   The recursive walkers must not enter a foreign namespace.                      */

function partE(): void {
  section('E - a scan of the flat tree stops at a foreign namespace');
  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');

  // A synthetic replica of the shape the flat layout creates: the first application's
  // specs at the root, the second application's scoped directory INSIDE it.
  const isolated = enterIsolatedArtefactRoot('provisioning-scan');
  const tree = path.join(isolated, 'tests-e2e/generated');
  try {
  fs.mkdirSync(path.join(tree, SECOND_APP), { recursive: true });
  fs.mkdirSync(path.join(tree, 'sub'), { recursive: true });
  const spec = (id: string) => `test('${id} - a scenario', async () => {});\n`;
  fs.writeFileSync(path.join(tree, 'TC_LOGIN_001.spec.ts'), spec('TC_LOGIN_001'), 'utf8');
  fs.writeFileSync(path.join(tree, 'sub', 'TC_LOGIN_002.spec.ts'), spec('TC_LOGIN_002'), 'utf8');
  // Same ID as the first application's, which is exactly what must stay legal.
  fs.writeFileSync(path.join(tree, SECOND_APP, 'TC_LOGIN_001.spec.ts'), spec('TC_LOGIN_001'), 'utf8');
  fs.writeFileSync(path.join(tree, SECOND_APP, 'runner.spec.ts'),
      '/** @data-driven-module: Checkout */\n', 'utf8');

  const found = scanSpecs(tree).map(entry => entry.testFile);
  check('E1: the flat owner\'s own spec is found', found.some(f => f.endsWith('generated/TC_LOGIN_001.spec.ts')));
  check('E2: an undeclared child namespace is not inherited', !found.some(f => f.endsWith('sub/TC_LOGIN_002.spec.ts')));
  check('E3: the foreign namespace is NOT entered',
      !found.some(f => f.includes(`/${SECOND_APP}/`)), found.join(' | '));
  check('E4: so the shared ID is claimed exactly once', found.length === 1, `${found.length} entries`);

  const runners = scanDataDrivenRunners(tree);
  check('E5: a foreign data-driven runner is not claimed either',
      !runners.some(r => r.testFile.includes(`/${SECOND_APP}/`)),
      runners.map(r => r.module).join(',') || 'none');

  check('E6: the exclusion comes from the registry, not a guess',
      registeredApplicationIds().includes(SECOND_APP));

  // Deregistration changes selection, never ownership of remaining directories.
  useRegistry([FIXTUREAPP], 'one');
  const all = scanSpecs(tree).map(entry => entry.testFile);
  check('E7: deregistration does not expose the former application namespace',
      !all.some(f => f.includes(`/${SECOND_APP}/`)), `${all.length} entries`);
  } finally { leaveIsolatedArtefactRoot(); }

  restoreRegistry();
}

/* ================================================================= F ==========
   Playwright collection is narrowed before `--grep` is applied.                  */

async function partF(): Promise<void> {
  section('F - collection is scoped, so a shared TC ID cannot run twice');

  const module_ = await import('../../tests-e2e/support/collection-scope');
  const { collectionIgnoreFor } = module_;

  restoreRegistry();
  check('F1: unselected aggregate tooling ignores nothing', collectionIgnoreFor().length === 0);

  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');

  process.env.AURA_APPLICATION = 'fixtureapp';
  resetActiveScope();
  const flat = collectionIgnoreFor();
  check('F2: the flat owner ignores the other application\'s generated directory',
      flat.some(p => p.startsWith(`tests-e2e/generated/${SECOND_APP}`)), flat.join(' | '));
  check('F3: and ignores nothing of its own',
      !flat.some(p => p === 'tests-e2e/login/**' || p === 'tests-e2e/generated/**'),
      `${flat.length} path ignored`);

  process.env.AURA_APPLICATION = SECOND_APP;
  resetActiveScope();
  const scoped = collectionIgnoreFor();
  check('F4: the scoped application ignores the flat owner\'s hand-written suites',
      scoped.includes('tests-e2e/synthetic-manual/**'),
      `${scoped.length} paths ignored`);
  check('F5: and the flat owner\'s generated specs',
      scoped.some(p => p.startsWith('tests-e2e/generated/') && !p.includes(SECOND_APP)),
      `${scoped.filter(p => p.startsWith('tests-e2e/generated/')).length} flat specs ignored`);
  check('F6: but NOT its own generated directory',
      !scoped.some(p => p === `tests-e2e/generated/${SECOND_APP}/**`));
  check('F7: and not the shared wildcard runner',
      !scoped.some(p => p.startsWith('tests-e2e/generic')));

  delete process.env.AURA_APPLICATION;
  restoreRegistry();
}

/* ================================================================= G ==========
   A generated spec imports the fixtures module of ITS OWN application.           */

async function partG(): Promise<void> {
  section('G - the generated fixtures import follows the layout');

  const { assembleSpec } = await import('../autocode/from-recording');
  check('G1: assembleSpec is reachable', typeof assembleSpec === 'function');

  // The specifier is derived from the two resolved paths, so it is checked the same
  // way: compute what the layout implies and compare with what the layout gives.
  const specifierFor = (applicationId: string): string => {
    const scope = resolveScope({ applicationId });
    const value = path.relative(scope.paths.generatedDir, scope.paths.fixturesFile)
        .split(path.sep).join('/').replace(/\.ts$/, '');
    return value.startsWith('.') ? value : `./${value}`;
  };

  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');
  check('G2: the flat owner still imports ../fixtures (unchanged, byte for byte)',
      specifierFor('fixtureapp') === '../fixtures', specifierFor('fixtureapp'));
  check('G3: a scoped application imports its own module one level deeper',
      specifierFor(SECOND_APP) === `../../${SECOND_APP}.fixtures`, specifierFor(SECOND_APP));
  check('G4: the two specifiers are different, so neither can reach the other',
      specifierFor('fixtureapp') !== specifierFor(SECOND_APP));

  restoreRegistry();
}

/* ================================================================= I ==========
   Provisioning is one transaction: a workbook and a registry entry, or neither.   */

async function partI(): Promise<void> {
  section('I - project provisioning is transactional');

  const {
    provisionProject, ProvisionError, unownedWorkbooks, workbookPathFor, workbooksFor,
  } = await import('./provision');
  const { parseWorkbook } = await import('../excel/parser');

  // Provisioning WRITES. Everything it writes goes to a temp `excel/` and a temp
  // registry, so the real workbook directory is never touched by this fixture.
  const excelDir = path.join(TEMP_DIR, 'excel');
  fs.mkdirSync(excelDir, { recursive: true });
  process.env.AURA_EXCEL_DIR = path.relative(ROOT, excelDir);
  useRegistry([FIXTUREAPP], 'provision-start');

  // ---- the happy path -------------------------------------------------------
  const created = await provisionProject({
    applicationId: SECOND_APP,
    displayName: 'Demo App',
    environmentId: 'qa',
    baseUrl: 'https://demo.invalid/',
  });
  check('I1: the project is created', created.applicationId === SECOND_APP);
  check('I2: with exactly one workbook', created.workbook === workbookPathFor(SECOND_APP),
      created.workbook);
  const workbookAbsolute = path.resolve(ROOT, created.workbook);
  check('I3: and the workbook is really on disk', fs.existsSync(workbookAbsolute));
  check('I4: the registry now holds two applications', created.registry.applications.length === 2);

  // ---- it is a workbook the EXISTING parser can read ------------------------
  const parsed = await parseWorkbook(workbookAbsolute);
  check('I5: the real parser reads it', parsed.testCases.length === 1, `${parsed.testCases.length} row(s)`);
  const row = parsed.testCases[0];
  check('I6: with the canonical fields bound, not left unmapped',
      Boolean(row?.testCaseId && row?.module && row?.scenario && row?.expectedResult),
      `${row?.testCaseId} / ${row?.module} / ${row?.scenario?.slice(0, 24)}`);
  check('I7: Module is a COLUMN, not a worksheet per module',
      parsed.worksheets.length === 1 && Boolean(row?.module),
      `${parsed.worksheets.length} sheet(s), module="${row?.module}"`);
  check('I8: the starter row is not accidentally armed to run',
      row?.execute === false, String(row?.execute));

  // ---- ownership is DECLARED, and it is what gates selection ----------------
  const mine = workbooksFor(SECOND_APP);
  const theirs = workbooksFor('fixtureapp');
  check('I9: the new project owns its workbook', mine.includes(created.workbook), mine.join(','));
  check('I10: and FixturePortal does not', !theirs.includes(created.workbook), theirs.join(',') || 'none');
  check('I11: nor can the new project see the first one\'s',
      !mine.includes('excel/fixture-cases.xlsx'), mine.join(','));

  // An undeclared file is REPORTED, never assigned to whoever is selected.
  fs.writeFileSync(path.join(excelDir, 'dropped-in-by-hand.xlsx'), 'not really a workbook', 'utf8');
  const unowned = unownedWorkbooks();
  check('I12: an undeclared workbook is reported as unowned',
      unowned.some(w => w.endsWith('dropped-in-by-hand.xlsx')), unowned.join(','));
  check('I13: and is offered to NOBODY',
      !workbooksFor(SECOND_APP).some(w => w.endsWith('dropped-in-by-hand.xlsx'))
      && !workbooksFor('fixtureapp').some(w => w.endsWith('dropped-in-by-hand.xlsx')));

  // ---- an existing workbook is never overwritten ----------------------------
  let refusedOverwrite = false;
  try {
    await provisionProject({
      applicationId: SECOND_APP, displayName: 'Demo App Again',
      environmentId: 'qa', baseUrl: 'https://demo.invalid/',
    });
  } catch (error) {
    refusedOverwrite = error instanceof ProvisionError || error instanceof Error;
  }
  check('I14: re-provisioning does not overwrite the workbook', refusedOverwrite);
  check('I15: and the original workbook is intact',
      fs.existsSync(workbookAbsolute)
      && fs.readFileSync(workbookAbsolute).length > 0);

  // ---- THE ROLLBACK ---------------------------------------------------------
  //
  // The registry write is made to fail deterministically by putting a DIRECTORY where
  // `addApplication` writes its temp file. `fs.writeFileSync` answers EISDIR on every
  // platform, so this does not depend on file permissions behaving the same way on
  // Windows and Linux. It fails at step 3, which is exactly the step whose failure has
  // to leave no workbook behind.
  const registryPath = path.resolve(ROOT, process.env.AURA_REGISTRY_FILE as string);
  const registryBefore = fs.readFileSync(registryPath, 'utf8');
  const blocker = `${registryPath}.tmp`;
  fs.mkdirSync(blocker, { recursive: true });
  const doomedId = 'thirdapp';
  const doomedWorkbook = path.resolve(ROOT, workbookPathFor(doomedId));
  let rolledBack = false;
  let message = '';
  try {
    await provisionProject({
      applicationId: doomedId, displayName: 'Third App',
      environmentId: 'qa', baseUrl: 'https://third.invalid/',
    });
  } catch (error) {
    rolledBack = true;
    message = (error as Error).message;
  }
  fs.rmSync(blocker, { recursive: true, force: true });

  check('I16: a failed registry write is reported, not swallowed', rolledBack, message.slice(0, 60));
  check('I17: the workbook it created was removed (requirement 14)',
      !fs.existsSync(doomedWorkbook), norm(doomedWorkbook));
  check('I18: the registry is byte-identical (requirement 14)',
      fs.readFileSync(registryPath, 'utf8') === registryBefore);
  const after = readRegistry();
  check('I19: no partially provisioned project is registered (requirement 14)',
      !after.applications.some(a => a.applicationId === doomedId)
      && after.applications.length === 2,
      after.applications.map(a => a.applicationId).join(','));

  // And the FIRST project is exactly as it was throughout.
  const bug = after.applications.find(a => a.applicationId === 'fixtureapp');
  check('I20: FixturePortal is untouched by all of it (requirement 14)',
      bug?.legacyLayout === true
      && (bug?.workbooks ?? []).join(',') === 'excel/fixture-cases.xlsx',
      JSON.stringify(bug?.workbooks));

  delete process.env.AURA_EXCEL_DIR;
  restoreRegistry();
}

/* ================================================================= J ==========
   The ambient default: a pre-scope caller still has an answer.                   */

function partJ(): void {
  section('J - an unscoped AMBIENT caller resolves to the flat-layout owner');
  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');
  delete process.env.AURA_APPLICATION;
  resetActiveScope();

  // Every CLI here and roughly sixty offline fixtures predate the scope layer and have
  // no scope to be threaded. Without this they resolved nothing the moment a second
  // project existed - not because an artefact moved, but because the accessor lost the
  // right to answer. Measured: 60 of 64 fixtures red in one step.
  const ambient = activeScope();
  check('J1: activeScope() answers with the flat-layout owner',
      ambient.applicationId === 'fixtureapp', ambient.applicationId);
  check('J2: and its paths are the unscoped ones the caller was written against',
      norm(ambient.paths.pagesDir) === 'tests-e2e/pages', norm(ambient.paths.pagesDir));

  // The distinction that keeps this from being a cross-application fallback: an
  // EXPLICIT request naming nothing is still refused, so the dashboard - whose every
  // request path goes through `resolveScope` - keeps demanding a choice.
  let refused = false;
  try {
    resolveScope({});
  } catch (error) {
    refused = error instanceof ScopeError;
  }
  check('J3: an explicit unscoped resolveScope({}) is STILL refused', refused);

  // And an explicit selection always wins over the default.
  process.env.AURA_APPLICATION = SECOND_APP;
  resetActiveScope();
  check('J4: AURA_APPLICATION overrides the default',
      activeScope().applicationId === SECOND_APP);
  delete process.env.AURA_APPLICATION;
  resetActiveScope();

  // With NO declared owner there is no unscoped world left, so the ambient question has
  // no answer again - which is the correct end state after migration.
  useRegistry([{ ...FIXTUREAPP, legacyLayout: false }, FIXTUREEXTRA], 'two-migrated');
  let refusedAfterMigration = false;
  try {
    activeScope();
  } catch (error) {
    refusedAfterMigration = error instanceof ScopeError;
  }
  check('J5: once the flag is dropped, an ambient caller is refused again',
      refusedAfterMigration);

  restoreRegistry();
}

/* ================================================================= K ==========
   The shared data-driven runner resolves its workbook from the REGISTRY.          */

async function partK(): Promise<void> {
  section('K - the data-driven runner cannot inherit a workbook it does not own');

  const { resolveSuiteWorkbook } = await import('../../tests-e2e/support/data-driven');

  const BUG_WB = 'excel/fixture-cases.xlsx';
  const DEMO_WB = `excel/${SECOND_APP}-test-cases.xlsx`;

  /** Resolve under an explicit selection, returning the repo-relative workbook or the refusal. */
  const resolve = (applicationId: string | null, workbook: string | null):
      { workbook: string | null; error: string | null } => {
    if (applicationId) process.env.AURA_APPLICATION = applicationId;
    else delete process.env.AURA_APPLICATION;
    if (workbook) process.env.EXCEL_WORKBOOK = workbook;
    else delete process.env.EXCEL_WORKBOOK;
    resetActiveScope();
    try {
      const answer = resolveSuiteWorkbook();
      return { workbook: answer.workbook ? norm(answer.workbook) : null, error: null };
    } catch (error) {
      return { workbook: null, error: (error as Error).message };
    } finally {
      delete process.env.AURA_APPLICATION;
      delete process.env.EXCEL_WORKBOOK;
      resetActiveScope();
    }
  };

  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');

  // 1-2: an explicit workbook that the active application owns is used as given.
  check('K1: fixtureapp + its own workbook succeeds',
      resolve('fixtureapp', BUG_WB).workbook === BUG_WB, String(resolve('fixtureapp', BUG_WB).workbook));
  check('K2: fixtureextra + its own workbook succeeds',
      resolve(SECOND_APP, DEMO_WB).workbook === DEMO_WB, String(resolve(SECOND_APP, DEMO_WB).workbook));

  // 3-4, AND THE DEFECT ITSELF: with no EXCEL_WORKBOOK the workbook comes from the
  // registry, so the answer follows the application instead of a hardcoded filename.
  const demoImplicit = resolve(SECOND_APP, null);
  check('K3: fixtureextra with EXCEL_WORKBOOK unset uses the workbook FIXTUREEXTRA declares',
      demoImplicit.workbook === DEMO_WB, String(demoImplicit.workbook));
  check('K10: ...and never the FixturePortal one (this was the measured defect)',
      demoImplicit.workbook !== BUG_WB);
  check('K4: fixtureapp with EXCEL_WORKBOOK unset uses its own declared workbook',
      resolve('fixtureapp', null).workbook === BUG_WB, String(resolve('fixtureapp', null).workbook));

  // 5-6: a cross-project explicit selection is refused in BOTH directions.
  const cross1 = resolve(SECOND_APP, BUG_WB);
  check('K5: fixtureextra + the FixturePortal workbook is REFUSED',
      cross1.workbook === null && /belongs to exactly one application/.test(cross1.error ?? ''),
      (cross1.error ?? 'not refused').slice(0, 60));
  const cross2 = resolve('fixtureapp', DEMO_WB);
  check('K6: fixtureapp + the fixtureextra workbook is REFUSED',
      cross2.workbook === null && /belongs to exactly one application/.test(cross2.error ?? ''),
      (cross2.error ?? 'not refused').slice(0, 60));

  // 7: no declared workbook - FAIL CLOSED, and specifically not with somebody else's.
  useRegistry([FIXTUREAPP, { ...FIXTUREEXTRA, workbooks: [] }], 'two-no-wb');
  const none = resolve(SECOND_APP, null);
  check('K7: an application with NO declared workbook resolves to nothing',
      none.workbook === null && none.error === null, String(none.workbook));
  check('K7b: and specifically not to the other application workbook',
      none.workbook !== BUG_WB);

  // 8: several declared workbooks - refused, naming them, never an arbitrary pick.
  useRegistry([FIXTUREAPP, { ...FIXTUREEXTRA, workbooks: [DEMO_WB, 'excel/fixtureextra-second.xlsx'] }], 'two-multi');
  const many = resolve(SECOND_APP, null);
  check('K8: several declared workbooks is REFUSED, not silently narrowed',
      many.workbook === null && /declares 2 workbooks/.test(many.error ?? ''),
      (many.error ?? 'not refused').slice(0, 64));
  check('K8b: and naming one explicitly still works',
      resolve(SECOND_APP, DEMO_WB).workbook === DEMO_WB);

  // 9: the same Test Case ID in both applications stays isolated, because the CACHE is
  //    keyed by the workbook PATH (the Phase 5 fix) and the workbooks are different files.
  useRegistry([FIXTUREAPP, FIXTUREEXTRA], 'two');
  const { cachePathFor } = await import('../excel/data-driven');
  const bugCache = norm(cachePathFor(path.resolve(ROOT, BUG_WB)));
  const demoCache = norm(cachePathFor(path.resolve(ROOT, DEMO_WB)));
  check('K9: TC_LOGIN_001 in both applications reads two different caches',
      bugCache !== demoCache, `${bugCache} vs ${demoCache}`);

  // 11: nobody selected AND no application entitled to the unscoped layout - there is no
  //     honest answer, so there are no rows rather than the legacy application's.
  useRegistry([{ ...FIXTUREAPP, legacyLayout: false }, FIXTUREEXTRA], 'two-migrated');
  const unselected = resolve(null, null);
  check('K11: no application selectable -> no workbook, and no fallback',
      unselected.workbook === null, String(unselected.workbook));
  const unselectedExplicit = resolve(null, BUG_WB);
  check('K11b: ...and an explicit workbook with no application is refused',
      unselectedExplicit.workbook === null && Boolean(unselectedExplicit.error),
      (unselectedExplicit.error ?? 'not refused').slice(0, 56));

  restoreRegistry();
}

/* ================================================================= L ==========
   Runtime environment resolution is application-scoped and fails closed.         */

async function partL(): Promise<void> {
  section('L - base URL and credentials come from the registry, never from FixturePortal');

  const env = await import('../../tests-e2e/support/env');

  /** Resolve base URL + credential source under one explicit selection. */
  const under = (applicationId: string | null): {
    baseUrl: string | null; error: string | null;
    source: { email: string; password: string } | null; resolved: boolean; reason: string;
  } => {
    if (applicationId) process.env.AURA_APPLICATION = applicationId;
    else delete process.env.AURA_APPLICATION;
    resetActiveScope();
    let baseUrl: string | null = null;
    let error: string | null = null;
    try {
      baseUrl = env.resolveBaseUrl();
    } catch (caught) {
      error = (caught as Error).message;
    }
    const source = env.credentialSource();
    const answer = {
      baseUrl, error, source,
      resolved: Boolean(env.credentials()),
      reason: env.missingCredentialsReason(),
    };
    delete process.env.AURA_APPLICATION;
    resetActiveScope();
    return answer;
  };

  // The registry the rest of this part runs against. FixturePortal declares an env override
  // and credential variable names; fixtureextra declares neither, which is the whole point.
  const BUG_ENV = {
    qa: {
      baseUrl: 'https://portal.fixture.invalid/',
      baseUrlEnv: 'FIXTUREAPP_BASE_URL',
      credentials: { email: 'AURA_FIXTURE_EMAIL', password: 'AURA_FIXTURE_PASSWORD' },
    },
  };
  const registryWith = (extra: Record<string, unknown>[] = []): void => {
    const file = path.join(TEMP_DIR, 'env-scoping.json');
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({
      schemaVersion: 1,
      applications: [
        { applicationId: 'fixtureapp', displayName: 'FixturePortal', defaultEnvironmentId: 'qa',
          environments: BUG_ENV, workbooks: ['excel/fixture-cases.xlsx'], legacyLayout: true },
        { applicationId: SECOND_APP, displayName: 'Demo App', defaultEnvironmentId: 'qa',
          environments: { qa: { baseUrl: 'https://demo.invalid/' } },
          workbooks: [`excel/${SECOND_APP}-test-cases.xlsx`] },
        ...extra,
      ],
    }, null, 2)}\n`, 'utf8');
    process.env.AURA_REGISTRY_FILE = path.relative(ROOT, file);
    resetActiveScope();
    resetActiveApplication();
  };

  // The fixture supplies its OWN credential variables so nothing here depends on a real
  // .env and no real secret is ever read. Values are placeholders, never printed.
  process.env.AURA_FIXTURE_EMAIL = 'fixture-user@example.invalid';
  process.env.AURA_FIXTURE_PASSWORD = 'fixture-placeholder';
  process.env.FIXTUREAPP_BASE_URL = 'https://redirected.fixtureapp.invalid/';

  registryWith();

  // ---- A, B: the legacy application is unchanged --------------------------------
  const bug = under('fixtureapp');
  check('L-A: fixtureapp resolves its own base URL, with its declared env override applied',
      bug.baseUrl === 'https://redirected.fixtureapp.invalid/', String(bug.baseUrl));
  check('L-B: fixtureapp resolves its own declared credentials',
      bug.resolved && bug.source?.email === 'AURA_FIXTURE_EMAIL',
      bug.source ? `${bug.source.email} / ${bug.source.password}` : 'none');

  // ---- C, D: the second application follows the registry, not the FixturePortal vars ---
  const demo = under(SECOND_APP);
  check('L-C: fixtureextra resolves the base URL its registry declares',
      demo.baseUrl === 'https://demo.invalid/', String(demo.baseUrl));
  check('L-C2: and specifically NOT the FixturePortal address',
      demo.baseUrl !== 'https://portal.fixture.invalid/');
  check('L-D: FIXTUREAPP_BASE_URL is set, and fixtureextra is unaffected by it',
      Boolean(process.env.FIXTUREAPP_BASE_URL) && demo.baseUrl !== process.env.FIXTUREAPP_BASE_URL,
      `override=${process.env.FIXTUREAPP_BASE_URL} fixtureextra=${demo.baseUrl}`);

  // ---- E, G: declared-nothing means resolved-nothing, not borrowed ---------------
  check('L-E: the FixturePortal credential variables are set in this process',
      Boolean(process.env.AURA_FIXTURE_EMAIL) && Boolean(process.env.AURA_FIXTURE_PASSWORD));
  check('L-E2: fixtureextra still resolves NO credentials from them',
      !demo.resolved && demo.source === null, demo.source ? 'borrowed' : 'none');
  check('L-G: and the skip reason names the application, not a FixturePortal variable',
      /declares no credentials/.test(demo.reason) && !/FIXTUREAPP/.test(demo.reason),
      demo.reason.slice(0, 60));

  // ---- H: declared but absent from the environment -------------------------------
  registryWith([{
    applicationId: 'thirdapp', displayName: 'Third', defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://third.invalid/',
      credentials: { email: 'AURA_ABSENT_EMAIL', password: 'AURA_ABSENT_PASSWORD' } } },
    workbooks: [],
  }]);
  const third = under('thirdapp');
  check('L-H: declared credential variables that are unset resolve to nothing',
      !third.resolved && third.source?.email === 'AURA_ABSENT_EMAIL');
  check('L-H2: and the reason names the MISSING variables so they can be set',
      /AURA_ABSENT_EMAIL/.test(third.reason) && /AURA_ABSENT_PASSWORD/.test(third.reason),
      third.reason.slice(0, 62));
  check('L-H3: a third application still gets its own base URL',
      third.baseUrl === 'https://third.invalid/', String(third.baseUrl));

  // ---- F: an environment with no baseUrl cannot exist at all ---------------------
  let refusedNoBaseUrl = false;
  try {
    validateRegistry({ schemaVersion: 1, applications: [{ applicationId: 'x', displayName: 'X',
      defaultEnvironmentId: 'qa', environments: { qa: { baseUrl: '' } }, workbooks: [] }] }, 'probe');
  } catch {
    refusedNoBaseUrl = true;
  }
  check('L-F: an environment with no baseUrl is refused by validateRegistry', refusedNoBaseUrl);

  // ---- ambiguity fails closed rather than choosing --------------------------------
  registryWith();
  const file = path.join(TEMP_DIR, 'no-legacy.json');
  fs.writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    applications: [
      { applicationId: 'fixtureapp', displayName: 'FixturePortal', defaultEnvironmentId: 'qa',
        environments: BUG_ENV, workbooks: ['excel/fixture-cases.xlsx'] },
      { applicationId: SECOND_APP, displayName: 'Demo App', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://demo.invalid/' } },
        workbooks: [`excel/${SECOND_APP}-test-cases.xlsx`] },
    ],
  }, null, 2)}\n`, 'utf8');
  process.env.AURA_REGISTRY_FILE = path.relative(ROOT, file);
  const ambiguous = under(null);
  check('L-I: no selectable application -> the base URL is an ERROR, never a default',
      ambiguous.baseUrl === null && Boolean(ambiguous.error), (ambiguous.error ?? '').slice(0, 56));
  check('L-I2: and no credentials are produced either',
      !ambiguous.resolved && ambiguous.source === null);

  delete process.env.AURA_FIXTURE_EMAIL;
  delete process.env.AURA_FIXTURE_PASSWORD;
  delete process.env.FIXTUREAPP_BASE_URL;
  restoreRegistry();
}

/* ================================================================= M ==========
   The GENERATION browser's account is application-scoped too.                    */

async function partM(): Promise<void> {
  section('M - the exploration account cannot cross applications');

  const env = await import('../../tests-e2e/support/env');

  /** Resolve the exploration account under one explicit selection. Names only. */
  const under = (applicationId: string | null): {
    source: { email: string; password: string } | null;
    identity: string; resolved: boolean; reason: string;
  } => {
    if (applicationId) process.env.AURA_APPLICATION = applicationId;
    else delete process.env.AURA_APPLICATION;
    resetActiveScope();
    const answer = {
      source: env.explorationSource(),
      identity: env.explorationIdentity(),
      resolved: Boolean(env.explorationCredentials()),
      reason: env.missingExplorationCredentialsReason(),
    };
    delete process.env.AURA_APPLICATION;
    resetActiveScope();
    return answer;
  };

  // FixturePortal declares credentials; fixtureextra declares none. Both are given an environment
  // in which FIXTUREAPP_* variables ARE set, which is the whole point of the test.
  const file = path.join(TEMP_DIR, 'exploration.json');
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    applications: [
      { applicationId: 'fixtureapp', displayName: 'FixturePortal', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://portal.fixture.invalid/',
          credentials: { email: 'FIXTUREAPP_EMAIL', password: 'FIXTUREAPP_PASSWORD' } } },
        workbooks: ['excel/fixture-cases.xlsx'], legacyLayout: true },
      { applicationId: SECOND_APP, displayName: 'Demo App', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://demo.invalid/' } },
        workbooks: [`excel/${SECOND_APP}-test-cases.xlsx`] },
      { applicationId: 'thirdapp', displayName: 'Third', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://third.invalid/',
          credentials: { email: 'AURA_ABSENT_EMAIL', password: 'AURA_ABSENT_PASSWORD' } } },
        workbooks: [] },
    ],
  }, null, 2)}\n`, 'utf8');
  process.env.AURA_REGISTRY_FILE = path.relative(ROOT, file);
  resetActiveScope();
  resetActiveApplication();

  // Placeholders, never printed. These stand in for a populated .env so the test does not
  // depend on one and reads no real secret.
  const saved = {
    email: process.env.FIXTUREAPP_EMAIL,
    password: process.env.FIXTUREAPP_PASSWORD,
    user: process.env.FIXTUREAPP_EXPLORATION_USER,
    pass: process.env.FIXTUREAPP_EXPLORATION_PASSWORD,
  };
  process.env.FIXTUREAPP_EMAIL = 'fixture-user@example.invalid';
  process.env.FIXTUREAPP_PASSWORD = 'fixture-placeholder';
  delete process.env.FIXTUREAPP_EXPLORATION_USER;
  delete process.env.FIXTUREAPP_EXPLORATION_PASSWORD;

  // ---- FixturePortal resolves its own, through its registry declaration ---------------
  const bug = under('fixtureapp');
  check('M1: fixtureapp exploration resolves its own declared credentials',
      bug.resolved && bug.source?.email === 'FIXTUREAPP_EMAIL', bug.identity);
  check('M2: and reports the VARIABLE name, never an address',
      bug.identity === 'FIXTUREAPP_EMAIL' && !bug.identity.includes('@'), bug.identity);

  // ---- fixtureextra cannot reach any of it --------------------------------------------
  const demo = under(SECOND_APP);
  check('M3: FIXTUREAPP_EMAIL and FIXTUREAPP_PASSWORD are set in this process',
      Boolean(process.env.FIXTUREAPP_EMAIL) && Boolean(process.env.FIXTUREAPP_PASSWORD));
  check('M4: fixtureextra exploration resolves NOTHING from them',
      demo.source === null && !demo.resolved, demo.source ? 'borrowed' : 'none');
  check('M5: and its identity is anonymous, not a FixturePortal variable',
      demo.identity === 'anonymous', demo.identity);
  check('M6: the diagnostic names FIXTUREEXTRA variables, never FIXTUREAPP ones',
      /FIXTUREEXTRA_EXPLORATION_USER/.test(demo.reason) && !/FIXTUREAPP/.test(demo.reason),
      demo.reason.slice(0, 72));

  // ---- an override for one application is invisible to another --------------------
  process.env.FIXTUREAPP_EXPLORATION_USER = 'someone-else@example.invalid';
  process.env.FIXTUREAPP_EXPLORATION_PASSWORD = 'fixture-placeholder';
  const bugOverride = under('fixtureapp');
  const demoWithBugOverride = under(SECOND_APP);
  check('M7: fixtureapp picks up ITS exploration override, exactly as before',
      bugOverride.source?.email === 'FIXTUREAPP_EXPLORATION_USER', String(bugOverride.identity));
  check('M8: fixtureextra is untouched by a FixturePortal override that IS set',
      demoWithBugOverride.source === null && demoWithBugOverride.identity === 'anonymous',
      demoWithBugOverride.identity);
  delete process.env.FIXTUREAPP_EXPLORATION_USER;
  delete process.env.FIXTUREAPP_EXPLORATION_PASSWORD;

  // ---- an application-scoped override works for the other application -------------
  process.env.FIXTUREEXTRA_EXPLORATION_USER = 'demo-explorer@example.invalid';
  process.env.FIXTUREEXTRA_EXPLORATION_PASSWORD = 'fixture-placeholder';
  const demoOwn = under(SECOND_APP);
  check('M9: fixtureextra CAN have an exploration account, under its own variable names',
      demoOwn.resolved && demoOwn.source?.email === 'FIXTUREEXTRA_EXPLORATION_USER', demoOwn.identity);
  const bugUnaffected = under('fixtureapp');
  check('M10: and setting it does not change what fixtureapp resolves',
      bugUnaffected.source?.email === 'FIXTUREAPP_EMAIL', String(bugUnaffected.identity));
  delete process.env.FIXTUREEXTRA_EXPLORATION_USER;
  delete process.env.FIXTUREEXTRA_EXPLORATION_PASSWORD;

  // ---- declared but absent: fail closed, naming the declared variables -------------
  const third = under('thirdapp');
  check('M11: declared-but-unset credentials resolve to nothing',
      !third.resolved && third.source?.email === 'AURA_ABSENT_EMAIL');
  check('M12: and the diagnostic names those declared variables',
      /AURA_ABSENT_EMAIL/.test(third.reason) && /AURA_ABSENT_PASSWORD/.test(third.reason),
      third.reason.slice(0, 76));

  // ---- no application selectable: no account, no guess ----------------------------
  const noLegacy = path.join(TEMP_DIR, 'exploration-no-legacy.json');
  fs.writeFileSync(noLegacy, fs.readFileSync(file, 'utf8').replace('"legacyLayout": true', '"legacyLayout": false'), 'utf8');
  process.env.AURA_REGISTRY_FILE = path.relative(ROOT, noLegacy);
  const unselected = under(null);
  check('M13: no selectable application -> no exploration account at all',
      unselected.source === null && unselected.identity === 'anonymous');
  check('M14: and the diagnostic says so rather than naming somebody variables',
      /no application is selected/i.test(unselected.reason) && !/FIXTUREAPP/.test(unselected.reason),
      unselected.reason.slice(0, 68));

  // ---- the literal fallback is gone from the source -------------------------------
  const envSource = fs.readFileSync(path.join(ROOT, 'tests-e2e', 'support', 'env.ts'), 'utf8');
  const code = envSource.split('\n')
      .filter(line => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join('\n');
  check('M15: no FIXTUREAPP credential literal survives in env.ts CODE',
      !/'FIXTUREAPP_EMAIL'|'FIXTUREAPP_PASSWORD'/.test(code),
      (code.match(/'FIXTUREAPP_[A-Z_]*'/g) ?? []).join(',') || 'none');

  for (const [key, value] of Object.entries(saved)) {
    const name = { email: 'FIXTUREAPP_EMAIL', password: 'FIXTUREAPP_PASSWORD',
      user: 'FIXTUREAPP_EXPLORATION_USER', pass: 'FIXTUREAPP_EXPLORATION_PASSWORD' }[key] as string;
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  restoreRegistry();
}

/* ================================================================= H ==========
   15: the real artefacts are byte-identical.                                     */

function partH(before: { files: number; digest: string }, recordingCountBefore: number): void {
  section('H - the real FixturePortal artefacts are untouched (requirement 15)');
  const after = realArtefactDigest();
  check('H1: the same number of real artefacts', after.files === before.files,
      `${before.files} -> ${after.files}`);
  check('H2: byte-identical (sha256 over path + content)', after.digest === before.digest,
      after.digest === before.digest ? after.digest.slice(0, 16) : `${before.digest.slice(0, 16)} -> ${after.digest.slice(0, 16)}`);

  const recordings = path.join(ROOT, 'ai', 'dashboard', 'recordings', 'fixtureapp');
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory())
        walk(path.join(dir, entry.name));
      else
        count += 1;
    }
  };
  walk(recordings);
  check('H3: recording count is unchanged from this run baseline', count === recordingCountBefore, `${recordingCountBefore} -> ${count}`);
}

/* ------------------------------------------------------------------ main ------ */

async function main(): Promise<void> {
  assertNothingRealAtRisk();
  const before = realArtefactDigest();
  const recordingCountBefore = fs.readdirSync(path.join(ROOT, 'ai/dashboard/recordings/fixtureapp'),
      { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length;
  try {
    partA();
    partB();
    partC();
    partD();
    partE();
    await partF();
    await partG();
    await partI();
    partJ();
    await partK();
    await partL();
    await partM();
    partH(before, recordingCountBefore);
  } finally {
    restoreRegistry();
    // Safe because `assertNothingRealAtRisk` refused to start if this path already
    // existed, so it can only be the tree this run created.
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${checks - failures}/${checks} checks`);
  if (failures)
    process.exitCode = 1;
}

void main().catch(error => {
  console.error(error instanceof ScopeError ? `ScopeError: ${error.message}` : error);
  process.exitCode = 1;
});
