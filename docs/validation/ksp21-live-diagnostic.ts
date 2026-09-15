// Real validation case only. Does not write application knowledge, mappings or sources.
import '../../tests-e2e/support/load-env';
import fs from 'node:fs';import path from 'node:path';import { chromium } from 'playwright';
import { pinActiveScope } from '../../ai/projects/scope';
const scope=pinActiveScope({applicationId:'ksp',environmentId:'stg'});
const {credentials}=require('../../tests-e2e/support/env');
const {diagnosticText:safe,captureDiagnostic}=require('../../ai/diagnostics/artifacts');
const {readTestData}=require('../../ai/test-data/store');
const {executionPlan}=require('../../ai/test-data/execution');
const {InitialLandingPage}=require('../../tests-e2e/pages/ksp/InitialLandingPage');
const {LoginButton}=require('../../tests-e2e/pages/ksp/LoginButton');
const {SsoauthLoginPage}=require('../../tests-e2e/pages/ksp/ssoauth.login.page');
const {UsEnHomePage}=require('../../tests-e2e/pages/ksp/us.en.home.page');
async function main(){
  const profileId=process.argv[2];if(!profileId)throw Error('Select a saved JSON credential profile before authenticated live diagnosis.');
  const catalog=readTestData(scope),planned=executionPlan(scope,['TC_SMOKE_021'],{mode:'selected',credentialProfileIds:[profileId],expectedVersion:catalog.version});
  process.env.AURA_EXECUTION_SELECTION=JSON.stringify(planned[0].selection);const account=credentials();
  const output=path.resolve('docs/validation/ksp21-live',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
  const observations:any[]=[];const errors:string[]=[];page.on('pageerror',error=>errors.push(safe(error.message)));page.on('console',message=>{if(message.type()==='error')errors.push(safe(message.text()));});
  const route=()=>safe(page.url());let at=0;
  const capture=async(label:string)=>({...await captureDiagnostic(page,output,`diagnostic:${++at}`,label),provenance:'LIVE_DIAGNOSTIC_ONLY'});
  const inspect=async(label:string,locator:any,expression:string)=>{const count=await locator.count();const nodes=await locator.evaluateAll((nodes:any[])=>nodes.map(node=>({tag:node.tagName.toLowerCase(),role:node.getAttribute('role'),accessibleName:node.getAttribute('aria-label')||node.getAttribute('placeholder')||node.innerText||'',visible:!!node.getClientRects().length,enabled:!node.disabled})));const entry={label,locator:expression,count,nodes:JSON.parse(safe(JSON.stringify(nodes))),route:route(),capture:await capture('PRE_STEP')};observations.push(entry);return entry;};
  try{
    const response=await page.goto(scope.baseUrl,{waitUntil:'domcontentloaded'});
    if(response?.status()===403&&/cloudflare/i.test(await page.locator('body').innerText())){observations.push({result:'LIVE DIAGNOSIS BLOCKED — ENVIRONMENT ACCESS',classification:'ENVIRONMENT_FAILURE',httpStatus:403,capture:await capture('FAILURE')});return;}
    await page.locator('header').getByRole('link',{name:'Log In'}).waitFor({state:'visible'});
    const initial=new InitialLandingPage(page),manual=new LoginButton(page),sso=new SsoauthLoginPage(page),home=new UsEnHomePage(page);
    await inspect('Original recording locator',page.locator('header').getByRole('link',{name:'Log In'}),"page.locator('header').getByRole('link', { name: 'Log In' })");
    await inspect('LoginButton.logIn (comparison only)',manual.logIn(),"page.locator('header').getByRole('link', { name: 'Log In' })");
    const entry:any=await inspect('InitialLandingPage.logIn (quarantined spec)',initial.logIn(),"page.locator('header').getByRole('link', { name: 'Log In' })");await initial.logIn().click();entry.action='CLICK_SUCCEEDED';entry.after=await capture('AFTER_ACTION');
    await page.getByRole('textbox',{name:'Enter email'}).waitFor({state:'visible'});
    const email=await sso.enterEmailField(),password=await sso.passwordField(),submit=await sso.logInButton();
    const e:any=await inspect('SsoauthLoginPage.enterEmailField',email,"getByRole('textbox', { name: 'Enter email' })");await email.click();e.action='CLICK_SUCCEEDED';
    const p:any=await inspect('SsoauthLoginPage.passwordField',password,"getByRole('textbox', { name: 'Password' })");
    const s:any=await inspect('SsoauthLoginPage.logInButton',submit,"getByRole('button', { name: 'Log In', exact: true })");
    if(account){await email.fill(account.email);e.action='FILL_SUCCEEDED';await password.fill(account.password);p.action='FILL_SUCCEEDED';await submit.click();s.action='CLICK_SUCCEEDED';
      await page.getByRole('heading',{name:'My Dashboard',exact:true}).waitFor({state:'visible'});await inspect('UsEnHomePage.myDashboardState',await home.myDashboardState(),"getByRole('heading', { name: 'My Dashboard', exact: true })");
    }else{p.action=s.action='NOT_ATTEMPTED: scoped credential bindings absent';observations.push({label:'Post-login dashboard',result:'NOT_REACHED: scoped credential bindings absent'});}
  }catch(error){observations.push({result:'DIAGNOSTIC_FAILURE',error:safe((error as Error).message),capture:await capture('FAILURE').catch(()=>null)});}
  finally{await browser.close();const result={applicationId:scope.applicationId,environmentId:scope.environmentId,originalRunId:'2026-09-13T09-12-10-285Z-a9v1e3',historicalEvidence:false,executionProfile:planned[0].profile,preflight:planned[0].preflight,credentialsConfigured:!!account,observations,consoleErrors:errors};fs.writeFileSync(path.join(output,'diagnostic.json'),JSON.stringify(result,null,2));console.log(safe(JSON.stringify({output,...result},null,2)));}
}
main().catch(error=>{console.error(safe(error.message));process.exitCode=1;});
