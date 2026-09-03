/**
 * Generated from excel/login-test-cases.xlsx :: "Login Test Cases", row 18.
 *
 * Why this is a spec and not a data-driven row: it never submits the form. The
 * shared runners open a page, fill the named fields and press one control -
 * this case opens a dropdown, picks an item out of it and reads what the
 * application did in response. `Test Data` is `email = <blank>` /
 * `password = <blank>`, i.e. no inputs at all.
 *
 * It is the Portuguese member of the family TC_LOGIN_020 (German),
 * TC_LOGIN_021 (Japanese) and TC_LOGIN_022 (Indonesian) already cover, and it
 * reuses their locators unchanged - see LoginPage's language-picker section.
 * Everything is scoped to #login_area, which is not caution: Bugasura mounts the
 * sign-in and sign-up panels together and each carries its own copy of the
 * language picker under the SAME ids, so #lang_toggle and #lang_label each
 * resolve to two elements.
 *
 * The workbook's Module cell for this row is `Login` and its Feature cell is
 * blank; nothing is inferred to fill the gap.
 */

import { expect, test, trace } from '../fixtures';

/**
 * What the sign-in form says in each language. Read off my.bugasura.io on
 * 2026-08-11, not translated.
 *
 * Portuguese is `data-lang-code="POR"`; choosing it reloads the form as
 * "E-mail / Senha / Esqueceu a senha? / Entrar" and re-renders the picker's own
 * heading as "Selecione o idioma".
 */
const SIGN_IN_IN_ENGLISH = /^\s*Sign\s*In\s*$/i;
const SIGN_IN_IN_PORTUGUESE = /^\s*Entrar\s*$/i;
const SELECT_LANGUAGE_IN_PORTUGUESE = /^\s*Selecione\s+o\s+idioma\s*$/i;
const SIGN_IN_IN_ITALIAN = /^\s*Accedi\s*$/i;
const SELECT_LANGUAGE_IN_ITALIAN = /^\s*Seleziona\s+la\s+lingua\s*$/i;

// Read off my.bugasura.io on 2026-08-15 (not previously in the page-knowledge
// file - this test is what verified them). Russian is `data-lang-name="Russian"`;
// choosing it reloads the form with the sign-in button reading "Войти" and the
// picker's own heading re-rendered as "Выберите язык".
const SIGN_IN_IN_RUSSIAN = /^\s*Войти\s*$/i;
const SELECT_LANGUAGE_IN_RUSSIAN = /^\s*Выберите\s+язык\s*$/i;

