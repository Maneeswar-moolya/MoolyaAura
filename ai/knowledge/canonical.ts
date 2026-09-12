/**
 * One page, one identity, one file.
 *
 * Phase 4's benchmark produced `dashboard.yaml` and `dashboard-tabs.yaml` for the
 * same screen on two different runs, because the file name was a *suggestion* and
 * the agent invented its own when the directory looked empty. Two files for one
 * screen is worse than none: the second one is written by somebody who could not
 * see the first, so it re-explores what was already known and the two drift.
 *
 * The fix is to stop naming pages after what a row happens to call them and name
 * them after where they are. A route is a fact about the application; "dashboard
 * tabs" is a description of one row's interest in it.
 *
 *   application  bugasura      (declared in ai/projects/registry.json - NOT the URL)
 *   route        /apps
 *   identity     bugasura__apps
 *
 * Derivation order, most stable first:
 *
 *   1. the declared route, with the application            bugasura__apps
 *   2. the file's explicit `page.id`, when it has no route  bugasura__language-picker
 *   3. a Page Object class name, when there is nothing else bugasura__projects
 *
 * The application is always part of it, so one identity cannot mean two things in
 * two environments. Route and route+application are therefore the same rule here
 * rather than two.
 *
 * WHAT THIS COST, AND WHY IT IS STILL RIGHT
 *
 * Applying it to the four existing files collapsed them to two, because
 * `create-project.yaml` and `dashboard-tabs.yaml` both declared `/apps`, and
 * `login.yaml` and `language-picker.yaml` both declared `/`. That is not an
 * artefact of the rule - it is the duplication the rule exists to find. Both
 * `/apps` files documented the same `WorkspacePage.sectionHeader()` heading
 * behaviour, in their own words, from separate explorations.
 *
 * The cost is real and is recorded in the phase report: a row that needs only the
 * sign-in form now also receives the language picker, because they are the same
 * screen. Nothing is lost, but a narrow row carries a wider file.
 */

import path from 'node:path';

import { BASE_URL } from '../../tests-e2e/support/env';
import { activeKnowledgePageDir, type PageKnowledge } from './page-knowledge';
import { activeScope, onScopeChange, resetActiveScope, ScopeError } from '../projects/scope';

const ROOT = process.cwd();

/**
 * LEGACY. The application's short name, guessed from the base URL.
 *
 * `my.bugasura.io` -> `bugasura`: the label before the public suffix.
 *
 * THIS IS NO LONGER THE AUTHORITATIVE APPLICATION IDENTITY. It was, and that was a
 * category error: a base URL is CONFIGURATION. It changes between environments, so a
 * staging host on a different domain silently renamed the namespace and orphaned
 * every artefact filed under the old name; and two applications behind one host or
 * one reverse proxy collapsed into a single identity, which is the cross-application
 * contamination the whole scope model exists to prevent.
 *
 * Identity is now DECLARED in `ai/projects/registry.json` and selected by a person.
 * See `activeApplicationId()` below.
 *
 * WHERE THE FALLBACK IS STILL USED, AND FOR HOW LONG
 *
 * Exactly one place: `activeApplicationId()`, and only when the registry cannot be
 * read at all - a checkout with no `ai/projects/registry.json`. It exists so that
 * cloning this repository at an older commit, or before the registry lands, does not
 * break page identity outright. It is temporary. Once every caller threads a scope,
 * this function and that catch block should both be deleted; nothing else may call
 * it, and nothing does.
 */
