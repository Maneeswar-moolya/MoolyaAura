/**
 * The AI fallback: what it may be asked, what it may answer, and what is done with it.
 *
 *   npx tsx ai/autocode/abstraction/semantic.fixture.ts
 *
 * NO MODEL IS CALLED HERE. Every exchange goes through a stub transport that also
 * COUNTS its calls, because half of what this file proves is that a model was NOT
 * asked - and a test that cannot tell "answered correctly" from "never asked" proves
 * nothing about minimality.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildIndex } from '../../knowledge/index';
import { readAllPageKnowledge } from '../../knowledge/page-knowledge';
import {
  DECISIONS, SEMANTIC_ENABLED, eligibility, nameProblem, parseRecommendation,
  resolveSemanticReviews, revalidate, type Recommendation, type Transport,
} from './semantic';
import { analyseCorpus, type CorpusResult } from './propose';
import { parameterisationHolds, validateCandidate } from './validate';
import { REFUSAL_CLASS, refuse, type Proposal, type RefusalCode } from './types';

const ROOT = process.cwd();
const AUDIT = path.join(os.tmpdir(), `aura-semantic-fixture-${process.pid}.jsonl`);

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* --------------------------------------------------------------- the fixtures */

const PROVEN = {
  matchCount: 1, identityMatched: true, sameDocument: true,
  measuredAt: 'press', strategy: 'container-text',
  expression: 'page.locator(".tabulator-row").filter({ hasText: "Line Chart" }).locator(".rounded-checkbox-ui")',
};

const ROW_TEMPLATE =
  'page.locator(".tabulator-row").filter({ hasText: description }).locator(".rounded-checkbox-ui")';

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    timestamp: '2026-08-19T00:00:00.000Z', testCaseId: 'TC_X', target: 'click the row checkbox',
    role: 'action', category: 'COMPONENT_MEMBER', rule: 8, status: 'NEEDS_REVIEW',
    owner: 'IssuesPage', ownerKind: 'page-object', method: null,
    parameterised: true, parameterSource: '1 distinct recorded value(s)',
    locatorStrategy: 'container-text', expression: PROVEN.expression, proof: PROVEN,
    reason: 'the values do not differ, so there is nothing to parameterise',
    refusals: ['the values do not differ, so there is nothing to parameterise'],
    refusalCodes: [refuse('CONSTANT_PARAMETER_VALUE',
        'the values do not differ, so there is nothing to parameterise')],
    resolvedBy: 'deterministic', semantic: null, allowedOwners: ['IssuesPage'],
    derivedMethod: 'issueCheckbox', roundTrip: true,
    template: ROW_TEMPLATE, parameterName: 'description', accessibleName: null,
    accessibleNameAmbiguous: false,
    sightings: [{ testCaseId: 'TC_X', from: 'click the row checkbox' }],
    fingerprint: 'issuespage|action|div.tabulator-row||span.rounded-checkbox-ui|parameterised',
    ...overrides,
  };
}

/** A transport that answers with `reply` and counts how many times it was asked. */
function stub(reply: string | ((prompt: string) => string)):
{ transport: Transport; calls: () => number; prompts: string[] } {
  let calls = 0;
  const prompts: string[] = [];
  return {
    transport: async (prompt: string) => {
      calls++;
      prompts.push(prompt);
      return typeof reply === 'function' ? reply(prompt) : reply;
    },
    calls: () => calls,
    prompts,
  };
}

const json = (value: Partial<Recommendation>): string => JSON.stringify({
  decision: 'PARAMETERIZE', owner: 'IssuesPage', methodName: 'issueCheckbox', usage: 'action',
  parameterName: 'description', locatorTemplate: ROW_TEMPLATE,
  reasoning: 'row-scoped reusable capability', confidence: 0.95, ...value,
});

/**
 * A knowledge index that declares exactly the methods named, and nothing else.
 *
 * The creation cases must be able to say "this capability does not exist yet" and
 * mean it. Reading the real index made that a statement about the repository - and
 * once `issueCheckbox` was genuinely created, every creation test flipped to REUSE
 * and reported a failure that was really the loop working.
 */
const indexWith = (...methods: string[]) => ({
  pages: {
    IssuesPage: { methods: methods.map(name => ({ name })) },
    NotificationsPanel: { methods: [] },
    WorkspacePage: { methods: [] },
    ProjectsPage: { methods: [] },
  },
} as never);

