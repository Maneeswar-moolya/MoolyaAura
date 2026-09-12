/**
 * Choosing what the generator is shown, deterministically, before it runs.
 *
 * The measured baseline was ~31,200 tokens per case of which 168 were the test
 * case. The rest was the same reading every time: CLAUDE.md (which Claude Code
 * already loads automatically, so the read was a pure duplicate), all of SKILL.md
 * (mostly about running suites and writing reports, not writing a spec), every
 * Page Object including the four the case never touches, the fixtures, the step
 * recorder, the env module, and a 29 KB spec file to change one test inside it.
 *
 * The fix is not to make the agent choose better - asking it to decide what to
 * read *is* the survey. Selection is bookkeeping, so it belongs in code, exactly
 * like `surveyWork` deciding which rows need an agent at all.
 *
 * What this module decides:
 *
 *   inlined   the brief, the framework index, and the *relevant slice* of the
 *             spec file - no read round-trip, no chance of reading more
 *   named     the one or two Page Objects the row actually touches, for the
 *             agent to Read when it needs an implementation detail
 *   omitted   everything else, and it may still Grep for it if the index is
 *             wrong. Nothing here forbids a search; it removes the need to start
 *             with one.
 *
 * The budget is measurement, not a gate. Exceeding it logs and records; it never
 * refuses a case, because a big row is a reason to look at the row, not to skip
 * generating it.
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildIndex, type FrameworkIndex, KNOWLEDGE_DIR, toYaml } from '../knowledge/index';
import {
  assessBrowserNeed, assessSufficiency, type BrowserNeed, describeDecisions, type KnowledgeMatch,
  readAllPageKnowledge, selectPageKnowledge, type SufficiencyResult,
} from '../knowledge/page-knowledge';
import {
  buildPageIndex, canonicalFile, canonicalIdentity, type CanonicalIdentity, describeDuplicates,
  type PageIndex,
} from '../knowledge/canonical';
import { authRequirement } from './groups';
import { isRecordedTags, wasSignedInTags } from '../dashboard/recorder';
import type { TestCase } from '../excel/types';

const ROOT = process.cwd();
export const BRIEF_FILE = path.join(KNOWLEDGE_DIR, 'brief.md');

const CHARS_PER_TOKEN = 3.7;
export const approxTokens = (chars: number): number => Math.round(chars / CHARS_PER_TOKEN);

/**
 * Tokens of prompt plus directed reading that a case is expected to fit in.
 *
 * Covers only what this module controls. The CLAUDE.md that Claude Code loads by
 * itself is counted and reported separately, because no amount of selection here
 * changes it - shrinking that is a decision about CLAUDE.md, not about generation.
 */
export const DEFAULT_BUDGET_TOKENS = 15_000;

export function budgetTokens(): number {
  const raw = Number.parseInt(process.env.AUTOCODE_CONTEXT_BUDGET ?? '', 10);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_BUDGET_TOKENS;
}

/** How many Page Objects a single case may pull in before it is suspicious. */
const MAX_PAGES = 3;

export interface SelectedSource {
  file: string;
  approxTokens: number;
  /** Why it was selected, for the log and for auditing a bad selection. */
  reason: string;
}

export interface ContextBudget {
  testCaseTokens: number;
  briefTokens: number;
  frameworkIndexTokens: number;
  specExcerptTokens: number;
  instructionTokens: number;
  /** Page knowledge for this row's screen(s), inlined. */
  pageKnowledgeTokens: number;
  /** Everything actually sent as the prompt. */
  promptTokens: number;
  /** Files the prompt names for the agent to read. An upper bound - it may read fewer. */
  directedReadTokens: number;
  /** CLAUDE.md, loaded by Claude Code itself. Not controllable from here. */
  autoLoadedTokens: number;
  /** promptTokens + directedReadTokens. What this module is accountable for. */
  controlledTokens: number;
  /** controlledTokens + autoLoadedTokens. */
  totalContextTokens: number;
  budgetTokens: number;
  overBudget: boolean;
}

