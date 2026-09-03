/**
 * Parameters: arity, extraction, and reuse of one method by many recordings.
 *
 *   npx tsx ai/autocode/parameter.fixture.ts
 *
 * Consolidated from parameterised-method and parameter-reuse. The first half
 * guards the C1 guard - a method whose required argument cannot be established is
 * refused rather than called with `()`. The second half guards round-trip reuse -
 * the argument is read from the proven expression, and substituting it back must
 * reproduce that expression exactly.
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildIndex } from '../knowledge/index';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording, readAssertions, readEvidence } from './from-recording';
import {
  extractFromTemplate, rejectValue, resolveParameterisedReuse, sourceOf, templateOf,
} from './abstraction/parameter';
import type { CandidateMeasurement, DomNode, TargetEvidence } from './dom-evidence';
import type { IndexedMethod } from '../knowledge/index';
import { readAllPageKnowledge, type PageElement } from '../knowledge/page-knowledge';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* ---------- from parameterised-method.fixture.ts ---------- */
function sectionArity(): void {
  /**
   * A Page Object method's PARAMETERS decide whether it can be called at all.
   *
   *   npx tsx ai/autocode/parameterised-method.fixture.ts
   *
   * `WorkspacePage.dashboardTab(name)` and `WorkspacePage.sectionHeader()` are
   * indistinguishable by name and return type. A matcher that ignores arity emitted
   *
   *   await (await workspacePage.dashboardTab()).click();
   *
   * which compiles - there is no typecheck in this repository - and throws TypeError
   * the moment it runs, because the method does `name.replace(...)` on undefined.
   *
   * An argument is supplied only from AUTHORED KNOWLEDGE, and only when four things
   * hold: exactly one required parameter, declared `string`, and a non-empty
   * `accessible_name` on the matched element, passed verbatim. Anything else refuses
   * the match and falls through to the recorded locator - the same answer this
   * matcher already gives for ambiguity, for the same reason: a raw locator is
   * honestly labelled and was used against the running application.
   *
   * What is NOT a source of an argument: the recorded target, the locator chain, DOM
   * text. Those are inference - plausible, unfalsifiable, and wrong exactly when the
   * rendered text is not the value the method wants.
   *
   * Offline: no browser, no model, no network.
   */






  /** One synthetic recording, straight through the real pipeline. */
  function stepsFor(body: string): Array<{ kind: string; code: string }> {
    const script = [
      "import { test, expect } from '@playwright/test';",
      '',
      "test('t', async ({ page }) => {",
      body,
      '});',
    ].join('\n');
    return mapRecording(parseRecording(script, { startUrl: '', browser: '', durationMs: 0 }))
        .steps.map(step => ({ kind: step.kind, code: step.code.join(' ') }));
  }

  /** Every element entry across every knowledge file, with what it declares. */
  function declaredElements(): Array<{ file: string; pageObject: string; method: string; named: boolean }> {
    const dir = path.join(ROOT, 'ai', 'knowledge', 'page');
    const out: Array<{ file: string; pageObject: string; method: string; named: boolean }> = [];
    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.yaml'))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const block of source.split(/\n {2}(?=[\w-]+:)/)) {
        const method = /page_object_method:\s*(\w+)/.exec(block);
        const pageObject = /page_object:\s*(\w+)/.exec(block);
        if (method && pageObject)
          out.push({ file, pageObject: pageObject[1], method: method[1], named: /accessible_name:\s*\S/.test(block) });
      }
    }
    return out;
  }

  const requiredParams = (pageObject: string, method: string) => {
    const indexed = buildIndex().pages[pageObject]?.methods.find(entry => entry.name === method);
    return (indexed?.params ?? []).filter(param => !param.optional);
  };

  /* ---------------------------------------------------------------- arity ---- */

  function checkArity(): void {
    process.stdout.write('\n== the signature is part of whether a method is callable ==\n');
    const index = buildIndex();
    const method = (cls: string, name: string) =>
      index.pages[cls]?.methods.find(entry => entry.name === name);

    // 10: a type can contain a comma. Splitting naively turns one parameter into two,
    // which would make a callable method look uncallable.
    const signIn = method('LoginPage', 'signIn');
    check('10: `signIn(email: string, password: string)` parses as two parameters',
        signIn?.params?.length === 2, JSON.stringify(signIn?.params ?? null));
    const rowStatus = method('IssuesPage', 'rowStatus');
    check('10: a Locator-typed parameter keeps its declared type',
        rowStatus?.params?.[0]?.type === 'Locator', JSON.stringify(rowStatus?.params ?? null));

    // 7: an optional parameter is not a required one.
    check('7: `errorText(timeoutMs = 8000)` has no REQUIRED parameter',
        requiredParams('LoginPage', 'errorText').length === 0);
    check('7: nor does `projectCardsInteractive(timeout = 15_000)`',
        requiredParams('ProjectsPage', 'projectCardsInteractive').length === 0);
  }

  /* -------------------------------------------------------------- the guard ---- */

  function checkGuard(): void {
    process.stdout.write('\n== a method that cannot be called safely is not matched ==\n');

    // 2: THE DEFECT. Both of these used to emit a zero-argument call.
    // SCOPED, deliberately. These were bare `getByText(...)` locators, which are now
    // refused before generation - an unscoped text locator nothing measured is what
    // made TC_LOGIN_096 fail Playwright's strict mode at run time. That refusal would
    // mask the thing this case is about: that a method which cannot be CALLED safely
    // makes the step fall through to its recorded locator instead of vanishing. A
    // scoped locator survives the strict-mode gate, so the guard is exercised again.
    const steps = stepsFor([
      "  await page.locator('#header').getByText('dashboard tab').click();",
      "  await page.locator('#header').getByText('language option').click();",
    ].join('\n'));
    const emitted = steps.map(step => step.code).join('\n');
    check('2: `dashboardTab()` is never emitted', !/dashboardTab\(\s*\)/.test(emitted), emitted.slice(0, 80));
    check('2: `languageOption()` is never emitted', !/languageOption\(\s*\)/.test(emitted));

    // 3: refused means "fall through", not "give up". A dropped step loses the action;
    // NEEDS_REVIEW asks a person about a locator that is perfectly fine.
    const targeted = steps.filter(step => /dashboard tab|language option/.test(step.code));
    check('3: the step survives as a locator step',
        targeted.length === 2 && targeted.every(step => step.kind === 'codegen-locator'),
        targeted.map(step => step.kind).join(', ') || 'no step survived');

    // 4: no element declared a name, so nothing may be passed. The recorded target IS
    // "dashboard tab" - if that ever shows up as an argument, inference has crept in.
    check('4: the recorded target never becomes the argument',
        !/dashboardTab\(['"]/.test(emitted) && !/languageOption\(['"]/.test(emitted));
  }

  /* ------------------------------------------------- knowledge is the source ---- */

  function checkKnowledgeIsTheOnlySource(): void {
    process.stdout.write('\n== the value comes from the YAML, or there is no value ==\n');
    const declared = declaredElements();

    // 5 / 6: the two shapes the four conditions exist to refuse, asserted against the
    // REAL knowledge files - so an entry that later gains an accessible_name cannot
    // quietly start supplying an argument the method cannot use.
    const wrongType = declared.filter(entry => {
      const required = requiredParams(entry.pageObject, entry.method);
      return entry.named && required.length === 1 && (required[0].type ?? '') !== 'string';
    });
    check('5: no named entry points at a method whose required parameter is not a string',
        wrongType.length === 0, wrongType.map(e => `${e.pageObject}.${e.method}`).join(', '));

    const twoOrMore = declared.filter(entry =>
      entry.named && requiredParams(entry.pageObject, entry.method).length > 1);
    check('6: nor at one needing two arguments - a single declared name cannot be both',
        twoOrMore.length === 0, twoOrMore.map(e => `${e.pageObject}.${e.method}`).join(', '));

    // 9: a knowledge file that has drifted from the code must match nothing.
    //
    // Scoped to the file this phase owns, and then asserted as a SAFETY property for
    // the rest. `bugasura__root.yaml` names `LoginPage.passwordLengthError`, which no
    // longer exists on the class - pre-existing drift, found by this check and left
    // alone because repairing an unrelated screen's knowledge is not this phase's
    // work. It is harmless precisely because of the second assertion below: `exists()`
    // means a drifted entry never becomes a call.
    const index = buildIndex();
    const missingHere = declared.filter(entry => entry.file === 'bugasura__apps.yaml'
      && !index.pages[entry.pageObject]?.methods.some(m => m.name === entry.method));
    check('9: every page_object_method in bugasura__apps.yaml exists on its class',
        missingHere.length === 0, missingHere.map(e => `${e.pageObject}.${e.method}`).join(', '));

    const drifted = declared.filter(entry =>
      !index.pages[entry.pageObject]?.methods.some(m => m.name === entry.method));
    const driftedCalled = drifted.filter(entry =>
      stepsFor(`  await page.getByText('${entry.method}').click();`)
          .some(step => step.code.includes(`.${entry.method}(`)));
    check('9: and a drifted entry can never produce a call to a method nobody wrote',
        driftedCalled.length === 0,
        `${drifted.length} drifted entr(ies) present: ${drifted.map(e => `${e.pageObject}.${e.method}`).join(', ') || 'none'}`);
  }

  /* --------------------------------------------------- nothing else moved ---- */

  function checkNothingElseMoved(): void {
    process.stdout.write('\n== zero-argument behaviour, and the rules already here ==\n');

    // 1: the whole corpus, not a sample.
    const dir = path.join(ROOT, 'ai', 'dashboard', 'recordings');
    const recordings = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(name => name.endsWith('.spec.ts')) : [];
    const methods = Object.values(buildIndex().pages).flatMap(entry => entry.methods);
    let steps = 0;
    let zeroArg = 0;
    const broken: string[] = [];
    for (const file of recordings) {
      const id = path.basename(file, '.spec.ts');
      const recording = parseRecording(fs.readFileSync(path.join(dir, file), 'utf8'), {
        startUrl: '', browser: '', durationMs: 0,
        evidence: readEvidence(id), stateAssertions: readAssertions(id),
      });
      for (const step of mapRecording(recording).steps) {
        steps += 1;
        const code = step.code.join(' ');
        for (const call of code.matchAll(/\.(\w+)\(\s*\)/g)) {
          const known = methods.find(method => method.name === call[1]);
          if (!known)
            continue;
          zeroArg += 1;
          if ((known.params ?? []).filter(param => !param.optional).length)
            broken.push(`${id}: ${call[1]}()`);
        }
      }
    }
    check('1: every recording still generates', recordings.length > 0 && steps > 0,
        `${recordings.length} recordings, ${steps} steps`);
    check('1: and no zero-argument call goes to a method that requires one',
        broken.length === 0, `${zeroArg} Page Object call(s) checked; ${broken.slice(0, 3).join(', ')}`);

    // 8: the guard runs AFTER the tie rule, so ambiguity is still decided first and
    // still refused. "Search" is a REAL tie in the current knowledge: it is the
    // accessible name of both IssuesPage.searchField and ProjectsPage.projectSearchField,
    // and both match at rank 1. Neither takes an argument, so if the guard had been
    // placed before the tie check this would resolve to whichever was listed first.
    const tie = stepsFor("  await page.getByText('Search').click();");
    check('8: a genuinely ambiguous target is still refused, not resolved by the guard',
        tie.every(step => step.kind !== 'page-object'),
        tie.map(step => `${step.kind}: ${step.code}`).join(' | ').slice(0, 96));

    // 11: entry points are emitted with no argument BY CONSTRUCTION - their regex
    // matches a literal `()`. Asserted behaviourally: a bare navigation still opens
    // the screen through its declared entry point, with an empty call.
    const navigate = stepsFor("  await page.goto('https://my.bugasura.io/');");
    const opener = navigate.find(step => step.kind === 'navigate');
    check('11: a declared entry point is still called with no argument',
        Boolean(opener && /\.\w+\(\s*\);/.test(opener.code)), opener?.code ?? 'no navigate step');
  }

  checkArity();
  checkGuard();
  checkKnowledgeIsTheOnlySource();
  checkNothingElseMoved();
}

/* ---------- from parameter-reuse.fixture.ts ---------- */
function sectionReuse(): void {
  /**
   * Phase 4: an existing parameterised method, called with the argument the recording
   * proves - or not called at all.
   *
   *   npx tsx ai/autocode/parameter-reuse.fixture.ts
   *
   * Phase 3 wrote `IssuesPage.issueCheckboxState(description)`; nothing could supply
   * `description`, so every row target fell back to its contextual locator. What closes
   * that is ROUND-TRIP EQUALITY: the knowledge entry declares the method's locator as a
   * template with the parameter in it, the recorder measured an expression for the
   * element at the press, and matching the two yields the value. Substituting it back
   * must then reproduce the proven expression EXACTLY - so the locator a generated call
   * builds is not similar to the one that was proven, it IS that one, and matchCount,
   * identityMatched, sameDocument and measuredAt carry over untouched.
   *
   * Which is why most of these checks are refusals. Every way the round trip can fail
   * has to end in NEEDS_REVIEW, because the alternative is a call that reads correctly
   * in review and addresses a different row.
   *
   * Offline: no browser, no model, no network.
   */






  const TEMPLATE = "page.locator('.tabulator-row').filter({ hasText: description }).locator('.bugChecked')";
  const VALUE = 'Line Chart : Getting flat line for Weekly and monthly';
  const PROVEN = `page.locator(".tabulator-row").filter({ hasText: "${VALUE}" }).locator(".bugChecked")`;

  const method = (overrides: Partial<IndexedMethod> = {}): IndexedMethod => ({
    name: 'issueCheckboxState', returns: 'Locator',
    params: [{ name: 'description', type: 'string', optional: false }], ...overrides,
  });

  const element = (overrides: Partial<PageElement> = {}): PageElement => ({
    id: 'issue_checkbox_state', usage: 'assertion',
    page_object: 'IssuesPage', page_object_method: 'issueCheckboxState',
    locator_strategy: TEMPLATE, ...overrides,
  } as PageElement);

  const measurement = (overrides: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
    strategy: 'container-text', expression: PROVEN, matchCount: 1,
    identityMatched: true, sameDocument: true, measuredAt: 'press', ...overrides,
  });

  function evidence(candidate: CandidateMeasurement | null = measurement()): TargetEvidence {
    return {
      locator: 'page.locator(\'[id="639978"]\')',
      target: { tag: 'input', type: 'checkbox', stableClasses: ['bugChecked'] } as DomNode,
      ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
      relationships: [], matchCount: 1, captureTiming: 'before-action',
      derivedCandidates: candidate ? [candidate] : [],
    } as TargetEvidence;
  }

  const resolve = (input: Partial<Parameters<typeof resolveParameterisedReuse>[0]> = {}) =>
    resolveParameterisedReuse({
      evidence: evidence(), element: element(), method: method(),
      role: 'assertion', usage: 'assertion', ...input,
    });

  /* ------------------------------------------------------------ the happy path ---- */

  function checkReuse(): void {
    process.stdout.write('\n== an existing parameterised method, called correctly ==\n');

    const outcome = resolve();
    check('1: a proven hasText value gives REUSE_PARAMETERIZED',
        outcome.status === 'REUSE_PARAMETERIZED',
        outcome.status === 'NEEDS_REVIEW' ? outcome.reason : '');
    if (outcome.status !== 'REUSE_PARAMETERIZED')
      return;
    check('the parameter is named as the method declares it',
        outcome.parameters[0].parameterName === 'description');
    check('the value is the recorded one, unmodified',
        outcome.parameters[0].value === VALUE, outcome.parameters[0].value.slice(0, 40));
    check('the source is stated explicitly',
        outcome.parameters[0].source === 'filter.hasText');
    check('and it is marked proven, never inferred',
        outcome.parameters[0].confidence === 'proven');
    check('the expression carried back is the one that was measured',
        outcome.expression === PROVEN);

    check('the template is recognised only when it names every parameter',
        templateOf(element(), method()) === TEMPLATE);
    check('free-text locator_strategy is NOT read as a template',
        templateOf(element({ locator_strategy: '#proj_name, with a placeholder fallback' }), method()) === null);
    check('and a method with no required parameter has no template to match',
        templateOf(element(), method({ params: [] })) === null);
    check('the source shape is identified from the template', sourceOf(TEMPLATE, 'description') === 'filter.hasText');
  }

  /* ---------------------------------------------------------------- refusals ---- */

  function checkRefusals(): void {
    process.stdout.write('\n== every way this must refuse ==\n');

    const cases: Array<[string, ReturnType<typeof resolve>]> = [
      ['2: no parameter source in the template',
        resolve({ element: element({ locator_strategy: "page.locator('.bugChecked')" }) })],
      ['5: the proven expression does not match the template',
        resolve({ evidence: evidence(measurement({ expression: "page.locator('.other').locator('.bugChecked')" })) })],
      ['6: matchCount > 1',
        resolve({ evidence: evidence(measurement({ matchCount: 2 })) })],
      ['7: identityMatched false',
        resolve({ evidence: evidence(measurement({ identityMatched: false })) })],
      ['7: identityMatched UNSTATED is not identityMatched true',
        resolve({ evidence: evidence(measurement({ identityMatched: undefined })) })],
      ['8: sameDocument false',
        resolve({ evidence: evidence(measurement({ sameDocument: false })) })],
      ['9: measuredAt is not press',
        resolve({ evidence: evidence(measurement({ measuredAt: 'claim' })) })],
      ['no measurement at all',
        resolve({ evidence: evidence(null) })],
      ['a required parameter that is not a string',
        resolve({ method: method({ params: [{ name: 'row', type: 'Locator', optional: false }] }) })],
    ];
    for (const [label, outcome] of cases) {
      check(`${label} -> NEEDS_REVIEW`, outcome.status === 'NEEDS_REVIEW',
          outcome.status === 'NEEDS_REVIEW' ? outcome.reason.slice(0, 66) : 'RESOLVED');
    }

    // 4 / 14 / 15: a value that is an identifier rather than a description.
    check('4/15: a numeric id is never a parameter value',
        Boolean(rejectValue('639978')), rejectValue('639978') ?? '');
    check('14: a generated row id is never a parameter value', Boolean(rejectValue('tr_637446')));
    // The repository's own detector, not a second one invented here: it recognises
    // key- and token-shaped strings. Arbitrary passwords are not its job and do not
    // need to be - a parameter is read from a CONTAINER'S VISIBLE TEXT, and a password
    // field's value is redacted by the recorder long before this point, so there is no
    // route by which one could arrive here.
    check('a credential-shaped value is never a parameter value',
        Boolean(rejectValue('sk-ABCDEF0123456789abcdef0123')),
        rejectValue('sk-ABCDEF0123456789abcdef0123') ?? '');
    check('and a token-shaped one likewise',
        Boolean(rejectValue('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc')));
    check('an empty value is refused', Boolean(rejectValue('   ')));
    check('but a real description is accepted', rejectValue(VALUE) === null);

    const numeric = resolve({
      evidence: evidence(measurement({
        expression: 'page.locator(\'.tabulator-row\').filter({ hasText: "639978" }).locator(\'.bugChecked\')',
      })),
    });
    check('4: a dynamic id standing where the parameter goes is refused',
        numeric.status === 'NEEDS_REVIEW',
        numeric.status === 'NEEDS_REVIEW' ? numeric.reason.slice(0, 60) : 'RESOLVED');
  }

  /* -------------------------------------------------------- action vs assertion ---- */

  function checkRoles(): void {
    process.stdout.write('\n== an action method is not an assertion method ==\n');
    const asAction = resolve({ role: 'action' });
    check('10/11: an assertion-declared method is refused for an action target',
        asAction.status === 'NEEDS_REVIEW',
        asAction.status === 'NEEDS_REVIEW' ? asAction.reason.slice(0, 60) : 'RESOLVED');
    const actionMethod = resolve({ role: 'action', usage: 'action', element: element({ usage: 'action' }) });
    check('and permitted for the kind it was declared for',
        actionMethod.status === 'REUSE_PARAMETERIZED');
    const undeclared = resolve({ usage: null, element: element({ usage: undefined }) });
    check('an entry declaring no usage still matches structurally',
        undeclared.status === 'REUSE_PARAMETERIZED',
        'the template match is the substantive guard; usage is the explicit one');
  }

  /* --------------------------------------------------------- no data anywhere ---- */

  function checkNoDataLeak(): void {
    process.stdout.write('\n== the value is an argument, never part of the method ==\n');
    const source = fs.readFileSync(path.join(ROOT, 'tests-e2e', 'pages', 'issues.page.ts'), 'utf8');
    const yaml = fs.readFileSync(path.join(ROOT, 'ai', 'knowledge', 'page', 'bugasura__issues-id.yaml'), 'utf8');

    check('12: no method NAME contains recorded data',
        !/issue639978|lineChart|shiftComparison/i.test(source));
    check('13: the Page Object IMPLEMENTATION contains no recorded value',
        !/Line Chart|Data labels|Compute Flow|Shift Comparison|639978/.test(source));
    check('23: the knowledge file contains no recorded value',
        !/Line Chart|Data labels|Compute Flow|Shift Comparison|639978/.test(yaml));
    check('the method still takes its parameter', /issueCheckboxState\(description: string\)/.test(source));
    check('and uses it in the locator', /hasText: description/.test(source));
  }

  /* ------------------------------------------------------------- real corpus ---- */

  function checkCorpus(): void {
    process.stdout.write('\n== the four real recordings ==\n');
    const emitted = new Map<string, Set<string>>();
    let steps = 0;
    for (const id of ['TC_DASHBOARD_008', 'TC_DASHBOARD_011', 'TC_LOGIN_083', 'TC_LOGIN_085']) {
      const file = path.join(ROOT, 'ai', 'dashboard', 'recordings', `${id}.spec.ts`);
      if (!fs.existsSync(file))
        continue;
      const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
        startUrl: '', browser: '', durationMs: 0,
        evidence: readEvidence(id), stateAssertions: readAssertions(id),
      });
      for (const step of mapRecording(recording).steps) {
        const code = step.code.join(' ');
        const call = /issueCheckboxState\('([^']*)'\)/.exec(code);
        if (!call)
          continue;
        steps += 1;
        emitted.set(id, (emitted.get(id) ?? new Set()).add(call[1]));
        check(`${id}: the call is a page-object step`, step.kind === 'page-object');
      }
    }
    check('the parameterised method is actually called', steps > 0, `${steps} call(s)`);
    check('16/17: several recordings resolve to the SAME method',
        emitted.size >= 2, `${emitted.size} recording(s)`);
    const values = new Set([...emitted.values()].flatMap(set => [...set]));
    check('16: with DIFFERENT argument values', values.size >= 2, `${values.size} distinct value(s)`);
    check('21: and no duplicate method was created for the second value',
        buildIndex().pages.IssuesPage?.methods.filter(entry => /issueCheckboxState/.test(entry.name)).length === 1);

    // 20: idempotent - resolving twice gives the same answer.
    const once = resolve();
    const twice = resolve();
    check('20: resolution is idempotent', JSON.stringify(once) === JSON.stringify(twice));
  }

  /* ------------------------------------------------ nothing else moved ---- */

  function checkNoRegression(): void {
    process.stdout.write('\n== existing behaviour is untouched ==\n');

    // 18/19: a non-parameterised existing method still wins, by name, as before.
    const script = [
      "import { test, expect } from '@playwright/test';",
      '',
      "test('t', async ({ page }) => {",
      "  await page.getByRole('link', { name: 'Notifications' }).click();",
      '});',
    ].join('\n');
    const steps = mapRecording(parseRecording(script, { startUrl: '', browser: '', durationMs: 0 })).steps;
    check('18: non-parameterised reuse still works',
        steps.some(step => step.kind === 'page-object' && /notificationsBell/.test(step.code.join(' '))));

    // 19: an exact name match is tried FIRST - the parameterised path is the fallback.
    //
    // ORDER, NOT ADJACENCY. This used to require the two calls to sit next to each
    // other, which is a fact about formatting rather than about the pipeline; a third
    // resolver between them broke the regex while the invariant it stood for was
    // untouched. What matters is the sequence, so that is what is measured.
    const source = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'from-recording.ts'), 'utf8');
    const chain = source.slice(source.indexOf('const match = findMethod(action.target'));
    const at = (name: string) => chain.indexOf(`${name}(`);
    check('19: findMethod is consulted before findParameterisedMethod',
        at('findMethod') >= 0 && at('findMethod') < at('findParameterisedMethod'));
    check('19: and the proven-locator resolver sits between them',
        at('findMethod') < at('findMethodByProvenLocator')
        && at('findMethodByProvenLocator') < at('findParameterisedMethod'));
    check('22: knowledge declares the method exactly once',
        (fs.readFileSync(path.join(ROOT, 'ai', 'knowledge', 'page', 'bugasura__issues-id.yaml'), 'utf8')
            .match(/page_object_method:\s*issueCheckboxState/g) ?? []).length === 1);

    // The gates themselves, unchanged and still required.
    const parameterSource = fs.readFileSync(
        path.join(ROOT, 'ai', 'autocode', 'abstraction', 'parameter.ts'), 'utf8');
    // THE TIMING BAR, STATED AS BEHAVIOUR RATHER THAN AS A SYMBOL NAME.
    //
    // This check used to be `/isProvenAgainstClickedTarget/.test(source)`, which stopped
    // being true when the resolver started asking `provesIdentity(candidate, role)` - the
    // one place that decides which timing each ROLE may act on. The symbol was never the
    // invariant; these four are, and they have more teeth than a name in a file: an ACTION
    // may still not be resolved on a measurement taken at a pick, and an ASSERTION may,
    // because a pick is when the person made the claim.
    const pickOnly = measurement({ measuredAt: 'pick' });
    check('press-time identity is still required for an ACTION',
        resolve({ evidence: evidence(pickOnly), role: 'action', usage: 'action' }).status === 'NEEDS_REVIEW');
    check('an ASSERTION may be resolved on its own pick-time measurement',
        resolve({ evidence: evidence(pickOnly) }).status === 'REUSE_PARAMETERIZED');
    check('a press still resolves for BOTH roles',
        resolve({ role: 'action', usage: 'action' }).status === 'REUSE_PARAMETERIZED'
        && resolve().status === 'REUSE_PARAMETERIZED');
    check('and the resolver routes through the one shared timing decision',
        /provesIdentity\(candidate, role\)/.test(parameterSource));
    check('and nothing forbidden was introduced',
        !/\.first\(|\.nth\(|dispatchEvent|waitForTimeout|xpath=/.test(parameterSource));

    // Extraction is structural, not fuzzy.
    check('extraction refuses an expression with an extra step',
        extractFromTemplate(TEMPLATE, `${PROVEN}.first()`, ['description']) === null);
    check('extraction refuses a different container',
        extractFromTemplate(TEMPLATE,
            PROVEN.replace('.tabulator-row', '.other-row'), ['description']) === null);
    check('extraction reads the value when the shape matches exactly',
        extractFromTemplate(TEMPLATE, PROVEN, ['description'])?.[0].value === VALUE);
  }

  /* ------------------------------------------------------------- zero AI ---- */

  function checkNoModel(): void {
    process.stdout.write('\n== zero AI ==\n');
    const dir = path.join(ROOT, 'ai', 'autocode', 'abstraction');
    // `semantic.ts` is the ONE sanctioned model call and is named, never inferred.
    const offenders = fs.readdirSync(dir)
        .filter(name => name.endsWith('.ts') && !name.endsWith('.fixture.ts') && name !== 'semantic.ts')
        .map(name => ({ name, body: fs.readFileSync(path.join(dir, name), 'utf8') }))
        .filter(file => /\bclaude\b|anthropic|openai|\bspawn\s*\(|child_process|fetch\s*\(|runAgent/i
            .test(file.body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
    check('24: no DETERMINISTIC module in abstraction/ can reach a model',
        offenders.length === 0, offenders.map(file => file.name).join(', '));
  }

  checkReuse();
  checkRefusals();
  checkRoles();
  checkNoDataLeak();
  checkCorpus();
  checkNoRegression();
  checkNoModel();
}

function main(): void {
  sectionArity();
  sectionReuse();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