test.describe('Login', () => {
  test('TC_LOGIN_024 - Check Portuguese language', async ({ loginPage, step }) => {
    await trace({
      testCaseId: 'TC_LOGIN_024',
      module: 'Login',
      scenario: 'Check Portuguese language',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
      priority: 'P0',
    });

    // Step 1
    await step('Open Bugasura login page', () => loginPage.open());

    // Resolved while the English page is still standing, and deliberately not
    // re-resolved afterwards: choosing a language makes Bugasura reload itself
    // (/?go=login) in the new one. A Locator re-queries on every assertion, so
    // these survive that navigation, while calling the page object again could
    // race it. The retrying assertions below are what wait the reload out -
    // there is no fixed sleep and no URL to couple to.
    const languageLabel = await loginPage.selectedLanguageLabel();
    const activeOption = await loginPage.activeLanguageOption();
    const signInButton = await loginPage.localisedSignInButton();
    const selectLanguageHeading = await loginPage.languageMenuHeading();

    // Asserted, not assumed. If this browser arrived already in Portuguese - a
    // leaked savedLanguageCode cookie does exactly that; it is set to `por` the
    // moment the option is clicked - then "Portuguese is selected" at the end
    // would prove nothing about the click. The run fails here instead, saying
    // why.
    await step('The login page is in English to begin with', async () => {
      await expect(languageLabel).toHaveText(/^\s*English\s*$/i, { timeout: 30_000 });
      await expect(activeOption).toHaveAttribute('data-lang-name', 'English');
      await expect(signInButton).toHaveText(SIGN_IN_IN_ENGLISH);
    });

    // "Select Language" ships in the DOM from page load with the menu around it
    // display:none, so visibility - never presence - is the signal it opened.
    await step('The language picker is not open yet', async () => {
      await expect(selectLanguageHeading).toBeHidden();
    });

    // Step 2, first half: "click on language". The toggle is the globe button,
    // whose label is the current language - which is why the page object finds
    // it by its behavioural `js-` class and not by its accessible name.
    await step('Click on language', async () => {
      await (await loginPage.languageToggle()).click();
    });

    // That the picker actually opened, before anything is chosen from it. In
    // English on purpose: the heading reads "Select Language" while English is
    // in effect and becomes "Selecione o idioma" only after the reload below.
    await step('The Select Language picker is open', async () => {
      await expect(selectLanguageHeading,
          'The picker is open when its "Select Language" heading is on screen inside #login_area')
          .toBeVisible();
      await expect(selectLanguageHeading).toHaveText(/^\s*Select\s*Language\s*$/i);
    });

    // Step 2, second half: "change it to Portuguese". The picker lists the
    // languages by their English names, so "Portuguese" is the application's own
    // identifier for this row (data-lang-name, code POR) and not a translation
    // that could drift.
    await step('Change it to Portuguese', async () => {
      await (await loginPage.languageOption('Portuguese')).click();
    });

    // Step 3 / Expected result: "Check language got changed to Portuguese".
    //
    // Four assertions, because the first two alone only prove the widget redrew
    // itself. The form copy is what proves the choice reached the application:
    // the button reads "Sign In" on arrival and "Entrar" once Portuguese is in
    // effect, which is why it is asserted before AND after. The picker's own
    // heading is the second such witness - re-rendered as "Selecione o idioma"
    // by the reload, and asserted on text rather than visibility because the
    // reload closes the menu.
    //
    // Note the label reading "Portuguese" rather than "Português" is correct and
    // is not evidence of a failed translation: the picker names languages in
    // English by design.
    //
    // If Bugasura ships different Portuguese copy for either, that is a change
    // to report - not a reason to loosen these regexes, because "any text at
    // all" holds in every language including English.
    await step('Check language got changed to Portuguese', async () => {
      await expect(languageLabel,
          'The language picker should now name Portuguese')
          .toHaveText(/^\s*Portuguese\s*$/i, { timeout: 30_000 });
      await expect(activeOption,
          'Portuguese should be the row the picker marks as selected')
          .toHaveAttribute('data-lang-name', 'Portuguese');
      await expect(signInButton,
          'The sign-in form should be rendered in Portuguese - the button reads "Entrar"')
          .toHaveText(SIGN_IN_IN_PORTUGUESE);
      await expect(selectLanguageHeading,
          'The picker heading should be rendered in Portuguese - "Selecione o idioma"')
          .toHaveText(SELECT_LANGUAGE_IN_PORTUGUESE);
    });
  });

  test('TC_LOGIN_058 - check italian language and check sign in', async ({ loginPage, step }) => {
    await trace({
      testCaseId: 'TC_LOGIN_058',
      module: 'Login',
      scenario: 'check italian language and check sign in',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
      priority: 'P0',
    });

    // Step 1
    await step('Open bugasura login page', () => loginPage.open());

    // Resolved before the picker is touched, for the same reason TC_LOGIN_024
    // resolves them early: choosing a language reloads the page (/?go=login),
    // and a Locator re-queries across that reload while calling the page
    // object again could race it.
    const languageLabel = await loginPage.selectedLanguageLabel();
    const activeOption = await loginPage.activeLanguageOption();
    const signInButton = await loginPage.localisedSignInButton();
    const selectLanguageHeading = await loginPage.languageMenuHeading();

    // Asserted, not assumed - a leaked savedLanguageCode cookie could already
    // have the page in Italian, which would make "the button is in Italian" at
    // the end prove nothing about this test's own click.
    await step('The login page is in English to begin with', async () => {
      await expect(languageLabel).toHaveText(/^\s*English\s*$/i, { timeout: 30_000 });
      await expect(activeOption).toHaveAttribute('data-lang-name', 'English');
      await expect(signInButton).toHaveText(SIGN_IN_IN_ENGLISH);
    });

    // Step 2, first half: "click on language options".
    await step('Click on language options', async () => {
      await (await loginPage.languageToggle()).click();
    });

    await step('The Select Language picker is open', async () => {
      await expect(selectLanguageHeading,
          'The picker is open when its "Select Language" heading is on screen inside #login_area')
          .toBeVisible();
    });

    // Step 2, second half: "select italian". The picker lists languages by
    // their English names (data-lang-name="Italian", code ITA), which is the
    // application's own identifier and not a translation that could drift.
    await step('Select Italian', async () => {
      await (await loginPage.languageOption('Italian')).click();
    });

    // Step 3 / Expected result: "check sign button language should be in
    // italian". The button reads "Sign In" on arrival and "Accedi" once
    // Italian takes effect, which is the direct witness the row asks for; the
    // label and picker heading are asserted alongside it for the same reason
    // TC_LOGIN_024 asserts them - proving the choice reached the application,
    // not just that the widget redrew itself.
    await step('Check sign button language should be in italian', async () => {
      await expect(signInButton,
          'The sign-in button should be rendered in Italian - it should read "Accedi"')
          .toHaveText(SIGN_IN_IN_ITALIAN);
      await expect(languageLabel,
          'The language picker should now name Italian')
          .toHaveText(/^\s*Italian\s*$/i, { timeout: 30_000 });
      await expect(activeOption,
          'Italian should be the row the picker marks as selected')
          .toHaveAttribute('data-lang-name', 'Italian');
      await expect(selectLanguageHeading,
          'The picker heading should be rendered in Italian - "Seleziona la lingua"')
          .toHaveText(SELECT_LANGUAGE_IN_ITALIAN);
    });
  });

  test('TC_LOGIN_062 - check russian , itialian language is working', async ({ loginPage, step }) => {
    await trace({
      testCaseId: 'TC_LOGIN_062',
      module: 'Login',
      scenario: 'check russian , itialian language is working',
      sourceWorkbook: 'login-test-cases.xlsx',
      sourceWorksheet: 'Login Test Cases',
      priority: 'P0',
    });

    // Step 1
    await step('Open bugasura login page', () => loginPage.open());

    // Resolved before the picker is touched, for the same reason TC_LOGIN_058
    // resolves them early: choosing a language reloads the page (/?go=login),
    // and a Locator re-queries across that reload while calling the page
    // object again could race it. Reused for both languages below.
    const languageLabel = await loginPage.selectedLanguageLabel();
    const activeOption = await loginPage.activeLanguageOption();
    const signInButton = await loginPage.localisedSignInButton();
    const selectLanguageHeading = await loginPage.languageMenuHeading();

    // Asserted, not assumed - a leaked savedLanguageCode cookie could already
    // have the page in another language, which would make the assertions below
    // prove nothing about this test's own clicks.
    await step('The login page is in English to begin with', async () => {
      await expect(languageLabel).toHaveText(/^\s*English\s*$/i, { timeout: 30_000 });
      await expect(activeOption).toHaveAttribute('data-lang-name', 'English');
      await expect(signInButton).toHaveText(SIGN_IN_IN_ENGLISH);
    });

    // Step 2: "click language options and select russian and asserts it".
    await step('Click on language options', async () => {
      await (await loginPage.languageToggle()).click();
    });

    await step('The Select Language picker is open', async () => {
      await expect(selectLanguageHeading,
          'The picker is open when its "Select Language" heading is on screen inside #login_area')
          .toBeVisible();
    });

    await step('Select Russian', async () => {
      await (await loginPage.languageOption('Russian')).click();
    });

    // Four assertions, same reasoning as TC_LOGIN_058: the button copy and the
    // picker's own heading prove the choice reached the application, not just
    // that the widget redrew itself.
    await step('Assert Russian is selected', async () => {
      await expect(signInButton,
          'The sign-in button should be rendered in Russian - it should read "Войти"')
          .toHaveText(SIGN_IN_IN_RUSSIAN);
      await expect(languageLabel,
          'The language picker should now name Russian')
          .toHaveText(/^\s*Russian\s*$/i, { timeout: 30_000 });
      await expect(activeOption,
          'Russian should be the row the picker marks as selected')
          .toHaveAttribute('data-lang-name', 'Russian');
      await expect(selectLanguageHeading,
          'The picker heading should be rendered in Russian - "Выберите язык"')
          .toHaveText(SELECT_LANGUAGE_IN_RUSSIAN);
    });

    // Step 3: "click language options and select itilian and ckeck it". The
    // reload after choosing Russian closes the menu, so it is opened again
    // from its now-Russian state.
    await step('Click on language options again', async () => {
      await (await loginPage.languageToggle()).click();
    });

    await step('The Select Language picker is open again', async () => {
      await expect(selectLanguageHeading,
          'The picker should be open again, now showing its Russian heading')
          .toBeVisible();
    });

    await step('Select Italian', async () => {
      await (await loginPage.languageOption('Italian')).click();
    });

    await step('Assert Italian is selected', async () => {
      await expect(signInButton,
          'The sign-in button should be rendered in Italian - it should read "Accedi"')
          .toHaveText(SIGN_IN_IN_ITALIAN);
      await expect(languageLabel,
          'The language picker should now name Italian')
          .toHaveText(/^\s*Italian\s*$/i, { timeout: 30_000 });
      await expect(activeOption,
          'Italian should be the row the picker marks as selected')
          .toHaveAttribute('data-lang-name', 'Italian');
      await expect(selectLanguageHeading,
          'The picker heading should be rendered in Italian - "Seleziona la lingua"')
          .toHaveText(SELECT_LANGUAGE_IN_ITALIAN);
    });
  });
});