export interface ContextSelection {
  brief: string;
  frameworkIndexYaml: string;
  /** Page Objects the prompt will name. Never inlined - the agent reads them. */
  pages: SelectedSource[];
  /** The relevant slice of the target spec file, inlined. */
  specExcerpt: string | null;
  specExcerptNote: string | null;
  /** Files deliberately not offered, with the count, for the record. */
  omitted: SelectedSource[];
  /** Page knowledge for this row's screen(s), and whether it is enough. */
  pageKnowledge: KnowledgeMatch[];
  sufficiency: SufficiencyResult;
  /**
   * Whether a browser is actually needed, which is NOT the same question as whether
   * the knowledge is complete. A `partial` verdict whose every gap is a preposition
   * needs no browser.
   */
  browserNeed: BrowserNeed;
  /** Where this row came from. Absent tag = an ordinary case, treated exactly as before. */
  origin: { recorded: boolean; signedInDuringRecording: boolean };
  /** The one file this row's screen may be recorded in, derived from its route. */
  canonicalPage: CanonicalIdentity & { file: string; exists: boolean };
  /** Every screen already recorded, keyed by identity. Deterministic, rebuilt each run. */
  pageIndex: PageIndex;
  /** Knowledge files pulled in because they answered a gap the selection had missed. */
  rescuedKnowledge: string[];
  /** Where the agent should write knowledge if it has to explore. The canonical path. */
  suggestedKnowledgeFile: string;
  budget: ContextBudget;
  index: FrameworkIndex;
}

/** Everything a person authored about the row, lowercased, as one haystack. */
function haystack(testCase: TestCase): string {
  return [
    testCase.module, testCase.feature, testCase.scenario, testCase.description,
    testCase.preconditions, testCase.steps.join(' '), testCase.testData,
    testCase.expectedResult, testCase.tags.join(' '), testCase.source.worksheet,
  ].filter(Boolean).join(' ').toLowerCase();
}

/** `openCreateNewTeamForm` -> ['open','create','new','team','form'] */
function words(identifier: string): string[] {
  return identifier
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(word => word.length > 2)
      .map(word => word.toLowerCase());
}

/** Words too common in this domain to be evidence of anything. */
const STOPWORDS = new Set([
  'page', 'the', 'and', 'for', 'with', 'test', 'https', 'field', 'button',
  'open', 'click', 'check', 'verify', 'user', 'form', 'area', 'shared', 'behaviour',
  'every', 'object', 'signed', 'code', 'not', 'get', 'set', 'new', 'this', 'that',
]);

/**
 * Score one Page Object against the row.
 *
 * Three signals, weighted by how specific they are. A class-name stem hit
 * ("login" for LoginPage) is the strongest, because that is how the row names its
 * screen. A method-name hit is next: a row saying "create new team" matching
 * `openCreateNewTeamForm` is precisely the evidence wanted. Purpose words are
 * weakest and only break ties.
 */
function score(className: string, entry: FrameworkIndex['pages'][string], hay: string): { score: number; why: string[] } {
  const why: string[] = [];
  let total = 0;

  // LoginPage -> 'login', ProjectsPage -> 'projects' and 'project'.
  const stem = className.replace(/Page$/, '').toLowerCase();
  for (const candidate of new Set([stem, stem.replace(/s$/, '')])) {
    if (candidate.length > 2 && hay.includes(candidate)) {
      total += 10;
      why.push(`row mentions "${candidate}"`);
      break;
    }
  }

  const methodHits = entry.methods
      .map(method => ({ method: method.name, hits: words(method.name).filter(word => !STOPWORDS.has(word) && hay.includes(word)) }))
      .filter(entry => entry.hits.length >= 2);
  if (methodHits.length) {
    total += Math.min(9, methodHits.length * 3);
    why.push(`methods match: ${methodHits.slice(0, 3).map(hit => `${hit.method}()`).join(', ')}`);
  }

  const purposeHits = words(entry.purpose).filter(word => !STOPWORDS.has(word) && hay.includes(word));
  if (purposeHits.length) {
    total += Math.min(4, purposeHits.length);
    why.push(`purpose matches: ${[...new Set(purposeHits)].slice(0, 3).join(', ')}`);
  }

  return { score: total, why };
}

