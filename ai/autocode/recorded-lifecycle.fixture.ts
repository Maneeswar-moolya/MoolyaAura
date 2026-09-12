import '../testing/isolated-checkout';
/**
 * The recorded-test lifecycle, pinned offline.
 *
 *   npx tsx ai/autocode/recorded-lifecycle.fixture.ts
 *
 * No browser, no model, no network, no live application. It drives the real
 * functions - `parseRecording`, `mapRecording`, `generateFromRecording`,
 * `quarantine`, `retractSpec`, `surveyWork`, `classifyRecordedFailure` - over
 * synthetic recordings, and removes everything it wrote.
 *
 * The check that matters most is TEST A. Assertions used to be emitted after every
 * action regardless of where they were recorded, which turned "check the modal, then
 * cancel" into "cancel, then check the modal" and failed the result as a bad
 * recording. If that check ever goes red, recorded tests are being blamed for a
 * defect in this repository.
 */

import fs from 'node:fs';
import path from 'node:path';

import { artifactPath, parseRecording, type Recording } from '../dashboard/recorder';
import { NEEDS_CONFIRMATION } from '../dashboard/placeholders';
import {
  generateFromRecording, mapRecording, pageObjectRequirements, acceptRecording,
} from './from-recording';
import { quarantine, recordedSpecPathFor, retractSpec } from './orchestrate';
import { classifyRecordedFailure } from './metrics';
import { fingerprint, stateKeyFor, surveyWork, type State } from './work';
import { activeMappingFile, readMapping } from '../excel/mapping';
import {
  enterIsolatedArtefactRoot, isInsideFixtureRoot, leaveIsolatedArtefactRoot,
} from '../projects/fixture-safety';
import { activeScope } from '../projects/scope';
import { parseWorkbook } from '../excel/parser';
import type { TestCase } from '../excel/types';

const ROOT = process.cwd();
const WORKBOOK = 'excel/fixture-cases.xlsx';
const abs = (relative: string) => path.resolve(ROOT, relative);

let failures = 0;
const written: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

function syntheticCase(id: string, scenario: string, expectedResult = 'The banner is visible'): TestCase {
  return {
    testCaseId: id, module: '', feature: '', scenario, description: '',
    preconditions: '', steps: ['Open the sign-in page', 'Check the banner'],
    testData: '', expectedResult, priority: '' as TestCase['priority'],
    tags: ['recorded'], automationStatus: 'Not Automated', automationNotes: '',
    execute: null, expectedOutcome: '', expectedMessage: '',
    requirementId: '', testType: '' as TestCase['testType'],
    businessRisk: '' as TestCase['businessRisk'], environment: '', userRole: '',
    authenticationProfile: '', testOwner: '',
    source: {
      workbookPath: '', workbook: 'login-test-cases.xlsx',
      worksheet: 'Login Test Cases', row: 999,
    },
    extra: {}, issues: [],
  };
}

function keep(id: string, source: string): void {
  const file = artifactPath(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, 'utf8');
  written.push(file);
}

function generate(id: string, scenario: string, source: string) {
  keep(id, source);
  const spec = recordedSpecPathFor(id);
  written.push(abs(spec));
  return { spec, result: generateFromRecording(syntheticCase(id, scenario), spec, WORKBOOK) };
}

/** A1 A2 ASSERT1 A3 A4 ASSERT2 — the shape the brief asks for by name. */
const INTERLEAVED = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.fixture.invalid/');
  await page.getByRole('textbox', { name: 'Email' }).fill('someone@moolya.com');
  await expect(page.locator('#loginForm')).toContainText('Sign In');
  await page.getByRole('textbox', { name: 'Password' }).fill('[type=password]');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.locator('#project_banner')).toContainText('Multi tasking is hard. Focus is good.');
});
`;

const NO_ASSERTION = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.fixture.invalid/');
  await page.getByRole('textbox', { name: 'Email' }).fill('someone@moolya.com');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
});
`;

