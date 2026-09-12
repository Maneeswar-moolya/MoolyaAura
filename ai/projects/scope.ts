/**
 * The active application scope, and the paths every application-scoped artefact
 * lives under.
 *
 * THE INVARIANT THIS FILE EXISTS TO ENFORCE
 *
 *   No application-specific artefact may be resolved outside the active
 *   applicationId scope unless it is explicitly declared as a shared framework
 *   capability.
 *
 * "Explicitly declared" is doing real work in that sentence. The framework itself -
 * recorder, evidence engine, locator engine, generator, execution, validation, the
 * AI gateway, the dashboard - is shared and is never duplicated per application.
 * What an application owns is its ARTEFACTS: Page Objects, knowledge, locators,
 * evidence, recordings, test cases, test data, generated specs, results, history.
 * `SHARED_CAPABILITIES` below is that declaration, written down rather than implied,
 * so "is this shared?" has an answer a person can read instead of infer.
 *
 * WHY THERE IS NO CROSS-APPLICATION FALLBACK
 *
 * The tempting shape is "look in the active application, and if nothing is there,
 * look everywhere else". That is precisely the contamination the invariant forbids,
 * and it fails silently in the worst direction: a Flipkart run that finds Bugasura's
 * LoginPage does not error, it produces a green test against the wrong application.
 * So a miss inside the active scope is a MISS. It is reported as not-found, and the
 * remedy is to author the artefact for this application.
 *
 * THE ONE FALLBACK THAT EXISTS, AND WHY IT IS NOT THAT
 *
 * `layoutFor` prefers `<dir>/<applicationId>/` and falls back to the flat `<dir>/`
 * for the ONE application entitled to it. That is a MIGRATION affordance, not a
 * cross-application search: the flat directories hold artefacts authored before the
 * scope layer existed, they have exactly one owner, and that owner is DECLARED
 * (`ApplicationConfig.legacyLayout`, at most one per registry). Every other
 * application resolves to `<dir>/<applicationId>` and a miss there is a MISS.
 *
 * IT USED TO BE KEYED TO THE REGISTRY'S SIZE, AND THAT WAS THE DEFECT. `soleApplication`
 * answers "could anything else be in here?" - a fact about how many applications are
 * registered, not about who owns the directory. So registering a second application
 * silently moved Bugasura's five still-flat artefact classes to scoped paths that do
 * not exist: 7 Page Objects, 3 knowledge files, 62 generated specs, the mapping and
 * the fixtures module, all resolving to MISSING. The directories were never ambiguous;
 * nobody had written down who owned them. Now somebody has.
 *
 * `soleApplication` remains selection/UI metadata; it never grants ownership.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  baseUrlFor,
  findApplication,
  readRegistry,
  type Registry,
  workbookOwner,
} from './registry';

const ROOT = process.cwd();

/**
 * Shared framework capabilities: never duplicated per application, never scoped.
 *
 * A module listed here may be read by any application's run. Anything NOT listed
 * that produces or consumes application artefacts must take a scope.
 */
export const SHARED_CAPABILITIES = [
  'recorder engine',
  'evidence engine',
  'locator engine',
  'generation engine',
  'execution engine',
  'validation engine',
  'AI gateway',
  'dashboard framework',
  'framework knowledge (ai/knowledge/framework)',
] as const;

/** Artefact classes an application owns. Each has a directory in `ScopePaths`. */
export const APPLICATION_ARTEFACTS = [
  'page objects',
  'components',
  'knowledge',
  'locators',
  'evidence',
  'recordings',
  'test cases',
  'test data',
  'generated specs',
  'results',
  'history',
] as const;

