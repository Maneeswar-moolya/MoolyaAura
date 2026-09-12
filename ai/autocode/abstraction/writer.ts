/**
 * Phase 3: write the method a PROPOSED abstraction describes.
 *
 *   npx tsx ai/autocode/abstraction/writer.ts --dry    # show the diff, write nothing
 *   npx tsx ai/autocode/abstraction/writer.ts          # apply, verify, roll back on failure
 *
 * ONLY `PROPOSED` is eligible. NEEDS_REVIEW, REFUSED, REUSE and TEST_DATA are never
 * written, and an existing method always wins - the decision order is settled before
 * this module is reached and is not revisited here.
 *
 * There is no model call in this file or anything it imports.
 *
 * WHAT MAKES THIS SAFE TO RUN.
 *
 * Nothing is written until everything has been rendered and checked in memory. The
 * writer builds the complete new contents of every file it would touch, validates
 * each one, and only then writes - so a proposal that fails validation leaves the
 * repository exactly as it was rather than half-edited. After writing, the framework
 * index and the knowledge files are rebuilt and the method is looked up through the
 * real matcher; if that lookup fails, every file is restored from the copy taken
 * before the write.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not touch a generated spec, a recording,
 * the workbook, mapping.json, state.json or fixtures.ts. Creating the abstraction and
 * REWRITING THE TESTS THAT COULD USE IT are different decisions, and only the first
 * one is this phase.
 */

import * as fs from 'fs';
import * as path from 'path';

import { analyseIdentifier } from '../locator-quality';
import { provesIdentity } from '../dom-evidence';
import { buildIndex } from '../../knowledge/index';
import { readAllPageKnowledge } from '../../knowledge/page-knowledge';
import { activeScope, activeScopePath, isWithinScope, ScopeError } from '../../projects/scope';
import { canonicalFile } from '../../knowledge/canonical';
import { classDerivedName, forbiddenMechanisms } from './validate';
import { ownerNoun } from './naming';
import { analyseCorpus } from './propose';
import type { Proposal } from './types';

const ROOT = process.cwd();

/**
 * WHERE THIS WRITER IS ALLOWED TO WRITE.
 *
 * These were three module constants naming the flat directories, and every one of
 * them is an application-owned artefact class: Page Objects, page knowledge, and the
 * fixtures module a spec destructures them from. That mattered more here than
 * anywhere else in the codebase, because this is the only module that WRITES all
 * three, and a write that lands outside the active scope is not a miss - it is one
 * application's method appended into another application's class.
 *
 * The three legacy paths below are the fallback for a checkout with no registry, and
 * nothing else: `activeScopePath` rethrows a ScopeError rather than answering an
 * ambiguous scope with a flat directory. Resolved per call rather than once at import
 * because the dashboard switches applications inside one process.
 */
const LEGACY_PAGES_DIR = path.join(ROOT, 'tests-e2e', 'pages');
const LEGACY_KNOWLEDGE_DIR = path.join(ROOT, 'ai', 'knowledge', 'page');
const LEGACY_FIXTURES_FILE = path.join(ROOT, 'tests-e2e', 'fixtures.ts');

export function pagesDir(): string {
  return activeScopePath('pagesDir', LEGACY_PAGES_DIR);
}

export function knowledgeDir(): string {
  return activeScopePath('knowledgePageDir', LEGACY_KNOWLEDGE_DIR);
}

export function fixturesFile(): string {
  return activeScopePath('fixturesFile', LEGACY_FIXTURES_FILE);
}

/**
 * The fixtures module a newly provisioned application starts with.
 *
 * EMPTY OF PAGE OBJECTS ON PURPOSE. An application owns its Page Objects, and it has none
 * until its own recordings produce them - so this seeds the NAMESPACE, not the content.
 * `registerFixture` then adds each class as it is created, anchoring on the marker below
 * rather than on an existing import group, which is what a first registration has none of.
 *
 * The framework half is imported from `tests-e2e/support/base-fixtures.ts` rather than
 * copied, because `ai/projects/scope.ts` is explicit that the framework is shared and
 * never duplicated per application. What this file adds is exactly what is
 * application-owned: the Page Object fixtures, and nothing else.
 *
 * `appCredentials` / `appEmail` are re-exported under neutral names. Bugasura's legacy
 * module calls them `bugasuraCredentials` / `bugasuraEmail`, a name no other application
 * can use honestly, and `tests-e2e/support/env.ts` already resolves WHICH variables they
 * read from the active application's own registry declaration.
 */
export const FIXTURE_IMPORT_MARKER = '// <page-object-imports>';
export const FIXTURE_PROPERTY_MARKER = '  // <page-object-fixtures>';

/**
 * THE NAME OF THIS APPLICATION'S CREDENTIALS FIXTURE, read from its own fixtures module.
 *
 * It used to be the literal `bugasuraCredentials`, hardcoded in three files. That is a
 * capability name belonging to ONE application, emitted into every application's specs -
 * so an authenticated case for a newly added project generated
 * `requireCredentials(bugasuraCredentials)` and destructured a fixture its own module does
 * not declare, which Playwright answers by refusing the whole file. Adding a project would
 * then have required editing framework source, which is precisely what provisioning exists
 * to avoid.
 *
 * DERIVED FROM THE ARTEFACT, not from the applicationId. The fixtures module is the thing
 * that decides what a spec may destructure, so it is the thing asked: the first declared
 * fixture whose name ends in `Credentials` wins. The legacy module declares
 * `bugasuraCredentials` and keeps working unchanged; a seeded module declares
 * `appCredentials`; an application that renames its own fixture is followed automatically.
 *
 * Null when the module declares none - the caller then emits no sign-in rather than a
 * reference to a fixture that does not exist.
 */
export function credentialsFixtureName(): string | null {
  const file = fixturesFile();
  if (!fs.existsSync(file))
    return null;
  const source = fs.readFileSync(file, 'utf8');
  const block = /(?:type|interface)\s+\w*Fixtures\w*\s*=?\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!block)
    return null;
  for (const match of block[1].matchAll(/^\s*(\w*[Cc]redentials)\s*[?:]/gm))
    return match[1];
  return null;
}

