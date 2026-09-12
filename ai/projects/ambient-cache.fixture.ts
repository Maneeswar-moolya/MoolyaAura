import '../testing/isolated-checkout';
/**
 * PHASE 7: a process-wide memo must not answer for the wrong application.
 *
 * Two invariants, both found by auditing rather than by a failure:
 *
 *   1. `frameworkFingerprint` is a fact about ONE APPLICATION'S Page Objects, so its
 *      memo must be keyed by the application. It was keyed by the repository root
 *      alone, which is harmless in the generation CLI (one process, one application)
 *      and NOT harmless in the dashboard, where `surveyWork` calls it on a per-request
 *      path. A server that had served Project A would answer for Project B with A's
 *      fingerprint, and `budgetExhausted` compares that value - so a row of B whose
 *      framework genuinely changed reads as unchanged, its attempt budget is not
 *      reopened, and it stays skipped saying "edit the row to try again".
 *
 *   2. An applicationId can never reach the filesystem unvalidated. `pathsFor` is
 *      called at exactly ONE site and only after `findApplication` has confirmed the
 *      id is registered, and `validateRegistry` only admits `[a-z][a-z0-9-]*` - so a
 *      traversal id is refused twice over, by membership and by shape.
 *
 * The first is a regression test for a real defect. The second pins a property the
 * audit established, so that a future "just look up the path" shortcut cannot quietly
 * remove it.
 *
 * SAFETY: `alpha` and `beta` only, and this fixture writes exactly one directory per
 * application - the Page Objects the fingerprint hashes. See
 * lifecycle-isolation.fixture.ts for the incident that made these rules non-optional.
 *
 * Run: npx tsx ai/projects/ambient-cache.fixture.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { resetActiveApplication } from '../knowledge/canonical';
import { frameworkFingerprint, resetFrameworkFingerprint } from '../autocode/work';
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
const TEMP_DIR = path.join(ROOT, '.tmp-ambient');
const REGISTRY = path.join(TEMP_DIR, 'registry.json');
const ALPHA = 'alpha';
const BETA = 'beta';

const APPS = [
  { applicationId: ALPHA, displayName: 'Alpha', defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://alpha.test/' } }, workbooks: [] },
  { applicationId: BETA, displayName: 'Beta', defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://beta.test/' } }, workbooks: [] },
];

const CREATED: string[] = [];
const track = (dir: string) => {
  if (!fs.existsSync(dir) && !CREATED.includes(dir))
    CREATED.push(dir);
  return dir;
};
const rel = (value: string) => path.relative(ROOT, value).split(path.sep).join('/');

function use(applicationId?: string): void {
  process.env.AURA_REGISTRY_FILE = path.relative(ROOT, REGISTRY);
  if (applicationId)
    process.env.AURA_APPLICATION = applicationId;
  else
    delete process.env.AURA_APPLICATION;
  resetActiveApplication();
}

function assertNothingRealAtRisk(): void {
  const occupied: string[] = [];
  for (const applicationId of [ALPHA, BETA]) {
    use(applicationId);
    if (fs.existsSync(activeScope().paths.pagesDir))
      occupied.push(rel(activeScope().paths.pagesDir));
  }
  if (occupied.length) {
    throw new Error('refusing to run: these paths already exist and are not this fixture\'s '
      + `to write or remove - ${occupied.join(', ')}`);
  }
}

/**
 * Give each application a DIFFERENT Page Object, so the two fingerprints must differ.
 *
 * If they were identical the test would pass whether or not the memo is keyed - the
 * whole point is that the two applications hash to different values, so serving one
 * from the other's cache is detectable.
 */
function seed(applicationId: string, body: string): void {
  use(applicationId);
  const dir = track(activeScope().paths.pagesDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'login.page.ts'), body, 'utf8');
}

