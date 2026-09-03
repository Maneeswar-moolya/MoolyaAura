/**
 * Intelligent column mapping.
 *
 * Teams do not share one rigid template - the same column shows up as
 * "Test Case ID", "TC ID", "Testcase#" or "ID". This module maps whatever
 * headings a workbook actually uses onto the canonical field names, and
 * explains every decision so a human can audit the interpretation.
 */

import { CANONICAL_FIELDS, type CanonicalField, type ColumnBinding } from './types';

/**
 * Known headings per canonical field. Order matters only for readability;
 * matching is exact-first, then fuzzy.
 */
const SYNONYMS: Record<CanonicalField, string[]> = {
  testCaseId: [
    'test case id', 'testcase id', 'test case', 'tc id', 'tcid', 'tc no', 'tc number', 'tc#',
    'case id', 'test id', 'testcase#', 'test case no', 'test case number', 'id', 'tc',
  ],
  module: ['module', 'module name', 'application module', 'app module', 'component', 'area', 'product area'],
  feature: ['feature', 'feature name', 'functionality', 'sub module', 'submodule', 'sub-module', 'epic'],
  scenario: [
    'scenario', 'test scenario', 'test case name', 'test name', 'title', 'test title',
    'summary', 'test case title', 'name', 'use case',
  ],
  description: [
    'description', 'test case description', 'test description', 'objective', 'test objective',
    'details', 'purpose', 'test case summary',
  ],
  preconditions: [
    'precondition', 'preconditions', 'pre condition', 'pre conditions', 'pre-requisite',
    'prerequisite', 'prerequisites', 'pre requisites', 'setup', 'given',
  ],
  steps: [
    'steps', 'test steps', 'step', 'steps to execute', 'steps to reproduce', 'execution steps',
    'test procedure', 'procedure', 'actions', 'action steps', 'how to test',
  ],
  testData: ['test data', 'testdata', 'data', 'input data', 'inputs', 'input', 'test input', 'parameters'],
  expectedResult: [
    'expected result', 'expected results', 'expected', 'expected outcome', 'expected behavior',
    'expected behaviour', 'expected output', 'acceptance criteria', 'then',
  ],
  // `criticality` moved to businessRisk (P1). It never meant priority: priority
  // says when a test runs, criticality says what breaking it costs, and a
  // workbook that carries both would otherwise have them collapse into one.
  priority: ['priority', 'test priority', 'prio', 'p', 'importance'],
  // `test type` / `type` moved to testType (P1), for the same reason: a
  // controlled kind-of-test is not a free-text label.
  tags: ['tags', 'tag', 'labels', 'label', 'category', 'categories'],
  automationStatus: [
    'automation status', 'automated', 'automation', 'is automated', 'automation state',
    'automatable', 'automation flag',
  ],
  automationNotes: [
    'automation notes', 'automation note', 'automation comments', 'notes', 'note', 'comments',
    'comment', 'remarks', 'remark',
  ],
  execute: [
    'run', 'execute', 'run test', 'run?', 'execute?', 'run flag', 'include', 'selected',
    'to run', 'run this', 'in scope', 'pick',
  ],
  // Deliberately NOT "expected outcome" / "expected error": those read as prose
  // headings and are already claimed by expectedResult. The "assert" prefix
  // marks a column the runner parses rather than a human reads, which is
  // exactly the distinction that matters here.
  expectedOutcome: [
    'assert outcome', 'assertion', 'assert', 'automation outcome', 'expected state',
    'outcome', 'assert result',
  ],
  expectedMessage: [
    'assert message', 'expected message', 'expected error', 'error message',
    'assert text', 'assert error', 'expected error message',
  ],
  requirementId: [
    'requirement id', 'requirement', 'requirements', 'story', 'story id', 'user story',
    'jira', 'jira id', 'jira key', 'ticket', 'ticket id', 'issue key', 'req id', 'req',
    'traceability', 'linked requirement',
  ],
  testType: ['test type', 'type', 'test category', 'kind', 'test kind', 'testing type'],
  businessRisk: [
    'business risk', 'risk', 'criticality', 'business criticality', 'severity',
    'risk level', 'business impact', 'impact',
  ],
  environment: ['environment', 'env', 'test environment', 'target environment', 'stage'],
  userRole: ['user role', 'role', 'persona', 'user persona', 'actor', 'as a'],
  authenticationProfile: [
    'auth profile', 'authentication profile', 'credential profile', 'login profile',
    'account profile', 'auth', 'authentication', 'account',
  ],
  testOwner: ['test owner', 'owner', 'author', 'created by', 'assigned to', 'responsible'],
};

/**
 * Headings that used to bind somewhere else, and where they went.
 *
 * `Type` was a Tags synonym and `Criticality` a Priority one until P1 gave both
 * a column of their own. A workbook written before that will have its heading
 * rebound - correctly, but not silently: the parser reports it so the author can
 * see that "Criticality" is now Business Risk rather than Priority.
 */
