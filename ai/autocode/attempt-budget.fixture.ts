import '../testing/isolated-checkout';
/**
 * P0.11 — the attempt budget must not outlive the defect it was protecting against.
 *
 *   npx tsx ai/autocode/attempt-budget.fixture.ts
 *
 * Offline: no browser, no model, no network, and nothing is written outside a
 * temporary directory. The workbook is READ to drive one real `surveyWork` call
 * and is never modified.
 *
 * WHY THIS EXISTS
 *
 * `MAX_ATTEMPTS` asked "has this row changed?" and nothing else. TC_SYNTHETIC_001,
 * 042 and 043 spent their two attempts failing at a click the application
 * swallowed - a framework defect, fixed by P0.8 - and stayed skipped afterwards
 * with "edit the row to try again". Nothing was wrong with those rows. The
 * budget now asks about the framework as well, and either half changing is
 * enough to reopen it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseWorkbook } from '../excel/parser';
import { readMapping } from '../excel/mapping';
import {
  budgetExhausted, fingerprint, frameworkFingerprint, generationPageObjectDir,
  GENERATION_SOURCES, MAX_ATTEMPTS, resetFrameworkFingerprint, stateKeyFor, surveyWork,
  type State, type StateEntry,
} from './work';

const ROOT = process.cwd();
const WORKBOOK = 'excel/fixture-cases.xlsx';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const FRAMEWORK_A = 'aaaaaaaaaaaaaaaa';
const FRAMEWORK_B = 'bbbbbbbbbbbbbbbb';

function entry(over: Partial<StateEntry> = {}): StateEntry {
  return {
    fingerprint: 'row-1', verdict: 'quarantined', specFile: undefined,
    reason: 'the spec does not pass as written', model: 'none',
    at: '2026-08-14T00:00:00.000Z', attempts: MAX_ATTEMPTS, framework: FRAMEWORK_A,
    ...over,
  };
}

/* ------------------------------------------------ 1-4: the eligibility matrix */

function checkMatrix(): void {
  process.stdout.write('\n== 1-4 — row x framework, the whole matrix ==\n');
  check('1: unchanged row + unchanged framework -> still blocked',
      budgetExhausted(entry(), 'row-1', FRAMEWORK_A) === true);
  check('2: unchanged row + CHANGED framework -> eligible again',
      budgetExhausted(entry(), 'row-1', FRAMEWORK_B) === false);
  check('3: CHANGED row + unchanged framework -> eligible again',
      budgetExhausted(entry(), 'row-2', FRAMEWORK_A) === false);
  check('4: CHANGED row + CHANGED framework -> eligible again',
      budgetExhausted(entry(), 'row-2', FRAMEWORK_B) === false);

  process.stdout.write('\n== 9 — the protection itself is intact ==\n');
  check('9: below the budget is always eligible, unchanged or not',
      budgetExhausted(entry({ attempts: MAX_ATTEMPTS - 1 }), 'row-1', FRAMEWORK_A) === false);
  check('9: at the budget with nothing changed stays blocked',
      budgetExhausted(entry({ attempts: MAX_ATTEMPTS }), 'row-1', FRAMEWORK_A) === true);
  check('9: over the budget with nothing changed stays blocked',
      budgetExhausted(entry({ attempts: MAX_ATTEMPTS + 5 }), 'row-1', FRAMEWORK_A) === true);
  check('9: surveying repeatedly never wears the budget down',
      [1, 2, 3, 4, 5].every(() => budgetExhausted(entry(), 'row-1', FRAMEWORK_A) === true));
  check('9: no previous entry is not a blocked one',
      budgetExhausted(undefined, 'row-1', FRAMEWORK_A) === false);

  process.stdout.write('\n== 5 — timestamps and verdict wording change nothing ==\n');
  check('5: a later `at` does not reopen the budget',
      budgetExhausted(entry({ at: new Date().toISOString() }), 'row-1', FRAMEWORK_A) === true);
  check('5: a different reason does not reopen it',
      budgetExhausted(entry({ reason: 'something else entirely' }), 'row-1', FRAMEWORK_A) === true);
  check('5: a different model does not reopen it',
      budgetExhausted(entry({ model: 'claude-opus-5' }), 'row-1', FRAMEWORK_A) === true);
  check('5: a recorded specFile does not reopen it',
      budgetExhausted(entry({ specFile: 'tests-e2e/generated/x.spec.ts' }), 'row-1', FRAMEWORK_A) === true);

  process.stdout.write('\n== 10 — a state.json written before P0.11 ==\n');
  const legacy = entry({ framework: undefined });
  check('10: an entry with no framework recorded is eligible once',
      budgetExhausted(legacy, 'row-1', FRAMEWORK_A) === false);
  check('10: and blocked again once a fingerprint has been recorded',
      budgetExhausted(entry({ framework: FRAMEWORK_A }), 'row-1', FRAMEWORK_A) === true);
  check('10: reading a legacy entry needs no migration step',
      JSON.parse(JSON.stringify(legacy)).framework === undefined);
  check('10: every other field of a legacy entry is respected',
      budgetExhausted(entry({ framework: undefined, attempts: 0 }), 'row-1', FRAMEWORK_A) === false);
}

