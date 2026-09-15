import '../testing/isolated-checkout';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {workspaceData} from '../testing/workspace-data';
import {diagnosticData,diagnosticRoot,containedFile,writeDiagnostic} from './artifacts';
import {sanitizeTrace} from './trace';
async function main(){
 const {scope}=workspaceData(),secret='synthetic-diagnostic-secret-453';process.env.AURA_DIAGNOSTIC_TEST_SECRET=secret;
 const root=diagnosticRoot(scope);fs.mkdirSync(root,{recursive:true});
 const manifest=path.join(root,'security.json');writeDiagnostic(manifest,{recordingStepKey:'action:1',label:secret,url:'https://example.invalid/auth?SAMLResponse=synthetic-redirect#session',value:secret,cookie:secret});
 const safe=fs.readFileSync(manifest,'utf8');assert.ok(!safe.includes(secret),'recorded secret never enters diagnostic manifest');assert.ok(!safe.includes('SAMLResponse')&&!safe.includes('#session'),'sensitive URL metadata redaction');assert.match(safe,/action:1/,'redaction preserves structural correlation');
 const {yauzl,yazl}=require(path.join(path.dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
 const input=path.join(root,'raw.zip'),output=path.join(root,'safe.zip'),zip=new yazl.ZipFile();
 zip.addBuffer(Buffer.from(JSON.stringify({type:'before',method:'fill',params:{value:secret},url:'https://example.invalid/auth?token=synthetic-redirect'})+'\n'),'0.trace');
 zip.addBuffer(Buffer.from(JSON.stringify({type:'resource-snapshot',request:{headers:[{name:'Authorization',value:secret}]}})+'\n'),'0.network');
 zip.addBuffer(Buffer.from(secret),'resources/account-body');
 await new Promise<void>((resolve,reject)=>{const stream=fs.createWriteStream(input);stream.on('close',resolve);stream.on('error',reject);zip.outputStream.pipe(stream);zip.end();});await sanitizeTrace(input,output);
 const retained:Record<string,string>={};await new Promise<void>((resolve,reject)=>yauzl.open(output,{lazyEntries:true},(error:any,archive:any)=>{if(error)return reject(error);archive.on('end',resolve);archive.on('error',reject);archive.on('entry',(entry:any)=>archive.openReadStream(entry,(error:any,stream:any)=>{if(error)return reject(error);const chunks:Buffer[]=[];stream.on('data',(chunk:Buffer)=>chunks.push(chunk));stream.on('end',()=>{retained[entry.fileName]=Buffer.concat(chunks).toString();archive.readEntry();});stream.on('error',reject);}));archive.readEntry();}));
 assert.deepEqual(Object.keys(retained).sort(),['0.network','0.trace'],'trace excludes source, DOM/resource payloads');assert.ok(!JSON.stringify(retained).includes(secret),'trace redacts credential fill payloads');assert.equal(retained['0.network'].trim(),'','trace excludes network bodies and headers');assert.match(retained['0.trace'],/fill/,'sanitized trace preserves action timeline');
 assert.throws(()=>containedFile(root,'../south/private.json'),/outside this application/,'diagnostic traversal is rejected');
 assert.ok(!JSON.stringify(diagnosticData({message:'Bearer synthetic.token.value',url:'https://example.invalid/?token=private'})).includes('synthetic.token.value'),'authorization tokens redacted');
 console.log('PASS diagnostic manifest and trace security, structural keys, sensitive URLs and application path containment');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
