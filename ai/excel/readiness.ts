/**
 * Is this row authored well enough to generate automation from?
 *
 * ONE QUESTION, AND NOT THE OTHER THREE. This module answers "has a person
 * written down enough, clearly enough, to build a test from?" It deliberately
 * does not answer:
 *
 *   generation eligibility  - whose spec is out of date, whose attempts are
 *                             spent, what the framework changed. `work.ts`.
 *   automation status       - whether a spec exists and has been earned.
 *                             The workbook's own column, written by the gate.
 *   execution status        - what happened when it last ran. `writeback.ts`.
 *
 * They were conflated in conversation long before they were conflated in code,
 * which is how "not automated" came to mean six different things on one screen.
 *
 * DETERMINISTIC. Every finding here is a rule about the text of the row: a field
 * is empty, an enum is not one of its values, a pattern does not match. There is
 * no judgement of prose quality - `quality.ts` owns the fuzzier questions, and
 * its findings advise rather than block. Nothing here calls a model or a browser.
 */

import { PLACEHOLDER_TEXTS } from '../dashboard/placeholders';
import {
  AUTH_PROFILE_PATTERN, BUSINESS_RISKS, PRIORITIES, REQUIREMENT_ID_PATTERN, TEST_TYPES,
  type TestCase,
} from './types';

export type ReadinessCode =
  | 'READY'
  | 'MISSING_TEST_CASE_ID'
  | 'MISSING_TITLE'
  | 'MISSING_STEPS'
  | 'MISSING_EXPECTED_RESULT'
  | 'PLACEHOLDER_EXPECTED_RESULT'
  | 'INVALID_PRIORITY'
  | 'INVALID_TEST_TYPE'
  | 'INVALID_BUSINESS_RISK'
  | 'INVALID_AUTH_PROFILE'
  | 'INVALID_REQUIREMENT_ID'
  | 'CREDENTIAL_IN_AUTHORED_FIELD'
  | 'RECORDED_CASE_NEEDS_RERECORD'
  | 'MISSING_MODULE'
  | 'MISSING_FEATURE'
  | 'MISSING_DESCRIPTION'
  | 'MISSING_ENVIRONMENT'
  | 'MISSING_AUTH_PROFILE'
  | 'MISSING_REQUIREMENT_ID'
  | 'NON_ATOMIC_STEP';

/**
 * `blocking` stops generation; `advisory` is worth saying and never stops it.
 *
 * The split is not about severity of opinion, it is about whether the rule can
 * be wrong. "Expected Result is empty" cannot be wrong. "This row has no
 * Requirement ID" is a policy some projects hold and others do not, so it is
 * reported and left to the author.
 */
export type ReadinessSeverity = 'blocking' | 'advisory';

export interface ReadinessFinding {
  code: ReadinessCode;
  severity: ReadinessSeverity;
  /** The authored field to put the cursor in. */
  field?: string;
  message: string;
}

export interface Readiness {
  /** True when nothing blocking was found. Advisory findings may still exist. */
  ready: boolean;
  findings: ReadinessFinding[];
  /** `READY`, or the blocking codes in the order a person would fix them. */
  codes: ReadinessCode[];
}

/** What the framework knows about a recording for this row, if there is one. */
export interface RecordingState {
  /** A recording artifact exists on disk. */
  exists: boolean;
  /**
   * The recording no longer matches the authored row - see
   * `recordingFingerprint`. Undefined when nothing recorded it, which is not
   * the same as "it matches".
   */
  stale?: boolean;
}

export interface ReadinessOptions {
  recording?: RecordingState;
  /**
   * Controlled fields exactly as the author typed them, when the caller has
   * them. Without this an unrecognised enum is indistinguishable from an empty
   * one, and calling an old workbook's blank cell "invalid" would be a lie.
   */
  raw?: { priority?: string; testType?: string; businessRisk?: string };
  /** Project policy: fields this project insists on. Default: none. */
  require?: Array<'module' | 'feature' | 'environment' | 'authenticationProfile' | 'requirementId' | 'description'>;
}

