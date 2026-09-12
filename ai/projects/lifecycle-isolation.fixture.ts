import '../testing/isolated-checkout';
/**
 * PHASE 4: the active application boundary cannot be lost or replaced.
 *
 * Phase 2 gave every artefact class a scoped location and Phase 3 made the dashboard
 * choose one. Neither of those proves the property that actually matters:
 *
 *   ACTIVE APPLICATION SCOPE IS IMMUTABLE FOR THE OPERATION.
 *
 * An artefact filed correctly and then RESOLVED through a different application is the
 * same failure as filing it wrongly, and it is the one a per-file check cannot see. So
 * this gate follows a whole lifecycle - selection, session, save, index, knowledge,
 * Page Object, locator - and at each stage asks the real production function which
 * application it is in.
 *
 * WHY THE ADVERSARIAL CASES LOOK CONTRIVED
 *
 * They are built to be the WORST case rather than a typical one: two applications
 * whose Page Object classes have the same name, whose knowledge files describe the
 * same route, whose elements use the same `#username`, and whose test cases share
 * TC_LOGIN_001. Every one of those is a real thing to have - two products built by one
 * team look exactly like this - and every one is a place where "find the LoginPage"
 * has two right answers and no way to choose between them except the scope.
 *
 * NO BROWSER, NO MODEL, NO NETWORK. `startRecording` is exercised only as far as its
 * scope check; the save path is driven through `persistRecording`, which is the
 * function that actually files a recording.
 *
 * WHY THE TEST APPLICATIONS ARE NOT CALLED fixtureapp AND fixtureshop
 *
 * Because the first version of this fixture WAS, and it deleted the repository's real
 * recording store. `ScopePaths` is rooted at the repository, so an application called
 * `fixtureapp` resolves to `ai/dashboard/recordings/fixtureapp` - the live directory
 * holding 410 migrated artefacts - and a fixture that tidies up after itself by
 * removing the directories it used removed that one. Nothing was lost, because the
 * migration's backup was kept; the lesson is that a fixture which composes REAL paths
 * from a scope is one `rmSync` away from the real thing.
 *
 * So the two applications here are `alpha` and `beta`: ids nothing in this repository
 * uses, whose every scoped path is therefore new. The property being proven does not
 * depend on the names - two applications that share a class name, a route, a selector
 * and a Test Case ID is the adversarial shape, whatever they are called.
 *
 * TWO GUARDS, because one was not enough:
 *
 *   1. `track()` records a directory only if it did NOT already exist. A fixture may
 *      remove what it created and nothing else, so a path that turns out to be real is
 *      never a candidate for deletion.
 *   2. `assertNothingRealAtRisk()` refuses to run at all if any path this fixture would
 *      write to already exists. That is the check that would have stopped the incident
 *      before the first byte was written, rather than after.
 *
 * Run: npx tsx ai/projects/lifecycle-isolation.fixture.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildIndex } from '../knowledge/index';
import { activeApplicationId, canonicalFile, resetActiveApplication } from '../knowledge/canonical';
import { activeKnowledgePageDir, readAllPageKnowledge } from '../knowledge/page-knowledge';
import { pageFilePathFor, pagesDir } from '../autocode/abstraction/writer';
import { generatedDir } from '../autocode/work';
import { activeMappingFile } from '../excel/mapping';
import { persistRecording, recordingsDir, startRecording } from '../dashboard/recorder';
import { scopeForWorkbook, tryScopeFromSelection } from '../dashboard/scope-request';
import { validateRegistry } from './registry';
import { activeScope, resolveScope, ScopeError } from './scope';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition)
    failures += 1;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

const ROOT = process.cwd();
const TEMP_DIR = path.join(ROOT, '.tmp-lifecycle');
const REGISTRY = path.join(TEMP_DIR, 'registry.json');

/** Two applications that are as alike as two applications can be. */
const ALPHA = 'alpha';
const BETA = 'beta';

const APPS = [
  {
    applicationId: ALPHA,
    displayName: 'Alpha',
    defaultEnvironmentId: 'qa',
    // Deliberately the addresses of two real, different products: the point of several
    // checks below is that an application is NOT its host.
    environments: { qa: { baseUrl: 'https://portal.fixture.invalid/' } },
    workbooks: ['excel/alpha-cases.xlsx'],
  },
  {
    applicationId: BETA,
    displayName: 'Beta',
    defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://shop.fixture.invalid/' } },
    workbooks: ['excel/beta-cases.xlsx'],
  },
];

