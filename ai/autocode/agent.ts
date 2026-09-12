/**
 * Running Claude Code headlessly to write one spec.
 *
 * The agent gets file tools and a browser, and nothing else:
 *
 *   Read Write Edit Glob Grep          to read the repo and write the spec
 *   Bash(node ai/autocode/browse.mjs)  to drive Bugasura and see real selectors
 *
 * **No general shell.** An agent that can run arbitrary commands unattended, on
 * a prompt whose subject matter comes out of a spreadsheet, is a much bigger
 * thing to trust than one that can write a file and drive a browser. So the Bash
 * grant is scoped to a single script, and that script is an allow-list: see
 * `browse.mjs` for what it refuses and why each refusal is there.
 *
 * This used to be an MCP server - this repo's own `cli.js` - which allowed the
 * browser tools to be enumerated by name and `Bash` to be denied outright. That
 * was strictly tighter, and it was removed on request in favour of one code path
 * rather than two. The trade is recorded next to BROWSE_SCRIPT so nobody has to
 * rediscover it: with a shell grant the allow-list cannot be tool names, and
 * `Bash` cannot be denied without taking the browser away with it.
 *
 * `--strict-mcp-config` with an empty server list keeps whatever MCP servers the
 * user happens to have configured out of an unattended run.
 *
 * The prompt is a fixed template. The only interpolated values are a test case
 * ID checked against the workbook and paths this module computed. Workbook
 * *prose* still reaches the model - it has to, it is the requirement - so the
 * standing assumption is that a spreadsheet cell may contain instructions, and
 * the containment for that is everything downstream: no shell, a spec that must
 * survive falsification before it counts, nothing committed, nothing promoted.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { type ContextBudget, type ContextSelection, describeSelection, selectContext } from './context';
import { credentialsFixtureName } from './abstraction/writer';
import { toPromptBlock as pageIndexBlock } from '../knowledge/canonical';
import type { BrowserNeed, SufficiencyResult } from '../knowledge/page-knowledge';
import { autoLoadedChars, BROWSE_LOG, BROWSE_LOG_ENV, CASE_ID_ENV, RUN_ID_ENV } from './metrics';
import { explorationRequest, toPromptBlock } from '../knowledge/page-knowledge';
import type { Handover } from './session';
import { MANAGED_ENV } from './session';
import type { TestCase } from '../excel/types';
import { activeScope } from '../projects/scope';

const ROOT = process.cwd();

/**
 * The Claude Code binary, resolved to a real executable.
 *
 * `spawn('claude', ...)` fails on Windows with ENOENT: what is on PATH there is
 * a `.cmd` shim, and only a shell can run one. Using `shell: true` to work
 * around that would put a prompt built from spreadsheet text through a command
 * interpreter, which is the one thing this whole subsystem must not do. The
 * package ships a real binary, so find that and keep `shell: false`.
 *
 * `CLAUDE_CLI` overrides everything, for an install this does not know about.
 */
export function resolveClaude(): string | null {
  if (process.env.CLAUDE_CLI && fs.existsSync(process.env.CLAUDE_CLI))
    return process.env.CLAUDE_CLI;

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const roots = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'node_modules') : '',
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    home ? path.join(home, '.npm-global', 'lib', 'node_modules') : '',
    path.join(ROOT, 'node_modules'),
  ].filter(Boolean);

  for (const root of roots) {
    for (const binary of ['claude.exe', 'claude']) {
      const candidate = path.join(root, '@anthropic-ai', 'claude-code', 'bin', binary);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
        return candidate;
    }
  }

  // Native installer, and the plain-file case on macOS and Linux.
  for (const candidate of [home ? path.join(home, '.claude', 'local', 'claude') : '', '/usr/local/bin/claude']) {
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate;
  }

  // On anything but Windows a bare name on PATH is executable as-is.
  return process.platform === 'win32' ? null : 'claude';
}

