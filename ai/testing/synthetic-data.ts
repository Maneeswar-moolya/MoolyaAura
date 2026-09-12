/** Small, authored contract inputs. Nothing here is imported from a customer corpus. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { CandidateMeasurement, TargetEvidence } from '../autocode/dom-evidence';

export const FIXTURE_APPLICATION = 'fixtureapp';
export const FIXTURE_URL = 'https://portal.fixture.invalid/';
export const measurement = (expression: string, overrides: Partial<CandidateMeasurement> = {}): CandidateMeasurement => ({
  expression, strategy: 'recorded-locator', matchCount: 1, identityMatched: true,
  sameDocument: true, measuredAt: 'press', ...overrides,
});
export function targetEvidence(expression: string, overrides: Partial<TargetEvidence> = {}): TargetEvidence {
  return {
    locator: expression, target: { tag: 'button', role: 'button', accessibleName: 'Save', accessibleNameVerified: true },
    ancestors: [], children: [], descendants: [], previousSiblings: [], nextSiblings: [],
    relationships: [], matchCount: 1, matchCountDocument: 'same', captureTiming: 'before-action',
    derivedCandidates: [measurement(expression)], ...overrides,
  } as TargetEvidence;
}
export function writeFixtureFile(relative: string, content: string): string {
  const root = process.env.AURA_SYNTHETIC_FIXTURE_ROOT;
  if (!root || path.resolve(process.cwd()) !== path.resolve(root))
    throw new Error('synthetic data requires an isolated contract worker');
  const temporary = path.relative(os.tmpdir(), root);
  if (temporary.startsWith('..') || path.isAbsolute(temporary) || !path.basename(root).startsWith('aura-contract-'))
    throw new Error('synthetic data requires a guarded OS temporary checkout');
  const file = path.resolve(root, relative);
  const within = path.relative(root, file);
  if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('fixture path escapes its root');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

export interface SyntheticElement {
  id: string; owner: string; method?: string; expression?: string;
  role?: string; name?: string; label?: string; description?: string;
  params?: string; parameter?: string; usage?: 'action' | 'assertion';
}
export function writeKnowledge(file: string, route: string, elements: SyntheticElement[], options: {
  entryPoint?: string; authenticated?: boolean; purpose?: string;
} = {}): void {
  const scalar = (value: unknown) => JSON.stringify(value);
  const lines = ['# Authored synthetic contract input; not application knowledge.', 'page:',
    `  id: ${file.replace(/\.yaml$/, '')}`, `  name: ${scalar(options.purpose ?? 'Fixture screen')}`,
    `  purpose: ${scalar(options.purpose ?? 'Exercise ownership and reusable capabilities')}`, `  route: ${scalar(route)}`,
    'navigation:', `  authentication_required: ${options.authenticated ?? false}`,
    `  entry_point: ${scalar(options.entryPoint ?? '')}`, 'elements:'];
  for (const element of elements) {
    lines.push(`  ${element.id}:`, `    description: ${scalar(element.description ?? element.id.replace(/_/g, ' '))}`,
      `    page_object: ${element.owner}`);
    for (const [key, value] of Object.entries({ page_object_method: element.method, locator_strategy: element.expression,
      role: element.role, accessible_name: element.name, label: element.label, parameter_source: element.parameter, usage: element.usage }))
      if (value !== undefined) lines.push(`    ${key}: ${key === 'page_object_method' || key === 'usage' ? value : scalar(value)}`);
  }
  writeFixtureFile(`ai/knowledge/page/${file}`, lines.join('\n') + '\n');
}
export function recordingSource(lines: string[]): string {
  return ["import { test, expect } from '@playwright/test';", "test('synthetic contract', async ({ page }) => {",
    ...lines.map(line => `  ${line}`), '});', ''].join('\n');
}
export function writeRecording(id: string, lines: string[], targets: TargetEvidence[] = [], options: { archived?: boolean; assertions?: unknown[] } = {}): void {
  const base = `ai/dashboard/recordings/${FIXTURE_APPLICATION}/${options.archived ? 'accepted/' : ''}${id}`;
  writeFixtureFile(`${base}.spec.ts`, recordingSource(lines));
  writeFixtureFile(`${base}.evidence.json`, JSON.stringify({
    available: true, capturedAt: new Date(0).toISOString(), limits: {},
    origin: { applicationId: FIXTURE_APPLICATION, environmentId: 'qa', baseUrl: FIXTURE_URL, testCaseId: id }, targets,
  }));
  if (options.assertions) writeFixtureFile(`${base}.assertions.json`, JSON.stringify(options.assertions));
}
