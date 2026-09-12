import '../testing/isolated-checkout';
/**
 * The notification overlay is a component, and it is declared exactly once.
 *
 *   npx tsx ai/autocode/notifications-knowledge.fixture.ts
 *
 * The bell is signed-in chrome: the recordings open this panel from /apps
 * (TC_LOGIN_074, TC_DASHBOARD_006) and from /issues/<id> (TC_DASHBOARD_003, which
 * clicked a project card first), and the URL never changes when it opens. So no
 * route owns it, and neither of those screens' page objects should claim it.
 *
 * It is declared in fixtureapp__apps.yaml because knowledge has no cross-route
 * component concept yet, and matching reads every file regardless of route - which
 * is why ONE declaration serves both screens.
 *
 * THE REASON NOT TO COPY IT INTO THE OTHER FILE is the check at the bottom. Two
 * entries naming the same method tie at the same rank, and findMethod refuses a
 * tie. Duplicating these entries would silently stop the match working - the
 * opposite of what duplicating them would be for.
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildIndex } from '../knowledge/index';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording } from './from-recording';

const ROOT = process.cwd();
const KNOWLEDGE = path.join(ROOT, 'ai', 'knowledge', 'page');
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

function stepsFor(body: string): Array<{ kind: string; code: string; why: string }> {
  const script = [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('t', async ({ page }) => {",
    body,
    '});',
  ].join('\n');
  return mapRecording(parseRecording(script, { startUrl: '', browser: '', durationMs: 0 }))
      .steps.map(step => ({ kind: step.kind, code: step.code.join(' '), why: step.why ?? '' }));
}

/* ------------------------------------------------------------ resolution ---- */

function checkResolution(): void {
  process.stdout.write('\n== the three elements resolve to their methods ==\n');

  // Exactly what the recordings contain, verbatim.
  const steps = stepsFor([
    "  await page.getByRole('link', { name: 'Notifications' }).click();",
    "  await page.getByRole('button', { name: 'Notification settings' }).click();",
    "  await expect(page.locator('#notification_panel')).toContainText('Notification Preferences');",
  ].join('\n'));
  const code = steps.map(step => step.code).join('\n');

  check('12: the bell resolves to WorkspacePage.notificationsBell()',
      /workspacePage\.notificationsBell\(\)/.test(code), code.split('\n')[0] ?? '');
  check('12: the settings control resolves to NotificationsPanel.settingsButton()',
      /notificationsPanel\.settingsButton\(\)/.test(code), code.split('\n')[1] ?? '');
  check('12: the panel resolves to NotificationsPanel.panel()',
      /notificationsPanel\.panel\(\)/.test(code), code.split('\n')[2] ?? '');

  // The assertion must survive intact. The Page Object branch used to hand MATCHER
  // the assertion's VALUE where the assertion belongs and omit `positive`, so every
  // Page Object assertion came out as `.not.toContainText('')` - negated, and empty.
  // It was invisible because no assertion had ever matched a Page Object method.
  check('12: and the assertion keeps its value and its polarity',
      /toContainText\('Notification Preferences'\)/.test(code) && !/\.not\./.test(code),
      steps[2]?.code ?? 'no assertion step');

  // Every one of them is a real reuse, not a raw locator wearing a label.
  check('12: all three are page-object steps',
      steps.filter(step => step.kind === 'page-object').length === 3,
      steps.map(step => step.kind).join(', '));
}

/* ------------------------------------------------------------- ownership ---- */

