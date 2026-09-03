/**
 * The locator-quality engine, pinned offline.
 *
 *   npx tsx ai/autocode/locator-quality.fixture.ts
 *
 * No browser, no model, no network. Every case is a locator string in, a verdict
 * out. The two that matter most are T and U: TC_LOGIN_036's assertion must be called
 * suspicious without its expected value being touched, and TC_LOGIN_037's
 * `#tc_summary_636432` must be recognised as one issue's id rather than a selector.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  analyseIdentifier, assessLocator, assessNewPageObject, methodNameFor, parseChain,
} from './locator-quality';
import { generateFromRecording, mapRecording, locatorMetrics } from './from-recording';
import { artifactPath, parseRecording } from '../dashboard/recorder';
import { recordedSpecPathFor } from './orchestrate';
import type { TestCase } from '../excel/types';

const ROOT = process.cwd();
let failures = 0;
const written: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/** The mapper carries no browser and no model, by construction - assert it. */
function generatedWithoutBrowser(mapping: { steps: Array<{ code: string[] }> }): boolean {
  const source = JSON.stringify(mapping.steps);
  return !/browse\.mjs|AUTOCODE_|claude|chromium\.launch/.test(source);
}

const assess = (locator: string, kind: 'action' | 'assertion' = 'action', value: string | null = null) =>
  assessLocator({ locator, target: 'thing', kind, value });

function syntheticCase(id: string): TestCase {
  return {
    testCaseId: id, module: '', feature: '', scenario: 'fixture', description: '',
    preconditions: '', steps: ['Open the page'], testData: '', expectedResult: 'Something is visible',
    priority: '' as TestCase['priority'], tags: ['recorded'], automationStatus: 'Not Automated',
    automationNotes: '', execute: null, expectedOutcome: '', expectedMessage: '',
    source: { workbook: 'login-test-cases.xlsx', worksheet: 'Login Test Cases', row: 999 },
    extra: {}, issues: [],
  };
}

