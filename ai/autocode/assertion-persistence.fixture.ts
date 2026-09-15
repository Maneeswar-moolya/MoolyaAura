import '../testing/isolated-checkout';
/**
 * Do a recording's STATE ASSERTIONS survive being saved and read back?
 *
 *   npx tsx ai/autocode/assertion-persistence.fixture.ts
 *
 * P1.2c. The live picker was working: TC_LOGIN_075 captured `checked:false` when
 * the person chose OFF and `checked:true` when they chose ON, both correct in
 * memory, both composed into the workbook's Expected Result as prose. Neither
 * reached the disk as structure. `persistRecording` wrote the script and the
 * evidence; `generateFromRecording` re-read the script, found no `expect(` in it -
 * Codegen never wrote one, because Codegen never saw the picker - and reported
 * "the recording contains no assertion, so there is nothing for a spec to prove".
 *
 * Like `evidence-persistence.fixture.ts`, and for the same reason, every check
 * below drives the REAL production functions. Nothing here writes an assertions
 * file itself: `persistRecording()` writes it or the first check goes red. A test
 * that builds the thing it is testing proves nothing.
 *
 * Offline: no browser, no model, no network. Synthetic case ids only - no real
 * recording, workbook, mapping or generated spec is read or written.
 */

import fs from 'node:fs';
import path from 'node:path';

import { targetEvidence } from '../testing/synthetic-data';
import { evidenceUnavailable } from './dom-evidence';
import { mapRecording, readAssertions, readEvidence } from './from-recording';
import {
  artifactPath, assertionsPath, discardArtifact, evidencePath, parseRecording,
  persistRecording, readArtifact, type RecordedAssertion,
} from '../dashboard/recorder';

const CASE_ID = 'TC_ASSERT_ROUNDTRIP';
/** A second id, so the backward-compatibility test cannot borrow the first one's file. */
const LEGACY_ID = 'TC_ASSERT_LEGACY';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/**
 * TC_LOGIN_075's script, as Codegen actually wrote it.
 *
 * The picker's own clicks are in it because that is what was recorded - `Assert`,
 * `.veil`, `OFF`, `ON` - and note what is NOT in it: any `expect(`. That absence is
 * the whole point. The email is a placeholder; nothing here carries a credential.
 */
