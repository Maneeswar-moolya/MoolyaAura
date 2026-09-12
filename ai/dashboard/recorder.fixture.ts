import '../testing/isolated-checkout';
/**
 * Offline gate for the recording review: assertions, note visibility, credentials.
 *
 *   npx tsx ai/dashboard/recorder.fixture.ts
 *
 * Deterministic and self-contained. No browser, no model, no network, and nothing
 * is written: every check runs the REAL functions over codegen-shaped source, the
 * same reasoning as `requirements.fixture.ts` - testing a reimplementation of a
 * security control proves only that the reimplementation works.
 *
 * The two bugs this pins down were invisible to every existing check. The warning
 * was correct in the data and wrong on the screen, and the credential marker was
 * correct as a marker and unparseable as a value, so both looked fine from the side
 * anybody was looking at. Section 6 therefore reads the page itself: the visibility
 * rule lives in HTML and CSS, where no unit test reaches.
 *
 * SECURITY: this file compares against real secrets and never prints one. A failing
 * check reports the NAME of the thing that leaked, never the value.
 */

import fs from 'node:fs';
import path from 'node:path';

import { mapRecording, assembleSpec } from '../autocode/from-recording';
import { parseInputs, parseToken } from '../excel/data-driven';
import type { TestCase } from '../excel/types';

import {
  NEEDS_CONFIRMATION, expectedResultFrom, parseRecording, redactSourceForTest,
  stepsFrom, testDataFrom, toDraft, type Recording,
} from './recorder';

const ROOT = path.resolve(__dirname, '..', '..');

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition)
    failures += 1;
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail && !condition ? ` -- ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

/** A synthetic secret, so guard 2 is exercised without touching the real one. */
const SYNTHETIC_SECRET = 'not-the-real-one-7f3a91';

function record(source: string): Recording {
  return parseRecording(source, {
    startUrl: 'https://portal.fixture.invalid/',
    browser: 'chromium',
    durationMs: 12_345,
  });
}

/** What Codegen writes for a sign-in followed by three visibility assertions. */
const SIGN_IN_WITH_ASSERTIONS = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.fixture.invalid/');
  await page.getByRole('textbox', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill('qa.user@moolya.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('${SYNTHETIC_SECRET}');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText('Multi tasking is hard. Focus')).toBeVisible();
  await expect(page.getByText('Faclon labs')).toBeVisible();
  await expect(page.getByText('FixturePortal Live Support')).toBeVisible();
});
`;

/** The same flow with nothing asserted - the case the warning is actually for. */
const SIGN_IN_NO_ASSERTIONS = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.fixture.invalid/');
  await page.getByRole('textbox', { name: 'Email' }).fill('qa.user@moolya.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('${SYNTHETIC_SECRET}');
  await page.getByRole('button', { name: 'Sign In' }).click();
});
`;

/** No sign-in at all: browsing, then one assertion. */
const NO_AUTHENTICATION = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.fixture.invalid/apps');
  await page.getByRole('link', { name: 'Following' }).click();
  await expect(page.getByText('Faclon labs')).toBeVisible();
});
`;

/**
 * A password typed into a field Codegen could not name, so only the second guard -
 * "this equals a secret this process holds" - can catch it.
 */
const ODDLY_LABELLED_SECRET = `
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.fixture.invalid/');
  await page.getByRole('textbox', { name: 'Div' }).fill('${SYNTHETIC_SECRET}');
  await page.getByRole('button', { name: 'Sign In' }).click();
});
`;

// The guard reads process.env at call time. Setting it here is process-local and
// never written anywhere; the real value is left untouched and unread.
process.env.FIXTUREAPP_PASSWORD = SYNTHETIC_SECRET;

/* ------------------------------------------------- A: assertions and the warning */

section('Test A - assertions, and when "Needs confirmation" is shown');

const withAsserts = record(SIGN_IN_WITH_ASSERTIONS);
const withAssertsDraft = toDraft(withAsserts);