function checkOwnership(): void {
  process.stdout.write('\n== declared once, and not on the wrong class ==\n');

  const files = fs.readdirSync(KNOWLEDGE).filter(name => name.endsWith('.yaml'));
  const mentions = files.filter(name =>
    /page_object_method:\s*(notificationsBell|panel|settingsButton)\b/
        .test(fs.readFileSync(path.join(KNOWLEDGE, name), 'utf8')));

  // 13 / 16: one file, and one entry per method. A second copy would tie at the same
  // rank and findMethod would refuse BOTH - so this check is the reason the
  // /issues/<id> duplicate must never be added.
  check('13/16: the notification methods are declared in exactly one knowledge file',
      mentions.length === 1 && mentions[0] === 'fixtureapp__apps.yaml', mentions.join(', ') || 'none');

  const apps = fs.readFileSync(path.join(KNOWLEDGE, 'fixtureapp__apps.yaml'), 'utf8');
  for (const method of ['notificationsBell', 'panel', 'settingsButton']) {
    const count = (apps.match(new RegExp(`page_object_method:\\s*${method}\\b`, 'g')) ?? []).length;
    check(`13: ${method} is declared once, not duplicated`, count === 1, `${count} declaration(s)`);
  }

  // 14: ownership. The overlay belongs to the component, the bell to the chrome.
  // Naming ProjectsPage here would tie the panel to /apps, which is exactly the
  // screen the TC_DASHBOARD_003 recording was NOT on when it opened it.
  //
  // Read per ENTRY, not with a sliding window: the entry that follows these is
  // project_search_field, which is legitimately ProjectsPage, and a window wide
  // enough to cover an entry is wide enough to reach into the next one.
  const owners = new Map<string, string>();
  for (const block of apps.split(/\n {2}(?=[\w-]+:)/)) {
    const key = /^\s*([\w-]+):/.exec(block)?.[1];
    const owner = /page_object:\s*(\w+)/.exec(block)?.[1];
    if (key && owner)
      owners.set(key, owner);
  }
  check('14: the panel is owned by NotificationsPanel, not ProjectsPage',
      owners.get('notification_panel') === 'NotificationsPanel',
      owners.get('notification_panel') ?? 'not declared');
  check('14: the settings control is owned by NotificationsPanel',
      owners.get('notification_settings') === 'NotificationsPanel',
      owners.get('notification_settings') ?? 'not declared');
  check('14: the bell is owned by WorkspacePage - it is chrome, not a screen',
      owners.get('notifications_bell') === 'WorkspacePage',
      owners.get('notifications_bell') ?? 'not declared');

  const misattributed = [...owners].filter(([key, owner]) =>
    /notif/i.test(key) && owner === 'ProjectsPage');
  check('14: no notification element is attributed to ProjectsPage',
      misattributed.length === 0, misattributed.map(([key]) => key).join(', '));
}

/* ---------------------------------------------------------- reachability ---- */

function checkReachable(): void {
  process.stdout.write('\n== the class and its fixture actually exist ==\n');

  // 15: the index must know the class, or every entry above is a promise to call
  // something that cannot be reached.
  const index = buildIndex();
  const panel = index.pages.NotificationsPanel;
  check('15: NotificationsPanel is indexed as a Page Object', Boolean(panel),
      Object.keys(index.pages).join(', '));
  for (const method of ['panel', 'settingsButton']) {
    check(`15: NotificationsPanel.${method}() exists on the class`,
        Boolean(panel?.methods.some(entry => entry.name === method)));
  }
  check('15: WorkspacePage.notificationsBell() exists on the class',
      Boolean(index.pages.WorkspacePage?.methods.some(entry => entry.name === 'notificationsBell')));

  // A generated spec destructures the fixture by name. `fixtureFor` lower-cases the
  // class, so the fixtures module must expose exactly `notificationsPanel`.
  const fixtures = fs.readFileSync(path.join(ROOT, 'tests-e2e', 'fixtures.ts'), 'utf8');
  check('15: the notificationsPanel fixture is registered',
      /notificationsPanel:\s*NotificationsPanel/.test(fixtures)
      && /notificationsPanel:\s*async/.test(fixtures));

  // None of these methods takes an argument, so the C1 guard must let all of them
  // through. If one ever gains a parameter, this is what will say so.
  const required = ['panel', 'settingsButton']
      .map(name => (panel?.methods.find(entry => entry.name === name)?.params ?? [])
          .filter(param => !param.optional).length)
      .concat((index.pages.WorkspacePage?.methods.find(entry => entry.name === 'notificationsBell')?.params ?? [])
          .filter(param => !param.optional).length);
  check('15: all three take no required argument, so the C1 guard admits them',
      required.every(count => count === 0), required.join(', '));
}