const RAW_LOCATOR = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://portal.fixture.invalid/');
  await page.locator('#some_unknown_widget .thing').click();
  await expect(page.locator('#project_banner')).toContainText('Multi tasking is hard. Focus is good.');
});
`;

async function main(): Promise<void> {
  process.stdout.write('\n== TEST A — recorded order is preserved ==\n');

  const parsedRecording = parseRecording(INTERLEAVED, { startUrl: '', browser: '', durationMs: 0 });
  check('every assertion carries its position',
      parsedRecording.assertions.every(a => a.afterActions !== undefined),
      JSON.stringify(parsedRecording.assertions.map(a => a.afterActions)));

  const a = generate('TC_TEST_A', 'A — interleaved', INTERLEAVED);
  check('assembled', a.result.assembled, a.result.reason);
  check('order was reconstructed', a.result.metrics.orderReconstructed);

  const sourceA = fs.readFileSync(abs(a.spec), 'utf8');
  const at = (needle: string) => sourceA.indexOf(needle);
  const signIn = at('loginPage.signIn(');
  const firstAssert = at("expect(page.locator('#loginForm'))");
  const secondAssert = at("expect(page.locator('#project_banner'))");
  check('ASSERT1 is emitted BEFORE the sign-in it preceded', firstAssert > 0 && firstAssert < signIn,
      `assert@${firstAssert} signIn@${signIn}`);
  check('ASSERT2 is emitted after it', secondAssert > signIn);
  check('both assertions survived', firstAssert > 0 && secondAssert > 0);

  process.stdout.write('\n== TEST A2 — legacy recording with no positions ==\n');
  const legacy: Recording = {
    ...parsedRecording,
    assertions: parsedRecording.assertions.map(({ afterActions, ...rest }) => rest),
  };
  const legacyMapping = mapRecording(legacy);
  check('flagged as NOT reconstructed', legacyMapping.orderReconstructed === false);
  const legacyCode = legacyMapping.steps.map(s => s.code.join(' ')).join('\n');
  check('falls back to assertions-last (old behaviour, never guessed)',
      legacyCode.lastIndexOf('signIn(') < legacyCode.indexOf("expect(page.locator('#loginForm'))"));

  process.stdout.write('\n== TEST B — no assertion ==\n');
  const b = generate('TC_TEST_B', 'B — no assertion', NO_ASSERTION);
  check('not assembled', !b.result.assembled);
  check('blocked as noAssertion', b.result.block === 'noAssertion', b.result.reason);
  check('no spec written (nothing to quarantine)', !fs.existsSync(abs(b.spec)));
  check('classified RECORDED_NO_ASSERTION',
      classifyRecordedFailure({ block: b.result.block, orderReconstructed: true, reason: b.result.reason })
        === 'RECORDED_NO_ASSERTION');
  check('no AI call and no browser recorded',
      b.result.metrics.aiFallbackCalls === 0 && b.result.metrics.browserOpened === 0);
  check('artifact retained for the author', fs.existsSync(artifactPath('TC_TEST_B')));

  process.stdout.write('\n== TEST B2 — the survey stops a placeholder row before anything runs ==\n');
  const parsed = await parseWorkbook(abs(WORKBOOK));
  const mapping = readMapping(activeMappingFile());
  const probe = parsed.testCases.find(t => t.testCaseId === 'TC_SYNTHETIC_001');
  if (!probe)
    throw new Error('TC_SYNTHETIC_001 missing from the workbook');
  const placeholderRow = { ...probe, expectedResult: NEEDS_CONFIRMATION };
  const surveyed = surveyWork(
      { ...parsed, testCases: [placeholderRow] }, {}, {}, new Set(['TC_SYNTHETIC_001']));
  check('not sent to generation', surveyed.work.length === 0);
  check('skipped with the explicit reason',
      Boolean(surveyed.skipped[0]?.reason.includes('recorded test has no assertion')),
      surveyed.skipped[0]?.reason ?? '');

  process.stdout.write('\n== TEST C — existing Page Object reuse ==\n');
  check('sign-in reused LoginPage.signIn', sourceA.includes('loginPage.signIn('));
  check('navigation reused a Page Object open()', sourceA.includes('loginPage.open()'));
  check('reuse counted', a.result.metrics.reusedPageObjectMethods >= 2,
      String(a.result.metrics.reusedPageObjectMethods));
  check('no new Page Object method invented', a.result.metrics.newPageObjectMethods === 0);
  check('no AI, no browser',
      a.result.metrics.aiFallbackCalls === 0 && a.result.metrics.browserOpened === 0);

  process.stdout.write('\n== TEST D — raw locator is classified, not counted as reuse ==\n');
  const d = generate('TC_TEST_D', 'D — raw locator', RAW_LOCATOR);
  check('still assembles and still goes to the gate', d.result.assembled, d.result.reason);
  check('classified as Page Object Required', d.result.metrics.pageObjectRequired.length >= 1,
      JSON.stringify(d.result.metrics.pageObjectRequired.map(r => r.did)));
  check('the requirement names the element and its locator',
      Boolean(d.result.metrics.pageObjectRequired[0]?.locator.includes('#some_unknown_widget')),
      d.result.metrics.pageObjectRequired[0]?.locator ?? '');
  check('raw steps are not reported as reuse',
      d.result.metrics.reusedPageObjectMethods < d.result.metrics.codegenActions);
  check('pageObjectRequirements() agrees with the metric',
      pageObjectRequirements(d.result.mapping!).length === d.result.metrics.pageObjectRequired.length);

  process.stdout.write('\n== TEST E/F/G — artifact lifecycle and spec isolation ==\n');
  const c = generate('TC_TEST_C', 'C — will be refused', INTERLEAVED);
  check('TC_TEST_C assembled', c.result.assembled, c.result.reason);
  const kept = quarantine(c.spec, 'TC_TEST_C');
  written.push(abs(kept));
  retractSpec(c.spec, 'TC_TEST_C', () => {});

  check('E: artifact retained after a refusal', fs.existsSync(artifactPath('TC_TEST_C')));
  const artifactText = fs.readFileSync(artifactPath('TC_TEST_C'), 'utf8');
  check('E: no credential value in the retained artifact',
      artifactText.includes('[type=password]') && !/fill\('(?!\[type=password\])[^']*'\)/.test(
          artifactText.split('\n').filter(l => l.includes('Password')).join('\n')));
  const ignore = fs.readFileSync(abs('.gitignore'), 'utf8');
  check('E: recordings are git-ignored', /ai\/dashboard\/recordings/.test(ignore),
      ignore.split('\n').filter(l => l.includes('recordings')).join(' | '));

  check('F: artifact removed once the gate accepts', (() => {
    acceptRecording('TC_TEST_A');
    return !fs.existsSync(artifactPath('TC_TEST_A'));
  })());

  check('G: TC_TEST_C spec removed', !fs.existsSync(abs(c.spec)));
  check('G: TC_TEST_C kept in quarantine for diagnosis', fs.existsSync(abs(kept)));
  check('G: *** TC_TEST_A spec survived ***', fs.existsSync(abs(a.spec)));
  check('G: *** TC_TEST_D spec survived ***', fs.existsSync(abs(d.spec)));

  process.stdout.write('\n== TEST H — stale accepted state ==\n');
  const only = new Set(['TC_SYNTHETIC_001']);
  // Keyed `applicationId/testCaseId` - the generation identity. See work.ts State.
  const entry = (specFile: string) => ({
    [stateKeyFor('TC_SYNTHETIC_001')]: {
      fingerprint: fingerprint(probe), verdict: 'accepted' as const, specFile,
      reason: 'fixture', model: 'none', at: new Date(0).toISOString(), attempts: 0,
    },
  }) as State;
  check('spec present → skipped', surveyWork(parsed, mapping, entry(a.spec), only).work.length === 0);
  const stale = surveyWork(parsed, mapping, entry('tests-e2e/generated/gone.spec.ts'), only);
  check('spec missing → generation work', stale.work.length === 1);
  check('reason names the missing spec',
      Boolean(stale.work[0]?.staleReason?.includes('spec file missing')), stale.work[0]?.staleReason ?? '');

  process.stdout.write('\n== TEST K — the AI path is untouched ==\n');
  const orchestrateSource = fs.readFileSync(abs('ai/autocode/orchestrate.ts'), 'utf8');
  check('specPathFor still module/worksheet based',
      orchestrateSource.includes('const name = slug(module.trim() || worksheet.trim());'));
  check('the agent branch still gates the shared module file',
      orchestrateSource.includes('const verdict = gate(specFile, testCase.testCaseId'));
  check('the recorded branch gates its own file',
      orchestrateSource.includes('const verdict = gate(recordedSpecFile, testCase.testCaseId'));
  const verifySource = fs.readFileSync(abs('ai/autocode/verify.ts'), 'utf8');
  check('verify.ts still runs clean then mutated', verifySource.includes('const broken = runOne(')
      && verifySource.includes('still passes with every assertion broken'));
  check('recorded specs are not exempted from the gate',
      !/recorded/i.test(verifySource.split('export function gate')[1] ?? ''));

  process.stdout.write('\n== classification table ==\n');
  const cases: Array<[string, Parameters<typeof classifyRecordedFailure>[0], string]> = [
    ['no assertion', { block: 'noAssertion', orderReconstructed: true, reason: '' }, 'RECORDED_NO_ASSERTION'],
    ['unmapped action', { block: 'unmappedAction', orderReconstructed: true, reason: '' }, 'RECORDED_UNMAPPED_ACTION'],
    ['no artifact', { block: 'noArtifact', orderReconstructed: true, reason: '' }, 'RECORDED_ASSEMBLY_ERROR'],
    ['clean failed, order rebuilt',
      { orderReconstructed: true, cleanStatus: 'Failed', reason: 'expect(locator).toContainText failed' },
      'RECORDED_CLEAN_RUN_FAILURE'],
    ['clean failed, order NOT rebuilt',
      { orderReconstructed: false, cleanStatus: 'Failed', reason: 'expect(locator).toContainText failed' },
      'RECORDED_ASSEMBLY_ERROR'],
    ['Page Object could not resolve',
      { orderReconstructed: true, cleanStatus: 'Failed', reason: 'Could not resolve "projects.createNewTeamOption" on /apps' },
      'RECORDED_APPLICATION_FAILURE'],
    ['mutated run passed',
      { orderReconstructed: true, cleanStatus: 'Passed', mutatedStatus: 'Passed', reason: 'still passes' },
      'RECORDED_MUTATION_FAILURE'],
  ];
  for (const [label, input, expected] of cases) {
    const actual = classifyRecordedFailure(input);
    check(`${label} → ${expected}`, actual === expected, actual || '(none)');
  }

}

/**
 * THE REAL ARTEFACT STORE, LISTED BEFORE ANYTHING RUNS.
 *
 * Taken before isolation is entered, so it is a list of what the repository actually
 * holds, and compared again at the end. It is the PROOF rather than the mechanism:
 * isolation is what keeps this fixture away from those files, and this is what would
 * notice if it ever stopped working.
 */
const realStore = path.join(ROOT, 'ai', 'dashboard', 'recordings');
function listStore(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir))
      return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory())
        walk(full);
      else
        out.push(full);
    }
  };
  walk(realStore);
  return out.sort();
}
const storeBefore = listStore();

/**
 * ISOLATED, and this fixture is the reason the rule needed restating.
 *
 * It drives the REAL `acceptRecording`, which ARCHIVES an artefact into `accepted/`
 * rather than deleting it - so the cleanup below, which removed `artifactPath(id)`, was
 * looking in the live directory for a file production had already moved out of it.
 * `TC_TEST_A.spec.ts` therefore accumulated in the real FixturePortal store, and the recorded
 * count of 410 quietly included it (409 without).
 *
 * Isolation is the fix rather than a longer cleanup list: a fixture that cannot reach the
 * real store cannot leave anything in it, whatever the production code it drives decides
 * to do with a file. Entered before `main()` because the module-level `written` paths and
 * every `artifactPath` call resolve through the scope.
 */
const fixtureRoot = enterIsolatedArtefactRoot('recorded-lifecycle');

/**
 * Seed the isolated root with the inputs this fixture READS.
 *
 * `AURA_ARTEFACT_ROOT` moves every application artefact together - Page Objects, page
 * knowledge, the mapping and the fixtures module as well as the recordings - so an empty
 * root leaves the framework index with no `LoginPage` to reuse and the fixture asserting
 * about a repository that does not exist. Copying is what keeps this honest: the fixture
 * reads real Page Objects and real knowledge, and writes only into the temporary tree, so
 * the originals cannot be touched however production behaves.
 *
 * Copies, never links: a symlink would make a stray write reach the real file, which is
 * the whole thing isolation exists to prevent.
 */
function seedIsolatedRoot(): void {
  const scope = activeScope();
  const copy = (from: string, to: string): void => {
    if (!fs.existsSync(from))
      return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  };
  copy(path.join(ROOT, 'tests-e2e', 'pages'), scope.paths.pagesDir);
  copy(path.join(ROOT, 'tests-e2e', 'fixtures.ts'), scope.paths.fixturesFile);
  copy(path.join(ROOT, 'ai', 'knowledge', 'page'), scope.paths.knowledgePageDir);
  copy(path.join(ROOT, 'ai', 'test-mapping', 'mapping.json'), scope.paths.mappingFile);
  // `ai/knowledge/framework` is framework-owned rather than application-owned, so it is
  // NOT part of the scope and is read from the repository either way.
}
seedIsolatedRoot();

main()
    .catch(error => { process.stdout.write(`\nfixture error: ${String(error)}\n`); failures++; })
    .finally(() => {
      process.stdout.write('\n== isolation ==\n');
      // THE QUARANTINE PILE IS DELIBERATELY GLOBAL, and `orchestrate.ts` says so in as
      // many words: "The directory stays GLOBAL - it is a diagnostic pile, not an
      // artefact store". So it is not scoped, cannot be isolated by an artefact root, and
      // is removed by name instead. Exempting it is a statement about that design, not a
      // hole in this check - everything the scope owns is still required to be isolated.
      const quarantinePile = path.join(ROOT, 'ai', 'autocode', 'quarantine');
      const isQuarantine = (file: string) =>
        !path.relative(quarantinePile, path.resolve(file)).startsWith('..');
      for (const file of written.filter(isQuarantine))
        fs.rmSync(file, { force: true });

      // Everything the scope owns must be inside the temporary root. The question is
      // WHERE it wrote, not whether the cleanup list was long enough.
      const stray = [...written, artifactPath('TC_TEST_B'), artifactPath('TC_TEST_C'),
        artifactPath('TC_TEST_D')]
          .filter(file => !isQuarantine(file) && !isInsideFixtureRoot(file));
      check('every scoped artefact this fixture wrote was inside the fixture root',
          stray.length === 0, stray.map(file => path.relative(ROOT, file)).join(', ') || 'none');
      check('and the global quarantine pile holds nothing of this fixture\'s',
          !fs.existsSync(quarantinePile)
          || !fs.readdirSync(quarantinePile).some(name => /TC_TEST_[A-Z]/.test(name)),
          fs.existsSync(quarantinePile)
            ? fs.readdirSync(quarantinePile).filter(name => /TC_TEST_[A-Z]/.test(name)).join(', ') || 'none'
            : 'no pile');

      leaveIsolatedArtefactRoot();

      const storeAfter = listStore();
      check('the real recordings store has the identical file list afterwards',
          JSON.stringify(storeBefore) === JSON.stringify(storeAfter),
          `${storeBefore.length} before, ${storeAfter.length} after`);
      check('and no TC_TEST_* artefact was left in it',
          !storeAfter.some(file => /TC_TEST_[A-Z]/.test(file)),
          storeAfter.filter(file => /TC_TEST_[A-Z]/.test(file))
              .map(file => path.relative(ROOT, file)).join(', ') || 'none');

      process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
      process.exit(failures ? 1 : 0);
    });
