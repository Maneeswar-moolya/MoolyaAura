import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceData } from '../testing/workspace-data';
import { resolveScope } from '../projects/scope';
import { readTestData, updateTestData } from '../test-data/store';
import { openRecordingCredentials, closeRecordingCredentials, recordingCredentialProfileId,
  parseRecording, credentialProvenance, redactSource, startRecording, recordingStatus,
  persistRecording, evidencePath } from './recorder';
import { credentialFieldOf } from '../autocode/from-recording';

/**
 * A DASHBOARD RECORDING MUST PROTECT THE ACCOUNT NAME, NOT ONLY THE PASSWORD.
 *
 * An EXECUTION carries an execution selection, so the recorder could resolve the profile in
 * use and recognise both halves of it. A RECORDING carries none - nobody has chosen an
 * Example row, and the test case being recorded may not exist yet - so the recorder held
 * nothing to compare against. The password still survived, because the field is called
 * "password"; the account identifier typed into "Sign-in ID" looked like ordinary business
 * data and was written into the recording verbatim. Protection by label is exactly what
 * provenance exists to replace, and this is the surface where only the label was left.
 *
 * Naming the credential profile when the recording STARTS is the fix. Synthetic values only;
 * nothing here reads, writes or prints a real credential.
 */
const PROFILE_ACCOUNT = 'recording-profile@example.invalid';
const PROFILE_SECRET = 'synthetic-recording-password-5518';
const UNNAMED_ACCOUNT = 'unnamed-profile@example.invalid';
const BUSINESS = 'customer-contact@example.invalid';
const DATA = 'Northwind Trading';

const { scope } = workspaceData();
delete process.env.AURA_EXECUTION_SELECTION;
const active = resolveScope({ applicationId: 'north', environmentId: 'qa' });
const other = resolveScope({ applicationId: 'south', environmentId: 'qa' });

let checks = 0;
const check = (name: string, run: () => void) => {
  try { run(); } catch (error: any) { throw new Error(`FAIL ${name}: ${error?.message ?? error}`); }
  checks++; console.log('PASS ' + name);
};

const sourceOf = (lines: string[]) =>
  `import { test, expect } from '@playwright/test';\ntest('recorded', async ({ page }) => {\n${lines.map(l => '  ' + l).join('\n')}\n});\n`;
/** Every sign-in field here is labelled NEUTRALLY. That is the shape that leaked. */
const signInSource = (account: string, secret: string) => sourceOf([
  `await page.goto('https://portal.example.invalid/signin');`,
  `await page.getByLabel('Sign-in ID').fill('${account}');`,
  `await page.getByLabel('Passcode').fill('${secret}');`,
  `await page.getByRole('button', { name: 'Continue' }).click();`,
  `await page.getByLabel('Customer contact email').fill('${BUSINESS}');`,
  `await page.getByLabel('Company').fill('${DATA}');`,
]);
const parse = (source: string) => parseRecording(source, {
  startUrl: 'https://portal.example.invalid/signin', browser: 'chromium', durationMs: 0,
  evidence: { available: false, reason: 'synthetic recording credential contract' } as any,
});
const fillsOf = (source: string) => parse(source).actions.filter(action => action.type === 'fill');

// A profile in THIS application, created through the real store so the password is really
// encrypted and really decrypted - a hand-made fake would prove nothing about resolution.
const created = updateTestData(active, readTestData(active).version, {
  kind: 'credential',
  profile: { name: 'Recording user', role: 'Tester',
    environments: { qa: { username: PROFILE_ACCOUNT, password: PROFILE_SECRET } } },
} as any);
const profile = created.credentialProfiles.find(item => item.name === 'Recording user')!;

// ---- 1. WITHOUT a named profile: the gap, measured rather than assumed.
const unnamed = fillsOf(signInSource(UNNAMED_ACCOUNT, 'unnamed-only-password-9902'));
const labelled = fillsOf(sourceOf([
  `await page.getByLabel('Password').fill('unnamed-only-password-9902');`,
]));
check('with no profile named, only a field literally labelled password is protected', () => {
  assert.equal(labelled[0].redacted, true, 'the label guard still covers the obvious case');
  assert.equal(labelled[0].valueSource, undefined, 'but nothing can say WHICH credential it is');
});
check('with no profile named, a neutrally labelled sign-in leaks both halves - the gap', () => {
  assert.equal(unnamed[0].value, UNNAMED_ACCOUNT, 'the account identifier is kept verbatim');
  assert.equal(unnamed[0].redacted, undefined);
  assert.equal(unnamed[1].value, 'unnamed-only-password-9902',
    'and "Passcode" is not the word the label guard looks for - naming the profile is what closes this');
});

