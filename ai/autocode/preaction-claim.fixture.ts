/**
 * P0.6 — parking evidence is not enough; it has to be CLAIMED.
 *
 *   npx tsx ai/autocode/preaction-claim.fixture.ts
 *   npx tsx ai/autocode/preaction-claim.fixture.ts --mutate
 *
 * Offline: no browser, no model, no network.
 *
 * WHY THIS EXISTS
 *
 * Every real recording reported `beforeActionCount: 0` while `afterActionCount` was
 * healthy. The diagnosis proved the hook installs, the recorder's glass pane does not
 * intercept, `pointerdown` arrives trusted, and the right element is parked - and then
 * the entry was thrown away at identity matching, for two independent reasons:
 *
 *   1. `PREACTION_HOOK` is a TEMPLATE LITERAL, so the `\s` in its whitespace regex was
 *      eaten before the string reached the browser and the runtime regex was `/s+/g` -
 *      replacing the LETTER "s". "Faclon labs" was fingerprinted "Faclon lab".
 *      READING THE SOURCE PROVES NOTHING; these checks run the generated string.
 *
 *   2. The matcher demanded every literal of the recorded chain on the clicked element's
 *      own fingerprint. A chain describes RELATIONSHIPS: `#tc_summary_638717 >>
 *      getByText('…')` names a scope and a thing inside it, and Playwright writes roles
 *      (`getByRole('listitem')`) that exist only implicitly in the tag.
 *
 * What this does NOT do: make an ambiguous recording resolvable. A locator that measured
 * more than one element still needs a person - pinned by check I.
 */

import fs from 'node:fs';
import path from 'node:path';

import { PREACTION_HOOK } from './dom-capture-source';
import { claimParkedEntry, implicitRole, literalsIn } from '../dashboard/live-recorder';
import { assessLocator } from './locator-quality';
import {
  evidenceFor, isProvenAgainstClickedTarget,
  type CandidateMeasurement, type TargetEvidence,
} from './dom-evidence';

const ROOT = process.cwd();
const MUTATE = process.argv.includes('--mutate');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

type Claim = typeof claimParkedEntry;
let claim: Claim = claimParkedEntry;
let hookSource = PREACTION_HOOK;

/* ------------------------------------------------------------------ fixtures */

/** A parked entry in the shape `window.__auraPark` pushes out. */
const parked = (target: any, parent?: any, ancestors: any[] = []) => ({
  at: 1, kind: 'pointerdown',
  fingerprint: { tag: target.tag, id: target.id ?? '', testId: '', role: target.role ?? '',
    ariaLabel: '', name: target.name ?? '', placeholder: '', title: '', type: target.type ?? '',
    text: target.text ?? '', classes: target.classes ?? [] },
  graph: { target, parent, ancestors },
});

/** The sidebar project link: an unclassed-ish span inside li > ul > nav#sideNavBarId. */
const FACLON = parked(
    { tag: 'span', text: 'Faclon labs', classes: ['handel-over-flow'] },
    { tag: 'span', stableClasses: ['app-name'], text: 'Faclon labs' },
    [{ tag: 'li' }, { tag: 'ul', stableClasses: ['nav'] }, { tag: 'nav', id: 'sideNavBarId' }]);

/** TC_LOGIN_060's summary click: no id on the target, dynamic id four levels up. */
const SUMMARY = parked(
    { tag: 'span', text: 'Line Chart | Time Config Page: Note, under Periodicity Field' },
    { tag: 'div', id: 'tc_update_summary_638717', stableClasses: ['bug-report__summary--text', 'hidden-xs'] },
    [{ tag: 'div', id: 'tc_update_summary_638717', stableClasses: ['bug-report__summary--text'] },
      { tag: 'div', id: 'tc_summary_638717', stableClasses: ['tabulator-cell'] },
      { tag: 'div', id: 'tr_638717', stableClasses: ['tabulator-row'] },
      { tag: 'div', id: 'bugReport-table', stableClasses: ['tabulator'] }]);

