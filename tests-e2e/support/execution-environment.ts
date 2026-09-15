/** Bind navigation at the API boundary, not by rewriting recorded source text. */
import { readRegistry } from '../../ai/projects/registry';
import { activeScope } from '../../ai/projects/scope';
import { executionContextFromTransport, executionSelectionFromTransport } from '../../ai/projects/execution-context';

export function executionUrl(raw: string): string {
  if (!process.env.AURA_RUN_ID) return raw;
  const scope = activeScope();
  const application = readRegistry().applications.find(a => a.applicationId === scope.applicationId)!;
  const sourceId = executionContextFromTransport(scope,executionSelectionFromTransport()).sourceEnvironmentId;
  const target = new URL(scope.baseUrl);
  const source = new URL(application.environments[sourceId].baseUrl);
  const candidate = new URL(raw, target);
  const under = (url: URL, base: URL) => url.origin === base.origin && (url.pathname === base.pathname.replace(/\/$/,'') || url.pathname.startsWith(base.pathname.endsWith('/') ? base.pathname : base.pathname+'/'));
  if (under(candidate, target)) return candidate.href;
  if (under(candidate, source)) {
    const prefix = source.pathname.replace(/\/$/,'');
    const suffix = candidate.pathname.slice(prefix.length).replace(/^\//,'');
    const bound = new URL(target.href.endsWith('/') ? target.href : target.href+'/');
    bound.pathname = bound.pathname + suffix;
    bound.search = candidate.search; bound.hash = candidate.hash;
    return bound.href;
  }
  throw Error('Navigation URL is outside the selected source/target environment. Use the configured base URL or an application-relative route.');
}
