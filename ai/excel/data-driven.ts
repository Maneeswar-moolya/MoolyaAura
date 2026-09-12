/**
 * Data-driven test cases: rows that execute without anyone writing code.
 *
 * Most test cases need a human (or an agent) to read the intent and write a
 * spec. A *family* of cases does not: rows that differ only in their input and
 * their expected outcome. Login validation is the canonical example - fill two
 * fields, submit, check what came back - repeated with different data.
 *
 * For those, the workbook can carry the contract itself:
 *
 *   | Test Data                        | Assert Outcome | Assert Message              |
 *   | email = <blank>                  | Blocked        |                             |
 *   | password = <invalid-password>    |                |                             |
 *
 * A row that declares `Assert Outcome` becomes a running test with no code
 * written for it. Add a row, get a test.
 *
 * Two deliberate limits:
 *
 *   - This never *infers* the contract from prose. "verify it works correctly"
 *     stays un-runnable, because guessing the assertion would produce green
 *     coverage that proves nothing. A blank Assert Outcome means "not
 *     data-driven" and the row is left for a hand-written spec.
 *   - A non-blank but unparseable contract is an error, never a skip. Silently
 *     dropping a row the author believed was running is the worst outcome
 *     available.
 *
 * The Steps column stays authoritative for humans, but it does NOT drive
 * execution here - the runner spec owns the actions. Keep the two in agreement.
 */

import fs from 'node:fs';
import path from 'node:path';

import { contractGap } from './intent';
import type { ParseResult, TestCase } from './types';

export const DATA_DIR = path.resolve(process.cwd(), 'ai', 'test-data');

/**
 * `excel/login-test-cases.xlsx` -> `ai/test-data/excel-login-test-cases.data-driven.json`
 *
 * DERIVED FROM THE WHOLE REPO-RELATIVE PATH, not the basename.
 *
 * The basename is not unique. A workbook belongs to exactly one application - the
 * registry enforces that, and `validateRegistry` refuses a workbook two applications
 * both claim - but nothing stops TWO applications owning two DIFFERENT workbooks that
 * happen to share a file name: `excel/bugasura/cases.xlsx` and
 * `excel/flipkart/cases.xlsx` both reduced to `cases`, and the second run's cache
 * silently overwrote the first's. The rows are what the data-driven runner executes,
 * so that is one application's cases running under another application's name.
 *
 * A path is unique by construction, and one path means one workbook means one
 * application, so uniqueness of the path gives uniqueness of the application without
 * this module needing to read the registry - which matters because `globalSetup` calls
 * it inside the Playwright runtime, where pulling in the project registry would be a
 * new dependency for a name.
 *
 * The directory is git-ignored and rebuilt by `globalSetup` before every run, so
 * renaming costs nothing: there is no stale file to migrate and no reader that spells
 * the old name - every caller goes through this function.
 */
export function cachePathFor(workbookPath: string): string {
  const relative = path.relative(process.cwd(), path.resolve(process.cwd(), workbookPath));
  const stem = relative.slice(0, relative.length - path.extname(relative).length);
  const safe = stem.split(/[\/]+/).filter(Boolean).join('-').replace(/[^A-Za-z0-9._-]+/g, '-');
  return path.join(DATA_DIR, `${safe}.data-driven.json`);
}

/** What the runner should assert once the actions have been performed. */
export type Outcome =
  /** The sign-in succeeded and the application moved on. */
  | 'Signed In'
  /** The application rejected it and said so (a toast, a banner). */
  | 'Error'
  /** The submission never left the page and no message was produced - client-side validation. */
  | 'Blocked'
  /**
   * The page moved on AND every item named in `expect` is visible.
   *
   * "Signed In" only proves the door opened. A case about what should be on the
   * far side of it needs to say what, or it passes without checking anything.
   */
  | 'Visible';

const OUTCOMES: Record<string, Outcome> = {
  'signed in': 'Signed In',
  'signedin': 'Signed In',
  'success': 'Signed In',
  'logged in': 'Signed In',
  'pass': 'Signed In',
  'error': 'Error',
  'rejected': 'Error',
  'failure': 'Error',
  'toast': 'Error',
  'blocked': 'Blocked',
  'validation': 'Blocked',
  'no submit': 'Blocked',
  'visible': 'Visible',
  'displayed': 'Visible',
  'present': 'Visible',
  'shown': 'Visible',
};

/**
 * A field value, resolved at run time rather than stored in the spreadsheet.
 *
 * Credentials must never be typed into a workbook, and a "250-character email"
 * is not something anyone should paste into a cell. Both are named instead.
 */
