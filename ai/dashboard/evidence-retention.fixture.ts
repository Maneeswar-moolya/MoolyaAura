import '../testing/isolated-checkout';
/**
 * Accepting a test must not destroy the evidence that explains it.
 *
 *   npx tsx ai/dashboard/evidence-retention.fixture.ts
 *
 * WHAT THIS EXISTS FOR. `acceptRecording()` used to call `discardArtifact()`: the
 * recording, its press-time evidence and its picked assertions were deleted the
 * moment the gate said the spec passed. The reasoning was that a recording had served
 * its purpose once a spec was built from it.
 *
 * It had not. A spec is a CLAIM; the evidence is why the claim is believed, and every
 * later question - is this locator strict-mode safe, can it be repaired, what element
 * did the person actually mean - is a question about the evidence. Twenty-seven
 * accepted tests in this corpus carry locators that can no longer be repaired or even
 * explained, because the file that would have proved a safe alternative was deleted
 * at the moment the test went green. That is the failure mode this file pins shut.
 *
 * EVIDENCE IS IMMUTABLE PROVENANCE. Archiving moves bytes and changes none of them;
 * a check below compares them byte for byte across the move.
 *
 * Offline: no browser, no model, no network. Writes only into a temp directory and
 * the archive it creates for its own synthetic ID, and removes both afterwards.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  acceptedDir, recordingsDir, archiveArtifact, archivedPath, artifactPath, assertionsPath,
  discardArtifact, evidencePath, readArchivedArtifact, readArtifact,
} from './recorder';
import { acceptRecording, readAssertions, readEvidence } from '../autocode/from-recording';
import { isDomEvidence } from '../autocode/dom-evidence';

const ROOT = process.cwd();
/** A synthetic id that cannot collide with a real case. */
const ID = 'TC_RETENTION_FIXTURE';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const SPEC = [
  "import { test, expect } from '@playwright/test';",
  '',
  "test('recorded', async ({ page }) => {",
  "  await page.locator('#filter-value').click();",
  '});',
].join('\n');

const EVIDENCE = {
  available: true,
  recording: { transport: 'live', targetCount: 1, beforeActionCount: 1, failures: 0 },
  targets: [{
    locator: "page.locator('#filter-value')",
    target: { tag: 'input', id: 'filter-value', stableClasses: ['form-control'] },
    ancestors: [{ tag: 'div', id: 'bugReport-table', stableClasses: ['tabulator'] }],
    captureTiming: 'before-action',
    matchCount: 1,
    derivedCandidates: [{
      strategy: 'stable-id', expression: 'page.locator("#filter-value")', matchCount: 1,
      identityMatched: true, sameDocument: true, measuredAt: 'press',
    }],
  }],
};

const ASSERTIONS = [{
  type: 'visible', expected: true, target: 'filter-value',
  locator: "page.locator('#filter-value')", locatorStrategy: 'css', value: null, afterActions: 1,
}];

const AUTHORING = { testCaseId: ID, recordingFingerprint: 'fixture', at: new Date(0).toISOString() };

function write(): void {
  fs.mkdirSync(recordingsDir(), { recursive: true });
  fs.writeFileSync(artifactPath(ID), SPEC, 'utf8');
  fs.writeFileSync(evidencePath(ID), JSON.stringify(EVIDENCE, null, 2), 'utf8');
  fs.writeFileSync(assertionsPath(ID), JSON.stringify(ASSERTIONS, null, 2), 'utf8');
  fs.writeFileSync(path.join(recordingsDir(), `${ID}.authoring.json`),
      JSON.stringify(AUTHORING, null, 2), 'utf8');
}

function cleanUp(): void {
  discardArtifact(ID);
  fs.rmSync(path.join(recordingsDir(), `${ID}.authoring.json`), { force: true });
  for (const suffix of ['.spec.ts', '.evidence.json', '.assertions.json', '.authoring.json'])
    fs.rmSync(archivedPath(ID, suffix), { force: true });
}

/* --------------------------------------------- acceptance retains everything ---- */

function checkRetention(): void {
  process.stdout.write('\n== accepting a recording keeps its provenance ==\n');
  write();

  const before = {
    spec: fs.readFileSync(artifactPath(ID), 'utf8'),
    evidence: fs.readFileSync(evidencePath(ID), 'utf8'),
    assertions: fs.readFileSync(assertionsPath(ID), 'utf8'),
    authoring: fs.readFileSync(path.join(recordingsDir(), `${ID}.authoring.json`), 'utf8'),
  };

  acceptRecording(ID);

  // 1. NOTHING IS LOST. This is the whole point.
  for (const [name, suffix] of [
    ['the recording', '.spec.ts'],
    ['the press-time evidence', '.evidence.json'],
    ['the picked assertions', '.assertions.json'],
    ['the authoring sidecar', '.authoring.json'],
  ] as Array<[string, string]>)
    check(`${name} survives acceptance`, fs.existsSync(archivedPath(ID, suffix)), archivedPath(ID, suffix));

  // 2. IMMUTABLE. Archiving moves bytes; it does not touch them.
  check('the recording is byte-identical after archiving',
      fs.readFileSync(archivedPath(ID, '.spec.ts'), 'utf8') === before.spec);
  check('the evidence is byte-identical after archiving',
      fs.readFileSync(archivedPath(ID, '.evidence.json'), 'utf8') === before.evidence);
  check('the assertions are byte-identical after archiving',
      fs.readFileSync(archivedPath(ID, '.assertions.json'), 'utf8') === before.assertions);
  check('the authoring sidecar is byte-identical after archiving',
      fs.readFileSync(archivedPath(ID, '.authoring.json'), 'utf8') === before.authoring);

  // 3. THE ACTIVE QUEUE IS CLEAN. An archived recording must never look like one
  //    waiting to be generated.
  check('nothing is left in the active recording queue',
      !fs.existsSync(artifactPath(ID)) && !fs.existsSync(evidencePath(ID))
      && !fs.existsSync(assertionsPath(ID)));
  check('and the generation queue cannot see it',
      readArtifact(ID) === null, 'readArtifact reads the live directory only');
  const queue = fs.readdirSync(recordingsDir()).filter(name => name.endsWith('.spec.ts'));
  check('a directory scan of the queue does not recurse into the archive',
      !queue.some(name => name.startsWith(ID)), queue.length + ' file(s) in the queue');

  // 4. IT IS STILL READABLE, which is what makes a later audit possible at all.
  check('the archived recording can be read back', readArchivedArtifact(ID) === SPEC);
}

