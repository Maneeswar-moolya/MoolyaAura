/** One runtime UI budget. This is not a delay and does not authorize a different target. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { expect as playwrightExpect, type Locator, type Page } from '@playwright/test';
import { diagnosticData, diagnosticText } from '../../ai/diagnostics/artifacts';

export const LOCATOR_TIMEOUT_MS = 40_000;
const RECHECK_INTERVAL_MS = 100;
export interface LocatorClock { now(): number; wait(ms: number): Promise<void>; }
const realClock: LocatorClock = { now: () => performance.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)) };
export class LocatorDeadline {
  readonly started: number;
  constructor(readonly clock: LocatorClock = realClock) { this.started = clock.now(); }
  elapsed(): number { return this.clock.now() - this.started; }
  remaining(): number { return Math.max(0, LOCATOR_TIMEOUT_MS - this.elapsed()); }
  async recheck(): Promise<void> { await this.clock.wait(Math.min(RECHECK_INTERVAL_MS, this.remaining())); }
  /** count()/readiness have no Playwright timeout argument; bound these read-only probes too. */
  async observe<T>(read: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('UI_OPERATION_TIMEOUT: locator observation deadline exhausted.')), Math.max(1, this.remaining()));
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}
export interface ReadinessState {
  documentState: string;
  navigationPending: boolean;
  declaredBusyCount: number;
  declaredReady?: boolean;
  state: 'TRANSITIONING' | 'READY' | 'UNKNOWN';
  evidence: string[];
}
export interface LocatorWaitDetail {
  configuredTimeoutMs: number;
  elapsedMs: number;
  logicalName?: string;
  locator?: string;
  candidates?: Array<{ strategy: string; count: number | null }>;
  finalMatchCount?: number | null;
  route: string;
  readiness: ReadinessState;
  classification: string;
}
export class LocatorPolicyError extends Error {
  constructor(readonly locatorWait: LocatorWaitDetail, message: string) {
    super(`${locatorWait.classification}: ${message}`);
    this.name = 'LocatorPolicyError';
  }
}
interface Operation { deadline: LocatorDeadline; waits: LocatorWaitDetail[]; }
const operations = new AsyncLocalStorage<Operation>();
export function locatorDeadline(clock?: LocatorClock): LocatorDeadline { return operations.getStore()?.deadline ?? new LocatorDeadline(clock); }
export function operationWaits(): LocatorWaitDetail[] { return operations.getStore()?.waits ?? []; }
export async function withLocatorOperation<T>(body: () => Promise<T>, deadline = locatorDeadline(), waits: LocatorWaitDetail[] = []): Promise<T> {
  return operations.getStore() ? body() : operations.run({ deadline, waits }, body);
}
const navigation = new WeakMap<object, Set<unknown>>();
const installed = new WeakSet<object>();
const locatorBindings = new WeakMap<object, { raw: Locator; deadline?: LocatorDeadline }>();

