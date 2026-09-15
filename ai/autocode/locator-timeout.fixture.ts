import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import { resolveLocator } from '../../tests-e2e/support/resilient-locator';
import { bindLocator, installLocatorPolicy, LocatorDeadline, LOCATOR_TIMEOUT_MS, withLocatorOperation } from '../../tests-e2e/support/locator-policy';

async function main() {
  let now = 0;
  const clock = { now: () => now, wait: async (ms: number) => { now += ms; } };
  const locator: any = {
    count: async () => now >= 5000 ? 1 : 0,
    first: () => locator,
    waitFor: async ({ timeout }: { timeout: number }) => {
      now += Math.min(timeout, 5000 - now);
      if (now < 5000) throw Error('nothing attached');
    },
  };
  const result = await resolveLocator({ page: { url: () => 'https://fixture.invalid' } as any,
    logicalName: 'screen.delayedHeading', candidates: [{ strategy: 'declared heading', build: () => locator }], clock } as any);
  assert.equal(await result.count(), 1, 'a declared target appearing after the old four-second cutoff resolves');
  assert.equal(now, 5000, 'resolution continues as soon as the target appears');
  console.log('PASS declared target appears after five seconds');
  let checks = 1;
  async function check(name: string, body: () => Promise<void>) {
    try { await body(); checks++; console.log('PASS ' + name); }
    catch (error) { console.error('FAIL ' + name); throw error; }
  }
  function harness(appears: number[], finalCounts = appears.map(() => 1), readiness = 'complete', busy = 0) {
    let time = 0;
    const calls: Array<{ method: string; timeout: number }> = [];
    const clock = { now: () => time, wait: async (ms: number) => { time += ms; assert.ok(time <= 40000, 'one resolution cannot exceed the universal deadline'); } };
    const page: any = { url: () => 'https://fixture.invalid/screen?token=synthetic-secret',
      evaluate: async () => ({ documentState: readiness, declaredBusyCount: busy, declaredReady: readiness === 'complete' && busy === 0 }), setDefaultTimeout: (ms: number) => { page.defaultTimeout = ms; }, on: () => {},
      locator: () => locators[0], getByRole: () => locators[0], getByText: () => locators[0], getByLabel: () => locators[0], getByPlaceholder: () => locators[0],
      getByTestId: () => locators[0], getByTitle: () => locators[0], getByAltText: () => locators[0], frameLocator: () => locators[0] };
    const locators = appears.map((at, index) => {
      const item: any = { count: async () => time >= at ? finalCounts[index] : 0, page: () => page,
        toString: () => 'declared-' + index, first: () => { throw Error('must never narrow'); },
        click: async (options: any) => { calls.push({ method: 'click', timeout: options.timeout }); time += options.timeout; throw Error('Timeout exceeded'); },
        fill: async (_value: string, options: any) => { calls.push({ method: 'fill', timeout: options.timeout }); },
        locator: () => item };
      return item;
    });
    const resolve = () => resolveLocator({ page, clock, logicalName: 'screen.control', candidates: locators.map((item, index) => ({ strategy: 'candidate-' + index, build: () => item })) });
    return { clock, page, calls, locators, resolve, time: () => time, advance: (ms: number) => { time += ms; } };
  }
  await check('one centralized maximum is forty seconds', async () => assert.equal(LOCATOR_TIMEOUT_MS, 40_000));
  for (const delay of [0, 300, 5000, 7000, 31000, 35000]) await check('target available at ' + delay + 'ms continues immediately', async () => {
    const h = harness([delay]); const found = await h.resolve();
    assert.equal(await found.count(), 1); assert.equal(h.time(), delay);
  });
  await check('zero matches fail at one forty-second deadline after ready', async () => {
    const h = harness([Infinity]);
    await assert.rejects(h.resolve, (error: any) => error.locatorWait.classification === 'LOCATOR_NOT_FOUND_AFTER_READY'
      && error.locatorWait.configuredTimeoutMs === LOCATOR_TIMEOUT_MS && error.locatorWait.finalMatchCount === 0
      && !error.locatorWait.route.includes('token=') && error.locatorWait.elapsedMs === LOCATOR_TIMEOUT_MS);
    assert.equal(h.time(), LOCATOR_TIMEOUT_MS);
  });
  await check('three missing fallback candidates consume forty seconds not one hundred twenty', async () => {
    const h = harness([Infinity, Infinity, Infinity]);
    await assert.rejects(h.resolve); assert.equal(h.time(), LOCATOR_TIMEOUT_MS);
  });
  await check('fallback appears near thirty-five seconds within original deadline', async () => {
    const h = harness([Infinity, Infinity, 35000]);
    assert.equal(await (await h.resolve()).count(), 1); assert.equal(h.time(), 35000);
  });
  await check('declared order selects first eligible candidate and never changes ranking', async () => {
    const h = harness([0, 0]); assert.equal((await h.resolve()).toString(), 'declared-0');
  });
  await check('ambiguity never narrows the target', async () => {
    const h = harness([0, 0], [2, 3]); await assert.rejects(h.resolve, /LOCATOR_AMBIGUOUS/); assert.equal(h.time(), 0);
  });
  await check('ambiguity permits another declared unambiguous candidate', async () => {
    const h = harness([0, 0], [2, 1]); assert.equal((await h.resolve()).toString(), 'declared-1');
  });
  await check('visible declared busy state reports readiness timeout', async () => {
    const h = harness([Infinity], undefined, 'complete', 1);
    await assert.rejects(h.resolve, /PAGE_READINESS_TIMEOUT/);
  });
  await check('document still transitioning reports readiness timeout', async () => {
    const h = harness([Infinity], undefined, 'loading'); await assert.rejects(h.resolve, /PAGE_READINESS_TIMEOUT/);
  });
  await check('unknown readiness is not falsely reported as ready', async () => {
    const h = harness([Infinity]); h.page.evaluate = async () => { throw Error('detached'); };
    await assert.rejects(h.resolve, /LOCATOR_TIMEOUT_READINESS_UNKNOWN/);
  });
  await check('resolution and action share forty seconds rather than eighty', async () => {
    const h = harness([35000]); const found = await h.resolve(); await assert.rejects(() => found.click());
    assert.equal(h.calls[0].timeout, 5000); assert.equal(h.time(), LOCATOR_TIMEOUT_MS);
  });
  await check('authentication and user-confirmed recorded controls share the active step budget', async () => {
    const h = harness([0]); installLocatorPolicy(h.page);
    const deadline = new LocatorDeadline(h.clock);
    await withLocatorOperation(async () => {
      h.advance(35000); await h.page.getByRole('textbox').fill('synthetic-only');
      assert.equal(h.calls[0].timeout, 5000);
    }, deadline);
    assert.equal(h.page.defaultTimeout, LOCATOR_TIMEOUT_MS);
  });
  await check('explicit oversized and zero action timeouts cannot bypass global maximum', async () => {
    for (const timeout of [0, 120000]) {
      const h = harness([0]); const found = bindLocator(h.locators[0], new LocatorDeadline(h.clock));
      await assert.rejects(() => found.click({ timeout })); assert.equal(h.calls[0].timeout, LOCATOR_TIMEOUT_MS);
    }
  });
  await check('expired budget cannot become Playwright unlimited timeout', async () => {
    const h = harness([0]), deadline = new LocatorDeadline(h.clock); h.advance(LOCATOR_TIMEOUT_MS);
    await assert.rejects(() => bindLocator(h.locators[0], deadline).click(), /TIMEOUT/); assert.equal(h.calls.length, 0);
  });
  console.log(`PASS ${checks} locator deadline contracts`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
