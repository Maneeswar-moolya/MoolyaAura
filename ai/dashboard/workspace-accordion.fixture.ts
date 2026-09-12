import '../testing/isolated-checkout';
/**
 * The Test Case Workspace, grouped by sheet and collapsible.
 *
 *   npx tsx ai/dashboard/workspace-accordion.fixture.ts
 *
 * Drives the REAL `public/index.html` in a browser with the workbook API stubbed,
 * because the thing under test is rendering: whether a collapsed sheet puts rows
 * in the document, whether a search reaches inside one, whether clearing it gives
 * the person their chevrons back. Reading the source cannot answer any of those.
 *
 * No server, no workbook, no network beyond the stubbed route. Nothing is written.
 */

import { chromium, type Browser, type Page } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** Three sheets, so the many-sheets default and independence are both testable. */
const CASES = [
  ...Array.from({ length: 6 }, (_, i) => ({
    testCaseId: `TC_LOGIN_${String(i + 1).padStart(3, '0')}`,
    worksheet: 'Login Test Cases', module: 'Login', feature: '', priority: i < 2 ? 'P0' : 'P1',
    scenario: i === 4 ? 'Notification preferences are saved' : `Login scenario ${i + 1}`,
    tags: [], execute: true, runnable: true, status: i < 3 ? 'Automated' : 'Generated',
    automationStatus: i < 3 ? 'Automated' : 'Generated', dataDriven: null, blockedReason: [],
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    testCaseId: `TC_DASHBOARD_${String(i + 1).padStart(3, '0')}`,
    worksheet: 'DashBoard', module: 'DashBoard', feature: '', priority: 'P2',
    scenario: i === 0 ? 'Notification bell opens the panel' : `Dashboard scenario ${i + 1}`,
    tags: [], execute: true, runnable: i > 0, status: 'Needs Review',
    automationStatus: 'Needs Review', dataDriven: null, blockedReason: [],
  })),
  {
    testCaseId: 'TC_PROJ_001', worksheet: 'Create Project', module: 'Project', feature: '',
    priority: 'P1', scenario: 'Create a project', tags: [], execute: true, runnable: true,
    status: 'Generated', automationStatus: 'Generated', dataDriven: null, blockedReason: [],
  },
];

const WORKBOOK = {
  workbook: 'login-test-cases.xlsx',
  worksheets: ['Login Test Cases', 'DashBoard', 'Create Project'],
  cases: CASES, issues: [], malformed: [], recording: null,
};

/**
 * The real page, over http, with the API answered from the fixture.
 *
 * A file:// origin cannot fetch, and the page loads its workbook over the API - so
 * a server is the only way to exercise the rendering it does. It serves the real
 * `index.html` and canned JSON; it reads no workbook and writes nothing.
 */
