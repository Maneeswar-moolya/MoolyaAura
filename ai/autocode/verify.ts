/**
 * Proving a generated spec is worth keeping.
 *
 * A green test is not evidence. The two rows this session started with were
 * both green and both checked nothing, and they were written by a person who
 * understood the application. An agent writing specs unattended will produce
 * the same failure faster, and with nobody reading the output.
 *
 * So a generated spec has to earn its place twice over:
 *
 *   clean run     it passes as written        - it works
 *   mutated run   it FAILS with its assertions mechanically broken
 *                                             - it was actually looking
 *
 * A spec that passes both ways asserts nothing about the application. That is
 * the single most valuable thing this module detects, because it is invisible
 * in every report: it looks exactly like coverage.
 *
 * A spec that fails both ways is broken rather than dishonest, but it is still
 * not something to register.
 *
 * The mutations are crude on purpose. They are not trying to be a mutation
 * testing framework - they only have to be enough that a test which genuinely
 * inspects application state notices, and a test which does not, does not.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseResults } from '../excel/results';
import { workbookOwner } from '../projects/registry';
import { isPositionProven, positionalExpression } from './dom-evidence';
// THE PATHS ONLY, and by name. The gate asks the recorder WHERE a case's evidence
// lives - live and archived - and nothing else: it reads no recording, spawns no
// codegen and interprets nothing the recorder knows. Keeping the convention in one
// place is the point; verify.ts spelled the live directory itself until now, which is
// how it came to know about only half of it.
import { archivedPath, evidencePath } from '../dashboard/recorder';
import { unstableTitleReason } from './scenario-title';

const ROOT = process.cwd();

export interface Mutation {
  /** Source of a regex matching one assertion form. No flags, no anchors. */
  source: string;
  apply: (match: string) => string;
  describe: string;
}

/** A string no page will contain, used to break a text expectation. */
const SENTINEL = '__autocode_mutant_no_match__';

/**
 * A quoted string literal, honouring escapes.
 *
 * Spelled out per quote character rather than with a backreference to a capture
 * group: these rules are concatenated into one master alternation, which
 * renumbers every group, so `\1` stops meaning what it meant standalone and the
 * rule silently matches nothing. No groups, no numbering to get wrong.
 */
const QUOTED = String.raw`(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|` + '`(?:\\\\.|[^`\\\\])*`)';

/**
 * The options object every web-first matcher accepts: `.toBeVisible({ timeout: 2000 })`.
 *
 * Matching only the empty-parens form rejected specs for having "no
 * recognisable assertion" when they were asserting perfectly well - and a
 * timeout on a visibility check is completely ordinary Playwright, so that
 * would have quarantined a large share of honest work.
 */
const OPTIONS = String.raw`\(\s*(?:\{[^{}]*\}\s*)?\)`;

/** A negatable matcher: swap it for its opposite, options and all. */
const flip = (from: string, to: string): Mutation => ({
  source: String.raw`\.${from}` + OPTIONS,
  apply: match => match.replace(from, to),
  describe: `${from} -> ${to}`,
});

