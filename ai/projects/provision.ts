/**
 * Project provisioning: the transaction that turns a form into a usable project.
 *
 * A project IS a registry entry - `ScopePaths` derives every location from the
 * applicationId, so nothing has to be scaffolded for artefacts to resolve. What a
 * registry entry alone does NOT give you is somewhere to author test cases, and a
 * project with no workbook cannot enter the pipeline at all: the dashboard lists cases
 * from a workbook, `excel:run` selects from one, and generation reads its rows. So
 * provisioning is exactly two durable effects - one workbook, one registry entry - and
 * this module exists to make them succeed or fail together.
 *
 * ORDER, AND WHY IT IS THIS ONE
 *
 *   1. validate the whole candidate registry   (no writes; refuses before anything)
 *   2. create the workbook                     (refuses if the path is taken)
 *   3. write the registry atomically           (temp + rename, in `addApplication`)
 *   4. on any failure in 3, delete the workbook step 2 created
 *
 * The registry is written LAST because it is the only durable claim: until it names the
 * project, nothing resolves to it, and a leftover workbook is an unreferenced file
 * rather than a half-registered application. The reverse order fails badly - a registry
 * entry whose workbook could not be written is a project the dashboard offers and every
 * read of which then fails, and `readRegistry` throws for EVERY application if the file
 * it wrote is malformed.
 *
 * Step 4 removes only the file this call created, and only when it created it. A
 * pre-existing workbook is refused in step 2 and never deleted - a rollback that
 * removed somebody's authored test cases because a later step failed would be a far
 * worse outcome than the failure it was cleaning up after.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * No directories are created. `tests-e2e/pages/<id>`, `ai/knowledge/page/<id>`,
 * `ai/dashboard/recordings/<id>` and the rest come into being when something first
 * writes an artefact, and `layoutFor` resolves them either way. Creating them empty
 * would also change what `layoutFor` answers for the LEGACY application - it checks
 * `fs.existsSync(scoped)` first - so an empty directory is not free, it is a decision.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Workbook } from 'exceljs';

import { addCaseSheet, type CaseRow } from '../excel/workbook-template';
import {
  addApplication,
  type ApplicationConfig,
  normaliseWorkbook,
  readRegistry,
  type Registry,
  registryFile,
  validateRegistry,
} from './registry';
import { resetActiveScope } from './scope';

const ROOT = process.cwd();

export interface ProvisionRequest {
  applicationId?: unknown;
  displayName?: unknown;
  environmentId?: unknown;
  baseUrl?: unknown;
  /** Optional: `APPLICATION_EMAIL`-style variable NAMES, never values. */
  credentials?: { email?: unknown; password?: unknown };
}

export interface ProvisionResult {
  applicationId: string;
  displayName: string;
  environmentId: string;
  baseUrl: string;
  /** Repo-relative, forward slashes. */
  workbook: string;
  registry: Registry;
}

export class ProvisionError extends Error {}

/**
 * The workbook a new project gets.
 *
 * `excel/<applicationId>-test-cases.xlsx` follows the one convention already in the
 * repository (`excel/login-test-cases.xlsx`) and puts the applicationId in the name -
 * which is a CONVENIENCE for a person reading a directory listing and is never read
 * back as identity. Ownership is the registry's `workbooks` array; `workbookOwner`
 * consults that and nothing else, so renaming this file changes who owns it not at all.
 */
export function workbookPathFor(applicationId: string): string {
  return path.relative(ROOT, path.join(excelDir(), `${applicationId}-test-cases.xlsx`))
      .split(path.sep).join('/');
}

/**
 * Where workbooks live.
 *
 * `AURA_EXCEL_DIR` overrides it, for exactly the reason `AURA_REGISTRY_FILE` exists:
 * provisioning WRITES a file, and a fixture that exercises it must not put that file in
 * the repository's real `excel/` directory. Read per call rather than frozen at import,
 * so a test can redirect it inside one process; unset, it is the path it always was.
 */
function excelDir(): string {
  const override = process.env.AURA_EXCEL_DIR?.trim();
  return override ? path.resolve(ROOT, override) : path.join(ROOT, 'excel');
}

