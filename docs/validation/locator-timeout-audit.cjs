const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const mode = process.argv[2];
if (!['before', 'after'].includes(mode)) throw Error('Choose before or after');
function walk(file) {
  if (!fs.existsSync(file)) return [];
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) return [];
  return stat.isDirectory() ? fs.readdirSync(file).flatMap(name => walk(path.join(file, name))) : [file.replaceAll('\\', '/')];
}
const roots = ['ai/projects/registry.json', 'ai/dashboard/recordings', 'ai/knowledge/page', 'ai/test-data/ksp',
  'ai/test-mapping', 'ai/autocode/state.json', 'ai/autocode/quarantine', 'ai/diagnostics/artifacts',
  'ai/dashboard/runs', 'tests-e2e/pages/ksp', 'tests-e2e/generated', 'tests-e2e/ksp.fixtures.ts', 'excel'];
const hashes = Object.fromEntries(roots.flatMap(walk).map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const prefix = 'docs/validation/locator-timeout-';
fs.writeFileSync(prefix + mode + '-hashes.json', JSON.stringify(hashes, null, 2));
if (mode === 'after') {
  const before = JSON.parse(fs.readFileSync(prefix + 'before-hashes.json', 'utf8'));
  const result = { filesBefore: Object.keys(before).length, filesAfter: Object.keys(hashes).length,
    changed: Object.keys(before).filter(file => before[file] !== hashes[file]), added: Object.keys(hashes).filter(file => !(file in before)) };
  fs.writeFileSync(prefix + 'integrity.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} else console.log(JSON.stringify({ files: Object.keys(hashes).length }));
