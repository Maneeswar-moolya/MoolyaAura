/**
 * Test case quality analysis.
 *
 * These are the deterministic checks - missing fields, duplicates, vague
 * wording, absent negative or boundary coverage. They run without a model and
 * give the same answer every time. Judgement calls that genuinely need
 * reasoning (is this step ambiguous *in context*?) are left to the agent
 * workflow in .claude/skills/excel-automation.md, which reads this report first.
 */

import { normalizeOutcome, parseInputs } from './data-driven';
import { contractGap } from './intent';
import type { ParseResult, TestCase } from './types';

export type FindingSeverity = 'error' | 'warning' | 'info';

export interface Finding {
  code: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  testCaseIds: string[];
  location: string;
  recommendation: string;
}

/** Wording that leaves an automation engineer guessing. */
const VAGUE_PHRASES = [
  'etc', 'and so on', 'as required', 'as needed', 'appropriate', 'properly', 'correctly',
  'works fine', 'works as expected', 'should work', 'valid data', 'some data', 'test data',
  'necessary details', 'relevant details', 'suitable', 'if required', 'and more', 'various',
];

/** Verbs that make an expected result actually checkable. */
const ASSERTION_VERBS = [
  'display', 'shown', 'show', 'appear', 'visible', 'redirect', 'navigate', 'contain', 'equal',
  'match', 'receive', 'created', 'saved', 'updated', 'deleted', 'listed', 'enabled', 'disabled',
  'error', 'message', 'success', 'load', 'present', 'return', 'land',
];

const NEGATIVE_MARKERS = [
  'invalid', 'incorrect', 'wrong', 'blank', 'empty', 'missing', 'unauthori', 'forbidden',
  'expired', 'duplicate', 'negative', 'failure', 'fail ', 'without', 'no password', 'locked',
];

const BOUNDARY_MARKERS = [
  'boundary', 'max', 'maximum', 'min', 'minimum', 'limit', 'length', 'character', 'special char',
  'edge', '255', '256', '0 ', 'zero', 'upper bound', 'lower bound', 'overflow',
];

const DATA_ENTRY_VERBS = /\b(enter|input|type|fill|provide|select|upload|choose|set)\b/i;

function haystack(testCase: TestCase): string {
  return [
    testCase.scenario, testCase.description, testCase.steps.join(' '),
    testCase.expectedResult, testCase.testData, testCase.tags.join(' '),
  ].join(' ').toLowerCase();
}

function locate(testCase: TestCase): string {
  return `${testCase.source.workbook}!${testCase.source.worksheet} row ${testCase.source.row}`;
}

function tokenSet(value: string): Set<string> {
  return new Set(
      value.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(token => token.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size)
    return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token))
      shared++;
  }
  return shared / (a.size + b.size - shared);
}

/** Similarity above which two rows are treated as the same test case. */
const DUPLICATE_THRESHOLD = 0.85;

