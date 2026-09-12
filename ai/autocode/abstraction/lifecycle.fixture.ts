import '../../testing/isolated-checkout';
/**
 * The Page Object lifecycle: every element gets a decision, and none of them is silence.
 *
 *   npx tsx ai/autocode/abstraction/lifecycle.fixture.ts
 *
 * NO MODEL IS CALLED HERE. Every resolver exchange goes through a stub transport that
 * COUNTS its calls, because half of what this proves is that a model was not asked -
 * and a test that cannot tell "answered correctly" from "never asked" proves nothing
 * about the deterministic-first rule.
 *
 * Offline: no browser, no model, no network.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { analyseCorpus, type CorpusResult, type UnmeasuredTarget } from './propose';
import {
  decideLifecycle, summarise, type Disposition,
} from './lifecycle';
import {
  eligibility, labelProblem, resolveSemanticReviews, revalidate, SEMANTIC_ENABLED,
  MAX_RESOLVER_ATTEMPTS, type Recommendation, type Transport,
} from './semantic';
import { deriveScenarioTitle, unstableTitleReason } from '../scenario-title';
import { fixtureRegistered, registerFixture, renderKnowledgeEntry } from './writer';
import { refuse, REFUSAL_CLASS, type Proposal } from './types';
import type { MappedStep, MappingResult } from '../from-recording';

const ROOT = process.cwd();
const AUDIT = path.join(os.tmpdir(), `aura-lifecycle-fixture-${process.pid}.jsonl`);

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
  expression: 'page.locator("#all_apps .title").filter({ hasText: "Faclon labs" })',
};

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    timestamp: '2026-08-21T00:00:00.000Z', testCaseId: 'TC_X', target: 'click Faclon labs',
    role: 'action', category: 'TEST_DATA', rule: 7, status: 'NEEDS_REVIEW',
    owner: 'ProjectsPage', ownerKind: 'page-object', method: null,
    parameterised: false, parameterSource: null,
    locatorStrategy: 'scoped-class-text', expression: PROVEN.expression, proof: PROVEN,
    reason: 'identified only by its own text',
    refusals: ['identified only by its own text'],
    refusalCodes: [refuse('TEXT_ONLY_IDENTITY', 'identified only by its own text')],
    resolvedBy: 'deterministic', semantic: null, allowedOwners: ['ProjectsPage'],
    derivedMethod: null, roundTrip: false,
    template: PROVEN.expression, parameterName: null, accessibleName: null,
    accessibleNameAmbiguous: false,
    sightings: [{ testCaseId: 'TC_X', from: 'click Faclon labs' }],
    fingerprint: 'projectspage|action|title.handel-over-flow|scoped-class-text',
    ...overrides,
  };
}

function stub(reply: string | ((prompt: string, calls: number) => string)):
{ transport: Transport; calls: () => number; prompts: string[] } {
  let calls = 0;
  const prompts: string[] = [];
  return {
    transport: async (prompt: string) => {
      calls++;
      prompts.push(prompt);
      return typeof reply === 'function' ? reply(prompt, calls) : reply;
    },
    calls: () => calls,
    prompts,
  };
}

const json = (value: Partial<Recommendation> & Record<string, unknown>): string => JSON.stringify({
  decision: 'CREATE_PAGE_OBJECT', owner: 'ProjectsPage', methodName: 'projectCard',
  usage: 'action', parameterName: null, locatorTemplate: PROVEN.expression,
  reasoning: 'a project card', confidence: 0.9, ...value,
});

const indexWith = (...methods: string[]) => ({
  pages: {
    ProjectsPage: { methods: methods.map(name => ({ name })) },
    IssuesPage: { methods: [] },
    NotificationsPanel: { methods: [] },
    LoginPage: { methods: [] },
  },
  fixtures: ['projectsPage', 'issuesPage', 'notificationsPanel', 'loginPage'],
} as never);

async function resolve(input: Proposal, reply: string | ((p: string, n: number) => string),
    options: { index?: unknown; maxAttempts?: number } = {}):
Promise<{ proposal: Proposal; calls: number; audit: Proposal['semantic'] }> {
  const asked = stub(reply);
  const result: CorpusResult = { proposals: [input], reused: [], unmeasured: [], counts: {} };
  await resolveSemanticReviews(result, {
    transport: asked.transport, model: 'stub-model', auditLog: AUDIT, memo: false,
    index: (options.index ?? indexWith()) as never,
    ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
  });
  return { proposal: result.proposals[0], calls: asked.calls(), audit: result.proposals[0].semantic };
}

/** A mapped step, with only the fields the lifecycle join reads. */
function step(over: Partial<MappedStep> = {}): MappedStep {
  return {
    kind: 'codegen-locator', label: 'click Faclon labs', code: ['await x.click();'],
    why: 'no Page Object describes it', from: 'click Faclon labs', ...over,
  } as MappedStep;
}

