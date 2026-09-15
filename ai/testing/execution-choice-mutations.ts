/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
/**
 * These fault the REAL Recording Review UI and run it in a REAL browser.
 *
 * Every one restores the shape the fix removed: a step that reports what is missing and hides
 * the control that would supply it, or a summary that describes a mechanism the mapping does
 * not use. None of them can be caught by inspecting state - the defect was always that the
 * state was right and the rendering was not.
 */
const contract = 'ai/dashboard/authoring-browser.fixture.ts';
const mutants = [
  // The whole section back inside the collapsed Advanced block - the original defect.
  {
    name: 'the execution choice section is not rendered',
    file: 'ai/dashboard/public/recording-review.js',
    from: '      executionChoice(step,state,catalog,panel);',
    to: '      void executionChoice;',
    marker: 'the execution choice section is on screen',
  },
  // The method list omitted, so the only way to choose is to remember a name.
  {
    name: 'the method list is not rendered',
    file: 'ai/dashboard/public/recording-review.js',
    from: "      if(ranked.length){\n        const label=el('label','Method');label.htmlFor='executionMethod';",
    to: "      if(false){\n        const label=el('label','Method');label.htmlFor='executionMethod';",
    marker: 'the method list is reachable',
  },
  // The compatible capability dropped from the ranking, so the one method that matches the
  // recorded locator is never offered by name.
  {
    name: 'the compatible method is omitted from the recommendation',
    file: 'ai/dashboard/public/recording-review.js',
    from: '      const matches=methods.filter(method=>(method.declaredLocator||\'\').trim()===recorded&&recorded);',
    to: '      const matches=[];',
    marker: 'the one matching capability is offered by name',
  },
  // Recorded-locator execution withdrawn, leaving a Page Object with no capability as a dead end.
  {
    name: 'the recorded-locator action is omitted',
    file: 'ai/dashboard/public/recording-review.js',
    from: "      if(step.role==='action'&&recorded){\n        const useLocator=el('button','Use recorded locator');",
    to: "      if(false){\n        const useLocator=el('button','Use recorded locator');",
    marker: 'Use recorded locator is reachable',
  },
  // Save offered before an executable choice exists - the UI claiming a mapping the server
  // will refuse, which is how a step came to look mapped and was not.
  {
    name: 'Save Mapping is enabled before an executable choice',
    file: 'ai/dashboard/public/recording-review.js',
    from: '||(!!state.pageObject&&!runnable(state));',
    to: ';',
    marker: 'an incomplete binding cannot be saved',
  },
  // The chosen method reduced to context again, so an explicit choice persists as AUTO.
  {
    name: 'a selected method is persisted without its execution mode',
    file: 'ai/dashboard/public/recording-review.js',
    from: "      const choose=name=>patch(step,{method:name,executionMode:'PAGE_OBJECT_METHOD'});",
    to: "      const choose=name=>patch(step,{method:name,executionMode:'AUTO'});",
    marker: 'the Page Object survives the reload',
  },
  // The summary describing a recorded locator for a step bound to a Page Object method.
  {
    name: 'the mapping summary lies about the execution mode',
    file: 'ai/dashboard/public/recording-review.js',
    from: "      const execution=state.method?'PAGE_OBJECT_METHOD':state.executionMode==='RECORDED_LOCATOR'?'RECORDED_LOCATOR':state.pageObject?'NOT CHOSEN':'AUTO';",
    to: "      const execution=state.executionMode==='AUTO'?'AUTO':'RECORDED_LOCATOR';",
    marker: 'the summary reports the mechanism that will run',
  },
  // The saved method lost on the way back in, so a completed mapping reads as unmapped.
  {
    name: 'the saved method is dropped when the review is reloaded',
    file: 'ai/dashboard/public/recording-review.js',
    from: "method:b?.method||'',locatorOverride:b?.locatorOverride||''",
    to: "method:'',locatorOverride:b?.locatorOverride||''",
    marker: 'a saved mapping never comes back as AUTO',
  },
];
const selected = process.argv.find(a => a.startsWith('--mutant='));
if (!selected && !process.env.AURA_SYNTHETIC_FIXTURE_ROOT) {
  for (let i = 0; i < mutants.length; i++) {
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), __filename, `--mutant=${i}`],
      { stdio: 'inherit', windowsHide: true, timeout: 900000 });
    assert.equal(r.status, 0, `Mutation ${i}: ${r.error ?? ''}`);
  }
  console.log(`PASS ${mutants.length} execution choice mutants killed`);
} else {
  require('./isolated-checkout'); assert.equal(process.cwd(), process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m = mutants[Number(selected?.split('=')[1])]; assert.ok(m);
  const before = fs.readFileSync(m.file, 'utf8'); assert.ok(before.includes(m.from), 'Mutation anchor: ' + m.name);
  try {
    fs.writeFileSync(m.file, before.replace(m.from, m.to));
    const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), contract],
      { encoding: 'utf8', timeout: 720000, windowsHide: true,
        env: { ...process.env, AURA_EXECUTION_CHOICE_ONLY: '1' } });
    assert.ok(!r.error, `${m.name}: ${r.error}`);
    assert.notEqual(r.status, 0, 'SURVIVED ' + m.name);
    assert.ok((r.stdout + r.stderr).includes(m.marker),
      'Wrong failure for ' + m.name + ': '
        + ((r.stdout + r.stderr).match(/(?:message|generatedMessage)?[^\n]*(?:assert|expected|Error)[^\n]*/gi) ?? []).slice(-12).join('\n  '));
    console.log('KILLED ' + m.name);
  } finally { fs.writeFileSync(m.file, before); }
}
