/** User-authored code is retained independently of deterministic knowledge. */
import fs from 'node:fs';
import path from 'node:path';
import { activeScope, type ApplicationScope } from '../projects/scope';
export type AuthoredStatus = 'USER AUTHORED — VALIDATED' | 'USER AUTHORED — NOT VALIDATED';
export interface ManualMethod { owner: string; method: string; status: AuthoredStatus }
export function manualStatusPath(scope: ApplicationScope) { return path.join(scope.paths.knowledgePageDir, '.authoring-validation.json'); }
export function manualMethods(scope: ApplicationScope = activeScope()): ManualMethod[] {
  const file = manualStatusPath(scope);
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.applicationId !== scope.applicationId) throw Error('Foreign manual authoring metadata.');
  return data.methods;
}
export function manualStatusText(scope: ApplicationScope, updates: ManualMethod[]): string {
  const methods = manualMethods(scope).filter(old => !updates.some(next => next.owner === old.owner && next.method === old.method));
  return JSON.stringify({ applicationId: scope.applicationId, methods: [...methods, ...updates] }, null, 2);
}