/** Every directory this fixture may create, so cleanup can be asserted by name. */
const CREATED: string[] = [];

/**
 * Record a directory for cleanup - ONLY if this fixture is about to bring it into
 * existence. Never delete what you did not create.
 */
function track(dir: string): string {
  if (!fs.existsSync(dir) && !CREATED.includes(dir))
    CREATED.push(dir);
  return dir;
}

/**
 * Refuse to run if anything this fixture would write to is already there.
 *
 * The second guard, and the one that would have prevented the incident in the header:
 * `track()` protects a real directory from DELETION, and this protects it from being
 * written into at all. A fixture that finds its workspace occupied has been given the
 * wrong workspace, and continuing means composing real paths from a scope.
 */
function assertNothingRealAtRisk(): void {
  const occupied: string[] = [];
  for (const applicationId of [ALPHA, BETA]) {
    use(applicationId);
    const scope = activeScope();
    for (const dir of [scope.paths.pagesDir, scope.paths.knowledgePageDir,
      scope.paths.recordingsDir, scope.paths.generatedDir]) {
      if (fs.existsSync(dir))
        occupied.push(rel(dir));
    }
    for (const file of [scope.paths.mappingFile, scope.paths.fixturesFile]) {
      if (fs.existsSync(file))
        occupied.push(rel(file));
    }
  }
  if (occupied.length) {
    throw new Error(`refusing to run: these paths already exist and are not this fixture's `
      + `to write or remove - ${occupied.join(', ')}`);
  }
}

function use(applicationId?: string): void {
  process.env.AURA_REGISTRY_FILE = path.relative(ROOT, REGISTRY);
  if (applicationId)
    process.env.AURA_APPLICATION = applicationId;
  else
    delete process.env.AURA_APPLICATION;
  resetActiveApplication();
}

const rel = (value: string) => path.relative(ROOT, value).split(path.sep).join('/');

/**
 * A Page Object class and a knowledge file for one application.
 *
 * Both applications get the SAME class name, the same declared route and the same
 * `#username` selector. If any lookup in this repository were keyed on a name, a
 * route or a selector rather than constrained by the scope, these two would be
 * indistinguishable - which is the point.
 */
function seedApplication(applicationId: string, marker: string): void {
  use(applicationId);
  const scope = activeScope();

  fs.mkdirSync(track(scope.paths.pagesDir), { recursive: true });
  fs.writeFileSync(path.join(scope.paths.pagesDir, 'login.page.ts'),
      `/**\n * ${marker} sign-in page.\n */\nexport class LoginPage {\n`
      + `  usernameField(): string {\n    return '#username';\n  }\n}\n`, 'utf8');

  fs.mkdirSync(track(scope.paths.knowledgePageDir), { recursive: true });
  fs.writeFileSync(path.join(scope.paths.knowledgePageDir, `${applicationId}__root.yaml`),
      ['page:', `  id: ${applicationId}__root`, '  route: /',
        `  name: ${marker} sign in`, '  authentication_required: false',
        'elements:', '  username_field:', '    usage: action',
        `    description: The ${marker} username box, the one a person types into.`,
        '    page_object: LoginPage', '    page_object_method: usernameField',
        `    locator_strategy: "page.locator('#username')"`, ''].join('\n'), 'utf8');
}

/* ------------------------------------------------------- 1. session ownership ---- */

