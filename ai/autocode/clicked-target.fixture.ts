/**
 * P0.7 — an ambiguous recorded action is settled by the element the person CLICKED.
 *
 *   npx tsx ai/autocode/clicked-target.fixture.ts
 *
 * Offline: no browser, no model, no network. The browser-side half is exercised by
 * running the GENERATED hook string against a stub DOM, for the same reason
 * `preaction-claim.fixture.ts` does it - reading the source proves nothing about what
 * reaches the page.
 *
 * WHAT THIS PINS
 *
 * Three situations that look identical in a schema-8 sidecar and must never again be
 * treated the same:
 *
 *   1. SAFE     the person clicked A, a candidate matched exactly one element, and
 *               that element is A, in the document of the press          -> resolve
 *   2. UNSAFE   a candidate matched exactly one element, and it is B     -> refuse
 *   3. UNKNOWN  the measurement happened after the document changed      -> refuse
 *
 * TC_LOGIN_060 is case 2 with a count of 1 on every candidate: four alternatives,
 * each measured at exactly one element, all of them on the page the click had already
 * navigated to. A rule that promotes "matchCount === 1" promotes all four.
 */

import {
  candidateSelectorsFor, isProvenAgainstClickedTarget, sanitiseEvidence,
  type CandidateMeasurement, type TargetEvidence,
} from './dom-evidence';
import { assessLocator } from './locator-quality';
import { PREACTION_HOOK } from './dom-capture-source';
import { claimParkedEntry } from '../dashboard/live-recorder';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* ------------------------------------------------------------- a stub DOM */

/**
 * Enough DOM to run the real `__auraMeasure` against: ids, classes, tags, text,
 * descendant selectors and object identity. Deliberately small - it exists to let the
 * measurement be tested, not to reimplement a browser.
 */
class Node {
  tag: string;
  id: string;
  classList: string[];
  own: string;
  children: Node[] = [];
  nodeType = 1;

  constructor(tag: string, options: { id?: string; classes?: string[]; text?: string } = {}) {
    this.tag = tag;
    this.id = options.id ?? '';
    this.classList = options.classes ?? [];
    this.own = options.text ?? '';
  }

  add(child: Node): Node {
    this.children.push(child);
    return this;
  }

  get textContent(): string {
    return [this.own, ...this.children.map(child => child.textContent)].join(' ').replace(/\s+/g, ' ').trim();
  }

  descendants(): Node[] {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }

  matchesCompound(compound: string): boolean {
    const parts = compound.match(/[#.]?[A-Za-z0-9_-]+/g) ?? [];
    return parts.every(part => {
      if (part.startsWith('#'))
        return this.id === part.slice(1);
      if (part.startsWith('.'))
        return this.classList.includes(part.slice(1));
      return part === '*' || this.tag === part;
    });
  }

  querySelectorAll(selector: string): Node[] {
    if (selector === '*')
      return this.descendants();
    const compounds = selector.trim().split(/\s+/);
    let scope: Node[] = [this];
    for (const compound of compounds) {
      const next: Node[] = [];
      for (const node of scope) {
        for (const candidate of node.descendants()) {
          if (candidate.matchesCompound(compound) && !next.includes(candidate))
            next.push(candidate);
        }
      }
      scope = next;
    }
    return scope;
  }
}

/** The /apps screen as TC_LOGIN_063 recorded it, plus the copy that made it ambiguous. */
function bugasuraApps(): { document: any; clicked: Node; twin: Node; title: Node } {
  const clicked = new Node('span', { classes: ['title', 'handel-over-flow'], text: 'Faclon labs' });
  const title = new Node('h4', { classes: ['handel-over-flow', 'answer__reports-title'] }).add(clicked);
  const other = new Node('h4', { classes: ['handel-over-flow', 'answer__reports-title'] })
      .add(new Node('span', { classes: ['title', 'handel-over-flow'], text: 'Sundyne' }));
  const allApps = new Node('div', { id: 'all_apps', classes: ['answer__reports', 'tab-pane', 'active'] })
      .add(title).add(other);
  // The SAME project, listed again under another tab. Every one of those tabs is in
  // the DOM at all times, which is what makes a page-wide getByText ambiguous.
  const twin = new Node('span', { classes: ['title', 'handel-over-flow'], text: 'Faclon labs' });
  const teamApps = new Node('div', { id: 'team_apps', classes: ['answer__reports', 'tab-pane'] })
      .add(new Node('h4', { classes: ['handel-over-flow', 'answer__reports-title'] }).add(twin));
  const body = new Node('body')
      .add(new Node('div', { id: 'platform_tab_container' }).add(allApps).add(teamApps));
  return { document: { body, querySelectorAll: (s: string) => body.querySelectorAll(s) }, clicked, twin, title };
}

/** Install the GENERATED hook into a fake window, and hand back its measure function. */
function installHook(document: any): any {
  const window: any = {};
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', PREACTION_HOOK)(window, {
    ...document,
    addEventListener: () => {},
  });
  return window;
}

