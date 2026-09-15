/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract = 'ai/autocode/page-object-template.fixture.ts';
/**
 * Every mutant here is one the EXISTING guards let through, deliberately.
 *
 * `validateAuthoringChanges` already typechecks emitted source before committing it, so a
 * template with an unresolvable import is refused at creation with an exception - a real
 * safety net, but it throws rather than reddening a contract, and a mutant that only proves
 * the compiler still works proves nothing about these contracts. Each fault below therefore
 * COMPILES and COMMITS, and is caught only by the contract it is aimed at.
 */
const mutants = [
  // The constructor made implicit again. It still RUNS - which is the whole reason this
  // needed a contract rather than a bug report - so only a structural check can catch it.
  {
    name: 'the explicit BasePage constructor is dropped from the skeleton',
    file: 'ai/autocode/abstraction/writer.ts',
    from: "    `export class ${className} extends BasePage {`,\n"
      + "    '  constructor(page: Page, healing?: HealingRecorder) {',\n"
      + "    '    super(page, healing);',\n"
      + "    '  }',",
    to: "    `export class ${className} extends BasePage {`,",
    marker: 'a manually created Page Object declares an explicit BasePage constructor',
  },
  // A second emitter grows back: well-formed, constructor-carrying, resolvable imports, and
  // differing from the canonical skeleton only in shape. This is the defect's exact shape,
  // and it is invisible to everything except a direct comparison of the two.
  {
    name: 'the dashboard keeps a second Page Object template of its own',
    file: 'ai/dashboard/authoring-catalog.ts',
    from: "  const source = pageObjectSkeleton(className, file,\n"
      + "    ['/** User-authored Page Object. No deterministic capabilities claimed. */']);",
    to: "  const source = `/** User-authored Page Object. No deterministic capabilities claimed. */\\n\\n"
      + "import type { Locator, Page } from '@playwright/test';\\n\\n"
      + "import type { HealingRecorder } from '../../support/resilient-locator';\\n"
      + "import { BasePage } from '../base.page';\\n\\nexport class ${className} extends BasePage {\\n"
      + "  constructor(page: Page, healing?: HealingRecorder) { super(page, healing); }\\n}\\n`;",
    marker: 'manual and generated Page Objects share one class skeleton',
  },
  // The import path hard-coded to what one directory depth happens to need. Correct for the
  // class the author was looking at, silently wrong for a class written one level deeper.
  {
    name: 'the BasePage import is hard-coded instead of computed',
    file: 'ai/autocode/abstraction/writer.ts',
    from: "    base: to(path.join(layoutRoot, 'pages', 'base.page')),",
    to: "    base: '../base.page',",
    marker: 'a deeper layout is not a second special case',
  },
];
const selected = process.argv.find(a => a.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), __filename, `--mutant=${i}`],
      { stdio: 'inherit', windowsHide: true, timeout: 240000 });
    assert.equal(r.status, 0, `Mutation ${i}: ${r.error ?? ''}`);
  }
  console.log(`PASS ${mutants.length} Page Object template mutants killed`);
} else {
  require('./isolated-checkout'); assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m = mutants[Number(selected?.split('=')[1])]; assert.ok(m);
  const before = fs.readFileSync(m.file, 'utf8'); assert.ok(before.includes(m.from), 'Mutation anchor: ' + m.name);
  try {
    fs.writeFileSync(m.file, before.replace(m.from, m.to));
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), contract],
      { encoding: 'utf8', timeout: 180000, windowsHide: true });
    assert.ok(!r.error, `${m.name}: ${r.error}`);
    assert.notEqual(r.status, 0, 'SURVIVED ' + m.name);
    assert.ok((r.stdout + r.stderr).includes(m.marker),
      'Wrong failure for ' + m.name + ': ' + (r.stdout + r.stderr).slice(-900));
    console.log('KILLED ' + m.name);
  } finally { fs.writeFileSync(m.file, before); }
}
