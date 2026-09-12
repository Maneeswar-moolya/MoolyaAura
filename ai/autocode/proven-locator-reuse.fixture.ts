import '../testing/isolated-checkout';
/**
 * Reusing an existing method because the MEASUREMENT says it is that element.
 *
 *   npx tsx ai/autocode/proven-locator-reuse.fixture.ts
 *
 * `findMethod` matches on what the recording CALLED an element. A recorded assertion
 * on the issue-list search box is called `filter-value` - its id - while knowledge
 * declares it under `accessible_name: Search`, so no name matched and the step fell
 * through to a raw locator with `IssuesPage.searchField()` sitting right there.
 * `findParameterisedMethod` could not help: that method takes no argument.
 *
 * `findMethodByProvenLocator` closes it with the one thing neither name has - the
 * expression the recorder proved at the press. It matches two ways, both narrow:
 * exact equivalence with the declared strategy, or a sole authored id that the entry
 * declares as its ONLY concrete selector.
 *
 * WHAT THIS FILE IS REALLY FOR is the list of things it must NOT match. A resolver
 * that reuses too eagerly binds a test to the wrong method, which is worse than the
 * raw locator it replaced, so most of the checks below are refusals.
 *
 * Offline: no browser, no model, no network.
 */

import * as fs from 'fs';
import * as path from 'path';

import { parseRecording } from '../dashboard/recorder';
import {
  findMethodByProvenLocator, mapRecording, pageObjectRequirements, readAssertions, readEvidence,
} from './from-recording';
import { buildIndex } from '../knowledge/index';
import { declaredSelectors, readAllPageKnowledge } from '../knowledge/page-knowledge';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* ------------------------------------------------------ the matches it makes ---- */

/**
 * The resolver is driven DIRECTLY here, with knowledge and an index built for the
 * check, rather than through `mapRecording`.
 *
 * The first version of this file went through `mapRecording` and proved nothing: a
 * recorded `page.locator('#ap_notifications_panel')` has its target name derived from
 * the id, `findMethod` matched that against the knowledge entry's `id:` field, and the
 * "reuse by proven locator" check passed without the new resolver ever running. Same
 * mistake as the parked-claim fixture made - testing the assumption instead of the
 * thing. Calling it directly is the only way to know which resolver answered.
 *
 * The end-to-end behaviour is still checked, on the real recording, further down.
 */
const entry = (over: Record<string, unknown>) => ({
  id: 'e', page_object: 'IssuesPage', page_object_method: 'searchField', ...over,
}) as never;

/**
 * A framework index holding one Page Object.
 *
 * `fixtures` is not decoration: reuse now requires that a fixture can DELIVER the class,
 * not merely that the method exists, so an index without it declares nothing deliverable
 * and every check below would pass for the wrong reason. `issuesPage` is what
 * `fixtureFor('IssuesPage')` derives and what tests-e2e/fixtures.ts declares.
 */
const index = (methods: Array<{ name: string; params?: unknown[] }>) => ({
  pages: { IssuesPage: { methods } },
  fixtures: ['issuesPage', 'page', 'step'],
  support: {},
}) as never;

const page = (elements: unknown[]) => [{ file: 'test.yaml', elements }] as never;

/** Evidence carrying one press-time proven candidate for `expression`. */
const evidence = (expression: string, over: Record<string, unknown> = {}) => ({
  locator: expression,
  target: { tag: 'input' },
  ancestors: [],
  derivedCandidates: [{
    strategy: 'stable-id', expression, matchCount: 1,
    identityMatched: true, sameDocument: true, measuredAt: 'press', ...over,
  }],
}) as never;

const ONE = index([{ name: 'searchField' }]);

