import '../testing/isolated-checkout';
/**
 * PHASE 13.2: an ESTABLISHED page grows by proven addition, and never by degradation.
 *
 *   BOOTSTRAPPED  ->  second capability appended  ->  ESTABLISHED
 *   and every later recording either REUSES what is there or adds something new.
 *
 * This fixture CHANGES NOTHING. It pins the enrichment behaviour the framework already
 * has, before any Phase 13 change is made to it, so a later phase cannot quietly move it:
 *
 *   - APPEND-ONLY. A capability that is already established is never replaced, renamed or
 *     removed by a later recording - not by a recording of the same element under another
 *     name, and not by one carrying a different proven locator.
 *   - FOUR IDEMPOTENCY GATES, each catching a different kind of repeat: the same
 *     abstraction seen twice across recordings, the same method name on the owning class,
 *     the same ELEMENT already wrapped under another name, and the same entry already
 *     present in the knowledge file.
 *   - ONE TRANSACTION. Knowledge, Page Object and fixture are written together or not at
 *     all, so an unsound proposal beside a sound one leaves the established page exactly
 *     as it was.
 *
 * Every step is driven through the REAL production functions - `analyseCorpus`,
 * `applyProposals`, `readAllPageKnowledge`, `buildIndex`, `findMethodByProvenLocator` -
 * and every assertion is made against the bytes on disk. No browser, no model, no network.
 *
 * SAFETY. Everything resolves under `AURA_ARTEFACT_ROOT`, a temporary directory, with a
 * synthetic registry declaring application ids nothing in this repository uses. The
 * fixture refuses to start if any artefact path it would touch lies outside that root.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resetActiveApplication } from '../knowledge/canonical';
import { activeScope, resetActiveScope } from './scope';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const APP = 'enrichapp';
const OTHER_APP = 'otherapp';
const REAL_ROOT = process.cwd();
let TEMP = '';

/* ------------------------------------------------------------------ harness */

function useApplication(applicationId: string): void {
  process.env.AURA_APPLICATION = applicationId;
  resetActiveScope();
  resetActiveApplication();
}

function startIsolation(): void {
  TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-enrichment-'));
  const registry = path.join(TEMP, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({
    schemaVersion: 1,
    applications: [{
      applicationId: APP,
      displayName: APP,
      defaultEnvironmentId: 'qa',
      environments: { qa: { baseUrl: `https://${APP}.test/` } },
      workbooks: [`excel/${APP}/cases.xlsx`],
    }, {
      // A SECOND APPLICATION, declared and never made active except where a check is
      // specifically about the boundary between them. Its presence changes nothing for
      // the sections above: every one of them chooses its application explicitly.
      applicationId: OTHER_APP,
      displayName: OTHER_APP,
      defaultEnvironmentId: 'qa',
      environments: { qa: { baseUrl: `https://${OTHER_APP}.test/` } },
      workbooks: [`excel/${OTHER_APP}/cases.xlsx`],
    }],
  }, null, 1), 'utf8');
  process.env.AURA_ARTEFACT_ROOT = TEMP;
  process.env.AURA_REGISTRY_FILE = path.relative(REAL_ROOT, registry).split(path.sep).join('/');
  useApplication(APP);

  const outside = Object.values(activeScope().paths).filter(target => !target.startsWith(TEMP));
  if (outside.length)
    throw new Error(`refusing to run: artefact paths outside the temporary root - ${outside.join(', ')}`);
}

function endIsolation(): void {
  delete process.env.AURA_ARTEFACT_ROOT;
  delete process.env.AURA_REGISTRY_FILE;
  delete process.env.AURA_APPLICATION;
  resetActiveScope();
  resetActiveApplication();
  if (TEMP && TEMP.startsWith(os.tmpdir()))
    fs.rmSync(TEMP, { recursive: true, force: true });
}

/** One recorded press: the Codegen line, and the evidence proving which element it was. */
function recordPress(options: {
  testCaseId: string;
  route: string;
  name: string;
  /** The PROVEN expression - what the recorder measured at one element, identity matched. */
  expression: string;
  /** The element's own authored id, when it has one. */
  id?: string;
  /** Measured and refused: two elements, identity never established. */
  unproven?: boolean;
  /**
   * What the recorder measured about ESTABLISHED CAPABILITIES at this interaction.
   *
   * The Phase 13.6 channel: each entry names a capability and carries the ordinary
   * measurement of that capability's own declared locator against this element. Absent
   * on every recording that predates it, which is the state the analyser must read as
   * NOT PROVEN rather than as no.
   */
  capabilityMeasurements?: Array<{
    owner: string; method: string; expression: string;
    matchCount?: number | null; identityMatched?: boolean; measurementError?: string;
    /** Measured after the document had already moved on. Never proof of anything. */
    sameDocument?: boolean;
  }>;
}): void {
  const scope = activeScope();
  fs.mkdirSync(scope.paths.recordingsDir, { recursive: true });
  fs.writeFileSync(path.join(scope.paths.recordingsDir, `${options.testCaseId}.spec.ts`),
      ["import { test, expect } from '@playwright/test';", '',
        "test('test', async ({ page }) => {",
        `  await page.goto('https://${APP}.test${options.route}');`,
        `  await page.getByRole('button', { name: '${options.name}', exact: true }).click();`,
        '});', ''].join('\n'), 'utf8');
  const measurement = {
    strategy: options.expression.includes('getByRole') ? 'role-name' : 'stable-id',
    expression: options.expression,
    matchCount: options.unproven ? 2 : 1,
    identityMatched: !options.unproven,
    sameDocument: true,
    measuredAt: 'press',
  };
  fs.writeFileSync(path.join(scope.paths.recordingsDir, `${options.testCaseId}.evidence.json`),
      JSON.stringify({
        available: true,
        capturedAt: new Date(0).toISOString(),
        limits: {},
        origin: {
          applicationId: APP, environmentId: 'qa',
          baseUrl: `https://${APP}.test/`, testCaseId: options.testCaseId,
        },
        targets: [{
          locator: `page.getByRole('button', { name: '${options.name}', exact: true })`,
          elementRef: 'doc1:0',
          route: options.route,
          target: {
            tag: 'button', role: 'button', text: options.name, accessibleName: options.name,
            accessibleNameVerified: true,
            ...(options.id ? { id: options.id } : {}),
            classes: ['btn'], stableClasses: ['btn'],
          },
          ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
          relationships: [],
          matchCount: 1, matchCountDocument: 'same', captureTiming: 'before-action',
          ...(options.capabilityMeasurements?.length
          ? {
            capabilityMeasurements: options.capabilityMeasurements.map(entry => ({
              strategy: 'capability', expression: entry.expression,
              matchCount: entry.matchCount === undefined ? 1 : entry.matchCount,
              identityMatched: entry.identityMatched === undefined ? true : entry.identityMatched,
              sameDocument: entry.sameDocument === undefined ? true : entry.sameDocument,
              measuredAt: 'press',
              ...(entry.measurementError ? { measurementError: entry.measurementError } : {}),
              capability: { owner: entry.owner, method: entry.method },
            })),
          }
          : {}),
        derivedCandidates: options.unproven ? [] : [measurement],
          rejectedCandidates: options.unproven
            ? [{ ...measurement, rejectionReason: 'matched 2 elements' }] : [],
          positionProvenCandidates: [],
        }],
      }, null, 1), 'utf8');
}

