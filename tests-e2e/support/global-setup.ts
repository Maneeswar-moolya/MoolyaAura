/**
 * Clear per-run evidence, then refresh the data-driven cache.
 *
 * Both evidence directories accumulate one file per test. Left alone, a result
 * from an earlier run reappears in the next report - so a filtered run would
 * look like a full one, and a healed locator would be credited on a run where
 * nothing healed. Stale evidence is worse than none.
 *
 * The cache refresh is what makes data-driven rows work with no extra step.
 * Playwright runs globalSetup BEFORE it collects tests (verified against
 * 1.63.0-alpha), so a row added to the workbook is already a test by the time
 * the runner spec is imported.
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildCache, cachePathFor, writeCache } from '../../ai/excel/data-driven';
import { parseWorkbook } from '../../ai/excel/parser';
import { WORKBOOK_PATH } from './data-driven';
import { HEALING_DIR } from './resilient-locator';
import { STEPS_DIR } from './steps';

const ALLURE_RESULTS = path.resolve(process.cwd(), 'test-results-excel', 'allure-results');

export default async function globalSetup(): Promise<void> {
  fs.rmSync(HEALING_DIR, { recursive: true, force: true });
  // Step logs are per-run evidence too: a step list left from an earlier run
  // would be attributed to this one, and a filtered run would appear to have
  // walked through cases it never touched.
  fs.rmSync(STEPS_DIR, { recursive: true, force: true });
  fs.rmSync(ALLURE_RESULTS, { recursive: true, force: true });

  if (!fs.existsSync(WORKBOOK_PATH)) {
    // Remove the cache rather than leaving yesterday's copy behind: the runner
    // reports a missing cache loudly, where stale rows would run silently.
    fs.rmSync(cachePathFor(WORKBOOK_PATH), { force: true });
    process.stderr.write(`\nNo workbook at ${WORKBOOK_PATH} - data-driven rows will not run. ` +
      'Set EXCEL_WORKBOOK to point at one.\n');
    return;
  }

  const parsed = await parseWorkbook(WORKBOOK_PATH);
  const cache = buildCache(parsed, new Date().toISOString());
  writeCache(cache);

  if (cache.cases.length || cache.rejected.length) {
    process.stdout.write(`\ndata-driven: ${cache.cases.length} row(s) from ` +
      `${cache.dataDrivenSheets.join(', ') || 'no sheet'} run without a spec` +
      `${cache.rejected.length ? `; ${cache.rejected.length} row(s) have an unreadable contract` : ''}\n`);
  }
}
