const fs=require('fs'),path=require('path'),crypto=require('crypto');
const mode=process.argv[2],prefix='docs/validation/ksp21-profile-';
if(!['before','after'].includes(mode))throw Error('Choose before or after');
function walk(file){if(!fs.existsSync(file))return [];const stat=fs.lstatSync(file);if(stat.isSymbolicLink())return [];return stat.isDirectory()?fs.readdirSync(file).flatMap(name=>walk(path.join(file,name))):[file.replaceAll('\\','/')];}
const files=['ai/projects/registry.json','ai/dashboard/recordings/ksp','ai/knowledge/page/ksp','ai/test-data/ksp','ai/test-mapping','ai/autocode/state.json','ai/autocode/quarantine','ai/diagnostics/artifacts/ksp','ai/dashboard/runs','tests-e2e/pages/ksp','tests-e2e/generated/ksp','tests-e2e/ksp.fixtures.ts','excel/ksp-test-cases.xlsx'].flatMap(walk);
const hashes=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
fs.writeFileSync(prefix+mode+'-hashes.json',JSON.stringify(hashes,null,2));
if(mode==='before')console.log(JSON.stringify({files:files.length}));else{const before=JSON.parse(fs.readFileSync(prefix+'before-hashes.json')),result={filesBefore:Object.keys(before).length,filesAfter:files.length,changed:Object.keys(before).filter(file=>hashes[file]!==before[file]),added:Object.keys(hashes).filter(file=>!(file in before))};fs.writeFileSync(prefix+'integrity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