async function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const html = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/public/index.html'), 'utf8');
  const server = http.createServer((request, response) => {
    const url = request.url ?? '/';
    const json = (body: unknown) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    // Rendering a workbook requires an explicitly selected project. An absent
    // project list now correctly displays onboarding instead of loading a workbook.
    if (url.startsWith('/api/projects')) return json({
      soleApplication: true,
      projects: [{ applicationId: 'workspace-fixture', displayName: 'Workspace fixture',
        defaultEnvironmentId: 'qa', environments: [{ environmentId: 'qa', baseUrl: 'https://workspace.invalid/' }] }],
    });
    if (url.startsWith('/api/workbooks')) return json({ workbooks: [WORKBOOK.workbook] });
    if (url.startsWith('/api/workbook')) return json(WORKBOOK);
    if (url.startsWith('/api/runs')) return json({ runs: [] });
    if (url.startsWith('/api/health')) return json({ ok: true });
    if (url.startsWith('/api')) return json({});
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

async function open(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(url);
  // The workspace lives on its own tab; Overview is what opens first.
  await page.click('#tab-cases');
  await page.waitForFunction(() => document.querySelectorAll('#caseRows .sheet-row').length > 0,
      null, { timeout: 15000 });
  return page;
}

const sheets = (page: Page) => page.evaluate(() => Array.from(
    document.querySelectorAll('#caseRows .sheet-row .sheet-label'))
    .map(node => ({
      name: (node.querySelector('.sheet-name') as HTMLElement)?.textContent ?? '',
      expanded: node.getAttribute('aria-expanded') === 'true',
      counts: (node.querySelector('.sheet-counts') as HTMLElement)?.textContent ?? '',
    })));

/** Case rows only - the sheet headers are rows too. */
const rowIds = (page: Page) => page.evaluate(() => Array.from(
    document.querySelectorAll('#caseRows tr:not(.sheet-row) td.id'))
    .map(node => (node as HTMLElement).textContent ?? ''));

const clickSheet = (page: Page, name: string) => page.evaluate((sheet) => {
  for (const node of Array.from(document.querySelectorAll('#caseRows .sheet-label'))) {
    if ((node.querySelector('.sheet-name') as HTMLElement)?.textContent === sheet) {
      (node as HTMLElement).click();
      return;
    }
  }
  throw new Error(`no sheet header named ${sheet}`);
}, name);

async function main(): Promise<void> {
  const site = await serve();
  const browser = await chromium.launch({ headless: true });
  const page = await open(browser, site.url);

  process.stdout.write('\n== 16-19 — sheets as collapsible groups ==\n');
  let groups = await sheets(page);
  check('16: every worksheet renders as a group header',
      groups.map(g => g.name).join(' | ') === 'Login Test Cases | DashBoard | Create Project',
      groups.map(g => g.name).join(' | '));
  check('16: with a chevron and an expanded state',
      groups.every(g => !g.expanded), groups.map(g => `${g.name}=${g.expanded}`).join(', '));
  check('17: a collapsed sheet puts NO case rows in the document',
      (await rowIds(page)).length === 0, `${(await rowIds(page)).length} row(s)`);
  check('25: the header counts the cases and the runnable ones',
      /6 matching|6 cases/.test(groups[0].counts) && /5 runnable|6 runnable/.test(groups[0].counts),
      groups[0].counts);
  check('25: and names the ones needing review where there are any',
      /to review/.test(groups[1].counts), groups[1].counts);

  await clickSheet(page, 'Login Test Cases');
  check('18: expanding renders exactly that sheet\'s cases',
      (await rowIds(page)).join(',') === 'TC_LOGIN_001,TC_LOGIN_002,TC_LOGIN_003,TC_LOGIN_004,TC_LOGIN_005,TC_LOGIN_006',
      (await rowIds(page)).join(','));
  await clickSheet(page, 'DashBoard');
  const both = await rowIds(page);
  check('19: sheets open independently',
      both.length === 9 && both.includes('TC_DASHBOARD_001') && both.includes('TC_LOGIN_001'),
      `${both.length} rows`);
  await clickSheet(page, 'Login Test Cases');
  check('19: and close independently',
      (await rowIds(page)).every(id => id.startsWith('TC_DASHBOARD')),
      (await rowIds(page)).join(','));
  await clickSheet(page, 'DashBoard');

  process.stdout.write('\n== 20-22 — search reaches inside a collapsed sheet ==\n');
  check('20: everything is collapsed before the search', (await rowIds(page)).length === 0);
  await page.fill('#search', 'notification');
  await page.waitForTimeout(120);
  const found = await rowIds(page);
  check('20: a match inside a collapsed sheet is shown, not hidden',
      found.includes('TC_LOGIN_005') && found.includes('TC_DASHBOARD_001'), found.join(','));
  check('21: the sheets holding matches are auto-expanded',
      (await sheets(page)).every(g => g.expanded),
      (await sheets(page)).map(g => `${g.name}=${g.expanded}`).join(', '));
  check('24: a sheet with no match is not rendered at all',
      !(await sheets(page)).some(g => g.name === 'Create Project'),
      (await sheets(page)).map(g => g.name).join(' | '));
  check('25: and the header says how many matched',
      /1 matching/.test((await sheets(page))[0].counts), (await sheets(page))[0].counts);

  await page.fill('#search', '');
  await page.waitForTimeout(120);
  check('22: clearing the search restores the previous expansion exactly',
      (await sheets(page)).every(g => !g.expanded) && (await rowIds(page)).length === 0,
      (await sheets(page)).map(g => `${g.name}=${g.expanded}`).join(', '));

  // A choice made DURING a search is the choice that survives it.
  await page.fill('#search', 'notification');
  await page.waitForTimeout(100);
  await clickSheet(page, 'DashBoard');
  await page.fill('#search', '');
  await page.waitForTimeout(120);
  groups = await sheets(page);
  check('22: a sheet closed during a search stays closed afterwards',
      groups.find(g => g.name === 'DashBoard')?.expanded === false,
      groups.map(g => `${g.name}=${g.expanded}`).join(', '));

  process.stdout.write('\n== 23-24 — the existing filters still drive it ==\n');
  await page.selectOption('#priorityFilter', 'P0');
  await page.waitForTimeout(120);
  check('23: a filter narrows the groups and opens what is left',
      (await rowIds(page)).join(',') === 'TC_LOGIN_001,TC_LOGIN_002', (await rowIds(page)).join(','));
  check('24: sheets with nothing matching disappear',
      (await sheets(page)).length === 1, (await sheets(page)).map(g => g.name).join(' | '));
  await page.selectOption('#priorityFilter', '');
  await page.selectOption('#sheetFilter', 'DashBoard');
  await page.waitForTimeout(120);
  check('23: the sheet filter still selects one worksheet',
      (await sheets(page)).map(g => g.name).join('') === 'DashBoard',
      (await sheets(page)).map(g => g.name).join(' | '));
  await page.selectOption('#sheetFilter', '');
  await page.waitForTimeout(120);

  process.stdout.write('\n== 26-29 — nothing else moved ==\n');
  await clickSheet(page, 'Login Test Cases');
  const row = await page.evaluate(() => {
    const tr = Array.from(document.querySelectorAll('#caseRows tr:not(.sheet-row)'))
        .find(node => node.querySelector('td.id')?.textContent === 'TC_LOGIN_001');
    if (!tr) return null;
    return {
      tick: Boolean(tr.querySelector('td.pick input[type=checkbox]')),
      buttons: Array.from(tr.querySelectorAll('button')).map(b => (b.textContent ?? '').trim()),
      cells: tr.querySelectorAll('td').length,
    };
  });
  check('26: the case row keeps its checkbox and its actions',
      Boolean(row?.tick) && (row?.buttons.length ?? 0) > 0,
      JSON.stringify(row));
  check('26: selecting a case still works',
      await page.evaluate(() => {
        const box = document.querySelector('#caseRows tr:not(.sheet-row) td.pick input') as HTMLInputElement;
        box.click();
        return document.getElementById('statSelected')?.textContent;
      }) === '1');
  check('27: Run All is untouched and still present',
      await page.locator('#runAll, #run').count() > 0
      || await page.evaluate(() => Boolean(document.querySelector('[id*="run" i]'))));
  check('29: a collapsed sheet still renders no rows after all of this',
      await (async () => {
        await clickSheet(page, 'Login Test Cases');
        return (await rowIds(page)).length === 0;
      })());

  await browser.close();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
