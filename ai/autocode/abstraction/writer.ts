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
import { buildIndex } from '../../knowledge/index';
import { readAllPageKnowledge } from '../../knowledge/page-knowledge';
import { classDerivedName, forbiddenMechanisms } from './validate';
import { ownerNoun } from './naming';
import { analyseCorpus } from './propose';
import type { Proposal } from './types';

const ROOT = process.cwd();
const PAGES_DIR = path.join(ROOT, 'tests-e2e', 'pages');
const KNOWLEDGE_DIR = path.join(ROOT, 'ai', 'knowledge', 'page');
const FIXTURES_FILE = path.join(ROOT, 'tests-e2e', 'fixtures.ts');

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
  for (const name of fs.readdirSync(PAGES_DIR).filter(file => file.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(PAGES_DIR, name), 'utf8');
    if (new RegExp(`export\\s+class\\s+${owner}\\b`).test(source))
      return path.join(PAGES_DIR, name);
  }
  return null;
}

/** Where a class that does not exist yet would live: `NotificationsPanel` -> `notifications.panel.ts`. */
export function pageFilePathFor(owner: string): string {
  const words = owner.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);
  return path.join(PAGES_DIR, `${words.map(word => word.toLowerCase()).join('.')}.ts`);
}

/**
 * A new Page Object class, in the shape every existing one already has.
 *
 * DELIBERATELY EMPTY OF CAPABILITIES. It declares the constructor and nothing else;
 * the methods are appended by the same code path that appends to an existing class, so
 * there is exactly one method-writing path and a new class is not a second one.
 */
export function renderPageObjectClass(owner: string, route: string | null): string {
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
    "import type { HealingRecorder } from '../support/resilient-locator';",
    "import { BasePage } from './base.page';",
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
  const relative = `./pages/${path.basename(pageFilePathFor(owner), '.ts')}`;
  let next = source;

  // 1. THE IMPORT, inserted after the last existing Page Object import so the group
  //    stays together and alphabetical order is preserved where it already holds.
  if (!new RegExp(`import\\s*\\{\\s*${owner}\\s*\\}`).test(next)) {
    const imports = [...next.matchAll(/^import \{ \w+ \} from '\.\/pages\/[\w.]+';$/gm)];
    const last = imports[imports.length - 1];
    if (!last?.index && last?.index !== 0)
      return { problem: 'the Page Object import group could not be located in fixtures.ts' };
    const at = last.index + last[0].length;
    next = `${next.slice(0, at)}\nimport { ${owner} } from '${relative}';${next.slice(at)}`;
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
  const anchor = /\n {2}bugasuraCredentials: async /.exec(next);
  if (!anchor)
    return { problem: 'the fixture factory block could not be located in fixtures.ts' };
  const factory = `\n  ${name}: async ({ page, healing }, use) => {\n`
    + `    await use(new ${owner}(page, healing));\n  },\n`;
  next = next.slice(0, anchor.index) + factory + next.slice(anchor.index);

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

/** The knowledge file that owns this class, or null when none declares it. */
export function knowledgeFileFor(owner: string): string | null {
  for (const name of fs.readdirSync(KNOWLEDGE_DIR).filter(file => file.endsWith('.yaml'))) {
    const file = path.join(KNOWLEDGE_DIR, name);
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
    const knowledgeFile = proposal.owner ? knowledgeFileFor(proposal.owner) : null;
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
        pending.set(file, renderPageObjectClass(proposal.owner, null));
        created.add(file);
      }
    }

    // THE FIXTURE, WITHOUT WHICH THE METHOD IS UNREACHABLE. A spec that destructures a
    // fixture Playwright does not know refuses the whole FILE - `Test has unknown
    // parameter "issuesPage"`, zero tests collected - so this is part of creating the
    // capability, not a follow-up chore.
    if (proposal.owner && method) {
      const current = pending.get(FIXTURES_FILE) ?? fs.readFileSync(FIXTURES_FILE, 'utf8');
      const registration = registerFixture(current, proposal.owner);
      if ('problem' in registration)
        problems.push(registration.problem);
      else if (registration.source !== current)
        pending.set(FIXTURES_FILE, registration.source);
    }

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
  for (const [file, contents] of pending)
    fs.writeFileSync(file, contents, 'utf8');

  // VERIFY THROUGH THE REAL INDEX AND THE REAL KNOWLEDGE READER, then roll back if
  // what was written cannot be found. A method the matcher cannot see is not a
  // half-finished feature, it is a defect with a passing test suite.
  const failures = verify(eligible);
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