/** Run the generated hook's own normaliser, exactly as the browser would. */
function runtimeNormalise(value: string): string {
  const body = hookSource.match(/replace\((\/[^,]+\/[a-z]*)/)?.[1];
  if (!body)
    return '<<no replace() found in the generated hook>>';
  return (new Function('v', `return v.replace(${body}, ' ').trim()`) as (v: string) => string)(value);
}

/* -------------------------------------------------------------------- checks */

function checkWhitespace(): void {
  process.stdout.write('\n== A — whitespace normalisation, tested on the GENERATED string ==\n');
  check('A: the runtime regex is a whitespace class, not the letter s',
      /replace\(\/\\s\+\/g/.test(hookSource),
      (hookSource.match(/replace\([^)]*\)/g) ?? []).join(' | '));
  check('A: "Faclon labs" survives intact', runtimeNormalise('Faclon labs') === 'Faclon labs',
      JSON.stringify(runtimeNormalise('Faclon labs')));
  check('A: "Projects" survives intact', runtimeNormalise('Projects') === 'Projects',
      JSON.stringify(runtimeNormalise('Projects')));
  check('A: the letter s is never removed', runtimeNormalise('sss') === 'sss',
      JSON.stringify(runtimeNormalise('sss')));
  check('A: repeated whitespace still collapses', runtimeNormalise('a   b') === 'a b');
  check('A: newlines and tabs collapse too', runtimeNormalise('a\n\tb') === 'a b');
  check('A: surrounding whitespace is trimmed', runtimeNormalise('  x  ') === 'x');
}

function checkRelationships(): void {
  process.stdout.write('\n== B/C/D — a chain names relationships, not one element ==\n');
  check('B: a target literal matches the target',
      Boolean(claim([FACLON], "page.getByText('Faclon labs')")));
  check('C: an ancestor SCOPE literal is satisfied by an ancestor',
      Boolean(claim([FACLON], "page.locator('#sideNavBarId').getByText('Faclon labs')")));
  check('D: a literal is satisfied by the PARENT',
      Boolean(claim([FACLON], "page.locator('.app-name').getByText('Faclon labs')")));
  check('   the final segment must still match the TARGET, not an ancestor',
      !claim([FACLON], "page.getByText('Faclon labs').getByText('sideNavBarId')"));
  check('   descendants and siblings are never searched for a literal',
      !claim([parked({ tag: 'div', text: 'wrapper' }, undefined, [])], "page.getByText('wrapper').getByText('child')"));
}

function checkRoles(): void {
  process.stdout.write('\n== E/F/G/H — implicit ARIA roles, conservatively ==\n');
  check('E: li → listitem, so getByRole(\'listitem\') is satisfied by an ancestor <li>',
      Boolean(claim([FACLON], "page.getByRole('listitem').getByText('Faclon labs')")));
  const button = parked({ tag: 'button', text: 'Sign In' });
  check('F: a native <button> answers getByRole(\'button\')',
      Boolean(claim([button], "page.getByRole('button', { name: 'Sign In' })")));
  const link = parked({ tag: 'a', text: 'Forgot Password?' });
  check('G: an <a> answers getByRole(\'link\')',
      Boolean(claim([link], "page.getByRole('link', { name: 'Forgot Password?' })")));
  const input = parked({ tag: 'input', type: 'email', name: 'email', id: 'email_field' });
  check('H: input[type=email] answers getByRole(\'textbox\')',
      Boolean(claim([input], "page.getByRole('textbox', { name: 'email' })")));
  check('H: a <textarea> answers textbox too',
      Boolean(claim([parked({ tag: 'textarea', name: 'notes' })], "page.getByRole('textbox', { name: 'notes' })")));

  process.stdout.write('   an unmappable role is REFUSED, never guessed\n');
  check('   input[type=file] maps to nothing', implicitRole({ tag: 'input', type: 'file' }) === null);
  check('   a <span> maps to nothing', implicitRole({ tag: 'span' }) === null);
  check('   a <div> is not called a button',
      !claim([parked({ tag: 'div', text: 'Save' })], "page.getByRole('button', { name: 'Save' })"));
  check('   a role that no node carries refuses the claim',
      !claim([FACLON], "page.getByRole('button').getByText('Faclon labs')"));
}

function checkAmbiguity(): void {
  process.stdout.write('\n== I — an ambiguous recording is never resolved by pre-action evidence ==\n');
  // The entry may well be claimable - it is the same element. What must not happen is
  // that it RESOLVES the action: the capture binds with .first() when the recorded
  // locator matched several, so the graph cannot prove which one the person chose.
  const claimable = Boolean(claim([FACLON], "page.getByText('Faclon labs')"));
  check('I: the entry is claimable as diagnostics', claimable);
  const verdict = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    evidence: {
      locator: "page.getByText('Faclon labs')",
      target: { tag: 'span', text: 'Faclon labs' },
      ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
      relationships: [], matchCount: 2, captureTiming: 'before-action',
      derivedCandidates: [{ strategy: 'scoped-class-text', expression: 'page.locator("#sideNavBarId .handel-over-flow")', matchCount: 1 }],
    } as TargetEvidence,
  });
  check('I: but matchCount 2 still yields NEEDS_REVIEW, even before-action',
      verdict.outcome === 'NEEDS_REVIEW', verdict.outcome);
  check('I: and nothing is emitted', verdict.expression === null);
  check('I: the reason is the measurement, not the timing',
      verdict.strategy === 'measured-ambiguous', String(verdict.strategy));
}

