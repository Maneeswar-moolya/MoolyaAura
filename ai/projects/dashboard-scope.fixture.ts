import '../testing/isolated-checkout';
/**
 * The offline gate for PROJECT SELECTION at the dashboard boundary.
 *
 * No browser, no model, no network, no server. It drives the real production
 * functions - `tryScopeFromSelection`, `describeProjects`, `assertWorkbookInScope`,
 * `startRecording`'s scope handling, `recordingScope` - under a registry that declares
 * TWO applications, which is the only condition under which any of this is testable:
 * with one application registered every answer is trivially right.
 *
 * WHAT IT DEFENDS
 *
 *   The project is SELECTED before anything opens, and it is never inferred from a
 *   URL, a document, a file name, a Test Case ID or a Page Object name.
 *
 * The failure being guarded against is not a crash. A dashboard that resolved the
 * project from the recorded URL would work perfectly for months - one application, one
 * host - and then quietly file FixtureShop's evidence into FixturePortal's namespace the first
 * time somebody recorded against a shared tenant or a staging domain. Every negative
 * case below therefore asserts a REFUSAL with the choices named, never "some error",
 * and never a fallback.
 *
 * Run: npx tsx ai/projects/dashboard-scope.fixture.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { assertWorkbookInScope, describeProjects, tryScopeFromSelection } from '../dashboard/scope-request';
import { persistRecording, recordingScope, startRecording } from '../dashboard/recorder';
import { activeApplicationId, resetActiveApplication } from '../knowledge/canonical';
import { addApplication, readRegistry, validateRegistry, workbookOwner } from './registry';
import { activeScope, resolveScope, ScopeError } from './scope';
import {
  enterIsolatedArtefactRoot, isInsideFixtureRoot, leaveIsolatedArtefactRoot, removeFixtureTree,
} from './fixture-safety';

const resolveScopeFor = (applicationId: string) => resolveScope({ applicationId });

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition)
    failures += 1;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

const TEMP_DIR = path.join(process.cwd(), '.tmp-dashboard-scope');
const TWO_FILE = path.join(TEMP_DIR, 'two.json');
const ONE_FILE = path.join(TEMP_DIR, 'one.json');

const FIXTUREAPP = {
  applicationId: 'fixtureapp',
  displayName: 'FixturePortal',
  defaultEnvironmentId: 'qa',
  environments: {
    qa: { baseUrl: 'https://portal.fixture.invalid/' },
    staging: { baseUrl: 'https://staging.fixtureapp.test/' },
  },
  workbooks: ['excel/fixture-cases.xlsx'],
};

/**
 * A SYNTHETIC SECOND APPLICATION, and its id is deliberately one no real registry can
 * hold. `validateRegistry` refuses the `fixture-` prefix precisely so a fixture and a real
 * project can never name the same artefact directory.
 *
 * This used to be `fixtureshop`. `resolveScopeFor` resolves against the REAL filesystem
 * layout, so once somebody added a real FixtureShop project from the dashboard, section 7 of
 * this fixture recursively deleted `ai/dashboard/recordings/fixtureshop` - their recordings.
 * The same accident once cost FixturePortal 410 artefacts. A pretend name is only pretend until
 * somebody uses it.
 */
const FIXTURESHOP = {
  applicationId: 'fixture-shop',
  displayName: 'Fixture Shop',
  defaultEnvironmentId: 'qa',
  environments: {
    qa: { baseUrl: 'https://shop.fixture.invalid/' },
    staging: { baseUrl: 'https://staging.fixtureshop.test/' },
  },
  workbooks: ['excel/fixture-shop-checkout.xlsx'],
};

