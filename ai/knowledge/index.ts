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
  /** Page Objects, keyed by class name. */
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

export function buildIndex(): FrameworkIndex {
  const index: FrameworkIndex = { pages: {}, fixtures: [], support: {} };

  const pagesDir = path.join(TESTS, 'pages');
  if (fs.existsSync(pagesDir)) {
    for (const name of fs.readdirSync(pagesDir).filter(file => file.endsWith('.ts'))) {
      const absolute = path.join(pagesDir, name);
      index.pages[className(absolute)] = readIndexed(absolute);
    }
  }

  const fixturesFile = path.join(TESTS, 'fixtures.ts');
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
  lines.push(`  importFrom: tests-e2e/fixtures.ts`);
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

/** Write the inspectable copy, only when it changed. */
export function writeIndex(index: FrameworkIndex = buildIndex()): { file: string; changed: boolean } {
  fs.mkdirSync(FRAMEWORK_DIR, { recursive: true });
  const file = path.join(FRAMEWORK_DIR, 'framework.yaml');
  const next = toYaml(index);
  const changed = !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== next;
  if (changed)
    fs.writeFileSync(file, next, 'utf8');
  return { file: path.relative(ROOT, file).replace(/\\/g, '/'), changed };
}
