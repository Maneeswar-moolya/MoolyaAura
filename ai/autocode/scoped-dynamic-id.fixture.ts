/**
 * P0.5 - a generated id in the SCOPE is still a generated id.
 *
 *   npx tsx ai/autocode/scoped-dynamic-id.fixture.ts
 *   npx tsx ai/autocode/scoped-dynamic-id.fixture.ts --mutate    (proves the checks bite)
 *
 * Offline: no browser, no model, no network. Drives the real `assessLocator` and reads
 * the real TC_LOGIN_060 artifacts.
 *
 * WHY THIS EXISTS
 *
 * TC_LOGIN_060 recorded two steps against the same table row in the same run:
 *
 *   assert  page.locator('#tc_summary_638717')
 *   click   page.locator('#tc_summary_638717').getByText('Line Chart | Time Config Page')
 *
 * Both had live evidence. Both had a candidate the browser had measured at exactly one
 * element. The assertion was promoted; the click was refused with "nothing in this
 * recording proves a replacement would match exactly one element" - while the proof sat
 * in the same sidecar, one entry below.
 *
 * The cause was that promotion was gated on `evidence.identifier`, which describes the
 * GRAPHED NODE. Recorded on its own, the id is the node's; used as a scope, the graphed
 * node is a descendant - an unclassed <span> with no id - so the field is null and the
 * measured candidate was computed and thrown away.
 *
 * P0.5 looks for the generated id in the recorded chain as well. What may replace it is
 * unchanged: a candidate measured at exactly one element, and nothing else.
 */

import fs from 'node:fs';
import path from 'node:path';

import { evidenceFor, type TargetEvidence } from './dom-evidence';
import { assessLocator } from './locator-quality';
import { parseRecording } from '../dashboard/recorder';

const ROOT = process.cwd();
const SIDECAR = path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_060.evidence.json');
const SPEC = path.resolve(ROOT, 'ai/dashboard/recordings/TC_LOGIN_060.spec.ts');
const MUTATE = process.argv.includes('--mutate');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok)
    failures++;
};

type Assess = typeof assessLocator;
let assess: Assess = assessLocator;

/* ------------------------------------------------------------------ fixtures */

const CANDIDATE = (matchCount: number, expression =
  'page.locator("#report-table .summary--text").getByText("Line Chart")') =>
  ({ strategy: 'scoped-parent-class-text', expression, matchCount });

/** Evidence for a graphed node, with whatever candidates the browser counted. */
function evidence(options: {
  targetId?: string;
  matchCount?: number;
  candidates?: Array<{ strategy: string; expression: string; matchCount: number }>;
  identifier?: TargetEvidence['identifier'];
  text?: string;
}): TargetEvidence {
  return {
    locator: 'page.locator(\'#cell_638717\')',
    target: { tag: options.targetId ? 'div' : 'span', id: options.targetId, text: options.text ?? 'Line Chart is blank' },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: options.matchCount ?? 1,
    ...(options.identifier ? { identifier: options.identifier } : {}),
    derivedCandidates: options.candidates ?? [],
  } as TargetEvidence;
}

const DYNAMIC_ID = { raw: 'cell_638717', dynamic: true, normalised: 'cell_<dynamic>' };

/* -------------------------------------------------------------------- checks */

