/**
 * Driving a form from nothing but the workbook row.
 *
 * The per-module runners (login-validation.spec.ts) hard-code three things: the
 * page to open, the fields to fill and the button to press. Every one of those
 * can come from the row instead, which is what removes the need for a new spec
 * per module:
 *
 *     url    = /                       where to start (default: BASE_URL)
 *     scope  = #loginForm              confine lookups to one form (optional)
 *     submit = Sign In                 the control to press (optional)
 *     email  = <registered-email>      anything else is a field to fill
 *     password = <blank>
 *
 * Fields are found by their **human name**, through the same ordered-candidate
 * approach the Page Objects use: accessible role first, then label, placeholder,
 * and finally attribute matching. That is what lets one runner serve a module
 * nobody has written code for.
 *
 * The honest limit: this works when a control can be identified by the name a
 * person would call it. An element with no accessible name, no label, and an
 * opaque id is not findable generically, and that case needs a Page Object. The
 * failure says so rather than timing out mysteriously.
 */

import type { Locator, Page } from '@playwright/test';
import { expect, locatorDeadline, LOCATOR_TIMEOUT_MS } from './locator-policy';
import { resolveLocator } from './resilient-locator';

/** Input names that configure the run rather than naming a field to fill. */
export const RESERVED_INPUTS = new Set(['url', 'scope', 'submit', 'expect']);

/**
 * Assert that every named item is on the page.
 *
 * Names are matched the way a person reads a screen: a link or button with that
 * accessible name, or failing that any visible element containing the text. All
 * items are checked before failing, so one run tells you every menu that is
 * missing rather than only the first.
 */
export async function assertAllVisible(
  page: Page,
  names: string[],
  settleMs = LOCATOR_TIMEOUT_MS,
  perItemMs = LOCATOR_TIMEOUT_MS,
): Promise<string[]> {
  const missing: string[] = [];

  const look = async (name: string, budgetMs: number): Promise<boolean> => {
    const pattern = asPattern(name);
    const candidates = [
      page.getByRole('link', { name: pattern }),
      page.getByRole('button', { name: pattern }),
      page.getByRole('menuitem', { name: pattern }),
      page.getByText(pattern),
    ];
    // Inside a recorded step, every item shares that step's deadline. Each
    // item is still inspected once, even if an earlier missing item spent it.
    // Outside a step, one item gets one bounded locator operation.
    const budget = locatorDeadline();
    const deadline = budget.clock.now() + Math.min(budgetMs, budget.remaining());
    do {
      for (const candidate of candidates) {
        if (await candidate.locator('visible=true').count().catch(() => 0) >= 1)
          return true;
      }
      await budget.recheck();
    } while (budget.clock.now() < deadline && budget.remaining() > 0);
    return false;
  };

  for (const [index, name] of names.entries()) {
    // Explicitly shorter observation windows remain bounded by the active UI step.
    const found = await look(name, index === 0 ? settleMs : perItemMs);
    if (!found)
      missing.push(name);
  }
  return missing;
}

/** Split an `expect = a, b, c` value into the individual items. */
export function expectedItems(raw: string): string[] {
  return raw.split(/[,;|\n]+/).map(item => item.trim()).filter(Boolean);
}

/** Escape a field name for use inside a RegExp. */
function asPattern(name: string): RegExp {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[_-]+/g, '[ _-]*'), 'i');
}

/** The area to search: a scoping selector when given, otherwise the whole page. */
export function container(page: Page, scope: string | undefined) {
  return scope ? page.locator(scope) : page.locator('body');
}

/**
 * Find the control called `name`, trying the strategies a person would.
 *
 * Returns the first candidate that resolves to exactly one visible element, so
 * a page with both a real field and a hidden duplicate (Bugasura mounts three
 * forms at once) does not silently get the wrong one.
 */
export async function resolveField(page: Page, scope: string | undefined, name: string): Promise<Locator> {
  const root = container(page, scope);
  const pattern = asPattern(name);
  const attribute = `[name*="${name}" i], [id*="${name}" i], [aria-label*="${name}" i]`;

  const candidates: Array<{ strategy: string; locator: Locator }> = [
    { strategy: `getByRole('textbox', { name: /${name}/i })`, locator: root.getByRole('textbox', { name: pattern }) },
    { strategy: `getByLabel(/${name}/i)`, locator: root.getByLabel(pattern) },
    { strategy: `getByPlaceholder(/${name}/i)`, locator: root.getByPlaceholder(pattern) },
    { strategy: `input${attribute}`, locator: root.locator(`input${attribute}, textarea${attribute}, select${attribute}`) },
  ];

  // Two names carry their own input type, and the type is a stronger signal
  // than any name match.
  if (/password/i.test(name))
    candidates.unshift({ strategy: 'input[type=password]', locator: root.locator('input[type="password"]') });
  if (/e-?mail/i.test(name))
    candidates.push({ strategy: 'input[type=email]', locator: root.locator('input[type="email"]') });

  return resolveLocator({ page, logicalName: `form.field:${name}`,
    candidates: candidates.map(candidate => ({ strategy: candidate.strategy, build: () => candidate.locator.locator('visible=true') })) });
}

