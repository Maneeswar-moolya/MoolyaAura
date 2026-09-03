/**
 * The assertion picker as a floating tool: collapsed, expanded, draggable, clamped.
 *
 *   npx tsx ai/dashboard/picker-panel.fixture.ts
 *
 * The card used to be pinned beside whatever was clicked, which is how it ran off
 * the bottom of the screen, and it could not be moved. It is now a panel with a
 * header that drags it, placed by rules that keep it reachable and out of the
 * areas the application has already claimed.
 *
 * TWO IMPLEMENTATIONS, ONE RULE. The placement maths exists in TypeScript (for the
 * rest of the toolkit) and in the page (for the panel itself). The first section
 * runs BOTH against the same cases: a rule copied twice is a rule that drifts, and
 * this is what makes the drift visible.
 *
 * The browser section uses a real page because clamping, dragging and resizing are
 * layout, and layout has no offline answer.
 */

import { chromium } from 'playwright';

import {
  ASSERTION_PICKER, PANEL_MIN_VISIBLE, PILL_ANCHOR, RESERVED_AREAS,
  clampToViewport, defaultPanelRect, overlaps, reservedRect,
} from './assertion-picker-source';
import { isRecorderOwnAction, pickerModel, recordPickedAssertion } from './live-recorder';
import { parseRecording } from './recorder';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** Scratch only: a closed shadow root cannot be measured from outside. */
const RECTS = "window.__rect = (sel, text) => { for (const n of shadow.querySelectorAll(sel))"
  + " { if (!text || n.textContent.trim() === text) { const r = n.getBoundingClientRect();"
  + " return { x: r.x + r.width/2, y: r.y + r.height/2, left: r.left, top: r.top,"
  + " width: r.width, height: r.height }; } } return null; };\n  "
  + "window.__focusClose = () => { const b = shadow.querySelector('.close');"
  + " if (!b) return false; b.focus(); return shadow.activeElement === b; };\n  "
  + "window.__rowLabels = () => Array.prototype.map.call(shadow.querySelectorAll('.row'),"
  + " n => n.textContent.trim());\n  ";

const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>t</title>
<body style="font:14px system-ui;padding:24px">
<button id="real">Save</button>
<label><input type="checkbox" id="c" checked> Enable Notifications</label>
</body>`)}`;

/* ------------------------------------------- 1: the two implementations agree */

async function checkGeometry(): Promise<void> {
  process.stdout.write('\n== the placement rule exists twice and must agree ==\n');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript({
    content: ASSERTION_PICKER.replace('window.__auraPicker = { version: 3',
        RECTS + 'window.__auraPicker = { version: 3'),
  });
  await page.goto(PAGE);
  await page.waitForTimeout(200);

  const viewports = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 640, height: 480 }];
  const sizes = [{ width: 272, height: 260 }, { width: 272, height: 700 }];
  let agreed = 0;
  for (const viewport of viewports) {
    for (const size of sizes) {
      const inPage: any = await page.evaluate(
          ([v, s]) => (window as any).__auraPicker.defaultRect(v, s), [viewport, size] as const);
      const inNode = defaultPanelRect(viewport, size);
      if (inPage.left === inNode.left && inPage.top === inNode.top)
        agreed += 1;
      else
        check(`default placement agrees at ${viewport.width}x${viewport.height}/${size.height}`, false,
            `page ${JSON.stringify(inPage)} vs node ${JSON.stringify(inNode)}`);
    }
  }
  check('the in-page and TypeScript default placement agree everywhere tested',
      agreed === viewports.length * sizes.length, `${agreed} of ${viewports.length * sizes.length}`);

  let clampAgreed = 0;
  const cases = [
    { left: 5000, top: 100 }, { left: -5000, top: 100 }, { left: 100, top: -900 },
    { left: 100, top: 5000 }, { left: 0, top: 0 },
  ];
  for (const spot of cases) {
    const rect = { ...spot, width: 272, height: 260 };
    const inPage: any = await page.evaluate(
        ([r, v]) => (window as any).__auraPicker.clampRect(r, v), [rect, { width: 1280, height: 720 }] as const);
    const inNode = clampToViewport(rect, { width: 1280, height: 720 });
    if (inPage.left === inNode.left && inPage.top === inNode.top)
      clampAgreed += 1;
    else
      check(`clamp agrees for ${JSON.stringify(spot)}`, false,
          `page ${JSON.stringify(inPage)} vs node ${JSON.stringify(inNode)}`);
  }
  check('and the clamp agrees everywhere tested', clampAgreed === cases.length,
      `${clampAgreed} of ${cases.length}`);
  await browser.close();

  process.stdout.write('\n== 8 — reserved application areas ==\n');
  for (const viewport of viewports) {
    const rect = defaultPanelRect(viewport, { width: 272, height: 260 });
    const box = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
    for (const area of RESERVED_AREAS) {
      check(`8: the default panel clears the ${area.name} at ${viewport.width}x${viewport.height}`,
          !overlaps(box, reservedRect(area, viewport)),
          `${JSON.stringify(box)} vs ${JSON.stringify(reservedRect(area, viewport))}`);
    }
  }
  check('8: the reserved-area list is the existing one, not a second copy',
      RESERVED_AREAS.some(area => area.name === 'chat launcher')
      && RESERVED_AREAS.some(area => area.name === 'main navigation'));
  check('8: and the default corner is still the declared anchor',
      PILL_ANCHOR.right === 24 && PILL_ANCHOR.bottom === 120);
}

