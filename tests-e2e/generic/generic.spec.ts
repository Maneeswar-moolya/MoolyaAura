/**
 * The catch-all data-driven runner — every module, no spec written.
 *
 * @data-driven-module: *
 *
 * A module with its own runner (Login) keeps it: that spec knows the screen and
 * can assert things a generic driver cannot. Everything else lands here, so a
 * case added from the dashboard for a module nobody has coded is runnable the
 * moment it is saved.
 *
 * The row supplies what a per-module spec would have hard-coded:
 *
 *     url    = /apps            where to start (default: BASE_URL)
 *     scope  = #createForm      confine lookups to one form (optional)
 *     submit = Create           the control to press (optional)
 *     <any other name>          a field, found by the name a person would use
 *
 * The wildcard is deliberately last in precedence. If a module later gets a real
 * runner, its rows move there automatically and nothing here changes.
 */

import path from 'node:path';

import { scanDataDrivenRunners } from '../../ai/excel/mapping';
import { expect, baseTest as test, trace } from '../support/base-fixtures';
import { describeMatcher, loadDataDriven, messageMatches, resolveInputs } from '../support/data-driven';
import { BASE_URL } from '../support/env';
import {
  assertAllVisible,
  expectedItems,
  hasValidationSignal,
  observedMessage,
  RESERVED_INPUTS,
  submitForm,
  wasAccepted,
} from '../support/generic-form';

const cache = loadDataDriven();

/**
 * Modules that already have a dedicated runner. Read synchronously at collection
 * time from the specs themselves, so adding a module runner tomorrow moves its
 * rows off this one with no bookkeeping.
 */
const claimed = new Set(
    scanDataDrivenRunners(path.resolve(process.cwd(), 'tests-e2e'))
        .filter(runner => runner.module.trim() !== '*')
        .map(runner => runner.module.trim().toLowerCase()));

const mine = <T extends { module: string }>(rows: T[]): T[] =>
  rows.filter(row => !claimed.has(row.module.trim().toLowerCase()));

test.describe('Data-driven (any module)', () => {
  for (const row of mine(cache?.rejected ?? [])) {
    test(`${row.testCaseId} - ${row.scenario || 'Unreadable data-driven row'}`, () => {
      throw new Error(
          `${row.worksheet} row ${row.row} declares a data-driven contract that cannot be read.\n  ${row.reason}`);
    });
  }

  for (const testCase of mine(cache?.cases ?? [])) {
    test(`${testCase.testCaseId} - ${testCase.scenario}`, async ({ page, step }) => {
      await trace({
        testCaseId: testCase.testCaseId,
        module: testCase.module,
        scenario: testCase.scenario,
        sourceWorkbook: cache!.workbook,
        sourceWorksheet: testCase.worksheet,
        priority: testCase.priority,
      });

      const { values, missing } = resolveInputs(testCase.inputs);
      test.skip(missing.length > 0,
          `${missing.join(', ')} not set - this row needs it. See .env.example.`);

      const fields = Object.keys(values).filter(name => !RESERVED_INPUTS.has(name));
      expect(fields.length,
          `${testCase.worksheet} row ${testCase.row} names no fields to fill. Add at least one ` +
          '"name = value" line to Test Data.').toBeGreaterThan(0);

      // The step names are what the dashboard shows, so they are written the
      // way the workbook row reads rather than the way the code runs.
      const run = await step(
          `Open ${values.url || BASE_URL} and enter ${fields.join(', ')}, then submit`,
          () => submitForm(page, values, {
            url: values.url,
            scope: values.scope,
            submit: values.submit,
            baseUrl: BASE_URL,
          }));

      const expectation = `Workbook says: "${testCase.expectedResult || testCase.outcome}"`;

      if (testCase.outcome === 'Signed In' || testCase.outcome === 'Visible') {
        await step('The submission is accepted and the page moves on', async () => {
          const accepted = await wasAccepted(page, run);
          const message = accepted ? '' : await observedMessage(page, 500);
          expect(accepted, `${expectation}\n  The submission was not accepted. ` +
            `The application said: "${message || 'nothing at all'}"`).toBe(true);
        });

        if (testCase.outcome === 'Visible') {
          const wanted = expectedItems(values.expect ?? '');
          await step(`These are on the page: ${wanted.join(', ')}`, async () => {
            const missing = await assertAllVisible(page, wanted);
            expect(missing, `${expectation}\n  Expected these to be on the page after the ` +
              `submission: ${wanted.join(', ')}.\n  Not found: ${missing.join(', ')}\n` +
              `  Page: ${page.url()}`).toEqual([]);
          });
        }
        return;
      }

      if (testCase.outcome === 'Error') {
        await step(`The application rejects it with ${describeMatcher(testCase.message)}`, async () => {
          const observed = await observedMessage(page);
          expect(observed, `${expectation}\n  Expected ${describeMatcher(testCase.message)}, got ` +
            `"${observed || 'no message at all'}"`).not.toBe('');
          expect(messageMatches(testCase.message, observed),
              `${expectation}\n  Expected ${describeMatcher(testCase.message)}, got "${observed}"`).toBe(true);
        });
        return;
      }

      // Blocked: refused client-side. A short wait is enough to be sure no
      // message is coming; waiting the full error timeout would add eight idle
      // seconds to every such row.
      await step('The form refuses it client-side, with no message', async () => {
        const message = await observedMessage(page, 2500);
        expect(message, `${expectation}\n  Expected the form to block this client-side, but the ` +
          `application responded with "${message}". Use Assert Outcome = Error for a row that ` +
          'produces a message.').toBe('');
        expect(page.url(), 'A blocked submission must not navigate').toBe(run.urlBefore);
      });
      await step('Something on the form tells the user why', async () => {
        expect(await hasValidationSignal(page, values.scope),
            `${expectation}\n  No validation signal appeared, so nothing told the user why the ` +
            'submission did not proceed.').toBe(true);
      });
    });
  }
});