function checkCore(): void {
  process.stdout.write('\n== 1 — the dynamic id is the TARGET\'s own, unique candidate → promote ==\n');
  const own = assess({
    locator: "page.locator('#cell_638717')", target: 'summary cell', kind: 'action',
    evidence: evidence({ targetId: 'cell_638717', identifier: DYNAMIC_ID, candidates: [CANDIDATE(1)] }),
  });
  check('1: NORMALIZED_LOCATOR', own.outcome === 'NORMALIZED_LOCATOR', own.outcome);
  check('1: the measured candidate is the expression', own.expression === CANDIDATE(1).expression);
  check('1: the generated id is nowhere in it', !String(own.expression).includes('cell_638717'));

  process.stdout.write('\n== 2 — the dynamic id is the SCOPE, target has no id → promote (the P0.5 fix) ==\n');
  const scoped = assess({
    locator: "page.locator('#cell_638717').getByText('Line Chart')", target: 'summary text', kind: 'action',
    evidence: evidence({ candidates: [CANDIDATE(1)] }),
  });
  check('2: NORMALIZED_LOCATOR', scoped.outcome === 'NORMALIZED_LOCATOR', scoped.outcome);
  check('2: the measured candidate is the expression', scoped.expression === CANDIDATE(1).expression);
  check('2: the generated id is nowhere in it', !String(scoped.expression).includes('cell_638717'));
  check('2: the id is still REPORTED as the reason it was replaced',
      scoped.dynamic?.value === 'cell_638717' && scoped.dynamic?.normalised === 'cell_<dynamic>',
      JSON.stringify(scoped.dynamic));
  check('2: with the real signals, not "captured" — nothing captured this one',
      Array.isArray(scoped.dynamic?.signals) && !scoped.dynamic!.signals.includes('captured'),
      JSON.stringify(scoped.dynamic?.signals));

  process.stdout.write('\n== 3/4/5 — a scoped dynamic id with nothing measured-unique → NEEDS_REVIEW ==\n');
  const refuse = (label: string, candidates: Array<{ strategy: string; expression: string; matchCount: number }>) => {
    const a = assess({
      locator: "page.locator('#cell_638717').getByText('Line Chart')", target: 'summary text', kind: 'action',
      evidence: evidence({ candidates }),
    });
    check(`  ${label} → NEEDS_REVIEW`, a.outcome === 'NEEDS_REVIEW', a.outcome);
    check(`  ${label} → emits nothing`, a.expression === null, String(a.expression));
  };
  refuse('3: no candidates at all', []);
  refuse('4: candidate measured 0', [CANDIDATE(0)]);
  refuse('5: candidate measured 2', [CANDIDATE(2)]);
  refuse('   candidate not measured (null)', [{ ...CANDIDATE(1), matchCount: null as any }]);
}

