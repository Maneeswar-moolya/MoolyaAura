import '../testing/isolated-checkout';
/**
 * The recorder's output language decides whether assertions survive at all.
 *
 *   npx tsx ai/autocode/recorder-language.fixture.ts
 *
 * Offline; no browser, no model. This pins the defect that lost TC_LOGIN_053 and
 * TC_LOGIN_054.
 *
 * Playwright's recorder emits a `javascript` (library) script with its assertions
 * COMMENTED OUT - `expect` is not importable there, so a live assertion would not
 * compile. The parser reads only lines beginning with `await `, by design, so every
 * commented assertion is invisible to it. The recording then has zero assertions, the
 * Expected Result becomes the "Needs confirmation" placeholder, and `surveyWork` skips
 * the row before generation ever sees it.
 *
 * The fix is upstream of all of that: ask for `playwright-test`, the target the codegen
 * CLI has always used, where assertions are executable lines.
 *
 * The parser is NOT changed to read comments. A commented assertion is Playwright
 * saying "this script cannot assert"; stripping `//` would also resurrect whatever
 * else the recorder chooses to comment out.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseRecording, expectedResultFrom, NEEDS_CONFIRMATION } from '../dashboard/recorder';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** The same recording, as each target emits it. */
const ACTIONS = `  await page.goto('https://portal.fixture.invalid/');
  await page.getByRole('textbox', { name: 'Email' }).fill('someone@moolya.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('[type=password]');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByText('Faclon labs').click();
`;
const ASSERTION = `page.locator('#response_modal_dialog')).toContainText('Line Chart Page| Compute Flow')`;

/** `language: 'javascript'` - what the live recorder used to request. */
const LIBRARY_STYLE = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
${ACTIONS}  // await expect(${ASSERTION});

  // ---------------------
  await context.close();
  await browser.close();
})();`;

/** `--target playwright-test` / `language: 'playwright-test'` - what both now request. */
const TEST_STYLE = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
${ACTIONS}  await expect(${ASSERTION});
});`;

const parse = (source: string) =>
  parseRecording(source, { startUrl: '', browser: '', durationMs: 0 });

function main(): void {
  process.stdout.write('\n== A — library style: the assertion is invisible ==\n');
  const library = parse(LIBRARY_STYLE);
  check('A: actions still parse', library.actions.length === 5, String(library.actions.length));
  check('A: ZERO assertions parse', library.assertions.length === 0, String(library.assertions.length));
  check('A: so the Expected Result is the placeholder',
      expectedResultFrom(library) === NEEDS_CONFIRMATION, expectedResultFrom(library));
  check('A: the assertion IS in the artifact, behind a comment',
      /^\s*\/\/\s*await expect\(/m.test(LIBRARY_STYLE));

  process.stdout.write('\n== B — test style: the same assertion parses ==\n');
  const testStyle = parse(TEST_STYLE);
  check('B: the same actions parse', testStyle.actions.length === 5, String(testStyle.actions.length));
  check('B: the assertion parses', testStyle.assertions.length === 1, String(testStyle.assertions.length));
  check('B: it is the recorded one',
      testStyle.assertions[0]?.locator === "page.locator('#response_modal_dialog')"
      && testStyle.assertions[0]?.type === 'contains',
      `${testStyle.assertions[0]?.locator} / ${testStyle.assertions[0]?.type}`);
  check('B: so the Expected Result is derived, not a placeholder',
      expectedResultFrom(testStyle) !== NEEDS_CONFIRMATION, expectedResultFrom(testStyle).slice(0, 70));
  check('B: and it quotes what was recorded',
      expectedResultFrom(testStyle).includes('Line Chart Page| Compute Flow'));

  process.stdout.write('\n== C — the parser still ignores comments (unchanged) ==\n');
  const commentedAction = parse(`import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://x.test/');
  // await page.getByRole('button', { name: 'Delete' }).click();
});`);
  check('C: a commented ACTION is not parsed either',
      commentedAction.actions.length === 1, String(commentedAction.actions.length));
  check('C: no comment-stripping was introduced',
      !fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/recorder.ts'), 'utf8')
          .includes("replace(/^\\s*\\/\\//"));

  process.stdout.write('\n== D — both transports now request the same target ==\n');
  const live = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  const codegen = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/recorder.ts'), 'utf8');
  check('D: the live transport asks for playwright-test',
      /language: 'playwright-test'/.test(live));
  check('D: and never for javascript', !/language: 'javascript'/.test(live));
  check('D: the codegen CLI still asks for playwright-test',
      /'--target', 'playwright-test'/.test(codegen));

  process.stdout.write('\n== E — synthetic library-style recordings with commented assertions ==\n');
  for (const [id, source] of [
    ['library-single', LIBRARY_STYLE],
    ['library-multiple', LIBRARY_STYLE.replace('// ---------------------', `// await expect(${ASSERTION});\n  // ---------------------`)],
  ]) {
    const parsed = parse(source);
    const commented = (source.match(/^\s*\/\/\s*await expect\(/gm) ?? []).length;
    check(`E: ${id} was recorded library-style`, source.startsWith('const { chromium }'));
    check(`E: ${id} has ${commented} commented assertion(s) and 0 parsed`,
        commented > 0 && parsed.assertions.length === 0,
        `commented=${commented} parsed=${parsed.assertions.length}`);
    check(`E: ${id} therefore carries the placeholder`,
        expectedResultFrom(parsed) === NEEDS_CONFIRMATION);
  }

  process.stdout.write('\n== F — capture and redaction are untouched ==\n');
  check('F: the pre-action hook is still installed', /addInitScript\(\{ content: PREACTION_HOOK \}\)/.test(live));
  check('F: the capability guard still gates the transport',
      /typeof enableRecorder !== 'function'/.test(live));
  check('F: the codegen fallback is still there', /playwrightCli\(\), 'codegen'/.test(codegen));
  check('F: redaction still runs before the artifact is held',
      /pending = \{ source: redactSource\(/.test(codegen));
  const redacted = parse(TEST_STYLE);
  check('F: a password fill is still marked redacted',
      redacted.actions.some(action => action.redacted === true
        && action.value === '[type=password]'),
      JSON.stringify(redacted.actions.find(a => a.redacted)?.value));

  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