/** Run the pass over one proposal and report what happened to it. */
async function run(input: Proposal, reply: string, index = indexWith()):
Promise<{ proposal: Proposal; calls: number; outcome: string }> {
  const asked = stub(reply);
  const result: CorpusResult = { proposals: [input], reused: [], unmeasured: [], counts: {} };
  // `memo: false` so an earlier run's audit log can never decide this fixture's answer.
  const pass = await resolveSemanticReviews(result, {
    transport: asked.transport, model: 'stub-model', auditLog: AUDIT, index, memo: false,
  });
  return { proposal: result.proposals[0], calls: asked.calls(), outcome: pass.audits[0]?.outcome ?? 'NOT_ASKED' };
}

/* ------------------------------------------- A-C, F-H: when AI is NOT called ---- */

async function checkNotCalled(): Promise<void> {
  process.stdout.write('\n== the normal path costs no model call ==\n');

  // A / B / C: everything the deterministic engine settled. REUSE is what an existing
  // method (parameterised or not) produces, PROPOSED is the safe new Page Object.
  for (const [label, status] of [
    ['A: an existing Page Object (REUSE)', 'REUSE'],
    ['C: a deterministically safe new Page Object (PROPOSED)', 'PROPOSED'],
  ] as Array<[string, Proposal['status']]>) {
    const settled = await run(proposal({ status }), json({}));
    check(`${label} is never asked about`, settled.calls === 0, `${settled.calls} call(s)`);
  }
  // B: a parameterised method that already exists reaches REUSE carrying the
  // structural code that says so, and STRUCTURAL is never a question for a resolver.
  const reused = proposal({
    status: 'REUSE', method: 'issueCheckboxState', role: 'assertion',
    refusalCodes: [refuse('METHOD_EXISTS', 'IssuesPage.issueCheckboxState() already exists')],
  });
  const b = await run(reused, json({}));
  check('B: an existing PARAMETERISED method is never asked about', b.calls === 0);
  check('B: and REUSE survives the pass untouched', b.proposal.status === 'REUSE');

  // F / G / H: a safety refusal. One is enough, whatever else is also wrong.
  const unsafe: Array<[string, RefusalCode, Proposal['status']]> = [
    ['F: a generated identifier', 'DYNAMIC_IDENTIFIER', 'REFUSED'],
    ['G: first()/nth() as identity', 'FORBIDDEN_MECHANISM', 'NEEDS_REVIEW'],
    ['H: no press-time proof', 'NO_PRESS_TIME_PROOF', 'NEEDS_REVIEW'],
    ['identity measured false', 'IDENTITY_NOT_PROVEN', 'NEEDS_REVIEW'],
    ['an unproven group member', 'GROUP_MEMBER_UNPROVEN', 'NEEDS_REVIEW'],
  ];
  for (const [label, code, status] of unsafe) {
    const blocked = await run(proposal({
      status, refusalCodes: [refuse(code, 'measured')],
    }), json({}));
    check(`${label} -> not asked`, blocked.calls === 0, `${blocked.calls} call(s)`);
    check(`${label} -> status unchanged (${status})`, blocked.proposal.status === status);
  }

  // THE COMBINATION THE SPEC NAMES: a safety refusal ALONGSIDE a semantic one. The
  // semantic question is real and answerable, and it is still never asked, because
  // a dynamic id with a naming question is a dynamic id.
  for (const [label, safety] of [
    ['dynamic ID + naming ambiguity', 'DYNAMIC_IDENTIFIER'],
    ['first() + ownership ambiguity', 'FORBIDDEN_MECHANISM'],
    ['missing press-time proof + parameterisation question', 'NO_PRESS_TIME_PROOF'],
  ] as Array<[string, RefusalCode]>) {
    const mixed = await run(proposal({
      refusalCodes: [refuse(safety, 'measured'), refuse('CONSTANT_PARAMETER_VALUE', 'constant')],
    }), json({}));
    check(`${label} -> NO AI`, mixed.calls === 0, `${mixed.calls} call(s)`);
    check(`${label} -> stays NEEDS_REVIEW`, mixed.proposal.status === 'NEEDS_REVIEW');
  }

  // The semantic codes deliberately left switched off. AMBIGUOUS_NAME is the one that
  // was enabled, measured against a real resolver, and switched back off: see the
  // note in semantic.ts and the second refusal in checkAmbiguousName below.
  // SINGLE_TARGET IS THE ONE THAT STAYS OFF, and it is the only one now. It says one
  // sighting cannot support a parameter, which is a claim about the size of the sample
  // rather than about meaning - a confident resolver extrapolates from one example as
  // readily as an unconfident one, so no answer to it is worth having.
  for (const code of ['SINGLE_TARGET'] as RefusalCode[]) {
    const off = await run(proposal({ refusalCodes: [refuse(code, 'semantic but not enabled')] }), json({}));
    check(`${code} is semantic but NOT enabled -> not asked`, off.calls === 0);
    check(`  and ${code} is classified SEMANTIC, so this is a policy choice not an accident`,
        REFUSAL_CLASS[code] === 'SEMANTIC');
  }

  // ONE ASKABLE QUESTION BESIDE ONE UNASKABLE ONE IS STILL NOT ASKED. Clearing only
  // the askable half would leave the other standing, `revalidate` would refuse the
  // whole recommendation for it, and the call would have been spent to learn what
  // eligibility already knew.
  const mixed = await run(proposal({
    refusalCodes: [refuse('AMBIGUOUS_OWNERSHIP', 'askable'), refuse('SINGLE_TARGET', 'not askable')],
  }), json({}));
  check('an askable question beside an unaskable one -> not asked', mixed.calls === 0,
      `${mixed.calls} call(s)`);
}

