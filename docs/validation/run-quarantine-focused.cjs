// Explicit focused selection for this task. This is not the framework regression runner.
const fs=require('fs'),{spawnSync}=require('child_process');
const checks=[
 ['recording-pictures','ai/diagnostics/recording-pictures.fixture.ts'],
 ['runtime-pictures','ai/diagnostics/runtime-pictures.fixture.ts'],
 ['quarantine-guard','ai/autocode/quarantine-diagnostics.fixture.ts'],
 ['quarantine-package','ai/dashboard/quarantine-workspace.fixture.ts','--phase=package'],
 ['quarantine-browser','ai/dashboard/quarantine-browser.fixture.ts'],
 ['quarantine-editing','ai/dashboard/quarantine-workspace.fixture.ts','--phase=editing'],
 ['quarantine-route','ai/dashboard/quarantine-workspace.fixture.ts','--phase=route'],
 ['quarantine-security','ai/diagnostics/security.fixture.ts'],
 ...['catalog','save','reuse','isolation'].map(phase=>['authoring-'+phase,'ai/dashboard/recording-mapping.fixture.ts','--phase='+phase]),
 ['explicit-authoring','ai/dashboard/explicit-authoring.fixture.ts'],
 ['code-workspace','ai/dashboard/authoring-workspace.fixture.ts'],
 ['authoring-browser','ai/dashboard/authoring-browser.fixture.ts'],
 ['user-confirmed-auth','ai/autocode/user-confirmed-auth.fixture.ts'],
 ['ownership-reuse','ai/autocode/ownership-reuse.fixture.ts'],
 ['recorded-flow','ai/autocode/recorded-flow.fixture.ts'],
 ['navigation-causality','ai/dashboard/navigation-causality.fixture.ts'],
 ['dashboard-startup','ai/dashboard/dashboard-startup.fixture.ts'],
 ['recorder','ai/dashboard/recorder.fixture.ts'],
 ['evidence-sidecar','ai/autocode/evidence-sidecar.fixture.ts'],
];
const results=[];
for(const [name,file,...args]of checks){
 const began=Date.now();process.stdout.write('RUN '+name+'\n');
 const result=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs',file,...args],{encoding:'utf8',windowsHide:true,timeout:330000,maxBuffer:8*1024*1024,env:{...process.env,AURA_UI_CAPTURE_DIR:name==='quarantine-browser'?require('path').resolve('docs/validation/quarantine-ui'):''}});
 fs.writeFileSync('docs/validation/'+name+'-settled.log',(result.stdout||'')+(result.stderr||'')+(result.error?'\n'+result.error.message:''));
 const item={name,file,args,exitCode:result.status,error:result.error?.code,milliseconds:Date.now()-began};results.push(item);fs.writeFileSync('docs/validation/quarantine-focused-results.json',JSON.stringify(results,null,2));process.stdout.write(`${result.status===0?'PASS':'FAIL'} ${name} (${result.status})\n`);
}
process.exitCode=results.some(item=>item.exitCode!==0)?1:0;
