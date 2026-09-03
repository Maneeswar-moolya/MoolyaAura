/**
 * A capability the repository already has must be FOUND, not proposed again.
 *
 *   npx tsx ai/autocode/po-discovery.fixture.ts
 *
 * WHAT WENT WRONG. `ProjectsPage.createTeamCancelButton()` has existed for as long as
 * its knowledge entry, and its entry declared only a description, an owner and a method
 * name. Every resolver needs more than that:
 *
 *   findMethod                 matches accessible_name / id / method words against the
 *                              recorded target, which is "Cancel" - not
 *                              "create team cancel button"
 *   findMethodByProvenLocator  needs a concrete selector to compare the proven
 *                              expression against; none was declared
 *   findParameterisedMethod    needs a template; none
 *   existingCapability         keys off declared selector tokens; none, so the element
 *                              looked NEW
 *
 * So TC_LOGIN_127 measured `page.locator("#create_team_cancel_btn")` at one element with
 * identity proven, found no capability, and asked a model who owned an element the
 * repository already owned - and the model, correctly, declined: `bugasura__apps.yaml`
 * declares three owners for /apps and the route does not say which. AMBIGUOUS_OWNERSHIP
 * was a true statement about a question that should never have been asked.
 *
 * The fix is one declaration, not a rule change. This file pins that the declaration
 * does what it is for, and that it did not open a way to write a second method for the
 * same element.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as path from 'path';

import { mapRecording, readAssertions, readEvidence } from './from-recording';
import { parseRecording, readArtifact, readArchivedArtifact } from '../dashboard/recorder';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import { buildIndex } from '../knowledge/index';
import { validateCandidate } from './abstraction/validate';
import { analyseCorpus, resolveOwner } from './abstraction/propose';
import type { CandidateMeasurement, DomNode, TargetEvidence } from './dom-evidence';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string): void => process.stdout.write(`\n== ${title} ==\n`);

/* ------------------------------------------- 1-2: found, and found without AI ---- */

function mapCase(id: string) {
  const live = readArtifact(id);
  const source = live ?? readArchivedArtifact(id);
  if (!source)
    return null;
  const archived = !live;
  const recording = parseRecording(source, {
    startUrl: '', browser: '', durationMs: 0,
    evidence: readEvidence(id, { archived }),
    stateAssertions: readAssertions(id, { archived }),
  });
  recording.startUrl = recording.actions.find(action => action.type === 'navigate')?.value ?? '';
  return mapRecording(recording);
}