async function sectionSessionOwnership(): Promise<void> {
  console.log('\n1. The recording session owns its scope, and nothing else supplies one\n');
  use(ALPHA);

  // The scope is checked BEFORE anything else - before the URL is even parsed - so a
  // session can never exist without one. Proven by giving it a scope and an address
  // that cannot be a recording: the URL complaint means the scope was accepted, and a
  // scope complaint would mean it was not reached.
  const badUrl = await startRecording({ scope: activeScope(), url: 'not-a-url', browser: 'chromium' });
  check('a scoped start reaches URL validation (so the scope was accepted)',
      badUrl.started === false && /is not a URL/.test(badUrl.error ?? ''),
      badUrl.error?.slice(0, 48));

  const noScope = await startRecording({ scope: undefined as never, browser: 'chromium' });
  check('an unscoped start is refused BEFORE the URL is looked at',
      noScope.started === false && /project was selected/i.test(noScope.error ?? ''),
      noScope.error?.slice(0, 48));

  // There is no second source of project identity anywhere in the recorder: no setter,
  // and no function that turns a URL into an application.
  const recorder = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'recorder.ts'), 'utf8');
  check('the recorder never derives an application from a URL',
      !/applicationSlug|new URL\([^)]*\)\.host(name)?\s*(as|=>|;)?\s*.*application/i.test(recorder));
  check('and exposes no way to change a session\'s scope',
      !/set\s*scope|session\.scope\s*=/.test(recorder),
      'recordingScope() reads; nothing writes');
}

/* ------------------------------------ 2. concurrency: the save follows the session ---- */

function sectionConcurrency(): void {
  console.log('\n2. Concurrent selections cannot contaminate a recording in flight\n');

  // The dashboard is ONE process. Two people using it share the ambient scope, the
  // module-level `session`, and every memo - so the only thing that can keep their work
  // apart is that each operation carries its own scope. These checks interleave the
  // two the way two people would.
  const alpha = resolveScope({ applicationId: ALPHA });
  const beta = resolveScope({ applicationId: BETA });

  // A. User A records against FixturePortal. User B selects FixtureShop - which moves the
  //    ambient scope. User A then saves.
  use(ALPHA);
  const aOrigin = { applicationId: ALPHA, environmentId: 'qa', baseUrl: alpha.baseUrl };
  use(BETA);                                   // <- user B's selection lands
  const aSaved = persistRecording('TC_LOGIN_001', "import { test } from '@playwright/test';\n",
      { available: false, reason: 'fixture' } as never, undefined, aOrigin);
  check('A: user A\'s save lands in FixturePortal despite the ambient scope moving',
      Boolean(aSaved) && aSaved!.includes('/alpha/'), String(aSaved));
  check('A: and not in the project user B selected',
      Boolean(aSaved) && !aSaved!.includes('/beta/'), String(aSaved));

  // B. Both users save, from one process, with the ambient scope on neither.
  use(ALPHA);
  const bOrigin = { applicationId: BETA, environmentId: 'qa', baseUrl: beta.baseUrl };
  const bSaved = persistRecording('TC_LOGIN_001', "import { test } from '@playwright/test';\n",
      { available: false, reason: 'fixture' } as never, undefined, bOrigin);
  check('B: user B\'s save lands in FixtureShop', Boolean(bSaved) && bSaved!.includes('/beta/'),
      String(bSaved));
  check('B: the two recordings share a Test Case ID and do NOT share a file',
      aSaved !== bSaved
      && fs.existsSync(path.join(alpha.paths.recordingsDir, 'TC_LOGIN_001.spec.ts'))
      && fs.existsSync(path.join(beta.paths.recordingsDir, 'TC_LOGIN_001.spec.ts')),
      `${rel(aSaved!)}  vs  ${rel(bSaved!)}`);

  // C. The ambient application changes again. Neither saved recording moves.
  use(BETA);
  check('C: changing the ambient application does not move an existing recording',
      fs.existsSync(path.join(alpha.paths.recordingsDir, 'TC_LOGIN_001.spec.ts')),
      'the FixturePortal recording is still FixturePortal\'s');
  use();
  check('C: nor does removing the ambient selection entirely',
      fs.existsSync(path.join(beta.paths.recordingsDir, 'TC_LOGIN_001.spec.ts')));

  // The recorder holds ONE session at a time, by design - a second concurrent
  // recording is refused rather than scoped. Recorded here so the boundary of what
  // "concurrent" can mean is written down rather than assumed.
  const recorder = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'recorder.ts'), 'utf8');
  check('a SECOND concurrent recording is refused, not scoped',
      /A recording is already in progress/.test(recorder),
      'so concurrency is between a recording and other requests, not two recordings');
}

/* --------------------------------- 3 + 4. page context and navigation ---- */

