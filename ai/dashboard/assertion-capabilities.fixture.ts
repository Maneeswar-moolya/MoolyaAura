import '../testing/isolated-checkout';
/**
 * P1 Phase 2A — the assertion model, proven without any UI.
 *
 *   npx tsx ai/dashboard/assertion-capabilities.fixture.ts
 *
 * Offline: no browser, no model, no network, no page. Every input is a captured
 * DOM node of the shape the evidence contract already produces.
 *
 * WHAT THIS PINS
 *
 * Three separable claims, and the boundaries between them:
 *
 *   1. CAPABILITY  - which assertions are meaningful for an element, decided
 *                    from proven DOM semantics and never from a class name.
 *   2. STATE       - what is true right now, with `unknown` as a real answer
 *                    rather than a comfortable default.
 *   3. GENERATION  - the Playwright matcher each structured assertion produces,
 *                    deterministically, with the polarity the person recorded.
 *
 * The rule that keeps 1 and 2 apart is the one worth stating twice: a button
 * that is enabled right now still offers `Disabled`. Recording "assert
 * disabled" before the thing becomes enabled is the entire point.
 */

import {
  assertionFor, classify, currentStateOf, describeAssertionTarget, getAssertionCapabilities,
  type AssertionCapability,
} from './assertion-capabilities';
import { assertionPhrase, parseRecording, type RecordedAssertion } from './recorder';
import { targetEvidence } from '../testing/synthetic-data';
import { mapRecording } from '../autocode/from-recording';
import type { DomNode } from '../autocode/dom-evidence';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const node = (over: Partial<DomNode>): DomNode => ({ tag: 'div', ...over } as DomNode);
const ids = (capabilities: AssertionCapability[]) => capabilities.map(capability => capability.id);
const has = (capabilities: AssertionCapability[], id: string) => ids(capabilities).includes(id);

/** The generated line for one structured assertion, through the real mapper. */
function generated(assertion: Partial<RecordedAssertion>): string {
  const recording = {
    testCaseId: 'TC_2A', startUrl: 'https://example.test/',
    actions: [{ type: 'navigate', target: 'https://example.test/', locator: '', locatorStrategy: 'url', value: 'https://example.test/' }],
    assertions: [{
      type: 'visible', target: '#a', locator: `page.locator('#a')`, locatorStrategy: 'css',
      value: null, afterActions: 1, ...assertion,
    }],
    evidence: { available: true, capturedAt: new Date(0).toISOString(), limits: {},
      targets: [targetEvidence(assertion.locator ?? `page.locator('#a')`)] },
  };
  return (mapRecording(recording as never).steps as Array<{ code?: string[] }>)
      .flatMap(step => step.code ?? []).find(line => line.includes('expect(')) ?? '(nothing emitted)';
}

/* --------------------------------------------------- 1-10: the capability matrix */