function checkDiscovery(): void {
  section('1-2 - the existing capability is discovered, deterministically');

  const knowledge = readAllPageKnowledge();
  const entries = knowledge.flatMap(page => page.elements
      .filter(element => element.page_object_method === 'createTeamCancelButton')
      .map(element => ({ page, element })));

  check('1: knowledge declares the capability exactly once',
      entries.length === 1, `${entries.length} entr(y/ies)`);
  check('1: and it now declares a concrete selector, which is what a resolver can match',
      Boolean((entries[0]?.element.locator_strategy ?? '').includes('#create_team_cancel_btn')),
      entries[0]?.element.locator_strategy ?? '(none)');
  check('1: the owner is unchanged',
      entries[0]?.element.page_object === 'ProjectsPage', String(entries[0]?.element.page_object));

  // THE DECLARATION MUST BE TRUE. A selector nobody implements would send a spec at an
  // element the Page Object never resolves, which is worse than not declaring it.
  const implementation = fs.readFileSync(
      path.join(ROOT, 'tests-e2e', 'pages', 'projects.page.ts'), 'utf8');
  const body = implementation.slice(implementation.indexOf('createTeamCancelButton('));
  check('1: and the Page Object really resolves that selector',
      body.slice(0, 400).includes('#create_team_cancel_btn'));

  for (const id of ['TC_LOGIN_127', 'TC_LOGIN_126']) {
    const mapped = mapCase(id);
    if (!mapped) {
      check(`2: ${id} is on disk`, false, 'no recording');
      continue;
    }
    const cancel = mapped.steps.find(step => /click Cancel/.test(String(step.from)));
    check(`2: ${id} reuses the existing method for Cancel`,
        cancel?.kind === 'page-object'
        && (cancel as never as { pageObject?: string }).pageObject === 'ProjectsPage'
        && (cancel as never as { method?: string }).method === 'createTeamCancelButton',
        `${cancel?.kind} ${(cancel as never as { pageObject?: string }).pageObject}.`
        + `${(cancel as never as { method?: string }).method}`);
    check(`2: ${id} calls it, rather than emitting a raw locator`,
        /projectsPage\.createTeamCancelButton\(\)/.test((cancel?.code ?? []).join(' ')),
        (cancel?.code ?? []).join(' ').slice(0, 90));
  }

  // NO MODEL IS INVOLVED IN ANY OF THAT. `mapRecording` is deterministic - the three
  // reuse resolvers are string comparison over authored knowledge - so a reuse costs no
  // resolver attempt and cannot cost a transport call.
  const engine = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'from-recording.ts'), 'utf8');
  check('2: the reuse path cannot reach a model',
      !/\bclaude\b|anthropic|runAgent|child_process/i
          .test(engine.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
}

/* ---------------------------------------------- 3: ownership inside the dialog ---- */

function checkOwnership(): void {
  section('3 - ownership inside the Create New Team dialog is settled by declaration');

  const knowledge = readAllPageKnowledge();
  const naming = knowledge.flatMap(page => page.elements
      .filter(element => (element.locator_strategy ?? '').includes('#create_team_invite_modal'))
      .map(element => ({ file: page.file, element })));

  check('3: exactly one owner names the dialog container',
      new Set(naming.map(entry => entry.element.page_object)).size === 1,
      naming.map(entry => `${entry.element.page_object} (${entry.element.id})`).join(', ') || 'none');
  check('3: and that owner is ProjectsPage, which already owns every control in it',
      naming[0]?.element.page_object === 'ProjectsPage');
  check('3: the container entry declares NO method, so it can never become a capability',
      naming.every(entry => entry.element.id !== 'create_team_invite_dialog'
        || !entry.element.page_object_method),
      naming.map(entry => `${entry.element.id}:${entry.element.page_object_method ?? '-'}`).join(', '));

  // The elements inside the dialog now resolve an owner rather than falling to the
  // route rule, which sees three owners on /apps and correctly refuses.
  const corpus = analyseCorpus({ includeArchived: true });
  const inside = corpus.proposals.filter(entry =>
    entry.testCaseId.split(',').some(id => ['TC_LOGIN_126', 'TC_LOGIN_127'].includes(id))
    && /create_team_invite_form|create_team_cancel/.test(String((entry as never as { expression?: string }).expression ?? '')));
  check('3: every proposal for an element inside the dialog now has an owner',
      inside.length > 0 && inside.every(entry => Boolean(entry.owner)),
      inside.map(entry => `${entry.owner ?? '?'}.${entry.method ?? entry.derivedMethod ?? '?'}`).join(', '));
  check('3: and none of them is refused for ambiguous ownership any more',
      !inside.some(entry => entry.refusalCodes.some(code => code.code === 'AMBIGUOUS_OWNERSHIP')),
      inside.flatMap(entry => entry.refusalCodes.map(code => code.code)).join(', ') || 'no refusals');
}

/* ------------------------------- 5-6: the two evidence states, told apart ---- */

const candidate = (over: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  strategy: 'container-text', expression: 'page.locator(".row").locator(".box")',
  matchCount: 3, identityMatched: false, sameDocument: true, measuredAt: 'press', ...over,
} as CandidateMeasurement);

function evidence(over: Partial<TargetEvidence> = {}): TargetEvidence {
  return {
    locator: 'page.getByRole(\'textbox\').nth(3)',
    target: { tag: 'input', stableClasses: [] } as DomNode,
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], captureTiming: 'before-action',
    derivedCandidates: [],
    ...over,
  } as TargetEvidence;
}

function checkEvidenceWording(): void {
  section('5-6 - measured-but-unproven is not the same as never measured');

  // 6: NO MEASUREMENT AVAILABLE. Nothing was measured for this element at all.
  const none = validateCandidate(evidence());
  const noneText = none.codes.map(entry => entry.detail).join(' | ');
  check('6: nothing measured says so, and says a recording may predate the mechanism',
      /no measurement available/.test(noneText) && /predates press-time measurement/.test(noneText),
      noneText.slice(0, 130));

  // 5: MEASURED BUT NO CANDIDATE PROVEN. TC_LOGIN_126's textbox: a live recording whose
  // target carries 9 rejected and 5 position-proven candidates, all measured at the
  // press, none proving identity. Calling that "predates press-time measurement" sends a
  // person to re-record a recording that is already complete.
  const measured = validateCandidate(evidence({
    rejectedCandidates: [candidate(), candidate({ matchCount: 1 })],
    positionProvenCandidates: [candidate({ positionWithinCandidate: 2 })],
  }));
  const measuredText = measured.codes.map(entry => entry.detail).join(' | ');
  check('5: measured-but-unproven says how many were measured',
      /3 candidate\(s\) were measured/.test(measuredText), measuredText.slice(0, 130));
  check('5: and does NOT claim the recording predates press-time measurement',
      !/predates/.test(measuredText), measuredText.slice(0, 130));
  check('5: while saying a new recording would measure the same thing',
      /would measure the same thing/.test(measuredText));

  // THE DECISION IS UNCHANGED. Both are still refusals, with the same code and class.
  check('5-6: both remain NO_PRESS_TIME_PROOF refusals of class SAFETY',
      [none, measured].every(result => !result.safe
        && result.codes.some(entry => entry.code === 'NO_PRESS_TIME_PROOF' && entry.class === 'SAFETY')),
      `${none.safe} / ${measured.safe}`);

  // And the real recording lands in the right one of the two.
  const real = path.join(ROOT, 'ai', 'dashboard', 'recordings', 'TC_LOGIN_126.evidence.json');
  if (fs.existsSync(real)) {
    const body = JSON.parse(fs.readFileSync(real, 'utf8')) as {
      targets?: Array<Record<string, unknown>>;
    };
    const textbox = (body.targets ?? []).find(target =>
      String(target.locator ?? '').includes('getByRole(\'textbox\').nth(3)'));
    const verdict = textbox ? validateCandidate(textbox as never as TargetEvidence) : null;
    const text = verdict?.codes.map(entry => entry.detail).join(' | ') ?? '';
    check('5: TC_LOGIN_126\'s textbox reports MEASURED, not predates-measurement',
        Boolean(textbox) && /were measured at the press/.test(text) && !/predates/.test(text),
        text.slice(0, 120) || 'target not found');
  }
}