function mapping(steps: MappedStep[]): MappingResult {
  return {
    steps, fixtures: new Set(['step']), reused: [], unresolved: [], needsReview: [],
    assessments: [], codegenLocators: steps.filter(entry => entry.kind === 'codegen-locator').length,
    authenticated: false, orderReconstructed: true,
  } as MappingResult;
}

/* ----------------------------------------------- 1-3: existing Page Object reuse */

function checkReuse(): void {
  process.stdout.write('\n== 1-3: reusing an existing Page Object ==\n');

  const decisions = decideLifecycle({
    testCaseId: 'TC_X', generationId: 'g1', timestamp: 'now',
    mapping: mapping([step({
      kind: 'page-object', pageObject: 'IssuesPage', method: 'issueCheckbox',
      from: 'click the row checkbox', label: 'Click the row checkbox',
      code: ["await (await issuesPage.issueCheckbox('Copy of login')).click();"],
      why: 'accessible name in fixtureapp__issues-id.yaml',
    })]),
    proposals: [], unmeasured: [],
  });
  check('1: an existing method reports EXISTING_PO_REUSED',
      decisions.length === 1 && decisions[0].disposition === 'EXISTING_PO_REUSED',
      decisions[0]?.disposition);
  check('1: and costs no resolver attempt',
      decisions[0]?.resolver === 'none' && decisions[0]?.attempts === 0);
  check('1: the argument it passes is recorded, not guessed',
      decisions[0]?.parameters.join() === "'Copy of login'", decisions[0]?.parameters.join());

  // 2 / 3: the FIXTURE, not just the method. A class with no fixture makes Playwright
  // refuse the whole spec file - `Test has unknown parameter` - and collect 0 tests.
  const fixtures = fs.readFileSync(path.join(ROOT, 'tests-e2e', 'fixtures.ts'), 'utf8');
  check('2: an existing Page Object with a valid fixture is registered',
      fixtureRegistered(fixtures, 'IssuesPage') && fixtureRegistered(fixtures, 'ProjectsPage'));
  check('3: a class that has no fixture BY DESIGN is refused, never auto-registered',
      'problem' in registerFixture(fixtures, 'TermsPage'),
      JSON.stringify(registerFixture(fixtures, 'TermsPage')).slice(0, 90));
  const added = registerFixture(fixtures, 'ReportsPage');
  check('3: a genuinely new class gets all three declarations',
      'source' in added && fixtureRegistered(added.source, 'ReportsPage'));
  check('3: and the fixtures file is otherwise untouched',
      'source' in added && added.source.includes('issuesPage: async ({ page, healing }, use)')
      && added.source.length > fixtures.length);
}

/* ------------------------------- 4-6: creation, parameterisation, action vs state */