function checkCapabilities(): void {
  process.stdout.write('\n== 1-2 — a button ==\n');
  const button = node({ tag: 'button', text: 'Submit', accessibleName: 'Submit' });
  const buttonCaps = getAssertionCapabilities(button);
  check('1: classified as a button', classify(button).semantics === 'button', classify(button).reason);
  check('1: offers Enabled', has(buttonCaps, 'enabled'));
  check('2: offers Disabled', has(buttonCaps, 'disabled'));
  check('1: offers Visible and Hidden', has(buttonCaps, 'visible') && has(buttonCaps, 'hidden'));
  check('1: offers Has Text / Attribute / Class',
      has(buttonCaps, 'text') && has(buttonCaps, 'attribute') && has(buttonCaps, 'class'));
  check('15: does NOT offer Checked or Unchecked',
      !has(buttonCaps, 'checked') && !has(buttonCaps, 'unchecked'), ids(buttonCaps).join(', '));
  check('15: does NOT offer ON/OFF', !has(buttonCaps, 'on') && !has(buttonCaps, 'off'));
  check('16: does NOT offer Selected', !has(buttonCaps, 'selected'));
  check('1: a role=button div is a button too',
      classify(node({ tag: 'div', role: 'button' })).semantics === 'button');
  check('1: input[type=submit] is a button too',
      classify(node({ tag: 'input', type: 'submit' })).semantics === 'button');

  process.stdout.write('\n== 3-5 — checkbox and radio ==\n');
  const checkbox = node({ tag: 'input', type: 'checkbox', accessibleName: 'Accept Terms' });
  const checkboxCaps = getAssertionCapabilities(checkbox);
  check('3: classified as a checkbox', classify(checkbox).semantics === 'checkbox');
  check('3: offers Checked', has(checkboxCaps, 'checked'));
  check('4: offers Unchecked', has(checkboxCaps, 'unchecked'));
  check('3: offers Enabled/Disabled and Visible/Hidden',
      has(checkboxCaps, 'enabled') && has(checkboxCaps, 'disabled')
      && has(checkboxCaps, 'visible') && has(checkboxCaps, 'hidden'));
  check('3: offers Attribute and Class', has(checkboxCaps, 'attribute') && has(checkboxCaps, 'class'));
  check('3: does not offer Has Value', !has(checkboxCaps, 'value'));
  const radio = node({ tag: 'input', type: 'radio' });
  check('5: a radio is classified and offers Checked/Unchecked',
      classify(radio).semantics === 'radio'
      && has(getAssertionCapabilities(radio), 'checked')
      && has(getAssertionCapabilities(radio), 'unchecked'));
  check('5: role=radio is a radio', classify(node({ tag: 'span', role: 'radio' })).semantics === 'radio');

  process.stdout.write('\n== 6 — a switch, only when proven ==\n');
  const switched = node({ tag: 'button', role: 'switch', aria: { 'aria-checked': 'true' } });
  const switchCaps = getAssertionCapabilities(switched);
  check('6: role="switch" is a switch', classify(switched).semantics === 'switch', classify(switched).reason);
  check('6: offers ON and OFF', has(switchCaps, 'on') && has(switchCaps, 'off'));
  check('6: labelled for a person, not for Playwright',
      switchCaps.find(c => c.id === 'on')?.label === 'ON'
      && switchCaps.find(c => c.id === 'off')?.label === 'OFF');
  check('6: ON means checked=true underneath',
      JSON.stringify(switchCaps.find(c => c.id === 'on')?.assertion) === '{"type":"checked","expected":true}');
  check('6: OFF means checked=false underneath',
      JSON.stringify(switchCaps.find(c => c.id === 'off')?.assertion) === '{"type":"checked","expected":false}');
  check('6: a checkbox with an explicit aria-checked is a switch',
      classify(node({ tag: 'input', type: 'checkbox', aria: { 'aria-checked': 'false' } })).semantics === 'switch');
  check('6: class="toggle switch" alone proves NOTHING',
      classify(node({ tag: 'div', stableClasses: ['toggle', 'switch', 'is-on'] })).semantics === 'generic');
  check('6: and a class-named switch gets no ON/OFF',
      !has(getAssertionCapabilities(node({ tag: 'div', stableClasses: ['switch'] })), 'on'));

  process.stdout.write('\n== 7-8 — text input and select ==\n');
  const textbox = node({ tag: 'input', type: 'text', accessibleName: 'Email' });
  const textboxCaps = getAssertionCapabilities(textbox);
  check('7: classified as a textbox', classify(textbox).semantics === 'textbox');
  check('7: offers Enabled/Disabled', has(textboxCaps, 'enabled') && has(textboxCaps, 'disabled'));
  check('7: offers Has Value', has(textboxCaps, 'value'));
  check('16: does NOT offer Checked or Selected',
      !has(textboxCaps, 'checked') && !has(textboxCaps, 'selected'), ids(textboxCaps).join(', '));
  check('7: a textarea is a textbox', classify(node({ tag: 'textarea' })).semantics === 'textbox');
  check('7: an input with no type is a textbox', classify(node({ tag: 'input' })).semantics === 'textbox');
  const select = node({ tag: 'select', accessibleName: 'Country' });
  const selectCaps = getAssertionCapabilities(select);
  check('8: classified as a select', classify(select).semantics === 'select');
  check('8: offers Has Value', has(selectCaps, 'value'));
  check('8: offers Enabled/Disabled and Visible/Hidden',
      has(selectCaps, 'enabled') && has(selectCaps, 'visible') && has(selectCaps, 'hidden'));
  check('8: does NOT offer Selected - Playwright has no such matcher',
      !has(selectCaps, 'selected') && !has(selectCaps, 'unselected'));
  check('8: does not offer Has Values either - `multiple` is not in the evidence',
      !has(selectCaps, 'values'));

  process.stdout.write('\n== 9-10 — generic and unsupported ==\n');
  const div = node({ tag: 'div', stableClasses: ['card'] });
  const divCaps = getAssertionCapabilities(div);
  check('9: a div is generic', classify(div).semantics === 'generic');
  check('9: offers only what is true of any element',
      ids(divCaps).join(',') === 'visible,hidden,text,attribute,class', ids(divCaps).join(','));
  check('10: an unknown tag is generic and conservative',
      ids(getAssertionCapabilities(node({ tag: 'ba-widget' }))).join(',')
        === 'visible,hidden,text,attribute,class');
  check('10: the reason says why', /carries no state semantics/.test(classify(node({ tag: 'ba-widget' })).reason));
  check('10: a span with a disabled-looking class gets no enablement',
      !has(getAssertionCapabilities(node({ tag: 'span', stableClasses: ['disabled', 'btn'] })), 'enabled'));
}

