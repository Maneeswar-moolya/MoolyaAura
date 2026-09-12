import '../testing/isolated-checkout';
/**
 * Does the DOM evidence captured during recording survive Save and reach the resolver?
 *
 *   npx tsx ai/autocode/evidence-sidecar.fixture.ts
 *
 * Offline. The defect this pins is the one TC_LOGIN_040 exposed: the evidence existed
 * in memory, the artifact was a `.spec.ts` that could not carry it, and generation
 * re-parsed the script alone - so the resolver was handed nothing and correctly said
 * it had nothing. The checks below walk the whole path with a minimal authored
 * script, and the ones that matter most are the refusals: a missing, malformed or
 * stale sidecar must degrade to exactly the behaviour that shipped before it existed.
 */

import { recordingSource } from '../testing/synthetic-data';
import fs from 'node:fs';
import path from 'node:path';

import {
  evidenceFor, isDomEvidence, locatorKey, sanitiseEvidence, type TargetEvidence,
} from './dom-evidence';
import { generateFromRecording, locatorMetrics, mapRecording, readEvidence } from './from-recording';
import { artifactPath, discardArtifact, evidencePath, parseRecording } from '../dashboard/recorder';
import type { TestCase } from '../excel/types';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
const CASE_ID = 'TC_EVID_SIDECAR';
const SCRIPT = recordingSource([
  "await expect(page.locator('#tc_summary_638717')).toContainText('Line Chart');",
  "await page.locator('#tc_summary_638717').getByText('Line Chart').click();",
]);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/**
 * The evidence Phase 8A/8B MEASURED for this element family, in the sidecar's shape.
 *
 * Constructed rather than replayed: TC_LOGIN_040 was recorded before the sidecar
 * existed, so no real one is on disk. Every value here is one the live capture
 * actually reported for `#tc_summary_*` on FixturePortal - the dynamic id, the
 * `tabulator-cell-draft--summary` class, the `#bugReport-table` ancestor, matchCount 1
 * - plus a deliberately ambiguous second candidate so the filter has something to
 * reject.
 */
function measuredEvidence(overrides: Partial<TargetEvidence> = {}): TargetEvidence {
  return {
    locator: "page.locator('#tc_summary_638717')",
    target: {
      tag: 'div', id: 'tc_summary_638717',
      stableClasses: ['tabulator-cell', 'tabulator-cell-draft--summary'],
      text: 'Line Chart | Time Config Page: Note, under Periodicity Field',
    },
    parent: { tag: 'div', id: 'draft_row_3517', stableClasses: ['tabulator-row'] },
    ancestors: [
      { tag: 'div', id: 'draft_row_3517', relationship: 'ancestor', depth: 1 },
      { tag: 'div', id: 'bugReport-table', relationship: 'ancestor', depth: 2 },
    ],
    children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: ['parent', 'ancestor'],
    matchCount: 1,
    identifier: { raw: 'tc_summary_638717', dynamic: true, normalised: 'tc_summary_<dynamic>' },
    derivedCandidates: [
      { strategy: 'scoped-class', expression: 'page.locator("#bugReport-table .tabulator-cell-draft--summary")', matchCount: 1 },
      { strategy: 'class', expression: 'page.locator(".tabulator-cell")', matchCount: 26 },
    ],
    ...overrides,
  };
}

function syntheticCase(id: string): TestCase {
  return {
    testCaseId: id, module: '', feature: '', scenario: 'sidecar fixture', description: '',
    preconditions: '', steps: ['Open the page'], testData: '',
    expectedResult: 'The summary is visible', priority: '' as TestCase['priority'],
    tags: ['recorded'], automationStatus: 'Not Automated', automationNotes: '',
    execute: null, expectedOutcome: '', expectedMessage: '',
    requirementId: '', testType: '' as TestCase['testType'],
    businessRisk: '' as TestCase['businessRisk'], environment: '', userRole: '',
    authenticationProfile: '', testOwner: '',
    source: {
      workbookPath: '', workbook: 'login-test-cases.xlsx',
      worksheet: 'Login Test Cases', row: 999,
    },
    extra: {}, issues: [],
  };
}