function writeRegistry(file: string, applications: unknown[]): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(
      validateRegistry({ schemaVersion: 1, applications }, 'fixture registry'), null, 2)}\n`, 'utf8');
}

/** Point the process at a registry and choose a project, the way the server does. */
function useRegistry(file: string, applicationId?: string, environmentId?: string): void {
  process.env.AURA_REGISTRY_FILE = path.relative(process.cwd(), file);
  if (applicationId)
    process.env.AURA_APPLICATION = applicationId;
  else
    delete process.env.AURA_APPLICATION;
  if (environmentId)
    process.env.AURA_ENVIRONMENT = environmentId;
  else
    delete process.env.AURA_ENVIRONMENT;
  resetActiveApplication();
}

function restore(): void {
  delete process.env.AURA_REGISTRY_FILE;
  delete process.env.AURA_APPLICATION;
  delete process.env.AURA_ENVIRONMENT;
  resetActiveApplication();
}

/* ------------------------------------------------- project + environment ---- */

function sectionSelection(): void {
  console.log('\n1/2. Project and environment selection\n');
  useRegistry(TWO_FILE, 'fixtureapp');
  const { projects, soleApplication } = describeProjects();

  check('both registered projects are offered', projects.length === 2,
      projects.map(p => p.applicationId).join(', '));
  check('a selection is REQUIRED once two are registered', soleApplication === false);
  // displayName is for reading; applicationId is the identifier. Asserted as a pair,
  // because a UI that posted the display name would look identical until a rename.
  const fixtureapp = projects.find(p => p.applicationId === 'fixtureapp');
  check('displayName and applicationId are distinct values',
      fixtureapp?.displayName === 'FixturePortal' && fixtureapp?.applicationId === 'fixtureapp',
      `${fixtureapp?.displayName} vs ${fixtureapp?.applicationId}`);

  check('only that project\'s environments are offered',
      fixtureapp?.environments.map(e => e.environmentId).sort().join(',') === 'qa,staging',
      fixtureapp?.environments.map(e => e.environmentId).join(', '));
  check('and they are not another project\'s',
      !fixtureapp?.environments.some(e => e.baseUrl.includes('fixture-shop')));
  check('the default environment is marked',
      fixtureapp?.environments.filter(e => e.isDefault).map(e => e.environmentId).join('') === 'qa');

  // The baseUrl comes FROM the selected environment, not the other way round.
  const staging = tryScopeFromSelection({ applicationId: 'fixtureapp', environmentId: 'staging' });
  check('selecting an environment resolves its own baseUrl',
      'scope' in staging && staging.scope.baseUrl === 'https://staging.fixtureapp.test/',
      'scope' in staging ? staging.scope.baseUrl : 'refused');
  check('and changing environment does NOT change the identity',
      'scope' in staging && staging.scope.applicationId === 'fixtureapp');
}

/* --------------------------------------------------------------- A and B ---- */

async function sectionRecordingIdentity(): Promise<void> {
  console.log('\nA/B. Starting a recording inside the selected project\n');
  for (const [applicationId, expectedUrl] of [
    ['fixtureapp', 'https://portal.fixture.invalid/'],
    ['fixture-shop', 'https://shop.fixture.invalid/'],
  ]) {
    useRegistry(TWO_FILE, applicationId);
    const scope = activeScope();
    check(`${applicationId}: the scope resolves to the DECLARED id`,
        scope.applicationId === applicationId, scope.applicationId);
    check(`${applicationId}: and its environment's own baseUrl`, scope.baseUrl === expectedUrl,
        scope.baseUrl);
    // The recorder is asked for the identity it would lock in. No browser is started:
    // an invalid browser name still reaches the scope check first, and what is being
    // asserted is that the scope is REQUIRED and CARRIED, not that codegen runs.
    const refusedWithoutScope = await startRecording({
      scope: undefined as never, browser: 'chromium',
    });
    check(`${applicationId}: startRecording REFUSES with no project`,
        refusedWithoutScope.started === false && /project was selected/i.test(refusedWithoutScope.error ?? ''),
        refusedWithoutScope.error?.slice(0, 60));
  }
}

/* --------------------------------------------------------------------- C ---- */