export function analyzeQuality(parsed: ParseResult): Finding[] {
  const findings: Finding[] = [];
  const testCases = parsed.testCases;

  const push = (
    code: string,
    severity: FindingSeverity,
    title: string,
    detail: string,
    testCase: TestCase | null,
    recommendation: string,
    ids?: string[],
  ) => {
    findings.push({
      code, severity, title, detail, recommendation,
      testCaseIds: ids ?? (testCase ? [testCase.testCaseId] : []),
      location: testCase ? locate(testCase) : parsed.workbook,
    });
  };

  for (const testCase of testCases) {
    if (!testCase.expectedResult.trim()) {
      push('MISSING_EXPECTED_RESULT', 'error', 'No expected result',
          'The row states what to do but never what should happen, so no assertion can be derived.',
          testCase, 'Add a checkable expected result before automating. Until then the case stays "Needs Review".');
    } else if (!ASSERTION_VERBS.some(verb => testCase.expectedResult.toLowerCase().includes(verb))) {
      push('WEAK_ASSERTION', 'warning', 'Expected result is not checkable',
          `Expected result "${testCase.expectedResult.slice(0, 80)}" contains no observable outcome.`,
          testCase, 'Rewrite as an observable fact, e.g. "Dashboard header is visible" rather than "login works".');
    }

    // A data-driven row whose outcome cannot witness its own expected result.
    // The worst finding in this report: unlike everything else here, the row
    // runs, passes, and is counted as coverage of something it never checked.
    const declared = testCase.expectedOutcome.trim();
    if (declared) {
      const outcome = normalizeOutcome(declared);
      const inputs = parseInputs(testCase.testData);
      const gap = outcome && !('error' in inputs)
        ? contractGap({
          scenario: testCase.scenario,
          expectedResult: testCase.expectedResult,
          outcome,
          inputNames: Object.keys(inputs),
          steps: testCase.steps,
          submit: inputs.submit?.value,
        })
        : null;
      if (gap) {
        push('CONTRACT_PROVES_NOTHING', 'error', 'Contract cannot prove the expected result',
            gap.message, testCase,
            gap.clearOutcome
              ? 'Clear Assert Outcome. The case keeps its steps and Test Data, and a spec that ' +
                'performs them gets written for it.'
              : gap.repair
                ? `Set Assert Outcome = ${gap.repair.outcome}` +
                  (gap.repair.expect ? ` and add "expect = ${gap.repair.expect}" to Test Data.` : '.')
                : 'Name what must be on the page and use Assert Outcome = Visible, or give this ' +
                  'case a written spec.');
      }
    }

    if (!testCase.steps.length) {
      push('MISSING_STEPS', 'error', 'No test steps',
          'There are no steps to translate into browser actions.',
          testCase, 'Add ordered steps. One action per step keeps the generated test readable.');
    } else if (testCase.steps.length === 1 && testCase.steps[0].split(/\s+/).length > 12) {
      push('UNSPLIT_STEPS', 'info', 'All steps in one sentence',
          `Single step: "${testCase.steps[0].slice(0, 90)}"`,
          testCase, 'Split into discrete actions separated by newlines or arrows so each maps to one page action.');
    }

    const needsData = testCase.steps.some(step => DATA_ENTRY_VERBS.test(step));
    if (needsData && !testCase.testData.trim()) {
      push('MISSING_TEST_DATA', 'warning', 'Data entry without test data',
          'Steps ask the tester to enter values but the Test Data column is empty.',
          testCase, 'Name the data set (e.g. "standard_user / valid password") or point at a fixture.');
    }

    const vague = VAGUE_PHRASES.filter(phrase => haystack(testCase).includes(phrase));
    if (vague.length) {
      push('AMBIGUOUS_WORDING', 'warning', 'Ambiguous wording',
          `Vague phrases: ${vague.map(phrase => `"${phrase.trim()}"`).join(', ')}`,
          testCase, 'Replace with concrete values and observable outcomes. Flag as "Needs Review" rather than guessing.');
    }

    if (testCase.issues.some(item => item.code === 'DUPLICATE_TEST_CASE_ID')) {
      push('DUPLICATE_ID', 'error', 'Reused Test Case ID',
          'Two rows share one ID, so traceability and the execution report cannot distinguish them.',
          testCase, 'Give each row a unique ID before generating automation.');
    }
  }

  // Near-duplicate detection across rows with different IDs.
  const signatures = testCases.map(testCase => ({
    testCase,
    tokens: tokenSet(`${testCase.scenario} ${testCase.steps.join(' ')} ${testCase.expectedResult}`),
  }));
  const reported = new Set<string>();
  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) {
      const score = jaccard(signatures[i].tokens, signatures[j].tokens);
      if (score < DUPLICATE_THRESHOLD)
        continue;
      const left = signatures[i].testCase;
      const right = signatures[j].testCase;
      const key = [left.testCaseId, right.testCaseId].sort().join('|');
      if (reported.has(key))
        continue;
      reported.add(key);
      push('DUPLICATE_TEST_CASE', 'warning', 'Probable duplicate test case',
          `${left.testCaseId} and ${right.testCaseId} are ${(score * 100).toFixed(0)}% similar (${locate(right)}).`,
          left, 'Confirm with the author, then keep one and retire the other to avoid duplicated automation.',
          [left.testCaseId, right.testCaseId]);
    }
  }

  // Coverage gaps, assessed per module.
  const modules = new Map<string, TestCase[]>();
  for (const testCase of testCases) {
    const key = testCase.module || '(no module)';
    modules.set(key, [...(modules.get(key) ?? []), testCase]);
  }
  for (const [module, cases] of modules) {
    const text = cases.map(haystack).join(' ');
    if (!NEGATIVE_MARKERS.some(marker => text.includes(marker))) {
      findings.push({
        code: 'MISSING_NEGATIVE_COVERAGE', severity: 'warning',
        title: `No negative scenarios for "${module}"`,
        detail: `All ${cases.length} case(s) in this module describe the happy path.`,
        testCaseIds: cases.map(testCase => testCase.testCaseId),
        location: `${parsed.workbook} - module ${module}`,
        recommendation: 'Add invalid-input, empty-field and unauthorised-access cases before signing the module off.',
      });
    }
    if (!BOUNDARY_MARKERS.some(marker => text.includes(marker))) {
      findings.push({
        code: 'MISSING_BOUNDARY_COVERAGE', severity: 'info',
        title: `No boundary scenarios for "${module}"`,
        detail: 'Nothing in this module exercises field limits, lengths or special characters.',
        testCaseIds: cases.map(testCase => testCase.testCaseId),
        location: `${parsed.workbook} - module ${module}`,
        recommendation: 'Add min/max length and special-character cases for each input the module accepts.',
      });
    }
  }

  for (const malformed of parsed.malformed) {
    findings.push({
      code: malformed.code, severity: 'error', title: 'Malformed row',
      detail: malformed.message,
      testCaseIds: [],
      location: `${parsed.workbook}!${malformed.worksheet} row ${malformed.row}`,
      recommendation: 'Fix the row in the source workbook; it is skipped entirely until it has a Test Case ID.',
    });
  }

  const order: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
}

