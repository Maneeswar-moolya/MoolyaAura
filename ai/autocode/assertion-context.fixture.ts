import '../testing/isolated-checkout';
/**
 * An assertion about a repeated element, addressed by its container (Phase 2C).
 *
 *   npx tsx ai/autocode/assertion-context.fixture.ts
 *
 * TC_LOGIN_082's assertion is about `<input id="639978" class="bugChecked">`, one
 * checkbox among ten identical rows. The id is numeric and stays dynamic; the class
 * describes all ten. The picker used to write `page.locator("#639978")` - a locator
 * that bypassed the dynamic-id policy entirely - and once that was refused it wrote
 * `.bugChecked`, which is honest and ambiguous.
 *
 * The assertion now uses the same evidence-backed shape the ACTION uses, and earns
 * it the same way: measured, in the document the person was looking at, against the
 * exact element the assertion is about.
 *
 * THE PART THAT IS EASY TO GET WRONG
 *
 * The element under the pointer is a decorative `<span>`. The assertion subject is
 * an `<input>` the pointer cannot reach. Identity must be answered against the
 * INPUT - checking the span would prove the wrong thing about the right row, which
 * is exactly the class of error the whole measurement exists to catch. Test 14 is
 * that claim, and the mutation section shows it failing when the subject's slot is
 * swapped for the pointed element's.
 *
 * Offline: no browser, no model, no network. The measurement engine is stubbed with
 * the answers a browser would give, so every branch is reachable deterministically.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  containerPhraseFor, isProvenAgainstClickedTarget, isProvenAtPick,
  type CandidateMeasurement,
} from './dom-evidence';
import { analyseIdentifier } from './locator-quality';
import {
  needsContextualLocator, resolveContextualAssertionLocator,
} from '../dashboard/live-recorder';
import { PREACTION_HOOK } from './dom-capture-source';
import { ASSERTION_PICKER } from '../dashboard/assertion-picker-source';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

const gen = (value: string): boolean => analyseIdentifier(value).dynamic;
const PHRASE = 'Line Chart : Getting flat line for Weekly and monthly';
const WANTED = `page.locator(".tabulator-row").filter({ hasText: ${JSON.stringify(PHRASE)} })`
  + '.locator(".bugChecked")';

/** The row as the picker captures it: 120 chars, capped, dynamic number in front. */
const ROW_TEXT = '639978 Line Chart : Getting flat line for Weekly and monthly periodicities '
  + 'in the rendered line chart and also displayi';

const SPAN = { tag: 'span', stableClasses: ['rounded-checkbox-ui'] };
const CHECKBOX = {
  tag: 'input', type: 'checkbox', id: '639978', name: 'bugChecked',
  stableClasses: ['bugChecked'],
};

const ancestors = (over: Array<Record<string, unknown>> = []) => [
  { tag: 'label', stableClasses: ['rounded-checkbox-cont'], text: '' },
  { tag: 'div', stableClasses: ['tabulator-cell'], text: '' },
  { tag: 'div', stableClasses: ['tabulator-row', 'animated', 'fadeIn'], text: ROW_TEXT },
  ...over,
];

/**
 * The payload the picker sends when somebody points at the decorative span.
 *
 * `targetIndex: 9` is the span's slot; the checkbox candidate carries slot 4. They
 * differ on purpose - test 14 depends on it.
 */
const payload = (over: Record<string, unknown> = {}) => ({
  capabilityId: 'checked',
  node: SPAN,
  state: { visible: true },
  candidates: [
    { relationship: 'label-ancestor', node: CHECKBOX, state: { checked: true }, targetIndex: 4 },
    { relationship: 'switch-wrapper', node: CHECKBOX, state: { checked: true }, targetIndex: 5,
      via: { tag: 'span', stableClasses: ['ba-switch'], controlCount: 1 } },
  ],
  context: { documentId: 'doc-1', targetIndex: 9, ancestors: ancestors() },
  ...over,
});

/**
 * The measurement engine, stubbed with the answer a browser would give.
 *
 * It records which registry slot it was asked about, which is how test 14 proves
 * identity was answered against the subject rather than the pointed element.
 */
