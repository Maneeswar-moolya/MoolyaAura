import '../testing/isolated-checkout';
/**
 * P0 — a recorded assertion must mean what the person recorded.
 *
 *   npx tsx ai/dashboard/negated-assertions.fixture.ts
 *
 * Offline: no browser, no model, no network.
 *
 * THE DEFECT THIS PINS
 *
 * `expect(x).not.toBeChecked()` is what Playwright's recorder writes when
 * somebody asserts that a box is NOT ticked. The parser looked up the matcher
 * by name and took the locator with `receiver.slice('expect('.length, -1)` -
 * which assumes the receiver ends in `)`. With `.not` on the end it produced:
 *
 *   { type: 'checked', locator: "page.locator('#b')).no" }
 *
 * The `.not.` was gone, so the generated spec asserted the box WAS ticked: the
 * exact reverse of what was recorded, passing or failing for reasons unrelated
 * to what anybody watched. The locator was corrupted as well, which at least
 * would have failed loudly - the inversion would not.
 *
 * The fix is structural: `parseExpectReceiver` finds the parenthesis that
 * actually closes `expect(`, so the locator survives byte-for-byte whatever
 * brackets it contains, and only two remainders are accepted - nothing, or
 * `.not`. Anything else is refused rather than guessed at.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseExpectReceiver, parseRecording, assertionPhrase, type RecordedAssertion } from './recorder';
import { mapRecording } from '../autocode/from-recording';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const script = (lines: string[]): string => [
  `import { test, expect } from '@playwright/test';`,
  `test('t', async ({ page }) => {`,
  `  await page.goto('https://example.test/');`,
  ...lines.map(line => `  ${line}`),
  `});`,
].join('\n');

function parse(lines: string[]): RecordedAssertion[] {
  return parseRecording(script(lines), { startUrl: '', browser: '', durationMs: 0 }).assertions;
}

/* ------------------------------------------------- 1-6: every negated form */

function checkNegatedParsing(): void {
  process.stdout.write('\n== 1-6 — every negated matcher the recorder can write ==\n');
  const cases: Array<[string, string, RecordedAssertion['type'], string | null]> = [
    ['1. not.toBeChecked', `await expect(page.locator('#b')).not.toBeChecked();`, 'checked', null],
    ['2. not.toBeVisible', `await expect(page.locator('#b')).not.toBeVisible();`, 'visible', null],
    ['3. not.toBeEmpty', `await expect(page.locator('#b')).not.toBeEmpty();`, 'empty', null],
    ['4. not.toContainText', `await expect(page.locator('#b')).not.toContainText('hello');`, 'contains', 'hello'],
    ['5. not.toHaveText', `await expect(page.locator('#b')).not.toHaveText('hello');`, 'text', 'hello'],
    ['6. not.toHaveValue', `await expect(page.locator('#b')).not.toHaveValue('hello');`, 'value', 'hello'],
  ];
  for (const [label, line, type, value] of cases) {
    const [assertion] = parse([line]);
    check(`${label} parses`, Boolean(assertion), line);
    if (!assertion)
      continue;
    check(`${label} → type ${type}`, assertion.type === type, assertion.type);
    check(`${label} → expected false`, assertion.expected === false, String(assertion.expected));
    check(`${label} → value preserved`, assertion.value === value, String(assertion.value));
    check(`${label} → locator intact`, assertion.locator === `page.locator('#b')`, assertion.locator);
  }
}

/* ------------------------------------------------------ 7: the locator */

