/**
 * Data-driven Login runner - no code is written per test case.
 *
 * @data-driven-module: Login
 *
 * Every row in the workbook that names the Login module and declares an
 * `Assert Outcome` becomes a test here. Adding a case is a spreadsheet edit:
 * no spec to write, no mapping to update by hand, no agent involved.
 *
 * The trade is deliberate. This file owns the *actions* - open the sign-in
 * page, fill the named fields, submit - and the workbook owns the *data* and
 * the *assertion*. That covers a family of cases that differ only in those two
 * things. Anything with different actions (Forgot Password, a boundary probe
 * that reads a DOM attribute) still needs a hand-written spec, and belongs in
 * login.spec.ts.
 *
 * The marker comment above is read by `excel:mapping sync`, which is how these
 * runtime-generated tests get into ai/test-mapping/mapping.json - the title
 * scanner cannot see them, because their titles do not exist in this source.
 */

import { expect, test, trace } from '../fixtures';
import { describeMatcher, loadDataDriven, messageMatches, resolveInputs } from '../support/data-driven';
import { assertAllVisible, expectedItems } from '../support/generic-form';

const MODULE = 'Login';

/**
 * Refreshed by globalSetup before Playwright collects tests, so a row added to
 * the workbook is a running test on the very next command.
 */
const cache = loadDataDriven();

/** Field names this runner knows how to enter. Anything else is an authoring error. */
const KNOWN_INPUTS = new Set(['email', 'password']);

/**
 * Not a field, but the contract for `Assert Outcome = Visible`.
 *
 * `url`, `scope` and `submit` stay unknown on purpose: this runner hard-codes
 * the sign-in page and its button, so honouring them is impossible and ignoring
 * them silently would make a row read as if it had been obeyed.
 */
const CONTRACT_INPUTS = new Set(['expect']);

const forThisModule = <T extends { module: string }>(rows: T[]): T[] =>
  rows.filter(row => row.module.trim().toLowerCase() === MODULE.toLowerCase());

test.describe('Login - data-driven from the workbook', () => {
  if (!cache) {
    // Not a silent skip: without the cache the workbook's rows are simply not
    // running, and a report that omits them would look like a clean run.
    test('data-driven cache is missing', () => {
      throw new Error(
          'No data-driven cache was found. It is normally written by globalSetup; ' +
          'run `npm run excel:sync-data -- <workbook>` to build it by hand.');
    });
  }

  // A row that declared a contract and got it wrong must fail loudly. Skipping
  // it would hide an authoring mistake behind a green run.
  for (const row of forThisModule(cache?.rejected ?? [])) {
    test(`${row.testCaseId} - ${row.scenario || 'Unreadable data-driven row'}`, () => {
      throw new Error(
          `${row.worksheet} row ${row.row} declares a data-driven contract that cannot be read.\n  ${row.reason}`);
    });
  }

  for (const testCase of forThisModule(cache?.cases ?? [])) {
    test(`${testCase.testCaseId} - ${testCase.scenario}`, async ({ loginPage, workspacePage, page, step }) => {
      await trace({
        testCaseId: testCase.testCaseId,
        module: testCase.module,
        scenario: testCase.scenario,
        sourceWorkbook: cache!.workbook,
        sourceWorksheet: testCase.worksheet,
        priority: testCase.priority,
      });

      const unknown = Object.keys(testCase.inputs)
          .filter(name => !KNOWN_INPUTS.has(name) && !CONTRACT_INPUTS.has(name));
      expect(unknown, `${testCase.worksheet} row ${testCase.row}: this runner can enter ` +
        `${[...KNOWN_INPUTS].join(' and ')}, not ${unknown.join(', ')}`).toEqual([]);

      const { values, missing } = resolveInputs(testCase.inputs);
      test.skip(missing.length > 0,
          `${missing.join(', ')} not set - this row needs it. See .env.example.`);

      await step('Open the Bugasura sign-in page', () => loginPage.open());
      await step('Enter the email for this case', async () => {
        await (await loginPage.emailField()).fill(values.email ?? '');
      });
      await step('Enter the password for this case', async () => {
        await (await loginPage.passwordField()).fill(values.password ?? '');
      });
      await step('Click Sign In', async () => {
        await (await loginPage.signInButton()).click();
      });

      const expectation = `Workbook says: "${testCase.expectedResult || testCase.outcome}"`;

      // Visible is Signed In plus the items: getting in is a precondition of
      // seeing anything on the far side of the door, so the two share this
      // branch. Without it a Visible row fell through to the Blocked
      // assertions below and failed for a reason that had nothing to do with
      // the case - which made "use Assert Outcome = Visible" advice that did
      // not work for the one module with a runner of its own.
      if (testCase.outcome === 'Signed In' || testCase.outcome === 'Visible') {
        await step('Bugasura signs the user in', async () => {
          // Wait for whichever comes first. Quoting Bugasura's own rejection beats
          // a bare timeout, because "account does not exist" and "invalid
          // password" call for completely different follow-up.
          let observed = '';
          for (let attempt = 0; attempt < 40 && !observed; attempt++) {
            observed = (await workspacePage.isSignedIn()) ? 'signed-in' : await loginPage.currentErrorText();
            if (!observed)
              await page.waitForTimeout(500);
          }
          expect(observed, `${expectation}\n  Bugasura said: "${observed || 'nothing at all'}"`).toBe('signed-in');
        });

        if (testCase.outcome === 'Visible') {
          const wanted = expectedItems(values.expect ?? '');
          await step(`These are on the page: ${wanted.join(', ')}`, async () => {
            const missing = await assertAllVisible(page, wanted);
            expect(missing, `${expectation}\n  Expected these on the page after signing in: ` +
              `${wanted.join(', ')}.\n  Not found: ${missing.join(', ')}\n  Page: ${page.url()}`).toEqual([]);
          });
        }
        return;
      }

      if (testCase.outcome === 'Error') {
        await step(`Bugasura rejects it with ${describeMatcher(testCase.message)}`, async () => {
          const observed = await loginPage.errorText();
          expect(observed, `${expectation}\n  Expected ${describeMatcher(testCase.message)}, got ` +
            `"${observed || 'no message at all'}"`).not.toBe('');
          expect(messageMatches(testCase.message, observed),
              `${expectation}\n  Expected ${describeMatcher(testCase.message)}, got "${observed}"`).toBe(true);
        });
        await step('The user stays on the sign-in page', async () => {
          expect(await loginPage.isOnLoginPage(),
              'Rejected sign-in must leave the user on the login page').toBe(true);
        });
        return;
      }

      // Blocked: the form refused it client-side. A short wait is enough to be
      // sure no toast is coming - waiting the full error timeout would add
      // eight idle seconds to every such row.
      await step('The form refuses it client-side, with no message', async () => {
        const toast = await loginPage.errorText(2500);
        expect(toast, `${expectation}\n  Expected the form to block this client-side, but the ` +
          `application responded with "${toast}". Use Assert Outcome = Error for a row that ` +
          'produces a message.').toBe('');
        expect(await loginPage.isOnLoginPage(), 'A blocked submission must not navigate').toBe(true);
      });
      await step('Something on the form tells the user why', async () => {
        expect(await loginPage.hasValidationSignal(),
            `${expectation}\n  No validation signal appeared on the sign-in form, so nothing ` +
            'told the user why the submission did not proceed.').toBe(true);
      });
    });
  }
});