/**
 * A credential typed into a field that is not a credential field.
 *
 * Deterministic and narrow: a secret-ish NAME, an assignment, and a value that
 * is not one of the workbook's own `<tokens>`. `password = <valid-password>` is
 * the supported way to say "the real one, from the environment"; anything else
 * after that equals sign is a secret sitting in a shared file.
 */
const CREDENTIAL_ASSIGNMENT =
  /\b(pass(?:word)?|pwd|passwd|secret|token|api[\s_-]?key|apikey|credential|bearer|otp)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi;

/** `<valid-password>`, `<blank>`, `<email:12>` - a token, not a value. */
const TOKEN_VALUE = /^["']?<[^>]+>["']?$/;

export function credentialsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of String(text ?? '').matchAll(CREDENTIAL_ASSIGNMENT)) {
    const value = match[2] ?? '';
    if (!TOKEN_VALUE.test(value.trim()))
      found.push(match[1]);
  }
  return [...new Set(found)];
}

/** Every authored free-text field, so a secret cannot hide in an unusual one. */
export const FREE_TEXT_FIELDS: Array<keyof TestCase> = [
  'scenario', 'description', 'preconditions', 'testData', 'expectedResult',
  'automationNotes', 'expectedMessage', 'requirementId', 'environment', 'userRole', 'testOwner',
];

function isPlaceholder(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  return PLACEHOLDER_TEXTS.some(text => text.toLowerCase() === normalised);
}

/**
 * A step that does more than one thing.
 *
 * Advisory, and deliberately conservative: two imperative clauses joined by a
 * connector, in a step long enough for that to be a real compound instruction.
 * "Login, open project and search for issue" is caught; "Click Sign In and
 * wait" is not, because the second half is not an instruction a runner acts on.
 */
const COMPOUND_STEP = /\b(?:then|and then|after that)\b|,\s*(?:and\s+)?(?:open|click|enter|select|search|navigate|verify|check)\b/i;

function compoundSteps(steps: string[]): number[] {
  const found: number[] = [];
  steps.forEach((step, index) => {
    if (step.trim().length >= 25 && COMPOUND_STEP.test(step))
      found.push(index + 1);
  });
  return found;
}