/* ------------------------------------------ 6-7: what the fingerprint is made of */

/** A throwaway tree holding only the files the fingerprint claims to read. */
function fakeTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p011-'));
  for (const relative of GENERATION_SOURCES) {
    fs.mkdirSync(path.join(root, path.dirname(relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), `// ${relative}\nexport const x = 1;\n`, 'utf8');
  }
  fs.mkdirSync(path.join(root, generationPageObjectDir()), { recursive: true });
  for (const name of ['login.page.ts', 'projects.page.ts'])
    fs.writeFileSync(path.join(root, generationPageObjectDir(), name), `export class X {}\n`, 'utf8');
  return root;
}

const print = (root: string) => {
  resetFrameworkFingerprint();
  return frameworkFingerprint(root);
};

function checkFingerprint(): void {
  process.stdout.write('\n== 7 — the fingerprint is deterministic ==\n');
  const root = fakeTree();
  const first = print(root);
  check('7: the same tree hashes the same, twice', print(root) === first, first);
  check('7: and again after the cache is cleared', print(root) === first);
  check('7: it is a short hex digest', /^[0-9a-f]{16}$/.test(first), first);
  check('7: the real repository hashes deterministically too',
      print(ROOT) === print(ROOT), print(ROOT));

  process.stdout.write('\n== 6 — only generation inputs move it ==\n');
  const unrelated = [
    'ai/autocode/state.json', 'ai/test-mapping/mapping.json', 'excel/fixture-cases.xlsx',
    'tests-e2e/generated/TC_LOGIN_064.spec.ts', 'ai/reports/autocode-log.md',
    'ai/dashboard/recordings/TC_SYNTHETIC_001.spec.ts', 'ai/autocode/verify.ts', 'README.md',
  ];
  for (const relative of unrelated) {
    fs.mkdirSync(path.join(root, path.dirname(relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), `changed at ${Date.now()} ${Math.random()}\n`, 'utf8');
  }
  check('6: state, mapping, workbook, generated specs, recordings, logs, verify.ts, README',
      print(root) === first, `${print(root)} vs ${first}`);

  process.stdout.write('   and the things that MUST move it\n');
  const assembler = path.join(root, GENERATION_SOURCES[0]);
  fs.writeFileSync(assembler, `${fs.readFileSync(assembler, 'utf8')}// assembler changed\n`, 'utf8');
  const afterAssembler = print(root);
  check('6: the assembler changes it', afterAssembler !== first, afterAssembler);

  const resolver = path.join(root, GENERATION_SOURCES[1]);
  fs.writeFileSync(resolver, `${fs.readFileSync(resolver, 'utf8')}// resolver changed\n`, 'utf8');
  const afterResolver = print(root);
  check('6: locator resolution changes it', afterResolver !== afterAssembler);

  const pageObject = path.join(root, generationPageObjectDir(), 'projects.page.ts');
  fs.writeFileSync(pageObject, `${fs.readFileSync(pageObject, 'utf8')}// page object changed\n`, 'utf8');
  const afterPageObject = print(root);
  check('6: a Page Object changes it', afterPageObject !== afterResolver);

  fs.writeFileSync(path.join(root, generationPageObjectDir(), 'new.page.ts'), 'export class N {}\n', 'utf8');
  const afterNewPage = print(root);
  check('6: a NEW Page Object changes it', afterNewPage !== afterPageObject);

  fs.rmSync(path.join(root, generationPageObjectDir(), 'new.page.ts'));
  check('6: removing it again restores the previous fingerprint', print(root) === afterPageObject);

  fs.rmSync(path.join(root, GENERATION_SOURCES[2]));
  check('6: a DELETED source changes it, rather than being skipped',
      print(root) !== afterPageObject);

  process.stdout.write('   line endings are not a code change\n');
  const crlf = fakeTree();
  for (const relative of GENERATION_SOURCES) {
    const file = path.join(crlf, relative);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').join('\r\n'), 'utf8');
  }
  for (const name of ['login.page.ts', 'projects.page.ts']) {
    const file = path.join(crlf, generationPageObjectDir(), name);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').join('\r\n'), 'utf8');
  }
  check('6: a CRLF checkout hashes the same as an LF one', print(crlf) === first,
      `${print(crlf)} vs ${first}`);

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(crlf, { recursive: true, force: true });
  resetFrameworkFingerprint();
}

/* ------------------------------------- 8 + integration: the real survey path */

async function checkSurvey(): Promise<void> {
  process.stdout.write('\n== 8 + integration — through the real surveyWork ==\n');
  const parsed = await parseWorkbook(path.resolve(ROOT, WORKBOOK));
  const mapping = readMapping();
  const id = 'TC_SYNTHETIC_001';
  const only = new Set([id]);
  const testCase = parsed.testCases.find(row => row.testCaseId.toUpperCase() === id);
  if (!testCase) {
    check('integration: TC_SYNTHETIC_001 is in the workbook', false, 'row not found');
    return;
  }
  const row = fingerprint(testCase);
  const current = frameworkFingerprint();
  // Keyed `applicationId/testCaseId`, which is what `surveyWork` now looks up. A Test
  // Case ID is unique within an application and meaningless across them, so the bare id
  // was a key two projects would have shared.
  const state = (framework: string | undefined, attempts = MAX_ATTEMPTS): State => ({
    [stateKeyFor(id)]: entry({ fingerprint: row, attempts, framework, verdict: 'quarantined' }),
  });

  const blocked = surveyWork(parsed, mapping, state(current), only);
  check('integration: spent budget on THIS framework is skipped',
      blocked.work.length === 0 && blocked.skipped.length === 1, JSON.stringify(blocked.skipped[0]));
  check('integration: the skip says the framework has not changed either',
      /neither the row nor the generation framework has changed/.test(blocked.skipped[0]?.reason ?? ''),
      blocked.skipped[0]?.reason ?? '');

  const reopened = surveyWork(parsed, mapping, state('an-older-framework'), only);
  check('integration: a changed framework makes it work again',
      reopened.work.length === 1 && reopened.skipped.length === 0,
      JSON.stringify(reopened.work.map(item => item.testCase.testCaseId)));
  check('integration: the reason names both fingerprints',
      /budget is reopened/.test(reopened.work[0]?.staleReason ?? '')
      && (reopened.work[0]?.staleReason ?? '').includes(current),
      reopened.work[0]?.staleReason ?? '');
  check('integration: it is stale work, not new work',
      reopened.work[0]?.reason === 'stale');

  const legacy = surveyWork(parsed, mapping, state(undefined), only);
  check('integration: a pre-P0.11 entry is reopened once', legacy.work.length === 1,
      JSON.stringify(legacy.skipped));

  process.stdout.write('\n== 8 — accepted cases are untouched by any of this ==\n');
  const acceptedId = 'TC_SYNTHETIC_001';
  const acceptedCase = parsed.testCases.find(r => r.testCaseId.toUpperCase() === acceptedId);
  const acceptedSpec = 'tests-e2e/generated/TC_SYNTHETIC_001.spec.ts';
  fs.writeFileSync(path.resolve(ROOT, acceptedSpec), "// synthetic accepted artifact\n");
  if (acceptedCase && fs.existsSync(path.resolve(ROOT, acceptedSpec))) {
    const acceptedState = (framework: string | undefined): State => ({
      [stateKeyFor(acceptedId)]: entry({
        fingerprint: fingerprint(acceptedCase), verdict: 'accepted', attempts: 0,
        specFile: acceptedSpec, framework,
      }),
    });
    const only38 = new Set([acceptedId]);
    check('8: an accepted case with the current framework is left alone',
        surveyWork(parsed, mapping, acceptedState(current), only38).work.length === 0);
    check('8: an accepted case with an OLD framework is still left alone',
        surveyWork(parsed, mapping, acceptedState('an-older-framework'), only38).work.length === 0);
    check('8: an accepted case with NO framework recorded is still left alone',
        surveyWork(parsed, mapping, acceptedState(undefined), only38).work.length === 0);
  } else {
    check('8: TC_SYNTHETIC_001 and its spec are available to test with', false, acceptedSpec);
  }
}

async function main(): Promise<void> {
  checkMatrix();
  checkFingerprint();
  await checkSurvey();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