check('three recorded assertions are parsed',
    withAsserts.assertions.length === 3, `got ${withAsserts.assertions.length}`);
check('the count the review card reads is 3',
    withAsserts.metrics.assertionCount === 3, `got ${withAsserts.metrics.assertionCount}`);
check('every assertion keeps its target',
    withAsserts.assertions.map(a => a.target).join(' | ')
      === 'Multi tasking is hard. Focus | Faclon labs | FixturePortal Live Support',
    withAsserts.assertions.map(a => a.target).join(' | '));
check('all three are visibility assertions',
    withAsserts.assertions.every(a => a.type === 'visible'));
check('needsConfirmation is FALSE when assertions exist',
    withAssertsDraft.needsConfirmation === false);
check('the expected result is composed from the assertions, not the actions',
    withAssertsDraft.expectedResult
      === 'Multi tasking is hard. Focus is visible; Faclon labs is visible; '
        + 'FixturePortal Live Support is visible',
    withAssertsDraft.expectedResult);

const noAsserts = record(SIGN_IN_NO_ASSERTIONS);
const noAssertsDraft = toDraft(noAsserts);

check('a recording with no assertion still parses its actions',
    noAsserts.actions.length > 0 && noAsserts.assertions.length === 0);
check('needsConfirmation is TRUE when nothing was asserted',
    noAssertsDraft.needsConfirmation === true);
check('the expected result is the literal placeholder, never invented from the actions',
    noAssertsDraft.expectedResult === NEEDS_CONFIRMATION, noAssertsDraft.expectedResult);

/* ------------------------------------------------------ B: the authentication note */

section('Test B - authentication detection');

check('a filled-and-submitted sign-in form is detected',
    withAsserts.authentication.detected === true);
check('the evidence names fields only',
    withAsserts.authentication.evidence === 'a sign-in form was filled in and submitted (Email, Password)',
    withAsserts.authentication.evidence ?? '(none)');
check('the evidence carries no value, only names',
    !JSON.stringify(withAsserts.authentication).includes(SYNTHETIC_SECRET));

const anonymous = record(NO_AUTHENTICATION);
check('a recording with no sign-in reports detected: false',
    anonymous.authentication.detected === false);
check('and carries no evidence string to render',
    anonymous.authentication.evidence === undefined,
    String(anonymous.authentication.evidence));
check('the signed-in tag is absent from an anonymous recording',
    !toDraft(anonymous).tags.includes('signed-in'), toDraft(anonymous).tags);

/* -------------------------------------------------- C: how a password is written down */

section('Test C - the password in the steps and in Test Data');

const passwordAction = withAsserts.actions.find(a => a.target === 'Password');

check('the password fill is marked redacted',
    passwordAction?.redacted === true);
check('the steps table still shows the honest redaction marker',
    passwordAction?.value === '[type=password]', String(passwordAction?.value));
check('the prose step names the field and carries no value',
    stepsFrom(withAsserts).includes('Enter the password'),
    stepsFrom(withAsserts).join(' / '));

const testData = testDataFrom(withAsserts);
check('Test Data uses the workbook token for the password',
    testData.includes('Password = <valid-password>'), testData.join(' / '));
check('Test Data no longer contains the redaction marker',
    !testData.join('\n').includes('[type=password]'), testData.join(' / '));
check('the recorded email is unchanged by this phase',
    testData.includes('Email = qa.user@moolya.com'), testData.join(' / '));

const anonymousData = testDataFrom(anonymous);
check('a recording with no sign-in gets no credential token invented for it',
    !anonymousData.join('\n').includes('<valid-password>'), anonymousData.join(' / '));

const oddly = record(ODDLY_LABELLED_SECRET);
check('a secret in an unnameable field is caught by the value guard',
    oddly.actions.find(a => a.type === 'fill')?.redacted === true);
check('and that recording reads as a sign-in, so it gets the token too',
    testDataFrom(oddly).some(line => line.endsWith('= <valid-password>')),
    testDataFrom(oddly).join(' / '));

