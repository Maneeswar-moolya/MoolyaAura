import '../testing/isolated-checkout';
/**
 * An ambiguous locator is rejected, never narrowed.
 *
 *   npx tsx ai/autocode/locator-cardinality.fixture.ts
 *
 * THE DEFECT THIS CLOSES. `resolveLocator` used to build every candidate as
 * `candidate.build(page).first()`. That makes a strict-mode exception
 * impossible, which reads like safety and is its opposite: a candidate matching
 * three elements became indistinguishable from one matching exactly the right
 * element, the healing log recorded a successful resolution either way, and the
 * test asserted against whichever element happened to come first in the DOM.
 * Playwright's strict mode is a diagnostic, and `.first()` was switching it off
 * for all thirty-five Page Object methods that resolve through there.
 *
 * TWO FAILURES, NOT ONE. A runtime strict-mode violation is loud and already
 * caught by the acceptance gate. Silent ambiguity is neither, and it is the one
 * that ships. Both are rejected now.
 *
 * WHAT IS NOT BANNED. `.first()` on a collection is legitimate - "the first
 * row" is a real thing to want. The rule keys on what it is applied to: a
 * `page.*` chain built inline is an identity; a named collection is not.
 *
 * The page here is a stub: `count()` returns what each case declares, so
 * cardinality can be exercised without a browser. The LIVE behaviour is a
 * separate question and is reported separately.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as path from 'path';

import { resolveLocator, HealingRecorder } from '../../tests-e2e/support/resilient-locator';
import { staticCheck } from './verify';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/**
 * A locator stub whose positional helpers return a DIFFERENT, marked object.
 *
 * THE INVARIANT IS ABOUT WHAT COMES BACK, not about whether `.first()` is ever
 * called. The resolver waits on `locator.first()` deliberately - the wait is a
 * presence probe asking "has anything appeared yet?", and it must be narrowed
 * because `waitFor` is itself strict-mode checked. What must never happen is
 * that narrowed locator being RETURNED as the element's identity.
 *
 * An earlier version returned `self` from `.first()`, so the two were
 * indistinguishable: the checks could only assert "never called", which the
 * presence probe legitimately broke, and asserting `__narrowed === null` against
 * an object that never set it would have passed no matter what the resolver did.
 * Marking the narrowed object is what gives those checks teeth.
 */
function stubLocator(count: number, narrowed: string[] = []): Record<string, unknown> {
  const narrow = (how: string): Record<string, unknown> => {
    narrowed.push(how);
    return { count: async () => 1, waitFor: async () => undefined, __count: 1, __narrowed: how };
  };
  const self: Record<string, unknown> = {
    count: async () => count,
    waitFor: async () => undefined,
    first: () => narrow('first'),
    last: () => narrow('last'),
    nth: () => narrow('nth'),
    __count: count,
    __narrowed: null,
  };
  return self;
}

const stubPage = { url: () => 'https://example.test/page' } as never;

/** Resolve against declared counts; returns the winner's count, or the error. */
async function resolve(counts: number[], cardinality?: 'one' | 'many'): Promise<{
  count: number | null; returnedNarrowed: string | null; narrowed: string[];
  healed: string | null; error: string | null;
}> {
  const narrowed: string[] = [];
  const recorder = new HealingRecorder();
  try {
    const locator = await resolveLocator({
      page: stubPage,
      logicalName: 'test.element',
      candidates: counts.map((n, i) => ({
        strategy: `candidate-${i + 1}`,
        build: () => stubLocator(n, narrowed) as never,
      })),
      recorder,
      ...(cardinality ? { cardinality } : {}),
    });
    const returned = locator as unknown as { __count: number; __narrowed: string | null };
    return {
      count: returned.__count, returnedNarrowed: returned.__narrowed ?? null,
      narrowed, healed: recorder.events[0]?.to ?? null, error: null,
    };
  } catch (error) {
    return {
      count: null, returnedNarrowed: null, narrowed, healed: null,
      error: (error as Error).message,
    };
  }
}

/* ------------------------------------------------ 1-6: cardinality itself ---- */