function main(): void {
  const script = SCRIPT;
  const graph = sanitiseEvidence([measuredEvidence()], new Date(0).toISOString());
  fs.mkdirSync(path.dirname(artifactPath(CASE_ID)), { recursive: true });

  try {
    process.stdout.write('\n== A/B — the sidecar is written only when evidence exists ==\n');
    // A save writes the script; the sidecar follows only for an available graph. Both
    // halves are exercised through the same file layout the recorder uses.
    fs.writeFileSync(artifactPath(CASE_ID), script, 'utf8');
    check('B: no sidecar -> readEvidence says so, generation unaffected',
        readEvidence(CASE_ID).available === false);
    const bare = mapRecording(parseRecording(script, {
      startUrl: '', browser: '', durationMs: 0, evidence: readEvidence(CASE_ID),
    }));
    check('B: mapping still produced steps', bare.steps.length > 0, String(bare.steps.length));

    fs.writeFileSync(evidencePath(CASE_ID), JSON.stringify(graph, null, 2), 'utf8');
    check('A: sidecar sits beside the artifact, same ID',
        fs.existsSync(evidencePath(CASE_ID))
        && path.basename(evidencePath(CASE_ID)) === `${CASE_ID}.evidence.json`);

    process.stdout.write('\n== C/G/I/K — a valid sidecar reaches the resolver ==\n');
    const loaded = readEvidence(CASE_ID);
    check('C: it loads', loaded.available === true);
    check('C: it validates as evidence', isDomEvidence(loaded));
    check('G: association by the verbatim locator key',
        Boolean(evidenceFor(loaded, "page.locator('#tc_summary_638717')")));
    check('G: a different chain does NOT collide',
        evidenceFor(loaded, "page.locator('#tc_summary_638717').getByText('Line Chart | Time Config Page')") === null);

    const mapped = mapRecording(parseRecording(script, {
      startUrl: '', browser: '', durationMs: 0, evidence: loaded,
    }));
    const counts = locatorMetrics(mapped);
    check('I: evidence arrived', counts.domEvidence.captured === true);
    check('I: target count reported', counts.domEvidence.targetCount === 1, String(counts.domEvidence.targetCount));
    check('I: measured count reported', counts.domEvidence.measuredCount === 1, String(counts.domEvidence.measuredCount));

    const assertion = mapped.assessments.find(entry => entry.from === 'assert contains #tc_summary_638717');
    check('K: the dynamic assertion resolved', assertion?.assessment.outcome === 'NORMALIZED_LOCATOR',
        String(assertion?.assessment.outcome));
    check('K: to the candidate measured at exactly one element',
        assertion?.assessment.expression === 'page.locator("#bugReport-table .tabulator-cell-draft--summary")',
        String(assertion?.assessment.expression));
    check('K: the ambiguous candidate (26 matches) was discarded at the funnel',
        !JSON.stringify(loaded).includes('.tabulator-cell")'));
    check('K: it no longer needs a person',
        !mapped.needsReview.some(step => step.from.includes('assert contains #tc_summary_638717')),
        mapped.needsReview.map(s => s.from).join(', ') || '(none needing review)');
    check('K: telemetry counted the resolution', counts.domEvidence.resolvedFromEvidence >= 1,
        String(counts.domEvidence.resolvedFromEvidence));
    const assertionStep = mapped.steps.find(step => step.from === 'assert contains #tc_summary_638717');
    check('K: the assertion no longer emits the generated id',
        Boolean(assertionStep) && !assertionStep!.code.join(' ').includes('tc_summary_638717'),
        assertionStep?.code.join(' ').slice(0, 90));
    // Was a known gap until the P0 fix: the action branch emitted `action.locator`
    // while this branch used the resolver's expression. Both now use the resolver.
    const actionStep = mapped.steps.find(step => step.from.startsWith('click Line Chart'));
    check('K: the action branch uses the resolver too',
        Boolean(actionStep) && !actionStep!.code.join(' ').includes('tc_summary_638717'),
        actionStep?.code.join(' ').slice(0, 90));

    process.stdout.write('\n== J — without evidence, Phase 7 behaviour is unchanged ==\n');
    check('J: the same assertion needs review',
        bare.needsReview.some(step => step.from.includes('assert contains #tc_summary_638717')));
    check('J: with the offline reason - uniqueness was never proven',
        bare.needsReview.some(step => /match exactly one element/.test(step.why)),
        bare.needsReview[0]?.why?.slice(0, 90));
    check('J: and the reason is recorded in telemetry',
        locatorMetrics(bare).domEvidence.unavailableReason
          === 'no evidence sidecar was written for this recording',
        String(locatorMetrics(bare).domEvidence.unavailableReason));

    process.stdout.write('\n== D — malformed sidecars degrade, never throw ==\n');
    fs.writeFileSync(evidencePath(CASE_ID), '{ "available": true, "targets": [ {', 'utf8');
    const unparseable = readEvidence(CASE_ID);
    check('D: unparseable -> unavailable', unparseable.available === false);
    check('D: with a reason naming the failure',
        !unparseable.available && /could not be read/.test(unparseable.reason));

    fs.writeFileSync(evidencePath(CASE_ID), JSON.stringify({ available: true, targets: [{ nope: 1 }] }), 'utf8');
    const wrongShape = readEvidence(CASE_ID);
    check('D: wrong shape -> unavailable', wrongShape.available === false);
    check('D: isDomEvidence rejects it', !isDomEvidence({ available: true, targets: [{ nope: 1 }] }));
    check('D: generation still runs on it',
        mapRecording(parseRecording(script, {
          startUrl: '', browser: '', durationMs: 0, evidence: wrongShape,
        })).steps.length > 0);
    check('D: and falls back to needing review, not to a guess',
        mapRecording(parseRecording(script, {
          startUrl: '', browser: '', durationMs: 0, evidence: wrongShape,
        })).needsReview.some(step => step.from.includes('tc_summary_638717')));

    process.stdout.write('\n== E/F — one lifecycle, two files ==\n');
    fs.writeFileSync(evidencePath(CASE_ID), JSON.stringify(graph), 'utf8');
    check('E: both present before discard',
        fs.existsSync(artifactPath(CASE_ID)) && fs.existsSync(evidencePath(CASE_ID)));
    discardArtifact(CASE_ID);
    check('E: the script is gone', !fs.existsSync(artifactPath(CASE_ID)));
    check('E: the sidecar is gone with it', !fs.existsSync(evidencePath(CASE_ID)));
    check('F: nothing stale survives to be paired with a later recording',
        readEvidence(CASE_ID).available === false);
    // A recording whose assembly fails keeps BOTH, which is what diagnosis needs.
    fs.writeFileSync(artifactPath(CASE_ID), script, 'utf8');
    fs.writeFileSync(evidencePath(CASE_ID), JSON.stringify(graph), 'utf8');
    const declined = generateFromRecording(syntheticCase(CASE_ID),
        'tests-e2e/generated/TC_EVID_SIDECAR.spec.ts', 'excel/fixture-cases.xlsx');
    check('F: a blocked generation keeps both files for diagnosis',
        fs.existsSync(artifactPath(CASE_ID)) && fs.existsSync(evidencePath(CASE_ID)),
        `assembled=${declined.assembled} block=${declined.block ?? '-'}`);

    process.stdout.write('\n== H — the two producers agree on the key ==\n');
    const wrapped = "page.locator('#bugReport-table')\n      .getByText('Line Chart | Time Config Page')";
    const flat = "page.locator('#bugReport-table').getByText('Line Chart | Time Config Page')";
    check('H: a wrapped chain keys the same as a flat one', locatorKey(wrapped) === locatorKey(flat),
        `${JSON.stringify(locatorKey(wrapped))} vs ${JSON.stringify(locatorKey(flat))}`);
    check('H: evidenceFor matches across the wrap',
        Boolean(evidenceFor(sanitiseEvidence([measuredEvidence({ locator: flat })], 'x'), wrapped)));
    check('H: whitespace INSIDE quotes is preserved',
        locatorKey("page.getByText('a  b')").includes("'a  b'"),
        locatorKey("page.getByText('a  b')"));
    check('H: so two different texts still differ',
        locatorKey("page.getByText('a  b')") !== locatorKey("page.getByText('a b')"));
    check('H: the key drops insignificant whitespace outside quotes',
        locatorKey(flat) === flat.replace(/\s(?=[.,)])|(?<=[(,])\s/g, ''),
        locatorKey(flat));

    process.stdout.write('\n== L — the sidecar carries nothing sensitive ==\n');
    const serialised = JSON.stringify(graph);
    for (const forbidden of ['hunter2', 'sk-live-', 'Bearer ', 'Cookie:', '<script', '<style', '@moolya.com'])
      check(`L: no ${JSON.stringify(forbidden)}`, !serialised.includes(forbidden));
    check('L: it is the sanitised document (limits travel with it)', Boolean(graph.limits));
    check('L: no raw markup field exists', !/rawHtml|outerHTML|innerHTML/.test(serialised));
  } catch (error) {
    check('sidecar checks completed', false, String(error).slice(0, 240));
  } finally {
    discardArtifact(CASE_ID);
    fs.rmSync(path.resolve(ROOT, 'tests-e2e/generated/TC_EVID_SIDECAR.spec.ts'), { force: true });
  }

  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
