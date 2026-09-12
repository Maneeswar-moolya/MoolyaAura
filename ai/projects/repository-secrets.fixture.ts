/**
 * PHASE 8: the repository must not track a secret.
 *
 * ONE INVARIANT, AND IT IS ABOUT GIT RATHER THAN ABOUT CODE:
 *
 *   `.env` must not be tracked.
 *
 * This exists because it was. `.gitignore` has carried `.env` since the beginning and
 * had no effect, because **gitignore only applies to files Git is not already
 * tracking** - the file had been committed before the rule was added, so every later
 * change to it was committed too, and the ignore line read like protection while
 * providing none. That is the whole failure mode worth testing for: not "is there a
 * rule" but "is the file actually untracked".
 *
 * WHY THIS CANNOT BE A CODE REVIEW
 *
 * Nothing in the source is wrong. `env.ts` reads the variables correctly, the recorder
 * redacts passwords before anything reaches disk, the registry stores credential
 * VARIABLE NAMES rather than values, and no credential reaches a log call. The defect
 * lived entirely in the index, where no amount of reading TypeScript would find it.
 *
 * WHAT THIS FIXTURE DELIBERATELY DOES NOT DO
 *
 * It never reads `.env`, never prints a value, and never reports what a secret looks
 * like. It asks Git what is tracked and matches SHAPES in tracked source. A test that
 * had to find a secret in order to prove one is absent would itself be a disclosure -
 * and its output, which lands in CI logs, would be the new leak. So the assertions are
 * about NAMES and TRACKING STATUS only, and every failure message names a file, never
 * a value.
 *
 * It also does not rewrite history. Untracking a file does not remove it from earlier
 * commits; that is an operational decision with a force-push attached, and a fixture
 * is not where it belongs. See REMAINING.md for the rotation and cleanup record.
 *
 * Run: npx tsx ai/projects/repository-secrets.fixture.ts
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition)
    failures += 1;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

const ROOT = process.cwd();

/**
 * Ask Git, with an argv array and no shell.
 *
 * `git ls-files` prints nothing and exits 0 for a path it does not track, so an empty
 * answer IS the answer - there is no error to catch and no exit code to read.
 */
