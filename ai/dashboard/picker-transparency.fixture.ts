/**
 * P1.2d — the assertion picker must be invisible to the recorded action stream.
 *
 *   npx tsx ai/dashboard/picker-transparency.fixture.ts
 *
 * A recording should be application actions plus structured state assertions, and
 * nothing else. It was neither: the picker's own clicks were kept as application
 * actions, and TC_LOGIN_076 was refused because one of them - a capability row
 * recorded as `getByRole('button', { name: 'ON' })` - could not be resolved to a
 * unique element. It never could be. It was not an application control.
 *
 * WHY THIS IS A STRUCTURAL TEST AND NOT A NAME TEST
 *
 * Measured against a live recorder: with the shadow root OPEN, Playwright's
 * selector generator pierces it and names the innermost element - the pill as
 * `getByText('Assert')`, the veil as `locator('div').nth(1)`, a row as
 * `getByRole('button', { name: 'ON' })`. In the same run, a real application
 * button labelled OFF recorded as `getByRole('button', { name: 'OFF' })` -
 * indistinguishable from the picker's own OFF row. So filtering by name would
 * delete real interactions, and the checks below pin the opposite: an application
 * element that says Assert, ON or OFF is KEPT.
 *
 * Closed, every click in the picker retargets to the host and records as
 * `page.locator('ba-aura-assert')`, which `isRecorderOwnAction` already knew about.
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ASSERTION_PICKER, PICKER_NAMESPACE } from './assertion-picker-source';
import { isRecorderOwnAction } from './live-recorder';
import { parseRecording, type RecordedAssertion } from './recorder';
import { mapRecording } from '../autocode/from-recording';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** How a picker click reaches the script once the shadow root is closed. */
const HOST = `page.locator('${PICKER_NAMESPACE}')`;

/**
 * TC_LOGIN_076's shape: assert ON, toggle the switch, assert OFF.
 *
 * Six application actions, then a picker exchange, then the toggle, then a second
 * picker exchange. Each picker exchange is three clicks - arm, select, choose -
 * and all three land on the host.
 */
const SCRIPT = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://my.bugasura.io/');
  await page.getByRole('textbox', { name: 'Email' }).fill('someone@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('[type=password]');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('link', { name: 'Notifications' }).click();
  await page.getByRole('button', { name: 'Notification settings' }).click();
  await ${HOST}.click();
  await ${HOST}.click();
  await ${HOST}.click();
  await page.locator('.ba-switch__thumb').click();
  await page.getByRole('checkbox', { name: 'Enable Notifications Enable' }).uncheck();
  await ${HOST}.click();
  await ${HOST}.click();
  await ${HOST}.click();
});`;

const LABEL = 'page.getByLabel("Enable Notifications Receive notifications for activity across Bugasura.")';

/** ON, recorded before the toggle. `afterActions` counts RAW script lines. */
const asserted = (expected: boolean, afterActions: number): RecordedAssertion => ({
  type: 'checked',
  expected,
  target: 'Enable Notifications Receive notifications for activity acro',
  locator: LABEL,
  locatorStrategy: 'label',
  value: null,
  interactionTarget: 'page.locator(".ba-switch__thumb")',
  afterActions,
});

const parse = (stateAssertions: RecordedAssertion[]) => parseRecording(SCRIPT, {
  startUrl: '', browser: '', durationMs: 0, stateAssertions,
});

/* -------------------------------------------- 1-6: nothing of the picker remains */

function checkTransparency(): void {
  process.stdout.write('\n== 1-6 — the picker leaves no application action ==\n');
  const recording = parse([asserted(true, 6), asserted(false, 11)]);
  const locators = recording.actions.map(action => action.locator);

  check('6: the picker contributed no action at all',
      !locators.some(locator => isRecorderOwnAction(locator)),
      locators.filter(locator => isRecorderOwnAction(locator)).join(', ') || 'none');
  check('6: and nothing in the recording mentions the namespace',
      !JSON.stringify(recording.actions).includes(PICKER_NAMESPACE));
  check('6: exactly the eight application actions survive',
      recording.actions.length === 8,
      recording.actions.map(action => action.type).join(', '));
  check('6: in their recorded order, with the toggle between the two exchanges',
      recording.actions.map(action => action.type).join(',')
        === 'navigate,fill,fill,click,click,click,click,uncheck',
      recording.actions.map(action => action.type).join(','));

  // 1-5: every picker surface reaches the script as the host, so one rule covers
  // them all. Each is asserted separately because each was a separate defect.
  for (const [label, surface] of [
    ['1: the Assert pill', 'pill'],
    ['2: the veil', 'veil'],
    ['3: the ON capability', 'row ON'],
    ['4: the OFF capability', 'row OFF'],
    ['5: a capability card control', 'card close'],
  ] as Array<[string, string]>) {
    check(`${label} click is recognised as the recorder's own (${surface})`,
        isRecorderOwnAction(HOST));
  }
  check('1-5: and the attribute form is recognised too',
      isRecorderOwnAction("page.locator('[data-aura-recorder-ui=\"true\"]')"));

  // The safety property. These are what a real application control looks like, and
  // they are exactly what an open shadow root made the picker look like.
  process.stdout.write('\n== the other half: application controls are NOT dropped ==\n');
  for (const locator of [
    "page.getByText('Assert')",
    "page.getByRole('button', { name: 'ON' })",
    "page.getByRole('button', { name: 'OFF' })",
    "page.locator('.veil')",
    "page.locator('div').nth(1)",
  ]) {
    check(`an application ${locator} is kept`, !isRecorderOwnAction(locator));
  }
  const appScript = SCRIPT.replace(`await ${HOST}.click();`,
      "await page.getByRole('button', { name: 'OFF' }).click();");
  const withAppButton = parseRecording(appScript, { startUrl: '', browser: '', durationMs: 0 });
  check('and a real OFF button in the same script survives the filter',
      withAppButton.actions.some(action => action.target === 'OFF'),
      withAppButton.actions.map(action => action.target).join(' | '));
}

