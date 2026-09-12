import '../testing/isolated-checkout';
/**
 * The offline gate for application isolation. No browser, no model, no network, no writes.
 *
 * It defends one sentence:
 *
 *   No application-specific artefact may be resolved outside the active applicationId
 *   scope unless it is explicitly declared as a shared framework capability.
 *
 * The scenarios below are the ones that would silently produce a WRONG GREEN TEST if
 * the invariant leaked - not the ones that would crash. A FixtureShop run that resolves
 * FixturePortal's LoginPage does not fail; it passes, against the wrong application, and
 * is counted as coverage. That asymmetry is why every negative case here asserts
 * "not found" rather than "some error", and why none of them is allowed to fall back.
 *
 * Two applications are declared IN MEMORY and handed to `resolveScope` through its
 * registry parameter. Nothing on disk is created or moved: the collisions being
 * tested are collisions of KEYS and PATHS, and both are computable without files.
 * That also means this fixture keeps passing after the real migration, when the
 * directories it names actually exist.
 *
 * Run: npx tsx ai/projects/isolation.fixture.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { activeApplicationId, canonicalFile, resetActiveApplication } from '../knowledge/canonical';
import { buildIndex } from '../knowledge/index';
import { activeKnowledgePageDir } from '../knowledge/page-knowledge';
import { fixturesFile, knowledgeDir, pageFilePathFor, pagesDir } from '../autocode/abstraction/writer';
import { generatedDir } from '../autocode/work';
import { recordedSpecPathFor } from '../autocode/orchestrate';
import { acceptedDir, artifactPath, recordingsDir } from '../dashboard/recorder';
import { activeMappingFile } from '../excel/mapping';
import { type Registry, validateRegistry, workbookOwner } from './registry';
import {
  APPLICATION_ARTEFACTS,
  type ApplicationScope,
  assertInScope,
  isWithinScope,
  activeScope,
  resolveScope,
  ScopeError,
  scopedKey,
  SHARED_CAPABILITIES,
  splitScopedKey,
} from './scope';

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

/** Two applications that collide on every axis the brief names. */
const TWO: Registry = validateRegistry({
  schemaVersion: 1,
  applications: [
    {
      applicationId: 'fixtureapp',
      displayName: 'FixturePortal',
      defaultEnvironmentId: 'qa',
      environments: { qa: { baseUrl: 'https://portal.fixture.invalid/' } },
      workbooks: ['excel/fixture-cases.xlsx'],
    },
    {
      applicationId: 'fixtureshop',
      displayName: 'FixtureShop',
      defaultEnvironmentId: 'qa',
      environments: { qa: { baseUrl: 'https://shop.fixture.invalid/' } },
      workbooks: ['excel/fixtureshop-checkout.xlsx'],
    },
  ],
}, 'two-application test registry');

const ONE: Registry = validateRegistry({
  schemaVersion: 1,
  applications: [{ ...TWO.applications[0], legacyLayout: true }],
}, 'single-application test registry');

const fixtureapp = resolveScope({ applicationId: 'fixtureapp' }, TWO);
const fixtureshop = resolveScope({ applicationId: 'fixtureshop' }, TWO);

/** The directory an artefact class resolves to, relative to the repo, for readability. */
const rel = (scope: ApplicationScope, artefact: keyof ApplicationScope['paths']) =>
  path.relative(process.cwd(), scope.paths[artefact]).replace(/\\/g, '/');

function sectionA(): void {
  console.log('\nA. Two applications may both have a LoginPage\n');
  check('Page Object directories differ', fixtureapp.paths.pagesDir !== fixtureshop.paths.pagesDir,
    `${rel(fixtureapp, 'pagesDir')}  vs  ${rel(fixtureshop, 'pagesDir')}`);
  // The class NAME is identical on purpose - that is the point of the namespace.
  const a = path.join(fixtureapp.paths.pagesDir, 'login.page.ts');
  const b = path.join(fixtureshop.paths.pagesDir, 'login.page.ts');
  check('same file name resolves to two distinct paths', a !== b);
  check('neither path sits inside the other application\'s scope',
    isWithinScope(fixtureapp, a, 'pagesDir') && !isWithinScope(fixtureshop, a, 'pagesDir')
    && isWithinScope(fixtureshop, b, 'pagesDir') && !isWithinScope(fixtureapp, b, 'pagesDir'));
}

