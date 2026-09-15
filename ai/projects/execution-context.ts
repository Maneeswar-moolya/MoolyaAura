/** One validated execution choice, independent of process transport and credential storage. */
import { readRegistry, type Registry, type ApplicationConfig } from './registry';
import { resolveScope, type ApplicationScope } from './scope';
import { resolveExecutionData, type ExecutionSelection } from '../test-data/execution';
import { LOCATOR_TIMEOUT_MS } from '../../tests-e2e/support/locator-policy';

export interface ExecutionContext {
  applicationId: string;
  environmentId: string;
  sourceEnvironmentId: string;
  credentialProfileId?: string;
  dataProfileId?: string;
  executionRowId?: string;
  browserEngine: 'chromium' | 'firefox' | 'webkit';
  browserChannel?: 'chrome' | 'msedge';
  headed: boolean;
  locatorTimeoutMs: number;
}
export type ExecutionContextInput = Partial<ExecutionContext>;
export class ExecutionConfigurationError extends Error {
  constructor(readonly code: 'SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE' | 'CREDENTIAL_CONFIGURATION_FAILURE' | 'BROWSER_CONFIGURATION_FAILURE' | 'EXECUTION_CONFIGURATION_FAILURE', message: string) {
    super(`${code}: ${message}`);
  }
}
export function defaultSourceEnvironment(application: ApplicationConfig): string | undefined {
  const ids = Object.keys(application.environments);
  return application.defaultSourceEnvironmentId ?? (ids.length === 1 ? ids[0] : undefined);
}
export function resolveExecutionContext(scope: ApplicationScope, input: ExecutionContextInput = {}, selection?: ExecutionSelection, registry: Registry = readRegistry()): ExecutionContext {
  if ((input.applicationId !== undefined && input.applicationId !== scope.applicationId) ||
      (input.environmentId !== undefined && input.environmentId !== scope.environmentId))
    throw new ExecutionConfigurationError('EXECUTION_CONFIGURATION_FAILURE', 'Execution context belongs to another application or target environment.');
  // Resolving against the registry validates both declared identities; a URL cannot grant ownership.
  resolveScope({applicationId:scope.applicationId, environmentId:scope.environmentId}, registry);
  const application = registry.applications.find(app => app.applicationId === scope.applicationId)!;
  const sourceEnvironmentId = input.sourceEnvironmentId ?? defaultSourceEnvironment(application);
  if (!sourceEnvironmentId || !Object.hasOwn(application.environments, sourceEnvironmentId))
    throw new ExecutionConfigurationError('SOURCE_ENVIRONMENT_CONFIGURATION_FAILURE',
      `Application ${scope.applicationId}; target environment ${scope.environmentId}; source environment ${sourceEnvironmentId ? 'is not configured in this application' : '= not selected'}. Select a configured Source Environment.`);
  const browserEngine = input.browserEngine ?? 'chromium';
  const browserChannel = input.browserChannel || undefined;
  if (!['chromium','firefox','webkit'].includes(browserEngine) ||
      (browserChannel && (browserEngine !== 'chromium' || !['chrome','msedge'].includes(browserChannel))) ||
      (input.headed !== undefined && typeof input.headed !== 'boolean'))
    throw new ExecutionConfigurationError('BROWSER_CONFIGURATION_FAILURE', 'Select a supported browser engine, compatible channel and Headed/Headless mode.');
  if (input.locatorTimeoutMs !== undefined && input.locatorTimeoutMs !== LOCATOR_TIMEOUT_MS)
    throw new ExecutionConfigurationError('EXECUTION_CONFIGURATION_FAILURE', 'The framework locator timeout policy cannot be overridden.');
  if (selection) {
    const resolved = resolveExecutionData(scope, selection);
    for (const [key, actual] of Object.entries({credentialProfileId:resolved.executionProfile.credentialProfileId,
      dataProfileId:resolved.executionProfile.dataProfileId, executionRowId:resolved.executionProfile.executionRowId}))
      if (input[key as keyof ExecutionContext] !== undefined && input[key as keyof ExecutionContext] !== (actual ?? undefined))
        throw new ExecutionConfigurationError('CREDENTIAL_CONFIGURATION_FAILURE', 'Execution context and selected data row disagree.');
  } else if (input.credentialProfileId || input.dataProfileId || input.executionRowId) {
    throw new ExecutionConfigurationError('CREDENTIAL_CONFIGURATION_FAILURE', 'Select the corresponding execution data row before running.');
  }
  return Object.freeze({applicationId:scope.applicationId, environmentId:scope.environmentId, sourceEnvironmentId,
    ...(selection?.row.credentialProfileId ? {credentialProfileId:selection.row.credentialProfileId} : {}),
    ...(selection?.row.dataProfileId ? {dataProfileId:selection.row.dataProfileId} : {}),
    ...(selection ? {executionRowId:selection.row.id} : {}),
    browserEngine, ...(browserChannel ? {browserChannel} : {}), headed:input.headed ?? false, locatorTimeoutMs:LOCATOR_TIMEOUT_MS});
}
/** Deserialize once at an external process boundary. All internal calls take the object. */
export function executionContextFromTransport(scope: ApplicationScope, selection?: ExecutionSelection, overrides: ExecutionContextInput = {}): ExecutionContext {
  let input: ExecutionContextInput = {};
  if (process.env.AURA_EXECUTION_CONTEXT) {
    try { input = JSON.parse(process.env.AURA_EXECUTION_CONTEXT); }
    catch { throw new ExecutionConfigurationError('EXECUTION_CONFIGURATION_FAILURE', 'Invalid execution context transport.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new ExecutionConfigurationError('EXECUTION_CONFIGURATION_FAILURE', 'Invalid execution context transport.');
  } else if (process.env.AURA_SOURCE_ENVIRONMENT) input.sourceEnvironmentId = process.env.AURA_SOURCE_ENVIRONMENT;
  return resolveExecutionContext(scope, {...input, ...overrides}, selection);
}
export function executionSelectionFromTransport(): ExecutionSelection | undefined {
  if (!process.env.AURA_EXECUTION_SELECTION) return undefined;
  try { return JSON.parse(process.env.AURA_EXECUTION_SELECTION); }
  catch { throw new ExecutionConfigurationError('CREDENTIAL_CONFIGURATION_FAILURE', 'Invalid execution selection transport.'); }
}
/** Environment variables are transport only. Empty selectors prevent inherited profile leakage. */
export function executionEnvironment(context: ExecutionContext, selection?: ExecutionSelection): Record<string,string> {
  return {AURA_EXECUTION_CONTEXT:JSON.stringify(context), AURA_APPLICATION:context.applicationId,
    AURA_ENVIRONMENT:context.environmentId, AURA_SOURCE_ENVIRONMENT:context.sourceEnvironmentId,
    AURA_EXECUTION_SELECTION:selection ? JSON.stringify(selection) : '',
    EXCEL_ALL_BROWSERS:context.browserEngine === 'chromium' ? '0' : '1'};
}
export function executionBrowserArgs(context: ExecutionContext): string[] {
  return [`--project=${context.browserEngine}`, ...(context.headed ? ['--headed'] : [])];
}
/** Scoped credentials are preflighted as a coherent pair, never mixed across sources. */
export function preflightAuthentication(scope: ApplicationScope, selection: ExecutionSelection | undefined, required: boolean): void {
  if (!required || selection?.row.credentialProfileId) return;
  const refs = scope.credentials;
  if (!refs?.email || !refs.password || !process.env[refs.email] || !process.env[refs.password])
    throw new ExecutionConfigurationError('CREDENTIAL_CONFIGURATION_FAILURE', 'Select an active credential profile supporting the target environment, or configure the application credential binding.');
}