/**
 * MAKE SURE THIS APPLICATION HAS A FIXTURES MODULE, creating an empty one if not.
 *
 * THE INVARIANT: a generated spec imports its application's fixtures module
 * UNCONDITIONALLY (`from-recording.ts` writes `from '<...>/<app>.fixtures'` for every
 * spec), so that module must exist whenever a spec is written. It did not.
 *
 * The seed used to happen only inside `applyProposals`, in the loop over eligible
 * PROPOSALS - so it ran only when a Page Object was being created. A run whose every
 * element was refused for want of admissible evidence produced ZERO proposals, so the loop
 * body never executed, so no module was seeded - and the spec was still written, importing
 * a file that was guaranteed not to exist. That is exactly what happened to Flipkart's
 * TC_SMOKE_004: five elements correctly refused, a spec assembled from the recording, and
 * `Cannot find module '../../flipkart.fixtures'` at collection.
 *
 * Creating a Page Object and needing somewhere to destructure it from are two different
 * facts, and only the second one is what a spec depends on. So the module is ensured where
 * the run prepares its other output destinations, not as a side effect of writing a class.
 */
export function ensureFixturesModule(): { file: string; created: boolean } {
  const file = fixturesFile();
  if (fs.existsSync(file))
    return { file, created: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, emptyFixturesModule(), 'utf8');
  return { file, created: true };
}

export function emptyFixturesModule(): string {
  return `/**
 * Fixtures for this application's Excel-sourced tests.
 *
 * Created by the framework when this application registered its first Page Object. The
 * framework half - healing, step, trace, the require* guards - lives in
 * ./support/base-fixtures and is shared; everything below is owned by this application.
 *
 * The two markers are anchors the Page Object writer inserts at. Keep them.
 */

import type { HealingRecorder } from './support/resilient-locator';
import type { Credentials } from './support/env';
import {
  baseTest, expect, requireCredentials, requireDataMutationOptIn, requireEmail, trace,
  type StepFn, type Traceability,
} from './support/base-fixtures';

${FIXTURE_IMPORT_MARKER}

/**
 * DELIBERATELY NOT \`extends BaseFixtures\`. The framework index reads this block with
 * \`/(?:type|interface)\\s+\\w*Fixtures\\w*\\s*=?\\s*\\{([\\s\\S]*?)\\n\\}/\` (ai/knowledge/index.ts,
 * \`fixturesOf\`) to decide which fixtures a generated spec may destructure. An \`extends\`
 * clause hides the inherited ones from that regex, so \`staticCheck\` would refuse any spec
 * using \`step\` as an unknown fixture. These four are DECLARATIONS only - the
 * implementations are inherited from \`baseTest\` and are not repeated.
 */
interface Fixtures {
  healing: HealingRecorder;
  step: StepFn;
  appCredentials: Credentials | null;
  appEmail: string | null;
${FIXTURE_PROPERTY_MARKER}
}

export const test = baseTest.extend<Fixtures>({
${FIXTURE_PROPERTY_MARKER}
});

export { expect, requireCredentials, requireDataMutationOptIn, requireEmail, trace };
export type { StepFn, Traceability };
`;
}

/**
 * Classes that have no fixture ON PURPOSE, and must never be given one automatically.
 *
 * `BasePage` is the abstract base and `TermsPage` lives on a popup `Page` a fixture
 * would have to invent - both say so in their own headers. A writer that "helpfully"
 * registered either would be overturning a decision somebody made and documented, so a
 * proposal that needs a fixture for one of these is BLOCKED and says which.
 */
const NO_FIXTURE = new Set(['Base', 'BasePage', 'TermsPage']);

/** `IssuesPage` -> `issuesPage`. The same derivation `methodIsDeliverable` uses. */
export function fixtureFor(owner: string): string {
  return owner.charAt(0).toLowerCase() + owner.slice(1);
}

/** `IssuesPage` -> `issues.page.ts`, the repository's own file naming. */
export function pageFileFor(owner: string): string | null {
  const dir = pagesDir();
  if (!fs.existsSync(dir))
    return null;
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    if (new RegExp(`export\\s+class\\s+${owner}\\b`).test(source))
      return path.join(dir, name);
  }
  return null;
}

/** Where a class that does not exist yet would live: `NotificationsPanel` -> `notifications.panel.ts`. */
export function pageFilePathFor(owner: string): string {
  const words = owner.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);
  return path.join(pagesDir(), `${words.map(word => word.toLowerCase()).join('.')}.ts`);
}

/**
 * A new Page Object class, in the shape every existing one already has.
 *
 * DELIBERATELY EMPTY OF CAPABILITIES. It declares the constructor and nothing else;
 * the methods are appended by the same code path that appends to an existing class, so
 * there is exactly one method-writing path and a new class is not a second one.
 */
/**
 * WHERE THE FRAMEWORK IS, FROM WHERE THIS CLASS WILL BE.
 *
 * `BasePage` and the healing recorder are FRAMEWORK files, not application artefacts -
 * they are the shared capability every application's Page Objects are built on, and the
 * architecture contract permits resolving a declared shared capability across scopes. What
 * is not permitted is guessing where they are.
 *
 * They were guessed, with two fixed strings that are correct for exactly one layout: a
 * class written directly into `tests-e2e/pages/`. An application with its own scoped
 * directory puts the class one level deeper, and both strings then name files that do not
 * exist - which Playwright reports at COLLECTION, as `Cannot find module './base.page'`,
 * refusing the whole spec. Computing the path from the two real locations is the same
 * answer for the legacy layout and the right one for every other.
 *
 * Anchored on the fixtures module's own directory, because that is the layout root every
 * application already shares and it is resolved through the scope rather than spelled here.
 */
function frameworkImports(file: string): { base: string; support: string } {
  const layoutRoot = path.dirname(fixturesFile());
  const from = path.dirname(file);
  const to = (target: string) => {
    const relative = path.relative(from, target).split(path.sep).join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
  };
  return {
    base: to(path.join(layoutRoot, 'pages', 'base.page')),
    support: to(path.join(layoutRoot, 'support', 'resilient-locator')),
  };
}

export function renderPageObjectClass(
  owner: string,
  route: string | null,
  /**
   * Where the class will be written. Required: the imports are relative to it, and a
   * default would reintroduce the guess this exists to remove.
   */
  file: string,
): string {
  const imports = frameworkImports(file);
  return [
    '/**',
    ` * ${owner} - created by the abstraction engine from measured recordings.`,
    ' *',
    route ? ` * Route: ${route}` : ' * Route: declared by the knowledge file that owns this class.',
    ' *',
    ' * Every method below was written from a press-time measurement: one element, in the',
    ' * document the press happened in, and that element is the one acted on. Nothing here',
    ' * was hand-composed, and nothing here narrows by position.',
    ' */',
    '',
    "import type { Locator, Page } from '@playwright/test';",
    '',
    `import type { HealingRecorder } from '${imports.support}';`,
    `import { BasePage } from '${imports.base}';`,
    '',
    `export class ${owner} extends BasePage {`,
    '  constructor(page: Page, healing?: HealingRecorder) {',
    '    super(page, healing);',
    '  }',
    '}',
    '',
  ].join('\n');
}