function tracked(pathspec: string): string[] {
  try {
    return execFileSync('git', ['ls-files', '--', pathspec], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Files that must never be tracked, whatever a .gitignore rule claims. */
const MUST_NOT_BE_TRACKED = [
  '.env',
  '.env.local',
  '.env.production',
  // Not `*.pem`/`*.key` as a pathspec, because Git would expand it per directory;
  // the extension sweep below covers those across the whole tracked set.
];

function sectionTrackedSecrets(): void {
  console.log('\n1. No secret file is tracked\n');

  for (const file of MUST_NOT_BE_TRACKED) {
    const hits = tracked(file);
    check(`${file} is not tracked by Git`, hits.length === 0,
        hits.length ? `TRACKED: ${hits.join(', ')} - run \`git rm --cached ${file}\`` : 'untracked');
  }

  // `.env.example` is the opposite case and must STAY tracked: it is the template that
  // tells somebody which variables to set, and it carries names with empty values. A
  // check that only ever says "no env file may be tracked" would delete the one that
  // should be there, so the distinction is asserted rather than assumed.
  check('.env.example IS tracked, because a template is not a secret',
      tracked('.env.example').length === 1);
  const example = path.join(ROOT, '.env.example');
  if (fs.existsSync(example)) {
    const filled = fs.readFileSync(example, 'utf8').split('\n')
        .filter(line => /^[A-Z][A-Z0-9_]*=.+$/.test(line.trim()))
        // A committed EXAMPLE address is documentation, not a credential; a committed
        // password is a credential whatever the file is called.
        .filter(line => /PASSWORD|SECRET|TOKEN|KEY/i.test(line))
        .map(line => line.split('=')[0]);
    check('and it declares no filled-in secret', filled.length === 0,
        filled.length ? `these carry a value: ${filled.join(', ')}` : 'names only');
  }

  // The rule must be there as well as effective - untracking without the rule means
  // the next `git add -A` puts it straight back.
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  check('.gitignore still declares .env', /^\.env$/m.test(ignore),
      'the rule alone is not protection, but its absence would undo this');
}

/**
 * What THIS repository authors, as opposed to what it vendors or wraps.
 *
 * `tests/` is the UPSTREAM Playwright MCP suite - the root CLAUDE.md opens by
 * explaining that two unrelated suites live side by side - and `.claude/skills/` is
 * vendored documentation. Both legitimately contain credential-shaped material that is
 * not ours: the upstream suite ships a self-signed certificate and key for its local
 * HTTPS test server, and a Playwright mocking example shows a fake login response.
 *
 * Excluded by DIRECTORY, never by value, so this cannot become a place where somebody
 * records what a real secret looks like in order to skip it. Deleting upstream's test
 * certificate would also be wrong: it is not a secret, and it is not ours to remove.
 */
const OURS = /^(ai|tests-e2e|excel|docs)\/|^[^/]+\.(ts|json|ya?ml|md)$/;

function sectionTrackedExtensions(): void {
  console.log('\n2. No key-shaped file is tracked\n');
  const dangerous = /\.(pem|key|p12|pfx|jks|keystore)$/i;
  const hits = tracked('.').filter(file => OURS.test(file) && dangerous.test(file));
  check('no private key or keystore is tracked in our own source', hits.length === 0,
      hits.length ? hits.join(', ') : 'none');
}

/**
 * Credential-SHAPED literals in tracked source.
 *
 * Shapes, never values. The pattern looks for an assignment of a quoted literal to a
 * credential-sounding name, and every exemption below is a category rather than a
 * specific string, so this cannot become a place where somebody records what a real
 * secret looks like in order to skip it.
 */
function sectionSourceLiterals(): void {
  console.log('\n3. No credential-shaped literal in tracked source\n');
  //
  // PRODUCTION SOURCE ONLY. A fixture is excluded deliberately: several of them exist
  // to prove the credential DETECTOR works, and doing that requires constructing a
  // credential-shaped string. `authoring-model.fixture.ts` asserts that
  // `credentialsIn('token: "..."')` finds one - the literal is the test input, and a
  // rule that refused it would be refusing the test that protects the workbook.
  //
  // The distinction is the rule: production code must contain none; a fixture may
  // build one, because that is what testing a detector means.
  const files = tracked('.')
      .filter(file => OURS.test(file) && /\.(ts|json|ya?ml|md|html)$/i.test(file))
      .filter(file => !/\.fixture\.ts$/.test(file));
  const assignment = /(password|passwd|secret|api[_-]?key|apikey|token|bearer|credential)\s*[:=]\s*(['"`])([^'"`]{6,})\2/i;

  const findings: string[] = [];
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute))
      continue;
    let lineNumber = 0;
    for (const line of fs.readFileSync(absolute, 'utf8').split('\n')) {
      lineNumber += 1;
      const match = assignment.exec(line);
      if (!match)
        continue;
      const value = match[3];
      const exempt =
        // A variable NAME, which is what the registry and env.ts store by design.
        /^[A-Z][A-Z0-9_]*$/.test(value)
        // A workbook token, a redaction marker, or a placeholder - all deliberate.
        || /^<[^>]+>$/.test(value) || value === '[type=password]'
        // Anything a fixture invented for itself. These are not real and saying so is
        // the point of the naming convention.
        || /not-a-real|not-the-real|definitely-not|synthetic|example|placeholder|dummy|changeme|xxx+/i.test(value)
        // A reference to an env var rather than a value.
        || /process\.env|\$\{/.test(line);
      if (!exempt)
        findings.push(`${file}:${lineNumber} (${match[1].toLowerCase()})`);
    }
  }
  // Location only. The value that triggered it is never printed - a failure tells
  // somebody where to look, and looking is their job.
  check('no tracked production file assigns a credential-shaped literal', findings.length === 0,
      findings.length ? `${findings.length}: ${findings.slice(0, 5).join(', ')}` : `${files.length} file(s) scanned`);
}

console.log('\nRepository secrets - what Git tracks, not what the code says');
sectionTrackedSecrets();
sectionTrackedExtensions();
sectionSourceLiterals();
console.log(`\n${failures ? 'FAIL' : 'PASS'} - ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
