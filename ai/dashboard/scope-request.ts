/**
 * The dashboard's ONE door from an HTTP request to an `ApplicationScope`.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 *   The dashboard must not merely pass a URL and expect downstream code to
 *   rediscover the project.
 *
 * Every application-specific route resolves its scope HERE, from fields the person
 * chose, before it touches an artefact. Nothing downstream is asked to work out which
 * application it is in, because by then the only evidence left is a URL, a file name
 * or a Page Object name - and every one of those is a guess.
 *
 * WHAT IS NEVER CONSULTED
 *
 * The recorded URL, the browser's document, the generated spec's file name, the Test
 * Case ID, and the Page Object class name. A URL is the address of one environment of
 * one application: `staging.example.com` and `my.bugasura.io` can be the same
 * application, and one host can serve two. Identity is DECLARED in the registry and
 * SELECTED by a person; this module is where that selection arrives.
 *
 * WHY A MISSING SELECTION IS A REFUSAL, NOT A DEFAULT
 *
 * With one application registered, an unscoped request resolves to it - that is the
 * whole backward-compatibility mechanism and it keeps every existing Bugasura flow
 * working. With TWO registered, the same request is REFUSED with the choices named.
 * The tempting alternative is to fall back to "the first one" or to the URL, and both
 * fail in the direction that produces a green test against the wrong application: the
 * run does not error, it records Flipkart's evidence into Bugasura's namespace.
 * `resolveScope` already draws that line; this module's job is to hand it the person's
 * choice and to translate its refusal into an HTTP answer a person can act on.
 */

import { type ApplicationScope, resolveScope, ScopeError } from '../projects/scope';
import {
  type ApplicationConfig,
  applications as registeredApplications,
  baseUrlFor,
  readRegistry,
  workbookOwner,
} from '../projects/registry';

/** What the page sends. Both optional - see the header on why absence is not a default. */
export interface ScopeSelection {
  applicationId?: unknown;
  environmentId?: unknown;
}

const text = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
};

/**
 * Resolve the scope a request is asking for.
 *
 * THE WORKBOOK IS DELIBERATELY NOT A SECOND SOURCE HERE, and it was on the first
 * attempt. `resolveScope({ workbook })` can name an owner - the registry declares one
 * per workbook, so it is a lookup rather than an inference - and using it meant a Run
 * posted with no project at all still succeeded, because the workbook answered for it.
 * The API test caught that: `POST /api/run` with two applications registered and no
 * `applicationId` returned 202.
 *
 * That is a weaker rule than the dashboard is supposed to enforce. The Run flow is
 * Project -> Environment -> Test Case -> Run, and quietly accepting a request that
 * skipped the first step makes the selector decorative: the page would keep working
 * with the selection ignored, and nobody would find out until two projects shared a
 * workbook name. So the dashboard requires the CHOICE, and the workbook is used only
 * to CHECK it - see `assertWorkbookInScope`, which refuses a mismatch and names the
 * project that actually owns the file.
 *
 * The CLI is unaffected and still resolves a scope from a workbook: a command given
 * `excel/login-test-cases.xlsx` has named the project as precisely as a dropdown would.
 */
export function scopeFromSelection(selection: ScopeSelection = {}): ApplicationScope {
  return resolveScope({
    applicationId: text(selection.applicationId),
    environmentId: text(selection.environmentId),
  });
}

/**
 * The same, but reporting the refusal rather than throwing it.
 *
 * The server answers a ScopeError with 400 and the message verbatim, because the
 * message already names the choices - "Choose one of: bugasura, flipkart" - and a
 * person reading it in the dashboard needs exactly that. Any other error is a fault
 * rather than a choice and is left to the server's own handler.
 */
export function tryScopeFromSelection(selection: ScopeSelection = {}):
{ scope: ApplicationScope } | { error: string; choices: string[] } {
  try {
    return { scope: scopeFromSelection(selection) };
  } catch (error) {
    if (error instanceof ScopeError) {
      return {
        error: error.message,
        choices: registeredApplications().map(application => application.applicationId),
      };
    }
    throw error;
  }
}

