/**
 * The application-INDEPENDENT half of a fixtures module.
 *
 * WHY THIS EXISTS. A fixtures module is application-owned - `ScopePaths.fixturesFile`
 * says so, and the reason is a collision: the fixture NAME is derived from the Page Object
 * class name, so two applications both registering `loginPage` in one file would silently
 * give every spec the first application's class. But only the PAGE OBJECT half is
 * application-owned. `healing`, `step`, `trace` and the `require*` guards are framework,
 * and `ai/projects/scope.ts` is explicit that the framework "is shared and is never
 * duplicated per application".
 *
 * So the wiring lives here once, and each application's module extends it with its own
 * Page Objects and nothing else. That is what lets a newly provisioned application have a
 * fixtures module at all: before this, `applyProposals` did
 * `fs.readFileSync(fixturesFile())` on a file that did not exist for any application but
 * the legacy one, and `registerFixture` then needed an existing Page Object import group
 * to anchor to - so a new application could never write its first Page Object, and the
 * whole point of provisioning was unreachable without somebody hand-authoring this file.
 *
 * `tests-e2e/fixtures.ts` - Bugasura's, the legacy flat one - deliberately does NOT import
 * this. It predates the scope layer, 62 generated specs and every hand-written suite
 * destructure from it, and rewriting it to gain nothing is exactly the migration the
 * architecture is designed to avoid. It keeps its own copy of this wiring; everything
 * provisioned from now on shares this one.
 *
 * CREDENTIALS ARE NAMED NEUTRALLY HERE. Bugasura's module calls them
 * `bugasuraCredentials` / `bugasuraEmail`, which is a name no other application can use
 * honestly. A generated spec for any other application destructures `appCredentials` /
 * `appEmail`, and `tests-e2e/support/env.ts` already resolves WHICH variables those read
 * from the active application's own registry declaration.
 */

import { test as base, expect } from '@playwright/test';

import {
  credentials, missingCredentialsReason, missingEmailReason,
  registeredEmail, type Credentials,
} from './env';
import { flushHealing, HealingRecorder } from './resilient-locator';
import { flushSteps, runStep, StepRecorder } from './steps';

export type StepFn = <T>(title: string, body: () => Promise<T>) => Promise<T>;

export interface BaseFixtures {
  healing: HealingRecorder;
  step: StepFn;
  /** The active application's credentials, or null when it declares/supplies none. */
  appCredentials: Credentials | null;
  /** Its registered address alone, for cases that need an account but not its password. */
  appEmail: string | null;
}

/**
 * The framework fixtures every application's module extends.
 *
 * Identical in behaviour to the wiring in `tests-e2e/fixtures.ts`, because it is the same
 * wiring: both flush the healing log and the step list under the Test Case ID recovered
 * from the test TITLE, which is why every generated test is titled `TC_ID - Scenario`.
 */
export const baseTest = base.extend<BaseFixtures>({
  healing: async ({}, use, testInfo) => {
    const recorder = new HealingRecorder();
    await use(recorder);

    const testCaseId = /^((?:TC|TS)[_-][A-Za-z0-9_-]+)/.exec(testInfo.title)?.[1];
    if (testCaseId) {
      flushHealing(testCaseId, recorder, testInfo.status === 'passed' ? 'Passed' : 'Failed');
      for (const event of recorder.events) {
        testInfo.annotations.push({
          type: 'healed-locator',
          description: `${event.logicalName}: "${event.from}" no longer resolves; "${event.to}" did.`,
        });
      }
    }
  },

  step: async ({ page }, use, testInfo) => {
    const recorder = new StepRecorder();
    await use(<T>(title: string, body: () => Promise<T>) =>
      runStep(recorder, page, testInfo, title, body));

    const testCaseId = /^((?:TC|TS)[_-][A-Za-z0-9_-]+)/.exec(testInfo.title)?.[1];
    if (testCaseId)
      flushSteps(testCaseId, testInfo.title, recorder);
  },

  appCredentials: async ({}, use) => {
    await use(credentials());
  },

  appEmail: async ({}, use) => {
    await use(registeredEmail());
  },
});

export { expect };

export interface Traceability {
  testCaseId: string;
  module: string;
  scenario: string;
  sourceWorkbook: string;
  sourceWorksheet: string;
  priority?: string;
}

/** Workbook priority -> Allure severity. */
const SEVERITY: Record<string, string> = {
  P0: 'blocker', P1: 'critical', P2: 'normal', P3: 'minor',
};

/**
 * Mirror the traceability into Allure's own vocabulary.
 *
 * Dynamically imported and wrapped, on purpose: the suite must still run when the Allure
 * reporter is not active or the package is absent.
 */
async function tagForAllure(meta: Traceability): Promise<void> {
  try {
    const allure = await import('allure-js-commons');
    await allure.allureId(meta.testCaseId);
    await allure.epic(meta.module || 'Uncategorised');
    await allure.feature(meta.module || 'Uncategorised');
    await allure.story(meta.scenario || meta.testCaseId);
    await allure.label('workbook', meta.sourceWorkbook);
    await allure.label('worksheet', meta.sourceWorksheet);
    await allure.tag(meta.testCaseId);
    if (meta.priority) {
      await allure.severity(SEVERITY[meta.priority] ?? 'normal');
      await allure.tag(meta.priority);
    }
  } catch {
    // Allure not in play; the Playwright annotations below still carry everything.
  }
}

/**
 * Record where this test came from. Called first in every generated test, so a CI failure
 * is traceable to a workbook row without opening the spreadsheet.
 */
export async function trace(meta: Traceability): Promise<void> {
  const info = baseTest.info();
  info.annotations.push(
      { type: 'test-case-id', description: meta.testCaseId },
      { type: 'module', description: meta.module },
      { type: 'scenario', description: meta.scenario },
      { type: 'source', description: `${meta.sourceWorkbook} :: ${meta.sourceWorksheet}` },
  );
  if (meta.priority)
    info.annotations.push({ type: 'priority', description: meta.priority });

  await tagForAllure(meta);
}

/** Skip when credentials are absent, naming the variables THIS application declares. */
export function requireCredentials(creds: Credentials | null): asserts creds is Credentials {
  baseTest.skip(!creds, missingCredentialsReason());
}

/** As above, for cases needing a real account but not its password. */
export function requireEmail(email: string | null): asserts email is string {
  baseTest.skip(!email, missingEmailReason());
}

/** Application-owned opt-in must be supplied explicitly; no other app's flag can grant it. */
export function requireDataMutationOptIn(allowed = false): void {
  baseTest.skip(allowed !== true, 'This application has not explicitly opted in to data mutation.');
}
