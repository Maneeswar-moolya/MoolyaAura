/**
 * P1 Phase 2B — the live assertion picker.
 *
 *   npx tsx ai/dashboard/assertion-picker.fixture.ts
 *
 * Offline: no browser, no model, no network. The in-page half is exercised by
 * running the GENERATED script string against a stub DOM, the same way
 * `clicked-target.fixture.ts` does - reading the source proves nothing about
 * what reaches the page.
 *
 * WHAT THIS PINS
 *
 * The picker is allowed to do exactly two things to a page: draw its own UI, and
 * read. Every other capability it could plausibly have - clicking, filling,
 * toggling, focusing, dispatching, writing an attribute onto a target - is
 * checked for and must be absent, because a recorder that changes the thing it
 * is recording produces evidence of itself.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ASSERTION_PICKER, PICKER_NAMESPACE, PILL_ANCHOR, PILL_MAX, RESERVED_AREAS,
  overlaps, pillRect, reservedRect,
} from './assertion-picker-source';
import { isRecorderOwnAction, locatorFor, pickerModel, recordPickedAssertion, refusesAttribute } from './live-recorder';
import { parseRecording, type RecordedAssertion } from './recorder';
import { mapRecording, readAssertions } from '../autocode/from-recording';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const model = (node: Record<string, unknown>, state: Record<string, boolean | undefined> = {}) =>
  pickerModel({ node, state });
const labels = (result: ReturnType<typeof pickerModel>) => result.capabilities.map(c => c.label);

/* ------------------------------------------------------ 1-6: what is offered */

function checkCapabilities(): void {
  process.stdout.write('\n== 1-2 — a button ==\n');
  const button = model({ tag: 'button', text: 'Submit', accessibleName: 'Submit' }, { visible: true, enabled: true });
  check('1: the popup has something to show', button.capabilities.length > 0);
  check('1: named for a person', button.description === 'Submit', button.description);
  check('2: offers Enabled and Disabled',
      labels(button).includes('Enabled') && labels(button).includes('Disabled'), labels(button).join(', '));
  check('2: offers Visible, Hidden, Has Text, Has Attribute, Has Class',
      ['Visible', 'Hidden', 'Has Text', 'Has Attribute', 'Has Class'].every(l => labels(button).includes(l)));
  check('2: offers no Checked, ON or Selected',
      !labels(button).some(label => /Checked|ON|OFF|Selected/.test(label)), labels(button).join(', '));

  process.stdout.write('\n== 3-4 — checkbox and switch ==\n');
  const checkbox = model({ tag: 'input', type: 'checkbox', accessibleName: 'Accept Terms' },
      { visible: true, enabled: true, checked: true });
  check('3: offers Checked and Unchecked',
      labels(checkbox).includes('Checked') && labels(checkbox).includes('Unchecked'));
  check('3: reports the current state it was given',
      checkbox.state.find(s => s.label === 'Checked')?.value === true);
  const switched = model({ tag: 'div', role: 'switch', accessibleName: 'Notifications' },
      { visible: true, enabled: true, checked: true });
  check('4: a proven switch offers ON and OFF',
      labels(switched).includes('ON') && labels(switched).includes('OFF'), labels(switched).join(', '));
  check('4: and reports ON as its current state',
      switched.state.find(s => s.label === 'ON')?.value === true);
  const fake = model({ tag: 'div', stableClasses: ['switch', 'toggle', 'is-on'] }, { visible: true });
  check('4: a class-named switch gets NO ON/OFF',
      !labels(fake).some(label => label === 'ON' || label === 'OFF'), labels(fake).join(', '));

  process.stdout.write('\n== 5-6 — textbox, select, generic ==\n');
  const textbox = model({ tag: 'input', type: 'text', accessibleName: 'Email' }, { visible: true, enabled: false });
  check('5: offers Enabled/Disabled and Has Value',
      ['Enabled', 'Disabled', 'Has Value'].every(l => labels(textbox).includes(l)));
  check('5: shows it is currently disabled',
      textbox.state.find(s => s.label === 'Enabled')?.value === false);
  const select = model({ tag: 'select', accessibleName: 'Country' }, { visible: true });
  check('5: a select offers Has Value and no Selected',
      labels(select).includes('Has Value') && !labels(select).some(l => /Selected/.test(l)));
  const generic = model({ tag: 'div', text: 'Some panel' }, { visible: true });
  check('6: a div offers only the generic set',
      labels(generic).join(',') === 'Visible,Hidden,Has Text,Has Attribute,Has Class', labels(generic).join(','));
}