interface Store { knowledge: string; page: string; fixtures: string }

function readStore(): Store {
  const scope = activeScope();
  const read = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return {
    knowledge: read(path.join(scope.paths.knowledgePageDir, `${APP}__orders.yaml`)),
    page: read(path.join(scope.paths.pagesDir, 'orders.page.ts')),
    fixtures: read(scope.paths.fixturesFile),
  };
}

/** The block one knowledge entry occupies, so "unchanged" is a byte comparison. */
function entryBlock(knowledge: string, key: string): string {
  const start = knowledge.indexOf(`  ${key}:`);
  if (start < 0)
    return '';
  const rest = knowledge.slice(start + 1);
  const next = /\n {2}\w[\w-]*:\n?/.exec(rest);
  const block = next ? knowledge.slice(start, start + 1 + next.index) : knowledge.slice(start);
  return block.replace(/\s+$/, '');
}

const countOf = (source: string, pattern: RegExp) => (source.match(pattern) ?? []).length;

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  startIsolation();
  const { analyseCorpus } = await import('../autocode/abstraction/propose');
  const { applyProposals } = await import('../autocode/abstraction/writer');
  const { readAllPageKnowledge } = await import('../knowledge/page-knowledge');
  const { buildIndex } = await import('../knowledge/index');
  const { findMethodByProvenLocator } = await import('../autocode/from-recording');

  const run = () => {
    const analysis = analyseCorpus();
    const written = applyProposals(analysis.proposals);
    return { analysis, written };
  };

  /* ------------------------------------------- A. the first capability, established */
  section('A. a screen is established by its first proven capability');

  recordPress({ testCaseId: 'TC_ENR_001', route: '/orders', name: 'Place order',
    id: 'place_order', expression: 'page.locator("#place_order")' });
  const first = run();
  check('A1: the first recording establishes the screen', first.written.applied, first.written.reason);
  const established = readStore();
  check('A2: knowledge, Page Object and fixture all exist',
      Boolean(established.knowledge && established.page && established.fixtures));
  check('A3: the capability is declared with the locator that was PROVEN',
      /page_object: OrdersPage/.test(established.knowledge)
        && established.knowledge.includes('#place_order'),
      established.knowledge.split('\n').filter(line => /page_object:|locator_strategy:/.test(line))
          .map(line => line.trim()).join(' | '));

  /* --------------------------------------------------- B. enrichment is an ADDITION */
  section('B. a second proven capability is APPENDED, and the first is untouched');

  const firstBlock = entryBlock(established.knowledge, 'place_order_button');
  recordPress({ testCaseId: 'TC_ENR_002', route: '/orders', name: 'Apply coupon',
    id: 'apply_coupon', expression: 'page.locator("#apply_coupon")' });
  const second = run();
  const grown = readStore();
  check('B1: the writer applied the second capability', second.written.applied, second.written.reason);
  check('B2: both capabilities are declared on the same screen',
      grown.knowledge.includes('place_order_button') && grown.knowledge.includes('apply_coupon_button'));
  check('B3: the first entry is byte-identical - enrichment added, it did not rewrite',
      entryBlock(grown.knowledge, 'place_order_button') === firstBlock);
  check('B4: the Page Object carries both methods and the class was not regenerated',
      /placeOrderButton\s*\(/.test(grown.page) && /applyCouponButton\s*\(/.test(grown.page)
        && grown.page.startsWith(established.page.slice(0, 200)));
  check('B5: the fixture is registered exactly once, however many capabilities are added',
      countOf(grown.fixtures, /ordersPage\s*:/g) === countOf(established.fixtures, /ordersPage\s*:/g),
      `${countOf(grown.fixtures, /ordersPage\s*:/g)} registration(s)`);

  /* ------------------------------------------------------------ C. idempotency */
  section('C. the four idempotency gates');

  const beforeRepeat = readStore();
  const repeat = run();
  const afterRepeat = readStore();
  check('C1: re-processing the same corpus writes nothing new',
      afterRepeat.knowledge === beforeRepeat.knowledge && afterRepeat.page === beforeRepeat.page
        && afterRepeat.fixtures === beforeRepeat.fixtures,
      repeat.written.reason);

  // The SAME element, recorded again in a different test case.
  recordPress({ testCaseId: 'TC_ENR_003', route: '/orders', name: 'Place order',
    id: 'place_order', expression: 'page.locator("#place_order")' });
  run();
  const afterDuplicate = readStore();
  check('C2: the same element recorded again adds no second entry and no second method',
      countOf(afterDuplicate.knowledge, /place_order_button:/g) === 1
        && countOf(afterDuplicate.page, /placeOrderButton\s*\(/g) === 1,
      `${countOf(afterDuplicate.knowledge, /place_order_button:/g)} entr(y/ies), `
        + `${countOf(afterDuplicate.page, /placeOrderButton\s*\(/g)} method(s)`);
  check('C3: and the store is byte-identical to before that recording',
      afterDuplicate.knowledge === beforeRepeat.knowledge && afterDuplicate.page === beforeRepeat.page);

  // THE SAME ELEMENT UNDER A DIFFERENT NAME, and a different expression for it.
  //
  // Caught by IDENTITY, and identity here means what it means everywhere else in the
  // framework: at this press the browser resolved `OrdersPage.placeOrderButton`'s own
  // declared locator and reported that the element it found is the element being pressed.
  // Nothing about the two expressions is compared - one is `#place_order`, the other
  // `#orders_form #place_order`, and a framework that read agreement between those as
  // identity would equally read `.mdl-button` as identity, which is the defect Phase 13.5
  // measured and Phase 13.6 removed.
  recordPress({ testCaseId: 'TC_ENR_004', route: '/orders', name: 'Complete purchase',
    id: 'place_order', expression: 'page.locator("#orders_form #place_order")',
    capabilityMeasurements: [{ owner: 'OrdersPage', method: 'placeOrderButton',
      expression: "page.locator('#place_order')" }] });
  const renamed = run();
  const afterRename = readStore();
  const renameProposal = renamed.analysis.proposals.find(entry => entry.testCaseId === 'TC_ENR_004');
  check('C4: an element already wrapped is never given a second method under a new name',
      renameProposal === undefined || renameProposal.status === 'REUSE',
      renameProposal
        ? `proposal ${renameProposal.status} | ${(renameProposal.refusals ?? []).join(' | ')}`
        : 'resolved to the existing capability before any proposal was made');
  check('C5: no completePurchase method or entry was written',
      !/completePurchase/i.test(afterRename.page) && !/complete_purchase/.test(afterRename.knowledge)
        && afterRename.knowledge === beforeRepeat.knowledge);

  /* ------------------------------------- D. no degradation, and no silent replacement */
  section('D. a different proven locator for an established capability changes nothing');

  recordPress({ testCaseId: 'TC_ENR_005', route: '/orders', name: 'Place order',
    expression: 'page.getByRole("button", { name: "Place order", exact: true })' });
  const rival = run();
  const afterRival = readStore();
  const rivalProposal = rival.analysis.proposals.find(entry => entry.testCaseId === 'TC_ENR_005');
  check('D1: the recording resolves to the established capability rather than proposing a new one',
      rivalProposal === undefined || rivalProposal.status === 'REUSE',
      rivalProposal ? `${rivalProposal.status} | ${(rivalProposal.refusals ?? []).join(' | ')}` : 'reused before proposal');
  check('D2: the established locator is untouched - no silent replacement',
      entryBlock(afterRival.knowledge, 'place_order_button') === firstBlock
        && afterRival.knowledge.includes('#place_order'));
  check('D3: and the rival locator was written nowhere',
      !afterRival.knowledge.includes('getByRole("button", { name: "Place order"')
        && !afterRival.page.includes('getByRole'),
      'new evidence about an established capability is never applied automatically');
  check('D4: the whole store is byte-identical to before the rival recording',
      afterRival.knowledge === beforeRepeat.knowledge && afterRival.page === beforeRepeat.page
        && afterRival.fixtures === beforeRepeat.fixtures);

  /* ---------------------------------------------------- E. what may not be written */
  section('E. an unproven target on an established page adds nothing');

  recordPress({ testCaseId: 'TC_ENR_006', route: '/orders', name: 'Track parcel',
    id: 'track_parcel', expression: 'page.locator("#track_parcel")', unproven: true });
  const unproven = run();
  const afterUnproven = readStore();
  const unprovenProposal = unproven.analysis.proposals.find(entry => entry.testCaseId === 'TC_ENR_006');
  check('E1: a target nothing identified is never PROPOSED',
      Boolean(unprovenProposal) && unprovenProposal!.status !== 'PROPOSED',
      unprovenProposal ? unprovenProposal.status : 'no proposal');
  check('E2: and no capability was written for it',
      !/trackParcel/i.test(afterUnproven.page) && !/track_parcel/.test(afterUnproven.knowledge));

  /* ---------------------------------------------------------- F. one transaction */
  section('F. an unsound proposal leaves the established page exactly as it was');

  recordPress({ testCaseId: 'TC_ENR_007', route: '/orders', name: 'Print invoice',
    id: 'print_invoice', expression: 'page.locator("#print_invoice")' });
  const batch = analyseCorpus();
  const sound = batch.proposals.find(entry => entry.status === 'PROPOSED');
  const beforeBatch = readStore();
  if (!sound) {
    check('F1: an unsound proposal blocks the batch', false, 'no sound proposal to pair with');
  } else {
    const unsound = {
      ...sound,
      fingerprint: `${sound.fingerprint}-unsound`,
      method: 'brokenMethod',
      // A generated identifier - refused by the writer's own validation, which no
      // enrichment may bypass.
      template: "page.locator('#order_636432')",
      expression: "page.locator('#order_636432')",
    };
    const blocked = applyProposals([sound, unsound] as any);
    const afterBatch = readStore();
    // REFUSED BEFORE ANYTHING IS WRITTEN, not merely rolled back afterwards. Both
    // protections exist and they are not the same guarantee: validation refuses the
    // batch, and the rollback is what catches a failure that only the written state can
    // reveal. This pins the first one.
    check('F1: the batch is refused by validation, before any file is written',
        !blocked.applied && /did not validate/.test(blocked.reason), blocked.reason);
    check('F2: the sound capability was NOT written either - all or nothing',
        !/printInvoice/i.test(afterBatch.page) && !/print_invoice/.test(afterBatch.knowledge));
    check('F3: and the established page is byte-identical',
        afterBatch.knowledge === beforeBatch.knowledge && afterBatch.page === beforeBatch.page
          && afterBatch.fixtures === beforeBatch.fixtures);
  }

  /* ------------------------ H. new evidence about an established capability (P13.3) */
  section('H. a rival proven locator is RETAINED FOR REVIEW, and applied to nothing');

  const { alternativeEvidenceFor, writeAlternatives } = await import('../autocode/abstraction/propose');

  // The SAME element-proven alternative, recorded a second time: one distinct
  // alternative, not two sightings.
  recordPress({ testCaseId: 'TC_ENR_008', route: '/orders', name: 'Complete purchase',
    id: 'place_order', expression: 'page.locator("#orders_form #place_order")',
    capabilityMeasurements: [{ owner: 'OrdersPage', method: 'placeOrderButton',
      expression: "page.locator('#place_order')" }] });
  // A DIFFERENT element that derives the SAME method name - the name gate, not the
  // element gate. It is a collision, not evidence about the established capability.
  recordPress({ testCaseId: 'TC_ENR_009', route: '/orders', name: 'Place order',
    id: 'refund_order', expression: 'page.locator("#refund_order")' });
  const observed = analyseCorpus();
  const rivalRecords = observed.alternatives.filter(entry => entry.method === 'placeOrderButton');
  // TWO recordings proved something other than what is declared for this capability -
  // the scoped variant the analyser refused as a duplicate, and the role+name rival the
  // matcher resolved. Both are observations; neither is applied.
  // ONE OBSERVATION, from the one gate that establishes element identity. The rival that
  // only an accessible-name match could associate (TC_ENR_005) is deliberately absent.
  check('H1: the element-proven alternative is recorded, naming the established capability',
      rivalRecords.length === 1 && rivalRecords[0].owner === 'OrdersPage'
        && rivalRecords[0].resolvedBy === 'element-already-wrapped',
      rivalRecords.map(entry => entry.testCaseId + ':' + entry.resolvedBy).join(', ') || 'none');
  const record = rivalRecords[0];
  check('H2: it carries BOTH expressions verbatim - what is declared, and what was proved',
      record?.declared === "page.locator('#place_order')"
        && record?.observed === 'page.locator("#orders_form #place_order")',
      record ? record.declared + '  vs  ' + record.observed : 'no record');
  check('H3: and the recording and application it came from',
      record?.testCaseId === 'TC_ENR_004' && record?.applicationId === APP
        && record?.resolvedBy !== undefined,
      record ? record.testCaseId + ' / ' + record.applicationId + ' / ' + record.resolvedBy : '-');
  check('H4: it carries NO score and no verdict - quality is not capability ownership',
      record !== undefined && !Object.keys(record).some(key => /score|better|stronger|rank|prefer/i.test(key)),
      record ? Object.keys(record).join(', ') : '-');
  check('H5: and the established capability is still exactly what it was',
      entryBlock(readStore().knowledge, 'place_order_button') === firstBlock);

  // IDEMPOTENT: the report is derived from the corpus, so the same corpus writes the
  // same bytes however many times it is analysed.
  const reportFile = path.join(TEMP, 'alternatives.jsonl');
  writeAlternatives(observed, reportFile);
  const firstReport = fs.readFileSync(reportFile, 'utf8');
  writeAlternatives(analyseCorpus(), reportFile);
  check('H6: re-analysing writes a byte-identical report',
      fs.readFileSync(reportFile, 'utf8') === firstReport,
      firstReport.split(String.fromCharCode(10)).filter(Boolean).length + ' observation(s)');

  // A NAME COLLISION IS NOT THE SAME CAPABILITY. TC_ENR_004 recorded a DIFFERENT
  // accessible name for the same element, and TC_ENR_007 a different element entirely.
  check('H7: an observation is only ever about the element that is already wrapped',
      observed.alternatives.every(entry => entry.owner === 'OrdersPage'
        && ['placeOrderButton', 'applyCouponButton'].includes(entry.method)),
      observed.alternatives.map(entry => entry.owner + '.' + entry.method).join(', ') || 'none');
  check('H8: a capability whose declared locator equals the proven one records nothing',
      !observed.alternatives.some(entry => entry.declared === entry.observed));
  check('H9: the same alternative seen twice is one line, not two',
      observed.alternatives.filter(entry => entry.observed.includes('#orders_form')).length === 1,
      observed.alternatives.filter(entry => entry.observed.includes('#orders_form'))
          .map(entry => entry.testCaseId).join(', '));
  check('H10: a DIFFERENT element sharing the method name records nothing about this one',
      !observed.alternatives.some(entry => entry.observed.includes('#refund_order')),
      observed.alternatives.map(entry => entry.observed).join(' | ') || 'no other observation');
  check('H11: a reuse the matcher resolved by NAME is not evidence about this capability',
      !observed.alternatives.some(entry => entry.observed.includes('getByRole')),
      'a name is not an element - only the duplicate gate establishes identity');

  // A PARAMETERISED CAPABILITY declares a template, and a recording of one row proves it
  // with the argument supplied. That is the capability being used, not a rival for it.
  const parameterised = alternativeEvidenceFor({
    applicationId: APP, testCaseId: 'TC_ENR_010', from: 'click row', role: 'action',
    owner: 'OrdersPage', method: 'orderRow',
    observed: 'page.locator(".row").filter({ hasText: "order 1" })',
    knowledge: [{
      file: 'x.yaml', id: 'x', name: 'x', purpose: '', route: '/orders',
      authenticationRequired: false, entryPoint: '', prerequisites: [],
      elements: [{ page_object: 'OrdersPage', page_object_method: 'orderRow',
        locator_strategy: 'page.locator(".row").filter({ hasText: description })' }],
      actions: [], assertions: [], states: [], references: {}, synonyms: new Map(),
      overlays: [], metadata: {}, raw: '', approxTokens: 0,
    }] as any,
    index: { pages: { OrdersPage: { methods: [{ name: 'orderRow', params: [{ name: 'description' }] }] } } } as any,
    resolvedBy: 'element-already-wrapped',
  });
  // FORMATTING IS NOT EVIDENCE. Unreachable end to end - the matcher normalises quoting
  // and spacing before this is ever consulted - so it is pinned where it lives.
  const declaredOnly = { file: 'x.yaml', id: 'x', name: 'x', purpose: '', route: '/orders',
    authenticationRequired: false, entryPoint: '', prerequisites: [],
    elements: [{ page_object: 'OrdersPage', page_object_method: 'placeOrderButton',
      locator_strategy: "page.locator('#place_order')" }],
    actions: [], assertions: [], states: [], references: {}, synonyms: new Map(),
    overlays: [], metadata: {}, raw: '', approxTokens: 0 };
  const declaredIndex = { pages: { OrdersPage: { methods: [{ name: 'placeOrderButton', params: [] }] } } };
  const sameLocator = (expression: string) => alternativeEvidenceFor({
    applicationId: APP, testCaseId: 'TC_ENR_011', from: 'click', role: 'action',
    owner: 'OrdersPage', method: 'placeOrderButton', observed: expression,
    knowledge: [declaredOnly] as any, index: declaredIndex as any,
    resolvedBy: 'element-already-wrapped',
  });
  check('H13: the same locator written with other quotes or spacing is not new evidence',
      sameLocator('page.locator("#place_order")') === null
        && sameLocator("page.locator( '#place_order' )") === null
        && sameLocator('page.locator("#other")') !== null,
      'quoting and spacing are formatting; a different selector is evidence');

  check('H12: an instantiated parameter template is the capability being used, not a rival',
      parameterised === null, parameterised ? JSON.stringify(parameterised) : 'nothing recorded');

  /* ------------------ I. the write fails closed, and proves what it left behind (P13.4) */
  section('I. pre-write validation and post-write verification');

  const { applyProposals: apply, artefactSnapshot, enrichmentRefusals, postWriteVerification }
    = await import('../autocode/abstraction/writer');
  const { readAllPageKnowledge: readKnowledge } = await import('../knowledge/page-knowledge');
  const scopeNow = activeScope();
  const knowledgeNow = readKnowledge();
  const template = analyseCorpus().proposals.find(entry => entry.status === 'PROPOSED');
  /** A proposal shaped like a sound one, with exactly one thing wrong with it. */
  const spoiled = (change: Record<string, unknown>): any => ({
    ...(template ?? {}),
    status: 'PROPOSED', owner: 'OrdersPage', method: 'newCapabilityButton',
    template: 'page.locator("#new_capability")', expression: 'page.locator("#new_capability")',
    proof: { matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press' },
    fingerprint: 'spoiled', role: 'action', ...change,
  });
  const emptyIndex = { pages: {}, fixtures: [], support: {} } as any;
  const refusalsFor = (proposal: any, files?: any, index: any = emptyIndex) => enrichmentRefusals(proposal, {
    knowledge: knowledgeNow,
    index,
    files: files ?? {
      pages: path.join(scopeNow.paths.pagesDir, 'orders.page.ts'),
      knowledge: path.join(scopeNow.paths.knowledgePageDir, APP + '__orders.yaml'),
      fixtures: scopeNow.paths.fixturesFile,
    },
  });

  check('H14: a proposal with no deterministic locator is refused before any write',
      refusalsFor(spoiled({ template: null, expression: null })).some(problem => /no deterministic locator/.test(problem)),
      refusalsFor(spoiled({ template: null, expression: null })).join(' | ') || 'not refused');

  check('H15: a write that would land outside the active application is refused',
      refusalsFor(spoiled({}), {
        pages: path.join(TEMP, 'somewhere-else', 'orders.page.ts'),
        knowledge: path.join(scopeNow.paths.knowledgePageDir, APP + '__orders.yaml'),
        fixtures: scopeNow.paths.fixturesFile,
      }).some(problem => /outside the active application/.test(problem)));

  check('H16: a proposal with no press-time proof is refused before any write',
      refusalsFor(spoiled({ proof: null })).some(problem => /no press-time proof/.test(problem)));

  // The capability is DECLARED in knowledge and absent from the class - an inconsistent
  // state in which appending would declare it twice, differently. Where the method does
  // exist, the same proposal is an idempotent re-run and the writer skips it.
  check('H17: a proposal that would change an established capability is refused',
      refusalsFor(spoiled({ method: 'placeOrderButton', template: 'page.locator("#somewhere_else")',
        expression: 'page.locator("#somewhere_else")' }))
          .some(problem => /never replaced by a later recording/.test(problem)));

  check('H22: a match on a NAME cannot authorise a write - only proof at the interaction can',
      refusalsFor(spoiled({ proof: { matchCount: 1, identityMatched: false, sameDocument: true, measuredAt: 'press' } }))
          .some(problem => /no press-time proof/.test(problem))
        && refusalsFor(spoiled({ proof: { matchCount: 2, identityMatched: true, sameDocument: true, measuredAt: 'press' } }))
            .some(problem => /no press-time proof/.test(problem)),
      'one element, the interaction\'s own document, and that element is the one acted on');

  check('H23: descriptive prose cannot authorise a capability',
      refusalsFor(spoiled({ template: '#new_capability - the button, with the id as a fallback',
        expression: null })).some(problem => /never from a description/.test(problem)));

  check('H24: a sound proposal is refused by none of it',
      refusalsFor(spoiled({})).length === 0, refusalsFor(spoiled({})).join(' | '));

  // ---- The write that IS permitted, and what it must leave behind.
  const beforeWrite = readStore();
  const knowledgeSnapshot = readKnowledge();
  const artefacts = artefactSnapshot();
  check('H18: a permitted write passes post-write verification',
      postWriteVerification(knowledgeSnapshot, artefacts, new Set()).length === 0,
      postWriteVerification(knowledgeSnapshot, artefacts, new Set()).join(' | ') || 'nothing unintended');

  // ---- A corrupted result is DETECTED. Every defect reachable today is refused before
  //      the write, so the only way to show the second half works is to corrupt the
  //      result and ask.
  const knowledgeFile = path.join(scopeNow.paths.knowledgePageDir, APP + '__orders.yaml');
  const original = fs.readFileSync(knowledgeFile, 'utf8');
  fs.writeFileSync(knowledgeFile,
      original.replace("page.locator('#place_order')", "page.locator('#something_else')"), 'utf8');
  const detected = postWriteVerification(knowledgeSnapshot, artefacts, new Set());
  fs.writeFileSync(knowledgeFile, original, 'utf8');
  check('H19: a corrupted result is detected - the established capability no longer declares what it did',
      detected.some(problem => /no longer declares what it declared/.test(problem))
        && detected.some(problem => /did not intend to write it/.test(problem)),
      detected.join(' | ') || 'not detected');
  check('H19b: and the check is clean again once the corruption is undone',
      postWriteVerification(knowledgeSnapshot, artefacts, new Set()).length === 0);

  // ---- A refused batch leaves every coupled artefact byte-identical.
  const refused = apply([spoiled({ proof: null })] as any);
  const afterRefusal = readStore();
  check('H20: a refused write leaves knowledge, Page Object and fixtures byte-identical',
      !refused.applied && afterRefusal.knowledge === beforeWrite.knowledge
        && afterRefusal.page === beforeWrite.page && afterRefusal.fixtures === beforeWrite.fixtures,
      refused.reason);

  // IDEMPOTENCY over the whole enrichment, not over one call: the first run may still
  // have an outstanding sound proposal to write (section F refused its BATCH, not it), so
  // what must hold is that a SECOND run over the same corpus writes nothing further.
  apply(analyseCorpus().proposals);
  const settled = readStore();
  const again = apply(analyseCorpus().proposals);
  const afterAgain = readStore();
  check('H21: re-running the whole enrichment over the same corpus writes nothing further',
      !again.applied && afterAgain.knowledge === settled.knowledge
        && afterAgain.page === settled.page && afterAgain.fixtures === settled.fixtures,
      again.reason);

  /* ------------- J. an existing capability is credited only where identity is MEASURED */
  section('J. capability-to-element identity is measured, never inferred (P13.6)');

  /**
   * ONE SCREEN OF ITS OWN, so nothing here disturbs the sections above and nothing above
   * disturbs these. Every check reads the ANALYSIS - which capability the framework says
   * wraps the recorded element, and what it wrote - never a private function.
   */
  const analyseFor = (testCaseId: string) => {
    const analysis = analyseCorpus();
    const proposals = (analysis.proposals as any[])
        .filter(entry => (entry.sightings ?? []).some((s: any) => s.testCaseId === testCaseId));
    return {
      proposals,
      wrapsClaim: proposals.flatMap(p => (p.refusalCodes ?? []))
          .find((r: any) => /already wraps this element/.test(r.detail ?? '')) ?? null,
      alternatives: (analysis.alternatives ?? []) as any[],
      reused: analysis.reused.filter(entry => entry.testCaseId === testCaseId),
      statuses: proposals.map(p => p.status),
    };
  };
  const methodsOn = (file: string) => {
    const full = path.join(activeScope().paths.pagesDir, file);
    const source = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
    return [...source.matchAll(/^ {2}(?:async )?(\w+)\s*\(/gm)].map(m => m[1])
        .filter(name => name !== 'constructor');
  };

  recordPress({ testCaseId: 'TC_ID_001', route: '/identity', name: 'Save',
    id: 'save_btn', expression: 'page.locator("#save_btn")' });
  run();
  check('J0 (setup): the screen is established with exactly one capability',
      methodsOn('identity.page.ts').length === 1, methodsOn('identity.page.ts').join(', '));

  // ---- I1. The same element again, recorded the same way.
  recordPress({ testCaseId: 'TC_ID_002', route: '/identity', name: 'Save',
    id: 'save_btn', expression: 'page.locator("#save_btn")' });
  run();
  check('I1: the same element recorded again adds no second capability',
      methodsOn('identity.page.ts').length === 1, methodsOn('identity.page.ts').join(', '));

  // ---- I2 / I14. The SAME element, reached by a different expression. Nothing about the
  //      two strings says they are one element; the measurement does, and only it.
  recordPress({ testCaseId: 'TC_ID_003', route: '/identity', name: 'Store it',
    id: 'save_btn', expression: 'page.getByRole("button", { name: "Save" })',
    capabilityMeasurements: [{ owner: 'IdentityPage', method: 'saveButton',
      expression: 'page.locator(\'#save_btn\')' }] });
  const differentExpression = analyseFor('TC_ID_003');
  run();
  check('I2: the same element under a different expression is recognised as already wrapped',
      /already wraps this element/.test(differentExpression.wrapsClaim?.detail ?? '')
        || differentExpression.reused.some(entry => entry.pageObject === 'IdentityPage' && entry.method === 'saveButton'),
      differentExpression.wrapsClaim?.detail ?? 'no identity claim was made');
  check('I14: and no duplicate capability is written for it',
      methodsOn('identity.page.ts').length === 1, methodsOn('identity.page.ts').join(', '));

  // ---- I3 / I11 / I12. The shape that produced every false positive Phase 13.5 measured:
  //      a shared framework class, two different containers, nothing measured about either.
  recordPress({ testCaseId: 'TC_ID_004', route: '/identity', name: 'Panel A action',
    expression: 'page.locator("#panel_a .btn-primary")' });
  run();
  recordPress({ testCaseId: 'TC_ID_005', route: '/identity', name: 'Panel B action',
    expression: 'page.locator("#panel_b .btn-primary")' });
  const sharedToken = analyseFor('TC_ID_005');
  const beforeSharedToken = methodsOn('identity.page.ts').length;
  run();
  check('I3: a shared selector token between DIFFERENT elements is not identity',
      sharedToken.wrapsClaim === null, sharedToken.wrapsClaim?.detail ?? '');
  check('I11: and it raises no METHOD_EXISTS for an element nobody measured',
      !sharedToken.proposals.some(p => (p.refusalCodes ?? [])
          .some((r: any) => /already wraps this element/.test(r.detail ?? ''))));
  check('I12: and the legitimate capability it used to suppress is written',
      methodsOn('identity.page.ts').length === beforeSharedToken + 1,
      methodsOn('identity.page.ts').join(', '));

  // ---- I5. The trailing token is the CONTAINER, not the element. This is the shape the
  //      old premise was simply wrong about: getByText contributes no token at all.
  recordPress({ testCaseId: 'TC_ID_006', route: '/identity', name: 'List',
    id: 'list_panel', expression: 'page.locator("#list_panel")' });
  run();
  recordPress({ testCaseId: 'TC_ID_007', route: '/identity', name: 'Widget A',
    expression: 'page.locator("#list_panel").getByText("Widget A")' });
  const containerToken = analyseFor('TC_ID_007');
  check('I5: a container the element merely sits in is not the element',
      containerToken.wrapsClaim === null, containerToken.wrapsClaim?.detail ?? '');

  // ---- I4. Two different elements sharing an accessible name. A name is not identity,
  //      and the corpus proved a shared name binds page-wide.
  recordPress({ testCaseId: 'TC_ID_008', route: '/identity', name: 'Close',
    expression: 'page.locator("#modal_one .close")' });
  run();
  recordPress({ testCaseId: 'TC_ID_009', route: '/identity', name: 'Close',
    expression: 'page.locator("#modal_two .close")' });
  const sharedName = analyseFor('TC_ID_009');
  check('I4a: two different elements sharing one accessible name are not one element',
      sharedName.wrapsClaim === null, sharedName.wrapsClaim?.detail ?? '');

  // The name basis on its own. This element's name NAMES an established capability - a
  // resemblance any name-matching resolver would act on - and it is a different element.
  recordPress({ testCaseId: 'TC_ID_014', route: '/identity', name: 'Save draft',
    expression: 'page.locator("#drafts .save-draft")' });
  const resemblingName = analyseFor('TC_ID_014');
  check('I4b: an element whose NAME names an established capability is not that element',
      resemblingName.wrapsClaim === null, resemblingName.wrapsClaim?.detail ?? '');
  check('I10a: and nothing is attributed to a capability on the strength of that name',
      sharedName.alternatives.every(entry => entry.method !== 'closeButton'),
      JSON.stringify(sharedName.alternatives));

  // ---- I6. The capability's declared locator could not be resolved at all.
  recordPress({ testCaseId: 'TC_ID_010', route: '/identity', name: 'Unresolvable',
    expression: 'page.locator("#unresolvable_target")',
    capabilityMeasurements: [{ owner: 'IdentityPage', method: 'saveButton',
      expression: 'page.locator(\'#save_btn\')', matchCount: null, identityMatched: false,
      measurementError: 'the expression could not be counted' }] });
  const unresolved = analyseFor('TC_ID_010');
  check('I6: a declared locator that could not be resolved proves nothing',
      unresolved.wrapsClaim === null, unresolved.wrapsClaim?.detail ?? '');

  // ---- I7. It resolved several elements and the recorded one was not singled out.
  recordPress({ testCaseId: 'TC_ID_011', route: '/identity', name: 'Ambiguous',
    expression: 'page.locator("#ambiguous_target")',
    capabilityMeasurements: [{ owner: 'IdentityPage', method: 'saveButton',
      expression: 'page.locator(\'#save_btn\')', matchCount: 3, identityMatched: false }] });
  const ambiguous = analyseFor('TC_ID_011');
  check('I7: several resolved elements with no identity answer prove nothing',
      ambiguous.wrapsClaim === null, ambiguous.wrapsClaim?.detail ?? '');

  // ---- I8b. The answer came from a document the interaction did not happen in. A
  //      measurement of some later page is a measurement of a different page.
  recordPress({ testCaseId: 'TC_ID_013', route: '/identity', name: 'Elsewhere',
    expression: 'page.locator("#elsewhere_target")',
    capabilityMeasurements: [{ owner: 'IdentityPage', method: 'saveButton',
      expression: "page.locator('#save_btn')", sameDocument: false }] });
  const otherDocument = analyseFor('TC_ID_013');
  check('I8b: a measurement taken in another document proves nothing',
      otherDocument.wrapsClaim === null, otherDocument.wrapsClaim?.detail ?? '');

  // ---- I10b. Attribution happens exactly where identity was established, and carries the
  //      OTHER expression this recording proved - which is the whole point of retaining it.
  const provenAlternative = analyseFor('TC_ID_003').alternatives
      .find(entry => entry.owner === 'IdentityPage' && entry.method === 'saveButton');
  check('I10b: alternative evidence is attributed only after identity is proven',
      Boolean(provenAlternative) && /getByRole/.test(provenAlternative.observed ?? ''),
      JSON.stringify(provenAlternative ?? null));

  // ---- I13. The stronger resolver is untouched: an exact proven expression still resolves.
  const { findMethodByProvenLocator: findByProven } = await import('../autocode/from-recording');
  const identityEvidence = {
    locator: 'page.getByRole(\'button\', { name: \'Save\', exact: true })',
    target: { tag: 'button', role: 'button', accessibleName: 'Save', id: 'save_btn' },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1,
    derivedCandidates: [{ strategy: 'stable-id', expression: 'page.locator("#save_btn")',
      matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press' }],
  } as any;
  const stillResolves = findByProven(identityEvidence, readKnowledge(), buildIndex(), 'action');
  check('I13: the exact-expression resolver still resolves what it always did',
      stillResolves?.method === 'saveButton', JSON.stringify(stillResolves ?? null));

  // ---- I8. A capability belongs to its application and to no other.
  useApplication(OTHER_APP);
  const otherKnowledge = readKnowledge();
  recordPress({ testCaseId: 'TC_ID_012', route: '/identity', name: 'Save',
    id: 'save_btn', expression: 'page.locator("#save_btn")' });
  const acrossApplications = analyseFor('TC_ID_012');
  check('I8: another application\'s capability is never credited with this element',
      acrossApplications.wrapsClaim === null
        && otherKnowledge.every(page => page.elements.every(el => el.page_object !== 'IdentityPage')),
      acrossApplications.wrapsClaim?.detail ?? `${otherKnowledge.length} page(s) of knowledge`);
  useApplication(APP);

  // ---- I9. A parameterised capability and an instantiated row are not rivals.
  check('I9: a parameterised capability keeps its structural match',
      (() => {
        const rows = analyseCorpus().proposals.filter((p: any) => p.parameterised);
        return rows.every((p: any) => p.status !== 'PROPOSED' || !p.template
          || !readKnowledge().some(page => page.elements.some(el =>
            (el.locator_strategy ?? '').replace(/["']/g, '"') === p.template.replace(/["']/g, '"'))));
      })(), 'no parameterised proposal duplicates a declared template');

  // ---- I15 / I16. THE MEASUREMENT ITSELF, in the interaction path.
  //
  // A stub frame, because this is the one production function whose whole job is to ask a
  // browser a question. It models exactly what a browser answers: which nodes an expression
  // resolves to, and whether one of them IS the node that was pressed. Everything else -
  // the faithful rebuild, the document guard, the identity comparison, the proof bar - is
  // the production path, unchanged and shared with every other expression measurement.
  const { measureDeclaredCapabilities, resetCapabilityCache } = await import('../dashboard/live-recorder');
  const { provesIdentity: provesIt } = await import('../autocode/dom-evidence');
  const pressedNode = { node: 'pressed' };
  const someOtherNode = { node: 'other' };
  const stubFrame = (resolves: Record<string, object[]>) => {
    const make = (expression: string): any => ({
      async count() { return (resolves[expression] ?? []).length; },
      async elementHandles() {
        return (resolves[expression] ?? []).map(node => ({ node, dispose: async () => {} }));
      },
      locator: (selector: string) => make(expression + '.locator(' + selector + ')'),
      filter: (options: any) => make(expression + '.filter(' + JSON.stringify(options) + ')'),
      getByRole: (role: string, options?: any) =>
        make(expression + '.getByRole(' + role + JSON.stringify(options ?? {}) + ')'),
      getByText: (text: string) => make(expression + '.getByText(' + text + ')'),
      getByLabel: (text: string) => make(expression + '.getByLabel(' + text + ')'),
      getByPlaceholder: (text: string) => make(expression + '.getByPlaceholder(' + text + ')'),
      getByTestId: (text: string) => make(expression + '.getByTestId(' + text + ')'),
      getByAltText: (text: string) => make(expression + '.getByAltText(' + text + ')'),
      getByTitle: (text: string) => make(expression + '.getByTitle(' + text + ')'),
      nth: (index: number) => make(expression + '.nth(' + index + ')'),
      first: () => make(expression + '.first()'),
      last: () => make(expression + '.last()'),
    });
    return {
      locator: (selector: string) => make('page.locator(' + selector + ')'),
      getByRole: (role: string, options?: any) =>
        make('page.getByRole(' + role + JSON.stringify(options ?? {}) + ')'),
      getByText: (text: string) => make('page.getByText(' + text + ')'),
      getByLabel: (text: string) => make('page.getByLabel(' + text + ')'),
      getByPlaceholder: (text: string) => make('page.getByPlaceholder(' + text + ')'),
      getByTestId: (text: string) => make('page.getByTestId(' + text + ')'),
      getByAltText: (text: string) => make('page.getByAltText(' + text + ')'),
      getByTitle: (text: string) => make('page.getByTitle(' + text + ')'),
      // The parked node this interaction is about. Handed back by the production reader,
      // which refuses a node from any document but the one that parked it.
      evaluateHandle: async () => ({ asElement: () => ({ node: pressedNode, dispose: async () => {} }) }),
      // SAME_NODE_IN_PAGE, as the page answers it: identity, not resemblance.
      evaluate: async (_fn: any, args: any) =>
        (Array.isArray(args) && args.length === 2 ? args[0]?.node === args[1]?.node : null),
    };
  };

  resetCapabilityCache();
  const atPress = await measureDeclaredCapabilities(stubFrame({
    'page.locator(#place_order)': [pressedNode],
    'page.locator(#apply_coupon)': [someOtherNode],
  }), { targetIndex: 0, documentId: 'doc1' });
  const askedAbout = atPress.map((m: any) => m.capability.owner + '.' + m.capability.method);
  check('I15: the interaction measures the declared capabilities of the ACTIVE application',
      askedAbout.includes('OrdersPage.placeOrderButton')
        && askedAbout.includes('OrdersPage.applyCouponButton')
        && atPress.every((m: any) => m.measuredAt === 'press' && m.capability),
      askedAbout.join(', ') || 'nothing was measured');
  const provenHere = atPress.filter((m: any) => provesIt(m, 'action'))
      .map((m: any) => m.capability.owner + '.' + m.capability.method);
  check('I16: only the capability that resolved to the PRESSED node is proven',
      provenHere.length === 1 && provenHere[0] === 'OrdersPage.placeOrderButton',
      provenHere.join(', ') || 'nothing was proven');
  // Only a capability that DECLARES AN EXPRESSION can be measured at all. Prose describes
  // an element and states no locator, so there is nothing to resolve and nothing is asked.
  const declaresExpression = readKnowledge().flatMap(page => page.elements).filter(element =>
    element.page_object && element.page_object_method
      && /^page\s*\./.test((element.locator_strategy ?? '').trim()));
  check('I17: exactly the capabilities that declare an EXPRESSION are measured, and no others',
      atPress.length === declaresExpression.length
        && atPress.every((m: any) => /^page\s*\./.test(m.expression)),
      atPress.length + ' measured against ' + declaresExpression.length + ' that declare one');
  resetCapabilityCache();

  /* -------------------------------------------------- G. what enrichment is FOR */
  section('G. the enriched knowledge is what the next recording reuses');

  const knowledge = readAllPageKnowledge();
  const index = buildIndex();
  const reuse = findMethodByProvenLocator({
    locator: 'page.locator("#apply_coupon")',
    target: { tag: 'button', role: 'button', accessibleName: 'Apply coupon' },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1,
    derivedCandidates: [{
      strategy: 'stable-id', expression: 'page.locator("#apply_coupon")',
      matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press',
    }],
    rejectedCandidates: [],
  } as any, knowledge, index, 'action');
  check('G1: the capability added by enrichment is reused by a later recording',
      reuse?.pageObject === 'OrdersPage' && reuse?.method === 'applyCouponButton',
      reuse ? `${reuse.pageObject}.${reuse.method}()` : 'no reuse');
  check('G2: the screen now declares every capability it has learned',
      countOf(afterRival.knowledge, /page_object_method:/g) === 2,
      `${countOf(afterRival.knowledge, /page_object_method:/g)} capabilities`);
}

main()
    .then(() => {
      endIsolation();
      process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
      process.exit(failures ? 1 : 0);
    })
    .catch(error => {
      endIsolation();
      process.stdout.write(`FAIL  the fixture threw: ${String(error?.message ?? error)}\n`);
      process.exit(1);
    });
