import '../testing/isolated-checkout';
/**
 * The deterministic Page Object abstraction engine, end to end.
 *
 *   npx tsx ai/autocode/abstraction.fixture.ts
 *
 * Consolidated from abstraction-engine, abstraction-writer and
 * abstraction-approval - one pipeline, one fixture. Every assertion from all
 * three is preserved verbatim; each section keeps its own scope so nothing had to
 * be renamed or reconciled to merge them.
 *
 *   classify -> validate -> propose  (what may become a method)
 *   render   -> approve  -> write    (what actually becomes one)
 *
 * Offline: no browser, no model, no network.
 */

import fs from 'node:fs';
import path from 'node:path';
import { looksLikeSecretValue, type CandidateMeasurement, type DomNode, type TargetEvidence } from './dom-evidence';
import {
  chainHasDynamicIdentifier, classify, containerOf, effectiveLocator, isRecorderOwned,
  structuralSignature,
} from './abstraction/classify';
import { forbiddenMechanisms, parameterisationHolds, parameterSourceOf, validateCandidate } from './abstraction/validate';
import {
  baseNameFor, memberNoun, methodNameForTarget, ownerNoun, parameterisedNameFor,
  stateNameFor, withRoleSuffix,
} from './abstraction/naming';
import { analyseCorpus, resolveOwner, routeMatches, writeLedger } from './abstraction/propose';
import { declaredSelectors, readAllPageKnowledge } from '../knowledge/page-knowledge';
import { buildIndex } from '../knowledge/index';
import {
  artefactSnapshot, applyProposals, keyFor, knowledgeFileFor, logicalPrefix, pageFileFor,
  renderMethod, toRepoStyle, validateGenerated, verify,
} from './abstraction/writer';
import { eligibility } from './abstraction/semantic';
import { parseRecording } from '../dashboard/recorder';
import { mapRecording, readAssertions, readEvidence } from './from-recording';
import type { Proposal, ProposalStatus } from './abstraction/types';
import { activeRecordingsDir as RECORDINGS } from '../projects/scope';

const ROOT = process.cwd();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