/* ------------------------------------------------- D, E: when AI IS called ---- */

async function checkCalled(): Promise<void> {
  process.stdout.write('\n== the semantic fallback, and what it is allowed to change ==\n');

  // D: THE FIRST REAL USE CASE.
  const d = await run(proposal(), json({}));
  check('D: a constant-value parameterisation IS asked about', d.calls === 1);
  check('D: and the accepted result is PROPOSED', d.proposal.status === 'PROPOSED', d.proposal.status);
  check('D: named issueCheckbox - the capability, not the data',
      d.proposal.method === 'issueCheckbox', String(d.proposal.method));
  check('D: taking description', d.proposal.parameterName === 'description');
  check('D: on IssuesPage', d.proposal.owner === 'IssuesPage');
  check('D: the template is the MEASURED one, unchanged',
      d.proposal.template === ROW_TEMPLATE);
  check('D: and it is marked as model-resolved, not passed off as deterministic',
      d.proposal.resolvedBy === 'ai');
  check('D: the cleared refusal is gone and no other was invented',
      d.proposal.refusalCodes.length === 0);
  check('D: the audit records the decision and the confidence',
      d.proposal.semantic?.decision === 'PARAMETERIZE' && d.proposal.semantic?.confidence === 0.95);

  // E: OWNERSHIP FROM A CLOSED SET.
  const ambiguous = proposal({
    owner: null, parameterised: false, parameterName: null, roundTrip: false,
    derivedMethod: 'newIssueButton', template: 'page.locator("#new_issue")',
    allowedOwners: ['WorkspacePage', 'NotificationsPanel', 'ProjectsPage'],
    refusalCodes: [refuse('AMBIGUOUS_OWNERSHIP', 'declares 3 owners for /apps')],
  });
  const e = await run(ambiguous, json({
    decision: 'CREATE_PAGE_OBJECT', owner: 'ProjectsPage', methodName: 'newIssueButton',
    parameterName: null, locatorTemplate: 'page.locator("#new_issue")',
  }));
  check('E: ambiguous ownership IS asked about', e.calls === 1);
  check('E: and an owner from the closed set is accepted',
      e.proposal.status === 'PROPOSED' && e.proposal.owner === 'ProjectsPage', String(e.proposal.owner));

  // E, the other half: the prompt states the closed set, so the question is answerable.
  // A FRESH object - `resolveSemanticReviews` mutates what it accepts, which is the
  // point of it, and reusing the one above would ask about a settled proposal.
  const asked = stub(json({}));
  await resolveSemanticReviews({
    proposals: [proposal({
      owner: null, parameterised: false, parameterName: null, roundTrip: false,
      derivedMethod: 'newIssueButton', template: 'page.locator("#new_issue")',
      allowedOwners: ['WorkspacePage', 'NotificationsPanel', 'ProjectsPage'],
      refusalCodes: [refuse('AMBIGUOUS_OWNERSHIP', 'declares 3 owners for /apps')],
    })], reused: [], unmeasured: [], counts: {},
  }, { transport: asked.transport, model: 'stub', auditLog: AUDIT, memo: false });
  const prompt = asked.prompts[0] ?? '';
  check('E: the prompt lists exactly the declared owners',
      ['WorkspacePage', 'NotificationsPanel', 'ProjectsPage'].every(name => prompt.includes(name)));
  check('E: and says an owner outside them is rejected',
      /rejects your recommendation/.test(prompt));
  check('E: the prompt never instructs the resolver to choose a locator',
      /NOT choosing a locator/.test(prompt) && /Do not browse/.test(prompt));
  check('E: and carries no recorded test data',
      !/Line Chart/.test(prompt), 'the ledger redacts values; the prompt inherits that');
}

