/**
 * A metadata index of the automation framework, generated from the framework.
 *
 * The generator used to be told "read tests-e2e/pages/ and tests-e2e/fixtures.ts
 * before writing anything", which it obeyed literally: ~11,700 tokens of Page
 * Object and fixture source on every case, almost all of it about screens the
 * case never touches. What it actually needed from that reading was three facts -
 * which Page Object covers this screen, what file it is in, and what methods it
 * already has - and all three are metadata.
 *
 * So this emits the metadata and nothing else. **No source code goes in the
 * index.** When the agent needs an implementation detail it opens the one file
 * the index named, which is a targeted read rather than a survey.
 *
 * Built fresh on every run (a few file reads and a regex, ~10 ms), so it cannot
 * go stale the way a hand-maintained index would. `ai/knowledge/framework/*.yaml`
 * is written as the inspectable copy - and is what gets inlined into the prompt -
 * but nothing parses it back: the in-memory structure is the source of truth.
 *
 * Deliberately NOT indexed here: test case IDs and their spec files. That index
 * already exists as `ai/test-mapping/mapping.json`, maintained by
 * `excel:mapping sync`, and a second one would drift from it.
 */

import fs from 'node:fs';
import path from 'node:path';

import { activeScope, type ApplicationScope, scopedFilePath } from '../projects/scope';

const ROOT = process.cwd();
const TESTS = path.resolve(ROOT, 'tests-e2e');
export const KNOWLEDGE_DIR = path.resolve(ROOT, 'ai', 'knowledge');
export const FRAMEWORK_DIR = path.join(KNOWLEDGE_DIR, 'framework');

export interface MethodParam {
  name: string;
  /** The declared type, where the signature declares one. */
  type?: string;
  /** Optional because it has a default or a `?`, so a zero-argument call is still valid. */
  optional: boolean;
}

export interface IndexedMethod {
  name: string;
  /** `Locator`, `boolean`, `void` - enough to use it without opening the file. */
  returns?: string;
  /**
   * Declared parameters, in order. Absent means the signature was empty.
   *
   * Recorded rather than discarded because a caller cannot decide whether a method
   * is callable without them: `dashboardTab(name)` and `sectionHeader()` are
   * indistinguishable by name and return type, and calling the first as if it were
   * the second produces code that compiles and does nothing useful.
   */
  params?: MethodParam[];
}

export interface IndexedFile {
  /** Repo-relative, forward slashes, ready to hand to Read. */
  file: string;
  /** First sentence of the file's own leading doc comment. */
  purpose: string;
  methods: IndexedMethod[];
  /** Size in tokens, so context selection can budget before it selects. */
  approxTokens: number;
}

export interface FrameworkIndex {
  /**
   * Which application this index describes. Every `pages` entry belongs to it.
   *
   * Present so a consumer can ASSERT the index it was handed matches the scope it
   * is working in. Nothing keys off it - see the note on `pages`.
   */
  applicationId: string;
  /**
   * Page Objects, keyed by class name - **within one application**.
   *
   * WHY THE KEY IS STILL THE BARE CLASS NAME
   *
   * Two applications may both have a `LoginPage`, so the obvious fix is to key this
   * `bugasura/LoginPage`. That was rejected: `index.pages[owner]` is read in fifteen
   * places across `abstraction/propose.ts`, `abstraction/semantic.ts`,
   * `abstraction/writer.ts`, `from-recording.ts` and `context.ts`, and the owner
   * string in each of them comes from a knowledge file's `page_object:` field, a
   * resolver's answer, or a proposal. Namespacing the key means namespacing all of
   * those too - a wholesale rewrite of the Page Object and abstraction logic to
   * solve a collision that the SEARCH SPACE already solves.
   *
   * So the scope constrains what is scanned, not how it is keyed. `buildIndex`
   * reads one application's directory, the index is built fresh per run, and within
   * it a class name is unique because it came from one application. Bugasura's
   * `LoginPage` and Flipkart's are never in the same object to collide - not because
   * the key distinguishes them, but because no index ever contains both.
   *
   * The invariant that keeps this true: NOTHING may merge two indexes, and nothing
   * may add an entry from outside `scope.paths.pagesDir`.
   */
  pages: Record<string, IndexedFile>;
  /** Fixture names a spec can destructure from `test({ ... })`. */
  fixtures: string[];
  /** Support modules, keyed by module name. Not loaded unless asked for. */
  support: Record<string, IndexedFile>;
}

const CHARS_PER_TOKEN = 3.7;
const approx = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

/**
 * The title line of the leading block comment.
 *
 * Every file in this framework opens with a one-line summary followed by a blank
 * line, which is why `purpose` can be generated rather than authored: a
 * hand-written purpose would be a second description to keep in sync with the one
 * already at the top of the file.
 *
 * The title line specifically, not the first sentence. A URL in the summary
 * ("Bugasura sign-in page - https://my.bugasura.io/") has no sentence-ending
 * period, so sentence detection ran on into the next paragraph and truncated
 * mid-word.
 */