/** Judge one authored row. Pure: no files, no browser, no model. */
export function assessReadiness(testCase: TestCase, options: ReadinessOptions = {}): Readiness {
  const findings: ReadinessFinding[] = [];
  const add = (code: ReadinessCode, severity: ReadinessSeverity, message: string, field?: string) =>
    findings.push({ code, severity, message, field });
  const required = new Set(options.require ?? []);

  if (!testCase.testCaseId.trim())
    add('MISSING_TEST_CASE_ID', 'blocking', 'Test Case ID is how automation traces back to this row.', 'testCaseId');
  if (!testCase.scenario.trim())
    add('MISSING_TITLE', 'blocking', 'Title/Scenario is required - it becomes the test title.', 'scenario');
  if (!testCase.steps.length)
    add('MISSING_STEPS', 'blocking', 'Steps are required - they are what the test does.', 'steps');

  const expected = testCase.expectedResult.trim();
  if (!expected) {
    add('MISSING_EXPECTED_RESULT', 'blocking',
        'Expected Result is required - a test with nothing to check cannot be written.', 'expectedResult');
  } else if (isPlaceholder(expected)) {
    add('PLACEHOLDER_EXPECTED_RESULT', 'blocking',
        `Expected Result is still the "${expected}" placeholder. Confirm what this test proves, `
        + 'or re-record with the check in it - it is never invented from the steps.', 'expectedResult');
  }

  // Controlled values.
  //
  // A PARSED row cannot tell "empty" from "unrecognised": the parser normalises
  // an unknown Test Type to empty, deliberately, so an old workbook is never
  // refused for a value it was written before the list existed. The as-written
  // text is therefore passed in by the caller that still has it - the authoring
  // form - and only then can a value be called invalid.
  const raw = options.raw ?? {};
  if (testCase.priority && !(PRIORITIES as readonly string[]).includes(testCase.priority))
    add('INVALID_PRIORITY', 'blocking', `Priority must be one of ${PRIORITIES.join(', ')}.`, 'priority');
  if (raw.priority?.trim() && !testCase.priority)
    add('INVALID_PRIORITY', 'blocking', `Priority must be one of ${PRIORITIES.join(', ')}.`, 'priority');
  if (raw.testType?.trim() && !testCase.testType)
    add('INVALID_TEST_TYPE', 'blocking', `Test Type must be one of ${TEST_TYPES.join(', ')}.`, 'testType');
  if (raw.businessRisk?.trim() && !testCase.businessRisk)
    add('INVALID_BUSINESS_RISK', 'blocking', `Business Risk must be one of ${BUSINESS_RISKS.join(', ')}.`, 'businessRisk');

  const profile = testCase.authenticationProfile.trim();
  if (profile && !AUTH_PROFILE_PATTERN.test(profile)) {
    add('INVALID_AUTH_PROFILE', 'blocking',
        `Authentication Profile must be a profile NAME such as APPLICATION_QA_USER - "${profile}" is not one. `
        + 'Never put an address or a password here; the values live in the environment.',
        'authenticationProfile');
  }
  const requirement = testCase.requirementId.trim();
  if (requirement && !REQUIREMENT_ID_PATTERN.test(requirement)) {
    add('INVALID_REQUIREMENT_ID', 'blocking',
        `Requirement ID "${requirement}" is not a recognisable identifier (e.g. PROJ-1234).`, 'requirementId');
  }

  for (const field of FREE_TEXT_FIELDS) {
    const names = credentialsIn(String(testCase[field] ?? ''));
    if (names.length) {
      add('CREDENTIAL_IN_AUTHORED_FIELD', 'blocking',
          `"${field}" appears to contain a credential (${names.join(', ')}). A workbook is a shared file: `
          + 'use a token like <valid-password>, or an Authentication Profile.', String(field));
    }
  }

  if (options.recording?.exists && options.recording.stale) {
    add('RECORDED_CASE_NEEDS_RERECORD', 'blocking',
        'The recording no longer matches what this row says. Re-record it, or regenerate from the '
        + 'authored steps - the old recording is never reused after an incompatible edit.', 'steps');
  }

  // Advisory from here down. None of it stops generation.
  const advise = (code: ReadinessCode, field: keyof TestCase, label: string) => {
    const missing = !String(testCase[field] ?? '').trim();
    if (missing && required.has(field as ReadinessOptions['require'] extends Array<infer T> ? T : never))
      add(code, 'advisory', `${label} is required by this project's policy.`, String(field));
  };
  advise('MISSING_MODULE', 'module', 'Module');
  advise('MISSING_FEATURE', 'feature', 'Feature');
  advise('MISSING_DESCRIPTION', 'description', 'Description');
  advise('MISSING_ENVIRONMENT', 'environment', 'Environment');
  advise('MISSING_AUTH_PROFILE', 'authenticationProfile', 'Authentication Profile');
  advise('MISSING_REQUIREMENT_ID', 'requirementId', 'Requirement ID');

  const compound = compoundSteps(testCase.steps);
  if (compound.length) {
    add('NON_ATOMIC_STEP', 'advisory',
        `Step(s) ${compound.join(', ')} look like more than one instruction. One action per step gives `
        + 'the generator - and the person reading a failure - an unambiguous place to point.', 'steps');
  }

  const blocking = findings.filter(finding => finding.severity === 'blocking');
  return {
    ready: blocking.length === 0,
    findings,
    codes: blocking.length ? blocking.map(finding => finding.code) : ['READY'],
  };
}