export const REBOUND_HEADINGS: Record<string, { from: CanonicalField; to: CanonicalField }> = {
  'test type': { from: 'tags', to: 'testType' },
  type: { from: 'tags', to: 'testType' },
  criticality: { from: 'priority', to: 'businessRisk' },
};

/** Headings that look like test-case columns but are deliberately ignored. */
const IGNORED = new Set(['sr no', 'sl no', 's no', 'serial no', 'sno', 'index', '#']);

/** `"  Test Case  ID "` -> `"test case id"`. */
export function normalizeHeader(header: string): string {
  return String(header ?? '')
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}# ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const EXACT_LOOKUP: Map<string, CanonicalField> = (() => {
  const map = new Map<string, CanonicalField>();
  for (const field of CANONICAL_FIELDS) {
    for (const synonym of SYNONYMS[field]) {
      const key = normalizeHeader(synonym);
      // First field to claim a synonym wins, so `CANONICAL_FIELDS` order breaks ties.
      if (!map.has(key))
        map.set(key, field);
    }
  }
  return map;
})();

function tokens(value: string): string[] {
  return normalizeHeader(value).split(' ').filter(Boolean);
}

/** Jaccard overlap of the two token sets, 0..1. */
function similarity(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (!left.size || !right.size)
    return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token))
      shared++;
  }
  return shared / (left.size + right.size - shared);
}

interface Candidate {
  field: CanonicalField;
  confidence: number;
  reason: string;
}

function bestCandidate(header: string): Candidate | null {
  const normalized = normalizeHeader(header);
  if (!normalized || IGNORED.has(normalized))
    return null;

  const exact = EXACT_LOOKUP.get(normalized);
  if (exact)
    return { field: exact, confidence: 1, reason: `exact match on "${normalized}"` };

  let best: Candidate | null = null;
  for (const field of CANONICAL_FIELDS) {
    for (const synonym of SYNONYMS[field]) {
      const score = similarity(normalized, synonym);
      // Substring hits ("expected result (ui)" vs "expected result") score highly
      // even when the extra words drag the Jaccard overlap down.
      const contains = normalized.includes(normalizeHeader(synonym)) && tokens(synonym).length > 1;
      const confidence = contains ? Math.max(score, 0.9) : score;
      if (confidence > (best?.confidence ?? 0))
        best = { field, confidence, reason: `fuzzy match on "${synonym}" (${confidence.toFixed(2)})` };
    }
  }

  // Below this the guess is worse than admitting we do not know.
  return best && best.confidence >= 0.5 ? best : null;
}

/**
 * Map a row of headings onto canonical fields.
 *
 * A field is claimed by at most one column: if two headings compete, the
 * higher-confidence one wins and the loser is reported as unmapped rather
 * than silently overwriting real data.
 */
export function mapColumns(headers: string[]): ColumnBinding[] {
  const candidates = headers.map((header, index) => ({
    header: String(header ?? '').trim(),
    column: index + 1,
    candidate: bestCandidate(String(header ?? '')),
  }));

  const claimed = new Map<CanonicalField, number>();
  for (const entry of candidates) {
    if (!entry.candidate)
      continue;
    const field = entry.candidate.field;
    const holder = claimed.get(field);
    if (holder === undefined) {
      claimed.set(field, entry.column);
      continue;
    }
    const incumbent = candidates[holder - 1];
    if (entry.candidate.confidence > (incumbent.candidate?.confidence ?? 0)) {
      incumbent.candidate = null;
      claimed.set(field, entry.column);
    } else {
      entry.candidate = null;
    }
  }

  return candidates.map(entry => ({
    header: entry.header,
    column: entry.column,
    field: entry.candidate?.field ?? null,
    confidence: entry.candidate?.confidence ?? 0,
    reason: entry.candidate?.reason ?? (entry.header ? 'no confident match - kept as extra column' : 'blank heading'),
  }));
}

/**
 * How strongly a heading row looks like a test-case table header.
 * Used to locate the header row when a sheet has a title/banner above it.
 */
export function headerRowScore(headers: string[]): number {
  const bindings = mapColumns(headers);
  const mapped = bindings.filter(binding => binding.field);
  const fields = new Set(mapped.map(binding => binding.field));
  // An identifying column plus something describing the work is the minimum
  // signature of a real test-case table.
  const hasIdentity = fields.has('testCaseId') || fields.has('scenario') || fields.has('description');
  const hasSubstance = fields.has('steps') || fields.has('expectedResult') || fields.has('module');
  if (!hasIdentity || !hasSubstance || fields.size < 3)
    return 0;
  return mapped.reduce((total, binding) => total + binding.confidence, 0);
}

export const __testing = { SYNONYMS, similarity, bestCandidate };