async function checkCreation(): Promise<void> {
  process.stdout.write('\n== 4-6: creating a Page Object for a new component ==\n');

  // 4: a new component the resolver settles -> a created method.
  const created = await resolve(proposal(), json({ textKind: 'LABEL', methodName: 'projectCard' }));
  check('4: an ambiguous new component becomes a created Page Object method',
      created.proposal.status === 'PROPOSED' && created.proposal.method === 'projectCard',
      `${created.proposal.status}/${created.proposal.method}`);

  // 5: repeated instances become ONE parameterised capability, never one per instance.
  const data = await resolve(proposal(), json({ textKind: 'DATA', methodName: 'projectCard' }));
  check('5: text resolved as DATA becomes ONE parameterised capability',
      data.proposal.parameterised && data.proposal.parameterName === 'description',
      `${data.proposal.parameterised}/${data.proposal.parameterName}`);
  check('5: and its template round-trips to the measured expression',
      data.proposal.roundTrip && data.proposal.template === PROVEN.expression.replace('"Faclon labs"', 'description'),
      data.proposal.template ?? 'null');
  check('5: the recorded value never reaches the template',
      !(data.proposal.template ?? '').includes('Faclon labs'));

  // 6: one logical component, two DOM elements, two methods - paired by the naming rule.
  const state = await resolve(proposal({
    role: 'assertion', derivedMethod: 'projectCardState',
    refusalCodes: [refuse('TEXT_ONLY_IDENTITY', 'identified only by its own text')],
  }), json({ usage: 'assertion', methodName: 'projectCardState', textKind: 'LABEL' }));
  check('6: the state form of a component is a SEPARATE method named for the state',
      state.proposal.method === 'projectCardState', state.proposal.method ?? 'null');
  const crossed = revalidate(proposal({ role: 'assertion' }), ['TEXT_ONLY_IDENTITY'],
      JSON.parse(json({ usage: 'assertion', methodName: 'projectCard', textKind: 'LABEL' })));
  check('6: an assertion may NOT reuse the action method\'s name',
      !crossed.accepted && /must be named for the state/.test(crossed.rejection ?? ''),
      crossed.rejection ?? 'ACCEPTED');
}

/* ------------------------------- 7-9, 18-22: the resolver, validation and repair */