/** Only explicit document/navigation/ARIA signals establish readiness; no application-name heuristic. */
export async function pageReadiness(page: Page): Promise<ReadinessState> {
  const navigationPending = (navigation.get(page)?.size ?? 0) > 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const state = await Promise.race([page.evaluate(() => ({ documentState: document.readyState,
      declaredReady: document.documentElement.getAttribute('aria-busy') === 'false' || document.body?.getAttribute('aria-busy') === 'false',
      declaredBusyCount: [...document.querySelectorAll('[aria-busy="true"]')].filter(node => {
        const style = getComputedStyle(node); return style.visibility !== 'hidden' && style.display !== 'none' && !!node.getClientRects().length;
      }).length })), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Readiness observation unavailable')), 1000); })]);
    const transitioning = navigationPending || state.documentState !== 'complete' || state.declaredBusyCount > 0;
    return { ...state, navigationPending, state: transitioning ? 'TRANSITIONING' : state.declaredReady ? 'READY' : 'UNKNOWN',
      evidence: [navigationPending ? 'main-frame navigation request pending' : 'no pending main-frame navigation request',
        `document.readyState=${state.documentState}`, `visible aria-busy=true: ${state.declaredBusyCount}`,
        state.declaredReady ? 'document root explicitly declares aria-busy=false' : 'application readiness not explicitly declared'] };
  } catch {
    return { documentState: 'unknown', navigationPending, declaredBusyCount: 0,
      state: navigationPending ? 'TRANSITIONING' : 'UNKNOWN', evidence: ['document observation unavailable'] };
  } finally { if (timer) clearTimeout(timer); }
}
export async function timeoutDetail(page: Page, deadline: LocatorDeadline, details: Partial<LocatorWaitDetail> = {}): Promise<LocatorWaitDetail> {
  const readiness = await pageReadiness(page);
  const classification = details.finalMatchCount !== undefined && details.finalMatchCount !== null && details.finalMatchCount > 1 ? 'LOCATOR_AMBIGUOUS'
    : readiness.state === 'TRANSITIONING' ? 'PAGE_READINESS_TIMEOUT'
    : details.finalMatchCount === 0 && readiness.state === 'READY' ? 'LOCATOR_NOT_FOUND_AFTER_READY'
      : details.finalMatchCount === 0 ? 'LOCATOR_TIMEOUT_READINESS_UNKNOWN' : 'UI_OPERATION_TIMEOUT';
  return diagnosticData({ ...details, configuredTimeoutMs: LOCATOR_TIMEOUT_MS, elapsedMs: Math.round(deadline.elapsed()),
    route: diagnosticText(page.url()), readiness, classification });
}
export function recordLocatorWait(detail: LocatorWaitDetail): void { operations.getStore()?.waits.push(detail); }
function actionTimeout(deadline: LocatorDeadline, requested?: number): number {
  const remaining = deadline.remaining();
  // Playwright interprets 0 as unlimited. Never send zero after a spent deadline.
  if (remaining <= 0) throw Error('UI_OPERATION_TIMEOUT: shared locator deadline exhausted.');
  return Math.max(1, Math.ceil(Math.min(remaining, requested && requested > 0 ? requested : LOCATOR_TIMEOUT_MS)));
}
const actionOptions: Record<string, number> = {
  click: 0, dblclick: 0, tap: 0, hover: 0, check: 0, uncheck: 0, clear: 0, focus: 0, blur: 0,
  fill: 1, press: 1, pressSequentially: 1, type: 1, selectOption: 1, setChecked: 1, setInputFiles: 1,
  dragTo: 1, waitFor: 0, scrollIntoViewIfNeeded: 0, innerText: 0, textContent: 0,
  inputValue: 0, getAttribute: 1, isChecked: 0, isEnabled: 0, isDisabled: 0, isEditable: 0,
  evaluate: 2, evaluateHandle: 2, boundingBox: 0, screenshot: 0,
};
const factories = ['locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTestId', 'getByTitle', 'getByAltText', 'frameLocator'];
const chains = new Set([...factories, 'filter', 'and', 'or', 'first', 'last', 'nth', 'contentFrame', 'owner']);
function isLocator(value: any): value is Locator { return value && typeof value.count === 'function' && typeof value.page === 'function'; }
export function bindLocator(locator: Locator, deadline?: LocatorDeadline): Locator {
  const existing = locatorBindings.get(locator);
  const raw = existing?.raw ?? locator;
  const inherited = deadline ?? existing?.deadline;
  const proxy = new Proxy(raw, { get(target, property) {
    const member = Reflect.get(target, property, target);
    if (typeof member !== 'function') return member;
    if (typeof property === 'string' && Object.hasOwn(actionOptions, property)) return async (...args: any[]) => {
      const budget = operations.getStore()?.deadline ?? inherited ?? new LocatorDeadline();
      const at = actionOptions[property];
      try {
        args[at] = { ...args[at], timeout: actionTimeout(budget, args[at]?.timeout) };
        return await member.apply(target, args);
      } catch (error) {
        if (!/timeout|deadline/i.test(String(error))) throw error;
        const count = await target.count().catch(() => null);
        const detail = await timeoutDetail(target.page(), budget, { locator: target.toString(), finalMatchCount: count });
        recordLocatorWait(detail);
        throw new LocatorPolicyError(detail, diagnosticText((error as Error).message));
      }
    };
    if (typeof property === 'string' && chains.has(property)) return (...args: any[]) => wrapFactory(member.apply(target, args), inherited);
    if (property === 'all') return async () => (await target.all()).map(item => bindLocator(item, inherited));
    return member.bind(target);
  } });
  locatorBindings.set(proxy, { raw, deadline: inherited });
  return proxy;
}
function wrapFactory(value: any, deadline?: LocatorDeadline): any {
  if (isLocator(value)) return bindLocator(value, deadline);
  // FrameLocator: wrap only its public locator-building methods.
  if (value && typeof value.getByRole === 'function') return new Proxy(value, { get(target, key) {
    const member = Reflect.get(target, key, target);
    if (typeof member !== 'function') return member;
    return typeof key === 'string' && chains.has(key) ? (...args: any[]) => wrapFactory(member.apply(target, args), deadline) : member.bind(target);
  } });
  return value;
}
export function installLocatorPolicy(page: Page): void {
  if (installed.has(page)) return;
  installed.add(page);
  page.setDefaultTimeout(LOCATOR_TIMEOUT_MS);
  const pending = new Set<unknown>(); navigation.set(page, pending);
  page.on('request', request => {
    try { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) pending.add(request); }
    catch { /* Some requests precede an observable frame. Unknown cannot claim readiness. */ }
  });
  page.on('requestfinished', request => pending.delete(request));
  page.on('requestfailed', request => pending.delete(request));
  for (const name of factories) {
    const factory = (page as any)[name].bind(page);
    (page as any)[name] = (...args: any[]) => wrapFactory(factory(...args));
  }
  // Legacy selector-based Page actions use the same operation budget. Preserve
  // their Playwright behavior; this adapter changes only their timeout argument.
  for (const name of Object.keys(actionOptions)) {
    if (['evaluate', 'evaluateHandle', 'screenshot', 'waitFor'].includes(name) || typeof (page as any)[name] !== 'function') continue;
    const action = (page as any)[name].bind(page);
    (page as any)[name] = (...args: any[]) => {
      const at = actionOptions[name] + 1;
      args[at] = { ...args[at], timeout: actionTimeout(locatorDeadline(), args[at]?.timeout) };
      return action(...args);
    };
  }
}