/* --------------------------------------------- 7: no duplicate capability ---- */

function checkNoDuplicates(): void {
  section('7 - the declaration created no second way to write the same method');

  const knowledge = readAllPageKnowledge();
  const byMethod = new Map<string, string[]>();
  for (const page of knowledge) {
    for (const element of page.elements) {
      if (!element.page_object || !element.page_object_method)
        continue;
      const key = `${element.page_object}.${element.page_object_method}`;
      byMethod.set(key, [...(byMethod.get(key) ?? []), `${page.file}:${element.id}`]);
    }
  }
  const duplicated = [...byMethod].filter(([, where]) => where.length > 1);
  check('7: no Page Object method is declared by two knowledge entries',
      duplicated.length === 0,
      duplicated.map(([key, where]) => `${key} <- ${where.join(', ')}`).join(' | '));

  const pages = fs.readdirSync(path.join(ROOT, 'tests-e2e', 'pages'))
      .filter(name => name.endsWith('.page.ts'));
  const implementing = pages.filter(name => new RegExp('\\bcreateTeamCancelButton\\s*\\(')
      .test(fs.readFileSync(path.join(ROOT, 'tests-e2e', 'pages', name), 'utf8')));
  check('7: exactly one Page Object implements createTeamCancelButton',
      implementing.length === 1, implementing.join(', '));
  check('7: and no CreateTeamInviteModal class was invented',
      !fs.existsSync(path.join(ROOT, 'tests-e2e', 'pages', 'create.team.invite.modal.ts')));
}

/* --------------------- 8: a declaration with no implementation is not a capability ---- */

/**
 * THE INVARIANT WHOSE ABSENCE CREATED A DUPLICATE.
 *
 * `existingCapability` requires the declared method to be ON THE CLASS before it will
 * call an element already described - correctly, because a method that does not exist
 * cannot be reused. So a knowledge entry that names a method nobody implemented is not a
 * weaker capability, it is an INVISIBLE one: the element reads as undescribed and the
 * abstraction engine writes a second capability for it.
 *
 * That is exactly what happened to `#password_field-error`. `password_length_error`
 * declared `LoginPage.passwordLengthError` and no such method existed, so TC_LOGIN_120
 * produced `passwordFieldErrorState()` for the same element - and carried the recorder's
 * `[type=password]` redaction marker into its description. Two methods, one element, and
 * nothing in the pipeline able to see the collision coming.
 *
 * Checked over the WHOLE corpus rather than the one entry, because the next one will be
 * a different entry.
 */
