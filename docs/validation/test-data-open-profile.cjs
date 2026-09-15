// Read-only UI probe. Opens an empty form; never reads or writes credential values.
const {chromium}=require('playwright');
async function main(){
 const origin=new URL(process.argv[2]||'http://moolyaautomationreport.com');
 const browser=await chromium.launch({args:[`--host-resolver-rules=MAP ${origin.hostname} 127.0.0.1`,'--no-proxy-server']});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin.origin);await page.locator('#project').selectOption(process.argv[3]||'ksp');
  await page.getByRole('tab',{name:'Test Data',exact:true}).click();
  await page.getByRole('button',{name:'+ Add Credential Profile',exact:true}).click();
  const dialog=page.getByRole('dialog');
  console.log(JSON.stringify({origin:origin.origin,...await page.evaluate(()=>({secureContext:isSecureContext,randomUUID:typeof crypto.randomUUID})),dialogVisible:await dialog.isVisible(),saveVisible:await dialog.getByRole('button',{name:'Save Profile',exact:true}).isVisible(),cancelVisible:await dialog.getByRole('button',{name:'Cancel',exact:true}).isVisible(),errors}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