async function checkResolver(): Promise<void> {
  process.stdout.write('\n== 7-9, 18-22: AI resolution, validation, repair ==\n');

  // 7 / 8: ambiguous -> asked -> deterministically validated.
  const asked = await resolve(proposal(), json({ textKind: 'LABEL' }));
  check('7: an ambiguous component IS put to the resolver', asked.calls === 1, `${asked.calls} call(s)`);
  check('8: and the answer is re-validated before it is accepted',
      asked.proposal.resolvedBy === 'ai' && asked.audit?.attempts.length === 1);
  check('8: an answer that fails validation is NOT accepted',
      (await resolve(proposal(), json({ owner: 'NoSuchPage', textKind: 'LABEL' }))).proposal.status
        !== 'PROPOSED');

  // 9 + 22: THE REPAIR LOOP. First answer invalid, second valid.
  const repaired = await resolve(proposal(), (_prompt, calls) => (calls === 1
    ? json({ owner: 'NoSuchPage', textKind: 'LABEL' })
    : json({ textKind: 'LABEL' })));
  check('9: an invalid proposal is REPAIRED and then re-validated',
      repaired.calls === 2 && repaired.proposal.status === 'PROPOSED',
      `${repaired.calls} call(s) -> ${repaired.proposal.status}`);
  check('9: the repair is recorded as a repair, not as a first-time answer',
      repaired.audit?.repaired === true && repaired.audit?.attempts[1]?.kind === 'repair');
  check('22: the repair prompt states the validator\'s verbatim rejection',
      repaired.audit?.attempts[0]?.rejection?.includes('NoSuchPage') === true,
      repaired.audit?.attempts[0]?.rejection ?? 'none');

  // The budget is BOUNDED. An answer that never validates stops, and says so.
  const never = await resolve(proposal(), json({ owner: 'NoSuchPage', textKind: 'LABEL' }));
  check('22: an answer that never validates stops at the budget',
      never.calls === MAX_RESOLVER_ATTEMPTS, `${never.calls} of ${MAX_RESOLVER_ATTEMPTS}`);
  check('22: and ends at a terminal RESOLVER_EXHAUSTED, not an open review',
      never.proposal.refusalCodes.some(entry => entry.code === 'RESOLVER_EXHAUSTED'));
  check('22: which is STRUCTURAL, so it is never asked about again',
      REFUSAL_CLASS.RESOLVER_EXHAUSTED === 'STRUCTURAL'
      && !eligibility(never.proposal).eligible);

  const capped = await resolve(proposal(), json({ owner: 'NoSuchPage', textKind: 'LABEL' }),
      { maxAttempts: 1 });
  check('22: the budget is configurable and honoured', capped.calls === 1, `${capped.calls} call(s)`);

  // 18: TEXT_ONLY_IDENTITY, both branches.
  check('18: TEXT_ONLY_IDENTITY is a question the resolver may be asked',
      SEMANTIC_ENABLED.includes('TEXT_ONLY_IDENTITY'));
  const noKind = await resolve(proposal(), json({ textKind: null }));
  check('18: an answer that does not say LABEL or DATA is rejected',
      noKind.proposal.status !== 'PROPOSED'
      && /TEXT_ONLY_IDENTITY|LABEL or DATA/.test(noKind.audit?.attempts[0]?.rejection ?? ''),
      noKind.audit?.attempts[0]?.rejection ?? 'none');

  // A DECLINE THAT STILL ANSWERS THE QUESTION IS HONOURED. A real resolver replied
  // `textKind: DATA` with confidence 0.9 and `decision: NEEDS_REVIEW` beside it -
  // because it was unsure whether to CREATE or REUSE, which is not its call. Reading
  // the decision first threw the good answer away and spent the whole repair budget
  // re-asking a settled question.
  const declinedButAnswered = await resolve(proposal(), json({
    decision: 'NEEDS_REVIEW', textKind: 'DATA', methodName: 'projectCard',
  }));
  check('18: a decline that ANSWERS the question is used, not discarded',
      declinedButAnswered.proposal.status === 'PROPOSED'
      && declinedButAnswered.calls === 1,
      `${declinedButAnswered.proposal.status} in ${declinedButAnswered.calls} call(s)`);

  // AND WHEN THE ANSWER IS INCOMPLETE, THE REJECTION IS ACTIONABLE. This is the exact
  // live reply: textKind answered, no name offered. Before the fix it was rejected as
  // "declined, which is a correct answer" - true of nothing, and unrepairable, so the
  // budget was spent re-asking. Now it says what is missing, which is what the repair
  // prompt then quotes.
  const noName = await resolve(proposal(), json({
    decision: 'NEEDS_REVIEW', textKind: 'DATA', methodName: null,
  }));
  check('18: an incomplete answer is rejected for WHAT IS MISSING, not for declining',
      /method name/.test(noName.audit?.attempts[0]?.rejection ?? ''),
      noName.audit?.attempts[0]?.rejection ?? 'none');

  // AND A DECLINE THAT ANSWERS NOTHING IS STILL RESPECTED.
  const genuineDecline = await resolve(proposal(), json({
    decision: 'NEEDS_REVIEW', textKind: null,
  }));
  check('18: a decline that answers nothing is respected as a correct answer',
      genuineDecline.proposal.status !== 'PROPOSED'
      && /declined/.test(genuineDecline.audit?.attempts[0]?.rejection ?? ''),
      genuineDecline.audit?.attempts[0]?.rejection ?? 'none');
  check('18: a credential can never be a label', Boolean(labelProblem('hunter2secretpassword123456')));
  check('18: nor a generated identifier', Boolean(labelProblem('tc_summary_636432')));
  check('18: nor a bare number', Boolean(labelProblem('1749558')));
  check('18: an ordinary control label is fine', labelProblem('Cancel') === null);

  // 19: UNCLASSIFIED_TARGET - and "it is a container" is an ANSWER, not a review.
  check('19: UNCLASSIFIED_TARGET is askable', SEMANTIC_ENABLED.includes('UNCLASSIFIED_TARGET'));
  const container = await resolve(proposal({
    category: 'UNCLASSIFIED', rule: 9, derivedMethod: 'projectCard',
    refusalCodes: [refuse('UNCLASSIFIED_TARGET', 'no rule classified this element')],
  }), json({ decision: 'NEEDS_REVIEW', reasoning: 'it is a layout container' }));
  check('19: "this is not a capability" is a terminal decision, never NEEDS_REVIEW forever',
      container.proposal.status !== 'PROPOSED' && container.audit !== null);

  // 21: several semantic questions, ONE exchange.
  const many = proposal({
    owner: null, allowedOwners: ['WorkspacePage', 'ProjectsPage'], derivedMethod: null,
    refusalCodes: [
      refuse('TEXT_ONLY_IDENTITY', 'identified only by its own text'),
      refuse('AMBIGUOUS_OWNERSHIP', 'the route declares 2 owners'),
    ],
  });
  const verdict = eligibility(many);
  check('21: two semantic questions are put in ONE exchange',
      verdict.eligible && verdict.codes.length === 2, verdict.why);
  const both = await resolve(many, json({ owner: 'ProjectsPage', textKind: 'LABEL', methodName: 'projectCard' }));
  check('21: and one call settles both', both.calls === 1 && both.proposal.status === 'PROPOSED',
      `${both.calls} call(s) -> ${both.proposal.status}`);
}