export function applicationSlug(baseUrl: string = BASE_URL): string {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return slug(baseUrl) || 'app';
  }
  const labels = host.split('.').filter(Boolean);
  if (labels.length >= 2)
    return slug(labels[labels.length - 2]);
  return slug(host) || 'app';
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The application component of a canonical identity, for a caller that did not
 * supply one.
 *
 * Resolution order, and it is not a search:
 *
 *   1. the active ApplicationScope's applicationId   declared, authoritative
 *   2. applicationSlug(BASE_URL)                     LEGACY, registry missing only
 *
 * A caller that knows its scope passes `source.application` and never reaches here.
 * This default serves the callers that have not been threaded yet - `mapping sync`,
 * the knowledge CLI - all of which run against the sole registered application, so
 * step 1 answers correctly for them today.
 *
 * Cached because `canonicalIdentity` is called per element while building a page
 * index, and re-reading the registry each time would be pure waste. `resetActiveApplication`
 * exists for the dashboard, which is one long-lived process that can switch projects.
 */
let cachedApplicationId: string | null = null;

// DIE WITH THE SCOPE. This memo is derived from `activeScope().applicationId`, so a scope
// change without this leaves it answering with the previous application - and page
// identity names every knowledge file, so the next one written would be filed under the
// wrong application. Registered rather than called by name because `scope.ts` cannot
// import this module: this one imports it.
onScopeChange(() => { cachedApplicationId = null; });

export function activeApplicationId(): string {
  if (cachedApplicationId)
    return cachedApplicationId;
  try {
    cachedApplicationId = activeScope().applicationId;
  } catch (error) {
    // A ScopeError IS NEVER SWALLOWED. It means "more than one application is
    // registered and nobody said which" or "no application called that" - the two
    // questions the registry exists to REFUSE. Falling back here would answer them
    // by deriving the identity from the URL, which is the derivation this whole
    // module was rewritten to abolish, and it would do it silently: every page
    // identity, and so every knowledge file, would be filed under a name nobody
    // chose. Only a missing registry reaches the legacy path.
    if (error instanceof ScopeError)
      throw error;
    // LEGACY: no registry in this checkout. See applicationSlug's header.
    cachedApplicationId = applicationSlug();
  }
  return cachedApplicationId;
}

/** Drop the memo - the dashboard switches projects inside one process. */
export function resetActiveApplication(): void {
  cachedApplicationId = null;
  resetActiveScope();
}

/**
 * A route as an identifier component.
 *
 * Query and fragment are dropped: `/?go=login` and `/` are the same screen reached
 * two ways, and keying on the query string would recreate the duplication this
 * module removes. An empty or `/` route is `root`, which is a name rather than an
 * empty string in the middle of an identifier.
 */