export interface EnvironmentView {
  environmentId: string;
  baseUrl: string;
  isDefault: boolean;
}

export interface ProjectView {
  /** THE identifier. Everything downstream keys off this. */
  applicationId: string;
  /** For people to read. Never an identifier - `Bugasura` is not `bugasura`. */
  displayName: string;
  defaultEnvironmentId: string;
  environments: EnvironmentView[];
  workbooks: string[];
}

/**
 * Every registered project, shaped for the selector.
 *
 * `baseUrl` comes from the application's own environment declaration, with its
 * declared env-var override applied - so what the page shows is what the recorder will
 * actually open, rather than a second copy of the address that can drift from it.
 */
export function describeProject(application: ApplicationConfig): ProjectView {
  return {
    applicationId: application.applicationId,
    displayName: application.displayName,
    defaultEnvironmentId: application.defaultEnvironmentId,
    environments: Object.keys(application.environments).map(environmentId => ({
      environmentId,
      baseUrl: baseUrlFor(application, environmentId),
      isDefault: environmentId === application.defaultEnvironmentId,
    })),
    workbooks: application.workbooks ?? [],
  };
}

export function describeProjects(): { projects: ProjectView[]; soleApplication: boolean } {
  const registry = readRegistry();
  return {
    projects: registry.applications.map(describeProject),
    // The page uses this to decide whether a selection is REQUIRED. It is the same
    // fact `resolveScope` uses to decide whether to refuse, read from the same
    // registry, so the button and the server cannot disagree about whether a choice
    // was needed.
    soleApplication: registry.applications.length === 1,
  };
}

/**
 * Does this workbook belong to the scope the request selected?
 *
 * The dashboard lists workbooks from `excel/` and the registry declares which
 * application owns each one. Without this check a person could select Bugasura and
 * then run Flipkart's workbook, and every result would be written back into Flipkart's
 * rows under Bugasura's scope - one application's execution record filed under
 * another's name.
 *
 * An UNDECLARED workbook is allowed while one application is registered and refused
 * once there are two, which is the same rule `workbookOwner` applies and the same
 * reason: with one application there is no other owner it could belong to.
 */
/**
 * The scope for an operation that is ABOUT a particular workbook.
 *
 * WHY THIS EXISTS RATHER THAN `activeScope()`.
 *
 * The dashboard is a long-lived server. `activeScope()` is a process-wide memo, so an
 * operation that reads it is asking "which application is this PROCESS in" when the
 * question is "which application is this REQUEST about" - and in a server those are
 * different questions with the same answer only by luck. Reading the mapping or a
 * recording's status through the ambient scope was exactly that: the request had
 * already resolved a scope, and the code underneath went and asked a global.
 *
 * A workbook belongs to exactly one application and the registry says which, so the
 * workbook answers it precisely. That is a LOOKUP in a table a person wrote, not an
 * inference from a path or a name - the distinction this whole phase turns on.
 *
 * When the request ALSO names a project, both answers must agree; a mismatch is
 * refused rather than resolved in favour of either. That is the case where somebody
 * has Bugasura selected and asks about Flipkart's workbook, and silently answering
 * with either one is how a person ends up reading the wrong project's rows.
 */
export function scopeForWorkbook(workbook: string, selection: ScopeSelection = {}): ApplicationScope {
  const owner = workbookOwner(workbook, readRegistry());
  const chosen = text(selection.applicationId);
  if (chosen && chosen !== owner) {
    throw new ScopeError(`Workbook "${workbook}" belongs to application "${owner}", but the `
      + `selected project is "${chosen}". Select "${owner}" to work with it.`);
  }
  return resolveScope({ applicationId: owner, environmentId: text(selection.environmentId) });
}

export function assertWorkbookInScope(scope: ApplicationScope, workbook: string): void {
  const owner = workbookOwner(workbook, readRegistry());
  if (owner !== scope.applicationId) {
    throw new ScopeError(`Workbook "${workbook}" belongs to application "${owner}", but the `
      + `selected project is "${scope.applicationId}". Select "${owner}" to work with it.`);
  }
}