/** Cases that should not be automated as written. */
export function needsReview(parsed: ParseResult, findings: Finding[]): Map<string, string[]> {
  const blocking = new Set(['MISSING_EXPECTED_RESULT', 'MISSING_STEPS', 'AMBIGUOUS_WORDING', 'DUPLICATE_ID']);
  const result = new Map<string, string[]>();
  for (const finding of findings) {
    if (!blocking.has(finding.code))
      continue;
    for (const id of finding.testCaseIds)
      result.set(id, [...(result.get(id) ?? []), finding.title]);
  }
  return result;
}

export function renderQualityReport(parsed: ParseResult, findings: Finding[], generatedAt: string): string {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of findings)
    counts[finding.severity]++;

  const review = needsReview(parsed, findings);
  const lines: string[] = [];

  lines.push('# Test Case Quality Report');
  lines.push('');
  lines.push(`- **Workbook:** \`${parsed.workbook}\``);
  lines.push(`- **Generated:** ${generatedAt}`);
  lines.push(`- **Test cases parsed:** ${parsed.testCases.length}`);
  lines.push(`- **Malformed rows skipped:** ${parsed.malformed.length}`);
  lines.push(`- **Findings:** ${counts.error} error, ${counts.warning} warning, ${counts.info} info`);
  lines.push('');

  lines.push('## Worksheets');
  lines.push('');
  lines.push('| Worksheet | Recognised | Header row | Test cases | Malformed |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const sheet of parsed.worksheets) {
    lines.push(`| ${sheet.worksheet} | ${sheet.recognized ? 'yes' : `no - ${sheet.skipReason}`} | ` +
      `${sheet.headerRow ?? '-'} | ${sheet.testCasesParsed} | ${sheet.malformedRows} |`);
  }
  lines.push('');

  const recognized = parsed.worksheets.filter(sheet => sheet.recognized);
  if (recognized.length) {
    lines.push('## Column interpretation');
    lines.push('');
    lines.push('How each heading in the workbook was understood. Review this first - a mis-mapped column');
    lines.push('silently changes what gets automated.');
    lines.push('');
    for (const sheet of recognized) {
      lines.push(`### ${sheet.worksheet}`);
      lines.push('');
      lines.push('| Column | Heading | Mapped to | Confidence | Basis |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const binding of sheet.bindings.filter(item => item.header)) {
        lines.push(`| ${binding.column} | ${binding.header} | ${binding.field ?? '_(unmapped)_'} | ` +
          `${binding.confidence ? binding.confidence.toFixed(2) : '-'} | ${binding.reason} |`);
      }
      lines.push('');
    }
  }

  lines.push('## Findings');
  lines.push('');
  if (!findings.length) {
    lines.push('No issues found. Every parsed test case has an ID, steps and a checkable expected result.');
    lines.push('');
  } else {
    for (const severity of ['error', 'warning', 'info'] as FindingSeverity[]) {
      const group = findings.filter(finding => finding.severity === severity);
      if (!group.length)
        continue;
      const heading = { error: 'Errors - block automation', warning: 'Warnings - automate with care', info: 'Suggestions' };
      lines.push(`### ${heading[severity]} (${group.length})`);
      lines.push('');
      for (const finding of group) {
        const ids = finding.testCaseIds.length ? finding.testCaseIds.slice(0, 8).join(', ') : '-';
        lines.push(`#### ${finding.title}`);
        lines.push('');
        lines.push(`- **Code:** \`${finding.code}\``);
        lines.push(`- **Test cases:** ${ids}${finding.testCaseIds.length > 8 ? ` (+${finding.testCaseIds.length - 8} more)` : ''}`);
        lines.push(`- **Where:** ${finding.location}`);
        lines.push(`- **Detail:** ${finding.detail}`);
        lines.push(`- **Recommendation:** ${finding.recommendation}`);
        lines.push('');
      }
    }
  }

  lines.push('## Recommended "Needs Review"');
  lines.push('');
  if (!review.size) {
    lines.push('None. Every parsed test case is unambiguous enough to automate as written.');
  } else {
    lines.push('These cases must not be automated by guessing at the missing intent. Mark them');
    lines.push('`Needs Review` and return them to the author.');
    lines.push('');
    lines.push('| Test Case ID | Reasons |');
    lines.push('| --- | --- |');
    for (const [id, reasons] of [...review].sort())
      lines.push(`| ${id} | ${[...new Set(reasons)].join('; ')} |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('_The source workbook was opened read-only and has not been modified._');
  lines.push('');

  return lines.join('\n');
}