export interface ScopePaths {
  /** Application Page Objects. Class names are namespaced by this directory. */
  pagesDir: string;
  /** Application page knowledge. `ai/knowledge/framework` is deliberately NOT here. */
  knowledgePageDir: string;
  /** Recording artefacts: <TC_ID>.spec.ts / .evidence.json / .assertions.json / .authoring.json */
  recordingsDir: string;
  /** Generated specs. */
  generatedDir: string;
  /** Test-case -> spec traceability for this application. */
  mappingFile: string;
  /**
   * The module a spec destructures its Page Objects from.
   *
   * Application-owned, not framework plumbing, and the reason is the collision it
   * causes rather than what it contains: the fixture NAME is derived from the class
   * name (`LoginPage` -> `loginPage`), so two applications both registering a
   * `loginPage` fixture in one file do not conflict - the second registration finds
   * the name already present, returns the source unchanged, and every spec that
   * destructures `loginPage` silently gets the FIRST application's class. A shared
   * file makes that failure invisible; a file per application makes it impossible.
   */
  fixturesFile: string;
}

export interface ApplicationScope {
  applicationId: string;
  environmentId: string;
  /** Configuration and evidence. Never used to derive `applicationId`. */
  baseUrl: string;
  /**
   * The environment VARIABLE NAMES this application's credentials live in - never values.
   *
   * Carried on the scope because the runtime needs it and there must be exactly one way
   * to ask: `tests-e2e/support/env.ts` used to read `BUGASURA_EMAIL` / `BUGASURA_PASSWORD`
   * directly, which is shared runtime code signing in to one particular product whatever
   * application was selected. `undefined` means this application declares none, and the
   * caller skips - it never means "use somebody else's".
   *
   * Names only, and `validateRegistry` refuses anything that is not one (an address, a
   * space, a lower-case value), so a scope can be logged without leaking a secret.
   */
  credentials?: { email?: string; password?: string };
  displayName: string;
  paths: ScopePaths;
  /**
   * Whether this is the only registered application.
   *
   * Selection/UI metadata only. Never use cardinality to grant artifact ownership.
   */
  soleApplication: boolean;
  /**
   * Whether THIS application's artefacts resolve from the unscoped directories.
   *
   * True only for the declared `legacyLayout` owner. Read by anything that has to know
   * whether a sibling application's scoped directory can appear INSIDE this
   * application's own directory, which is only possible under the flat layout.
   */
  flatLayout: boolean;
}

export class ScopeError extends Error {}

/**
 * Prefer `<dir>/<applicationId>/`, fall back to the flat `<dir>/` only for the ONE
 * application entitled to it. See the header for why that is a migration affordance
 * and not a hole.
 *
 * SCOPED-IF-IT-EXISTS IS CHECKED FIRST, AND THAT ORDER IS THE MIGRATION PATH. It is
 * why `ai/dashboard/recordings/bugasura` resolves scoped today while the other five
 * artefact classes are still flat: each class moves on its own, the day somebody
 * creates its scoped directory, with no registry edit and no flag day.
 */
function layoutFor(dir: string, applicationId: string, flatFallback: boolean): string {
  const scoped = path.join(dir, applicationId);
  if (fs.existsSync(scoped))
    return scoped;
  if (flatFallback)
    return dir;
  return scoped;
}

/**
 * The FILE equivalent of `layoutFor`: prefer `<dir>/<applicationId>.<suffix>`, fall
 * back to `<dir>/<suffix>` only for the application entitled to the flat layout.
 *
 * A file cannot carry a directory of the same name, so the applicationId goes into
 * the stem instead. Same rule, same migration affordance, same refusal for everyone
 * else. Note this one cannot nest: `bugasura.mapping.json` and `demoapp.mapping.json`
 * are siblings, so a second application's file can never appear inside the first's.
 */
export function scopedFilePath(dir: string, applicationId: string, suffix: string, flatFallback: boolean): string {
  const scoped = path.join(dir, `${applicationId}.${suffix}`);
  if (fs.existsSync(scoped))
    return scoped;
  if (flatFallback)
    return path.join(dir, suffix);
  return scoped;
}