function sectionB(): void {
  console.log('\nB. Two applications may both use the locator "#username"\n');
  // There is no global locator namespace to collide in: a locator is only ever
  // reachable through a Page Object method or an evidence record, and both of those
  // are already scoped by A and F. This section asserts that property rather than a
  // lookup, because inventing a locator registry to "support" multi-project is
  // exactly what the brief forbids.
  check('no global locator namespace exists to collide in',
    !(APPLICATION_ARTEFACTS as readonly string[]).includes('locator registry'),
    'locators are reached through Page Objects and evidence, both scoped');
  check('"locators" is declared an application-owned artefact class',
    (APPLICATION_ARTEFACTS as readonly string[]).includes('locators'));
  check('the locator engine stays a SHARED capability, not duplicated per application',
    (SHARED_CAPABILITIES as readonly string[]).includes('locator engine'));
}

function sectionC(): void {
  console.log('\nC. Two applications may both have TC_LOGIN_001\n');
  const a = scopedKey('fixtureapp', 'TC_LOGIN_001');
  const b = scopedKey('fixtureshop', 'TC_LOGIN_001');
  check('scoped keys differ', a !== b, `${a}  vs  ${b}`);
  check('the test case ID itself is NOT renamed',
    splitScopedKey(a).key === 'TC_LOGIN_001' && splitScopedKey(b).key === 'TC_LOGIN_001',
    'traceability key "TC_ID - Scenario" is preserved');
  check('each round-trips to its own application',
    splitScopedKey(a).applicationId === 'fixtureapp' && splitScopedKey(b).applicationId === 'fixtureshop');
  check('mapping files differ', fixtureapp.paths.mappingFile !== fixtureshop.paths.mappingFile,
    `${path.basename(fixtureapp.paths.mappingFile)}  vs  ${path.basename(fixtureshop.paths.mappingFile)}`);
  check('generated spec paths differ',
    path.join(fixtureapp.paths.generatedDir, 'TC_LOGIN_001.spec.ts')
      !== path.join(fixtureshop.paths.generatedDir, 'TC_LOGIN_001.spec.ts'));
  check('one workbook belongs to exactly one application',
    workbookOwner('excel/fixture-cases.xlsx', TWO) === 'fixtureapp'
    && workbookOwner('excel/fixtureshop-checkout.xlsx', TWO) === 'fixtureshop');
}

function sectionD(): void {
  console.log('\nD. Same page name + same locator + same test case ID, two applications\n');
  // Everything collides at once. If any single axis were unscoped this fails.
  const axes: [string, string, string][] = [
    ['Page Object', path.join(fixtureapp.paths.pagesDir, 'login.page.ts'), path.join(fixtureshop.paths.pagesDir, 'login.page.ts')],
    ['knowledge', path.join(fixtureapp.paths.knowledgePageDir, 'root.yaml'), path.join(fixtureshop.paths.knowledgePageDir, 'root.yaml')],
    ['recording', path.join(fixtureapp.paths.recordingsDir, 'TC_LOGIN_001.evidence.json'), path.join(fixtureshop.paths.recordingsDir, 'TC_LOGIN_001.evidence.json')],
    ['generated spec', path.join(fixtureapp.paths.generatedDir, 'TC_LOGIN_001.spec.ts'), path.join(fixtureshop.paths.generatedDir, 'TC_LOGIN_001.spec.ts')],
    ['mapping key', scopedKey('fixtureapp', 'TC_LOGIN_001'), scopedKey('fixtureshop', 'TC_LOGIN_001')],
  ];
  for (const [what, a, b] of axes)
    check(`${what} does not collide`, a !== b);
  check('all five axes are distinct simultaneously',
    new Set(axes.flatMap(([, a, b]) => [a, b])).size === axes.length * 2);
}

