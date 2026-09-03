/**
 * The gate must understand the same evidence after acceptance that it understood before.
 *
 *   npx tsx ai/autocode/archived-evidence-gate.fixture.ts
 *
 * WHAT WAS BROKEN. `positionalIdentity` refuses an index unless the case's own recording
 * PROVES it, and `provenPositionalExpressions` re-derives that proof from the evidence
 * file. It read `ai/dashboard/recordings/<ID>.evidence.json` and nothing else - while
 * `acceptRecording` MOVES that file to `recordings/accepted/` the moment a spec is
 * accepted. So the proof was filed, not withdrawn, and a spec that had passed this very
 * gate could no longer pass it.
 *
 * Measured before the fix: 7 accepted specs contain an evidence-backed index
 * (TC_DASHBOARD_026, TC_LOGIN_106/108/112/121/122/123) and NOT ONE still has live
 * evidence. TC_LOGIN_122 derived 0 proven expressions from `recordings/` and 43 from
 * `accepted/`, with the spec's two indices in the second set - refused by the gate,
 * proven by its own archive.
 *
 * WHAT THIS FILE PINS. That the archive is READ, and that reading it excuses nothing:
 * the identical predicate, the identical composition and the identical refusals apply
 * wherever the file was found. Every negative case below is run from the ARCHIVE, so a
 * fix that simply trusted an archived spec would turn six of them red.
 *
 * Offline: no browser, no model, no network. Every file it writes, it removes.
 */

import * as fs from 'fs';
import * as path from 'path';

import { staticCheck } from './verify';
import { mapRecording, readAssertions, readEvidence } from './from-recording';
import { parseRecording, readArchivedArtifact } from '../dashboard/recorder';

const ROOT = process.cwd();
const LIVE_DIR = path.join(ROOT, 'ai', 'dashboard', 'recordings');
const ARCHIVE_DIR = path.join(LIVE_DIR, 'accepted');

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string): void => process.stdout.write(`\n== ${title} ==\n`);

/* ------------------------------------------------------------------ the fixture ---- */

/** A synthetic case id, so nothing here can collide with a real recording. */
const CASE = 'TC_GATEFIX_001';
const OTHER = 'TC_GATEFIX_002';
const BASE = 'page.locator(".tabulator-row").filter({ hasText: "an issue nobody else has" }).locator(".bugChecked")';
const SCENARIO = 'a positional locator the recording proves';

/** Evidence carrying exactly one position-proven candidate. */
const evidence = (over: Record<string, unknown> = {}) => JSON.stringify({
  available: true,
  targets: [{
    locator: 'page.locator(".bugChecked")',
    target: { tag: 'input', stableClasses: ['bugChecked'] },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], captureTiming: 'before-action',
    derivedCandidates: [],
    positionProvenCandidates: [{
      strategy: 'container-text', expression: BASE, matchCount: 3,
      identityMatched: false, sameDocument: true, measuredAt: 'press',
      positionWithinCandidate: 2, ...over,
    }],
  }],
});

/** A minimal spec that carries one indexed locator. */
const spec = (expression: string, testCaseId = CASE) =>
  'import { expect, test, trace } from \'../fixtures\';\n\n'
  + `test('${testCaseId} - ${SCENARIO}', async ({ page }) => {\n`
  + `  await trace({ testCaseId: '${testCaseId}' });\n`
  + `  await expect(${expression}).toBeVisible();\n`
  + '});\n';

