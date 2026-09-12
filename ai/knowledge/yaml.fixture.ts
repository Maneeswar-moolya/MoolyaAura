import '../testing/isolated-checkout';
/**
 * The offline gate for the YAML reader. No browser, no model, no network, no writes.
 *
 * It exists because of one failure that cost a working day and looked like six
 * different bugs. `ai/knowledge/page/fixtureapp__apps.yaml` is committed as LF. Git
 * for Windows sets `core.autocrlf=true`, so a plain `git clone` writes it to disk
 * as CRLF. Every line-oriented step in the reader splits on '\n' and most of them
 * `trim()`, which hides the trailing '\r' - except the block-scalar opener, which
 * anchors `[ \t]*$`. `description: >` arrives as `description: >\r`, does not
 * match, the block is never folded, and its first body line surfaces as
 * "Unexpected indentation on line 73". The file was never wrong; the checkout was.
 * Two knowledge files failed this way and the generator crashed on knowledge it
 * had written itself.
 *
 * So the invariant this file defends is not "the parser works". It is:
 *
 *   the SAME bytes, differing ONLY in line terminator, must parse to the SAME value
 *
 * for every real knowledge file, in both directions, plus a lone '\r'. Section 3
 * is the other half and matters just as much: making the reader tolerant must not
 * make it permissive. Genuinely malformed YAML must still throw, with the same
 * message and the same line number it threw before - a fix that turned a loud
 * failure into a quiet half-read would be worse than the bug.
 *
 * Run: npx tsx ai/knowledge/yaml.fixture.ts
 */

import fs from 'node:fs';

import { parse } from './yaml';
import { readAllPageKnowledge } from './page-knowledge';

// The block scalar is authored here, not copied from an application knowledge file.
const foldedFile = 'ai/knowledge/page/fixtureapp__apps.yaml';
fs.appendFileSync(foldedFile, '\n  fixture_grid:\n    description: >\n      A synthetic folded description\n      with a colon: literal prose;\n      ends at the authored boundary.\n');