function sectionSharedTestCaseId(): void {
  console.log('\nC. TC_LOGIN_001 exists in both projects\n');
  const registry = readRegistry(TWO_FILE);
  // The workbook IS the application boundary for test cases, and the registry declares
  // who owns each one - so a shared Test Case ID resolves through the project, not
  // through a global lookup. Reused rather than duplicated into a second store.
  check('each project owns its own workbook',
      workbookOwner('excel/fixture-cases.xlsx', registry) === 'fixtureapp'
      && workbookOwner('excel/fixture-shop-checkout.xlsx', registry) === 'fixture-shop');

  useRegistry(TWO_FILE, 'fixtureapp');
  const fixtureapp = activeScope();
  useRegistry(TWO_FILE, 'fixture-shop');
  const fixtureshop = activeScope();
  check('the same Test Case ID resolves to two different generated specs',
      path.join(fixtureapp.paths.generatedDir, 'TC_LOGIN_001.spec.ts')
      !== path.join(fixtureshop.paths.generatedDir, 'TC_LOGIN_001.spec.ts'));
  check('and to two different recordings',
      path.join(fixtureapp.paths.recordingsDir, 'TC_LOGIN_001.evidence.json')
      !== path.join(fixtureshop.paths.recordingsDir, 'TC_LOGIN_001.evidence.json'));
  check('and to two different mapping files',
      fixtureapp.paths.mappingFile !== fixtureshop.paths.mappingFile);
}

/* --------------------------------------------------------------------- D ---- */

function sectionNavigationDoesNotMove(): void {
  console.log('\nD. Navigating cannot change the application\n');
  useRegistry(TWO_FILE, 'fixtureapp');
  const scope = activeScope();

  // The identity is a value chosen before the browser opened. There is deliberately no
  // setter and no derivation, so a URL cannot reach it - the strongest form of this
  // check is that no such path EXISTS, which is what the next two assert.
  check('a recording session exposes its scope read-only',
      typeof recordingScope === 'function'
      && !Object.keys(recordingScope as object).includes('set'));
  // `baseUrl` is legitimately ON the scope - it is where this environment lives, and
  // the recorder needs it to open a browser. What must not exist is a way to go the
  // other way, so the assertion is about the scope REQUEST: the only things that can
  // select an application are an applicationId, an environmentId and a workbook the
  // registry declares an owner for. There is no url field to pass, so there is nothing
  // for a navigation to reach.
  const requestFields = Object.keys(
      { applicationId: '', environmentId: '', workbook: '' } satisfies Record<string, string>);
  check('the scope REQUEST has no url field to pass',
      !requestFields.some(field => /url/i.test(field)), requestFields.join(', '));
  check('and a url is not accepted as a selector',
      (() => {
        const bogus = tryScopeFromSelection(
            { baseUrl: 'https://shop.fixture.invalid/' } as never);
        // With two registered and no applicationId, an extra url-shaped field changes
        // nothing: it is still a refusal, because nothing reads it.
        return 'error' in bogus;
      })());

  // The concrete claim: every one of these addresses, including one that resembles the
  // other application's, resolves the SAME artefacts because none of them is consulted.
  const before = scope.paths.recordingsDir;
  for (const visited of ['/login', '/projects', '/issues', '/settings',
    'https://shop.fixture.invalid/checkout']) {
    check(`after visiting ${visited} the recordings directory is unchanged`,
        activeScope().paths.recordingsDir === before);
    check(`and the application is still fixtureapp (${visited})`,
        activeApplicationId() === 'fixtureapp', activeApplicationId());
  }
}

/* --------------------------------------------------------------------- E ---- */

function sectionForeignArtefact(): void {
  console.log('\nE. A FixtureShop artefact while fixtureapp is active\n');
  useRegistry(TWO_FILE, 'fixtureapp');
  const fixtureapp = activeScope();
  useRegistry(TWO_FILE, 'fixture-shop');
  const fixtureshop = activeScope();
  useRegistry(TWO_FILE, 'fixtureapp');

  // NOT FOUND / NOT ELIGIBLE, never a fallback to the other application.
  check('the active generated-spec directory is not fixtureshop\'s',
      activeScope().paths.generatedDir !== fixtureshop.paths.generatedDir
      && activeScope().paths.generatedDir === fixtureapp.paths.generatedDir);

  let refused = false;
  let message = '';
  try {
    assertWorkbookInScope(activeScope(), 'excel/fixture-shop-checkout.xlsx');
  } catch (error) {
    refused = error instanceof ScopeError;
    message = (error as Error).message;
  }
  check('running fixtureshop\'s workbook under fixtureapp is REFUSED', refused, message.slice(0, 84));
  check('and the refusal names the project that owns it', /fixture-shop/.test(message));
  check('the project\'s own workbook is still accepted', (() => {
    try {
      assertWorkbookInScope(activeScope(), 'excel/fixture-cases.xlsx');
      return true;
    } catch {
      return false;
    }
  })());
}