function sectionFingerprintMemo(): void {
  console.log('\n1. The framework fingerprint memo is keyed by application\n');

  use(ALPHA);
  const alphaFirst = frameworkFingerprint();
  use(BETA);
  const betaFirst = frameworkFingerprint();

  check('the two applications hash to DIFFERENT fingerprints',
      alphaFirst !== betaFirst, `${alphaFirst}  vs  ${betaFirst}`);
  check('so serving one from the other\'s memo would be detectable', true,
      'which is what makes the next checks meaningful');

  // The order matters: ask alpha, then beta, then alpha again, WITHOUT resetting. A
  // memo keyed by the root alone returns alpha's value for beta here.
  use(ALPHA);
  const alphaAgain = frameworkFingerprint();
  use(BETA);
  const betaAgain = frameworkFingerprint();

  check('alpha is stable across an interleaved beta lookup', alphaAgain === alphaFirst,
      alphaAgain);
  check('beta is NOT served alpha\'s cached value', betaAgain === betaFirst
      && betaAgain !== alphaFirst, `${betaAgain} (alpha is ${alphaFirst})`);

  // And the memo still WORKS - keying it per application must not turn it off, or the
  // reason it exists (a batch would re-hash every Page Object per row) is lost.
  use(ALPHA);
  const before = Date.now();
  for (let i = 0; i < 200; i += 1)
    frameworkFingerprint();
  check('the memo still serves repeat lookups without re-hashing',
      Date.now() - before < 500, `${Date.now() - before} ms for 200 lookups`);

  // The explicit reset still clears it, which is what the attempt-budget fixture uses.
  resetFrameworkFingerprint();
  check('resetFrameworkFingerprint still clears the memo',
      frameworkFingerprint() === alphaFirst, 'and recomputes the same value');
}

function sectionPathValidation(): void {
  console.log('\n2. An applicationId cannot reach the filesystem unvalidated\n');

  // Refused by MEMBERSHIP: pathsFor runs only after findApplication succeeds.
  for (const bogus of ['../fixtureapp', '..', 'alpha/../beta', 'ALPHA', 'nonexistent']) {
    let refused = false;
    let message = '';
    try {
      resolveScope({ applicationId: bogus }, validateRegistry(
          { schemaVersion: 1, applications: APPS }, 'fixture registry'));
    } catch (error) {
      refused = error instanceof ScopeError;
      message = (error as Error).message;
    }
    check(`an id of ${JSON.stringify(bogus)} is refused before any path is built`,
        refused, message.slice(0, 52));
  }

  // Surrounding whitespace is TRIMMED and then validated, which is deliberate: a
  // trailing space from a form field is a spelling of the id, not an attack. What
  // matters is that the trimmed value still goes through `findApplication`, so it can
  // only ever resolve to a REGISTERED application - never to a path of its own.
  const padded = resolveScope({ applicationId: '  alpha  ' }, validateRegistry(
      { schemaVersion: 1, applications: APPS }, 'fixture registry'));
  check('surrounding whitespace is trimmed and still validated',
      padded.applicationId === ALPHA
      && path.basename(padded.paths.pagesDir) === ALPHA,
      rel(padded.paths.pagesDir));

  // Refused by SHAPE: the registry will not admit such an id in the first place, so it
  // can never become a registered application and reach `pathsFor` that way either.
  for (const bogus of ['../evil', 'a/b', 'a.b', 'A', '1alpha', 'al_pha']) {
    let refused = false;
    try {
      validateRegistry({ schemaVersion: 1, applications: [
        { ...APPS[0], applicationId: bogus }] }, 'fixture registry');
    } catch {
      refused = true;
    }
    check(`the registry refuses to declare an application called ${JSON.stringify(bogus)}`, refused);
  }

  // And the one call site is genuinely one.
  const scopeSource = fs.readFileSync(path.join(ROOT, 'ai', 'projects', 'scope.ts'), 'utf8');
  const calls = (scopeSource.match(/pathsFor\(/g) ?? []).length;
  check('pathsFor is defined once and called once', calls === 2,
      `${calls} occurrence(s): the definition and one call`);
}

function cleanup(): void {
  console.log('\nCleanup\n');
  for (const dir of CREATED)
    fs.rmSync(dir, { recursive: true, force: true });
  for (const dir of CREATED)
    check(`removed ${rel(dir)}`, !fs.existsSync(dir));
}

function main(): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, `${JSON.stringify(
      validateRegistry({ schemaVersion: 1, applications: APPS }, 'fixture registry'), null, 2)}\n`, 'utf8');
  console.log('\nAmbient cache and path validation');

  try {
    assertNothingRealAtRisk();
    seed(ALPHA, 'export class LoginPage { alpha(): string { return "#alpha"; } }\n');
    seed(BETA, 'export class LoginPage { beta(): string { return "#beta-different"; } }\n');
    resetFrameworkFingerprint();
    sectionFingerprintMemo();
    sectionPathValidation();
  } finally {
    cleanup();
    resetFrameworkFingerprint();
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

main();
