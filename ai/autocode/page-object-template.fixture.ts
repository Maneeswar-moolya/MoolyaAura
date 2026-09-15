import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { workspaceData } from '../testing/workspace-data';
import { renderPageObjectClass, pageObjectSkeleton } from './abstraction/writer';
import { createLogicalPage, createPageObject } from '../dashboard/authoring-catalog';
import { resolveScope } from '../projects/scope';

/**
 * ONE PAGE OBJECT SKELETON, WHEREVER THE CLASS IS CREATED FROM.
 *
 * Two emitters used to write Page Object source. The abstraction engine wrote the full class -
 * explicit constructor, Page and HealingRecorder imports, base path computed from the layout.
 * The dashboard's manual creation wrote `export class X extends BasePage {}` against a
 * hard-coded `tests-e2e/pages/base.page`. Both RUN: an implicit derived constructor forwards
 * its arguments, so this was never a runtime defect and nothing here claims it was. What it
 * was is two templates drifting, one of them correct for exactly one directory depth.
 *
 * These contracts pin the template, not the wording: each caller keeps its own provenance
 * comment, and old classes are left alone.
 */
const { scope } = workspaceData();
let checks = 0;
const check = (name: string, run: () => void | Promise<void>) => Promise.resolve()
  .then(run).then(() => { checks++; console.log('PASS ' + name); },
    (e: any) => { throw new Error(`FAIL ${name}: ${e?.message ?? e}`); });