/**
 * The model that writes the specs, pinned rather than inherited.
 *
 * Without `--model` the headless run resolves whatever the machine's Claude Code
 * config happens to say, so the same workbook generated different-quality specs
 * on two laptops and nothing recorded which. Sonnet is the default because the
 * work is narrow and heavily constrained - one file, a fixed prompt, a spec that
 * has to survive falsification - and the gate, not the model, is what makes an
 * accepted spec trustworthy.
 *
 * The full ID rather than the `sonnet` alias, which floats to whatever the
 * newest Sonnet is: a spec that passed the gate on one model is not evidence
 * about another, and the point of pinning is that the log says what actually
 * wrote each file.
 *
 * `AUTOCODE_MODEL` overrides it - `opus` for a row that keeps getting
 * quarantined, or another dated ID to compare two models over one workbook.
 */
export const DEFAULT_MODEL = 'claude-sonnet-5';

export function resolveModel(): string {
  return process.env.AUTOCODE_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * Repo-relative path of the guarded wrapper the agent explores through.
 *
 * This is the generator's only route to a browser and the only command it is
 * granted. There is deliberately no MCP alternative and no switch to one: the
 * generator used to run this repo's own MCP server (`cli.js`) and that path was
 * removed rather than left configurable, so there is exactly one code path to
 * reason about instead of two with different containment.
 *
 * Note what that costs, because it is not nothing. Under MCP the browser
 * allow-list was thirteen tool names and `Bash` could be denied outright. A shell
 * grant cannot name tools - `Bash(node ... browse.mjs:*)` would match a
 * `run-code` subcommand as happily as `snapshot` - and `Bash` cannot be denied
 * here either, because a deny outranks the scoped grant and would leave the agent
 * with no browser at all. So the allow-list lives inside `browse.mjs`, and the
 * containment is: one narrowly scoped command, plus whatever that script refuses.
 */
export const BROWSE_SCRIPT = 'ai/autocode/browse.mjs';

/**
 * Tools the generator may use. Anything absent is denied, not prompted - the
 * allow-list is exhaustive, so there is no need to restate absences below.
 */
const ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep',
  `Bash(node ${BROWSE_SCRIPT}:*)`,
];

/**
 * Belt to the allow-list's braces.
 *
 * The two `mcp__` entries name tools that no longer exist in this configuration,
 * and they are kept for exactly that reason: they cost nothing and they still bite
 * if somebody reintroduces a server here later, which is precisely the edit that
 * would otherwise hand back arbitrary page control without anyone noticing.
 *
 * `Bash` is NOT in this list and must not be added: it would outrank the scoped
 * grant above and leave the generator unable to open a browser.
 *
 * THE CREDENTIAL FILE. `Read` and `Grep` are granted unscoped, so until Phase 4
 * the generator could simply read `.env` - verified, not assumed: a headless run
 * with this exact tool configuration was asked to and answered READ_OK. Nothing
 * needed it to. Tests reach credentials through the fixtures at *run* time, and
 * since Phase 4 the framework signs the generation browser in itself, so the agent
 * has no use for the file at all. Both routes to it are denied, and both denials
 * were verified the same way (READ_DENIED for `Read`, READ_DENIED for `Grep`).
 *
 * **`Read(...)` rules only, and that is not an oversight.** `Grep(.env)` and
 * `Glob(.env)` were in this list first, and Claude Code rejected them at startup
 * with "not matched by file permission checks - only Read(path) rules are. Use
 * Read(.env) instead (Read rules cover all file-reading tools)." So a `Read` rule
 * is what denies Grep as well; naming Grep separately printed a warning on every
 * single generation and protected nothing. `.env.*` covers `.env.local` and
 * friends.
 */
const DISALLOWED_TOOLS = [
  'mcp__playwright__browser_run_code_unsafe',
  'mcp__playwright__browser_file_upload',
  'Read(.env)', 'Read(./.env)', 'Read(**/.env)', 'Read(.env.*)', 'Read(**/.env.*)',
];

/**
 * An empty server list, always.
 *
 * Not omitted - passed empty and paired with `--strict-mcp-config`, which is what
 * actually guarantees no MCP server is reachable, including any the person
 * running this happens to have configured for their own interactive use.
 */
export function mcpConfig(): string {
  return JSON.stringify({ mcpServers: {} });
}

