/**
 * One browser, one sign-in, for a whole group of compatible rows.
 *
 * The problem this solves is not that the Playwright CLI cannot hold a browser
 * open. It can, and it always could: the session is a detached daemon keyed by
 * name, and any later process naming the same session drives the same browser.
 * `browse.mjs` has pinned that name to `autocode` since it was written, so the
 * agent's twenty snapshots already ran against one browser.
 *
 * What was not reused was the browser *between cases*. Every generation was its
 * own headless Claude Code process, each told to `open` at the start and `close`
 * at the end, and each therefore paying for a browser launch and - for anything
 * behind the sign-in page - working out how to sign in and doing it. Four
 * compatible rows meant four launches and four sign-ins.
 *
 * Two facts make this file necessary rather than optional, and both were measured
 * rather than assumed:
 *
 *   `open` on a live session DESTROYS it. The CLI's own startSession stops the
 *   existing daemon before starting a new one - verified by watching the pid
 *   change (27444 -> 21772) while the URL reset. So a framework-held session is
 *   not merely wasted if the agent calls `open`, it is *gone*, along with the
 *   sign-in. That is why `browse.mjs` refuses `open` while a session is managed.
 *
 *   The cost being removed is real but bounded: browser startup ~6 s, sign-in
 *   ~15 s, shutdown ~2.5 s. See ai/reports/generation-performance.md - the
 *   larger saving is that the agent no longer spends model turns discovering
 *   how to sign in, which shows up in agentMs, not here.
 *
 * WHO AUTHENTICATES, AND WHY IT IS NOT THE AGENT
 *
 * This module signs in; the agent receives a browser that is already signed in
 * and is told it does not have the credentials. Credentials are read through
 * `tests-e2e/support/env`, the same module the suite uses - there is no second
 * secret path - and they reach the CLI as one argv element of a child process
 * spawned with `shell: false`. They are never written to the prompt, the run log,
 * the metrics, the session log, page knowledge or a generated spec.
 *
 * The one exposure that remains is local and is stated plainly rather than
 * papered over: for the moment a `fill` runs, the value is an argument of a
 * child process and is therefore visible to anything on this machine that can
 * read process command lines. That was equally true when the agent signed itself
 * in, so this is not a regression - but it is not zero either. The alternative
 * (sign in with Playwright in-process, save storage state, `state-load` it) was
 * rejected: it would introduce a second browser mechanism, which this phase is
 * explicitly not allowed to do, and it would put a live session cookie on disk,
 * which is the thing `browse.mjs` refuses `state-save` in order to prevent.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  BASE_URL, explorationCredentials, explorationIdentity,
  MISSING_EXPLORATION_CREDENTIALS_REASON,
} from '../../tests-e2e/support/env';
import type { Group } from './groups';
import { SESSION_LOG } from './metrics';
import { declaredOverlays, type Overlay } from '../knowledge/page-knowledge';

const ROOT = process.cwd();

/**
 * The session name. Must match the one pinned inside `browse.mjs`, because the
 * whole point is that the agent's commands land in the browser this file opened.
 */
export const SESSION_NAME = 'autocode';

/**
 * Set in the agent's environment when a framework session has been handed over.
 * `browse.mjs` reads it and refuses the commands that would destroy the session.
 */
export const MANAGED_ENV = 'AUTOCODE_SESSION_MANAGED';

/** How long to wait for Bugasura to complete its own post-sign-in navigation. */
const AUTH_TIMEOUT_MS = 45_000;

/**
 * Whether a session lives for a whole group, or for one row.
 *
 * `AUTOCODE_PERSISTENT_SESSION=0` (or `off`, or `false`) shortens the lifetime to a
 * single case: the framework still opens the browser and still signs it in, then
 * closes it before the next row. That is the before-and-after benchmark, and it is
 * the escape hatch if a live application ever turns out to dislike a browser being
 * reused between cases.
 *
 * It deliberately does NOT switch the framework's sign-in off, and that is a
 * correction rather than a design flourish. The first version omitted the session
 * entirely when this was off, which - now that `.env` is denied to the agent - left
 * an authenticated row with no route to credentials at all: Benchmark A's third row
 * failed for exactly that reason, the agent explaining that it had no way to sign
 * in and asking what to do. Denying the credential file makes framework sign-in
 * mandatory, not optional, so the only thing this flag may vary is how long the
 * browser lives.
 */
