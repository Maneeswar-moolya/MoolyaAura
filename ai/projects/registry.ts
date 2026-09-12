/**
 * The declared applications, and the one place that decides which one is active.
 *
 * Application identity used to be a derivation: `applicationSlug(BASE_URL)` parsed
 * `my.bugasura.io` into `bugasura` and that string became half of every page
 * identity. It worked because there was exactly one application, and it was wrong
 * for the same reason a single-element array looks like a scalar. A URL is
 * CONFIGURATION - it changes per environment, and two applications can share a host
 * - so deriving identity from it means an environment switch can silently rename the
 * namespace, and a reverse proxy can merge two applications into one.
 *
 * So identity is DECLARED here and selected by a person, and the URL is demoted to
 * what it always was: the address of one environment of one application.
 *
 *   applicationId    identity      declared, immutable, the namespace key
 *   environmentId    configuration which baseUrl and which credentials
 *   baseUrl          evidence      where that environment happens to live
 *
 * WHY applicationId IS IMMUTABLE
 *
 * It is simultaneously a directory name, a mapping-file name and a scope key. A
 * rename would orphan every artefact filed under the old one, and the orphan would
 * be invisible - resolution would simply return nothing, which reads exactly like
 * "this application has no Page Objects yet". `validateRegistry` therefore refuses
 * an id that is not a stable lowercase slug, and nothing in the framework ever
 * writes this file from a derived value.
 *
 * Credentials are declared by VARIABLE NAME, never by value - the same discipline
 * `ai/dashboard/authoring.ts` already enforces for Authentication Profile. A
 * registry that held an address or a password would be a committed secret.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/**
 * Where the declared applications live.
 *
 * `AURA_REGISTRY_FILE` overrides it. That exists so the isolation gate can declare a
 * SECOND application and assert what every write path does with it - the one property
 * this repository cannot otherwise test, because Bugasura is the only application
 * registered and a fixture that only ever sees one application proves nothing about
 * two. Read per call rather than frozen at import, so a test can switch registries
 * inside one process; unset, it is exactly the path it always was.
 */
export function registryFile(): string {
  const override = process.env.AURA_REGISTRY_FILE?.trim();
  return override ? path.resolve(ROOT, override) : path.join(ROOT, 'ai', 'projects', 'registry.json');
}

/**
 * A stable machine identifier: lowercase, starts with a letter, no underscores.
 *
 * Underscores are excluded deliberately. Canonical page identities join the
 * application to the route with a DOUBLE underscore (`bugasura__apps`), so an
 * application id containing one would make that identity ambiguous to anything that
 * splits on it.
 */
const APPLICATION_ID = /^[a-z][a-z0-9-]*$/;
const ENVIRONMENT_ID = /^[a-z][a-z0-9-]*$/;

/**
 * Names an application may not take, because a directory already means something
 * else under one of the scoped roots.
 *
 * `layoutFor` resolves an artefact directory as `<root>/<applicationId>`, so an
 * application called `accepted` would resolve its recordings onto
 * `ai/dashboard/recordings/accepted` - the ARCHIVE that `acceptedDir()` returns for
 * every OTHER application. Its live recordings and everyone else's accepted ones
 * would then be the same directory, which is a cross-application leak arriving
 * through a name rather than through a code path, so no amount of scoping downstream
 * would catch it. The rest are the sibling directory names under the other roots
 * (`tests-e2e/pages`, `tests-e2e/generated`, `tests-e2e/support`, `ai/knowledge/page`,
 * `ai/knowledge/framework`), refused for the same reason before anyone can find out
 * the hard way.
 */
const RESERVED_APPLICATION_IDS = new Set([
  'accepted', 'pages', 'generated', 'support', 'page', 'framework', 'fixtures', 'runs', 'generations',
]);

export interface EnvironmentConfig {
  /** Where this environment lives. Configuration and evidence - never identity. */
  baseUrl: string;
  /** Optional env var that overrides `baseUrl`, so existing .env files keep working. */
  baseUrlEnv?: string;
  /** Variable NAMES, not values. */
  credentials?: { email?: string; password?: string };
}