function purposeOf(source: string): string {
  const block = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source);
  if (!block)
    return '';
  const first = block[1]
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trim())
      .find(Boolean);
  return (first ?? '').slice(0, 140).trim();
}

/**
 * Public methods, with their return type where it is declared.
 *
 * Two-space indentation is the class-body level in this codebase, which keeps
 * nested functions and object literals out. `private`, `#name` and `constructor`
 * are skipped: none of them is callable from a spec, so none belongs in an index
 * whose job is "what can I call".
 */
/**
 * Split a parameter list on its own commas.
 *
 * Depth-aware because a type can contain one: `Record<string, string>` and
 * `{ a: 1, b: 2 }` are each a SINGLE parameter, and a naive split turns one
 * parameter into two - which would make a callable method look uncallable.
 */
function splitParams(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of list) {
    if ('<([{'.includes(character))
      depth += 1;
    else if ('>)]}'.includes(character))
      depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

/** `name: string`, `timeout = 15_000`, `row: Locator` -> what a caller must supply. */
function paramsOf(list: string): MethodParam[] {
  return splitParams(list).map(part => {
    const optional = /\?\s*:/.test(part) || part.includes('=');
    const colon = part.indexOf(':');
    const name = (colon === -1 ? part : part.slice(0, colon))
        .replace(/\?/g, '').replace(/=.*$/, '').trim();
    const type = colon === -1 ? '' : part.slice(colon + 1).split('=')[0].trim();
    return { name, ...(type ? { type } : {}), optional };
  }).filter(param => Boolean(param.name));
}

function methodsOf(source: string): IndexedMethod[] {
  const found = new Map<string, IndexedMethod>();
  const pattern = /^ {2}(?:(?:public|protected|private|static|async|get|set)\s+)*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::\s*([^{;]+))?/gm;
  for (const match of source.matchAll(pattern)) {
    const [line, name, paramList, returns] = match;
    if (name === 'constructor' || /^\s{2}(?:private|protected)\s/.test(line))
      continue;
    if (['if', 'for', 'while', 'switch', 'catch', 'return', 'function'].includes(name))
      continue;
    // Promise<Locator> -> Locator: the await is not information.
    const clean = returns?.trim().replace(/^Promise<(.+)>$/, '$1').trim();
    const params = paramsOf(paramList ?? '');
    found.set(name, {
      name,
      ...(clean && clean !== 'void' ? { returns: clean } : {}),
      ...(params.length ? { params } : {}),
    });
  }
  return [...found.values()];
}

function readIndexed(absolute: string): IndexedFile {
  const source = fs.readFileSync(absolute, 'utf8');
  return {
    file: path.relative(ROOT, absolute).replace(/\\/g, '/'),
    purpose: purposeOf(source),
    methods: methodsOf(source),
    approxTokens: approx(source.length),
  };
}

/** `login.page.ts` -> `LoginPage`, matching the exported class name. */
function className(file: string): string {
  const source = fs.readFileSync(file, 'utf8');
  const exported = /export\s+class\s+(\w+)/.exec(source);
  if (exported)
    return exported[1];
  return path.basename(file).replace(/\.(page|spec)?\.ts$/, '')
      .replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}

/**
 * Fixture names, read off the fixtures module's own type.
 *
 * Taken from the `test.extend<...>` type argument rather than by guessing at
 * property names elsewhere in the file, so a helper that happens to look like a
 * fixture is not advertised as one.
 */
function fixturesOf(source: string): string[] {
  const block = /test\s*\.\s*extend\s*<\s*\{([\s\S]*?)\}\s*>/.exec(source)
    ?? /(?:type|interface)\s+\w*Fixtures\w*\s*=?\s*\{([\s\S]*?)\n\}/.exec(source);
  const names = new Set<string>();
  if (block) {
    for (const match of block[1].matchAll(/^\s*(\w+)\s*[?:]/gm))
      names.add(match[1]);
  }
  // `expect`, `test` and `trace` are re-exported values, not fixtures, but every
  // spec imports them from here - which is the point of the list. `expect` in
  // particular arrives via `export { expect }`, so bare re-export lists have to
  // be read too or the one import no spec can do without goes unlisted.
  for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:const|function|class)\s+(\w+)/gm))
    names.add(match[1]);
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name)
        names.add(name);
    }
  }
  return [...names];
}

/**
 * Build the index for ONE application.
 *
 * `scope` defaults to the active one, which - while Bugasura is the only registered
 * application - resolves to the flat `tests-e2e/pages` this has always read. So
 * every existing caller keeps working with no argument and no behaviour change, and
 * a caller that knows its scope passes it.
 *
 * Page Objects come from `scope.paths.pagesDir` and the fixtures module from
 * `scope.paths.fixturesFile`; both are application-owned.
 *
 * `support/` is deliberately NOT scoped and is the one thing here read from a fixed
 * location. It holds the framework's own plumbing - `resilient-locator.ts`, `env.ts`,
 * `steps.ts`, `generic-form.ts` - which is a SHARED_CAPABILITY: no application owns
 * it, every application uses the same copy, and duplicating it per application is
 * precisely what `SHARED_CAPABILITIES` forbids. Nothing here merges two
 * applications' entries.
 */