/**
 * The directory every application-owned artefact path is built under.
 *
 * `AURA_ARTEFACT_ROOT` redirects ALL of them at once, and it exists for one reason: a
 * destructive fixture must not be able to NAME a real artefact directory, let alone
 * delete one. `ai/projects/dashboard-scope.fixture.ts` used a synthetic registry but
 * resolved against the real repository, so `selected.paths.recordingsDir` was the actual
 * `ai/dashboard/recordings/flipkart` - and its cleanup recursively deleted a real
 * project's recordings the day somebody added one. A guard that checks the path before
 * deleting is necessary but second-best; redirecting the ROOT means the dangerous path is
 * never produced in the first place.
 *
 * Read per call rather than frozen at import, so a fixture can enter and leave isolation
 * inside one process. Unset - which is every production path - it is `process.cwd()`,
 * exactly as before.
 */
export function artefactRoot(): string {
  const override = process.env.AURA_ARTEFACT_ROOT?.trim();
  return override ? path.resolve(ROOT, override) : ROOT;
}

function pathsFor(applicationId: string, flatFallback: boolean): ScopePaths {
  const root = artefactRoot();
  return {
    pagesDir: layoutFor(path.join(root, 'tests-e2e', 'pages'), applicationId, flatFallback),
    knowledgePageDir: layoutFor(path.join(root, 'ai', 'knowledge', 'page'), applicationId, flatFallback),
    recordingsDir: layoutFor(path.join(root, 'ai', 'dashboard', 'recordings'), applicationId, flatFallback),
    generatedDir: layoutFor(path.join(root, 'tests-e2e', 'generated'), applicationId, flatFallback),
    mappingFile: scopedFilePath(path.join(root, 'ai', 'test-mapping'), applicationId, 'mapping.json', flatFallback),
    fixturesFile: scopedFilePath(path.join(root, 'tests-e2e'), applicationId, 'fixtures.ts', flatFallback),
  };
}

export interface ScopeRequest {
  applicationId?: string;
  environmentId?: string;
  /** Resolve the application from the workbook that owns it. */
  workbook?: string;
}

/**
 * Resolve the active scope.
 *
 * An omitted selection can resolve a sole application, but confers no additional
 * ownership. With no applications, explain onboarding; with several, require a
 * selection (or the explicitly owned workbook). Layout depends only on declarations.
 */
export function resolveScope(request: ScopeRequest = {}, registry: Registry = readRegistry()): ApplicationScope {
  const soleApplication = registry.applications.length === 1;
  if (!registry.applications.length)
    throw new ScopeError('No applications are registered. Add a project from the dashboard to get started.');

  let applicationId = request.applicationId?.trim();
  if (!applicationId && request.workbook)
    applicationId = workbookOwner(request.workbook, registry);

  if (!applicationId) {
    if (!soleApplication) {
      throw new ScopeError('No applicationId was supplied and more than one application is registered. '
        + `Choose one of: ${registry.applications.map(a => a.applicationId).join(', ')}.`);
    }
    applicationId = registry.applications[0].applicationId;
  }

  const application = findApplication(applicationId, registry);
  if (!application) {
    throw new ScopeError(`Unknown applicationId "${applicationId}". `
      + `Registered: ${registry.applications.map(a => a.applicationId).join(', ')}.`);
  }

  const environmentId = request.environmentId?.trim() || application.defaultEnvironmentId;
  if (!application.environments[environmentId]) {
    throw new ScopeError(`Application "${applicationId}" has no environment "${environmentId}". `
      + `Declared: ${Object.keys(application.environments).join(', ')}.`);
  }

  // Registry cardinality is selection metadata, never evidence of ownership.
  const flatLayout = application.legacyLayout === true;

  return {
    applicationId,
    environmentId,
    baseUrl: baseUrlFor(application, environmentId),
    // The declared VARIABLE NAMES for this environment, or undefined. Read straight from
    // the registry with no default: an application that declares none has none.
    credentials: application.environments[environmentId].credentials,
    displayName: application.displayName,
    paths: pathsFor(applicationId, flatLayout),
    soleApplication,
    flatLayout,
  };
}