export interface ApplicationConfig {
  applicationId: string;
  displayName: string;
  defaultEnvironmentId: string;
  environments: Record<string, EnvironmentConfig>;
  /** Repo-relative workbook paths this application owns. One workbook, one application. */
  workbooks: string[];
  /**
   * THIS APPLICATION OWNS THE UNSCOPED ARTEFACT DIRECTORIES.
   *
   * `tests-e2e/pages`, `ai/knowledge/page`, `tests-e2e/generated`,
   * `ai/test-mapping/mapping.json` and `tests-e2e/fixtures.ts` predate the scope layer
   * and still hold Bugasura's 72 real artefacts. `layoutFor` used to reach them through
   * the SOLE-APPLICATION fallback, which is a fact about the registry's SIZE - so
   * registering a second application silently relocated all five to scoped directories
   * that do not exist, and 7 Page Objects, 3 knowledge files and 62 generated specs
   * stopped resolving. Measured, not feared: `resolveScope` against a two-application
   * registry returns five MISSING paths.
   *
   * The fallback was never wrong; the thing it was keyed to was. Ambiguity is what a
   * flat directory acquires when nobody has said who owns it, and that is a question
   * with an answer - so the answer is DECLARED here, exactly as applicationId itself is
   * declared rather than parsed out of a URL.
   *
   * AT MOST ONE APPLICATION MAY DECLARE IT (`validateRegistry`), which is what keeps the
   * flat directories unambiguous. A second application never reaches them - it resolves
   * to `<dir>/<applicationId>` and a miss there is a MISS, never a look somewhere else.
   *
   * It is a MIGRATION marker and it expires the same way `layoutFor`'s scoped-first rule
   * always worked: create `tests-e2e/pages/bugasura/`, move those files, and that ONE
   * artefact class flips to scoped on its own with no registry edit. Recordings already
   * did exactly that in Phase 2, which is why they are unaffected by any of this. Drop
   * the flag when the last class has moved.
   */
  legacyLayout?: boolean;
}

export interface Registry {
  schemaVersion: number;
  applications: ApplicationConfig[];
}

/**
 * Read and validate the registry.
 *
 * Throws rather than returning a partial registry: a half-read registry would hand
 * out a scope that resolves to the wrong directory, and every artefact written under
 * it would be misfiled. Loud beats subtly wrong here, exactly as `ai/knowledge/yaml.ts`
 * argues for knowledge files.
 */
export function readRegistry(file: string = registryFile()): Registry {
  if (!fs.existsSync(file))
    throw new Error(`No application registry at ${path.relative(ROOT, file)}. `
      + 'Every application-scoped operation needs one.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${path.relative(ROOT, file)} is not valid JSON: ${(error as Error).message}`);
  }
  return validateRegistry(parsed, path.relative(ROOT, file).replace(/\\/g, '/'));
}

export function validateRegistry(value: unknown, source = 'registry'): Registry {
  const registry = value as Registry;
  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.applications))
    throw new Error(`${source}: expected an object with an "applications" array.`);

  const seen = new Set<string>();
  const ownedWorkbooks = new Map<string, string>();
  let legacyOwner = '';

  for (const application of registry.applications) {
    const id = application?.applicationId;
    if (typeof id !== 'string' || !APPLICATION_ID.test(id)) {
      throw new Error(`${source}: applicationId ${JSON.stringify(id)} must be a lowercase slug `
        + 'like "my-application" - letters, digits and hyphens, starting with a letter.');
    }
    if (RESERVED_APPLICATION_IDS.has(id)) {
      throw new Error(`${source}: applicationId "${id}" is reserved - a directory of that name `
        + 'already means something else under one of the scoped roots. Choose another name.');
    }
    if (seen.has(id))
      throw new Error(`${source}: applicationId "${id}" is declared twice.`);
    seen.add(id);

    if (!application.displayName?.trim())
      throw new Error(`${source}: application "${id}" has no displayName.`);

    // THE FLAT DIRECTORIES HAVE AT MOST ONE OWNER. Two claimants would put both
    // applications' Page Objects, knowledge and generated specs in one directory and
    // make every lookup there ambiguous - which is the precise contamination the scope
    // layer exists to prevent, arriving through a registry field instead of a code path.
    // Refused here, where every read already passes, rather than discovered later.
    if (application.legacyLayout !== undefined && typeof application.legacyLayout !== 'boolean')
      throw new Error(`${source}: legacyLayout on "${id}" must be true or false.`);
    if (application.legacyLayout) {
      if (legacyOwner) {
        throw new Error(`${source}: both "${legacyOwner}" and "${id}" declare legacyLayout. `
          + 'The unscoped artefact directories can have at most one owner - everything else '
          + 'resolves to <dir>/<applicationId>.');
      }
      legacyOwner = id;
    }

    const environments = application.environments;
    if (!environments || typeof environments !== 'object' || !Object.keys(environments).length)
      throw new Error(`${source}: application "${id}" declares no environments.`);

    for (const [environmentId, environment] of Object.entries(environments)) {
      if (!ENVIRONMENT_ID.test(environmentId))
        throw new Error(`${source}: environmentId "${environmentId}" on "${id}" must be a lowercase slug.`);
      if (!environment?.baseUrl?.trim())
        throw new Error(`${source}: environment "${environmentId}" on "${id}" has no baseUrl.`);
      try {
        void new URL(environment.baseUrl);
      } catch {
        throw new Error(`${source}: baseUrl ${JSON.stringify(environment.baseUrl)} on `
          + `"${id}/${environmentId}" is not a URL. Include the scheme.`);
      }
      // A credential VALUE in this file would be a committed secret. Variable names
      // only - an "@" or a lower-case value is the tell, the same check authoring.ts
      // applies to Authentication Profile.
      for (const [field, name] of Object.entries(environment.credentials ?? {})) {
        if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
          throw new Error(`${source}: credentials.${field} on "${id}/${environmentId}" must be an `
            + `environment VARIABLE NAME like APPLICATION_EMAIL, not a value. Got ${JSON.stringify(name)}.`);
        }
      }
    }

    if (!environments[application.defaultEnvironmentId]) {
      throw new Error(`${source}: application "${id}" names default environment `
        + `"${application.defaultEnvironmentId}", which it does not declare.`);
    }

    // One workbook belongs to exactly one application. Enforced here rather than
    // discovered later, because a workbook claimed twice makes `workbookOwner` a
    // partial function and every test-case lookup through it ambiguous.
    for (const workbook of application.workbooks ?? []) {
      const key = normaliseWorkbook(workbook);
      const owner = ownedWorkbooks.get(key);
      if (owner)
        throw new Error(`${source}: workbook "${workbook}" is claimed by both "${owner}" and "${id}". `
          + 'A workbook belongs to exactly one application.');
      ownedWorkbooks.set(key, id);
    }
  }

  return registry;
}