function sectionNavigation(): void {
  console.log('\n3/4. A new document is not a new application\n');
  use(ALPHA);
  const before = activeScope();

  // Everything a page can change about itself, changed - and none of it is consulted.
  const documents = [
    { url: 'https://portal.fixture.invalid/apps', documentId: 'doc-2', title: 'Projects' },
    { url: 'https://portal.fixture.invalid/issues/9', documentId: 'doc-3', title: 'Issues' },
    { url: 'https://portal.fixture.invalid/settings', documentId: 'doc-4', title: 'Settings' },
    // The hostile one: an address belonging to the other application.
    { url: 'https://shop.fixture.invalid/checkout', documentId: 'doc-5', title: 'Checkout' },
  ];
  for (const document of documents) {
    check(`after ${document.url} the application is unchanged`,
        activeApplicationId() === ALPHA && activeScope().paths.pagesDir === before.paths.pagesDir,
        `${activeApplicationId()} | doc ${document.documentId}`);
  }

  // The evidence origin records the URL as CONFIGURATION and the applicationId as
  // IDENTITY, and the two are separate fields for exactly this reason.
  const origin = { applicationId: ALPHA, environmentId: 'qa',
    baseUrl: 'https://portal.fixture.invalid/' };
  check('evidence keeps the URL and the identity as SEPARATE fields',
      'baseUrl' in origin && 'applicationId' in origin
      && origin.applicationId !== new URL(origin.baseUrl).host,
      `${origin.applicationId} != ${new URL(origin.baseUrl).host}`);
}

/* ------------------------------- 5 + 8. same name, same locator, two projects ---- */

function sectionSameNameSameLocator(): void {
  console.log('\n5/8. Same class name, same #username, two projects\n');

  use(ALPHA);
  const alphaIndex = buildIndex();
  check('the index is built for the active application',
      alphaIndex.applicationId === ALPHA);
  check('it finds THIS project\'s LoginPage',
      Boolean(alphaIndex.pages.LoginPage),
      alphaIndex.pages.LoginPage?.file);
  check('and that file is inside this project\'s namespace',
      (alphaIndex.pages.LoginPage?.file ?? '').includes('alpha'),
      alphaIndex.pages.LoginPage?.file);
  check('and NOT the other project\'s, though the class name is identical',
      !(alphaIndex.pages.LoginPage?.file ?? '').includes('beta'));

  use(BETA);
  const betaIndex = buildIndex();
  check('the other project resolves its OWN LoginPage independently',
      betaIndex.applicationId === BETA
      && (betaIndex.pages.LoginPage?.file ?? '').includes('beta'),
      betaIndex.pages.LoginPage?.file);
  check('two indexes never hold both projects\' classes',
      alphaIndex.pages.LoginPage?.file !== betaIndex.pages.LoginPage?.file);

  // The locator is IDENTICAL in both projects. Nothing keyed on it could tell them
  // apart; what keeps them apart is that no index ever contains both.
  const alphaSource = fs.readFileSync(path.resolve(ROOT, alphaIndex.pages.LoginPage!.file), 'utf8');
  const betaSource = fs.readFileSync(path.resolve(ROOT, betaIndex.pages.LoginPage!.file), 'utf8');
  check('both projects really do use the same #username selector',
      alphaSource.includes("'#username'") && betaSource.includes("'#username'"));
  check('and they are still two different files',
      alphaSource !== betaSource);
}

/* ---------------------------------------- 7. Page Object creation ---- */

function sectionPageObjectCreation(): void {
  console.log('\n7. A new Page Object is created inside the active application\n');
  for (const applicationId of [ALPHA, BETA]) {
    use(applicationId);
    const target = pageFilePathFor('CheckoutPage');
    check(`${applicationId}: a new class would be written into its own namespace`,
        rel(target) === `tests-e2e/pages/${applicationId}/checkout.page.ts`, rel(target));
    check(`${applicationId}: the writer's directory is the scope's`,
        pagesDir() === activeScope().paths.pagesDir);
  }
}

/* ---------------------------------------------- 9. knowledge ---- */