const FILES = [
  'ai/knowledge/page/fixtureapp__apps.yaml',
  'ai/knowledge/page/fixtureapp__issues-id.yaml',
  'ai/knowledge/page/fixtureapp__root.yaml',
  'ai/knowledge/framework/framework.yaml',
];

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    console.log(`  ok    ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const asLf = (s: string) => s.replace(/\r\n?/g, '\n');
const asCrlf = (s: string) => asLf(s).replace(/\n/g, '\r\n');
const asCr = (s: string) => asLf(s).replace(/\n/g, '\r');

function parseOrMessage(source: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: parse(source) };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/** 1. Every synthetic knowledge file parses, whatever this checkout put on disk. */
function onDiskSection(): void {
  console.log('\n1. The synthetic knowledge files, exactly as this checkout wrote them\n');
  for (const file of FILES) {
    const text = fs.readFileSync(file, 'utf8');
    const crlf = (text.match(/\r\n/g) || []).length;
    const result = parseOrMessage(text);
    check(`parses: ${file}`, result.ok,
      `${crlf ? `CRLF x${crlf}` : 'LF'}${result.ok ? '' : ` - ${result.message}`}`);
  }
}

/** 2. Line endings cannot change the parsed value. This is the whole point. */
function equivalenceSection(): void {
  console.log('\n2. LF, CRLF and lone CR parse to identical values\n');
  for (const file of FILES) {
    const source = fs.readFileSync(file, 'utf8');
    const lf = parseOrMessage(asLf(source));
    const crlf = parseOrMessage(asCrlf(source));
    const cr = parseOrMessage(asCr(source));

    check(`LF parses:   ${file}`, lf.ok, lf.ok ? '' : lf.message);
    check(`CRLF parses: ${file}`, crlf.ok, crlf.ok ? '' : crlf.message);
    check(`CR parses:   ${file}`, cr.ok, cr.ok ? '' : cr.message);

    if (lf.ok && crlf.ok && cr.ok) {
      const a = JSON.stringify(lf.value);
      const b = JSON.stringify(crlf.value);
      const c = JSON.stringify(cr.value);
      check(`INVARIANT: LF === CRLF for ${file}`, a === b,
        a === b ? `${a.length} chars of JSON, identical` : 'parsed values diverge');
      check(`INVARIANT: LF === CR for ${file}`, a === c,
        a === c ? 'identical' : 'parsed values diverge');
    }
  }
}

/**
 * 3. Tolerance must not become permissiveness.
 *
 * Each case is malformed for a reason that has nothing to do with line endings, so
 * it must still throw - and throw the SAME thing under CRLF, because normalising
 * '\r\n' to '\n' preserves the line count and so must preserve the line number.
 */
function strictnessSection(): void {
  console.log('\n3. Malformed YAML still fails, identically under CRLF\n');
  const cases: { name: string; source: string; expect: RegExp }[] = [
    {
      name: 'a line indented under a completed scalar',
      source: 'a: 1\n  b: 2\n',
      expect: /^Unexpected indentation on line 2:/,
    },
    {
      name: 'a mapping line with no colon',
      source: 'top:\n  key: value\n  no colon here\n',
      expect: /^Expected "key: value" on line 3, got: no colon here$/,
    },
    {
      // The same rejection down the sequence branch, which is a separate code
      // path from the mapping one above and has its own line-number arithmetic.
      name: 'a sequence item continued by a line with no colon',
      source: 'list:\n  - name: x\n    bad line\n',
      expect: /^Expected "key: value" on line 3, got: bad line$/,
    },
  ];

  for (const testCase of cases) {
    const lf = parseOrMessage(testCase.source);
    const crlf = parseOrMessage(asCrlf(testCase.source));
    check(`LF rejects: ${testCase.name}`, !lf.ok && testCase.expect.test(lf.message),
      lf.ok ? 'ACCEPTED - validation was weakened' : lf.message);
    check(`CRLF rejects identically: ${testCase.name}`,
      !crlf.ok && !lf.ok && crlf.message === lf.message,
      crlf.ok ? 'ACCEPTED - validation was weakened' : crlf.message);
  }
}

/**
 * 4. Block scalars still fold, and still fold to the same text either way.
 *
 * `fixture_grid.description` in fixtureapp__apps.yaml is an authored minimal reproduction of a folded scalar; its boundaries and colon
 * are asserted independently of any application corpus.
 */
function blockScalarSection(): void {
  console.log('\n4. Block scalars fold, and fold identically\n');
  const file = 'ai/knowledge/page/fixtureapp__apps.yaml';
  const source = fs.readFileSync(file, 'utf8');

  for (const [label, text] of [['LF', asLf(source)], ['CRLF', asCrlf(source)]] as [string, string][]) {
    const result = parseOrMessage(text);
    if (!result.ok) {
      check(`${label}: block scalar folds`, false, result.message);
      continue;
    }
    const elements = (result.value as Record<string, Record<string, Record<string, unknown>>>).elements;
    const description = elements?.fixture_grid?.description;
    check(`${label}: fixture_grid.description is a folded string`, typeof description === 'string');
    if (typeof description !== 'string')
      continue;
    check(`${label}: folded to one line`, !/[\r\n]/.test(description),
      `${description.length} chars, no line break`);
    check(`${label}: content preserved`,
      description.startsWith('A synthetic folded description')
      && description.includes('ends at the authored boundary.'),
      'opens and closes with the author\'s own words');
  }

  // A colon inside folded prose is prose, not a key. This is the line the folder
  // has to get right or `route: fixtureapp__apps.yaml` becomes a mapping.
  const folded = parseOrMessage(asCrlf(source));
  if (folded.ok) {
    const description = (folded.value as any).elements?.fixture_grid?.description as string;
    check('CRLF: a colon inside folded prose stays prose',
      typeof description === 'string' && description.includes('with a colon: literal prose;'));
  }
}

/**
 * 5. Normalisation is confined to the text the parser walks.
 *
 * `raw` is inlined into the generator's prompt as the file's own bytes. If the
 * reader ever started handing back a rewritten copy, what an agent reads would stop
 * being what a person wrote - so on a CRLF checkout, raw must STILL be CRLF.
 */
function rawUntouchedSection(): void {
  console.log('\n5. knowledge.raw is still the file\'s own bytes\n');
  const knowledge = readAllPageKnowledge();
  check('readAllPageKnowledge() loaded every page file', knowledge.length >= 3,
    `${knowledge.length} file(s)`);

  for (const entry of knowledge) {
    const onDisk = fs.readFileSync(entry.file, 'utf8');
    const diskHasCrlf = /\r\n/.test(onDisk);
    const rawHasCrlf = /\r\n/.test(entry.raw);
    check(`raw matches disk byte-for-byte: ${entry.file}`, entry.raw === onDisk,
      diskHasCrlf === rawHasCrlf
        ? `${diskHasCrlf ? 'CRLF' : 'LF'} on disk, same in raw`
        : 'raw was rewritten - the prompt would no longer show what was written');
  }
}

console.log('\nYAML reader - line-ending robustness');
onDiskSection();
equivalenceSection();
strictnessSection();
blockScalarSection();
rawUntouchedSection();
console.log(`\n${failures ? 'FAIL' : 'PASS'} - ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