/** The declared outcome as an `Outcome`, or null when it is not one we know. */
export function normalizeOutcome(declared: string): Outcome | null {
  return OUTCOMES[declared.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

/**
 * The literal text a token carries, or undefined for every other kind.
 *
 * `Token` is a discriminated union and only `literal` has a `value`; the call sites
 * were reading `.value` off the union, which happened to give `undefined` for the
 * other kinds at run time and was a type error the whole time. This states the same
 * answer in a way the compiler can check, so a token kind added later cannot silently
 * start reading as a submit control.
 */
export function literalValueOf(token: Token | undefined): string | undefined {
  return token?.kind === 'literal' ? token.value : undefined;
}

export type Token =
  | { kind: 'literal'; value: string }
  | { kind: 'blank' }
  | { kind: 'registeredEmail' }
  | { kind: 'validPassword' }
  | { kind: 'invalidPassword' }
  /** A well-formed email address of exactly `length` characters. */
  | { kind: 'emailOfLength'; length: number }
  /** `length` repetitions of a single character. */
  | { kind: 'charsOfLength'; length: number };

/** The vocabulary, documented in one place because the error message quotes it. */
export const TOKEN_HELP = [
  '<blank>',
  '<registered-email>',
  '<valid-password>',
  '<invalid-password>',
  '<email:N>       e.g. <email:250>',
  '<chars:N>       e.g. <chars:300>',
].join(', ');

export function parseToken(raw: string): Token | { error: string } {
  const value = raw.trim();
  if (!value.startsWith('<'))
    return { kind: 'literal', value };

  const inner = value.replace(/^<|>$/g, '').trim().toLowerCase();
  if (inner === 'blank' || inner === 'empty')
    return { kind: 'blank' };
  if (inner === 'registered-email' || inner === 'registered email')
    return { kind: 'registeredEmail' };
  if (inner === 'valid-password' || inner === 'valid password')
    return { kind: 'validPassword' };
  if (inner === 'invalid-password' || inner === 'invalid password')
    return { kind: 'invalidPassword' };

  const sized = /^(email|chars):\s*(\d+)$/.exec(inner);
  if (sized) {
    const length = Number(sized[2]);
    if (sized[1] === 'email' && length < 13)
      return { error: `<email:${length}> is too short to be a valid address (needs at least 13 characters)` };
    return sized[1] === 'email'
      ? { kind: 'emailOfLength', length }
      : { kind: 'charsOfLength', length };
  }

  // Anything else in angle brackets was meant as a token and misspelled.
  // Treating it as a literal would type "<registred-email>" into the field and
  // report a confusing application error instead of an authoring mistake.
  return { error: `Unknown token "${value}". Known tokens: ${TOKEN_HELP}` };
}

/** How the observed message must relate to the declared one. */
export type Matcher =
  | { kind: 'contains'; text: string }
  | { kind: 'regex'; source: string; flags: string };

export function parseMatcher(raw: string): Matcher | null {
  const value = raw.trim();
  if (!value)
    return null;
  const asRegex = /^\/(.+)\/([gimsuy]*)$/.exec(value);
  if (asRegex)
    return { kind: 'regex', source: asRegex[1], flags: asRegex[2] || 'i' };
  return { kind: 'contains', text: value };
}

export interface DataDrivenCase {
  testCaseId: string;
  scenario: string;
  module: string;
  worksheet: string;
  row: number;
  priority: string;
  tags: string[];
  /** The human-readable expectation, carried through for the failure message. */
  expectedResult: string;
  /** Field name -> value to enter. Field names are the runner's vocabulary. */
  inputs: Record<string, Token>;
  outcome: Outcome;
  message: Matcher | null;
}

export interface RejectedRow {
  testCaseId: string;
  module: string;
  worksheet: string;
  row: number;
  scenario: string;
  reason: string;
}

export interface DataDrivenCache {
  generatedAt: string;
  workbook: string;
  workbookPath: string;
  /** Sheets that carry an Assert Outcome column, so the reader can say so. */
  dataDrivenSheets: string[];
  cases: DataDrivenCase[];
  /** Rows that declared a contract but got it wrong. These fail loudly. */
  rejected: RejectedRow[];
}

/**
 * Parse `Test Data` into named inputs.
 *
 * One `name = value` per line. `:` works as well as `=`, because that is what
 * people type. A line without a separator is an error rather than a guess - a
 * bare "admin@example.com" could be either field.
 */
export function parseInputs(raw: string): Record<string, Token> | { error: string } {
  const inputs: Record<string, Token> = {};
  const lines = raw.split(/\r?\n|;/).map(line => line.trim()).filter(Boolean);
  if (!lines.length)
    return { error: 'Test Data is empty; a data-driven row must name its inputs, e.g. "email = <blank>"' };

  for (const line of lines) {
    const split = /^([A-Za-z][A-Za-z0-9 _-]*?)\s*[:=]\s*(.*)$/.exec(line);
    if (!split) {
      return {
        error: `Cannot read "${line}" as an input. Use one "name = value" per line, ` +
          'e.g. "email = <registered-email>"',
      };
    }
    const name = split[1].trim().toLowerCase().replace(/\s+/g, '');
    const token = parseToken(split[2]);
    if ('error' in token)
      return { error: `${name}: ${token.error}` };
    inputs[name] = token;
  }
  return inputs;
}

/**
 * Turn one workbook row into a runnable case, or explain why it cannot be one.
 *
 * `null` means "this row did not ask to be data-driven" - not an error.
 */
export function toDataDrivenCase(testCase: TestCase): DataDrivenCase | RejectedRow | null {
  const declared = (testCase.expectedOutcome ?? '').trim();
  if (!declared)
    return null;

  const location = {
    testCaseId: testCase.testCaseId,
    module: testCase.module,
    worksheet: testCase.source.worksheet,
    row: testCase.source.row,
    scenario: testCase.scenario,
  };
  const reject = (reason: string): RejectedRow => ({ ...location, reason });

  const outcome = normalizeOutcome(declared);
  if (!outcome) {
    return reject(`Assert Outcome "${declared}" is not recognised. ` +
      `Use one of: Signed In, Error, Blocked.`);
  }

  const inputs = parseInputs(testCase.testData);
  if ('error' in inputs)
    return reject(inputs.error as string);

  const message = parseMatcher(testCase.expectedMessage ?? '');
  if (outcome !== 'Error' && message) {
    return reject(`Assert Message is only meaningful with Assert Outcome = Error; ` +
      `this row says "${declared}".`);
  }

  // "Visible" without a list is the failure this outcome exists to prevent: a
  // test that signs in, checks nothing, and reports green.
  if (outcome === 'Visible' && !(inputs as Record<string, Token>).expect) {
    return reject('Assert Outcome = Visible needs an "expect" line naming what must be on the ' +
      'page, e.g. expect = My Favourites, All, Team Projects. Without it the row would pass ' +
      'as soon as the page loaded, having checked nothing.');
  }

  // The same failure in its general form: an outcome that cannot witness what
  // the row says should happen. Rejected, never repaired here - repairing would
  // mean the spreadsheet said one thing and the run asserted another, and the
  // author would have no way to see it. The dashboard repairs at save time,
  // where the change lands in the workbook and is visible.
  const gap = contractGap({
    scenario: testCase.scenario,
    expectedResult: testCase.expectedResult,
    outcome,
    inputNames: Object.keys(inputs as Record<string, Token>),
    steps: testCase.steps,
    submit: literalValueOf((inputs as Record<string, Token>).submit),
  });
  if (gap)
    return reject(gap.message);

  return {
    ...location,
    priority: testCase.priority,
    tags: testCase.tags,
    expectedResult: testCase.expectedResult,
    inputs: inputs as Record<string, Token>,
    outcome,
    message,
  };
}

function isRejected(value: DataDrivenCase | RejectedRow): value is RejectedRow {
  return 'reason' in value;
}

/** Build the cache from a parsed workbook. Pure - does not touch the disk. */
export function buildCache(parsed: ParseResult, generatedAt: string): DataDrivenCache {
  const dataDrivenSheets = parsed.worksheets
      .filter(sheet => sheet.bindings.some(binding => binding.field === 'expectedOutcome'))
      .map(sheet => sheet.worksheet);

  const cases: DataDrivenCase[] = [];
  const rejected: RejectedRow[] = [];
  for (const testCase of parsed.testCases) {
    const result = toDataDrivenCase(testCase);
    if (!result)
      continue;
    if (isRejected(result))
      rejected.push(result);
    else
      cases.push(result);
  }

  return {
    generatedAt,
    workbook: parsed.workbook,
    workbookPath: parsed.workbookPath,
    dataDrivenSheets,
    cases,
    rejected,
  };
}

export function writeCache(cache: DataDrivenCache): string {
  const file = cachePathFor(cache.workbookPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * Read the cache synchronously.
 *
 * Synchronous on purpose: Playwright collects tests by importing spec files in
 * a synchronous pass, so a runner cannot await anything while declaring its
 * tests. The cache is refreshed in globalSetup, which Playwright runs *before*
 * collection - verified, not assumed.
 */
export function readCache(workbookPath: string): DataDrivenCache | null {
  const file = cachePathFor(workbookPath);
  if (!fs.existsSync(file))
    return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as DataDrivenCache;
}