/**
 * THE ACTIVE SCOPE, for a caller that has not been threaded one yet.
 *
 * Memoised, because `canonicalIdentity` is called per element while building a page
 * index and re-reading the registry each time would be pure waste. The dashboard is
 * one long-lived process that can switch applications, so `resetActiveScope` exists;
 * every short-lived CLI resolves once and never calls it.
 */
let cachedScope: ApplicationScope | null = null;

/**
 * How a caller with no scope of its own says which application it means.
 *
 * `AURA_APPLICATION` / `AURA_ENVIRONMENT`, unset today, and unset they change nothing:
 * `resolveScope({})` resolves to the sole registered application exactly as before.
 * They are the SELECTION mechanism, and selection is a person's decision - the
 * environment is where a person's choice can reach a process that takes no argument
 * yet, which is every CLI in this repository.
 *
 * An unknown id is a `ScopeError` from `resolveScope`, not a fallback: a typo in
 * `AURA_APPLICATION` must stop the run rather than quietly resolve the other
 * application's artefacts.
 */
export function activeScope(): ApplicationScope {
  if (!cachedScope) {
    cachedScope = resolveScope({
      applicationId: process.env.AURA_APPLICATION?.trim() || ambientDefault(),
      environmentId: process.env.AURA_ENVIRONMENT?.trim() || undefined,
    });
  }
  return cachedScope;
}

/**
 * Which application an AMBIENT caller means when nobody has said.
 *
 * `resolveScope({})` refuses this question, deliberately and unchanged: an explicit
 * request that names no application is about to file an artefact somewhere, and picking
 * one would file it under the wrong namespace. THIS IS A DIFFERENT QUESTION. `activeScope`
 * exists for a caller that predates the scope layer and has no scope to be threaded -
 * every CLI here, and roughly sixty offline fixtures - and those callers were written
 * against the UNSCOPED directories. So the application that owns the unscoped
 * directories is what they meant, and `legacyLayout` already declares which one that is.
 *
 * MEASURED, NOT ASSUMED. Registering a second application without this turned 60 of the
 * 64 fixtures red in one step - not because anything was misfiled but because
 * `activeScope()` began refusing a question it had always answered. The artefacts were
 * exactly where they had always been; the accessor had simply lost the right to say so.
 *
 * It is not a fallback across applications and it cannot become one. It returns the
 * DECLARED owner of the flat layout, at most one exists (`validateRegistry`), and when
 * that owner is finally migrated and drops the flag this returns nothing again - which
 * is correct, because at that point there is no unscoped world left for an unscoped
 * caller to have meant. The dashboard is unaffected either way: every one of its
 * request paths goes through `resolveScope` with the person's own selection, so an
 * unscoped REQUEST is still refused with the choices named.
 */
function ambientDefault(): string | undefined {
  try {
    const registry = readRegistry();
    if (registry.applications.length === 1)
      return undefined; // `resolveScope` already resolves the sole application.
    return registry.applications.find(application => application.legacyLayout)?.applicationId;
  } catch {
    return undefined;
  }
}

/**
 * Memos elsewhere that are DERIVED from the active scope and must die with it.
 *
 * `ai/knowledge/canonical.ts` caches the applicationId it built page identities from. It
 * is a separate variable in a separate module, so changing the scope without telling it
 * leaves a memo answering with the PREVIOUS application - and page identity is what names
 * every knowledge file, so the next one written would be filed under the wrong
 * application. That module cannot be imported from here (it imports this one), so it
 * registers an invalidator instead of being called by name.
 *
 * A subscriber only clears its own variable; nothing here calls back into the scope layer.
 */
const scopeChangeListeners: Array<() => void> = [];

export function onScopeChange(listener: () => void): void {
  scopeChangeListeners.push(listener);
}

function notifyScopeChanged(): void {
  for (const listener of scopeChangeListeners)
    listener();
}

/** Drop the memo. The dashboard switches applications inside one process. */
export function resetActiveScope(): void {
  cachedScope = null;
  notifyScopeChanged();
}

