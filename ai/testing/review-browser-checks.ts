import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { ApplicationScope } from '../projects/scope';
import type { Recording } from '../dashboard/recorder';
import { recordingMappingReview, saveRecordingMapping, type MappingDraft } from '../dashboard/recording-mapping';
import { createLogicalPage, createPageObject, createAuthoringMethod, authoringCatalog } from '../dashboard/authoring-catalog';
import { writeFixtureFile } from './synthetic-data';
import { readAllPageKnowledge } from '../knowledge/page-knowledge';

/** Browser requests invoke the actual scoped authoring service with server-held synthetic data. */
export async function reviewBrowserChecks(page: Page, scope: ApplicationScope, recording: Recording, source: string, capture?: string) {
  createLogicalPage(scope,{name:'LandingPage',route:'/home',description:'Welcome and navigation'});
  createLogicalPage(scope,{name:'DashboardPage',route:'/home',description:'Reports and analytics'});
  createLogicalPage(scope,{name:'HeaderPage',route:'',description:'Shared across screens'});
  createPageObject(scope,'LandingPage','LandingControls');
  createAuthoringMethod(scope,'LandingControls','entryLink',recording.actions[1].locator);
  for(let n=0;n<120;n++)writeFixtureFile(path.relative(process.cwd(),path.join(scope.paths.knowledgePageDir,`catalog_${n}.yaml`)),`page:\n  id: catalog_${n}\n  application_id: north\n  logical_name: Catalog page ${String(n).padStart(3,'0')}\n  name: Catalog page ${n}\n  route: /catalog/${n}\n  purpose: Large catalog\nelements:\n`);
  const names=Array.from({length:500},(_,n)=>'CatalogControls'+String(n).padStart(3,'0'));
  writeFixtureFile(path.relative(process.cwd(),path.join(scope.paths.knowledgePageDir,'catalog_screen.yaml')),`page:\n  id: catalog_screen\n  application_id: north\n  logical_name: Catalog screen\n  route: /catalog\npage_objects:\n${names.map(name=>'  - '+name).join('\n')}\nelements:\n`);
  for(const name of names)writeFixtureFile(path.relative(process.cwd(),path.join(scope.paths.pagesDir,name+'.ts')),`import { BasePage } from '../base.page';\nexport class ${name} extends BasePage {\n  example() { return this.page.getByTestId('catalog'); }\n}\n`);
  const draft:MappingDraft={source,recording};let requests=0,failSave=false;const saves:any[]=[];
  let heldReview: { wait: Promise<void>; captured: () => void; delivered: () => void } | undefined;
  await page.route('**/api/record/ownership**',async route=>{
    requests++;
    try{const request=route.request();if(request.method()==='POST'){
      if(failSave){failSave=false;throw Error('Synthetic save failure');}
      assert.ok(request.url().endsWith('/save-mapping'),'one save endpoint, not separate creation requests');
      const result=saveRecordingMapping(scope,draft,request.postDataJSON());saves.push(result.saved);
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    }else {const body=JSON.stringify(recordingMappingReview(scope,draft)),held=heldReview;if(held){held.captured();await held.wait;}await route.fulfill({status:200,contentType:'application/json',body});held?.delivered();}}
    catch(error){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:(error as Error).message})});}
  });
  await page.evaluate(`recording=${JSON.stringify(recording)};recSteps=recording.actions.map(a=>({...a}));recAsserts=recording.assertions.map(a=>({...a}));setView('cases');openReview({scenario:'Authoring review',expectedResult:'Reports visible',tags:'recorded',authentication:{detected:false}})`);
  await page.waitForFunction(()=>document.querySelectorAll('#ownerSteps button').length===3);
  const choose=async(id:string,value:string)=>{await page.locator('#'+id).click();await page.locator('#'+id).fill(value);await page.locator('#'+id+'List [role=option]').filter({has:page.locator('strong',{hasText:new RegExp('^'+value+'$')})}).click();};
  const newPage=async(name:string)=>{await page.locator('#logicalPage').click();await page.locator('#logicalPageList [data-value="@create"]').click();assert.equal(await page.locator('#newPageRoute').inputValue(),'/home');await page.locator('#newPageName').fill(name);await page.getByRole('button',{name:'Use new Page',exact:true}).click();};
  const newObject=async(name:string)=>{await page.locator('#ownerPageObject').click();await page.locator('#ownerPageObjectList [data-value="@create"]').click();await page.locator('#newPageObjectName').fill(name);await page.getByRole('button',{name:'Use new Page Object',exact:true}).click();};
  const save=async()=>{await page.locator('#saveMapping').click();await page.waitForFunction(()=>document.querySelector('#ownerFeedback')?.classList.contains('good'));};
  assert.equal(await page.locator('#logicalPage').getAttribute('role'),'combobox');assert.equal(await page.locator('#ownerPageObject').isDisabled(),true,'ranking never silently selects a Page');
  assert.equal(await page.locator('#ownerDetail details').getAttribute('open'),null,'Advanced starts collapsed');
  assert.match(await page.locator('#ownerDetail .rr-context').innerText(),/\/home/);
  assert.equal(await page.locator('#logicalPage').inputValue(),'','ranking never silently selects a Page');
  const beforeSearch=requests;
  await page.locator('#logicalPage').click();assert.match(await page.locator('#logicalPageList [role=option]').first().innerText(),/Create new Page/);
  assert.ok(await page.locator('#logicalPageList [data-value="LandingPage"]').count());assert.ok(await page.locator('#logicalPageList [data-value="DashboardPage"]').count());
  for(const query of ['Landing','/home','Welcome','LndingPge']){await page.locator('#logicalPage').fill(query);assert.ok(await page.locator('#logicalPageList [data-value="LandingPage"]').count());assert.ok(await page.locator('#logicalPageList mark').count());}
  await page.locator('#logicalPage').press('Escape');assert.equal(await page.locator('#logicalPage').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#logicalPage').inputValue(),'');
  await page.locator('#logicalPage').press('ArrowDown');await page.locator('#logicalPage').fill('Landing');await page.locator('#logicalPage').press('ArrowDown');await page.locator('#logicalPage').press('ArrowDown');await page.locator('#logicalPage').press('Enter');
  assert.equal(await page.locator('#logicalPage').inputValue(),'LandingPage');assert.equal(requests,beforeSearch,'selector opening/search/selection does not call the backend');
  await page.locator('#ownerPageObject').click();assert.equal(await page.locator('#ownerPageObjectList [data-value="SparePage"]').count(),0);assert.equal(await page.locator('#ownerPageObjectList [data-value="CatalogControls000"]').count(),0);
  for(const term of ['LandingControls','entryLink','LandingControls.ts']){await page.locator('#ownerPageObject').fill(term);assert.ok(await page.locator('#ownerPageObjectList [data-value="LandingControls"]').count());}
  await page.locator('#ownerPageObject').press('Escape');await page.locator('#resetMapping').click();assert.equal(await page.locator('#logicalPage').inputValue(),'');
  console.log('PASS browser combobox semantics, route relevance, no implicit selection, fuzzy search, keyboard and Page Object filtering');
  await page.locator('#logicalPage').click();await page.locator('#logicalPageList [data-value="@create"]').click();await page.locator('#newPageName').fill('LandingPage');
  assert.match(await page.locator('.rr-duplicate').innerText(),/Page already exists/);await page.getByRole('button',{name:'Use Existing Page',exact:true}).click();assert.equal(await page.locator('#logicalPage').inputValue(),'LandingPage');
  await page.locator('#resetMapping').click();await newPage('Header workspace');assert.equal(await page.locator('#logicalPage').inputValue(),'Header workspace');
  await page.locator('#ownerPageObject').click();assert.match(await page.locator('#ownerPageObjectList').innerText(),/Create first Page Object/);assert.match(await page.locator('#ownerPageObjectList').innerText(),/No Page Objects exist in Header workspace/);
  await page.locator('#ownerPageObjectList [data-value="@create"]').click();await page.locator('#newPageObjectName').fill('clickLogin()');assert.equal(await page.locator('#newPageObjectName').evaluate((node:HTMLInputElement)=>node.checkValidity()),false);assert.match(await page.locator('.rr-dialog-error').innerText(),/without parentheses/);
  await page.locator('#newPageObjectName').fill('HeaderActions');await page.getByRole('button',{name:'Use new Page Object',exact:true}).click();
  assert.equal(await page.locator('#ownerPageObject').inputValue(),'HeaderActions');assert.match(await page.locator('#mappingSummary').innerText(),/NEW/);
  assert.equal(authoringCatalog(scope).objects.some(object=>object.className==='HeaderActions'),false,'creation is staged until the transaction');
  await page.locator('#ownerSteps button').nth(1).click();assert.match(await page.locator('#ownerFeedback').innerText(),/Unsaved changes are kept/);await page.locator('#ownerSteps button').first().click();assert.equal(await page.locator('#ownerPageObject').inputValue(),'HeaderActions');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#project').selectOption('south');assert.equal(await page.locator('#project').inputValue(),'north','cancelled application switch retains unsaved choices');
  if(capture){await page.setViewportSize({width:1440,height:1700});await page.locator('#ownershipWorkspace').screenshot({path:path.join(capture,'review-mapping-draft.png')});await page.setViewportSize({width:1440,height:1000});}
  // A NEW Page Object declares no capabilities, so Save now waits for an execution choice.
  // The server can still derive a method name when one is not supplied - that path is
  // unchanged and other callers keep it - but the UI no longer makes that decision on the
  // person's behalf and call it their confirmation.
  assert.equal(await page.locator('#saveMapping').isDisabled(),true,'an incomplete binding cannot be saved');
  assert.ok(await page.locator('#executionChoice').count(),'the execution choice section is on screen');
  assert.match(await page.locator('#executionChoice').innerText(),/USER_BINDING_INCOMPLETE/,'the execution choice section is on screen and names the missing choice');
  assert.ok(await page.locator('#executionCreateMethod').count(),'Create method is reachable');
  page.once('dialog',dialog=>dialog.accept('openHeader'));
  await page.locator('#executionCreateMethod').click();
  assert.match(await page.locator('#executionChosen').innerText(),/openHeader()/,'the created capability is the execution choice');
  assert.match(await page.locator('#mappingSummary').innerText(),/PAGE_OBJECT_METHOD/,'the summary reports the mechanism that will run');
  failSave=true;await page.locator('#saveMapping').click();await page.waitForFunction(()=>document.querySelector('#ownerFeedback')?.classList.contains('bad'));assert.match(await page.locator('#ownerFeedback').innerText(),/unsaved choices are retained/);assert.equal(await page.locator('#ownerPageObject').inputValue(),'HeaderActions');
  let releaseReview!: () => void, capturedReview!: () => void, deliveredReview!: () => void;
  const captured=new Promise<void>(resolve=>capturedReview=resolve),delivered=new Promise<void>(resolve=>deliveredReview=resolve);
  heldReview={wait:new Promise<void>(resolve=>releaseReview=resolve),captured:capturedReview,delivered:deliveredReview};
  await page.locator('#ownerReload').click();await captured;
  await save();releaseReview();await delivered;heldReview=undefined;
  await page.waitForFunction(()=>!document.querySelector('#ownerDetail')?.hasAttribute('aria-busy'));
  assert.equal(await page.locator('#ownerPageObject').inputValue(),'HeaderActions','late pre-save review must not replace persisted mapping');
  assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.locator('#saveMapping').isDisabled(),true);assert.match(await page.locator('#ownerFeedback').innerText(),/Reusable for future recordings/);
  const binding=saves.at(-1).binding;assert.deepEqual(recordingMappingReview(scope,draft).steps[0].userSelection,binding);
  // The choice the person made is what is stored. A method selected in the UI and persisted
  // as AUTO would read back as a step nobody had bound.
  assert.equal(binding.executionMode,'PAGE_OBJECT_METHOD','a selected method is saved as PAGE_OBJECT_METHOD, never as AUTO');
  assert.equal(binding.method,'openHeader','a selected method is saved as PAGE_OBJECT_METHOD, never as AUTO');
  assert.ok(readAllPageKnowledge(scope.paths.knowledgePageDir,true).some(p=>p.elements.some(e=>e.page_object==='HeaderActions'&&e.page_object_method===binding.method)));
  const objectFile=path.join(scope.paths.pagesDir,'HeaderActions.ts'),objectBefore=fs.readFileSync(objectFile,'utf8');
  await page.locator('#ownerSteps button').nth(1).click();assert.equal(await page.locator('#logicalPage').inputValue(),'Header workspace');assert.equal(await page.locator('#ownerPageObject').inputValue(),'HeaderActions');
  await page.locator('#ownerDetail summary').click();assert.equal(await page.locator('#mappingMode').inputValue(),'AUTO');assert.equal(await page.locator('#mappingMethod').inputValue(),'','method does not inherit');
  // The same capability serves this step too, and is now REUSED BY EXPLICIT CHOICE rather
  // than by the save quietly matching it. The server-side reuse is unchanged - established
  // source is still never rewritten - only who decides has moved to the person.
  await choose('ownerPageObject','HeaderActions');
  assert.ok(await page.locator('#executionMethod').count(),'the method list is reachable');
  await page.locator('#executionMethod').selectOption('openHeader');
  await save();assert.equal(saves.at(-1).reused,true);assert.equal(fs.readFileSync(objectFile,'utf8'),objectBefore);
  await choose('logicalPage','LandingPage');assert.match(await page.locator('#mappingSummary').innerText(),/Unsaved changes/);await page.locator('#resetMapping').click();assert.equal(await page.locator('#logicalPage').inputValue(),'Header workspace');
  console.log('PASS browser duplicate reuse, modal creation, immediate selection, dirty retention, failed-save retry, persisted readback and next-step capability reuse');
  await page.locator('#ownerDetail summary').click();await page.locator('#mappingAuto').click();await save();assert.equal(fs.readFileSync(objectFile,'utf8'),objectBefore);
  await page.locator('#ownerDetail summary').click();await page.locator('#mappingMode').selectOption('RECORDED_LOCATOR');await save();assert.equal(saves.at(-1).binding.pageObject,'');assert.match(await page.locator('#ownerFeedback').innerText(),/USER AUTHORED — NOT VALIDATED/);
  await page.locator('#ownerDetail summary').click();assert.ok(await page.locator('#mappingMode option[value="PAGE_OBJECT_METHOD"]').count());assert.ok(await page.locator('#mappingMode option[value="AUTO"]').count());
  await page.locator('#ownerReload').click();await page.waitForFunction(()=>document.querySelector('#mappingMode')&&(document.querySelector('#mappingMode') as HTMLSelectElement).value==='RECORDED_LOCATOR');
  console.log('PASS browser Advanced modes, per-step execution, Reset restoration, Reset to Auto and reload');
  await page.locator('#logicalPage').click();await page.locator('#logicalPageList [data-value="@all"]').click();await page.locator('#logicalPage').press('End');
  assert.ok(await page.locator('#logicalPageList [role=option]').count()<16,'large Page catalog uses bounded rendering');assert.equal(await page.locator('#logicalPage').getAttribute('aria-expanded'),'true');
  await page.locator('#logicalPage').press('Escape');await choose('logicalPage','Catalog screen');await page.locator('#ownerPageObject').click();await page.locator('#ownerPageObject').press('End');
  assert.ok(await page.locator('#ownerPageObjectList [role=option]').count()<16,'500 Page Objects use bounded rendering');assert.ok(await page.locator('#ownerPageObjectList [data-value="CatalogControls499"]').count());
  await page.locator('#ownerPageObject').press('Tab');assert.equal(await page.locator('#ownerPageObject').getAttribute('aria-expanded'),'false');await page.locator('#resetMapping').click();
  await page.locator('#ownerSteps button').first().click();
  if(capture){await page.setViewportSize({width:1440,height:1700});await page.locator('#ownershipWorkspace').screenshot({path:path.join(capture,'review-mapping-saved.png')});}
  await page.setViewportSize({width:700,height:900});assert.ok(await page.locator('#logicalPage').isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(capture){await page.setViewportSize({width:700,height:1800});await page.locator('#ownershipWorkspace').screenshot({path:path.join(capture,'review-mapping-mobile.png')});await page.setViewportSize({width:700,height:900});}
  await page.locator('#logicalPage').click();const bounds=await page.locator('#logicalPagePopup').boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=700);await page.locator('#logicalPage').press('Escape');
  console.log('PASS browser large catalogs, virtualization, View all, Tab navigation and responsive popovers');
}

