const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const prefix='docs/validation/test-data-', mode=process.argv[2]||'before';
function walk(dir){return fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isSymbolicLink()?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name).replaceAll('\\','/')]):[];}
const roots=['ai','tests-e2e','excel'];
const files=[...roots.flatMap(walk),...['AGENTS.md','CLAUDE.md','package.json','package-lock.json','playwright.excel.config.ts','docs/history/REMAINING.md']].filter(f=>fs.existsSync(f));
const hashes=Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
fs.writeFileSync(prefix+mode+'-hashes.json',JSON.stringify(hashes,null,2));
const run=cp.spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--pretty','false'],{encoding:'utf8',timeout:120000,windowsHide:true});
fs.writeFileSync(prefix+'typescript-'+mode+'.log',run.stdout+run.stderr);
const diagnostics=[...(run.stdout+run.stderr).matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm)].map(m=>({file:m[1],line:+m[2],code:m[4],message:m[5].trim()}));
fs.writeFileSync(prefix+'typescript-'+mode+'.json',JSON.stringify({exitCode:run.status,diagnostics},null,2));
console.log(JSON.stringify({mode,files:files.length,typecheckExit:run.status,diagnosticCount:diagnostics.length}));
if(mode==='after'){
 const before=JSON.parse(fs.readFileSync(prefix+'before-hashes.json'));
 const app=f=>/^(excel\/|ai\/test-data\/[^/]+\/|ai\/(test-mapping|knowledge\/page|dashboard\/(recordings|runs|generations)|diagnostics\/artifacts|autocode\/quarantine)\/|tests-e2e\/(pages\/ksp|generated\/ksp)|tests-e2e\/ksp\.)/.test(f)||f==='ai/projects/registry.json';
 const changed=Object.keys(before).filter(f=>before[f]!==hashes[f]);const added=Object.keys(hashes).filter(f=>!before[f]);
 const old=JSON.parse(fs.readFileSync(prefix+'typescript-before.json')).diagnostics;
 const key=d=>d.file+'|'+d.code+'|'+d.message.replace(/(Property '[^']+' does not exist on type) .*/,'$1');
 const remaining=[...old],introduced=[];for(const d of diagnostics){const i=remaining.findIndex(b=>key(b)===key(d));if(i>=0)remaining.splice(i,1);else introduced.push(d);}
 const result={changed,added,applicationChanged:changed.filter(app),applicationAdded:added.filter(app),typescript:{before:old.length,after:diagnostics.length,introduced,removed:remaining}};
 fs.writeFileSync(prefix+'comparison.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