async function checkCardinality(): Promise<void> {
  process.stdout.write('\n== a candidate identifies the element, or it does not ==\n');

  const one = await resolve([1]);
  check('CASE 1: exactly one -> accepted', one.count === 1 && !one.error);
  check('CASE 1: and the RETURNED locator is not narrowed',
      one.returnedNarrowed === null, String(one.returnedNarrowed));

  const two = await resolve([2]);
  check('CASE 2: two matches -> refused, and nothing narrowed is returned',
      two.count === null && two.returnedNarrowed === null, String(two.count));
  check('CASE 2: and the failure names the count', /matched 2 elements/.test(two.error ?? ''),
      (two.error ?? '').split('\n')[1] ?? '');

  const three = await resolve([3]);
  check('CASE 3: three matches -> refused, and nothing narrowed is returned',
      three.count === null && three.returnedNarrowed === null);
  check('CASE 3: and it says first() is deliberately not used',
      /NOT narrowed with first\(\)|not narrowed with first/i.test(three.error ?? ''));

  // CASE 4: healing across an ambiguous candidate - the whole point of keeping it.
  const healed = await resolve([2, 1]);
  check('CASE 4: an ambiguous candidate falls through to the next',
      healed.count === 1 && !healed.error);
  check('CASE 4: healing is still recorded', healed.healed === 'candidate-2', String(healed.healed));
  check('CASE 4: and the locator it returns is the unnarrowed one',
      healed.returnedNarrowed === null, String(healed.returnedNarrowed));

  // Zero behaves as it always did - attached fails, next candidate.
  const zero = await resolve([0, 1]);
  check('a zero-match candidate still falls through', zero.count === 1);

  const none = await resolve([2, 3, 4]);
  check('CASE 5: every candidate ambiguous -> loud failure', none.count === null);
  check('CASE 5: the error lists every strategy and its count',
      ['candidate-1', 'candidate-2', 'candidate-3'].every(s => (none.error ?? '').includes(s))
      && /2 elements[\s\S]*3 elements[\s\S]*4 elements/.test(none.error ?? ''));

  const many = await resolve([3], 'many');
  check('CASE 6: an explicit collection accepts several', many.count === 3 && !many.error);
  check('CASE 6: and the collection comes back whole - the caller decides',
      many.returnedNarrowed === null && many.count === 3, String(many.count));
}

/* ------------------------------- 7/8/13: the gate over generated specs ---- */

function checkStaticGate(): void {
  process.stdout.write('\n== a generated spec cannot ship positional identity ==\n');
  const wrap = (line: string) => `test('TC_X - s', async () => { await trace({}); expect(1); ${line} });`;
  const flagged = (line: string) =>
    staticCheck(wrap(line), 'TC_X', 's').some(p => /identify an element/.test(p.message));

  check('CASE 13: page.locator(...).first() as identity is refused',
      flagged("await page.locator('.button').first().click();"));
  check('CASE 13: .nth() as identity is refused',
      flagged("await page.getByRole('button').nth(2).click();"));
  check('CASE 13: .last() as identity is refused',
      flagged("await page.locator('.row').last().click();"));
  check('CASE 13: a chain narrowed at the end is refused',
      flagged("await page.locator('.a').filter({ hasText: 'x' }).first().click();"));

  // The distinction: a collection is not an identity.
  check('a collection variable is NOT refused',
      !flagged('await issuesPage.rowStatus(rows.first());'));
  check('a Page Object call is NOT refused',
      !flagged('await (await issuesPage.searchField()).click();'));
  check('an unnarrowed locator is NOT refused',
      !flagged("await page.locator('#record_search').click();"));
  check('a contextual chain with no positional call is NOT refused',
      !flagged("await page.locator('.r').filter({ hasText: d }).locator('.c').click();"));

  // CASE 7/8 live in the generation gates and are pinned by their own fixtures;
  // asserted here only to prove this change did not disturb them.
  const { assessLocator } = require('./locator-quality') as typeof import('./locator-quality');
  check('CASE 7: a dynamic id is still refused at generation',
      assessLocator({ locator: "page.locator('#tc_summary_637609')", target: 's', kind: 'action' })
          .outcome === 'NEEDS_REVIEW');
  check('CASE 8: unmeasured text is still refused at generation',
      assessLocator({ locator: "page.getByText('Projects')", target: 'Projects', kind: 'assertion' })
          .outcome === 'NEEDS_REVIEW');
}

