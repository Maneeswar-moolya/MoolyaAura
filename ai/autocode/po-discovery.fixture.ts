import '../testing/isolated-checkout';
/**
 * A capability the repository already has must be FOUND, not proposed again.
 *
 *   npx tsx ai/autocode/po-discovery.fixture.ts
 *
 * WHAT WENT WRONG. `ProjectsPage.cancelButton()` has existed for as long as
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
 * So TC_CANCEL_A measured `page.locator("#cancel_editor")` at one element with
 * identity proven, found no capability, and asked a model who owned an element the
 * repository already owned - and the model, correctly, declined: `fixtureapp__apps.yaml`
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
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string): void => { process.stdout.write(`\n== ${title} ==\n`); };

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
      .filter(element => element.page_object_method === 'cancelButton')
      .map(element => ({ page, element })));

  check('1: knowledge declares the capability exactly once',
      entries.length === 1, `${entries.length} entr(y/ies)`);
  check('1: and it now declares a concrete selector, which is what a resolver can match',
      Boolean((entries[0]?.element.locator_strategy ?? '').includes('#cancel_editor')),
      entries[0]?.element.locator_strategy ?? '(none)');
  check('1: the owner is unchanged',
      entries[0]?.element.page_object === 'ProjectsPage', String(entries[0]?.element.page_object));

  // THE DECLARATION MUST BE TRUE. A selector nobody implements would send a spec at an
  // element the Page Object never resolves, which is worse than not declaring it.
  const implementation = fs.readFileSync(
      path.join(ROOT, 'tests-e2e', 'pages', 'projects.page.ts'), 'utf8');
  const body = implementation.slice(implementation.indexOf('cancelButton('));
  check('1: and the Page Object really resolves that selector',
      body.slice(0, 400).includes('#cancel_editor'));

  for (const id of ['TC_CANCEL_A', 'TC_CANCEL_B']) {
    const mapped = mapCase(id);
    if (!mapped) {
      check(`2: ${id} is on disk`, false, 'no recording');
      continue;
    }
    const cancel = mapped.steps.find(step => /click Cancel/.test(String(step.from)));
    check(`2: ${id} reuses the existing method for Cancel`,
        cancel?.kind === 'page-object'
        && (cancel as never as { pageObject?: string }).pageObject === 'ProjectsPage'
        && (cancel as never as { method?: string }).method === 'cancelButton',
        `${cancel?.kind} ${(cancel as never as { pageObject?: string }).pageObject}.`
        + `${(cancel as never as { method?: string }).method}`);
    check(`2: ${id} calls it, rather than emitting a raw locator`,
        /projectsPage\.cancelButton\(\)/.test((cancel?.code ?? []).join(' ')),
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
  const knowledge = readAllPageKnowledge();
  const entry = knowledge.flatMap(p => p.elements).find(e => e.id === 'editor_dialog');
  check('dialog ownership is declared without inventing a capability', entry?.page_object === 'ProjectsPage' && !entry.page_object_method);
  const control = evidence({ target: { tag: 'button', id: 'editor_confirm' },
    ancestors: [{ tag: 'div', id: 'editor_dialog', relationship: 'ancestor', depth: 1 }] });
  const owner = resolveOwner(control, knowledge, ['/apps']);
  check('containment settles ownership on a route with multiple owners', owner.owner === 'ProjectsPage');
  check('an undeclared container does not borrow that ownership', resolveOwner({ ...control, ancestors: [] }, knowledge, ['/apps']).owner === null);
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

  // 5: MEASURED BUT NO CANDIDATE PROVEN. TC_CANCEL_B's textbox: a live recording whose
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
  const implementing = pages.filter(name => new RegExp('\\bcancelButton\\s*\\(')
      .test(fs.readFileSync(path.join(ROOT, 'tests-e2e', 'pages', name), 'utf8')));
  check('7: exactly one Page Object implements cancelButton',
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
 * run down with it. `#create_team_invite_modal` cost TC_CANCEL_B two of them.
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
    target: { tag: 'div', id: 'notification_panel', role: 'dialog', stableClasses: [] },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], captureTiming: 'before-action',
  } as never as TargetEvidence;
  const known = resolveOwner(declaredPanel, knowledge, ['/apps']);
  check('9: a container knowledge DOES declare still resolves an owner',
      known.owner === 'NotificationsPanel', `${known.owner} - ${known.why}`);


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