/* --------------------------------------------------------------- fixtures */

const CLICKED_SPAN = "page.locator(\"#all_apps .title\").filter({ hasText: \"Faclon labs\" })";

function evidence(overrides: Partial<TargetEvidence>): TargetEvidence {
  return {
    locator: "page.getByText('Faclon labs')",
    target: { tag: 'span', stableClasses: ['title', 'handel-over-flow'], text: 'Faclon labs' },
    parent: { tag: 'h4', stableClasses: ['handel-over-flow', 'answer__reports-title'], text: 'Faclon labs' },
    ancestors: [{ tag: 'div', id: 'all_apps', relationship: 'ancestor', depth: 9 }],
    children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: ['parent', 'ancestor'],
    // The count that used to block this case: taken 400ms later, on the page the
    // click had arrived at. Refused as evidence about the press.
    matchCount: null,
    matchCountDocument: 'other',
    captureTiming: 'before-action',
    documentId: 'doc-press',
    pressTimeText: { text: 'Faclon labs', matchCount: 2, identityMatched: true },
    ...overrides,
  };
}

const proven = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'scoped-class-text', expression: CLICKED_SPAN, matchCount: 1,
  identityMatched: true, sameDocument: true, measuredAt: 'press', ...over,
});

/* ----------------------------------------------------------------- checks */

function caseOneSafe(): void {
  process.stdout.write('\n== 1 — the exact clicked target + a unique candidate: RESOLVE ==\n');
  const verdict = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    evidence: evidence({ derivedCandidates: [proven()] }),
  });
  check('1: NORMALIZED_LOCATOR', verdict.outcome === 'NORMALIZED_LOCATOR', verdict.outcome);
  check('1: names the clicked-target strategy',
      verdict.strategy === 'disambiguated-by-clicked-target', verdict.strategy);
  check('1: emits the measured candidate', verdict.expression === CLICKED_SPAN, String(verdict.expression));
  check('1: the reason says the identity was checked',
      /identity checked, not inferred/.test(verdict.reason), verdict.reason.slice(0, 120));
  check('1: the reason states the press-time ambiguity it settled',
      /identified 2 elements in the page at the moment it was pressed/.test(verdict.reason));

  process.stdout.write('   the same rule, when the ambiguity was measured on the locator itself\n');
  const claimCounted = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    evidence: evidence({
      matchCount: 2, matchCountDocument: 'same', pressTimeText: undefined,
      derivedCandidates: [proven()],
    }),
  });
  check('1: a claim-time count of 2 is settled the same way',
      claimCounted.outcome === 'NORMALIZED_LOCATOR' && claimCounted.expression === CLICKED_SPAN,
      claimCounted.outcome);
}

function caseTwoAmbiguousCandidate(): void {
  process.stdout.write('\n== 2 — the exact clicked target + an AMBIGUOUS candidate: NEEDS_REVIEW ==\n');
  const verdict = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    evidence: evidence({
      derivedCandidates: [],
      candidatesTried: 3,
      rejectedCandidates: [
        { strategy: 'scoped-class-text', expression: CLICKED_SPAN, matchCount: 2,
          sameDocument: true, measuredAt: 'press', rejectionReason: 'matched 2 elements' },
        { strategy: 'scoped-tag', expression: 'page.locator("#all_apps span")', matchCount: 6,
          sameDocument: true, measuredAt: 'press', rejectionReason: 'matched 6 elements' },
        { strategy: 'class', expression: 'page.locator(".title")', matchCount: 9,
          sameDocument: true, measuredAt: 'press', rejectionReason: 'matched 9 elements' },
      ],
    }),
  });
  check('2: NEEDS_REVIEW', verdict.outcome === 'NEEDS_REVIEW', verdict.outcome);
  check('2: nothing is emitted', verdict.expression === null, String(verdict.expression));
  check('2: refuses first()/nth() explicitly',
      /would pick an element nobody chose/.test(verdict.reason));
  check('2: says how many were actually tried',
      /3 alternative\(s\) were built from its surroundings and measured/.test(verdict.reason),
      verdict.reason.slice(-160));
  check('2: never reports "0 alternative(s)"', !/\b0 alternative/.test(verdict.reason));
}