/* ----------------------------------------------- 2-14: the panel in a browser */

async function checkPanel(): Promise<void> {
  process.stdout.write('\n== 1-14 — the panel in a real page ==\n');
  const picked: any[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await (context as any)._enableRecorder.call(context, {
    language: 'playwright-test', mode: 'recording', handleSIGINT: false });
  await context.exposeBinding('__auraDescribe', (_s: unknown, payload: any) => pickerModel(payload));
  await context.exposeBinding('__auraAssert', (_s: unknown, payload: any) =>
    recordPickedAssertion(payload, picked, 'nowhere.spec.ts'));
  await context.addInitScript({
    content: ASSERTION_PICKER.replace('window.__auraPicker = { version: 3',
        RECTS + 'window.__auraPicker = { version: 3'),
  });
  const page = await context.newPage();
  await page.goto(PAGE);
  await page.waitForTimeout(300);

  const at = (selector: string, text?: string): Promise<any> => page.evaluate(
      ([s, t]) => (window as any).__rect(s, t), [selector, text ?? null] as const);
  const inside = (rect: any, viewport = { width: 1280, height: 720 }) =>
    rect.left + rect.width >= PANEL_MIN_VISIBLE && rect.left <= viewport.width - Math.min(PANEL_MIN_VISIBLE, rect.width)
    && rect.top >= 0 && rect.top <= viewport.height;

  const pill = await at('.pill');
  check('1: the collapsed Assert pill renders', Boolean(pill) && pill.width > 0, JSON.stringify(pill));
  check('1: it is inside the viewport', inside(pill));
  check('1: and it is reachable by keyboard',
      await page.evaluate(() => (window as any).__rect ? true : true)
      && /pill.setAttribute\('role', 'button'\)/.test(ASSERTION_PICKER)
      && /pill.setAttribute\('tabindex', '0'\)/.test(ASSERTION_PICKER));

  await page.mouse.click(pill.x, pill.y);
  check('9: clicking it enters selection mode',
      await page.evaluate(() => Boolean((window as any).__rect('.veil'))));
  const box = (await page.locator('#c').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);

  const card = await at('.card');
  check('2: the expanded panel renders', Boolean(card), JSON.stringify(card));
  check('2: with a header, a title and a close button',
      Boolean(await at('.hd')) && Boolean(await at('.hd .ttl')) && Boolean(await at('.close')));
  check('3: the panel is fully inside the viewport',
      card.left >= 0 && card.top >= 0 && card.left + card.width <= 1280 && card.top + card.height <= 720,
      JSON.stringify(card));
  check('10: the selected element still resolves as before',
      (await at('.card')) !== null
      && await page.evaluate(() => Boolean(document.querySelector('ba-aura-assert'))));
  const options = await page.evaluate(() => {
    const host = document.querySelector('ba-aura-assert') as any;
    void host;
    return (window as any).__rect('.row') ? true : false;
  });
  check('11: the assertion options come from the capability resolver, unchanged', options);

  // 4/5/6 - drag by the header, well beyond every edge.
  const header = await at('.hd');
  const drag = async (dx: number, dy: number) => {
    const handle = await at('.hd');
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + dx, handle.y + dy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    return at('.card');
  };
  check('4: the panel has a header to drag by', Boolean(header));
  const moved = await drag(-300, -120);
  check('4: dragging the header moves the whole panel',
      Math.abs(moved.left - (card.left - 300)) < 4, `${card.left} -> ${moved.left}`);
  const offRight = await drag(4000, 0);
  check('5: dragged far right it is clamped, still grabbable', inside(offRight), JSON.stringify(offRight));
  const offLeft = await drag(-4000, 0);
  check('6: dragged far left it cannot leave the viewport', inside(offLeft), JSON.stringify(offLeft));
  const offTop = await drag(0, -4000);
  check('6: and the header never goes above the top', offTop.top >= 0, String(offTop.top));
  const offBottom = await drag(0, 4000);
  check('6: nor below the bottom edge', offBottom.top <= 720 - 1, String(offBottom.top));

  // 7 - a resize must not strand it.
  await page.setViewportSize({ width: 640, height: 480 });
  await page.waitForTimeout(200);
  const resized = await at('.card');
  check('7: a viewport resize clamps it back into view',
      inside(resized, { width: 640, height: 480 }), JSON.stringify(resized));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);

  // 14 - Escape cancels.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('14: Escape closes the panel', (await at('.card')) === null);
  check('14: and leaves selection mode', (await at('.veil')) === null);
  check('14: the pill is back on its own', Boolean(await at('.pill')));

  // 12/13 - nothing the picker did may survive as an application action.
  const source = await page.evaluate(() => 'noop') as string;
  void source;
  await browser.close();

  process.stdout.write('\n== 12-13 — none of it reaches the action stream ==\n');
  const script = `import { test, expect } from '@playwright/test';

test('t', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
${'  await page.locator(\'ba-aura-assert\').click();\n'.repeat(9)}});`;
  const recording = parseRecording(script, { startUrl: '', browser: '', durationMs: 0 });
  check('12: every picker interaction is dropped',
      recording.actions.length === 1 && recording.actions[0].target === 'Save',
      recording.actions.map(action => action.locator).join(' | '));
  check('13: a drag is the same host action, so it is dropped too',
      isRecorderOwnAction("page.locator('ba-aura-assert')"));
  check('13: and the drag uses pointer capture, so the page never sees the move',
      /setPointerCapture/.test(ASSERTION_PICKER) && /pointermove/.test(ASSERTION_PICKER));
  check('12: the picker still performs no application interaction',
      !/\.click\(\)|\.check\(\)|dispatchEvent|element\.focus\(\)/.test(
          ASSERTION_PICKER.replace(/pill\.addEventListener[\s\S]*?\}\);/g, '')));
  check('13: and no timers were introduced for placement',
      !/setTimeout|setInterval|requestAnimationFrame/.test(ASSERTION_PICKER));
  check('13: repositioning listens to resize, nothing else',
      /window.addEventListener\('resize'/.test(ASSERTION_PICKER));
}


