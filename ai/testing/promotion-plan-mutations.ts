/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
/**
 * The publication set is the EFFECTIVE revision, split by ownership. Each fault here restores
 * one of the ways that can quietly go wrong: publishing nothing, publishing the wrong version,
 * publishing too much, or publishing the historical framework into a live application.
 */
const contract = 'ai/dashboard/quarantine-workspace.fixture.ts';
const mutants = [
  // The original defect shape: read the payload from the delta, so an unedited validated draft
  // publishes nothing and the case never returns to the suite.
  {
    name: 'a zero-file original revision publishes nothing',
    file: 'ai/dashboard/quarantine-workspace.ts',
    from: "  const spec = path.resolve(ROOT, loaded.original.entry), effective = loaded.overlay.get(spec);",
    to: "  const spec = path.resolve(ROOT, loaded.original.entry), effective = loaded.revision.files[loaded.original.entry];",
    phase: 'effective-revision',
    marker: 'a validated unedited draft is promotable',
  },
  // The effective revision ignores the later edit and ships the original snapshot instead.
  {
    name: 'the effective revision ignores the validated edit',
    file: 'ai/dashboard/quarantine-workspace.ts',
    from: "  const overlay=new Map(Object.entries({...original.files,...revision.files}).map(([file,text])=>[path.resolve(ROOT,file),text]));",
    to: "  const overlay=new Map(Object.entries({...revision.files,...original.files}).map(([file,text])=>[path.resolve(ROOT,file),text]));",
    phase: 'effective-revision',
    marker: 'and not the original snapshot',
  },
  // Historical shared framework copied into the application output.
  {
    name: 'historical shared framework enters the promotion write set',
    file: 'ai/dashboard/quarantine-workspace.ts',
    from: "    if (file === loaded.original.entry) continue;   // published below, from the effective revision",
    to: "    if (file === loaded.original.entry) continue;\n    if (dependencyOwnership(scope, file) === 'SHARED_FRAMEWORK') { changes.set(path.resolve(ROOT, file), text); plan.applicationOwned.push({ path: file, hash: hashContent(text) }); continue; }",
    phase: 'promotion-plan',
    marker: 'a shared framework file in the delta is refused, never published into the application',
  },
  // The refreshed application dependency dropped from the write set, so promotion ships a spec
  // validated against a Page Object it never publishes.
  {
    name: 'the refreshed application dependency is omitted',
    file: 'ai/dashboard/quarantine-workspace.ts',
    from: "    changes.set(target, text);\n    plan.applicationOwned.push({ path: file, hash: hashContent(text) });",
    to: "    void target; void text;",
    phase: 'promotion-plan',
    marker: 'the refreshed dependency is in the write set',
  },
  // An unchanged application dependency rewritten anyway - promotion as a bulk restore.
  {
    name: 'an unchanged application file is rewritten anyway',
    file: 'ai/dashboard/quarantine-workspace.ts',
    from: "  for (const [file, text] of Object.entries(loaded.revision.files)) {",
    to: "  for (const [file, text] of Object.entries(loaded.overlay.size ? Object.fromEntries([...loaded.overlay].map(([k, v]) => [relative(k), v])) : loaded.revision.files)) {",
    phase: 'effective-revision',
    marker: 'a validated unedited draft is promotable',
  },
  // The refresh rewrites the validated revision in place instead of descending from it.
  {
    name: 'the refresh edits the validated revision in place',
    file: 'ai/dashboard/quarantine-workspace.ts',
    from: "  const revision:Revision={revisionId:next,parent:revisionId,createdAt:new Date().toISOString(),\n"
      + "    provenance:'APPLICATION_DEPENDENCY_REFRESH',reviewed:drifted,files};",
    to: "  const revision:Revision={revisionId:next,parent:null,createdAt:new Date().toISOString(),\n"
      + "    provenance:'APPLICATION_DEPENDENCY_REFRESH',reviewed:drifted,files};",
    phase: 'promotion-plan',
    marker: 'the refresh descends from the validated revision without rewriting it',
  },
];
const selected = process.argv.find(a => a.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), __filename, `--mutant=${i}`],
      { stdio: 'inherit', windowsHide: true, timeout: 900000 });
    assert.equal(r.status, 0, `Mutation ${i}: ${r.error ?? ''}`);
  }
  console.log(`PASS ${mutants.length} promotion plan mutants killed`);
} else {
  require('./isolated-checkout'); assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m = mutants[Number(selected?.split('=')[1])]; assert.ok(m);
  const before = fs.readFileSync(m.file, 'utf8'); assert.ok(before.includes(m.from), 'Mutation anchor: ' + m.name);
  try {
    fs.writeFileSync(m.file, before.replace(m.from, m.to));
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), contract, `--phase=${m.phase}`],
      { encoding: 'utf8', timeout: 720000, windowsHide: true });
    assert.ok(!r.error, `${m.name}: ${r.error}`);
    assert.notEqual(r.status, 0, 'SURVIVED ' + m.name);
    assert.ok((r.stdout + r.stderr).includes(m.marker),
      'Wrong failure for ' + m.name + ': ' + (r.stdout + r.stderr).slice(-700));
    console.log('KILLED ' + m.name);
  } finally { fs.writeFileSync(m.file, before); }
}