/* ------------------------------------------------- the archive is analysable ---- */

function checkAnalysable(): void {
  process.stdout.write('\n== an accepted test can be analysed again ==\n');

  const raw = readArchivedArtifact(ID);
  check('the recorded script is recoverable', Boolean(raw) && raw!.includes('#filter-value'));

  const evidence = JSON.parse(
      fs.readFileSync(archivedPath(ID, '.evidence.json'), 'utf8')) as typeof EVIDENCE;
  check('the evidence parses', isDomEvidence(evidence as never));

  // THE QUESTION THE AUDIT NEEDS TO ASK: was this locator proven at the press?
  const target = evidence.targets[0];
  const candidate = target.derivedCandidates[0];
  check('press-time proof is inspectable',
      candidate.measuredAt === 'press' && candidate.identityMatched === true
      && candidate.sameDocument === true && candidate.matchCount === 1,
      `${candidate.measuredAt} n=${candidate.matchCount}`);
  check('the original recorded locator is recoverable',
      target.locator === "page.locator('#filter-value')", target.locator);
  check('the proven alternative is recoverable',
      candidate.expression === 'page.locator("#filter-value")', candidate.expression);
  check('the assertions are recoverable',
      JSON.parse(fs.readFileSync(archivedPath(ID, '.assertions.json'), 'utf8')).length === 1);

  // What the LIVE readers say is unchanged: the archive is not the queue.
  check('readEvidence does not silently read the archive',
      readEvidence(ID).available === false, 'the queue is the queue');
  check('readAssertions does not silently read the archive',
      readAssertions(ID) === undefined);
}

/* ------------------------------------------------------------- idempotency ---- */

function checkIdempotent(): void {
  process.stdout.write('\n== accepting twice cannot duplicate or corrupt evidence ==\n');

  const first = fs.readFileSync(archivedPath(ID, '.evidence.json'), 'utf8');

  // Accepting again with nothing left to move is a no-op, not an error.
  acceptRecording(ID);
  check('a second acceptance with an empty queue is a no-op',
      fs.readFileSync(archivedPath(ID, '.evidence.json'), 'utf8') === first);

  // Re-recording and re-accepting replaces the archive with the newer provenance -
  // one accepted spec per case, so one archive per case. Never two.
  write();
  const replaced = JSON.stringify({ ...EVIDENCE, recording: { ...EVIDENCE.recording, targetCount: 9 } }, null, 2);
  fs.writeFileSync(evidencePath(ID), replaced, 'utf8');
  acceptRecording(ID);
  check('re-accepting replaces the archive rather than adding to it',
      fs.readFileSync(archivedPath(ID, '.evidence.json'), 'utf8') === replaced);

  const archived = fs.readdirSync(acceptedDir()).filter(name => name.startsWith(ID));
  check('exactly one archived file per artefact kind', archived.length === 4,
      archived.sort().join(', '));
  check('and no duplicate/suffixed copies were created',
      !archived.some(name => /\(\d\)|\.\d+\.|copy/i.test(name)), archived.join(', '));
}

/* ------------------------------------- the rules this change must not touch ---- */

function checkNothingElseChanged(): void {
  process.stdout.write('\n== the safety rules are untouched by retention ==\n');

  const recorder = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'recorder.ts'), 'utf8');
  check('archiveArtifact moves files and rewrites none',
      !/JSON\.stringify|writeFileSync/.test(
          recorder.split('export function archiveArtifact')[1]?.split('\n}')[0] ?? 'writeFileSync'),
      'evidence is provenance, not something to edit');
  check('discardArtifact still exists for the verdicts that really are finished',
      /export function discardArtifact/.test(recorder));

  const fromRecording = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'from-recording.ts'), 'utf8');
  check('acceptRecording no longer discards',
      /export function acceptRecording[\s\S]{0,400}?archiveArtifact\(/.test(fromRecording)
      && !/export function acceptRecording[\s\S]{0,400}?discardArtifact\(/.test(fromRecording));
}

function main(): void {
  try {
    checkRetention();
    checkAnalysable();
    checkIdempotent();
    checkNothingElseChanged();
  } finally {
    cleanUp();
    check('the fixture left nothing behind',
        !fs.existsSync(artifactPath(ID)) && !fs.existsSync(archivedPath(ID, '.spec.ts')));
  }
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