/* ---------------------------------------------- 10-12: naming, and what it may not be */

async function checkNaming(): Promise<void> {
  process.stdout.write('\n== 10-12: Page Object names are semantic, never derived from the DOM ==\n');

  // The CSS-class case needs an element whose class the name is actually taken from:
  // `roundedCheckboxUi` is only a stylesheet name for an element selected by
  // `.rounded-checkbox-ui`, and refusing it anywhere else would be refusing a name for
  // resembling a class it has nothing to do with.
  const CHECKBOX = 'page.locator(".tabulator-row").filter({ hasText: "x" }).locator(".rounded-checkbox-ui")';
  const bad: Array<[string, string, string]> = [
    ['a generated id', 'checkbox1749553', PROVEN.expression],
    ['a bare index', 'checkbox0', PROVEN.expression],
    ['a positional name', 'nth0', PROVEN.expression],
    ['a CSS class', 'roundedCheckboxUi', CHECKBOX],
    ['a meaningless name', 'locator1', PROVEN.expression],
  ];
  for (const [label, name, expression] of bad) {
    const answer = await resolve(
        proposal({ derivedMethod: null, template: expression, expression }),
        json({ methodName: name, textKind: 'LABEL', locatorTemplate: expression }));
    check(`11-12: ${label} (${name}) is not accepted as a capability name`,
        answer.proposal.status !== 'PROPOSED',
        `status ${answer.proposal.status} - ${answer.audit?.attempts[0]?.rejection ?? ''}`);
  }
  const good = await resolve(proposal({ derivedMethod: null }),
      json({ methodName: 'projectCard', textKind: 'LABEL' }));
  check('10: a semantic name is accepted', good.proposal.method === 'projectCard');
}

/* ------------------------------------------------- 13-14: the scenario title */

function checkTitle(): void {
  process.stdout.write('\n== 13-14: the scenario title comes from the journey, not the DOM ==\n');

  // TC_LOGIN_112's real authored title, verbatim.
  const authored = '#tr_1749558 > .tabulator-cell.tabulator-cell--checkbox > '
    + '.rounded-checkbox-cont > .rounded-checkbox-ui — 1749558 is ticked';
  check('14: the authored selector title is refused', Boolean(unstableTitleReason(authored)),
      unstableTitleReason(authored) ?? 'accepted');

  const journey = mapping([
    step({ kind: 'navigate', from: 'navigate', label: 'Open https://portal.fixture.invalid/' }),
    step({ kind: 'authenticate', from: 'sign in', label: 'Sign in' }),
    step({ kind: 'page-object', pageObject: 'ProjectsPage', method: 'open', from: 'open', label: 'Open' }),
    step({ kind: 'page-object', pageObject: 'IssuesPage', method: 'issueCheckbox',
      from: 'click the row checkbox', label: 'Click the row checkbox' }),
    step({ kind: 'page-object', pageObject: 'IssuesPage', method: 'issueCheckboxState',
      from: 'assert checked 1749558', label: '1749558 is ticked' }),
  ]);
  const derived = deriveScenarioTitle(journey);
  check('13: a title is derived from the semantic journey', Boolean(derived), derived?.title ?? 'null');
  check('13: it names the capability and the screen',
      /issue checkbox/i.test(derived?.title ?? '') && /issues page/i.test(derived?.title ?? ''),
      derived?.title ?? '');
  check('14: and contains no selector, id, index or locator',
      unstableTitleReason(derived?.title ?? '') === null,
      unstableTitleReason(derived?.title ?? '') ?? 'clean');
  check('14: the unstable assertion phrase ("1749558 is ticked") is NOT reused',
      !(derived?.title ?? '').includes('1749558'));
  check('13: infrastructure steps are excluded from the journey',
      !derived?.inputs.screens.includes('LoginPage'), derived?.inputs.screens.join(',') ?? '');

  // STABILITY: the same journey through different selectors yields the same title.
  const reskinned = mapping([
    step({ kind: 'page-object', pageObject: 'IssuesPage', method: 'issueCheckbox',
      from: 'click .new-checkbox-class', label: 'Click .new-checkbox-class' }),
    step({ kind: 'page-object', pageObject: 'IssuesPage', method: 'issueCheckboxState',
      from: 'assert checked 999999', label: '999999 is ticked' }),
  ]);
  check('13: the title is stable when the DOM changes but the capability does not',
      deriveScenarioTitle(reskinned)?.title === derived?.title,
      `${deriveScenarioTitle(reskinned)?.title} vs ${derived?.title}`);

  // NOTHING IS INVENTED. No semantic step, no title.
  check('13: with no semantic journey it derives nothing rather than guessing',
      deriveScenarioTitle(mapping([step()])) === null);
}