// ---- 2. WITH the profile named at Start.
openRecordingCredentials(active, profile.id);
const named = fillsOf(signInSource(PROFILE_ACCOUNT, PROFILE_SECRET));
check('a named profile protects the account identifier despite a neutral label', () => {
  assert.equal(named[0].redacted, true);
  assert.notEqual(named[0].value, PROFILE_ACCOUNT, 'the identifier is never persisted literally');
  assert.equal(named[0].valueSource?.kind, 'CREDENTIAL_PROFILE');
  assert.equal(named[0].valueSource?.field, 'email');
  assert.equal(named[0].valueSource?.sensitivity, 'SENSITIVE');
});
check('a named profile protects the password and classifies it SECRET', () => {
  assert.equal(named[1].redacted, true);
  assert.notEqual(named[1].value, PROFILE_SECRET);
  assert.equal(named[1].valueSource?.kind, 'CREDENTIAL_PROFILE');
  assert.equal(named[1].valueSource?.field, 'password');
  assert.equal(named[1].valueSource?.sensitivity, 'SECRET');
});
check('ordinary business data is still recorded - this is not a label sweep', () => {
  assert.equal(named[2].value, BUSINESS, 'a business email that is not the credential survives');
  assert.equal(named[2].redacted, undefined);
  assert.equal(named[3].value, DATA);
});
check('generation is handed the semantic field, not a guess', () => {
  assert.equal(credentialFieldOf(named[0] as any), 'email');
  assert.equal(credentialFieldOf(named[1] as any), 'password');
});

// ---- 3. The values never leave this process.
check('the profile is exposed by ID only, never by value', () => {
  assert.equal(recordingCredentialProfileId(), profile.id);
  const serialised = JSON.stringify({ status: recordingStatus(), id: recordingCredentialProfileId() });
  assert.ok(!serialised.includes(PROFILE_ACCOUNT), 'the account reached a client-visible payload');
  assert.ok(!serialised.includes(PROFILE_SECRET), 'the password reached a client-visible payload');
});
check('a credential outside a modelled fill is swept from the recorded source', () => {
  const leaky = signInSource(PROFILE_ACCOUNT, PROFILE_SECRET).replace(
    "await page.goto('https://portal.example.invalid/signin');",
    `await page.goto('https://portal.example.invalid/signin?user=${PROFILE_ACCOUNT}');\n  // resumed as ${PROFILE_ACCOUNT} with ${PROFILE_SECRET}`);
  const scrubbed = redactSource(leaky, parse(leaky) as any);
  assert.ok(!scrubbed.includes(PROFILE_ACCOUNT), 'an account identifier survived in a URL or comment');
  assert.ok(!scrubbed.includes(PROFILE_SECRET), 'a password survived in a URL or comment');
  assert.ok(scrubbed.includes(BUSINESS), 'ordinary data must survive redaction');
});
check('provenance is a comparison, never a disclosure', () => {
  assert.equal(credentialProvenance(PROFILE_ACCOUNT)?.field, 'email');
  assert.equal(credentialProvenance(PROFILE_SECRET)?.field, 'password');
  assert.equal(credentialProvenance(BUSINESS), null);
});

// ---- 4. The session ends and the semantics end with it - protection does not.
closeRecordingCredentials();
check('stopping the recording drops the values but never weakens protection', () => {
  assert.equal(recordingCredentialProfileId(), undefined, 'no profile is held between sessions');
  const after = fillsOf(signInSource(PROFILE_ACCOUNT, PROFILE_SECRET));
  assert.equal(after[0].valueSource, undefined, 'the session-scoped semantics are gone');
  assert.equal(after[0].redacted, true,
    'a value this process decrypted stays protected; only the claim about WHICH field it is expires');
  assert.notEqual(after[0].value, PROFILE_ACCOUNT);
});

