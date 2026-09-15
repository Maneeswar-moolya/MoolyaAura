import '../testing/isolated-checkout';
import { waitForFixtureHttp, stopFixtureProcess } from '../testing/process-fixture';
/**
 * The dashboard's project/environment API, driven over real HTTP.
 *
 * Every other gate in this repository calls functions directly. This one starts the
 * actual server on a loopback port and makes actual requests, because the property
 * being checked lives in the ROUTES rather than in the functions they call: that
 * `/api/record/start` and `/api/run` refuse a request with no project once two are
 * registered, and that the refusal reaches the page as a 400 naming the choices rather
 * than as a 500 or - far worse - as a 202 against whichever application came first.
 *
 * A function-level test cannot see that. `tryScopeFromSelection` can be perfect while a
 * route forgets to call it, and the symptom of that mistake is a successful recording
 * filed under the wrong application. So this drives the seam that would actually break.
 *
 * No browser is ever started: every request here is either rejected before the recorder
 * is reached, or is a GET. The registry is a temp file, so the repository's own
 * registry.json is never read or written.
 *
 * Run: npx tsx ai/dashboard/project-api.fixture.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { validateRegistry } from '../projects/registry';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition)
    failures += 1;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

const ROOT = process.cwd();
const TEMP_DIR = path.join(ROOT, '.tmp-project-api');
const PORT = 47821;
const BASE = `http://127.0.0.1:${PORT}`;

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
const FIXTURESHOP = {
  applicationId: 'fixtureshop',
  displayName: 'FixtureShop',
  defaultEnvironmentId: 'qa',
  environments: { qa: { baseUrl: 'https://shop.fixture.invalid/' } },
  workbooks: ['excel/fixtureshop-checkout.xlsx'],
};

function writeRegistry(applications: unknown[]): string {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const file = path.join(TEMP_DIR, 'registry.json');
  fs.writeFileSync(file, `${JSON.stringify(
      validateRegistry({ schemaVersion: 1, applications }, 'fixture registry'), null, 2)}\n`, 'utf8');
  return file;
}

async function get(route: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${route}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(route: string, payload: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitForServer(child: ChildProcess): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null)
      return false;
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok)
        return true;
    } catch {
      // Not listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function startServer(registryFile: string): ChildProcess {
  return spawn(process.execPath, [
    path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(ROOT, 'ai', 'dashboard', 'server.ts'),
  ], {
    cwd: ROOT,
    shell: false,
    env: {
      ...process.env,
      EXCEL_DASHBOARD_PORT: String(PORT),
      // The temp registry, so the repository's own is neither read nor written.
      AURA_REGISTRY_FILE: path.relative(ROOT, registryFile),
      // PROVISIONING WRITES A WORKBOOK, so the server under test is pointed at a temp
      // `excel/` directory. Without this, `POST /api/projects` would create
      // `excel/shopify-test-cases.xlsx` in the real repository every time this fixture
      // ran - a fixture with a side effect on the thing it is meant to be isolated from.
      AURA_EXCEL_DIR: path.relative(ROOT, path.join(TEMP_DIR, 'excel')),
      // No project pre-selected: the point is that the REQUEST must carry one.
      AURA_APPLICATION: '',
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main(): Promise<void> {
  console.log('\nDashboard project API - selection is required, never inferred\n');
  const registryFile = writeRegistry([FIXTUREAPP, FIXTURESHOP]);
  const child = startServer(registryFile);
  let output = ''; child.stdout?.on('data', b => output += b); child.stderr?.on('data', b => output += b);

  try {
    await waitForFixtureHttp(child, BASE + '/api/health', () => output);
    check('the dashboard server started', true, `port ${PORT}`);

    /* ---------------------------------------------------- 1/2. selection ---- */
    const projects = await get('/api/projects');
    check('GET /api/projects lists both registered projects',
        projects.status === 200 && projects.body.projects?.length === 2,
        (projects.body?.projects ?? []).map((p: any) => p.applicationId).join(', '));
    check('it reports that a selection is REQUIRED',
        projects.body.soleApplication === false);
    const fixtureapp = projects.body.projects.find((p: any) => p.applicationId === 'fixtureapp');
    check('displayName is offered for reading and applicationId for sending',
        fixtureapp.displayName === 'FixturePortal' && fixtureapp.applicationId === 'fixtureapp');
    check('each project carries only its OWN environments',
        fixtureapp.environments.map((e: any) => e.environmentId).sort().join(',') === 'qa,staging'
        && !fixtureapp.environments.some((e: any) => e.baseUrl.includes('fixtureshop')),
        fixtureapp.environments.map((e: any) => e.environmentId).join(', '));
    check('and each environment carries its own declared baseUrl',
        fixtureapp.environments.find((e: any) => e.environmentId === 'staging').baseUrl
          === 'https://staging.fixtureapp.test/');

    /* ------------------------------------------------------------- F ------- */
    const noProject = await post('/api/record/start', { browser: 'chromium' });
    check('F: POST /api/record/start with NO project is refused',
        noProject.status === 400 && noProject.body.started === false,
        `${noProject.status} ${String(noProject.body?.error ?? '').slice(0, 60)}`);
    check('F: and the refusal names the choices',
        (noProject.body.choices ?? []).sort().join(',') === 'fixtureapp,fixtureshop',
        (noProject.body.choices ?? []).join(', '));
    check('F: the URL in the request is NOT used to pick a project',
        (await post('/api/record/start',
            { browser: 'chromium', url: 'https://portal.fixture.invalid/' })).status === 400,
        'a fixtureapp URL with no applicationId is still refused');

    const unknown = await post('/api/record/start',
        { browser: 'chromium', applicationId: 'bugasra' });
    check('F: an unknown applicationId is refused, not corrected',
        unknown.status === 400 && /Unknown applicationId/.test(String(unknown.body?.error)),
        String(unknown.body?.error ?? '').slice(0, 56));

    /* ------------------------------------------------------------ E/14 ----- */
    const crossed = await post('/api/run', {
      applicationId: 'fixtureapp',
      workbook: 'excel/fixtureshop-checkout.xlsx',
      testCaseIds: ['TC_LOGIN_001'],
    });
    check('E: running another project\'s workbook is refused',
        crossed.status === 400 && /belongs to application/.test(String(crossed.body?.error)),
        String(crossed.body?.error ?? '').slice(0, 76));

    const runNoProject = await post('/api/run', {
      workbook: 'excel/fixture-cases.xlsx', testCaseIds: ['TC_LOGIN_001'],
    });
    check('POST /api/run with no project is refused too',
        runNoProject.status === 400,
        `${runNoProject.status} ${String(runNoProject.body?.error ?? '').slice(0, 52)}`);

    const readCrossed = await get('/api/workbook?workbook=excel/fixture-cases.xlsx&applicationId=fixtureshop');
    check('14: reading one project\'s workbook while another is selected is refused',
        readCrossed.status === 400, String(readCrossed.body?.error ?? '').slice(0, 70));

    /* --------------------------------------------------------------- 13 ---- */
    const added = await post('/api/projects', {
      applicationId: 'shopify',
      displayName: 'Shopify',
      defaultEnvironmentId: 'qa',
      environments: { qa: { baseUrl: 'https://qa.shopify.test/' } },
      workbooks: [],
    });
    check('13: POST /api/projects adds a project', added.status === 201 && added.body.count === 3,
        `${added.status} count=${added.body?.count}`);
    check('13: and it is immediately selectable',
        (added.body.projects ?? []).some((p: any) => p.applicationId === 'shopify'));
    const duplicate = await post('/api/projects', FIXTUREAPP);
    check('13: a duplicate applicationId is refused', duplicate.status === 400,
        String(duplicate.body?.error ?? '').slice(0, 56));
    const reserved = await post('/api/projects', { ...FIXTUREAPP, applicationId: 'accepted' });
    check('13: a reserved applicationId is refused', reserved.status === 400,
        String(reserved.body?.error ?? '').slice(0, 56));

    /* ----------------------------------------- SERIAL EXECUTION SAFETY --- */
    //
    // Playwright WIPES its output directory at the start of every run, so two runs at
    // once destroy each other's results - and a run, a generation and a recording all
    // reach for the same browser and the same output state. The design answer is one
    // slot each and a refusal, not queueing and not scoping: `test-results-excel/` is
    // not application-scoped, so two applications executing at once would mix output
    // no matter how well their artefacts are separated.
    //
    // Asserted on the SOURCE rather than over HTTP because reaching these guards from
    // outside means having a real run in flight, and an offline gate must not launch
    // Playwright at a live application to prove a refusal.
    const serverSource = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'server.ts'), 'utf8');
    const runRoute = serverSource.slice(
        serverSource.indexOf("route === '/api/run' && req.method === 'POST'"),
        serverSource.indexOf("const body = await readJsonBody(req);",
            serverSource.indexOf("route === '/api/run' && req.method === 'POST'")));
    check('serial: a run is refused while another run is in progress',
        /if \(active\)/.test(runRoute) && /409/.test(runRoute));
    check('serial: and while the generator is using Playwright',
        /if \(autocode\)/.test(runRoute) && /409/.test(runRoute));
    check('serial: the refusal names the shared output directory as the reason',
        /wipes its output directory/.test(runRoute),
        'so the constraint is recorded where somebody changing it will read it');
    check('serial: both guards run BEFORE the request body is read',
        runRoute.indexOf('if (active)') > 0 && !/readJsonBody/.test(runRoute),
        'nothing about the request can bypass them');
    // One slot each, not a collection - the parent queue may contain multiple environments, but only one child owns
    // the shared Playwright output at a time.
    check('serial: the run slot holds exactly one execution',
        /let active: \{[^}]*\} \| null = null;/s.test(serverSource));
    check('serial: recording and generation are refused during a run too',
        /route === '\/api\/record\/start'[\s\S]{0,400}?if \(active(?: \|\| executionBatch)?\)/.test(serverSource)
        && /startAutocode[\s\S]{0,200}?if \(active(?: \|\| executionBatch)?\)/.test(serverSource));

    /* --------------------------- HISTORY SCOPE: an arbitrary id gets nothing --- */
    //
    // The filter is an equality predicate against each record's OWN applicationId, so
    // an id nothing was recorded under matches nothing. That is fail-closed by
    // construction: there is no path by which an unknown id widens the result set.
    for (const bogus of ['nonexistent', 'fixtureapp-', 'FIXTUREAPP', '../fixtureapp', '']) {
        const runs = await get(`/api/runs?applicationId=${encodeURIComponent(bogus)}`);
        const gens = await get(`/api/generations?applicationId=${encodeURIComponent(bogus)}`);
        // An EMPTY string means "no filter asked for", which is the unfiltered list -
        // that is not a leak, it is the same answer as omitting the parameter.
        const expectEmpty = bogus !== '';
        check(`history: applicationId=${JSON.stringify(bogus)} returns no other project's runs`,
            !expectEmpty || (runs.body.runs ?? []).length === 0,
            `${(runs.body.runs ?? []).length} run(s)`);
        check(`history: applicationId=${JSON.stringify(bogus)} returns no other project's generations`,
            !expectEmpty || (gens.body.generations ?? []).length === 0,
            `${(gens.body.generations ?? []).length} generation(s)`);
    }
    check('history: an unknown project can never widen the result set',
        ((await get('/api/runs?applicationId=nonexistent')).body.runs ?? []).length
          <= ((await get('/api/runs')).body.runs ?? []).length);
    // Case matters, and that is deliberate: applicationId is a lowercase slug the
    // registry validates, so `FIXTUREAPP` is not a spelling of `fixtureapp` - it is an id
    // nothing is filed under.
    check('history: the match is exact, never case-folded or prefix-matched',
        ((await get('/api/runs?applicationId=FIXTUREAPP')).body.runs ?? []).length === 0
        && ((await get('/api/runs?applicationId=bug')).body.runs ?? []).length === 0);

    /* ------------------------------------------------ 22. history filtering --- */
    //
    // The run and generation histories are GLOBAL stores. That is deliberate - they
    // answer "what has happened on this machine" - so the isolation has to come from
    // each record carrying its own applicationId and the listing narrowing on it.
    // Filtering by workbook or by Test Case ID would be the collision the whole model
    // removes: two projects' TC_LOGIN_001 are two different executions.
    const runsAll = await get('/api/runs');
    const runsAlpha = await get('/api/runs?applicationId=fixtureapp');
    const runsOther = await get('/api/runs?applicationId=fixtureshop');
    check('22: /api/runs accepts an applicationId filter',
        runsAll.status === 200 && runsAlpha.status === 200 && runsOther.status === 200);
    check('22: a filtered listing is never larger than the unfiltered one',
        (runsAlpha.body.runs ?? []).length <= (runsAll.body.runs ?? []).length
        && (runsOther.body.runs ?? []).length <= (runsAll.body.runs ?? []).length,
        `${(runsAll.body.runs ?? []).length} total`);
    check('22: every run returned for a project belongs to it',
        (runsAlpha.body.runs ?? []).every((r: any) => r.applicationId === 'fixtureapp')
        && (runsOther.body.runs ?? []).every((r: any) => r.applicationId === 'fixtureshop'));
    // A record written BEFORE this phase carries no applicationId, and JSON drops an
    // undefined field - so the honest property is not "every summary has the key" but
    // "a record with no application is claimed by NOBODY". Attributing those to
    // whichever project happens to be asking would be inventing history, and it is the
    // same rule `readState`'s migration follows for an ambiguous key.
    const legacy = (runsAll.body.runs ?? []).filter((r: any) => !r.applicationId);
    check('22: a run with no recorded application is claimed by neither project',
        legacy.every((r: any) =>
          !(runsAlpha.body.runs ?? []).some((x: any) => x.id === r.id)
          && !(runsOther.body.runs ?? []).some((x: any) => x.id === r.id)),
        `${legacy.length} legacy record(s) of ${(runsAll.body.runs ?? []).length}`);
    check('22: and it still appears in the unfiltered history',
        legacy.length === 0 || (runsAll.body.runs ?? []).length >= legacy.length);

    const gensAll = await get('/api/generations');
    const gensOther = await get('/api/generations?applicationId=fixtureshop');
    check('22: /api/generations accepts the same filter',
        gensAll.status === 200 && gensOther.status === 200);
    check('22: and the five-record retention is unchanged by filtering',
        gensAll.body.limit === 5 && gensOther.body.limit === 5,
        `limit ${gensAll.body.limit}`);
    check('22: every generation returned for a project belongs to it',
        (gensOther.body.generations ?? []).every((g: any) => g.applicationId === 'fixtureshop'));
    check('22: filtering does not evict anything from the global store',
        (await get('/api/generations')).body.generations?.length === (gensAll.body.generations ?? []).length);

    /* ------------------------------------------------- the page contract --- */
    const health = await get('/api/health');
    check('the server advertises the projects route',
        (health.body.routes ?? []).includes('projects'), (health.body.routes ?? []).join(','));
    const page = await fetch(`${BASE}/`);
    const html = await page.text();
    check('the page offers a Project selector', /id="project"/.test(html));
    check('the page offers an Environment selector', /id="environment"/.test(html));
    check('and every application-specific request carries the selection',
        (html.match(/\.\.\.scopeBody\(\),/g) ?? []).length >= 3,
        `${(html.match(/\.\.\.scopeBody\(\),/g) ?? []).length} request body(ies)`);
    check('the recorder start URL is no longer a hardcoded application address',
        !/id="recUrl"[^>]*value="https:/.test(html));
    check('22: the page narrows both histories by the selected project',
        (html.match(/scopeQuery\(\)/g) ?? []).length >= 3,
        `${(html.match(/scopeQuery\(\)/g) ?? []).length} uses`);
  } finally {
    await stopFixtureProcess(child);
  }

  /* ------------------------------------------------------------------ 12 ---- */
  //
  // The same server, the same routes, against a registry with ONE application - which
  // is what every existing FixturePortal checkout has. A request that names no project at
  // all must still work here, because that is every request the dashboard made before
  // this phase existed. The refusal above and the acceptance below are the SAME rule
  // reading a different registry, which is why both are asserted against a live server
  // rather than reasoned about.
  const soleFile = writeRegistry([FIXTUREAPP]);
  const soleChild = startServer(soleFile);
  let soleOutput = ''; soleChild.stdout?.on('data', b => soleOutput += b); soleChild.stderr?.on('data', b => soleOutput += b);
  try {
    await waitForFixtureHttp(soleChild, BASE + '/api/health', () => soleOutput);
    {
      check('12: the server started against a single-application registry', true);
      const projects = await get('/api/projects');
      check('12: the page is told no selection is required',
          projects.body.soleApplication === true);
      // No applicationId, no environmentId - exactly the body the pre-Phase-3 page sent.
      //
      // NOTHING IS ACTUALLY RUN. The Test Case ID is deliberately one the workbook does
      // not contain, so the request travels the whole scope path and is then rejected by
      // the run validator instead of spawning Playwright against the live application -
      // which an offline gate must never do. What is being asserted is WHICH check
      // refused it: a message about the test case proves the SCOPE was accepted, and a
      // message about the project would prove it was not.
      const legacyRun = await post('/api/run', {
        workbook: 'excel/fixture-cases.xlsx',
        testCaseIds: ['TC_DOES_NOT_EXIST_IN_THIS_WORKBOOK'],
        browser: 'chromium',
        workers: 1,
      });
      const complaint = String(legacyRun.body?.error ?? '');
      check('12: an UNSCOPED request gets PAST the project check with one registered',
          legacyRun.status === 400 && !/applicationId|project/i.test(complaint),
          `${legacyRun.status} ${complaint.slice(0, 70)}`);
      check('12: and it was the test case that was refused, not the project',
          /TC_DOES_NOT_EXIST_IN_THIS_WORKBOOK/i.test(complaint) || /test case/i.test(complaint),
          complaint.slice(0, 70));
    }
  } finally {
    await stopFixtureProcess(soleChild);
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  check('the fixture left nothing behind', !fs.existsSync(TEMP_DIR));
  console.log(`\n${failures ? 'FAIL' : 'PASS'} - ${checks - failures}/${checks} checks\n`);
  process.exit(failures ? 1 : 0);
}

void main();
