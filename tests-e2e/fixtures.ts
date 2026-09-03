/**
 * Fixtures for Excel-sourced tests.
 *
 * Provides the page objects, a healing recorder wired into them, and the
 * traceability annotations that tie a running test back to the workbook row it
 * came from. The Test Case ID is taken from the test title, which is why every
 * generated test is titled `TC_ID - Scenario`.
 */

import { test as base, expect } from '@playwright/test';

import { IssuesPage } from './pages/issues.page';
import { LoginPage } from './pages/login.page';
import { NotificationsPanel } from './pages/notifications.panel';
import { ProjectsPage } from './pages/projects.page';
import { WorkspacePage } from './pages/workspace.page';
import {
  credentials,
  dataMutationAllowed,
  MISSING_CREDENTIALS_REASON,
  MISSING_EMAIL_REASON,
  MUTATION_NOT_ALLOWED_REASON,
  registeredEmail,
  type Credentials,
} from './support/env';
import { flushHealing, HealingRecorder } from './support/resilient-locator';
import { flushSteps, runStep, StepRecorder } from './support/steps';

/** Metadata carried from the source workbook into the test report. */
export interface Traceability {
  testCaseId: string;
  module: string;
  scenario: string;
  sourceWorkbook: string;
  sourceWorksheet: string;
  priority?: string;
}

/**
 * Wrap one named step so the dashboard can say which one failed.
 *
 * Use it for the actions a person would recognise from the workbook - "Open the
 * sign-in page", "Submit the form" - not for every line of code. The value is a
 * short list somebody can read, not a transcript.
 */
export type StepFn = <T>(title: string, body: () => Promise<T>) => Promise<T>;

interface Fixtures {
  healing: HealingRecorder;
  step: StepFn;
  loginPage: LoginPage;
  workspacePage: WorkspacePage;
  projectsPage: ProjectsPage;
  /**
   * A project's issue list. Reached by navigation, like every other screen here.
   *
   * IT WAS MISSING, and that omission cost ten quarantined specs. The class, its
   * knowledge file (ai/knowledge/page/bugasura__issues-id.yaml, seven declared
   * elements) and two abstraction-engine methods measured against real recordings all
   * existed; only step 5 of FRAMEWORK-GUIDE.md's own procedure had been skipped. So
   * every generated spec that reused an IssuesPage method destructured `issuesPage`,
   * and Playwright refused the whole file: `Test has unknown parameter "issuesPage"`,
   * 0 tests collected - reported as `Not Collected` and diagnosed as a locator problem.
   *
   * Contrast `TermsPage` and `BasePage`, which have no fixture ON PURPOSE and say so in
   * their own headers: Terms lives on a popup Page a fixture would have to invent, and
   * BasePage is the abstract base. `methodIsDeliverable` in ai/autocode/from-recording.ts
   * is what now stops a generator emitting either of them, whatever this file declares.
   */
  issuesPage: IssuesPage;
  /** The notification overlay - a component, reachable from every signed-in screen. */
  notificationsPanel: NotificationsPanel;
  /** Credentials, or null when the environment has not supplied them. */
  bugasuraCredentials: Credentials | null;
  /** The registered email alone - all a rejection test case needs. */
  bugasuraEmail: string | null;
}

export const test = base.extend<Fixtures>({
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

    // Same convention as the healing log: the Test Case ID comes off the title,
    // which is why every generated test is titled `TC_ID - Scenario`.
    const testCaseId = /^((?:TC|TS)[_-][A-Za-z0-9_-]+)/.exec(testInfo.title)?.[1];
    if (testCaseId)
      flushSteps(testCaseId, testInfo.title, recorder);
  },

  loginPage: async ({ page, healing }, use) => {
    await use(new LoginPage(page, healing));
  },

  workspacePage: async ({ page, healing }, use) => {
    await use(new WorkspacePage(page, healing));
  },

  projectsPage: async ({ page, healing }, use) => {
    await use(new ProjectsPage(page, healing));
  },

  issuesPage: async ({ page, healing }, use) => {
    await use(new IssuesPage(page, healing));
  },

  notificationsPanel: async ({ page, healing }, use) => {
    await use(new NotificationsPanel(page, healing));
  },

  bugasuraCredentials: async ({}, use) => {
    await use(credentials());
  },

  bugasuraEmail: async ({}, use) => {
    await use(registeredEmail());
  },
});

export { expect };

/** Workbook priority -> Allure severity. */
const SEVERITY: Record<string, string> = {
  P0: 'blocker',
  P1: 'critical',
  P2: 'normal',
  P3: 'minor',
};

/**
 * Mirror the traceability into Allure's own vocabulary, so its dashboard groups
 * by the things a test lead actually thinks in: module, scenario, severity.
 *
 * Wrapped in try/catch and dynamically imported on purpose - the suite must
 * still run when the Allure reporter is not active, or the package is absent.
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
 * Record where this test came from. Call it first in every generated test -
 * the annotations show up in the HTML, JSON and Allure reports, so a failure in
 * CI is traceable to a workbook row without opening the spreadsheet.
 */
export async function trace(meta: Traceability): Promise<void> {
  const info = test.info();
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

/**
 * Skip the current test when credentials are absent, with a reason that says
 * exactly what to set. Better than a red build that only means "no secrets".
 */
export function requireCredentials(creds: Credentials | null): asserts creds is Credentials {
  test.skip(!creds, MISSING_CREDENTIALS_REASON);
}

/** As above, for test cases that need a real account but not its password. */
export function requireEmail(email: string | null): asserts email is string {
  test.skip(!email, MISSING_EMAIL_REASON);
}

/**
 * Gate for test cases that write to the live workspace. Skips by default -
 * running the suite should never leave debris in a real product.
 */
export function requireDataMutationOptIn(): void {
  test.skip(!dataMutationAllowed(), MUTATION_NOT_ALLOWED_REASON);
}
