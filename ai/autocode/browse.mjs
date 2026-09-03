/**
 * The generator's browser, when it drives one through `playwright-cli` instead
 * of this repo's MCP server.
 *
 * Why a wrapper exists at all: MCP tools are enumerable, so the generator's
 * containment could be written as a list - thirteen `browser_*` tools allowed,
 * `browser_run_code_unsafe` and `browser_file_upload` denied by name. A shell
 * grant cannot express that. `Bash(npx playwright cli:*)` matches
 * `... cli run-code "<anything>"` just as happily as `... cli snapshot`, so
 * switching to the CLI without a wrapper would silently hand back arbitrary
 * JavaScript execution in the page - the one capability the MCP configuration
 * goes out of its way to refuse.
 *
 * So the allow-list moves here. The agent is granted exactly this script, this
 * script decides what reaches Playwright, and the decision is made on an argv
 * array that was never a command string.
 *
 * It is deliberately not a general-purpose tool. It refuses anything that reads
 * the local filesystem into a page, anything that attaches to a browser the
 * person running this is already signed into, and anything that persists or
 * loads credentials - then pins the session name so a run cannot reach across
 * into a browser somebody else opened.
 *
 * Usage is the skill's usage, minus the session flag:
 *   node ai/autocode/browse.mjs open https://example.com
 *   node ai/autocode/browse.mjs snapshot --depth=4
 *   node ai/autocode/browse.mjs find "Sign in"
 *   node ai/autocode/browse.mjs close
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();

/** The session every generation runs in. Not overridable - see REFUSED_FLAGS. */
const SESSION = 'autocode';

/**
 * Telemetry: one line per invocation, so the orchestrator can say how many
 * browser commands a case cost and how long they took.
 *
 * Records the SUBCOMMAND and the number of arguments, never the arguments
 * themselves. `fill e5 "<password>"` must not become a credential sitting in a
 * report, and a URL or a search string is workbook prose. The count is enough
 * for a tool-call metric.
 *
 * Attribution comes from the environment rather than a timestamp window, because
 * this runs as a grandchild of the orchestrator and time-correlation would
 * mis-attribute anything that overlapped. Absent variables mean somebody ran this
 * by hand: log nothing and carry on.
 *
 * Failure to log is always swallowed. Telemetry must never stop a browser
 * command that the generator is waiting on.
 */
function record(command, argc, ms, exitCode, refused) {
  const file = process.env.AUTOCODE_BROWSE_LOG;
  const runId = process.env.AUTOCODE_RUN_ID;
  const testCaseId = process.env.AUTOCODE_CASE_ID;
  if (!file || !runId || !testCaseId)
    return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({
      runId, testCaseId, at: new Date(Date.now() - ms).toISOString(),
      ms, command, argc, exitCode, ...(refused ? { refused: true } : {}),
    }) + '\n', 'utf8');
  } catch {
    // Deliberately silent.
  }
}

/**
 * Subcommands refused outright, each for the same reason the MCP config refuses
 * its equivalent.
 *
 * `run-code` is `browser_run_code_unsafe`, and the line it crosses is not "runs
 * JavaScript" - `eval` does that and is allowed, exactly as MCP allows
 * `browser_evaluate`. The difference is what the code is handed: `eval` runs in
 * the page's own JS context, while `run-code` receives Playwright's `page`, i.e.
 * browser-level control - contexts, routes, permissions, other tabs. That is the
 * capability the MCP configuration refuses, so it is refused here too.
 * `upload` and `drop` are `browser_file_upload`: they read a path off this disk
 * and hand its contents to a web page, which is the shape of an exfiltration
 * whether or not anything malicious is meant by it.
 * `attach` connects to a Chrome or Edge the person at this keyboard is already
 * signed into - their real cookies, their real sessions - which is categorically
 * not what an unattended run should be able to reach.
 * `state-save` and `state-load` write and read storage-state files, i.e.
 * credentials, and the generator has no business doing either.
 */
const REFUSED_COMMANDS = new Map([
  ['run-code', 'runs arbitrary JavaScript in the page (the MCP equivalent, browser_run_code_unsafe, is denied for the same reason)'],
  ['upload', 'reads a local file into a web page'],
  ['drop', 'reads a local file into a web page'],
  ['attach', 'connects to a browser this machine is already signed into'],
  ['detach', 'only meaningful for an attached browser, which is refused'],
  ['state-save', 'writes a storage-state file, i.e. credentials'],
  ['state-load', 'loads a storage-state file, i.e. credentials'],
  ['kill-all', 'would kill browser processes this run did not start'],
  ['close-all', 'would close browser sessions this run did not start'],
]);

