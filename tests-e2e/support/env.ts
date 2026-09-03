/**
 * Environment configuration for the Bugasura suite.
 *
 * Credentials are never committed. Put them in the git-ignored .env (copy
 * .env.example), or set them in the shell, which takes precedence:
 *
 *   $env:BUGASURA_EMAIL    = "qa.user@moolya.com"
 *   $env:BUGASURA_PASSWORD = "..."
 */

// Must come first: it populates process.env before the reads below.
import './load-env';

export const BASE_URL = process.env.BUGASURA_BASE_URL ?? 'https://my.bugasura.io/';

export interface Credentials {
  email: string;
  password: string;
}

/** Returns credentials, or null when the environment has not supplied them. */
export function credentials(): Credentials | null {
  const email = process.env.BUGASURA_EMAIL;
  const password = process.env.BUGASURA_PASSWORD;
  return email && password ? { email, password } : null;
}

/**
 * The registered email on its own.
 *
 * Rejection test cases need an account that exists but a password that does
 * not, so they can run with only this - requiring the real password would gate
 * them on a secret they never use.
 */
export function registeredEmail(): string | null {
  return process.env.BUGASURA_EMAIL ?? null;
}

export const MISSING_CREDENTIALS_REASON =
  'BUGASURA_EMAIL / BUGASURA_PASSWORD are not set - skipping the authenticated part of this test case. ' +
  'Set both variables to execute it.';

export const MISSING_EMAIL_REASON =
  'BUGASURA_EMAIL is not set - this test case needs a registered email address (but not its password).';

/** An email that is well-formed but deliberately not a real account. */
export const INVALID_PASSWORD = 'definitely-not-the-password-9137';

/**
 * Opt-in gate for tests that WRITE to the Bugasura workspace.
 *
 * my.bugasura.io is a live product with real teams, not a throwaway
 * environment. A test that creates a project leaves it there for colleagues to
 * see, and nothing here deletes it. Such tests skip unless this is set
 * explicitly, so a routine `npm run excel:test` never mutates the workspace.
 */
export function dataMutationAllowed(): boolean {
  return process.env.BUGASURA_ALLOW_DATA_MUTATION === '1';
}

export const MUTATION_NOT_ALLOWED_REASON =
  'This test case creates data in the live Bugasura workspace. Set ' +
  'BUGASURA_ALLOW_DATA_MUTATION=1 (and BUGASURA_TEAM to the team to create under) to run it.';

/* --------------------------------------------------- exploration account ---

 * The account the CODE GENERATOR's browser signs in with, which is not
 * necessarily the account the tests run as.
 *
 * WHY IT IS SEPARATE
 *
 * The suite's credentials belong to the tests: they are what a spec signs in
 * with, and TC_LOGIN_002 deliberately fails a sign-in with them. The
 * exploration account belongs to the generation browser, which only ever READS
 * the application so an agent can be shown a real DOM. Those are different
 * jobs, they may want different accounts (a read-only reviewer, a seeded
 * workspace), and one of them must be changeable without touching the other.
 *
 * Resolution order, first hit wins:
 *
 *   1. BUGASURA_EXPLORATION_PROFILE=qa-user -> BUGASURA_QA_USER_EMAIL /
 *      BUGASURA_QA_USER_PASSWORD. A profile is a NAME, so a run can be pointed
 *      at another account without a secret ever appearing in a command, a
 *      config file or a log.
 *   2. BUGASURA_EXPLORATION_USER / BUGASURA_EXPLORATION_PASSWORD.
 *   3. The suite's own BUGASURA_EMAIL / BUGASURA_PASSWORD, so an existing .env
 *      keeps working with nothing added.
 *
 * NOTHING HERE RETURNS A VALUE TO ANYTHING THAT CAN PRINT IT. The generation
 * browser reads these in-process and passes them to the browser as arguments;
 * the agent is denied .env, and `explorationIdentity()` exists so a log, a
 * metric or a group key can say WHICH VARIABLE was used without ever naming
 * the account.
 */

/** Turns `qa-user` into the `BUGASURA_QA_USER_` prefix its secrets live under. */
function profilePrefix(profile: string): string {
  return `BUGASURA_${profile.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_`;
}

/** Which variables the exploration account would be read from. Names only. */
export function explorationSource(): { email: string; password: string } {
  const profile = process.env.BUGASURA_EXPLORATION_PROFILE?.trim();
  if (profile) {
    const prefix = profilePrefix(profile);
    return { email: `${prefix}EMAIL`, password: `${prefix}PASSWORD` };
  }
  if (process.env.BUGASURA_EXPLORATION_USER)
    return { email: 'BUGASURA_EXPLORATION_USER', password: 'BUGASURA_EXPLORATION_PASSWORD' };
  return { email: 'BUGASURA_EMAIL', password: 'BUGASURA_PASSWORD' };
}

/**
 * The account the generation browser signs in with, or null when none is set.
 *
 * Null is a real answer and the caller must treat it as one: the framework
 * declines the exploration and says which variables it looked at. It must never
 * become a question put to the model.
 */
export function explorationCredentials(): Credentials | null {
  const source = explorationSource();
  const email = process.env[source.email];
  const password = process.env[source.password];
  return email && password ? { email, password } : null;
}

/**
 * WHICH VARIABLE the exploration account came from - never the address.
 *
 * Group keys, run logs and metrics all carry this. An email in a metrics record
 * is a username in a file somebody will paste into an issue.
 */
export function explorationIdentity(): string {
  return explorationCredentials() ? explorationSource().email : 'anonymous';
}

export const MISSING_EXPLORATION_CREDENTIALS_REASON =
  'the generation browser has no account to sign in with. Set ' +
  'BUGASURA_EXPLORATION_USER / BUGASURA_EXPLORATION_PASSWORD (or a ' +
  'BUGASURA_EXPLORATION_PROFILE, or the suite\'s own BUGASURA_EMAIL / ' +
  'BUGASURA_PASSWORD) in .env. The generator never asks anybody for a password.';

/** Team the create-project test uses. Required - Bugasura marks Team mandatory. */
export function targetTeam(): string | null {
  return process.env.BUGASURA_TEAM ?? null;
}