/** A single starter row, so the sheet demonstrates its own contract. */
function starterRows(displayName: string): CaseRow[] {
  return [[
    'TC_SMOKE_001',
    'Smoke',
    'Sign in',
    `Open ${displayName} and confirm the sign-in page loads`,
    'The first case of a new project. Edit or delete it - it is here so the sheet shows '
      + 'the shape a row takes, not because it is worth running as written.',
    'The application is reachable',
    '1. Open the base URL\n2. Check the page has loaded',
    'url = /',
    'The sign-in page is displayed',
    'P2',
    'smoke',
    'Not Automated',
    '',
    'No',
  ]];
}

/**
 * Write the initial workbook.
 *
 * Refuses an existing path rather than overwriting authored workbook data.
 */
export async function provisionWorkbook(applicationId: string, displayName: string): Promise<string> {
  const relative = workbookPathFor(applicationId);
  const absolute = path.resolve(ROOT, relative);
  if (fs.existsSync(absolute)) {
    throw new ProvisionError(`${relative} already exists. Provisioning never overwrites a `
      + 'workbook - rename or remove that file, or choose a different project id.');
  }
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const workbook = new Workbook();
  workbook.creator = 'MoolyaAura';
  workbook.created = new Date();
  addCaseSheet(workbook, 'Test Cases', starterRows(displayName));
  await workbook.xlsx.writeFile(absolute);
  return relative;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new ProvisionError(`${field} is required.`);
  return value.trim();
}

/**
 * Build the candidate application. Validation itself is deliberately NOT done here.
 *
 * `validateRegistry` already refuses a malformed id, a reserved name, a duplicate, a
 * missing environment, a baseUrl with no scheme, a workbook another project claims and
 * a credential VALUE where a variable name belongs. Re-checking any of that here would
 * create a second set of rules that can drift from the one every READ goes through -
 * so this shapes the candidate and lets the existing gate judge it.
 */
export function candidateFor(request: ProvisionRequest): ApplicationConfig {
  const applicationId = requireString(request.applicationId, 'Project ID');
  const displayName = requireString(request.displayName, 'Project name');

  // TWO REQUEST SHAPES, ONE CANDIDATE.
  //
  // The Add Project form sends the four fields a person types - one environment, named
  // and addressed. An API caller may instead send the full `environments` map, which is
  // what the registry itself stores and what a project with several environments or
  // declared credential VARIABLE NAMES needs. Neither is validated here: both are shaped
  // into a candidate and handed to `validateRegistry`, so the richer form cannot smuggle
  // anything past the rules the simpler one obeys.
  let environments: ApplicationConfig['environments'];
  let environmentId: string;
  const supplied = (request as { environments?: unknown }).environments;
  if (supplied && typeof supplied === 'object' && Object.keys(supplied).length) {
    environments = supplied as ApplicationConfig['environments'];
    const declaredDefault = (request as { defaultEnvironmentId?: unknown }).defaultEnvironmentId;
    environmentId = typeof declaredDefault === 'string' && declaredDefault.trim()
      ? declaredDefault.trim()
      : Object.keys(environments)[0];
  } else {
    environmentId = requireString(request.environmentId, 'Environment');
    const baseUrl = requireString(request.baseUrl, 'Base URL');
    const credentials: Record<string, string> = {};
    if (typeof request.credentials?.email === 'string' && request.credentials.email.trim())
      credentials.email = request.credentials.email.trim();
    if (typeof request.credentials?.password === 'string' && request.credentials.password.trim())
      credentials.password = request.credentials.password.trim();
    environments = {
      [environmentId]: {
        baseUrl,
        ...(Object.keys(credentials).length ? { credentials } : {}),
      },
    };
  }

  return {
    applicationId,
    displayName,
    defaultEnvironmentId: environmentId,
    environments,
    // OWNERSHIP IS DECLARED AT CREATION, not discovered by listing `excel/` later.
    // `/api/workbooks` answers from this array, so a workbook that is not in it is not
    // selectable by anybody - which is what makes "fail closed" the default for a file
    // somebody drops into the directory by hand.
    workbooks: [workbookPathFor(applicationId)],
  };
}

/**
 * Provision a project: validate, create its workbook, register it, atomically.
 *
 * Returns the created project. Throws `ProvisionError` (or the registry's own error)
 * with nothing partially applied.
 */