const importsOf = (source: string) =>
  [...source.matchAll(/import[^']*'(\.[^']*)'/g)].map(match => match[1]);
const resolved = (file: string, specifier: string) => path.resolve(path.dirname(file), specifier);
/** The skeleton is everything after the caller's own doc block: `...doc, '', <skeleton>`. */
const skeletonOf = (source: string) => source.slice(source.indexOf('\n\n') + 2);

async function main(): Promise<void> {
  const layoutRoot = path.dirname(scope.paths.fixturesFile);

  // ---- 1. The manual creation path emits the canonical class.
  createLogicalPage(scope, { name: 'Customer overview', route: '/home', description: 'Overview' });
  createPageObject(scope, 'Customer overview', 'CustomerControls');
  const manualFile = path.join(scope.paths.pagesDir, 'CustomerControls.ts');
  const manual = fs.readFileSync(manualFile, 'utf8');

  await check('a manually created Page Object declares an explicit BasePage constructor', () => {
    assert.match(manual, /export class CustomerControls extends BasePage \{/, 'the class is written');
    assert.match(manual, /constructor\(page: Page, healing\?: HealingRecorder\) \{/,
      'the constructor is explicit, not implicit:\n' + manual);
  });
  await check('the constructor forwards both the page and the healing recorder', () =>
    assert.match(manual, /super\(page, healing\);/, 'nothing is dropped on the way to BasePage'));
  await check('the class names the types its own signature uses', () => {
    assert.match(manual, /import type \{ Locator, Page \} from '@playwright\/test';/);
    assert.match(manual, /import type \{ HealingRecorder \} from '/, 'HealingRecorder is imported, not assumed');
    assert.equal(manual.match(/import \{ BasePage \}/g)?.length, 1, 'BasePage is imported exactly once');
  });

  // ---- 2. ONE template. The two emitters agree on everything but their provenance comment.
  const generated = renderPageObjectClass('CustomerControls', '/home', manualFile);
  await check('manual and generated Page Objects share one class skeleton', () =>
    assert.equal(skeletonOf(manual), skeletonOf(generated),
      'the skeletons diverged:\n--- manual ---\n' + skeletonOf(manual) + '\n--- generated ---\n' + skeletonOf(generated)));
  await check('provenance stays with the caller - the shared skeleton does not rewrite it', () => {
    assert.match(manual, /User-authored Page Object\. No deterministic capabilities claimed\./);
    assert.match(generated, /created by the abstraction engine from measured recordings/);
    assert.doesNotMatch(manual, /abstraction engine/, 'a hand-written class must not claim a measurement');
  });

  // ---- 3. Imports are COMPUTED from where the class lands, never hard-coded.
  await check('imports are computed from the file location, not hard-coded', () => {
    const specifiers = importsOf(manual);
    assert.ok(specifiers.some(s => resolved(manualFile, s) === path.join(layoutRoot, 'pages', 'base.page')),
      'BasePage resolves to the framework class: ' + specifiers.join(', '));
    assert.ok(specifiers.some(s => resolved(manualFile, s) === path.join(layoutRoot, 'support', 'resilient-locator')),
      'HealingRecorder resolves to the framework support module: ' + specifiers.join(', '));
  });
  await check('every computed import points at a file that exists', () => {
    for (const specifier of importsOf(manual))
      assert.ok(fs.existsSync(resolved(manualFile, specifier) + '.ts'),
        `${specifier} resolves to nothing from ${path.relative(layoutRoot, manualFile)}`);
  });
  await check('a deeper layout is not a second special case', () => {
    const deep = path.join(scope.paths.pagesDir, 'area', 'nested', 'DeepPage.ts');
    const specifiers = importsOf(pageObjectSkeleton('DeepPage', deep, ['/** deep */']));
    assert.ok(specifiers.every(s => s.startsWith('../')), 'a nested class climbs out: ' + specifiers.join(', '));
    assert.ok(specifiers.some(s => resolved(deep, s) === path.join(layoutRoot, 'pages', 'base.page')),
      'and still lands on the one BasePage: ' + specifiers.join(', '));
  });

  // ---- 4. The emitted source is real TypeScript.
  await check('the emitted source parses with no diagnostics', () => {
    const parsed = ts.createSourceFile(manualFile, manual, ts.ScriptTarget.Latest, true);
    assert.deepEqual((parsed as any).parseDiagnostics.map((d: any) => d.messageText), [],
      'the generated class must compile before it is committed');
  });

  // ---- 5. Behaviour is UNCHANGED. The implicit constructor bound these too; the point of
  // the explicit one is that the class says so. This proves the change cost nothing.
  await check('a manually created Page Object constructs with page and healing bound', async () => {
    // A stub Page that answers whatever BasePage's constructor reaches for. It proves BINDING
    // and nothing else - no locator resolves here and no assertion is made through it.
    const stub = { marker: 'page' } as Record<string, unknown>;
    const page = new Proxy(stub, {
      get: (target, key) => key in target ? target[key as string] : () => undefined,
    }) as any;
    const healing = { marker: 'healing' } as any;
    const module = await import(pathToFileURL(manualFile).href + '?d');
    const instance = new module.CustomerControls(page, healing) as any;
    assert.equal(instance.page, page, 'the page reaches BasePage');
    assert.equal(instance.healing, healing, 'the healing recorder reaches BasePage');
    const bare = new module.CustomerControls(page) as any;
    assert.equal(bare.healing, undefined, 'healing stays optional');
  });

  // ---- 6. Creating a new class touches nothing else.
  await check('existing Page Objects are not rewritten when a new one is created', () => {
    const existing = path.join(scope.paths.pagesDir, 'FirstPage.ts');
    const before = fs.readFileSync(existing, 'utf8');
    createLogicalPage(scope, { name: 'Second screen', route: '/spare', description: '' });
    createPageObject(scope, 'Second screen', 'SecondControls');
    assert.equal(fs.readFileSync(existing, 'utf8'), before, 'an old valid class is never reformatted');
  });
  await check('another application never receives the class', () => {
    const other = resolveScope({ applicationId: 'south', environmentId: 'qa' });
    assert.equal(fs.existsSync(path.join(other.paths.pagesDir, 'CustomerControls.ts')), false);
    assert.equal(fs.existsSync(path.join(other.paths.pagesDir, 'SecondControls.ts')), false);
  });

  console.log(`${checks} Page Object template contracts passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
