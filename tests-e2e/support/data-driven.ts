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
import { normaliseWorkbook, workbookOwner } from '../../ai/projects/registry';
import { activeScope } from '../../ai/projects/scope';
import { credentials, credentialSource, INVALID_PASSWORD, registeredEmail } from './env';

const ROOT = process.cwd();

export interface SuiteWorkbook {
  /** Absolute path, or null when this application declares no workbook. */
  workbook: string | null;
  applicationId: string | null;
  /** Why, in one sentence - printed by globalSetup so a zero-row run explains itself. */
  reason: string;
}

/**
 * WHICH WORKBOOK THE SUITE IS RUNNING AGAINST.
 *
 * THE DEFECT THIS REPLACES. This used to be
 * `process.env.EXCEL_WORKBOOK ?? 'excel/login-test-cases.xlsx'` - a hardcoded FILENAME
 * as the fallback. `tests-e2e/generic/generic.spec.ts` is the shared wildcard runner and
 * is collected for every application, and it builds its tests from this cache at import
 * time, so with `AURA_APPLICATION=demoapp` and no `EXCEL_WORKBOOK` Playwright collected
 * TWO OF BUGASURA'S data-driven rows (TC_LOGIN_017, TC_LOGIN_018) under demoapp's scope.
 * Measured, not theorised. Two independent selectors - the application and the workbook -
 * could disagree, and the disagreement resolved in favour of whichever project's name
 * happened to be written in this file.
 *
 * THE RULE NOW: active application -> registry-declared workbook -> runner. The registry
 * is the only authority; nothing here reads a basename, a URL, a hostname, a page title,
 * a documentId or a test-case id.
 *
 *   EXCEL_WORKBOOK set    -> use it, AFTER checking the registry agrees it belongs to the
 *                            active application. A mismatch is REFUSED, never corrected:
 *                            `AURA_APPLICATION=demoapp EXCEL_WORKBOOK=<bugasura's>` is a
 *                            contradiction, and picking either half would be a guess.
 *   EXCEL_WORKBOOK unset  -> the workbook this application DECLARES.
 *   no declared workbook  -> null. Fail closed: no cache, no rows, and never anybody
 *                            else's. Deliberately not a throw - the suite also holds
 *                            hand-written specs that owe nothing to data-driven rows, and
 *                            taking them down would be a worse answer than running none.
 *   several declared      -> REFUSED, naming them. Ambiguity is refused everywhere else
 *                            here (`resolveScope` does exactly this for applications);
 *                            silently taking the first is how a second workbook would
 *                            start running instead of the one somebody meant.
 *
 * WHY `activeScope()` AND NOT `resolveScope({})`. This runs at Playwright COLLECTION,
 * where the only channel is the environment. `activeScope()` reads `AURA_APPLICATION` and
 * otherwise resolves the DECLARED owner of the unscoped layout - a registry decision, not
 * a string in a source file. That distinction is the whole point: a bare `npm run
 * excel:test` still runs the legacy application's rows, but because the registry says it
 * owns them, and the day that flag is dropped this refuses instead of guessing.
 */
export function resolveSuiteWorkbook(): SuiteWorkbook {
  const explicit = process.env.EXCEL_WORKBOOK?.trim();

  let scope;
  try {
    scope = activeScope();
  } catch (error) {
    // No application can be resolved at all - two registered, none selected, none
    // declaring the legacy layout. There is no honest answer, so there are no rows.
    if (explicit) {
      throw new Error(`EXCEL_WORKBOOK is set to "${explicit}" but no application is selected. `
        + `Set AURA_APPLICATION. (${(error as Error).message})`);
    }
    return { workbook: null, applicationId: null, reason: (error as Error).message };
  }

  if (explicit) {
    // OWNERSHIP IS CHECKED, NOT ASSUMED. `workbookOwner` reads the registry's declaration.
    const owner = workbookOwner(explicit);
    if (owner !== scope.applicationId) {
      throw new Error(`EXCEL_WORKBOOK is "${explicit}", which application "${owner}" owns, `
        + `but the active application is "${scope.applicationId}". A workbook belongs to `
        + 'exactly one application and is never run under a different one\'s scope.');
    }
    return {
      workbook: path.resolve(ROOT, explicit),
      applicationId: scope.applicationId,
      reason: `EXCEL_WORKBOOK, owned by "${owner}"`,
    };
  }

  const declared = declaredWorkbooksFor(scope.applicationId);
  if (!declared.length) {
    return {
      workbook: null,
      applicationId: scope.applicationId,
      reason: `application "${scope.applicationId}" declares no workbook`,
    };
  }
  if (declared.length > 1) {
    throw new Error(`Application "${scope.applicationId}" declares ${declared.length} workbooks `
      + `(${declared.join(', ')}). Set EXCEL_WORKBOOK to say which one this run is about - `
      + 'one is never chosen for you.');
  }
  return {
    workbook: path.resolve(ROOT, declared[0]),
    applicationId: scope.applicationId,
    reason: `declared by "${scope.applicationId}"`,
  };
}

/** The workbooks the registry declares for one application, repo-relative. */
function declaredWorkbooksFor(applicationId: string): string[] {
  // Imported lazily-by-value rather than pulling `readRegistry` in at the top: the
  // registry is already read by `activeScope()` above, and this keeps the one import
  // surface (`registry`) that this module needs.
  const { readRegistry } = require('../../ai/projects/registry') as
    typeof import('../../ai/projects/registry');
  const application = readRegistry().applications
      .find(entry => entry.applicationId === applicationId);
  return (application?.workbooks ?? []).map(workbook => normaliseWorkbook(workbook));
}

/** Resolved once at import, which is when Playwright reads it. */
export const SUITE_WORKBOOK: SuiteWorkbook = resolveSuiteWorkbook();

/**
 * The workbook path, or null when this application has none.
 *
 * Kept as the name `global-setup.ts` already imports; it is nullable now because "this
 * application declares no workbook" is a real answer and used to be impossible to say.
 */
export const WORKBOOK_PATH: string | null = SUITE_WORKBOOK.workbook;

export function loadDataDriven(): DataDrivenCache | null {
  return WORKBOOK_PATH ? readCache(WORKBOOK_PATH) : null;
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
 * Missing credentials are collected rather than thrown: a row that needs a password
 * should *skip* with a reason when the secret is absent, the same way the hand-written
 * specs do. A red run that only means "no secrets" is noise.
 *
 * THE REPORTED NAMES COME FROM THE APPLICATION, not from a constant. The resolution
 * already did - `registeredEmail()` and `credentials()` read the variables the registry
 * declares - but the DIAGNOSTIC still said BUGASURA_EMAIL / BUGASURA_PASSWORD, so a
 * second project skipped pointing at a variable that has nothing to do with it.
 */
export function resolveInputs(inputs: Record<string, Token>): Resolved {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  // Names only, never values. Null means this application declares no credentials at
  // all, which is a different thing to say than "a variable is unset".
  const source = credentialSource();
  const emailVariable = source?.email ?? '(no credentials declared for this application)';
  const passwordVariable = source?.password ?? '(no credentials declared for this application)';

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
          missing.push(emailVariable);
        break;
      }
      case 'validPassword': {
        const creds = credentials();
        if (creds)
          values[name] = creds.password;
        else
          missing.push(passwordVariable);
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