export async function provisionProject(request: ProvisionRequest): Promise<ProvisionResult> {
  const candidate = candidateFor(request);

  // 1. VALIDATE THE WHOLE THING FIRST, with no side effect at all. `addApplication`
  //    validates too, but it validates immediately before writing - and by then the
  //    workbook exists. Validating here means the common failures (duplicate id,
  //    reserved name, bad URL) never create a file to roll back.
  const current = readRegistry();
  const proposed: Registry = {
    ...current,
    applications: [...current.applications, candidate],
  };
  // The same function `readRegistry` uses. A throw here is the refusal.
  validateRegistry(proposed, path.relative(ROOT, registryFile()).replace(/\\/g, '/'));

  // A second guard the registry cannot give us: the workbook path must be free. Checked
  // before the write so the error names the real problem rather than a filesystem one.
  const relative = workbookPathFor(candidate.applicationId);
  if (fs.existsSync(path.resolve(ROOT, relative))) {
    throw new ProvisionError(`${relative} already exists. Provisioning never overwrites a `
      + 'workbook - rename or remove that file, or choose a different project id.');
  }

  // 2. THE WORKBOOK.
  let created = '';
  try {
    created = await provisionWorkbook(candidate.applicationId, candidate.displayName);
  } catch (error) {
    throw error instanceof ProvisionError ? error
      : new ProvisionError(`The workbook could not be written: ${(error as Error).message}`);
  }

  // 3. THE REGISTRY, atomically (temp + rename inside `addApplication`).
  let registry: Registry;
  try {
    registry = addApplication(candidate);
  } catch (error) {
    // 4. ROLLBACK. Only the file THIS call created, and only because step 1 proved the
    //    path was free - so this can never remove a workbook somebody authored.
    try {
      fs.rmSync(path.resolve(ROOT, created), { force: true });
    } catch {
      // Reported as part of the failure below rather than thrown over it: the original
      // error is what the user has to act on, and a stranded file is recoverable.
    }
    throw new ProvisionError('The project was not created and nothing was left behind: '
      + `${(error as Error).message}`);
  }

  // The set of registered applications is exactly what the active scope was memoised
  // from, so a new project changes whether an unscoped request is answerable at all.
  resetActiveScope();

  const environmentId = candidate.defaultEnvironmentId;
  return {
    applicationId: candidate.applicationId,
    displayName: candidate.displayName,
    environmentId,
    baseUrl: candidate.environments[environmentId].baseUrl,
    workbook: normaliseWorkbook(created),
    registry,
  };
}

/**
 * The workbooks one application owns, as repo-relative paths that exist.
 *
 * THE REGISTRY IS AUTHORITATIVE, and a listing of `excel/` is not. Once two projects
 * exist, a directory listing answers "what files are there", which is a different
 * question from "what may this project select" - and answering the first for the second
 * is how a Bugasura workbook becomes selectable by another project and its rows get
 * generated, run and written back under the wrong application.
 *
 * A declared workbook that is missing from disk is omitted rather than offered: it
 * cannot be opened, and listing it would produce a selection that fails on use.
 */
export function workbooksFor(applicationId: string, registry: Registry = readRegistry()): string[] {
  const application = registry.applications
      .find(entry => entry.applicationId === applicationId);
  if (!application)
    return [];
  return (application.workbooks ?? [])
      .map(workbook => normaliseWorkbook(workbook))
      .filter(workbook => fs.existsSync(path.resolve(ROOT, workbook)))
      .sort();
}

/**
 * Workbooks on disk that no application claims.
 *
 * Reported, never assigned. Silently attributing an undeclared file to whoever happens
 * to be selected is precisely the identity-by-filename this architecture refuses, and
 * the honest outcome for an unowned workbook is that a person says who owns it.
 */
export function unownedWorkbooks(registry: Registry = readRegistry()): string[] {
  const dir = excelDir();
  if (!fs.existsSync(dir))
    return [];
  const claimed = new Set(registry.applications
      .flatMap(application => (application.workbooks ?? []).map(normaliseWorkbook)));
  return fs.readdirSync(dir)
      .filter(name => name.endsWith('.xlsx') && !name.startsWith('~$'))
      .map(name => normaliseWorkbook(path.join(dir, name)))
      .filter(workbook => !claimed.has(workbook))
      .sort();
}
