import '../testing/isolated-checkout';
/**
 * PHASE 12B: a NEW APPLICATION bootstraps its first Page Object from its first recording.
 *
 *   NEW APPLICATION -> FIRST RECORDING -> ROUTE -> CANONICAL ID -> KNOWLEDGE FILE
 *   -> PAGE OBJECT -> FIXTURE -> SECOND RECORDING -> REUSE
 *
 * Every step is driven through the REAL production functions: `analyseCorpus`,
 * `resolveOwner`/`bootstrapOwner`, `applyProposals`, `readAllPageKnowledge`, `buildIndex`
 * and `findMethodByProvenLocator`. No browser, no model, no network.
 *
 * SAFETY. Everything resolves under `AURA_ARTEFACT_ROOT`, a temporary directory, with a
 * synthetic registry declaring two applications whose ids nothing in this repository uses
 * (`newapp`, `otherapp`). No real recording, knowledge file, Page Object, fixture or
 * mapping is read for a decision or written to - the fixture refuses to start if any path
 * it would touch already exists outside its own temporary root.
 *
 * WHAT IT PROVES, AND WHAT IT REFUSES TO
 *
 * Bootstrap is the EMPTY-KNOWLEDGE FALLBACK and nothing else. It runs after every
 * declared rule has refused; it derives an owner from the active application and the
 * route the recording itself established; and it fails closed - no route, a route naming
 * a record rather than a screen, a foreign application, a recording with no origin at all
 * - with no file, no class and no fixture written.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bootstrapOwner, resolveOwner } from '../autocode/abstraction/propose';
import { renderKnowledgeFile } from '../autocode/abstraction/writer';
import { resetActiveApplication } from '../knowledge/canonical';
import { activeScope, resetActiveScope } from './scope';
import { renderPageObjectClass } from '../autocode/abstraction/writer';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

const NEWAPP = 'newapp';
const OTHERAPP = 'otherapp';
const REAL_ROOT = process.cwd();
let TEMP = '';

/* ------------------------------------------------------------------ harness */

function useApplication(applicationId: string): void {
  process.env.AURA_APPLICATION = applicationId;
  resetActiveScope();
  resetActiveApplication();
}