export interface GenerateRequest {
  testCase: TestCase;
  /** Repo-relative path the spec must be written to. */
  specFile: string;
  /** Repo-relative workbook path, so the agent can re-read the row itself. */
  workbook: string;
  /** True when a previous spec for this row is being replaced. */
  replacing?: string;
  /**
   * Identifies this run in the metrics records. Passed into the agent's
   * environment so `browse.mjs` can stamp its own log lines and the browser
   * commands can be attributed to this case rather than correlated on time.
   */
  runId: string;
}

/** Where the agent records a case it will not write a spec for. */
export const CHANGE_REQUESTS = path.resolve(ROOT, 'ai', 'reports', 'test-case-change-requests.md');

/**
 * The row itself. Measured separately, because the whole point of Phase 2 is that
 * this - the only part that differs between cases - was 0.5% of the context.
 */
export function rowFacts(request: GenerateRequest): string {
  const testCase = request.testCase;
  const optional = (label: string, value: string) => (value.trim() ? [`${label}: ${value.trim()}`] : []);
  return [
    `Workbook: ${request.workbook}`,
    `Worksheet: ${testCase.source.worksheet}, row ${testCase.source.row}`,
    `Test Case ID: ${testCase.testCaseId}`,
    `Module: ${testCase.module || '(none)'}`,
    `Feature: ${testCase.feature || '(none)'}`,
    `Scenario: ${testCase.scenario}`,
    // Business intent, and what the row is FOR. Both were parsed and neither was
    // ever sent: the generator was told what to do and never why, which is the
    // half that decides what an assertion should actually prove.
    ...optional('Description', testCase.description),
    ...optional('Requirement', testCase.requirementId),
    `Priority: ${testCase.priority || '(none)'}`,
    ...optional('Test Type', testCase.testType),
    ...optional('Business Risk', testCase.businessRisk),
    ...optional('Tags', testCase.tags.join(', ')),
    // Execution context. `Authentication Profile` is a NAME and nothing else -
    // the account's address and password stay in the environment, the framework
    // signs the browser in, and the agent is told plainly it does not have them.
    ...optional('Environment', testCase.environment),
    ...optional('User Role', testCase.userRole),
    ...optional('Authentication Profile', testCase.authenticationProfile),
    ...optional('Test Owner', testCase.testOwner),
    `Preconditions: ${testCase.preconditions || '(none)'}`,
    'Steps:',
    ...testCase.steps.map((step, index) => `  ${index + 1}. ${step}`),
    `Test Data: ${testCase.testData || '(none)'}`,
    `Expected Result: ${testCase.expectedResult}`,
  ].join('\n');
}

/**
 * The fixed instruction block: identical on every case.
 *
 * Note what is NOT here any more. It used to open with "Follow
 * .claude/skills/excel-automation/SKILL.md and CLAUDE.md. Read them first", and
 * both halves of that were wrong:
 *
 *   CLAUDE.md is loaded into the agent's context by Claude Code automatically -
 *   verified, it answers questions about it with no tool call - so the instruction
 *   bought a second ~7,700-token copy of something already there.
 *
 *   SKILL.md is not auto-loaded (also verified: only its description is), but most
 *   of it governs parsing workbooks, running suites, healing and reporting. None of
 *   that is this agent's job. The parts that are have moved to ai/knowledge/brief.md.
 *
 * The hard requirements stay verbatim: they are what the gate checks, and softening
 * the instruction while leaving the check would only produce more quarantine.
 */
/**
 * The browser crib, in the two shapes it can take.
 *
 * Without a handover this is unchanged from before Phase 4: open a browser,
 * explore, close it. With one, the framework has already opened the browser and -
 * if the group needs it - signed it in, so the agent is told plainly that `open`
 * and `close` are refused and why. The refusal is real, in `browse.mjs`; this text
 * exists so the agent does not have to discover it by being refused.
 *
 * The credential sentence is deliberate. "You are signed in and you do not have
 * the credentials" is a true statement of the containment, and it stops the agent
 * hunting for a password it must not find.
 */
/**
 * What a recorded row is told, and why it is short.
 *
 * The recording is finished browser work. The agent is told that plainly, told not
 * to repeat it, and - the part that actually caused the pain - told that
 * authentication is a solved problem in this framework so it must never go looking
 * for credentials or ask anybody for them.
 *
 * Empty for every other row: an Excel or hand-authored case sees exactly the prompt
 * it saw before, byte for byte.
 */