/* ------------------------------------------------------- D: the existing token parser */

section('Test D - the token parser, unchanged');

check('<valid-password> still resolves to the validPassword token',
    JSON.stringify(parseToken('<valid-password>')) === '{"kind":"validPassword"}',
    JSON.stringify(parseToken('<valid-password>')));

const parsedData = parseInputs(testDataFrom(withAsserts).join('\n'));
check('the recorded Test Data parses without error',
    !('error' in parsedData), (parsedData as { error?: string }).error ?? '');
check('password is NOT a literal any more, so credentialProblems cannot fire',
    !('error' in parsedData)
      && (parsedData as Record<string, { kind: string }>).password?.kind === 'validPassword',
    JSON.stringify(parsedData));

// The old behaviour, kept as the thing that must not come back.
const oldStyle = parseInputs('Password = [type=password]');
check('the marker WOULD still parse as a literal - which is why it is no longer written',
    !('error' in oldStyle)
      && (oldStyle as Record<string, { kind: string }>).password?.kind === 'literal');

/* --------------------------------------------------------------- E: security sweep */

section('Test E - the secret reaches nothing');

const artifact = redactSourceForTest(SIGN_IN_WITH_ASSERTIONS, withAsserts);
const surfaces: Array<[string, string]> = [
  ['the recording object', JSON.stringify(withAsserts)],
  ['the draft sent to /api/case', JSON.stringify(withAssertsDraft)],
  ['Test Data (the workbook)', testDataFrom(withAsserts).join('\n')],
  ['Steps (the workbook)', stepsFrom(withAsserts).join('\n')],
  ['the expected result', expectedResultFrom(withAsserts)],
  ['the kept recording artifact', artifact],
  ['the oddly-labelled recording', JSON.stringify(oddly)],
  ['its artifact', redactSourceForTest(ODDLY_LABELLED_SECRET, oddly)],
];
for (const [name, text] of surfaces)
  check(`no secret in ${name}`, !text.includes(SYNTHETIC_SECRET));

check('the artifact keeps the marker, so it is readable and inert',
    artifact.includes("fill('[type=password]')"));
check('the artifact keeps its locators and assertions intact',
    artifact.includes("getByText('Faclon labs')") && artifact.includes('toBeVisible'));