/* ------------------------------------------------ 11-12: state vs capability */

function checkState(): void {
  process.stdout.write('\n== 11 — current state, and admitting when it is unknown ==\n');
  const plain = currentStateOf(node({ tag: 'button' }));
  check('11: a native button has UNKNOWN enabled-ness', plain.enabled === undefined);
  check('11: and says so explicitly', plain.unknown.includes('enabled'));
  check('11: visibility is never claimed from a captured attribute',
      plain.visible === undefined && plain.unknown.includes('visible'));
  const ariaOff = currentStateOf(node({ tag: 'button', role: 'switch', aria: { 'aria-checked': 'false' } }));
  check('11: aria-checked="false" IS proof', ariaOff.checked === false);
  const ariaOn = currentStateOf(node({ tag: 'input', type: 'checkbox', aria: { 'aria-checked': 'true' } }));
  check('11: aria-checked="true" IS proof', ariaOn.checked === true);
  const ariaDisabled = currentStateOf(node({ tag: 'button', aria: { 'aria-disabled': 'true' } }));
  check('11: aria-disabled="true" IS proof', ariaDisabled.enabled === false);
  const bareCheckbox = currentStateOf(node({ tag: 'input', type: 'checkbox' }));
  check('11: a checkbox with no aria-checked is unknown, not unchecked',
      bareCheckbox.checked === undefined && bareCheckbox.unknown.includes('checked'));
  check('11: a class named "checked" proves nothing',
      currentStateOf(node({ tag: 'div', stableClasses: ['checked', 'active'] })).checked === undefined);

  process.stdout.write('\n== 12 — the opposite assertion is always available ==\n');
  const enabledNow = describeAssertionTarget(node({ tag: 'button', aria: { 'aria-disabled': 'false' } }));
  check('12: the button is currently enabled', enabledNow.currentState.enabled === true);
  check('12: and Disabled is still offered', has(enabledNow.capabilities, 'disabled'));
  const checkedNow = describeAssertionTarget(node({ tag: 'input', type: 'checkbox', aria: { 'aria-checked': 'true' } }));
  check('12: the switch reads ON right now', checkedNow.currentState.checked === true);
  check('12: and OFF is still offered', has(checkedNow.capabilities, 'off'));
  check('12: state never removes a capability',
      ids(getAssertionCapabilities(node({ tag: 'input', type: 'checkbox', aria: { 'aria-checked': 'true' } })))
          .join(',') === ids(getAssertionCapabilities(node({ tag: 'input', type: 'checkbox', aria: { 'aria-checked': 'false' } }))).join(','));
}