/**
 * Flags refused wherever they appear.
 *
 * The profile flags would put the run in a real on-disk Chrome profile, which is
 * `attach` by another route. `--session`/`-s` is refused rather than honoured so
 * that a run cannot drive a browser opened outside it; the session is pinned
 * below instead.
 */
/**
 * Refused ONLY while the framework is holding the session open for a group of
 * test cases (AUTOCODE_SESSION_MANAGED=1). Nothing here is refused otherwise, so
 * a run without a managed session behaves exactly as it always did.
 *
 * `open` is the important one, and it is not a precaution. The CLI's own
 * `startSession` STOPS an existing daemon before starting a new one - measured by
 * watching the browser pid change (27444 -> 21772) while the page reset. So an
 * `open` here does not merely waste six seconds: it destroys the browser the
 * framework signed in, silently, and the sign-in with it. The agent has no
 * credentials, so it could not recover.
 *
 * `close` and `delete-data` would take the browser away from the rest of the
 * group, or wipe its session data, for the same net effect one case later.
 *
 * This LIST GROWS the refusals; it removes none. REFUSED_COMMANDS and
 * REFUSED_FLAGS below are untouched and apply in every mode.
 */
const MANAGED_SESSION_REFUSALS = new Map([
  ['open', 'would close the browser the framework opened for this group and discard its sign-in'],
  ['close', 'would take the browser away from the other test cases in this group'],
  ['delete-data', 'would wipe the session the framework prepared'],
]);

const REFUSED_FLAGS = new Map([
  ['--persistent', 'uses a real on-disk browser profile'],
  ['--profile', 'uses a real on-disk browser profile'],
  ['--cdp', 'connects to an already-running browser'],
  ['--extension', 'connects to an already-running browser'],
  ['--config', 'would load browser configuration this script cannot vet'],
  ['-s', 'the session name is pinned to "' + SESSION + '" so a run cannot reach another browser'],
  ['--session', 'the session name is pinned to "' + SESSION + '" so a run cannot reach another browser'],
]);

function refuse(message, command = '(none)') {
  record(command, process.argv.length - 3, 0, 2, true);
  process.stderr.write(`browse.mjs refused this command: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (!args.length)
  refuse('no command given. Try `snapshot`, `goto <url>`, `click <ref>`, `close`.');

// The subcommand is the first token that is not a global flag. `--raw` and
// `--json` legitimately precede it.
const commandIndex = args.findIndex(arg => !arg.startsWith('-'));
if (commandIndex === -1)
  refuse('no subcommand found among the flags given.');

const command = args[commandIndex];
if (REFUSED_COMMANDS.has(command))
  refuse(`\`${command}\` ${REFUSED_COMMANDS.get(command)}.`, command);

if (process.env.AUTOCODE_SESSION_MANAGED === '1' && MANAGED_SESSION_REFUSALS.has(command)) {
  refuse(`\`${command}\` ${MANAGED_SESSION_REFUSALS.get(command)}. A browser is already open ` +
    'for you and is the only one you get - use `snapshot`, `find` or `goto` instead. ' +
    'Do not try to reopen it.', command);
}

for (const arg of args) {
  // Match `--profile` and `--profile=...` alike, and `-s` / `-s=name`.
  const flag = arg.split('=')[0];
  if (REFUSED_FLAGS.has(flag))
    refuse(`\`${flag}\` ${REFUSED_FLAGS.get(flag)}.`, command);
}

// Session pinned by this script, after validation, so no caller can shift it.
const forwarded = [`-s=${SESSION}`, ...args];

// argv array, shell:false - the same rule the rest of this subsystem follows.
// Nothing here is ever concatenated into a command line, so a URL or a search
// string out of a spreadsheet is only ever one argument.
// Resolved off the package root rather than as `playwright/cli`: the package's
// `exports` map does not expose that subpath, so requiring it throws
// ERR_PACKAGE_PATH_NOT_EXPORTED. `cli.js` is the package's declared bin.
const PLAYWRIGHT_CLI = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');

const startedMs = Date.now();

const child = spawn(process.execPath, [PLAYWRIGHT_CLI, 'cli', ...forwarded], {
  cwd: ROOT,
  shell: false,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '0' },
});

child.on('error', error => {
  record(command, args.length - 1, Date.now() - startedMs, null, false);
  process.stderr.write(`browse.mjs could not start Playwright: ${error.message}\n`);
  process.exit(1);
});
child.on('close', code => {
  // Recorded before exiting, so a non-zero browser command is still counted.
  record(command, args.length - 1, Date.now() - startedMs, code, false);
  process.exit(code ?? 1);
});
