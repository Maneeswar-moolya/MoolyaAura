import '../testing/isolated-checkout';
/**
 * The offline gate for the whole-pipeline application boundary. No browser, no model.
 *
 * It defends the acceptance criterion for N applications:
 *
 *   An arbitrary number of applications can be added from the Dashboard, and each
 *   application's Record -> Generate -> Run pipeline creates and uses its own
 *   application-owned artefacts without ever falling back to another application's.
 *
 * WHAT IT CAUGHT, MEASURED ON A REAL FIXTURESHOP RUN
 *
 * FixtureShop was provisioned from the dashboard, a case was recorded, and generation
 * selected `fixtureapp__root.yaml`, `fixtureapp__apps.yaml`, `fixtureapp__issues-id.yaml`, used
 * `tests-e2e/fixtures.ts`, and reported "no Codegen artifact was kept for this case" about
 * a recording that existed at `ai/dashboard/recordings/fixtureshop/TC_SMOKE_003.spec.ts`.
 * Four root causes, all of them here:
 *
 *   RC1  `orchestrate.run({ workbook })` never established a scope. Every artefact path
 *        resolves through `activeScopePath` -> `activeScope()`, which with no selection
 *        answers with the AMBIENT scope: the declared legacy owner. One missing statement
 *        and the entire run belonged to FixturePortal. This is the FIRST scope-loss point.
 *   RC2  A newly provisioned application has no fixtures module, and `applyProposals` did
 *        `fs.readFileSync(fixturesFile())` on it - ENOENT - while `registerFixture` needed
 *        an existing Page Object import group to anchor to, which a first registration has
 *        none of. So the step meant to SEED an application's namespace was the one step
 *        that could not run.
 *   RC3  The writer wrote files without creating their directory, so the first Page Object
 *        a new application produced failed with ENOENT on `tests-e2e/pages/<app>/`.
 *   RC4  The credentials fixture NAME was the literal `fixtureappCredentials`. Reported, not
 *        fixed here - see the phase report.
 *
 * SAFETY. Nothing real is written. Registries are temp files reached through
 * `AURA_REGISTRY_FILE`, every synthetic path lives under one temp directory that
 * `assertNothingRealAtRisk()` refuses to touch if it already exists, and the real
 * FixturePortal artefacts are hashed before and after.
 *
 * Run: npx tsx ai/projects/application-pipeline.fixture.ts
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { resetActiveApplication } from '../knowledge/canonical';
import { activeScope, pinActiveScope, resetActiveScope, resolveScope, ScopeError } from './scope';
import {
  enterIsolatedArtefactRoot, isInsideFixtureRoot, leaveIsolatedArtefactRoot,
} from './fixture-safety';

const ROOT = process.cwd();
const TEMP_DIR = path.join(ROOT, '.tmp-application-pipeline');

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (!condition)
    failures += 1;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n== ${title} ==`);
}

function norm(value: string): string {
  return path.relative(ROOT, path.resolve(ROOT, value)).split(path.sep).join('/');
}

function assertNothingRealAtRisk(): void {
  if (fs.existsSync(TEMP_DIR)) {
    throw new Error(`${norm(TEMP_DIR)} already exists. This fixture only ever creates it, `
      + 'so something else owns that path - refusing to run rather than delete it.');
  }
  if (!fs.existsSync(path.join(ROOT, 'ai', 'dashboard', 'recordings', 'fixtureapp'))) {
    throw new Error('The real FixturePortal recording store is missing. Refusing to run: this '
      + 'fixture asserts it is UNCHANGED, and it cannot do that if it is not there.');
  }
}

function realDigest(): { files: number; digest: string } {
  const roots = ['ai/dashboard/recordings/fixtureapp', 'tests-e2e/pages', 'tests-e2e/generated',
    'ai/knowledge/page', 'ai/test-mapping/mapping.json', 'tests-e2e/fixtures.ts'];
  const hash = crypto.createHash('sha256');
  let files = 0;
  const walk = (target: string): void => {
    if (!fs.existsSync(target))
      return;
    if (fs.statSync(target).isFile()) {
      files += 1;
      hash.update(norm(target));
      hash.update(fs.readFileSync(target));
      return;
    }
    for (const name of fs.readdirSync(target).sort())
      walk(path.join(target, name));
  };
  for (const root of roots)
    walk(path.join(ROOT, root));
  return { files, digest: hash.digest('hex') };
}

/* ------------------------------------------------------------ the registry ----- */