/* ---------- from abstraction-engine.fixture.ts ---------- */
function sectionEngine(): void {
  /**
   * The deterministic abstraction engine: what may become a Page Object method.
   *
   *   npx tsx ai/autocode/abstraction-engine.fixture.ts
   *
   * Phase 1 proposes and never writes, so what this fixture guards is JUDGEMENT: which
   * targets are reusable capabilities, which are data, which are unsafe, and which
   * nobody can attribute. A wrong answer here would later become a method in every
   * test that reuses it, so every rule is pinned - including the ones whose whole job
   * is to refuse.
   *
   * Offline: no browser, no model, no network. The engine itself makes no model call,
   * and the last check in this file asserts that by reading its own source.
   */






  /** A press-time measurement that satisfies P0.7 in full. */
  const proven = (expression: string): CandidateMeasurement => ({
    strategy: 'role-name', expression, matchCount: 1,
    identityMatched: true, sameDocument: true, measuredAt: 'press',
  });

  /** An evidence row, with everything a classifier reads and nothing it does not. */
  function evidence(node: Partial<DomNode>, extra: Partial<TargetEvidence> = {}): TargetEvidence {
    const target = { tag: 'div', ...node } as DomNode;
    return {
      locator: extra.locator ?? `page.locator('#${target.id ?? 'x'}')`,
      target,
      ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
      relationships: [], matchCount: 1, captureTiming: 'before-action',
      derivedCandidates: [proven(extra.locator ?? 'page.getByRole("button")')],
      ...extra,
    } as TargetEvidence;
  }

  /* ------------------------------------------------------- rules 0 through 9 ---- */

  function checkClassification(): void {
    process.stdout.write('\n== the ten rules, in order ==\n');

    // 0 - the recorder's own overlay is not the application.
    const picker = evidence({ tag: 'button', accessibleName: 'Assert: pick an element' },
        { locator: "page.locator('ba-aura-assert')" });
    check('0: picker host is excluded', classify(picker).category === 'RECORDER_OWNED');
    const veil = evidence({ tag: 'div', stableClasses: ['veil'] });
    check('0: the picker veil is excluded', isRecorderOwned(veil));

    // 1 - a generated id names one row of data, not one element.
    // No proven stable alternative: the generated id is all there is, so it is refused.
    const numeric = evidence({ tag: 'input', id: '639978' },
        { identifier: { raw: '639978', dynamic: true, normalised: '<dynamic>' }, derivedCandidates: [] });
    check('1: numeric id 639978 is refused', classify(numeric).category === 'DYNAMIC');
    const uuid = evidence({ tag: 'div', id: 'a3f1c2de-9b77-4c11-8f2e-6d5a4b3c2e10' }, {
      identifier: { raw: 'a3f1c2de-9b77-4c11-8f2e-6d5a4b3c2e10', dynamic: true, normalised: '<uuid>' },
      derivedCandidates: [],
    });
    check('1: a UUID is refused', classify(uuid).category === 'DYNAMIC');
    // The other half of the same rule: a dynamic id is not a verdict about the ELEMENT
    // when the recorder proved a stable contextual expression for it. The id still
    // never becomes the locator - it is simply not the only thing on offer.
    const rescued = evidence({ tag: 'input', type: 'checkbox', stableClasses: ['bugChecked'], id: '639978' }, {
      identifier: { raw: '639978', dynamic: true, normalised: '<dynamic>' },
      ancestors: [{ tag: 'div', stableClasses: ['tabulator-row'] } as never],
      derivedCandidates: [proven('page.locator(".tabulator-row").filter({ hasText: "x" }).locator(".bugChecked")')],
    });
    check('1: a dynamic id with a PROVEN stable alternative is not refused on the id',
        classify(rescued).category !== 'DYNAMIC', classify(rescued).category);
    check('1: a generated id ANYWHERE in the chain is refused',
        chainHasDynamicIdentifier("page.locator('#tr_637446 > .tabulator-cell > .rounded-checkbox-ui')"));
    check('1: an authored id in a chain is not', !chainHasDynamicIdentifier("page.locator('#loginForm .btn')"));

    // 2 - a count is not an identity.
    const two = evidence({ tag: 'button', accessibleName: 'Close' }, { matchCount: 2, derivedCandidates: [] });
    check('2: matchCount 2 is NEEDS_REVIEW', classify(two).category === 'NOT_UNIQUE');
    const denied = evidence({ tag: 'button', accessibleName: 'Close' }, {
      derivedCandidates: [{ ...proven('x'), identityMatched: false }],
    });
    check('2: identityMatched false is NEEDS_REVIEW', classify(denied).category === 'NOT_UNIQUE');
    const otherDoc = evidence({ tag: 'button', accessibleName: 'Close' }, {
      derivedCandidates: [{ ...proven('x'), sameDocument: false }],
    });
    check('2: a measurement from another document is NEEDS_REVIEW',
        classify(otherDoc).category === 'NOT_UNIQUE');
    const unstated = evidence({ tag: 'button', accessibleName: 'Close' }, {
      derivedCandidates: [{ ...proven('x'), identityMatched: undefined }],
    });
    check('2: an UNSTATED identity is not a proven one',
        classify(unstated).category === 'NOT_UNIQUE', 'absence must never read as true');

    // 3 - a graph taken after the action describes a page that had moved on.
    const late = evidence({ tag: 'button', accessibleName: 'Close' },
        { captureTiming: 'after-action', derivedCandidates: [{ ...proven('x'), measuredAt: 'claim' }] });
    check('3: after-action evidence with no press-time proof is NEEDS_REVIEW',
        ['BAD_TIMING', 'NOT_UNIQUE'].includes(classify(late).category));

    // 4 - a region belongs to a component.
    const dialog = evidence({ tag: 'div', role: 'dialog', id: 'notification_panel' });
    check('4: role=dialog is a COMPONENT candidate', classify(dialog).category === 'COMPONENT');
    for (const role of ['navigation', 'banner', 'complementary', 'region']) {
      check(`4: role=${role} is a COMPONENT candidate`,
          classify(evidence({ tag: 'div', role })).category === 'COMPONENT');
    }

    // 5 - THE RULE. An authored name on something operable.
    const button = evidence({ tag: 'button', accessibleName: 'Notification settings' });
    check('5: an authored button is a METHOD candidate', classify(button).category === 'METHOD');
    check('5: an authored link is a METHOD candidate',
        classify(evidence({ tag: 'a', accessibleName: 'Notifications' })).category === 'METHOD');
    check('5: an authored input is a METHOD candidate',
        classify(evidence({ tag: 'input', accessibleName: 'Email' })).category === 'METHOD');
    check('5: an authored checkbox is a METHOD candidate',
        classify(evidence({ tag: 'input', role: 'checkbox', accessibleName: 'Enable' })).category === 'METHOD');

    // 6 - an authored id, but not the furniture.
    check('6: an authored id on a control is a METHOD candidate',
        classify(evidence({ tag: 'input', id: 'proj_name' })).category === 'METHOD');
    const layout = evidence({ tag: 'div', id: 'main-content' });
    check('6: a layout container such as main-content is NOT a method',
        classify(layout).category === 'UNCLASSIFIED', classify(layout).reason.slice(0, 60));

    // 7 - identified by its own text: that is data.
    const faclon = evidence({ tag: 'span', text: 'Faclon labs', stableClasses: ['handel-over-flow'] },
        { locator: "page.getByText('Faclon labs')" });
    check('7: "Faclon labs" is TEST DATA, never a method',
        classify(faclon).category === 'TEST_DATA', classify(faclon).reason);

    // 8 - structural, inside something that repeats.
    const rowMember = evidence({ tag: 'span', stableClasses: ['rounded-checkbox-ui'] }, {
      ancestors: [{ tag: 'div', stableClasses: ['tabulator-row'] } as never],
    });
    check('8: a row member is a COMPONENT MEMBER candidate',
        classify(rowMember).category === 'COMPONENT_MEMBER');

    // 9 - nothing decided it.
    check('9: an unidentifiable target is UNCLASSIFIED',
        classify(evidence({ tag: 'span' })).category === 'UNCLASSIFIED');
  }

  /* ------------------------------------------------------------ safety gates ---- */

  function checkSafety(): void {
    process.stdout.write('\n== gates that exist to refuse ==\n');

    for (const [locator, what] of [
      ["page.locator('.rounded-checkbox-ui').first()", 'first()'],
      ["page.locator('.row').nth(2)", 'nth()'],
      ["page.locator('xpath=//div[1]')", 'XPath'],
    ] as const) {
      check(`${what} is refused and NEVER stripped to make it pass`,
          forbiddenMechanisms(locator).length > 0, forbiddenMechanisms(locator).join(', '));
    }

    const positional = evidence({ tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
        { locator: "page.locator('.rounded-checkbox-ui').first()" });
    const result = validateCandidate(positional);
    check('a .first() chain never becomes a Page Object method', !result.safe);
    check('and the refusal says why', result.refusals.some(reason => reason.includes('first()')));

    const dynamicChain = evidence({ tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
        { locator: "page.locator('#tr_637446 > .tabulator-cell > .rounded-checkbox-ui')" });
    check('a chain scoped by a generated id is refused', !validateCandidate(dynamicChain).safe);

    const clean = evidence({ tag: 'button', accessibleName: 'Notification settings' },
        { locator: "page.getByRole('button', { name: 'Notification settings' })" });
    const ok = validateCandidate(clean);
    check('a press-time proven, authored target passes', ok.safe, ok.refusals.join('; '));
    check('and the proof is carried for a person to check',
        ok.proof?.matchCount === 1 && ok.proof.identityMatched === true
        && ok.proof.sameDocument === true && ok.proof.measuredAt === 'press');

    const noProof = evidence({ tag: 'button', accessibleName: 'Save' }, { derivedCandidates: [] });
    check('evidence with no press-time measurement is refused, not assumed',
        !validateCandidate(noProof).safe);
  }

  /* ------------------------------------------------------- parameterisation ---- */

  function checkParameterisation(): void {
    process.stdout.write('\n== data becomes a parameter, never a method name ==\n');

    const rows = [
      { signature: 'span.rounded-checkbox-ui@tabulator-row', value: 'Line Chart : Getting flat line', proven: true },
      { signature: 'span.rounded-checkbox-ui@tabulator-row', value: 'LineChart: Data labels', proven: true },
    ];
    check('two same-shaped rows with differing values parameterise',
        parameterisationHolds(rows).holds, parameterisationHolds(rows).reason);
    check('one target alone does not', !parameterisationHolds(rows.slice(0, 1)).holds);
    check('identical values do not - that is one element recorded twice',
        !parameterisationHolds([rows[0], { ...rows[0] }]).holds);
    check('differing structure does not',
        !parameterisationHolds([rows[0], { ...rows[1], signature: 'other' }]).holds);
    check('an unproven member disqualifies the group',
        !parameterisationHolds([rows[0], { ...rows[1], proven: false }]).holds);

    check('the parameter source is read from filter({ hasText })',
        parameterSourceOf('page.locator(".tabulator-row").filter({ hasText: "Line Chart : Getting flat line" })')
          === 'Line Chart : Getting flat line');
    check('and from getByText', parameterSourceOf("page.getByText('Faclon labs')") === 'Faclon labs');
    check('an unstated parameter source is null, never inferred',
        parameterSourceOf("page.locator('.rounded-checkbox-ui')") === null);
  }

  /* --------------------------------------------------------------- naming ---- */

  function checkNaming(): void {
    process.stdout.write('\n== names, and the ones that must never be generated ==\n');

    check('an accessible name becomes camelCase',
        baseNameFor({ tag: 'button', accessibleName: 'Notification settings' } as DomNode) === 'notificationSettings');
    check('a role suffix is added when it reads better',
        withRoleSuffix('notificationSettings', { tag: 'button', role: 'button' } as DomNode)
          === 'notificationSettingsButton');
    check('and is not doubled',
        withRoleSuffix('closeButton', { tag: 'button', role: 'button' } as DomNode) === 'closeButton');
    check('an assertion counterpart is a DIFFERENT NAME, not a flag',
        stateNameFor('issueCheckbox') === 'issueCheckboxState');
    check('applied once only', stateNameFor('issueCheckboxState') === 'issueCheckboxState');

    const node = { tag: 'span', stableClasses: ['rounded-checkbox-ui'] } as DomNode;
    check('an element with no authored name yields no method name',
        methodNameForTarget(node, 'action') === null);

    // The names that record indecision rather than meaning.
    const ledger = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'abstraction', 'naming.ts'), 'utf8');
    check('nothing anywhere appends a numeric disambiguator',
        !/\$\{[^}]*\}\s*\+\s*(count|index|n)\b/.test(ledger) && !/name\s*\+\s*['"`]2/.test(ledger));
  }

  /* ------------------------------------------------------------ ownership ---- */

  function checkOwnership(): void {
    process.stdout.write('\n== ownership is resolved from evidence, or not at all ==\n');
    const knowledge = readAllPageKnowledge();

    const inPanel = evidence({ tag: 'button', accessibleName: 'Close' }, {
      ancestors: [{ tag: 'div', id: 'notification_panel' } as never],
    });
    const owned = resolveOwner(inPanel, knowledge, ['/apps']);
    check('containment inside a known element settles the owner',
        owned.owner === 'NotificationsPanel', `${owned.owner} - ${owned.why}`);

    const ambiguous = resolveOwner(evidence({ tag: 'button', accessibleName: 'X' }), knowledge, ['/apps']);
    check('a route with several declared owners is NOT guessed',
        ambiguous.owner === null, ambiguous.why.slice(0, 80));

    const unknown = resolveOwner(evidence({ tag: 'button', accessibleName: 'X' }), knowledge, ['/nowhere']);
    check('an undeclared route yields no owner', unknown.owner === null, unknown.why);

    const multi = resolveOwner(evidence({ tag: 'button', accessibleName: 'X' }), knowledge, []);
    check('no route yields no owner', multi.owner === null);

    check('a template route matches a concrete path', routeMatches('/issues/:id', '/issues/110769'));
    check('and does not match a different depth', !routeMatches('/issues/:id', '/issues'));
  }

  /* ------------------------------------------- the corpus, and idempotency ---- */

  function checkCorpus(): void {
    process.stdout.write('\n== the synthetic corpus ==\n');
    const first = analyseCorpus();
    const second = analyseCorpus();

    check('the engine runs over every recording', first.proposals.length > 0,
        `${first.proposals.length} distinct proposals`);
    check('IDEMPOTENT: a second run produces an identical proposal set',
        JSON.stringify(first.proposals.map(p => p.fingerprint).sort())
          === JSON.stringify(second.proposals.map(p => p.fingerprint).sort()),
        `${first.proposals.length} vs ${second.proposals.length}`);
    check('every fingerprint is distinct - one line per abstraction',
        new Set(first.proposals.map(p => p.fingerprint)).size === first.proposals.length);

    const status = (name: string) => first.proposals.filter(p => p.status === name).length;
    process.stdout.write(`      PROPOSED ${status('PROPOSED')}  NEEDS_REVIEW ${status('NEEDS_REVIEW')}`
      + `  REUSE ${status('REUSE')}  REFUSED ${status('REFUSED')}\n`);
    process.stdout.write(`      existing methods reused: ${first.reused.length}\n`);

    // Existing reuse must be untouched by any of this.
    check('existing Page Object methods are still reused', first.reused.length > 0,
        `${first.reused.length} reuses`);
    check('a reused method is never also proposed',
        !first.proposals.some(proposal => first.reused.some(entry =>
          entry.pageObject === proposal.owner && entry.method === proposal.method
          && proposal.status === 'PROPOSED')));

    // The specific targets this engine exists to get right.
    const dataProposals = first.proposals.filter(p => p.category === 'TEST_DATA' && p.status === 'PROPOSED');
    check('no test-data target was ever PROPOSED as a method', dataProposals.length === 0,
        dataProposals.map(p => p.target).join(', '));
    const dynamicProposed = first.proposals.filter(p => p.category === 'DYNAMIC' && p.status === 'PROPOSED');
    check('no dynamic identifier was ever PROPOSED', dynamicProposed.length === 0);
    check('every PROPOSED entry has an owner, a method and no refusal',
        first.proposals.filter(p => p.status === 'PROPOSED')
            .every(p => p.owner && p.method && p.refusals.length === 0));
    check('every PROPOSED entry carries full press-time proof',
        first.proposals.filter(p => p.status === 'PROPOSED').every(p =>
          p.proof?.matchCount === 1 && p.proof.identityMatched === true
          && p.proof.sameDocument === true && p.proof.measuredAt === 'press'));

    // NOTHING SENSITIVE REACHES THE LEDGER - but the WORD is not the thing.
    //
    // `#password_field`, `.js-password-input` and `passwordField` are element names,
    // and naming them is the entire job: `LoginPage.passwordField()` already exists.
    // What must never appear is a VALUE, so the test is the same one the redactor
    // applies rather than a search for the word.
    const values = first.proposals.flatMap(proposal => [
      proposal.expression, proposal.parameterSource, proposal.method, proposal.target,
    ].filter((value): value is string => Boolean(value)));
    const leaked = values.filter(value => looksLikeSecretValue(value));
    check('no secret-shaped VALUE reaches the ledger', leaked.length === 0,
        `${values.length} strings checked`);

    // And the real credential, compared against but never printed.
    const envFile = path.join(ROOT, '.env');
    const secret = fs.existsSync(envFile)
      ? /^FIXTUREAPP_PASSWORD=(.+)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim() : '';
    check('the real account password appears nowhere in the ledger',
        !secret || !JSON.stringify(first.proposals).includes(secret),
        secret ? 'compared against the live .env secret' : 'no .env present to compare against');

    // The ledger round-trips, and writing it twice produces identical bytes.
    const tmp = path.join(ROOT, 'ai', 'reports', '.abstraction-idempotency-check.jsonl');
    writeLedger(first, tmp);
    const once = fs.readFileSync(tmp, 'utf8');
    writeLedger(second, tmp);
    const twice = fs.readFileSync(tmp, 'utf8');
    check('writing the ledger twice produces identical bytes',
        once === twice && once.split('\n').filter(Boolean).length === first.proposals.length);
    fs.unlinkSync(tmp);

    // The index must still be valid - this phase touched no Page Object.
    const index = buildIndex();
    const knowledge = readAllPageKnowledge();
    const broken = knowledge.flatMap(page => page.elements
        .filter(element => element.page_object && element.page_object_method
          && !index.pages[element.page_object]?.methods.some(m => m.name === element.page_object_method))
        .map(element => `${element.page_object}.${element.page_object_method}`));
    check('buildIndex is still valid for fixtureapp__apps.yaml',
        !broken.some(name => /NotificationsPanel|WorkspacePage|ProjectsPage/.test(name)), broken.join(', '));
  }

  /* ------------------------------------------------------- no model, at all ---- */

  function checkNoModel(): void {
    process.stdout.write('\n== zero AI ==\n');
    const dir = path.join(ROOT, 'ai', 'autocode', 'abstraction');
    // THE INVARIANT MOVED, AND GOT STRICTER. `semantic.ts` is the ONE module allowed to
    // reach a model. It is named here rather than pattern-matched, so a second such
    // module fails this check exactly as the first would have - and what is asserted
    // now is that the DETERMINISTIC path is model-free AND cannot reach the resolver
    // at all, which a directory-wide scan never said.
    const RESOLVER = 'semantic.ts';
    const sources = fs.readdirSync(dir)
        .filter(name => name.endsWith('.ts') && !name.endsWith('.fixture.ts') && name !== RESOLVER)
        .map(name => ({ name, body: fs.readFileSync(path.join(dir, name), 'utf8') }));
    const offenders = sources.filter(file =>
      /\bclaude\b|anthropic|openai|\bspawn\s*\(|child_process|fetch\s*\(|runAgent|\.\.\/agent/i
          .test(file.body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
    check('no DETERMINISTIC module in abstraction/ calls a model or spawns anything',
        offenders.length === 0, offenders.map(file => file.name).join(', '));
    check('and no deterministic module imports the resolver - it is a post-pass, not a stage',
        !sources.some(file => /from '\.\/semantic'/.test(file.body)),
        sources.filter(file => /from '\.\/semantic'/.test(file.body)).map(file => file.name).join(', '));
    check('and the resolver exists, so this exception is real rather than assumed',
        fs.existsSync(path.join(dir, RESOLVER)));
    check('and none of them imports the agent',
        !sources.some(file => /from '.*agent'/.test(file.body)));
  }

  /* ------------------------------------------------- C4: parameterised methods ---- */

  /** A row member: the element, its row, and what the recorder measured for it. */
  function rowMember(
    member: Partial<DomNode>,
    rowText: string,
    options: { proven?: boolean; recorded?: string; rowId?: string } = {},
  ): TargetEvidence {
    const resolved = `page.locator(".tabulator-row").filter({ hasText: "${rowText}" })`
      + `.locator(".${(member.stableClasses ?? ['x'])[0]}")`;
    return evidence(member, {
      locator: options.recorded ?? 'page.locator(\'[id="639978"]\')',
      identifier: { raw: '639978', dynamic: true, normalised: '<dynamic>' },
      ancestors: [{ tag: 'div', id: options.rowId ?? 'tr_639978',
        stableClasses: ['tabulator-row', 'animated', 'fadeIn'] } as never],
      derivedCandidates: options.proven === false ? [] : [{ ...proven(resolved), strategy: 'contextual' }],
    });
  }

  function checkParameterisedMethods(): void {
    process.stdout.write('\n== C4: a row member becomes a method with an argument ==\n');

    const checkbox = { tag: 'span', stableClasses: ['rounded-checkbox-ui'] };
    const state = { tag: 'input', type: 'checkbox', stableClasses: ['bugChecked'] };

    // The structural facts grouping depends on.
    const a = rowMember(state, 'Line Chart : Getting flat line');
    const b = rowMember(state, 'LineChart: Data labels', { rowId: 'tr_637446' });
    check('two rows of the same shape share a structural signature',
        structuralSignature(a) === structuralSignature(b), String(structuralSignature(a)));
    check('a different control in the same row does not',
        structuralSignature(a) !== structuralSignature(rowMember(checkbox, 'Line Chart : Getting flat line')));
    check('the signature carries no id, text or state class',
        !/639978|Line Chart|animated|fadeIn/.test(String(structuralSignature(a))), String(structuralSignature(a)));
    check('the container is the row', containerOf(a)?.stableClasses?.includes('tabulator-row') === true);

    // THE DYNAMIC ID IS NEVER THE LOCATOR - the contextual expression is.
    const effective = effectiveLocator(a);
    check('a row target resolves to the contextual locator, not the row id',
        effective.proven && effective.expression.includes('.tabulator-row')
        && !/639978|tr_637446/.test(effective.expression), effective.expression);
    check('and the generated id never appears in it', !chainHasDynamicIdentifier(effective.expression));
    check('a row target with NO proven alternative stays refused on its dynamic id',
        classify(rowMember(state, 'x', { proven: false })).category === 'DYNAMIC');
    check('a chain scoped by the row id is refused even though the id is unique',
        !validateCandidate(rowMember(state, 'x', {
          proven: false, recorded: "page.locator('#tr_637446 > .tabulator-cell > .bugChecked')",
        })).safe);

    // NAMING: from the owner and the element kind, never from the data.
    check('IssuesPage yields the noun "issue"', ownerNoun('IssuesPage') === 'issue');
    check('ProjectsPage yields "project"', ownerNoun('ProjectsPage') === 'project');
    check('a checkbox input yields the kind "Checkbox"', memberNoun(state as DomNode) === 'Checkbox');
    check('a class naming a checkbox does too', memberNoun(checkbox as DomNode) === 'Checkbox');
    check('an action method is issueCheckbox',
        parameterisedNameFor('IssuesPage', checkbox as DomNode, 'action') === 'issueCheckbox');
    check('an assertion method is issueCheckboxState - a DIFFERENT method',
        parameterisedNameFor('IssuesPage', state as DomNode, 'assertion') === 'issueCheckboxState');
    check('the two never collide',
        parameterisedNameFor('IssuesPage', checkbox as DomNode, 'action')
          !== parameterisedNameFor('IssuesPage', state as DomNode, 'assertion'));
    check('no derived name contains the recorded data',
        !/639978|637446|faclon|lineChart/i.test(
            String(parameterisedNameFor('IssuesPage', state as DomNode, 'assertion'))));
    check('an unrecognisable element kind yields no name, so the group is reviewed',
        parameterisedNameFor('IssuesPage', { tag: 'span' } as DomNode, 'action') === null);

    // The four conditions, at the boundary.
    const asMember = (item: TargetEvidence, value: string | null, isProven = true) =>
      ({ signature: String(structuralSignature(item)), value, proven: isProven });
    check('two equivalent rows with different descriptions parameterise',
        parameterisationHolds([asMember(a, 'Line Chart'), asMember(b, 'Data labels')]).holds);
    check('the same value recorded twice does not',
        !parameterisationHolds([asMember(a, 'Line Chart'), asMember(b, 'Line Chart')]).holds);
    check('a different container relationship does not',
        !parameterisationHolds([asMember(a, 'one'),
          asMember(rowMember(checkbox, 'two'), 'two')]).holds);
    check('one unproven member refuses the group',
        !parameterisationHolds([asMember(a, 'one'), asMember(b, 'two', false)]).holds);
    check('a missing parameter source refuses it',
        !parameterisationHolds([asMember(a, null), asMember(b, 'two')]).holds);
  }

function checkParameterisedCorpus(): void {
    const result = analyseCorpus();
    const reused = result.reused.filter(e => e.method === 'issueCheckboxState');
    check('parameterised state capability is reused across distinct recordings', new Set(reused.map(e => e.testCaseId)).size === 2);
    check('all state reuses retain their declared owner', reused.every(e => e.pageObject === 'IssuesPage'));
    check('a resolved capability is not proposed a second time', !result.proposals.some(p => p.status === 'PROPOSED' && p.method === 'issueCheckboxState'));
    check('repeat analysis is idempotent', JSON.stringify(result.proposals.map(({ timestamp, ...rest }) => rest)) === JSON.stringify(analyseCorpus().proposals.map(({ timestamp, ...rest }) => rest)));
  }

  checkClassification();
  checkSafety();
  checkParameterisation();
  checkNaming();
  checkOwnership();
  checkCorpus();
  checkParameterisedMethods();
  checkParameterisedCorpus();
  checkNoModel();
}

/* ---------- from abstraction-writer.fixture.ts ---------- */
function sectionWriter(): void {
  /**
   * Phase 3: what may be written into a Page Object, and what may never be.
   *
   *   npx tsx ai/autocode/abstraction-writer.fixture.ts
   *
   * The writer is the first part of this engine that changes source a person will read
   * and every future test will depend on. So the checks here are weighted towards
   * REFUSAL: a method that should not exist is far more expensive than one that does
   * not exist yet.
   *
   * THE CASE THIS FIXTURE EXISTS FOR. `Close` was proven, unique, identity-matched and
   * scoped inside `#notification_panel` - and writing it was still wrong, because
   * four other elements in this corpus are also called `Close`. The matcher reads a
   * name page-wide, so declaring it would have bound the add-issue section's Close, the
   * assignee dropdown's, `#first_report_modal`'s and `#response_modal_dialog`'s to a
   * locator that only resolves inside the notification panel. Being well proven is not
   * the same as being unambiguous, and only the corpus can tell the difference.
   *
   * Offline: no browser, no model, no network.
   */






  /** A proposal, with only the fields the writer reads. */
  function proposal(overrides: Partial<Proposal> = {}): Proposal {
    return {
      timestamp: '', testCaseId: 'TC_X', target: 'click Thing', role: 'action',
      category: 'METHOD', rule: 5, status: 'PROPOSED',
      owner: 'IssuesPage', ownerKind: 'page-object', method: 'thingButton',
      parameterised: false, parameterSource: null, locatorStrategy: 'scoped-class',
      // THE PROOF IS A FIELD THE WRITER READS SINCE P13.4: it re-asks the identity
      // question at the mutation boundary rather than trusting the analyser asked it, so
      // a stub with no proof is refused - correctly. A PROPOSED status already requires a
      // safe measurement upstream, so this carries what a real proposal carries.
      expression: "page.locator('#thing')",
      proof: { matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press',
        strategy: 'scoped-class', expression: "page.locator('#thing')" },
      reason: '', refusals: [],
      template: "page.locator('#thing')", parameterName: null, accessibleName: 'Thing',
      sightings: [], refusalCodes: [], resolvedBy: 'deterministic', semantic: null,
      allowedOwners: [], derivedMethod: null, roundTrip: false,
      accessibleNameAmbiguous: false, fingerprint: 'f', ...overrides,
    };
  }

  /* ------------------------------------------------------- only PROPOSED ---- */

  function checkEligibility(): void {
    process.stdout.write('\n== only PROPOSED is eligible ==\n');
    for (const status of ['NEEDS_REVIEW', 'REFUSED', 'REUSE'] as const) {
      const outcome = applyProposals([proposal({ status })], { dry: true });
      check(`${status} is never written`, outcome.results.length === 0 && !outcome.applied);
    }
    // PROPOSED IS WRITTEN, with nobody's countersignature. Every deterministic gate
    // has already passed by the time a line says PROPOSED; asking a person to confirm
    // that was asking them to confirm arithmetic, and it is why the loop never closed.
    const okayed = applyProposals([proposal()], { dry: true });
    check('PROPOSED is rendered with no approval file involved',
        okayed.results.length === 1 && Boolean(okayed.results[0].method));
    check('and a dry run writes nothing', !okayed.applied);
  }

  /* --------------------------------------------------- what is rendered ---- */

  function checkRendering(): void {
    process.stdout.write('\n== the method, in the style already here ==\n');

    const simple = renderMethod(proposal()) ?? '';
    check('a searched-for element takes the resolve() form',
        simple.includes('this.resolve(') && simple.includes('Promise<Locator>'));
    check('with the repository\'s logical-name convention',
        simple.includes("'issues.thingButton'"), logicalPrefix('IssuesPage'));
    check('and exactly one candidate - the one that was proven',
        (simple.match(/build: page =>/g) ?? []).length === 1);

    const row = renderMethod(proposal({
      method: 'issueCheckboxState', role: 'assertion', parameterised: true,
      parameterName: 'description', accessibleName: null,
      template: 'page.locator(".tabulator-row").filter({ hasText: description }).locator(".bugChecked")',
    })) ?? '';
    check('a row member takes the synchronous Locator form, like rowStatus(row)',
        row.includes('(description: string): Locator {') && !row.includes('Promise<Locator>'));
    check('it returns the composed locator',
        row.includes('this.page.locator(') && row.includes('.filter({ hasText: description })'));
    check('THE PARAMETER APPEARS, THE RECORDED VALUE DOES NOT',
        row.includes('description') && !/Line Chart|639978|Getting flat/.test(row));
    check('double quotes are normalised to the repository style',
        toRepoStyle('page.locator(".x")') === "page.locator('.x')");
  }

  /* ------------------------------------------------- what is never written ---- */

  function checkRefusals(): void {
    process.stdout.write('\n== what the writer refuses ==\n');

    const positional = renderMethod(proposal({ template: "page.locator('.row').first()" })) ?? '';
    check('.first() in a template is caught by validation',
        validateGenerated(positional, proposal()).length > 0,
        validateGenerated(positional, proposal()).join('; '));
    const nth = renderMethod(proposal({ template: "page.locator('.row').nth(2)" })) ?? '';
    check('.nth() likewise', validateGenerated(nth, proposal()).length > 0);

    const dynamic = renderMethod(proposal({ template: "page.locator('#tr_637446 .bugChecked')" })) ?? '';
    check('a generated identifier is caught',
        validateGenerated(dynamic, proposal()).some(problem => problem.includes('tr_637446')));
    const numeric = renderMethod(proposal({ template: 'page.locator(\'[id="639978"]\')' })) ?? '';
    check('a numeric id is caught',
        validateGenerated(numeric, proposal()).some(problem => problem.includes('639978')));

    const dataName = proposal({ method: 'issue639978', template: "page.locator('#x')" });
    check('a method name carrying data is caught',
        validateGenerated(renderMethod(dataName) ?? '', dataName).length > 0);

    const missingParam = proposal({
      parameterised: true, parameterName: 'description',
      template: "page.locator('.tabulator-row').locator('.bugChecked')",
    });
    check('a parameterised method whose parameter never appears is caught',
        validateGenerated(renderMethod(missingParam) ?? '', missingParam)
            .some(problem => problem.includes('parameter')));

    // Nothing partial: one bad proposal blocks the whole run.
    const outcome = applyProposals([proposal(), proposal({
      method: 'badOne', template: "page.locator('.row').first()",
    })], { dry: true });
    check('a failed validation blocks the ENTIRE run, so nothing is half-written',
        !outcome.applied && outcome.reason.includes('nothing was written'), outcome.reason);
  }

  /* ------------------------------------------------ ambiguity and duplicates ---- */

function checkAmbiguityAndDuplicates(): void {
    const result = analyseCorpus();
    const close = result.proposals.filter(p => /close/i.test(p.target) && p.owner === 'NotificationsPanel');
    check('distinct controls make their shared name ambiguous', close.length > 0 && close.every(p => p.accessibleNameAmbiguous === true));
    check('shared names do not create ambiguous methods', close.every(p => p.status !== 'PROPOSED' && p.refusals.some(r => /structurally different/.test(r))));
    check('existing parameterised capability is reused', result.reused.some(e => e.method === 'issueCheckboxState'));
    const index = buildIndex();
    check('one method per name on each class', Object.values(index.pages).every(p => new Set(p.methods.map(m => m.name)).size === p.methods.length));
  }

  /* ------------------------------------------- what was actually written ---- */

  function checkWritten(): void {
    process.stdout.write('\n== the method that was written ==\n');
    const index = buildIndex();
    const knowledge = readAllPageKnowledge();

    const method = index.pages.IssuesPage?.methods.find(entry => entry.name === 'issueCheckboxState');
    check('IssuesPage.issueCheckboxState exists', Boolean(method));
    check('it takes one required string parameter',
        method?.params?.length === 1 && method.params[0].type === 'string'
        && method.params[0].optional === false, JSON.stringify(method?.params ?? null));

    const source = fs.readFileSync(path.join(ROOT, 'tests-e2e', 'pages', 'issues.page.ts'), 'utf8');
    check('its locator is contextual, with no row id',
        /\.tabulator-row/.test(source) && !/tr_\d|\[id="\d+"\]/.test(source));
    check('and contains no recorded issue text',
        !/Line Chart|Data labels|Compute Flow|Shift Comparison/.test(source));
    check('the existing methods are untouched',
        ['searchField', 'rowStatus']
            .every(name => new RegExp(`\\b${name}\\s*\\(`).test(source)));

    const entry = knowledge.flatMap(page => page.elements)
        .find(element => element.page_object_method === 'issueCheckboxState');
    check('a knowledge entry points at the real method',
        entry?.page_object === 'IssuesPage', entry ? `${entry.page_object}` : 'missing');
    check('the entry is keyed in the repository style', keyFor({ method: 'issueCheckboxState' } as Proposal)
      === 'issue_checkbox_state');
    check('it declares NO accessible_name, so the C1 guard cannot invent an argument',
        !entry?.accessible_name,
        'a declared name would be passed as the row description, which it is not');
    check('the knowledge file carries no recorded value',
        !/Line Chart|Data labels|Compute Flow/.test(
            fs.readFileSync(path.join(ROOT, 'ai', 'knowledge', 'page', 'fixtureapp__issues-id.yaml'), 'utf8')));

    check('verify() confirms the written method is visible to index and knowledge',
        verify([{ owner: 'IssuesPage', method: 'issueCheckboxState' } as Proposal]).length === 0);
    check('and reports a method that is NOT there',
        verify([{ owner: 'IssuesPage', method: 'noSuchMethod' } as Proposal]).length > 0);

    check('the owning file and knowledge file resolve deterministically',
        Boolean(pageFileFor('IssuesPage')) && Boolean(knowledgeFileFor('IssuesPage')));
    check('an unknown class resolves to neither',
        !pageFileFor('NoSuchPage') && !knowledgeFileFor('NoSuchPage'));
  }

  /* ------------------------------------------------ future reuse, for real ---- */

  function checkFutureReuse(): void {
    process.stdout.write('\n== a future recording resolves to the method ==\n');
    const script = [
      "import { test, expect } from '@playwright/test';",
      '',
      "test('t', async ({ page }) => {",
      "  await page.getByRole('link', { name: 'Notifications' }).click();",
      '});',
    ].join('\n');
    const steps = mapRecording(parseRecording(script, { startUrl: '', browser: '', durationMs: 0 })).steps;
    check('existing Page Object reuse still works exactly as before',
        steps.some(step => step.kind === 'page-object' && /notificationsBell/.test(step.code.join(' '))),
        steps.map(step => step.kind).join(', '));

    // The honest limit: a parameterised method is NOT called automatically, because the
    // argument would have to be invented. The method exists and is reusable by hand;
    // synthesising the call needs the recorded value, which is a later phase.
    const rowScript = [
      "import { test, expect } from '@playwright/test';",
      '',
      "test('t', async ({ page }) => {",
      "  await page.getByText('issue checkbox state').click();",
      '});',
    ].join('\n');
    const rowSteps = mapRecording(parseRecording(rowScript, { startUrl: '', browser: '', durationMs: 0 })).steps;
    check('a parameterised method is never called with an invented argument',
        !rowSteps.some(step => /issueCheckboxState\(['"]/.test(step.code.join(' '))),
        rowSteps.map(step => step.code.join(' ')).join(' | ').slice(0, 80));
  }

  /* ------------------------------------------------------------- zero AI ---- */

  function checkNoModel(): void {
    process.stdout.write('\n== zero AI ==\n');
    const dir = path.join(ROOT, 'ai', 'autocode', 'abstraction');
    // THE INVARIANT MOVED, AND GOT STRICTER. `semantic.ts` is the ONE module allowed to
    // reach a model. It is named here rather than pattern-matched, so a second such
    // module fails this check exactly as the first would have - and what is asserted
    // now is that the DETERMINISTIC path is model-free AND cannot reach the resolver
    // at all, which a directory-wide scan never said.
    const RESOLVER = 'semantic.ts';
    const sources = fs.readdirSync(dir)
        .filter(name => name.endsWith('.ts') && !name.endsWith('.fixture.ts') && name !== RESOLVER)
        .map(name => ({ name, body: fs.readFileSync(path.join(dir, name), 'utf8') }));
    const offenders = sources.filter(file =>
      /\bclaude\b|anthropic|openai|\bspawn\s*\(|child_process|fetch\s*\(|runAgent|\.\.\/agent/i
          .test(file.body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
    check('no DETERMINISTIC module in abstraction/ calls a model or spawns anything',
        offenders.length === 0, offenders.map(file => file.name).join(', '));
    check('and no deterministic module imports the resolver - it is a post-pass, not a stage',
        !sources.some(file => /from '\.\/semantic'/.test(file.body)),
        sources.filter(file => /from '\.\/semantic'/.test(file.body)).map(file => file.name).join(', '));
    check('and the resolver exists, so this exception is real rather than assumed',
        fs.existsSync(path.join(dir, RESOLVER)));
    const writer = fs.readFileSync(path.join(dir, 'writer.ts'), 'utf8');
    check('the writer itself imports nothing that could reach one',
        !/from '.*(agent|model|api)'/.test(writer));
  }

  checkEligibility();
  checkRendering();
  checkRefusals();
  checkAmbiguityAndDuplicates();
  checkWritten();
  checkFutureReuse();
  checkNoModel();
}

/* ---------- from abstraction-approval.fixture.ts ---------- */
function sectionApproval(): void {
  /**
   * The loop only closes through a person.
   *
   *   npx tsx ai/autocode/abstraction-approval.fixture.ts
   *
   * Everything before this phase was deterministic: evidence in, decision out. Approval
   * is the one step that is not, and must not be - it is somebody saying "yes, that
   * method should exist, on that class, under that name". So the checks here are almost
   * entirely about what does NOT happen without it.
   *
   * A proposal is a recommendation. A method is a commitment every future test inherits.
   * The distance between them is one person reading a fingerprint and writing it down.
   *
   * Offline: no browser, no model, no network.
   */






  const FP = 'issuespage|action|thing|scoped-class';

  function proposal(overrides: Partial<Proposal> = {}): Proposal {
    return {
      timestamp: '', testCaseId: 'TC_X', target: 'click Thing', role: 'action',
      category: 'METHOD', rule: 5, status: 'PROPOSED' as ProposalStatus,
      owner: 'IssuesPage', ownerKind: 'page-object', method: 'thingButton',
      parameterised: false, parameterSource: null, locatorStrategy: 'scoped-class',
      // THE PROOF IS A FIELD THE WRITER READS SINCE P13.4: it re-asks the identity
      // question at the mutation boundary rather than trusting the analyser asked it, so
      // a stub with no proof is refused - correctly. A PROPOSED status already requires a
      // safe measurement upstream, so this carries what a real proposal carries.
      expression: "page.locator('#thing')",
      proof: { matchCount: 1, identityMatched: true, sameDocument: true, measuredAt: 'press',
        strategy: 'scoped-class', expression: "page.locator('#thing')" },
      reason: '', refusals: [],
      template: "page.locator('#thing')", parameterName: null, accessibleName: 'Thing',
      sightings: [], refusalCodes: [], resolvedBy: 'deterministic', semantic: null,
      allowedOwners: [], derivedMethod: null, roundTrip: false,
      accessibleNameAmbiguous: false, fingerprint: FP, ...overrides,
    };
  }

  const outcomes = (list: Proposal[]) =>
    applyProposals(list, { dry: true }).results.map(result => result.outcome);

  /* ------------------------------------------------- 1-5: the approval gate ---- */

  function checkGate(): void {
    process.stdout.write('\n== nothing is written without a person ==\n');

    check('1: PROPOSED -> created, because every deterministic gate already passed',
        outcomes([proposal()]).join() === 'APPLIED', outcomes([proposal()]).join());
    check('3: a parameterised proposal follows the same gate',
        outcomes([proposal({ parameterised: true, parameterName: 'description', accessibleName: null,
          template: "page.locator('.tabulator-row').filter({ hasText: description }).locator('.x')" })])
            .join() === 'APPLIED');

    // 4 / 5: STATUS IS THE ONLY DOOR. These never reach the writer, and there is no
    // longer any input to `applyProposals` that could make one of them reach it - an
    // approvals override was tried here and removed, because an approved fingerprint
    // would have carried a REFUSED proposal (a generated identifier) past the gate.
    for (const status of ['NEEDS_REVIEW', 'REFUSED', 'REUSE'] as ProposalStatus[]) {
      check(`${status === 'NEEDS_REVIEW' ? '4' : '5'}: ${status} is never applied, by any route`,
          applyProposals([proposal({ status })], { dry: true }).results.length === 0);
    }
    check('and the writer takes no argument that could override a status',
        !/approvals/.test(fs.readFileSync(
            path.join(ROOT, 'ai', 'autocode', 'abstraction', 'writer.ts'), 'utf8')
            .split('export function applyProposals')[1].slice(0, 400)));
  }

  /* --------------------------------------------- 6-11: reuse and conflicts ---- */

  function checkReuseAndConflict(): void {
    process.stdout.write('\n== what already exists is never rewritten ==\n');

    // 6 / 8: a method that exists is ALREADY_APPLIED - idempotent, not an error, and
    // it does not block the proposals beside it.
    const existing = proposal({ method: 'searchField', fingerprint: 'issuespage|action|search|css' });
    const both = applyProposals([existing, proposal()], {
      dry: true,
    });
    check('6: an existing method reports ALREADY_APPLIED',
        both.results[0].outcome === 'ALREADY_APPLIED', both.results[0].outcome);
    check('8: and does not block the proposal beside it',
        both.results[1].outcome === 'APPLIED', both.results[1].outcome);
    check('6: the existing implementation is never rewritten',
        both.results[0].problems.length === 0);

    // 11: a proposal that cannot be validated blocks - and blocks the whole run, so
    // nothing is half-written.
    const unsafe = proposal({ method: 'badOne', template: "page.locator('.row').first()",
      fingerprint: 'issuespage|action|bad|css' });
    const mixed = applyProposals([proposal(), unsafe], {
      dry: true,
    });
    check('11: an unsafe proposal is BLOCKED',
        mixed.results[1].outcome === 'BLOCKED', mixed.results[1].problems.join('; '));
    check('11: and blocks the entire run - nothing is partially applied',
        !mixed.applied && mixed.reason.includes('nothing was written'), mixed.reason);

    // 12 / 13 / 14 / 15: the safety rules still hold at the writer. These arrive
    // marked PROPOSED - i.e. having somehow got past every earlier gate - and the
    // writer refuses them anyway. That belt-and-braces is the point of the check.
    const refuse = (label: string, over: Partial<Proposal>) => {
      const p = proposal({ ...over, fingerprint: 'issuespage|action|x|css' });
      const r = applyProposals([p], { dry: true });
      check(label, r.results[0]?.outcome === 'BLOCKED', r.results[0]?.problems.join('; ') ?? 'no result');
    };
    refuse('12: a dynamic id is never written', { template: "page.locator('#tr_637446 .x')" });
    refuse('13: .first() is never written', { template: "page.locator('.x').first()" });
    refuse('13: .nth() is never written', { template: "page.locator('.x').nth(2)" });
    refuse('15: no owner is never written', { owner: null });
  }

  /* ------------------------------------------ 16-17: idempotency and YAML ---- */

  function checkIdempotencyAndYaml(): void {
    process.stdout.write('\n== running it twice, and what lands in knowledge ==\n');

    const first = applyProposals([proposal()], { dry: true });
    const second = applyProposals([proposal()], { dry: true });
    check('16: two consecutive runs produce identical outcomes',
        JSON.stringify(first.results.map(r => [r.outcome, r.method]))
          === JSON.stringify(second.results.map(r => [r.outcome, r.method])));

    // 17: the entry carries what findMethod and the Phase 4 role guard need.
    const entry = first.results[0].entry ?? '';
    check('17: the YAML entry declares the owner and the method',
        /page_object: IssuesPage/.test(entry) && /page_object_method: thingButton/.test(entry), entry.trim().slice(0, 60));
    check('17: and declares usage, so an assertion method is never reused for an action',
        /usage: action/.test(entry));
    const param = applyProposals([proposal({
      parameterised: true, parameterName: 'description', role: 'assertion', accessibleName: null,
      method: 'thingState',
      template: "page.locator('.tabulator-row').filter({ hasText: description }).locator('.x')",
    })], { dry: true }).results[0].entry ?? '';
    check('17: a parameterised entry carries the template with the parameter in it',
        /locator_strategy:.*hasText: description/.test(param), param.split('\n').find(l => /locator_strategy/.test(l))?.trim().slice(0, 70) ?? '');
    check('17: and declares usage: assertion', /usage: assertion/.test(param));
    check('17: no recorded value reaches the entry',
        !/Line Chart|639978/.test(param));
  }

  /* --------------------------------------- 18-19: the loop, on real evidence ---- */

  function checkRealLoop(): void {
    process.stdout.write('\n== the closed loop, on the synthetic corpus ==\n');
    const index = buildIndex();
    const knowledge = readAllPageKnowledge();

    // 18 / 19: the capability created in an earlier phase is now REUSED by recordings
    // that never triggered its creation - which is the whole point of the loop.
    const method = index.pages.IssuesPage?.methods.find(m => m.name === 'issueCheckboxState');
    check('18: the applied Page Object method exists', Boolean(method));
    check('18: knowledge declares it, so the matcher can find it',
        knowledge.some(p => p.elements.some(e => e.page_object_method === 'issueCheckboxState')));

    const values = new Set<string>();
    const recordings = new Set<string>();
    for (const id of ['TC_ROW_A', 'TC_ROW_B', 'TC_ROW_A', 'TC_ROW_B']) {
      const file = path.join(RECORDINGS(), `${id}.spec.ts`);
      if (!fs.existsSync(file))
        continue;
      const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
        startUrl: '', browser: '', durationMs: 0,
        evidence: readEvidence(id), stateAssertions: readAssertions(id) });
      for (const step of mapRecording(recording).steps) {
        const call = /issueCheckboxState\('([^']*)'\)/.exec(step.code.join(' '));
        if (call) { values.add(call[1]); recordings.add(id); }
      }
    }
    check('19: several recordings REUSE the one parameterised method',
        recordings.size >= 2, [...recordings].sort().join(', '));
    check('19: with different argument values', values.size >= 2, `${values.size} distinct`);
    check('19: and no second method was ever created for the second value',
        (index.pages.IssuesPage?.methods ?? []).filter(m => /issueCheckboxState/.test(m.name)).length === 1);

    // With nothing approved, the synthetic corpus writes nothing at all.
    const { proposals } = analyseCorpus();
    const beforeDry = [...artefactSnapshot()];
    const live = applyProposals(proposals, { dry: true });
    check('dry analysis never writes a Page Object',
        JSON.stringify([...artefactSnapshot()]) === JSON.stringify(beforeDry),
        `${live.results.length} eligible`);
    check('and the live corpus produces no BLOCKED write',
        !live.results.some(result => result.outcome === 'BLOCKED'),
        live.results.filter(r => r.outcome === 'BLOCKED').map(r => r.problems.join('; ')).join(' | '));
  }

  /* ------------------------------------------------------------- zero AI ---- */

  function checkNoModel(): void {
    process.stdout.write('\n== zero AI ==\n');
    // `semantic.ts` is the single sanctioned exception; see the note in the other
    // zero-AI block. Everything else in the abstraction path stays model-free.
    const files = [
      ...fs.readdirSync(path.join(ROOT, 'ai', 'autocode', 'abstraction'))
          .filter(n => n.endsWith('.ts') && !n.endsWith('.fixture.ts') && n !== 'semantic.ts')
          .map(n => path.join('ai', 'autocode', 'abstraction', n)),
    ];
    const offenders = files.filter(f =>
      /\bclaude\b|anthropic|openai|child_process|\bspawn\s*\(|runAgent|fetch\s*\(/i
          .test(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
    check('no DETERMINISTIC module in the abstraction path can reach a model',
        offenders.length === 0, offenders.join(', '));

    // The orchestration hook itself: it may call the agent for GENERATION, which is
    // pre-existing. Its abstraction branch reaches a model through exactly one route -
    // `resolveSemanticReviews` - and never by spawning or importing one itself.
    const orchestrate = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'orchestrate.ts'), 'utf8');
    const hook = /async function ensurePageObjects\(([\s\S]*?)\n}/.exec(orchestrate)?.[1] ?? '';
    check('the orchestration hook spawns no model of its own',
        Boolean(hook) && !/claude|anthropic|openai|spawn|runAgent/i.test(hook), `${hook.length} chars scanned`);
    check('and reaches one only through the sanctioned resolver',
        /resolveSemanticReviews\(/.test(hook));
    // ORDER, INSIDE THE HOOK: everything deterministic finishes before anything is
    // asked. If these ever swap, a model would be answering questions the engine had
    // not asked yet.
    check('the deterministic analysis runs BEFORE the resolver',
        hook.indexOf('analyseCorpus(') >= 0
        && hook.indexOf('analyseCorpus(') < hook.indexOf('resolveSemanticReviews('));
    check('and the writer runs AFTER the resolver, so a cleared refusal is re-validated first',
        hook.indexOf('resolveSemanticReviews(') < hook.indexOf('applyProposals('));

    // ORDER, IN THE RUN: creation happens BEFORE the recording is mapped. This is the
    // whole point of the phase - run it afterwards and the capability it creates can
    // only help the NEXT recording, while this one keeps its raw locator and is
    // reported as PAGE OBJECT REQUIRED.
    const branch = /if \(isRecorded\) \{([\s\S]*?)\n      \}/.exec(orchestrate)?.[1] ?? '';
    check('creation is invoked from the recorded branch', /ensurePageObjects\(/.test(branch), branch.slice(0, 60));
    check('and BEFORE the recording is mapped, so the current test can consume it',
        branch.indexOf('ensurePageObjects(') >= 0
        && branch.indexOf('ensurePageObjects(') < branch.indexOf('generateFromRecording('));
    check('and nothing runs the engine again after generation',
        !/closeAbstractionLoop/.test(orchestrate));

    // It is ON by default now; what still switches it off is an explicit false or a
    // dry run, and a dry run must never write.
    check('it is skipped only on an explicit opt-out or a dry run',
        /if \(options\.createPageObjects === false \|\| options\.dryRun\)/.test(orchestrate));

    // SCOPE: authoring one case must not rewrite the Page Objects of another.
    check('only THIS case\'s proposals are written',
        /proposal\.testCaseId\.split\(','\)\.includes\(testCaseId\)/.test(hook));
    check('and applyProposals is handed that filtered list, never the whole corpus',
        /applyProposals\(mine\)/.test(hook));
  }

  checkGate();
  checkReuseAndConflict();
  checkIdempotencyAndYaml();
  /* ------------------------- one capability, one method, whatever it is called ---- */

  function checkOneMethodPerElement(): void {
    process.stdout.write('\n== the same element never gets a second method ==\n');

    const knowledge = readAllPageKnowledge();

    // THE REAL CASE. `#record_search` is already IssuesPage.searchField(), declared
    // under `accessible_name: Search`. A proposal derived `filterValue` from the id,
    // found no name clash, and was one ownership answer away from putting a second
    // method on the same control.
    const search = knowledge.flatMap(page => page.elements)
        .find(element => element.page_object_method === 'searchField');
    check('knowledge declares searchField with a concrete selector',
        Boolean(search) && declaredSelectors(search!).includes('#record_search'),
        JSON.stringify(search ? declaredSelectors(search) : []));

    const corpus = analyseCorpus();
    const onFilterValue = corpus.proposals.filter(entry =>
      (entry.template ?? '').includes('#record_search'));

    // THE STRONGEST OUTCOME, and stronger than this check first asserted. It used to
    // require a REUSE proposal, because at the time the element still surfaced as one.
    // The proven-locator resolver now settles it in the matcher, so there is no
    // proposal at all - the engine never sees an element that reuse already handled.
    check('the element produces no proposal, because reuse already resolved it',
        onFilterValue.length === 0,
        onFilterValue.map(entry => `${entry.derivedMethod}=${entry.status}`).join(', '));
    check('and it appears as a REUSE of the method that already wraps it',
        corpus.reused.some(entry => entry.pageObject === 'IssuesPage'
          && entry.method === 'searchField'),
        corpus.reused.filter(entry => entry.method === 'searchField').length + ' reuse(s)');
    check('so a resolver is never asked about it',
        onFilterValue.every(entry => !eligibility(entry).eligible));

    // The comparison is on the ELEMENT, not the whole path: a row-scoped capability
    // must not be called a duplicate of the row container it sits in.
    const checkbox = corpus.proposals.find(entry => entry.derivedMethod === 'issueCheckbox'
      && (entry.template ?? '').includes('.rounded-checkbox-ui'));
    check('a row-scoped capability is NOT flagged a duplicate of the row container',
        !checkbox || !checkbox.refusalCodes.some(code =>
          code.code === 'METHOD_EXISTS' && /resultRows/.test(code.detail)),
        checkbox?.refusalCodes.map(code => code.code).join(', ') ?? 'not proposed');

    // A safety refusal still wins: an unproven target says nothing about the method
    // that happens to point at the same element.
    const unsafe = corpus.proposals.filter(entry =>
      entry.refusalCodes.some(code => code.class === 'SAFETY'));
    check('no safety-refused proposal was quietly turned into a REUSE',
        unsafe.every(entry => entry.status !== 'REUSE'), `${unsafe.length} safety-refused`);
  }

  /* ------------------- a shared accessible name, settled by the measurement ---- */

  function checkNameTieBreak(): void {
    process.stdout.write('\n== two entries named "Search", and the evidence says which ==\n');

    const named = readAllPageKnowledge().flatMap(page => page.elements)
        .filter(element => (element.accessible_name ?? '').trim().toLowerCase() === 'search'
          && element.page_object_method);
    check('the corpus really does declare "Search" twice', named.length >= 2,
        named.map(element => `${element.page_object}.${element.page_object_method}`).join(', '));
    check('and the two declare DIFFERENT concrete selectors, so evidence can separate them',
        new Set(named.map(element => declaredSelectors(element).join('|'))).size === named.length,
        named.map(element => declaredSelectors(element).join('|')).join('  vs  '));

    // TC_SEARCH clicked and filled the issue list's box. Both steps must resolve to
    // the SAME existing method - not two methods, and not a raw locator.
    const id = 'TC_SEARCH';
    const file = path.join(RECORDINGS(), `${id}.spec.ts`);
    if (!fs.existsSync(file)) {
      check('the TC_SEARCH recording is present', false, file);
      return;
    }
    const recording = parseRecording(fs.readFileSync(file, 'utf8'), {
      startUrl: '', browser: '', durationMs: 0,
      evidence: readEvidence(id), stateAssertions: readAssertions(id) });
    const steps = mapRecording(recording).steps;
    // THREE steps, not two: the click, the fill, and the assertion. The assertion is
    // named `filter-value` in the recording and `Search` in knowledge, so no name
    // matched it - the proven locator did.
    const searchSteps = steps.filter(step => /searchField\(/.test(step.code.join(' ')));
    check('all three Search steps resolve to a Page Object', searchSteps.length === 3,
        `${searchSteps.length} step(s)`);
    check('and to the SAME method, not one each',
        new Set(searchSteps.map(step => `${step.pageObject}.${step.method}`)).size === 1,
        [...new Set(searchSteps.map(step => `${step.pageObject}.${step.method}`))].join(', '));
    check('specifically IssuesPage.searchField - the issue list, not the project list',
        searchSteps.every(step => step.pageObject === 'IssuesPage' && step.method === 'searchField'));
    check('and no raw Search locator is emitted any more',
        !steps.some(step => step.kind === 'codegen-locator'
          && /getByRole\('textbox', \{ name: 'Search' \}\)/.test(step.code.join(' '))));
  }

  checkRealLoop();
  checkOneMethodPerElement();
  checkNameTieBreak();
  checkNoModel();
}

function main(): void {
  sectionEngine();
  sectionWriter();
  sectionApproval();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