/* ------------------------------- I-L: what a bad recommendation cannot do ---- */

async function checkRejections(): Promise<void> {
  process.stdout.write('\n== a recommendation is re-validated, never trusted ==\n');

  const rejected = async (label: string, reply: string, expect = 'NEEDS_REVIEW') => {
    const result = await run(proposal(), reply);
    check(label, result.proposal.status === expect
      && result.proposal.resolvedBy === 'deterministic',
    `${result.proposal.status}/${result.proposal.resolvedBy} - ${result.proposal.semantic?.rejection ?? ''}`);
  };

  // I: the locator is not the model's to choose.
  await rejected('I: a resolver that returns a DIFFERENT locator is rejected',
      json({ locatorTemplate: 'page.locator(".tabulator-row").nth(2)' }));
  await rejected('I: even a plausible-looking rewrite is rejected',
      json({ locatorTemplate: ROW_TEMPLATE.replace('.rounded-checkbox-ui', '.bugChecked') }));

  // J: the owner is not the model's to invent.
  await rejected('J: an owner outside the closed set is rejected',
      json({ owner: 'InventedPage' }));

  // K: malformed.
  for (const [label, reply] of [
    ['K: prose instead of JSON', 'Sure! I think this should be parameterised.'],
    ['K: truncated JSON', '{"decision": "PARAMETERIZE", "owner": '],
    ['K: a JSON array', '[{"decision":"PARAMETERIZE"}]'],
    ['K: an unknown decision', json({ decision: 'CREATE_IT_ANYWAY' as never })],
    ['K: a missing decision', JSON.stringify({ owner: 'IssuesPage' })],
    ['K: an empty response', ''],
  ] as Array<[string, string]>)
    await rejected(label, reply);

  // L: well-formed, and still fails a deterministic rule.
  // A name offered on a question that was NOT about naming is out of scope: it is
  // ignored, and the framework's own derivation stands.
  const renamed = await run(proposal(), json({ methodName: 'rowTickBox' }));
  check('L: a name volunteered on a non-naming question is ignored, not obeyed',
      renamed.proposal.method === 'issueCheckbox', String(renamed.proposal.method));
  check('L: and the recommendation is still accepted on its actual question',
      renamed.proposal.status === 'PROPOSED');
  check('L: while the audit still records what was suggested',
      renamed.proposal.semantic?.methodName === 'rowTickBox');
  await rejected('L: a renamed parameter is rejected',
      json({ parameterName: 'issueTitle' }));
  await rejected('L: a usage that contradicts the evidence is rejected',
      json({ usage: 'assertion' }));

  // A resolver declining is a CORRECT answer, not a malfunction.
  const declined = await run(proposal(), json({ decision: 'NEEDS_REVIEW' }));
  check('a resolver that declines leaves the proposal in review',
      declined.proposal.status === 'NEEDS_REVIEW' && declined.outcome === 'REJECTED');

  // A transport that fails is an outage, and an outage is not a verdict.
  const broken: Transport = async () => { throw new Error('claude not installed'); };
  const result: CorpusResult = { proposals: [proposal()], reused: [], unmeasured: [], counts: {} };
  const pass = await resolveSemanticReviews(result, { transport: broken, auditLog: AUDIT, memo: false });
  check('a resolver outage leaves the proposal exactly as it was',
      result.proposals[0].status === 'NEEDS_REVIEW'
      && result.proposals[0].refusalCodes.length === 1
      && pass.audits[0].outcome === 'TRANSPORT_FAILED');

  // CONFIDENCE IS NOT A GATE. A confident wrong answer is still rejected; an
  // unconfident correct one is still accepted.
  const lowButValid = await run(proposal(), json({ confidence: 0.01 }));
  check('a confidence of 0.01 does not block a valid recommendation',
      lowButValid.proposal.status === 'PROPOSED');
  const highButInvalid = await run(proposal(), json({ owner: 'InventedPage', confidence: 1 }));
  check('a confidence of 1.0 does not rescue an invalid one',
      highButInvalid.proposal.status === 'NEEDS_REVIEW');
}