/**
 * The control that submits the form.
 *
 * `within` is the form the fields were actually found in. Searching the whole
 * page instead is how a generic runner ends up pressing "Sign in with Google":
 * Bugasura mounts sign-in, sign-up and reset together, and a page-wide button
 * search has no way to know which one the fields belonged to.
 */
export async function resolveSubmit(
  page: Page,
  scope: string | undefined,
  name: string | undefined,
  within?: Locator,
): Promise<Locator> {
  const roots: Locator[] = [];
  if (within)
    roots.push(within);
  roots.push(container(page, scope));

  const candidates: Locator[] = [];
  for (const root of roots) {
    if (name) candidates.push(root.getByRole('button', { name: asPattern(name) }));
    candidates.push(root.locator('button[type="submit"], input[type="submit"]'));
    if (!name) candidates.push(root.getByRole('button'));
  }
  return resolveLocator({ page, logicalName: 'form.submit', candidates: candidates.map(candidate => ({
    strategy: candidate.toString(), build: () => candidate.locator('visible=true'),
  })) });
}

/**
 * Any message the application produced, or '' within the timeout.
 *
 * INTENTIONALLY POSITIONAL. "Any message" is the contract - an application may
 * stack several toasts and this reports the first one shown. Nothing is clicked
 * and no element is identified for a test to act on, so `first()` here is a
 * collection operation rather than ambiguity being hidden.
 */
export async function observedMessage(page: Page, timeoutMs = LOCATOR_TIMEOUT_MS): Promise<string> {
  const message = page.locator(
      '#toast-container .toast-message, .toast-message, [role="alert"], .error-message, .error')
      .locator('visible=true')
      .first();
  try {
    await message.waitFor({ state: 'visible', timeout: timeoutMs });
    return (await message.textContent())?.trim() ?? '';
  } catch {
    return '';
  }
}

/** Whether the form is showing that it refused the input, without a message. */
export async function hasValidationSignal(page: Page, scope: string | undefined): Promise<boolean> {
  return page.evaluate(selector => {
    const root = (selector ? document.querySelector(selector) : null) ?? document;
    const inputs = Array.from(root.querySelectorAll('input, textarea, select')) as HTMLInputElement[];
    const nativeInvalid = inputs.some(i => i.offsetParent !== null && typeof i.checkValidity === 'function' && !i.checkValidity());
    const ariaInvalid = inputs.some(i => i.getAttribute('aria-invalid') === 'true');
    const visibleError = Array.from(root.querySelectorAll('[class*="error"], [role="alert"]'))
        .some(node => (node as HTMLElement).offsetParent !== null && (node.textContent ?? '').trim().length > 0);
    return nativeInvalid || ariaInvalid || visibleError;
  }, scope ?? null);
}

export interface FormRun {
  /** URL before the submission, for deciding whether anything moved on. */
  urlBefore: string;
  scope?: string;
}

/**
 * Fill the named fields and submit.
 *
 * Values are already resolved (tokens turned into strings) by the caller, so
 * this module never touches credentials.
 */
export async function submitForm(
  page: Page,
  values: Record<string, string>,
  options: { url?: string; scope?: string; submit?: string; baseUrl: string },
): Promise<FormRun> {
  const target = options.url ? new URL(options.url, options.baseUrl).toString() : options.baseUrl;
  await page.goto(target, { waitUntil: 'domcontentloaded' });

  if (options.scope) {
    // A PRESENCE PROBE, not an identity. It asks whether the scope the row named
    // exists at all; `first()` is how that question is asked of a selector that
    // may legitimately match a repeated container. Anything ambiguous INSIDE the
    // scope is caught where it matters - the field and submit resolvers above
    // both require exactly one.
    await expect(page.locator(options.scope).first(),
        `The row says scope = ${options.scope}, but nothing on ${target} matches it`)
        .toBeAttached();
  }

  // The form the fields actually live in becomes the search area for the submit
  // control, so a page hosting several forms cannot have the wrong one pressed.
  let owningForm: Locator | undefined;

  for (const [name, value] of Object.entries(values)) {
    if (RESERVED_INPUTS.has(name))
      continue;
    const field = await resolveField(page, options.scope, name);
    await field.fill(value);
    if (!owningForm) {
      const ancestor = field.locator('xpath=ancestor::form[1]');
      if (await ancestor.count().catch(() => 0) === 1)
        owningForm = ancestor;
    }
  }

  const urlBefore = page.url();
  await (await resolveSubmit(page, options.scope, options.submit, owningForm)).click();
  return { urlBefore, scope: options.scope };
}

/** True when the submission was accepted: no message, and the page moved on. */
export async function wasAccepted(page: Page, run: FormRun): Promise<boolean> {
  const deadline = locatorDeadline();
  do {
    if (page.url() !== run.urlBefore)
      return true;
    // The form disappearing counts too - plenty of apps swap it in place.
    if (run.scope && await page.locator(run.scope).locator('visible=true').count() === 0)
      return true;
    if (await observedMessage(page, 250))
      return false;
    await deadline.recheck();
  } while (deadline.remaining() > 0);
  return false;
}
