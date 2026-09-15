/** Environment configuration is application-owned. Values never enter the registry. */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readRegistry, registryFile, validateRegistry, type EnvironmentConfig } from './registry';
import { resetActiveScope } from './scope';

const SLUG = /^[a-z][a-z0-9-]*$/;
const REFERENCE = /^[A-Z][A-Z0-9_]*$/;
export function validBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw Error('Base URL is required');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw Error('Base URL must be an absolute HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw Error('Base URL must use HTTP/HTTPS without embedded credentials, query parameters or fragments');
  return url.href;
}
function reference(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !REFERENCE.test(value)) throw Error(`${label} must be an uppercase environment variable NAME, never a secret value`);
  return value;
}
export function saveEnvironment(applicationId: string, environmentId: string, input: any, create: boolean): EnvironmentConfig {
  if (!SLUG.test(applicationId) || !SLUG.test(environmentId)) throw Error('Application and environment IDs must be lowercase slugs');
  if (input?.applicationId !== applicationId) throw Error('Environment configuration belongs to the selected application');
  if (input?.environmentId && input.environmentId !== environmentId) throw Error('An environment ID cannot be renamed');
  const registry = readRegistry();
  const application = registry.applications.find(a => a.applicationId === applicationId);
  if (!application) throw Error('No such application');
  const exists = Object.hasOwn(application.environments, environmentId);
  if (create === exists) throw Error(create ? 'Environment already exists; edit it instead' : 'Environment does not belong to this application');
  if (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 100)
    throw Error('Environment display name is required (up to 100 characters)');
  const email = reference(input.credentials?.email, 'Email reference');
  const password = reference(input.credentials?.password, 'Password reference');
  if (Boolean(email) !== Boolean(password)) throw Error('Provide both credential references, or leave both empty for an unauthenticated environment');
  const baseUrlEnv = reference(input.baseUrlEnv, 'Base URL reference');
  const environment: EnvironmentConfig = { displayName: input.displayName.trim(), baseUrl: validBaseUrl(input.baseUrl),
    ...(baseUrlEnv ? {baseUrlEnv} : {}), ...(email && password ? {credentials:{email,password}} : {}) };
  application.environments = {...application.environments, [environmentId]:environment};
  validateRegistry(registry);
  const file = registryFile(), temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(registry,null,2)+'\n');
  try { fs.renameSync(temporary,file); } finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  resetActiveScope();
  return environment;
}