function recordedBlock(origin: { recorded: boolean; signedInDuringRecording: boolean }): string[] {
  if (!origin.recorded)
    return [];

  const lines = [
    '===== THIS CASE WAS RECORDED =====',
    'A person performed these steps in the real application and Playwright captured them.',
    'The Steps and Expected Result below are that recording, written down.',
    '',
    'So the browser work is DONE. Do not open a browser to see what these screens look',
    'like, do not re-walk the flow, and do not verify that the recorded steps are',
    'possible - somebody just did them. Write the spec from the Page Objects the',
    'framework index names, exactly as you would for any other row.',
  ];

  if (origin.signedInDuringRecording) {
    lines.push(
        '',
        'The recording included a SIGN-IN. That is why the steps mention entering an email',
        'and a password: it is a record of what happened, not data for you to use. The',
        'credentials were never captured - the value is stored as `[type=password]`.',
        '',
        'Your spec must authenticate the way every other authenticated spec in this repo',
        `does: guard with \`requireCredentials(${credentialsFixtureName() ?? 'appCredentials'})\`, then sign in through`,
        'the existing fixtures and Page Object. That mechanism reads the git-ignored .env',
        'at run time.',
        '',
        '**Never ask anyone for a password or an email address, and never write one into a',
        'spec.** If you find yourself wanting credentials, the answer is always the existing',
        'fixture - it is already wired up and every authenticated test here uses it.');
  }
  return [...lines, ''];
}

function browserCrib(handover: Handover | null, withheld: WithheldBrowser | null, baseUrl: string): string[] {
  if (!handover && withheld) {
    return [
      'THERE IS NO BROWSER THIS RUN, and that is a decision, not an oversight.',
      `Reason: ${withheld.reason}`,
      ...(withheld.unverified.length
        ? [
          `The page knowledge above does not literally spell out: ${withheld.unverified.join(', ')}.`,
          'Those were checked and are words about relations, moments or manner - "above", "on',
          'arrival", "marked" - not features a browser could be opened to look at. Everything this',
          'row actually touches is described above.',
        ]
        : []),
      'So: write the spec from the Page Object methods the knowledge names. Do not guess a',
      'selector that is not in it.',
      '',
      'If you are convinced you cannot write this row without seeing the application, DO NOT',
      'invent selectors and do not write a weaker assertion. Decline the row (below) and say',
      'exactly what you needed to look at. That is a correct outcome and it is cheap to redo;',
      'a spec built on a guess is neither.',
    ];
  }

  const commands = [
    `  node ${BROWSE_SCRIPT} snapshot            # refs (e12) to target with`,
    `  node ${BROWSE_SCRIPT} snapshot --depth=4  # cheaper on a big page`,
    `  node ${BROWSE_SCRIPT} find "Sign in"      # search instead of dumping it all`,
    `  node ${BROWSE_SCRIPT} goto ${JSON.stringify(baseUrl)}`,
    `  node ${BROWSE_SCRIPT} click e12           # or a CSS selector, or getByRole(...)`,
    `  node ${BROWSE_SCRIPT} fill e5 "text"`,
    `  node ${BROWSE_SCRIPT} --raw eval "document.querySelectorAll('.x').length"`,
    `  node ${BROWSE_SCRIPT} generate-locator e5 --raw   # a Playwright locator for a ref`,
  ];

  if (!handover) {
    return [
      'Open the configured application and read the real DOM before you write selectors. Guessing',
      'selectors is the main reason generated tests fail. Your browser is a CLI,',
      'driven ONLY through this script - no other shell command is available to you:',
      `  node ${BROWSE_SCRIPT} open ${JSON.stringify(baseUrl)}`,
      ...commands,
      `  node ${BROWSE_SCRIPT} close               # do this when you are finished`,
      'The session is one browser that persists between commands, so `open` once.',
      'It is a real browser on a live application: it holds state between your',
      'commands, so read a fresh snapshot after anything that navigates or reloads',
      'rather than assuming the page you last saw is still there.',
      '`run-code`, `upload`, `attach` and the storage-state commands are refused by',
      'that script. If you think you need one, you do not - decline the case instead.',
    ];
  }

  return [
    'A BROWSER IS ALREADY OPEN FOR YOU, and it is the only one you get. Read the real',
    'DOM through it before you write selectors - guessing selectors is the main reason',
    'generated tests fail. It is driven ONLY through this script; no other shell',
    'command is available to you:',
    ...commands,
    '',
    `The browser is on ${handover.url}`,
    ...(handover.signedIn
      ? [
        'It is ALREADY SIGNED IN as the test account. Do not sign in, do not look for',
        'credentials - you do not have them, and you do not need them.',
        '',
        'BUT THE SPEC YOU WRITE GETS A FRESH BROWSER, SIGNED OUT. This browser being',
        'signed in is a convenience for READING the application; it is not the state',
        'your test will run in. Your spec must sign in for itself - guard on',
        '`requireCredentials`, sign in through `loginPage`/the fixtures the way the',
        'existing specs for authenticated screens do, and only then act on the screen.',
        'A spec that goes straight to an authenticated page will sit on the sign-in',
        'page and fail, which is exactly what happened to the first two specs written',
        'against a handed-over session.',
      ]
      : ['It is signed out, which is where this test case starts.']),
    '`open`, `close` and `delete-data` are REFUSED while this session is managed:',
    '`open` would destroy this browser (and its sign-in) rather than reuse it, and',
    '`close` would take it away from the next test case in this group. Start with',
    '`snapshot` or `goto`, and leave the browser roughly where you found it.',
    'It holds state between your commands, so read a fresh snapshot after anything',
    'that navigates or reloads rather than assuming the page you last saw is there.',
    '`run-code`, `upload`, `attach` and the storage-state commands are refused too.',
    'If you think you need one, you do not - decline the case instead.',
  ];
}

