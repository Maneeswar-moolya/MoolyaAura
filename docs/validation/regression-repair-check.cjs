// Closure evidence only; never changes application inputs.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const prefix = 'docs/validation/regression-repair';
function files(dir) { return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isSymbolicLink() ? [] : e.isDirectory() ? files(path.join(dir,e.name)) : [path.join(dir,e.name)]) : []; }
function snapshot() { return Object.fromEntries(['ai','tests-e2e','excel'].flatMap(files).concat(['package.json','package-lock.json','playwright.config.ts','playwright.excel.config.ts']).filter(f=>fs.existsSync(f)).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])); }
const [mode, ...args] = process.argv.slice(2);
if (mode === 'snapshot') {
  const out = `${prefix}-${args[0]}-hashes.json`;
  if (fs.existsSync(out)) throw Error('Refusing to overwrite '+out);
  fs.writeFileSync(out,JSON.stringify(snapshot(),null,2)); console.log(out);
} else if (mode === 'tsc') {
  const out = `${prefix}-typescript-${args[0]}.log`;
  if (fs.existsSync(out)) throw Error('Refusing to overwrite '+out);
  const result=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--pretty','false'],{encoding:'utf8',timeout:120000,windowsHide:true});
  fs.writeFileSync(out,(result.stdout||'')+(result.stderr||'')); console.log(JSON.stringify({exitCode:result.status,error:result.error?.message,log:out}));
} else if (mode === 'run') {
  const [label, ...command] = args, out=`${prefix}-${label}.log`;
  if(fs.existsSync(out))throw Error('Refusing to overwrite '+out);
  const start=Date.now(),result=spawnSync(process.execPath,command,{encoding:'utf8',timeout:1800000,windowsHide:true,maxBuffer:32*1024*1024});
  fs.writeFileSync(out,(result.stdout||'')+(result.stderr||''));
  console.log(JSON.stringify({label,exitCode:result.status,error:result.error?.message,milliseconds:Date.now()-start,log:out}));process.exitCode=result.status??1;
} else if (mode === 'compare-typescript') {
  const before=fs.readFileSync(`${prefix}-typescript-before.log`,'utf8'),after=fs.readFileSync(`${prefix}-typescript-after.log`,'utf8');
  const diagnostics=text=>text.split(/\r?\n/).filter(line=>/error TS\d+/.test(line));
  const normalise=line=>line.replace(/\(\d+,\d+\):/,':');
  const previous=diagnostics(before).map(normalise),current=diagnostics(after).map(normalise);
  const additions=[...current];for(const entry of previous){const at=additions.indexOf(entry);if(at>=0)additions.splice(at,1);}
  const removals=[...previous];for(const entry of current){const at=removals.indexOf(entry);if(at>=0)removals.splice(at,1);}
  const report={beforeCount:previous.length,afterCount:current.length,byteIdentical:before===after,additions,removals};
  fs.writeFileSync(`${prefix}-typescript-comparison.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} else if (mode === 'compare-integrity') {
  const before=JSON.parse(fs.readFileSync(`${prefix}-before-hashes.json`,'utf8')),after=snapshot();
  const allowed=new Set([
    ...['dom-evidence','evidence-consumption','evidence-persistence','exploration-auth','locator-quality','locator-safety','notifications-knowledge','parameter','semantic-candidates'].map(name=>`ai/autocode/${name}.fixture.ts`),
    ...['dashboard-experience','environment-execution','project-api','dashboard-startup'].map(name=>`ai/dashboard/${name}.fixture.ts`),
    'ai/knowledge/canonical.ts','ai/projects/onboarding.fixture.ts',
    ...['final-regression','regression-worker','isolated-checkout','fixture-routing.fixture','fixture-routing','function-under-test','process-fixture','regression-repair-mutations','reuse-inputs'].map(name=>`ai/testing/${name}.ts`),
  ]);
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(f=>before[f]!==after[f]);
  const unexpectedChanges=changed.filter(file=>!allowed.has(file.replace(/\\/g,'/')));
  const kspFiles=Object.keys(before).filter(file=>/(^|[\\/])ksp([\\/.-]|$)/i.test(file));
  const report={beforeCount:Object.keys(before).length,afterCount:Object.keys(after).length,intendedSourceChanges:changed.filter(file=>allowed.has(file.replace(/\\/g,'/'))),unexpectedChanges,kspFiles:kspFiles.length,kspChanged:kspFiles.filter(file=>before[file]!==after[file])};
  fs.writeFileSync(`${prefix}-integrity.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} else throw Error('Unknown mode');
