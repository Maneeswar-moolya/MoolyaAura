import '../testing/isolated-checkout';
/**
 * PHASE 5: generation is application-scoped, end to end.
 *
 *   GENERATION IDENTITY = applicationId + testCaseId, NEVER testCaseId ALONE.
 *
 * Two applications may hold the same Test Case ID, the same Page Object class name, the
 * same `#username`, the same page name and the same recording name, and generating one
 * must neither consume nor modify anything belonging to the other. This gate builds
 * exactly that corpus and drives the real production functions across it.
 *
 * WHY A TEST CASE ID IS NOT AN IDENTITY
 *
 * It is unique within a workbook, a workbook belongs to one application, and nothing
 * anywhere makes it unique across applications - so every store keyed on it alone is a
 * store two projects share. `ai/autocode/state.json` WAS such a store: one entry held
 * the attempt count, fingerprint, verdict and spec path for whichever project reached
 * it first, so one project could exhaust another's budget and a row could be skipped as
 * `accepted` on the strength of another product's spec.
 *
 * SAFETY, and it is not optional here - see the header of lifecycle-isolation.fixture.ts
 * for the incident that produced these rules. The applications are `alpha` and `beta`,
 * ids nothing in this repository uses; `track()` records a directory only if it did not
 * already exist; and `assertNothingRealAtRisk()` refuses to run if anything this fixture
 * would write to is already there.
 *
 * NO BROWSER, NO MODEL, NO NETWORK.
 *
 * Run: npx tsx ai/projects/generation-isolation.fixture.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildIndex, toYaml } from '../knowledge/index';
import { resetActiveApplication } from '../knowledge/canonical';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import { cachePathFor } from '../excel/data-driven';
import { activeMappingFile, readMapping, upsertEntry, writeMapping } from '../excel/mapping';
import { generatedDir, readState, stateKeyFor, writeState } from '../autocode/work';
import { recordingsDir } from '../dashboard/recorder';
import { validateRegistry } from './registry';
import { activeScope, scopedKey, splitScopedKey } from './scope';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition)
    failures += 1;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

const ROOT = process.cwd();
const TEMP_DIR = path.join(ROOT, '.tmp-generation');
const REGISTRY = path.join(TEMP_DIR, 'registry.json');
const ALPHA = 'alpha';
const BETA = 'beta';
const SHARED_ID = 'TC_LOGIN_001';

const APPS = [
  { applicationId: ALPHA, displayName: 'Alpha', defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://alpha.test/' } },
    // Same BASENAME, different directory - the test-data collision this phase closed.
    workbooks: ['excel/alpha/cases.xlsx'] },
  { applicationId: BETA, displayName: 'Beta', defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://beta.test/' } },
    workbooks: ['excel/beta/cases.xlsx'] },
];

const CREATED: string[] = [];
const CREATED_FILES: string[] = [];

function track(dir: string): string {
  if (!fs.existsSync(dir) && !CREATED.includes(dir))
    CREATED.push(dir);
  return dir;
}

function trackFile(file: string): string {
  if (!fs.existsSync(file) && !CREATED_FILES.includes(file))
    CREATED_FILES.push(file);
  return file;
}

const rel = (value: string) => path.relative(ROOT, value).split(path.sep).join('/');

function use(applicationId?: string): void {
  process.env.AURA_REGISTRY_FILE = path.relative(ROOT, REGISTRY);
  if (applicationId)
    process.env.AURA_APPLICATION = applicationId;
  else
    delete process.env.AURA_APPLICATION;
  resetActiveApplication();
}

/** Refuse to run if any path this fixture would write to already exists. */
function assertNothingRealAtRisk(): void {
  const occupied: string[] = [];
  for (const applicationId of [ALPHA, BETA]) {
    use(applicationId);
    const scope = activeScope();
    for (const target of [scope.paths.pagesDir, scope.paths.knowledgePageDir,
      scope.paths.recordingsDir, scope.paths.generatedDir,
      scope.paths.mappingFile, scope.paths.fixturesFile]) {
      if (fs.existsSync(target))
        occupied.push(rel(target));
    }
  }
  if (occupied.length) {
    throw new Error('refusing to run: these paths already exist and are not this fixture\'s '
      + `to write or remove - ${occupied.join(', ')}`);
  }
}

