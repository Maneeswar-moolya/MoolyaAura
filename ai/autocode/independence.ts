/**
 * Generated tests must not assume the generation browser's state.
 *
 * This is a regression test for a defect that actually happened, twice, in Phase 4's
 * benchmark: the framework handed the agent a browser that was already signed in, so
 * the agent wrote a spec that opened `/apps` directly with no sign-in anywhere in it.
 * The spec then ran in a fresh browser, sat on the login page and failed.
 *
 * The falsification gate caught it - a spec that cannot reach its screen cannot pass
 * as written - but it caught it *late*, after a generation and two Playwright runs.
 * And it caught it for the wrong reason: had the row's assertion happened to be true
 * on the sign-in page, the gate would have accepted a test that only works when
 * something else signed the browser in first.
 *
 * So the rule is checked directly and cheaply, by reading the specs:
 *
 *   1. A spec for a row whose group starts signed in must contain a sign-in of its
 *      own - the existing fixture mechanism, not a bare navigation.
 *   2. No spec may reference the generation session at all: not the pinned session
 *      name, not `browse.mjs`, not `AUTOCODE_*`. Those exist only while a spec is
 *      being written; a spec that mentions them has confused the two worlds.
 *
 * Deliberately NOT part of `verify.ts`: the falsification gate is unchanged in this
 * phase, and this is a different kind of check anyway - it is about a property of the
 * whole suite, not about whether one spec can fail.
 *
 *   npm run excel:independence
 *   npm run excel:independence -- excel/login-test-cases.xlsx
 */

import fs from 'node:fs';
import path from 'node:path';

import { authRequirement } from './groups';
import { MAPPING_FILE, readMapping } from '../excel/mapping';
import { parseWorkbook } from '../excel/parser';

const ROOT = process.cwd();
const GENERATED = path.resolve(ROOT, 'tests-e2e', 'generated');

/** Ways a spec can legitimately authenticate, all of them through the fixtures. */
const SIGN_IN_PATTERNS = [
  /requireCredentials\s*\(/,
  /\bsignIn\s*\(/,
  /bugasuraCredentials/,
  /storageState/,
];

/**
 * References to the *generation* browser. None of these belong in a spec.
 *
 * `autocode` is the pinned CLI session name; a spec naming it would be reaching for a
 * browser that only exists while the spec is being written.
 */
const GENERATION_LEAKS = [
  /AUTOCODE_[A-Z_]+/,
  /browse\.mjs/,
  /['"`]autocode['"`]/,
  /AUTOCODE_SESSION_MANAGED/,
];

export interface Finding {
  file: string;
  testCaseId: string | null;
  problem: string;
  detail: string;
}

export interface IndependenceReport {
  specsChecked: number;
  authRowsChecked: number;
  findings: Finding[];
}

/** Every `TC_* - scenario` title in a spec, with the id. */
function testCaseIdsIn(source: string): string[] {
  return [...source.matchAll(/['"`]\s*((?:TC|TS)[_-][A-Za-z0-9_-]+)\s*-/g)].map(match => match[1].toUpperCase());
}

/**
 * Split a spec into its per-test blocks, so a finding names the test rather than the
 * file. Indentation-aware for the same reason `parseSpec` is: these specs wrap their
 * tests in `test.describe`.
 */
function testBlocks(source: string): Array<{ id: string | null; body: string }> {
  const lines = source.split('\n');
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*test(?:\.(?:only|skip|fixme))?\s*\(/.test(lines[index]))
      starts.push(index);
  }
  if (!starts.length)
    return [{ id: null, body: source }];

  const header = lines.slice(0, starts[0]).join('\n');
  return starts.map((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1] : lines.length;
    const body = lines.slice(start, end).join('\n');
    return {
      id: testCaseIdsIn(body)[0] ?? null,
      // The header travels with every block: imports and file-level constants are
      // where `requireCredentials` is imported and where a shared sign-in helper
      // would live, so judging a block without it would report false violations.
      body: `${header}\n${body}`,
    };
  });
}

export async function checkIndependence(workbook?: string): Promise<IndependenceReport> {
  const findings: Finding[] = [];

  /** Rows whose group starts signed in, so their specs must sign in themselves. */
  const needsAuth = new Set<string>();
  if (workbook && fs.existsSync(path.resolve(ROOT, workbook))) {
    const parsed = await parseWorkbook(path.resolve(ROOT, workbook));
    for (const testCase of parsed.testCases) {
      // The TEST's own starting state: this check is about what the SPEC must do.
      if (authRequirement(testCase).testStartsSignedIn)
        needsAuth.add(testCase.testCaseId.toUpperCase());
    }
  } else {
    // Without a workbook, fall back to the mapping's record of which rows exist.
    // Less precise about authentication, so only the leak check applies to those.
    const mapping = readMapping(MAPPING_FILE);
    void mapping;
  }

  const specs = fs.existsSync(GENERATED)
    ? fs.readdirSync(GENERATED).filter(name => name.endsWith('.spec.ts'))
    : [];

  let authRowsChecked = 0;
  for (const name of specs) {
    const file = `tests-e2e/generated/${name}`;
    const source = fs.readFileSync(path.join(GENERATED, name), 'utf8');

    for (const leak of GENERATION_LEAKS) {
      const found = leak.exec(source);
      if (found) {
        findings.push({
          file, testCaseId: null,
          problem: 'references the generation browser',
          detail: `matched ${leak} ("${found[0]}") - the generation session does not exist when this spec runs`,
        });
      }
    }

    for (const block of testBlocks(source)) {
      if (!block.id || !needsAuth.has(block.id))
        continue;
      authRowsChecked += 1;
      if (!SIGN_IN_PATTERNS.some(pattern => pattern.test(block.body))) {
        findings.push({
          file, testCaseId: block.id,
          problem: 'starts signed in but never signs in',
          detail: 'its workbook row declares a signed-in precondition, and the spec contains no ' +
            'requireCredentials/signIn - it can only pass if something else signed the browser in',
        });
      }
    }
  }

  return { specsChecked: specs.length, authRowsChecked, findings };
}

async function main(): Promise<void> {
  const workbook = process.argv.slice(2).find(argument => !argument.startsWith('-'))
    ?? 'excel/login-test-cases.xlsx';
  const report = await checkIndependence(workbook);

  console.log(`\nGenerated-test independence: ${report.specsChecked} spec file(s), ` +
    `${report.authRowsChecked} test(s) whose row starts signed in.\n`);

  if (!report.findings.length) {
    console.log('  PASS - every signed-in row authenticates for itself, and no spec references');
    console.log('         the generation browser.\n');
    return;
  }
  for (const finding of report.findings) {
    console.log(`  FAIL ${finding.file}${finding.testCaseId ? ` :: ${finding.testCaseId}` : ''}`);
    console.log(`       ${finding.problem}`);
    console.log(`       ${finding.detail}`);
  }
  console.log('');
  process.exitCode = 1;
}

if (require.main === module)
  void main();