/**
 * Split a spec file into its module-level header and its top-level tests.
 *
 * Line-based rather than brace-counting on purpose: braces inside strings,
 * template literals and regex literals make counting wrong in exactly the files
 * that matter, and generated specs are a flat list of top-level `test(` calls, so
 * the structure needed is only "where does each one start".
 *
 * The header is everything before the first test - imports *and* module-level
 * constants. That matters: TC_LOGIN_025's language table is a file-level const,
 * and a rewrite that saw only the imports would recreate it.
 */
export interface SpecShape {
  /** Everything before the first test: imports, module constants, the describe opener. */
  header: string;
  tests: Array<{ testCaseId: string | null; title: string; body: string }>;
  /** Everything after the last test - the describe's closing brace. */
  footer: string;
}

/**
 * A line that starts a test.
 *
 * Any indentation, because these specs wrap their tests in `test.describe(...)`
 * and the tests inside are indented - matching only column zero found the describe
 * itself, called it the single test in the file, and produced an "excerpt" that was
 * the entire file. `test.describe`, `test.setTimeout`, the hooks and `test.use` are
 * excluded by name; `test.only`/`skip`/`fixme` are real tests and are included.
 */
function isTestStart(line: string): boolean {
  if (/^\s*test\s*\(/.test(line))
    return true;
  return /^\s*test\.(?:only|skip|fixme)\s*\(/.test(line);
}

export function parseSpec(source: string): SpecShape {
  const lines = source.split('\n');
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (isTestStart(lines[index]))
      starts.push(index);
  }

  /** Walk back over the doc comment and blank lines that belong to this test. */
  const withComment = (start: number): number => {
    let first = start;
    let index = start - 1;
    // A JSDoc block immediately above, possibly separated by nothing.
    if (index >= 0 && /^\s*\*\/\s*$/.test(lines[index])) {
      while (index >= 0 && !/^\s*\/\*/.test(lines[index]))
        index--;
      if (index >= 0)
        first = index;
    } else {
      while (index >= 0 && /^\s*\/\//.test(lines[index])) {
        first = index;
        index--;
      }
    }
    return first;
  };

  const shape: SpecShape = { header: '', tests: [], footer: '' };
  if (!starts.length) {
    shape.header = source;
    return shape;
  }

  shape.header = lines.slice(0, withComment(starts[0])).join('\n').trimEnd();

  for (let position = 0; position < starts.length; position++) {
    const from = withComment(starts[position]);
    const to = position + 1 < starts.length ? withComment(starts[position + 1]) : lines.length;
    const body = lines.slice(from, to).join('\n').trimEnd();
    const title = /^\s*test(?:\.\w+)?\s*\(\s*['"`]([^'"`]+)['"`]/m.exec(body)?.[1] ?? '';
    shape.tests.push({
      testCaseId: /\b((?:TC|TS)[_-][A-Za-z0-9_-]+)\b/.exec(title)?.[1] ?? null,
      title,
      body,
    });
  }

  // The last test's slice runs to EOF, so the describe's closing brace is inside
  // it. Split it back off: an excerpt has to be a syntactically complete file, or
  // the agent gets shown code that could not compile and matches it.
  const last = shape.tests[shape.tests.length - 1];
  const closing = /\n(\}\s*\)\s*;?\s*)$/.exec(last.body);
  if (closing) {
    last.body = last.body.slice(0, closing.index).trimEnd();
    shape.footer = closing[1].trimEnd();
  }
  return shape;
}

/**
 * The slice of an existing spec file worth showing, and why.
 *
 * Replacing a test: its own block, which is the thing being rewritten.
 * Adding to a file that already has tests: the shortest existing block, purely as
 * a pattern to match - conventions are learned faster from one real example in
 * this repo than from any amount of description.
 */
function specExcerptFor(specFile: string, testCaseId: string): { text: string; note: string } | null {
  const absolute = path.resolve(ROOT, specFile);
  if (!fs.existsSync(absolute))
    return null;

  const shape = parseSpec(fs.readFileSync(absolute, 'utf8'));
  if (!shape.tests.length)
    return null;

  const others = (count: number) => count === 1 ? '1 other test' : `${count} other tests`;
  const assemble = (body: string) =>
    [shape.header, '', body, ...(shape.footer ? ['', `  // ... ${others(shape.tests.length - 1)} omitted ...`, shape.footer] : [])]
        .join('\n');

  const mine = shape.tests.find(entry => entry.testCaseId?.toUpperCase() === testCaseId.toUpperCase());
  if (mine) {
    return {
      text: assemble(mine.body),
      note: `${specFile} — its module-level header and ONLY the ${testCaseId} test, which is the one ` +
        `you are rewriting. ${others(shape.tests.length - 1)} in this file are not shown and must ` +
        'not change.',
    };
  }

  const shortest = [...shape.tests].sort((a, b) => a.body.length - b.body.length)[0];
  return {
    text: assemble(shortest.body),
    note: `${specFile} — its module-level header and one existing test ` +
      `(${shortest.testCaseId ?? 'untitled'}) as a pattern to follow. ${others(shape.tests.length - 1)} ` +
      'are not shown. Add your test alongside them; do not modify them.',
  };
}

/**
 * The one file this row's screen may be recorded in.
 *
 * This used to be a slug of the row's feature or module, and it was only ever a
 * *suggestion* - which is how Phase 4's benchmark ended up with `dashboard.yaml` and
 * `dashboard-tabs.yaml` describing the same screen on two runs. The name is now
 * derived, not chosen: the route of the knowledge already selected for this row, or
 * failing that the best-matching Page Object.
 *
 * A row whose screen has no knowledge yet has no route to derive from either - the
 * route is a fact about a page nobody has looked at. The Page Object fallback covers
 * that, and once the file exists its own declared route becomes authoritative for
 * every later row.
 */
function canonicalPageFor(
  testCase: TestCase,
  selected: KnowledgeMatch[],
  pages: SelectedSource[],
  pageIndex: PageIndex,
): CanonicalIdentity & { file: string; exists: boolean } {
  // Which of the selected files is the screen this row is ON, rather than one it
  // merely shares vocabulary with. Score alone gets this wrong: TC_PROJ_005 ("enter
  // three spaces as the project name") scored the sign-in page above /apps, because
  // words like "spaces" and "three" appear in its prose - and a knowledge file written
  // for that row would have landed on the wrong screen's file.
  //
  // Whether the row starts signed in is the discriminator, and it is already decided
  // deterministically for the session grouping. A signed-in row is not on the sign-in
  // page.
  // The TEST's starting state, deliberately - not the exploration browser's.
   // Which screen this row is ABOUT does not change because a browser was signed
   // in to read it: a login row is still on the sign-in page even when the
   // framework authenticated the browser that read the application for it.
  const wantsAuth = authRequirement(testCase).testStartsSignedIn;
  const preferred = selected.find(match => match.knowledge.authenticationRequired === wantsAuth)
    ?? selected[0];
  const route = preferred?.knowledge.route;
  const pageObject = pages[0]?.file.split('/').pop()?.replace(/\.page\.ts$/, '');
  const identity = canonicalIdentity({
    route,
    pageId: preferred?.knowledge.id || testCase.feature?.trim() || testCase.module?.trim(),
    pageObject: pageObject ? `${pageObject}Page` : undefined,
  });
  const existing = pageIndex.byCanonicalId.get(identity.id)?.[0];
  return {
    ...identity,
    file: existing?.file ?? canonicalFile(identity.id),
    exists: Boolean(existing),
  };
}

export interface SelectOptions {
  testCase: TestCase;
  /** Repo-relative path the spec will be written to. */
  specFile: string;
  /** Character count of the fixed instruction text, for the budget. */
  instructionChars: number;
  /** Character count of the row's own facts, for the budget. */
  testCaseChars: number;
  /** Size of what Claude Code loads by itself. */
  autoLoadedChars: number;
}

export function selectContext(options: SelectOptions): ContextSelection {
  const index = buildIndex();
  const hay = haystack(options.testCase);
  const brief = fs.existsSync(BRIEF_FILE) ? fs.readFileSync(BRIEF_FILE, 'utf8') : '';
  const frameworkIndexYaml = toYaml(index);

  const ranked = Object.entries(index.pages)
      .filter(([name]) => name !== 'Base')
      .map(([name, entry]) => ({ name, entry, ...score(name, entry, hay) }))
      .sort((a, b) => b.score - a.score);

  const chosen = ranked.filter(candidate => candidate.score >= 10).slice(0, MAX_PAGES);
  const pages: SelectedSource[] = chosen.map(candidate => ({
    file: candidate.entry.file,
    approxTokens: candidate.entry.approxTokens,
    reason: candidate.why.join('; '),
  }));

  // base.page.ts only travels with a Page Object, because `resolve()` and the
  // candidate-strategy shape live there and a spec extending a Page Object needs
  // them. On its own it is 250 tokens of no use.
  if (pages.length && index.pages.Base) {
    pages.push({
      file: index.pages.Base.file,
      approxTokens: index.pages.Base.approxTokens,
      reason: 'base class of the selected Page Object(s)',
    });
  }

  const selectedFiles = new Set(pages.map(source => source.file));
  const omitted: SelectedSource[] = [
    ...Object.entries(index.pages).map(([name, entry]) => ({ name, entry })),
    ...Object.entries(index.support).map(([name, entry]) => ({ name, entry })),
  ]
      .filter(candidate => !selectedFiles.has(candidate.entry.file))
      .map(candidate => ({
        file: candidate.entry.file,
        approxTokens: candidate.entry.approxTokens,
        reason: 'not referenced by this row',
      }));

  const excerpt = specExcerptFor(options.specFile, options.testCase.testCaseId);

  // Page knowledge, and whether it removes the need for a browser. Assessed
  // against the methods the framework already offers as well as the knowledge
  // itself: a term explained by an existing Page Object method is not a gap.
  const allMethods = Object.values(index.pages).flatMap(entry => entry.methods.map(method => method.name));
  const allKnowledge = readAllPageKnowledge();
  const pageIndex = buildPageIndex(allKnowledge);
  const pageKnowledge = selectPageKnowledge(options.testCase, allKnowledge);
  const sufficiency = assessSufficiency(options.testCase, pageKnowledge, allMethods);

  // A "rescue" pass lived here briefly and was removed after being measured: for
  // every gap term, it pulled in any *unselected* knowledge file whose raw text
  // contained that word, on the theory that a gap another file answers is a selection
  // miss rather than a reason to browse. Matching one word anywhere in a file - prose
  // and comments included - is exactly the loose matching Phase 3 removed, and the
  // price was a whole file: it pushed TC_LOGIN_022, 023 and 025 from ~14.8k tokens to
  // ~16.6k, over the budget, to explain single words. Consolidating knowledge by route
  // achieves the same thing honestly, because the file that answers the term now IS
  // the file for that screen.
  const rescuedKnowledge: string[] = [];

  // THE RECORDED-TEST BRANCH. Deliberately the only thing that differs, and it is
  // one decision: a recorded row does not open a browser to rediscover what the
  // recording already saw.
  //
  // A person drove the real application, signed in, and the actions and assertions
  // they produced are in this row. Sending an agent to open the same application and
  // look at the same screens is not caution, it is repeating finished work - and it
  // was expensive in exactly the way that matters: a browser launch, a sign-in it
  // could not complete because it has no credentials, and a case that ended by
  // asking a person for a password.
  //
  // Everything else is untouched. The quality gate still runs, the spec is still
  // written against Page Objects, and a row WITHOUT the tag - every Excel and
  // hand-authored case - takes the original path with no change whatsoever.
  const recorded = isRecordedTags(options.testCase.tags);
  const browserNeed = recorded
    ? {
      required: false,
      gaps: [],
      dismissed: sufficiency.gaps,
      inspectable: [],
      reason: 'recorded: a person performed these steps in the real application, so the '
        + 'recording IS the browser evidence - there is nothing to rediscover',
    }
    : assessBrowserNeed(sufficiency);
  const pageKnowledgeTokens = pageKnowledge.reduce((total, match) => total + match.knowledge.approxTokens, 0);
  const canonicalPage = canonicalPageFor(options.testCase, pageKnowledge, pages, pageIndex);
  const suggestedKnowledgeFile = canonicalPage.file;

  const briefTokens = approxTokens(brief.length);
  const frameworkIndexTokens = approxTokens(frameworkIndexYaml.length);
  const specExcerptTokens = excerpt ? approxTokens(excerpt.text.length) : 0;
  const instructionTokens = approxTokens(options.instructionChars);
  const testCaseTokens = approxTokens(options.testCaseChars);
  const promptTokens = briefTokens + frameworkIndexTokens + specExcerptTokens
    + instructionTokens + testCaseTokens + pageKnowledgeTokens;
  const directedReadTokens = pages.reduce((total, source) => total + source.approxTokens, 0);
  const autoLoadedTokens = approxTokens(options.autoLoadedChars);
  const controlledTokens = promptTokens + directedReadTokens;
  const limit = budgetTokens();

  return {
    brief,
    frameworkIndexYaml,
    pages,
    specExcerpt: excerpt?.text ?? null,
    specExcerptNote: excerpt?.note ?? null,
    omitted,
    pageKnowledge,
    sufficiency,
    browserNeed,
    origin: { recorded, signedInDuringRecording: recorded && wasSignedInTags(options.testCase.tags) },
    canonicalPage,
    pageIndex,
    rescuedKnowledge,
    suggestedKnowledgeFile,
    index,
    budget: {
      testCaseTokens, briefTokens, frameworkIndexTokens, specExcerptTokens, instructionTokens,
      pageKnowledgeTokens,
      promptTokens, directedReadTokens, autoLoadedTokens, controlledTokens,
      totalContextTokens: controlledTokens + autoLoadedTokens,
      budgetTokens: limit,
      overBudget: controlledTokens > limit,
    },
  };
}

/** A one-screen summary of the selection, for the run log. */
export function describeSelection(selection: ContextSelection): string {
  const budget = selection.budget;
  const knowledge = selection.pageKnowledge.length
    ? [
      `    page knowledge: ${selection.sufficiency.verdict.toUpperCase()} - ` +
        `${selection.pageKnowledge.map(match => match.knowledge.file).join(', ')} ` +
        `(~${budget.pageKnowledgeTokens} tok)`,
      ...(selection.rescuedKnowledge.length
        ? [`      also pulled in (answers a gap the scoring missed): ${selection.rescuedKnowledge.join(', ')}`]
        : []),
      ...(selection.sufficiency.gaps.length
        ? [`      unverified: ${selection.sufficiency.gaps.join(', ')}`]
        : ['      every requirement is certainly covered']),
      // The audit trail. Verbose, and worth it: this is the only place that says
      // WHY a browser visit was judged unnecessary.
      describeDecisions(selection.sufficiency),
      `    browser needed: ${selection.browserNeed.required ? 'YES' : 'NO'} - ${selection.browserNeed.reason}`,
      ...selection.browserNeed.gaps
          .filter(gap => gap.kind === 'not-inspectable')
          .map(gap => `      dismissed ${gap.term.padEnd(14)} ${gap.reason}`),
      `    canonical page: ${selection.canonicalPage.id} (${selection.canonicalPage.reason})` +
        ` -> ${selection.canonicalPage.file}${selection.canonicalPage.exists ? '' : ' (does not exist yet)'}`,
      describeDuplicates(selection.pageIndex).trimEnd(),
    ].filter(Boolean)
    : [
      `    page knowledge: NONE - explore once, then write ${selection.suggestedKnowledgeFile}`,
      `    canonical page: ${selection.canonicalPage.id} (${selection.canonicalPage.reason})`,
      `    browser needed: ${selection.browserNeed.required ? 'YES' : 'NO'} - ${selection.browserNeed.reason}`,
    ];

  const lines = [
    '  context selected deterministically:',
    ...knowledge,
    ...selection.pages.map(source =>
      `    read  ${source.file} (~${source.approxTokens} tok) - ${source.reason}`),
    ...(selection.pages.length ? [] : ['    read  (no Page Object matched this row - the agent may search)']),
    selection.specExcerpt
      ? `    inline spec excerpt (~${budget.specExcerptTokens} tok)`
      : '    inline no existing spec for this module - using the brief\'s skeleton',
    `    omitted ${selection.omitted.length} framework file(s), ` +
      `~${selection.omitted.reduce((total, source) => total + source.approxTokens, 0)} tok not sent`,
    `  context budget: ${budget.controlledTokens}/${budget.budgetTokens} tok` +
      `${budget.overBudget ? '  OVER BUDGET' : ''}` +
      `  (prompt ${budget.promptTokens} + directed reads ${budget.directedReadTokens}` +
      `; CLAUDE.md adds ~${budget.autoLoadedTokens} automatically)`,
  ];
  return `${lines.join('\n')}\n`;
}