export function persistentSessionEnabled(): boolean {
  const raw = process.env.AUTOCODE_PERSISTENT_SESSION?.trim().toLowerCase();
  return raw !== '0' && raw !== 'off' && raw !== 'false';
}

/**
 * Selectors copied from `tests-e2e/pages/login.page.ts`, not invented here.
 *
 * They cannot be *called* from here: a Page Object needs a Playwright `Page`,
 * and this drives a browser that lives in another process. So the leading
 * structural candidate of each locator is duplicated, deliberately and with the
 * source named, rather than a new set being guessed at.
 *
 * `#loginForm` scoping is load-bearing for the same reason it is there: the
 * sign-up and reset forms are mounted at the same time. `.login-submit` rather
 * than the accessible name, because that is the candidate that survives the UI
 * being in another language - which a language test case may well have left it in.
 */
const EMAIL_FIELD = '#loginForm input[type="email"]';
const PASSWORD_FIELD = '#loginForm input[type="password"]';
const SUBMIT_BUTTON = '#loginForm .login-submit';

/**
 * The signed-in test inside the probe is `LoginPage.isOnLoginPage()` inverted, for
 * the reason recorded there: a VISIBLE password field inside `#loginForm`. Counting
 * hidden ones never reaches zero, because `#createUserForm` carries its own.
 */

export interface Handover {
  /** Logical id of the browser this case was given. Changes when one is discarded. */
  sessionId: string;
  /** True when the browser was opened for an earlier case in this group. */
  reused: boolean;
  /** Browser launch, measured only for the case that paid for it. */
  startupMs: number | null;
  /** Sign-in, measured only for the case that paid for it. */
  authMs: number | null;
  /** Sign-ins performed while preparing this case. 0 when it inherited one. */
  authenticationAttempts: number;
  /** True when this case inherited a sign-in it did not perform. */
  authenticationReuse: boolean;
  /**
   * Browser shutdown paid for while preparing this case - i.e. a session
   * discarded as expired, contaminated or dead. Null when nothing was discarded.
   *
   * The group's FINAL close is not here and cannot be: it happens after the last
   * case's record is written. It lands on the run record's per-group summary.
   */
  shutdownMs: number | null;
  /** Sessions thrown away before this case got its browser. */
  sessionsDiscarded: number;
  url: string;
  signedIn: boolean;
  /** True when the checkpoint found the browser in a state the row did not expect. */
  contaminated: boolean;
  /** What the reset actually did, in order. Empty when nothing needed doing. */
  resetActions: string[];
}

/** The group's browser could not be made ready. Never a verdict about the row. */
export class SessionUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionUnavailable';
  }
}

interface CliResult {
  ms: number;
  code: number | null;
  /** Kept in memory for this module's own decisions. Never logged. */
  out: string;
}

/** One record per framework browser command. Subcommand and argument COUNT only. */
function logCommand(runId: string, groupKey: string, command: string, argc: number, result: CliResult): void {
  try {
    fs.mkdirSync(path.dirname(SESSION_LOG), { recursive: true });
    fs.appendFileSync(SESSION_LOG, `${JSON.stringify({
      runId, groupKey, at: new Date(Date.now() - result.ms).toISOString(),
      ms: result.ms, command, argc, exitCode: result.code,
    })}\n`, 'utf8');
  } catch {
    // Telemetry must never stop a browser the generator is waiting on.
  }
}

/**
 * Resolve Playwright's own CLI entry point.
 *
 * Off the package root rather than as `playwright/cli`, because the package's
 * `exports` map does not expose that subpath - the same resolution `browse.mjs`
 * uses and for the same reason.
 */
function playwrightCli(): string {
  return path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
}

/**
 * The framework's own browser commands go straight to the Playwright CLI, NOT
 * through `browse.mjs`.
 *
 * Two reasons, both deliberate. `browse.mjs` exists to contain the *agent*; this
 * module is the framework and is the thing doing the containing. And its browse
 * log is the evidence for "the agent opened no browser" - putting the framework's
 * own `open` in there would corrupt exactly the measurement Phase 3 established.
 * Framework commands are logged separately, to `generation-session.jsonl`.
 */
