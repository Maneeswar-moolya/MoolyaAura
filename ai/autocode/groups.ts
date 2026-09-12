/**
 * Which rows can share one browser.
 *
 * `surveyWork` decides *what* needs generating. This decides which of those rows
 * can be generated against the same browser session, and it is the same kind of
 * decision: bookkeeping, so it belongs in code rather than in a model's judgement.
 *
 * A session may be shared only when every one of these agrees:
 *
 *   application + environment   the base URL. A session is never shared across
 *                               environments, so two of them cannot be confused
 *                               for one another.
 *   authentication requirement  signed-in rows and signed-out rows do not mix -
 *                               see below, this is the one that actually bites.
 *   authentication identity     one account exists, so this is constant today.
 *                               The key carries it anyway, so the day a second
 *                               account appears the sessions separate by
 *                               themselves rather than silently blending.
 *   worksheet                   the workbook's own grouping of "same area of the
 *                               application". One sheet per module is the normal
 *                               layout here, so this is the component signal the
 *                               spreadsheet actually carries.
 *
 * Feature is used to ORDER rows inside a group, not to split it. Splitting on it
 * would put TC_LOGIN_022..025 in four groups of one and give back everything this
 * phase is for; ordering achieves what matters, which is that consecutive rows
 * land on the same screen so the browser is already there.
 *
 * The worksheet rather than the Module column, and that is not a preference - it
 * is a bug that was measured. Keying on `module || worksheet` split
 * TC_LOGIN_022..025 into two groups, because TC_LOGIN_024 has its Module cell
 * filled in ("Login") and its three neighbours on the same sheet, testing the same
 * screen, leave it blank. Falling back from one namespace to another means two
 * rows are "different modules" purely because somebody typed in one cell. The
 * sheet is what every row on it agrees about.
 *
 * TWO QUESTIONS, NOT ONE
 *
 * "Signed in?" was one boolean and it was answering two different questions:
 *
 *   testStartsSignedIn    does the TEST begin already signed in? It governs what
 *                         the generated spec must do and which screen the row is
 *                         about. A row that signs in as its subject starts out.
 *
 *   explorationNeedsAuth  must the GENERATION BROWSER be signed in before the
 *                         agent reads the application? It governs one thing: the
 *                         state of a browser nobody ships.
 *
 * They coincide for the rows this started with, which is why one boolean lasted
 * so long, and they came apart on the first plain-English row that signed in on
 * its way somewhere else: "Sign in -> open Faclon labs -> search fac11 -> check
 * the status". Its steps sign in, so the test must sign in for itself - and its
 * subject is an issue-search screen nothing describes, which cannot be read at
 * all by a signed-out browser. The generator declined it for want of a page it
 * was never given a way to reach.
 *
 * WHY AUTHENTICATION SPLITS RATHER THAN JOINS
 *
 * A signed-in browser cannot explore the sign-in page: Bugasura bounces the base
 * URL straight to /apps. So a group is authenticated only when the rows say so
 * explicitly, and the default is signed-out. Guessing wrong in that direction
 * costs nothing (the agent behaves exactly as it did before this phase); guessing
 * wrong in the other direction breaks the exploration for every login row.
 *
 * The evidence, deliberately narrow:
 *
 *   POSITIVE - the PRECONDITIONS say the user is already signed in. That is the
 *   author stating the starting state, which is exactly the question.
 *
 *   NEGATIVE, and it overrides - the STEPS sign in, or open the sign-in page.
 *   Then signing in is part of what is being tested and the framework must not
 *   have done it first. TC_PROJ_009 reads "Open Bugasura and login..." and is
 *   correctly signed-out even though its siblings are not.
 *
 * Test Data is not read for this. `password = <valid-password>` appears on rows
 * that are *testing* the sign-in, so treating it as evidence of a signed-in
 * precondition would invert the answer on precisely the rows that matter.
 *
 * Tuned against the real workbook rather than reasoned about: of 33 rows, the 8
 * with an explicit signed-in precondition (TC_PROJ_001..008) have no sign-in
 * wording anywhere in their steps, and no row that opens the login page claims a
 * signed-in precondition.
 *
 * WHAT DECIDES THE SECOND QUESTION
 *
 * The browser must be signed in when the row has work to do BEYOND the sign-in
 * screen, and must not be when the row's subject IS the sign-in screen - the
 * application bounces an authenticated browser off `/`, so an authenticated
 * exploration cannot read the page those rows are about.
 *
 * The evidence is structural, and it is the row's own steps:
 *
 *   - a signed-in PRECONDITION says so outright;
 *   - otherwise, find the last step that PERFORMS a sign-in - submitting one,
 *     not naming the screen ("Open the login page" names it) - and ask whether
 *     any later step ACTS. An action after a sign-in happens on a screen that
 *     only exists once signed in. Steps that merely observe do not count: "click
 *     Sign In, then verify the dashboard" is a login test whose subject is still
 *     the sign-in.
 *
 * `isActionVerb`/`isObserveVerb` come from `ai/knowledge/requirements.ts` rather
 * than a second list here, because the question - "is this step doing something
 * or looking at something?" - is the one that module already answers.
 *
 * Measured over the whole workbook (76 rows): the login rows and the
 * language-picker rows that never submit stay signed out, all 8 rows with a
 * signed-in precondition are authenticated, and the 47 rows that act after
 * signing in - TC_LOGIN_064/065/066, the dashboard rows, TC_PROJ_009 - get an
 * authenticated browser to read with while their specs still sign in themselves.
 */

