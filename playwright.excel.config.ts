/**
 * Playwright config for the Excel-sourced suite.
 *
 * Deliberately separate from the repository's own playwright.config.ts. That
 * config drives the MCP server's tests and is what `npm test` and the roll
 * workflow run; mixing application tests into it would make an upstream roll
 * depend on Bugasura being reachable.
 *
 *   npm run excel:test
 *   npm run excel:test -- --grep TC_LOGIN_001
 */

import { defineConfig, devices } from '@playwright/test';

// env.ts loads .env itself (see support/load-env.ts), so importing it is all
// that is needed here - credentials are read lazily by the fixtures.
import { BASE_URL } from './tests-e2e/support/env';

export default defineConfig({
  testDir: './tests-e2e',
  // Discards healing records from the previous run so the execution report
  // never credits a heal that did not happen this time.
  globalSetup: './tests-e2e/support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Observed on 2026-08-10: my.bugasura.io returns ERR_EMPTY_RESPONSE when
  // several browsers navigate to it at once from one host, while the same
  // tests pass serially. Until that is confirmed as a rate limit and raised,
  // the suite runs one worker by default. Override once it is safe:
  //   EXCEL_WORKERS=4 npm run excel:test
  workers: Number(process.env.EXCEL_WORKERS) || 1,
  // One retry absorbs a transient network blip; it does not hide a real
  // failure, because a retried pass is reported as "flaky", not "passed".
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Deliberately NOT `test-results`: that is the upstream MCP suite's default
  // output directory, and Playwright wipes outputDir at the start of every run.
  // Sharing it means `npm test` deletes this suite's results.json and Allure
  // data, and this suite deletes upstream's traces. Keep them disjoint.
  // The HTML report also stays outside it, or the reporter clears the very
  // artifacts it is reporting on.
  outputDir: 'test-results-excel',
  reporter: [
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
        Source: 'excel/login-test-cases.xlsx',
        Workers: String(Number(process.env.EXCEL_WORKERS) || 1),
      },
    }],
  ],
  use: {
    baseURL: BASE_URL,
    // Capture defaults to failures only - evidence for a passing test is
    // usually noise, and video for a whole green suite is expensive. The
    // dashboard overrides these per run when you ask it to record everything;
    // unset, the behaviour is exactly what it has always been.
    //   EXCEL_TRACE / EXCEL_SCREENSHOT / EXCEL_VIDEO
    trace: (process.env.EXCEL_TRACE as 'on' | 'off' | 'retain-on-failure' | undefined) ?? 'retain-on-failure',
    screenshot: (process.env.EXCEL_SCREENSHOT as 'on' | 'off' | 'only-on-failure' | undefined) ?? 'only-on-failure',
    video: (process.env.EXCEL_VIDEO as 'on' | 'off' | 'retain-on-failure' | undefined) ?? 'retain-on-failure',
    actionTimeout: 15_000,
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.EXCEL_ALL_BROWSERS === '1'
      ? [
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
      ]
      : []),
  ],
});