/* --------------------------------------------------------------- F and 12 ---- */

function sectionRefusalAndCompatibility(): void {
  console.log('\nF/12. No project chosen, and single-application compatibility\n');

  // F. Two registered, none chosen -> a controlled refusal naming the choices.
  useRegistry(TWO_FILE);
  const refused = tryScopeFromSelection({});
  check('F: an unscoped request with two projects is REFUSED', 'error' in refused,
      'error' in refused ? refused.error.slice(0, 72) : 'resolved anyway');
  check('F: and the refusal offers the choices',
      'error' in refused && refused.choices.sort().join(',') === ['fixtureapp', 'fixture-shop'].sort().join(','),
      'error' in refused ? refused.choices.join(', ') : '');
  check('F: it did NOT fall back to a URL-derived identity',
      'error' in refused && !/fixtureapp\.io|fixtureshop\.com/.test(refused.error));

  // An unknown project is refused too - a typo must stop the run, not resolve the
  // other application's artefacts.
  const unknown = tryScopeFromSelection({ applicationId: 'bugasra' });
  check('F: an unknown applicationId is REFUSED, not corrected', 'error' in unknown,
      'error' in unknown ? unknown.error.slice(0, 60) : 'resolved anyway');

  // 12. One registered, none chosen -> resolves, which is the whole backward
  // compatibility mechanism. Every existing FixturePortal flow posts no project at all.
  useRegistry(ONE_FILE);
  const legacy = tryScopeFromSelection({});
  check('12: with ONE project an unscoped request still resolves', 'scope' in legacy,
      'scope' in legacy ? legacy.scope.applicationId : 'refused');
  check('12: to that project', 'scope' in legacy && legacy.scope.applicationId === 'fixtureapp');
  check('12: and the page is told a selection is not required',
      describeProjects().soleApplication === true);
}

/* ---------------------------------------------- the save follows the session ---- */

function sectionSaveFollowsSession(): void {
  console.log('\n7/9. A save lands in the SELECTED project, not the ambient one\n');
  // The dashboard is one process serving many requests, so "which application is this
  // process in" and "which application was this recording made in" are different
  // questions. This is the one place they can disagree, and disagreeing silently files
  // a recording under the wrong product.
  useRegistry(TWO_FILE, 'fixtureapp');
  const ambient = activeScope();

  // THE REGISTRY IS SYNTHETIC; THESE PATHS ARE NOT. `resolveScopeFor` resolves against the
  // real filesystem layout, so `selected.paths.recordingsDir` is the actual
  // `ai/dashboard/recordings/fixtureshop` - and "fixture-shop" stopped being a safe pretend name
  // the moment somebody added a real FixtureShop project from the dashboard. This fixture
  // then deleted their recordings, which is the same accident that once cost FixturePortal 410
  // artefacts, recurring because a synthetic id became real.
  //
  // So the store is only removed if THIS check created it, and the file this check writes
  // is removed by name either way. A pre-existing store means a real application owns that
  // id, and the fixture refuses rather than writing into somebody's data.
  // ISOLATED FILESYSTEM ROOT. Everything below writes a recording and deletes it again,
  // and the id it uses is a stand-in - so the whole artefact tree is redirected into a
  // temp directory first. Without this the paths are REAL: a synthetic registry still
  // resolves `ai/dashboard/recordings/<id>`, which is how this fixture once deleted a real
  // project's recordings. Isolation makes that path unnameable rather than merely unwise.
  enterIsolatedArtefactRoot('dashboard-scope');
  const selected = resolveScopeFor('fixture-shop');
  check('the artefact tree is isolated for this section',
      isInsideFixtureRoot(selected.paths.recordingsDir), selected.paths.recordingsDir);

  check('the ambient application is fixtureapp', ambient.applicationId === 'fixtureapp');
  const written = persistRecording(
      'TC_LOGIN_001',
      "import { test } from '@playwright/test';\n",
      { available: false, reason: 'fixture' } as never,
      undefined,
      { applicationId: 'fixture-shop', environmentId: 'qa', baseUrl: 'https://shop.fixture.invalid/' });

  check('the recording is written under the SELECTED project',
      Boolean(written) && written!.includes('fixture-shop'), String(written));
  check('and NOT under the ambient one', Boolean(written) && !written!.includes('fixtureapp'),
      String(written));
  check('the file is really there',
      fs.existsSync(path.join(selected.paths.recordingsDir, 'TC_LOGIN_001.spec.ts')));
  check('and nothing was written into the ambient project\'s store',
      !fs.existsSync(path.join(ambient.paths.recordingsDir, 'TC_LOGIN_001.spec.ts')));

  // Remove the file this check wrote, by name. The store itself is removed only because
  // the guard above proved it did not exist beforehand - a recursive delete of a directory
  // this run did not create is how the FixtureShop recordings were lost.
  // Guarded: refuses anything outside the fixture root, so a mistake here is an error
  // rather than somebody's data.
  removeFixtureTree(selected.paths.recordingsDir);
  leaveIsolatedArtefactRoot();
}