function cli(runId: string, groupKey: string, args: string[]): CliResult {
  const started = Date.now();
  // argv array, shell:false - the rule this whole subsystem follows, and the
  // reason a credential can be an argument at all: nothing is ever concatenated
  // into a command line for an interpreter to re-split.
  const child = spawnSync(process.execPath, [playwrightCli(), 'cli', `-s=${SESSION_NAME}`, ...args], {
    cwd: ROOT, shell: false, encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const result: CliResult = {
    ms: Date.now() - started,
    code: child.status,
    out: `${child.stdout ?? ''}${child.stderr ?? ''}`,
  };
  // The command name, never the arguments: a `fill` carries a password.
  logCommand(runId, groupKey, args.find(arg => !arg.startsWith('-')) ?? '(none)', args.length - 1, result);
  return result;
}

interface ProbeResult {
  alive: boolean;
  url: string;
  onLoginPage: boolean;
  /** Names of declared overlays that are visible right now. */
  overlays: string[];
}

/**
 * One page evaluation that answers every checkpoint question at once.
 *
 * Built from the overlays the knowledge files declare, so what counts as "blocking
 * UI" grows with what has been explored rather than with a list in this file. The
 * selectors are interpolated as JSON strings into a function body - they come from
 * knowledge files in this repo, not from a workbook, and `eval` runs in the page's
 * own context where a bad selector throws harmlessly and is reported as not visible.
 */
function probeScript(overlays: Overlay[]): string {
  const declared = JSON.stringify(overlays.map(overlay => ({ name: overlay.name, selector: overlay.selector })));
  return '() => { ' +
    'const field = document.querySelector(\'#loginForm input[type="password"]\'); ' +
    `const declared = ${declared}; ` +
    'const visible = declared.filter(entry => { try { ' +
    'const node = document.querySelector(entry.selector); ' +
    'return !!node && node.offsetParent !== null; } catch { return false; } }).map(entry => entry.name); ' +
    'return JSON.stringify({ url: location.href, ' +
    'onLoginPage: !!field && field.offsetParent !== null, overlays: visible }); }';
}

/** A browser that cannot answer the probe. Named so the three exits read the same. */
const DEAD: ProbeResult = { alive: false, url: '', onLoginPage: false, overlays: [] };

/**
 * Is the browser still on the application?
 *
 * The origin, not the path: a row may legitimately be anywhere inside the app, but
 * a browser sitting on a third-party page (the terms of service open in a tab, say)
 * is not somewhere the next row can start. This is what makes an in-place "no
 * sign-in form is showing" reading mean "signed in" rather than "somewhere else".
 */
function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(BASE_URL).origin;
  } catch {
    return false;
  }
}

export interface SessionStats {
  browsersOpened: number;
  authentications: number;
  /** Cases handed a browser somebody else opened. The number this phase is about. */
  reuseCount: number;
  /** Sessions thrown away as expired, contaminated or dead. */
  discarded: number;
  /** Cases whose checkpoint found the browser in an unexpected state. */
  contaminated: number;
  /** Cases where a safe, declared reset put it right without a new browser. */
  reset: number;
  /** Every close this group paid for: each discard, plus the final one. */
  shutdownMs: number;
}

/**
 * The browser for one compatible group.
 *
 * Opened lazily, on the first case that actually needs it. A group whose every
 * row is answered by page knowledge never launches a browser at all - page
 * knowledge stays the first optimisation, and having a session available is not
 * a reason to use one.
 */
export class GroupSession {
  private readonly runId: string;
  private readonly group: Group;
  private readonly onLog: (text: string) => void;
  private open = false;
  private incarnation = 0;
  private signedIn = false;
  private stats: SessionStats = {
    browsersOpened: 0, authentications: 0, reuseCount: 0, discarded: 0,
    contaminated: 0, reset: 0, shutdownMs: 0,
  };
  /**
   * Blocking UI the knowledge files declare, read once per group.
   *
   * Once, not per case: a knowledge file written mid-group would not be picked up
   * until the next group, which is a fair trade for not re-reading the directory
   * before every checkpoint.
   */
  private readonly overlays: Overlay[];

  constructor(options: { runId: string; group: Group; onLog?: (text: string) => void }) {
    this.runId = options.runId;
    this.group = options.group;
    this.onLog = options.onLog ?? (() => {});
    this.overlays = declaredOverlays();
  }

