// Real validation case only. Never promotes evidence or changes application artifacts.
require('tsx/cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('@playwright/test');
const { expect, withLocatorOperation, LOCATOR_TIMEOUT_MS } = require('../../tests-e2e/support/locator-policy');
const { pinActiveScope } = require('../../ai/projects/scope');
const scope = pinActiveScope({ applicationId: 'ksp', environmentId: 'stg' });
const { readTestData, credentialPreflight } = require('../../ai/test-data/store');
const { executionPlan } = require('../../ai/test-data/execution');
const { credentials } = require('../../tests-e2e/support/env');
const { diagnosticData, diagnosticText, captureDiagnostic, writeDiagnostic } = require('../../ai/diagnostics/artifacts');
const { InitialLandingPage } = require('../../tests-e2e/pages/ksp/InitialLandingPage');
const { SsoauthLoginPage } = require('../../tests-e2e/pages/ksp/ssoauth.login.page');
const { UsEnHomePage } = require('../../tests-e2e/pages/ksp/us.en.home.page');

function snapshot() {
  const roots = ['ai/projects/registry.json', 'ai/dashboard/recordings/ksp', 'ai/knowledge/page/ksp',
    'ai/test-data/ksp', 'ai/test-mapping', 'ai/autocode/state.json', 'ai/autocode/quarantine',
    'ai/diagnostics/artifacts/ksp', 'ai/dashboard/runs', 'tests-e2e/pages/ksp',
    'tests-e2e/generated/ksp', 'tests-e2e/ksp.fixtures.ts', 'excel/ksp-test-cases.xlsx'];
  function walk(file) {
    if (!fs.existsSync(file)) return [];
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return [];
    return stat.isDirectory() ? fs.readdirSync(file).flatMap(name => walk(path.join(file, name))) : [file.replaceAll('\\', '/')];
  }
  return Object.fromEntries(roots.flatMap(walk).map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
}

async function main() {
  const output = path.join('docs/validation/ksp21-headed', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const before = snapshot();
  writeDiagnostic(path.join(output, 'before-hashes.json'), before);
  const report = {
    applicationId: scope.applicationId, environmentId: scope.environmentId, testCaseId: 'TC_SMOKE_021',
    historicalEvidence: false, provenance: 'LIVE_DIAGNOSTIC_ONLY', startedAt: new Date().toISOString(),
    locatorTimeoutMs: LOCATOR_TIMEOUT_MS,
    browser: { engine: 'chromium', channel: null, headless: false, playwrightVersion: require('playwright/package.json').version },
    trace: { retained: false, reason: 'Raw Playwright traces can retain credential fill arguments; using existing masked screenshot and sanitized diagnostic architecture.' },
    runtimeAIInvoked: false, observations: [], navigations: [], consoleErrors: [], liveDiagnosisPassed: false,
    quarantineRerun: { attempted: false, reason: 'BROWSER_MODE_NOT_PROPAGATED: quarantine request/service/verifier do not forward headed mode.' }
  };
  let browser, page, account;
  const safeUrl = () => diagnosticText(page.url());
  const capture = async (key, type) => {
    const shot = await captureDiagnostic(page, output, key, type);
    return shot || { recordingStepKey: key, captureType: type, unavailable: true };
  };
  try {
    const catalog = readTestData(scope);
    const profile = catalog.credentialProfiles.find(item => item.name === 'kspuserCommon');
    if (!profile) throw Error('CREDENTIAL_CONFIGURATION_FAILURE: saved profile not found in active application.');
    report.credentialProfile = { id: profile.id, name: profile.name };
    const preflight = credentialPreflight(scope, profile.id);
    report.preflight = { profileActive: preflight.profile === 'Active', environmentId: preflight.environmentId,
      usernameAvailable: preflight.username === 'Available', passwordAvailable: preflight.password === 'Available' };
    const planned = executionPlan(scope, ['TC_SMOKE_021'], {
      mode: 'selected', credentialProfileIds: [profile.id], expectedVersion: catalog.version
    });
    process.env.AURA_EXECUTION_SELECTION = JSON.stringify(planned[0].selection);
    account = credentials();
    if (!account?.email || !account.password) throw Error('CREDENTIAL_CONFIGURATION_FAILURE: scoped profile could not resolve a coherent credential pair.');
    report.credentialsResolved = true;

    const base = 'ai/dashboard/recordings/ksp/TC_SMOKE_021';
    const owners = JSON.parse(fs.readFileSync(base + '.owners.json', 'utf8'));
    const recordingSource = fs.readFileSync(base + '.spec.ts', 'utf8');
    const recording = require('../../ai/dashboard/recorder').parseRecording(recordingSource, {
      startUrl: scope.baseUrl, browser: 'chromium', durationMs: 0,
      evidence: JSON.parse(fs.readFileSync(base + '.evidence.json', 'utf8'))
    });
    const expectedActions = ['navigate', 'click', 'click', 'fill', 'fill', 'click'];
    if (!expectedActions.every((type, i) => recording.actions[i]?.type === type)) throw Error('Recording changed: diagnostic step correlation must be reviewed.');
    const chosen = owners.choices.find(choice => choice.key === 'action:1');
    if (owners.applicationId !== scope.applicationId || chosen?.provenance !== 'USER_CONFIRMED'
      || chosen.userSelection?.pageObject !== 'InitialLandingPage' || chosen.userSelection.method !== 'logIn'
      || chosen.userSelection.executionMode !== 'PAGE_OBJECT_METHOD') throw Error('Saved initial binding changed; refusing to substitute an execution choice.');
    report.initialBinding = chosen;
    report.generatedFile = 'ai/autocode/quarantine/ksp.TC_SMOKE_021.2026-09-13T09-12-14-284Z.spec.ts.txt';
    const generated = fs.readFileSync(report.generatedFile, 'utf8');
    report.generatedSha256 = crypto.createHash('sha256').update(generated).digest('hex');
    const lines = generated.split(/\r?\n/);
    const statement = fragment => {
      const index = lines.findIndex(line => line.includes(fragment));
      if (index < 0) throw Error('Retained generated statement changed: ' + fragment);
      return { generatedFile: report.generatedFile, generatedLine: index + 1, statement: lines[index].trim() };
    };
    browser = await chromium.launch({ headless: false });
    report.browser.version = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(LOCATOR_TIMEOUT_MS);
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) report.navigations.push({ at: new Date().toISOString(), url: diagnosticText(frame.url()), kind: 'OBSERVED_BROWSER_NAVIGATION' });
    });
    page.on('pageerror', error => { if (report.consoleErrors.length < 40) report.consoleErrors.push(diagnosticText(error.message)); });
    page.on('console', message => { if (message.type() === 'error' && report.consoleErrors.length < 40) report.consoleErrors.push(diagnosticText(message.text())); });

    const navigation = { recordingStepKey: 'action:0', label: 'Open configured entry page', ...statement('await page.goto('), captures: [await capture('action:0', 'PRE_STEP')] };
    report.observations.push(navigation);
    try {
      const response = await page.goto(scope.baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      navigation.httpStatus = response?.status();
      navigation.route = safeUrl();
      navigation.title = diagnosticText(await page.title());
      navigation.cloudflareBlock = response?.status() === 403 && /cloudflare/i.test(await page.locator('body').innerText());
      if (navigation.cloudflareBlock) throw Error('ENVIRONMENT_FAILURE: Cloudflare HTTP 403 blocked configured entry page.');
      navigation.result = 'NAVIGATION_SUCCEEDED';
    } catch (error) {
      navigation.result = 'FAILED'; navigation.error = diagnosticText(error.message);
      navigation.captures.push(await capture('action:0', 'FAILURE')); report.failureCategory = 'ENVIRONMENT_FAILURE'; throw error;
    }
    const initial = new InitialLandingPage(page), sso = new SsoauthLoginPage(page), home = new UsEnHomePage(page);
    const initialExpression = "page.locator('header').getByRole('link', { name: 'Log In' })";
    const emailExpression = "getByRole('textbox', { name: 'Enter email' })";
    const passwordExpression = "getByRole('textbox', { name: 'Password' })";
    const submitExpression = "getByRole('button', { name: 'Log In', exact: true })";
    const headingExpression = "getByRole('heading', { name: 'My Dashboard', exact: true })";
    async function observe(key, label, po, method, expression, resolver, rawLocator, action, source, success) {
      const entry = { recordingStepKey: key, label, pageObject: po, method, locator: expression,
        executionMode: 'PAGE_OBJECT_METHOD', ...source, route: safeUrl(), captures: [await capture(key, 'PRE_STEP')] };
      const choice = owners.choices.find(item => item.key === key);
      entry.provenance = choice?.provenance || 'AUTO';
      entry.savedExecutionMode = choice?.userSelection?.executionMode || 'AUTO';
      if (key === 'action:1') entry.validationStatus = 'USER AUTHORED — NOT VALIDATED';
      report.observations.push(entry);
      let resolved = false;
      entry.locatorWaits = [];
      const operationStarted = Date.now();
      try {
        await withLocatorOperation(async () => {
        const resolutionStarted = Date.now();
        const locator = await resolver();
        entry.resolutionElapsedMs = Date.now() - resolutionStarted;
        resolved = true;
        entry.matchCount = await locator.count();
        entry.visible = entry.matchCount === 1 ? await locator.isVisible() : false;
        entry.enabled = entry.matchCount === 1 ? await locator.isEnabled() : false;
        if (entry.captures.every(item => item.unavailable)) {
          const retry = await capture(key, 'PRE_STEP');
          if (!retry.unavailable) entry.captures.push({ ...retry, phase: 'BEFORE_ACTION_AFTER_RESOLUTION' });
        }
        await action(locator);
        entry.result = success; entry.resultingRoute = safeUrl();
        entry.elapsedMs = Date.now() - operationStarted;
        }, undefined, entry.locatorWaits);
        console.log(JSON.stringify(diagnosticData({ recordingStepKey: key, label, matchCount: entry.matchCount, visible: entry.visible, enabled: entry.enabled, result: success })));
      } catch (error) {
        entry.matchCount = await rawLocator.count().catch(() => null);
        entry.visible = entry.matchCount === 1 ? await rawLocator.isVisible().catch(() => null) : false;
        entry.enabled = entry.matchCount === 1 ? await rawLocator.isEnabled().catch(() => null) : false;
        entry.result = 'FAILED'; entry.error = diagnosticText(error.message); entry.stack = diagnosticText(error.stack);
        entry.elapsedMs = Date.now() - operationStarted;
        entry.resultingRoute = safeUrl(); entry.captures.push(await capture(key, 'FAILURE'));
        report.failureCategory = error.locatorWait?.classification || (!resolved || entry.matchCount !== 1 ? 'LOCATOR_FAILURE' : key.startsWith('assertion:') ? 'ASSERTION_FAILURE' : 'ELEMENT_STATE_FAILURE');
        report.failingRecordingStepKey = key;
        throw error;
      }
    }
    await observe('action:1', 'A — initial Log In', 'InitialLandingPage', 'logIn', initialExpression,
      () => initial.logIn(), page.locator('header').getByRole('link', { name: 'Log In' }), locator => locator.click(), statement('initialLandingPage.logIn()'), 'CLICK_SUCCEEDED');
    await observe('action:2', 'B — email control', 'SsoauthLoginPage', 'enterEmailField', emailExpression,
      () => sso.enterEmailField(), page.getByRole('textbox', { name: 'Enter email' }), locator => locator.click(), statement('ssoauthLoginPage.enterEmailField()).click()'), 'CLICK_SUCCEEDED');
    await observe('action:3', 'C — fill scoped account', 'SsoauthLoginPage', 'enterEmailField', emailExpression,
      () => sso.enterEmailField(), page.getByRole('textbox', { name: 'Enter email' }), locator => locator.fill(account.email), statement('fill(appCredentials.email)'), 'FILL_SUCCEEDED');
    await observe('action:4', 'D — password control', 'SsoauthLoginPage', 'passwordField', passwordExpression,
      () => sso.passwordField(), page.getByRole('textbox', { name: 'Password' }), async () => {}, statement('fill(appCredentials.password)'), 'CONTROL_RESOLVED');
    await observe('action:4', 'E — fill scoped secret', 'SsoauthLoginPage', 'passwordField', passwordExpression,
      () => sso.passwordField(), page.getByRole('textbox', { name: 'Password' }), locator => locator.fill(account.password), statement('fill(appCredentials.password)'), 'FILL_SUCCEEDED');
    await observe('action:5', 'F — authentication Log In', 'SsoauthLoginPage', 'logInButton', submitExpression,
      () => sso.logInButton(), page.getByRole('button', { name: 'Log In', exact: true }), locator => locator.click(), statement('ssoauthLoginPage.logInButton()'), 'CLICK_SUCCEEDED');
    const redirect = { recordingStepKey: 'action:5', causedRecordingNavigationKeys: ['action:6', 'action:7', 'action:8', 'action:9'],
      label: 'G — browser-managed redirects', executionMode: 'BROWSER_CONSEQUENCE', pageObject: null, method: null,
      matchCount: null, visible: null, enabled: null, route: safeUrl(), captures: [await capture('action:5', 'PRE_STEP')] };
    report.observations.push(redirect);
    try {
      await page.waitForURL(url => url.origin === new URL(scope.baseUrl).origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
      redirect.result = 'RETURNED_TO_APPLICATION_ORIGIN'; redirect.resultingRoute = safeUrl();
    } catch (error) {
      redirect.result = 'FAILED'; redirect.error = diagnosticText(error.message); redirect.resultingRoute = safeUrl();
      redirect.captures.push(await capture('action:5', 'FAILURE')); report.failureCategory = 'NAVIGATION_FAILURE'; throw error;
    }
    await observe('assertion:0', 'H — dashboard assertion', 'UsEnHomePage', 'myDashboardState', headingExpression,
      () => home.myDashboardState(), page.getByRole('heading', { name: 'My Dashboard', exact: true }),
      locator => expect(locator).toContainText('My Dashboard'), statement('usEnHomePage.myDashboardState()'), 'ASSERTION_PASSED');
    report.liveDiagnosisPassed = true;
    report.observations.at(-1).captures.push(await capture('assertion:0', 'POST_STEP'));
  } catch (error) {
    report.error = diagnosticText(error.message);
    report.failureCategory ||= /CREDENTIAL_CONFIGURATION_FAILURE/.test(error.message) ? 'CREDENTIAL_CONFIGURATION_FAILURE' : 'OTHER';
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    const after = snapshot();
    report.artifactIntegrity = { filesBefore: Object.keys(before).length, filesAfter: Object.keys(after).length,
      changed: Object.keys(before).filter(file => before[file] !== after[file]), added: Object.keys(after).filter(file => !(file in before)) };
    report.finishedAt = new Date().toISOString();
    writeDiagnostic(path.join(output, 'after-hashes.json'), after);
    writeDiagnostic(path.join(output, 'diagnostic.json'), report);
    console.log(JSON.stringify(diagnosticData({ output, ...report }), null, 2));
  }
}
main().catch(error => { console.error(diagnosticText(error.message)); process.exitCode = 1; });