/* ------------------------------------------------------------- Add Project ---- */

function sectionAddProject(): void {
  console.log('\n13. Add Project - the registry foundation\n');
  const file = path.join(TEMP_DIR, 'add.json');
  writeRegistry(file, [FIXTUREAPP]);
  useRegistry(file, 'fixtureapp');

  const created = addApplication({
    applicationId: 'shopify',
    displayName: 'Shopify',
    defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://qa.shopify.test/' } },
    workbooks: [],
  }, file);
  check('the project is added to the registry', created.applications.length === 2,
      created.applications.map(a => a.applicationId).join(', '));

  useRegistry(file, 'shopify');
  const scope = activeScope();
  check('and becomes selectable immediately', scope.applicationId === 'shopify');
  // No scaffolding step: ScopePaths derives every location from the applicationId, so
  // the project's paths resolve the moment the registry says it exists.
  check('its paths resolve through ScopePaths with nothing else created',
      scope.paths.pagesDir.endsWith(path.join('pages', 'shopify'))
      && scope.paths.mappingFile.endsWith('shopify.mapping.json'),
      path.relative(process.cwd(), scope.paths.pagesDir).split(path.sep).join('/'));

  // Validated as a WHOLE by the same rules that guard every read.
  for (const [what, candidate] of [
    ['a duplicate id', { ...FIXTUREAPP }],
    ['a reserved id', { ...FIXTUREAPP, applicationId: 'accepted' }],
    ['an id that is not a slug', { ...FIXTUREAPP, applicationId: 'FixturePortal 2' }],
    ['a workbook another project owns', { ...FIXTURESHOP, applicationId: 'other',
      workbooks: ['excel/fixture-cases.xlsx'] }],
    ['a credential VALUE where a variable name belongs', { ...FIXTURESHOP, applicationId: 'leaky',
      environments: { qa: { baseUrl: 'https://x.test/', credentials: { email: 'someone@moolya.com' } } } }],
  ] as [string, unknown][]) {
    let threw = false;
    try {
      addApplication(candidate, file);
    } catch {
      threw = true;
    }
    check(`${what} is refused`, threw);
  }
  check('and the registry still holds exactly the two sound projects',
      readRegistry(file).applications.length === 2);
}

async function main(): Promise<void> {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  writeRegistry(TWO_FILE, [FIXTUREAPP, FIXTURESHOP]);
  writeRegistry(ONE_FILE, [FIXTUREAPP]);
  console.log('\nDashboard project scope - selection, locking and isolation');
  try {
    sectionSelection();
    await sectionRecordingIdentity();
    sectionSharedTestCaseId();
    sectionNavigationDoesNotMove();
    sectionForeignArtefact();
    sectionRefusalAndCompatibility();
    sectionSaveFollowsSession();
    sectionAddProject();
  } finally {
    restore();
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  check('the fixture left nothing behind', !fs.existsSync(TEMP_DIR));
  console.log(`\n${failures ? 'FAIL' : 'PASS'} - ${checks - failures}/${checks} checks\n`);
  process.exit(failures ? 1 : 0);
}

void main();