export function buildIndex(scope: ApplicationScope = activeScope()): FrameworkIndex {
  const index: FrameworkIndex = { applicationId: scope.applicationId, pages: {}, fixtures: [], support: {} };

  const pagesDir = scope.paths.pagesDir;
  if (fs.existsSync(pagesDir)) {
    for (const name of fs.readdirSync(pagesDir).filter(file => file.endsWith('.ts'))) {
      const absolute = path.join(pagesDir, name);
      index.pages[className(absolute)] = readIndexed(absolute);
    }
  }

  // Scoped, because `index.fixtures` is what `writer.ts verify()` consults to decide
  // that a Page Object method it just wrote is REACHABLE. Reading a different
  // application's fixtures file there would let a method be reported APPLIED because
  // some OTHER application had registered a fixture of the same derived name.
  const fixturesFile = scope.paths.fixturesFile;
  if (fs.existsSync(fixturesFile)) {
    index.fixtures = fixturesOf(fs.readFileSync(fixturesFile, 'utf8'));
    index.support.fixtures = readIndexed(fixturesFile);
  }

  const supportDir = path.join(TESTS, 'support');
  if (fs.existsSync(supportDir)) {
    for (const name of fs.readdirSync(supportDir).filter(file => file.endsWith('.ts')))
      index.support[name.replace(/\.ts$/, '')] = readIndexed(path.join(supportDir, name));
  }

  return index;
}

/**
 * A minimal YAML emitter for exactly this shape.
 *
 * Hand-rolled rather than adding a dependency: the structure is three levels of
 * plain scalars and lists, and `yaml` is not in package.json. Quoting is
 * deliberately conservative - anything with a character YAML treats specially is
 * double-quoted.
 */
function scalar(value: string): string {
  return /^[\w][\w .,()/-]*$/.test(value) && !/: /.test(value)
    ? value
    : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function toYaml(index: FrameworkIndex): string {
  const lines: string[] = [
    '# Generated by ai/knowledge/index.ts - do not edit by hand.',
    '# Metadata only. Read the named file when you need an implementation detail.',
    '',
    'pages:',
  ];
  for (const [name, entry] of Object.entries(index.pages)) {
    lines.push(`  ${name}:`);
    lines.push(`    file: ${entry.file}`);
    if (entry.purpose)
      lines.push(`    purpose: ${scalar(entry.purpose)}`);
    lines.push('    methods:');
    for (const method of entry.methods)
      lines.push(`      - ${method.name}()${method.returns ? ` -> ${method.returns}` : ''}`);
  }
  lines.push('', 'fixtures:');
  // THE FILE THE INDEX ACTUALLY READ, not a literal.
  //
  // This was `tests-e2e/fixtures.ts` spelled out, while `buildIndex` reads
  // `scope.paths.fixturesFile` - so the index READ one application's fixtures module
  // and then TOLD the generator to import from the flat one. Under a scoped layout the
  // prompt would name a file that is not this application's, and the generated spec
  // would either fail to resolve it or destructure another project's Page Objects.
  // `index.support.fixtures.file` is the path that was read, so there is one answer
  // rather than two that can disagree.
  lines.push(`  importFrom: ${index.support.fixtures?.file ?? '(no fixtures module found)'}`);
  lines.push(`  available: [${index.fixtures.join(', ')}]`);
  lines.push('', 'support:');
  for (const [name, entry] of Object.entries(index.support)) {
    if (name === 'fixtures')
      continue;
    lines.push(`  ${name}:`);
    lines.push(`    file: ${entry.file}`);
    if (entry.purpose)
      lines.push(`    purpose: ${scalar(entry.purpose)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Write the inspectable copy, only when it changed.
 *
 * `ai/knowledge/framework/` is a declared SHARED capability, but what lands in it
 * here is not: `index.pages` and `index.fixtures` are one application's. So the file
 * carries the application in its name, with flat compatibility only for the explicitly
 * declared legacy owner. Registry size never changes the destination. Without that, a second application's
 * `excel:index` would silently overwrite the first's, and the overwrite would be
 * invisible because nothing reads this file back.
 */
export function writeIndex(index: FrameworkIndex = buildIndex()): { file: string; changed: boolean } {
  fs.mkdirSync(FRAMEWORK_DIR, { recursive: true });
  const scope = activeScope();
  if (index.applicationId !== scope.applicationId)
    throw new Error('Cannot write another application\'s framework index under the active scope.');
  const file = scopedFilePath(FRAMEWORK_DIR, index.applicationId, 'framework.yaml', scope.flatLayout);
  const next = toYaml(index);
  const changed = !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== next;
  if (changed)
    fs.writeFileSync(file, next, 'utf8');
  return { file: path.relative(ROOT, file).replace(/\\/g, '/'), changed };
}