import { BASE_URL, explorationIdentity } from '../../tests-e2e/support/env';
import { activeApplicationId } from '../knowledge/canonical';
import { isActionVerb, isObserveVerb } from '../knowledge/requirements';
import type { TestCase } from '../excel/types';
import type { WorkItem } from './work';

/** The author stating that the browser starts signed in. */
const SIGNED_IN_PRECONDITION = /\b(?:signed|logged)\s*-?\s*in\b|\bauthenticated\b/i;

/**
 * A step that signs in, or that starts at the sign-in page.
 *
 * `login page` and `sign-in page` are included because "Open the Bugasura login
 * page" is how most of this workbook opens, and a browser already inside the
 * application cannot do it.
 */
const SIGNS_IN_ITSELF = /\b(?:log|sign)\s*-?\s*in\b|\blogs?\s*in\b|login\s*page|sign-?in\s*page/i;

/**
 * A step that SUBMITS a sign-in, as opposed to one that names the sign-in page.
 *
 * The distinction matters only for the exploration question. "Open bugasura
 * login page" then "click language options and select italian" (TC_LOGIN_058)
 * acts after naming the screen, and every one of those actions is still ON the
 * sign-in page - so the browser must stay signed out. Stripping the phrase
 * first is what tells the two apart; `login` on its own matches the sign-in
 * verb, which is why it cannot simply be tested for.
 */
const PERFORMS_SIGN_IN = /\b(?:log|sign)\s*-?\s*in\b|\blogs?\s*in\b/i;
const NAMES_THE_SIGN_IN_SCREEN = /\b(?:log\s*-?\s*in|sign\s*-?\s*in|signin|login)\s+(?:page|screen)\b/gi;

export interface Group {
  /** Stable, readable, and what the metrics record. */
  key: string;
  /** Base URL. Also the environment - one URL is one environment. */
  environment: string;
  application: string;
  /**
   * Does the TEST start signed in? Governs the generated spec and which screen
   * the row is about - never the browser.
   */
  testStartsSignedIn: boolean;
  /**
   * Does the GENERATION BROWSER need signing in before the agent reads with it?
   * This, and only this, is what `GroupSession` acts on.
   */
  explorationNeedsAuth: boolean;
  /**
   * Which account. `anonymous` when no sign-in happens, otherwise the name of the
   * variable the credentials come from - never the address itself, which would put
   * a username in every metrics record.
   */
  authIdentity: string;
  /** The worksheet these rows share. What the group is named after. */
  worksheet: string;
  /** Every module named by the rows in this group, for the log. Usually one. */
  modules: string[];
  /** Why `testStartsSignedIn` is what it is, so a wrong grouping is auditable. */
  authReason: string;
  /** Why `explorationNeedsAuth` is what it is. Printed in the run log. */
  explorationReason: string;
  items: WorkItem[];
}

/** What this row needs of the test, and of the browser that reads for it. */
export interface AuthRequirement {
  /** Does the TEST begin signed in? */
  testStartsSignedIn: boolean;
  /** Does the EXPLORATION BROWSER need to be signed in? */
  explorationNeedsAuth: boolean;
  testReason: string;
  explorationReason: string;
}

/** Does this step submit a sign-in, rather than merely name the sign-in screen? */
function performsSignIn(step: string): boolean {
  return PERFORMS_SIGN_IN.test(step.replace(NAMES_THE_SIGN_IN_SCREEN, ' '));
}

/** The first verb of a step that decides whether it does something or looks. */
function stepActs(step: string): boolean {
  const words = step.toLowerCase().replace(/^[\s\d.)\-:]+/, '').split(/[^a-z]+/).filter(Boolean);
  for (const word of words) {
    if (isObserveVerb(word))
      return false;
    if (isActionVerb(word))
      return true;
  }
  return false;
}