function caseThreeWrongElement(): void {
  process.stdout.write('\n== 3 — a unique candidate that matched a DIFFERENT element: NEEDS_REVIEW ==\n');
  const wrong = proven({
    strategy: 'scoped-parent-class',
    expression: 'page.locator("#all_apps .answer__reports-title")',
    matchCount: 1, identityMatched: false,
  });
  check('3: the shared predicate refuses it', !isProvenAgainstClickedTarget(wrong));
  const verdict = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    // Handed in as if it had survived into the promotable list, which is the shape a
    // careless producer would write. The resolver must refuse it on its own.
    evidence: evidence({ derivedCandidates: [wrong], candidatesTried: 1 }),
  });
  check('3: NEEDS_REVIEW', verdict.outcome === 'NEEDS_REVIEW', verdict.outcome);
  check('3: the wrong element is never emitted',
      verdict.expression === null && !JSON.stringify(verdict.candidates).includes('answer__reports-title'),
      String(verdict.expression));

  process.stdout.write('   and the funnel drops it before it can ever be read back\n');
  const funnelled = sanitiseEvidence([evidence({ derivedCandidates: [wrong, proven()] })],
      '2026-08-15T00:00:00.000Z');
  const kept = funnelled.targets[0].derivedCandidates ?? [];
  check('3: sanitise keeps only the proven one',
      kept.length === 1 && kept[0].expression === CLICKED_SPAN, JSON.stringify(kept.map(c => c.strategy)));
}

function caseFourOtherDocument(): void {
  process.stdout.write('\n== 4 — measured in a DIFFERENT document: NEEDS_REVIEW ==\n');
  const elsewhere = proven({ sameDocument: false });
  check('4: the shared predicate refuses it', !isProvenAgainstClickedTarget(elsewhere));
  const verdict = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    evidence: evidence({ derivedCandidates: [elsewhere], candidatesTried: 1 }),
  });
  check('4: NEEDS_REVIEW', verdict.outcome === 'NEEDS_REVIEW', verdict.outcome);
  check('4: nothing from the other document is emitted', verdict.expression === null);

  process.stdout.write('   a count taken in the new document is not evidence about the old click\n');
  const signIn = evidence({
    locator: "page.getByRole('button', { name: 'Sign In', exact: true })",
    matchCount: null, matchCountDocument: 'other', pressTimeText: undefined,
    target: { tag: 'button', text: 'Sign In' }, parent: undefined,
  });
  check('4: matchCount stays null rather than becoming 0', signIn.matchCount === null);
  const stillFine = assessLocator({
    locator: "page.getByRole('button', { name: 'Sign In', exact: true })",
    target: 'Sign In', kind: 'action', evidence: signIn,
  });
  check('4: a good locator is NOT blocked by a document change',
      stillFine.outcome !== 'NEEDS_REVIEW' && stillFine.expression !== null,
      `${stillFine.outcome} ${stillFine.expression}`);
  check('4: and it is emitted unchanged',
      stillFine.expression === "page.getByRole('button', { name: 'Sign In', exact: true })");
}

function caseFiveNoEvidence(): void {
  process.stdout.write('\n== 5 — no live evidence: the offline path, unchanged ==\n');
  const offline = assessLocator({
    locator: "page.locator('#tc_summary_637609')", target: 'summary', kind: 'action',
  });
  check('5: a generated id is still refused offline',
      offline.outcome === 'NEEDS_REVIEW' && offline.expression === null, offline.outcome);
  check('5: and still says to record it live',
      /RECORDER_TRANSPORT=live/.test(offline.reason));
  const plainText = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
  });
  // THIS CHECK REVERSED, DELIBERATELY. It was written to pin that P0.7 did not change
  // the offline path, and it was right at the time. A later rule DID change it, on
  // purpose: an unscoped text locator whose uniqueness nothing measured is refused now - TC_LOGIN_096 shipped one and Playwright rejected it at run time, "resolved to 3 elements". P0.7 is still not the thing that changed it - which is what this case
  // is really about - so the case survives, asserting the current contract.
  check('5: an unmeasured text locator is now REFUSED, not emitted',
      plainText.outcome === 'NEEDS_REVIEW' && plainText.expression === null,
      `${plainText.outcome} / ${plainText.expression}`);
  check('5: and the refusal is about the missing measurement, not about P0.7',
      /never measured|identified \d+ elements/.test(plainText.reason), plainText.reason.slice(0, 70));
}