// Guard 2 reads whatever the environment holds. If a real secret is present, prove
// the same surfaces reject it - by comparison only. The value is never printed.
const realSecret = fs.existsSync(path.join(ROOT, '.env'))
  ? (/^FIXTUREAPP_PASSWORD\s*=\s*(.+)$/m.exec(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'))?.[1] ?? '').trim()
  : '';
if (realSecret.length >= 4) {
  const live = record(SIGN_IN_WITH_ASSERTIONS.replace(SYNTHETIC_SECRET, realSecret));
  check('the REAL password is redacted by the same path (value never printed)',
      !JSON.stringify(live).includes(realSecret)
      && !testDataFrom(live).join('\n').includes(realSecret)
      && !redactSourceForTest(SIGN_IN_WITH_ASSERTIONS.replace(SYNTHETIC_SECRET, realSecret), live)
          .includes(realSecret));
} else {
  console.log('  [SKIP] no FIXTUREAPP_PASSWORD in .env, so the live-secret sweep did not run');
}

/* ------------------------------------- F: the deterministic recorded generation path */

section('Test F - record -> map -> spec, deterministically and offline');

const testCase = {
  testCaseId: 'TC_FIXTURE_001',
  scenario: 'Sign In — Faclon labs is visible',
  module: 'Login',
  feature: '',
  priority: 'P1',
  tags: ['recorded', 'signed-in'],
  steps: stepsFrom(withAsserts),
  testData: testDataFrom(withAsserts).join('\n'),
  expectedResult: withAssertsDraft.expectedResult,
  preconditions: '',
  status: 'Not Automated',
  source: { worksheet: 'Login', row: 99 },
} as unknown as TestCase;

const mapping = mapRecording(withAsserts);
const spec = assembleSpec(testCase, mapping, 'excel/fixture-cases.xlsx');

check('the recorded sign-in maps to the existing fixture, not to recorded values',
    mapping.authenticated === true && mapping.fixtures.has('appCredentials'));
check('the spec guards on requireCredentials',
    spec.includes('requireCredentials(appCredentials)'));
check('the spec signs in through the Page Object',
    /\.signIn\(appCredentials\.email, appCredentials\.password\)/.test(spec));
check('the spec carries the traceability the gate checks',
    spec.includes("testCaseId: 'TC_FIXTURE_001'") && spec.includes('TC_FIXTURE_001 - '));
// ALL THREE ARE ACCOUNTED FOR, AND NOT ONE OF THEM IS EMITTED.
//
// This recording is a Codegen script with no DOM evidence, and all three assertions
// are unscoped `getByText` locators - the one shape whose uniqueness nothing offline
// can judge, and the shape the strict-mode gate refuses. TC_LOGIN_096 is why: it
// asserted `getByText("Projects")` and Playwright resolved it to three elements.
//
// This check used to require three `expect(` in the spec, which is what a recording
// whose text locators had been MEASURED would produce. Unmeasured, the honest outcome
// is three steps for a person - so what is asserted is that nothing was silently
// dropped, and that the assembled spec cannot claim coverage it does not have.
check('all three recorded assertions are accounted for as steps for a person',
    mapping.needsReview.filter(step => step.from.startsWith('assert')).length === 3,
    mapping.needsReview.map(step => step.from).join(', '));
check('each refusal names the measurement it is missing',
    mapping.needsReview.filter(step => step.from.startsWith('assert'))
        .every(step => /never measured|identified \d+ elements/.test(step.why)),
    mapping.needsReview[0]?.why.slice(0, 90) ?? '');
check('and none of them is emitted as an assertion that checked nothing',
    (spec.match(/expect\(/g) ?? []).length === 0,
    String((spec.match(/expect\(/g) ?? []).length));
check('the spec contains no secret and no credential token',
    !spec.includes(SYNTHETIC_SECRET) && !spec.includes('<valid-password>'));
check('the spec never mentions the redaction marker',
    !spec.includes('[type=password]'));

/* ------------------------------------------------ 6: the review page's own visibility */

section('Test A/B (page) - the rule lives in HTML, so read the HTML');

const page = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'public', 'index.html'), 'utf8');

check('recNeedsConfirm no longer carries a static `show` class',
    /<div id="recNeedsConfirm" class="note">/.test(page));
check('recAuthNote no longer carries a static `show` class',
    /<div id="recAuthNote" class="note info">/.test(page));
check('neither note is toggled through the `hidden` property any more',
    !/\$\('recNeedsConfirm'\)\.hidden/.test(page) && !/\$\('recAuthNote'\)\.hidden/.test(page));
check('the warning is toggled by class, on "no assertions" (both call sites)',
    (page.match(/\$\('recNeedsConfirm'\)\.classList\.toggle\('show', recAsserts\.length === 0\)/g) ?? [])
        .length === 2);
check('the authentication note is toggled by class, on detected === true',
    page.includes("$('recAuthNote').classList.toggle('show', auth.detected === true)"));
check('the page mirrors the credential rule the server applies',
    page.includes("const CREDENTIAL_TOKEN = '<valid-password>';")
      && /step\.redacted && signedIn \? CREDENTIAL_TOKEN/.test(page));
check('the steps table still renders the redaction marker',
    page.includes("el('span', 'redacted', '[type=password]')"));
check('no global !important visibility rule was introduced',
    !/\[hidden\][^{]*\{[^}]*!important/.test(page));

/* ------------------------------------------------------------------------ summary */

console.log(`\n${'='.repeat(60)}`);
console.log(`${checks - failures}/${checks} checks passed`);
console.log('='.repeat(60));
process.exit(failures ? 1 : 0);
