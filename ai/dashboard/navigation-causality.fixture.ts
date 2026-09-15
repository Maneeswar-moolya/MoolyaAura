import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mapRecording, describeMapping } from '../autocode/from-recording';
import { chromium } from 'playwright';
import { NavigationJournal, replayableNavigation } from './navigation';
import { parseRecording } from './recorder';

async function main() {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/home?ticket=PRIVATE_SESSION' }); response.end(); return; }
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/meta-history') { response.end('<meta http-equiv="refresh" content="0;url=/login-history">'); return; }
    if (request.url === '/login-history') { response.end('<script>history.replaceState({},"",location.href)</script><h1>Login</h1>'); return; }
    if (request.url === '/fragment') { response.end(`<button onclick="location.href='/finish#PRIVATE_FRAGMENT'">Next</button>`); return; }
    if (request.url === '/meta') { response.end('<meta http-equiv="refresh" content="0;url=/finish">'); return; }
    if (request.url === '/refresh') { response.setHeader('Refresh', '0; url=/finish'); response.end('Redirecting'); return; }
    if (request.url === '/form') { response.end('<form action="/finish" method="post"><button>Next</button></form>'); return; }
    if (request.url === '/history') { response.end(`<button onclick="history.pushState({},'', '/finish#PRIVATE_FRAGMENT')">Next</button>`); return; }
    response.end(request.url === '/start'
      ? `<button onclick="location.href='/redirect'">Continue</button>` : '<h1>Home</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const journal = new NavigationJournal(); await journal.attach(page);
    await journal.navigateEntry(page, `${base}/start`);
    await Promise.all([page.waitForURL('**/home?*'), page.getByRole('button', { name: 'Continue' }).click()]);
    await journal.settle();
    const retained = journal.finish(`test('x', async ({page}) => {\n  await page.goto('${base}/start');\n  await page.getByRole('button', {name:'Continue'}).click();\n  await page.goto('${base}/redirect');\n  await page.goto('${base}/home?ticket=PRIVATE_SESSION');\n});`, `${base}/start`);
    const parsed = parseRecording(retained.source, { startUrl: '', browser: 'chromium', durationMs: 0 });
    assert.deepEqual(parsed.actions.filter(a => a.type === 'navigate').map(a => a.navigationCause), ['intentional', 'observed', 'observed'], 'Live redirect causality must be retained');
    await page.evaluate(url => { location.assign(url); }, `${base}/start`);
    await page.waitForURL(`${base}/start`); await journal.settle();
    const returned = journal.finish(`test('x', async ({page}) => {\n await page.goto('${base}/start');\n await page.getByRole('button', {name:'Continue'}).click();\n await page.goto('${base}/start');\n});`, `${base}/start`);
    const returnedActions = parseRecording(returned.source, { startUrl: '', browser: '', durationMs: 0 }).actions;
    assert.equal(returnedActions[2].navigationCause, 'observed', 'Explicit entry must not poison a proven return to the same URL');
    assert.ok(!retained.source.includes('PRIVATE_SESSION'), 'Transient browser URL must not survive recording finalization');
    const inserted = journal.finish(`test('x', async ({page}) => {\nawait page.goto('${base}/home?ticket=PRIVATE_SESSION');\n});`, `${base}/start`);
    assert.equal(inserted.insertedActions, 1); assert.ok(inserted.source.includes(`${base}/start`));
    assert.ok(!replayableNavigation(`${base}/home?opaque=secret`));
    assert.ok(!replayableNavigation(`${base}/secur/frontdoor.jsp`));
    assert.ok(!replayableNavigation('https://user:secret@example.invalid/'));
    for (const route of ['fragment', 'meta', 'refresh', 'form', 'history', 'meta-history']) {
      const subject = await browser.newPage(); const trace = new NavigationJournal(); await trace.attach(subject);
      await trace.navigateEntry(subject, `${base}/${route}`);
      if (['fragment', 'form', 'history'].includes(route)) await subject.getByRole('button', { name: 'Next' }).click();
      await subject.waitForURL(route === 'meta-history' ? '**/login-history' : '**/finish*');
      await trace.settle();
      const result = trace.finish(`test('x', async ({page}) => {\n await page.goto('${base}/${route}');\n await page.goto('${subject.url()}');\n});`, `${base}/${route}`);
      const actions = parseRecording(result.source, { startUrl: '', browser: '', durationMs: 0 }).actions;
      assert.equal(actions[1].navigationCause, 'observed', `browser ${route} navigation must be observed`);
      assert.ok(!result.source.includes('PRIVATE_FRAGMENT'), 'Fragment value must not be persisted');
      assert.ok((actions[1] as any).navigationReason, 'Navigation reason must survive parsing');
      await subject.close(); console.log(`PASS browser ${route} causality`);
    }
    await eventCorrelation();
    console.log('PASS live intentional navigation, script redirect, HTTP redirect, start restoration and URL privacy');
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
(process.argv.includes('--events-only') ? eventCorrelation() : main()).catch(error => { console.error(error); process.exitCode = 1; });

async function eventCorrelation() {
  async function scenario(events: Array<[string, any]>, destination = 'https://synthetic.invalid/finish', entryRequests?: any[]) {
    const cdp = new EventEmitter() as any;
    cdp.send = async (method: string) => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : {};
    const page = new EventEmitter() as any;
    page.context = () => ({ newCDPSession: async () => cdp }); page.mainFrame = () => 'main';
    const journal = new NavigationJournal(); await journal.attach(page);
    if (entryRequests) {
      page.goto = async () => { for (const request of entryRequests) cdp.emit('Network.requestWillBeSent', request); };
      await journal.navigateEntry(page, 'https://synthetic.invalid/start');
    }
    for (const [event, payload] of events) cdp.emit(event, payload);
    await journal.settle();
    const source = journal.finish(`test('x', async ({page}) => {\n await page.goto('https://synthetic.invalid/start');\n await page.goto('${destination}');\n});`, 'https://synthetic.invalid/start').source;
    assert.ok(!source.includes('PRIVATE_FRAGMENT'), 'Navigation diagnostic must not expose fragment values');
    return { ...parseRecording(source, { startUrl: '', browser: '', durationMs: 0 }), retainedSource: source };
  }
  const request = (id: string, type = 'other', frameId = 'main') => ({ frameId, loaderId: id, requestId: id,
    type: 'Document', documentURL: 'https://synthetic.invalid/finish', request: { url: 'https://synthetic.invalid/finish' }, initiator: { type } });
  const reason = { frameId: 'main', url: 'https://synthetic.invalid/finish', reason: 'scriptInitiated' };
  const startUrl = 'https://synthetic.invalid/start';
  const entryRequest = { ...request('entry'), documentURL: startUrl, request: { url: startUrl } };
  const provenReturn = { ...entryRequest, loaderId: 'return', requestId: 'return', initiator: { type: 'script' } };
  const returned = await scenario([['Network.requestWillBeSent', provenReturn]], startUrl, [entryRequest]);
  assert.equal(returned.actions[1].navigationCause, 'observed', 'Explicit entry must not poison a proven return to the same URL');
  const unknownReturn = await scenario([['Network.requestWillBeSent', { ...provenReturn, initiator: { type: 'other' } }]], startUrl, [entryRequest]);
  assert.equal(unknownReturn.actions[1].navigationCause, 'unknown', 'Explicit entry cannot prove an unknown later return');
  const redirectedEntry = await scenario([['Network.requestWillBeSent', provenReturn]], startUrl,
    [{ ...entryRequest, redirectResponse: { status: 302 } }]);
  assert.equal(redirectedEntry.actions[1].navigationCounts?.documents, 2, 'A redirect cannot be consumed as the explicit entry request');
  const wrongFirst = await scenario([], startUrl, [request('wrong-first'), entryRequest]);
  assert.equal(wrongFirst.actions[1].navigationCause, 'unknown', 'A later matching request cannot claim the entry command');
  assert.equal(wrongFirst.actions[1].navigationCounts?.documents, 1, 'A later matching request cannot claim the entry command');

  for (const reverse of [false, true]) {
    const events: Array<[string, any]> = [['Network.requestWillBeSent', request('one')], ['Page.frameRequestedNavigation', reason]];
    const recording = await scenario(reverse ? events.reverse() : events);
    assert.equal(recording.actions[1].navigationCause, 'observed', 'Cause and request event order must not matter');
  }
  for (const reasonName of ['metaTagRefresh', 'httpHeaderRefresh']) {
    const refreshed = await scenario([['Network.requestWillBeSent', request('refresh')],
      ['Page.frameRequestedNavigation', { ...reason, reason: reasonName }]]);
    assert.equal(refreshed.actions[1].navigationCause, 'observed', 'Browser refresh cause must be retained');
  }
  const fragmentUrl = 'https://synthetic.invalid/finish#PRIVATE_FRAGMENT';
  for (const transport of ['request-fragment', 'document-url', 'commit']) {
    const payload = request('fragment', 'script') as any;
    if (transport === 'request-fragment') payload.request.urlFragment = '#PRIVATE_FRAGMENT';
    if (transport === 'document-url') payload.documentURL = fragmentUrl;
    const events: Array<[string, any]> = [['Network.requestWillBeSent', payload]];
    if (transport === 'commit') events.push(['Page.frameNavigated', { frame: { id: 'main', loaderId: 'fragment', url: fragmentUrl } }]);
    const parsed = await scenario(events, fragmentUrl);
    assert.equal(parsed.actions[1].navigationCause, 'observed', 'Fragment document URL must retain its request cause');
    assert.ok(parsed.actions[1].navigationId, 'Navigation identity must survive parsing');
  }
  const wrongLoader = await scenario([['Network.requestWillBeSent', request('one', 'script')],
    ['Page.frameNavigated', { frame: { id: 'main', loaderId: 'foreign', url: fragmentUrl } }]], fragmentUrl);
  assert.equal(wrongLoader.actions[1].navigationCause, 'unknown', 'A different loader cannot grant fragment causality');
  const history = ['Page.navigatedWithinDocument', { frameId: 'main', url: reason.url, navigationType: 'historyApi' }] as [string, any];
  const rewritten = await scenario([['Network.requestWillBeSent', request('login')],
    ['Page.frameRequestedNavigation', reason], history]);
  assert.equal(rewritten.actions[1].navigationCause, 'observed', 'History rewrite cannot obscure a proven document redirect');
  assert.deepEqual(rewritten.actions[1].navigationCounts, { documents: 1, history: 1, other: 0, unresolved: 0 });
  const noInitiator = await scenario([['Network.requestWillBeSent', request('login')], history]);
  assert.equal(noInitiator.actions[1].navigationCause, 'unknown', 'History rewrite alone cannot prove the document request');
  const foreign = await scenario([['Network.requestWillBeSent', request('foreign', 'script', 'child')],
    ['Page.frameRequestedNavigation', { ...reason, frameId: 'child' }]]);
  assert.equal(foreign.actions[1].navigationCause, 'unknown', 'Child frame cannot grant top-level navigation causality');
  const ambiguous = await scenario([['Network.requestWillBeSent', request('one', 'script')],
    ['Network.requestWillBeSent', request('two')]]);
  assert.equal(ambiguous.actions[1].navigationCause, 'unknown', 'Repeated URL cannot inherit another visit causality');
  assert.match(ambiguous.retainedSource, /@aura-navigation unknown id=nav-2/, 'Repeated URL cannot inherit another visit causality');
  const mapping = mapRecording(ambiguous);
  const description = describeMapping({ mapping, reason: 'navigation blocked', metrics: { pageObjectRequired: [] } } as any);
  assert.match(description, /NEEDS REVIEW\s+navigate event 1/, 'Navigation review must not be labeled ok');
  assert.ok((ambiguous.actions[1] as any).navigationReason, 'Unknown navigation keeps a safe reason');
  console.log('PASS event-order independence, frame isolation, repeated-destination refusal and review diagnostics');
}