function checkDeclarationsAreImplemented(): void {
  section('8 - every declared capability exists on its class');

  const knowledge = readAllPageKnowledge();
  const index = buildIndex();
  const declared: string[] = [];
  const missing: string[] = [];
  for (const page of knowledge) {
    for (const element of page.elements) {
      if (!element.page_object || !element.page_object_method)
        continue;
      declared.push(`${element.page_object}.${element.page_object_method}`);
      const onClass = index.pages[element.page_object]?.methods
          .some(entry => entry.name === element.page_object_method);
      if (!onClass)
        missing.push(`${element.page_object}.${element.page_object_method}() <- ${page.file}:${element.id}`);
    }
  }
  check('8: no knowledge entry declares a method that is not on its class',
      missing.length === 0, missing.join(' | ') || `${declared.length} declared, all implemented`);

  // AND THE ELEMENT THAT PROVED IT. One capability for #password_field-error, declared
  // and implemented, with the accidental second one gone.
  const forThatElement = knowledge.flatMap(page => page.elements
      .filter(element => (element.locator_strategy ?? '').includes('#password_field-error'))
      .map(element => `${element.page_object}.${element.page_object_method}`));
  check('8: #password_field-error has exactly one declared capability',
      forThatElement.length === 1, forThatElement.join(', ') || 'none');
  check('8: and it is the authored one, which is implemented',
      forThatElement[0] === 'LoginPage.passwordLengthError'
      && Boolean(index.pages.LoginPage?.methods.some(entry => entry.name === 'passwordLengthError')),
      forThatElement[0] ?? 'none');
  check('8: the generated duplicate is gone from knowledge and from the class',
      !knowledge.some(page => page.elements.some(element =>
        element.page_object_method === 'passwordFieldErrorState'))
      && !(index.pages.LoginPage?.methods ?? []).some(entry => entry.name === 'passwordFieldErrorState'));
}

/* ------------------ 9: an owner nothing declares is refused, not proposed ---- */

/**
 * THE CONTRACT `applyProposals` STATES AND `resolveOwner` USED TO BREAK.
 *
 * The writer's own comment reads: "the owner is never invented - resolveOwner returns
 * only what a knowledge file declares for the route, and a resolver may only choose from
 * that same closed set". True of the containment, container and route rules; false of
 * the component rule, which DERIVED a class name from a dialog's markup and returned it
 * as though a repository had declared it. `knowledgeFileFor` then found no file for that
 * class and refused - so every such proposal was PROPOSED, validated, and unwritable by
 * construction, and being all-or-nothing the writer took the sound proposals in the same
 * run down with it. `#create_team_invite_modal` cost TC_LOGIN_126 two of them.
 *
 * The rule now returns the name only when knowledge already declares that class, and
 * refuses otherwise with what a person would have to declare. Strictly MORE refusing.
 */
function checkComponentOwnerContract(): void {
  section('9 - a component owner is returned only when knowledge declares it');

  const knowledge = readAllPageKnowledge();
  const dialog = {
    locator: 'page.locator("#create_team_invite_modal")',
    target: { tag: 'div', id: 'create_team_invite_modal', role: 'dialog', stableClasses: ['modal'] },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], captureTiming: 'before-action',
  } as never as TargetEvidence;

  const undeclaredOwner = resolveOwner(dialog, knowledge, ['/apps']);
  check('9: a dialog no knowledge file declares gets NO owner',
      undeclaredOwner.owner === null, String(undeclaredOwner.owner));
  check('9: refused with OWNER_UNKNOWN rather than proposed',
      undeclaredOwner.code === 'OWNER_UNKNOWN', String(undeclaredOwner.code));
  check('9: and the reason names the class a person would have to declare',
      /CreateTeamInviteModal/.test(undeclaredOwner.why) && /declare/.test(undeclaredOwner.why),
      undeclaredOwner.why);

  // AND THE DECLARED CASE STILL WORKS. NotificationsPanel is a real component: knowledge
  // declares it, a class implements it, a fixture reaches it. The rule must still return
  // it, or this change would have removed the mechanism instead of correcting it.
  const declaredPanel = {
    locator: 'page.locator("#some_notifications_thing")',
    target: { tag: 'div', id: 'ap_notifications_panel', role: 'dialog', stableClasses: [] },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], captureTiming: 'before-action',
  } as never as TargetEvidence;
  const known = resolveOwner(declaredPanel, knowledge, ['/apps']);
  check('9: a container knowledge DOES declare still resolves an owner',
      known.owner === 'NotificationsPanel', `${known.owner} - ${known.why}`);

  // THE ELEMENT ITSELF, from the real corpus: refused at the engine, so nothing reaches
  // the writer and no batch can be spent on it.
  const corpus = analyseCorpus({ includeArchived: true });
  const modal = corpus.proposals.find(entry =>
    /create_team_invite_modal/.test(String((entry as never as { expression?: string }).expression ?? '')));
  check('9: the real dialog proposal is NEEDS_REVIEW, not PROPOSED',
      modal?.status === 'NEEDS_REVIEW', String(modal?.status));
  check('9: with an ownership refusal a person can act on',
      Boolean(modal?.refusalCodes.some(code => code.code === 'OWNER_UNKNOWN')),
      modal?.refusalCodes.map(code => code.code).join(', ') ?? 'none');
}

function main(): void {
  checkDiscovery();
  checkComponentOwnerContract();
  checkDeclarationsAreImplemented();
  checkOwnership();
  checkEvidenceWording();
  checkNoDuplicates();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