// ---- 5. Refusals, and isolation.
//
// Checked through `openRecordingCredentials` FIRST and deliberately: a mutant that swallows
// the resolution failure would otherwise let `startRecording` proceed to open a real browser
// inside a contract run. These fail before that can happen.
check('a profile that cannot be resolved throws rather than recording unprotected', () => {
  assert.throws(() => openRecordingCredentials(active, 'cred_does_not_exist'),
    /CREDENTIAL_CONFIGURATION_FAILURE/, 'recording unprotected is the leak; refusing is the answer');
  assert.equal(recordingCredentialProfileId(), undefined, 'nothing is held after a refusal');
});
check('another application cannot open this application\'s profile', () => {
  assert.throws(() => openRecordingCredentials(other, profile.id), /CREDENTIAL_CONFIGURATION_FAILURE/);
  assert.equal(readTestData(other).credentialProfiles.length, 0, 'and it sees no profile of this one');
});
check('a recording that signs in with nothing needs no profile', () => {
  openRecordingCredentials(active, undefined);
  assert.equal(recordingCredentialProfileId(), undefined);
});

async function refusals(): Promise<void> {
  // And the same refusal through the route the dashboard actually calls.
  const unknown = await startRecording({ scope: active, browser: 'chromium', credentialProfileId: 'cred_does_not_exist' });
  check('naming a profile that cannot be resolved refuses the recording', () => {
    assert.equal(unknown.started, false);
    assert.match(String(unknown.error), /CREDENTIAL_CONFIGURATION_FAILURE/);
    assert.equal(recordingStatus().recording, false, 'no session was left behind');
    assert.ok(!String(unknown.error).includes(PROFILE_SECRET), 'an error is not a disclosure channel');
  });

  // ---- 6. END TO END, through the real save path rather than around it.
  //
  // Everything above tested the decision. This tests the FILES: a recording made with a named
  // profile, redacted and persisted exactly as a Save does, with its evidence sidecar written
  // whether or not evidence was captured. The scan below then reads what is actually on disk.
  openRecordingCredentials(active, profile.id);
  const e2eSource = signInSource(PROFILE_ACCOUNT, PROFILE_SECRET);
  const e2eRecording = parse(e2eSource);
  const origin = { applicationId: 'north', environmentId: 'qa', baseUrl: 'https://portal.example.invalid/' } as any;
  persistRecording('TC_RECCRED', redactSource(e2eSource, e2eRecording as any), e2eRecording.evidence, undefined, origin);
  closeRecordingCredentials();
  const spec = path.join(scope.paths.recordingsDir, 'TC_RECCRED.spec.ts');
  check('the saved recording is on disk and holds neither half of the credential', () => {
    assert.ok(fs.existsSync(spec), 'the recording was saved');
    const text = fs.readFileSync(spec, 'utf8');
    assert.ok(!text.includes(PROFILE_ACCOUNT), 'the account identifier reached the saved spec');
    assert.ok(!text.includes(PROFILE_SECRET), 'the password reached the saved spec');
    assert.ok(text.includes(BUSINESS), 'and ordinary recorded data is still there to generate from');
  });
  check('the saved recording still records whether its evidence is admissible', () => {
    const sidecar = evidencePath('TC_RECCRED', scope.paths.recordingsDir);
    assert.ok(fs.existsSync(sidecar), 'a recording that cannot generate must not look ready');
    const parsed = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    assert.equal(parsed.available, false);
    assert.equal(parsed.origin.applicationId, 'north');
  });

  // ---- 7. Nothing produced holds a synthetic value.
  const protectedValues = [PROFILE_ACCOUNT, PROFILE_SECRET];
  const scanned: string[] = []; const hits: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      scanned.push(file);
      const text = fs.readFileSync(file).toString('utf8');
      for (const value of protectedValues) if (text.includes(value)) hits.push(file);
    }
  };
  for (const dir of [scope.paths.recordingsDir, scope.paths.generatedDir,
    path.join(process.cwd(), 'ai/diagnostics/artifacts')]) walk(dir);
  check(`secret scan across ${scanned.length} produced artifact(s) finds no protected value`, () =>
    assert.deepEqual(hits, [], 'a protected value reached a persisted artifact'));

  console.log(`${checks} recording credential contracts passed`);
}
refusals().catch(error => { console.error(error); process.exitCode = 1; });
