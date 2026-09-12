import '../testing/isolated-checkout';
/**
 * The Generation tab must stop forgetting - and must stop at five.
 *
 *   npx tsx ai/dashboard/generation-history.fixture.ts
 *
 * WHAT THIS PINS. Generation history has exactly two ways to be wrong, and they are
 * opposites. It can forget: the tab was live-only, so closing it, reloading it or
 * restarting the dashboard destroyed the log of the run that had just quarantined a
 * spec. Or it can hoard: an unbounded store of whole generation logs plus every Page
 * Object decision is a directory nobody prunes, so the cap has to be enforced by the
 * WRITER rather than by whatever the table happens to display.
 *
 * So the checks below are about disk, never about the display. "Exactly five are
 * retained" counts files in the directory; "a sixth evicts the oldest" names the ids
 * that survived; "the tab was closed and reopened" drops the module from the require
 * cache and reads again with an instance that has never seen any of it.
 *
 * It also pins the one contract that spans two files that may not import each other:
 * `ai/autocode/cli.ts` prints the runId, and this store scrapes it. The generator must
 * not depend on the dashboard, so the string is mirrored - and a mirrored string that
 * nothing checks is a string that drifts. The check reads `cli.ts` itself, exactly as
 * `recorder.fixture.ts` reads `index.html` for a rule that lives in HTML and CSS.
 *
 * Offline: no browser, no model, no network, no generation. Writes only inside a
 * directory under os.tmpdir(), and removes it afterwards.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  GENERATIONS_DIR, HISTORY_LIMIT, RUN_ID_MARKER, collectLifecycle, deriveStatus, listGenerations,
  newGenerationId, parseGenerationLog, readGeneration, saveGeneration,
  type GenerationRecord,
} from './generation-history';
import type { LifecycleDecision } from '../autocode/abstraction/lifecycle';

const ROOT = process.cwd();

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** Everything this fixture writes lives here and nowhere else. */
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-generation-history-'));
const dirFor = (name: string): string => {
  const dir = path.join(TEMP, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Two real decisions, in the shape `ai/autocode/abstraction/lifecycle.ts` writes.
 *
 * One reuse and one refusal, because those are the two that must never be confused:
 * a refusal carries its codes and its remedy, and a record that dropped them would
 * turn "four alternatives were measured and every one was unsafe" back into the
 * silence the lifecycle log exists to abolish.
 */
const DECISIONS: LifecycleDecision[] = [
  {
    testCaseId: 'TC_LOGIN_071', generationId: 'RUN_A', timestamp: '2026-08-21T09:00:00.000Z',
    from: 'click Close', target: 'Close', role: 'action',
    disposition: 'EXISTING_PO_REUSED', diagnostic: null, resolver: 'deterministic', attempts: 0,
    component: 'notifications-panel', pageObject: 'NotificationsPage', method: 'close',
    parameters: [], evidenceStatus: 'measured', validationStatus: 'passed',
    reason: 'an existing method already declares this element',
    remedy: null, refusalCodes: [], fingerprint: 'abc123',
  },
  {
    testCaseId: 'TC_LOGIN_071', generationId: 'RUN_A', timestamp: '2026-08-21T09:00:01.000Z',
    from: 'assert checked 1749558', target: '.bugChecked', role: 'assertion',
    disposition: 'REFUSED_NO_ADMISSIBLE_EVIDENCE', diagnostic: 'EVIDENCE_INSUFFICIENT',
    resolver: 'none', attempts: 0,
    component: null, pageObject: null, method: null, parameters: [],
    evidenceStatus: 'measured', validationStatus: 'not-attempted',
    reason: 'the measured locator matched three elements, so identity is not proven',
    remedy: 're-record the interaction so the pressed element can be measured',
    refusalCodes: ['IDENTITY_NOT_PROVEN'],
    fingerprint: null,
  },
];

/** A captured generation log, in the exact shapes the pipeline prints. */
const LOG = [
  '',
  'autocode: 2 case(s) need code, 1 skipped (model: claude-sonnet-5, browser: playwright-cli)',
  '  - TC_LOGIN_099: no expected result',
  '',
  '=== TC_LOGIN_071 (new) Close the notifications panel',
  '  writing tests-e2e/generated/TC_LOGIN_071.spec.ts',
  '  NOTE: this case is over the 15000-token context budget. Generating anyway.',
  '  page objects: 1 reused, 0 created',
  '  ACCEPTED: passed as written and failed with its assertions broken',
  '',
  '=== TC_LOGIN_072 (stale) Sign in with an unregistered email',
  '  writing tests-e2e/generated/login.spec.ts',
  '  QUARANTINED: passed with every assertion broken, so it is checking nothing',
  '',
  `${RUN_ID_MARKER}2026-08-21T09-00-00-000Z-a1b2c3`,
  '',
  'accepted 1, quarantined 1, declined 0, failed 0',
  '',
].join('\n');

function recordFor(id: string, overrides: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    id,
    runId: 'RUN_A',
    workbook: 'excel/fixture-cases.xlsx',
    requestedIds: ['TC_LOGIN_071', 'TC_LOGIN_072'],
    cases: [
      { testCaseId: 'TC_LOGIN_071', scenario: 'Close the notifications panel', status: 'ACCEPTED', reason: 'passed as written and failed with its assertions broken' },
      { testCaseId: 'TC_LOGIN_072', scenario: 'Sign in with an unregistered email', status: 'QUARANTINED', reason: 'checking nothing' },
    ],
    status: 'QUARANTINED',
    startedAt: '2026-08-21T09:00:00.000Z',
    finishedAt: '2026-08-21T09:04:00.000Z',
    exitCode: 0,
    log: LOG,
    lifecycle: DECISIONS,
    ...overrides,
  };
}

/** Ids that sort chronologically, so "oldest" is decidable without a clock. */
const idAt = (minute: number): string => `2026-08-21T09-${String(minute).padStart(2, '0')}-00-000Z-aaaa`;

/* ---------------------------------------------------------------- A. Round trip */

function checkRoundTrip(): void {
  const dir = dirFor('round-trip');
  const written = recordFor(idAt(1));
  saveGeneration(written, dir);

  check('the record is written into its own store, one file per generation',
      fs.readdirSync(dir).length === 1 && fs.existsSync(path.join(dir, `${idAt(1)}.json`)),
      fs.readdirSync(dir).join(', '));

  const read = readGeneration(idAt(1), dir);
  check('a retained record reads back', Boolean(read));
  if (!read)
    return;

  check('the test case ids survive',
      read.cases.map(one => one.testCaseId).join(',') === 'TC_LOGIN_071,TC_LOGIN_072',
      read.cases.map(one => one.testCaseId).join(','));
  check('the scenario title survives',
      read.cases[0].scenario === 'Close the notifications panel', read.cases[0].scenario);
  check('the per-case status survives', read.cases[1].status === 'QUARANTINED', read.cases[1].status);
  check('the run status survives', read.status === 'QUARANTINED', read.status);
  check('started and finished survive',
      read.startedAt === written.startedAt && read.finishedAt === written.finishedAt);
  check('the exit code survives', read.exitCode === 0, String(read.exitCode));
  check('the generator run id survives', read.runId === 'RUN_A', String(read.runId));
  check('the workbook survives', read.workbook === written.workbook, read.workbook);
  check('the requested ids survive', read.requestedIds.join(',') === 'TC_LOGIN_071,TC_LOGIN_072');
  check('the captured log survives byte for byte', read.log === LOG,
      `${read.log.length} chars against ${LOG.length}`);
}

/* ------------------------------------------- B. The status vocabulary is open */

function checkStatusVocabulary(): void {
  // Each in its own directory: the cap is real, so six statuses saved into one store
  // would evict one of them before it could be read back.
  for (const status of ['ACCEPTED', 'REJECTED', 'QUARANTINED', 'FAILED', 'PASSED', 'GENERATED']) {
    const dir = dirFor(`status-${status}`);
    saveGeneration(recordFor(idAt(1), { status, cases: [{ testCaseId: 'TC_X', scenario: 'x', status, reason: '' }] }), dir);
    const read = readGeneration(idAt(1), dir);
    check(`${status} round-trips unchanged`,
        read?.status === status && read?.cases[0].status === status,
        `${read?.status} / ${read?.cases[0].status}`);
  }
}

/* ------------------------------------------ C. Exactly five, and which five */

function checkCap(): string {
  const dir = dirFor('cap');
  for (let minute = 1; minute <= HISTORY_LIMIT; minute++)
    saveGeneration(recordFor(idAt(minute)), dir);

  check(`the store holds ${HISTORY_LIMIT} after ${HISTORY_LIMIT} saves`,
      fs.readdirSync(dir).length === HISTORY_LIMIT, String(fs.readdirSync(dir).length));

  // The sixth. Its own runId, so the survivor checks below cannot be satisfied by
  // reading a record that was already there.
  const sixth = saveGeneration(recordFor(idAt(6), { runId: 'RUN_B' }), dir);

  check('a sixth generation still leaves exactly five on disk',
      fs.readdirSync(dir).length === HISTORY_LIMIT, String(fs.readdirSync(dir).length));
  check('the sixth save reports what it evicted',
      sixth.evicted.length === 1 && sixth.evicted[0] === idAt(1), sixth.evicted.join(', '));

  const survivors = listGenerations(dir).map(one => one.id);
  check('the survivors are the five newest, newest first',
      survivors.join(',') === [idAt(6), idAt(5), idAt(4), idAt(3), idAt(2)].join(','),
      survivors.join(','));
  check('the OLDEST is the one that went',
      !survivors.includes(idAt(1)) && !fs.existsSync(path.join(dir, `${idAt(1)}.json`)));
  check('the evicted record cannot be read back', readGeneration(idAt(1), dir) === null);
  check('the newest is still readable in full',
      readGeneration(idAt(6), dir)?.runId === 'RUN_B');

  // Pruning happens on the WRITE path. Reading a hundred times must not delete
  // anything, and must not conjure anything either.
  for (let i = 0; i < 3; i++)
    listGenerations(dir);
  check('reading does not prune, and does not add',
      fs.readdirSync(dir).length === HISTORY_LIMIT, String(fs.readdirSync(dir).length));
  return dir;
}

/* ------------------------------- D. The tab was closed; the process was restarted */

function checkFreshReader(dir: string): void {
  // Drop the module and load it again: the second instance has never seen a save, so
  // anything it reports came off the disk. A store that answered from memory - a cache
  // of the five, a list built at startup - would pass every check above and lose
  // everything the moment the dashboard restarted, which is the failure this whole
  // feature exists to fix.
  const moduleId = require.resolve(path.join(ROOT, 'ai', 'dashboard', 'generation-history.ts'));
  const before = require(moduleId);
  delete require.cache[moduleId];
  const fresh = require(moduleId) as typeof import('./generation-history');
  check('reloading the module gives a genuinely new instance', fresh !== before);

  const reopened = fresh.listGenerations(dir);
  check('a fresh reader still finds exactly five', reopened.length === HISTORY_LIMIT, String(reopened.length));
  check('a fresh reader finds the same five, in the same order',
      reopened.map(one => one.id).join(',') === [idAt(6), idAt(5), idAt(4), idAt(3), idAt(2)].join(','),
      reopened.map(one => one.id).join(','));

  const record = fresh.readGeneration(idAt(6), dir);
  check('a fresh reader reads a full record back', Boolean(record));
  check('the Page Object decisions survived the round trip',
      record?.lifecycle.length === DECISIONS.length, String(record?.lifecycle.length));
  check('a reused decision keeps its Page Object and method',
      record?.lifecycle[0].disposition === 'EXISTING_PO_REUSED'
      && record?.lifecycle[0].pageObject === 'NotificationsPage'
      && record?.lifecycle[0].method === 'close');
  check('a refusal keeps its codes and its remedy',
      record?.lifecycle[1].disposition === 'REFUSED_NO_ADMISSIBLE_EVIDENCE'
      && record?.lifecycle[1].refusalCodes.join(',') === 'IDENTITY_NOT_PROVEN'
      && Boolean(record?.lifecycle[1].remedy));
  check('every decision field survives verbatim',
      JSON.stringify(record?.lifecycle) === JSON.stringify(DECISIONS));
  check('the summary counts the decisions it holds',
      reopened[0].lifecycleCount === DECISIONS.length, String(reopened[0].lifecycleCount));
  check('the summary names the run it was, not the run it is next to',
      reopened[0].runId === 'RUN_B' && reopened[1].runId === 'RUN_A');
}

/* --------------------------------------- E. Reading the generator's own output */

function checkLogParsing(): void {
  const parsed = parseGenerationLog(LOG);
  check('the runId is scraped from the line the CLI prints',
      parsed.runId === '2026-08-21T09-00-00-000Z-a1b2c3', String(parsed.runId));
  check('every reported case is found, and only those',
      parsed.cases.map(one => one.testCaseId).join(',') === 'TC_LOGIN_071,TC_LOGIN_072',
      parsed.cases.map(one => one.testCaseId).join(','));
  check('the scenario title is read from the heading',
      parsed.cases[0].scenario === 'Close the notifications panel', parsed.cases[0].scenario);
  check('the verdict is the generator\'s own word',
      parsed.cases[0].status === 'ACCEPTED' && parsed.cases[1].status === 'QUARANTINED');
  check('the reason travels with the verdict',
      parsed.cases[1].reason.includes('checking nothing'), parsed.cases[1].reason);
  check('NOTE: is a remark, not a verdict', parsed.cases[0].status !== 'NOTE');

  // A killed run: the heading was printed and the verdict never was. That is not a
  // verdict anybody gave, so it must not be reported as one.
  const killed = parseGenerationLog('=== TC_LOGIN_073 (new) Something\n  writing spec\n');
  check('a case with no verdict is UNREPORTED, never invented',
      killed.cases[0]?.status === 'UNREPORTED', killed.cases[0]?.status);

  // Workbook prose reaches this log verbatim, so a cell could carry the marker.
  const forged = parseGenerationLog(`${RUN_ID_MARKER}not-a-run-id\n${LOG}`);
  check('a marker line that is not shaped like a run id is not read as one',
      forged.runId === '2026-08-21T09-00-00-000Z-a1b2c3', String(forged.runId));
  check('no marker at all means no runId, never a guess',
      parseGenerationLog('=== TC_X (new) x\n  ACCEPTED: fine\n').runId === null);
}

function checkDerivedStatus(): void {
  const accepted = [{ testCaseId: 'A', scenario: '', status: 'ACCEPTED', reason: '' }];
  const mixed = [...accepted, { testCaseId: 'B', scenario: '', status: 'QUARANTINED', reason: '' }];

  check('a clean run of accepted specs is ACCEPTED', deriveStatus(accepted, 0) === 'ACCEPTED');
  check('one quarantine outranks three acceptances',
      deriveStatus(mixed, 0) === 'QUARANTINED', deriveStatus(mixed, 0));
  check('a non-zero exit is FAILED whatever the cases said',
      deriveStatus(accepted, 1) === 'FAILED', deriveStatus(accepted, 1));
  check('a killed generator (no exit code) is FAILED, not ACCEPTED',
      deriveStatus(accepted, null) === 'FAILED', deriveStatus(accepted, null));
  check('a run that reported nothing is SKIPPED', deriveStatus([], 0) === 'SKIPPED');
  check('a word this dashboard has never seen is shown, not flattened',
      deriveStatus([{ testCaseId: 'A', scenario: '', status: 'RENEGOTIATED', reason: '' }], 0) === 'RENEGOTIATED');
}

/* ------------------------- F. The contract with a file that cannot import this one */

function checkCliContract(): void {
  const cli = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'cli.ts'), 'utf8');
  check('ai/autocode/cli.ts prints the run id marker',
      cli.includes(`${RUN_ID_MARKER}\${result.runId}`));

  // Not just "the string is in the file" - the LINE it would print has to parse. A
  // marker printed with a prefix, or without its newline, is a marker nothing reads.
  const printed = cli.match(/write\(`([^`]*autocode run id:[^`]*)`\)/)?.[1] ?? '';
  const line = printed.replace(/\\n/g, '\n').replace('${result.runId}', '2026-08-21T09-00-00-000Z-zzzzzz');
  check('the line the CLI actually prints is parsed by this store',
      parseGenerationLog(line).runId === '2026-08-21T09-00-00-000Z-zzzzzz',
      JSON.stringify(printed));
}