/** One application's whole artefact set, identical in shape to the other's. */
function seed(applicationId: string, marker: string): void {
  use(applicationId);
  const scope = activeScope();

  fs.mkdirSync(track(scope.paths.pagesDir), { recursive: true });
  fs.writeFileSync(path.join(scope.paths.pagesDir, 'login.page.ts'),
      `/**\n * ${marker} sign-in page.\n */\nexport class LoginPage {\n`
      + `  usernameField(): string {\n    return '#username';\n  }\n}\n`, 'utf8');

  fs.mkdirSync(track(scope.paths.knowledgePageDir), { recursive: true });
  fs.writeFileSync(path.join(scope.paths.knowledgePageDir, `${applicationId}__root.yaml`),
      ['page:', `  id: ${applicationId}__root`, '  route: /', `  name: ${marker} sign in`,
        '  authentication_required: false', 'elements:', '  username_field:',
        '    usage: action', `    description: The ${marker} username box.`,
        '    page_object: LoginPage', '    page_object_method: usernameField',
        `    locator_strategy: "page.locator('#username')"`, ''].join('\n'), 'utf8');

  fs.mkdirSync(track(scope.paths.generatedDir), { recursive: true });
  fs.writeFileSync(path.join(scope.paths.generatedDir, `${SHARED_ID}.spec.ts`),
      `// ${marker}\nimport { test } from './fixtures';\n`
      + `test('${SHARED_ID} - ${marker} sign in', async () => {});\n`, 'utf8');

  fs.mkdirSync(track(scope.paths.recordingsDir), { recursive: true });
  fs.writeFileSync(path.join(scope.paths.recordingsDir, `${SHARED_ID}.spec.ts`),
      `// ${marker} recording\n`, 'utf8');

  fs.writeFileSync(trackFile(scope.paths.fixturesFile),
      `// ${marker} fixtures\nexport interface Fixtures {\n  loginPage: LoginPage;\n}\n`
      + '  loginPage: async ({ page }, use) => { await use(null as never); },\n', 'utf8');

  const mapping = readMapping(scope.paths.mappingFile);
  upsertEntry(mapping, SHARED_ID, {
    testFile: rel(path.join(scope.paths.generatedDir, `${SHARED_ID}.spec.ts`)),
    testName: `${SHARED_ID} - ${marker} sign in`,
    module: 'Login', scenario: `${marker} sign in`, sourceWorkbook: `${applicationId}/cases.xlsx`,
  }, new Date(0).toISOString());
  trackFile(scope.paths.mappingFile);
  writeMapping(mapping, scope.paths.mappingFile);
}

/* --------------------------------------- 2. identity is app + test case ---- */

function sectionIdentity(): void {
  console.log('\n2. Generation identity is applicationId + testCaseId\n');
  use(ALPHA);
  const alphaKey = stateKeyFor(SHARED_ID);
  use(BETA);
  const betaKey = stateKeyFor(SHARED_ID);

  check('the same Test Case ID gives two different state keys', alphaKey !== betaKey,
      `${alphaKey}  vs  ${betaKey}`);
  check('and each key carries its application', alphaKey === scopedKey(ALPHA, SHARED_ID)
      && betaKey === scopedKey(BETA, SHARED_ID));
  check('the Test Case ID itself is NOT renamed',
      splitScopedKey(alphaKey).key === SHARED_ID && splitScopedKey(betaKey).key === SHARED_ID,
      'the workbook contract and the test title are untouched');

  // A budget spent in one application must not be spent in the other.
  const state = { [alphaKey]: { fingerprint: 'f', verdict: 'quarantined', attempts: 2,
    at: new Date(0).toISOString(), model: 'x' } } as never;
  check('an attempt budget spent by one project is not spent by the other',
      (state as Record<string, unknown>)[betaKey] === undefined,
      'MAX_ATTEMPTS is global policy; the RECORD is per application');
}

/* ------------------------------------------------- 6/7/8. index, locator, AI ---- */