/* ------------------------------- 7-10: the assertions, their places and polarity */

function checkAssertions(): void {
  process.stdout.write('\n== 7-10 — the assertions survive, in the right places ==\n');
  const recording = parse([asserted(true, 6), asserted(false, 11)]);

  check('7: both state assertions are retained',
      recording.assertions.length === 2, `${recording.assertions.length}`);
  const on = recording.assertions.find(assertion => assertion.expected === true);
  const off = recording.assertions.find(assertion => assertion.expected === false);
  check('9: expected:true remains true', on?.expected === true, JSON.stringify(on?.expected));
  check('10: expected:false remains false', off?.expected === false, JSON.stringify(off?.expected));
  check('7: with their locators untouched',
      on?.locator === LABEL && off?.locator === LABEL);
  check('7: and the element the person pointed at still recorded',
      on?.interactionTarget === 'page.locator(".ba-switch__thumb")');

  // 8 - the positions. Six application actions precede the first exchange, eight
  // precede the second. The raw numbers the picker recorded (6 and 11) count
  // script lines including the dropped ones; what must come out is a position in
  // the KEPT stream.
  check('8: ON lands after the sixth application action, before the toggle',
      on?.afterActions === 6, String(on?.afterActions));
  check('8: OFF lands after the eighth, i.e. after the toggle',
      off?.afterActions === 8, String(off?.afterActions));
  check('8: so the two are not collapsed onto the same position',
      on?.afterActions !== off?.afterActions);

  // The same recording, with the picker's own clicks already flushed to the script
  // when the assertion was made. Codegen writes asynchronously, so both are real.
  const raced = parse([asserted(true, 9), asserted(false, 14)]);
  const racedOn = raced.assertions.find(assertion => assertion.expected === true);
  const racedOff = raced.assertions.find(assertion => assertion.expected === false);
  check('8: the flush race does not move them - ON is still after six',
      racedOn?.afterActions === 6, String(racedOn?.afterActions));
  check('8: and OFF is still after eight',
      racedOff?.afterActions === 8, String(racedOff?.afterActions));

  // Regression guard for the translation itself: without it, a raw position would
  // be used directly as a kept position and slide past the end of the stream.
  check('8: a position is never left beyond the actions that exist',
      recording.assertions.every(assertion =>
        (assertion.afterActions ?? 0) <= recording.actions.length));

  // A Codegen `expect(...)` counts kept actions already, so it must NOT be
  // translated a second time.
  const withCodegenAssertion = parseRecording(
      SCRIPT.replace("  await page.locator('.ba-switch__thumb').click();",
          "  await expect(page.locator('#banner')).toBeVisible();\n"
          + "  await page.locator('.ba-switch__thumb').click();"),
      { startUrl: '', browser: '', durationMs: 0 });
  const codegenAssertion = withCodegenAssertion.assertions[0];
  check('8: a Codegen assertion still counts kept actions, untranslated',
      codegenAssertion?.afterActions === 6, String(codegenAssertion?.afterActions));

  process.stdout.write('\n== what generation emits ==\n');
  const code = mapRecording(recording).steps.flatMap(step => step.code).join('\n');
  check('9-10: toBeChecked and .not.toBeChecked are both emitted, one each',
      (code.match(/toBeChecked\(\)/g) ?? []).length === 2
      && (code.match(/\.not\.toBeChecked\(\)/g) ?? []).length === 1,
      code.split('\n').filter(line => line.includes('toBeChecked')).join(' | '));
  check('9-10: and nothing is emitted against the picker',
      !code.includes(PICKER_NAMESPACE));
}

/* ------------------------------------- the structural guarantee behind all of it */

function checkStructure(): void {
  process.stdout.write('\n== the guarantee: a closed shadow root ==\n');
  check('the picker attaches a CLOSED shadow root',
      ASSERTION_PICKER.includes("attachShadow({ mode: 'closed' })"),
      (ASSERTION_PICKER.match(/attachShadow\([^)]*\)/) ?? ['(none)'])[0]);
  check('so the selector generator cannot name anything inside it',
      !ASSERTION_PICKER.includes("mode: 'open'"));
  check('the host still carries both marks the filter looks for',
      ASSERTION_PICKER.includes(`document.createElement(NS)`)
      && ASSERTION_PICKER.includes("host.setAttribute('data-aura-recorder-ui'"));
  check('nothing outside the picker reads host.shadowRoot',
      !fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8').includes('shadowRoot')
      && !fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/recorder.ts'), 'utf8').includes('shadowRoot'));
  check('the picker still reaches its own UI through the closure, not the host',
      ASSERTION_PICKER.includes('shadow.querySelector') && !ASSERTION_PICKER.includes('host.shadowRoot'));

  // The filter itself is unchanged - that is the point of doing it structurally.
  const live = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  const filter = live.slice(live.indexOf('export function isRecorderOwnAction'),
      live.indexOf('export function isRecorderOwnAction') + 260);
  check('isRecorderOwnAction needed no new name rules',
      filter.includes("locator.includes(PICKER_NAMESPACE) || locator.includes('data-aura-recorder-ui')"),
      filter.split('\n').find(line => line.includes('return'))?.trim());
  check('and it names no capability label, so it cannot delete an application control',
      !/'ON'|'OFF'|'Assert'|\.veil|\.pill|\.card|\.row/.test(filter));
}

function main(): void {
  checkTransparency();
  checkAssertions();
  checkStructure();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