function caseSixPageObject(): void {
  process.stdout.write('\n== 6 — a Page Object still wins, before any evidence is read ==\n');
  const verdict = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    pageObject: { pageObject: 'ProjectsPage', method: 'projectByName' },
    evidence: evidence({ derivedCandidates: [proven()] }),
  });
  check('6: REUSE_PAGE_OBJECT', verdict.outcome === 'REUSE_PAGE_OBJECT', verdict.outcome);
  check('6: no derived candidate is emitted instead', verdict.expression === null);
  check('6: the Page Object is named',
      verdict.pageObject?.method === 'projectByName', JSON.stringify(verdict.pageObject));
}

function caseSevenDynamicId(): void {
  process.stdout.write('\n== 7 — a dynamic tc_summary_* still resolves from measured evidence ==\n');
  const claimEra: TargetEvidence = {
    locator: "page.locator('#tc_summary_637609')",
    target: { tag: 'div', id: 'tc_summary_637609', stableClasses: ['tabulator-cell'] },
    ancestors: [{ tag: 'div', id: 'bugReport-table', relationship: 'ancestor', depth: 2 }],
    children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: ['ancestor'], matchCount: 1, matchCountDocument: 'unknown',
    captureTiming: 'after-action',
    identifier: { raw: 'tc_summary_637609', dynamic: true, normalised: 'tc_summary_<dynamic>' },
    // Measured when the line appeared, identity never asked - every recording made
    // before P0.7 looks like this, and it must keep resolving.
    derivedCandidates: [{
      strategy: 'scoped-class',
      expression: 'page.locator("#bugReport-table .tabulator-cell-draft--summary")',
      matchCount: 1, measuredAt: 'claim',
    }],
  };
  const verdict = assessLocator({
    locator: "page.locator('#tc_summary_637609')", target: 'summary', kind: 'assertion',
    value: 'After selecting Different date', evidence: claimEra,
  });
  check('7: NORMALIZED_LOCATOR', verdict.outcome === 'NORMALIZED_LOCATOR', verdict.outcome);
  check('7: emits the counted alternative',
      verdict.expression === 'page.locator("#bugReport-table .tabulator-cell-draft--summary")',
      String(verdict.expression));
  check('7: the generated id is not emitted', !String(verdict.expression).includes('637609'));
  check('7: an unstated identity is not read as a failed one',
      !/identity checked/.test(verdict.reason), verdict.reason.slice(0, 100));

  process.stdout.write('   but a candidate PROVEN wrong is refused even here\n');
  const refuted = assessLocator({
    locator: "page.locator('#tc_summary_637609')", target: 'summary', kind: 'assertion',
    value: 'After selecting Different date',
    evidence: {
      ...claimEra,
      derivedCandidates: [{ ...claimEra.derivedCandidates![0], identityMatched: false, measuredAt: 'press' }],
      candidatesTried: 1,
    },
  });
  check('7: NEEDS_REVIEW when the only alternative is a different element',
      refuted.outcome === 'NEEDS_REVIEW' && refuted.expression === null, refuted.outcome);
  check('7: and it still refuses to guess', /without guessing/.test(refuted.reason));
}