/**
 * A two-letter literal must not match a fragment of a longer word.
 *
 * P1.2c: `getByRole('button', { name: 'ON', exact: true })` claimed a parked press
 * of Bugasura's sign-in button, because `satisfiedBy` was a substring test and
 * "on" is inside "buttON" - and inside "mdl-button" too. The evidence for
 * TC_LOGIN_075 therefore described the ON control as `<button name="login">Sign
 * In</button>`. P0.7's document check refused to report a count for it, so the
 * measurement stayed honest; the identification did not.
 */
function checkShortLiterals(): void {
  process.stdout.write('\n== K — a short literal needs a word boundary, not a substring ==\n');
  // The real node, exactly as TC_LOGIN_075's evidence records it.
  const signIn = parked({
    tag: 'button', name: 'login', type: 'button', text: 'Sign In',
    classes: ['login-submit', 'mdl-button', 'mdl-js-button', 'mdl-js-ripple-effect'],
  }, { tag: 'div', classes: ['submit-btn-container', 'row'], text: 'Sign In' });

  check('11: "ON" no longer claims a <button> just because "button" contains it',
      claim([signIn], "page.getByRole('button', { name: 'ON', exact: true })") === null);
  check('12: "OFF" claims nothing here either',
      claim([signIn], "page.getByRole('button', { name: 'OFF' })") === null);
  check('13: "OK" claims nothing here either',
      claim([signIn], "page.getByRole('button', { name: 'OK' })") === null);
  for (const word of ['NO', 'YES', 'UP'])
    check(`13: "${word}" claims nothing here either`,
        claim([signIn], `page.getByRole('button', { name: '${word}' })`) === null);

  // 14 - the literals that must keep working, including a long one that is only a
  // substring of a class. Narrowing short literals must not narrow these.
  check('14: the button is still claimed by its own accessible name',
      Boolean(claim([signIn], "page.getByRole('button', { name: 'Sign In', exact: true })")));
  check('14: and by a longer literal that appears inside a class',
      Boolean(claim([signIn], "page.getByRole('button', { name: 'Submit' })")));
  check('14: a short literal still matches when it IS the whole value',
      Boolean(claim([parked({ tag: 'button', text: 'ON' })],
          "page.getByRole('button', { name: 'ON' })")));
  check('14: and when it stands as a word inside one',
      Boolean(claim([parked({ tag: 'span', text: 'notifications on' })],
          "page.getByText('on')")));
  check('14: a short literal matches a hyphenated class as a word',
      Boolean(claim([parked({ tag: 'div', classes: ['tab-strip'] })],
          "page.locator('.tab')")));
  check('14: but not the middle of one',
      claim([parked({ tag: 'div', classes: ['cutoff-panel'] })],
          "page.locator('.off')") === null);

  // 15-17 - the bar this fix must not lower. `isProvenAgainstClickedTarget` is the
  // one predicate that says a candidate identifies the element the person pressed.
  process.stdout.write('\n== M — the identity bar is unchanged ==\n');
  const measured = (over: Partial<CandidateMeasurement>): CandidateMeasurement => ({
    strategy: 'stable-id', expression: "page.locator('#a')", matchCount: 1,
    identityMatched: true, sameDocument: true, measuredAt: 'press', ...over,
  });
  check('15: a candidate measured at the press, in its document, at one element, IS proven',
      isProvenAgainstClickedTarget(measured({})));
  check('15: an identity that was checked and came back false is refused',
      !isProvenAgainstClickedTarget(measured({ identityMatched: false })));
  check('16: a UNIQUE candidate pointing at a different element is still refused',
      !isProvenAgainstClickedTarget(measured({ matchCount: 1, identityMatched: false })));
  check('17: a candidate measured in another document is refused',
      !isProvenAgainstClickedTarget(measured({ sameDocument: false })));
  check('17: and one measured at claim time rather than at the press is refused',
      !isProvenAgainstClickedTarget(measured({ measuredAt: 'claim' })));
  check('15: two matches is refused however well identified',
      !isProvenAgainstClickedTarget(measured({ matchCount: 2 })));
}