function frameAnswering(
  answer: Record<string, unknown>,
  seen?: { index?: number; documentId?: string | null; candidates?: any[] },
) {
  return {
    evaluate: async (_fn: unknown, input: any) => {
      if (seen) {
        seen.index = input.index;
        seen.documentId = input.documentId;
        seen.candidates = input.candidates;
      }
      return { targetPresent: true, sameDocument: true, results: [], ...answer };
    },
  };
}
const oneGoodResult = { results: [{ strategy: 'container-text', count: 1, identityMatched: true }] };

/* ------------------------------------------------------- 1-3: when it applies */

async function checkApplies(): Promise<void> {
  process.stdout.write('\n== 1-3 — when a contextual assertion locator is used ==\n');

  const seen: any = {};
  const proven = await resolveContextualAssertionLocator(
      frameAnswering(oneGoodResult, seen), payload() as any);
  check('1: numeric dynamic id + meaningful row text yields the contextual locator',
      proven?.locator === WANTED, String(proven?.locator));
  check('1: recorded under its own strategy name',
      proven?.locatorStrategy === 'container-text', String(proven?.locatorStrategy));

  // 2 - a card, a UUID, the same rule. Nothing about this is table-shaped.
  const card = await resolveContextualAssertionLocator(frameAnswering(oneGoodResult), payload({
    node: { tag: 'div', stableClasses: ['card-tick'] },
    candidates: [{ relationship: 'label-ancestor', targetIndex: 2,
      node: { tag: 'input', type: 'checkbox', id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        stableClasses: ['card-select'] } }],
    context: { documentId: 'doc-1', targetIndex: 3, ancestors: [
      { tag: 'div', stableClasses: ['project-card'], text: 'Quarterly revenue report for the northern region' },
    ] },
  }) as any);
  check('2: UUID id + meaningful card text yields a contextual locator',
      card?.locator === 'page.locator(".project-card").filter({ hasText: '
        + '"Quarterly revenue report for the northern region" }).locator(".card-select")',
      String(card?.locator));

  // 3 - anything that already identifies the element wins, and is not replaced.
  check('3: an authored id needs no contextual locator',
      !needsContextualLocator({ tag: 'input', id: 'issue_checkbox', stableClasses: ['bugChecked'] }));
  check('3: nor does a role with a name',
      !needsContextualLocator({ tag: 'a', role: 'link', accessibleName: 'Notifications' }));
  check('3: nor does a labelled control',
      !needsContextualLocator({ tag: 'input', accessibleName: 'Enable Notifications' }));
  check('3: but a class-only element does',
      needsContextualLocator({ tag: 'input', stableClasses: ['bugChecked'] }));
  check('3: and so does one whose only id is dynamic',
      needsContextualLocator(CHECKBOX));
  const authored = await resolveContextualAssertionLocator(frameAnswering(oneGoodResult), payload({
    candidates: [{ relationship: 'label-ancestor', targetIndex: 4,
      node: { ...CHECKBOX, id: 'issue_checkbox' } }],
  }) as any);
  check('3: so an authored-id subject is left alone entirely', authored === null, String(authored));
}

/* ------------------------------------------------------- 4-7: what it refuses */