  get sessionId(): string {
    return `${this.runId}/${this.group.key}#${this.incarnation}`;
  }

  summary(): SessionStats {
    return { ...this.stats };
  }

  private run(args: string[]): CliResult {
    return cli(this.runId, this.group.key, args);
  }

  /**
   * Put the browser back at the base URL and report what it finds there.
   *
   * The expensive-looking half of the invalidation check, and it is not optional:
   * "is this browser signed in?" cannot be answered from wherever the last case
   * left it. A page deep inside the application has no sign-in form on it, and
   * neither does a random third-party page - so `onLoginPage` read in place is not
   * evidence of anything. Navigating to the base URL first turns it into evidence,
   * because the application's own redirect answers the question: signed out shows
   * the sign-in form, signed in bounces to /apps.
   *
   * ~3.5 s, against ~6.5 s to launch a browser and ~13 s to sign one in. It also
   * leaves the next row where its first step says it starts ("Open the Bugasura
   * login page"), which every anonymous row in this workbook does.
   */
  private verifyStartingPoint(): ProbeResult {
    const navigated = this.run(['goto', BASE_URL]);
    if (navigated.code !== 0)
      return DEAD;
    return this.probe();
  }

  /** Where the browser is, whether a sign-in form shows, what overlays are up. */
  private probe(): ProbeResult {
    const result = this.run(['--raw', 'eval', probeScript(this.overlays)]);
    if (result.code !== 0)
      return DEAD;
    // --raw prints the returned value; the probe returns a JSON string, so it
    // arrives quoted and escaped.
    const match = /\{.*\}/s.exec(result.out.replace(/\\"/g, '"'));
    if (!match)
      return DEAD;
    try {
      const parsed = JSON.parse(match[0]) as { url: string; onLoginPage: boolean; overlays?: string[] };
      return { alive: true, url: parsed.url, onLoginPage: parsed.onLoginPage, overlays: parsed.overlays ?? [] };
    } catch {
      return DEAD;
    }
  }

  /**
   * Close blocking UI a previous case left behind, using only what the knowledge
   * declares about it.
   *
   * Returns what it did, and whether the screen came back clean. A visible overlay
   * that declares no way to close it is not something to experiment on - it is
   * reported as unrecoverable, and the caller discards the session.
   */
  private clearOverlays(showing: string[]): { actions: string[]; cleared: boolean } {
    const actions: string[] = [];
    for (const name of showing) {
      const overlay = this.overlays.find(entry => entry.name === name);
      if (!overlay?.closeSelector) {
        actions.push(`"${name}" is showing and nothing declares how to close it`);
        return { actions, cleared: false };
      }
      const clicked = this.run(['click', overlay.closeSelector]);
      actions.push(`closed "${name}"${clicked.code === 0 ? '' : ' (the click failed)'}`);
      if (clicked.code !== 0)
        return { actions, cleared: false };
    }
    // Ask again rather than assuming the click worked.
    const after = this.probe();
    if (!after.alive)
      return { actions: [...actions, 'the browser stopped responding while resetting'], cleared: false };
    if (after.overlays.length)
      return { actions: [...actions, `still showing: ${after.overlays.join(', ')}`], cleared: false };
    return { actions, cleared: true };
  }

  private launch(): number {
    let result = this.run(['open', BASE_URL]);

    // One retry, for one specific and observed reason: the CLI keeps a registry of
    // named sessions, and `open` stops whatever it finds registered before starting
    // fresh. If a previous run's daemon died without deregistering, that stop fails
    // and takes the `open` with it - exit 1 - even though the retry then succeeds,
    // because the first attempt cleared the stale entry on its way out. Seen exactly
    // once, after a killed generation run, and it cost a whole group its browser.
    //
    // Deliberately one retry and not a loop: anything that fails twice is a real
    // problem, and a loop against a live application is how you get rate-limited.
    if (result.code !== 0) {
      this.onLog(`  browser did not open (exit ${result.code}) - retrying once, ` +
        'in case a stale session was registered\n');
      result = this.run(['open', BASE_URL]);
    }
    if (result.code !== 0)
      throw new SessionUnavailable(`Could not open a browser for ${this.group.key} (exit ${result.code}).`);
    this.open = true;
    this.signedIn = false;
    this.incarnation += 1;
    this.stats.browsersOpened += 1;
    return result.ms;
  }

  /**
   * Sign in, once.
   *
   * Nothing about this is echoed to the run log: the CLI's reply to a `fill`
   * includes a page snapshot, and the value that was filled is a credential.
   * What the log gets is the outcome and how long it took.
   */
  private authenticate(): number {
    // The EXPLORATION account, which is not necessarily the account the tests
    // run as - see `explorationCredentials`. Read here, in the framework, and
    // handed to the browser as arguments; the agent is denied .env and is told
    // it does not have credentials.
    const creds = explorationCredentials();
    if (!creds) {
      // Deterministic and final. This is never turned into a question for the
      // model: an agent asked for a password is an agent looking for one.
      throw new SessionUnavailable(
          `The generation browser cannot be signed in - ${MISSING_EXPLORATION_CREDENTIALS_REASON} `
          + `(looked at ${explorationIdentity() === 'anonymous' ? 'the exploration variables' : explorationIdentity()}).`);
    }

    const started = Date.now();
    this.run(['goto', BASE_URL]);

    // Already signed in - a fresh browser in a group whose earlier case signed
    // in, or an application that remembered. Nothing to do.
    if (!this.probe().onLoginPage) {
      this.signedIn = true;
      return Date.now() - started;
    }

    this.run(['fill', EMAIL_FIELD, creds.email]);
    this.run(['fill', PASSWORD_FIELD, creds.password]);
    this.run(['click', SUBMIT_BUTTON]);

    // Bugasura navigates itself to /apps. Poll for that rather than sleeping -
    // and calling goto() while it is in flight aborts it (net::ERR_ABORTED).
    const deadline = Date.now() + AUTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = this.probe();
      if (!state.alive)
        throw new SessionUnavailable('The generation browser died while signing in.');
      if (!state.onLoginPage) {
        this.signedIn = true;
        this.stats.authentications += 1;
        return Date.now() - started;
      }
    }
    throw new SessionUnavailable(
        `Sign-in did not complete within ${AUTH_TIMEOUT_MS / 1000}s - the sign-in page is still showing. ` +
        'Either the credentials are wrong or Bugasura is not reachable.');
  }

  /** Close and forget. Used for expiry, contamination and death. */
  private discard(reason: string): void {
    if (this.open) {
      this.stats.shutdownMs += this.run(['close']).ms;
      this.open = false;
      this.signedIn = false;
      this.stats.discarded += 1;
      this.onLog(`  session discarded: ${reason}\n`);
    }
  }

  /**
   * Hand this case a browser that is ready for it.
   *
   * The order of checks is the invalidation policy:
   *
   *   dead                                   -> discard, open a new one
   *   group needs auth, sign-in page showing  -> the sign-in expired; sign in
   *                                              again IN PLACE. Discarding the
   *                                              browser as well would cost a
   *                                              launch to arrive at the same
   *                                              sign-in page.
   *   group is anonymous but the app let us in -> contaminated by the previous
   *                                              case's exploration, so the
   *                                              browser is discarded: a row whose
   *                                              first step is "open the login
   *                                              page" cannot start inside the app
   *
   * That last one is not hypothetical, and the first attempt at it was wrong.
   * Asking `this.signedIn` - a flag set when THIS module signs in - could never
   * see a sign-in performed by the agent, which is the only way it happens in an
   * anonymous group. A valid-login case signs in because that is the thing it is
   * testing. So the check reads the application's own answer instead, via
   * `verifyStartingPoint()`. Caught by a test that drove the browser through a real
   * sign-in and then asked for the next row's session.
   */
  async ensure(): Promise<Handover> {
    let startupMs: number | null = null;
    let authMs: number | null = null;
    let attempts = 0;
    const shutdownBefore = this.stats.shutdownMs;
    const discardedBefore = this.stats.discarded;

    /** What is known about the browser right now, so it is asked once per step. */
    let state: ProbeResult | null = null;
    let contaminated = false;
    const resetActions: string[] = [];

    if (this.open) {
      // THE CHECKPOINT: is this browser in the state the next row expects?
      //
      // Asked IN PLACE first, and that ordering is deliberate on both counts. It is
      // cheaper - one probe (~1.8 s) instead of a navigation and a probe (~5.5 s),
      // which is what the first version cost every reused row. And it is the only
      // point at which blocking UI the previous case left behind is still *there*: a
      // client-side modal does not survive a page load, so a checkpoint that
      // navigated first could never see one.
      //
      // What the in-place answer cannot settle is whether a browser that shows no
      // sign-in form is signed in or merely somewhere else entirely - a third-party
      // page has no sign-in form either. The origin check settles that, and drifting
      // off it is itself a reason to return to the expected page.
      state = this.probe();
      const onOrigin = state.alive && sameOrigin(state.url);

      if (!state.alive) {
        contaminated = true;
        this.discard('the browser stopped responding');
        state = null;
      } else {
        // 1. Blocking UI, cleared where it is still visible.
        if (state.overlays.length) {
          contaminated = true;
          this.onLog(`  checkpoint: blocking UI is up (${state.overlays.join(', ')}) - resetting\n`);
          const cleared = this.clearOverlays(state.overlays);
          resetActions.push(...cleared.actions);
          if (cleared.cleared) {
            this.stats.reset += 1;
            state = this.probe();
          } else {
            this.discard(`could not clear ${state.overlays.join(', ')} safely`);
            state = null;
          }
        }

        // 2. A signed-out group whose browser is inside the application was
        //    contaminated by the previous case signing in - which is what a
        //    valid-login row does on purpose. No navigation needed to know that.
        if (state && !this.group.explorationNeedsAuth && !state.onLoginPage && onOrigin) {
          contaminated = true;
          this.discard('a previous case signed in, and these rows start signed out');
          state = null;
        }

        // 3. Drifted off the application, or the sign-in lapsed: return to the
        //    expected page and ask again. This is the "return to expected page"
        //    reset, and it is the fallback rather than the default.
        if (state && (!onOrigin || (this.group.explorationNeedsAuth && state.onLoginPage))) {
          contaminated = true;
          resetActions.push(onOrigin ? 'returned to the sign-in page' : `returned from ${state.url}`);
          this.onLog('  checkpoint: not where this row starts - returning to the expected page\n');
          state = this.verifyStartingPoint();

          if (!state.alive) {
            this.discard('the browser stopped responding while being returned');
            state = null;
          } else if (this.group.explorationNeedsAuth && state.onLoginPage) {
            // The browser is fine; only the sign-in lapsed. Renewing it in place is
            // cheaper than a launch that would land on this same page.
            resetActions.push('signed in again - the session had expired');
            this.signedIn = false;
            state = null;
          } else if (!this.group.explorationNeedsAuth && !state.onLoginPage) {
            this.discard('a previous case signed in, and these rows start signed out');
            state = null;
          }
        }
      }

      if (contaminated)
        this.stats.contaminated += 1;
    }

    const reused = this.open;
    if (!this.open) {
      startupMs = this.launch();
      state = null;
    }

    if (this.group.explorationNeedsAuth && !this.signedIn) {
      authMs = this.authenticate();
      attempts = 1;
      state = null;
    }

    // Only when something changed since the last look. A reused, still-valid
    // session has already been probed above, and asking twice costs ~1.8 s a case
    // for an answer that is already in hand.
    state ??= this.probe();
    if (!state.alive)
      throw new SessionUnavailable('The generation browser is not responding after being prepared.');

    if (reused)
      this.stats.reuseCount += 1;

    const discarded = this.stats.discarded - discardedBefore;
    return {
      sessionId: this.sessionId,
      reused,
      startupMs,
      authMs,
      authenticationAttempts: attempts,
      authenticationReuse: this.group.explorationNeedsAuth && attempts === 0,
      shutdownMs: discarded ? this.stats.shutdownMs - shutdownBefore : null,
      sessionsDiscarded: discarded,
      url: state.url,
      signedIn: !state.onLoginPage && this.signedIn,
      contaminated,
      resetActions,
    };
  }

  /**
   * End the group's session.
   *
   * A browser is not left alive between groups: a different group is a different
   * environment, a different identity or a different screen, and an indefinitely
   * open browser is a resource nobody is watching. Called from a `finally`, so a
   * crashed group still closes its browser.
   */
  async close(): Promise<void> {
    if (!this.open)
      return;
    this.stats.shutdownMs += this.run(['close']).ms;
    this.open = false;
    this.signedIn = false;
  }
}