/* ------------------------------------------------- M-O: naming and identity ---- */

async function checkNaming(): Promise<void> {
  process.stdout.write('\n== names describe capabilities, and stay unique ==\n');

  // M: action and assertion are different capabilities with different names.
  const action = await run(proposal(), json({}));
  const assertion = await run(proposal({
    role: 'assertion', derivedMethod: 'issueCheckboxState',
    fingerprint: 'issuespage|assertion|div.tabulator-row||span.bugChecked|parameterised',
  }), json({ methodName: 'issueCheckboxState', usage: 'assertion' }));
  check('M: the action is issueCheckbox', action.proposal.method === 'issueCheckbox');
  check('M: the assertion is a separate method',
      assertion.proposal.method !== action.proposal.method, String(assertion.proposal.method));
  check('M: an action must not be named for a state',
      (await run(proposal({ derivedMethod: null }), json({ methodName: 'issueCheckboxState' })))
          .proposal.status === 'NEEDS_REVIEW');
  check('M: an assertion must be named for the state it reads',
      (await run(proposal({ role: 'assertion', derivedMethod: null }), json({ methodName: 'issueCheckbox', usage: 'assertion' })))
          .proposal.status === 'NEEDS_REVIEW');

  // N: a capability that already exists is REUSED, never duplicated.
  const existing = buildIndex().pages.IssuesPage?.methods.map(entry => entry.name) ?? [];
  check('N: the real IssuesPage declares issueCheckboxState', existing.includes('issueCheckboxState'));
  check('N: and issueCheckbox, created by this phase', existing.includes('issueCheckbox'));
  const duplicate = await run(proposal({
    role: 'assertion', derivedMethod: 'issueCheckboxState',
  }), json({ methodName: 'issueCheckboxState', usage: 'assertion' }),
  indexWith('issueCheckboxState'));
  check('N: a duplicate capability becomes REUSE, not a second method',
      duplicate.proposal.status === 'REUSE', duplicate.proposal.status);
  check('N: and no issueCheckboxState2 is ever produced',
      !/2$|New$|ByRow$|For[A-Z]/.test(String(duplicate.proposal.method)));

  // O: what a capability name may and may not be.
  for (const bad of ['checkbox1749558', 'method1', 'issueCheckbox2', 'clickCopyOfLogin_x',
    'Element', 'ab', '', 'get', 'thing'])
    check(`O: "${bad}" is refused as a method name`, nameProblem(bad) !== null, String(nameProblem(bad)));
  for (const good of ['issueCheckbox', 'notificationToggle', 'projectCard', 'issueCheckboxState'])
    check(`O: "${good}" is accepted`, nameProblem(good) === null, String(nameProblem(good)));
}

/* ------------------------------- the ambiguous-name defect, refused twice ---- */