function checkLocatorPreservation(): void {
  process.stdout.write('\n== 7 — the locator survives byte-for-byte ==\n');
  const locators = [
    `page.locator('#b')`,
    `page.getByText('a)b')`,
    `page.getByRole('button', { name: 'Sign In', exact: true })`,
    `page.locator('#tc_summary_1').getByText('Line Chart | Time Config Page')`,
    `page.getByText("it's (here)")`,
    `page.locator('#a').filter({ hasText: 'x) y' })`,
  ];
  for (const locator of locators) {
    const [positive] = parse([`await expect(${locator}).toBeVisible();`]);
    const [negative] = parse([`await expect(${locator}).not.toBeVisible();`]);
    check(`positive: ${locator.slice(0, 46)}`, positive?.locator === locator, positive?.locator ?? '(none)');
    check(`negated : ${locator.slice(0, 46)}`, negative?.locator === locator, negative?.locator ?? '(none)');
  }
  check('7: no locator ends in a broken chain',
      !parse([`await expect(page.locator('#b')).not.toBeChecked();`])[0].locator.endsWith('.no'));
}

/* --------------------------------------------- 8: positives are unchanged */

function checkPositivesUnchanged(): void {
  process.stdout.write('\n== 8 — every positive assertion behaves exactly as before ==\n');
  const positives: Array<[string, RecordedAssertion['type'], string | null]> = [
    [`await expect(page.locator('#a')).toBeVisible();`, 'visible', null],
    [`await expect(page.locator('#a')).toBeHidden();`, 'hidden', null],
    [`await expect(page.locator('#a')).toHaveText('x');`, 'text', 'x'],
    [`await expect(page.locator('#a')).toContainText('x');`, 'contains', 'x'],
    [`await expect(page.locator('#a')).toHaveValue('x');`, 'value', 'x'],
    [`await expect(page.locator('#a')).toBeChecked();`, 'checked', null],
    [`await expect(page).toHaveURL('https://x/');`, 'url', 'https://x/'],
    [`await expect(page.locator('#a')).toHaveCount(3);`, 'count', '3'],
    [`await expect(page).toHaveTitle('T');`, 'title', 'T'],
  ];
  for (const [line, type, value] of positives) {
    const [assertion] = parse([line]);
    check(`8: ${type}`, assertion?.type === type && assertion.value === value
      && assertion.expected === true, JSON.stringify(assertion ?? null).slice(0, 90));
  }

  process.stdout.write('\n   modifiers this parser has never been taught are REFUSED, not guessed\n');
  for (const modifier of ['.soft', '.resolves', '.rejects', '.poll']) {
    check(`8: ${modifier} is not read as an assertion`,
        parse([`await expect(page.locator('#a'))${modifier}.toBeVisible();`]).length === 0);
  }
  check('8: parseExpectReceiver refuses an unknown tail',
      parseExpectReceiver(`expect(page.locator('#a')).soft`) === null);
  check('8: and accepts the two it knows',
      parseExpectReceiver(`expect(page.locator('#a'))`)?.negated === false
      && parseExpectReceiver(`expect(page.locator('#a')).not`)?.negated === true);
}

/* ------------------------------------------- generation, deterministically */

function generatedFor(assertion: Partial<RecordedAssertion>): string {
  const recording = {
    testCaseId: 'TC_NEG_1', startUrl: 'https://example.test/',
    actions: [{ type: 'navigate', target: 'https://example.test/', locator: '', locatorStrategy: 'url', value: 'https://example.test/' }],
    assertions: [{
      type: 'visible', target: '#a', locator: `page.locator('#a')`, locatorStrategy: 'css',
      value: null, afterActions: 1, ...assertion,
    }],
    evidence: { available: false, reason: 'fixture' },
  };
  const mapping = mapRecording(recording as never);
  return (mapping.steps as Array<{ code?: string[] }>)
      .flatMap(step => step.code ?? []).find(line => line.includes('expect(')) ?? '(nothing emitted)';
}

