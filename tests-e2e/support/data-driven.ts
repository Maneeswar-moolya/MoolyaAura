/**
 * Test-side half of the data-driven contract.
 *
 * `ai/excel/data-driven.ts` parses the workbook into tokens; this resolves
 * those tokens into the strings a browser actually receives. The split exists
 * so that secrets stay out of the cache file: the workbook says
 * `<valid-password>`, the cache stores `{ kind: 'validPassword' }`, and the
 * real password is read from the environment here, at run time.
 */

import path from 'node:path';

import { readCache, type DataDrivenCache, type Token } from '../../ai/excel/data-driven';
import { credentials, INVALID_PASSWORD, registeredEmail } from './env';

/**
 * The workbook the suite is running against.
 *
 * `excel:run` sets EXCEL_WORKBOOK when it spawns Playwright, so the cache
 * always matches the workbook being executed. A bare `excel:test` falls back to
 * the default.
 */
export const WORKBOOK_PATH = path.resolve(
    process.cwd(),
    process.env.EXCEL_WORKBOOK ?? 'excel/login-test-cases.xlsx',
);

export function loadDataDriven(): DataDrivenCache | null {
  return readCache(WORKBOOK_PATH);
}

/** An address of exactly `length` characters that is still shaped like an email. */
function emailOfLength(length: number): string {
  const domain = '@example.com';
  return `${'a'.repeat(length - domain.length)}${domain}`;
}

export interface Resolved {
  values: Record<string, string>;
  /** Environment variables the row needed but did not get. Non-empty means skip. */
  missing: string[];
}

/**
 * Resolve every token for a row.
 *
 * Missing credentials are collected rather than thrown: a row that needs
 * BUGASURA_PASSWORD should *skip* with a reason when the secret is absent, the
 * same way the hand-written specs do. A red run that only means "no secrets" is
 * noise.
 */
export function resolveInputs(inputs: Record<string, Token>): Resolved {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const [name, token] of Object.entries(inputs)) {
    switch (token.kind) {
      case 'literal':
        values[name] = token.value;
        break;
      case 'blank':
        values[name] = '';
        break;
      case 'registeredEmail': {
        const email = registeredEmail();
        if (email)
          values[name] = email;
        else
          missing.push('BUGASURA_EMAIL');
        break;
      }
      case 'validPassword': {
        const creds = credentials();
        if (creds)
          values[name] = creds.password;
        else
          missing.push('BUGASURA_PASSWORD');
        break;
      }
      case 'invalidPassword':
        values[name] = INVALID_PASSWORD;
        break;
      case 'emailOfLength':
        values[name] = emailOfLength(token.length);
        break;
      case 'charsOfLength':
        values[name] = 'a'.repeat(token.length);
        break;
    }
  }

  return { values, missing };
}

/** True when the observed text satisfies the row's declared matcher. */
export function messageMatches(
  matcher: { kind: 'contains'; text: string } | { kind: 'regex'; source: string; flags: string } | null,
  observed: string,
): boolean {
  if (!matcher)
    return observed.trim().length > 0;
  if (matcher.kind === 'regex')
    return new RegExp(matcher.source, matcher.flags).test(observed);
  return observed.toLowerCase().includes(matcher.text.toLowerCase());
}

/** Human-readable form of a matcher, for the failure message. */
export function describeMatcher(
  matcher: { kind: 'contains'; text: string } | { kind: 'regex'; source: string; flags: string } | null,
): string {
  if (!matcher)
    return 'any non-empty message';
  return matcher.kind === 'regex' ? `/${matcher.source}/${matcher.flags}` : `text containing "${matcher.text}"`;
}
