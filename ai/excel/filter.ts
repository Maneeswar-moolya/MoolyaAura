/**
 * Selecting a working set of test cases.
 *
 * Every filter is case-insensitive and accepts repeated flags or a
 * comma-separated list, so `--priority P0,P1` and `--priority P0 --priority P1`
 * behave identically.
 */

import { normalizeAutomationStatus, normalizePriority } from './parser';
import type { TestCase, TestCaseFilter } from './types';

/** Boolean tag expressions extend the existing case-insensitive tag filter. No eval. */
export function matchesTagExpression(expression: string, values: string[]): boolean {
  if (!expression.trim()) return true;
  const tokens = expression.match(/@[a-z0-9_-]+|\b(?:and|or|not)\b|[()]/gi) ?? [];
  if (tokens.join('').toLowerCase() !== expression.replace(/\s+/g, '').toLowerCase()) throw Error('Invalid tag expression. Use @tag, and, or, not and parentheses.');
  let index = 0;
  const known = new Set(values.map(v => v.replace(/^@/, '').toLowerCase()));
  const primary = (): boolean => {
    const token = tokens[index++]?.toLowerCase();
    if (token === 'not') return !primary();
    if (token === '(') { const result = or(); if (tokens[index++] !== ')') throw Error('Unclosed tag expression.'); return result; }
    if (!token?.startsWith('@')) throw Error('Expected a tag.');
    return known.has(token.slice(1));
  };
  const and = (): boolean => { let result=primary(); while(tokens[index]?.toLowerCase()==='and'){index++;const next=primary();result=result&&next;}return result; };
  const or = (): boolean => { let result=and(); while(tokens[index]?.toLowerCase()==='or'){index++;const next=and();result=result||next;}return result; };
  const result=or();if(index!==tokens.length)throw Error('Unexpected token in tag expression.');return result;
}

export function toList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined)
    return undefined;
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap(entry => entry.split(','))
    .map(entry => entry.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function matches(candidates: string[] | undefined, ...values: string[]): boolean {
  if (!candidates?.length)
    return true;
  const haystack = values.filter(Boolean).map(value => value.toLowerCase());
  return candidates.some(candidate => haystack.includes(candidate.toLowerCase()));
}

export function applyFilter(testCases: TestCase[], filter: TestCaseFilter): TestCase[] {
  // Priority and automation status are normalized on both sides so that
  // `--priority critical` still selects rows stored as `P0`.
  const priorities = filter.priority?.map(value => normalizePriority(value) || value.toUpperCase());
  const statuses = filter.automationStatus?.map(value => normalizeAutomationStatus(value));

  return testCases.filter(testCase => {
    if (!matches(filter.worksheet, testCase.source.worksheet))
      return false;
    if (!matches(filter.module, testCase.module))
      return false;
    if (!matches(filter.feature, testCase.feature))
      return false;
    if (!matches(priorities, testCase.priority))
      return false;
    if (!matches(statuses, testCase.automationStatus))
      return false;
    if (!matches(filter.testCaseId, testCase.testCaseId))
      return false;
    if (filter.tag?.length && !matches(filter.tag, ...testCase.tags))
      return false;
    return true;
  });
}

/** Counts used by summaries and the demo report. */
export function summarize(testCases: TestCase[]) {
  const byPriority: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  const byAutomationStatus: Record<string, number> = {};
  for (const testCase of testCases) {
    const priority = testCase.priority || '(unset)';
    const module = testCase.module || '(unset)';
    byPriority[priority] = (byPriority[priority] ?? 0) + 1;
    byModule[module] = (byModule[module] ?? 0) + 1;
    byAutomationStatus[testCase.automationStatus] = (byAutomationStatus[testCase.automationStatus] ?? 0) + 1;
  }
  return { total: testCases.length, byPriority, byModule, byAutomationStatus };
}