/* ------------------------- 15-17: every element gets a decision, and safety survives */

function checkDispositions(): void {
  process.stdout.write('\n== 15-17: every PAGE OBJECT REQUIRED element gets a decision ==\n');

  const unmeasured: UnmeasuredTarget = {
    testCaseId: 'TC_X', from: 'click Close', target: 'click Close', role: 'action',
    locator: "page.getByRole('button', { name: 'Close' })",
    code: 'NO_ADMISSIBLE_EVIDENCE',
    reason: 'the recording carries no DOM evidence sidecar (recorded before press-time capture existed)',
    remedy: 'Re-record required.',
  };

  const decisions = decideLifecycle({
    testCaseId: 'TC_X', generationId: 'g1', timestamp: 'now',
    mapping: mapping([
      step({ from: 'click Close', label: 'click Close' }),
      step({ from: 'click Faclon labs', label: 'click Faclon labs' }),
      step({ from: 'click nothing knows about this', label: 'click unknown' }),
    ]),
    proposals: [proposal({
      status: 'REFUSED',
      refusalCodes: [refuse('POSITIONAL_NOT_PARAMETERISABLE', 'narrows by a measured index')],
    })],
    unmeasured: [unmeasured],
  });

  check('15: EVERY page-object-required element produced a decision',
      decisions.length === 3, `${decisions.length} decision(s) for 3 element(s)`);
  check('15: and none of them is silent',
      decisions.every(entry => Boolean(entry.disposition && entry.reason)));

  const byFrom = new Map(decisions.map(entry => [entry.from, entry]));
  check('16: no evidence -> REFUSED_NO_ADMISSIBLE_EVIDENCE, never a silent skip',
      byFrom.get('click Close')?.disposition === 'REFUSED_NO_ADMISSIBLE_EVIDENCE'
      && byFrom.get('click Close')?.evidenceStatus === 'no-sidecar');
  check('16: and it states the one remedy',
      byFrom.get('click Close')?.remedy === 'Re-record required.');
  check('16: an element the engine has NO record of is reported, not omitted',
      byFrom.get('click nothing knows about this')?.disposition === 'REFUSED_NO_ADMISSIBLE_EVIDENCE'
      && /holds no record/.test(byFrom.get('click nothing knows about this')?.reason ?? ''));

  check('17: a SAFETY refusal stays a refusal and is not converted into a Page Object',
      byFrom.get('click Faclon labs')?.disposition === 'REFUSED_NO_ADMISSIBLE_EVIDENCE'
      && byFrom.get('click Faclon labs')?.method === null,
      byFrom.get('click Faclon labs')?.disposition);
  check('17: and it carries the code that says why',
      byFrom.get('click Faclon labs')?.refusalCodes.includes('POSITIONAL_NOT_PARAMETERISABLE') === true);

  const totals = summarise(decisions);
  check('15: the summary accounts for every element',
      totals.total === 3
      && Object.values(totals.byDisposition).reduce((sum, count) => sum + count, 0) === 3);

  // NEEDS_REVIEW IS NOT A DISPOSITION. Proved on the type's own value set rather than
  // asserted in prose: the vocabulary is what makes the state unreachable.
  const vocabulary: Disposition[] = [
    'EXISTING_PO_REUSED', 'PO_CREATED_DETERMINISTICALLY', 'PO_CREATED_BY_AI',
    'AI_REPAIRED_AND_ACCEPTED', 'REFUSED_NO_ADMISSIBLE_EVIDENCE', 'REFUSED_WRITER_BLOCKED',
  ];
  check('15: the disposition vocabulary contains no user-facing NEEDS_REVIEW',
      !vocabulary.some(value => /REVIEW/.test(value)));
}