/* --------------------------------- G. Joining the Page Object lifecycle log */

function checkLifecycleJoin(): void {
  const file = path.join(dirFor('lifecycle'), 'page-object-lifecycle.jsonl');
  const other: LifecycleDecision = { ...DECISIONS[0], generationId: 'RUN_B', testCaseId: 'TC_OTHER_001' };
  // A torn last line, exactly as a killed run leaves one. readLifecycleLog skips it.
  fs.writeFileSync(file, `${[...DECISIONS, other].map(one => JSON.stringify(one)).join('\n')}\n{"testCaseId":`, 'utf8');

  const mine = collectLifecycle('RUN_A', file);
  check('only this generation\'s decisions are collected',
      mine.length === 2 && mine.every(one => one.generationId === 'RUN_A'), String(mine.length));
  check('another generation\'s decisions are left where they are',
      collectLifecycle('RUN_B', file).map(one => one.testCaseId).join(',') === 'TC_OTHER_001');
  check('a generation with no runId collects nothing rather than everything',
      collectLifecycle(null, file).length === 0);
  check('a runId nothing recorded against collects nothing',
      collectLifecycle('RUN_NOBODY', file).length === 0);
}

/* -------------------------------------------------------------- H. Path safety */

function checkPathSafety(): void {
  const dir = dirFor('safety');
  saveGeneration(recordFor(idAt(1)), dir);

  // basename(), exactly as the /api/runs/<id> route applies it. An id is a file name
  // in this directory or it is nothing; it is never a path.
  check('a traversing id reads back as nothing',
      readGeneration('../../../../etc/passwd', dir) === null);
  // basename() reduces this to a file name, which is looked for in THIS store only -
  // so a record that exists in the sibling directory is still not found from here.
  const sibling = dirFor('safety-sibling');
  saveGeneration(recordFor(idAt(9)), sibling);
  check('a traversing id does not reach a sibling store',
      readGeneration(`../safety-sibling/${idAt(9)}`, dir) === null);
  check('a dotfile id is refused', readGeneration('.hidden', dir) === null);
  check('an empty id is refused', readGeneration('', dir) === null);

  saveGeneration(recordFor(`../escaped-${idAt(2)}`), dir);
  check('a traversing id is written INSIDE the store, never above it',
      !fs.existsSync(path.join(TEMP, `escaped-${idAt(2)}.json`))
      && fs.existsSync(path.join(dir, `escaped-${idAt(2)}.json`)));
}

