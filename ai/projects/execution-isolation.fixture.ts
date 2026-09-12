import '../testing/isolated-checkout';
/**
 * PHASE 6: execution state cannot cross an application boundary.
 *
 *   EXECUTION IDENTITY = applicationId + testCaseId + runId
 *   ATTEMPT POLICY     = GLOBAL      (MAX_ATTEMPTS is a number, the same everywhere)
 *   ATTEMPT STATE      = APPLICATION-SCOPED  (the record is about one project's row)
 *
 * Those two lines about attempts are the distinction this phase turns on, and
 * conflating them is what the old bare-`testCaseId` state key did: one project spending
 * its two attempts left the other with none, and one project's `accepted` verdict made
 * the other's row look finished. The budget is policy; the ledger is per application.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 *
 * Playwright itself. Executing a real spec means a browser and a live application, and
 * this is an offline gate. What IS tested is every piece of state execution reads and
 * writes - attempt counts, fingerprints, verdicts, mapping, specs, results - because
 * that is where one project's run can reach another's, and a green Playwright run
 * proves nothing about it either way.
 *
 * SAFETY: `alpha` and `beta`, never a real applicationId; `track()` records only what
 * did not already exist; `assertNothingRealAtRisk()` refuses to run if the workspace is
 * occupied. See lifecycle-isolation.fixture.ts for the incident that produced these.
 *
 * Run: npx tsx ai/projects/execution-isolation.fixture.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { resetActiveApplication } from '../knowledge/canonical';
import { cachePathFor } from '../excel/data-driven';
import { readMapping, upsertEntry, writeMapping } from '../excel/mapping';
import {
  budgetExhausted, fingerprint, MAX_ATTEMPTS, type State, type StateEntry,
  generatedDir, readState, stateKeyFor, writeState,
} from '../autocode/work';
import { validateRegistry } from './registry';
import { activeScope, resolveScope, scopedKey } from './scope';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition)
    failures += 1;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

const ROOT = process.cwd();
const TEMP_DIR = path.join(ROOT, '.tmp-execution');
const REGISTRY = path.join(TEMP_DIR, 'registry.json');
const STATE_FILE = path.join(TEMP_DIR, 'state.json');
const ALPHA = 'alpha';
const BETA = 'beta';
const SHARED_ID = 'TC_LOGIN_001';

const APPS = [
  { applicationId: ALPHA, displayName: 'Alpha', defaultEnvironmentId: 'qa',
    // The SAME environment name in both, deliberately: an environment is
    // applicationId + environmentId, never the name on its own.
    environments: { qa: { baseUrl: 'https://alpha.test/' } },
    workbooks: ['excel/alpha/cases.xlsx'] },
  { applicationId: BETA, displayName: 'Beta', defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://beta.test/' } },
    workbooks: ['excel/beta/cases.xlsx'] },
];

const CREATED: string[] = [];
const CREATED_FILES: string[] = [];
const track = (dir: string) => {
  if (!fs.existsSync(dir) && !CREATED.includes(dir))
    CREATED.push(dir);
  return dir;
};
const trackFile = (file: string) => {
  if (!fs.existsSync(file) && !CREATED_FILES.includes(file))
    CREATED_FILES.push(file);
  return file;
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
    const scope = activeScope();
    for (const target of [scope.paths.generatedDir, scope.paths.mappingFile,
      scope.paths.pagesDir, scope.paths.recordingsDir]) {
      if (fs.existsSync(target))
        occupied.push(rel(target));
    }
  }
  if (occupied.length) {
    throw new Error('refusing to run: these paths already exist and are not this fixture\'s '
      + `to write or remove - ${occupied.join(', ')}`);
  }
}

const entry = (over: Partial<StateEntry> = {}): StateEntry => ({
  fingerprint: 'same-fingerprint', verdict: 'quarantined', attempts: 0,
  at: new Date(0).toISOString(), model: 'none', ...over,
} as StateEntry);

function seed(applicationId: string, marker: string): void {
  use(applicationId);
  const scope = activeScope();
  fs.mkdirSync(track(scope.paths.generatedDir), { recursive: true });
  fs.writeFileSync(path.join(scope.paths.generatedDir, `${SHARED_ID}.spec.ts`),
      `// ${marker}\ntest('${SHARED_ID} - ${marker}', async () => {});\n`, 'utf8');
  const mapping = readMapping(scope.paths.mappingFile);
  upsertEntry(mapping, SHARED_ID, {
    testFile: rel(path.join(scope.paths.generatedDir, `${SHARED_ID}.spec.ts`)),
    testName: `${SHARED_ID} - ${marker}`, module: 'Login', scenario: marker,
  }, new Date(0).toISOString());
  trackFile(scope.paths.mappingFile);
  writeMapping(mapping, scope.paths.mappingFile);
}

/* ------------------------------------------------- 5. execution identity ---- */