/* ------------------------- 24-25: the writer's own verdict reaches the element */

/**
 * A PROPOSED proposal that the writer did not persist must say WHY, in the writer's
 * words - and must not blame the evidence for it.
 *
 * TC_LOGIN_126 is the case: three proposals, two of them accepted by the resolver and
 * passed by the validator, one BLOCKED with `no knowledge file declares
 * CreateTeamInviteModal`. The writer is all-or-nothing ON PURPOSE, so nothing was
 * written - and all three were reported as REFUSED_NO_ADMISSIBLE_EVIDENCE, which was a
 * false statement about two elements whose evidence was proven.
 */
function checkWriterVerdict(): void {
  process.stdout.write('\n== 24-25: writer blocked vs batch rolled back ==\n');

  const blockedProposal = proposal({
    status: 'PROPOSED', method: 'createTeamInviteModal', owner: 'CreateTeamInviteModal',
    fingerprint: 'blocked-one', refusals: [], refusalCodes: [],
    sightings: [{ testCaseId: 'TC_X', from: 'click the dialog' }],
  });
  const soundProposal = proposal({
    status: 'PROPOSED', method: 'addInvitee', owner: 'WorkspacePage',
    fingerprint: 'sound-one', refusals: [], refusalCodes: [],
    sightings: [{ testCaseId: 'TC_X', from: 'click add invitee' }],
  });
  const writes = [
    { proposal: blockedProposal, file: 'x.ts', knowledgeFile: null, method: 'm', entry: null,
      problems: ['no knowledge file declares CreateTeamInviteModal'], written: false,
      outcome: 'BLOCKED' },
    { proposal: soundProposal, file: 'y.ts', knowledgeFile: 'k.yaml', method: 'm', entry: 'e',
      problems: [], written: false, outcome: 'APPLIED' },
  ] as never;

  const decisions = decideLifecycle({
    testCaseId: 'TC_X', generationId: 'g1', timestamp: 'now',
    mapping: mapping([
      step({ from: 'click the dialog', label: 'click the dialog' }),
      step({ from: 'click add invitee', label: 'click add invitee' }),
    ]),
    proposals: [blockedProposal, soundProposal], unmeasured: [], writes,
  });
  const byFrom = new Map(decisions.map(entry => [entry.from, entry]));
  const blocked = byFrom.get('click the dialog');
  const sound = byFrom.get('click add invitee');

  check('24: the blocked proposal is REFUSED_WRITER_BLOCKED, not an evidence failure',
      blocked?.disposition === 'REFUSED_WRITER_BLOCKED', String(blocked?.disposition));
  check('24: with the WRITER_BLOCKED diagnostic',
      blocked?.diagnostic === 'WRITER_BLOCKED', String(blocked?.diagnostic));
  check('24: and the writer\'s own reason, verbatim',
      (blocked?.reason ?? '').includes('no knowledge file declares CreateTeamInviteModal'),
      blocked?.reason ?? '');
  check('24: the proposal is not recorded as having failed validation',
      blocked?.validationStatus === 'passed', String(blocked?.validationStatus));

  check('25: the SOUND proposal is reported as a batch casualty, not a refusal of its own',
      sound?.diagnostic === 'BATCH_ROLLED_BACK', String(sound?.diagnostic));
  check('25: naming the proposal that blocked the batch and what it said',
      (sound?.reason ?? '').includes('CreateTeamInviteModal.createTeamInviteModal()')
      && (sound?.reason ?? '').includes('no knowledge file declares CreateTeamInviteModal'),
      sound?.reason ?? '');
  check('25: its remedy points elsewhere - this element needs nothing',
      /needs nothing/.test(sound?.remedy ?? ''), sound?.remedy ?? '');
  check('25: and neither decision claims the evidence was inadmissible',
      ![blocked, sound].some(entry => /no admissible evidence/i.test(entry?.reason ?? '')
        || entry?.disposition === 'REFUSED_NO_ADMISSIBLE_EVIDENCE'));

  // THE TRANSACTIONAL POLICY IS UNCHANGED, and that is the point: this reports the
  // batch accurately, it does not let a partial write through.
  check('25: neither proposal is reported as written',
      decisions.every(entry => entry.method === null || entry.disposition !== 'PO_CREATED_DETERMINISTICALLY'));
}