/* ------------------------------------------------------- 7-9: state handling */

function checkState(): void {
  process.stdout.write('\n== 7-9 — current state, unknown, and the opposite ==\n');
  const known = model({ tag: 'button' }, { visible: true, enabled: false });
  check('7: a live read is believed',
      known.state.find(s => s.label === 'Enabled')?.value === false
      && known.state.find(s => s.label === 'Visible')?.value === true);
  const unknown = model({ tag: 'button' }, {});
  check('8: with nothing read, enabled is UNKNOWN',
      unknown.state.find(s => s.label === 'Enabled')?.value === undefined);
  check('8: and visibility is not claimed either',
      unknown.state.find(s => s.label === 'Visible')?.value === undefined);
  const bareCheckbox = model({ tag: 'input', type: 'checkbox' }, {});
  check('8: an unread checkbox is UNKNOWN, never "unchecked"',
      bareCheckbox.state.find(s => s.label === 'Checked')?.value === undefined);
  check('9: a disabled button still offers Enabled',
      labels(model({ tag: 'button' }, { enabled: false })).includes('Enabled'));
  check('9: a ticked checkbox still offers Unchecked',
      labels(model({ tag: 'input', type: 'checkbox' }, { checked: true })).includes('Unchecked'));
  check('9: state never changes the capability list',
      labels(model({ tag: 'input', type: 'checkbox' }, { checked: true })).join(',')
        === labels(model({ tag: 'input', type: 'checkbox' }, { checked: false })).join(','));
}

/* --------------------------------------- 10-13: the UI, the DOM, and secrets */