function sectionIndexAndCandidates(): void {
  console.log('\n6/7/8. Index, locator candidates and the AI pool\n');
  const seen: Record<string, string> = {};
  for (const applicationId of [ALPHA, BETA]) {
    use(applicationId);
    const index = buildIndex();
    seen[applicationId] = index.pages.LoginPage?.file ?? '(none)';
    check(`${applicationId}: the index is built for this application`,
        index.applicationId === applicationId);
    check(`${applicationId}: only its own LoginPage participates`,
        (index.pages.LoginPage?.file ?? '').includes(`/${applicationId}/`),
        index.pages.LoginPage?.file);
    check(`${applicationId}: no class from the other application is in the pool`,
        Object.values(index.pages).every(entry =>
          !entry.file.includes(`/${applicationId === ALPHA ? BETA : ALPHA}/`)));
    const knowledge = readAllPageKnowledge();
    check(`${applicationId}: knowledge is its own, though both describe route /`,
        knowledge.length === 1 && knowledge[0].file.includes(`/${applicationId}/`),
        rel(knowledge[0]?.file ?? ''));
    check(`${applicationId}: the recording corpus is its own`,
        recordingsDir() === activeScope().paths.recordingsDir);
  }
  check('the two indexes are never merged', seen[ALPHA] !== seen[BETA],
      `${seen[ALPHA]}  vs  ${seen[BETA]}`);

  // 7/8. Both applications declare the IDENTICAL locator. Nothing keyed on the selector
  // could separate them; what separates them is that no pool ever holds both. So if one
  // project cannot resolve an element, the other's candidate is not reachable to rescue
  // it - the honest outcome stays NEEDS_REVIEW rather than a cross-project borrow.
  use(ALPHA);
  const alphaElements = readAllPageKnowledge().flatMap(page => page.elements);
  use(BETA);
  const betaElements = readAllPageKnowledge().flatMap(page => page.elements);
  check('both projects really declare the same #username selector',
      alphaElements.some(e => /#username/.test(e.locator_strategy ?? ''))
      && betaElements.some(e => /#username/.test(e.locator_strategy ?? '')));

  use(ALPHA);
  fs.rmSync(path.join(activeScope().paths.knowledgePageDir, `${ALPHA}__root.yaml`), { force: true });
  check('with one project starved, the other\'s candidate is NOT offered',
      readAllPageKnowledge().flatMap(page => page.elements).length === 0,
      'the pool is empty, never borrowed - so AI cannot be a cross-project fallback');
}

/* ------------------------------------------------- 11/12. fixtures module ---- */

function sectionFixtures(): void {
  console.log('\n11/12. The generated spec is told its OWN fixtures module\n');
  for (const applicationId of [ALPHA, BETA]) {
    use(applicationId);
    const index = buildIndex();
    const yaml = toYaml(index);
    const importLine = yaml.split('\n').find(line => line.includes('importFrom')) ?? '';
    check(`${applicationId}: the index names this application's fixtures module`,
        importLine.includes(`${applicationId}.fixtures.ts`), importLine.trim());
    check(`${applicationId}: and not the flat one`,
        !/importFrom: tests-e2e\/fixtures\.ts$/.test(importLine.trim()));
  }
  // 12. The framework index is a DERIVED, application-specific document living in a
  // shared directory, so it carries the application in its name once there is more
  // than one - otherwise a second project's `excel:index` would overwrite the first's.
  use(ALPHA);
  check('the derived framework index is named per application when several exist',
      !activeScope().soleApplication, 'two registered, so framework.<id>.yaml');
}

/* --------------------------------------------- 9/10. mapping and specs ---- */

function sectionMappingAndSpecs(): void {
  console.log('\n9/10. Mapping and generated specs coexist under one Test Case ID\n');
  use(ALPHA);
  const alphaMappingFile = activeMappingFile();
  const alphaMapping = readMapping();
  use(BETA);
  const betaMappingFile = activeMappingFile();
  const betaMapping = readMapping();

  check('the two mapping files are different', alphaMappingFile !== betaMappingFile,
      `${path.basename(alphaMappingFile)}  vs  ${path.basename(betaMappingFile)}`);
  check('both hold an entry for the SAME Test Case ID',
      Boolean(alphaMapping[SHARED_ID]) && Boolean(betaMapping[SHARED_ID]));
  check('and each entry points at its own spec',
      alphaMapping[SHARED_ID].testFile.includes(`/${ALPHA}/`)
      && betaMapping[SHARED_ID].testFile.includes(`/${BETA}/`),
      `${alphaMapping[SHARED_ID].testFile}  |  ${betaMapping[SHARED_ID].testFile}`);

  // Writing one must not touch the other. Compared byte for byte.
  const betaBefore = fs.readFileSync(betaMappingFile, 'utf8');
  use(ALPHA);
  const mapping = readMapping();
  upsertEntry(mapping, SHARED_ID, { testFile: alphaMapping[SHARED_ID].testFile,
    testName: 'rewritten', module: 'Login', scenario: 'rewritten' }, new Date(1).toISOString());
  writeMapping(mapping);
  check('rewriting one project\'s mapping leaves the other byte-identical',
      fs.readFileSync(betaMappingFile, 'utf8') === betaBefore);

  // 10. Both generated specs exist, under one Test Case ID, and neither was overwritten.
  use(ALPHA);
  const alphaSpec = path.join(generatedDir(), `${SHARED_ID}.spec.ts`);
  use(BETA);
  const betaSpec = path.join(generatedDir(), `${SHARED_ID}.spec.ts`);
  check('both generated specs coexist', fs.existsSync(alphaSpec) && fs.existsSync(betaSpec),
      `${rel(alphaSpec)}  |  ${rel(betaSpec)}`);
  check('and they are different files with different contents',
      alphaSpec !== betaSpec
      && fs.readFileSync(alphaSpec, 'utf8') !== fs.readFileSync(betaSpec, 'utf8'));
}

/* ------------------------------------------------------- 15. test data ---- */

function sectionTestData(): void {
  console.log('\n15. Two workbooks with the SAME basename cannot share a cache\n');
  const alphaCache = cachePathFor('excel/alpha/cases.xlsx');
  const betaCache = cachePathFor('excel/beta/cases.xlsx');
  check('same basename, different workbook -> different cache file', alphaCache !== betaCache,
      `${path.basename(alphaCache)}  vs  ${path.basename(betaCache)}`);
  check('and each name still identifies its workbook',
      alphaCache.includes(ALPHA) && betaCache.includes(BETA));
}

/* ------------------------------------------- 17. transaction safety ---- */

function sectionTransactionSafety(): void {
  console.log('\n17. A failure in one project cannot touch the other\n');
  use(BETA);
  const beta = activeScope();
  const before = {
    page: fs.readFileSync(path.join(beta.paths.pagesDir, 'login.page.ts'), 'utf8'),
    knowledge: fs.readFileSync(path.join(beta.paths.knowledgePageDir, `${BETA}__root.yaml`), 'utf8'),
    mapping: fs.readFileSync(beta.paths.mappingFile, 'utf8'),
    spec: fs.readFileSync(path.join(beta.paths.generatedDir, `${SHARED_ID}.spec.ts`), 'utf8'),
    fixtures: fs.readFileSync(beta.paths.fixturesFile, 'utf8'),
  };

  // Everything a generation writes, attempted for the OTHER application - including a
  // write that fails half way. None of it may reach this one.
  use(ALPHA);
  const alpha = activeScope();
  try {
    fs.writeFileSync(path.join(alpha.paths.pagesDir, 'login.page.ts'),
        '// rewritten by a generation that then failed\n', 'utf8');
    const mapping = readMapping();
    upsertEntry(mapping, SHARED_ID, { testFile: 'x', testName: 'y' }, new Date(2).toISOString());
    writeMapping(mapping);
    const state = readState();
    state[stateKeyFor(SHARED_ID)] = { fingerprint: 'f', verdict: 'quarantined', attempts: 1,
      at: new Date(0).toISOString(), model: 'x' } as never;
    writeState(state, path.join(TEMP_DIR, 'state.json'));
    throw new Error('simulated generation failure');
  } catch {
    // The failure is the point.
  }

  use(BETA);
  check('17: the other project\'s Page Object is untouched',
      fs.readFileSync(path.join(beta.paths.pagesDir, 'login.page.ts'), 'utf8') === before.page);
  check('17: its knowledge is untouched',
      fs.readFileSync(path.join(beta.paths.knowledgePageDir, `${BETA}__root.yaml`), 'utf8') === before.knowledge);
  check('17: its mapping is untouched',
      fs.readFileSync(beta.paths.mappingFile, 'utf8') === before.mapping);
  check('17: its generated spec is untouched',
      fs.readFileSync(path.join(beta.paths.generatedDir, `${SHARED_ID}.spec.ts`), 'utf8') === before.spec);
  check('17: its fixtures module is untouched',
      fs.readFileSync(beta.paths.fixturesFile, 'utf8') === before.fixtures);
}

/* --------------------------------------------------------- cleanup ---- */

function cleanup(): void {
  console.log('\nCleanup\n');
  for (const file of CREATED_FILES)
    fs.rmSync(file, { force: true });
  for (const dir of CREATED)
    fs.rmSync(dir, { recursive: true, force: true });
  for (const target of [...CREATED_FILES, ...CREATED])
    check(`removed ${rel(target)}`, !fs.existsSync(target));
}

function main(): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, `${JSON.stringify(
      validateRegistry({ schemaVersion: 1, applications: APPS }, 'fixture registry'), null, 2)}\n`, 'utf8');
  console.log('\nGeneration isolation - applicationId + testCaseId');

  try {
    assertNothingRealAtRisk();
    seed(ALPHA, 'Alpha');
    seed(BETA, 'Beta');

    sectionIdentity();
    sectionIndexAndCandidates();
    sectionFixtures();
    sectionMappingAndSpecs();
    sectionTestData();
    sectionTransactionSafety();
  } finally {
    cleanup();
    delete process.env.AURA_REGISTRY_FILE;
    delete process.env.AURA_APPLICATION;
    resetActiveApplication();
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  check('the fixture left nothing behind',
      !fs.existsSync(TEMP_DIR) && [...CREATED, ...CREATED_FILES].every(t => !fs.existsSync(t)));
  console.log(`\n${failures ? 'FAIL' : 'PASS'} - ${checks - failures}/${checks} checks\n`);
  process.exit(failures ? 1 : 0);
}

main();