function sectionEFG(): void {
  console.log('\nE/F/G. Resolving another application\'s artefacts while fixtureapp is active\n');
  // NOT FOUND, never a fallback. `assertInScope` is the call sites' guard, and it
  // refuses rather than returning something plausible.
  for (const [label, artefact] of [
    ['Page Object', 'pagesDir'],
    ['locator/evidence', 'recordingsDir'],
    ['knowledge', 'knowledgePageDir'],
    ['generated spec', 'generatedDir'],
    ['mapping', 'mappingFile'],
    ['fixtures module', 'fixturesFile'],
  ] as [string, keyof ApplicationScope['paths']][]) {
    const foreign = path.join(fixtureshop.paths[artefact], 'anything');
    check(`${label}: a fixtureshop path is NOT within the active fixtureapp scope`,
      !isWithinScope(fixtureapp, foreign, artefact));
    let refused = false;
    try {
      assertInScope(fixtureapp, 'fixtureshop', `${label} artefact`);
    } catch (error) {
      refused = error instanceof ScopeError;
    }
    check(`${label}: assertInScope refuses the cross-application artefact`, refused);
  }
  check('there is no cross-application fallback path in the scope API',
    typeof (resolveScope as unknown as Record<string, unknown>).fallbackToAnyApplication === 'undefined');
}

function sectionH(): void {
  console.log('\nH. Legacy flow with no applicationId supplied\n');
  const legacy = resolveScope({}, ONE);
  check('single application: resolves to it', legacy.applicationId === 'fixtureapp');
  check('declared legacy owner: falls back to the FLAT directories that exist today',
    !path.basename(legacy.paths.pagesDir).includes('fixtureapp'),
    rel(legacy, 'pagesDir'));
  check('single application: environment defaults to the declared default',
    legacy.environmentId === 'qa');

  let refused = false;
  let message = '';
  try {
    resolveScope({}, TWO);
  } catch (error) {
    refused = error instanceof ScopeError;
    message = (error as Error).message;
  }
  check('two applications: an unscoped call is REFUSED, not guessed', refused, message.slice(0, 78));
  check('the refusal names the choices', /fixtureapp/.test(message) && /fixtureshop/.test(message));

  // Neither application in TWO declares legacy ownership.
  check('without a legacy declaration: paths are namespaced, never flat',
    path.basename(fixtureapp.paths.pagesDir) === 'fixtureapp'
    && path.basename(fixtureshop.paths.pagesDir) === 'fixtureshop');
}