function checkGeneration(): void {
  process.stdout.write('\n== generation — the matcher a person recorded ==\n');
  const cases: Array<[string, Partial<RecordedAssertion>, string]> = [
    ['visible true', { type: 'visible', expected: true }, '.toBeVisible();'],
    ['visible false', { type: 'visible', expected: false }, '.toBeHidden();'],
    ['hidden true', { type: 'hidden', expected: true }, '.toBeHidden();'],
    ['hidden false', { type: 'hidden', expected: false }, '.toBeVisible();'],
    ['checked true', { type: 'checked', expected: true }, '.toBeChecked();'],
    ['checked false', { type: 'checked', expected: false }, '.not.toBeChecked();'],
    ['empty true', { type: 'empty', expected: true }, '.toBeEmpty();'],
    ['empty false', { type: 'empty', expected: false }, '.not.toBeEmpty();'],
    ['text false', { type: 'text', expected: false, value: 'x' }, `.not.toHaveText('x');`],
    ['contains false', { type: 'contains', expected: false, value: 'x' }, `.not.toContainText('x');`],
    ['value false', { type: 'value', expected: false, value: 'x' }, `.not.toHaveValue('x');`],
    ['count false', { type: 'count', expected: false, value: '3' }, '.not.toHaveCount(3);'],
    // Absent `expected` is the old shape and must still mean "is true".
    ['legacy checked (no expected)', { type: 'checked' }, '.toBeChecked();'],
    ['legacy visible (no expected)', { type: 'visible' }, '.toBeVisible();'],
  ];
  for (const [label, assertion, expectedCode] of cases) {
    const code = generatedFor(assertion);
    check(`generates ${label}`, code.endsWith(expectedCode), code);
  }
  check('nothing generated uses a matcher Playwright does not have',
      !cases.some(([, assertion]) => generatedFor(assertion).includes('toBeSelected')));
}

/* ------------------------------------------------------------- wording */

function checkPhrasing(): void {
  process.stdout.write('\n== the workbook sentence a person reads ==\n');
  const phrase = (over: Partial<RecordedAssertion>) => assertionPhrase({
    type: 'checked', target: 'Accept Terms', locator: '', locatorStrategy: 'css', value: null, ...over,
  } as RecordedAssertion);
  check('checked true', phrase({}) === 'Accept Terms is ticked', phrase({}));
  check('checked false', phrase({ expected: false }) === 'Accept Terms is not ticked',
      phrase({ expected: false }));
  check('visible false', phrase({ type: 'visible', expected: false }) === 'Accept Terms is not visible');
  check('contains false',
      phrase({ type: 'contains', expected: false, value: 'x' }) === 'Accept Terms does not contain "x"');
  check('empty true', phrase({ type: 'empty' }) === 'Accept Terms is empty');
  check('a legacy assertion reads exactly as it always did',
      phrase({ type: 'contains', value: 'x' }) === 'Accept Terms contains "x"');
}

/* -------------------------------------- the recordings that already exist */

function checkExistingRecordings(): void {
  process.stdout.write('\n== the 20+ recordings on disk ==\n');
  const dir = RECORDINGS();
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.spec.ts'));
  let parsed = 0;
  let negatives = 0;
  let mismatched: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const assertions = parseRecording(source, { startUrl: '', browser: '', durationMs: 0 }).assertions;
    parsed += assertions.length;
    negatives += assertions.filter(a => a.expected === false).length;
    // Every `expect(` line in the file should still become an assertion.
    const lines = source.split('\n').filter(line => line.trim().startsWith('await expect(')).length;
    if (lines !== assertions.length)
      mismatched.push(`${file}: ${lines} lines vs ${assertions.length} parsed`);
  }
  check(`all ${files.length} recordings still parse`, parsed > 0, `${parsed} assertion(s)`);
  check('every expect() line still becomes an assertion', mismatched.length === 0, mismatched.join('; '));
  check('none of them is negated - so none changes meaning', negatives === 0, String(negatives));
}

function main(): void {
  checkNegatedParsing();
  checkLocatorPreservation();
  checkPositivesUnchanged();
  checkGeneration();
  checkPhrasing();
  checkExistingRecordings();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
