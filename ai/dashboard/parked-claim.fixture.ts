/**
 * A press is claimed whatever shape Codegen wrote the locator in.
 *
 *   npx tsx ai/dashboard/parked-claim.fixture.ts
 *
 * THE GRAPHS HERE COME FROM THE CAPTURE CONTRACT, NOT FROM THE SELECTOR. That
 * distinction is the entire reason this file was rewritten.
 *
 * `dom-capture-source.ts` keeps an ancestor only when it is a CONTAINERS tag, carries
 * a `role`, or has an `id`:
 *
 *     CONTAINERS.indexOf(tag) >= 0 || getAttribute('role') || current.id
 *
 * Bugasura's row checkbox is `span.rounded-checkbox-ui` inside
 * `label.rounded-checkbox-cont` inside `div.tabulator-cell.tabulator-cell--checkbox`
 * inside `div#tr_1749558.tabulator-row`. A plain div and a label satisfy none of the
 * three conditions, so the cell is recorded NOWHERE and the label survives only as
 * `parent`. The first version of this fixture invented a `tabulator-cell` ancestor -
 * it was written from the selector - so it passed while every real recording failed.
 * `ROW_GRAPH` below is what the recorder actually produces, checked against the
 * sidecars of TC_LOGIN_089/090/091 and TC_DASHBOARD_011.
 *
 * WHAT THE FIX CHANGED. Container IDs stay REQUIRED - they are always recordable, so
 * a missing one means a different row. Container CLASSES corroborate, because their
 * absence is a fact about the capture rather than about the page. The FINAL compound
 * still has to match the pressed element in full.
 *
 * NOTHING HERE RELAXES A GATE. Claiming a press is what makes press-time evidence
 * available; whether it is good enough is still decided afterwards by matchCount,
 * identityMatched, sameDocument and measuredAt. Check D/E/F pins that.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as path from 'path';

import { claimParkedEntry } from './live-recorder';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* ------------------------------------------------- the real capture contract ---- */

/**
 * A parked press on a row checkbox, shaped exactly as `dom-capture-source.ts` builds
 * it: `parent` is whatever the element sits in, `ancestors` holds only id-bearing /
 * role-bearing / CONTAINERS nodes. The cell is absent because it is a plain div.
 */
const rowPress = (rowId: string, member: string | string[] = 'rounded-checkbox-ui') => ({
  at: Date.now(), kind: 'pointerdown', documentId: 'doc-1', targetIndex: 0,
  // EVERY STABLE CLASS THE ELEMENT CARRIES, not just the first one.
  //
  // A real press parks the whole list, and a compound selector can name more than one
  // of them: TC_LOGIN_115 recorded a click on the table CELL, whose tail is
  // `.tabulator-cell.tabulator-cell--checkbox`. Modelling that press with only
  // `stableClasses[0]` built an element the selector does not describe, and the claim
  // correctly refused it - a fixture failure reported as a production one. Verified
  // both ways: with one class `claimParkedEntry` returns null, with both it claims.
  fingerprint: { tag: 'span', stableClasses: [member].flat() },
  graph: {
    target: { tag: 'span', stableClasses: [member].flat() },
    parent: { tag: 'label', stableClasses: ['rounded-checkbox-cont'] },
    ancestors: [
      { tag: 'div', id: rowId, stableClasses: ['tabulator-row', 'animated', 'fadeIn'] },
      { tag: 'div', id: 'bugReport-table', stableClasses: ['issues-list-container', 'tabulator'] },
      { tag: 'div', id: 'switch_issue_view', stableClasses: ['col-xs-12'] },
    ],
  },
});

/** The same press as the recorder parks it for the checkbox INPUT (the assertion subject). */
const inputPress = (rowId: string, inputId: string) => ({
  at: Date.now(), kind: 'pointerdown', documentId: 'doc-1', targetIndex: 1,
  fingerprint: { tag: 'input', id: inputId, stableClasses: ['bugChecked'] },
  graph: {
    target: { tag: 'input', id: inputId, stableClasses: ['bugChecked'] },
    parent: { tag: 'label', stableClasses: ['rounded-checkbox-cont'] },
    ancestors: [{ tag: 'div', id: rowId, stableClasses: ['tabulator-row'] }],
  },
});

const ACTION = "page.locator('#tr_1749558 > .tabulator-cell.tabulator-cell--checkbox "
  + "> .rounded-checkbox-cont > .rounded-checkbox-ui')";
const ASSERTION = 'page.locator(\'[id="1749558"]\')';

/* ------------------------------- the contract this fixture is written against ---- */

