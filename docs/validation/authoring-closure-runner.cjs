// Closure validation harness only. Every fixture runs in a fresh guarded checkout.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process'), crypto = require('crypto');
const mode = process.argv[2];
if (!['focused', 'full'].includes(mode)) throw Error('Choose focused or full.');
function files(dir) { return fs.existsSync(dir) ? fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isSymbolicLink()?[]:e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]) : []; }
function snapshot() { return Object.fromEntries(['ai','tests-e2e','excel'].flatMap(files).concat(['package.json','package-lock.json','playwright.config.ts','playwright.excel.config.ts']).filter(f=>fs.existsSync(f)).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')])); }
const selected = mode === 'full' ? files('ai').filter(f=>f.endsWith('.fixture.ts')).sort() : [
  'ai/dashboard/explicit-authoring.fixture.ts', 'ai/dashboard/authoring-workspace.fixture.ts',
  'ai/dashboard/authoring-browser.fixture.ts', 'ai/autocode/ownership-reuse.fixture.ts',
  'ai/autocode/recorded-flow.fixture.ts', 'ai/dashboard/navigation-causality.fixture.ts',
];
const reportFile = `docs/validation/authoring-closure-${mode}.json`, logDir = `docs/validation/authoring-closure-${mode}-logs`;
if (fs.existsSync(reportFile)) throw Error('Report already exists; do not overwrite validation history.');
fs.mkdirSync(logDir,{recursive:true});
const before = snapshot(), report = { started:new Date().toISOString(),total:selected.length,results:[] };
for (const fixture of selected) {
  const start = Date.now(), child = spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','ai/testing/regression-worker.ts',fixture],{encoding:'utf8',timeout:360000,windowsHide:true,maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(logDir,fixture.replace(/[\\/]/g,'_')+'.log'),(child.stdout||'')+(child.stderr||''));
  report.results.push({fixture,exitCode:child.status,milliseconds:Date.now()-start,error:child.error?.message});
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  console.log(`${report.results.length}/${selected.length} exit=${child.status} ${fixture}`);
  // The closure explicitly requests a COMPLETE sweep; collect every result once.
}
const after=snapshot();report.changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(f=>before[f]!==after[f]);
report.finished=new Date().toISOString();report.passed=report.results.every(r=>r.exitCode===0)&&!report.changed.length;
fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
console.log(JSON.stringify({mode,passed:report.passed,failures:report.results.filter(r=>r.exitCode!==0).length,changed:report.changed}));
if (!report.passed) process.exitCode=1;
