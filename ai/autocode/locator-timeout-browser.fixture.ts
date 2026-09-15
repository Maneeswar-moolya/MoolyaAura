import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { BasePage } from '../../tests-e2e/pages/base.page';
import { expect, LocatorDeadline, withLocatorOperation, LOCATOR_TIMEOUT_MS } from '../../tests-e2e/support/locator-policy';
import { resolveField, resolveSubmit } from '../../tests-e2e/support/generic-form';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  class Controls extends BasePage {
    field() { return this.resolve('auth.account', [{ strategy: 'label Account', build: page => page.getByLabel('Account') }]); }
    heading() { return this.resolve('screen.heading', [{ strategy: 'heading Ready', build: page => page.getByRole('heading', { name: 'Ready', exact: true }) }]); }
    manual() { return this.page.getByRole('button', { name: 'Save', exact: true }); }
  }
  const controls = new Controls(page);
  let checks = 0;
  const check = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); checks++; console.log('PASS ' + label); } catch (error) { console.error('FAIL ' + label); throw error; }
  };
  try {
    await page.setContent('<label>Account<input></label><button>Save</button><div id="out"></div>');
    await check('immediate Page Object and USER_CONFIRMED manual actions do not wait', async () => {
      const started = Date.now();
      await withLocatorOperation(async () => { await (await controls.field()).fill('synthetic'); await controls.manual().click(); });
      assert.ok(Date.now() - started < 2000); await expect(page.getByLabel('Account')).toHaveValue('synthetic');
    });
    await check('state hydration is observed without a fixed sleep', async () => {
      await page.evaluate(() => { document.body.setAttribute('aria-busy', 'true'); setTimeout(() => {
        document.querySelector('#out')!.innerHTML = '<h1>Ready</h1>'; document.body.removeAttribute('aria-busy');
      }, 550); });
      const started = Date.now(); await withLocatorOperation(async () => { await expect(await controls.heading()).toHaveText('Ready'); });
      assert.ok(Date.now() - started >= 300 && Date.now() - started < 2500);
    });
    await check('assertion uses only remaining operation budget', async () => {
      let elapsed = 0;
      const deadline = new LocatorDeadline({ now: () => elapsed, wait: async ms => { elapsed += ms; } });
      elapsed = LOCATOR_TIMEOUT_MS - 150;
      const started = Date.now();
      await assert.rejects(() => withLocatorOperation(async () => { await expect(await controls.heading()).toHaveText('Different'); }, deadline));
      assert.ok(Date.now() - started < 1800, 'assertion must not receive a fresh forty seconds');
    });
    await check('select checkbox radio press and hover use normal actionability', async () => {
      await page.locator('#out').evaluate(node => { node.innerHTML += '<label>Accept<input type="checkbox"></label><label>Choice<input type="radio"></label><label>Language<select><option value="en">English</option><option value="fr">French</option></select></label>'; });
      await withLocatorOperation(async () => {
        await page.getByLabel('Accept').check(); await page.getByLabel('Choice').check();
        await page.getByLabel('Language').selectOption('fr'); await page.getByLabel('Account').press('Tab');
        await controls.manual().hover();
        await expect(page.getByLabel('Accept')).toBeChecked(); await expect(page.getByLabel('Choice')).toBeChecked();
        await expect(page.getByLabel('Language')).toHaveValue('fr');
      });
    });
    await check('generic data-driven fields and submit retain their declared candidates', async () => {
      await withLocatorOperation(async () => {
        const field = await resolveField(page, undefined, 'Account'); await field.fill('synthetic-generic');
        await (await resolveSubmit(page, undefined, 'Save')).click(); await expect(field).toHaveValue('synthetic-generic');
      });
    });
    await check('manual and recorded-locator action uses only remaining operation budget', async () => {
      for (const locator of [controls.manual(), page.getByLabel('Account')]) {
        await page.evaluate(() => document.querySelectorAll('input,button').forEach(element => (element as HTMLInputElement).disabled = true));
        let elapsed = 0; const deadline = new LocatorDeadline({ now: () => elapsed, wait: async ms => { elapsed += ms; } });
        elapsed = LOCATOR_TIMEOUT_MS - 150;
        const started = Date.now();
        await assert.rejects(() => withLocatorOperation(async () => locator === undefined ? undefined : locator.click(), deadline));
        assert.ok(Date.now() - started < 1800, 'manual execution cannot gain another forty seconds');
      }
    });
    await check('negative and attribute assertions preserve matcher behavior', async () => {
      await expect(page.getByRole('heading')).not.toHaveText('Other');
      await expect(page.getByRole('heading')).toHaveAttribute('role', { timeout: 30 }).then(() => assert.fail('missing attribute must fail'), () => {});
      await expect(page.getByRole('heading')).toBeVisible();
    });
    console.log(`PASS ${checks} browser runtime timeout contracts`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