function checkDynamicAncestor(): void {
  process.stdout.write('\n== J — no id on the target, dynamic id on an ancestor ==\n');
  const chain = "page.locator('#tc_summary_638717').getByText('Line Chart | Time Config Page')";
  check('J: the summary click is claimable', Boolean(claim([SUMMARY], chain)));
  check('J: it was NOT claimable by the element alone — the id is four levels up',
      (SUMMARY.fingerprint.id ?? '') === '');
  check('J: a DIFFERENT row\'s scope does not claim this entry',
      !claim([SUMMARY], "page.locator('#tc_summary_999999').getByText('Line Chart | Time Config Page')"));
}

function checkFallback(): void {
  process.stdout.write('\n== L — no match means the after-action fallback, never a guess ==\n');
  check('L: an unrelated chain claims nothing', !claim([FACLON, SUMMARY], "page.getByText('Nothing here')"));
  check('L: an empty queue claims nothing', !claim([], "page.getByText('Faclon labs')"));
  check('L: a chain with no literals claims nothing', !claim([FACLON], 'page.locator()'));
  check('L: the newest matching entry wins when two match',
      claim([FACLON, { ...FACLON, at: 2 }], "page.getByText('Faclon labs')")?.at === 2);
}

function checkNavigationWiring(): void {
  process.stdout.write('\n== K — a navigating click: the entry leaves the document as it is parked ==\n');
  const hook = fs.readFileSync(path.resolve(ROOT, 'ai/autocode/dom-capture-source.ts'), 'utf8');
  const live = fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8');
  check('K: the hook hands each entry to the framework as it parks it',
      /window\.__auraPark/.test(hookSource));
  check('K: the push cannot break the page it is recording',
      /try \{ if \(window\.__auraPark\)/.test(hookSource));
  // A BINDING since P0.7, not a plain exposed function: the binding hands back the
  // frame the press happened in, which is the only place the press-time document can
  // still be measured. The ordering invariant this check exists for is unchanged -
  // registered before the init script, so the hook always finds it.
  check('K: the binding is registered BEFORE the init script',
      live.indexOf("exposeBinding('__auraPark'") < live.indexOf('addInitScript({ content: PREACTION_HOOK })')
      && live.includes("exposeBinding('__auraPark'"));
  check('K: the mirror is bounded', /MAX_PARKED/.test(live));
  check('K: claiming reads the mirror before the live page',
      live.indexOf('claimParkedEntry(parkedEntries') < live.indexOf('page.evaluate(READ_PARKED)'));
  check('K: the live page is still read as a fallback', /READ_PARKED/.test(live));
  check('K: no polling interval was added or shortened', /\}, 400\);/.test(live));
  check('K: the parked count is reported', /parkedCount/.test(live));
}

function checkUnchanged(): void {
  process.stdout.write('\n== M/N — untouched behaviour ==\n');
  const pageObject = assessLocator({
    locator: "page.locator('#cell_638717').getByText('x')", target: 'x', kind: 'action',
    pageObject: { pageObject: 'IssuesPage', method: 'summaryFor' },
  });
  check('M: a Page Object still wins first', pageObject.outcome === 'REUSE_PAGE_OBJECT', pageObject.outcome);

  const p05 = assessLocator({
    locator: "page.locator('#cell_638717').getByText('Line Chart')", target: 'x', kind: 'action',
    evidence: {
      locator: "page.locator('#cell_638717').getByText('Line Chart')",
      target: { tag: 'span', text: 'Line Chart' },
      ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
      relationships: [], matchCount: 1,
      derivedCandidates: [{ strategy: 'scoped-parent-class-text', expression: 'page.locator("#t .s").getByText("Line Chart")', matchCount: 1 }],
    } as TargetEvidence,
  });
  check('N: P0.5 still promotes a scoped dynamic id from a measured-unique candidate',
      p05.outcome === 'NORMALIZED_LOCATOR', p05.outcome);
  check('N: to the counted candidate', p05.expression === 'page.locator("#t .s").getByText("Line Chart")');
  check('N: literalsIn is unchanged',
      JSON.stringify(literalsIn("page.locator('#loginForm').getByText('Sign In')")) === JSON.stringify(['loginForm', 'Sign In']),
      JSON.stringify(literalsIn("page.locator('#loginForm').getByText('Sign In')")));
}