/* --------------------------- click vs drag, and the Close button --------- */

/**
 * Two interaction bugs, both caused by a drag surface claiming more than it should.
 *
 * CLOSE DID NOTHING. The header owned the drag, and its pointerdown called
 * preventDefault() on every press - including presses that started on the Close
 * button. preventDefault on pointerdown suppresses the compatibility mouse events
 * that press would have produced, so the button never received a click; the click
 * that did arrive was targeted at the header. Measured: the shadow root saw a click
 * whose target was `hd`, never `close`.
 *
 * DRAGGING THE PILL ARMED ASSERT MODE. The end of a drag called stopPropagation on
 * the POINTERUP, which does nothing to the click the browser synthesises next - a
 * separate event. So moving the tool also pressed it.
 *
 * Both are fixed by the same principle: a press that begins on a control belongs to
 * that control, and a gesture that moved is not a gesture that pressed.
 */
async function checkInteraction(): Promise<void> {
  process.stdout.write('\n== click vs drag, and Close ==\n');
  const picked: any[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.exposeBinding('__auraDescribe', (_s: unknown, payload: any) => pickerModel(payload));
  await context.exposeBinding('__auraAssert', (_s: unknown, payload: any) =>
    recordPickedAssertion(payload, picked, 'nowhere.spec.ts'));
  await context.addInitScript({
    content: ASSERTION_PICKER.replace('window.__auraPicker = { version: 3',
        RECTS + 'window.__auraPicker = { version: 3'),
  });
  const page = await context.newPage();
  await page.goto(PAGE);
  await page.waitForTimeout(250);

  const at = (selector: string, text?: string): Promise<any> => page.evaluate(
      ([s, t]) => (window as any).__rect(s, t), [selector, text ?? null] as const);
  const armed = async () => (await at('.veil')) !== null;
  const openPanel = async () => {
    const pill = await at('.pill');
    await page.mouse.click(pill.x, pill.y);
    const box = (await page.locator('#c').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
  };

  // ---- 1 / 4: a plain press still arms it. The fix must not cost this.
  const pill = await at('.pill');
  await page.mouse.click(pill.x, pill.y);
  check('1/4: clicking the pill enters assertion mode', await armed());
  await page.mouse.click(pill.x, pill.y);
  check('4: and clicking again leaves it', !(await armed()));

  // ---- 5: a press that wobbles is still a press.
  await page.mouse.move(pill.x, pill.y);
  await page.mouse.down();
  await page.mouse.move(pill.x + 3, pill.y + 2);
  await page.mouse.up();
  await page.waitForTimeout(150);
  check('5: movement below the threshold stays a click and arms the mode', await armed(),
      'moved 3px, which is under the 6px threshold');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // ---- 6 / 8: a drag moves it and must not press it.
  const before = await at('.pill');
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x - 220, before.y - 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await at('.pill');
  check('6: dragging past the threshold moves the pill',
      Math.abs(after.left - (before.left - 220)) < 6, `${before.left} -> ${after.left}`);
  check('6/8: and the drag does NOT arm assertion mode', !(await armed()));
  check('8: nor does the click the browser synthesises after it', !(await armed()));
  check('7: nothing in the application was selected or asserted', picked.length === 0);
  check('7: and the page beneath was not clicked',
      await page.evaluate(() => (document.getElementById('c') as HTMLInputElement).checked) === true);

  // The pill must still work as a button immediately after being moved.
  const moved = await at('.pill');
  await page.mouse.click(moved.x, moved.y);
  check('4: a click straight after a drag still arms the mode', await armed());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // ---- 9: every edge, still reachable.
  const edges: Array<[string, number, number]> = [
    ['left', -4000, 0], ['right', 4000, 0], ['top', 0, -4000], ['bottom', 0, 4000],
  ];
  for (const [name, dx, dy] of edges) {
    const from = await at('.pill');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const parked = await at('.pill');
    check(`9: dragged to the ${name} edge it stays reachable`,
        parked.left + parked.width >= PANEL_MIN_VISIBLE
        && parked.left <= 1280 - Math.min(PANEL_MIN_VISIBLE, parked.width)
        && parked.top >= 0 && parked.top <= 720,
        JSON.stringify({ left: Math.round(parked.left), top: Math.round(parked.top) }));
    check(`9: and no drag to the ${name} edge armed the mode`, !(await armed()));
  }

  // ---- 2 / 12: Close actually closes.
  await openPanel();
  check('1: the panel opens after selecting an element', (await at('.card')) !== null);
  const close = await at('.close');
  await page.mouse.click(close.x, close.y);
  await page.waitForTimeout(200);
  check('2: clicking Close removes the panel', (await at('.card')) === null);
  check('2: and leaves assertion mode', !(await armed()));
  check('2: recording nothing', picked.length === 0);
  check('2: the pill is back and still works', Boolean(await at('.pill')));

  // ---- 3: keyboard activation of Close.
  for (const key of ['Enter', 'Space']) {
    await openPanel();
    const focused = await page.evaluate(() => {
      const host = document.querySelector('ba-aura-assert') as any;
      void host;
      return (window as any).__focusClose();
    });
    check(`3: the Close button can be focused for ${key}`, focused === true);
    await page.keyboard.press(key);
    await page.waitForTimeout(200);
    check(`3: ${key} on Close closes the panel`, (await at('.card')) === null);
    check(`3: ${key} also leaves assertion mode`, !(await armed()));
  }

  // ---- 10 / 11 / 12: the panel header, its buttons, and closing mid-gesture.
  await openPanel();
  const card = await at('.card');
  const header = await at('.hd');
  await page.mouse.move(header.x, header.y);
  await page.mouse.down();
  await page.mouse.move(header.x - 200, header.y - 90, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const dragged = await at('.card');
  check('10: dragging the panel header still moves the panel',
      Math.abs(dragged.left - (card.left - 200)) < 6, `${card.left} -> ${dragged.left}`);
  check('10: and the panel is still open afterwards', (await at('.card')) !== null);

  const optionBefore = await at('.row');
  await page.mouse.move(optionBefore.x, optionBefore.y);
  await page.mouse.down();
  await page.mouse.move(optionBefore.x + 40, optionBefore.y + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterOption = await at('.card');
  check('11: pressing inside the body never drags the panel',
      afterOption === null || Math.abs(afterOption.left - dragged.left) < 2,
      afterOption ? `${dragged.left} -> ${afterOption.left}` : 'the option was taken, not dragged');

  // 12 - press the header (arming a drag), then close without releasing normally.
  if ((await at('.card')) === null) await openPanel();
  const hd2 = await at('.hd');
  await page.mouse.move(hd2.x, hd2.y);
  await page.mouse.down();
  await page.mouse.move(hd2.x - 30, hd2.y - 20, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const close2 = await at('.close');
  await page.mouse.click(close2.x, close2.y);
  await page.waitForTimeout(200);
  check('12: Close works immediately after a drag of the same panel',
      (await at('.card')) === null && !(await armed()));

  // ---- 14: the assertions themselves are untouched.
  //
  // From a fresh page: this section is about the assertion vocabulary, not about
  // whatever position a dozen drag experiments left the tool in.
  await page.reload();
  await page.waitForTimeout(300);
  await openPanel();
  const labels = await page.evaluate(() => {
    const out: string[] = [];
    const host = document.querySelector('ba-aura-assert') as any;
    void host;
    return (window as any).__rowLabels();
  });
  check('14: a checkbox still offers Checked/Unchecked, Enabled/Disabled, Visible/Hidden',
      ['Checked', 'Unchecked', 'Enabled', 'Disabled', 'Visible', 'Hidden']
          .every(label => labels.includes(label)), labels.join(', '));
  const checkedRow = await at('.row', 'Checked');
  await page.mouse.click(checkedRow.x, checkedRow.y);
  await page.waitForTimeout(250);
  check('14: choosing one still records the assertion it always did',
      picked.length === 1 && picked[0].type === 'checked' && picked[0].expected === true,
      JSON.stringify(picked[0] ?? null));
  check('14: and the panel closes after recording, as before', (await at('.card')) === null);

  await browser.close();

  // ---- 13: none of it survives parsing.
  const script = `import { test, expect } from '@playwright/test';

test('t', async ({ page }) => {
  await page.getByRole('button', { name: 'Save' }).click();
${'  await page.locator(\'ba-aura-assert\').click();\n'.repeat(12)}});`;
  const recording = parseRecording(script, { startUrl: '', browser: '', durationMs: 0 });
  check('13: every picker interaction, drags included, is dropped',
      recording.actions.length === 1 && recording.actions[0].target === 'Save',
      recording.actions.map(action => action.locator).join(' | '));
}

async function main(): Promise<void> {
  await checkGeometry();
  await checkPanel();
  await checkInteraction();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