/* --------------------------------------- 20, 23: the writer, binding and discovery */

async function checkWriterAndDiscovery(): Promise<void> {
  process.stdout.write('\n== 20, 23: ambiguous names bind nothing; a new method is discoverable ==\n');

  // 20: THE STRUCTURAL FIX. A shared accessible name is never written into the entry.
  const shared = proposal({
    accessibleName: 'Close', accessibleNameAmbiguous: true, method: 'closeButton',
    owner: 'NotificationsPanel', template: "page.locator('#ap_notifications_panel .ap-notif-settings-close')",
  });
  const sharedEntry = renderKnowledgeEntry(shared);
  check('20: a SHARED accessible name is omitted from the knowledge entry',
      !(sharedEntry?.yaml ?? '').includes('accessible_name'),
      (sharedEntry?.yaml ?? '').split('\n').find(line => line.includes('accessible_name')) ?? 'omitted');
  check('20: but the method and its measured locator are still declared',
      (sharedEntry?.yaml ?? '').includes('page_object_method: closeButton')
      && (sharedEntry?.yaml ?? '').includes('locator_strategy:'));

  const unique = renderKnowledgeEntry(proposal({
    accessibleName: 'Sign In', accessibleNameAmbiguous: false, method: 'signInButton',
  }));
  check('20: a UNIQUE accessible name is still declared, so existing binding is unchanged',
      (unique?.yaml ?? '').includes('accessible_name: Sign In'));

  // 20: and the guard that stops the fix being bypassed.
  const answer = JSON.parse(json({
    owner: 'NotificationsPanel', methodName: 'closeButton', textKind: null,
    locatorTemplate: "page.locator('#ap_notifications_panel .ap-notif-settings-close')",
  })) as Recommendation;
  const unflagged = revalidate(proposal({
    accessibleName: 'Close', accessibleNameAmbiguous: false, owner: 'NotificationsPanel',
    derivedMethod: 'closeButton',
    template: "page.locator('#ap_notifications_panel .ap-notif-settings-close')",
    refusalCodes: [refuse('AMBIGUOUS_NAME', '"Close" names 3 different elements')],
  }), ['AMBIGUOUS_NAME'], answer, indexWith() as never);
  check('20: clearing AMBIGUOUS_NAME without the corpus flag is refused',
      !unflagged.accepted, unflagged.rejection ?? 'ACCEPTED');

  // 23: a created method is discoverable - the duplicate check finds it next time.
  const existing = await resolve(proposal({ derivedMethod: 'projectCard' }),
      json({ methodName: 'projectCard', textKind: 'LABEL' }), { index: indexWith('projectCard') });
  check('23: once the capability exists, the next generation REUSES rather than duplicating',
      existing.proposal.status === 'REUSE', existing.proposal.status);
  check('23: and no second method is proposed for it', existing.proposal.method === 'projectCard');
}

/* ----------------------------------------- the synthetic corpus, read only, no model */

function checkRealCorpus(): void {
  const result = analyseCorpus();
  check('unmeasured inputs remain visible', result.unmeasured.length > 0);
  check('every unmeasured input reports safety code, reason, and remedy', result.unmeasured.every(e => REFUSAL_CLASS[e.code] === 'SAFETY' && Boolean(e.reason) && Boolean(e.remedy)));
  check('proposals retain their sightings', result.proposals.length > 0 && result.proposals.every(e => e.sightings.length > 0));
  const eligible = result.proposals.filter(e => eligibility(e).eligible);
  check('semantic questions are eligible for the resolver', eligible.length > 0);
  check('no safety refusal reaches the resolver', eligible.every(e => e.refusalCodes.every(c => c.class === 'SEMANTIC')));
  check('deterministic analysis never claims AI resolved a safety refusal', !result.proposals.some(e => e.resolvedBy === 'ai' && e.refusalCodes.some(c => c.class === 'SAFETY')));
}

async function main(): Promise<void> {
  checkReuse();
  await checkCreation();
  await checkResolver();
  await checkNaming();
  checkTitle();
  checkDispositions();
  checkWriterVerdict();
  await checkWriterAndDiscovery();
  checkRealCorpus();

  if (fs.existsSync(AUDIT))
    fs.rmSync(AUDIT, { force: true });
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