/**
 * STATE WHICH APPLICATION THIS PROCESS IS WORKING ON, from something authoritative.
 *
 * THE DEFECT THIS EXISTS TO REMOVE. `activeScope()` answers an AMBIENT question, and when
 * nobody has said, it falls back to the declared `legacyLayout` owner. That is right for a
 * pre-scope CLI which was written against the unscoped directories, and it is WRONG for an
 * operation that knows perfectly well which application it is for and simply never said so.
 * Generation was exactly that: `orchestrate.run({ workbook })` receives the workbook - and
 * a workbook has exactly one declared owner - then resolved every artefact path through
 * the ambient scope. Measured against a real Flipkart run: the recording sat in
 * `ai/dashboard/recordings/flipkart/TC_SMOKE_003.spec.ts` while the generator looked in
 * `ai/dashboard/recordings/bugasura`, read `ai/knowledge/page/*.yaml` (Bugasura's), and
 * would have written into `tests-e2e/pages`. One missing statement, and every artefact
 * class in the run belonged to the wrong application.
 *
 * So an operation that HAS an authoritative source pins the scope from it, once, at its
 * entry point, and every `activeScopePath` consumer downstream is then correct without
 * being threaded a parameter. That is the same mechanism the dashboard already uses to
 * switch applications inside one process (`resetActiveScope`), used deliberately instead
 * of by omission.
 *
 * SAFE IN A CHILD PROCESS, WHICH IS WHERE IT IS CALLED. Generation is spawned, so the pin
 * is process-local and cannot disturb a concurrent operation in the dashboard. Nothing
 * long-lived and multi-tenant should pin: the dashboard threads an explicit
 * `ApplicationScope` per request instead, and a recording captures its scope at the moment
 * it starts (`Session.scope` -> `pending.origin`), which is what makes a selection change
 * mid-recording harmless.
 *
 * A `ScopeError` propagates. An operation that cannot say which application it is for must
 * stop, not proceed under somebody else's namespace.
 */
export function pinActiveScope(request: ScopeRequest): ApplicationScope {
  cachedScope = resolveScope(request);
  // Derived memos elsewhere are now stale, and a stale one answers with the PREVIOUS
  // application - which is the whole class of defect this pin exists to remove.
  notifyScopeChanged();
  return cachedScope;
}

/**
 * One artefact directory of the active scope, for a caller that still owns a
 * pre-scope constant.
 *
 * `legacy` is that caller's own hardcoded path, and it is returned in EXACTLY ONE
 * circumstance: there is no `ai/projects/registry.json` to read at all, which is what
 * a checkout from before the registry landed looks like. It is a migration
 * affordance with the same expiry as `layoutFor`'s flat fallback.
 *
 * A `ScopeError` IS NEVER SWALLOWED, and that distinction is the whole point of this
 * function. "More than one application is registered and you did not say which" and
 * "no application called that" are the two questions the scope layer exists to
 * REFUSE. Answering either of them with the flat legacy directory would hand one
 * application's Page Objects, knowledge or recordings to another application's run -
 * silently, and in the direction that produces a green test rather than a crash.
 * A bare `catch` here would therefore reinstate exactly the leak the registry was
 * introduced to close, which is why the try block holds one call and nothing else.
 */
export function activeScopePath(artefact: keyof ScopePaths, legacy: string): string {
  try {
    return activeScope().paths[artefact];
  } catch (error) {
    if (error instanceof ScopeError)
      throw error;
    return legacy;
  }
}

/**
 * THE RECORDING STORE, for a caller that has no legacy constant of its own.
 *
 * Defined here rather than in `ai/dashboard/recorder.ts` - which re-exports these two
 * under its own names, so its API is unchanged - for one reason: `recorder.ts` loads
 * `.env` at import time. `ai/autocode/work.ts` already says why that matters
 * ("the survey has no business pulling dotenv in behind it"), and roughly thirty
 * offline fixtures need this directory. Importing the recorder into all of them to get
 * a path would pull dotenv, a child-process module and the whole codegen surface into
 * gates that are meant to touch nothing.
 *
 * So the DEFINITION lives in the module that owns path resolution and has no side
 * effects at all, and the recorder keeps the names its callers already use. One
 * declaration, two spellings of the same thing - which is the opposite of the three
 * independent declarations this replaced.
 */
