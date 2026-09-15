// Diagnostic replay of retained generated code. No workbook setup, generation or promotion.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{safe}=require('./inspect-quarantine.cjs');
const dir=path.resolve('docs/validation/ksp21-guard-replay');fs.mkdirSync(dir,{recursive:true});
const original=fs.readFileSync('ai/autocode/quarantine/ksp.TC_SMOKE_021.2026-09-13T09-12-14-284Z.spec.ts.txt','utf8');
// Only import relocation changes; original statement line numbers are preserved.
fs.writeFileSync(path.join(dir,'case.spec.ts'),original.replace("'../../ksp.fixtures'",JSON.stringify(path.resolve('tests-e2e/ksp.fixtures').replace(/\\/g,'/'))));
fs.writeFileSync(path.join(dir,'playwright.config.ts'),`import original from '../../../playwright.excel.config';
import path from 'node:path';
export default {...original,testDir:__dirname,testIgnore:[],testMatch:'case.spec.ts',globalSetup:undefined,retries:0,workers:1,outputDir:path.join(__dirname,'artifacts'),reporter:[['json',{outputFile:path.join(__dirname,'results.json')}]],use:{...original.use,trace:'off',video:'off',screenshot:'off'}};
`);
const result=spawnSync(process.execPath,[require.resolve('@playwright/test/cli'),'test','--config='+path.join(dir,'playwright.config.ts')],{env:{...process.env,AURA_APPLICATION:'ksp',AURA_ENVIRONMENT:'stg',EXCEL_WORKBOOK:'excel/ksp-test-cases.xlsx'},encoding:'utf8',windowsHide:true,timeout:100000});
fs.writeFileSync(path.join(dir,'stdout.txt'),safe(result.stdout||''));fs.writeFileSync(path.join(dir,'stderr.txt'),safe(result.stderr||''));
const reportFile=path.join(dir,'results.json');if(fs.existsSync(reportFile)){const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));fs.writeFileSync(reportFile,safe(JSON.stringify(report,null,2)));const cases=[];const walk=s=>{for(const spec of s.specs||[])for(const test of spec.tests||[])cases.push({title:spec.title,line:spec.line,status:test.status,annotations:test.annotations,results:test.results.map(r=>({status:r.status,error:r.error,errors:r.errors}))});for(const child of s.suites||[])walk(child);};walk(report);console.log(safe(JSON.stringify({exitCode:result.status,cases},null,2)));}else console.log(safe(result.stderr));