function checkMatches(): void {
  process.stdout.write('\n== an existing method, found by the proven expression ==\n');

  // 1. EXACT EQUIVALENCE, with quoting and spacing normalised.
  const exact = findMethodByProvenLocator(
      evidence('page.locator("#record_search")'),
      page([entry({ locator_strategy: "page.locator('#record_search')" })]), ONE, 'action');
  check('a declared strategy that IS the proven expression resolves',
      exact?.method === 'searchField', exact?.method ?? 'no match');

  // 2. A SOLE AUTHORED ID, declared amid prose - the shape the corpus actually uses.
  const byId = findMethodByProvenLocator(
      evidence('page.locator("#record_search")'),
      page([entry({ locator_strategy: '#record_search - only one copy on this screen' })]),
      ONE, 'action');
  check('a sole authored id declared in prose resolves', byId?.method === 'searchField',
      byId?.method ?? 'no match');

  // The recorded NAME plays no part: there is none here at all.
  check('and it matched on the measurement, not on any name',
      byId?.why.includes('proved') === true, byId?.why ?? '');
}

/* --------------------------------------------------- the matches it refuses ---- */

function checkRefusals(): void {
  process.stdout.write('\n== what it must not match ==\n');

  const declared = page([entry({ locator_strategy: '#record_search' })]);
  const refused = (over: Record<string, unknown>) =>
    findMethodByProvenLocator(evidence('page.locator("#record_search")', over), declared, ONE, 'action');

  // NO PRESS-TIME PROOF. Each condition on its own.
  for (const [label, over] of [
    ['measured at claim time', { measuredAt: 'claim' }],
    ['identity not matched', { identityMatched: false }],
    ['identity unstated', { identityMatched: undefined }],
    ['a different document', { sameDocument: false }],
    ['two elements matched', { matchCount: 2 }],
  ] as Array<[string, Record<string, unknown>]>)
    check(`${label} -> no reuse`, refused(over) === null, refused(over)?.method ?? 'refused');

  check('no evidence at all -> no reuse',
      findMethodByProvenLocator(null, declared, ONE, 'action') === null);

  // A GENERATED ID names one issue, not one element.
  check('a generated id never resolves',
      findMethodByProvenLocator(evidence('page.locator("#tc_summary_636432")'),
          page([entry({ locator_strategy: '#tc_summary_636432' })]), ONE, 'action') === null);

  // POSITION IS NOT IDENTITY.
  check('a positional proven expression never resolves',
      findMethodByProvenLocator(evidence('page.locator("#record_search").first()'),
          declared, ONE, 'action') === null);

  // AMBIGUITY IS NOT A MATCH. Two entries claiming one id identifies nothing - and
  // this is REAL: `NotificationsPanel.panel` declares `#ap_notifications_panel` as the
  // element, and `settingsButton` names the same id as the SCOPE it searches inside.
  // Nothing in prose distinguishes a scope from an element, so both are refused.
  const two = findMethodByProvenLocator(
      evidence('page.locator("#ap_notifications_panel")'),
      page([
        entry({ page_object_method: 'panel', locator_strategy: '#ap_notifications_panel - an authored id' }),
        entry({ page_object_method: 'settingsButton', locator_strategy: 'searched inside #ap_notifications_panel first' }),
      ]),
      index([{ name: 'panel' }, { name: 'settingsButton' }]), 'action');
  check('two methods claiming one id -> no reuse', two === null, two?.method ?? 'refused');
  // AN ID THAT IS ONLY PART OF A DECLARED CHAIN. `LoginPage.errorMessage` declares
  // `#toast-container .toast-message`: the id names the container, the element is the
  // class. Requiring the id to be the entry's ONLY selector is what excludes it.
  check('an id that is only part of a declared chain does not resolve',
      findMethodByProvenLocator(evidence('page.locator("#toast-container")'),
          page([entry({ locator_strategy: '#toast-container .toast-message - auto-dismisses' })]),
          ONE, 'action') === null);
  // A method nobody wrote is not a capability.
  check('an entry naming a method that does not exist -> no reuse',
      findMethodByProvenLocator(evidence('page.locator("#record_search")'), declared,
          index([{ name: 'somethingElse' }]), 'action') === null);

  // ACTION AND ASSERTION STAY SEPARATE where knowledge says which.
  check('an action-declared method never serves an assertion',
      findMethodByProvenLocator(evidence('page.locator("#record_search")'),
          page([entry({ usage: 'action', locator_strategy: '#record_search' })]),
          ONE, 'assertion') === null);
  check('an assertion-declared method never serves an action',
      findMethodByProvenLocator(evidence('page.locator("#record_search")'),
          page([entry({ usage: 'assertion', locator_strategy: '#record_search' })]),
          ONE, 'action') === null);
  check('an entry declaring no usage serves both, so one control needs one method',
      findMethodByProvenLocator(evidence('page.locator("#record_search")'), declared, ONE, 'action') !== null
      && findMethodByProvenLocator(evidence('page.locator("#record_search")'), declared, ONE, 'assertion') !== null);

  // A PARAMETERISED METHOD belongs to the other resolver, which supplies its argument.
  check('a method with a required parameter is left to the parameterised resolver',
      findMethodByProvenLocator(evidence('page.locator("#record_search")'), declared,
          index([{ name: 'searchField', params: [{ name: 'q', type: 'string' }] }]),
          'action') === null);
  check('but an optional-only parameter is still reusable here',
      findMethodByProvenLocator(evidence('page.locator("#record_search")'), declared,
          index([{ name: 'searchField', params: [{ name: 'q', optional: true }] }]),
          'action')?.method === 'searchField');
}