/**
 * Is this class already reachable from a generated spec?
 *
 * Reads the `Fixtures` INTERFACE, because that is what `fixturesOf` in the knowledge
 * index reads and therefore what `methodIsDeliverable` ultimately consults. A factory
 * with no interface property is invisible to the index, so both halves are required
 * and `registerFixture` writes all three.
 */
export function fixtureRegistered(source: string, owner: string): boolean {
  const name = fixtureFor(owner);
  const declared = new RegExp(`^\\s*${name}\\s*[?:]`, 'm').test(source);
  const built = new RegExp(`^\\s*${name}\\s*:\\s*async`, 'm').test(source);
  return declared && built;
}

/**
 * Add the three declarations a Page Object fixture needs, or say why it cannot.
 *
 * THIS IS THE STEP WHOSE ABSENCE COLLECTED ZERO TESTS. A method written onto a class
 * with no fixture is not a missing improvement - it is a spec that destructures
 * `issuesPage`, a Playwright run that answers `Test has unknown parameter "issuesPage"`
 * and refuses the WHOLE FILE, and a failure that reads as a locator problem. The
 * fixtures file's own header records that happening.
 *
 * Returns the complete new source, or null with a reason. Never partially applied:
 * all three edits or none.
 */
export function registerFixture(source: string, owner: string):
{ source: string } | { problem: string } {
  if (NO_FIXTURE.has(owner))
    return { problem: `${owner} has no fixture by design, so no method may be written onto it` };
  if (fixtureRegistered(source, owner))
    return { source };

  const name = fixtureFor(owner);
  // DERIVED FROM THE TWO REAL PATHS, not spelled `./pages/` - the fixtures file and
  // the Page Object directory move independently under a scoped layout, and an import
  // that assumes they are siblings resolves to a file that is not there. `path.relative`
  // between the fixtures file's own directory and the class file is the only expression
  // that is correct in both layouts; POSIX separators because this is a module
  // specifier, not a filesystem path.
  const target = pageFilePathFor(owner);
  const fromDir = path.dirname(fixturesFile());
  const specifier = path.relative(fromDir, target).split(path.sep).join('/').replace(/\.ts$/, '');
  const relative = specifier.startsWith('.') ? specifier : `./${specifier}`;
  let next = source;

  // 1. THE IMPORT, inserted after the last existing Page Object import so the group
  //    stays together and alphabetical order is preserved where it already holds.
  if (!new RegExp(`import\\s*\\{\\s*${owner}\\s*\\}`).test(next)) {
    const imports = [...next.matchAll(/^import \{ \w+ \} from '[^']*\/pages\/[\w./-]+';$/gm)];
    const last = imports[imports.length - 1];
    if (last?.index !== undefined) {
      const at = last.index + last[0].length;
      next = `${next.slice(0, at)}\nimport { ${owner} } from '${relative}';${next.slice(at)}`;
    } else if (next.includes(FIXTURE_IMPORT_MARKER)) {
      // A SEEDED MODULE HAS NO IMPORT GROUP TO JOIN - this is the first Page Object the
      // application has ever had, and the marker is where the group begins.
      next = next.replace(FIXTURE_IMPORT_MARKER, `import { ${owner} } from '${relative}';`);
    } else {
      return { problem: 'the Page Object import group could not be located in fixtures.ts' };
    }
  }

  // 2. THE INTERFACE PROPERTY - the half the knowledge index reads.
  //
  // `export` is OPTIONAL in this pattern, and that is not tidiness: the repository's
  // own interface is declared `interface Fixtures {` with no `export`, so requiring it
  // located nothing and every registration reported "the Fixtures interface could not
  // be located". The shape matched here is deliberately the same one `fixturesOf` in
  // ai/knowledge/index.ts matches, because that is what decides whether the fixture is
  // visible to `methodIsDeliverable`.
  const iface = /((?:export\s+)?interface\s+Fixtures\s*\{)([\s\S]*?)(\n\})/.exec(next);
  if (!iface)
    return { problem: 'the Fixtures interface could not be located in fixtures.ts' };
  const property = `\n  /** Created by the abstraction engine, so generated specs can reach ${owner}. */`
    + `\n  ${name}: ${owner};`;
  next = next.slice(0, iface.index + iface[1].length + iface[2].length)
    + property + next.slice(iface.index + iface[1].length + iface[2].length);

  // 3. THE FACTORY, in the identical shape all five existing ones use.
  const factory = `\n  ${name}: async ({ page, healing }, use) => {\n`
    + `    await use(new ${owner}(page, healing));\n  },\n`;
  // The legacy module anchors on its own last factory; a seeded one anchors on the marker,
  // which is the only thing a module with no factories yet can offer.
  // Matched by SHAPE, not by name: the legacy module calls its credentials fixture
  // `bugasuraCredentials`, a seeded one calls it `appCredentials`, and an application may
  // call it anything. Anchoring on one application's spelling is what made this writer
  // unusable for every other application.
  const anchor = /\n {2}\w*[Cc]redentials: async /.exec(next);
  if (anchor) {
    next = next.slice(0, anchor.index) + factory + next.slice(anchor.index);
  } else if (next.includes(FIXTURE_PROPERTY_MARKER)) {
    const at = next.lastIndexOf(FIXTURE_PROPERTY_MARKER);
    next = next.slice(0, at) + factory.replace(/^\n/, '') + next.slice(at);
  } else {
    return { problem: 'the fixture factory block could not be located in fixtures.ts' };
  }

  return { source: next };
}

/** `IssuesPage` -> `issues`, matching `issues.searchField` and `notifications.panel`. */
export function logicalPrefix(owner: string): string {
  return owner.replace(/(Page|Panel|Component)$/, '').toLowerCase();
}

/**
 * Double quotes to single, because that is what every Page Object in this repository
 * uses. Only for literals that contain no single quote of their own - a selector that
 * did would need escaping, and quietly escaping somebody's selector is a change to it.
 */
export function toRepoStyle(expression: string): string {
  return expression.replace(/"([^"']*)"/g, "'$1'");
}

/**
 * The method, in the style the owning class already uses.
 *
 * TWO SHAPES, BOTH ALREADY IN THE REPOSITORY, chosen by what the locator is rather
 * than by preference.
 *
 * A row-scoped member is derived from a container the caller names, so it is
 * SYNCHRONOUS and returns a `Locator` - exactly like `resultRows()` and
 * `rowStatus(row)`, which are the existing precedent for this shape and which skip
 * `resolve()` because there is nothing to heal: the locator is composed, not searched
 * for.
 *
 * Everything else is a searched-for element, so it takes the `resolve()` form with an
 * ordered candidate list, like every other method on every other class here. It gets
 * ONE candidate, because one is what the recording proved; inventing a fallback would
 * be inventing a locator.
 */
export function renderMethod(proposal: Proposal): string | null {
  if (!proposal.owner || !proposal.method || !proposal.template)
    return null;
  const expression = toRepoStyle(proposal.template);
  const recordings = proposal.testCaseId.split(',').length;
  const evidence = [
    `Measured at the press in ${recordings} recording(s): one element, in the`,
    'document the press happened in, and that element is the one acted on.',
  ];

  if (proposal.parameterised && proposal.parameterName) {
    const body = expression
        .replace(/^page\./, 'this.page.')
        .replace(/\.filter\(/g, '\n        .filter(')
        .replace(/\.locator\(/g, (match, offset) => (offset === 0 ? match : '\n        .locator('))
        .replace('this.page\n        .locator(', 'this.page.locator(');
    return [
      '',
      '  /**',
      `   * ${describe(proposal)}`,
      '   *',
      `   * Composed from the container the caller names, not from a row id: the`,
      `   * recorded ids belong to individual issues and change with the data. The`,
      `   * ${proposal.parameterName} is what identifies the row, and it is the caller's to supply.`,
      '   *',
      ...evidence.map(line => `   * ${line}`),
      '   */',
      `  ${proposal.method}(${proposal.parameterName}: string): Locator {`,
      `    return ${body};`,
      '  }',
    ].join('\n');
  }

  const selector = /^page\.locator\((['"])(.*)\1\)$/.exec(expression);
  const strategy = selector ? selector[2] : expression.replace(/^page\./, '');
  return [
    '',
    '  /**',
    `   * ${describe(proposal)}`,
    '   *',
    ...evidence.map(line => `   * ${line}`),
    '   */',
    `  ${proposal.method}(): Promise<Locator> {`,
    `    return this.resolve('${logicalPrefix(proposal.owner)}.${proposal.method}', [`,
    `      { strategy: '${strategy.replace(/'/g, "\\'")}', build: page => ${expression} },`,
    '    ]);',
    '  }',
  ].join('\n');
}

/** A sentence about the element, from evidence only - never invented. */
function describe(proposal: Proposal): string {
  const noun = proposal.owner ? ownerNoun(proposal.owner) ?? 'element' : 'element';
  if (proposal.parameterised)
    return `The ${proposal.role === 'assertion' ? 'state of the ' : ''}control in one ${noun} row, addressed by its ${proposal.parameterName}.`;
  const where = proposal.ownerKind === 'component' ? `${proposal.owner} component` : `${proposal.owner} screen`;
  return `${proposal.target.replace(/^click /, '').trim()} - `
    + `${proposal.role === 'assertion' ? 'read' : 'operated'} on the ${where}.`;
}

/**
 * The knowledge entry, so the matcher can find the method next time.
 *
 * A method nothing declares is invisible: `findMethod` iterates knowledge elements,
 * not indexed methods, which is why the pair is written together or not at all.
 *
 * NO `accessible_name` IS WRITTEN FOR A PARAMETERISED METHOD, and that is deliberate
 * rather than an omission. The C1 guard supplies a declared accessible name as the
 * method's argument; on `issueCheckboxState(description)` that would pass the
 * element's name where a row description belongs - a wrong value, compiled and
 * shipped. With no name declared the guard refuses the match and the step falls
 * through to its locator, which is the honest outcome until the argument can be read
 * from the recording itself.
 */
export function renderKnowledgeEntry(proposal: Proposal): { key: string; yaml: string } | null {
  if (!proposal.owner || !proposal.method)
    return null;
  const key = keyFor(proposal);
  // `usage` is what stops an assertion method being reused for an action target and
  // the reverse - Phase 4's role guard reads it - so it is written for every entry,
  // not only the parameterised ones.
  const lines = [`  ${key}:`, `    usage: ${proposal.role}`, `    description: ${describe(proposal)}`];
  const role = /button|link|checkbox|radio|switch/i.exec(proposal.method);
  if (!proposal.parameterised && role)
    lines.push(`    role: ${role[0].toLowerCase()}`);
  // A SHARED ACCESSIBLE NAME IS NEVER DECLARED, and this one line is the whole
  // structural fix for AMBIGUOUS_NAME.
  //
  // `findMethod` matches `accessible_name` PAGE-WIDE and knows nothing of the scope a
  // method's locator is written against, so an entry keyed on a name that several
  // structurally different elements share binds all of them to one locator. That
  // happened: an entry declaring `accessible_name: Close` beside a locator scoped to
  // `#ap_notifications_panel` would have captured all five `Close` buttons in this
  // corpus, and it was written and rolled back in an earlier phase.
  //
  // Omitting the field removes the key rather than the method. The capability is still
  // created and is still found - by `findMethodByProvenLocator`, on the exact
  // expression the recorder measured, which identifies one element by construction.
  // `revalidate` refuses to clear AMBIGUOUS_NAME unless this flag is set AND a
  // template exists, so a method can never be created into that gap.
  if (!proposal.parameterised && proposal.accessibleName && !proposal.accessibleNameAmbiguous)
    lines.push(`    accessible_name: ${proposal.accessibleName}`);
  lines.push(`    page_object: ${proposal.owner}`);
  lines.push(`    page_object_method: ${proposal.method}`);
  lines.push(`    locator_strategy: "${toRepoStyle(proposal.template ?? '').replace(/"/g, "'")}"`);
  if (proposal.parameterised && proposal.parameterName)
    lines.push(`    parameter: ${proposal.parameterName} - the text identifying one row, supplied by the caller`);
  return { key, yaml: `${lines.join('\n')}\n` };
}

/** `issueCheckboxState` -> `issue_checkbox_state`, the repository's key style. */
export function keyFor(proposal: Proposal): string {
  return (proposal.method ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * The file a BOOTSTRAPPED screen's knowledge must live in.
 *
 * `canonicalFile` is the single answer to "where does this screen's knowledge go", and
 * it resolves through the active scope - the same directory `readAllPageKnowledge` reads
 * from. Going through it rather than composing a path here is what keeps the write and
 * the read symmetrical; canonical.ts records what happens when they diverge.
 */
export function bootstrapKnowledgePath(canonicalId: string): string {
  return path.resolve(ROOT, canonicalFile(canonicalId));
}

/**
 * The first knowledge file for a screen nothing has described yet.
 *
 * EVERY LINE IS EVIDENCE OR PROVENANCE. The id is the canonical identity; the route is
 * the one the recording established; the name is that route in words. Nothing describes
 * what the screen DOES, because nothing has looked at it - a purpose sentence invented
 * here would be exactly the fabricated knowledge this file is meant to replace, and a
 * later exploration writes the real one into the same file.
 *
 * NO `navigation:` BLOCK. An `entry_point` names a method a caller may invoke, and a
 * bootstrapped class has none - declaring one would put a call to a method that does not
 * exist in front of every future generation. `authentication_required` is likewise a
 * claim about the screen that no recording states, and its absence already reads as
 * false.
 *
 * The elements map is opened and left EMPTY: `applyProposals` appends the proven
 * capability through `appendElement`, the same path every other entry takes, so a
 * bootstrapped entry and a grown one are written by one piece of code.
 */
export function renderKnowledgeFile(canonicalId: string, route: string, pageName: string): string {
  return [
    `# ${pageName} - route ${route}.`,
    '#',
    '# Created by the framework from the first recording made on this screen. The id is',
    '# the canonical identity for this application and route (ai/knowledge/canonical.ts),',
    '# so one screen resolves to exactly one file and a later exploration extends this',
    '# one rather than writing a second.',
    '#',
    '# Only what a recording established is written here. Nothing describes what the',
    '# screen is for, because nothing has explored it yet.',
    '',
    'page:',
    `  id: ${canonicalId}`,
    `  name: ${pageName}`,
    `  route: ${route}`,
    '',
    'elements:',
    '',
  ].join('\n');
}

/** The knowledge file that owns this class, or null when none declares it. */
export function knowledgeFileFor(owner: string): string | null {
  const dir = knowledgeDir();
  if (!fs.existsSync(dir))
    return null;
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.yaml'))) {
    const file = path.join(dir, name);
    if (new RegExp(`page_object:\\s*${owner}\\b`).test(fs.readFileSync(file, 'utf8')))
      return file;
  }
  return null;
}

/** Everything that would stop this generated source being written. */
export function validateGenerated(source: string, proposal: Proposal): string[] {
  const problems: string[] = [];
  for (const mechanism of forbiddenMechanisms(source))
    problems.push(`the generated method uses ${mechanism}`);
  for (const match of source.matchAll(/#([A-Za-z0-9_-]+)|\[id=["']([^"']+)["']\]/g)) {
    const raw = match[1] ?? match[2] ?? '';
    if (raw && analyseIdentifier(raw).dynamic)
      problems.push(`the generated method contains the generated identifier "${raw}"`);
  }
  // A method whose NAME carries data is the failure this whole engine exists to
  // prevent; check the rendered source, not just the name we intended to use.
  if (/\b\w*\d{4,}\w*\s*\(/.test(source))
    problems.push('the generated method name contains a number that looks like data');
  // AND A NAME THAT IS THE ELEMENT'S CSS CLASS IS REFUSED HERE TOO.
  //
  // `revalidate` already refuses it on the resolver path; this covers the
  // deterministic one, so neither route can produce `IssuesPage.roundedCheckboxUi()`.
  // Two guards for one rule, because they protect different producers.
  const stylesheetName = classDerivedName(proposal.method, proposal.template ?? proposal.expression);
  if (stylesheetName)
    problems.push(`the generated method name is a stylesheet name: ${stylesheetName}`);
  // THE PARAMETER MUST BE USED, not merely declared.
  //
  // Checked against the LOCATOR, not the whole source: the parameter always appears
  // in the signature, so a method whose body ignores it would pass a naive check and
  // then return the same locator for every argument - one issue's row, hard-coded,
  // called from every test that passes a different description.
  if (proposal.parameterised && proposal.parameterName
    && !new RegExp(`\\b${proposal.parameterName}\\b`).test(proposal.template ?? ''))
    problems.push('the parameter is declared but never used in the locator');
  return problems;
}

export interface WriteResult {
  proposal: Proposal;
  file: string | null;
  knowledgeFile: string | null;
  method: string | null;
  entry: string | null;
  problems: string[];
  written: boolean;
  /**
   * What happened, separately from whether the proposal was safe.
   *
   * `ALREADY_APPLIED` is not a failure and must not block the run:
   * the first is the normal state of a new proposal, the second is what a second run
   * over an unchanged corpus looks like. Only BLOCKED means something was wrong.
   */
  outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'BLOCKED';
}

/**
 * Render and check every eligible proposal, and write only if all of them are sound.
 *
 * All-or-nothing on purpose: a run that wrote two methods and refused the third
 * leaves a repository nobody planned, and "which ones went in?" is a question the
 * next person should never have to ask.
 */
/**
 * EVERYTHING THAT MUST BE TRUE BEFORE ONE CAPABILITY IS WRITTEN.
 *
 * The analyser decided this proposal was sound. This asks the same question again at the
 * MUTATION BOUNDARY, independently, because the writer is the last thing standing between
 * a proposal and a repository: an analyser change, a hand-assembled proposal or a future
 * caller that skips the analyser must not be able to publish a capability that no
 * recording proves.
 *
 * Pure, and it decides nothing on its own - every refusal it returns joins the `problems`
 * array `applyProposals` already refuses the whole batch on. Fail-closed by construction:
 * a check that cannot be answered refuses.
 */
export function enrichmentRefusals(proposal: Proposal, context: {
  knowledge: ReturnType<typeof readAllPageKnowledge>;
  /** The active index, to tell an inconsistent declaration from an idempotent re-run. */
  index: ReturnType<typeof buildIndex>;
  /** Files this proposal would write. Refused unless every one is inside the scope. */
  files: { pages: string; knowledge: string | null; fixtures: string };
}): string[] {
  const problems: string[] = [];

  // 1. CAPABILITY IDENTITY. Without both halves there is no capability to write, and
  //    "which capability is this?" has no answer a reader could check.
  const owner = (proposal.owner ?? '').trim();
  const method = (proposal.method ?? '').trim();
  if (!owner || !method)
    problems.push('the proposal names no capability (owner and method are both required)');

  // 2. APPLICATION SCOPE. Not "the paths look right" - every file this write would touch
  //    is tested against the ACTIVE scope's own directories. A proposal that would write
  //    outside them is refused whatever produced it.
  //
  //    A scope that cannot be resolved is a refusal too: two applications registered and
  //    no choice made is exactly when a write must not proceed on a guess.
  try {
    const scope = activeScope();
    const outside: string[] = [];
    if (!isWithinScope(scope, context.files.pages, 'pagesDir'))
      outside.push('the Page Object');
    if (context.files.knowledge && !isWithinScope(scope, context.files.knowledge, 'knowledgePageDir'))
      outside.push('the knowledge file');
    if (!isWithinScope(scope, context.files.fixtures, 'fixturesFile'))
      outside.push('the fixtures module');
    if (outside.length) {
      problems.push(`${outside.join(' and ')} would be written outside the active application `
        + `"${scope.applicationId}" - application artefacts are never resolved across scopes`);
    }
  } catch (error) {
    problems.push(error instanceof ScopeError
      ? `the active application could not be resolved, so nothing may be written: ${error.message}`
      : 'the active application could not be resolved, so nothing may be written');
  }

  // 3. DETERMINISTIC LOCATOR EVIDENCE, never prose. A knowledge entry may describe an
  //    element in words; a capability is written from an expression the recorder measured.
  const locator = (proposal.template ?? proposal.expression ?? '').trim();
  if (!/^page\s*\./.test(locator)) {
    problems.push('the capability has no deterministic locator - a capability is written '
      + 'from a measured expression, never from a description');
  }

  // 4. PROOF AT THE INTERACTION. Re-asked here with the framework's own predicate, so the
  //    writer never has to trust that somebody upstream asked it. A NAME is not proof and
  //    never reaches this test: what is checked is the measurement taken against the
  //    element that was acted on.
  if (!proposal.proof || !provesIdentity(proposal.proof as never, proposal.role)) {
    problems.push('no press-time proof identifies the element this capability would wrap '
      + '(one element, in the interaction\'s own document, and that element is the one acted on)');
  }

  // 5. APPEND-ONLY. The writer appends and never rewrites, so these two cannot happen
  //    today - which is the point of asserting them here rather than trusting it. The
  //    first refuses a write that would change what an established capability resolves
  //    to; the second refuses a second NAME for an element already wrapped.
  if (owner && method) {
    for (const page of context.knowledge) {
      for (const element of page.elements) {
        const declared = (element.locator_strategy ?? '').trim();
        const sameCapability = element.page_object === owner && element.page_object_method === method;
        // AN INCONSISTENT DECLARATION, NOT AN IDEMPOTENT RE-RUN, and the difference is
        // what the class says. Where the method EXISTS, this proposal is simply the same
        // capability coming round again: the writer skips it (ALREADY_APPLIED) and
        // rewrites nothing, so refusing here would turn a harmless repeat into a blocked
        // batch. Where the method does NOT exist, knowledge declares one locator and this
        // proposal carries another - appending would leave the repository declaring the
        // capability twice, differently.
        const onClass = context.index.pages[owner]?.methods.some(entry => entry.name === method);
        if (sameCapability && !onClass && declared && locator && declared !== locator
          && declared.replace(/["']/g, '"') !== locator.replace(/["']/g, '"')) {
          problems.push(`${owner}.${method}() is already declared with a different locator - `
            + 'an established capability is never replaced by a later recording');
        }
        if (!sameCapability && declared && locator
          && declared.replace(/["']/g, '"') === locator.replace(/["']/g, '"')
          && element.page_object_method && element.page_object_method !== method) {
          problems.push(`this locator is already declared as ${element.page_object}.`
            + `${element.page_object_method}() - one element is never given a second name`);
        }
      }
    }
  }
  return problems;
}

/**
 * Every artefact file of the active application, as bytes, for the before/after compare.
 *
 * Bounded to the three directories a capability write may touch. Read twice around the
 * write and compared by CONTENT - never by mtime, which says nothing about what changed.
 */
export function artefactSnapshot(): Map<string, string> {
  const snapshot = new Map<string, string>();
  const read = (file: string) => {
    try {
      snapshot.set(file, fs.readFileSync(file, 'utf8'));
    } catch {
      // Unreadable is the same as absent for this comparison: it is not a file this run
      // is claiming to have left alone.
    }
  };
  const walk = (dir: string) => {
    if (!fs.existsSync(dir))
      return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory())
        walk(full);
      else
        read(full);
    }
  };
  walk(pagesDir());
  walk(knowledgeDir());
  read(fixturesFile());
  return snapshot;
}

/**
 * What the write was supposed to leave behind, checked against what it actually did.
 *
 * THREE QUESTIONS THE REACHABILITY CHECK CANNOT ANSWER. `verify` asks whether the new
 * method can be found; these ask whether anything else moved:
 *
 *   - every capability that existed before still resolves to exactly what it did;
 *   - no file outside the ones this run intended to write changed at all;
 *   - nothing that existed before has gone.
 *
 * Compared as BYTES, from a snapshot taken before the write, so an accidental rewrite is
 * caught whatever produced it.
 */
function unintendedChanges(before: Map<string, string>, intended: Set<string>): string[] {
  const failures: string[] = [];
  const after = artefactSnapshot();
  for (const [file, contents] of before) {
    const now = after.get(file);
    if (now === undefined) {
      failures.push(`${path.basename(file)} was removed by a write that did not intend to`);
      continue;
    }
    if (now !== contents && !intended.has(file))
      failures.push(`${path.basename(file)} changed and this run did not intend to write it`);
  }
  return failures;
}

/**
 * Does every capability the knowledge declared BEFORE this write still declare the same
 * locator afterwards?
 *
 * The append-only rule, verified rather than assumed. An enrichment adds entries; it does
 * not touch the ones already there, and this is what says so after the fact.
 */
function establishedCapabilitiesPreserved(
  before: ReturnType<typeof readAllPageKnowledge>,
): string[] {
  const failures: string[] = [];
  const now = readAllPageKnowledge();
  for (const page of before) {
    for (const element of page.elements) {
      if (!element.page_object || !element.page_object_method)
        continue;
      const found = now.some(entry => entry.elements.some(candidate =>
        candidate.page_object === element.page_object
        && candidate.page_object_method === element.page_object_method
        && (candidate.locator_strategy ?? '') === (element.locator_strategy ?? '')));
      if (!found) {
        failures.push(`${element.page_object}.${element.page_object_method}() no longer declares `
          + 'what it declared before this write');
      }
    }
  }
  return failures;
}

/**
 * WHAT THE WRITE WAS SUPPOSED TO LEAVE BEHIND, checked against what it actually did.
 *
 * Exported because it is the half of the contract that cannot be proven by watching a
 * successful run: every defect reachable today is refused BEFORE the write, so the only
 * way to demonstrate that a corrupted result would be caught is to hand this function a
 * corrupted result. It reads the repository as it stands and compares it with what was
 * read before the write - by content, never by mtime, ordering or a timestamp.
 */
export function postWriteVerification(
  knowledgeBefore: ReturnType<typeof readAllPageKnowledge>,
  artefactsBefore: Map<string, string>,
  intended: Set<string>,
): string[] {
  return [
    ...establishedCapabilitiesPreserved(knowledgeBefore),
    ...unintendedChanges(artefactsBefore, intended),
  ];
}

export function applyProposals(
  proposals: Proposal[],
  options: { dry?: boolean } = {},
): { results: WriteResult[]; applied: boolean; reason: string } {

  // ONLY PROPOSED. NEEDS_REVIEW, REFUSED and REUSE never reach this function.
  //
  // A PROPOSED line is one where every deterministic gate passed: press-time proof
  // against the pressed element, one match, one document, no generated identifier, no
  // positional or forced mechanism, an owner knowledge declares, a name derived from
  // the owner and the element kind rather than from data, no collision on the class,
  // and - where there is a parameter - a template that round-trips to the measured
  // expression. Requiring a person to countersign THAT was requiring a countersignature
  // on arithmetic, and it is why the loop never closed: the engine reached the right
  // answer and then waited.
  //
  // AND NOTHING ELSE, WHATEVER ANYBODY SAYS. An approvals file was tried here as a
  // human override and removed again: a fingerprint somebody had approved would have
  // carried a REFUSED proposal - a generated identifier - straight past the gate that
  // exists to stop exactly that. An override that can turn a refusal into a write is
  // not a review, so status alone decides and there is no second door.
  const eligible = proposals.filter(proposal => proposal.status === 'PROPOSED');
  // Read ONCE, before anything is written, so the after-comparison has something honest
  // to compare against.
  const knowledgeBefore = readAllPageKnowledge();
  const artefactsBefore = artefactSnapshot();
  const results: WriteResult[] = [];
  const pending = new Map<string, string>();
  const backups = new Map<string, string>();
  const alreadyApplied = new Set<string>();
  /**
   * Files this run would BRING INTO EXISTENCE, as opposed to edit.
   *
   * Tracked separately because rollback differs: an edited file is restored from its
   * backup, and a created one has no previous contents to restore - it has to be
   * removed, or a rolled-back run leaves an orphan class behind and the next run
   * reports it as already existing.
   */
  const created = new Set<string>();

  for (const proposal of eligible) {
    let knowledgeFile = proposal.owner ? knowledgeFileFor(proposal.owner) : null;
    // THE FIRST KNOWLEDGE FILE FOR A SCREEN NOTHING DECLARES.
    //
    // Reached only when the owner was BOOTSTRAPPED - derived from the active application
    // and the route the recording established - and only when no file declares it, which
    // is the same condition `resolveOwner` required before it derived one. Everything
    // after this point is the existing path: the element is appended by `appendElement`,
    // the class and fixture are created by the code below, the whole set is verified by
    // `verify()` and rolled back together.
    //
    // NEVER AN OVERWRITE. A file already at that path is used as it stands - it belongs
    // to this screen by construction, since the identity is derived from the route - and
    // the entry is appended into it.
    if (!knowledgeFile && proposal.bootstrap?.canonicalId && proposal.owner) {
      const target = bootstrapKnowledgePath(proposal.bootstrap.canonicalId);
      knowledgeFile = target;
      if (!pending.has(target) && !fs.existsSync(target)) {
        pending.set(target, renderKnowledgeFile(
            proposal.bootstrap.canonicalId, proposal.bootstrap.route, proposal.bootstrap.pageName));
        created.add(target);
      }
    }
    const method = renderMethod(proposal);
    const entry = renderKnowledgeEntry(proposal);
    const problems: string[] = [];

    // THE CLASS, CREATED WHEN KNOWLEDGE DECLARES AN OWNER NO FILE IMPLEMENTS.
    //
    // The owner is never invented - `resolveOwner` returns only what a knowledge file
    // declares for the route, and a resolver may only choose from that same closed set
    // - so reaching here means the repository declares a screen it has no class for.
    // Creating the class is then bookkeeping, not a judgement, and refusing it would
    // strand a capability the engine has already proven.
    let file = proposal.owner ? pageFileFor(proposal.owner) : null;
    if (!file && proposal.owner && !NO_FIXTURE.has(proposal.owner)) {
      file = pageFilePathFor(proposal.owner);
      if (!pending.has(file) && !fs.existsSync(file)) {
        pending.set(file, renderPageObjectClass(proposal.owner, null, file));
        created.add(file);
      }
    }

    // THE FIXTURE, WITHOUT WHICH THE METHOD IS UNREACHABLE. A spec that destructures a
    // fixture Playwright does not know refuses the whole FILE - `Test has unknown
    // parameter "issuesPage"`, zero tests collected - so this is part of creating the
    // capability, not a follow-up chore.
    if (proposal.owner && method) {
      const fixtures = fixturesFile();
      // SEED THE MODULE IF THIS APPLICATION HAS NONE. `readFileSync` threw ENOENT here for
      // every application but the legacy one, and `registerFixture` then needed an existing
      // Page Object import group to anchor to - so a new application could never register
      // its first fixture, and Record -> Generate could not complete without somebody
      // hand-authoring the file. The seed declares NO Page Objects; it is the framework
      // wiring and an empty namespace, which is exactly what a new application owns.
      if (!pending.has(fixtures) && !fs.existsSync(fixtures)) {
        pending.set(fixtures, emptyFixturesModule());
        created.add(fixtures);
      }
      const current = pending.get(fixtures) ?? fs.readFileSync(fixtures, 'utf8');
      const registration = registerFixture(current, proposal.owner);
      if ('problem' in registration)
        problems.push(registration.problem);
      else if (registration.source !== current)
        pending.set(fixtures, registration.source);
    }

    // THE PRE-WRITE CONTRACT, at the mutation boundary and before any of this
    // proposal's content is pending.
    for (const refusal of enrichmentRefusals(proposal, {
      knowledge: knowledgeBefore,
      index: buildIndex(),
      files: {
        pages: file ?? pageFilePathFor(proposal.owner ?? ''),
        knowledge: knowledgeFile,
        fixtures: fixturesFile(),
      },
    }))
      problems.push(refusal);

    if (!file)
      problems.push(`no file declares class ${proposal.owner}`);
    if (!knowledgeFile)
      problems.push(`no knowledge file declares ${proposal.owner}`);
    if (!method)
      problems.push('the method could not be rendered from the proposal');
    if (!entry)
      problems.push('the knowledge entry could not be rendered');

    if (file && method) {
      const current = pending.get(file) ?? fs.readFileSync(file, 'utf8');
      // IDEMPOTENCY: a method that is already there is not written twice, and is
      // never written under a suffixed name.
      if (new RegExp(`\\b${proposal.method}\\s*\\(`).test(current)) {
        // IDEMPOTENCY, and never an overwrite. The method is already there, so this
        // run has nothing to do - a different thing from the proposal being unsafe,
        // and it must not block the proposals beside it. The existing implementation
        // is left exactly as it is.
        alreadyApplied.add(proposal.fingerprint);
      } else {
        problems.push(...validateGenerated(method, proposal));
        if (!problems.length) {
          const close = current.lastIndexOf('\n}');
          if (close === -1)
            problems.push('the class body could not be located');
          else
            pending.set(file, `${current.slice(0, close)}\n${method}${current.slice(close)}`);
        }
      }
    }

    if (knowledgeFile && entry && !problems.length) {
      const current = pending.get(knowledgeFile) ?? fs.readFileSync(knowledgeFile, 'utf8');
      if (new RegExp(`^\\s{2}${entry.key}:`, 'm').test(current)
        || new RegExp(`page_object_method:\\s*${proposal.method}\\b`).test(current)) {
        alreadyApplied.add(proposal.fingerprint);
      } else {
        pending.set(knowledgeFile, appendElement(current, entry.yaml));
      }
    }

    results.push({
      proposal, file, knowledgeFile, method, entry: entry?.yaml ?? null,
      problems, written: false,
      outcome: alreadyApplied.has(proposal.fingerprint) ? 'ALREADY_APPLIED'
        : problems.length ? 'BLOCKED' : 'APPLIED',
    });
  }

  // Only genuine problems block. An unapproved or already-applied proposal is a
  // normal outcome and leaves the others free to proceed.
  const blocked = results.filter(result => result.outcome === 'BLOCKED');
  if (blocked.length) {
    return {
      results, applied: false,
      reason: `${blocked.length} of ${results.length} proposal(s) did not validate; nothing was written`,
    };
  }
  if (options.dry)
    return { results, applied: false, reason: 'dry run: nothing was written' };
  if (!pending.size)
    return { results, applied: false, reason: 'nothing to write' };

  for (const [file] of pending) {
    if (!created.has(file))
      backups.set(file, fs.readFileSync(file, 'utf8'));
  }
  for (const [file, contents] of pending) {
    // THE DIRECTORY MAY NOT EXIST YET, and for a newly provisioned application it never
    // does: `tests-e2e/pages/<applicationId>` and `ai/knowledge/page/<applicationId>` come
    // into being when something first writes an artefact there. Without this, the first
    // Page Object a new application ever produces failed with ENOENT - so the very step
    // that is supposed to seed an application's namespace was the one step that could not.
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, 'utf8');
  }

  // VERIFY THROUGH THE REAL INDEX AND THE REAL KNOWLEDGE READER, then roll back if
  // what was written cannot be found. A method the matcher cannot see is not a
  // half-finished feature, it is a defect with a passing test suite.
  const failures = [
    ...verify(eligible),
    ...postWriteVerification(knowledgeBefore, artefactsBefore, new Set(pending.keys())),
  ];
  if (failures.length) {
    for (const [file, original] of backups)
      fs.writeFileSync(file, original, 'utf8');
    // A created file has no previous contents to restore. Left behind, it would be a
    // class nothing declares a method on, and the next run would find it and believe
    // the class had always existed.
    for (const file of created) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Reported through the rollback reason below rather than thrown: the edited
        // files are already restored and losing that would be the worse outcome.
      }
    }
    return { results, applied: false, reason: `rolled back: ${failures.join('; ')}` };
  }

  for (const result of results)
    result.written = true;
  return { results, applied: true, reason: `${pending.size} file(s) written and verified` };
}

/** Insert one element block at the end of the `elements:` map, preserving the rest. */
function appendElement(source: string, block: string): string {
  const marker = /^elements:\s*$/m.exec(source);
  if (!marker)
    return `${source.replace(/\s*$/, '')}\n\n${block}`;
  const nextSection = /^\w[\w-]*:\s*$/m;
  const after = source.slice(marker.index + marker[0].length);
  const next = nextSection.exec(after);
  const cut = next ? marker.index + marker[0].length + next.index : source.length;
  return `${source.slice(0, cut).replace(/\s*$/, '')}\n${block}\n${source.slice(cut)}`;
}

/**
 * Is every written method now visible to the index, to knowledge AND to a spec?
 *
 * THE THIRD TEST IS THE ONE THAT WAS MISSING. Verifying only the class and the
 * knowledge entry answers "was it written?" and not "can it be used?" - and those came
 * apart in exactly one way: a method on a class with no fixture. `methodIsDeliverable`
 * requires both `index.pages[owner].methods` AND `index.fixtures` to contain it, so a
 * method that passed the old two checks could still be unreachable, be reported
 * APPLIED, and leave the generator emitting a raw locator for an element it had just
 * created a method for. Now the write rolls back instead.
 */
export function verify(proposals: Proposal[]): string[] {
  const failures: string[] = [];
  const index = buildIndex();
  const knowledge = readAllPageKnowledge();
  for (const proposal of proposals) {
    if (!proposal.owner || !proposal.method)
      continue;
    const onClass = index.pages[proposal.owner]?.methods.some(entry => entry.name === proposal.method);
    if (!onClass)
      failures.push(`${proposal.owner}.${proposal.method}() is not on the class`);
    const declared = knowledge.some(page => page.elements.some(element =>
      element.page_object === proposal.owner && element.page_object_method === proposal.method));
    if (!declared)
      failures.push(`no knowledge entry declares ${proposal.owner}.${proposal.method}()`);
    if (!(index.fixtures ?? []).includes(fixtureFor(proposal.owner))) {
      failures.push(`no fixture declares ${fixtureFor(proposal.owner)}, so a spec cannot reach `
        + `${proposal.owner}.${proposal.method}()`);
    }
  }
  return failures;
}

function main(): void {
  const dry = process.argv.includes('--dry');
  const { proposals } = analyseCorpus();
  const outcome = applyProposals(proposals, { dry });

  process.stdout.write('\nabstraction writer - phase 3 (deterministic, no model)\n\n');
  for (const result of outcome.results) {
    const { proposal } = result;
    process.stdout.write(`  ${proposal.owner}.${proposal.method}`
      + `(${proposal.parameterName ?? ''})  [${proposal.role}]\n`);
    process.stdout.write(`    file      ${result.file ? path.relative(ROOT, result.file).replace(/\\/g, '/') : '-'}\n`);
    process.stdout.write(`    knowledge ${result.knowledgeFile ? path.relative(ROOT, result.knowledgeFile).replace(/\\/g, '/') : '-'}\n`);
    process.stdout.write(`    outcome   ${result.outcome}\n`);
    if (result.problems.length)
      process.stdout.write(`    BLOCKED   ${result.problems.join('; ')}\n`);
    if (dry && result.method)
      process.stdout.write(`${result.method.split('\n').map(line => `    | ${line}`).join('\n')}\n`);
    process.stdout.write('\n');
  }
  process.stdout.write(`  ${outcome.reason}\n`);
}

if (process.argv[1] && /writer\.ts$/.test(process.argv[1]))
  main();
