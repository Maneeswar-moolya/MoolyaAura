/** Runtime URL and credentials come from the active application's registry environment.
 * Load secrets from the environment; no installed application or fallback account.
 */

// Must come first: it populates process.env before the reads below, including the
// per-environment `baseUrlEnv` override the registry applies.
import './load-env';

import { activeScope } from '../../ai/projects/scope';

/** Resolve the selected environment URL; no selection is an explicit error. */
export function resolveBaseUrl(): string {
  let scope;
  try {
    scope = activeScope();
  } catch (error) {
    throw new Error('No application is selected, so there is no base URL to run against. '
      + `Set AURA_APPLICATION. (${(error as Error).message})`);
  }
  if (!scope.baseUrl?.trim()) {
    throw new Error(`Application "${scope.applicationId}" declares no baseUrl for environment `
      + `"${scope.environmentId}". Add one to ai/projects/registry.json.`);
  }
  return scope.baseUrl;
}

export const BASE_URL = resolveBaseUrl();

export interface Credentials {
  email: string;
  password: string;
}

/**
 * WHICH VARIABLES this application's credentials live in - names only, never values.
 *
 * The registry declares them per environment (`credentials.email` / `.password`, which
 * `validateRegistry` refuses unless they are VARIABLE NAMES). An application that declares
 * none returns null and its authenticated cases skip with a reason. Borrowing another
 * application's account is the one outcome that must never happen: it would sign in to
 * somebody else's product, and the test would look like it had worked.
 */
export function credentialSource(): { email: string; password: string } | null {
  let scope;
  try {
    scope = activeScope();
  } catch {
    return null;
  }
  const declared = scope.credentials;
  if (!declared?.email || !declared?.password)
    return null;
  return { email: declared.email, password: declared.password };
}

/** Returns credentials, or null when this application has not declared/supplied them. */
export function credentials(): Credentials | null {
  const source = credentialSource();
  if (!source)
    return null;
  const email = process.env[source.email];
  const password = process.env[source.password];
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
  const source = credentialSource();
  return source ? process.env[source.email] ?? null : null;
}

/**
 * Why the authenticated part of a case is being skipped, naming the ACTUAL variables.
 *
 * A function rather than a constant because the answer depends on which application is
 * selected: a fixed credential name would send somebody setting up a
 * different project to the wrong variable entirely.
 */
export function missingCredentialsReason(): string {
  const source = credentialSource();
  if (source) {
    return `${source.email} / ${source.password} are not set - skipping the authenticated `
      + 'part of this test case. Set both variables to execute it.';
  }
  let who: string;
  try {
    who = `Application "${activeScope().applicationId}" declares no credentials`;
  } catch {
    who = 'No application is selected, so no credentials are declared';
  }
  return `${who} in ai/projects/registry.json, so the authenticated part of this test case `
    + 'is skipped. Declare credential VARIABLE NAMES for its environment - the account of '
    + 'another application is never borrowed.';
}

/** Why a case needing only a registered address is skipped. Names the real variable. */
export function missingEmailReason(): string {
  const source = credentialSource();
  return source
    ? `${source.email} is not set - this test case needs a registered email address `
      + '(but not its password).'
    : missingCredentialsReason();
}

/** An email that is well-formed but deliberately not a real account. */
export const INVALID_PASSWORD = 'definitely-not-the-password-9137';

/** Exploration overrides use only the declared active application's prefix.
 * Resolution: <APP>_EXPLORATION_PROFILE, explicit <APP>_EXPLORATION_USER/PASSWORD,
 * then that environment's declared credential variable names. No cross-app fallback.
 */
function applicationPrefix(): string | null {
  try {
    return `${activeScope().applicationId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_`;
  } catch {
    return null;
  }
}

/** Turns `qa-user` into the `<APP>_QA_USER_` prefix its secrets live under. */
function profilePrefix(prefix: string, profile: string): string {
  return `${prefix}${profile.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_`;
}

/** Resolve exploration credential variable names within the active application only. */
export function explorationSource(): { email: string; password: string } | null {
  const prefix = applicationPrefix();
  if (!prefix)
    return null;

  const profile = process.env[`${prefix}EXPLORATION_PROFILE`]?.trim();
  if (profile) {
    const scoped = profilePrefix(prefix, profile);
    return { email: `${scoped}EMAIL`, password: `${scoped}PASSWORD` };
  }
  if (process.env[`${prefix}EXPLORATION_USER`]) {
    return {
      email: `${prefix}EXPLORATION_USER`,
      password: `${prefix}EXPLORATION_PASSWORD`,
    };
  }
  // The application's OWN declaration. No literal, and no fallback past it.
  return credentialSource();
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
  if (!source)
    return null;
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
  return explorationCredentials() ? explorationSource()!.email : 'anonymous';
}

/**
 * Why the generation browser has no account, naming the variables ACTUALLY looked at.
 *
 * A function rather than a constant for the same reason `missingCredentialsReason` is:
 * the variables depend on which application is selected, and a fixed string naming
 * another application's credential name would send somebody setting up a different project to a
 * variable that has nothing to do with it.
 */
export function missingExplorationCredentialsReason(): string {
  const prefix = applicationPrefix();
  if (!prefix) {
    return 'the generation browser has no account to sign in with, because no application '
      + 'is selected. Set AURA_APPLICATION. The generator never asks anybody for a password.';
  }
  const source = explorationSource();
  const declared = source
    ? `${source.email} / ${source.password} are not set. `
    : 'this application declares no credentials in ai/projects/registry.json, and no '
      + 'exploration override is set. ';
  return `the generation browser has no account to sign in with: ${declared}Set `
    + `${prefix}EXPLORATION_USER / ${prefix}EXPLORATION_PASSWORD (or a `
    + `${prefix}EXPLORATION_PROFILE, or the credentials this application declares) in .env. `
    + 'The generator never asks anybody for a password.';
}