/* ------------------------------------------------ I. Shape of an allocated id */

function checkAllocatedId(): void {
  const id = newGenerationId();
  // Fixed-width timestamp first: that is what makes a plain lexicographic sort of the
  // file names a chronological sort, which is how "the oldest" is decided.
  check('an allocated id is a fixed-width timestamp plus a tail',
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9]{1,4}$/.test(id), id);
  // Allocated back to back, so most of these share a millisecond: without the random
  // tail they would be one id, and the second record would overwrite the first.
  const many = new Set(Array.from({ length: 50 }, () => newGenerationId()));
  check('ids allocated in the same millisecond are still distinct ids',
      many.size === 50, String(many.size));
  check('the real store is under ai/dashboard/generations, not the run store',
      GENERATIONS_DIR.endsWith(path.join('ai', 'dashboard', 'generations'))
      && !GENERATIONS_DIR.includes(`${path.sep}runs`), GENERATIONS_DIR);
}

function main(): void {
  try {
    checkRoundTrip();
    checkStatusVocabulary();
    const dir = checkCap();
    checkFreshReader(dir);
    checkLogParsing();
    checkDerivedStatus();
    checkCliContract();
    checkLifecycleJoin();
    checkPathSafety();
    checkAllocatedId();
  } finally {
    fs.rmSync(TEMP, { recursive: true, force: true });
    check('the fixture left nothing behind', !fs.existsSync(TEMP), TEMP);
  }
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