async function checkAmbiguousName(): Promise<void> {
  process.stdout.write('\n== an ambiguous accessible name cannot be renamed out of ==\n');

  // The real proposal from the corpus: NotificationsPanel's Close control. A resolver
  // WAS asked this when the code was enabled and answered `closeButton`, which is a
  // sensible name and the wrong kind of answer - the entry would declare
  // `accessible_name: Close`, and findMethod matches that page-wide.
  const close = proposal({
    owner: 'NotificationsPanel', accessibleName: 'Close', parameterised: false,
    parameterName: null, roundTrip: false, derivedMethod: null, role: 'action',
    template: "page.locator('#ap_notifications_panel .ap-notif-settings-close')",
    allowedOwners: ['NotificationsPanel'],
    refusalCodes: [refuse('AMBIGUOUS_NAME', '"Close" names 3 structurally different elements')],
    fingerprint: 'notificationspanel|action|close|scoped-class',
  });

  const answer = {
    decision: 'CREATE_PAGE_OBJECT' as const, owner: 'NotificationsPanel',
    methodName: 'closeButton', usage: 'action', parameterName: null,
    locatorTemplate: "page.locator('#ap_notifications_panel .ap-notif-settings-close')",
    reasoning: 'it closes the panel', confidence: 0.72,
    component: 'notification panel close control', semanticDescription: 'Closes the panel',
    textKind: null,
  };

  // THE GUARD THAT REPLACED THE BLANKET REFUSAL. The question is now asked, because the
  // binding hazard is removed structurally rather than by declining to answer - but
  // ONLY when the corpus actually marked the name as shared. A proposal that carries
  // the refusal without the flag is one whose entry would still declare and bind the
  // name, and it is refused in exactly the words the old rule used.
  const unflagged = revalidate(close, 'AMBIGUOUS_NAME', answer);
  check('AMBIGUOUS_NAME cleared WITHOUT the corpus flag is refused',
      !unflagged.accepted && /still declare and bind that name/.test(unflagged.rejection ?? ''),
      unflagged.rejection ?? 'ACCEPTED');
  check('so no method is produced for it', unflagged.method === null);

  // WITH the flag set, the entry omits `accessible_name` (proved in writer terms by
  // abstraction.fixture.ts), so there is nothing left to bind page-wide and the name
  // question becomes answerable.
  const flagged = revalidate(
      proposal({ ...close, accessibleNameAmbiguous: true }), 'AMBIGUOUS_NAME', answer);
  check('AMBIGUOUS_NAME cleared WITH the flag is accepted',
      flagged.accepted && flagged.method === 'closeButton', flagged.rejection ?? 'accepted');

  // AND THE METHOD MUST STILL BE REACHABLE. With the shared name omitted, the only way
  // findMethod's siblings can locate it is the measured expression, so a proposal with
  // no template would create a method nothing can ever call.
  const noTemplate = revalidate(
      proposal({ ...close, accessibleNameAmbiguous: true, template: null }),
      'AMBIGUOUS_NAME', { ...answer, locatorTemplate: null });
  check('but not when there is no measured expression left to find it by',
      !noTemplate.accepted && /no measured expression/.test(noTemplate.rejection ?? ''),
      noTemplate.rejection ?? 'ACCEPTED');

  const asked = await run(proposal({ ...close, accessibleNameAmbiguous: true }), json(answer));
  check('the resolver IS now asked about a shared accessible name', asked.calls === 1,
      `${asked.calls} call(s)`);
  check('and the proposal leaves review as a creation',
      asked.proposal.status === 'PROPOSED' && asked.proposal.resolvedBy === 'ai',
      `${asked.proposal.status}/${asked.proposal.resolvedBy}`);
}

/* ------------------------------------------------------- the codes themselves ---- */

function checkCodes(): void {
  process.stdout.write('\n== refusals are classified by code, never by wording ==\n');

  check('every enabled semantic question is classified SEMANTIC',
      SEMANTIC_ENABLED.every(code => REFUSAL_CLASS[code] === 'SEMANTIC'));
  check('and no SAFETY code is enabled',
      !SEMANTIC_ENABLED.some(code => REFUSAL_CLASS[code] === 'SAFETY'));

  // The safety codes the spec enumerates all exist and are classified SAFETY.
  for (const code of ['NO_PRESS_TIME_PROOF', 'IDENTITY_NOT_PROVEN', 'DYNAMIC_IDENTIFIER',
    'FORBIDDEN_MECHANISM', 'GROUP_MEMBER_UNPROVEN'] as RefusalCode[])
    check(`${code} is SAFETY`, REFUSAL_CLASS[code] === 'SAFETY');

  // THE PRODUCERS. A code is worthless if nothing emits it, so the real rules are run.
  const positional = validateCandidate({
    locator: "page.locator('.rounded-checkbox-ui').first()", target: { tag: 'span' },
    ancestors: [], derivedCandidates: [], matchCount: 2,
  } as never);
  check('the real validator emits FORBIDDEN_MECHANISM for .first()',
      positional.codes.some(entry => entry.code === 'FORBIDDEN_MECHANISM'),
      positional.codes.map(entry => entry.code).join(', '));
  check('and NO_PRESS_TIME_PROOF when nothing was measured',
      positional.codes.some(entry => entry.code === 'NO_PRESS_TIME_PROOF'));
  check('and every one of them carries its class',
      positional.codes.every(entry => entry.class === REFUSAL_CLASS[entry.code]));
  check('refusals is exactly the projection of codes, never a second list',
      JSON.stringify(positional.refusals) === JSON.stringify(positional.codes.map(c => c.detail)));

  const constant = parameterisationHolds([
    { signature: 's', value: 'same', proven: true }, { signature: 's', value: 'same', proven: true }]);
  check('the real group rule emits CONSTANT_PARAMETER_VALUE',
      constant.code === 'CONSTANT_PARAMETER_VALUE', String(constant.code));
  const unproven = parameterisationHolds([
    { signature: 's', value: 'a', proven: false }, { signature: 's', value: 'b', proven: false }]);
  check('and GROUP_MEMBER_UNPROVEN when a member is not identity-proven',
      unproven.code === 'GROUP_MEMBER_UNPROVEN', String(unproven.code));
  check('which is SAFETY, so no resolver can ever be asked about it',
      REFUSAL_CLASS[unproven.code as RefusalCode] === 'SAFETY');

  // Eligibility must not read prose. Same wording, different code, opposite answer.
  const wording = 'identical wording on both';
  check('the SAME detail text with a SAFETY code is not eligible',
      !eligibility(proposal({ refusalCodes: [refuse('NO_PRESS_TIME_PROOF', wording)] })).eligible);
  check('and with a SEMANTIC code it is - so the code decides, not the words',
      eligibility(proposal({ refusalCodes: [refuse('CONSTANT_PARAMETER_VALUE', wording)] })).eligible);

  check('the decision vocabulary is closed',
      DECISIONS.length === 4 && DECISIONS.includes('NEEDS_REVIEW'));
  check('a parsed recommendation keeps only known fields',
      parseRecommendation(json({})).ok);
}