/**
 * Why no browser was opened, when the framework decided one was not needed.
 *
 * Carried into the prompt so the agent is told the decision and its reason rather
 * than discovering that its browser commands fail.
 */
export interface WithheldBrowser {
  reason: string;
  /** Requirement terms the knowledge does not literally cover, all dismissed as prose. */
  unverified: string[];
}

export function instructions(
  request: GenerateRequest,
  handover: Handover | null = null,
  withheld: WithheldBrowser | null = null,
): string {
  const testCase = request.testCase;
  const scope = activeScope();
  const mutationPermission = `${scope.applicationId.toUpperCase().replace(/-/g, '_')}_ALLOW_DATA_MUTATION`;
  const mutating = process.env[mutationPermission] === '1';

  return [
    'WRITE THE SPEC TO EXACTLY THIS PATH, creating or editing only this file:',
    `  ${request.specFile}`,
    request.replacing
      ? `This replaces the ${request.replacing} entry for this row, which is out of date because the ` +
        'row was edited. The current version is shown above; keep whatever is still correct.'
      : '',
    '',
    'Hard requirements, all of them checked mechanically after you finish:',
    `  1. The test title is exactly: ${testCase.testCaseId} - ${testCase.scenario}`,
    '  2. The test calls trace({ testCaseId, module, scenario, sourceWorkbook, sourceWorksheet, priority }).',
    '  3. It contains at least one real expect() on application state.',
    '  4. Every assertion must be able to FAIL. Your spec is run twice: once as',
    '     written (it must pass) and once with its assertions mechanically',
    '     mutated (it must then fail). A test that passes both times asserts',
    '     nothing and is thrown away, so do not assert things that are true on',
    '     any page - assert what THIS case is about.',
    '  5. Import from the existing fixtures and Page Objects in tests-e2e/.',
    '     Add a locator to a Page Object rather than inlining a brittle selector.',
    '',
    ...browserCrib(handover, withheld, scope.baseUrl),
    mutating
      ? `Data-mutating flows are permitted this run (${mutationPermission}=1). Gate any test`
        + ` that creates data with requireDataMutationOptIn(process.env.${mutationPermission} === '1')`
        + ' from tests-e2e/support/base-fixtures.'
      : 'Data-mutating flows are NOT permitted this run. If this case can only be tested by creating' +
        ' or changing data, decline it (below) rather than writing a test that will skip.',
    '',
    'If this case should NOT become a written spec - because it would be better',
    'as a data-driven row, because the workbook row is ambiguous, or because you',
    `cannot determine what to assert - then do NOT write ${request.specFile}.`,
    `Instead append a short section to ${path.relative(ROOT, CHANGE_REQUESTS).replace(/\\/g, '/')}`,
    `naming ${testCase.testCaseId} and saying plainly what you need from the author.`,
    'Declining is a correct outcome. A test that checks nothing is not.',
    // Scope and git safety are stated once, in the brief. Repeating them here is
    // the duplication this phase exists to remove.
  ].filter(Boolean).join('\n');
}