const assertionOptions: Record<string, number> = {
  toBeAttached: 0, toBeChecked: 0, toBeDisabled: 0, toBeEditable: 0, toBeEmpty: 0, toBeEnabled: 0,
  toBeFocused: 0, toBeHidden: 0, toBeInViewport: 0, toBeVisible: 0,
  toContainText: 1, toHaveAccessibleDescription: 1, toHaveAccessibleErrorMessage: 1, toHaveAccessibleName: 1,
  toHaveAttribute: 2, toHaveClass: 1, toContainClass: 1, toHaveCount: 1, toHaveCSS: 2, toHaveId: 1,
  toHaveJSProperty: 2, toHaveRole: 1, toHaveText: 1, toHaveValue: 1, toHaveValues: 1,
  toHaveTitle: 1, toHaveURL: 1, toMatchAriaSnapshot: 1, toHaveScreenshot: 1,
};
/** Public expect API, including .not/.soft/.configure; no private Playwright patching. */
function policyExpect(base: typeof playwrightExpect): typeof playwrightExpect {
  return new Proxy(base, {
    apply(target, thisArg, args: any[]) {
      const actual = args[0];
      const binding = actual && locatorBindings.get(actual);
      const budget = operations.getStore()?.deadline ?? binding?.deadline ?? new LocatorDeadline();
      const matchers = Reflect.apply(target.configure({ timeout: Math.max(1, budget.remaining()) }), thisArg, args);
      if (!isLocator(actual) && !(actual && typeof actual.goto === 'function')) return matchers;
      const wrap = (object: any): any => new Proxy(object, { get(match, key) {
        const member = Reflect.get(match, key);
        if (key === 'not' || key === 'resolves' || key === 'rejects') return wrap(member);
        if (typeof member !== 'function' || typeof key !== 'string' || !Object.hasOwn(assertionOptions, key)) return member;
        return async (...values: any[]) => {
          let at = assertionOptions[key];
          if (key === 'toHaveScreenshot' && (values.length === 0 || typeof values[0] === 'object' && !Array.isArray(values[0]))) at = 0;
          if (key === 'toHaveAttribute' && (values.length === 1 || typeof values[1] === 'object' && !(values[1] instanceof RegExp))) at = 1;
          try {
            values[at] = { ...values[at], timeout: actionTimeout(budget, values[at]?.timeout) };
            return await member.apply(match, values);
          } catch (error) {
            const page = isLocator(actual) ? actual.page() : actual;
            const count = isLocator(actual) ? await actual.count().catch(() => null) : undefined;
            const detail = await timeoutDetail(page, budget, { locator: isLocator(actual) ? actual.toString() : 'page', finalMatchCount: count });
            recordLocatorWait(detail);
            if (budget.remaining() <= 0 || /timeout/i.test(String(error))) throw new LocatorPolicyError(detail, diagnosticText((error as Error).message));
            throw error;
          }
        };
      } });
      return wrap(matchers);
    },
    get(target, key) {
      if (key === 'configure') return (...args: any[]) => policyExpect((target.configure as any)(...args));
      if (key === 'soft') return policyExpect(target.configure({ soft: true }));
      return Reflect.get(target, key);
    },
  });
}
export const expect = policyExpect(playwrightExpect);
