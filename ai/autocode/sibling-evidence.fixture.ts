import '../testing/isolated-checkout';
/**
 * What sibling evidence is for, and what it is NOT for.
 *
 *   npx tsx ai/autocode/sibling-evidence.fixture.ts
 *
 * Offline: no browser, no model, no network. It writes nothing anywhere.
 *
 * WHY THIS EXISTS
 *
 * Two opposite mistakes are both easy to make about siblings, and this file exists to
 * make each of them fail loudly.
 *
 * THE FIRST IS DELETING THEM. An audit that reads only `candidateSelectorsFor` concludes
 * that nothing consumes sibling evidence - and that conclusion is wrong. `associatedToggle`
 * in `ai/dashboard/recorder.ts` reads the sibling list to prove that a click on a custom
 * toggle's visible part and a state assertion are about the same control: FixturePortal's
 * `label > span.rounded-checkbox-ui` beside `input.bugChecked`. Measured over the corpus,
 * 98 targets across 60 distinct recordings have exactly that shape. Deleting the capture
 * to save 199 bytes a target would break every one of them.
 *
 * THE SECOND IS BUILDING A LOCATOR STRATEGY ON THEM. Measured, read-only, with the
 * existing proof model and no relaxed acceptance:
 *
 *   - of 401 form-control targets, the number immediately preceded by a <label> is ZERO.
 *     The `<label>Text</label><input>` shape this would exist to serve does not occur.
 *     What follows an input here is `<i>` (202) and `<span>` (185) - Material Design
 *     icons and ripple spans.
 *   - 114 targets have an adjacent sibling that names itself, 102 of those have no proven
 *     candidate, 71 of THOSE are the recorder's own overlay, 26 of the remainder already
 *     carry an authored id, and the last 5 already generate 20-23 candidates each. The
 *     number with no candidate of any kind is ZERO.
 *   - measured live against both applications: 7 targets, 1 sibling candidate built, 1
 *     proven - on a target where production had already proven 2. Targets where a sibling
 *     candidate would be the FIRST proven locator: ZERO.
 *
 * So the capture stays and the strategy does not get built. Both halves are pinned below.
 */

import fs from 'node:fs';
import path from 'node:path';

import { candidateSelectorsFor, type RelatedNode } from './dom-evidence';
import { analyseIdentifier } from './locator-quality';
import { resolveAssertionSubject } from '../dashboard/associated-control';

const ROOT = process.cwd();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const isGenerated = (value: string) => analyseIdentifier(value).dynamic;

/* ================================ A - siblings ARE consumed, just not for locators */