/**
 * THE CONTROLS THAT RESOLVE USER_BINDING_INCOMPLETE MUST BE REACHABLE.
 *
 * The safeguard refusing an incomplete mapping is correct. What was not is that everything
 * able to complete one lived inside the collapsed "Advanced" block, below the summary that
 * reported the refusal - so the step named what was missing and hid the only way to supply it.
 * These run against the REAL rendered UI and the REAL save path: a check that queried the DOM
 * for a control it had itself inserted would prove nothing.
 */
export async function executionChoiceChecks(page: Page, scope: ApplicationScope, recording: Recording, source: string) {
  createLogicalPage(scope, { name: 'SignInScreen', route: '/home', description: 'Credential screen' });
  createPageObject(scope, 'SignInScreen', 'SignInControls');
  createAuthoringMethod(scope, 'SignInControls', 'emailField', recording.actions[1].locator);
  createLogicalPage(scope, { name: 'EmptyScreen', route: '/home', description: 'No capabilities yet' });
  createPageObject(scope, 'EmptyScreen', 'EmptyControls');

  const draft: MappingDraft = { source, recording };
  await page.unroute('**/api/record/ownership**');
  await page.route('**/api/record/ownership**', async route => {
    try {
      const request = route.request();
      if (request.method() === 'POST') {
        const result = saveRecordingMapping(scope, draft, request.postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
      } else await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(recordingMappingReview(scope, draft)) });
    } catch (error) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: (error as Error).message }) });
    }
  });
  // The page-level recording is what openReview reads; set here so these contracts can run
  // on their own, not only after the full harness has already installed it.
  await page.evaluate(`recording=${JSON.stringify(recording)};recSteps=recording.actions.map(a=>({...a}));recAsserts=recording.assertions.map(a=>({...a}));setView('cases');openReview({scenario:'Execution choice',expectedResult:'Reports visible',tags:'recorded',authentication:{detected:false}})`);
  await page.waitForFunction(() => document.querySelectorAll('#ownerSteps button').length > 0);
  await page.locator('#ownerSteps button').first().click();

  const pick = async (id: string, value: string) => {
    await page.locator('#' + id).click();
    await page.locator('#' + id).fill(value);
    await page.locator(`#${id}List [data-value="${value}"]`).click();
  };
  const save = async () => {
    await page.locator('#saveMapping').click();
    await page.waitForFunction(() => document.querySelector('#ownerFeedback')?.classList.contains('good'));
  };
  const reload = async () => {
    await page.locator('#ownerReload').click();
    await page.waitForFunction(() => !document.querySelector('#ownerDetail')?.hasAttribute('aria-busy'));
    await page.locator('#ownerSteps button').first().click();
  };

  // ---- A Page alone resolves nothing, and must not offer to.
  await pick('logicalPage', 'SignInScreen');
  assert.equal(await page.locator('#executionChoice').count(), 0, 'no Page Object, no execution choice to make');
  assert.equal(await page.locator('#saveMapping').isDisabled(), true, 'Page only cannot be saved');

  // ---- Page + Page Object: incomplete, and the controls are VISIBLE without expanding anything.
  await pick('ownerPageObject', 'SignInControls');
  assert.equal(await page.locator('#ownerDetail details').getAttribute('open'), null, 'Advanced is still collapsed');
  assert.ok(await page.locator('#executionChoice').isVisible(), 'the execution choice section is on screen');
  assert.match(await page.locator('#executionChoice').innerText(), /USER_BINDING_INCOMPLETE/);
  assert.equal(await page.locator('#saveMapping').isDisabled(), true, 'an incomplete binding cannot be saved');
  assert.ok(await page.locator('#executionMethod').isVisible(), 'the method list is reachable');
  assert.ok(await page.locator('#executionCreateMethod').isVisible(), 'Create method is reachable');
  assert.ok(await page.locator('#executionUseLocator').isVisible(), 'Use recorded locator is reachable');
  assert.ok(await page.locator('#useRecommendedMethod').isVisible(), 'the one matching capability is offered by name');
  assert.match(await page.locator('#useRecommendedMethod').innerText(), /emailField/);
  assert.match(await page.locator('#executionChoice').innerText(), /declared locator is the one recorded/i,
    'the recommendation states its evidence rather than asserting a name match');
  console.log('PASS browser execution choice appears for an incomplete binding, outside Advanced');

  // ---- Choosing the recommended capability completes it.
  await page.locator('#useRecommendedMethod').click();
  assert.match(await page.locator('#executionChosen').innerText(), /SignInControls\.emailField\(\)/);
  assert.equal(await page.locator('#saveMapping').isDisabled(), false, 'an executable choice can be saved');
  const summary = await page.locator('#mappingSummary').innerText();
  assert.match(summary, /PAGE_OBJECT_METHOD/, 'the summary reports the mechanism that will run');
  assert.match(summary, /emailField\(\)/);
  assert.match(summary, /USER_CONFIRMED/);
  assert.doesNotMatch(summary, /Recorded locator/, 'a Page Object method runs no recorded locator');
  await save();
  await reload();
  assert.equal(await page.locator('#ownerPageObject').inputValue(), 'SignInControls', 'the Page Object survives the reload');
  // Presence asserted before content: reading innerText of a control that is not there throws
  // a locator timeout, and the message naming the guarantee never reaches the output.
  assert.ok(await page.locator('#executionChosen').count(), 'a saved mapping never comes back as AUTO');
  assert.match(await page.locator('#executionChosen').innerText(), /emailField\(\)/, 'a saved mapping never comes back as AUTO');
  assert.match(await page.locator('#mappingSummary').innerText(), /PAGE_OBJECT_METHOD/,
    'a saved mapping never comes back as AUTO');
  console.log('PASS browser explicit method choice saves, reloads and stays PAGE_OBJECT_METHOD');

  // ---- A Page Object with no capability offers the two ways forward, not a dead end.
  await page.locator('#ownerSteps button').nth(1).click();
  await pick('logicalPage', 'EmptyScreen');
  await pick('ownerPageObject', 'EmptyControls');
  assert.match(await page.locator('#executionChoice').innerText(), /declares no capabilities yet/);
  assert.equal(await page.locator('#useRecommendedMethod').count(), 0, 'nothing is recommended when nothing matches');
  assert.ok(await page.locator('#executionCreateMethod').isVisible(), 'Create method is offered');
  assert.ok(await page.locator('#executionUseLocator').isVisible(), 'Use recorded locator is offered');
  assert.equal(await page.locator('#saveMapping').isDisabled(), true, 'and neither is applied on the user\'s behalf');
  console.log('PASS browser no-capability Page Object offers Create method and Use recorded locator');

  // ---- Recorded-locator execution, saved and reconstructed.
  await page.locator('#executionUseLocator').click();
  assert.match(await page.locator('#executionChosen').innerText(), /NOT VALIDATED/);
  const locatorSummary = await page.locator('#mappingSummary').innerText();
  assert.match(locatorSummary, /RECORDED_LOCATOR/);
  assert.match(locatorSummary, /USER_CONFIRMED/);
  assert.equal(await page.locator('#saveMapping').isDisabled(), false);
  await save();
  await page.locator('#ownerSteps button').nth(1).click();
  await reload();
  await page.locator('#ownerSteps button').nth(1).click();
  assert.match(await page.locator('#mappingSummary').innerText(), /RECORDED_LOCATOR/,
    'an explicit recorded-locator election is reconstructed as itself');
  console.log('PASS browser recorded-locator election saves, reloads and stays RECORDED_LOCATOR');
}