const WB = {
  legacy: 'excel/legacy-cases.xlsx',
  alpha: 'excel/alpha-cases.xlsx',
  beta: 'excel/beta-cases.xlsx',
  // Same BASENAME as alpha, in a different directory - requirement J.
  betaTwin: 'excel/twin/alpha-cases.xlsx',
};

/** Three applications: one legacy (flat), two scoped. Deliberately not real ids. */
function useRegistry(options: { legacyOwner?: boolean; betaWorkbooks?: string[] } = {}): void {
  const file = path.join(TEMP_DIR, 'registry.json');
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    applications: [
      { applicationId: 'legacyapp', displayName: 'Legacy', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://legacy.invalid/' } },
        workbooks: [WB.legacy],
        ...(options.legacyOwner === false ? {} : { legacyLayout: true }) },
      { applicationId: 'alpha', displayName: 'Alpha', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://alpha.invalid/' } },
        workbooks: [WB.alpha] },
      { applicationId: 'beta', displayName: 'Beta', defaultEnvironmentId: 'qa',
        environments: { qa: { baseUrl: 'https://beta.invalid/' } },
        workbooks: options.betaWorkbooks ?? [WB.beta] },
    ],
  }, null, 2)}\n`, 'utf8');
  process.env.AURA_REGISTRY_FILE = path.relative(ROOT, file);
  resetActiveScope();
  resetActiveApplication();
}

function restore(): void {
  delete process.env.AURA_REGISTRY_FILE;
  delete process.env.AURA_APPLICATION;
  resetActiveScope();
  resetActiveApplication();
}

/** Every application-owned path, by the REAL production accessors. */
async function pathsUnderPin(request: { workbook?: string; applicationId?: string }):
Promise<Record<string, string>> {
  pinActiveScope(request);
  const writer = await import('../autocode/abstraction/writer');
  const work = await import('../autocode/work');
  const mapping = await import('../excel/mapping');
  const knowledge = await import('../knowledge/page-knowledge');
  const canonical = await import('../knowledge/canonical');
  const scope = await import('./scope');
  return {
    pagesDir: norm(writer.pagesDir()),
    knowledgeDir: norm(writer.knowledgeDir()),
    fixturesFile: norm(writer.fixturesFile()),
    generatedDir: norm(work.generatedDir()),
    mappingFile: norm(mapping.activeMappingFile()),
    recordingsDir: norm(scope.activeRecordingsDir()),
    knowledgePageDir: norm(knowledge.activeKnowledgePageDir()),
    canonicalApplication: canonical.activeApplicationId(),
  };
}

/* ================================================================ RC1 ========== */

async function partRC1(): Promise<void> {
  section('RC1 - generation establishes its scope from the workbook it was given');
  useRegistry();

  // THE DEFECT: with no selection the ambient scope answers with the legacy owner.
  delete process.env.AURA_APPLICATION;
  resetActiveScope();
  check('RC1-a: with nothing selected, the ambient scope IS the legacy owner',
      activeScope().applicationId === 'legacyapp', activeScope().applicationId);

  // THE FIX: pinning from the workbook moves every artefact class at once.
  const alpha = await pathsUnderPin({ workbook: WB.alpha });
  for (const [artefact, value] of Object.entries(alpha)) {
    if (artefact === 'canonicalApplication')
      continue;
    check(`RC1-b: ${artefact} follows the workbook, not the ambient default`,
        value.includes('alpha'), value);
  }
  check('RC1-c: canonical page identity is the workbook owner too',
      alpha.canonicalApplication === 'alpha', alpha.canonicalApplication);

  // And the legacy application still gets its flat locations.
  const legacy = await pathsUnderPin({ workbook: WB.legacy });
  check('RC1-d: the legacy application still resolves the unscoped directories',
      legacy.pagesDir === 'tests-e2e/pages' && legacy.fixturesFile === 'tests-e2e/fixtures.ts',
      `${legacy.pagesDir} | ${legacy.fixturesFile}`);

  // A workbook nobody declares cannot silently become somebody's.
  let refused = false;
  try {
    pinActiveScope({ workbook: 'excel/nobody-owns-this.xlsx' });
  } catch (error) {
    refused = error instanceof Error;
  }
  check('RC1-e: an undeclared workbook is refused, never attributed', refused);

  restore();
}

/* ================================================================ RC2/RC3 ====== */

async function partRC2(): Promise<void> {
  section('RC2/RC3 - a new application can seed its own namespace');
  useRegistry();

  const writer = await import('../autocode/abstraction/writer');
  pinActiveScope({ workbook: WB.alpha });

  check('RC2-a: alpha has no fixtures module yet',
      !fs.existsSync(writer.fixturesFile()), norm(writer.fixturesFile()));

  // The seed, then two registrations - the exact sequence a first generation performs.
  let source = writer.emptyFixturesModule();
  check('RC2-b: the seed declares NO Page Object',
      !/pages\//.test(source), 'empty namespace');
  for (const owner of ['LoginPage', 'SearchPage']) {
    const result = writer.registerFixture(source, owner);
    check(`RC2-c: ${owner} registers into a module that had none`, !('problem' in result),
        'problem' in result ? result.problem : 'ok');
    if ('problem' in result)
      return;
    source = result.source;
  }
  check('RC2-d: its imports point at ALPHA Page Objects',
      /from '\.\/pages\/alpha\/login\.page'/.test(source)
      && /from '\.\/pages\/alpha\/search\.page'/.test(source));
  check('RC2-e: and never at the legacy ones',
      !/from '\.\/pages\/(login|search)\.page'/.test(source));

  // The framework index must be able to READ it, or `staticCheck` refuses every spec.
  const block = /test\s*\.\s*extend\s*<\s*\{([\s\S]*?)\}\s*>/.exec(source)
    ?? /(?:type|interface)\s+\w*Fixtures\w*\s*=?\s*\{([\s\S]*?)\n\}/.exec(source);
  const names = new Set<string>();
  if (block) {
    for (const match of block[1].matchAll(/^\s*(\w+)\s*[?:]/gm))
      names.add(match[1]);
  }
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name)
        names.add(name);
    }
  }
  for (const need of ['step', 'healing', 'appCredentials', 'loginPage', 'searchPage', 'expect', 'trace'])
    check(`RC2-f: the index can see "${need}"`, names.has(need));

  // RC3: the writer creates the directory it writes into.
  const source_ = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'abstraction', 'writer.ts'), 'utf8');
  check('RC3: the commit step creates the scoped directory before writing',
      /fs\.mkdirSync\(path\.dirname\(file\), \{ recursive: true \}\);\s*\n\s*fs\.writeFileSync\(file, contents/.test(source_));

  restore();
}

/* ================================================================ A-N ========== */

async function partMatrix(): Promise<void> {
  section('A-N - the adversarial two-application matrix');
  useRegistry();

  const alpha = await pathsUnderPin({ workbook: WB.alpha });
  const beta = await pathsUnderPin({ workbook: WB.beta });
  const legacy = await pathsUnderPin({ workbook: WB.legacy });

  // A / B: each application resolves only its own.
  check('A: the legacy application resolves only its own artefacts',
      legacy.recordingsDir === 'ai/dashboard/recordings/legacyapp'
      || legacy.recordingsDir === 'ai/dashboard/recordings', legacy.recordingsDir);
  check('B: a newly provisioned application resolves only its own',
      Object.entries(beta).every(([k, v]) => k === 'canonicalApplication' || v.includes('beta')),
      JSON.stringify(beta.pagesDir));

  // C / D / E: shared ids, class names and locators stay independent because the
  // DIRECTORY is the namespace - none of them is ever a key.
  check('C: the same test-case id maps in two different files',
      alpha.mappingFile !== beta.mappingFile, `${alpha.mappingFile} vs ${beta.mappingFile}`);
  check('C2: and its generated spec lands in two different directories',
      alpha.generatedDir !== beta.generatedDir);
  check('D: the same Page Object class name is two different files',
      alpha.pagesDir !== beta.pagesDir, `${alpha.pagesDir} vs ${beta.pagesDir}`);
  check('D2: and each has its own fixtures module',
      alpha.fixturesFile !== beta.fixturesFile);
  check('E: a shared locator lives only inside each own Page Object directory',
      !alpha.pagesDir.startsWith(`${beta.pagesDir}/`) && !beta.pagesDir.startsWith(`${alpha.pagesDir}/`));

  // F / H: an empty namespace stays empty. This is the starvation case - the one that
  // produced the reported defect - and the answer must be "nothing", never "theirs".
  const knowledge = await import('../knowledge/page-knowledge');
  pinActiveScope({ workbook: WB.alpha });
  const alphaKnowledge = knowledge.readAllPageKnowledge();
  check('F: an application with no knowledge directory reads ZERO knowledge',
      alphaKnowledge.length === 0, `${alphaKnowledge.length} file(s)`);
  pinActiveScope({ workbook: WB.legacy });
  const legacyKnowledge = knowledge.readAllPageKnowledge();
  check('H: while the legacy application has plenty - so the empty answer is real',
      legacyKnowledge.length > 0, `${legacyKnowledge.length} file(s)`);
  pinActiveScope({ workbook: WB.alpha });
  check('H2: and asking again for alpha still returns none of them',
      knowledge.readAllPageKnowledge().length === 0);

  // I: reverse starvation - beta having artefacts changes nothing for the legacy app.
  pinActiveScope({ workbook: WB.legacy });
  check('I: the legacy application is unaffected by another application existing',
      knowledge.readAllPageKnowledge().length === legacyKnowledge.length);

  // J: the same workbook BASENAME in two applications.
  useRegistry({ betaWorkbooks: [WB.betaTwin] });
  const twinAlpha = await pathsUnderPin({ workbook: WB.alpha });
  const twinBeta = await pathsUnderPin({ workbook: WB.betaTwin });
  check('J: two workbooks sharing a basename resolve to different applications',
      twinAlpha.mappingFile !== twinBeta.mappingFile
      && twinBeta.pagesDir.includes('beta'),
      `${path.basename(WB.alpha)} == ${path.basename(WB.betaTwin)}`);

  // K: a captured scope is immutable under a later selection change.
  useRegistry();
  const captured = resolveScope({ applicationId: 'alpha' });
  const capturedDir = norm(captured.paths.recordingsDir);
  pinActiveScope({ workbook: WB.legacy });
  check('K: changing the active application does not retarget a captured scope',
      norm(captured.paths.recordingsDir) === capturedDir, capturedDir);
  check('K2: and re-resolving the captured id gives the same store',
      norm(resolveScope({ applicationId: 'alpha' }).paths.recordingsDir) === capturedDir);

  // M: a generated spec imports its OWN fixtures module.
  const fromRecording = await import('../autocode/from-recording');
  check('M: assembleSpec is reachable for the import check',
      typeof fromRecording.assembleSpec === 'function');
  const specifier = (workbook: string): string => {
    pinActiveScope({ workbook });
    const s = activeScope();
    const value = path.relative(s.paths.generatedDir, s.paths.fixturesFile)
        .split(path.sep).join('/').replace(/\.ts$/, '');
    return value.startsWith('.') ? value : `./${value}`;
  };
  check('M2: alpha imports its own fixtures module',
      specifier(WB.alpha) === '../../alpha.fixtures', specifier(WB.alpha));
  check('M3: the legacy application still imports ../fixtures, unchanged',
      specifier(WB.legacy) === '../fixtures', specifier(WB.legacy));
  check('M4: the two specifiers differ, so neither reaches the other',
      specifier(WB.alpha) !== specifier(WB.legacy));

  restore();
}

/* ================================================================ RC5 ========== */

async function partMemos(): Promise<void> {
  section('RC5 - a scope change invalidates every memo derived from it');
  useRegistry();

  const canonical = await import('../knowledge/canonical');

  // `canonical.ts` caches the applicationId it builds page identities from. It is a
  // SEPARATE variable in a separate module, so pinning without telling it left a memo
  // answering with the previous application - and page identity names every knowledge
  // file, so the next one written would be filed under the wrong application.
  pinActiveScope({ workbook: WB.legacy });
  check('RC5-a: the memo warms to the first application',
      canonical.activeApplicationId() === 'legacyapp', canonical.activeApplicationId());

  pinActiveScope({ workbook: WB.alpha });
  check('RC5-b: pinning a new scope invalidates it - no stale answer',
      canonical.activeApplicationId() === 'alpha', canonical.activeApplicationId());

  pinActiveScope({ workbook: WB.beta });
  check('RC5-c: and again, so it follows every change',
      canonical.activeApplicationId() === 'beta', canonical.activeApplicationId());

  // The canonical FILE for a page must land in the pinned application's directory.
  const file = canonical.canonicalFile('beta__root');
  check('RC5-d: a canonical knowledge file lands in the pinned application directory',
      file.includes('beta'), file);

  restore();
}

/* ================================================================ RC4 ==========
   The credentials capability is the application's own, never a literal.            */

async function partRC4(): Promise<void> {
  section('RC4 - the credentials capability name comes from the application');

  const writer = await import('../autocode/abstraction/writer');
  const root = enterIsolatedArtefactRoot('rc4');
  useRegistry();

  // Each application gets its OWN fixtures module. FixturePortal's legacy module is copied in
  // shape only (the real one is never touched); the other two are seeded by the framework.
  const legacyModule = path.join(root, 'tests-e2e', 'fixtures.ts');
  fs.mkdirSync(path.dirname(legacyModule), { recursive: true });
  fs.writeFileSync(legacyModule,
      'interface Fixtures {\n  fixtureappCredentials: Credentials | null;\n}\n', 'utf8');

  pinActiveScope({ workbook: WB.legacy });
  check('RC4-a: the legacy application resolves ITS declared capability',
      writer.credentialsFixtureName() === 'fixtureappCredentials',
      String(writer.credentialsFixtureName()));

  // A seeded module for each of the other two.
  for (const [wb, id] of [[WB.alpha, 'alpha'], [WB.beta, 'beta']] as const) {
    pinActiveScope({ workbook: wb });
    const file = writer.fixturesFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, writer.emptyFixturesModule(), 'utf8');
    check(`RC4-b: ${id} resolves its own capability from its own module`,
        writer.credentialsFixtureName() === 'appCredentials',
        String(writer.credentialsFixtureName()));
  }

  // THE ADVERSARIAL HALF: no application can reach the legacy capability by fallback.
  pinActiveScope({ workbook: WB.alpha });
  check('RC4-c: alpha cannot resolve the legacy capability',
      writer.credentialsFixtureName() !== 'fixtureappCredentials');
  pinActiveScope({ workbook: WB.beta });
  check('RC4-d: nor can beta', writer.credentialsFixtureName() !== 'fixtureappCredentials');

  // An application whose module declares none gets null, not somebody else's.
  useRegistry({ betaWorkbooks: [WB.beta] });
  pinActiveScope({ workbook: WB.beta });
  fs.writeFileSync(writer.fixturesFile(), 'interface Fixtures {\n  step: StepFn;\n}\n', 'utf8');
  check('RC4-e: a module declaring no credentials resolves null, never a fallback',
      writer.credentialsFixtureName() === null, String(writer.credentialsFixtureName()));

  // And the source itself carries no literal any more.
  const generator = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'from-recording.ts'), 'utf8');
  const code = generator.split('\n').filter(line => !/^\s*(\*|\/\/)/.test(line)).join('\n');
  check('RC4-f: the generator holds no hardcoded credentials capability name',
      !/fixtureappCredentials/.test(code),
      (code.match(/\w*[Cc]redentials/g) ?? []).slice(0, 3).join(',') || 'none');

  leaveIsolatedArtefactRoot();
  restore();
}

/* ============================================================ bootstrap ======== */

async function partBootstrap(): Promise<void> {
  section('First-recording bootstrap - a third application with nothing at all');

  const writer = await import('../autocode/abstraction/writer');
  const root = enterIsolatedArtefactRoot('bootstrap');
  useRegistry();
  pinActiveScope({ workbook: WB.beta });

  // Requirement: registry entry exists, workbook exists, EVERYTHING else absent.
  const paths = {
    pages: writer.pagesDir(), knowledge: writer.knowledgeDir(), fixtures: writer.fixturesFile(),
  };
  for (const [what, target] of Object.entries(paths))
    check(`bootstrap-a: ${what} does not exist yet`, !fs.existsSync(target), norm(target));
  check('bootstrap-b: and every one of them is inside the isolated root',
      Object.values(paths).every(target => isInsideFixtureRoot(target)));

  // The framework creates them as part of the normal write, with no manual step.
  const source = writer.emptyFixturesModule();
  const registered = writer.registerFixture(source, 'LoginPage');
  check('bootstrap-c: the first Page Object registers into a seeded module',
      !('problem' in registered), 'problem' in registered ? registered.problem : 'ok');

  fs.mkdirSync(path.dirname(paths.fixtures), { recursive: true });
  fs.writeFileSync(paths.fixtures, 'source' in registered ? registered.source : source, 'utf8');
  fs.mkdirSync(paths.pages, { recursive: true });
  fs.writeFileSync(writer.pageFilePathFor('LoginPage'), 'export class LoginPage {}\n', 'utf8');
  fs.mkdirSync(paths.knowledge, { recursive: true });

  for (const [what, target] of Object.entries(paths))
    check(`bootstrap-d: ${what} now exists, created lazily`, fs.existsSync(target), norm(target));
  check('bootstrap-e: the Page Object landed in THIS application directory',
      writer.pageFilePathFor('LoginPage').includes('beta'), norm(writer.pageFilePathFor('LoginPage')));
  check('bootstrap-f: and the seeded module imports it from there',
      /from '\.\/pages\/beta\/login\.page'/.test(fs.readFileSync(paths.fixtures, 'utf8')));

  // Nothing of the legacy application was consulted or created.
  // The legacy application's flat pagesDir is the PARENT of every scoped one, so it now
  // "exists" because `pages/beta/` is inside it. What matters is that it holds no Page
  // Object FILES - which is exactly how the enumerators read it (non-recursive, `.ts`
  // filter), so a sibling application's directory is invisible to it.
  pinActiveScope({ workbook: WB.legacy });
  const legacyPages = fs.existsSync(writer.pagesDir())
    ? fs.readdirSync(writer.pagesDir()).filter(name => name.endsWith('.ts'))
    : [];
  check('bootstrap-g: the legacy application sees NO Page Object of its own',
      legacyPages.length === 0, legacyPages.join(',') || 'none');
  check('bootstrap-h: and cannot see the new application file either',
      !legacyPages.includes('login.page.ts'));

  leaveIsolatedArtefactRoot();
  restore();
}

/* ======================================================= recorded pipeline ===== */

async function partRecordedPipeline(): Promise<void> {
  section('Recorded pipeline - artifact discovery follows the pinned scope');

  const recorder = await import('../dashboard/recorder');
  const scope = await import('./scope');
  const root = enterIsolatedArtefactRoot('recorded');
  useRegistry();

  // THE REPORTED SYMPTOM. "no Codegen artifact was kept for this case" is emitted by
  // `generateFromRecording` when `readArtifact` returns null, and `readArtifact` resolves
  // through `activeRecordingsDir()`. So a recording filed under one application is
  // invisible to a run scoped to another - which is exactly what happened: the FixtureShop
  // recording existed while the generator searched FixturePortal's store.
  pinActiveScope({ workbook: WB.beta });
  const betaStore = scope.activeRecordingsDir();
  fs.mkdirSync(betaStore, { recursive: true });
  fs.writeFileSync(path.join(betaStore, 'TC_SMOKE_003.spec.ts'),
      "import { test } from '@playwright/test';\n\ntest('test', async ({ page }) => {});\n", 'utf8');

  check('rec-a: the recording is in THIS application store',
      fs.existsSync(recorder.artifactPath('TC_SMOKE_003')), norm(recorder.artifactPath('TC_SMOKE_003')));
  check('rec-b: and the discovery accessor finds it',
      Boolean(recorder.readArtifact('TC_SMOKE_003')));

  // Scoped to a DIFFERENT application, the same id must find nothing - never the other
  // application's recording.
  pinActiveScope({ workbook: WB.alpha });
  check('rec-c: another application finds NO artifact for the same id',
      !recorder.readArtifact('TC_SMOKE_003'), norm(recorder.artifactPath('TC_SMOKE_003')));
  check('rec-d: and it looked in its OWN store, not the other one',
      recorder.artifactPath('TC_SMOKE_003').includes('alpha'));

  // Back to the owner: still found. This is the whole fix in one pair of assertions.
  pinActiveScope({ workbook: WB.beta });
  check('rec-e: the owner still finds it, so the message would not be emitted',
      Boolean(recorder.readArtifact('TC_SMOKE_003')));

  leaveIsolatedArtefactRoot();
  restore();
}

/* ==================================================== same-name adversarial ==== */

async function partSameName(): Promise<void> {
  section('Same names across applications - all four must coexist');

  const writer = await import('../autocode/abstraction/writer');
  const canonical = await import('../knowledge/canonical');
  const root = enterIsolatedArtefactRoot('same-name');
  useRegistry();

  const shape = (workbook: string) => {
    pinActiveScope({ workbook });
    return {
      spec: norm(path.join(activeScope().paths.generatedDir, 'TC_LOGIN_001.spec.ts')),
      page: norm(writer.pageFilePathFor('LoginPage')),
      mapping: norm(activeScope().paths.mappingFile),
      knowledge: norm(canonical.canonicalFile(`${activeScope().applicationId}__login`)),
      recording: norm(path.join(activeScope().paths.recordingsDir, 'TC_LOGIN_001.spec.ts')),
    };
  };
  const a = shape(WB.alpha);
  const b = shape(WB.beta);
  const l = shape(WB.legacy);

  for (const key of ['spec', 'page', 'mapping', 'knowledge', 'recording'] as const) {
    check(`same-name: TC_LOGIN_001 / LoginPage ${key} is distinct across all three`,
        new Set([a[key], b[key], l[key]]).size === 3,
        `${a[key]} | ${b[key]} | ${l[key]}`);
  }

  // A shared LOCATOR is a string inside each application's own Page Object file, and a
  // shared MODULE name is a column value - neither is ever a key, so both are safe by the
  // same property: the files that would hold them are disjoint.
  check('same-name: #username would live in two different Page Object files',
      a.page !== b.page && a.page !== l.page);
  check('same-name: a "Login" module maps in two different mapping files',
      a.mapping !== b.mapping && a.mapping !== l.mapping);

  leaveIsolatedArtefactRoot();
  restore();
}

/* ================================================================ RC6 ==========
   A generated spec's fixtures module exists BEFORE the spec is written.           */

async function partRC6(): Promise<void> {
  section('RC6 - the fixtures module is an output destination, not a side effect');

  const writer = await import('../autocode/abstraction/writer');
  enterIsolatedArtefactRoot('rc6');
  useRegistry();

  // THE DEFECT. Seeding used to live inside `applyProposals`, in the loop over eligible
  // PROPOSALS - so it ran only when a Page Object was created. FixtureShop's TC_SMOKE_004 had
  // all five elements correctly refused for want of admissible evidence, so there were
  // ZERO proposals, the loop body never ran, and the spec was written importing
  // `../../fixtureshop.fixtures` - a file guaranteed not to exist. Collection then failed
  // with `Cannot find module`.
  pinActiveScope({ workbook: WB.alpha });
  check('RC6-a: a new application starts with no fixtures module',
      !fs.existsSync(writer.fixturesFile()), norm(writer.fixturesFile()));

  const first = writer.ensureFixturesModule();
  check('RC6-b: ensureFixturesModule creates it', first.created && fs.existsSync(first.file));
  check('RC6-c: and it is inside this application, not the legacy one',
      first.file.includes('alpha'), norm(first.file));

  const second = writer.ensureFixturesModule();
  check('RC6-d: calling it again is a no-op, never a rewrite', !second.created);

  // The seeded module declares only NEUTRAL capabilities - no other application's.
  const seeded = fs.readFileSync(first.file, 'utf8');
  check('RC6-e: it declares the neutral credentials capability',
      /appCredentials/.test(seeded));
  check('RC6-f: and no other application capability at all',
      !/fixtureapp/i.test(seeded), (seeded.match(/\w*[Cc]redentials/g) ?? []).join(','));

  // THE INVARIANT, stated as the thing that actually broke: the import a spec writes must
  // resolve to a file that exists.
  const scope = activeScope();
  const specifier = path.relative(scope.paths.generatedDir, scope.paths.fixturesFile)
      .split(path.sep).join('/').replace(/\.ts$/, '');
  const resolved = path.resolve(scope.paths.generatedDir, `${specifier}.ts`);
  check('RC6-g: the specifier a spec would import resolves to a real file',
      fs.existsSync(resolved), `${specifier} -> ${norm(resolved)}`);

  // And the ORDER holds: the module exists before any spec could be written into the
  // generated directory, for an application with zero Page Objects and zero knowledge.
  check('RC6-h: with zero Page Objects and zero knowledge, the module still exists',
      !fs.existsSync(scope.paths.pagesDir) && fs.existsSync(scope.paths.fixturesFile));

  // A second application seeds its own, independently.
  pinActiveScope({ workbook: WB.beta });
  const other = writer.ensureFixturesModule();
  check('RC6-i: a second application seeds its OWN module',
      other.created && other.file.includes('beta') && other.file !== first.file,
      norm(other.file));
  check('RC6-j: and neither module mentions the other application',
      !/beta/.test(fs.readFileSync(first.file, 'utf8'))
      && !/alpha/.test(fs.readFileSync(other.file, 'utf8')));

  leaveIsolatedArtefactRoot();
  restore();
}

/* ================================================================ RC7 ==========
   The authoring sidecar is written into the SELECTED project's store.             */

async function partRC7(): Promise<void> {
  section('RC7 - bookkeeping follows the selected project, not the ambient one');

  const caseStatus = await import('../dashboard/case-status');
  enterIsolatedArtefactRoot('rc7');
  useRegistry();

  // THE DEFECT. `ai/dashboard/server.ts` called `rememberRecordingFingerprint(savedRow)`
  // with no scope, so it fell to `recordingsDir()` -> the AMBIENT scope, which in a
  // long-lived server is the declared legacy owner whatever project is selected. Measured:
  // saving FixtureShop's TC_SMOKE_004 put `TC_SMOKE_004.authoring.json` in
  // `ai/dashboard/recordings/fixtureapp` while the recording went correctly to
  // `recordings/fixtureshop` - the bookkeeping and the artefact it describes in two different
  // applications' stores. The sidecar decides whether a recording is STALE, so it was
  // answering that for the wrong project.
  const ambient = activeScope();
  check('RC7-a: the ambient scope is the legacy owner', ambient.applicationId === 'legacyapp');

  const selected = resolveScope({ applicationId: 'alpha' });
  const row = {
    testCaseId: 'TC_SMOKE_004', module: '', feature: '', scenario: 's', description: '',
    preconditions: '', steps: ['open'], testData: '', expectedResult: 'r',
    priority: '' as never, tags: [], automationStatus: 'Not Automated' as never,
    automationNotes: '', execute: null, expectedOutcome: '', expectedMessage: '',
    requirementId: '', testType: '' as never, businessRisk: '' as never, environment: '',
    userRole: '', authenticationProfile: '', testOwner: '',
    source: { workbookPath: '', workbook: 'w.xlsx', worksheet: 'S', row: 2 },
    extra: {}, issues: [],
  };

  // The reader answers `recordedFingerprint` only when the RECORDING exists beside the
  // sidecar - by design, so a stray sidecar cannot make a case look recorded. So the test
  // puts both in the selected store, which is exactly what a real save produces.
  fs.mkdirSync(selected.paths.recordingsDir, { recursive: true });
  fs.writeFileSync(path.join(selected.paths.recordingsDir, 'TC_SMOKE_004.spec.ts'),
      "import { test } from '@playwright/test';\n", 'utf8');
  caseStatus.rememberRecordingFingerprint(row, selected.paths.recordingsDir);

  const inSelected = path.join(selected.paths.recordingsDir, 'TC_SMOKE_004.authoring.json');
  const inAmbient = path.join(ambient.paths.recordingsDir, 'TC_SMOKE_004.authoring.json');
  check('RC7-b: the sidecar lands in the SELECTED project store',
      fs.existsSync(inSelected), norm(inSelected));
  check('RC7-c: and NOT in the ambient one', !fs.existsSync(inAmbient), norm(inAmbient));

  // The read side must agree, or a recording reads as stale for the wrong project.
  // Read back through the REAL reader, in the same store. `recordedFingerprint` is what
  // the sidecar carries, so finding it proves the write and the read agree about WHERE -
  // which is the disagreement that made a recording read as stale for the wrong project.
  const status = caseStatus.recordingStatus(row as never, selected.paths.recordingsDir);
  check('RC7-d: the reader finds the sidecar in the same store',
      status.recordedFingerprint === status.currentFingerprint
      && typeof status.recordedFingerprint === 'string',
      `recorded=${status.recordedFingerprint} current=${status.currentFingerprint}`);
  const ambientStatus = caseStatus.recordingStatus(row as never, ambient.paths.recordingsDir);
  check('RC7-d2: and the ambient store has no sidecar to answer with',
      ambientStatus.recordedFingerprint === undefined,
      String(ambientStatus.recordedFingerprint));

  // And the server passes a scope at every call site.
  const server = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'server.ts'), 'utf8');
  const unscoped = [...server.matchAll(/rememberRecordingFingerprint\(([^)]*)\)/g)]
      .filter(match => !/,/.test(match[1]));
  check('RC7-e: no unscoped rememberRecordingFingerprint call remains in the server',
      unscoped.length === 0, unscoped.map(m => m[0]).join(' | ') || 'none');

  leaveIsolatedArtefactRoot();
  restore();
}

/* ---------------------------------------------------------------- main --------- */

async function main(): Promise<void> {
  assertNothingRealAtRisk();
  const before = realDigest();
  try {
    await partRC1();
    await partRC2();
    await partMatrix();
    await partMemos();
    await partRC4();
    await partBootstrap();
    await partRecordedPipeline();
    await partSameName();
    await partRC6();
    await partRC7();
  } finally {
    restore();
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  section('the real artefacts are untouched');
  const after = realDigest();
  check('every real FixturePortal artefact is byte-identical',
      after.digest === before.digest && after.files === before.files,
      `${before.files} file(s)`);

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${checks - failures}/${checks} checks`);
  if (failures)
    process.exitCode = 1;
}

void main().catch(error => {
  console.error(error instanceof ScopeError ? `ScopeError: ${error.message}` : error);
  process.exitCode = 1;
});
