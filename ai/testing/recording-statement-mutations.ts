/** Faults run only in guarded synthetic workers; never mutate the user's checkout. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const contract='ai/dashboard/recording-statements.fixture.ts';
const mutants=[
  // The defect itself: only statements that fit on one line are seen.
  {name:'statements read a line at a time again',file:'ai/dashboard/recorder.ts',
    from:'    if (ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression))\n      statements.push(node);',
    to:'    if (ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression)\n      && file.getLineAndCharacterOfPosition(node.getStart(file)).line === file.getLineAndCharacterOfPosition(node.getEnd()).line)\n      statements.push(node);',
    marker:'a wrapped statement must not vanish'},
  // The other direction: a chain becomes several actions instead of one.
  {name:'a wrapped chain split into one action per call',file:'ai/dashboard/recorder.ts',
    from:'  const statements: ts.ExpressionStatement[] = [];',
    to:'  const statements: any[] = [];\n  const asStatement = (node: ts.Node) => ({ expression: { expression: node }, getStart: (f: ts.SourceFile) => node.getStart(f), getEnd: () => node.getEnd() });',
    extra:{from:'    ts.forEachChild(node, visit);\n  };\n  visit(file);',
      to:'    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)\n      && file.getLineAndCharacterOfPosition(node.getStart(file)).line !== file.getLineAndCharacterOfPosition(node.getEnd()).line) statements.push(asStatement(node));\n    ts.forEachChild(node, visit);\n  };\n  visit(file);'},
    marker:'a wrapped statement is ONE step, not one per line'},
  // A recorded VALUE gets reformatted because the collapse stopped respecting literals.
  {name:'whitespace collapsed inside string literals',file:'ai/dashboard/recorder.ts',
    from:"    : part.text).join('').trim();",
    to:"    : part.text.replace(/\\s+/g, ' ')).join('').trim();",
    marker:'whitespace inside a literal is left exactly as recorded'},
  // A call with arguments stops being recognised at all, so an options object deletes its action.
  {name:'a call carrying an options object no longer recognised',file:'ai/dashboard/recorder.ts',
    from:'    const call = ts.isCallExpression(awaited) && ts.isPropertyAccessExpression(awaited.expression)',
    to:'    const call = ts.isCallExpression(awaited) && awaited.arguments.length === 0 && ts.isPropertyAccessExpression(awaited.expression)',
    marker:'the single-line form is one step'},
  // An options object stops being options and becomes the action's value.
  {name:'an options object read as the action value',file:'ai/dashboard/recorder.ts',
    from:"      const raw = ACTIONS[call.method] === 'click' || ACTIONS[call.method] === 'check'",
    to:"      const raw = false && ACTIONS[call.method] === 'check'",
    marker:'a click carries no value, options or not'},
  // Recording order stops being source order.
  {name:'statements returned in reverse source order',file:'ai/dashboard/recorder.ts',
    from:'  statements.sort((a, b) => a.getStart(file) - b.getStart(file));',
    to:'  statements.sort((a, b) => b.getStart(file) - a.getStart(file));',
    marker:'the recorded order is the source order'},
  // The navigation marker is on the statement's closing line; lose it and causality goes.
  {name:'the trailing navigation marker dropped',file:'ai/dashboard/recorder.ts',
    from:"    const trailing = (lines[end.line] ?? '').slice(end.character);",
    to:"    const trailing = '';",
    marker:'its cause survives'},
  // The argument text is lost, so a credential fill has nothing to redact.
  {name:'argument text lost moving to the tree',file:'ai/dashboard/recorder.ts',
    from:"          args: flattenExpression(awaited.arguments.map(argument => argument.getText(file)).join(', ')) }",
    to:"          args: '' }",
    marker:'a wrapped credential fill is still redacted'},
  // Tolerating the mismatch instead of restoring the action.
  {name:'screenshot pairing tolerates ten observations against nine actions',file:'ai/diagnostics/recording.ts',
    from:'    const actionsPaired=actual.length===observed.length && actual.every(',
    to:'    const actionsPaired=actual.length<=observed.length && actual.every(',
    marker:'ten observations and nine actions do not pair'},
  // Recovering an action renumbers every step after it; a sidecar that cannot say which
  // stream it belongs to gets re-applied to controls its author never chose.
  {name:'a sidecar re-applied to a renumbered step stream',file:'ai/knowledge/authoring-owners.ts',
    from:'  if (value.revision && revision && value.revision !== revision)',
    to:'  if (false)',
    marker:'a sidecar from another step stream is refused, not applied'},
  {name:'the step stream is never recorded on the sidecar',file:'ai/dashboard/recording-mapping.ts',
    from:'    revision: prepared.revision, choices: prepared.steps,',
    to:'    choices: prepared.steps,',
    marker:'a saved sidecar records the step stream its choices were made against'},
];
const selected=process.argv.find(a=>a.startsWith('--mutant='));
if(!selected&&!process.env.AURA_SYNTHETIC_FIXTURE_ROOT){
  for(let i=0;i<mutants.length;i++){
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),__filename,`--mutant=${i}`],{stdio:'inherit',windowsHide:true,timeout:300000});
    assert.equal(r.status,0,`Mutation ${i}: ${r.error??''}`);
  }
  console.log(`PASS ${mutants.length} recording statement mutants killed`);
}else{
  require('./isolated-checkout');assert.equal(process.cwd(),process.env.AURA_SYNTHETIC_FIXTURE_ROOT);
  const m=mutants[Number(selected?.split('=')[1])] as any;assert.ok(m);
  const before=fs.readFileSync(m.file,'utf8');assert.ok(before.includes(m.from),'Mutation anchor: '+m.name);
  if(m.extra)assert.ok(before.includes(m.extra.from),'Mutation extra anchor: '+m.name);
  try{
    let faulted=before.replace(m.from,m.to);
    if(m.extra)faulted=faulted.replace(m.extra.from,m.extra.to);
    fs.writeFileSync(m.file,faulted);
    const r=spawnSync(process.execPath,[require.resolve('tsx/cli'),contract],{encoding:'utf8',timeout:240000,windowsHide:true});
    assert.ok(!r.error,`${m.name}: ${r.error}`);
    assert.notEqual(r.status,0,'SURVIVED '+m.name);
    assert.ok((r.stdout+r.stderr).includes(m.marker),'Wrong failure for '+m.name+': '+(r.stdout+r.stderr).slice(-900));
    console.log('KILLED '+m.name);
  }finally{fs.writeFileSync(m.file,before);}
}