/* ---------------------- 10/14: the Page Object layer cannot hide ambiguity ---- */

function checkPageObjectLayer(): void {
  process.stdout.write('\n== no identity resolver narrows internally ==\n');

  const resolver = fs.readFileSync(
      path.join(ROOT, 'tests-e2e', 'support', 'resilient-locator.ts'), 'utf8');
  const body = resolver.split('export async function resolveLocator')[1] ?? '';
  check('CASE 14: resolveLocator builds candidates unnarrowed',
      /candidate\.build\(page\);/.test(body) && !/candidate\.build\(page\)\.first\(\)/.test(body));
  check('CASE 14: and measures the count instead',
      /await locator\.count\(\)/.test(body) && /count !== 1/.test(body));
  check('CASE 14: cardinality "many" must be asked for, never inferred',
      /options\.cardinality \?\? 'one'/.test(resolver));

  // THE INVARIANT: every method routed through the identity resolver must let it
  // do the identifying. A method that narrows its own candidate is hiding the
  // ambiguity one level lower down, where nothing measures it.
  const offenders: string[] = [];
  for (const file of fs.readdirSync(path.join(ROOT, 'tests-e2e', 'pages'))
      .filter(name => name.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(ROOT, 'tests-e2e', 'pages', file), 'utf8');
    for (const match of source.matchAll(/this\.resolve\(([\s\S]*?)\n {2}\}/g)) {
      const block = match[1];
      // `build:` arrows that end in a positional call are the thing to catch.
      if (/build:\s*page\s*=>[^,\n]*\.(first|last|nth)\s*\(/.test(block))
        offenders.push(`${file}: ${block.split('\n')[0].trim().slice(0, 50)}`);
    }
  }
  check('CASE 10: no resolve()-backed candidate narrows itself',
      offenders.length === 0, offenders.join(' | ') || 'none');

  const base = fs.readFileSync(path.join(ROOT, 'tests-e2e', 'pages', 'base.page.ts'), 'utf8');
  check('resolve() means exactly one, resolveMany() is the opt-out',
      /protected resolve\(/.test(base) && /protected resolveMany\(/.test(base)
      && /cardinality: 'many'/.test(base));
}

/* ------------------------- 9/11/12: what must keep working, unchanged ---- */

function checkNothingRegressed(): void {
  process.stdout.write('\n== the capabilities that already worked still work ==\n');

  const { parseRecording } = require('../dashboard/recorder') as typeof import('../dashboard/recorder');
  const { mapRecording, readAssertions, readEvidence } =
    require('./from-recording') as typeof import('./from-recording');

  const methodsIn = (id: string): string[] => {
    const file = path.join(RECORDINGS(), `${id}.spec.ts`);
    if (!fs.existsSync(file))
      return [];
    const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
      startUrl: '', browser: '', durationMs: 0,
      evidence: readEvidence(id), stateAssertions: readAssertions(id) });
    return mapRecording(recording).steps
        .filter(step => step.kind === 'page-object')
        .map(step => `${step.pageObject}.${step.method}`);
  };

  const ninetyOne = methodsIn('TC_SEARCH');
  check('CASE 9/10: proven-locator reuse still resolves searchField three times',
      ninetyOne.filter(name => name === 'IssuesPage.searchField').length === 3, ninetyOne.join(', '));
  const ninetyTwo = methodsIn('TC_ROW_A');
  check('CASE 11: parameterised reuse still works',
      ninetyTwo.includes('IssuesPage.issueCheckbox'), ninetyTwo.join(', '));
  check('CASE 12: action and assertion remain separate methods',
      ninetyTwo.includes('IssuesPage.issueCheckbox')
      && ninetyTwo.includes('IssuesPage.issueCheckboxState'));
}

async function main(): Promise<void> {
  await checkCardinality();
  checkStaticGate();
  checkPageObjectLayer();
  checkNothingRegressed();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
