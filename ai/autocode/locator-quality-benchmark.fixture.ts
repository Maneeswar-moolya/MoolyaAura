import '../testing/isolated-checkout';
/**
 * Synthetic locator quality benchmark: proof admission, score ordering and Page Object
 * reuse. No installed application corpus is read. Every pair of candidate families
 * competes on the existing scorer; equal scores acquire no new tie-break rule.
 * Run: npx tsx ai/autocode/locator-quality-benchmark.fixture.ts
 * Mutations: npx tsx ai/autocode/locator-quality-benchmark.mutations.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { isProvenAgainstClickedTarget, type CandidateMeasurement, type TargetEvidence } from './dom-evidence';
import { scoreExpression } from './locator-quality';
import { provenCandidate, rankProvenCandidates } from './abstraction/classify';

const ROOT = process.cwd();

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};
const section = (title: string) => process.stdout.write(`\n== ${title} ==\n`);

/* ------------------------------------------------------------------- corpus */

/* ================================ A - the selection is never worse than proven */

function assessSelection(target: TargetEvidence) {
  // Action admission is the existing press-time identity predicate. Rank only those
  // measurements; a high score never supplies missing proof. Keep this oracle
  // independent of rankProvenCandidates' order so a reversed sort cannot pass itself.
  const proven = (target.derivedCandidates ?? []).filter(isProvenAgainstClickedTarget);
  const selected = provenCandidate(target, 'action');
  const selectedIsProven = Boolean(selected && isProvenAgainstClickedTarget(selected)
      && proven.some(candidate => candidate.expression === selected.expression));
  const weakest = (candidate: CandidateMeasurement) => scoreExpression(candidate.expression)?.weakest ?? -1;
  const stronger = selected ? proven.filter(candidate => weakest(candidate) > weakest(selected)) : [];
  return { proven, selected, selectedIsProven, stronger };
}

function checkSelection(): void {
  section('A - candidate families compete under the current score contract');
  const expressions = [
    'page.getByRole("button", { name: "Save", exact: true })',
    'page.getByLabel("Save")', 'page.getByTestId("save")',
    'page.getByPlaceholder("Save")', 'page.locator("#save_button")',
    'page.locator(".save-button")',
    'page.locator("#editor").getByRole("button", { name: "Save", exact: true })',
  ];
  let targets = 0, invalidSelections = 0, outranked = 0;
  let idPresentAndSelected = 0, idPresentNotSelected = 0;
  for (const left of expressions) for (const right of expressions) {
    const target = { derivedCandidates: [proven(left, 'recorded-locator'), proven(right, 'recorded-locator')] } as TargetEvidence;
    const result = assessSelection(target);
    targets++;
    if (!result.selectedIsProven) invalidSelections++;
    if (result.stronger.length) outranked++;
    if ([left, right].some(expression => expression === 'page.locator("#save_button")')) {
      if (result.selected?.expression === 'page.locator("#save_button")') idPresentAndSelected++;
      else idPresentNotSelected++;
    }
  }
  check('A: every ordered candidate-family pair is exercised', targets === expressions.length ** 2, `${targets} synthetic targets`);
  check('A: every selected locator is one the recording PROVED', invalidSelections === 0, `${invalidSelections} outside the proven set`);
  check('A: no strictly higher-scoring proven candidate is ignored', outranked === 0, `${outranked} outranked selections`);
  process.stdout.write(`INFO  A: authored ID present: ${idPresentAndSelected} selected, ${idPresentNotSelected} not selected\n`);
}

/* ====================== B - reuse is never prevented by a raw candidate */

function checkReuseInvariant(): void {
  section('B - a higher-ranked raw candidate never prevents Page Object reuse');
  const { findMethodByProvenLocator } = require('./from-recording') as typeof import('./from-recording');
  const { readAllPageKnowledge } = require('../knowledge/page-knowledge') as typeof import('../knowledge/page-knowledge');
  const { buildIndex } = require('../knowledge/index') as typeof import('../knowledge/index');
  const knowledge = readAllPageKnowledge();
  const index = buildIndex();
  const cases = [
    ['page.locator("#cancel_editor")', 'ProjectsPage.cancelButton'],
    ['page.locator("#section_heading")', 'WorkspacePage.sectionHeader'],
    ['page.locator("#notification_panel")', 'NotificationsPanel.panel'],
  ];
  for (const [expression, expected] of cases) {
    const target = { derivedCandidates: [
      proven(expression, 'stable-id'),
      proven('page.getByRole("button", { name: "Synthetic top candidate", exact: true })', 'role-name'),
    ] } as TargetEvidence;
    check(`B: raw winner differs from ${expected}`, rankProvenCandidates(target)[0]?.expression !== expression);
    const match = findMethodByProvenLocator(target, knowledge, index, 'action');
    check(`B: all proven candidates are searched to reuse ${expected}`, `${match?.pageObject}.${match?.method}` === expected);
  }
}