/** Repo-relative, forward slashes, no leading "./" - so two spellings of one path match. */
export function normaliseWorkbook(workbook: string): string {
  const absolute = path.isAbsolute(workbook) ? workbook : path.join(ROOT, workbook);
  return path.relative(ROOT, absolute).replace(/\\/g, '/').toLowerCase();
}

export function applications(registry: Registry = readRegistry()): ApplicationConfig[] {
  return registry.applications;
}

export function findApplication(applicationId: string, registry: Registry = readRegistry()): ApplicationConfig | null {
  return registry.applications.find(application => application.applicationId === applicationId) ?? null;
}

/**
 * The application that owns a workbook.
 *
 * Only an explicit declaration grants ownership. An unlisted workbook remains
 * unowned at every registry size, including the first application's onboarding.
 */
export function workbookOwner(workbook: string, registry: Registry = readRegistry()): string {
  const key = normaliseWorkbook(workbook);
  for (const application of registry.applications) {
    if ((application.workbooks ?? []).some(owned => normaliseWorkbook(owned) === key))
      return application.applicationId;
  }
  throw new Error(`No application in the registry declares workbook "${workbook}". `
    + `Add it to one of: ${registry.applications.map(a => a.applicationId).join(', ')}.`);
}

/**
 * Declare a new application.
 *
 * THE FOUNDATION FOR "ADD PROJECT", and deliberately only that: it writes the
 * registry, and everything else follows from the registry on its own. There is no
 * scaffolding step, no directory creation and no template - `ScopePaths` derives every
 * location from the applicationId, so a project becomes selectable and its artefacts
 * resolve the moment this returns. A registry entry IS the project.
 *
 * VALIDATED AS A WHOLE, NEVER FIELD BY FIELD. The candidate is appended to the current
 * registry and the COMBINED document goes through `validateRegistry` - the same
 * function `readRegistry` uses - so a duplicate applicationId, a reserved name, a
 * workbook already claimed by another application and a credential VALUE written where
 * a variable name belongs are all refused by the rules that already exist, rather than
 * by a second set written here that could drift from them.
 *
 * Written atomically: a temp file in the same directory, then a rename. A half-written
 * registry is worse than none, because `readRegistry` would throw and every scoped
 * operation in the repository would stop - including the ones for applications that
 * were already working.
 */
export function addApplication(candidate: unknown, file: string = registryFile()): Registry {
  const registry = readRegistry(file);
  const application = candidate as ApplicationConfig;
  if (!application || typeof application !== 'object')
    throw new Error('A project needs applicationId, displayName, defaultEnvironmentId and environments.');

  const next: Registry = {
    ...registry,
    applications: [...registry.applications, application],
  };
  const validated = validateRegistry(next, path.relative(ROOT, file).replace(/\\/g, '/'));

  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
  return validated;
}

/** The base URL for an environment, with its declared env-var override applied. */
export function baseUrlFor(application: ApplicationConfig, environmentId: string): string {
  const environment = application.environments[environmentId];
  if (!environment) {
    throw new Error(`Application "${application.applicationId}" has no environment "${environmentId}". `
      + `Declared: ${Object.keys(application.environments).join(', ')}.`);
  }
  const override = environment.baseUrlEnv ? process.env[environment.baseUrlEnv]?.trim() : '';
  return override || environment.baseUrl;
}