export function activeRecordingsDir(): string {
  return activeScopePath('recordingsDir', path.join(ROOT, 'ai', 'dashboard', 'recordings'));
}

/** Where an accepted recording's provenance is archived. Derived, never spelled. */
export function activeAcceptedDir(): string {
  return path.join(activeRecordingsDir(), 'accepted');
}

/**
 * Every registered applicationId, for a walker that has to recognise a scoped
 * namespace directory when it meets one.
 *
 * WHY THIS TAKES NO ACTIVE SCOPE, AND MUST NOT. A recursive scan over a FLAT artefact
 * directory can meet another application's scoped directory as a child -
 * `tests-e2e/generated/demoapp` sits inside `tests-e2e/generated`, which is Bugasura's
 * whole generated tree - and descending into it files a second application's specs
 * under the first. That is a real cross-application leak and it has nothing to do with
 * which application is active: a directory named after a registered application is a
 * NAMESPACE, and a scan rooted anywhere above it must stop there. Rooted INSIDE a
 * scoped directory the question never arises, because its children are not named after
 * applications.
 *
 * Asking for the active scope instead would be worse than unnecessary. These walkers
 * run during Playwright COLLECTION (`tests-e2e/generic/generic.spec.ts`), where two
 * registered applications and no choice made is a `ScopeError` - so the leak fix would
 * take collection down with it.
 *
 * An unreadable registry answers with no names, which excludes nothing and is exactly
 * the behaviour that existed before scoped directories did. There is no case where
 * that hides a leak: the names a leak needs come from the registry.
 */
export function registeredApplicationIds(): string[] {
  try {
    return readRegistry().applications.map(application => application.applicationId);
  } catch {
    return [];
  }
}

/**
 * Namespace a bare artefact key.
 *
 * `TC_LOGIN_001` is unique within an application and meaningless across them, so
 * anything that keys a map by one - a mapping file, a history record, a lookup -
 * uses this instead. `bugasura/TC_LOGIN_001` and `flipkart/TC_LOGIN_001` are then
 * different keys with no collision and no renaming of the ID itself.
 */
export function scopedKey(applicationId: string, key: string): string {
  return `${applicationId}/${key}`;
}

/** Split a `scopedKey` back into its parts; a bare key reports no application. */
export function splitScopedKey(value: string): { applicationId: string | null; key: string } {
  const slash = value.indexOf('/');
  if (slash < 0)
    return { applicationId: null, key: value };
  return { applicationId: value.slice(0, slash), key: value.slice(slash + 1) };
}

/**
 * Assert an artefact being resolved belongs to the active scope.
 *
 * Call sites pass the artefact's own recorded application. A mismatch is a bug in
 * the caller, not a condition to recover from: continuing would hand one
 * application's artefact to another's run, which is the one outcome the invariant
 * exists to make impossible.
 */
export function assertInScope(scope: ApplicationScope, artefactApplicationId: string | null, what: string): void {
  if (artefactApplicationId === null)
    return; // Pre-migration artefact: attributed to the active application by layoutFor.
  if (artefactApplicationId !== scope.applicationId) {
    throw new ScopeError(`${what} belongs to application "${artefactApplicationId}" but the active `
      + `scope is "${scope.applicationId}". Application artefacts are never resolved across scopes.`);
  }
}

/** True when a path sits inside the active scope's directory for that artefact class. */
export function isWithinScope(scope: ApplicationScope, candidate: string, artefact: keyof ScopePaths): boolean {
  const base = scope.paths[artefact];
  const absolute = path.isAbsolute(candidate) ? candidate : path.join(ROOT, candidate);
  const relative = path.relative(base, absolute);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
