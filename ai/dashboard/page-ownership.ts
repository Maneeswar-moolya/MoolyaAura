/** Recording authoring model. Recommendations are distinct from human guidance and proof. */
import { buildIndex } from '../knowledge/index';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';
import { resolveOwner } from '../autocode/abstraction/propose';
import { evidenceFor, evidenceForAssertionSubject, provenMeasurements, type TargetEvidence } from '../autocode/dom-evidence';
import { executableBinding, hashContent, type AuthoringPage, type OwnerChoice } from '../knowledge/authoring-owners';
import type { Recording } from './recorder';
import type { ApplicationScope } from '../projects/scope';
import { credentialsIn } from '../excel/readiness';
import { authoringCatalog, authoringLocatorProblem, type AuthoringLocatorProblem, type OwnerSelection, type AuthoringBinding } from './authoring-catalog';

export interface ReviewStep extends OwnerChoice {
  label: string; role: 'action' | 'assertion'; locator: string; documentId: string | null;
  screenRoute?: string | null;
  evidence: 'proven' | 'missing'; evidenceDetail: string;
  /**
   * Whether this step's RECORDED locator could be authored into a capability.
   *
   * Separate from `evidence`, and the two answer different questions: `evidence` is
   * whether the framework proved which element was acted on, this is whether the
   * expression the recorder wrote down is one the framework will accept as code. A step
   * can be proven and unauthorable (a measured element whose recorded chain selects by
   * position) or unproven and authorable (a clean expression nobody measured).
   *
   * Carried so the review can refuse at the point the person can still act on it. The
   * verdict is computed by the same function the save uses; the browser is told the
   * answer, never the rule.
   */
  locatorSafety: { ok: true } | ({ ok: false } & AuthoringLocatorProblem);
}
export function pageCatalog(scope: ApplicationScope, query = '', drafts: AuthoringPage[] = []) {
  const index = buildIndex(scope), knowledge = readAllPageKnowledge(scope.paths.knowledgePageDir);
  const pages = Object.entries(index.pages).map(([name, page]) => ({ name, file: page.file,
    route: knowledge.find(k => k.elements.some(e => e.page_object === name))?.route ?? '',
    description: page.purpose, methods: page.methods.map(method => method.name), state: 'existing' }));
  for (const draft of drafts) if (!pages.some(page => page.name === draft.name))
    pages.push({ ...draft, methods: [], file: '', state: 'authoring declaration' });
  const term = query.toLowerCase().trim();
  return pages.filter(page => `${page.name} ${page.route} ${page.description} ${page.methods.join(' ')}`.toLowerCase().includes(term));
}
/** One rule, asked without throwing. Never re-stated in the browser. */
function locatorVerdict(locator: string): ReviewStep['locatorSafety'] {
  const problem = authoringLocatorProblem(locator);
  return problem ? { ok: false, ...problem } : { ok: true };
}
export function ownershipRevision(recording: Recording): string {
  return hashContent(JSON.stringify({ actions: recording.actions, assertions: recording.assertions }));
}
export function ownershipReview(scope: ApplicationScope, recording: Recording,
  overrides: Record<string, OwnerSelection> = {}, pages: AuthoringPage[] = [], preparedCatalog?: ReturnType<typeof authoringCatalog>) {
  const knowledge = readAllPageKnowledge(scope.paths.knowledgePageDir);
  const catalog = pageCatalog(scope, '', pages);
  const authoring = preparedCatalog ?? authoringCatalog(scope);
  const origin = (recording.evidence as any)?.origin?.applicationId;
  if (origin && origin !== scope.applicationId) throw Error('Recording belongs to another application.');
  const rows: ReviewStep[] = [];
  let inherited: string | null = null, lastRoute: string | null = null, lastRecommended: string | null = null;
  let inheritedBinding: AuthoringBinding | null = null;
  const routeFrom = (value: string) => { try { return new URL(value).pathname; } catch { return null; } };
  let screenRoute: string | null = routeFrom(recording.startUrl);
  const add = (item: any, key: string, role: 'action' | 'assertion') => {
    if (!item.locator || item.type === 'navigate' || (role === 'assertion' && ['url', 'title'].includes(item.type))) return;
    const evidence: TargetEvidence | null = evidenceFor(recording.evidence, item.locator)
      ?? (role === 'assertion' ? evidenceForAssertionSubject(recording.evidence, item)?.evidence ?? null : null);
    const route = evidence && ['before-action', 'assertion-pick'].includes(evidence.captureTiming ?? '') ? evidence.route ?? null : null;
    const owner = evidence ? resolveOwner(evidence, knowledge, route ? [route] : [],
      { applicationId: scope.applicationId, originApplicationId: origin, route }) : null;
    const recommended = owner?.owner ?? null;
    if (route !== lastRoute) { inherited = null; inheritedBinding = null; }
    const selected = overrides[key];
    // Page/PO context inherits; a control method belongs only to its selected step.
    if (inheritedBinding) inheritedBinding = { ...inheritedBinding, method: null, executionMode: 'AUTO', locatorOverride: undefined, arguments: undefined };
    if (selected && typeof selected === 'object') {
      if (selected.applicationId !== scope.applicationId) throw Error('Cross-application binding is not allowed.');
      if (selected.executionMode && !['AUTO', 'PAGE_OBJECT_METHOD', 'RECORDED_LOCATOR'].includes(selected.executionMode)) throw Error('Unknown authoring execution mode.');
      if (selected.executionMode === 'PAGE_OBJECT_METHOD' && !selected.method) throw Error('Select a method for Page Object execution.');
      if (selected.executionMode === 'RECORDED_LOCATOR' && role !== 'action') throw Error('Recorded-locator execution is supported for actions.');
      if (selected.page && !authoring.pages.some(page => page.name === selected.page)) throw Error('Unknown Page for this application.');
      const object = authoring.objects.find(object => object.className === selected.pageObject);
      if (selected.pageObject && !object) throw Error('USER BINDING BROKEN: Page Object disappeared.');
      if (selected.method && !object?.methods.some(method => method.name === selected.method)) throw Error('USER BINDING BROKEN: method disappeared.');
      // AN EXPLICIT SAVE MUST RESOLVE TO SOMETHING THAT RUNS.
      //
      // Selecting a Page Object and nothing else used to save as USER_CONFIRMED with
      // `method: null` and `executionMode: AUTO` - a state that reads as a completed mapping
      // in the review and is not one anywhere else. Refused at the point the person can still
      // act on it, naming the choices rather than the failure.
      if (selected.pageObject && !executableBinding(selected))
        throw Error(`USER_BINDING_INCOMPLETE at ${key}: ${selected.pageObject} is selected but nothing was chosen `
          + `to run this step. Choose one of its methods${object?.methods.length ? ` (${object.methods.map(m => m.name).join(', ')})` : ''}, `
          + 'create the method this step needs, or choose recorded-locator execution.');
      inheritedBinding = { ...selected }; inherited = selected.pageObject || null;
    } else {
      if (selected && !catalog.some(page => page.name === selected)) throw Error(`Unknown Page Object for this application at ${key}.`);
      if (selected) { inherited = selected; inheritedBinding = null; }
      else if (Object.hasOwn(overrides, key)) { inherited = null; inheritedBinding = null; }
    }
    const proven = provenMeasurements(evidence, role).length > 0;
    // USER_CONFIRMED is earned by an EXECUTABLE binding, not by a Page Object being nearby.
    // The inherited, method-less context above used to be called USER_CONFIRMED, which is how
    // a step nobody had bound arrived at generation wearing a completed mapping's label.
    const runnable = executableBinding(inheritedBinding);
    const provenance = runnable ? 'USER_CONFIRMED'
      : inherited || inheritedBinding ? 'USER_BINDING_INCOMPLETE' : 'AUTO';
    rows.push({ key, label: `${role === 'assertion' ? 'Assert ' : ''}${item.type} ${item.target}`,
      role, locator: item.locator, route, screenRoute: route || screenRoute, recommended, confirmed: inherited,
      userSelection: inheritedBinding ? { ...inheritedBinding } : null,
      provenance, frameworkRecommendation: { pageObject: recommended },
      explicit: Object.hasOwn(overrides, key), documentId: evidence?.documentId ?? null,
      evidence: proven ? 'proven' : 'missing',
      evidenceDetail: proven ? 'Recorded target identity proven; ownership does not alter this proof.'
        : 'No automatic target identity proof. An explicit method or recorded-locator choice is user authored, not automatically validated.',
      locatorSafety: locatorVerdict(item.locator) });
    lastRoute = route; lastRecommended = recommended;
  };
  const assertions = recording.assertions ?? [];
  for (let at = 0; at <= recording.actions.length; at++) {
    assertions.forEach((item, i) => { if ((item.afterActions ?? recording.actions.length) === at) add(item, `assertion:${i}`, 'assertion'); });
    if (at === recording.actions.length) break;
    const action = recording.actions[at];
    if (action.type === 'navigate') { inherited = null; inheritedBinding = null; lastRoute = null; lastRecommended = null; screenRoute = routeFrom(action.value ?? ''); }
    else add(action, `action:${at}`, 'action');
  }
  for (const key of Object.keys(overrides)) if (!rows.some(row => row.key === key)) throw Error('Ownership references a step outside this recording.');
  return { applicationId: scope.applicationId, revision: ownershipRevision(recording), steps: rows, pages: catalog, authoring };
}
export function createAuthoringPage(scope: ApplicationScope, recording: Recording, input: AuthoringPage, existing: AuthoringPage[]) {
  const name = String(input.name ?? '').trim(), route = String(input.route ?? '').trim();
  const description = String(input.description ?? '').trim();
  if (!/^[A-Z][A-Za-z0-9]{1,70}Page$/.test(name) || name === 'BasePage') throw Error('Use a unique PascalCase name ending in Page.');
  if (description.length > 240 || /[\r\n]/.test(description)) throw Error('Description must be one line, at most 240 characters.');
  if (credentialsIn(description).length) throw Error('Keep credential values out of page descriptions.');
  if (!route.startsWith('/') || /[?#\\]/.test(route)) throw Error('Choose the recorded route path without query or session values.');
  const review = ownershipReview(scope, recording, {}, existing);
  if (review.pages.some(page => page.name === name)) throw Error('This application already declares that page.');
  return { name, route, description };
}