/* ------------------------------------ separation, and the resolvers around it ---- */

function checkSeparationAndOrder(): void {
  process.stdout.write('\n== action and assertion, and the other two resolvers ==\n');

  const index = buildIndex();
  const knowledge = readAllPageKnowledge();

  // A method knowledge declares FOR AN ACTION may not serve an assertion. The corpus
  // has exactly one such entry, and it is parameterised, so this resolver skips it
  // twice over - by usage and by arity.
  const declared = knowledge.flatMap(page => page.elements)
      .filter(element => (element.usage ?? '').trim());
  check('at least one entry declares its usage', declared.length > 0,
      declared.map(element => `${element.page_object_method}=${element.usage}`).join(', '));

  // A method that takes an argument belongs to findParameterisedMethod, not here.
  const parameterised = (index.pages.IssuesPage?.methods ?? [])
      .filter(method => (method.params ?? []).some(parameter => !parameter.optional))
      .map(method => method.name);
  check('parameterised methods exist and are left to the parameterised resolver',
      parameterised.includes('issueCheckbox') && parameterised.includes('issueCheckboxState'),
      parameterised.join(', '));

  // And they still resolve, through their own resolver, unchanged.
  const id = 'TC_ROW_B';
  const file = path.join(RECORDINGS(), `${id}.spec.ts`);
  if (fs.existsSync(file)) {
    const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
      startUrl: '', browser: '', durationMs: 0,
      evidence: readEvidence(id), stateAssertions: readAssertions(id) });
    const steps = mapRecording(recording).steps;
    check('parameterised reuse is unchanged by the new resolver',
        steps.some(step => step.method === 'issueCheckboxState'),
        steps.filter(step => step.kind === 'page-object').map(step => step.method).join(', '));
  }
}

/* --------------------------------- the tokeniser both sides compare through ---- */