function checkContract(): void {
  process.stdout.write('\n== the capture contract, read from the source ==\n');
  const source = fs.readFileSync(path.join(ROOT, 'ai/autocode/dom-capture-source.ts'), 'utf8');

  // If this condition ever changes, the graphs above stop being representative and
  // every check below becomes a statement about a fiction. Pin it.
  check('an ancestor is kept only when it is a CONTAINERS tag, has a role, or has an id',
      /CONTAINERS\.indexOf\(current\.tagName\.toLowerCase\(\)\)\s*>=\s*0\s*\|\|\s*current\.getAttribute\('role'\)\s*\|\|\s*current\.id/
          .test(source));
  const containers = /const CONTAINERS = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
  check('and neither "div" nor "label" is a CONTAINERS tag - the two the row checkbox sits in',
      !/'div'/.test(containers) && !/'label'/.test(containers), containers.slice(0, 72));
  check('so a plain-div ancestor is unrecordable, which is why classes cannot be required',
      !JSON.stringify(rowPress('tr_1').graph).includes('tabulator-cell'));
}

/* ------------------------------------------------- A / B: the asymmetry ---- */

function checkAsymmetry(): void {
  process.stdout.write('\n== the same press, either shape Codegen writes ==\n');

  const action = claimParkedEntry([rowPress('tr_1749558')], ACTION);
  check('A: a compound CSS action selector claims the parked element',
      Boolean(action), action ? 'claimed' : 'UNCLAIMED - the defect');
  check('A: and it claimed the element the person pressed',
      action?.graph?.target?.stableClasses?.includes('rounded-checkbox-ui') === true);

  const assertion = claimParkedEntry([inputPress('tr_1749558', '1749558')], ASSERTION);
  check('B: the attribute-selector assertion still claims, exactly as before',
      Boolean(assertion), assertion ? 'claimed' : 'UNCLAIMED');

  const both = [inputPress('tr_1749558', '1749558'), rowPress('tr_1749558')];
  check('A/B: action and assertion each claim their own press from one recording',
      Boolean(claimParkedEntry(both, ACTION)) && Boolean(claimParkedEntry(both, ASSERTION)));
}

/* ------------------------------------- C-F: the gates the claim feeds ---- */

function checkGatesStillApply(): void {
  process.stdout.write('\n== claiming a press is not the same as passing the gates ==\n');

  const claimed = claimParkedEntry([rowPress('tr_1749558')], ACTION);
  check('C: a claimed press carries the document it was parked in',
      claimed?.documentId === 'doc-1', 'measuredAt/sameDocument are derived from this');
  check('C: and the graph the page parked, not one re-read afterwards',
      Boolean(claimed?.graph?.ancestors?.length));

  const { isProvenAgainstClickedTarget } = require('../autocode/dom-evidence') as
    typeof import('../autocode/dom-evidence');
  check('D/E/F: the proof bar is untouched - all four still required',
      isProvenAgainstClickedTarget({ strategy: 's', expression: 'e', matchCount: 1,
        identityMatched: true, sameDocument: true, measuredAt: 'press' } as never) === true);
  for (const [label, over] of [
    ['measuredAt claim', { measuredAt: 'claim' }],
    ['identityMatched false', { identityMatched: false }],
    ['identityMatched unstated', { identityMatched: undefined }],
    ['sameDocument false', { sameDocument: false }],
    ['matchCount 2', { matchCount: 2 }],
  ] as Array<[string, Record<string, unknown>]>) {
    check(`D/E/F: ${label} is still refused`,
        isProvenAgainstClickedTarget({ strategy: 's', expression: 'e', matchCount: 1,
          identityMatched: true, sameDocument: true, measuredAt: 'press', ...over } as never) === false);
  }
}

/* ------------------------------------------- G: wrong row, wrong element ---- */

function checkWrongTarget(): void {
  process.stdout.write('\n== the rejections that must survive the fix ==\n');

  check('G: no parked entries at all -> no claim',
      claimParkedEntry([], ACTION) === null);
  check('G: a parked press on a DIFFERENT element in the right row -> no claim',
      claimParkedEntry([rowPress('tr_1749558', 'some-other-control')], ACTION) === null,
      'the final compound names .rounded-checkbox-ui, which that node does not carry');

  // WRONG-ROW PROTECTION. The id is the half that stayed mandatory, and this is the
  // check that says so. It must fail for EVERY other row, not just one.
  for (const other of ['tr_999999', 'tr_1749559', 'tr_637446', 'tr_1'])
    check(`G: the same checkbox in row ${other} -> no claim`,
        claimParkedEntry([rowPress(other)], ACTION) === null);
  check('G: and with no row ancestor at all -> no claim',
      claimParkedEntry([{ ...rowPress('tr_1749558'), graph: {
        target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
        parent: { tag: 'label', stableClasses: ['rounded-checkbox-cont'] }, ancestors: [],
      } }], ACTION) === null, 'the required id is not satisfied by anything');
  check('G: an unclaimed action therefore keeps claim-time evidence and stays NEEDS_REVIEW',
      claimParkedEntry([], ACTION) === null, 'no press-time proof can be manufactured here');

  // An id-less compound cannot claim on containment evidence of nothing.
  const idless = "page.locator('.tabulator-cell > .rounded-checkbox-cont > .rounded-checkbox-ui')";
  check('G: an id-less compound whose containers are all unrecordable -> no claim',
      claimParkedEntry([{ ...rowPress('tr_1749558'), graph: {
        target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] }, ancestors: [],
      } }], idless) === null, 'no id named, and no class corroborated');
  check('G: but an id-less compound WITH a corroborating container does claim',
      Boolean(claimParkedEntry([rowPress('tr_1749558')], idless)),
      'the parent carries .rounded-checkbox-cont');
}