async function main(): Promise<void> {
  process.stdout.write('\n== A — existing Page Object reuse wins outright ==\n');
  const reuse = assessLocator({
    locator: "page.getByRole('button', { name: 'Sign In', exact: true })", target: 'Sign In',
    kind: 'action', pageObject: { pageObject: 'LoginPage', method: 'signInButton' },
  });
  check('outcome REUSE_PAGE_OBJECT', reuse.outcome === 'REUSE_PAGE_OBJECT', reuse.outcome);
  check('classification reusable', reuse.classification === 'reusable');
  check('confidence 1', reuse.confidence === 1);
  check('nothing is emitted for it', reuse.expression === null);

  process.stdout.write('\n== B/C — role, with and without an accessible name ==\n');
  const roleNamed = assess("page.getByRole('button', { name: 'Sign In' })");
  check('B: role+name is stable', roleNamed.classification === 'stable', roleNamed.classification);
  check('B: strategy role-name', roleNamed.strategy === 'role-name', roleNamed.strategy);
  check('B: STABLE_LOCATOR', roleNamed.outcome === 'STABLE_LOCATOR', roleNamed.outcome);

  const roleBare = assess("page.getByRole('heading')", 'assertion', 'All Issues');
  check('C: generic role is suspicious in an assertion', roleBare.classification === 'suspicious', roleBare.classification);
  check('C: it is NOT blocked - the gate decides', roleBare.outcome !== 'NEEDS_REVIEW', roleBare.outcome);
  check('C: reason names the missing accessible name',
      roleBare.reason.includes('no accessible name'), roleBare.reason.slice(0, 90));

  process.stdout.write('\n== D/E/F/G — the semantic strategies ==\n');
  check('D: getByLabel', assess("page.getByLabel('Email')").strategy === 'label');
  check('E: getByPlaceholder', assess("page.getByPlaceholder('Enter email')").strategy === 'placeholder');
  check('F: getByTestId', assess("page.getByTestId('summary')").strategy === 'test-id');
  const text = assess("page.getByText('Faclon labs')");
  check('G: an unscoped getByText is no longer classified stable',
      text.classification === 'suspicious' && text.outcome === 'NEEDS_REVIEW',
      `${text.classification}/${text.outcome}`)
  check('G: ranked below role+name',
      (text.candidates[0]?.score ?? 0) < (roleNamed.candidates[0]?.score ?? 0));

  process.stdout.write('\n== H/I — CSS, unscoped and scoped ==\n');
  const stableCss = assess("page.locator('#project_banner')");
  check('H: a stable id is not dynamic', !stableCss.dynamic?.dynamic);
  check('H: strategy stable-id', stableCss.strategy === 'stable-id', stableCss.strategy);
  const scoped = assess("page.locator('#response_modal_dialog').getByRole('button', { name: 'close' })");
  check('I: scope from the recording is kept', scoped.expression?.includes('#response_modal_dialog') === true);
  check('I: scoped candidates are marked', scoped.candidates.some(c => c.scoped));
  check('I: two candidates, one per segment', scoped.candidates.length === 2, String(scoped.candidates.length));

  process.stdout.write('\n== J/K/L — XPath ==\n');
  const relational = assess("page.locator(\"//section[@data-testid='project']//button[@aria-label='Close']\")");
  check('J: relational XPath is allowed', relational.outcome !== 'NEEDS_REVIEW', relational.outcome);
  check('J: it ranks below semantic strategies',
      (relational.candidates[0]?.score ?? 0) < (roleNamed.candidates[0]?.score ?? 0));
  const absolute = assess("page.locator('/html/body/div[2]/div[3]/button[2]')");
  check('K: absolute XPath is invalid', absolute.classification === 'invalid', absolute.classification);
  check('K: and is blocked', absolute.outcome === 'NEEDS_REVIEW', absolute.outcome);
  const positional = assess("page.locator('//div[4]/div[2]/button[3]')");
  check('L: positional XPath is penalised',
      positional.candidates[0].penalties.some(p => /positional/.test(p.reason)),
      JSON.stringify(positional.candidates[0].penalties));

  process.stdout.write('\n== M/N/O — dynamic identifier detection ==\n');
  const dynamicId = analyseIdentifier('tc_summary_636432');
  check('M: numeric-suffix id is dynamic', dynamicId.dynamic, dynamicId.signals.join(', '));
  check('M: normalised for analysis only', dynamicId.normalised === 'tc_summary_<dynamic>', dynamicId.normalised);
  const uuid = analyseIdentifier('item-3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  check('N: UUID is dynamic', uuid.dynamic, uuid.signals.join(', '));
  const stableNumeric = analyseIdentifier('loginForm2');
  check('O: #loginForm2 is NOT dynamic', !stableNumeric.dynamic, stableNumeric.signals.join(', ') || 'no signals');
  check('O: nor is #step-3', !analyseIdentifier('step-3').dynamic);
  check('O: nor is #h1', !analyseIdentifier('h1').dynamic);
  check('O: nor is #gsigninform_btn', !analyseIdentifier('gsigninform_btn').dynamic);
  check('O: nor is #main-content', !analyseIdentifier('main-content').dynamic);
  const hashed = analyseIdentifier('panel_a1b2c3d4');
  check('N2: hex-hash tail is dynamic', hashed.dynamic, hashed.signals.join(', '));

  process.stdout.write('\n== P/Q — ambiguity and containers ==\n');
  // A BARE TEXT LOCATOR WITH first() NEVER REACHES THE SCORER ANY MORE, and that is
  // the stronger answer. The strict-mode gate refuses an unmeasured unscoped
  // getByText outright, so there are no candidates to inspect penalties on - this
  // check used to read `candidates[0]` and started throwing the day that gate landed.
  // The invariant it protected is asserted twice below: refused here, and penalised on
  // a locator that does reach the scorer.
  const first = assess("page.getByText('Faclon labs').first()");
  check('P: first() is read as Codegen finding several', first.ambiguous);
  check('P: an unmeasured bare text locator with first() is refused, not scored',
      first.outcome === 'NEEDS_REVIEW' && first.expression === null,
      `${first.outcome} ${first.expression}`);
  check('P: and first() is never used to force uniqueness',
      !/first\(/.test(String(first.expression ?? '')));
  // A SCOPED chain does reach the scorer, and there first() must still be penalised.
  const scopedFirst = assess("page.locator('#all_apps').getByText('Faclon labs').first()");
  check('P: where the scorer does run, first() costs the locator',
      scopedFirst.candidates.length > 0
      && scopedFirst.candidates.every(candidate =>
        candidate.penalties.some(penalty => /first\(\)\/nth\(\)/.test(penalty.reason))),
      scopedFirst.candidates.map(c => c.strategy).join(', '));
  check('P: classified suspicious', first.classification === 'suspicious', first.classification);
  const container = assess("page.locator('#main-content')", 'assertion', 'Faclon labs');
  check('Q: a layout container is weak', container.classification === 'weak', container.classification);
  check('Q: but not blocked', container.outcome !== 'NEEDS_REVIEW', container.outcome);

  process.stdout.write('\n== R/S — new Page Object creation is gated ==\n');
  const safeInput = assessNewPageObject({
    assessment: roleNamed, target: 'Sign In', owningPageObject: 'LoginPage', existingMethods: [],
  });
  check('S: even a perfect locator is refused while uniqueness is unprovable',
      !safeInput.safe && safeInput.unproven.includes('selector uniqueness cannot be proven offline'),
      safeInput.unproven.join(' | '));
  const unsafe = assessNewPageObject({ assessment: container, target: '', owningPageObject: null });
  check('S: an unknown class and an unnamed element are both reported',
      unsafe.unproven.some(u => /class that owns/.test(u))
      && unsafe.unproven.some(u => /identity is unclear/.test(u)), unsafe.unproven.join(' | '));
  check('R: method names are deterministic',
      methodNameFor('Create New Team') === 'createNewTeam', String(methodNameFor('Create New Team')));
  check('R: and refuse to invent one from nothing', methodNameFor('  ') === null);

  process.stdout.write('\n== T — TC_LOGIN_036, the strong/heading assertion ==\n');
  const t036 = assessLocator({
    locator: "page.getByRole('strong')", target: 'strong', kind: 'assertion',
    value: 'Welcome to Bugasura',
  });
  check('T: classified suspicious', t036.classification === 'suspicious', t036.classification);
  check('T: the expected value is NOT rewritten', t036.reason.includes('Welcome to Bugasura'));
  check('T: the reason explains the nesting trap',
      t036.reason.includes('inner element'), t036.reason.slice(0, 120));
  check('T: still emitted - the gate is what proves it', t036.expression === "page.getByRole('strong')");

  process.stdout.write('\n== U — TC_LOGIN_037, the dynamic id ==\n');
  const t037 = assessLocator({
    locator: "page.locator('#tc_summary_636432')", target: '#tc_summary_636432', kind: 'assertion',
    value: 'Config Line Chart: Unable to select periodicities',
  });
  check('U: recognised as dynamic', t037.dynamic?.dynamic === true, t037.dynamic?.signals.join(', '));
  check('U: classified invalid', t037.classification === 'invalid', t037.classification);
  check('U: NEEDS_REVIEW', t037.outcome === 'NEEDS_REVIEW', t037.outcome);
  check('U: nothing is emitted', t037.expression === null);
  check('U: NOT turned into a prefix match',
      !/\[id\^=|\*|first\(\)/.test(JSON.stringify(t037)), 'no [id^=] / wildcard / first()');
  check('U: the reason names the rule that fired', t037.reason.includes('separator-digits'));

  process.stdout.write('\n== U2 — the real TC_LOGIN_037 recording, end to end ==\n');
  const artifact = path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_037.spec.ts');
  if (fs.existsSync(artifact)) {
    const recording = parseRecording(fs.readFileSync(artifact, 'utf8'), { startUrl: '', browser: '', durationMs: 0 });
    const mapped = mapRecording(recording);
    // TWO REFUSALS NOW, and the second one is not a regression: this recording carries
    // no DOM evidence, and `page.getByText('Faclon labs')` is an unmeasured unscoped
    // text locator - the exact shape the strict-mode gate exists to refuse, and one
    // that was live-measured at two elements on /apps. Both are named rather than
    // counted, so a THIRD refusal appearing would still fail this check.
    check('U2: the recording produces exactly the two refusals it should',
        mapped.needsReview.length === 2, mapped.needsReview.map(s => s.from).join(', '));
    check('U2: one is the tc_summary assertion - the generated id',
        mapped.needsReview.some(step => step.from.includes('tc_summary_636432')),
        mapped.needsReview.map(s => s.from).join(', '));
    check('U2: the other is the unmeasured bare-text click',
        mapped.needsReview.some(step => step.from === 'click Faclon labs'),
        mapped.needsReview.map(s => s.from).join(', '));
    const counts = locatorMetrics(mapped);
    check('U2: metrics count one dynamic id and both reviews',
        counts.dynamicLocatorCount === 1 && counts.needsReviewCount === 2, JSON.stringify(counts));
    check('U2: existing Page Object reuse still happened', counts.existingPageObjectReuseCount >= 2,
        String(counts.existingPageObjectReuseCount));
    check('U2: strategies are named', counts.locatorStrategiesUsed.length > 0,
        counts.locatorStrategiesUsed.join(', '));
  } else {
    check('U2: recording artifact present', false, 'ai/dashboard/recordings/TC_LOGIN_037.spec.ts is missing');
  }

  process.stdout.write('\n== U3 — the real TC_LOGIN_036 recording ==\n');
  const artifact36 = path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_036.spec.ts');
  if (fs.existsSync(artifact36)) {
    const recording = parseRecording(fs.readFileSync(artifact36, 'utf8'), { startUrl: '', browser: '', durationMs: 0 });
    const mapped = mapRecording(recording);
    const counts = locatorMetrics(mapped);
    // It carries the same generated id as 037, twice - once asserted on and once
    // used as a scope for a click.
    check('U3: blocked on the generated id', counts.needsReviewCount >= 1, JSON.stringify(counts));
    check('U3: the strong assertion is flagged suspicious, not rewritten',
        mapped.assessments.some(a => a.assessment.classification === 'suspicious'
          && a.assessment.reason.includes('Welcome to Bugasura')),
        mapped.assessments.filter(a => a.assessment.classification === 'suspicious').map(a => a.from).join(', '));
    check('U3: Page Object reuse still happened', counts.existingPageObjectReuseCount >= 2,
        String(counts.existingPageObjectReuseCount));
  } else {
    check('U3: recording artifact present', false, 'TC_LOGIN_036.spec.ts is missing');
  }

  process.stdout.write('\n== Y — multi-strategy resolution (Phase 7) ==\n');

  // The relationship TC_LOGIN_036 actually recorded: a generated container holding a
  // stable text, clicked.
  const scopedDynamic = "page.locator('#tc_summary_636432').getByText('Config Line Chart: Unable to')";
  const dropped = assessLocator({
    locator: scopedDynamic, target: 'Config Line Chart: Unable to', kind: 'action', value: null,
    context: [{ locator: scopedDynamic, target: '', kind: 'action', value: null }],
  });
  // P0.1: dropping the dynamic scope used to be automatic. TC_LOGIN_042 proved that
  // unsafe - the application renders the same text for mobile and desktop, so the
  // descendant alone matched two elements and could never be clicked. Uniqueness must
  // be MEASURED, and offline nothing can measure it.
  check('Y1: a dynamic scope is NOT dropped without measured uniqueness',
      dropped.outcome === 'NEEDS_REVIEW', dropped.outcome);
  check('Y1: nothing is emitted', dropped.expression === null);
  check('Y1: classified invalid', dropped.classification === 'invalid', dropped.classification);
  check('Y1: the scope-drop is recorded as a REJECTED candidate, with the reason',
      dropped.rejected.some(entry => entry.strategy === 'scope-drop'
        && /may not be unique/.test(entry.reason)),
      dropped.rejected.map(entry => entry.strategy).join(', '));
  check('Y1: the reason points at the live transport',
      /RECORDER_TRANSPORT=live/.test(dropped.reason), dropped.reason.slice(0, 100));
  check('Y1: no wildcard, prefix match, or first()',
      !/\[id\^=|\*=|first\(\)|nth\(/.test(JSON.stringify(dropped)));
  check('Y1: a STABLE scope is never dropped', (() => {
    const kept = assessLocator({
      locator: "page.locator('#response_modal_dialog').getByRole('button', { name: 'close' })",
      target: 'close', kind: 'action', value: null,
    });
    return kept.expression?.includes('#response_modal_dialog') === true;
  })());

  // The guard that matters most: an assertion must never find its target by the very
  // string it checks for.
  const tautology = assessLocator({
    locator: "page.locator('#tc_summary_636432').getByText('Config Line Chart: Unable to')",
    target: 'summary', kind: 'assertion', value: 'Config Line Chart: Unable to select periodicities',
    context: [],
  });
  check('Y2: an assertion is NOT resolved to its own expected text',
      tautology.outcome === 'NEEDS_REVIEW', tautology.outcome);
  check('Y2: and the refusal names the scope-drop it declined',
      tautology.rejected.some(r => r.strategy === 'scope-drop'),
      tautology.rejected.map(r => r.strategy).join(', ') || '(none)');

  // Axes: generated from a recorded containment relationship, then refused because
  // naming the ancestor needs a prefix match or a position.
  const axes = assessLocator({
    locator: "page.locator('#tc_summary_636432')", target: 'summary', kind: 'action', value: null,
    context: [{ locator: scopedDynamic, target: '', kind: 'action', value: null }],
  });
  check('Y3: ancestor-axis candidates are generated from the recording',
      axes.rejected.some(r => r.strategy === 'xpath-ancestor'), axes.rejected.map(r => r.strategy).join(', '));
  check('Y3: and refused - a prefix match cannot be proven unique',
      axes.rejected.some(r => /prefix match/.test(r.reason)));
  check('Y3: the positional axis is refused too',
      axes.rejected.some(r => r.strategy === 'xpath-ancestor-positional'));
  check('Y4: no axis is invented where the recording shows no relationship',
      assessLocator({ locator: "page.locator('#tc_summary_999999')", target: 'x', kind: 'action', context: [] })
          .rejected.length === 0);

  process.stdout.write('\n== Z — TC_LOGIN_039, the new regression ==\n');
  const artifact39 = path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_039.spec.ts');
  if (fs.existsSync(artifact39)) {
    const recording = parseRecording(fs.readFileSync(artifact39, 'utf8'), { startUrl: '', browser: '', durationMs: 0 });
    const mapped = mapRecording(recording);
    const counts = locatorMetrics(mapped);
    check('Z: #tc_summary_638717 is detected as dynamic', counts.dynamicLocatorCount === 1, JSON.stringify(counts));
    // Same two refusals as U2, and for the same two reasons - the generated id, and an
    // unmeasured bare-text locator in a recording that carries no evidence. Named, not
    // counted loosely.
    check('Z: it still needs review - its only stable evidence is its own text',
        counts.needsReviewCount === 2, String(counts.needsReviewCount));
    check('Z: one refusal is that assertion',
        mapped.needsReview.some(step => step.from.includes('tc_summary_638717')),
        mapped.needsReview.map(s => s.from).join(', '));
    check('Z: the case is NOT forced to pass - nothing emitted uses that id',
        mapped.steps.filter(s => s.kind !== 'needs-review')
            .every(s => !s.code.join(' ').includes('tc_summary_638717')));
    check('Z: everything else in the recording resolved',
        counts.existingPageObjectReuseCount >= 2 && counts.stableLocatorCount >= 2
        && counts.rawLocatorFallbackCount + counts.stableLocatorCount
          === counts.recordedLocatorCount - counts.needsReviewCount,
        `reuse=${counts.existingPageObjectReuseCount} stable=${counts.stableLocatorCount} `
        + `review=${counts.needsReviewCount}`);
    check('Z: no browser and no model were involved',
        generatedWithoutBrowser(mapped));
  } else {
    check('Z: TC_LOGIN_039 artifact present', false, 'missing');
  }

  process.stdout.write('\n== V — credential redaction is untouched ==\n');
  const redacted = parseChain("page.getByRole('textbox', { name: 'Password' })");
  check('V: password field parses as role+name', redacted[0]?.name === 'Password');
  const artifact036 = path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_036.spec.ts');
  if (fs.existsSync(artifact036)) {
    const source = fs.readFileSync(artifact036, 'utf8');
    check('V: the kept artifact holds the marker, not a password',
        source.includes('[type=password]') && !/fill\('(?!\[type=password\]|maneeswar)/.test(source));
  }

  process.stdout.write('\n== W — the non-recorded path is unchanged ==\n');
  const fromRecording = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/from-recording.ts'), 'utf8');
  check('W: the engine is only called from the recorded mapper',
      (fromRecording.match(/assessLocator\(/g) ?? []).length === 2,
      String((fromRecording.match(/assessLocator\(/g) ?? []).length));
  const agent = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/agent.ts'), 'utf8');
  check('W: agent.ts does not import it', !agent.includes('locator-quality'));
  const verify = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/verify.ts'), 'utf8');
  check('W: verify.ts does not import it', !verify.includes('locator-quality'));
  check('W: verify.ts still runs clean then mutated',
      verify.includes('const broken = runOne(') && verify.includes('still passes with every assertion broken'));

  process.stdout.write('\n== X — a clean recording still assembles ==\n');
  const id = 'TC_LQ_OK';
  fs.mkdirSync(path.dirname(artifactPath(id)), { recursive: true });
  fs.writeFileSync(artifactPath(id), `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://my.bugasura.io/');
  await expect(page.locator('#project_banner')).toContainText('Multi tasking is hard. Focus is good.');
});
`, 'utf8');
  written.push(artifactPath(id));
  const spec = recordedSpecPathFor(id);
  written.push(path.resolve(ROOT, spec));
  const generated = generateFromRecording(syntheticCase(id), spec, 'excel/login-test-cases.xlsx');
  check('X: assembled', generated.assembled, generated.reason);
  check('X: no locator was blocked', generated.metrics.locators.needsReviewCount === 0);
  check('X: metrics carry the strategies used',
      generated.metrics.locators.locatorStrategiesUsed.length > 0,
      generated.metrics.locators.locatorStrategiesUsed.join(', '));

  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
}

main()
    .catch(error => { process.stdout.write(`\nfixture error: ${String(error)}\n`); failures++; })
    .finally(() => {
      for (const file of written)
        fs.rmSync(file, { force: true });
      process.stdout.write('cleaned up every file the fixture wrote\n');
      process.exit(failures ? 1 : 0);
    });