function checkTokeniser(): void {
  process.stdout.write('\n== a declared strategy yields the ELEMENT, not just its container ==\n');

  // THIS HAS BROKEN TWICE, in opposite directions, and both times silently.
  //
  //  1. Method calls were read as classes, so `.filter` and `.locator` became tokens
  //     and two unrelated chained expressions "matched" on one of them.
  //  2. Stripping those calls then removed `.locator(` - the marker the "does this
  //     read like a selector" test looks for - so every camelCase class vanished.
  //     `issueCheckboxState` kept only `.tabulator-row`, the row it sits in, and was
  //     matched on the container rather than the control.
  //
  // The invariant underneath both: the LAST token must be the element the method
  // returns, never a container and never a method name.
  const entries = readAllPageKnowledge().flatMap(page => page.elements);
  const last = (name: string): string => {
    const tokens = declaredSelectors(entries.find(e => e.page_object_method === name)!);
    return tokens[tokens.length - 1] ?? '(none)';
  };

  for (const [method, own] of [
    ['issueCheckboxState', '.bugChecked'],
    ['issueCheckbox', '.rounded-checkbox-ui'],
    ['searchField', '#record_search'],
  ] as Array<[string, string]>)
    check(`${method} resolves to ${own}`, last(method) === own, last(method));

  check('no Playwright method name is ever a token',
      !entries.some(entry => declaredSelectors(entry)
          .some(token => /^\.(locator|filter|getBy|click|fill|first|nth|press)/.test(token))),
      entries.flatMap(e => declaredSelectors(e)).filter(t => /^\.(locator|filter)/.test(t)).join(', '));

  // And the consequence that matters: two methods must not claim one element.
  const owners = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.page_object_method) continue;
    const tokens = declaredSelectors(entry);
    const own = tokens[tokens.length - 1];
    if (!own) continue;
    owners.set(own, (owners.get(own) ?? new Set()).add(`${entry.page_object}.${entry.page_object_method}`));
  }
  const shared = [...owners].filter(([, set]) => set.size > 1);
  check('synthetic declarations have no accidental element collisions',
      shared.length === 0,
      shared.map(([t, set]) => `${t} -> ${[...set].join('/')}`).join(' | ') || 'none');
}

/* ------------------------------------------- TC_SEARCH, the real recording ---- */

function checkRealCase(): void {
  process.stdout.write('\n== TC_SEARCH, end to end ==\n');
  const id = 'TC_SEARCH';
  const file = path.join(RECORDINGS(), `${id}.spec.ts`);
  if (!fs.existsSync(file)) {
    check('the TC_SEARCH recording is present', false, file);
    return;
  }
  const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
    startUrl: '', browser: '', durationMs: 0,
    evidence: readEvidence(id), stateAssertions: readAssertions(id) });
  const mapping = mapRecording(recording);
  const code = mapping.steps.flatMap(step => step.code).join('\n');

  const search = mapping.steps.filter(step => step.method === 'searchField');
  check('all THREE #record_search steps reuse the one method', search.length === 3,
        `${search.length} step(s)`);
  check('click, fill and the assertion, on the same method',
      /searchField\(\)\)\.click\(\)/.test(code)
      && /searchField\(\)\)\.fill\(/.test(code)
      && /searchField\(\)\)\.toHaveValue\(/.test(code));
  check('no raw #record_search locator survives', !/locator\("#record_search"\)/.test(code),
      code.split('\n').filter(line => /filter-value/.test(line)).join(' | ').slice(0, 90));
  check('and it is IssuesPage, not the project list',
      search.every(step => step.pageObject === 'IssuesPage'));

  // No second method was invented for it.
  const methods = (buildIndex().pages.IssuesPage?.methods ?? []).map(method => method.name);
  check('no filterValue method was created alongside searchField',
      !methods.some(name => /^filterValue/.test(name)), methods.join(', '));

  // WHAT REMAINS REQUIRED IS WHAT SHOULD REMAIN, and the count is deliberately not
  // pinned any more.
  //
  // It used to be two: a text-only-identity element and a target whose evidence
  // predates press-time capture. It is now one, because the first of those gained a
  // real abstraction - `ProjectsPage.projectCard(description)`, created by the
  // resolver from TC_LOGIN_112's measurement and reused here by a recording that knows
  // nothing about it. A hard `=== 2` turned that improvement into a red fixture, which
  // is the wrong way round: this file is about REUSE, so the assertion is that the
  // number never GROWS and that the search box is never among them.
  const required = pageObjectRequirements(mapping).map(entry => entry.target);
  check('no more than two elements still need a Page Object', required.length <= 2,
      `${required.length}: ${required.join(' | ')}`);
  check('and what remains is the press-time-unproven target, not a reusable capability',
      required.every(target => /rounded-checkbox-ui|tabulator-cell/.test(target)),
      required.join(' | '));
  check('and none of them is the search box',
      !required.some(target => /filter-value|Search/i.test(target)));
}

function main(): void {
  checkMatches();
  checkRefusals();
  checkSeparationAndOrder();
  checkTokeniser();
  checkRealCase();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