async function checkPhraseRefusals(): Promise<void> {
  process.stdout.write('\n== 4-7 — containers that cannot identify anything ==\n');

  const withAncestors = async (list: Array<Record<string, unknown>>) =>
    resolveContextualAssertionLocator(frameAnswering(oneGoodResult), payload({
      context: { documentId: 'doc-1', targetIndex: 9, ancestors: list },
    }) as any);

  check('4: no usable phrase anywhere means no candidate',
      await withAncestors([{ tag: 'div', stableClasses: ['tabulator-row'], text: 'Row' }]) === null);
  check('4: and an ancestor with no classes at all is skipped',
      await withAncestors([{ tag: 'div', stableClasses: [], text: ROW_TEXT }]) === null);

  // 5 - the capture cuts at 120 with no marker, so the last word may be half a word.
  check('5: the phrase never includes the truncated tail',
      !String(containerPhraseFor({ text: ROW_TEXT }, gen)).includes('displayi'),
      String(containerPhraseFor({ text: ROW_TEXT }, gen)));
  check('5: and it never includes the dynamic number',
      !String(containerPhraseFor({ text: ROW_TEXT }, gen)).includes('639978'));

  // 6 - FixturePortal's table wrapper holds an inline <script> containing the account email.
  const script = 'var email_lo = "someone@example.com"; var email_domain_lo = email_lo.split';
  check('6: a script/credential-bearing container yields no phrase',
      containerPhraseFor({ text: script }, gen) === null);
  check('6: and no contextual locator',
      await withAncestors([{ tag: 'div', stableClasses: ['issues-list-container'], text: script }]) === null);
  check('6: a container whose text names a password is refused whole',
      containerPhraseFor({ text: 'password = hunter2 and several more words' }, gen) === null);

  // 7 - state classes describe a moment, not a thing.
  check('7: an ancestor with only state classes is refused',
      await withAncestors([{ tag: 'div',
        stableClasses: ['selected', 'animated', 'fadeIn', 'is-open'], text: ROW_TEXT }]) === null);
  check('7: while the same ancestor with a structural class is used',
      (await withAncestors([{ tag: 'div',
        stableClasses: ['tabulator-row', 'tabulator-selected'], text: ROW_TEXT }]))?.locator === WANTED);
}

/* ------------------------------------------------- 8-11, 14: the identity bar */

async function checkTheBar(): Promise<void> {
  process.stdout.write('\n== 8-11, 14 — the acceptance bar ==\n');
  const withResult = (result: Record<string, unknown>, answer: Record<string, unknown> = {}) =>
    resolveContextualAssertionLocator(
        frameAnswering({ results: [{ strategy: 'container-text', ...result }], ...answer }),
        payload() as any);

  check('8: several matches are refused',
      await withResult({ count: 4, identityMatched: false }) === null);
  check('8: even several matches with identity somehow set',
      await withResult({ count: 4, identityMatched: true }) === null);
  check('9: unique but a DIFFERENT element is refused',
      await withResult({ count: 1, identityMatched: false }) === null);
  check('10: a different document is refused',
      await withResult({ count: 1, identityMatched: true }, { sameDocument: false }) === null);
  check('11: missing identity is refused',
      await withResult({ count: 1 }) === null);
  check('11: an unmeasured count is refused',
      await withResult({ error: 'selector could not be evaluated' }) === null);
  check('11: a subject that is no longer in the registry is refused',
      await resolveContextualAssertionLocator(
          frameAnswering({ ...oneGoodResult, targetPresent: false }), payload() as any) === null);

  // 14 - the claim this whole phase turns on.
  const seen: any = {};
  await resolveContextualAssertionLocator(frameAnswering(oneGoodResult, seen), payload() as any);
  check('14: identity is measured against the SUBJECT slot, not the pointed one',
      seen.index === 4, `measured slot ${seen.index}, pointed slot 9`);
  check('14: and the document the picker captured travels with it',
      seen.documentId === 'doc-1', String(seen.documentId));
  check('14: the descendant is the subject\'s own selector',
      seen.candidates?.[0]?.descendant === '.bugChecked', String(seen.candidates?.[0]?.descendant));

  // 12/13 - the subject is the proven control, not the decoration.
  process.stdout.write('\n== 12-13 — the semantic subject ==\n');
  check('12: the container names the checkbox, never the span',
      WANTED.includes('.bugChecked') && !WANTED.includes('rounded-checkbox-ui'));
  const noAssociation = await resolveContextualAssertionLocator(
      frameAnswering(oneGoodResult), payload({ candidates: [] }) as any);
  check('13: with nothing proven, the pointed element is the subject and uses its own slot',
      noAssociation?.locator
        === `page.locator(".tabulator-row").filter({ hasText: ${JSON.stringify(PHRASE)} })`
          + '.locator(".rounded-checkbox-ui")', String(noAssociation?.locator));
  check('13: association is required, never assumed from being in the same container',
      noAssociation?.locator.includes('.bugChecked') === false);
}

/* ------------------------------- 15-20: registry, compatibility, hygiene */