/* ---------------------------------------------- the real corpus, read only ---- */

function checkRealCorpus(): void {
  process.stdout.write('\n== the real corpus: how often a model would be asked ==\n');

  const result = analyseCorpus();
  let eligible = 0;
  let safetyBlocked = 0;
  const byCode = new Map<string, number>();
  for (const entry of result.proposals) {
    const verdict = eligibility(entry);
    if (verdict.eligible) {
      eligible++;
      for (const code of verdict.codes)
        byCode.set(code, (byCode.get(code) ?? 0) + 1);
    } else if (entry.refusalCodes.some(code => code.class === 'SAFETY')) {
      safetyBlocked++;
    }
  }
  check('MINIMALITY: a model would be asked about a small minority of the corpus',
      eligible > 0 && eligible < result.proposals.length / 3,
      `${eligible} eligible of ${result.proposals.length} proposals`);
  check('and every safety-refused proposal is excluded',
      safetyBlocked > 0, `${safetyBlocked} blocked by a safety refusal`);
  for (const [code, count] of [...byCode].sort())
    process.stdout.write(`      ${count} x ${code}\n`);

  // THE INVARIANT THAT MATTERS MOST: no eligible proposal carries a safety refusal.
  const leaked = result.proposals.filter(entry =>
    eligibility(entry).eligible && entry.refusalCodes.some(code => code.class !== 'SEMANTIC'));
  check('NO eligible proposal carries a non-semantic refusal', leaked.length === 0,
      leaked.map(entry => entry.fingerprint).join(', '));

  // Every proposal that is not PROPOSED/REUSE states a coded reason for it.
  const silent = result.proposals.filter(entry =>
    entry.status === 'NEEDS_REVIEW' && entry.refusalCodes.length === 0);
  check('every NEEDS_REVIEW line states a coded reason', silent.length === 0,
      silent.map(entry => entry.fingerprint).slice(0, 3).join(', '));

  // TWO groups derive the name `issueCheckbox`: the span a person presses, and the
  // 0x0 input beside it that was seen once. The second is correctly left in review as
  // SINGLE_TARGET - one sighting is not evidence of a parameter - so the capability
  // this phase is about is selected by its structure, not by its name.
  const single = result.proposals.find(entry =>
    entry.derivedMethod === 'issueCheckbox' && !eligibility(entry).eligible);
  check('the single-sighting checkbox group is NOT eligible', Boolean(single),
      single ? `${single.fingerprint} -> ${eligibility(single).why}` : 'not found');
  // THE LOOP, CLOSED - and one step further than "the proposal says REUSE".
  //
  // `issueCheckbox` was the constant-value question. It was asked, answered,
  // re-validated and written; knowledge now declares it, so `findParameterisedMethod`
  // resolves those steps BEFORE the abstraction engine ever sees them. The capability
  // has therefore left the proposal list entirely and appears in `reused` instead,
  // which is what full reuse looks like: not a settled question, no question.
  const methods = (buildIndex().pages.IssuesPage?.methods ?? []).map(entry => entry.name);
  check('the class declares issueCheckbox', methods.includes('issueCheckbox'));
  check('and exactly one method exists for it, never a second variant',
      methods.filter(name => name === 'issueCheckbox').length === 1);
  check('knowledge declares it, so the matcher can find it',
      readAllPageKnowledge().some(page =>
        page.elements.some(entry => entry.page_object_method === 'issueCheckbox')));

  const reusedIt = result.reused.filter(entry =>
    entry.pageObject === 'IssuesPage' && entry.method === 'issueCheckbox');
  check('recordings now REUSE it rather than proposing it',
      new Set(reusedIt.map(entry => entry.testCaseId)).size >= 2,
      `${new Set(reusedIt.map(entry => entry.testCaseId)).size} recording(s)`);
  // NOT "no such proposal exists" any more, because one legitimately does.
  //
  // TC_DASHBOARD_023 resolved its checkbox through evidence-backed positional
  // recovery, so the parameteriser now sees an expression ending `.nth(2)` and files a
  // proposal for it. The invariant was never that the proposal is ABSENT - it is that
  // no second reusable capability is created for this element, and that a
  // recording-specific index never becomes part of one. So the check moves from
  // presence to STATUS, which is what actually decides whether anything is written.
  const checkboxProposals = result.proposals.filter(entry =>
    entry.derivedMethod === 'issueCheckbox'
    && (entry.template ?? '').includes('.rounded-checkbox-ui'));
  const indexed = checkboxProposals.filter(entry => /[.]nth[(]/.test(entry.template ?? ''));
  check('no second capability is created for it',
      checkboxProposals.every(entry => entry.status !== 'PROPOSED'),
      checkboxProposals.map(entry => `${entry.testCaseId}:${entry.status}`).join(', ') || 'none');
  check('an indexed template is REFUSED as unsafe, never accepted as a capability',
      indexed.length > 0 && indexed.every(entry => entry.status === 'REFUSED'
        && entry.refusalCodes.some(code => code.code === 'POSITIONAL_NOT_PARAMETERISABLE'
          && code.class === 'SAFETY')),
      indexed.map(entry => `${entry.status}/${entry.refusalCodes.map(code => code.code).join('+')}`)
          .join(', ') || 'NO INDEXED TEMPLATE SEEN');
  check('and it is never marked REUSE merely because the base matches an existing method',
      !indexed.some(entry => entry.status === 'REUSE'));
  check('nor is a model ever asked about it again',
      !result.proposals.some(entry => eligibility(entry).codes.includes('CONSTANT_PARAMETER_VALUE')));
}

/* ---------------------------------------------------------- no stray writes ---- */

function checkNoSideEffects(): void {
  process.stdout.write('\n== the resolver writes nothing but its audit ==\n');
  const source = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'abstraction', 'semantic.ts'), 'utf8');
  const writes = source.match(/fs\.(writeFileSync|appendFileSync|rmSync|unlinkSync|copyFileSync)/g) ?? [];
  check('the only write in semantic.ts is the append-only audit log',
      writes.length === 1 && writes[0] === 'fs.appendFileSync', writes.join(', '));
  check('it grants the resolver no tools at all',
      /--disallowed-tools/.test(source) && !/--allowed-tools/.test(source));
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  // The word "browse" DOES appear in the code - in the instruction telling the
  // resolver not to. What must not appear is a way to: Bash is denied, and the only
  // process this module starts is the Claude binary itself.
  check('Bash is denied, so the browser wrapper cannot be spawned',
      /'--disallowed-tools', 'Bash'/.test(code));
  check('and the only process it starts is the Claude binary',
      (code.match(/spawn\(/g) ?? []).length === 1 && /spawn\(binary,/.test(code));
  check('and it names no browser mechanism at all',
      !/browse\.mjs|playwright|chromium|firefox|webkit/i.test(code));
  check('the audit never carries a recorded value',
      !/proposal\.parameterSource|first\.value/.test(source.split('const audit')[1]?.slice(0, 700) ?? ''));
}

async function main(): Promise<void> {
  await checkNotCalled();
  await checkCalled();
  await checkRejections();
  await checkNaming();
  await checkAmbiguousName();
  checkCodes();
  checkRealCorpus();
  checkNoSideEffects();
  if (fs.existsSync(AUDIT))
    fs.rmSync(AUDIT);
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