const written: string[] = [];
function write(dir: string, testCaseId: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${testCaseId}.evidence.json`);
  fs.writeFileSync(file, body, 'utf8');
  written.push(file);
}
function clear(): void {
  for (const file of written.splice(0)) {
    try {
      fs.unlinkSync(file);
    } catch {
      // already gone
    }
  }
}

const problems = (expression: string, testCaseId = CASE) =>
  staticCheck(spec(expression, testCaseId), testCaseId, SCENARIO)
      .filter(problem => /nth\(\)|first\(\)|last\(\)/.test(problem.message));

/* ------------------------------------------------------- 1-8, the gate itself ---- */

function checkGate(): void {
  section('1-2 - the same proof, live and archived');

  clear();
  write(LIVE_DIR, CASE, evidence());
  check('1: live evidence proves the index, so the gate accepts it',
      problems(`${BASE}.nth(2)`).length === 0,
      problems(`${BASE}.nth(2)`).map(entry => entry.message.slice(0, 70)).join(' | '));

  clear();
  write(ARCHIVE_DIR, CASE, evidence());
  check('2: the SAME evidence in the archive is accepted identically',
      problems(`${BASE}.nth(2)`).length === 0,
      problems(`${BASE}.nth(2)`).map(entry => entry.message.slice(0, 70)).join(' | '));

  // AND THE LIVE FILE STILL WINS WHEN BOTH EXIST - one case, one recording.
  clear();
  write(LIVE_DIR, CASE, evidence());
  write(ARCHIVE_DIR, CASE, evidence({ positionWithinCandidate: 5, matchCount: 9 }));
  check('2: with both present the LIVE file is the one read',
      problems(`${BASE}.nth(2)`).length === 0 && problems(`${BASE}.nth(5)`).length === 1,
      'nth(2) accepted from live, nth(5) refused despite the archive');

  section('3-8 - every refusal survives the archive');

  clear();
  check('3: no evidence anywhere - an index is refused',
      problems(`${BASE}.nth(2)`).length === 1,
      problems(`${BASE}.nth(2)`).map(entry => entry.message.slice(0, 60)).join(' | ') || 'accepted!');

  clear();
  write(ARCHIVE_DIR, CASE, evidence());
  check('4: archived evidence, DIFFERENT index - refused',
      problems(`${BASE}.nth(1)`).length === 1);
  check('4: and index 0 is not a free pass either',
      problems(`${BASE}.nth(0)`).length === 1);

  clear();
  write(ARCHIVE_DIR, OTHER, evidence());
  check('5: archived evidence for ANOTHER case - refused',
      problems(`${BASE}.nth(2)`).length === 1,
      'the proof has to be in this case\'s own file');

  clear();
  write(ARCHIVE_DIR, CASE, evidence());
  check('6: archived evidence, WRONG base - refused',
      problems('page.locator(".bugChecked").nth(2)').length === 1);
  check('6: a base the evidence never measured is refused however plausible',
      problems('page.locator(".tabulator-row").locator(".bugChecked").nth(2)').length === 1);

  // 7 - the mechanism is unproven: each of these fails one measurement, and each must
  // refuse from the archive exactly as it would from the live file.
  for (const [why, over] of [
    ['no position was measured', { positionWithinCandidate: null }],
    ['the count is one, so no index is needed', { matchCount: 1 }],
    ['the measurement came from another document', { sameDocument: false }],
    ['the index is outside the match list', { positionWithinCandidate: 7 }],
    ['the index is not an integer', { positionWithinCandidate: 1.5 }],
    ['the measurement has no timing', { measuredAt: 'claim' }],
  ] as Array<[string, Record<string, unknown>]>) {
    clear();
    write(ARCHIVE_DIR, CASE, evidence(over));
    check(`7: archived but unproven (${why}) - refused`,
        problems(`${BASE}.nth(2)`).length === 1);
  }

  clear();
  write(ARCHIVE_DIR, CASE, evidence());
  check('8: first() is still refused with the archive present',
      problems(`${BASE}.first()`).length === 1);
  check('8: last() likewise',
      problems(`${BASE}.last()`).length === 1);

  section('9 - everything else about the gate is untouched');

  clear();
  write(ARCHIVE_DIR, CASE, evidence());
  const source = spec(`${BASE}.nth(2)`);
  check('9: a spec with a proven index passes the WHOLE static check, not just the index rule',
      staticCheck(source, CASE, SCENARIO).length === 0,
      staticCheck(source, CASE, SCENARIO).map(entry => entry.message.slice(0, 60)).join(' | '));
  check('9: a missing trace() is still refused',
      staticCheck(source.replace(/await trace[^\n]*\n/, ''), CASE, SCENARIO)
          .some(entry => /trace/.test(entry.message)));
  check('9: a missing expect() is still refused',
      staticCheck(source.replace('await expect(', 'await noop('), CASE, SCENARIO)
          .some(entry => /expect\(\)/.test(entry.message)));
  check('9: the wrong test case id in the title is still refused',
      staticCheck(source.replace(CASE + ' - ', 'TC_OTHER_9 - '), CASE, SCENARIO)
          .some(entry => /No test titled/.test(entry.message)));
  clear();
}

/* --------------------------------------------- 10-11, the two real recordings ---- */

function mapArchived(id: string) {
  const source = readArchivedArtifact(id);
  if (!source)
    return null;
  const recording = parseRecording(source, {
    startUrl: '', browser: '', durationMs: 0,
    evidence: readEvidence(id, { archived: true }),
    stateAssertions: readAssertions(id, { archived: true }),
  });
  recording.startUrl = recording.actions.find(action => action.type === 'navigate')?.value ?? '';
  return mapRecording(recording);
}

function checkRealCases(): void {
  section('10-11 - the two accepted cases this was found on');

  // 10 - TC_LOGIN_122: a genuine ambiguity, an index its own (archived) evidence proves.
  const twoTwo = path.join(ROOT, 'tests-e2e', 'generated', 'TC_LOGIN_122.spec.ts');
  if (fs.existsSync(twoTwo)) {
    const scenario = '#tr_1749552 > .tabulator-cell.tabulator-cell--checkbox > .rounded-checkbox-cont'
      + ' > .rounded-checkbox-ui — 1749552 is ticked';
    const found = staticCheck(fs.readFileSync(twoTwo, 'utf8'), 'TC_LOGIN_122', scenario);
    check('10: the accepted TC_LOGIN_122 spec passes the gate again',
        found.length === 0, found.map(entry => entry.message.slice(0, 80)).join(' | '));
    check('10: and it does still carry the measured index',
        /\.nth\(2\)/.test(fs.readFileSync(twoTwo, 'utf8')));
  }

  const mapped = mapArchived('TC_LOGIN_122');
  if (mapped) {
    const assertion = mapped.steps.find(step => /^assert /.test(String(step.from)));
    check('10: replayed, it still resolves through evidence-backed positional recovery',
        (assertion as never as { quality?: { strategy?: string } })?.quality?.strategy
          === 'evidence-backed-position');
  }

  // 11 - TC_LOGIN_123: a unique contextual candidate, so no index is generated at all.
  // The gate change must not make an index acceptable where none is needed.
  const oneTwoThree = mapArchived('TC_LOGIN_123');
  if (oneTwoThree) {
    const assertions = oneTwoThree.steps.filter(step => /^assert /.test(String(step.from)));
    check('11: TC_LOGIN_123 still resolves its assertions through a Page Object',
        assertions.length === 3 && assertions.every(step => step.kind === 'page-object'),
        assertions.map(step => step.kind).join(','));
    const nth = oneTwoThree.steps.reduce((total, step) =>
      total + (step.code.join(' ').match(/\.nth\(/g) ?? []).length, 0);
    check('11: and generates NO index anywhere', nth === 0, `${nth} occurrence(s)`);
  }

  section('the boundary the gate keeps');

  // The gate may ask the recorder WHERE evidence lives. It may not import anything else
  // from it, and it still reads evidence for one purpose only.
  const verify = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'verify.ts'), 'utf8');
  const fromRecorder = [...verify.matchAll(/import \{([^}]*)\} from '\.\.\/dashboard\/recorder';/g)]
      .flatMap(match => match[1].split(',').map(name => name.trim()).filter(Boolean));
  check('the gate imports only the two path accessors from the recorder',
      fromRecorder.length > 0 && fromRecorder.every(name => name === 'archivedPath' || name === 'evidencePath'),
      fromRecorder.join(', ') || 'nothing');
  check('and still no live-recorder, capture source or generator import',
      !/from '\.\.\/dashboard\/live-recorder'|from '\.\/dom-capture-source'|from '\.\/from-recording'/.test(verify));
  check('the live directory is no longer spelled out a second time in the gate',
      !/'recordings'/.test(verify), 'the path comes from the recorder\'s accessors');
}

function main(): void {
  try {
    checkGate();
    checkRealCases();
  } finally {
    clear();
  }
  const leftovers = [CASE, OTHER].flatMap(id => [
    path.join(LIVE_DIR, `${id}.evidence.json`), path.join(ARCHIVE_DIR, `${id}.evidence.json`)])
      .filter(file => fs.existsSync(file));
  check('the fixture left nothing behind', leftovers.length === 0, leftovers.join(', '));
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
