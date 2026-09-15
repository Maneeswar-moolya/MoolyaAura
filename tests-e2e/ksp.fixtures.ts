/**
 * Fixtures for this application's Excel-sourced tests.
 *
 * Created by the framework when this application registered its first Page Object. The
 * framework half - healing, step, trace, the require* guards - lives in
 * ./support/base-fixtures and is shared; everything below is owned by this application.
 *
 * The two markers are anchors the Page Object writer inserts at. Keep them.
 */

import type { HealingRecorder } from './support/resilient-locator';
import type { Credentials } from './support/env';
import {
  baseTest, expect, requireCredentials, requireDataMutationOptIn, requireEmail, trace,
  type StepFn, type Traceability,
} from './support/base-fixtures';

import { SsoauthLoginPage } from './pages/ksp/ssoauth.login.page';
import { UsEnHomePage } from './pages/ksp/us.en.home.page';
import { LandingPage } from './pages/ksp/LandingPage';
import { LoginButton } from './pages/ksp/LoginButton';
import { InitialLandingPage } from './pages/ksp/InitialLandingPage';
import { MySupportCasesPage } from './pages/ksp/MySupportCasesPage';
import { Notifications } from './pages/ksp/Notifications';
import { UsEnMySupportCasesPage } from './pages/ksp/us.en.my.support.cases.page';

/**
 * DELIBERATELY NOT `extends BaseFixtures`. The framework index reads this block with
 * `/(?:type|interface)\s+\w*Fixtures\w*\s*=?\s*\{([\s\S]*?)\n\}/` (ai/knowledge/index.ts,
 * `fixturesOf`) to decide which fixtures a generated spec may destructure. An `extends`
 * clause hides the inherited ones from that regex, so `staticCheck` would refuse any spec
 * using `step` as an unknown fixture. These four are DECLARATIONS only - the
 * implementations are inherited from `baseTest` and are not repeated.
 */
interface Fixtures {
  healing: HealingRecorder;
  step: StepFn;
  appCredentials: Credentials | null;
  appEmail: string | null;
  // <page-object-fixtures>
  /** Created by the abstraction engine, so generated specs can reach SsoauthLoginPage. */
  ssoauthLoginPage: SsoauthLoginPage;
  /** Created by the abstraction engine, so generated specs can reach UsEnHomePage. */
  usEnHomePage: UsEnHomePage;
  /** Created by the abstraction engine, so generated specs can reach LandingPage. */
  landingPage: LandingPage;
  /** Created by the abstraction engine, so generated specs can reach LoginButton. */
  loginButton: LoginButton;
  /** Created by the abstraction engine, so generated specs can reach InitialLandingPage. */
  initialLandingPage: InitialLandingPage;
  /** Created by the abstraction engine, so generated specs can reach MySupportCasesPage. */
  mySupportCasesPage: MySupportCasesPage;
  /** Created by the abstraction engine, so generated specs can reach Notifications. */
  notifications: Notifications;
  /** Created by the abstraction engine, so generated specs can reach UsEnMySupportCasesPage. */
  usEnMySupportCasesPage: UsEnMySupportCasesPage;
}

export const test = baseTest.extend<Fixtures>({
  ssoauthLoginPage: async ({ page, healing }, use) => {
    await use(new SsoauthLoginPage(page, healing));
  },
  usEnHomePage: async ({ page, healing }, use) => {
    await use(new UsEnHomePage(page, healing));
  },
  landingPage: async ({ page, healing }, use) => {
    await use(new LandingPage(page, healing));
  },
  loginButton: async ({ page, healing }, use) => {
    await use(new LoginButton(page, healing));
  },
  initialLandingPage: async ({ page, healing }, use) => {
    await use(new InitialLandingPage(page, healing));
  },
  mySupportCasesPage: async ({ page, healing }, use) => {
    await use(new MySupportCasesPage(page, healing));
  },
  notifications: async ({ page, healing }, use) => {
    await use(new Notifications(page, healing));
  },
  usEnMySupportCasesPage: async ({ page, healing }, use) => {
    await use(new UsEnMySupportCasesPage(page, healing));
  },
  // <page-object-fixtures>
});

export { expect, requireCredentials, requireDataMutationOptIn, requireEmail, trace };
export type { StepFn, Traceability };