/**
 * Assemble the prompt from the row, the brief, the index and the selected slice.
 *
 * Order is deliberate: rules first, then the framework it must work inside, then
 * the row, then what to do with it. The row sits late so the last thing before the
 * instructions is the thing the instructions are about.
 */
function buildPrompt(
  request: GenerateRequest,
  selection: ContextSelection,
  handover: Handover | null,
  withheld: WithheldBrowser | null,
): string {
  const blocks = [
    'You are writing ONE Playwright test for ONE row of a test case workbook, unattended.',
    '',
    '===== AUTOMATION BRIEF (the rules; CLAUDE.md is already in your context) =====',
    selection.brief.trim(),
    '',
    '===== FRAMEWORK INDEX (metadata only - open a file when you need detail) =====',
    selection.frameworkIndexYaml.trim(),
    '',
    // Before the knowledge itself: it says which file a screen lives in, so the agent
    // cannot invent a second name for one that already has a file.
    pageIndexBlock(selection.pageIndex, selection.canonicalPage),
    '',
    // Knowledge before the file list: whether a browser is needed at all changes
    // what the agent does with everything below.
    selection.pageKnowledge.length
      ? toPromptBlock(selection.pageKnowledge, selection.sufficiency)
      : explorationRequest(request.testCase, selection.suggestedKnowledgeFile),
    '',
    selection.pages.length
      ? [
        'Relevant to THIS row, already identified for you - read these and nothing else',
        'unless the index turns out to be wrong:',
        ...selection.pages.map(source => `  ${source.file}   (${source.reason})`),
        '',
        'Do NOT start by searching the repository. The index above is generated from it',
        'and is current. Grep only if something the index promised is genuinely missing.',
      ].join('\n')
      : [
        'No Page Object matched this row, so there may be no coverage for this screen yet.',
        'Check the index above first; if nothing fits, search tests-e2e/pages/ before',
        'creating anything new.',
      ].join('\n'),
    '',
    // Before the row itself, so the agent knows what kind of row it is reading.
    ...recordedBlock(selection.origin),
    ...(selection.specExcerpt
      ? [
        '===== EXISTING SPEC (the relevant part only) =====',
        selection.specExcerptNote ?? '',
        '```ts',
        selection.specExcerpt.trim(),
        '```',
        '',
      ]
      : []),
    '===== THE TEST CASE =====',
    rowFacts(request),
    '',
    '===== WHAT TO DO =====',
    instructions(request, handover, withheld),
  ];
  return blocks.filter(block => block !== '').join('\n');
}

export interface AgentResult {
  exitCode: number | null;
  log: string;
  timedOut: boolean;
  /** Measured around the spawn, for the metrics record. */
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /**
   * Size of the prompt this attempt was actually given. Exact - it is our own
   * string - and the only token figure here that is not an estimate.
   */
  promptChars: number;
  /** The deterministic context selection and its budget, for the metrics record. */
  budget: ContextBudget;
  /** Files the prompt named for reading. Recorded so a bad selection is auditable. */
  selectedFiles: string[];
  /** Page knowledge that was inlined, and the verdict on whether it was enough. */
  pageKnowledgeFiles: string[];
  sufficiency: SufficiencyResult;
  /** Whether a browser was actually needed, and why. Not the same as the verdict. */
  browserNeed: BrowserNeed;
  /** The one file this row's screen resolves to. */
  canonicalPage: { id: string; file: string; exists: boolean };
  rescuedKnowledge: string[];
  knowledgeDuplicates: number;
  /**
   * The browser this attempt was handed, or null when it needed none.
   *
   * Null is the good case: page knowledge answered the row, so no browser was
   * opened for it at all.
   */
  handover: Handover | null;
}