const SCRIPT = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.fixture.invalid/');
  await page.getByRole('textbox', { name: 'Email' }).fill('someone@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('[type=password]');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('link', { name: 'Notifications' }).click();
  await page.getByText('Assert').click();
  await page.locator('.veil').click();
  await page.getByRole('button', { name: 'OFF' }).click();
  await page.locator('.ba-switch__thumb').first().click();
  await page.getByRole('checkbox', { name: 'Enable Notifications Enable' }).check();
  await page.getByText('Assert').click();
  await page.locator('.veil').click();
  await page.getByRole('button', { name: 'ON', exact: true }).click();
});`;

/** The two assertions the picker produced, field for field, as observed live. */
const OFF: RecordedAssertion = {
  type: 'checked',
  expected: false,
  target: 'Enable Notifications Receive notifications for activity acro',
  locator: 'page.getByLabel("Enable Notifications Receive notifications for activity across FixturePortal.")',
  locatorStrategy: 'label',
  value: null,
  interactionTarget: 'page.locator(".ba-switch__thumb")',
  afterActions: 6,
};

const ON: RecordedAssertion = {
  ...OFF,
  expected: true,
  afterActions: 8,
};

/** Save exactly the way the dashboard saves, then read back the way generation reads. */
function roundTrip(caseId: string): ReturnType<typeof parseRecording> {
  const source = readArtifact(caseId);
  if (source === null)
    throw new Error(`no artifact was persisted for ${caseId}`);
  // The same three arguments `generateFromRecording` passes at from-recording.ts.
  return parseRecording(source, {
    startUrl: '', browser: '', durationMs: 0, evidence: readEvidence(caseId),
    stateAssertions: readAssertions(caseId),
  });
}

/* ------------------------------------------------- 1-3: the save actually writes */

function checkPersistence(): void {
  process.stdout.write('\n== 1-3 — saving writes the assertions ==\n');
  discardArtifact(CASE_ID);
  check('1: nothing is on disk before the save',
      !fs.existsSync(assertionsPath(CASE_ID)) && !fs.existsSync(artifactPath(CASE_ID)));

  // THE REAL PRODUCTION WRITE. Nothing in this file creates the sidecar.
  const written = persistRecording(
      CASE_ID, SCRIPT, { available: true, capturedAt: new Date(0).toISOString(), limits: {} as any,
        targets: [targetEvidence(OFF.locator, { target: { tag: 'input', type: 'checkbox' } })] }, [OFF, ON]);
  check('2: the save reports where it put the artifact', typeof written === 'string', String(written));
  check('2: persistRecording wrote the assertions file',
      fs.existsSync(assertionsPath(CASE_ID)), assertionsPath(CASE_ID));
  check('2: and it is beside the script, keyed by the same id',
      assertionsPath(CASE_ID).replace(/\.assertions\.json$/, '.spec.ts') === artifactPath(CASE_ID));

  const raw = JSON.parse(fs.readFileSync(assertionsPath(CASE_ID), 'utf8'));
  check('3: it holds both assertions', Array.isArray(raw) && raw.length === 2,
      JSON.stringify(raw).slice(0, 120));
  check('3: as structure, not as prose',
      raw[0].type === 'checked' && typeof raw[0].expected === 'boolean');
  check('3: the script on disk still contains no expect(, exactly as Codegen wrote it',
      !readArtifact(CASE_ID)!.includes('await expect('));
}

/* --------------------------------------------- 4-8: the read back is faithful */

function checkReadBack(): void {
  process.stdout.write('\n== 4-8 — reading it back ==\n');
  const loaded = readAssertions(CASE_ID);
  check('4: readAssertions finds both', loaded?.length === 2, JSON.stringify(loaded?.length));

  const recording = roundTrip(CASE_ID);
  check('5: the reloaded recording carries both assertions',
      recording.assertions.length === 2,
      `${recording.assertions.length} assertion(s), ${recording.actions.length} action(s)`);

  const off = recording.assertions.find(a => a.expected === false);
  const on = recording.assertions.find(a => a.expected === true);

  // ---- polarity, the thing that must not move
  check('6: expected:false survives as false',
      off !== undefined && off.expected === false, JSON.stringify(off));
  check('7: expected:true survives as true',
      on !== undefined && on.expected === true, JSON.stringify(on));
  check('6-7: and they are two DIFFERENT polarities, not one duplicated',
      recording.assertions.filter(a => a.expected === false).length === 1
      && recording.assertions.filter(a => a.expected === true).length === 1);

  // ---- 8: every field, unchanged
  for (const [label, field] of [
    ['type', 'type'], ['target', 'target'], ['locator', 'locator'],
    ['locatorStrategy', 'locatorStrategy'], ['value', 'value'],
    ['interactionTarget', 'interactionTarget'],
  ] as Array<[string, keyof RecordedAssertion]>) {
    check(`8: ${label} survives unchanged`,
        off?.[field] === OFF[field] && on?.[field] === ON[field],
        `${JSON.stringify(off?.[field])} / ${JSON.stringify(on?.[field])}`);
  }
  check('8: value is still null rather than becoming undefined',
      off !== undefined && off.value === null && 'value' in off);

  // afterActions is the one field that is DELIBERATELY re-based rather than copied:
  // parseRecording maps a raw position onto the collapsed action stream. Nothing was
  // collapsed here, so it is unchanged - and it must still be a number, in order.
  check('8: afterActions is re-based to a real position, and the order is kept',
      typeof off?.afterActions === 'number' && typeof on?.afterActions === 'number'
      && off.afterActions < on.afterActions,
      `${off?.afterActions} then ${on?.afterActions}`);
  check('8: the raw positions were persisted, so one re-base happens rather than two',
      JSON.parse(fs.readFileSync(assertionsPath(CASE_ID), 'utf8'))
          .map((a: RecordedAssertion) => a.afterActions).join(',') === '6,8');
  check('8: the actions came back too',
      recording.actions.length === 13, `${recording.actions.length} actions`);
}

/* ------------------------------------------- 9: what generation makes of them */

function checkGeneration(): void {
  process.stdout.write('\n== 9 — what gets emitted ==\n');
  const mapped = mapRecording(roundTrip(CASE_ID));
  const code = mapped.steps.flatMap(step => step.code).join('\n');

  check('9: the false one emits .not.toBeChecked()',
      /expect\([^\n]*\)\.not\.toBeChecked\(\)/.test(code),
      code.split('\n').filter(line => line.includes('toBeChecked')).join(' | ') || '(no toBeChecked at all)');
  check('9: the true one emits toBeChecked() with no .not',
      code.split('\n').some(line => line.includes('.toBeChecked()') && !line.includes('.not.')),
      code.split('\n').filter(line => line.includes('toBeChecked')).join(' | '));
  check('9: exactly two checked assertions are emitted, not one and not four',
      (code.match(/toBeChecked\(\)/g) ?? []).length === 2);
  check('9: the polarity is not inverted - exactly one is negated',
      (code.match(/\.not\.toBeChecked\(\)/g) ?? []).length === 1);
  check('9: they assert against the recorded locator, not the clicked span',
      code.includes('getByLabel') && !/expect\(page\.locator\("\.ba-switch__thumb"\)\)\.[^\n]*toBeChecked/.test(code),
      code.split('\n').filter(line => line.includes('toBeChecked')).join(' | '));
}

/* ------------------- backward compatibility, and the mutation that proves it all */

function checkCompatibility(): void {
  process.stdout.write('\n== backward compatibility ==\n');
  discardArtifact(LEGACY_ID);
  // A recording saved the way every recording before P1.2c was saved: three
  // arguments, no assertions.
  persistRecording(LEGACY_ID, SCRIPT, evidenceUnavailable('recorded on the codegen transport'));
  check('a recording with no assertions writes no assertions file',
      !fs.existsSync(assertionsPath(LEGACY_ID)));
  check('readAssertions answers undefined rather than throwing',
      readAssertions(LEGACY_ID) === undefined);
  const legacy = roundTrip(LEGACY_ID);
  check('and it still parses, with its actions intact',
      legacy.actions.length === 13 && legacy.assertions.length === 0,
      `${legacy.actions.length} actions, ${legacy.assertions.length} assertions`);

  // An empty list is the same state on disk as none at all.
  persistRecording(LEGACY_ID, SCRIPT, evidenceUnavailable('none'), []);
  check('an empty assertion list writes no file either',
      !fs.existsSync(assertionsPath(LEGACY_ID)));

  // Real recordings already on disk must not need the file. None of them has one.
  const existing = fs.readdirSync(path.dirname(artifactPath(CASE_ID)))
      .filter(name => name.endsWith('.spec.ts') && !name.startsWith('TC_ASSERT_'));
  const withoutFile = existing.filter(name =>
    !fs.existsSync(assertionsPath(name.replace(/\.spec\.ts$/, ''))));
  check('every recording already on disk still reads back without one',
      withoutFile.every(name => readAssertions(name.replace(/\.spec\.ts$/, '')) === undefined),
      `${withoutFile.length} of ${existing.length} recording(s) have no assertions file`);

  process.stdout.write('\n== the mutation: remove the persisted file ==\n');
  // Prove the round trip actually depends on the file, rather than passing for some
  // other reason. This is the check that would have caught P1.2c on the day.
  const kept = fs.readFileSync(assertionsPath(CASE_ID), 'utf8');
  fs.rmSync(assertionsPath(CASE_ID), { force: true });
  const withoutAssertions = roundTrip(CASE_ID);
  check('with the file gone the recording asserts nothing - the exact P1.2c symptom',
      withoutAssertions.assertions.length === 0,
      `${withoutAssertions.assertions.length} assertion(s)`);
  check('and its actions are unaffected, so only the assertions were lost',
      withoutAssertions.actions.length === 13);
  fs.writeFileSync(assertionsPath(CASE_ID), kept, 'utf8');
  check('restoring the file restores both assertions',
      roundTrip(CASE_ID).assertions.length === 2);

  process.stdout.write('\n== the wiring, not just the helper ==\n');
  const source = fs.readFileSync('ai/autocode/from-recording.ts', 'utf8');
  const call = source.slice(source.indexOf('const source = readArtifact(testCase.testCaseId)'),
      source.indexOf('recording.startUrl ='));
  check('generateFromRecording passes them to parseRecording',
      /stateAssertions:\s*readAssertions\(testCase\.testCaseId\)/.test(call),
      call.split('\n').filter(line => line.includes('stateAssertions')).join(' | ') || '(not passed)');
  const recorderSource = fs.readFileSync('ai/dashboard/recorder.ts', 'utf8');
  // The first four arguments are still pinned IN ORDER; a fifth is allowed and is
  // asserted separately below. Phase 3 added `held.origin` - the recording's locked
  // application - and the argument order is what this check exists to protect, so it
  // is loosened only at the end rather than relaxed into a substring match.
  check('keepArtifactFor hands the picker assertions to the writer',
      /persistRecording\(testCaseId, held\.source, held\.recording\.evidence, held\.stateAssertions[,)]/
          .test(recorderSource));
  check('and hands over the recording\'s own application, not the ambient one',
      /persistRecording\([^)]*held\.origin\)/s.test(recorderSource),
      'a save must land in the project the person selected');
  check('the live stop path holds on to the UNRE-BASED assertions',
      /stateAssertions: collected\.stateAssertions,/.test(recorderSource));

  process.stdout.write('\n== discarding takes all three files ==\n');
  persistRecording(CASE_ID, SCRIPT, evidenceUnavailable('none'), [OFF, ON]);
  check('the assertions file exists before the discard', fs.existsSync(assertionsPath(CASE_ID)));
  discardArtifact(CASE_ID);
  check('discardArtifact removes the script', !fs.existsSync(artifactPath(CASE_ID)));
  check('discardArtifact removes the evidence', !fs.existsSync(evidencePath(CASE_ID)));
  check('discardArtifact removes the assertions',
      !fs.existsSync(assertionsPath(CASE_ID)),
      'a leftover would be paired by id with whatever is recorded next');
  discardArtifact(LEGACY_ID);
}

function main(): void {
  try {
    checkPersistence();
    checkReadBack();
    checkGeneration();
    checkCompatibility();
  } finally {
    // Never leave a synthetic recording behind.
    discardArtifact(CASE_ID);
    discardArtifact(LEGACY_ID);
  }
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