function caseEightDiagnosable(): void {
  process.stdout.write('\n== 8 — refused candidates stay diagnosable ==\n');
  const rejected: CandidateMeasurement[] = [
    { strategy: 'scoped-class', expression: 'page.locator("#all_apps .title")', matchCount: 4,
      sameDocument: true, measuredAt: 'press' },
    { strategy: 'scoped-parent-class', expression: 'page.locator("#all_apps .answer__reports-title")',
      matchCount: 1, identityMatched: false, sameDocument: true, measuredAt: 'press' },
    { strategy: 'class', expression: 'page.locator(".title")', matchCount: 0,
      sameDocument: true, measuredAt: 'press' },
  ];
  const funnelled = sanitiseEvidence([evidence({
    derivedCandidates: [], rejectedCandidates: rejected, candidatesTried: 3,
  })], '2026-08-15T00:00:00.000Z');
  const kept = funnelled.targets[0].rejectedCandidates ?? [];
  check('8: every refused candidate survives the funnel', kept.length === 3, String(kept.length));
  check('8: each one carries a reason', kept.every(candidate => Boolean(candidate.rejectionReason)),
      JSON.stringify(kept.map(c => c.rejectionReason)));
  check('8: the identity failure is stated in words',
      kept.some(c => /not the one the person acted on/.test(c.rejectionReason ?? '')));
  check('8: how many were tried is recorded', funnelled.targets[0].candidatesTried === 3);
  check('8: they are kept OUT of the promotable list',
      (funnelled.targets[0].derivedCandidates ?? []).length === 0);

  const many = Array.from({ length: 40 }, (_, index) => ({
    strategy: `s${index}`, expression: `page.locator(".c${index}")`, matchCount: 3,
    sameDocument: true, measuredAt: 'press' as const,
  }));
  const bounded = sanitiseEvidence([evidence({ rejectedCandidates: many, candidatesTried: 40 })],
      '2026-08-15T00:00:00.000Z');
  check('8: the diagnostic list is bounded',
      (bounded.targets[0].rejectedCandidates ?? []).length === 12,
      String((bounded.targets[0].rejectedCandidates ?? []).length));
  const long = sanitiseEvidence([evidence({
    rejectedCandidates: [{ strategy: 'x', expression: `page.locator("${'a'.repeat(500)}")`,
      matchCount: 2, measuredAt: 'press' }],
  })], '2026-08-15T00:00:00.000Z');
  check('8: a candidate expression is bounded too',
      (long.targets[0].rejectedCandidates ?? [])[0].expression.length <= 200);
}