export const MUTATIONS: Mutation[] = [
  { source: String.raw`\.toBe\(true\)`, apply: () => '.toBe(false)', describe: 'toBe(true) -> toBe(false)' },
  { source: String.raw`\.toBe\(false\)`, apply: () => '.toBe(true)', describe: 'toBe(false) -> toBe(true)' },
  flip('toBeVisible', 'toBeHidden'),
  flip('toBeHidden', 'toBeVisible'),
  flip('toBeEnabled', 'toBeDisabled'),
  flip('toBeDisabled', 'toBeEnabled'),
  flip('toBeChecked', 'not.toBeChecked'),
  flip('toBeEmpty', 'not.toBeEmpty'),
  flip('toBeAttached', 'not.toBeAttached'),
  flip('toBeInViewport', 'not.toBeInViewport'),
  { source: String.raw`\.toEqual\(\[\]\)`, apply: () => `.toEqual(['${SENTINEL}'])`, describe: 'toEqual([]) -> non-empty' },
  // Deliberately do NOT require the closing paren: these matchers take options
  // too, and `.toHaveCount(3, { timeout: 5000 })` must still be mutable.
  {
    source: String.raw`\.(toHaveCount|toBe|toEqual|toHaveLength)\(\s*(\d+)(?![\d.\w])`,
    apply: match => {
      const [, method, value] = /\.(\w+)\(\s*(\d+)/.exec(match)!;
      return `.${method}(${Number(value) + 7919}`;
    },
    describe: 'expected number -> a different number',
  },
  {
    source: String.raw`\.(toBeGreaterThan|toBeGreaterThanOrEqual)\(\s*(\d+)(?![\d.\w])`,
    apply: match => {
      const [, method, value] = /\.(\w+)\(\s*(\d+)/.exec(match)!;
      return `.${method}(${Number(value) + 100000}`;
    },
    describe: 'lower bound -> an impossible bound',
  },
  // A NEGATIVE text expectation is falsified the other way round: a pattern
  // nothing matches leaves `.not.` passing, so this widens it to one that
  // matches everything. Listed before the positive rules because the scan runs
  // left to right and `.not.toMatch(` starts earlier than the `.toMatch(`
  // inside it - without this a spec built on `.not.` assertions came back
  // byte-identical and was reported as untestable.
  {
    source: String.raw`\.not\.(toMatch|toHaveText|toContainText|toHaveURL|toHaveValue|toHaveTitle)\(\s*(?:\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*|` + QUOTED + ')',
    apply: match => `.not.${/\.not\.(\w+)\(/.exec(match)![1]}(/[\\s\\S]*/`,
    describe: 'negated expectation -> a pattern everything matches',
  },
  // Text-ish expectations: replace the expected literal, never the locator.
  {
    source: String.raw`\.(toHaveText|toContainText|toHaveURL|toHaveValue|toHaveTitle|toMatch|toBe|toEqual)\(\s*` + QUOTED,
    apply: match => `.${/\.(\w+)\(/.exec(match)![1]}('${SENTINEL}'`,
    describe: 'expected text literal -> a string no page contains',
  },
  // The same matchers given a regex. Common for URLs, and without this a spec
  // whose only assertion is toHaveURL(/apps/) has nothing to mutate and is
  // rejected for looking empty when it is merely unrecognised.
  {
    source: String.raw`\.(toHaveText|toContainText|toHaveURL|toHaveValue|toHaveTitle|toMatch)\(\s*\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*`,
    apply: match => `.${/\.(\w+)\(/.exec(match)![1]}(/${SENTINEL}/`,
    describe: 'expected pattern -> a pattern no page matches',
  },
];

export interface MutationOutcome {
  source: string;
  applied: string[];
}

/**
 * Break every assertion this module knows how to break, in ONE pass.
 *
 * One pass is the whole point. Applying the rules in sequence over the same
 * text let a later rule undo an earlier one - `toBeVisible` became
 * `toBeHidden`, and the very next rule turned it back - so the "mutated" spec
 * was byte-identical to the original, it passed, and the gate rejected honest
 * tests for asserting nothing. A single left-to-right scan never revisits text
 * it has already replaced, so no rule can see another rule's output.
 */
export function mutate(source: string): MutationOutcome {
  const master = new RegExp(MUTATIONS.map(mutation => `(?:${mutation.source})`).join('|'), 'g');
  const applied = new Set<string>();

  const mutated = source.replace(master, match => {
    for (const mutation of MUTATIONS) {
      if (!new RegExp(`^(?:${mutation.source})$`).test(match))
        continue;
      applied.add(mutation.describe);
      return mutation.apply(match);
    }
    return match;
  });

  return { source: mutated, applied: [...applied] };
}

export interface StaticProblem {
  message: string;
}

/**
 * The title convention both traceability consumers actually key on.
 *
 * Group 1 is the Test Case ID, group 2 the scenario half. Deliberately the SAME shape
 * as `TITLE_PATTERN` in ai/excel/mapping.ts, because that is the reader whose failure
 * would detach a spec from its row.
 */
const CANONICAL_TITLE = /['"`]\s*((?:TC|TS)[_-][A-Za-z0-9_-]+)\s*-\s*([^'"`]+?)\s*['"`]/g;

/**
 * Checks that do not need the application, run before spending a browser on it.
 */
export function staticCheck(source: string, testCaseId: string, scenario: string): StaticProblem[] {
  const problems: StaticProblem[] = [];

  // THE IDENTITY IS THE TEST CASE ID, NOT THE AUTHORED SENTENCE.
  //
  // This used to require `source.includes(`${testCaseId} - ${scenario}`)` - byte
  // equality with the workbook's Scenario cell - and justified it as "mapping sync and
  // results.ts both find the case by it". Neither does. `results.ts` extracts the case
  // with `/\b((?:TC|TS)[_-][A-Za-z0-9_-]+)\b/` against the title, and `scanSpecs` READS
  // the scenario half out of the spec as capture group 2 rather than comparing it to
  // anything. The ID is the key; the sentence is a label the mapping learns.
  //
  // The distinction did not matter while the two were always the same string. It began
  // to matter the moment the assembler started DERIVING a title for a row whose
  // authored cell names a CSS selector - `#tr_1749552 > .tabulator-cell… - 1749553 is
  // ticked` cannot name a test stably - because the spec then carried a better title
  // than the cell and this check called that a broken traceability link. Measured over
  // the corpus: 47 of 79 recorded cases would have been quarantined for it, TC_LOGIN_121
  // among them, every one of them a case whose title had just been IMPROVED.
  //
  // So identity is checked on the ID, and the authored sentence is still enforced
  // exactly where it is still authoritative: when the cell can name the test, the title
  // must be it. Nothing here is fuzzy - the ID must match exactly, and a spec with no
  // canonical title at all is refused as loudly as before.
  const titles = [...source.matchAll(CANONICAL_TITLE)];
  const mine = titles.filter(match => match[1] === testCaseId);
  if (!mine.length) {
    problems.push({ message: `No test titled "${testCaseId} - <scenario>". The Test Case ID in the `
      + 'title is how a result finds its workbook row, so it has to be present and exact'
      + `${titles.length ? ` (found: ${titles.map(match => match[1]).join(', ')})` : ''}.` });
  } else if (!mine.some(match => match[2].trim())) {
    problems.push({ message: `The test titled "${testCaseId} - …" has an empty scenario half, so `
      + 'the run report would name the case and say nothing about it.' });
  } else if (!unstableTitleReason(scenario) && !source.includes(`${testCaseId} - ${scenario}`)) {
    // THE CELL STILL WINS WHERE THE CELL CAN NAME THE TEST. A stable authored scenario
    // is the author's own words and the assembler never replaces one, so a spec that
    // does not carry it verbatim has drifted - which is exactly what this check caught
    // before, and still catches, for every row and every generator that has no reason
    // to derive.
    problems.push({ message: `No test titled "${testCaseId} - ${scenario}". The authored Scenario `
      + 'names this test stably, so the title must match it exactly'
      + `; found "${testCaseId} - ${mine[0][2]}".` });
  }
  if (!/\btrace\s*\(/.test(source))
    problems.push({ message: 'The test never calls trace({...}), so it contributes no traceability metadata.' });
  if (!/\bexpect\s*\(/.test(source))
    problems.push({ message: 'The spec contains no expect() at all - it cannot fail, so it proves nothing.' });

  for (const problem of positionalIdentity(source, testCaseId))
    problems.push(problem);

  for (const problem of undeclaredFixtures(source))
    problems.push(problem);

  return problems;
}

/**
 * Fixtures the spec asks Playwright for that the framework does not declare.
 *
 * WHY HERE AND NOT ONLY IN THE RESOLVER. `methodIsDeliverable` stops the DETERMINISTIC
 * recorded mapper naming a fixture that does not exist, and that is where the IssuesPage
 * failure came from. It leaves the other half of the pipeline open: a spec the MODEL
 * wrote is handed straight to `gate()`, and nothing between the two validates its
 * destructure list. Playwright refuses the whole FILE for one unknown parameter, so the
 * cost is every test in it - and the check is free here: offline, no browser, one read
 * of an index that is rebuilt every run anyway.
 *
 * Refused as a STATIC problem rather than left to the run, because a run cannot say
 * anything useful about it: the suite never builds, so no assertion is ever evaluated.
 */
function undeclaredFixtures(source: string): StaticProblem[] {
  // Playwright's own, which no fixtures module declares and every spec may ask for.
  const BUILT_IN = ['page', 'context', 'browser', 'browserName', 'request', 'playwright'];
  let declared: string[];
  try {
    const { buildIndex } = require('../knowledge/index') as typeof import('../knowledge/index');
    declared = buildIndex().fixtures;
  } catch {
    // The index could not be built. Say nothing rather than refuse every spec: a check
    // that cannot read the framework has no opinion about a spec.
    return [];
  }
  if (!declared.length)
    return [];
  const allowed = new Set([...declared, ...BUILT_IN]);
  const unknown = new Set<string>();
  for (const match of source.matchAll(/async \(\{([^}]*)\}/g)) {
    for (const raw of match[1].split(',')) {
      // `{ page, step }` and `{ page: p }` both name `page` as the fixture.
      const name = raw.split(':')[0].trim();
      if (name && !allowed.has(name))
        unknown.add(name);
    }
  }
  if (!unknown.size)
    return [];
  return [{
    message: `The spec destructures ${[...unknown].map(name => `"${name}"`).join(', ')}, which `
      + 'the framework does not declare as a fixture. Playwright refuses the whole file for one '
      + 'unknown parameter - "Test has unknown parameter" - so no test in it would be collected. '
      + `Declared fixtures are: ${declared.join(', ')}.`,
  }];
}

/**
 * `.first()` used to IDENTIFY an element, which is never allowed.
 *
 * THE DISTINCTION THIS TURNS ON. Playwright's positional helpers are legitimate
 * on a collection and forbidden on an identity, and the two look identical to a
 * naive scan:
 *
 *   rows.first()                        <- a collection. The variable IS a set,
 *                                          and taking its first item is the point.
 *   page.locator('.button').first()     <- an identity. Something matched several
 *                                          elements and one was taken to make the
 *                                          ambiguity go away.
 *
 * So the rule keys on what the positional call is applied TO: a `page.*` locator
 * chain built inline is an identity, and nothing else is matched. A named
 * variable, a Page Object call, an argument - all left alone, because a spec is
 * entitled to say "the first row" when that is what it means.
 *
 * This is deliberately narrower than "reject every .first()". Over-rejecting
 * would push authors toward `page.locator(...).nth(0)` and similar dodges, which
 * is the same defect wearing a different name.
 */
/**
 * The exact positional expressions this test case's own recording can prove.
 *
 * RE-DERIVED, NEVER TRUSTED. The set is computed here from the evidence file by the
 * same predicate the engine used - not passed in by the caller, not inferred from the
 * spec. So a `.nth(2)` somebody typed into a spec is refused exactly as before, and
 * the only index that survives is one composed from a position the browser measured
 * for the element that was pressed. No evidence file, no exemption.
 *
 * This is why the check reads a file at all, which it did not before: the proof for an
 * index cannot live in the spec text. A locator string carries no provenance, so
 * judging it by shape alone can only ever establish that an index is PRESENT - and
 * that was enough to quarantine TC_DASHBOARD_023, whose index was the one thing about
 * it that had actually been measured.
 */
function provenPositionalExpressions(testCaseId: string): Set<string> {
  const allowed = new Set<string>();
  if (!testCaseId)
    return allowed;

  // LIVE FIRST, THEN THE ARCHIVE - AND THE SAME FILE EITHER WAY.
  //
  // `acceptRecording` MOVES the evidence to `recordings/accepted/` the moment a spec is
  // accepted, and this function used to read the live directory alone. So a case that
  // had passed this very gate could no longer pass it: its proof had been filed, not
  // withdrawn. Measured over the corpus - 7 accepted specs contain an evidence-backed
  // index (TC_DASHBOARD_026, TC_LOGIN_106/108/112/121/122/123) and NOT ONE of them still
  // has live evidence, so every one is refused today for an index its own archive
  // proves. TC_LOGIN_122: 0 proven expressions from `recordings/`, 43 from `accepted/`,
  // and the spec's two indices are in the second set.
  //
  // NOTHING ELSE MOVES. Same predicate, same composition, same teeth - a different
  // index, a base the evidence never measured, another case's expression, `first()` and
  // `last()` are all refused exactly as before, and a spec with no evidence anywhere is
  // refused exactly as before. The paths come from the recorder's own accessors rather
  // than being spelled again here, so there is one archive convention and this file no
  // longer carries a second copy of the live one.
  const sources = [evidencePath(testCaseId), archivedPath(testCaseId, '.evidence.json')];
  let body: { targets?: Array<{ positionProvenCandidates?: unknown[] }> } | null = null;
  for (const file of sources) {
    try {
      body = JSON.parse(fs.readFileSync(file, 'utf8'));
      break;
    } catch {
      // Missing or unreadable: try the other location. Two failures mean no evidence,
      // which is the case this function already answered with an empty set.
      body = null;
    }
  }
  if (!body)
    return allowed;

  for (const target of body.targets ?? []) {
    for (const candidate of target.positionProvenCandidates ?? []) {
      // EITHER TIMING, because this re-derives what the RECORDING proves and a
      // recording proves both: a press for an action, and an assertion's own pick for
      // that assertion. The teeth are unchanged - a different index, a base the
      // evidence never measured, another case's expression and first()/last() are all
      // still refused, and the proof still has to be in this case's own file.
      if (!isPositionProven(candidate as never))
        continue;
      const expression = positionalExpression(candidate as never);
      if (expression)
        allowed.add(expression);
    }
  }
  return allowed;
}

function positionalIdentity(source: string, testCaseId = ''): StaticProblem[] {
  const problems: StaticProblem[] = [];
  const allowed = provenPositionalExpressions(testCaseId);
  const pattern = /page\s*\.\s*(?:locator|getBy[A-Za-z]+)\s*\([^;]*?\)\s*(?:\.\s*[a-z]\w*\s*\([^;]*?\)\s*)*\.\s*(first|last|nth)\s*\(/g;
  for (const line of source.split('\n')) {
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (!match)
      continue;
    // An index this recording MEASURED is not an index somebody chose. Matched by the
    // whole expression, so a different base or a different index is still a finding.
    if (match[1] === 'nth' && [...allowed].some(expression => line.includes(expression)))
      continue;
    problems.push({
      message: `\`.${match[1]}()\` is used to identify an element: ${line.trim().slice(0, 90)}. `
        + 'A locator that matches several elements has not identified one, and choosing by '
        + 'position chooses an element nobody chose. Use a locator that names the element - a '
        + 'role and accessible name, or a stable container scoping the text - or leave the step '
        + 'for review. This rule does not apply to a collection: `rows.first()` is fine.',
    });
  }
  return problems;
}

export type GateVerdict = 'accepted' | 'quarantined';

export interface GateResult {
  verdict: GateVerdict;
  reason: string;
  /** What each stage did, for the log and the run record. */
  detail: {
    staticProblems: string[];
    mutationsApplied: string[];
    cleanStatus?: string;
    mutatedStatus?: string;
    cleanFailure?: string;
    /** Static checks plus the one-pass mutation. Milliseconds. */
    staticMs?: number;
    /** The spec run as written. Absent when the static checks ended it first. */
    cleanRunMs?: number;
    /** The spec run with its assertions broken. Absent when the clean run failed. */
    mutationRunMs?: number;
    /**
     * WHICH PHASE and WHY the clean run failed, plus Playwright's own words.
     *
     * Carried so a quarantine record can name the cause instead of the symptom. Absent
     * when the gate never got as far as running, or when the run passed.
     */
    phase?: FailurePhase;
    code?: FailureCode;
    playwrightMessage?: string;
    location?: string;
    fixture?: string;
    collected?: number;
  };
}

/**
 * WHICH PHASE a run died in. Three, and they are not interchangeable.
 *
 * `collection` means Playwright never ran the test - it could not build the suite, so no
 * locator in the spec was ever exercised and nothing may be concluded about one.
 * `execution` means the test ran. `static` never reaches here.
 */
export type FailurePhase = 'collection' | 'execution';

/**
 * WHY, as a code rather than a sentence.
 *
 * `Not Collected` was one string covering an unknown fixture, a spec that does not
 * compile, and a `--grep` that matched nothing - three unrelated problems with three
 * different owners. TC_LOGIN_109 spent a quarantine on the first while the message
 * described the third, and the same string hid the same cause in nine other cases.
 *
 * These are CODES for a machine and a report heading. The prose root-cause table in
 * ai/excel/results.ts is a different thing and is not replaced: it explains an execution
 * failure to whoever reads the workbook, and it is still what fills that column.
 */
export type FailureCode =
  /** The spec names a Playwright fixture the framework does not declare. */
  | 'UNKNOWN_FIXTURE'
  /** The suite built, but no test carrying this Test Case ID was in it. */
  | 'NO_MATCHING_TEST'
  /** The file could not be transformed or imported - syntax, types, a missing module. */
  | 'COMPILE_ERROR'
  /** Collection failed for a reason none of the above describes. Message preserved. */
  | 'COLLECTION_ERROR'
  /**
   * `globalSetup` threw, so nothing was loaded and the spec is not implicated.
   *
   * Run mode orders globalSetup BEFORE the load task, so a locked workbook or an
   * unreadable data-driven contract arrives in `errors[]` looking exactly like a spec
   * that will not compile - and the spec would then be quarantined and retracted for an
   * environment fault.
   */
  | 'GLOBAL_SETUP_FAILURE'
  /** A locator matched more than one element. */
  | 'STRICT_MODE_FAILURE'
  /** An expect() did not hold. */
  | 'ASSERTION_FAILURE'
  /** Something waited out its budget. */
  | 'TIMEOUT'
  /** The test ran and threw for some other reason. */
  | 'RUNTIME_FAILURE';

interface RunOutcome {
  /** 'Passed' | 'Failed' | 'Skipped' | ... , or 'Not Collected' when no test ran. */
  status: string;
  failureReason: string;
  /** Wall time of the whole Playwright invocation, not just the test body. */
  durationMs: number;
  /** Absent when the test passed. */
  phase?: FailurePhase;
  code?: FailureCode;
  /**
   * Playwright's own words, never paraphrased and never discarded.
   *
   * The whole defect this addresses is that `spawnSync`'s output was thrown away:
   * Playwright had already said `Test has unknown parameter "issuesPage"` and named the
   * line, and the quarantine record said `Not Collected`.
   */
  playwrightMessage?: string;
  /** Where Playwright pointed, when it pointed anywhere. */
  location?: string;
  /** The fixture it named, for UNKNOWN_FIXTURE. */
  fixture?: string;
  /** How many tests the suite ended up containing. 0 is the interesting case. */
  collected?: number;
}

/**
 * Playwright's own words, made safe to put in a one-line record - and nothing else.
 *
 * ANSI codes are stripped because the reporter colourises even under --reporter=json,
 * and a quarantine reason with escape sequences in it is unreadable wherever it lands.
 * Newlines become " | " so the message survives as ONE field in the workbook, the log
 * and state.json. Bounded, never re-worded, never truncated below the first sentence.
 */
function plain(message: string): string {
  const ESC = String.fromCharCode(27);
  return String(message ?? '')
      .split(new RegExp(ESC + '\\[[0-9;]*m', 'g')).join('')
      .replace(/\[[0-9;]*m/g, '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .join(' | ')
      .slice(0, 1200);
}

/**
 * Classify a COLLECTION failure from Playwright's own structured error.
 *
 * Read from the JSON report's `errors[]`, not scraped from stdout: the reporter already
 * gives `{ message, location, snippet }`, and matching on structure beats matching on a
 * console rendering that changes with the reporter and the terminal.
 */
export function classifyCollectionError(
  message: string,
  /**
   * Where Playwright pointed, when it pointed anywhere, and the spec it was asked about.
   *
   * A GLOBAL SETUP FAULT IS NOT A SPEC DEFECT, and run mode makes the two easy to
   * confuse: `globalSetup` runs BEFORE the load task, so a locked workbook or an
   * unreadable data-driven contract lands in `errors[]` before a single spec is read.
   * Without this, `Cannot find module` from global-setup.ts matched the compile pattern
   * and the SPEC was quarantined and retracted for an environment fault. The error's own
   * location is what tells them apart, and it is structured data rather than a guess.
   */
  location?: { file?: string } | null,
  specFile?: string,
): { code: FailureCode; fixture?: string } {
  const text = plain(message);
  const where = String(location?.file ?? '').split(/[\/]/).pop() ?? '';
  const spec = String(specFile ?? '').split(/[\/]/).pop() ?? '';
  if (where && spec && where !== spec)
    return { code: 'GLOBAL_SETUP_FAILURE' };
  const fixture = /unknown parameter "([^"]+)"/i.exec(text)?.[1];
  if (fixture)
    return { code: 'UNKNOWN_FIXTURE', fixture };
  // Playwright throws this into errors[] when a positional file argument matched no
  // test, which is why the `!records.length` branch below is not the only route to it.
  if (/No tests found/i.test(text))
    return { code: 'NO_MATCHING_TEST' };
  if (/SyntaxError|Transform failed|Cannot find module|error TS\d+|Unexpected token|is not defined/i.test(text))
    return { code: 'COMPILE_ERROR' };
  return { code: 'COLLECTION_ERROR' };
}

/**
 * Classify an EXECUTION failure. Ordered, and the order matters.
 *
 * Strict mode first: a strict-mode violation is reported through a locator call that
 * also times out, so the timeout pattern would otherwise claim it and hide the one
 * failure this project cares most about. Assertion before runtime for the same reason.
 */
export function classifyExecutionFailure(failureReason: string): FailureCode {
  const text = plain(failureReason);
  if (/strict mode violation/i.test(text))
    return 'STRICT_MODE_FAILURE';
  if (/expect\(.*\)\.(?:to|not)|Expected string|Received string|toHaveText|toBeVisible|toBeChecked|toHaveURL|toContainText/i.test(text))
    return 'ASSERTION_FAILURE';
  if (/Timeout .* exceeded|exceeded while running|navigation timeout|Test timeout of \d+ms exceeded/i.test(text))
    return 'TIMEOUT';
  return 'RUNTIME_FAILURE';
}

/** The JSON report, or null. A half-written report must not throw inside the gate. */
function readReport(jsonPath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/** How many tests the suite ended up containing, at any nesting depth. */
function countTests(report: any): number {
  let total = 0;
  const walk = (suites: any[]): void => {
    for (const suite of suites ?? []) {
      total += (suite.specs ?? []).length;
      walk(suite.suites ?? []);
    }
  };
  walk(report?.suites ?? []);
  return total;
}

/**
 * Run one test from one spec file, in isolation from everything else.
 *
 * `--output` and a private JSON path matter: the normal config writes into
 * test-results-excel/ and reports/, which Playwright wipes on every run. A
 * verification run must not destroy the results of the suite run that is
 * probably what someone is looking at.
 */
function runOne(specFile: string, testCaseId: string, workbook: string): RunOutcome {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'autocode-'));
  const jsonPath = path.join(scratch, 'results.json');
  const startedMs = Date.now();
  const elapsed = () => Date.now() - startedMs;
  try {
    const result = spawnSync(process.execPath, [
      require.resolve('@playwright/test/cli'), 'test',
      '--config=playwright.excel.config.ts',
      specFile,
      '--grep', testCaseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      '--reporter=json',
      '--retries=0',
      '--workers=1',
      `--output=${path.join(scratch, 'artifacts')}`,
    ], {
      cwd: ROOT,
      shell: false,
      encoding: 'utf8',
      env: {
        ...process.env,
        EXCEL_WORKBOOK: workbook,
        // The APPLICATION that owns that workbook, matching what `ai/excel/cli.ts` sends.
        // `tests-e2e/support/data-driven.ts` now refuses a workbook whose declared owner
        // is not the active application, so sending one without the other is a
        // contradiction the suite would (correctly) reject.
        AURA_APPLICATION: workbookOwner(workbook),
        PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath,
        // Keep the gate's two runs out of ai/reports/steps. The mutated run is
        // deliberately red, and leaving its step list behind would have the
        // dashboard showing a failed step list for a passing test.
        EXCEL_STEPS_DIR: path.join(scratch, 'steps'),
        FORCE_COLOR: '0',
      },
    });

    if (!fs.existsSync(jsonPath)) {
      // No report at all. Playwright could not get far enough to write one, and its own
      // words are the only evidence there is - so they are carried, not summarised.
      const said = plain([result.stdout, result.stderr].filter(Boolean).join(' | '));
      return { status: 'Not Collected', durationMs: elapsed(),
        phase: 'collection', code: 'COMPILE_ERROR', collected: 0,
        playwrightMessage: said,
        failureReason: `COMPILE_ERROR: Playwright wrote no report. ${said}`.trim() };
    }

    // THE REPORT'S OWN ERRORS, which this function used to read past. A collection
    // failure writes `{ suites: [], errors: [{ message, location, snippet }], stats }` -
    // verified against a real unknown-fixture failure - so the cause is structured data
    // sitting in a file that was already being opened.
    const report = readReport(jsonPath);
    const collected = countTests(report);
    const firstError = (report?.errors ?? []).find((entry: any) => entry?.message);
    if (firstError) {
      const { code, fixture } = classifyCollectionError(
          firstError.message, firstError.location, specFile);
      const where = firstError.location
        ? `${path.relative(ROOT, String(firstError.location.file)).split(path.sep).join('/')}`
          + `:${firstError.location.line}`
        : undefined;
      return {
        status: 'Not Collected', durationMs: elapsed(), phase: 'collection', code,
        collected, playwrightMessage: plain(firstError.message),
        ...(where ? { location: where } : {}),
        ...(fixture ? { fixture } : {}),
        failureReason: `${code}${fixture ? ` (${fixture})` : ''}: ${plain(firstError.message)}`
          + `${where ? ` at ${where}` : ''}. Collected ${collected} test(s).`,
      };
    }

    const records = parseResults(jsonPath)
        .filter(record => record.testCaseId?.toUpperCase() === testCaseId.toUpperCase());
    if (!records.length) {
      // The suite built and this ID was not in it. A real and different problem from the
      // two above: the title does not carry the ID, or --grep excluded it.
      return { status: 'Not Collected', durationMs: elapsed(),
        phase: 'collection', code: 'NO_MATCHING_TEST', collected,
        failureReason: `NO_MATCHING_TEST: the suite built and contained ${collected} test(s), `
          + `but none carrying ${testCaseId}. Check the test title starts "${testCaseId} - ".` };
    }

    const outcome = records[0];
    if (outcome.executionStatus === 'Passed')
      return { status: outcome.executionStatus, failureReason: outcome.failureReason, durationMs: elapsed() };
    return {
      status: outcome.executionStatus, failureReason: outcome.failureReason, durationMs: elapsed(),
      phase: 'execution', code: classifyExecutionFailure(outcome.failureReason), collected,
      playwrightMessage: plain(outcome.failureReason),
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The gate. Returns whether this spec may be registered as automation.
 *
 * The spec file is restored to its original contents whatever happens - a
 * mutated spec left on disk would be a booby trap.
 */
export function gate(
  specFile: string,
  testCaseId: string,
  scenario: string,
  workbook: string,
  onLog: (text: string) => void = () => {},
): GateResult {
  const absolute = path.resolve(ROOT, specFile);
  const original = fs.readFileSync(absolute, 'utf8');
  const detail: GateResult['detail'] = { staticProblems: [], mutationsApplied: [] };
  const staticStartedMs = Date.now();

  const staticProblems = staticCheck(original, testCaseId, scenario);
  detail.staticProblems = staticProblems.map(problem => problem.message);
  if (staticProblems.length) {
    detail.staticMs = Date.now() - staticStartedMs;
    return { verdict: 'quarantined', detail,
      reason: `Failed the static checks: ${detail.staticProblems.join(' ')}` };
  }

  const { source: mutated, applied } = mutate(original);
  detail.mutationsApplied = applied;
  detail.staticMs = Date.now() - staticStartedMs;
  if (!applied.length) {
    return { verdict: 'quarantined', detail,
      reason: 'None of the known assertion forms appear in this spec, so there is no way to show ' +
        'that it can fail. Rewrite it using standard expect() matchers.' };
  }

  onLog(`  clean run: ${testCaseId}\n`);
  const clean = runOne(specFile, testCaseId, workbook);
  detail.cleanStatus = clean.status;
  detail.cleanRunMs = clean.durationMs;
  if (clean.status !== 'Passed') {
    detail.cleanFailure = clean.failureReason;
    detail.phase = clean.phase;
    detail.code = clean.code;
    detail.playwrightMessage = clean.playwrightMessage;
    detail.location = clean.location;
    detail.fixture = clean.fixture;
    detail.collected = clean.collected;
    // THE CAUSE, NAMED, and Playwright's own sentence kept beside it. This used to read
    // "The spec does not pass as written (Not Collected). No test with this ID was
    // collected from the spec." for an unknown fixture, a spec that does not compile and
    // a title that does not carry the ID alike.
    const headline = clean.code
      ? `Phase: ${(clean.phase ?? 'execution').toUpperCase()} | Reason: ${clean.code}`
        + `${clean.fixture ? ` | Fixture: ${clean.fixture}` : ''}`
        + `${clean.location ? ` | At: ${clean.location}` : ''}`
        + `${clean.collected === undefined ? '' : ` | Collected tests: ${clean.collected}`}`
      : `The spec does not pass as written (${clean.status})`;
    return { verdict: 'quarantined', detail,
      reason: `${headline}. ${clean.playwrightMessage ?? clean.failureReason}`.trim() };
  }

  onLog(`  mutated run (${applied.length} mutation type(s)): ${testCaseId}\n`);
  try {
    fs.writeFileSync(absolute, mutated, 'utf8');
    const broken = runOne(specFile, testCaseId, workbook);
    detail.mutatedStatus = broken.status;
    detail.mutationRunMs = broken.durationMs;
    if (broken.status === 'Passed') {
      return { verdict: 'quarantined', detail,
        reason: 'The spec still passes with every assertion broken, so it is not checking the ' +
          'application. This is the false positive the gate exists to catch.' };
    }
  } finally {
    // Always. A mutated spec left behind would fail forever for a reason that
    // appears nowhere in the workbook.
    fs.writeFileSync(absolute, original, 'utf8');
  }

  return { verdict: 'accepted', detail,
    reason: `Passed as written and failed with its assertions broken (${applied.join('; ')}).` };
}