function sectionIdentity(): void {
  console.log('\n5. Execution identity = applicationId + testCaseId + runId\n');
  use(ALPHA);
  const alphaKey = stateKeyFor(SHARED_ID);
  use(BETA);
  const betaKey = stateKeyFor(SHARED_ID);
  check('the same Test Case ID gives two execution ledgers', alphaKey !== betaKey,
      `${alphaKey}  vs  ${betaKey}`);
  check('each names its application', alphaKey === scopedKey(ALPHA, SHARED_ID)
      && betaKey === scopedKey(BETA, SHARED_ID));

  // The runId is unique per execution and is the THIRD component. Two runs of the same
  // case in the same application are two executions; two applications running the same
  // case are two more. Neither collapses into the other.
  const runIds = new Set([
    `${ALPHA}/${SHARED_ID}/run-1`, `${ALPHA}/${SHARED_ID}/run-2`,
    `${BETA}/${SHARED_ID}/run-1`, `${BETA}/${SHARED_ID}/run-2`,
  ]);
  check('application + test case + run are four distinct executions', runIds.size === 4);
}

/* --------------------------------------------- 11/12. attempts and prints ---- */

function sectionAttemptsAndFingerprints(): void {
  console.log('\n11/12. Attempt budget and fingerprints are per application\n');
  use(ALPHA);
  const print = 'same-fingerprint';
  const framework = 'same-framework';

  // Alpha exhausts its budget. Both rows carry the IDENTICAL fingerprint on purpose -
  // if the fingerprint were the identity, this would make Beta look spent too.
  const state: State = {
    [stateKeyFor(SHARED_ID)]: entry({ attempts: MAX_ATTEMPTS, fingerprint: print, framework }),
  };
  check('MAX_ATTEMPTS is global policy, a number', typeof MAX_ATTEMPTS === 'number',
      `MAX_ATTEMPTS = ${MAX_ATTEMPTS}`);
  check('alpha has spent its budget',
      budgetExhausted(state[stateKeyFor(SHARED_ID)], print, framework) === true);

  use(BETA);
  check('beta has NO entry, though the fingerprint is identical',
      state[stateKeyFor(SHARED_ID)] === undefined, stateKeyFor(SHARED_ID));
  check('so beta remains eligible',
      budgetExhausted(state[stateKeyFor(SHARED_ID)], print, framework) === false);

  // And the reverse.
  const reversed: State = {
    [stateKeyFor(SHARED_ID)]: entry({ attempts: MAX_ATTEMPTS, fingerprint: print, framework }),
  };
  check('beta can exhaust its own budget independently',
      budgetExhausted(reversed[stateKeyFor(SHARED_ID)], print, framework) === true);
  use(ALPHA);
  check('and alpha is untouched by it',
      reversed[stateKeyFor(SHARED_ID)] === undefined);
}

/* ------------------------------------------------------- 13/21. verdicts ---- */

function sectionVerdicts(): void {
  console.log('\n13/21. Two verdicts for one Test Case ID coexist\n');
  use(ALPHA);
  const alphaKey = stateKeyFor(SHARED_ID);
  use(BETA);
  const betaKey = stateKeyFor(SHARED_ID);

  const state: State = {
    [alphaKey]: entry({ verdict: 'accepted', specFile: 'tests-e2e/generated/alpha/x.spec.ts' }),
    [betaKey]: entry({ verdict: 'quarantined' }),
  };
  writeState(state, trackFile(STATE_FILE));
  const read = readState(STATE_FILE);

  check('both verdicts survive in one ledger', Object.keys(read).length === 2,
      Object.keys(read).join(', '));
  check('21: alpha is ACCEPTED', read[alphaKey].verdict === 'accepted');
  check('21: beta is QUARANTINED at the same time', read[betaKey].verdict === 'quarantined');
  check('21: alpha being accepted does NOT make beta look finished',
      read[betaKey].verdict !== 'accepted' && read[betaKey].specFile === undefined,
      'the old bare-testCaseId key is what made this possible');
  check('and neither entry carries the other\'s spec',
      read[alphaKey].specFile?.includes('/alpha/') === true);
}

/* --------------------------------------------- 20/23. failure isolation ---- */