async function checkInfrastructure(): Promise<void> {
  process.stdout.write('\n== 15-20 — registry, compatibility, hygiene ==\n');

  // 15 - registration reuses the one counter and the one release rule.
  check('15: __auraRegister exists in the generated hook',
      /window\.__auraRegister = element =>/.test(PREACTION_HOOK));
  // ONE COUNTER, ONE RELEASE RULE, and now one allocator rather than two copies of
  // the same three lines. The invariant is unchanged and the check is stronger: it
  // used to count two identical increments, which passed just as happily if the two
  // copies had drifted. A single allocator both callers go through cannot drift.
  check('15: there is exactly ONE place a slot is allocated',
      (PREACTION_HOOK.match(/nextTarget\+\+/g) ?? []).length === 1,
      String((PREACTION_HOOK.match(/nextTarget\+\+/g) ?? []).length));
  check('15: and it is the shared allocator',
      /const allocate = element => \{/.test(PREACTION_HOOK)
      && /const index = nextTarget\+\+;/.test(PREACTION_HOOK));
  // AND IT IS IDEMPOTENT PER NODE. A slot names the ELEMENT, not the event that
  // registered it, which is what gives an element a name before anything has been
  // pressed on it - the whole of the TC_LOGIN_107 fix. Without this an assertion made
  // first had no name to be tied to, while the identical assertion made after a click
  // did.
  check('15: asking twice for one node allocates once',
      /for \(let index = 0; index < targets\.length; index\+\+\)\s*\n?\s*if \(targets\[index\] === element\) return index;/
          .test(PREACTION_HOOK));
  check('15: it releases the slot MAX ago, in that one place',
      (PREACTION_HOOK.match(/targets\[index - MAX\] = null;/g) ?? []).length === 1);
  check('15: the picker\'s door allocates through it, never on its own',
      /window\.__auraRegister = element => \{[^}]*return allocate\(element\);/.test(PREACTION_HOOK));
  check('15: and so does a press',
      /const targetIndex = allocate\(element\);/.test(PREACTION_HOOK));
  check('15: it refuses anything that is not an element',
      /if \(!element \|\| element\.nodeType !== 1\) return null;/.test(PREACTION_HOOK));
  check('15: and returns an index, never a node',
      /return index;/.test(PREACTION_HOOK)
      && !/return \{ *element/.test(PREACTION_HOOK));

  // 16 - the action path is untouched.
  const pressed: CandidateMeasurement = { strategy: 'x', expression: 'y', matchCount: 1,
    identityMatched: true, sameDocument: true, measuredAt: 'press' };
  check('16: press-time action proof is unchanged', isProvenAgainstClickedTarget(pressed));
  check('16: and a pick-time measurement can NEVER promote an action',
      !isProvenAgainstClickedTarget({ ...pressed, measuredAt: 'pick' }));
  check('16: just as a press cannot stand in for a pick',
      !isProvenAtPick(pressed) && isProvenAtPick({ ...pressed, measuredAt: 'pick' }));
  check('16: pick is not an alias - the two predicates disagree on both timings',
      isProvenAgainstClickedTarget(pressed) !== isProvenAtPick(pressed));

  // 17 - a recording made before any of this still records assertions.
  check('17: no context means the ordinary path, untouched',
      await resolveContextualAssertionLocator(
          frameAnswering(oneGoodResult), payload({ context: undefined }) as any) === null);
  check('17: an empty ancestor list is the same as none',
      await resolveContextualAssertionLocator(frameAnswering(oneGoodResult),
          payload({ context: { documentId: 'd', targetIndex: 1, ancestors: [] } }) as any) === null);
  check('17: and no frame at all is survivable',
      await resolveContextualAssertionLocator(null, payload() as any) === null);
  check('17: a frame that throws does not break the recording',
      await resolveContextualAssertionLocator(
          { evaluate: async () => { throw new Error('page closed'); } }, payload() as any) === null);

  // 18/19 - what may and may not reach the persisted locator.
  const proven = await resolveContextualAssertionLocator(
      frameAnswering(oneGoodResult), payload() as any);
  check('18: the dynamic id reaches no part of the locator',
      !String(proven?.locator).includes('639978') && gen('639978'));
  check('19: only the derived phrase travels, not the captured text',
      String(proven?.locator).includes(PHRASE)
      && !String(proven?.locator).includes('periodicities')
      && !String(proven?.locator).includes(ROW_TEXT));
  check('19: the phrase is a bounded fragment of what was captured',
      PHRASE.length <= 60 && ROW_TEXT.includes(PHRASE));
  check('19: nothing writes raw ancestor text anywhere',
      !/context\.ancestors[^\n]*(writeFileSync|JSON\.stringify\(context)/.test(
          fs.readFileSync(path.resolve(ROOT, 'ai/dashboard/live-recorder.ts'), 'utf8')));

  // 20 - hygiene.
  check('20: the locator is composition, not XPath',
      String(proven?.locator).includes('.filter({ hasText:')
      && !/xpath|\/\/|::/.test(String(proven?.locator)));
  for (const [label, pattern] of [
    ['first()', /\.first\(\)/], ['nth(', /\.nth\(/], ['force', /force:/],
    ['dispatchEvent', /dispatchEvent/], ['mouse', /\bmouse\./],
    ['waitForTimeout', /waitForTimeout/], ['setTimeout', /setTimeout/],
  ] as Array<[string, RegExp]>) {
    check(`20: the picker's context capture uses no ${label}`,
        !pattern.test(ASSERTION_PICKER.slice(ASSERTION_PICKER.indexOf('const contextOf'),
            ASSERTION_PICKER.indexOf('const associatedCandidates'))));
  }
  check('20: and the picker still never acts on the page',
      !/\.click\(\)|\.check\(\)|element\.focus\(\)|dispatchEvent/.test(
          ASSERTION_PICKER.replace(/pill\.addEventListener[\s\S]*?\}\);/, '')));
}

/* ------------------------------------------------------------------ mutations */

async function checkMutations(): Promise<void> {
  process.stdout.write('\n== mutation — every guard is load-bearing ==\n');
  const wrong: CandidateMeasurement = { strategy: 'container-text', expression: WANTED,
    matchCount: 1, identityMatched: false, sameDocument: true, measuredAt: 'pick' };

  check('mutation: removing identity would accept another row\'s checkbox',
      !isProvenAtPick(wrong) && wrong.matchCount === 1 && wrong.sameDocument === true,
      'unique and same-document, yet the wrong element');
  check('mutation: accepting unique-but-wrong would emit it',
      await resolveContextualAssertionLocator(frameAnswering(
          { results: [{ strategy: 'container-text', count: 1, identityMatched: false }] }),
      payload() as any) === null);
  check('mutation: removing the same-document check would accept a stale page',
      !isProvenAtPick({ ...wrong, identityMatched: true, sameDocument: false }));
  check('mutation: allowing dynamic ids would put #639978 back',
      gen('639978') && !String(WANTED).includes('639978'));
  check('mutation: removing phrase filtering would put the row number in the locator',
      containerPhraseFor({ text: ROW_TEXT }, gen) !== ROW_TEXT.slice(0, 60));
  check('mutation: removing the sensitive filter would put an email in the locator',
      containerPhraseFor({ text: 'var email_lo = "someone@example.com"; var domain' }, gen) === null);
  check('mutation: without __auraRegister no index exists, so nothing is measurable',
      await resolveContextualAssertionLocator(frameAnswering(oneGoodResult), payload({
        candidates: [{ relationship: 'label-ancestor', node: CHECKBOX, targetIndex: null }],
        context: { documentId: 'd', targetIndex: null, ancestors: ancestors() },
      }) as any) === null);

  // The subtlest one: measuring the pointed element instead of the subject.
  const seen: any = {};
  await resolveContextualAssertionLocator(frameAnswering(oneGoodResult, seen), payload() as any);
  check('mutation: swapping subject identity for interaction identity would measure slot 9',
      seen.index === 4 && seen.index !== 9,
      `the subject is slot ${seen.index}; the pointed span is slot 9`);
}

async function main(): Promise<void> {
  await checkApplies();
  await checkPhraseRefusals();
  await checkTheBar();
  await checkInfrastructure();
  await checkMutations();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