function caseNineNoTricks(): void {
  process.stdout.write('\n== 9 — nothing here narrows, forces or synthesises ==\n');
  const forbidden = /\.first\(\)|\.last\(\)|\.nth\(|force\s*:|mouse\.|dispatchEvent|evaluate\(|xpath=|\/\/|\bclick\(\)/;
  const graphs = [
    { target: { tag: 'span', stableClasses: ['title', 'handel-over-flow'], text: 'Faclon labs' },
      parent: { tag: 'h4', stableClasses: ['handel-over-flow', 'answer__reports-title'] },
      ancestors: [{ tag: 'div', id: 'all_apps', relationship: 'ancestor' as const, depth: 9 }] },
    { target: { tag: 'div', id: 'tc_summary_637609', stableClasses: ['tabulator-cell'] },
      ancestors: [{ tag: 'div', id: 'bugReport-table', relationship: 'ancestor' as const, depth: 2 }] },
  ];
  let clean = true;
  for (const graph of graphs) {
    for (const candidate of candidateSelectorsFor(graph as any, () => false)) {
      if (forbidden.test(candidate.expression)) {
        clean = false;
        process.stdout.write(`      offending: ${candidate.expression}\n`);
      }
    }
  }
  check('9: no candidate is built with first/nth/force/mouse/dispatch/XPath', clean);
  const resolved = assessLocator({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    evidence: evidence({ derivedCandidates: [proven()] }),
  });
  check('9: nor is the emitted locator', !forbidden.test(String(resolved.expression)),
      String(resolved.expression));
  check('9: the refusal still names first()/nth() as the thing it will not do',
      /first\(\)\/nth\(\)/.test(assessLocator({
        locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
        evidence: evidence({ derivedCandidates: [] }),
      }).reason));
}

function caseTenOneClaim(): void {
  process.stdout.write('\n== 10 — one parked press answers one recorded line ==\n');
  const entry = {
    at: 1, kind: 'pointerdown', documentId: 'doc-press', targetIndex: 0,
    fingerprint: { tag: 'span', id: '', testId: '', role: '', ariaLabel: '', name: '',
      placeholder: '', title: '', type: '', text: 'Faclon labs', classes: ['title'] },
    graph: { target: { tag: 'span', text: 'Faclon labs' } },
    pressMeasurement: { measured: [proven()], attempted: 1, sameDocument: true, targetPresent: true },
  };
  const entries = [entry];
  const first = claimParkedEntry(entries, "page.getByText('Faclon labs')");
  check('10: the press is claimed by the line that describes it', first === entry);
  // The recorder splices a claimed entry out of the mirror; once it is gone, a second
  // line cannot be answered by the same press.
  entries.splice(entries.indexOf(first), 1);
  check('10: a second line cannot claim the same press',
      claimParkedEntry(entries, "page.getByText('Faclon labs')") === null);
  check('10: its measurement travelled with it, not with the locator',
      first.pressMeasurement.measured[0].expression === CLICKED_SPAN);
  check('10: the press carries the document it happened in', first.documentId === 'doc-press');
  check('10: and the index of the element that was pressed', first.targetIndex === 0);
}

function checkTheMeasurementItself(): void {
  process.stdout.write('\n== 11 — the GENERATED in-page measurement, run against a stub DOM ==\n');
  const { document, clicked, twin, title } = bugasuraApps();
  const window = installHook(document);
  check('11: the hook exposes a document identity', typeof window.__auraDocument === 'string'
    && window.__auraDocument.length > 0, String(window.__auraDocument));
  check('11: and a measure function', typeof window.__auraMeasure === 'function');

  // Park the clicked element the way `remember` would.
  window.__auraTargets[0] = clicked;
  const documentId = window.__auraDocument;

  const answer = window.__auraMeasure({
    index: 0, documentId, ownText: 'Faclon labs',
    candidates: [
      { strategy: 'scoped-class-text', selector: '#all_apps .title', text: 'Faclon labs', textMode: 'filter' },
      // The shape that lands on the CONTAINER rather than the element: exactly one
      // match, and the wrong node. Unique and wrong is the whole point of case 3.
      { strategy: 'scoped-parent-class-text', selector: '#all_apps .answer__reports-title',
        text: 'Faclon labs', textMode: 'filter' },
      { strategy: 'class-text', selector: '.title', text: 'Faclon labs', textMode: 'filter' },
      { strategy: 'scoped-text', selector: '#all_apps', text: 'Faclon labs', textMode: 'descend' },
    ],
  });

  check('11: it reports the same document', answer.sameDocument === true && answer.documentId === documentId);
  check('11: the pressed element was found', answer.targetPresent === true);
  check('11: the element own text is measured page-wide as ambiguous',
      answer.ownText.matchCount === 2, JSON.stringify(answer.ownText));
  check('11: and the pressed element is one of the two', answer.ownText.identityMatched === true);

  const [scoped, parentClass, unscoped, descend] = answer.results;
  check('11: the scoped text candidate matches exactly one',
      scoped.count === 1, JSON.stringify(scoped));
  check('11: and it IS the element that was pressed', scoped.identityMatched === true);
  check('11: the parent-class candidate matches one element that is NOT the target',
      parentClass.count === 1 && parentClass.identityMatched === false, JSON.stringify(parentClass));
  check('11: an unscoped class+text candidate is ambiguous',
      unscoped.count === 2 && unscoped.identityMatched === false, JSON.stringify(unscoped));
  check('11: a descend candidate lands back on the pressed element',
      descend.count === 1 && descend.identityMatched === true, JSON.stringify(descend));

  process.stdout.write('   the same call from a page that has since navigated\n');
  const elsewhere = window.__auraMeasure({
    index: 0, documentId: 'a-document-that-is-gone', ownText: 'Faclon labs',
    candidates: [{ strategy: 'scoped-class-text', selector: '#all_apps .title' }],
  });
  check('11: it refuses to measure at all', elsewhere.sameDocument === false);
  check('11: and returns no results to be mistaken for evidence', elsewhere.results.length === 0);
  check('11: and no own-text count either', elsewhere.ownText === undefined);

  process.stdout.write('   an unmeasurable candidate reports the error, never a count\n');
  const broken = window.__auraMeasure({
    index: 0, documentId,
    candidates: [{ strategy: 'test-id', selector: '#all_apps [data-testid="x"]' }],
  });
  check('11: a selector this stub cannot answer yields no false count',
      broken.results[0].count === 0 || typeof broken.results[0].error === 'string',
      JSON.stringify(broken.results[0]));
  check('11: nothing was clicked, hovered or dispatched to measure it',
      twin.textContent === 'Faclon labs' && title.textContent === 'Faclon labs');
}

function main(): void {
  caseOneSafe();
  caseTwoAmbiguousCandidate();
  caseThreeWrongElement();
  caseFourOtherDocument();
  caseFiveNoEvidence();
  caseSixPageObject();
  caseSevenDynamicId();
  caseEightDiagnosable();
  caseNineNoTricks();
  caseTenOneClaim();
  checkTheMeasurementItself();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
