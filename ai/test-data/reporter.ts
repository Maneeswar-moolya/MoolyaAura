/** Profile runs serialize safe report fields directly; raw credential-bearing reporter output never reaches disk. */
import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, FullConfig, Suite, TestCase, TestResult, FullResult, TestError } from '@playwright/test/reporter';
import { runtimeSelection, resolveExecutionData } from './execution';
import { activeScope } from '../projects/scope';
import { diagnosticText, diagnosticData } from '../diagnostics/artifacts';

export default class ProfileReporter implements Reporter {
 private suite!:Suite;
 private errors:TestError[]=[];
 private config!:FullConfig;
 constructor(){const selection=runtimeSelection();if(selection)resolveExecutionData(activeScope(),selection);}
 onBegin(config:FullConfig,suite:Suite){this.suite=suite;this.config=config;}
 onError(error:TestError){this.errors.push({message:diagnosticText(error.message),stack:diagnosticText(error.stack)});}
 onStdOut(){} onStdErr(){}
 onTestEnd(test:TestCase,result:TestResult){
   process.stdout.write(`${/^((?:TC|TS)[_-][A-Za-z0-9_-]+)/.exec(test.title)?.[1]??'Test'}: ${result.status}\n`);
 }
 onEnd(result:FullResult){
  const serialize=(suite:Suite):any=>({title:diagnosticText(suite.title),file:suite.location?.file,line:suite.location?.line,column:suite.location?.column,
   suites:suite.suites.map(serialize),specs:suite.tests.map(test=>({title:diagnosticText(test.title),file:test.location.file,line:test.location.line,column:test.location.column,ok:test.ok(),id:test.id,
    tests:[{projectName:test.parent.project()?.name??'',expectedStatus:test.expectedStatus,status:test.outcome(),annotations:diagnosticData(test.annotations),results:test.results.map(r=>({
     workerIndex:r.workerIndex,parallelIndex:r.parallelIndex,status:r.status,duration:r.duration,startTime:r.startTime.toISOString(),retry:r.retry,
     errors:r.errors.map(e=>({message:diagnosticText(e.message),stack:diagnosticText(e.stack),value:undefined})),
     error:r.error?{message:diagnosticText(r.error.message),stack:diagnosticText(r.error.stack)}:undefined,stdout:[],stderr:[],
     attachments:r.attachments.filter(a=>a.path&&/^aura-[a-f0-9-]+\.png$/.test(path.basename(a.path))).map(a=>({name:a.name,contentType:a.contentType,path:a.path})),
    }))}]}))});
  const output=process.env.PLAYWRIGHT_JSON_OUTPUT_NAME||path.resolve('test-results-excel/results.json');
  const report={config:{rootDir:this.config.rootDir},suites:this.suite?.suites.map(serialize)??[],errors:this.errors,stats:{startTime:result.startTime.toISOString(),duration:result.duration}};
  fs.mkdirSync(path.dirname(output),{recursive:true});const temp=output+'.tmp';fs.writeFileSync(temp,JSON.stringify(report,null,2));fs.renameSync(temp,output);
 }
}