/* --------------------------------- the shapes that already worked, unchanged ---- */

function checkExistingShapesUnchanged(): void {
  process.stdout.write('\n== the shapes that already worked are untouched ==\n');

  const bareId = { at: 1, kind: 'pointerdown', documentId: 'doc-1', targetIndex: 0,
    fingerprint: { tag: 'a', id: 'notif_bell_trigger' },
    graph: { target: { tag: 'a', id: 'notif_bell_trigger' }, ancestors: [] } };
  check('bare #id still claims', Boolean(claimParkedEntry([bareId], "page.locator('#notif_bell_trigger')")));

  const bareClass = { at: 1, kind: 'pointerdown', documentId: 'doc-1', targetIndex: 0,
    fingerprint: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
    graph: { target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] }, ancestors: [] } };
  check('bare .class still claims', Boolean(claimParkedEntry([bareClass], "page.locator('.rounded-checkbox-ui')")));

  const role = { at: 1, kind: 'pointerdown', documentId: 'doc-1', targetIndex: 0,
    fingerprint: { tag: 'button', role: 'button', accessibleName: 'Notification settings' },
    graph: { target: { tag: 'button', role: 'button', accessibleName: 'Notification settings' }, ancestors: [] } };
  check('getByRole still claims',
      Boolean(claimParkedEntry([role], "page.getByRole('button', { name: 'Notification settings' })")));

  check('[id="…"] still claims',
      Boolean(claimParkedEntry([inputPress('tr_1', '1749558')], ASSERTION)));

  const text = { at: 1, kind: 'pointerdown', documentId: 'doc-1', targetIndex: 0,
    fingerprint: { tag: 'span', text: 'Line Chart. Data labels' },
    graph: { target: { tag: 'span', text: 'Line Chart. Data labels' }, ancestors: [] } };
  check('getByText prose is matched whole, never split into tokens',
      Boolean(claimParkedEntry([text], "page.getByText('Line Chart. Data labels')")));

  check('a locator with no literal still claims nothing',
      claimParkedEntry([bareClass], 'page.locator()') === null);
  check('a selector carrying an attribute is left whole, as before',
      claimParkedEntry([bareClass], "page.locator('.cell [data-x=\"1\"] .rounded-checkbox-ui')") === null);

  // A generated id in the SELECTOR is still just a literal here; the dynamic-id
  // refusal lives downstream in locator-quality/validate and is unaffected.
  const { analyseIdentifier } = require('../autocode/locator-quality') as
    typeof import('../autocode/locator-quality');
  check('dynamic-id detection is untouched by any of this',
      analyseIdentifier('tr_1749558').dynamic === true
      && analyseIdentifier('loginForm').dynamic === false);
}

/* ---------------------------------------- the real corpus, end to end ---- */

function checkRealCorpus(): void {
  process.stdout.write('\n== the five real recordings this fix exists for ==\n');
  const dir = path.join(ROOT, 'ai/dashboard/recordings');
  let compound = 0;
  let claimable = 0;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.evidence.json'))) {
    const body = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as
      {
        targets?: Array<{
          locator?: string; ancestors?: Array<{ id?: string }>;
          target?: { stableClasses?: string[] };
        }>;
      };
    for (const target of body.targets ?? []) {
      const selector = /locator\((['"])(.*?)\1\)/.exec(String(target.locator ?? ''))?.[2] ?? '';
      if (!/[>]/.test(selector) || /["'[\]()]/.test(selector))
        continue;
      compound++;
      const rowId = (target.ancestors ?? []).map(a => a.id).find(Boolean);
      // THE PRESSED ELEMENT COMES FROM THE SIDECAR, not from an assumption. One of
      // these six is a press on the LABEL (`.rounded-checkbox-cont`) rather than the
      // span inside it, and hard-coding the span made the replay build the wrong node
      // and report a production failure that was really a fixture failure. Reading it
      // back is the same discipline this whole file was rewritten for.
      const pressed = target.target?.stableClasses ?? [];
      if (!rowId || !pressed.length)
        continue;
      if (claimParkedEntry([rowPress(rowId, pressed)], String(target.locator)))
        claimable++;
    }
  }
  check('every compound-CSS target in the corpus can now claim its row press',
      compound > 0 && claimable === compound, `${claimable} of ${compound}`);
}

function main(): void {
  checkContract();
  checkAsymmetry();
  checkGatesStillApply();
  checkWrongTarget();
  checkExistingShapesUnchanged();
  checkRealCorpus();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
