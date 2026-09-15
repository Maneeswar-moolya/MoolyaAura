/** Isolated authoring workspace data. Call only inside the guarded contract worker. */
import fs from 'node:fs';
import path from 'node:path';
import { writeFixtureFile, writeKnowledge, targetEvidence, recordingSource, measurement } from './synthetic-data';
import { resolveScope, resetActiveScope } from '../projects/scope';
import { resetActiveApplication } from '../knowledge/canonical';
import { parseRecording } from '../dashboard/recorder';
export function workspaceData() {
  writeFixtureFile('ai/projects/registry.json', JSON.stringify({ schemaVersion: 1, applications: ['north','south'].map(applicationId => ({
    applicationId, displayName: applicationId, workbooks: [`excel/${applicationId}.xlsx`], defaultEnvironmentId: 'qa',
    environments: { qa: { baseUrl: 'https://portal.example.invalid/' } },
  })) }));
  process.env.AURA_APPLICATION='north'; process.env.AURA_ENVIRONMENT='qa'; resetActiveScope(); resetActiveApplication();
  const primary = `page.getByTestId('continue')`, alternative = `page.getByRole('button', { name: 'Continue', exact: true })`;
  const heading = `page.getByTestId('reports-heading')`;
  for (const app of ['north','south']) {
    for (const [owner, expression] of [['FirstPage',primary],['SparePage',`page.getByTestId('unrelated')`]]) {
      writeFixtureFile(`tests-e2e/pages/${app}/${owner}.ts`, `import type { Locator } from '@playwright/test';
import { BasePage } from '../base.page';
export class ${owner} extends BasePage {
  control(): Promise<Locator> { return this.resolve('control', [{ strategy: 'test-id', build: page => ${expression} }]); }
}
`);
      writeKnowledge(`${app}/${app}__${owner==='FirstPage'?'home':'spare'}.yaml`,owner==='FirstPage'?'/home':'/spare',[
        {id:'control',owner,method:'control',expression,role:'button',name:owner==='FirstPage'?'Continue':'Unrelated',usage:'action'},
      ]);
    }
    writeFixtureFile(`tests-e2e/${app}.fixtures.ts`, `import { baseTest as base, expect, trace } from './support/base-fixtures';
import { FirstPage } from './pages/${app}/FirstPage';
import { SparePage } from './pages/${app}/SparePage';
// <page-object-imports>
interface Fixtures {
  firstPage: FirstPage;
  sparePage: SparePage;
}
export const test = base.extend<Fixtures>({
  firstPage: async ({ page }, use) => { await use(new FirstPage(page)); },
  sparePage: async ({ page }, use) => { await use(new SparePage(page)); },
  // <page-object-fixtures>
});
export { expect, trace };
`);
    writeFixtureFile(`tests-e2e/generated/${app}/TC_EDIT.spec.ts`, `import { test, expect, trace } from '../../${app}.fixtures';
test('TC_EDIT - Continues to the next screen', async ({ firstPage }) => {
  await trace({ testCaseId: 'TC_EDIT', module: 'Authoring', scenario: 'Continues to the next screen', sourceWorkbook: 'excel/${app}.xlsx', sourceWorksheet: 'Cases' });
  await expect(await firstPage.control()).toBeVisible();
});
`);
  }
  const evidence: any = { available: true, capturedAt: new Date(0).toISOString(), limits: {},
    origin: { applicationId:'north',environmentId:'qa',baseUrl:'https://portal.example.invalid/' }, targets:[
      targetEvidence(primary,{route:'/home',documentId:'home-doc',elementRef:'home-doc:1',
        derivedCandidates:[measurement(primary),measurement(alternative)],target:{tag:'button',role:'button',accessibleName:'Continue',accessibleNameVerified:true}}),
      targetEvidence(heading,{route:'/reports',documentId:'reports-doc',elementRef:'reports-doc:1',
        target:{tag:'h1',text:'Reports',data:{'data-testid':'reports-heading'},accessibleName:'Reports',accessibleNameVerified:true}}),
    ] };
  const source=recordingSource([`await page.goto('https://portal.example.invalid/home');`, `await ${primary}.click();`,
    `await ${primary}.click();`, `await page.goto('https://portal.example.invalid/reports');`, `await expect(${heading}).toContainText('Reports');`]);
  writeFixtureFile('ai/dashboard/recordings/north/TC_EDIT.spec.ts',source);
  writeFixtureFile('ai/dashboard/recordings/north/TC_EDIT.evidence.json',JSON.stringify(evidence));
  const recording=parseRecording(source,{startUrl:'',browser:'chromium',durationMs:0,evidence});
  return {scope:resolveScope({applicationId:'north',environmentId:'qa'}),other:resolveScope({applicationId:'south',environmentId:'qa'}),recording,source,evidence,primary,alternative};
}