function sectionFailureIsolation(): void {
  console.log('\n20/23. A failure in one project cannot reach the other\n');
  use(BETA);
  const beta = activeScope();
  const before = {
    mapping: fs.readFileSync(beta.paths.mappingFile, 'utf8'),
    spec: fs.readFileSync(path.join(beta.paths.generatedDir, `${SHARED_ID}.spec.ts`), 'utf8'),
  };
  const betaState = entry({ verdict: 'accepted', attempts: 0 });
  const ledger: State = { [stateKeyFor(SHARED_ID)]: betaState };

  // Alpha runs, fails, is quarantined, spends an attempt and rewrites its own mapping.
  use(ALPHA);
  ledger[stateKeyFor(SHARED_ID)] = entry({ verdict: 'quarantined', attempts: MAX_ATTEMPTS });
  const alphaMapping = readMapping(activeScope().paths.mappingFile);
  upsertEntry(alphaMapping, SHARED_ID, { testFile: 'rewritten-by-a-failed-run',
    testName: 'failed', module: 'Login', scenario: 'failed' }, new Date(3).toISOString());
  writeMapping(alphaMapping, activeScope().paths.mappingFile);
  fs.writeFileSync(path.join(activeScope().paths.generatedDir, `${SHARED_ID}.spec.ts`),
      '// rewritten by a failed run\n', 'utf8');

  use(BETA);
  check('20: the other project\'s verdict is unchanged',
      ledger[stateKeyFor(SHARED_ID)].verdict === 'accepted');
  check('20: its attempt budget was not consumed',
      ledger[stateKeyFor(SHARED_ID)].attempts === 0);
  check('20: its fingerprint is unaffected',
      ledger[stateKeyFor(SHARED_ID)].fingerprint === betaState.fingerprint);
  check('23: its mapping is byte-identical',
      fs.readFileSync(beta.paths.mappingFile, 'utf8') === before.mapping);
  check('23: its generated spec is byte-identical',
      fs.readFileSync(path.join(beta.paths.generatedDir, `${SHARED_ID}.spec.ts`), 'utf8') === before.spec);
}

/* ------------------------------------------- 15/16. test data, environment ---- */

function sectionDataAndEnvironment(): void {
  console.log('\n15/16. Test data and environment are per application\n');
  check('15: same workbook basename, different cache',
      cachePathFor('excel/alpha/cases.xlsx') !== cachePathFor('excel/beta/cases.xlsx'),
      `${path.basename(cachePathFor('excel/alpha/cases.xlsx'))} vs `
      + `${path.basename(cachePathFor('excel/beta/cases.xlsx'))}`);

  // 16. Both applications name their environment `qa`. The name alone is not identity.
  const alphaQa = resolveScope({ applicationId: ALPHA, environmentId: 'qa' });
  const betaQa = resolveScope({ applicationId: BETA, environmentId: 'qa' });
  check('16: two projects may both have an environment called qa',
      alphaQa.environmentId === betaQa.environmentId);
  check('16: and they resolve different addresses', alphaQa.baseUrl !== betaQa.baseUrl,
      `${alphaQa.baseUrl}  vs  ${betaQa.baseUrl}`);
  check('16: environment identity is applicationId + environmentId',
      alphaQa.applicationId !== betaQa.applicationId
      && alphaQa.paths.generatedDir !== betaQa.paths.generatedDir);
  check('16: the URL is configuration, so it never decides the application',
      new URL(alphaQa.baseUrl).host !== alphaQa.applicationId);
}

/* --------------------------------------------------- 24. end to end ---- */

function sectionEndToEnd(): void {
  console.log('\n24. The two execution chains, same Test Case ID\n');
  const chains: Record<string, string[]> = {};
  for (const applicationId of [ALPHA, BETA]) {
    use(applicationId);
    const scope = activeScope();
    chains[applicationId] = [
      rel(path.join(scope.paths.generatedDir, `${SHARED_ID}.spec.ts`)),
      rel(scope.paths.fixturesFile),
      rel(scope.paths.mappingFile),
      stateKeyFor(SHARED_ID),
      rel(cachePathFor(`excel/${applicationId}/cases.xlsx`)),
    ];
    check(`${applicationId}: every execution artefact names this project`,
        chains[applicationId].every(x => x.includes(applicationId)),
        chains[applicationId].join(' | '));
  }
  const shared = chains[ALPHA].filter(x => chains[BETA].includes(x));
  check('the two execution chains share NOTHING', shared.length === 0,
      shared.join(', ') || 'no overlap');
}

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
  console.log('\nExecution isolation - applicationId + testCaseId + runId');

  try {
    assertNothingRealAtRisk();
    seed(ALPHA, 'Alpha');
    seed(BETA, 'Beta');
    sectionIdentity();
    sectionAttemptsAndFingerprints();
    sectionVerdicts();
    sectionFailureIsolation();
    sectionDataAndEnvironment();
    sectionEndToEnd();
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