/** Does the browser have work to do beyond the sign-in screen? */
function explorationRequirement(testCase: TestCase): { required: boolean; reason: string } {
  if (SIGNED_IN_PRECONDITION.test(testCase.preconditions ?? ''))
    return { required: true, reason: 'the preconditions state the user is already signed in' };

  let signedInAt = -1;
  testCase.steps.forEach((step, index) => {
    if (performsSignIn(step))
      signedInAt = index;
  });
  if (signedInAt < 0) {
    return {
      required: false,
      reason: 'no step signs in, so nothing here is behind a sign-in',
    };
  }
  for (let index = signedInAt + 1; index < testCase.steps.length; index++) {
    if (stepActs(testCase.steps[index])) {
      return {
        required: true,
        reason: `step ${index + 1} acts after the sign-in, so the screen it acts on is behind it`,
      };
    }
  }
  return {
    required: false,
    reason: 'the steps sign in and then only observe, so the sign-in screen is the subject',
  };
}

/**
 * Does this row start already signed in, and does reading it need a signed-in
 * browser? Two questions, answered separately and conservatively.
 */
export function authRequirement(testCase: TestCase): AuthRequirement {
  const steps = testCase.steps.join('\n');
  const preconditions = testCase.preconditions ?? '';
  const exploration = explorationRequirement(testCase);

  const test = SIGNS_IN_ITSELF.test(steps)
    ? {
      required: false,
      reason: 'the steps sign in or open the sign-in page, so signing in is part of the test',
    }
    : SIGNED_IN_PRECONDITION.test(preconditions)
      ? { required: true, reason: 'the preconditions state the user is already signed in' }
      : { required: false, reason: 'no precondition states a signed-in starting point' };

  return {
    testStartsSignedIn: test.required,
    explorationNeedsAuth: exploration.required,
    testReason: test.reason,
    explorationReason: exploration.reason,
  };
}

/** The component this row is about, for ordering within a group. */
function screenOf(testCase: TestCase): string {
  return (testCase.feature || '~').toLowerCase();
}

/**
 * Split the work into groups that may each share one browser.
 *
 * Order is deterministic throughout - groups by key, rows by screen then by the
 * row number they came from - so two runs over the same workbook group and
 * sequence identically, and a benchmark is comparable to the one before it.
 */
export function groupWork(items: WorkItem[]): Group[] {
  // IDENTITY IS DECLARED, NOT PARSED OUT OF THE URL. This read
  // `new URL(BASE_URL).host`, which is a host name wearing the word `application`:
  // two applications behind one host would have shared a grouping key, and one
  // application on a staging domain would have had two. `environment` stays the base
  // URL, which is what a base URL genuinely is.
  const environment = BASE_URL;
  const application = activeApplicationId();

  const groups = new Map<string, Group>();
  for (const item of items) {
    const auth = authRequirement(item.testCase);
    const worksheet = item.testCase.source.worksheet.trim() || '(none)';
    // The NAME of the variable the account comes from, never the account. A row
    // whose browser stays signed out is `anonymous`, as it has always been.
    const identity = auth.explorationNeedsAuth ? explorationIdentity() : 'anonymous';
    const key = `${application}|${auth.testStartsSignedIn ? 'test-auth' : 'test-anon'}`
      + `|${auth.explorationNeedsAuth ? 'explore-auth' : 'explore-anon'}|${identity}|${worksheet}`;

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, {
      key, environment, application,
      testStartsSignedIn: auth.testStartsSignedIn,
      explorationNeedsAuth: auth.explorationNeedsAuth,
      authIdentity: identity,
      worksheet,
      modules: [],
      authReason: auth.testReason,
      explorationReason: auth.explorationReason,
      items: [item],
    });
  }

  const ordered = [...groups.values()].sort((left, right) => left.key.localeCompare(right.key));
  for (const group of ordered) {
    group.items.sort((left, right) => {
      const byScreen = screenOf(left.testCase).localeCompare(screenOf(right.testCase));
      return byScreen !== 0 ? byScreen : left.testCase.source.row - right.testCase.source.row;
    });
    group.modules = [...new Set(group.items.map(item => item.testCase.module.trim()).filter(Boolean))];
  }
  return ordered;
}

/** One line per group, for the run log. */
export function describeGroups(groups: Group[]): string {
  const lines = [`  ${groups.length} generation group(s):`];
  for (const group of groups) {
    // The modules are printed only when they add something the sheet name does
    // not already say - which is exactly the case where somebody filled the Module
    // cell on some rows and not others, and would otherwise wonder why they share
    // a group.
    const spans = group.modules.filter(module => module !== group.worksheet);
    lines.push(`    ${group.worksheet} — ${group.items.length} row(s), ` +
      `test starts ${group.testStartsSignedIn ? 'signed in' : 'signed out'} (${group.authReason})` +
      `, exploration browser ${group.explorationNeedsAuth
        ? `signed in as ${group.authIdentity}` : 'signed out'} (${group.explorationReason})` +
      `${spans.length ? `, modules: ${spans.join(', ')}` : ''}`);
    lines.push(`      ${group.items.map(item => item.testCase.testCaseId).join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}
