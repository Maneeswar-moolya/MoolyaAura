/** Construct a fictional portal for isolated contract tests; never a production seed. */
import ExcelJS from 'exceljs';
import path from 'node:path';
import { FIXTURE_URL, writeFixtureFile, writeKnowledge, writeRecording, targetEvidence, type SyntheticElement } from './synthetic-data';

async function main(): Promise<void> {
  writeFixtureFile('ai/projects/registry.json', JSON.stringify({ schemaVersion: 1, applications: [{
    applicationId: 'fixtureapp', displayName: 'Fixture portal', defaultEnvironmentId: 'qa', legacyLayout: true,
    environments: { qa: { baseUrl: FIXTURE_URL, credentials: { email: 'FIXTUREAPP_EMAIL', password: 'FIXTUREAPP_PASSWORD' } } },
    workbooks: ['excel/fixture-cases.xlsx'],
  }] }));
  // Empty stores exist so tests can distinguish an empty population from a missing
  // input. Each corpus-dependent fixture must author the cases its contract needs.
  for (const dir of ['ai/dashboard/recordings/fixtureapp/accepted', 'ai/knowledge/page',
    'ai/knowledge/framework', 'tests-e2e/generated', 'ai/test-mapping'])
    writeFixtureFile(`${dir}/.gitkeep`, '');
  writeFixtureFile('ai/test-mapping/mapping.json', JSON.stringify({ TC_MAPPED: {
    testFile: 'tests-e2e/generated/TC_MAPPED.spec.ts', testName: 'TC_MAPPED - synthetic mapped case',
    module: 'Drafts', scenario: 'synthetic mapped case', status: 'Automated',
    sourceWorkbook: 'excel/fixture-cases.xlsx', sourceWorksheet: 'Contract cases', sourceRow: 2,
  } }));
  writeFixtureFile('tests-e2e/generated/TC_MAPPED.spec.ts',
    "import { test, expect } from '../fixtures';\ntest('TC_MAPPED - synthetic mapped case', async ({ page }) => { await expect(page).toHaveTitle('Synthetic'); });\n");
  writeFixtureFile('tests-e2e/synthetic-manual/legacy.spec.ts',
    "import { test, expect } from '../fixtures';\ntest('TC_MANUAL - synthetic collection input', async ({ page }) => { await expect(page).toHaveTitle('Synthetic'); });\n");
  writeFixtureFile('ai/autocode/state.json', '{}\n');
  writeFixtureFile('ai/reports/autocode-log.md', '# Synthetic fixture log\n');
  const login: SyntheticElement[] = [
    { id: 'email_field', owner: 'LoginPage', method: 'emailField', role: 'textbox', name: 'Email', label: 'Email', expression: 'page.getByRole("textbox", { name: "Email" })' },
    { id: 'password_field', owner: 'LoginPage', method: 'passwordField', role: 'textbox', label: 'Password', expression: 'page.getByRole("textbox", { name: "Password" })' },
    { id: 'sign_in_button', owner: 'LoginPage', method: 'signInButton', role: 'button', name: 'Sign In', expression: 'page.getByRole("button", { name: "Sign In", exact: true })' },
    { id: 'error_message', owner: 'LoginPage', method: 'errorMessage', expression: 'page.getByRole("alert")' },
    { id: 'language_option', owner: 'LoginPage', method: 'languageOption', params: 'name: string', expression: 'page.getByRole("option", { name: "{name}" })' },
  ];
  const apps: SyntheticElement[] = [
    { id: 'dashboard_tab', owner: 'WorkspacePage', method: 'dashboardTab', params: 'name: string', expression: 'page.getByRole("tab", { name: "{name}" })' },
    { id: 'section_header', owner: 'WorkspacePage', method: 'sectionHeader', expression: 'page.locator("#section_heading")' },
    { id: 'notifications_bell', owner: 'WorkspacePage', method: 'notificationsBell', role: 'link', name: 'Notifications', expression: 'page.getByRole("link", { name: "Notifications" })' },
    { id: 'notification_panel', owner: 'NotificationsPanel', method: 'panel', expression: 'page.locator("#notification_panel")' },
    { id: 'notification_settings', owner: 'NotificationsPanel', method: 'settingsButton', role: 'button', name: 'Notification settings', expression: 'page.getByRole("button", { name: "Notification settings" })' },
    { id: 'create_project', owner: 'ProjectsPage', method: 'createProjectButton', role: 'button', name: 'Create Project', expression: 'page.getByRole("button", { name: "Create Project" })' },
    { id: 'cancel_editor', owner: 'ProjectsPage', method: 'cancelButton', expression: 'page.locator("#cancel_editor")' },
    { id: 'editor_dialog', owner: 'ProjectsPage', expression: 'page.locator("#editor_dialog")' },
    { id: 'project_search', owner: 'ProjectsPage', method: 'projectSearchField', role: 'textbox', name: 'Search', expression: 'page.locator("#project_search")' },
  ];
  const records: SyntheticElement[] = [
    { id: 'search_field', owner: 'IssuesPage', method: 'searchField', role: 'textbox', name: 'Search', expression: 'page.locator("#record_search")' },
    { id: 'row_checkbox', owner: 'IssuesPage', method: 'issueCheckbox', params: 'description: string', usage: 'action', expression: 'page.locator(".tabulator-row").filter({ hasText: description }).locator(".rounded-checkbox-ui")' },
    { id: 'row_checkbox_state', owner: 'IssuesPage', method: 'issueCheckboxState', params: 'description: string', usage: 'assertion', expression: 'page.locator(".tabulator-row").filter({ hasText: description }).locator(".bugChecked")' },
  ];
  writeKnowledge('fixtureapp__root.yaml', '/', login, { entryPoint: 'LoginPage.open()', purpose: 'Sign in and choose a language' });
  writeKnowledge('fixtureapp__apps.yaml', '/apps', apps, { entryPoint: 'ProjectsPage.open() after sign-in', authenticated: true, purpose: 'Browse projects and notification controls' });
  writeKnowledge('fixtureapp__issues-id.yaml', '/issues/:id', records, { purpose: 'Find records and select a row' });
  const classes = new Map<string, SyntheticElement[]>();
  for (const element of [...login, ...apps, ...records])
    classes.set(element.owner, [...(classes.get(element.owner) ?? []), element]);
  const filename = (owner: string) => owner === 'NotificationsPanel' ? 'notifications.panel' : owner.replace(/Page$/, '').toLowerCase() + '.page';
  for (const [owner, elements] of classes) {
    const methods = elements.filter(element => element.method).map(element => {
      const expression = (element.expression ?? `page.locator(${JSON.stringify('#' + element.id)})`)
        .replace(/\bpage\./g, 'this.page.').replace(/(["'])\{(\w+)\}\1/g, '$2');
      return `  async ${element.method}(${element.params ?? ''}): Promise<Locator> { return ${expression}; }`;
    });
    if (owner === 'LoginPage' || owner === 'ProjectsPage')
      methods.push(`  async open(): Promise<void> { await this.page.goto(${JSON.stringify(FIXTURE_URL + (owner === 'ProjectsPage' ? 'apps' : ''))}); }`);
    if (owner === 'LoginPage') methods.push('  async signIn(email: string, password: string): Promise<void> { await (await this.emailField()).fill(email); await (await this.passwordField()).fill(password); await (await this.signInButton()).click(); }');
    if (owner === 'IssuesPage') methods.push('  async rowStatus(row: Locator): Promise<Locator> { return row.locator(".status"); }');
    writeFixtureFile(`tests-e2e/pages/${filename(owner)}.ts`, [
      '/** Synthetic Page Object for metadata and lifecycle contract tests. */',
      "import type { Locator } from '@playwright/test';", "import { BasePage } from './base.page';",
      `export class ${owner} extends BasePage {`, ...methods, '}', '',
    ].join('\n'));
  }
  writeFixtureFile('tests-e2e/pages/terms.page.ts', '/** Synthetic popup class; no fixture by design. */\nexport class TermsPage {}\n');
  const fixtures = [...classes.keys()].map(owner => [owner[0].toLowerCase() + owner.slice(1), owner]);
  writeFixtureFile('tests-e2e/fixtures.ts', [
    "import { baseTest as base, expect, trace, requireCredentials, requireEmail } from './support/base-fixtures';",
    ...[...classes.keys()].map(owner => `import { ${owner} } from './pages/${filename(owner)}';`),
    '// <page-object-imports>', 'interface Fixtures {', '  appCredentials: { email: string; password: string } | null;', '  appEmail: string | null;', '  healing: any;', '  step: any;',
    ...fixtures.map(([name, owner]) => `  ${name}: ${owner};`), '}',
    'export const test = base.extend<Fixtures>({',
    ...fixtures.map(([name, owner]) => `  ${name}: async ({ page, healing }, use) => {\n    await use(new ${owner}(page, healing));\n  },`),
    '  // <page-object-fixtures>', '});', 'export { expect, trace, requireCredentials, requireEmail };', '',
  ].join('\n'));
  writeFixtureFile('ai/knowledge/framework/framework.yaml', 'applicationId: fixtureapp\npages: {}\n');
  // Small authored corpus: positive reuse, unmeasured evidence, ambiguous ownership,
  // and two distinct values for a reusable row capability. Never a recorded customer session.
  writeRecording('TC_REUSE', ['await page.getByRole("link", { name: "Notifications" }).click();']);
  writeRecording('TC_UNMEASURED', ['await page.locator("#unmeasured_control").click();']);
  writeRecording('TC_UNPROVEN_ASSERTION', ['await expect(page.locator(".unproven-state")).toBeChecked();']);
  writeRecording('TC_DYNAMIC', ['await page.locator("#draft_900001").click();'], [
    targetEvidence('page.locator("#draft_900001")', { target: { tag: 'button', id: 'draft_900001' } }),
  ]);
  for (const suffix of ['one', 'two']) {
    const expression = `page.locator("#close_scope_${suffix}").getByRole("button", { name: "Close" })`;
    writeRecording(`TC_CLOSE_${suffix.toUpperCase()}`, [`await ${expression}.click();`], [
      targetEvidence(expression, { target: { tag: 'button', stableClasses: [`close-${suffix}`], role: 'button', accessibleName: 'Close', accessibleNameVerified: true },
        ancestors: [{ tag: 'div', id: `close_scope_${suffix}`, relationship: 'ancestor', depth: 1 }, { tag: 'div', id: 'notification_panel', relationship: 'ancestor', depth: 2 }] }),
    ]);
  }
  for (const [id, name] of [['TC_UNKNOWN_OWNER', 'Archive'], ['TC_NEW_CONTROL', 'Export']]) {
    const expression = `page.getByRole("button", { name: "${name}", exact: true })`;
    writeRecording(id, [`await page.goto("${FIXTURE_URL}apps");`, `await ${expression}.click();`], [
      targetEvidence(expression, { target: { tag: 'button', role: 'button', accessibleName: name, accessibleNameVerified: true } }),
    ]);
  }
  const search = 'page.locator("#record_search")';
  for (const id of ['TC_CANCEL_A', 'TC_CANCEL_B']) {
    const recorded = 'page.getByRole("button", { name: "Cancel" })';
    const captured = targetEvidence('page.locator("#cancel_editor")', { target: { tag: 'button', id: 'cancel_editor', role: 'button', accessibleName: 'Cancel', accessibleNameVerified: true } });
    writeRecording(id, [`await ${recorded}.click();`], [{ ...captured, locator: recorded, matchCount: 0 }]);
  }
  writeRecording('TC_SEARCH', [`await ${search}.click();`, `await ${search}.fill("Draft");`, `await expect(${search}).toHaveValue("Draft");`], [
    targetEvidence(search, { target: { tag: 'input', id: 'record_search', role: 'textbox', accessibleName: 'Search', accessibleNameVerified: true } }),
  ]);
  for (const [id, description] of [['TC_ROW_A', 'Quarterly draft for the northern region'], ['TC_ROW_B', 'Annual draft for the southern region']]) {
    const action = `page.locator(".tabulator-row").filter({ hasText: "${description}" }).locator(".rounded-checkbox-ui")`;
    const state = `page.locator(".tabulator-row").filter({ hasText: "${description}" }).locator(".bugChecked")`;
    writeRecording(id, [`await ${action}.click();`, `await expect(${state}).toBeChecked();`], [
      targetEvidence(action, { target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] } }),
      targetEvidence(state, { target: { tag: 'input', type: 'checkbox', stableClasses: ['bugChecked'] } }),
    ]);
  }
  const indexedBase = 'page.locator(".tabulator-row").filter({ hasText: "Repeated draft summary" }).locator(".rounded-checkbox-ui")';
  const indexedLocator = 'page.locator("#item_900001 .rounded-checkbox-ui")';
  writeRecording('TC_POSITION', [`await page.goto("${FIXTURE_URL}issues/100010");`, `await ${indexedLocator}.click();`], [
    targetEvidence(indexedLocator, { target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
      ancestors: [{ tag: 'div', stableClasses: ['tabulator-row'], text: 'Repeated draft summary', relationship: 'ancestor', depth: 1 }],
      derivedCandidates: [], positionProvenCandidates: [{ expression: indexedBase, strategy: 'container-text', matchCount: 3,
        identityMatched: false, sameDocument: true, measuredAt: 'press', positionWithinCandidate: 2 }] }),
  ]);
  const unprovenPosition = `${indexedBase}.nth(2)`;
  writeRecording('TC_UNPROVEN_POSITION', [`await ${unprovenPosition}.click();`], [
    targetEvidence(unprovenPosition, { target: { tag: 'span', stableClasses: ['rounded-checkbox-ui'] },
      derivedCandidates: [], matchCount: 3 }),
  ]);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contract cases');
  sheet.addRow(['Test Case ID', 'Test Scenario', 'Preconditions', 'Test Steps', 'Test Data', 'Expected Result', 'Priority', 'Module']);
  sheet.addRow(['TC_SYNTHETIC_001', 'Save a draft', 'None', 'Open the form\nClick Save', '', 'Draft saved', 'P1', 'Drafts']);
  writeFixtureFile('excel/.gitkeep', '');
  await workbook.xlsx.writeFile(path.join(process.cwd(), 'excel/fixture-cases.xlsx'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