export function routeSlug(route: string): string {
  const withoutQuery = route.split(/[?#]/)[0].trim();
  const cleaned = slug(withoutQuery);
  return cleaned || 'root';
}

export interface CanonicalIdentity {
  id: string;
  /** Which of the three derivations produced it, for the audit. */
  from: 'route' | 'page-id' | 'page-object';
  reason: string;
}

/** The canonical identity for a screen, from whatever is known about it. */
export function canonicalIdentity(source: {
  route?: string;
  pageId?: string;
  pageObject?: string;
  application?: string;
}): CanonicalIdentity {
  const application = source.application ?? activeApplicationId();

  const route = source.route?.trim();
  if (route) {
    return {
      id: `${application}__${routeSlug(route)}`,
      from: 'route',
      reason: `route ${route} on ${application}`,
    };
  }
  if (source.pageId?.trim()) {
    return {
      id: `${application}__${slug(source.pageId)}`,
      from: 'page-id',
      reason: `declared page id "${source.pageId}" (no route declared)`,
    };
  }
  if (source.pageObject?.trim()) {
    const stem = source.pageObject.replace(/Page$/, '');
    return {
      id: `${application}__${slug(stem)}`,
      from: 'page-object',
      reason: `derived from ${source.pageObject} (no route or page id known)`,
    };
  }
  return { id: `${application}__unknown`, from: 'page-object', reason: 'nothing identified the screen' };
}

/**
 * Repo-relative path of the one file a canonical identity may live in.
 *
 * READ/WRITE SYMMETRY. This names where knowledge is WRITTEN, and
 * `readAllPageKnowledge` decides where knowledge is READ. They must be the same
 * directory or the generator writes a file it will never see again: the write lands
 * in the flat `ai/knowledge/page/`, the read looks in the active application's
 * directory, finds nothing for the screen, and concludes it has to explore from
 * scratch - re-exploring a screen it had already written down, which is the exact
 * failure this module exists to prevent. So both go through the active scope, and
 * `PAGE_DIR` is reached only as the no-registry legacy fallback inside
 * `activeKnowledgePageDir`.
 */
export function canonicalFile(id: string): string {
  return path.relative(ROOT, path.join(activeKnowledgePageDir(), `${id}.yaml`)).replace(/\\/g, '/');
}

export interface PageIndexEntry {
  canonicalId: string;
  file: string;
  route: string;
  declaredId: string;
  name: string;
  authenticationRequired: boolean;
  approxTokens: number;
}

export interface PageIndex {
  entries: PageIndexEntry[];
  /** canonicalId -> the files claiming it. More than one is a duplicate. */
  byCanonicalId: Map<string, PageIndexEntry[]>;
  duplicates: Array<{ canonicalId: string; files: string[] }>;
}

/**
 * The deterministic index of what is already known, keyed by identity.
 *
 * This is what makes duplicate detection cheap: the question "does a file for this
 * screen already exist?" is a map lookup on the route, not a model reading four
 * YAML files and forming an opinion. It is rebuilt from the directory every time,
 * so it cannot go stale.
 */
export function buildPageIndex(all: PageKnowledge[]): PageIndex {
  const entries = all.map(knowledge => ({
    canonicalId: canonicalIdentity({ route: knowledge.route, pageId: knowledge.id }).id,
    file: knowledge.file,
    route: knowledge.route,
    declaredId: knowledge.id,
    name: knowledge.name,
    authenticationRequired: knowledge.authenticationRequired,
    approxTokens: knowledge.approxTokens,
  }));

  const byCanonicalId = new Map<string, PageIndexEntry[]>();
  for (const entry of entries) {
    const list = byCanonicalId.get(entry.canonicalId) ?? [];
    list.push(entry);
    byCanonicalId.set(entry.canonicalId, list);
  }

  const duplicates = [...byCanonicalId.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([canonicalId, list]) => ({ canonicalId, files: list.map(entry => entry.file) }));

  return { entries, byCanonicalId, duplicates };
}

/**
 * The block that goes in the prompt so the agent cannot invent a second name.
 *
 * Deliberately tiny - identity, route, file, size - because its whole job is to
 * answer "does this screen already have a file, and what is it called?" It is the
 * deterministic alternative to letting the agent read the directory and decide.
 */
export function toPromptBlock(index: PageIndex, target: { id: string; file: string; exists: boolean } | null): string {
  const lines = ['===== PAGE KNOWLEDGE INDEX (one file per screen, named by route) ====='];
  if (!index.entries.length) {
    lines.push('(nothing recorded yet)');
  } else {
    for (const entry of index.entries) {
      lines.push(`  ${entry.canonicalId.padEnd(24)} route ${(entry.route || '?').padEnd(10)} ` +
        `${entry.file}  (~${entry.approxTokens} tok)`);
    }
  }
  if (target) {
    lines.push('',
        target.exists
          ? `This row's screen is ${target.id}, and its file EXISTS: ${target.file}.`
            + ' If you learn something new about that screen, EDIT that file. Do not create another'
            + ' file for it under a different name - one screen, one file, named after its route.'
          : `This row's screen is ${target.id}. If you have to explore it, write what you learn to`
            + ` EXACTLY ${target.file} - the name is derived from the route, not chosen.`);
  }
  return lines.join('\n');
}

/** Human-readable, for the run log. */
export function describeDuplicates(index: PageIndex): string {
  if (!index.duplicates.length)
    return '';
  return index.duplicates
      .map(duplicate => `  DUPLICATE page knowledge: ${duplicate.canonicalId} is claimed by ` +
        `${duplicate.files.join(' and ')} - merge them into ${canonicalFile(duplicate.canonicalId)}\n`)
      .join('');
}