function checkFaclon(): void {
  process.stdout.write('\n== 6 — recorded locator matched 2: still NEEDS_REVIEW even with unique candidates ==\n');
  // The capture binds with `.first()` when the recorded locator is ambiguous, so the
  // graph describes the first match in DOM order - which the recording does NOT prove
  // is the element the person clicked. A unique candidate derived from that graph could
  // silently select a node nobody chose. This is the Faclon labs case.
  const ambiguous = assess({
    locator: "page.getByText('Faclon labs')", target: 'Faclon labs', kind: 'action',
    evidence: evidence({
      matchCount: 2,
      candidates: [CANDIDATE(1, 'page.locator("#sideNavBarId .handel-over-flow")'), CANDIDATE(1)],
    }),
  });
  check('6: NEEDS_REVIEW despite 2 measured-unique candidates',
      ambiguous.outcome === 'NEEDS_REVIEW', ambiguous.outcome);
  check('6: strategy says why', ambiguous.strategy === 'measured-ambiguous', String(ambiguous.strategy));
  check('6: nothing is emitted', ambiguous.expression === null);
  check('6: no first()/nth() anywhere in the verdict',
      !/\.(first|nth)\(/.test(JSON.stringify(ambiguous)));

  // And the ambiguity rule must still win when a dynamic id is ALSO present - P0.5 must
  // not have moved the dynamic branch ahead of it.
  const both = assess({
    locator: "page.locator('#cell_638717').getByText('Line Chart')", target: 'x', kind: 'action',
    evidence: evidence({ matchCount: 2, candidates: [CANDIDATE(1)] }),
  });
  check('6: measured ambiguity still outranks the dynamic-id branch',
      both.outcome === 'NEEDS_REVIEW' && both.strategy === 'measured-ambiguous',
      `${both.outcome}/${both.strategy}`);
}

function checkUnchanged(): void {
  process.stdout.write('\n== 7/8/9 — everything else behaves as before ==\n');
  const stable = assess({
    locator: "page.locator('#loginForm').getByRole('button', { name: 'Sign In' })",
    target: 'Sign In', kind: 'action',
    evidence: evidence({ candidates: [] }),
  });
  check('7: a stable locator with no generated id is not touched by the evidence path',
      stable.outcome !== 'NEEDS_REVIEW' || stable.strategy !== 'normalized-dynamic-id',
      `${stable.outcome}/${stable.strategy}`);
  check('7: and it is not reported as dynamic', !stable.dynamic, JSON.stringify(stable.dynamic));

  const pageObject = assess({
    locator: "page.locator('#cell_638717').getByText('Line Chart')", target: 'summary', kind: 'action',
    pageObject: { pageObject: 'IssuesPage', method: 'summaryFor' },
    evidence: evidence({ candidates: [CANDIDATE(1)] }),
  });
  check('8: a Page Object still wins before any evidence resolution',
      pageObject.outcome === 'REUSE_PAGE_OBJECT', pageObject.outcome);
  check('8: and the evidence candidate is not emitted instead',
      pageObject.expression === null || !String(pageObject.expression).includes('summary--text'));

  const assertion = assess({
    locator: "page.locator('#cell_638717')", target: 'summary cell', kind: 'assertion',
    value: 'Line Chart is blank',
    evidence: evidence({ targetId: 'cell_638717', identifier: DYNAMIC_ID, candidates: [CANDIDATE(1)] }),
  });
  check('9: the assertion path still resolves from measured evidence',
      assertion.outcome === 'NORMALIZED_LOCATOR', assertion.outcome);
  check('9: to the counted candidate', assertion.expression === CANDIDATE(1).expression);
}

function checkEveryVerb(): void {
  process.stdout.write('\n== 10 — every action verb consumes the same resolved expression ==\n');
  // The resolver is verb-blind by construction: `kind` is 'action' for all of them and
  // nothing below branches on the verb. This asserts that rather than assuming it, and
  // mirrors the receiver that `callFor` wraps for each verb in from-recording.ts.
  const verbs = ['click', 'dblclick', 'fill', 'press', 'check', 'uncheck', 'select', 'hover'];
  const expected = CANDIDATE(1).expression;
  for (const verb of verbs) {
    const a = assess({
      locator: "page.locator('#cell_638717').getByText('Line Chart')",
      target: `${verb} target`, kind: 'action',
      evidence: evidence({ candidates: [CANDIDATE(1)] }),
    });
    check(`  ${verb.padEnd(9)} → ${a.outcome}`,
        a.outcome === 'NORMALIZED_LOCATOR' && a.expression === expected
        && !String(a.expression).includes('cell_638717'));
  }
}

function checkRealArtifact(): void {
  process.stdout.write('\n== TC_LOGIN_060 — the real recording and its sidecar ==\n');
  if (!fs.existsSync(SIDECAR) || !fs.existsSync(SPEC)) {
    check('the TC_LOGIN_060 artifacts are present', false);
    return;
  }
  const ev = JSON.parse(fs.readFileSync(SIDECAR, 'utf8'));
  const recording = parseRecording(fs.readFileSync(SPEC, 'utf8'), { startUrl: '', browser: '', durationMs: 0 });

  const click = recording.actions.find((a: any) =>
    typeof a.locator === 'string' && a.locator.includes('tc_summary_638717'));
  check('the summary click is in the recording', Boolean(click), click?.locator);
  if (click) {
    const entry = evidenceFor(ev, click.locator)!;
    const a = assess({ locator: click.locator, target: 'summary text', kind: 'action', evidence: entry });
    check('CLICK → NORMALIZED_LOCATOR', a.outcome === 'NORMALIZED_LOCATOR', a.outcome);
    check('CLICK → the measured-unique candidate',
        a.expression === 'page.locator("#bugReport-table .bug-report__summary--text.hidden-xs")'
          + '.getByText("Line Chart | Time Config Page")', String(a.expression));
    check('CLICK → no tc_summary_* id in the emitted locator',
        !/tc_summary_\d/.test(String(a.expression)));
    check('CLICK → the candidate it chose was measured at exactly 1',
        (entry.derivedCandidates ?? []).some(c => c.expression === a.expression && c.matchCount === 1));
  }

  const faclon = recording.actions.find((a: any) =>
    typeof a.locator === 'string' && a.locator.includes('Faclon labs'));
  if (faclon) {
    const entry = evidenceFor(ev, faclon.locator)!;
    const a = assess({ locator: faclon.locator, target: 'Faclon labs', kind: 'action', evidence: entry });
    check('FACLON → still NEEDS_REVIEW (deliberate, unchanged)',
        a.outcome === 'NEEDS_REVIEW', a.outcome);
    check('FACLON → because the recorded locator measured 2',
        entry.matchCount === 2 && a.strategy === 'measured-ambiguous',
        `matchCount=${entry.matchCount} strategy=${a.strategy}`);
    check('FACLON → its unique candidates are NOT promoted',
        a.expression === null && (entry.derivedCandidates ?? []).some(c => c.matchCount === 1));
  }

  const assertion = recording.assertions.find((a: any) =>
    typeof a.locator === 'string' && a.locator.includes('tc_summary_638717'));
  if (assertion) {
    const entry = evidenceFor(ev, assertion.locator)!;
    const a = assess({
      locator: assertion.locator, target: 'summary cell', kind: 'assertion',
      value: assertion.value, evidence: entry,
    });
    check('ASSERT → NORMALIZED_LOCATOR, unchanged', a.outcome === 'NORMALIZED_LOCATOR', a.outcome);
    check('ASSERT → resolved to a candidate measured at 1',
        (entry.derivedCandidates ?? []).some(c => c.expression === a.expression && c.matchCount === 1));
  }
}

/**
 * Pre-action capture is NOT fixed in P0.5 - this only makes its absence visible.
 *
 * `beforeActionCount === 0` means every graph in the recording was taken AFTER the
 * action, against a page that had already moved on. It is also why Faclon labs cannot
 * be resolved: pre-action evidence is what would prove which of two matching elements
 * the person actually clicked. Reported, never asserted as a failure - the recordings
 * on disk legitimately have this shape today.
 */
function reportPreActionCapture(): void {
  process.stdout.write('\n== pre-action capture — DIAGNOSTIC ONLY, not a P0.5 defect ==\n');
  const dir = path.resolve(ROOT, 'ai/dashboard/recordings');
  const sidecars = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(name => name.endsWith('.evidence.json')).sort()
    : [];
  if (!sidecars.length) {
    process.stdout.write('  (no sidecars on disk)\n');
    return;
  }
  let zero = 0;
  for (const name of sidecars) {
    let record: any;
    try {
      record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      process.stdout.write(`  ${name.padEnd(34)} unreadable\n`);
      continue;
    }
    const telemetry = record.recording ?? {};
    const before = telemetry.beforeActionCount ?? 0;
    const after = telemetry.afterActionCount ?? 0;
    if (before === 0)
      zero++;
    process.stdout.write(`  ${name.padEnd(34)} before-action=${before}  after-action=${after}`
      + `${before === 0 ? '   <-- no pre-action evidence' : ''}\n`);
  }
  process.stdout.write(`  ${zero}/${sidecars.length} recording(s) captured NO pre-action evidence.\n`);
  if (zero)
    process.stdout.write('  Tracked separately: it is the mechanism that would resolve an ambiguous click.\n');
}

/* ------------------------------------------------------------------ mutation */

async function runMutation(): Promise<void> {
  const file = path.resolve(ROOT, 'ai/autocode/locator-quality.ts');
  const mutant = path.resolve(ROOT, 'ai/autocode/locator-quality.mutant.ts');
  const source = fs.readFileSync(file, 'utf8');
  // Revert to the pre-P0.5 gate: the node's own captured identifier only.
  const marker = '  const identifier = dynamicIdentifierFor(input.locator, evidence.identifier);\n  if (identifier) {';
  const hits = source.split(marker).length - 1;
  if (hits !== 1) {
    process.stdout.write(`FAIL  mutation marker matched ${hits} times, expected exactly 1\n`);
    process.exit(1);
  }
  const reverted = '  const identifier = evidence.identifier?.dynamic\n'
    + '    ? { raw: evidence.identifier.raw, normalised: evidence.identifier.normalised, signals: [\'captured\'] }\n'
    + '    : null;\n  if (identifier) {';
  fs.writeFileSync(mutant, source.split(marker).join(reverted), 'utf8');
  let expected = false;
  try {
    const loaded = await import('./locator-quality.mutant');
    assess = loaded.assessLocator as Assess;
    process.stdout.write('\n### MUTANT: the gate is back to the node\'s own id. Scoped cases MUST fail.\n');
    runChecks();
    expected = failures > 0;
    process.stdout.write(`\n${expected
      ? `MUTATION: PASS — the mutant failed ${failures} check(s), so the fixture bites`
      : 'MUTATION: FAIL — the mutant passed everything; the fixture proves nothing'}\n`);
  } finally {
    // Before the exit, never after it - `process.exit` inside the try would skip this.
    fs.rmSync(mutant, { force: true });
  }
  process.exit(expected ? 0 : 1);
}

function runChecks(): void {
  checkCore();
  checkFaclon();
  checkUnchanged();
  checkEveryVerb();
  checkRealArtifact();
}

async function main(): Promise<void> {
  if (MUTATE) {
    await runMutation();
    return;
  }
  runChecks();
  reportPreActionCapture();
  process.stdout.write(`\n${failures ? `${failures} CHECK(S) FAILED` : 'all checks passed'}\n`);
  process.exit(failures ? 1 : 0);
}

void main();