/* ================= C - the one measured hazard: a state-dependent name */

/** A proven press-time measurement. */
const proven = (expression: string, strategy: string): CandidateMeasurement => ({
  strategy, expression, matchCount: 1, identityMatched: true,
  sameDocument: true, measuredAt: 'press',
});

function checkStateDependentName(): void {
  section('C - a state-dependent accessible name outranks the authored id');

  // A synthetic accessible name contains validation text. Its high press-time score
  // is not a claim about durability; the separate durability fixture tests transitions.
  const evidence = {
    locator: 'page.getByRole("textbox")', target: { tag: 'input', id: 'password_field' },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1,
    derivedCandidates: [
      proven('page.locator("#password_field")', 'stable-id'),
      proven('page.getByRole("textbox", { name: "Password validation warning", exact: true })', 'role-name'),
    ],
  } as unknown as TargetEvidence;

  const selected = provenCandidate(evidence, 'action');
  check('C: production selects the accessible name over the authored id',
      String(selected?.expression).includes('getByRole'), String(selected?.expression).slice(0, 70));
  check('C: because the model scores role+name above stable-id',
      (scoreExpression('page.getByRole("textbox", { name: "x", exact: true })')?.weakest ?? 0)
      > (scoreExpression('page.locator("#password_field")')?.weakest ?? 0),
      `95 vs 70`);

  // THE MITIGATION, and the reason this is a hazard rather than a shipped defect: a
  // locator that matches nothing on a clean page fails the clean run, and the
  // falsification gate keeps only a spec that passes clean AND fails mutated. The bad
  // locator costs a generation; it does not reach the suite.
  const verify = fs.readFileSync(path.join(ROOT, 'ai', 'autocode', 'verify.ts'), 'utf8');
  check('C: the gate requires the clean run to PASS, so a 0-match locator is refused',
      /clean/i.test(verify) && /mutat/i.test(verify));


}

/* ------------------------------------------------------------------- main */

function checkSyntheticSelection(): void {
  section('D - score ordering and proof, without application artifacts');
  const id = proven('page.locator("#account_email")', 'stable-id');
  const semantic = proven('page.getByRole("textbox", { name: "Email", exact: true })', 'role-name');
  const evidence = (derivedCandidates: CandidateMeasurement[]) => ({
    locator: id.expression, target: { tag: 'input', id: 'account_email' },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1, derivedCandidates,
  } as unknown as TargetEvidence);

  check('D: the semantic candidate scores strictly above the authored ID',
      scoreExpression(semantic.expression)!.weakest > scoreExpression(id.expression)!.weakest);
  for (const candidates of [[id, semantic], [semantic, id]]) {
    const result = assessSelection(evidence(candidates));
    check('D: selected candidate is proven', result.selectedIsProven);
    check('D: no strictly higher-scoring proven candidate is ignored',
        result.stronger.length === 0, result.selected?.expression);
  }

  // Each inadmissible semantic candidate would win on score if proof were skipped.
  const invalid: Array<[string, Partial<CandidateMeasurement>]> = [
    ['no match', { matchCount: 0 }],
    ['ambiguous', { matchCount: 2 }],
    ['wrong target', { identityMatched: false }],
    ['other document', { sameDocument: false }],
    ['assertion pick, not an action press', { measuredAt: 'pick' }],
    ['unknown identity', { identityMatched: undefined }],
  ];
  for (const [reason, measurement] of invalid) {
    const candidate = { ...semantic, ...measurement };
    const result = assessSelection(evidence([candidate, id]));
    check(`D: inadmissible candidate is refused (${reason})`,
        result.selectedIsProven && result.selected?.expression === id.expression
        && result.stronger.length === 0);
    check(`D: no proven candidate means no selection (${reason})`,
        assessSelection(evidence([candidate])).selected === null);
  }
}

function main(): void {
  if (!process.argv.includes('--synthetic-only')) {
    checkSelection();
    checkReuseInvariant();
    checkStateDependentName();
  }
  checkSyntheticSelection();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

main();