function checkRealArtifacts(): void {
  process.stdout.write('\n== the real recordings — would each locator claim its own graph? ==\n');
  for (const id of ['TC_LOGIN_059', 'TC_LOGIN_060']) {
    const file = path.resolve(ROOT, `ai/dashboard/recordings/${id}.evidence.json`);
    if (!fs.existsSync(file)) {
      check(`${id} sidecar present`, false);
      continue;
    }
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stdout.write(`\n  ${id} (beforeActionCount=${record.recording?.beforeActionCount})\n`);
    for (const entry of record.targets) {
      if (entry.target?.tag === '(not found)')
        continue;
      // Rebuild a parked entry from the captured graph: same target, parent, ancestors.
      const asParked = parked(
          { tag: entry.target.tag, id: entry.target.id, type: entry.target.type,
            role: entry.target.role, name: entry.target.name,
            text: entry.target.text, classes: entry.target.stableClasses ?? [] },
          entry.parent, entry.ancestors ?? []);
      const hit = Boolean(claim([asParked], entry.locator));
      const ambiguous = typeof entry.matchCount === 'number' && entry.matchCount > 1;
      process.stdout.write(`    ${hit ? 'claim OK ' : 'no claim '} matchCount=${String(entry.matchCount).padEnd(4)}`
        + `${ambiguous ? ' (ambiguous — never resolves the action) ' : ' '}${entry.locator}\n`);
      if (entry.locator.includes('tc_summary_638717') && entry.locator.includes('getByText'))
        check(`  ${id}: the summary click claims its graph`, hit);
      if (entry.locator.includes("getByText('Faclon labs')")) {
        check(`  ${id}: Faclon labs claims its graph (diagnostics only)`, hit);
        check(`  ${id}: and its recorded locator is ambiguous, so it cannot resolve`, ambiguous,
            `matchCount=${entry.matchCount}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ mutation */

async function runMutation(): Promise<void> {
  const file = path.resolve(ROOT, 'ai/dashboard/live-recorder.ts');
  const mutant = path.resolve(ROOT, 'ai/dashboard/live-recorder.mutant.ts');
  const source = fs.readFileSync(file, 'utf8');
  // Revert cause 2: literals may only be satisfied by the target itself.
  const marker = '      return wanted.every(literal => satisfiedBy(target, literal)\n'
    + '        || (!last && containers.some(node => satisfiedBy(node, literal))));';
  const hits = source.split(marker).length - 1;
  if (hits !== 1) {
    process.stdout.write(`FAIL  mutation marker matched ${hits} times, expected 1\n`);
    process.exit(1);
  }
  fs.writeFileSync(mutant,
      source.split(marker).join('      return wanted.every(literal => satisfiedBy(target, literal));'), 'utf8');
  let expected = false;
  try {
    const loaded = await import('../dashboard/live-recorder.mutant');
    claim = loaded.claimParkedEntry as Claim;
    // Revert cause 1 too: the escape the template literal used to eat.
    hookSource = PREACTION_HOOK.replace('replace(/\\s+/g', 'replace(/s+/g');
    process.stdout.write('\n### MUTANT: target-only matching, and the eaten escape restored.\n');
    runChecks();
    expected = failures > 0;
    process.stdout.write(`\n${expected
      ? `MUTATION: PASS — the mutant failed ${failures} check(s), so the fixture bites`
      : 'MUTATION: FAIL — the mutant passed everything; the fixture proves nothing'}\n`);
  } finally {
    fs.rmSync(mutant, { force: true });
  }
  process.exit(expected ? 0 : 1);
}

function runChecks(): void {
  checkWhitespace();
  checkRelationships();
  checkRoles();
  checkAmbiguity();
  checkShortLiterals();
  checkDynamicAncestor();
  checkFallback();
  checkNavigationWiring();
  checkUnchanged();
  checkRealArtifacts();
}

async function main(): Promise<void> {
  if (MUTATE) {
    await runMutation();
    return;
  }
  runChecks();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