/**
 * Run the generator for one case.
 *
 * `onLog` receives output as it arrives so the dashboard can stream it; the
 * full text is also returned for the run record.
 */
export async function generate(
  request: GenerateRequest,
  options: {
    timeoutMs?: number;
    onLog?: (text: string) => void;
    /**
     * Called ONLY when this row actually needs a browser, i.e. page knowledge did
     * not cover it. Returns the group's live, prepared session.
     *
     * Lazy on purpose: page knowledge stays the first optimisation, and a session
     * being available is not a reason to open one. A group whose every row is
     * answered by knowledge launches no browser at all.
     *
     * It may throw `SessionUnavailable`, which the caller treats as an
     * infrastructure problem rather than a verdict about the row.
     */
    ensureSession?: () => Promise<Handover>;
  } = {},
): Promise<AgentResult> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;

  // Selection happens here, before the prompt exists: the instruction and row
  // blocks are built first so their sizes can go into the budget, then the
  // selector decides what else the prompt carries.
  const select = (handover: Handover | null, withheld: WithheldBrowser | null) => selectContext({
    testCase: request.testCase,
    specFile: request.specFile,
    instructionChars: instructions(request, handover, withheld).length,
    testCaseChars: rowFacts(request).length,
    autoLoadedChars: autoLoadedChars(),
  });

  // Two passes, because the two decisions depend on each other: the browser is
  // only opened if the knowledge verdict says one is needed, and the instruction
  // text - which is part of the measured budget - depends on whether a browser was
  // handed over. Selection is deterministic and costs ~10 ms, so running it again
  // is cheaper and more honest than recording a budget for a prompt never sent.
  // The browser is opened for what the row actually needs, not for the verdict.
  // Phase 4 opened one whenever the knowledge was less than `sufficient`, so a
  // `partial` row whose only gaps were words like "arrival" and "above" paid ~6.5 s
  // of launch and a sign-in to look for things that are not on any screen.
  const probe = select(null, null);
  let handover: Handover | null = null;
  if (probe.browserNeed.required && options.ensureSession)
    handover = await options.ensureSession();

  // Withheld deliberately, as opposed to simply absent: the agent is told which
  // terms went unverified and why none of them was worth a browser, so it can
  // decline if it disagrees rather than guessing a selector.
  const withheld: WithheldBrowser | null = handover || !options.ensureSession
    ? null
    : { reason: probe.browserNeed.reason, unverified: probe.browserNeed.dismissed };

  const selection = handover ? select(handover, null) : probe;
  options.onLog?.(describeSelection(selection));
  if (handover) {
    options.onLog?.(`  browser: ${handover.reused ? 'REUSED' : 'opened'} ${handover.sessionId}` +
      `${handover.signedIn ? ', signed in' : ''}` +
      `${handover.authenticationReuse ? ' (sign-in reused)' : ''}` +
      `${handover.startupMs !== null ? `, startup ${handover.startupMs} ms` : ''}` +
      `${handover.authMs !== null ? `, sign-in ${handover.authMs} ms` : ''}` +
      `${handover.resetActions.length ? `, reset: ${handover.resetActions.join('; ')}` : ''}\n`);
  } else if (!probe.browserNeed.required) {
    options.onLog?.(`  browser: none opened - ${probe.browserNeed.reason}\n`);
  }
  if (selection.budget.overBudget) {
    options.onLog?.(`  NOTE: this case is over the ${selection.budget.budgetTokens}-token context ` +
      'budget. Generating anyway - the budget measures, it does not gate.\n');
  }

  // argv array, shell:false, exactly as the dashboard spawns Playwright.
  //
  // The prompt goes in on STDIN, not as an argument. It used to be `-p <prompt>`,
  // which worked while the prompt was ~4 KB and died with `spawn ENAMETOOLONG` the
  // moment Phase 2 and 3 started inlining the brief, the framework index, the page
  // knowledge and a spec excerpt into it: Windows caps an entire command line at
  // ~32,767 characters and the prompt alone had reached ~31,000. Verified that
  // `claude -p` with no prompt argument reads it from stdin, which has no such
  // ceiling - so context can grow on its merits rather than against an OS limit.
  const prompt = buildPrompt(request, selection, handover, withheld);
  const args = [
    '-p',
    '--model', resolveModel(),
    '--permission-mode', 'acceptEdits',
    '--allowed-tools', ...ALLOWED_TOOLS,
    '--disallowed-tools', ...DISALLOWED_TOOLS,
    '--mcp-config', mcpConfig(),
    '--strict-mcp-config',
    '--add-dir', ROOT,
  ];

  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const measured = (
    extra: Omit<AgentResult,
      'startedAt' | 'finishedAt' | 'durationMs' | 'promptChars' | 'budget' | 'selectedFiles'
      | 'pageKnowledgeFiles' | 'sufficiency' | 'handover' | 'browserNeed' | 'canonicalPage'
      | 'rescuedKnowledge' | 'knowledgeDuplicates'>,
  ): AgentResult => ({
    ...extra,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    promptChars: prompt.length,
    budget: selection.budget,
    selectedFiles: selection.pages.map(source => source.file),
    pageKnowledgeFiles: selection.pageKnowledge.map(match => match.knowledge.file),
    sufficiency: selection.sufficiency,
    handover,
    browserNeed: selection.browserNeed,
    canonicalPage: {
      id: selection.canonicalPage.id,
      file: selection.canonicalPage.file,
      exists: selection.canonicalPage.exists,
    },
    rescuedKnowledge: selection.rescuedKnowledge,
    knowledgeDuplicates: selection.pageIndex.duplicates.length,
  });

  const binary = resolveClaude();
  if (!binary) {
    return measured({
      exitCode: null, timedOut: false,
      log: 'Could not find the Claude Code binary. Install it, or set CLAUDE_CLI to its full path.\n',
    });
  }

  return new Promise<AgentResult>(resolve => {
    const child = spawn(binary, args, {
      cwd: ROOT,
      shell: false,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        // Read by ai/autocode/browse.mjs, which is a grandchild of this process.
        // Telemetry only: the agent's own tools cannot read the environment,
        // since Bash is scoped to that one script.
        [RUN_ID_ENV]: request.runId,
        [CASE_ID_ENV]: request.testCase.testCaseId,
        [BROWSE_LOG_ENV]: BROWSE_LOG,
        // Turns on browse.mjs's extra refusals for the life of this attempt.
        //
        // Set for BOTH cases, for different reasons. With a handover, `open` would
        // destroy the browser the handover points at. With the browser deliberately
        // withheld, a self-opened browser would be signed out and the agent has no
        // credentials - so it could only waste seven seconds and learn nothing. The
        // refusal is recorded as `browseRefused`, which is exactly the signal that a
        // dismissal was wrong.
        //
        // NOT set when there is no session mechanism at all, because then the agent's
        // own `open` is the only browser there is and refusing it would leave it blind.
        ...(options.ensureSession ? { [MANAGED_ENV]: '1' } : {}),
      },
      // stdin carries the prompt and is then closed immediately. It must be
      // closed: left open, the agent waits for input that will never come and
      // the 15-minute timeout becomes the normal case.
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.on('error', () => {
      // EPIPE if the child died before the prompt was fully written; the exit
      // handler below reports that far more usefully than a stream error would.
    });
    child.stdin.end(prompt, 'utf8');

    let log = '';
    let timedOut = false;
    const collect = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      log += text;
      options.onLog?.(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.on('error', error => {
      clearTimeout(timer);
      resolve(measured({ exitCode: null, log: `${log}\nCould not start claude: ${(error as Error).message}\n`, timedOut }));
    });
    child.on('close', exitCode => {
      clearTimeout(timer);
      resolve(measured({ exitCode, log, timedOut }));
    });
  });
}

/** True when the agent recorded a decision not to write this case. */
export function declined(testCaseId: string): boolean {
  if (!fs.existsSync(CHANGE_REQUESTS))
    return false;
  return fs.readFileSync(CHANGE_REQUESTS, 'utf8').includes(testCaseId);
}