function checkPageSafety(): void {
  process.stdout.write('\n== 10-12 — what the in-page script may do ==\n');
  check('10: everything lives under one recorder-owned tag',
      ASSERTION_PICKER.includes(`const NS = '${PICKER_NAMESPACE}'`)
      && ASSERTION_PICKER.includes("host.setAttribute('data-aura-recorder-ui'"));
  check('10: and inside a shadow root, so no app style reaches it',
      ASSERTION_PICKER.includes('attachShadow'));
  check('10: an action against it is recognised as the recorder\'s own',
      isRecorderOwnAction(`page.locator('${PICKER_NAMESPACE}')`)
      && isRecorderOwnAction(`page.locator('[data-aura-recorder-ui]')`)
      && !isRecorderOwnAction(`page.getByRole('button', { name: 'Submit' })`));

  // 11 - it must never write to, or act on, an application element.
  const forbidden: Array<[string, RegExp]> = [
    ['.click()', /\.click\(\)/],
    // Focusing OUR OWN input in the card is fine and necessary; focusing an
    // application element is not - a blur handler is application state.
    ['focus an application element', /(element|target)\.focus\(\)/],
    ['.blur()', /\.blur\(\)/],
    ['dispatchEvent', /dispatchEvent/],
    ['setAttribute on a target', /element\.setAttribute|target\.setAttribute/],
    ['removeAttribute', /removeAttribute/],
    ['classList.add on a target', /element\.classList\.(add|remove|toggle)/],
    ['assigning .checked', /element\.checked\s*=(?!=)/],
    ['assigning .disabled', /element\.disabled\s*=(?!=)/],
    ['assigning .value', /element\.value\s*=(?!=)/],
    ['assigning innerHTML on a target', /element\.innerHTML\s*=/],
    ['scrollIntoView', /scrollIntoView/],
    ['a timer', /setTimeout|setInterval/],
    ['XPath', /evaluate\(.*XPathResult|document\.evaluate/],
  ];
  for (const [label, pattern] of forbidden)
    check(`11: never ${label}`, !pattern.test(ASSERTION_PICKER));
  check('11: it reads state rather than changing it',
      ASSERTION_PICKER.includes('getComputedStyle') && ASSERTION_PICKER.includes('getBoundingClientRect'));
  check('11: the only element it creates is its own',
      (ASSERTION_PICKER.match(/document\.createElement\(/g) ?? []).length >= 1
      && !/document\.body\.appendChild|element\.appendChild/.test(ASSERTION_PICKER));

  // 12 - normal interaction must survive.
  check('12: the host is pointer-transparent until assert mode is on',
      ASSERTION_PICKER.includes('pointer-events: none')
      && ASSERTION_PICKER.includes("host.style.pointerEvents = on ? 'auto' : 'none'"));
  check('12: preventDefault is only ever called on the recorder\'s own elements',
      ASSERTION_PICKER.includes('if (!veil || event.target !== veil) return;'));
  check('12: hovering is passive and cannot block the page',
      ASSERTION_PICKER.includes('{ capture: true, passive: true }'));
  check('12: assert mode ends after one selection',
      ASSERTION_PICKER.includes('setMode(false)'));
  check('12: the UI is fixed, so no application layout is reflowed',
      ASSERTION_PICKER.includes('position: fixed'));

  process.stdout.write('\n== 13 — secrets ==\n');
  for (const name of ['password', 'data-token', 'authorization', 'session-cookie', 'apiKey', 'user-secret'])
    check(`13: refuses the attribute "${name}"`, refusesAttribute(name));
  for (const name of ['data-state', 'aria-expanded', 'href', 'role'])
    check(`13: allows the attribute "${name}"`, !refusesAttribute(name));
  const refused = recordPickedAssertion(
      { capabilityId: 'attribute', value: 'data-password = hunter2', node: { tag: 'button' } },
      [], 'nowhere.spec.ts');
  check('13: and refuses to record one', refused.recorded === false, JSON.stringify(refused));
  check('13: saying why, without repeating the value',
      Boolean(refused.reason && !refused.reason.includes('hunter2')), refused.reason ?? '');
}

/* --------------------------------- 14-20: recording, generation, compatibility */

function checkRecording(): void {
  process.stdout.write('\n== 14 — what gets recorded ==\n');
  const into: RecordedAssertion[] = [];
  const button = { tag: 'button', accessibleName: 'Submit', role: 'button' };
  const disabled = recordPickedAssertion({ capabilityId: 'disabled', node: button }, into, 'nowhere.spec.ts');
  check('14: the choice is recorded', disabled.recorded === true && into.length === 1);
  check('14: as the Phase 2A structure',
      into[0].type === 'enabled' && into[0].expected === false,
      JSON.stringify({ type: into[0].type, expected: into[0].expected }));
  check('14: with a locator from the existing vocabulary',
      into[0].locator === `page.getByRole("button", { name: "Submit" })`, into[0].locator);
  check('14: and a strategy the resolver already understands', into[0].locatorStrategy === 'role-name');
  check('14: a capability the element does not offer is refused',
      recordPickedAssertion({ capabilityId: 'checked', node: button }, into, 'x').recorded === false);
  check('14: ON records as checked/true',
      (() => {
        const bin: RecordedAssertion[] = [];
        recordPickedAssertion({ capabilityId: 'on', node: { tag: 'div', role: 'switch' } }, bin, 'x');
        return bin[0]?.type === 'checked' && bin[0]?.expected === true;
      })());
  check('14: OFF records as checked/false',
      (() => {
        const bin: RecordedAssertion[] = [];
        recordPickedAssertion({ capabilityId: 'off', node: { tag: 'div', role: 'switch' } }, bin, 'x');
        return bin[0]?.type === 'checked' && bin[0]?.expected === false;
      })());
  check('locatorFor prefers a role with a name, then an id',
      locatorFor({ tag: 'button', role: 'button', accessibleName: 'Save' }).includes('getByRole')
      && locatorFor({ tag: 'div', id: 'panel' }) === `page.locator("#panel")`);

  process.stdout.write('\n== 15-17 — merged into a recording, and generated ==\n');
  const source = [
    `import { test, expect } from '@playwright/test';`,
    `test('t', async ({ page }) => {`,
    `  await page.goto('https://example.test/');`,
    `  await page.getByLabel('Name').fill('John');`,
    `  await page.locator('${PICKER_NAMESPACE}').click();`,
    `  await expect(page.locator('#banner')).toContainText('hello');`,
    `});`,
  ].join('\n');
  const picked: RecordedAssertion[] = [];
  recordPickedAssertion({ capabilityId: 'disabled', node: button }, picked, 'x');
  picked[0].afterActions = 1;
  const recording = parseRecording(source, {
    startUrl: 'https://example.test/', browser: 'chromium', durationMs: 1, stateAssertions: picked,
  });
  check('15: the existing text assertion still parses',
      recording.assertions.some(a => a.type === 'contains' && a.value === 'hello'));
  check('14: the picked assertion is in the recording',
      recording.assertions.some(a => a.type === 'enabled' && a.expected === false));
  check('10: the click on the recorder\'s own overlay was dropped',
      !recording.actions.some(action => action.locator.includes(PICKER_NAMESPACE)),
      recording.actions.map(a => a.locator).join(' | '));
  check('15: the application action survived',
      recording.actions.some(action => action.locator.includes('getByLabel')));

  const code = (mapRecording({ ...recording, testCaseId: 'TC_2B' } as never).steps as Array<{ code?: string[] }>)
      .flatMap(step => step.code ?? []);
  check('16: the state assertion generates the deterministic matcher',
      code.some(line => line.includes('.toBeDisabled();')), code.join(' | ').slice(0, 160));
  check('16: and the old text assertion is unchanged',
      code.some(line => line.includes(`.toContainText('hello');`)));
  check('17: no forbidden mechanism appears in the generated code',
      !code.some(line => /force|\.first\(\)|\.nth\(|dispatchEvent|waitForTimeout|xpath/i.test(line)));

  process.stdout.write('\n== 18-20 — nothing else moved ==\n');
  const dir = path.resolve(ROOT, 'ai/dashboard/recordings');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.spec.ts'));
  let total = 0;
  // What survives PARSING, which is the only stream anything downstream sees.
  let retainedPickerActions = 0;
  // Recordings whose raw script holds a picker click, so the drop is exercised.
  let exercising = 0;
  // Recordings carrying persisted picker assertions, and whether they all came back.
  let withAssertions = 0;
  let assertionsLost = 0;
  const offenders: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const caseId = file.replace(/\.spec\.ts$/, '');
    const persisted = readAssertions(caseId);
    const parsed = parseRecording(source,
        { startUrl: '', browser: '', durationMs: 0, stateAssertions: persisted });
    total += parsed.assertions.length;

    if (source.includes(PICKER_NAMESPACE))
      exercising += 1;
    const survived = parsed.actions.filter(action =>
      isRecorderOwnAction(action.locator) || action.locator.includes(PICKER_NAMESPACE));
    retainedPickerActions += survived.length;
    if (survived.length)
      offenders.push(`${file}: ${survived.map(action => action.locator).join(', ')}`);

    if (persisted?.length) {
      withAssertions += 1;
      if (parsed.assertions.length < persisted.length)
        assertionsLost += 1;
    }
  }
  check('18: every existing recording still parses', total > 0, `${files.length} file(s), ${total} assertion(s)`);

  // 19 - the invariant, restated where it actually lives.
  //
  // This used to scan the RAW script for the namespace, and that was right while the
  // picker's shadow root was open: nothing of the picker could legitimately appear
  // there. P1.2d closed it deliberately, so a click on the pill, the veil or a
  // capability row now records as `page.locator('ba-aura-assert')` and is dropped by
  // `parseRecording`. The raw file holding that string is the mechanism WORKING.
  //
  // So the claim moves to the retained stream - and the second check is what stops
  // the first from passing vacuously. A directory with no picker recording in it
  // would satisfy "nothing survived" while proving nothing at all.
  check('19: no picker-owned action survives parseRecording',
      retainedPickerActions === 0, offenders.join(' | ') || `${files.length} file(s) checked`);
  check('19: and at least one recording exercises the drop',
      exercising > 0,
      `${exercising} recording(s) contain a picker click in the raw script`);
  check('19: the picker assertions of those recordings are all retained',
      assertionsLost === 0,
      `${withAssertions} recording(s) carry persisted assertions, ${assertionsLost} lost any`);
  const liveSource = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  check('20: the picker never reads a credential',
      !/credentials\(\)|explorationCredentials/.test(ASSERTION_PICKER));
  check('20: the capture contract was not expanded for this',
      !/pickerState|liveState/.test(fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-capture-source.ts'), 'utf8')));
  check('20: the picker is installed alongside the existing hook, not instead of it',
      liveSource.includes('addInitScript({ content: PREACTION_HOOK })')
      && liveSource.includes('addInitScript({ content: ASSERTION_PICKER })'));
  check('20: and its assertions travel separately from the evidence',
      liveSource.includes('stateAssertions: picked'));
}

/* ---------------------------------------- J-L: the person can find the thing */

/**
 * A picker nobody knows about is a picker nobody uses.
 *
 * P1.2 diagnosed a real recording in which the picker was installed, injected,
 * visible and clickable - and no assertion was recorded, because the dashboard
 * told the person to use PLAYWRIGHT's Assert toolbar and the pill was rendering
 * underneath Bugasura's chat bubble. All three checks here are about the gap
 * between "it works" and "it was found".
 */
function checkDiscoverability(): void {
  // ---- J: the pill does not sit on anything that is already spoken for
  const viewports = [
    { width: 1536, height: 824 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 },
  ];
  for (const viewport of viewports) {
    const pill = pillRect(viewport);
    for (const area of RESERVED_AREAS) {
      const reserved = reservedRect(area, viewport);
      check(`J: the pill clears the ${area.name} at ${viewport.width}x${viewport.height}`,
          !overlaps(pill, reserved),
          `pill ${JSON.stringify(pill)} vs ${JSON.stringify(reserved)}`);
    }
    check(`J: the pill is inside the viewport at ${viewport.width}x${viewport.height}`,
        pill.left >= 0 && pill.top >= 0 && pill.right <= viewport.width && pill.bottom <= viewport.height);
  }
  // The measured Freshchat launcher itself - 70x75 inset 15,15 - not the padded
  // reserved area, so the clearance can be stated as a number.
  const measured = { left: 1536 - 85, top: 824 - 90, right: 1536 - 15, bottom: 824 - 15 };
  const pill = pillRect({ width: 1536, height: 824 });
  check('J: and it clears the launcher as actually measured on my.bugasura.io',
      !overlaps(pill, measured), `${measured.top - pill.bottom}px of clearance`);

  // The declaration and the stylesheet must not drift apart: the CSS is what
  // reaches the page, the constant is what the geometry above is checked against.
  check('J: the generated stylesheet uses the declared anchor',
      ASSERTION_PICKER.includes(`right: ${PILL_ANCHOR.right}px; bottom: ${PILL_ANCHOR.bottom}px`),
      (ASSERTION_PICKER.match(/\.pill \{[^']*/) ?? ['(no .pill rule)'])[0]);
  check('J: the old bottom-right corner position is gone',
      !/\.pill \{[^']*right: 16px; bottom: 16px/.test(ASSERTION_PICKER));
  check('J: the pill is still fixed and still owns the top of the stack',
      /\.pill \{[^']*position: fixed/.test(ASSERTION_PICKER)
      && ASSERTION_PICKER.includes('z-index: 2147483647'));
  check('J: the pill is still inside the recorder-owned namespace',
      ASSERTION_PICKER.includes(`const NS = '${PICKER_NAMESPACE}'`));
  check('J: the declared maximum covers the armed label',
      PILL_MAX.width >= 200 && PILL_MAX.height >= 33);

  // ---- K: the run log says the picker is ready, and only when it is
  const liveSource = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  check('K: the recorder logs that the picker is ready',
      liveSource.includes('[recorder] assertion picker ready'));
  const installBlock = liveSource.slice(
      liveSource.indexOf('addInitScript({ content: ASSERTION_PICKER })'),
      liveSource.indexOf('addInitScript({ content: ASSERTION_PICKER })') + 700);
  check('K: it is logged after the install succeeds, not before it is attempted',
      installBlock.includes('metrics.pickerInstalled = true')
      && installBlock.indexOf('metrics.pickerInstalled = true')
         < installBlock.indexOf('[recorder] assertion picker ready'));
  check('K: and it sits inside the try, so a failed install cannot announce itself',
      liveSource.indexOf('[recorder] assertion picker ready')
      < liveSource.indexOf('metrics.preActionHook = false;'));

  // ---- L: the dashboard names the in-page pill, and no longer misdirects
  const html = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/public/index.html'), 'utf8');
  check('L: the recording instructions name the in-page Assert pill',
      /<strong>Assert<\/strong> pill in the recorder overlay/.test(html));
  check('L: they tell the person to select the element after clicking it',
      /select the element you mean/.test(html));
  check("L: nothing points at Playwright's own Assert toolbar any more",
      !/Playwright's (own )?Assert toolbar/i.test(html)
      && !/<strong>Assert<\/strong> toolbar/.test(html));
  check('L: the no-assertion note offers the pill as the way to fix it',
      /record again and use the <strong>Assert<\/strong> pill/.test(html));
}

function main(): void {
  checkCapabilities();
  checkState();
  checkPageSafety();
  checkRecording();
  checkDiscoverability();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