function checkConsumer(): void {
  section('A - sibling evidence has a real consumer: assertion subject resolution');

  // A synthetic custom toggle: the person clicks the visible span,
  // and the state lives on a 0x0 input beside it, both inside a <label>.
  const clicked = { tag: 'span', stableClasses: ['rounded-checkbox-ui'] };
  const control = {
    tag: 'input', type: 'checkbox', stableClasses: ['bugChecked'],
    relationship: 'next-sibling', depth: 1,
  } as unknown as RelatedNode;

  const subject = resolveAssertionSubject(clicked as never, [
    { relationship: 'label-ancestor', node: control },
  ] as never);
  check('A: a checkable sibling inside a label resolves to the control that holds the state',
      Boolean(subject) && subject!.node === control, String(subject?.semantics));

  // WITHOUT the sibling there is nothing to resolve to. This is the whole argument
  // against deleting the capture, stated as a behaviour rather than as a count.
  const nothing = resolveAssertionSubject(clicked as never, [] as never);
  check('A: with no sibling offered, nothing resolves - the association is gone',
      !nothing, String(nothing?.semantics));

  // And the recorder really does build that list from the captured siblings.
  const recorder = fs.readFileSync(path.join(ROOT, 'ai', 'dashboard', 'recorder.ts'), 'utf8');
  check('A: the recorder reads previousSiblings and nextSiblings to build it',
      /const siblings = \[\.\.\.\(clicked\.previousSiblings \?\? \[\]\), \.\.\.\(clicked\.nextSiblings \?\? \[\]\)\]/
          .test(recorder));
  check('A: and hands the result to the association resolver, not to a second heuristic',
      /resolveAssertionSubject\(clicked\.target, \[\s*\n?\s*\{ relationship: 'label-ancestor', node: control \}/
          .test(recorder));
}

/* ============================= B - and they are NOT a locator source */

function checkNoLocatorStrategy(): void {
  section('B - no candidate is generated from a sibling, deliberately');

  const base = {
    target: { tag: 'i', stableClasses: ['material-icons'] },
    parent: { tag: 'div', stableClasses: ['login-input-group'] },
    ancestors: [{ tag: 'form', id: 'loginForm', relationship: 'ancestor', depth: 1 }],
    descendants: [], previousSiblings: [], nextSiblings: [],
  };
  const withSiblings = {
    ...base,
    previousSiblings: [{
      tag: 'input', id: 'password_field', type: 'password',
      relationship: 'previous-sibling', depth: 1,
    }],
    nextSiblings: [{
      tag: 'span', id: 'password_hint', text: 'Show', relationship: 'next-sibling', depth: 1,
    }],
  };

  const without = candidateSelectorsFor(base as never, isGenerated).map(entry => entry.expression);
  const with_ = candidateSelectorsFor(withSiblings as never, isGenerated).map(entry => entry.expression);
  check('B: adding siblings changes nothing about what is generated',
      JSON.stringify(without) === JSON.stringify(with_),
      `${without.length} vs ${with_.length}`);
  check('B: no candidate uses an adjacent-sibling combinator',
      !with_.some(expression => /\s\+\s|:has\(\s*\+/.test(expression)),
      with_.filter(expression => /\s\+\s|:has\(\s*\+/.test(expression)).join(' | ') || 'none');
  check('B: and no candidate mentions a sibling\'s id',
      !with_.some(expression => expression.includes('password_hint')),
      with_.filter(expression => expression.includes('password_hint')).join(' | ') || 'none');

  // THE HAZARD A SIBLING STRATEGY WOULD HAVE INTRODUCED, and the reason "just scope by
  // the sibling's id" is not safe. A synthetic target sits beside `#tooltip<digits>`, and
  // the dynamic-identifier detector does NOT flag it - there is no separator before the
  // digits, so it reads as authored. A sibling strategy would have pinned a locator to one
  // tooltip instance that will not exist on the next run, and nothing would have refused it.
  check('B: #tooltip772416 is NOT detected as a generated id',
      isGenerated('tooltip772416') === false);
  check('B: while the separator form IS', isGenerated('tc_summary_636432') === true);
  check('B: so a sibling-scoped locator could be pinned to one record without any refusal',
      isGenerated('tooltip772416') === false && isGenerated('tooltip691450') === false);
}

/* =================================== C - direct target and association boundaries */

function checkAssociationBoundaries(): void {
  const control = { tag: 'input', type: 'checkbox', id: 'own-control' };
  const own = resolveAssertionSubject(control as never, [] as never);
  check('C: a checkable target retains its own state without association', own === null);
  check('C: a checkable target cannot acquire a sibling control state',
      resolveAssertionSubject(control as never, [{ relationship: 'label-ancestor',
        node: { tag: 'input', type: 'checkbox', id: 'another-control' } }] as never) === null);
  check('C: an ordinary sibling does not become a checkable subject',
      !resolveAssertionSubject({ tag: 'span' } as never, [
        { relationship: 'label-ancestor', node: { tag: 'span', text: 'On' } },
      ] as never));
}


/* ------------------------------------------------------------------- main */

function main(): void {
  checkConsumer();
  checkNoLocatorStrategy();
  checkAssociationBoundaries();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
