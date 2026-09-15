/**
 * Playwright config for the Excel-sourced suite.
 *
 * Deliberately separate from the repository's own playwright.config.ts. That
 * config drives the MCP server's tests and is what `npm test` and the roll
 * workflow run; mixing application tests into it would make an upstream roll
 * depend on a configured application being reachable.
 *
 *   npm run excel:test
 *   npm run excel:test -- --grep TC_LOGIN_001
 */

import { defineConfig, devices } from '@playwright/test';
import { LOCATOR_TIMEOUT_MS } from './tests-e2e/support/locator-policy';

// env.ts loads .env itself (see support/load-env.ts), so importing it is all
// that is needed here - credentials are read lazily by the fixtures.
import { BASE_URL } from './tests-e2e/support/env';
import { collectionIgnoreFor } from './tests-e2e/support/collection-scope';
import { executionContextFromTransport, executionSelectionFromTransport } from './ai/projects/execution-context';
import { activeScope } from './ai/projects/scope';
const executionContext = process.env.AURA_EXECUTION_CONTEXT
  ? executionContextFromTransport(activeScope(),executionSelectionFromTransport()) : undefined;

export default defineConfig({
  testDir: './tests-e2e',
  /**
   * COLLECTION IS SCOPED TO ONE APPLICATION, BECAUSE `--grep` IS NOT.
   *
   * `excel:run` and the falsification gate both run Playwright as
   * `test --grep <TC_ID>` with no path restriction, and `testDir` is the whole
   * suite. A Test Case ID is unique WITHIN an application and deliberately
   * reusable across them - `alpha/TC_SAME` and `beta/TC_SAME`
   * are different cases - so with two applications collected at once that grep
   * matches two tests, runs both, and `results.ts` (which recovers the ID from
   * the test TITLE) attributes them to one workbook row.
   *
   * So the collection is narrowed to the active application before the grep is
   * applied. Registry cardinality never grants ownership.
   */
  testIgnore: collectionIgnoreFor(),
  // Discards healing records from the previous run so the execution report
  // never credits a heal that did not happen this time.
  globalSetup: './tests-e2e/support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Conservative default; EXCEL_WORKERS explicitly controls concurrency.
  workers: Number(process.env.EXCEL_WORKERS) || 1,
  // One retry absorbs a transient network blip; it does not hide a real
  // failure, because a retried pass is reported as "flaky", not "passed".
  retries: 1,
  timeout: 60_000,
  expect: { timeout: LOCATOR_TIMEOUT_MS },
  // Deliberately NOT `test-results`: that is the upstream MCP suite's default
  // output directory, and Playwright wipes outputDir at the start of every run.
  // Sharing it means `npm test` deletes this suite's results.json and Allure
  // data, and this suite deletes upstream's traces. Keep them disjoint.
  // The HTML report also stays outside it, or the reporter clears the very
  // artifacts it is reporting on.
  outputDir: 'test-results-excel',
  reporter: process.env.AURA_EXECUTION_SELECTION ? [['./ai/test-data/reporter.ts']] : [
    ['list'],
    // The execution report generator reads this file.
    ['json', { outputFile: 'test-results-excel/results.json' }],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
    ['allure-playwright', {
      resultsDir: 'test-results-excel/allure-results',
      detail: true,
      environmentInfo: {
        Application: BASE_URL,
        Suite: 'Excel-sourced test cases',
        Source: process.env.EXCEL_WORKBOOK || 'Selected application workbook',
        Workers: String(Number(process.env.EXCEL_WORKERS) || 1),
      },
    }],
  ],
  use: {
    ...(executionContext ? {headless:!executionContext.headed} : {}),
    baseURL: BASE_URL,
    // Capture defaults to failures only - evidence for a passing test is
    // usually noise, and video for a whole green suite is expensive. The
    // dashboard overrides these per run when you ask it to record everything;
    // unset, the behaviour is exactly what it has always been.
    //   EXCEL_TRACE / EXCEL_SCREENSHOT / EXCEL_VIDEO
    trace: process.env.AURA_EXECUTION_SELECTION ? 'off' : process.env.AURA_DIAGNOSTICS === '1' ? {mode:'on',screenshots:false,snapshots:false,sources:false}
      : (process.env.EXCEL_TRACE as 'on' | 'off' | 'retain-on-failure' | undefined) ?? 'retain-on-failure',
    screenshot: process.env.AURA_EXECUTION_SELECTION ? 'off' : (process.env.EXCEL_SCREENSHOT as 'on' | 'off' | 'only-on-failure' | undefined) ?? 'only-on-failure',
    video: process.env.AURA_EXECUTION_SELECTION ? 'off' : (process.env.EXCEL_VIDEO as 'on' | 'off' | 'retain-on-failure' | undefined) ?? 'retain-on-failure',
    actionTimeout: LOCATOR_TIMEOUT_MS,
  },
  // Chromium is the only project by default, deliberately.
  //
  // Adding firefox and webkit unconditionally would make a bare `excel:test`
  // run every case three times and open three browsers against a live product
  // that already refuses concurrent navigation. They are opt-in instead, which
  // keeps the default path byte-for-byte what it was:
  //
  //   EXCEL_ALL_BROWSERS=1 npm run excel:test -- --project=firefox
  //
  // The dashboard sets this itself when you pick a non-Chromium browser.
  // Install them first: npx playwright install firefox webkit
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...(executionContext?.browserChannel ? {channel:executionContext.browserChannel} : {}) } },
    ...(process.env.EXCEL_ALL_BROWSERS === '1'
      ? [
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
      ]
      : []),
  ],
});
