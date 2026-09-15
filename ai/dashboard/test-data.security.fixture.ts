import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { workspaceData } from '../testing/workspace-data';
import { registerCredentialSecrets } from '../test-data/secrets';
import { captureDiagnostic, diagnosticData } from '../diagnostics/artifacts';
async function main(){
 const {scope}=workspaceData();const browser=await chromium.launch();
 try{const page=await browser.newPage({viewport:{width:800,height:400}}),username='synthetic-screen-user',password='synthetic-screen-password';
  registerCredentialSecrets(username,password);await page.setContent(`<h1>${username}</h1><p>${password}</p><label>Secret<input value="${password}"></label><p>Safe business context</p>`);
  const directory=path.join(scope.paths.recordingsDir,'screens'),capture=await captureDiagnostic(page,directory,'action:4','PRE_STEP');assert.ok(capture);
  const expected=await page.screenshot({mask:[page.locator('input, textarea, [contenteditable], [data-sensitive]'),page.getByText(username,{exact:false}),page.getByText(password,{exact:false})]});
  assert.deepEqual(fs.readFileSync(path.join(directory,capture.artifact)),expected,'screenshots mask rendered profile usernames and passwords as well as input controls');
  assert.equal(capture.recordingStepKey,'action:4');assert.ok(!JSON.stringify(capture).includes(username));
  const safe=JSON.stringify(diagnosticData({error:`${username} ${password}`,url:`https://portal.invalid/route?token=${password}`,executionProfile:{credentialProfileName:'Administrator',role:'admin'}}));
  assert.ok(!safe.includes(username)&&!safe.includes(password),'diagnostic metadata never includes resolved credential values');
  console.log('PASS profile screenshot pixels and diagnostic manifest redact runtime credentials');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