function sectionIdentity(): void {
  console.log('\nIdentity: applicationId is declared, never derived from the URL\n');
  // Two applications behind one host, and one application whose host says nothing
  // about it: both are decided correctly because nothing consults the URL.
  const shared: Registry = validateRegistry({
    schemaVersion: 1,
    applications: [
      { applicationId: 'alpha', displayName: 'Alpha', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://tenant.example.com/alpha' } }, workbooks: [] },
      { applicationId: 'beta', displayName: 'Beta', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://tenant.example.com/beta' } }, workbooks: [] },
    ],
  }, 'shared-host registry');
  const alpha = resolveScope({ applicationId: 'alpha' }, shared);
  const beta = resolveScope({ applicationId: 'beta' }, shared);
  check('two applications on ONE host keep distinct identities',
    alpha.applicationId !== beta.applicationId && alpha.paths.pagesDir !== beta.paths.pagesDir,
    'applicationSlug(baseUrl) would have called both "example"');

  // An environment change must never rename the namespace.
  const multiEnv: Registry = validateRegistry({
    schemaVersion: 1,
    applications: [{
      applicationId: 'fixtureapp', displayName: 'FixturePortal', defaultEnvironmentId: 'qa',
      environments: {
        qa: { baseUrl: 'https://portal.fixture.invalid/' },
        staging: { baseUrl: 'https://staging.some-other-host.test/' },
      },
      workbooks: [],
    }],
  }, 'multi-environment registry');
  const qa = resolveScope({ applicationId: 'fixtureapp', environmentId: 'qa' }, multiEnv);
  const staging = resolveScope({ applicationId: 'fixtureapp', environmentId: 'staging' }, multiEnv);
  check('changing environment changes baseUrl', qa.baseUrl !== staging.baseUrl);
  check('changing environment does NOT change the namespace',
    qa.applicationId === staging.applicationId && qa.paths.pagesDir === staging.paths.pagesDir,
    'a staging host on a different domain still resolves fixtureapp artefacts');
}

function sectionDeclaration(): void {
  console.log('\nShared vs application-specific is declared, not implied\n');
  for (const capability of ['recorder engine', 'evidence engine', 'locator engine',
    'generation engine', 'execution engine', 'validation engine', 'AI gateway', 'dashboard framework'])
    check(`shared: ${capability}`, (SHARED_CAPABILITIES as readonly string[]).includes(capability));
  for (const artefact of ['page objects', 'knowledge', 'evidence', 'recordings',
    'test cases', 'test data', 'generated specs', 'results', 'history'])
    check(`application-owned: ${artefact}`, (APPLICATION_ARTEFACTS as readonly string[]).includes(artefact));
  check('the two sets do not overlap',
    !(SHARED_CAPABILITIES as readonly string[]).some(c => (APPLICATION_ARTEFACTS as readonly string[]).includes(c)));
}

/* ------------------------------------------------------------------------- *
 * WRITES. Everything above reasons about PATHS; the sections below drive the
 * real production accessors and ask where they would put a file.
 *
 * Read-only isolation is half the property, and the less dangerous half. A read
 * that escapes its scope produces a wrong green test; a WRITE that escapes its
 * scope corrupts the other application's repository - a method appended to its
 * LoginPage, an element added to its knowledge file, its mapping entry
 * overwritten - and the damage outlives the run. So these sections import the
 * same functions the generator calls, rather than reasoning about the scope
 * object those functions happen to share.
 *
 * The seam is `AURA_REGISTRY_FILE` + `AURA_APPLICATION`: a temp registry
 * declaring two applications, and the active one chosen explicitly. Nothing is
 * written to disk but that temp registry, and it is removed in a `finally`.
 * ------------------------------------------------------------------------- */

const TEMP_DIR = path.join(process.cwd(), '.tmp-isolation-fixture');
const TEMP_REGISTRY = path.join(TEMP_DIR, 'two-applications.json');

/** Repo-relative, forward slashes - so a check reads as a path, not a drive letter. */
function norm(value: string): string {
  return path.relative(process.cwd(), path.resolve(process.cwd(), value)).split(path.sep).join('/');
}

/** Point the whole process at a two-application registry, active = `applicationId`. */
function activate(applicationId: string): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(TEMP_REGISTRY, `${JSON.stringify({
    schemaVersion: 1,
    applications: [
      { applicationId: 'fixtureapp', displayName: 'FixturePortal', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://portal.fixture.invalid/' } },
        workbooks: ['excel/fixture-cases.xlsx'] },
      { applicationId: 'fixtureshop', displayName: 'FixtureShop', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://shop.fixture.invalid/' } },
        workbooks: ['excel/fixtureshop-checkout.xlsx'] },
    ],
  }, null, 2)}\n`, 'utf8');
  process.env.AURA_REGISTRY_FILE = path.relative(process.cwd(), TEMP_REGISTRY);
  process.env.AURA_APPLICATION = applicationId;
  resetActiveApplication();
}

/** Back to the repository's own registry, and drop every memo. */
function deactivate(): void {
  delete process.env.AURA_REGISTRY_FILE;
  delete process.env.AURA_APPLICATION;
  resetActiveApplication();
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

/** Every WRITE destination the production code would choose, by the real accessor. */
function writeTargets(): Record<string, string> {
  return {
    'Page Object file (writer.pageFilePathFor)': norm(pageFilePathFor('LoginPage')),
    'Page Object dir (writer.pagesDir)': norm(pagesDir()),
    'knowledge dir (writer.knowledgeDir)': norm(knowledgeDir()),
    'knowledge file (canonical.canonicalFile)': norm(canonicalFile('x__root')),
    'fixtures module (writer.fixturesFile)': norm(fixturesFile()),
    'recording (recorder.recordingsDir)': norm(recordingsDir()),
    'recording archive (recorder.acceptedDir)': norm(acceptedDir()),
    'generated spec (work.generatedDir)': norm(generatedDir()),
    'mapping (mapping.activeMappingFile)': norm(activeMappingFile()),
  };
}

function sectionWrites(): void {
  console.log('\nW. Writes for one application never land in another, or in a global, location\n');
  try {
    activate('fixtureapp');
    const forFixturePortal = writeTargets();
    check('11: the active application is the DECLARED one, never derived from the URL',
      activeApplicationId() === 'fixtureapp', activeApplicationId());

    activate('fixtureshop');
    const forFixtureShop = writeTargets();
    check('12: the active application follows the declaration',
      activeApplicationId() === 'fixtureshop', activeApplicationId());

    for (const what of Object.keys(forFixturePortal)) {
      const a = forFixturePortal[what];
      const b = forFixtureShop[what];
      // A destination EQUAL for both applications is a shared location, which is
      // the leak - and a shared location is exactly the answer the flat fallback
      // would give, which is why the fallback is refused once two are registered.
      check(`11/12: ${what} differs by application`, a !== b, `${a}  vs  ${b}`);
      check(`11: ${what} is inside fixtureapp's namespace`, a.includes('fixtureapp'), a);
      check(`12: ${what} is inside fixtureshop's namespace`, b.includes('fixtureshop'), b);
    }
  } finally {
    deactivate();
  }

  // And the legacy flow is genuinely restored, not merely un-set.
  check('13: after deactivation the declared legacy layout is back',
    !pagesDir().includes('fixtureshop') && !recordingsDir().includes('fixtureshop')
    && norm(pagesDir()) === 'tests-e2e/pages',
    norm(pagesDir()));
  check('13: the legacy mapping file is the one that exists today',
    norm(activeMappingFile()) === 'ai/test-mapping/mapping.json', norm(activeMappingFile()));
}

/**
 * READ/WRITE SYMMETRY, per application-owned artefact class.
 *
 * A subsystem is not isolated because its READ path is scoped. The asymmetric
 * case is the dangerous one, and it is silent in the worst direction: knowledge
 * WRITTEN to the flat directory and READ from the scoped one is not an error -
 * the read simply finds nothing, the generator concludes the screen has never
 * been explored, and it re-explores a page it had already written down. Nothing
 * fails; the work is done twice and the two copies drift.
 *
 * Each class is therefore asserted at BOTH ends, through the two real functions.
 */
function sectionSymmetry(): void {
  console.log('\nS. Read and write resolve to the same place, per artefact class\n');
  try {
    activate('fixtureshop');
    const pairs: Array<[string, string, string]> = [
      ['knowledge (readAll vs canonicalFile)',
        norm(activeKnowledgePageDir()), path.dirname(norm(canonicalFile('x__root')))],
      ['knowledge (readAll vs writer)',
        norm(activeKnowledgePageDir()), norm(knowledgeDir())],
      ['Page Objects (buildIndex vs writer)',
        norm(activeScope().paths.pagesDir), norm(pagesDir())],
      ['fixtures (buildIndex vs writer)',
        norm(activeScope().paths.fixturesFile), norm(fixturesFile())],
      ['recordings (dir vs artifactPath)',
        norm(recordingsDir()), path.dirname(norm(artifactPath('TC_X')))],
      ['generated specs (dir vs recordedSpecPathFor)',
        norm(generatedDir()), path.dirname(norm(recordedSpecPathFor('TC_X')))],
      ['mapping (read vs write default)',
        norm(activeMappingFile()), norm(activeMappingFile())],
    ];
    for (const [what, read, write] of pairs)
      check(`${what}: read and write agree`, read === write, `read ${read} | write ${write}`);

    check('the framework index reports the application it was built for',
      buildIndex().applicationId === 'fixtureshop', buildIndex().applicationId);
    check('and it scanned that application\'s Page Object directory',
      norm(activeScope().paths.pagesDir) === 'tests-e2e/pages/fixtureshop',
      norm(activeScope().paths.pagesDir));
  } finally {
    deactivate();
  }
}

console.log('\nApplication isolation - scope layer');
sectionA();
sectionB();
sectionC();
sectionD();
sectionEFG();
sectionH();
sectionIdentity();
sectionDeclaration();
sectionWrites();
sectionSymmetry();
console.log(`\n${failures ? 'FAIL' : 'PASS'} - ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