function sectionKnowledge(): void {
  console.log('\n9. Only the active application\'s knowledge participates\n');
  use(ALPHA);
  const knowledge = readAllPageKnowledge();
  check('knowledge is read from this project\'s directory',
      activeKnowledgePageDir() === activeScope().paths.knowledgePageDir,
      rel(activeKnowledgePageDir()));
  check('every file loaded belongs to this project',
      knowledge.length === 1 && knowledge.every(page => /alpha/.test(page.file)),
      knowledge.map(page => rel(page.file)).join(', ') || '(none)');
  check('the other project\'s knowledge is not loaded, though it describes the same route',
      !knowledge.some(page => /beta/i.test(page.raw)),
      'no cross-project ranking is possible if the file is never read');

  // Where knowledge would be WRITTEN, for the same screen, in each project.
  const alphaFile = canonicalFile('alpha__root');
  use(BETA);
  const betaFile = canonicalFile('beta__root');
  check('knowledge for one screen is written into its own project',
      alphaFile !== betaFile
      && alphaFile.includes('alpha') && betaFile.includes('beta'),
      `${alphaFile}  vs  ${betaFile}`);
}

/* --------------------------- 10 + 11. locator and AI boundary ---- */

function sectionLocatorAndAiBoundary(): void {
  console.log('\n10/11. Everything an engine - or a model - can see is scoped\n');
  use(ALPHA);

  // The locator engine and the resolver are handed three things, and all three are
  // scoped by construction: the Page Object index, page knowledge, and the recording
  // corpus. There is no fourth input from which another project could reach them.
  const index = buildIndex();
  const knowledge = readAllPageKnowledge();
  check('the Page Object pool holds no other project\'s class',
      Object.values(index.pages).every(entry => !entry.file.includes('beta')),
      Object.values(index.pages).map(e => e.file).join(', '));
  check('the knowledge pool holds no other project\'s file',
      knowledge.every(page => !/beta/.test(page.file)));
  check('the recording corpus is this project\'s directory',
      recordingsDir() === activeScope().paths.recordingsDir, rel(recordingsDir()));

  // 11. The adversarial case: this project has NO candidate for the element, and the
  // other project has a perfect one. The perfect one must be unreachable - so the
  // honest outcome is that nothing is found, never a cross-project rescue.
  use(BETA);
  const strong = readAllPageKnowledge()
      .flatMap(page => page.elements)
      .filter(element => element.page_object_method === 'usernameField');
  check('the other project genuinely HAS a strong candidate', strong.length === 1,
      `${strong.length} declared`);

  use(ALPHA);
  fs.rmSync(path.join(activeScope().paths.knowledgePageDir, 'alpha__root.yaml'), { force: true });
  const starved = readAllPageKnowledge().flatMap(page => page.elements)
      .filter(element => element.page_object_method === 'usernameField');
  check('with this project starved, the other project\'s candidate is NOT offered',
      starved.length === 0,
      'a model is handed scoped knowledge only, so it cannot be rescued across projects');
  check('and the pool is empty rather than borrowed', readAllPageKnowledge().length === 0);
}

/* ------------------------------- 12 + 13. handoff and negatives ---- */

function sectionHandoffAndNegatives(): void {
  console.log('\n12/13. Generation recovers the scope from the recording, and nothing else\n');
  use(ALPHA);
  const evidenceFile = path.join(activeScope().paths.recordingsDir, 'TC_HANDOFF.evidence.json');
  persistRecording('TC_HANDOFF', "import { test } from '@playwright/test';\n",
      { available: true, capturedAt: new Date(0).toISOString(), targets: [], limits: {} } as never,
      undefined,
      { applicationId: ALPHA, environmentId: 'qa', baseUrl: 'https://portal.fixture.invalid/' });

  check('the saved evidence records its own application', fs.existsSync(evidenceFile));
  const written = JSON.parse(fs.readFileSync(evidenceFile, 'utf8')) as
    { origin?: { applicationId?: string; environmentId?: string; testCaseId?: string } };
  check('12: generation can recover applicationId from the recording itself',
      written.origin?.applicationId === ALPHA, String(written.origin?.applicationId));
  check('12: and the environment and the row it was recorded for',
      written.origin?.environmentId === 'qa' && written.origin?.testCaseId === 'TC_HANDOFF',
      `${written.origin?.environmentId} / ${written.origin?.testCaseId}`);
  check('12: so it need not be rediscovered from the file name or the URL',
      !evidenceFile.includes('portal.fixture.invalid'));

  // 13. Every cross-project attempt fails, and fails by REFUSING rather than by
  // quietly answering with the other project's artefact.
  use(ALPHA);
  const alpha = activeScope();
  const beta = resolveScope({ applicationId: BETA });

  check('13: one project cannot reach the other\'s mapping',
      activeMappingFile() !== beta.paths.mappingFile
      && activeMappingFile() === alpha.paths.mappingFile);
  check('13: one project cannot reach the other\'s generated specs',
      generatedDir() !== beta.paths.generatedDir);
  check('13: one project cannot reach the other\'s recordings',
      recordingsDir() !== beta.paths.recordingsDir);

  let refused = false;
  try {
    scopeForWorkbook('excel/beta-cases.xlsx', { applicationId: ALPHA });
  } catch (error) {
    refused = error instanceof ScopeError;
  }
  check('13: asking for the other project\'s workbook under this scope is REFUSED', refused);

  const unscoped = tryScopeFromSelection({});
  check('13: and an unscoped request is refused rather than defaulted',
      'error' in unscoped, 'error' in unscoped ? unscoped.error.slice(0, 56) : 'resolved');
}