/* -------------------------------------------- 13-18: the structured assertion */

function checkStructure(): void {
  process.stdout.write('\n== 13-18 — what a chosen capability records ==\n');
  const target = { target: 'Submit', locator: `page.getByRole('button', { name: 'Submit' })`, locatorStrategy: 'role-name' };
  const build = (semantics: DomNode, id: string) => {
    const capability = getAssertionCapabilities(semantics).find(c => c.id === id)!;
    return assertionFor(capability, target);
  };
  const button = node({ tag: 'button' });
  const checkbox = node({ tag: 'input', type: 'checkbox' });

  const cases: Array<[string, RecordedAssertion, string, boolean]> = [
    ['13: enabled', build(button, 'enabled'), 'enabled', true],
    ['14: disabled', build(button, 'disabled'), 'enabled', false],
    ['15: checked', build(checkbox, 'checked'), 'checked', true],
    ['16: unchecked', build(checkbox, 'unchecked'), 'checked', false],
    ['17: visible', build(button, 'visible'), 'visible', true],
    ['18: hidden', build(button, 'hidden'), 'visible', false],
  ];
  for (const [label, assertion, type, expected] of cases) {
    check(`${label} → type ${type}, expected ${expected}`,
        assertion.type === type && assertion.expected === expected,
        JSON.stringify({ type: assertion.type, expected: assertion.expected }));
    check(`${label} keeps the existing locator model`,
        assertion.locator === target.locator && assertion.locatorStrategy === 'role-name');
  }
  check('13-18: no separate negative types were invented',
      !cases.some(([, assertion]) => /disabled|unchecked|not/.test(assertion.type)));
  check('serialisation is plain JSON and round-trips',
      JSON.parse(JSON.stringify(build(checkbox, 'unchecked'))).expected === false);
  check('an ON capability serialises as checked/true',
      JSON.stringify(assertionFor(getAssertionCapabilities(node({ tag: 'div', role: 'switch' }))
          .find(c => c.id === 'on')!, target).type) === '"checked"');
  check('a value capability declares that it needs a value',
      getAssertionCapabilities(node({ tag: 'input', type: 'text' }))
          .find(c => c.id === 'value')?.needs === 'value');
  check('an attribute capability declares it too',
      getAssertionCapabilities(node({ tag: 'button' })).find(c => c.id === 'attribute')?.needs === 'attribute');
}

/* -------------------------------------------------- 19-26: what is generated */