/* ------------------------------------------------ the Page Object assertion ---- */

/**
 * The Page Object assertion branch, which C2 is the first thing ever to reach.
 *
 * It called MATCHER with the assertion's VALUE where the assertion object belongs
 * and omitted `positive` entirely:
 *
 *   MATCHER[type](receiver, assertion.value)        // 2 arguments, wrong second
 *   MATCHER[type](receiver, assertion, positive)    // what the locator branch does
 *
 * So `positive` was `undefined` - falsy - and every Page Object assertion came out
 * NEGATED, reading its text off a string that has no `.value`: `.not.toContainText('')`.
 * It shipped in nothing, because no assertion had ever matched a Page Object method;
 * every one of them fell through to the locator branch, which was always correct.
 *
 * These checks are the reason it cannot come back. Both polarities, both branches.
 */
function checkAssertionEmission(): void {
  process.stdout.write('\n== assertions keep their polarity, their text and their receiver ==\n');

  const positive = stepsFor(
      "  await expect(page.locator('#notification_panel')).toContainText('Notification Preferences');");
  const negative = stepsFor(
      "  await expect(page.locator('#notification_panel')).not.toContainText('Notification Preferences');");
  const positiveCode = positive[0]?.code ?? '';
  const negativeCode = negative[0]?.code ?? '';

  check('a positive Page Object assertion stays positive',
      /toContainText\(/.test(positiveCode) && !/\.not\./.test(positiveCode), positiveCode);
  check('a negative Page Object assertion stays negative',
      /\.not\.toContainText\(/.test(negativeCode), negativeCode);
  check('the expected text survives on both',
      positiveCode.includes("'Notification Preferences'")
      && negativeCode.includes("'Notification Preferences'"),
      `${positiveCode} | ${negativeCode}`);
  check('and neither is the empty string the defect produced',
      !/toContainText\(''\)/.test(positiveCode) && !/toContainText\(''\)/.test(negativeCode));

  // The receiver is the awaited Page Object call, not the raw locator and not a
  // half-built string.
  check('the receiver is the awaited Page Object method',
      /expect\(await notificationsPanel\.panel\(\)\)/.test(positiveCode), positiveCode);
  check('both steps are page-object steps',
      positive[0]?.kind === 'page-object' && negative[0]?.kind === 'page-object',
      `${positive[0]?.kind}, ${negative[0]?.kind}`);

  // The locator branch was always right and must be untouched by the fix. Same two
  // polarities, on a target no Page Object describes.
  const locatorPositive = stepsFor(
      "  await expect(page.locator('#some_other_thing')).toContainText('Nope');");
  const locatorNegative = stepsFor(
      "  await expect(page.locator('#some_other_thing')).not.toContainText('Nope');");
  check('an unmapped positive assertion is unchanged',
      locatorPositive[0]?.kind === 'codegen-locator'
      && locatorPositive[0].code === `await expect(page.locator('#some_other_thing')).toContainText('Nope');`,
      locatorPositive[0]?.code ?? '');
  check('an unmapped negative assertion is unchanged',
      locatorNegative[0]?.kind === 'codegen-locator'
      && locatorNegative[0].code === `await expect(page.locator('#some_other_thing')).not.toContainText('Nope');`,
      locatorNegative[0]?.code ?? '');

  // Nothing else about assertion emission moved: every matcher type still renders
  // through the same table, so a type the fix never touched must be untouched.
  const checked = stepsFor("  await expect(page.locator('#some_other_thing')).toBeChecked();");
  const hidden = stepsFor("  await expect(page.locator('#some_other_thing')).toBeHidden();");
  check('unrelated matcher types are unaffected',
      checked[0]?.code === `await expect(page.locator('#some_other_thing')).toBeChecked();`
      && hidden[0]?.code === `await expect(page.locator('#some_other_thing')).toBeHidden();`,
      `${checked[0]?.code ?? ''} | ${hidden[0]?.code ?? ''}`);
}

function main(): void {
  checkResolution();
  checkOwnership();
  checkReachable();
  checkAssertionEmission();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