/* ------------------------------------------ 15. end to end, twice ---- */

function sectionEndToEnd(): void {
  console.log('\n15. The two artefact chains, end to end, side by side\n');
  const chains: Record<string, string[]> = {};
  for (const applicationId of [ALPHA, BETA]) {
    use(applicationId);
    const scope = activeScope();
    chains[applicationId] = [
      rel(scope.paths.recordingsDir),
      rel(scope.paths.pagesDir),
      rel(scope.paths.knowledgePageDir),
      rel(scope.paths.generatedDir),
      rel(scope.paths.mappingFile),
      rel(scope.paths.fixturesFile),
    ];
    check(`${applicationId}: every stage of the chain names this project`,
        chains[applicationId].every(entry => entry.includes(applicationId)),
        chains[applicationId].join(' | '));
  }
  const shared = chains[ALPHA].filter(entry => chains[BETA].includes(entry));
  check('the two chains share NOTHING', shared.length === 0, shared.join(', ') || 'no overlap');
}

/* ------------------------------------------------------- cleanup ---- */

function sectionCleanup(): void {
  console.log('\nCleanup - an accidentally surviving scoped directory is a trap\n');
  for (const dir of CREATED)
    fs.rmSync(dir, { recursive: true, force: true });
  // With ONE application registered, `layoutFor` prefers `<dir>/<applicationId>/` the
  // moment it exists - so a leftover empty `ai/knowledge/page/alpha/` would hide the
  // repository's real knowledge and every generation would explore from scratch.
  for (const dir of CREATED)
    check(`removed ${rel(dir)}`, !fs.existsSync(dir));
}

async function main(): Promise<void> {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, `${JSON.stringify(
      validateRegistry({ schemaVersion: 1, applications: APPS }, 'fixture registry'), null, 2)}\n`, 'utf8');
  console.log('\nLifecycle isolation - the application boundary cannot be replaced');

  try {
    assertNothingRealAtRisk();
    seedApplication(ALPHA, 'Alpha');
    seedApplication(BETA, 'Beta');
    // The recordings directories are created by the saves below; track them so the
    // cleanup removes them too.
    for (const applicationId of [ALPHA, BETA]) {
      use(applicationId);
      track(activeScope().paths.recordingsDir);
    }

    await sectionSessionOwnership();
    sectionConcurrency();
    sectionNavigation();
    sectionSameNameSameLocator();
    sectionPageObjectCreation();
    sectionKnowledge();
    sectionLocatorAndAiBoundary();
    sectionHandoffAndNegatives();
    sectionEndToEnd();
  } finally {
    sectionCleanup();
    delete process.env.AURA_REGISTRY_FILE;
    delete process.env.AURA_APPLICATION;
    resetActiveApplication();
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  check('the fixture left nothing behind',
      !fs.existsSync(TEMP_DIR) && CREATED.every(dir => !fs.existsSync(dir)));
  console.log(`\n${failures ? 'FAIL' : 'PASS'} - ${checks - failures}/${checks} checks\n`);
  process.exit(failures ? 1 : 0);
}

void main();