function checkGeneration(): void {
  process.stdout.write('\n== 19-26 — the matcher, deterministically ==\n');
  const cases: Array<[string, Partial<RecordedAssertion>, string]> = [
    ['19: enabled', { type: 'enabled', expected: true }, '.toBeEnabled();'],
    ['20: disabled', { type: 'enabled', expected: false }, '.toBeDisabled();'],
    ['21: checked', { type: 'checked', expected: true }, '.toBeChecked();'],
    ['22: unchecked', { type: 'checked', expected: false }, '.not.toBeChecked();'],
    ['23: visible', { type: 'visible', expected: true }, '.toBeVisible();'],
    ['24: hidden', { type: 'visible', expected: false }, '.toBeHidden();'],
    ['25: value', { type: 'value', expected: true, value: 'x' }, `.toHaveValue('x');`],
    ['26: values', { type: 'values', expected: true, values: ['x', 'y'] }, `.toHaveValues(['x', 'y']);`],
    ['attribute', { type: 'attribute', expected: true, name: 'data-state', value: 'open' },
      `.toHaveAttribute('data-state', 'open');`],
    ['attribute negated', { type: 'attribute', expected: false, name: 'data-state', value: 'open' },
      `.not.toHaveAttribute('data-state', 'open');`],
    ['class', { type: 'class', expected: true, value: 'active' }, `.toHaveClass('active');`],
    ['legacy enabled with no expected', { type: 'enabled' }, '.toBeEnabled();'],
  ];
  for (const [label, assertion, tail] of cases) {
    const code = generated(assertion);
    check(`${label} → ${tail}`, code.endsWith(tail), code);
  }
  check('no generated line uses a matcher Playwright does not have',
      !cases.some(([, assertion]) => /toBeSelected|toBeOn|toBeOff/.test(generated(assertion))));
  check('polarity is never lost: every negative reads as one',
      generated({ type: 'checked', expected: false }).includes('.not.')
      && generated({ type: 'enabled', expected: false }).includes('toBeDisabled')
      && generated({ type: 'visible', expected: false }).includes('toBeHidden'));

  process.stdout.write('   and the workbook sentence follows the same polarity\n');
  const phrase = (over: Partial<RecordedAssertion>) => assertionPhrase({
    type: 'enabled', target: 'Submit', locator: '', locatorStrategy: 'css', value: null, ...over,
  } as RecordedAssertion);
  check('enabled reads as enabled', phrase({}) === 'Submit is enabled');
  check('disabled reads as disabled', phrase({ expected: false }) === 'Submit is disabled');
  check('an attribute assertion names the attribute',
      phrase({ type: 'attribute', name: 'data-state', value: 'open' }) === 'Submit has data-state "open"');
}

/* ------------------------------------------------- 27-28: nothing else moved */

function checkCompatibility(): void {
  process.stdout.write('\n== 27-28 — everything that already worked ==\n');
  const source = [
    `import { test, expect } from '@playwright/test';`,
    `test('t', async ({ page }) => {`,
    `  await page.goto('https://example.test/');`,
    `  await expect(page.locator('#a')).toBeVisible();`,
    `  await expect(page.locator('#a')).toBeHidden();`,
    `  await expect(page.locator('#a')).toHaveText('x');`,
    `  await expect(page.locator('#a')).toContainText('x');`,
    `  await expect(page.locator('#a')).toHaveValue('x');`,
    `  await expect(page.locator('#a')).toBeChecked();`,
    `  await expect(page).toHaveURL('https://x/');`,
    `  await expect(page.locator('#a')).toHaveCount(2);`,
    `  await expect(page).toHaveTitle('T');`,
    `  await expect(page.locator('#a')).toBeEmpty();`,
    `});`,
  ].join('\n');
  const assertions = parseRecording(source, { startUrl: '', browser: '', durationMs: 0 }).assertions;
  check('27: all ten existing forms still parse', assertions.length === 10, String(assertions.length));
  check('27: all of them positive', assertions.every(a => a.expected === true));
  check('27: their types are unchanged',
      assertions.map(a => a.type).join(',') === 'visible,hidden,text,contains,value,checked,url,count,title,empty',
      assertions.map(a => a.type).join(','));
  check('27: and they generate what they always did',
      generated({ type: 'visible' }).endsWith('.toBeVisible();')
      && generated({ type: 'hidden' }).endsWith('.toBeHidden();')
      && generated({ type: 'contains', value: 'x' }).endsWith(`.toContainText('x');`));

  const negated = parseRecording([
    `import { test, expect } from '@playwright/test';`,
    `test('t', async ({ page }) => {`,
    `  await page.goto('https://example.test/');`,
    `  await expect(page.locator('#b')).not.toBeChecked();`,
    `  await expect(page.locator('#b')).not.toBeDisabled();`,
    `});`,
  ].join('\n'), { startUrl: '', browser: '', durationMs: 0 }).assertions;
  check('28: the P0 negation fix is still green',
      negated[0]?.expected === false && negated[0]?.locator === `page.locator('#b')`);
  check('28: and a double negative resolves correctly',
      negated[1]?.type === 'enabled' && negated[1]?.expected === true,
      JSON.stringify(negated[1] ?? null));
}

function main(): void {
  checkCapabilities();
  checkState();
  checkStructure();
  checkGeneration();
  checkCompatibility();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