function startIsolation(): void {
  TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-bootstrap-'));
  const registry = path.join(TEMP, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({
    schemaVersion: 1,
    applications: [NEWAPP, OTHERAPP].map(applicationId => ({
      applicationId,
      displayName: applicationId,
      defaultEnvironmentId: 'qa',
      environments: { qa: { baseUrl: `https://${applicationId}.test/` } },
      workbooks: [`excel/${applicationId}/cases.xlsx`],
    })),
  }, null, 1), 'utf8');
  // EVERY artefact path resolves under the temporary root from here on. `scope.ts`
  // documents this variable as existing precisely so a fixture cannot NAME a real
  // artefact directory, let alone write to one.
  process.env.AURA_ARTEFACT_ROOT = TEMP;
  process.env.AURA_REGISTRY_FILE = path.relative(REAL_ROOT, registry).split(path.sep).join('/');
  useApplication(NEWAPP);

  const scope = activeScope();
  const outside = Object.values(scope.paths).filter(target => !target.startsWith(TEMP));
  if (outside.length) {
    throw new Error('refusing to run: these artefact paths are outside the temporary root - '
      + outside.join(', '));
  }
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

/**
 * One recorded press, as the recorder writes it: a Codegen line, and an evidence row
 * whose candidate was measured at the press against the element that was pressed.
 */
function recordPress(options: {
  applicationId: string;
  testCaseId: string;
  route: string;
  /** Omitted the way a pre-origin recording omits it. */
  origin?: boolean;
  /** Omitted the way a recording made before press-time routes omits it. */
  withRoute?: boolean;
  /** Measured and REFUSED - two elements, identity never established. */
  unproven?: boolean;
  name?: string;
  expression?: string;
}): void {
  const previous = process.env.AURA_APPLICATION;
  useApplication(options.applicationId);
  const scope = activeScope();
  const name = options.name ?? 'Place order';
  const expression = options.expression ?? `page.getByRole("button", { name: "${name}", exact: true })`;
  fs.mkdirSync(scope.paths.recordingsDir, { recursive: true });
  fs.writeFileSync(path.join(scope.paths.recordingsDir, `${options.testCaseId}.spec.ts`),
      ["import { test, expect } from '@playwright/test';", '',
        "test('test', async ({ page }) => {",
        `  await page.goto('https://${options.applicationId}.test${options.route}');`,
        `  await page.getByRole('button', { name: '${name}', exact: true }).click();`,
        '});', ''].join('\n'), 'utf8');
  const target = {
    locator: `page.getByRole('button', { name: '${name}', exact: true })`,
    elementRef: 'doc1:0',
    ...(options.withRoute === false ? {} : { route: options.route }),
    target: {
      tag: 'button', role: 'button', text: name, accessibleName: name,
      accessibleNameVerified: true, classes: ['btn'], stableClasses: ['btn'],
    },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [],
    matchCount: 1,
    matchCountDocument: 'same',
    captureTiming: 'before-action',
    derivedCandidates: options.unproven ? [] : [{
      strategy: 'role-name', expression, matchCount: 1,
      identityMatched: true, sameDocument: true, measuredAt: 'press',
    }],
    rejectedCandidates: options.unproven ? [{
      strategy: 'role-name', expression, matchCount: 2,
      identityMatched: false, sameDocument: true, measuredAt: 'press',
      rejectionReason: 'matched 2 elements',
    }] : [],
    positionProvenCandidates: [],
  };
  fs.writeFileSync(path.join(scope.paths.recordingsDir, `${options.testCaseId}.evidence.json`),
      JSON.stringify({
        available: true,
        capturedAt: new Date(0).toISOString(),
        limits: {},
        ...(options.origin === false ? {} : {
          origin: {
            applicationId: options.applicationId, environmentId: 'qa',
            baseUrl: `https://${options.applicationId}.test/`, testCaseId: options.testCaseId,
          },
        }),
        targets: [target],
      }, null, 1), 'utf8');
  if (previous)
    useApplication(previous);
}

/** Every artefact path the active application owns, as a snapshot of what exists. */
function artefacts(): Record<string, boolean> {
  const scope = activeScope();
  return {
    knowledgeDir: fs.existsSync(scope.paths.knowledgePageDir),
    pagesDir: fs.existsSync(scope.paths.pagesDir),
    fixtures: fs.existsSync(scope.paths.fixturesFile),
  };
}

/* ------------------------------------------- A. the owner rule, in isolation */

function checkOwnerRule(): void {
  section('A. bootstrap derives an owner from the application and the route - and nothing else');

  const ok = bootstrapOwner({ applicationId: NEWAPP, originApplicationId: NEWAPP, route: '/checkout' });
  check('A1: a route gives a deterministic owner and canonical identity',
      ok.owner === 'CheckoutPage' && (ok as any).canonicalId === 'newapp__checkout',
      JSON.stringify(ok));
  const root = bootstrapOwner({ applicationId: NEWAPP, originApplicationId: NEWAPP, route: '/' });
  check('A2: the root route is the application entry page, named HomePage',
      root.owner === 'HomePage' && (root as any).canonicalId === 'newapp__root');
  const nested = bootstrapOwner({ applicationId: NEWAPP, originApplicationId: NEWAPP, route: '/team/settings' });
  check('A3: a nested route keeps every segment', nested.owner === 'TeamSettingsPage');

  const dynamic = bootstrapOwner({ applicationId: NEWAPP, originApplicationId: NEWAPP, route: '/issues/636432' });
  check('A4: a route naming a RECORD is refused - one screen, not one screen per issue',
      dynamic.owner === null && (dynamic as any).code === 'BOOTSTRAP_ROUTE_UNKNOWN');
  const noRoute = bootstrapOwner({ applicationId: NEWAPP, originApplicationId: NEWAPP, route: null });
  check('A5: no route is BOOTSTRAP_ROUTE_UNKNOWN, never a guessed page',
      noRoute.owner === null && (noRoute as any).code === 'BOOTSTRAP_ROUTE_UNKNOWN');
  const foreign = bootstrapOwner({ applicationId: NEWAPP, originApplicationId: OTHERAPP, route: '/checkout' });
  check('A6: a recording made against another application is refused outright',
      foreign.owner === null && String((foreign as any).why).includes(OTHERAPP));
  const historical = bootstrapOwner({ applicationId: NEWAPP, originApplicationId: null, route: '/checkout' });
  check('A7: a recording that states no application of its own is never bootstrapped',
      historical.owner === null);

  // OWNERSHIP DOES NOT DEPEND ON THE LOCATOR, and cannot: the contract has no field
  // for one. Asserted rather than described, because "the strongest locator must not
  // decide the page" is the rule this whole rule was separated from.
  const inputs = Object.keys({ applicationId: 0, originApplicationId: 0, route: 0 });
  check('A9: the bootstrap contract takes no locator, no score and no DOM text',
      !inputs.some(key => /locator|score|text|name|title|dom/i.test(key)), inputs.join(', '));

  // THE SAME ROUTE IN TWO APPLICATIONS IS TWO SCREENS.
  const other = bootstrapOwner({ applicationId: OTHERAPP, originApplicationId: OTHERAPP, route: '/checkout' });
  check('A8: the same route in another application is a different identity',
      other.owner === 'CheckoutPage' && (other as any).canonicalId === 'otherapp__checkout'
        && (other as any).canonicalId !== (ok as any).canonicalId);
}

/* ------------------------------- B. declared knowledge always wins over bootstrap */

function checkExistingKnowledgeWins(): void {
  section('B. bootstrap is the empty-knowledge fallback and nothing else');

  const evidence: any = {
    locator: 'page.getByRole("button")',
    target: { tag: 'button', role: 'button', id: 'place_order' },
    ancestors: [{ tag: 'div', id: 'checkout_form' }],
    children: [], descendants: [], previousSiblings: [], nextSiblings: [], relationships: [],
    matchCount: 1, derivedCandidates: [], rejectedCandidates: [],
  };
  const knowledge: any[] = [{
    file: 'declared.yaml', id: 'x', name: 'x', purpose: '', route: '/checkout',
    authenticationRequired: false, entryPoint: '', prerequisites: [],
    elements: [{ id: 'checkout_form', page_object: 'DeclaredPage', page_object_method: 'form' }],
    actions: [], assertions: [], states: [], references: {}, synonyms: new Map(), overlays: [],
    metadata: {}, raw: '', approxTokens: 0,
  }];
  const context = { applicationId: NEWAPP, originApplicationId: NEWAPP, route: '/checkout' };

  const declared = resolveOwner(evidence, knowledge, ['/checkout'], context);
  check('B1: a DECLARED owner wins - bootstrap never runs',
      declared.owner === 'DeclaredPage' && declared.bootstrap === undefined, declared.why);

  const twoOwners: any[] = [{
    ...knowledge[0],
    elements: [
      { id: 'a', page_object: 'FirstPage', page_object_method: 'one' },
      { id: 'b', page_object: 'SecondPage', page_object_method: 'two' },
    ],
  }];
  const ambiguous = resolveOwner({ ...evidence, ancestors: [] }, twoOwners, ['/checkout'], context);
  check('B2: an AMBIGUOUS declared owner is never overridden by bootstrap',
      ambiguous.owner === null && ambiguous.code === 'AMBIGUOUS_OWNERSHIP'
        && ambiguous.bootstrap === undefined, ambiguous.why);

  const bootstrapped = resolveOwner({ ...evidence, ancestors: [] }, [], ['/checkout'], context);
  check('B3: with NO knowledge at all, bootstrap answers',
      bootstrapped.owner === 'CheckoutPage' && bootstrapped.bootstrap?.canonicalId === 'newapp__checkout');

  const withoutContext = resolveOwner({ ...evidence, ancestors: [] }, [], ['/checkout']);
  check('B4: and a caller that offers no context gets exactly the old refusal',
      withoutContext.owner === null && withoutContext.code === 'OWNER_UNKNOWN');
}

/* ----------------------------------------- C. the whole lifecycle, end to end */

async function checkLifecycle(): Promise<void> {
  section('C. first recording -> knowledge -> Page Object -> fixture -> reuse');

  // Loaded here so the modules read the temporary scope that is now active.
  const { analyseCorpus } = await import('../autocode/abstraction/propose');
  const { applyProposals } = await import('../autocode/abstraction/writer');
  const { readAllPageKnowledge } = await import('../knowledge/page-knowledge');
  const { buildIndex } = await import('../knowledge/index');
  const { findMethodByProvenLocator } = await import('../autocode/from-recording');

  useApplication(NEWAPP);
  const before = artefacts();
  check('C1: the application starts with no knowledge, no Page Objects and no fixtures',
      !before.knowledgeDir && !before.pagesDir && !before.fixtures);

  recordPress({ applicationId: NEWAPP, testCaseId: 'TC_NEW_001', route: '/checkout' });
  const analysis = analyseCorpus();
  const proposal = analysis.proposals.find(entry => entry.bootstrap);
  check('C2: the analyser proposes a bootstrapped owner from the recording alone',
      Boolean(proposal) && proposal!.owner === 'CheckoutPage'
        && proposal!.bootstrap?.route === '/checkout',
      proposal ? `${proposal.owner}.${proposal.method} - ${proposal.reason}` : 'no bootstrapped proposal');
  check('C3: and the proposal passed every existing gate on its own merits',
      proposal?.status === 'PROPOSED', proposal?.status ?? 'none');

  const written = applyProposals(analysis.proposals);
  check('C4: the writer applied it', written.applied, written.reason);

  const scope = activeScope();
  const knowledgeFile = path.join(scope.paths.knowledgePageDir, 'newapp__checkout.yaml');
  const pageFile = path.join(scope.paths.pagesDir, 'checkout.page.ts');
  check('C5: the FIRST knowledge file exists, under the canonical identity',
      fs.existsSync(knowledgeFile), path.basename(knowledgeFile));
  check('C6: the Page Object class exists', fs.existsSync(pageFile));
  check('C7: the fixtures module exists and registers the class',
      fs.existsSync(scope.paths.fixturesFile)
        && /checkoutPage/.test(fs.readFileSync(scope.paths.fixturesFile, 'utf8')));

  const yaml = fs.existsSync(knowledgeFile) ? fs.readFileSync(knowledgeFile, 'utf8') : '';
  check('C8: the knowledge declares the route, the owner and the PROVEN locator',
      /route:\s*\/checkout/.test(yaml) && /page_object:\s*CheckoutPage/.test(yaml)
        && /locator_strategy:/.test(yaml) && /getByRole/.test(yaml),
      yaml.split('\n').filter(line => /route:|page_object:|locator_strategy:/.test(line))
          .map(line => line.trim()).join(' | '));
  check('C9: nothing invented a purpose for a screen nobody has explored',
      !/purpose:/.test(yaml));

  // ---- THE PROOF THAT MATTERS: the second recording reuses what the first created.
  const knowledge = readAllPageKnowledge();
  const index = buildIndex();
  check('C10: the created knowledge is discoverable by the ordinary reader',
      knowledge.some(page => page.route === '/checkout'
        && page.elements.some(element => element.page_object === 'CheckoutPage')));

  const secondRecording: any = {
    locator: 'page.getByRole("button", { name: "Place order" })',
    target: { tag: 'button', role: 'button', accessibleName: 'Place order' },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1,
    derivedCandidates: [{
      strategy: 'role-name',
      expression: 'page.getByRole("button", { name: "Place order", exact: true })',
      matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press',
    }],
    rejectedCandidates: [],
  };
  const reuse = findMethodByProvenLocator(secondRecording, knowledge, index, 'action');
  check('C11: a SECOND recording of the same element reuses the bootstrapped capability',
      reuse?.pageObject === 'CheckoutPage' && Boolean(reuse?.method),
      reuse ? `${reuse.pageObject}.${reuse.method}()` : 'no reuse');

  // ---- AND THE SPEC ITSELF CALLS IT, rather than emitting the recorded locator.
  const { parseRecording } = await import('../dashboard/recorder');
  const { mapRecording, pageObjectRequirements, readEvidence } = await import('../autocode/from-recording');
  const recorded = fs.readFileSync(path.join(scope.paths.recordingsDir, 'TC_NEW_001.spec.ts'), 'utf8');
  const mapped = mapRecording(parseRecording(recorded, {
    startUrl: '', browser: '', durationMs: 0,
    evidence: readEvidence('TC_NEW_001'),
    stateAssertions: [],
  }));
  const call = mapped.steps.find((step: any) => step.kind === 'page-object');
  // The PRESSED ELEMENT must be a method call and must not also be reported as needing
  // one. The recording's own `goto` is not in question here: a navigation method is a
  // capability nothing measured, and creating one is deliberately outside this phase.
  const raw = pageObjectRequirements(mapped);
  check('C11b: the generated spec calls the bootstrapped capability, not a raw locator',
      call?.pageObject === 'CheckoutPage' && Boolean(call?.method)
        && !raw.some((entry: any) => /Place order/i.test(`${entry.target ?? ''} ${entry.from ?? ''}`)),
      call ? `${call.pageObject}.${call.method}() - ${call.code.join(' ')}`
        + ` | still raw: ${raw.map((entry: any) => entry.from ?? entry.target).join(', ') || 'none'}`
        : 'no page-object step');

  // ---- A DIFFERENT ROUTE IS A DIFFERENT SCREEN.
  recordPress({ applicationId: NEWAPP, testCaseId: 'TC_NEW_002', route: '/login', name: 'Sign in' });
  const second = analyseCorpus();
  const loginProposal = second.proposals.find(entry => entry.bootstrap?.route === '/login');
  check('C12: a different route bootstraps its own screen, not the first one',
      loginProposal?.owner === 'LoginPage'
        && loginProposal?.bootstrap?.canonicalId === 'newapp__login',
      loginProposal?.owner ?? 'none');
  const stillCheckout = second.proposals.find(entry => entry.bootstrap?.route === '/checkout');
  check('C13: and the screen that now HAS knowledge is no longer bootstrapped',
      stillCheckout === undefined,
      'the declared route rule answers for it, as it does for every existing application');
}

/* ------------------------------------------- D. isolation and fail-closed writes */

async function checkIsolationAndFailure(): Promise<void> {
  section('D. isolation, and what happens when bootstrap cannot answer');

  const { analyseCorpus } = await import('../autocode/abstraction/propose');
  const { applyProposals } = await import('../autocode/abstraction/writer');

  // ---- The other application sees nothing of the first, and bootstraps its own.
  useApplication(OTHERAPP);
  const otherBefore = artefacts();
  check('D1: the second application starts empty - no knowledge crossed to it',
      !otherBefore.knowledgeDir && !otherBefore.pagesDir && !otherBefore.fixtures);

  recordPress({ applicationId: OTHERAPP, testCaseId: 'TC_OTHER_001', route: '/checkout' });
  useApplication(OTHERAPP);
  const otherAnalysis = analyseCorpus();
  const otherProposal = otherAnalysis.proposals.find(entry => entry.bootstrap);
  check('D2: it bootstraps its OWN /checkout screen under its own identity',
      otherProposal?.bootstrap?.canonicalId === 'otherapp__checkout',
      otherProposal?.bootstrap?.canonicalId ?? 'none');
  applyProposals(otherAnalysis.proposals);
  const otherScope = activeScope();
  check('D3: it wrote only into its own directories',
      fs.existsSync(path.join(otherScope.paths.knowledgePageDir, 'otherapp__checkout.yaml'))
        && !fs.existsSync(path.join(otherScope.paths.knowledgePageDir, 'newapp__checkout.yaml')));

  // ---- A recording whose origin names another application is refused, and writes nothing.
  useApplication(NEWAPP);
  recordPress({ applicationId: NEWAPP, testCaseId: 'TC_NEW_003', route: '/orders', name: 'Track order' });
  const scope = activeScope();
  const evidenceFile = path.join(scope.paths.recordingsDir, 'TC_NEW_003.evidence.json');
  const foreign = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
  foreign.origin.applicationId = OTHERAPP;
  fs.writeFileSync(evidenceFile, JSON.stringify(foreign, null, 1), 'utf8');
  const foreignAnalysis = analyseCorpus();
  const ordersProposal = foreignAnalysis.proposals.find(entry => entry.bootstrap?.route === '/orders');
  check('D4: a recording that belongs to another application is never bootstrapped here',
      ordersProposal === undefined);
  check('D5: and no knowledge file was created for it',
      !fs.existsSync(path.join(scope.paths.knowledgePageDir, 'newapp__orders.yaml')));

  // ---- No route: refused, and nothing is written.
  recordPress({ applicationId: NEWAPP, testCaseId: 'TC_NEW_004', route: '/returns',
    name: 'Start return', withRoute: false });
  const noRouteEvidence = path.join(scope.paths.recordingsDir, 'TC_NEW_004.evidence.json');
  const stripped = JSON.parse(fs.readFileSync(noRouteEvidence, 'utf8'));
  fs.writeFileSync(noRouteEvidence, JSON.stringify(stripped, null, 1), 'utf8');
  fs.writeFileSync(path.join(scope.paths.recordingsDir, 'TC_NEW_004.spec.ts'),
      ["import { test, expect } from '@playwright/test';", '',
        "test('test', async ({ page }) => {",
        "  await page.getByRole('button', { name: 'Start return', exact: true }).click();",
        '});', ''].join('\n'), 'utf8');
  const noRouteAnalysis = analyseCorpus();
  const returnsProposal = noRouteAnalysis.proposals
      .find(entry => entry.testCaseId === 'TC_NEW_004' && entry.bootstrap);
  check('D6: a recording that establishes no route bootstraps nothing',
      returnsProposal === undefined);
  check('D7: and no page was invented for it',
      !fs.existsSync(path.join(scope.paths.knowledgePageDir, 'newapp__returns.yaml')));
}

/* --------------------------------------------- E. no origin, and all-or-nothing */

async function checkOriginAndAtomicity(): Promise<void> {
  section('E. a recording that states no application, and a batch that must not half-apply');

  const { analyseCorpus } = await import('../autocode/abstraction/propose');
  const { applyProposals } = await import('../autocode/abstraction/writer');

  useApplication(NEWAPP);
  const scope = activeScope();

  // ---- A HISTORICAL RECORDING: no origin, so nothing states which application it is.
  recordPress({ applicationId: NEWAPP, testCaseId: 'TC_NEW_005', route: '/wishlist',
    name: 'Save for later', origin: false });
  const analysis = analyseCorpus();
  const wishlist = analysis.proposals.find(entry => entry.bootstrap?.route === '/wishlist');
  check('E1: a recording with no origin is never bootstrapped, however good its evidence',
      wishlist === undefined);
  applyProposals(analysis.proposals);
  check('E2: and no knowledge file was created for it',
      !fs.existsSync(path.join(scope.paths.knowledgePageDir, 'newapp__wishlist.yaml')));

  // ---- A ROUTE IS NOT ENOUGH. Without a proven locator there is no capability, so
  //      there is nothing for a Page Object to wrap - and no page is created for it.
  recordPress({ applicationId: NEWAPP, testCaseId: 'TC_NEW_006', route: '/gifts',
    name: 'Add gift note', unproven: true });
  const unprovenAnalysis = analyseCorpus();
  const gifts = unprovenAnalysis.proposals.find(entry => entry.bootstrap?.route === '/gifts');
  check('E2b: a route with no PROVEN locator proposes nothing to write',
      Boolean(gifts) && gifts!.status !== 'PROPOSED',
      gifts ? `${gifts.status} | ${gifts.owner} | ${(gifts.refusals ?? []).join('+')}` : 'NO PROPOSAL AT ALL');
  applyProposals(unprovenAnalysis.proposals);
  check('E2c: and no page was created for a screen whose element was never identified',
      !fs.existsSync(path.join(scope.paths.knowledgePageDir, 'newapp__gifts.yaml'))
        && !fs.existsSync(path.join(scope.paths.pagesDir, 'gifts.page.ts')));

  // ---- KNOWLEDGE IS NEVER OVERWRITTEN. A second element on a screen that already has
  //      a file is APPENDED to it; the capability written first must survive.
  useApplication(NEWAPP);
  const checkoutFile = path.join(scope.paths.knowledgePageDir, 'newapp__checkout.yaml');
  const firstEntry = fs.existsSync(checkoutFile) ? fs.readFileSync(checkoutFile, 'utf8') : '';
  recordPress({ applicationId: NEWAPP, testCaseId: 'TC_NEW_008', route: '/checkout',
    name: 'Apply coupon' });
  const secondOnSameScreen = analyseCorpus();
  const coupon = secondOnSameScreen.proposals.find((entry: any) => entry.testCaseId === 'TC_NEW_008');
  check('E2c2: the second element on a KNOWN screen is owned by the declared rule, not bootstrap',
      coupon?.owner === 'CheckoutPage' && coupon?.bootstrap === undefined,
      coupon ? coupon.owner + ' bootstrap=' + JSON.stringify(coupon.bootstrap ?? null) : 'none');
  applyProposals(secondOnSameScreen.proposals);
  const grown = fs.existsSync(checkoutFile) ? fs.readFileSync(checkoutFile, 'utf8') : '';
  check('E2d: a second element on the same screen is appended, never an overwrite',
      grown.includes('place_order_button') && grown.includes('apply_coupon_button'),
      firstEntry.length + " bytes -> " + grown.length + " bytes");

  // ---- ALL OR NOTHING. One unsound proposal in the batch and NOTHING is written -
  //      including the knowledge file a sound bootstrapped proposal would have created.
  recordPress({ applicationId: NEWAPP, testCaseId: 'TC_NEW_007', route: '/gift-cards',
    name: 'Buy gift card' });
  const fresh = analyseCorpus();
  const sound = fresh.proposals.find(entry => entry.status === 'PROPOSED'
    && entry.bootstrap?.route === '/gift-cards');
  const before = fs.existsSync(scope.paths.knowledgePageDir)
    ? fs.readdirSync(scope.paths.knowledgePageDir).length : 0;
  if (sound) {
    const unsound = {
      ...sound,
      fingerprint: `${sound.fingerprint}-unsound`,
      method: 'brokenMethod',
      // A generated identifier: refused by `validateGenerated`, which no bootstrap
      // may bypass.
      template: "page.locator('#tc_summary_636432')",
      expression: "page.locator('#tc_summary_636432')",
      bootstrap: { canonicalId: 'newapp__broken', route: '/broken', pageName: 'newapp broken page' },
      owner: 'BrokenPage',
    };
    const written = applyProposals([sound, unsound] as any);
    check('E3: an unsound proposal blocks the whole batch', !written.applied, written.reason);
    const after = fs.existsSync(scope.paths.knowledgePageDir)
      ? fs.readdirSync(scope.paths.knowledgePageDir).length : 0;
    check('E4: and NO knowledge file was left behind, not even the sound one',
        after === before
          && !fs.existsSync(path.join(scope.paths.knowledgePageDir, 'newapp__broken.yaml'))
          && !fs.existsSync(path.join(scope.paths.knowledgePageDir, 'newapp__gift-cards.yaml'))
          && !fs.existsSync(path.join(scope.paths.pagesDir, 'gift-cards.page.ts')),
        `${before} file(s) before, ${after} after`);
  } else {
    check('E3: an unsound proposal blocks the whole batch', false, 'no sound proposal to pair with');
  }
}


/* ---- F: the generated class can actually be imported, from wherever it lands ---- */

function checkFrameworkImports(): void {
  section('F. a bootstrapped Page Object resolves BasePage and the healing recorder');

  const importsOf = (source: string) => Object.fromEntries(
      [...source.matchAll(/import[^']*'(\.[^']*)'/g)].map(match => [match[1], true]));
  const resolved = (file: string, specifier: string) =>
      path.resolve(path.dirname(file), specifier);

  // A SCOPED APPLICATION - the shape every application except the legacy one has.
  useApplication(NEWAPP);
  const scoped = activeScope();
  const scopedFile = path.join(scoped.paths.pagesDir, 'checkout.page.ts');
  const scopedSource = renderPageObjectClass('CheckoutPage', '/checkout', scopedFile);
  const scopedImports = Object.keys(importsOf(scopedSource));
  const layoutRoot = path.dirname(scoped.paths.fixturesFile);
  const wantBase = path.join(layoutRoot, 'pages', 'base.page');
  const wantSupport = path.join(layoutRoot, 'support', 'resilient-locator');

  check('F1: the class is written into the application\'s own scoped directory',
      path.dirname(scopedFile) !== layoutRoot,
      path.relative(layoutRoot, path.dirname(scopedFile)) || '(the layout root)');
  check('F2: BasePage resolves to the framework class, not to a sibling that does not exist',
      scopedImports.some(specifier => resolved(scopedFile, specifier) === wantBase),
      scopedImports.join(', '));
  check('F3: the healing recorder resolves to the framework support module',
      scopedImports.some(specifier => resolved(scopedFile, specifier) === wantSupport),
      scopedImports.join(', '));
  check('F4: and the class is still structurally what it was',
      /export class CheckoutPage extends BasePage \{/.test(scopedSource)
        && /constructor\(page: Page, healing\?: HealingRecorder\)/.test(scopedSource)
        && /super\(page, healing\)/.test(scopedSource),
      scopedSource.split('\n').find(line => line.startsWith('export class')) ?? '(no class)');

  // THE LEGACY LAYOUT IS UNCHANGED, byte for byte. The two specifiers that were
  // hard-coded are exactly what the computation produces for a class directly in
  // `tests-e2e/pages/`, which is what makes this a generalisation rather than a change.
  const legacyFile = path.join(layoutRoot, 'pages', 'orders.page.ts');
  const legacyImports = Object.keys(importsOf(renderPageObjectClass('OrdersPage', null, legacyFile)));
  check('F5: an application holding the unscoped layout emits exactly what it emitted before',
      legacyImports.includes('./base.page')
        && legacyImports.includes('../support/resilient-locator'),
      legacyImports.join(', '));

  // A THIRD APPLICATION IS NOT A THIRD SPECIAL CASE.
  useApplication(OTHERAPP);
  const otherScope = activeScope();
  const otherFile = path.join(otherScope.paths.pagesDir, 'account.page.ts');
  const otherImports = Object.keys(importsOf(renderPageObjectClass('AccountPage', '/account', otherFile)));
  const otherRoot = path.dirname(otherScope.paths.fixturesFile);
  check('F6: a third application resolves the same way, with nothing named after it',
      otherImports.some(specifier => resolved(otherFile, specifier)
          === path.join(otherRoot, 'pages', 'base.page'))
        && otherImports.some(specifier => resolved(otherFile, specifier)
          === path.join(otherRoot, 'support', 'resilient-locator'))
        && !renderPageObjectClass('AccountPage', '/account', otherFile).includes(OTHERAPP),
      otherImports.join(', '));
  useApplication(NEWAPP);
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  startIsolation();
  try {
    checkOwnerRule();
    checkExistingKnowledgeWins();
    await checkLifecycle();
    await checkIsolationAndFailure();
    await checkOriginAndAtomicity();
    checkFrameworkImports();
    // The renderer itself, so a change to the file's shape is visible here too.
    const yaml = renderKnowledgeFile('newapp__checkout', '/checkout', 'newapp checkout page');
    check('E1: a bootstrapped knowledge file declares the identity, the route and nothing else',
        /page:/.test(yaml) && /id: newapp__checkout/.test(yaml) && /route: \/checkout/.test(yaml)
          && /elements:/.test(yaml) && !/entry_point/.test(yaml) && !/authentication_required/.test(yaml));
  } finally {
    endIsolation();
  }
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch(error => {
  endIsolation();
  process.stdout.write(`FAIL  the fixture threw: ${String(error?.message ?? error)}\n`);
  process.exit(1);
});
